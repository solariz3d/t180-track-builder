// core_doc.test.js: node --test test/core_doc.test.js. The equation core's DOCUMENT (src/core/document.js; the shape is
// src/core/README.md): pieces of channel B-splines, C1 joints by construction, canonical text, undo as history, and a real
// track loaded from D184's position fit (a LOCAL example: skipped where reads/ has none; its equation is never committed).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../src/core/document.js');
const { fitChannel } = D;
const { basis, fitSystem } = require('../tools/piecewise.cjs');

const DEG = Math.PI / 180;
const flat = (v = 0) => () => v;
const consts = (o = {}) => ({ kh: flat(o.kh || 0), kv: flat(o.kv || 0), phi: flat(o.phi || 0), w: flat(o.w || 31), r: flat(o.r || 2.993) });

test('a clamped cubic starts at P0 with slope 3(P1 − P0)/t4 (ref 09 §1), against a finite difference', () => {
  const P = D.roadPiece({ length: 100, channels: { ...consts(), kh: (s) => 0.001 + 2e-5 * s + 3e-7 * s * s } });
  const c = P.channels.kh, t4 = P.knots[0], h = 1e-4;
  assert.equal(D.channelAt(P, 'kh', 0).v, c[0]);
  const fd = (D.channelAt(P, 'kh', h).v - D.channelAt(P, 'kh', 0).v) / h;
  assert.ok(Math.abs(fd - (3 * (c[1] - c[0])) / t4) < 1e-9, `${fd} vs ${(3 * (c[1] - c[0])) / t4}`);
});

test('a piece placed after another starts at its end value AND slope in every channel (C1 joints, so the line is G2)', () => {
  let d = D.createDoc('j');
  d = D.appendPiece(d, D.roadPiece({ length: 120, channels: { kh: (s) => 1e-4 * s / 12, kv: (s) => 2e-5 * s, phi: (s) => 0.002 * s, w: (s) => 31 + 0.01 * s, r: flat(3) } }));
  const from = D.endState(d);
  d = D.appendPiece(d, D.roadPiece({ length: 80, from, channels: consts({ kh: -0.01, kv: 0.001, phi: 0.3, w: 40, r: 1 }) }));
  const [a, b] = d.pieces, h = 1e-4;
  for (const ch of D.CHANNELS) {
    assert.ok(Math.abs(D.channelAt(b, ch, 0).v - D.channelAt(a, ch, a.length).v) <= 10 ** -D.DEC[ch], `${ch} value`);
    // the slope agrees to what quantisation allows: P1 is rounded to the channel's quantum q, which moves the slope by at
    // most 3·(q/2)/t4 (ref 09 §1). The slopes are the splines' exact derivatives (channelAt's d1, WIKI-BSPLINE), since a
    // finite difference across a fast change in curvature is itself off by h·c″/2
    const ma = D.channelAt(a, ch, a.length).d1, mb = D.channelAt(b, ch, 0).d1;
    const tol = (3 * 10 ** -D.DEC[ch]) / b.knots[0] + 1e-12;
    assert.ok(Math.abs(ma - mb) < tol, `${ch} slope ${ma} vs ${mb} (tolerance ${tol})`);
  }
});

test('a joint that is not C1 is refused by name (JOINT)', () => {
  const d = D.appendPiece(D.createDoc('j'), D.roadPiece({ length: 50, channels: consts({ kh: 0.01 }) }));
  assert.throws(() => D.appendPiece(d, D.roadPiece({ length: 50, channels: consts({ kh: 0.02 }) })), (e) => e.code === 'JOINT' && /kh starts at/.test(e.message));
});

test('a flight must follow road; the road after it starts level (κh = κv = 0), the rest carried', () => {
  const d0 = D.createDoc('f');
  assert.throws(() => D.appendPiece(d0, D.flightPiece({ gap: 20, drop: 1, land: -2 * DEG })), (e) => e.code === 'BAD_DOC' && /follow a road/.test(e.message));
  const d1 = D.appendPiece(D.appendPiece(d0, D.roadPiece({ length: 60, channels: consts({ kh: 0.004, phi: 0.2 }) })), D.flightPiece({ gap: 20, drop: 1, land: -2 * DEG }));
  const e = D.endState(d1);
  assert.deepEqual([e.kh.v, e.kv.v, e.phi.v], [0, 0, 0.2]);
});

