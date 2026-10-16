// closejob.js: THE CLOSE'S WORK, as one pure job (2026-10-15: Close's "new road from the end to the start" held the window 4.1 s on a 24 km track; it now runs in
// app/core/closeworker.js, as the track checker went in 7512f84). The shell runs it on the page when it has no worker, so both ways compute the same thing:
//
//   runClose({ doc, fraction, last, whole, finish, edited })  -> { converged, report, doc, window, displacement }   (plain data, survives a postMessage)
//     doc        the open track as the shell holds it
//     edited     whole: true only: the pieces the whole-lap close goes round (the shell knows the stretch edited last)
//   A core refusal (CoreError) is thrown, as close() and finishToStart() throw it.
//
//   relink(base, doc)  the answer's document after a postMessage, with every piece that is the same as the open track's taken back as THAT object (the shell's
//                      segment cache and the tests know a piece by its object: Finish to start leaves the user's pieces as the very same ones), and frozen as the core's are
'use strict';

const AD = require('../../src/core/adapter.js');
const { toSegments } = AD;
const { close, closeWindow } = require('../../src/core/close.js');
const { finishToStart } = require('../../src/core/finish.js');

function runClose({ doc, fraction = 0.2, last = false, whole = false, finish = false, edited = null } = {}) {
  const fin = finish ? finishToStart(doc) : null;
  const res = fin ? { converged: true, doc: fin.doc, report: `Finish to start: ${fin.plan.report}`, window: { pieces: fin.window, text: fin.plan.windowText || `the new road (${fin.window.length} piece${fin.window.length === 1 ? '' : 's'}, ${fin.plan.lengthM} m)` } }
    : whole ? close(doc, { edited }) : close(doc, { window: closeWindow(doc, { fraction, last }) });
  if (!res.converged) return { converged: false, report: res.report, doc: null, window: null, displacement: null };
  return { converged: true, report: res.report, doc: res.doc, window: res.window, displacement: displacementOf(doc, res.doc) };
}

/**
 * D242: how far each road piece's CENTRELINE moves between two documents of the same pieces (a close changes control points, never lengths):
 * [{ piece, id, maxM }], the largest distance between the two paths' stations of that piece (the same stations: each segment samples on its own grid).
 */
function displacementOf(a, b) {
  const pa = AD.toPath({ ...a, closed: false }).path.samples, pb = AD.toPath({ ...b, closed: false }).path.samples, segs = toSegments({ ...a, closed: false });
  const idOf = (m) => (segs[m.seg] ? segs[m.seg].id : null), out = new Map();
  a.pieces.forEach((P, i) => { if (P.type === 'road') out.set(P.id, { piece: i, id: P.id, maxM: 0 }); });
  const n = Math.min(pa.length, pb.length);
  for (let k = 0; k < n; k++) { const e = out.get(idOf(pa[k])); if (!e) continue; const d = Math.hypot(pa[k].pos[0] - pb[k].pos[0], pa[k].pos[1] - pb[k].pos[1], pa[k].pos[2] - pb[k].pos[2]); if (d > e.maxM) e.maxM = d; }
  return [...out.values()];
}

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
function relink(base, doc) {
  const byId = new Map(base.pieces.map((P) => [P.id, P]));
  const pieces = doc.pieces.map((P) => { const b = byId.get(P.id); return b && same(b, P) ? b : P; });
  const out = { ...doc, pieces };
  for (const k of Object.keys(out)) if (k !== 'pieces' && base[k] && typeof base[k] === 'object' && same(base[k], out[k])) out[k] = base[k];
  return deepFreeze(out);
}

module.exports = { runClose, displacementOf, relink };
