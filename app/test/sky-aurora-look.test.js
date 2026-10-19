// sky-aurora-look.test.js: node --test app/test/sky-aurora-look.test.js
// D403: the Aurora sky's enhancement pass (it should read as a real aurora). The sky's GLSL is compiled into the renderer's own sky pass in HEADLESS Chrome (never
// a window), with the skin's colours read from aurora.css, and the pixels are read back (as sky-dither.test.js does). Skipped, with the reason, where there is no
// Chrome. The contract (D391) and the quiet band (D384/D398, 1.30:1 of --fog) already have their rows (sky-caustics-aurora.test.js, sky-dither.test.js row 2),
// and the pass's dither is the renderer's, untouched; these rows are the look:
//   1  the contract: the style's source breaks neither GLSL rule (contractProblems -> [])
//   2  vertical structure: along the hem the curtain is striped by rays, not a smooth ribbon: in a 5-degree stretch of azimuth the dimmest column is at least
//      HEM_CONTRAST (0.6) below the brightest (median over the stretches), on the hem's brightest stretch in each column, stars left out (before D403: 0.45)
//   3  several curtains at different depths: down some column of the sky there are three separate lit stretches (today's two curtains show two)
//   4  motion: slow and alive: the hem's ray pattern moves along azimuth by under 0.0044 rad/s (a 60-degree view in four minutes), it keeps its shape while
//      it moves (so the speed means something), and nothing pulses or flashes (no column changes by more than 15% in a second)
//   5  a corona: looking up there is one point overhead where rays converge: round it the brightness is a fan of at least 6 rays, and it is brighter than the sky
//      beside it
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { chromePath, launchChrome, connect } = require('./soundrender.js');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const R = require(path.join(ADIR, 'preview', 'renderer.js'));
const SKY = require(path.join(ADIR, 'preview', 'sky', 'index.js'));

const CHROME = chromePath();
const skip = CHROME ? false : 'no Chrome here (set CHROME_PATH): the sky is drawn in headless Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HEM_CONTRAST = 0.6;       // row 2: today's hem (before D403) measures 0.45; at 0.6 the dimmest column is 40% of the brightest, which reads as a gap between rays
const MAX_SPEED = 0.0044;       // row 4: rad/s; a 60-degree (1.047 rad) view in 240 s
const MAX_PULSE = 0.15;         // row 4: relative brightness change in one second, the bound the stars' twinkle already keeps (before D403 the rays reach 0.25)
const LIVE = 0.1;               // row 4: two minutes on, the hem has changed by at least this (rms, against the curtain brightness); the build measures 0.38
const W = 1400;                 // columns round the sky, 0.257 degrees each

