// grips.cjs: the GRIP REFERENCE (D261, the keeper 21:18: "LIKE how we took the width reference of other tracks, perhaps do the same with the friction for
// users to see which tracks they want to emulate grip"), for the "Grip like…" drop-down beside the Grip field. NUMBERS ONLY: a track's name, the surface
// KEY its drivable road uses, the FRICTION AC reads for it as a percent, and the file the number came from (relative to the AC folder); never a copy of
// an author's file.
//   node tools/grips.cjs <AC folder> > src/doc/grips.json
// The AC folder is not in the repo, so this is the corpus.json / widths.json pattern: the JSON is committed, and test/grips.test.js rebuilds it from the AC
// folder when one is given (T180_AC_ROOT), and pins the committed numbers otherwise.
//
// THE NUMBER: the FRICTION of the [SURFACE_n] whose KEY is the row's key, in content/tracks/<folder>/data/surfaces.ini (read only). A track that does NOT
// redefine ROAD in its own file drives on AC's own ROAD, system/data/surfaces.ini (FRICTION 1 on a stock install): the row says so (source: the system file).
// Most T-180 tracks are that case (only PIT and RUNOFF are their own). percent = FRICTION × 100, kept to one decimal (Red Bull Ring's road is 0.995);
// `value` is the whole percent the Grip field takes (it is an integer, 50 to 150).
// THE KEY each row names is chosen by hand from the survey of the installed tracks (exo_memory/loop/grip_research_2026-10-06.md): the surface the racing
// line drives on (ROAD where a track defines it; a Kunos track's own asphalt key otherwise). It is a reading of key names, not of mesh names (the kn5 was
// not read), and says so in `basis`.
// NEVER LISTED: a private project's track (the survey hid it by name, and this list does not carry it).
'use strict';
const fs = require('fs'), path = require('path');

// [the track's folder (and layout) under content/tracks, the name the drop-down shows, the road KEY], in the keeper's order: the T-180 tracks the width
// list already uses, then the CSP-collision T-180 tracks, then Kunos's own
const ROWS = [
  ['thunderhead_raceway/normal', 'Thunderhead', 'ROAD'],
  ['cash_auroracryopticon/aurora_medium', 'Aurora Cryopticon', 'ROAD'],
  ['ohyeah2389_nordic', 'Nordic', 'ROAD'],
  ['ohyeah2389_nordic', 'Nordic (its SLOW surface)', 'SLOW'],
  ['sakura_speedway', 'Sakura Speedway', 'ROAD'],
  ['hazenloop', 'Hazen Loop', 'ROAD'],
  ['centrifuge', 'Centrifuge', 'ROAD'],
  ['serpents_spiral', 'Serpents Spiral', 'ROAD'],
  ['rainbow_rd', 'Rainbow Road', 'ROAD'],
  ['Chases_Onuris/layout_long', 'Onuris', 'ROAD'],
  ['ThunderHead(Wii Version)', 'ThunderHead (Wii)', 'ROAD'],
  ['ks_barcelona/layout_gp', 'Barcelona', 'TRM-BRC'],
  ['ks_brands_hatch/gp', 'Brands Hatch', 'ASPH_BRANDS'],
  ['ks_drag/drag1000', 'Drag strip (start)', 'START'],
  ['ks_highlands/layout_long', 'Highlands', 'PAVE'],
  ['ks_laguna_seca', 'Laguna Seca', 'ROAD'],
  ['ks_monza66/road', 'Monza 1966', 'TARMHIST'],
  ['ks_nordschleife/nordschleife', 'Nordschleife', 'TRM-NRM'],
  ['ks_nurburgring/layout_gp_a', 'Nürburgring GP', 'ASPH-NURB'],
  ['ks_red_bull_ring/layout_gp', 'Red Bull Ring', 'ASPRBRING'],
  ['ks_silverstone/gp', 'Silverstone', 'TARMSIL_A_'],
  ['ks_silverstone1967', 'Silverstone 1967', 'ASPH_SILV'],
  ['ks_zandvoort', 'Zandvoort', 'TRM-ZNDV'],
];

/** The [SURFACE_n] sections of a surfaces.ini text: [{ key, friction }]. Comments (;) and blank lines are skipped. */
function surfaces(text) {
  const out = []; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, '').trim(); if (!l) continue;
    const m = /^\[(.+)\]$/.exec(l); if (m) { cur = /^SURFACE_\d+$/i.test(m[1].trim()) ? {} : null; if (cur) out.push(cur); continue; }
    const kv = /^([^=]+)=(.*)$/.exec(l); if (kv && cur) cur[kv[1].trim().toUpperCase()] = kv[2].trim();
  }
  return out.map((s) => ({ key: s.KEY, friction: Number(s.FRICTION) }));
}

/** The reference from an AC folder. Throws, naming the row, when a row's file or key is not there (the list must match the install it is built from). */
function build(acRoot) {
  const read = (rel) => fs.readFileSync(path.join(acRoot, rel), 'utf8');
  const system = surfaces(read('system/data/surfaces.ini')).find((s) => s.key === 'ROAD');
  if (!system || !Number.isFinite(system.friction)) throw new Error('grips: AC\'s system/data/surfaces.ini has no ROAD friction');
  const tracks = ROWS.map(([folder, name, key]) => {
    const rel = `content/tracks/${folder}/data/surfaces.ini`;
    const own = surfaces(read(rel)).find((s) => s.key === key);
    let friction, source;
    if (own) { friction = own.friction; source = `${rel} (KEY=${key})`; }
    else if (key === 'ROAD') { friction = system.friction; source = `system/data/surfaces.ini (KEY=ROAD: ${folder} does not redefine ROAD)`; }
    else throw new Error(`grips: ${rel} has no surface with KEY=${key}`);
    if (!Number.isFinite(friction)) throw new Error(`grips: ${source} has no numeric FRICTION`);
    const percent = Math.round(friction * 1000) / 10;
    return { name, key, friction, percent, value: Math.round(percent), source, basis: 'the road key chosen by name from the track\'s surfaces.ini (the mesh names were not read)' };
  });
  return { made_by: 'tools/grips.cjs', note: 'FRICTION of each track\'s road surface as a percent of AC\'s road grip (FRICTION 1 = 100). Numbers only.', tracks };
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node tools/grips.cjs <AC folder> > src/doc/grips.json'); process.exit(2); }
  process.stdout.write(JSON.stringify(build(dir), null, 1) + '\n');
}
module.exports = { ROWS, surfaces, build };
