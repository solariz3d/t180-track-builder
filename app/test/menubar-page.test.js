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
//  11  (AMENDED D421 part 3: was "Build ▸ Brush shows the brush strip ..."; the plan removes Build ▸ Brush) Build ▸ Sculpt mode shows the Sculpt strip under the
//      bar, not in the left column; it stays there across an edit; Sculpt mode again hides it
//  12  (with the Track part) a menu panel gives its controls back when the menu closes: Start & grid… open, the menu closed, and its controls are gone
//  13  (D356) a part that fails to load says why in its menu: "This menu could not be built: <reason>", never a silent placeholder (app/core/buildmenu.js answered with a
//      module that throws, through DevTools' Fetch domain); the other menus still work
//  15  (D382) the sound slider in Settings shows 45 on a fresh start with nothing saved, and a saved volume (0.6) shows as saved, 60
//  16  (D394) Settings ▸ Theme: a fixed theme sets the look at once and fetches its own melody's two files; after a reload, that look and that melody;
//      SIGIL's tooltip says its melody is still picked at random
//  17  (D396) the bar fits at every width the window allows, from tauri.conf.json's minWidth (900) up: at 900, 1100, 1280 and 1400 px and on both sides of
//      each fold nothing overflows, the window's own buttons (#winctl) are wholly inside the window, the empty grab strip (.drag) is at least 24 px, and every
//      menu and Export to Assetto Corsa is on one line, left of them; the same at 125% scaling, where a window can be 979.2 or 1279.2 px wide (A's review 10)
//  18  (D401) Settings ▸ Theme's first choice and default is Random (it was Music); choosing it while open picks another look at once and that look's melody
//      follows; it is still saved as music, and a saved music loads as Random
//  18b (D401, B's D408 probe) row 18 with Math.random pinned: at 0.4 the start look is Random's pick, so its files are in and none is fetched again; at 0.6 they are fetched
//  19  (D401, A's read §8) on a fresh start, nothing saved and Random already ticked, a click on Random picks another look at once and its melody follows,
//      and again on the next click; Random stays ticked and the theme is saved as music
//  19b (D401) that first click on a fresh install picks ONCE: with Math.random pinned at 0.4 the start is Skyline and one pick is Glass (a second pick, which the first click
//      made when nothing was saved yet, lands back on Skyline)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const { chromePath, launchChrome, connect } = require('./soundrender.js');

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
  // D400: a free port, this Chrome's own (launchChrome checks the browser's pid), and a socket that rejects waiting sends when it closes
  let tgt; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--window-size=1400,860'], 't180menu-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl, (d) => { if (d.method && onEvent) onEvent(d); if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text); }));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 500)}`); return d.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false });
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); if (srv) srv.close(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

/** a fresh page: optionally with localStorage cleared first (same origin) or refused outright, then wait until the menus are mounted */
async function load({ clear = true, blocked = false, random = null } = {}) {
  errors = [];
  let script = null, pin = null;
  if (blocked) script = (await send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });" })).result.identifier;
  // random: Math.random pinned to that number in the page about to load (B's D408 probe), so a test can choose the start look and Random's pick
  if (random !== null) pin = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `Math.random = () => ${Number(random)};` })).result.identifier;
  if (clear && !blocked) { await send('Page.navigate', { url: base.replace('index.html', 'lib/cjs.js') }); await sleep(300); await ev('localStorage.clear(); return true;'); }
  await send('Page.navigate', { url: base });
  for (let i = 0; i < 150; i++) { await sleep(200); try { if (await ev("return document.documentElement.dataset.menubar === 'ready';")) break; } catch (e) { /* loading */ } }
  if (script) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script });
  if (pin) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pin });
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

test('row 11: Build ▸ Sculpt mode shows the Sculpt strip under the bar, keeps it there across an edit, and hides it again', { skip }, async (t) => {
  await load();
  if (!(await ev("return !!document.querySelector('.brush-strip');"))) return t.skip('the brush strip (the Build part, D355 part 2) is not in this tree');
  const where = () => ev("const s = document.querySelector('.brush-strip'), b = s.getBoundingClientRect(); return { inBanner: !!s.closest('#banner'), inLeft: !!s.closest('#left'), shown: s.offsetParent !== null && b.height > 0, top: Math.round(b.top), headBottom: Math.round(document.querySelector('header').getBoundingClientRect().bottom) };");
  let w = await where(); assert.equal(w.inBanner, true, 'the strip is in the row under the bar'); assert.equal(w.inLeft, false); assert.equal(w.shown, false, 'hidden while the brush is off');
  await ev("[...document.querySelectorAll('#palette button')].find((b) => b.textContent === 'Extend').click(); await new Promise((r) => setTimeout(r, 100)); return true;");   // a piece, so Undo below is an edit
  await open('m-build'); await clickText('m-build', 'Sculpt mode'); assert.equal(await ticked('m-build', 'Sculpt mode'), true, 'the item is ticked');
  w = await where(); assert.equal(w.shown, true, 'Sculpt shows it'); assert.ok(w.top >= w.headBottom, `under the bar (${w.top} >= ${w.headBottom})`);
  await ev("[...document.querySelectorAll('#palette button')].find((b) => b.textContent === 'Undo').click(); await new Promise((r) => setTimeout(r, 100)); return true;");
  w = await where(); assert.equal(w.inBanner, true, 'an edit (the banner is redrawn) keeps it there'); assert.equal(w.shown, true);
  await open('m-build'); await clickText('m-build', 'Sculpt mode');
  w = await where(); assert.equal(w.shown, false, 'Sculpt mode again hides it');
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

test('row 15: Settings ▸ Sound: the volume slider shows 45 on a fresh start, and a saved volume shows as saved', { skip }, async () => {
  await load();
  assert.equal(await ev("return localStorage.getItem('t180.sound.volume');"), null, 'nothing saved');
  assert.equal(await ev("return document.getElementById('sound-volume').value;"), '45', 'a fresh start: 45');
  await ev("localStorage.setItem('t180.sound.volume', '0.6'); return true;");
  await load({ clear: false });
  assert.equal(await ev("return document.getElementById('sound-volume').value;"), '60', 'a saved 0.6 is kept: 60');
  assert.equal(await ev("return localStorage.getItem('t180.sound.volume');"), '0.6', 'and not rewritten');
  assert.deepEqual(errors, []);
});

test('row 16 (D394): Settings ▸ Theme: a fixed theme sets the look at once and fetches its own melody\'s two files; it survives a reload as that look and melody; SIGIL says its melody stays random', { skip }, async () => {
  const urls = []; await send('Network.enable'); onEvent = (d) => { if (d.method === 'Network.requestWillBeSent') urls.push(d.params.request.url); };
  try {
    await load();
    await open('m-settings');
    const shownS = await shown('m-settings');
    for (const t of ['Random', 'Aqua', 'Skyline', 'Skyline Night', 'Glass', 'Aurora', 'SIGIL']) assert.ok(shownS.includes(t), `Settings ▸ Theme holds ${t}: ${shownS.join(' | ')}`);
    assert.equal(await ticked('m-settings', 'Random'), true, 'nothing saved: Random, today\'s random pick');   // D401: Music is called Random
    const now = await ev("return document.documentElement.getAttribute('data-theme');");
    const target = now === 'glass' ? 'aurora' : 'glass', label = target === 'glass' ? 'Glass' : 'Aurora';
    await ev("document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true;");   // the sound starts on a press (app/sound.js)
    for (let i = 0; i < 50 && !urls.some((u) => /sounds\/loop_closed\.wav$/.test(u)); i++) await sleep(100);
    assert.ok(urls.some((u) => /sounds\/loop_closed\.wav$/.test(u)), 'the sound started and fetched its files');
    urls.length = 0;
    await clickText('m-settings', label);
    assert.equal(await ev("return document.documentElement.getAttribute('data-theme');"), target, 'the look switches at once');
    assert.equal(await ticked('m-settings', label), true); assert.equal(await ticked('m-settings', 'Random'), false, 'a choice of one');
    for (let i = 0; i < 50 && !urls.some((u) => u.endsWith(`sounds/undo_${target}.wav`)); i++) await sleep(100);
    assert.deepEqual(urls.filter((u) => /\/sounds\//.test(u)).map((u) => u.replace(/^.*\/sounds\//, '')).sort(), [`place_${target}.wav`, `undo_${target}.wav`], 'and the melody follows: only its two files are fetched');
    assert.equal(await ev("return localStorage.getItem('t180.settings.theme');"), JSON.stringify(target), 'saved as t180.settings.theme');
    urls.length = 0;
    await load({ clear: false });
    assert.equal(await ev("return document.documentElement.getAttribute('data-theme');"), target, 'after a reload: the saved look');
    await ev("document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true;");
    for (let i = 0; i < 50 && !urls.some((u) => /sounds\/undo_\w+\.wav$/.test(u)); i++) await sleep(100);
    assert.deepEqual(urls.filter((u) => /sounds\/(place|undo)_/.test(u)).map((u) => u.replace(/^.*\/sounds\//, '')).sort(), [`place_${target}.wav`, `undo_${target}.wav`], 'and its own melody');
    await open('m-settings');
    assert.match(await ev("return [...document.querySelectorAll('#m-settings label')].find((x) => x.textContent.trim() === 'SIGIL').title;"), /melody[^.]*random/, 'SIGIL says its melody is still picked at random');
    await clickText('m-settings', 'SIGIL');
    assert.equal(await ev("return document.documentElement.hasAttribute('data-theme');"), false, 'SIGIL: no data-theme');
    assert.deepEqual(errors, []);
  } finally { onEvent = null; await send('Network.disable'); }
});

// what row 17 reads in a page (or a frame's page): its width, the bar's overflow, the window buttons, the grab strip (.drag), the h1 and every menu name and Export
const BAR = (d) => `const d = ${d}, lines = (e) => { const r = d.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
  const head = d.querySelector('header'), wb = d.getElementById('winctl').getBoundingClientRect(), box = (s) => d.querySelector(s).getBoundingClientRect().width;
  const parts = [...d.querySelectorAll('header details > summary')].concat([...d.querySelectorAll('#install > button')]);
  return { width: d.documentElement.getBoundingClientRect().width, overflow: head.scrollWidth - head.clientWidth, win: { left: wb.left, right: wb.right, width: wb.width },
    drag: box('header .drag'), h1: box('header h1'), name: box('#name'),
    parts: parts.map((e) => { const b = e.getBoundingClientRect(); return { text: e.textContent.trim(), lines: lines(e), right: b.right, width: b.width }; }) };`;
function fits(m, w) {
  assert.ok(m.overflow <= 0, `at ${w} px the bar overflows by ${m.overflow} px`);
  assert.ok(m.win.width >= 138 && m.win.left >= 0 && m.win.right <= m.width + 0.5, `at ${w} px the window buttons are not wholly inside the window: ${Math.round(m.win.left)} to ${Math.round(m.win.right)}`);
  assert.ok(m.drag >= 24, `at ${w} px the bar's empty grab strip (.drag) is ${m.drag.toFixed(1)} px, under 24: the frameless window has almost nothing to drag by`);
  assert.equal(m.parts.length, 8, `seven menus and the Export button at ${w} px`);
  for (const p of m.parts) {
    assert.equal(p.lines, 1, `at ${w} px "${p.text}" is on one line`);
    assert.ok(p.width > 0 && p.right <= m.win.left + 0.5, `at ${w} px "${p.text}" ends at ${Math.round(p.right)}, left of the window buttons (${Math.round(m.win.left)})`);
  }
}
// a second headless Chrome for row 17, started at a device scale of 1.25: only a browser started that way lays a frame out on whole device pixels, so a
// 979 px frame is 979.2 CSS px wide; DevTools' Emulation at 1.25 keeps it at 979 (measured, D396). Its own page errors are kept apart from the main ones
async function scaledChrome(scale) {
  // D400: a free port, this Chrome's own (launchChrome checks the browser's pid), and a socket that rejects waiting sends when it closes
  const errs = []; let proc, udir, tgt;
  try { ({ ch: proc, dir: udir, tgt } = await launchChrome(CHROME, ['--window-size=1400,860', `--force-device-scale-factor=${scale}`], 't180menu-scaled-')); } catch (e) { throw new Error(`headless Chrome at scale ${scale}: ${e.message}`); }
  let sock, call; try { ({ ws: sock, send: call } = await connect(tgt.webSocketDebuggerUrl, (d) => { if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); })); } catch (e) { proc.kill(); throw new Error(`the scaled DevTools socket failed: ${e.message}`); }
  const run = async (expr) => { const d = await call('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`scaled page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d)}`); return d.result.result.value; };
  await call('Runtime.enable'); await call('Page.enable');
  const close = async () => { try { sock.close(); } catch (e) { /* closing */ } proc.kill(); await sleep(300); try { fs.rmSync(udir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } };
  return { call, run, errs, close };
}
test('row 17 (D396): the bar fits at 900, 1100, 1280 and 1400 px and on both sides of each fold: no overflow, the window buttons wholly inside the window, a grab strip of at least 24 px, every menu and Export on one line left of them; at 125% scaling too, where a window can be a fraction of a pixel wide', { skip }, async () => {
  const minWidth = JSON.parse(fs.readFileSync(path.join(REPO, 'src-tauri', 'tauri.conf.json'), 'utf8')).app.windows[0].minWidth;
  assert.equal(minWidth, 900, 'the narrowest window tauri.conf.json allows');
  const at = {};
  try {
    for (const w of [minWidth, 979, 980, 999, 1000, 1099, 1100, 1279, 1280, 1319, 1320, 1400]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 860, deviceScaleFactor: 1, mobile: false });
      await load();
      const m = await ev(BAR('document'));
      assert.equal(m.width, w);
      fits(m, w); at[w] = m;
    }
    // at 125% a window 1599 device pixels wide is 1279.2 CSS px: (max-width: 1279px) and (min-width: 1280px) both miss it. The page is put in a frame of each
    // width below a fold, which lands on whole device pixels (979.2, 999.2, ...); it must fit as at the whole width below, folded the same
    const sc = await scaledChrome(1.25);
    try {
      for (const w of [979, 999, 1099, 1279, 1319]) {
        await sc.call('Page.navigate', { url: base.replace('index.html', 'lib/cjs.js') }); await sleep(300);
        await sc.run(`localStorage.clear(); document.documentElement.innerHTML = '<body style="margin:0"><iframe id="f" src="/app/index.html" style="display:block;width:${w}px;height:860px;border:0"></iframe></body>'; return true;`);
        let ready = false; for (let i = 0; i < 150 && !ready; i++) { await sleep(200); ready = await sc.run("const d = document.getElementById('f').contentDocument; return !!d && d.documentElement.dataset.menubar === 'ready';"); }
        assert.ok(ready, `the page in a ${w} px frame at 125% mounted its menus (page errors: ${sc.errs.join(' | ') || 'none'})`);
        const m = await sc.run(BAR("document.getElementById('f').contentDocument"));
        assert.ok(m.width > w && m.width < w + 1, `a ${w} px frame at 125% is a fraction of a pixel wider (${m.width})`);
        fits(m, m.width.toFixed(2));
        assert.equal(Math.round(m.h1), Math.round(at[w].h1), `at ${m.width.toFixed(2)} px the title folds as at ${w} px (h1 ${Math.round(m.h1)} px, not ${Math.round(at[w].h1)})`);
      }
      assert.deepEqual(sc.errs, [], 'no page errors at 125%');
    } finally { await sc.close(); }
    assert.deepEqual(errors, []);
  } finally { await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false }); }
});

