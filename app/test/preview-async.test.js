// preview-async.test.js: node --test app/test/preview-async.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D240 follow-up, "the previews must not FREEZE" (the keeper reads a 10 s freeze as broken; E measured Close's preview at 13.4 s on TEST 1, a middle delete's took 8.5 to 10.3 s on 13 km):
// the preview of a Close and of a middle delete show their ghost and per-piece displacement AT ONCE, the overlap check runs off the page's thread (a Web Worker: app/core/overlapworker.js,
// the pure job app/core/overlapjob.js, the runner app/core/overlaprunner.js), Apply is OFF until the result lands, and Cancel (or any change that drops the preview) stops it. FEEL tier:
// targeted rows, no mutation harness. Rows:
//   1  THE RESULT IS IDENTICAL: the job (what the worker runs, after a structured clone, as a postMessage does) equals the synchronous overlapCheck, on a coil and on TEST-1-sized tracks
//      (a 14 km near-closed lap's Close, a 46-piece 13 km track's middle delete)
//   2  the worker script itself, run in a sandbox with a fake `self` (importScripts, fetch of the real files, postMessage): it loads its modules through the app's loader and answers with the same result
//   3  the runner (TWO WARM WORKERS, D240 warm-worker follow-up): made when the runner is, one part each, reused by the next job, cancel terminates both and makes two fresh ones, a failed part,
//      a worker that errors, a Worker that cannot be made
//   3b the check's TWO PARTS put together are EXACTLY the one-piece check, on a coil, a jump, a cup, a tube, a 13 km delete and a 14 km Close
//   4  the shell, Close and delete both: the preview is there at once with its check 'checking'; Apply is refused until the result lands and then works (backup first); Cancel, an edit, an Undo,
//      another selection and a newer preview each cancel the running check; a stale answer changes nothing; a failed check refuses Apply by name; a worker that cannot start falls back to the page
//   5  the panels on a fake DOM (Close's and the delete's): the "Checking for overlaps… N s" line, Apply disabled until the result, then the groups; Cancel stops the job
//   6  the ghost is on the preview while the check runs, and the preview is not rebuilt when the answer lands (the proposal object is the same)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCoreShell } = require('../core/coreshell.js');
const OJ = require('../core/overlapjob.js');
const { mergeParts } = require('../core/overlapmerge.js');
const { createWorkerRunner } = require('../core/overlaprunner.js');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const C = require('../../src/core/close.js');
const P = require('../preview/preview.js');

const R = 180, Q = (Math.PI * R) / 2;
const clone = (x) => structuredClone(x);   // what a postMessage does to the result: it must survive it, unchanged

/** A fake runner whose jobs the test settles by hand: each job records its arguments and how many times it was cancelled. */
function fakeRunner({ throwOnStart = false } = {}) {
  const r = { jobs: [], start(args) {
    if (throwOnStart) throw new Error('no worker here');
    let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
    const job = { args, promise, cancelled: 0, resolve, reject, cancel() { job.cancelled++; reject(Object.assign(new Error('cancelled'), { cancelled: true })); } };
    r.jobs.push(job); return job;
  } };
  return r;
}
const RED = { overlaps: [{ reason: 'self-intersection', s0: 210, s1: 230 }], others: [], amber: 0 }, CLEAR = { overlaps: [], others: [], amber: 0 };
const tick = () => new Promise((r) => setImmediate(r));

async function openLap({ turns = 4, lastLen = 200, runner = null } = {}) {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0, overlapRunner: runner });
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < turns; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: lastLen, transition: Math.min(40, lastLen), targets: { kh: 0 } });
  assert.equal(s.getState().message, null, s.getState().message); return s;
}
/** A NEAR lap, 8.87 m from closing (B's, core-close-preview.test.js), optionally with a runner. */
async function nearLap(runner = null, far = null, extra = {}) {
  far = far || (await openLap()).getState().history.present;
  const open = D.checkDoc({ ...C.close(far, { edited: [0] }).doc, closed: false });
  const near = D.checkDoc({ ...open, pieces: open.pieces.map((p, k) => (k === 2 ? { ...p, channels: { ...p.channels, kh: p.channels.kh.map((v, i, a) => (i >= 3 && i <= a.length - 4 ? v + 1e-4 : v)) } } : p)) });
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0, overlapRunner: runner, ...extra }); s.adopt(near); return s;
}
/** An open track of five pieces. */
async function track(runner = null, st = null) {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0, overlapRunner: runner, storage: st });
  s.extend({ length: 300, family: 'bowl' }); s.extend({ length: 150, transition: 60, targets: { kh: 1 / R } }); s.extend({ length: 150, transition: 60, targets: { kh: 1 / R } }); s.extend({ length: 100, transition: 60, targets: { kh: 0 } }); s.extend({ length: 80 });
  return s;
}

