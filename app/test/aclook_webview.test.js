// aclook_webview.test.js (D224): the preview's look resolves in the app's REAL loading path, where there is no node.
//
// WHY THIS EXISTS. 5debee8 made app/preview/aclook.js resolveLook call src/export/acready.js ensureDiffuse, which built its texture with
// Buffer.from(...). Every other aclook test runs the module under node, where Buffer exists, so all of them passed; in the app the
// preview is loaded by app/lib/cjs.js loadCjs('app/preview/index.js', get) with NO Buffer global (only the exporter's own load injects
// the shim), the first Extend gave the preview a mesh, resolveLook threw a ReferenceError, and the track did not draw (the keeper, 2026-10-03).
//
// HOW THIS RUNS IT THE APP'S WAY. The preview module is loaded through the app's own loader, fetching source text by relative path, with
// Buffer (and process) shadowed to undefined for every file it loads, as a webview has them. Nothing node-only is provided: a bare
// `require('fs')` would fail by name, exactly as in the app. The scene it resolves is a real extended track's, built under node.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { loadCjs } = require(path.join(ROOT, 'app', 'lib', 'cjs.js'));
const D = require(path.join(ROOT, 'src', 'doc', 'index.js'));
const { createTrackModel } = require(path.join(ROOT, 'app', 'preview', 'trackmodel.js'));

// the app's own fetch: a path relative to the served root, which mirrors the repository
const get = async (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const WEBVIEW = { globals: { Buffer: undefined, process: undefined } };

/** What pressing Extend does to the document: one more piece, then the preview's track model takes the resolved path. */
function extendedScene(n = 1) {
  let d = D.createDoc('Extend');
  for (let i = 0; i < n; i++) d = D.appendWord(d, 'straight', { speed: 55 });
  const t = createTrackModel().update(D.resolve(d));
  assert.ok(t.batches.length > 0, 'control: the extended track has something to draw');
  return t;
}

test('WEBVIEW: aclook.js loads through the app\'s loader with no Buffer and no node, and resolves the look of an extended track', async () => {
  const t = extendedScene(), A = await loadCjs('app/preview/aclook.js', get, WEBVIEW);
  const look = A.resolveLook(t.mesh.scene);   // red at 527ed0e: ReferenceError: Buffer is not defined (acready.js ensureDiffuse)
  for (const b of t.batches) { const m = look.materialOf(b); assert.ok(m && m.samplers.some((s) => s.name === 'txDiffuse'), `${b.key} has a material with a diffuse`); }
  assert.ok(look.textures.size > 0, 'the solid diffuse textures the export writes are there for the preview too');
  for (const [file, tex] of look.textures) { assert.ok(/^t180b_solid_\d+\.dds$/.test(file), file); assert.ok(tex.width === 4 && tex.height === 4 && tex.rgba.length === 64, `${file} is a 4x4 rgba`); }
});

test('WEBVIEW: the look resolved without node is value for value the look resolved under node (same materials, same texture pixels)', async () => {
  const t = extendedScene(3), W = await loadCjs('app/preview/aclook.js', get, WEBVIEW), N = require(path.join(ROOT, 'app', 'preview', 'aclook.js'));
  const lw = W.resolveLook(t.mesh.scene), ln = N.resolveLook(t.mesh.scene);
  assert.deepStrictEqual([...lw.textures.keys()], [...ln.textures.keys()]);
  for (const [file, tex] of ln.textures) assert.deepStrictEqual([...lw.textures.get(file).rgba], [...tex.rgba], file);
  for (const b of t.batches) assert.strictEqual(lw.materialOf(b).name, ln.materialOf(b).name);
});

test('WEBVIEW: the whole preview module graph loads with no Buffer (the module the app mounts, app/preview/index.js)', async () => {
  const P = await loadCjs('app/preview/index.js', get, WEBVIEW);
  assert.ok(P && typeof P === 'object');
});
