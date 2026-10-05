// core-eqonly.test.js: D239 (the keeper: "can we keep only the equation mode?"): the Pieces page's four features, carried onto the
// EQUATION track and tested against the real core shell (app/core/coreshell.js): autosave with crash restore, share codes (an old Pieces
// code refused by name), Install to AC (the Export button's own build), and the getting-started guide; and the page holds one builder.
// Run: node --test --test-concurrency=1 app/test/core-eqonly.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCoreShell } = require('../core/coreshell.js');
const { createShare } = require('../share/share.js');
const { createInstaller } = require('../install/install.js');
const { makeExporter } = require('../export/export.js');
const { STEPS, createGuide, EXTEND_AT_LEAST } = require('../onboarding/guide.js');
const D = require('../../src/core/document.js');
const C = require('../../src/doc/code.js');
const W = require('../../src/doc/index.js');

const REPO = path.resolve(__dirname, '..', '..');
const get = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const R = 180, Q = Math.PI * R / 2;
/** The native side's storage, in memory: the tracks folder, and the ONE autosave file (src-tauri: save_autosave / open_autosave / clear_autosave). */
function storage({ autosave = null, failSave = false } = {}) {
  const s = { docs: new Map(), auto: autosave, autoWrites: 0, cleared: 0, writes: [] };
  return Object.assign(s, {
    saveDoc: async (n, t) => { if (failSave) throw new Error('disk full'); s.docs.set(n, t); }, openDoc: async (n) => s.docs.get(n), listDocs: async () => [...s.docs.keys()],
    saveAutosave: async (t) => { s.auto = t; s.autoWrites++; }, openAutosave: async () => s.auto, clearAutosave: async () => { s.auto = null; s.cleared++; },
    writeExport: async (dir, folder, files) => { s.writes.push({ folder, files: files.map((f) => [f.path, Buffer.from(f.bytes)]) }); },
  });
}
/** Timers the test runs by hand. */
function handTimers() { const t = { due: [] }; t.setTimeout = (fn) => { t.due.push(fn); return t.due.length; }; t.clearTimeout = () => { t.due = []; }; t.run = async () => { const d = t.due; t.due = []; for (const f of d) await f(); }; return t; }
const extendLap = (s) => {
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
};
const text = (s) => D.serialize(s.getState().history.present);

// ── autosave and crash restore ──
test('an unsaved edit is autosaved after the pause, as a core autosave holding the document\'s canonical text', async () => {
  const st = storage(), timers = handTimers(), s = await createCoreShell({ brushFn: null, storage: st, timers });
  s.extend({ length: 200 });
  assert.equal(st.autoWrites, 0, 'nothing is written before the pause');
  await timers.run();
  const o = JSON.parse(st.auto);
  assert.deepEqual([o.schema, o.kind, o.doc], [1, 'core', text(s)]);
});

test('a crash leaves the autosave; the next start OFFERS it (never applies it), and restore brings the track back unsaved', async () => {
  const st = storage(), a = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  extendLap(a); await a.flushAutosave();
  const crashed = text(a);
  const b = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  assert.equal(b.getState().history.present.pieces.length, 0, 'the new session starts empty: the offer is not applied');
  assert.equal(D.serialize(b.getState().recovery.doc), crashed);
  b.restore();
  assert.deepEqual([text(b), b.getState().dirty, b.getState().recovery], [crashed, true, null]);
});

test('Discard clears the offer and the file; Save under a name clears the autosave; a clean exit clears it', async () => {
  const st = storage(), a = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  a.extend({ length: 200 }); await a.flushAutosave();
  const b = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  await b.discardRecovery();
  assert.deepEqual([b.getState().recovery, st.auto], [null, null]);
  b.extend({ length: 100 }); await b.flushAutosave(); assert.ok(st.auto, 'written');
  await b.save('kept'); assert.equal(st.auto, null, 'a named save leaves nothing to recover');
  b.extend({ length: 100 }); await b.flushAutosave(); assert.ok(st.auto);
  await b.cleanExit(); assert.equal(st.auto, null, 'a clean exit leaves nothing to recover');
});

test('a damaged autosave is left on disk and the app starts anyway, saying so', async () => {
  const st = storage({ autosave: '{"schema":1,"kind":"core","doc":"not a document"}' });
  const s = await createCoreShell({ brushFn: null, storage: st });
  assert.match(s.getState().message, /could not be read, so it was left alone/);
  assert.deepEqual([s.getState().recovery, st.auto, st.cleared], [null, '{"schema":1,"kind":"core","doc":"not a document"}', 0]);
});

