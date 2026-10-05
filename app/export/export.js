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
// THE EMPTY FOLDER (D226): the keeper makes a folder named after the track directly in content\tracks ("T-180 TUBE OVAL") and picks it. It is
// refused, and the EMPTY folder it leaves behind makes Content Manager say "main layout is damaged". So a picked folder that sits DIRECTLY in
// content\tracks, is not t180b_*, and is EMPTY is not another track: the export goes into content\tracks as the normal t180b_<name>, and
// that empty folder is removed afterwards (resolveTarget, then the shells call storage.removeEmptyFolder; the native side checks all of it
// again and removes only an empty folder, rmdir never deleting contents). A folder with anything in it is still refused, as before.
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

/** If `dir` is `…\content\tracks\<name>` exactly (nothing deeper), { parent: …\content\tracks, name } spelled as the user's path was; else null. */
function directChild(dir) {
  if (typeof dir !== 'string') return null;
  const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean), low = parts.map((p) => p.toLowerCase());
  for (let i = 0; i + 2 < low.length; i++) {
    if (low[i] === 'content' && low[i + 1] === 'tracks' && parts.length === i + 3) {
      const bits = dir.split(/([\\/]+)/); let seen = -1, k = 0;   // names at the even indexes, separators at the odd ones
      for (; k < bits.length; k += 2) { if (bits[k] !== '') seen++; if (seen === i + 1) break; }
      return { parent: bits.slice(0, k + 1).join(''), name: parts[i + 2] };
    }
  }
  return null;
}

/**
 * Where does this export go? { dir } as picked; { dir: content\tracks, cleanup: <the picked folder>, cleanupName } when the picked folder is an
 * EMPTY folder directly in content\tracks (storage.folderIsEmpty says so); { refused: g } for any other refusal. Nothing here writes or removes.
 */
async function resolveTarget(dir, storage) {
  const g = checkTarget(dir);
  if (g.ok) return { dir };
  const c = g.code === 'AC_INSTALL' ? directChild(dir) : null;
  // "." and ".." are not folder names: `content\tracks\.` is content\tracks itself, so it must never be read as a folder someone made in it
  if (c && (c.name === '.' || c.name === '..')) return { refused: { ok: false, code: 'AC_INSTALL', reason: `"${dir}" ends in "${c.name}", which is not a folder name: pick the folder itself (an Assetto Corsa tracks folder is never exported into by a "." or ".." path)` } };
  if (!c || !storage || typeof storage.folderIsEmpty !== 'function' || (await storage.folderIsEmpty(dir)) !== true) return { refused: g };
  if (!checkTarget(c.parent).ok) return { refused: g };   // the parent must pass the same guard, never a second door
  return { dir: c.parent, cleanup: dir, cleanupName: c.name };
}

/** The sentence added to the export message once the empty folder is gone (or could not be removed). */
async function removeEmptyNote(storage, t) {
  if (!t.cleanup) return '';
  try { await storage.removeEmptyFolder(t.cleanup); return ` · removed the empty folder "${t.cleanupName}" so Content Manager does not list it`; }
  catch (e) { return ` · could not remove the empty folder "${t.cleanupName}" (${e && e.message ? e.message : e}): delete it by hand, Content Manager lists it as a broken track`; }
}

/** Load the exporter into this realm with the node shim, the way the webview runs it. `get` fetches source text. */
async function makeExporter(get) {
  const shim = createShim();
  const fromwords = await loadCjs('src/export/fromwords.js', get, { builtins: shim.builtins, globals: { Buffer: shim.Buffer } });
  return {
    checkTarget,
    resolveTarget,
    removeEmptyNote,
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
    runSegments(segments, meta, { variant = 'block', textures = null, markers, test = false } = {}) {   // test (D243a): the TEST export of an unfinished track
      shim.reset();
      const result = fromwords.exportSegments(segments, meta, { outDir: OUT, variant, textures, markers, ...(test ? { test: true } : {}) });
      return { result, folders: result.folders.map((f) => ({ folder: f.folder, files: shim.files(`${OUT}/${f.folder}`) })) };
    },
  };
}

module.exports = { checkTarget, makeExporter };
