// markwindow-page.test.js: node --test app/test/markwindow-page.test.js   (headless Chrome, about a minute: under the heavy-run lock, as any browser run)
// L251 (the user, 2026-11-26 04:49, on the blur mock: "I like the blur i think..."; 02:33: "i like the styling, but not the circuluar design choice for the few that
// have it"): THE SMALL WINDOWS ON THE VIEW ARE ELEMENTS, so each look's blur is real (app/core/markwindow.js layer). On the real page (app/index.html) in HEADLESS
// Chrome (never a window, muted, titled zz-headless-test), served from this checkout: a 1,000 m piece typed, its length handle hovered, so its readout's window shows.
// Skipped, with the reason, where there is no Chrome (CHROME_PATH or the usual place). Rows:
//   1  in every look the shown window's computed backdrop-filter is the look's own --mark-win-blur (its panel's), not none; its corner is --mark-win-radius px; its fill
//      lets the blur through; it takes no pointer event. Under prefers-reduced-transparency the same window shows its fill solid and blurs nothing
//   2  a press at a shown window's centre reaches what is under it: the browser's hit test there finds the same element with the windows as without them, a real press
//      there is that element's, and a camera drag (the right button) begun there turns the camera
//   3  a 60-step drag of the length handle, its readout showing and its words changing: no window element is made or removed, and the count is the same at every step
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path');
const { chromePath, launchChrome, connect } = require('./soundrender.js');
const TH = require('../lib/theme.js');

const REPO = path.join(__dirname, '..', '..');
const CHROME = chromePath();
const skip = CHROME ? false : 'no Chrome here (set CHROME_PATH): the windows are read in headless Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.css': 'text/css', '.woff2': 'font/woff2' };
const LOOKS = ['sigil', ...TH.LOOKS];

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
  let tgt; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--window-size=1400,860'], 't180mwin-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl, (d) => { if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text); }));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 500)}`); return d.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await ev("document.title = 'zz-headless-test'; return true;");
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false });
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); if (srv) srv.close(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

const PRE = "document.title = 'zz-headless-test'; new MutationObserver(() => { if (document.title !== 'zz-headless-test') document.title = 'zz-headless-test'; }).observe(document, { subtree: true, childList: true, characterData: true });";
async function load(look) {
  await send('Emulation.setEmulatedMedia', { features: [] });
  await send('Page.navigate', { url: `${base}/app/lib/cjs.js` });
  for (let i = 0; i < 50; i++) { await sleep(100); try { if ((await ev('return location.href;')) === `${base}/app/lib/cjs.js`) break; } catch (e) { /* loading */ } }
  await ev(`localStorage.clear(); localStorage.setItem('t180.settings.theme', ${JSON.stringify(JSON.stringify(look))}); localStorage.setItem('t180.guide.done', '1'); return true;`);
  const id = (await send('Page.addScriptToEvaluateOnNewDocument', { source: PRE })).result.identifier;
  await send('Page.navigate', { url: `${base}/app/index.html` });
  for (let i = 0; i < 200; i++) { await sleep(200); try { if (await ev("await new Promise((r) => setTimeout(r, 800)); return !!document.querySelector('#palette input') && document.querySelectorAll('#stage canvas').length >= 2;")) break; } catch (e) { /* loading */ } }
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id });
  await ev("const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Skip'); if (b && b.offsetParent) b.click(); return true;");
  const on = await ev("return document.documentElement.getAttribute('data-theme') || 'sigil';");
  assert.equal(on, look, `the page is in ${look}`);
}
const setLength = (m) => ev(`const f = [...document.querySelectorAll('#palette input')].find((e) => /metres added/.test(e.getAttribute('aria-label') || e.title || '')); f.value = '${m}'; f.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 1200)); return true;`);
/** a handle of that kind, in page px, with its on-screen axis */
const handle = (kind) => ev(`let l = null; document.dispatchEvent(new CustomEvent('t180:handles-request', { detail: { reply: (x) => { l = x; } } })); const r = document.getElementById('stage').getBoundingClientRect(); const h = (l || []).find((x) => x.kind === ${JSON.stringify(kind)}); return h ? { x: h.x + r.left, y: h.y + r.top, dx: h.dx, dy: h.dy } : null;`);
/** the windows shown now: their words, centre, computed blur, corner, fill and pointer events */
const shown = () => ev("return [...document.querySelectorAll('[data-mark-window]')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => { const b = e.getBoundingClientRect(), s = getComputedStyle(e); return { layer: e.getAttribute('data-mark-window'), words: e.textContent, x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, bf: s.backdropFilter, r: s.borderTopLeftRadius, bg: s.backgroundColor, pe: s.pointerEvents }; });");
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: extra.button || 'none', buttons: extra.buttons || 0, clickCount: extra.clickCount || 0 });
const alphaOf = (c) => { const m = /rgba?\(([^)]*)\)/.exec(c); if (!m) return NaN; const p = m[1].split(/[\s,/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };
/** the page loaded in the look, a 1,000 m piece typed, the length handle hovered: its readout's window */
async function hovered(look) {
  await load(look); await setLength(1000);
  const h = await handle('length'); assert.ok(h, `${look}: the length handle is on the page`);
  await mouse('mouseMoved', h.x, h.y); await sleep(400);
  const w = await shown(); assert.equal(w.length, 1, `${look}: hovering the length handle shows one window, its readout (${JSON.stringify(w)})`);
  assert.match(w[0].words, /^length 1000\.00 m/, `${look}: the readout's words`);
  return { h, w: w[0] };
}

