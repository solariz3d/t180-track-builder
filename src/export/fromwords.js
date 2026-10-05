// fromwords.js: a document of words becomes a complete AC track folder, through code alone (ARCHITECTURE §5c, §6; the
// overnight plan's step 4). No game is launched and nothing is placed by hand.
//
//   buildExport(doc, opts)            -> { scene, kn5, ai, path, segments, validation, markers, warnings, ... }  (writes nothing)
//   exportTrack(doc, { outDir, variant = 'block', t180 = true, ...opts }) -> { folders: [{ variant, folder, dir, files }], kn5Sha, warnings, ... }
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
//   PIT_LANE           the document's pit lane cannot be built (src/geom/pitlane.js names why); its crossings are RED
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
// THE "T-180 TRACK" TOGGLE (ARCHITECTURE §6), opts.t180, default on: surfaces.ini carries the soft-collision block AND
// CSP's WAV_PITCH=extended-0 surface (trackfiles.js), and the warnings carry CSP_ONLY_WARNING, because plain AC without
// CSP can crash on that file. Off, it writes neither (a track for ordinary cars), and only the block variant exists.
// The noblock control keeps the switch: it differs from the block folder by the block alone.
//
// THE MARKERS (§5c) are src/markers (D171): a LAYOUT in track coordinates, anchored to words, placed on the surface the
// mesh builds, checked by §5c's red checks (a red refuses, MARKERS), and PAINTED (start line, grid and pit boxes, as
// visual meshes generated from the markers). opts.markers is the layout (the app's markers panel); without one, the
// default layout drops the grid on the longest straight exactly where D167 did (line 15 m before its end, slots 8 m
// apart, 2 pit boxes behind), and the hotlap now starts the run-up that reaches the design speed at the line (§5c:
// "so the car arrives at speed"; 352 m at 460 km/h). opts.grid, opts.pits and opts.height still set its count, pits
// and height. T1's scene checks (./markers.js) still run on the built scene as a second, geometric check.
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
const { flattenForAc, ensureDiffuse, weldSeams } = require('./acready.js');
const { checkMarkers, walkScene, isDrivable } = require('./markers.js');
const Markers = require('../markers/index.js');
const trackfiles = require('./trackfiles.js');
const ailine = require('./ailine.js');
const PitLane = require('./pitlane.js');
const { withTextureSet } = require('../texture/set.js');
const { withUnderskin } = require('./underskin.js');
const { readKn5 } = require('../../tools/kn5.cjs');
const { placeMarker, surfaceAt } = require('../markers/place.js');
// THE TEST EXPORT OF AN UNFINISHED TRACK (D243a, the keeper: "it should allow to export even without it being completed"). opts.test, never the default:
// the path is OPEN, every red is a WARNING (listed in the folder's TEST_FILE and the message), the AI line is open, the ui name and folder say "test, unfinished",
// point-to-point gates AC_AB_START/FINISH are added, and the road ends in a NAMED end block: TEST_RUNOFF_M of road after the finish gate, then a wall
// (1WALL_T180_END, both faces). Why a run-off then a wall: every point-to-point layout in the local AC install runs its AI line 58–226 m past its finish
// gate on road, and the readable ones carry WALL meshes at that end (one ships end_barriers.kn5).
const TEST_FILE = 't180b_TEST_UNFINISHED.txt', TEST_RUNOFF_M = 150, TEST_WALL_H = 4, TEST_WALL_NAME = '1WALL_T180_END';
/** The end block: a wall across the road's last cross-section, TEST_WALL_H along the surface normal, both faces, at the path's end. */
function endWall(path, segs, material) {
  const S = path.samples, last = S[S.length - 1], g = segs[last.seg], P = Prof.normalize(Prof.readAt(g, g.length)), sEnd = last.s - 0.25;
  const us = []; for (let k = 0; k <= 24; k++) us.push(P.u[0] + (P.u[P.u.length - 1] - P.u[0]) * k / 24);
  const pos = [], nrm = [], uv = [], idx = [], n = us.length;
  for (const [r, h] of [[0, -0.3], [1, TEST_WALL_H]]) us.forEach((u, j) => { const sf = surfaceAt(path, segs, sEnd, u); pos.push(...sf.pos.map((x, i) => x + sf.n[i] * h)); nrm.push(-last.T[0], -last.T[1], -last.T[2]); uv.push(j / (n - 1), r); });
  for (let j = 0; j < n - 1; j++) { const A = j, B = j + 1, C = n + j, Dd = C + 1; idx.push(A, C, B, B, C, Dd, A, B, C, B, Dd, C); }   // both windings: the car meets it from either side
  return { type: 'mesh', name: TEST_WALL_NAME, material, positions: Float32Array.from(pos), normals: Float32Array.from(nrm), uvs: Float32Array.from(uv), indices: Uint16Array.from(idx), castShadows: true, visible: true, transparent: false, renderable: true };
}

