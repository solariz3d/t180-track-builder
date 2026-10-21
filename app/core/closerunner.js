// closerunner.js: works out Close's preview OFF the page's thread (2026-10-15: Finish to start held the window 4.1 s on a 24 km track), on ONE WARM WORKER
// (app/core/closeworker.js, made when the runner is, so its modules load while it sits idle). The core shell is given a runner and asks it for a job:
//
//   runner.start({ doc, fraction, last, whole, finish, edited, best, openReds, window }) -> { promise, cancel() }   (best: D339's one press, closejob.js runCloseBest; openReds: D343;
//     window: D421, the piece indices a route tool's release may move)
//     promise  resolves with { out, ms } (closejob.js runClose's answer, after the postMessage) or { refused: { code, message } } (the core refused the close),
//              or rejects (the worker failed; or { cancelled: true } after cancel)
//     cancel() terminates the worker at once (whatever it was computing is dropped) and makes a fresh one; so does any failure
//   Every message carries the job's serial, and a reply that is not the CURRENT job's is ignored (as app/core/overlaprunner.js does).
//
// The constructor THROWS if a worker cannot be made (a blocked or missing Worker); the shell then closes on the page, as it always did.
'use strict';

function createCloseRunner({ win, url = 'core/closeworker.js', WorkerCtor = win && win.Worker } = {}) {
  if (typeof WorkerCtor !== 'function') throw new Error('this page has no Web Worker');
  let w = new WorkerCtor(url), running = null, serial = 0;
  const replace = () => { try { w.terminate(); } catch (e) { /* gone already */ } w = new WorkerCtor(url); };
  return {
    /** The worker now in use (for the tests). */
    worker: () => w,
    start({ doc, fraction = 0.2, last = false, whole = false, finish = false, edited = null, best = false, openReds = null, window = null }) {
      if (running) running.cancel();   // one job at a time: the shell cancels the old one first, this is only a guard
      const mine = w, mySerial = ++serial, job = { promise: null, cancel: null };
      let settled = false, reject;
      const fail = (err) => { if (settled) return; settled = true; running = null; mine.onmessage = mine.onerror = null; replace(); reject(err); };
      job.promise = new Promise((res, rej) => {
        reject = rej;
        mine.onmessage = (e) => {
          const m = (e && e.data) || {};
          if (settled || m.serial !== mySerial) return;   // not this job's answer
          if (!m.ok && !m.refused) return fail(new Error(m.error || 'the close failed'));
          settled = true; running = null; mine.onmessage = mine.onerror = null;
          res(m.ok ? { out: m.out, ms: m.ms } : { refused: m.refused });
        };
        mine.onerror = (e) => fail(new Error((e && e.message) || 'the close worker failed'));
        mine.postMessage({ serial: mySerial, doc, fraction, last: !!last, whole: !!whole, finish: !!finish, edited, best: !!best, openReds, ...(window ? { window } : {}) });   // D421: only when asked, so every other job's message is what it was
      });
      job.cancel = () => fail(Object.assign(new Error('cancelled'), { cancelled: true }));
      running = job;
      return job;
    },
  };
}

module.exports = { createCloseRunner };
