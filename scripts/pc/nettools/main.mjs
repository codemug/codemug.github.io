// WebPC nettools entry: applies the theme, builds the tab shell, and lazy-loads each tab
// module on first activation. No network on load or tab switch; every network call happens
// on an explicit click inside a tab.
import { mountTabs } from './ui.mjs';

// Theme: read from localStorage (the WebPC wrapper and the headless check set it), and keep it
// in sync with the desktop's pc:theme message. Defaults to light.
function applyTheme(t) { document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light'; }
try { applyTheme(localStorage.getItem('nettools:theme')); } catch { applyTheme('light'); }
window.addEventListener('message', e => {
  if (e.origin === location.origin && e.data?.type === 'pc:theme' && ['dark', 'light'].includes(e.data.theme)) {
    applyTheme(e.data.theme);
    try { localStorage.setItem('nettools:theme', e.data.theme); } catch { /* private mode */ }
  }
});

const TABS = [
  { id: 'subnet', label: 'Subnet', load: () => import('./subnet.mjs') },
  { id: 'dns', label: 'DNS', load: () => import('./dns.mjs') },
  { id: 'domain', label: 'Domain & IP', load: () => import('./domain.mjs') },
  { id: 'global', label: 'Global Ping', load: () => import('./globalping.mjs') },
  { id: 'latency', label: 'Latency', load: () => import('./latency.mjs') },
  { id: 'security', label: 'Security', load: () => import('./security.mjs') },
];

const start = async () => {
  await mountTabs(document.getElementById('nettools-root'), TABS);
  // The WebPC wrapper polls for this flag to hide its loading overlay.
  window.webpcNettools = { ready: true };
};
start();