// row 18's walk, as a function so row 18b can run it with Math.random pinned: Random first and the default, Glass, then Random picks another look and its melody follows.
// The melody check is row 19's rule (B's D408 hand-back): a look whose two files this load already fetched keeps them (app/sound.js), so it is fetched only when they were not in
async function randomAfterGlass({ random = null } = {}) {
  const urls = []; await send('Network.enable'); onEvent = (d) => { if (d.method === 'Network.requestWillBeSent') urls.push(d.params.request.url); };
  const look = () => ev("return document.documentElement.getAttribute('data-theme');");
  const soundFiles = () => urls.filter((u) => /sounds\/(place|undo)_/.test(u)).map((u) => u.replace(/^.*\/sounds\//, '')).sort();
  const fetched = async (name) => { for (let i = 0; i < 50 && !urls.some((u) => u.endsWith('sounds/' + name)); i++) await sleep(100); };
  try {
    await load({ random });
    const start = await ev("return document.documentElement.getAttribute('data-theme');");
    await open('m-settings');
    const labels = await ev("return [...document.querySelectorAll('#m-settings label')].map((x) => x.textContent.trim());");
    assert.ok(!labels.includes('Music'), `no theme is called Music: ${labels.join(' | ')}`);
    assert.ok(labels.includes('Random') && labels.indexOf('Random') === labels.indexOf('Aqua') - 1, `Random is the Theme section's first choice: ${labels.join(' | ')}`);
    const tip = await ev("return [...document.querySelectorAll('#m-settings label')].find((x) => x.textContent.trim() === 'Random').title;");
    assert.ok(/random/.test(tip) && /look/.test(tip) && /melody/.test(tip), `its tooltip says a look and its melody are picked at random: ${tip}`);
    assert.equal(await ticked('m-settings', 'Random'), true, 'nothing saved: Random, the default');
    await ev("document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true;");   // the sound starts on a press (app/sound.js)
    await fetched('loop_closed.wav'); assert.ok(urls.some((u) => /sounds\/loop_closed\.wav$/.test(u)), 'the sound started and fetched its files');
    await clickText('m-settings', 'Glass'); assert.equal(await look(), 'glass'); await fetched('undo_glass.wav');
    const had = urls.slice(); urls.length = 0;
    await clickText('m-settings', 'Random');
    const picked = await look();
    // AMENDED (D405): the rule changed by name: Random may land on Skyline Night too, which plays Skyline's melody (its files are skyline's)
    assert.ok(['aqua', 'skyline', 'aurora', 'skyline-night'].includes(picked), `choosing Random picks another look at once: ${picked}, after Glass`);
    const tune = picked === 'skyline-night' ? 'skyline' : picked;
    assert.equal(await ticked('m-settings', 'Random'), true); assert.equal(await ticked('m-settings', 'Glass'), false, 'a choice of one');
    const cached = had.some((u) => u.endsWith('sounds/undo_' + tune + '.wav'));
    if (!cached) await fetched('undo_' + tune + '.wav');
    assert.deepEqual(soundFiles(), cached ? [] : ['place_' + tune + '.wav', 'undo_' + tune + '.wav'], cached ? `${picked}'s files were in already (the start's look): none fetched again` : `${picked}'s melody follows: only its two files are fetched`);
    assert.equal(await ev("return localStorage.getItem('t180.settings.theme');"), JSON.stringify('music'), 'saved under its old value, music, so saves from before and after read alike');
    await ev("localStorage.setItem('t180.settings.theme', JSON.stringify('music')); return true;");   // as 0.4.6 and 0.4.7 saved it
    await load({ clear: false });
    assert.ok(['aqua', 'skyline', 'glass', 'aurora', 'skyline-night'].includes(await look()), 'a saved music starts on a random look');   // AMENDED (D405): or Skyline Night
    await open('m-settings');
    assert.equal(await ticked('m-settings', 'Random'), true, 'a saved music is shown as Random');
    assert.deepEqual(errors, []);
    return { start, picked, cached };
  } finally { onEvent = null; await send('Network.disable'); }
}
test('row 18 (D401): Settings ▸ Theme starts with Random, not Music, and it is the default; choosing it picks another look at once and that look\'s melody follows; a saved music loads as Random', { skip }, async () => {
  await randomAfterGlass();
});
test('row 18b (D401, B\'s D408 probe): the same with Math.random pinned, so both branches run every time: at 0.4 the start look is the pick (its files already in), at 0.6 it is not', { skip }, async () => {
  const a = await randomAfterGlass({ random: 0.4 });
  assert.deepEqual([a.start, a.picked, a.cached], ['skyline', 'skyline', true], 'at 0.4: starts on Skyline, Random after Glass picks Skyline, whose files are in');
  const b = await randomAfterGlass({ random: 0.6 });
  // AMENDED (D405): the rule changed by name: after Glass, Random picks from four looks, Skyline Night last (aqua, skyline, aurora, skyline-night), so 0.6 is Aurora
  assert.deepEqual([b.start, b.picked, b.cached], ['glass', 'aurora', false], 'at 0.6: starts on Glass, Random after Glass picks Aurora, fetched');
});
test('row 19 (D401, A\'s read §8): a fresh start, Random already ticked: one click on Random picks another look and its melody, and so does the next', { skip }, async () => {
  const urls = []; await send('Network.enable'); onEvent = (d) => { if (d.method === 'Network.requestWillBeSent') urls.push(d.params.request.url); };
  const look = () => ev("return document.documentElement.getAttribute('data-theme');");
  const fetched = async (name) => { for (let i = 0; i < 50 && !urls.some((u) => u.endsWith('sounds/' + name)); i++) await sleep(100); };
  try {
    await load();
    assert.equal(await ev("return localStorage.getItem('t180.settings.theme');"), null, 'nothing saved');
    await ev("document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true;");   // the sound starts on a press (app/sound.js)
    await fetched('loop_closed.wav');
    await open('m-settings');
    assert.equal(await ticked('m-settings', 'Random'), true, 'Random is ticked, as on every fresh start');
    let before = await look();
    for (const n of [1, 2]) {
      const had = urls.slice();   // a look whose two files this load already fetched keeps them (app/sound.js), so it is not fetched again
      await clickText('m-settings', 'Random');
      const picked = await look();
      assert.notEqual(picked, before, `click ${n} on a ticked Random picks another look: still ${picked}`);
      // AMENDED (D405): or Skyline Night, on Skyline's melody (its files are skyline's)
      assert.ok(['aqua', 'skyline', 'glass', 'aurora', 'skyline-night'].includes(picked), `click ${n}: one of the five looks: ${picked}`);
      const tune = picked === 'skyline-night' ? 'skyline' : picked, before2 = had.some((u) => u.endsWith('sounds/undo_' + tune + '.wav'));
      if (!before2) await fetched('undo_' + tune + '.wav');
      assert.ok(urls.some((u) => u.endsWith('sounds/undo_' + tune + '.wav')), `click ${n}: ${picked}'s melody follows (its files ${before2 ? 'were in already' : 'are fetched'})`);
      assert.equal(await ticked('m-settings', 'Random'), true, `click ${n}: Random stays ticked`);
      before = picked;
    }
    assert.equal(await ev("return localStorage.getItem('t180.settings.theme');"), JSON.stringify('music'), 'saved as music');
    assert.deepEqual(errors, []);
  } finally { onEvent = null; await send('Network.disable'); }
});
test('row 19b (D401): on a fresh install the first click on the ticked Random picks once, not twice: with Math.random at 0.4, Skyline becomes Glass', { skip }, async () => {
  // nothing saved, so settings.set('theme', 'music') is a change (undefined to music) and tells its listener, which picks; a second pick asked for by the item itself
  // excluded only the first pick, so it could land back on the start look (menubar-page run 4 of 5, 2026-10-19: "still skyline")
  await load({ random: 0.4 });
  const look = () => ev("return document.documentElement.getAttribute('data-theme');");
  assert.equal(await ev("return localStorage.getItem('t180.settings.theme');"), null, 'nothing saved');
  assert.equal(await look(), 'skyline', 'at 0.4 the start look is Skyline');
  await open('m-settings');
  assert.equal(await ticked('m-settings', 'Random'), true);
  await clickText('m-settings', 'Random');
  assert.equal(await look(), 'glass', 'one pick from Skyline at 0.4 is Glass; Skyline again is a second pick');
  await clickText('m-settings', 'Random');
  assert.equal(await look(), 'skyline', 'the next click, the theme now saved as music, picks once from Glass: Skyline');
  assert.deepEqual(errors, []);
});
