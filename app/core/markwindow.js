// markwindow.js (L242; the user, 2026-11-26 00:58: "we should also incorporate the themes for those windows for each theme u know? More work, but it is fun work imo"):
// THE LOOK OF THE SMALL WINDOWS ON THE VIEW: a mark's label (secondtick.js), a handle's readout and the brush box (handles.js). Each theme sets these tokens in its own file
// (app/themes/<name>.css, SIGIL's in app/index.html :root) and this file reads them through app/lib/tokens.js. Where and how big a box is stays the caller's (placeLabel,
// the avoid boxes, the clamps): only the look, and the element that shows it, are here.
// L251 (the user, 2026-11-26 04:49, on the blur mock: "I like the blur i think..."): THE WINDOWS ARE ELEMENTS over the stage, no longer drawn on a canvas, so a look's
// blur is real (a canvas cannot blur what is behind it). One element a box, the same nodes reused from draw to draw (none is made or removed while the windows only move
// or change their words; a draw needing more windows than any before adds one, and an unused one is hidden), and none takes a pointer event: a press, a hover or a drag
// on a window reaches the stage and what is under it, as on the canvas. A page that sets no tokens (a test's window, the preview's smoke page) shows the box of before
// L242 (square, the veil, a 1.5 px edge in the mark's colour, bold 12px system-ui), its fill now solid, since it sets no blur (below).
//
//   --mark-win-font     the font family (a theme's --display or --body)            fallback system-ui, "Segoe UI", sans-serif
//   --mark-win-weight   the weight                                                 fallback bold
//   --mark-win-radius   corner radius, px                                          fallback 0 (a square box)
//   --mark-win-bg       the fill                                                   fallback --veil at 0.92 (solid where there is no blur, below)
//   --mark-win-text     the words                                                  fallback --on-ink
//   --mark-win-edge     the edge's width, px (its colour is always the mark's own: it says which mark the window belongs to)   fallback the caller's
//   --mark-win-glow     a glow in the mark's colour around the edge, px of blur    fallback 0
//   --mark-win-sheen    a 1 px highlight just inside the top edge (glass, gel)     fallback none
//   --mark-win-shade    a soft drop shadow under the box (a light theme's lift)     fallback none
//   --mark-win-blur     (L251) what is behind the window, blurred: the look's own panel blur, its #left's backdrop-filter written whole (markwindow.test.js W8)   fallback none
//                       With none, or under prefers-reduced-transparency, the fill is solid (--mark-win-bg's alpha dropped) and nothing is blurred.
// And the marks' and handles' COLOURS: --mark-<field> (bank, turn, climb, width, cup, length, edge) over today's literals, and --mark-rim, the dark rim every arrow,
// bar and dot is drawn on (fallback --ink). A theme that sets none draws today's colours.
//
//   font(T)                                  -> the ctx.font string ('bold 12px …')
//   lookOf(T, colour, { edge, lit, reduce })  -> { radius, background, color, font, edge, boxShadow, backdropFilter }   pure: one window's CSS; lit: the edge 1 px
//                                                wider; reduce: prefers-reduced-transparency
//   layer(stage, win, T, { z, name })         -> { begin(), put(box, lines, colour, { edge, lit, firstY, padX }), end(), nodes(), remove() }   the windows over the
//       stage. A draw is begin(), a put() per window (box = { x, y, w, h }, css px of the stage; firstY: the first line's middle below the box's top, lines 18 px
//       apart), then end(), which hides the windows not put this draw. nodes() -> every window element made so far, shown or hidden
//   colourOf(T, base, fallback)              -> the mark colour of a field ('bank', 'turn', …): --mark-<base> or the fallback
'use strict';

const FONT_FALLBACK = 'system-ui, "Segoe UI", sans-serif';
const num = (T, name, fallback) => { const v = parseFloat(T.word(name, String(fallback))); return Number.isFinite(v) ? v : fallback; };
const hasWord = (T, name) => T.word(name, '\u0000') !== '\u0000';   // the token is set at all (a word read with an impossible fallback)

function font(T) { return `${T.word('--mark-win-weight', 'bold')} 12px ${T.word('--mark-win-font', FONT_FALLBACK)}`; }
function colourOf(T, base, fallback) { return T.css(`--mark-${base}`, fallback); }

