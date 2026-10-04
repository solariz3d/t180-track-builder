// guideslayer.js: the DOM half of the 3D grid and the symmetry guides (D237): the LEVEL LABELS ("+20 m") on the lattice and the draggable CENTRE handle. A DOM layer over the
// preview, redrawn by the preview every frame (the camera eases, so these move with it). Everything else, the lines, is drawn by the renderer from app/preview/guides.js.
//
//   createGuidesLayer({ root, win, onCentre }) -> { update({ plan, pose, aspect, cssWidth, cssHeight }), dispose(), labels(), handle() }
//   onCentre({ x, z }) is called while the handle is dragged: the world point under the pointer on the base plane (the lowest point of the track).
//   labels() is what is drawn: [{ text, x, y }] in css px of the preview; handle() the handle's { x, y } or null (for the tests and the window proof).
// FIXED PIXEL SIZE, like app/core/labels.js. A label behind the camera or outside the view is not drawn. The layer takes no pointer events but the handle's own.
'use strict';

const { projectPoint, rayAt, planeHit } = require('./guides.js');

function createGuidesLayer({ root, win, onCentre = null }) {
  const doc = root.ownerDocument, layer = doc.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;overflow:hidden';
  const pool = [], handle = doc.createElement('div');
  handle.setAttribute('aria-label', 'the symmetry centre: drag it to move the axes'); handle.title = 'the symmetry centre: drag to move it';
  handle.style.cssText = 'position:absolute;display:none;width:18px;height:18px;margin:-9px 0 0 -9px;border:2px solid #ffd23f;border-radius:50%;background:rgba(255,210,63,0.18);pointer-events:auto;cursor:grab;touch-action:none';
  layer.append(handle); root.append(layer);
  let last = null, drawn = [], at = null, dragging = false;

  const labelEl = (i) => {
    if (pool[i]) return pool[i];
    const e = doc.createElement('div');
    e.style.cssText = 'position:absolute;font:12px/1.2 ui-monospace,Consolas,monospace;color:#9fb4d0;background:rgba(10,12,16,0.55);padding:0 4px;border-radius:3px;white-space:nowrap;display:none';
    layer.append(e); pool[i] = e; return e;
  };
  const move = (e) => {
    if (!dragging || !last || !last.plan || !last.plan.centre) return;
    const rect = root.getBoundingClientRect(), w = rect.width || last.cssWidth, h = rect.height || last.cssHeight; if (!(w > 0 && h > 0)) return;
    const hit = planeHit(rayAt(last.pose, last.aspect, ((e.clientX - rect.left) / w) * 2 - 1, 1 - ((e.clientY - rect.top) / h) * 2), last.plan.base);
    if (hit && onCentre) onCentre({ x: hit[0], z: hit[2] });
  };
  const down = (e) => { dragging = true; handle.style.cursor = 'grabbing'; if (handle.setPointerCapture && e.pointerId !== undefined) { try { handle.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic event has no pointer to capture */ } } e.preventDefault(); e.stopPropagation(); };
  const up = () => { dragging = false; handle.style.cursor = 'grab'; };
  handle.addEventListener('pointerdown', down); handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);

  return {
    update(f) {
      last = f; drawn = []; at = null;
      const { plan, pose, aspect, cssWidth: W, cssHeight: H } = f, labels = plan && pose && W > 0 && H > 0 ? plan.labels : [];
      const place = (p) => { const s = projectPoint(pose, aspect, p); return s && Math.abs(s.nx) <= 1 && Math.abs(s.ny) <= 1 ? { x: (s.nx * 0.5 + 0.5) * W, y: (1 - (s.ny * 0.5 + 0.5)) * H } : null; };
      labels.forEach((l, i) => {
        const e = labelEl(i), p = place(l.pos);
        if (!p) { e.style.display = 'none'; return; }
        e.textContent = l.text; e.style.left = `${Math.round(p.x + 6)}px`; e.style.top = `${Math.round(p.y - 8)}px`; e.style.display = 'block'; drawn.push({ text: l.text, x: Math.round(p.x + 6), y: Math.round(p.y - 8) });
      });
      for (let i = labels.length; i < pool.length; i++) pool[i].style.display = 'none';
      const c = plan && plan.centre && pose && W > 0 && H > 0 ? place([plan.centre.x, plan.base, plan.centre.z]) : null;
      if (c) { handle.style.left = `${c.x}px`; handle.style.top = `${c.y}px`; handle.style.display = 'block'; at = { x: c.x, y: c.y }; } else if (!dragging) handle.style.display = 'none';
    },
    labels: () => drawn.slice(), handle: () => (at ? { ...at } : null),
    dispose() { handle.removeEventListener('pointerdown', down); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); layer.remove(); },
  };
}

module.exports = { createGuidesLayer };
