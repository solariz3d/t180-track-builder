// selectionlayer.js: THE SELECTED PIECES ON THE TRACK (D240, saved pieces, the UI half; the user: "highlight/select pieces on the track"). A canvas over the preview
// (#preview), redrawn every animation frame like the labels (the camera eases, so the highlight moves with it): the selected pieces' centreline, drawn bright over the road
// with a dark outline, and a dot at each end of the run. The preview is not changed: its pose comes from the 't180:view' event and the track from 't180:track-request'
// (app/preview/index.js), exactly as app/core/labels.js reads them.
//
//   selectionLines(track, ids, pose, W, H) -> [{ id, points: [{ x, y }] }]   pure: the screen polylines (css px of the preview) of the pieces `ids`, broken where the track
//                                                                              passes behind the camera; at most ~120 points a piece
//   bandLine(track, band, pose, W, H) -> [{ x, y, w }]                          pure: D421 part 3, THE FALLOFF BAND of a Sculpt drag on screen: the stations of
//                                                                              [s0 − r, s0 + r] (round the start line on a closed lap), each with the brush's weight
//                                                                              w = smootherstep(1 − |s − s0| / r) (src/core/sculpt.js's falloff), at most ~160 points
//   endMarks(track, band, pose, W, H) -> [{ x, y, nx, ny }]                     pure: D425 part 4, THE REACH'S TWO ENDS [ ] at s0 − r and s0 + r: each a point on screen and the unit
//                                                                              vector across the road there (a tick is drawn along it); an end past an open lap's start or end has none
//   pieceSpan(track, s) -> { id, s0, r } | null                                pure: D425 part 4, Stretch's reach: the piece holding station s, as a band from its first joint to its last
//   keyed(fn) -> f(track, band, pose, W, H)                                    D425 part 4: fn again only when the track, the band, the camera or the size changed (f.runs() counts)
//   mount(stage, shell, win) -> { lines(), band(), marks(), unmount() }        lines(), band() and marks() are what was drawn last (for the tests and the window proof)
//
// D425 part 4 (P's design, exo_memory/handback/p-d425-sculpt-cues-P_2026-10-21.md §1 cue 1 and §3): THE REACH ON HOVER. In Sculpt with no drag open, the panel's 't180:sculpt-hover'
// ({ s0, r, tool } of the station under the pointer, app/core/panel.js) is drawn as the band at half its drag alpha with its two end marks; Stretch's reach is the piece under the pointer,
// drawn the selection's way in the band's colour, its joints marked. At the press the band fixes where it is and goes to full alpha, as before, and keeps its marks. The band's stations
// are found once per drag, not per frame (keyed): with the camera still and the band fixed, every frame ran the same filter over all the lap's stations (5,001 on 10 km), sort and projections
'use strict';

const M = require('../camera/math.js');
const { tokensOf } = require('../lib/tokens.js');   // D381: the skin's colours (app/lib/tokens.js)

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

const smootherstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));
function bandLine(track, band, pose, W, H) {
  if (!track || !track.path || !Array.isArray(track.path.samples) || !band || !(band.r > 0) || !Number.isFinite(band.s0) || !pose || !(W > 0 && H > 0)) return [];
  const S = track.path.samples; if (S.length < 2) return [];
  const L = S[S.length - 1].s, VP = M.viewProj(pose, W / H), closed = !!track.closed;
  const dist = (s) => { const d = s - band.s0; return closed && L > 0 ? d - L * Math.round(d / L) : d; };   // along the road, the short way round a closed lap
  const near = S.filter((m) => Math.abs(dist(m.s)) <= band.r);
  near.sort((a, b) => dist(a.s) - dist(b.s));
  const stride = Math.max(1, Math.ceil(near.length / 160)), out = [];
  near.forEach((m, i) => {
    if (i % stride && i !== near.length - 1) return;
    const c = M.apply(VP, m.pos); if (!(c[3] > 0)) return;
    out.push({ x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * H, w: smootherstep(1 - Math.abs(dist(m.s)) / band.r) });
  });
  return out;
}

