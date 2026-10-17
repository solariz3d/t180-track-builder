// textures.js: the road surface of an EQUATION-CORE track (D228), and the small panel that picks it. No DOM in the controller
// (tested headless); mount() is the panel.
//
//   const ctl = createCoreTextures({ segments: () => resolved.segments, onChange: (set) => {} })
//   ctl.kind                      'asphalt' (the default) | 'solid' | 'image'
//   ctl.setKind(kind)             'asphalt': the procedural asphalt preset (src/texmaker/presets.js, our own parameters, nothing bundled);
//                                 'solid': no texture, the plain material colour as before; 'image': the picture added last
//   ctl.addImage(name, bytes)     a PNG or JPG the user has the right to use (src/texture/image.js decodes it here, so a bad file is refused by
//                                 name); it becomes the road surface
//   ctl.current()                 the texture set for the track as it is now (null for 'solid'): the ONE set the preview draws and the export
//                                 writes (src/texture/set.js), with the floor slot of every road piece wearing the look
//   ctl.refresh()                 rebuild after the track's pieces changed (a new piece is a new segment id the set must know)
//   ctl.setEdge(on)               D371: the EDGE fit (src/texture/edge.js): once the track is CLOSED the road surface is laid out from its whole width range, the edge
//                                 bands keeping their size in metres and the centre whole repeats; before Close, or off, it is the plain tile as it was. current() rebuilds
//                                 first if the closed state or the width range changed since (the export asks current(), so a changed width is picked up there)
//   ctl.state -> { kind, image, error, budget, warnings }
//
// WHY A SET OF "WORDS". src/texture/set.js builds a set from a document's words; a core track has pieces, not words, but a set only needs an
// id and a font per piece. So each road piece id becomes a word-shaped record { id, word, font: 'flat', textures: { floor: <the look> } } and the
// existing builder does the rest: the made texture or image is converted to DDS with mips, the material is the same ksPerPixel material, and
// the export (withTextureSet) and the preview (aclook resolveLook) read the same set. Only the FLOOR slot is set: the export dresses a whole road
// cell with its floor material (withTextureSet), walls and tube roof included.
// The tiling length and width are the defaults (10 m), and a texture's coordinates run on the path's own arc length (src/texture/flow.js).
'use strict';
const T = require('../../src/texture/index.js');
const TM = require('../../src/texmaker/index.js');
const { NAME_RE } = require('../../src/doc/textures.js');
const EDGE = require('../../src/texture/edge.js');

const KEY = 't180.coreLook';
const ASPHALT = TM.serialize(TM.PRESETS.asphalt);   // canonical text, so the made texture's name is the same wherever it is rebuilt

/** The ids of the road pieces of a resolved track, once each and in order. */
function roadIds(segments) { return [...new Set((segments || []).filter((g) => g && g.kind === 'road').map((g) => g.id))]; }

function createCoreTextures({ segments = () => [], closed = () => false, onChange = () => {}, kind = 'asphalt', edge = false } = {}) {
  const images = new Map();   // name -> { bytes }
  let k = kind, image = null, last = null, lastKey = null, error = null, set = null, edgeOn = !!edge;
  // D371: the edge fit applies to a CLOSED track that has a road; the drawing is the default 10 m wide with a 1 m band at each side
  const edgeNow = () => { if (!edgeOn || !closed()) return null; const w = EDGE.widthRange(segments()); return w ? { widths: w } : null; };
  const keyOf = (e, ids) => `${k}|${image || ''}|${ids.join(',')}${e ? `|edge|${e.widths.min}|${e.widths.max}` : ''}`;
  const state = () => ({ kind: k, image, error, budget: set ? set.budget : null, warnings: set ? set.warnings : [] });
  const floor = (e) => { const f = k === 'asphalt' ? { make: ASPHALT } : k === 'image' && image ? { texture: image } : null; return f && e ? { ...f, fit: 'edge', tileWidth: 10, edgeBand: 1 } : f; };

  function build() {
    const e = edgeNow(), f = floor(e), ids = roadIds(segments());
    if (!f || !ids.length) return null;
    const key = keyOf(e, ids);
    if (key === lastKey && last) return last;
    const doc = { words: ids.map((id) => ({ id, word: 'straight', font: 'flat', textures: { floor: f } })) };
    const assets = Object.fromEntries([...images].map(([n, v]) => [n, { bytes: v.bytes }]));
    last = T.buildTextureSet(doc, assets, e ? { widths: e.widths } : undefined); lastKey = key;
    return last;
  }
  function rebuild() {
    try { set = build(); error = null; } catch (e) { if (e.name !== 'TextureError') throw e; error = e.message; set = null; last = null; lastKey = null; }
    onChange(set);
    return set;
  }
  const ctl = {
    get kind() { return k; },
    get state() { return state(); },
    current() { if (edgeOn && keyOf(edgeNow(), roadIds(segments())) !== lastKey) rebuild(); return set; },
    refresh() { return rebuild(); },
    get edge() { return edgeOn; },
    setEdge(on) { edgeOn = !!on; return rebuild(); },
    setKind(next) {
      if (!['asphalt', 'solid', 'image'].includes(next)) throw new Error(`core textures: the road surface is asphalt, solid or image, not ${JSON.stringify(next)}`);
      if (next === 'image' && !image) { error = 'add a picture first'; onChange(set); return set; }
      k = next; return rebuild();
    },
    addImage(name, bytes) {
      if (!NAME_RE.test(name || '')) { error = `a texture name is lower-case letters, digits, _ and -, starting with a letter or digit; got ${JSON.stringify(name)}`; onChange(set); return set; }
      const had = images.get(name), snap = { k, image, last, lastKey, set };
      images.set(name, { bytes }); k = 'image'; image = name; last = null; lastKey = null;
      try { set = build(); error = null; } catch (e) {
        if (e.name !== 'TextureError') throw e;
        if (had) images.set(name, had); else images.delete(name);   // refused: the road is exactly as it was, the very same set, and the reason is shown
        ({ k, image, last, lastKey, set } = snap); error = e.message;
      }
      onChange(set); return set;
    },
  };
  rebuild();
  return ctl;
}

