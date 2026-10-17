// validate-ui-worker.test.js: node --test app/test/validate-ui-worker.test.js
// The track checker OFF the window's thread (the keeper, 2026-10-14: placing a piece on ELYSIUM froze the window; "option 2"). The worker runs
// app/validate-ui/checkjob.js; the page talks to it through checkrunner.js; the panel (index.js) shows its answers. Rows:
//   1  the job's answer equals the page's own controller after every kind of edit (place, undo, redo, a hill brush, a drag held open, the CSP
//      switch), from a fresh COPY of the document each time, as a worker receives it
//   2  the runner shows answers in order: an older answer after a newer one is dropped; pending() says whether the newest has come back;
//      a failed check and a worker error reach onFail; a page without Worker throws (the panel then checks on the page)
//   3  the worker script checks only the NEWEST of the documents that arrive while it is busy, and keeps one job between messages
//   4  the panel with a worker: "checking…" until the answer, then the verdict; a document the worker cannot take falls back to the page
//   5  (D350) the reds the panel hands Close: a finished answer's, for the document it checked, and none from an answer made in a drag or with a check put off
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const { createValidationController } = require('../validate-ui/panel.js');
const { graphModel } = require('../validate-ui/graph.js');
const { createCheckJob } = require('../validate-ui/checkjob.js');
const { createCheckRunner } = require('../validate-ui/checkrunner.js');

const R = 180, Q = (Math.PI * R) / 2;
async function track() {
  const s = await createCoreShell({});
  s.extend({ length: 200, family: 'bowl' }); s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 300, first: { c: 30 } });
  return s;
}
/** What the panel shows, from the page's own controller (index.js render reads exactly these). */
const shown = (st) => { const r = st.result; return { error: st.error, pathFrom: st.pathFrom, arcs: st.arcs, graph: graphModel(st), roadM: st.path ? st.path.lengthM : null,
  result: r ? { red: r.red, amber: r.amber, info: r.info, lap: r.lap, jumps: r.jumps, pendingFrom: r.pendingFrom == null ? null : r.pendingFrom } : null }; };
const fromJob = (o) => { const { how, ...rest } = o; return rest; };

test('row 1: the job\'s answer equals the page controller\'s after a place, an undo, a redo, a hill brush, a brush stroke held open and the CSP switch', async () => {
  const s = await track(), model = createTrackModel(); let t = model.update(s.getState().resolved);
  s.subscribe((st) => { t = model.update(st.resolved); });
  const page = createValidationController(s, { sharedPath: () => t }), job = createCheckJob();
  let csp = true;
  const check = (what) => {
    const st = s.getState(), out = structuredClone(job.run({ doc: structuredClone(st.history.present), dragging: !!st.history.dragBase, csp }));
    assert.deepStrictEqual(fromJob(out), structuredClone(shown(page.state)), what);
    return out;
  };
  check('built');
  s.extend({ length: 150, targets: { kh: -1 / 250 } }); assert.equal(check('placed').how, 'append');
  s.undo(); assert.equal(check('undone').how, 'trim'); s.redo(); check('redone');
  s.beginBrush({ channel: 'height', s0: 150, r: 60 }); s.brushTo(3); s.endBrush(); assert.equal(s.getState().message, null); check('a hill brushed');
  s.beginBrush({ mode: 'rate', channel: 'kh', s0: 300, r: 60 }); s.brushTo(0.0004);
  assert.ok(s.getState().history.dragBase, 'a stroke is open'); check('a brush stroke held open (the drag window)'); s.endBrush(); check('the stroke ended');
  csp = false; page.setCsp(false); check('the CSP switch off');
});

/** A Worker stand-in: records what is posted; the test answers by hand. */
class Recorder { constructor(url) { this.url = url; this.posted = []; Recorder.last = this; } postMessage(m) { this.posted.push(m); } terminate() { this.dead = true; } }

