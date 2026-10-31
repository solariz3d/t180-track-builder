// app/hovertip.js: the HOVER CARD, the page's own tooltip in the look's colours (D581; the user, 2026-10-31: "can u do a custom window for the hover prompts
// that goes with the theme?"). node --test app/test/hovertip.test.js
//
// EVERY element with a `title`, wherever it comes from (index.html, or any module that sets one, now or later), gets the card instead of Windows' own tooltip:
// one listener on the document, so nothing has to be wired per element.
//   · THE TITLE STAYS THE SOURCE. While the pointer is over an element its `title` is moved into `data-tip` (so Windows has none to draw), and put back when the
//     pointer leaves. Code that reads or sets a title keeps working; a title set while the element is hovered is moved again and the card shows the new words.
//   · SHOWN after DELAY_MS of hover, beside the pointer (below and right; above or left where the window ends), always wholly inside the window.
//   · HIDDEN on leaving the element, a scroll or wheel anywhere, any key, a press (a drag starts with one) and the window losing focus. It never takes focus and
//     never catches the pointer (pointer-events: none; no tabindex).
//   · ITS LOOK is the menus': the card carries the `more-menu` class, so each look's own menu panel (surface, border, radius and the blur that look allows its
//     menus, D547 Part 2) draws it, and index.html's #hovertip rule gives it the look's --accent as its top edge. Nothing here names a look.
'use strict';

const DELAY_MS = 400, GAP_X = 14, GAP_Y = 18, EDGE = 8;

function wireHovertip(doc, { delayMs = DELAY_MS, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (h) => clearTimeout(h), view = null } = {}) {
  const win = view || doc.defaultView;
  if (!doc || !doc.body) return null;
  const card = doc.createElement('div');
  card.id = 'hovertip'; card.className = 'more-menu hovertip'; card.setAttribute('role', 'tooltip'); card.hidden = true;   // not aria-hidden: while hovered the element's title is aside, and these are its words
  doc.body.appendChild(card);
  let held = null, timer = null, at = [0, 0];
  // the hovered element's title, moved aside; and put back
  const take = (el) => { const t = el.getAttribute('title'); if (t === null) return; el.removeAttribute('title'); if (t !== '') el.setAttribute('data-tip', t); else el.removeAttribute('data-tip'); };
  const give = (el) => { if (!el || !el.hasAttribute('data-tip')) return; if (!el.hasAttribute('title')) el.setAttribute('title', el.getAttribute('data-tip')); el.removeAttribute('data-tip'); };
  const words = () => (held && held.getAttribute('data-tip')) || '';
  const place = () => {
    const W = win.innerWidth, H = win.innerHeight, r = card.getBoundingClientRect(), w = r.width, h = r.height;
    let x = at[0] + GAP_X, y = at[1] + GAP_Y;
    if (x + w > W - EDGE) x = at[0] - GAP_X - w;
    if (y + h > H - EDGE) y = at[1] - GAP_Y - h;
    x = Math.max(EDGE, Math.min(x, W - EDGE - w)); y = Math.max(EDGE, Math.min(y, H - EDGE - h));
    card.style.left = `${Math.round(x)}px`; card.style.top = `${Math.round(y)}px`;
  };
  const show = () => { timer = null; const t = words(); if (!t) return; card.textContent = t; card.hidden = false; place(); };
  const hide = () => { if (timer !== null) { clearTimer(timer); timer = null; } card.hidden = true; };
  const release = () => { hide(); give(held); held = null; };
  // a title set on the held element while it is hovered (a hint that changes, D267): moved aside again, and the card, if shown, says the new words
  const watch = win && win.MutationObserver ? new win.MutationObserver(() => { if (!held || !held.hasAttribute('title')) return; take(held); if (!card.hidden) { card.textContent = words(); place(); } }) : null;
  const owner = (el) => (el && el.closest ? el.closest('[title], [data-tip]') : null);
  const over = (e) => {
    at = [e.clientX, e.clientY];
    const el = owner(e.target);
    if (el === held) return;
    release();
    if (!el) return;
    held = el; take(el);
    if (watch) { watch.disconnect(); watch.observe(el, { attributes: true, attributeFilter: ['title'] }); }
    timer = setTimer(show, delayMs);
  };
  const move = (e) => { at = [e.clientX, e.clientY]; if (!card.hidden) place(); };
  const out = (e) => { if (!held) return; const to = e.relatedTarget; if (to && held.contains && held.contains(to)) return; if (watch) watch.disconnect(); release(); };
  doc.addEventListener('pointerover', over, true);
  doc.addEventListener('pointermove', move, true);
  doc.addEventListener('pointerout', out, true);
  for (const t of ['pointerdown', 'keydown', 'wheel', 'scroll']) doc.addEventListener(t, hide, true);
  if (win && win.addEventListener) win.addEventListener('blur', hide);
  return { card, hide, delayMs };
}

if (typeof module !== 'undefined') module.exports = { wireHovertip, DELAY_MS };
