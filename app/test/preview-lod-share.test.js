// preview-lod-share.test.js: node --test app/test/preview-lod-share.test.js
// L156 (pane E's proof, p-l155-proof-E: a correctness row inside a timing file ran only where timing runs, and a real red, #40, went unseen): row 3 (the preview draws at most 40% of the full mesh's triangles),
// moved VERBATIM out of app/test/preview-lod-frame.test.js, a timing file test-fast leaves out, so test-fast runs it. Below this header is preview-lod-frame.test.js as it stood at 7f4241b with its
// timed rows taken out: the harness is copied unchanged (its timing helpers and constants included, some now unused) so the move can be checked line for line.
// preview-lod-frame.test.js: node --test app/test/preview-lod-frame.test.js   (under the heavy-run lock; about two minutes)
// The user, 2026-10-31, on long tracks: "in the previewer, the track doesnt have to be full fidelity topography until it is exported to ease strain on preview", and the
// preview is to hold the display's refresh rate (one frame at 144 Hz is 6.9 ms). A 100 km track (200 pieces: 800 m straights and quarter turns of 400 m radius, bowl
// font) is opened through File ▸ Open in the real page (app/index.html) in HEADLESS Chrome (never a window), served from this checkout, the native side stood in for by
// a page script that answers the open. Then, with nothing moving, every animation frame is timed WITH gl.finish() after it, so the GPU's work is in the figure (Chrome
// runs without its frame-rate limit and vsync). Skipped, with the reason, where there is no Chrome. A case is run again once if it misses (another process may run). Rows:
//   1  the whole 100 km track in the opening view: p95 of the frames <= 6.9 ms (before the far road was drawn coarser: 13.3 ms, 92 frames of 1,026 over)
//   2  above the road, 37% of the way along: p95 <= 6.9 ms (before: 1.9 ms)
//   3  the work behind row 1, counted: in the opening view the preview draws at most 40% of the full mesh's triangles (before: all of them). Rows 1 and 2 depend on the
//      GPU and on what else runs (before the change this machine read 13.3, 8.3 and 5.1 ms on row 1 in three runs); this row does not
//   4  in the overhead view, the pointer moving over the track (the right button held, the look): p95 <= 6.9 ms. Each move runs the readout's pick (app/preview/preview.js
//      pickAcross), which read every station of the track (before its cull: 17.9 ms on this row, 235 frames over)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path');
const { chromePath, launchChrome, connect } = require('./soundrender.js');
const D = require('../../src/core/document.js');
const { createCoreShell } = require('../core/coreshell.js');
const G = require('../../src/geom/index.js');

const REPO = path.join(__dirname, '..', '..');
const CHROME = chromePath();
const skip = (CHROME ? false : 'no Chrome here (set CHROME_PATH): the frames are timed in headless Chrome') || require('../../test/on_github.js').onGitHub('the runner has no GPU, so Chrome draws in software: 3 frames in 3 s on the 100 km track (run 41316657421), and the frame budget and the far road\'s thinning are judged on a machine that draws; every other machine runs it');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.css': 'text/css' };
const BUDGET = 6.9;   // ms: one frame at 144 Hz
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };

/** the 100 km track's saved text, built by the shell as a user would extend it */
async function longTrack() {
  // AMENDED BY NAME (2026-11-02, the pass clearance): each 800 m piece keeps the turn before it, so this 100 km track circles back over itself again and again, which
  // the builder now refuses to lay (the user: "forbid building the track a little closer because of the bulk of the underside"); the same pieces from the core's own
  // extendCorner (what the shell's extend runs), committed as one edit (commitDoc)
  const s = await createCoreShell({ autosaveMs: 0 }), R = 400, Q = (Math.PI * R) / 2, TB = require('../../src/core/turnby.js'); let m = 0, i = 0, d = s.getState().history.present;
  while (m < 100000) {
    if (i % 4 === 3) { d = TB.extendCorner(d, { length: Q, transition: 60, targets: { kh: (i % 8 === 3 ? 1 : -1) / R } }); m += Q; } else { d = TB.extendCorner(d, { length: 800, ...(i === 0 ? { family: 'bowl' } : {}) }); m += 800; }
    i++;
  }
  s.commitDoc(d);
  assert.equal(s.getState().message, null, s.getState().message);
  return D.serialize(s.getState().history.present);
}
// every animation-frame callback timed, then gl.finish() on the preview's context, frames told apart by their timestamp; the native side's open answered from TXT
const pre = (txt) => `(() => { document.title = 'zz-headless-test';
  const TXT = ${JSON.stringify(txt)};
  window.__TAURI__ = { core: { invoke: async (cmd) => { if (cmd === 'list_tracks') return ['eq-Long']; if (cmd === 'open_track') return TXT; return null; } } };
  const raf = window.requestAnimationFrame.bind(window); window.__ft = { on: false, frames: new Map(), gl: null };
  window.requestAnimationFrame = (fn) => raf((ts) => { const t0 = performance.now(); try { return fn(ts); } finally { if (window.__ft.on) {
    let g = window.__ft.gl; if (!g) for (const c of document.querySelectorAll('#stage canvas')) { let x = null; try { x = c.getContext('webgl'); } catch (e) { /* a 2D canvas */ } if (x) { g = window.__ft.gl = x; break; } }
    if (g) g.finish(); const f = window.__ft.frames.get(ts) || { ms: 0 }; f.ms += performance.now() - t0; window.__ft.frames.set(ts, f); } } });
  window.__tracks = 0; document.addEventListener('t180:track', () => { window.__tracks++; });
})();`;

