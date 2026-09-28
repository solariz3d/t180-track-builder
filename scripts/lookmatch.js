#!/usr/bin/env node
// lookmatch.js: the look-match reference views (ARCHITECTURE §5.3), the builder's side. D179.
//
//   node scripts/lookmatch.js render --ac <Assetto Corsa folder> --out <folder OUTSIDE this repository> [--views id,id]
//       renders every view of src/lookmatch/views.json (or the ones named) from the track's own kn5 files, in the
//       builder's look (src/lookmatch/raster.js), as <out>/<id>.png, and writes <out>/views-resolved.json: each view's
//       world camera pose, so the same view can be set up in AC for the reference shot.
//   node scripts/lookmatch.js diff --ref <folder of AC shots, <id>.png> --ours <the render folder>
//       the look-match number per view (src/lookmatch/metric.js: mean CIEDE2000, with the 95th percentile). Without
//       reference shots it says so: the number is PARKED until the keeper takes them (the keeper, 12:17).
//
// NOTHING IS WRITTEN INTO THE REPOSITORY: our render of another author's track (Sakura, Centrifuge) is theirs to share,
// not ours, so --out inside this repository is refused. The AC folder is only READ. No game is launched.
'use strict';
const fs = require('fs'), path = require('path');
const { loadViews, resolveView } = require('../src/lookmatch/cameras.js');
const { readScene } = require('../src/lookmatch/kn5scene.js');
const { decodeDds } = require('../src/lookmatch/dds.js');
const { renderView } = require('../src/lookmatch/raster.js');
const { compareImages } = require('../src/lookmatch/metric.js');
const { decodeImage } = require('../src/texture/image.js');
const { encodePng } = require('../src/export/trackfiles.js');

const REPO = path.resolve(__dirname, '..');
const VIEWS_FILE = path.join(REPO, 'src', 'lookmatch', 'views.json');

