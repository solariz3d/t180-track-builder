// blender.js: writeForBlender(ex, { dir, pieces, ai }) -> { glb, readme, bytes, meshes, markers, skipped }: the export for Blender's folder write.
// `ex` is what src/export/fromwords.js buildFromSegments returns (its acScene, the kn5's own scene; its AI file; its name and whether the lap is closed).
// Writes <name>.glb (src/export/gltf.js) and README.txt into `dir` (made if missing); `pieces` (['p2', 'p7']) writes only those pieces and the markers
// among them; `ai: false` leaves the AI line out. Nothing else is touched: no AC folder, no Blender run (the FBX step is the app's, through the user's Blender).
'use strict';
const fs = require('fs'), path = require('path');
const { toGlb } = require('./gltf.js');
const { readAiLine } = require('./ailine.js');

const README = (name, r, pieces) => [
  `${name}: the track from t180-track-builder, for Blender.`,
  '',
  `${name}.glb is a glTF 2.0 file. In Blender: File > Import > glTF 2.0 (.glb/.gltf). It opens textured, in metres.`,
  '',
  'What is in it:',
  '  pNN_road        the road of piece NN (its chunks, named as in the game\'s kn5: 1ROAD_pNN_chunk_k, or 1GRIPnnn_ for a piece with its own grip)',
  '  pNN_underskin   the dark underside of piece NN (it casts the shadows)',
  '  pNN_catch       a second road surface under the road, where the export put one',
  '  pitlane_road    the pit lane\'s road',
  '  AC_...          the game\'s markers (start grid, pits, timing, hotlap) as empties: keep their names and places',
  '  ai_fast_lane    the AI line, as a line',
  ...(pieces ? ['', `Only the pieces ${pieces.join(', ')} are in this file, with the markers among them.`] : []),
  '',
  `${r.meshes} meshes, ${r.markers} markers${r.skipped.length ? `; textures left out (not readable as an image): ${r.skipped.join('; ')}` : ''}.`,
  '',
  'To the game: the community route is Blender > File > Export > FBX > ksEditor (assettocorsa\\sdk\\editor) > kn5. The FBX settings that keep the track',
  'exactly as the game had it (measured: same vertices, same metres, not mirrored): Object Types Empty and Mesh; Scale 1.00; Apply Scalings "FBX All";',
  'Forward "-Z Forward"; Up "Y Up"; Apply Unit on; Apply Transform on; Path Mode Copy with the embed button on; no animation, no leaf bones.',
  'Keep the names: the game finds the road by the 1ROAD / 1GRIP prefixes and the markers by their AC_ names.',
  '',
].join('\r\n');

/** The folder's files in memory, for the app (its native side writes them): [{ path, bytes }] with <name>.glb first, and the counts. Writes nothing. */
function blenderFiles(ex, { pieces = null, ai = true } = {}) {
  if (!ex || !ex.acScene) throw new Error('the export for Blender needs an export result with its acScene (src/export/fromwords.js buildFromSegments)');
  const name = ((ex.desc && ex.desc.name) || 'track').replace(/[^A-Za-z0-9_. -]/g, '_');
  const points = ai && ex.ai ? readAiLine(ex.ai).points.map((p) => p.pos) : null;
  const r = toGlb(ex.acScene, { name, ai: points, closed: !!(ex.path && ex.path.closed), pieces });
  return { name, files: [{ path: `${name}.glb`, bytes: r.glb }, { path: 'README.txt', bytes: Buffer.from(README(name, r, pieces), 'utf8') }], meshes: r.meshes, markers: r.markers, skipped: r.skipped };
}

function writeForBlender(ex, { dir, pieces = null, ai = true } = {}) {
  if (!dir) throw new Error('writeForBlender needs a folder');
  const b = blenderFiles(ex, { pieces, ai });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of b.files) fs.writeFileSync(path.join(dir, f.path), f.bytes);
  return { glb: path.join(dir, b.files[0].path), readme: path.join(dir, 'README.txt'), bytes: b.files[0].bytes.length, meshes: b.meshes, markers: b.markers, skipped: b.skipped };
}

/** The command line that turns <glb> into <fbx> with the user's Blender and the bundled script (src/export/blender_fbx.py): no window, nothing saved but the FBX. */
const fbxArgs = (script, glb, fbx) => ['--background', '--factory-startup', '--python', script, '--', glb, fbx];

module.exports = { writeForBlender, blenderFiles, fbxArgs };
