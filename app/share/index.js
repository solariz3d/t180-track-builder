// index.js: the share buttons, mounted as mount(root, shell, { clipboard, onPack }). "Copy code" puts the track's code on
// the clipboard (and shows it, selected, for a system without clipboard access); "Paste code" imports whatever code is
// pasted into the box: a track, a piece or phrase, or a texture pack (app/share/share.js).
'use strict';
const { createShare } = require('./share.js');

const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

function mount(root, shell, { clipboard = (typeof navigator !== 'undefined' && navigator.clipboard) || null, onPack = null } = {}) {
  const share = createShare(shell, { clipboard, onPack });
  const box = el('textarea', { rows: 2, placeholder: 'paste a t180 code here', spellcheck: false });
  const copy = el('button', { textContent: 'Copy code', title: 'the whole track as one line of text, to share' });
  const paste = el('button', { textContent: 'Paste code', title: 'open a track, add a piece, or import a texture pack from its code' });
  const note = el('div', { className: 't-share-note' });
  root.append(copy, paste, box, note);
  copy.onclick = async () => { try { const c = await share.copyTrack(); box.value = c; box.select(); note.textContent = `copied: ${c.length} characters`; } catch (e) { note.textContent = e.message; } };
  paste.onclick = async () => { const r = await share.paste(box.value); note.textContent = r.message; };
  return share;
}

module.exports = { mount };
