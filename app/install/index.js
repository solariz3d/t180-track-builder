// index.js: the Install and See-it buttons, mounted as mount(root, shell, { native, pickFolder, getTextures }) on the core shell (D239).
//   "Install to AC": the first time, asks for the Assetto Corsa folder (remembered); then installs as t180b_<name>.
//   "See it in Assetto": DISABLED while the setting "See it in Assetto (launches the game)" is off, which is the default.
'use strict';
const { createInstaller, createLauncher, PREFIX_NOTE } = require('./install.js');

const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

function mount(root, shell, { native, pickFolder, getTextures }) {
  const inst = createInstaller({ build: (opts) => shell.buildExport(opts), native, getDoc: () => shell.exportDoc(), getTextures });
  const see = createLauncher({ native });
  const install = el('button', { textContent: 'Install to AC', title: `export straight into Assetto Corsa's content\\tracks (${PREFIX_NOTE})` });
  const change = el('button', { textContent: 'AC folder…' });
  const seeIt = el('button', { textContent: 'See it in Assetto', disabled: true, title: 'off: turn on "See it in Assetto (launches the game)" to use it' });
  const allow = el('input', { type: 'checkbox' });
  const note = el('div', { className: 't-install-note' });
  root.append(install, change, seeIt, el('label', { title: 'This button starts Assetto Corsa. It is off unless you turn it on.' }, [allow, ' See it in Assetto (launches the game)']), note);
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
  return { inst, see };
}

module.exports = { mount };
