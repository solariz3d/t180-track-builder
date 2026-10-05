// undo-guard.test.js: node --test app/test/undo-guard.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D240 follow-up, from B's look at ab748e5 (p-keys-B_2026-10-05.md:56) and C's open question (p-keys-C_2026-10-05.md): a number typed into an Extend field and NOT Extended is lost by the
// first Ctrl+Z, which refills the fields AND steps the track. The guard: while a field holds such an un-applied edit, the first Ctrl+Z puts THAT field back and does not step the track;
// the next Ctrl+Z undoes the track. FEEL tier: targeted rows on a fake DOM, the real keys.js bindKeys and the real panel. Rows:
//   1  a typed length, un-extended: Ctrl+Z reverts the field, the track stays; the next Ctrl+Z undoes the track
//   2  a typed head field (turn), the same; the field returns to what the panel showed
//   3  the focus is elsewhere (the body): the field touched last is the one put back
//   4  a field typed back to what it showed holds nothing un-applied: Ctrl+Z undoes the track at once
//   5  what Extend applied is not un-applied, and neither is what an Undo refills (D242 item 7): successive Ctrl+Z steps the track back each time
//   6  Ctrl+Y and Ctrl+Shift+Z are not guarded; a text-entry field keeps its own Ctrl+Z (nothing asked of the panel); no panel: Ctrl+Z undoes the track as before
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bindKeys } = require('../core/keys.js');
const { createCoreShell } = require('../core/coreshell.js');

class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.disabled = false; this.clientWidth = 0; this.clientHeight = 0; this.isContentEditable = false; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.ownerDocument.ids[v] = this; }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return !!e.isRoot; }
  get offsetWidth() { return this.isConnected ? 9 * Math.max(...this.textContent.split('\n').map((l) => l.length)) + 16 : 0; }
  get offsetHeight() { return this.isConnected ? 20 * this.textContent.split('\n').length + 8 : 0; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
  /** The selector LISTS keys.js asks, as a browser answers them: `tag`, `tag:not([type])`, `tag[type="x"]`. */
  matches(list) {
    const type = this.attrs.type, tag = this.tagName.toLowerCase();
    return list.split(',').some((sel) => { const m = /^([a-z]+)(?::not\(\[type\]\)|\[type="([a-z]+)"\])?$/.exec(sel.trim()); if (!m || m[1] !== tag) return false; if (sel.includes(':not([type])')) return type === undefined; if (m[2] !== undefined) return type === m[2]; return true; });
  }
}
async function page() {
  const doc = { ids: {}, listeners: {}, activeElement: null, createElement: (t) => new El(t, doc) };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {} };
  doc.defaultView = win;
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.isRoot = true;
  const shell = await createCoreShell({ brushFn: null, autosaveMs: 0 }); shell.extend({ length: 200 }); shell.extend({ length: 300 });
  const root = doc.createElement('div'), panel = require('../core/panel.js').mount(root, shell);
  bindKeys(doc, shell, { save: () => {} });
  const field = (label) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === label).children[1];
  const press = (key, mods, target) => { const e = { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods, target: target || { matches: () => false, isContentEditable: false }, prevented: false, preventDefault() { this.prevented = true; } }; for (const f of (doc.listeners.keydown || []).slice()) f(e); return e; };
  const type = (f, v) => { f.value = String(v); f.oninput(); doc.activeElement = f; };
  const n = () => shell.getState().history.present.pieces.length;
  return { doc, shell, root, panel, field, press, type, n, button: (t) => root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === t) };
}
const CTRL_Z = { ctrlKey: true };

test('row 1: a typed length that was never Extended: the first Ctrl+Z puts the field back and leaves the track; the next Ctrl+Z undoes the track', async () => {
  const P = await page(), len = P.field('length m'), was = len.value; assert.equal(P.n(), 2);
  P.type(len, 123); const e = P.press('z', CTRL_Z, len);
  assert.equal(len.value, was, 'the field is back'); assert.equal(P.n(), 2, 'the track was not stepped'); assert.equal(e.prevented, true, 'the field\'s own text-undo is still stopped');
  P.press('z', CTRL_Z, len); assert.equal(P.n(), 1, 'the next Ctrl+Z undoes the track');
});

