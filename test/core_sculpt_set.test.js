// core_sculpt_set.test.js: node --test test/core_sculpt_set.test.js
// src/core/sculpt.js brush with a SET of value channels (D520, pane C: Sculpt's grabbed point follows the mouse, so one drag moves h, l, w and phi together).
// The rule: a set is each channel brushed exactly as a single 'value' brush is, one after another, and a single brush is what it was.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./core_helpers.js');
const D = require('../src/core/document.js');
const S = require('../src/core/sculpt.js');

const BASE = H.docFrom(H.gen()[0]);
const at = { s0: 2000, r: 100 };
const one = (doc, channel, delta, more = {}) => S.brush(doc, { mode: 'value', channel, delta, ...at, ...more }).doc;

test('a two-channel step (height and lateral) is the two single steps one after the other, byte for byte, in either order', () => {
  const set = S.brush(BASE, { mode: 'value', channels: { h: 1.5, l: -2 }, ...at });
  assert.equal(D.serialize(set.doc), D.serialize(one(one(BASE, 'h', 1.5), 'l', -2)));
  assert.equal(D.serialize(set.doc), D.serialize(one(one(BASE, 'l', -2), 'h', 1.5)));
  assert.notEqual(D.serialize(set.doc), D.serialize(BASE));
});
test('a four-channel step (h, l, w, phi: a rim grab) is the four single steps, byte for byte, and reports which channel changed which piece', () => {
  const ch = { h: 0.4, l: 1.1, w: 2.5, phi: -0.2 }, set = S.brush(BASE, { mode: 'value', channels: ch, ...at });
  let d = BASE; for (const k of Object.keys(ch)) d = one(d, k, ch[k]);
  assert.equal(D.serialize(set.doc), D.serialize(d));
  assert.deepEqual([...new Set(set.changed.map((c) => c.channel))].sort(), ['h', 'l', 'phi', 'w']);
  assert.ok(set.changed.every((c) => Number.isInteger(c.piece) && c.indices.length > 0));
  assert.ok(Object.isFrozen(set.doc));
});
test('a one-channel set is the single value brush, byte for byte, with the same radius used and note', () => {
  for (const [ch, v] of [['h', 2], ['l', -1], ['w', 3], ['phi', 0.1]]) {
    const a = S.brush(BASE, { mode: 'value', channels: { [ch]: v }, ...at }), b = S.brush(BASE, { mode: 'value', channel: ch, delta: v, ...at });
    assert.equal(D.serialize(a.doc), D.serialize(b.doc), ch);
    assert.equal(a.radiusUsed, b.radiusUsed, ch);
    assert.equal(a.note, b.note, ch);
  }
});
test('a narrow set is widened as one brush is, and says so once', () => {
  const a = S.brush(BASE, { mode: 'value', channels: { h: 1, w: 1 }, s0: 2000, r: 5 }), b = S.brush(BASE, { mode: 'value', channel: 'h', delta: 1, s0: 2000, r: 5 });
  assert.equal(a.radiusUsed, b.radiusUsed);
  assert.ok(a.radiusUsed > 5);
  assert.equal(a.note, b.note);
});
test('a channel whose delta is 0 is left alone: a set of zeros is the same document', () => {
  const z = S.brush(BASE, { mode: 'value', channels: { h: 0, l: 0 }, ...at });
  assert.equal(z.doc, BASE);
  assert.deepEqual(z.changed, []);
  const half = S.brush(BASE, { mode: 'value', channels: { h: 0, l: 2 }, ...at });
  assert.equal(D.serialize(half.doc), D.serialize(one(BASE, 'l', 2)));
});
test('a set is refused by name: a rate channel, any mode but value, an empty or non-object set, a delta that is not a finite number', () => {
  assert.throws(() => S.brush(BASE, { mode: 'value', channels: { h: 1, kh: 0.001 }, ...at }), /BAD_CHANNEL/);
  assert.throws(() => S.brush(BASE, { mode: 'value', channels: { nope: 1 }, ...at }), /BAD_CHANNEL/);
  assert.throws(() => S.brush(BASE, { mode: 'hill', channels: { h: 1 }, ...at }), /BAD_MODE/);
  assert.throws(() => S.brush(BASE, { mode: 'rate', channels: { kh: 0.001 }, ...at }), /BAD_MODE/);
  assert.throws(() => S.brush(BASE, { mode: 'value', channels: {}, ...at }), /BAD_BRUSH/);
  assert.throws(() => S.brush(BASE, { mode: 'value', channels: null, ...at }), /BAD_BRUSH/);
  assert.throws(() => S.brush(BASE, { mode: 'value', channels: { h: NaN }, ...at }), /BAD_BRUSH/);
  assert.throws(() => S.brush(BASE, { mode: 'value', channels: { h: '1' }, ...at }), /BAD_BRUSH/);
});
test('a set that takes one channel out of range is refused whole, and the base is untouched', () => {
  const before = D.serialize(BASE);
  assert.throws(() => S.brush(BASE, { mode: 'value', channels: { h: 1, w: -1e6 }, ...at }), /CoreError|BAD|WIDTH|width/i);
  assert.equal(D.serialize(BASE), before);
});
test('a cup in a set reaches only cup pieces, as a single cup brush does (D225)', () => {
  assert.throws(() => S.brush(BASE, { mode: 'value', channels: { h: 1, c: 5 }, ...at }), /NOT_CUP/);
});
