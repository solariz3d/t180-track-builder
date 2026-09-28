// texmaker-panel.test.js: node --test --test-concurrency=4 app/test/texmaker-panel.test.js. The texture maker's editor
// (app/texmaker/model.js) headless, and its panel (app/texmaker/index.js) against a small stand-in DOM. Stated first:
//   · every accepted edit changes the canonical text; a bad edit changes nothing and says why (the maker's own code);
//   · add, remove and move layers; load a text; the swatch is makeTexture of the current texture;
//   · the panel draws one list item per layer with one control per parameter, draws the swatch, shows the text, and on an
//     accepted edit calls onChange with the new text and sends 't180-texmaker-change'; a refused edit sends nothing.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const { createEditor } = require(path.join(ADIR, 'texmaker', 'model.js'));
const { mount } = require(path.join(ADIR, 'texmaker', 'index.js'));
const T = require('../../src/texmaker/index.js');

test('editor: an accepted edit changes the canonical text; a bad one changes nothing and names its reason', () => {
  const ed = createEditor('lanes'), before = ed.text();
  assert.equal(ed.set(3, 'dashes', 6), true); assert.match(ed.text(), /"dashes": 6,/); assert.equal(ed.message(), null);
  const after = ed.text();
  assert.equal(ed.set(3, 'dashes', -1), false); assert.equal(ed.text(), after); assert.match(ed.message(), /^BAD_PARAM: layers\[3\]\.dashes/);
  assert.equal(ed.set(3, 'glitter', 1), false); assert.match(ed.message(), /^UNKNOWN_KEY/);
  assert.notEqual(before, after);
});
test('editor: add, move and remove layers; load a text (a bad text is refused and the texture kept)', () => {
  const ed = createEditor('asphalt'), n = ed.texture().layers.length;
  ed.addLayer('stripes'); assert.equal(ed.texture().layers.length, n + 1); assert.equal(ed.texture().layers[n].type, 'stripes');
  ed.moveLayer(n, -1); assert.equal(ed.texture().layers[n - 1].type, 'stripes');
  assert.equal(ed.moveLayer(0, -1), false, 'the first layer cannot move up');
  ed.removeLayer(n - 1); assert.equal(ed.texture().layers.length, n);
  assert.equal(ed.addLayer('plasma'), false); assert.match(ed.message(), /^UNKNOWN_LAYER/);
  const rainbow = T.serialize(T.PRESETS.rainbow);
  assert.equal(ed.load(rainbow), true); assert.equal(ed.text(), rainbow);
  assert.equal(ed.load('{nope'), false); assert.equal(ed.text(), rainbow); assert.match(ed.message(), /^BAD_TEXT/);
});
test('editor: the swatch is makeTexture of the current texture, byte for byte', () => {
  const ed = createEditor('neon-night'), s = ed.swatch(64), m = T.makeTexture(T.PRESETS['neon-night'], 64, 64);
  assert.equal(Buffer.compare(Buffer.from(s.rgba), Buffer.from(m.rgba)), 0);
});

/** A small stand-in DOM: elements with attributes, children, text, value and listeners; enough for the panel. */
function fakeDom() {
  const events = [];
  const make = (tag) => {
    const e = { tag, attrs: {}, children: [], listeners: {}, textContent: '', value: '', checked: false,
      setAttribute(k, v) { this.attrs[k] = v; if (k === 'value') this.value = v; if (k === 'checked') this.checked = true; },
      append(...k) { this.children.push(...k); }, replaceChildren(...k) { this.children = k; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      fire(t) { for (const f of this.listeners[t] || []) f({ target: this }); },
      getContext: () => ({ putImageData(img) { e.drawn = img; } }) };
    return e;
  };
  const win = { ImageData: class { constructor(data, w, h) { this.data = data; this.width = w; this.height = h; } }, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o.detail; } } };
  const doc = { defaultView: win, createElement: make, dispatchEvent: (ev) => events.push(ev) };
  const root = make('div'); root.ownerDocument = doc;
  return { root, events };
}
const all = (e, out = []) => { out.push(e); for (const c of e.children || []) if (c && typeof c === 'object') all(c, out); return out; };

test('panel: one item per layer with one control per parameter, the swatch drawn, and the text shown', () => {
  const { root } = fakeDom(), p = mount(root, { start: 'lanes', swatchSize: 32 });
  const els = all(root), items = els.filter((e) => e.tag === 'li');
  assert.equal(items.length, T.PRESETS.lanes.layers.length);
  items.forEach((li, i) => { const labels = all(li).filter((e) => e.tag === 'label'); assert.equal(labels.length, T.LAYERS[T.PRESETS.lanes.layers[i].type].length); });
  const canvas = els.find((e) => e.tag === 'canvas');
  assert.ok(canvas.drawn && canvas.drawn.width === 32 && canvas.drawn.data.length === 32 * 32 * 4, 'the swatch is drawn');
  assert.equal(els.find((e) => e.tag === 'textarea').value, p.editor.text());
});
test('panel: an accepted edit calls onChange with the new text and sends t180-texmaker-change; a refused edit sends nothing', () => {
  const { root, events } = fakeDom(), seen = [];
  const p = mount(root, { start: 'asphalt', swatchSize: 16, onChange: (t) => seen.push(t) });
  const input = all(root).filter((e) => e.tag === 'input' && e.attrs.type === 'number')[0];   // the first number: layer 0's amount
  input.value = '0.5'; input.fire('change');
  assert.equal(seen.length, 1); assert.match(seen[0], /"amount": 0\.5,/);
  assert.equal(events.length, 1); assert.equal(events[0].type, 't180-texmaker-change'); assert.equal(events[0].detail.text, seen[0]);
  const again = all(root).filter((e) => e.tag === 'input' && e.attrs.type === 'number')[0];
  again.value = '7'; again.fire('change');   // out of range: refused
  assert.equal(seen.length, 1, 'no change sent for a refused edit');
  assert.match(all(root).find((e) => e.tag === 'p').textContent, /^BAD_PARAM/);
  p.unmount(); assert.equal(root.children.length, 0);
});
