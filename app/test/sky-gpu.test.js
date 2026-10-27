// sky-gpu.test.js: node --test app/test/sky-gpu.test.js   (a timing session: under the heavy-run lock, alone; under a minute)
// D495: THE SKY'S GPU BUDGET, measured. The frame rows (drag-frame, release-frame, sculpt-frame) time the main thread only, so a sky's cost, which is
// on the GPU, is invisible to them (D489 §6). This row times the renderer's own sky pass (SKY_VS + skyFS) alone, full-screen at 2560 x 1440 (the
// user's display, DPR 1), in HEADLESS Chrome on the machine's GPU (never a window, muted), each draw timed on the GPU by
// EXT_disjoint_timer_query_webgl2 (TIME_ELAPSED): 30 warm-up draws, then 120 timed, from the build eye with the 60-degree lens pitched 0, 40 and 85
// degrees (a volume sky costs most looking up). The budget is the sky's share of the frame, 1.5 ms at the 95th percentile (sky/budget.js; D489 §7:
// with the road's up to 1.6 ms, under half of a 144 Hz frame). A case that misses is timed once more (as the frame rows do: a seat beside it on the
// GPU must not fail it); both readings are in the message. Skipped, with the reason, where there is no Chrome or no timer query. Rows:
//   1  the Aurora sky (sky/aurora.js: the near curtain a volume) fits the budget from every pitch
//   2  its flat fallback (what the renderer draws when the measured time is over budget) fits it too
//   3  0.4.23's aurora (app/test/sky-aurora-0.4.23.js, the sky it replaced) fits it, as it did
//   4  the row can fail: a sky deliberately over budget (three curtains as volumes of 64 steps at full resolution, D489's "B 64 x 3") is over 1.5 ms
//   5  the renderer's own budget works on the GPU (sky/budget.js, renderer.js THE SKY'S BUDGET): the real renderer, loaded by the app's own loader in a
//      page served from this checkout, drawn a frame at a time (a query's reading is ready only once the page is back in its event loop): with its
//      default budget it finds the Aurora sky fits; given a budget no sky can meet it falls back to the flat form, and says so on the console once
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), http = require('http');
const { chromePath, launchChrome, connect } = require('./soundrender.js');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const R = require(path.join(ADIR, 'preview', 'renderer.js'));
const SKY = require(path.join(ADIR, 'preview', 'sky', 'index.js'));
const BUDGET = require(path.join(ADIR, 'preview', 'sky', 'budget.js'));
const OLD = require('./sky-aurora-0.4.23.js');

