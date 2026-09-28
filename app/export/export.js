// export.js: the app's Export button, minus the button. It checks where the user wants the track, runs
// src/export/fromwords.js exportTrack() UNCHANGED against an in-memory disk (app/export/node-shim.js), and hands back
// each folder's files for the native side to write into the folder the user picked (src-tauri/src/lib.rs write_export).
//
//   const exporter = await makeExporter(get);            // get(path) -> text, as app/lib/cjs.js takes it
//   exporter.checkTarget(dir)  -> { ok } | { ok: false, code, reason }
//   exporter.run(doc, { variant })  -> { result, folders: [{ folder, files: [{ path, bytes }] }] }   (throws ExportError)
//   exporter.runSegments(segments, { name, description?, via? }, { variant })   the same, for the equation core (D186)
//
// THE SELF-INTERSECTION CHECK IS ALWAYS ON. run() passes exportTrack no `selfCheck`, so its default (on) always holds,
// and there is no way to turn it off from the app: a false red is settled in the geometry, never by loosening the check
// (the ruling of 2026-09-27). A refused export shows its reds.
//
// NO GAME IS LAUNCHED AND NOTHING IS INSTALLED: the track goes to the picked folder and nowhere else.
// THE AC GUARD (the overnight plan's Rule 1: never overwrite anything in the AC install; new tracks only under
// content\tracks\t180b_*). A picked folder inside any `…\content\tracks\<name>\…` is refused unless <name> starts with
// t180b_. Picking `content\tracks` itself is allowed, because exportTrack only ever writes a t180b_* folder there, and
// it refuses a folder of that name it did not write (NOT_OURS). The native side checks the same thing again. The test
// is on the path, so it also guards a copy of the AC folders somewhere else, which errs on the safe side.
'use strict';

const { loadCjs } = require('../lib/cjs.js');
const { createShim } = require('./node-shim.js');

const OUT = '/export';

function checkTarget(dir) {
  if (typeof dir !== 'string' || !dir.trim()) return { ok: false, code: 'NO_FOLDER', reason: 'no folder was picked' };
  const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean), low = parts.map((p) => p.toLowerCase());
  for (let i = 0; i + 1 < low.length; i++) {
    if (low[i] !== 'content' || low[i + 1] !== 'tracks') continue;
    const inside = parts[i + 2];
    if (inside === undefined) return { ok: true };
    if (!/^t180b_/i.test(inside)) {
      return { ok: false, code: 'AC_INSTALL', reason: `"${dir}" is inside ${parts.slice(0, i + 2).join('\\')}\\${inside}, another track's folder. In an Assetto Corsa install the builder writes only t180b_* folders: pick content\\tracks itself, or a folder elsewhere` };
    }
  }
  return { ok: true };
}

/** Load the exporter into this realm with the node shim, the way the webview runs it. `get` fetches source text. */
async function makeExporter(get) {
  const shim = createShim();
  const fromwords = await loadCjs('src/export/fromwords.js', get, { builtins: shim.builtins, globals: { Buffer: shim.Buffer } });
  return {
    checkTarget,
    ExportError: fromwords.ExportError,
    // textures: the texture set the textures panel announces (the one the preview draws), or null
    run(doc, { variant = 'block', textures = null } = {}) {
      shim.reset();
      const result = fromwords.exportTrack(doc, { outDir: OUT, variant, textures });   // no selfCheck: the check is always on
      return { result, folders: result.folders.map((f) => ({ folder: f.folder, files: shim.files(`${OUT}/${f.folder}`) })) };
    },
    // the equation core's track (D186): src/geom segments from src/core/adapter.js, through the SAME exporter
    // (fromwords.js exportSegments: the same validation, self-check, markers, read-back and AI line); the check stays on
    // markers: the grid layout (app/core/coreshell.js startLayout), or undefined for the export's default
    runSegments(segments, meta, { variant = 'block', textures = null, markers } = {}) {
      shim.reset();
      const result = fromwords.exportSegments(segments, meta, { outDir: OUT, variant, textures, markers });
      return { result, folders: result.folders.map((f) => ({ folder: f.folder, files: shim.files(`${OUT}/${f.folder}`) })) };
    },
  };
}

module.exports = { checkTarget, makeExporter };
