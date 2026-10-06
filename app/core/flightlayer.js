// flightlayer.js: THE FLIGHTS ON THE TRACK AS DASHED ARCS (D243 item 1, the UI half: "the preview draws the flight as a dashed arc"). A canvas over the preview (#preview), redrawn every animation frame
// like the labels and the selection (the camera eases, so the arcs move with it). It draws every flight of the track on screen, and of the ghost while one shows (the Add-jump control's candidate): the
// car's BALLISTIC flight at the design speed, one dashed line per measured fall (app/core/jumpplan.js says what that is, and draws a straight dashed line, and says so, where there is no flight model).
// The preview itself is not changed: its pose comes from 't180:view', the placed track from 't180:track-request' and the ghost from 't180:ghost-request' (app/preview/index.js).
//
//   flightLines(flights, pose, W, H) -> [{ id, g, clear, model, points: [{ x, y }] }]   pure: the dashed lines in css px of the preview, broken where they pass behind the camera
//   mount(stage, win)                -> { lines(), flights(), unmount() }               lines() is what was drawn last (for the tests and the window proof)
'use strict';

const M = require('../camera/math.js');
const JP = require('./jumpplan.js');

function flightLines(flights, pose, W, H) {
  if (!flights || !flights.length || !pose || !(W > 0 && H > 0)) return [];
  const VP = M.viewProj(pose, W / H), out = [];
  const toScreen = (p) => { const c = M.apply(VP, p); return c[3] > 0 ? { x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * H } : null; };
  for (const f of flights) for (const fall of f.falls) {
    let cur = [];
    for (const p of JP.arcWorld(f, fall)) { const q = toScreen(p); if (q) cur.push(q); else if (cur.length) { out.push({ id: f.id, g: fall.g, clear: fall.clear, model: f.model, points: cur }); cur = []; } }
    if (cur.length) out.push({ id: f.id, g: fall.g, clear: fall.clear, model: f.model, points: cur });
  }
  return out;
}

function mount(stage, win) {
  const doc = stage.ownerDocument, canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-label', 'flights');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4';
  stage.append(canvas);
  const ask = (name) => { let got = null; doc.dispatchEvent(new win.CustomEvent(name, { detail: { reply: (x) => { got = x; } } })); return got; };
  let raf = 0, drawn = [], shown = [], sized = '', memo = { samples: null, segments: null, flights: [] };
  const flightsNow = () => {
    // the ghost's path holds the placed track's flights and the candidate's, so while a ghost shows it is the one read; otherwise the placed track
    const g = ask('t180:ghost-request'), t = g ? null : ask('t180:track-request');
    const samples = g ? g.samples : t && t.path ? t.path.samples : null, segments = g ? g.segments : t ? t.segments : null;
    if (!samples || !segments) return [];
    if (memo.samples !== samples || memo.segments !== segments) memo = { samples, segments, flights: JP.flightsOfPath({ samples }, segments) };
    return memo.flights;
  };
  const frame = () => {
    raf = win.requestAnimationFrame(frame);
    if (!canvas.isConnected && stage.isConnected !== false) stage.append(canvas);   // the preview's mount clears #preview after the panel mounted
    const W = stage.clientWidth, H = stage.clientHeight, view = ask('t180:view');
    shown = view && view.pose ? flightsNow() : []; drawn = shown.length ? flightLines(shown, view.pose, W, H) : [];
    const ctx = canvas.getContext ? canvas.getContext('2d') : null; if (!ctx) return;
    const dpr = win.devicePixelRatio || 1, key = `${W}x${H}@${dpr}`;
    if (key !== sized) { canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr)); sized = key; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!drawn.length) return;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [w, dash, pick] of [[5, [10, 7], () => '#0b0d11'], [2.5, [10, 7], (l) => (l.clear === false ? '#ff6b6b' : '#7fd8ff')]]) {
      ctx.lineWidth = w; ctx.setLineDash(dash);
      for (const l of drawn) { ctx.strokeStyle = pick(l); ctx.beginPath(); l.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    // a caption at the lighter fall's middle: what the line is
    const lead = drawn.filter((l) => l.g === null || l.g === JP.FALLS[0]);
    ctx.font = 'bold 12px system-ui, "Segoe UI", sans-serif'; ctx.textBaseline = 'bottom';
    for (const l of lead) { const m = l.points[Math.floor(l.points.length / 2)], text = l.model === 'straight' ? 'flight (straight line)' : `flight · ${Math.round(JP.DESIGN_KMH)} km/h`; ctx.fillStyle = 'rgba(11,13,17,0.85)'; ctx.fillRect(m.x - 4, m.y - 22, ctx.measureText(text).width + 8, 17); ctx.fillStyle = '#7fd8ff'; ctx.fillText(text, m.x, m.y - 7); }
  };
  raf = win.requestAnimationFrame(frame);
  return { lines: () => drawn.slice(), flights: () => shown.slice(), unmount() { win.cancelAnimationFrame(raf); canvas.remove(); } };
}

module.exports = { flightLines, mount };
