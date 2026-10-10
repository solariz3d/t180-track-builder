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
//   (D272: save also writes the undo history beside the track, open reads it back: see UNDO_CAP below)
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
// SAVED PIECES, THE UI HALF (D240; the core is src/core/piece.js):
//   shell.selectPiece(i, { extend })   shell.clearSelection()   shell.selectionInfo()   await shell.savePiece(name)   await shell.listPieces()   await shell.insertPiece(name, { mirror })
//   await shell.renamePiece(from, to)   await shell.deletePieceFile(name)   shell.deleteSelection()   shell.proposeDelete()   await shell.applyDelete()   shell.cancelDelete()
// TIMING: state.lastStep = { op, ms } for the last edit, the document operation plus the adapter's segments (spec test 6's
// "per step" is measured by the bench on the same calls, not on this field).
'use strict';

const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const LV = require('../../src/core/level.js');
const TB = require('../../src/core/turnby.js');
const SH = require('../../src/core/sharp.js');
const SC = require('../../src/core/sculpt.js');
const { sculpt, pieceOffsets } = SC;
/**
 * D259 (the keeper, 18:24: "same for -360 if it banks the other way, instead of continuing another revolution past 360 it should reset back to 0"): a bank brush or a
 * Sculpt bank drag that would take the bank at its centre past one full turn wraps it back from 0, its sign kept (350 + 20 -> 10, -350 - 20 -> -10, 300 stays 300).
 * The bank there is read on the drag's BASE document (b.s0 is the piece's middle for Sculpt), and the delta sent on is the one that lands on the wrapped value.
 * The stored winding is not rewritten otherwise: a drag that stays inside one turn is applied exactly as given.
 */
function bankWithinTurn(b, delta) {
  const offs = pieceOffsets(b.base), i = offs.findIndex((o, k) => b.s0 >= o && (k === offs.length - 1 || b.s0 < offs[k + 1])), P = i >= 0 ? b.base.pieces[i] : null;
  if (!P || P.type !== 'road' || !Number.isFinite(delta)) return delta;
  const b0 = D.channelAt(P, 'phi', Math.min(P.length, Math.max(0, b.s0 - offs[i]))).v, TURN = 2 * Math.PI, w = (b0 + delta) % TURN;
  return Math.abs(b0 + delta) < TURN ? delta : w - b0;
}
const { close, closeWindow } = require('../../src/core/close.js');
// D242: the close preview's overlap check builds the closed track's mesh and validates it as the export does (src/export/fromwords.js). D240 follow-up: it lives in
// app/core/overlapjob.js, ONE pure function that the shell runs on the page (no runner given: tests) or that a Web Worker runs (app/core/overlapworker.js), so a preview never freezes the page
const { overlapCheck } = require('./overlapjob.js');
const RG = require('../validate-ui/redgroups.js');   // D242: every red in plain words, grouped, with where
const overlapPlacesText = (ck, segs, o) => RG.placesText({ places: RG.groupReds(ck.overlaps, segs, o).flatMap((g) => g.places) });   // D248: "N places", merged as the red list shows them
const AD = require('../../src/core/adapter.js');
const { toSegments } = AD;
const PC = require('../../src/core/piece.js');   // D240: saved pieces (save a run, put one at the head, mirror it, delete pieces)
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
const CL = require('./centreline.js');   // D244b: the Sculpt guard (the centreline must not move)
const JU = require('../../src/core/jump.js');   // D258: the free jump (E): a free flight and the landing you place by hand
const JW = require('./jumpwords.js');   // the core's jump refusals in plain words
const LD = require('./landing.js');
const GL = require('./griplike.js');   // D261: the grip field's checks and words   // the landing's number boxes: values and units

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/;
const PREFIX = 'eq-';                 // core documents are stored under this prefix; the old piece builder's word tracks (no prefix) stay on disk, unlisted (D239)
const BRUSH_MODES = Object.freeze(['local', 'rate']);
// D272 (the keeper, 11:55: "when you save a track, but then close program, reopen and go back to it, you cannot undo pieces of the track ... not cool"): THE UNDO HISTORY SURVIVES SAVE AND RESTART.
// Save writes a SIDECAR, storage.saveUndo(PREFIX + name, text), beside the track (natively eq-<name>.t180undo; the track file is unchanged, so share codes, exports and older builds read it as ever):
// { schema: 1, kind: 'core-undo', present, past: [...], future: [...] }, every document D.serialize'd, the last UNDO_CAP steps (the past's newest, the future's nearest). Open restores it ONLY when its
// `present` is the opened file byte for byte; a mismatch (the file was replaced, pasted, edited elsewhere, or saved by an older build) drops it silently, never mixed; a sidecar that is damaged opens
// the track with no history and says so once. The autosave carries the same text in its `undo` field, so Restore after a crash can undo too.
const UNDO_CAP = 200;
const UNDO_KIND = 'core-undo';
const serialText = new WeakMap();   // a document is immutable: its text is computed once, so a save or an autosave only serializes the steps made since the last
const textOf = (d) => { let t = serialText.get(d); if (t === undefined) { t = D.serialize(d); serialText.set(d, t); } return t; };
/** The sidecar text for a history whose present is `presentText`: the last UNDO_CAP past steps and the UNDO_CAP nearest future ones. */
function packHistory(h, presentText) {
  return JSON.stringify({ schema: 1, kind: UNDO_KIND, present: presentText, past: h.past.slice(-UNDO_CAP).map(textOf), future: h.future.slice(0, UNDO_CAP).map(textOf) });
}
/** { history } for a sidecar that belongs to `presentText` (the opened document `d`), { mismatch: true } for one that belongs to another file, { bad: why } for one that cannot be read. All or nothing. */
function unpackHistory(sideText, presentText, d) {
  let o;
  try { o = JSON.parse(sideText); } catch (e) { return { bad: `it is not JSON (${e.message})` }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { bad: 'it is not a record' };
  if (o.kind !== UNDO_KIND || o.schema !== 1) return { bad: 'it is not an undo history this build reads' };
  if (typeof o.present !== 'string' || !Array.isArray(o.past) || !Array.isArray(o.future)) return { bad: 'it is missing its present, past or future' };
  if (o.present !== presentText) return { mismatch: true };
  const docs = (list, what) => list.map((t, i) => { if (typeof t !== 'string') throw new Error(`${what} step ${i + 1} is not text`); try { return D.parse(t); } catch (e) { throw new Error(`${what} step ${i + 1}: ${e.message}`); } });
  try {
    const past = docs(o.past, 'past'), future = docs(o.future, 'future');
    return { history: Object.freeze({ ...D.createHistory(d), past: Object.freeze(past), future: Object.freeze(future) }) };
  } catch (e) { return { bad: e.message }; }
}
// D244b, SCULPT: the channels that shape a placed piece without steering the track (bank, width, wall rise, cup, edge angle, edge start, tube sweep). Turn (kh), climb (kv) and the height and sideways offsets
// are NOT in it: they carry everything after them. In Sculpt the brush takes these only, and every step is checked against the centreline (app/core/centreline.js)
const SCULPT_CHANNELS = Object.freeze(['phi', 'c', 'w', 'e', 's', 'r', 't']);
// E's BRUSH (p-d186-brush-E): src/core/sculpt.js brush(doc, { mode: 'hill' | 'swerve' | 'value' | 'rate', channel, s0, r, delta })
// -> { doc, note? }. It is used when sculpt.js exports it (not at 17c2301, where this was written; E's D186 adds it), and may be
// injected (`brushFn`, tests). The LOCAL brush is its hill (channel 'height') and swerve ('lateral'); they need the document's
// offset channels h and l (A's, pending the chair's decision), and until then E's brush refuses them by name (NOT_YET), which the
// shell shows as the message. With no E brush at all the local mode is not offered, and the rate brush is D185's sculpt().

// The default timers CALL the globals rather than hold them as methods (a browser's setTimeout refuses to run as a method of another
// object, "Illegal invocation", WebView2; app/test/timers-regression.test.js found it in the piece builder).
const callTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t) };
const exportError = (code, message) => Object.assign(new Error(message), { name: 'ExportError', code });

