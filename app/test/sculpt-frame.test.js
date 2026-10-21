// sculpt-frame.test.js: node --test app/test/sculpt-frame.test.js   (rows 1-4 are TIMED: they run only while BOTH heavy-run slots are held, this run's and one more live holder; row 5 always runs)
// D421 (the user: "You can sculpt the pieces you already put down, so its a mode you switch ... tweaking and bending the track like say stretching it or manipulating it in many ways"; the design,
// exo_memory/loop/design_d421_sculpt_P_2026-10-20.md §4.4, rows 1-5): THE FRAME COST OF A SCULPT DRAG on a placed track, on the real page (app/index.html) in HEADLESS Chrome (never a window, muted:
// soundrender.js passes --mute-audio), served from this checkout, frames uncapped as in drag-frame.test.js. The bar is the user's 165 Hz display, 6.0 ms (the D404 ruling).
// THE TRACK is made here in node by the shell itself (createCoreShell: extend, close) and handed to the page as the autosave a last session left behind (a stand-in for the native side answers
// open_autosave with it and keeps what the page autosaves), then taken with the page's own "Restore it". So every row starts from the same document, bit for bit.
// THE DRAG is the brush on the road: the camera to the station, the page's own t180-pick finds a point of the road near it, and a real pointer press there, 3 s of moves up and down, a release.
// The tool is chosen by sculptTool(): in the Sculpt mode (D421 part 3: Tab, then a digit, 1 Grab, 3 Bend, 5 Twist, and a radius field) when the page has it; on a page without it (ea54ac3, the red
// base) the old brush strip's mode and channel that are that tool (Grab = height, Bend = rate kh, Twist = rate phi).
// A WORK frame is one in which the page's own animation-frame callbacks, plus the pointer events handled since the frame began, took more than 1 ms. A case is run again once if it misses, as in
// drag-frame.test.js (a case passes when either run does; every run's figures are in the message). Skipped, with the reason, where there is no Chrome. Rows:
//   1  Twist on a 1-piece window of a 12-piece track, every look: the work frames' p95 <= 6.0 ms
//   2  Grab, r = 200 m across three pieces of a 10 km open lap: p95 <= 6.0 ms
//   3  Bend on a 10 km CLOSED lap: p95 <= 6.0 ms during the drag, the release's handler <= 6.0 ms, and the re-closed exact road (closed, a station every 2 m) whole within 10 s
//   4  the closed tube oval (a 360 deg tube all the way round, the D235 / D236 oval): p95 <= 6.0 ms during the drag, no frame or task over 120 ms during it or for 10 s after, the exact road whole within 10 s.
//      The design names Twist; the user's call 3 (plan_d421_sculpt_build_2026-10-20.md: "a closed tube past 300 deg: width, bank and sweep stay refused") refuses Twist on this oval, so 4a drags
//      Grab on it (the heavy mesh) and 4b Twist on the same oval at a 280 deg sweep, the heaviest one Twist may touch
//   5  the release is the exact road: after letting go, the stations are every 2 m again and the document is, bit for bit, the one the shell's sculptOnce gives for the same brush and delta
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { chromePath, launchChrome, connect } = require('./soundrender.js');
const { createCoreShell } = require('../core/coreshell.js');
const { PER_PX } = require('../core/panel.js');
const D = require('../../src/core/document.js');

const REPO = path.join(__dirname, '..', '..');
const CHROME = chromePath();
const skip = CHROME ? false : 'no Chrome here (set CHROME_PATH): the sculpt drag is timed in headless Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.css': 'text/css' };
const LOOKS = ['aqua', 'skyline', 'glass', 'aurora', 'sigil'];
const BUDGET = 6.0;          // ms: the user's display is 165 Hz (6.06 ms a frame), the D404 ruling
const STALL = 120;           // ms: past the ordinary range nothing may take longer (release-frame.test.js row 2)
const WHOLE_MS = 10000;      // the exact road whole within 10 s (the design's rows 3 and 4)
const RUNS = 2;
const DRAG_MS = 3000;
const DEG = Math.PI / 180;