test('row 2: a typed head field (turn) the same: it returns to what the panel showed, the track stays, then the next Ctrl+Z undoes the track', async () => {
  const P = await page(), turn = P.field('turn °/100m'), shown = turn.value;
  P.type(turn, 7); assert.notEqual(turn.value, shown); P.press('z', CTRL_Z, turn);
  assert.equal(turn.value, shown, 'back to what the panel showed'); assert.equal(P.n(), 2);
  P.press('z', CTRL_Z, turn); assert.equal(P.n(), 1);
});

test('row 3: with the focus off the field (the page body), the field touched last is the one put back', async () => {
  const P = await page(), bank = P.field('bank °'), shown = bank.value;
  P.type(bank, 12); P.doc.activeElement = null;   // the focus moved on
  P.press('z', CTRL_Z); assert.equal(bank.value, shown); assert.equal(P.n(), 2, 'the track was not stepped');
  P.press('z', CTRL_Z); assert.equal(P.n(), 1);
});

test('row 4: a field typed back to what it showed holds nothing un-applied: Ctrl+Z undoes the track at once', async () => {
  const P = await page(), turn = P.field('turn °/100m'), shown = turn.value;
  P.type(turn, 9); P.type(turn, shown); P.press('z', CTRL_Z, turn); assert.equal(P.n(), 1, 'nothing un-applied: the track is stepped');
});

test('row 5: what Extend applied is not un-applied, and neither is what an Undo refills: Ctrl+Z steps the track back each time', async () => {
  const P = await page(), len = P.field('length m');
  P.type(len, 150); P.button('Extend').onclick(); assert.equal(P.n(), 3); assert.equal(len.value, '150', 'the length stays as typed');
  P.press('z', CTRL_Z, len); assert.equal(P.n(), 2, 'the Extended length is applied: Ctrl+Z steps the track'); assert.equal(len.value, '150', 'D242 item 7: Undo refills the fields with the undone piece\'s own values');
  P.press('z', CTRL_Z, len); assert.equal(P.n(), 1, 'and the refill is not un-applied either: the next Ctrl+Z steps the track again');
  const turn = P.field('turn °/100m'); P.type(turn, 5); P.press('z', CTRL_Z, turn); assert.equal(P.n(), 1, 'a fresh typed value is guarded again'); P.press('z', CTRL_Z, turn); assert.equal(P.n(), 0);
});

test('row 6: Ctrl+Y and Ctrl+Shift+Z are not guarded; a text-entry field keeps its own Ctrl+Z and asks nothing of the panel; with no panel Ctrl+Z undoes the track as before', async () => {
  const P = await page(), len = P.field('length m'), was = len.value; P.press('z', CTRL_Z, len); assert.equal(P.n(), 1);   // nothing typed: the track steps
  P.type(len, 77); P.press('y', { ctrlKey: true }, len); assert.equal(P.n(), 2, 'Ctrl+Y redoes the track, the typing untouched'); assert.equal(len.value, '77');
  P.press('z', CTRL_Z, len); assert.equal(P.n(), 2); assert.equal(len.value, was, 'Ctrl+Z reverts the field'); P.press('z', CTRL_Z, len); assert.equal(P.n(), 1);
  P.type(len, 88); P.press('z', { ctrlKey: true, shiftKey: true }, len); assert.equal(P.n(), 2, 'Ctrl+Shift+Z redoes'); assert.equal(len.value, '88');
  const name = P.doc.createElement('input'); let asked = 0; P.doc.addEventListener('t180-undo-guard', () => { asked++; });
  P.press('z', CTRL_Z, name); assert.equal(asked, 0, 'a text-entry field keeps its own undo: the panel is not asked'); assert.equal(P.n(), 2);
  P.panel.unmount(); P.type(len, 99); P.press('z', CTRL_Z, len); assert.equal(P.n(), 1, 'a panel that is gone guards nothing');
  const bare = { addEventListener() {}, removeEventListener() {} }; const calls = []; let handler; bare.addEventListener = (t, f) => { handler = f; };
  bindKeys(bare, { undo: () => calls.push('undo'), redo() {}, removeHead() {} }, { save() {} }); handler({ key: 'z', ctrlKey: true, target: { matches: () => false }, preventDefault() {} }); assert.deepEqual(calls, ['undo'], 'a document that cannot dispatch: Ctrl+Z undoes the track');
});
