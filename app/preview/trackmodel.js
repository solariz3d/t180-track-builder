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
const { worldBounds } = require('./look.js');

const keyOf = (seg) => JSON.stringify(seg);
/** m between path stations: the export's (src/export/fromwords.js buildExport `step: 2`) and validation's. */
const STEP = 2;

function createTrackModel({ geom = G, pathOpts: po = {}, meshOpts = {} } = {}) {
  const pathOpts = { step: STEP, ...po };
  let path = null, mesh = null, keys = [], closed = false, last = null;
  function full(segs, isClosed) {
    path = geom.buildPath(segs, { ...pathOpts, closed: isClosed }); mesh = geom.buildMesh(path, segs, meshOpts); return 'full';
  }
  return {
    update(resolved) {
      if (!resolved) { if (!last) throw new Error('trackModel: no resolved document yet'); return { ...last, how: 'kept', stale: true }; }
      const segs = resolved.segments, isClosed = !!resolved.closed;
      if (!Array.isArray(segs)) throw new Error('trackModel: resolved.segments is missing');
      if (!segs.length) { path = null; mesh = null; keys = []; closed = isClosed; last = { path, mesh, how: 'empty', batches: [], segments: segs, g: null, fromS: null }; return last; }
      const nk = segs.map(keyOf);
      let g = 0; while (g < keys.length && g < nk.length && keys[g] === nk[g]) g++;
      let how, from = null, fromS = null;
      if (!path || isClosed || closed) how = full(segs, isClosed);
      else if (g === keys.length && g === nk.length) how = 'same';
      else if (g === keys.length) { from = g; fromS = path.lengthM; geom.extendPath(path, segs); mesh = geom.extendMesh(mesh, path, segs); how = 'extend'; }
      else if (nk.length >= keys.length) { from = g; fromS = path.starts[g].s; geom.rebuildPathFrom(path, segs, g); mesh = geom.sculptMesh(mesh, path, segs, g); how = 'sculpt'; }
      else how = full(segs, isClosed);   // a removal: the incremental calls only grow or rewrite a track, so rebuild it
      keys = nk; closed = isClosed;
      const batches = how === 'same' && last ? last.batches : batchesOf(mesh);
      last = { path, mesh, how, batches, bounds: how === 'same' && last ? last.bounds : worldBounds(batches), segments: segs, g: from, fromS };
      return last;
    },
    ghostFor(candidate) {
      const segs = candidate && candidate.segments;
      if (!Array.isArray(segs)) throw new Error('ghost: needs a resolved candidate { segments }');
      const nk = segs.map(keyOf);
      if (nk.length <= keys.length || keys.some((k, i) => k !== nk[i])) throw new Error('ghost: the candidate must extend the placed track (the same segments, then more)');
      if (!path) { const p = geom.buildPath(segs, pathOpts); return { batches: batchesOf(geom.buildMesh(p, segs, meshOpts)), path: p, head: p.head }; }
      if (closed) throw new Error('ghost: a closed loop has no open end');
      // copies: extendPath only pops and pushes these arrays and never edits a sample, and of the blocks it changes only the
      // last one's sample count (so that block is copied); extendMesh only sets new pieces and seams
      const blocks = path.blocks.slice(); blocks[blocks.length - 1] = { ...blocks[blocks.length - 1] };
      const p = { ...path, samples: path.samples.slice(), starts: path.starts.slice(), segFirst: path.segFirst.slice(), segEnd: path.segEnd.slice(), blocks };
      const st = mesh._state, m = { ...mesh, _state: { ...st, pieces: st.pieces.slice(), seams: st.seams.slice() } };
      geom.extendPath(p, segs);
      const gm = geom.extendMesh(m, p, segs), from = keys.length;
      return { batches: batchesOf(gm).filter((b) => b.piece >= from), path: p, head: p.head };
    },
    get path() { return path; },
    get mesh() { return mesh; },
  };
}

module.exports = { createTrackModel, STEP };
