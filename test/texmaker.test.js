// texmaker.test.js: node --test --test-concurrency=4 test/texmaker.test.js. The procedural texture maker (src/texmaker,
// ARCHITECTURE §5b "Make your own"). Stated before the first run:
//   · DETERMINISM: the same text gives identical bytes, twice in one process AND in a fresh process; and a pinned sha256
//     of one preset at 64² (change it only on purpose, with the reason).
//   · RESOLUTION INDEPENDENCE: the 512² render averaged 2×2 against the 256² render, per channel in 8-bit levels:
//       – each layer integrated exactly over each pixel (grain, stripes, lines, gradient bands, panels), ALONE on a flat
//         base: max |Δ| ≤ 1 level (8-bit rounding of both renders), mean ≤ 0.5. [CORRECTED after the first run: I first
//         claimed this for a composite of them too. Compositing is not linear, so two layers that both vary inside one
//         pixel break it: a 5-layer composite measured max 22.75, mean 0.26. Composites fall under the bound below.]
//       – with point-sampled or supersampled layers (noise, smooth gradients, glow, decals): mean ≤ 0.5 level, max ≤ 32
//         (a decal edge is sampled 4×4 per pixel, a glow at the pixel centre).
//   · EACH LAYER TYPE honours its parameters, measured in pixels: the stripe count and width, a lane line's position,
//     width and dash length, the grain's cells, the bands' boundaries, the panels' seams, the glow's core (and the
//     emissive map), a decal's area, turn and copies, and the noise's amount.
//   · THE TEXT round-trips byte-exact; a hand-edited text loads and saves canonical; numbers print from integers.
//   · INVALID params are refused with a named reason: BAD_TEXT, BAD_VERSION, UNKNOWN_KEY, UNKNOWN_LAYER, BAD_PARAM,
//     TOO_MANY_LAYERS, BAD_SIZE.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const TDIR = process.env.TEXMAKER_DIR || path.join(__dirname, '..', 'src', 'texmaker');
const T = require(TDIR);

const px = (img, x, y) => Array.from(img.rgba.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const tex = (layers, base = '#000000') => ({ texmaker: 1, name: 'test', base, layers });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
/** Runs of equal values in a row (or column) of one channel: [[value, length], …]. */
function runs(img, fixed, alongX, ch = 0) {
  const out = [], n = alongX ? img.width : img.height;
  for (let k = 0; k < n; k++) { const v = alongX ? px(img, k, fixed)[ch] : px(img, fixed, k)[ch]; if (out.length && out[out.length - 1][0] === v) out[out.length - 1][1]++; else out.push([v, 1]); }
  return out;
}
function downsampleDiff(p) {
  const a = T.makeTexture(p, 256, 256), b = T.makeTexture(p, 512, 512);
  let sum = 0, max = 0, n = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) for (let c = 0; c < 4; c++) {
    const at = (yy, xx) => b.rgba[(yy * 512 + xx) * 4 + c];
    const d = Math.abs((at(2 * y, 2 * x) + at(2 * y, 2 * x + 1) + at(2 * y + 1, 2 * x) + at(2 * y + 1, 2 * x + 1)) / 4 - a.rgba[(y * 256 + x) * 4 + c]);
    sum += d; if (d > max) max = d; n++;
  }
  return { mean: sum / n, max };
}

// ── determinism ──
test('determinism: the same text gives identical bytes twice, and the text and the object give the same bytes', () => {
  for (const p of Object.values(T.PRESETS)) {
    const a = T.makeTexture(p, 96, 64), b = T.makeTexture(T.serialize(p), 96, 64);
    assert.equal(Buffer.compare(Buffer.from(a.rgba), Buffer.from(b.rgba)), 0, p.name);
  }
});
test('determinism: a fresh process gives the same bytes', () => {
  const code = `const T = require(${JSON.stringify(TDIR)}); const c = require('crypto'); process.stdout.write(c.createHash('sha256').update(T.makeTexture(T.PRESETS['neon-night'], 128, 64).rgba).digest('hex'));`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, sha(T.makeTexture(T.PRESETS['neon-night'], 128, 64).rgba));
});
test('determinism: the pinned digest of the "lanes" preset at 64² (change only on purpose, with the reason)', () => {
  assert.equal(sha(T.makeTexture(T.PRESETS.lanes, 64, 64).rgba), 'b9af9b9ff22c05711351cb6411be1f960e9628476014c2552e52c640a6c8e5af');
});

