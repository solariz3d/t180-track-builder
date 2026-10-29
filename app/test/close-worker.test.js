// close-worker.test.js: node --test app/test/close-worker.test.js
// 2026-10-15, CLOSE OFF THE WINDOW'S THREAD: Close's work held the window 4.1 s on a 24 km track. The work is one pure job (app/core/closejob.js), run in a Web
// Worker (app/core/closeworker.js) through app/core/closerunner.js, as the track checker went in 7512f84. D339: Close is ONE press (closejob.js runCloseBest: every
// route tried, one picked, applied at once), so the rows that held the preview and the "close using" box went with them (rows 7 and 8, and the preview halves of
// 1, 2, 3 and 6). Rows:
//   1  THE ANSWER IS IDENTICAL: through the worker (every message structured-cloned, as a postMessage does) one press closes the track exactly as on the page, near
//      and far, with the same words; and new road leaves the user's pieces as the very same objects
//   2  when no way proves, the worker says the same words as the page, and nothing changes
//   3  the shell while the worker works: the press returns with the close pending; an edit meanwhile drops the answer by name; Cancel and a newer press cancel the
//      job; the whole lap's stretch is sent; a runner that cannot start, or a job that fails, closes on the page instead
//   4  the runner: one warm worker made with it; a reply that is not the current job's is ignored; a refusal resolves; cancel and a failure make a fresh worker;
//      a page without Worker throws
//   5  the worker SCRIPT, in a sandbox with the real files: it loads closejob.js through the app's loader and answers as runClose does (a single route, and the
//      one press); a refusal and a bad job are answered, never a hang
//   6  the panel: ONE Close button (no "close using" box, no Apply); while the worker works it says so and Cancel stops it; then the line says what was done
//   7  (D343) a press hands the worker the reds the live checker found for THIS track with CSP on (shell.noteCheck), and no others
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
test('row 1: through the worker one press closes the track exactly as on the page, near and far, with the same words; new road keeps the user\'s pieces as the very same objects', async () => {
  for (const make of [nearLap, (r) => openLap({ closeRunner: r })]) {
    const page = await make(null), off = await make(workerRunner());
    assert.deepStrictEqual(off.getState().history.present, page.getState().history.present, 'the same open track');
    const base = off.getState().history.present;
    await page.closeBest(); await off.closeBest();
    const a = page.getState(), b = off.getState();
    assert.equal(a.history.present.closed, true, `the page closes it: ${a.message}`); assert.match(a.message, /^closed: /);
    assert.deepStrictEqual(b.history.present, a.history.present, 'the worker\'s closed track is the page\'s'); assert.equal(b.message, a.message, 'and its words');
    assert.ok(Object.isFrozen(b.history.present) && b.history.present.pieces.every(Object.isFrozen), 'the document is frozen, as the core\'s are');
    assert.equal(b.history.past[b.history.past.length - 1], base, 'one undo step back to the open track');
    if (b.history.present.pieces.length > base.pieces.length) base.pieces.forEach((P, i) => assert.equal(b.history.present.pieces[i], P, `piece ${i} is the user's own, the very object`));
  }
});

