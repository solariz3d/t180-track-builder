// icons.test.js (D395): the app icon (src-tauri/icons/make-icons.js) and the title bar's wordmark (app/index.html's h1).
// The icon is the Crossover loop in Skyline's colours, in every theme; the wordmark is live text in the current theme's tokens.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ICONS = path.join(ROOT, 'src-tauri', 'icons');
const SCRIPT = path.join(ICONS, 'make-icons.js');
const FILES = { '32x32.png': 32, '128x128.png': 128, '128x128@2x.png': 256 };
const ICO_SIZES = [16, 24, 32, 48, 256];

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 't180-icons-'));
const run = (dir) => execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
function pngSize(b) {
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'not a PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
function pngPixels(b) {   // the writer's own form: 8-bit RGBA, filter 0 on every row
  const [w, h] = pngSize(b); const idat = []; let o = 8;
  while (o < b.length) { const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8); if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) { assert.equal(raw[y * (w * 4 + 1)], 0, 'filter 0'); raw.copy(px, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)); }
  return { w, h, px };
}
function icoEntries(b) {
  assert.equal(b.readUInt16LE(2), 1, 'an icon file');
  const n = b.readUInt16LE(4), out = [];
  for (let i = 0; i < n; i++) {
    const e = 6 + 16 * i, size = b[e] || 256, len = b.readUInt32LE(e + 8), off = b.readUInt32LE(e + 12);
    out.push({ size, png: pngSize(b.subarray(off, off + len)) });
  }
  return out;
}
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i + 1, i + 3), 16));

test('the script writes every file tauri.conf.json names, at its size, and the ico carries 16, 24, 32, 48 and 256', () => {
  const dir = tmp();
  try {
    run(dir);
    for (const [f, n] of Object.entries(FILES)) assert.deepEqual(pngSize(fs.readFileSync(path.join(dir, f))), [n, n], `${f} is ${n}x${n}`);
    const ico = icoEntries(fs.readFileSync(path.join(dir, 'icon.ico')));
    assert.deepEqual(ico.map((e) => e.size), ICO_SIZES, 'the ico\'s sizes');
    for (const e of ico) assert.deepEqual(e.png, [e.size, e.size], `the ico's ${e.size} entry is a ${e.size}x${e.size} PNG`);
    const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    assert.deepEqual(conf.bundle.icon, ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.ico'], 'the files the bundle names');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('two runs write the same bytes, and the committed icons are what the script draws', () => {
  const a = tmp(), b = tmp();
  try {
    run(a); run(b);
    for (const f of [...Object.keys(FILES), 'icon.ico']) {
      const x = fs.readFileSync(path.join(a, f));
      assert.ok(x.equals(fs.readFileSync(path.join(b, f))), `${f}: the second run wrote different bytes`);
      assert.ok(x.equals(fs.readFileSync(path.join(ICONS, f))), `${f}: the committed file is not what the script draws (run it and commit the result)`);
    }
  } finally { fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }); }
});

test('the icon is the Crossover loop in Skyline\'s colours: a light tile, the dark track and the blue car', () => {
  const { w, px } = pngPixels(fs.readFileSync(path.join(ICONS, '128x128@2x.png')));
  const at = (x, y) => [...px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
  assert.deepEqual(at(128, 30), [...hex('#eef6ff'), 255], 'the tile, above the loop, is Skyline\'s --bg');
  const seen = new Set(); for (let i = 0; i < px.length; i += 4) seen.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
  assert.ok(seen.has(hex('#0b2747').join(',')), 'the track is Skyline\'s --text');
  assert.ok(seen.has(hex('#0757b3').join(',')), 'the car is Skyline\'s --accent');
});

test('on a light taskbar (#f3f3f3) the tile\'s edge reads at 24 and 32 px: at least 3:1 at the middle of every side', () => {
  const { draw } = require(SCRIPT);
  const bar = hex('#f3f3f3');
  for (const n of [24, 32]) {
    const px = draw(n), on = (x, y) => { const i = (y * n + x) * 4, a = px[i + 3] / 255; return [0, 1, 2].map((k) => Math.round(px[i + k] * a + bar[k] * (1 - a))); };
    const m = Math.floor(n / 2);
    for (const [side, line] of [['top', (k) => on(m, k)], ['bottom', (k) => on(m, n - 1 - k)], ['left', (k) => on(k, m)], ['right', (k) => on(n - 1 - k, m)]]) {
      const best = Math.max(line(0).length && contrast(line(0), bar), contrast(line(1), bar));
      assert.ok(best >= 3, `${n} px, ${side}: the edge is ${best.toFixed(2)}:1 against the taskbar, under 3:1`);
    }
    // why the rim is there: without it Skyline's light tile meets the light taskbar at about 1:1
    const bare = draw(n, { rim: false }), i = (m * n) * 4, a = bare[i + 3] / 255, edge = [0, 1, 2].map((k) => Math.round(bare[i + k] * a + bar[k] * (1 - a)));
    assert.ok(contrast(edge, bar) < 1.5, `${n} px without the rim: ${contrast(edge, bar).toFixed(2)}:1, so the rim is what makes the edge read`);
  }
});

// AMENDED (D502 part 2): the rule changed by name, the user's copy pick of 2026-10-27: the rest reads "Track builder" in sentence case (no all-caps label)
test('the title bar still reads "T-180 Track builder", now as the wordmark: the name, a hairline rule, the dimmed rest', () => {
  const html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
  assert.match(html, /<title>T-180 Track Builder<\/title>/, 'the window title is unchanged');
  const h1 = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
  assert.ok(h1 !== undefined, 'the page has its h1');
  assert.equal(h1.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), 'T-180 Track builder', 'the h1\'s text');
  assert.match(h1, /<span class="wm-name" data-tauri-drag-region>T-180<\/span>/, 'the name, in its own span, still a drag handle');
  assert.match(h1, /<span class="wm-rest" data-tauri-drag-region>Track builder<\/span>/, 'the rest, in its own span, still a drag handle');
  const css = (html.match(/header h1 \.wm-rest[^{]*\{[^}]*\}/g) || []).join('\n');
  assert.ok(css, 'the rest has its own rule');
  assert.match(css, /var\(--hair\)/, 'the rule between them is the theme\'s hairline token');
  assert.match(css, /var\(--dim\)/, 'the rest is the theme\'s dim token');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'the wordmark names no colour of its own: it follows the theme');
});
