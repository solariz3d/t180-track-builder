// keys-anywhere.test.js: D242 item 8a (the keeper: "make it like photoshop or video editing programs, cntrl z and what ever to go forward
// and back"). Undo and redo act on the TRACK from anywhere, a number field included; a text-entry field keeps them for its own text;
// Ctrl+S and Ctrl+Backspace are unchanged (in any field they stay the field's: Ctrl+Backspace deletes a word, never the track's head).
// Run: node --test --test-concurrency=1 app/test/keys-anywhere.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { keyAction, bindKeys } = require('../core/keys.js');
const { createCoreShell } = require('../core/coreshell.js');
const D = require('../../src/core/document.js');

/** A fake element that answers the SELECTOR LISTS keys.js asks, as a browser would: `tag`, `tag:not([type])`, `tag[type="x"]`. */
function el(tag, type) {
  const one = (sel) => {
    const m = /^([a-z]+)(?::not\(\[type\]\)|\[type="([a-z]+)"\])?$/.exec(sel.trim()); if (!m) throw new Error(`unknown selector ${sel}`);
    if (m[1] !== tag) return false;
    if (sel.includes(':not([type])')) return type === undefined;
    if (m[2] !== undefined) return type === m[2];
    return true;
  };
  return { tagName: tag.toUpperCase(), type, matches: (list) => list.split(',').some(one), isContentEditable: false };
}
const BODY = { matches: () => false, isContentEditable: false };
function page() {
  const ls = new Set(), doc = { addEventListener: (t, f) => { if (t === 'keydown') ls.add(f); }, removeEventListener: (t, f) => { if (t === 'keydown') ls.delete(f); } };
  const press = (key, mods, target) => { const e = { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods, target, prevented: false, preventDefault() { this.prevented = true; } }; for (const f of [...ls]) f(e); return e; };
  return { doc, press };
}
async function twoPieces() {
  const s = await createCoreShell({ brushFn: null }), P = page(); let saves = 0;
  bindKeys(P.doc, s, { save: () => { saves++; } });
  s.extend({ length: 200 }); s.extend({ length: 300 });
  return { s, P, saves: () => saves, text: () => D.serialize(s.getState().history.present), n: () => s.getState().history.present.pieces.length };
}

test('Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z act on the TRACK with the focus in a NUMBER field, and the field\'s own text-undo is stopped', async () => {
  const { s, P, text, n } = await twoPieces(), two = text(), num = el('input', 'number');
  const e = P.press('z', { ctrlKey: true }, num);
  assert.deepEqual([e.prevented, n()], [true, 1], 'undo from a number field (and preventDefault, so the browser does not also undo the typing)');
  P.press('y', { ctrlKey: true }, num); assert.equal(text(), two, 'Ctrl+Y redoes from it');
  P.press('z', { ctrlKey: true }, num); P.press('Z', { ctrlKey: true, shiftKey: true }, num); assert.equal(text(), two, 'Ctrl+Shift+Z redoes from it');
  P.press('z', { metaKey: true }, num); assert.equal(n(), 1, 'Cmd+Z too');
  void s;
});

test('the same from a checkbox and a select', async () => {
  for (const target of [el('input', 'checkbox'), el('select')]) {
    const { P, n } = await twoPieces();
    assert.equal(P.press('z', { ctrlKey: true }, target).prevented, true); assert.equal(n(), 1, target.tagName);
  }
});

test('a TEXT-ENTRY field (the track name, the share code box) keeps Ctrl+Z / Ctrl+Y for its own text: the track is untouched', async () => {
  for (const target of [el('input'), el('input', 'text'), el('textarea'), el('input', 'search')]) {
    const { P, text } = await twoPieces(), two = text();
    for (const [k, m] of [['z', { ctrlKey: true }], ['y', { ctrlKey: true }], ['Z', { ctrlKey: true, shiftKey: true }]]) assert.equal(P.press(k, m, target).prevented, false, `${k} in ${target.tagName} ${target.type}`);
    assert.equal(text(), two);
  }
});

test('Ctrl+Backspace and Ctrl+S in ANY field stay the field\'s (a word is deleted, the head is NOT), and outside a field they still act', async () => {
  for (const target of [el('input', 'number'), el('input'), el('textarea'), el('select')]) {
    const { P, n, saves } = await twoPieces();
    assert.equal(P.press('Backspace', { ctrlKey: true }, target).prevented, false); assert.equal(n(), 2, `head kept in ${target.tagName} ${target.type}`);
    assert.equal(P.press('s', { ctrlKey: true }, target).prevented, false); assert.equal(saves(), 0);
  }
  const { P, n, saves } = await twoPieces();
  P.press('Backspace', { ctrlKey: true }, BODY); assert.equal(n(), 1, 'Ctrl+Backspace outside a field removes the head, as before');
  P.press('s', { ctrlKey: true }, BODY); assert.equal(saves(), 1, 'Ctrl+S outside a field saves, as before');
});

test('keyAction: a caller that passes no inText (app/shell.js\'s own tests) keeps the OLD rule, any field keeps every key', () => {
  for (const k of ['z', 'y', 's', 'backspace']) assert.equal(keyAction({ key: k, ctrlKey: true, inField: true }), null, k);
  assert.equal(keyAction({ key: 'z', ctrlKey: true, inField: true, inText: false }), 'undo');
  assert.equal(keyAction({ key: 'z', ctrlKey: true, shiftKey: true, inField: true, inText: false }), 'redo');
  assert.equal(keyAction({ key: 'backspace', ctrlKey: true, inField: true, inText: false }), null);
  assert.equal(keyAction({ key: 'z' }), null, 'no Ctrl, no action');
});

test('the Undo and Redo buttons name their keys in their tooltips', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'panel.js'), 'utf8');
  assert.match(src, /text: 'Undo', title: 'Undo \(Ctrl\+Z\)[^']*'/);
  assert.match(src, /text: 'Redo', title: 'Redo \(Ctrl\+Y or Ctrl\+Shift\+Z\)'/);
});
