// sky.test.js: node --test app/test/sky.test.js
// D384 part 1 (pane B): the skin skies become a skybox. The WebGL view draws the sky at infinity in a full-screen pass before the track, each pixel's
// direction from the inverse of the camera's view-projection with the rotation only, so the sky stays put in the world as the camera turns. Stated first:
//   · a sky feature moves on screen by exactly the camera's yaw (where a point infinitely far in that direction projects); moving or zooming without
//     turning leaves every sky direction, and the pass's calls, unchanged
//   · 'none' (SIGIL, the one skin left without a sky since D384 widened) draws the very calls cbd7a40 (v0.4.3) drew: no sky pass at all
//   · an unknown style fails loudly, at setTheme and through the registry
//   · the skin names its sky with --sky-style (and --sky-a/b/c, falling back to --sky); Skyline's is 'sun', and its screen-pinned overlay is gone
//   · the drift stops under prefers-reduced-motion: the preview hands the pass t = 0
//   · D384 widened: Glass names the new 'prism' sky (a registered style the page's loader loads); SIGIL alone names none
//   · D391: every style keeps the two GLSL rules (no smoothstep with literal edge0 >= edge1, no sin hash), and the check is not vacuous
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const R = require(path.join(ADIR, 'preview', 'renderer.js'));
const SKY = require(path.join(ADIR, 'preview', 'sky', 'index.js'));
const TK = require(path.join(ADIR, 'lib', 'tokens.js'));
const M = require(path.join(ADIR, 'camera', 'math.js'));
const { recordingGL, drawScene, POSE } = require('./sky-fixture.js');
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'sky-none-cbd7a40.json'), 'utf8'));

const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
/** Where the sky pass puts a world direction d on screen: the ndc (x, y) whose ray fwd + x·right + y·up points along d. */
function skyNdc(B, d) { const k = dot(d, B.fwd) / dot(B.fwd, B.fwd); return [dot(d, B.right) / dot(B.right, B.right) / k, dot(d, B.up) / dot(B.up, B.up) / k]; }
/** Where the full view-projection puts a point very far along d from the eye: the truth for something at infinity. */
function farNdc(pose, aspect, d) { const p = M.apply(M.viewProj(pose, aspect), pose.eye.map((e, i) => e + d[i] * 5000)); return [p[0] / p[3], p[1] / p[3]]; }
const yawed = (pose, a) => { const f = sub(pose.target, pose.eye), c = Math.cos(a), s = Math.sin(a); return { ...pose, target: [pose.eye[0] + c * f[0] + s * f[2], pose.target[1], pose.eye[2] - s * f[0] + c * f[2]] }; };

test('a sky feature moves on screen by the camera\'s yaw, exactly where a point infinitely far in that direction would go', () => {
  const pose = { eye: [5, 2, 30], target: [5, 2, 0], up: [0, 1, 0], fov: 1 }, aspect = 1.6, tanX = Math.tan(0.5) * aspect;
  const d = unit([Math.sin(0.15), 0.2, -Math.cos(0.15)]);   // a feature a little right of straight ahead, above the horizon
  const x0 = skyNdc(R.skyBasis(pose, aspect), d);
  for (const a of [0.05, 0.1, -0.2]) {
    const p = yawed(pose, a), B = R.skyBasis(p, aspect), at = skyNdc(B, d), truth = farNdc(p, aspect, d);
    assert.ok(Math.abs(at[0] - truth[0]) < 1e-3 && Math.abs(at[1] - truth[1]) < 1e-3, `yaw ${a}: the sky puts the feature where the camera projects it (${at} vs ${truth})`);
    // turning left (a > 0, counter-clockwise from above) moves the feature right on screen, by the yaw in angle
    const before = Math.atan(x0[0] * tanX), after = Math.atan(at[0] * tanX);
    assert.ok(Math.abs((after - before) - a) < 0.02, `yaw ${a}: the feature's bearing on screen moved by ${(after - before).toFixed(4)}`);
  }
});