async function createCoreShell({ storage = null, exporter = null, brushFn = typeof SC.brush === 'function' ? SC.brush : null, now = () => Date.now(), autosaveMs = 1500, timers = callTimers, overlapRunner = null } = {}) {
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
        try { recovery = { name: o.name || null, doc: D.parse(o.doc), docText: o.doc, undoText: o.undo }; } catch (e) { await keepDamaged(e.message); }
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
    message: startMessage, messageKind: startMessage ? 'error' : null, name: null, dirty: false, lastEdited: null, lastStep: null, brush: null, landingDrag: null, exportReds: null,
    localBrush: !!brushFn, recovery: recovery && !recovery.blocked ? recovery : null,
    selection: null, deleteProposal: null, libraryStamp: 0, proposalCheck: null,   // D240: the pieces picked on the track, a pending middle delete, and a counter the library list redraws on
    sculpt: false,   // D244b: the Sculpt switch: the brush and the handles on a placed piece change its shape only, never the route
  };
  // a Pieces autosave that could not be kept aside is never overwritten: this session simply does not autosave
  const mayAutosave = canAutosave && !(recovery && recovery.blocked);
  const subs = new Set();
  let currentJob = null;   // D240 follow-up: the overlap check running for the preview on screen: { entry, job }
  let autoDue = false, autoTimer = null;
  const set = (patch) => {
    if ('message' in patch && !('messageKind' in patch)) patch = { ...patch, messageKind: patch.message ? 'error' : null };
    // D242: a close PREVIEW belongs to the document it was made from; any change of document drops it, so no stale ghost or Apply survives an edit, an undo or an open
    if (patch.history && st.closeProposal && !('closeProposal' in patch) && patch.history.present !== st.closeProposal.base) patch = { ...patch, closeProposal: null };
    // D240: a SELECTION of pieces and a delete PREVIEW likewise belong to the document they were made on (piece numbers mean nothing on another)
    if (patch.history && st.selection && !('selection' in patch) && patch.history.present !== st.selection.base) patch = { ...patch, selection: null };
    if (patch.history && st.deleteProposal && !('deleteProposal' in patch) && patch.history.present !== st.deleteProposal.base) patch = { ...patch, deleteProposal: null };
    const before = st.history.present;
    st = Object.freeze({ ...st, ...patch });
    // D240 follow-up: the overlap check belongs to the preview it was started for; when that preview goes (Cancel, an edit, an Undo, another selection) the check is STOPPED (the worker terminated)
    if (st.proposalCheck && st.proposalCheck.proposal !== st.closeProposal && st.proposalCheck.proposal !== st.deleteProposal) { abortCheck(); st = Object.freeze({ ...st, proposalCheck: null }); }
    if (mayAutosave && st.dirty && st.history.present !== before) {
      autoDue = true;
      if (autosaveMs > 0) { if (autoTimer) timers.clearTimeout(autoTimer); autoTimer = timers.setTimeout(() => { autoTimer = null; return writeAutosave(); }, autosaveMs); }
    }
    for (const f of subs) f(st); return st;
  };
  async function writeAutosave() {
    if (!autoDue) return;
    autoDue = false;
    const h = st.history, payload = JSON.stringify({ schema: 1, kind: 'core', name: st.name, doc: textOf(h.present), ...(h.past.length || h.future.length ? { undo: packHistory(h, textOf(h.present)) } : {}) });   // D272: its history rides along
    try { await storage.saveAutosave(payload); } catch (e) { set({ message: `autosave failed: ${e.message}` }); }
  }
  async function clearAutosave() {
    autoDue = false;
    if (autoTimer) { timers.clearTimeout(autoTimer); autoTimer = null; }
    if (mayAutosave && typeof storage.clearAutosave === 'function') await storage.clearAutosave();
  }
  // ── D240 follow-up: THE OVERLAP CHECK OFF THE UI THREAD (the keeper reads a 10 s freeze as broken: Close's preview took 13.4 s on TEST 1, a middle delete's 8.5 to 10.3 s on 13 km) ──
  // With an overlapRunner (the page's: a Web Worker) a preview is shown AT ONCE (the ghost and the per-piece displacement) and its overlap check runs off the thread: state.proposalCheck is
  // { proposal, status 'checking' | 'done' | 'failed', result, error, startedAt, ms, via }, Apply is refused until it is 'done', and Cancel (or any change that drops the preview) terminates the worker.
  // With no runner (the tests, and a page that cannot make a worker is handled below) the check is run on the spot, exactly as it always was, and the proposal carries it as .check.
  function abortCheck() { const j = currentJob; currentJob = null; if (j && j.job) { try { j.job.cancel(); } catch (e) { /* already finished */ } } }
  const checkOf = (p) => (p.check || (st.proposalCheck && st.proposalCheck.proposal === p && st.proposalCheck.status === 'done' ? st.proposalCheck.result : null));
  /** Start the check of proposal `p` (whose document is `d`) and return its entry, for the caller to set as state.proposalCheck together with the proposal; `onDone(entry)` gives the state patch (the message) to set when it ends. A worker that cannot start falls back to the page, AFTER the preview has painted. */
  function beginCheck(p, d, closed, onDone) {
    abortCheck();
    const speed = Number.isFinite(st.designSpeedKmh) && st.designSpeedKmh > 0 ? st.designSpeedKmh : null;
    let job = null;
    if (overlapRunner) { try { job = overlapRunner.start({ doc: d, designSpeedKmh: speed, closed }); } catch (e) { job = null; } }
    const entry = Object.freeze({ proposal: p, status: 'checking', startedAt: now(), via: job ? 'worker' : 'page', result: null, error: null, ms: null, timing: null });
    currentJob = { entry, job };
    const run = job ? job.promise : new Promise((res, rej) => timers.setTimeout(() => { try { res(overlapCheck(p.resolved, speed, { closed })); } catch (e) { rej(e); } }, 0));
    const finish = (r) => {
      if (!currentJob || currentJob.entry !== entry) return;   // cancelled, replaced or dropped meanwhile: this answer is stale
      currentJob = null;
      const done = Object.freeze({ ...entry, ...r, ms: now() - entry.startedAt });
      set({ proposalCheck: done, ...onDone(done) });
    };
    run.then((result) => finish({ status: 'done', result: Object.freeze(result), timing: (job && job.timing) || null }), (e) => { if (!(e && e.cancelled)) finish({ status: 'failed', error: String((e && e.message) || e) }); });
    return entry;   // the caller puts it in the SAME state change as the preview (a panel drawn for the preview must already see its check)
  }
  const doc = () => st.history.present;
  /** The boxes' values ({ forward, left, up, heading, pitch, bank }, in m and degrees) as the pose the core takes (radians). */
  const landingPose = (ui) => Object.assign({}, ...Object.entries(ui || {}).map(([k, v]) => LD.poseOf(k, v)));
  // D258: the Jump button's document: the current piece placed as Extend would place it (extendOpts, or null: take off from the track's end as it is), a free flight to the default landing, a 60 m straight
  const jumpFor = (extendOpts) => JU.jumpHere(doc(), extendOpts || null);
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
  // the WHOLE-LAP close's protected stretch (the old one-click close, and proposeClose({ whole: true })): the stretch edited last AND the user's straights,
  // since close.js spreads the correction over every piece it is not told to avoid, and left alone it bent a 300 m straight to a 370 m radius (D186 C)
  const wholeLapEdited = (d) => { const last = lastRoad(d); return [...new Set([...(st.lastEdited || [last]), ...straightPieces(d)])]; };
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
    /**
     * D244b, SCULPT (the keeper, 09:17: "a separate mode to sculpt pieces once they are already put down, so they don't change the structure of the rest of the track, it's mostly
     * just banking and cupping tweaks"). On: the brush offers only sculptChannels() and every step is checked against the centreline; beginSculpt reshapes the ONE selected road piece
     * (or `piece`) in place, with the brush centred on it and as wide as it is, so the joints are untouched and stay C1; one drag is one undo step.
     */
    sculptChannels: () => SCULPT_CHANNELS.slice(),
    setSculpt(on) { if (st.brush) return set({ message: 'finish the brush drag first' }); return set({ sculpt: !!on, message: null }); },
    beginSculpt({ channel, piece, sharp = false } = {}) {
      if (!st.sculpt) return set({ message: 'SCULPT_OFF: turn Sculpt on first' });
      const d = doc(); let i = piece;
      if (i === undefined) { const s = st.selection; if (!s || s.base !== d || s.from !== s.to) return set({ message: 'select ONE piece first: click it on the track' }); i = s.from; }
      const P = d.pieces[i];
      if (!P || P.type !== 'road') return set({ message: `SCULPT_PIECE: piece ${i} is not a road piece` });
      return api.beginBrush({ mode: 'rate', channel, s0: pieceOffsets(d)[i] + P.length / 2, r: P.length / 2, sharp, piece: i });
    },
    /** The piece the Sculpt handles are on, for the panel: { index, id, length, hasCup, values: { phi (degrees), w (m), c (degrees) } at its middle, halfAt(f) the half-width (m) at a share of its length }, or null (Sculpt off, or not ONE road piece selected). */
    sculptInfo() {
      const s = st.selection, d = doc();
      if (!st.sculpt || !s || s.base !== d || s.from !== s.to) return null;
      const P = d.pieces[s.from]; if (!P || P.type !== 'road') return null;
      const at = (ch, u) => D.channelAt(P, ch, u).v, mid = P.length / 2;
      return { index: s.from, id: P.id, length: P.length, hasCup: !!P.cup, values: { phi: at('phi', mid) * 180 / Math.PI, w: at('w', mid), c: P.cup ? at('c', mid) : null }, halfAt: (f) => at('w', Math.max(0, Math.min(1, f)) * P.length) / 2 };
    },
    sculptTo: (delta) => api.brushTo(delta),
    endSculpt: () => api.endBrush(),
    /**
     * D258, THE FREE JUMP (the keeper: "instead of clicking extend, it says jump ... it then lets the user move around a blank straight piece ... through testing in the game trial and error driving it
     * themselves"; the core is src/core/jump.js, E's). jump(extendOpts) is the Jump button: the current piece placed as Extend would place it (extendOpts: what Extend takes, or null to take off from the
     * track's end as it is), then a free flight to a default landing (40 m ahead, the same height, lined up) and a 60 m straight landing: ONE undo step. The core refuses by name (NO_TAKEOFF, CLOSED,
     * JUMP_AFTER_JUMP, FLIGHT_OFFSET, BAD_FLIGHT, ...) and the message is that refusal in plain words (app/core/jumpwords.js). candidateJump is the ghost of it for the preview (flagged `jump`, so the
     * Extend handles stay off it); it throws the core's CoreError, which the panel puts through the same words.
     */
    candidateJump(extendOpts) { const d = jumpFor(extendOpts); return { segments: segmentsOf(d), closed: false, start: startOf(d), jump: true }; },
    jump(extendOpts) {
      let d; try { d = jumpFor(extendOpts); } catch (e) { if (e && e.name === 'CoreError') return set({ message: JW.jumpWords(e) }); throw e; }
      return commit('jump', () => d, { lastEdited: null, ...ok('Jump placed: move its landing by hand.') });
    },
    /**
     * THE LANDING, while it is the head (the last piece, or the flight still waiting for its landing): null otherwise. { flightId, index, pose } with pose = the number boxes' values in their units
     * (forward, left, up in m; heading, pitch, bank in degrees: app/core/landing.js BOXES), read from the document's readout.
     */
    landing() {
      const d = doc(), L = JU.landingOf(d); if (!L) return null;
      const r = api.pieceReadouts()[L.index];
      return r && r.landing ? { flightId: L.flight.id, index: L.index, pose: LD.boxValues(r.landing) } : null;
    },
    /** Move the landing to the typed values ({ forward, left, up, heading, pitch, bank }, any of them, in the boxes' units): ONE undo step. A refusal says why in plain words and changes nothing. */
    moveLanding(ui) {
      let d; try { d = JU.setLanding(doc(), landingPose(ui)); } catch (e) { if (e && e.name === 'CoreError') return set({ message: JW.jumpWords(e) }); throw e; }
      const was = JU.landingOf(doc()), now2 = JU.landingOf(d);   // the same pose is no step
      return was && now2 && D.FLIGHT_POSE.every((k) => was.flight[k] === now2.flight[k]) ? st : commit('landing', () => d, { lastEdited: null });
    },
    /** A DRAG of the landing (the handles): beginLanding opens it, landingTo(ui) moves the landing to the values from the document as it was when the drag began, endLanding is ONE undo step for the whole drag. */
    beginLanding() {
      if (st.landingDrag) return set({ message: 'a landing drag is already open' });
      const L = JU.landingOf(doc()); if (!L) return set({ message: JW.jumpWords({ code: 'LANDING_NOT_HEAD' }) });
      return attempt(() => set({ history: D.beginDrag(st.history), landingDrag: { base: doc(), flightId: L.flight.id }, message: null }));
    },
    landingTo(ui) {
      const b = st.landingDrag; if (!b) return set({ message: 'no landing drag is open' });
      let d; try { d = JU.setLanding(b.base, landingPose(ui)); } catch (e) { if (e && e.name === 'CoreError') return set({ message: JW.jumpWords(e) }); throw e; }   // a step the core refuses (too close to the take-off) leaves the drag at its last good step
      return attempt(() => { const t0 = now(), h = D.dragTo(st.history, d), r = resolvedOf(d); return set({ history: h, ...r, dirty: true, lastStep: { op: 'landing', ms: now() - t0 }, message: null }); });
    },
    endLanding() {
      if (!st.landingDrag) return st;
      return attempt(() => set({ history: D.endDrag(st.history), landingDrag: null, lastEdited: null }));
    },

    /** EXTEND at the build head: one new piece continuing the last (src/core/extend.js). `targets` set channels (absolute). */
    extend: (opts) => commit('extend', () => extend(doc(), opts), { lastEdited: [doc().pieces.length] }),
    /** D271 LEVEL: extend with the fields' piece, its climb solved so it ends straight and level (pitch 0); src/core/level.js. One undo step, like extend. */
    extendLevel: (opts) => commit('level', () => LV.extendLevel(doc(), opts), { lastEdited: [doc().pieces.length] }),
    /** D271 TO FLOOR: …and on the floor (height 0). Too short a piece is refused by name with the length that works (FLOOR_TOO_SHORT), as the message. */
    extendToFloor: (opts) => commit('toFloor', () => LV.extendToFloor(doc(), opts), { lastEdited: [doc().pieces.length] }),
    /** D280 TURN BY: extend with the fields' piece, its turn solved so it turns EXACTLY `deg` degrees (+ = left) and ends straight (turn rate 0); src/core/turnby.js.
     *  One undo step, like extend; too short a piece is refused by name with the length that works (TURN_TOO_SHORT), as the message. */
    extendTurnBy: (opts, deg) => commit('turnBy', () => TB.extendTurnBy(doc(), opts, (Number(deg) * Math.PI) / 180), { lastEdited: [doc().pieces.length] }),
    /** D282 SHARP: a corner of `deg` degrees (+ = left) at radius R m, ramped in and out over `ramp` m, exiting dead straight; src/core/sharp.js. Its two pieces
     *  are ONE undo step; a radius too tight for the width is refused by name with the tightest that works (SHARP_TOO_TIGHT), as the message, and nothing changes. */
    extendSharp: (opts, { deg, R, ramp }) => commit('sharp', () => SH.extendSharp(doc(), opts, { angle: (Number(deg) * Math.PI) / 180, R: Number(R), ramp: Number(ramp) }), { lastEdited: [doc().pieces.length, doc().pieces.length + 1] }),
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
    beginBrush({ mode = brushFn ? 'local' : 'rate', channel, s0, r, sharp = false, piece }) {
      if (!BRUSH_MODES.includes(mode)) return set({ message: `brush mode "${mode}" is not one of ${BRUSH_MODES.join(', ')}` });
      if (mode === 'local' && !brushFn) return set({ message: 'the height/lateral brush is not in this build yet (E, p-d186-brush-E): use the rate brush' });
      if (st.brush) return set({ message: 'a brush drag is already open' });
      // D185's sculpt cannot re-close; E's rate brush does, so this guard is only for the fallback
      if (!brushFn && doc().closed && mode === 'rate' && (channel === 'kh' || channel === 'kv')) return set({ message: 'the loop is closed: a heading or pitch rate brush would open it. Undo the close, or brush height, bank or width' });
      // D244b: in Sculpt only the shape channels, as a value brush; anything that would steer the track is refused by name before the drag opens
      if (st.sculpt && (mode !== 'rate' || !SCULPT_CHANNELS.includes(channel))) return set({ message: `SCULPT_CHANNEL: Sculpt offers only the shape channels (${SCULPT_CHANNELS.join(', ')}); ${mode === 'local' ? `the ${channel} brush` : `"${channel}"`} would move the track after it. Turn Sculpt off to use it` });
      const sculpting = st.sculpt ? { sculpt: true, baseHistory: st.history, baseResolved: st.resolved, sculptPiece: piece } : {};
      return attempt(() => set({ history: D.beginDrag(st.history), brush: { mode, channel, s0, r, sharp: !!(sharp && brushFn), base: doc(), delta: 0, ...sculpting }, message: null }));
    },
    brushTo(delta0) {
      const b = st.brush; if (!b) return set({ message: 'no brush drag is open' });
      const delta = b.channel === 'phi' ? bankWithinTurn(b, delta0) : delta0;   // D259: the bank at the drag's centre keeps within one turn, its sign kept
      return attempt(() => {
        const t0 = now(), res = brushed(b, delta), d = res.doc, r = resolvedOf(d), ms = now() - t0;
        // D244b: the exact, cheap guard at every step: nothing the path is made of may have moved (the drag stays at its last good step)
        if (b.sculpt) { const moved = CL.routeMovedDetail(b.base, b.baseResolved.segments, d, r.resolved.segments, b.baseResolved.start, r.resolved.start); if (moved) throw new D.CoreError('SCULPT_MOVES_CENTRELINE', `Sculpt can't do that: ${CL.plainWhy(moved)}. The drag stays at its last good step.`); }   // (D243 F3: the reason in plain words, not the internal field)
        // the radius the brush really used (E's brush widens a narrow one; the chair's RULING 2: always shown), and any note of its
        // the radius really used: E's brush reports it as radiusUsed (sculpt.js), shown whenever it widened (ruling 2)
        const used = Number.isFinite(res.radiusUsed) ? res.radiusUsed : Number.isFinite(res.rUsed) ? res.rUsed : null;
        const widened = used !== null && used > b.r + 1e-9 ? `brush widened to ${used.toFixed(0)} m (asked ${b.r.toFixed(0)} m), so the track outside it stays exactly as it was` : null;
        // a rate brush on a closed lap re-closes (E): a re-close that failed left the track OPEN, and says so
        const reclose = res.close && !res.close.converged ? `the loop could not re-close after this brush, so it is open now: ${res.close.report}` : null;
        // D244b: a Sculpt drag on a piece shorter than the brush's smallest window (120 m) is "widened" by E's rule, but the change stays inside the piece (measured: the neighbours are the very same objects),
        // so that note is only worth saying when a piece other than the sculpted one really changed
        const spilled = b.sculpt && Number.isInteger(b.sculptPiece) ? (res.changed || []).filter((c) => c.piece !== b.sculptPiece).map((c) => c.piece) : [];
        const note = b.sculpt && Number.isInteger(b.sculptPiece) && !spilled.length ? null : [widened, res.note, reclose, spilled.length ? `Sculpt also changed ${spilled.map((i) => d.pieces[i].id).join(', ')} at the joint` : null].filter(Boolean).join(' · ') || null;
        const h = D.dragTo(st.history, d);
        // D244b: a Sculpt step keeps the same pieces in the same places, so the piece the handles are on stays selected (a selection otherwise belongs to the document it was made on)
        const keep = b.sculpt && st.selection ? { selection: Object.freeze({ ...st.selection, base: h.present }) } : {};
        return set({ history: h, ...r, ...keep, brush: { ...b, delta, rUsed: used }, dirty: true, lastStep: { op: `brush:${b.mode}`, ms }, message: note, messageKind: note ? 'ok' : null });
      });
    },
    endBrush() {
      const b = st.brush; if (!b) return st;
      // D244b: the direct check when a Sculpt drag ends: both centrelines built and compared bit for bit; a drag that moved it is dropped whole
      if (b.sculpt) { const moved = CL.pathMoved(CL.snapshot(b.baseResolved), st.resolved); if (moved) return set({ history: b.baseHistory, ...resolvedOf(b.baseHistory.present), brush: null, message: 'SCULPT_MOVES_CENTRELINE: Sculpt dropped this drag: when it ended, the track\'s centreline had moved (checked point by point), so the track is as it was.' }); }
      // the brushed pieces are what close() goes round (the brush's window)
      // (endDrag keeps the same present, so a Sculpt selection, re-based at each step, still belongs to it)
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
        const edited = wholeLapEdited(doc());
        const t0 = now(), res = close(doc(), { edited });
        if (!res.converged) return set({ message: res.report });
        const r = resolvedOf(res.doc);
        return set({ history: D.commit(st.history, res.doc), ...r, dirty: true, lastStep: { op: 'close', ms: now() - t0 }, ...ok(`loop closed: ${res.report}`) });
      });
    },

    /**
     * D242, THE CLOSE PREVIEW (the keeper, TEST 1: "the close the loop fucked up my track ... completing the loop altered the rest of the track
     * equation"). Close no longer commits at once: it PROPOSES. By default only the last ~20% of the lap may move (src/core/close.js closeWindow;
     * `last: true` is the last piece alone, `whole: true` the old whole-lap close, kept for when it is asked for); a window that cannot close the loop
     * is refused BY NAME (CLOSE_WINDOW). The proposal carries how far each piece's centreline moved and an OVERLAP CHECK of the closed track (the mesh's
     * self-intersection and the validator's checks, as the export runs them). Apply (async) first writes the open track to its backups (backupNow
     * 'pre-close'), refuses by name if that copy fails, and then commits the close as ONE undo step; Cancel drops it.
     */
    proposeClose({ fraction = 0.2, last = false, whole = false } = {}) {
      if (doc().closed) return set({ message: 'the loop is already closed: there is nothing to preview' });
      if (lastRoad(doc()) < 0) return set({ message: 'there is no road to close yet: extend first' });
      return attempt(() => {
        const base = doc(), t0 = now();
        const res = whole ? close(base, { edited: wholeLapEdited(base) }) : close(base, { window: closeWindow(base, { fraction, last }) });
        if (!res.converged) return set({ message: res.report, closeProposal: null });   // the whole-lap close hands back a best try; a local one has refused already
        const r = resolvedOf(res.doc), ms = now() - t0;
        const proposal = Object.freeze({ base, doc: res.doc, resolved: r.resolved, whole: !!whole, window: res.window, report: res.report, ms,
          displacement: Object.freeze(displacementOf(base, res.doc)), check: overlapRunner ? null : Object.freeze(overlapCheck(r.resolved, st.designSpeedKmh)) });
        const moved = proposal.displacement.filter((x) => x.maxM > 1e-3);
        const words = (ck) => `close preview: ${res.report}; ${moved.length} of ${proposal.displacement.length} pieces move${ck.overlaps.length ? `; the closed track OVERLAPS ITSELF in ${overlapPlacesText(ck, r.resolved.segments)}` : ''}. Apply or cancel`;
        if (!overlapRunner) return set({ closeProposal: proposal, ...ok(words(proposal.check)) });
        const entry = beginCheck(proposal, res.doc, true, (e) => (e.status === 'done' ? ok(words(e.result)) : { message: `the overlap check could not run: ${e.error}. Cancel the preview and try Close again` }));
        return set({ closeProposal: proposal, proposalCheck: entry, ...ok(`close preview: ${res.report}; ${moved.length} of ${proposal.displacement.length} pieces move. Checking for overlaps: Apply is off until that finishes (Cancel stops it)`) });
      });
    },
    async applyClose() {
      const p = st.closeProposal;
      if (!p) return set({ message: 'nothing to apply: press Close first' });
      if (p.base !== doc()) return set({ closeProposal: null, message: 'the track changed since the close preview: press Close again' });
      if (!checkOf(p)) return set({ message: 'the overlap check of this preview has not finished: Apply when it has (Cancel drops the preview)' });
      // the document AS IT IS NOW goes to track-backups first (backupNow, D239 amendment: the keeper lost TEST 1 to one Close, with no copy from before
      // it), so a Close can be undone after the app is closed. A copy that fails (throws or rejects) refuses the close by name, and nothing changes
      try { await api.backupNow('pre-close'); } catch (e) { return set({ message: `not closed: the copy from before the close could not be written (${e && e.message || e}); nothing changed` }); }
      // the copy was written while the page was live: an edit in that time drops the preview (set), so a stale one is never committed
      if (st.closeProposal !== p || p.base !== doc()) return set({ closeProposal: null, message: 'the track changed while its copy was being written: press Close again' });
      return set({ history: D.commit(st.history, p.doc), resolved: p.resolved, resolveError: null, dirty: true, closeProposal: null, lastStep: { op: 'close', ms: p.ms }, ...ok(`loop closed: ${p.report}`) });
    },
    cancelClose: () => set({ closeProposal: null, message: null }),
    /**
     * The overlap check of a preview (a closeProposal or a deleteProposal), for the panels: { status: 'done' | 'checking' | 'failed' | 'none', result, error, via, elapsedMs }. A preview made with no runner
     * carries its check, so it reads 'done' at once; with one it reads 'checking' until the worker answers. Apply is refused until 'done'.
     */
    proposalCheck(p) {
      if (p && p.check) return { status: 'done', result: p.check, error: null, via: 'page', elapsedMs: 0 };
      const e = st.proposalCheck;
      if (!p || !e || e.proposal !== p) return { status: 'none', result: null, error: null, via: null, elapsedMs: 0 };
      return { status: e.status, result: e.result, error: e.error, via: e.via, elapsedMs: e.status === 'checking' ? now() - e.startedAt : e.ms, timing: e.timing };
    },

    /**
     * D240, SAVED PIECES, THE UI HALF (the core is src/core/piece.js; the keeper: "can we keep only the equation mode? And then we can save pieces from that we make", and
     * 10:xx: "highlight/select pieces on the track; the selection offers Save as piece or Delete").
     *
     * SELECT: piece i (a click on the track), or with `extend` the run from the piece selected first to i (a shift-click). A selection belongs to the document it was made on:
     * any change of the document drops it. SAVE AS PIECE: the selected run is kept relative to its own start (src/core/piece.js saveRun) in the pieces folder, under a name;
     * a name already used is REFUSED (delete the old piece first), and a run the core cannot keep (a mixed cross-section, say) says why.
     */
    selectPiece(i, { extend = false } = {}) {
      const d = doc();
      if (!Number.isInteger(i) || i < 0 || i >= d.pieces.length) return set({ message: `there is no piece ${i}: the track has pieces 0 to ${d.pieces.length - 1}` });
      const anchor = extend && st.selection && st.selection.base === d ? st.selection.anchor : i;
      // D250 item 4 (the keeper: "Short way across start"): on a CLOSED lap a shift-click takes the SHORTER way round, by road length; across the start line it is from > to
      // (from..last, then 0..to), which src/core/piece.js saveRun keeps; a tie (within 1e-6 m: the lengths are decimal sums) stays the run that does not cross the line.
      // A's look: the short way only where it CAN be kept. When the run across the line is refused (MIXED_RUN: a cup at one side and a plain piece at the other, as on
      // TEST 1; SEAM_RUN) and the run inside the lap can be saved, the inside run is selected, and the line says why (longWay)
      let from = Math.min(anchor, i), to = Math.max(anchor, i), longWay = null;
      if (d.closed && from !== to) {
        const len = (a, b) => d.pieces.slice(a, b + 1).reduce((x, P) => x + (P.type === 'road' ? P.length : 0), 0), total = len(0, d.pieces.length - 1);
        if (total - len(from + 1, to - 1) < len(from, to) - 1e-6) {
          const refusal = (a, b) => { try { PC.saveRun(d, a, b, { name: 'selection' }); return null; } catch (e) { if (e.name !== 'CoreError') throw e; return e; } };
          const across = refusal(to, from);
          if (across && (across.code === 'MIXED_RUN' || across.code === 'SEAM_RUN') && !refusal(from, to)) {
            const kind = (P) => ({ cup: 'a cup', tube: 'a tube' })[D.kindOf(P)] || 'a plain piece', end = d.pieces[d.pieces.length - 1], start = d.pieces[0];
            longWay = across.code === 'SEAM_RUN' ? 'the long way round: the short way crosses the start line, where the road is not smooth'
              : D.kindOf(end) !== D.kindOf(start) ? `the long way round: the short way crosses the start line between ${kind(end)} and ${kind(start)}`
                : 'the long way round: the short way crosses the start line and mixes cross-sections';
          } else [from, to] = [to, from];
        }
      }
      const ids = from <= to ? d.pieces.slice(from, to + 1) : [...d.pieces.slice(from), ...d.pieces.slice(0, to + 1)];
      return set({ selection: Object.freeze({ base: d, anchor, from, to, longWay, ids: Object.freeze(ids.map((P) => P.id)) }), deleteProposal: null, message: null });
    },
    clearSelection: () => set({ selection: null, deleteProposal: null, message: null }),
    /**
     * D261, GRIP of the selected pieces (the keeper: "change which piece has different grip"; the core is src/core/document.js setGrip, E's): `g` a whole percent 50 to 150 (a number or the field's
     * text; anything else is refused in plain words, nothing changes). Only ROAD has grip, so a flight in the selection is left as it is. ONE undo step; the selection stays on the pieces.
     * 100 is AC's own road and writes no grip at all.
     */
    setGrip(g) {
      const s = st.selection, d = doc();
      if (!s || s.base !== d) return set({ message: 'select the pieces first: click a piece on the track (shift-click for a run)' });
      const c = GL.check(g); if (!c.ok) return set({ message: c.why });
      const idx = d.pieces.map((P, i) => (s.ids.includes(P.id) && P.type === 'road' ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) return set({ message: 'the selection has no road piece: only road has grip' });
      if (idx.every((i) => D.gripOf(d.pieces[i]) === c.grip)) return set({ ...ok(`the selected piece${idx.length === 1 ? '' : 's'} already ${idx.length === 1 ? 'has' : 'have'} grip ${c.grip}%`) });
      let nd; try { nd = D.setGrip(d, idx, c.grip); } catch (e) { if (e && e.name === 'CoreError') return set({ message: e.message }); throw e; }
      return commit('grip', () => nd, { lastEdited: null, selection: Object.freeze({ ...s, base: nd }), ...ok(`grip ${c.grip}% on ${idx.length} piece${idx.length === 1 ? '' : 's'}${c.grip < GL.TESTED_MIN || c.grip > GL.TESTED_MAX ? ' (untested: drive it)' : ''}`) });
    },
    /**
     * SPAWNS (2026-10-09): place the start by hand. `sp` is { line: { along }, grid: { count, rowGapM, colGapM }, hotlap?: { piece, along } }, or null to go back
     * to the export placing the start itself. One undo step; a bad value is refused in plain words and nothing changes.
     */
    setSpawns(sp) {
      const d = doc();
      if (sp && (!d.pieces[0] || d.pieces[0].type !== 'road')) return set({ message: 'put the first piece down first: the start line goes on it' });
      let nd; try { nd = D.setSpawns(d, sp); } catch (e) { if (e && e.name === 'CoreError') return set({ message: e.message }); throw e; }
      if (nd === d || JSON.stringify(nd.spawns) === JSON.stringify(d.spawns)) return st;
      return commit('spawns', () => nd, { lastEdited: null, ...ok(sp ? 'start placed by hand' : 'start back to automatic') });
    },
    /**
     * THE PIT LANE (2026-10-09): `lane` is src/core/document.js's pit lane ({ side, leave, rejoin, offsetM, width, divergeM, mergeM, speedKmh, boxes,
     * boxSpacingM }), or null to remove it. One undo step; a bad value is refused in plain words. Whether it can be BUILT here (a join on a wall is refused)
     * is spawnsInfo's laneError: an unbuildable lane is still kept, so moving a join off the wall needs no retyping.
     */
    setPitLane(lane) {
      const d = doc();
      if (lane && (!d.pieces[0] || d.pieces[0].type !== 'road')) return set({ message: 'put the first piece down first: the pit lane leaves the road beside it' });
      let nd; try { nd = D.setPitLane(d, lane); } catch (e) { if (e && e.name === 'CoreError') return set({ message: e.message }); throw e; }
      if (JSON.stringify(nd.pitLane) === JSON.stringify(d.pitLane)) return st;
      return commit('pitLane', () => nd, { lastEdited: null, ...ok(lane ? 'pit lane set' : 'pit lane removed') });
    },
    /**
     * FLATTEN FOR THE PIT (the keeper's idea, 2026-10-09): lower the cup, tube sweep and edge to the plain road beside the whole pit lane, easing back over
     * 60 m either side (src/core/pitflat.js), so the lane can leave and rejoin and runs level beside the road. Shape only: the route does not move. One undo step.
     */
    flattenForPit() {
      const d = doc(), lane = d.pitLane;
      if (!lane) return set({ message: 'add a pit lane first' });
      const off = SC.pieceOffsets(d), at = (a) => { const i = d.pieces.findIndex((P) => P.id === a.word); return i < 0 ? null : off[i] + a.along; };
      const s0 = at(lane.leave), s1 = at(lane.rejoin);
      if (s0 === null || s1 === null) return set({ message: 'a pit lane join is on a piece that is not on the track any more: pick its piece again' });
      let nd; try { nd = require('../../src/core/pitflat.js').flattenUnder(d, { s0, s1, ramp: 60 }); } catch (e) { if (e && e.name === 'CoreError') return set({ message: e.message }); throw e; }
      // a TUBE opened under the racing line leaves the line without road where it opens (measured on the keeper's T-180 TUBE OVAL: downforce-ray gaps at every
      // ramp tried, 60 to 300 m), so the export will refuse it: say so now, not at export time
      const tubeOpened = nd.pieces.some((P, i) => P.tube && P.channels.t !== d.pieces[i].channels.t);
      return commit('flattenForPit', () => nd, { lastEdited: null, ...ok(tubeOpened
        ? 'the tube beside the pit lane is opened (Ctrl+Z closes it). A tube opened under the racing line usually leaves the line without road where it opens, and the export will say so: on a tube track, start the tube after the pit straight instead'
        : 'the road beside the pit lane is flattened (Ctrl+Z puts the walls back)') });
    },
    /**
     * Where the cars start, for the panel and the preview: { spawns, firstLength, placed, check, notes, missing } from the hand-placed layout, or null when the
     * track has no spawns (or nothing resolves yet). `placed` is src/markers placeAll's: every marker with its world position, or an `error`.
     */
    spawnsInfo() {
      const d = doc();
      if ((!d.spawns && !d.pitLane) || !st.resolved || !st.resolved.segments || !st.resolved.segments.length) return null;
      const segs = st.resolved.segments;
      try {
        let layout, path, firstLength;
        if (d.spawns) ({ layout, path, firstLength } = spawnsLayout(d, segs, st.resolved.lift, st.resolved.start, { open: !d.closed }));
        else {   // the automatic start, with a pit lane to show: the same placement the export makes
          const { buildPath } = require('../../src/geom/index.js'), p0 = buildPath(segs, { step: 2, closed: !!d.closed, ...(st.resolved.start ? { start: st.resolved.start } : {}) });
          path = st.resolved.lift ? st.resolved.lift(p0) : p0;
          try { layout = startLayout(segs, st.resolved.lift, st.resolved.start, { open: !d.closed }); } catch (e) { if (e.code !== 'NO_START_STRAIGHT') throw e; layout = null; }
        }
        // the pit lane: built as the export builds it (src/geom/pitlane.js); a lane that cannot be built says why, in the export's words
        let lane = null, laneError = null;
        if (d.pitLane) {
          try { lane = require('../../src/geom/pitlane.js').buildPitLane(path, segs, laneRoad(d)); } catch (e) { if (e.name !== 'PitLaneError') throw e; laneError = e.message; }
          if (layout) layout = withPitBoxes(layout, d.pitLane);
        }
        if (!layout) return { spawns: d.spawns, pitLane: d.pitLane, lane: lane && laneOutline(lane, d.pitLane.width), laneError, error: 'the start cannot be placed automatically (no straight long enough): place it by hand' };
        const M = require('../../src/markers/index.js'), r = M.placeAll(layout, path, segs, lane ? { lane: { path: lane.path, segments: lane.segments } } : {});
        const res = require('../../src/markers/layout.js').resolveLayout(layout, path, segs);
        return { spawns: d.spawns, pitLane: d.pitLane, firstLength, layout, placed: r.placed, check: r.check, notes: res.notes, missing: res.missing, lane: lane && laneOutline(lane, d.pitLane.width), laneError };
      } catch (e) { return { spawns: d.spawns, pitLane: d.pitLane, error: e.message }; }
    },
    /** The grip of the road at the head (100 on an empty track or one with no grip set): what the Extend field shows, and what the next piece takes unless it is changed. */
    headGrip() { const d = doc(); for (let i = d.pieces.length - 1; i >= 0; i--) if (d.pieces[i].type === 'road') return D.gripOf(d.pieces[i]); return D.GRIP_DEFAULT; },
    /** What the selection is, for the panel: { from, to, count, lengthM, atEnd, saveProblem }; saveProblem is why it cannot be kept as a piece (null when it can). null when nothing is selected. */
    selectionInfo() {
      const s = st.selection, d = doc();
      if (!s || s.base !== d) return null;
      let saveProblem = null;
      try { PC.saveRun(d, s.from, s.to, { name: 'selection' }); } catch (e) { if (e.name !== 'CoreError') throw e; saveProblem = e.message; }
      const byId = new Map(d.pieces.map((P) => [P.id, P]));   // the selection's own pieces in lap order (D250: a run across a closed lap's start line is from > to)
      return { from: s.from, to: s.to, count: s.ids.length, ids: s.ids, lengthM: s.ids.reduce((a, id) => a + (byId.get(id).type === 'road' ? byId.get(id).length : 0), 0), atEnd: s.to === d.pieces.length - 1, closed: !!d.closed, longWay: s.longWay || null, saveProblem };
    },
    async savePiece(name) {
      if (!storage || typeof storage.savePiece !== 'function') return set({ message: 'saving a piece is not available here' });
      const s = st.selection, d = doc();
      if (!s || s.base !== d) return set({ message: 'select the pieces to keep first: click a piece on the track (shift-click for a run)' });
      let text;
      try { const piece = PC.saveRun(d, s.from, s.to, { name }); text = PC.serialize(piece); } catch (e) { if (e.name !== 'CoreError') throw e; return set({ message: e.message }); }
      try { await storage.savePiece(name, text); } catch (e) { return set({ message: `the piece was not saved: ${e && e.message || e}` }); }   // a name already used is refused by the native side, and says so
      return set({ libraryStamp: st.libraryStamp + 1, ...ok(`saved the piece "${name}": ${s.ids.length} piece${s.ids.length === 1 ? '' : 's'} from the track (it is in the library below)`) });
    },
    /**
     * THE LIBRARY: every saved piece, [{ name, summary, thumb, error }] sorted by name. summary is src/core/piece.js summary (pieces, roads, flights, kind, lengthM,
     * turnDeg, climbDeg); thumb a plan-view outline for a thumbnail ({ w, h, points }). A file that cannot be read is LISTED with the reason (a named refusal), never hidden.
     */
    async listPieces() {
      if (!storage || typeof storage.listPieces !== 'function') return [];
      const out = [];
      for (const name of await storage.listPieces()) {
        try { const piece = PC.parse(await storage.openPiece(name)); out.push({ name, summary: PC.summary(piece), thumb: thumbOf(piece), error: null }); }
        catch (e) { out.push({ name, summary: null, thumb: null, error: String(e && e.message || e) }); }
      }
      return out;
    },
    /** ADD AT THE HEAD: the saved piece, put where the track ends, as ONE undo step; `mirror` adds its left/right mirror image. Refused by name (CLOSED, PIECE_KIND, a joint the document refuses...) with nothing changed. */
    async insertPiece(name, { mirror = false } = {}) {
      if (!storage || typeof storage.openPiece !== 'function') return set({ message: 'saved pieces are not available here' });
      let piece;
      try { piece = PC.parse(await storage.openPiece(name)); } catch (e) { return set({ message: `could not open the piece "${name}": ${e && e.message || e}` }); }
      const before = doc(), r = commit('insertPiece', () => PC.insert(before, piece, { mirror }), { lastEdited: null });
      if (!r) return st;
      return set(ok(`added the piece "${name}"${mirror ? ' mirrored' : ''} at the head: ${st.history.present.pieces.length - before.pieces.length} piece${st.history.present.pieces.length - before.pieces.length === 1 ? '' : 's'} (Ctrl+Z takes it back)`));
    },
    /** Rename a saved piece: the new name must be free (a piece is never overwritten); the file's own name field changes with it. */
    async renamePiece(from, to) {
      if (!storage || typeof storage.openPiece !== 'function' || typeof storage.savePiece !== 'function' || typeof storage.deletePiece !== 'function') return set({ message: 'saved pieces are not available here' });
      let text, orig;
      try { orig = await storage.openPiece(from); text = PC.serialize({ ...PC.parse(orig), name: to }); } catch (e) { return set({ message: `could not rename the piece "${from}": ${e && e.message || e}` }); }
      // A CASE-ONLY rename (Run to run; D240 follow-up, C's look F2): Windows names are case-blind, so "run" IS the file "Run" and saving under it is refused as a name in use. It is the same file: the new text goes
      // to a temporary name first, the old file is removed, the new name is written, the temporary one removed; a failure on the way puts the old file back (or keeps the temporary copy and says so), so the piece is never lost
      if (from !== to && from.toLowerCase() === to.toLowerCase()) {
        const tmp = `${to}-r`;
        try { await storage.savePiece(tmp, text); } catch (e) { return set({ message: `not renamed: ${e && e.message || e}` }); }
        try { await storage.deletePiece(from); } catch (e) { try { await storage.deletePiece(tmp); } catch (e2) { /* the copy stays: said below */ } return set({ libraryStamp: st.libraryStamp + 1, message: `not renamed: the old file could not be replaced (${e && e.message || e})` }); }
        try { await storage.savePiece(to, text); } catch (e) {
          try { await storage.savePiece(from, orig); await storage.deletePiece(tmp); return set({ libraryStamp: st.libraryStamp + 1, message: `not renamed: ${e && e.message || e}; the piece is as it was` }); }
          catch (e2) { return set({ libraryStamp: st.libraryStamp + 1, message: `the rename failed (${e && e.message || e}) and the piece is kept as "${tmp}"` }); }
        }
        try { await storage.deletePiece(tmp); } catch (e) { return set({ libraryStamp: st.libraryStamp + 1, message: `renamed the piece "${from}" to "${to}", but its temporary copy "${tmp}" could not be removed: ${e && e.message || e}` }); }
        return set({ libraryStamp: st.libraryStamp + 1, ...ok(`renamed the piece "${from}" to "${to}"`) });
      }
      try { await storage.savePiece(to, text); } catch (e) { return set({ message: `not renamed: ${e && e.message || e}` }); }
      try { await storage.deletePiece(from); } catch (e) { return set({ libraryStamp: st.libraryStamp + 1, message: `the piece was copied to "${to}" but the old one "${from}" could not be removed: ${e && e.message || e}` }); }
      return set({ libraryStamp: st.libraryStamp + 1, ...ok(`renamed the piece "${from}" to "${to}"`) });
    },
    /** Delete a saved piece FILE (the library entry), not pieces of the track. */
    async deletePieceFile(name) {
      if (!storage || typeof storage.deletePiece !== 'function') return set({ message: 'saved pieces are not available here' });
      try { await storage.deletePiece(name); } catch (e) { return set({ message: `the piece was not deleted: ${e && e.message || e}` }); }
      return set({ libraryStamp: st.libraryStamp + 1, ...ok(`deleted the saved piece "${name}"`) });
    },

    /**
     * DELETE THE SELECTED PIECES OF THE TRACK. At the open end (the selection includes the last piece) the pieces simply go, as ONE undo step. In the MIDDLE the two sides
     * must meet again, and src/core/piece.js deleteRun does that by changing the first piece after the gap and moving everything after it along as one (C measured 357 of
     * 357 middle deletes doing so), so nothing is deleted until it is PREVIEWED: proposeDelete shows the track as it would be (a ghost), how far each piece after the gap
     * moves, and an OVERLAP CHECK of the result, as Close's preview does; applyDelete writes the track to its backups first ('pre-delete'), refuses by name if that copy
     * fails, and commits ONE undo step; cancelDelete drops it. A closed track has no open end to delete from (CLOSED), and a join the document refuses is DELETE_REJOIN.
     */
    deleteSelection() {
      const s = st.selection, d = doc();
      if (!s || s.base !== d) return set({ message: 'select the pieces to delete first: click a piece on the track (shift-click for a run)' });
      if (d.closed) return set({ message: 'CLOSED: a closed track has no open end to delete from; Ctrl+Backspace removes the last piece and opens the loop (Ctrl+Z puts it back)' });
      if (s.to === d.pieces.length - 1) {
        const n = s.to - s.from + 1;
        const r = commit('deletePieces', () => PC.deleteRun(d, s.from, s.to), { lastEdited: null, selection: null });
        return r ? set(ok(`deleted ${n} piece${n === 1 ? '' : 's'} at the end of the track (Ctrl+Z puts ${n === 1 ? 'it' : 'them'} back)`)) : st;
      }
      return api.proposeDelete();
    },
    proposeDelete() {
      const s = st.selection, d = doc();
      if (!s || s.base !== d) return set({ message: 'select the pieces to delete first: click a piece on the track (shift-click for a run)' });
      return attempt(() => {
        const t0 = now(), res = PC.deleteRun(d, s.from, s.to), r = resolvedOf(res), ms = now() - t0;
        const proposal = Object.freeze({ base: d, doc: res, resolved: r.resolved, from: s.from, to: s.to, removed: Object.freeze(s.ids.slice()), ms,
          displacement: Object.freeze(displacementAfterDelete(d, res)), check: overlapRunner ? null : Object.freeze(overlapCheck(r.resolved, st.designSpeedKmh, { closed: !!res.closed })) });
        const after = proposal.displacement.filter((x) => x.piece >= s.from), moved = after.filter((x) => x.maxM > 1e-3), n = s.to - s.from + 1;
        const words = (ck) => `delete preview: ${n} piece${n === 1 ? ' goes' : 's go'}; ${moved.length} of the ${after.length} piece${after.length === 1 ? '' : 's'} after the gap move${ck.overlaps.length ? `; the track OVERLAPS ITSELF in ${overlapPlacesText(ck, r.resolved.segments, { closed: r.resolved.closed })}` : ''}. Apply or cancel`;
        if (!overlapRunner) return set({ deleteProposal: proposal, ...ok(words(proposal.check)) });
        const entry = beginCheck(proposal, res, !!res.closed, (e) => (e.status === 'done' ? ok(words(e.result)) : { message: `the overlap check could not run: ${e.error}. Cancel the preview and delete again` }));
        return set({ deleteProposal: proposal, proposalCheck: entry, ...ok(`delete preview: ${n} piece${n === 1 ? ' goes' : 's go'}; ${moved.length} of the ${after.length} piece${after.length === 1 ? '' : 's'} after the gap move. Checking for overlaps: Apply is off until that finishes (Cancel stops it)`) });
      });
    },
    async applyDelete() {
      const p = st.deleteProposal;
      if (!p) return set({ message: 'nothing to apply: press Delete on the selected pieces first' });
      if (p.base !== doc()) return set({ deleteProposal: null, message: 'the track changed since the delete preview: select the pieces and delete again' });
      if (!checkOf(p)) return set({ message: 'the overlap check of this preview has not finished: Apply when it has (Cancel drops the preview)' });
      // as Close: the track AS IT IS NOW goes to track-backups first, and a copy that fails refuses the delete by name, with nothing changed
      try { await api.backupNow('pre-delete'); } catch (e) { return set({ message: `not deleted: the copy from before the delete could not be written (${e && e.message || e}); nothing changed` }); }
      if (st.deleteProposal !== p || p.base !== doc()) return set({ deleteProposal: null, message: 'the track changed while its copy was being written: select the pieces and delete again' });
      const n = p.to - p.from + 1;
      return set({ history: D.commit(st.history, p.doc), resolved: p.resolved, resolveError: null, dirty: true, deleteProposal: null, selection: null, lastEdited: null, lastStep: { op: 'deletePieces', ms: p.ms }, ...ok(`deleted ${n} piece${n === 1 ? '' : 's'} from the middle of the track (Ctrl+Z puts ${n === 1 ? 'it' : 'them'} back)`) });
    },
    cancelDelete: () => set({ deleteProposal: null, message: null }),

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
     * throws an ExportError with a code (OPEN_LOOP, NO_START_STRAIGHT, or the exporter's own, e.g. RED with .red). `opts.test` (D243a) is the
     * test export of an OPEN track (TEST_CLOSED on a closed one).
     */
    buildExport(opts = {}) {
      if (!exporter) throw exportError('NO_EXPORTER', 'export is not available here');
      // D243a: opts.test is the TEST export of an unfinished OPEN track (the page's own button, never the default): it is written open, its grid laid on
      // the open path, its reds listed as warnings. A CLOSED track is refused it by name: the lap would be built open, with the end wall at its seam
      if (opts.test && doc().closed) throw exportError('TEST_CLOSED', 'this track is closed: use Export (the test export is for an unfinished, open track)');
      if (!doc().closed && !opts.test) throw exportError('OPEN_LOOP', 'the loop is not closed: close it first (one click), then export');
      let markers;
      // SPAWNS (2026-10-09): a track whose start was placed by hand exports exactly that; one that never was keeps the automatic placement
      if (doc().spawns) markers = spawnsLayout(doc(), st.resolved.segments, st.resolved.lift, st.resolved.start, { open: !!opts.test }).layout;
      else try { markers = startLayout(st.resolved.segments, st.resolved.lift, st.resolved.start, { open: !!opts.test }); } catch (e) { if (e.code !== 'NO_START_STRAIGHT') throw e; throw exportError('NO_START_STRAIGHT', `not exported: ${e.message}`); }
      const pit = laneRoad(doc());
      if (pit) markers = withPitBoxes(markers, doc().pitLane);
      return exporter.runSegments(st.resolved.segments, { name: api.exportDoc().name, description: 'Built from equations by t180-track-builder.', via: 'src/core/adapter.js toSegments', liftPath: st.resolved.lift, start: st.resolved.start, ...(pit ? { pitLane: pit } : {}) }, { ...opts, markers });
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
        // D242: a red refusal names EVERY red in plain words, grouped, with where (the message was the export's own, every reason by its id: the keeper read
        // "downforce-ray-gap" first and nothing about 28 more that all said the road runs into itself)
        return stop({ message: e.code === 'RED' && Array.isArray(e.red) ? `not exported: ${RG.groupsText(RG.groupReds(e.red, st.resolved.segments, { closed: st.resolved.closed }))}` : e.message, exportReds: e.code === 'RED' ? e.red : null });
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
      const body = D.serialize(doc());
      await storage.saveDoc(PREFIX + name, body);
      // D272: then its undo history, beside it. AFTER the track, and a failure here never fails the save: the track is kept, and the one line says what was not.
      let note = null;
      if (typeof storage.saveUndo === 'function') {
        try { await storage.saveUndo(PREFIX + name, packHistory(st.history, body)); } catch (e) { note = `saved ${name}, but its undo history could not be kept (${e && e.message || e}): after reopening it, Ctrl+Z will not reach back past this save`; }
      }
      await clearAutosave();   // saved under a name: nothing is left to recover (D239, as the piece builder did)
      return set({ name, dirty: false, message: note });
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
      const { doc: d, name, docText, undoText } = st.recovery;
      let history = D.createHistory(d), note = null;   // D272: the autosave's history, when it has one and it is this document's
      if (undoText !== undefined && undoText !== null) {
        const r = typeof undoText === 'string' ? unpackHistory(undoText, docText, d) : { bad: 'it is not text' };
        if (r.history) history = r.history; else note = `the autosave's undo history could not be used (${r.mismatch ? 'it is not this track\'s' : r.bad}): the track was restored without it`;
      }
      return set({ history, ...resolvedOf(d), name, dirty: true, recovery: null, lastEdited: null, exportReds: null, message: note });
    },
    async discardRecovery() { await clearAutosave(); return set({ recovery: null }); },
    /** The window is closing on purpose: nothing is left to recover. */
    async cleanExit() { await clearAutosave(); },
    /**
     * BACKUP NOW (D239 amendment: the keeper lost TEST 1 to one Close, with no copy from before it). Writes the document AS IT IS NOW
     * to the track's backups (native backup_track: track-backups/<eq-name>.<local time>.t180track, newest 20 kept), under the saved
     * name or, unsaved, under "unsaved". `reason` is said in the result. Resolves { file, reason }, or null where there is no native
     * side to write to (headless, a browser); a write that FAILS rejects, so the caller can refuse the operation it was guarding.
     * applyClose (D242's Close, the panel's one close path) awaits it first and refuses the close if it rejects.
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
      // D272: its undo history from the sidecar, if there is one and it is this file's; reading it never blocks the open
      let history = D.createHistory(d), note = null;
      if (typeof storage.openUndo === 'function') {
        try {
          const side = await storage.openUndo(PREFIX + name);
          if (side !== null && side !== undefined) { const r = unpackHistory(side, text, d); if (r.history) history = r.history; else if (r.bad) note = `the saved undo history for ${name} could not be used (${r.bad}): the track opened without it`; }
        } catch (e) { note = `could not read the undo history for ${name} (${e && e.message || e}): the track opened without it`; }
      }
      return set({ history, ...resolvedOf(d), name, dirty: false, lastEdited: null, message: note, exportReds: null });
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

/**
 * D242: how far each road piece's CENTRELINE moves between two documents of the same pieces (a close changes control points, never lengths):
 * [{ piece, id, maxM }], the largest distance between the two paths' stations of that piece (the same stations: each segment samples on its own grid).
 */
function displacementOf(a, b) {
  const pa = AD.toPath({ ...a, closed: false }).path.samples, pb = AD.toPath({ ...b, closed: false }).path.samples, segs = toSegments({ ...a, closed: false });
  const idOf = (m) => (segs[m.seg] ? segs[m.seg].id : null), out = new Map();
  a.pieces.forEach((P, i) => { if (P.type === 'road') out.set(P.id, { piece: i, id: P.id, maxM: 0 }); });
  const n = Math.min(pa.length, pb.length);
  for (let k = 0; k < n; k++) { const e = out.get(idOf(pa[k])); if (!e) continue; const d = Math.hypot(pa[k].pos[0] - pb[k].pos[0], pa[k].pos[1] - pb[k].pos[1], pa[k].pos[2] - pb[k].pos[2]); if (d > e.maxM) e.maxM = d; }
  return [...out.values()];
}
/**
 * D240: how far each road or jump piece AFTER a deleted run moves: [{ piece (its number in `b`), id, maxM }], the largest distance between its centreline in `a` and in `b`,
 * station for station (a piece keeps its length, so it keeps its stations). The pieces before the gap are the same in both and read 0.
 */
function displacementAfterDelete(a, b) {
  const stations = (d) => {
    const segs = toSegments({ ...d, closed: false }), samples = AD.toPath({ ...d, closed: false }).path.samples, by = new Map();
    for (const m of samples) { const g = segs[m.seg]; if (!g) continue; if (!by.has(g.id)) by.set(g.id, []); by.get(g.id).push(m.pos); }
    return by;
  };
  const pa = stations(a), pb = stations(b), out = [];
  b.pieces.forEach((P, i) => {
    const x = pa.get(P.id), y = pb.get(P.id); if (!x || !y) return;
    let maxM = 0; for (let k = 0; k < Math.min(x.length, y.length); k++) maxM = Math.max(maxM, Math.hypot(x[k][0] - y[k][0], x[k][1] - y[k][1], x[k][2] - y[k][2]));
    out.push({ piece: i, id: P.id, maxM });
  });
  return out;
}
/**
 * D240: a saved piece's PLAN VIEW for its thumbnail: the piece laid on an empty track, its centreline's ground plan (x, z) scaled to fit 100 x 60 with a margin, at most 48 points.
 * null when it cannot be laid out (the library still lists it).
 */
function thumbOf(piece) {
  try {
    const d = PC.insert(D.createDoc('thumb'), piece), pts = AD.toPath({ ...d, closed: false }).path.samples.map((m) => [m.pos[0], m.pos[2]]);
    if (pts.length < 2) return null;
    const stride = Math.max(1, Math.ceil(pts.length / 48)), pick = pts.filter((_, i) => i % stride === 0 || i === pts.length - 1);
    const xs = pick.map((p) => p[0]), zs = pick.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const W = 100, H = 60, M = 6, k = Math.min((W - 2 * M) / Math.max(x1 - x0, 1e-6), (H - 2 * M) / Math.max(z1 - z0, 1e-6)), ox = (W - k * (x1 - x0)) / 2, oz = (H - k * (z1 - z0)) / 2;
    const r1 = (v) => Math.round(v * 10) / 10;
    return { w: W, h: H, points: pick.map((p) => [r1(ox + k * (p[0] - x0)), r1(oz + k * (p[1] - z0))]) };
  } catch (e) { return null; }
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
function startLayout(segments, lift, start, { open = false } = {}) {   // open (D243a): the test export of an unfinished track lays its grid on an OPEN path
  const { buildPath } = require('../../src/geom/index.js'), Markers = require('../../src/markers/layout.js');
  const nearly = (g) => g.kind === 'road' && [g.k0, g.k1, g.kp0, g.kp1].every((x) => Math.abs(x) <= STRAIGHT_K) && [g.roll0, g.roll1].every((x) => Math.abs(x) <= STRAIGHT_ROLL);
  const marked = segments.map((g) => (nearly(g) ? { ...g, word: 'straight', k0: 0, k1: 0, kp0: 0, kp1: 0, roll0: 0, roll1: 0 } : g));
  const p = buildPath(segments, { step: 2, closed: !open, ...(start ? { start } : {}) });
  return Markers.defaultLayout(lift ? lift(p) : p, marked);
}

/**
 * THE HAND-PLACED START (the keeper, 2026-10-09: "move the start line around the first piece … a numbered grid that fits the track … a hotlap spawn I
 * plop down"): the layout the doc's `spawns` says, in src/markers/layout.js's shape, on the same path startLayout builds. The line is `along` metres into
 * the FIRST piece (clamped to it: a piece shortened after the line was placed keeps the line on it); the grid is two staggered columns of `count` slots
 * with the doc's spacing, pole 10 m behind the line (src/markers/layout.js PACK); the pit boxes stay automatic until the pit module exists (two boxes
 * on the centreline, 16 m behind the last grid slot); the hotlap is the doc's piece and distance, or the automatic design-speed run-up when not placed.
 * Returns { layout, path, firstLength }.
 */
function spawnsLayout(doc, segments, lift, start, { open = false } = {}) {
  const { buildPath } = require('../../src/geom/index.js'), Markers = require('../../src/markers/layout.js'), { segStarts } = require('../../src/markers/place.js');
  const sp = doc.spawns, first = doc.pieces[0];
  if (!sp) throw Object.assign(new Error('spawnsLayout: the track has no spawns'), { code: 'NO_SPAWNS' });
  if (!first || first.type !== 'road') throw Object.assign(new Error('the start line goes on the first piece, and the track has no first road piece'), { code: 'NO_START_STRAIGHT' });
  const p0 = buildPath(segments, { step: 2, closed: !open, ...(start ? { start } : {}) }), path = lift ? lift(p0) : p0;
  const firstLength = segments.filter((g) => g.id === first.id).reduce((a, g) => a + g.length, 0);
  const line = { word: first.id, along: Math.min(Math.max(sp.line.along, 0), firstLength) };
  const grid = { pattern: '2-staggered', count: sp.grid.count, poleBackM: Markers.DEFAULTS.poleBackM, rowGapM: sp.grid.rowGapM, colGapM: sp.grid.colGapM, edits: {} };
  // the pits, behind the grid, as an anchor (segment id and metres into the first segment carrying that id: anchorS's convention)
  const starts = segStarts(path, segments), sLine = Markers.anchorS(line, segments, starts);
  const lastBack = Math.max(...Markers.gridSlots(grid).map((x) => x.backM)), L = path.lengthM, s0 = path.samples[0].s;
  let sPit = sLine - (lastBack + 16); if (!open) sPit = ((sPit - s0) % L + L) % L + s0;
  let k = 0; for (let i = 0; i < segments.length; i++) if (starts[i] <= sPit) k = i;
  const firstOf = segments.findIndex((g) => g.id === segments[k].id);
  const pits = { at: { word: segments[k].id, along: Math.max(0, sPit - starts[firstOf]) }, count: Markers.DEFAULTS.pits, spacingM: Markers.DEFAULTS.pitSpacingM, u: 0, lane: null };
  const hotlap = sp.hotlap ? { at: { word: sp.hotlap.piece, along: sp.hotlap.along } } : { speedKmh: null };
  return { layout: { version: 1, height: Markers.DEFAULTS.height, gateInsetM: Markers.DEFAULTS.gateInsetM, line, grid, pits, hotlap, sectors: [] }, path, firstLength };
}

/** The pit lane's ROAD part (src/doc/pitlane.js's shape, for src/geom/pitlane.js and the export's meta.pitLane), or null without a lane. */
function laneRoad(doc) { if (!doc.pitLane) return null; const { boxes, boxSpacingM, ...road } = doc.pitLane; return road; }
/** The layout with the pit lane's boxes: its count and spacing (the boxes go ON the lane: src/markers/index.js placeAll moves them there). */
function withPitBoxes(layout, pitLane) { return { ...layout, pits: { ...layout.pits, count: pitLane.boxes, spacingM: pitLane.boxSpacingM } }; }
/** The lane's two edges as world polylines, for the preview: the lane's own path stations, out by half its width either way along its L. */
function laneOutline(lane, width) {
  const half = width / 2, S = lane.path.samples, stride = Math.max(1, Math.ceil(S.length / 400)), L = [], R = [];
  for (let i = 0; i < S.length; i += stride) { const m = S[i]; L.push(m.pos.map((v, k) => v + m.L[k] * half)); R.push(m.pos.map((v, k) => v - m.L[k] * half)); }
  return { left: L, right: R, lengthM: lane.path.lengthM, joins: lane.joins };
}

/** The road pieces overlapping [a, b] of the path's s (the adapter's s, flights and ramps included: sculpt.js pieceOffsets), for
 *  close's "edited last". */
function piecesIn(doc, a, b) {
  const off = pieceOffsets(doc), out = [];
  doc.pieces.forEach((P, i) => { if (P.type === 'road' && off[i] + P.length >= a && off[i] <= b) out.push(i); });
  return out.length ? out : null;
}

module.exports = { createCoreShell, NAME_RE, PREFIX, BRUSH_MODES, SCULPT_CHANNELS, STRAIGHT_K, piecesIn, straightPieces, startLayout, spawnsLayout, profilerOf, thumbOf, displacementAfterDelete };
