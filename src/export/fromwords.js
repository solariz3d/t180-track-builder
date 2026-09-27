// fromwords.js: a document of words becomes a complete AC track folder, through code alone (ARCHITECTURE §5c, §6; the
// overnight plan's step 4). No game is launched and nothing is placed by hand.
//
//   buildExport(doc, opts)            -> { scene, kn5, ai, path, segments, validation, markers, warnings, ... }  (writes nothing)
//   exportTrack(doc, { outDir, variant = 'block', ...opts }) -> { folders: [{ variant, folder, dir, files }], kn5Sha, warnings, ... }
//
// THE PIPELINE, each part called and none edited:
//   A's src/doc resolve → C's src/geom buildPath + buildMesh (with its self-intersection check) → the markers, generated
//   here from the words → T1's validateScene → E's src/validate → the §5c marker checks (src/export/markers.js) → T1's
//   writeKn5, read back by tools/kn5.cjs → A's src/export/ailine.js → src/export/trackfiles.js for every other file.
//
// REFUSED (ExportError, err.code), before ANYTHING is written:
//   EMPTY_DOC          no words, or no road
//   OPEN_TRACK         the loop is not closed: an AC lap needs one, and the AI line must close (ailine NOT_CLOSED).
//                      src/doc/connector.js closeLoop closes a document.
//   NOT_CLOSED         the geometry refuses the closure (buildPath's own message)
//   RED                validation is red; err.red lists every range with its reason and FINDINGS/ARCHITECTURE source.
//                      A lap proof that FAILS (lap.ok === false) is red too, reason 'lap-proof' (ARCHITECTURE.md:88-89).
//   NO_START_STRAIGHT  no straight long enough, and flat enough across, for the grid, the pits and the hotlap start
//   BAD_SCENE          T1's validateScene refused the scene
//   MARKERS            a §5c marker check is red (every problem is listed)
//   NOT_OURS           the target folder exists and was not written by this builder (no .t180b-builder.json)
// AMBER EXPORTS, WITH A WARNING: every amber range, a lap that could not run (no speed model), each check validation
// lists as not done, and duplicate mesh-node names (see below).
//
// SELF-INTERSECTION is C's BVH (buildMesh selfCheck), ON by default: its findings are red. `selfCheck: false` turns it
// off, and the result then says so in its warnings. On 2026-09-27 it reports crossings that its own rules exclude, on
// a 7.4 km sample loop: cell 1ROAD_w1_0 "meets" 1ROAD_w1_0 at s 70 and 90 m, 20 m apart, inside the 25 m same-pass
// window bvh.js never tests, and one hit carries sOther null. The parts of a word share one cell name (the DEFECT
// below), the likely cause (inferred, not traced). Until that is fixed, a default export of such a track is refused.
//
// THE NOBLOCK VARIANT. A missing soft-collision block is RED (ARCHITECTURE §4). The folder without it exists only as the
// control of the registered soft-road prediction (§10.1), so it is written only when asked for by name (variant
// 'noblock' or 'both'), and it carries that red as a warning naming why it was written anyway. Validation itself runs
// with the block present, so every OTHER red still refuses both folders.
//
// THE MARKERS (§5c), placed in track coordinates on the LONGEST STRAIGHT: the run of consecutive `straight` road
// segments with no yaw, pitch or roll. From its far end backwards: the start line (AC_TIME_0_L/R, a gate across the
// floor), the grid (AC_START_0 is pole, two staggered columns), the pit boxes, then the hotlap start behind all of them
// so the car runs up to the line. v1 builds no pit lane (§5c's side road is not built), so the boxes sit single file on
// the start straight behind the grid: a placement choice, stated here, not a measurement. Every marker stands `height`
// above the surface along its normal and points along the road. The distances are DEFAULTS (inferred, not measured):
// lineMarginM 15, poleBackM 10, gridBackM 8, pitBackM 8, hotlapBackM 12, height 1.5, gridU 3.
//
// THE AI LINE is A's generator in its 'floor' mode: the centre of the floor, at one speed. Its 'wall' mode reads the
// platform test's own wall constants (ailine.js wallTarget: WF 5, LW 8), which an arbitrary profile does not have, so it
// is not used here. The speed is the slowest design speed when every road word has one, else A's default (300 km/h).
// AC accepting generated speed fields is UNVERIFIED (ARCHITECTURE §6).
//
// DUPLICATE NODE NAMES. buildMesh names a word's three parts' cells alike (INTERFACES §2, the DEFECT, fixed in C's
// mesh.js). Nothing measured says AC breaks on it, so it is a warning here, not a refusal; the MARKER names, which AC
// looks up by name, are checked unique and refused otherwise.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const D = require('../doc/index.js');
const { buildPath, buildMesh } = require('../geom/index.js');
const Prof = require('../geom/profile.js');
const { validate } = require('../validate/index.js');
const { validateScene } = require('./scene.js');
const { writeKn5 } = require('./kn5write.js');
const { checkMarkers } = require('./markers.js');
const trackfiles = require('./trackfiles.js');
const ailine = require('./ailine.js');
const { readKn5 } = require('../../tools/kn5.cjs');

