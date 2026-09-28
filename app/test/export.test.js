// export.test.js: node --test app/test/*.test.js
// The Export button's path, headless: the shell runs src/export/fromwords.js exportTrack() through the in-memory node
// shim (loaded by app/lib/cjs.js from the disk, the way the webview loads it), then hands the files to storage.writeExport.
// Here writeExport writes them into a temp folder, as the native side does into the folder the user picked.
// The sample loop is closed once by the connector (about 20 s) and reused. The self-intersection check is ON, as it
// always is in the app (app/test/export-selfcheck.test.js): these loops export with it on.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { createShell } = require('../shell.js');
const { makeExporter, checkTarget } = require('../export/export.js');
const shim = require('../export/node-shim.js');
const D = require('../../src/doc/index.js');
const { closeLoop } = require('../../src/doc/connector.js');
const { exportTrack } = require('../../src/export/fromwords.js');
const { readKn5 } = require('../../tools/kn5.cjs');

const REPO = path.resolve(__dirname, '..', '..');
const fromDisk = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-app-export-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function storage() {
  const s = { writes: [] };
  return Object.assign(s, {
    saveDoc: async () => {}, openDoc: async () => null, listDocs: async () => [], saveLibrary: async () => {}, openLibrary: async () => null,
    writeExport: async (dir, folder, files) => {
      s.writes.push({ dir, folder, n: files.length });
      for (const f of files) { const p = path.join(dir, folder, ...f.path.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); }
    },
  });
}
const kmh = (v) => v / 3.6;
function closed(name, words, speed) {
  let d = D.createDoc(name);
  for (const w of words) d = D.appendWord(d, w, { speed: kmh(speed) });
  if (words[2] === 'tight') d = D.editWord(d, 'w3', { handles: { length: 50 } });
  const c = closeLoop(d);
  assert.ok(c.candidates.length, c.reason);
  const doc = c.candidates.slice().sort((a, b) => a.lengthM - b.lengthM)[0].doc;
  return doc.words.reduce((x, w) => D.editWord(x, w.id, { speed: kmh(speed) }), doc);
}
const SAMPLE = closed('App Loop', ['straight', 'straight', 'tight', 'straight', 'tight'], 200);
let EXPORTER;
const exporter = async () => (EXPORTER || (EXPORTER = await makeExporter(fromDisk)));
async function shellWith(doc, st = storage()) {
  const s = await createShell({ storage: st, exporter: await exporter() });
  s.adopt(doc);   // put a prepared document in front of the user, as opening a file would
  return { s, st };
}

test('export writes the track folder into the picked folder, and its kn5 reads back through tools/kn5.cjs', async () => {
  const { s, st } = await shellWith(SAMPLE), out = tmp();
  await s.exportTo(out);
  assert.equal(s.getState().exportReds, null, s.getState().message);
  assert.deepEqual(st.writes.map((w) => w.folder), ['t180b_app_loop']);
  const dir = path.join(out, 't180b_app_loop'), k = readKn5(path.join(dir, 't180b_app_loop.kn5'));
  assert.equal(k.version, 5);
  assert.ok(k.meshes.length > 0);
  for (const m of ['AC_START_0', 'AC_PIT_0', 'AC_HOTLAP_START_0', 'AC_TIME_0_L', 'AC_TIME_0_R']) assert.ok(k.dummies.some((d) => d.name === m), m);
  for (const f of ['models.ini', 'data/surfaces.ini', 'ui/ui_track.json', 'ai/fast_lane.ai', 'map.png', '.t180b-builder.json']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.match(s.getState().message, /exported t180b_app_loop/);
});

test('the app\'s export is node\'s export: the same kn5, AI line and text files byte for byte, and the same pixels', async () => {
  const ref = tmp(), { s } = await shellWith(SAMPLE), out = tmp();
  exportTrack(SAMPLE, { outDir: ref });
  await s.exportTo(out);
  const a = path.join(ref, 't180b_app_loop'), b = path.join(out, 't180b_app_loop');
  for (const f of ['t180b_app_loop.kn5', 'ai/fast_lane.ai', 'models.ini', 'data/surfaces.ini', 'ui/ui_track.json', 'data/map.ini']) assert.ok(fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))), f);
  // PNGs: the app deflates as stored blocks, so the bytes differ; the decoded pixels must not
  const pixels = (p) => { const buf = fs.readFileSync(p); let o = 8; const idat = []; while (o < buf.length) { const n = buf.readUInt32BE(o), t = buf.toString('latin1', o + 4, o + 8); if (t === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + n)); o += 12 + n; } return zlib.inflateSync(Buffer.concat(idat)); };
  for (const f of ['map.png', 'ui/preview.png', 'ui/outline.png']) assert.ok(pixels(path.join(a, f)).equals(pixels(path.join(b, f))), f);
});

test('a red track is refused, nothing is written, and the reds are shown with their sources', async () => {
  // 150 km/h: far below any take-off speed the 12 m jump's 6.3 g landing needs, so this track is red whatever the
  // details of the jump check. At D169 it was 300 km/h, 13 km/h either side of the line depending on the jump check's
  // version, and it flipped when validation changed (D170).
  const jl = closed('Jump Loop', ['straight', 'straight', 'jump', 'straight', 'tight', 'straight', 'tight'], 150);
  const { s, st } = await shellWith(jl), out = tmp();
  await s.exportTo(out);
  assert.deepEqual(st.writes, []);
  assert.deepEqual(fs.readdirSync(out), []);
  const reds = s.getState().exportReds;
  assert.ok(Array.isArray(reds) && reds.length > 0, s.getState().message);
  assert.ok(reds.every((r) => r.reason && r.source), JSON.stringify(reds[0]));
  assert.match(s.getState().message, /RED/);
});

