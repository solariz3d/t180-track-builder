// set.js: THE TEXTURE SET, the one object the preview and the export both take their textures from (ARCHITECTURE §5b
// with §5: "the preview and the export render with the same inputs").
//
//   buildTextureSet(doc, assets, opts) -> set
//     assets: { <name>: { bytes: PNG/JPG bytes, role?: 'diffuse' | 'normal' } }  (names as the document writes them)
//     set = { textures: [{ name, file, dds, width, height, mips, warnings }],   file = the name inside the kn5
//             materials: [{ key, slot, texture, material }],                      material: scene.js's material shape
//             bySegment(id) -> { <slot>: { material, settings } } | null,        for a resolved segment's id
//             warnings, budget }
//   applyToScene(scene, set) -> scene with the set's DDS files and materials appended (materials keep their order, so a
//                               mesh's `material` index into the scene is set.materialBase + the set's index)
//   previewTextures(set) -> [{ name, file, width, height, rgba }]   level 0 read back FROM THE DDS BYTES, so what the
//                               preview shows is what the export writes, texel for texel, and never the source image.
//
// Only the textures some word's effective slots name are converted; an asset nothing uses is left out of the kn5.
// A slot that names a texture the assets lack is refused (NO_SUCH_TEXTURE); a refusing warning (warnings.js) is thrown.
// MADE TEXTURES (D175): a slot whose `make` holds the procedural maker's text (src/texmaker) is rendered here with
// makeTexture(text, size, size) and taken down the same DDS path as an image, so the preview and the export stay one
// list. Its name is `made-<16 hex of an FNV-1a hash of the text>-<size>`: the same text at the same size is one texture
// wherever it is used. Rendered DDS files are kept in a small cache (the last 32), because the panel rebuilds the set
// on every edit and a 1024² render is not free; the cache is keyed by that name, so it can only return the same bytes.
// A JUMP has no surface of its own: its landing ramp (the resolved `land` part, which carries the jump's id) wears the
// road word before it, as the document says (src/doc/textures.js).
'use strict';
const { SLOTS, effectiveSlots } = require('../doc/textures.js');
const { decodeImage } = require('./image.js');
const { encodeDds, ddsLevel, mipCount } = require('./dds.js');
const { checkTexture, budget } = require('./warnings.js');
const { TextureError } = require('./errors.js');
const { makeTexture } = require('../texmaker/make.js');

/** FNV-1a over the UTF-16 code units, twice (two offsets), as 16 hex digits. Names a made texture; not security. */
function hash16(str) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x01000193) >>> 0; b = (b ^ (b >>> 13)) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
const madeName = (text, size) => `made-${hash16(text)}-${size}`;
const CACHE = new Map(), CACHE_MAX = 32;
function madeDds(name, text, size) {
  if (CACHE.has(name)) return CACHE.get(name);
  const img = makeTexture(text, size, size), out = { img, dds: encodeDds(img) };
  CACHE.set(name, out); if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return out;
}

const fileOf = (name) => `t180b_${name}.dds`;
function material(slot, texture) {
  return {
    name: texture ? `t180b_${slot}_${texture}` : `t180b_${slot}`, shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0,
    props: [{ name: 'ksAmbient', value: [0.45] }, { name: 'ksDiffuse', value: [0.55] }, { name: 'ksSpecular', value: [0.15] },
      { name: 'ksSpecularEXP', value: [20] }, { name: 'ksEmissive', value: slot === 'edgeGlow' ? [1, 1, 1] : [0, 0, 0] }, { name: 'ksAlphaRef', value: [0] }],
    samplers: texture ? [{ name: 'txDiffuse', slot: 0, texture: fileOf(texture) }] : [],
  };
}

/** Every word of the document in order, with the id resolve gives its segments (`w3`, or `w2/1` inside a phrase). */
function wordsOf(doc) {
  return doc.words.flatMap((e) => (e.phrase !== undefined ? e.words.map((w, n) => ({ id: `${e.id}/${n + 1}`, w })) : [{ id: e.id, w: e }]));
}

