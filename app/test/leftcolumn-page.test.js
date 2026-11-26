// leftcolumn-page.test.js: node --test app/test/leftcolumn-page.test.js
// THE LEFT COLUMN AT THE WINDOW'S EDGE, AND CLEARING AWAY (L254; the user's ask, 2026-11-26: the column at the window's edge, out of the way when the pointer
// leaves it, to give the preview more room; read as see-through, from that purpose, and he has been told). Tested on the real page (app/index.html) in HEADLESS Chrome (never a window; --mute-audio through
// the shared launcher; the page titled zz-headless-test), served from this checkout. Skipped, with the reason, where there is no Chrome. The pointer is moved by
// real mouse events (CDP), as a person moves it. Rows:
//   1  in every look the column (#left) is flush: its box starts at x 0, its top meets the header's bottom, its bottom meets the window's bottom, its four corners are 0
//   2  nothing placed against it overlaps it or keeps the old 12 px inset: the view tag (.preview-hud) is 14 px right of the column's right edge (its gap before,
//      274 - 260), the values band and the camera bar are clear of it, and where the tag is level with the column card (a 2560 px window) it stays 12 px under the
//      view's top, never on the bar
//   3  in every look, the pointer off it: still shown a moment later (the delay), cleared after it (computed opacity 0, the --left-cleared value); the pointer
//      back through the return strip at the window's left edge: opacity 1; out and back in within the delay (a fast cross): never cleared
//   4  cleared, a click over the old column (on the Extend button's place, outside the strip) reaches the preview's canvas: no element in the column gets
//      the press or the click, and no piece is laid; 30 px from the edge is the preview's, 5 px from it brings the column back
//   5  a press as it comes back (within its fade) presses nothing; after the fade the same click on Extend lays a piece
//   6  held: a field clicked into (a value being edited) keeps it shown with the pointer off it; a click on the preview (which takes the focus off the field)
//      lets it clear. A press that began in it keeps it shown while dragged out over the preview, until let go
//   7  held: a saved piece's ghost with its Place piece / Cancel piece row up keeps it shown with the pointer off it; Cancel piece lets it clear
//   8  Tab from the header into the cleared column brings it back, and the field Tab reached is the focused one (nothing is taken out of the Tab order or the
//      accessibility tree: the cleared column is still there to Tab and to a screen reader)
//   9  prefers-reduced-motion: no fade (its transition is 0 s), only the switch; without it the fade is 0.2 s
//  10  a fresh page keeps the column shown until the pointer has been on it: the pointer moving about the preview alone never clears it
//  11  held: while the guide points into the column (its first step outlines the panel) it stays shown with the pointer off it; closing the guide lets it clear
// Not tested here, by name: a select's open list holding it (select:open; a native list is not drawn in headless Chrome). Its rule is in app/leftcolumn.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path');
const { chromePath, launchChrome } = require('./soundrender.js');

const REPO = path.join(__dirname, '..', '..');
const CHROME = chromePath();
const skip = CHROME ? false : 'no Chrome here (set CHROME_PATH): the left column is tested in headless Chrome';
const LOOKS = ['sigil', 'aqua', 'skyline', 'glass', 'aurora', 'skyline-night'];
const W = 1400, H = 860;
const OUT = [800, 420];      // a point on the preview, well right of the column
const IN = [120, 300];       // a point on the column
const DELAY_MS = 400, FADE_MS = 200, SETTLE_MS = DELAY_MS + FADE_MS + 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.css': 'text/css' };

