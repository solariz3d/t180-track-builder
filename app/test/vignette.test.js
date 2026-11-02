// vignette.test.js: node --test app/test/vignette.test.js
// The view's vignette (the soft darkening toward its edges) is the renderer's own last pass, and it breaks its own 8-bit banding with the sky pass's
// ordered dither. It used to be a CSS radial-gradient on #preview::after, which the page composites in 8 bits with no dither: over the dark skies it showed
// as concentric steps that followed the camera (the user, 2026-11-02: "a persistant render artifact below the red line i drew that traces it it follows me
// where eveer i go", in the space and underwater skins). Rows 1 and 2 draw with the renderer itself (app/preview/renderer.js and what it requires, run
// in HEADLESS Chrome, never a window) and read the pixels back; skipped, with the reason, where there is no Chrome. Rows:
//   1  banding: over each dark skin's own sky, down each column of the darkened lower view, the longest run of one identical 8-bit colour is at most 12 px
//      (the CSS vignette over the same frame: see the hand-back's before figures)
//   2  the look is kept: over a flat field of each skin's --sky, the darkening at sample points is the old gradient's (radial-gradient(120% 90% at 55% 38%,
//      transparent 55%, rgba(0, 0, 0, .55) 100%)) within one 8-bit step on average, and where the gradient is transparent the field is untouched
//   3  the frame: with the vignette named, its pass is the frame's last draw, over everything, keeping the canvas opaque; with it left out the frame has no
//      pass (the 'none' sky's pinned frame in sky.test.js is that case); a word that is not a vignette is refused at the skin change
//   4  the skins: the page draws no gradient on #preview::after; the preview names the vignette by --vignette, on unless a skin says none, and Skyline
//      (a light sky, where the page had turned the old one off) says none
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { chromePath, launchChrome, connect } = require('./soundrender.js');
const { recordingGL, POSE } = require('./sky-fixture.js');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const R = require(path.join(ADIR, 'preview', 'renderer.js'));
const TK = require(path.join(ADIR, 'lib', 'tokens.js'));

const CHROME = chromePath();
const skip = CHROME ? false : 'no Chrome here (set CHROME_PATH): the vignette is drawn in headless Chrome';
const SKINS = { glass: 'river', aqua: 'caustics', aurora: 'aurora', 'skyline-night': 'city' };   // the dark skins, each with its own sky (glass is the space skin, aqua the underwater one)
const W = 1400, H = 860;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const css = (skin) => fs.readFileSync(path.join(ADIR, 'themes', `${skin}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function colours(skin) {
  const s = css(skin), tok = (k) => { const m = new RegExp(`${k}:\\s*color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(s); return m ? [+m[1], +m[2], +m[3]] : null; };
  const sky = tok('--sky'), fog = tok('--fog'); if (!sky || !fog) throw new Error(`${skin}.css has no --sky or --fog`);
  return { sky, fog, skyA: tok('--sky-a') || sky, skyB: tok('--sky-b') || sky, skyC: tok('--sky-c') || sky };
}

/** renderer.js and every module it requires, as one script that defines window.__R (a CommonJS registry in the page). */
function bundle(entry) {
  const mods = new Map();
  const add = (file) => {
    if (mods.has(file)) return; const src = fs.readFileSync(file, 'utf8'); mods.set(file, { src, deps: {} });
    for (const m of src.matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) { let f = path.resolve(path.dirname(file), m[1]); if (!f.endsWith('.js')) f += '.js'; mods.get(file).deps[m[1]] = f; add(f); }
  };
  add(entry);
  const defs = [...mods].map(([f, m]) => `${JSON.stringify(f)}: { deps: ${JSON.stringify(m.deps)}, fn: function (module, exports, require) {\n${m.src}\n} }`).join(',\n');
  return `(() => { const D = {\n${defs}\n}, cache = {};
    const load = (f) => { if (cache[f]) return cache[f].exports; const m = cache[f] = { exports: {} }; D[f].fn(m, m.exports, (p) => { if (!(p in D[f].deps)) throw new Error('bundle: ' + f + ' requires ' + p); return load(D[f].deps[p]); }); return m.exports; };
    window.__R = load(${JSON.stringify(entry)}); return true; })()`;
}

