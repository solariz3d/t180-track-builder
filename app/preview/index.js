// index.js: the preview panel's seam (app/README.md "The seam"): mount(root, shell) puts the 3D preview in `root`.
// The camera panel (app/camera/index.js) is loaded separately, with its own module cache, so the two talk through two
// DOM events on the document rather than shared state:
//   't180-camera'       { detail: { mode } }           asks the preview for a camera mode
//   't180-camera-mode'  { detail: { mode, modes } }    the preview says which mode it is in (on mount and on every change)
'use strict';

const { createPreview } = require('./preview.js');
const { MODES } = require('../camera/cameras.js');

function mount(root, shell) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const canvas = doc.createElement('canvas'), hud = doc.createElement('div');
  canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none';
  hud.style.cssText = 'position:absolute;left:8px;bottom:6px;font:12px ui-monospace,Consolas,monospace;color:#9aa4b2;pointer-events:none';
  root.append(canvas, hud);
  const announce = (mode) => doc.dispatchEvent(new win.CustomEvent('t180-camera-mode', { detail: { mode, modes: MODES.slice() } }));
  const p = createPreview({ canvas, shell, win, hud, onMode: announce });
  const ask = (e) => { if (e.detail && e.detail.mode) p.setMode(e.detail.mode); };
  doc.addEventListener('t180-camera', ask);
  return { preview: p, unmount() { doc.removeEventListener('t180-camera', ask); p.dispose(); root.replaceChildren(); } };
}

module.exports = { mount };
