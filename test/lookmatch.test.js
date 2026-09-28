// lookmatch.test.js: node --test test/lookmatch.test.js. The look-match reference views (ARCHITECTURE §5.3, D179):
// the metric (src/lookmatch/metric.js), the cameras (cameras.js, views.json), the kn5 reader (kn5scene.js), the DDS reader
// (dds.js), the CPU render in the preview's look (raster.js), and the CLI's guard (scripts/lookmatch.js). Synthetic data
// only: no AC track, no AC screenshot, nothing written into the repository.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const LDIR = process.env.LOOKMATCH_DIR || path.join(__dirname, '..', 'src', 'lookmatch');
const Mt = require(path.join(LDIR, 'metric.js'));
const C = require(path.join(LDIR, 'cameras.js'));
const { readScene } = require(path.join(LDIR, 'kn5scene.js'));
const { decodeDds } = require(path.join(LDIR, 'dds.js'));
const { renderView } = require(path.join(LDIR, 'raster.js'));
const CLI = require(process.env.LOOKMATCH_CLI || path.join(__dirname, '..', 'scripts', 'lookmatch.js'));
const { writeKn5 } = require('../src/export/kn5write.js');
const { encodeDds } = require('../src/texture/dds.js');
const A = require(process.env.ACLOOK || path.join(__dirname, '..', 'app', 'preview', 'aclook.js'));

const img = (w, h, fn) => { const rgba = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(fn(x, y), (y * w + x) * 4); return { width: w, height: h, rgba }; };

// ── the metric: CIEDE2000 ──────────────────────────────────────────────────────────────────────────────────────────
test('metric: CIEDE2000 gives Sharma, Wu and Dalal\'s published values (pairs 1, 2 and 17 of their test data)', () => {
  const pairs = [[{ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 }, 2.0425], [{ L: 50, a: 3.1571, b: -77.2803 }, { L: 50, a: 0, b: -82.7485 }, 2.8615],
    [{ L: 50, a: 2.5, b: 0 }, { L: 73, a: 25, b: -18 }, 27.1492]];
  for (const [p, q, want] of pairs) assert.ok(Math.abs(Mt.deltaE00(p, q) - want) < 1e-4, `${Mt.deltaE00(p, q)} vs ${want}`);
});
test('metric: a pure lightness shift of 10 around L* 50 is exactly 10 (the lightness weight is 1 at L̄ = 50)', () => {
  assert.ok(Math.abs(Mt.deltaE00({ L: 45, a: 0, b: 0 }, { L: 55, a: 0, b: 0 }) - 10) < 1e-12);
});
test('metric: identical images differ by exactly 0', () => {
  const a = img(16, 9, (x, y) => [x * 13, y * 25, 90, 255]);
  assert.deepStrictEqual(Mt.compareImages(a, { ...a, rgba: a.rgba.slice() }), { meanDE: 0, p95DE: 0, maxDE: 0, pixels: 144 });
});
test('metric: a two-tone image shifted by one pixel differs by (changed pixels / all) × ΔE00 of the two tones', () => {
  const A1 = [180, 60, 40, 255], B1 = [40, 90, 200, 255], W = 8, H = 4;
  const a = img(W, H, (x) => (x < 4 ? A1 : B1)), b = img(W, H, (x) => (x < 5 ? A1 : B1));   // the edge moves one column
  const r = Mt.compareImages(a, b), dAB = Mt.deltaE00(Mt.srgbToLab(A1), Mt.srgbToLab(B1));
  assert.ok(Math.abs(r.meanDE - dAB / W) < 1e-12 && Math.abs(r.maxDE - dAB) < 1e-12, `${r.meanDE} vs ${dAB / W}`);
});
test('metric: sRGB white and black are L* 100 and 0, and a pixel masked (alpha < 128) in either image is not compared', () => {
  const w = Mt.srgbToLab([255, 255, 255]), k = Mt.srgbToLab([0, 0, 0]);
  const a = img(2, 1, (x) => (x ? [0, 0, 0, 0] : [10, 10, 10, 255])), b = img(2, 1, () => [250, 250, 250, 255]);
  // white: the sRGB matrix's Y row sums to 1.0000001, so L* is 100.0000039, not exactly 100
  assert.deepStrictEqual([Math.abs(w.L - 100) < 1e-5, Math.abs(k.L) < 1e-12, Mt.compareImages(a, b).pixels], [true, true, 1]);
});
test('metric: images of different sizes, or wholly masked, are refused', () => {
  assert.throws(() => Mt.compareImages(img(2, 2, () => [0, 0, 0, 255]), img(3, 2, () => [0, 0, 0, 255])), /differ in size/);
  assert.throws(() => Mt.compareImages(img(2, 2, () => [0, 0, 0, 0]), img(2, 2, () => [0, 0, 0, 255])), /no pixel is compared/);
});

