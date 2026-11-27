// checkworker.js: the WEB WORKER the track checker runs in (the user, 2026-10-14: the window must not wait for the check). It loads
// app/validate-ui/checkjob.js through the app's own CommonJS loader (app/lib/cjs.js, with the exporter's in-memory node shim the core's modules
// need, as app/core/overlapworker.js does) and answers TWO kinds of message:
//   in:  { serial, doc, dragging, csp }                   the document as the shell holds it, and how to check it (checkjob.js)
//   out: { serial, ok: true, out, ms }                    checkjob.js run's answer (plain data) and how long the check took
//        { serial, ok: false, error }                     the reason, when it could not run
//   in:  { serial, even }                                 D678 repair: Even's sentence after a level (checkjob.js evenCheck; checkrunner.js createEvenRunner
//                                                         makes a worker for each one and ends it on the answer)
//   out: { serial, ok: true, even, ms }                   its { message, leaves }; or { serial, ok: false, error }
// ONLY THE NEWEST document is checked: messages that arrive while a check runs replace each other, and the next check takes the last one
// (each check yields to the message queue before the next), so a run of quick edits costs one check, not one per edit. The job is kept
// between messages: that is what makes a check incremental (an append checks the new piece, not 24 km).
'use strict';

self.window = self;   // app/lib/cjs.js publishes loadCjs on `window`; a worker has none
importScripts('../lib/cjs.js');
// served files are fetched relative to this script (app/validate-ui/): the served root, which mirrors the repository, is two levels up
const get = (p) => fetch(new URL(`../../${p}`, self.location.href)).then((r) => { if (!r.ok) throw new Error(`${r.status} ${p}`); return r.text(); });
const mod = (async () => {
  const shim = (await loadCjs('app/export/node-shim.js', get)).createShim();
  return loadCjs('app/validate-ui/checkjob.js', get, { builtins: shim.builtins, globals: { Buffer: shim.Buffer } });
})();
const ready = mod.then((J) => J.createCheckJob());
async function evenOne(m) {
  let J;
  try { J = await mod; } catch (err) { self.postMessage({ serial: m.serial, ok: false, error: `the checker could not start: ${String((err && err.message) || err)}` }); return; }
  const t = performance.now();
  try { const even = J.evenCheck(m.even); self.postMessage({ serial: m.serial, ok: true, even, ms: Math.round(performance.now() - t) }); }
  catch (err) { self.postMessage({ serial: m.serial, ok: false, error: String((err && err.message) || err) }); }
}
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
self.onmessage = (e) => { const m = e.data || {}; if (m.even) { evenOne(m); return; } latest = m; if (!busy) pump(); };
