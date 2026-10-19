// sky-prism-crisp.test.js: node --test app/test/sky-prism-crisp.test.js
// D410: Glass's night sky ('prism') is crisp at the user's own screen. Glass is drawn per pixel, but its stars were small gaussians (sigma 0.0020 rad,
// about 2.75 px at 2560 x 1440 and a 60-degree lens, so 6.5 px across at half their peak) and the moon's limb faded over 0.020 rad (about 27 px), so it
// read as low resolution. Now a star is a point about one device pixel across and the limb a pixel and a half, at any window size: the sky pass hands the
// pattern the angle of one device pixel (uPx). The prism's own GLSL is compiled into the renderer's own sky pass (SKY_VS and skyFS) in HEADLESS Chrome
// (never a window) at 2560 x 1440, DPR 1, with Glass's colours read from its CSS, looking up toward the moon. Skipped where there is no Chrome. Rows:
//   1  the stars are points: over every star found in the view, the median width at half its peak is at most 1.5 px and the 90th percentile at most
//      1.8 px (measured from the star's second moments over 13 x 13 px less its background, the measure that is fair to a point between pixels;
//      before D410: 5 px or more)
//   2  the moon's limb is sharp: along 24 radii, the 10 %-to-90 % rise from the sky to the disc is at most 2 px (before: about 16 px)
//   3  the renderer's sky pass sends uPx, the angle of one device pixel at the middle of the view (2 |up| / height), so the points stay a pixel wide
//      whatever the window's size
//   4  still the calm sky: the stars vary in brightness (the brightest at least three times the faintest found, above the sky) and stay sparse
//      (at most one in 2,000 of the view's pixels is a star)
//   5  the prism band has fine structure: along its brightest row toward the moon, what varies faster than 2 degrees is at least a quarter of what varies
//      slower (before: the band's strength wandered over tens of degrees only)
// With SKY_SHOT_DIR set, the view is also written there as prism-up-<sha or label>.png (the before and after pictures).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { chromePath, launchChrome, connect } = require('./soundrender.js');
const { recordingGL } = require('./sky-fixture.js');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const R = require(path.join(ADIR, 'preview', 'renderer.js'));
const SKY = require(path.join(ADIR, 'preview', 'sky', 'index.js'));

