// exportbanner.test.js: node --test app/test/exportbanner.test.js
// THE EXPORT BANNER (app/core/exportbanner.js), its states under node on the fake DOM (palette-fakedom.js), the clock and the ticker stood in for. Rows:
//   1  run shows "Exporting…" and the seconds since the export began, counting while it runs; done shows "Done" and the route's result; fail shows "Export failed"
//      and the reason; neither leaves a ticker running
//   2  follow, for the routes that report through one say(): "exporting", "building" or "writing" runs it, then "exported…" ends it done and anything else
//      failed; a text before it runs (cancelled, no folder picked) leaves it hidden
//   3  a finished banner stays until it is clicked or the next action (a pointer press or a key anywhere); a click while it runs does not close it
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./palette-fakedom.js');
const { createExportBanner } = require('../core/exportbanner.js');

function rig() {
  const restore = fake.install();
  const box = new fake.Element('div');
  box.contains = (t) => t === box || [...box.walk()].includes(t);
  const doc = { createElement: (t) => new fake.Element(t), listeners: {}, addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); }, removeEventListener(k, fn) { this.listeners[k] = (this.listeners[k] || []).filter((f) => f !== fn); } };
  let t = 1000; const ticks = new Map(); let id = 0;
  const b = createExportBanner(box, { doc, now: () => t, every: (fn) => { ticks.set(++id, fn); return id; }, stop: (h) => ticks.delete(h) });
  const head = () => box.querySelector('.eb-head').textContent, text = () => box.querySelector('.eb-text').textContent;
  const advance = (ms) => { t += ms; for (const fn of ticks.values()) fn(); };
  const press = (k, target = null) => { for (const fn of [...(doc.listeners[k] || [])]) fn({ target }); };
  return { restore, box, b, head, text, advance, ticks, press };
}

test('row 1: run counts the seconds, done and fail say the result, and no ticker is left running', () => {
  const r = rig();
  try {
    assert.equal(r.box.hidden, true, 'hidden before any export');
    assert.equal(r.box.getAttribute('role'), 'status');
    r.b.run('into D:\\tracks');
    assert.deepEqual([r.box.hidden, r.head(), r.text(), r.b.state], [false, 'Exporting… 0 s', 'into D:\\tracks', 'running']);
    r.advance(1000); assert.equal(r.head(), 'Exporting… 1 s');
    r.advance(98500); assert.equal(r.head(), 'Exporting… 99 s');
    r.b.done('exported t180b_x to D:\\tracks');
    assert.deepEqual([r.head(), r.text(), r.b.state, r.ticks.size], ['Done', 'exported t180b_x to D:\\tracks', 'done', 0]);
    assert.match(r.box.className, /\bdone\b/);
    r.b.run('into Assetto Corsa'); assert.equal(r.head(), 'Exporting… 0 s', 'a new export starts its own count');
    r.b.fail('not exported: the road runs into itself');
    assert.deepEqual([r.head(), r.text(), r.b.state, r.ticks.size], ['Export failed', 'not exported: the road runs into itself', 'failed', 0]);
    assert.match(r.box.className, /\bfailed\b/);
  } finally { r.restore(); }
});

test('row 2: follow runs on "exporting/building/writing", ends done on "exported", failed on anything else, and ignores texts before it runs', () => {
  const r = rig();
  try {
    r.b.follow('Export layouts: cancelled, nothing written.');
    assert.equal(r.box.hidden, true, 'a cancel before the export shows nothing');
    r.b.follow('building the export for Blender…'); assert.equal(r.b.state, 'running');
    r.advance(3000);
    r.b.follow('writing the .glb, then Blender makes the .fbx…'); assert.deepEqual([r.b.state, r.head()], ['running', 'Exporting… 3 s'], 'a later step keeps the count');
    r.b.follow('exported for Blender into D:\\out\\x'); assert.deepEqual([r.b.state, r.text()], ['done', 'exported for Blender into D:\\out\\x']);
    r.b.follow('exporting 3 layouts…'); r.b.follow('not exported: a layout is open');
    assert.deepEqual([r.b.state, r.text()], ['failed', 'not exported: a layout is open']);
  } finally { r.restore(); }
});

test('row 3: a finished banner closes on a click on it or on the next press or key anywhere, never while it runs', () => {
  const r = rig();
  try {
    r.b.run('x'); r.box.onclick(); r.press('pointerdown'); r.press('keydown');
    assert.equal(r.b.state, 'running', 'a click or key while it runs leaves it');
    r.b.done('ok'); r.box.onclick(); assert.deepEqual([r.b.state, r.box.hidden], ['idle', true], 'a click on it closes it');
    r.b.done('ok'); r.press('pointerdown', r.box.querySelector('.eb-text')); assert.equal(r.b.state, 'done', 'a press inside it is its own click, not the next action');
    r.press('keydown'); assert.deepEqual([r.b.state, r.box.hidden], ['idle', true], 'a key anywhere closes it');
    r.b.fail('no'); r.press('pointerdown'); assert.equal(r.box.hidden, true, 'a press anywhere closes a failure too');
  } finally { r.restore(); }
});
