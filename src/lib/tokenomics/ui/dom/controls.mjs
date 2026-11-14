// Builds the calculator form with plain DOM calls (no innerHTML with data) and
// reports the form state on every input/change; short option sets (shape,
// mode, bits) are radio rows whose label wraps the input. Every label and
// control carries a data-tip key (texts live in tips.mjs). Option lists are
// rebuilt only when they change, so a focused control keeps its focus.

import { apiOptions, modelOptions, bitsOptions, rentProviders, rentMachineOptions, rentTerms, rentOfferIdFor, buyGpus, fieldVisibility } from '../options.mjs';
import { simpleSplitText, MIN_CTX } from '../workload.mjs';
import { C_MIN, C_MAX, posToC, cToPos } from '../streams.mjs';

const TERM_LABELS = { on_demand: 'On demand', '1y': '1-year commitment', '3y': '3-year commitment' };

function el(tag, attrs, text) {
  const node = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs)) node.setAttribute(k, String(val));
  if (text !== undefined) node.textContent = text;
  return node;
}

// Points a node at its overlay text.
function tip(node, key) {
  node.setAttribute('data-tip', key);
  return node;
}

// A group box with its legend; the legend explains the whole group.
function group(title, key) {
  const fs = el('fieldset', {});
  fs.appendChild(tip(el('legend', {}, title), key));
  return fs;
}

// label[for=id] and its control in one wrapper; kind is 'row' (label left,
// control right) or 'stack' (label above). Label and control share one tip.
function field(container, id, labelText, control, key, kind = 'stack') {
  const wrap = el('div', { class: 'tk-field tk-' + kind });
  wrap.append(tip(el('label', { for: id }, labelText), key), tip(control, key));
  container.appendChild(wrap);
  return wrap;
}

// Options on one row; each label wraps its radio so the two sit inline.
// options are [value, text, tipKey]; the row is rebuilt only if its options changed.
function radioRow(row, name, prefix, options) {
  const sig = JSON.stringify(options);
  if (row.dataset.sig === sig) return;
  row.dataset.sig = sig;
  row.replaceChildren(...options.map(([value, text, key]) => {
    const input = tip(el('input', { type: 'radio', name, id: prefix + value, value: String(value) }), key);
    const label = tip(el('label', { for: input.id, class: 'tk-opt' }), key);
    label.append(input, text);
    return label;
  }));
}

function setSelect(select, options, value) {
  const sig = JSON.stringify(options);
  if (select.dataset.sig !== sig) {
    select.dataset.sig = sig;
    select.replaceChildren(...options.map((o) => {
      const opt = el('option', { value: o.value }, o.label);
      if (o.disabled) opt.disabled = true;
      return opt;
    }));
  }
  select.value = value;
}

