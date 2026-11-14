// Crosshair and readout for one chart figure: a pointer (mouse, or a finger
// dragging), or the arrow keys on the focused chart, move a vertical line to
// the nearest parallel-streams value and show what both bills are there. The
// element under the pointer (line, band, marker, axis title) adds its own
// explanation below the readout. The overlay itself is the shared one in tips.mjs.

import { cFromX, inPlot, nearestIndex, stepIndex, pointAt, readoutLines } from '../chart-hover.mjs';
import { LAYOUTS, DESKTOP, domainLayout } from '../chart-scale.mjs';

const GAP = 12;

// getModel() returns the latest { result, C }; the figure's svg is replaced on every render.
export function mountChartHover(figure, perMtok, tips, getModel) {
  let index = null;

  const svg = () => figure.querySelector('svg');
  // The layout the svg was drawn in: its size, its scale and its visible range.
  const layout = () => domainLayout(LAYOUTS[svg()?.dataset.layout] ?? DESKTOP, Number(svg()?.dataset.xmax) || 10000, svg()?.dataset.scale === 'linear' ? 'linear' : 'log');
  const hair = () => svg()?.querySelector('.chart-hair-g') ?? null;
  const set = (node, attrs) => Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));

  function hideHair() {
    index = null;
    hair()?.setAttribute('visibility', 'hidden');
  }

  function moveHair(i) {
    const g = hair();
    if (!g) return false;
    const p = pointAt(getModel().result, perMtok, i, layout());
    set(g.querySelector('.chart-hair'), { x1: p.x, x2: p.x });
    const dot = (cls, y) => {
      const c = g.querySelector(cls);
      if (y === null) c.setAttribute('visibility', 'hidden');
      else { set(c, { cx: p.x, cy: y }); c.removeAttribute('visibility'); }
    };
    dot('.chart-dot-api', p.yApi);
    dot('.chart-dot-self', p.yMid);
    g.setAttribute('visibility', 'visible');
    index = i;
    return true;
  }

  const explain = (target) => {
    const el = target instanceof Element ? target.closest('[data-ctip]') : null;
    return el ? tips.text(el.dataset.ctip) : '';
  };
  const at = (x, y) => ({ left: x + GAP, right: x + GAP, top: y, bottom: y });

  // Where the crosshair is on screen, for keyboard use and for scrolling.
  function hairAnchor() {
    const r = svg().getBoundingClientRect();
    const L = layout();
    const p = pointAt(getModel().result, perMtok, index, L);
    return at(r.left + (p.x * r.width) / L.W, r.top + ((L.MT + L.PH / 2) * r.height) / L.H);
  }

  function showAt(i, anchor, opts, extra) {
    const { result } = getModel();
    if (!moveHair(i)) return;
    const body = readoutLines(result, perMtok, i).join('\n') + (extra ? '\n\n' + extra : '');
    tips.show(figure, body, anchor, { onClose: hideHair, ...opts });
  }

  function onPointer(e) {
    const el = svg();
    if (!el) return;
    const { result } = getModel();
    const r = el.getBoundingClientRect();
    const L = layout();
    const x = ((e.clientX - r.left) * L.W) / r.width;
    const y = ((e.clientY - r.top) * L.H) / r.height;
    const touch = e.pointerType === 'touch';
    const note = explain(e.target);
    if (!result.self.offered || (!touch && !inPlot(x, y, L))) {
      hideHair();
      if (note) tips.show(figure, note, at(e.clientX, e.clientY), { mode: 'hover', onClose: hideHair });
      else tips.hide(figure);
      return;
    }
    showAt(nearestIndex(result.sweep.cs, cFromX(x, L), L.scale), at(e.clientX, e.clientY), { mode: touch ? 'touch' : 'hover' }, note);
  }

  figure.addEventListener('pointermove', onPointer);
  figure.addEventListener('pointerdown', onPointer);
  figure.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch') tips.hide(figure);
  });

  function keyShow(i) {
    index = i;
    showAt(i, hairAnchor(), { mode: 'focus', anchorFn: hairAnchor }, tips.text('chart.hint'));
  }
  // Only a keyboard focus starts the arrow-key readout; a click or tap on the
  // chart is handled by the pointer code above.
  figure.addEventListener('focusin', (e) => {
    const { result, C } = getModel();
    if (e.target === svg() && result.self.offered && e.target.matches(':focus-visible')) keyShow(nearestIndex(result.sweep.cs, C, layout().scale));
  });
  figure.addEventListener('focusout', (e) => {
    if (e.target === svg()) tips.hide(figure);
  });
  figure.addEventListener('keydown', (e) => {
    if (e.target !== svg() || index === null) return;
    // Only the visible sample points are walked; Shift jumps ten at a time.
    const cs = getModel().result.sweep.cs;
    const walk = (dir) => Array.from({ length: e.shiftKey ? 10 : 1 }).reduce((i) => stepIndex(cs, i, dir), index);
    const next = { ArrowLeft: walk(-1), ArrowRight: walk(1), Home: 0, End: cs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    keyShow(next);
  });

  // The page re-rendered: the old svg and its crosshair are gone.
  return { reset() { hideHair(); tips.hide(figure); } };
}
