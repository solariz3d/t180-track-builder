// app/askdialog.js: a question asked inside the page, in the builder's own look (2026-10-14, Sigil). node --test app/test/askdialog.test.js
//
// Replaces the native Windows message box for "save before closing?". askChoice() shows a centred card over a dimmed page
// and resolves with the value of the button pressed. Escape and a click on the dimmed page answer `cancelValue`; Enter
// presses the button marked default. Only one question is open at a time: a second ask while one is open gets the open one's
// answer (a second X while the prompt is up is already ignored by app/closer.js; this keeps the card single either way).
'use strict';

function askChoice(doc, { title = '', message = '', buttons = [], cancelValue = null } = {}) {
  if (!doc || !doc.body) return Promise.reject(new Error('askChoice: no document to ask in'));
  if (!buttons.length) return Promise.reject(new Error('askChoice: no buttons to answer with'));
  if (askChoice.open) return askChoice.open;
  const veil = doc.createElement('div'); veil.className = 'ask-veil';
  const card = doc.createElement('div'); card.className = 'ask-card'; card.setAttribute('role', 'alertdialog'); card.setAttribute('aria-modal', 'true');
  const h = doc.createElement('h2'); h.textContent = title;
  const p = doc.createElement('p'); p.textContent = message;
  const row = doc.createElement('div'); row.className = 'ask-row';
  card.appendChild(h); card.appendChild(p); card.appendChild(row); veil.appendChild(card);
  const before = doc.activeElement;
  let done;
  const finish = (v) => {
    doc.removeEventListener('keydown', onKey, true);
    try { veil.remove(); } catch (e) { /* already gone */ }
    askChoice.open = null;
    try { if (before && before.focus) before.focus(); } catch (e) { /* the old focus is gone */ }
    done(v);
  };
  let first = null;
  for (const b of buttons) {
    const el = doc.createElement('button'); el.textContent = b.label; el.className = b.kind ? `ask-${b.kind}` : '';
    el.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); finish(b.value); };
    row.appendChild(el);
    if (b.default || !first) first = el;   // the button marked default, else the first
  }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(cancelValue); }
    else if (e.key === 'Enter' && (!doc.activeElement || doc.activeElement.parentNode !== row)) { e.preventDefault(); e.stopPropagation(); first.onclick(e); }
    else e.stopPropagation();   // the builder's own keys (WASD, Ctrl+Z) must not act behind the question
  };
  veil.onclick = (e) => { if (e && e.target === veil) finish(cancelValue); };
  askChoice.open = new Promise((r) => { done = r; });
  doc.addEventListener('keydown', onKey, true);
  doc.body.appendChild(veil);
  try { first.focus(); } catch (e) { /* no focus in a test document */ }
  return askChoice.open;
}
askChoice.open = null;

if (typeof module !== 'undefined') module.exports = { askChoice };
