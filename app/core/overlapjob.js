// overlapjob.js: THE OVERLAP CHECK of a proposed track, as ONE pure function that runs the same on the page, in a Web Worker and under node (D240 follow-up, the keeper reads a 10 s
// freeze as broken: E measured Close's preview at 13.4 s on TEST 1, a middle delete's at 8.5 to 10.3 s on 13 km, and both were this function run on the page's own thread).
//
//   overlapCheck(resolved, designSpeedKmh, { closed })  the check itself, moved here unchanged from coreshell.js (D242, B's; D240's `closed: false` for an open track)
//   resolveDoc(doc)                                     what coreshell.js resolvedOf makes of a document: segments, closed, start, lift
//   runJob({ doc, designSpeedKmh, closed, part })       the job a worker is sent: the DOCUMENT (plain data, structured-cloneable) in, the check's result (plain data) out; `part` 'rest' or
//                                                       'rays' gives one of the check's two halves (overlapPart), which overlapmerge.js puts together
//
// The worker (app/core/overlapworker.js) calls runJob; the shell's synchronous path (no worker: tests, a page that cannot start one) calls overlapCheck on its own resolved track;
// test/app core-previews-async compares the two on a coil and on TEST-1-sized tracks and finds them identical.
'use strict';

const G = require('../../src/geom/index.js');
const V = require('../../src/validate/index.js');
const { walkScene, isDrivable } = require('../../src/export/markers.js');
const AD = require('../../src/core/adapter.js');
const { OVERLAP, mergeParts } = require('./overlapmerge.js');
/**
 * D242: THE OVERLAP CHECK of a proposed (closed) track: its mesh with the self-check, then the validator with the built road for the downforce ray,
 * the same checks the export runs (src/export/fromwords.js buildFromSegments). Returns { overlaps (the road running into itself: self-intersection,
 * stacked, a downforce ray that meets another road), others (every other red), amber (count) }.
 */
/** D256: a set design speed pins it; none (the app: there is no slider) checks at FULL speed, as the panel and the export do. */
const speedOpts = (designSpeedKmh) => (Number.isFinite(designSpeedKmh) && designSpeedKmh > 0 ? { designSpeed: designSpeedKmh / 3.6 } : { fullSpeed: true });
function overlapCheck(resolved, designSpeedKmh, { closed = true } = {}) {   // D240: `closed: false` for the open track a delete leaves
  const segs = resolved.segments, p0 = G.buildPath(segs, { step: 2, closed, start: resolved.start }), p = typeof resolved.lift === 'function' ? resolved.lift(p0) : p0;
  const mesh = G.buildMesh(p, segs, { selfCheck: true }), roadMesh = walkScene(mesh.scene).meshes.filter((m) => isDrivable(m.name) && m.indices && m.indices.length);
  const v = V.validate(p, segs, { csp: true, softCollision: true, folds: mesh.folds, roadMesh, ...speedOpts(designSpeedKmh) });
  return { overlaps: v.red.filter((x) => OVERLAP.has(x.reason)), others: v.red.filter((x) => !OVERLAP.has(x.reason)), amber: v.amber.length };
}

/** The document as the shell resolves it (coreshell.js resolvedOf): its segments, its start pose, and the lift that applies its hill and swerve offsets to a path. */
function resolveDoc(d) {
  const segments = d.pieces.length ? AD.toSegments(d) : [];
  return { segments, closed: !!d.closed, start: { pos: d.start.pos.slice(), theta: d.start.heading, p: d.start.pitch }, lift: typeof AD.offsetPath === 'function' && segments.length ? (p) => AD.offsetPath(d, segments, p) : undefined };
}

/**
 * THE TWO PARTS (D240 warm-worker follow-up; measured: the ray-gap search is 5.3 s of the ~8 s on a 13 km track, the mesh's self-check 1.9 s more, the rest of the validator 0.08 s).
 * 'rest': the mesh WITH its self-check and the validator without the road mesh. 'rays': the mesh without the self-check and the validator with the road mesh and no folds, keeping only its
 * downforce-ray-gap ranges. They share nothing, so two workers run them at once; overlapmerge.js mergeParts gives exactly overlapCheck's answer (the tests compare them).
 */
function overlapPart(part, resolved, designSpeedKmh, { closed = true } = {}) {
  const segs = resolved.segments, p0 = G.buildPath(segs, { step: 2, closed, start: resolved.start }), p = typeof resolved.lift === 'function' ? resolved.lift(p0) : p0;
  const speed = speedOpts(designSpeedKmh);
  if (part === 'rest') { const mesh = G.buildMesh(p, segs, { selfCheck: true }), v = V.validate(p, segs, { csp: true, softCollision: true, folds: mesh.folds, ...speed }); return { red: v.red, amber: v.amber.length }; }
  if (part === 'rays') {
    const mesh = G.buildMesh(p, segs, {}), roadMesh = walkScene(mesh.scene).meshes.filter((m) => isDrivable(m.name) && m.indices && m.indices.length);
    return { red: V.validate(p, segs, { csp: true, softCollision: true, roadMesh, ...speed }).red.filter((x) => x.reason === 'downforce-ray-gap') };
  }
  throw new Error(`no such part of the overlap check: ${part}`);
}

/** The job a worker is sent: { part: 'rest' | 'rays' } gives that part, none gives the whole check in one piece. */
function runJob({ doc, designSpeedKmh = null, closed = true, part = null }) { const r = resolveDoc(doc); return part ? overlapPart(part, r, designSpeedKmh, { closed }) : overlapCheck(r, designSpeedKmh, { closed }); }

module.exports = { overlapCheck, overlapPart, mergeParts, resolveDoc, runJob, OVERLAP };