// ── the cameras ──────────────────────────────────────────────────────────────────────────────────────────────────
const grid = [{ name: 'AC_START_0', pos: [10, 2, 50], fwd: [0, 0, 1] }, { name: 'AC_START_1', pos: [10, 2, 42], fwd: [0, 0, 1] }, { name: 'AC_PIT_0', pos: [0, 2, 50], fwd: [0, 0, -1] }];
const view = (o = {}) => ({ id: 'v', track: 't', anchor: 'AC_START_0', up: 1.1, forward: 0, right: 0, yawDeg: 0, pitchDeg: 0, fovDeg: 56, width: 64, height: 36, ...o });
const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
test('cameras: a view sits up above its anchor and looks along the race direction', () => {
  const c = C.resolveView(view(), grid);
  assert.deepStrictEqual([near(c.eye, [10, 3.1, 50]), near(c.target, [10, 3.1, 60])], [true, true]);
});
test('cameras: an anchor whose axis points backwards is turned round by the grid\'s race direction (back slot → pole)', () => {
  assert.ok(near(C.resolveView(view({ anchor: 'AC_PIT_0' }), grid).target, [0, 3.1, 60]));
});
test('cameras: forward and right move the eye; yaw + 90° looks left (left = up × forward); pitch looks up', () => {
  const a = C.resolveView(view({ forward: -30, right: 2, up: 12 }), grid), b = C.resolveView(view({ yawDeg: 90 }), grid), c = C.resolveView(view({ pitchDeg: 90 }), grid);
  assert.deepStrictEqual([near(a.eye, [8, 14, 20]), near(b.target, [20, 3.1, 50]), near(c.target, [10, 13.1, 50])], [true, true, true]);
});
test('cameras: a view whose anchor the track does not have is refused', () => {
  assert.throws(() => C.resolveView(view({ anchor: 'AC_TIME_9_L' }), grid), /has no AC_TIME_9_L/);
});
test('cameras: the repository\'s views file loads: Sakura and Centrifuge, every view anchored to an AC_ dummy', () => {
  const V = C.loadViews(fs.readFileSync(CLI.VIEWS_FILE, 'utf8'));
  assert.deepStrictEqual([Object.keys(V.tracks).sort(), [...new Set(V.views.map((v) => v.track))].sort(), V.views.every((v) => /^AC_/.test(v.anchor))], [['centrifuge', 'sakura'], ['centrifuge', 'sakura'], true]);
});
test('cameras: a bad views file is refused, saying why', () => {
  const ok = { tracks: { t: { folder: 't', models: ['t.kn5'] } }, views: [view({ track: 't' })] }, bad = (patch) => assert.throws(() => C.loadViews(JSON.stringify(patch(JSON.parse(JSON.stringify(ok))))), /lookmatch: /);
  assert.doesNotThrow(() => C.loadViews(JSON.stringify(ok)));
  bad((v) => { v.views = []; return v; }); bad((v) => { v.views[0].track = 'x'; return v; }); bad((v) => { v.views[0].anchor = 'START_0'; return v; });
  bad((v) => { v.views[0].fovDeg = 'wide'; return v; }); bad((v) => { v.views.push({ ...v.views[0] }); return v; }); bad((v) => { v.views[0].id = '../x'; return v; });
});