test('an autosave from the OLD Pieces builder is kept aside as a saved word track, named in the message, never overwritten unread', async () => {
  const word = W.serialize(W.appendWord(W.createDoc('old'), 'straight'));
  const st = storage({ autosave: JSON.stringify({ schema: 1, name: 'old', doc: word }) });
  const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  const kept = [...st.docs.keys()].filter((n) => !n.startsWith('eq-'));
  assert.equal(kept.length, 1); assert.equal(st.docs.get(kept[0]), word, 'byte for byte');
  assert.match(s.getState().message, new RegExp(`old Pieces builder .*kept as the saved word track "${kept[0]}"`));
  assert.equal(s.getState().recovery, null, 'it is not offered as an equation track');
});

test('a Pieces autosave that cannot be kept aside is left as it was, and that session does not autosave over it', async () => {
  const old = JSON.stringify({ schema: 1, name: 'old', doc: 'word track text' });
  const st = storage({ autosave: old, failSave: true });
  const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  assert.match(s.getState().message, /could not be kept aside \(disk full\).*does not autosave over it/);
  s.extend({ length: 200 }); await s.flushAutosave(); await s.cleanExit();
  assert.deepEqual([st.auto, st.autoWrites, st.cleared], [old, 0, 0]);
});

// ── share codes ──
test('an equation track\'s code is its t180b.core/4 text, compressed and checksummed like every code, and reads back exactly', async () => {
  const s = await createCoreShell({ brushFn: null }); extendLap(s);
  const code = C.coreToCode(s.getState().history.present);
  assert.match(code, /^t180e/);
  assert.equal(C.decode(code, 'e').text, text(s));
  assert.equal(D.serialize(C.coreFromCode(code)), text(s));
});

test('an old Pieces code (a word track, a piece) is REFUSED BY NAME, and nothing changes', async () => {
  const s = await createCoreShell({ brushFn: null }); s.extend({ length: 200 });
  const before = text(s), past = s.getState().history.past.length;
  const wd = C.docToCode(W.appendWord(W.createDoc('old'), 'straight'));
  for (const code of [wd]) {
    const r = await createShare(s).paste(code);
    assert.equal(r.refused, 'CODE_PIECES'); assert.match(r.message, /^CODE_PIECES: .*old Pieces builder/);
  }
  assert.deepEqual([text(s), s.getState().history.past.length], [before, past]);
});

