// layouts.js: a PROJECT (src/doc/project.js) exported as ONE AC track folder with one layout per document (ARCHITECTURE
// §11.1: "layouts as separate documents (Aurora's two layouts are separate model files, not shared road)").
//
//   exportProject(project, { outDir, ...buildExport opts }) -> { folder, dir, files, layouts: [{ layout, kn5Sha, ... }] }
//
// THE AC LAYOUT CONVENTION, as a two-layout track on this machine lays it out (read locally, 2026-09-27:
// content/tracks/cash_auroracryopticon has models_aurora_long.ini and models_aurora_medium.ini at its root, the folders
// aurora_long/{ai, data/*.ini, map.png} and ui/aurora_long/{ui_track.json, preview.png, outline.png}; ks_nordschleife
// the same with models_endurance.ini and endurance/, ui/endurance/). So, per layout L of folder F:
//   F/F_L.kn5                  the layout's own model (separate files, as Aurora's are: not shared road)
//   F/models_L.ini             naming that kn5
//   F/L/data/surfaces.ini, F/L/data/map.ini, F/L/map.png, F/L/ai/fast_lane.ai
//   F/ui/L/ui_track.json, F/ui/L/preview.png, F/ui/L/outline.png
// src/export/trackfiles.js already knows a layout in exactly one place, modelsIniName(layout) -> models_<layout>.ini
// (trackfiles.js:43); its writeTrackFiles writes the NO-layout set (models.ini, data/, ui/ at the root). This file uses
// trackfiles' pure builders (surfacesIni, modelsIni, uiTrack, mapParams, mapIni, mapPng, previewPng, outlinePng) and
// places them the layout way; trackfiles.js is not changed.
// Every layout is built (buildExport, every check ON) BEFORE anything is written, so one red layout writes nothing.
// A folder that exists without this builder's marker file is refused untouched (NOT_OURS), as exportTrack does.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildExport, ExportError, folderName, MARKER_FILE } = require('./fromwords.js');
const tf = require('./trackfiles.js');
const { gripsOf } = require('./gripkeys.js');

function exportProject(project, { outDir, softCollision = true, t180 = true, ...opts } = {}) {
  if (!outDir) throw new ExportError('NO_OUT_DIR', 'exportProject needs an outDir');
  if (!project.layouts.length) throw new ExportError('EMPTY_DOC', 'the project has no layouts');
  const folder = folderName({ name: project.name });
  if (!/^t180b_[a-z0-9_]+$/.test(folder)) throw new ExportError('BAD_FOLDER', `"${folder}" is not a t180b_* folder name`);
  const built = project.layouts.map((l) => {
    try { return { layout: l.layout, b: buildExport(l.doc, opts) }; } catch (e) { if (e instanceof ExportError) e.message = `layout ${l.layout}: ${e.message}`; throw e; }
  });
  const dir = path.join(outDir, folder);
  if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, MARKER_FILE))) throw new ExportError('NOT_OURS', `${dir} exists and was not written by t180-track-builder (no ${MARKER_FILE}); nothing touched`);
  const files = {};
  for (const { layout: L, b } of built) {
    const kn5 = `${folder}_${L}.kn5`, mp = tf.mapParams(b.scene);
    Object.assign(files, {
      [kn5]: b.kn5,
      [tf.modelsIniName(L)]: tf.modelsIni([kn5]),
      [`${L}/data/surfaces.ini`]: tf.surfacesIni({ softCollision: !!t180 && softCollision, extendedPhysics: !!t180, grips: gripsOf(b.scene) }),
      [`${L}/data/map.ini`]: tf.mapIni(mp),
      [`${L}/map.png`]: tf.mapPng(b.scene, mp),
      [`${L}/ai/fast_lane.ai`]: b.ai,
      [`ui/${L}/ui_track.json`]: JSON.stringify(tf.uiTrack(b.scene, { ...b.desc, name: `${b.desc.name} (${L})` }), null, 2) + '\n',
      [`ui/${L}/preview.png`]: tf.previewPng(b.scene),
      [`ui/${L}/outline.png`]: tf.outlinePng(b.scene),
    });
  }
  for (const [rel, body] of Object.entries(files)) { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); }
  const list = Object.keys(files);
  fs.writeFileSync(path.join(dir, MARKER_FILE), JSON.stringify({ tool: 't180-track-builder', module: 'src/export/layouts.js', written: new Date().toISOString(), files: list }, null, 2) + '\n');
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  return { folder, dir, files: list, warnings: t180 ? [tf.CSP_ONLY_WARNING] : [], layouts: built.map(({ layout, b }) => ({ layout, kn5Sha: sha(b.kn5), lengthM: b.path.lengthM, pitLane: !!b.pitLane, warnings: b.warnings })) };
}

module.exports = { exportProject };