function parseArgs(argv) {
  const o = { cmd: argv[0] };
  if (o.cmd !== 'render' && o.cmd !== 'diff') throw new Error('lookmatch: the first argument is "render" or "diff"');
  for (let i = 1; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (v === undefined) throw new Error(`lookmatch: ${k} needs a value`);
    if (k === '--ac') o.ac = v; else if (k === '--out') o.out = v; else if (k === '--views') o.views = v.split(',');
    else if (k === '--ref') o.ref = v; else if (k === '--ours') o.ours = v;
    else throw new Error(`lookmatch: unknown argument ${k}`);
  }
  if (o.cmd === 'render') {
    if (!o.ac || !o.out) throw new Error('lookmatch render: needs --ac <Assetto Corsa folder> and --out <folder>');
    if (insideRepo(o.out)) throw new Error(`lookmatch render: --out ${o.out} is inside the repository; a render of another author's track must not be committed. Write it outside.`);
  } else if (!o.ref || !o.ours) throw new Error('lookmatch diff: needs --ref <AC shots> and --ours <renders>');
  return o;
}
/** True for a path at or under the repository root (symlinks are not followed: a lexical check on the resolved path). */
function insideRepo(p) { const rel = path.relative(REPO, path.resolve(p)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }

/** One scene from a track's models: materials and meshes concatenated (each model's material indices offset), textures merged. */
function trackScene(acRoot, track) {
  const dir = path.join(acRoot, 'content', 'tracks', track.folder), all = { textures: new Map(), materials: [], meshes: [], dummies: [] };
  for (const f of track.models) {
    const s = readScene(fs.readFileSync(path.join(dir, f))), base = all.materials.length;
    for (const t of s.textures) if (!all.textures.has(t.name)) all.textures.set(t.name, t.bytes);
    all.materials.push(...s.materials); all.meshes.push(...s.meshes.map((m) => ({ ...m, material: m.material + base }))); all.dummies.push(...s.dummies);
  }
  return all;
}
/** The textures as RGBA: DDS (src/lookmatch/dds.js), PNG and JPEG (src/texture/image.js). A texture it cannot decode is left out, and named. */
function decodeAll(textures) {
  const out = new Map(), skipped = [];
  for (const [name, bytes] of textures) {
    try {
      const head = bytes.toString('latin1', 0, 4);
      const img = head === 'DDS ' ? decodeDds(bytes) : decodeImage(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      if (img) out.set(name, { width: img.width, height: img.height, rgba: img.rgba }); else skipped.push(`${name} (format not decoded)`);
    } catch (e) { skipped.push(`${name} (${e.message})`); }
  }
  return { images: out, skipped };
}

function render(o) {
  const V = loadViews(fs.readFileSync(VIEWS_FILE, 'utf8')), want = o.views ? V.views.filter((v) => o.views.includes(v.id)) : V.views;
  if (o.views && want.length !== o.views.length) throw new Error(`lookmatch render: no view called ${o.views.filter((id) => !V.views.some((v) => v.id === id)).join(', ')}`);
  fs.mkdirSync(o.out, { recursive: true });
  const resolved = [], byTrack = new Map();
  for (const v of want) { if (!byTrack.has(v.track)) byTrack.set(v.track, []); byTrack.get(v.track).push(v); }
  for (const [track, views] of byTrack) {
    const t0 = Date.now(), scene = trackScene(o.ac, V.tracks[track]), tex = decodeAll(scene.textures);
    for (const v of views) {
      const cam = resolveView(v, scene.dummies), t1 = Date.now(), img = renderView(scene, cam, { textures: tex.images });
      fs.writeFileSync(path.join(o.out, `${v.id}.png`), encodePng(img.width, img.height, Buffer.from(img.rgba.buffer, img.rgba.byteOffset, img.rgba.byteLength)));
      resolved.push({ ...cam, track, file: `${v.id}.png`, ms: Date.now() - t1, loadMs: t1 - t0, stats: img.stats, texturesSkipped: tex.skipped });
      process.stderr.write(`lookmatch: ${v.id} ${Date.now() - t1} ms, ${img.stats.pixels} pixels drawn\n`);
    }
  }
  fs.writeFileSync(path.join(o.out, 'views-resolved.json'), JSON.stringify({ note: 'World camera poses (the kn5\'s own coordinates, y up) of the look-match views, for setting up the same views in AC. PARKED: no AC reference shot is taken by this tool.', views: resolved }, null, 1));
  return resolved;
}

function diff(o) {
  const V = loadViews(fs.readFileSync(VIEWS_FILE, 'utf8')), rows = [];
  for (const v of V.views) {
    const a = path.join(o.ref, `${v.id}.png`), b = path.join(o.ours, `${v.id}.png`);
    if (!fs.existsSync(a)) { rows.push({ id: v.id, status: 'PARKED: no reference shot' }); continue; }
    if (!fs.existsSync(b)) { rows.push({ id: v.id, status: 'no render of ours (run render first)' }); continue; }
    const r = compareImages(decodeImage(fs.readFileSync(a)), decodeImage(fs.readFileSync(b)));
    rows.push({ id: v.id, status: 'measured', meanDE00: +r.meanDE.toFixed(3), p95DE00: +r.p95DE.toFixed(3), pixels: r.pixels });
  }
  return rows;
}

if (require.main === module) {
  let o; try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
  try { const r = o.cmd === 'render' ? render(o) : diff(o); console.log(JSON.stringify(r.map((x) => (o.cmd === 'render' ? { id: x.id, file: x.file, eye: x.eye.map((n) => +n.toFixed(2)), pixels: x.stats.pixels, ms: x.ms } : x)), null, 1)); }
  catch (e) { console.error(`lookmatch: ${e.message}`); process.exit(1); }
}
module.exports = { parseArgs, insideRepo, trackScene, decodeAll, render, diff, VIEWS_FILE, REPO };
