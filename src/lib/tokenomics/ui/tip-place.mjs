// Where an overlay goes so that it stays inside the viewport. Pure numbers in
// and out: rectangles are { left, top, right, bottom } in viewport pixels.

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Below the anchor when it fits, otherwise above it, otherwise on the side with
// more room; shifted sideways until it fits. A point is a rectangle of size 0.
export function placeTip({ anchor, tip, viewport, margin = 8, gap = 10 }) {
  const left = clamp(anchor.left, margin, Math.max(margin, viewport.width - tip.width - margin));
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - tip.height;
  const fitsBelow = below + tip.height + margin <= viewport.height;
  const fitsAbove = above >= margin;
  const roomBelow = viewport.height - anchor.bottom;
  const useAbove = !fitsBelow && (fitsAbove || anchor.top > roomBelow);
  const top = clamp(useAbove ? above : below, margin, Math.max(margin, viewport.height - tip.height - margin));
  return { left, top, side: useAbove ? 'above' : 'below' };
}

// To the right of a container (the form), level with the anchor, so that the
// overlay never covers the next input of the form. Returns null when the
// viewport has no room on the right; the caller then uses placeTip.
export function placeRight({ anchor, container, tip, viewport, margin = 8, gap = 12 }) {
  const left = container.right + gap;
  if (left + tip.width + margin > viewport.width) return null;
  return { left, top: clamp(anchor.top, margin, Math.max(margin, viewport.height - tip.height - margin)), side: 'right' };
}
