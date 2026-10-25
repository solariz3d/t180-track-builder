// checkworker.js: the WEB WORKER the track checker runs in (the user, 2026-10-14: the window must not wait for the check). It loads
// app/validate-ui/checkjob.js through the app's own CommonJS loader (app/lib/cjs.js, with the exporter's in-memory node shim the core's modules
// need, as app/core/overlapworker.js does) and answers ONE kind of message:
//   in:  { serial, doc, dragging, csp }                   the document as the shell holds it, and how to check it (checkjob.js)
//   out: { serial, ok: true, out, ms }                    checkjob.js run's answer (plain data) and how long the check took
//        { serial, ok: false, error }                     the reason, when it could not run
// ONLY THE NEWEST document is checked: messages that arrive while a check runs replace each other, and the next check takes the last one
// (each check yields to the message queue before the next), so a run of quick edits costs one check, not one per edit. The job is kept
// between messages: that is what makes a check incremental (an append checks the new piece, not 24 km).
'use strict';

self.window = self;   // app/lib/cjs.js publishes loadCjs on `window`; a worker has none
importScripts('../lib/cjs.js');
// served files are fetched relative to this script (app/validate-ui/): the served root, which mirrors the repository, is two levels up
const get = (p) => fetch(new URL(`../../${p}`, self.location.href)).then((r) => { if (!r.ok) throw new Error(`${r.status} ${p}`); return r.text(); });
const ready = (async () => {
  const shim = (await loadCjs('app/export/node-shim.js', get)).createShim();
  const J = await loadCjs('app/validate-ui/checkjob.js', get, { builtins: shim.builtins, globals: { Buffer: shim.Buffer } });
  return J.createCheckJob();
})();
let latest = null, busy = false;
const yieldToQueue = () => new Promise((r) => setTimeout(r, 0));
async function pump() {
  busy = true;
  try {
    let job;
    try { job = await ready; } catch (err) { const m = latest; latest = null; self.postMessage({ serial: m.serial, ok: false, error: `the checker could not start: ${String((err && err.message) || err)}` }); return; }
    while (latest) {
      const m = latest; latest = null;
      const t = performance.now();
      try { const out = job.run(m); self.postMessage({ serial: m.serial, ok: true, out, ms: Math.round(performance.now() - t) }); }
      catch (err) { self.postMessage({ serial: m.serial, ok: false, error: String((err && err.message) || err) }); }
      await yieldToQueue();   // let newer documents arrive: the next check takes only the newest
    }
  } finally { busy = false; if (latest) pump(); }
}
self.onmessage = (e) => { latest = e.data || {}; if (!busy) pump(); };
