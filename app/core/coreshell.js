// coreshell.js: the app's state and actions for the EQUATION CORE (the core spec's build step (d), D186, pane C). No DOM and no
// Tauri, so it runs headless under node --test and unchanged in the webview (app/lib/cjs.js), exactly like app/shell.js, which
// stays the PIECE builder's (paused, not deleted; the page chooses one of the two, app/index.html).
//
//   const shell = await createCoreShell({ storage, exporter })
//   shell.extend({ length, targets })   shell.candidate({ length, targets })   shell.undo()   shell.redo()
//   shell.beginBrush({ mode, channel, s0, r })   shell.brushTo(delta)   shell.endBrush()      one undo step per drag
//   shell.close()   shell.pour(track, { speedKmh, count, fromS, lengthM })   shell.clearWater()
//   await shell.exportTo(dir)   shell.openExample(fitText, readText, name)   await shell.save(name)   await shell.open(name)
//
// THE SEAM IS THE PIECE BUILDER'S (app/README.md "The seam"), so the preview, the cameras and validation are reused unchanged:
//   state.resolved = { segments, closed }: `segments` are src/core/adapter.js toSegments(doc), the same src/geom segments the
//   piece builder resolves to, so app/preview/trackmodel.js diffs them and extends or sculpts the mesh incrementally by itself.
//   state.history.present is the CORE document (src/core/document.js), with its own undo history.
// Every edit goes through the core (src/core: extend, sculpt, close); the shell never edits a document itself.
// A FAILED ACTION changes nothing and says why (state.message), as app/shell.js does.
// TIMING: state.lastStep = { op, ms } for the last edit, the document operation plus the adapter's segments (spec test 6's
// "per step" is measured by the bench on the same calls, not on this field).
'use strict';

const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const SC = require('../../src/core/sculpt.js');
const { sculpt, pieceOffsets } = SC;
const { close } = require('../../src/core/close.js');
const AD = require('../../src/core/adapter.js');
const { toSegments } = AD;
// A's offset channels h and l (the chair's ruling 1, D186): offsetPath(doc, segments, path) lifts a path and recomputes its frame.
// Not at 17c2301; when the adapter exports it, the shell hands it on as `resolved.lift`, so the preview, the water and the export
// read the road AS BRUSHED (the segments alone do not carry the offsets).
const offsetPath = typeof AD.offsetPath === 'function' ? AD.offsetPath : null;
const W = require('../../src/core/water.js');
// THE READOUT (L130, A's src/core/readout.js): a piece's length and the change it makes in turn, climb and bank, for the panel
// (the ghost, candidateReadout) and the labels on the track (every placed piece, pieceReadout)
const RD = require('../../src/core/readout.js');
// THE HEAD'S STATE (D193): what the track is doing at its open end, for Extend's fields to SHOW instead of blanks. On an empty track it
// is the state extend() starts the first piece from (src/core/extend.js: level, straight, the family's measured width and rate)
const { WIDTHS, RATES } = require('../../src/geom/fonts.js');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/;
const PREFIX = 'eq-';                 // core documents are stored beside the piece builder's under this prefix
const BRUSH_MODES = Object.freeze(['local', 'rate']);
// E's BRUSH (p-d186-brush-E): src/core/sculpt.js brush(doc, { mode: 'hill' | 'swerve' | 'value' | 'rate', channel, s0, r, delta })
// -> { doc, note? }. It is used when sculpt.js exports it (not at 17c2301, where this was written; E's D186 adds it), and may be
// injected (`brushFn`, tests). The LOCAL brush is its hill (channel 'height') and swerve ('lateral'); they need the document's
// offset channels h and l (A's, pending the chair's decision), and until then E's brush refuses them by name (NOT_YET), which the
// shell shows as the message. With no E brush at all the local mode is not offered, and the rate brush is D185's sculpt().

