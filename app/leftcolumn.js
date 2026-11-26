// app/leftcolumn.js: THE LEFT COLUMN CLEARS AWAY (L254). node --test app/test/leftcolumn-page.test.js (the real page in headless Chrome)
// The user's ask, 2026-11-26: the column with the Extend fields at the window's edge, out of the way when the pointer leaves it and back when the pointer returns,
// to give the preview more room. Read as SEE-THROUGH, from that purpose, and he has been told the reading. The cleared opacity is one value, index.html's
// --left-cleared; another reading is a change to that one line.
//   · IT CLEARS when the pointer has been off the column for CLEAR_DELAY_MS (so crossing it does not flicker), once the pointer has been on it at least once (a fresh
//     start shows it until then), and only while nothing holds it (below). Cleared is index.html's #left.cleared: faded to --left-cleared over its .2 s
//     transition (none under prefers-reduced-motion), and every pointer event goes through it to the preview under it, so a click there is the preview's and never
//     presses a button nobody can see.
//   · IT COMES BACK when the pointer reaches the RETURN STRIP (#left-return, made here and sized by index.html), a band at the window's left edge over the column's
//     height that is live only while the column is cleared; and when a hold begins (focus arriving by Tab, a saved piece's ghost). Over the rest of where the column
//     sat, a cleared column stays cleared: that ground is the preview's again, to click and to hover, which is what clearing it is for.
//   · IT IS HELD SHOWN while: the pointer is over it; a field or button in it has KEYBOARD focus (focus that arrived matching :focus-visible: a Tab, or a text field
//     clicked into, a value being edited; a button merely clicked with the mouse does not hold it); a press that began in it is still down (a drag out of a field,
//     the scroll bar); one of its own selects has its list open (select:open); the page's held() says so (index.html: a saved piece's ghost with its Place piece /
//     Cancel piece row up); or the guide points into it (.guide-target on #palette or #validation).
//   · A PRESS WHILE IT FADES BACK IN (within its transition after it was shown again) is swallowed (its mousedown and its click), so a half-drawn button is never
//     pressed. Under reduced motion there is no fade, so nothing is swallowed.
//   · NOTHING IS HIDDEN FROM THE KEYBOARD OR A SCREEN READER: only opacity and pointer events change, so Tab and the accessibility tree reach every field as before.
//     The strip is aria-hidden: it is for the pointer only.
// Nothing here changes what a click on the preview does: the preview's own listeners are untouched, and outside the column's box this module only listens.
'use strict';

const CLEAR_DELAY_MS = 400;

function wireLeftColumn(doc, { held = () => false, subscribe = null, delayMs = CLEAR_DELAY_MS, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (h) => clearTimeout(h), now = () => Date.now(), view = null } = {}) {
  const win = view || (doc && doc.defaultView);
  const left = doc && doc.getElementById('left');
  if (!left) return null;
  const strip = doc.createElement('div');
  strip.id = 'left-return'; strip.setAttribute('aria-hidden', 'true');
  left.after(strip);
  let armed = false, hovered = false, keyboard = false, pressed = false, cleared = false, timer = null, shownAt = -Infinity, swallow = false;
  const inside = (n) => !!n && n !== strip && left.contains(n);
  const visibleFocus = (el) => { try { return el.matches(':focus-visible'); } catch (e) { return true; } };
  // a select's open list: select:open where the browser knows it; else the select having the focus (a list cannot be open on one that has not)
  const selectOpen = () => { try { return !!left.querySelector('select:open'); } catch (e) { const a = doc.activeElement; return !!a && a.tagName === 'SELECT' && inside(a); } };
  const holds = () => hovered || keyboard || pressed || selectOpen() || !!held() || !!left.querySelector('.guide-target');
  // the transition's length, read from the page (0 under reduced motion): a press inside it is swallowed
  const fadeMs = () => { const s = win && win.getComputedStyle ? win.getComputedStyle(left).transitionDuration : ''; return Math.max(0, ...String(s || '0s').split(',').map((x) => parseFloat(x) * (/ms$/.test(x.trim()) ? 1 : 1000) || 0)); };
  const show = () => { if (!cleared) return; cleared = false; left.classList.remove('cleared'); shownAt = now(); };
  const clearNow = () => { timer = null; if (holds() || left.matches(':hover')) return; cleared = true; left.classList.add('cleared'); };
  const update = () => {
    if (holds()) { if (timer !== null) { clearTimer(timer); timer = null; } show(); return; }
    if (armed && !cleared && timer === null) timer = setTimer(clearNow, delayMs);
  };
  const back = (e) => { if (!cleared || (e && e.buttons)) return; hovered = true; armed = true; show(); update(); };   // the strip: not during a drag that began elsewhere
  // where the pointer is: one listener, on every element it moves onto (also when the strip stops catching it, or a fast move skips the column's edge)
  doc.addEventListener('pointerover', (e) => {
    if (e.target === strip) { back(e); return; }
    hovered = inside(e.target); if (hovered) armed = true; update();
  }, true);
  doc.addEventListener('pointerout', (e) => { if (!e.relatedTarget) { hovered = false; update(); } }, true);   // out of the window
  strip.addEventListener('pointermove', back); strip.addEventListener('pointerup', back);
  // the keyboard: focus that arrived visible (a Tab, a text field) holds it; focus leaving the column lets go
  doc.addEventListener('focusin', (e) => { keyboard = inside(e.target) && visibleFocus(e.target); update(); }, true);
  doc.addEventListener('focusout', (e) => { if (!inside(e.relatedTarget)) keyboard = false; update(); }, true);
  // a press that began in the column holds it until let go; one inside the fade back in is swallowed
  doc.addEventListener('pointerdown', (e) => { pressed = inside(e.target); swallow = pressed && now() - shownAt < fadeMs(); update(); }, true);
  const up = () => { if (!pressed) return; pressed = false; update(); };
  if (win && win.addEventListener) { win.addEventListener('pointerup', up, true); win.addEventListener('pointercancel', up, true); }
  const eat = (e) => { if (!swallow) return; e.preventDefault(); e.stopPropagation(); if (e.type === 'click') swallow = false; };
  doc.addEventListener('mousedown', eat, true); doc.addEventListener('click', eat, true);
  // a select's list closing, the guide pointing in or out, and the page's own holds
  doc.addEventListener('change', update, true);
  if (win && typeof win.MutationObserver === 'function') new win.MutationObserver(update).observe(left, { attributes: true, attributeFilter: ['class'], subtree: true });
  if (typeof subscribe === 'function') subscribe(update);
  return { strip, cleared: () => cleared };
}

if (typeof module !== 'undefined') module.exports = { wireLeftColumn, CLEAR_DELAY_MS };
