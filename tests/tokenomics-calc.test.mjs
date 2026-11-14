// Golden tests for the tokenomics calculation module: every case of
// tests/fixtures/tokenomics/golden.json (made by scripts/tokenomics/reference/calc_ref.py) must
// reproduce field for field, plus small boundary-validation tests the
// golden file does not cover. Run: node --test tests/tokenomics-calc.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as calc from '../src/lib/tokenomics/calc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, 'fixtures/tokenomics/fixtures.json'), 'utf8'));
const golden = JSON.parse(readFileSync(join(here, 'fixtures/tokenomics/golden.json'), 'utf8'));

const models = Object.fromEntries(fx.models.map((m) => [m.id, m]));
const gpus = Object.fromEntries(fx.gpus.map((g) => [g.id, g]));

// Relative tolerance 1e-9, absolute 1e-12 near zero; null equals null;
// booleans and strings exactly; arrays element by element.
function deepClose(actual, expected, at) {
  if (expected === null) {
    assert.equal(actual, null, at + ' must be null, got ' + JSON.stringify(actual));
    return;
  }
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', at + ' must be a number, got ' + JSON.stringify(actual));
    const tol = Math.max(1e-12, Math.abs(expected) * 1e-9);
    assert.ok(Math.abs(actual - expected) <= tol, at + ': ' + actual + ' != ' + expected);
    return;
  }
  if (typeof expected === 'boolean' || typeof expected === 'string') {
    assert.equal(actual, expected, at + ' must be exactly ' + JSON.stringify(expected));
    return;
  }
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, at + ' must have ' + expected.length + ' entries');
    expected.forEach((e, i) => deepClose(actual[i], e, at + '[' + i + ']'));
    return;
  }
  for (const [k, e] of Object.entries(expected)) deepClose(actual[k], e, at + '.' + k);
}

function runSweep(args) {
  const inp = {
    model: models[args.model],
    gpu: gpus[args.gpu],
    bits: args.bits,
    isl: args.isl,
    osl: args.osl,
    v: args.v,
    cachedShare: args.cachedShare,
    ctx: args.ctx,
    mtp: false,
    ttftS: args.ttftS,
    hoursPerDay: args.hoursPerDay,
    price: fx.prices[args.price],
    // the reference rents the named offer 24 h/day on the self-hosted side
    costFn: (dep) => calc.rentMonthly({ deployment: dep, offer: fx.offers[args.offer], hoursPerDay: 24 }).usdPerMonth,
  };
  const sw = calc.sweep(inp, args.cs);
  return { sweep: sw, crossover: calc.crossover(sw, args.cs) };
}

function runCase(kind, args) {
  switch (kind) {
    case 'stepModel':
      return calc.stepModel(models[args.model], args.bits, gpus[args.gpu], args.g, args.isl, args.osl, args.conc, args.opts);
    case 'minGpus':
      return { g: calc.minGpus(models[args.model], args.bits, gpus[args.gpu], args.ctx) };
    case 'sizeDeployment':
      return calc.sizeDeployment({ ...args, model: models[args.model], gpu: gpus[args.gpu] });
    case 'apiCostPerRequest':
      return { usd: calc.apiCostPerRequest(fx.prices[args.price], args.isl, args.osl, args.cachedShare) };
    case 'apiMonthly':
      return calc.apiMonthly({
        price: fx.prices[args.price],
        C: args.C,
        isl: args.isl,
        osl: args.osl,
        cachedShare: args.cachedShare,
        v: args.v,
        ttftS: args.ttftS,
        hoursPerDay: args.hoursPerDay,
      });
    case 'rentMonthly':
      return calc.rentMonthly({ deployment: args.deployment, offer: fx.offers[args.offer], hoursPerDay: args.hoursPerDay });
    case 'buyMonthly':
      return calc.buyMonthly({
        deployment: args.deployment,
        server: fx.servers[args.server],
        defaults: { ...fx.buyDefaults, ...(args.defaults ?? {}) },
      });
    case 'agentLoop':
      return calc.agentLoop(args);
    case 'sweep+crossover':
      return runSweep(args);
    default:
      throw new Error('unknown golden kind ' + kind);
  }
}

const byKind = {};
for (const c of golden.cases) (byKind[c.kind] ??= []).push(c);

for (const [kind, cases] of Object.entries(byKind)) {
  test('golden ' + kind + ' (' + cases.length + ' cases)', () => {
    for (const c of cases) deepClose(runCase(kind, c.args), c.result, kind);
  });
}

const dep = { model: models['qwen3.8-27b'], bits: 8, gpu: gpus['h100'], C: 100, isl: 4000, osl: 500, v: 30, cachedShare: 0, ctx: 32768, mtp: false, tf: 1 };

test('validation: unknown bits throws naming bits', () => {
  assert.throws(() => calc.stepModel(models['qwen3.8-27b'], 32, gpus['h100'], 1, 1000, 500, 1), /bits/);
  assert.throws(() => calc.minGpus(models['qwen3.8-27b'], 2, gpus['h100'], 8192), /bits/);
});

test('validation: missing checkpoint throws naming the checkpoint', () => {
  const m = { ...models['qwen3.8-27b'], checkpoints: { '8': models['qwen3.8-27b'].checkpoints['8'] } };
  assert.throws(() => calc.stepModel(m, 4, gpus['h100'], 1, 1000, 500, 1), /checkpoint/);
});

test('validation: non-positive isl, osl, v and C throw naming the argument', () => {
  assert.throws(() => calc.stepModel(models['qwen3.8-27b'], 4, gpus['h100'], 1, 0, 500, 1), /isl/);
  assert.throws(() => calc.stepModel(models['qwen3.8-27b'], 4, gpus['h100'], 1, 1000, -5, 1), /osl/);
  assert.throws(() => calc.sizeDeployment({ ...dep, v: 0 }), /v/);
  assert.throws(() => calc.sizeDeployment({ ...dep, C: -1 }), /C/);
});

test('rent and buy refuse replicas that do not fit the machine', () => {
  const r = calc.rentMonthly({ deployment: { g: 8, replicas: 1 }, offer: fx.offers.rtx1, hoursPerDay: 12 });
  assert.equal(r.offered, false);
  assert.equal(r.reason, 'replica needs more GPUs than the machine has');
  const b = calc.buyMonthly({ deployment: { g: 8, replicas: 1 }, server: fx.servers.rtx4, defaults: fx.buyDefaults });
  assert.equal(b.offered, false);
  assert.equal(b.reason, 'replica needs more GPUs than the server has');
});
