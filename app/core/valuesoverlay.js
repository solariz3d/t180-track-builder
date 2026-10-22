// valuesoverlay.js: THE VALUES OF THE PIECE BEING EDITED, LARGE, OVER THE 3D VIEW (D267, the keeper, 10:15, relaying a tester: "the values or degrees for the track needs to be in a better spot to be seen").
// A DOM layer over the preview (#preview) at the top: length, turn, climb, bank and width of the piece the fields describe, in big type, updated by the panel every time the readout is (as a handle is
// dragged, a field is typed in, the track changes), and hidden while there is no such piece (a closed loop). The numbers are the panel's own (src/core/readout.js through app/core/labels.js
// formatReadout; the width is the width field): nothing is computed here.
//
//   SPOT_CSS                    where it sits: the ONE constant to change if the keeper meant another spot (inferred from "a better spot to be seen")
//   entries(f, widthText)       -> [{ key, label, value }]   f = labels.formatReadout(r) ({ length, turn, climb, bank }), widthText the width as shown ("31 m")
//   sculptEntries(s)            -> [{ key, label, value }]   D425 part 4, IN SCULPT (P's design §1 cue 5): s = { tool, name, value, radius, moves }, the tool, its value at the centre under
//                                                            the channel's name, the radius and what moves ("road after" / "stays"); the panel's own words, nothing computed here
//   mount(stage, win)           -> { set(entries | null), entries(), visible(), unmount() }
'use strict';

const SPOT_CSS = 'top:10px;left:50%;transform:translateX(-50%)';
const KEYS = Object.freeze([['length', 'length'], ['turn', 'turn'], ['climb', 'climb'], ['bank', 'bank'], ['width', 'width']]);

function entries(f, widthText) {
  if (!f) return null;
  const all = { ...f, width: widthText };
  return KEYS.filter(([k]) => all[k] !== undefined && all[k] !== null && all[k] !== '').map(([key, label]) => ({ key, label, value: String(all[key]) }));
}

function sculptEntries(s) {
  if (!s || !s.tool) return null;
  return [{ key: 'tool', label: 'tool', value: String(s.tool) }, { key: 'value', label: s.name ? String(s.name) : 'value', value: s.value ? String(s.value) : '—' },
    { key: 'radius', label: 'radius', value: s.radius ? String(s.radius) : '—' }, { key: 'moves', label: 'moves', value: s.moves ? String(s.moves) : '—' }];
}

function mount(stage, win) {
  const doc = stage.ownerDocument, layer = doc.createElement('div');
  layer.setAttribute('aria-label', 'piece values');
  // the keeper, 2026-10-12: the numbers "look goofy". A dashboard read: Bahnschrift (Windows' DIN face, on every Windows
  // 10 and 11) with fixed-width digits, so a number does not jitter as a handle drags it; each label small and grey above
  // its value, and a thin rule between the values.
  layer.style.cssText = `position:absolute;${SPOT_CSS};z-index:4;pointer-events:none;display:none;padding:7px 4px;border-radius:8px;background:color-mix(in srgb, var(--veil, #0b0d11) 86%, transparent);color:var(--on-ink-strong, #ffffff);font:bold 26px/1.05 Bahnschrift,"Segoe UI",system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap`;
  stage.append(layer);
  let shown = null;
  const set = (list) => {
    if (!layer.isConnected && stage.isConnected !== false) stage.append(layer);   // the preview's mount clears #preview after the panel mounted this layer
    shown = list && list.length ? list : null;
    if (!shown) { layer.style.display = 'none'; layer.replaceChildren(); return; }
    layer.style.display = 'flex';
    layer.replaceChildren(...shown.map((e, i) => {
      const s = doc.createElement('span'), label = doc.createElement('span'), value = doc.createElement('span');
      s.setAttribute('data-value', e.key);
      s.style.cssText = `display:flex;flex-direction:column;align-items:center;padding:0 16px${i ? ';border-left:1px solid var(--veil-rule, rgba(255,255,255,0.14))' : ''}`;
      label.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--dim);margin-bottom:3px';
      label.textContent = e.label;
      value.textContent = e.value;
      s.append(label, value);
      return s;
    }));
  };
  return { set, entries: () => (shown ? shown.slice() : null), visible: () => !!shown, layer, unmount() { layer.remove(); } };
}

module.exports = { entries, sculptEntries, mount, SPOT_CSS };
