// trackmodel.js: keeps the preview's path and mesh in step with the resolved document, in the UI process (ARCHITECTURE
// §9: "The geometry core runs in the UI process … Mesh data must never cross Tauri IPC during a drag"). No GL, no DOM.
//
//   const tm = createTrackModel();
//   tm.update(resolved)  -> { path, mesh, how, batches, bounds, segments, g, fromS }
//                           resolved = the shell's state.resolved (src/doc resolve). g is the first segment that changed
//                           and fromS where it starts (the old end for an append); both null for 'full', 'same', 'empty'.
// ONE SHARED PATH (D177, the librarian's ruling "one shared path between the preview and validation"): the path this
// model keeps IS the track's path. Validation reads it with segments/how/g/fromS instead of growing a second one
// (app/preview/index.js publishes it as the 't180:track' event). Its step is STEP, the export's own
// (src/export/fromwords.js `step: 2`), so the preview meshes the stations the kn5 is meshed from.
//
// It does the least work the geometry allows for the change:
//   'same'     nothing changed
//   'extend'   words were appended at the open end: extendPath + extendMesh (the build head; cost does not grow with
//              the track, D166 addendum 1)
//   'sculpt'   a word changed, same count or more: rebuildPathFrom + sculptMesh from the first changed segment (only
//              what changed is remeshed; later pieces move, D166 addendum 2)
//   'full'     anything else: the first build, a removal or undo past the end, a closed loop, or a change of options
// In every case the result equals a full build of the same segments (app/test/preview.test.js checks each path).
// A document that does not resolve (state.resolved === null) keeps the last good track and says so.
// Each result also carries `bounds`, the world box of every vertex (look.js worldBounds), for the overhead fit and the grid.
//
//   tm.ghostFor(candidate)   the GHOST of the next piece (the D170 review, item 6): `candidate` is the resolved
//                            document WITH the word appended (its segments extend the placed ones). The ghost is built
//                            exactly as placing would build it (extendPath + extendMesh), on COPIES of the live path and
//                            mesh, so the placed track is untouched; it returns the new pieces' batches and the seam onto
//                            them, as { batches, path, head } (the head the track WOULD have). The same word placed next
//                            gives the same geometry (app/test/look.test.js).
'use strict';

const G = require('../../src/geom/index.js');
const { batchesOf } = require('./batches.js');
const { coarsen, coarsenRun, mergeChords, sameSegment, CHEAP_FACTOR } = require('./coarse.js');
const { worldBounds, linesFor } = require('./look.js');

const { keyOf: hashOf } = require('./segkey.js');   // D235: the change key of a segment, hashed (it was JSON.stringify: tens of milliseconds a ghost keystroke on a long tube)
// A FROZEN segment cannot change, so its key is hashed once and remembered: the equation core's shell reuses an unchanged piece's segments,
// deep-frozen (src/core/adapter.js toSegments `cache`), and keying all 3,077 of a 9-piece track's on every placement was about 55 ms of it.
// Any other segment is hashed every time, as before.
const keyMemo = new WeakMap();
const keyOf = (seg) => {
  if (!Object.isFrozen(seg)) return hashOf(seg);
  let k = keyMemo.get(seg);
  if (k === undefined) { k = hashOf(seg); keyMemo.set(seg, k); }
  return k;
};
/** m between path stations: the export's (src/export/fromwords.js buildExport `step: 2`) and validation's. */
const STEP = 2;
/** D404: a CHEAP ghost (a handle being dragged) puts at most this many path stations on its new pieces, so the mesh it builds on every move of the pointer costs the same at
 *  1,000 m as at 20,000 m; a ghost shorter than CHEAP_STATIONS x STEP (128 m) is built as it always was. The release builds the full ghost. */
const CHEAP_STATIONS = 64, CHEAP_SUBSTEP = 4;   // and integrates them in steps of CHEAP_SUBSTEP m (the path's own is 0.25: Gauss-Legendre over a metre is exact to far below a millimetre)
/** D421 part 4: a SCULPT drag's window is drawn from about DRAG_CHORDS merged chords (coarse.js mergeChords, D404's GHOST_TURN for the heading), none shorter than DRAG_MIN_M unless the
 *  heading, pitch or roll cap ends it sooner, however long the window is (a short window of a tube, whose rows are heavy, was 61 chords of 2 m: 14 ms a step, probe2 of 2026-10-20). */
const DRAG_CHORDS = 24, DRAG_MIN_M = 8, DRAG_TURN = 0.03, DRAG_ROLL = 0.05;
/** D425 (P's design §1 cue 4, §5): WHAT MOVES is washed in the tool's colour, Build's handle colour for the same channel (app/core/handles.js): white for a length (Stretch), violet for the
 *  turn rate (Bend, or Smooth on it), yellow for the climb rate (Climb, or Smooth on it). Only a route tool moves the road after its window. */
const WASH = Object.freeze({ length: Object.freeze([1, 1, 1]), kh: Object.freeze([0.725, 0.408, 1]), kv: Object.freeze([1, 0.824, 0.239]) });
/** The wash of a brush (state.brush, or the page's hover { tool, channel }): its colour, or null for a tool that moves nothing after its window. */
const washOf = (b) => (!b ? null : b.mode === 'stretch' || b.tool === 'stretch' ? WASH.length : b.channel === 'kh' || b.tool === 'bend' ? WASH.kh : b.channel === 'kv' || b.tool === 'climb' ? WASH.kv : null);
const RIGID_EPS = 1e-9;   // m and rad: a window end that moved less than this leaves the road after it where it is