// One window's CSS from the look's tokens, as the canvas drew it: the fill, the edge in the mark's colour (inside the box, so the box the caller placed is the whole
// window), the sheen 1 px inside the top edge, the glow and the shade; and (L251) the look's blur, or the solid fill where it has none or the person asked for less
// transparency
function lookOf(T, colour, { edge = 1.5, lit = false, reduce = false } = {}) {
  const r = num(T, '--mark-win-radius', 0), glow = num(T, '--mark-win-glow', 0), ew = num(T, '--mark-win-edge', edge) + (lit ? 1 : 0);
  const want = T.word('--mark-win-blur', 'none'), blur = reduce || want === 'none' ? 'none' : want;
  const background = blur === 'none' ? T.solid('--mark-win-bg', T.solid('--veil', '#0b0d11')) : T.css('--mark-win-bg', T.alpha('--veil', 0.92, '#0b0d11'));
  const shadows = [`inset 0 0 0 ${ew}px ${colour}`];   // the edge, listed first so it is drawn over the sheen
  if (hasWord(T, '--mark-win-sheen')) shadows.push(`inset 0 ${ew + 1}px 0 ${T.css('--mark-win-sheen', 'rgba(255, 255, 255, 0.5)')}`);   // shows 1 px below the edge
  if (glow > 0) shadows.push(`0 0 ${glow}px ${colour}`);
  if (hasWord(T, '--mark-win-shade')) shadows.push(`0 3px 10px ${T.css('--mark-win-shade', 'rgba(0, 0, 0, 0.25)')}`);
  return { radius: r, background, color: T.css('--mark-win-text', T.css('--on-ink', '#eef1f6')), font: font(T), edge: ew, boxShadow: shadows.join(', '), backdropFilter: blur };
}

// The windows of one layer over the stage. z: the z-index of the canvas they were drawn on, so they stack where it drew them (appended after it, so over it). The
// container and its windows are made at the first put (a stage that never shows a window gets no element), and put back into the stage when the preview's mount has
// cleared it, as the canvases are
function layer(stage, win, T, { z = 4, name = 'windows' } = {}) {
  const doc = stage.ownerDocument, pool = [];
  let box = null, n = 0;
  const query = win && typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-reduced-transparency: reduce)') : null;
  const attach = () => { if (box && !box.isConnected && stage.isConnected !== false) stage.append(box); };
  const make = () => {
    if (!box) { box = doc.createElement('div'); box.setAttribute('data-mark-windows', name); box.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:${z}`; stage.append(box); }
    const el = doc.createElement('div'); el.setAttribute('data-mark-window', name);
    el.style.cssText = 'position:absolute;box-sizing:border-box;margin:0;pointer-events:none;white-space:pre;overflow:visible;display:none';
    const text = typeof doc.createTextNode === 'function' ? doc.createTextNode('') : null; if (text) el.append(text);
    box.append(el);
    const slot = { el, text, look: '', at: '', words: null, args: null }; pool.push(slot); return slot;
  };
  const put = (b, lines, colour, opts = {}) => {
    const s = pool[n] || make(); n++;
    const { firstY = 12, padX = 6 } = opts, W = lookOf(T, colour, { edge: opts.edge, lit: opts.lit, reduce: !!(query && query.matches) }), st = s.el.style;
    const look = [W.radius, W.background, W.color, W.font, W.boxShadow, W.backdropFilter, firstY, padX].join('|');
    if (look !== s.look) {
      s.look = look; st.borderRadius = `${W.radius}px`; st.background = W.background; st.color = W.color; st.boxShadow = W.boxShadow;
      st.font = W.font; st.lineHeight = '18px';   // after the font: its shorthand resets the line height
      st.backdropFilter = W.backdropFilter; st.webkitBackdropFilter = W.backdropFilter;
      st.padding = `${Math.max(0, firstY - 9)}px 0 0 ${padX}px`;   // a line's middle is 9 px below its top, as the canvas put it at firstY
    }
    const at = `${b.x},${b.y},${b.w},${b.h}`;
    if (at !== s.at) { s.at = at; st.left = `${b.x}px`; st.top = `${b.y}px`; st.width = `${b.w}px`; st.height = `${b.h}px`; }
    const words = lines.join('\n');
    if (words !== s.words) { s.words = words; if (s.text) s.text.data = words; else s.el.textContent = words; }
    if (st.display !== 'block') st.display = 'block';
    s.args = [{ ...b }, lines.slice(), colour, { ...opts }];
  };
  const begin = () => { n = 0; attach(); };
  const end = () => { for (let i = n; i < pool.length; i++) if (pool[i].el.style.display !== 'none') pool[i].el.style.display = 'none'; };
  // a skin changed, or the person's transparency setting: the windows shown take the new look now, not at the next draw (the handles redraw only when what they read changes)
  const restyle = () => { const shown = pool.slice(0, n).map((s) => s.args); begin(); for (const args of shown) put(...args); end(); };
  const offTheme = T && typeof T.onChange === 'function' ? T.onChange(restyle) : null;
  if (query && typeof query.addEventListener === 'function') query.addEventListener('change', restyle);
  return { begin, put, end, nodes: () => pool.map((s) => s.el),
    remove() { if (offTheme) offTheme(); if (query && typeof query.removeEventListener === 'function') query.removeEventListener('change', restyle); if (box) box.remove(); } };
}

module.exports = { font, lookOf, layer, colourOf };
