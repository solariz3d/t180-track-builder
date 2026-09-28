// packs.js: TEXTURE PACKS (ARCHITECTURE §5b: "Texture packs: save and share sets (a font's full look), and import packs
// other users made"). A pack is ONE shareable file: canonical text with its images embedded.
//
//   makePack({ name, author, font, slots, images })  -> pack       slots: all five, full settings (src/doc/textures.js)
//   packFromWord(doc, id, { name, author, images })    -> pack       a word's effective look (its font's, with its overrides)
//   serializePack(pack) -> text · parsePack(text) -> pack           serializePack(parsePack(t)) === t, byte for byte
//   importPack(collection, text) -> collection         collection: { packs: [pack], images: { name: Uint8Array } }
//   applyPack(doc, pack) -> { doc, words }             every word of the pack's font wears it: ONE edit, one undo step
//
// A pack carries its five slots in full (a made texture as the maker's text, an image by name) and exactly the images
// those slots name, as the original PNG or JPG bytes (base64). Refused, by name:
//   BAD_PACK            not a pack, a key it does not have, a bad name, font or slot
//   PACK_MISSING_IMAGE  a slot names an image the pack does not carry
//   PACK_UNUSED_IMAGE   the pack carries an image no slot names (a pack is exactly its look)
//   PACK_BAD_IMAGE      an image that is not a PNG or a JPG: §5b's route is "Drop in PNG or JPG images. The program
//                       converts them to DDS". A DDS in a pack is refused; the builder makes its own.
//   COMPRESSED_NORMAL   a normal map that is block-compressed (a DDS with a DXT/BC/ATI FourCC): §5b "Warns about what
//                       AC can't do, e.g. compressed normal maps aren't supported"
//   NAME_TAKEN          on import, a pack of that name (trimmed, any case: as the piece library's names) is already
//                       there, or an image of that name with DIFFERENT bytes is; the same bytes under the same name are
//                       one image, shared
'use strict';
const { DocError, fmt } = require('./serial.js');
const TX = require('./textures.js');
const { FONTS } = require('./vocab.js');
const { sniff, decodeImage } = require('../texture/image.js');
const { readDdsHeader } = require('../texture/dds.js');

const PACK = 1;
const ROLES = ['diffuse', 'normal'];
const key = (s) => s.trim().toLowerCase();
const bad = (code, msg) => new DocError(code, msg);

