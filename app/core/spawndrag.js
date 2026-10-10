// spawndrag.js: DRAG THE START ON THE PREVIEW (D285; the keeper, 06:11: "i want to be able to just click the hotlap spawn and move it by mouse … Also click dragging the start line and
// then the pack of cars at the start line too, so i can click and move both intuitively"). The marks are the ones app/core/spawnslayer.js draws; a press ON one grabs it:
//   · the START LINE slides along the FIRST piece (spawns.line.along, clamped to it), following the road under the cursor
//   · a GRID SLOT moves the whole pack toward or away from the line: the gap from the line to the pole slot (spawns.grid.poleBackM). The two staggered columns and the panel's
//     spacing are kept; moving the line carries the pack because every slot is measured back from the line
//   · the HOTLAP spawn goes anywhere on a road piece: the piece and the distance under the cursor (spawns.hotlap.piece / along)
// The first drag on an AUTOMATIC track writes the spawns the automatic layout comes to first ("start placed by hand", the same as ticking the panel's box), inside the same undo step.
// ONE DRAG = ONE UNDO STEP (shell.beginSpawnsDrag / spawnsDragTo / endSpawnsDrag, the landing drag's pattern). NO POINTER LOCK (D270): the press takes setPointerCapture, the cursor stays.
// The press is taken in the capture phase like the handles' and stops the camera and the piece picking, only where the pointer is ON a mark. The pit boxes are not draggable here.
//
// Pure and tested (app/test/core-spawndrag.test.js):
//   pickStation(path, VP, W, H, x, y, { lo, hi, inside })  -> { s, px } | null    the path distance of the point of the road nearest the pointer on screen, continuous (it projects onto the
//                                                                                   segment between two stations), within [lo, hi] and (when given) where inside(s) holds
//   hitMarks(items, VP, W, H, x, y)                        -> { kind, n, label } | null   the mark under the pointer (hotlap, then grid slot, then the line when two are as near)
//   moveLine / movePack / moveHotlap                        the new spawns block for a pointer at path distance sPtr, given where the grab began
//   mount(stage, win, shell, host)                          the pointer wiring; host.pose() is the preview camera's pose
'use strict';
const M = require('../camera/math.js');
const SPL = require('./spawnslayer.js');
const { T180 } = require('../../src/markers/layout.js');

const LINE_PX = 9;          // the white line is 3 px wide: a press this close to it grabs it
const SLOT_PX = 4;          // a box is grabbed anywhere inside it, and this far outside
const POLE_MIN_M = Math.ceil((T180.lengthM / 2 + 1) * 10) / 10;   // the pole slot's nose stays a metre behind the line (on the 0.1 m step the drag moves in)
const POLE_MAX_M = 200;     // src/core/document.js SPAWN_GAP_MAX
const PRIORITY = { hotlap: 0, grid: 1, line: 2 };

const r1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const scr = (VP, W, H, p) => { const c = M.apply(VP, p); return c[3] > 0 ? { x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * H } : null; };

/** The pointer's distance to the segment a-b, and how far along it (0..1) the nearest point is. */
function toSegment(a, b, x, y) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy, t = L2 > 0 ? clamp(((x - a.x) * dx + (y - a.y) * dy) / L2, 0, 1) : 0;
  return { t, d: Math.hypot(a.x + dx * t - x, a.y + dy * t - y) };
}
/** The pointer's distance to a convex quad's outline, 0 inside it. */
function toQuad(pts, x, y) {
  let inside = true, best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) inside = false;
    best = Math.min(best, toSegment(a, b, x, y).d);
  }
  if (inside) return 0;
  // a quad wound the other way round: inside is every cross product <= 0
  let other = true; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) > 0) other = false; }
  return other ? 0 : best;
}

