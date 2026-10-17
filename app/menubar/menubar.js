// menubar.js: THE MENUS ON THE TOP BAR (D355, contract M). Every menu is the page's existing drop-down, a <details class="more"> with a .more-menu under its
// <summary> (app/index.html, the look Pieces ▾ and the old ⋯ menu had), so a menu looks and opens exactly as those did. This file only fills them and keeps
// them tidy: it builds a menu's entries each time it opens (so a tick shows the setting as it is now), keeps one menu open at a time, and closes it on
// Esc, on a press outside it, and after a command runs.
//
// CONTRACT M. A part's module exports items(ctx) -> an array of entries; ctx is { doc, win, shell, settings, say }:
//   { label, run, title?, disabled? }        a command: a button; the menu closes, then run(ctx)
//   { label, checked, toggle, title? }       a tick box: checked is a boolean or checked(ctx); toggle(on, ctx); the menu stays open and is rebuilt (so a
//                                            group of ticks can act as a choice of one)
//   { label, panel, title?, disabled? }      a button that opens a panel inside the menu: panel(holder, ctx) runs each time it opens, and what it returns (a
//                                            function, or an object with unmount()) is called when it closes, when the menu closes, and before the menu is rebuilt
//                                            (A's panels return { unmount }; C's lend returns the function that puts its fields back)
//   { section }                              a heading, in the page's h3 style
//   { separator }                            a hairline
//   { node }                                 (the page's own use) an element already on the page, moved in as it is, so its id and wiring stay
//
//   renderItems(doc, box, entries, ctx, { close, refresh, opened })   box's children become the entries; a bad entry throws, by name; opened (an array)
//                                            collects the open panels' closers
//   mountBar(doc, menus, ctx) -> { refresh(id), close(), unmount() }
//       menus: [{ details, slot?, items?, closers? }]: slot (an element in the menu) receives items(ctx) each time the menu opens; closers: elements whose
//       click (a button) or change (a select) closes the menu, for controls already on the page. A menu with no slot (Pieces ▾) only takes part in the
//       one-at-a-time rule. A part whose items(ctx) throws shows its reason in the menu, in red, and the other menus work.
'use strict';

/** Undo a panel: its mount function returned a function, or an object with unmount(), or nothing. */
const unmountOf = (r) => () => { if (typeof r === 'function') r(); else if (r && typeof r.unmount === 'function') r.unmount(); };

function renderItems(doc, box, entries, ctx, { close = () => {}, refresh = () => {}, opened = [] } = {}) {
  if (!Array.isArray(entries)) throw new Error(`MENU_ITEMS: items(ctx) must return an array, got ${entries === null ? 'null' : typeof entries}`);
  const el = (tag, props = {}) => Object.assign(doc.createElement(tag), props);
  const kids = entries.map((it, i) => {
    if (!it || typeof it !== 'object') throw new Error(`MENU_ENTRY: entry ${i} is not an object`);
    if ('separator' in it) return el('hr');
    if ('section' in it) return el('h3', { textContent: String(it.section) });
    if ('node' in it) { if (!it.node || !it.node.nodeType) throw new Error(`MENU_ENTRY: entry ${i}'s node is not an element`); return it.node; }
    const label = String(it.label == null ? '' : it.label);
    if (typeof it.run === 'function') {
      const b = el('button', { type: 'button', textContent: label, title: it.title || '', disabled: !!it.disabled });
      b.onclick = () => { close(); it.run(ctx); };
      return b;
    }
    if (typeof it.toggle === 'function') {
      const box2 = el('input', { type: 'checkbox' }), lab = el('label', { className: 'menu-check', title: it.title || '' });
      box2.checked = !!(typeof it.checked === 'function' ? it.checked(ctx) : it.checked);
      box2.onchange = () => { it.toggle(box2.checked, ctx); refresh(); };
      lab.append(box2, ` ${label}`);
      return lab;
    }
    if (typeof it.panel === 'function') {
      const b = el('button', { type: 'button', textContent: label, title: it.title || '', disabled: !!it.disabled }), holder = el('div', { className: 'menu-panel' });
      holder.hidden = true; let undo = null;
      b.setAttribute('aria-expanded', 'false');
      const shut = () => { if (undo) { const u = undo; undo = null; const k = opened.indexOf(shut); if (k >= 0) opened.splice(k, 1); u(); } holder.hidden = true; b.setAttribute('aria-expanded', 'false'); };
      b.onclick = () => {
        if (!holder.hidden) { shut(); return; }
        holder.hidden = false; b.setAttribute('aria-expanded', 'true');
        undo = unmountOf(it.panel(holder, ctx)); opened.push(shut);
      };
      const wrap = el('div', { className: 'menu-panel-wrap' }); wrap.append(b, holder);
      return wrap;
    }
    throw new Error(`MENU_ENTRY: entry ${i} ("${label}") has none of run, toggle, panel, section, separator or node`);
  });
  box.replaceChildren(...kids);
}

function mountBar(doc, menus, ctx) {
  const list = menus.filter((m) => m && m.details);
  const inside = (root, t) => { for (let e = t; e; e = e.parentNode) if (e === root) return true; return false; };
  const closeAll = (except) => { for (const m of list) if (m.details !== except && m.details.open) m.details.open = false; };
  const shutPanels = (m) => { for (const shut of (m.opened || []).slice()) { try { shut(); } catch (e) { console.error(`a menu panel did not close cleanly: ${e && e.message}`); } } m.opened = []; };
  const fill = (m) => {
    if (!m.slot || typeof m.items !== 'function') return;
    shutPanels(m);
    const close = () => { m.details.open = false; }, refresh = () => fill(m);
    try { renderItems(doc, m.slot, m.items(ctx), ctx, { close, refresh, opened: (m.opened = []) }); }
    catch (e) {
      const p = doc.createElement('p'); p.className = 'message'; p.textContent = `This menu could not be built: ${e && e.message ? e.message : e}`;
      m.slot.replaceChildren(p);
    }
  };
  const offs = [];
  for (const m of list) {
    const onToggle = () => { if (m.details.open) { closeAll(m.details); fill(m); } else shutPanels(m); };   // a closed menu's panels give their controls back
    m.details.addEventListener('toggle', onToggle); offs.push(() => m.details.removeEventListener('toggle', onToggle));
    for (const c of m.closers || []) {
      if (!c) continue;
      const ev = c.tagName === 'SELECT' ? 'change' : 'click', fn = () => { m.details.open = false; };
      c.addEventListener(ev, fn); offs.push(() => c.removeEventListener(ev, fn));
    }
  }
  const onKey = (e) => { if (e.key === 'Escape' && list.some((m) => m.details.open)) closeAll(null); };
  const onDown = (e) => { for (const m of list) if (m.details.open && !inside(m.details, e.target)) m.details.open = false; };
  doc.addEventListener('keydown', onKey, true); doc.addEventListener('pointerdown', onDown, true);
  return {
    refresh: (id) => { for (const m of list) if (m.details.id === id && m.details.open) fill(m); },
    close: () => closeAll(null),
    unmount: () => { for (const m of list) shutPanels(m); for (const f of offs) f(); doc.removeEventListener('keydown', onKey, true); doc.removeEventListener('pointerdown', onDown, true); },
  };
}

module.exports = { renderItems, mountBar };
