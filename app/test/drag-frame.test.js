// drag-frame.test.js: node --test app/test/drag-frame.test.js   (under the heavy-run lock; about two minutes)
// D404 (the user: "even turning a 1000m straight isnt smooth and laggy as hell", then: "I want it as optimized as we can get it. If anything I always want it as smooth as
// the users refresh rate"): THE FRAME COST OF A HANDLE DRAG, on the real page (app/index.html) in HEADLESS Chrome (never a window), served from this checkout, in each of the
// five looks. A real pointer press on the turn handle of the Extend ghost, then the pointer is moved back and forth for 3 s, every animation frame timed (Chrome run without
// its frame-rate limit and vsync, so a page that is fast runs far faster than a display). A WORK frame is one in which the page's own animation-frame callbacks ran more than
// 1 ms: the frames a pointer move made the page rebuild the ghost in. The bar is the display's refresh rate: 144 Hz is 6.9 ms (165 Hz, this machine's display, is 6.06 ms).
// Skipped, with the reason, where there is no Chrome (CHROME_PATH or the usual place). Each case is run again, up to twice, if it misses the bar, so a seat running something else
// beside it does not fail the row (a case passes when any of its runs does; the figures of every run are in the message). Rows:
//   1  a 1,000 m turn dragged: p95 of the work frames' script time <= 6.0 ms in every look (before D404: 20 ms median, 25 to 30 at the 95th percentile)
//   2  a 2,000 m turn dragged: p95 <= 6.0 ms in every look (before: 40 ms median)
//   3  a 1,000 m and a 2,000 m piece stretched by its length handle: p95 <= 6.0 ms (before: 9 and 19 ms)
//   4  past the ordinary range the drag adapts and does not stall: a 20,000 m turn's p95 stays under 40 ms (before: 650 ms; now about 8), at no fewer than 20 rebuilds a second
//   5  the release is the exact road: during the drag the ghost has a few hundred path stations, and the moment the pointer is let go it has a station every 2 m again
//   6  a 1,000 m piece with bank, cup and edge typed, stretched by its length handle: p95 <= 13.4 ms, 1.5 x the worst of 0.4.19's six measured runs (D481; 0.4.21: 536 to 557 ms)
//   7  a 1,000 m piece with a left edge typed, turned after a placed piece: p95 <= 6.9 ms, one frame at 144 Hz (D483; before: 8.6 / 8.9 ms)
//   8  the same piece stretched on an empty track: at most 120 work frames a second (before: 356 / 362, every frame) and p95 <= 10.0 ms, a PROPOSED bar (D483: the 6.9 ms
//      standard is not reached there; before: 9.7 / 10.6 ms)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path');
const { chromePath, launchChrome, connect } = require('./soundrender.js');

