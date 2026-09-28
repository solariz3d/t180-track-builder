// Headless tests for app/share and app/install (D176): codes through the real shell; install and the launch button
// through a fake native side (the native guards themselves are src-tauri/src/ac.rs's tests, on a temp fake AC tree).
// The launch is NEVER run: the native seeIt here is a recorder, and the test asserts it is not called while the
// setting is off. Run: node --test "app/test/*.test.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createShell } = require('../shell.js');
const { loadCjs } = require('../lib/cjs.js');
const { createShare } = require('../share/share.js');
const { createInstaller, createLauncher } = require('../install/install.js');
const { makeExporter } = require('../export/export.js');
const D = require('../../src/doc/index.js');
const C = require('../../src/doc/code.js');
const P = require('../../src/doc/packs.js');
const T = require('../../src/texture/index.js');

const REPO = path.resolve(__dirname, '..', '..');
const get = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };
const clip = () => { let v = ''; return { writeText: async (t) => { v = t; }, read: () => v }; };

test('Copy code puts the track on the clipboard; Paste code opens it in another session byte-exact, as one undo step', async () => {
  const a = await createShell({ storage: mem() }); a.place('straight'); a.place('tight');
  const cb = clip(), code = await createShare(a, { clipboard: cb }).copyTrack();
  assert.strictEqual(cb.read(), code);
  const b = await createShell({ storage: mem() }); b.place('straight');
  const before = D.serialize(b.getState().history.present);
  const r = await createShare(b).paste(`  ${code}\n`);
  assert.strictEqual(r.kind, 'd');
  assert.strictEqual(D.serialize(b.getState().history.present), D.serialize(a.getState().history.present));
  b.undo(); assert.strictEqual(D.serialize(b.getState().history.present), before);
});

test('a corrupted code changes nothing and says why', async () => {
  const a = await createShell({ storage: mem() }); a.place('straight');
  const code = await createShare(a).copyTrack(), broken = code.slice(0, code.length - 20) + code.slice(-12);
  const b = await createShell({ storage: mem() }); b.place('tight');
  const before = D.serialize(b.getState().history.present), pastBefore = b.getState().history.past.length;
  const r = await createShare(b).paste(broken);
  assert.match(r.message, /CODE_(CORRUPT|MALFORMED)/);
  assert.deepStrictEqual([D.serialize(b.getState().history.present), b.getState().history.past.length], [before, pastBefore]);
});

test('a piece code joins the palette; a pack code goes to the textures panel', async () => {
  const a = await createShell({ storage: mem() }); a.place('straight'); a.place('tight'); a.select('w2');
  await a.saveSelectionAsPiece('hook');
  const pc = await createShare(a).copyPiece('hook');
  const b = await createShell({ storage: mem() });
  assert.match((await createShare(b).paste(pc)).message, /added "hook"/);
  assert.ok(b.palette().some((p) => p.name === 'hook'));
  const png = T.png.encodePng({ width: 4, height: 4, rgba: new Uint8Array(64).fill(200) }, zlib.deflateSync);
  const kc = C.packToCode(P.makePack({ name: 'K', font: 'flat', slots: { floor: { texture: 'g' } }, images: { g: { bytes: png } } }));
  let got = null;
  const r = await createShare(b, { onPack: (t) => { got = t; return {}; } }).paste(kc);
  assert.deepStrictEqual([r.kind, P.parsePack(got).name], ['k', 'K']);
});

/** A fake native side: remembers a root, records every install and every launch request. */
function fakeNative({ seeIt = false } = {}) {
  const n = { root: null, installs: [], launches: [], setting: seeIt };
  Object.assign(n, {
    getAcRoot: async () => n.root,
    setAcRoot: async (p) => { if (!/assettocorsa$/.test(p)) throw new Error(`${p} has no content\\tracks`); n.root = p; return p; },
    installTrack: async (folder, files) => { n.installs.push({ folder, files: files.map((f) => f.path) }); return files.length; },
    getSeeItSetting: async () => n.setting,
    setSeeItSetting: async (on) => { n.setting = on; },
    seeIt: async (folder, layout) => { n.launches.push({ folder, layout }); return 0; },
  });
  return n;
}
function stadium(name) {
  let d = D.createDoc(name);
  for (const [w, o] of [['straight', { handles: { length: 600 } }], ['tight', { font: 'flat' }], ['tight', { font: 'flat' }], ['straight', { handles: { length: 600 } }], ['tight', { font: 'flat' }], ['tight', { font: 'flat' }]]) d = D.appendWord(d, w, { ...o, speed: 200 / 3.6 });
  return D.checkDoc({ ...d, closed: true });
}

test('Install to AC asks for the AC folder once, remembers it, and installs as t180b_<name>, saying so', async () => {
  const native = fakeNative(), exporter = await makeExporter(get), doc = stadium('Monza');
  const inst = createInstaller({ exporter, native, getDoc: () => doc });
  const first = await inst.install();
  assert.deepStrictEqual([first.ok, first.needsRoot, native.installs.length], [false, true, 0]);
  assert.match((await inst.chooseRoot('C:/somewhere/else')).message, /no content/);
  assert.strictEqual((await inst.chooseRoot('G:/games/assettocorsa')).ok, true);
  const r = await inst.install();
  assert.strictEqual(r.ok, true, r.message);
  assert.strictEqual(native.installs[0].folder, 't180b_monza');
  assert.match(r.message, /as t180b_monza .*never overwrite a track it did not make/);
  assert.ok(native.installs[0].files.includes('t180b_monza.kn5') && native.installs[0].files.includes('.t180b-builder.json'));
  assert.strictEqual(await inst.root(), 'G:/games/assettocorsa', 'remembered');
});

test('See it in Assetto is OFF by default: the native launch is never asked for while it is off', async () => {
  const native = fakeNative(), see = createLauncher({ native });
  assert.strictEqual(await see.enabled(), false);
  const r = await see.run('t180b_monza');
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /is off: it launches the game/);
  assert.deepStrictEqual(native.launches, []);
});

test('the share and install panels load through the webview loader and export mount', async () => {
  for (const p of ['app/share/index.js', 'app/install/index.js']) assert.strictEqual(typeof (await loadCjs(p, get)).mount, 'function', p);
});
