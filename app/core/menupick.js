// menupick.js: A CHOICE THE PAGE DRAWS, for a choice that sits inside a menu. A native <select>'s open list is a pop-up the WebView draws, and in this
// frameless window it painted the page behind it through its rows (the menu's own buttons showed through); a menu's choices are drawn here instead, in the
// menu's own look (app/index.html .menu-pick, the rows as File ▸ Open…'s).
//
//   menuPick(doc, attrs = {}, options = []) -> element
//
// It answers as a select does, so the code around it is unchanged: value (read and set; setting it never calls onchange, and a value no option has reads
// back as ''), options ([{ value, text }]), selectedIndex, replaceChildren(...) and append(...) of Option objects, <option> elements or { value, text,
// selected }, disabled, and onchange, called with { target } after a pick that changes the value. The head shows the chosen text; a click on it unfolds the
// rows below it (again: folds them); the arrows move between them, Enter or a click picks one, and the rows fold.
'use strict';

const norm = (o) => ({ value: String(o.value ?? ''), text: String(o.text ?? o.textContent ?? o.value ?? ''), selected: !!o.selected });

function menuPick(doc, attrs = {}, options = []) {
  const box = doc.createElement('div'), head = doc.createElement('button'), rows = doc.createElement('div');
  const put = box.append.bind(box);
  box.setAttribute('class', 'menu-pick');
  for (const [k, v] of Object.entries(attrs)) box.setAttribute(k, v);
  head.setAttribute('class', 'menu-pick-head'); head.setAttribute('type', 'button'); head.setAttribute('aria-haspopup', 'listbox'); head.setAttribute('aria-expanded', 'false');
  rows.setAttribute('class', 'menu-rows'); rows.setAttribute('role', 'listbox'); rows.hidden = true;
  put(head, rows);
  let opts = [], cur = '', off = false;
  const textOf = () => { const o = opts.find((x) => x.value === cur); return o ? o.text : ''; };
  const showHead = () => { head.textContent = `${textOf()} ▾`; };
  const fold = () => { rows.hidden = true; rows.replaceChildren(); head.setAttribute('aria-expanded', 'false'); };
  const focus = (e) => { if (e && typeof e.focus === 'function') e.focus(); };
  const pick = (v) => {
    fold(); focus(head);
    if (v === cur) return;
    cur = v; showHead();
    if (typeof box.onchange === 'function') box.onchange({ target: box });
  };
  const rowEls = () => rows.children ? [...rows.children] : [];
  // the menu it sits in (its <details>): when that closes, the rows fold, as File ▸ Open…'s do (app/index.html rowList); found when the rows first unfold, since the
  // choice is made before it is placed in a menu
  let menu = null;
  const watchMenu = () => { const d = typeof box.closest === 'function' ? box.closest('details') : null; if (!d || d === menu) return; menu = d; d.addEventListener('toggle', () => { if (!d.open) fold(); }); };
  const unfold = () => {
    if (off) return;
    watchMenu();
    rows.replaceChildren(...opts.map((o) => {
      const r = doc.createElement('div');
      r.setAttribute('class', 'menu-row'); r.setAttribute('role', 'option'); r.setAttribute('aria-selected', String(o.value === cur));
      r.tabIndex = 0; r.textContent = o.text; r.dataset && (r.dataset.value = o.value);
      r.onclick = () => pick(o.value);
      return r;
    }));
    rows.hidden = false; head.setAttribute('aria-expanded', 'true');
  };
  const step = (by) => {
    const list = rowEls(); if (!list.length) return;
    const i = list.indexOf(doc.activeElement), at = i < 0 ? Math.max(0, opts.findIndex((o) => o.value === cur)) : i + by;
    if (at < 0) { focus(head); return; }
    focus(list[Math.min(list.length - 1, at)]);
  };
  head.onclick = () => { if (rows.hidden) unfold(); else fold(); };
  head.onkeydown = (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); if (rows.hidden) unfold(); step(0); } };
  rows.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); step(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter') { const r = doc.activeElement; if (r && rowEls().includes(r)) { e.preventDefault(); r.click(); } }
  };
  const setOpts = (list) => {
    const was = opts.length; opts = list.map(norm);
    const chosen = opts.find((o) => o.selected);
    if (chosen && !was) cur = chosen.value;
    else if (!opts.some((o) => o.value === cur)) cur = opts.length ? opts[0].value : '';
    if (!rows.hidden) unfold();
    showHead();
  };
  box.replaceChildren = (...k) => setOpts(k.flat());
  box.append = (...k) => setOpts([...opts, ...k.flat()]);
  Object.defineProperty(box, 'value', { get: () => cur, set: (v) => { const s = String(v ?? ''); cur = opts.some((o) => o.value === s) ? s : ''; showHead(); if (!rows.hidden) unfold(); }, configurable: true });
  Object.defineProperty(box, 'options', { get: () => opts.map((o) => ({ value: o.value, text: o.text })), configurable: true });
  Object.defineProperty(box, 'selectedIndex', { get: () => opts.findIndex((o) => o.value === cur), configurable: true });
  Object.defineProperty(box, 'disabled', { get: () => off, set: (v) => { off = !!v; head.disabled = off; if (off) fold(); }, configurable: true });
  setOpts(options);
  return box;
}

module.exports = { menuPick };
