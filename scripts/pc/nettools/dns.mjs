// DNS tab — DNS over HTTPS via Cloudflare (default) or Google. Click-only; the result text
// names the provider. Exports dohLookup (tested for the answer formatting path) and mount.
import { el, select } from './ui.mjs';
import { validateDomain, validateIPv4, validateIPv6, buildPtrName, formatDnsAnswer, fetchJson } from './net.mjs';

const CLOUDFLARE = 'https://cloudflare-dns.com/dns-query';
const GOOGLE = 'https://dns.google/resolve';
export const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'PTR'];
const RCODE = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };

// PTR lookups take an IP and build the reverse name; every other type uses the domain directly.
export function dnsQueryName(type, name) {
  return type === 'PTR' ? buildPtrName(name) : name;
}

export async function dohLookup({ provider, type, name }) {
  const qname = dnsQueryName(type, name);
  const google = provider === 'google';
  const service = google ? 'Google DNS-over-HTTPS' : 'Cloudflare DNS-over-HTTPS';
  const url = `${google ? GOOGLE : CLOUDFLARE}?name=${encodeURIComponent(qname)}&type=${type}`;
  const resp = await fetchJson(url, { accept: 'application/dns-json', service });
  const answers = formatDnsAnswer(resp);
  const code = RCODE[resp?.Status] ?? String(resp?.Status);
  return answers.length
    ? `${service} → ${code}:\n${answers.join('\n')}`
    : `${service} → ${code} (no ${type} records for ${qname}).`;
}

export function mount(content) {
  const card = el('div', { className: 'nt-card' });
  card.append(el('h3', { text: 'DNS over HTTPS' }));
  const row = el('div', { className: 'nt-row nt-row-wrap' });
  const provider = select('nt-select', 'cloudflare', [['cloudflare', 'Cloudflare'], ['google', 'Google']]);
  const type = select('nt-select', 'A', TYPES.map(t => [t, t]));
  const input = el('input', { className: 'nt-input nt-input-grow', attrs: { type: 'text', placeholder: 'domain, e.g. example.com' } });
  const btn = el('button', { className: 'nt-btn', text: 'Look up via Cloudflare DNS-over-HTTPS' });
  const out = el('pre', { className: 'nt-out' });
  const err = el('div', { className: 'nt-err', attrs: { hidden: 'true' } });
  row.append(provider, type, input, btn);
  card.append(row, out, err, el('p', { className: 'nt-help', text: 'For PTR, enter an IP address (the reverse name is built for you). Cloudflare and Google both answer with application/dns-json.' }));
  function serviceLabel() { return provider.value === 'google' ? 'Google DNS-over-HTTPS' : 'Cloudflare DNS-over-HTTPS'; }
  function syncBtn() { btn.textContent = `Look up via ${serviceLabel()}`; }
  provider.addEventListener('change', syncBtn);
  type.addEventListener('change', () => { input.placeholder = type.value === 'PTR' ? 'IP, e.g. 1.2.3.4' : 'domain, e.g. example.com'; });
  function showErr(msg) { out.textContent = ''; err.textContent = msg; err.removeAttribute('hidden'); }
  async function go() {
    const t = type.value, v = input.value.trim();
    let valid = true;
    if (t === 'PTR') { if (!validateIPv4(v).ok && !validateIPv6(v).ok) { valid = false; showErr('PTR needs a valid IP address.'); return; } }
    else { const c = validateDomain(v); if (!c.ok) { valid = false; showErr(c.error); return; } }
    if (!valid) return;
    btn.disabled = true; err.setAttribute('hidden', 'true'); out.textContent = `Querying ${serviceLabel()}…`;
    try { out.textContent = await dohLookup({ provider: provider.value, type: t, name: v }); }
    catch (e) { showErr(e?.message ?? String(e)); }
    finally { btn.disabled = false; }
  }
  btn.addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  content.append(card);
}
