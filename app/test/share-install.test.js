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

test('D250: a jump the car may fly past is INSTALLED, and the message says so in plain words; the export\'s other warnings stay out of it', async () => {
  const native = fakeNative(); native.root = 'G:/games/assettocorsa';
  const jumpLine = "jump: this jump may fly past its landing at the lap's speed, at s 300–340 m (the 3.2 g fall misses); tune it by driving it in AC";
  const build = () => ({ result: { warnings: ['amber: roll-rate at s 1.0–2.0 m', jumpLine] }, folders: [{ folder: 't180b_jumps', files: [{ path: 'a', bytes: new Uint8Array(1) }] }] });
  const r = await createInstaller({ build, native, getDoc: () => ({ ...D.createDoc('x'), name: 'Jumps' }), getTextures: () => null }).install();
  assert.strictEqual(r.ok, true, r.message); assert.strictEqual(native.installs.length, 1, 'it is installed');
  assert.ok(r.message.includes(jumpLine), r.message); assert.ok(!r.message.includes('roll-rate'), 'only the jump warnings ride in the install message');
  assert.ok(r.message.includes('exporting this track again updates that folder'), 'the jump line rides AFTER the export line, which is kept whole');
  const plain = await createInstaller({ build: () => ({ result: { warnings: [] }, folders: [{ folder: 't180b_x', files: [{ path: 'a', bytes: new Uint8Array(1) }] }] }), native, getDoc: () => ({ ...D.createDoc('x'), name: 'X' }), getTextures: () => null }).install();
  assert.ok(!/jump:/.test(plain.message), 'control: no jump, no jump line');
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

// D250 amended this row BY NAME: the keeper asked for an obvious "export into AC" beside Export, so the button is "Export to Assetto Corsa" (was "Install to AC")
test('the Export to Assetto Corsa button installs the track under the name it was saved as', async () => {
  const fake = require('./palette-fakedom.js'), { mount } = require('../install/index.js');
  const restore = fake.install();
  try {
    const native = fakeNative(); native.root = 'G:/games/assettocorsa';
    const s = await lap({ closed: true, exporter: await makeExporter(get) }); await s.save('Monza');
    const root = new fake.Element('div');
    mount(root, s, { native, pickFolder: async () => null, getTextures: () => null });
    const button = [...root.walk()].find((e) => e.tagName === 'BUTTON' && e.textContent === 'Export to Assetto Corsa');
    await button.onclick();
    assert.deepStrictEqual(native.installs.map((i) => i.folder), ['t180b_monza']);
  } finally { restore(); }
});

// D250 (the keeper: "it should automatically create the folder in the assetto track folder in steam"): the native side finds AC through Steam
// when none is remembered (src-tauri/src/ac.rs root_or_find), so get_ac_root answers with a folder and the picker is never opened
test('D250: with AC found through Steam the button exports with NO folder dialog, and the line says where it went and that exporting again updates it', async () => {
  const fake = require('./palette-fakedom.js'), { mount } = require('../install/index.js');
  const restore = fake.install();
  try {
    const native = fakeNative(); native.root = 'G:/SteamLibrary/steamapps/common/assettocorsa';   // what root_or_find returns once found
    const s = await lap({ closed: true, exporter: await makeExporter(get) }); await s.save('Monza');
    const root = new fake.Element('div'), asked = [];
    mount(root, s, { native, pickFolder: async (why) => { asked.push(why); return null; }, getTextures: () => null });
    await [...root.walk()].find((e) => e.tagName === 'BUTTON' && e.textContent === 'Export to Assetto Corsa').onclick();
    assert.deepStrictEqual([asked.length, native.installs.map((i) => i.folder)], [0, ['t180b_monza']]);
    const said = [...root.walk()].find((e) => e.className === 't-install-note').textContent;
    assert.ok(said.includes('G:/SteamLibrary/steamapps/common/assettocorsa\\content\\tracks\\t180b_monza'), said);
    assert.match(said, /exporting this track again updates that folder/);
  } finally { restore(); }
});

test('D250: when AC is NOT found through Steam, the line says so and asks for the folder (the picker, as before)', async () => {
  const native = fakeNative(), s = await lap({ closed: true, exporter: await makeExporter(get) }); await s.save('Monza');
  const r = await installerFor(s, native).install();
  assert.deepStrictEqual([r.ok, r.needsRoot], [false, true]); assert.match(r.message, /not found through Steam/);
});

// D264 AMENDED THIS ROW BY NAME (the keeper, 01:34: "it still says the loop is not closed: close it first (one click), then export when i am trying to export the
// test that isnt finished"). It was "an open loop is not installed: the refusal is the Export button's own, and nothing is written". Export to Assetto Corsa on an
// OPEN track now installs the TEST export (D243a's own build, t180b_<name>_test) and says so; Export… (any folder) still refuses the open loop (app/test/core-shell.test.js).
test('D264: an open loop is installed as the unfinished TEST export, t180b_<name>_test, and the line says so; never as t180b_<name>', async () => {
  const native = fakeNative(); native.root = 'G:/games/assettocorsa';
  const s = await lap({ exporter: await makeExporter(get) }); await s.save('Monza');
  const r = await installerFor(s, native).install();
  assert.strictEqual(r.ok, true, r.message);
  assert.deepStrictEqual(native.installs.map((i) => i.folder), ['t180b_monza_test']);
  assert.ok(native.installs[0].files.includes('t180b_TEST_UNFINISHED.txt'), 'the folder says it is unfinished');
  assert.match(r.message, /this track is not closed, so it was exported as an unfinished TEST: the road ends in a run-off and a wall; reds are listed as warnings/);
  assert.ok(r.message.includes('G:/games/assettocorsa\\content\\tracks\\t180b_monza_test'), r.message);
});

// D252 second item (the keeper, 11:38: "why two export buttons"; 11:39: "it shouldnt be there, creates too much clutter, the AC folder, instead, in the EXE
// startup, the user can choose where the track folder is in the beginning"). ONE main button, Export to Assetto Corsa; the AC folder and See it in Assetto
// go into the "more" (⋯) container; at startup, with no folder remembered, a one-time card offers the folder Steam found (Use it / Choose another…).
function mountIn(native, pickFolder = async () => null) {
  const fake = require('./palette-fakedom.js'), { mount } = require('../install/index.js'), restore = fake.install();
  const root = new fake.Element('div'), more = new fake.Element('div');
  const m = mount(root, { buildExport: () => { throw new Error('not built here'); }, exportDoc: () => D.createDoc('x') }, { native, pickFolder, getTextures: () => null, more });
  return { root, more, m, restore, buttons: (el) => [...el.walk()].filter((e) => e.tagName === 'BUTTON').map((e) => e.textContent), button: (el, t) => [...el.walk()].find((e) => e.tagName === 'BUTTON' && e.textContent === t), note: () => [...root.walk()].find((e) => e.className === 't-install-note').textContent };
}
test('D252: ONE button on the main row, Export to Assetto Corsa; the AC folder and See it in Assetto are in the more menu; there is no "AC folder…" button', async () => {
  const native = fakeNative(); native.findAcRoot = async () => ({ remembered: 'G:/games/assettocorsa', found: null });
  const x = mountIn(native);
  try {
    assert.deepStrictEqual(x.buttons(x.root), ['Export to Assetto Corsa']);
    assert.deepStrictEqual(x.buttons(x.more), ['Assetto Corsa folder…', 'See it in Assetto']);
    assert.ok(![...x.root.walk(), ...x.more.walk()].some((e) => /AC folder…/.test(e.textContent || '')), 'the old button is gone');
    assert.ok([...x.more.walk()].some((e) => e.tagName === 'INPUT' && e.type === 'checkbox'), 'the launch setting moved with it');
  } finally { x.restore(); }
});
test('D252: at startup with NO folder remembered, a card offers the folder Steam found; Use it remembers exactly that one', async () => {
  const native = fakeNative(); native.findAcRoot = async () => ({ remembered: null, found: 'G:/SteamLibrary/steamapps/common/assettocorsa' });
  const x = mountIn(native);
  try {
    await x.m.card;
    assert.match(x.note(), /Assetto Corsa found at G:\/SteamLibrary\/steamapps\/common\/assettocorsa \(through Steam\)/);
    assert.deepStrictEqual(x.buttons(x.root), ['Export to Assetto Corsa', 'Use it', 'Choose another…']);
    await x.button(x.root, 'Use it').onclick();
    assert.strictEqual(native.root, 'G:/SteamLibrary/steamapps/common/assettocorsa', 'remembered');
    assert.deepStrictEqual(x.buttons(x.root), ['Export to Assetto Corsa'], 'the card is gone');
  } finally { x.restore(); }
});
test('D252: the card\'s Choose another… opens the picker and remembers the folder picked; with Steam finding nothing the card asks to pick', async () => {
  const native = fakeNative(), asked = []; native.findAcRoot = async () => ({ remembered: null, found: 'G:/SteamLibrary/steamapps/common/assettocorsa' });
  const x = mountIn(native, async (why) => { asked.push(why); return 'D:/Games/assettocorsa'; });
  try {
    await x.m.card; await x.button(x.root, 'Choose another…').onclick();
    assert.deepStrictEqual([asked.length, native.root], [1, 'D:/Games/assettocorsa']);
  } finally { x.restore(); }
  const n2 = fakeNative(); n2.findAcRoot = async () => ({ remembered: null, found: null });
  const y = mountIn(n2);
  try {
    await y.m.card;
    assert.match(y.note(), /not found through Steam/); assert.deepStrictEqual(y.buttons(y.root), ['Export to Assetto Corsa', 'Choose…']);
  } finally { y.restore(); }
});
test('D252: with a folder remembered the startup says nothing (no card)', async () => {
  const native = fakeNative(); native.findAcRoot = async () => ({ remembered: 'G:/games/assettocorsa', found: null });
  const x = mountIn(native);
  try { await x.m.card; assert.strictEqual(x.note(), ''); assert.deepStrictEqual(x.buttons(x.root), ['Export to Assetto Corsa']); } finally { x.restore(); }
});

// C's findings 1 and 2 (p-spacefly-C_2026-10-06.md): the card stayed up after Export had found and remembered AC; a long install note pushed the open ⋯ menu
// off the window's right edge
test('D252 follow-up: once Export to Assetto Corsa has found and remembered AC, the startup card goes', async () => {
  const fake = require('./palette-fakedom.js'), { mount } = require('../install/index.js'), restore = fake.install();
  try {
    const native = fakeNative(), found = 'G:/SteamLibrary/steamapps/common/assettocorsa';
    native.findAcRoot = async () => ({ remembered: native.root, found: native.root ? null : found });
    native.getAcRoot = async () => { if (!native.root) native.root = found; return native.root; };   // get_ac_root finds and remembers (ac.rs root_or_find)
    const shell = { buildExport: () => ({ result: { warnings: [] }, folders: [{ folder: 't180b_x', files: [{ path: 'a', bytes: new Uint8Array(1) }] }] }), exportDoc: () => ({ ...D.createDoc('x'), name: 'X' }) };
    const root = new fake.Element('div'), more = new fake.Element('div'), card = new fake.Element('div');
    const m = mount(root, shell, { native, pickFolder: async () => null, getTextures: () => null, more, card });
    await m.card; assert.match(card.textContent, /Assetto Corsa found at/, 'control: the card is up');
    await [...root.walk()].find((e) => e.tagName === 'BUTTON' && e.textContent === 'Export to Assetto Corsa').onclick();
    assert.strictEqual(native.root, found, 'Export found and remembered it'); assert.strictEqual(card.textContent, '', 'and the card is gone');
  } finally { restore(); }
});
test('D252 follow-up: a long install note is cut to its box with the whole text in its tooltip, and the ⋯ menu opens toward the window (right-aligned)', async () => {
  const fake = require('./palette-fakedom.js'), { mount } = require('../install/index.js'), restore = fake.install();
  try {
    const native = fakeNative(); native.root = 'G:/' + 'a-very-long-folder-name/'.repeat(6) + 'assettocorsa';
    const shell = { buildExport: () => ({ result: { warnings: [] }, folders: [{ folder: 't180b_x', files: [{ path: 'a', bytes: new Uint8Array(1) }] }] }), exportDoc: () => ({ ...D.createDoc('x'), name: 'X' }) };
    const root = new fake.Element('div'); mount(root, shell, { native, pickFolder: async () => null, getTextures: () => null, more: new fake.Element('div') });
    await [...root.walk()].find((e) => e.tagName === 'BUTTON' && e.textContent === 'Export to Assetto Corsa').onclick();
    const note = [...root.walk()].find((e) => e.className === 't-install-note');
    assert.ok(note.textContent.length > 150, 'control: a long note'); assert.strictEqual(note.title, note.textContent, 'its whole text is the tooltip');
  } finally { restore(); }
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const rule = (sel) => { const m = new RegExp(sel.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}').exec(html); return m ? m[1] : ''; };
  assert.match(rule('.more-menu'), /right:\s*0/, 'the menu hangs from its button\'s RIGHT edge, so it opens toward the window'); assert.doesNotMatch(rule('.more-menu'), /left:\s*0/);
  assert.match(rule('.t-install-note'), /max-width/); assert.match(rule('.t-install-note'), /text-overflow:\s*ellipsis/);
});

// D264 (the keeper, 01:34; plan_t180_open_export_ac_2026-10-07.md): Export to Assetto Corsa on an OPEN track writes the TEST export into AC instead of refusing,
// and ⋯ → Test export (unfinished)… goes into AC by the same path (the folder picker only if AC is not known). A closed track exports as before.
// The native install here WRITES into a temp AC tree, so what lands on disk is read back; the native guards themselves are ac.rs's (cargo test, D264 row).
const os = require('os');
function diskNative() {
  const ac = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-d264-')), tracks = path.join(ac, 'assettocorsa', 'content', 'tracks'); fs.mkdirSync(tracks, { recursive: true });
  const n = fakeNative(); n.root = path.join(ac, 'assettocorsa');
  n.installTrack = async (folder, files) => {
    if (!/^t180b_/.test(folder)) throw new Error(`${folder} is not a folder the builder makes`);
    for (const f of files) { const p = path.join(tracks, folder, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(f.bytes)); }
    n.installs.push({ folder, files: files.map((x) => x.path) }); return files.length;
  };
  return { n, tracks, done: () => fs.rmSync(ac, { recursive: true, force: true }) };
}
function mountReal(s, native, pickFolder = async () => null) {
  const fake = require('./palette-fakedom.js'), { mount } = require('../install/index.js'), restore = fake.install();
  const root = new fake.Element('div'), more = new fake.Element('div'), testButton = new fake.Element('button'); testButton.textContent = 'Test export (unfinished)…'; more.append(testButton);
  mount(root, s, { native, pickFolder, getTextures: () => null, more, testButton });
  return { restore, testButton, main: [...root.walk()].find((e) => e.tagName === 'BUTTON' && e.textContent === 'Export to Assetto Corsa'), note: () => [...root.walk()].find((e) => e.className === 't-install-note').textContent };
}
test('D264: Export to Assetto Corsa on an OPEN track writes t180b_<name>_test into the AC tree and says it is an unfinished TEST; a closed track still writes t180b_<name>', async () => {
  const d = diskNative();
  try {
    const open = await lap({ exporter: await makeExporter(get) }); await open.save('Monza');
    assert.equal(open.getState().history.present.closed, false, 'control: the lap is open');
    const x = mountReal(open, d.n);
    try { await x.main.onclick(); } finally { x.restore(); }
    assert.deepStrictEqual(fs.readdirSync(d.tracks), ['t180b_monza_test'], x.note());
    assert.ok(fs.existsSync(path.join(d.tracks, 't180b_monza_test', 't180b_TEST_UNFINISHED.txt')), 'the folder says it is unfinished');
    assert.ok(fs.existsSync(path.join(d.tracks, 't180b_monza_test', 'ai', 'fast_lane.ai')));
    assert.match(x.note(), /this track is not closed, so it was exported as an unfinished TEST: the road ends in a run-off and a wall; reds are listed as warnings/);
    const closed = await lap({ closed: true, exporter: await makeExporter(get) }); await closed.save('Monza');
    const y = mountReal(closed, d.n);
    try { await y.main.onclick(); } finally { y.restore(); }
    assert.deepStrictEqual(fs.readdirSync(d.tracks).sort(), ['t180b_monza', 't180b_monza_test']);
    assert.ok(!fs.existsSync(path.join(d.tracks, 't180b_monza', 't180b_TEST_UNFINISHED.txt')), 'a closed track is the real export');
    assert.ok(!/TEST/.test(y.note()), y.note());
  } finally { d.done(); }
});
test('D264: ⋯ Test export (unfinished)… goes into AC by the same path, with no folder dialog when AC is known; only when it is not does it ask for the AC folder', async () => {
  const d = diskNative();
  try {
    const s = await lap({ exporter: await makeExporter(get) }); await s.save('Monza');
    const asked = [], x = mountReal(s, d.n, async (why) => { asked.push(why); return null; });
    try { await x.testButton.onclick(); } finally { x.restore(); }
    assert.deepStrictEqual([asked.length, fs.readdirSync(d.tracks)], [0, ['t180b_monza_test']], x.note());
    assert.match(x.note(), /unfinished TEST/);
    const root = d.n.root; d.n.root = null;
    const y = mountReal(s, d.n, async (why) => { asked.push(why); return root; });
    try { await y.testButton.onclick(); } finally { y.restore(); }
    assert.strictEqual(asked.length, 1, 'AC not known: the AC folder picker, once'); assert.match(asked[0], /Assetto Corsa folder/);
    assert.strictEqual(d.n.root, root, 'remembered'); assert.deepStrictEqual(d.n.installs.map((i) => i.folder), ['t180b_monza_test', 't180b_monza_test']);
  } finally { d.done(); }
});
test('D264: the guards hold: ⋯ Test export on a CLOSED track is refused by name and nothing is written; an unnamed open track is not installed', async () => {
  const d = diskNative();
  try {
    const closed = await lap({ closed: true, exporter: await makeExporter(get) }); await closed.save('Monza');
    const x = mountReal(closed, d.n);
    try { await x.testButton.onclick(); } finally { x.restore(); }
    assert.match(x.note(), /this track is closed/); assert.deepStrictEqual(fs.readdirSync(d.tracks), []);
    for (const name of ['', 'untitled']) {
      const open = await lap({ exporter: await makeExporter(get) });
      const r = await createInstaller({ build: (o) => open.buildExport(o), native: d.n, getDoc: () => ({ ...open.exportDoc(), name }) }).install();
      assert.deepStrictEqual([r.ok, fs.readdirSync(d.tracks)], [false, []], name); assert.match(r.message, /name the track/);
    }
  } finally { d.done(); }
});