let srv, ch, ws, dir, base, send, ev, errors = [];
test.before(async () => {
  if (skip) return;
  srv = http.createServer((q, s) => {
    const p = path.normalize(path.join(REPO, decodeURIComponent(q.url.split('?')[0])));
    if (!p.startsWith(REPO)) { s.writeHead(403); s.end(); return; }
    fs.readFile(p, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}/app/index.html`;
  let tgt; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--hide-scrollbars', `--window-size=${W},${H}`], 't180lc-'));
  ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('the DevTools socket failed')); });
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text); };
  send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 500)}`); return d.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await ev("document.title = 'zz-headless-test'; return true;");
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); if (srv) srv.close(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

/** a fresh page in `look` at w x h, nothing else saved, the guide closed (left open with `guide`) */
async function load(look = 'sigil', w = W, h = H, { guide = false } = {}) {
  errors = [];
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base.replace('index.html', 'lib/cjs.js') }); await sleep(300);
  await ev(`document.title = 'zz-headless-test'; localStorage.clear(); localStorage.setItem('t180.settings.theme', ${JSON.stringify(JSON.stringify(look))}); return true;`);
  await send('Page.navigate', { url: base });
  for (let i = 0; i < 150; i++) { await sleep(200); try { if (await ev("return document.documentElement.dataset.menubar === 'ready';")) break; } catch (e) { /* loading */ } }
  await ev("document.title = 'zz-headless-test'; return true;");   // a headless page is always titled so; the page's own <title> replaced any set before
  assert.equal(await ev("return document.documentElement.dataset.menubar || 'not mounted';"), 'ready', `${look}: the menus mounted (page errors: ${errors.join(' | ') || 'none'})`);
  if (!guide) { await ev("const b = [...document.querySelectorAll('#guide button')].find((x) => x.textContent.trim() === '✕'); if (b) b.click(); return true;"); await sleep(300); }
}
const move = (x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: buttons ? 'left' : 'none', buttons });
const press = (x, y) => send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
const release = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
const click = async (x, y) => { await move(x, y); await press(x, y); await release(x, y); };
const opacity = () => ev("return getComputedStyle(document.getElementById('left')).opacity;");
const pieces = () => ev("const m = document.body.innerText.match(/(\\d+) pieces?/); return m ? Number(m[1]) : 0;");
const extendAt = () => ev("const b = [...document.querySelectorAll('#palette button')].find((x) => x.textContent.trim() === 'Extend' && x.offsetParent); const r = b.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];");
/** the pointer onto the column, then off it onto the preview, and the column's opacity once it has had time to clear */
async function outAndSettle() { await move(...IN); await sleep(100); await move(...OUT); await sleep(SETTLE_MS); return opacity(); }

test('row 1: in every look the column is flush: x 0, from the header\'s bottom to the window\'s bottom, corners 0', { skip }, async () => {
  const bad = [];
  for (const look of LOOKS) {
    await load(look);
    const g = await ev(`const L = document.getElementById('left'), r = L.getBoundingClientRect(), s = getComputedStyle(L), hb = document.querySelector('header').getBoundingClientRect().bottom;
      return { left: r.left, top: r.top, bottom: r.bottom, header: hb, win: innerHeight, radii: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius] };`);
    if (g.left !== 0) bad.push(`${look}: left ${g.left}`);
    if (Math.abs(g.top - g.header) > 0.5) bad.push(`${look}: top ${g.top}, the header's bottom ${g.header}`);
    if (Math.abs(g.bottom - g.win) > 0.5) bad.push(`${look}: bottom ${g.bottom}, the window's ${g.win}`);
    if (g.radii.some((x) => x !== '0px')) bad.push(`${look}: corners ${g.radii.join(' ')}`);
    assert.deepEqual(errors, [], `${look}: no page errors`);
  }
  assert.deepEqual(bad, [], 'the column is not flush in every look');
});

