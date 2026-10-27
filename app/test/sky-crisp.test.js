// sky-crisp.test.js: node --test app/test/sky-crisp.test.js
// D410, widened in D416: every night sky is drawn at the user's own pixels. The canvas is native (preview.js backingSize: css x devicePixelRatio), so a
// star or an edge is sharp only if the sky's GLSL sizes it in device pixels; sized in sky angles or grid cells it is a pixel only by luck, and on a
// scaled monitor it grows. The sky pass hands every style the angle of one device pixel (uPx). Each night style's own GLSL is compiled into the
// renderer's own sky pass (SKY_VS and skyFS) in HEADLESS Chrome (never a window), with its look's colours read from its CSS, looking up, at the backing
// store of a 2560 x 1440 css view at DPR 1 (2560 x 1440 device px) AND at DPR 1.5 (3840 x 2160, a scaled monitor), so "native" is proved at two pixel
// densities. Skipped where there is no Chrome. The looks: Glass's river of stars (river, D416), the prism sky (D410's Glass sky, still a style), Aurora's
// curtains (aurora), Skyline Night's city (city) and Aqua's sea, whose stars are its motes (caustics). Rows:
//   1  (AMENDED D429: Aurora's measured with its curtains' colours zeroed, see the row) the stars are points, per style, at both densities: over every star found in the open sky (12 degrees up and higher, away from the moon, and
//      for the sea under Snell's window), the median width at half its peak is at most 1.5 px and the 90th percentile at most 1.8 px. Measured from
//      the star's second moments over 13 x 13 px less its sky (a plane through the window's rim, so a sloped sky is not read as width), the measure
//      that is fair to a point between pixels, and only on stars with no
//      other star within 7 px, so a crowded river is not read as wide stars (before: prism 5 px or more; aurora and city cell-unit gaussians)
//   2  the prism moon's limb is sharp, at both densities: along 24 radii its rise from the sky to the disc is at most 2 px
//   3  the renderer's sky pass sends uPx, the angle of one device pixel at the middle of the view (2 |up| / height), whatever the window's size
//   4  the prism sky is still calm: the stars vary in brightness and stay sparse (at most one in 2,000 of the view's pixels is a star)
//   5  the prism band has fine structure: what varies faster than 2 degrees is at least a quarter of what varies slower
//   6  the stars can be seen (D416, the user looks at them): in the river, the aurora and the city, the median star stands at least 10 levels over
//      its sky and the brightest tenth at least 30 (registered before measuring)
// With SKY_SHOT_DIR set, each style's DPR 1 view is also written there as <style>-up-<SKY_SHOT_LABEL>.png, at full size (the before and after shots).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { chromePath, launchChrome, connect } = require('./soundrender.js');
const { recordingGL } = require('./sky-fixture.js');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const R = require(path.join(ADIR, 'preview', 'renderer.js'));
const SKY = require(path.join(ADIR, 'preview', 'sky', 'index.js'));
const P = require(path.join(ADIR, 'preview', 'preview.js'));