const REPO = path.join(__dirname, '..', '..');
const CHROME = chromePath();
const skip = CHROME ? false : 'no Chrome here (set CHROME_PATH): the drag is timed in headless Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.css': 'text/css' };
const LOOKS = ['aqua', 'skyline', 'glass', 'aurora', 'sigil'];
const BUDGET = 6.0;          // ms: the user's display is 165 Hz (6.06 ms a frame); 6.9 ms is one frame at 144 Hz, the floor for a machine of that kind (the librarian's ruling, D404, 2026-10-19)
const RUNS = 2;              // a case is run again once if it misses
const DRAG_MS = 3000;

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
  let tgt; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--window-size=1400,860', '--disable-frame-rate-limit', '--disable-gpu-vsync'], 't180drag-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl, (d) => { if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text); }));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 500)}`); return d.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false });
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); if (srv) srv.close(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

// every animation-frame callback timed from page start; frames told apart by their timestamp
const PRE = `(() => { document.title = 'zz-headless-test'; const raf = window.requestAnimationFrame.bind(window); window.__ft = { on: false, frames: new Map() };
  window.requestAnimationFrame = (fn) => raf((ts) => { const t0 = performance.now(); try { return fn(ts); } finally { if (window.__ft.on) { const f = window.__ft.frames.get(ts) || { ms: 0 }; f.ms += performance.now() - t0; window.__ft.frames.set(ts, f); } } }); })();`;
async function load(look) {
  await send('Page.navigate', { url: `${base}/app/lib/cjs.js` });
  for (let i = 0; i < 50; i++) { await sleep(100); try { if ((await ev('return location.href;')) === `${base}/app/lib/cjs.js`) break; } catch (e) { /* loading */ } }
  await ev(`localStorage.clear(); localStorage.setItem('t180.settings.theme', ${JSON.stringify(JSON.stringify(look))}); localStorage.setItem('t180.guide.done', '1'); return true;`);
  const id = (await send('Page.addScriptToEvaluateOnNewDocument', { source: PRE })).result.identifier;
  errors = []; await send('Page.navigate', { url: `${base}/app/index.html` });
  for (let i = 0; i < 200; i++) { await sleep(200); try { if (await ev("await new Promise((r) => setTimeout(r, 1500)); return !!document.querySelector('#palette input[aria-label]') && document.querySelectorAll('#stage canvas').length >= 2;")) break; } catch (e) { /* loading */ } }
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id });
  await ev("document.title = 'zz-headless-test'; return true;");   // the page's own <title> replaced the one PRE set: a headless page is always titled so
  await ev("const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Skip'); if (b && b.offsetParent) b.click(); return true;");
}
const setLength = (m) => ev(`const f = [...document.querySelectorAll('#palette input')].find((e) => /metres added/.test(e.getAttribute('aria-label') || e.title || '')); f.value = '${m}'; f.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 1200)); return true;`);
/** the centre of a handle's colour on the overlay canvas (the handles are the only thing drawn there), in page px */
const findHandle = (rgb, rightmost) => ev(`
  const want = ${JSON.stringify(rgb)}, hits = [], off = document.getElementById('stage').getBoundingClientRect();
  for (const c of document.querySelectorAll('#stage canvas')) {
    let ctx = null; try { ctx = c.getContext('2d'); } catch (e) {} if (!ctx) continue;
    const d = ctx.getImageData(0, 0, c.width, c.height).data, cells = new Map();
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const k = (y * c.width + x) * 4; if (d[k + 3] < 200) continue; if (Math.abs(d[k] - want[0]) < 14 && Math.abs(d[k + 1] - want[1]) < 14 && Math.abs(d[k + 2] - want[2]) < 14) { const key = (x >> 5) + ',' + (y >> 5), a = cells.get(key) || [0, 0, 0]; a[0] += x; a[1] += y; a[2]++; cells.set(key, a); } }
    const groups = []; for (const [k, a] of cells) { const cx = +k.split(',')[0], cy = +k.split(',')[1]; let g = groups.find((g) => Math.abs(g.cx - cx) <= 1 && Math.abs(g.cy - cy) <= 1); if (!g) { g = { cx, cy, sx: 0, sy: 0, n: 0 }; groups.push(g); } g.sx += a[0]; g.sy += a[1]; g.n += a[2]; }
    for (const g of groups) if (g.n > 30) hits.push({ x: g.sx / g.n * c.clientWidth / c.width + off.left, y: g.sy / g.n * c.clientWidth / c.width + off.top, n: g.n });
  }
  hits.sort((a, b) => ${rightmost ? 'b.x - a.x' : 'b.n - a.n'}); return hits[0] || null;`);
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: extra.button || 'none', buttons: extra.buttons || 0, clickCount: extra.clickCount || 0 });
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const fieldNow = (re) => ev(`const f = [...document.querySelectorAll('#palette input')].find((e) => e.type !== 'checkbox' && ${re}.test(e.getAttribute('aria-label') || e.title || '') && !/start/i.test(e.getAttribute('aria-label') || '')); return f ? f.value : null;`);
const stationsNow = () => ev("let n = null; document.dispatchEvent(new CustomEvent('t180:ghost-request', { detail: { reply: (g) => { n = g ? g.samples.length : null; } } })); return n;");

/** one drag: the look, the piece length, which handle; the work frames' script ms (sorted by time), the rebuild rate, and the ghost's stations during and after the drag */
async function drag(look, length, kind, ms = DRAG_MS, typed = {}, { placed = false } = {}) {
  await load(look);
  if (placed) { await setLength(100); await ev("[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Extend').click(); await new Promise((r) => setTimeout(r, 1200)); return true;"); }   // a 100 m piece is placed first
  // D498 item 4 (A's review of 41e7595): each typed field must read back what was typed, so a renamed label or a field that refuses the value fails here, by name,
  // instead of timing an untyped drag (the field is found again after the input event, since the panel may rebuild it)
  const typedField = (re) => `[...document.querySelectorAll('#palette input')].find((e) => e.type !== 'checkbox' && ${re}.test(e.getAttribute('aria-label') || e.title || ''))`;
  for (const [re, v] of Object.entries(typed)) {
    const got = await ev(`const f = ${typedField(re)}; if (!f) return null; f.value = '${v}'; f.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 50)); const g = ${typedField(re)}; return g ? g.value : null;`);
    assert.equal(Number(got), Number(v), `${look}: the field ${re} reads back ${JSON.stringify(got)} after ${v} was typed`);
  }
  await setLength(length); await sleep(Math.min(4000, length / 4));   // a long piece's full ghost takes its time (a 20 km one about 2 s)
  const rgb = kind === 'turn' ? [185, 104, 255] : [255, 255, 255];
  // after a placed piece the handles are drawn small: the page's own list of them (t180:handles-request) is read instead of their colour, and the pointer moves along the handle's axis
  const listed = placed ? await ev("let l = null; document.dispatchEvent(new CustomEvent('t180:handles-request', { detail: { reply: (x) => { l = x; } } })); const r = document.getElementById('stage').getBoundingClientRect(); return { l, left: r.left, top: r.top };") : null;
  const lh = listed && listed.l ? listed.l.find((x) => x.kind === (kind === 'turn' ? 'turnDeg' : 'length')) : null, len = lh ? Math.hypot(lh.dx, lh.dy) : 0, axis = placed && len > 0 ? [lh.dx / len, lh.dy / len] : kind === 'turn' ? [1, 0] : [0, -1];
  const h = placed ? (lh ? { x: lh.x + listed.left, y: lh.y + listed.top } : null) : await findHandle(rgb, kind === 'turn'); assert.ok(h, `${look}: the ${kind} handle is on the overlay`);
  const amp = kind === 'turn' ? 250 : 220, field = kind === 'turn' ? '/turn/i' : '/metres|length/i', before = await fieldNow(field);
  await mouse('mouseMoved', h.x, h.y); await sleep(50); await mouse('mousePressed', h.x, h.y, { button: 'left', buttons: 1, clickCount: 1 }); await sleep(100);
  await ev('window.__ft.frames.clear(); window.__ft.on = true; return true;');
  const t0 = Date.now(); let moves = 0, duringStations = null;
  while (Date.now() - t0 < ms) {
    const d = Math.sin(((Date.now() - t0) / 1000) * Math.PI) * amp;
    await mouse('mouseMoved', h.x + axis[0] * d, h.y + axis[1] * d, { buttons: 1 }); moves++; await sleep(4);
    if (duringStations === null && Date.now() - t0 > ms / 2) duringStations = await stationsNow();
  }
  const during = await fieldNow(field);
  assert.notEqual(during, before, `${look} ${length} m ${kind}: the drag moved nothing (the field still reads ${before}): the handle was not held`);
  await ev('window.__ft.on = false; return true;');
  const frames = await ev('return [...window.__ft.frames.values()].map((f) => f.ms);');
  await mouse('mouseReleased', h.x, h.y, { button: 'left', buttons: 0, clickCount: 1 }); await sleep(600);
  const afterStations = await stationsNow(), work = frames.filter((m) => m > 1);
  assert.ok(work.length >= 5, `${look} ${length} m ${kind}: the drag made the page do work in only ${work.length} frames`);
  return { work, median: pct(work, 0.5), p95: pct(work, 0.95), rate: work.length / (ms / 1000), duringStations, afterStations };
}
/** a case passes when any run is within `bar`; the message carries every run */
async function within(look, length, kind, bar, rateMin = 0) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) { const r = await drag(look, length, kind); runs.push(r); if (r.p95 <= bar && r.rate >= rateMin) return { ok: true, runs }; }
  return { ok: false, runs };
}
const said = (look, length, kind, bar, v) => `${look}, a ${length} m ${kind} drag: p95 ${v.runs.map((r) => r.p95.toFixed(1)).join(' / ')} ms (median ${v.runs.map((r) => r.median.toFixed(1)).join(' / ')}), over ${bar} ms`;

test('row 1: a 1,000 m turn dragged in every look: the work frames\' p95 is within one frame at 165 Hz (6.0 ms)', { skip }, async (t) => {
  const got = {};
  for (const look of LOOKS) { const v = await within(look, 1000, 'turn', BUDGET); got[look] = v.runs.map((r) => +r.p95.toFixed(1)); assert.ok(v.ok, said(look, 1000, 'turn', BUDGET, v)); }
  t.diagnostic(`p95 ms by look: ${JSON.stringify(got)}`); assert.deepEqual(errors, []);
});

test('row 2: a 2,000 m turn dragged in every look: p95 within one frame at 165 Hz (6.0 ms)', { skip }, async (t) => {
  const got = {};
  for (const look of LOOKS) { const v = await within(look, 2000, 'turn', BUDGET); got[look] = v.runs.map((r) => +r.p95.toFixed(1)); assert.ok(v.ok, said(look, 2000, 'turn', BUDGET, v)); }
  t.diagnostic(`p95 ms by look: ${JSON.stringify(got)}`); assert.deepEqual(errors, []);
});

test('row 3: a 1,000 m and a 2,000 m piece stretched by its length handle: p95 within one frame at 165 Hz (6.0 ms)', { skip }, async (t) => {
  const got = {};
  for (const L of [1000, 2000]) { const v = await within('aqua', L, 'stretch', BUDGET); got[L] = v.runs.map((r) => +r.p95.toFixed(1)); assert.ok(v.ok, said('aqua', L, 'stretch', BUDGET, v)); }
  t.diagnostic(`p95 ms by length: ${JSON.stringify(got)}`);
});

test('row 4: past the ordinary range the drag adapts and does not stall: a 20,000 m turn\'s p95 stays under 40 ms, at 20 or more rebuilds a second', { skip }, async (t) => {
  const v = await within('aqua', 20000, 'turn', 40, 20);
  t.diagnostic(`20,000 m: p95 ${v.runs.map((r) => r.p95.toFixed(0)).join(' / ')} ms, ${v.runs.map((r) => r.rate.toFixed(1)).join(' / ')} rebuilds a second`);
  assert.ok(v.ok, `a 20,000 m turn drag: p95 ${v.runs.map((r) => r.p95.toFixed(0)).join(' / ')} ms, ${v.runs.map((r) => r.rate.toFixed(1)).join(' / ')} rebuilds a second`);
});

test('row 5: the release is the exact road: a few hundred stations while the handle is held, a station every 2 m the moment it is let go', { skip }, async (t) => {
  const r = await drag('aqua', 2000, 'turn');
  t.diagnostic(`ghost stations during the drag ${r.duringStations}, after the release ${r.afterStations}`);
  assert.ok(r.duringStations > 0 && r.duringStations < 600, `during the drag: ${r.duringStations} stations (a full ghost of 2,000 m has about 1,000)`);
  assert.ok(r.afterStations > 900, `after the release: ${r.afterStations} stations (a station every 2 m is about 1,000 on a 2,000 m piece: the full ghost is back)`);
});

// D481 (the user: "as soon as I drag the straight more than 400m it lags very bad"): with bank, cup and edge typed, the stretch costs what it cost in 0.4.19. Measured on 0.4.19,
// headless, BelowNormal, the machine quiet, by this file's own drag: p95 7.7, 7.7, 7.9, 8.9, 8.2, 8.2 ms; the bar is the worst of them with half again for margin. On 0.4.21: p95 557 and 536 ms, about 5
// rebuilds a second. (0.4.19 itself is over one frame at 144 Hz here, so this row guards the regression, not the user's 6.9 ms standard; that is a separate finding.)
const TYPED = { '/^degrees of bank/': 20, '/^cup:/': 30, '/^left edge/': 20 };
const BUDGET_TYPED = 13.4;   // ms: 1.5 x 8.9, 0.4.19's worst measured p95
test('row 6: a 1,000 m piece with bank, cup and edge typed, stretched by its length handle: p95 within 0.4.19\'s cost with margin (13.4 ms)', { skip }, async (t) => {
  const runs = [];
  for (let i = 0; i < RUNS; i++) { const r = await drag('aqua', 1000, 'stretch', DRAG_MS, TYPED); runs.push(r); if (r.p95 <= BUDGET_TYPED) break; }
  const v = { runs, ok: runs.some((r) => r.p95 <= BUDGET_TYPED) };
  t.diagnostic(`p95 ${runs.map((r) => r.p95.toFixed(1)).join(' / ')} ms, ${runs.map((r) => r.rate.toFixed(1)).join(' / ')} rebuilds a second`);
  assert.ok(v.ok, `${said('aqua', 1000, 'stretch with bank, cup and edge typed', BUDGET_TYPED, v)}, ${runs.map((r) => r.rate.toFixed(1)).join(' / ')} rebuilds a second`);
});

// D483 (the user's 6.9 ms standard, which row 6 does not reach): a left edge alone made every frame read the head's span afresh (preview.js widthAtHead: the dragged ghost's
// head is not frozen, so it was not remembered, and spanOf on its 137 knots summed each one from the centre out) and every move write its 48 chords out as text and hash them
// again (mesh.js handleKey, trackmodel.js: about 10 kB a chord). Measured before the fix, headless, BelowNormal, the machine quiet, by this file's own drag: p95 8.6 / 8.9 ms
// after a placed piece, 9.7 / 10.6 ms on an empty track. After a placed piece the length handle barely moves on screen, so that case drags the turn handle along its own axis.
const EDGE = { '/^left edge/': 20 };
const BUDGET_EDGE = 6.9;     // ms: one frame at 144 Hz, the user's standard
async function edgeRow(t, kind, placed, bar, rateMax = Infinity) {
  const runs = [], ok = (r) => r.p95 <= bar && r.rate <= rateMax;
  for (let i = 0; i < RUNS; i++) { const r = await drag('aqua', 1000, kind, DRAG_MS, EDGE, { placed }); runs.push(r); if (ok(r)) break; }
  t.diagnostic(`p95 ${runs.map((r) => r.p95.toFixed(1)).join(' / ')} ms (median ${runs.map((r) => r.median.toFixed(1)).join(' / ')}), ${runs.map((r) => r.rate.toFixed(1)).join(' / ')} work frames a second`);
  assert.ok(runs.some(ok), `${said('aqua', 1000, `${kind} with a left edge typed${placed ? ' after a placed piece' : ' on an empty track'}`, bar, { runs })}, ${runs.map((r) => r.rate.toFixed(1)).join(' / ')} work frames a second${rateMax < Infinity ? ` (at most ${rateMax})` : ''}`);
  assert.deepEqual(errors, []);
}
test('row 7: a 1,000 m piece with a left edge typed, turned after a placed piece: p95 within one frame at 144 Hz (6.9 ms)', { skip }, async (t) => {
  await edgeRow(t, 'turn', true, BUDGET_EDGE);   // after D483: 4.4 / 4.3 ms
});
// D484: ON AN EMPTY TRACK THE STANDARD IS NOW REACHED. After D483 the stretch measured p95 8.7 to 9.2 ms, and what was left was the core: each move read the edge ramp's
// B-spline samples afresh (src/core/extend.js samplesOf, now built by one span walk and kept by the knot vector's values) and made the piece's edge cross-sections at every
// chord end (src/core/adapter.js xsecSegments, now once per distinct start a piece; src/geom/profile.js commonFractions, once per distinct knot set). Measured headless,
// BelowNormal, the machine quiet, by this file's own drag, d483-c and d484 alternately: p95 9.1 / 9.6 / 9.4 / 8.8 / 9.0 ms before, 6.2 / 6.6 / 6.3 / 6.1 / 6.0 after. The bar was
// 10.0 ms (proposed, D483) and is now the standard. The rate half stands: before D483 the page did work on EVERY frame of this drag (356 / 362 work frames a second, the
// head's span), and since only on a move of the pointer (about 58); at most 120 a second.
test('row 8: a 1,000 m piece with a left edge typed, stretched on an empty track: the page works only on a move (at most 120 work frames a second), p95 within one frame at 144 Hz (6.9 ms)', { skip }, async (t) => {
  await edgeRow(t, 'stretch', false, BUDGET_EDGE, 120);
});