test('load then save is byte-exact, and a value finer than its quantum is snapped as it enters', () => {
  let d = D.createDoc('Round trip', { start: { pos: [1, 2, 3], heading: 0.5, pitch: 0.01 } });
  d = D.appendPiece(d, D.roadPiece({ length: 123.45678, family: 'half-pipe', channels: { kh: (s) => Math.sin(s / 40) * 0.003, kv: flat(0), phi: (s) => 0.001 * s, w: flat(31.5), r: flat(4.55) } }));
  d = D.appendPiece(d, D.flightPiece({ gap: 40, drop: 3, land: -0.05 }));
  d = D.appendPiece(d, D.roadPiece({ length: 90, family: 'half-pipe', from: D.endState(d), channels: consts({ phi: 0.1, w: 31.5, r: 4.55 }) }));
  const t = D.serialize(d);
  assert.equal(D.serialize(D.parse(t)), t);
  assert.equal(d.pieces[0].length, 123.4568);
  const finer = t.replace('"length":123.4568', '"length":123.456800004');
  assert.equal(D.serialize(D.parse(finer)), t);
});

test('the same document serialises to the same bytes whatever order its keys were in', () => {
  const d = D.appendPiece(D.createDoc('k'), D.roadPiece({ length: 70, channels: consts({ kh: 0.002 }) })), t = D.serialize(d), o = JSON.parse(t);
  const shuffled = JSON.stringify({ pieces: o.pieces.map((P) => Object.fromEntries(Object.entries(P).reverse())), nextId: o.nextId, start: o.start, closed: o.closed, name: o.name, generator: o.generator, schema: o.schema });
  assert.equal(D.serialize(D.parse(shuffled)), t);
});

test('a piece whose keys come in another order (as another module may build it) still serialises canonically', () => {
  const d = D.appendPiece(D.createDoc('o'), D.roadPiece({ length: 60, channels: consts({ kh: 0.003 }) })), P = d.pieces[0];
  const reordered = { channels: Object.fromEntries([...D.CHANNELS].reverse().map((ch) => [ch, P.channels[ch]])), knots: P.knots, family: P.family, length: P.length, type: P.type, id: P.id };
  assert.equal(D.serialize(D.checkDoc({ ...d, pieces: [reordered] })), D.serialize(d));
});

test('a file of a different schema version is refused, saying a newer file needs a newer builder', () => {
  const t = D.serialize(D.createDoc('v')).replace('t180b.core/1', 't180b.core/2');
  assert.throws(() => D.parse(t), (e) => e.code === 'BAD_DOC' && /newer builder/.test(e.message));
});

test('undo is the document history: undo and redo are byte-identical, and a whole drag is one entry', () => {
  const d0 = D.createDoc('h'), d1 = D.appendPiece(d0, D.roadPiece({ length: 50, channels: consts() }));
  let h = D.commit(D.createHistory(d0), d1);
  assert.equal(D.serialize(D.undo(h).present), D.serialize(d0));
  assert.equal(D.serialize(D.redo(D.undo(h)).present), D.serialize(d1));
  const e1 = D.appendPiece(d1, D.roadPiece({ length: 10, from: D.endState(d1), channels: consts() }));
  h = D.endDrag(D.dragTo(D.dragTo(D.beginDrag(h), e1), D.appendPiece(d1, D.roadPiece({ length: 20, from: D.endState(d1), channels: consts() }))));
  assert.equal(h.past.length, 2);
  assert.equal(D.serialize(D.undo(h).present), D.serialize(d1));
});

test('a fitted channel holds its start exactly and reproduces a cubic polynomial (ref 03 §2: the cubic lies in the spline space)', () => {
  const f = (s) => 0.01 - 3e-4 * s + 2e-6 * s * s - 4e-9 * s ** 3, K = D.evenKnots(150), P = fitChannel(f, 150, K, { v: f(0), m: -3e-4 });
  const U = [0, 0, 0, 0, ...K, 150, 150, 150, 150];
  let worst = 0; for (let s = 0; s <= 150; s += 1.5) { const b = basis(U, s); let v = 0; for (let a = 0; a < 4; a++) v += P[b.first + a] * b.N[a]; worst = Math.max(worst, Math.abs(v - f(s))); }
  assert.ok(worst < 1e-12, `max error ${worst}`);
});

