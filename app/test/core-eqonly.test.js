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

// RESTATED (B's D239 look, F1): "left on disk" held only until the first autosave. With nowhere to keep it aside (this storage has no
// backups), it now stays on disk for the WHOLE session: an edit and a flush write nothing over it.
test('a damaged autosave that cannot be kept aside is left on disk for the whole session, and the app starts anyway, saying so', async () => {
  const bad = '{"schema":1,"kind":"core","doc":"not a document"}', st = storage({ autosave: bad });
  const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  assert.match(s.getState().message, /could not be read .*could not be kept aside \(nowhere to keep it\).*does not autosave over it/);
  s.extend({ length: 200 }); await s.flushAutosave(); await s.cleanExit();
  assert.deepEqual([s.getState().recovery, st.auto, st.autoWrites, st.cleared], [null, bad, 0, 0]);
});

// ── B's D239 look, F1: a DAMAGED autosave's bytes survive the session's first autosave ──
for (const [what, bad] of [['not JSON', '{"schema":1,"kind":"core","doc":'], ['a core autosave whose document does not parse', '{"schema":1,"kind":"core","doc":"not a document"}'], ['JSON that is not a record', 'null']]) {
  test(`a damaged autosave (${what}) is kept as a "damaged autosave" backup BEFORE the session autosaves over it`, async () => {
    const st = backupStore({}); st.auto = bad;
    const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
    const kept = [...st.files.keys()].filter((f) => f.startsWith('damaged autosave.'));
    assert.equal(kept.length, 1); assert.equal(st.files.get(kept[0]), bad, 'byte for byte');
    assert.match(s.getState().message, new RegExp(`its bytes were kept as ${kept[0].replace(/[.]/g, '\\.')}`));
    s.extend({ length: 200 }); await s.flushAutosave();
    assert.equal(JSON.parse(st.auto).kind, 'core', 'then the session autosaves as usual');
    assert.equal(st.files.get(kept[0]), bad, 'and the damaged bytes survive the edit');
  });
}
test('a damaged autosave whose copy FAILS is never written over, an edit later', async () => {
  const bad = 'not json at all', st = backupStore({ fail: true }); st.auto = bad;
  const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  assert.match(s.getState().message, /could not be kept aside \(disk full\)/);
  s.extend({ length: 200 }); await s.flushAutosave(); await s.cleanExit();
  assert.deepEqual([st.auto, st.autoWrites, st.cleared], [bad, 0, 0]);
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

// ── D239 amendment: SAVE KEEPS THE PREVIOUS VERSION (the keeper lost TEST 1 to one Close). The move on Save, the 20 kept and the prune
// are native and tested there (src-tauri/src/backups.rs, cargo test); these are the shell's and the page's halves. ──
/** The native backups in memory: backup_track's copies, list_track_backups, open_track_backup. */
function backupStore({ fail = false } = {}) {
  const st = storage(), files = new Map();
  let n = 0;
  return Object.assign(st, {
    files,
    backupDoc: async (name, text) => { if (fail) throw new Error('disk full'); const f = `${name}.2026-10-05_10${String(n++).padStart(4, '0')}.t180track`; files.set(f, text); return f; },
    // as the native list: the stamped ones newest first, then the hand-made ones
    listBackups: async (name) => { const stamped = (f) => /\.\d{4}-\d{2}-\d{2}_\d{6}(_\d+)?\.t180track$/.test(f); return [...files.keys()].filter((f) => f.startsWith(`${name}.`)).sort((a, b) => (stamped(b) - stamped(a)) || (a < b ? 1 : a > b ? -1 : 0)).map((file) => ({ file, bytes: files.get(file).length })); },
    openBackup: async (file) => { if (!files.has(file)) throw new Error(`no backup ${file}`); return files.get(file); },
  });
}
test('backupNow writes the track AS IT IS NOW under its eq- name (or "unsaved"), and says why', async () => {
  const st = backupStore(), s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  s.extend({ length: 200 });
  const r1 = await s.backupNow('before Close the loop');
  assert.match(r1.file, /^eq-unsaved\./); assert.equal(r1.reason, 'before Close the loop'); assert.equal(st.files.get(r1.file), text(s));
  await s.save('Kept'); s.extend({ length: 100 });
  const r2 = await s.backupNow('x');
  assert.match(r2.file, /^eq-Kept\./); assert.equal(st.files.get(r2.file), text(s), 'the document as it is now, not as it was saved');
  assert.equal(st.docs.get('eq-Kept'), D.serialize(D.parse(st.docs.get('eq-Kept'))), 'control: the saved file is untouched by a backup');
});

test('backupNow resolves null where there is nothing to write to, and REJECTS when the write fails (the caller then refuses its operation)', async () => {
  const bare = await createCoreShell({ brushFn: null }); bare.extend({ length: 100 });
  assert.equal(await bare.backupNow('x'), null);
  const failing = await createCoreShell({ brushFn: null, storage: backupStore({ fail: true }), autosaveMs: 0 }); failing.extend({ length: 100 });
  await assert.rejects(failing.backupNow('x'), /disk full/);
});

test('Previous versions lists the open track\'s backups newest first, with time, length and closed, and opens one as an unsaved COPY', async () => {
  const st = backupStore(), s = await createCoreShell({ brushFn: null, storage: st, exporter: null, autosaveMs: 0 });
  extendLap(s); await s.save('Lap'); const open = text(s);
  await s.backupNow('a'); s.close(); await s.backupNow('b');
  st.files.set('eq-Lap.2339-closed.t180track', open);   // a backup made by hand: listed too, without a time
  st.files.set('eq-Lap.2026-10-05_090000.t180track', 'not a document');
  const v = await s.listVersions();
  assert.equal(v.length, 4);
  assert.equal(v[0].when, '2026-10-05 10:00:01'); assert.equal(v[0].closed, true); assert.equal(v[1].closed, false);
  assert.ok(Math.abs(v[1].length - (300 + 4 * Q + 60)) < 6e-4, `length ${v[1].length}`);   // a saved length is held to 0.1 mm (src/core/document.js DEC.m), per piece
  assert.deepEqual(v.find((b) => b.file === 'eq-Lap.2339-closed.t180track').when, null);
  assert.deepEqual([v.find((b) => b.file.endsWith('090000.t180track')).length, v.find((b) => b.file.endsWith('090000.t180track')).closed], [null, null], 'an unreadable one is listed without its numbers');
  const savedBefore = st.docs.get('eq-Lap');
  await s.openVersion(v[1].file);
  assert.deepEqual([text(s), s.getState().name, s.getState().dirty], [open, null, true]);
  assert.match(s.getState().message, /as a copy: it is unsaved/);
  assert.equal(st.docs.get('eq-Lap'), savedBefore, 'opening a version changes no saved file');
});

test('an UNSAVED track\'s copy from before Close is listed in Previous versions and opens as a copy (B\'s D239 look, F3a)', async () => {
  const st = backupStore(), s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  extendLap(s); const before = text(s);
  await s.backupNow('before Close the loop'); s.close();
  const v = await s.listVersions();
  assert.equal(v.length, 1); assert.match(v[0].file, /^eq-unsaved\./); assert.equal(v[0].closed, false);
  await s.openVersion(v[0].file);
  assert.deepEqual([text(s), s.getState().name], [before, null]);
  const html = fs.readFileSync(path.join(REPO, 'app', 'index.html'), 'utf8');
  assert.ok(!html.includes("$('versions').disabled = !st.name"), 'the picker is not disabled for an unsaved track');
});

test('the page: Save sends the local time for the backup\'s name, the three backup commands are wired and registered, and there is a Previous versions picker', () => {
  const html = fs.readFileSync(path.join(REPO, 'app', 'index.html'), 'utf8');
  assert.match(html, /saveDoc: \(name, text\) => call\('save_track', \{ name, text, stamp: localStamp\(\) \}\)/);
  for (const c of ['backup_track', 'list_track_backups', 'open_track_backup']) assert.ok(html.includes(`call('${c}'`), c);
  assert.match(html, /<select id="versions"/);
  const rs = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  for (const c of ['backup_track', 'list_track_backups', 'open_track_backup']) assert.match(rs, new RegExp(`generate_handler!\\[[^\\]]*\\b${c}\\b`), `${c} is registered`);
});

// ── D239 note (the keeper's undo request): the keys MOVED from app/shell.js to the equation page, Ctrl+Backspace included ──
/** A page document for bindKeys: keydown listeners, and key events that record preventDefault. */
function keyPage() {
  const ls = new Set(), doc = { addEventListener: (t, f) => { if (t === 'keydown') ls.add(f); }, removeEventListener: (t, f) => { if (t === 'keydown') ls.delete(f); } };
  const press = (key, mods = {}, target = { matches: () => false }) => { const e = { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods, target, prevented: false, preventDefault() { this.prevented = true; } }; for (const f of [...ls]) f(e); return e; };
  return { doc, press, listeners: ls };
}
test('each shortcut fires on the equation page: Ctrl+Z undo, Ctrl+Shift+Z and Ctrl+Y redo, Ctrl+S save, Ctrl+Backspace removes the head', async () => {
  const { bindKeys } = require('../core/keys.js'), s = await createCoreShell({ brushFn: null }), P = keyPage();
  let saves = 0; const unbind = bindKeys(P.doc, s, { save: () => { saves++; } });
  s.extend({ length: 200 }); s.extend({ length: 300 });
  const two = text(s);
  assert.equal(P.press('z', { ctrlKey: true }).prevented, true); assert.equal(s.getState().history.present.pieces.length, 1, 'Ctrl+Z undid the last extend');
  P.press('Z', { ctrlKey: true, shiftKey: true }); assert.equal(text(s), two, 'Ctrl+Shift+Z redid it');
  P.press('z', { ctrlKey: true }); P.press('y', { ctrlKey: true }); assert.equal(text(s), two, 'Ctrl+Y redid it');
  P.press('s', { metaKey: true }); assert.equal(saves, 1, 'Cmd/Ctrl+S is the Save button\'s path');
  P.press('Backspace', { ctrlKey: true }); assert.equal(s.getState().history.present.pieces.length, 1, 'Ctrl+Backspace removed the head');
  P.press('z', { ctrlKey: true }); assert.equal(text(s), two, 'and that removal is one undo step');
  unbind(); assert.equal(P.listeners.size, 0, 'the unbind removes the listener');
});

// RESTATED (D242 item 8a): "a field" became "a TEXT field". Undo and redo now act on the track from a number field, a checkbox or a
// select (app/test/keys-anywhere.test.js); this fake field matches every selector with "input" in it, so it is a text field.
test('no shortcut fires while a TEXT field has focus, and a bare Backspace does nothing', async () => {
  const { bindKeys } = require('../core/keys.js'), s = await createCoreShell({ brushFn: null }), P = keyPage();
  let saves = 0; bindKeys(P.doc, s, { save: () => { saves++; } });
  s.extend({ length: 200 }); s.extend({ length: 300 }); const two = text(s);
  const field = { matches: (sel) => /input/.test(sel) };
  for (const [k, m] of [['z', { ctrlKey: true }], ['y', { ctrlKey: true }], ['s', { ctrlKey: true }], ['Backspace', { ctrlKey: true }]]) assert.equal(P.press(k, m, field).prevented, false, `${k} in a field`);
  assert.equal(P.press('Backspace').prevented, false);
  assert.deepEqual([text(s), saves], [two, 0]);
});

test('keyAction is MOVED, not copied: app/shell.js re-exports the very function, and the page binds app/core/keys.js to the core shell', () => {
  assert.equal(require('../shell.js').keyAction, require('../core/keys.js').keyAction);
  const html = fs.readFileSync(path.join(REPO, 'app', 'index.html'), 'utf8');
  assert.match(html, /loadCjs\('app\/core\/keys\.js', get\)\)\.bindKeys\(document, shell, \{ save: \(\) => \$\('save'\)\.click\(\) \}\)/);
  assert.ok(!html.includes("loadCjs('app/shell.js'"), 'the page no longer loads the piece builder\'s shell');
});

test('removeHead: one undo step; an empty track is refused by name; a closed loop opens again and says Ctrl+Z puts it back', async () => {
  const empty = await createCoreShell({ brushFn: null });
  empty.removeHead(); assert.match(empty.getState().message, /^NOTHING_TO_REMOVE/);
  const s = await createCoreShell({ brushFn: null }); extendLap(s); s.close();
  const closed = text(s), n = s.getState().history.present.pieces.length;
  s.removeHead();
  assert.deepEqual([s.getState().history.present.pieces.length, s.getState().history.present.closed], [n - 1, false]);
  assert.match(s.getState().message, /the loop is open again \(Ctrl\+Z puts the closed lap back\)/);
  s.undo(); assert.equal(text(s), closed, 'undo puts the closed lap back whole');
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