function colours() {
  const css = fs.readFileSync(path.join(ADIR, 'themes', 'aurora.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tok = (k) => { const m = new RegExp(`${k}:\\s*color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(css); return m ? [+m[1], +m[2], +m[3]] : null; };
  const sky = tok('--sky'); return { sky, a: tok('--sky-a') || sky, b: tok('--sky-b') || sky, c: tok('--sky-c') || sky };
}
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const Yof = (px, k) => 0.2126 * lin(px[k] / 255) + 0.7152 * lin(px[k + 1] / 255) + 0.0722 * lin(px[k + 2] / 255);

// in the page: the renderer's own fragment stage, behind a vertex stage that says which directions to draw. 'lat' draws azimuth 0..360 across the width and the
// elevations uLo..uHi up the rows; 'ring' draws a circle of angular radius uRad round the direction uC across the width.
const PAGE = `
window.__aur = (fs, col) => {
  const cv = document.createElement('canvas'); cv.width = ${W}; cv.height = 320; const gl = cv.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  const sh = (ty, s) => { const o = gl.createShader(ty); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error('compile: ' + gl.getShaderInfoLog(o)); return o; };
  const prog = (v) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p)); return p; };
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); // a strip with a pair of vertices at every column, so the directions the vertex stage names are interpolated over a quarter of a degree, not over the whole turn
  const v = []; for (let i = 0; i <= ${W}; i++) { const x = -1 + 2 * i / ${W}; v.push(x, -1, x, 1); } gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW); const NV = 2 * (${W} + 1);
  const lat = prog(\`attribute vec2 aPos; uniform vec2 uEl; varying vec3 vRay;
    void main(){ vec2 u = aPos * 0.5 + 0.5; float az = u.x * 6.2831853, el = mix(uEl.x, uEl.y, u.y); vRay = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az)); gl_Position = vec4(aPos, 0.0, 1.0); }\`);
  const ring = prog(\`attribute vec2 aPos; uniform vec3 uC, uE1, uE2; uniform float uRad; varying vec3 vRay;
    void main(){ float ph = (aPos.x * 0.5 + 0.5) * 6.2831853; vRay = normalize(uC + uRad * (cos(ph) * uE1 + sin(ph) * uE2)); gl_Position = vec4(aPos, 0.0, 1.0); }\`);
  const use = (p, t) => { gl.useProgram(p); const a = gl.getAttribLocation(p, 'aPos'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const U = (n) => gl.getUniformLocation(p, n); gl.uniform3fv(U('uSky'), col.sky); gl.uniform3fv(U('uSkyA'), col.a); gl.uniform3fv(U('uSkyB'), col.b); gl.uniform3fv(U('uSkyC'), col.c); gl.uniform1f(U('uTime'), t); return U; };
  const read = (h) => { const px = new Uint8Array(${W} * h * 4); gl.readPixels(0, 0, ${W}, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return Array.from(px); };
  return {
    lat(t, lo, hi, h) { const U = use(lat, t); gl.uniform2f(U('uEl'), lo, hi); gl.viewport(0, 0, ${W}, h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, NV); return read(h); },
    hem(t, lo, hi, h) { const U = use(lat, t); gl.uniform2f(U('uEl'), lo, hi); gl.viewport(0, 0, ${W}, h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, NV); const px = read(h), L = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const Y = (k) => 0.2126 * L(px[k]) + 0.7152 * L(px[k + 1]) + 0.0722 * L(px[k + 2]), out = new Array(${W}).fill(0);
      for (let x = 0; x < ${W}; x++) for (let y = 2; y < h - 2; y++) { const w = []; for (let k = -2; k <= 2; k++) w.push(Y(((y + k) * ${W} + x) * 4)); w.sort((u, v) => u - v); if (w[2] > out[x]) out[x] = w[2]; } return out; },
    ring(t, c, e1, e2, rad) { const U = use(ring, t); gl.uniform3fv(U('uC'), c); gl.uniform3fv(U('uE1'), e1); gl.uniform3fv(U('uE2'), e2); gl.uniform1f(U('uRad'), rad); gl.viewport(0, 0, ${W}, 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, NV); return read(1); },
  };
};
true`;

let ch, ws, dir, ev;
test.before(async () => {
  if (skip) return;
  let tgt, send; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--enable-unsafe-swiftshader'], 't180aur-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 500)}`); return d.result.result.value; };
  await ev(PAGE);
  await ev(`window.S = window.__aur(${JSON.stringify(R.skyFS(SKY.patternSource('aurora')))}, ${JSON.stringify(colours())}); true`);
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

const DEG = Math.PI / 180;
/** per column round the sky, the brightest stretch (Y) between 11 and 50 degrees of elevation, at time t. Rows are 0.13 degrees apart (finer than the hem), each pixel is the median of the 5 around it,
 *  so a star (a pixel or two) does not count: the curtains are the subject here, and the twinkle is already bounded by its own rule */
async function hemProfile(t) {
  return ev(`window.S.hem(${t}, ${11 * DEG}, ${50 * DEG}, 300)`);
}

test('row 1: the contract: the aurora source breaks neither GLSL rule (D391)', () => {
  assert.deepEqual(SKY.contractProblems('aurora', require(path.join(ADIR, 'preview', 'sky', 'aurora.js')).source()), []);
});

test('row 2: vertical structure: along the hem every 5 degrees of azimuth holds rays, the dimmest column at least 60% below the brightest (median)', { skip }, async (t) => {
  const p = await hemProfile(0), win = 19, c = [];
  for (let x = 0; x + win <= W; x += win) { const w = p.slice(x, x + win); c.push((Math.max(...w) - Math.min(...w)) / Math.max(...w)); }
  c.sort((u, v) => u - v); const med = c[c.length >> 1];
  t.diagnostic(`rays: median 5-degree contrast ${med.toFixed(3)} (windows ${c.length}, min ${c[0].toFixed(3)}, max ${c[c.length - 1].toFixed(3)})`);
  assert.ok(med >= HEM_CONTRAST, `the hem's ray contrast is ${med.toFixed(3)}, below ${HEM_CONTRAST}`);
});

