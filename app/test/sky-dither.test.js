// sky-dither.test.js: node --test app/test/sky-dither.test.js
// D398: the sky pass breaks its own 8-bit banding with a one-step ordered dither (E's D397 page, the fix and not the look). Each style's own GLSL is
// compiled into the renderer's own sky pass (app/preview/renderer.js SKY_VS and skyFS, unchanged here) in HEADLESS Chrome (never a window), with each
// skin's colours read from its CSS, and the pixels are read back. Skipped, with the reason, where there is no Chrome (CHROME_PATH or the usual place). Rows:
//   1  banding: down each column of open sky, looking level and looking up 50 degrees, the longest run of one identical 8-bit colour is at most 12 px
//      for every style (before the dither: 26 to 174 px, so the gradient showed as steps)
//   2  the quiet band: every pixel from -10 to 10 degrees of elevation, all the way round, stays within 1.30:1 (WCAG) of the skin's --fog, the dither included
//      (D384 widened, D391's measure). The band is drawn with a vertex pair per column, so it really goes round: a control sky white over half the circle
//      shows white in about half its columns (A's review of D403, §6: drawn as one quad, every column saw azimuth 0)
//   3  the pattern keeps all 16 levels on a tall canvas: a 4 x 4 block at pixel rows 2400 and 4320 holds 16 different values (A's review 11, finding 1)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const { chromePath, launchChrome, connect } = require('./soundrender.js');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const R = require(path.join(ADIR, 'preview', 'renderer.js'));
const SKY = require(path.join(ADIR, 'preview', 'sky', 'index.js'));