test('moving or zooming without turning leaves every sky direction, and the sky pass\'s calls, unchanged', () => {
  const aspect = 800 / 600, B0 = R.skyBasis(POSE, aspect);
  const moved = { ...POSE, eye: POSE.eye.map((v, i) => v + [300, -20, 75][i]), target: POSE.target.map((v, i) => v + [300, -20, 75][i]) };
  assert.deepEqual(R.skyBasis(moved, aspect), B0, 'moved: the same directions');
  const nearer = { ...POSE, eye: POSE.eye.map((v, i) => (v + POSE.target[i]) / 2) };   // a zoom in the build view: the eye slides along its view line
  const B1 = R.skyBasis(nearer, aspect);
  for (const k of ['fwd', 'right', 'up']) for (let i = 0; i < 3; i++) assert.ok(Math.abs(B1[k][i] - B0[k][i]) < 1e-9, `zoomed: ${k} unchanged`);
  const sky = (pose) => { const { gl, calls } = recordingGL(), r = R.createRenderer(gl); r.setTheme({ skyStyle: 'sun' }); r.draw([], pose, { width: 800, height: 600 }, { look: 'words', time: 3 }); return calls.filter((c) => /^uniform/.test(c[0]) && /^uSky|^uFwd|^uRight|^uUp/.test(c[1])); };
  const a = sky(POSE), b = sky(moved);
  assert.ok(a.some((c) => c[1] === 'uFwd'), 'the pass sends its directions'); assert.deepEqual(b, a, 'moved: identical sky uniforms');
});

test('the sky pass runs before the track, over the whole view, without writing depth, and its rays come from the basis', () => {
  const { gl, calls } = recordingGL(), r = R.createRenderer(gl); r.setTheme({ skyStyle: 'sun' });
  r.draw([], POSE, { width: 800, height: 600 }, { look: 'words', time: 2, grid: { positions: new Float32Array([0, 0, 0, 1, 0, 0]) } });
  const names = calls.map((c) => c[0] + (c[0] === 'depthMask' ? ':' + c[1] : '')), sky = names.indexOf('drawArrays'), clear = names.indexOf('clear');
  const B = R.skyBasis(POSE, 800 / 600), fwd = calls.find((c) => c[1] === 'uFwd');
  assert.ok(clear >= 0 && sky > clear, 'drawn after the clear'); assert.equal(calls[sky][1], 'TRIANGLE_STRIP', 'one full-screen strip');
  assert.ok(names.slice(clear, sky).includes('depthMask:false'), 'depth write off for the sky'); assert.ok(names.slice(sky).includes('depthMask:true'), 'and back on for the track');
  assert.deepEqual(fwd.slice(2).map((v) => +v.toFixed(9)), B.fwd.map((v) => +v.toFixed(9)), 'the forward ray is the basis\'s');
  assert.ok(calls.findIndex((c, i) => i > sky && c[0] === 'drawArrays' && c[1] === 'LINES') > sky, 'the grid draws after the sky');
  assert.ok(calls.some((c) => c[0] === 'uniform1f' && c[1] === 'uTime' && c[2] === 2), 'the time reaches the pattern');
  assert.match(R.SKY_VS, /uFwd \+ aPos\.x \* uRight \+ aPos\.y \* uUp/, 'the vertex shader builds each ray from the basis');
});

test('\'none\' draws the very calls cbd7a40 drew: SIGIL, the one skin left without a sky', () => {
  assert.deepEqual(drawScene(R), BASE, 'no theme: cbd7a40\'s calls');
  assert.deepEqual(drawScene(R, { setTheme: (r) => r.setTheme({ skyStyle: 'none', sky: [...R.CLEAR] }) }), BASE, 'none: cbd7a40\'s calls');
  assert.deepEqual(drawScene(R, { setTheme: (r) => { r.setTheme({ skyStyle: 'sun' }); r.setTheme({ skyStyle: 'none' }); } }), BASE, 'back to none from a sky: cbd7a40\'s calls again');
});