async function createCoreShell({ storage = null, exporter = null, brushFn = typeof SC.brush === 'function' ? SC.brush : null, now = () => Date.now() } = {}) {
  const ok = (msg) => ({ message: msg, messageKind: 'ok' });
  let st = {
    mode: 'core', history: D.createHistory(D.createDoc('untitled')), resolved: { segments: [], closed: false }, resolveError: null,
    message: null, messageKind: null, name: null, dirty: false, lastEdited: null, lastStep: null, brush: null, water: null, exportReds: null,
    localBrush: !!brushFn,
  };
  const subs = new Set();
  const set = (patch) => {
    if ('message' in patch && !('messageKind' in patch)) patch = { ...patch, messageKind: patch.message ? 'error' : null };
    st = Object.freeze({ ...st, ...patch }); for (const f of subs) f(st); return st;
  };
  const doc = () => st.history.present;
  let reads = [], readsFor = null;
  const segmentsOf = (d) => (d.pieces.length ? toSegments(d) : []);
  // THE START POSE travels with the segments (found by test 1, D186): the geometry's shape depends on the start PITCH, so a path
  // grown from the origin at pitch 0 is not the document's lap. A real track opened as an example starts where its first station is.
  const startOf = (d) => ({ pos: d.start.pos.slice(), theta: d.start.heading, p: d.start.pitch });
  const resolvedOf = (d) => { const segments = segmentsOf(d); return { resolved: Object.freeze({ segments, closed: !!d.closed, start: startOf(d), lift: offsetPath && segments.length ? (p) => offsetPath(d, segments, p) : undefined }), resolveError: null }; };
  /** Run an edit; a core error becomes the message, and nothing else changes. */
  // src/core/water.js refuses with plain Errors whose message starts "water:" (e.g. a lifted track whose samples do not carry
  // d1/d2): a refusal the user reads, never a crash of the panel
  const attempt = (fn) => { try { return fn(); } catch (e) { if (e.name === 'CoreError' || e.name === 'WaterError' || /^water: /.test(e.message || '')) { set({ message: e.message }); return null; } throw e; } };
  /** Commit a new document as one undo step, timing the operation plus the adapter. */
  const commit = (op, make, extra = {}) => attempt(() => {
    const t0 = now(), d = make(), r = resolvedOf(d), ms = now() - t0;
    return set({ history: D.commit(st.history, d), ...r, dirty: true, message: null, water: null, lastStep: { op, ms }, ...extra });
  });
  const lastRoad = (d) => { for (let i = d.pieces.length - 1; i >= 0; i--) if (d.pieces[i].type === 'road') return i; return -1; };
  // the brush, as E's hand-back gives its API: height -> hill, sideways -> swerve; a rate channel (kh, kv) -> rate, which re-closes a
  // closed lap itself; bank, width, rise -> value. Without E's brush, the rate brush is D185's sculpt().
  const brushed = (b, delta) => {
    const at = { s0: b.s0, r: b.r, delta, ...(b.sharp ? { sharp: true } : {}) };   // sharp: E's opt-in (ruling 2), off by default
    if (b.mode === 'local') return brushFn(b.base, { mode: b.channel === 'lateral' ? 'swerve' : 'hill', ...at });
    if (brushFn) return brushFn(b.base, { mode: b.channel === 'kh' || b.channel === 'kv' ? 'rate' : 'value', channel: b.channel, ...at });
    return sculpt(b.base, { channel: b.channel, ...at });
  };

  const api = {
    getState: () => st,
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    brushModes: () => BRUSH_MODES.filter((m) => m !== 'local' || !!brushFn),

    /** EXTEND at the build head: one new piece continuing the last (src/core/extend.js). `targets` set channels (absolute). */
    extend: (opts) => commit('extend', () => extend(doc(), opts), { lastEdited: [doc().pieces.length] }),
    /** The GHOST of an extension: the track as it would be, not committed (the preview's 't180-ghost' candidate). */
    candidate: (opts) => { const d = extend(doc(), opts); return { segments: segmentsOf(d), closed: false, start: startOf(d) }; },
    /** The ghost's readout: what extend(opts) would place, before it is placed (A: the same numbers as after). Throws on bad fields. */
    candidateReadout: (opts) => RD.candidateReadout(doc(), opts),
    /**
     * The head's END state in the core's units: kh, kv (rad/m), phi (rad), w (m), c (degrees; a legacy piece's is the edge it renders).
     * An empty track gives the first piece's START (extend.js's own: bowl, level, straight, WIDTHS.bowl, the edge that renders). Read only.
     */
    headState() {
      const e = D.endState(doc());
      if (e) return { kh: e.kh.v, kv: e.kv.v, phi: e.phi.v, w: e.w.v, c: e.c.v };
      const fam = 'bowl';   // extend.js: `family || (last ? last.family : 'bowl')`
      return { kh: 0, kv: 0, phi: 0, w: WIDTHS[fam], c: D.legacyEdgeDeg(fam, WIDTHS[fam], RATES[fam]) };
    },
    /** Every placed piece's readout, in order: computed ONCE per document (the labels read it every frame). */
    pieceReadouts() { const d = doc(); if (readsFor !== d) { reads = d.pieces.map((_, i) => RD.pieceReadout(d, i)); readsFor = d; } return reads; },

    /**
     * THE BRUSH, one drag = one undo step. beginBrush fixes the brush (its mode, channel, centre s0 and radius r, all on the
     * document as it was when the drag began); brushTo(delta) applies the WHOLE delta to that base, so a drag never
     * accumulates rounding; endBrush commits. mode 'local' is E's height/lateral brush (channel 'height' | 'lateral');
     * 'rate' is src/core/sculpt.js on one channel (kh, kv, phi, w, r).
     */
    beginBrush({ mode = brushFn ? 'local' : 'rate', channel, s0, r, sharp = false }) {
      if (!BRUSH_MODES.includes(mode)) return set({ message: `brush mode "${mode}" is not one of ${BRUSH_MODES.join(', ')}` });
      if (mode === 'local' && !brushFn) return set({ message: 'the height/lateral brush is not in this build yet (E, p-d186-brush-E): use the rate brush' });
      if (st.brush) return set({ message: 'a brush drag is already open' });
      // D185's sculpt cannot re-close; E's rate brush does, so this guard is only for the fallback
      if (!brushFn && doc().closed && mode === 'rate' && (channel === 'kh' || channel === 'kv')) return set({ message: 'the loop is closed: a heading or pitch rate brush would open it. Undo the close, or brush height, bank or width' });
      return attempt(() => set({ history: D.beginDrag(st.history), brush: { mode, channel, s0, r, sharp: !!(sharp && brushFn), base: doc(), delta: 0 }, message: null }));
    },
    brushTo(delta) {
      const b = st.brush; if (!b) return set({ message: 'no brush drag is open' });
      return attempt(() => {
        const t0 = now(), res = brushed(b, delta), d = res.doc, r = resolvedOf(d), ms = now() - t0;
        // the radius the brush really used (E's brush widens a narrow one; the chair's RULING 2: always shown), and any note of its
        // the radius really used: E's brush reports it as radiusUsed (sculpt.js), shown whenever it widened (ruling 2)
        const used = Number.isFinite(res.radiusUsed) ? res.radiusUsed : Number.isFinite(res.rUsed) ? res.rUsed : null;
        const widened = used !== null && used > b.r + 1e-9 ? `brush widened to ${used.toFixed(0)} m (asked ${b.r.toFixed(0)} m), so the track outside it stays exactly as it was` : null;
        // a rate brush on a closed lap re-closes (E): a re-close that failed left the track OPEN, and says so
        const reclose = res.close && !res.close.converged ? `the loop could not re-close after this brush, so it is open now: ${res.close.report}` : null;
        const note = [widened, res.note, reclose].filter(Boolean).join(' · ') || null;
        return set({ history: D.dragTo(st.history, d), ...r, brush: { ...b, delta, rUsed: used }, dirty: true, water: null, lastStep: { op: `brush:${b.mode}`, ms }, message: note, messageKind: note ? 'ok' : null });
      });
    },
    endBrush() {
      const b = st.brush; if (!b) return st;
      // the brushed pieces are what close() goes round (the brush's window)
      return attempt(() => set({ history: D.endDrag(st.history), brush: null, lastEdited: piecesIn(doc(), b.s0 - b.r, b.s0 + b.r) }));
    },
    /** One brush stroke with no drag (keys, tests): one undo step. */
    sculptOnce: (b) => commit(`brush:${b.mode || 'rate'}`, () => brushed({ mode: 'rate', ...b, base: doc() }, b.delta).doc, { lastEdited: piecesIn(doc(), b.s0 - b.r, b.s0 + b.r) }),

    /** CLOSE in one click (src/core/close.js): the correction goes round the stretch edited last. */
    close() {
      if (doc().closed) return set({ message: 'the loop is already closed' });
      if (lastRoad(doc()) < 0) return set({ message: 'there is no road to close yet: extend first' });
      return attempt(() => {
        // the correction goes round the stretch edited last AND the user's straights: close.js spreads it over every piece it
        // is not told to avoid, and left alone it bent a 300 m straight to a 370 m radius (measured, D186 C). Guarded, the
        // straight keeps |κ| ≤ 1.2e-4 rad/m on that lap: nearly, not exactly, straight (the joints tie it to its neighbours)
        const last = lastRoad(doc()), edited = [...new Set([...(st.lastEdited || [last]), ...straightPieces(doc())])];
        const t0 = now(), res = close(doc(), { edited });
        if (!res.converged) return set({ message: res.report });
        const r = resolvedOf(res.doc);
        return set({ history: D.commit(st.history, res.doc), ...r, dirty: true, water: null, lastStep: { op: 'close', ms: now() - t0 }, ...ok(`loop closed: ${res.report}`) });
      });
    },

    /**
     * POUR WATER on the track the preview draws (`track` = its shared { path, segments }: the 't180:track' event), over a window
     * of the road: [fromS, fromS + lengthM], default the last `lengthM` metres before the head on an open track and the lap's
     * start on a closed one. Streams start across the width at the design speed (src/core/water.js). The result, in
     * state.water: each stream as world points for the overlay, and every red in plain words.
     */
    pour(track, { speedKmh = 250, count = 7, fromS, lengthM = 1500, h = 0.02 } = {}) {
      if (!track || !track.path || !Array.isArray(track.segments)) return set({ message: 'there is no track to pour water on yet' });
      return attempt(() => {
        const p = track.path, L = p.lengthM, closed = !!p.closed;
        const a = fromS !== undefined ? fromS : closed ? 0 : Math.max(0, L - lengthM), b = Math.min(L, a + lengthM);
        const run = waterRun(p, track.segments, a, b);
        if (run.samples.length < 2) return set({ message: `no road to pour on between ${Math.round(a)} and ${Math.round(b)} m${run.gap ? ' (a jump\'s flight)' : ''}` });
        const t0 = now(), F = W.surfaceFrom({ samples: run.samples, profileAt: profilerOf(p, track.segments) });
        const res = W.pour(F, { speed: speedKmh / 3.6, count, h, distance: run.samples[run.samples.length - 1].s - run.samples[0].s });
        const streams = res.streams.map((sm) => sm.track.s.map((s, i) => W._at(F, s, sm.track.u[i]).p));
        // a shock carries no position (water.js): it is placed on the surface at its (s, u), for the overlay
        const reds = res.reds.map((x) => ({ ...x, pos: x.pos || W._at(F, x.s, x.u).p, text: redText(x, speedKmh) }));
        return set({ water: Object.freeze({ fromS: a, toS: b, speedKmh, streams, reds, energy: res.energy, cutAt: run.gap ? run.samples[run.samples.length - 1].s : null, ms: now() - t0 }) });   // a message it did not write stays (a refused close must stay readable)
      });
    },
    clearWater: () => set({ water: null }),

    undo: () => attempt(() => { if (st.brush) return set({ message: 'finish the brush drag first' }); const h = D.undo(st.history); return set({ history: h, ...resolvedOf(h.present), dirty: true, water: null, message: null }); }),
    redo: () => attempt(() => { if (st.brush) return set({ message: 'finish the brush drag first' }); const h = D.redo(st.history); return set({ history: h, ...resolvedOf(h.present), dirty: true, water: null, message: null }); }),
    /** Put a prepared core document in front of the user, as opening one does: fresh history, nothing to undo. */
    adopt: (d) => attempt(() => { D.checkDoc(d); return set({ history: D.createHistory(d), ...resolvedOf(d), name: null, dirty: false, lastEdited: null, water: null, message: null, exportReds: null }); }),
    newDoc(name = 'untitled') { const d = D.createDoc(name); return set({ history: D.createHistory(d), ...resolvedOf(d), name: null, dirty: false, lastEdited: null, water: null, message: null, exportReds: null }); },

    /**
     * A REAL TRACK AS A LOCAL EXAMPLE: D184's position fit (`tools/piecewise.cjs --write`, t180b.pieces/1) and the read it was
     * fitted from, both picked by the user from their own reads/ folder. It opens OPEN (close it with one click), with a fresh
     * history, unsaved. Another author's layout: it is never part of the program, and nothing here writes it anywhere.
     */
    openExample(fitText, readText, name = 'Local example') {
      return attempt(() => {
        let fit, read;
        try { fit = JSON.parse(fitText); read = JSON.parse(readText); } catch (e) { throw new D.CoreError('BAD_EXAMPLE', `the example files are not JSON: ${e.message}`); }
        const d = D.fromPositionFit(fit, read, { name });
        return set({ history: D.createHistory(d), ...resolvedOf(d), name: null, dirty: true, lastEdited: null, water: null, exportReds: null, ...ok(`opened ${name}: ${d.pieces.length} pieces, open; close it to export`) });
      });
    },

    /** EXPORT through the existing exporter (src/export/fromwords.js exportSegments, app/export/export.js), into `dir`. */
    async exportTo(dir, opts = {}) {
      if (!exporter) return set({ message: 'export is not available here' });
      if (!doc().closed) return set({ message: 'the loop is not closed: close it first (one click), then export', exportReds: null });
      const g = exporter.checkTarget(dir);
      if (!g.ok) return set({ message: g.reason, exportReds: null });
      let out;
      let markers;
      try { markers = startLayout(st.resolved.segments, st.resolved.lift, st.resolved.start); } catch (e) { if (e.code !== 'NO_START_STRAIGHT') throw e; return set({ message: `not exported: ${e.message}`, exportReds: null }); }
      try { out = exporter.runSegments(st.resolved.segments, { name: st.name || doc().name, description: 'Built from equations by t180-track-builder.', via: 'src/core/adapter.js toSegments', liftPath: st.resolved.lift, start: st.resolved.start }, { ...opts, markers }); } catch (e) {
        if (e.name !== 'ExportError') throw e;
        return set({ message: e.message, exportReds: e.code === 'RED' ? e.red : null });
      }
      if (!storage || typeof storage.writeExport !== 'function') return set({ message: 'there is nowhere to write the export here' });
      for (const f of out.folders) await storage.writeExport(dir, f.folder, f.files);
      const w = out.result.warnings && out.result.warnings.length ? ` (${out.result.warnings.length} warning${out.result.warnings.length > 1 ? 's' : ''}: ${out.result.warnings.join(' · ')})` : '';
      return set({ ...ok(`exported ${out.folders.map((f) => f.folder).join(', ')} to ${dir}${w}`), exportReds: null, lastExport: { dir, folders: out.folders.map((f) => f.folder) } });
    },

    async save(name) {
      if (!storage) return set({ message: 'saving is not available here' });
      if (!NAME_RE.test(name || '')) return set({ message: `a track name is 1 to 60 letters, digits, spaces, _ or -, starting with a letter or digit; got ${JSON.stringify(name)}` });
      await storage.saveDoc(PREFIX + name, D.serialize(doc()));
      return set({ name, dirty: false, message: null });
    },
    async open(name) {
      if (!storage) return set({ message: 'opening is not available here' });
      const text = await storage.openDoc(PREFIX + name), d = attempt(() => D.parse(text));
      if (!d) return st;
      return set({ history: D.createHistory(d), ...resolvedOf(d), name, dirty: false, lastEdited: null, water: null, message: null, exportReds: null });
    },
    /** The saved equation tracks (the piece builder's are not listed here). */
    async list() { if (!storage) return []; return (await storage.listDocs()).filter((n) => n.startsWith(PREFIX)).map((n) => n.slice(PREFIX.length)); },
    text: () => D.serialize(doc()),
    /** The design speed from the validation panel's slider: kept for the water's default, not part of the document. */
    setDesignSpeed(kmh) { if (!(kmh === null || (Number.isFinite(kmh) && kmh > 0))) return set({ message: `the design speed must be a positive km/h, or null, got ${kmh}` }); return set({ designSpeedKmh: kmh }); },
  };
  return api;
}

