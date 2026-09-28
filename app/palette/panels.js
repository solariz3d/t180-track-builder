// panels.js: mount one of C's or E's panels (app/README.md, "The seam") into its area, and make a failure VISIBLE.
//
//   const r = await mountPanel(root, 'preview', () => loadCjs('app/preview/index.js', get), shell);   // { ok, error }
//
// Three outcomes, told apart:
// - The module is not there yet (the loader's 404): a quiet note, "app/<name> is not plugged in yet". That is an
//   unfinished app, not a broken one.
// - It is there but fails: it does not load (a syntax error, a file it needs is missing), exports no mount, or its mount
//   throws, rejects, or returns an Error or { error }. The area shows "The <name> could not start: <why>" as an alert.
//   A broken preview used to show nothing at all.
// - It mounts: the area is the panel's, and nothing of ours is left in it.
'use strict';

const TITLE = { preview: 'preview', camera: 'camera', 'validate-ui': 'validation panel', handles: 'handles panel', share: 'share codes', install: 'install to AC', texture: 'textures panel' };
const NOT_THERE = /could not load app\/[^:]+\/index\.js: 404/;

function show(root, cls, text, alert) {
  const p = document.createElement('p');
  p.className = cls;
  if (alert) p.setAttribute('role', 'alert');
  p.textContent = text;
  root.replaceChildren(p);
}

async function mountPanel(root, name, load, shell) {
  const title = TITLE[name] || name;
  const fail = (why) => { show(root, 'panel-error', `The ${title} could not start: ${why}`, true); return { ok: false, error: why }; };
  let m;
  try { m = await load(); } catch (e) {
    const why = e && e.message ? e.message : String(e);
    if (NOT_THERE.test(why)) { show(root, 'empty', `app/${name} is not plugged in yet.`, false); return { ok: false, error: why, missing: true }; }
    return fail(why);
  }
  if (!m || typeof m.mount !== 'function') return fail('it exports no mount(root, shell)');
  root.replaceChildren();
  let r;
  try { r = await m.mount(root, shell); } catch (e) { return fail(e && e.message ? e.message : String(e)); }
  if (r instanceof Error) return fail(r.message);
  if (r && typeof r === 'object' && r.error) return fail(typeof r.error === 'string' ? r.error : r.error.message || String(r.error));
  return { ok: true };
}

module.exports = { mountPanel };
