// install.js: INSTALL TO AC and SEE IT IN ASSETTO, the app's logic with no DOM (tested headless). index.js mounts it.
//
//   const inst = createInstaller({ build, native, getDoc, getTextures })
//   await inst.root()             -> the Assetto Corsa folder, or null (native get_ac_root: the remembered one, else the one found
//                                    through Steam and then remembered, D250)
//   await inst.chooseRoot(path)   -> remember it (native set_ac_root refuses a folder without content\tracks)
//   await inst.install({ test })  -> { ok, message, folder }: build the export with every check ON, then
//                                    write into <AC>\content\tracks\<folder> (native install_track: t180b_ only, and never
//                                    over a folder the builder did not make). D264: an OPEN track (the build refuses OPEN_LOOP)
//                                    is installed as the TEST export instead, t180b_<name>_test, and the message says so;
//                                    { test: true } (the ⋯ menu's Test export) asks for the test export straight away
// THE BUILD (D239): `build(opts)` is the open track's own export, the core shell's buildExport (app/core/coreshell.js), the SAME call
// the Export button makes, so what is installed is what Export writes, byte for byte; getDoc() gives the name it installs under.
// THE NAME. Every folder the builder writes is t180b_<track name> (src/export/fromwords.js folderName): the prefix is
// added automatically, and the message says so, so a user who names a track "monza" is told it installs as t180b_monza
// and can never overwrite ks_monza.
//
//   const see = createLauncher({ native })
//   await see.enabled()           -> false unless the user turned on the setting "See it in Assetto (launches the game)"
//   await see.run(folder, layout) -> refuses without calling the native side while the setting is off
// The launch itself is native (src-tauri/src/ac.rs): OFF by default, and never run by the builder's tests.
'use strict';

const PREFIX_NOTE = 'the builder names every track t180b_…, so it can never overwrite a track it did not make';

function createInstaller({ build, native, getDoc, getTextures = () => null }) {
  return {
    root: () => native.getAcRoot(),
    async chooseRoot(path) {
      try { return { ok: true, root: await native.setAcRoot(path) }; } catch (e) { return { ok: false, message: String(e.message || e) }; }
    },
    async install({ test = false } = {}) {
      const root = await native.getAcRoot();
      if (!root) return { ok: false, needsRoot: true, message: 'Assetto Corsa was not found through Steam: pick your Assetto Corsa folder (the one that holds content\\tracks); it is remembered' };
      const name = String(getDoc().name || '').trim();
      if (!name || /^untitled$/i.test(name)) return { ok: false, message: 'name the track first (Save, with a name): it installs as t180b_<name>, and an unnamed track would replace the last unnamed one' };
      // D264 (the keeper, 01:34: "it still says the loop is not closed: close it first (one click), then export when i am trying to export the test that isnt finished"):
      // an OPEN track is not refused here: it is built as D243a's TEST export (open, run-off and wall, reds as warnings, folder t180b_<name>_test), the same build
      // the ⋯ menu's Test export makes. A closed track builds as before; a closed track asked for the test export is refused by the build (TEST_CLOSED).
      const refused = (e) => { if (e.name !== 'ExportError') throw e; return { ok: false, message: e.message, reds: e.code === 'RED' ? e.red : null }; };
      const textures = getTextures();
      let out;
      try { out = build(test ? { textures, test: true } : { textures }); } catch (e) {
        if (test || e.name !== 'ExportError' || e.code !== 'OPEN_LOOP') return refused(e);
        test = true;
        try { out = build({ textures, test: true }); } catch (e2) { return refused(e2); }
      }
      const names = [];
      for (const f of out.folders) {
        try { await native.installTrack(f.folder, f.files); } catch (e) { return { ok: false, message: `not installed: ${e.message || e}` }; }
        names.push(f.folder);
      }
      const doc = getDoc();
      // D250: the line says where it went (the whole folder) and that exporting again updates that same folder
      const where = names.map((n) => `${root}\\content\\tracks\\${n}`).join(', ');
      // D250 item 2: a jump the car may fly past is installed, and said (the keeper tunes jumps by driving them); the export's other warnings stay where they were
      const jumps = ((out.result && out.result.warnings) || []).filter((w) => /^jump: /.test(w));
      // D264: the test export says what it is, and how many reds it carries (the exporter's own TEST EXPORT warning)
      const unfinished = test ? `; this track is not closed, so it was exported as an unfinished TEST: the road ends in a run-off and a wall; reds are listed as warnings${((out.result && out.result.warnings) || []).filter((w) => /^TEST EXPORT/.test(w)).map((w) => ` (${w})`).join('')}` : '';
      return { ok: true, folder: names[0], message: `exported "${doc.name || 'untitled'}" into Assetto Corsa as ${names.join(', ')} in ${where}${unfinished}; exporting this track again updates that folder (${PREFIX_NOTE})${jumps.length ? `. ${jumps.join('. ')}` : ''}` };
    },
  };
}

function createLauncher({ native }) {
  return {
    enabled: () => native.getSeeItSetting(),
    async run(folder, layout = '') {
      if (!(await native.getSeeItSetting())) return { ok: false, message: '"See it in Assetto" is off: it launches the game. Turn it on in the settings to use it.' };
      try { return { ok: true, code: await native.seeIt(folder, layout) }; } catch (e) { return { ok: false, message: String(e.message || e) }; }
    },
  };
}

module.exports = { createInstaller, createLauncher, PREFIX_NOTE };
