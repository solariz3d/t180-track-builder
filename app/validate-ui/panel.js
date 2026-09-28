// panel.js: the validation panel's logic, with no DOM (tested headless against A's real shell). index.js mounts it.
//
//   const ctl = createValidationController(shell, { csp: true, designSpeedKmh, validate, onUpdate, schedule })
//     designSpeedKmh: the picker's speed for words without their own (default MACH6.designSpeedKmh, FINDINGS.md:476;
//     null = none). ctl.setDesignSpeed(kmh | null) re-validates the whole track at it.
//     validate: further src/validate options (e.g. a `car` with an acceleration, so the lap sim gives loads).
//     schedule(fn): when to run a pending update. Default: at once (headless). The app passes one animation frame, and
//     changes arriving before it runs are coalesced into one update (several appends are still one append).
//   ctl.state -> { path, result, map, arcs, changed, full, how, error }      after every shell change that moved the track
//   ctl.setCsp(bool)                                                          re-validates the whole track for that export
//   ctl.dispose()
//
// FOLLOWING THE BUILD HEAD. The shell keeps `resolved` incrementally (resolveFrom), and a panel "should keep the
// previous path and use extendPath / revalidate when only the tail changed" (app/README.md). So, per change:
//   · an APPEND at the open head (the old segments are the same objects, and only new ones follow): C's extendPath, then
//     revalidate from the old end, then re-colour only what changed                              how: 'append'
//   · a SCULPT of an earlier word (a prefix kept by identity, the first changed segment still there; the part count
//     may change, e.g. an ease set to 0): C's rebuildPathFrom from it, revalidate from its start  how: 'sculpt'
//   · anything else (the first build, a removed head, undo across a length change, a new or opened document, a closed
//     loop): a full buildPath and validate                                                        how: 'full'
// The prefix check is by object identity, so a shell that resolved from scratch simply takes the full route.
//
// ONE PATH (D177; C's hardening §1 item 2). With `sharedPath` (a function returning the preview's { path, segments } as
// C's 't180:track-request' replies it, or { path, resolved }),
// the controller validates a 2 m VIEW of the preview's path (pathview.js: its stations ARE buildPath's at 2 m, bit for bit)
// instead of growing a second path next to it; `state.pathFrom` says 'shared' or 'own'. The view is used only when
// `resolved` is the very document being validated; otherwise (no preview, a preview not yet updated, a step that does not
// divide) the controller grows its own path as below, so the shared path can make validation faster, never different.
//
// THE LAP of a closed loop is proven only when no drag is open (state.history.dragBase): each drag tick validates with
// the lap DEFERRED (lap.reason 'deferred'), and the change that ends the drag proves it (src/validate lapOf), the same
// lap an undeferred validate gives.
// A geometry or validation error is reported in `error`, and the last good state stays on screen: it is never hidden.
// extendPath and rebuildPathFrom work IN PLACE (src/geom/path.js), so fromS is read before they run, and after an error
// the path is dropped: the next change rebuilds in full rather than build on a half-grown path.
'use strict';
const { buildPath, extendPath, rebuildPathFrom } = require('../../src/geom/index.js');
const { createLive, fromSOf } = require('./live.js');
const { jumpArcs } = require('./jumparcs.js');
const { viewOf } = require('./pathview.js');
const { lapOf } = require('../../src/validate/index.js');
const { MACH6 } = require('../../src/validate/limits.js');

/** A result with its lap replaced, keeping the non-enumerable raw findings the next revalidate carries. */
const withLap = (res, lap) => { const o = { ...res, lap }; Object.defineProperty(o, '_raw', { value: res._raw, enumerable: false }); return o; };

const STEP = 2;   // m between stations: the step the export and the D167 tests use (inferred: not tuned for the preview)

