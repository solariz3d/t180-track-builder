// release-frame.test.js: node --test app/test/release-frame.test.js   (under the heavy-run lock; about two minutes)
// D407 (the user: "even turning a 1000m straight isnt smooth and laggy as hell"; the measurement of 2026-10-19, exo_memory/handback/p-d407-measure-A_2026-10-19.md): LETTING GO of a handle
// built the exact ghost of the piece at once, inside the pointer-up: 60 ms at 1,000 m, 280 at 5,000, a second at 20 km, the page frozen meanwhile; and a number typed into a field of the
// panel cost 13 ms. On the real page (app/index.html) in HEADLESS Chrome (never a window, muted), served from this checkout, frames uncapped as in drag-frame.test.js. The bar is the user's
// 165 Hz display, 6.0 ms (docs/ARCHITECTURE.md §9b). The cost of an action is the LONGEST piece of main-thread work it causes: the pointer-up handler itself (taken between a capture
// listener and a bubble listener on the window) and each animation frame's callbacks after it. Each case is run again once if it misses, so a seat running something beside it does
// not fail the row (a case passes when either run does; every run's figures are in the message). Skipped, with the reason, where there is no Chrome. Rows:
//   1  letting go of a 1,000 m turn handle and of a 1,000 m length handle, in every look: nothing it causes takes more than 6.0 ms (before: 60 ms in the handler)
//   2  past the ordinary range it does not stall: letting go of a 20,000 m turn, nothing takes more than 120 ms (before: 1,058 ms in one handler), and the exact ghost is whole within 10 s
//   3  the exact ghost arrives and nothing blinks: after letting go of a 2,000 m turn the ghost is on show at every frame until the exact one (a station every 2 m) takes its place, within 1 s
//   4  a number typed into the Turn field on a 12-piece track (aqua): each change costs at most 6.0 ms at the 95th percentile, handler and frames together (before: 13 ms)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path');
const { chromePath, launchChrome, connect } = require('./soundrender.js');

