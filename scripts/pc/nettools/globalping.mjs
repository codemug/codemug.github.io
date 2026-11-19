// Globalping tab — keyless global ping/traceroute/mtr/dns/http from distributed probes.
// Click-only: the POST creates a measurement, then GET /v1/measurements/<id> is polled no
// faster than every 500 ms until the top-level status is "finished" (cap 60 s). Response
// shape verified against the live API: results is keyed by probe index, each entry is
// { probe: {city, country, network, ...}, result: {status, rawOutput, resolvedAddress,
// resolvedHostname, timings?|hops?|answers?|status_code?|times?} }.
import { el, select } from './ui.mjs';
import { validateDomain, fetchJson } from './net.mjs';

const API = 'https://api.globalping.io/v1/measurements';
const TYPES = ['ping', 'traceroute', 'mtr', 'dns', 'http'];
const POLL_MS = 500;
const DEADLINE_MS = 60000;

const fmt = n => (typeof n === 'number' && Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(1)) : '?');

// Validate the inputs and build the POST body. Throws a readable Error on bad input.
export function buildGlobalpingRequest({ type, target, magic = 'world', limit = 3 }) {
  if (!TYPES.includes(type)) throw new Error(`Unknown measurement type "${type}".`);
  const t = String(target ?? '').trim().toLowerCase();
  const d = validateDomain(t);
  if (!d.ok) throw new Error(d.error);
  const lim = Number(limit);
  if (!Number.isInteger(lim) || lim < 1 || lim > 5) throw new Error('Limit must be a whole number from 1 to 5.');
  return { type, target: t, locations: [{ magic: String(magic ?? '').trim() || 'world' }], limit: lim };
}

// Poll the measurement URL until top-level status is "finished" (or the 60 s cap is hit,
// in which case the last partial response is returned).
export async function pollGlobalping(url) {
  const deadline = Date.now() + DEADLINE_MS;
  let last = null;
  for (;;) {
    await new Promise(r => setTimeout(r, POLL_MS));
    last = await fetchJson(url, { service: 'Globalping' });
    if (last?.status === 'finished') return last;
    if (Date.now() + POLL_MS > deadline) return last;
  }
}

function probeLabel(probe) {
  const place = [probe?.city, probe?.country].filter(Boolean).join(', ');
  return probe?.network ? `${place || '?'} (${probe.network})` : place || '?';
}

// Text lines for one probe's result, per measurement type. rawOutput is dropped (it is the
// full CLI dump; the structured fields above cover it in far fewer characters).
function resultLines(result) {
  const out = [];
  if (Array.isArray(result?.timings) && result.timings.length) {
    const s = result.stats ?? {};
    out.push(`RTT min ${fmt(s.min)} ms, max ${fmt(s.max)} ms, avg ${fmt(s.avg)} ms${s.total != null ? ` (${s.rcv ?? s.total}/${s.total} received)` : ''}${result.timings[0]?.ttl != null ? `, TTL ${result.timings[0].ttl}` : ''}`);
  }
  if (Array.isArray(result?.hops)) {
    result.hops.forEach((h, i) => {
      const rtts = (h.timings ?? []).map(t => t?.rtt).filter(Number.isFinite);
      const avg = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null;
      const timing = h.stats?.avg != null ? ` loss ${h.stats.loss ?? '?'}% avg ${fmt(h.stats.avg)} ms` : avg != null ? ` ${fmt(avg)} ms` : ' (no reply)';
      out.push(`hop ${i + 1}: ${h.resolvedAddress ?? '?'}${h.resolvedHostname ? ` (${h.resolvedHostname})` : ''}${timing}`);
    });
  }
  if (Array.isArray(result?.answers)) {
    for (const a of result.answers) out.push(`${a.type ?? '?'} ${a.data ?? ''}`.trim());
  }
  if (result?.status_code != null || result?.times) {
    const t = result.times ?? {};
    out.push(`status ${result.status_code ?? '?'}${t.connect != null ? `, connect ${fmt(t.connect)} ms, download ${fmt(t.download ?? t.ttfb)} ms` : ''}`);
  }
  if (!out.length) out.push(JSON.stringify({ ...result, rawOutput: undefined }));
  return out;
}

// Format a measurement response as text: a header line plus one block per probe.
export function formatGlobalping(data) {
  const entries = Object.entries(data?.results ?? {});
  if (!entries.length) return 'No probe results (yet).';
  const blocks = entries.map(([i, entry]) => `Probe ${i} — ${probeLabel(entry?.probe)}:\n  ${resultLines(entry?.result).join('\n  ')}`);
  return `${entries.length} probe(s) for ${data?.target ?? '?'} via Globalping:\n${blocks.join('\n\n')}`;
}

export function mount(content) {
  const card = el('div', { className: 'nt-card' });
  card.append(el('h3', { text: 'Global ping / traceroute / mtr / dns / http — via Globalping' }));
  const row = el('div', { className: 'nt-row nt-row-wrap' });
  const type = select('nt-select', 'ping', TYPES.map(t => [t, t]));
  const target = el('input', { className: 'nt-input nt-input-grow', attrs: { type: 'text', placeholder: 'target domain, e.g. example.com' } });
  const magic = el('input', { className: 'nt-input', attrs: { type: 'text', placeholder: 'from: "world" or a place name' } });
  const limit = el('input', { className: 'nt-input nt-limit', attrs: { type: 'number', min: '1', max: '5', value: '3' } });
  const btn = el('button', { className: 'nt-btn', text: 'Run via Globalping' });
  const out = el('pre', { className: 'nt-out' });
  const err = el('div', { className: 'nt-err', attrs: { hidden: 'true' } });
  row.append(type, target, magic, limit, btn);
  card.append(row, out, err, el('p', { className: 'nt-help', text: 'Each test runs from up to "limit" independent probes (worldwide, or matching your place text). The probes see the target and your IP address. Free tier: 250 tests per hour. Results can take up to 60 s to collect.' }));
  const showErr = msg => { out.textContent = ''; err.textContent = msg; err.removeAttribute('hidden'); };
  async function go() {
    let body;
    try { body = buildGlobalpingRequest({ type: type.value, target: target.value, magic: magic.value, limit: limit.value }); }
    catch (e) { showErr(e?.message ?? String(e)); return; }
    btn.disabled = true; err.setAttribute('hidden', 'true');
    out.textContent = `Creating ${body.type} measurement on Globalping…`;
    try {
      const created = await fetchJson(API, { method: 'POST', body, service: 'Globalping' });
      out.textContent = `Globalping measurement ${created.id}: collecting from ${body.limit} probe(s)… (cap 60 s)`;
      const final = await pollGlobalping(`${API}/${created.id}`);
      out.textContent = formatGlobalping(final);
    } catch (e) { showErr(e?.message ?? String(e)); }
    finally { btn.disabled = false; }
  }
  btn.addEventListener('click', go);
  target.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  content.append(card);
}
