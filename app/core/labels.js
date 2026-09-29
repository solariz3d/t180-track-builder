// labels.js: THE READOUT on the track (L130, pane C; the plan's Part 2, "C: the display"). A small label at every placed road
// piece, in the view: its length and the CHANGE it makes in turn, climb and bank, the numbers of src/core/readout.js (A). The
// keeper, 01:2x: "see the degrees of change when adjusting the banking, pitch, and roll and even turns"; "DISTANCE OF EACH PIECE
// IN METERS SO YOU CAN SEE WITH THE DEGREE UI".
//
// A DOM layer over the preview (#preview), redrawn every animation frame: the camera eases, so the labels move with it. The
// preview is not changed: its pose comes from the 't180:view' event (app/preview/index.js), the track from 't180:track-request'.
// - FIXED PIXEL SIZE: a label is the same size at every zoom (0.05 to 50), so it is readable at all of them.
// - NEVER OVER THE BUILD HEAD: the head and its marker are kept clear; a label that would cover them is moved, and if it cannot
//   be, it is not drawn. The head's own label, which is always drawn, keeps at least the head's point and 7 px clear.
// - NEVER OVER EACH OTHER: labels are placed in priority order (the head's own piece first, then the nearest on screen) and a
//   label with no clear place is left out (culled). The head's own piece's label is placed first and is NEVER culled (D187).
// - FOR THE TESTS (E's seal): labels() returns what was DRAWN, [{ piece, text, rect: { x, y, w, h } }] in css px of the preview,
//   and the 't180:labels' event answers the same.
//
//   formatReadout(r)  -> { length, turn, climb, bank }: the strings, one decimal, the unit written, a sign on angles (0.0° bare)
//   labelText(r)      -> the label's two lines
//   layout(items, view) -> the placed labels (pure: the priority, the head's keep-out, the view's edge, the overlaps)
//   mount(stage, shell, win)
'use strict';

const M = require('../camera/math.js');

const MINUS = '−';
/** Round half away from zero at 0.1, with a guard for binary fractions (33.35 is 33.3499999… in binary). */
const round1 = (x) => Math.sign(x) * Math.round(Math.abs(x) * 10 + 1e-7) / 10;
function fmtDeg(x) {
  if (!Number.isFinite(x)) return '—';
  const v = round1(x);
  if (v === 0) return '0.0°';                                   // never "+0.0°" or "−0.0°"
  return `${v > 0 ? '+' : MINUS}${Math.abs(v).toFixed(1)}°`;
}
const fmtM = (x) => (Number.isFinite(x) ? `${round1(x).toFixed(1)} m` : '—');
/** A readout (src/core/readout.js) as the strings a person reads. Δbank = bankTo − bankFrom (the change the piece makes). */
function formatReadout(r) {
  return { length: fmtM(r.lengthM), turn: fmtDeg(r.turnDeg), climb: fmtDeg(r.climbDeg), bank: fmtDeg(r.bankToDeg - r.bankFromDeg) };
}
const labelText = (r) => { const f = formatReadout(r); return [f.length, `turn ${f.turn} · climb ${f.climb} · bank ${f.bank}`]; };

const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/**
 * Place the labels. `items` = [{ piece, text, x, y, w, h, priority }] (x, y the anchor on screen, w × h the label's size; lower
 * priority first). `view` = { width, height, head: { x, y, r } | null } (r: the head's keep-out radius in px). A label is tried
 * above its anchor, then below, then to the sides, then farther out; the first place that is inside the view, clear of the head's
 * keep-out square and clear of every label already placed is taken. A label with none is culled, EXCEPT the head's own (an item
 * with `head: true`), which is never culled (headPlace). Returns { drawn, culled }.
 */
