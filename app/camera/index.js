// index.js: the camera panel's seam (app/README.md "The seam"): mount(root) shows the camera modes as buttons, marks
// the current one, and names the keys. The cameras themselves live in the preview (app/preview/index.js); this panel
// asks for a mode with a 't180-camera' event and follows the preview's 't180-camera-mode' announcements.
'use strict';

const { MODES, KEYS } = require('./cameras.js');

const LABEL = { build: 'Build', overhead: 'Overhead', side: 'Side', chase: 'Chase', free: 'Free' };

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
  keys.textContent = `${KEYS.cycle.toUpperCase()}: next camera · ${KEYS.build.toUpperCase()}: build view · free: W A S D, Q E, arrows or drag`;
  root.append(bar, keys);
  const follow = (e) => { for (const [m, b] of buttons) b.setAttribute('aria-pressed', String(e.detail && e.detail.mode === m)); };
  doc.addEventListener('t180-camera-mode', follow);
  return { unmount() { doc.removeEventListener('t180-camera-mode', follow); root.replaceChildren(); } };
}

module.exports = { mount };
