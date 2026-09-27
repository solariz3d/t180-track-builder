// palette-panels.test.js: node --test app/test/*.test.js
// Mounting C's and E's panels (app/palette/panels.js). A panel that FAILS to start shows a visible error in its own
// area (C's note on the page: a broken preview showed nothing); one not written yet shows a quiet "not plugged in".
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./palette-fakedom.js');
const { mountPanel } = require('../palette/panels.js');

const shell = { getState: () => ({}), subscribe: () => () => {} };
async function mountWith(loader) {
  const restore = fake.install();
  try { const root = new fake.Element('div'); const r = await mountPanel(root, 'preview', loader, shell); return { root, r }; } finally { restore(); }
}
const alertOf = (root) => root.querySelectorAll('.panel-error')[0];

test('a mount that throws shows the error, visibly, in the panel\'s own area', async () => {
  const { root, r } = await mountWith(async () => ({ mount: () => { throw new Error('WebGL is not available'); } }));
  assert.equal(r.ok, false);
  const a = alertOf(root);
  assert.ok(a, 'no visible error');
  assert.equal(a.getAttribute('role'), 'alert');
  assert.match(a.textContent, /The preview could not start: WebGL is not available/);
});

test('a mount that RETURNS an error shows it the same way (an Error, or { error })', async () => {
  for (const ret of [new Error('no canvas'), { error: 'no canvas' }]) {
    const { root, r } = await mountWith(async () => ({ mount: () => ret }));
    assert.equal(r.ok, false);
    assert.match(alertOf(root).textContent, /no canvas/);
  }
});

test('an async mount that rejects is shown too', async () => {
  const { root } = await mountWith(async () => ({ mount: async () => { throw new Error('shader failed to compile'); } }));
  assert.match(alertOf(root).textContent, /shader failed to compile/);
});

test('a module that exports no mount is an error, named', async () => {
  const { root } = await mountWith(async () => ({ render: () => {} }));
  assert.match(alertOf(root).textContent, /exports no mount\(root, shell\)/);
});

test('a module that is not there yet is a quiet note, not an alarm', async () => {
  const { root, r } = await mountWith(async () => { throw new Error('cjs: could not load app/preview/index.js: 404 app/preview/index.js'); });
  assert.equal(r.ok, false);
  assert.equal(alertOf(root), undefined);
  assert.match(root.textContent, /app\/preview is not plugged in yet/);
});

test('a module that is there but fails to LOAD (a syntax error, a missing file it needs) is an alarm', async () => {
  const { root } = await mountWith(async () => { throw new SyntaxError('Unexpected token }'); });
  assert.match(alertOf(root).textContent, /The preview could not start: Unexpected token \}/);
});

test('a mount that succeeds leaves the area to the panel, with nothing of ours in it', async () => {
  const { root, r } = await mountWith(async () => ({ mount: (el) => { el.append('panel content'); } }));
  assert.equal(r.ok, true);
  assert.equal(root.textContent, 'panel content');
});
