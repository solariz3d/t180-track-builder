// menubar-page.test.js: node --test app/test/menubar-page.test.js
// D355 part 1: THE MENUS ON THE TOP BAR, tested on the real page (app/index.html) in HEADLESS Chrome (never a window), served from this checkout. The page runs
// as it does off Tauri (no native side), which is enough for the menus. Skipped, with the reason, where there is no Chrome (CHROME_PATH or the usual place). Rows:
//   1  the bar, left to right: File, Edit, Build, Track, Pieces, View, Settings, then Export to Assetto Corsa; the ⋯ menu is gone; every control it held, and
//      every other control the bar had, is still on the page by its id
//   2  a menu opens and closes: one at a time, Esc closes it, a press outside closes it, a command closes it
//   3  the moved controls work from their new place: Settings' mute is the sound's own (saved as before), Edit ▸ Undo undoes, File holds New, Open, Save,
//      Previous versions, Export…, the test export, See it in Assetto and the track codes; the Assetto Corsa folder and the launch tick are in Settings
//   4  a setting survives a reload: a choice in Settings and a tick in View, saved as t180.settings.<key>, shown ticked after the page loads again
//   5  a blocked store throws nothing: with localStorage refused, the page starts, the menus open, and a setting holds for the session
//   6  Reset the guide forgets that the guide was finished, so it opens by itself at the next start
//   7  Build and Track open and say something (their parts' entries, or a placeholder until those land), never an error
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const { chromePath } = require('./soundrender.js');

const REPO = path.join(__dirname, '..', '..');
const CHROME = chromePath();
const skip = CHROME ? false : 'no Chrome here (set CHROME_PATH): the menus are tested in headless Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav' };

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
  const port = 9300 + Math.floor(Math.random() * 600); dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180menu-'));
  ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--window-size=1400,860', 'about:blank'], { stdio: 'ignore' });
  let tgt; for (let i = 0; i < 100 && !tgt; i++) { await sleep(200); try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch (e) { /* not up yet */ } }
  if (!tgt) throw new Error(`headless Chrome did not answer on port ${port}`);
  ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('the DevTools socket failed')); });
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text); };
  send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 500)}`); return d.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false });
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); if (srv) srv.close(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

/** a fresh page: optionally with localStorage cleared first (same origin) or refused outright, then wait until the menus are mounted */
async function load({ clear = true, blocked = false } = {}) {
  errors = [];
  let script = null;
  if (blocked) script = (await send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });" })).result.identifier;
  if (clear && !blocked) { await send('Page.navigate', { url: base.replace('index.html', 'lib/cjs.js') }); await sleep(300); await ev('localStorage.clear(); return true;'); }
  await send('Page.navigate', { url: base });
  for (let i = 0; i < 150; i++) { await sleep(200); try { if (await ev("return document.documentElement.dataset.menubar === 'ready';")) break; } catch (e) { /* loading */ } }
  if (script) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script });
  assert.equal(await ev("return document.documentElement.dataset.menubar || 'not mounted';"), 'ready', `the menus mounted (page errors: ${errors.join(' | ') || 'none'})`);
}
const open = (id) => ev(`const d = document.getElementById('${id}'); d.querySelector('summary').click(); await new Promise((r) => setTimeout(r, 80)); return d.open;`);
const openIds = () => ev("return [...document.querySelectorAll('header details')].filter((d) => d.open).map((d) => d.id);");
/** the visible text of a menu's controls, in order (buttons, ticks, headings, selects by their first option) */
const shown = (id) => ev(`return [...document.getElementById('${id}').querySelector('.more-menu').querySelectorAll('button, label, h3, select')].filter((e) => e.offsetParent !== null).map((e) => e.tagName === 'SELECT' ? e.options[0].text : e.textContent.trim());`);
const clickText = (id, text) => ev(`const e = [...document.getElementById('${id}').querySelectorAll('button, label')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!e) throw new Error('no ' + ${JSON.stringify(text)}); (e.tagName === 'LABEL' ? e.querySelector('input') : e).click(); await new Promise((r) => setTimeout(r, 80)); return true;`);
const ticked = (id, text) => ev(`const e = [...document.getElementById('${id}').querySelectorAll('label')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); return e ? e.querySelector('input').checked : null;`);

test('row 1: the bar reads File, Edit, Build, Track, Pieces, View, Settings, then Export to Assetto Corsa; the ⋯ menu is gone and every control keeps its id', { skip }, async () => {
  await load();
  const bar = await ev("return [...document.querySelector('header').children].map((e) => e.tagName === 'DETAILS' ? e.querySelector('summary').textContent.replace(/[▾\\s]+$/, '').trim() : e.id).filter(Boolean);");
  const menus = bar.filter((x) => !/^(name|status|install|winctl|new|save|open|versions)$/.test(x));
  assert.deepEqual(menus, ['File', 'Edit', 'Build', 'Track', 'Pieces', 'View', 'Settings']);
  assert.ok(bar.indexOf('install') > bar.indexOf('Settings'), `Export to Assetto Corsa comes after Settings: ${bar.join(', ')}`);
  assert.equal(await ev("return document.getElementById('more');"), null, 'no ⋯ menu');
  for (const id of ['new', 'name', 'save', 'open', 'versions', 'pieces', 'pieces-bin', 'install', 'export', 'testexport', 'more-install', 'sound-row', 'sound-mute', 'sound-volume', 'share', 'status']) assert.ok(await ev(`return !!document.getElementById('${id}');`), `#${id} is on the page`);
  assert.deepEqual(errors, []);
});

