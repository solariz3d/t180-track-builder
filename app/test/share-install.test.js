// Headless tests for app/share and app/install (D176; D239: on the EQUATION track, the core shell app/core/coreshell.js, since the
// Pieces page is removed): codes through the real core shell; install and the launch button through a fake native side (the native
// guards themselves are src-tauri/src/ac.rs's tests, on a temp fake AC tree). The launch is NEVER run: the native seeIt here is a
// recorder, and the test asserts it is not called while the setting is off. Run: node --test "app/test/*.test.js"
// RETIRED D239, by name (each was the piece builder's): 'a piece code joins the palette; a pack code goes to the textures panel' (a piece
// code is now refused by name, app/test/core-eqonly.test.js; the pack half is kept below as its own test).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createCoreShell } = require('../core/coreshell.js');
const { loadCjs } = require('../lib/cjs.js');
const { createShare } = require('../share/share.js');
const { createInstaller, createLauncher } = require('../install/install.js');
const { makeExporter } = require('../export/export.js');
const D = require('../../src/core/document.js');
const C = require('../../src/doc/code.js');
const P = require('../../src/doc/packs.js');
const T = require('../../src/texture/index.js');

const REPO = path.resolve(__dirname, '..', '..');
const get = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const mem = () => { const docs = new Map(); return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()] }; };
const clip = () => { let v = ''; return { writeText: async (t) => { v = t; }, read: () => v }; };
const R = 180, Q = Math.PI * R / 2;
/** The plain bowl lap of app/test/core-shell.test.js: a 300 m straight, four quarter turns, a straightening; closed when asked. */
async function lap({ closed = false, ...opts } = {}) {
  const s = await createCoreShell({ brushFn: null, storage: mem(), ...opts });
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  if (closed) { s.close(); assert.equal(s.getState().history.present.closed, true, s.getState().message); }
  return s;
}
const text = (s) => D.serialize(s.getState().history.present);

test('Copy code puts the track on the clipboard; Paste code opens it in another session byte-exact, as one undo step', async () => {
  const a = await lap();
  const cb = clip(), code = await createShare(a, { clipboard: cb }).copyTrack();
  assert.strictEqual(cb.read(), code);
  const b = await createCoreShell({ brushFn: null }); b.extend({ length: 120 });
  const before = text(b);
  const r = await createShare(b).paste(`  ${code}\n`);
  assert.strictEqual(r.kind, 'e', r.message);
  assert.strictEqual(text(b), text(a));
  b.undo(); assert.strictEqual(text(b), before);
});

test('a corrupted code changes nothing and says why', async () => {
  const a = await lap();
  const code = await createShare(a).copyTrack(), broken = code.slice(0, code.length - 20) + code.slice(-12);
  const b = await createCoreShell({ brushFn: null }); b.extend({ length: 120 });
  const before = text(b), pastBefore = b.getState().history.past.length;
  const r = await createShare(b).paste(broken);
  assert.match(r.message, /CODE_(CORRUPT|MALFORMED)/);
  assert.deepStrictEqual([text(b), b.getState().history.past.length], [before, pastBefore]);
});

test('a pack code goes to the textures panel\'s onPack; without one it changes nothing and says so', async () => {
  const b = await createCoreShell({ brushFn: null });
  const png = T.png.encodePng({ width: 4, height: 4, rgba: new Uint8Array(64).fill(200) }, zlib.deflateSync);
  const kc = C.packToCode(P.makePack({ name: 'K', font: 'flat', slots: { floor: { texture: 'g' } }, images: { g: { bytes: png } } }));
  let got = null;
  const r = await createShare(b, { onPack: (t) => { got = t; return {}; } }).paste(kc);
  assert.deepStrictEqual([r.kind, P.parsePack(got).name], ['k', 'K']);
  const before = text(b), r2 = await createShare(b).paste(kc);
  assert.deepStrictEqual([r2.kind, text(b)], ['k', before]);
  assert.match(r2.message, /does not import texture packs/);
});

