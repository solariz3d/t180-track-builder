// index.js: the preview panel's seam (app/README.md "The seam"): mount(root, shell) puts the 3D preview in `root`.
// The camera panel (app/camera/index.js) is loaded separately, with its own module cache, so the two talk through two
// DOM events on the document rather than shared state:
//   't180-camera'       { detail: { mode } }           asks the preview for a camera mode
//   't180-camera-mode'  { detail: { mode, modes } }    the preview says which mode it is in (on mount and on every change)
// And one for the window proof (app/testhook/probe.js, scripts/prove_render.js), answered read-only:
//   't180-probe'        { detail: { reply(result) } }  the mode, the head on screen, the canvas size and DPR
// And the GHOST of the next piece (D170; the palette's side is A's, proposed in the D170 hand-back):
//   't180-ghost'        { detail: { candidate } | { word } }   show it: a resolved candidate (the document with the word
//                                                              appended, not committed), or a built-in word, resolved here
//                                                              the way shell.place() would (app/testhook/ghostword.js)
//   't180-ghost-clear'                                         hide it
//
// A MOUNT THAT FAILS says why, twice: the reason is left visible in the panel ("The preview could not start: …"), and
// mount throws a PreviewMountError with the same message, for the page to show where it likes (A's display half).
'use strict';

const { createPreview } = require('./preview.js');
const { MODES } = require('../camera/cameras.js');
const { probe } = require('../testhook/probe.js');
const { candidateFor } = require('../testhook/ghostword.js');

class PreviewMountError extends Error {
  constructor(message, cause) { super(message); this.name = 'PreviewMountError'; if (cause) this.cause = cause; }
}

function mount(root, shell) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const canvas = doc.createElement('canvas'), hud = doc.createElement('div');
  canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none';
  hud.style.cssText = 'position:absolute;left:8px;bottom:6px;font:12px ui-monospace,Consolas,monospace;color:#9aa4b2;pointer-events:none';
  root.append(canvas, hud);
  const announce = (mode) => doc.dispatchEvent(new win.CustomEvent('t180-camera-mode', { detail: { mode, modes: MODES.slice() } }));
  let p;
  try { p = createPreview({ canvas, shell, win, hud, onMode: announce }); } catch (e) {
    const msg = `The preview could not start: ${e.message}`, note = doc.createElement('p');
    note.textContent = msg; note.setAttribute && note.setAttribute('role', 'alert');
    root.replaceChildren(note);
    throw new PreviewMountError(msg, e);
  }
  const ask = (e) => { if (e.detail && e.detail.mode) p.setMode(e.detail.mode); };
  const answer = (e) => { if (e.detail && typeof e.detail.reply === 'function') e.detail.reply(probe(p, canvas, win)); };
  const showGhost = (e) => {
    const d = e.detail || {};
    try { p.showGhost(d.candidate || candidateFor(shell.getState(), d.word)); } catch (err) { p.clearGhost(); if (typeof d.reply === 'function') d.reply({ error: err.message }); return; }
    if (typeof d.reply === 'function') d.reply({ ok: true });
  };
  const hideGhost = () => p.clearGhost();
  doc.addEventListener('t180-camera', ask);
  doc.addEventListener('t180-probe', answer);
  doc.addEventListener('t180-ghost', showGhost);
  doc.addEventListener('t180-ghost-clear', hideGhost);
  return { preview: p, unmount() { doc.removeEventListener('t180-camera', ask); doc.removeEventListener('t180-probe', answer); doc.removeEventListener('t180-ghost', showGhost); doc.removeEventListener('t180-ghost-clear', hideGhost); p.dispose(); root.replaceChildren(); } };
}

module.exports = { mount, PreviewMountError };
