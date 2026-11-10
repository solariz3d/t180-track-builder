// app/test/hovertip.test.js: the hover card (app/hovertip.js, D581). node --test app/test/hovertip.test.js
// On a small fake document (the card's look is the page's; texture-page.test.js reads it in every look): what nobody sees by looking.
//   1  over a titled element the title moves to data-tip at once (no Windows tooltip), the card shows its words after the delay, and leaving puts the title back
//   2  inside a titled element (a box in its row) the row's words show; moving between the row and its box neither hides nor restarts the card
//   3  a key, a press, a wheel, a scroll or the window losing focus hides it, and it stays hidden until the pointer enters an element again
//   4  near the window's right and bottom edges the card turns to the pointer's other side and stays wholly inside the window
//   5  a title set while the element is hovered (the turn box's hint) is moved aside again, and the shown card says the new words
//   6  an element with no title shows nothing; the card has no tabindex, is a tooltip, and is drawn as the look draws its menus
//   7  a titled box inside a titled row (the "early" box in its span): while the box is hovered NO element from it up to the document keeps a title (else Windows
//      draws the row's tooltip beside the card; the user, 2026-11-10: "it shows both the designed explanation window, and the auto windows hove window explanation");
//      the card says the box's words, and leaving puts both titles back as they were
//   8  a title set on such a row while its box is hovered (the readout box's reason) is moved aside again, and the one put back on leaving is the new one
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { wireHovertip, DELAY_MS } = require('../hovertip.js');

function fake({ W = 1000, H = 700, cardW = 300, cardH = 60 } = {}) {
  const listeners = {}, winListeners = {}, timers = [];
  const mk = (tag, attrs = {}, parent = null) => {
    const e = { tagName: tag.toUpperCase(), attrs: { ...attrs }, parent, style: {}, hidden: false, textContent: '', children: [], className: '', id: '',
      get parentElement() { return this.parent; },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, setAttribute(k, v) { this.attrs[k] = String(v); if (this.mo) this.mo(k); },
      removeAttribute(k) { delete this.attrs[k]; }, hasAttribute(k) { return k in this.attrs; },
      closest() { for (let p = this; p; p = p.parent) if ('title' in p.attrs || 'data-tip' in p.attrs) return p; return null; },
      contains(o) { for (let p = o; p; p = p.parent) if (p === this) return true; return false; },
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      getBoundingClientRect() { return { width: cardW, height: cardH }; } };
    if (parent) parent.children.push(e);
    return e;
  };
  const body = mk('body');
  // a MutationObserver that reports a title set on an observed element (what hovertip.js asks of it); like the real one it observes several, and disconnect stops all
  class MO { constructor(cb) { this.cb = cb; this.els = []; } observe(el) { this.els.push(el); el.mo = (k) => { if (k === 'title') this.cb([]); }; } disconnect() { for (const el of this.els) el.mo = null; this.els = []; } }
  const win = { innerWidth: W, innerHeight: H, MutationObserver: MO, addEventListener: (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); } };
  const doc = { body, defaultView: win, createElement: (t) => mk(t), addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); } };
  const fire = (t, e) => (listeners[t] || []).forEach((f) => f(e));
  const setTimer = (f, ms) => { timers.push({ f, ms }); return timers.length - 1; }, clearTimer = (h) => { if (timers[h]) timers[h].f = null; };
  const tick = () => { const due = timers.splice(0); for (const t of due) if (t.f) t.f(); };
  const H_ = wireHovertip(doc, { setTimer, clearTimer });
  return { doc, win, body, mk, fire, tick, timers, winListeners, card: H_.card,
    enter: (el, x = 100, y = 100, from = null) => { if (from) fire('pointerout', { target: from, relatedTarget: el }); fire('pointerover', { target: el, clientX: x, clientY: y }); },
    leave: (el, to = body) => fire('pointerout', { target: el, relatedTarget: to }) };
}

test('row 1: over a titled element the title moves aside at once, the card shows its words after the delay, and leaving puts the title back', () => {
  const F = fake(), box = F.mk('input', { title: 'Reach this bank early: …' }, F.body);
  F.enter(box);
  assert.equal(box.getAttribute('title'), null, 'no title while hovered: Windows has nothing to draw');
  assert.equal(box.getAttribute('data-tip'), 'Reach this bank early: …');
  assert.equal(F.card.hidden, true, 'not before the delay');
  assert.equal(F.timers.at(-1).ms, DELAY_MS); assert.equal(DELAY_MS, 400);
  F.tick();
  assert.equal(F.card.hidden, false); assert.equal(F.card.textContent, 'Reach this bank early: …');
  F.leave(box);
  assert.equal(F.card.hidden, true); assert.equal(box.getAttribute('title'), 'Reach this bank early: …', 'the title is back'); assert.equal(box.getAttribute('data-tip'), null);
});

test('row 2: inside a titled row its words show, and moving between the row and its box neither hides nor restarts the card', () => {
  const F = fake(), row = F.mk('span', { title: 'the row says this' }, F.body), box = F.mk('input', {}, row);
  F.enter(box); F.tick(); assert.equal(F.card.textContent, 'the row says this');
  const n = F.timers.length; F.enter(row, 110, 100, box); assert.equal(F.card.hidden, false, 'still shown'); assert.equal(F.timers.length, n, 'no new delay');
  F.leave(row); assert.equal(row.getAttribute('title'), 'the row says this');
});