const CHROME = chromePath();
const skip = CHROME ? false : 'no Chrome here (set CHROME_PATH): the sky is drawn in headless Chrome';
const FOV = Math.PI / 3;
// the page's own backing stores for a 2560 x 1440 css view at DPR 1 and at DPR 1.5
const DENS = [1, 1.5].map((dpr) => ({ dpr, ...P.backingSize(2560, 1440, dpr) }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function colours(theme) {
  const css = fs.readFileSync(path.join(ADIR, 'themes', `${theme}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tok = (k) => { const m = new RegExp(`${k}:\\s*color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(css); return m ? [+m[1], +m[2], +m[3]] : null; };
  const sky = tok('--sky'); if (!sky) throw new Error(`${theme}.css has no --sky`);
  return { sky, a: tok('--sky-a') || sky, b: tok('--sky-b') || sky, c: tok('--sky-c') || sky };
}
// the prism moon's direction, and views from the build camera's eye turned toward its azimuth and pitched up (the sea's lower, under Snell's window)
const MOON = (() => { const v = [-0.557, 0.50, -0.663], l = Math.hypot(...v); return v.map((x) => x / l); })();
const poseAt = (deg) => { const h = Math.hypot(MOON[0], MOON[2]), p = deg * Math.PI / 180, f = [Math.cos(p) * MOON[0] / h, Math.sin(p), Math.cos(p) * MOON[2] / h];
  return { eye: [0, 2, 0], target: [10 * f[0], 2 + 10 * f[1], 10 * f[2]], up: [0, 1, 0], fov: FOV }; };
const POSE = poseAt(40);
// per style: the look whose colours it wears, the pitch it is seen at, and the elevations (rad) where its stars are looked for
const LOOKS = {
  river: { theme: 'glass', pitch: 40, el: [0.21, 1.6], name: "Glass's river of stars" },
  prism: { theme: 'glass', pitch: 40, el: [0.21, 1.6], moon: true, name: 'the prism sky' },
  aurora: { theme: 'aurora', pitch: 40, el: [0.21, 1.6], name: "Aurora's sky", starsOnly: true },
  city: { theme: 'skyline-night', pitch: 40, el: [0.21, 1.6], name: "Skyline Night's city sky" },
  caustics: { theme: 'aqua', pitch: 20, el: [0.21, 0.55], name: "Aqua's sea (its motes)" },
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** the pixel (x right, y up from the bottom, GL rows) where the sky pass draws direction d, in a W x H view */
function pixelOf(B, d, W, H) {
  const k = dot(d, B.fwd) / dot(B.fwd, B.fwd), nx = dot(d, B.right) / dot(B.right, B.right) / k, ny = dot(d, B.up) / dot(B.up, B.up) / k;
  return [(nx + 1) / 2 * W - 0.5, (ny + 1) / 2 * H - 0.5];
}

const PAGE = `
window.__render = (vs, fs, col, B, px, W, H, shot) => {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const gl = cv.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  const sh = (ty, s) => { const o = gl.createShader(ty); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error('compile: ' + gl.getShaderInfoLog(o)); return o; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.useProgram(p); const a = gl.getAttribLocation(p, 'aPos'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(p, n);
  gl.uniform3fv(U('uSky'), col.sky); gl.uniform3fv(U('uSkyA'), col.a); gl.uniform3fv(U('uSkyB'), col.b); gl.uniform3fv(U('uSkyC'), col.c); gl.uniform1f(U('uTime'), 0);
  gl.uniform3fv(U('uFwd'), B.fwd); gl.uniform3fv(U('uRight'), B.right); gl.uniform3fv(U('uUp'), B.up);
  const upx = U('uPx'); if (upx) gl.uniform1f(upx, px);   // a pass without uPx (before D410) simply has no such uniform
  gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const raw = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  const L = new Float32Array(W * H); for (let i = 0; i < W * H; i++) L[i] = 0.2126 * raw[4 * i] + 0.7152 * raw[4 * i + 1] + 0.0722 * raw[4 * i + 2];
  window.__L = L; window.__W = W; window.__H = H; window.__B = B;
  window.__shot = shot ? cv.toDataURL('image/png') : null; gl.getExtension('WEBGL_lose_context') && gl.getExtension('WEBGL_lose_context').loseContext();
  return { shot: window.__shot ? window.__shot.length : 0, hasPx: !!upx };
};
// the stars: local maxima at least 4 levels over the median of their 13 x 13 window's rim, inside the elevations given, away from the moon (if any);
// each one's width at half its peak from its second moments (FWHM = 2.355 sigma, sigma^2 the mean of the x and y moments of the light over the rim's
// median). A star with another within 7 px is not measured: its neighbour's light would widen it
window.__stars = (mx, my, mr, elMin, elMax) => {
  const L = window.__L, w = window.__W, h = window.__H, B = window.__B, R = 6, found = [];
  const el = (x, y) => { const nx = (x + 0.5) / w * 2 - 1, ny = (y + 0.5) / h * 2 - 1, d = [0, 1, 2].map((i) => B.fwd[i] + nx * B.right[i] + ny * B.up[i]);
    return Math.asin(d[1] / Math.hypot(d[0], d[1], d[2])); };
  for (let y = R + 1; y < h - R - 1; y++) for (let x = R + 1; x < w - R - 1; x++) {
    const v = L[y * w + x];
    let top = true; for (let j = -1; j <= 1 && top; j++) for (let i = -1; i <= 1; i++) if ((i || j) && L[(y + j) * w + x + i] >= v && !(L[(y + j) * w + x + i] === v && (j < 0 || (j === 0 && i < 0)))) { top = false; break; }
    if (!top) continue;
    // the sky under the star: a plane through the rim (its slope by least squares, its level the rim's median less that slope), so a star on a sloped
    // sky (a curtain's edge, Snell's window) is measured over its own sky, not over a level that leaves half the slope in its light (D416)
    let gi = 0, gj = 0, ss = 0; const pts = [];
    for (let k = -R; k <= R; k++) pts.push([k, -R, L[(y - R) * w + x + k]], [k, R, L[(y + R) * w + x + k]], [-R, k, L[(y + k) * w + x - R]], [R, k, L[(y + k) * w + x + R]]);
    for (const [i, j, l] of pts) { gi += i * l; gj += j * l; ss += i * i; }
    gi /= ss; gj /= ss;   // the rim is symmetric: sum i = sum j = sum ij = 0 and sum i^2 = sum j^2
    const lev = pts.map(([i, j, l]) => l - gi * i - gj * j).sort((a, b) => a - b), bg = lev[lev.length >> 1];
    if (v - bg < 4) continue;
    if (mr > 0 && Math.hypot(x - mx, y - my) < 3 * mr) continue;
    const e = el(x, y); if (e < elMin || e > elMax) continue;
    found.push({ x, y, bg, gi, gj, peak: v - bg });
  }
  const grid = new Map(), key = (x, y) => (x >> 3) * 100000 + (y >> 3);
  for (const s of found) { const k = key(s.x, s.y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s); }
  const out = [];
  for (const s of found) {
    let alone = true;
    for (let gx = (s.x >> 3) - 1; gx <= (s.x >> 3) + 1 && alone; gx++) for (let gy = (s.y >> 3) - 1; gy <= (s.y >> 3) + 1; gy++) {
      for (const o of grid.get(gx * 100000 + gy) || []) if (o !== s && Math.max(Math.abs(o.x - s.x), Math.abs(o.y - s.y)) <= 7) { alone = false; break; }
      if (!alone) break;
    }
    if (!alone) continue;
    let q0 = 0, sx = 0, sy = 0, sxx = 0, syy = 0;
    for (let j = -R + 1; j < R; j++) for (let i = -R + 1; i < R; i++) { const q = Math.max(0, L[(s.y + j) * w + s.x + i] - (s.bg + s.gi * i + s.gj * j) - 1); q0 += q; sx += q * i; sy += q * j; sxx += q * i * i; syy += q * j * j; }
    const mxx = sxx / q0 - (sx / q0) ** 2, myy = syy / q0 - (sy / q0) ** 2;
    out.push({ peak: s.peak, fwhm: 2.3548 * Math.sqrt(Math.max(0, (mxx + myy) / 2)) });
  }
  return { measured: out, found: found.length };
};
// the moon's limb along n radii: the image read bilinearly; the sky level 4 px outside the limb and the disc's 4 px inside; the width is the 10 %-90 %
// width of a straight ramp with that rise and the profile's steepest slope, 0.8 (inside - outside) / slope. Not where the profile crosses 10 % and 90 %:
// the face's darker patches reach the limb on some radii and shade it over its last few px, and crossings would count that shading as the edge
window.__limb = (mx, my, mr, n) => {
  const L = window.__L, w = window.__W;
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
window.__row = (y) => Array.from(window.__L.subarray(y * window.__W, (y + 1) * window.__W));
true`;

let ch, ws, dir, ev;
test.before(async () => {
  if (skip) return;
  let tgt, send; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--enable-unsafe-swiftshader'], 't180crisp-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 600)}`); return d.result.result.value; };
  await ev("document.title = 'zz-headless-test'; true");   // D484: a headless page is always titled so, first thing
  await ev(PAGE);
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

/** draw a style at one density, from a pose; the view stays on the page (window.__L) until the next draw */
async function draw(style, den, pose, shot, starsOnly = false) {
  assert.ok(SKY.STYLES.includes(style), `${style} is a registered sky style (the styles: ${SKY.STYLES.join(', ')})`);
  const { width: W, height: H } = den, B = R.skyBasis(pose, W / H), px = 2 * Math.hypot(...B.up) / H;
  const v = await ev(`window.__render(${JSON.stringify(R.SKY_VS)}, ${JSON.stringify(R.skyFS(SKY.patternSource(style)))}, ${JSON.stringify(starsOnly ? { ...colours(LOOKS[style].theme), a: [0, 0, 0], b: [0, 0, 0] } : colours(LOOKS[style].theme))}, ${JSON.stringify(B)}, ${px}, ${W}, ${H}, ${!!shot})`);
  if (shot) {   // fetched in slices: a whole full-size PNG in one reply (over about 4 MB, Aurora's at DPR 1) closes the DevTools socket
    let url = ''; for (let i = 0; i < v.shot; i += 1e6) url += await ev(`window.__shot.slice(${i}, ${i + 1e6})`);
    fs.writeFileSync(path.join(process.env.SKY_SHOT_DIR, `${style}-up-${process.env.SKY_SHOT_LABEL || 'now'}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  return { W, H, B, px };
}
// each style's stars (and the prism's limb) at each density, drawn once and kept for every row that reads them
const seen = new Map();
async function look(style, den, starsOnly = false) {
  const k = `${style}@${den.dpr}${starsOnly ? ':stars' : ''}`;
  if (seen.has(k)) return seen.get(k);
  const L = LOOKS[style], v = await draw(style, den, poseAt(L.pitch), den.dpr === 1 && !!process.env.SKY_SHOT_DIR && !starsOnly, starsOnly);
  const moon = L.moon ? pixelOf(v.B, MOON, v.W, v.H) : [0, 0], moonR = L.moon ? 0.024 / v.px : 0;
  const stars = await ev(`window.__stars(${moon[0]}, ${moon[1]}, ${moonR}, ${L.el[0]}, ${L.el[1]})`);
  const limb = L.moon ? await ev(`window.__limb(${moon[0]}, ${moon[1]}, ${moonR}, 24)`) : null;
  const r = { ...v, stars, limb, moon, moonR };
  seen.set(k, r); return r;
}

// AMENDED (D429): a style with `starsOnly` (Aurora) has row 1 measure its stars with the curtains' and corona's colours (--sky-a, --sky-b) zeroed. D403's
// curtains have fine rays, and the star finder took about 2,400 ray peaks for stars (3,655 found, p90 5.69 px); with the curtains zeroed it finds
// 1,251 stars, p90 1.19 px. The stars are added over the sky whatever it holds, so their width is the same; row 6 still sees them over the curtains
for (const style of Object.keys(LOOKS)) {
  test(`row 1 (${style}): ${LOOKS[style].name}: the stars are points, median width at half peak at most 1.5 px and 90th percentile at most 1.8 px, at DPR 1 and DPR 1.5`, { skip }, async (t) => {
    for (const den of DENS) {
      const { stars } = await look(style, den, !!LOOKS[style].starsOnly), f = stars.measured.map((s) => s.fwhm);
      t.diagnostic(`DPR ${den.dpr} (${den.width} x ${den.height}): ${stars.found} stars found, ${f.length} lone; width at half peak median ${pct(f, 0.5).toFixed(2)} px, p90 ${pct(f, 0.9).toFixed(2)} px`);
      assert.ok(f.length >= 20, `DPR ${den.dpr} (${den.width} x ${den.height}): enough lone stars in the view to measure: ${f.length} of ${stars.found} found`);
      const med = pct(f, 0.5), p90 = pct(f, 0.9);
      assert.ok(med <= 1.5 && p90 <= 1.8, `DPR ${den.dpr} (${den.width} x ${den.height}): the stars' width at half peak: median ${med.toFixed(2)} px, 90th percentile ${p90.toFixed(2)} px over ${f.length} lone stars of ${stars.found} found (at most 1.5 and 1.8)`);
    }
  });
}

test('row 2: the prism moon\'s limb rises from the sky to the disc within 2 px, all the way round, at DPR 1 and DPR 1.5', { skip }, async (t) => {
  for (const den of DENS) {
    const { moon, moonR, limb } = await look('prism', den);
    t.diagnostic(`DPR ${den.dpr}: limb worst ${Math.max(...limb).toFixed(2)} px, median ${pct(limb, 0.5).toFixed(2)} px`);
    assert.ok(moon[0] > moonR + 40 && moon[0] < den.width - moonR - 40 && moon[1] > moonR + 40 && moon[1] < den.height - moonR - 40, `DPR ${den.dpr}: the moon is in the view: at ${moon.map((v) => v.toFixed(0))}, ${moonR.toFixed(1)} px across its radius`);
    const worst = Math.max(...limb);
    assert.ok(worst <= 2, `DPR ${den.dpr}: the limb's 10 %-90 % width along 24 radii: worst ${worst.toFixed(2)} px, median ${pct(limb, 0.5).toFixed(2)} px (at most 2)`);
  }
});

test('row 3: the sky pass hands the pattern uPx, the angle of one device pixel at the middle of the view, so a point stays a pixel at any window size', () => {
  for (const [w, h] of [[2560, 1440], [3840, 2160], [1400, 860]]) {
    const { gl, calls } = recordingGL(), r = R.createRenderer(gl); r.setTheme({ skyStyle: 'prism' });
    r.draw([], POSE, { width: w, height: h }, { look: 'words', time: 0 });
    const sent = calls.find((c) => c[0] === 'uniform1f' && c[1] === 'uPx'), Bw = R.skyBasis(POSE, w / h);
    assert.ok(sent, `${w} x ${h}: the pass sends uPx`);
    assert.ok(Math.abs(sent[2] - 2 * Math.hypot(...Bw.up) / h) < 1e-12, `${w} x ${h}: uPx is 2 |up| / height (${sent[2]})`);
  }
  assert.match(R.skyFS(''), /uniform float uPx;/, 'the pass declares uPx for every style');
});

test('row 4: the prism sky is still calm: the stars vary in brightness and stay sparse', { skip }, async () => {
  const den = DENS[0], { stars } = await look('prism', den), pk = stars.measured.map((s) => s.peak);
  assert.ok(pct(pk, 0.95) >= 3 * pct(pk, 0.05), `brightness varies star to star: 5th percentile ${pct(pk, 0.05).toFixed(1)}, 95th ${pct(pk, 0.95).toFixed(1)} levels over the sky`);
  assert.ok(stars.found <= den.width * den.height / 2000, `sparse: ${stars.found} stars in ${den.width * den.height} px (at most one in 2,000)`);
});

test('row 5: the prism band has fine structure along its length, not only a slow wander', { skip }, async () => {
  // the band's brightest elevation is 0.050 rad; a level view toward the moon shows it
  const den = DENS[0], lv = { ...POSE, target: [POSE.target[0], 2, POSE.target[2]] }, { W, H, B: Bl, px: pxl } = await draw('prism', den, lv, false);
  const h = Math.hypot(MOON[0], MOON[2]), d = [Math.cos(0.05) * MOON[0] / h, Math.sin(0.05), Math.cos(0.05) * MOON[2] / h], y = Math.round(pixelOf(Bl, d, W, H)[1]);
  const row = await ev(`window.__row(${y})`), deg = (Math.PI / 180) / pxl, k = Math.max(1, Math.round(deg));   // about 1 degree of the row in px
  // smooth over 2 degrees (a box of 2k + 1 px): what is left is the fine structure, what is kept the slow wander
  const sm = row.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - 2 * k); j <= Math.min(row.length - 1, i + 2 * k); j++) { s += row[j]; n++; } return s / n; });
  const mid = row.slice(4 * k, row.length - 4 * k), smid = sm.slice(4 * k, row.length - 4 * k), mean = smid.reduce((a, b) => a + b, 0) / smid.length;
  const fine = Math.sqrt(mid.reduce((a, v, i) => a + (v - smid[i]) ** 2, 0) / mid.length), slow = Math.sqrt(smid.reduce((a, v) => a + (v - mean) ** 2, 0) / smid.length);
  assert.ok(fine >= 0.25 * slow && fine >= 0.8, `the band's row ${y}: fine structure ${fine.toFixed(2)} levels against a slow wander of ${slow.toFixed(2)} (at least a quarter, and at least 0.8 of a level over the dither)`);
});

test('row 6: the stars can be seen: in the river, the aurora and the city the median star stands at least 10 levels over its sky and the brightest tenth at least 30, at DPR 1', { skip }, async (t) => {
  const bad = [];
  for (const style of ['river', 'aurora', 'city']) {
    const { stars } = await look(style, DENS[0]), pk = stars.measured.map((s) => s.peak), med = pct(pk, 0.5), p90 = pct(pk, 0.9);
    t.diagnostic(`${style}: peaks over the sky, median ${med.toFixed(1)}, p90 ${p90.toFixed(1)} levels, over ${pk.length} lone stars`);
    if (!(med >= 10 && p90 >= 30)) bad.push(`${style}: median ${med.toFixed(1)}, 90th percentile ${p90.toFixed(1)} levels over ${pk.length} lone stars`);
  }
  assert.deepEqual(bad, [], 'every starry look\'s stars stand clear of its sky');
});