test('row 2: the view tag keeps its 14 px from the column, the values band and the camera bar are clear of it, and the tag never sits on the bar', { skip }, async () => {
  const bad = [];
  for (const look of ['sigil', 'aqua']) {
    await load(look);
    const g = await ev(`const R = (s) => document.querySelector(s).getBoundingClientRect(), L = R('#left'), hud = R('.preview-hud'), v = R('[aria-label="piece values"]'), cam = R('#camera [role="toolbar"]');
      return { right: L.right, hud: hud.left, values: v.left, cam: cam.left };`);
    if (Math.round(g.hud - g.right) !== 14) bad.push(`${look}: the view tag is ${g.hud - g.right} px from the column, not 14`);
    if (!(g.values > g.right)) bad.push(`${look}: the values band (from ${g.values}) reaches under the column (to ${g.right})`);
    if (!(g.cam > g.right)) bad.push(`${look}: the camera bar (from ${g.cam}) reaches under the column (to ${g.right})`);
  }
  // where the band is far enough right for the tag to clear it, the tag stands level with the column card's old top: 12 px under the view's top, not on the bar
  await load('sigil', 2560, 1440);
  const t = await ev("const p = document.getElementById('preview').getBoundingClientRect(), h = document.querySelector('.preview-hud').getBoundingClientRect(); return { top: h.top - p.top, set: getComputedStyle(document.getElementById('stage')).getPropertyValue('--hud-top').trim() };");
  if (Math.round(t.top) !== 12) bad.push(`at 2560 x 1440 the view tag is ${t.top} px under the view's top (--hud-top ${t.set || 'unset'}), not 12`);
  assert.deepEqual(bad, [], 'what is placed against the column');
});

test('row 3: in every look the pointer off the column clears it after the delay (opacity 0, --left-cleared); the return strip brings it back; a fast cross never clears it', { skip }, async () => {
  const bad = [];
  for (const look of LOOKS) {
    await load(look);
    await move(...IN); await sleep(100); await move(...OUT); await sleep(150);
    const early = await opacity();
    if (early !== '1') bad.push(`${look}: ${early} 150 ms after the pointer left (the delay is ${DELAY_MS} ms)`);
    await sleep(SETTLE_MS - 150);
    const off = await opacity(), token = await ev("return getComputedStyle(document.documentElement).getPropertyValue('--left-cleared').trim();");
    if (off !== '0' || token !== '0') bad.push(`${look}: the pointer off it, opacity ${off} (--left-cleared ${token || 'unset'})`);
    await move(5, 420); await sleep(FADE_MS + 200);
    const back = await opacity();
    if (back !== '1') bad.push(`${look}: the pointer at the window's left edge, opacity ${back}`);
    // a fast cross: off it and back on it within the delay
    await move(...IN); await sleep(100); await move(...OUT); await sleep(120); await move(...IN); await sleep(SETTLE_MS);
    const cross = await opacity();
    if (cross !== '1') bad.push(`${look}: off and back within ${DELAY_MS} ms, opacity ${cross}`);
    assert.deepEqual(errors, [], `${look}: no page errors`);
  }
  assert.deepEqual(bad, [], 'the column does not clear and come back as asked');
});

test('row 4: cleared, a click over the old column outside the strip reaches the preview\'s canvas and presses nothing in the column; the strip is 5 px in, not 30', { skip }, async () => {
  await load('sigil');
  const at = await extendAt(), x = Math.max(at[0], 30);
  assert.ok(x < 248, `the Extend button sits in the column (${at})`);
  const before = await pieces();
  assert.equal(await outAndSettle(), '0', 'the column cleared');
  await ev(`window.__lc = { col: [], canvas: 0 }; const L = document.getElementById('left'), c = document.querySelector('#preview canvas');
    for (const t of ['pointerdown', 'mousedown', 'click']) { L.addEventListener(t, (e) => window.__lc.col.push(t + ':' + e.target.tagName), true); }
    c.addEventListener('mousedown', () => { window.__lc.canvas++; }); return true;`);
  const hit = await ev(`const e = document.elementFromPoint(${x}, ${at[1]}); return e ? e.tagName + (e.closest('#left') ? ' in #left' : '') : null;`);
  assert.equal(hit, 'CANVAS', `the point over Extend (${x}, ${at[1]}) is the preview's canvas while cleared (${hit})`);
  await click(x, at[1]); await sleep(300);
  const got = await ev('return window.__lc;');
  assert.deepEqual(got.col, [], 'nothing in the column got the press or the click');
  assert.equal(got.canvas, 1, 'the canvas got the press');
  assert.equal(await pieces(), before, 'no piece was laid');
  assert.equal(await opacity(), '0', 'and the column stayed cleared');
  // 30 px from the edge is still the preview's; 5 px from it is the return strip
  assert.equal(await ev(`const e = document.elementFromPoint(30, ${at[1]}); return e && e.tagName;`), 'CANVAS', '30 px from the edge is the preview');
  await move(5, at[1]); await sleep(FADE_MS + 200);
  assert.equal(await opacity(), '1', 'the strip at the edge brought it back');
});

