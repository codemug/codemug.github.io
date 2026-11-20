// ui.mjs — shared DOM helpers for the nettools app. External data is rendered with
// textContent only (never innerHTML of a response). Tabs are lazy-loaded on first click;
// activating a tab never fires a network request (modules only fetch on an explicit click).
export function el(tag, { text, className, id, attrs = {} } = {}) {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

// A labelled input plus a "<label> via <service>" button. The button is the ONLY trigger;
// on click it validates, calls run(value) -> Promise<string>, and shows the string in the
// output area (or the error). Both the button and the output name the receiving service.
export function queryCard(container, { service, label, placeholder, validate, run, help }) {
  const card = el('div', { className: 'nt-card' });
  card.append(el('h3', { text: `${label} — via ${service}` }));
  const row = el('div', { className: 'nt-row' });
  const input = el('input', { className: 'nt-input', attrs: { type: 'text', placeholder } });
  const btn = el('button', { className: 'nt-btn', text: `Look up via ${service}` });
  const out = el('pre', { className: 'nt-out' });
  const err = el('div', { className: 'nt-err', attrs: { hidden: 'true' } });
  row.append(input, btn);
  card.append(row, out, err);
  if (help) card.append(el('p', { className: 'nt-help', text: help }));
  const pending = el('span', { className: 'nt-pending' });
  async function go() {
    const check = validate(input.value);
    if (!check.ok) { err.textContent = check.error; err.removeAttribute('hidden'); out.textContent = ''; return; }
    btn.disabled = true; err.setAttribute('hidden', 'true'); out.textContent = `Querying ${service}…`;
    try {
      out.textContent = await run(input.value.trim());
    } catch (e) {
      out.textContent = '';
      err.textContent = e?.message ?? String(e);
      err.removeAttribute('hidden');
    } finally { btn.disabled = false; }
  }
  btn.addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  void pending;
  container.append(card);
}

// A native select element (tabs use these for type/provider pickers).
export function select(cls, value, options) {
  const s = el('select', { className: cls });
  for (const [val, label] of options) { const o = el('option', { text: label }); o.value = val; s.append(o); }
  s.value = value;
  return s;
}

// Build the tab shell (title, tab bar, content area) and lazy-load each tab on first click.
export async function mountTabs(root, tabs) {
  const bar = el('nav', { className: 'nt-tabs', attrs: { 'aria-label': 'Tools' } });
  // One panel per tab, kept mounted and toggled with `hidden`, so a tab keeps its state.
  const content = el('section');
  const panels = new Map();
  async function activate(id) {
    const tab = tabs.find(t => t.id === id);
    for (const b of bar.querySelectorAll('button')) b.classList.toggle('active', b.dataset.id === id);
    if (panels.get(id)?.dataset.failed) { panels.get(id).remove(); panels.delete(id); } // retry a failed load
    for (const [key, panel] of panels) panel.hidden = key !== id;
    if (panels.has(id)) return;
    const panel = el('div', { className: 'nt-content' });
    panels.set(id, panel); content.append(panel);
    panel.replaceChildren(el('p', { text: `Loading ${tab.label}…` }));
    try {
      const mod = await tab.load();
      panel.replaceChildren();
      await mod.mount(panel);
    } catch (e) {
      panel.dataset.failed = '1';
      panel.replaceChildren(el('p', { className: 'nt-err', text: `Could not load ${tab.label}: ${e?.message ?? e}` }));
    }
  }
  for (const t of tabs) {
    const b = el('button', { className: 'nt-tab', text: t.label });
    b.dataset.id = t.id;
    b.addEventListener('click', () => activate(t.id));
    bar.append(b);
  }
  root.append(el('h1', { text: 'Network and Security Tools' }), el('p', { className: 'nt-intro', text: 'Each tool queries an external service only when you click its button; results are shown as text. Nothing is fetched on load or on switching tabs.' }), bar, content);
  await activate(tabs[0].id);
}