const CHROME = chromePath();
const skip = CHROME ? false : 'no Chrome here (set CHROME_PATH): the sky is drawn in headless Chrome';
const STYLES = { sun: 'skyline', prism: 'glass', caustics: 'aqua', aurora: 'aurora', city: 'skyline-night', river: 'glass' };   // D405: Skyline Night's city sky joins every row; D416: Glass's river too (the prism keeps Glass's colours)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A skin's sky colours from its CSS: --sky, --fog, and --sky-a/b/c each falling back to --sky (as themeFrom does). */
function colours(skin) {
  const css = fs.readFileSync(path.join(ADIR, 'themes', `${skin}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tok = (k) => { const m = new RegExp(`${k}:\\s*color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(css); return m ? [+m[1], +m[2], +m[3]] : null; };
  const sky = tok('--sky'), fog = tok('--fog'); if (!sky || !fog) throw new Error(`${skin}.css has no --sky or --fog`);
  return { sky, fog, a: tok('--sky-a') || sky, b: tok('--sky-b') || sky, c: tok('--sky-c') || sky };
}
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const Y = (v) => 0.2126 * lin(v[0]) + 0.7152 * lin(v[1]) + 0.0722 * lin(v[2]);

// in the page: the renderer's own pass, and a lat-long vertex stage for the band (the same fragment stage, so the same dither)
const PAGE = `
window.__sky = (vs, fs, latlongVs, col) => {
  const cv = document.createElement('canvas'); cv.width = 1400; cv.height = 860; const gl = cv.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  const sh = (ty, s) => { const o = gl.createShader(ty); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error('compile: ' + gl.getShaderInfoLog(o)); return o; };
  const prog = (v) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p)); return p; };
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const use = (p) => { gl.useProgram(p); const a = gl.getAttribLocation(p, 'aPos'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const U = (n) => gl.getUniformLocation(p, n); gl.uniform3fv(U('uSky'), col.sky); gl.uniform3fv(U('uSkyA'), col.a); gl.uniform3fv(U('uSkyB'), col.b); gl.uniform3fv(U('uSkyC'), col.c); gl.uniform1f(U('uTime'), 0); return U; };
  const read = (w, h) => { const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  // the band's strip: a vertex pair (bottom, top) at each of the 1401 column edges, so each column carries its own azimuth (a quad has one, see row 2)
  const strip = []; for (let i = 0; i <= 1400; i++) { const x = -1 + 2 * i / 1400; strip.push(x, -1, x, 1); }
  const bandBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bandBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(strip), gl.STATIC_DRAW);
  const pass = prog(vs), band = prog(latlongVs);
  return {
    view(B) { gl.bindBuffer(gl.ARRAY_BUFFER, buf); const U = use(pass); gl.uniform3fv(U('uFwd'), B.fwd); gl.uniform3fv(U('uRight'), B.right); gl.uniform3fv(U('uUp'), B.up); gl.viewport(0, 0, 1400, 860); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return read(1400, 860); },
    band() { gl.bindBuffer(gl.ARRAY_BUFFER, bandBuf); use(band); gl.viewport(0, 0, 1400, 80); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 2 * 1401); return read(1400, 80); },
  };
};
// the longest run of one identical colour down every 4th column, GL rows y0..y1 (row 0 is the bottom)
window.__longest = (px, w, y0, y1) => { let L = 0; for (let x = 0; x < w; x += 4) { let n = 1; for (let y = y0 + 1; y < y1; y++) { const k = (y * w + x) * 4, j = ((y - 1) * w + x) * 4; if (px[k] === px[j] && px[k + 1] === px[j + 1] && px[k + 2] === px[j + 2]) { n++; if (n > L) L = n; } else n = 1; } } return L; };
true`;
// the band's directions: azimuth 0..360 across the 1400 columns, elevation -10..10 up the 80 rows
const LATLONG_VS = `attribute vec2 aPos; varying vec3 vRay;
void main(){ vec2 u = aPos * 0.5 + 0.5; float az = u.x * 6.2831853, el = radians(mix(-10.0, 10.0, u.y)); vRay = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az)); gl_Position = vec4(aPos, 0.0, 1.0); }`;
// the build view's camera, level and looking up 50 degrees, at the default 60-degree field (R.skyBasis, as the renderer draws it)
const pose = (pitchDeg) => { const p = pitchDeg * Math.PI / 180; return { eye: [0, 2, 0], target: [0, 2 + Math.sin(p) * 10, -Math.cos(p) * 10], up: [0, 1, 0], fov: Math.PI / 3 }; };

let ch, ws, dir, ev;
test.before(async () => {
  if (skip) return;
  // D400: a free port, this Chrome's own (launchChrome checks the browser's pid), and a socket that rejects waiting sends when it closes
  let tgt, send; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--enable-unsafe-swiftshader'], 't180sky-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 500)}`); return d.result.result.value; };
  await ev(PAGE);
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

const sky = (style) => `window.__sky(${JSON.stringify(R.SKY_VS)}, ${JSON.stringify(R.skyFS(SKY.patternSource(style)))}, ${JSON.stringify(LATLONG_VS)}, ${JSON.stringify(colours(STYLES[style]))})`;

test('row 1: no style\'s sky shows 8-bit steps: down each column of open sky, level and looking up, the longest run of one colour is at most 12 px', { skip }, async (t) => {
  const runs = {};
  for (const style of Object.keys(STYLES)) {
    const level = R.skyBasis(pose(0), 1400 / 860), up = R.skyBasis(pose(50), 1400 / 860);
    // looking level the horizon is the middle row (430): the open sky is GL rows 440..800; looking up, rows 60..800
    runs[style] = await ev(`(() => { const S = ${sky(style)}; return [window.__longest(S.view(${JSON.stringify(level)}), 1400, 440, 800), window.__longest(S.view(${JSON.stringify(up)}), 1400, 60, 800)]; })()`);
  }
  t.diagnostic(`longest flat run, px (level, up): ${JSON.stringify(runs)}`);
  for (const [style, [lv, up]] of Object.entries(runs)) assert.ok(lv <= 12 && up <= 12, `${style}: the longest flat run is ${lv} px looking level and ${up} px looking up (all: ${JSON.stringify(runs)})`);
});

// A's review of D403, §6 (the librarian's ruling, 2026-10-18 21:53): the band was drawn as one four-vertex quad, whose two columns of vertices sit at
// azimuth 0 and 360, the same direction, so every column saw azimuth 0 and "all the way round" was not what row 2 checked. A control sky that is the
// skin's own fog over the half of the circle nearest azimuth 0 and white over the far half must therefore show white in about half the band's columns
const controlSky = (fog) => `vec3 skyPattern(vec3 dir, float t){ return abs(atan(dir.z, dir.x)) > 1.5707963 ? vec3(1.0) : vec3(${fog.map((v) => v.toFixed(6)).join(', ')}); }`;
test('row 2: the quiet band keeps its rule with the dither: every pixel from -10 to 10 degrees, all the way round, within 1.30:1 of --fog', { skip }, async (t) => {
  const got = {}, col = colours('skyline');
  const ctl = await ev(`(() => { const px = window.__sky(${JSON.stringify(R.SKY_VS)}, ${JSON.stringify(R.skyFS(controlSky(col.fog)))}, ${JSON.stringify(LATLONG_VS)}, ${JSON.stringify(col)}).band();
    let n = 0; for (let x = 0; x < 1400; x++) { let white = false; for (let y = 0; y < 80; y++) { const k = (y * 1400 + x) * 4; if (px[k] > 250 && px[k + 1] > 250 && px[k + 2] > 250) white = true; } if (white) n++; } return n; })()`);
  t.diagnostic(`the control sky (white beyond 90 degrees of azimuth 0): white in ${ctl} of the band's 1400 columns`);
  assert.ok(ctl >= 650 && ctl <= 750, `the band must look all the way round: a control sky white over half the circle shows white in ${ctl} of 1400 columns (about 700 wanted)`);
  for (const style of Object.keys(STYLES)) {
    const px = await ev(`(() => Array.from(${sky(style)}.band()))()`), fog = Y(colours(STYLES[style]).fog);
    let lo = 1, hi = 0; for (let k = 0; k < px.length; k += 4) { const y = Y([px[k] / 255, px[k + 1] / 255, px[k + 2] / 255]); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const worst = Math.max((hi + 0.05) / (fog + 0.05), (fog + 0.05) / (lo + 0.05));
    got[style] = +worst.toFixed(3);
    assert.ok(worst <= 1.30, `${style}: the band reaches ${worst.toFixed(3)}:1 of --fog (Y ${lo.toFixed(5)} .. ${hi.toFixed(5)} against ${fog.toFixed(5)})`);
  }
  t.diagnostic(`the band's largest ratio to --fog: ${JSON.stringify(got)}`);
});

