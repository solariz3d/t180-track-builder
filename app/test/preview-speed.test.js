// preview-speed.test.js: node --test app/test/preview-speed.test.js   (under the heavy-run lock, --max-old-space-size=4096; about a minute)
// D235 part 2 (the keeper: "make the changes render faster while you change it from one to the next? Sometimes it lags and is so slow"). The preview path ONLY; the export
// never sees any of this (core_cup_fixtures is the proof, run beside it). Rows:
//   1  coarsen: the row grid thinned, the road's two edges kept, rows that shared a grid still share one, an unchanged segment is the same object, and detail 1 is the same array
//   2  the track model: a coarse detail meshes far fewer vertices; the detail back to 1 equals a fresh full build; the real segments are returned; the very same document
//      builds nothing again (a closed loop used to rebuild in full on every state change); a change of detail on an open track is a full rebuild
//   3  batchesOf(mesh, from) is batchesOf(mesh) filtered to the new pieces, and the ghost uses it
//   4  the preview: a brush drag makes the model coarse, full detail comes back ONCE, shortly after the drag ends, unless another drag starts first
//   5  the panel: pointer moves are coalesced to one brushTo per animation frame (the latest position), and the release applies the last one still waiting
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/core/document.js');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const { batchesOf } = require('../preview/batches.js');
const { coarsen, FACTOR } = require('../preview/coarse.js');
const P = require('../preview/preview.js');

