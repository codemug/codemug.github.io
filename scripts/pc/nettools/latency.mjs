// Latency tab — N timed fetches (mode: 'no-cors') to a user-given https URL, reporting
// min/avg/max. Clearly labelled as HTTP round-trip timing, not ICMP ping. Click-only;
// the button and the result name the receiving host. Exports summarizeLatency (pure,
// tested) + mount.
import { el } from './ui.mjs';
import { validateUrl } from './net.mjs';

const r1 = x => Math.round(x * 10) / 10;

// min/avg/max (one decimal) over the completed samples; throws when none completed.
export function summarizeLatency(samples) {
  const xs = samples.filter(Number.isFinite);
  if (!xs.length) throw new Error('No completed round-trips to report.');
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return { n: xs.length, min: r1(min), avg: r1(xs.reduce((a, b) => a + b, 0) / xs.length), max: r1(max) };
}

async function timeOne(url) {
  const t0 = performance.now();
  // no-cors: the response is opaque (status unreadable); a settled promise means the
  // round-trip completed. Same WebPC policy flags as the other tabs; no-store so a cached
  // copy never short-circuits the timing.
  await fetch(url, { mode: 'no-cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000) });
  return performance.now() - t0;
}

export function mount(content) {
  const card = el('div', { className: 'nt-card' });
  card.append(el('h3', { text: 'Latency — HTTP round-trip timing, not ICMP ping' }));
  const row = el('div', { className: 'nt-row' });
  const input = el('input', { className: 'nt-input nt-input-grow', attrs: { type: 'text', placeholder: 'https URL, e.g. https://example.com/' } });
  const n = el('input', { className: 'nt-input nt-limit', attrs: { type: 'number', min: '1', max: '10', value: '3' } });
  const btn = el('button', { className: 'nt-btn', text: 'Measure (enter an https URL)' });
  const out = el('pre', { className: 'nt-out' });
  const err = el('div', { className: 'nt-err', attrs: { hidden: 'true' } });
  row.append(input, n, btn);
  const showErr = msg => { out.textContent = ''; err.textContent = msg; err.removeAttribute('hidden'); };
  function syncBtn() {
    const c = validateUrl(input.value);
    btn.textContent = c.ok ? `Measure via ${new URL(c.value).host}` : 'Measure (enter an https URL)';
  }
  input.addEventListener('input', syncBtn);
  async function go() {
    const c = validateUrl(input.value);
    if (!c.ok) { showErr(c.error); return; }
    const count = Number(n.value);
    if (!Number.isInteger(count) || count < 1 || count > 10) { showErr('Count must be a whole number from 1 to 10.'); return; }
    const host = new URL(c.value).host;
    btn.disabled = true; err.setAttribute('hidden', 'true');
    out.textContent = `Measuring ${count} HTTP round-trip(s) via ${host}…`;
    try {
      const settled = await Promise.allSettled(Array.from({ length: count }, () => timeOne(c.value)));
      const ok = settled.filter(s => s.status === 'fulfilled').map(s => s.value);
      const failed = count - ok.length;
      if (!ok.length) throw new Error(`All ${count} round-trip(s) to ${host} failed (network error, or the origin rejected the cross-origin probe).`);
      const s = summarizeLatency(ok);
      out.textContent =
        `${s.n} HTTP round-trip(s) to ${c.value} (via ${host}, mode: no-cors):\n` +
        `min ${s.min} ms · avg ${s.avg} ms · max ${s.max} ms` +
        (failed ? `\n(${failed} of ${count} failed and were excluded)` : '') +
        '\n\nThis measures HTTP round-trip time from this browser — not ICMP ping.';
    } catch (e) { showErr(e?.message ?? String(e)); }
    finally { btn.disabled = false; }
  }
  btn.addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  content.append(card);
}