let srv, ch, ws, dir, send, ev, errors = [], fullTris = 0;
test.before(async () => {
  if (skip) return;
  const txt = await longTrack();
  { const sh = await createCoreShell({ autosaveMs: 0 }); sh.adopt(D.parse(txt)); const r = sh.getState().resolved, p = G.buildPath(r.segments, { step: 2 }); for (const c of G.buildMesh(p, r.segments).scene.root.children) fullTris += c.children[0].indices.length / 3; }   // the full mesh, as the export builds it
  srv = http.createServer((q, s) => {
    const p = path.normalize(path.join(REPO, decodeURIComponent(q.url.split('?')[0])));
    if (!p.startsWith(REPO)) { s.writeHead(403); s.end(); return; }
    fs.readFile(p, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); s.end(b); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  let tgt; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--window-size=1400,860', '--disable-frame-rate-limit', '--disable-gpu-vsync'], 't180lod-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl, (d) => { if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text); }));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 500)}`); return d.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/app/lib/cjs.js` });
  for (let i = 0; i < 50; i++) { await sleep(100); try { if ((await ev('return location.href;')) === `${base}/app/lib/cjs.js`) break; } catch (e) { /* loading */ } }
  await ev(`localStorage.clear(); localStorage.setItem('t180.settings.theme', '"aurora"'); localStorage.setItem('t180.guide.done', '1'); return true;`);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: pre(txt) });
  await send('Page.navigate', { url: `${base}/app/index.html` });
  for (let i = 0; i < 200; i++) { await sleep(200); try { if (await ev("return !!document.getElementById('open') && document.querySelectorAll('#stage canvas').length >= 2;")) break; } catch (e) { /* loading */ } }
  await sleep(2000);
  await ev("document.title = 'zz-headless-test'; const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Skip'); if (b && b.offsetParent) b.click(); return true;");
  // File ▸ Open, the row: the user's path
  await ev("const m = document.getElementById('m-file'); if (m && !m.open) m.open = true; const h = document.getElementById('open'); (h.querySelector('button, .menu-head') || h).click(); await new Promise((r) => setTimeout(r, 400)); return true;");
  const row = await ev("const r = [...document.querySelectorAll('#open .menu-row')].find((x) => x.textContent.trim() === 'Long'); if (!r) return false; r.click(); return true;");
  assert.ok(row, 'the Open list has the long track');
  for (let i = 0; i < 300 && !(await ev('return window.__tracks;')); i++) await sleep(200);
  assert.ok(await ev('return window.__tracks;'), 'the preview showed the track');
  // the open's work settles (the road's lines, the textures, the checker's first answer): until two seconds running have no frame over 4 ms, or 90 s
  for (let i = 0, calm = 0; i < 90 && calm < 2; i++) { await ev('window.__ft.frames.clear(); window.__ft.on = true; return true;'); await sleep(1000); await ev('window.__ft.on = false; return true;'); const ms = await ev('return [...window.__ft.frames.values()].map((f) => f.ms);'); calm = ms.length > 10 && Math.max(...ms) <= 4 ? calm + 1 : 0; }
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); if (srv) srv.close(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

/** 3 s of still frames, each with gl.finish(): p95 and how many over the budget */
async function still() {
  await ev('window.__ft.frames.clear(); window.__ft.on = true; return true;'); await sleep(3000); await ev('window.__ft.on = false; return true;');
  const ms = await ev('return [...window.__ft.frames.values()].map((f) => f.ms);');
  assert.ok(ms.length >= 30, `only ${ms.length} frames in 3 s`);
  return { p95: pct(ms, 0.95), over: ms.filter((m) => m > BUDGET).length, n: ms.length };
}
async function within() { const runs = []; for (let i = 0; i < 2; i++) { const r = await still(); runs.push(r); if (r.p95 <= BUDGET) break; } return runs; }
const said = (runs) => runs.map((r) => `p95 ${r.p95.toFixed(1)} ms, ${r.over} of ${r.n} over`).join(' / ');

test('row 3: in the opening view the preview draws at most 40% of the triangles of the full mesh', { skip }, async (t) => {
  await ev("document.dispatchEvent(new CustomEvent('t180-camera', { detail: { mode: 'overhead' } })); await new Promise((r) => setTimeout(r, 1500)); return true;");
  const st = await ev("let s = null; document.dispatchEvent(new CustomEvent('t180-probe', { detail: { reply: (p) => { s = p.stats; } } })); return s;");
  t.diagnostic(`${st.triangles} of ${fullTris} triangles drawn, ${st.coarse} of ${st.chunks} chunks thinned`);
  assert.ok(fullTris > 1e6, `the full mesh has ${fullTris} triangles`);
  assert.ok(Number.isFinite(st.triangles) && st.triangles <= 0.4 * fullTris, `${st.triangles} of ${fullTris} triangles drawn`);
});