/**
 * The cross-section under a path sample, as the mesh draws it: the segment's profile, or, where the segment carries a blend (a cup's do,
 * D190), the blend evaluated at the sample. A segment without a blend gives its own profile object, so the water reads it as before.
 */
function profilerOf(path, segments) {
  const Prof = require('../../src/geom/profile.js'), starts = []; let a = path.samples[0].s;
  for (const g of segments) { starts.push(a); a += g.length; }
  return (m) => { const g = segments[m.seg]; return g.cup && g.blend ? Prof.atSegment(g, m.s - starts[m.seg]) : g.profile; };
}

/** The road pieces the user built exactly straight and level (κh, κv and φ all exactly 0): close.js is told to go round them. */
function straightPieces(doc) { return doc.pieces.map((P, i) => (P.type === 'road' && ['kh', 'kv', 'phi'].every((ch) => P.channels[ch].every((c) => c === 0)) ? i : -1)).filter((i) => i >= 0); }

/**
 * THE START STRAIGHT for the export's grid, on a core track. src/markers/layout.js defaultLayout puts the grid on the longest run
 * of segments that are EXACTLY straight words (word 'straight', every curvature and roll 0). A core track has no words, and a
 * closed one has no exactly straight segment (the close leaves |κ| ~1e-4 rad/m on a guarded straight). So the layout is computed
 * by defaultLayout itself, on the REAL closed path, with each segment that is nearly straight (|κh|, |κv| ≤ STRAIGHT_K, radius
 * ≥ 5 km; |roll| ≤ STRAIGHT_ROLL) marked as a straight for the choice ONLY. Its result is anchors (segment id and distance
 * along it) and the grid's size; the export then places every marker on the real road and runs its own checks on them, unchanged.
 */
