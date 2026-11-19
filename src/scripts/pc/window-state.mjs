export const MOBILE_WIDTH = 640;
export const MIN_SIZE = { width: 360, height: 260 };

export function clampRect(rect, bounds) {
  const width = Math.min(Math.max(rect.width, MIN_SIZE.width), bounds.width);
  const height = Math.min(Math.max(rect.height, MIN_SIZE.height), bounds.height);
  return {
    x: Math.max(0, Math.min(rect.x, bounds.width - width)),
    y: Math.max(0, Math.min(rect.y, bounds.height - height)),
    width, height,
  };
}

export function initialRect(app, bounds, count = 0) {
  const width = Math.min(app.width, bounds.width - 48);
  const height = Math.min(app.height, bounds.height - 48);
  return clampRect({ x: (bounds.width - width) / 2 + count * 24, y: (bounds.height - height) / 2 + count * 24, width, height }, bounds);
}

export function windowRect(win, bounds) {
  return win.maximized || bounds.width < MOBILE_WIDTH
    ? { x: 0, y: 0, width: bounds.width, height: bounds.height }
    : clampRect(win.rect, bounds);
}

export function reduceDesktop(state, action, bounds) {
  let windows = state.windows.map(win => ({ ...win }));
  let activeId = state.activeId;
  const index = windows.findIndex(win => win.id === action.id);
  const focus = id => {
    const i = windows.findIndex(win => win.id === id);
    if (i < 0) return;
    const [win] = windows.splice(i, 1);
    windows.push({ ...win, minimized: false });
    activeId = id;
  };
  switch (action.type) {
    case 'open':
      if (index < 0) windows.push({ id: action.id, rect: initialRect(action.app, bounds, windows.length), minimized: false, maximized: false });
      focus(action.id);
      break;
    case 'focus': focus(action.id); break;
    case 'minimize':
      if (index >= 0) windows[index].minimized = true;
      break;
    case 'close': windows = windows.filter(win => win.id !== action.id); break;
    case 'maximize':
      if (index >= 0 && bounds.width >= MOBILE_WIDTH) {
        windows[index].maximized = !windows[index].maximized;
        focus(action.id);
      }
      break;
    case 'rect':
      if (index >= 0 && !windows[index].maximized && bounds.width >= MOBILE_WIDTH) windows[index].rect = clampRect(action.rect, bounds);
      break;
    case 'bounds':
      // Retain desktop geometry through a narrow/mobile viewport.
      if (bounds.width >= MOBILE_WIDTH) windows = windows.map(win => ({ ...win, rect: clampRect(win.rect, bounds) }));
      break;
  }
  if (!windows.some(win => win.id === activeId && !win.minimized)) activeId = windows.filter(win => !win.minimized).at(-1)?.id ?? null;
  return { windows, activeId };
}
