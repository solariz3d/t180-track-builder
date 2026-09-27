// export-selfcheck.test.js: node --test app/test/*.test.js
// The self-intersection check is ALWAYS on in the app (the ruling of 2026-09-27: "settle it by the geometry, never by
// loosening the check"). There is no toggle, and nothing the app does can turn it off: a refused export shows its reds.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeExporter } = require('../export/export.js');

const APP = path.resolve(__dirname, '..');
const OFF = new RegExp(['self', 'Check\\s*:\\s*(false|!)'].join(''));   // split so this file does not match itself
function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out); else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('no file of the app turns the self-check off, and the page has no toggle for it', () => {
  const bad = files(APP).filter((f) => path.basename(f) !== path.basename(__filename)).filter((f) => OFF.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(bad.map((f) => path.relative(APP, f)), []);
  const page = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  assert.ok(!/skipself|skip self-intersection/i.test(page), 'the page still carries the skip-the-check checkbox');
});

test('asking the exporter to skip the check does nothing: exportTrack never receives a selfCheck, so it runs on', async () => {
  const seen = [];
  const spy = "module.exports = { ExportError: class ExportError extends Error {}, exportTrack: (doc, o) => { globalThis.__t180ExportSeen.push(o); return { folders: [], warnings: [] }; } };";
  globalThis.__t180ExportSeen = seen;
  const get = async (p) => (p === 'src/export/fromwords.js' ? spy : fs.readFileSync(path.join(APP, '..', p), 'utf8'));
  try {
    const ex = await makeExporter(get);
    ex.run({}, { selfCheck: false });
    ex.run({});
    assert.equal(seen.length, 2);
    for (const o of seen) assert.ok(!('selfCheck' in o), `exportTrack was handed selfCheck: ${JSON.stringify(o)}`);
  } finally { delete globalThis.__t180ExportSeen; }
});