const REPO = path.join(__dirname, '..', '..');
const CHROME = chromePath();
const skip = CHROME ? false : 'no Chrome here (set CHROME_PATH): the release is timed in headless Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.css': 'text/css' };
const LOOKS = ['aqua', 'skyline', 'glass', 'aurora', 'sigil'];
const BUDGET = 6.0;          // ms: the user's display is 165 Hz (6.06 ms a frame), the D404 ruling
const RUNS = 2;

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
  let tgt; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--window-size=1400,860', '--disable-frame-rate-limit', '--disable-gpu-vsync'], 't180rel-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl, (d) => { if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text); }));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 600)}`); return d.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false });
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); if (srv) srv.close(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

// every animation-frame callback timed (by its frame's timestamp); the pointer-up and every input and click event timed between a capture and a bubble listener on the window;
// and, each frame while __ft.watch is on, whether a ghost is on show and how many stations it has
const PRE = `(() => { document.title = 'zz-headless-test'; const raf = window.requestAnimationFrame.bind(window); const ft = window.__ft = { on: false, frames: new Map(), ev: [], watch: false, seen: [] };
  window.requestAnimationFrame = (fn) => raf((ts) => { const t0 = performance.now(); try { return fn(ts); } finally { if (ft.on) { const f = ft.frames.get(ts) || { ms: 0 }; f.ms += performance.now() - t0; ft.frames.set(ts, f); } } });
  for (const type of ['pointerup', 'input', 'click']) { let a = 0; window.addEventListener(type, () => { a = performance.now(); }, true); window.addEventListener(type, () => { if (ft.on) ft.ev.push([type, a, performance.now() - a]); }, false); }
  ft.asked = []; for (const t of ['t180-ghost', 't180-ghost-clear']) document.addEventListener(t, (e) => { if (ft.on) ft.asked.push([Math.round(performance.now()), t, e.detail ? [!!e.detail.cheap, !!e.detail.sliced, e.detail.candidate && e.detail.candidate.segments ? e.detail.candidate.segments.length : null] : null]); }, true);   // what the panel asked of the preview, for a failure's message
  const look = () => { if (ft.watch) { let n = null; document.dispatchEvent(new CustomEvent('t180:ghost-request', { detail: { reply: (g) => { n = g ? g.samples.length : null; } } })); ft.seen.push([performance.now(), n]); } raf(look); }; raf(look);
})();`;
async function load(look) {
  await send('Page.navigate', { url: `${base}/app/lib/cjs.js` });
  for (let i = 0; i < 50; i++) { await sleep(100); try { if ((await ev('return location.href;')) === `${base}/app/lib/cjs.js`) break; } catch (e) { /* loading */ } }
  await ev(`localStorage.clear(); localStorage.setItem('t180.settings.theme', ${JSON.stringify(JSON.stringify(look))}); localStorage.setItem('t180.guide.done', '1'); return true;`);
  const id = (await send('Page.addScriptToEvaluateOnNewDocument', { source: PRE })).result.identifier;
  errors = []; await send('Page.navigate', { url: `${base}/app/index.html` });
  for (let i = 0; i < 200; i++) { await sleep(200); try { if (await ev("await new Promise((r) => setTimeout(r, 1500)); return !!document.querySelector('#palette input[aria-label]') && document.querySelectorAll('#stage canvas').length >= 2;")) break; } catch (e) { /* loading */ } }
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id });
  await ev("document.title = 'zz-headless-test'; return true;");   // D484: a headless page is always titled so; the page's own <title> replaced any set before
  await ev("const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Skip'); if (b && b.offsetParent) b.click(); return true;");
}
const FIELD = (re) => `[...document.querySelectorAll('#palette input')].find((e) => e.type !== 'checkbox' && ${re}.test(e.getAttribute('aria-label') || e.title || '') && !/start/i.test(e.getAttribute('aria-label') || ''))`;
const setField = (re, v) => ev(`const f = ${FIELD(re)}; f.value = '${v}'; f.dispatchEvent(new Event('input', { bubbles: true })); return true;`);
const findHandle = (rgb, rightmost) => ev(`
  const want = ${JSON.stringify(rgb)}, hits = [], off = document.getElementById('stage').getBoundingClientRect();
  for (const c of document.querySelectorAll('#stage canvas')) {
    let ctx = null; try { ctx = c.getContext('2d'); } catch (e) {} if (!ctx) continue;
    const d = ctx.getImageData(0, 0, c.width, c.height).data, cells = new Map();
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const k = (y * c.width + x) * 4; if (d[k + 3] < 200) continue; if (Math.abs(d[k] - want[0]) < 14 && Math.abs(d[k + 1] - want[1]) < 14 && Math.abs(d[k + 2] - want[2]) < 14) { const key = (x >> 5) + ',' + (y >> 5); const a = cells.get(key) || [0, 0, 0]; a[0] += x; a[1] += y; a[2]++; cells.set(key, a); } }
    const groups = []; for (const [k, a] of cells) { const cx = +k.split(',')[0], cy = +k.split(',')[1]; let g = groups.find((g) => Math.abs(g.cx - cx) <= 1 && Math.abs(g.cy - cy) <= 1); if (!g) { g = { cx, cy, sx: 0, sy: 0, n: 0 }; groups.push(g); } g.sx += a[0]; g.sy += a[1]; g.n += a[2]; }
    for (const g of groups) if (g.n > 30) hits.push({ x: g.sx / g.n * c.clientWidth / c.width + off.left, y: g.sy / g.n * c.clientWidth / c.width + off.top, n: g.n });
  }
  hits.sort((a, b) => ${rightmost ? 'b.x - a.x' : 'b.n - a.n'}); return hits[0] || null;`);
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: extra.button || 'none', buttons: extra.buttons || 0, clickCount: extra.clickCount || 0 });
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const stationsNow = () => ev("let n = null; document.dispatchEvent(new CustomEvent('t180:ghost-request', { detail: { reply: (g) => { n = g ? g.samples.length : null; } } })); return n;");

/** a drag of `kind` on a fresh `length` m piece for 1.5 s, then the release: the pointer-up handler's ms, each frame's script ms after it, and (watch) the ghost's stations at every frame */
async function release(look, length, kind, settleMs) {
  await load(look); await setField('/metres added/', length); await sleep(Math.min(4000, 600 + length / 4));
  // the handle where the panel says it is (its 't180:handles-request', css px of the stage): a turn kind for a turn, the length for a stretch, on the stage's own canvas (not under the palette
  // or the camera bar, which float over the stage)
  const handlesNow = () => ev("let l = null; document.dispatchEvent(new CustomEvent('t180:handles-request', { detail: { reply: (x) => { l = x; } } })); const r = document.getElementById('stage').getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const onStage = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && e.tagName === 'CANVAS' && !!e.closest('#stage'); }; return (l || []).map((h) => ({ ...h, x: h.x + r.left, y: h.y + r.top, off: Math.hypot(h.x + r.left - cx, h.y + r.top - cy) })).filter((h) => onStage(h.x, h.y)).sort((a, b) => a.off - b.off);");
  // the view frames the new piece after it is typed (it eases there): the handle is pressed once it has held still for three looks, 100 ms apart
  let list = await handlesNow(), h = null;
  for (let i = 0, still = 0, was = null; i < 60 && still < 3; i++) {
    await sleep(100); list = await handlesNow(); h = list.find((c) => (kind === 'turn' ? /turn/i.test(c.kind) : c.kind === 'length'));   // of the matching handles, the one nearest the stage's middle
    still = h && was && Math.hypot(h.x - was.x, h.y - was.y) < 0.5 ? still + 1 : 0; was = h;
  }
  assert.ok(h, `${look}: the ${kind} handle is on the stage (handles: ${JSON.stringify(list.map((c) => c.kind))})`);
  await mouse('mouseMoved', h.x, h.y); await sleep(50); await mouse('mousePressed', h.x, h.y, { button: 'left', buttons: 1, clickCount: 1 }); await sleep(100);
  // the pointer swings from the handle toward the stage's middle and back (never off the page: a drag taken out of the window is cancelled, and its release would cost nothing)
  const st = await ev("const r = document.getElementById('stage').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];"), dx = Math.sign(st[0] - h.x) || 1, dy = Math.sign(st[1] - h.y) || 1;
  const amp = kind === 'turn' ? 200 : 150, t0 = Date.now(); let x = h.x, y = h.y;
  while (Date.now() - t0 < 1500) { const d = Math.abs(Math.sin(((Date.now() - t0) / 1000) * Math.PI)) * amp; x = kind === 'turn' ? h.x + dx * d : h.x; y = kind === 'turn' ? h.y : h.y + dy * d; await mouse('mouseMoved', x, y, { buttons: 1 }); await sleep(4); }
  // the drag ends where it began (on the stage) and is let go there: a release over the camera bar at the stage's foot is not the stage's (a drag loses its pointer
  // capture about 100 ms in, as it did in 0.4.8, so such a release never reaches the handles; found by this test, reported with D407 and not changed here)
  x = h.x; y = h.y; await mouse('mouseMoved', x, y, { buttons: 1 });
  assert.ok(await ev(`const e = document.elementFromPoint(${x}, ${y}); return !!e && e.tagName === 'CANVAS' && !!e.closest('#stage');`), `${look} ${length} m ${kind}: the release point is on the stage`);
  await sleep(150);   // the last move's frame is done
  await ev('window.__ft.frames.clear(); window.__ft.ev.length = 0; window.__ft.seen.length = 0; window.__ft.asked.length = 0; window.__ft.on = true; window.__ft.watch = true; return true;');
  await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 }); await sleep(settleMs);
  await ev('window.__ft.on = false; window.__ft.watch = false; return true;');
  const up = await ev("const e = window.__ft.ev.find((e) => e[0] === 'pointerup'); return e ? [e[1], e[2]] : null;");
  assert.ok(up, `${look} ${length} m ${kind}: the release reached the page`);
  const frames = (await ev('return [...window.__ft.frames.entries()].map(([ts, f]) => [ts, f.ms]);')).filter(([ts]) => ts >= up[0] - 20);
  const seen = await ev('return window.__ft.seen;'), worstFrame = Math.max(0, ...frames.map((f) => f[1]));
  const len = +(await ev(`return ${FIELD('/metres added/')}.value;`));   // the piece as let go (a length drag changes it)
  return { handler: up[1], worstFrame, worst: Math.max(up[1], worstFrame), seen, stations: await stationsNow(), exact: Math.floor(len / 2) + 1, asked: await ev('return window.__ft.asked;') };
}
const liveOf = (r) => r.asked.some((x) => x[1] === 't180-ghost' && x[2] && !x[2][0]);   // the release asked for the exact ghost: the drag was live when it was let go
async function within(fn, bar) { const runs = []; for (let i = 0; i < RUNS; i++) { const r = await fn(); runs.push(r); if (r.worst <= bar && liveOf(r)) return { ok: true, runs }; } return { ok: false, runs }; }
const told = (runs) => runs.map((r) => `handler ${r.handler.toFixed(1)}, worst frame ${r.worstFrame.toFixed(1)}${liveOf(r) ? '' : ' (the drag was not live when let go)'}`).join(' / ');

test('row 1: letting go of a 1,000 m turn and length handle, every look: nothing it causes takes more than 6.0 ms', { skip }, async (t) => {
  const got = {};
  for (const look of LOOKS) for (const kind of ['turn', 'stretch']) {
    const v = await within(() => release(look, 1000, kind, 1200), BUDGET); got[`${look} ${kind}`] = v.runs.map((r) => +r.worst.toFixed(1));
    assert.ok(v.ok, `${look}, letting go of a 1,000 m ${kind}: ${told(v.runs)} ms, over ${BUDGET}`);
    const last = v.runs[v.runs.length - 1];
    assert.ok(liveOf(last), `${look} ${kind}: the release asked for the exact ghost (the drag was live when let go): asked ${JSON.stringify(last.asked)}`);
    assert.ok(last.stations >= last.exact - 1, `${look} ${kind}: the exact ghost is in place (${last.stations} stations; a station every 2 m is ${last.exact}; seen ${JSON.stringify(last.seen.filter((x, i) => i % 25 === 0).map((x) => x[1]).slice(0, 12))}; asked after the release ${JSON.stringify(last.asked)})`);
  }
  t.diagnostic(`worst ms by case: ${JSON.stringify(got)}`); assert.deepEqual(errors, []);
});

test('row 2: past the ordinary range it does not stall: letting go of a 20,000 m turn, nothing takes more than 120 ms, and the exact ghost is whole within 10 s', { skip }, async (t) => {
  const v = await within(() => release('aqua', 20000, 'turn', 10000), 120), r = v.runs[v.runs.length - 1];
  t.diagnostic(`20,000 m: ${told(v.runs)} ms; ${r.stations} stations after 10 s`);
  assert.ok(v.ok, `letting go of a 20,000 m turn: ${told(v.runs)} ms, over 120 (before D407: 1,058 ms in the handler)`);
  assert.ok(r.stations >= 10000, `the exact ghost is whole: ${r.stations} stations (a station every 2 m is 10,001)`);
});

test('row 3: the exact ghost arrives and nothing blinks: after letting go of a 2,000 m turn the ghost is on show at every frame, and the exact one is in place within 1 s', { skip }, async (t) => {
  const r = await release('aqua', 2000, 'turn', 1000), first = r.seen[0] ? r.seen[0][0] : 0;
  assert.ok(liveOf(r), `the release asked for the exact ghost (the drag was live when let go): asked ${JSON.stringify(r.asked)}`);
  assert.ok(r.seen.length && r.seen[0][1] > 0 && r.seen[0][1] < 600, `the drag's own ghost is on show when it is let go (${r.seen.length ? r.seen[0][1] : '-'} stations; the cheap one has about 100)`);
  const blank = r.seen.filter(([, n]) => !(n > 0)).length, exactAt = r.seen.find(([, n]) => n >= 1000);
  t.diagnostic(`${r.seen.length} frames watched; the exact ghost (${exactAt ? exactAt[1] : '-'} stations) after ${exactAt ? (exactAt[0] - first).toFixed(0) : '-'} ms; ${blank} without a ghost`);
  assert.equal(blank, 0, 'a frame with no ghost on show');
  assert.ok(exactAt, `the exact ghost (a station every 2 m, 1,001) was not in place within 1 s: ${r.stations} stations at the end`);
});

