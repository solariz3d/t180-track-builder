// overwrite.test.js: node --test app/test/overwrite.test.js
// THE OVERWRITE QUESTION (the user, 2026-10-31 16:55: "if saving a second track with the same name, there should be a warning saying you will overwrite
// it"; his ELYSIUM save was replaced on 10-22, and an edge-test export came from the wrong version). Save asks before it writes over a saved track that is
// NOT the open one, and Export to Assetto Corsa asks before it replaces a t180b folder holding a different road. Cancel writes nothing. Rows:
//   1  a save under the name of another saved track asks, naming it and its last-saved date; Replace writes it, as one save
//   2  Cancel writes NOTHING: the files on disk are byte for byte as they were, their times unchanged, no backup and no undo sidecar written
//   3  re-saving the open track asks nothing, under its own name in any case (Windows names are case-blind)
//   4  an unsaved track, or a previous version opened as a copy, asks before taking a saved track's name
//   5  a first save under a new name asks nothing; a save with no way to ask is refused, not written (fail closed)
//   6  the AC decision: no folder, or a folder the builder did not make (native refuses it, untouched), asks nothing; the same road asks nothing; a
//      different road, or a marker with no road recorded, asks
//   7  Export to Assetto Corsa: a different road asks; Cancel installs nothing; Replace installs; the same road re-exported asks nothing
//   8  the two questions: their title and words name the track (or folder) and its date, Cancel is the default (Enter does not replace), Replace says so
//   9  the page wires both: Save passes the question to the shell, the installer gets it and the native side's installedState
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createCoreShell } = require('../core/coreshell.js');
const { createInstaller } = require('../install/install.js');
const OW = require('../core/overwrite.js');

const REPO = path.resolve(__dirname, '..', '..');

/** A storage that keeps tracks as real FILES in a temp folder, as the native side does (save moves the old file into track-backups first). */
function diskStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-overwrite-')), backups = path.join(dir, 'track-backups');
  fs.mkdirSync(backups);
  const file = (n) => path.join(dir, `${n}.t180track`);
  const calls = [];
  const s = {
    dir, backups, calls, file,
    saveDoc: async (n, t) => { calls.push(['saveDoc', n]); if (fs.existsSync(file(n))) fs.renameSync(file(n), path.join(backups, `${n}.2026-10-31_120000.t180track`)); fs.writeFileSync(file(n), t); },
    openDoc: async (n) => fs.readFileSync(file(n), 'utf8'),
    listDocs: async () => fs.readdirSync(dir).filter((f) => f.endsWith('.t180track')).map((f) => f.slice(0, -'.t180track'.length)),
    docSavedAt: async (n) => (fs.existsSync(file(n)) ? fs.statSync(file(n)).mtimeMs : null),
    saveUndo: async (n) => { calls.push(['saveUndo', n]); fs.writeFileSync(path.join(dir, `${n}.t180undo`), 'u'); },
    clearAutosave: async () => { calls.push(['clearAutosave']); },
    backupDoc: async (n) => { calls.push(['backupDoc', n]); return 'b'; },
  };
  return s;
}
/** Every file under the store, with its bytes' digest and its time: what "nothing written" means. */
function snapshot(s) {
  const out = {};
  const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n), st = fs.statSync(p); if (st.isDirectory()) walk(p); else out[path.relative(s.dir, p)] = [crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'), st.mtimeMs]; } };
  walk(s.dir);
  return out;
}
async function shellWith(s, length = 120) {
  const sh = await createCoreShell({ brushFn: null, storage: s });
  sh.extend({ length });
  return sh;
}

test('row 1: a save under another saved track\'s name asks, naming it and its date; Replace writes it, once', async () => {
  const s = diskStore();
  const a = await shellWith(s, 120); await a.save('ELYSIUM', { confirmReplace: async () => true });
  const savedAt = fs.statSync(s.file('eq-ELYSIUM')).mtimeMs;
  const b = await shellWith(s, 300);
  const asked = [];
  await b.save('ELYSIUM', { confirmReplace: async (t) => { asked.push(t); return true; } });
  assert.strictEqual(asked.length, 1, 'it did not ask');
  assert.strictEqual(asked[0].name, 'ELYSIUM');
  assert.strictEqual(asked[0].savedAt, savedAt, 'the question must carry the saved track\'s own date');
  assert.strictEqual(fs.readFileSync(s.file('eq-ELYSIUM'), 'utf8'), b.text(), 'Replace did not write the open track');
  assert.strictEqual(fs.readdirSync(s.backups).length, 1, 'Replace keeps the replaced version, as every save does');
  assert.strictEqual(b.getState().name, 'ELYSIUM');
});

