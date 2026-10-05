// closer.test.js: node --test app/test/closer.test.js   (D192: "when I try to close track builder the X does nothing")
// The window's ONE close handler (app/closer.js). The Tauri side is modelled from its source (tauri-2.12.0): a window with ANY script
// close listener has its close PREVENTED and waits for the listener to call destroy(); the script wrapper `onCloseRequested` awaits the
// handler and calls destroy() only if it returned (a throwing handler leaves the window open); and the listener registry belongs to the
// webview, so a page reload keeps the old page's registration with its callback gone. The REAL window is proved separately (the hand-back:
// WM_CLOSE to an off-screen build, before and after). Here the same five cases run against the page as it WAS and as it is now.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeCloseHandler, installCloseHandler } = require('../closer.js');

/** The Tauri side. `page()` is the current page's window object; `reload()` replaces the page and keeps the registry. */
function tauri() {
  const t = { registry: [], destroyed: false, destroyCalls: 0, gen: 0 };
  t.reload = () => { t.gen++; };   // src/event/listener.rs: listeners are removed when the webview is destroyed, not when its page reloads
  t.page = () => {
    const gen = t.gen, win = {
      onCloseRequested(handler) {   // the script wrapper: await the handler, destroy unless it prevented the default
        t.registry.push({ gen, run: async () => { const evt = { p: false, preventDefault() { this.p = true; }, isPreventDefault() { return this.p; } }; await handler(evt); if (!evt.isPreventDefault()) await win.destroy(); } });
        return Promise.resolve(() => {});
      },
      async destroy() { t.destroyCalls++; t.destroyed = true; },
    };
    return win;
  };
  /** The X. No script listener: the default close proceeds. Any listener: the close is prevented, and only listeners whose page still exists answer. */
  t.x = async () => {
    if (t.registry.length === 0) { t.destroyed = true; return; }
    await Promise.all(t.registry.filter((l) => l.gen === t.gen).map((l) => l.run().catch(() => { /* a rejected wrapper never reaches destroy */ })));
  };
  return t;
}
/** The page BEFORE D192: only the pieces builder registered a handler, async, awaiting its cleanup. */
function oldPage(t, mode, cleanup) { const win = t.page(); if (mode === 'pieces') win.onCloseRequested(async () => { await cleanup(); }); }
/** The page NOW: the one handler is registered before the mode branch; the mode sets the cleanup. */
function newPage(t, mode, cleanup, opts = {}) { let closeCleanup = null; installCloseHandler(t.page(), () => closeCleanup, { log: () => {}, ...opts }); if (mode === 'pieces') closeCleanup = cleanup; }

const ok = async () => {};
const failing = async () => { throw new Error('autosave failed'); };
const CASES = {
  'close in core (a fresh start)': (make, t) => { make(t, 'core', ok); },
  'close in pieces': (make, t) => { make(t, 'pieces', ok); },
  'close after switching pieces -> core': (make, t) => { make(t, 'pieces', ok); t.reload(); make(t, 'core', ok); },
  'close after switching core -> pieces': (make, t) => { make(t, 'core', ok); t.reload(); make(t, 'pieces', ok); },
  'close after core -> pieces -> core -> pieces -> core': (make, t) => { ['core', 'pieces', 'core', 'pieces', 'core'].forEach((m, i) => { if (i) t.reload(); make(t, m, ok); }); },
  'close in pieces with a failing autosave': (make, t) => { make(t, 'pieces', failing); },
  'close in core after a pieces page whose autosave fails': (make, t) => { make(t, 'pieces', failing); t.reload(); make(t, 'core', ok); },
};
// what the page did before: these are the reproducers (red is the FAULT, so the assertion states the fault)
const WAS = { 'close in core (a fresh start)': true, 'close in pieces': true, 'close after switching pieces -> core': false, 'close after switching core -> pieces': true,
  'close after core -> pieces -> core -> pieces -> core': false, 'close in pieces with a failing autosave': false, 'close in core after a pieces page whose autosave fails': false };
