// closeworker.js: the WEB WORKER Close works out its preview in (2026-10-15: Finish to start held the window 4.1 s on a 24 km track). It loads app/core/closejob.js
// through the app's own CommonJS loader (app/lib/cjs.js, with the exporter's in-memory node shim the core's modules need, as app/core/overlapworker.js does) and
// answers ONE kind of message:
//   in:  { serial, doc, fraction, last, whole, finish, edited }   the open track and how to close it (closejob.js runClose)
//   out: { serial, ok: true, out, ms }                            runClose's answer (plain data) and how long it took
//        { serial, ok: false, refused: { code, message } }        the core refused the close (a CoreError: its words are the message the user reads)
//        { serial, ok: false, error }                             the reason, when it could not run
// The page terminates the worker to cancel (app/core/closerunner.js) and makes a fresh one.
'use strict';

self.window = self;   // app/lib/cjs.js publishes loadCjs on `window`; a worker has none
importScripts('../lib/cjs.js');
// served files are fetched relative to this script (app/core/): the served root, which mirrors the repository, is two levels up
const get = (p) => fetch(new URL(`../../${p}`, self.location.href)).then((r) => { if (!r.ok) throw new Error(`${r.status} ${p}`); return r.text(); });
const ready = (async () => {
  const shim = (await loadCjs('app/export/node-shim.js', get)).createShim();
  return loadCjs('app/core/closejob.js', get, { builtins: shim.builtins, globals: { Buffer: shim.Buffer } });
})();
self.onmessage = async (e) => {
  const m = e.data || {};
  let J;
  try { J = await ready; } catch (err) { self.postMessage({ serial: m.serial, ok: false, error: `the close could not start: ${String((err && err.message) || err)}` }); return; }
  const t = performance.now();
  try { const out = J.runClose(m); self.postMessage({ serial: m.serial, ok: true, out, ms: Math.round(performance.now() - t) }); }
  catch (err) {
    if (err && err.name === 'CoreError') self.postMessage({ serial: m.serial, ok: false, refused: { code: err.code || null, message: err.message } });
    else self.postMessage({ serial: m.serial, ok: false, error: String((err && err.message) || err) });
  }
};
