// code.js: SHAREABLE CODES (ARCHITECTURE §1.1: "That makes tracks shareable (PolyTrack-style codes), diffable,
// undoable"). A whole document, a saved piece or phrase, or a texture pack, as ONE line of copy-paste text.
//
//   t180<kind><version>.<payload>.<check>
//     kind     d = a track document, p = a piece or phrase (the library's piece file), k = a texture pack
//     version  1: the CODE format (the document inside carries its own schema, migrated or refused by src/doc)
//     payload  the object's CANONICAL text (serialize), UTF-8, raw DEFLATE (src/texture/deflate.js: the same encoder in
//              node and in the app, so one track has one code), in base64url (A–Z a–z 0–9 - _, no padding: URL-safe)
//     check    CRC-32 of the canonical text, 8 lower-case hex digits
//
//   docToCode(doc) · docFromCode(code) -> doc                    byte-exact: serialize(docFromCode(docToCode(d))) === serialize(d)
//   pieceToCode(lib, name) · pieceFromCode(lib, code) -> lib    as library.js exportPiece / importPiece
//   packToCode(pack) · packFromCode(code) -> the pack's text     for src/doc/packs.js importPack(collection, text)
//   decode(code) -> { kind, text }                               checked, but not parsed
//
// REFUSED, whole (a code either imports entirely or changes nothing; every decode is pure until the last line):
//   CODE_MALFORMED  not a code at all (the shape above), after spaces and line breaks are removed
//   CODE_KIND       a code of another kind than the one asked for (a pack pasted where a track goes)
//   CODE_TOO_NEW    a code format this builder does not read yet (version > 1); CODE_VERSION for 0
//   CODE_TOO_LARGE  over MAX_CODE characters, or over MAX_TEXT once inflated
//   CODE_CORRUPT    the payload is not base64url, not DEFLATE, not UTF-8, or its CRC-32 is not the check: a truncated
//                   or altered code
// and then the kind's own refusals (DocError: SCHEMA_TOO_NEW, BAD_PIT_LANE, NAME_TAKEN, PACK_BAD_IMAGE, …).
//
// THE LIMIT. MAX_CODE = 262,144 characters (256 Ki), INFERRED, not measured: codes are for pasting into a chat or a box,
// and a code past that is a file in disguise. A track or a piece is far under it (the sample track's code is measured in
// test/doc-code.test.js); a pack embeds its images, and one with large images passes it and is refused with its size,
// pointing at the pack file instead. MAX_TEXT = 16 MiB bounds what a small code may inflate to.
'use strict';
const { DocError } = require('./serial.js');
const { deflateRaw } = require('../texture/deflate.js');
const { inflateRaw } = require('../texture/inflate.js');
const { crc32 } = require('../texture/png.js');

const VERSION = 1, KINDS = { d: 'track', p: 'piece', k: 'texture pack' };
const MAX_CODE = 262144, MAX_TEXT = 16 * 1024 * 1024;
const RE = /^t180([a-z])(\d+)\.([A-Za-z0-9_-]*)\.([0-9a-f]{8})$/;
const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const bad = (code, msg) => new DocError(code, msg);

function b64u(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 3) {
    const n = (u8[i] << 16) | ((u8[i + 1] || 0) << 8) | (u8[i + 2] || 0), left = u8.length - i;
    s += B64U[n >> 18] + B64U[(n >> 12) & 63] + (left > 1 ? B64U[(n >> 6) & 63] : '') + (left > 2 ? B64U[n & 63] : '');
  }
  return s;
}
function unb64u(s) {
  if (s.length % 4 === 1) throw bad('CODE_CORRUPT', 'the code\'s payload has an impossible length (cut short?)');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4)); let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64U.indexOf(s[i + k]) : 0));
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    out[o++] = n >> 16; if (i + 2 < s.length) out[o++] = (n >> 8) & 255; if (i + 3 < s.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}
const hex8 = (u8) => crc32(u8, 0, u8.length).toString(16).padStart(8, '0');

function encode(kind, text) {
  if (!KINDS[kind]) throw new Error(`code: no kind ${kind}`);
  const bytes = new TextEncoder().encode(text);
  const code = `t180${kind}${VERSION}.${b64u(deflateRaw(bytes))}.${hex8(bytes)}`;
  if (code.length > MAX_CODE) throw bad('CODE_TOO_LARGE', `this ${KINDS[kind]}'s code would be ${code.length.toLocaleString('en')} characters, over the ${MAX_CODE.toLocaleString('en')} a code may be; share the ${kind === 'k' ? 'pack file' : 'file'} instead`);
  return code;
}

function decode(code, want) {
  if (typeof code !== 'string') throw bad('CODE_MALFORMED', 'a code is text');
  const c = code.replace(/\s+/g, '');
  if (c.length > MAX_CODE) throw bad('CODE_TOO_LARGE', `the code is ${c.length.toLocaleString('en')} characters, over the ${MAX_CODE.toLocaleString('en')} a code may be`);
  const m = RE.exec(c);
  if (!m) throw bad('CODE_MALFORMED', 'this is not a t180 code (t180<kind><version>.<payload>.<check>)');
  const [, kind, ver, payload, check] = m;
  if (!KINDS[kind]) throw bad('CODE_KIND', `t180${kind}: no such kind of code`);
  if (Number(ver) > VERSION) throw bad('CODE_TOO_NEW', `a version-${ver} code, from a newer builder; this one reads version ${VERSION}`);
  if (Number(ver) !== VERSION) throw bad('CODE_VERSION', `a version-${ver} code: this builder reads version ${VERSION}`);
  if (want && kind !== want) throw bad('CODE_KIND', `this is a ${KINDS[kind]} code, not a ${KINDS[want]} code`);
  let bytes;
  try { bytes = inflateRaw(unb64u(payload), 0, payload.length * 4, MAX_TEXT).data; } catch (e) { if (e.code === 'CODE_CORRUPT') throw e; if (e.code !== 'BAD_DEFLATE') throw e; if (/passes/.test(e.message)) throw bad('CODE_TOO_LARGE', `the code unpacks to more than ${MAX_TEXT} bytes`); throw bad('CODE_CORRUPT', `the code does not unpack (${e.message}): it was cut short or altered`); }
  if (hex8(bytes) !== check) throw bad('CODE_CORRUPT', 'the code\'s check does not match its contents: it was cut short or altered');
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { throw bad('CODE_CORRUPT', 'the code does not hold UTF-8 text'); }
  return { kind, text };
}

// ── the three kinds ────────────────────────────────────────────────────────────────────────────────────────────────
const docToCode = (doc) => encode('d', require('./serial.js').serialize(doc));
const docFromCode = (code) => require('./serial.js').parse(decode(code, 'd').text);
const pieceToCode = (lib, name) => encode('p', require('./library.js').exportPiece(lib, name));
const pieceFromCode = (lib, code) => require('./library.js').importPiece(lib, decode(code, 'p').text);
const packToCode = (pack) => encode('k', require('./packs.js').serializePack(pack));
function packFromCode(code) { const { text } = decode(code, 'k'); require('./packs.js').parsePack(text); return text; }

module.exports = { VERSION, MAX_CODE, MAX_TEXT, encode, decode, docToCode, docFromCode, pieceToCode, pieceFromCode, packToCode, packFromCode };