test('row 3: several curtains: down some column of the sky there are three separate lit stretches (a near curtain, a middle one and a fainter far one)', { skip }, async (t) => {
  const px = await ev(`window.S.lat(0, ${10 * DEG}, ${70 * DEG}, 120)`); let best = 0, at = -1;
  for (let x = 0; x < W; x++) {
    // lit: a local peak of Y down the column at least 3x the dimmest Y between it and the next peak, and at least 0.03 in Y
    const col = []; for (let y = 0; y < 120; y++) col.push(Yof(px, (y * W + x) * 4));
    const sm = col.map((v, i) => (col[Math.max(0, i - 2)] + col[Math.max(0, i - 1)] + v + col[Math.min(119, i + 1)] + col[Math.min(119, i + 2)]) / 5);
    const peaks = []; for (let i = 3; i < 117; i++) if (sm[i] > 0.03 && sm[i] >= sm[i - 1] && sm[i] > sm[i + 1] && sm[i] >= Math.max(...sm.slice(Math.max(0, i - 12), i + 13)) ) peaks.push(i);
    let n = peaks.length ? 1 : 0; for (let k = 1; k < peaks.length; k++) { const dip = Math.min(...sm.slice(peaks[k - 1], peaks[k] + 1)); if (dip * 3 <= Math.min(sm[peaks[k - 1]], sm[peaks[k]])) n++; }
    if (n > best) { best = n; at = x; }
  }
  t.diagnostic(`most separate lit stretches down one column: ${best} (column ${at})`);
  assert.ok(best >= 3, `no column of the sky shows three separate curtains (most: ${best})`);
});

test('row 4: motion is slow and alive: the hem pattern drifts under 0.0044 rad/s, keeps its shape, and nothing pulses by more than 15% of the curtain brightness in a second', { skip }, async (t) => {
  const worst = { speed: 0, corr: 1, pulse: 0 };
  for (const t0 of [0, 500]) {
    const a = await hemProfile(t0), b = await hemProfile(t0 + 5), pb = await hemProfile(t0 + 1);
    // best whole-column shift of b against a (circular), within 60 columns
    let bestLag = 0, bestErr = Infinity, bestCorr = 0;
    for (let lag = -60; lag <= 60; lag++) {
      let e = 0, sa = 0, sb = 0, sab = 0; for (let x = 0; x < W; x++) { const u = a[x], v = b[(x + lag + W) % W]; e += (u - v) ** 2; sa += u; sb += v; sab += u * v; }
      if (e < bestErr) { bestErr = e; bestLag = lag; }
    }
    { const m = (arr) => arr.reduce((s, v) => s + v, 0) / W, ma = m(a), mb = m(b.map((_, i) => b[(i + bestLag + W) % W])); let sab = 0, sa2 = 0, sb2 = 0;
      for (let x = 0; x < W; x++) { const u = a[x] - ma, v = b[(x + bestLag + W) % W] - mb; sab += u * v; sa2 += u * u; sb2 += v * v; } bestCorr = sab / Math.sqrt(sa2 * sb2); }
    const speed = Math.abs(bestLag) * (2 * Math.PI / W) / 5;
    const top = [...a].sort((u, v) => u - v)[Math.floor(W * 0.95)]; let pulse = 0, px0 = -1; for (let x = 0; x < W; x++) { const q = Math.abs(pb[x] - a[x]) / top; if (q > pulse) { pulse = q; px0 = x; } }    // against the curtain's bright level, so a dim gap between rays does not count as a flash
    worst.speed = Math.max(worst.speed, speed); worst.corr = Math.min(worst.corr, bestCorr); worst.pulse = Math.max(worst.pulse, pulse);
  }
  // and it is alive: two minutes on, the hem is not the same hem
  const h0 = await hemProfile(0), h2 = await hemProfile(120), top0 = [...h0].sort((u, v) => u - v)[Math.floor(W * 0.95)];
  const live = Math.sqrt(h0.reduce((a, v, i) => a + (v - h2[i]) ** 2, 0) / W) / top0;
  t.diagnostic(`rms change of the hem over two minutes, against the curtain brightness: ${live.toFixed(3)}`);
  assert.ok(live >= LIVE, `the hem changes by only ${live.toFixed(3)} (rms, against the curtain brightness) in two minutes: the sky is still`);
  t.diagnostic(`worst drift ${worst.speed.toFixed(5)} rad/s, lowest correlation at the best shift ${worst.corr.toFixed(3)}, worst 1 s change ${worst.pulse.toFixed(4)}`);
  assert.ok(worst.speed <= MAX_SPEED, `the hem pattern drifts ${worst.speed.toFixed(5)} rad/s, over ${MAX_SPEED}`);
  assert.ok(worst.corr >= 0.5, `the pattern at the best shift correlates only ${worst.corr.toFixed(3)} over 5 s: it is changing, not drifting`);
  assert.ok(worst.pulse <= MAX_PULSE, `a column changes ${(worst.pulse * 100).toFixed(1)}% in one second, over ${MAX_PULSE * 100}%`);
});

