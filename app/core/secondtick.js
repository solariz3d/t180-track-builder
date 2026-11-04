// secondtick.js: THE SECOND BANK'S TICK ON THE GHOST (L135; the user, 2026-11-04: "there is another mark towards the end you can bank again"). A short line across
// the next-piece ghost where its second bank begins (the panel's "from (m)"), so the place the road starts to bank again is seen before the piece is placed. A
// canvas over the preview (#preview), redrawn every animation frame like the flights (app/core/flightlayer.js), since the camera eases. The preview itself is not
// changed: its pose comes from 't180:view' and the ghost from 't180:ghost-request' ({ samples, segments, jump, s0 }: the candidate's samples, s0 its start).
//
//   tickAt(ghost, at)            -> { s, a, b } | null     pure: the ghost's station nearest s0 + at.from, and the points at.half to its right (a) and left (b)
//   tickLine(tick, pose, W, H)   -> { a, b } | null        pure: the tick in css px of the preview; null when either end is behind the camera
//   mount(stage, win, atNow)     -> { drawNow(), unmount() }  atNow() is the panel's { from, half } or null (no second bank); drawNow() draws once and returns the tick
'use strict';

const M = require('../camera/math.js');
const { tokensOf } = require('../lib/tokens.js');   // the skin's colours (app/lib/tokens.js)

function tickAt(ghost, at) {
  if (!ghost || ghost.jump || !at || !(at.from > 0) || !Array.isArray(ghost.samples) || !ghost.samples.length) return null;
  const S = ghost.samples, x = ghost.s0 + at.from;
  if (x > S[S.length - 1].s + 1e-9 || x < S[0].s - 1e-9) return null;   // off the piece: the core refuses such a from by name, and there is nothing to mark
  let lo = 0, hi = S.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (S[mid].s < x) lo = mid + 1; else hi = mid; }
  const m = lo > 0 && Math.abs(S[lo - 1].s - x) < Math.abs(S[lo].s - x) ? S[lo - 1] : S[lo];
  const h = at.half > 0 ? at.half : 4, across = (k) => [m.pos[0] + m.L[0] * h * k, m.pos[1] + m.L[1] * h * k, m.pos[2] + m.L[2] * h * k];
  return { s: m.s, a: across(-1), b: across(1) };
}

function tickLine(tick, pose, W, H) {
  if (!tick || !pose || !(W > 0 && H > 0)) return null;
  const VP = M.viewProj(pose, W / H);
  const toScreen = (p) => { const c = M.apply(VP, p); return c[3] > 0 ? { x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * H } : null; };
  const a = toScreen(tick.a), b = toScreen(tick.b);
  return a && b ? { a, b } : null;
}

function mount(stage, win, atNow) {
  const T = tokensOf(win);
  const doc = stage.ownerDocument, canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-label', 'second bank from');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4';
  stage.append(canvas);
  const ask = (name) => { let got = null; doc.dispatchEvent(new win.CustomEvent(name, { detail: { reply: (x) => { got = x; } } })); return got; };
  let raf = 0, sized = '', drawn = null;
  const drawNow = () => {
    if (!canvas.isConnected && stage.isConnected !== false) stage.append(canvas);   // the preview's mount clears #preview after the panel mounted
    const W = stage.clientWidth, H = stage.clientHeight, at = atNow();
    const tick = at ? tickAt(ask('t180:ghost-request'), at) : null, view = tick ? ask('t180:view') : null;
    const line = tick && view && view.pose ? tickLine(tick, view.pose, W, H) : null;
    drawn = line ? { s: tick.s, ...line } : null;
    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (ctx) {
      const dpr = win.devicePixelRatio || 1, key = `${W}x${H}@${dpr}`;
      if (key !== sized) { canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr)); sized = key; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      if (line) {
        ctx.lineCap = 'round';
        for (const [w, colour] of [[6, T.css('--ink', '#0b0d11')], [3, '#ffd24a']]) { ctx.lineWidth = w; ctx.strokeStyle = colour; ctx.beginPath(); ctx.moveTo(line.a.x, line.a.y); ctx.lineTo(line.b.x, line.b.y); ctx.stroke(); }
      }
    }
    return drawn;
  };
  const frame = () => { raf = win.requestAnimationFrame(frame); drawNow(); };
  raf = win.requestAnimationFrame(frame);
  return { drawNow, tick: () => drawn, unmount() { win.cancelAnimationFrame(raf); canvas.remove(); } };
}

module.exports = { tickAt, tickLine, mount };
