// secondtick.js: THE LATER CHANGES ON THE GHOST (L135 the bank's tick; L139 every field, any number). Two things are drawn on the next-piece ghost and dragged there:
//   MARKS: one per change a field already has (the panel's rows), where that change starts: short strokes across the road in the field's handle colour
//          (app/core/handles.js KINDS), at the field's own place across it, read the way the user's red marks read (2026-11-05: "look where red marks are"): bank on
//          both edges, climb at the centre, cup at ±0.3 of the half width, turn just outside the edge and width just inside it (the three share the edge, lat 1, so
//          they are nudged apart in screen pixels), the left and right edge at ±0.65 on their own side. A mark is dragged ALONG the piece: it moves that change's from.
//   OFFERS: (the user, 06:53Z: "more and more room keeps getting made inbetween, giving room for the next drag icon to show itself") one fainter handle per field,
//          where the panel says the next change has room (panel.js offersAt). Dragged like that field's handle (handles.js screenAxis, dragPixels, targetFor, the same
//          maths), it makes that field's next change; a press with no movement makes nothing.
// A canvas over the preview (#preview), redrawn every animation frame like the flights (app/core/flightlayer.js). The preview is not changed: the pose comes from
// 't180:view' and the ghost from 't180:ghost-request' ({ samples, segments, jump, s0 }). A press on a mark or an offer is taken in the capture phase, so the handles
// and picking beneath never see it; any other press goes on to them.
//
//   styleOf(field)                          -> { colour, lat, sides, nudgePx, kind }   the field's look: its handle kind's colour and place
//   stationAt(ghost, from)                  -> sample | null                           the ghost's station nearest s0 + from (null off the piece or on a jump's ghost)
//   markStroke(ghost, mark, pose, W, H)     -> { field, index, s, strokes: [{ a, b }] } | null   pure: the mark's strokes in css px
//   tickAt(ghost, at)                       -> { s, a, b } | null                      (L135) the station and the points ±at.half across it
//   markText(field, index, from, to, L)     -> 'Extra bank · 500.00 m → end · rolls over 500.00 m · drag to start earlier or later' | ''
//   stretchStrip(ghost, mark)               -> [{ s, a, b }] | null                     the road across, from the mark's from to its to (half → halfTo)
// (the user, 2026-11-07 11:37Z: "when you move the mouse right and left when clicking the point i marked, it drags the other point up and down the track,
// defintelly needs labels"): a mark whose item carries a label (the panel's
// marksAt gives one to every extra change, the fields with an extra handle) is drawn with the stretch it changes tinted in its colour, small arrows along the road on the tick,
// and its label beside it. item.lit (its extra handle hovered or dragged) draws all three brighter, so the handle and the tick it moves are seen as one.
//   mount(stage, win, itemsNow, hooks)      -> { drawNow(), marks(), offers(), unmount() }
//       itemsNow() -> { marks: [...], offers: [...] }; hooks: onMarkDrag(mark, from), onOfferDrag(offer, value), onDragStart(item), onDragEnd(item, moved)
'use strict';

const M = require('../camera/math.js');
const HD = require('./handles.js');
const { tokensOf } = require('../lib/tokens.js');

const EDGE_COLOUR = '#3fd0c9';   // the left and right edge have no handle kind in handles.js, so no colour of their own there: this one is the panel's (L139)
const STROKE_PX = 7, NUDGE_PX = 10, HIT_PX = 10;
const STYLE = Object.freeze({
  turn: { kind: 'turn', lat: HD.KINDS.turn.lat, sides: [1, -1], nudgePx: NUDGE_PX },
  bank: { kind: 'bank', lat: HD.KINDS.bank.lat, sides: [1, -1], nudgePx: 0 },
  width: { kind: 'width', lat: HD.KINDS.width.lat, sides: [1, -1], nudgePx: -NUDGE_PX },
  climb: { kind: 'climb', lat: HD.KINDS.climb.lat, sides: [0], nudgePx: 0 },
  cup: { kind: 'cup', lat: HD.KINDS.cup.lat, sides: [1, -1], nudgePx: 0 },
  edge: { kind: 'cup', lat: 0.65, sides: [1], nudgePx: 0, colour: EDGE_COLOUR },   // dragged with the cup's maths: degrees across, as the cup's handle
  edgeR: { kind: 'cup', lat: 0.65, sides: [-1], nudgePx: 0, colour: EDGE_COLOUR },
});
function styleOf(field) {
  const s = STYLE[field]; if (!s) throw new Error(`secondtick: no field "${field}"`);
  return { colour: s.colour || HD.KINDS[s.kind].colour, lat: s.lat, sides: s.sides.slice(), nudgePx: s.nudgePx, kind: s.kind };
}

