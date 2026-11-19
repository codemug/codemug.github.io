export function setupApp(appId, onTheme = () => {}) {
  const theme = value => { document.documentElement.dataset.theme = value === 'light' ? 'light' : 'dark'; onTheme(document.documentElement.dataset.theme); };
  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.source === parent && event.data?.type === 'pc:theme') theme(event.data.theme);
  });
  document.addEventListener('pointerdown', () => parent.postMessage({ type: 'pc:focus', appId }, location.origin), true);
  parent.postMessage({ type: 'pc:ready', appId }, location.origin);
  theme(document.documentElement.dataset.theme);
}
export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