const CHROME = chromePath();
const skip = CHROME ? false : 'no Chrome here (set CHROME_PATH): the sky is drawn in headless Chrome';
const W = 2560, H = 1440, FOV = Math.PI / 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function colours() {
  const css = fs.readFileSync(path.join(ADIR, 'themes', 'glass.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tok = (k) => { const m = new RegExp(`${k}:\\s*color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(css); return m ? [+m[1], +m[2], +m[3]] : null; };
  const sky = tok('--sky'); if (!sky) throw new Error('glass.css has no --sky');
  return { sky, a: tok('--sky-a') || sky, b: tok('--sky-b') || sky, c: tok('--sky-c') || sky };
}
// the moon's direction in prism.js, and a view from the build camera's eye turned toward it and pitched up 40 degrees (the moon sits 10 degrees under the
// middle, the open starry sky above it)
const MOON = (() => { const v = [-0.557, 0.50, -0.663], l = Math.hypot(...v); return v.map((x) => x / l); })();
const POSE = (() => { const h = Math.hypot(MOON[0], MOON[2]), p = 40 * Math.PI / 180, f = [Math.cos(p) * MOON[0] / h, Math.sin(p), Math.cos(p) * MOON[2] / h];
  return { eye: [0, 2, 0], target: [10 * f[0], 2 + 10 * f[1], 10 * f[2]], up: [0, 1, 0], fov: FOV }; })();
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** the pixel (x right, y up from the bottom, GL rows) where the sky pass draws direction d */
function pixelOf(B, d) {
  const k = dot(d, B.fwd) / dot(B.fwd, B.fwd), nx = dot(d, B.right) / dot(B.right, B.right) / k, ny = dot(d, B.up) / dot(B.up, B.up) / k;
  return [(nx + 1) / 2 * W - 0.5, (ny + 1) / 2 * H - 0.5];
}

const PAGE = `
window.__prism = (vs, fs, col, B, px, shot) => {
  const cv = document.createElement('canvas'); cv.width = ${W}; cv.height = ${H}; const gl = cv.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  const sh = (ty, s) => { const o = gl.createShader(ty); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error('compile: ' + gl.getShaderInfoLog(o)); return o; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.useProgram(p); const a = gl.getAttribLocation(p, 'aPos'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(p, n);
  gl.uniform3fv(U('uSky'), col.sky); gl.uniform3fv(U('uSkyA'), col.a); gl.uniform3fv(U('uSkyB'), col.b); gl.uniform3fv(U('uSkyC'), col.c); gl.uniform1f(U('uTime'), 0);
  gl.uniform3fv(U('uFwd'), B.fwd); gl.uniform3fv(U('uRight'), B.right); gl.uniform3fv(U('uUp'), B.up);
  const upx = U('uPx'); if (upx) gl.uniform1f(upx, px);   // a pass without uPx (before D410) simply has no such uniform
  gl.viewport(0, 0, ${W}, ${H}); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const raw = new Uint8Array(${W * H * 4}); gl.readPixels(0, 0, ${W}, ${H}, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  const L = new Float32Array(${W * H}); for (let i = 0; i < ${W * H}; i++) L[i] = 0.2126 * raw[4 * i] + 0.7152 * raw[4 * i + 1] + 0.0722 * raw[4 * i + 2];
  window.__L = L; window.__raw = raw;
  return { shot: shot ? cv.toDataURL('image/png') : null, hasPx: !!upx };
};
// the stars: local maxima at least 4 levels over the median of their 13 x 13 window's rim, away from the edges and the moon; each one's width at half its
// peak from its second moments (FWHM = 2.355 sigma, sigma^2 the mean of the x and y moments of the light over the rim's median)
window.__stars = (mx, my, mr) => {
  const L = window.__L, w = ${W}, h = ${H}, R = 6, out = [];
  for (let y = R + 1; y < h - R - 1; y++) for (let x = R + 1; x < w - R - 1; x++) {
    const v = L[y * w + x];
    if (Math.hypot(x - mx, y - my) < 3 * mr) continue;
    let top = true; for (let j = -1; j <= 1 && top; j++) for (let i = -1; i <= 1; i++) if ((i || j) && L[(y + j) * w + x + i] >= v && !(L[(y + j) * w + x + i] === v && (j < 0 || (j === 0 && i < 0)))) { top = false; break; }
    if (!top) continue;
    const rim = []; for (let k = -R; k <= R; k++) rim.push(L[(y - R) * w + x + k], L[(y + R) * w + x + k], L[(y + k) * w + x - R], L[(y + k) * w + x + R]);
    rim.sort((a, b) => a - b); const bg = rim[rim.length >> 1];
    if (v - bg < 4) continue;
    let s = 0, sx = 0, sy = 0, sxx = 0, syy = 0;
    for (let j = -R + 1; j < R; j++) for (let i = -R + 1; i < R; i++) { const q = Math.max(0, L[(y + j) * w + x + i] - bg - 1); s += q; sx += q * i; sy += q * j; sxx += q * i * i; syy += q * j * j; }
    const mxx = sxx / s - (sx / s) ** 2, myy = syy / s - (sy / s) ** 2;
    out.push({ x, y, peak: v - bg, fwhm: 2.3548 * Math.sqrt(Math.max(0, (mxx + myy) / 2)) });
  }
  return out;
};
// the moon's limb along n radii: the image read bilinearly; the sky level 4 px outside the limb and the disc's 4 px inside; the width is the 10 %-90 %
// width of a straight ramp with that rise and the profile's steepest slope, 0.8 (inside - outside) / slope. Not where the profile crosses 10 % and 90 %:
// the face's darker patches reach the limb on some radii and shade it over its last few px, and crossings would count that shading as the edge
window.__limb = (mx, my, mr, n) => {
  const L = window.__L, w = ${W};
  const at = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, g = (i, j) => L[(y0 + j) * w + x0 + i];
    return (g(0, 0) * (1 - fx) + g(1, 0) * fx) * (1 - fy) + (g(0, 1) * (1 - fx) + g(1, 1) * fx) * fy; };
  const widths = [];
  for (let k = 0; k < n; k++) {
    const th = 2 * Math.PI * (k + 0.5) / n, c = Math.cos(th), s = Math.sin(th), f = (r) => at(mx + c * r, my + s * r);
    const inside = f(mr - 4), outside = f(mr + 4);
    let slope = 0; for (let r = mr + 4; r > mr - 4; r -= 0.1) slope = Math.max(slope, (f(r - 0.1) - f(r)) / 0.1);
    widths.push(slope > 0 ? 0.8 * (inside - outside) / slope : Infinity);
  }
  return widths;
};
// a row of the image: its luminance, left to right
window.__row = (y) => Array.from(window.__L.subarray(y * ${W}, (y + 1) * ${W}));
true`;

let ch, ws, dir, ev, B, px, view, moon, moonR;
test.before(async () => {
  B = R.skyBasis(POSE, W / H); px = 2 * Math.hypot(...B.up) / H;
  moon = pixelOf(B, MOON); moonR = 0.024 / px;
  if (skip) return;
  let tgt, send; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--enable-unsafe-swiftshader'], 't180prism-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 600)}`); return d.result.result.value; };
  await ev(PAGE);
  const shotDir = process.env.SKY_SHOT_DIR;
  view = await ev(`window.__prism(${JSON.stringify(R.SKY_VS)}, ${JSON.stringify(R.skyFS(SKY.patternSource('prism')))}, ${JSON.stringify(colours())}, ${JSON.stringify(B)}, ${px}, ${!!shotDir})`);
  if (shotDir) fs.writeFileSync(path.join(shotDir, `prism-up-${process.env.SKY_SHOT_LABEL || 'now'}.png`), Buffer.from(view.shot.split(',')[1], 'base64'));
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

test('row 1: the stars are points: their median width at half peak is at most 1.5 px and their 90th percentile at most 1.8 px, at 2560 x 1440', { skip }, async () => {
  const stars = await ev(`window.__stars(${moon[0]}, ${moon[1]}, ${moonR})`);
  assert.ok(stars.length >= 20, `enough stars in the view to measure: ${stars.length}`);
  const f = stars.map((s) => s.fwhm), med = pct(f, 0.5), p90 = pct(f, 0.9);
  assert.ok(med <= 1.5 && p90 <= 1.8, `the stars' width at half peak: median ${med.toFixed(2)} px, 90th percentile ${p90.toFixed(2)} px over ${stars.length} stars (at most 1.5 and 1.8)`);
});

