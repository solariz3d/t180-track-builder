// speed.js: the design-speed picker. Validation computes loads at this speed for every word that has none of its own
// (src/validate speedProfile, opts.designSpeed), so the load colours appear while building. It edits no document: it is
// a setting of the validation, like the CSP toggle, so it adds no undo entries and no word changes.
//
//   const p = createSpeedPicker({ kmh, onChange })   p.kmh (null = off)   p.set(kmh | null)   p.ms() (m/s or null)
//   mountSpeedPicker(root, p)                         a slider, the km/h, and an "off" box
//
// THE DEFAULT is 460 km/h, the pooled median of seven clean Mach 6 laps (docs/FINDINGS.md:476, §3d), read through
// src/validate/limits.js MACH6.designSpeedKmh. THE RANGE is 50 km/h (inferred: a floor below which loads are ~1 g and
// say nothing) to the lap sim's cap, 764 km/h (FINDINGS.md:484). OFF gives no design speed: loads then come only from
// words with their own speed, or from the ghost lap once the loop is closed.
//
// WHERE IT SITS: app/validate-ui/index.js mounts it at the top of #validation, so it needs no seam. If A wants it in the
// build palette too (app/palette), mountSpeedPicker(root, picker) takes any element; the picker object is the one
// the validation panel owns, reached through the 't180:validation' event's `speedPicker` field.
'use strict';
const { MACH6 } = require('../../src/validate/limits.js');

const MIN_KMH = 50, MAX_KMH = MACH6.vmaxKmh;

function createSpeedPicker({ kmh = MACH6.designSpeedKmh, onChange = () => {} } = {}) {
  let cur = null;
  const clamp = (k) => (k == null ? null : Math.min(MAX_KMH, Math.max(MIN_KMH, k)));
  const p = {
    get kmh() { return cur; },
    set(k) {
      if (k != null && !Number.isFinite(k)) throw new Error(`speed picker: ${k} is not a speed in km/h`);
      const next = clamp(k);
      if (next === cur) return cur;
      cur = next; onChange(cur); return cur;
    },
    ms: () => (cur == null ? null : cur / 3.6),
    range: Object.freeze([MIN_KMH, MAX_KMH]),
    defaultKmh: MACH6.designSpeedKmh,
  };
  cur = clamp(kmh);
  return p;
}

function mountSpeedPicker(root, p) {
  const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const slider = el('input', { type: 'range', min: MIN_KMH, max: MAX_KMH, step: 5, value: p.kmh == null ? p.defaultKmh : p.kmh });
  const shown = el('span', { className: 'v-speed' });
  const off = el('input', { type: 'checkbox', checked: p.kmh == null });
  const show = () => { shown.textContent = p.kmh == null ? 'off' : `${Math.round(p.kmh)} km/h`; slider.disabled = p.kmh == null; };
  slider.oninput = () => { p.set(Number(slider.value)); show(); };
  off.onchange = () => { p.set(off.checked ? null : Number(slider.value)); show(); };
  root.append(el('label', { title: 'Loads are computed at this speed for every word without its own (docs/FINDINGS.md §3d: the median of seven clean Mach 6 laps is 460 km/h).' }, ['design speed ', slider, ' ', shown, ' ', off, ' off']));
  show();
}

module.exports = { createSpeedPicker, mountSpeedPicker, MIN_KMH, MAX_KMH };