test('row 5: a press as the column comes back presses nothing; after its fade the same click on Extend lays a piece', { skip }, async () => {
  await load('sigil');
  const at = await extendAt(), before = await pieces();
  assert.equal(await outAndSettle(), '0', 'the column cleared');
  await move(5, at[1]); await move(at[0], at[1]); await press(at[0], at[1]); await release(at[0], at[1]); await sleep(400);
  assert.equal(await pieces(), before, 'a press inside the fade laid no piece');
  await click(at[0], at[1]); await sleep(900);
  assert.equal(await pieces(), before + 1, 'after the fade Extend lays one piece');
});

test('row 6: a field being edited, and a press that began in the column, keep it shown with the pointer off it', { skip }, async () => {
  await load('sigil');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });   // a headless page has no window focus, so nothing matches :focus-visible without it
  try {
    const f = await ev("const f = [...document.querySelectorAll('#palette input')].find((e) => e.type !== 'checkbox' && /metres added/.test(e.getAttribute('aria-label') || e.title || '')); f.scrollIntoView({ block: 'center' }); const r = f.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];");
    await click(f[0], f[1]); await sleep(100);
    assert.ok(await ev("const a = document.activeElement; return !!a && a.tagName === 'INPUT' && !!a.closest('#left') && a.matches(':focus-visible');"), 'the field has the focus');
    await move(...OUT); await sleep(SETTLE_MS);
    assert.equal(await opacity(), '1', 'a field being edited keeps the column shown with the pointer off it');
    await click(...OUT); await sleep(SETTLE_MS);
    assert.equal(await opacity(), '0', 'a click on the preview takes the focus off the field, and the column clears');
  } finally { await send('Emulation.setFocusEmulationEnabled', { enabled: false }); }
  // a press on the column's own words (no field), dragged out over the preview and held there
  await move(5, 420); await sleep(FADE_MS + 200);
  const p = await ev("const h = document.querySelector('#palette h3, #palette .head'); const r = h.getBoundingClientRect(); return [Math.round(r.left + 20), Math.round(r.top + r.height / 2)];");
  await move(p[0], p[1]); await press(p[0], p[1]); await move(400, 420, 1); await move(...OUT, 1); await sleep(SETTLE_MS);
  assert.equal(await opacity(), '1', 'a press that began in the column keeps it shown while held out over the preview');
  await release(...OUT); await sleep(SETTLE_MS);
  assert.equal(await opacity(), '0', 'let go over the preview, it clears');
});

