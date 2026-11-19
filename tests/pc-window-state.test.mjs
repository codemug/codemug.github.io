import test from 'node:test';
import assert from 'node:assert/strict';
import { clampRect, initialRect, reduceDesktop, windowRect } from '../src/scripts/pc/window-state.mjs';
const bounds = { width: 1280, height: 700 };
const app = { width: 1000, height: 600 };
const empty = () => ({ windows: [], activeId: null });
const act = (state, type, id = 'sheets', extra = {}, size = bounds) => reduceDesktop(state, { type, id, app, ...extra }, size);

test('geometry stays visible at desktop, mobile, and short viewport sizes', () => {
  for (const size of [bounds, { width: 320, height: 240 }, { width: 768, height: 500 }]) {
    for (const rect of [initialRect(app, size, 10), clampRect({ x: -400, y: 900, width: 5000, height: 1 }, size)]) {
      assert.ok(rect.x >= 0 && rect.y >= 0);
      assert.ok(rect.width > 0 && rect.height > 0);
      assert.ok(rect.x + rect.width <= size.width);
      assert.ok(rect.y + rect.height <= size.height);
    }
  }
});
test('open is single-instance; minimize and restore preserve geometry', () => {
  let state = act(empty(), 'open');
  state = act(state, 'rect', 'sheets', { rect: { x: 30, y: 40, width: 650, height: 420 } });
  const rect = state.windows[0].rect;
  state = act(state, 'open');
  assert.equal(state.windows.length, 1);
  state = act(state, 'minimize');
  assert.equal(state.activeId, null);
  assert.equal(state.windows[0].minimized, true);
  state = act(state, 'focus');
  assert.equal(state.activeId, 'sheets');
  assert.deepEqual(state.windows[0].rect, rect);
});
test('focus reorders windows; close selects the next visible one', () => {
  let state = act(empty(), 'open');
  state = act(state, 'open', 'about');
  state = act(state, 'focus', 'sheets');
  assert.deepEqual(state.windows.map(w => w.id), ['about', 'sheets']);
  state = act(state, 'close');
  assert.equal(state.activeId, 'about');
  state = act(state, 'minimize', 'about');
  state = act(state, 'open');
  state = act(state, 'close');
  assert.equal(state.activeId, null);
});
test('maximize restores original geometry and mobile does not overwrite it', () => {
  let state = act(empty(), 'open');
  const normal = state.windows[0].rect;
  state = act(state, 'maximize');
  assert.deepEqual(windowRect(state.windows[0], bounds), { x: 0, y: 0, ...bounds });
  state = act(state, 'maximize');
  assert.deepEqual(windowRect(state.windows[0], bounds), normal);
  const mobile = { width: 375, height: 600 };
  state = act(state, 'bounds', null, {}, mobile);
  assert.deepEqual(windowRect(state.windows[0], mobile), { x: 0, y: 0, ...mobile });
  assert.deepEqual(state.windows[0].rect, normal);
});
