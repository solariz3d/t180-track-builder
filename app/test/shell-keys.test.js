// shell-keys.test.js: node --test app/test/*.test.js
// The app's keys, as a pure mapping from a key event to an action (app/shell.js keyAction). Backspace alone does
// NOTHING: removing the head takes Ctrl+Backspace (B's read: a bare Backspace removed the head by accident).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { keyAction } = require('../shell.js');

const k = (key, mods = {}) => keyAction({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, inField: false, ...mods });

test('a bare Backspace does nothing; Ctrl+Backspace removes the head', () => {
  assert.equal(k('Backspace'), null);
  assert.equal(k('Backspace', { ctrlKey: true }), 'removeHead');
  assert.equal(k('Backspace', { metaKey: true }), 'removeHead');
});

test('Delete alone does nothing either: no single key removes track', () => {
  assert.equal(k('Delete'), null);
});

test('undo, redo and save keep their usual keys', () => {
  assert.equal(k('z', { ctrlKey: true }), 'undo');
  assert.equal(k('Z', { ctrlKey: true, shiftKey: true }), 'redo');
  assert.equal(k('y', { ctrlKey: true }), 'redo');
  assert.equal(k('s', { ctrlKey: true }), 'save');
});

test('while typing in a field, no key reaches the track, Ctrl+Backspace included', () => {
  for (const [key, m] of [['Backspace', { ctrlKey: true }], ['z', { ctrlKey: true }], ['Backspace', {}]]) assert.equal(k(key, { ...m, inField: true }), null, key);
});

test('letters without Ctrl are left to the panels (the cameras use them)', () => {
  for (const key of ['z', 'y', 's', 'c', 'w']) assert.equal(k(key), null, key);
});
