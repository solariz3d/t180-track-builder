// blenderexport.js: File ▸ Export for Blender…: the open track as a .glb (and, with the user's own Blender, an .fbx) in a folder of
// its own, to open in Blender. node --test app/test/blenderexport.test.js
//
//   const bx = createBlenderExport({ layouts, blender })   layouts = src/export/layouts.js (its buildFromSegments), blender = src/export/blender.js
//   bx.build(shell, { textures, author, pieces })  -> { folder, name, files: [{ path, bytes }], meshes, markers, skipped }   (writes nothing)
//   askBlender(doc, { selection, blender })        -> Promise<{ selectedOnly, fbx } | null>   (null: cancelled)
//   await exportBlenderFlow({ bx, shell, ask, pickFolder, findBlender, write, say, textures, author })   the whole menu item
//
// THE BUILD is the Export button's own: shell.exportArgs (the start layout or the placed spawns, the pit lane, the road surface), then
// buildFromSegments with the author, so the meshes in the .glb are the meshes the game's kn5 would hold. An OPEN track is built as the
// test export builds it (open, its end wall), so an unfinished track can be looked at in Blender too. src/export/blender.js makes the
// files. THE WRITE is the native side's write_blender_export (src-tauri/src/blender.rs): never into a game's track folder, never over a
// folder it did not write; with the FBX ticked it then runs the user's Blender headless, no window, below-normal priority.
// The FBX tick is offered only when a Blender was found (Settings ▸ Blender…, or Steam's); "only the selected pieces" only when pieces
// are selected. Every way out says what happened through `say`.
'use strict';

function createBlenderExport({ layouts, blender }) {
  return {
    build(shell, { textures = null, author, pieces = null } = {}) {
      let args;
      try { args = shell.exportArgs({ textures }); }
      catch (e) { if (!e || e.code !== 'OPEN_LOOP') throw e; args = shell.exportArgs({ textures, test: true }); }
      const [segments, meta, opts] = args;
      const ex = layouts.buildFromSegments(segments, meta, { ...opts, author });
      const b = blender.blenderFiles(ex, { pieces });
      return { folder: `${b.name} for Blender`, name: b.name, files: b.files, meshes: b.meshes, markers: b.markers, skipped: b.skipped };
    },
  };
}

function askBlender(doc, { selection = null, blender = null } = {}) {
  if (!doc || !doc.body) return Promise.reject(new Error('askBlender: no document to ask in'));
  const mk = (tag, props = {}) => { const e = doc.createElement(tag); Object.assign(e, props); return e; };
  const veil = mk('div', { className: 'ask-veil' }), card = mk('div', { className: 'ask-card ask-blender' });
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true');
  card.appendChild(mk('h2', { textContent: 'Export for Blender' }));
  card.appendChild(mk('p', { textContent: 'The track as a .glb in a folder of its own, with a README: open it in Blender with File ▸ Import ▸ glTF 2.0. The meshes and markers keep the names the game uses. Nothing goes into the game.' }));
  const line = (box, text) => { const l = mk('label', { className: 'bx-row' }); l.appendChild(box); l.appendChild(mk('span', { textContent: text })); card.appendChild(l); return box; };
  const only = selection && selection.count > 0 ? line(mk('input', { type: 'checkbox', checked: false, className: 'bx-only' }), `Only the selected piece${selection.count === 1 ? '' : 's'} (${selection.count}), with the markers among them`) : null;
  const fbx = blender ? line(mk('input', { type: 'checkbox', checked: true, className: 'bx-fbx' }), 'Also make the .fbx for ksEditor with Blender (it runs hidden and takes a few seconds)') : null;
  if (!blender) card.appendChild(mk('p', { className: 'bx-note', textContent: 'Blender was not found, so only the .glb is written. To have the .fbx made too, set Blender in Settings ▸ Blender….' }));
  const row = mk('div', { className: 'ask-row' });
  const cancel = mk('button', { textContent: 'Cancel' }), go = mk('button', { textContent: 'Export…', className: 'ask-main' });
  row.appendChild(cancel); row.appendChild(go); card.appendChild(row); veil.appendChild(card);
  const before = doc.activeElement;
  return new Promise((done) => {
    const finish = (v) => {
      doc.removeEventListener('keydown', onKey, true);
      try { veil.remove(); } catch (e) { /* already gone */ }
      try { if (before && before.focus) before.focus(); } catch (e) { /* the old focus is gone */ }
      done(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      else e.stopPropagation();   // the builder's own keys must not act behind the question
    };
    cancel.onclick = () => finish(null);
    go.onclick = () => finish({ selectedOnly: !!(only && only.checked), fbx: !!(fbx && fbx.checked) });
    doc.addEventListener('keydown', onKey, true);
    doc.body.appendChild(veil);
    try { go.focus(); } catch (e) { /* no focus in a test document */ }
  });
}

/** The menu item from start to end: ask, pick the folder, build, write (and the FBX). */
async function exportBlenderFlow({ bx, shell, ask, pickFolder, findBlender, write, say, textures = null, author }) {
  const sel = typeof shell.selectionInfo === 'function' ? shell.selectionInfo() : null;
  let found = null;
  try { found = await findBlender(); } catch (e) { found = null; say(`Blender could not be looked for (${e && e.message ? e.message : e}); the .glb can still be written`); }
  const answer = await ask({ selection: sel ? { count: sel.count, ids: sel.ids } : null, blender: found });
  if (!answer) return say('Export for Blender: cancelled, nothing written.');
  const dir = await pickFolder('Export for Blender into…');
  if (!dir) return say('Export for Blender: no folder picked, nothing written.');
  const pieces = answer.selectedOnly && sel ? sel.ids : null;
  let out;
  try { say('building the export for Blender…'); out = bx.build(shell, { textures, author, pieces }); }
  catch (e) { return say(`not exported for Blender: ${e && e.message ? e.message : e}`); }
  let w;
  try { say(answer.fbx ? 'writing the .glb, then Blender makes the .fbx…' : 'writing the .glb…'); w = await write(dir, out.folder, out.files, !!answer.fbx); }
  catch (e) { return say(`not exported for Blender: ${e && e.message ? e.message : e}`); }
  const what = `${out.name}.glb (${out.meshes} meshes, ${out.markers} markers${pieces ? `, only ${pieces.join(', ')}` : ''})`;
  const fbxWords = w && w.fbx ? ` and ${out.name}.fbx` : '';
  const fbxProblem = answer.fbx && w && w.fbx_error ? ` · no .fbx: ${w.fbx_error}` : '';
  const skipped = out.skipped && out.skipped.length ? ` · textures left out: ${out.skipped.join('; ')}` : '';
  return say(`exported for Blender into ${w && w.folder ? w.folder : `${dir}\\${out.folder}`}: ${what}${fbxWords}, and README.txt${fbxProblem}${skipped}`);
}

module.exports = { createBlenderExport, askBlender, exportBlenderFlow };