test('row 3: a key, a press, a wheel, a scroll or the window losing focus hides the card, and it stays hidden until the pointer enters an element again', () => {
  for (const t of ['keydown', 'pointerdown', 'wheel', 'scroll', 'blur']) {
    const F = fake(), a = F.mk('button', { title: 'A' }, F.body);
    F.enter(a); F.tick(); assert.equal(F.card.hidden, false);
    if (t === 'blur') F.winListeners.blur.forEach((f) => f()); else F.fire(t, {});
    assert.equal(F.card.hidden, true, `${t} hides it`);
    F.fire('pointermove', { clientX: 120, clientY: 120 }); F.tick(); assert.equal(F.card.hidden, true, `${t}: moving on the same element does not bring it back`);
    F.leave(a); const b = F.mk('button', { title: 'B' }, F.body); F.enter(b); F.tick(); assert.equal(F.card.hidden, false, `${t}: the next element shows its card`); assert.equal(F.card.textContent, 'B');
  }
});

test('row 4: near the right and bottom edges the card turns to the pointer\'s other side and stays wholly inside the window', () => {
  const F = fake({ W: 1000, H: 700, cardW: 300, cardH: 60 }), a = F.mk('button', { title: 'words' }, F.body);
  F.enter(a, 100, 100); F.tick(); assert.equal(F.card.style.left, '114px'); assert.equal(F.card.style.top, '118px', 'below and right of the pointer');
  F.fire('pointermove', { clientX: 950, clientY: 680 });
  const x = parseFloat(F.card.style.left), y = parseFloat(F.card.style.top);
  assert.equal(x, 950 - 14 - 300, 'left of the pointer'); assert.equal(y, 680 - 18 - 60, 'above it');
  assert.ok(x >= 8 && x + 300 <= 1000 - 8 && y >= 8 && y + 60 <= 700 - 8, `inside the window: ${x}, ${y}`);
  const G = fake({ W: 400, H: 300, cardW: 380, cardH: 280 }), b = G.mk('button', { title: 'a long text' }, G.body);
  G.enter(b, 200, 150); G.tick(); assert.deepEqual([G.card.style.left, G.card.style.top], ['8px', '8px'], 'a card nearly the window\'s size sits at its edge, still inside');
});

test('row 5: a title set while the element is hovered is moved aside again, and the shown card says the new words', () => {
  const F = fake(), box = F.mk('input', { title: 'Reach this turn early: …' }, F.body);
  F.enter(box); F.tick();
  box.setAttribute('title', 'Reach this turn early: … turn 0 eases over the whole piece');
  assert.equal(box.getAttribute('title'), null, 'moved aside again'); assert.equal(F.card.textContent, 'Reach this turn early: … turn 0 eases over the whole piece');
  F.leave(box); assert.equal(box.getAttribute('title'), 'Reach this turn early: … turn 0 eases over the whole piece', 'the new title is the one put back');
});

test('row 6: an element with no title shows nothing; the card has no tabindex, is a tooltip, and is drawn as the look draws its menus', () => {
  const F = fake(), plain = F.mk('div', {}, F.body);
  F.enter(plain); F.tick(); assert.equal(F.card.hidden, true);
  assert.equal(F.card.getAttribute('tabindex'), null); assert.equal(F.card.getAttribute('role'), 'tooltip'); assert.equal(F.card.id, 'hovertip');
  assert.match(F.card.className, /\bmore-menu\b/, 'drawn as the look draws its menus');
});

test('row 7: a titled box inside a titled row: while the box is hovered no element up to the document keeps a title, and leaving puts both back', () => {
  const F = fake(), page = F.mk('div', {}, F.body), row = F.mk('span', { title: 'Reach this bank early: the row' }, page), box = F.mk('input', { title: 'Reach this bank early: the box' }, row);
  F.enter(box);
  for (let p = box; p; p = p.parent) assert.equal(p.getAttribute('title'), null, `no title on <${p.tagName.toLowerCase()}> while the box is hovered: Windows has nothing to draw`);
  F.tick(); assert.equal(F.card.hidden, false); assert.equal(F.card.textContent, 'Reach this bank early: the box', 'the card says the nearest words');
  F.leave(box, page);
  assert.equal(box.getAttribute('title'), 'Reach this bank early: the box'); assert.equal(row.getAttribute('title'), 'Reach this bank early: the row', 'the row\'s title is back');
  assert.equal(box.getAttribute('data-tip'), null); assert.equal(row.getAttribute('data-tip'), null);
  assert.equal(page.getAttribute('title'), null, 'an untitled element stays untitled');
});

test('row 8: a title set on a row while its box is hovered is moved aside again, and the new one is put back on leaving', () => {
  const F = fake(), row = F.mk('div', { title: 'the readout: why' }, F.body), chip = F.mk('span', { title: 'turn: 90' }, row);
  F.enter(chip); F.tick();
  row.setAttribute('title', 'the readout: a new reason');
  assert.equal(row.getAttribute('title'), null, 'moved aside again'); assert.equal(F.card.textContent, 'turn: 90', 'the card still says the chip\'s words');
  F.leave(chip); assert.equal(row.getAttribute('title'), 'the readout: a new reason'); assert.equal(chip.getAttribute('title'), 'turn: 90');
});