test('row 2: the moon\'s limb rises from the sky to the disc within 2 px, all the way round', { skip }, async () => {
  assert.ok(moon[0] > moonR + 40 && moon[0] < W - moonR - 40 && moon[1] > moonR + 40 && moon[1] < H - moonR - 40, `the moon is in the view: at ${moon.map((v) => v.toFixed(0))}, ${moonR.toFixed(1)} px across its radius`);
  const wd = await ev(`window.__limb(${moon[0]}, ${moon[1]}, ${moonR}, 24)`), worst = Math.max(...wd);
  assert.ok(worst <= 2, `the limb's 10 %-90 % width along 24 radii: worst ${worst.toFixed(2)} px, median ${pct(wd, 0.5).toFixed(2)} px (at most 2)`);
});

test('row 3: the sky pass hands the pattern uPx, the angle of one device pixel at the middle of the view, so a point stays a pixel at any window size', () => {
  for (const [w, h] of [[2560, 1440], [1400, 860]]) {
    const { gl, calls } = recordingGL(), r = R.createRenderer(gl); r.setTheme({ skyStyle: 'prism' });
    r.draw([], POSE, { width: w, height: h }, { look: 'words', time: 0 });
    const sent = calls.find((c) => c[0] === 'uniform1f' && c[1] === 'uPx'), Bw = R.skyBasis(POSE, w / h);
    assert.ok(sent, `${w} x ${h}: the pass sends uPx`);
    assert.ok(Math.abs(sent[2] - 2 * Math.hypot(...Bw.up) / h) < 1e-12, `${w} x ${h}: uPx is 2 |up| / height (${sent[2]})`);
  }
  assert.match(R.skyFS(''), /uniform float uPx;/, 'the pass declares uPx for every style');
});

test('row 4: still the calm sky: the stars vary in brightness and stay sparse', { skip }, async () => {
  const stars = await ev(`window.__stars(${moon[0]}, ${moon[1]}, ${moonR})`), pk = stars.map((s) => s.peak);
  assert.ok(pct(pk, 0.95) >= 3 * pct(pk, 0.05), `brightness varies star to star: 5th percentile ${pct(pk, 0.05).toFixed(1)}, 95th ${pct(pk, 0.95).toFixed(1)} levels over the sky`);
  assert.ok(stars.length <= W * H / 2000, `sparse: ${stars.length} stars in ${W * H} px (at most one in 2,000)`);
});

test('row 5: the prism band has fine structure along its length, not only a slow wander', { skip }, async () => {
  // the band's brightest elevation is 0.050 rad; this view looks up 40 degrees, so the band is under it: a level view toward the moon shows it
  const lv = { ...POSE, target: [POSE.target[0], 2, POSE.target[2]] }, Bl = R.skyBasis(lv, W / H), pxl = 2 * Math.hypot(...Bl.up) / H;
  await ev(`window.__prism(${JSON.stringify(R.SKY_VS)}, ${JSON.stringify(R.skyFS(SKY.patternSource('prism')))}, ${JSON.stringify(colours())}, ${JSON.stringify(Bl)}, ${pxl}, false)`);
  const h = Math.hypot(MOON[0], MOON[2]), d = [Math.cos(0.05) * MOON[0] / h, Math.sin(0.05), Math.cos(0.05) * MOON[2] / h], y = Math.round(pixelOf(Bl, d)[1]);
  const row = await ev(`window.__row(${y})`), deg = (Math.PI / 180) / pxl, k = Math.max(1, Math.round(deg));   // about 1 degree of the row in px
  // smooth over 2 degrees (a box of 2k + 1 px): what is left is the fine structure, what is kept the slow wander
  const sm = row.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - 2 * k); j <= Math.min(row.length - 1, i + 2 * k); j++) { s += row[j]; n++; } return s / n; });
  const mid = row.slice(4 * k, row.length - 4 * k), smid = sm.slice(4 * k, row.length - 4 * k), mean = smid.reduce((a, b) => a + b, 0) / smid.length;
  const fine = Math.sqrt(mid.reduce((a, v, i) => a + (v - smid[i]) ** 2, 0) / mid.length), slow = Math.sqrt(smid.reduce((a, v) => a + (v - mean) ** 2, 0) / smid.length);
  assert.ok(fine >= 0.25 * slow && fine >= 0.8, `the band's row ${y}: fine structure ${fine.toFixed(2)} levels against a slow wander of ${slow.toFixed(2)} (at least a quarter, and at least 0.8 of a level over the dither)`);
});
