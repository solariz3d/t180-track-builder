// valuesoverlay.js: THE VALUES OF THE PIECE BEING EDITED, LARGE, OVER THE 3D VIEW (D267, the keeper, 10:15, relaying a tester: "the values or degrees for the track needs to be in a better spot to be seen").
// A DOM layer over the preview (#preview) at the top: length, turn, climb, bank and width of the piece the fields describe, in big type, updated by the panel every time the readout is (as a handle is
// dragged, a field is typed in, the track changes), and hidden while there is no such piece (a closed loop). The numbers are the panel's own (src/core/readout.js through app/core/labels.js
// formatReadout; the width is the width field): nothing is computed here.
//
//   SPOT_CSS                    where it sits: the ONE constant to change if the keeper meant another spot (inferred from "a better spot to be seen")
//   entries(f, widthText)       -> [{ key, label, value }]   f = labels.formatReadout(r) ({ length, turn, climb, bank }), widthText the width as shown ("31 m")
//   mount(stage, win)           -> { set(entries | null), entries(), visible(), unmount() }
'use strict';

const SPOT_CSS = 'top:10px;left:50%;transform:translateX(-50%)';
const KEYS = Object.freeze([['length', 'length'], ['turn', 'turn'], ['climb', 'climb'], ['bank', 'bank'], ['width', 'width']]);

function entries(f, widthText) {
  if (!f) return null;
  const all = { ...f, width: widthText };
  return KEYS.filter(([k]) => all[k] !== undefined && all[k] !== null && all[k] !== '').map(([key, label]) => ({ key, label, value: String(all[key]) }));
}

function mount(stage, win) {
  const doc = stage.ownerDocument, layer = doc.createElement('div');
  layer.setAttribute('aria-label', 'piece values');
  layer.style.cssText = `position:absolute;${SPOT_CSS};z-index:4;pointer-events:none;display:none;gap:22px;padding:6px 16px;background:rgba(11,13,17,0.86);color:#ffffff;font:bold 28px/1.2 system-ui,"Segoe UI",sans-serif;white-space:nowrap`;
  stage.append(layer);
  let shown = null;
  const set = (list) => {
    if (!layer.isConnected && stage.isConnected !== false) stage.append(layer);   // the preview's mount clears #preview after the panel mounted this layer
    shown = list && list.length ? list : null;
    if (!shown) { layer.style.display = 'none'; layer.replaceChildren(); return; }
    layer.style.display = 'flex';
    layer.replaceChildren(...shown.map((e) => { const s = doc.createElement('span'); s.setAttribute('data-value', e.key); s.textContent = `${e.label} ${e.value}`; return s; }));
  };
  return { set, entries: () => (shown ? shown.slice() : null), visible: () => !!shown, layer, unmount() { layer.remove(); } };
}

module.exports = { entries, mount, SPOT_CSS };