test('row 7: a saved piece\'s ghost with its Place piece row up keeps the column shown with the pointer off it; Cancel piece lets it clear', { skip }, async () => {
  // the native side's stand-in: one saved piece, made by the core as Save piece makes it (src/core/piece.js), and nothing else
  const { createCoreShell } = require('../core/coreshell.js'), PC = require('../../src/core/piece.js');
  const s = await createCoreShell({ autosaveMs: 0 }); s.extend({ length: 100, family: 'bowl' });
  const text = PC.serialize(PC.saveRun(s.getState().history.present, 0, 0, { name: 'probe' }));
  const stand = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__TAURI__ = { core: { invoke: (cmd, a) => cmd === 'list_pieces' ? Promise.resolve(['probe'])
    : cmd === 'open_piece' ? Promise.resolve(${JSON.stringify(text)}) : /^list_/.test(cmd) ? Promise.resolve([]) : Promise.resolve(null) }, event: { listen: () => Promise.resolve(() => {}) } };` })).result.identifier;
  try {
    await load('sigil');
    await move(...IN); await sleep(100);
    await ev("document.getElementById('pieces').open = true; for (let i = 0; i < 50 && !document.querySelector('#pieces-bin .piece-row[data-piece=\"probe\"]'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('#pieces-bin .piece-row[data-piece=\"probe\"]').click(); return true;");
    await sleep(600);
    const row = () => ev("return [...document.querySelectorAll('#palette button')].filter((b) => /^(Place piece|Cancel piece)$/.test(b.textContent.trim()) && b.offsetParent).length;");
    assert.equal(await row(), 2, 'the ghost\'s Place piece and Cancel piece are up');
    await move(...OUT); await sleep(SETTLE_MS);
    assert.equal(await opacity(), '1', 'the column stays shown while the ghost\'s row is up');
    await ev("[...document.querySelectorAll('#palette button')].find((b) => b.textContent.trim() === 'Cancel piece').click(); return true;");
    await sleep(SETTLE_MS);
    assert.equal(await row(), 0, 'the row is gone');
    assert.equal(await opacity(), '0', 'with the row gone and the pointer off it, it clears');
  } finally { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stand }); }
});

test('row 8: Tab from the header into the cleared column brings it back, focused where Tab landed', { skip }, async () => {
  await load('sigil');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  try {
    assert.equal(await outAndSettle(), '0', 'the column cleared');
    await ev("document.querySelector('header #install > button').focus(); return true;");
    let n = 0;
    for (; n < 30; n++) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      if (await ev("return !!document.activeElement && !!document.activeElement.closest('#left');")) break;
    }
    assert.ok(n < 30, 'Tab reached the column from the header');
    await sleep(FADE_MS + 200);
    assert.equal(await opacity(), '1', `Tab into it (${n + 1} presses) brought it back`);
    assert.ok(await ev("return document.activeElement.matches(':focus-visible');"), 'the focus Tab landed on is shown');
    await sleep(SETTLE_MS);
    assert.equal(await opacity(), '1', 'and it stays while the keyboard focus is in it, the pointer off it');
  } finally { await send('Emulation.setFocusEmulationEnabled', { enabled: false }); }
});

test('row 9: prefers-reduced-motion has no fade, only the switch; without it the fade is 0.2 s', { skip }, async () => {
  await load('sigil');
  assert.equal(await ev("return getComputedStyle(document.getElementById('left')).transitionDuration;"), '0.2s', 'the fade');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  try {
    assert.equal(await ev("return getComputedStyle(document.getElementById('left')).transitionDuration;"), '0s', 'no fade under reduced motion');
    await move(...IN); await sleep(100); await move(...OUT); await sleep(DELAY_MS + 100);
    assert.equal(await opacity(), '0', 'cleared at once when the delay ends');
  } finally { await send('Emulation.setEmulatedMedia', { features: [] }); }
});

test('row 10: a fresh page keeps the column shown until the pointer has been on it: moving about the preview alone never clears it', { skip }, async () => {
  await load('sigil');
  await move(...OUT); await sleep(100); await move(900, 520); await sleep(100); await move(...OUT); await sleep(SETTLE_MS);
  assert.equal(await opacity(), '1', 'the pointer has not been on the column: it stays shown');
  assert.equal(await outAndSettle(), '0', 'once the pointer has been on it and left, it clears');
});

test('row 11: while the guide points into the column it stays shown with the pointer off it; closing the guide lets it clear', { skip }, async () => {
  await load('sigil', W, H, { guide: true });
  assert.ok(await ev("return !!document.querySelector('#left .guide-target');"), 'the guide\'s first step outlines a panel in the column');
  assert.equal(await outAndSettle(), '1', 'the column stays shown while the guide points into it');
  await ev("[...document.querySelectorAll('#guide button')].find((x) => x.textContent.trim() === '✕').click(); return true;");
  await sleep(SETTLE_MS);
  assert.equal(await ev("return !!document.querySelector('#left .guide-target');"), false, 'the guide closed, nothing in the column is outlined');
  assert.equal(await opacity(), '0', 'with the guide closed and the pointer off it, it clears');
});
