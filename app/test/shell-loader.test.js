// shell-loader.test.js: node --test app/test/*.test.js
// app/lib/cjs.js, the loader that runs the program's CommonJS files in the webview. Here it is fed from the disk the
// way the webview is fed by fetch, and the modules it loads must behave exactly as node's own require gives them.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadCjs, norm } = require('../lib/cjs.js');

const REPO = path.resolve(__dirname, '..', '..');
const fromDisk = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };

test('the shell loaded through the loader builds the same track, byte for byte, as the shell node loads', async () => {
  const viaLoader = await loadCjs('app/shell.js', fromDisk), viaNode = require('../shell.js');
  const a = await viaLoader.createShell({ storage: mem() }), b = await viaNode.createShell({ storage: mem() });
  for (const s of [a, b]) { s.setPicker('tempo', 'aurora'); for (const w of ['straight', 'sweep', 'jump', 'straight', 'wall-ride']) s.place(w); }
  assert.equal(a.text(), b.text());
  assert.notEqual(viaLoader, viaNode, 'a separate copy, as the webview has');
});

test('the palette module loads too, and its model matches', async () => {
  const shell = await loadCjs('app/shell.js', fromDisk), pal = await loadCjs('app/palette/palette.js', fromDisk);
  const s = await shell.createShell({ storage: mem() }); s.place('turn');
  assert.deepEqual(pal.paletteModel(s.getState(), s.pickers()).track, [{ id: 'w1', word: 'turn', phrase: false, selected: false }]);
});

test('a node built-in is refused loudly, naming the module and the file that asked for it', async () => {
  const files = { 'x/a.js': "module.exports = require('fs');" };
  await assert.rejects(loadCjs('x/a.js', async (p) => { if (!files[p]) throw new Error('404'); return files[p]; }), /"fs" \(required by x\/a\.js\) is not available/);
});

test('a missing file fails when it is really required, not when a comment only mentions it', async () => {
  const files = {
    'm/ok.js': "// see require('./gone.js') for history\nmodule.exports = 1;",
    'm/bad.js': "module.exports = require('./gone.js');",
  };
  const get = async (p) => { if (!files[p]) throw new Error(`404 ${p}`); return files[p]; };
  assert.equal(await loadCjs('m/ok.js', get), 1);
  await assert.rejects(loadCjs('m/bad.js', get), /m\/gone\.js \(required by m\/bad\.js\) could not be loaded: 404/);
});

test('each file runs once, and a require cycle sees the partial exports, as in node', async () => {
  let runs = 0;
  const files = {
    'c/a.js': "exports.a = 1; const b = require('./b.js'); exports.fromB = b.b;",
    'c/b.js': "const a = require('./a.js'); exports.b = 2; exports.sawA = a.a; module.exports.count = (globalThis.__cjsRuns = (globalThis.__cjsRuns || 0) + 1);",
  };
  const a = await loadCjs('c/a.js', async (p) => { runs++; return files[p]; });
  assert.deepEqual([a.a, a.fromB], [1, 2]);
  assert.equal(runs, 2);
});

test('an injected global does not clash with a file that declares the same name at its top level', async () => {
  const files = { 'g/a.js': "class Buffer { static tag() { return 'own'; } }\nmodule.exports = Buffer.tag();", 'g/b.js': 'module.exports = typeof Buffer;' };
  const get = async (p) => files[p];
  assert.equal(await loadCjs('g/a.js', get, { globals: { Buffer: function Injected() {} } }), 'own');
  assert.equal(await loadCjs('g/b.js', get, { globals: { Buffer: function Injected() {} } }), 'function');
});

test('a bare name the page supplies as a builtin is served; any other still fails loudly', async () => {
  const files = { 'b/a.js': "module.exports = require('zlib').name;", 'b/c.js': "module.exports = require('net');" };
  const get = async (p) => files[p];
  assert.equal(await loadCjs('b/a.js', get, { builtins: { zlib: { name: 'shim' } } }), 'shim');
  await assert.rejects(loadCjs('b/c.js', get, { builtins: { zlib: {} } }), /"net" \(required by b\/c\.js\) is not available/);
});

test('paths are normalised, and none may climb above the served root', () => {
  assert.equal(norm('app/./palette/../shell.js'), 'app/shell.js');
  assert.throws(() => norm('../outside.js'), /climbs above the served root/);
});