// ── resolution independence ──
test('resolution: each exactly-integrated layer alone (grain, stripes, lines, bands, panels): 512² averaged 2×2 = 256² within 1 level', () => {
  const layers = [
    { type: 'gradient', mode: 'bands', repeat: 3, stops: [{ at: 0, colour: '#e8452c' }, { at: 0.3, colour: '#3c5ad8' }, { at: 0.7, colour: '#f2f4f6' }] },
    { type: 'grain', cells: 700, amount: 0.4, seed: 9 },
    { type: 'stripes', dir: 'across', count: 13, width: 0.37, offset: 0.11, colour: '#20ff20', amount: 0.5 },
    { type: 'lines', at: 0.331, width: 0.0137, dashes: 7, duty: 0.43, colour: '#ffffff' },
    { type: 'panels', cols: 5, rows: 3, seam: 0.07, tone: 0.2, seed: 3 },
  ];
  for (const l of layers) {
    const d = downsampleDiff(tex([l], '#404040'));
    assert.ok(d.max <= 1 && d.mean <= 0.5, `${l.type}: max ${d.max}, mean ${d.mean.toFixed(3)}`);
  }
});
test('resolution: a composite of those five falls under the composite bound (mean ≤ 0.5, max ≤ 32)', () => {
  const d = downsampleDiff(tex([
    { type: 'gradient', mode: 'bands', repeat: 3, stops: [{ at: 0, colour: '#e8452c' }, { at: 0.3, colour: '#3c5ad8' }, { at: 0.7, colour: '#f2f4f6' }] },
    { type: 'grain', cells: 700, amount: 0.4, seed: 9 },
    { type: 'stripes', dir: 'across', count: 13, width: 0.37, offset: 0.11, colour: '#20ff20', amount: 0.5 },
    { type: 'lines', at: 0.331, width: 0.0137, dashes: 7, duty: 0.43, colour: '#ffffff' },
    { type: 'panels', cols: 5, rows: 3, seam: 0.07, tone: 0.2, seed: 3 },
  ], '#404040'));
  assert.ok(d.mean <= 0.5 && d.max <= 32, `max ${d.max}, mean ${d.mean.toFixed(3)}`);
});
test('resolution: every preset, with point-sampled and supersampled layers too: mean ≤ 0.5 level, max ≤ 32', () => {
  for (const p of Object.values(T.PRESETS)) {
    const d = downsampleDiff(p);
    assert.ok(d.mean <= 0.5 && d.max <= 32, `${p.name}: max ${d.max}, mean ${d.mean.toFixed(3)}`);
  }
});

