// exportworker.js: the WORKER the export runs in (D437b), inside the export's own process: app/export/exportrunner.js makes a sandboxed iframe, which
// Chromium gives a renderer process of its own, and the iframe makes this worker from its text. A sandboxed frame has an opaque origin and cannot fetch
// the app's files, so the worker is BOOTED with their texts (the files the page's exporter loaded) and loads app/export/exportjob.js through the app's
// own CommonJS loader (app/lib/cjs.js) from them, as app/core/closeworker.js loads closejob.js from the served files. Messages:
//   in:  { boot: { <path>: text, ... } }                     once, first: the files (app/lib/cjs.js among them)
//        { serial, job }                                     the export (exportjob.js packJob)
//   out: { serial, stage }                                   each stage as the export reaches it ("building the pit-lane check"), so that if this process
//                                                            dies the page can say where
//        { serial, ok: true, out }                           runJob's { result, folders }, the file bytes TRANSFERRED, not copied
//        { serial, ok: false, error }                        exportjob.js errorOf: the export refused (an ExportError) or failed, and at which stage
// A heap out-of-memory here ends this process, not the page's: the page notices the silence (exportrunner.js) and says so.
'use strict';

let ready = null;
self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.boot) {
    const src = m.boot, get = (p) => (Object.prototype.hasOwnProperty.call(src, p) ? Promise.resolve(src[p]) : Promise.reject(new Error(`the export's files do not include ${p}`)));
    ready = (async () => {
      self.window = self;   // app/lib/cjs.js publishes loadCjs on `window`; a worker has none
      (0, eval)(src['app/lib/cjs.js']);   // global code, as importScripts would run it: a sandboxed frame's worker cannot fetch the file
      const J = await self.loadCjs('app/export/exportjob.js', get);
      return { J, env: await J.loadEnv(self.loadCjs, get) };
    })();
    ready.catch(() => {});   // answered when a job asks for it
    return;
  }
  if (!m.job) return;
  let R;
  try { R = await ready; if (!R) throw new Error('it was not booted'); }
  catch (err) { self.postMessage({ serial: m.serial, ok: false, error: { name: 'Error', code: null, message: `the export could not start: ${String((err && err.message) || err)}`, stage: 'starting' } }); return; }
  let stage = R.J.STARTING;
  try {
    const out = R.J.runJob(R.env, m.job, (s) => { stage = s; self.postMessage({ serial: m.serial, stage: s }); });
    self.postMessage({ serial: m.serial, ok: true, out }, R.J.transferOf(out));
  } catch (err) {
    self.postMessage({ serial: m.serial, ok: false, error: R.J.errorOf(err, stage) });
  }
};