// D398 follow-up (A's review 11, finding 1): the pattern is computed from the pixel's own row, so on a tall canvas it must keep all 16 of its levels. The
// pass's own helpers (everything in skyFS from pass_bayer2 up to main) are compiled on their own and read back over a 4 x 4 block of pixels at rows 2400
// and 4320 (a 4K canvas): each block must hold 16 different levels. A form that squares the row (0.75 y^2) runs out of float32 precision above about 2,364 px
test('row 3: the dither pattern keeps all 16 levels on a tall canvas, at pixel rows 2400 and 4320', { skip }, async (t) => {
  const pass = R.skyFS(''), helpers = pass.slice(pass.indexOf('float pass_bayer2'), pass.indexOf('void main()'));
  assert.ok(/float pass_bayer4\(vec2 a\)/.test(helpers), 'the pass\'s pattern helpers are found in skyFS');
  const levels = await ev(`(() => {
    const H = 4328, cv = document.createElement('canvas'); cv.width = 4; cv.height = H; const gl = cv.getContext('webgl', { antialias: false });
    const sh = (ty, s) => { const o = gl.createShader(ty); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error('compile: ' + gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }'));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, 'precision highp float;\\n' + ${JSON.stringify(helpers)} + '\\nvoid main(){ gl_FragColor = vec4(vec3(pass_bayer4(gl_FragCoord.xy)), 1.0); }'));
    gl.linkProgram(p); gl.useProgram(p); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(p, 'aPos'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0); gl.viewport(0, 0, 4, H); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const out = {}; for (const y0 of [0, 2400, 4320]) { const px = new Uint8Array(4 * 4 * 4); gl.readPixels(0, y0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, px); const v = new Set(); for (let i = 0; i < 64; i += 4) v.add(px[i]); out[y0] = [...v].sort((u, w) => u - w); }
    return out; })()`);
  t.diagnostic(`levels in a 4 x 4 block (of 255): ${JSON.stringify(levels)}`);
  for (const y of ['0', '2400', '4320']) assert.equal(levels[y].length, 16, `rows ${y}..${+y + 3}: 16 levels, got ${levels[y].length} (${levels[y].join(' ')})`);
});