test('row 4: a number typed into the Turn field on a 12-piece track: each change costs at most 6.0 ms at the 95th percentile, handler and frames together', { skip }, async (t) => {
  const runs = [];
  for (let k = 0; k < RUNS; k++) {
    await load('aqua'); await setField('/metres added/', 100);
    for (let i = 0; i < 12; i++) { await setField('/turn/i', i % 2 ? 12 : -12); const p = await ev("const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Extend' && x.offsetParent); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];"); await mouse('mouseMoved', p[0], p[1]); await mouse('mousePressed', p[0], p[1], { button: 'left', buttons: 1, clickCount: 1 }); await mouse('mouseReleased', p[0], p[1], { button: 'left', buttons: 0, clickCount: 1 }); await sleep(120); }
    await mouse('mouseMoved', 700, 300); await sleep(800);
    assert.match(await ev("return document.body.innerText.match(/\\d+ pieces?/)[0];"), /^12 pieces/, 'the track has its 12 pieces');
    await ev('window.__ft.frames.clear(); window.__ft.ev.length = 0; window.__ft.on = true; return true;');
    const VALS = ['5', '23', '-8', '14', '-19', '2', '31', '-3'];
    for (let i = 0; i < 32; i++) { await ev(`const f = ${FIELD('/turn/i')}; f.focus(); f.select(); return true;`); await send('Input.insertText', { text: VALS[i % VALS.length] }); await sleep(60); }
    await sleep(200); await ev('window.__ft.on = false; return true;');
    const evs = (await ev("return window.__ft.ev.filter((e) => e[0] === 'input');")).sort((a, b) => a[1] - b[1]), fr = await ev('return [...window.__ft.frames.entries()].map(([ts, f]) => [ts, f.ms]);');
    assert.ok(evs.length >= 32, `${evs.length} field changes reached the page`);
    const cost = evs.map(([, a, d], i) => { const end = Math.min(a + 120, i + 1 < evs.length ? evs[i + 1][1] : Infinity); return d + fr.filter(([ts, ms]) => ts >= a && ts < end && ms > 0.5).reduce((s, [, ms]) => s + ms, 0); });
    runs.push({ p95: pct(cost, 0.95), median: pct(cost, 0.5) });
    if (runs[k].p95 <= BUDGET) break;
  }
  t.diagnostic(`a field change: p95 ${runs.map((r) => r.p95.toFixed(1)).join(' / ')} ms (median ${runs.map((r) => r.median.toFixed(1)).join(' / ')})`);
  assert.ok(runs.some((r) => r.p95 <= BUDGET), `a field change: p95 ${runs.map((r) => r.p95.toFixed(1)).join(' / ')} ms, over ${BUDGET}`);
  assert.deepEqual(errors, []);
});
