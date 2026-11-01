// exportbanner.js: THE EXPORT BANNER, one for every export route (File ▸ Export, Export to Assetto Corsa, Test export, Export layouts, Export for Blender).
// The header's status line and the install note were too small to notice over an export of a minute or more, so nothing said an export was running or
// that it had finished. The banner is the look's own menu panel (the `more-menu` class, as the hover
// card is), fixed under the header, never focused (role status, no tabindex, nothing in it takes focus).
//
//   const banner = createExportBanner(box, { doc, now, every })
//   banner.run(detail)      -> "Exporting…" and the seconds since the export began, ticking; `detail` (where it goes) under it
//   banner.done(text)       -> "Done" in the look's accent, `text` (the route's own result: where it went) under it
//   banner.fail(text)       -> "Export failed" in the look's warning red, `text` (the route's own reason) under it
//   banner.follow(text)     -> for a route that reports through one `say(text)`: a text starting "exporting", "building" or "writing" runs the banner; while it
//                              runs, a text starting "exported" ends it as done and any other text ends it as failed. Before it runs (cancelled, no folder
//                              picked) a text leaves the banner alone
//   banner.clear()          -> hidden
//   banner.state            -> 'idle' | 'running' | 'done' | 'failed'
// A finished banner stays until it is clicked or until the next action: the next pointer press or key anywhere on the page, or the next export.
'use strict';

function createExportBanner(box, { doc = typeof document !== 'undefined' ? document : null, now = () => Date.now(), every = (fn, ms) => setInterval(fn, ms), stop = (h) => clearInterval(h) } = {}) {
  const make = (cls) => { const e = doc.createElement('span'); e.className = cls; return e; };
  const head = make('eb-head'), text = make('eb-text');
  box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
  box.replaceChildren(head, text); box.hidden = true;
  let state = 'idle', t0 = 0, tick = null, armed = false;
  const secs = () => Math.max(0, Math.floor((now() - t0) / 1000));
  const show = (s, h, t) => {
    state = s; head.textContent = h; text.textContent = t || ''; box.className = `more-menu export-banner ${s}`; box.hidden = false;
  };
  const halt = () => { if (tick !== null) { stop(tick); tick = null; } };
  // the next action ends a finished banner: armed after the result is shown, so the press that started the export never counts
  const onAction = (e) => { if (state === 'done' || state === 'failed') { if (e && e.target && box.contains && box.contains(e.target)) return; api.clear(); } };
  const arm = () => { if (armed || !doc || typeof doc.addEventListener !== 'function') return; armed = true; doc.addEventListener('pointerdown', onAction, true); doc.addEventListener('keydown', onAction, true); };
  const disarm = () => { if (!armed) return; armed = false; doc.removeEventListener('pointerdown', onAction, true); doc.removeEventListener('keydown', onAction, true); };
  const finish = (s, h, t) => { halt(); show(s, h, t); arm(); };
  const api = {
    get state() { return state; },
    run(detail = '') {
      disarm();
      if (state !== 'running') { t0 = now(); halt(); tick = every(() => { head.textContent = `Exporting… ${secs()} s`; }, 1000); }
      show('running', `Exporting… ${secs()} s`, detail);
    },
    done(t) { finish('done', 'Done', t); },
    fail(t) { finish('failed', 'Export failed', t); },
    clear() { halt(); disarm(); state = 'idle'; box.hidden = true; },
    follow(t) {
      const s = String(t == null ? '' : t);
      if (/^(exporting|building|writing)\b/i.test(s)) return api.run(s);
      if (state !== 'running') return;
      if (/^exported\b/i.test(s)) api.done(s); else api.fail(s);
    },
  };
  box.onclick = () => { if (state === 'done' || state === 'failed') api.clear(); };
  return api;
}

module.exports = { createExportBanner };
