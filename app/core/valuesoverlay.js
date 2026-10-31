// valuesoverlay.js: THE VALUES OF THE PIECE BEING EDITED, LARGE, OVER THE 3D VIEW (the user, 10:15, relaying a tester: "the values or degrees for the track needs to be in a better spot to be seen").
// A DOM layer over the preview (#preview) at the top: length, turn, climb, bank and width of the piece the fields describe, in big type, updated by the panel every time the readout is (as a handle is
// dragged, a field is typed in, the track changes), and hidden while there is no such piece (a closed loop). The numbers are the panel's own (src/core/readout.js through app/core/labels.js
// formatReadout; the width is the width field): nothing is computed here.
//
//   SPOT_CSS                    where it sits: the ONE constant to change if the user meant another spot (inferred from "a better spot to be seen")
//   entries(f, widthText)       -> [{ key, label, value }]   f = labels.formatReadout(r) ({ length, turn, climb, bank }), widthText the width as shown ("31 m")
//   sculptEntries(s)            -> [{ key, label, value }]   IN SCULPT: s = { tool, name, value, radius, moves }, the tool, its value at the centre under
//                                                            the channel's name, the radius and what moves ("road after" / "stays"); the panel's own words, nothing computed here
//   mount(stage, win)           -> { set(entries | null), entries(), visible(), attach(node), unmount() }   attach: a node shown under the values, in the same strip, while they show
'use strict';

const SPOT_CSS = 'top:8px;left:calc(50% + var(--preview-shift, 0px));transform:translateX(-50%)';   // --preview-shift: half the column, so it centres on the view the column leaves (app/index.html)
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
  const doc = stage.ownerDocument, layer = doc.createElement('div'), row = doc.createElement('div');
  layer.setAttribute('aria-label', 'piece values');
  // the user, 2026-10-12: the numbers "look goofy". A dashboard read: Bahnschrift (Windows' DIN face, on every Windows
  // 10 and 11) with fixed-width digits, so a number does not jitter as a handle drags it; each label small and grey above
  // its value, and a thin rule between the values. The number is the biggest thing in the strip (24 px, bold); its unit and its label beside it are small and light (11 px)
  layer.style.cssText = `position:absolute;${SPOT_CSS};z-index:4;pointer-events:none;display:none;flex-direction:column;align-items:center;padding:4px 6px;border-radius:8px;background:color-mix(in srgb, var(--veil, #0b0d11) 86%, transparent);color:var(--on-ink-strong, #ffffff);font:700 24px/1.1 Bahnschrift,"Segoe UI",system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap`;
  row.style.cssText = 'display:flex';
  layer.append(row);
  stage.append(layer);
  let shown = null, drawn = null;   // drawn: the text of what the row shows now, so a set with the same values (every frame of a drag that does not change them) does nothing
  const set = (list) => {
    if (!layer.isConnected && stage.isConnected !== false) stage.append(layer);   // the preview's mount clears #preview after the panel mounted this layer
    shown = list && list.length ? list : null;
    const key = shown ? JSON.stringify(shown) : null;
    if (key === drawn) return;
    drawn = key;
    if (!shown) { layer.style.display = 'none'; row.replaceChildren(); below(); return; }
    layer.style.display = 'flex';
    row.replaceChildren(...shown.map((e, i) => {
      const s = doc.createElement('span'), label = doc.createElement('span'), value = doc.createElement('span');
      s.setAttribute('data-value', e.key);
      s.style.cssText = `display:flex;align-items:baseline;gap:5px;padding:0 10px${i ? ';border-left:1px solid var(--veil-rule, rgba(255,255,255,0.14))' : ''}`;
      label.style.cssText = 'font-size:11px;font-weight:300;color:color-mix(in srgb, currentColor 66%, transparent);font-variant:small-caps;letter-spacing:.04em';   // the strip's own text colour (whatever the look makes it), mixed down: --dim at this size fell under 4.5:1 on it
      label.textContent = e.label;
      // the number and its unit apart ("31.00 m" -> "31.00" and " m"), so the unit can be small; the text read as a whole is unchanged
      const m = /^([-+−]?[\d.,]+)(.*)$/.exec(e.value);
      if (m && m[2]) { const unit = doc.createElement('span'); unit.style.cssText = 'font-size:11px;font-weight:300'; unit.textContent = m[2]; const num = doc.createElement('span'); num.textContent = m[1]; value.append(num, unit); } else value.textContent = e.value;
      s.append(label, value);
      return s;
    }));
    below();
  };
  const attach = (node) => { layer.append(node); };
  // where the strip ends, for what the page places under it (the camera's label, app/index.html .preview-hud): it grows with the next-piece line. Read by a ResizeObserver,
  // after layout, where there is one: reading offsetHeight here forced a layout in the middle of every drag frame that set new values
  const put = (px) => { if (stage.style && typeof stage.style.setProperty === 'function') stage.style.setProperty('--values-bottom', px); };
  // THE VIEW TAG'S HEIGHT (D581; the user, 2026-10-31: it "sits too low"): its top level with the column card's (#left) wherever it clears this strip by
  // HUD_CLEAR_PX, otherwise HUD_UNDER_PX under the strip. The strip is centred and its width follows its values, so the test is made here, after layout, whenever
  // the strip or the tag changes size (the tag's words change with the view) and when the window is resized (the strip moves without changing size).
  // It sets --hud-top on the stage; the tag's rule (app/index.html .preview-hud) falls back to D409's placement under the strip where it is not set
  const HUD_CLEAR_PX = 12, HUD_UNDER_PX = 6;
  let hudSeen = null, hudTries = 0;
  const placeHud = () => {
    if (!stage.style || typeof stage.style.setProperty !== 'function' || !stage.querySelector) return;
    const hud = stage.querySelector('.preview-hud'), col = doc.getElementById('left');
    // the preview makes the tag after this strip mounts (and may remake it): until it is there, look again on the next frames (60 at most); once it is
    // observed, its own size changes call this
    if (!hud || !hud.offsetParent) { if (hudTries++ < 60 && win && typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(placeHud); return; }
    hudTries = 0;
    if (RO && hud !== hudSeen) { if (hudSeen) RO.unobserve(hudSeen); RO.observe(hud); hudSeen = hud; }
    const box = hud.offsetParent.getBoundingClientRect(), t = hud.getBoundingClientRect(), b = shown ? layer.getBoundingClientRect() : null, c = col ? col.getBoundingClientRect() : null;
    const top = !b || t.right + HUD_CLEAR_PX <= b.left ? (c ? c.top - box.top : null) : b.bottom - box.top + HUD_UNDER_PX;
    if (top === null) stage.style.removeProperty('--hud-top'); else stage.style.setProperty('--hud-top', `${Math.round(top)}px`);
  };
  const RO = win && typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => { put(shown ? `${layer.offsetTop + layer.offsetHeight}px` : '0px'); placeHud(); }) : null;
  if (RO) RO.observe(layer);
  const onResize = () => placeHud();
  if (RO && win.addEventListener) win.addEventListener('resize', onResize);
  const below = () => { if (!shown) put('0px'); else if (!RO) put(`${layer.offsetTop + layer.offsetHeight}px`); };
  return { set, entries: () => (shown ? shown.slice() : null), visible: () => !!shown, attach, layer, unmount() { if (RO) { RO.disconnect(); if (win.removeEventListener) win.removeEventListener('resize', onResize); } layer.remove(); } };
}

module.exports = { entries, sculptEntries, mount, SPOT_CSS };
