// blenderexport-page.test.js: node --test app/test/blenderexport-page.test.js. File ▸ Export for Blender… on the real page in headless Chrome
// (muted, titled zz-headless-test): File holds the item and Settings ▸ Blender…; outside the app there is no native side, so Blender is not found,
// and the question says so, offers no FBX tick, and Cancel writes nothing and says so. The flow itself is app/test/blenderexport.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path');
const { chromePath, launchChrome, connect } = require('./soundrender.js');

const REPO = path.join(__dirname, '..', '..');
const CHROME = chromePath();
const skip = CHROME ? false : 'no Chrome here (set CHROME_PATH): the page is tested in headless Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav' };

let srv, ch, ws, dir, send, ev, errors = [];
test.before(async () => {
  if (skip) return;
  srv = http.createServer((q, s) => {
    const p = path.normalize(path.join(REPO, decodeURIComponent(q.url.split('?')[0])));
    if (!p.startsWith(REPO)) { s.writeHead(403); s.end(); return; }
    fs.readFile(p, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  let tgt; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--window-size=1400,860'], 't180bx-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl, (d) => { if (d.method === 'Runtime.exceptionThrown') errors.push(String(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text)); }));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d)}`); return d.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/app/index.html` });
  for (let i = 0; i < 150; i++) { await sleep(200); try { if (await ev("return document.documentElement.dataset.menubar === 'ready';")) break; } catch (e) { /* loading */ } }
  await ev("document.title = 'zz-headless-test'; return true;");
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); if (srv) srv.close(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

const open = (id) => ev(`const d = document.getElementById('${id}'); if (d.open) { d.open = false; await new Promise((r) => setTimeout(r, 50)); } d.querySelector('summary').click(); await new Promise((r) => setTimeout(r, 80)); return d.open;`);
const shown = (id) => ev(`return [...document.getElementById('${id}').querySelector('.more-menu').querySelectorAll('button, label, h3')].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim());`);

test('File holds Export for Blender… after Export layouts…, and Settings holds Blender…', { skip }, async () => {
  assert.equal(await ev("return document.documentElement.dataset.menubar || 'not mounted';"), 'ready', `page errors: ${errors.join(' | ') || 'none'}`);
  await open('m-file'); const file = await shown('m-file');
  assert.ok(file.indexOf('Export for Blender…') === file.indexOf('Export layouts…') + 1, `File: ${file.join(' | ')}`);
  await open('m-settings'); const set = await shown('m-settings');
  assert.ok(set.includes('Blender…'), `Settings: ${set.join(' | ')}`);
  await ev("document.getElementById('m-settings').open = false; return true;");
});

test('the question on the page: Blender not found outside the app, so no FBX tick and a note why; Cancel writes nothing and says so', { skip }, async () => {
  await ev("document.getElementById('exportblender').click(); return true;");
  let card = null;
  for (let i = 0; i < 50 && !card; i++) { await sleep(100); card = await ev("const c = document.querySelector('.ask-blender'); return c ? { title: c.querySelector('h2').textContent, fbx: !!c.querySelector('.bx-fbx'), only: !!c.querySelector('.bx-only'), note: (c.querySelector('.bx-note') || {}).textContent || '', w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height } : null;"); }
  assert.ok(card, 'the question opened');
  assert.equal(card.title, 'Export for Blender');
  assert.equal(card.fbx, false, 'no FBX tick without Blender'); assert.equal(card.only, false, 'nothing selected: no selected-pieces tick');
  assert.match(card.note, /Blender was not found/);
  assert.ok(card.w > 200 && card.w < 1400 && card.h > 80 && card.h < 860, `the card is on the page: ${card.w}×${card.h}`);
  await ev("[...document.querySelectorAll('.ask-blender button')].find((b) => b.textContent === 'Cancel').click(); return true;");
  await sleep(150);
  assert.equal(await ev("return !!document.querySelector('.ask-blender');"), false, 'the card is gone');
  assert.equal(await ev("return document.getElementById('status').textContent;"), 'Export for Blender: cancelled, nothing written.');
  assert.deepEqual(errors, []);
});