function endMarks(track, band, pose, W, H) {
  if (!track || !track.path || !Array.isArray(track.path.samples) || !band || !(band.r > 0) || !Number.isFinite(band.s0) || !pose || !(W > 0 && H > 0)) return [];
  const S = track.path.samples; if (S.length < 2) return [];
  const L = S[S.length - 1].s, VP = M.viewProj(pose, W / H), closed = !!track.closed, out = [];
  const toScreen = (p) => { const c = M.apply(VP, p); return c[3] > 0 ? { x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * H } : null; };
  for (const end of [band.s0 - band.r, band.s0 + band.r]) {
    let s = end;
    if (closed && L > 0) s = ((s % L) + L) % L; else if (s < 0 || s > L) continue;
    let lo = 0, hi = S.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (S[mid].s < s) lo = mid + 1; else hi = mid; }
    const m = S[lo], pos = [m.pos[0] + m.T[0] * (s - m.s), m.pos[1] + m.T[1] * (s - m.s), m.pos[2] + m.T[2] * (s - m.s)];
    const a = toScreen(pos), b = toScreen([pos[0] + m.T[0], pos[1] + m.T[1], pos[2] + m.T[2]]); if (!a || !b) continue;
    const tx = b.x - a.x, ty = b.y - a.y, len = Math.hypot(tx, ty);
    out.push(len > 1e-6 ? { x: a.x, y: a.y, nx: -ty / len, ny: tx / len } : { x: a.x, y: a.y, nx: 0, ny: 1 });   // a road seen end-on: a plain upright tick
  }
  return out;
}

function pieceSpan(track, s) {
  if (!track || !track.path || !Array.isArray(track.path.samples) || !Array.isArray(track.segments) || !Number.isFinite(s)) return null;
  const S = track.path.samples; if (!S.length) return null;
  let lo = 0, hi = S.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (S[mid].s < s) lo = mid + 1; else hi = mid; }
  const g = track.segments[S[lo].seg]; if (!g) return null;
  let a = lo, b = lo;
  while (a > 0 && track.segments[S[a - 1].seg] && track.segments[S[a - 1].seg].id === g.id) a--;
  while (b < S.length - 1 && track.segments[S[b + 1].seg] && track.segments[S[b + 1].seg].id === g.id) b++;
  return { id: g.id, s0: (S[a].s + S[b].s) / 2, r: (S[b].s - S[a].s) / 2 };
}

function keyed(fn) {
  let last = null, got = [], runs = 0;
  const f = (track, band, pose, W, H) => {
    const k = [track, band && band.s0, band && band.r, pose ? JSON.stringify(pose) : null, W, H];
    if (last && k.every((v, i) => Object.is(v, last[i]))) return got;
    last = k; runs++; got = fn(track, band, pose, W, H); return got;
  };
  f.runs = () => runs;
  return f;
}