test('row 5: a corona: overhead there is a point where rays converge: a fan of at least 6 rays round it, brighter than the sky beside it', { skip }, async (t) => {
  // find the brightest direction between 60 and 89 degrees (lat-long), then walk a ring of angular radius 0.22 rad round it
  const px = await ev(`window.S.lat(0, ${60 * DEG}, ${89 * DEG}, 120)`); let best = -1, bx = 0, by = 0;
  const sm = new Array(W * 120).fill(0); for (let y = 6; y < 114; y++) for (let x = 0; x < W; x++) { let s = 0; for (let j = -5; j <= 5; j++) for (let k = -7; k <= 7; k++) s += Yof(px, ((y + j) * W + ((x + k + W) % W)) * 4); sm[y * W + x] = s / 165; }   // a box blur, so a star is not the peak
  for (let y = 6; y < 114; y++) for (let x = 0; x < W; x++) if (sm[y * W + x] > best) { best = sm[y * W + x]; bx = x; by = y; }
  const az = bx / W * 2 * Math.PI, el = (60 + 29 * by / 119) * DEG;
  const c = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  const e1 = [-Math.sin(az), 0, Math.cos(az)], e2 = [-Math.sin(el) * Math.cos(az), Math.cos(el), -Math.sin(el) * Math.sin(az)];
  const r = await ev(`window.S.ring(0, ${JSON.stringify(c)}, ${JSON.stringify(e1)}, ${JSON.stringify(e2)}, 0.22)`), ring = []; for (let x = 0; x < W; x++) ring.push(Yof(r, x * 4));
  const sm2 = ring.map((v, i) => { const w = []; for (let k = -3; k <= 3; k++) w.push(ring[(i + k + W) % W]); w.sort((u, q) => u - q); return w[3]; });   // the median of 7, so a star is not a ray
  let peaks = 0; for (let i = 0; i < W; i++) { const win = []; for (let k = -40; k <= 40; k++) win.push(sm2[(i + k + W) % W]); if (sm2[i] === Math.max(...win) && sm2[i] > Math.min(...win) * 1.3) peaks++; }
  const lo = Math.min(...sm2), hi = Math.max(...sm2);
  t.diagnostic(`corona at azimuth ${(az / DEG).toFixed(0)}, elevation ${(el / DEG).toFixed(0)}; ring rays ${peaks}, ring Y ${lo.toFixed(4)}..${hi.toFixed(4)}, peak Y ${best.toFixed(4)}`);
  assert.ok(peaks >= 6, `the ring round the brightest overhead point holds ${peaks} rays, under 6`);
  assert.ok(best > 0.02, `the overhead peak is Y ${best.toFixed(4)}: no corona`);
  assert.ok(hi >= 1.5 * lo, `the ring round it runs only Y ${lo.toFixed(4)}..${hi.toFixed(4)}: its rays are not seen`);
});
