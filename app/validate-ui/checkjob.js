// checkjob.js: the track checker OFF the window's thread (the keeper, 2026-10-14: placing a piece on ELYSIUM, 24 km, froze the window 1.5 s
// and opening it about 40 s, most of it this check). ONE pure job that a Web Worker runs (app/validate-ui/checkworker.js), or a test runs here:
//
//   const job = createCheckJob();
//   job.run({ doc, dragging, csp })  -> { how, error, pathFrom, result, arcs, graph, roadM }   plain data, cheap to send back
//     doc       the document as the core shell holds it (state.history.present): plain data
//     dragging  whether a drag is open (state.history.dragBase): the controller's drag window and deferred lap, as on the page
//     csp       the panel's CSP switch
//
// IT IS THE PAGE'S CHECK, EXACTLY. The document is resolved as app/core/coreshell.js resolvedOf resolves it (src/core/adapter.js toSegments
// with a per-piece cache, the start pose, offsetPath as the lift); the path is the preview's, made by the preview's own track model
// (app/preview/trackmodel.js) with meshing left out; and the check is app/validate-ui/panel.js createValidationController on that shared
// path, as app/validate-ui/index.js runs it. Identity is what keeps it incremental: a document arrives as a fresh copy every time, so its
// pieces are INTERNED by their JSON text (an unchanged piece is the very object it was), and the per-piece cache then hands back the same
// frozen segments, so the controller sees an append, a trim or an unchanged road just as it does on the page.
//
// What goes back is what the panel shows (index.js render): the findings (red, amber, info), the lap, the jumps, pendingFrom, the jump arcs and
// the load graph (graph.js graphModel). Not the per-station lines and colour map (tens of thousands of objects on a long track, and
// copying them back would cost the window what this saves).
'use strict';

const AD = require('../../src/core/adapter.js');
const G = require('../../src/geom/index.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const { createValidationController } = require('./panel.js');
const { graphModel } = require('./graph.js');

/** A mesh with nothing in it: the track model's path is what the check reads, and meshing 24 km would cost the worker seconds for nothing. */
const emptyMesh = () => ({ scene: { root: { children: [] }, materials: [] }, cells: [], _state: { pieces: [], seams: [], nseg: 0 } });
const PATH_ONLY = Object.freeze({ ...G, buildMesh: emptyMesh, extendMesh: (m) => m, sculptMesh: (m) => m, reuseMesh: () => emptyMesh() });

const offsetPath = typeof AD.offsetPath === 'function' ? AD.offsetPath : null;

function createCheckJob() {
  const known = new Map();      // a piece's JSON text -> the one piece object for it (interned)
  const segCache = new WeakMap();   // toSegments' per-piece cache, as the shell keeps it
  const model = createTrackModel({ geom: PATH_ONLY });
  let state = null, track = null, ctl = null, csp = true;
  const subs = new Set();
  const shell = { getState: () => state, subscribe(f) { subs.add(f); return () => subs.delete(f); } };
  const intern = (doc) => {
    if (!doc || !Array.isArray(doc.pieces)) throw new Error('check job: needs a document with pieces');
    const pieces = doc.pieces.map((p) => { const k = JSON.stringify(p); let o = known.get(k); if (!o) { o = p; known.set(k, o); } return o; });
    return { ...doc, pieces };
  };
  // app/core/coreshell.js resolvedOf, line for line
  const resolvedOf = (d) => {
    const segments = d.pieces.length ? AD.toSegments(d, { cache: segCache }) : [];
    return Object.freeze({ segments, closed: !!d.closed, start: { pos: d.start.pos.slice(), theta: d.start.heading, p: d.start.pitch }, lift: offsetPath && segments.length ? (p) => offsetPath(d, segments, p) : undefined });
  };
  return {
    run({ doc, dragging = false, csp: wantCsp = true } = {}) {
      let resolved, resolveError = null;
      try { resolved = resolvedOf(intern(doc)); } catch (e) { if (e.name !== 'CoreError') throw e; resolved = null; resolveError = e.message; }
      if (resolved) { try { track = model.update(resolved); } catch (e) { track = null; } }   // the controller grows its own path when there is no shared one
      state = { resolved, resolveError, history: { dragBase: dragging ? true : null } };
      if (!ctl) ctl = createValidationController(shell, { csp: wantCsp, sharedPath: () => track });   // its first update runs here
      else if (!!wantCsp !== csp) ctl.setCsp(!!wantCsp);   // re-validates the whole track for that export
      else for (const f of subs) f(state);
      csp = !!wantCsp;
      const st = ctl.state, r = st.result;
      return {
        how: st.how, error: st.error, pathFrom: st.pathFrom, arcs: st.arcs, graph: graphModel(st), roadM: st.path ? st.path.lengthM : null,
        result: r ? { red: r.red, amber: r.amber, info: r.info, lap: r.lap, jumps: r.jumps, pendingFrom: r.pendingFrom == null ? null : r.pendingFrom } : null,
      };
    },
  };
}

module.exports = { createCheckJob, PATH_ONLY };
