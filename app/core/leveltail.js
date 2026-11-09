// leveltail.js: THE LEVELLED END'S SPAN ON THE PREVIEW (the user, 2026-11-09: "the level shouldnt level the whole turn, just the ending of the piece"). After Build ▸ Level
// end of <piece>, only a TAIL at the piece's end was reshaped (src/core/level.js levelEnd); this draws that tail on the track and lets its start be dragged earlier or later,
// the way an extra change's start is: a canvas over the preview (#preview), redrawn every animation frame like app/core/spawnslayer.js, and a press on the start mark grabs it.
//   · the SPAN: a band along the road from the tail's start to the piece's end
//   · the START MARK: a line across the road at the tail's start, labelled with the tail's length; dragging it along the piece re-levels the end over the new tail
//     (the shell's beginLevelTailDrag / levelTailDragTo / endLevelTailDrag: ONE undo step for the whole drag; a tail too short is refused with the length that works,
//     as the panel's message, and the track stays at the last tail that worked)
// Drawn only while the track is the one the level made (shell.levelTailInfo); any other edit or an undo takes it away.
//
//   tailAt(info, s)                     -> m      pure: the tail from path distance s to the piece's end, clamped to [MIN_TAIL_M, the piece]
//   markOf(info)                        -> { line: [a, b], band: [p…], label }   pure: the start mark across the road and the span along it, world space
//   mount(stage, win, shell, host)      -> { drawn(), dragging(), late(), unmount() }   host.pose(): the preview camera's pose; host.yieldTo(x, y): a handle there is the handle's
'use strict';
const M = require('../camera/math.js');
const SPD = require('./spawndrag.js');   // pickStation: the road's distance under the pointer
const { tokensOf } = require('../lib/tokens.js');

const MIN_TAIL_M = 1;     // the least a drag asks for (the core refuses what holds no free point, with the length that works)
const MARK_PX = 9;        // a press this close to the start mark grabs it
const COLOUR = '#ff9a2e';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function tailAt(info, s) { return Math.round(clamp(info.s1 - s, MIN_TAIL_M, info.s1 - info.s0)); }

/** The path's frame at distance s, between its two nearest stations. */
function frameAt(path, s) {
  const S = path.samples; let k = 1; while (k < S.length - 1 && S[k].s < s) k++;
  const a = S[k - 1], b = S[k], t = b.s > a.s ? clamp((s - a.s) / (b.s - a.s), 0, 1) : 0, mix = (u, v) => u.map((x, i) => x + (v[i] - x) * t);
  return { pos: mix(a.pos, b.pos), L: a.L, T: a.T };
}
function markOf(info) {
  const f = frameAt(info.path, info.from), h = info.halfW || 8, side = f.L.map((x) => x * h);
  // across the road: the left vector made square to the road's direction (it already is on the path; kept exact here)
  const dot = side.reduce((a, x, k) => a + x * f.T[k], 0), across = side.map((x, k) => x - dot * f.T[k]);
  const band = info.path.samples.filter((m) => m.s >= info.from - 1e-9 && m.s <= info.s1 + 1e-9).map((m) => m.pos);
  return { line: [f.pos.map((x, k) => x + across[k]), f.pos.map((x, k) => x - across[k])], band: [f.pos, ...band], label: `LEVEL END · ${Math.round(info.tailM)} m · drag earlier or later` };
}

