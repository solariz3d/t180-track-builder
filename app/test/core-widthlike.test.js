// core-widthlike.test.js: node --test app/test/core-widthlike.test.js
// D232: the "width like…" drop-down beside Extend's width field (app/core/widthlike.js, mounted by app/core/panel.js). The keeper: "a drop down that tells you
// the width of different known t-180 tracks, such as thunderhead, aurora, nordic". The entries, the tube's round-and-across wording, and the PANEL mounted on a
// small fake DOM (the readout tests' own), read back as the text and the options it shows.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WL = require('../core/widthlike.js');
const W = require('../../src/doc/widths.json');
const { createCoreShell } = require('../core/coreshell.js');

class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.parent = null; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.ownerDocument.ids[v] = this; }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth || 0, height: this.clientHeight || 0 }; }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return !!e.isRoot; }
  get offsetWidth() { return this.isConnected ? 9 * Math.max(...this.textContent.split('\n').map((l) => l.length)) + 16 : 0; }
  get offsetHeight() { return this.isConnected ? 20 * this.textContent.split('\n').length + 8 : 0; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
}
function fakeWindow() {
  const doc = { ids: {}, listeners: {}, createElement: (t) => new El(t, doc) };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {} };
  doc.defaultView = win; return { doc, win };
}
async function mountPanel(prep = () => {}) {
  const { doc } = fakeWindow(), stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 900; stage.clientHeight = 600; stage.isRoot = true;
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null }); prep(shell);
  const panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const field = (text) => label(text).children[1];
  const like = () => root.all().find((e) => e.attrs['aria-label'] === 'width like a known T-180 track');
  const note = () => root.all().find((e) => e.attrs['aria-label'] === 'what the width means for a tube');
  const pick = (name) => { const s = like(), o = s.children.find((c) => c.textContent.startsWith(`${name},`)); assert.ok(o, `an entry for ${name}`); s.value = o.value; s.onchange(); };
  return { root, shell, panel, label, field, like, note, pick, labels: () => like().children.map((c) => c.textContent) };
}

test('the entries: "Thunderhead, 24 m (21–28)", narrowest first, one per known track, a placeholder first, and a pick is the median as text', () => {
  const e = WL.entries(false);
  assert.equal(e.length, W.tracks.filter((t) => t.read_closes).length + 1, 'one per known track whose read closes, and the placeholder'); assert.deepEqual([e[0].value, e[0].label], ['', 'width like…']);
  const th = e.find((x) => x.label.startsWith('Thunderhead,')); assert.equal(th.label, 'Thunderhead, 24 m (21–28)'); assert.equal(th.value, '24');
  assert.equal(e.find((x) => x.label.startsWith('Nordic,')).label, 'Nordic, 38 m (29–53)'); assert.equal(e.find((x) => x.label.startsWith('Aurora Cryopticon (medium),')).label, 'Aurora Cryopticon (medium), 34 m (32–56)');
  assert.equal(e.filter((x) => /Aurora/.test(x.label)).length, 1, 'Aurora shows once');
  assert.equal(e.find((x) => x.label.startsWith('Rainbow Road,')).label, 'Rainbow Road, 45 m (35–90)', 'a swinging width keeps its wide band in the label');
  const m = e.slice(1).map((x) => Number(x.value)); assert.deepEqual(m, m.slice().sort((a, b) => a - b));
});

test('CLOSED ONLY: a track whose read did not close is in the file but never offered, in either wording: the real ones (Miandros, Aurora Cryopticon (long)) and a synthetic one', () => {
  const unclosed = W.tracks.filter((t) => t.read_closes === false).map((t) => t.name).sort(); assert.deepEqual(unclosed, ['Aurora Cryopticon (long)', 'Miandros'], 'control: the file keeps them');
  for (const tube of [false, true]) {
    const labels = WL.entries(tube).map((x) => x.label); for (const n of unclosed) assert.ok(!labels.some((l) => l.startsWith(`${n},`)), `${n} is not offered (tube ${tube})`);
    assert.equal(labels.length, W.tracks.length - unclosed.length + 1);
  }
  const mine = [{ name: 'Closed One', median_m: 30, p10_m: 28, p90_m: 33, stations: 9, read_closes: true }, { name: 'Open One', median_m: 99, p10_m: 90, p90_m: 120, stations: 9, read_closes: false }, { name: 'No Flag', median_m: 31, p10_m: 29, p90_m: 34, stations: 9 }];
  assert.deepEqual(WL.entries(false, mine).map((x) => x.label), ['width like…', 'Closed One, 30 m (28–33)', 'No Flag, 31 m (29–34)'], 'a read flagged read_closes: false is never offered; one with no flag is');
  assert.ok(!WL.entries(true, mine).some((x) => /Open One/.test(x.label)));
});

