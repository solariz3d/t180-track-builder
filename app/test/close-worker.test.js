// close-worker.test.js: node --test app/test/close-worker.test.js
// 2026-10-15, CLOSE OFF THE WINDOW'S THREAD: Close's "new road from the end to the start" held the window 4.1 s on a 24 km track (the preview's road and how far
// each piece moved were worked out on the page). The work is one pure job (app/core/closejob.js), run in a Web Worker (app/core/closeworker.js) through
// app/core/closerunner.js, as the track checker went in 7512f84. Rows:
//   1  THE PREVIEW IS IDENTICAL: through the worker (every message structured-cloned, as a postMessage does) the proposal is the page's, for finish, the last
//      ~20%, the last piece and the whole lap; and Finish to start still leaves the user's pieces as the very same objects
//   2  a close the core refuses says the same words through the worker as on the page, and makes no preview
//   3  the shell while the worker works: the call returns at once with the close pending and no preview; an edit meanwhile drops the answer by name;
//      Cancel and a newer Close cancel the job; a runner that cannot start, or a job that fails, closes on the page instead
//   4  the runner: one warm worker made with it; a reply that is not the current job's is ignored; a refusal resolves; cancel and a failure make a fresh worker;
//      a page without Worker throws
//   5  the worker SCRIPT, in a sandbox with the real files: it loads closejob.js through the app's loader and answers as runClose does; a refusal and a bad
//      job are answered, never a hang
//   6  the panel while the worker works: it says what is being done and that Cancel stops it; Cancel stops the job; the preview replaces the line
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCoreShell } = require('../core/coreshell.js');
const { createCloseRunner } = require('../core/closerunner.js');
const CJ = require('../core/closejob.js');
const D = require('../../src/core/document.js');
const C = require('../../src/core/close.js');

const R = 180, Q = (Math.PI * R) / 2;
const clone = (x) => structuredClone(x);
const tick = () => new Promise((r) => setImmediate(r));

/** A Worker stand-in that does what closeworker.js does, in this process: every message in and out is structured-cloned, and it answers on a later tick. */
class CloneWorker {
  constructor(url) { this.url = url; this.sent = 0; this.dead = false; }
  postMessage(msg) {
    const m = clone(msg); this.sent++;
    setImmediate(() => {
      if (this.dead || !this.onmessage) return;
      let a; try { a = { serial: m.serial, ok: true, out: CJ.runClose(m), ms: 0 }; } catch (e) { a = e.name === 'CoreError' ? { serial: m.serial, ok: false, refused: { code: e.code, message: e.message } } : { serial: m.serial, ok: false, error: e.message }; }
      this.onmessage({ data: clone(a) });
    });
  }
  terminate() { this.dead = true; }
}
const workerRunner = () => createCloseRunner({ win: {}, WorkerCtor: CloneWorker });

async function openLap({ turns = 4, lastLen = 200, closeRunner = null } = {}) {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0, closeRunner });
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < turns; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: lastLen, transition: Math.min(40, lastLen), targets: { kh: 0 } });
  assert.equal(s.getState().message, null, s.getState().message); return s;
}
/** A NEAR lap, 8.87 m from closing (B's, core-close-preview.test.js). */
async function nearLap(closeRunner = null) {
  const far = (await openLap()).getState().history.present;
  const open = D.checkDoc({ ...C.close(far, { edited: [0] }).doc, closed: false });
  const near = D.checkDoc({ ...open, pieces: open.pieces.map((p, k) => (k === 2 ? { ...p, channels: { ...p.channels, kh: p.channels.kh.map((v, i, a) => (i >= 3 && i <= a.length - 4 ? v + 1e-4 : v)) } } : p)) });
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0, closeRunner }); s.adopt(near); return s;
}
const settled = async (s) => { for (let i = 0; i < 200 && s.getState().closePending; i++) await tick(); assert.equal(s.getState().closePending, null, 'the close came back'); };
const shown = (s) => { const st = s.getState(), p = st.closeProposal; return { message: st.message, proposal: p ? { doc: p.doc, report: p.report, window: p.window, whole: p.whole, displacement: p.displacement, check: p.check } : null }; };

