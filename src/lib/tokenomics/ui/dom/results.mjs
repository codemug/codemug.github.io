// Copies the view model into the prebuilt result elements. Every string goes
// through textContent; the only innerHTML is the SVG string from chart.mjs.
// Each assumptions row carries its overlay key; its basis cell carries another.

import { basisKey } from '../tips.mjs';

function fillList(list, items) {
  list.replaceChildren(...items.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
}

export function renderResults(root, view, charts) {
  const q = (id) => root.querySelector('#' + id);
  q('tk-headline').textContent = view.headline;
  q('tk-crossover').textContent = view.crossoverText;
  q('tk-warning').textContent = view.warning;
  // The self-hosting card says so when the speed asked for is missed.
  q('tk-self').dataset.state = view.self.speedMissed ? 'warn' : 'ok';
  q('tk-self-badge').hidden = !view.self.speedMissed;
  q('tk-api-title').textContent = view.api.title;
  q('tk-api-monthly').textContent = view.api.monthly;
  q('tk-api-perMtok').textContent = view.api.perMtok;
  fillList(q('tk-api-notes'), view.api.notes);
  q('tk-self-title').textContent = view.self.title;
  q('tk-self-monthly').textContent = view.self.monthly;
  q('tk-self-perMtok').textContent = view.self.perMtok;
  // A line with no text is hidden, so it takes no space and no tab stop.
  for (const [id, text] of [['tk-self-deployment', view.self.deployment], ['tk-self-perReplica', view.self.perReplica], ['tk-self-confidence', view.self.confidence]]) {
    q(id).textContent = text;
    q(id).parentElement.hidden = text === '';
  }
  fillList(q('tk-self-notes'), view.self.notes);
  const tbody = q('tk-assumptions');
  tbody.replaceChildren(...view.assumptions.map((a) => {
    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.dataset.tip = a.key;
    tr.dataset.tipBasis = basisKey(a.basis);
    for (const cell of [a.label, a.value, a.basis]) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    tr.lastChild.dataset.tip = tr.dataset.tipBasis;
    return tr;
  }));
  q('tk-chart1').innerHTML = charts.monthly;
  q('tk-chart2').innerHTML = charts.perMtok;
  q('tk-chart-caption').textContent = view.chartCaption;
}
