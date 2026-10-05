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
const { coarsen } = require('./coarse.js');
const { worldBounds } = require('./look.js');

const { keyOf } = require('./segkey.js');   // D235: the change key of a segment, hashed (it was JSON.stringify: tens of milliseconds a ghost keystroke on a long tube)
/** m between path stations: the export's (src/export/fromwords.js buildExport `step: 2`) and validation's. */
const STEP = 2;

function createTrackModel({ geom = G, pathOpts: po = {}, meshOpts = {} } = {}) {
  const pathOpts = { step: STEP, ...po };
  // `path` is the BASE path the geometry grows incrementally; `shown` is what everything reads (the mesh, the cameras, the shared
  // track): the base path LIFTED by resolved.lift when the document has offsets (D186: the equation core's hill and swerve, A's
  // src/core/adapter.js offsetPath, which recomputes the frame from the lifted centreline). With no lift they are the same object.
  let path = null, shown = null, mesh = null, keys = [], liftKeys = [], closed = false, last = null, startKey = null, startOpt = null;
  // D235: `detail` > 1 meshes a COARSER preview (app/preview/coarse.js thins each segment's row grid) while the track is being dragged; 1 is full detail, the export's.
  // A change of detail is a full rebuild. `lastResolved` is the state's document the last update was built from: the very same object builds nothing again.
  let detail = 1, detailMoved = false, lastResolved = null;
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
  function full(segs, isClosed, lift, nk) {
    path = geom.buildPath(segs, { ...pathOpts, closed: isClosed, ...(startOpt ? { start: startOpt } : {}) }); shown = lift ? lift(path) : path;
    liftKeys = segs.map((_, j) => liftOf(path, shown, j));
    const ms = meshSegs(segs, liftKeys), slot = isClosed ? slots.get(detail) : null;
    if (slot && typeof geom.reuseMesh === 'function' && slot.mesh && slot.keys.length === segs.length) mesh = geom.reuseMesh(slot.mesh, shown, ms, segs.map((_, j) => nk[j] === slot.keys[j] && liftKeys[j] === slot.liftKeys[j]));
    else mesh = geom.buildMesh(shown, ms, meshOpts);
    if (isClosed) slots.set(detail, { keys: nk, liftKeys, mesh }); else slots.clear();
    return 'full';
  }
  return {
    update(resolved) {
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
      let how, from = null, fromS = null;
      // the lift, redone on the base path after any growth; the first segment whose lifted samples changed
      const relift = () => { shown = lift ? lift(path) : path; const lk = segs.map((_, j) => liftOf(path, shown, j)); let a = 0; while (a < lk.length && a < liftKeys.length && lk[a] === liftKeys[a]) a++; return { lk, a }; };
      if (!path || isClosed || closed || startMoved || detailMoved) how = full(segs, isClosed, lift, nk);
      else if (g === keys.length && g === nk.length) {
        const { lk, a } = relift();
        if (a === lk.length && a === liftKeys.length) how = 'same';
        else { from = a; fromS = path.starts[a].s; mesh = geom.sculptMesh(mesh, shown, meshSegs(segs, lk), a); liftKeys = lk; how = 'sculpt'; }   // only the offsets changed (a hill brush)
      } else if (g === keys.length) {
        from = g; fromS = path.lengthM; geom.extendPath(path, segs);
        const { lk, a } = relift();
        mesh = a < keys.length ? geom.sculptMesh(mesh, shown, meshSegs(segs, lk), a) : geom.extendMesh(mesh, shown, meshSegs(segs, lk)); liftKeys = lk; how = 'extend';
      } else if (nk.length >= keys.length) {
        geom.rebuildPathFrom(path, segs, g);
        const { lk, a } = relift(), s0 = Math.min(g, a);
        from = s0; fromS = path.starts[s0].s; mesh = geom.sculptMesh(mesh, shown, meshSegs(segs, lk), s0); liftKeys = lk; how = 'sculpt';
      } else how = full(segs, isClosed, lift, nk);   // a removal: the incremental calls only grow or rewrite a track, so rebuild it
      keys = nk; closed = isClosed;
      const batches = how === 'same' && last ? last.batches : batchesOf(mesh);
      lastResolved = resolved; detailMoved = false;
      last = { path: shown, mesh, how, batches, bounds: how === 'same' && last ? last.bounds : worldBounds(batches), segments: resolved.segments, g: from, fromS };   // the REAL segments, whatever the detail meshed
      return last;
    },
    /** The preview's detail: 1 (full, the export's) or a factor from 2 up (coarse, while dragging). Returns the detail now in force. */
    setDetail(k) { const d = Number.isFinite(k) && k >= 2 ? Math.floor(k) : 1; if (d !== detail) { detail = d; detailMoved = true; } return detail; },
    get detail() { return detail; },
    ghostFor(candidate) {
      const segs = candidate && detail > 1 ? coarsen(candidate.segments, detail) : candidate && candidate.segments;
      if (!Array.isArray(segs)) throw new Error('ghost: needs a resolved candidate { segments }');
      const nk = segs.map(keyOf);
      if (nk.length <= keys.length || keys.some((k, i) => k !== nk[i])) throw new Error('ghost: the candidate must extend the placed track (the same segments, then more)');
      if (!path) { const p = geom.buildPath(segs, { ...pathOpts, ...(candidate.start ? { start: candidate.start } : {}) }); return { batches: batchesOf(geom.buildMesh(p, segs, meshOpts)), path: p, head: p.head, segments: segs }; }
      if (closed) throw new Error('ghost: a closed loop has no open end');
      // copies: extendPath only pops and pushes these arrays and never edits a sample, and of the blocks it changes only the
      // last one's sample count (so that block is copied); extendMesh only sets new pieces and seams
      const blocks = path.blocks.slice(); blocks[blocks.length - 1] = { ...blocks[blocks.length - 1] };
      const p = { ...path, samples: path.samples.slice(), starts: path.starts.slice(), segFirst: path.segFirst.slice(), segEnd: path.segEnd.slice(), blocks };
      const st = mesh._state, m = { ...mesh, _state: { ...st, pieces: st.pieces.slice(), seams: st.seams.slice() } };
      geom.extendPath(p, segs);
      const gm = geom.extendMesh(m, p, segs), from = keys.length;
      return { batches: batchesOf(gm, from), path: p, head: p.head, segments: segs };   // D235: only the NEW pieces' batches are built (it built every batch and kept the new ones)
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
      return { batches: batchesOf(geom.buildMesh(p, segs, meshOpts), from), path: p, head: p.head, segments: segs, from };
    },
    /** The path everything reads: the base path lifted by the document's offsets (the same object when there are none). */
    get path() { return shown; },
    get mesh() { return mesh; },
  };
}

module.exports = { createTrackModel, STEP };
