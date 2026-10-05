// selectionlayer.js: THE SELECTED PIECES ON THE TRACK (D240, saved pieces, the UI half; the keeper: "highlight/select pieces on the track"). A canvas over the preview
// (#preview), redrawn every animation frame like the labels (the camera eases, so the highlight moves with it): the selected pieces' centreline, drawn bright over the road
// with a dark outline, and a dot at each end of the run. The preview is not changed: its pose comes from the 't180:view' event and the track from 't180:track-request'
// (app/preview/index.js), exactly as app/core/labels.js reads them.
//
//   selectionLines(track, ids, pose, W, H) -> [{ id, points: [{ x, y }] }]   pure: the screen polylines (css px of the preview) of the pieces `ids`, broken where the track
//                                                                              passes behind the camera; at most ~120 points a piece
//   mount(stage, shell, win) -> { lines(), unmount() }                         lines() is what was drawn last (for the tests and the window proof)
'use strict';

const M = require('../camera/math.js');

function selectionLines(track, ids, pose, W, H) {
  if (!track || !track.path || !Array.isArray(track.segments) || !ids || !ids.length || !pose || !(W > 0 && H > 0)) return [];
  const want = new Set(ids), by = new Map(), VP = M.viewProj(pose, W / H);
  for (const m of track.path.samples) { const g = track.segments[m.seg]; if (!g || !want.has(g.id)) continue; if (!by.has(g.id)) by.set(g.id, []); by.get(g.id).push(m.pos); }
  const toScreen = (p) => { const c = M.apply(VP, p); return c[3] > 0 ? { x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * H } : null; };
  const out = [];
  for (const id of ids) {
    const pts = by.get(id); if (!pts) continue;
    const stride = Math.max(1, Math.ceil(pts.length / 120)); let cur = [];
    pts.forEach((p, i) => {
      if (i % stride && i !== pts.length - 1) return;
      const q = toScreen(p);
      if (q) cur.push(q); else if (cur.length) { out.push({ id, points: cur }); cur = []; }
    });
    if (cur.length) out.push({ id, points: cur });
  }
  return out;
}

function mount(stage, shell, win) {
  const doc = stage.ownerDocument, canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-label', 'selected pieces');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5';
  stage.append(canvas);
  const ask = (name) => { let got = null; doc.dispatchEvent(new win.CustomEvent(name, { detail: { reply: (x) => { got = x; } } })); return got; };
  let raf = 0, drawn = [], sized = '';
  const frame = () => {
    raf = win.requestAnimationFrame(frame);
    if (!canvas.isConnected && stage.isConnected !== false) stage.append(canvas);   // the preview's mount clears #preview after the panel mounted (as the labels' layer)
    const st = shell.getState(), info = shell.selectionInfo ? shell.selectionInfo() : null, W = stage.clientWidth, H = stage.clientHeight;
    const view = info ? ask('t180:view') : null, track = info ? ask('t180:track-request') : null;
    drawn = view && view.pose && track ? selectionLines(track, info.ids, view.pose, W, H) : [];
    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return;
    const dpr = win.devicePixelRatio || 1, key = `${W}x${H}@${dpr}`;
    if (key !== sized) { canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr)); sized = key; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!drawn.length) return;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [w, colour] of [[9, '#0b0d11'], [4.5, '#ffb020']]) {
      ctx.lineWidth = w; ctx.strokeStyle = colour;
      for (const l of drawn) { ctx.beginPath(); l.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); }
    }
    ctx.fillStyle = '#ffb020'; ctx.strokeStyle = '#0b0d11'; ctx.lineWidth = 2;
    const first = drawn[0].points[0], lastLine = drawn[drawn.length - 1], last = lastLine.points[lastLine.points.length - 1];
    for (const p of [first, last]) { ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  };
  raf = win.requestAnimationFrame(frame);
  return { lines: () => drawn.slice(), unmount() { win.cancelAnimationFrame(raf); canvas.remove(); } };
}

module.exports = { selectionLines, mount };
