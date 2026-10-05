// install.js: INSTALL TO AC and SEE IT IN ASSETTO, the app's logic with no DOM (tested headless). index.js mounts it.
//
//   const inst = createInstaller({ build, native, getDoc, getTextures })
//   await inst.root()             -> the remembered Assetto Corsa folder, or null (native get_ac_root)
//   await inst.chooseRoot(path)   -> remember it (native set_ac_root refuses a folder without content\tracks)
//   await inst.install()          -> { ok, message, folder }: build the export with every check ON, then
//                                    write into <AC>\content\tracks\<folder> (native install_track: t180b_ only, and never
//                                    over a folder the builder did not make)
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
    async install() {
      const root = await native.getAcRoot();
      if (!root) return { ok: false, needsRoot: true, message: 'pick your Assetto Corsa folder first (the one that holds content\\tracks); it is remembered' };
      const name = String(getDoc().name || '').trim();
      if (!name || /^untitled$/i.test(name)) return { ok: false, message: 'name the track first (Save, with a name): it installs as t180b_<name>, and an unnamed track would replace the last unnamed one' };
      let out;
      try { out = build({ textures: getTextures() }); } catch (e) {
        if (e.name !== 'ExportError') throw e;
        return { ok: false, message: e.message, reds: e.code === 'RED' ? e.red : null };
      }
      const names = [];
      for (const f of out.folders) {
        try { await native.installTrack(f.folder, f.files); } catch (e) { return { ok: false, message: `not installed: ${e.message || e}` }; }
        names.push(f.folder);
      }
      const doc = getDoc();
      return { ok: true, folder: names[0], message: `installed "${doc.name || 'untitled'}" as ${names.join(', ')} in ${root}\\content\\tracks (${PREFIX_NOTE})` };
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