test('row 2: the runner drops an answer older than the one shown, says what is pending, and passes on failures', () => {
  assert.throws(() => createCheckRunner({}), /no Web Worker/);
  const got = [], fails = [];
  const r = createCheckRunner({ WorkerCtor: Recorder, onAnswer: (out, info) => got.push([out.n, info.serial, info.pending]), onFail: (m) => fails.push(m) }), w = Recorder.last;
  assert.equal(w.url, 'validate-ui/checkworker.js');
  r.send({ doc: { pieces: [] } }); r.send({ doc: { pieces: [] }, dragging: 1, csp: 0 });
  assert.deepStrictEqual(w.posted.map((m) => [m.serial, m.dragging, m.csp]), [[1, false, true], [2, true, false]]);
  assert.equal(r.pending(), true);
  w.onmessage({ data: { serial: 2, ok: true, out: { n: 'second' } } });
  w.onmessage({ data: { serial: 1, ok: true, out: { n: 'first, late' } } });
  assert.deepStrictEqual(got, [['second', 2, false]], 'the late, older answer is dropped');
  assert.equal(r.pending(), false);
  r.send({ doc: { pieces: [] } }); w.onmessage({ data: { serial: 3, ok: false, error: 'boom' } });
  w.onerror({ message: 'worker died' });
  assert.deepStrictEqual(fails, ['boom', 'worker died']);
  r.dispose(); assert.equal(w.dead, true);
});

test('row 3: the worker script checks only the newest document of those that arrive while it is busy, with one job throughout', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate-ui', 'checkworker.js'), 'utf8'), posted = [], made = [];
  const job = { run: (m) => ({ ran: m.serial }) };
  const self = { location: { href: 'http://x/app/validate-ui/checkworker.js' }, postMessage: (m) => posted.push(m) };
  const ctx = vm.createContext({ self, importScripts: () => {}, performance, setTimeout, URL, Promise,
    loadCjs: async (p) => (p.endsWith('node-shim.js') ? { createShim: () => ({ builtins: {}, Buffer }) } : { createCheckJob: () => { made.push(1); return job; } }) });
  vm.runInContext(src, ctx);
  const send = (serial) => self.onmessage({ data: { serial } });
  send(1); send(2); send(3);   // all three before the module has even loaded
  await new Promise((r) => setTimeout(r, 30));
  assert.deepStrictEqual(posted.map((m) => m.out.ran), [3], 'only the newest is checked');
  send(4); await new Promise((r) => setTimeout(r, 0)); send(5); send(6);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepStrictEqual(posted.map((m) => m.out.ran), [3, 4, 6], 'one check per burst: the first, then the newest');
  assert.equal(made.length, 1, 'one job, kept between messages (that is what keeps a check incremental)');
});

