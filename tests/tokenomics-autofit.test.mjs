// autofit.mjs: the rented machine or bought GPU follows the model, so that
// self-hosting stays offered whenever it can be. Real data files, no browser.
// Run: node --test tests/tokenomics-autofit.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fitState } from '../src/lib/tokenomics/ui/autofit.mjs';
import { evaluate } from '../src/lib/tokenomics/ui/evaluate.mjs';
import { DEFAULT_STATE, normalizeState } from '../src/lib/tokenomics/ui/state.mjs';
import * as calc from '../src/lib/tokenomics/calc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rd = (f) => JSON.parse(readFileSync(join(here, '../public/data/tokenomics/' + f), 'utf8'));
const data = { models: rd('models.json'), gpus: rd('gpus.json'), apiPrices: rd('api_prices.json'), rentOffers: rd('rent_offers.json'), buyOptions: rd('buy_options.json'), meta: rd('meta.json') };
const norm = (s, d = data) => normalizeState({ ...DEFAULT_STATE, ...s }, d);
const modelOf = (id) => data.models.find((m) => m.id === id);
const gpuOf = (id) => data.gpus.find((g) => g.id === id);
const offerOf = (id, d = data) => d.rentOffers.find((o) => o.id === id);
const needs = (s, gpuId) => calc.minGpus(modelOf(s.modelId), s.bits, gpuOf(gpuId), s.ctx);

test('rent: Qwen3.8 Flash Next at 4 bits on AWS g7e.2xlarge moves to g7e.12xlarge, with a note', () => {
  const s = norm({ modelId: 'qwen3.8-flash-next' });
  assert.equal(s.rentOfferId, 'AWS:g7e.2xlarge:on_demand');
  assert.equal(evaluate(s, data).self.offered, false, 'without the fit, self-hosting drops out');
  const copy = JSON.stringify(s);
  const fit = fitState(s, data);
  assert.equal(JSON.stringify(s), copy, 'the input state is not changed');
  assert.equal(fit.state.rentOfferId, 'AWS:g7e.12xlarge:on_demand');
  assert.equal(fit.state.rentProvider, 'AWS');
  assert.equal(fit.note, 'Switched to g7e.12xlarge (2 GPUs) because Qwen3.8 Flash Next at 4 bits needs 2 GPUs per replica.');
  assert.deepEqual({ ...fit.state, rentOfferId: s.rentOfferId }, s, 'nothing else changed');
  const res = evaluate(fit.state, data);
  assert.equal(res.self.offered, true);
  assert.equal(res.self.g, 2);
  assert.equal(res.sweep.selfMid.every((v) => v !== null), true, 'the self-hosting line is on the charts');
});

test('rent: the default state is left alone', () => {
  const s = norm({});
  const fit = fitState(s, data);
  assert.equal(fit.state, s, 'the same object');
  assert.equal(fit.note, null);
  assert.equal(evaluate(s, data).self.offered, true);
});

test('rent: the term is kept when the bigger machine has it, else on demand, else its first term', () => {
  const s1 = norm({ modelId: 'qwen3.8-flash-next', rentOfferId: 'AWS:g7e.2xlarge:3y' });
  assert.equal(fitState(s1, data).state.rentOfferId, 'AWS:g7e.12xlarge:3y');
  const without = (drop) => ({ ...data, rentOffers: data.rentOffers.filter((o) => !drop.includes(o.id)) });
  const noThreeYear = without(['AWS:g7e.12xlarge:3y']);
  assert.equal(fitState(norm({ modelId: 'qwen3.8-flash-next', rentOfferId: 'AWS:g7e.2xlarge:3y' }, noThreeYear), noThreeYear).state.rentOfferId, 'AWS:g7e.12xlarge:on_demand');
  const onlyOneYear = without(['AWS:g7e.12xlarge:3y', 'AWS:g7e.12xlarge:on_demand']);
  assert.equal(fitState(norm({ modelId: 'qwen3.8-flash-next', rentOfferId: 'AWS:g7e.2xlarge:3y' }, onlyOneYear), onlyOneYear).state.rentOfferId, 'AWS:g7e.12xlarge:1y');
});