// ── base64 (dependency-free: this runs in the app's webview too) ──
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(u8) {
  let out = '';
  for (let i = 0; i < u8.length; i += 3) {
    const a = u8[i], b = u8[i + 1], c = u8[i + 2], n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u8.length ? B64[n & 63] : '=');
  }
  return out;
}
function fromBase64(s, where) {
  if (typeof s !== 'string' || s.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw bad('BAD_PACK', `${where}: bytes are not base64`);
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0, out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | ((s[i + 2] === '=' ? 0 : B64.indexOf(s[i + 2])) << 6) | (s[i + 3] === '=' ? 0 : B64.indexOf(s[i + 3]));
    if (o < out.length) out[o++] = n >> 16; if (o < out.length) out[o++] = (n >> 8) & 255; if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Why these bytes may not ride in a pack, as a DocError, or null. */
function imageProblem(name, role, bytes) {
  const kind = sniff(bytes);
  if (!kind) {
    const dds = bytes.length >= 4 && bytes[0] === 0x44 && bytes[1] === 0x44 && bytes[2] === 0x53 && bytes[3] === 0x20;
    if (dds) {
      let fourCC = null; try { fourCC = readDdsHeader(bytes).fourCC; } catch (e) { if (!e.code) throw e; }
      if (role === 'normal' && fourCC && /^(DXT|BC|ATI)/.test(fourCC)) return bad('COMPRESSED_NORMAL', `image ${name}: a block-compressed (${fourCC}) normal map; AC does not support compressed normal maps (§5b)`);
      return bad('PACK_BAD_IMAGE', `image ${name}: a DDS; a pack carries PNG or JPG images, which the builder converts to DDS itself (§5b)`);
    }
    return bad('PACK_BAD_IMAGE', `image ${name}: not a PNG or a JPG`);
  }
  try { decodeImage(bytes); } catch (e) { if (e.name !== 'TextureError') throw e; return bad('PACK_BAD_IMAGE', `image ${name}: ${e.message}`); }
  return null;
}

function checkPack(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw bad('BAD_PACK', 'not an object');
  if (p.pack !== PACK) throw bad(Number.isInteger(p.pack) && p.pack > PACK ? 'SCHEMA_TOO_NEW' : 'BAD_PACK', `pack format ${JSON.stringify(p.pack)}: this builder reads ${PACK}`);
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || /[\u0000-\u001f]/.test(p.name) || p.name !== p.name.trim()) throw bad('BAD_PACK', `a pack needs a name of 1 to 60 printable characters, no outer spaces, got ${JSON.stringify(p.name)}`);
  if (typeof p.author !== 'string') throw bad('BAD_PACK', 'author must be a string');
  if (!Object.prototype.hasOwnProperty.call(FONTS, p.font)) throw bad('BAD_PACK', `font ${JSON.stringify(p.font)} is not a font (${Object.keys(FONTS).join(', ')})`);
  if (!p.slots || typeof p.slots !== 'object' || Object.keys(p.slots).sort().join() !== [...TX.SLOTS].sort().join()) throw bad('BAD_PACK', `slots must hold exactly ${TX.SLOTS.join(', ')}`);
  for (const s of TX.SLOTS) if (Object.keys(p.slots[s]).sort().join() !== [...TX.SETTINGS].sort().join()) throw bad('BAD_PACK', `slot ${s} must carry every setting (${TX.SETTINGS.join(', ')})`);
  const tp = TX.problem(p.slots, 'straight'); if (tp) throw bad('BAD_PACK', tp);
  if (!Array.isArray(p.images)) throw bad('BAD_PACK', 'images must be a list');
  const names = new Set(), used = new Set(TX.SLOTS.map((s) => p.slots[s].texture).filter(Boolean));
  for (const im of p.images) {
    if (!im || typeof im !== 'object' || Object.keys(im).sort().join() !== 'bytes,name,role') throw bad('BAD_PACK', 'an image is { name, role, bytes }');
    if (typeof im.name !== 'string' || !TX.NAME_RE.test(im.name)) throw bad('BAD_PACK', `image name ${JSON.stringify(im.name)} is not a texture name`);
    if (names.has(im.name)) throw bad('BAD_PACK', `image ${im.name} appears twice`);
    names.add(im.name);
    if (!ROLES.includes(im.role)) throw bad('BAD_PACK', `image ${im.name}: role is ${ROLES.join(' or ')}`);
    if (!(im.bytes instanceof Uint8Array)) throw bad('BAD_PACK', `image ${im.name}: bytes must be a Uint8Array`);
    const e = imageProblem(im.name, im.role, im.bytes); if (e) throw e;
    if (!used.has(im.name)) throw bad('PACK_UNUSED_IMAGE', `image ${im.name} is carried but no slot names it`);
  }
  for (const n of used) if (!names.has(n)) throw bad('PACK_MISSING_IMAGE', `a slot names image ${n}, which the pack does not carry`);
  return p;
}

function makePack({ name, author = '', font, slots, images = {} }) {
  const full = Object.fromEntries(TX.SLOTS.map((s) => [s, TX.quantised({ [s]: { ...TX.DEFAULT, ...(slots[s] || {}) } }, (v) => Math.round(v * 1e4) / 1e4)[s]]));
  const list = Object.keys(images).sort().map((n) => ({ name: n, role: images[n].role || 'diffuse', bytes: images[n].bytes instanceof Uint8Array ? images[n].bytes : new Uint8Array(images[n].bytes) }));
  return checkPack({ pack: PACK, name, author, font, slots: full, images: list });
}

/** The pack of one word's look: its font's defaults with its overrides laid over, and the images those name. */
function packFromWord(doc, id, { name, author, images = {} }) {
  const e = doc.words.find((w) => w.id === id);
  if (!e || e.phrase !== undefined || e.word === 'jump') throw bad('NO_SUCH_WORD', `${id} is not a placed road word`);
  const slots = TX.effectiveSlots(e), need = new Set(TX.SLOTS.map((s) => slots[s].texture).filter(Boolean));
  for (const n of need) if (!images[n]) throw bad('PACK_MISSING_IMAGE', `${id} wears image ${n}, which was not given`);
  return makePack({ name, author, font: e.font, slots, images: Object.fromEntries([...need].map((n) => [n, images[n]])) });
}

function serializePack(p) {
  checkPack(p);
  const s = JSON.stringify, m = (x) => fmt(Math.round(x * 1e4), 4);
  const imgs = p.images.map((im) => `    {${s('name')}:${s(im.name)},${s('role')}:${s(im.role)},${s('bytes')}:${s(toBase64(im.bytes))}}`);
  return `{\n  ${s('pack')}: ${p.pack},\n  ${s('name')}: ${s(p.name)},\n  ${s('author')}: ${s(p.author)},\n  ${s('font')}: ${s(p.font)},\n` +
    `  ${s('slots')}: ${TX.text(p.slots, m)},\n  ${s('images')}: [${imgs.length ? `\n${imgs.join(',\n')}\n  ` : ''}]\n}\n`;
}
function parsePack(text) {
  let o; try { o = JSON.parse(text); } catch (e) { throw bad('BAD_JSON', e.message); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad('BAD_PACK', 'not an object');
  const extra = Object.keys(o).filter((k) => !['pack', 'name', 'author', 'font', 'slots', 'images'].includes(k));
  if (extra.length) throw bad('BAD_PACK', `${extra.join(', ')} not part of a pack`);
  if (!Array.isArray(o.images)) throw bad('BAD_PACK', 'images must be a list');
  const slots = o.slots && typeof o.slots === 'object' ? TX.quantised(o.slots, (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v)) : o.slots;
  const images = o.images.map((im, i) => (im && typeof im === 'object' ? { ...im, bytes: fromBase64(im.bytes, `images[${i}]`) } : im));
  return checkPack({ pack: o.pack, name: o.name, author: o.author, font: o.font, slots, images });
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function importPack(collection, text) {
  const p = parsePack(text), packs = collection.packs || [], images = { ...(collection.images || {}) };
  if (packs.some((q) => key(q.name) === key(p.name))) throw bad('NAME_TAKEN', `a pack is already called "${p.name}"`);
  for (const im of p.images) {
    if (images[im.name] && !same(images[im.name], im.bytes)) throw bad('NAME_TAKEN', `an image called "${im.name}" is already added, with different pixels; rename one`);
    images[im.name] = im.bytes;
  }
  return { packs: [...packs, p], images };
}

/** Every road word of the pack's font (and in phrases) wears the pack: its five slots set in full. One document out. */
function applyPack(doc, p) {
  checkPack(p);
  const D = require('./document.js');
  let d = doc, words = 0;
  const patch = { textures: Object.fromEntries(TX.SLOTS.map((s) => [s, { ...p.slots[s] }])) };
  doc.words.forEach((e) => {
    if (e.phrase !== undefined) e.words.forEach((w, n) => { if (w.font === p.font) { d = D.editPhraseWord(d, e.id, n + 1, patch); words++; } });
    else if (e.word !== 'jump' && e.font === p.font) { d = D.editWord(d, e.id, patch); words++; }
  });
  return { doc: d, words };
}

module.exports = { PACK, makePack, packFromWord, serializePack, parsePack, importPack, applyPack, toBase64, fromBase64 };
