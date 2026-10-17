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
//   8  the bar fits at the default 1400 px: the seven menus and Export to Assetto Corsa each on one line and inside the window, with a long status line and
//      a long install note (those two give way), and at least 8 px between Export and the window's own buttons
//   9  Settings ▸ Wall raycasting and the checker's own CSP box follow each other both ways, and the choice survives a reload
//  10  (with the Track part) the road surface has one controller: no #textures section in the left column, one road-surface picker on the page, and the
//      asphalt announced before the Track menu is ever opened
//  11  (with the Build part) Build ▸ Brush shows the brush strip under the bar, not in the left column; it stays there across an edit; Brush again hides it
//  12  (with the Track part) a menu panel gives its controls back when the menu closes: Start & grid… open, the menu closed, and its controls are gone
//  13  (D356) a part that fails to load says why in its menu: "This menu could not be built: <reason>", never a silent placeholder (app/core/buildmenu.js answered with a
//      module that throws, through DevTools' Fetch domain); the other menus still work
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

let srv, ch, ws, dir, base, send, ev, errors = [], onEvent = null;
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
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method && onEvent) onEvent(d); if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text); };
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
// opens a menu afresh (closed first if it is open: a tick keeps its menu open, and a second click on the name would close it), so its entries are rebuilt
const open = (id) => ev(`const d = document.getElementById('${id}'); if (d.open) { d.open = false; await new Promise((r) => setTimeout(r, 50)); } d.querySelector('summary').click(); await new Promise((r) => setTimeout(r, 80)); return d.open;`);
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

test('row 8: the bar fits at 1400 px: the seven menus and Export to Assetto Corsa each on one line and inside the window, the status and install note giving way', { skip }, async () => {
  await load();
  await ev("document.getElementById('status').textContent = 'a long status line, as a refused open or a long message would leave it, '.repeat(4); const n = document.querySelector('#install .t-install-note'); if (n) n.textContent = 'Exports go into Assetto Corsa at C:\\Program Files (x86)\\Steam\\steamapps\\common\\assettocorsa'; await new Promise((r) => setTimeout(r, 100)); return true;");
  const m = await ev(`
    const lines = (e) => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
    const head = document.querySelector('header'), hb = head.getBoundingClientRect();
    const parts = [...document.querySelectorAll('header details > summary')].concat([...document.querySelectorAll('#install > button')]);
    const exp = document.querySelector('#install > button').getBoundingClientRect(), win = document.getElementById('winctl'), wb = win.getBoundingClientRect();
    return { width: innerWidth, winShown: wb.width > 0, gap: Math.round((wb.left - exp.right) * 10) / 10, overflow: head.scrollWidth - head.clientWidth, parts: parts.map((e) => { const b = e.getBoundingClientRect(); return { text: e.textContent.trim(), lines: lines(e), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) }; }), headBottom: Math.round(hb.bottom) };`);
  assert.equal(m.width, 1400);
  assert.equal(m.parts.length, 8, `seven menus and the Export button: ${m.parts.map((p) => p.text).join(', ')}`);
  for (const p of m.parts) { assert.equal(p.lines, 1, `"${p.text}" is on one line`); assert.ok(p.right <= 1400, `"${p.text}" ends at ${p.right}, inside the window`); assert.ok(p.top >= 0 && p.bottom <= m.headBottom, `"${p.text}" is inside the bar`); }
  assert.ok(m.overflow <= 0, `the bar does not overflow (${m.overflow} px)`);
  assert.equal(m.winShown, true, 'the window buttons are drawn on the bar (in the app; off Tauri too, since the display: flex on #winctl outweighs its hidden attribute)');
  assert.ok(m.gap >= 8, `at least 8 px between Export to Assetto Corsa and the window buttons: ${m.gap} px`);
});

test('row 9: Settings ▸ Wall raycasting and the checker\'s CSP box follow each other both ways, and the choice survives a reload', { skip }, async () => {
  await load();
  const box = "[...document.querySelectorAll('#validation label')].find((l) => /CSP/.test(l.textContent)).querySelector('input')";
  assert.equal(await ev(`return ${box}.checked;`), true, 'on when nothing is saved');
  await open('m-settings'); await clickText('m-settings', 'Wall raycasting (CSP)');
  assert.equal(await ev(`return ${box}.checked;`), false, 'unticked in Settings: the checker\'s box follows');
  assert.equal(await ev("return localStorage.getItem('t180.settings.csp');"), 'false');
  await ev(`${box}.click(); return true;`);
  await open('m-settings'); assert.equal(await ticked('m-settings', 'Wall raycasting (CSP)'), true, 'ticked on the checker: Settings follows');
  await clickText('m-settings', 'Wall raycasting (CSP)');
  await load({ clear: false });
  assert.equal(await ev(`return ${box}.checked;`), false, 'after a reload the checker starts with it off');
});

