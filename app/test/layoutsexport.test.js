// layoutsexport.test.js: node --test app/test/layoutsexport.test.js. File ▸ Export layouts… (D361 part 2) from two SAVED
// equation tracks (src/core/document.js, as the app saves them) to one AC track folder: the exporter is loaded the way the
// webview loads it (app/lib/cjs.js with the node shim), each layout's kn5 is the Export button's bytes for that track, and the
// folder reads back in Content Manager's way (test/cm_layouts.js). Nothing is written outside a temp folder.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../core/coreshell.js');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { close } = require('../../src/core/close.js');
const { loadCjs } = require('../lib/cjs.js');
const { createShim } = require('../export/node-shim.js');
const { makeExporter } = require('../export/export.js');
const { createLayoutsExport, exportLayoutsFlow } = require('../menubar/layoutsexport.js');
const { cmLayouts } = require('../../test/cm_layouts.js');

const REPO = path.resolve(__dirname, '..', '..'), get = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const R = 180, Q = (Math.PI * R) / 2, TURN = 1 / R;
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-lx-')); made.push(d); return d; };

/** A closed lap of the core's own pieces (as app/test/core-pieces-ui.test.js lap()), its first straight `straight` m long. */
function lap(name, straight) {
  let d = extend(D.createDoc(name), { length: straight, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: TURN } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
/** The native side's track storage, in memory: eq-<name> -> text, as save_track keeps it. */
function store(tracks) {
  const docs = new Map(Object.entries(tracks).map(([n, d]) => [`eq-${n}`, D.serialize(d)]));
  return { docs, writes: [], listDocs: async () => [...docs.keys()].sort(), openDoc: async (n) => { if (!docs.has(n)) throw new Error(`could not read ${n}: not found`); return docs.get(n); } };
}
const TRACKS = { 'Elysium': lap('Elysium', 300), 'Elysium Short': lap('Elysium Short', 200) };
async function lxFor(st) {
  const shim = createShim();
  const layouts = await loadCjs('src/export/layouts.js', get, { builtins: shim.builtins, globals: { Buffer: shim.Buffer } });
  return createLayoutsExport({ C, layouts, shim, storage: st });
}
const PICKS = [{ track: 'Elysium', layout: 'long', name: 'Elysium Long', main: true }, { track: 'Elysium Short', layout: 'short', name: 'Elysium Short', main: false }];
/** The Export button's kn5 for one saved track: its own shell, the real exporter, the same road surface (none). */
async function buttonKn5(st, track) {
  const sh = await C.createCoreShell({ storage: { openDoc: st.openDoc, listDocs: st.listDocs }, exporter: await makeExporter(get), autosaveMs: 0 });
  await sh.open(track);
  const f = sh.buildExport({}).folders[0];
  return Buffer.from(f.files.find((x) => x.path.endsWith('.kn5')).bytes);
}
const writeOut = (dir, folder, files) => { for (const f of files) { const p = path.join(dir, folder, ...f.path.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(f.bytes)); } };

test('two saved tracks export to Aurora\'s folder shape, each layout\'s kn5 the Export button\'s bytes for that track', async () => {
  const st = store(TRACKS), lx = await lxFor(st);
  const out = await lx.build(PICKS, { name: 'Elysium' });
  assert.equal(out.folder, 't180b_elysium');
  const paths = out.files.map((f) => f.path).sort();
  const want = ['.t180b-builder.json', 'models_long.ini', 'models_short.ini', 't180b_elysium_long.kn5', 't180b_elysium_short.kn5',
    ...['long', 'short'].flatMap((L) => [`${L}/ai/fast_lane.ai`, `${L}/data/map.ini`, `${L}/data/surfaces.ini`, `${L}/map.png`, `ui/${L}/outline.png`, `ui/${L}/preview.png`, `ui/${L}/ui_track.json`])].sort();
  assert.deepEqual(paths, want, 'Aurora\'s shape: per layout a kn5, a models file, data, ai, map and ui; nothing else at the root, no extension/ per layout');
  for (const [L, track] of [['long', 'Elysium'], ['short', 'Elysium Short']]) {
    const kn5 = Buffer.from(out.files.find((f) => f.path === `t180b_elysium_${L}.kn5`).bytes);
    assert.ok(kn5.equals(await buttonKn5(st, track)), `${L}: the whole road kn5 the Export button writes for "${track}"`);
  }
  assert.notDeepEqual(out.files.find((f) => f.path === 't180b_elysium_long.kn5').bytes, out.files.find((f) => f.path === 't180b_elysium_short.kn5').bytes);
});

test('Content Manager finds both layouts in the written folder, by their shown names, with the marked one as main', async () => {
  const st = store(TRACKS), lx = await lxFor(st), dir = tmp();
  // "short" is main; "long" has no CM-preferred word, so this also checks that priority, not the order, decides
  const out = await lx.build([{ ...PICKS[0], main: false }, { ...PICKS[1], main: true }], { name: 'Elysium' });
  writeOut(dir, out.folder, out.files);
  const cm = cmLayouts(path.join(dir, out.folder));
  assert.deepEqual(cm.layouts, ['long', 'short']);
  assert.deepEqual(cm.names, { long: 'Elysium Long', short: 'Elysium Short' });
  assert.equal(cm.main, 'short');
  const pr = (L) => JSON.parse(Buffer.from(out.files.find((f) => f.path === `ui/${L}/ui_track.json`).bytes).toString('utf8')).priority;
  assert.ok(pr('short') > pr('long'));
});

test('a saved track that is not there, or not closed, is refused by name and nothing is built', async () => {
  const open = lap('Open One', 300); const st = store({ ...TRACKS, 'Open One': { ...open, closed: false } }), lx = await lxFor(st);
  await assert.rejects(lx.build([PICKS[0], { track: 'Gone', layout: 'gone', name: 'Gone', main: false }], { name: 'Elysium' }), (e) => e.code === 'OPEN_FAILED' && /"Gone"/.test(e.message));
  await assert.rejects(lx.build([PICKS[0], { track: 'Open One', layout: 'open', name: 'Open', main: false }], { name: 'Elysium' }), (e) => /Open One: .*OPEN_LOOP|Open One: .*not closed/.test(e.message));
  await assert.rejects(lx.build([PICKS[0]], { name: 'Elysium' }), (e) => e.code === 'TOO_FEW_LAYOUTS');
});

test('the menu item: asks, picks a folder through the Export button\'s guard, writes through write_layouts_export, and says so', async () => {
  const st = store(TRACKS), lx = await lxFor(st), exporter = await makeExporter(get), said = [];
  const shell = await C.createCoreShell({ storage: st, autosaveMs: 0 });
  st.writeLayouts = async (dir, folder, files) => { st.writes.push({ dir, folder, n: files.length }); return { written: files.length, removed: ['models_old.ini'] }; };
  const run = (over) => exportLayoutsFlow({ lx, shell, ask: async () => ({ name: 'Elysium', picks: PICKS }), pickFolder: async () => 'D:\\exports', exporter, storage: st, say: (t) => said.push(t), ...over });
  await run();
  assert.equal(st.writes.length, 1); assert.equal(st.writes[0].folder, 't180b_elysium'); assert.equal(st.writes[0].dir, 'D:\\exports');
  assert.match(said.at(-1), /^exported t180b_elysium to D:\\exports: 2 layouts \(long, short\), main long · removed 1 file/);
  await run({ ask: async () => null }); assert.match(said.at(-1), /cancelled, nothing written/);
  await run({ pickFolder: async () => null }); assert.match(said.at(-1), /no folder picked/);
  await run({ pickFolder: async () => 'G:\\ac\\content\\tracks\\ks_silverstone' }); assert.match(said.at(-1), /^not exported: .*another track's folder/);
  assert.equal(st.writes.length, 1, 'no refusal wrote anything');
  const one = store({ Elysium: TRACKS.Elysium }); one.writeLayouts = st.writeLayouts;
  await exportLayoutsFlow({ lx, shell: await C.createCoreShell({ storage: one, autosaveMs: 0 }), ask: async () => { throw new Error('must not ask'); }, pickFolder: null, exporter, storage: one, say: (t) => said.push(t) });
  assert.match(said.at(-1), /needs at least two saved tracks/);
});