test('a TUBE (sweep 360): the figures are the distance ROUND, each entry says how wide that is across (w/π), and the note says w is round the tube', () => {
  assert.ok(WL.isTube('360') && WL.isTube(360) && WL.isTube('361') && !WL.isTube('359.9') && !WL.isTube('') && !WL.isTube('abc') && !WL.isTube(null));
  const e = WL.entries(true); assert.equal(e[0].label, 'width like… (m round)', 'short enough for the select\'s own box (D235: the longer wording clipped at 204 px against 190)');
  assert.equal(e.find((x) => x.label.startsWith('Thunderhead,')).label, 'Thunderhead, 24 m round (21–28), a tube 7.6 m across');
  assert.equal(e.find((x) => x.label.startsWith('Nordic,')).label, 'Nordic, 38 m round (29–53), a tube 12.1 m across');
  assert.equal(WL.across(31), '9.9'); assert.equal(WL.tubeNote(31), '≈ 9.9 m across', 'D267: a few words under the field'); assert.equal(WL.tubeTip(31), "A tube's width is the distance ROUND it, not across. 31 m round is a tube 9.9 m across (w/π).", 'and the explanation is the tooltip');
  assert.equal(WL.tubeNote(''), ''); assert.equal(WL.tubeNote('abc'), ''); assert.equal(WL.tubeTip(''), "A tube's width is the distance ROUND it, not across."); assert.equal(WL.tubeTip('abc').includes('across ('), false);
});

test('the PANEL: the drop-down sits beside the width field, lists the known tracks, and a pick types the median into the width (the ghost and the readout follow)', async () => {
  const P = await mountPanel(), sel = P.like();
  assert.ok(sel && sel.tagName === 'SELECT', 'a select'); assert.equal(P.labels()[0], 'width like…'); assert.ok(P.labels().includes('Thunderhead, 24 m (21–28)'));
  assert.equal(P.labels().length, W.tracks.filter((t) => t.read_closes).length + 1); assert.ok(!P.labels().some((l) => /Miandros|Aurora Cryopticon \(long\)/.test(l)), 'the panel offers no track whose read does not close'); assert.equal(P.note().textContent, '', 'no tube note on a plain road');
  assert.ok(P.label('width like…'), 'its own labelled row, right after the width m field');
  const rows = P.root.all().filter((e) => e.tagName === 'LABEL' && e.children[0]).map((e) => e.children[0].textContent), wi = rows.indexOf('width m'); assert.equal(rows[wi + 1], 'width like…');
  P.pick('Thunderhead'); assert.equal(P.field('width m').value, '24'); assert.equal(sel.value, '', 'the select goes back to its placeholder, so the same entry can be picked again');
  assert.equal(P.panel.options().first && P.panel.options().first.w, 24, 'on an empty track a typed width is the first piece\'s start: the new-track default');
  P.field('length m').value = '100';   // the fake DOM keeps a field's value property apart from its value attribute (the readout tests type the length too)
  P.shell.extend(P.panel.options()); assert.equal(P.shell.getState().message, null); assert.equal(P.shell.getState().history.present.pieces[0].channels.w[0], 24, 'the first piece Extend added starts at that width');
  P.pick('Nordic'); assert.equal(P.field('width m').value, '38'); const o = P.panel.options(); assert.equal(o.targets.w, 38, 'on a track that exists a pick is a width target');
  assert.equal(o.first, undefined);
});

test('the PANEL on a tube: the sweep at 360 turns the entries to round-and-across and shows the note; back below 360 they read plain again; the note follows the width', async () => {
  const P = await mountPanel();
  assert.equal(P.note().textContent, ''); P.field('tube sweep °').value = '360'; P.field('tube sweep °').oninput();
  assert.equal(P.labels()[0], 'width like… (m round)'); assert.ok(P.labels().includes('Thunderhead, 24 m round (21–28), a tube 7.6 m across'));
  assert.match(P.note().textContent, /^≈ \d+\.\d m across$/, 'D267: a few words'); assert.match(P.note().attrs.title, /^A tube's width is the distance ROUND it, not across\./, 'the explanation is its tooltip');
  P.pick('Nordic'); assert.equal(P.field('width m').value, '38'); assert.equal(P.note().textContent, '≈ 12.1 m across'); assert.match(P.note().attrs.title, /38 m round is a tube 12\.1 m across \(w\/π\)\./, 'the tooltip follows the width');
  P.field('width m').value = '31'; P.field('width m').oninput(); assert.equal(P.note().textContent, '≈ 9.9 m across'); assert.match(P.note().attrs.title, /31 m round is a tube 9\.9 m across/);
  P.field('tube sweep °').value = '200'; P.field('tube sweep °').oninput(); assert.equal(P.labels()[0], 'width like…'); assert.equal(P.note().textContent, '');
});

test('the PANEL at a tube head: the sweep field SHOWS the head\'s 360, so the entries read round and across with nothing typed', async () => {
  const P = await mountPanel((shell) => { shell.extend({ length: 100, first: { t: 360 } }); });
  assert.equal(P.field('tube sweep °').value, '360'); assert.ok(P.labels().includes('Thunderhead, 24 m round (21–28), a tube 7.6 m across')); assert.match(P.note().textContent, /^≈ \d+\.\d m across$/); assert.match(P.note().attrs.title, /ROUND/);
});
