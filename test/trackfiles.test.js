// Tests for src/export/trackfiles.js: the surfaces.ini variants, models.ini, ui_track.json (pitboxes counted), the
// map.ini formula, and the PNGs parsed back from their bytes (signature, IHDR, CRC-32 of every chunk, IDAT size).
// node --test, no dependencies.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const T = require('../src/export/trackfiles.js');

function quad(name, x0, x1, z0, z1, y = 0) {
  return { type: 'mesh', name, material: 0, positions: new Float32Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1]),
    normals: new Float32Array(12), uvs: new Float32Array(8), indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
    castShadows: true, visible: true, transparent: false, renderable: true };
}
const dummy = (name, x, y, z) => ({ type: 'dummy', name, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1], children: [] });
// road x −6..6 × z −60..60, pit lane x 10..16 × z −30..10, a wall that must NOT count toward the map box
const scene = () => ({ textures: [], materials: [], root: { type: 'dummy', name: 'root', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  children: [quad('1ROAD', -6, 6, -60, 60), quad('1PIT', 10, 16, -30, 10), quad('1WALL', 6, 400, -60, 60, 3),
    dummy('AC_PIT_0', 13, 1.5, 0), dummy('AC_PIT_1', 13, 1.5, -8), dummy('AC_START_0', 0, 1.5, 20)] } });

/** Parse a PNG from bytes the way a reader would; throws on any structural error. */
function parsePng(buf) {
  assert.deepStrictEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  let o = 8; const chunks = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    const crc = buf.readUInt32BE(o + 8 + len);
    assert.strictEqual(crc, T.crc32(buf.subarray(o + 4, o + 8 + len)), `CRC of ${type}`);
    assert.strictEqual(crc, zlib.crc32 ? zlib.crc32(buf.subarray(o + 4, o + 8 + len)) : crc, `CRC of ${type} against node's zlib.crc32`);
    chunks.push({ type, data }); o += 12 + len;
  }
  assert.strictEqual(chunks[0].type, 'IHDR'); assert.strictEqual(chunks.at(-1).type, 'IEND');
  const h = chunks[0].data, width = h.readUInt32BE(0), height = h.readUInt32BE(4);
  assert.deepStrictEqual([h[8], h[9], h[10], h[11], h[12]], [8, 6, 0, 0, 0], 'IHDR: 8-bit RGBA, deflate, filter 0, no interlace');
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  assert.strictEqual(raw.length, (width * 4 + 1) * height, 'IDAT inflates to (4w+1)·h bytes');
  // un-filter every row as a real decoder does (PNG spec §9: None, Sub, Up, Average, Paeth), so a wrong filter byte
  // shows up as wrong pixels rather than passing unnoticed
  const stride = width * 4, img = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    assert.ok(ft <= 4, `row ${y}: filter type ${ft} is not 0-4`);
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i], a = i >= 4 ? img[y * stride + i - 4] : 0, b = y ? img[(y - 1) * stride + i] : 0, c = y && i >= 4 ? img[(y - 1) * stride + i - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c), paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      img[y * stride + i] = (x + [0, a, b, (a + b) >> 1, paeth][ft]) & 0xff;
    }
  }
  const px = (x, y) => [...img.subarray(y * stride + x * 4, y * stride + x * 4 + 4)];
  return { width, height, px };
}

test('the two surfaces.ini variants differ ONLY by the soft-collision block', () => {
  const soft = T.surfacesIni({ softCollision: true }), hard = T.surfacesIni({ softCollision: false });
  assert.notStrictEqual(soft, hard);
  assert.strictEqual(soft, hard + '\n' + T.SOFT_COLLISION_BLOCK);
  assert.ok(!/COLLISION_PARAMS/.test(hard), 'the no-block variant carries no collision section');
});

