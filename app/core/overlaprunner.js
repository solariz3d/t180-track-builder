// overlaprunner.js: runs the overlap check OFF the page's thread (D240 follow-up: "the previews must not freeze"). The core shell is given a runner and asks it for a job:
//
//   runner.start({ doc, designSpeedKmh, closed }) -> { promise, cancel() }
//     promise  resolves with the check's result ({ overlaps, others, amber }, app/core/overlapjob.js), or rejects (the worker failed; or { cancelled: true } after cancel)
//     cancel() terminates the worker at once: whatever it was computing is dropped
//
// createWorkerRunner is the page's: one Web Worker (app/core/overlapworker.js) per job, terminated when it answers or is cancelled. start THROWS if the worker cannot be made (a
// blocked or missing Worker); the shell then runs the check on the page after the preview has been painted, so the answer is never lost, only slower.
'use strict';

function createWorkerRunner({ win, url = 'core/overlapworker.js', WorkerCtor = win && win.Worker } = {}) {
  if (typeof WorkerCtor !== 'function') throw new Error('this page has no Web Worker');
  return {
    start({ doc, designSpeedKmh = null, closed = true }) {
      const w = new WorkerCtor(url);
      let done = false, reject;
      const promise = new Promise((res, rej) => {
        reject = rej;
        w.onmessage = (e) => { if (done) return; done = true; w.terminate(); const m = e.data || {}; if (m.ok) res(m.result); else rej(new Error(m.error || 'the overlap check failed')); };
        w.onerror = (e) => { if (done) return; done = true; w.terminate(); rej(new Error((e && e.message) || 'the overlap worker failed')); };
        w.postMessage({ id: 1, doc, designSpeedKmh, closed });
      });
      return { promise, cancel() { if (done) return; done = true; w.terminate(); reject(Object.assign(new Error('cancelled'), { cancelled: true })); } };
    },
  };
}

module.exports = { createWorkerRunner };