const R = 180, Q = (Math.PI * R) / 2;
/** An OPEN track of tube pieces (the segments carry a row grid, `fractions`): 200 m closed tube, then two quarter turns. */
async function tubeShell(pieces = 3) {
  const s = await createCoreShell({ brushFn: null });
  s.extend({ length: 200, first: { w: 31, t: 360 } });
  for (let i = 1; i < pieces; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  assert.equal(s.getState().message, null, s.getState().message); return s;
}
const verts = (batches) => batches.reduce((a, b) => a + b.positions.length / 3, 0);

test('row 1: coarsen thins the row grid, keeps the road\'s two edges, keeps shared grids shared and unchanged segments the same objects; detail 1 is the same array', () => {
  const fr = Array.from({ length: 101 }, (_, i) => i / 100), other = [0, 0.25, 0.5, 0.75, 1];
  const a = { id: 'a', fractions: fr, profile: 1 }, b = { id: 'b', fractions: fr, profile: 2 }, plain = { id: 'c', profile: 3 }, tiny = { id: 'd', fractions: [0, 1] }, o = { id: 'e', fractions: other };
  const segs = [a, b, plain, tiny, o], c = coarsen(segs, 6);
  assert.equal(FACTOR, 6); assert.equal(coarsen(segs, 1), segs, 'detail 1 returns the very same array'); assert.equal(coarsen(segs, 0), segs);
  assert.equal(c[0].fractions[0], 0); assert.equal(c[0].fractions[c[0].fractions.length - 1], 1, 'both edges kept');
  assert.equal(c[0].fractions.length, Math.ceil(101 / 6) + 1 - (100 % 6 === 0 ? 1 : 0), `101 fractions at factor 6: ${c[0].fractions.length}`);
  assert.ok(c[0].fractions.every((x, i, v) => i === 0 || x > v[i - 1]), 'strictly increasing'); assert.ok(c[0].fractions.every((x) => fr.includes(x)), 'every kept fraction is one of the originals');
  assert.equal(c[0].fractions, c[1].fractions, 'two segments that shared a grid share the thinned one: no seam zipper appears between them');
  assert.equal(c[2], plain, 'a segment with no grid is untouched'); assert.equal(c[3], tiny, 'a grid of two (just the edges) is untouched');   assert.deepEqual(c[4].fractions, [0, 1], 'five fractions at factor 6 keep the two edges');
  const again = coarsen(segs, 6); assert.equal(again[0], c[0], 'an unchanged segment is the same object from one call to the next'); assert.equal(a.fractions.length, 101, 'the input is not edited');
  assert.equal(c[0].profile, 1, 'every other field is carried');
});

test('row 2: the model meshes far fewer vertices at a coarse detail, comes back to EXACTLY a fresh full build, returns the real segments, builds nothing for the same document', async () => {
  const s = await tubeShell(), r = s.getState().resolved, full = createTrackModel(), tm = createTrackModel();
  const f = full.update(r), vFull = verts(f.batches);
  assert.equal(tm.detail, 1); assert.equal(tm.setDetail(FACTOR), FACTOR); assert.equal(tm.setDetail(FACTOR), FACTOR);
  const c = tm.update(r); const vCoarse = verts(c.batches);
  assert.equal(c.how, 'full'); assert.ok(vCoarse < 0.35 * vFull, `the coarse mesh has ${vCoarse} vertices against ${vFull} (${(100 * vCoarse / vFull).toFixed(0)}%)`); assert.ok(vCoarse > 0.05 * vFull, 'control: it is not empty');
  assert.equal(c.segments, r.segments, 'the model returns the REAL segments (the validation and the shell read them), whatever it meshed');
  assert.equal(c.path.lengthM, f.path.lengthM, 'the path is the same: only the mesh is coarser');
  // a coarse vertex is a vertex of the full mesh (the grid is thinned, never moved): the first cell
  const key = (b, i) => [0, 1, 2].map((k) => b.positions[i * 3 + k].toFixed(4)).join(','), set0 = new Set(); for (let i = 0; i < f.batches[0].positions.length / 3; i++) set0.add(key(f.batches[0], i));
  const miss = []; for (let i = 0; i < c.batches[0].positions.length / 3; i++) if (!set0.has(key(c.batches[0], i))) miss.push(i); assert.equal(miss.length, 0, `${miss.length} coarse vertices are not full-mesh vertices`);
  const same = tm.update(r); assert.equal(same.how, 'same'); assert.equal(same.batches, c.batches, 'the very same document builds nothing again');
  tm.setDetail(1); const back = tm.update(r); assert.equal(back.how, 'full');
  assert.equal(verts(back.batches), vFull); assert.equal(back.batches.length, f.batches.length);
  for (const k of [0, 5, f.batches.length - 1]) { assert.deepEqual(Array.from(back.batches[k].positions), Array.from(f.batches[k].positions), `batch ${k}: positions equal a fresh full build`); assert.deepEqual(Array.from(back.batches[k].indices), Array.from(f.batches[k].indices)); }
});

test('row 2b: a change of detail on an OPEN track is a full rebuild, not an incremental one; and a closed loop\'s same-document update is the same build (it used to rebuild in full every time)', async () => {
  const s = await tubeShell(), tm = createTrackModel(); tm.update(s.getState().resolved); s.extend({ length: 100 });
  assert.equal(tm.update(s.getState().resolved).how, 'extend', 'control: appending is incremental');
  tm.setDetail(FACTOR); assert.equal(tm.update(s.getState().resolved).how, 'full', 'a detail change is a full rebuild');
  s.extend({ length: 100 }); assert.notEqual(tm.update(s.getState().resolved).how, 'full', 'at a steady coarse detail the open track grows incrementally again');
  const lap = await createCoreShell({ brushFn: null }); lap.extend({ length: 300, family: 'bowl' }); for (let i = 0; i < 4; i++) lap.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); lap.extend({ length: 60, transition: 40, targets: { kh: 0 } }); lap.close();
  assert.equal(lap.getState().history.present.closed, true, lap.getState().message);
  const t = createTrackModel(), closedDoc = lap.getState().resolved, first = t.update(closedDoc); assert.equal(first.how, 'full'); const again = t.update(closedDoc); assert.equal(again.how, 'same'); assert.equal(again.mesh, first.mesh, 'a closed loop is not rebuilt for the same document');
  assert.equal(t.update({ ...closedDoc }).how, 'full', 'a NEW resolved object is still rebuilt (a closed loop always was)');
});

test('row 3: batchesOf(mesh, from) is the batches of the pieces from there on, equal to the full list filtered; the ghost builds only the new pieces', async () => {
  const s = await tubeShell(), tm = createTrackModel(); const tr = tm.update(s.getState().resolved), m = tr.mesh, all = batchesOf(m), lastId = tr.segments[tr.segments.length - 1].id, from = tr.segments.findIndex((g) => g.id === lastId);   // a piece boundary: where a ghost's new pieces start
  const part = batchesOf(m, from), want = all.filter((b) => b.piece >= from);
  assert.ok(part.length > 0 && part.length < all.length, `${part.length} of ${all.length}`); assert.equal(part.length, want.length);
  part.forEach((b, i) => { assert.equal(b.key, want[i].key); assert.equal(b.positions, want[i].positions, 'the same arrays'); assert.equal(b.piece, want[i].piece); });
  assert.equal(batchesOf(m, 0).length, all.length); assert.equal(batchesOf(m).length, all.length);
  const cand = (() => { const r = s.getState().resolved; s.extend({ length: 60 }); const c = s.getState().resolved; s.undo(); return c; })();
  const g = tm.ghostFor(cand); assert.ok(g.batches.length > 0 && g.batches.every((b) => b.piece >= tr.segments.length), 'the ghost has the new piece\'s batches and the seam onto it, and nothing of the placed track');
});