test('rent: the smallest machine of the same GPU type that holds the model', () => {
  const s = norm({ modelId: 'qwen3.8-flash-next', bits: 16 });
  assert.equal(needs(s, 'rtx6000pro'), 8);
  const fit = fitState(s, data);
  assert.equal(fit.state.rentOfferId, 'AWS:g7e.48xlarge:on_demand');
  assert.match(fit.note, /^Switched to g7e\.48xlarge \(8 GPUs\) because Qwen3\.8 Flash Next at 16 bits needs 8 GPUs per replica\.$/);
  // Only one GPU type holds it: the cheapest machine of the provider whose own GPU type fits.
  const k = norm({ modelId: 'kimi-k3.1-pro', bits: 4 });
  const kf = fitState(k, data);
  assert.equal(kf.state.rentOfferId, 'AWS:p6-b300.48xlarge:on_demand');
  assert.equal(kf.note, 'Switched to p6-b300.48xlarge (8 GPUs) because Kimi K3.1 Pro at 4 bits does not fit on RTX PRO 6000 Blackwell Server Edition.');
  assert.equal(evaluate(kf.state, data).self.offered, true);
});

test('rent: a combination that fits nowhere on the provider is left as it is, with no note', () => {
  const s = norm({ modelId: 'kimi-k3.1-pro', bits: 16 });
  const fit = fitState(s, data);
  assert.equal(fit.state, s);
  assert.equal(fit.note, null);
  const res = evaluate(fit.state, data);
  assert.equal(res.self.offered, false);
  assert.deepEqual(res.errors, []);
});

test('rent: a changed context window moves the machine exactly when more GPUs are needed', () => {
  for (const ctx of [4096, 8192, 32768, 131072, 262144]) {
    const s = norm({ modelId: 'qwen3.8-flash-next', ctx });
    const g = needs(s, 'rtx6000pro');
    const fit = fitState(s, data);
    const have = offerOf(s.rentOfferId).gpuCount;
    if (g <= have) { assert.equal(fit.state, s, 'ctx ' + ctx + ' fits'); assert.equal(fit.note, null); continue; }
    const got = offerOf(fit.state.rentOfferId);
    assert.ok(got.gpuCount >= g && got.provider === 'AWS' && got.gpu === 'rtx6000pro', 'ctx ' + ctx);
    const smaller = data.rentOffers.filter((o) => o.provider === 'AWS' && o.gpu === 'rtx6000pro' && o.gpuCount >= g).map((o) => o.gpuCount);
    assert.equal(got.gpuCount, Math.min(...smaller), 'the smallest that fits');
    assert.ok(fit.note.includes('needs ' + g + ' GPU'));
  }
});

test('buy: moves to the next GPU that is offered, in the order rtx6000pro, b200, b300', () => {
  const d = norm({ modelId: 'deepseek-v4.1-flash', bits: 8, mode: 'buy', buyGpu: 'rtx6000pro' });
  assert.equal(evaluate(d, data).self.offered, false);
  const fd = fitState(d, data);
  assert.equal(fd.state.buyGpu, 'b200');
  assert.equal(fd.note, 'Switched to B200 (HGX) servers because DeepSeek V4.1 Flash at 8 bits does not fit on RTX PRO 6000 Blackwell Server Edition servers.');
  assert.equal(evaluate(fd.state, data).self.offered, true);
  // Kimi at 4 bits needs a B300: b200 is skipped.
  const k = norm({ modelId: 'kimi-k3.1-pro', bits: 4, mode: 'buy', buyGpu: 'rtx6000pro' });
  assert.equal(fitState(k, data).state.buyGpu, 'b300');
  // From b200 the next is b300; from b300 there is no wrapping.
  assert.equal(fitState({ ...k, buyGpu: 'b200' }, data).state.buyGpu, 'b300');
  const none = norm({ modelId: 'kimi-k3.1-pro', bits: 16, mode: 'buy', buyGpu: 'rtx6000pro' });
  assert.equal(fitState(none, data).state, none);
  assert.equal(fitState(none, data).note, null);
  assert.equal(fitState({ ...k, bits: 8, buyGpu: 'b300' }, data).note, null);
  // A choice that already fits is untouched.
  const ok = norm({ mode: 'buy', buyGpu: 'b200' });
  assert.equal(fitState(ok, data).state, ok);
});