const STRAIGHT_K = 1 / 5000, STRAIGHT_ROLL = 0.5 * Math.PI / 180;
function startLayout(segments, lift, start) {
  const { buildPath } = require('../../src/geom/index.js'), Markers = require('../../src/markers/layout.js');
  const nearly = (g) => g.kind === 'road' && [g.k0, g.k1, g.kp0, g.kp1].every((x) => Math.abs(x) <= STRAIGHT_K) && [g.roll0, g.roll1].every((x) => Math.abs(x) <= STRAIGHT_ROLL);
  const marked = segments.map((g) => (nearly(g) ? { ...g, word: 'straight', k0: 0, k1: 0, kp0: 0, kp1: 0, roll0: 0, roll1: 0 } : g));
  const p = buildPath(segments, { step: 2, closed: true, ...(start ? { start } : {}) });
  return Markers.defaultLayout(lift ? lift(p) : p, marked);
}

/** The road pieces overlapping [a, b] of the path's s (the adapter's s, flights and ramps included: sculpt.js pieceOffsets), for
 *  close's "edited last". */
function piecesIn(doc, a, b) {
  const off = pieceOffsets(doc), out = [];
  doc.pieces.forEach((P, i) => { if (P.type === 'road' && off[i] + P.length >= a && off[i] <= b) out.push(i); });
  return out.length ? out : null;
}

