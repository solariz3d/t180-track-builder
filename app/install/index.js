// index.js: the Install and See-it buttons, mounted as mount(root, shell, { native, pickFolder, getTextures, more }) on the core shell (D239).
//   D252 second item (the keeper: "why two export buttons", then "the AC folder ... in the EXE startup, the user can choose where the track folder is
//   in the beginning, freeing up UI space"): `root` holds ONE button, Export to Assetto Corsa, and its note; "Assetto Corsa folder…" and See it in
//   Assetto with its setting go into `more` (the page's ⋯ menu; without one, into root as before). At startup, with no folder remembered, the note
//   is a one-time card: the folder Steam found (Use it / Choose another…), or, when Steam finds none, Choose…. The answer is remembered.
//   "Export to Assetto Corsa" (D250; was "Install to AC"): installs as t180b_<name> into the AC folder found through Steam; only
//   when Steam has no AC does it ask for the folder (remembered). "AC folder…" picks another one.
//   "See it in Assetto": DISABLED while the setting "See it in Assetto (launches the game)" is off, which is the default.
'use strict';
const { createInstaller, createLauncher, PREFIX_NOTE } = require('./install.js');

const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

function mount(root, shell, { native, pickFolder, getTextures, more = null, card: cardEl = null }) {
  const inst = createInstaller({ build: (opts) => shell.buildExport(opts), native, getDoc: () => shell.exportDoc(), getTextures });
  const see = createLauncher({ native });
  const install = el('button', { textContent: 'Export to Assetto Corsa', title: `export straight into Assetto Corsa's content\\tracks, found through Steam; exporting the same track again updates its folder (${PREFIX_NOTE})` });
  const change = el('button', { textContent: 'Assetto Corsa folder…', title: 'the Assetto Corsa folder exports go into (the one with content\\tracks)' });
  const seeIt = el('button', { textContent: 'See it in Assetto', disabled: true, title: 'off: turn on "See it in Assetto (launches the game)" to use it' });
  const allow = el('input', { type: 'checkbox' });
  const note = el('div', { className: 't-install-note' });
  const allowLabel = el('label', { title: 'This button starts Assetto Corsa. It is off unless you turn it on.' }, [allow, ' See it in Assetto (launches the game)']);
  if (more) { root.append(install, note); more.append(change, seeIt, allowLabel); } else root.append(install, change, seeIt, allowLabel, note);
  let last = null;
  const pick = async () => { const p = await pickFolder('Your Assetto Corsa folder (the one with content\\tracks)'); if (!p) return null; const r = await inst.chooseRoot(p); note.textContent = r.ok ? `Assetto Corsa folder: ${r.root}` : r.message; return r.ok ? r.root : null; };
  change.onclick = pick;
  install.onclick = async () => {
    let r = await inst.install();
    if (r.needsRoot && (await pick())) r = await inst.install();
    note.textContent = r.message; if (r.ok) last = r.folder;
  };
  const refresh = async () => { const on = await see.enabled(); allow.checked = on; seeIt.disabled = !on || !last; };
  allow.onchange = async () => { await native.setSeeItSetting(allow.checked); await refresh(); };
  seeIt.onclick = async () => { const r = await see.run(last); note.textContent = r.ok ? `Assetto Corsa closed (exit ${r.code})` : r.message; };
  refresh();
  // THE STARTUP CARD (D252): only when no folder is remembered; the native side looks Steam up without remembering (find_ac_root)
  // the card sits in `card` (the page's banner row) as a bar, or in the note when there is none; an answer clears it and the note says where exports go
  const show = (...kids) => { if (cardEl) cardEl.replaceChildren(el('div', { className: 'bar' }, kids)); else note.replaceChildren(...kids); };
  const remember = async (p) => { if (!p) return; const r = await inst.chooseRoot(p); if (r.ok && cardEl) cardEl.replaceChildren(); note.textContent = r.ok ? `Exports go into Assetto Corsa at ${r.root}` : r.message; };
  const card = (async () => {
    if (!native.findAcRoot) return;
    let s; try { s = await native.findAcRoot(); } catch (e) { return; }   // no answer: Export still finds AC itself, or asks
    if (!s || s.remembered) return;
    const choose = async () => remember(await pickFolder('Your Assetto Corsa folder (the one with content\\tracks)'));
    if (s.found) show(`Assetto Corsa found at ${s.found} (through Steam). Export to Assetto Corsa writes your tracks there. `, el('button', { textContent: 'Use it', onclick: () => remember(s.found) }), ' ', el('button', { textContent: 'Choose another…', onclick: choose }));
    else show('Assetto Corsa was not found through Steam: pick the folder that holds content\\tracks, so Export to Assetto Corsa can write your tracks there. ', el('button', { textContent: 'Choose…', onclick: choose }));
  })();
  return { inst, see, card };
}

module.exports = { mount };