test('an open track is refused with the model\'s reason, and nothing is written', async () => {
  const open = D.appendWord(D.appendWord(D.createDoc('Open'), 'straight'), 'turn');
  const { s, st } = await shellWith(open);
  await s.exportTo(tmp());
  assert.deepEqual(st.writes, []);
  assert.match(s.getState().message, /OPEN_TRACK/);
});

test('the AC guard: inside content\\tracks only t180b_* folders; content\\tracks itself and folders elsewhere are fine', () => {
  const AC = 'G:\\SteamLibrary\\steamapps\\common\\assettocorsa\\content\\tracks';
  assert.equal(checkTarget(AC).ok, true);
  assert.equal(checkTarget(`${AC}\\t180b_mine`).ok, true);
  assert.equal(checkTarget(`${AC}\\T180B_Mine\\sub`).ok, true);
  for (const bad of [`${AC}\\some_other_track`, `${AC}\\some_other_track\\ui`, AC.replace('content\\tracks', 'Content\\Tracks') + '\\x', '/mnt/ac/content/tracks/other']) {
    const r = checkTarget(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(r.code, 'AC_INSTALL');
  }
  assert.equal(checkTarget('C:\\Users\\someone\\Documents\\exports').ok, true);
  assert.equal(checkTarget('').ok, false);
});

test('an export into another track\'s folder in an AC install is refused before anything runs or is written', async () => {
  const { s, st } = await shellWith(SAMPLE);
  await s.exportTo('G:\\SteamLibrary\\steamapps\\common\\assettocorsa\\content\\tracks\\somebody_elses');
  assert.deepEqual(st.writes, []);
  assert.match(s.getState().message, /another track's folder/);
});

test('the shim\'s sha256 and deflate are node\'s: the same digest, and a stream node inflates back to the input', () => {
  for (const n of [0, 1, 55, 56, 64, 65535, 65536, 200000]) {
    const b = crypto.randomBytes(n);
    assert.equal(shim.sha256(b).toString('hex'), crypto.createHash('sha256').update(b).digest('hex'), `sha256 of ${n} bytes`);
    assert.ok(zlib.inflateSync(shim.deflateSync(new Uint8Array(b))).equals(b), `deflate of ${n} bytes`);
  }
});

test('the shim\'s Buffer reads and writes like node\'s for every call the exporter makes', () => {
  const a = shim.Buffer.alloc(16), b = Buffer.alloc(16);
  for (const x of [a, b]) { x.writeFloatLE(1.5, 0); x.writeInt32LE(-7, 4); x.writeUInt16LE(65000, 8); x.writeUInt32BE(0xdeadbeef, 10); }
  assert.deepEqual([...a], [...b]);
  assert.deepEqual([a.readFloatLE(0), a.readInt32LE(4), a.readUInt16LE(8), a.readUInt32LE(10)], [b.readFloatLE(0), b.readInt32LE(4), b.readUInt16LE(8), b.readUInt32LE(10)]);
  assert.equal(shim.Buffer.from('béton', 'utf8').toString('utf8'), 'béton');
  assert.equal(shim.Buffer.from('sc6969', 'latin1').toString('latin1', 0, 6), 'sc6969');
  assert.deepEqual([...shim.Buffer.concat([shim.Buffer.from([1, 2]), shim.Buffer.from([3])])], [1, 2, 3]);
  assert.ok(shim.Buffer.isBuffer(shim.Buffer.alloc(1).subarray(0, 1)));
});

// The app's exporter carries the texture set to the kn5, as the preview draws it (fresh-eyes run of the installed app,
// 2026-09-27: a textured floor showed in the preview and was missing from the export).
test('the app\'s exporter writes a textured floor into the kn5 it hands the native side', async () => {
  const T = require('../../src/texture/index.js'), TM = require('../../src/texmaker/index.js');
  const get = async (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
  const ex = await makeExporter(get);
  let d = D.createDoc('Tex');
  for (const [w, o] of [['straight', { handles: { length: 600 } }], ['tight', { font: 'flat' }], ['tight', { font: 'flat' }], ['straight', { handles: { length: 600 } }], ['tight', { font: 'flat' }], ['tight', { font: 'flat' }]]) d = D.appendWord(d, w, { ...o, speed: 200 / 3.6 });
  d = D.editWord(D.checkDoc({ ...d, closed: true }), 'w1', { textures: { floor: { make: TM.serialize(TM.PRESETS.asphalt), size: 32 } } });
  const set = T.buildTextureSet(d, {});
  const out = ex.run(d, { textures: set }), files = out.folders[0].files;
  const kn5 = files.find((f) => /\.kn5$/.test(f.path)), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-apptex-')), f = path.join(tmp, 'x.kn5');
  try { fs.writeFileSync(f, kn5.bytes); const back = readKn5(f); assert.ok(back.meshes.some((m) => /^1ROAD_w1_/.test(m.name) && m.material === set.bySegment('w1').floor.material)); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.ok(Buffer.from(kn5.bytes).includes(Buffer.from(set.textures[0].file)), 'the DDS is embedded under its file name');
});

test('a track saved under a name exports as t180b_<that name>, not as the name it was started with', async () => {
  const { s, st } = await shellWith(D.checkDoc({ ...SAMPLE, name: 'untitled' }));
  await s.save('Monza');
  await s.exportTo(tmp());
  assert.deepEqual(st.writes.map((w) => w.folder), ['t180b_monza'], s.getState().message);
});