test('row 1: in every look the shown window blurs what is behind it with the look\'s own blur, is cornered at --mark-win-radius, lets the blur through its fill and takes no pointer event; under prefers-reduced-transparency its fill is solid and nothing is blurred', { skip }, async (t) => {
  const got = {};
  for (const look of LOOKS) {
    const { w } = await hovered(look);
    const want = await ev("const e = document.createElement('div'); e.style.backdropFilter = getComputedStyle(document.documentElement).getPropertyValue('--mark-win-blur').trim(); document.body.append(e); const v = getComputedStyle(e).backdropFilter; e.remove(); return v;");
    const radius = await ev("return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mark-win-radius'));");
    assert.notEqual(want, 'none', `${look} sets a blur`); assert.equal(w.bf, want, `${look}: the window's backdrop-filter is the look's own`);
    assert.equal(w.r, `${radius}px`, `${look}: its corner is --mark-win-radius`);
    assert.ok(alphaOf(w.bg) < 1, `${look}: its fill (${w.bg}) lets the blur through`); assert.equal(w.pe, 'none', `${look}: it takes no pointer event`);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] }); await sleep(300);
    assert.equal(await ev("return matchMedia('(prefers-reduced-transparency: reduce)').matches;"), true, 'the page reads the setting');
    const r = await shown(); assert.equal(r.length, 1, `${look}, less transparency: the window is still shown`);
    assert.equal(r[0].bf, 'none', `${look}, less transparency: nothing blurred`); assert.equal(alphaOf(r[0].bg), 1, `${look}, less transparency: its fill (${r[0].bg}) is solid`);
    await send('Emulation.setEmulatedMedia', { features: [] });
    got[look] = `${w.bf} · ${w.r} · ${w.bg}`;
  }
  t.diagnostic(`the windows: ${JSON.stringify(got)}`); assert.deepEqual(errors, []);
});