test('an unknown sky style fails loudly, at setTheme and in the registry; a style not built yet says so', () => {
  const r = R.createRenderer(recordingGL().gl);
  assert.throws(() => r.setTheme({ skyStyle: 'clouds' }), /no style named "clouds"/);
  assert.throws(() => r.setTheme({ skyStyle: 3 }), /no style named 3/);
  assert.throws(() => SKY.patternSource('Sun'), /no style named "Sun"/);
  assert.deepEqual([...SKY.STYLES], ['none', 'sun', 'prism', 'caustics', 'aurora']);
  assert.equal(SKY.patternSource('none'), null);
  assert.match(SKY.patternSource('sun'), /vec3\s+skyPattern\s*\(\s*vec3\s+dir\s*,\s*float\s+t\s*\)/);
});

test('the page\'s own loader (app/lib/cjs.js, which follows only written-out requires) loads every sky style with the renderer', async () => {
  const { loadCjs } = require(path.join(ADIR, 'lib', 'cjs.js')), REPO = path.join(ADIR, '..');
  const Rp = await loadCjs('app/preview/renderer.js', async (p) => fs.readFileSync(path.join(REPO, p), 'utf8'));
  const r = Rp.createRenderer(recordingGL().gl);
  r.setTheme({ skyStyle: 'sun' }); r.setTheme({ skyStyle: 'prism' });
  for (const s of ['caustics', 'aurora']) {
    try { r.setTheme({ skyStyle: s }); } catch (e) { assert.match(e.message, /not built yet/, `${s}: loaded, and either built or saying it is not (not "could not be loaded")`); }
  }
});

test('the skin names its sky with --sky-style, and its sky colours with --sky-a/b/c, each falling back to --sky', () => {
  const tokens = (vals) => TK.createTokens({ document: { documentElement: { getAttribute: () => null } }, getComputedStyle: () => ({ getPropertyValue: (k) => (k in vals ? ` ${vals[k]}` : '') }) });
  const none = R.themeFrom(tokens({}));
  assert.equal(none.skyStyle, 'none', 'no token: no sky');
  assert.deepEqual(none.skyA, [...R.CLEAR]); assert.deepEqual(none.skyC, [...R.CLEAR]);
  const sun = R.themeFrom(tokens({ '--sky-style': 'sun', '--sky': 'color(srgb 0.3 0.6 0.9)', '--sky-a': 'color(srgb 0.1 0.4 0.8)' }));
  assert.equal(sun.skyStyle, 'sun'); assert.deepEqual(sun.skyA, [0.1, 0.4, 0.8]); assert.deepEqual(sun.skyB, [0.3, 0.6, 0.9], '--sky-b missing: --sky');
  const bare = R.themeFrom(tokens({ '--sky-style': 'sun', '--sky': 'color(srgb 0.2 0.5 0.7)' }));
  for (const k of ['skyA', 'skyB', 'skyC']) assert.deepEqual(bare[k], [0.2, 0.5, 0.7], `${k} missing: the skin's --sky, not today's clear colour`);
  assert.equal(R.themeFrom(tokens({ '--sky-style': ' "aurora" ' })).skyStyle, 'aurora', 'quotes and spaces are not part of the name');
  const css = fs.readFileSync(path.join(ADIR, 'themes', 'skyline.css'), 'utf8');
  assert.match(css, /\[data-theme="skyline"\]\s*\{[^}]*--sky-style:\s*sun;/, 'Skyline names the sun');
  // the screen-pinned haze is gone; the rule that stays only keeps the base's dark lens vignette off a light sky, as D379 did
  const after = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/#preview::after\s*\{([^}]*)\}/g)].map((m) => m[1].trim());
  assert.deepEqual(after, ['background: none;'], 'Skyline\'s screen-pinned sky overlay is gone: its view overlay draws nothing');
});