// ── loading a real track's position fit (ref 09 §4) ──────────────────────────────────────────────────────────────────
/** A synthetic D184 fit: one piece whose position spline is fitted (by D184's own fitSystem) to the curve c(t), t ∈ [0, L]. */
function synthFit(c, L, nKnots) {
  const inner = []; for (let j = 1; j <= nKnots; j++) inner.push((j * L) / (nKnots + 1));
  const piece = { U: [0, 0, 0, 0, ...inner, L, L, L, L] }, rows = [];
  for (let t = 0; t <= L; t += L / 800) rows.push({ piece: 0, s: t, values: c(t) });
  const fit = fitSystem([piece], rows, [], 3);
  const stations = []; for (let t = 0; t <= L; t += 4) stations.push({ c: c(t), n: [0, 1, 0], width: 30 });
  return { fit: { schema: 't180b.pieces/1', lapM: L, pieces: [{ a: 0, b: L, knots: inner, endType: 'end', x: fit.x.map((x) => Array.from(x)), bank: [] }] }, read: { stations } };
}

test('a circle\'s position fit loads as κh = 1/R, κv = 0 and no bank (ref 09 §4)', () => {
  const R = 150, L = Math.PI * R, { fit, read } = synthFit((t) => [R - R * Math.cos(t / R), 0, R * Math.sin(t / R)], L, 30);
  const d = D.fromPositionFit(fit, read), P = d.pieces[0];
  let worst = 0; for (let s = 5; s < P.length - 5; s += 2) worst = Math.max(worst, Math.abs(D.channelAt(P, 'kh', s).v * R - 1), Math.abs(D.channelAt(P, 'kv', s).v * R), Math.abs(D.channelAt(P, 'phi', s).v));
  assert.ok(worst < 1e-3, `worst relative error ${worst}`);
  assert.ok(Math.abs(P.length - L) < 1e-3 * L, `length ${P.length} vs ${L}`);
});

test('a helix loads with κv = 0 at its constant pitch, and κh = cos p / R (the heading turns about WORLD up)', () => {
  const R = 100, c = 0.1, L = 2 * Math.PI * R, { fit, read } = synthFit((t) => [R - R * Math.cos(t / R), c * t, R * Math.sin(t / R)], L, 40);
  const d = D.fromPositionFit(fit, read), P = d.pieces[0], p = Math.atan(c);
  assert.ok(Math.abs(d.start.pitch - p) < 1e-4, `start pitch ${d.start.pitch} vs ${p}`);
  let worst = 0; for (let s = 5; s < P.length - 5; s += 2) worst = Math.max(worst, Math.abs(D.channelAt(P, 'kv', s).v) * R, Math.abs(D.channelAt(P, 'kh', s).v * R / Math.cos(p) - 1));
  assert.ok(worst < 2e-3, `worst ${worst}`);
});

test('a real track from reads/ opens as a LOCAL example (skipped where reads/ has no position fit)', (t) => {
  const reads = process.env.T180_READS || path.join(__dirname, '..', 'reads');
  const f = path.join(reads, 'serpents_spiral.pieces.json'), r = path.join(reads, 'serpents_spiral.read.json');
  if (!fs.existsSync(f) || !fs.existsSync(r)) { t.skip('no local position fit of Serpents Spiral in reads/ (other authors\' tracks stay local)'); return; }
  const d = D.fromPositionFit(JSON.parse(fs.readFileSync(f, 'utf8')), JSON.parse(fs.readFileSync(r, 'utf8')), { name: 'Serpents (local)' });
  const { toPath } = require('../src/core/adapter.js'), { path: p } = toPath(d);
  assert.ok(d.pieces.length >= 1 && p.lengthM > 1900 && p.lengthM < 2300, `${d.pieces.length} pieces, ${p.lengthM} m`);
  assert.equal(D.serialize(D.parse(D.serialize(d))), D.serialize(d));
});
