// coreshell.js: the app's state and actions for the EQUATION CORE (the core spec's build step (d), D186, pane C). No DOM and no
// Tauri, so it runs headless under node --test and unchanged in the webview (app/lib/cjs.js). Since D239 it is the app's ONLY builder
// (the keeper: "can we keep only the equation mode?"): app/shell.js, the old piece builder's shell, is kept only as a test driver for
// the shared preview and validation (its keys moved to app/core/keys.js; app/README.md says why).
//
//   const shell = await createCoreShell({ storage, exporter })
//   shell.extend({ length, targets })   shell.candidate({ length, targets })   shell.undo()   shell.redo()
//   shell.beginBrush({ mode, channel, s0, r })   shell.brushTo(delta)   shell.endBrush()      one undo step per drag
//   shell.close()
//   await shell.exportTo(dir)   shell.openExample(fitText, readText, name)   await shell.save(name)   await shell.open(name)
//   shell.buildExport(opts)   shell.exportDoc()   shell.commitDoc(doc)                       (D239: install and share codes use them)
//   shell.restore()   await shell.discardRecovery()   await shell.flushAutosave()   await shell.cleanExit()   (D239: autosave)
//   await shell.backupNow(reason)   await shell.listVersions()   await shell.openVersion(file)   (D239 amendment: previous versions;
//   every Save also moves the file it overwrites into track-backups, natively: src-tauri/src/backups.rs)
//
// AUTOSAVE AND CRASH RESTORE (D239, carried from the piece builder, app/shell.js, the same rules). While the track has unsaved changes it
// is written (debounced by `autosaveMs`) through storage.saveAutosave as { schema: 1, kind: 'core', name, doc } with the document's
// canonical text. Saving under a name, or cleanExit(), clears it. On the next start an autosave left behind is OFFERED as
// state.recovery, never applied behind the user's back: restore() takes it, discardRecovery() clears it. A damaged autosave's bytes are
// kept as a "damaged autosave" backup before this session may autosave over it (or, if they cannot be kept, it is left as it was and this
// session does not autosave), and the app starts anyway, saying so. THE OLD PIECES AUTOSAVE: the native side keeps ONE autosave file, and a piece-builder
// autosave left from before D239 (it has no `kind`) cannot be opened here; rather than let the first core autosave overwrite it, it is
// copied aside as an ordinary saved word track (storage.saveDoc, the name in the message), and only then is the file this builder's.
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
// Not at 17c2301; when the adapter exports it, the shell hands it on as `resolved.lift`, so the preview and the export
// read the road AS BRUSHED (the segments alone do not carry the offsets).
const offsetPath = typeof AD.offsetPath === 'function' ? AD.offsetPath : null;
// THE READOUT (L130, A's src/core/readout.js): a piece's length and the change it makes in turn, climb and bank, for the panel
// (the ghost, candidateReadout) and the labels on the track (every placed piece, pieceReadout)
const RD = require('../../src/core/readout.js');
// THE HEAD'S STATE (D193): what the track is doing at its open end, for Extend's fields to SHOW instead of blanks. On an empty track it
// is the state extend() starts the first piece from (src/core/extend.js: level, straight, the family's measured width and rate)
const { WIDTHS, RATES } = require('../../src/geom/fonts.js');
const XS = require('./xsec.js');   // the cross-section channels' names (D225): the edge curve and the tube

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/;
const PREFIX = 'eq-';                 // core documents are stored under this prefix; the old piece builder's word tracks (no prefix) stay on disk, unlisted (D239)
const BRUSH_MODES = Object.freeze(['local', 'rate']);
// E's BRUSH (p-d186-brush-E): src/core/sculpt.js brush(doc, { mode: 'hill' | 'swerve' | 'value' | 'rate', channel, s0, r, delta })
// -> { doc, note? }. It is used when sculpt.js exports it (not at 17c2301, where this was written; E's D186 adds it), and may be
// injected (`brushFn`, tests). The LOCAL brush is its hill (channel 'height') and swerve ('lateral'); they need the document's
// offset channels h and l (A's, pending the chair's decision), and until then E's brush refuses them by name (NOT_YET), which the
// shell shows as the message. With no E brush at all the local mode is not offered, and the rate brush is D185's sculpt().