const MARKER_FILE = '.t180b-builder.json';   // the same ownership marker scripts/build_platform_test.js writes
const LAYOUT = { height: 1.5, grid: 4, pits: 2 };   // the default layout's count, pits and height (src/markers/layout.js DEFAULTS)
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

/** A's AI generator reads a design { stations } and one right → left cross-section per station, centre vertex in the middle. */
function aiInput(segs, p, K = 16) {
  const all = stations(p), dsn = { stations: [], length: p.lengthM }, secs = [];
  const segS0 = []; { let a = p.samples[0].s; for (const g of segs) { segS0.push(a); a += g.length; } }   // where each segment starts, for a blend's distance (D190)
  let lastKept = -1;
  all.forEach((sm, i) => {
    const g = segs[sm.seg];
    if (g.kind !== 'road') return;
    if (lastKept >= 0 && i > lastKept + 1) dsn.stations[dsn.stations.length - 1].gapNext = true;   // stations dropped: a jump's flight
    const P = Prof.readAt(g, sm.s - segS0[sm.seg]), r = P.u[0], l = P.u[P.u.length - 1];
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
  const { r, via } = resolveClosed(doc);
  return buildFromSegments(r.segments, { name: doc.name, pitLane: doc.pitLane, via, description: 'Built from words by t180-track-builder.' }, opts);
}

/**
 * Everything after the words are resolved: the SAME route for any source of `src/geom` segments (D186: the equation core's
 * adapter, src/core/adapter.js toSegments, emits them too). `meta` = { name, pitLane?, via?, description?, liftPath?, start? }: the track's name
 * (the folder and ui_track.json), an optional pit lane, and how the segments were made (reported as resolvedVia). The
 * segments must close a loop (buildPath closed); everything else (validation, the mesh self-check, markers, the kn5 read back,
 * the AI line) is exactly buildExport's, because buildExport now calls this. Throws ExportError on every refusal.
 */
function buildFromSegments(segs, meta = {}, opts = {}) {
  const o = { step: 2, csp: true, ...LAYOUT, ...opts };
  const doc = { name: meta.name, pitLane: meta.pitLane || null }, via = meta.via || 'segments';
  if (!Array.isArray(segs) || !segs.some((g) => g.kind === 'road')) throw new ExportError('EMPTY_DOC', 'the document resolves to no road');
  let p;
  // meta.start (D186): where the lap starts and its heading and PITCH ({ pos, theta, p }, src/geom buildPath's start); a word
  // document resolves from the origin, level, so it has none. The geometry's shape depends on the start pitch.
  const test = o.test === true;   // D243a: the TEST export of an unfinished track (above), only when asked for
  try { p = buildPath(segs, { step: o.step, closed: !test, ...(meta.start ? { start: meta.start } : {}) }); } catch (e) { throw new ExportError('NOT_CLOSED', e.message); }
  // meta.liftPath (D186): a source whose segments do not carry the whole road (the equation core's offsets, A's adapter offsetPath)
  // lifts the path here, before the mesh, validation, markers and the AI line read it
  if (typeof meta.liftPath === 'function') p = meta.liftPath(p);
  const selfCheck = o.selfCheck !== false;
  const mesh = buildMesh(p, segs, { ...(o.mesh || {}), selfCheck });
  const warnings = [];
  if (!selfCheck) warnings.push('self-intersection NOT checked: selfCheck is false (ARCHITECTURE.md:58, :84)');

  // validation first: a red refuses, amber warns
  // the built physics road, in world space, for the downforce-ray gap check (src/validate/raygap.js; R1)
  const roadMesh = walkScene(mesh.scene).meshes.filter((m) => isDrivable(m.name) && m.indices && m.indices.length);
  const v = validate(p, segs, { csp: o.csp, softCollision: true, folds: mesh.folds, roadMesh });
  const red = [...v.red];
  // the pit lane (D174): built beside the road, self-checked against it with the same tests; its findings are red
  let pit = null;
  if (doc.pitLane) {
    try { pit = PitLane.laneForExport(p, segs, mesh, doc.pitLane, { selfCheck, mesh: o.mesh }); } catch (e) { if (e.name === 'PitLaneError') throw new ExportError('PIT_LANE', e.message); throw e; }
    red.push(...pit.red);
  }
  if (v.lap && v.lap.ok === false) {
    const w = v.lap.where, ss = w.map((x) => x.s);
    red.push({ reason: 'lap-proof', s0: Math.min(...ss), s1: Math.max(...ss), source: 'ARCHITECTURE.md:88-89', where: w, detail: w.map((x) => `${x.reason} at s ${x.s.toFixed(1)} m`).join(', ') });
  }
  const testReds = test ? red.map(rangeText) : [];   // TEST: every red is listed, none blocks
  if (red.length && !test) throw new ExportError('RED', `validation is red, nothing written: ${red.map(rangeText).join('; ')}`, { red });
  if (test) warnings.push(`TEST EXPORT (unfinished): ${red.length} red finding(s) NOT blocking, listed in ${TEST_FILE}`);
  for (const a of v.amber) warnings.push(`amber: ${rangeText(a)}`);
  if (v.lap && v.lap.ok === null) warnings.push(`lap proof not run: ${v.lap.reason}`);
  for (const n of v.notChecked || []) warnings.push(`not checked by validation: ${n}`);

  // markers, from the words
  // the markers (§5c): the layout given, or the default one; a red check refuses, an amber warns
  let layout;
  try { layout = o.markers || Markers.defaultLayout(p, segs, { count: o.grid, pits: o.pits, height: o.height }); } catch (e) {
    if (e.code === 'NO_START_STRAIGHT' || e.code === 'BAD_LAYOUT') throw new ExportError(e.code, e.message);
    throw e;
  }
  const mk = Markers.placeAll(layout, p, segs, { paintMaterial: mesh.scene.materials.length, lane: pit ? { path: pit.lane.path, segments: pit.lane.segments } : null });
  if (!mk.check.ok) { const t = mk.check.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.problems.join('; ')}`).join(' | '); if (!test) throw new ExportError('MARKERS', t, { markerChecks: mk.check }); testReds.push(`markers: ${t}`); }
  // TEST: the point-to-point gates and the end block. AB_START at the start gate (AC_TIME_0), AB_FINISH TEST_RUNOFF_M before the road's end (or a quarter of a short road)
  const testNodes = [];
  if (test) {
    const gate = (nm) => mk.placed.find((m) => m.name === nm && !m.error), gL = gate('AC_TIME_0_L'), gR = gate('AC_TIME_0_R'), L = p.samples[p.samples.length - 1].s, sFin = Math.max(L * 0.75, L - TEST_RUNOFF_M);
    if (gL && gR) for (const [nm, from, s] of [['AC_AB_START_L', gL, gL.s], ['AC_AB_START_R', gR, gR.s], ['AC_AB_FINISH_L', gL, sFin], ['AC_AB_FINISH_R', gR, sFin]]) {
      const m = placeMarker(p, segs, { name: nm, s, u: from.u, h: from.h }); testNodes.push({ type: 'dummy', name: nm, matrix: m.matrix, children: [] });
    } else testReds.push('markers: no AC_TIME_0 start gate, so no point-to-point gates were placed');
    testNodes.push(endWall(p, segs, 0));
  }
  for (const a of mk.check.amber) warnings.push(`markers: ${a.text}`);
  const scene0 = { ...mesh.scene, materials: [...mesh.scene.materials, mk.paint.material],
    root: { ...mesh.scene.root, children: [...mesh.scene.root.children, ...mk.nodes, ...mk.paint.meshes, ...testNodes] } };
  // opts.textures: the texture set the preview draws (src/texture/set.js); the export follows the preview's own rule
  // D230: every core road cell gets an underside skin that casts shadows, and a closed tube's inside is dark (src/export/underskin.js); a word document's scene comes back as it is
  const scene = withUnderskin(withTextureSet(pit ? PitLane.withLane(scene0, pit.mesh) : scene0, mesh, segs, o.textures || null), mesh, segs);
  const names = new Map();
  (function walk(n) { names.set(n.name, (names.get(n.name) || 0) + 1); for (const c of n.children || []) walk(c); })(scene.root);
  const dupMarkers = [...names].filter(([k, c]) => c > 1 && /^AC_/.test(k)).map(([k]) => k);
  if (dupMarkers.length) throw new ExportError('MARKERS', `marker names appear twice: ${dupMarkers.join(', ')}`);
  const dup = [...names].filter(([, c]) => c > 1);
  if (dup.length) warnings.push(`${dup.length} mesh-node names repeat in the builder's scene (e.g. ${dup[0][0]} ×${dup[0][1]}); the kn5 gets unique names (acready.js), INTERFACES §2, C's mesh.js safeId`);
  try { validateScene(scene); } catch (e) { throw new ExportError('BAD_SCENE', e.message); }
  // the race-direction heading test only where the grid's direction applies: the grid and the start gate (the hotlap and
  // sectors sit wherever the run-up and the words put them, and are checked along their own road by src/markers)
  const mc = checkMarkers(scene, { expectedPits: layout.pits.count, raceHeading: /^AC_START_|^AC_TIME_0_/ });
  if (!mc.ok) { const t = mc.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.problems.join('; ')}`).join(' | '); if (!test) throw new ExportError('MARKERS', t, { markerChecks: mc }); testReds.push(`markers: ${t}`); }

  // the kn5, read back by our own reader (ARCHITECTURE §6 self-test) before any folder is touched. Flattened and given
  // diffuse textures first, as AC needs (src/export/acready.js: without these the car fell through and the road was black)
  const kn5 = Buffer.from(writeKn5(ensureDiffuse(weldSeams(flattenForAc(scene)))));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-')), tf = path.join(tmp, 'readback.kn5');
  let back;
  try { fs.writeFileSync(tf, kn5); back = readKn5(tf); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  // the AI line
  const speeds = segs.filter((g) => g.kind === 'road').map((g) => g.speed);
  const speedKmh = o.aiSpeedKmh !== undefined ? o.aiSpeedKmh : speeds.every((x) => Number.isFinite(x) && x > 0) ? Math.min(...speeds) * 3.6 : undefined;
  const { dsn, secs } = aiInput(segs, p);
  const line = ailine.generateAiLine(dsn, secs, { mode: 'floor', speedKmh, DS: o.step, open: test });
  const ai = ailine.encodeAiLine(line);
  ailine.readAiLine(ai);

  const turn = segs.reduce((a, g) => a + ((g.k0 + g.k1) / 2) * g.length, 0);
  return {
    folder: o.folder || folderName(doc) + (test ? '_test' : ''), scene, kn5, ai, test: test ? { reds: testReds, runoffM: TEST_RUNOFF_M, wall: TEST_WALL_NAME } : null, path: p, segments: segs, resolvedVia: via, validation: v, markers: mk, markerChecks: mc, pitLane: pit ? pit.lane : null,
    readback: { version: back.version, meshes: back.meshes.length, dummies: back.dummies.map((d) => d.name) },
    aiLine: { points: line.points.length, lengthM: line.points[line.points.length - 1].length + line.extra[line.extra.length - 1].length, speedKmh: line.speedKmh },
    desc: { name: (doc.name || 'Untitled') + (test ? ' (test, unfinished)' : ''), description: meta.description || 'Built by t180-track-builder.', length: p.lengthM, width: roadWidthM(segs), run: turn >= 0 ? 'counterclockwise' : 'clockwise', tags: ['t180', 'original'], author: 't180-track-builder', version: '0.1' },
    warnings,
  };
}

/**
 * THE ROAD'S WIDTH for ui_track.json (AC tracks write e.g. "32m"; an empty "" was the root of a NaN downstream, B's
 * CORRECTION in p-d182-plike-reg-B). It is the LENGTH-WEIGHTED MEDIAN, over the road segments, of each segment's
 * edge-to-edge width ACROSS ITS SURFACE (the profile's u span: floor plus both walls, u being arc length across, as
 * src/geom/profile.js defines it). Why this statistic:
 *   · edge to edge along the surface is how the track reader measures an AC track's width (tools/read_track.cjs: 1 m
 *     points across, wall included), and it is what the corpus and FINDINGS compare against (Sakura 28.7, Rainbow 50);
 *   · the MEDIAN, weighted by length, is the width most of the lap has; a short wide pit apron, a blend or one sculpted
 *     word does not move it, as it would move a mean;
 *   · not the dominant FONT's width: a font is a starting shape, and the user sculpts width and wall per word.
 * Jump flights (no surface) are left out. Null when there is no road.
 */
function roadWidthM(segs) {
  const w = segs.filter((g) => g.kind !== 'gap' && g.profile && g.length > 0).map((g) => { const P = Prof.normalize(g.profile); return { x: P.u[P.u.length - 1] - P.u[0], L: g.length }; }).sort((a, b) => a.x - b.x);
  const tot = w.reduce((a, e) => a + e.L, 0); if (!(tot > 0)) return null;
  let acc = 0; for (const e of w) { acc += e.L; if (acc >= tot / 2) return e.x; }
  return w[w.length - 1].x;
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
  const files = [kn5Name, ...trackfiles.writeTrackFiles(dir, b.scene, { softCollision: v.softCollision, extendedPhysics: v.extendedPhysics, kn5Files: [kn5Name], desc: b.desc })];
  fs.mkdirSync(path.join(dir, 'ai'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ai', 'fast_lane.ai'), b.ai);
  files.push('ai/fast_lane.ai');
  // D243a: a TEST export says so in the folder, with every red it did not block on
  if (b.test) { fs.writeFileSync(path.join(dir, TEST_FILE), ['TEST EXPORT OF AN UNFINISHED TRACK (t180-track-builder). Not a finished track: the loop is open, the AI line is open, and the reds below did NOT block it.', `Point-to-point gates AC_AB_START/FINISH; the finish is ${b.test.runoffM} m before the road's end (a run-off), and the road ends in a wall (${b.test.wall}).`, '', `${b.test.reds.length} red finding(s):`, ...b.test.reds.map((r) => `- ${r}`), ''].join(String.fromCharCode(13, 10))); files.push(TEST_FILE); }
  fs.writeFileSync(path.join(dir, MARKER_FILE), JSON.stringify({ tool: 't180-track-builder', module: 'src/export/fromwords.js', written: new Date().toISOString(), files }, null, 2) + '\n');
  return { variant: v.variant, folder, dir, files };
}

function exportTrack(doc, { outDir, variant = 'block', t180 = true, ...opts } = {}) {
  if (!outDir) throw new ExportError('NO_OUT_DIR', 'exportTrack needs an outDir');
  if (!VARIANTS[variant]) throw new ExportError('BAD_VARIANT', `variant "${variant}" is not block, noblock or both`);
  if (!t180 && variant !== 'block') throw new ExportError('BAD_VARIANT', `variant "${variant}" is the T-180 soft-road control; it needs "T-180 track" on`);
  return writeExport(buildExport(doc, opts), { outDir, variant, t180 });
}

/** exportTrack for `src/geom` segments that close a loop (the equation core's adapter): the same checks and files. */
function exportSegments(segs, meta, { outDir, variant = 'block', t180 = true, ...opts } = {}) {
  if (!outDir) throw new ExportError('NO_OUT_DIR', 'exportSegments needs an outDir');
  if (!VARIANTS[variant]) throw new ExportError('BAD_VARIANT', `variant "${variant}" is not block, noblock or both`);
  if (!t180 && variant !== 'block') throw new ExportError('BAD_VARIANT', `variant "${variant}" is the T-180 soft-road control; it needs "T-180 track" on`);
  return writeExport(buildFromSegments(segs, meta, opts), { outDir, variant, t180 });
}

function writeExport(b, { outDir, variant, t180 }) {
  const vs = VARIANTS[variant].map((v) => ({ ...v, softCollision: !!t180 && v.softCollision, extendedPhysics: !!t180 }));
  const folders = vs.map((v) => writeFolder(b, outDir, v));
  const warnings = [...b.warnings];
  if (t180) warnings.push(trackfiles.CSP_ONLY_WARNING);
  if (t180 && vs.some((v) => !v.softCollision)) warnings.push('noblock: the folder WITHOUT the soft-collision block is RED by ARCHITECTURE §4 (a missing soft-collision block); written only as the §10.1 soft-road control, on request');
  return { folders, kn5Sha: sha256(b.kn5), kn5Bytes: b.kn5.length, aiSha: sha256(b.ai), aiLine: b.aiLine, readback: b.readback, lengthM: b.path.lengthM, resolvedVia: b.resolvedVia, markers: b.markers.placed.filter((m) => !m.error).map((m) => ({ name: m.name, kind: m.kind, s: m.s, u: m.u, h: m.h })), paint: b.markers.paint.items, layout: b.markers.layout, warnings };
}

module.exports = { exportTrack, buildExport, exportSegments, buildFromSegments, ExportError, folderName, LAYOUT, MARKER_FILE, _internal: { stations, aiInput, roadWidthM } };