function mount(stage, win, shell, host) {
  const T = tokensOf(win), doc = stage.ownerDocument, canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-label', 'level end span');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3';
  stage.append(canvas);
  let raf = 0, sized = '', drawn = null, drag = null, waiting = null, frameReq = 0, hovering = false;
  const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const view = () => { const pose = host.pose(), W = stage.clientWidth, H = stage.clientHeight; return pose && W > 0 && H > 0 ? { VP: M.viewProj(pose, W / H), W, H } : null; };
  const scr = (v, p) => { const c = M.apply(v.VP, p); return c[3] > 0 ? { x: (c[0] / c[3] * 0.5 + 0.5) * v.W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * v.H } : null; };
  const near = (a, b, x, y) => { const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy, t = L2 > 0 ? clamp(((x - a.x) * dx + (y - a.y) * dy) / L2, 0, 1) : 0; return Math.hypot(a.x + dx * t - x, a.y + dy * t - y); };
  const onMark = (x, y) => { const info = shell.levelTailInfo(), v = info && view(); if (!v) return null; const [a, b] = markOf(info).line.map((p) => scr(v, p)); return a && b && near(a, b, x, y) <= MARK_PX ? info : null; };

  const frame = () => {
    raf = win.requestAnimationFrame(frame);
    if (!canvas.isConnected && stage.isConnected !== false) stage.append(canvas);   // the preview's mount clears #preview after the panel mounted
    const W = stage.clientWidth, H = stage.clientHeight, ctx = canvas.getContext ? canvas.getContext('2d') : null; if (!ctx) return;
    const dpr = win.devicePixelRatio || 1, key = `${W}x${H}@${dpr}`;
    if (key !== sized) { canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr)); sized = key; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); drawn = null;
    const info = shell.levelTailInfo(), v = info && view(); if (!v) return;
    const m = markOf(info), band = m.band.map((p) => scr(v, p)).filter(Boolean), line = m.line.map((p) => scr(v, p));
    if (band.length > 1) {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.globalAlpha = 0.55; ctx.strokeStyle = COLOUR; ctx.lineWidth = 8;
      ctx.beginPath(); band.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (line.every(Boolean)) {
      ctx.beginPath(); ctx.moveTo(line[0].x, line[0].y); ctx.lineTo(line[1].x, line[1].y);
      ctx.lineWidth = 7; ctx.strokeStyle = T.css('--ink', '#0b0d11'); ctx.stroke(); ctx.lineWidth = 4; ctx.strokeStyle = COLOUR; ctx.stroke();
      ctx.font = 'bold 12px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const cx = (line[0].x + line[1].x) / 2, cy = Math.min(line[0].y, line[1].y) - 14, tw = ctx.measureText(m.label).width + 10;
      ctx.fillStyle = T.css('--ink', '#0b0d11'); ctx.fillRect(cx - tw / 2, cy - 9, tw, 18); ctx.fillStyle = COLOUR; ctx.fillText(m.label, cx, cy + 0.5);
    }
    drawn = { band, line, label: m.label };
  };
  raf = win.requestAnimationFrame(frame);

  const apply = () => {
    if (!drag || !waiting) return; const w = waiting; waiting = null;
    const v = view(); if (!v) return;
    const pick = SPD.pickStation(drag.info.path, v.VP, v.W, v.H, w.x, w.y, { lo: drag.info.s0, hi: drag.info.s1 }); if (!pick) return;
    const tail = tailAt(drag.info, pick.s); if (tail !== drag.last) { drag.last = tail; shell.levelTailDragTo(tail); }
  };
  const flush = () => { frameReq = 0; apply(); };
  const onDown = (e) => {
    if (e.button !== 0 || drag) return;
    const [x, y] = rel(e); if (host.yieldTo && host.yieldTo(x, y)) return;
    const info = onMark(x, y); if (!info) return;
    e.preventDefault(); e.stopImmediatePropagation();   // the mark wins over the camera and the piece picking, only where the pointer is ON it
    shell.beginLevelTailDrag(); if (!shell.getState().levelTailDrag) return;   // refused: the message says why
    drag = { info, last: info.tailM }; stage.style.cursor = 'grabbing';
    if (stage.setPointerCapture && e.pointerId !== undefined) { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone */ } }
  };
  const onMove = (e) => {
    const [x, y] = rel(e);
    if (drag) { waiting = { x, y }; if (!frameReq) frameReq = win.requestAnimationFrame(flush); return; }
    const over = !(host.yieldTo && host.yieldTo(x, y)) && !!onMark(x, y);
    if (over) { stage.style.cursor = 'grab'; hovering = true; } else if (hovering) { stage.style.cursor = ''; hovering = false; }
  };
  const onUp = (e) => {
    if (!drag) return;
    if (frameReq) { win.cancelAnimationFrame(frameReq); frameReq = 0; }
    if (e && e.clientX !== undefined) { const [x, y] = rel(e); waiting = { x, y }; }
    apply(); drag = null; hovering = false; stage.style.cursor = ''; shell.endLevelTailDrag();
  };
  const onKeyDown = (e) => { if (drag && e && e.key === 'Escape') onUp(null); };
  stage.addEventListener('pointerdown', onDown, true); stage.addEventListener('pointerup', onUp); stage.addEventListener('pointercancel', onUp);
  if (doc && doc.addEventListener) doc.addEventListener('keydown', onKeyDown);
  let late = false;   // the move listener goes after the handles' own (they set the cursor on every move)
  return {
    drawn: () => drawn,
    dragging: () => !!drag,
    late() { if (!late) { late = true; stage.addEventListener('pointermove', onMove); } },
    unmount() {
      win.cancelAnimationFrame(raf); if (frameReq) win.cancelAnimationFrame(frameReq);
      stage.removeEventListener('pointerdown', onDown, true); stage.removeEventListener('pointermove', onMove); stage.removeEventListener('pointerup', onUp); stage.removeEventListener('pointercancel', onUp);
      if (doc && doc.removeEventListener) doc.removeEventListener('keydown', onKeyDown);
      if (drag) { drag = null; shell.endLevelTailDrag(); }
      stage.style.cursor = ''; canvas.remove();
    },
  };
}

module.exports = { MIN_TAIL_M, tailAt, markOf, mount };