// TIMED ROWS ONLY UNDER BOTH SLOTS (the chair, D421 part 5: "Its timing rows run only with BOTH lock slots held by a live process"): the heavy-run lock's two slot files, each held by a live
// process, one of them this run (its token, CONSONANCE_HEAVY_RUN_TOKEN, which heavy-run.js gives every child of its holder). A timing taken beside another seat's heavy run measures that run.
function dataDir() {
  if (process.env.CONSONANCE_DATA) return process.env.CONSONANCE_DATA;
  try { const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.consonance.json'), 'utf8')); if (c && typeof c.data_dir === 'string') return c.data_dir; } catch (e) { /* no config: no lock to read */ }
  return null;
}
const alive = (pid) => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function bothSlots() {
  const dir = dataDir(), mine = process.env.CONSONANCE_HEAVY_RUN_TOKEN;
  if (!dir) return 'not timed: no heavy-run data dir (CONSONANCE_DATA or ~/.consonance.json data_dir), so the two slots cannot be read';
  if (!mine) return 'not timed: this run does not hold a heavy-run slot (no CONSONANCE_HEAVY_RUN_TOKEN): run it under heavy-run.js hold(), with the second slot held too';
  const locks = ['heavy-run.lock', 'heavy-run.2.lock'].map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return null; } });
  if (!locks.every((l) => l && alive(l.pid))) return `not timed: both heavy-run slots must be held by a live process (${locks.map((l, i) => `slot ${i + 1}: ${l ? `pid ${l.pid} ${alive(l.pid) ? 'alive' : 'dead'}` : 'free'}`).join(', ')})`;
  if (!locks.some((l) => l.token === mine)) return 'not timed: neither heavy-run slot is this run\'s';
  return false;
}
const timed = skip || bothSlots();

// THE TRACKS, made by the shell (the same calls a person's Extend and Close make), as the document's text
const R = 180, Q = (Math.PI * R) / 2;
const TRACKS = {
  twelve: (s) => { s.extend({ length: 100, family: 'bowl' }); for (let i = 1; i < 12; i++) s.extend({ length: 100, transition: 40, targets: { kh: ((i % 2 ? 12 : -12) * DEG) / 100 } }); },   // 12 x 100 m, turning 12 deg/100 m each way
  open10: (s) => { s.extend({ length: 200, family: 'bowl' }); for (let i = 1; i < 50; i++) s.extend({ length: 200, transition: 40, targets: { kh: (Math.floor(i / 5) % 2 ? 1 : -1) / 2000 } }); },   // 50 x 200 m, swinging at a 2 km radius
  closed10: (s) => { s.extend({ length: 200, family: 'bowl' }); for (let k = 0; k < 2; k++) { for (let i = 0; i < (k ? 20 : 19); i++) s.extend({ length: 200, transition: 40, targets: { kh: 0 } }); for (let i = 0; i < 5; i++) s.extend({ length: 200, transition: 40, targets: { kh: Math.PI / 1000 } }); } s.close(); },   // 10 km: 4 km straights, 1 km half-turns, closed
  tube360: (s) => { s.extend({ length: 300, first: { w: 31, t: 360 } }); for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 60, transition: 40, targets: { kh: 0 } }); s.close(); },
  tube280: (s) => { s.extend({ length: 300, first: { w: 31, t: 280 } }); for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 60, transition: 40, targets: { kh: 0 } }); s.close(); },
};
const texts = {};
async function trackText(name) {
  if (texts[name]) return texts[name];
  const s = await createCoreShell({ autosaveMs: 0 }); TRACKS[name](s);
  const d = s.getState().history.present; assert.ok(d.pieces.length >= 6, `${name}: ${s.getState().message}`); if (/closed|tube/.test(name)) assert.equal(d.closed, true, `${name} closes: ${s.getState().message}`);
  return (texts[name] = D.serialize(d));
}