test('row 4: the panel with a worker says "checking…" until the answer comes, then the verdict; a document the worker cannot take is checked on the page', async () => {
  const fake = require('./palette-fakedom.js'), restore = fake.install(), had = { CustomEvent: global.CustomEvent, raf: global.requestAnimationFrame, Worker: global.Worker };
  const make = global.document.createElement; global.document.createElement = (t) => { const e = make(t); let st = {}; Object.defineProperty(e, 'style', { get: () => st, set: (v) => { st = typeof v === 'string' ? { cssText: v } : v; } });
    if (t === 'canvas') e.getContext = () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}) });
    return e; };
  global.document.dispatchEvent = () => true; global.CustomEvent = class { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } };
  const frames = []; global.requestAnimationFrame = (f) => { frames.push(f); return frames.length; };
  const flushFrames = () => { while (frames.length) frames.shift()(0); };
  let refuse = false;
  global.Worker = class { constructor() { this.job = createCheckJob(); this.queue = []; }
    postMessage(m) { if (refuse) throw Object.assign(new Error('could not be cloned'), { name: 'DataCloneError' }); this.queue.push(structuredClone(m)); }
    answer() { const m = this.queue.pop(); this.queue = []; if (m) this.onmessage({ data: { serial: m.serial, ok: true, out: structuredClone(this.job.run(m)), ms: 0 } }); }
    terminate() {} };
  try {
    const s = await track(), root = new fake.Element('div'); root.dispatchEvent = () => true;
    const W = global.Worker, made = []; global.Worker = class extends W { constructor(...a) { super(...a); made.push(this); } };
    const { mount } = require('../validate-ui/index.js'), m = mount(root, s), head = () => root.querySelector('.v-summary').textContent;
    assert.equal(made.length, 1); assert.equal(head(), 'checking…');
    made[0].answer(); assert.match(head(), /^\d+ red · \d+ amber/); assert.ok(!/checking/.test(head()));
    s.extend({ length: 120 }); flushFrames(); assert.match(head(), /checking…$/, 'the last verdict, marked as being re-checked');
    made[0].answer(); assert.ok(!/checking/.test(head()));
    const page = createValidationController(s);
    assert.ok(head().startsWith(`${page.state.result.red.length} red · ${page.state.result.amber.length} amber`), `${head()}: the page's own count`);
    refuse = true; s.extend({ length: 80 }); flushFrames();
    assert.ok(!/checking/.test(head()), 'checked on the page at once');
    const now = createValidationController(s);
    assert.ok(head().startsWith(`${now.state.result.red.length} red`), head());
    m.dispose();
  } finally { restore(); global.CustomEvent = had.CustomEvent; global.requestAnimationFrame = had.raf; global.Worker = had.Worker; }
});
test('row 5: a Close press is handed the reds of a finished answer for the document it checked, and none from a drag, a check put off, or an older document', async () => {
  // through the real panel, a stand-in worker that runs the real job, and a real shell with a close runner that records each press's arguments. An answer's
  // drag and put-off check are made separately (each alone), so each condition of the filter is seen on its own
  const fake = require('./palette-fakedom.js'), restore = fake.install(), had = { CustomEvent: global.CustomEvent, raf: global.requestAnimationFrame, Worker: global.Worker };
  const make = global.document.createElement; global.document.createElement = (t) => { const e = make(t); let st = {}; Object.defineProperty(e, 'style', { get: () => st, set: (v) => { st = typeof v === 'string' ? { cssText: v } : v; } });
    if (t === 'canvas') e.getContext = () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}) });
    return e; };
  global.document.dispatchEvent = () => true; global.CustomEvent = class { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } };
  const frames = []; global.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  const flushFrames = () => { while (frames.length) frames.shift()(0); };
  let worker = null;
  global.Worker = class { constructor() { this.job = createCheckJob(); this.queue = []; worker = this; }
    postMessage(m) { this.queue.push(structuredClone(m)); }
    /** answers the newest message posted, with `tweak` applied to the job's answer; returns that answer */
    answer(tweak = (o) => o) { const m = this.queue.pop(); this.queue = []; const out = tweak(structuredClone(this.job.run(m))); this.onmessage({ data: { serial: m.serial, ok: true, out, ms: 0 } }); return out; }
    terminate() {} };
  const presses = [], closeRunner = { start(args) { presses.push(args); return { promise: new Promise(() => {}), cancel() {} }; } };
  const handed = () => { s.closeBest(); s.cancelClose(); return presses[presses.length - 1].openReds; };
  const asGiven = (out) => out.result.red.map((x) => ({ reason: x.reason, s: x.s ?? x.s0 ?? 0 }));
  let s;
  try {
    s = await createCoreShell({ closeRunner });
    s.extend({ length: 200, family: 'bowl' }); s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 300, first: { c: 30 } });
    const root = new fake.Element('div'); root.dispatchEvent = () => true;
    const { mount } = require('../validate-ui/index.js'), m = mount(root, s);
    assert.ok(worker, 'the panel made its worker');
    const done = worker.answer();
    assert.deepEqual(handed(), asGiven(done), 'a finished answer for the track as it is: its reds, as { reason, s }');
    s.extend({ length: 120 }); flushFrames();
    worker.answer((o) => ({ ...o, result: { ...o.result, pendingFrom: 150 } }));
    assert.equal(handed(), null, 'an answer with a check put off is not the open track\'s reds');
    s.extend({ length: 80 }); flushFrames();
    s.extend({ length: 60 });   // the track changes before the answer for the one sent comes back (the next send waits for a frame)
    worker.answer();
    assert.equal(handed(), null, 'an answer for the document it checked, not for the one the track is now');
    flushFrames(); worker.answer();
    s.beginBrush({ mode: 'rate', channel: 'kh', s0: 300, r: 60 }); s.brushTo(0.0004); assert.ok(s.getState().history.dragBase, 'a stroke is open'); flushFrames();
    worker.answer((o) => ({ ...o, result: { ...o.result, pendingFrom: null } }));
    assert.equal(handed(), null, 'an answer made during a drag is not the open track\'s reds');
    s.endBrush();
    m.dispose();
  } finally { restore(); global.CustomEvent = had.CustomEvent; global.requestAnimationFrame = had.raf; global.Worker = had.Worker; }
});
