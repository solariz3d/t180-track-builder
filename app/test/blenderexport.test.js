// blenderexport.test.js: node --test app/test/blenderexport.test.js. File ▸ Export for Blender… (app/menubar/blenderexport.js): the exporter
// loaded the way the webview loads it (app/lib/cjs.js with the node shim); the .glb's meshes are the Export button's kn5 meshes; an open track
// and a selection export; the flow writes the files into a temp folder, and where Blender is installed its .fbx holds the kn5's names.
// The native write is stood in for by a plain folder write plus the same Blender command line (src/export/blender.js fbxArgs); the native
// side's own guards are tested in src-tauri/src/blender.rs. Nothing is written outside temp folders.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const C = require('../core/coreshell.js');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { close } = require('../../src/core/close.js');
const { loadCjs } = require('../lib/cjs.js');
const { createShim } = require('../export/node-shim.js');
const { makeExporter } = require('../export/export.js');
const { createBlenderExport, askBlender, exportBlenderFlow } = require('../menubar/blenderexport.js');
const BL = require('../../src/export/blender.js');
const { readGlb } = require('../../test/glb_read.js');
const { readFbx } = require('../../test/fbx_read.js');
const { readKn5 } = require('../../tools/kn5.cjs');

const REPO = path.resolve(__dirname, '..', '..'), get = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const BLENDER = process.env.T180_BLENDER || 'C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe';
const SCRIPT = path.join(REPO, 'src', 'export', 'blender_fbx.py');
const R = 180, Q = (Math.PI * R) / 2, TURN = 1 / R;
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-bx-')); made.push(d); return d; };