function stationAt(ghost, from) {
  if (!ghost || ghost.jump || !Array.isArray(ghost.samples) || !ghost.samples.length || !(from >= 0)) return null;
  const S = ghost.samples, x = ghost.s0 + from;
  if (x > S[S.length - 1].s + 1e-9 || x < S[0].s - 1e-9) return null;   // off the piece: the core refuses such a from by name, and there is nothing to mark
  let lo = 0, hi = S.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (S[mid].s < x) lo = mid + 1; else hi = mid; }
  return lo > 0 && Math.abs(S[lo - 1].s - x) < Math.abs(S[lo].s - x) ? S[lo - 1] : S[lo];
}
const toScreenOf = (pose, W, H) => { const VP = M.viewProj(pose, W / H); return (p) => { const c = M.apply(VP, p); return c[3] > 0 ? { x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * H } : null; }; };
const across = (m, u) => [m.pos[0] + m.L[0] * u, m.pos[1] + m.L[1] * u, m.pos[2] + m.L[2] * u];

/** The mark's strokes: at each of its sides, a short stroke along the road's left on screen, centred at lat·half (nudged), so it crosses the road's edge line there */
function markStroke(ghost, mark, pose, W, H) {
  if (!mark || !pose || !(W > 0 && H > 0)) return null;
  const m = stationAt(ghost, mark.from); if (!m) return null;
  const scr = toScreenOf(pose, W, H), half = mark.half > 0 ? mark.half : 4, strokes = [];
  for (const side of mark.sides) {
    const u = side * mark.lat * half, p = scr(across(m, u)), q = scr(across(m, u + 1));
    if (!p || !q) continue;
    let dx = q.x - p.x, dy = q.y - p.y; const len = Math.hypot(dx, dy);
    if (!(len > 1e-9)) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }   // edge-on: a level stroke
    const sg = side === 0 ? 1 : side, c = { x: p.x + dx * sg * mark.nudgePx, y: p.y + dy * sg * mark.nudgePx };
    strokes.push({ a: { x: c.x - dx * STROKE_PX, y: c.y - dy * STROKE_PX }, b: { x: c.x + dx * STROKE_PX, y: c.y + dy * STROKE_PX } });
  }
  return strokes.length ? { field: mark.field, index: mark.index, s: m.s, strokes } : null;
}
/** (L135) the station nearest s0 + at.from, and the points at.half to its right (a) and left (b) */
function tickAt(ghost, at) {
  if (!at) return null;
  const m = stationAt(ghost, at.from); if (!m) return null;
  const h = at.half > 0 ? at.half : 4;
  return { s: m.s, a: across(m, -h), b: across(m, h) };
}
// The words of a field's extra change: its name, and the verb for what it does over its stretch
const MARK_WORDS = Object.freeze({ bank: ['bank', 'rolls'], turn: ['turn', 'turns'], climb: ['climb', 'climbs'], width: ['width', 'changes'], cup: ['cup', 'changes'] });
const f2 = (x) => Number(x).toFixed(2);   // two decimals (2026-10-15: every number reads to 0.00)
function markText(field, index, from, to, L) {
  const w = MARK_WORDS[field]; if (!w || !Number.isFinite(from) || !Number.isFinite(to) || !(to >= from)) return '';
  const end = Number.isFinite(L) && Math.abs(to - L) < 0.005 ? 'end' : `${f2(to)} m`;
  return `Extra ${w[0]}${index ? ` ${index + 1}` : ''} · ${f2(from)} m → ${end} · ${w[1]} over ${f2(to - from)} m · drag to start earlier or later`;
}
/** the road across at each ghost station from s0 + mark.from to s0 + mark.to, its half width eased linearly from mark.half to mark.halfTo (the panel's halfAt is linear too) */
function stretchStrip(ghost, mark) {
  if (!mark || !Number.isFinite(mark.from) || !Number.isFinite(mark.to) || !(mark.to > mark.from)) return null;
  const a0 = stationAt(ghost, mark.from), a1 = stationAt(ghost, mark.to); if (!a0 || !a1) return null;
  const h0 = mark.half > 0 ? mark.half : 4, h1 = mark.halfTo > 0 ? mark.halfTo : h0, out = [];
  for (const m of ghost.samples) {
    if (m.s < a0.s - 1e-9 || m.s > a1.s + 1e-9) continue;
    const t = a1.s > a0.s ? (m.s - a0.s) / (a1.s - a0.s) : 0, h = h0 + (h1 - h0) * t;
    out.push({ s: m.s, a: across(m, -h), b: across(m, h) });
  }
  return out.length >= 2 ? out : null;
}
const segDist = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy, t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2)) : 0; return Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t); };