// ── the kn5 reader: a round trip through the export's own writer ──────────────────────────────────────────────────
const MAT = { name: 'm0', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0, props: [{ name: 'ksAmbient', value: [0.4] }, { name: 'ksDiffuse', value: [0.5] }, { name: 'ksEmissive', value: [0.1, 0.2, 0.3] }], samplers: [{ name: 'txDiffuse', slot: 0, texture: 't.dds' }] };
function quadScene({ z = 10, half = 5, matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], visible = true } = {}) {
  const mesh = { type: 'mesh', name: '1ROAD_q', material: 0, positions: new Float32Array([-half, -half, z, half, -half, z, half, half, z, -half, half, z]), normals: new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), indices: new Uint16Array([0, 1, 2, 0, 2, 3]), castShadows: true, visible, transparent: false, renderable: true };
  const tex = encodeDds({ width: 2, height: 2, rgba: new Uint8Array([200, 100, 50, 255, 200, 100, 50, 255, 200, 100, 50, 255, 200, 100, 50, 255]) });
  return { textures: [{ name: 't.dds', data: Buffer.from(tex) }], materials: [MAT],
    root: { type: 'dummy', name: 'root', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [{ type: 'dummy', name: 'AC_START_0', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0, 4, 1], children: [] }, { type: 'dummy', name: 'CELL', matrix, children: [mesh] }] } };
}
test('kn5 reader: what the export writes reads back: textures, material properties in their slots, samplers, world positions, dummies', () => {
  const s = readScene(writeKn5(quadScene({ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1] })));
  const m = s.materials[0], q = s.meshes[0];
  assert.deepStrictEqual([s.textures.map((t) => t.name), m.shader, Math.fround(0.4) === m.props.ksAmbient[0], m.props.ksEmissive.slice(3, 6).map((x) => +x.toFixed(6)), m.samplers, q.name, Array.from(q.pos.slice(0, 3)), Array.from(q.nrm.slice(0, 3)), Array.from(q.uv.slice(2, 4)), s.dummies.map((d) => [d.name, d.pos])],
    [['t.dds'], 'ksPerPixel', true, [0.1, 0.2, 0.3], { txDiffuse: 't.dds' }, '1ROAD_q', [95, -5, 10], [0, 0, -1], [1, 1], [['AC_START_0', [3, 0, 4]]]]);
  // uv [1, 1]: the kn5's own v, which src/export/kn5write.js writes as 1 − v (a kn5 keeps the image's top row at v = 0);
  // the reader returns the file's uv, which is what sampling a DDS (row 0 at the top) needs
});
test('kn5 reader: a mesh AC flags not visible is skipped; a truncated file is refused', () => {
  const bytes = writeKn5(quadScene({ visible: false }));
  assert.deepStrictEqual(readScene(bytes).meshes.length, 0);
  assert.throws(() => readScene(bytes.subarray(0, bytes.length - 3)), /ends inside|bytes left/);
});

// ── the DDS reader ────────────────────────────────────────────────────────────────────────────────────────────────
function dxt1(c0, c1, bits) {
  const h = Buffer.alloc(128 + 8); h.write('DDS ', 0, 'latin1');
  const w = (i, v) => h.writeUInt32LE(v, 4 + i * 4);
  w(0, 124); w(1, 0x1007); w(2, 4); w(3, 4); w(6, 1); w(18, 32); w(19, 4); h.write('DXT1', 84, 'latin1');
  h.writeUInt16LE(c0, 128); h.writeUInt16LE(c1, 130); h.writeUInt32LE(bits >>> 0, 132);
  return h;
}
test('dds: a DXT1 block decodes: the endpoints, the two thirds between, and the transparent index of the 3-colour mode', () => {
  const four = decodeDds(dxt1(0xF800, 0x001F, 0b11100100)), three = decodeDds(dxt1(0x001F, 0xF800, 0b11100100));
  const px = (im, i) => Array.from(im.rgba.slice(i * 4, i * 4 + 4));
  assert.deepStrictEqual([px(four, 0), px(four, 1), px(four, 2), px(four, 3), px(three, 3)], [[255, 0, 0, 255], [0, 0, 255, 255], [170, 0, 85, 255], [85, 0, 170, 255], [0, 0, 0, 0]]);
});
test('dds: an uncompressed 32-bit DDS (our own encoder) decodes to its pixels, and the level chosen respects maxSide', () => {
  const rgba = new Uint8Array(8 * 8 * 4).map((_, i) => (i * 7) % 256), d = decodeDds(encodeDds({ width: 8, height: 8, rgba }));
  const small = decodeDds(encodeDds({ width: 8, height: 8, rgba }), 2);
  assert.deepStrictEqual([d.width, Buffer.from(d.rgba).equals(Buffer.from(rgba)), small.width, small.level], [8, true, 2, 2]);
});
test('dds: a format it does not decode gives null, not a wrong image', () => {
  const b = dxt1(0, 0, 0); b.write('DX10', 84, 'latin1');
  assert.strictEqual(decodeDds(b), null);
});