test('row 4: a brush drag makes the preview coarse; full detail comes back ONCE, shortly after the drag ends, and not if another drag starts first', async () => {
  const s = await tubeShell(), timers = new Map(); let nextId = 1; const cleared = [];
  const win = { devicePixelRatio: 1, document: { hidden: false, activeElement: null, body: {}, addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: (f, ms) => { const id = nextId++; timers.set(id, { f, ms }); return id; }, clearTimeout: (id) => { cleared.push(id); timers.delete(id); } };
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0 }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  const p = P.createPreview({ canvas, shell: s, win }), v = () => p.view(), vertsNow = () => verts(v().track.batches);
  assert.equal(v().detail, 1); const vFull = vertsNow();
  s.beginBrush({ mode: 'rate', channel: 'phi', s0: 100, r: 60 }); s.brushTo(0.01);
  assert.equal(v().detail, FACTOR, 'dragging: coarse'); assert.ok(vertsNow() < 0.35 * vFull, `${vertsNow()} against ${vFull}`); assert.equal(timers.size, 0, 'no full rebuild is scheduled while dragging');
  s.brushTo(0.02); assert.equal(v().detail, FACTOR);
  s.endBrush(); assert.equal(v().detail, FACTOR, 'the drag ended: still coarse, a moment'); assert.equal(timers.size, 1, 'one full rebuild scheduled'); const [[id, t]] = [...timers]; assert.equal(t.ms, 250);
  // another drag starts before it fires: the timer is cancelled and the preview stays coarse
  s.beginBrush({ mode: 'rate', channel: 'phi', s0: 100, r: 60 }); assert.ok(cleared.includes(id), 'the pending full rebuild was cancelled'); assert.equal(timers.size, 0); s.brushTo(0.03); s.endBrush(); assert.equal(timers.size, 1);
  const [[id2, t2]] = [...timers]; timers.delete(id2); t2.f();   // the timer fires
  assert.equal(v().detail, 1, 'full detail is back'); assert.equal(vertsNow(), verts(createTrackModel().update(s.getState().resolved).batches), 'and it is exactly the full build of the dragged track'); assert.equal(timers.size, 0, 'once');
  p.dispose();
});

// ── the panel: pointer moves coalesced to one brushTo per animation frame ──
class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.parent = null; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.ownerDocument.ids[v] = this; }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; }
  get isConnected() { return true; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
}
test('row 5: the panel coalesces pointer moves to ONE brushTo per animation frame with the LATEST position, and the release applies the last position still waiting', async () => {
  const doc = { ids: {}, listeners: {}, createElement: (t) => new El(t, doc) }; doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); }; doc.removeEventListener = () => {}; doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const frames = []; const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {} }; doc.defaultView = win;
  const tick = () => { const f = frames.splice(0); for (const g of f) g(0); };
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); doc.addEventListener('t180-pick', (ev) => ev.detail.reply({ s: 100 }));
  const real = await createCoreShell({ brushFn: null }); real.extend({ length: 300 }); real.extend({ length: 100 });
  const calls = []; const shell = Object.assign(Object.create(real), { brushTo(d) { calls.push(d); return real.brushTo(d); } });
  const root = doc.createElement('div'); require('../core/panel.js').mount(root, shell);
  const by = (label) => root.all().find((e) => e.attrs['aria-label'] === label); by('brush on').checked = true; by('brush mode').value = 'rate'; by('brush channel').value = 'phi';
  const ev = (y) => ({ button: 0, clientX: 10, clientY: y, preventDefault() {} }), at = (type, e) => (stage.listeners[type] || []).forEach((f) => f(e));
  at('pointerdown', ev(300)); assert.ok(real.getState().brush, 'the drag is open');
  for (const y of [295, 290, 280, 270]) at('pointermove', ev(y));
  assert.equal(calls.length, 0, 'four moves in one frame: nothing has run yet'); tick(); assert.equal(calls.length, 1, 'one brushTo for the frame'); assert.equal(calls[0], (300 - 270) * 0.002, 'with the LATEST position');
  tick(); assert.equal(calls.length, 1, 'no waiting position, no step');
  at('pointermove', ev(250)); at('pointermove', ev(240)); at('pointerup', ev(240));
  assert.equal(calls.length, 2, 'the release applied the position that was still waiting'); assert.equal(calls[1], (300 - 240) * 0.002); assert.equal(real.getState().brush, null, 'and the drag ended');
  tick(); assert.equal(calls.length, 2, 'the cancelled frame does nothing after the release');
  at('pointerup', ev(240)); assert.equal(calls.length, 2, 'a stray second release does nothing');
});