test('row 1: the job a worker runs gives EXACTLY the synchronous overlapCheck, on a coil and on TEST-1-sized tracks', async () => {
  // a coil (two circles on one another), the preview of Close: the check must find the overlaps and the job must find the same ones
  const coil = await openLap({ turns: 8, lastLen: 60 }); coil.proposeClose();
  const cp = coil.getState().closeProposal; assert.ok(cp && cp.check.overlaps.length > 0, 'control: the coil overlaps itself');
  assert.deepEqual(clone(OJ.runJob({ doc: cp.doc, designSpeedKmh: null, closed: true })), cp.check, 'the coil: Close\'s check');
  assert.deepEqual(clone(OJ.runJob({ doc: cp.doc, designSpeedKmh: 120, closed: true })), clone(OJ.overlapCheck(OJ.resolveDoc(cp.doc), 120, { closed: true })), 'a design speed goes through the same way');
  // the delete's preview of the same coil, an OPEN track
  coil.cancelClose(); coil.selectPiece(0); coil.deleteSelection(); const dp = coil.getState().deleteProposal; assert.ok(dp && dp.check.overlaps.length > 0);
  assert.deepEqual(clone(OJ.runJob({ doc: dp.doc, designSpeedKmh: null, closed: false })), dp.check, 'the coil: the delete\'s check on an open track');
  // TEST-1-sized: a 46-piece 13 km track's middle delete
  const big = await createCoreShell({ brushFn: null, autosaveMs: 0 }); big.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 45; i++) big.extend({ length: i % 3 === 2 ? 250 : 300, transition: 60, targets: { kh: (i % 2 ? -1 : 1) / 300 } });
  big.selectPiece(20); big.deleteSelection(); const bp = big.getState().deleteProposal; assert.ok(bp, big.getState().message);
  assert.deepEqual(clone(OJ.runJob({ doc: bp.doc, designSpeedKmh: null, closed: false })), bp.check, '13 km, 46 pieces: the delete\'s check');
  // and a 14 km near-closed lap's Close
  let d = extend(D.createDoc('big lap'), { length: 3000, family: 'bowl' });
  for (let i = 0; i < 4; i++) { d = extend(d, { length: (Math.PI * 1000) / 2, transition: 60, targets: { kh: 1 / 1000 } }); d = extend(d, { length: i % 2 ? 3000 : 1000, transition: 60, targets: { kh: 0 } }); }
  const lap = await nearLap(null, D.checkDoc({ ...d, pieces: d.pieces.slice(0, -1), nextId: d.nextId })).catch((e) => e);
  if (lap instanceof Error) { assert.fail(`the 14 km lap could not be made near-closed: ${lap.message}`); }
  lap.proposeClose({ last: true }); const lp = lap.getState().closeProposal;
  if (lp) assert.deepEqual(clone(OJ.runJob({ doc: lp.doc, designSpeedKmh: null, closed: true })), lp.check, 'a 14 km lap: Close\'s check');
  else assert.match(lap.getState().message, /CLOSE_WINDOW|could not|converge|refus/i, 'the big lap was refused by name, so only the delete is compared: ' + lap.getState().message);
});