// in the page: one canvas the preview's way (webgl2 or webgl, default attributes, so an alpha channel the page composites), kept for readPixels
const PAGE = `
window.__frame = (theme, pose) => {
  const cv = document.createElement('canvas'); cv.width = ${W}; cv.height = ${H};
  const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true }) || cv.getContext('webgl', { preserveDrawingBuffer: true });
  const r = window.__R.createRenderer(gl); r.setTheme(theme); r.draw([], pose, { width: ${W}, height: ${H} }, { look: 'words', time: 0 });
  const px = new Uint8Array(${W} * ${H} * 4); gl.readPixels(0, 0, ${W}, ${H}, gl.RGBA, gl.UNSIGNED_BYTE, px); r.dispose(); return px;
};
// the longest run of one identical colour down every 4th column, GL rows y0..y1 (row 0 is the bottom), counting only pixels the vignette darkens (t > 0.05)
window.__longest = (px, t) => { let L = 0; for (let x = 0; x < ${W}; x += 4) { let n = 1; for (let y = 1; y < ${H}; y++) { const k = (y * ${W} + x) * 4, j = ((y - 1) * ${W} + x) * 4;
  if (t(x, y) > 0.05 && t(x, y - 1) > 0.05 && px[k] === px[j] && px[k + 1] === px[j + 1] && px[k + 2] === px[j + 2]) { n++; if (n > L) L = n; } else n = 1; } } return L; };
true`;
// the old CSS gradient's position along its line at a pixel centre, GL coordinates: centre (55%, 38% from the top), radii 120% of the width and 90% of the height,
// transparent to 55% of the way, rgba(0, 0, 0, .55) at 100% and beyond
const T_SRC = `(x, y) => { const dx = (x + 0.5) / ${W} - 0.55, dy = (y + 0.5) / ${H} - 0.62, r = Math.hypot(dx / 1.2, dy / 0.9); return Math.min(1, Math.max(0, (r - 0.55) / 0.45)); }`;
const tAt = eval(T_SRC);   // the same function in node, for the expected darkening
const level = (pitchDeg) => { const p = pitchDeg * Math.PI / 180; return { eye: [0, 2, 0], target: [0, 2 + Math.sin(p) * 10, -Math.cos(p) * 10], up: [0, 1, 0], fov: Math.PI / 3 }; };

