// index.js: the camera panel's seam (app/README.md "The seam"): mount(root) shows the camera modes as buttons, marks
// the current one, and names the keys. The cameras themselves live in the preview (app/preview/index.js); this panel
// asks for a mode with a 't180-camera' event and follows the preview's 't180-camera-mode' announcements.
// D237: it also carries the GRID and SYMMETRY controls (the keeper: "a 3D grid ... see the track and make it all symmetrical"): Grid Auto | Ground | 3D | Off, Mirror Off |
// Left/right | Front/back | Both, a Reset-centre button and the gap readout. They talk to the preview with 't180:guides' and follow its 't180:guides-state' (app/preview/index.js).
'use strict';

const { MODES, KEYS } = require('./cameras.js');

const LABEL = { build: 'Build', overhead: 'Overhead', side: 'Side', chase: 'Chase', free: 'Free' };

const GRID_LABEL = { auto: 'Auto', ground: 'Ground', '3d': '3D', off: 'Off' }, MIRROR_LABEL = { off: 'Off', x: 'Left/right', z: 'Front/back', both: 'Both' };
const fmtM = (x) => (Number.isFinite(x) ? (x >= 100 ? x.toFixed(0) : x.toFixed(1)) : '–');
/** The words under the Grid and Mirror buttons from the preview's state (pure, for the tests). */
function guidesText(s) {
  if (!s) return { grid: '', gap: '' };
  const drawn = s.drawn === 'ground' ? 'ground grid' : s.drawn === '3d' ? '3D lattice' : 'no grid';
  const grid = s.grid === 'auto' ? `auto: ${drawn}${s.flat === null ? '' : s.flat ? ' (the track is flat)' : ` (the track spans ${fmtM(s.range)} m of height)`}` : drawn;
  const gap = s.mirror === 'off' ? '' : s.gap ? `mirror gap: largest ${fmtM(s.gap.max)} m · average ${fmtM(s.gap.mean)} m` : 'mirror gap: no track yet';
  return { grid, gap, centre: s.centre ? `centre (${fmtM(s.centre.x)}, ${fmtM(s.centre.z)}) m${s.centre.set ? '' : ' · the box\'s middle'}` : '' };
}

function mount(root) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const bar = doc.createElement('div'), keys = doc.createElement('p');
  bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Camera');
  const buttons = new Map();
  for (const m of MODES) {
    const b = doc.createElement('button'); b.type = 'button'; b.textContent = LABEL[m] || m;
    b.onclick = () => doc.dispatchEvent(new win.CustomEvent('t180-camera', { detail: { mode: m } }));
    buttons.set(m, b); bar.append(b);
  }
  keys.textContent = `${KEYS.cycle.toUpperCase()}: next camera · ${KEYS.build.toUpperCase()}: build view · move: W A S D, Q E down/up, Shift sprint · look: right-drag or arrows · zoom: scroll`;
  // D237: the grid and the symmetry guides
  const send = (detail) => doc.dispatchEvent(new win.CustomEvent('t180:guides', { detail }));
  const gridBar = doc.createElement('div'), words = doc.createElement('p'), gridButtons = new Map(), mirrorButtons = new Map();
  gridBar.setAttribute('role', 'toolbar'); gridBar.setAttribute('aria-label', 'Grid and symmetry');
  const tag = (text) => { const s = doc.createElement('span'); s.textContent = text; s.style.cssText = 'margin:0 6px 0 10px;color:#9aa3b2'; return s; };
  gridBar.append(tag('Grid'));
  for (const m of ['auto', 'ground', '3d', 'off']) { const b = doc.createElement('button'); b.type = 'button'; b.textContent = GRID_LABEL[m]; b.onclick = () => send({ grid: m }); gridButtons.set(m, b); gridBar.append(b); }
  gridBar.append(tag('Mirror'));
  for (const m of ['off', 'x', 'z', 'both']) { const b = doc.createElement('button'); b.type = 'button'; b.textContent = MIRROR_LABEL[m]; b.title = m === 'x' ? 'left/right: x flips about the centre' : m === 'z' ? 'front/back: z flips about the centre' : m === 'both' ? 'point symmetry: a half turn about the centre' : 'no mirror'; b.onclick = () => send({ mirror: m }); mirrorButtons.set(m, b); gridBar.append(b); }
  const reset = doc.createElement('button'); reset.type = 'button'; reset.textContent = 'Reset centre'; reset.title = 'put the symmetry centre back at the middle of the track\'s box'; reset.onclick = () => send({ centre: null }); gridBar.append(reset);
  words.style.cssText = 'margin:4px 10px;color:#9aa3b2;font-size:12px'; words.setAttribute('aria-live', 'polite');
  root.append(bar, gridBar, words, keys);
  const follow = (e) => { for (const [m, b] of buttons) b.setAttribute('aria-pressed', String(e.detail && e.detail.mode === m)); };
  const guides = (e) => {
    const s = e.detail; if (!s || s.error) return;
    for (const [m, b] of gridButtons) b.setAttribute('aria-pressed', String(s.grid === m)); for (const [m, b] of mirrorButtons) b.setAttribute('aria-pressed', String(s.mirror === m));
    reset.disabled = !(s.centre && s.centre.set); const t = guidesText(s); words.textContent = [`Grid: ${t.grid}`, t.gap, t.centre].filter(Boolean).join(' · ');
  };
  doc.addEventListener('t180-camera-mode', follow); doc.addEventListener('t180:guides-state', guides);
  doc.dispatchEvent(new win.CustomEvent('t180:guides-request', { detail: { reply: (s) => guides({ detail: s }) } }));   // the preview may already be up
  return { unmount() { doc.removeEventListener('t180-camera-mode', follow); doc.removeEventListener('t180:guides-state', guides); root.replaceChildren(); } };
}

module.exports = { mount, guidesText };
