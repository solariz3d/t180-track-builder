// panel.js: the handles panel's logic, with no DOM (tested headless against A's real shell). index.js mounts it.
//
//   const ctl = createHandlesController(shell, { csp: true })
//   ctl.target()                  -> { id, word, font, rows: [{ group, handle, value, unit, range }] } | null
//                                    the one selected word (shell.select), its sculpt handles in the plan's order
//   ctl.begin(handle, { pastRed }) -> { bounds }     computes that handle's physics bounds, opens ONE shell drag
//   ctl.move(value)               -> handles.js move result: { value, clamped, level, why }
//   ctl.end() / ctl.cancel()
//   ctl.bounds(handles?)          -> every handle's bounds for the target, at once (seconds: a button, never per move)
//
// Only one word is sculpted at a time: a selection of several words (for saving a piece) shows no handles.
'use strict';
const { handleInfo } = require('../../src/doc/library.js');
const { handleBounds } = require('../../src/validate/bounds.js');
const { SCULPT, startDrag } = require('./handles.js');

const STEP = 2;   // the validation step used for the bounds, as app/validate-ui (inferred)

function createHandlesController(shell, { csp = true } = {}) {
  let drag = null;
  const vopts = () => ({ csp });
  function target() {
    const st = shell.getState(), sel = st.selection;
    if (!sel || sel.length !== 1) return null;
    const doc = st.history.present, w = doc.words.find((x) => x.id === sel[0]);
    if (!w || w.phrase !== undefined) return null;
    const info = handleInfo(doc, w.id);
    const rows = [];
    for (const [group, hs] of Object.entries(SCULPT)) for (const h of hs) if (info.handles[h]) rows.push({ group, handle: h, ...info.handles[h] });
    return { id: w.id, word: w.word, font: w.font, rows };
  }
  return {
    target,
    setCsp(v) { csp = !!v; },
    begin(handle, { pastRed = false } = {}) {
      const t = target();
      if (!t) throw new Error('handles: select exactly one placed word to sculpt it');
      if (drag) throw new Error('handles: a drag is already open');
      drag = startDrag(shell, t.id, handle, { pastRed, validate: vopts(), step: STEP });
      return { bounds: drag.bounds };
    },
    move(value) { if (!drag) throw new Error('handles: no drag open'); return drag.move(value); },
    end() { if (!drag) return null; const h = drag.end(); drag = null; return h; },
    cancel() { if (!drag) return null; const h = drag.cancel(); drag = null; return h; },
    get dragging() { return !!drag; },
    bounds(handles) {
      const t = target();
      if (!t) return null;
      return handleBounds(shell.getState().history.present, t.id, { handles: handles || t.rows.map((r) => r.handle), step: STEP, validate: vopts() });
    },
  };
}

module.exports = { createHandlesController };