test('Glass names the prism sky, a built style; SIGIL alone names none', () => {
  assert.match(SKY.patternSource('prism'), /vec3\s+skyPattern\s*\(\s*vec3\s+dir\s*,\s*float\s+t\s*\)/, 'prism is built');
  const r = R.createRenderer(recordingGL().gl); r.setTheme({ skyStyle: 'prism' });
  const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const glass = strip(fs.readFileSync(path.join(ADIR, 'themes', 'glass.css'), 'utf8'));
  assert.match(glass, /\[data-theme="glass"\]\s*\{[^}]*--sky-style:\s*prism;/, 'Glass names the prism');
  // SIGIL is the page with no skin: the page's own style sets no --sky-style, so the renderer's 'none' holds
  const html = strip(fs.readFileSync(path.join(ADIR, 'index.html'), 'utf8'));
  assert.doesNotMatch(html, /--sky-style/, 'the base page (SIGIL) names no sky');
});

test('the drift stops under prefers-reduced-motion: the preview hands the sky pass t = 0', () => {
  const P = require(path.join(ADIR, 'preview', 'preview.js'));
  const run = (reduce) => {
    const times = [], gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0,
      uniform1f: (n, v) => { if (n === 'uTime') times.push(v); } }, { get: (t, k) => (k in t ? t[k] : () => {}) });
    const on = () => () => {}, q = []; let now = 0;
    const html = { getAttribute: () => 'skyline' };
    const win = { devicePixelRatio: 1, document: { hidden: false, activeElement: null, body: {}, documentElement: html, addEventListener: on, removeEventListener: on }, addEventListener: on, removeEventListener: on,
      requestAnimationFrame: (f) => q.push(f), cancelAnimationFrame() {}, getComputedStyle: () => ({ getPropertyValue: (k) => (k === '--sky-style' ? ' sun' : '') }),
      matchMedia: (m) => ({ matches: reduce && /prefers-reduced-motion:\s*reduce/.test(m), addEventListener() {}, removeEventListener() {} }) };
    const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener: on, removeEventListener: on };
    const shell = { getState: () => ({ resolved: { segments: [], closed: false } }), subscribe: () => () => {} };
    const p = P.createPreview({ canvas, shell, win });
    for (let i = 0; i < 4; i++) { now += 500; const f = q.splice(0); for (const g of f) g(now); }
    p.dispose(); return times;
  };
  const moving = run(false), still = run(true);
  assert.ok(moving.length >= 3 && moving[moving.length - 1] > moving[0], `the sky drifts in time (${moving})`);
  assert.ok(still.length >= 3 && still.every((t) => t === 0), `reduced motion: every frame at t = 0 (${still})`);
});
// D391 (E's 0.4.4 review, findings 1 and 3; the librarian's ruling, exo_memory/librarian/2026-10-18.md 13:33): the sky contract's two GLSL rules.
// A literal smoothstep whose edge0 >= edge1 is undefined in GLSL ES 1.00, and a sin hash (fract(sin(dot(p, ...)) * k)) feeds sin arguments in the
// tens of thousands, which GPUs reduce differently. Every style is checked as its module writes it (not through patternSource, which now refuses them).
test('D391: every sky style keeps the GLSL rules: no smoothstep with literal edge0 >= edge1, no sin hash', () => {
  for (const s of SKY.STYLES.filter((x) => x !== 'none')) {
    const src = require(path.join(ADIR, 'preview', 'sky', `${s}.js`)).source();
    assert.deepEqual(SKY.contractProblems(s, src), [], `${s}.js`);
  }
});
test('D391: the GLSL rule check refuses each broken form and keeps the good ones (it is not vacuous)', () => {
  for (const bad of ['smoothstep(0.0, -0.6, h)', 'smoothstep(0.5, 0.5, x)', 'smoothstep( .3 ,0.1, x)', 'float n = fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);']) {
    assert.ok(SKY.contractProblems('t', bad).length > 0, `refused: ${bad}`);
  }
  for (const good of ['smoothstep(0.0, 0.6, -h)', 'smoothstep(-0.35, 0.17, el)', 'smoothstep(.1, .2, x)', 'float w = sin(az * 2.0 + t * 0.01);', 'smoothstep(a, b, x)', '// smoothstep(0.0, -0.6, h) in a comment']) {
    assert.deepEqual(SKY.contractProblems('t', good), [], `kept: ${good}`);
  }
});