test('row 2: one menu open at a time; Esc, a press outside it and a command each close it', { skip }, async () => {
  await load();
  assert.equal(await open('m-file'), true); assert.deepEqual(await openIds(), ['m-file']);
  assert.equal(await open('m-settings'), true); assert.deepEqual(await openIds(), ['m-settings'], 'opening Settings closed File');
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true;"); assert.deepEqual(await openIds(), [], 'Esc');
  await open('m-view'); await ev("document.getElementById('stage').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true;"); assert.deepEqual(await openIds(), [], 'a press outside');
  await open('m-edit'); await clickText('m-edit', 'Redo'); assert.deepEqual(await openIds(), [], 'a command');
  await open('pieces'); assert.deepEqual(await openIds(), ['pieces']); await open('m-file'); assert.deepEqual(await openIds(), ['m-file'], 'Pieces ▾ takes part too');
});

test('row 3: the moved controls work from their new place', { skip }, async () => {
  await load();
  await open('m-file');
  const file = await shown('m-file');
  for (const t of ['New', 'Open…', 'Save', 'Export…', 'Test export (unfinished)…', 'See it in Assetto', 'Copy track code', 'Paste track code…']) assert.ok(file.some((x) => x.startsWith(t)), `File holds ${t}: ${file.join(' | ')}`);
  assert.ok(await ev("return document.getElementById('versions').closest('details').id;") === 'm-file', 'Previous versions is in File');
  assert.ok(!file.some((x) => x.startsWith('Assetto Corsa folder')), 'the Assetto Corsa folder is in Settings from the start, not in File until Settings is opened');
  await open('m-settings');
  const set = await shown('m-settings');
  assert.ok(set.some((x) => x.startsWith('Assetto Corsa folder')), `Settings holds the Assetto Corsa folder: ${set.join(' | ')}`);
  assert.ok(set.some((x) => /See it in Assetto \(launches the game\)/.test(x)), 'Settings holds the launch tick');
  assert.equal(await ev("return document.getElementById('sound-mute').closest('details').id;"), 'm-settings');
  await ev("const m = document.getElementById('sound-mute'); m.click(); return true;");
  assert.equal(await ev("return localStorage.getItem('t180.sound.muted');"), '1', 'mute is the sound\'s own, saved as before');
  // Edit ▸ Undo: a piece placed with Extend, then undone from the menu
  const count = () => ev("return document.querySelector('#palette .head').textContent;");
  await ev("[...document.querySelectorAll('#palette button')].find((b) => b.textContent === 'Extend').click(); return true;");
  assert.match(await count(), /^1 piece/);
  await open('m-edit'); await clickText('m-edit', 'Undo');
  assert.match(await count(), /^0 pieces/, 'undone from the menu');
});

test('row 4: a choice in Settings and a tick in View survive a reload, saved as t180.settings.<key>', { skip }, async () => {
  await load();
  await open('m-settings'); assert.equal(await ticked('m-settings', '90°'), true, 'the default grid step');
  await clickText('m-settings', '45°');
  assert.equal(await ticked('m-settings', '45°'), true); assert.equal(await ticked('m-settings', '90°'), false, 'a choice of one');
  await clickText('m-settings', 'rate °/100 m');
  await open('m-view'); assert.equal(await ticked('m-view', 'Colour by grip'), false); await clickText('m-view', 'Colour by grip');
  assert.equal(await ev("return localStorage.getItem('t180.settings.gridStep');"), '45');
  await load({ clear: false });
  await open('m-settings'); assert.equal(await ticked('m-settings', '45°'), true, 'after a reload'); assert.equal(await ticked('m-settings', 'rate °/100 m'), true);
  await open('m-view'); assert.equal(await ticked('m-view', 'Colour by grip'), true);
});

test('row 5: with localStorage refused, the page starts, the menus open, and a setting holds for the session', { skip }, async () => {
  await load({ blocked: true });
  assert.equal(await ev('try { localStorage; return false; } catch (e) { return true; }'), true, 'the store is refused');
  await open('m-settings'); await clickText('m-settings', '15°');
  assert.equal(await ticked('m-settings', '15°'), true, 'for the session');
  await open('m-view'); await clickText('m-view', 'Drag handles'); assert.equal(await ticked('m-view', 'Drag handles'), false);
  assert.deepEqual(errors, [], 'nothing thrown');
});

test('row 6: Reset the guide forgets that the guide was finished', { skip }, async () => {
  await load();
  await ev("localStorage.setItem('t180b.onboarding', JSON.stringify({ how: 'finished', at: '2026-10-17T00:00:00Z' })); return true;");
  await open('m-settings'); await clickText('m-settings', 'Reset the guide');
  assert.equal(await ev("return localStorage.getItem('t180b.onboarding');"), null);
  assert.match(await ev("return document.getElementById('status').textContent;"), /guide/i, 'the status line says so');
});

test('row 7: Build and Track open and say something, never an error', { skip }, async () => {
  await load();
  for (const id of ['m-build', 'm-track']) {
    await open(id);
    const t = await ev(`return document.getElementById('${id}').querySelector('.more-menu').textContent.trim();`);
    assert.ok(t.length > 0, `${id} is not empty`); assert.ok(!/could not be built/.test(t), `${id}: ${t}`);
  }
});