function mount(stage, win, itemsNow, hooks = {}) {
  const T = tokensOf(win);
  const doc = stage.ownerDocument, canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-label', 'later changes');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4';
  stage.append(canvas);
  const ask = (name) => { let got = null; doc.dispatchEvent(new win.CustomEvent(name, { detail: { reply: (x) => { got = x; } } })); return got; };
  let raf = 0, sized = '', drawnMarks = [], drawnOffers = [], last = { ghost: null, pose: null, W: 0, H: 0 }, drag = null;
  const drawNow = () => {
    if (!canvas.isConnected && stage.isConnected !== false) stage.append(canvas);   // the preview's mount clears #preview after the panel mounted
    const W = stage.clientWidth, H = stage.clientHeight, items = itemsNow() || { marks: [], offers: [] };
    const any = (items.marks && items.marks.length) || (items.offers && items.offers.length);
    const ghost = any ? ask('t180:ghost-request') : null, view = ghost ? ask('t180:view') : null, pose = view && view.pose;
    last = { ghost, pose, W, H };
    drawnMarks = pose ? (items.marks || []).map((mk) => { const d = markStroke(ghost, mk, pose, W, H); return d ? { ...d, item: mk } : null; }).filter(Boolean) : [];
    drawnOffers = pose ? (items.offers || []).map((of) => { const d = markStroke(ghost, { ...of, nudgePx: of.nudgePx, sides: [of.sides[0]] }, pose, W, H); return d ? { ...d, item: of, at: { x: (d.strokes[0].a.x + d.strokes[0].b.x) / 2, y: (d.strokes[0].a.y + d.strokes[0].b.y) / 2 } } : null; }).filter(Boolean) : [];
    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (ctx) {
      const dpr = win.devicePixelRatio || 1, key = `${W}x${H}@${dpr}`;
      if (key !== sized) { canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr)); sized = key; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.lineCap = 'round';
      for (const d of drawnMarks) if (d.item.label) drawStretch(ctx, d, last);
      for (const d of drawnMarks) for (const [w, colour] of [[6, T.css('--ink', '#0b0d11')], [3, d.item.colour]]) { ctx.lineWidth = w; ctx.strokeStyle = colour; for (const st of d.strokes) { ctx.beginPath(); ctx.moveTo(st.a.x, st.a.y); ctx.lineTo(st.b.x, st.b.y); ctx.stroke(); } }
      for (const d of drawnMarks) if (d.item.label) drawExplained(ctx, d, last, W, H);
      // an offer: a faint ring in the field's colour, the same size as a handle's mark (it is a handle not yet used)
      ctx.globalAlpha = 0.45;
      for (const d of drawnOffers) { ctx.lineWidth = 2.5; ctx.strokeStyle = d.item.colour; ctx.beginPath(); ctx.arc(d.at.x, d.at.y, 7, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    return { marks: drawnMarks, offers: drawnOffers };
  };
  // The stretch a labelled mark changes, tinted in its colour (brighter while lit): one quad a station step, skipped where a corner is behind the camera
  const drawStretch = (ctx, d, at) => {
    const strip = stretchStrip(at.ghost, d.item); if (!strip) return;
    const scr = toScreenOf(at.pose, at.W, at.H), P = strip.map((q) => [scr(q.a), scr(q.b)]);
    ctx.save(); ctx.globalAlpha = d.item.lit ? 0.38 : 0.16; ctx.fillStyle = d.item.colour; ctx.beginPath();
    for (let i = 1; i < P.length; i++) { const [a0, b0] = P[i - 1], [a1, b1] = P[i]; if (!a0 || !b0 || !a1 || !b1) continue; ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.lineTo(b0.x, b0.y); ctx.closePath(); }
    ctx.fill();
    if (d.item.lit) { ctx.globalAlpha = 0.9; ctx.lineWidth = 2; ctx.strokeStyle = d.item.colour; for (const k of [0, 1]) { ctx.beginPath(); let on = false; for (const pr of P) { const q = pr[k]; if (!q) { on = false; continue; } if (on) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); on = true; } } ctx.stroke(); } }
    ctx.restore();
  };
  // On the tick, small arrows along the road both ways (it is dragged along the road), and its label beside it, in the handles' tip style
  const drawExplained = (ctx, d, at, W, H) => {
    const m = stationAt(at.ghost, d.item.from); if (!m || !m.T) return;
    const scr = toScreenOf(at.pose, W, H), c = scr(m.pos), ahead = scr([m.pos[0] + m.T[0], m.pos[1] + m.T[1], m.pos[2] + m.T[2]]); if (!c) return;
    let ux = 1, uy = 0; if (ahead) { const l = Math.hypot(ahead.x - c.x, ahead.y - c.y); if (l > 1e-6) { ux = (ahead.x - c.x) / l; uy = (ahead.y - c.y) / l; } }
    const ink = T.css('--ink', '#0b0d11'), reach = d.item.lit ? 26 : 20, gap = 9;
    // the arrows stand at 0.6 of the half width either side: off the centre (the climb's handle at mid-piece) and off the edges (the bank's strokes, the turn's handle)
    const h = d.item.half > 0 ? d.item.half : 4, spots = [-0.6 * h, 0.6 * h].map((u) => scr(across(m, u))).filter(Boolean);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [w, colour] of [[5, ink], [2.2, d.item.colour]]) {
      ctx.lineWidth = w; ctx.strokeStyle = colour; ctx.beginPath();
      for (const o of spots) for (const sg of [-1, 1]) { const sx = o.x + ux * gap * sg, sy = o.y + uy * gap * sg, ex = o.x + ux * reach * sg, ey = o.y + uy * reach * sg; ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.moveTo(ex, ey); ctx.lineTo(ex - (ux * 5 + -uy * 4) * sg, ey - (uy * 5 + ux * 4) * sg); ctx.moveTo(ex, ey); ctx.lineTo(ex - (ux * 5 - -uy * 4) * sg, ey - (uy * 5 - ux * 4) * sg); }
      ctx.stroke();
    }
    const cut = d.item.label.indexOf(' · drag'), lines = cut > 0 ? [d.item.label.slice(0, cut), d.item.label.slice(cut + 3)] : [d.item.label];
    ctx.font = 'bold 12px system-ui, "Segoe UI", sans-serif';
    const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 12, hgt = 6 + 18 * lines.length;
    // beside the tick, off the road: along the screen normal to the road, on the upper side (above it when the road runs across the screen)
    const nx = -uy, ny = ux, sgn = ny > 0 ? -1 : 1, ox = c.x + nx * 44 * sgn, oy = c.y + ny * 44 * sgn;   // 44 px: past the tick's arrows (reach 26)
    const bx = Math.max(4, Math.min(W - w - 4, ox - w / 2)), by = Math.max(4, Math.min(H - hgt - 4, oy - hgt));
    ctx.globalAlpha = 1; ctx.fillStyle = T.alpha('--veil', 0.92, '#0b0d11'); ctx.fillRect(bx, by, w, hgt);
    ctx.strokeStyle = d.item.colour; ctx.lineWidth = d.item.lit ? 2.5 : 1.5; ctx.strokeRect(bx, by, w, hgt);
    ctx.fillStyle = T.css('--on-ink', '#eef1f6'); ctx.textBaseline = 'middle'; lines.forEach((t, i) => ctx.fillText(t, bx + 6, by + 12 + 18 * i));
    ctx.restore();
  };
  const frame = () => { raf = win.requestAnimationFrame(frame); if (!drag) drawNow(); };
  raf = win.requestAnimationFrame(frame);
  const local = (e) => { const r = stage.getBoundingClientRect ? stage.getBoundingClientRect() : { left: 0, top: 0 }; return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const take = (e) => { if (e.stopImmediatePropagation) e.stopImmediatePropagation(); else if (e.stopPropagation) e.stopPropagation(); if (e.preventDefault) e.preventDefault(); };
  const down = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const p = local(e);
    if (hooks.yields && hooks.yields(p)) return;   // L140 (B's G4, G10): the press is a handle's
    const offer = drawnOffers.find((d) => Math.hypot(d.at.x - p.x, d.at.y - p.y) <= HIT_PX);
    const mark = offer ? null : drawnMarks.find((d) => d.strokes.some((st) => segDist(p, st.a, st.b) <= HIT_PX));
    if (!offer && !mark) return;
    take(e);
    drag = { kind: offer ? 'offer' : 'mark', d: offer || mark, start: p, moved: false, ghost: last.ghost, pose: last.pose, W: last.W, H: last.H };
    if (stage.setPointerCapture && e.pointerId !== undefined) { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* a pointer the stage cannot hold: the drag still runs */ } }
    if (hooks.onDragStart) hooks.onDragStart(drag.d.item);
  };
  const move = (e) => {
    if (!drag) return;
    take(e);
    const p = local(e), { ghost, pose, W, H } = drag;
    if (!ghost || !pose) return;
    if (drag.kind === 'mark') {
      // the station whose point (at the mark's own place across the road) is nearest the pointer, as metres from the piece start
      const scr = toScreenOf(pose, W, H), it = drag.d.item, u = (it.sides[0] || 0) * it.lat * (it.half > 0 ? it.half : 4);
      let best = null, bd = Infinity;
      for (const m of ghost.samples) { const q = scr(across(m, u)); if (!q) continue; const dd = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (dd < bd) { bd = dd; best = m; } }
      if (!best) return;
      drag.moved = true;
      if (hooks.onMarkDrag) hooks.onMarkDrag(it, Math.round((best.s - ghost.s0) * 100) / 100);
    } else {
      // an offer: the field's handle maths (handles.js), along the field's own axis at the offer's station
      const it = drag.d.item, m = stationAt(ghost, it.from); if (!m) return;
      const dx = p.x - drag.start.x, dy = p.y - drag.start.y; if (!drag.moved && Math.hypot(dx, dy) < 1) return;
      const K = HD.KINDS[it.kind], VP = M.viewProj(pose, W / H), side = it.sides[0] || 1, pos = across(m, (it.sides[0] || 0) * it.lat * (it.half > 0 ? it.half : 4));
      const ax = K.axis === 'U' ? m.U : m.L, axis = HD.screenAxis(VP, W, H, pos, [ax[0] * side, ax[1] * side, ax[2] * side]);
      const value = HD.targetFor(it.kind, it.base, HD.dragPixels(axis, dx, dy, it.kind), { half: it.half }, { [HD.PRECISE_MOD]: !!e[HD.PRECISE_MOD] });
      drag.moved = true;
      if (hooks.onOfferDrag) hooks.onOfferDrag(it, value);
    }
  };
  const up = (e) => { if (!drag) return; take(e); const d = drag; drag = null; if (hooks.onDragEnd) hooks.onDragEnd(d.d.item, d.moved); };
  stage.addEventListener('pointerdown', down, { capture: true }); stage.addEventListener('pointermove', move, { capture: true });
  stage.addEventListener('pointerup', up, { capture: true }); stage.addEventListener('pointercancel', up, { capture: true });
  return { drawNow, marks: () => drawnMarks.slice(), offers: () => drawnOffers.slice(), tick: () => (drawnMarks[0] ? { s: drawnMarks[0].s } : null),
    unmount() { win.cancelAnimationFrame(raf); canvas.remove(); stage.removeEventListener('pointerdown', down, { capture: true }); stage.removeEventListener('pointermove', move, { capture: true }); stage.removeEventListener('pointerup', up, { capture: true }); stage.removeEventListener('pointercancel', up, { capture: true }); } };
}

module.exports = { styleOf, stationAt, markStroke, tickAt, markText, stretchStrip, mount, EDGE_COLOUR };