const OFFSETS = [[0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];
function layout(items, view) {
  const drawn = [], culled = [];
  const keep = view.head ? { x: view.head.x - view.head.r, y: view.head.y - view.head.r, w: 2 * view.head.r, h: 2 * view.head.r } : null;
  for (const it of items.slice().sort((a, b) => a.priority - b.priority)) {
    let placed = null;
    // gaps from the anchor: near first; then, with a head, rings that clear its keep-out even when the anchor sits right on it
    // (the build view at zoom 0.05: every near place lay inside the keep-out, and the head's own label was culled)
    const gaps = [14, 28, 49];
    if (view.head) { const d = Math.hypot(it.x - view.head.x, it.y - view.head.y); gaps.push(view.head.r + d + 12, 2 * view.head.r + d + 12); }
    for (const gap of gaps) {
      for (const [dx, dy] of OFFSETS) {
        const x = it.x - it.w / 2 + dx * (it.w / 2 + gap), y = it.y - it.h / 2 + dy * (it.h / 2 + gap), rect = { x, y, w: it.w, h: it.h };
        if (x < 0 || y < 0 || x + it.w > view.width || y + it.h > view.height) continue;
        if (keep && hits(rect, keep)) continue;
        if (drawn.some((d) => hits(rect, d.rect))) continue;
        placed = rect; break;
      }
      if (placed) break;
    }
    // THE HEAD'S OWN LABEL IS NEVER CULLED (E's M5 (d); B's score, D187: missing in 6 of 15 states). It is placed first, so the
    // others make way for it, never the reverse; and when no ring fits, headPlace looks for a place anywhere in the view.
    if (!placed && it.head) placed = headPlace(it, view, keep);
    if (placed) drawn.push({ piece: it.piece, text: it.text, rect: placed }); else culled.push(it.piece);
  }
  return { drawn, culled };
}
/**
 * A place for the head's own label when no ring around its anchor fits: every place in the view on an 8 px grid (and flush with
 * its far edges), nearest the anchor first, clear of the head's keep-out; failing that, clear of only the head itself (its point
 * and 7 px: E's M4 needs 6); and last, pulled inside the view. It always returns a place.
 */
function headPlace(it, view, keep) {
  const W = view.width, H = view.height, w = it.w, h = it.h, spots = [];
  const xs = [], ys = [];
  for (let x = 0; x + w <= W; x += 8) xs.push(x);
  for (let y = 0; y + h <= H; y += 8) ys.push(y);
  if (W >= w) xs.push(W - w);
  if (H >= h) ys.push(H - h);
  for (const y of ys) for (const x of xs) spots.push({ x, y });
  const d2 = (s) => (s.x + w / 2 - it.x) ** 2 + (s.y + h / 2 - it.y) ** 2;
  spots.sort((a, b) => d2(a) - d2(b));
  const core = view.head ? { x: view.head.x - 7, y: view.head.y - 7, w: 14, h: 14 } : null;
  for (const avoid of [keep, core]) for (const s of spots) { const r = { x: s.x, y: s.y, w, h }; if (!avoid || !hits(r, avoid)) return r; }
  return { x: Math.max(0, Math.min(W - w, it.x - w / 2)), y: Math.max(0, Math.min(H - h, it.y - h / 2)), w, h };
}

/**
 * Where each road piece's label may be anchored: the piece's stations, the one nearest its MIDDLE first, then outward (at most 40,
 * spread evenly along the piece). The label takes the first that is on screen, so when the middle is behind the camera or out of
 * view (the build view looks ahead from 15 m behind the head) it slides to the part of the piece that is in view (L130: the head's
 * own piece drew no label in the build view).
 */
function anchorsOf(track) {
  const segs = track.segments, span = new Map(), by = new Map();
  let s = 0; segs.forEach((g) => { const e = span.get(g.id) || { a: s, b: s, road: false }; e.b = s + g.length; if (g.kind === 'road') e.road = true; span.set(g.id, e); s += g.length; });
  for (const m of track.path.samples) { const g = segs[m.seg]; if (!g) continue; if (!by.has(g.id)) by.set(g.id, []); by.get(g.id).push(m); }
  const out = new Map();
  for (const [id, e] of span) {
    const ms = by.get(id); if (!e.road || !ms || !ms.length) continue;
    const mid = (e.a + e.b) / 2, stride = Math.max(1, Math.ceil(ms.length / 40));
    // both ENDS always (a very near camera sees only the last metres of the head's piece), and every stride-th station between
    const picked = ms.filter((_, i) => i % stride === 0 || i === ms.length - 1).sort((x, y) => Math.abs(x.s - mid) - Math.abs(y.s - mid));
    out.set(id, picked.map((m) => m.pos.slice()));
  }
  return out;
}

function mount(stage, shell, win) {
  const doc = stage.ownerDocument, layer = doc.createElement('div');
  layer.setAttribute('aria-label', 'piece readouts');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;overflow:hidden';
  stage.append(layer);
  const ask = (name) => { let got = null; doc.dispatchEvent(new win.CustomEvent(name, { detail: { reply: (x) => { got = x; } } })); return got; };
  let anchorsFor = null, anchors = new Map(), drawn = [], culled = [], raf = 0, on = true;
  const pool = [];
  const box = (i) => {
    if (!pool[i]) {
      const e = doc.createElement('div');
      // 16 px bold, white on an OPAQUE near-black: its ink is ≥ 11 device px tall and its contrast far above 4.5 : 1 over any road
      // (E's M5). Measured by pixels, everything in the box that is not background counts as ink, so the box holds ONLY its
      // background and its text (B's score, D187: a border, rounded corners the road showed through, and a background the road
      // bled into put grey "ink" in the box and dragged the median below 4.5 : 1). The 2 px ring of the same colour outside the
      // box keeps the road off the box's own edge pixels.
      e.style.cssText = 'position:absolute;font:bold 16px/1.25 system-ui,"Segoe UI",sans-serif;color:#ffffff;background:#0b0d11;'
        + 'padding:3px 7px;border:0;border-radius:0;box-shadow:0 0 0 2px #0b0d11;white-space:pre';
      layer.append(e); pool[i] = e;
    }
    return pool[i];
  };
  const measure = (text) => { const e = box(pool.length); e.textContent = text; e.style.left = '-9999px'; e.style.top = '0'; const r = { w: e.offsetWidth, h: e.offsetHeight }; e.remove(); pool.pop(); return r; };
  const sizes = new Map();
  // a size is cached only once it is real: an element measured while the layer is out of the page measures 0
  const sizeOf = (text) => { if (sizes.has(text)) return sizes.get(text); const r = measure(text); if (r.w > 0 && r.h > 0) sizes.set(text, r); return r; };

  function frame() {
    raf = win.requestAnimationFrame(frame);
    // the preview's mount clears #preview AFTER the panel mounted this layer (found in the real window, L130): put it back
    if (!layer.isConnected) stage.append(layer);
    const view = on ? ask('t180:view') : null, track = on ? ask('t180:track-request') : null, st = shell.getState();
    const W = stage.clientWidth, H = stage.clientHeight;
    let placed = { drawn: [], culled: [] };
    if (view && view.pose && track && track.path && W > 0 && H > 0) {
      // keyed by the SEGMENTS, which are a new array on every change: the preview extends its path object IN PLACE, so keyed by
      // the path the anchors stayed the first piece's forever (found in the real window, L130: 1 label for 5 pieces)
      if (anchorsFor !== track.segments) { anchors = anchorsOf(track); anchorsFor = track.segments; }
      const reads = shell.pieceReadouts ? shell.pieceReadouts() : [], VP = M.viewProj(view.pose, W / H);
      const toScreen = (p) => { const c = M.apply(VP, p); return c[3] > 0 ? { x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * H, z: c[2] / c[3] } : null; };
      // the head's keep-out: its marker (look.js headMarker: max(3 m, 2% of the camera's distance)) projected, and never under 24 px
      let head = null, hp = null;
      if (view.head) {
        hp = toScreen(view.head.pos);
        if (hp) {
          const e = view.pose.eye, d = Math.hypot(e[0] - view.head.pos[0], e[1] - view.head.pos[1], e[2] - view.head.pos[2]), size = Math.max(3, 0.02 * d);
          const off = toScreen([view.head.pos[0], view.head.pos[1] + size, view.head.pos[2]]), rPx = off ? Math.hypot(off.x - hp.x, off.y - hp.y) : 0;
          // capped at a fifth of the view: at the nearest zoom the marker fills the screen, and an uncapped keep-out left the head's
          // own label nowhere to go (L130's capture at zoom 0.05); the head's centre stays clear either way
          head = { x: hp.x, y: hp.y, r: Math.min(Math.max(24, rPx + 8), 0.2 * Math.min(W, H)) };
        }
      }
      const headId = st.history.present.pieces.length ? st.history.present.pieces[st.history.present.pieces.length - 1].id : null;
      const items = [];
      reads.forEach((r) => {
        if (!r || r.type !== 'road') return;                      // a flight has no label
        const cands = anchors.get(r.id); if (!cands) return;
        // the first candidate (the middle, then outward) that lands in view, in front of the camera and before the far plane
        let p = null;
        for (const a of cands) { const q = toScreen(a); if (q && q.z <= 1 && q.x >= 0 && q.y >= 0 && q.x <= W && q.y <= H) { p = q; break; } }
        const isHead = r.id === headId;
        // the head's own piece is labelled even when none of it is on screen (E's M5 (d)): pinned at the edge nearest the head, or
        // in the top-left corner when the head is behind the camera
        if (!p && isHead) p = hp ? { x: Math.max(0, Math.min(W, hp.x)), y: Math.max(0, Math.min(H, hp.y)) } : { x: 0, y: 0 };
        if (!p) return;
        const text = labelText(r).join('\n'), size = sizeOf(text);
        items.push({ piece: r.id, text, x: p.x, y: p.y, w: size.w, h: size.h, head: isHead, priority: isHead ? -1 : head ? Math.hypot(p.x - head.x, p.y - head.y) : 0 });
      });
      placed = layout(items, { width: W, height: H, head });
    }
    placed.drawn.forEach((d, i) => { const e = box(i); if (e.textContent !== d.text) e.textContent = d.text; e.style.left = `${Math.round(d.rect.x)}px`; e.style.top = `${Math.round(d.rect.y)}px`; e.style.display = ''; });
    for (let i = placed.drawn.length; i < pool.length; i++) pool[i].style.display = 'none';
    drawn = placed.drawn.map((d) => ({ piece: d.piece, text: d.text, rect: { ...d.rect, x: Math.round(d.rect.x), y: Math.round(d.rect.y) } })); culled = placed.culled;
  }
  const answer = (e) => { if (e.detail && typeof e.detail.reply === 'function') e.detail.reply({ drawn: drawn.slice(), culled: culled.slice() }); };
  doc.addEventListener('t180:labels', answer);
  raf = win.requestAnimationFrame(frame);
  return {
    labels: () => drawn.slice(), culled: () => culled.slice(),
    setVisible(v) { on = !!v; layer.style.display = on ? '' : 'none'; },
    unmount() { win.cancelAnimationFrame(raf); doc.removeEventListener('t180:labels', answer); layer.remove(); },
  };
}

module.exports = { formatReadout, labelText, fmtDeg, fmtM, layout, anchorsOf, mount };
