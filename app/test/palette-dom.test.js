// palette-dom.test.js: node --test app/test/*.test.js
// The palette's DOM half (renderPalette), under a fake DOM that turns stray non-Node children into text the way the
// WebView does. It closes the gap B's read named: the headless tests covered paletteModel and not what reaches the page.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./palette-fakedom.js');
const { createShell } = require('../shell.js');
const { paletteModel, renderPalette } = require('../palette/palette.js');

const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib, saveAutosave: async () => {}, openAutosave: async () => null, clearAutosave: async () => {} }; };
const noop = new Proxy({}, { get: () => () => {} });

async function drawn(prep) {
  const restore = fake.install();
  try {
    const s = await createShell({ storage: mem() });
    if (prep) await prep(s);
    const root = new fake.Element('aside');
    renderPalette(root, paletteModel(s.getState(), s.pickers()), noop);
    return root;
  } finally { restore(); }
}

test('with no message and no error, the page shows no "null" anywhere (B\'s "nullnull" under THE TRACK)', async () => {
  const root = await drawn();
  assert.ok(!root.texts().some((t) => t === 'null' || t === 'undefined' || t === 'false'), JSON.stringify(root.texts()));
  assert.ok(!/null|undefined/.test(root.textContent), root.textContent);
});

test('a message, when there is one, is shown once as an alert', async () => {
  const root = await drawn((s) => s.setPicker('tempo', 'presto'));
  const alerts = root.querySelectorAll('.message');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].textContent, /presto/);
  assert.equal(alerts[0].getAttribute('role'), 'alert');
});

test('every built-in word and starter phrase is a button, and a click places it through the handler it was given', async () => {
  const restore = fake.install();
  try {
    const s = await createShell({ storage: mem() }), root = new fake.Element('aside'), placed = [];
    renderPalette(root, paletteModel(s.getState(), s.pickers()), { ...noop, place: (n) => placed.push(n) });
    const buttons = root.querySelectorAll('.builtin');
    assert.deepEqual(buttons.map((b) => b.textContent), ['straight', 'sweep', 'turn', 'tight', 'wall-ride', 'inversion', 'jump', 'sakura flow', 'bowl hairpin', 'S', 'spiral climb']);
    buttons[2].dispatch('click'); buttons[7].dispatch('click');
    assert.deepEqual(placed, ['turn', 'sakura flow']);
  } finally { restore(); }
});

test('pointing at a piece asks for its ghost, leaving it clears the ghost, and keyboard focus does the same', async () => {
  const restore = fake.install();
  try {
    const s = await createShell({ storage: mem() }), root = new fake.Element('aside'), asked = [];
    renderPalette(root, paletteModel(s.getState(), s.pickers()), { ...noop, ghost: (n) => asked.push(n) });
    const jump = root.querySelectorAll('.builtin').find((b) => b.textContent === 'jump');
    jump.dispatch('mouseenter'); jump.dispatch('mouseleave'); jump.dispatch('focus'); jump.dispatch('blur');
    assert.deepEqual(asked, ['jump', null, 'jump', null]);
  } finally { restore(); }
});

test('undo is disabled on an empty history, and live after a placement', async () => {
  const undoOf = (root) => root.querySelectorAll('button').find((b) => b.textContent === 'Undo');
  assert.ok(undoOf(await drawn()).hasAttribute('disabled'));
  assert.ok(!undoOf(await drawn((s) => s.place('turn'))).hasAttribute('disabled'));
});