let ch, ws, dir, ev;
test.before(async () => {
  if (skip) return;
  let tgt, send; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--enable-unsafe-swiftshader'], 't180vig-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d)}`); return d.result.result.value; };
  await ev("document.title = 'zz-headless-test'; true");
  await ev(bundle(path.join(ADIR, 'preview', 'renderer.js')));
  await ev(PAGE);
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

test('row 1: over each dark skin\'s own sky, the darkened view shows no 8-bit steps: the longest run of one colour down a column is at most 12 px', { skip }, async (t) => {
  const runs = {};
  for (const [skin, style] of Object.entries(SKINS)) {
    const theme = { ...colours(skin), skyStyle: style, vignette: 'on' };
    runs[skin] = await ev(`window.__longest(window.__frame(${JSON.stringify(theme)}, ${JSON.stringify(level(0))}), ${T_SRC})`);
    // and over a flat field of the skin's --sky (no sky pass, so only the vignette's own dither breaks its steps)
    runs[skin + ' flat'] = await ev(`window.__longest(window.__frame(${JSON.stringify({ ...colours(skin), vignette: 'on' })}, ${JSON.stringify(level(0))}), ${T_SRC})`);
  }
  // the control: the measure sees a flat field's runs (the vignette off, no sky: every column one colour all the way down the darkened part)
  const ctl = await ev(`window.__longest(window.__frame(${JSON.stringify({ ...colours('glass'), vignette: 'none' })}, ${JSON.stringify(level(0))}), ${T_SRC})`);
  t.diagnostic(`longest flat run under the vignette, px: ${JSON.stringify(runs)}; the control (a flat field, no vignette): ${ctl}`);
  assert.ok(ctl >= 200, `the measure must see a flat field's runs: the control's longest is ${ctl} px`);
  for (const [skin, n] of Object.entries(runs)) assert.ok(n <= 12, `${skin}: a run of ${n} px of one colour under the vignette (all: ${JSON.stringify(runs)})`);
});

test('row 2: the look is kept: over a flat field the darkening is the old gradient\'s within one 8-bit step, and the middle of the view is untouched', { skip }, async (t) => {
  const PTS = [[40, 40], [700, 30], [1360, 40], [80, 300], [1320, 300], [400, 120], [1000, 120], [700, 700]];   // GL pixels: corners, bottom, sides, and the middle-top
  const report = {};
  for (const skin of Object.keys(SKINS)) {
    // only the 16 x 16 blocks and the middle pixel come back over the socket (the whole frame is 4.8 million numbers)
    const c = colours(skin), got = await ev(`(() => { const px = window.__frame(${JSON.stringify({ ...c, vignette: 'on' })}, ${JSON.stringify(level(0))});
      const blocks = ${JSON.stringify(PTS)}.map(([x0, y0]) => { const b = []; for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 16; x++) { const k = (y * ${W} + x) * 4; b.push(px[k], px[k + 1], px[k + 2]); } return b; });
      const k = (700 * ${W} + 700) * 4, bare = window.__frame(${JSON.stringify({ ...c, vignette: 'none' })}, ${JSON.stringify(level(0))});
      return { blocks, mid: [px[k], px[k + 1], px[k + 2], px[k + 3]], field: [bare[k], bare[k + 1], bare[k + 2]] }; })()`);
    const field = got.field;   // the clear colour as this GPU wrote it (0.1 of 255 is 25.5, and the clear rounds it its own way)
    for (const [p, [x0, y0]] of PTS.entries()) {
      let sum = [0, 0, 0], want = [0, 0, 0], n = 0;
      for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 16; x++) { const k = n * 3, f = 1 - 0.55 * tAt(x, y); for (let i = 0; i < 3; i++) { sum[i] += got.blocks[p][k + i]; want[i] += field[i] * f; } n++; }
      const off = sum.map((s, i) => +((s - want[i]) / n).toFixed(2));
      report[`${skin} ${x0},${y0}`] = off;
      for (const o of off) assert.ok(Math.abs(o) <= 1, `${skin} at ${x0},${y0}: the mean is ${JSON.stringify(off)} steps off the old gradient's darkening`);
    }
    // t = 0 at (700, 700): the field's own colour, exactly
    assert.deepEqual(got.mid, [...field, 255], `${skin}: where the gradient is transparent the field is untouched and opaque`);
  }
  t.diagnostic(`mean offset from the old gradient, 8-bit steps per channel: ${JSON.stringify(report)}`);
});

