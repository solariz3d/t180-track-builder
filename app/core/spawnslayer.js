// spawnslayer.js: THE HAND-PLACED START ON THE PREVIEW (the keeper, 2026-10-09: the start line moved along the first piece, a numbered grid, a hotlap spawn put
// down by hand). A canvas over the preview (#preview), redrawn every animation frame like app/core/griplayer.js (the camera eases, so the marks move with it):
//   · the START LINE across the road, white, between the gate markers AC_TIME_0_L and _R
//   · every GRID SLOT as a car-sized box on the road (the measured T-180, src/markers/layout.js T180: 6.67 m x 2.67 m), numbered from pole: 1, 2, 3 …
//   · the PIT boxes (automatic until the pit module) in grey, and the HOTLAP spawn in orange with the speed it reaches by the line
//   · a red box for any slot the checks put off the road or overlapping, with the checks' words in the panel (app/core/spawnsui.js)
// The marks come from the shell's spawnsInfo (the same placement the export writes), computed only when the track or its spawns change, not every frame.
// Shown only when the track has spawns (a track with the automatic start draws nothing here).
//
//   slotCorners(m, halfL, halfW)            -> [p0, p1, p2, p3]     pure: a marker's car box on the road, world space
//   marks(info)                             -> [{ kind, label, corners | line, bad }]   pure: what to draw for a spawnsInfo
//   mount(stage, shell, win)                -> { drawn(), unmount() }
'use strict';
const M = require('../camera/math.js');
const { T180 } = require('../../src/markers/layout.js');

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const HALF_L = T180.lengthM / 2, HALF_W = T180.widthM / 2;

function slotCorners(m, halfL = HALF_L, halfW = HALF_W) {
  const c = m.surface || m.pos, f = mul(m.fwd, halfL), l = mul(m.left, halfW);
  return [add(add(c, f), l), add(add(c, f), mul(l, -1)), add(add(c, mul(f, -1)), mul(l, -1)), add(add(c, mul(f, -1)), l)];
}

function marks(info) {
  if (!info || !Array.isArray(info.placed)) return [];
  const bad = new Set();
  for (const c of (info.check && info.check.checks) || []) for (const p of c.problems || []) for (const m of p.match(/AC_[A-Z_]+_\d+(?:_[LR])?/g) || []) bad.add(m);
  const out = [], by = (n) => info.placed.find((m) => m.name === n && m.pos);
  const L = by('AC_TIME_0_L'), R = by('AC_TIME_0_R');
  if (L && R) out.push({ kind: 'line', label: 'START', line: [L.surface || L.pos, R.surface || R.pos], bad: bad.has('AC_TIME_0_L') || bad.has('AC_TIME_0_R') });
  for (const m of info.placed) {
    if (!m.pos) continue;
    const g = /^AC_START_(\d+)$/.exec(m.name), p = /^AC_PIT_(\d+)$/.exec(m.name);
    if (g) out.push({ kind: 'grid', label: String(Number(g[1]) + 1), corners: slotCorners(m), bad: bad.has(m.name) });
    else if (p) out.push({ kind: 'pit', label: `PIT ${Number(p[1]) + 1}`, corners: slotCorners(m), bad: bad.has(m.name) });
    else if (m.name === 'AC_HOTLAP_START_0') {
      out.push({ kind: 'hotlap', label: `HOTLAP${m.speedKmh != null ? ` · ${m.speedKmh} km/h at the line` : ''}`, corners: slotCorners(m), bad: bad.has(m.name) });
    }
  }
  return out;
}

const COLOUR = { line: '#ffffff', grid: '#5fd3ff', pit: '#a8b0bd', hotlap: '#ff9a2e', bad: '#ff4d4d' };

function mount(stage, shell, win) {
  const doc = stage.ownerDocument, canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-label', 'start and grid');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3';
  stage.append(canvas);
  const ask = (name) => { let got = null; doc.dispatchEvent(new win.CustomEvent(name, { detail: { reply: (x) => { got = x; } } })); return got; };
  let raf = 0, sized = '', drawn = [], items = [], forDoc = null, forResolved = null;
  const refresh = (st) => {
    if (st.history.present === forDoc && st.resolved === forResolved) return;
    forDoc = st.history.present; forResolved = st.resolved;
    items = marks(st.history.present.spawns ? shell.spawnsInfo() : null);
  };
  const unsub = shell.subscribe(refresh); refresh(shell.getState());
  const frame = () => {
    raf = win.requestAnimationFrame(frame);
    if (!canvas.isConnected && stage.isConnected !== false) stage.append(canvas);   // the preview's mount clears #preview after the panel mounted
    const W = stage.clientWidth, H = stage.clientHeight, ctx = canvas.getContext ? canvas.getContext('2d') : null; if (!ctx) return;
    const dpr = win.devicePixelRatio || 1, key = `${W}x${H}@${dpr}`;
    if (key !== sized) { canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr)); sized = key; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); drawn = [];
    if (!items.length) return;
    const view = ask('t180:view'); if (!view || !view.pose || !(W > 0 && H > 0)) return;
    const VP = M.viewProj(view.pose, W / H);
    const scr = (p) => { const c = M.apply(VP, p); return c[3] > 0 ? { x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * H } : null; };
    ctx.font = 'bold 12px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const it of items) {
      const pts = (it.line || it.corners).map(scr); if (pts.some((p) => !p)) continue;
      const col = it.bad ? COLOUR.bad : COLOUR[it.kind];
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (it.corners) ctx.closePath();
      ctx.lineWidth = it.kind === 'line' ? 6 : 4; ctx.strokeStyle = '#0b0d11'; ctx.stroke();
      ctx.lineWidth = it.kind === 'line' ? 3 : 2; ctx.strokeStyle = col; ctx.stroke();
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const tw = ctx.measureText(it.label).width + 8;
      ctx.fillStyle = '#0b0d11'; ctx.fillRect(cx - tw / 2, cy - 8, tw, 16); ctx.fillStyle = col; ctx.fillText(it.label, cx, cy + 0.5);
      drawn.push({ kind: it.kind, label: it.label, bad: it.bad, points: pts });
    }
  };
  raf = win.requestAnimationFrame(frame);
  return { drawn: () => drawn.slice(), items: () => items.slice(), unmount() { unsub(); win.cancelAnimationFrame(raf); canvas.remove(); } };
}

module.exports = { slotCorners, marks, mount };