const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const KEY_EDGE = 't180.coreLookEdge';
let remembered = (key = KEY) => { try { return localStorage.getItem(key); } catch (e) { return null; } };
let remember = (v, key = KEY) => { try { localStorage.setItem(key, v); } catch (e) { /* a private window: the choice lasts this session */ } };

/** The panel: mount(root, shell). Announces the set as 't180:textures' (the preview draws it, the page's Export passes it). */
function mount(root, shell) {
  const { nameFromFile } = require('../texture/panel.js');
  const start = remembered() === 'solid' ? 'solid' : 'asphalt';
  const head = el('div', { className: 't-head' }), pick = el('select', {}, [el('option', { value: 'asphalt', textContent: 'Asphalt (made here)' }), el('option', { value: 'solid', textContent: 'Solid colour' }), el('option', { value: 'image', textContent: 'My picture' })]);
  const file = el('input', { type: 'file', accept: '.png,.jpg,.jpeg,image/png,image/jpeg', title: 'a PNG or JPG you have the right to use' }), note = el('div', { className: 't-budget' });
  // D371: the edge fit, off unless chosen (and remembered): once the track is closed the surface is laid out from its whole width range
  const edgeBox = el('input', { type: 'checkbox', checked: remembered(KEY_EDGE) === '1' }), edgeRow = el('label', { className: 't-edge', title: 'once the track is closed: the edge bands keep their size at every width, and the centre is whole repeats' }, [edgeBox, el('span', { textContent: ' edge bands fitted to the closed track' })]);
  root.append(el('div', { className: 't-add' }, [el('b', { textContent: 'road surface ' }), pick, file]), head, note, edgeRow);
  // `kind` (2026-10-14) tells the preview which surface was CHOSEN: it draws the Sigil surface until a picture is ('image'), the export always writes the set
  const announce = (set) => root.dispatchEvent(new CustomEvent('t180:textures', { bubbles: true, detail: { set, kind: ctl ? ctl.kind : start } }));
  const show = (c) => {
    const s = c.state;
    head.textContent = s.error ? `road surface: ${s.error}` : s.kind === 'solid' ? 'road surface: solid colour' : s.kind === 'image' ? `road surface: your picture "${s.image}"` : 'road surface: asphalt';
    head.classList.toggle('red', !!s.error);
    note.textContent = s.budget ? `texture memory ${(s.budget.bytes / 1048576).toFixed(1)} MiB (${s.budget.level})` : '';
    pick.value = s.kind;
  };
  let ctl = null;   // the controller announces once while it is being made, before `ctl` is assigned
  ctl = createCoreTextures({ segments: () => (shell.getState().resolved ? shell.getState().resolved.segments : []), kind: start, edge: edgeBox.checked, closed: () => !!(shell.getState().resolved && shell.getState().resolved.closed), onChange: (set) => { announce(set); if (ctl) show(ctl); } });
  edgeBox.onchange = () => { remember(edgeBox.checked ? '1' : '0', KEY_EDGE); ctl.setEdge(edgeBox.checked); };
  pick.onchange = () => { if (pick.value !== 'image') remember(pick.value); ctl.setKind(pick.value); };
  file.onchange = async () => { const f = file.files[0]; if (!f) return; ctl.addImage(nameFromFile(f.name), new Uint8Array(await f.arrayBuffer())); file.value = ''; };
  // a new piece is a new segment id the set must know, so the set follows the track's pieces (not its every edit)
  // and, with the edge fit on, when the track is closed or opened (D371: built at Close); a width changed by an edit on a closed track is picked up at export (current())
  let ids = roadIds(shell.getState().resolved && shell.getState().resolved.segments).join(','), wasClosed = !!(shell.getState().resolved && shell.getState().resolved.closed);
  shell.subscribe((st) => { const now = roadIds(st.resolved && st.resolved.segments).join(','), cl = !!(st.resolved && st.resolved.closed); if (now !== ids || (ctl.edge && cl !== wasClosed)) { ids = now; wasClosed = cl; ctl.refresh(); } wasClosed = cl; });
  announce(ctl.current()); show(ctl);
  return ctl;
}

module.exports = { createCoreTextures, mount, roadIds, ASPHALT };
