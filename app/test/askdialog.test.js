// app/test/askdialog.test.js: the question asked inside the page (app/askdialog.js). node --test app/test/askdialog.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { askChoice } = require('../askdialog.js');

class El {
  constructor(tag, doc) { this.tag = tag; this.doc = doc; this.children = []; this.parentNode = null; this.textContent = ''; this.className = ''; this.attrs = {}; this.onclick = null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; } }
  setAttribute(k, v) { this.attrs[k] = v; }
  focus() { this.doc.activeElement = this; }
  all() { return [this, ...this.children.flatMap((c) => c.all())]; }
}
function fakeDoc() {
  const doc = { listeners: [], activeElement: null };
  doc.createElement = (t) => new El(t, doc);
  doc.body = new El('body', doc);
  doc.addEventListener = (type, f) => doc.listeners.push(f);
  doc.removeEventListener = (type, f) => { doc.listeners = doc.listeners.filter((g) => g !== f); };
  doc.key = (key) => { const e = { key, preventDefault() {}, stopped: false, stopPropagation() { this.stopped = true; } }; doc.listeners.slice().forEach((f) => f(e)); return e; };
  doc.buttons = () => doc.body.all().filter((e) => e.tag === 'button');
  doc.open = () => doc.body.children.length > 0;
  return doc;
}
const SAVE = { title: 'Save before closing?', message: 'unsaved', cancelValue: 'cancel',
  buttons: [{ label: "Don't save", value: 'discard', kind: 'quiet' }, { label: 'Cancel', value: 'cancel' }, { label: 'Save', value: 'save', kind: 'main', default: true }] };

test('the pressed button is the answer, and the card is gone after it', async () => {
  const doc = fakeDoc(), p = askChoice(doc, SAVE);
  assert.ok(doc.open()); assert.deepEqual(doc.buttons().map((b) => b.textContent), ["Don't save", 'Cancel', 'Save']);
  doc.buttons()[0].onclick({ stopPropagation() {} });
  assert.equal(await p, 'discard'); assert.equal(doc.open(), false); assert.equal(doc.listeners.length, 0);
});

test('Enter presses the default button (Save), which has the focus when the card opens', async () => {
  const doc = fakeDoc(), p = askChoice(doc, SAVE);
  assert.equal(doc.activeElement.textContent, 'Save');
  doc.activeElement = null; doc.key('Enter');
  assert.equal(await p, 'save');
});

test('Escape and a click on the dimmed page both answer cancel', async () => {
  const d1 = fakeDoc(), p1 = askChoice(d1, SAVE); d1.key('Escape'); assert.equal(await p1, 'cancel');
  const d2 = fakeDoc(), p2 = askChoice(d2, SAVE); const veil = d2.body.children[0]; veil.onclick({ target: veil }); assert.equal(await p2, 'cancel');
});

test('a click on the card itself does not dismiss it', async () => {
  const doc = fakeDoc(), p = askChoice(doc, SAVE); const veil = doc.body.children[0];
  veil.onclick({ target: veil.children[0] }); assert.ok(doc.open());
  doc.key('Escape'); await p;
});

test('the builder\'s keys do not reach the page behind the question', async () => {
  const doc = fakeDoc(), p = askChoice(doc, SAVE);
  assert.equal(doc.key('w').stopped, true);
  doc.key('Escape'); await p;
});

test('a second ask while one is open gets the same answer and adds no second card', async () => {
  const doc = fakeDoc(), a = askChoice(doc, SAVE), b = askChoice(doc, SAVE);
  assert.equal(doc.body.children.length, 1);
  doc.key('Escape'); assert.equal(await a, 'cancel'); assert.equal(await b, 'cancel');
});

test('no document or no buttons is refused loudly, so the closer falls back to closing as before', async () => {
  await assert.rejects(askChoice(null, SAVE), /no document/);
  await assert.rejects(askChoice(fakeDoc(), { ...SAVE, buttons: [] }), /no buttons/);
});
