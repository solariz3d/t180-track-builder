// panel.js: the markers panel's logic, with no DOM (tested headless against A's real shell). index.js mounts it.
//
//   const ctl = createMarkersController(shell, { onUpdate })
//   ctl.state -> { layout, custom, placed, paint, check, error }       after every change that moved the track
//   ctl.edit(fn)          fn(layout) -> layout: any change (pattern, count, gaps, pits, hotlap speed, sectors, height).
//                         From the first edit the layout is CUSTOM: it is kept, anchored to its words, through later
//                         edits of the track, so the markers stay on the road (§5c). Until then it is re-derived from the
//                         words each time (the default: the grid on the longest straight).
//   ctl.editSlot(n, { backM?, u? })     one grid slot, slot by slot (§5c: "editable slot by slot")
//   ctl.reset()           back to the default layout
//
// Where the layout goes from here is a seam (see app/markers/index.js): the export takes it as exportTrack's
// opts.markers, and the document should carry it (a proposal for A, D171 hand-back).
'use strict';
const { buildPath } = require('../../src/geom/index.js');
const Markers = require('../../src/markers/index.js');

const STEP = 2;   // m between stations, as the validation panel (inferred)
const clone = (x) => JSON.parse(JSON.stringify(x));

function createMarkersController(shell, { onUpdate = () => {} } = {}) {
  let layout = null, custom = false, resolved = null;
  const out = { state: { layout: null, custom: false, placed: [], paint: null, check: null, error: null } };

  function update(force = false) {
    const r = shell.getState().resolved;
    if (!r || !r.segments.length) { out.state = { ...out.state, placed: [], paint: null, check: null, error: r ? null : shell.getState().resolveError }; onUpdate(out.state); return; }
    if (r === resolved && !force) return;
    resolved = r;
    try {
      const path = buildPath(r.segments, { step: STEP, closed: !!r.closed });
      if (!custom) layout = Markers.defaultLayout(path, r.segments);
      const m = Markers.placeAll(layout, path, r.segments);
      out.state = { layout, custom, placed: m.placed, paint: m.paint, check: m.check, error: null, path };
    } catch (e) {
      if (!e.code) throw e;   // a model or geometry refusal is shown; anything else is a bug and stays loud
      out.state = { ...out.state, placed: [], paint: null, check: null, error: e.message };
    }
    onUpdate(out.state);
  }

  const unsubscribe = shell.subscribe(() => update());
  update();
  return {
    get state() { return out.state; },
    edit(fn) {
      if (!layout) throw new Error('markers: there is no layout yet (no start straight)');
      layout = fn(clone(layout)); custom = true; update(true); return out.state;
    },
    editSlot(n, patch) {
      return this.edit((l) => { l.grid.edits = { ...(l.grid.edits || {}), [n]: { ...(l.grid.edits || {})[n], ...patch } }; return l; });
    },
    reset() { custom = false; update(true); return out.state; },
    dispose() { unsubscribe(); },
  };
}

module.exports = { createMarkersController };