/** A fake native side: remembers a root, records every install (paths and bytes) and every launch request. */
function fakeNative({ seeIt = false } = {}) {
  const n = { root: null, installs: [], launches: [], setting: seeIt };
  Object.assign(n, {
    getAcRoot: async () => n.root,
    setAcRoot: async (p) => { if (!/assettocorsa$/.test(p)) throw new Error(`${p} has no content\\tracks`); n.root = p; return p; },
    installTrack: async (folder, files) => { n.installs.push({ folder, files: files.map((f) => f.path), bytes: files.map((f) => Buffer.from(f.bytes)) }); return files.length; },
    getSeeItSetting: async () => n.setting,
    setSeeItSetting: async (on) => { n.setting = on; },
    seeIt: async (folder, layout) => { n.launches.push({ folder, layout }); return 0; },
  });
  return n;
}
const installerFor = (s, native, getTextures) => createInstaller({ build: (o) => s.buildExport(o), native, getDoc: () => s.exportDoc(), getTextures });

test('Install to AC asks for the AC folder once, remembers it, and installs as t180b_<name>, saying so', async () => {
  const native = fakeNative(), s = await lap({ closed: true, exporter: await makeExporter(get) }); await s.save('Monza');
  const inst = installerFor(s, native);
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

test('Install to AC hands the build the texture set the page holds, as Export does', async () => {
  const native = fakeNative(); native.root = 'G:/games/assettocorsa';
  let seen = null;
  const build = (opts) => { seen = opts; return { result: {}, folders: [{ folder: 't180b_x', files: [{ path: 'a', bytes: new Uint8Array(1) }] }] }; };
  const inst = createInstaller({ build, native, getDoc: () => D.createDoc('x'), getTextures: () => 'THE-SET' });
  assert.strictEqual((await inst.install()).ok, true);
  assert.deepStrictEqual(seen, { textures: 'THE-SET' });
});

test('an unnamed track is not installed: the user is asked to name it, and nothing is written', async () => {
  const native = fakeNative(); native.root = 'G:/games/assettocorsa';
  const exporter = await makeExporter(get);
  for (const name of ['', 'untitled', ' Untitled ']) {
    const s = await lap({ closed: true, exporter });
    const r = await createInstaller({ build: (o) => s.buildExport(o), native, getDoc: () => ({ ...s.exportDoc(), name }) }).install();
    assert.deepStrictEqual([r.ok, native.installs.length], [false, 0], name);
    assert.match(r.message, /name the track/, name);
  }
});

test('a track saved as "Monza" installs as t180b_monza, so a second unsaved track cannot replace it', async () => {
  const native = fakeNative(); native.root = 'G:/games/assettocorsa';
  const s = await lap({ closed: true, exporter: await makeExporter(get) }); await s.save('Monza');
  const r = await installerFor(s, native).install();
  assert.strictEqual(r.ok, true, r.message);
  assert.strictEqual(native.installs[0].folder, 't180b_monza');
});

test('no tooltip on the page carries a tab or a line break (the install one said "content<TAB>racks")', () => {
  const titles = [...fs.readFileSync(path.join(REPO, 'app/index.html'), 'utf8').matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(titles.filter((t) => /[\t\r\n]/.test(t)), []);
});

test('the Install to AC button installs the track under the name it was saved as', async () => {
  const fake = require('./palette-fakedom.js'), { mount } = require('../install/index.js');
  const restore = fake.install();
  try {
    const native = fakeNative(); native.root = 'G:/games/assettocorsa';
    const s = await lap({ closed: true, exporter: await makeExporter(get) }); await s.save('Monza');
    const root = new fake.Element('div');
    mount(root, s, { native, pickFolder: async () => null, getTextures: () => null });
    const button = [...root.walk()].find((e) => e.tagName === 'BUTTON' && e.textContent === 'Install to AC');
    await button.onclick();
    assert.deepStrictEqual(native.installs.map((i) => i.folder), ['t180b_monza']);
  } finally { restore(); }
});

test('an open loop is not installed: the refusal is the Export button\'s own, and nothing is written', async () => {
  const native = fakeNative(); native.root = 'G:/games/assettocorsa';
  const s = await lap({ exporter: await makeExporter(get) }); await s.save('Monza');
  const r = await installerFor(s, native).install();
  assert.deepStrictEqual([r.ok, native.installs.length], [false, 0]);
  assert.match(r.message, /the loop is not closed: close it first/);
});
