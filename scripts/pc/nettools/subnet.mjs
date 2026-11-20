// Subnet tab — fully local CIDR maths (no network). Exports computeSubnet (pure, tested)
// and mount (DOM). v6 counts are BigInt; v4 counts are Number.
import { el } from './ui.mjs';
import { validateIPv4, validateIPv6 } from './net.mjs';

function ipv4Str(v) {
  v &= 0xffffffffn;
  return [v >> 24n, (v >> 16n) & 0xffn, (v >> 8n) & 0xffn, v & 0xffn].map(Number).join('.');
}
function ipv6Str(v) {
  const g = [];
  for (let i = 7; i >= 0; i--) g.push(Number((v >> BigInt(i * 16)) & 0xffffn));
  let bestStart = -1, bestLen = 0, cs = -1, cl = 0;
  for (let i = 0; i < 8; i++) {
    if (g[i] === 0) { if (cs < 0) cs = i; cl++; if (cl > bestLen) { bestLen = cl; bestStart = cs; } } else { cs = -1; cl = 0; }
  }
  if (bestLen < 2) bestLen = 0;
  if (!bestLen) return g.map(x => x.toString(16)).join(':');
  const head = g.slice(0, bestStart).map(x => x.toString(16)).join(':');
  const tail = g.slice(bestStart + bestLen).map(x => x.toString(16)).join(':');
  return `${head}::${tail}`;
}

export function computeSubnet(input) {
  const raw = String(input ?? '').trim();
  const slash = raw.lastIndexOf('/');
  if (slash < 0) throw new Error('Use the form <address>/<prefix>, e.g. 10.0.0.0/24.');
  const addr = raw.slice(0, slash);
  const prefix = Number(raw.slice(slash + 1));
  if (!Number.isInteger(prefix)) throw new Error('The prefix must be an integer.');
  const v4 = validateIPv4(addr);
  if (v4.ok) {
    if (prefix > 32) throw new Error('IPv4 prefix is 0–32.');
    const value = BigInt(v4.value);
    const mask = prefix === 0 ? 0n : (0xffffffffn << BigInt(32 - prefix)) & 0xffffffffn;
    const network = value & mask;
    const broadcast = network | (~mask & 0xffffffffn);
    const count = 1n << BigInt(32 - prefix);
    // RFC 3021: /31 and /32 have no separate network/broadcast address; every address is a host.
    const first = prefix >= 31 ? network : network + 1n;
    const last = prefix >= 31 ? broadcast : broadcast - 1n;
    return { version: 4, prefix, network: ipv4Str(network), broadcast: ipv4Str(broadcast), first: ipv4Str(first), last: ipv4Str(last), mask: ipv4Str(mask), count, countStr: count.toString() };
  }
  const v6 = validateIPv6(addr);
  if (v6.ok) {
    if (prefix < 1 || prefix > 128) throw new Error('IPv6 prefix is 1–128.');
    const ALL = (1n << 128n) - 1n;
    const mask = (ALL << BigInt(128 - prefix)) & ALL;
    const network = v6.value & mask;
    const count = 1n << BigInt(128 - prefix);
    const last = network + count - 1n;
    return { version: 6, prefix, network: ipv6Str(network), broadcast: null, first: ipv6Str(network), last: ipv6Str(last), mask: ipv6Str(mask), count, countStr: count.toString() };
  }
  throw new Error('The address part is not a valid IPv4 or IPv6 address.');
}

export function mount(content) {
  const card = el('div', { className: 'nt-card' });
  card.append(el('h3', { text: 'Subnet calculator — fully local (no request sent)' }));
  const row = el('div', { className: 'nt-row' });
  const input = el('input', { className: 'nt-input', attrs: { type: 'text', placeholder: 'e.g. 10.0.0.0/24 or 2001:db8::/64' } });
  const btn = el('button', { className: 'nt-btn', text: 'Compute' });
  const out = el('pre', { className: 'nt-out' });
  const err = el('div', { className: 'nt-err', attrs: { hidden: 'true' } });
  row.append(input, btn);
  card.append(row, out, err);
  function go() {
    try {
      const r = computeSubnet(input.value);
      err.setAttribute('hidden', 'true');
      const lines = [`IPv${r.version} · /${r.prefix}`, `Network:  ${r.network}`, `Mask:     ${r.mask}`];
      if (r.version === 4) lines.push(`Broadcast: ${r.broadcast}`, `First host:  ${r.first}`, `Last host:   ${r.last}`);
      else lines.push(`First addr:  ${r.first}`, `Last addr:   ${r.last}`);
      lines.push(`Addresses: ${r.countStr}`);
      out.textContent = lines.join('\n');
    } catch (e) {
      out.textContent = '';
      err.textContent = e?.message ?? String(e);
      err.removeAttribute('hidden');
    }
  }
  btn.addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  content.append(card);
}
