// overlapworker.js: the WEB WORKER the overlap check runs in (D240 follow-up: a preview must not freeze the page). It loads app/core/overlapjob.js through the app's own CommonJS loader
// (app/lib/cjs.js, with the exporter's in-memory node shim the core's modules need, as the page gives coreshell.js) and answers ONE kind of message:
//   in:  { id, doc, designSpeedKmh, closed }     the proposed document (plain data) and what the check needs
//   out: { id, ok: true, result, timing }         overlapjob.runJob's result: { overlaps, others, amber } (plain data); timing { loadMs, waitedMs, jobMs } in ms
//        { id, ok: false, error }                 the reason, when the check could not run
// The page terminates the worker to cancel (app/core/overlaprunner.js); a worker is started per check and dropped after it.
'use strict';

self.window = self;   // app/lib/cjs.js publishes loadCjs on `window`; a worker has none
importScripts('../lib/cjs.js');
// served files are fetched relative to this script (app/core/): the served root, which mirrors the repository, is two levels up
const get = (p) => fetch(new URL(`../../${p}`, self.location.href)).then((r) => { if (!r.ok) throw new Error(`${r.status} ${p}`); return r.text(); });
const t0 = performance.now();
let loadMs = null;   // how long the worker took to load its modules: reported with every answer, so a slow check can be told from a slow start
const ready = (async () => {
  const shim = (await loadCjs('app/export/node-shim.js', get)).createShim();
  const J = await loadCjs('app/core/overlapjob.js', get, { builtins: shim.builtins, globals: { Buffer: shim.Buffer } });
  loadMs = performance.now() - t0; return J;
})();
self.onmessage = async (e) => {
  const m = e.data || {}, got = performance.now();
  try { const J = await ready, start = performance.now(), result = J.runJob(m); self.postMessage({ id: m.id, ok: true, result, timing: { loadMs: Math.round(loadMs), waitedMs: Math.round(start - got), jobMs: Math.round(performance.now() - start) } }); }
  catch (err) { self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) }); }
};