// ── each layer, its parameters in pixels ──
test('stripes: 8 stripes, each a quarter of its period, are 8 runs of 16 px at 512 wide, offset honoured', () => {
  const img = T.makeTexture(tex([{ type: 'stripes', dir: 'along', count: 8, width: 0.25, offset: 0, colour: '#ffffff' }]), 512, 4);
  const on = runs(img, 1, true).filter(([v]) => v === 255);
  assert.equal(on.length, 8); for (const [, n] of on) assert.equal(n, 16);
  assert.deepEqual(px(img, 0, 1), [255, 255, 255, 255]); assert.deepEqual(px(img, 16, 1), [0, 0, 0, 255]);
  const shifted = T.makeTexture(tex([{ type: 'stripes', dir: 'along', count: 8, width: 0.25, offset: 0.5, colour: '#ffffff' }]), 512, 4);
  assert.deepEqual(px(shifted, 0, 1), [0, 0, 0, 255]); assert.deepEqual(px(shifted, 32, 1), [255, 255, 255, 255]);
  const across = T.makeTexture(tex([{ type: 'stripes', dir: 'across', count: 4, width: 0.5, colour: '#ffffff' }]), 4, 256);
  assert.deepEqual(runs(across, 1, false).map(([v, n]) => [v, n]), [[255, 32], [0, 32], [255, 32], [0, 32], [255, 32], [0, 32], [255, 32], [0, 32]]);
});
test('lines: a line at 0.5, 0.02 wide, is px 245–254 at 500 wide; 4 dashes at duty 0.5 are 64 px on, 64 off at 512 long', () => {
  const img = T.makeTexture(tex([{ type: 'lines', at: 0.5, width: 0.02, dashes: 4, duty: 0.5, colour: '#ffffff' }]), 500, 512);
  const row = runs(img, 10, true);
  assert.deepEqual(row, [[0, 245], [255, 10], [0, 245]]);
  assert.deepEqual(runs(img, 250, false), [[255, 64], [0, 64], [255, 64], [0, 64], [255, 64], [0, 64], [255, 64], [0, 64]]);
});
test('grain: with as many cells as pixels each pixel is one cell; at twice the pixels each cell is a 2×2 block', () => {
  const p = tex([{ type: 'grain', blend: 'over', colour: '#ffffff', amount: 1, cells: 64, seed: 5 }]);
  const a = T.makeTexture(p, 64, 64), b = T.makeTexture(p, 128, 128);
  const distinct = new Set(); for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) distinct.add(px(a, x, y)[0]);
  assert.ok(distinct.size > 100, `cells differ: ${distinct.size} values`);
  for (let y = 0; y < 64; y += 7) for (let x = 0; x < 64; x += 5) { const v = px(a, x, y); for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) assert.deepEqual(px(b, 2 * x + dx, 2 * y + dy), v); }
  // at HALF the pixels each pixel covers 2×2 cells, and is their exact average (the grain is integrated, not sampled)
  const h = T.makeTexture(p, 32, 32);
  for (let y = 0; y < 32; y += 3) for (let x = 0; x < 32; x += 3) {
    const avg = [[0, 0], [1, 0], [0, 1], [1, 1]].reduce((acc, [dx, dy]) => acc + px(a, 2 * x + dx, 2 * y + dy)[0], 0) / 4;
    assert.ok(Math.abs(px(h, x, y)[0] - avg) <= 1, `(${x}, ${y}): ${px(h, x, y)[0]} vs the cells' average ${avg}`);
  }
});
test('gradient: bands hold each stop to the next (left half one colour, right half the other); smooth blends between', () => {
  const stops = [{ at: 0, colour: '#ff0000' }, { at: 0.5, colour: '#0000ff' }];
  const bands = T.makeTexture(tex([{ type: 'gradient', mode: 'bands', stops }]), 200, 2);
  assert.deepEqual(runs(bands, 0, true, 0), [[255, 100], [0, 100]]); assert.deepEqual(runs(bands, 0, true, 2), [[0, 100], [255, 100]]);
  const sm = T.makeTexture(tex([{ type: 'gradient', mode: 'smooth', stops }]), 200, 2);
  const mid = px(sm, 50, 0);   // u = 0.2525: 50.5% of the way from red to blue
  assert.ok(Math.abs(mid[0] - 255 * (1 - 0.505)) <= 1 && Math.abs(mid[2] - 255 * 0.505) <= 1, `${mid}`);
  const rep = T.makeTexture(tex([{ type: 'gradient', mode: 'bands', repeat: 4, stops }]), 400, 2);
  assert.equal(runs(rep, 0, true, 0).length, 8, 'repeat 4 gives 8 bands');
});
test('panels: 4 × 2 panels with seams 0.1 of a panel: seam colour on the boundaries, panel tone inside', () => {
  const img = T.makeTexture(tex([{ type: 'panels', cols: 4, rows: 2, seam: 0.1, tone: 0, colour: '#ff0000' }], '#808080'), 400, 200);
  // panels 100 px wide: seams 10 px centred on u = 0, 100, 200, 300 (wrapping), so px 95–104 are seam around 100
  for (const x of [0, 96, 100, 103, 196, 204]) assert.deepEqual(px(img, x, 50), [255, 0, 0, 255], `x ${x} is seam`);
  for (const x of [10, 50, 90, 150]) assert.deepEqual(px(img, x, 50), [128, 128, 128, 255], `x ${x} is panel`);
  for (const y of [0, 97, 102, 199]) assert.deepEqual(px(img, 50, y), [255, 0, 0, 255], `y ${y} is seam`);
  const toned = T.makeTexture(tex([{ type: 'panels', cols: 4, rows: 2, seam: 0.1, tone: 0.3, colour: '#ff0000', seed: 2 }], '#808080'), 400, 200);
  const tones = new Set([50, 150, 250, 350].map((x) => px(toned, x, 50)[0]));
  assert.ok(tones.size >= 3, `panels differ in tone: ${[...tones]}`);
  for (const t of tones) assert.ok(Math.abs(t - 128) <= 0.3 * 128 + 1, `tone ${t} within ±30%`);
});
test('glow: the core (at ± width/2) is lit, nothing past the falloff; the emissive map holds only emissive glows', () => {
  const g = tex([{ type: 'glow', dir: 'along', at: 0.5, width: 0.1, falloff: 0.1, intensity: 1, colour: '#40c0ff', emissive: true }]);
  const img = T.makeTexture(g, 200, 2);
  assert.deepEqual(px(img, 100, 0).slice(0, 3), [64, 192, 255]);   // in the core, the colour at intensity 1
  assert.deepEqual(px(img, 91, 0).slice(0, 3), [64, 192, 255]);
  assert.deepEqual(px(img, 60, 0).slice(0, 3), [0, 0, 0]);        // past core + falloff (u < 0.35)
  const mid = px(img, 75, 0)[2]; assert.ok(mid > 0 && mid < 255, `the falloff fades (${mid})`);
  assert.ok(img.emissive, 'an emissive map');
  assert.deepEqual(Array.from(img.emissive.slice(100 * 4, 100 * 4 + 3)), [64, 192, 255]);
  assert.equal(T.makeTexture(tex([{ ...g.layers[0], emissive: false }]), 200, 2).emissive, null, 'no emissive glow, no map');
});
test('decal: a rect covers its area (to 1%), a quarter turn swaps its sides, and "along" stamps count copies', () => {
  const white = (img) => { let n = 0; for (let k = 0; k < img.rgba.length; k += 4) n += img.rgba[k] / 255; return n; };
  const rect = (o) => tex([{ type: 'decal', shape: 'rect', at: [0.5, 0.5], size: [0.5, 0.25], colour: '#ffffff', ...o }]);
  const a = T.makeTexture(rect({}), 256, 256);
  assert.ok(Math.abs(white(a) - 0.125 * 256 * 256) <= 0.01 * 0.125 * 256 * 256, `area ${white(a)}`);
  assert.equal(px(a, 128, 128)[0], 255); assert.equal(px(a, 128, 80)[0], 0, 'outside its quarter height (rows 96–160)');   // [CORRECTED: row 100 is inside; the test's arithmetic was wrong]
  const turned = T.makeTexture(rect({ turn: 1 }), 256, 256);
  // unturned it is cols 64–192 by rows 96–160; turned a quarter it is cols 96–160 by rows 64–192
  assert.equal(px(a, 70, 128)[0], 255, 'unturned: col 70 is inside');
  assert.equal(px(turned, 128, 80)[0], 255, 'turned: now tall (row 80 inside)'); assert.equal(px(turned, 70, 128)[0], 0, 'and narrow (col 70 outside)');
  const two = T.makeTexture(rect({ at: [0.5, 0.25], size: [0.2, 0.1], place: 'along', count: 2 }), 256, 256);
  assert.equal(px(two, 128, 64)[0], 255); assert.equal(px(two, 128, 192)[0], 255, 'a copy half a tile along'); assert.equal(px(two, 128, 128)[0], 0);
  for (const shape of ['circle', 'diamond', 'chevron']) assert.ok(white(T.makeTexture(rect({ shape }), 128, 128)) > 50, `${shape} draws`);
});
test('noise: amount 0 changes nothing; the deviation grows with the amount; it tiles (the first column meets the last)', () => {
  const n = (amount) => T.makeTexture(tex([{ type: 'noise', blend: 'over', colour: '#ffffff', amount, cells: 4, octaves: 3 }], '#808080'), 128, 128);
  assert.ok(n(0).rgba.every((v, k) => v === (k % 4 === 3 ? 255 : 128)));
  const dev = (img) => { let s = 0; for (let k = 0; k < img.rgba.length; k += 4) s += Math.abs(img.rgba[k] - 128); return s; };
  assert.ok(dev(n(0.6)) > 1.8 * dev(n(0.3)), `${dev(n(0.6))} vs ${dev(n(0.3))}`);
  const img = n(1); let jump = 0, inner = 0;
  for (let y = 0; y < 128; y++) { jump = Math.max(jump, Math.abs(px(img, 0, y)[0] - px(img, 127, y)[0])); inner = Math.max(inner, Math.abs(px(img, 63, y)[0] - px(img, 64, y)[0])); }
  assert.ok(jump <= inner + 2, `the wrap is as smooth as the inside (${jump} vs ${inner})`);
});