function createValidationController(shell, { csp = true, designSpeedKmh = MACH6.designSpeedKmh, validate: extra = {}, onUpdate = () => {}, schedule = (fn) => fn(), sharedPath = null } = {}) {
  let design = designSpeedKmh;
  const vo = () => ({ ...extra, csp, ...(design == null ? {} : { designSpeed: design / 3.6 }) });
  let live = createLive({ validate: vo() });
  let segs = null, path = null, resolvedSeen = null, source = null;   // source: 'shared' (a view of the preview's path) | 'own'
  const out = { state: { path: null, result: null, map: null, arcs: [], changed: null, full: true, how: null, error: null, pathFrom: null } };

  function plan(r) {
    const next = r.segments;
    if (!path || !segs || path.closed || r.closed) return { how: 'full' };
    let g = 0; const n = Math.min(segs.length, next.length);
    while (g < n && segs[g] === next[g]) g++;
    if (g === segs.length && next.length > segs.length) return { how: 'append', g };
    if (g < segs.length && g < next.length) return { how: 'sculpt', g };
    return { how: 'full' };
  }

  /**
   * The preview's path for THIS resolved document, or null: only a path built from the very same document, known by
   * identity, either the resolved object ({ path, resolved }) or its segments array (C's 't180:track' detail,
   * { path, segments, … }, app/preview/index.js).
   */
  function shared(r) {
    if (!sharedPath) return null;
    let sh; try { sh = sharedPath(); } catch (e) { return null; }
    const same = sh && (sh.resolved === r || (sh.segments !== undefined && sh.segments === r.segments));
    return same && sh.path && !!sh.path.closed === !!r.closed ? sh.path : null;
  }

  function update(state, force = false) {
    const r = state.resolved, dragging = !!(state.history && state.history.dragBase);
    if (!r) { out.state = { ...out.state, error: state.resolveError || 'the document does not resolve' }; onUpdate(out.state); return; }
    if (r === resolvedSeen && !force) {
      // the same document: only a lap deferred during a drag may be owed, once the drag has ended
      if (!dragging && out.state.result && out.state.result.lap && out.state.result.lap.reason === 'deferred') { out.state = { ...out.state, result: withLap(out.state.result, lapOf(out.state.path, segs, out.state.result)) }; onUpdate(out.state); }
      return;
    }
    resolvedSeen = r;
    if (!r.segments.length) { segs = r.segments; path = null; source = null; live = createLive({ validate: vo() }); out.state = { path: null, result: null, map: null, arcs: [], changed: null, full: true, how: 'empty', error: null, pathFrom: null }; onUpdate(out.state); return; }
    let p = force ? { how: 'full' } : plan(r);
    try {
      let np = null, fromS;
      const sp = shared(r);
      if (sp) {
        // ONE PATH: a view of the preview's, which the preview has already grown for this document. The view keeps what
        // came before the change only when it is a view of the SAME path object (the preview grows it in place; a new
        // object means the preview rebuilt it, and so does this)
        const keep = p.how !== 'full' && source === 'shared' && path && path.src === sp;
        if (!keep) p = { how: 'full' };
        np = viewOf(sp, STEP, keep ? path : null, keep ? p.g : 0);
        if (np) { if (p.how === 'append') fromS = path.lengthM; else if (p.how === 'sculpt') fromS = fromSOf(np, p.g); }
      }
      if (!np) {
        // the controller's OWN path: no preview path for this document, or one it cannot view at STEP
        if (source !== 'own') p = { how: 'full' };
        if (p.how === 'append') { fromS = path.lengthM; np = extendPath(path, r.segments); }
        else if (p.how === 'sculpt') { np = rebuildPathFrom(path, r.segments, p.g); fromS = fromSOf(np, p.g); }
        else np = buildPath(r.segments, { step: STEP, closed: !!r.closed });
      }
      const pathFrom = np.src ? 'shared' : 'own';
      // the lap is proven when no drag is open (a closed loop's lap, never on a drag tick)
      const u = live.update(np, r.segments, p.how === 'full' ? { lap: !dragging } : { fromS, lap: !dragging });
      path = np; segs = r.segments; source = pathFrom;
      out.state = { path, result: u.result, map: u.map, arcs: jumpArcs(u.result, path), changed: u.changed, full: u.full, how: p.how, error: null, pathFrom };
    } catch (e) {
      path = null; segs = null; source = null; live = createLive({ validate: vo() });
      out.state = { ...out.state, error: e.message };
    }
    onUpdate(out.state);
  }

  let queued = false;
  const unsubscribe = shell.subscribe(() => { if (queued) return; queued = true; schedule(() => { queued = false; update(shell.getState()); }); });
  update(shell.getState());
  return {
    get state() { return out.state; },
    setCsp(v) { csp = !!v; live = createLive({ validate: vo() }); update(shell.getState(), true); },
    setDesignSpeed(kmh) { design = kmh == null ? null : kmh; live = createLive({ validate: vo() }); update(shell.getState(), true); },
    get designSpeedKmh() { return design; },
    dispose() { unsubscribe(); },
  };
}

/**
 * Counts for the panel's summary line. `jumps` is every jump validation checked, including one still PENDING at the
 * open head (no landing road yet): D170 fixed a counter that read the drawn arcs, which leave a pending jump out, so a
 * placed jump read "0 jumps" (the librarian's item 4, 2026-09-27).
 */
function summary(state) {
  const r = state.result;
  if (!r) return { red: 0, amber: 0, lap: null, jumps: 0, jumpsPending: 0 };
  return { red: r.red.length, amber: r.amber.length, lap: r.lap, jumps: r.jumps.length, jumpsPending: r.jumps.filter((j) => j.pending).length };
}

module.exports = { createValidationController, summary, STEP };