/**
 * The path distance of the point of the road nearest the pointer (x, y) in css px, for a view W x H under the matrices VP. The road is the path's stations joined by straight
 * pieces, so the answer is continuous (a metre of the pointer on the road is about a metre of s), not stepped to the 2 m stations. `lo`/`hi` limit it to a stretch of the path
 * (the first piece, for the line); `inside(s)` limits it to where it holds (road pieces, for the hotlap). null when no station of that stretch is in front of the camera.
 * `lift` { l, u }: the grabbed mark is not on the path's own line but this far to its left and up (a cupped road's surface, a slot beside the centre): the stations are taken there,
 * so a metre of the hand's travel along the road stays a metre of s at any height.
 */
function pickStation(path, VP, W, H, x, y, { lo = -Infinity, hi = Infinity, inside = null, lift = null } = {}) {
  const S = path.samples; let best = null, prev = null;
  for (let i = 0; i < S.length; i++) {
    const m = S[i];
    if (m.s < lo - 2 * 2 || m.s > hi + 2 * 2) { prev = null; continue; }
    const p = scr(VP, W, H, lift ? m.pos.map((v, k) => v + m.L[k] * lift.l + m.U[k] * lift.u) : m.pos);
    if (p && prev) {
      const q = toSegment(prev.p, p, x, y), s = clamp(prev.s + q.t * (m.s - prev.s), lo, hi);
      if ((!inside || inside(s)) && (!best || q.d < best.px)) best = { s, px: q.d };
    }
    prev = p ? { p, s: m.s } : null;
  }
  return best;
}

/** Where world point `p`, at path distance s, sits in the path's own frame there: { l, u } metres to its left and up (see pickStation's `lift`). */
function liftOf(path, s, p) {
  const m = path.samples.reduce((a, b) => (Math.abs(b.s - s) < Math.abs(a.s - s) ? b : a)), d = p.map((v, k) => v - m.pos[k]);
  return { l: d[0] * m.L[0] + d[1] * m.L[1] + d[2] * m.L[2], u: d[0] * m.U[0] + d[1] * m.U[1] + d[2] * m.U[2] };
}

/** The mark under the pointer: { kind: 'hotlap' | 'grid' | 'line', n (the grid slot, 0 from pole), label } or null. `items` is spawnslayer.marks(). */
function hitMarks(items, VP, W, H, x, y) {
  let best = null;
  for (const it of items) {
    if (it.kind !== 'line' && it.kind !== 'grid' && it.kind !== 'hotlap') continue;
    const pts = (it.line || it.corners).map((p) => scr(VP, W, H, p)); if (pts.some((p) => !p)) continue;
    const d = it.line ? toSegment(pts[0], pts[1], x, y).d : toQuad(pts, x, y), reach = it.line ? LINE_PX : SLOT_PX;
    if (d > reach) continue;
    const c = { kind: it.kind, n: it.kind === 'grid' ? Number(it.label) - 1 : 0, label: it.label, d };
    if (!best || c.d < best.d - 1e-9 || (Math.abs(c.d - best.d) <= 1e-9 && PRIORITY[c.kind] < PRIORITY[best.kind])) best = c;
  }
  return best ? { kind: best.kind, n: best.n, label: best.label } : null;
}

/** The pointer's distance BACK from the line along the path (positive behind it); on a closed lap the shorter way round. */
function backOf(sLine, sPtr, lengthM, closed) {
  let b = sLine - sPtr;
  if (closed && lengthM > 0) { b = ((b % lengthM) + lengthM) % lengthM; if (b > lengthM / 2) b -= lengthM; }
  return b;
}

