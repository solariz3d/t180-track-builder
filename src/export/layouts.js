// layouts.js: several tracks exported as ONE AC track folder with one layout each, the way track N lays its
// layouts out (ARCHITECTURE §11.1: "layouts as separate documents (Aurora's two layouts are separate model files, not shared road)").
//
//   exportProject(project, { outDir, ...buildExport opts }) -> { folder, dir, files, removed, layouts: [{ layout, kn5Sha, ... }] }
//   exportBuilt(entries, { outDir, name, prune }) -> the same, for layouts already built (D361: the app's saved tracks, each built
//     by the Export button's own route): entries = [{ layout, name, main, b }], b = fromwords buildFromSegments' result
//   layoutSet(folder, entries, { t180, softCollision }) -> { files: { rel: body }, layouts }   (pure: nothing written)
//   staleFiles(previousMarkerText, newPaths) -> { stale, warning }                              (pure)
//
// THE AC LAYOUT CONVENTION, as a two-layout track on this machine lays it out (read locally, 2026-09-27 and again 2026-10-17,
// exo_memory/handback/p-d360-acside-E_2026-10-17.md §1: content/tracks/trackn has models_long.ini and
// models_medium.ini at its root, the folders long/{ai, data/*.ini, map.png} and ui/long/{ui_track.json,
// preview.png, outline.png}; ks_silverstone the same). So, per layout L of folder F:
//   F/F_L.kn5                  the layout's own model, a whole road (separate files, as Aurora's are: not shared road)
//   F/models_L.ini             naming that kn5
//   F/L/data/surfaces.ini, F/L/data/map.ini, F/L/map.png, F/L/ai/fast_lane.ai
//   F/ui/L/ui_track.json, F/ui/L/preview.png, F/ui/L/outline.png
// and NOTHING at the root besides the models files and the marker: no models.ini, no data/, no ui/ui_track.json, so Content
// Manager reads every layout from ui/<L>/ (AcTools TrackObject.cs GetLayouts, master e5e5c94b :129-153).
// No layout gets an extension/ folder of its own: CSP gives every layout of a track the same config (the track H night
// layout, 2026-09-10), so anything CSP-side belongs in the ONE root extension/; this exporter writes none today.
// THE MAIN LAYOUT (G4): each ui_track.json carries "priority", the main layout 1 and the others 0. Content Manager picks a
// non-Kunos track's main layout by priority × 1e8 before any name rule (TrackObject.cs :210), so the one marked main is its default.
// RE-EXPORT (G3): the previous marker's file list, minus what this export writes, is removed, and then any folder those files
// leave empty. Only paths the marker listed, only plain files, only inside the folder: a file somebody added (an extension/
// config, a note) is never in our marker and is never touched. The app's native side does the same itself (src-tauri/src/lib.rs
// write_layouts_export), because the webview builds in memory and cannot see the old folder.
// src/export/trackfiles.js already knows a layout in exactly one place, modelsIniName(layout) -> models_<layout>.ini; this file
// uses trackfiles' pure builders and places them the layout way; trackfiles.js is not changed.
// Every layout is built (every check ON) BEFORE anything is written, so one red layout writes nothing.
// A folder that exists without this builder's marker file is refused untouched (NOT_OURS), as exportTrack does.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildExport, buildFromSegments, ExportError, folderName, MARKER_FILE } = require('./fromwords.js');
const tf = require('./trackfiles.js');
const { gripsOf } = require('./gripkeys.js');

const LAYOUT_RE = /^[a-z0-9_]{1,32}$/;   // the name AC reads a layout by (models_<L>.ini, <L>/, ui/<L>/), as src/doc/project.js has it
const MAX_NAME = 100;

/** A relative path inside the folder, by the native side's rule (src-tauri/src/lib.rs valid_rel_path): never '.', '..' or empty parts. */
function safeRel(p) {
  return typeof p === 'string' && p.length > 0 && p.length <= 200 && p.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && /^[A-Za-z0-9._-]+$/.test(part));
}