function mount(stage, shell, win) {
  const T = tokensOf(win);
  const doc = stage.ownerDocument, canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-label', 'selected pieces');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5';
  stage.append(canvas);
  const ask = (name) => { let got = null; doc.dispatchEvent(new win.CustomEvent(name, { detail: { reply: (x) => { got = x; } } })); return got; };
  let raf = 0, drawn = [], banded = [], marked = [], reach = [], sized = '';
  const bandOf = keyed(bandLine), marksOf = keyed(endMarks), spanOf = keyed((track, band, pose, W, H) => selectionLines(track, [band.id], pose, W, H));
  const frame = () => {
    raf = win.requestAnimationFrame(frame);
    if (!canvas.isConnected && stage.isConnected !== false) stage.append(canvas);   // the preview's mount clears #preview after the panel mounted (as the labels' layer)
    const st = shell.getState(), info = shell.selectionInfo ? shell.selectionInfo() : null, W = stage.clientWidth, H = stage.clientHeight;
    const b = st && st.sculpt && st.brush ? { s0: st.brush.s0, r: Number.isFinite(st.brush.rUsed) ? st.brush.rUsed : st.brush.r } : null;   // the band: fixed where the drag began
    const hov = st && st.sculpt && !st.brush ? ask('t180:sculpt-hover') : null;   // D425 part 4: no drag open: the reach where the pointer is (the panel answers null off the road)
    const view = info || b || hov ? ask('t180:view') : null, track = info || b || hov ? ask('t180:track-request') : null, pose = view && view.pose;
    drawn = info && pose && track ? selectionLines(track, info.ids, pose, W, H) : [];
    const span = hov && hov.tool === 'stretch' && track ? pieceSpan(track, hov.s0) : null;   // Stretch moves a piece, not a radius: its reach is the piece
    const band = b || (span ? { id: span.id, s0: span.s0, r: span.r } : hov && hov.r > 0 && Number.isFinite(hov.s0) ? { s0: hov.s0, r: hov.r } : null);
    banded = band && !span && pose && track ? bandOf(track, band, pose, W, H) : [];
    reach = span && pose && track ? spanOf(track, band, pose, W, H) : [];
    marked = band && pose && track ? marksOf(track, band, pose, W, H) : [];
    const BAND = T.css('--sculpt-band', '#4dd2ff'), A = b ? 0.55 : 0.28;   // the reach's cyan (design section 6; violet was the other choice); on hover at half the drag's alpha
    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return;
    const dpr = win.devicePixelRatio || 1, key = `${W}x${H}@${dpr}`;
    if (key !== sized) { canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr)); sized = key; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    // the band under the selection: a wide tint on the road, full at the brush's centre and fading to nothing at its edge
    if (banded.length > 1) {
      ctx.lineCap = 'round'; ctx.lineWidth = 14; ctx.strokeStyle = BAND;
      for (let i = 1; i < banded.length; i++) { const p = banded[i - 1], q = banded[i]; ctx.globalAlpha = A * (p.w + q.w) / 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    if (reach.length) {   // Stretch: the piece's centreline in the band's colour
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = BAND; ctx.globalAlpha = 0.8;
      for (const l of reach) { ctx.beginPath(); l.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    if (marked.length) {   // the reach's two ends [ ]: a short tick across the road, outlined, so the edge is a line and not a fade
      ctx.lineCap = 'butt';
      for (const [w, colour] of [[6, T.css('--ink', '#0b0d11')], [3, BAND]]) {
        ctx.lineWidth = w; ctx.strokeStyle = colour; ctx.beginPath();
        for (const m of marked) { ctx.moveTo(m.x - m.nx * 12, m.y - m.ny * 12); ctx.lineTo(m.x + m.nx * 12, m.y + m.ny * 12); }
        ctx.stroke();
      }
    }
    if (!drawn.length) return;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [w, colour] of [[9, T.css('--ink', '#0b0d11')], [4.5, '#ffb020']]) {
      ctx.lineWidth = w; ctx.strokeStyle = colour;
      for (const l of drawn) { ctx.beginPath(); l.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); }
    }
    ctx.fillStyle = '#ffb020'; ctx.strokeStyle = T.css('--ink', '#0b0d11'); ctx.lineWidth = 2;
    const first = drawn[0].points[0], lastLine = drawn[drawn.length - 1], last = lastLine.points[lastLine.points.length - 1];
    for (const p of [first, last]) { ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  };
  raf = win.requestAnimationFrame(frame);
  return { lines: () => drawn.slice(), band: () => banded.slice(), marks: () => marked.slice(), reach: () => reach.slice(), bandRuns: () => bandOf.runs(), unmount() { win.cancelAnimationFrame(raf); canvas.remove(); } };
}

module.exports = { selectionLines, bandLine, endMarks, pieceSpan, keyed, mount };
