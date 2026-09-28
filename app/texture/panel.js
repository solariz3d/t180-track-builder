// panel.js: the textures panel's logic, with no DOM (tested headless against the real shell). index.js mounts it.
//
//   const ctl = createTextureController(shell, { onUpdate })
//   ctl.addImage(name, bytes)      a PNG or JPG the user dropped in, under a name the document can write (textures.js
//                                  NAME_RE). Decoded at once, so a bad or unsupported file is refused here, by name.
//   ctl.removeImage(name)          refused while a slot still uses it (the set would lose a texture the export needs)
//   ctl.setSlot(id, slot, patch)   a word's slot override: { texture?, tileLength?, fit?, tileWidth?, offset?, dir? };
//                                  one undo step (the shell's sculpt)
//   ctl.clearSlot(id, slot)        drop the override: the slot goes back to its font's default
//   ctl.setMade(id, slot, text, size)  a MADE texture (src/texmaker's canonical text) in the slot, at size px (D175);
//                                  an image the slot held is dropped, as a slot holds one or the other
//   ctl.savePack(id, { name, author })  -> the pack FILE's text: word id's whole look, with the images it names
//   ctl.importPack(text)           a pack file: its images join the panel's (a clash refused, as the piece library's)
//   ctl.applyPack(name)            every word of the pack's font wears it: ONE edit, one undo step (shell.commitDoc)
//   ctl.state -> { images: [{ name, format, width, height, warnings }], set, error, budget, packs: [{ name, font, author }] }
//   state.budget is the live texture-memory counter (src/texture/warnings.js budget: per texture, per slot, total, level)
//
// state.set IS THE SEAM (src/texture/set.js): the preview draws previewTextures(state.set) and asks
// state.set.bySegment(id) for each segment's slots; the export takes the same set (applyToScene). One set, rebuilt
// after every change to the images or the track, so the preview can never show a texture the export would not write.
'use strict';
const T = require('../../src/texture/index.js');
const { NAME_RE, SLOTS } = require('../../src/doc/textures.js');
const P = require('../../src/doc/packs.js');

function createTextureController(shell, { onUpdate = () => {} } = {}) {
  const images = new Map();                    // name -> { bytes, format, width, height, warnings }
  const packs = [];
  const out = { state: { images: [], set: null, error: null, budget: null, packs: [] } };
  const assets = () => Object.fromEntries([...images].map(([n, v]) => [n, { bytes: v.bytes }]));

  function update(error = null) {
    const doc = shell.getState().history.present;
    let set = null, err = error;
    try { set = T.buildTextureSet(doc, assets()); } catch (e) {
      if (e.name !== 'TextureError') throw e;  // a texture refusal is shown; anything else is a bug and stays loud
      err = err || e.message;
    }
    out.state = { images: [...images].map(([name, v]) => ({ name, format: v.format, width: v.width, height: v.height, warnings: v.warnings })),
      set, error: err, budget: set ? set.budget : null, packs: packs.map((q) => ({ name: q.name, font: q.font, author: q.author })) };
    onUpdate(out.state);
    return out.state;
  }
  const refuse = (msg) => update(msg);
  const usesOf = (name) => {
    const doc = shell.getState().history.present, found = [];
    for (const { id, w } of T.wordsOf(doc)) for (const s of SLOTS) if (w.textures && w.textures[s] && w.textures[s].texture === name) found.push(`${id} ${s}`);
    return found;
  };

  const unsubscribe = shell.subscribe(() => update());
  update();
  return {
    get state() { return out.state; },
    addImage(name, bytes) {
      if (typeof name !== 'string' || !NAME_RE.test(name)) return refuse(`"${name}" is not a texture name: lower-case letters, digits, _ and -, up to 64`);
      if (images.has(name)) return refuse(`a texture called "${name}" is already added; remove it first`);
      let img;
      try { img = T.decodeImage(bytes); } catch (e) { if (e.name !== 'TextureError') throw e; return refuse(`${name}: ${e.message}`); }
      const warnings = T.checkTexture(img, { name });
      const r = warnings.find((w) => w.level === 'refuse'); if (r) return refuse(r.message);
      images.set(name, { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), format: img.format, width: img.width, height: img.height, warnings });
      return update();
    },
    removeImage(name) {
      if (!images.has(name)) return refuse(`there is no texture called "${name}"`);
      const u = usesOf(name); if (u.length) return refuse(`"${name}" is still used by ${u.join(', ')}`);
      images.delete(name); return update();
    },
    setSlot(id, slot, patch) {
      if (patch.texture && !images.has(patch.texture)) return refuse(`add the image "${patch.texture}" before a slot can use it`);
      shell.sculpt(id, { textures: { [slot]: patch.texture ? { make: null, ...patch } : patch } });
      return update(shell.getState().message || null);
    },
    setMade(id, slot, text, size) {
      shell.sculpt(id, { textures: { [slot]: { texture: null, make: text, ...(size !== undefined ? { size } : {}) } } });
      return update(shell.getState().message || null);
    },
    savePack(id, { name, author = '' }) {
      return P.serializePack(P.packFromWord(shell.getState().history.present, id, { name, author, images: assets() }));
    },
    importPack(text) {
      let col;
      try { col = P.importPack({ packs, images: Object.fromEntries([...images].map(([n, v]) => [n, v.bytes])) }, text); } catch (e) { if (e.name !== 'DocError') throw e; return refuse(e.message); }
      const p = col.packs[col.packs.length - 1];
      for (const im of p.images) if (!images.has(im.name)) {
        const img = T.decodeImage(im.bytes);
        images.set(im.name, { bytes: im.bytes, format: img.format, width: img.width, height: img.height, warnings: T.checkTexture(img, { name: im.name }) });
      }
      packs.push(p); return update();
    },
    applyPack(name) {
      const p = packs.find((q) => q.name === name); if (!p) return refuse(`there is no pack called "${name}"`);
      const r = P.applyPack(shell.getState().history.present, p);
      if (!r.words) return refuse(`no ${p.font} word to wear "${name}"`);
      shell.commitDoc(r.doc); return update(shell.getState().message || null);
    },
    clearSlot(id, slot) { shell.sculpt(id, { textures: { [slot]: null } }); return update(shell.getState().message || null); },
    dispose() { unsubscribe(); },
  };
}

/** A texture name from a file name: `Kerb Stripes.PNG` → `kerb-stripes`. The user may change it before adding. */
function nameFromFile(file) {
  const base = String(file).replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '').slice(0, 64);
  return base || 'texture';
}

module.exports = { createTextureController, nameFromFile };