test('row 1: through the worker the preview is the page\'s, for finish, the last ~20%, the last piece and the whole lap; Finish keeps the user\'s pieces as the very same objects', async () => {
  for (const [make, opts] of [[openLap, { finish: true }], [nearLap, {}], [nearLap, { last: true }], [nearLap, { whole: true }]]) {
    const page = await make(), off = await (make === openLap ? openLap({ closeRunner: workerRunner() }) : nearLap(workerRunner()));
    assert.deepStrictEqual(off.getState().history.present, page.getState().history.present, 'the same open track');
    page.proposeClose(opts); off.proposeClose(opts); await settled(off);
    const a = shown(page), b = shown(off), what = JSON.stringify(opts);
    assert.ok(a.proposal, `${what}: the page makes a preview: ${a.message}`);
    assert.deepStrictEqual(b, a, `${what}: the worker's preview and message are the page's`);
    assert.ok(Object.isFrozen(b.proposal.doc) && b.proposal.doc.pieces.every(Object.isFrozen), `${what}: the document is frozen, as the core's are`);
    if (opts.finish) { const base = off.getState().history.present; base.pieces.forEach((P, i) => assert.equal(b.proposal.doc.pieces[i], P, `piece ${i} is the user's own, the very object`)); }
    await off.applyClose(); assert.equal(off.getState().history.present.closed, true, `${what}: Apply closes the loop`);
  }
});

