// index.js: the texture maker's panel (ARCHITECTURE §5b "Make your own: a texture maker inside the program"): the layer
// list with each layer's parameters, a live preview swatch, and the texture's canonical text.
//
//   const panel = mount(root, { start, onChange, swatchSize })
//       start       a texture text, object or preset name (default 'asphalt')
//       onChange    called with the canonical text after every accepted edit (A's slot keeps it, §5b "a texture is also
//                   text"); also sent as the document event 't180-texmaker-change' { detail: { text } }
//   panel.editor    the editor (app/texmaker/model.js)      panel.unmount()
//
// WHERE A MOUNTS IT (proposed, A's files): the texture panel (app/texture/panel.js) gives each slot a "Make…" button that
// opens this panel on the slot's current maker text (or a preset), and on change stores the text in the slot and renders
// it with makeTexture(text, w, h) into the same { width, height, rgba } path its PNG/JPG import already takes to DDS.
// Nothing crosses IPC: the maker runs in the UI process, like the geometry.
'use strict';

const { createEditor } = require('./model.js');
const T = require('../../src/texmaker/index.js');

function mount(root, { start = 'asphalt', onChange = null, swatchSize = 256 } = {}) {
  const doc = root.ownerDocument, win = doc.defaultView, ed = createEditor(start);
  const el = (tag, attrs = {}, kids = []) => { const e = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); } for (const c of kids) if (c) e.append(c); return e; };
  const canvas = el('canvas', { width: String(swatchSize), height: String(swatchSize), 'aria-label': 'texture preview' });
  const list = el('ol', { class: 'texmaker-layers' }), msg = el('p', { class: 'message', role: 'status' });
  const textBox = el('textarea', { rows: '10', spellcheck: 'false', 'aria-label': 'texture text' });
  const presetPick = el('select', { 'aria-label': 'preset', onchange: (e) => { if (T.PRESETS[e.target.value]) ed.load(T.serialize(T.PRESETS[e.target.value])); } }, [el('option', { value: '', text: 'Start from…' }), ...Object.keys(T.PRESETS).map((k) => el('option', { value: k, text: k }))]);
  const addPick = el('select', { 'aria-label': 'add a layer', onchange: (e) => { if (e.target.value) ed.addLayer(e.target.value); e.target.value = ''; } }, [el('option', { value: '', text: 'Add a layer…' }), ...ed.types().map((t) => el('option', { value: t, text: t }))]);
  const apply = el('button', { type: 'button', text: 'Apply text', onclick: () => ed.load(textBox.value) });
  root.append(el('div', { class: 'texmaker' }, [el('div', {}, [presetPick, addPick]), canvas, list, msg, textBox, apply]));

  /** One control per parameter, from the maker's own schema; each change goes through the editor's checks. */
  function control(i, l, key, spec) {
    const set = (v) => ed.set(i, key, v), v = l[key];
    if (spec.kind === 'enum') return el('select', { onchange: (e) => set(e.target.value) }, spec.values.map((o) => { const op = el('option', { value: o, text: o }); if (o === v) op.setAttribute('selected', ''); return op; }));
    if (spec.kind === 'bool') { const c = el('input', { type: 'checkbox', onchange: (e) => set(e.target.checked) }); if (v) c.setAttribute('checked', ''); return c; }
    if (spec.kind === 'colour') return el('input', { type: 'text', value: v, size: '9', onchange: (e) => set(e.target.value) });
    if (spec.kind === 'point' || spec.kind === 'size2' || spec.kind === 'stops') return el('input', { type: 'text', value: JSON.stringify(v), onchange: (e) => { try { set(JSON.parse(e.target.value)); } catch (err) { set(e.target.value); } } });
    const step = spec.kind === 'int' ? '1' : '0.001';
    return el('input', { type: 'number', value: String(v), step, onchange: (e) => set(Number(e.target.value)) });
  }
  function draw() {
    const t = ed.texture();
    list.replaceChildren(...t.layers.map((l, i) => el('li', {}, [
      el('strong', { text: l.type }),
      el('button', { type: 'button', text: '↑', title: 'move up', onclick: () => ed.moveLayer(i, -1) }),
      el('button', { type: 'button', text: '↓', title: 'move down', onclick: () => ed.moveLayer(i, 1) }),
      el('button', { type: 'button', text: '×', title: 'remove', onclick: () => ed.removeLayer(i) }),
      ...T.LAYERS[l.type].map(([key, spec]) => el('label', {}, [el('span', { text: key }), control(i, l, key, spec)])),
    ])));
    msg.textContent = ed.message() || '';
    textBox.value = ed.text();
    const img = ed.swatch(swatchSize), ctx = canvas.getContext && canvas.getContext('2d');
    if (ctx && win.ImageData) ctx.putImageData(new win.ImageData(new Uint8ClampedArray(img.rgba.buffer.slice(0)), img.width, img.height), 0, 0);
  }
  let last = ed.text();
  const unsub = ed.subscribe(() => {
    draw();
    const now = ed.text();
    if (now !== last && !ed.message()) { last = now; if (onChange) onChange(now); doc.dispatchEvent(new win.CustomEvent('t180-texmaker-change', { detail: { text: now } })); }
  });
  draw();
  return { editor: ed, unmount() { unsub(); root.replaceChildren(); } };
}

module.exports = { mount };