test('row 10: with the Track part, the road surface has one controller, alive before the Track menu is opened', { skip }, async (t) => {
  await load();
  if (!(await ev("return (await fetch('../app/core/trackmenu.js')).ok;"))) return t.skip('app/core/trackmenu.js (the Track part, D355 part 3) is not in this tree');
  assert.equal(await ev("return document.getElementById('textures');"), null, 'no #textures section in the left column');
  const pickers = "[...document.querySelectorAll('select')].filter((s) => [...s.options].some((o) => /Asphalt \\(made here\\)/.test(o.text))).length";
  assert.equal(await ev(`return ${pickers};`), 1, 'one road-surface picker on the page');
  await open('m-track'); await clickText('m-track', 'Road surface ▸');
  assert.equal(await ev(`return ${pickers};`), 1, 'still one with the panel open');
  assert.equal(await ev("return !!document.querySelector('#m-track .menu-panel:not([hidden]) select');"), true, 'the picker shows in the panel');
});

test('row 11: with the Build part, Build ▸ Brush shows the brush strip under the bar, keeps it there across an edit, and hides it again', { skip }, async (t) => {
  await load();
  if (!(await ev("return !!document.querySelector('.brush-strip');"))) return t.skip('the brush strip (the Build part, D355 part 2) is not in this tree');
  const where = () => ev("const s = document.querySelector('.brush-strip'), b = s.getBoundingClientRect(); return { inBanner: !!s.closest('#banner'), inLeft: !!s.closest('#left'), shown: s.offsetParent !== null && b.height > 0, top: Math.round(b.top), headBottom: Math.round(document.querySelector('header').getBoundingClientRect().bottom) };");
  let w = await where(); assert.equal(w.inBanner, true, 'the strip is in the row under the bar'); assert.equal(w.inLeft, false); assert.equal(w.shown, false, 'hidden while the brush is off');
  await open('m-build'); await clickText('m-build', 'Brush');
  w = await where(); assert.equal(w.shown, true, 'Build ▸ Brush shows it'); assert.ok(w.top >= w.headBottom, `under the bar (${w.top} >= ${w.headBottom})`);
  await ev("[...document.querySelectorAll('#palette button')].find((b) => b.textContent === 'Extend').click(); await new Promise((r) => setTimeout(r, 100)); return true;");
  w = await where(); assert.equal(w.inBanner, true, 'an edit (the banner is redrawn) keeps it there'); assert.equal(w.shown, true);
  await open('m-build'); await clickText('m-build', 'Brush');
  w = await where(); assert.equal(w.shown, false, 'Brush again hides it');
});

test('row 12: with the Track part, a menu panel gives its controls back when the menu closes', { skip }, async (t) => {
  await load();
  if (!(await ev("return (await fetch('../app/core/trackmenu.js')).ok;"))) return t.skip('app/core/trackmenu.js (the Track part, D355 part 3) is not in this tree');
  const carsBoxes = "document.querySelectorAll('input[aria-label=\"place the start by hand\"]').length";
  const before = await ev(`return ${carsBoxes};`);
  await open('m-track'); await clickText('m-track', 'Start & grid…');
  assert.equal(await ev(`return ${carsBoxes};`), before + 1, 'the panel\'s controls are in the menu');
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 100)); return true;");
  assert.equal(await ev(`return ${carsBoxes};`), before, 'the menu closed: the panel gave its controls back');
  await open('m-track'); await clickText('m-track', 'Start & grid…');
  assert.equal(await ev(`return ${carsBoxes};`), before + 1, 'and opens again');
});

test('row 13: a part that fails to load says why in its menu, and the other menus still work', { skip }, async () => {
  await send('Fetch.enable', { patterns: [{ urlPattern: '*app/core/buildmenu.js*' }] });
  onEvent = (d) => {
    if (d.method !== 'Fetch.requestPaused') return;
    const body = Buffer.from("throw new Error('buildmenu broken on purpose (row 13)');").toString('base64');
    send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/javascript' }], body });
  };
  try {
    await load();
    await open('m-build');
    const t = await ev("return document.getElementById('m-build').querySelector('.more-menu').textContent.trim();");
    assert.match(t, /This menu could not be built: .*buildmenu broken on purpose \(row 13\)/, `the Build menu says why: ${t}`);
    assert.doesNotMatch(t, /on the left/, 'no placeholder pointing at the left column');
    await open('m-edit'); assert.ok((await shown('m-edit')).includes('Undo'), 'Edit still works');
  } finally { onEvent = null; await send('Fetch.disable'); }
});

test('row 14: File holds Export layouts…, its modules load on the page, and off the app it says it needs the native side instead of doing nothing', { skip }, async () => {
  await load();
  await open('m-file');
  assert.ok((await shown('m-file')).includes('Export layouts…'), 'File holds Export layouts…');
  const said = await ev("document.getElementById('exportlayouts').click(); for (let i = 0; i < 50 && !/layouts/.test(document.getElementById('status').textContent); i++) await new Promise((r) => setTimeout(r, 50)); return document.getElementById('status').textContent;");
  assert.doesNotMatch(said, /could not start/, `the layouts export loaded: ${said}`);
  assert.match(said, /^export layouts failed: .*not running inside the app/, said);
  assert.deepEqual(errors, []);
});