// D421 part 4: the rigid move of the road after a sculpted window, as the row-vector matrix a batch's node matrix is multiplied by (world = local · M, mesh.js matrixOf)
const headingFrame = (sm) => { const T = sm.T, th = Math.atan2(T[0], T[2]), L = [Math.cos(th), 0, -Math.sin(th)]; return { o: sm.pos, T, L, U: [T[1] * L[2] - T[2] * L[1], T[2] * L[0] - T[0] * L[2], T[0] * L[1] - T[1] * L[0]] }; };
function rigidMove(from, to) {
  // R maps the old frame's axes onto the new one's: R = Σ new_a ⊗ old_a over a = T, L, U; t = to.o − R · from.o
  const R = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const a of ['T', 'L', 'U']) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i * 3 + j] += to[a][i] * from[a][j];
  const t = [0, 1, 2].map((i) => to.o[i] - (R[i * 3] * from.o[0] + R[i * 3 + 1] * from.o[1] + R[i * 3 + 2] * from.o[2]));
  // row-vector form: p' = p · X with X's top-left block Rᵀ and its last row t
  return [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, t[0], t[1], t[2], 1];
}
const movePoint = (X, p) => [0, 1, 2].map((c) => p[0] * X[c] + p[1] * X[4 + c] + p[2] * X[8 + c] + X[12 + c]);
const isIdentity = (X) => { const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; return X.every((v, k) => Math.abs(v - I[k]) < RIGID_EPS); };
// a path sample as a plain object (a SampleView's fields are getters, which a spread does not copy), with its s and segment index replaced
const plainSample = (x, s, seg) => ({ s, seg, pos: x.pos, T: x.T, L: x.L, U: x.U, kvec: x.kvec, roll: x.roll, bankG: x.bankG, grade: x.grade, _R: x._R, _x: x._x });