/** The spawns block with the line `dS` metres from where it was grabbed, clamped to the first piece (a 0.1 m step). */
function moveLine(sp, grab, sPtr, firstLen) { return { ...sp, line: { along: r1(clamp(grab.along + (sPtr - grab.s), 0, firstLen)) } }; }
/** The spawns block with the pack moved so the grabbed slot stays under the pointer: only the gap from the line to the pole slot changes. */
function movePack(sp, grab, sPtr, sLine, lengthM, closed) {
  const pole = grab.pole + (backOf(sLine, sPtr, lengthM, closed) - grab.back);
  return { ...sp, grid: { ...sp.grid, poleBackM: r1(clamp(pole, POLE_MIN_M, POLE_MAX_M)) } };
}
/** The road piece and the distance into it for path distance s: the road spans are [{ id, s0, s1 }]; outside every span, the nearest one's end. Null with no road. */
function roadAt(roads, s) {
  let best = null;
  for (const r of roads) { const d = s < r.s0 ? r.s0 - s : s > r.s1 ? s - r.s1 : 0; if (!best || d < best.d) best = { r, d }; }
  return best ? { piece: best.r.id, along: r1(clamp(s - best.r.s0, 0, best.r.s1 - best.r.s0)) } : null;
}
/** The spawns block with the hotlap at the piece and distance under the pointer (a grab offset kept). */
function moveHotlap(sp, grab, sPtr, roads) { const at = roadAt(roads, sPtr + grab.delta); return at ? { ...sp, hotlap: at } : sp; }

