// Wires the calculator together: load data, mount controls and the overlay,
// and on every change normalize, evaluate, build the view, draw both charts,
// render the results and sync the URL hash (debounced). Never leaves a blank box.

import { DEFAULT_STATE, normalizeState, toHash, fromHash } from '../state.mjs';
import { evaluate } from '../evaluate.mjs';
import { buildView } from '../view.mjs';
import { monthlyChartSvg, perMtokChartSvg } from '../chart.mjs';
import { loadData } from './load.mjs';
import { mountControls } from './controls.mjs';
import { renderResults } from './results.mjs';
import { mountTips } from './tips.mjs';
import { mountChartHover } from './chart-hover.mjs';
import { mountScaleToggle } from './scale.mjs';
import { buildFacts } from '../tip-facts.mjs';
import { fitState } from '../autofit.mjs';
import { workloadNote } from '../ctx-note.mjs';
import { followModel, linkState } from '../api-follow.mjs';

// The calculator is wider than the page text. CSS cannot see the scrollbar, and
// 100vw includes it, so the page width is measured here and kept in --tk-vw.
function trackViewportWidth(root) {
  const set = () => root.style.setProperty('--tk-vw', document.documentElement.clientWidth + 'px');
  set();
  new ResizeObserver(set).observe(document.documentElement);
}

export async function startCalculator(root) {
  trackViewportWidth(root);
  let data;
  try {
    data = await loadData('/data/tokenomics/');
  } catch (err) {
    const p = document.createElement('p');
    p.className = 'tk-error';
    p.textContent = 'The price and spec data could not be loaded.';
    root.appendChild(p);
    return;
  }
  // The state the form or a link asks for, in range, and a sentence when the
  // context length or a percentage had to be changed to fit.
  const requestFrom = (merged, opts) => {
    const state = normalizeState(merged, data);
    return { state, note: workloadNote(merged, state, data, opts) };
  };
  const first = requestFrom(linkState(fromHash(location.hash), DEFAULT_STATE, data));
  const state0 = first.state;
  const controlsRoot = root.querySelector('#tk-controls') ?? root;
  const captured = root.querySelector('#tk-captured');
  if (captured) captured.textContent = data.meta && data.meta.oldestCapture ? 'Prices and specs captured on ' + data.meta.oldestCapture : '';

  const tips = mountTips(root);
  let latest = null;
  const hovers = ['tk-chart1', 'tk-chart2'].map((id, k) => mountChartHover(root.querySelector('#' + id), k === 1, tips, () => latest));
  // The chart scale switch above the first chart: logarithmic or linear.
  const scaleToggle = mountScaleToggle(root, (scale) => render({ ...lastState, scale }, true));
  // Phones get a squarer chart layout (see chart-scale.mjs); redraw when it flips.
  const phone = window.matchMedia('(max-width: 720px)');
  let lastState = state0;
  let shownNote = null; // the sentence about a changed number, as last drawn
  let hashTimer = null;
  const controls = mountControls(controlsRoot, data, state0, (raw, meta) => {
    // A like-for-like API follows a change of model.
    const next = requestFrom(followModel(lastState, { ...lastState, ...raw }, data), meta);
    // The entry that ends a typed number changes nothing more, but the page has already fixed the other field
    // (a share that no longer fits next to the output): the sentence says so until something really changes.
    const unchanged = JSON.stringify(next.state) === JSON.stringify(lastState);
    render(next.state, true, next.note ?? (unchanged ? shownNote : null));
  });

  // requested is the state the form or the link asked for; it is moved to a
  // machine (or GPU) that can hold the model before anything is computed.
  function render(requested, pushHash, clampNote = null) {
    const fit = fitState(requested, data);
    const state = fit.state;
    lastState = state;
    shownNote = clampNote;
    const result = evaluate(state, data);
    const view = buildView(result, state, data);
    const layout = phone.matches ? 'phone' : 'desktop';
    const charts = {
      monthly: monthlyChartSvg(result, { idPrefix: 'tk1', layout }),
      perMtok: perMtokChartSvg(result, { idPrefix: 'tk2', layout }),
    };
    latest = { result, C: state.C };
    hovers.forEach((h) => h.reset());
    renderResults(root, view, charts);
    tips.setFacts(buildFacts(state, data, result));
    tips.refresh();
    scaleToggle.update(state.scale);
    controls.update({ state, g: result.self && result.self.offered ? result.self.g : null, note: [clampNote, fit.note].filter(Boolean).join(' ') });
    if (pushHash || state !== requested) {
      clearTimeout(hashTimer);
      hashTimer = setTimeout(() => history.replaceState(null, '', '#' + toHash(state)), 150);
    }
  }

  // The reader follows a link to a state (href="#..."): re-render exactly as a
  // form change; skip only the hash write when the hash already says this state.
  window.addEventListener('hashchange', () => {
    const next = requestFrom(linkState(fromHash(location.hash), DEFAULT_STATE, data));
    render(next.state, toHash(next.state) !== location.hash.replace(/^#/, ''), next.note);
  });

  phone.addEventListener('change', () => render(lastState, false));
  render(state0, false, first.note);
}
