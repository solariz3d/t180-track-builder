// model.js: the texture maker's editor state, with no DOM, so it runs headless under node --test and unchanged in the
// webview (loaded by app/lib/cjs.js). The panel (app/texmaker/index.js) draws it.
//
//   const ed = createEditor(start)       start: a texture text, a texture object, or a preset name (src/texmaker PRESETS)
//   ed.texture()   ed.text()             the current texture, and its canonical text (src/texmaker/text.js)
//   ed.addLayer(type)   ed.removeLayer(i)   ed.moveLayer(i, -1 | +1)   ed.set(i, key, value)   ed.setBase(colour)
//   ed.setName(name)    ed.load(text)       ed.swatch(size) -> { width, height, rgba }   ed.subscribe(fn)
//
// AN EDIT THAT WOULD MAKE A BAD TEXTURE CHANGES NOTHING and says why: every change goes through the maker's own checks
// (normalize), and a refusal leaves the texture as it was, with `message` holding the reason's code and text.
'use strict';

const T = require('../../src/texmaker/index.js');

function createEditor(start = 'asphalt') {
  let tex = typeof start === 'string' && T.PRESETS[start] ? T.normalize(T.PRESETS[start]) : typeof start === 'string' ? T.parse(start) : T.normalize(start);
  let message = null;
  const subs = new Set();
  const emit = () => { for (const f of subs) f(api); };
  /** Try a new texture object: accept it (canonical) or keep the old one and say why. */
  const attempt = (next) => {
    try { tex = T.normalize(next); message = null; } catch (e) { if (e.name !== 'TexmakerError') throw e; message = `${e.code}: ${e.message}`; }
    emit(); return message === null;
  };
  const layers = () => tex.layers.map((l) => ({ ...l }));
  const api = {
    texture: () => tex,
    text: () => T.serialize(tex),
    message: () => message,
    types: () => Object.keys(T.LAYERS),
    schemaOf: (type) => T.LAYERS[type],
    addLayer: (type) => attempt({ ...tex, layers: [...layers(), { type }] }),
    removeLayer: (i) => attempt({ ...tex, layers: layers().filter((_, k) => k !== i) }),
    moveLayer(i, dir) {
      const L = layers(), j = i + dir;
      if (i < 0 || i >= L.length || j < 0 || j >= L.length) { message = `BAD_PARAM: layer ${i} cannot move ${dir > 0 ? 'down' : 'up'}`; emit(); return false; }
      [L[i], L[j]] = [L[j], L[i]]; return attempt({ ...tex, layers: L });
    },
    set(i, key, value) {
      const L = layers();
      if (!L[i]) { message = `BAD_PARAM: no layer ${i}`; emit(); return false; }
      L[i] = { ...L[i], [key]: value }; return attempt({ ...tex, layers: L });
    },
    setBase: (colour) => attempt({ ...tex, base: colour }),
    setName: (name) => attempt({ ...tex, name }),
    load(text) {
      try { tex = T.parse(text); message = null; } catch (e) { if (e.name !== 'TexmakerError') throw e; message = `${e.code}: ${e.message}`; }
      emit(); return message === null;
    },
    swatch: (size = 256) => T.makeTexture(tex, size, size),
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
  return api;
}

module.exports = { createEditor };
