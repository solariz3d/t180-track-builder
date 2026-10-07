// griplayer.js: THE TRACK COLOURED BY GRIP (D261, the keeper: "a preview view that colours pieces by grip, with the value in the hover label"; the hover label is app/core/labels.js, which adds
// "grip 85%" to a piece's readout when its grip is not 100 or this view is on). A canvas over the preview (#preview), redrawn every animation frame like the labels and the selection
// (the camera eases, so the colours move with it), OFF until the panel's "colour by grip" box is ticked. Every road piece's centreline is drawn over the road, thick, in the colour of its
// grip: BLUE below 100% (less grip), WHITE at 100% (AC's own road), ORANGE above (more grip), the full colour at 50% and 150%. The lines are app/core/selectionlayer.js's (the same
// projection and thinning); a small key says what the colours are. The preview itself is not changed: its pose comes from 't180:view', the track from 't180:track-request'.
//
//   gripColour(g)                          -> '#rrggbb'         the colour of a grip percent (clamped to 50..150)
//   gripLines(track, doc, pose, W, H)      -> [{ id, grip, colour, points }]   pure: the road pieces' screen polylines with their grip
//   mount(stage, shell, win)               -> { lines(), setVisible(on), visible(), unmount() }
'use strict';
const SL = require('./selectionlayer.js');
const GV = require('./gripvals.js');   // D263: the core's document.js needs node's fs and the UI must load in the webview loader without it

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const LOW = [38, 120, 255], MID = [255, 255, 255], HIGH = [255, 140, 20];
function gripColour(g) {
  const x = Math.max(GV.GRIP_MIN, Math.min(GV.GRIP_MAX, Number(g))), t = Number.isFinite(x) ? (x - GV.GRIP_DEFAULT) / (x < GV.GRIP_DEFAULT ? GV.GRIP_DEFAULT - GV.GRIP_MIN : GV.GRIP_MAX - GV.GRIP_DEFAULT) : 0;
  return hex(t < 0 ? mix(MID, LOW, -t) : mix(MID, HIGH, t));
}

function gripLines(track, doc, pose, W, H) {
  if (!doc || !Array.isArray(doc.pieces)) return [];
  const roads = doc.pieces.filter((P) => P.type === 'road'), grip = new Map(roads.map((P) => [P.id, GV.gripOf(P)]));
  return SL.selectionLines(track, roads.map((P) => P.id), pose, W, H).map((l) => ({ ...l, grip: grip.get(l.id), colour: gripColour(grip.get(l.id)) }));
}

function mount(stage, shell, win) {
  const doc = stage.ownerDocument, canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-label', 'grip colours');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3';
  stage.append(canvas);
  const ask = (name) => { let got = null; doc.dispatchEvent(new win.CustomEvent(name, { detail: { reply: (x) => { got = x; } } })); return got; };
  let raf = 0, on = false, drawn = [], sized = '';
  const frame = () => {
    raf = win.requestAnimationFrame(frame);
    if (!canvas.isConnected && stage.isConnected !== false) stage.append(canvas);   // the preview's mount clears #preview after the panel mounted
    const W = stage.clientWidth, H = stage.clientHeight, view = on ? ask('t180:view') : null, track = on ? ask('t180:track-request') : null;
    drawn = view && view.pose && track ? gripLines(track, shell.getState().history.present, view.pose, W, H) : [];
    const ctx = canvas.getContext ? canvas.getContext('2d') : null; if (!ctx) return;
    const dpr = win.devicePixelRatio || 1, key = `${W}x${H}@${dpr}`;
    if (key !== sized) { canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr)); sized = key; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!on) return;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [w, pick] of [[10, () => '#0b0d11'], [6, (l) => l.colour]]) {
      ctx.lineWidth = w;
      for (const l of drawn) { ctx.strokeStyle = pick(l); ctx.beginPath(); l.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); }
    }
    // the key: blue 50% to white 100% to orange 150%
    ctx.font = 'bold 12px system-ui, "Segoe UI", sans-serif'; ctx.textBaseline = 'middle';
    const kx = 12, ky = H - 26, kw = 150; for (let i = 0; i < kw; i++) { ctx.fillStyle = gripColour(GV.GRIP_MIN + ((GV.GRIP_MAX - GV.GRIP_MIN) * i) / (kw - 1)); ctx.fillRect(kx + i, ky, 1, 8); }
    ctx.strokeStyle = '#0b0d11'; ctx.lineWidth = 1; ctx.strokeRect(kx - 0.5, ky - 0.5, kw + 1, 9);
    ctx.fillStyle = '#0b0d11'; ctx.fillRect(kx - 2, ky - 20, 168, 14); ctx.fillStyle = '#eef1f6'; ctx.fillText('grip: 50%     100%     150%', kx, ky - 13);
  };
  raf = win.requestAnimationFrame(frame);
  return { lines: () => drawn.slice(), setVisible(v) { on = !!v; }, visible: () => on, unmount() { win.cancelAnimationFrame(raf); canvas.remove(); } };
}

module.exports = { gripColour, gripLines, mount };
