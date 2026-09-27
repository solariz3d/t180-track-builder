// index.js: the textures panel (ARCHITECTURE §5b, part 1), mounted as mount(root, shell) like every panel.
// MOUNT POINT: an element `<section id="textures">` in the side panel, and ['textures', 'texture'] in the page's list of
// panels loaded through app/lib/cjs.js (app/index.html).
//
// What it shows: a file picker for PNG/JPG (named from the file, editable), every added image with its size and
// warnings, the texture budget, and, for the selected word, its five slots: texture, tiling length, fit or tile, tile
// width, offset and direction. WHAT IT GIVES THE PREVIEW: after every update root dispatches a bubbling CustomEvent
// 't180:textures' with detail { set }, the one texture set (src/texture/set.js) the export also writes from.
'use strict';
const { createTextureController, nameFromFile } = require('./panel.js');
const { SLOTS, effectiveSlots } = require('../../src/doc/textures.js');

const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

function mount(root, shell) {
  const head = el('div', { className: 't-head' }), pick = el('input', { type: 'file', accept: '.png,.jpg,.jpeg,image/png,image/jpeg' });
  const name = el('input', { type: 'text', placeholder: 'texture name' }), add = el('button', { textContent: 'add' });
  const list = el('ul', { className: 't-images' }), slots = el('div', { className: 't-slots' });
  root.append(head, el('div', { className: 't-add' }, [pick, name, add]), list, slots);
  pick.onchange = () => { if (pick.files[0]) name.value = nameFromFile(pick.files[0].name); };
  add.onclick = async () => { const f = pick.files[0]; if (!f) return; ctl.addImage(name.value, new Uint8Array(await f.arrayBuffer())); pick.value = ''; name.value = ''; };

  function selectedWord() {
    const sel = shell.getState().selection, doc = shell.getState().history.present;
    const id = Array.isArray(sel) && sel.length ? sel[0] : null; return id ?doc.words.find((w) => w.id === id && w.phrase === undefined && w.word !== 'jump') : null;
  }
  function render(st) {
    head.textContent = st.error ? `textures: ${st.error}` : st.budget ? `textures: ${st.images.length} image(s), ${(st.budget.bytes / 1048576).toFixed(1)} MiB` : 'textures';
    head.classList.toggle('red', !!st.error);
    list.replaceChildren(...st.images.map((im) => {
      const rm = el('button', { textContent: '×', title: 'remove' }); rm.onclick = () => ctl.removeImage(im.name);
      return el('li', {}, [`${im.name} (${im.format}, ${im.width}×${im.height})`, ...im.warnings.map((w) => el('div', { className: 'amber', textContent: w.message })), rm]);
    }));
    const w = selectedWord(); slots.replaceChildren();
    if (!w) { slots.textContent = 'select a road word to texture it'; return; }
    const eff = effectiveSlots(w);
    for (const s of SLOTS) {
      const sel = el('select', {}, [el('option', { value: '', textContent: '(font default)' }), ...st.images.map((im) => el('option', { value: im.name, textContent: im.name }))]);
      sel.value = (w.textures[s] && w.textures[s].texture) || '';
      sel.onchange = () => (sel.value ? ctl.setSlot(w.id, s, { texture: sel.value }) : ctl.clearSlot(w.id, s));
      const len = el('input', { type: 'number', step: '0.1', value: eff[s].tileLength, title: 'tiling length, m' }); len.onchange = () => ctl.setSlot(w.id, s, { tileLength: Number(len.value) });
      const fit = el('select', {}, [el('option', { value: 'tile', textContent: 'tile' }), el('option', { value: 'fit', textContent: 'fit' })]); fit.value = eff[s].fit; fit.onchange = () => ctl.setSlot(w.id, s, { fit: fit.value });
      const off = el('input', { type: 'number', step: '0.1', value: eff[s].offset, title: 'offset, m' }); off.onchange = () => ctl.setSlot(w.id, s, { offset: Number(off.value) });
      const dir = el('select', {}, [el('option', { value: 'along', textContent: 'along' }), el('option', { value: 'across', textContent: 'across' })]); dir.value = eff[s].dir; dir.onchange = () => ctl.setSlot(w.id, s, { dir: dir.value });
      slots.append(el('div', { className: 't-slot' }, [el('b', { textContent: s }), sel, len, fit, off, dir]));
    }
  }
  const ctl = createTextureController(shell, { onUpdate: (st) => { render(st); root.dispatchEvent(new CustomEvent('t180:textures', { bubbles: true, detail: { set: st.set } })); } });
  return ctl;
}

module.exports = { mount };
