// Shared network + input helpers for the WebPC nettools app. The pure functions
// (validators, PTR builder, DNS answer formatting) are exported for unit tests; the
// fetch helper runs only in the browser on an explicit click. Every external call uses
// credentials:'omit', referrerPolicy:'no-referrer' and a 15 s timeout, and names its
// receiving service in the error message.
export const TIMEOUT_MS = 15000;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Domain / hostname: >=2 labels (a real FQDN), each 1-63 chars [a-z0-9-] (no leading/trailing
// hyphen), alphabetic TLD >=2 chars, total <=253. Returns { ok, value? } or { ok:false, error }.
export function validateDomain(input) {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s || /\s/.test(s) || s.length > 253) return { ok: false, error: 'Enter a valid domain or hostname (no spaces, 253 chars max).' };
  const labels = s.split('.');
  if (labels.length < 2) return { ok: false, error: 'Enter a full domain, e.g. example.com.' };
  for (const l of labels) if (l.length > 63 || !LABEL.test(l)) return { ok: false, error: `Invalid label "${l}".` };
  const tld = labels.at(-1);
  if (!/^[a-z]{2,}$/.test(tld)) return { ok: false, error: `Invalid top-level domain "${tld}".` };
  return { ok: true, value: s };
}

// Strict dotted-quad IPv4 (no leading zeros). Returns { ok, value?, octets? }.
export function validateIPv4(input) {
  const parts = String(input ?? '').trim().split('.');
  if (parts.length !== 4) return { ok: false, error: 'IPv4 needs four dot-separated octets.' };
  const octets = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return { ok: false, error: `Invalid octet "${p}".` };
    if (p.length > 1 && p.startsWith('0')) return { ok: false, error: `No leading zeros allowed (octet "${p}").` };
    const n = Number(p);
    if (n > 255) return { ok: false, error: `Octet ${n} out of range.` };
    octets.push(n);
  }
  const value = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  return { ok: true, value, octets };
}

// Expand an IPv6 literal (with :: compression and an optional dotted-quad tail) into eight
// 16-bit groups, or null if invalid.
function expandIPv6(s) {
  s = String(s ?? '').toLowerCase().trim();
  if (!s || s.length > 45) return null;
  let v4 = null;
  const m4 = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) {
    const o = m4.slice(1, 5).map(Number);
    if (o.some(x => x > 255)) return null;
    v4 = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    s = s.slice(0, s.length - m4[0].length);
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }
  if (s.includes(':::')) return null;
  const dc = s.split('::');
  if (dc.length > 2) return null;
  const head = dc.length === 2 ? dc[0] : s;
  const tail = dc.length === 2 ? dc[1] : '';
  const isGroup = g => g.length >= 1 && g.length <= 4 && /^[0-9a-f]+$/.test(g);
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === '' ? [] : tail.split(':');
  if (headGroups.some(g => !isGroup(g)) || tailGroups.some(g => !isGroup(g))) return null;
  const hv = headGroups.map(g => parseInt(g, 16));
  const tv = tailGroups.map(g => parseInt(g, 16));
  let groups;
  if (dc.length === 2) {
    const gap = 8 - (hv.length + tv.length) - (v4 ? 2 : 0);
    if (gap < 1) return null;
    groups = [...hv, ...Array(gap).fill(0), ...tv, ...(v4 ?? [])];
  } else {
    if (hv.length + (v4 ? 2 : 0) !== 8) return null;
    groups = [...hv, ...(v4 ?? [])];
  }
  if (groups.length !== 8 || groups.some(g => g > 0xffff)) return null;
  return groups;
}

// Validate an IPv6 literal; returns { ok, value? } where value is the 128-bit BigInt.
export function validateIPv6(input) {
  const groups = expandIPv6(input);
  if (!groups) return { ok: false, error: 'Invalid IPv6 address.' };
  const value = groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
  return { ok: true, value };
}

// https-only URL. Returns { ok, value? }.
export function validateUrl(input) {
  try {
    const u = new URL(String(input ?? '').trim());
    if (u.protocol !== 'https:') return { ok: false, error: 'Only https URLs are allowed.' };
    return { ok: true, value: u.href };
  } catch { return { ok: false, error: 'Enter a valid URL.' }; }
}

// Build the PTR (reverse-DNS) name for an IP: v4 -> x.3.2.1.in-addr.arpa, v6 -> reversed
// hex nibbles + .ip6.arpa. Throws if the input is not a valid IP.
export function buildPtrName(ip) {
  const v4 = validateIPv4(ip);
  if (v4.ok) return v4.octets.slice().reverse().join('.') + '.in-addr.arpa';
  const v6 = validateIPv6(ip);
  if (!v6.ok) throw new Error('Not a valid IP address.');
  return v6.value.toString(16).padStart(32, '0').split('').reverse().join('.') + '.ip6.arpa';
}

// Format a DNS-over-HTTPS JSON response ({ Status, Answer: [...] }) into display strings.
// Type codes: A=1, NS=2, CNAME=5, SOA=6, MX=15, TXT=16, AAAA=28, CAA=51.
export function formatDnsAnswer(resp) {
  const answers = Array.isArray(resp?.Answer) ? resp.Answer : [];
  return answers.map(rec => {
    const d = rec.Data;
    switch (rec.Type) {
      case 16: return Array.isArray(d) ? d.join('  ') : String(d);
      case 2: return Array.isArray(d) ? d.join(', ') : String(d);
      case 51: return Array.isArray(d) ? d.map(c => (c.flag !== undefined ? `${c.flag} ` : '') + `${c.tag} "${c.value}"`).join('; ') : String(d);
      default: return typeof d === 'string' ? d : JSON.stringify(d);
    }
  });
}

// Fetch a URL and parse JSON, with the WebPC fetch policy. GET by default; pass `method:
// 'POST'` + `body` (auto Content-Type: application/json) for API creation calls.
// Throws an Error naming the service.
export async function fetchJson(url, { accept, service, method = 'GET', body } = {}) {
  const headers = {};
  if (accept) headers.Accept = accept;
  if (body != null) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(TIMEOUT_MS), headers, body: body != null ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new Error(`${service}: request failed${e?.name === 'TimeoutError' ? ' (timed out after 15s)' : ` (${e?.message ?? 'network error'})`.trim()}.`);
  }
  if (!res.ok) throw new Error(`${service} returned HTTP ${res.status}.`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`${service} returned non-JSON data.`); }
}