test('row 2: the worker SCRIPT, run in a sandbox with a fake self, loads its modules through the app\'s own loader and answers with the same result', async () => {
  const dir = path.join(__dirname, '..', 'core'), ROOT = path.resolve(__dirname, '..', '..'), posted = [];
  const ctx = { URL, console, Buffer, structuredClone, setTimeout, clearTimeout, TextEncoder, TextDecoder, performance, location: { href: 'http://localhost/app/core/overlapworker.js' } };
  ctx.self = ctx; ctx.postMessage = (m) => posted.push(m);
  ctx.importScripts = (u) => vm.runInContext(fs.readFileSync(path.resolve(dir, u), 'utf8'), ctx, { filename: u });
  ctx.fetch = async (url) => { const rel = decodeURIComponent(new URL(String(url)).pathname).replace(/^\//, ''), f = path.join(ROOT, rel); return fs.existsSync(f) ? { ok: true, status: 200, text: async () => fs.readFileSync(f, 'utf8') } : { ok: false, status: 404, text: async () => '' }; };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(dir, 'overlapworker.js'), 'utf8'), ctx, { filename: 'overlapworker.js' });
  assert.equal(typeof ctx.onmessage, 'function', 'the worker listens for a message');
  const coil = await openLap({ turns: 8, lastLen: 60 }); coil.proposeClose(); const cp = coil.getState().closeProposal;
  await ctx.onmessage({ data: { id: 7, doc: clone(cp.doc), designSpeedKmh: null, closed: true } });
  assert.equal(posted.length, 1, JSON.stringify(posted).slice(0, 300)); assert.equal(posted[0].id, 7); assert.equal(posted[0].ok, true, posted[0].error);
  assert.deepEqual(structuredClone(posted[0].result), cp.check, 'the worker answers with the synchronous result');
  await ctx.onmessage({ data: { id: 9, part: 'rest', doc: clone(cp.doc), designSpeedKmh: null, closed: true } }); await ctx.onmessage({ data: { id: 10, part: 'rays', doc: clone(cp.doc), designSpeedKmh: null, closed: true } });
  assert.deepEqual([posted[1].ok, posted[2].ok], [true, true], posted[1].error || posted[2].error); assert.ok(posted[1].timing && Number.isFinite(posted[1].timing.loadMs) && Number.isFinite(posted[1].timing.jobMs), 'the worker reports how long it took');
  assert.deepEqual(mergeParts(structuredClone(posted[1].result), structuredClone(posted[2].result)), cp.check, 'the two parts the worker answers put together are the whole check');
  await ctx.onmessage({ data: { id: 8, doc: { not: 'a document' }, closed: true } });
  assert.equal(posted[3].ok, false); assert.equal(typeof posted[3].error, 'string', 'a bad job is an error message, never a hang');
});

test('row 3: the runner: two warm workers made with it, one part each, reused by the next job; cancel terminates both and makes two fresh; a failed part keeps them; a worker that errors is replaced', async () => {
  const made = [];
  class FakeWorker { constructor(url) { this.url = url; this.terminated = 0; this.sent = []; made.push(this); } postMessage(m) { this.sent.push(m); } terminate() { this.terminated++; } }
  const runner = createWorkerRunner({ win: {}, WorkerCtor: FakeWorker, url: 'core/overlapworker.js' });
  assert.equal(made.length, 2, 'two workers exist before any job: they are warm'); assert.ok(made.every((w) => w.url === 'core/overlapworker.js' && w.sent.length === 0));
  const answer = (w, part, result, timing) => w.onmessage({ data: { id: 1, ok: true, result, timing } });
  const a = runner.start({ doc: { x: 1 }, designSpeedKmh: 90, closed: false }); assert.equal(made.length, 2, 'the job made no new worker');
  assert.deepEqual(made[0].sent[0], { id: 1, part: 'rest', doc: { x: 1 }, designSpeedKmh: 90, closed: false }); assert.deepEqual(made[1].sent[0], { id: 2, part: 'rays', doc: { x: 1 }, designSpeedKmh: 90, closed: false });
  const ray = { s: 5, u: null, reason: 'downforce-ray-gap', worst: 0.1, s0: 5, s1: 6 }, fold = { s0: 1, s1: 2, u: null, reason: 'fold', worst: null };
  answer(made[1], 'rays', { red: [ray] }, { loadMs: 40, waitedMs: 0, jobMs: 5000 }); answer(made[0], 'rest', { red: [fold], amber: 2 }, { loadMs: 30, waitedMs: 3, jobMs: 2000 });
  assert.deepEqual(await a.promise, { overlaps: [ray], others: [fold], amber: 2 }, 'the two answers put together'); assert.deepEqual(a.timing, { loadMs: 40, waitedMs: 3, jobMs: 5000, restMs: 2000, raysMs: 5000 });
  assert.deepEqual(made.map((w) => w.terminated), [0, 0], 'the workers are KEPT after a job');
  const b = runner.start({ doc: { y: 2 } }); assert.equal(made.length, 2, 'the next job reuses them'); assert.equal(made[0].sent.length, 2); assert.equal(made[0].sent[1].doc.y, 2);
  answer(made[0], 'rest', { red: [], amber: 0 }); answer(made[1], 'rays', { red: [] }); assert.deepEqual(await b.promise, { overlaps: [], others: [], amber: 0 }); assert.equal(b.timing, null, 'an answer with no timing leaves none');
  // a failed part: the job fails, the workers stay warm (the job was bad, not the worker)
  const c = runner.start({ doc: {} }); made[1].onmessage({ data: { id: 2, ok: false, error: 'boom' } }); await assert.rejects(c.promise, /boom/); assert.deepEqual(made.map((w) => w.terminated), [0, 0]); assert.equal(made.length, 2);
  assert.equal(made[0].onmessage, null, 'a late answer from the other part to a failed job has nowhere to go: its handler is gone');
  // a worker that errors (its script failed): both are replaced
  const d = runner.start({ doc: {} }); made[0].onerror({ message: 'script failed' }); await assert.rejects(d.promise, /script failed/); assert.deepEqual(made.slice(0, 2).map((w) => w.terminated), [1, 1]); assert.equal(made.length, 4, 'two fresh warm workers');
  // Cancel: terminates both at once, rejects as cancelled, makes two fresh warm ones; a late answer from a cancelled worker is ignored
  const e = runner.start({ doc: {} }); const [w0, w1] = made.slice(2, 4); assert.equal(w0.sent.length, 1); e.cancel(); assert.deepEqual([w0.terminated, w1.terminated], [1, 1]); assert.equal(made.length, 6); await assert.rejects(e.promise, (x) => x.cancelled === true);
  w0.onmessage && w0.onmessage({ data: { id: 1, ok: true, result: { red: [], amber: 0 } } }); e.cancel(); assert.equal(made.length, 6, 'cancel after the end does nothing');
  // a newer job while one runs cancels the older (the shell does it first; this is the guard)
  const f1 = runner.start({ doc: {} }), f2 = runner.start({ doc: {} }); await assert.rejects(f1.promise, (x) => x.cancelled === true); assert.equal(made.length, 8); f2.cancel(); await assert.rejects(f2.promise, (x) => x.cancelled === true);
  assert.throws(() => createWorkerRunner({ win: {} }), /no Web Worker/);
  class Blocked { constructor() { throw new Error('blocked'); } } assert.throws(() => createWorkerRunner({ win: {}, WorkerCtor: Blocked }), /blocked/);
});

test('row 3b: the check\'s TWO PARTS put together are EXACTLY the one-piece check (a coil with overlaps, a jump, a cup, a tube, a 13 km delete, a 14 km Close)', async () => {
  const parts = (doc, closed, speed = null) => mergeParts(clone(OJ.runJob({ doc, designSpeedKmh: speed, closed, part: 'rest' })), clone(OJ.runJob({ doc, designSpeedKmh: speed, closed, part: 'rays' })));
  const mk = () => createCoreShell({ brushFn: null, autosaveMs: 0 });
  const coil = await openLap({ turns: 8, lastLen: 60 }); coil.proposeClose(); const cp = coil.getState().closeProposal; assert.ok(cp.check.overlaps.length > 0);
  assert.deepEqual(parts(cp.doc, true), clone(cp.check), 'a coil\'s Close (overlaps of three kinds)'); assert.deepEqual(parts(cp.doc, true, 120), clone(OJ.overlapCheck(OJ.resolveDoc(cp.doc), 120, { closed: true })), 'with a design speed');
  coil.cancelClose(); coil.selectPiece(0); coil.deleteSelection(); const dp = coil.getState().deleteProposal; assert.deepEqual(parts(dp.doc, false), clone(dp.check), 'a coil\'s delete');
  const DEG = Math.PI / 180, j = await mk(); j.extend({ length: 200, family: 'bowl' }); j.extend({ length: 100, transition: 40, targets: { kh: 1 / 300 } }); j.commitDoc(D.appendPiece(j.getState().history.present, D.flightPiece({ gap: 25, drop: 1, land: -2 * DEG }))); j.extend({ length: 150 }); j.extend({ length: 150, transition: 40, targets: { kh: 1 / 200 } }); j.extend({ length: 100 });
  j.selectPiece(1); j.deleteSelection(); const jp = j.getState().deleteProposal; assert.ok(jp.check.others.length > 0, 'control: the jump track has a red that is not an overlap'); assert.deepEqual(parts(jp.doc, false), clone(jp.check), 'a track with a jump');
  const cup = await mk(); cup.extend({ length: 300, family: 'bowl', first: { c: 45 } }); for (let i = 0; i < 4; i++) cup.extend({ length: Q, transition: 40, targets: { kh: 1 / R, c: 45 } }); cup.extend({ length: 100, transition: 40, targets: { kh: 0, c: 45 } });
  cup.selectPiece(2); cup.deleteSelection(); assert.deepEqual(parts(cup.getState().deleteProposal.doc, false), clone(cup.getState().deleteProposal.check), 'a cup track');
  const tube = await mk(); tube.extend({ length: 300, first: { w: 40, t: 360 } }); for (let i = 0; i < 3; i++) tube.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); tube.extend({ length: 100, transition: 40, targets: { kh: 0 } });
  tube.selectPiece(1); tube.deleteSelection(); assert.deepEqual(parts(tube.getState().deleteProposal.doc, false), clone(tube.getState().deleteProposal.check), 'a tube track');
  const big = await mk(); big.extend({ length: 300, family: 'bowl' }); for (let i = 0; i < 45; i++) big.extend({ length: i % 3 === 2 ? 250 : 300, transition: 60, targets: { kh: (i % 2 ? -1 : 1) / 300 } });
  big.selectPiece(20); big.deleteSelection(); const bp = big.getState().deleteProposal; assert.deepEqual(parts(bp.doc, false), clone(bp.check), '13 km, 46 pieces');
  let d = extend(D.createDoc('big lap'), { length: 3000, family: 'bowl' }); for (let i = 0; i < 4; i++) { d = extend(d, { length: (Math.PI * 1000) / 2, transition: 60, targets: { kh: 1 / 1000 } }); d = extend(d, { length: i % 2 ? 3000 : 1000, transition: 60, targets: { kh: 0 } }); }
  const lap = await nearLap(null, D.checkDoc({ ...d, pieces: d.pieces.slice(0, -1), nextId: d.nextId })); lap.proposeClose({ last: true }); const lp = lap.getState().closeProposal; assert.ok(lp, lap.getState().message);
  assert.deepEqual(parts(lp.doc, true), clone(lp.check), '14 km lap\'s Close');
  assert.throws(() => OJ.runJob({ doc: cp.doc, part: 'nope' }), /no such part/);
});

test('row 4a: Close, with a runner: the preview is there at once, Apply is refused until the result lands (then works, the backup first); Cancel stops the check; a stale answer changes nothing', async () => {
  const run = fakeRunner(), s = await nearLap(run), base = s.getState().history.present, calls = [];
  s.backupNow = async (reason) => { calls.push(reason); return { file: 'x', reason }; };
  s.proposeClose({ last: true }); const p = s.getState().closeProposal;
  assert.ok(p, s.getState().message); assert.equal(p.check, null, 'no result yet'); assert.ok(p.displacement.length > 0 && p.resolved.segments.length > 0, 'the ghost and the displacement are there at once');
  assert.deepEqual(s.proposalCheck(p).status, 'checking'); assert.equal(run.jobs.length, 1); assert.equal(run.jobs[0].args.closed, true); assert.equal(run.jobs[0].args.doc, p.doc, 'the worker is sent the proposed document');
  assert.match(s.getState().message, /Checking for overlaps: Apply is off until that finishes \(Cancel stops it\)/);
  await s.applyClose(); assert.equal(s.getState().history.present, base, 'Apply before the result changes nothing'); assert.match(s.getState().message, /the overlap check of this preview has not finished/); assert.deepEqual(calls, [], 'and writes no backup');
  run.jobs[0].resolve(RED); await tick();
  assert.equal(s.proposalCheck(p).status, 'done'); assert.deepEqual(s.proposalCheck(p).result, RED); assert.equal(s.getState().closeProposal, p, 'the proposal object is the same, so the preview is not rebuilt');
  assert.match(s.getState().message, /the closed track OVERLAPS ITSELF in 1 place\. Apply or cancel$/);
  await s.applyClose(); assert.equal(s.getState().history.present.closed, true, s.getState().message); assert.deepEqual(calls, ['pre-close']); assert.equal(s.getState().proposalCheck, null);
  // Cancel stops the check; the late answer changes nothing
  const t = await nearLap(run); t.proposeClose({ last: true }); const job = run.jobs[run.jobs.length - 1], tp = t.getState().closeProposal;
  t.cancelClose(); assert.equal(job.cancelled, 1, 'Cancel terminates the worker'); assert.equal(t.getState().proposalCheck, null); assert.equal(t.getState().closeProposal, null);
  job.resolve(RED); await tick(); assert.equal(t.getState().proposalCheck, null, 'a stale answer is ignored'); assert.equal(t.proposalCheck(tp).status, 'none');
  // a failed check refuses Apply by name and says so
  const u = await nearLap(run); u.proposeClose({ last: true }); const uj = run.jobs[run.jobs.length - 1], up = u.getState().closeProposal; uj.reject(new Error('worker crashed')); await tick();
  assert.equal(u.proposalCheck(up).status, 'failed'); assert.match(u.getState().message, /the overlap check could not run: worker crashed\. Cancel the preview and try Close again/);
  await u.applyClose(); assert.equal(u.getState().history.present.closed, false); assert.match(u.getState().message, /has not finished/);
});

test('row 4b: the delete, with a runner: the same, and every way the preview can go (Cancel, an edit, an Undo, another selection, a newer preview) stops the running check', async () => {
  const run = fakeRunner(), st = { backups: [], async backupDoc(name, text) { st.backups.push(name); return 'f'; } }, s = await track(run, st), base = s.getState().history.present;
  s.selectPiece(1); s.deleteSelection(); const p = s.getState().deleteProposal;
  assert.ok(p && p.check === null && p.displacement.length > 0, s.getState().message); assert.equal(run.jobs[0].args.closed, false, 'the delete leaves an OPEN track'); assert.equal(run.jobs[0].args.doc, p.doc);
  assert.match(s.getState().message, /delete preview: 1 piece goes; 3 of the 3 pieces after the gap move\. Checking for overlaps/);
  await s.applyDelete(); assert.equal(s.getState().history.present, base); assert.match(s.getState().message, /has not finished/); assert.deepEqual(st.backups, []);
  run.jobs[0].resolve(CLEAR); await tick(); assert.equal(s.proposalCheck(p).status, 'done'); assert.match(s.getState().message, /delete preview: 1 piece goes; 3 of the 3 pieces after the gap move\. Apply or cancel$/);
  await s.applyDelete(); assert.equal(s.getState().history.present.pieces.length, 4, s.getState().message); assert.deepEqual(st.backups, ['eq-unsaved']);
  s.undo();
  for (const [name, drop] of [['Cancel', () => s.cancelDelete()], ['an edit', () => s.extend({ length: 20 })], ['an Undo', () => s.undo()], ['another selection', () => s.selectPiece(3)], ['Clear selection', () => s.clearSelection()]]) {
    if (name === 'an Undo') { s.extend({ length: 20 }); }
    s.selectPiece(1); s.deleteSelection(); const j = run.jobs[run.jobs.length - 1]; assert.equal(j.cancelled, 0, name + ': running');
    drop(); assert.equal(j.cancelled, 1, `${name} stops the check`); assert.equal(s.getState().proposalCheck, null); assert.equal(s.getState().deleteProposal, null);
    if (name === 'an Undo') s.redo();
  }
  s.selectPiece(1); s.deleteSelection(); const first = run.jobs[run.jobs.length - 1]; s.selectPiece(2); s.deleteSelection(); const second = run.jobs[run.jobs.length - 1];
  assert.equal(first.cancelled, 1, 'a newer preview stops the older check'); assert.equal(second.cancelled, 0); second.resolve(CLEAR); await tick(); assert.equal(s.proposalCheck(s.getState().deleteProposal).status, 'done');
  first.resolve(RED); await tick(); assert.deepEqual(s.getState().proposalCheck.result, CLEAR, 'the older answer did not replace the newer');
});

test('row 4c: a worker that cannot start falls back to the page AFTER the preview has painted, with the same answer; with no runner at all the check is made on the spot, as it always was', async () => {
  const s = await track(fakeRunner({ throwOnStart: true })); s.selectPiece(1); s.deleteSelection(); const p = s.getState().deleteProposal;
  assert.ok(p && p.check === null, 'the preview first'); assert.equal(s.proposalCheck(p).status, 'checking'); assert.equal(s.proposalCheck(p).via, 'page');
  await new Promise((r) => setTimeout(r, 50)); await tick();
  assert.equal(s.proposalCheck(p).status, 'done', s.getState().message); assert.deepEqual(clone(s.proposalCheck(p).result), clone(OJ.runJob({ doc: p.doc, designSpeedKmh: null, closed: false })));
  const sync = await track(null); sync.selectPiece(1); sync.deleteSelection(); const q = sync.getState().deleteProposal;
  assert.ok(q.check && Array.isArray(q.check.overlaps), 'no runner: the proposal carries its check'); assert.equal(sync.proposalCheck(q).status, 'done'); assert.equal(sync.getState().proposalCheck, null);
  assert.deepEqual(clone(q.check), clone(OJ.runJob({ doc: q.doc, designSpeedKmh: null, closed: false })));
});

// ── the panels, on a small fake DOM ──
class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.disabled = false; this.clientWidth = 0; this.clientHeight = 0; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.ownerDocument.ids[v] = this; }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return !!e.isRoot; }
  get offsetWidth() { return this.isConnected ? 9 * Math.max(...this.textContent.split('\n').map((l) => l.length)) + 16 : 0; }
  get offsetHeight() { return this.isConnected ? 20 * this.textContent.split('\n').length + 8 : 0; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
}
async function mountPanel(shell) {
  const doc = { ids: {}, listeners: {}, createElement: (t) => new El(t, doc) };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const timers = [];
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: (i) => { if (timers[i - 1]) timers[i - 1] = null; }, timers };
  doc.defaultView = win;
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 900; stage.clientHeight = 600; stage.isRoot = true;
  const root = doc.createElement('div'), panel = require('../core/panel.js').mount(root, shell);
  const button = (text) => root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === text), text = (aria) => (root.all().find((e) => e.attrs['aria-label'] === aria) || { textContent: null }).textContent;
  const fire = () => { const fs2 = timers.splice(0); for (const f of fs2) if (f) f(); };   // the panel's half-second redraw
  return { root, panel, button, text, fire, win };
}