test('row 2: a close the core refuses says the same words through the worker as on the page, and makes no preview', async () => {
  const page = await openLap({ lastLen: 30 }), off = await openLap({ lastLen: 30, closeRunner: workerRunner() });
  page.proposeClose({ last: true }); off.proposeClose({ last: true }); await settled(off);
  assert.equal(off.getState().closeProposal || null, null); assert.match(off.getState().message, /can't close using only the last 30 m/i);
  assert.equal(off.getState().message, page.getState().message); assert.equal(off.getState().messageKind, page.getState().messageKind);
});

/** A runner whose jobs the test settles by hand. */
function handRunner({ throwOnStart = false } = {}) {
  const r = { jobs: [], start(args) {
    if (throwOnStart) throw new Error('no worker here');
    let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
    const job = { args, promise, cancelled: 0, resolve, reject, cancel() { job.cancelled++; reject(Object.assign(new Error('cancelled'), { cancelled: true })); } };
    r.jobs.push(job); return job;
  } };
  return r;
}
const answerOf = (doc, opts) => ({ out: clone(CJ.runClose({ doc: clone(doc), ...opts })), ms: 1 });

test('row 3: while the worker works the close is pending with no preview; an edit drops the answer by name; Cancel and a newer Close cancel it; no runner or a failed job closes on the page', async () => {
  const r = handRunner(), s = await openLap({ closeRunner: r }), base = s.getState().history.present;
  s.proposeClose({ finish: true });
  let st = s.getState();
  assert.equal(r.jobs.length, 1); assert.equal(st.closeProposal || null, null, 'no preview yet'); assert.ok(st.closePending && st.closePending.base === base, 'the close is pending, for this track');
  assert.deepStrictEqual(r.jobs[0].args, { doc: base, fraction: 0.2, last: false, whole: false, finish: true, edited: null });
  s.extend({ length: 50 }); const edited = s.getState().history.present;
  r.jobs[0].resolve(answerOf(base, { finish: true })); await tick(); await tick();
  st = s.getState(); assert.equal(st.closeProposal || null, null, 'a stale answer makes no preview'); assert.equal(st.history.present, edited, 'and changes nothing');
  assert.equal(st.closePending, null); assert.match(st.message, /track changed while the close was being worked out/);
  s.proposeClose({ finish: true }); s.cancelClose(); assert.equal(r.jobs[1].cancelled, 1, 'Cancel stops the job'); assert.equal(s.getState().closePending, null);
  s.proposeClose({ last: true }); s.proposeClose({ finish: true }); assert.equal(r.jobs[2].cancelled, 1, 'a newer Close cancels the older');
  r.jobs[3].resolve(answerOf(edited, { finish: true })); await tick(); await tick(); assert.ok(s.getState().closeProposal, s.getState().message);
  assert.equal(s.getState().closeProposal.base, edited);
  // the whole-lap close is told what to go round (the stretch edited last and the user's straights, D186 C): the worker cannot work it out itself
  s.cancelClose(); s.proposeClose({ whole: true }); const sent = r.jobs[4].args.edited;
  assert.ok(Array.isArray(sent) && sent.includes(edited.pieces.length - 1) && sent.includes(0), `the whole-lap close goes round the last piece and the opening straight: ${JSON.stringify(sent)}`);
  s.cancelClose();
  for (const runner of [handRunner({ throwOnStart: true }), null]) {
    const u = await openLap({ closeRunner: runner }); u.proposeClose({ finish: true });
    assert.ok(u.getState().closeProposal, 'no worker: the preview is made on the page, at once'); assert.equal(u.getState().closePending || null, null);
  }
  const f = handRunner(), v = await openLap({ closeRunner: f }); v.proposeClose({ finish: true });
  f.jobs[0].reject(new Error('worker died')); await tick(); await tick();
  assert.ok(v.getState().closeProposal, `a failed job closes on the page: ${v.getState().message}`); assert.equal(v.getState().closePending, null);
});

test('row 4: the runner: one warm worker; a reply that is not the current job\'s is ignored; a refusal resolves; cancel and a failure make a fresh worker; no Worker throws', async () => {
  assert.throws(() => createCloseRunner({ win: {} }), /no Web Worker/);
  const made = [];
  class FakeWorker { constructor(url) { this.url = url; this.sent = []; this.terminated = 0; made.push(this); } postMessage(m) { this.sent.push(m); } terminate() { this.terminated++; } }
  const runner = createCloseRunner({ win: {}, WorkerCtor: FakeWorker });
  assert.equal(made.length, 1, 'the worker exists before any job: it is warm'); assert.equal(made[0].url, 'core/closeworker.js');
  const a = runner.start({ doc: { x: 1 }, finish: true }); assert.equal(made.length, 1, 'a job makes no worker');
  assert.deepStrictEqual(made[0].sent[0], { serial: 1, doc: { x: 1 }, fraction: 0.2, last: false, whole: false, finish: true, edited: null });
  made[0].onmessage({ data: { serial: 99, ok: true, out: 'not mine' } });
  made[0].onmessage({ data: { serial: 1, ok: true, out: { n: 1 }, ms: 7 } });
  assert.deepStrictEqual(await a.promise, { out: { n: 1 }, ms: 7 }, 'the current job\'s answer, never another\'s');
  const b = runner.start({ doc: {} }); made[0].onmessage({ data: { serial: 2, ok: false, refused: { code: 'CLOSE_WINDOW', message: 'no' } } });
  assert.deepStrictEqual(await b.promise, { refused: { code: 'CLOSE_WINDOW', message: 'no' } }); assert.equal(made.length, 1, 'a refusal keeps the worker');
  const c = runner.start({ doc: {} }); c.cancel();
  await assert.rejects(c.promise, (e) => e.cancelled === true); assert.equal(made[0].terminated, 1); assert.equal(made.length, 2, 'cancel makes a fresh worker');
  const d = runner.start({ doc: {} }); assert.equal(made[1].sent.length, 1, 'the next job goes to the fresh one');
  made[1].onmessage({ data: { serial: 4, ok: false, error: 'boom' } }); await assert.rejects(d.promise, /boom/); assert.equal(made.length, 3, 'a failure makes a fresh worker');
  const e = runner.start({ doc: {} }); made[2].onerror({ message: 'died' }); await assert.rejects(e.promise, /died/); assert.equal(made.length, 4);
  const g = runner.start({ doc: {} }), h = runner.start({ doc: {} });
  await assert.rejects(g.promise, (x) => x.cancelled === true, 'a second start cancels the first');
  made[4].onmessage({ data: { serial: 7, ok: true, out: 'h', ms: 0 } }); assert.deepStrictEqual(await h.promise, { out: 'h', ms: 0 });
});

test('row 5: the worker SCRIPT loads closejob.js through the app\'s loader and answers as runClose does; a refusal and a bad job are answered', async () => {
  const dir = path.join(__dirname, '..', 'core'), ROOT = path.resolve(__dirname, '..', '..'), posted = [];
  const ctx = { URL, console, Buffer, structuredClone, setTimeout, clearTimeout, TextEncoder, TextDecoder, performance, location: { href: 'http://localhost/app/core/closeworker.js' } };
  ctx.self = ctx; ctx.postMessage = (m) => posted.push(clone(m));
  ctx.importScripts = (u) => vm.runInContext(fs.readFileSync(path.resolve(dir, u), 'utf8'), ctx, { filename: u });
  ctx.fetch = async (url) => { const rel = decodeURIComponent(new URL(String(url)).pathname).replace(/^\//, ''), f = path.join(ROOT, rel); return fs.existsSync(f) ? { ok: true, status: 200, text: async () => fs.readFileSync(f, 'utf8') } : { ok: false, status: 404, text: async () => '' }; };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(dir, 'closeworker.js'), 'utf8'), ctx, { filename: 'closeworker.js' });
  assert.equal(typeof ctx.onmessage, 'function', 'the worker listens for a message');
  const doc = (await openLap()).getState().history.present;
  await ctx.onmessage({ data: { serial: 3, doc: clone(doc), finish: true } });
  assert.equal(posted.length, 1); assert.equal(posted[0].serial, 3); assert.equal(posted[0].ok, true, posted[0].error);
  assert.deepStrictEqual(posted[0].out, clone(CJ.runClose({ doc, finish: true })), 'the worker answers as runClose does'); assert.ok(Number.isFinite(posted[0].ms));
  const short = (await openLap({ lastLen: 30 })).getState().history.present;
  let want; try { CJ.runClose({ doc: short, last: true }); } catch (e) { want = e; }
  await ctx.onmessage({ data: { serial: 4, doc: clone(short), last: true } });
  if (want) assert.deepStrictEqual(posted[1], { serial: 4, ok: false, refused: { code: want.code, message: want.message } }, 'a refusal carries the core\'s words');
  else assert.equal(posted[1].ok, true, 'the core answered (not converged) rather than refusing');
  await ctx.onmessage({ data: { serial: 5, doc: { not: 'a document' }, finish: true } });
  assert.equal(posted[2].serial, 5); assert.equal(posted[2].ok, false); assert.ok(typeof posted[2].error === 'string' || posted[2].refused, 'a bad job is answered, never a hang');
});

// the fake DOM the panel is mounted on (as app/test/preview-async.test.js mounts it)
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

test('row 6: the panel while the worker works: it says what is being done and that Cancel stops it, Cancel stops the job, and the preview replaces the line when it lands', async () => {
  const r = handRunner(), s = await openLap({ closeRunner: r }), P = await mountPanel(s), base = s.getState().history.present;
  P.root.all().find((e) => e.attrs['aria-label'] === 'close using').value = '0.2';   // D331: the box now starts on the finish (row 7); this first press is the windowed close, so it chooses it
  P.button('Close the loop').onclick(); P.fire();
  assert.equal(r.jobs.length, 1, 'the panel asked for the close');
  assert.equal(P.text('close working'), 'Closing the loop… The window stays free; Cancel stops it.');
  assert.equal(P.button('Cancel').style.display, '', 'Cancel is offered while it works'); assert.equal(P.button('Apply').style.display, 'none', 'Apply is not');
  assert.equal(P.button('Apply').disabled, true, 'and Apply is off: there is nothing to apply yet (the after run of closefreeze.js clicked a hidden, enabled Apply)');
  P.button('Cancel').onclick(); assert.equal(r.jobs[0].cancelled, 1, 'Cancel in the panel stops the job'); assert.equal(P.text('close working'), null);
  P.root.all().find((e) => e.attrs['aria-label'] === 'close using').value = 'finish';
  P.button('Close the loop').onclick(); P.fire();
  assert.equal(P.text('close working'), 'Finishing to the start: laying new road and closing it… The window stays free; Cancel stops it.');
  r.jobs[1].resolve(answerOf(base, { finish: true })); await tick(); await tick();
  assert.equal(P.text('close working'), null); assert.match(P.root.all().map((e) => e.textContent).join('|'), /Preview: only the new road .* may move/);
  assert.equal(P.button('Apply').style.display, '');
});

// D331 (ELYSIUM's newest save): "close using" started on "the last ~20%", which refuses on a long track (the road would roll too fast over that much of it), so a first press of "Close the loop"
// gave a refusal; it now starts on "new road from the end to the start" (moves nothing already built), and the other four are one click away.
test('row 7: "close using" starts on "new road from the end to the start": a first press asks for the finish, and the other options are still there', async () => {
  const r = handRunner(), s = await openLap({ closeRunner: r }), P = await mountPanel(s), how = P.root.all().find((e) => e.attrs['aria-label'] === 'close using');
  assert.equal(how.value, 'finish', 'the box starts on the finish');
  const values = how.children.map((e) => e.value);
  assert.deepEqual(values.slice().sort(), ['0.2', '0.4', 'finish', 'last', 'whole'], 'every option is still one click away');
  P.button('Close the loop').onclick(); P.fire();
  assert.equal(r.jobs.length, 1); assert.equal(r.jobs[0].args.finish, true, 'a first press, with the box untouched, asks for the finish');
  assert.equal(P.text('close working'), 'Finishing to the start: laying new road and closing it… The window stays free; Cancel stops it.');
});

// the preview must say when the lap fails (it said "No overlap and no red on the closed track" for a close whose lap the checker then failed). A real close whose lap fails: the whole-lap
// close of this banked track (a synthetic one: a straight, a right turn of 120 degrees, a straight, the road banked 54 degrees) leaves the car off the road at the start
test('row 8: the Close preview says when the lap fails, and where, for any option, and is not "No overlap and no red" then; a lap that holds still says that', async () => {
  const DEG = Math.PI / 180, { extend } = require('../../src/core/extend.js'), { extendTurnBy } = require('../../src/core/turnby.js');
  const banked = (turn) => { let d = D.createDoc('banked'); d = extend(d, { length: 400 }); d = extendTurnBy(d, { length: 500 }, turn * DEG); d = extend(d, { length: 200 }); d = extend(d, { length: 200, transition: 100, targets: { phi: 54 * DEG } }); return extend(d, { length: 100, targets: { kv: 0 } }); };
  const run = async (doc, how) => {
    const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.adopt(doc); const P = await mountPanel(s);
    P.root.all().find((e) => e.attrs['aria-label'] === 'close using').value = how; P.button('Close the loop').onclick(); P.fire();
    return { s, P, text: P.root.all().map((e) => e.textContent).join('|') };
  };
  const failing = await run(banked(-120), 'whole');
  assert.ok(failing.s.getState().closeProposal, failing.s.getState().message);
  assert.match(failing.text, /The lap fails: the car leaves the road at [0-9]+[.][0-9][0-9] km/, 'the preview names the failing lap and where');
  assert.doesNotMatch(failing.text, /No overlap and no red on the closed track/, 'and does not call it clean');
  assert.equal(failing.P.button('Apply').disabled, false, 'Apply is still the user\'s to press');
  // the keeper's case exactly: no overlap and no red in the preview, and the lap fails (the check's answer is stood in for, so the panel's own words are what is under test)
  { const s2 = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s2.adopt(banked(120)); const real = s2.proposalCheck.bind(s2);
    s2.proposalCheck = (p) => ({ ...real(p), status: 'done', result: { overlaps: [], others: [], amber: 0, lap: { ok: false, reason: null, first: { s: 23932.6, reason: 'leaves-surface' }, count: 12 } } });
    const P2 = await mountPanel(s2); P2.root.all().find((e) => e.attrs['aria-label'] === 'close using').value = 'finish'; P2.button('Close the loop').onclick(); P2.fire();
    const t2 = P2.root.all().map((e) => e.textContent).join('|');
    assert.match(t2, /The lap fails: the car leaves the road at 23[.]93 km [(]12 places along the lap[)]/); assert.doesNotMatch(t2, /No overlap and no red on the closed track/, 'no red and no overlap is not "clean" when the lap fails'); }
  const holding = await run(banked(120), 'finish');
  assert.ok(holding.s.getState().closeProposal, holding.s.getState().message);
  assert.doesNotMatch(holding.text, /The lap fails/); assert.match(holding.text, /No overlap and no red on the closed track/);
});