function buildTextureSet(doc, assets = {}, opts = {}) {
  const words = wordsOf(doc), byId = new Map(), used = new Map(), made = new Map(), slotsOf = new Map(), mats = new Map();
  let last = null;
  for (const { id, w } of words) {
    const eff = effectiveSlots(w);                               // null for a jump
    const slots = eff || last;                                   // a jump's landing ramp wears the road before it
    if (eff) last = eff;
    if (!slots) { byId.set(id, null); continue; }
    const entry = {};
    for (const s of SLOTS) {
      const m = slots[s].make, t = m ? madeName(m, slots[s].size) : slots[s].texture, key = `${s}|${t || ''}`;
      if (m) made.set(t, { text: m, size: slots[s].size });
      else if (t) { if (!Object.prototype.hasOwnProperty.call(assets, t)) throw new TextureError('NO_SUCH_TEXTURE', `${id}: slot ${s} names texture "${t}", which has not been added`); used.set(t, assets[t]); }
      if (t) { if (!slotsOf.has(t)) slotsOf.set(t, new Set()); slotsOf.get(t).add(s); }
      if (!mats.has(key)) mats.set(key, { key, slot: s, texture: t || null, material: material(s, t) });
      entry[s] = { material: mats.get(key).material.name, settings: slots[s] };
    }
    byId.set(id, entry);
  }
  const textures = [], warnings = [];
  for (const name of [...used.keys(), ...made.keys()].sort()) {
    if (made.has(name)) {
      const { text, size } = made.get(name), { img, dds } = madeDds(name, text, size);
      textures.push({ name, file: fileOf(name), dds, width: img.width, height: img.height, mips: mipCount(img.width, img.height), warnings: [], made: true, slots: [...slotsOf.get(name)].sort() });
      continue;
    }
    const a = used.get(name) || {};
    if (!a.bytes) throw new TextureError('BAD_IMAGE', `texture "${name}" has no image bytes`);
    const img = decodeImage(a.bytes);
    const w = checkTexture(img, { role: a.role || 'diffuse', compress: !!a.compress, name });
    const refuse = w.find((x) => x.level === 'refuse'); if (refuse) throw new TextureError(refuse.code, refuse.message);
    warnings.push(...w);
    textures.push({ name, file: fileOf(name), dds: encodeDds(img), width: img.width, height: img.height, mips: mipCount(img.width, img.height), warnings: w, slots: [...slotsOf.get(name)].sort() });
  }
  const b = budget(textures, opts); warnings.push(...b.warnings);
  return { textures, materials: [...mats.values()], bySegment: (id) => (byId.has(id) ? byId.get(id) : null), warnings, budget: b };
}

/** The scene with the set's textures and materials appended; `materialBase` is where the set's materials start. */
function applyToScene(scene, set) {
  const toBuf = (u8) => (typeof Buffer !== 'undefined' ? Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength) : u8);
  const taken = new Set(scene.textures.map((t) => t.name));
  for (const t of set.textures) if (taken.has(t.file)) throw new TextureError('BAD_TEXTURE_NAME', `the scene already has a texture called ${t.file}`);
  return {
    scene: { ...scene, textures: [...scene.textures, ...set.textures.map((t) => ({ name: t.file, data: toBuf(t.dds) }))], materials: [...scene.materials, ...set.materials.map((m) => m.material)] },
    materialBase: scene.materials.length,
  };
}

function previewTextures(set) {
  return set.textures.map((t) => { const l = ddsLevel(t.dds, 0); return { name: t.name, file: t.file, width: l.width, height: l.height, rgba: l.rgba }; });
}

module.exports = { buildTextureSet, applyToScene, previewTextures, fileOf, wordsOf, madeName, hash16 };