test('row 5: the panels: "Checking for overlaps… N s", Apply disabled until the result lands, then the groups; Cancel stops the job (Close\'s box and the delete\'s box)', async () => {
  const run = fakeRunner(); let clock = 0;
  const s = await nearLap(run, null, { now: () => clock });
  const P1 = await mountPanel(s);
  // Close's box
  P1.button('Close the loop').onclick(); const cp = s.getState().closeProposal; assert.ok(cp, s.getState().message);
  assert.match(P1.text('overlap check'), /^Checking the closed track for overlaps… 0 s\. Apply is off until this finishes; Cancel stops it\.$/); assert.equal(P1.button('Apply').disabled, true);
  assert.match(P1.root.all().map((e) => e.textContent).join('|'), /Preview: only .* may move/, 'the preview\'s words are there while it checks');
  clock = 7400; P1.fire(); assert.match(P1.text('overlap check'), /Checking the closed track for overlaps… 7 s\./, 'the seconds count up');
  run.jobs[0].resolve(RED); await tick(); assert.equal(P1.button('Apply').disabled, false, 'Apply is on once the result is in'); assert.equal(P1.text('overlap check'), null); assert.match(P1.root.all().map((e) => e.textContent).join('|'), /The closed track OVERLAPS ITSELF \(1\):/);
  s.cancelClose(); assert.equal(P1.button('Apply').style.display, 'none');
  P1.button('Close the loop').onclick(); const cj = run.jobs[run.jobs.length - 1]; assert.equal(P1.button('Apply').disabled, true); P1.button('Cancel').onclick(); assert.equal(cj.cancelled, 1, 'Cancel in the panel stops the job');
  // the delete's box
  const t = await track(run), P2 = await mountPanel(t); t.selectPiece(1); P2.button('Delete selected').onclick(); const dj = run.jobs[run.jobs.length - 1];
  assert.match(P2.text('overlap check'), /^Checking the track for overlaps… 0 s\. Apply is off until this finishes; Cancel stops it\.$/); assert.equal(P2.button('Apply delete').disabled, true);
  dj.reject(new Error('worker crashed')); await tick(); assert.match(P2.text('overlap check'), /^The overlap check could not run: worker crashed\. Cancel and delete again\.$/); assert.equal(P2.button('Apply delete').disabled, true, 'a failed check keeps Apply off');
  P2.button('Cancel delete').onclick(); t.selectPiece(1); P2.button('Delete selected').onclick(); const dj2 = run.jobs[run.jobs.length - 1]; dj2.resolve(CLEAR); await tick();
  assert.equal(P2.text('overlap check'), 'No overlap and no red on the track after the delete.'); assert.equal(P2.button('Apply delete').disabled, false);
  P2.button('Cancel delete').onclick(); assert.equal(dj2.cancelled, 0, 'a finished job is not cancelled again');
});