// AMENDED (2026-11-02, a review of the real page found it still stepped): the darkening is applied in the passes that write the background's
// final colour, before their dither (the sky pass, or a backdrop pass when there is no sky), and the blended pass is kept only for what is drawn on the
// background, by depth; app/test/vignette-page.test.js judges the real page
test('row 3: named, the background pass darkens before it dithers (a backdrop when there is no sky), and a last pass darkens only what was drawn on it, keeping the canvas opaque; left out, no pass; an unknown word is refused', () => {
  const extras = { look: 'words', grid: { positions: new Float32Array([0, 0, 0, 1, 0, 0]) }, overlay: [{ positions: new Float32Array([0, 0, 0, 0, 0, 1]), colour: [1, 0, 0], alpha: 1 }] };
  const frame = (theme) => { const { gl, calls } = recordingGL(), r = R.createRenderer(gl); if (theme) r.setTheme(theme); const at = calls.length; r.draw([], POSE, { width: 800, height: 600 }, extras); return calls.slice(at); };
  const on = frame({ vignette: 'on' }), draws = on.map((c, i) => [c, i]).filter(([c]) => c[0] === 'drawArrays' || c[0] === 'drawElements');
  const [first] = draws[0], [last, li] = draws[draws.length - 1], overlayAt = on.findIndex((c) => c[0] === 'drawArrays' && c[1] === 'LINES' && c[3] === 2);
  assert.deepEqual(first.slice(0, 4), ['drawArrays', 'TRIANGLE_STRIP', 0, 4], 'no sky: the first draw is the backdrop, one full-screen strip');
  assert.ok(on.some((c) => c[0] === 'uniform3f' && c[1] === 'uSky'), 'the backdrop is the clear colour');
  assert.deepEqual(last.slice(0, 4), ['drawArrays', 'TRIANGLE_STRIP', 0, 4], 'the last draw is one full-screen strip');
  assert.ok(overlayAt >= 0 && overlayAt < li, 'it comes after the overlay, as the page\'s layer did');
  const blend = on.slice(0, li).reverse().find((c) => c[0] === 'blendFuncSeparate'), depth = on.slice(0, li).reverse().find((c) => c[0] === 'depthFunc');
  assert.deepEqual(blend && blend.slice(1), ['ZERO', 'SRC_ALPHA', 'ZERO', 'ONE'], 'it scales what is drawn and leaves the alpha as it was, so the canvas stays opaque');
  assert.deepEqual(depth && depth.slice(1), ['GREATER'], 'only where something nearer than the background was drawn');
  assert.ok(on.slice(li).some((c) => c[0] === 'disable' && c[1] === 'BLEND') && on.slice(li).some((c) => c[0] === 'depthFunc' && c[1] === 'LESS'), 'blending is off and the depth test is LESS again after it');
  const sky = frame({ vignette: 'on', skyStyle: 'sun' });
  assert.ok(sky.some((c) => c[0] === 'uniform1f' && c[1] === 'uVig' && c[2] === 1), 'with a sky, the sky pass darkens (uVig 1)');
  assert.ok(frame({ skyStyle: 'sun' }).some((c) => c[0] === 'uniform1f' && c[1] === 'uVig' && c[2] === 0), 'a sky with no vignette named: uVig 0');
  const off = frame(null), offNone = frame({ vignette: 'none' });
  for (const [name, f] of [['no vignette named', off], ['vignette none', offNone]]) {
    assert.ok(!f.some((c) => c[0] === 'blendFuncSeparate'), `${name}: no vignette pass`);
    assert.equal(f.filter((c) => c[0] === 'drawArrays' && c[1] === 'TRIANGLE_STRIP').length, 0, `${name}: no full-screen strip (no sky named either)`);
  }
  const r = R.createRenderer(recordingGL().gl);
  assert.throws(() => r.setTheme({ vignette: 'soft' }), /vignette/, 'a word that is not on or none is refused');
});

test('row 4: the page draws no gradient on #preview::after; --vignette names it, on unless a skin says none, and Skyline says none', () => {
  const page = fs.readFileSync(path.join(ADIR, 'index.html'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of page.matchAll(/#preview::after\s*\{([^}]*)\}/g)) assert.doesNotMatch(m[1], /gradient/, 'no CSS gradient over the view: it bands in 8 bits');
  for (const skin of ['skyline', 'skyline-night', 'aurora', 'aqua', 'glass']) for (const m of css(skin).matchAll(/#preview::after\s*\{([^}]*)\}/g)) assert.doesNotMatch(m[1], /gradient/, `${skin}.css`);
  const tokens = (vals) => TK.createTokens({ document: { documentElement: { getAttribute: () => null } }, getComputedStyle: () => ({ getPropertyValue: (k) => (k in vals ? ` ${vals[k]}` : '') }) });
  assert.equal(R.themeFrom(tokens({})).vignette, 'on', 'no token: the vignette, as the page drew it for every skin but Skyline');
  assert.equal(R.themeFrom(tokens({ '--vignette': 'none' })).vignette, 'none');
  assert.match(css('skyline'), /\[data-theme="skyline"\]\s*\{[^}]*--vignette:\s*none;/, 'Skyline keeps the dark lens off its light sky');
  for (const skin of ['skyline-night', 'aurora', 'aqua', 'glass']) assert.doesNotMatch(css(skin), /--vignette:\s*none/, `${skin} keeps it`);
});
