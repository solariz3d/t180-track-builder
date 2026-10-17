// app/test/layoutsdialog.test.js: File ▸ Export layouts…'s question (app/menubar/layoutsdialog.js). node --test app/test/layoutsdialog.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const LD = require('../menubar/layoutsdialog.js');

class El {
  constructor(tag, doc) { this.tag = tag; this.doc = doc; this.children = []; this.parentNode = null; this.textContent = ''; this.className = ''; this.attrs = {}; this.onclick = null; this.value = ''; this.checked = false; this.disabled = false; }
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
  doc.q = (cls) => doc.body.all().filter((e) => e.className.split(' ').includes(cls));
  doc.button = (label) => doc.body.all().find((e) => e.tag === 'button' && e.textContent === label);
  doc.problem = () => doc.q('lx-problem')[0].textContent;
  return doc;
}
const set = (el, v) => { el.value = v; el.oninput(); };
const tick = (el, on = true) => { el.checked = on; el.onchange(); };
const TRACKS = ['Elysium', 'Elysium Short', 'Other'];

test('defaults: a layout name from each track, its own name to show, the first marked main, the shared first word as the track name', () => {
  const d = LD.defaults(TRACKS);
  assert.deepEqual(d.rows.map((r) => [r.layout, r.display, r.main, r.use]), [['elysium', 'Elysium', true, false], ['elysium_short', 'Elysium Short', false, false], ['other', 'Other', false, false]]);
  assert.equal(d.name, 'Elysium');
  assert.equal(LD.commonName(['Elysium Long', 'Elysium Short']), 'Elysium');
  assert.equal(LD.commonName(['Alpha', 'Beta']), 'Alpha', 'nothing shared: the first name');
  assert.equal(LD.slug('Track #2 (Night)!'), 'track_2_night');
  assert.equal(LD.slug('***'), 'layout');
});

test('check: two or more tracks, each layout name a–z 0–9 _ and used once, each shown name filled in, one main among the picked', () => {
  const ok = (rows, name = 'Elysium') => LD.check({ name, rows });
  const row = (track, layout, display, main = false, use = true) => ({ track, layout, display, main, use });
  const good = [row('Elysium', 'long', 'Elysium Long', true), row('Elysium Short', 'short', 'Elysium Short')];
  assert.equal(ok(good).ok, true);
  assert.deepEqual(ok(good).picks, [{ track: 'Elysium', layout: 'long', name: 'Elysium Long', main: true }, { track: 'Elysium Short', layout: 'short', name: 'Elysium Short', main: false }]);
  assert.match(ok([good[0]]).problem, /at least two/);
  assert.match(ok(good, '  ').problem, /give the track a name/);
  assert.match(ok([good[0], { ...good[1], layout: 'Short Way' }]).problem, /not a layout name/);
  assert.match(ok([good[0], { ...good[1], layout: 'long' }]).problem, /used twice/);
  assert.match(ok([good[0], { ...good[1], display: ' ' }]).problem, /shown name/);
  assert.match(ok([{ ...good[0], main: false }, good[1]]).problem, /mark one/);
  assert.match(ok([{ ...good[0], main: false }, good[1], row('Other', 'other', 'Other', true, false)]).problem, /mark one/, 'the main one must be among the picked');
  assert.equal(ok([...good, row('Other', 'long', 'x', false, false)]).ok, true, 'a row that is not picked is not checked');
});

test('the card: Export stays off with the reason shown until the answer can be exported, then answers it', async () => {
  const doc = fakeDoc(), p = LD.askLayouts(doc, { tracks: TRACKS });
  const go = doc.button('Export…');
  assert.equal(go.disabled, true); assert.match(doc.problem(), /at least two/);
  const [use0, use1] = doc.q('lx-use'), lay = doc.q('lx-layout'), disp = doc.q('lx-display'), mains = doc.q('lx-main');
  tick(use0); tick(use1);
  assert.equal(go.disabled, false, doc.problem());
  set(lay[1], 'elysium'); assert.equal(go.disabled, true); assert.match(doc.problem(), /used twice/);
  set(lay[0], 'long'); set(lay[1], 'short'); set(disp[0], 'Elysium Long');
  tick(mains[1]);
  assert.equal(go.disabled, false);
  go.onclick();
  assert.deepEqual(await p, { name: 'Elysium', picks: [{ track: 'Elysium', layout: 'long', name: 'Elysium Long', main: false }, { track: 'Elysium Short', layout: 'short', name: 'Elysium Short', main: true }] });
  assert.equal(doc.body.children.length, 0, 'the card is gone'); assert.equal(doc.listeners.length, 0, 'and its key listener');
});

test('Escape or Cancel answers null; a click on a disabled Export answers nothing; the builder\'s keys do not act behind it', async () => {
  let doc = fakeDoc(), p = LD.askLayouts(doc, { tracks: TRACKS });
  doc.button('Export…').onclick(); assert.equal(doc.body.children.length, 1, 'not exportable: the card stays');
  assert.equal(doc.key('w').stopped, true);
  doc.key('Escape'); assert.equal(await p, null); assert.equal(doc.listeners.length, 0);
  doc = fakeDoc(); p = LD.askLayouts(doc, { tracks: TRACKS }); doc.button('Cancel').onclick(); assert.equal(await p, null);
  await assert.rejects(LD.askLayouts({}, { tracks: TRACKS }), /no document/);
});
