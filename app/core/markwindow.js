// markwindow.js (L242; the user, 2026-11-26 00:58: "we should also incorporate the themes for those windows for each theme u know? More work, but it is fun work imo"):
// THE LOOK OF THE SMALL WINDOWS ON THE VIEW: a mark's label (secondtick.js) and a handle's readout (handles.js). Both are drawn on a canvas, so a theme's CSS cannot reach
// them; each theme sets these tokens in its own file (app/themes/<name>.css, SIGIL's in app/index.html :root) and this file reads them through app/lib/tokens.js.
// A page that sets none (a test's window, the preview's smoke page) draws exactly what was drawn before L242: a square box, the veil at 0.92, a 1.5 px edge in the
// mark's colour, bold 12px system-ui. Where and how big the box is stays the caller's (placeLabel, the avoid boxes): only the look is here.
//
//   --mark-win-font     the font family (a theme's --display or --body)            fallback system-ui, "Segoe UI", sans-serif
//   --mark-win-weight   the weight                                                 fallback bold
//   --mark-win-radius   corner radius, px                                          fallback 0 (a square box, drawn with fillRect/strokeRect as before)
//   --mark-win-bg       the fill                                                   fallback --veil at 0.92
//   --mark-win-text     the words                                                  fallback --on-ink
//   --mark-win-edge     the edge's width, px (its colour is always the mark's own: it says which mark the window belongs to)   fallback the caller's
//   --mark-win-glow     a glow in the mark's colour around the edge, px of blur    fallback 0
//   --mark-win-sheen    a 1 px highlight just inside the top edge (glass, gel)     fallback none
//   --mark-win-shade    a soft drop shadow under the box (a light theme's lift)     fallback none
// And the marks' and handles' COLOURS: --mark-<field> (bank, turn, climb, width, cup, length, edge) over today's literals, and --mark-rim, the dark rim every arrow,
// bar and dot is drawn on (fallback --ink). A theme that sets none draws today's colours.
//
//   font(T)                                  -> the ctx.font string ('bold 12px …')
//   drawWindow(ctx, T, box, lines, colour, { edge, lit, lineH, firstY, padX })   the box and its lines; box = { x, y, w, h }; lit: the edge 1 px wider
//   colourOf(T, base, fallback)              -> the mark colour of a field ('bank', 'turn', …): --mark-<base> or the fallback
'use strict';

const FONT_FALLBACK = 'system-ui, "Segoe UI", sans-serif';
const num = (T, name, fallback) => { const v = parseFloat(T.word(name, String(fallback))); return Number.isFinite(v) ? v : fallback; };
const hasWord = (T, name) => T.word(name, '\u0000') !== '\u0000';   // the token is set at all (a word read with an impossible fallback)

function font(T) { return `${T.word('--mark-win-weight', 'bold')} 12px ${T.word('--mark-win-font', FONT_FALLBACK)}`; }
function colourOf(T, base, fallback) { return T.css(`--mark-${base}`, fallback); }

/** A rounded rectangle's path (the canvas's roundRect where it has one, arcs where it does not: an older WebView, a test's stub). */
function roundPath(ctx, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, k); return; }
  ctx.moveTo(x + k, y); ctx.lineTo(x + w - k, y); ctx.arcTo(x + w, y, x + w, y + k, k); ctx.lineTo(x + w, y + h - k); ctx.arcTo(x + w, y + h, x + w - k, y + h, k);
  ctx.lineTo(x + k, y + h); ctx.arcTo(x, y + h, x, y + h - k, k); ctx.lineTo(x, y + k); ctx.arcTo(x, y, x + k, y, k); ctx.closePath();
}

function drawWindow(ctx, T, box, lines, colour, { edge = 1.5, lit = false, lineH = 18, firstY = 12, padX = 6 } = {}) {
  const { x, y, w, h } = box, r = num(T, '--mark-win-radius', 0), glow = num(T, '--mark-win-glow', 0), ew = num(T, '--mark-win-edge', edge) + (lit ? 1 : 0);
  const bg = T.css('--mark-win-bg', T.alpha('--veil', 0.92, '#0b0d11'));
  ctx.save();
  if (hasWord(T, '--mark-win-shade')) { ctx.shadowColor = T.css('--mark-win-shade', 'rgba(0, 0, 0, 0.25)'); ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; }
  ctx.fillStyle = bg;
  if (r > 0) { roundPath(ctx, x, y, w, h, r); ctx.fill(); } else ctx.fillRect(x, y, w, h);
  ctx.shadowColor = 'rgba(0, 0, 0, 0)'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  if (glow > 0) { ctx.shadowColor = colour; ctx.shadowBlur = glow; }
  ctx.strokeStyle = colour; ctx.lineWidth = ew;
  if (r > 0) { roundPath(ctx, x, y, w, h, r); ctx.stroke(); } else ctx.strokeRect(x, y, w, h);
  ctx.shadowColor = 'rgba(0, 0, 0, 0)'; ctx.shadowBlur = 0;
  if (hasWord(T, '--mark-win-sheen')) {   // a highlight just inside the top edge, between the rounded corners
    ctx.strokeStyle = T.css('--mark-win-sheen', 'rgba(255, 255, 255, 0.5)'); ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(x + Math.max(r, 3), y + ew / 2 + 1); ctx.lineTo(x + w - Math.max(r, 3), y + ew / 2 + 1); ctx.stroke();
  }
  ctx.font = font(T); ctx.fillStyle = T.css('--mark-win-text', T.css('--on-ink', '#eef1f6')); ctx.textBaseline = 'middle';
  lines.forEach((t, i) => ctx.fillText(t, x + padX, y + firstY + lineH * i));
  ctx.restore();
}

module.exports = { font, drawWindow, colourOf, roundPath };