/** Check the layouts before anything is built or written: names, display names, exactly one main. Throws ExportError. */
function checkEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new ExportError('EMPTY_DOC', 'there are no layouts to export');
  const seen = new Set();
  for (const [i, e] of entries.entries()) {
    if (!e || !LAYOUT_RE.test(e.layout || '')) throw new ExportError('BAD_LAYOUT_NAME', `layout ${i + 1}: ${JSON.stringify(e && e.layout)} is not a layout name (a–z, 0–9, _; 1 to 32)`);
    if (seen.has(e.layout)) throw new ExportError('DUPLICATE_LAYOUT', `the layout name ${e.layout} is used twice`);
    seen.add(e.layout);
    if (typeof e.name !== 'string' || !e.name.trim() || e.name.length > MAX_NAME) throw new ExportError('BAD_LAYOUT_NAME', `layout ${e.layout}: its display name must be 1 to ${MAX_NAME} characters`);
  }
  const mains = entries.filter((e) => e.main === true).length;
  if (mains !== 1) throw new ExportError('MAIN_LAYOUT', `exactly one layout must be the main one; ${mains} are marked`);
}

/** Every file of the folder but the marker, for these built layouts. Pure. */
function layoutSet(folder, entries, { t180 = true, softCollision = true } = {}) {
  checkEntries(entries);
  const files = {};
  for (const { layout: L, name, main, b } of entries) {
    const kn5 = `${folder}_${L}.kn5`, mp = tf.mapParams(b.scene);
    Object.assign(files, {
      [kn5]: b.kn5,
      [tf.modelsIniName(L)]: tf.modelsIni([kn5]),
      [`${L}/data/surfaces.ini`]: tf.surfacesIni({ softCollision: !!t180 && softCollision, extendedPhysics: !!t180, grips: gripsOf(b.scene) }),
      [`${L}/data/map.ini`]: tf.mapIni(mp),
      [`${L}/map.png`]: tf.mapPng(b.scene, mp),
      [`${L}/ai/fast_lane.ai`]: b.ai,
      [`ui/${L}/ui_track.json`]: JSON.stringify({ ...tf.uiTrack(b.scene, { ...b.desc, name: name.trim() }), priority: main ? 1 : 0 }, null, 2) + '\n',
      [`ui/${L}/preview.png`]: tf.previewPng(b.scene),
      [`ui/${L}/outline.png`]: tf.outlinePng(b.scene),
    });
  }
  return { files, layouts: entries.map((e) => ({ layout: e.layout, name: e.name.trim(), main: e.main === true })) };
}

/**
 * The files a previous export listed that this one does not write: the ones to remove. Pure. A marker that cannot be read, or
 * lists no files, removes nothing and says so; a listed path that could leave the folder is never returned.
 */
function staleFiles(previousMarkerText, newPaths) {
  if (previousMarkerText == null) return { stale: [], warning: null };
  let m;
  try { m = JSON.parse(previousMarkerText); } catch (e) { return { stale: [], warning: `the previous export's ${MARKER_FILE} could not be read (${e.message}): nothing from it was removed` }; }
  if (!m || !Array.isArray(m.files)) return { stale: [], warning: `the previous export's ${MARKER_FILE} lists no files: nothing from it was removed` };
  const keep = new Set(newPaths);
  const stale = [...new Set(m.files)].filter((p) => safeRel(p) && p !== MARKER_FILE && !keep.has(p));
  const unsafe = m.files.filter((p) => !safeRel(p)).length;
  return { stale, warning: unsafe ? `${unsafe} path(s) in the previous ${MARKER_FILE} are not inside the folder and were left alone` : null };
}