function createTrackModel({ geom = G, pathOpts: po = {}, meshOpts = {} } = {}) {
  const pathOpts = { step: STEP, ...po };
  // `path` is the BASE path the geometry grows incrementally; `shown` is what everything reads (the mesh, the cameras, the shared
  // track): the base path LIFTED by resolved.lift when the document has offsets (D186: the equation core's hill and swerve, A's
  // src/core/adapter.js offsetPath, which recomputes the frame from the lifted centreline). With no lift they are the same object.
  let path = null, shown = null, mesh = null, keys = [], liftKeys = [], closed = false, last = null, startKey = null, startOpt = null;
  // D235: `detail` > 1 meshes a COARSER preview (app/preview/coarse.js thins each segment's row grid) while the track is being dragged; 1 is full detail, the export's.
  // A change of detail is a full rebuild. `lastResolved` is the state's document the last update was built from: the very same object builds nothing again.
  let detail = 1, detailMoved = false, lastResolved = null;
  let lastCheap = null;   // the last CHEAP ghost's mesh and keys, reused by the next one (ghostFor)
  // D407: THE PLACEMENT TAKES THE GHOST'S WORK. The last FULL ghost (not cheap, full detail) of an extension of the placed track: the placed path and mesh it was grown from, and the path, mesh and
  // batches it made. A placement whose segments are that ghost's, the very same objects, on the same placed path and mesh, with no offsets to lift, is what extendPath and extendMesh would make of
  // them (the ghost ran them on copies of the same placed track, so it is the same to the byte), so update() takes them instead of building them again (30 ms at 1,000 m, 60 at 2,000), and the
  // placed path and mesh it leaves are untouched, so the undo copy needs no copying. Anything else (a cheap ghost, a coarse detail, a lift, another document) and update() builds as before.
  let lastFull = null;
  // UNDO OF A PLACEMENT (the user, 2026-10-12: "undoing the last piece lags too long"). A removal was a full rebuild: 1.2 to 1.4 s on his 10-piece
  // track, against 65 ms to place the piece. An 'extend' grows the path and the mesh IN PLACE (geom extendPath / extendMesh), so just before it the
  // model copies what those two touch: the path's arrays and the last block (extendPath pops a sample and shortens the last block), and the mesh
  // state's piece and seam lists (extendMesh only appends; it never changes an old piece). If the very next change is back to exactly those
  // segments (the same keys, and the lift giving the same lift keys), that copy IS the track: it is put back and nothing is meshed. Any other
  // change in between drops the copy (a sculpt changes old pieces in place). app/test/preview-undo.test.js: equal to a full build, and growable.
  let undoSnap = null;
  // the path's samples are VIEWS of its block objects (src/geom/path.js SampleView), so the copy keeps the SAME blocks (a sculpt later re-places them in place,
  // and the views must follow); extendPath changes an old block only by shortening the last one (last.n--), which `lastN` puts back on a restore
  const copyPath = (p) => ({ ...p, samples: p.samples.slice(), blocks: p.blocks.slice(), segFirst: p.segFirst.slice(), starts: p.starts.slice(), segEnd: p.segEnd.slice() });
  const copyMesh = (m) => ({ ...m, _state: { ...m._state, pieces: m._state.pieces.slice(), seams: m._state.seams.slice() } });
  const canSnap = () => !!(path && Array.isArray(path.blocks) && Array.isArray(path.starts) && Array.isArray(path.segEnd) && mesh && mesh._state && Array.isArray(mesh._state.pieces));
  /**
   * The segments the MESH is given: a segment whose lifted samples differ from the base carries `_lift`, a key made from those
   * samples. So its handles (mesh.js handleKey) change exactly where the lift changed, and sculptMesh remeshes exactly those
   * pieces (a piece whose start is outside a hill but whose inside is lifted is remeshed too); an unlifted segment is unchanged.
   */
  const liftOf = (base, lifted, j) => {
    if (lifted === base) return null;
    const a = lifted.samples[lifted.segFirst[j]], b = lifted.segEnd[j];
    if (a === base.samples[base.segFirst[j]] && b === base.segEnd[j]) return null;
    return JSON.stringify([a.pos, a.T, b.pos, b.T]);
  };
  const meshSegs = (segs, lk) => segs.map((s, j) => (lk[j] === null ? s : { ...s, _lift: lk[j] }));
  // D236: a CLOSED loop is rebuilt in full on every change (it has no open end to extend, and a later piece's placement depends on every earlier one), but its MESH need not be:
  // the model keeps the last closed mesh made at each detail (`slots`: segment keys, lift keys, mesh), and a segment whose key is the one it was meshed from keeps its vertex arrays
  // (geom.reuseMesh), so a brush that reaches 60 m of a 6 km loop meshes 60 m, both while dragging (coarse) and when full detail comes back (the pre-drag full mesh is still in its slot).
  const slots = new Map();
  let builtDetail = 1;   // the detail the current mesh was made at
  /** How many segments of the track as it was are unchanged in the new one, at the same index (0: nothing to keep, or the new track is shorter). D453: not only an
   *  unchanged PREFIX: a banking Close (D447) changes every placed curve's bank, so a prefix rule kept 0 of 950 placed segments, the straights too; reuseMesh keeps
   *  each piece on its own flag (and its start's pitch and bank) and meshes the rest again, so a partial keep is as exact as a full one. */
  const keptFrom = (was, nk, lk) => { if (was.keys.length > nk.length) return 0; let g = 0; for (let j = 0; j < was.keys.length; j++) if (was.keys[j] === nk[j] && was.liftKeys[j] === lk[j]) g++; return g; };
  // D421c: the full rebuild as a generator (the release after a whole-lap re-close meshes a 10 km lap again: about 200 ms in one frame). It runs the very calls full() ran, as their
  // steps (buildPathSteps, reuseMeshSteps, buildMeshSteps: each its plain twin run to the end, to the byte), and changes the model's state only at its end, so a caller may run it
  // a few milliseconds a frame (the preview after a sculpt release) with the track as it was still on show; update() runs it to the end at once, as before.
  const stepsOr = (steps, plain) => (typeof geom[steps] === 'function' ? geom[steps] : function* (...args) { return geom[plain](...args); });
  function* fullSteps(segs, isClosed, lift, nk) {
    const was = { mesh, keys, liftKeys, closed, detail: builtDetail };   // the track as it was, for a close that only ADDS road (below)
    const p = yield* stepsOr('buildPathSteps', 'buildPath')(segs, { ...pathOpts, closed: isClosed, ...(startOpt ? { start: startOpt } : {}) }), sh = lift ? lift(p) : p;
    const lk = segs.map((_, j) => liftOf(p, sh, j));
    const ms = meshSegs(segs, lk), slot = isClosed ? slots.get(detail) : null;
    let m;
    if (slot && typeof geom.reuseMesh === 'function' && slot.mesh && slot.keys.length === segs.length) m = yield* stepsOr('reuseMeshSteps', 'reuseMesh')(slot.mesh, sh, ms, segs.map((_, j) => nk[j] === slot.keys[j] && lk[j] === slot.liftKeys[j]));
    // AN OPEN TRACK CLOSED BY ADDING ROAD (2026-10-15, Finish to start on the user's 24 km ELYSIUM: Apply rebuilt every piece, 6.5 s with the window frozen):
    // every placed piece is the same and lies where it lay, so its mesh is kept and only the new road and the closing joint are made (geom.reuseMesh, grow);
    // D453: a Close that also banks placed curves (D447) remakes those pieces and the seams beside them, and keeps the rest
    else if (isClosed && !was.closed && was.mesh && was.mesh._state && was.detail === detail && typeof geom.reuseMesh === 'function' && keptFrom(was, nk, lk) > 0) m = yield* stepsOr('reuseMeshSteps', 'reuseMesh')(was.mesh, sh, ms, segs.map((_, j) => j < was.keys.length && nk[j] === was.keys[j] && lk[j] === was.liftKeys[j]), { grow: true });
    else m = yield* stepsOr('buildMeshSteps', 'buildMesh')(sh, ms, meshOpts);
    path = p; shown = sh; liftKeys = lk; mesh = m;
    builtDetail = detail;
    if (isClosed) slots.set(detail, { keys: nk, liftKeys, mesh }); else slots.clear();
    return 'full';
  }

  // D407: a full ghost's road lines, made a batch at a time (look.js linesFor keeps them by the batch's positions), so the first frame that draws the ghost does not make them all at once (8 to 19 ms at 2,000 m)
  function* warmLines(bs) { for (const b of bs) { linesFor(b); yield; } }
  const adoptable = (segs, lift) => {
    const ad = lastFull;
    if (!ad || detail !== 1 || ad.base !== path || ad.mesh0 !== mesh || !last || last.mesh !== mesh || last.how === 'kept' || ad.from !== keys.length || shown !== path || ad.segs.length !== segs.length) return false;
    for (let j = 0; j < segs.length; j++) if (ad.segs[j] !== segs[j]) return false;
    return (lift ? lift(ad.p) : ad.p) === ad.p;   // no offsets anywhere: the ghost was not lifted, and neither is this
  };
  const unionBounds = (a, b) => (!a ? b : !b ? a : { min: a.min.map((v, d) => Math.min(v, b.min[d])), max: a.max.map((v, d) => Math.max(v, b.max[d])) });
  // D421 part 4, THE SCULPT DRAG'S FRAME (design §4.3, the degrade ladder). While a brush drag is open nothing placed is rebuilt: the model keeps the path and mesh of the
  // document the drag began on (the full detail, as it was), and each step is drawn from them:
  //   the WINDOW (the segments the step changed, found by identity against that base, and for a hill or swerve the span [s0 − r, s0 + r] its lift reaches) is hidden
  //     and drawn instead as a CHORD GHOST: its segments merged into at most DRAG_CHORDS chords (coarse.js mergeChords), the cheap ghost's row grid (coarsenRun), a path
  //     grown from the base path's own frame at the window's start, lifted by the document's own lift;
  //   the road AFTER the window, when the step moved the window's end (a route tool: a bend, a climb, a stretch), is moved as one rigid body, one matrix per batch, no
  //     rebuild (the D236 placement); on a CLOSED lap that leaves the lap open while the drag lasts, and the gap from its new end to its start is returned as a line;
  //   every other batch is the placed one, untouched.
  // Nothing here closes the lap, checks overlaps, or builds the whole track's segments: the shell gives the step's segments (its cache converts the changed pieces only)
  // and the release builds the exact road from them with update(), as before. The base's state is not changed, so that update diffs against the document the drag began on.
  let dragShown = null;   // the last drag frame: { resolved, out }
  // the segments a drag's steps have been found equal (by value) to the base's: new segment -> the base index it equals. The shell's cache hands the same objects back on every step for
  // the pieces it did not convert again, so after the first step the trim is a lookup, not a comparison of a tube's profile number by number (4.75 ms a step on the 360 deg oval)
  let equalFor = null, equalOf = new WeakMap();
  const sameAt = (g, base, j) => { if (g === base[j]) return true; if (equalFor !== base) { equalFor = base; equalOf = new WeakMap(); } if (equalOf.get(g) === j) return true; if (!sameSegment(g, base[j])) return false; equalOf.set(g, j); return true; };
  function dragFrame(resolved, b) {
    const base = lastResolved;
    if (!base || !last || !path || !mesh || !mesh._state || detail !== 1 || builtDetail !== 1 || !Array.isArray(resolved.segments) || !Array.isArray(base.segments)) return null;
    if (resolved === base) return { ...last, how: 'same' };
    if (dragShown && dragShown.resolved === resolved) return dragShown.out;
    // a close or a new start is not a brush step; a closed lap OPENED for the drag is (the shell's route tools re-close it on release, D421 part 2): it is drawn open, from the closed lap's own path
    if ((!!resolved.closed && !base.closed) || JSON.stringify(resolved.start || null) !== JSON.stringify(base.start || null)) return null;
    const lapClosed = !!base.closed;
    const segs = resolved.segments, bs = base.segments, n = segs.length, m = bs.length;
    let a = 0; while (a < n && a < m && segs[a] === bs[a]) a++;
    let e = 0; while (e < n - a && e < m - a && segs[n - 1 - e] === bs[m - 1 - e]) e++;
    let bB = m - e;
    // the chords of a brushed piece the brush did not reach come back from the shell equal but new: trimmed off both ends, so the window is what changed
    while (a < bB && a < n - e && sameAt(segs[a], bs, a)) a++;
    while (bB > a && n - e > a && sameAt(segs[n - e - 1], bs, bB - 1)) { bB--; e++; }
    // the lift (Grab's hill and swerve) changes the road inside [s0 − r, s0 + r] only, and is a new function on every step whatever it holds: the window covers that span
    const liftFn = typeof resolved.lift === 'function' ? resolved.lift : null;   // (named apart from update()'s own line, which a mutation harness anchors on)
    if (liftFn && Number.isFinite(b && b.s0)) {
      const r = Number.isFinite(b.rUsed) ? b.rUsed : b.r, s1 = b.s0 - r, s2 = b.s0 + r;
      if (!(r >= 0) || (lapClosed && (s1 < 0 || s2 > path.lengthM))) return null;   // a window across a closed lap's start: drawn the old way
      const segAt = (s) => { let lo = 0, hi = m - 1; while (lo < hi) { const md = (lo + hi + 1) >> 1; if (path.starts[md].s <= s) lo = md; else hi = md - 1; } return lo; };
      const la = segAt(Math.max(0, s1)), lb = Math.min(m, segAt(Math.min(path.lengthM, s2)) + 1);
      // the span joins what the segments changed; when nothing did (a hill moves no chord), the window is the span alone, not the span and wherever the trim stopped
      if (m === n) { if (a >= bB) { a = la; bB = lb; } else { a = Math.min(a, la); bB = Math.max(bB, lb); } }
    }
    const bN = bB + (n - m);
    if (a >= bB && a >= bN) return { ...last, how: 'same' };
    if (!(bN > a) || segs.slice(a, bN).some((g) => !g)) return null;
    // the ghost of the window, from the base path's frame at its start (everything before a is the very same, so it starts there)
    const wsegs = segs.slice(a, bN), wlen = wsegs.reduce((acc, g) => acc + (g.length || 0), 0), f0 = path.samples[path.segFirst[a]];
    const start = { pos: f0.pos.slice(), theta: Math.atan2(f0.T[0], f0.T[2]), p: Math.asin(Math.max(-1, Math.min(1, f0.T[1]))) };
    const gsegs = coarsenRun(mergeChords(wsegs, { maxTurn: DRAG_TURN, maxRoll: DRAG_ROLL, maxLen: Math.max(DRAG_MIN_M, wlen / DRAG_CHORDS) }), CHEAP_FACTOR);
    const gp0 = geom.buildPath(gsegs, { step: 1e6, substep: CHEAP_SUBSTEP, start });
    let gp = gp0;
    if (liftFn) {
      // the document's own lift, on the ghost's samples: each is handed over with its s along the track and the index of the shell's segment under it, then given its own back
      const sA = path.starts[a].s, at = [sA]; for (let j = a; j < bN; j++) at.push(at[at.length - 1] + segs[j].length);
      const segOf = (s) => { let lo = 0, hi = bN - a - 1; while (lo < hi) { const md = (lo + hi + 1) >> 1; if (at[md] <= s) lo = md; else hi = md - 1; } return a + lo; };
      const fake = { ...gp0, samples: gp0.samples.map((x) => plainSample(x, sA + x.s, segOf(sA + x.s))), segEnd: gp0.segEnd.map((x) => plainSample(x, sA + x.s, segOf(sA + x.s - 1e-9))) };
      const L = liftFn(fake);
      gp = { ...gp0, samples: L.samples.map((y, i) => ({ ...y, s: gp0.samples[i].s, seg: gp0.samples[i].seg })), segEnd: L.segEnd.map((y, i) => ({ ...y, s: gp0.segEnd[i].s, seg: gp0.segEnd[i].seg })) };
    }
    const gm = geom.buildMesh(gp, gsegs, meshOpts), names = new Map(mesh.scene.materials.map((mt, i) => [mt.name, i]));
    const ghostBatches = batchesOf(gm).map((gb) => { const mi = names.get(gm.scene.materials[gb.materialIndex].name); return { ...gb, key: `drag:${gb.key}`, materialIndex: mi === undefined ? 0 : mi }; });
    // the road after the window: where the window now ends, from the step's own segments (integrated as the cheap ghost's are), against where it ended
    const routeSame = bN === bB && wsegs.every((g, k) => { const o = bs[a + k]; return o && g.kind === o.kind && g.length === o.length && g.k0 === o.k0 && g.k1 === o.k1 && g.kp0 === o.kp0 && g.kp1 === o.kp1; });
    let X = null, gap = null;
    if (!routeSame && (bB < m || lapClosed)) {
      const ep = geom.buildPath(wsegs, { step: 1e6, substep: CHEAP_SUBSTEP, start }), now = ep.samples[ep.samples.length - 1], was = path.segEnd[bB - 1];
      const mv = rigidMove(headingFrame(was), headingFrame(now));
      if (!isIdentity(mv)) X = mv;
    }
    if (X && lapClosed) {
      // drawn open: the lap's end, moved with the road after the window, and a line from there to its start
      const end = movePoint(X, path.segEnd[m - 1].pos), s0p = path.samples[0].pos;
      gap = { positions: new Float32Array([...end, ...s0p]), colour: [1, 0.55, 0.15], alpha: 1, metres: Math.hypot(end[0] - s0p[0], end[1] - s0p[1], end[2] - s0p[2]) };
    }
    const closedLap = lapClosed, moved = !!X, cells = mesh.cells, tint = moved ? washOf(b) : null;
    // the same composition for any list in the placed batches' order (the preview's textured copy of them included): the window and its two seams hidden, the road after it moved, the ghost added.
    // A batch's segment is its CELL's, by position (the cells and the scene's nodes are in one order, batches.js): a batch's own `piece` is read by the cell's name, which every chord of a word shares
    const compose = (list) => {
      const out = [];
      for (let k = 0; k < list.length; k++) {
        const bt = list[k], c = cells[k], g = c ? c.piece : bt.piece, seam = c ? !!c.seam : bt.seam;
        if (g >= a && g < bB) continue;
        if (seam && (g === a || g === bB || (moved && closedLap && g === 0))) continue;
        out.push(moved && g >= bB ? { ...bt, xform: X, ...(tint ? { tint } : {}) } : bt);   // the placed matrix kept, the move beside it: the renderer draws the baked chunk under it (renderer.js chunkModel)
        // D425: and washes it in the tool's colour (`tint`, one uniform for the chunk in the renderer): the road that moves is shown moving, with no geometry added
      }
      for (const gb of ghostBatches) out.push(gb);
      return out;
    };
    const out = { ...last, how: 'drag', batches: compose(last.batches), segments: resolved.segments, g: null, fromS: null, drag: { base: last, compose, gap, window: { from: a, to: bB, toNew: bN }, moved, move: X, chords: gsegs.length } };
    dragShown = { resolved, out };
    return out;
  }
  const tm = {
    /**
     * update(resolved, { drag }) with `drag` the shell's open brush (state.brush, D421 part 4): the drag's frame (dragFrame above), nothing placed rebuilt; how 'drag', and
     * `drag` on the result: { base (the placed track's own result), compose(list), gap (a closed lap's open end, a line) | null, window, moved, move (the matrix the road after the window is moved by) | null, chords }.
     */
    update(resolved, opts) { const it = tm.updateSteps(resolved, opts); let r = it.next(); while (!r.done) r = it.next(); return r.value; },
    /** D421c: update() as a generator: it yields only inside a full rebuild (fullSteps), so the preview can build a lap after a whole-lap re-close a slice at a time; run to the end, it is update(). */
    *updateSteps(resolved, opts) {
      if (opts && opts.drag && resolved) { const f = dragFrame(resolved, opts.drag); if (f) return f; }
      dragShown = null;
      if (!resolved) { if (!last) throw new Error('trackModel: no resolved document yet'); return { ...last, how: 'kept', stale: true }; }
      // the very same document as the last build (a state change that is not an edit: a message, a brush ending): nothing to build, a closed loop included
      if (last && resolved === lastResolved && !detailMoved) return { ...last, how: 'same' };
      const segs = detail > 1 ? coarsen(resolved.segments, detail) : resolved.segments, isClosed = !!resolved.closed, lift = typeof resolved.lift === 'function' ? resolved.lift : null;
      // resolved.start (D186, the equation core): where the track starts, its heading and PITCH; a new start rebuilds in full
      const sk = resolved.start ? JSON.stringify(resolved.start) : null, startMoved = sk !== startKey; startKey = sk; startOpt = resolved.start || null;
      if (!Array.isArray(segs)) throw new Error('trackModel: resolved.segments is missing');
      if (!segs.length) { path = null; shown = null; mesh = null; keys = []; liftKeys = []; closed = isClosed; lastResolved = resolved; detailMoved = false; last = { path: null, mesh, how: 'empty', batches: [], segments: resolved.segments, g: null, fromS: null }; return last; }
      const nk = segs.map(keyOf);
      let g = 0; while (g < keys.length && g < nk.length && keys[g] === nk[g]) g++;
      let how, from = null, fromS = null, adopted = null;
      // the lift, redone on the base path after any growth; the first segment whose lifted samples changed
      const relift = () => { shown = lift ? lift(path) : path; const lk = segs.map((_, j) => liftOf(path, shown, j)); let a = 0; while (a < lk.length && a < liftKeys.length && lk[a] === liftKeys[a]) a++; return { lk, a }; };
      // an undo straight back over the last placement: put the copy back (see UNDO OF A PLACEMENT above)
      const snap = undoSnap; undoSnap = null;
      if (snap && path && !isClosed && !closed && !startMoved && !detailMoved && detail === 1 && snap.detail === 1 && nk.length < keys.length
        && nk.length === snap.keys.length && nk.every((k, j) => k === snap.keys[j])) {
        snap.path.blocks[snap.path.blocks.length - 1].n = snap.lastN;   // undo extendPath's last.n-- on the shared block
        const sh = lift ? lift(snap.path) : snap.path, lk = segs.map((_, j) => liftOf(snap.path, sh, j));
        if (lk.length === snap.liftKeys.length && lk.every((k, j) => k === snap.liftKeys[j])) {
          path = snap.path; shown = sh; mesh = snap.mesh; keys = nk; liftKeys = lk; closed = false; lastResolved = resolved; detailMoved = false;
          last = { path: shown, mesh, how: 'full', batches: snap.last.batches, bounds: snap.last.bounds, segments: resolved.segments, g: null, fromS: null };
          return last;
        }
      }
      if (!path || isClosed || closed || startMoved || detailMoved) how = yield* fullSteps(segs, isClosed, lift, nk);
      else if (g === keys.length && g === nk.length) {
        const { lk, a } = relift();
        if (a === lk.length && a === liftKeys.length) how = 'same';
        else { from = a; fromS = path.starts[a].s; mesh = geom.sculptMesh(mesh, shown, meshSegs(segs, lk), a); liftKeys = lk; how = 'sculpt'; }   // only the offsets changed (a hill brush)
      } else if (g === keys.length && adoptable(segs, lift)) {
        const ad = lastFull;
        if (canSnap() && last) undoSnap = { keys: keys.slice(), liftKeys: liftKeys.slice(), path, lastN: path.blocks[path.blocks.length - 1].n, mesh, last, detail };   // the ghost grew COPIES: these are the track as it was
        from = g; fromS = path.lengthM; path = ad.p; shown = path; mesh = ad.gm; liftKeys = segs.map(() => null); how = 'extend'; adopted = ad;
      } else if (g === keys.length) {
        if (canSnap() && last) undoSnap = { keys: keys.slice(), liftKeys: liftKeys.slice(), path: copyPath(path), lastN: path.blocks[path.blocks.length - 1].n, mesh: copyMesh(mesh), last, detail };
        from = g; fromS = path.lengthM; geom.extendPath(path, segs);
        const { lk, a } = relift();
        if (a < keys.length) undoSnap = null;   // the lift moved an OLD piece: sculptMesh changes old pieces in place, so the copy is not the old track
        mesh = a < keys.length ? geom.sculptMesh(mesh, shown, meshSegs(segs, lk), a) : geom.extendMesh(mesh, shown, meshSegs(segs, lk)); liftKeys = lk; how = 'extend';
      } else if (nk.length >= keys.length) {
        geom.rebuildPathFrom(path, segs, g);
        const { lk, a } = relift(), s0 = Math.min(g, a);
        from = s0; fromS = path.starts[s0].s; mesh = geom.sculptMesh(mesh, shown, meshSegs(segs, lk), s0); liftKeys = lk; how = 'sculpt';
      } else if (!isClosed && !closed && g === nk.length && mesh && mesh._state && typeof geom.reuseMesh === 'function') {
        // A REMOVAL FROM THE END of an open track (an undo of a placement, in a history not made in this session; 2026-10-13: 19 to 20 s on the user's 24 km ELYSIUM, a full
        // mesh): the path is grown again (cheap), and the mesh keeps every remaining piece whose segment and lift are what they were, placed anew (geom.reuseMesh, the
        // closed loop's own reuse, given the old mesh cut to the remaining pieces; equal to a full build to round-off, app/test/preview-undo.test.js row 6).
        const at0 = startOpt ? { start: startOpt } : {};   // where the track starts, as full() places it
        path = geom.buildPath(segs, { ...pathOpts, closed: false, ...at0 }); shown = lift ? lift(path) : path;
        const lk = segs.map((_, j) => liftOf(path, shown, j)), n = segs.length, old = mesh._state;
        const cut = { ...mesh, _state: { ...old, pieces: old.pieces.slice(0, n), seams: old.seams.slice(0, n), nseg: n } };
        mesh = geom.reuseMesh(cut, shown, meshSegs(segs, lk), segs.map((_, j) => nk[j] === keys[j] && lk[j] === liftKeys[j]));
        liftKeys = lk; how = 'full';
      } else how = yield* fullSteps(segs, isClosed, lift, nk);   // a removal: the incremental calls only grow or rewrite a track, so rebuild it
      keys = nk; closed = isClosed;
      // an adopted ghost: the placed batches as they were, then the ghost's (batchesOf in one order: the old pieces' nodes are the same, the new pieces and the seam onto them are the ghost's), and the box of both
      const batches = how === 'same' && last ? last.batches : adopted ? last.batches.concat(adopted.bs) : batchesOf(mesh);
      const bounds = how === 'same' && last ? last.bounds : adopted ? unionBounds(last.bounds, worldBounds(adopted.bs)) : worldBounds(batches);
      lastResolved = resolved; detailMoved = false; lastFull = null;
      last = { path: shown, mesh, how, batches, bounds, segments: resolved.segments, g: from, fromS };   // the REAL segments, whatever the detail meshed
      return last;
    },
    /** The preview's detail: 1 (full, the export's) or a factor from 2 up (coarse, while dragging). Returns the detail now in force. */
    setDetail(k) { const d = Number.isFinite(k) && k >= 2 ? Math.floor(k) : 1; if (d !== detail) { detail = d; detailMoved = true; } return detail; },
    get detail() { return detail; },
    /**
     * D266 item 2: `cheap` builds the ghost while a handle is being DRAGGED: the NEW pieces' row grid thinned (coarse.js CHEAP_FACTOR: a 1000 m tube is about a twelfth of the vertices), the placed segments exactly as they are
     * (the candidate must still extend them), the same path (the handles read it). The full ghost is built when the drag stops. Nothing placed is touched either way.
     */
    ghostFor(candidate, opts) { const it = tm.ghostSteps(candidate, opts); let r = it.next(); while (!r.done) r = it.next(); return r.value; },
    /**
     * D407: ghostFor as a generator, for a caller that must not hold the page while the whole ghost is built (the exact ghost made when a handle is let go: 60 ms at 1,000 m, 2 s at 20 km): it yields between
     * the new pieces and the seams and returns what ghostFor returns; the same work in the same order, so the mesh is the same to the byte (ghostFor above is this run to the end).
     */
    *ghostSteps(candidate, { cheap = false } = {}) {
      const all = candidate && candidate.segments;
      const segs = candidate && detail > 1 ? coarsen(all, detail) : cheap && Array.isArray(all) ? [...all.slice(0, keys.length), ...coarsenRun(all.slice(keys.length), CHEAP_FACTOR)] : all;
      if (!Array.isArray(segs)) throw new Error('ghost: needs a resolved candidate { segments }');
      const nk = cheap ? segs.map(keyOf) : segs.slice(0, keys.length).map(keyOf);   // D407: the new chords' keys serve only the cheap ghost's reuse; a full ghost keys the placed prefix it must match
      // D404: a cheap ghost whose new chords are COARSE (the shell's candidate(opts, { coarse }): longer than 2 m) puts at most CHEAP_STATIONS stations on them; one built from 2 m chords has
      // a station at every chord end whatever the step, so it is built as it always was (and reuses the last one's chords, below)
      const newSegs = cheap ? segs.slice(keys.length) : [], newLen = newSegs.reduce((a, g) => a + (g.length || 0), 0), step = newLen > CHEAP_STATIONS * STEP && newLen > 2.5 * newSegs.length ? newLen / CHEAP_STATIONS : STEP;
      if (segs.length <= keys.length || keys.some((k, i) => k !== nk[i])) throw new Error('ghost: the candidate must extend the placed track (the same segments, then more)');
      // THE CHEAP GHOST REMEMBERS ITS LAST MESH (2026-10-14, stretching a long piece): a drag rebuilds the candidate on every move, but a length drag leaves most of its
      // segments exactly as they were, so a new piece whose segment key is the last cheap ghost's at the same index keeps its mesh and only moves (geom.reuseMesh, `from`:
      // the placed track is taken as it is). Valid only on the same placed path; any full ghost, update or change of detail forgets it.
      const reuse = cheap && typeof geom.reuseMesh === 'function' && lastCheap && lastCheap.base === path && lastCheap.from === keys.length && lastCheap.step === step ? lastCheap : null;
      const remember = (gm) => { lastCheap = cheap ? { base: path, from: keys.length, mesh: gm, nk, step } : null; return gm; };
      const meshNew = function* (p, build) { return remember(reuse ? geom.reuseMesh(reuse.mesh, p, segs, nk.map((k, j) => j >= keys.length && k === reuse.nk[j]), { from: keys.length, grow: true }) : yield* build()); };
      if (!path) { const p = yield* geom.buildPathSteps(segs, { ...pathOpts, step, ...(step > STEP ? { substep: CHEAP_SUBSTEP } : {}), ...(candidate.start ? { start: candidate.start } : {}) }); const gm0 = yield* meshNew(p, () => geom.buildMeshSteps(p, segs, meshOpts)); yield; const bs0 = batchesOf(gm0); if (!cheap) yield* warmLines(bs0); return { batches: bs0, path: p, head: p.head, segments: segs }; }
      if (closed) throw new Error('ghost: a closed loop has no open end');
      // copies: extendPath only pops and pushes these arrays and never edits a sample, and of the blocks it changes only the
      // last one's sample count (so that block is copied); extendMesh only sets new pieces and seams
      const blocks = path.blocks.slice(); blocks[blocks.length - 1] = { ...blocks[blocks.length - 1] };
      const p = { ...path, samples: path.samples.slice(), starts: path.starts.slice(), segFirst: path.segFirst.slice(), segEnd: path.segEnd.slice(), blocks };
      const st = mesh._state, m = { ...mesh, _state: { ...st, pieces: st.pieces.slice(), seams: st.seams.slice() } };
      p.step = step; if (step > STEP) p.substep = CHEAP_SUBSTEP;   // the ghost's own copy: the placed path keeps its stations (D404)
      yield* geom.extendPathSteps(p, segs);   // D407: a slice at a time when run as steps
      const gm = yield* meshNew(p, () => geom.extendMeshSteps(m, p, segs)), from = keys.length;
      yield; const bs = batchesOf(gm, from); if (!cheap) yield* warmLines(bs);
      lastFull = !cheap && detail === 1 && segs === all ? { base: path, mesh0: mesh, from, segs, p, gm, bs } : null;
      return { batches: bs, path: p, head: p.head, segments: segs };   // D235: only the NEW pieces' batches are built (it built every batch and kept the new ones)
    },
    /**
     * D242: the GHOST of a close PROPOSAL (the shell's closeProposal: a closed track that rewrites pieces, not one that extends the placed track, so
     * ghostFor's copy-and-extend does not apply). The proposed track is built in full on its own (the placed track untouched), and the ghost is the
     * batches of the pieces from the first segment that differs from the placed one: for a local close, its window. { batches, path, head, segments, from }.
     */
    proposalGhost(candidate) {
      const segs = candidate && detail > 1 ? coarsen(candidate.segments, detail) : candidate && candidate.segments;
      if (!Array.isArray(segs) || !segs.length) throw new Error('ghost: a close proposal needs a resolved { segments }');
      const nk = segs.map(keyOf); let from = 0; while (from < keys.length && from < nk.length && keys[from] === nk[from]) from++;
      const p0 = geom.buildPath(segs, { ...pathOpts, closed: !!candidate.closed, ...(candidate.start ? { start: candidate.start } : {}) }), p = typeof candidate.lift === 'function' ? candidate.lift(p0) : p0;
      // a proposal that only ADDS road to the open track (Finish to start: nothing placed moves) keeps the placed mesh and makes only the new road (2026-10-15: 6.3 s in full on 24 km)
      if (mesh && mesh._state && !closed && builtDetail === detail && from === keys.length && typeof geom.reuseMesh === 'function') {
        const lk = segs.map((_, j) => liftOf(p0, p, j)), same = segs.map((_, j) => j < keys.length && lk[j] === liftKeys[j]);   // the lift too, as full() keeps it
        if (same.slice(0, keys.length).every(Boolean)) return { batches: batchesOf(geom.reuseMesh(mesh, p, meshSegs(segs, lk), same, { grow: true }), from), path: p, head: p.head, segments: segs, from };
      }
      return { batches: batchesOf(geom.buildMesh(p, segs, meshOpts), from), path: p, head: p.head, segments: segs, from };
    },
    /** The path everything reads: the base path lifted by the document's offsets (the same object when there are none). */
    get path() { return shown; },
    get mesh() { return mesh; },
  };
  return tm;
}

module.exports = { createTrackModel, STEP, WASH, washOf };