test('row 2: Cancel writes nothing: every file byte for byte and time for time as it was, and no backup, sidecar or autosave call', async () => {
  const s = diskStore();
  const a = await shellWith(s, 120); await a.save('ELYSIUM', { confirmReplace: async () => true });
  const b = await shellWith(s, 300);
  const before = snapshot(s), callsBefore = s.calls.length;
  await b.save('ELYSIUM', { confirmReplace: async () => false });
  assert.deepStrictEqual(snapshot(s), before, 'Cancel changed a file');
  assert.deepStrictEqual(s.calls.slice(callsBefore), [], 'Cancel reached the storage');
  assert.strictEqual(b.getState().name, null, 'Cancel must not adopt the other track\'s name');
  assert.strictEqual(b.getState().dirty, true, 'the open track is still unsaved');
  assert.match(b.getState().message || '', /not saved/i);
  // only a plain true replaces: a dialog that answers nothing, or anything else, is a Cancel
  for (const answer of [undefined, null, 'replace', 1]) {
    await b.save('ELYSIUM', { confirmReplace: async () => answer });
    assert.deepStrictEqual(snapshot(s), before, `an answer of ${JSON.stringify(answer)} wrote over the saved track`);
  }
});

test('row 3: re-saving the open track asks nothing, in its own name\'s case or another', async () => {
  const s = diskStore();
  const a = await shellWith(s, 120); await a.save('Elysium', { confirmReplace: async () => true });
  const never = async () => { throw new Error('asked on a re-save of the open track'); };
  a.extend({ length: 50 }); await a.save('Elysium', { confirmReplace: never });
  a.extend({ length: 50 }); await a.save('ELYSIUM', { confirmReplace: never });
  const o = await shellWith(s, 10); await o.open('Elysium');
  o.extend({ length: 50 }); await o.save('Elysium', { confirmReplace: never });
  assert.strictEqual(fs.readFileSync(s.file('eq-Elysium'), 'utf8'), o.text());
});

test('row 4: an unsaved track, or a previous version opened as a copy, asks before taking a saved track\'s name; a name in another case is that track', async () => {
  const s = diskStore();
  const a = await shellWith(s, 120); await a.save('Gates', { confirmReplace: async () => true });
  const other = await shellWith(s, 200); await other.save('Other', { confirmReplace: async () => true });
  let n = 0;
  await other.save('gates', { confirmReplace: async (t) => { n++; assert.strictEqual(t.name, 'Gates', 'the saved track\'s own name'); return false; } });
  assert.strictEqual(n, 1, 'a name in another case is the same file on Windows: it must ask');
  const copy = await createCoreShell({ brushFn: null, storage: { ...s, listBackups: async () => [], openBackup: async () => fs.readFileSync(s.file('eq-Gates'), 'utf8') } });
  await copy.openVersion('x');
  assert.strictEqual(copy.getState().name, null);
  await copy.save('Gates', { confirmReplace: async () => { n++; return false; } });
  assert.strictEqual(n, 2, 'a copy saved over its own original must ask');
});

test('row 5: a first save asks nothing; a save over another track with no way to ask is refused and writes nothing', async () => {
  const s = diskStore();
  const a = await shellWith(s, 120);
  await a.save('Fresh', { confirmReplace: async () => { throw new Error('asked on a first save'); } });
  assert.ok(fs.existsSync(s.file('eq-Fresh')));
  const b = await shellWith(s, 300);
  const before = snapshot(s);
  await b.save('Fresh');
  assert.deepStrictEqual(snapshot(s), before, 'with no question to ask, it must not write over another track');
  assert.match(b.getState().message || '', /not saved/i);
});

// ── Export to Assetto Corsa ──────────────────────────────────────────────────────────────────────────────────────────────

const G1 = 'sha256:' + '1'.repeat(64), G2 = 'sha256:' + '2'.repeat(64);
const markerBytes = (geometry) => new TextEncoder().encode(JSON.stringify({ tool: 't180-track-builder', written: '2026-10-22T19:37:36.000Z', ...(geometry ? { geometry } : {}), files: ['t180b_x.kn5'] }));

test('row 6: the AC decision: absent, not ours, or the same road asks nothing; a different road or an unrecorded one asks', () => {
  assert.strictEqual(OW.installNeedsAsk({ exists: false, marker: false, geometry: null }, G1), false, 'no folder');
  assert.strictEqual(OW.installNeedsAsk({ exists: true, marker: false, geometry: null }, G1), false, 'not the builder\'s: native refuses it untouched');
  assert.strictEqual(OW.installNeedsAsk({ exists: true, marker: true, geometry: G1 }, G1), false, 'the same road');
  assert.strictEqual(OW.installNeedsAsk({ exists: true, marker: true, geometry: G2 }, G1), true, 'a different road');
  assert.strictEqual(OW.installNeedsAsk({ exists: true, marker: true, geometry: null }, G1), true, 'a marker from before the road was recorded');
  assert.strictEqual(OW.installNeedsAsk({ exists: true, marker: true, geometry: G1 }, null), true, 'this export records no road');
  assert.strictEqual(OW.markerGeometry([{ path: 'a.kn5', bytes: new Uint8Array(3) }, { path: '.t180b-builder.json', bytes: markerBytes(G1) }]), G1);
  assert.strictEqual(OW.markerGeometry([{ path: 'a.kn5', bytes: new Uint8Array(3) }]), null);
});