export function mountControls(root, data, state, onChange) {
  const form = el('form', { id: 'tk-form' }); form.addEventListener('submit', (e) => e.preventDefault());

  // 1. Workload: Simple (one number, fixed split), or Detailed: a custom split or an agent loop
  const fs1 = group('Workload', 'fs.workload');
  const shapeRow = el('div', { class: 'tk-radio-row', role: 'radiogroup', 'aria-label': 'Workload mode' });
  radioRow(shapeRow, 'tk-shape', 'tk-shape-', [['simple', 'Simple', 'shape.simple'], ['detailed', 'Detailed', 'shape.detailed']]);
  fs1.appendChild(shapeRow);
  const detailRow = el('div', { class: 'tk-radio-row', role: 'radiogroup', 'aria-labelledby': 'tk-detail-label' });
  radioRow(detailRow, 'tk-detail', 'tk-detail-', [['split', 'Custom split', 'detail.split'], ['loop', 'Agent loop', 'detail.loop']]);
  const detailBox = el('div', { id: 'tk-detail-box', class: 'tk-field tk-stack' });
  detailBox.append(tip(el('span', { id: 'tk-detail-label', class: 'tk-label' }, 'Shape of each request'), 'detail'), detailRow);
  fs1.appendChild(detailBox);
  const num = (id, extra = {}) => el('input', { type: 'number', id, min: '1', step: '1', ...extra });
  // The context length is one field for Simple and for the custom split, so it keeps its value when the mode changes.
  const ctxInput = num('tk-ctx', { min: String(MIN_CTX), step: '1000' });
  const ctxBox = el('div', { id: 'tk-ctx-box' });
  field(ctxBox, 'tk-ctx', 'Context length per request (tokens)', ctxInput, 'ctx', 'row');
  fs1.appendChild(ctxBox);
  const simpleBox = el('p', { id: 'tk-simple-box', class: 'tk-hint' }, 'Each request is ' + simpleSplitText() + '.');
  fs1.appendChild(simpleBox);
  const splitBox = el('div', { id: 'tk-split-box' });
  const sCached = num('tk-split-cached', { min: '0', max: '100', step: 'any' });
  const sOutput = num('tk-split-output', { min: '0.1', max: '99', step: 'any' });
  const sNew = el('input', { type: 'text', id: 'tk-split-new', readonly: '' });
  field(splitBox, 'tk-split-cached', 'Cached input (% of the context)', sCached, 'split.cached', 'row');
  field(splitBox, 'tk-split-output', 'Output (% of the context)', sOutput, 'split.output', 'row');
  field(splitBox, 'tk-split-new', 'New input, not cached (% of the context)', sNew, 'split.new', 'row');
  fs1.appendChild(splitBox);
  const agentBox = el('div', { id: 'tk-agent-box' });
  const aC0 = num('tk-a-c0'); const aD = num('tk-a-d'); const aO = num('tk-a-o'); const aN = num('tk-a-n');
  const aCaching = el('input', { type: 'checkbox', id: 'tk-a-caching' });
  field(agentBox, 'tk-a-c0', 'Tokens at the start of the task', aC0, 'a.c0', 'row');
  field(agentBox, 'tk-a-d', 'New tokens added each turn', aD, 'a.d', 'row');
  field(agentBox, 'tk-a-o', 'Output tokens each turn', aO, 'a.o', 'row');
  field(agentBox, 'tk-a-n', 'Turns per task', aN, 'a.N', 'row');
  field(agentBox, 'tk-a-caching', 'Prompt caching between turns', aCaching, 'a.caching', 'row');
  fs1.appendChild(agentBox);
  // Fields whose number is typed digit by digit: a note about a value that is too low waits for the finished entry.
  const typedFields = [ctxInput, sCached, sOutput];

  // 2. Traffic
  const fs2 = group('Traffic', 'fs.traffic');
  const cSlider = el('input', { type: 'range', id: 'tk-c-slider', min: '0', max: '1000', step: '1' });
  // C is the average number of requests in flight, so it can be below 1.
  const cNum = num('tk-c', { min: String(C_MIN), max: String(C_MAX), step: 'any' });
  field(fs2, 'tk-c-slider', 'Parallel streams (slider)', cSlider, 'C.slider');
  field(fs2, 'tk-c', 'Parallel streams (average requests in flight)', cNum, 'C', 'row');
  const vIn = num('tk-v'); const hours = num('tk-hours', { max: '24' });
  field(fs2, 'tk-v', 'Speed per stream (tokens per second)', vIn, 'v', 'row');
  field(fs2, 'tk-hours', 'Hours per day under load', hours, 'hours', 'row');

  // 3. API price
  const fs3 = group('API to compare with', 'fs.api');
  const apiSelect = el('select', { id: 'tk-api' });
  field(fs3, 'tk-api', 'API', apiSelect, 'api');

  // 4. Model
  const fs4 = group('Model to host', 'fs.model');
  const modelSelect = el('select', { id: 'tk-model' });
  const bitsRow = el('div', { class: 'tk-radio-row', id: 'tk-bits', role: 'radiogroup', 'aria-labelledby': 'tk-bits-label' });
  const bitsWrap = el('div', { class: 'tk-field tk-stack' });
  bitsWrap.append(tip(el('span', { id: 'tk-bits-label', class: 'tk-label' }, 'Bits per weight'), 'bits'), bitsRow);
  field(fs4, 'tk-model', 'Model', modelSelect, 'model');
  fs4.appendChild(bitsWrap);

  // 5. Self-hosting
  const fs5 = group('Self-hosting', 'fs.self');
  const modeRow = tip(el('div', { class: 'tk-radio-row', role: 'radiogroup', 'aria-label': 'Rent or buy' }), 'mode');
  radioRow(modeRow, 'tk-mode', 'tk-mode-', [['rent', 'Rent GPUs', 'mode.rent'], ['buy', 'Buy servers', 'mode.buy']]);
  fs5.appendChild(modeRow);
  const rentBox = el('div', { id: 'tk-rent-box' });
  const providerSelect = el('select', { id: 'tk-provider' });
  const machineSelect = el('select', { id: 'tk-machine' });
  const termSelect = el('select', { id: 'tk-term' });
  field(rentBox, 'tk-provider', 'Provider', providerSelect, 'provider'); field(rentBox, 'tk-machine', 'Machine', machineSelect, 'machine');
  field(rentBox, 'tk-term', 'Billing term', termSelect, 'term');
  const buyBox = el('div', { id: 'tk-buy-box' });
  const buyGpuSelect = el('select', { id: 'tk-buy-gpu' });
  field(buyBox, 'tk-buy-gpu', 'GPU to buy', buyGpuSelect, 'buyGpu'); fs5.appendChild(rentBox); fs5.appendChild(buyBox);
  // Says when the page moved to a bigger machine so the model fits (see autofit.mjs).
  const fitNote = el('p', { id: 'tk-fit-note', class: 'tk-fit-note', 'aria-live': 'polite' });
  fs5.appendChild(fitNote);

  for (const fs of [fs1, fs2, fs3, fs4, fs5]) form.appendChild(fs);
  root.appendChild(form);

  apiSelect.replaceChildren(...apiOptions(data).map((g) => {
    const og = el('optgroup', { label: g.label });
    og.replaceChildren(...g.items.map((it) => el('option', { value: it.id }, it.note ? it.label + ' (' + it.note + ')' : it.label)));
    return og;
  }));
  const named = (list, idKey, labelKey) => list.map((x) => ({ value: x[idKey], label: x[labelKey] }));
  setSelect(modelSelect, named(modelOptions(data), 'id', 'label'), state.modelId);
  setSelect(buyGpuSelect, named(buyGpus(data), 'id', 'label'), state.buyGpu);
  setSelect(providerSelect, rentProviders(data).map((p) => ({ value: p, label: p })), state.rentProvider);

  function rebuildBits(model) {
    const opts = bitsOptions(model);
    radioRow(bitsRow, 'tk-bits', 'tk-bits-', [[4, opts['4'].label, 'bits.4'], [8, opts['8'].label, 'bits.8'], [16, opts['16'].label, 'bits.16']]);
  }

  // Terms the chosen machine has; the current term is kept when it exists.
  function syncTerm() {
    const keep = termSelect.value;
    const terms = rentTerms(data, providerSelect.value, machineSelect.value);
    setSelect(termSelect, terms.map((t) => ({ value: t, label: TERM_LABELS[t] ?? t })), terms.includes(keep) ? keep : terms[0]);
  }

  function read() {
    const bitsEl = bitsRow.querySelector('input:checked') ?? bitsRow.querySelector('input');
    return {
      shape: shapeRow.querySelector('input[value="detailed"]').checked ? 'detailed' : 'simple',
      detail: detailRow.querySelector('input[value="loop"]').checked ? 'loop' : 'split',
      ctx: Number(ctxInput.value),
      split: { cachedPct: Number(sCached.value), outputPct: Number(sOutput.value) },
      agent: { c0: Number(aC0.value), d: Number(aD.value), o: Number(aO.value), N: Number(aN.value), caching: aCaching.checked },
      C: Number(cNum.value), v: Number(vIn.value), hoursPerDay: Number(hours.value), apiId: apiSelect.value, modelId: modelSelect.value,
      bits: Number(bitsEl.value),
      mode: modeRow.querySelector('input[value="buy"]').checked ? 'buy' : 'rent',
      buyGpu: buyGpuSelect.value, rentProvider: providerSelect.value,
      rentOfferId: rentOfferIdFor(data, providerSelect.value, machineSelect.value, termSelect.value),
    };
  }

  const onEvent = (e) => {
    // A select, radio or checkbox fires input and then change for one choice; react
    // once, so the page does not redraw the same state twice (the second redraw
    // would clear the note that says the machine was changed).
    const typed = e.target.type === 'number' || e.target.type === 'range';
    if (e.type === 'input' && !typed) return;
    if (e.target === cSlider) cNum.value = posToC(cSlider.value);
    else if (e.target === cNum) cSlider.value = cToPos(cNum.value);
    else if (e.target === machineSelect) syncTerm();
    // quiet: a number is still being typed (it may pass through numbers below the floor);
    // the note comes when the entry is finished (the change event).
    onChange(read(), { quiet: e.type === 'input' && typedFields.includes(e.target) });
    // A finished entry shows the number the page used (it may have been capped or rounded).
    if (e.type === 'change' && e.target === ctxInput) ctxInput.value = current.ctx;
    if (e.type === 'change' && e.target === sCached) sCached.value = current.split.cachedPct;
    if (e.type === 'change' && e.target === sOutput) sOutput.value = current.split.outputPct;
    if (e.type === 'change' && e.target === cNum) cNum.value = current.C;
  };
  form.addEventListener('input', onEvent); form.addEventListener('change', onEvent);

  let current = state;
  function update(options) {
    const s = options.state;
    current = s;
    const g = options.g ?? null;
    fitNote.textContent = options.note ?? '';
    shapeRow.querySelectorAll('input').forEach((i) => { i.checked = i.value === s.shape; });
    detailRow.querySelectorAll('input').forEach((i) => { i.checked = i.value === s.detail; });
    const vis = fieldVisibility(s);
    detailBox.hidden = !vis.detail; ctxBox.hidden = !vis.ctx; simpleBox.hidden = !vis.hint;
    splitBox.hidden = !vis.split; agentBox.hidden = !vis.loop;
    // Not while it has the focus: a number typed on the way to 50,000 passes through 5.
    if (document.activeElement !== ctxInput) ctxInput.value = s.ctx;
    if (document.activeElement !== sCached) sCached.value = s.split.cachedPct;
    if (document.activeElement !== sOutput) sOutput.value = s.split.outputPct;
    // A plain number like its two siblings; the label says it is a percentage.
    sNew.value = String(Math.round((100 - s.split.cachedPct - s.split.outputPct) * 10) / 10);
    aC0.value = s.agent.c0; aD.value = s.agent.d; aO.value = s.agent.o; aN.value = s.agent.N;
    aCaching.checked = s.agent.caching === true;
    // Not while they have the focus: 0.05 is typed through 0 and 0.0, and a drag would jump by a step.
    if (document.activeElement !== cNum) cNum.value = s.C;
    if (document.activeElement !== cSlider) cSlider.value = cToPos(s.C);
    vIn.value = s.v; hours.value = s.hoursPerDay;
    apiSelect.value = s.apiId;
    modelSelect.value = s.modelId;
    const model = data.models.find((m) => m.id === s.modelId) ?? data.models[0];
    rebuildBits(model);
    bitsRow.querySelectorAll('input').forEach((i) => { i.checked = Number(i.value) === s.bits; });
    modeRow.querySelectorAll('input').forEach((i) => { i.checked = i.value === s.mode; });
    rentBox.hidden = s.mode !== 'rent'; buyBox.hidden = s.mode !== 'buy';
    buyGpuSelect.value = s.buyGpu;
    providerSelect.value = s.rentProvider;
    const offer = data.rentOffers.find((o) => o.id === s.rentOfferId) ?? data.rentOffers[0];
    setSelect(machineSelect, rentMachineOptions(data, s.rentProvider, g).map((m) => ({
      value: m.instance, label: m.label + (m.disabledReason ? ' (' + m.disabledReason + ')' : ''), disabled: !!m.disabledReason,
    })), offer.instance);
    syncTerm();
    termSelect.value = offer.term;
  }

  update({ state });
  return { read, update };
}