const MARKER_FILE = '.t180b-builder.json';   // the same ownership marker scripts/build_platform_test.js writes
const LAYOUT = { lineMarginM: 15, poleBackM: 10, gridBackM: 8, pitBackM: 8, hotlapBackM: 12, height: 1.5, gridU: 3, grid: 4, pits: 2 };
const SLOT_HALF_WIDTH = 1.0;                 // src/export/markers.js DEFAULTS.slotHalfWidth
const VARIANTS = { block: [{ variant: 'block', suffix: '', softCollision: true }], noblock: [{ variant: 'noblock', suffix: '_noblock', softCollision: false }] };
VARIANTS.both = [...VARIANTS.block, ...VARIANTS.noblock];

class ExportError extends Error {
  constructor(code, message, extra = {}) { super(`${code}: ${message}`); this.name = 'ExportError'; this.code = code; Object.assign(this, extra); }
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 0 ? mul(a, 1 / l) : [0, 0, 0]; };
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** The folder name: t180b_ plus the document's name, lower-case, [a-z0-9_] only. */
function folderName(doc) {
  const slug = String(doc.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `t180b_${slug || 'track'}`;
}

/** Resolve a closed document. Until resolve takes a closed document itself (it throws CLOSE_NOT_BUILT), resolve it open
 *  and let the geometry close it: the same route A's src/doc/connector.js marginOf uses. */
function resolveClosed(doc) {
  try { return { r: D.resolve(doc), via: 'resolve' }; } catch (e) {
    if (e.code !== 'CLOSE_NOT_BUILT') throw e;
    return { r: D.resolve({ ...doc, closed: false }), via: 'resolve-open, buildPath closed (connector.js marginOf route; resolve throws CLOSE_NOT_BUILT)' };
  }
}

/** The path's samples, less the closed loop's return to s = 0 (buildPath gives one sample per s otherwise). */
function stations(p) {
  const out = p.samples.slice();
  if (p.closed && out.length > 1 && Math.abs(out[out.length - 1].s - p.lengthM) < 1e-6) out.pop();
  return out;
}

/** Half-width of the flat floor (ψ = 0 on both sides of the centreline) of a normalised profile. */
function floorHalf(P) {
  const i0 = P.u.indexOf(0); let r = i0, l = i0;
  while (r > 0 && P.psi[r - 1] === 0) r--;
  while (l < P.u.length - 1 && P.psi[l + 1] === 0) l++;
  return Math.min(P.u[l], -P.u[r]);
}

const isStraight = (g) => g.kind === 'road' && g.word === 'straight' && [g.k0, g.k1, g.kp0, g.kp1, g.roll0, g.roll1].every((x) => x === 0);

/** The longest run of consecutive straight segments, as { a, b, half } in s (half = its narrowest floor half-width). */
function startStraight(segs) {
  let best = null, s = 0, run = null;
  for (let g = 0; g < segs.length; g++) {
    const seg = segs[g];
    if (isStraight(seg)) {
      // the entering piece ramps from the previous road font over its first metres (mesh.js FONT RAMPS): count that floor too
      const prev = run ? null : segs.slice(0, g).reverse().find((x) => x.kind === 'road');
      const h = Math.min(floorHalf(Prof.normalize(seg.profile)), prev ? floorHalf(Prof.normalize(prev.profile)) : Infinity);
      run = run ? { ...run, b: s + seg.length, half: Math.min(run.half, h) } : { a: s, b: s + seg.length, half: h };
      if (!best || run.b - run.a > best.b - best.a) best = run;
    } else run = null;
    s += seg.length;
  }
  return best;
}

/** A marker dummy at station s (snapped to the nearest station), u across (+ left), height h along the surface normal. */
function marker(st, segs, name, s, u, h) {
  let i = 0; for (let k = 1; k < st.length; k++) if (Math.abs(st[k].s - s) < Math.abs(st[i].s - s)) i = k;
  const sm = st[i], P = Prof.normalize(segs[sm.seg].profile);
  const [X, Y] = Prof.offsetAt(P, u), [nl, nu] = Prof.normalAt(P, u);
  const up = unit(add(mul(sm.L, nl), mul(sm.U, nu)));
  const fwd = unit(add(sm.T, mul(up, -dot(sm.T, up)))), left = cross(up, fwd);
  const pos = add(add(sm.pos, add(mul(sm.L, X), mul(sm.U, Y))), mul(up, h));
  return { type: 'dummy', name, matrix: [...left, 0, ...up, 0, ...fwd, 0, ...pos, 1], children: [], track: { s: sm.s, u, h } };
}

/** Every §5c marker, generated from the words. */
function markersFor(segs, st, o) {
  const run = startStraight(segs);
  const need = o.lineMarginM + o.poleBackM + o.gridBackM * (o.grid - 1) + o.pitBackM * o.pits + o.hotlapBackM;
  if (!run) throw new ExportError('NO_START_STRAIGHT', 'the track has no straight word to put the grid on');
  if (run.b - run.a < need) throw new ExportError('NO_START_STRAIGHT', `the longest straight is ${(run.b - run.a).toFixed(1)} m; a grid of ${o.grid} and ${o.pits} pit boxes with a hotlap start need ${need.toFixed(1)} m`);
  const gridU = Math.min(o.gridU, run.half - SLOT_HALF_WIDTH - 0.5), gateU = run.half - 0.5;
  if (!(gridU > SLOT_HALF_WIDTH) || !(gateU > 1)) throw new ExportError('NO_START_STRAIGHT', `the start straight's floor is ${(2 * run.half).toFixed(2)} m wide, too narrow for a two-column grid`);
  const line = run.b - o.lineMarginM, out = [];
  let s = line - o.poleBackM;
  for (let n = 0; n < o.grid; n++, s -= o.gridBackM) out.push(marker(st, segs, `AC_START_${n}`, s, n % 2 ? -gridU : gridU, o.height));
  s += o.gridBackM - o.pitBackM;
  for (let k = 0; k < o.pits; k++, s -= o.pitBackM) out.push(marker(st, segs, `AC_PIT_${k}`, s, 0, o.height));
  out.push(marker(st, segs, 'AC_HOTLAP_START_0', s + o.pitBackM - o.hotlapBackM, 0, o.height));
  out.push(marker(st, segs, 'AC_TIME_0_L', line, +gateU, o.height));
  out.push(marker(st, segs, 'AC_TIME_0_R', line, -gateU, o.height));
  return { nodes: out, straight: run, line };
}

/** A's AI generator reads a design { stations } and one right → left cross-section per station, centre vertex in the middle. */
function aiInput(segs, p, K = 16) {
  const all = stations(p), dsn = { stations: [], length: p.lengthM }, secs = [];
  let lastKept = -1;
  all.forEach((sm, i) => {
    const g = segs[sm.seg];
    if (g.kind !== 'road') return;
    if (lastKept >= 0 && i > lastKept + 1) dsn.stations[dsn.stations.length - 1].gapNext = true;   // stations dropped: a jump's flight
    const P = Prof.normalize(g.profile), r = P.u[0], l = P.u[P.u.length - 1];
    const us = [...Array.from({ length: K }, (_, j) => r * (1 - j / K)), 0, ...Array.from({ length: K }, (_, j) => l * ((j + 1) / K))];
    const pts = [], nrm = [];
    for (const u of us) { const [X, Y] = Prof.offsetAt(P, u), [nl, nu] = Prof.normalAt(P, u); pts.push(add(sm.pos, add(mul(sm.L, X), mul(sm.U, Y)))); nrm.push(unit(add(mul(sm.L, nl), mul(sm.U, nu)))); }
    dsn.stations.push({ s: sm.s, kappa: dot(sm.kvec, sm.L), gapNext: false });
    secs.push({ P: pts, N: nrm, font: [P.font, Prof.maxPsi(P) * 180 / Math.PI] });
    lastKept = i;
  });
  return { dsn, secs };
}

const rangeText = (x) => `${x.reason}${x.detail ? ` [${x.detail}]` : ''} at s ${x.s0.toFixed(1)}–${x.s1.toFixed(1)} m${x.source ? ` (${x.source})` : ''}`;

/** Everything up to the bytes, and nothing written. Throws ExportError on every refusal. */
function buildExport(doc, opts = {}) {
  try { D.checkDoc(doc); } catch (e) { throw new ExportError('BAD_DOC', e.message); }
  if (!doc.words.length) throw new ExportError('EMPTY_DOC', 'the document has no words');
  if (!doc.closed) throw new ExportError('OPEN_TRACK', 'the loop is not closed: an AC lap needs a closed loop, and the AI line must close. Close it first (src/doc/connector.js closeLoop)');
  const o = { step: 2, csp: true, ...LAYOUT, ...opts };
  const { r, via } = resolveClosed(doc), segs = r.segments;
  if (!segs.some((g) => g.kind === 'road')) throw new ExportError('EMPTY_DOC', 'the document resolves to no road');
  let p;
  try { p = buildPath(segs, { step: o.step, closed: true }); } catch (e) { throw new ExportError('NOT_CLOSED', e.message); }
  const selfCheck = o.selfCheck !== false;
  const mesh = buildMesh(p, segs, { ...(o.mesh || {}), selfCheck });
  const warnings = [];
  if (!selfCheck) warnings.push('self-intersection NOT checked: selfCheck is false (ARCHITECTURE.md:58, :84)');

  // validation first: a red refuses, amber warns
  const v = validate(p, segs, { csp: o.csp, softCollision: true, folds: mesh.folds });
  const red = [...v.red];
  if (v.lap && v.lap.ok === false) {
    const w = v.lap.where, ss = w.map((x) => x.s);
    red.push({ reason: 'lap-proof', s0: Math.min(...ss), s1: Math.max(...ss), source: 'ARCHITECTURE.md:88-89', where: w, detail: w.map((x) => `${x.reason} at s ${x.s.toFixed(1)} m`).join(', ') });
  }
  if (red.length) throw new ExportError('RED', `validation is red, nothing written: ${red.map(rangeText).join('; ')}`, { red });
  for (const a of v.amber) warnings.push(`amber: ${rangeText(a)}`);
  if (v.lap && v.lap.ok === null) warnings.push(`lap proof not run: ${v.lap.reason}`);
  for (const n of v.notChecked || []) warnings.push(`not checked by validation: ${n}`);

  // markers, from the words
  const st = stations(p), mk = markersFor(segs, st, o);
  const scene = { ...mesh.scene, root: { ...mesh.scene.root, children: [...mesh.scene.root.children, ...mk.nodes] } };
  const names = new Map();
  (function walk(n) { names.set(n.name, (names.get(n.name) || 0) + 1); for (const c of n.children || []) walk(c); })(scene.root);
  const dupMarkers = [...names].filter(([k, c]) => c > 1 && /^AC_/.test(k)).map(([k]) => k);
  if (dupMarkers.length) throw new ExportError('MARKERS', `marker names appear twice: ${dupMarkers.join(', ')}`);
  const dup = [...names].filter(([, c]) => c > 1);
  if (dup.length) warnings.push(`${dup.length} mesh-node names repeat (e.g. ${dup[0][0]} ×${dup[0][1]}); INTERFACES §2 DEFECT, C's mesh.js safeId`);
  try { validateScene(scene); } catch (e) { throw new ExportError('BAD_SCENE', e.message); }
  const mc = checkMarkers(scene, { expectedPits: o.pits });
  if (!mc.ok) throw new ExportError('MARKERS', mc.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.problems.join('; ')}`).join(' | '), { markerChecks: mc });

  // the kn5, read back by our own reader (ARCHITECTURE §6 self-test) before any folder is touched
  const kn5 = Buffer.from(writeKn5(scene));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-')), tf = path.join(tmp, 'readback.kn5');
  let back;
  try { fs.writeFileSync(tf, kn5); back = readKn5(tf); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  // the AI line
  const speeds = segs.filter((g) => g.kind === 'road').map((g) => g.speed);
  const speedKmh = o.aiSpeedKmh !== undefined ? o.aiSpeedKmh : speeds.every((x) => Number.isFinite(x) && x > 0) ? Math.min(...speeds) * 3.6 : undefined;
  const { dsn, secs } = aiInput(segs, p);
  const line = ailine.generateAiLine(dsn, secs, { mode: 'floor', speedKmh, DS: o.step });
  const ai = ailine.encodeAiLine(line);
  ailine.readAiLine(ai);

  const turn = segs.reduce((a, g) => a + ((g.k0 + g.k1) / 2) * g.length, 0);
  return {
    folder: o.folder || folderName(doc), scene, kn5, ai, path: p, segments: segs, resolvedVia: via, validation: v, markers: mk, markerChecks: mc,
    readback: { version: back.version, meshes: back.meshes.length, dummies: back.dummies.map((d) => d.name) },
    aiLine: { points: line.points.length, lengthM: line.points[line.points.length - 1].length + line.extra[line.extra.length - 1].length, speedKmh: line.speedKmh },
    desc: { name: doc.name || 'Untitled', description: 'Built from words by t180-track-builder.', length: p.lengthM, run: turn >= 0 ? 'counterclockwise' : 'clockwise', tags: ['t180', 'original'], author: 't180-track-builder', version: '0.1' },
    warnings,
  };
}

/** Write one folder under outDir. A folder that exists without our marker file is refused untouched; nothing is deleted. */
function writeFolder(b, outDir, v) {
  const folder = b.folder + v.suffix;
  if (!/^t180b_[a-z0-9_]+$/.test(folder)) throw new ExportError('BAD_FOLDER', `"${folder}" is not a t180b_* folder name`);
  const dir = path.join(outDir, folder);
  if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, MARKER_FILE))) throw new ExportError('NOT_OURS', `${dir} exists and was not written by t180-track-builder (no ${MARKER_FILE}); nothing touched`);
  fs.mkdirSync(dir, { recursive: true });
  const kn5Name = `${b.folder}.kn5`;
  fs.writeFileSync(path.join(dir, kn5Name), b.kn5);
  const files = [kn5Name, ...trackfiles.writeTrackFiles(dir, b.scene, { softCollision: v.softCollision, kn5Files: [kn5Name], desc: b.desc })];
  fs.mkdirSync(path.join(dir, 'ai'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ai', 'fast_lane.ai'), b.ai);
  files.push('ai/fast_lane.ai');
  fs.writeFileSync(path.join(dir, MARKER_FILE), JSON.stringify({ tool: 't180-track-builder', module: 'src/export/fromwords.js', written: new Date().toISOString(), files }, null, 2) + '\n');
  return { variant: v.variant, folder, dir, files };
}

function exportTrack(doc, { outDir, variant = 'block', ...opts } = {}) {
  if (!outDir) throw new ExportError('NO_OUT_DIR', 'exportTrack needs an outDir');
  const vs = VARIANTS[variant];
  if (!vs) throw new ExportError('BAD_VARIANT', `variant "${variant}" is not block, noblock or both`);
  const b = buildExport(doc, opts);
  const folders = vs.map((v) => writeFolder(b, outDir, v));
  const warnings = [...b.warnings];
  if (vs.some((v) => !v.softCollision)) warnings.push('noblock: the folder WITHOUT the soft-collision block is RED by ARCHITECTURE §4 (a missing soft-collision block); written only as the §10.1 soft-road control, on request');
  return { folders, kn5Sha: sha256(b.kn5), kn5Bytes: b.kn5.length, aiSha: sha256(b.ai), aiLine: b.aiLine, readback: b.readback, lengthM: b.path.lengthM, resolvedVia: b.resolvedVia, markers: b.markers.nodes.map((n) => ({ name: n.name, ...n.track })), warnings };
}

module.exports = { exportTrack, buildExport, ExportError, folderName, LAYOUT, MARKER_FILE, _internal: { startStraight, floorHalf, stations, aiInput, markersFor } };