function headlessPreview(s) {
  let q = [], now = 0;
  const win = { devicePixelRatio: 1, document: { hidden: false, activeElement: null, body: {}, addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (fn) => { q.push(fn); return q.length; }, cancelAnimationFrame() {}, setTimeout: () => 0, clearTimeout() {} };
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0 }, { get: (t, k) => (k in t ? t[k] : () => 0) });
  const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  const pv = P.createPreview({ canvas, shell: s, win });
  pv.step = () => { const f = q; q = []; now += 16; for (const g of f) g(now); };
  return pv;
}
test('row 6: the ghost is on the preview WHILE the check runs, and it is not rebuilt when the answer lands', async () => {
  const run = fakeRunner(), s = await track(run), pv = headlessPreview(s);
  assert.equal(pv.view().ghost, 0); s.selectPiece(1); s.deleteSelection(); const p = s.getState().deleteProposal;
  assert.ok(pv.view().ghost > 0, 'the ghost is drawn at once, with the check still running'); assert.equal(s.proposalCheck(p).status, 'checking');
  const ghost = pv.view().ghost; run.jobs[0].resolve(CLEAR); await tick();
  assert.equal(s.proposalCheck(p).status, 'done'); assert.equal(s.getState().deleteProposal, p, 'the same proposal object: the preview keys on it, so it did not rebuild'); assert.equal(pv.view().ghost, ghost);
  s.cancelDelete(); assert.equal(pv.view().ghost, 0, 'Cancel drops the ghost');
  const c = await nearLap(run), pc = headlessPreview(c); c.proposeClose({ last: true }); assert.ok(pc.view().ghost > 0, 'Close\'s ghost too, while its check runs'); assert.equal(c.proposalCheck(c.getState().closeProposal).status, 'checking');
  pc.dispose(); pv.dispose();
});
