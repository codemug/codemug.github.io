// Security tab — fully local, lazy-loaded: password strength (@zxcvbn-ts, MIT) and age
// file encryption (age-encryption, BSD-3). Nothing on this tab is ever stored or sent:
// the password field and the file are processed in memory only and discarded with the page.
import { el } from './ui.mjs';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import * as zxcvbnEn from '@zxcvbn-ts/language-en';
import { Encrypter, Decrypter } from 'age-encryption';

const zxcvbn = new ZxcvbnFactory({
  translations: zxcvbnEn.translations,
  graphs: zxcvbnCommon.adjacencyGraphs,
  dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnEn.dictionary },
});

function download(name, bytes) {
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function scoreCard(content) {
  const card = el('div', { className: 'nt-card' });
  card.append(el('h3', { text: 'Password strength — checked locally, never stored or sent' }));
  const row = el('div', { className: 'nt-row' });
  const input = el('input', { className: 'nt-input nt-input-grow', attrs: { type: 'password', id: 'nt-password', placeholder: 'type a password to check (stays in this field only)' } });
  const btn = el('button', { className: 'nt-btn', id: 'nt-password-check', text: 'Check strength (fully local)' });
  const out = el('pre', { className: 'nt-out', id: 'nt-password-out' });
  const err = el('div', { className: 'nt-err', attrs: { hidden: 'true' } });
  row.append(input, btn);
  card.append(row, out, err, el('p', { className: 'nt-help', text: 'Evaluated by zxcvbn-ts (MIT) with English + common dictionaries. The value is computed in this tab and is not saved anywhere, not logged, and not sent to any service.' }));
  function go() {
    const pw = input.value;
    if (!pw) { err.textContent = 'Enter a password to check.'; err.removeAttribute('hidden'); return; }
    const r = zxcvbn.check(pw);
    err.setAttribute('hidden', 'true');
    const lines = [
      `Score: ${r.score}/4`,
      `Offline attack (fast hash): ${r.crackTimes.offlineFastHashingXPerSecond.display}`,
      `Online attack (no throttling): ${r.crackTimes.onlineNoThrottlingXPerSecond.display}`,
    ];
    if (r.feedback.warning) lines.push(`Warning: ${r.feedback.warning}`);
    if (r.feedback.suggestions.length) lines.push(`Suggestions: ${r.feedback.suggestions.join(' ')}`);
    out.textContent = lines.join('\n');
  }
  btn.addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  content.append(card);
}

function ageCard(content, mode) {
  const enc = mode === 'encrypt';
  const card = el('div', { className: 'nt-card' });
  card.append(el('h3', { text: enc ? 'Encrypt a file with age — fully local' : 'Decrypt an age file — fully local' }));
  const row = el('div', { className: 'nt-row nt-row-wrap' });
  const file = el('input', { className: 'nt-input nt-input-grow', attrs: { type: 'file', id: enc ? 'nt-age-encrypt-file' : 'nt-age-decrypt-file' } });
  const pass = el('input', { className: 'nt-input', attrs: { type: 'password', id: enc ? 'nt-age-encrypt-pass' : 'nt-age-decrypt-pass', placeholder: 'passphrase' } });
  const btn = el('button', { className: 'nt-btn', id: enc ? 'nt-age-encrypt-btn' : 'nt-age-decrypt-btn', text: enc ? 'Encrypt with age (local)' : 'Decrypt with age (local)' });
  const out = el('pre', { className: 'nt-out', id: enc ? 'nt-age-encrypt-out' : 'nt-age-decrypt-out' });
  const err = el('div', { className: 'nt-err', attrs: { hidden: 'true' } });
  row.append(file, pass, btn);
  card.append(row, out, err, el('p', { className: 'nt-help', text: enc
    ? 'age (BSD-3) passphrase encryption (scrypt, work factor 18). The file is processed entirely in this browser and the result is downloaded as "<name>.age". Nothing is uploaded; the file is fully read into memory, so keep it a reasonable size.'
    : 'Decrypts a file produced by the Encrypt tool (or the age CLI) with a passphrase. The result is downloaded with the original file name.' }));
  const showErr = msg => { out.textContent = ''; err.textContent = msg; err.removeAttribute('hidden'); };
  async function go() {
    const f = file.files?.[0];
    if (!f) { showErr('Choose a file first.'); return; }
    const pw = pass.value;
    if (!pw) { showErr('Enter a passphrase.'); return; }
    btn.disabled = true; err.setAttribute('hidden', 'true');
    out.textContent = enc ? `Encrypting ${f.name} with age…` : `Decrypting ${f.name} with age…`;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (enc) {
        const e = new Encrypter();
        e.setPassphrase(pw);
        const ct = await e.encrypt(bytes);
        download(`${f.name}.age`, ct);
        out.textContent = `Encrypted ${f.name} (${bytes.length} bytes) → downloaded ${f.name}.age (${ct.length} bytes). The passphrase and file were not sent anywhere.`;
      } else {
        const d = new Decrypter();
        d.addPassphrase(pw);
        const pt = await d.decrypt(bytes, 'uint8array');
        download(f.name.replace(/\.age$/i, '') || 'decrypted', pt);
        out.textContent = `Decrypted ${f.name} (${bytes.length} bytes) → downloaded ${(f.name.replace(/\.age$/i, '') || 'decrypted')} (${pt.length} bytes). Nothing was sent anywhere.`;
      }
    } catch (e) {
      showErr(e?.message?.includes('no identity matched') ? `Decryption failed: the passphrase does not match this age file. (${e.message})` : (e?.message ?? String(e)));
    } finally { btn.disabled = false; }
  }
  btn.addEventListener('click', go);
  content.append(card);
}

export function mount(content) {
  scoreCard(content);
  ageCard(content, 'encrypt');
  ageCard(content, 'decrypt');
}