// ── the text ──
test('text: every preset round-trips byte-exact, and the same texture is always the same bytes', () => {
  for (const p of Object.values(T.PRESETS)) { const s = T.serialize(p); assert.equal(T.serialize(T.parse(s)), s); assert.equal(T.serialize(JSON.parse(s)), s); }
});
test('text: a hand-edited texture (keys out of order, defaults left out, short colours, float noise) saves canonical', () => {
  const hand = '{"layers":[{"width":0.30000000000000004,"type":"stripes","colour":"#FFF000"}],"name":"hand","texmaker":1}';
  const s = T.serialize(T.parse(hand));
  assert.match(s, /"width": 0\.3,/); assert.match(s, /"colour": "#fff000ff"/); assert.match(s, /"count": 8,/); assert.match(s, /"base": "#303030ff"/);
  assert.equal(T.serialize(T.parse(s)), s);
  assert.equal(T.fmt(0.1 + 0.2), '0.3'); assert.equal(T.fmt(-1e-6), '-0.000001'); assert.equal(T.fmt(2), '2');
});

// ── refusals ──
test('refusals name their reason', () => {
  const code = (fn, c) => assert.throws(fn, (e) => e.name === 'TexmakerError' && e.code === c, c);
  code(() => T.parse('{not json'), 'BAD_TEXT');
  code(() => T.parse('{"name":"x"}'), 'BAD_TEXT');
  code(() => T.parse('{"texmaker":2,"name":"x"}'), 'BAD_VERSION');
  code(() => T.normalize({ texmaker: 1, name: 'x', colour: '#fff' }), 'UNKNOWN_KEY');
  code(() => T.normalize(tex([{ type: 'stripes', colour: '#fff', cols: 3 }])), 'UNKNOWN_KEY');
  code(() => T.normalize(tex([{ type: 'plasma' }])), 'UNKNOWN_LAYER');
  code(() => T.normalize(tex([{ type: 'stripes', count: 0 }])), 'BAD_PARAM');
  code(() => T.normalize(tex([{ type: 'stripes', width: 1.5 }])), 'BAD_PARAM');
  code(() => T.normalize(tex([{ type: 'stripes', count: 2.5 }])), 'BAD_PARAM');
  code(() => T.normalize(tex([{ type: 'lines', colour: 'red' }])), 'BAD_PARAM');
  assert.throws(() => T.normalize(tex([{ type: 'gradient', stops: [{ at: 0, colour: '#ffffff' }, { at: 0, colour: '#000000' }] }])), (e) => e.code === 'BAD_PARAM' && /stops must ascend strictly/.test(e.message), 'stops out of order');
  code(() => T.normalize(tex([{ type: 'decal', size: [0, 0.1] }])), 'BAD_PARAM');
  code(() => T.normalize({ texmaker: 1, name: '../etc' }), 'BAD_PARAM');
  code(() => T.normalize(tex(Array.from({ length: 33 }, () => ({ type: 'noise' })))), 'TOO_MANY_LAYERS');
  for (const [w, h] of [[0, 8], [8193, 8], [8, 1.5], ['8', 8]]) code(() => T.makeTexture(tex([]), w, h), 'BAD_SIZE');
  assert.throws(() => T.normalize(tex([{ type: 'stripes', width: 1.5 }])), /layers\[0\]\.width \(stripes\): 1\.5 is outside 0\.\.1/, 'the message names the layer, the key and the range');
});

// ── the seam for A (src/texture, part 1): makeTexture's output goes into A's DDS encoder as it is ──
test('seam: A\'s encodeDds takes makeTexture\'s { width, height, rgba } as it is, and level 0 reads back byte-identical', () => {
  const D = require('../src/texture/dds.js'), img = T.makeTexture(T.PRESETS.rainbow, 128, 64), dds = D.encodeDds(img);
  const bytes = Buffer.from(dds.bytes || dds), l0 = D.ddsLevel(bytes, 0);
  assert.equal(bytes.slice(0, 4).toString(), 'DDS ');
  assert.equal(D.readDdsHeader(bytes).mipCount, 8, '128×64 → 8 levels down to 1×1');
  assert.equal(l0.width, 128); assert.equal(l0.height, 64);
  assert.equal(Buffer.compare(Buffer.from(l0.rgba), Buffer.from(img.rgba)), 0);
});