// The default timers CALL the globals rather than hold them as methods (a browser's setTimeout refuses to run as a method of another
// object, "Illegal invocation", WebView2; app/test/timers-regression.test.js found it in the piece builder).
const callTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t) };
const exportError = (code, message) => Object.assign(new Error(message), { name: 'ExportError', code });

async function createCoreShell({ storage = null, exporter = null, brushFn = typeof SC.brush === 'function' ? SC.brush : null, now = () => Date.now(), autosaveMs = 1500, timers = callTimers } = {}) {
  const ok = (msg) => ({ message: msg, messageKind: 'ok' });
  // AUTOSAVE (D239): what the last session left behind, read once at the start (the header says what happens to each kind)
  const canAutosave = !!storage && typeof storage.saveAutosave === 'function';
  let recovery = null, startMessage = null;
  if (canAutosave && typeof storage.openAutosave === 'function') {
    const left = await storage.openAutosave();
    if (left) {
      // A DAMAGED autosave (B's D239 look, F1: "left alone" held only until the session's first autosave overwrote it): its bytes are kept
      // as a backup first ("damaged autosave", native backup_track), and only then may this session autosave; if they cannot be kept, the
      // file is left as it is and this session does not autosave over it, exactly as for a Pieces autosave that cannot be kept aside.
      const keepDamaged = async (why) => {
        try {
          if (typeof storage.backupDoc !== 'function') throw new Error('nowhere to keep it');
          const file = await storage.backupDoc('damaged autosave', left);
          startMessage = `an autosave was found but could not be read (${why}); its bytes were kept as ${file} in the app's track-backups folder`;
        } catch (e) { startMessage = `an autosave was found but could not be read (${why}), and could not be kept aside (${e.message}); it is left as it was, and this session does not autosave over it`; recovery = { blocked: true }; }
      };
      let o = null, unreadable = null;
      try { o = JSON.parse(left); } catch (e) { unreadable = e.message; }
      if (!unreadable && (!o || typeof o !== 'object' || Array.isArray(o))) unreadable = 'it is not an autosave record';
      if (unreadable) await keepDamaged(unreadable);
      else if (o.kind === 'core') {
        try { recovery = { name: o.name || null, doc: D.parse(o.doc) }; } catch (e) { await keepDamaged(e.message); }
      } else {
        const aside = `pieces autosave ${new Date().toISOString().slice(0, 10)}`;
        try {
          if (typeof o.doc !== 'string' || typeof storage.saveDoc !== 'function') throw new Error('nowhere to keep it');
          await storage.saveDoc(aside, o.doc);
          startMessage = `an unsaved track from the old Pieces builder was found; this builder makes equation tracks and cannot open it, so it was kept as the saved word track "${aside}" in the app's tracks folder`;
        } catch (e) { startMessage = `an unsaved track from the old Pieces builder was found and could not be kept aside (${e.message}); it is left as it was, and this session does not autosave over it`; recovery = { blocked: true }; }
      }
    }
  }
  let st = {
    mode: 'core', history: D.createHistory(D.createDoc('untitled')), resolved: { segments: [], closed: false }, resolveError: null,
    message: startMessage, messageKind: startMessage ? 'error' : null, name: null, dirty: false, lastEdited: null, lastStep: null, brush: null, exportReds: null,
    localBrush: !!brushFn, recovery: recovery && !recovery.blocked ? recovery : null,
  };
  // a Pieces autosave that could not be kept aside is never overwritten: this session simply does not autosave
  const mayAutosave = canAutosave && !(recovery && recovery.blocked);
  const subs = new Set();
  let autoDue = false, autoTimer = null;
  const set = (patch) => {
    if ('message' in patch && !('messageKind' in patch)) patch = { ...patch, messageKind: patch.message ? 'error' : null };
    const before = st.history.present;
    st = Object.freeze({ ...st, ...patch });
    if (mayAutosave && st.dirty && st.history.present !== before) {
      autoDue = true;
      if (autosaveMs > 0) { if (autoTimer) timers.clearTimeout(autoTimer); autoTimer = timers.setTimeout(() => { autoTimer = null; return writeAutosave(); }, autosaveMs); }
    }
    for (const f of subs) f(st); return st;
  };
  async function writeAutosave() {
    if (!autoDue) return;
    autoDue = false;
    const payload = JSON.stringify({ schema: 1, kind: 'core', name: st.name, doc: D.serialize(st.history.present) });
    try { await storage.saveAutosave(payload); } catch (e) { set({ message: `autosave failed: ${e.message}` }); }
  }
  async function clearAutosave() {
    autoDue = false;
    if (autoTimer) { timers.clearTimeout(autoTimer); autoTimer = null; }
    if (mayAutosave && typeof storage.clearAutosave === 'function') await storage.clearAutosave();
  }
  const doc = () => st.history.present;
  let reads = [], readsFor = null;
  const segmentsOf = (d) => (d.pieces.length ? toSegments(d) : []);
  // THE START POSE travels with the segments (found by test 1, D186): the geometry's shape depends on the start PITCH, so a path
  // grown from the origin at pitch 0 is not the document's lap. A real track opened as an example starts where its first station is.
  const startOf = (d) => ({ pos: d.start.pos.slice(), theta: d.start.heading, p: d.start.pitch });
  const resolvedOf = (d) => { const segments = segmentsOf(d); return { resolved: Object.freeze({ segments, closed: !!d.closed, start: startOf(d), lift: offsetPath && segments.length ? (p) => offsetPath(d, segments, p) : undefined }), resolveError: null }; };
  /** Run an edit; a core error becomes the message, and nothing else changes. */
  const attempt = (fn) => { try { return fn(); } catch (e) { if (e.name === 'CoreError') { set({ message: e.message }); return null; } throw e; } };
  /** Commit a new document as one undo step, timing the operation plus the adapter. */
  const commit = (op, make, extra = {}) => attempt(() => {
    const t0 = now(), d = make(), r = resolvedOf(d), ms = now() - t0;
    return set({ history: D.commit(st.history, d), ...r, dirty: true, message: null, lastStep: { op, ms }, ...extra });
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
    /**
     * REMOVE THE HEAD (Ctrl+Backspace, the piece builder's key moved to this page, D239 note): the last piece goes, as ONE undo step. An
     * empty track is refused by name. On a closed loop the loop is OPEN again (what Close changed in the other pieces stays; Ctrl+Z puts
     * the closed lap back whole), and the message says so.
     */
    removeHead() {
      const d = doc();
      if (!d.pieces.length) return set({ message: 'NOTHING_TO_REMOVE: the track has no pieces' });
      const wasClosed = !!d.closed;
      const r = commit('removeHead', () => Object.freeze(D.checkDoc({ ...d, closed: false, pieces: Object.freeze(d.pieces.slice(0, -1)) })), { lastEdited: null });
      return wasClosed && st.history.present !== d ? set(ok('removed the last piece: the loop is open again (Ctrl+Z puts the closed lap back)')) : r;
    },
    /** The GHOST of an extension: the track as it would be, not committed (the preview's 't180-ghost' candidate). */
    candidate: (opts) => { const d = extend(doc(), opts); return { segments: segmentsOf(d), closed: false, start: startOf(d) }; },
    /** The ghost's readout: what extend(opts) would place, before it is placed (A: the same numbers as after). Throws on bad fields. */
    candidateReadout: (opts) => RD.candidateReadout(doc(), opts),
    /**
     * The head's END state in the core's units: kh, kv (rad/m), phi (rad), w (m), c (degrees; a legacy piece's is the edge it renders).
     * And the cross-section channels (D225, app/core/xsec.js): the edge angle and the tube sweep in degrees, the edge start as a share,
     * each the default (0, 0.64, 0) where the document has no such channel: a piece without an edge, a pre-/4 document, or a core without them.
     * An empty track gives the first piece's START (extend.js's own: bowl, level, straight, WIDTHS.bowl, the edge that renders). Read only.
     */
    headState() {
      const e = D.endState(doc());
      // the head piece: the last ROAD piece (a flight carries the road's state), whose `tube` says whether the sweep is the head's (RULING 2)
      const roads = doc().pieces.filter((p) => p.type === 'road'), headIsTube = !!(roads.length && roads[roads.length - 1].tube);
      if (e) return { kh: e.kh.v, kv: e.kv.v, phi: e.phi.v, w: e.w.v, c: e.c.v, ...XS.headOf(e, headIsTube) };
      const fam = 'bowl';   // extend.js: `family || (last ? last.family : 'bowl')`
      return { kh: 0, kv: 0, phi: 0, w: WIDTHS[fam], c: D.legacyEdgeDeg(fam, WIDTHS[fam], RATES[fam]), ...XS.headOf(null) };
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
        return set({ history: D.dragTo(st.history, d), ...r, brush: { ...b, delta, rUsed: used }, dirty: true, lastStep: { op: `brush:${b.mode}`, ms }, message: note, messageKind: note ? 'ok' : null });
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
        return set({ history: D.commit(st.history, res.doc), ...r, dirty: true, lastStep: { op: 'close', ms: now() - t0 }, ...ok(`loop closed: ${res.report}`) });
      });
    },

    undo: () => attempt(() => { if (st.brush) return set({ message: 'finish the brush drag first' }); const h = D.undo(st.history); return set({ history: h, ...resolvedOf(h.present), dirty: true, message: null }); }),
    redo: () => attempt(() => { if (st.brush) return set({ message: 'finish the brush drag first' }); const h = D.redo(st.history); return set({ history: h, ...resolvedOf(h.present), dirty: true, message: null }); }),
    /** Put a prepared core document in front of the user, as opening one does: fresh history, nothing to undo. */
    adopt: (d) => attempt(() => { D.checkDoc(d); return set({ history: D.createHistory(d), ...resolvedOf(d), name: null, dirty: false, lastEdited: null, message: null, exportReds: null }); }),
    newDoc(name = 'untitled') { const d = D.createDoc(name); return set({ history: D.createHistory(d), ...resolvedOf(d), name: null, dirty: false, lastEdited: null, message: null, exportReds: null }); },

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
        return set({ history: D.createHistory(d), ...resolvedOf(d), name: null, dirty: true, lastEdited: null, exportReds: null, ...ok(`opened ${name}: ${d.pieces.length} pieces, open; close it to export`) });
      });
    },

    /** The document as it exports and installs: its name is the one it was saved under (the Save field), else its own. */
    exportDoc() { const d = doc(); return st.name && st.name !== d.name ? { ...d, name: st.name } : d; },
    /**
     * BUILD THE EXPORT, writing nothing (D239: the Export button and Install to AC both use it, so an installed track is the exported one,
     * byte for byte): the start layout, then src/export/fromwords.js exportSegments through the exporter. A track that cannot export
     * throws an ExportError with a code (OPEN_LOOP, NO_START_STRAIGHT, or the exporter's own, e.g. RED with .red).
     */
    buildExport(opts = {}) {
      if (!exporter) throw exportError('NO_EXPORTER', 'export is not available here');
      if (!doc().closed) throw exportError('OPEN_LOOP', 'the loop is not closed: close it first (one click), then export');
      let markers;
      try { markers = startLayout(st.resolved.segments, st.resolved.lift, st.resolved.start); } catch (e) { if (e.code !== 'NO_START_STRAIGHT') throw e; throw exportError('NO_START_STRAIGHT', `not exported: ${e.message}`); }
      return exporter.runSegments(st.resolved.segments, { name: api.exportDoc().name, description: 'Built from equations by t180-track-builder.', via: 'src/core/adapter.js toSegments', liftPath: st.resolved.lift, start: st.resolved.start }, { ...opts, markers });
    },
    /** EXPORT through the existing exporter (src/export/fromwords.js exportSegments, app/export/export.js), into `dir`. */
    async exportTo(dir, opts = {}) {
      if (!exporter) return set({ message: 'export is not available here' });
      // D234 (the keeper: "when ever I export by myself, the track is errored in content manager before starting"): the target is resolved FIRST, then the track is refused or
      // exported, and the EMPTY folder the user made in the picker is removed WHATEVER the outcome (an open loop, a red, a narrow grid, a failure, a success): it was made for an
      // export, and Content Manager lists an empty track folder as damaged. A folder with anything in it is refused by resolveTarget and never touched. `stop` is every way out
      // that is not a success: it removes the folder, says so in the message, and keeps the message as exportRefusal so the page can show it where it cannot be missed.
      const t = await exporter.resolveTarget(dir, storage);   // D226: an EMPTY folder directly in content\tracks exports to content\tracks and is then removed
      if (t.refused) return set({ message: t.refused.reason, exportReds: null, exportRefusal: t.refused.reason });
      dir = t.dir;
      let tidied = null; const tidy = async () => (tidied === null ? (tidied = await exporter.removeEmptyNote(storage, t)) : tidied);
      const stop = async (patch) => { const message = patch.message + await tidy(); return set({ ...patch, message, exportRefusal: message }); };
      try {
      let out;
      try { out = api.buildExport(opts); } catch (e) {
        if (e.name !== 'ExportError') throw e;
        return stop({ message: e.message, exportReds: e.code === 'RED' ? e.red : null });
      }
      if (!storage || typeof storage.writeExport !== 'function') return stop({ message: 'there is nowhere to write the export here' });
      for (const f of out.folders) await storage.writeExport(dir, f.folder, f.files);
      const w = (out.result.warnings && out.result.warnings.length ? ` (${out.result.warnings.length} warning${out.result.warnings.length > 1 ? 's' : ''}: ${out.result.warnings.join(' · ')})` : '') + await tidy();
      return set({ ...ok(`exported ${out.folders.map((f) => f.folder).join(', ')} to ${dir}${w}`), exportReds: null, exportRefusal: null, lastExport: { dir, folders: out.folders.map((f) => f.folder) } });
      } catch (e) { await tidy(); throw e; }   // a failure nobody planned for (a write that throws): the empty folder still goes
    },

    async save(name) {
      if (!storage) return set({ message: 'saving is not available here' });
      if (!NAME_RE.test(name || '')) return set({ message: `a track name is 1 to 60 letters, digits, spaces, _ or -, starting with a letter or digit; got ${JSON.stringify(name)}` });
      await storage.saveDoc(PREFIX + name, D.serialize(doc()));
      await clearAutosave();   // saved under a name: nothing is left to recover (D239, as the piece builder did)
      return set({ name, dirty: false, message: null });
    },
    /**
     * A PASTED TRACK (D239, a share code): it REPLACES the open one as one undo step, so the old track is one Ctrl+Z away. The document
     * is checked first; a bad one is refused by name and nothing changes.
     */
    commitDoc: (d) => attempt(() => { D.checkDoc(d); return set({ history: D.commit(st.history, d), ...resolvedOf(d), dirty: true, lastEdited: null, message: null, exportReds: null, lastStep: { op: 'paste', ms: 0 } }); }),
    /** Write the autosave now if one is due (the debounce would have written it after the pause). */
    flushAutosave: () => writeAutosave(),
    /** Take the track the last session left unsaved. It becomes the open track, with a fresh history, still unsaved. */
    restore() {
      if (!st.recovery) return set({ message: 'there is no unsaved track to restore' });
      const { doc: d, name } = st.recovery;
      return set({ history: D.createHistory(d), ...resolvedOf(d), name, dirty: true, recovery: null, lastEdited: null, exportReds: null, message: null });
    },
    async discardRecovery() { await clearAutosave(); return set({ recovery: null }); },
    /** The window is closing on purpose: nothing is left to recover. */
    async cleanExit() { await clearAutosave(); },
    /**
     * BACKUP NOW (D239 amendment: the keeper lost TEST 1 to one Close, with no copy from before it). Writes the document AS IT IS NOW
     * to the track's backups (native backup_track: track-backups/<eq-name>.<local time>.t180track, newest 20 kept), under the saved
     * name or, unsaved, under "unsaved". `reason` is said in the result. Resolves { file, reason }, or null where there is no native
     * side to write to (headless, a browser); a write that FAILS rejects, so the caller can refuse the operation it was guarding.
     * B's D242 Close calls it before applying; until then the Close button calls it before shell.close() (app/core/panel.js).
     */
    async backupNow(reason = '') {
      if (!storage || typeof storage.backupDoc !== 'function') return null;
      const file = await storage.backupDoc(PREFIX + (st.name || 'unsaved'), D.serialize(doc()));
      return { file, reason };
    },
    /**
     * The open track's previous versions, newest first: [{ file, when, bytes, length, closed }] (when null for a hand-made one). An UNSAVED
     * track lists the unsaved pool, "eq-unsaved" (B's D239 look, F3a: its copy from before Close was written there and could not be opened);
     * that pool is shared by every unsaved track, which the times tell apart.
     */
    async listVersions() {
      if (!storage || typeof storage.listBackups !== 'function') return [];
      const out = [];
      for (const b of await storage.listBackups(PREFIX + (st.name || 'unsaved'))) {
        const m = /\.(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})(?:_\d+)?\.t180track$/.exec(b.file);
        let length = null, closed = null;
        try { const d = D.parse(await storage.openBackup(b.file)); length = d.pieces.reduce((a, p) => a + (p.length || 0), 0); closed = !!d.closed; } catch (e) { /* listed, unreadable: shown without its numbers */ }
        out.push({ file: b.file, bytes: b.bytes, when: m ? `${m[1]} ${m[2]}:${m[3]}:${m[4]}` : null, length, closed });
      }
      return out;
    },
    /** Open a previous version AS A COPY: an unsaved track (no name), so a Save cannot overwrite the current file by accident. */
    async openVersion(file) {
      if (!storage || typeof storage.openBackup !== 'function') return set({ message: 'previous versions are not available here' });
      let d;
      try { d = D.parse(await storage.openBackup(file)); } catch (e) { return set({ message: `could not open that version: ${e.message}` }); }
      return set({ history: D.createHistory(d), ...resolvedOf(d), name: null, dirty: true, lastEdited: null, exportReds: null, ...ok(`opened the previous version ${file} as a copy: it is unsaved; save it under a name to keep it`) });
    },
    async open(name) {
      if (!storage) return set({ message: 'opening is not available here' });
      const text = await storage.openDoc(PREFIX + name), d = attempt(() => D.parse(text));
      if (!d) return st;
      return set({ history: D.createHistory(d), ...resolvedOf(d), name, dirty: false, lastEdited: null, message: null, exportReds: null });
    },
    /** The saved equation tracks (the piece builder's are not listed here). */
    async list() { if (!storage) return []; return (await storage.listDocs()).filter((n) => n.startsWith(PREFIX)).map((n) => n.slice(PREFIX.length)); },
    text: () => D.serialize(doc()),
    /** The design speed from the validation panel's slider: kept in the state, not part of the document. */
    setDesignSpeed(kmh) { if (!(kmh === null || (Number.isFinite(kmh) && kmh > 0))) return set({ message: `the design speed must be a positive km/h, or null, got ${kmh}` }); return set({ designSpeedKmh: kmh }); },
  };
  return api;
}

/**
 * The cross-section under a path sample, as the mesh draws it: the segment's profile, or, where the segment carries a blend (a cup's do,
 * D190), the blend evaluated at the sample. A segment without a blend gives its own profile object. (A reader of the cross-section under a path sample: the tests of the cup and chord readers take it from here.)
 */
function profilerOf(path, segments) {
  const Prof = require('../../src/geom/profile.js'), starts = []; let a = path.samples[0].s;
  for (const g of segments) { starts.push(a); a += g.length; }
  return (m) => { const g = segments[m.seg]; return Prof.readsBlend(g) && g.blend ? Prof.atSegment(g, m.s - starts[m.seg]) : g.profile; };
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

module.exports = { createCoreShell, NAME_RE, PREFIX, BRUSH_MODES, STRAIGHT_K, piecesIn, straightPieces, startLayout, profilerOf };
