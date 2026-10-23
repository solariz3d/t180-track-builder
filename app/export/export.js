// export.js: the app's Export button, minus the button. It checks where the user wants the track, runs
// src/export/fromwords.js exportTrack() UNCHANGED against an in-memory disk (app/export/node-shim.js), and hands back
// each folder's files for the native side to write into the folder the user picked (src-tauri/src/lib.rs write_export).
//
//   const exporter = await makeExporter(get);            // get(path) -> text, as app/lib/cjs.js takes it
//   exporter.checkTarget(dir)  -> { ok } | { ok: false, code, reason }
//   exporter.run(doc, { variant })  -> { result, folders: [{ folder, files: [{ path, bytes }] }] }   (throws ExportError)
//   exporter.runSegments(segments, { name, description?, via? }, { variant })   the same, for the equation core (D186)
//   await exporter.runSegmentsAsync(segments, meta, opts)   the same answer, the export run IN A PROCESS OF ITS OWN (D437b, app/export/exportrunner.js) when
//     the page can give it one, so an export that runs out of memory ends with a message naming the stage and the page stays drawn; on the page
//     (runSegments) where it cannot (node, the tests). It rejects with an ExportError: the export's own refusal as it is, or EXPORT_FAILED (it threw)
//     or EXPORT_LOST (its process died: "the export ran out of memory building the pit-lane check"), each saying nothing was written
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
const EJ = require('./exportjob.js');

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

/**
 * Load the exporter into this realm with the node shim, the way the webview runs it. `get` fetches source text.
 * D365: `author` is a function giving the author name (Settings ▸ Author name), read at every export, so Export, Test export and Install all
 * write it; none, a blank name, or a function that throws gives today's author (src/export/fromwords.js authorOf). An opts.author given to
 * run/runSegments wins.
 */
/**
 * D437b: `runner` is the export's own process (app/export/exportrunner.js createExportRunner); left out, a page that has a document and Web Workers
 * makes one the first time it exports (the files it boots with are the ones this exporter loaded), and null exports on the page. A function is called
 * once, with sources() -> { worker, files }, and returns the runner (app/test/export-isolated-page.test.js wraps the worker's text this way).
 */
async function makeExporter(get, { author = null, runner: given } = {}) {
  const shim = createShim();
  const files = new Map();   // D437b: every file the exporter's modules were read from, for the export's own process (it cannot fetch them)
  const keep = (p) => Promise.resolve(get(p)).then((t) => { files.set(p, t); return t; });
  const fromwords = await loadCjs('src/export/fromwords.js', keep, { builtins: shim.builtins, globals: { Buffer: shim.Buffer } });
  let runner = given, booted = null;
  const bootFiles = () => booted || (booted = (async () => {
    await loadCjs('src/core/adapter.js', keep, { builtins: shim.builtins, globals: { Buffer: shim.Buffer } });   // the core's lift (exportjob.js runJob)
    for (const p of ['app/lib/cjs.js', 'app/export/node-shim.js', 'app/export/exportjob.js']) await keep(p);
    return { worker: await get('app/export/exportworker.js'), files: Object.fromEntries(files) };
  })());
  const runnerNow = () => {
    if (typeof runner === 'function') runner = runner(bootFiles);
    if (runner !== undefined) return runner;
    runner = null;
    if (typeof document !== 'undefined' && document && typeof Worker === 'function') {
      try { runner = require('./exportrunner.js').createExportRunner({ document, sources: bootFiles }); } catch (e) { runner = null; }
    }
    return runner;
  };
  const lose = (code, words, extra) => new fromwords.ExportError(code, `${words}. Nothing was written; the track is as it was`, extra);
  // an answer from the export's own process, back into what runSegments would have returned or thrown
  const settle = (a) => {
    if (a.out) return a.out;
    const e = a.error || {}, extra = {};
    if (Array.isArray(e.red)) extra.red = e.red;
    if (e.markerChecks) extra.markerChecks = e.markerChecks;
    if (e.name === 'ExportError') throw new fromwords.ExportError(e.code, String(e.message).replace(`${e.code}: `, ''), extra);   // the export's own refusal, as it was
    if (/allocation failed|out of memory/i.test(e.message || '')) throw lose('EXPORT_LOST', `the export ran out of memory ${e.stage} (${e.message})`);
    throw lose('EXPORT_FAILED', `the export failed ${e.stage}: ${e.message}`);
  };
  const authorNow = (given) => { if (given !== undefined) return given; if (typeof author !== 'function') return undefined; try { return author(); } catch (e) { return undefined; } };
  const ex = {
    checkTarget,
    resolveTarget,
    removeEmptyNote,
    ExportError: fromwords.ExportError,
    // textures: the texture set the textures panel announces (the one the preview draws), or null
    run(doc, { variant = 'block', textures = null, author: a } = {}) {
      shim.reset();
      const result = fromwords.exportTrack(doc, { outDir: OUT, variant, textures, author: authorNow(a) });   // no selfCheck: the check is always on
      return { result, folders: result.folders.map((f) => ({ folder: f.folder, files: shim.files(`${OUT}/${f.folder}`) })) };
    },
    // the equation core's track (D186): src/geom segments from src/core/adapter.js, through the SAME exporter
    // (fromwords.js exportSegments: the same validation, self-check, markers, read-back and AI line); the check stays on
    // markers: the grid layout (app/core/coreshell.js startLayout), or undefined for the export's default
    runSegments(segments, meta, { variant = 'block', textures = null, markers, test = false, author: a } = {}) {   // test (D243a): the TEST export of an unfinished track
      shim.reset();
      const result = fromwords.exportSegments(segments, meta, { outDir: OUT, variant, textures, markers, author: authorNow(a), ...(test ? { test: true } : {}) });
      return { result, folders: result.folders.map((f) => ({ folder: f.folder, files: shim.files(`${OUT}/${f.folder}`) })) };
    },
    // D437b: runSegments in the export's own process. The job is packed NOW, from the arguments as they are, before anything is awaited
    async runSegmentsAsync(segments, meta, opts = {}) {
      const r = runnerNow();
      // on the page, an exporter made from this one with a runSegments of its own ({ ...ex, runSegments }: the tests' stand-in for a red) is honoured
      if (!r) return (this && typeof this.runSegments === 'function' ? this : ex).runSegments(segments, meta, opts);
      const { liftDoc, ...m } = meta || {};
      const job = EJ.packJob(segments, { ...m, liftDoc }, { ...opts, author: authorNow(opts.author) });
      let a;
      try { a = await r.start({ job }).promise; } catch (e) {
        if (e && e.lost) throw lose('EXPORT_LOST', e.stage === EJ.STARTING ? 'the export could not run: its process stopped before it started' : `the export ran out of memory ${e.stage}: its process stopped`);
        if (e && e.cancelled) throw lose('EXPORT_CANCELLED', 'the export was cancelled');
        throw lose('EXPORT_FAILED', `the export could not run: ${String((e && e.message) || e)}`);
      }
      return settle(a);
    },
  };
  return ex;
}

module.exports = { checkTarget, makeExporter };