function lap(name) {
  let d = extend(D.createDoc(name), { length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: TURN } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
function openRun(name) {
  let d = extend(D.createDoc(name), { length: 300, family: 'bowl' });
  return extend(d, { length: Q, transition: 40, targets: { kh: TURN } });
}
const noStorage = { openDoc: async () => { throw new Error('none'); }, listDocs: async () => [] };
async function shellWith(d) { const sh = await C.createCoreShell({ storage: noStorage, exporter: await makeExporter(get), autosaveMs: 0 }); sh.adopt(d); return sh; }
async function bxLoaded() {
  const shim = createShim();
  const opt = { builtins: shim.builtins, globals: { Buffer: shim.Buffer } };
  return createBlenderExport({ layouts: await loadCjs('src/export/layouts.js', get, opt), blender: await loadCjs('src/export/blender.js', get, opt) });
}
const nodeNames = (glb) => readGlb(glb).json.nodes.map((n) => n.name);
/** The native write, stood in for: the files into dir/folder, then (fbx) the user's Blender with the bundled script. */
function writeLikeNative(dir, folder, files, fbx) {
  const t = path.join(dir, folder); fs.mkdirSync(t, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(t, f.path), Buffer.from(f.bytes));
  const w = { folder: t, written: files.length, fbx: null, fbx_error: null };
  if (fbx) {
    const glb = path.join(t, files[0].path), out = glb.replace(/\.glb$/, '.fbx');
    const r = spawnSync(BLENDER, BL.fbxArgs(SCRIPT, glb, out), { encoding: 'utf8', windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 1 << 26 });
    if (/T180FBX ok \d+/.test((r.stdout || '') + (r.stderr || '')) && fs.existsSync(out)) w.fbx = out; else w.fbx_error = `Blender: ${(r.stdout || '').slice(-400)}`;
  }
  return w;
}

test('build: a closed lap gives "<name> for Blender" with <name>.glb and README.txt, and the glb holds exactly the Export button\'s kn5 meshes', async () => {
  const sh = await shellWith(lap('Bx Lap')), bx = await bxLoaded();
  const out = bx.build(sh, {});
  assert.equal(out.folder, 'Bx Lap for Blender');
  assert.deepEqual(out.files.map((f) => f.path), ['Bx Lap.glb', 'README.txt']);
  const f = sh.buildExport({}).folders[0], kf = path.join(tmp(), 'x.kn5'); fs.writeFileSync(kf, Buffer.from(f.files.find((x) => x.path.endsWith('.kn5')).bytes));
  const kn5 = readKn5(kf), names = new Set(nodeNames(out.files[0].bytes));
  for (const m of kn5.meshes) assert.ok(names.has(m.name), `the glb lacks the kn5 mesh ${m.name}`);
  for (const d of kn5.dummies) assert.ok(names.has(d.name), `the glb lacks the marker ${d.name}`);
  assert.equal(out.meshes, kn5.meshes.length);
  // the page's Buffer (the node shim) writes what node's does: the same export through node's own modules gives the same JSON and every array byte for
  // byte; only the embedded PNGs' bytes differ (the shim's zlib stores, node's compresses), and they decode to the same pixels
  const [segs, meta, opts] = sh.exportArgs({}), nodeEx = require('../../src/export/layouts.js').buildFromSegments(segs, meta, { ...opts, author: undefined });
  const ga = readGlb(out.files[0].bytes), gb = readGlb(BL.blenderFiles(nodeEx).files[0].bytes), bare = (j) => JSON.stringify({ ...j, bufferViews: 0, buffers: 0 });
  assert.equal(bare(ga.json), bare(gb.json), 'the same JSON, the views\' offsets aside (the images\' lengths differ)');
  const bytesOf = (g, i) => Buffer.from(g.accessor(i).buffer, g.accessor(i).byteOffset, g.accessor(i).byteLength);
  for (let i = 0; i < ga.json.accessors.length; i++) assert.ok(bytesOf(ga, i).equals(bytesOf(gb, i)), `accessor ${i} differs between the page and node`);
  const { decodePng } = require('../../src/texture/png.js');
  for (let i = 0; i < (ga.json.images || []).length; i++) { const x = decodePng(ga.image(i)), y = decodePng(gb.image(i)); assert.deepEqual([x.width, x.height], [y.width, y.height]); assert.ok(Buffer.from(x.rgba).equals(Buffer.from(y.rgba)), `image ${i} pixels`); }
});

test('build: an OPEN track is built as the test export builds it, so it can be looked at in Blender before it is closed', async () => {
  const sh = await shellWith(openRun('Bx Open')), out = (await bxLoaded()).build(sh, {});
  assert.match(out.files[0].path, /^Bx Open.*\.glb$/);
  assert.ok(nodeNames(out.files[0].bytes).some((n) => /^AC_START_0$/.test(n)), 'the open track has its start');
});

test('build with pieces: only the selected piece\'s groups, and no AI line (it is the whole lap\'s)', async () => {
  const sh = await shellWith(lap('Bx Sel'));
  sh.selectPiece(1); const sel = sh.selectionInfo(); assert.equal(sel.count, 1);
  const out = (await bxLoaded()).build(sh, { pieces: sel.ids }), names = nodeNames(out.files[0].bytes);
  const groups = names.filter((n) => /^p\d+_/.test(n));
  const want = Number(sel.ids[0].replace(/^p/, ''));
  assert.ok(groups.length > 0 && groups.every((n) => Number(/^p(\d+)_/.exec(n)[1]) === want), `groups ${groups} for ${sel.ids}`);
  assert.ok(!names.includes('ai_fast_lane'));
  assert.ok(out.meshes < bx0Meshes(sh));
});
function bx0Meshes(sh) { const f = sh.buildExport({}).folders[0], kf = path.join(tmp(), 'y.kn5'); fs.writeFileSync(kf, Buffer.from(f.files.find((x) => x.path.endsWith('.kn5')).bytes)); return readKn5(kf).meshes.length; }

test('the flow writes the files into the picked folder, and with Blender the .fbx holds every kn5 mesh by name; the status line says so', async (t) => {
  const sh = await shellWith(lap('Bx Flow')), bx = await bxLoaded(), dir = tmp(), said = [];
  const has = fs.existsSync(BLENDER);
  let asked = null;
  const w = await exportBlenderFlow({ bx, shell: sh, ask: async (q) => { asked = q; return { selectedOnly: false, fbx: has }; }, pickFolder: async () => dir,
    findBlender: async () => (has ? BLENDER : null), write: async (...a) => writeLikeNative(...a), say: (s) => said.push(s) });
  assert.equal(asked.blender, has ? BLENDER : null); assert.equal(asked.selection, null, 'nothing selected: no selected-pieces tick');
  const folder = path.join(dir, 'Bx Flow for Blender');
  assert.ok(fs.existsSync(path.join(folder, 'Bx Flow.glb')) && fs.existsSync(path.join(folder, 'README.txt')));
  assert.match(said[said.length - 1], /^exported for Blender into .*Bx Flow\.glb \(\d+ meshes, \d+ markers\)/);
  if (!has) { t.diagnostic(`Blender is not at ${BLENDER}: the .fbx half was not run`); return; }
  assert.match(said[said.length - 1], /and Bx Flow\.fbx, and README\.txt$/);
  const f = readFbx(fs.readFileSync(path.join(folder, 'Bx Flow.fbx'))), names = new Set(f.models.map((m) => m.name));
  const k = sh.buildExport({}).folders[0], kf = path.join(tmp(), 'z.kn5'); fs.writeFileSync(kf, Buffer.from(k.files.find((x) => x.path.endsWith('.kn5')).bytes));
  const kn5 = readKn5(kf);
  for (const m of kn5.meshes) assert.ok(names.has(m.name), `the .fbx lacks ${m.name}`);
  for (const d of kn5.dummies) assert.ok(names.has(d.name), `the .fbx lacks ${d.name}`);
  t.diagnostic(`fbx: ${kn5.meshes.length} meshes and ${kn5.dummies.length} markers by name`);
  void w;
});

test('the flow: cancelled, or no folder picked, writes nothing and says so; a failed FBX keeps the .glb and says why', async () => {
  const sh = await shellWith(lap('Bx Way')), bx = await bxLoaded(), said = [], writes = [];
  const base = { bx, shell: sh, findBlender: async () => null, write: async (...a) => { writes.push(a); return { folder: 'X', fbx: null, fbx_error: 'Blender ended without a result: boom' }; }, say: (s) => said.push(s) };
  await exportBlenderFlow({ ...base, ask: async () => null, pickFolder: async () => 'D:/x' });
  assert.equal(said.pop(), 'Export for Blender: cancelled, nothing written.');
  await exportBlenderFlow({ ...base, ask: async () => ({ selectedOnly: false, fbx: false }), pickFolder: async () => null });
  assert.equal(said.pop(), 'Export for Blender: no folder picked, nothing written.');
  assert.equal(writes.length, 0);
  await exportBlenderFlow({ ...base, ask: async () => ({ selectedOnly: false, fbx: true }), pickFolder: async () => 'D:/x' });
  assert.equal(writes.length, 1); assert.equal(writes[0][3], true);
  assert.match(said.pop(), /Bx Way\.glb .*README\.txt · no \.fbx: Blender ended without a result: boom$/);
});

// ---- the question ----
class El {
  constructor(tag, doc) { this.tag = tag; this.doc = doc; this.children = []; this.parentNode = null; this.textContent = ''; this.className = ''; this.attrs = {}; this.onclick = null; this.checked = false; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; } }
  setAttribute(k, v) { this.attrs[k] = v; }
  focus() { this.doc.activeElement = this; }
  all() { return [this, ...this.children.flatMap((c) => c.all())]; }
}
function fakeDoc() {
  const doc = { listeners: [], activeElement: null };
  doc.createElement = (t) => new El(t, doc);
  doc.body = new El('body', doc);
  doc.addEventListener = (type, f) => doc.listeners.push(f);
  doc.removeEventListener = (type, f) => { doc.listeners = doc.listeners.filter((g) => g !== f); };
  doc.key = (key) => { const e = { key, preventDefault() {}, stopPropagation() {} }; doc.listeners.slice().forEach((f) => f(e)); };
  doc.q = (cls) => doc.body.all().filter((e) => e.className.split(' ').includes(cls));
  doc.button = (label) => doc.body.all().find((e) => e.tag === 'button' && e.textContent === label);
  return doc;
}

test('the question offers the FBX tick only when Blender was found, and the selected-pieces tick only with a selection', async () => {
  let doc = fakeDoc(), p = askBlender(doc, { selection: null, blender: null });
  assert.equal(doc.q('bx-fbx').length, 0); assert.equal(doc.q('bx-only').length, 0); assert.equal(doc.q('bx-note').length, 1, 'it says why there is no FBX');
  doc.button('Export…').onclick(); assert.deepEqual(await p, { selectedOnly: false, fbx: false });
  doc = fakeDoc(); p = askBlender(doc, { selection: { count: 2, ids: ['p2', 'p3'] }, blender: 'C:/b/blender.exe' });
  assert.equal(doc.q('bx-fbx')[0].checked, true, 'the FBX is ticked by default when Blender is there');
  doc.q('bx-only')[0].checked = true; doc.q('bx-fbx')[0].checked = false;
  doc.button('Export…').onclick(); assert.deepEqual(await p, { selectedOnly: true, fbx: false });
  assert.equal(doc.body.children.length, 0, 'the card is gone');
});

test('the question: Escape and Cancel answer null', async () => {
  let doc = fakeDoc(), p = askBlender(doc, {}); doc.key('Escape'); assert.equal(await p, null);
  doc = fakeDoc(); p = askBlender(doc, {}); doc.button('Cancel').onclick(); assert.equal(await p, null);
});
