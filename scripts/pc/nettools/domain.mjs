// Domain & IP tab — RDAP (rdap.org), crt.sh certificate transparency, Shodan InternetDB.
// Click-only; each card names its service. Exports the pure summarizers (tested) + mount.
import { queryCard } from './ui.mjs';
import { validateDomain, validateIPv4, validateIPv6, fetchJson } from './net.mjs';

const RDAP = 'https://rdap.org';
const CRTSH = 'https://crt.sh';
const INTERNETDB = 'https://internetdb.shodan.io';

const isIp = v => validateIPv4(v).ok || validateIPv6(v).ok;
const isValidIpOrDomain = v => {
  const t = String(v ?? '').trim();
  return isIp(t) ? { ok: true } : validateDomain(t);
};

function vcardName(vcardArray) {
  try {
    // RDAP servers ship two vCard-JSON shapes:
    //  a) ["vcard"|"version", [ ["fn", {}, "text", value], ... ]]  (4-element triples, value at [3])
    //  b) ["version", [], { "fn": ["text", {}, value], ... }]      (object form, value at [2])
    if (!Array.isArray(vcardArray) || vcardArray.length < 2) return null;
    const first = Array.isArray(vcardArray[1]) && vcardArray[1].length > 0 ? vcardArray[1] : null;
    const props = first ?? vcardArray[2];
    if (Array.isArray(props)) {
      const fn = props.find(p => Array.isArray(p) && p.length >= 4 && p[0] === 'fn');
      if (fn?.[3] != null) return String(fn[3]);
    } else if (props && typeof props === 'object' && Array.isArray(props.fn) && props.fn[2] != null) {
      return String(props.fn[2]);
    }
  } catch { /* malformed vcard */ }
  return null;
}

// Summarise an RDAP response (domain or IP) as text: nameservers, status, dates, registrar.
export function summarizeRdap(data) {
  if (!data || typeof data !== 'object') return 'Empty RDAP response.';
  const lines = [];
  const names = [...new Set((data.nameservers ?? []).map(n => n.ldhName ?? n.name).filter(Boolean))];
  if (names.length) lines.push(`Nameservers: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` (+${names.length - 8} more)` : ''}`);
  const status = Array.isArray(data.status) && data.status.length ? data.status.join(', ') : null;
  if (status) lines.push(`Status: ${status}`);
  const dates = (data.events ?? []).filter(e => e?.eventAction && e?.eventDate).map(e => `${e.eventAction}: ${String(e.eventDate).slice(0, 10)}`);
  if (dates.length) lines.push(`Dates: ${dates.join('; ')}`);
  const registrar = (data.entities ?? []).find(e => Array.isArray(e?.roles) && e.roles.includes('registrar'));
  if (registrar) {
    const name = vcardName(registrar.vcardArray);
    if (name) lines.push(`Registrar: ${name}`);
    if (registrar.handle) lines.push(`Registrar ID: ${registrar.handle}`);
  }
  if (data.cidr0c) lines.push(`Network: ${data.cidr0c}`);
  return lines.length ? lines.join('\n') : 'RDAP response had no recognised fields.';
}

// Dedupe certificate names from a crt.sh JSON array (name_value may hold several names per row);
// cap the displayed list at 200.
export function summarizeCrtsh(rows) {
  if (!Array.isArray(rows) || !rows.length) return { count: 0, total: 0, names: [], capped: false };
  const names = [];
  const seen = new Set();
  for (const row of rows) {
    const raw = typeof row?.name_value === 'string' ? row.name_value : '';
    for (const n of raw.split('\n')) {
      const name = n.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  const capped = names.length > 200;
  return { count: rows.length, total: names.length, names: names.slice(0, 200), capped };
}

// Summarise a Shodan InternetDB JSON response: OS, CPE, hostnames, ports, vulnerabilities.
export function summarizeInternetDb(data) {
  if (!data || typeof data !== 'object') return 'Empty InternetDB response.';
  const lines = [];
  if (data.os) lines.push(`OS: ${data.os}`);
  if (data.cpe) lines.push(`CPE: ${data.cpe}`);
  const hosts = [...new Set((data.hostnames ?? []).map(String))].slice(0, 10);
  if (hosts.length) lines.push(`Hostnames: ${hosts.join(', ')}`);
  const ports = [...new Set((data.ports ?? []).map(Number))].filter(Number.isInteger).sort((a, b) => a - b);
  if (ports.length) lines.push(`Ports: ${ports.slice(0, 40).join(', ')}${ports.length > 40 ? ` (+${ports.length - 40} more)` : ''}`);
  else lines.push('Ports: none reported');
  const vulns = (data.vulns ?? []).filter(v => v?.id);
  if (vulns.length) lines.push(`Vulnerabilities: ${vulns.slice(0, 20).map(v => `${v.id}${v.score != null ? ` (score ${v.score})` : ''}`).join('; ')}${vulns.length > 20 ? ` (+${vulns.length - 20} more)` : ''}`);
  else lines.push('Vulnerabilities: none reported');
  return lines.join('\n');
}

export function mount(content) {
  queryCard(content, {
    service: 'RDAP (rdap.org)',
    label: 'Domain or IP record',
    placeholder: 'e.g. example.com or 8.8.8.8',
    validate: isValidIpOrDomain,
    run: v => {
      const t = v.trim();
      return fetchJson(`${RDAP}/${isIp(t) ? 'ip' : 'domain'}/${encodeURIComponent(t)}`, { service: 'RDAP (rdap.org)' }).then(summarizeRdap);
    },
    help: 'rdap.org redirects to the responsible registry, so the answer may come from a registry host.',
  });
  queryCard(content, {
    service: 'crt.sh',
    label: 'Certificate transparency',
    placeholder: 'e.g. example.com',
    validate: v => validateDomain(String(v ?? '').trim()),
    run: v => fetchJson(`${CRTSH}/?q=%25.${encodeURIComponent(v.trim())}&output=json`, { service: 'crt.sh' }).then(rows => {
      const s = summarizeCrtsh(rows);
      if (!s.count) return `crt.sh found no certificates matching *${v.trim()}.`;
      return `${s.count} certificate record(s), ${s.total} distinct name(s) via crt.sh:\n${s.names.join('\n')}${s.capped ? `\n(+${s.total - 200} more names, capped at 200)` : ''}`;
    }),
    help: 'crt.sh is a public certificate-transparency log; it can be slow or flaky, so the query times out after 15 s. At most 200 names are shown.',
  });
  queryCard(content, {
    service: 'Shodan InternetDB',
    label: 'Open ports and vulnerabilities',
    placeholder: 'e.g. 8.8.8.8',
    validate: v => { const t = String(v ?? '').trim(); return isIp(t) ? { ok: true } : { ok: false, error: 'Enter a valid IP address (IPv4 or IPv6).' }; },
    run: v => fetchJson(`${INTERNETDB}/${v.trim()}`, { service: 'Shodan InternetDB' }).then(summarizeInternetDb),
    help: 'Shodan InternetDB is a free, keyless sample of their scan data for the given IP.',
  });
}