test('a pasted code whose document is not a valid equation track is refused, and nothing changes', async () => {
  const s = await createCoreShell({ brushFn: null }); s.extend({ length: 200 });
  const before = text(s), r = await createShare(s).paste(C.encode('e', '{"schema":"t180b.core/4","pieces":"no"}'));
  assert.equal(r.kind, 'e'); assert.match(r.message, /^CODE_MALFORMED: this code's track is not a valid equation track/);
  assert.equal(text(s), before);
});

// found in the real window (D239): the page loaded share WITHOUT the node shim, so the core's parse could not load (tools/piecewise.cjs
// requires fs) and every pasted equation code failed, reported as CODE_MALFORMED by a catch that was too broad
test('the share panel, loaded as the page loads it (with the core\'s node shim), opens an equation code', async () => {
  const html = fs.readFileSync(path.join(REPO, 'app', 'index.html'), 'utf8');
  assert.match(html, /loadCjs\('app\/share\/index\.js', get, coreOpts\)/, 'the page gives share the options the core shell gets');
  const { loadCjs } = require('../lib/cjs.js'), shim = (await loadCjs('app/export/node-shim.js', get)).createShim();
  const S = await loadCjs('app/share/share.js', get, { builtins: shim.builtins, globals: { Buffer: shim.Buffer } });
  const a = await createCoreShell({ brushFn: null }); extendLap(a);
  const b = await createCoreShell({ brushFn: null }), r = await S.createShare(b).paste(C.coreToCode(a.getState().history.present));
  assert.match(r.message, /^opened /); assert.equal(text(b), text(a));
});

test('a module that cannot load is the app\'s failure, never reported as a malformed code', async () => {
  const { loadCjs } = require('../lib/cjs.js'), S = await loadCjs('app/share/share.js', get);   // no shim: the core cannot load
  const a = await createCoreShell({ brushFn: null }); a.extend({ length: 200 });
  await assert.rejects(S.createShare(a).paste(C.coreToCode(a.getState().history.present)), /"fs"/);
});

// ── install: the Export button's own build ──
test('Install to AC writes exactly the files Export writes, byte for byte, under the saved name', async () => {
  const st = storage(), s = await createCoreShell({ brushFn: null, storage: st, exporter: await makeExporter(get), autosaveMs: 0 });
  extendLap(s); s.close(); await s.save('Same');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-eqonly-'));
  try { await s.exportTo(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(s.getState().messageKind, 'ok', s.getState().message);
  const installs = [], native = { getAcRoot: async () => 'G:/assettocorsa', installTrack: async (folder, files) => { installs.push({ folder, files: files.map((f) => [f.path, Buffer.from(f.bytes)]) }); } };
  const r = await createInstaller({ build: (o) => s.buildExport(o), native, getDoc: () => s.exportDoc() }).install();
  assert.equal(r.ok, true, r.message);
  assert.equal(installs[0].folder, 't180b_same'); assert.equal(st.writes[0].folder, 't180b_same');
  const strip = (files) => files.filter(([p]) => p !== '.t180b-builder.json');   // the stamp carries the time it was made
  assert.deepEqual(strip(installs[0].files).map(([p]) => p), strip(st.writes[0].files).map(([p]) => p));
  for (const [i, [p, b]] of strip(installs[0].files).entries()) assert.ok(b.equals(strip(st.writes[0].files)[i][1]), `${p} differs`);
});

// ── the guide, on the equation builder ──
test('the guide\'s steps are the equation builder\'s: extend, brush, close, colours, export, grid', () => {
  assert.deepEqual(STEPS.map((s) => s.id), ['extend', 'brush', 'close', 'colours', 'export', 'grid']);
  assert.ok(STEPS.every((s) => s.title && s.text && s.target));
  // (the grid step's "centre handle" is the symmetry guides' own, app/preview/guideslayer.js, not a piece builder's handle)
  assert.ok(STEPS.every((s) => !/\b(words?|phrases?|connector|sculpt)\b/i.test(s.text)), 'none of the piece builder\'s wording is left');
});

test(`extending ${EXTEND_AT_LEAST} pieces, a brush stroke and Close the loop complete their steps in the real core shell`, async () => {
  const s = await createCoreShell({ brushFn: null }), g = createGuide();
  s.subscribe((st) => g.observe(st));
  s.extend({ length: 300, family: 'bowl' }); s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  assert.equal(g.state.step.id, 'extend', 'two is not yet a few');
  for (let i = 0; i < 3; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  assert.deepEqual([g.state.done.extend, g.state.step.id], [true, 'brush']);
  s.beginBrush({ mode: 'rate', channel: 'kv', s0: 200, r: 80 }); s.brushTo(0.001); s.endBrush();
  assert.deepEqual([g.state.done.brush, g.state.step.id], [true, 'close'], s.getState().message || '');
  s.close();
  assert.deepEqual([g.state.done.close, g.state.step.id], [true, 'colours'], s.getState().message || '');
});

test('the grid-and-mirror step is a reading step: Next completes it and finishes the guide', () => {
  const g = createGuide();
  for (let k = 0; k < STEPS.length - 1; k++) g.skip();
  assert.equal(g.state.step.id, 'grid');
  g.next();
  assert.deepEqual([g.state.done.grid, g.state.status], [true, 'finished']);
});

// ── the page: one builder ──
test('app/index.html holds ONE builder: no mode switch, no ?mode, no t180.mode, no piece-builder shell or palette', () => {
  const html = fs.readFileSync(path.join(REPO, 'app', 'index.html'), 'utf8');
  for (const gone of ['id="mode"', "get('mode')", "'t180.mode'", 'createShell(', "'app/palette/palette.js'", "'handles'", 'id="handles"']) assert.ok(!html.includes(gone), `still there: ${gone}`);
});

test('the equation page mounts the four carried features and clears the autosave on a clean exit', () => {
  const html = fs.readFileSync(path.join(REPO, 'app', 'index.html'), 'utf8'), core = html.slice(html.indexOf('async function startCore()'));
  for (const m of ["loadCjs('app/share/index.js'", "loadCjs('app/install/index.js'", "loadCjs('app/onboarding/index.js'", 'drawBanner(st)', 'shell.restore()', 'shell.discardRecovery()']) assert.ok(core.includes(m), `not on the equation page: ${m}`);
  assert.match(core, /closeCleanup = async \(\) => \{ if \(!shell\.getState\(\)\.dirty\) await shell\.cleanExit\(\); else await shell\.flushAutosave\(\); \};/);
});

test('the removed piece-builder modules are gone, and the shared ones the equation page and the exporter use are kept', () => {
  for (const f of ['app/palette/palette.js', 'app/handles/index.js', 'app/handles/panel.js', 'app/handles/handles.js', 'app/texture/index.js', 'app/onboarding/defaults.js']) assert.ok(!fs.existsSync(path.join(REPO, f)), `still there: ${f}`);
  for (const f of ['app/palette/panels.js', 'app/texture/panel.js', 'src/export/fromwords.js', 'app/shell.js']) assert.ok(fs.existsSync(path.join(REPO, f)), `removed but needed: ${f}`);
});
