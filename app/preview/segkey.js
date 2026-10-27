// segkey.js: a segment's CHANGE KEY, fast (D235 part 2). The track model decides what to rebuild by comparing each resolved segment with the one it meshed last time
// (app/preview/trackmodel.js). That key was JSON.stringify(segment), which for a core track is a few kilobytes of numbers per 2 m segment: about 60 ms on the long
// open tube per ghost keystroke (and the same again inside every full update). This is the same equality, hashed: every number by its bits, every string by its
// characters, arrays and objects by length / keys in order, with two 32-bit accumulators (a 64-bit key: a false "unchanged" would show a stale mesh, so it is
// kept wide). Two segments that JSON.stringify to the same text hash the same; a change of one bit of one number changes the key.
'use strict';

const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
let h1 = 0, h2 = 0;
const mix = (x) => { h1 = Math.imul(h1 ^ x, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ (x + 0x9e3779b9), 0x85ebca6b) >>> 0; h2 = (h2 ^ (h2 >>> 13)) >>> 0; };

function feed(v) {
  switch (typeof v) {
    case 'number': f64[0] = Object.is(v, -0) ? 0 : v; mix(u32[0]); mix(u32[1]); return;   // -0 and 0 print alike in JSON
    case 'string': for (let i = 0; i < v.length; i++) mix(v.charCodeAt(i)); mix(0x1ff); return;
    case 'boolean': mix(v ? 0x7a : 0x9b); return;
    case 'undefined': case 'function': case 'symbol': mix(0xdead); return;   // JSON leaves these out; they hash alike, whatever they are
    default:
      if (v === null) { mix(0xbeef); return; }
      if (Array.isArray(v) || ArrayBuffer.isView(v)) { mix(0xa4a40000 ^ v.length); for (let i = 0; i < v.length; i++) feed(v[i]); return; }
      mix(0x0b1e0000); for (const k of Object.keys(v)) { if (typeof v[k] === 'function' || v[k] === undefined) continue; for (let i = 0; i < k.length; i++) mix(k.charCodeAt(i)); mix(0x3a); feed(v[k]); } mix(0x0b1e0001);
  }
}

/** The key of a segment: equal for equal content, different (but for a 2^-64 chance) for different content. */
function keyOf(seg) { h1 = 0x811c9dc5; h2 = 0x1b873593; feed(seg); return h1.toString(36) + '.' + h2.toString(36); }

/**
 * D483: a and b have the same content as keyOf reads it, told without hashing: what the cheap ghost asks of the chords it meshed last time (app/preview/trackmodel.js),
 * where hashing 48 chords of about 10 kB each on every move of a drag with an edge typed was 176 ms of 974. It walks both together and stops at the first difference. It
 * may say "different" where the keys would agree (a NaN, a key that holds undefined, objects of different kinds): that costs a rebuild, never a stale mesh. It never says
 * "same" where they would differ: one object reached from both sides is taken as the same only when it is FROZEN all the way down (it cannot have changed since it was
 * meshed); one that is not may have been changed in place since, and counts as different.
 */
function sameContent(a, b) {
  if (a === b) return a === null || typeof a !== 'object' || frozenDeep(a);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b) || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i] || !sameContent(a[ka[i]], b[ka[i]])) return false;
  return true;
}
/**
 * D483: the content of v AS IT IS NOW, for sameContent to compare with later: what is frozen all the way down is kept as it is (it cannot change), plain objects and arrays
 * are copied (so a change made in place afterwards, by anyone, does not reach the copy), and anything else becomes a mark that sameContent never takes as the same.
 */
const UNSEEN = Symbol('not kept');
function snapshot(v) {
  if (v === null || typeof v !== 'object' || frozenDeep(v)) return typeof v === 'function' || typeof v === 'symbol' ? UNSEEN : v;
  if (Array.isArray(v)) return v.map(snapshot);
  if (Object.getPrototypeOf(v) !== Object.prototype) return UNSEEN;
  const out = {}; for (const k of Object.keys(v)) out[k] = snapshot(v[k]); return out;
}
// frozen all the way down, every own property a value (no getter); a true answer is remembered, for it cannot change
const DEEP = new WeakMap();
function frozenDeep(v) {
  if (v === null || typeof v !== 'object') return true;
  if (DEEP.has(v)) return true;
  if (!Object.isFrozen(v)) return false;
  for (const k of Object.keys(v)) { const d = Object.getOwnPropertyDescriptor(v, k); if (!('value' in d) || !frozenDeep(d.value)) return false; }
  DEEP.set(v, true); return true;
}

module.exports = { keyOf, sameContent, snapshot };
