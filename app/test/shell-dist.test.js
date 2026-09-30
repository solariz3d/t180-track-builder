// shell-dist.test.js: node --test app/test/*.test.js
// Everything the app loads in the webview must be inside what src-tauri/build.rs copies into dist/. The node tests load
// from the repository, where every file exists, so a file build.rs leaves out passes here and 404s in the window. That
// happened: fromwords.js requires tools/kn5.cjs, dist/ had no tools/, and the app could not start (found in headless
// Edge, 2026-09-27). This walks the loader's own requests for every module the page loads.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadCjs } = require('../lib/cjs.js');
const { createShim } = require('../export/node-shim.js');

const REPO = path.resolve(__dirname, '..', '..');
/** The top-level folders build.rs copies: every copy_dir(&root.join("X"), …) in it. */
function copied() {
  const rs = fs.readFileSync(path.join(REPO, 'src-tauri', 'build.rs'), 'utf8');
  return [...rs.matchAll(/copy_dir\(&root\.join\("([^"]+)"\)/g)].map((m) => m[1]);
}

test('build.rs copies app/, src/ and tools/', () => {
  assert.deepEqual(copied().sort(), ['app', 'src', 'tools']);
});

test('every file the page loads through the loader is inside a folder build.rs copies', async () => {
  const asked = new Set(), shim = createShim();
  const get = async (p) => { asked.add(p); return fs.readFileSync(path.join(REPO, p), 'utf8'); };
  const opts = { builtins: shim.builtins, globals: { Buffer: shim.Buffer } };
  // the page's own loads (app/index.html), each the way the page makes it: the app's modules plain, the exporter with
  // the node shim (app/export/export.js makeExporter)
  for (const entry of ['app/shell.js', 'app/closer.js', 'app/palette/palette.js', 'app/palette/panels.js', 'app/export/export.js']) await loadCjs(entry, get);
  await loadCjs('src/export/fromwords.js', get, opts);
  const roots = new Set(copied());
  const outside = [...asked].filter((p) => !roots.has(p.split('/')[0]));
  assert.deepEqual(outside, [], `loaded but not copied into dist/: ${outside.join(', ')}`);
  assert.ok(asked.has('tools/kn5.cjs'), 'the exporter reads its kn5 back through tools/kn5.cjs');
});