function installer({ installed, geometry, confirmReplace }) {
  const writes = [];
  const native = {
    getAcRoot: async () => 'G:\\AC',
    installTrack: async (folder) => { writes.push(folder); return { files: 1, retired: [] }; },
    installedState: async () => installed,
  };
  const build = async () => ({ result: { warnings: [] }, folders: [{ folder: 't180b_x', files: [{ path: 't180b_x.kn5', bytes: new Uint8Array(4) }, { path: '.t180b-builder.json', bytes: markerBytes(geometry) }] }] });
  return { writes, inst: createInstaller({ build, native, getDoc: () => ({ name: 'x' }), confirmReplace }) };
}

test('row 7: Export to AC over a different road asks; Cancel installs nothing; Replace installs; the same road again asks nothing', async () => {
  const asked = [];
  let r = installer({ installed: { exists: true, marker: true, geometry: G2, written: '2026-10-22T19:37:36.000Z' }, geometry: G1, confirmReplace: async (q) => { asked.push(q); return false; } });
  let out = await r.inst.install();
  assert.strictEqual(asked.length, 1, 'it did not ask');
  assert.strictEqual(asked[0].folder, 't180b_x');
  assert.strictEqual(asked[0].written, '2026-10-22T19:37:36.000Z');
  assert.deepStrictEqual(r.writes, [], 'Cancel installed something');
  assert.strictEqual(out.ok, false); assert.match(out.message, /not exported/i); assert.match(out.message, /t180b_x/);
  r = installer({ installed: { exists: true, marker: true, geometry: G2 }, geometry: G1, confirmReplace: async () => true });
  out = await r.inst.install();
  assert.deepStrictEqual(r.writes, ['t180b_x']); assert.strictEqual(out.ok, true);
  r = installer({ installed: { exists: true, marker: true, geometry: G1 }, geometry: G1, confirmReplace: async () => { throw new Error('asked on a same-road re-export'); } });
  out = await r.inst.install();
  assert.deepStrictEqual(r.writes, ['t180b_x']);
  r = installer({ installed: { exists: true, marker: true, geometry: G2 }, geometry: G1 });
  out = await r.inst.install();
  assert.deepStrictEqual(r.writes, [], 'with no way to ask, a different road must not be replaced');
  for (const answer of [undefined, 'replace']) {
    r = installer({ installed: { exists: true, marker: true, geometry: G2 }, geometry: G1, confirmReplace: async () => answer });
    await r.inst.install();
    assert.deepStrictEqual(r.writes, [], `an answer of ${JSON.stringify(answer)} replaced the installed road`);
  }
});

test('row 8: the questions name the track and its date, default to Cancel, and Replace says what it does', () => {
  const when = new Date(2026, 9, 22, 19, 37).getTime();
  const q = OW.saveQuestion({ name: 'ELYSIUM', savedAt: when });
  assert.match(q.title, /ELYSIUM/);
  assert.match(q.message, /ELYSIUM/); assert.match(q.message, /2026-10-22 19:37/);
  const cancel = q.buttons.find((b) => b.value === 'cancel'), replace = q.buttons.find((b) => b.value === 'replace');
  assert.ok(cancel && cancel.default, 'Cancel must be the default, so Enter does not replace');
  assert.ok(replace && !replace.default && /Replace/.test(replace.label));
  assert.strictEqual(q.cancelValue, 'cancel');
  assert.match(OW.saveQuestion({ name: 'A', savedAt: null }).message, /A/, 'an unknown date still names the track');
  const iq = OW.installQuestion({ folder: 't180b_x', written: '2026-10-22T19:37:36.000Z' });
  assert.match(iq.title, /t180b_x/); assert.match(iq.message, /t180b_x/); assert.match(iq.message, /2026-10-22/);
  assert.ok(iq.buttons.find((b) => b.value === 'cancel').default);
});

test('row 9: the page wires both questions through the themed dialog, and the native side answers installedState', () => {
  const html = fs.readFileSync(path.join(REPO, 'app/index.html'), 'utf8');
  assert.match(html, /shell\.save\(\$\('name'\)\.value\.trim\(\), \{ confirmReplace: /, 'Save does not pass the question');
  assert.match(html, /installedState: \(folder\) => call\('installed_state', \{ folder \}\)/, 'the native side has no installedState');
  assert.match(html, /docSavedAt: \(name\) =>/, 'the storage has no docSavedAt');
  const idx = fs.readFileSync(path.join(REPO, 'app/install/index.js'), 'utf8');
  assert.match(idx, /createInstaller\(\{[^}]*confirmReplace/, 'the installer is not given the question');
  const rs = fs.readFileSync(path.join(REPO, 'src-tauri/src/lib.rs'), 'utf8');
  const handler = rs.slice(rs.indexOf('generate_handler!['), rs.indexOf('])', rs.indexOf('generate_handler![')));
  for (const c of ['installed_state', 'track_saved_at']) assert.ok(new RegExp(`\\b${c}\\b`).test(handler), `${c} is not registered`);
});
