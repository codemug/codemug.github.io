// One shared overlay (role="tooltip") for the whole calculator. It opens on
// hover, on keyboard focus and on a tap, and closes on mouse leave, blur,
// Escape or a tap elsewhere. It is position: fixed, so it never moves the
// layout, and it never takes focus. Texts come from tips.mjs by data-tip key.

import { placeTip, placeRight } from '../tip-place.mjs';
import { tipText } from '../tips.mjs';

const TIP_ID = 'tk-tip';
const BIG_WIDTH = 360;
const BIG_HEIGHT = 140;

export function mountTips(root) {
  const tip = document.createElement('div');
  tip.id = TIP_ID;
  tip.className = 'tk-tip';
  tip.setAttribute('role', 'tooltip');
  tip.dataset.open = 'false';
  document.body.appendChild(tip);

  let facts = {};
  let current = null; // { owner, mode, onClose, anchorFn }
  let lastPointer = { type: 'mouse', at: -1e9 };

  const text = (key) => tipText(key, facts);
  const textFor = (el) => text(el.dataset.tip) + (el.dataset.tipBasis ? ' Basis: ' + text(el.dataset.tipBasis) : '');
  const targetOf = (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    return el && root.contains(el) ? el : null;
  };
  // The page is one column at 1000px and below (see calculator.css).
  const narrow = window.matchMedia('(max-width: 1000px)');
  const pointAnchor = (e) => ({ left: e.clientX + 10, right: e.clientX + 10, top: e.clientY, bottom: e.clientY });
  // Small things get the overlay beside them; big ones get it at the pointer.
  // A control of the form, on a wide page, gets it to the right of the whole form
  // (over the results), so it never covers the field that comes next.
  const anchorOf = (el, e) => {
    const r = el.getBoundingClientRect();
    const form = el.closest('.tk-side');
    if (form && !narrow.matches) return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, container: form.getBoundingClientRect() };
    return e && (r.width > BIG_WIDTH || r.height > BIG_HEIGHT) ? pointAnchor(e) : r;
  };

  function place(anchor) {
    const args = {
      anchor,
      tip: { width: tip.offsetWidth, height: tip.offsetHeight },
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
    };
    const pos = (anchor.container && placeRight({ ...args, container: anchor.container })) || placeTip(args);
    tip.style.left = pos.left + 'px';
    tip.style.top = pos.top + 'px';
    tip.dataset.side = pos.side;
  }

  function close() {
    if (!current) return;
    const { owner, onClose } = current;
    current = null;
    tip.dataset.open = 'false';
    owner.removeAttribute('aria-describedby');
    if (onClose) onClose();
  }

  // opts: mode 'hover' | 'focus' | 'touch'; onClose(); anchorFn() for repositioning.
  function show(owner, content, anchor, opts = {}) {
    if (current && current.owner !== owner) close();
    current = { owner, mode: opts.mode ?? 'hover', onClose: opts.onClose ?? null, anchorFn: opts.anchorFn ?? null };
    tip.textContent = content;
    tip.dataset.open = 'true';
    owner.setAttribute('aria-describedby', TIP_ID);
    place(anchor);
  }

  root.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = targetOf(e);
    if (el && !(current && current.owner === el)) show(el, textFor(el), anchorOf(el, e), { mode: 'hover' });
  });
  root.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch' || !current || current.mode !== 'hover') return;
    if (e.relatedTarget instanceof Node && current.owner.contains(e.relatedTarget)) return;
    close();
  });
  root.addEventListener('focusin', (e) => {
    const el = targetOf(e);
    if (!el) return;
    // A click that focuses a field counts as a hover, so leaving the mouse closes it.
    const viaPointer = e.timeStamp - lastPointer.at < 200;
    show(el, textFor(el), anchorOf(el), { mode: viaPointer ? (lastPointer.type === 'touch' ? 'touch' : 'hover') : 'focus' });
  });
  root.addEventListener('focusout', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (current && el && current.owner === el && current.mode === 'focus') close();
  });

  // Capture phase: runs before the chart's own handlers, so a tap on the chart
  // closes the old overlay first and the chart then opens its own.
  document.addEventListener('pointerdown', (e) => {
    lastPointer = { type: e.pointerType, at: e.timeStamp };
    if (!(e.target instanceof Node) || !root.contains(e.target)) return close();
    if (e.pointerType !== 'touch') return;
    const el = targetOf(e);
    if (el && !(current && current.owner === el)) show(el, textFor(el), anchorOf(el, e), { mode: 'touch' });
    else close();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  // The overlay is fixed, so a scroll leaves it behind: hover tips close, focus
  // and tap tips follow their element.
  const reflow = () => {
    if (!current) return;
    if (!current.owner.isConnected || current.mode === 'hover') return close();
    place(current.anchorFn ? current.anchorFn() : anchorOf(current.owner));
  };
  window.addEventListener('scroll', reflow, { capture: true, passive: true });
  window.addEventListener('resize', reflow);

  return {
    text,
    show,
    hide: (owner) => { if (current && current.owner === owner) close(); },
    setFacts(next) { facts = next; },
    // The page changed: re-read the open overlay's text, or close it if its element is gone.
    refresh() {
      if (!current) return;
      if (!current.owner.isConnected) return close();
      if (current.owner.dataset.tip) {
        tip.textContent = textFor(current.owner);
        place(current.anchorFn ? current.anchorFn() : anchorOf(current.owner));
      }
    },
  };
}
