// The calculator form, mounted on a very small stand-in for the DOM (the repo has
// no browser library): enough to build the form, flip the rent and buy boxes and
// send input and change events. Covers the electricity price field.
// Run: node --test tests/tokenomics-controls.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mountControls } from '../src/lib/tokenomics/ui/dom/controls.mjs';
import { DEFAULT_STATE, normalizeState } from '../src/lib/tokenomics/ui/state.mjs';
import { TIPS } from '../src/lib/tokenomics/ui/tips.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const JR = (f) => JSON.parse(readFileSync(join(here, '../public/data/tokenomics/' + f), 'utf8'));
const real = { models: JR('models.json'), gpus: JR('gpus.json'), apiPrices: JR('api_prices.json'), rentOffers: JR('rent_offers.json'), buyOptions: JR('buy_options.json') };

// One node type. Selectors: '#id', 'input', 'input[value="x"]', 'input:checked'.
class FakeNode {
  constructor(tag) {
    this.tag = tag; this.attrs = {}; this.children = []; this.parent = null; this.dataset = {};
    this.hidden = false; this.val = ''; this.checked = false; this.text = ''; this.listeners = {};
  }
  get value() { return this.val; }
  set value(v) { this.val = String(v); } // like a real input: always text
  get id() { return this.attrs.id ?? ''; }
  get type() { return this.attrs.type; }
  set textContent(t) { this.text = String(t); }
  get textContent() { return this.text; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); }
  appendChild(n) { n.parent = this; this.children.push(n); return n; }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? Object.assign(new FakeNode('#text'), { text: n }) : n); }
  replaceChildren(...ns) { this.children = []; this.append(...ns); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, target) { for (const fn of this.listeners[type] ?? []) fn({ type, target }); }
  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  matches(sel) {
    if (sel[0] === '#') return this.id === sel.slice(1);
    const m = /^(\w+)(?:\[value="([^"]*)"\]|(:checked))?$/.exec(sel);
    if (!m || this.tag !== m[1]) return false;
    return m[2] !== undefined ? this.attrs.value === m[2] : m[3] ? this.checked : true;
  }
  querySelectorAll(sel) { return this.descendants().filter((n) => n.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  isHidden() { return this.hidden || (this.parent ? this.parent.isHidden() : false); }
  ancestor(pred) { for (let n = this.parent; n; n = n.parent) if (pred(n)) return n; return null; }
}

function mount(initial) {
  globalThis.document = { createElement: (tag) => new FakeNode(tag), activeElement: null };
  const root = new FakeNode('div');
  const calls = [];
  let last = initial;
  const render = (raw) => { last = normalizeState({ ...last, ...raw }, real); controls.update({ state: last }); };
  const controls = mountControls(root, real, initial, (raw) => { calls.push(raw); render(raw); });
  return { root, controls, calls, energy: root.querySelector('#tk-energy'), form: root.querySelector('form'), update: (state) => { last = state; controls.update({ state }); } };
}

const stateOf = (extra) => normalizeState({ ...DEFAULT_STATE, ...extra }, real);

test('controls: the electricity price field is a number input in the Self-hosting box with a label and an overlay', () => {
  const { root, energy } = mount(stateOf({}));
  assert.ok(energy, 'input #tk-energy exists');
  assert.equal(energy.tag, 'input');
  assert.equal(energy.type, 'number');
  assert.deepEqual({ min: energy.attrs.min, max: energy.attrs.max, step: energy.attrs.step }, { min: '0', max: '1', step: '0.01' });
  const label = root.querySelector('form').querySelectorAll('label').find((l) => l.attrs.for === 'tk-energy');
  assert.equal(label.text, 'Electricity price (USD per kWh)');
  assert.equal(energy.attrs['data-tip'], 'energy', 'the control has an overlay key');
  assert.equal(label.attrs['data-tip'], 'energy', 'and so has its label');
  assert.ok(TIPS.energy && TIPS.energy.length > 100, 'the overlay text exists');
  const fieldset = energy.ancestor((n) => n.tag === 'fieldset');
  assert.equal(fieldset.children[0].text, 'Self-hosting');
  assert.ok(energy.ancestor((n) => n.id === 'tk-buy-box'), 'it sits inside the buy box');
  assert.ok(!energy.ancestor((n) => n.id === 'tk-rent-box'));
  assert.equal(energy.parent.attrs.class, 'tk-field tk-row', 'same field helper and layout as the other numeric rows');
});

test('controls: the field is hidden in rent mode and visible in buy mode', () => {
  const m = mount(stateOf({ mode: 'rent' }));
  assert.equal(m.energy.isHidden(), true, 'rent: hidden');
  m.update(stateOf({ mode: 'buy' }));
  assert.equal(m.energy.isHidden(), false, 'buy: visible');
  m.update(stateOf({ mode: 'rent' }));
  assert.equal(m.energy.isHidden(), true, 'back to rent: hidden again');
  assert.equal(mount(stateOf({ mode: 'buy' })).energy.isHidden(), false, 'a link that opens on buy shows it at once');
});

test('controls: the field shows the state price and the form reports what was typed', () => {
  const m = mount(stateOf({ mode: 'buy', energyUsdPerKwh: 0.3 }));
  assert.equal(m.energy.value, '0.3');
  assert.equal(m.controls.read().energyUsdPerKwh, 0.3);
  m.energy.value = '0.22';
  m.form.fire('input', m.energy);
  assert.equal(m.calls.at(-1).energyUsdPerKwh, 0.22, 'the page hears the number as it is typed');
  m.update(stateOf({ mode: 'buy', energyUsdPerKwh: 0.07 }));
  assert.equal(m.energy.value, '0.07', 'a new state is written into the field');
  assert.equal(mount(stateOf({ mode: 'buy' })).energy.value, String(DEFAULT_STATE.energyUsdPerKwh), 'the default opens on the data price');
});

test('controls: an empty field means the default price, not free power', () => {
  const m = mount(stateOf({ mode: 'buy', energyUsdPerKwh: 0.3 }));
  m.energy.value = '';
  assert.ok(Number.isNaN(m.controls.read().energyUsdPerKwh));
  assert.equal(normalizeState({ ...DEFAULT_STATE, ...m.controls.read() }, real).energyUsdPerKwh, DEFAULT_STATE.energyUsdPerKwh);
});

test('controls: a finished entry shows the number the page used, and a number being typed is left alone', () => {
  const m = mount(stateOf({ mode: 'buy' }));
  document.activeElement = m.energy;
  m.energy.value = '0.1234';
  m.form.fire('input', m.energy);
  assert.equal(m.energy.value, '0.1234', 'not rewritten while it has the focus');
  m.form.fire('change', m.energy);
  assert.equal(m.energy.value, '0.123', 'rounded to 3 decimals when the entry is finished');
  m.energy.value = '5';
  m.form.fire('input', m.energy); m.form.fire('change', m.energy);
  assert.equal(m.energy.value, '1', 'capped at 1');
  m.energy.value = '-2';
  m.form.fire('input', m.energy); m.form.fire('change', m.energy);
  assert.equal(m.energy.value, '0', 'raised to 0');
  document.activeElement = null;
});