test('row 6: the fast change key is the JSON key\'s equality, hashed: equal content equal keys, any one-bit change differs, and on real segments it finds exactly the segments JSON finds', async () => {
  const { keyOf } = require('../preview/segkey.js');
  const o = { id: 'a', kind: 'road', length: 2, k0: 0.001, profile: { u: [-15.5, 0, 15.5], psi: [3.14, 0, -3.14] }, flags: [true, false, null], name: 'x' };
  assert.equal(keyOf(o), keyOf(JSON.parse(JSON.stringify(o))), 'equal content, equal key (a deep copy)'); assert.match(keyOf(o), /^[0-9a-z]+\.[0-9a-z]+$/);
  assert.equal(keyOf({ ...o, f() {}, g: undefined }), keyOf(o), 'functions and undefined are left out, as JSON leaves them out'); assert.equal(keyOf({ a: -0 }), keyOf({ a: 0 }), '-0 and 0 print alike');
  const next = (x) => { const b = new Float64Array([x]), u = new BigUint64Array(b.buffer); u[0] += 1n; return b[0]; };   // the next double up: one bit
  const diffs = [{ ...o, k0: next(o.k0) }, { ...o, length: 2.0000000000000004 }, { ...o, id: 'b' }, { ...o, name: 'xx' }, { ...o, flags: [true, true, null] }, { ...o, profile: { u: [-15.5, 0, 15.5, 16], psi: [3.14, 0, -3.14, 1] } },
    { ...o, profile: { u: [-15.5, 0, 15.5], psi: [3.14, 0, next(-3.14)] } }, { ...o, extra: 1 }, { kind: 'road', id: 'a', length: 2, k0: 0.001, profile: o.profile, flags: o.flags, name: 'x' }, { ...o, flags: [true, false] }];
  assert.notEqual(keyOf({ a: [[1], [2]] }), keyOf({ a: [[1, 2]] }), 'how the numbers are grouped into arrays matters (the length is part of the key)'); assert.notEqual(keyOf({ a: 1 }), keyOf({ b: 1 }), 'the names of the fields matter, not only their values');
  const base = keyOf(o), seen = new Set([base]); for (const d of diffs) { const k = keyOf(d); assert.ok(!seen.has(k), `a changed segment has its own key: ${JSON.stringify(d).slice(0, 60)}`); seen.add(k); }
  // on a REAL track: a brush changes some pieces; the segments whose JSON changed are exactly the ones whose fast key changed
  const s = await tubeShell(), before = s.getState().resolved.segments; s.beginBrush({ mode: 'rate', channel: 'phi', s0: 300, r: 60 }); s.brushTo(0.02); s.endBrush(); const after = s.getState().resolved.segments;
  const jsonDiff = [], fastDiff = []; for (let i = 0; i < Math.min(before.length, after.length); i++) { if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) jsonDiff.push(i); if (keyOf(before[i]) !== keyOf(after[i])) fastDiff.push(i); }
  assert.ok(jsonDiff.length > 5 && jsonDiff.length < before.length, `control: the brush changed ${jsonDiff.length} of ${before.length} segments`); assert.deepEqual(fastDiff, jsonDiff, 'the same segments');
  const same = tubeShell && await tubeShell(); const a = same.getState().resolved.segments, b = (await tubeShell()).getState().resolved.segments; assert.ok(a.every((g, i) => keyOf(g) === keyOf(b[i])), 'two builds of the same document key alike, segment for segment');
  const t0 = process.hrtime.bigint(); for (const g of before) JSON.stringify(g); const tj = Number(process.hrtime.bigint() - t0) / 1e6; const t1 = process.hrtime.bigint(); for (const g of before) keyOf(g); const tf = Number(process.hrtime.bigint() - t1) / 1e6;
  assert.ok(tf < tj, `control: the hash is faster than JSON.stringify (${tf.toFixed(1)} ms against ${tj.toFixed(1)} ms for ${before.length} segments)`);
});