/** A coil: 300 m and eight quarter turns of 180 m, two circles on one another; no way of closing it proves (each adds a red where the road meets itself). */
const coil = (closeRunner) => openLap({ turns: 8, lastLen: 60, closeRunner });
test('row 2: when no way of closing proves, the worker says the same words as the page, and nothing changes', async () => {
  const page = await coil(null), off = await coil(workerRunner()), base = off.getState().history.present;
  await page.closeBest(); await off.closeBest();
  assert.equal(off.getState().history.present, base, 'nothing changed'); assert.equal(page.getState().history.present.closed, false);
  assert.match(off.getState().message, /^not closed, nothing changed: /); assert.equal(off.getState().message, page.getState().message); assert.equal(off.getState().messageKind, page.getState().messageKind);
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
const answerOf = (doc, opts = {}) => ({ out: clone(CJ.runClose({ doc: clone(doc), best: true, ...opts })), ms: 1 });

test('row 3: while the worker works the close is pending; an edit drops the answer by name; Cancel and a newer press cancel it; no runner or a failed job closes on the page', async () => {
  const r = handRunner(), s = await nearLap(r), base = s.getState().history.present;
  const p0 = s.closeBest();
  let st = s.getState();
  assert.equal(r.jobs.length, 1); assert.ok(st.closePending && st.closePending.base === base, 'the close is pending, for this track'); assert.equal(st.history.present, base, 'nothing is applied yet');
  assert.equal(r.jobs[0].args.best, true, 'the job is the one press'); assert.equal(r.jobs[0].args.doc, base);
  const sent = r.jobs[0].args.edited; assert.ok(Array.isArray(sent) && sent.includes(base.pieces.length - 1), `the whole-lap route is told what to go round: ${JSON.stringify(sent)}`);
  s.extend({ length: 50 }); const edited = s.getState().history.present;
  r.jobs[0].resolve(answerOf(base)); await p0;
  st = s.getState(); assert.equal(st.history.present, edited, 'a stale answer changes nothing'); assert.equal(st.closePending, null); assert.match(st.message, /track changed while the close was being worked out/);
  s.closeBest(); s.cancelClose(); assert.equal(r.jobs[1].cancelled, 1, 'Cancel stops the job'); assert.equal(s.getState().closePending, null);
  s.closeBest(); const p3 = s.closeBest(); assert.equal(r.jobs[2].cancelled, 1, 'a newer press cancels the older');
  r.jobs[3].resolve(answerOf(edited)); await p3; assert.equal(s.getState().history.present.closed, true, s.getState().message); assert.match(s.getState().message, /^closed: /);
  for (const runner of [handRunner({ throwOnStart: true }), null]) {
    const u = await nearLap(runner); await u.closeBest();
    assert.equal(u.getState().history.present.closed, true, `no worker: closed on the page: ${u.getState().message}`); assert.equal(u.getState().closePending || null, null);
  }
  const fr = handRunner(), v = await nearLap(fr), pv = v.closeBest();
  fr.jobs[0].reject(new Error('worker died')); await pv;
  assert.equal(v.getState().history.present.closed, true, `a failed job closes on the page: ${v.getState().message}`); assert.equal(v.getState().closePending, null);
});

test('row 4: the runner: one warm worker; a reply that is not the current job\'s is ignored; a refusal resolves; cancel and a failure make a fresh worker; no Worker throws', async () => {
  assert.throws(() => createCloseRunner({ win: {} }), /no Web Worker/);
  const made = [];
  class FakeWorker { constructor(url) { this.url = url; this.sent = []; this.terminated = 0; made.push(this); } postMessage(m) { this.sent.push(m); } terminate() { this.terminated++; } }
  const runner = createCloseRunner({ win: {}, WorkerCtor: FakeWorker });
  assert.equal(made.length, 1, 'the worker exists before any job: it is warm'); assert.equal(made[0].url, 'core/closeworker.js');
  const a = runner.start({ doc: { x: 1 }, finish: true }); assert.equal(made.length, 1, 'a job makes no worker');
  assert.deepStrictEqual(made[0].sent[0], { serial: 1, doc: { x: 1 }, fraction: 0.2, last: false, whole: false, finish: true, edited: null, best: false, openReds: null });
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

test('row 5: the worker SCRIPT loads closejob.js through the app\'s loader and answers as runClose does (a route, and the one press); a refusal and a bad job are answered', async () => {
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
  await ctx.onmessage({ data: { serial: 6, doc: clone(doc), best: true, edited: [doc.pieces.length - 1] } });
  // the timings in the answer (each route's ms, the checks' ms) are the run's own, so they are left out of the comparison
  const untimed = (o) => JSON.parse(JSON.stringify(o, (k, v) => (/Ms$/.test(k) || k === 'ms' ? undefined : v)));
  const best = posted.pop(); assert.equal(best.ok, true, best.error); assert.deepStrictEqual(untimed(best.out), untimed(clone(CJ.runClose({ doc, best: true, edited: [doc.pieces.length - 1] }))), 'the one press answers as runCloseBest does');
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

test('row 6: the panel has ONE Close button (no "close using" box, no Apply); while the worker works it says so and Cancel stops it; then the line says what was done', async () => {
  const r = handRunner(), s = await nearLap(r), P = await mountPanel(s), base = s.getState().history.present;
  const cancel = () => P.root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === 'Cancel' && /^stop the close/.test(e.attrs.title || ''));   // the Close's own Cancel: Bank the bend has a Cancel in the same panel
  assert.equal(P.root.all().find((e) => e.attrs['aria-label'] === 'close using') || null, null, 'no choice of how to close'); assert.equal(P.root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === 'Apply' && !/^bank the road as previewed/.test(e.attrs.title || '')) || null, null, 'no Apply');   // Sculpt's Bank the bend has an Apply of its own, in the same panel; Close still has none
  P.button('Close the loop').onclick(); P.fire();
  assert.equal(r.jobs.length, 1, 'the panel asked for the close'); assert.equal(r.jobs[0].args.best, true);
  assert.equal(P.text('close working'), 'Closing the loop: trying each way of closing it and checking the lap… The window stays free; Cancel stops it.');
  assert.equal(cancel().style.display, '', 'Cancel is offered while it works');
  cancel().onclick(); assert.equal(r.jobs[0].cancelled, 1, 'Cancel in the panel stops the job'); assert.equal(P.text('close working'), null); assert.equal(cancel().style.display, 'none');
  P.button('Close the loop').onclick(); P.fire();
  r.jobs[1].resolve(answerOf(base)); await tick(); await tick(); await tick();
  assert.equal(s.getState().history.present.closed, true, s.getState().message);
  assert.match(P.text('close done') || '', /^closed: /, 'the line under the button says what it did'); assert.equal(P.text('close working'), null);
});

test('row 7: a press hands the worker the reds the live checker found for this very track with CSP on, and no others', async () => {
  const r = handRunner(), s = await nearLap(r), base = s.getState().history.present, reds = [{ reason: 'stacked-within-2m', s0: 120, s1: 130 }];
  s.closeBest(); assert.equal(r.jobs[0].args.openReds, null, 'nothing noted: the worker checks the open track itself'); s.cancelClose();
  s.noteCheck(base, { csp: false, red: reds }); s.closeBest(); assert.equal(r.jobs[1].args.openReds, null, 'a check with CSP off is not the press check'); s.cancelClose();
  s.noteCheck(base, { csp: true, red: reds }); s.closeBest(); assert.deepEqual(r.jobs[2].args.openReds, [{ reason: 'stacked-within-2m', s: 120 }], 'this track check, as { reason, s }'); s.cancelClose();
  s.extend({ length: 20 }); s.closeBest(); assert.equal(r.jobs[3].args.openReds, null, 'a check of another document is not used'); s.cancelClose();
});
