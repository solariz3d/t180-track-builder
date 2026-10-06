// overlaprunner.js: runs the overlap check OFF the page's thread (D240 follow-up: "the previews must not freeze"), on TWO WARM WORKERS (D240 warm-worker follow-up). The core shell is given a
// runner and asks it for a job:
//
//   runner.start({ doc, designSpeedKmh, closed }) -> { promise, cancel(), timing }
//     promise  resolves with the check's result ({ overlaps, others, amber }), or rejects (a worker failed; or { cancelled: true } after cancel)
//     cancel() terminates the workers at once (whatever they were computing is dropped) and puts two fresh warm ones in their place; so does ANY failure of a part (the other
//              worker may still be computing the failed job's other part: it must not answer the next job). Every message also carries the job's serial and a reply that is not the
//              current job's is ignored: the exact guard, with the replacement as the belt (B's look at 485c5b6, p-warm-B_2026-10-05.md section 2)
//     timing   { loadMs, waitedMs, jobMs, restMs, raysMs } in ms, set before the promise resolves (the slower of the two workers' numbers, and each part's own check time)
//
// createWorkerRunner is the page's. THE WORKERS ARE MADE WHEN THE RUNNER IS (at page start), and load their modules while they sit idle; a job reuses them (their modules and their compiled code
// stay warm) and they are kept after it. The check is two independent parts (app/core/overlapjob.js: 'rest' = the mesh's self-check and the validator, 'rays' = the downforce-ray gap search),
// one per worker, run at once; app/core/overlapmerge.js puts the answers together, EXACTLY as the one-piece check gives them (the tests compare them on coils, jumps, cups, tubes and 13 to 14 km
// tracks). The constructor THROWS if a worker cannot be made (a blocked or missing Worker); the shell then runs the check on the page after the preview has been painted, so the answer is
// never lost, only slower.
'use strict';

const { mergeParts } = require('./overlapmerge.js');

const PARTS = Object.freeze(['rest', 'rays']);

function createWorkerRunner({ win, url = 'core/overlapworker.js', WorkerCtor = win && win.Worker } = {}) {
  if (typeof WorkerCtor !== 'function') throw new Error('this page has no Web Worker');
  const make = () => new WorkerCtor(url);
  let pool = PARTS.map(make);   // warm: made now, loading their modules in the background
  const replace = () => { for (const w of pool) { try { w.terminate(); } catch (e) { /* gone already */ } } pool = PARTS.map(make); };
  let running = null, serial = 0;   // serial: one number per job; every message carries it ("<serial>:<part>") and a reply that is not the CURRENT job's is ignored
  return {
    /** The workers now in the pool (for the tests and the window proof). */
    workers: () => pool.slice(),
    start({ doc, designSpeedKmh = null, closed = true }) {
      if (running) running.cancel();   // one job at a time: the shell cancels the old one first, this is only a guard
      const job = { timing: null, promise: null, cancel: null }, mine = pool.slice(), got = {}, mySerial = ++serial;
      let settled = false, pending = PARTS.length, reject;
      const fail = (err, replaceWorkers) => { if (settled) return; settled = true; running = null; for (const w of mine) { w.onmessage = w.onerror = null; } if (replaceWorkers) replace(); reject(err); };
      job.promise = new Promise((res, rej) => {
        reject = rej;
        PARTS.forEach((part, i) => {
          const w = mine[i];
          w.onmessage = (e) => {
            if (settled) return;
            const m = e.data || {};
            if (m.id !== `${mySerial}:${part}`) return;   // not this job's answer (B's look at 485c5b6: a failed job's other part finishing late): never taken for this one
            if (!m.ok) return fail(new Error(m.error || 'the overlap check failed'), true);   // and the workers are replaced on ANY failure: one may still be busy with this job's other part
            got[part] = m;
            if (--pending > 0) return;
            settled = true; running = null; for (const x of mine) x.onmessage = x.onerror = null;
            const t = PARTS.map((p) => got[p].timing).filter(Boolean);
            job.timing = t.length ? { loadMs: Math.max(...t.map((x) => x.loadMs)), waitedMs: Math.max(...t.map((x) => x.waitedMs)), jobMs: Math.max(...t.map((x) => x.jobMs)), restMs: got.rest.timing && got.rest.timing.jobMs, raysMs: got.rays.timing && got.rays.timing.jobMs } : null;
            try { res(mergeParts(got.rest.result, got.rays.result)); } catch (err) { rej(err); }
          };
          w.onerror = (e) => fail(new Error((e && e.message) || 'the overlap worker failed'), true);
          w.postMessage({ id: `${mySerial}:${part}`, part, doc, designSpeedKmh, closed });
        });
      });
      job.cancel = () => fail(Object.assign(new Error('cancelled'), { cancelled: true }), true);
      running = job;
      return job;
    },
  };
}

module.exports = { createWorkerRunner, PARTS };