/** Every folder from `dir` down to the file is a real folder (no link, no junction) and the file is a plain file. */
function plainFileInside(dir, rel) {
  const parts = rel.split('/');
  let at = dir;
  for (let i = 0; i < parts.length; i++) {
    at = path.join(at, parts[i]);
    let st;
    try { st = fs.lstatSync(at); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    if (st.isSymbolicLink() || (i + 1 === parts.length ? !st.isFile() : !st.isDirectory())) return false;
  }
  return true;
}

/** Remove the stale files (plain files only), then each folder they leave empty, up to but never the track folder itself. */
function removeStale(dir, stale) {
  const removed = [];
  for (const rel of stale) {
    const f = path.join(dir, ...rel.split('/'));
    if (!plainFileInside(dir, rel)) continue;   // gone, or a folder, a link or a junction on the way: not ours to remove
    fs.unlinkSync(f);
    removed.push(rel);
    for (let d = path.dirname(f); path.relative(dir, d) && !path.relative(dir, d).startsWith('..'); d = path.dirname(d)) {
      if (fs.readdirSync(d).length) break;
      fs.rmdirSync(d);
    }
  }
  return removed;
}

/** Write one folder of built layouts under outDir; `prune` (default on) removes what the previous export listed and this one does not. */
function exportBuilt(entries, { outDir, name, t180 = true, softCollision = true, prune = true } = {}) {
  if (!outDir) throw new ExportError('NO_OUT_DIR', 'exportBuilt needs an outDir');
  const folder = folderName({ name });
  if (!/^t180b_[a-z0-9_]+$/.test(folder)) throw new ExportError('BAD_FOLDER', `"${folder}" is not a t180b_* folder name`);
  const { files, layouts } = layoutSet(folder, entries, { t180, softCollision });
  const dir = path.join(outDir, folder), markerPath = path.join(dir, MARKER_FILE);
  if (fs.existsSync(dir) && !fs.existsSync(markerPath)) throw new ExportError('NOT_OURS', `${dir} exists and was not written by t180-track-builder (no ${MARKER_FILE}); nothing touched`);
  const list = Object.keys(files);
  const prev = prune && fs.existsSync(markerPath) ? staleFiles(fs.readFileSync(markerPath, 'utf8'), list) : { stale: [], warning: null };
  for (const [rel, body] of Object.entries(files)) { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); }
  const removed = prev.stale.length ? removeStale(dir, prev.stale) : [];
  fs.writeFileSync(markerPath, JSON.stringify({ tool: 't180-track-builder', module: 'src/export/layouts.js', written: new Date().toISOString(), layouts, files: list }, null, 2) + '\n');
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const warnings = [...(t180 ? [tf.CSP_ONLY_WARNING] : []), ...(prev.warning ? [prev.warning] : [])];
  return { folder, dir, files: list, removed, warnings, layouts: entries.map(({ layout, name: n, main, b }) => ({ layout, name: n.trim(), main: main === true, kn5Sha: sha(b.kn5), lengthM: b.path.lengthM, pitLane: !!b.pitLane, warnings: b.warnings })) };
}

/** A src/doc project (src/doc/project.js): each layout built from its document; the first is the main one, each shown as "<name> (<layout>)". */
function exportProject(project, { outDir, softCollision = true, t180 = true, ...opts } = {}) {
  if (!outDir) throw new ExportError('NO_OUT_DIR', 'exportProject needs an outDir');
  if (!project.layouts.length) throw new ExportError('EMPTY_DOC', 'the project has no layouts');
  const built = project.layouts.map((l, i) => {
    try { const b = buildExport(l.doc, opts); return { layout: l.layout, name: `${b.desc.name} (${l.layout})`, main: i === 0, b }; } catch (e) { if (e instanceof ExportError) e.message = `layout ${l.layout}: ${e.message}`; throw e; }
  });
  return exportBuilt(built, { outDir, name: project.name, t180, softCollision });
}

// buildFromSegments and ExportError ride along so the app builds and writes with ONE loaded copy of the exporter (app/menubar/layoutsexport.js)
module.exports = { exportProject, exportBuilt, layoutSet, staleFiles, LAYOUT_RE, buildFromSegments, ExportError };