for (const [name, build] of Object.entries(CASES)) {
  test(`REPRODUCER (the page as it was): ${name} ${WAS[name] ? 'closes' : 'is TRAPPED: the X does nothing'}`, async () => {
    const t = tauri(); build(oldPage, t); await t.x();
    assert.equal(t.destroyed, WAS[name], WAS[name] ? 'the old page should have closed here' : 'the old page should have trapped the window here');
  });
  test(`the window closes, destroyed exactly once: ${name}`, async () => {
    const t = tauri(); build(newPage, t); await t.x();
    assert.equal(t.destroyed, true, 'the X did nothing');
    assert.equal(t.destroyCalls <= 1, true, `destroy() ran ${t.destroyCalls} times`);
  });
}

test('the pieces cleanup RUNS on close, before the window is destroyed (the autosave is flushed or cleared first)', async () => {
  const order = []; let handler; const win = { onCloseRequested(h) { handler = h; return Promise.resolve(); }, destroy: async () => { order.push('destroy'); } };
  installCloseHandler(win, () => async () => { order.push('cleanup'); });
  await handler({ preventDefault() {} }); assert.deepEqual(order, ['cleanup', 'destroy']);
});
test('core has nothing to clean up: the handler destroys straight away', async () => {
  const t = tauri(); let called = 0; newPage(t, 'core', () => { called++; }); await t.x();
  assert.equal(called, 0); assert.equal(t.destroyed, true); assert.equal(t.destroyCalls, 1);
});
test('a cleanup that throws is logged and the window still closes', async () => {
  const t = tauri(), logs = []; newPage(t, 'pieces', failing, { log: (m) => logs.push(m) }); await t.x();
  assert.equal(t.destroyed, true); assert.equal(logs.length, 1); assert.match(logs[0], /autosave failed/);
});
test('a cleanup that HANGS cannot hold the window: it closes after the timeout', async () => {
  const t = tauri(), logs = []; newPage(t, 'pieces', () => new Promise(() => {}), { timeoutMs: 40, log: (m) => logs.push(m) });
  const t0 = Date.now(); await t.x();
  assert.equal(t.destroyed, true); assert.ok(Date.now() - t0 >= 35, 'it did not wait for the cleanup at all'); assert.match(logs.join(' '), /closing anyway/);
});
test('a destroy() that fails is logged, never thrown out of the handler', async () => {
  const logs = []; const win = { destroy: async () => { throw new Error('no permission'); } };
  await assert.doesNotReject(makeCloseHandler(win, { cleanup: ok, log: (m) => logs.push(m) })({ preventDefault() {} }));
  assert.match(logs.join(' '), /destroy failed: no permission/);
});
test('the handler prevents the wrapper\'s own destroy (it destroys once, itself), and tolerates an event with no preventDefault', async () => {
  let prevented = false, destroys = 0; const win = { destroy: async () => { destroys++; } };
  await makeCloseHandler(win, { cleanup: ok })({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(destroys, 1);
  await assert.doesNotReject(makeCloseHandler(win, { cleanup: ok })({})); assert.equal(destroys, 2);
  await assert.doesNotReject(makeCloseHandler(win, { cleanup: ok })(undefined));
});
test('installCloseHandler off Tauri (no window, or no onCloseRequested) registers nothing and does not throw', () => {
  assert.equal(installCloseHandler(null, () => null), null); assert.equal(installCloseHandler({}, () => null), null);
});
test('the cleanup is read at CLOSE time: a mode that sets it after registration is honoured, and a mode that clears it is too', async () => {
  const t = tauri(); let closeCleanup = null, calls = 0; installCloseHandler(t.page(), () => closeCleanup, { log: () => {} });
  closeCleanup = async () => { calls++; }; await t.x(); assert.equal(calls, 1);
});

// ── the page's wiring (the real window proves it end to end; this keeps the structure from regressing) ──
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// D239: the mode branch is gone (one builder); the invariant it guarded stays: the handler is registered before the builder starts
test('app/index.html registers the close handler BEFORE the builder starts, so a builder that fails to start still has it', () => {
  const at = HTML.indexOf('installCloseHandler'), start = HTML.indexOf('  await startCore();');
  assert.ok(at > 0 && start > 0 && at < start, `installCloseHandler at ${at}, the builder's start at ${start}`);
});
test('app/index.html has ONE close registration path (the closer, and a bare destroy-only fallback): the old pieces-only listener is gone', () => {
  assert.equal((HTML.match(/onCloseRequested\(/g) || []).length, 1, 'onCloseRequested( appears once, in the fallback');
  assert.match(HTML, /win\.onCloseRequested\(async \(ev\) => \{ ev\.preventDefault\(\); try \{ await win\.destroy\(\)/);
  assert.match(HTML, /closeCleanup = async \(\) => \{ if \(!shell\.getState\(\)\.dirty\) await shell\.cleanExit\(\); else await shell\.flushAutosave\(\); \};/);
});

// ── unsaved work: the X asks Save / Don't save / Cancel (the keeper, 2026-10-03) ──
const withAsk = (choice, save) => { const t = tauri(), calls = { save: 0 }; installCloseHandler(t.page(), () => null, { log: () => {}, ask: async () => choice, save: async () => { calls.save++; return save(); } }); return { t, calls }; };
test('nothing unsaved (ask returns null): the X closes at once, with no save', async () => {
  const { t, calls } = withAsk(null, () => true); await t.x(); assert.deepEqual([t.destroyed, calls.save], [true, 0]);
});
test('Cancel: the window stays open and nothing is saved', async () => {
  const { t, calls } = withAsk('cancel', () => true); await t.x(); assert.deepEqual([t.destroyed, calls.save], [false, 0]);
});
test('Don\'t save: the window closes without saving', async () => {
  const { t, calls } = withAsk('discard', () => true); await t.x(); assert.deepEqual([t.destroyed, calls.save], [true, 0]);
});
test('Save: it saves, then the window closes', async () => {
  const { t, calls } = withAsk('save', () => true); await t.x(); assert.deepEqual([t.destroyed, calls.save], [true, 1]);
});
test('Save that does not save (no name yet): the window stays open, so the work is not lost', async () => {
  const { t, calls } = withAsk('save', () => false); await t.x(); assert.deepEqual([t.destroyed, calls.save], [false, 1]);
});
test('Save that THROWS: the window stays open; the next X asks again, and Don\'t save then closes', async () => {
  const t = tauri(); let choice = 'save';
  installCloseHandler(t.page(), () => null, { log: () => {}, ask: async () => choice, save: async () => { throw new Error('disk full'); } });
  await t.x(); assert.equal(t.destroyed, false);
  choice = 'discard'; await t.x(); assert.equal(t.destroyed, true);
});
test('a prompt that THROWS (no dialog, a refused permission): the window closes as before, it is never trapped', async () => {
  const t = tauri(); installCloseHandler(t.page(), () => null, { log: () => {}, ask: async () => { throw new Error('dialog.message not allowed'); } });
  await t.x(); assert.equal(t.destroyed, true);
});
test('a second X while the prompt is open is ignored: one prompt, one close', async () => {
  const t = tauri(); let release, asks = 0; const answered = new Promise((r) => { release = r; });
  installCloseHandler(t.page(), () => null, { log: () => {}, ask: async () => { asks++; await answered; return 'discard'; } });
  const first = t.x(), second = t.x(); release(); await Promise.all([first, second]);
  assert.deepEqual([asks, t.destroyCalls], [1, 1]);
});
// D239: one builder, so closeDirty is set once (it was set in the core and the pieces branch, 2)
test('app/index.html gives the closer the prompt, and the builder says whether there is unsaved work', () => {
  assert.match(HTML, /installCloseHandler\(win, \(\) => closeCleanup, \{ ask: closeAsk, save: closeSave \}\)/);
  assert.equal((HTML.match(/closeDirty = \(\) => !!shell\.getState\(\)\.dirty;/g) || []).length, 1, 'set by the equation builder');
  // the plugin COMMAND, as the Export picker calls it: tauri-plugin-dialog 2.8.0 injects no window.__TAURI__.dialog
  assert.match(HTML, /call\('plugin:dialog\|message', \{[^}]*buttons: \{ YesNoCancelCustom: \['Save', "Don't save", 'Cancel'\] \}/);
  assert.doesNotMatch(HTML, /__TAURI__\.dialog/);
});
test('the window may show the prompt: dialog:allow-message is in its capability', () => {
  const cap = fs.readdirSync(path.join(__dirname, '..', '..', 'src-tauri', 'capabilities')).map((f) => fs.readFileSync(path.join(__dirname, '..', '..', 'src-tauri', 'capabilities', f), 'utf8')).join('\n');
  assert.match(cap, /"dialog:allow-message"/);
});
