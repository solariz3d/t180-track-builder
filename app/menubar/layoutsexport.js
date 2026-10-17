// layoutsexport.js: File ▸ Export layouts… (D361 part 2). Several SAVED tracks go out as ONE Assetto Corsa track folder, one
// layout each, the way track N does it (src/export/layouts.js says the folder shape). node --test app/test/layoutsexport.test.js
//
//   const lx = createLayoutsExport({ C, layouts, shim, storage })   C = app/core/coreshell.js, layouts = src/export/layouts.js
//   await lx.build(picks, { name, textures })  -> { folder, files: [{ path, bytes }], result }      (writes nothing)
//   await exportLayoutsFlow({ lx, shell, ask, pickFolder, exporter, storage, say, textures })      the whole menu item
//
// THE BOUNDARY (G1): a saved track is a src/core/document.js document (eq-<name>.t180track), not the src/doc document
// src/doc/project.js holds, so project.js is not used here. Each saved track is opened in a core shell of its own and built by
// that shell's buildExport, the Export button's own route (start layout or placed spawns, the pit lane, the road surface), with an
// exporter that only CATCHES the segments it is handed. Those are then built by src/export/layouts.js's buildFromSegments, the same
// function exportSegments calls, so each layout's kn5 is the bytes the Export button would write for that track. That shell gets a
// storage that can only open and list tracks: it never autosaves, writes or removes anything.
// THE WRITE: the folder is built in memory (the exporter's node shim) and handed to the native side's write_layouts_export, which
// writes it under the same guards as write_export and then removes what the folder's previous marker listed and this export does not
// write (G3; src-tauri/src/lib.rs says how). The picked folder goes through the Export button's own guard first (resolveTarget).
'use strict';

const OUT = '/export';

function createLayoutsExport({ C, layouts, shim, storage }) {
  const E = layouts.ExportError;
  const readOnly = { openDoc: (n) => storage.openDoc(n), listDocs: () => storage.listDocs() };
  async function buildOne(pick, textures, author) {
    const caught = { runSegments: (segments, meta, opts) => ({ segments, meta, opts }) };
    const sh = await C.createCoreShell({ storage: readOnly, exporter: caught, autosaveMs: 0 });
    try { await sh.open(pick.track); } catch (e) { throw new E('OPEN_FAILED', `the saved track "${pick.track}" could not be opened: ${e && e.message ? e.message : e}`); }
    const st = sh.getState();   // a file that is there but does not parse: open() keeps the old (empty) track and says why in the message
    if (st.name !== pick.track) throw new E('OPEN_FAILED', `the saved track "${pick.track}" could not be opened${st.message ? `: ${st.message}` : ''}`);
    let got;
    try { got = sh.buildExport({ textures }); } catch (e) { e.message = `${pick.track}: ${e.message}`; throw e; }
    // D365: the author name, as the Export button's exporter adds it
    try { return layouts.buildFromSegments(got.segments, got.meta, { ...got.opts, author }); } catch (e) { e.message = `${pick.track}: ${e.message}`; throw e; }
  }
  return {
    async build(picks, { name, textures = null, author } = {}) {
      if (!Array.isArray(picks) || picks.length < 2) throw new E('TOO_FEW_LAYOUTS', 'pick at least two saved tracks: one layout each');
      const entries = [];
      for (const p of picks) entries.push({ layout: p.layout, name: p.name, main: p.main === true, b: await buildOne(p, textures, author) });
      shim.reset();
      const result = layouts.exportBuilt(entries, { outDir: OUT, name, prune: false });   // the native side prunes: the old folder is on the disk, not here
      return { folder: result.folder, files: shim.files(`${OUT}/${result.folder}`), result };
    },
  };
}

/** The menu item from start to end: ask, pick the folder, build, write. Every way out says what happened through `say`. */
async function exportLayoutsFlow({ lx, shell, ask, pickFolder, exporter, storage, say, textures = null, author }) {
  const tracks = await shell.list();
  if (tracks.length < 2) return say(`Export layouts needs at least two saved tracks (one layout each); ${tracks.length} saved so far.`);
  const answer = await ask(tracks);
  if (!answer) return say('Export layouts: cancelled, nothing written.');
  const dir = await pickFolder('Export the layouts into…');
  if (!dir) return say('Export layouts: no folder picked, nothing written.');
  const t = await exporter.resolveTarget(dir, storage);
  if (t.refused) return say(`not exported: ${t.refused.reason}`);
  let out;
  try { say(`exporting ${answer.picks.length} layouts…`); out = await lx.build(answer.picks, { name: answer.name, textures, author }); }
  catch (e) { return say(`not exported: ${e.message}${await exporter.removeEmptyNote(storage, t)}`); }
  let w;
  try { w = await storage.writeLayouts(t.dir, out.folder, out.files); }
  catch (e) { return say(`not exported: ${e && e.message ? e.message : e}${await exporter.removeEmptyNote(storage, t)}`); }
  const removed = w && Array.isArray(w.removed) && w.removed.length ? ` · removed ${w.removed.length} file(s) of layouts no longer in it` : '';
  const main = answer.picks.find((p) => p.main);
  return say(`exported ${out.folder} to ${t.dir}: ${answer.picks.length} layouts (${answer.picks.map((p) => p.layout).join(', ')}), main ${main ? main.layout : '?'}${removed}${await exporter.removeEmptyNote(storage, t)}`);
}

module.exports = { createLayoutsExport, exportLayoutsFlow };