// ── the render, in the preview's look ─────────────────────────────────────────────────────────────────────────────
const cam = { eye: [0, 0, 0], target: [0, 0, 10], up: [0, 1, 0], fovDeg: 60, width: 32, height: 18 };
test('raster: a textured quad facing the camera is drawn in aclook.shade\'s colour, with the preview\'s fog', () => {
  const s = readScene(writeKn5(quadScene())), tex = new Map([['t.dds', decodeDds(s.textures[0].bytes)]]), r = renderView(s, cam, { textures: tex });
  const u = A.uniformsFor({ name: 'm0', shader: 'ksPerPixel', props: [{ name: 'ksAmbient', value: [Math.fround(0.4)] }, { name: 'ksDiffuse', value: [Math.fround(0.5)] }, { name: 'ksEmissive', value: [0.1, 0.2, 0.3].map(Math.fround) }], samplers: [{ name: 'txDiffuse', texture: 't.dds' }] });
  const i = (9 * 32 + 16) * 4, wp = [0, 0, 10];                        // the centre pixel looks straight at the quad's middle
  const cMid = A.shade(u, [200 / 255, 100 / 255, 50 / 255], [0, 0, -1], A.LIGHT.toSun, [0, 0, -1]);
  const fog = [0.07, 0.08, 0.1], k = Math.exp(-0.0012 * 10), want = cMid.map((c, ch) => Math.round(255 * Math.min(1, Math.max(0, fog[ch] + (c - fog[ch]) * k))));
  void wp;
  assert.deepStrictEqual(Array.from(r.rgba.slice(i, i + 4)).map((x, ch) => (ch < 3 ? Math.abs(x - want[ch]) <= 1 : x === 255)), [true, true, true, true]);
});
test('raster: far away, the colour is mixed into the fog colour of the preview by exp(−0.0012 · distance)', () => {
  const s = readScene(writeKn5(quadScene({ z: 500, half: 300 }))), r = renderView(s, cam), i = (9 * 32 + 16) * 4;
  const u = A.uniformsFor({ name: 'm0', shader: 'ksPerPixel', props: [{ name: 'ksAmbient', value: [Math.fround(0.4)] }, { name: 'ksDiffuse', value: [Math.fround(0.5)] }, { name: 'ksEmissive', value: [0.1, 0.2, 0.3].map(Math.fround) }], samplers: [] });
  const c = A.shade(u, [1, 1, 1], [0, 0, -1], A.LIGHT.toSun, [0, 0, -1]), fog = [0.07, 0.08, 0.1], k = Math.exp(-0.0012 * 500);
  const want = c.map((x, ch) => Math.round(255 * Math.min(1, Math.max(0, fog[ch] + (x - fog[ch]) * k))));
  assert.deepStrictEqual(Array.from(r.rgba.slice(i, i + 3)).map((x, ch) => Math.abs(x - want[ch]) <= 1), [true, true, true]);
});
test('raster: the nearer surface wins (a z-buffer), and nothing drawn stays transparent (the metric masks it)', () => {
  const s1 = readScene(writeKn5(quadScene({ z: 20, half: 3 }))), s2 = readScene(writeKn5(quadScene({ z: 10, half: 1 })));
  // the NEAR quad is drawn first, so only a depth test (not the drawing order) can keep the far one from painting over it
  const both = { materials: s1.materials, meshes: [{ ...s2.meshes[0], name: 'near' }, ...s1.meshes], textures: [] };
  const r = renderView(both, cam), ctr = (9 * 32 + 16) * 4, corner = 0;
  const onlyFar = renderView(s1, cam);
  assert.deepStrictEqual([r.rgba[corner + 3], r.rgba[ctr + 3], r.rgba[ctr] !== onlyFar.rgba[ctr] || r.rgba[ctr + 1] !== onlyFar.rgba[ctr + 1] || r.rgba[ctr + 2] !== onlyFar.rgba[ctr + 2]], [0, 255, true]);
});
test('raster: a triangle through the near plane is clipped and drawn, not dropped', () => {
  const s = readScene(writeKn5(quadScene({ z: 10, half: 5 })));
  s.meshes[0].pos = new Float32Array([-5, -2, -5, 5, -2, -5, 5, -2, 30, -5, -2, 30]);   // a floor running from behind the camera to ahead
  s.meshes[0].nrm = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const r = renderView(s, cam), bottom = ((17) * 32 + 16) * 4;
  assert.deepStrictEqual([r.stats.clipped > 0, r.rgba[bottom + 3]], [true, 255]);
});
test('raster: an alpha-tested material discards texels below ksAlphaRef', () => {
  const s = readScene(writeKn5(quadScene())); s.materials[0].alphaTested = true; s.materials[0].props.ksAlphaRef = [0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const clear = { width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 0]) }, r = renderView(s, cam, { textures: new Map([['t.dds', clear]]) });
  assert.strictEqual(r.stats.pixels, 0);
});

// ── the CLI's guard ───────────────────────────────────────────────────────────────────────────────────────────────
test('cli: a render into the repository is refused (another author\'s track is not ours to commit); outside it is accepted', () => {
  assert.throws(() => CLI.parseArgs(['render', '--ac', 'G:/x', '--out', path.join(CLI.REPO, 'out', 'lookmatch')]), /inside the repository/);
  assert.throws(() => CLI.parseArgs(['render', '--ac', 'G:/x', '--out', CLI.REPO]), /inside the repository/);
  assert.strictEqual(CLI.parseArgs(['render', '--ac', 'G:/x', '--out', path.join(os.tmpdir(), 'lm')]).cmd, 'render');
});
test('cli: diff with no reference shots says PARKED for every view', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-lm-')); try {
    const rows = CLI.diff({ ref: empty, ours: empty });
    assert.deepStrictEqual([rows.length > 0, rows.every((r) => /^PARKED/.test(r.status))], [true, true]);
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});
