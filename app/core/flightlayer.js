// flightlayer.js: THE FLIGHTS ON THE TRACK AS A DASHED LINE (D243's layer, simplified by D258, the free jump). A canvas over the preview (#preview), redrawn every animation frame like the labels and the
// selection (the camera eases, so the line moves with it). It draws the centreline of every flight on screen, and of the ghost while one shows (the Jump button's candidate): the curve the free
// flight takes from the take-off to the landing. NOTHING is computed about the air (no arc, no fall, no ramp: the keeper drives the jump in AC and moves the landing), so the line is only there to show
// that the two pieces are joined. The preview itself is not changed: its pose comes from 't180:view', the placed track from 't180:track-request' and the ghost from 't180:ghost-request'.
//
//   flightsOfPath(path, segments) -> [{ id, points: [[x, y, z]] }]            the centreline of each flight, from the take-off station to the landing's start
//   flightLines(flights, pose, W, H) -> [{ id, points: [{ x, y }] }]          pure: the dashed lines in css px of the preview, broken where they pass behind the camera
//   mount(stage, win)                -> { lines(), flights(), unmount() }     lines() is what was drawn last (for the tests)
'use strict';

const M = require('../camera/math.js');

/** The flights on a path: a 'gap' segment's own samples, with the station before and the one after so the line reaches both pieces. */
function flightsOfPath(path, segments) {
  const S = path && path.samples, out = [];
  if (!S || !S.length || !Array.isArray(segments)) return out;
  segments.forEach((g, j) => {
    if (!g || g.kind !== 'gap') return;
    let first = -1, last = -1;
    for (let i = 0; i < S.length; i++) if (S[i].seg === j) { if (first < 0) first = i; last = i; }
    if (first < 0) return;
    const a = Math.max(0, first - 1), b = Math.min(S.length - 1, last + 1);
    out.push({ id: g.id, points: S.slice(a, b + 1).map((m) => m.pos.slice()) });
  });
  return out;
}

function flightLines(flights, pose, W, H) {
  if (!flights || !flights.length || !pose || !(W > 0 && H > 0)) return [];
  const VP = M.viewProj(pose, W / H), out = [];
  const toScreen = (p) => { const c = M.apply(VP, p); return c[3] > 0 ? { x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * H } : null; };
  for (const f of flights) {
    let cur = [];
    for (const p of f.points) { const q = toScreen(p); if (q) cur.push(q); else if (cur.length) { out.push({ id: f.id, points: cur }); cur = []; } }
    if (cur.length) out.push({ id: f.id, points: cur });
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
    if (memo.samples !== samples || memo.segments !== segments) memo = { samples, segments, flights: flightsOfPath({ samples }, segments) };
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
    for (const [w, dash, colour] of [[5, [10, 7], '#0b0d11'], [2.5, [10, 7], '#7fd8ff']]) {
      ctx.lineWidth = w; ctx.setLineDash(dash); ctx.strokeStyle = colour;
      for (const l of drawn) { ctx.beginPath(); l.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); }
    }
    ctx.setLineDash([]);
  };
  raf = win.requestAnimationFrame(frame);
  return { lines: () => drawn.slice(), flights: () => shown.slice(), unmount() { win.cancelAnimationFrame(raf); canvas.remove(); } };
}

module.exports = { flightsOfPath, flightLines, mount };