const CHROME = chromePath();
const noChrome = CHROME ? false : 'no Chrome here (set CHROME_PATH): the sky is timed on the GPU in headless Chrome';
const W = 2560, H = 1440, WARM = 30, N = 120, PITCHES = [0, 40, 85];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const css = fs.readFileSync(path.join(ADIR, 'themes', 'aurora.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tok = (k) => { const m = new RegExp(`${k}:\\s*color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(css); if (!m) throw new Error(`aurora.css has no ${k}`); return [+m[1], +m[2], +m[3]]; };
const COL = { sky: tok('--sky'), a: tok('--sky-a'), b: tok('--sky-b'), c: tok('--sky-c') };
const NORTH = [-0.643, -0.766];
const poseAt = (deg) => { const p = deg * Math.PI / 180; return { eye: [0, 2, 0], target: [10 * Math.cos(p) * NORTH[0], 2 + 10 * Math.sin(p), 10 * Math.cos(p) * NORTH[1]], up: [0, 1, 0], fov: Math.PI / 3 }; };

// row 4's sky: three noise-folded curtains each marched in 64 steps through their slab, the per-step fold a 3-octave value noise (D489 §5's B)
function heavySky() {
  const curtain = (k) => `{ float fk = ${k}.0; for (int i = 0; i < 64; i++) { float s = t0 + (float(i) + j) * dt; vec3 p = dir * s; float h = p.y - 1.0;
      float z = p.z - (4.0 + 5.0 * fk) - heavy_fold(p.x, t, fk * 3.0); float sheet = exp(-z * z / 0.0036);
      float em = smoothstep(-0.02, 0.02, h) * exp(-max(h, 0.0) / 0.4) * (0.35 + 0.65 * heavy_vn(vec2(p.x * 9.0 + t * 0.2, fk * 5.0 + 3.0)));
      au += mix(uSkyA, uSkyB, smoothstep(0.2, 1.2, h)) * sheet * em * dt * 0.9; } }`;
  return `
float heavy_h(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float heavy_vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(heavy_h(i), heavy_h(i + vec2(1.0, 0.0)), f.x), mix(heavy_h(i + vec2(0.0, 1.0)), heavy_h(i + vec2(1.0, 1.0)), f.x), f.y); }
float heavy_fold(float x, float t, float k) { return 1.6 * heavy_vn(vec2(x * 0.08 + t * 0.01, k)) + 0.6 * heavy_vn(vec2(x * 0.23 - t * 0.02, k + 7.0)) + 0.2 * heavy_vn(vec2(x * 0.7 + t * 0.05, k + 13.0)); }
vec3 skyPattern(vec3 dir, float t) {
  vec3 au = vec3(0.0);
  if (dir.y > 0.02) { float t0 = 1.0 / dir.y, t1 = min(3.0 / dir.y, 40.0), dt = (t1 - t0) / 64.0, j = heavy_h(gl_FragCoord.xy);
    ${curtain(0)} ${curtain(1)} ${curtain(2)} }
  return mix(uSkyC, uSky, smoothstep(0.0, 0.42, dir.y)) + au;
}`;
}

const PAGE = `(() => { document.title = 'zz-headless-test';
  const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H}; document.body.appendChild(c);
  const gl = c.getContext('webgl2', { antialias: false }); if (!gl) return 'no WebGL2';
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (!tq) return 'no EXT_disjoint_timer_query_webgl2';
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  window.__time = async (vs, fs, col, B, px) => {
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p); const u = (k) => gl.getUniformLocation(p, k);
    gl.uniform3fv(u('uFwd'), B.fwd); gl.uniform3fv(u('uRight'), B.right); gl.uniform3fv(u('uUp'), B.up); gl.uniform3fv(u('uSky'), col.sky); gl.uniform3fv(u('uSkyA'), col.a); gl.uniform3fv(u('uSkyB'), col.b); gl.uniform3fv(u('uSkyC'), col.c); gl.uniform1f(u('uPx'), px);
    const pos = gl.getAttribLocation(p, 'aPos'); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0); gl.viewport(0, 0, ${W}, ${H}); gl.disable(gl.DEPTH_TEST);
    const out = [], qs = [];
    for (let i = 0; i < ${WARM + N}; i++) {
      gl.uniform1f(u('uTime'), 100 + i * 0.007);
      const q = i >= ${WARM} ? gl.createQuery() : null; if (q) gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); qs.push(q); }
      if (i % 10 === 9) await new Promise((r) => requestAnimationFrame(r));
    }
    let disjoint = 0;
    for (const q of qs) { for (let k = 0; k < 400 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise((r) => setTimeout(r, 5));
      if (gl.getParameter(tq.GPU_DISJOINT_EXT)) { disjoint++; gl.deleteQuery(q); continue; } out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
    gl.deleteProgram(p); return { ms: out, disjoint };
  };
  return 'ready'; })()`;

let ch, ws, dir, ev, send, srv, base, why = noChrome; const warned = [];
const REPO = path.join(ADIR, '..'), TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
// row 5's page: the app's loader and the real renderer, a 2560 x 1440 canvas, and a loop that draws a frame per animation frame until the sky's budget
// has a verdict (or maxFrames pass)
const RENDER_PAGE = `<!doctype html><meta charset="utf-8"><title>zz-headless-test</title><canvas id="c" width="${W}" height="${H}"></canvas><script src="/app/lib/cjs.js"></script><script>
document.title = 'zz-headless-test';
window.__ready = loadCjs('app/preview/renderer.js', (p) => fetch('/' + p).then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.text(); })).then((R) => {
  const gl = document.getElementById('c').getContext('webgl2', { antialias: false });
  window.__verdict = async (theme, opts, pose, maxFrames) => { const r = R.createRenderer(gl, opts); r.setTheme(theme); let n = 0;
    while (r.skyState().measure === 'measuring' && n < maxFrames) { r.draw([], pose, { width: ${W}, height: ${H} }, { time: 60 + n / 144, look: 'words', lines: false }); n++; await new Promise((z) => requestAnimationFrame(z)); }
    const st = r.skyState(); r.dispose(); return { ...st, frames: n }; };
  return true; });
</script>`;
test.before(async () => {
  if (noChrome) return;
  srv = http.createServer((q, s) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    if (u === '/__sky.html') { s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); s.end(RENDER_PAGE); return; }
    const p = path.normalize(path.join(REPO, u)); if (!p.startsWith(REPO)) { s.writeHead(403); s.end(); return; }
    fs.readFile(p, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); s.end(b); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}`;
  let tgt; ({ ch, dir, tgt } = await launchChrome(CHROME, [`--window-size=${W},${H}`], 't180skygpu-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl, (d) => { if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'warning') warned.push(d.params.args.map((a) => a.value).join(' ')); }));
  await send('Runtime.enable');
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 600)}`); return d.result.result.value; };
  await ev("document.title = 'zz-headless-test'; true");   // D484: a headless page is always titled so, first thing
  const r = await ev(PAGE); why = r === 'ready' ? false : `${r}: the sky is timed by a GPU timer query, and this browser has none`;
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); if (srv) srv.close(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

/** the sky's p95 at each pitch (a miss timed once more): [{ pitch, p95s: [first, again?] }] */
async function timeSky(src) {
  const out = [];
  for (const pitch of PITCHES) {
    const B = R.skyBasis(poseAt(pitch), W / H), px = 2 * Math.hypot(...B.up) / H, p95s = [];
    for (let k = 0; k < 2; k++) {
      const r = await ev(`window.__time(${JSON.stringify(R.SKY_VS)}, ${JSON.stringify(R.skyFS(src))}, ${JSON.stringify(COL)}, ${JSON.stringify(B)}, ${px})`);
      assert.ok(r.ms.length >= N * 0.9, `pitch ${pitch}: ${r.ms.length} of ${N} timings came back (${r.disjoint} disjoint)`);
      p95s.push(BUDGET.quantile(r.ms, 0.95));
      if (p95s[k] <= BUDGET.BUDGET_MS) break;
    }
    out.push({ pitch, p95s });
  }
  return out;
}
const said = (rows) => rows.map((r) => `pitch ${r.pitch}: p95 ${r.p95s.map((x) => x.toFixed(3)).join(' / ')} ms`).join('; ');
const fits = (rows) => rows.every((r) => r.p95s.some((x) => x <= BUDGET.BUDGET_MS));

test('row 1: the Aurora sky fits its GPU budget: at most 1.5 ms at the 95th percentile, 2560 x 1440, from every pitch', { skip: noChrome }, async (t) => {
  if (why) return t.skip(why);
  const rows = await timeSky(SKY.patternSource('aurora')); t.diagnostic(`aurora: ${said(rows)}`);
  assert.ok(fits(rows), `the Aurora sky is over its ${BUDGET.BUDGET_MS} ms budget: ${said(rows)}`);
});
test('row 2: its flat fallback fits the budget too', { skip: noChrome }, async (t) => {
  if (why) return t.skip(why);
  const rows = await timeSky(SKY.fallbackSource('aurora')); t.diagnostic(`aurora fallback: ${said(rows)}`);
  assert.ok(fits(rows), `the fallback is over the ${BUDGET.BUDGET_MS} ms budget: ${said(rows)}`);
});
test('row 3: the aurora it replaced (0.4.23) fits the budget, as it did', { skip: noChrome }, async (t) => {
  if (why) return t.skip(why);
  const rows = await timeSky(OLD.source()); t.diagnostic(`0.4.23 aurora: ${said(rows)}`);
  assert.ok(fits(rows), `0.4.23's aurora is over the ${BUDGET.BUDGET_MS} ms budget: ${said(rows)}`);
});
test('row 4: the row can fail: a sky deliberately over budget (three 64-step volume curtains, full resolution) is over 1.5 ms', { skip: noChrome }, async (t) => {
  if (why) return t.skip(why);
  assert.deepEqual(SKY.contractProblems('heavy', heavySky()), [], 'the heavy sky keeps the GLSL rules, so it is timed as a real style would be');
  const rows = await timeSky(heavySky()); t.diagnostic(`heavy control: ${said(rows)}`);
  assert.ok(!fits(rows), `the heavy control fits the budget, so the row could not tell a sky over it: ${said(rows)}`);
});
test('row 5: the renderer\'s own budget works on the GPU: the Aurora sky fits it, and a budget no sky can meet makes it fall back to the flat form, said once', { skip: noChrome }, async (t) => {
  if (why) return t.skip(why);
  await send('Page.navigate', { url: `${base}/__sky.html` });
  for (let i = 0; i < 100; i++) { await sleep(100); try { if (await ev('window.__ready')) break; } catch (e) { /* loading */ } }
  await ev("document.title = 'zz-headless-test'; true");
  const theme = { sky: COL.sky, fog: COL.c, skyStyle: 'aurora', skyA: COL.a, skyB: COL.b, skyC: COL.c }, pose = poseAt(85);
  const fits = await ev(`window.__verdict(${JSON.stringify(theme)}, {}, ${JSON.stringify(pose)}, 600)`);
  t.diagnostic(`default budget: ${fits.measure} at p95 ${fits.p95 === null ? '-' : fits.p95.toFixed(3)} ms after ${fits.frames} frames`);
  assert.equal(fits.measure, 'fits', `with its 1.5 ms budget the renderer found the Aurora sky ${fits.measure} (p95 ${fits.p95})`);
  assert.ok(fits.p95 > 0 && fits.p95 <= BUDGET.BUDGET_MS);
  const before = warned.length;
  const fell = await ev(`window.__verdict(${JSON.stringify(theme)}, { skyBudgetMs: 0.000001 }, ${JSON.stringify(pose)}, 600)`);
  await sleep(200);
  t.diagnostic(`a 1e-6 ms budget: ${fell.measure} at p95 ${fell.p95 === null ? '-' : fell.p95.toFixed(3)} ms after ${fell.frames} frames; said: ${warned.slice(before).join(' | ')}`);
  assert.equal(fell.measure, 'fell back');
  assert.equal(warned.slice(before).filter((w) => /drawn in its flat form/.test(w)).length, 1, 'the fallback is said once on the console');
});
