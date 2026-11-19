// Pinned Casual Sheets 0.20.0 embed introspection seam. Deliberately isolated:
// upstream exposes __casualEmbedApi in embed-runtime/index.tsx, not its wire API.
export function requireEditorApi(frameWindow) {
  const api = frameWindow?.__casualEmbedApi;
  if (!api) return null;
  for (const key of ['getContent', 'setContent', 'on', 'onMutation', 'importXlsx', 'exportXlsx']) {
    if (typeof api[key] !== 'function') throw new Error(`Spreadsheet adapter mismatch: missing ${key}.`);
  }
  if (!api.univer?.getActiveWorkbook) throw new Error('Spreadsheet adapter mismatch: workbook facade unavailable.');
  return api;
}

export function commitEditing(api, editorDocument) {
  // Formula-bar blur commits synchronously. Univer's async endEditing starts with
  // a synchronous command; ordinary saves also receive the ensuing mutation.
  const active = editorDocument?.activeElement;
  if (active && typeof active.blur === 'function') active.blur();
  const workbook = api.univer.getActiveWorkbook();
  if (workbook?.isCellEditing?.()) return workbook.endEditingAsync(true);
  return Promise.resolve();
}

export function watchChanges(api, save, failed) {
  let queued = false;
  let stopped = false;
  // Mutation is immediate; the SDK's change event alone waits 400ms. Coalesce
  // commands in this task, then persist before the next browser input event.
  const mutation = () => {
    if (queued || stopped) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!stopped) save();
    });
  };
  const unsubscribers = [api.onMutation(mutation), api.on('change', mutation),
    api.on('save', () => save()), api.on('error', failed)];
  return () => { stopped = true; unsubscribers.forEach(off => off()); };
}

export function importXlsxAcrossFrame(api, frameWindow, bytes) {
  // SDK checks instanceof Uint8Array in its own realm. A host Uint8Array fails
  // that check and is mistaken for a Blob, causing `arrayBuffer is not a function`.
  return api.importXlsx(new frameWindow.Uint8Array(bytes));
}

// Univer's pinned render observer queues resize() in requestIdleCallback without
// a timeout. Its continuously active canvas can starve that callback in an
// embedded window. Resize the existing engine on the next animation frame.
// This private facade lookup is confined to the version-pinned adapter; no
// workbook/scene is replaced and no cell, selection, or undo state is touched.
export function watchViewport(api, frameWindow, failed) {
  const root = frameWindow.document.getElementById('casual-embed-root');
  let pending = 0, stopped = false, observedContainer;
  function renderEngine() {
    const facade = api.univer, book = facade.getActiveWorkbook();
    if (!book || typeof facade._getSheetRenderComponent !== 'function') throw new Error('Spreadsheet resize adapter is unavailable.');
    const component = facade._getSheetRenderComponent(book.getId(), '__SpreadsheetRender__');
    const engine = component?.getScene?.()?.getEngine?.();
    if (typeof engine?.resize !== 'function' || typeof engine?.getCanvasElement !== 'function') throw new Error('Spreadsheet resize adapter does not match this SDK.');
    return engine;
  }
  function resize() {
    pending = 0;
    if (stopped) return;
    try {
      const engine = renderEngine(), container = engine.getCanvasElement().parentElement;
      if (container !== observedContainer) {
        if (observedContainer) observer.unobserve(observedContainer);
        observedContainer = container;
        if (container) observer.observe(container);
      }
      // Cached closed/minimized windows can briefly have zero dimensions.
      if (container?.clientWidth > 0 && container.clientHeight > 0) engine.resize();
    } catch (error) { failed(error); }
  }
  function schedule() { if (!pending && !stopped) pending = frameWindow.requestAnimationFrame(resize); }
  const observer = new frameWindow.ResizeObserver(schedule);
  const mutations = new frameWindow.MutationObserver(schedule);
  // A replacement workbook can install a new canvas/engine. Resolve it afresh
  // and rebind its container instead of retaining the disposed engine.
  mutations.observe(root, { childList: true, subtree: true });
  observer.observe(root);
  frameWindow.addEventListener('resize', schedule);
  resize();
  return () => {
    stopped = true; observer.disconnect(); mutations.disconnect();
    frameWindow.removeEventListener('resize', schedule);
    if (pending) frameWindow.cancelAnimationFrame(pending);
  };
}