/**
 * The samples the water rides between s = a and b: the path's own stations, cut at the first sample with no road under it (a
 * jump's flight, which the water does not model; src/core/water.js refuses a gap by name). Returns { samples, gap }.
 */
function waterRun(path, segments, a, b) {
  const out = []; let gap = false;
  for (const m of path.samples) {
    if (m.s < a - 1e-9) continue; if (m.s > b + 1e-9) break;
    const g = segments[m.seg];
    if (!g || g.kind === 'gap' || !g.profile) { if (out.length) { gap = true; break; } continue; }
    if (out.length && !(m.s > out[out.length - 1].s)) continue;
    out.push(m);
  }
  return { samples: out, gap };
}

/** A red, in plain words (the spec: "in RED, where it spills over the lip, lifts off, or crosses itself"). */
function redText(x, speedKmh) {
  const at = `${Math.round(x.s).toLocaleString('en-US')} m`;
  if (x.type === 'spill') return `Water spills over the ${x.u > 0 ? 'left' : 'right'} edge at ${at}: at ${speedKmh} km/h this corner needs more bank or a higher wall.`;
  if (x.type === 'liftoff') return `Water lifts off the road at ${at}: the crest is too sharp for ${speedKmh} km/h.`;
  if (x.type === 'shock') return `Two streams cross at ${at}: the flow piles into one line there.`;
  return `${x.type} at ${at}`;
}

module.exports = { createCoreShell, NAME_RE, PREFIX, BRUSH_MODES, STRAIGHT_K, waterRun, redText, piecesIn, straightPieces, startLayout, profilerOf };
