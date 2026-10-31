// csp.test.js: node --test app/test/csp.test.js. The app's content security policy (src-tauri/tauri.conf.json app.security): scripts only from the app itself (plus
// eval, which the module loader app/lib/cjs.js needs for new Function), no remote source anywhere, and the export host's one inline script named by its hash.
// That script is the relay page of the export's sandboxed frame (app/export/exportrunner.js RELAY): a srcdoc frame takes the page's policy, and the build hashes
// only scripts in .html files, so without its hash here every export would be refused inside the frame. Change the relay and this file says which hash to put in.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { _internal: { RELAY } } = require('../export/exportrunner.js');

const sec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'src-tauri', 'tauri.conf.json'), 'utf8')).app.security;
const sources = (k) => String(sec.csp[k] || '').split(/\s+/).filter(Boolean);

test('there is a policy, and everything it does not name comes from the app itself', () => {
  assert.equal(typeof sec.csp, 'object'); assert.notEqual(sec.csp, null);
  assert.deepEqual(sources('default-src'), ["'self'"]);
  assert.deepEqual(sources('object-src'), ["'none'"]);
});

test('scripts come only from the app: no inline script but the hashed one, and nothing remote anywhere', () => {
  const s = sources('script-src');
  assert.ok(s.includes("'self'") && s.includes("'unsafe-eval'"));
  assert.ok(!s.includes("'unsafe-inline'"), 'no inline script runs unless the build hashes it');
  for (const [k, v] of Object.entries(sec.csp)) for (const src of String(v).split(/\s+/)) assert.ok(!/^https?:/.test(src) || src === 'http://ipc.localhost', `${k} names a remote source: ${src}`);
});

test('the export host\'s relay script is named by its hash in script-src', () => {
  const scripts = [...RELAY.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  const hash = `'sha256-${crypto.createHash('sha256').update(scripts[0]).digest('base64')}'`;
  assert.ok(sources('script-src').includes(hash), `script-src lacks the relay's hash ${hash}: put it in, or every export is refused inside its frame`);
});

test('the build is told to leave style-src alone, so inline styles keep working', () => {
  assert.deepEqual(sec.dangerousDisableAssetCspModification, ['style-src'], 'a nonce added to style-src would switch off its unsafe-inline, which the panel\'s styled notes need');
  assert.ok(sources('style-src').includes("'unsafe-inline'"));
});