let srv, ch, ws, dir, base, send, ev, errors = [];
test.before(async () => {
  if (skip) return;
  srv = http.createServer((q, s) => {
    const p = path.normalize(path.join(REPO, decodeURIComponent(q.url.split('?')[0])));
    if (!p.startsWith(REPO)) { s.writeHead(403); s.end(); return; }
    fs.readFile(p, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); s.end(b); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  let tgt; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--window-size=1400,860', '--disable-frame-rate-limit', '--disable-gpu-vsync'], 't180sculpt-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl, (d) => { if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text); }));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 600)}`); return d.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false });
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); if (srv) srv.close(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

// before the page's own scripts: the native side's stand-in (open_autosave answers the track once, save_autosave keeps the page's latest in __saved, lists are empty, the rest answers nothing);
// every animation-frame callback timed by its frame's timestamp; pointer events timed between a capture and a bubble listener on the window; every long task (over 50 ms) kept
const pre = (text) => `(() => {
  let left = ${JSON.stringify(JSON.stringify({ schema: 1, kind: 'core', name: null, doc: text }))};
  window.__saved = null;
  window.__TAURI__ = { core: { invoke: (cmd, args) => { if (cmd === 'open_autosave') { const t = left; left = null; return Promise.resolve(t); } if (cmd === 'save_autosave') { window.__saved = args.text; return Promise.resolve(); } if (/^list_/.test(cmd)) return Promise.resolve([]); return Promise.resolve(null); } } };
  const raf = window.requestAnimationFrame.bind(window), ft = window.__ft = { on: false, frames: new Map(), ev: [], long: [] };
  window.requestAnimationFrame = (fn) => raf((ts) => { const t0 = performance.now(); try { return fn(ts); } finally { if (ft.on) { const f = ft.frames.get(ts) || { ms: 0 }; f.ms += performance.now() - t0; ft.frames.set(ts, f); } } });
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) { let a = 0; window.addEventListener(type, () => { a = performance.now(); }, true); window.addEventListener(type, () => { if (ft.on) ft.ev.push([type, a, performance.now() - a]); }, false); }
  try { new PerformanceObserver((l) => { if (ft.on) for (const e of l.getEntries()) ft.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: false }); } catch (e) { /* no long-task timing in this Chrome */ }
})();`;
async function load(look, track) {
  const text = await trackText(track);
  await send('Page.navigate', { url: `${base}/app/lib/cjs.js` });
  for (let i = 0; i < 50; i++) { await sleep(100); try { if ((await ev('return location.href;')) === `${base}/app/lib/cjs.js`) break; } catch (e) { /* loading */ } }
  await ev(`localStorage.clear(); localStorage.setItem('t180.settings.theme', ${JSON.stringify(JSON.stringify(look))}); localStorage.setItem('t180.guide.done', '1'); return true;`);
  const id = (await send('Page.addScriptToEvaluateOnNewDocument', { source: pre(text) })).result.identifier;
  errors = []; await send('Page.navigate', { url: `${base}/app/index.html` });
  for (let i = 0; i < 200; i++) { await sleep(200); try { if (await ev("await new Promise((r) => setTimeout(r, 1000)); return !!document.querySelector('#palette input[aria-label]') && document.querySelectorAll('#stage canvas').length >= 2 && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Restore it');")) break; } catch (e) { /* loading */ } }
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id });
  await ev("const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Skip'); if (b && b.offsetParent) b.click(); return true;");
  assert.ok(await ev("const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Restore it'); if (!b) return false; b.click(); return true;"), `${track}: the page offered the track to restore`);
  const n = D.parse(text).pieces.length;
  for (let i = 0; i < 100; i++) { await sleep(200); const t = await roadNow(); if (t && t.pieces === n && t.whole) break; }
  const t = await roadNow(); assert.ok(t && t.whole, `${track}: the restored road is on show (${JSON.stringify(t)})`);
  await ev('window.__saved = null; return true;');
}
/** the road on show (the preview's own path): its stations' largest gap, closed or not, the pieces, and whether it is whole (a station every 2 m, and the coarse detail gone where the preview says) */
// and not the DRAG's road (D421c, E's p-d421c-p2-E_2026-10-21.md §5): while the release is built (and a closed lap re-closed), the reply is the road from before the drag, how 'drag',
// closed with a station every 2 m, so without this the row read "whole" about 110 ms after the release, before the exact road was in
const roadNow = () => ev(`let t = null; document.dispatchEvent(new CustomEvent('t180:track-request', { detail: { reply: (x) => { t = x; } } }));
  if (!t || !t.path || !t.path.samples || !t.path.samples.length) return null;
  const s = t.path.samples; let gap = 0; for (let i = 1; i < s.length; i++) gap = Math.max(gap, s[i].s - s[i - 1].s);
  const ids = new Set((t.segments || []).map((g) => g.id)), pieces = ids.size;
  return { stations: s.length, gap, closed: !!t.closed, pieces, detail: t.detail === undefined ? null : t.detail, how: t.how === undefined ? null : t.how, whole: gap <= 2 + 1e-6 && (t.detail === undefined || t.detail === 1) && t.how !== 'drag' };`);

const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: extra.button || 'none', buttons: extra.buttons || 0, clickCount: extra.clickCount || 0 });
const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };

// THE TOOLS: the Sculpt mode's digit (D421 part 3) and, for a page without the mode, the old brush strip's mode and channel; `ch` is the brush channel a pointer pixel is scaled by (panel.js PER_PX)
// `axis`: the pointer axis the tool reads in the Sculpt mode (B's page, p-d421-sculptmode-B_2026-10-20.md §5: Bend reads x, left is more; the rest read y, up is more); the old brush strip reads y for every channel
const TOOLS = { grab: { digit: '1', mode: 'local', channel: 'height', ch: 'height' }, bend: { digit: '3', mode: 'rate', channel: 'kh', ch: 'kh', axis: 'x' }, twist: { digit: '5', mode: 'rate', channel: 'phi', ch: 'phi' } };
async function sculptTool(tool, r) {
  const T = TOOLS[tool];
  const old = await ev("return !!document.querySelector('input[aria-label=\"brush on\"]');");
  if (old) {
    const said = await ev(`const q = (s) => document.querySelector(s), on = q('input[aria-label="brush on"]'), m = q('select[aria-label="brush mode"]'), c = q('select[aria-label="brush channel"]'), rad = [...document.querySelectorAll('input')].find((e) => /brush radius/.test(e.getAttribute('aria-label') || e.title || ''));
      m.value = '${T.mode}'; m.dispatchEvent(new Event('change', { bubbles: true })); c.value = '${T.channel}'; c.dispatchEvent(new Event('change', { bubbles: true }));
      rad.value = '${r}'; rad.dispatchEvent(new Event('input', { bubbles: true })); rad.dispatchEvent(new Event('change', { bubbles: true }));
      on.checked = true; on.dispatchEvent(new Event('change', { bubbles: true })); return [on.checked, m.value, c.value, rad.value].join(' ');`);
    assert.equal(said, `true ${T.mode} ${T.channel} ${r}`, `the brush strip took the ${tool} brush`);
    return 'brush strip';
  }
  // the Sculpt mode: Tab with the focus on the page (not in a field), the tool's digit, then the radius field
  await ev('document.activeElement && document.activeElement.blur && document.activeElement.blur(); return true;');
  await key('Tab', 'Tab', 9); await sleep(200);
  await key(T.digit, `Digit${T.digit}`, 48 + Number(T.digit)); await sleep(200);
  const said = await ev(`const rad = [...document.querySelectorAll('input')].find((e) => e.offsetParent && /radius/i.test(e.getAttribute('aria-label') || e.title || '')); if (!rad) return null; rad.value = '${r}'; rad.dispatchEvent(new Event('input', { bubbles: true })); rad.dispatchEvent(new Event('change', { bubbles: true })); return rad.value;`);
  assert.equal(said, String(r), `the Sculpt mode has a radius field (an input whose label says "radius"): ${said}`);
  return 'sculpt mode';
}
/** a point of the road near station s, on the 3D view: the camera there, then the page's own pick over a grid of the view */
async function pointAt(s) {
  await ev(`document.dispatchEvent(new CustomEvent('t180-camera-focus', { detail: { s: ${s} } })); return true;`); await sleep(2500);
  const hit = await ev(`const st = document.getElementById('preview').getBoundingClientRect(); let best = null;
    for (let y = 0.15; y < 0.9; y += 0.04) for (let x = 0.1; x < 0.9; x += 0.03) { const px = Math.round(x * st.width), py = Math.round(y * st.height); let h = null; document.dispatchEvent(new CustomEvent('t180-pick', { detail: { x: px, y: py, reply: (v) => { h = v; } } }));
      if (h) { const ex = st.left + px, ey = st.top + py, e = document.elementFromPoint(ex, ey); if (!e || e.tagName !== 'CANVAS' || !e.closest('#stage')) continue; const d = Math.abs(h.s - ${s}); if (!best || d < best.d) best = { d, s: h.s, x: ex, y: ey, px, py }; } }
    return best;`);
  assert.ok(hit, `no point of the road near ${s} m under the 3D view`);
  return hit;
}

/** one sculpt drag: the track, the tool, its radius and centre, the pointer's swing (px); the work frames during it, the release, and (afterMs) the road until it is whole */
async function sculptDrag(look, track, tool, r, s, amp, afterMs = 1500) {
  await load(look, track);
  const how = await sculptTool(tool, r), hit = await pointAt(s);
  const pickAgain = await ev(`let h = null; document.dispatchEvent(new CustomEvent('t180-pick', { detail: { x: ${hit.px}, y: ${hit.py}, reply: (v) => { h = v; } } })); return h ? h.s : null;`);
  assert.equal(pickAgain, hit.s, 'the view held still: the same point picks the same station');
  await mouse('mouseMoved', hit.x, hit.y); await sleep(100);
  await ev('window.__ft.frames.clear(); window.__ft.ev.length = 0; window.__ft.long.length = 0; window.__ft.on = true; return true;');
  await mouse('mousePressed', hit.x, hit.y, { button: 'left', buttons: 1, clickCount: 1 });
  const onX = how === 'sculpt mode' && TOOLS[tool].axis === 'x', t0 = Date.now(); let x = hit.x, y = hit.y;
  while (Date.now() - t0 < DRAG_MS) { const d = Math.round(Math.sin(((Date.now() - t0) / 1000) * Math.PI * 0.75) * amp); if (onX) x = hit.x - d; else y = hit.y - d; await mouse('mouseMoved', x, y, { buttons: 1 }); await sleep(8); }
  await sleep(150);   // the last move's frame is done
  const drag = await ev('const f = [...window.__ft.frames.entries()].map(([ts, x]) => [ts, x.ms]), e = window.__ft.ev.slice(), l = window.__ft.long.slice(); window.__ft.frames.clear(); window.__ft.ev.length = 0; window.__ft.long.length = 0; return { f, e, l };');
  const lastX = x, lastY = y, box = await ev("const r = document.getElementById('preview').getBoundingClientRect(); return [r.left, r.top];");
  await mouse('mouseReleased', lastX, lastY, { button: 'left', buttons: 0, clickCount: 1 });
  const tUp = Date.now(); let road = null, wholeAt = null;
  while (Date.now() - tUp < afterMs) { await sleep(100); road = await roadNow(); if (wholeAt === null && road && road.whole && (!/closed|tube/.test(track) || road.closed)) wholeAt = Date.now() - tUp; }
  const after = await ev('window.__ft.on = false; return { f: [...window.__ft.frames.entries()].map(([ts, x]) => [ts, x.ms]), e: window.__ft.ev.slice(), l: window.__ft.long.slice() };');
  // the drag's work frames: each frame's callbacks plus the pointer events handled from its start to the next frame's
  const fr = drag.f.sort((a, b) => a[0] - b[0]), cost = fr.map(([ts, ms], i) => ms + drag.e.filter(([, a]) => a >= ts && (i + 1 >= fr.length || a < fr[i + 1][0])).reduce((x, [, , d]) => x + d, 0));
  const work = cost.filter((m) => m > 1), up = after.e.find((e) => e[0] === 'pointerup');
  const longest = Math.max(0, ...cost, ...drag.l.map((x) => x[1]), ...after.f.map((x) => x[1]), ...after.l.map((x) => x[1]), up ? up[2] : 0);
  const delta = onX ? ((hit.x - box[0]) - (lastX - box[0])) : ((hit.y - box[1]) - (lastY - box[1]));   // the panel's brushTo: (press - last) in the stage's px on the tool's axis (left / up is more), times PER_PX of the channel
  return { how, s0: hit.s, r, tool, work, p95: work.length ? pct(work, 0.95) : 0, median: work.length ? pct(work, 0.5) : 0, handler: up ? up[2] : null, longest, wholeAt, road, delta, saved: await ev('return window.__saved;'), errors: errors.slice() };
}
async function within(fn, ok) { const runs = []; for (let i = 0; i < RUNS; i++) { const r = await fn(); runs.push(r); if (ok(r)) return { ok: true, runs }; } return { ok: false, runs }; }
const told = (v) => v.runs.map((r) => `p95 ${r.p95.toFixed(1)} (median ${r.median.toFixed(1)}, ${r.work.length} work frames), release ${r.handler === null ? '-' : r.handler.toFixed(1)}, longest ${r.longest.toFixed(0)}, whole after ${r.wholeAt === null ? 'never' : r.wholeAt} ms [${r.how}]`).join(' / ');
const enough = (r, what) => assert.ok(r.work.length >= 5, `${what}: the drag made the page do work in only ${r.work.length} frames (the brush did not take hold: ${r.how})`);

test('row 1: Twist on a 1-piece window of a 12-piece track, every look: the work frames\' p95 is within one frame at 165 Hz (6.0 ms)', { skip: timed }, async (t) => {
  const got = {};
  for (const look of LOOKS) {
    const v = await within(() => sculptDrag(look, 'twelve', 'twist', 50, 650, 60), (r) => r.p95 <= BUDGET);   // piece 6 of 12 (100 m each): its middle, r half its length
    got[look] = v.runs.map((r) => +r.p95.toFixed(1)); enough(v.runs[v.runs.length - 1], `${look} twist`);
    assert.ok(v.ok, `${look}, Twist on one piece of 12: ${told(v)}, over ${BUDGET} ms`);
  }
  t.diagnostic(`p95 ms by look: ${JSON.stringify(got)}`); assert.deepEqual(errors, []);
});

test('row 2: Grab, r = 200 m across three pieces of a 10 km open lap: p95 within one frame at 165 Hz (6.0 ms)', { skip: timed }, async (t) => {
  const v = await within(() => sculptDrag('aqua', 'open10', 'grab', 200, 5100, 60), (r) => r.p95 <= BUDGET);   // the middle of piece 25 of 50 (200 m each): the window reaches its two neighbours
  t.diagnostic(`10 km open, Grab r 200: ${told(v)}`); enough(v.runs[v.runs.length - 1], 'grab');
  assert.ok(v.ok, `Grab on a 10 km open lap: ${told(v)}, over ${BUDGET} ms`); assert.deepEqual(errors, []);
});

test('row 3: Bend on a 10 km CLOSED lap: p95 within 6.0 ms during the drag, the release\'s handler within 6.0 ms, and the re-closed exact road whole within 10 s', { skip: timed }, async (t) => {
  const v = await within(() => sculptDrag('aqua', 'closed10', 'bend', 200, 2100, 20, WHOLE_MS), (r) => r.p95 <= BUDGET && r.handler !== null && r.handler <= BUDGET && r.wholeAt !== null);   // on the first straight, 2 km in
  const r = v.runs[v.runs.length - 1]; t.diagnostic(`10 km closed, Bend r 200: ${told(v)}; the road at the end ${JSON.stringify(r.road)}`); enough(r, 'bend');
  assert.ok(v.ok, `Bend on a 10 km closed lap: ${told(v)} (bars: p95 ${BUDGET}, release ${BUDGET}, closed and a station every 2 m within ${WHOLE_MS} ms)`); assert.deepEqual(errors, []);
});

for (const [row, track, tool, why] of [['4a', 'tube360', 'grab', 'Grab on the 360 deg tube oval (Twist is refused there: the user\'s call 3)'], ['4b', 'tube280', 'twist', 'Twist on the same oval at a 280 deg sweep']]) {
  test(`row ${row}: ${why}: p95 within 6.0 ms during the drag, no frame or task over 120 ms during it or for 10 s after, and the exact road whole within 10 s`, { skip: timed }, async (t) => {
    const v = await within(() => sculptDrag('aqua', track, tool, 60, 150, 40, WHOLE_MS), (r) => r.p95 <= BUDGET && r.longest <= STALL && r.wholeAt !== null);   // the first straight, 150 m in
    const r = v.runs[v.runs.length - 1]; t.diagnostic(`${track}, ${tool} r 60: ${told(v)}`); enough(r, `${track} ${tool}`);
    assert.ok(v.ok, `${why}: ${told(v)} (bars: p95 ${BUDGET}, longest ${STALL}, closed and a station every 2 m within ${WHOLE_MS} ms)`); assert.deepEqual(errors, []);
  });
}

test('row 5: the release is the exact road: a station every 2 m again, and the document is bit for bit the one the shell\'s sculptOnce gives for the same brush and delta', { skip }, async (t) => {
  const r = await sculptDrag('aqua', 'open10', 'grab', 200, 5100, 60, 3000);
  enough(r, 'grab');
  assert.ok(r.road && r.road.whole, `after the release the road is whole: ${JSON.stringify(r.road)}`);
  assert.ok(r.saved, 'the page autosaved the brushed track');
  const pageText = JSON.parse(r.saved).doc;
  const s = await createCoreShell({ autosaveMs: 0, storage: { openAutosave: async () => JSON.stringify({ schema: 1, kind: 'core', name: null, doc: await trackText('open10') }), saveAutosave: async () => {} } });
  s.restore(); const T = TOOLS.grab;
  s.sculptOnce({ mode: T.mode, channel: T.channel, s0: r.s0, r: r.r, delta: r.delta * PER_PX[T.ch] });
  assert.equal(s.getState().message === null || s.getState().messageKind !== 'error', true, `the shell's own stroke ran: ${s.getState().message}`);
  const want = D.serialize(s.getState().history.present);
  t.diagnostic(`s0 ${r.s0.toFixed(2)} m, delta ${r.delta} px, the brushed text ${pageText.length} characters`);
  assert.notEqual(pageText, await trackText('open10'), 'the drag changed the track');
  assert.equal(pageText, want, 'the page\'s document after the release is not the shell\'s sculptOnce of the same brush');
  assert.deepEqual(errors, []);
});