function mount(stage, win, shell, host) {
  const doc = stage.ownerDocument;
  let drag = null, waiting = null, frameReq = 0, hovering = false, cache = { key: null, info: null }, pathCache = { key: null, P: null };
  const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const state = () => shell.getState();
  const infoNow = () => {   // computed only when the track or its spawns change, not on every pointer move
    const st = state(), key = [st.history.present, st.resolved];
    if (!cache.key || cache.key[0] !== key[0] || cache.key[1] !== key[1]) cache = { key, info: shell.spawnsInfo({ auto: true }) };
    return cache.info;
  };
  const pathNow = () => {   // the road does not move when the spawns do: keyed on the resolved track alone
    const st = state();
    if (!pathCache.key || pathCache.key !== st.resolved || st.history.present.pieces !== pathCache.pieces) pathCache = { key: st.resolved, pieces: st.history.present.pieces, P: shell.spawnsPath() };
    return pathCache.P;
  };
  const view = () => {
    const pose = host.pose(), W = stage.clientWidth, H = stage.clientHeight;
    return pose && W > 0 && H > 0 ? { VP: M.viewProj(pose, W / H), W, H } : null;
  };
  const hitAt = (x, y) => {
    const v = view(), info = v && infoNow(); if (!v || !info) return null;
    return hitMarks(SPL.marks(info), v.VP, v.W, v.H, x, y);
  };
  const markerS = (info, name) => { const m = info.placed && info.placed.find((q) => q.name === name); return m && Number.isFinite(m.s) ? m.s : null; };

  const apply = () => {
    if (!drag || !waiting) return; const w = waiting; waiting = null;
    const v = view(); if (!v) return;
    const P = drag.P, pick = pickStation(P.path, v.VP, v.W, v.H, w.x, w.y, drag.range); if (!pick) return;
    let sp;
    if (drag.kind === 'line') sp = moveLine(drag.sp, drag.grab, pick.s, P.first.len);
    else if (drag.kind === 'grid') sp = movePack(drag.sp, drag.grab, pick.s, drag.sLine, P.path.lengthM, !!state().history.present.closed);
    else sp = moveHotlap(drag.sp, drag.grab, pick.s, P.roads);
    shell.spawnsDragTo(sp);
  };
  const flush = () => { frameReq = 0; apply(); };
  const onDown = (e) => {
    if (e.button !== 0 || drag) return;
    const [x, y] = rel(e), hit = hitAt(x, y); if (!hit) return;
    const info = infoNow(), v = view(), P = pathNow(); if (!info || !v || !P || P.error) { if (P && P.error) { e.preventDefault(); e.stopImmediatePropagation(); shell.beginSpawnsDrag(); } return; }
    const first = P.first, sLine = markerS(info, 'AC_TIME_0_L'); if (sLine === null) return;
    // what the grab is relative to: the pointer's place on the road, so the mark does not jump to the pointer
    const pt = (m) => m.surface || m.pos, named = hit.kind === 'grid' ? info.placed.find((m) => m.name === `AC_START_${hit.n}`) : hit.kind === 'hotlap' ? info.placed.find((m) => m.name === 'AC_HOTLAP_START_0') : null;
    const objPoint = hit.kind === 'line' ? (() => { const a = info.placed.find((m) => m.name === 'AC_TIME_0_L'), b = info.placed.find((m) => m.name === 'AC_TIME_0_R'); return a && b ? pt(a).map((q, k) => (q + pt(b)[k]) / 2) : null; })() : named && pt(named);
    const lift = objPoint ? liftOf(P.path, hit.kind === 'line' ? sLine : named.s, objPoint) : null;
    const range = hit.kind === 'line' ? { lo: first.s0, hi: first.s0 + first.len, lift } : hit.kind === 'hotlap' ? { inside: (s) => P.roads.some((r) => s >= r.s0 && s <= r.s1), lift } : { lift };
    const pick = pickStation(P.path, v.VP, v.W, v.H, x, y, range); if (!pick) return;
    e.preventDefault(); e.stopImmediatePropagation();   // a mark wins over the camera and the piece picking, only where the pointer is ON one
    shell.beginSpawnsDrag(); if (!state().spawnsDrag) return;   // refused (the message says why): nothing was grabbed
    const sp = state().history.present.spawns, grab = {};
    if (hit.kind === 'line') Object.assign(grab, { along: sp.line.along, s: pick.s });
    else if (hit.kind === 'grid') Object.assign(grab, { pole: sp.grid.poleBackM !== undefined ? sp.grid.poleBackM : info.layout.grid.poleBackM, back: backOf(sLine, pick.s, P.path.lengthM, !!state().history.present.closed) });
    else { const sH = markerS(info, 'AC_HOTLAP_START_0'); Object.assign(grab, { delta: sH === null ? 0 : sH - pick.s }); }
    drag = { kind: hit.kind, n: hit.n, sp, P, range, grab, sLine, x0: x, y0: y };
    stage.style.cursor = 'grabbing';
    if (stage.setPointerCapture && e.pointerId !== undefined) { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone */ } }
  };
  const onMove = (e) => {
    const [x, y] = rel(e);
    if (drag) { waiting = { x, y }; if (!frameReq) frameReq = win.requestAnimationFrame(flush); return; }
    const h = hitAt(x, y);
    if (h) { stage.style.cursor = 'grab'; hovering = true; } else if (hovering) { stage.style.cursor = ''; hovering = false; }
  };
  const onUp = (e) => {
    if (!drag) return;
    if (frameReq) { win.cancelAnimationFrame(frameReq); frameReq = 0; }
    if (e && e.clientX !== undefined) { const [x, y] = rel(e); waiting = { x, y }; }
    apply(); drag = null; hovering = false; stage.style.cursor = ''; shell.endSpawnsDrag();
  };
  const onKeyDown = (e) => { if (drag && e && e.key === 'Escape') onUp(null); };
  stage.addEventListener('pointerdown', onDown, true); stage.addEventListener('pointermove', onMove); stage.addEventListener('pointerup', onUp); stage.addEventListener('pointercancel', onUp);
  if (doc && doc.addEventListener) doc.addEventListener('keydown', onKeyDown);
  return {
    dragging: () => !!drag,
    unmount() {
      if (frameReq) win.cancelAnimationFrame(frameReq);
      stage.removeEventListener('pointerdown', onDown, true); stage.removeEventListener('pointermove', onMove); stage.removeEventListener('pointerup', onUp); stage.removeEventListener('pointercancel', onUp);
      if (doc && doc.removeEventListener) doc.removeEventListener('keydown', onKeyDown);
      if (drag) { drag = null; shell.endSpawnsDrag(); }
      stage.style.cursor = '';
    },
  };
}

module.exports = { POLE_MIN_M, POLE_MAX_M, pickStation, liftOf, hitMarks, backOf, moveLine, movePack, moveHotlap, roadAt, mount };
