// Headless tests for app/texture (D172): the textures panel's logic against the real shell, and its loading through the
// webview loader. Images are generated here. Run: node --test "app/test/*.test.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createShell } = require('../shell.js');
const { loadCjs } = require('../lib/cjs.js');
const { createTextureController, nameFromFile } = require('../texture/panel.js');
const T = require('../../src/texture/index.js');

const REPO = path.resolve(__dirname, '..', '..');
const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };
const png = (W = 16, H = 16) => { const rgba = new Uint8Array(W * H * 4).fill(255); for (let i = 0; i < rgba.length; i += 4) rgba[i] = i & 255; return T.png.encodePng({ width: W, height: H, rgba }, zlib.deflateSync); };

test('an added PNG is decoded at once and listed; a slot set to it reaches the one texture set', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createTextureController(shell);
  shell.place('straight');
  ctl.addImage('stripes', png());
  assert.deepStrictEqual(ctl.state.images.map((i) => [i.name, i.format, i.width]), [['stripes', 'png', 16]]);
  assert.strictEqual(ctl.state.set.textures.length, 0);              // added, not yet used
  ctl.setSlot('w1', 'floor', { texture: 'stripes', tileLength: 4 });
  assert.deepStrictEqual([ctl.state.error, ctl.state.set.textures.map((t) => t.file)], [null, ['t180b_stripes.dds']]);
  assert.strictEqual(ctl.state.set.bySegment('w1').floor.settings.tileLength, 4);
});

test('a slot edit is one undo step, and undo takes the texture back out of the set', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createTextureController(shell);
  shell.place('straight'); ctl.addImage('stripes', png());
  ctl.setSlot('w1', 'kerbs', { texture: 'stripes' });
  shell.undo();
  assert.deepStrictEqual([shell.getState().history.present.words[0].textures, ctl.state.set.textures.length], [{}, 0]);
});

test('a bad file, a bad name, a duplicate name and a missing image are refused in the panel, by name', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createTextureController(shell);
  shell.place('straight');
  assert.match(ctl.addImage('x', Buffer.from('not an image')).error, /not a PNG or a JPEG/);
  assert.match(ctl.addImage('Bad Name', png()).error, /not a texture name/);
  ctl.addImage('a', png());
  assert.match(ctl.addImage('a', png()).error, /already added/);
  assert.match(ctl.setSlot('w1', 'floor', { texture: 'b' }).error, /add the image "b"/);
  assert.deepStrictEqual(ctl.state.images.map((i) => i.name), ['a']);
});

test('an image still used by a slot cannot be removed; once the slot is cleared it can', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createTextureController(shell);
  shell.place('straight'); ctl.addImage('a', png());
  ctl.setSlot('w1', 'walls', { texture: 'a' });
  assert.match(ctl.removeImage('a').error, /still used by w1 walls/);
  ctl.clearSlot('w1', 'walls');
  assert.deepStrictEqual([ctl.removeImage('a').error, ctl.state.images.length], [null, 0]);
});

test('a non-power-of-two image is added with its warning shown', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createTextureController(shell);
  ctl.addImage('odd', png(24, 16));
  assert.deepStrictEqual(ctl.state.images[0].warnings.map((w) => w.code), ['NOT_POWER_OF_TWO']);
});

test('a file name becomes a texture name the document accepts', () => {
  assert.deepStrictEqual(['C:\\pics\\Kerb Stripes.PNG', 'x/._.jpg', 'Ünï.jpeg'].map(nameFromFile), ['kerb-stripes', 'texture', 'n']);
});

test('the textures panel loads through the webview loader and exports mount(root, shell)', async () => {
  const m = await loadCjs('app/texture/index.js', async (p) => fs.readFileSync(path.join(REPO, p), 'utf8'));
  assert.strictEqual(typeof m.mount, 'function');
});