test('row 2: a press at a shown window\'s centre reaches what is under it, and a camera drag begun there turns the camera', { skip }, async () => {
  const { w } = await hovered('aqua');
  const hit = await ev(`const p = [${w.x}, ${w.y}], layers = [...document.querySelectorAll('[data-mark-windows]')], name = (e) => (e ? e.tagName + (e.id ? '#' + e.id : '') + (e.getAttribute('aria-label') ? '[' + e.getAttribute('aria-label') + ']' : '') : null);
    const a = document.elementFromPoint(...p); layers.forEach((x) => { x.style.visibility = 'hidden'; }); const b = document.elementFromPoint(...p); layers.forEach((x) => { x.style.visibility = ''; });
    window.__l251 = { b, downs: [] }; document.addEventListener('pointerdown', (e) => window.__l251.downs.push(e.target), true);
    return { a: name(a), b: name(b), same: a === b, inWindows: !!(a && a.closest('[data-mark-windows]')) };`);
  assert.equal(hit.inWindows, false, `the hit test at the window's centre finds no window (${hit.a})`); assert.ok(hit.same, `the same element with the windows as without them (${hit.a} / ${hit.b})`);
  const pose = () => ev("let v = null; document.dispatchEvent(new CustomEvent('t180:view', { detail: { reply: (x) => { v = x; } } })); return v && v.pose ? JSON.stringify(v.pose) : null;");
  const before = await pose(); assert.ok(before, 'the camera\'s pose is read');
  await mouse('mousePressed', w.x, w.y, { button: 'right', buttons: 2, clickCount: 1 });
  const down = await ev("const d = window.__l251.downs[0]; return { is: d === window.__l251.b, inWindows: !!(d && d.closest && d.closest('[data-mark-windows]')) };");
  for (let i = 1; i <= 12; i++) { await mouse('mouseMoved', w.x + 5 * i, w.y + 2 * i, { button: 'right', buttons: 2 }); await sleep(25); }
  await mouse('mouseReleased', w.x + 60, w.y + 24, { button: 'right', buttons: 0, clickCount: 1 }); await sleep(400);
  assert.ok(down.is && !down.inWindows, `the press there is the element's under the window (${JSON.stringify(down)})`);
  assert.notEqual(await pose(), before, 'the camera turned: the drag begun on the window reached it');
  assert.deepEqual(errors, []);
});

test('row 3: a 60-step drag of the length handle, its readout\'s words changing: no window element is made or removed, and their count is the same at every step', { skip }, async () => {
  const { h } = await hovered('aurora');
  await ev("window.__l251m = { added: 0, removed: 0 }; const mo = new MutationObserver((ms) => { for (const m of ms) { window.__l251m.added += [...m.addedNodes].filter((n) => n.nodeType === 1).length; window.__l251m.removed += [...m.removedNodes].filter((n) => n.nodeType === 1).length; } }); for (const l of document.querySelectorAll('[data-mark-windows]')) mo.observe(l, { childList: true, subtree: true }); window.__l251mo = mo; return true;");
  const count = () => ev("return document.querySelectorAll('[data-mark-window]').length;"), n0 = await count();
  const len = Math.hypot(h.dx, h.dy) || 1, ax = [h.dx / len, h.dy / len], counts = [], words = new Set();
  await mouse('mousePressed', h.x, h.y, { button: 'left', buttons: 1, clickCount: 1 }); await sleep(60);
  for (let i = 1; i <= 60; i++) {
    await mouse('mouseMoved', h.x + ax[0] * 2 * i, h.y + ax[1] * 2 * i, { buttons: 1 }); await sleep(20);
    counts.push(await count()); const s = await shown(); if (s[0]) words.add(s[0].words);
  }
  await mouse('mouseReleased', h.x + ax[0] * 120, h.y + ax[1] * 120, { button: 'left', buttons: 0, clickCount: 1 }); await sleep(300);
  const m = await ev('window.__l251mo.takeRecords(); return window.__l251m;');
  assert.ok(words.size >= 10, `the readout's words changed through the drag (${words.size} different)`);
  assert.deepEqual([...new Set(counts)], [n0], `the window elements: ${n0} before, at every step ${JSON.stringify([...new Set(counts)])}`);
  assert.deepEqual(m, { added: 0, removed: 0 }, 'no window element made or removed during the drag');
  assert.deepEqual(errors, []);
});