test('fit is idempotent, never loops, and leaves self-hosting offered wherever it can be', () => {
  const instances = new Map();
  for (const o of data.rentOffers) if (!instances.has(o.provider + o.instance) && o.term === 'on_demand') instances.set(o.provider + o.instance, o);
  let changed = 0;
  let offeredAfter = 0;
  for (const model of data.models) {
    for (const bits of [4, 8, 16]) {
      if (!model.checkpoints[String(bits)]) continue;
      for (const ctx of [8192, 262144]) {
        const base = norm({ modelId: model.id, bits, ctx });
        for (const offer of instances.values()) {
          const s = normalizeState({ ...base, rentProvider: offer.provider, rentOfferId: offer.id }, data);
          const fit = fitState(s, data);
          const again = fitState(fit.state, data);
          assert.equal(again.state, fit.state, 'idempotent ' + model.id + '/' + bits + '/' + offer.id);
          assert.equal(again.note, null);
          if (fit.note === null) { assert.equal(fit.state, s); continue; }
          changed += 1;
          const got = offerOf(fit.state.rentOfferId);
          assert.equal(got.provider, offer.provider, 'stays on the provider');
          assert.ok(got.gpuCount >= calc.minGpus(model, bits, gpuOf(got.gpu), fit.state.ctx), 'the new machine holds one replica');
          assert.ok(fit.note.startsWith('Switched to ' + got.instance + ' (') && fit.note.endsWith('.'));
        }
        // Buy mode, every GPU.
        for (const buyGpu of ['rtx6000pro', 'b200', 'b300']) {
          const s = norm({ modelId: model.id, bits, ctx, mode: 'buy', buyGpu });
          const fit = fitState(s, data);
          const again = fitState(fit.state, data);
          assert.equal(again.state, fit.state);
          assert.equal(again.note, null);
          if (fit.note !== null) { changed += 1; assert.equal(evaluate(fit.state, data).self.offered, true, 'buy ' + model.id + '/' + bits + ' to ' + fit.state.buyGpu); offeredAfter += 1; }
        }
      }
    }
  }
  assert.ok(changed > 100, 'the fit moved many combinations: ' + changed);
  assert.ok(offeredAfter > 0);
  // Whenever the fit changed a rent state, self-hosting is offered afterwards.
  for (const [id, bits] of [['qwen3.8-flash-next', 4], ['qwen3.8-flash-next', 16], ['deepseek-v4.1-flash', 4], ['muse-spark-open', 4], ['nemotron-3.5-super-vl', 16], ['kimi-k3.1-pro', 4]]) {
    const fit = fitState(norm({ modelId: id, bits }), data);
    assert.equal(evaluate(fit.state, data).self.offered, true, id + ' at ' + bits + ' bits');
  }
});

test('fit: the agent loop reserves the largest context the loop reaches, capped at the window', () => {
  const loop = { c0: 60000, d: 5000, o: 1000, N: 50, caching: true };
  const s = norm({ shape: 'detailed', detail: 'loop', modelId: 'qwen3.8-flash-next', ctx: 4096, agent: loop });
  const fit = fitState(s, data);
  // The loop reaches 60,000 + 49 x 6,000 + 1,000 = 355,000; the model window caps it at 262,144 (ctx is not used by the loop).
  const w = calc.agentLoop(loop);
  const reserved = Math.min(modelOf(s.modelId).contextMax, 60000 + 49 * 6000 + 1000);
  assert.equal(reserved, 262144);
  const need = calc.minGpus(modelOf(s.modelId), s.bits, gpuOf('rtx6000pro'), Math.max(reserved, Math.round(w.isl + w.osl)));
  assert.ok(offerOf(fit.state.rentOfferId).gpuCount >= need);
  assert.equal(evaluate(fit.state, data).self.offered, true);
  assert.equal(evaluate(fit.state, data).workload.reserved, reserved);
  // A short loop reserves only what it reaches, so a smaller machine can do.
  const short = norm({ shape: 'detailed', detail: 'loop', modelId: 'qwen3.8-flash-next', agent: { c0: 2000, d: 500, o: 100, N: 3, caching: false } });
  const sf = fitState(short, data);
  assert.equal(evaluate(sf.state, data).workload.reserved, 2000 + 2 * 600 + 100);
  assert.equal(evaluate(sf.state, data).self.offered, true);
});

test('fit: Simple mode and the custom split reserve the context length itself', () => {
  for (const patch of [{}, { shape: 'detailed', split: { cachedPct: 20, outputPct: 30 } }]) for (const ctx of [2000, 32768, 262144]) {
    const s = norm({ modelId: 'qwen3.8-flash-next', ctx, ...patch });
    const fit = fitState(s, data);
    const res = evaluate(fit.state, data);
    assert.equal(res.workload.reserved, ctx);
    assert.equal(res.self.offered, true, 'ctx ' + ctx);
    assert.equal(fitState(fit.state, data).note, null);
  }
});