test('the block carries FINDINGS §4c\'s numbers, exactly', () => {
  const kv = Object.fromEntries(T.SOFT_COLLISION_BLOCK.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')));
  assert.deepStrictEqual(kv, { MESHES: '1ROAD?', SOFT_ERP: '0.8', SOFT_CFM: '0.0002', BOUNCE: '0.1', FRICTION: '0.05', MAX_DEPTH: '4' });
  assert.match(T.SOFT_COLLISION_BLOCK, /^\[COLLISION_PARAMS_\.\.\.\]$/m);
});

test('the default surfaces.ini is the T-180 one (with the block)', () => {
  assert.strictEqual(T.surfacesIni(), T.surfacesIni({ softCollision: true }));
});

test('models.ini lists each kn5 at the origin; models_<layout>.ini is named for a layout', () => {
  assert.strictEqual(T.modelsIni(['t.kn5']), '[MODEL_0]\nFILE=t.kn5\nPOSITION=0,0,0\nROTATION=0,0,0\n');
  assert.match(T.modelsIni(['a.kn5', 'b.kn5']), /\[MODEL_1\]\nFILE=b\.kn5/);
  assert.strictEqual(T.modelsIniName('soft'), 'models_soft.ini');
  assert.strictEqual(T.modelsIniName(null), 'models.ini');
  assert.throws(() => T.modelsIni([]), /at least one/);
  assert.throws(() => T.modelsIni(['..\\x.kn5']), /bare \.kn5/);
});

test('ui_track.json counts pitboxes from the AC_PIT_n markers and ignores a hand-typed count', () => {
  const u = T.uiTrack(scene(), { name: 'T', pitboxes: 99, length: 500.4 });
  assert.strictEqual(u.pitboxes, '2');
  assert.strictEqual(u.length, '500m');
  assert.throws(() => T.uiTrack(scene(), {}), /desc\.name is required/);
});

test('map.ini follows Content Manager\'s formula over the drivable meshes only', () => {
  const p = T.mapParams(scene());
  // drivable box: x −6..16 (22 m), z −60..60 (120 m); the WALL reaching x=400 is excluded. Margin 10, scale 1.
  assert.deepStrictEqual(p, { WIDTH: 42, HEIGHT: 140, X_OFFSET: 16, Z_OFFSET: 70, MARGIN: 10, SCALE_FACTOR: 1, DRAWING_SIZE: 10 });
  assert.strictEqual(T.mapIni(p), '[PARAMETERS]\nWIDTH=42\nHEIGHT=140\nX_OFFSET=16\nZ_OFFSET=70\nMARGIN=10\nSCALE_FACTOR=1\nDRAWING_SIZE=10\n');
  const q = T.mapParams(scene(), { scale: 2 });
  assert.strictEqual(q.WIDTH, 64); assert.strictEqual(q.X_OFFSET, 11); assert.strictEqual(q.SCALE_FACTOR, 0.5);
});

test('map.png parses, is WIDTH×HEIGHT, and paints the road where map.ini says it is', () => {
  const p = T.mapParams(scene()), png = parsePng(T.mapPng(scene(), p));
  assert.deepStrictEqual([png.width, png.height], [p.WIDTH, p.HEIGHT]);
  const at = (x, z) => png.px(Math.floor((x + p.X_OFFSET) / p.SCALE_FACTOR), Math.floor((z + p.Z_OFFSET) / p.SCALE_FACTOR));
  assert.deepStrictEqual(at(0, 0), [255, 255, 255, 255], 'road centre is painted');
  assert.deepStrictEqual(at(13, 0), [255, 255, 255, 255], 'pit lane is painted');
  assert.deepStrictEqual(at(8, 0), [0, 0, 0, 0], 'the gap between road and pit lane is transparent');
  assert.deepStrictEqual(png.px(0, 0), [0, 0, 0, 0], 'the margin is transparent');
});

test('outline.png and preview.png parse at the UI sizes', () => {
  const o = parsePng(T.outlinePng(scene())), v = parsePng(T.previewPng(scene()));
  assert.deepStrictEqual([o.width, o.height, v.width, v.height], [365, 192, 355, 200]);
  assert.deepStrictEqual(v.px(0, 0), [24, 26, 30, 255], 'preview has an opaque backdrop');
  assert.deepStrictEqual(v.px(177, 100), [200, 200, 200, 255], 'preview centre shows road');
});

test('encodePng refuses a buffer of the wrong size', () => {
  assert.throws(() => T.encodePng(2, 2, Buffer.alloc(15)), /needs 16 bytes/);
});

test('crc32 matches the PNG spec\'s check value', () => {
  assert.strictEqual(T.crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('writeTrackFiles writes the whole non-kn5 set, and the two variants differ only in surfaces.ini', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't180-trackfiles-'));
  try {
    const desc = { name: 'T' }, a = path.join(root, 'soft'), b = path.join(root, 'hard');
    const la = T.writeTrackFiles(a, scene(), { softCollision: true, kn5Files: ['t.kn5'], desc });
    const lb = T.writeTrackFiles(b, scene(), { softCollision: false, kn5Files: ['t.kn5'], desc });
    assert.deepStrictEqual(la.sort(), ['data/map.ini', 'data/surfaces.ini', 'map.png', 'models.ini', 'ui/outline.png', 'ui/preview.png', 'ui/ui_track.json']);
    assert.deepStrictEqual(la, lb.sort());
    const differ = la.filter((f) => !fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
    assert.deepStrictEqual(differ, ['data/surfaces.ini']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── install safety (scripts/build_platform_test.js installOne; the overnight plan's Rule 1) ─────────────────────────
const { installOne, MARKER_FILE } = require('../scripts/build_platform_test.js');
function fakeBuild(root) {
  const dir = path.join(root, 'out', 't180b_x'); fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.kn5'), 'kn5'); fs.writeFileSync(path.join(dir, 'data', 'surfaces.ini'), 's');
  return { folder: 't180b_x', dir, files: ['a.kn5', 'data/surfaces.ini'] };
}
function fakeAc(root) { const ac = path.join(root, 'ac'); fs.mkdirSync(path.join(ac, 'content', 'tracks'), { recursive: true }); return ac; }

test('install writes a new t180b_* folder and its marker file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't180-install-'));
  try {
    const b = fakeBuild(root), ac = fakeAc(root), r = installOne(b, ac);
    assert.strictEqual(r.existed, false);
    assert.strictEqual(fs.readFileSync(path.join(ac, 'content', 'tracks', 't180b_x', 'data', 'surfaces.ini'), 'utf8'), 's');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(ac, 'content', 'tracks', 't180b_x', MARKER_FILE), 'utf8')).files, b.files);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('install REFUSES a target that exists without our marker, and touches nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't180-install-'));
  try {
    const b = fakeBuild(root), ac = fakeAc(root), t = path.join(ac, 'content', 'tracks', 't180b_x');
    fs.mkdirSync(t); fs.writeFileSync(path.join(t, 'a.kn5'), 'someone else');
    assert.throws(() => installOne(b, ac), /not written by t180-track-builder/);
    assert.strictEqual(fs.readFileSync(path.join(t, 'a.kn5'), 'utf8'), 'someone else');
    assert.deepStrictEqual(fs.readdirSync(t), ['a.kn5']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('install on our own folder replaces our files and deletes nothing else', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't180-install-'));
  try {
    const b = fakeBuild(root), ac = fakeAc(root), t = path.join(ac, 'content', 'tracks', 't180b_x');
    installOne(b, ac); fs.writeFileSync(path.join(t, 'keeper-note.txt'), 'kept');
    fs.writeFileSync(path.join(b.dir, 'a.kn5'), 'kn5 v2');
    const r = installOne(b, ac);
    assert.strictEqual(r.existed, true);
    assert.strictEqual(fs.readFileSync(path.join(t, 'a.kn5'), 'utf8'), 'kn5 v2');
    assert.strictEqual(fs.readFileSync(path.join(t, 'keeper-note.txt'), 'utf8'), 'kept');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('install refuses any folder name that is not t180b_*', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't180-install-'));
  try {
    const b = { ...fakeBuild(root), folder: 'centrifuge' }, ac = fakeAc(root);
    assert.throws(() => installOne(b, ac), /only t180b_\* folders/);
    assert.throws(() => installOne({ ...b, folder: 't180b_../../x' }, ac), /only t180b_\* folders/);
    assert.deepStrictEqual(fs.readdirSync(path.join(ac, 'content', 'tracks')), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
