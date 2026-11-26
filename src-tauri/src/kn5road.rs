// kn5road.rs (L250, pane O): a reference track's ROAD from its kn5 files, for the shadow layer's "Road" mode (reference.rs gives the "Line").
// READ ONLY: nothing here writes, moves or creates anything in Assetto Corsa's folder.
//
//   read_road(tracks, track, layout) -> Road: every mesh of the layout's kn5 files that AC counts as valid track, in world space, merged into
//                           batches of at most 65,536 vertices so the page draws them with 16-bit indices, as the shadow pass already does
//   encode(&Road) -> the bytes the page gets (below): positions and indices only; no texture, normal, uv or material crosses
//
// WHICH FILES. A layout's kn5 files are the FILE= of every section of models_<layout>.ini, else models.ini, else the one <track>.kn5 (on L, 2026-11-26:
// 55 models ini in 34 folders; each of the 6 folders with none holds exactly <track>.kn5). A listed file that is not installed is skipped and counted
// (13 of 367 listed on L). A model the ini places at a POSITION or ROTATION is read, but one holding road is refused: where it lands is not worked out
// here (15 placed on L; none holds road).
//
// WHICH MESHES. AC's own defaults (system/data/surfaces.ini) mark ROAD and KERB valid track; the layout's surfaces.ini (<layout>/data/, else data/)
// adds every KEY with IS_VALID_TRACK=1. A mesh is that surface when its name is digits, then the key, then an end, a digit or a separator (anything
// but a letter): "1ROAD", "01ROAD_SUB", "1KERB2", "21TARMAC-X011", but not "1KERBGRASS" for KERB. Not "the run of letters equals": on L, 30 of 61
// layouts have a valid key with a '-' or '_' in it, and the letter-run rule loses 11.7 million triangles of their road. The end after the key (pane E's
// read, L250) keeps exactly the same 30,781,955 triangles on L as a bare "starts with" and does not take a longer name for a shorter key (tools/kn5.cjs
// over every installed kn5; pane O's L250 hand-back). Inferred, not read from AC's code: the tightest rule every installed layout agrees with.
//
// THE START, for placing the road where a layout has no AI line (15 of 61 on L): the AC_START_0 dummy, its position and its forward axis (the third
// row of its world matrix, as tools/kn5.cjs's `fwd`; within 6.3 degrees of the AI line's way on all but one layout on L). Else the time line: the
// middle of AC_TIME_0_L and AC_TIME_0_R, facing up x (R - L) (within 6.6 degrees of the AI line's way on all but one; the gate dummies' own axes
// are not: 90 to 176 degrees off on many). Else none, and the header says so: it is not guessed. A dummy inside a model the ini places at a
// POSITION or ROTATION is not used, for the reason its road is refused. On L: 60 of 61 layouts have AC_START_0 and the one that has neither has an AI line.
//
// THE KN5, as tools/kn5.cjs reads it (the modding community's description, e.g. AcTools' Kn5Reader): "sc6969", a version (an extra int past 5),
// textures (seeked past: they are most of the bytes), materials (skipped over), then the node tree: class 1 a dummy with a 4x4 row-vector matrix,
// class 2 a mesh with 44-byte vertices and 16-bit indices. A mesh's world position is its vertex times its dummies' matrices, child first, in f64 and
// stored as f32: the same arithmetic as tools/kn5.cjs, so the two agree to the bit (the ignored cargo row against it). Anything else is refused with
// the reason: no magic, a node class other than 1 or 2, a short file, bytes after the tree, an index past its mesh's vertices. Only the kept
// meshes' vertices are read; the rest is seeked past.
//
// THE BYTES, little-endian, every block 4-aligned so the page can lay typed arrays over the one ArrayBuffer without copying:
//   "T180ROAD" · u32 format (1) · u32 J · J bytes of JSON, space-padded to a multiple of 4:
//       { files, missing, meshes, triangles, vertices, keys: [the valid keys], surfaces: "layout" | "track" | "defaults",
//         start: { pos: [x, y, z], T: [x, y, z] (unit), from: "AC_START_0" | "AC_TIME_0" } | null, noStart: why, when start is null }
//   u32 B batches, then each: u32 nv · u32 ni · f32 positions[nv * 3] (x, y, z in AC's own metres and axes) · u16 indices[ni] · 2 zero bytes when ni is odd

use std::fs;
use std::io::{BufReader, Read, Seek};
use std::path::Path;

/// AC's own valid-track surfaces: system/data/surfaces.ini marks ROAD and KERB IS_VALID_TRACK=1 (GRASS and SAND 0).
const AC_DEFAULT_KEYS: [&str; 2] = ["ROAD", "KERB"];
const MOST_STRING: i32 = 1_000_000;                    // as tools/kn5.cjs: a longer string is not a kn5
const MOST_DEPTH: usize = 10_000;                      // nested dummies; a track nests a handful
const VERTEX: u64 = 44;                                // position, normal, uv, tangent
const MESH_TAIL: u64 = 4 + 4 + 4 + 4 + 16 + 1;         // material, layer, lod in, lod out, bounding sphere, renderable
const BATCH_VERTICES: usize = 65_536;                  // what a 16-bit index reaches
const READ_BUFFER: usize = 64 << 10;                   // each jump past a texture or a skipped mesh refills this much

pub struct Batch { pub pos: Vec<f32>, pub idx: Vec<u16> }

#[derive(Debug)]
pub struct Mesh {
    #[allow(dead_code)]   // read by the rows; kept so a refusal or a check can name the mesh
    pub name: String,
    pub pos: Vec<f32>,
    pub idx: Vec<u16>,
}

/// An AC_ dummy as tools/kn5.cjs collects it (kn5.cjs:30): its world matrix's translation, and its third row as `fwd`.
#[derive(Debug, Clone, PartialEq)]
pub struct Dummy { pub name: String, pub pos: [f64; 3], pub fwd: [f64; 3] }

/// One kn5: the meshes `keep` took, and every AC_ dummy, in the order of the node tree.
pub struct Kn5 { pub meshes: Vec<Mesh>, pub dummies: Vec<Dummy> }

/// Where the layout starts: a position, a unit forward, and which dummies said so.
#[derive(Debug, Clone, PartialEq)]
pub struct Start { pub pos: [f64; 3], pub t: [f64; 3], pub from: &'static str }

pub struct Road {
    pub batches: Vec<Batch>,
    pub files: usize,
    pub missing: usize,
    pub meshes: usize,
    pub triangles: usize,
    pub vertices: usize,
    pub keys: Vec<String>,
    pub surfaces: &'static str,
    pub start: Result<Start, String>,
}

/// `dummies` holds every AC_ dummy of every file read, in order, each with whether its model is placed by the ini (then not used for the start).
struct Found { meshes: Vec<Mesh>, dummies: Vec<(Dummy, bool)>, files: usize, missing: usize, keys: Vec<String>, surfaces: &'static str }
type ReadFile<'a> = &'a dyn Fn(&Path, &dyn Fn(&str) -> bool) -> Result<Kn5, String>;

const NO_START: &str = "no AC_START_0, and no AC_TIME_0_L with AC_TIME_0_R, in the layout's kn5 files: the start is not guessed";

/// The layout's start from its dummies (the unplaced ones): AC_START_0, else the time line's middle facing up x (R - L), else the reason.
/// Summed in the order tools/kn5.cjs-side checks sum them, so the two agree to the bit (the ignored row against kn5.cjs).
fn start_of(dummies: &[&Dummy]) -> Result<Start, String> {
    let find = |n: &str| dummies.iter().find(|d| d.name.eq_ignore_ascii_case(n));
    if let Some(s) = find("AC_START_0") {
        let f = s.fwd;
        let l = (f[0] * f[0] + f[1] * f[1] + f[2] * f[2]).sqrt();
        if l > 0.0 { return Ok(Start { pos: s.pos, t: [f[0] / l, f[1] / l, f[2] / l], from: "AC_START_0" }); }
    }
    if let (Some(l), Some(r)) = (find("AC_TIME_0_L"), find("AC_TIME_0_R")) {
        let (dx, dz) = (r.pos[0] - l.pos[0], r.pos[2] - l.pos[2]);
        let len = (dz * dz + dx * dx).sqrt();
        if len > 0.0 {
            let pos = [(l.pos[0] + r.pos[0]) / 2.0, (l.pos[1] + r.pos[1]) / 2.0, (l.pos[2] + r.pos[2]) / 2.0];
            return Ok(Start { pos, t: [dz / len, 0.0, -dx / len], from: "AC_TIME_0" });
        }
    }
    Err(NO_START.into())
}

/// An ini's sections as (KEY, value) pairs: keys upper-cased, values trimmed, a ';' or '//' comment dropped, a BOM ignored.
fn ini_sections(text: &str) -> Vec<Vec<(String, String)>> {
    let mut out: Vec<Vec<(String, String)>> = Vec::new();
    for line in text.trim_start_matches('\u{feff}').lines() {
        let line = line.trim();
        if line.starts_with('[') { out.push(Vec::new()); continue; }
        let line = line.split(';').next().unwrap_or("").split("//").next().unwrap_or("");
        if let (Some(sec), Some((k, v))) = (out.last_mut(), line.split_once('=')) { sec.push((k.trim().to_uppercase(), v.trim().to_string())); }
    }
    out
}
fn value<'a>(sec: &'a [(String, String)], key: &str) -> Option<&'a str> { sec.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str()) }
fn read_text(p: &Path) -> Result<String, String> {
    fs::read(p).map(|b| String::from_utf8_lossy(&b).into_owned())
        .map_err(|e| format!("{} could not be read: {e}", p.file_name().map_or(String::new(), |n| n.to_string_lossy().into_owned())))
}
/// A POSITION or ROTATION that moves the model: any part not zero, or one that does not read as a number.
fn moves(v: Option<&str>) -> bool { v.map_or(false, |v| v.split(',').any(|x| x.trim().parse::<f64>().map_or(true, |x| x != 0.0))) }

/// The keys a mesh name may start with (after its digits) to be valid track: AC's ROAD and KERB, then each KEY the surfaces.ini text marks IS_VALID_TRACK=1.
pub fn valid_keys(text: Option<&str>) -> Vec<String> {
    let mut keys: Vec<String> = AC_DEFAULT_KEYS.iter().map(|k| k.to_string()).collect();
    for sec in ini_sections(text.unwrap_or("")) {
        let (Some(k), Some(v)) = (value(&sec, "KEY"), value(&sec, "IS_VALID_TRACK")) else { continue };
        let k = k.split_whitespace().next().unwrap_or("").to_uppercase();
        if !k.is_empty() && v.split_whitespace().next().and_then(|v| v.parse::<f64>().ok()) == Some(1.0) && !keys.contains(&k) { keys.push(k); }
    }
    keys
}

/// AC's physics naming: one or more digits, then a surface's KEY. Valid track when what follows the digits is a valid key and then an end, a digit or
/// a separator (anything but a letter), so a longer name ("KERBGRASS") is never taken for a shorter key ("KERB").
pub fn is_valid_track(name: &str, keys: &[String]) -> bool {
    let rest = name.trim_start_matches(|c: char| c.is_ascii_digit());
    if rest.len() == name.len() { return false; }
    let rest = rest.to_uppercase();
    keys.iter().any(|k| !k.is_empty() && rest.starts_with(k.as_str()) && !rest[k.len()..].chars().next().map_or(false, char::is_alphabetic))
}

/// The file as a cursor that knows its length, so a short file is refused by what it lacks before any seek runs past its end.
struct Src<R> { r: BufReader<R>, at: u64, len: u64 }
impl<R: Read + Seek> Src<R> {
    fn need(&self, n: u64, what: &str) -> Result<(), String> {
        if self.at.checked_add(n).map_or(true, |end| end > self.len) { return Err(format!("it ends at byte {}, inside {what} ({n} bytes from byte {})", self.len, self.at)); }
        Ok(())
    }
    fn bytes(&mut self, buf: &mut [u8], what: &str) -> Result<(), String> {
        self.need(buf.len() as u64, what)?;
        self.r.read_exact(buf).map_err(|e| format!("it could not be read at byte {}: {e}", self.at))?;
        self.at += buf.len() as u64;
        Ok(())
    }
    fn skip(&mut self, n: u64, what: &str) -> Result<(), String> {
        self.need(n, what)?;
        self.r.seek_relative(n as i64).map_err(|e| format!("it could not be read past byte {}: {e}", self.at))?;
        self.at += n;
        Ok(())
    }
    fn word(&mut self, what: &str) -> Result<[u8; 4], String> { let mut b = [0u8; 4]; self.bytes(&mut b, what)?; Ok(b) }
    fn u32(&mut self, what: &str) -> Result<u32, String> { self.word(what).map(u32::from_le_bytes) }
    fn f32(&mut self, what: &str) -> Result<f32, String> { self.word(what).map(f32::from_le_bytes) }
    fn count(&mut self, what: &str) -> Result<u64, String> {
        let n = i32::from_le_bytes(self.word(what)?);
        if n < 0 { return Err(format!("{what} is {n}, at byte {}", self.at - 4)); }
        Ok(n as u64)
    }
    fn string_len(&mut self, what: &str) -> Result<u64, String> {
        let n = i32::from_le_bytes(self.word(what)?);
        if !(0..=MOST_STRING).contains(&n) { return Err(format!("{what} says it is {n} bytes long, at byte {}", self.at - 4)); }
        Ok(n as u64)
    }
    fn string(&mut self, what: &str) -> Result<String, String> {
        let mut b = vec![0u8; self.string_len(what)? as usize];
        self.bytes(&mut b, what)?;
        Ok(String::from_utf8_lossy(&b).into_owned())
    }
    fn skip_string(&mut self, what: &str) -> Result<(), String> { let n = self.string_len(what)?; self.skip(n, what) }
}

/// a times m, row-major, summed in tools/kn5.cjs's order so the result is the same to the bit
fn mul(a: &[f64; 16], m: &[f64; 16]) -> [f64; 16] {
    let mut r = [0f64; 16];
    for i in 0..4 { for j in 0..4 { let mut s = 0.0; for k in 0..4 { s += a[i * 4 + k] * m[k * 4 + j]; } r[i * 4 + j] = s; } }
    r
}
const IDENTITY: [f64; 16] = [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.];

/// Every mesh of one kn5 whose name `keep` takes, in world space, and every AC_ dummy. `len` is the file's length.
pub fn read_kn5<R: Read + Seek>(inner: R, len: u64, keep: &dyn Fn(&str) -> bool) -> Result<Kn5, String> {
    let mut s = Src { r: BufReader::with_capacity(READ_BUFFER, inner), at: 0, len };
    let mut magic = [0u8; 6];
    if len >= 6 { s.bytes(&mut magic, "the magic")?; }
    if &magic != b"sc6969" { return Err("not a kn5 (no sc6969 magic)".into()); }
    if s.u32("the version")? > 5 { s.skip(4, "the version's extra int")?; }
    for _ in 0..s.count("the texture count")? {
        s.skip(4, "a texture")?;
        s.skip_string("a texture's name")?;
        let n = s.count("a texture's size")?;
        s.skip(n, "a texture")?;
    }
    for _ in 0..s.count("the material count")? {
        s.skip_string("a material's name")?;
        s.skip_string("a material's shader")?;
        s.skip(1 + 1 + 4, "a material")?;
        for _ in 0..s.count("a material's property count")? { s.skip_string("a property's name")?; s.skip(40, "a property")?; }
        for _ in 0..s.count("a material's sampler count")? { s.skip_string("a sampler's name")?; s.skip(4, "a sampler")?; s.skip_string("a sampler's texture")?; }
    }
    // the node tree, depth first; `open` holds each node still owed children, with how many
    let (mut out, mut open, mut parent): (Vec<Mesh>, Vec<([f64; 16], u64)>, [f64; 16]) = (Vec::new(), Vec::new(), IDENTITY);
    let mut dummies: Vec<Dummy> = Vec::new();
    loop {
        let at = s.at;
        let class = i32::from_le_bytes(s.word("a node's class")?);
        let name = s.string("a node's name")?;
        let kids = s.count("a node's child count")?;
        s.skip(1, "a node")?;
        let m = match class {
            1 => {
                let mut l = [0f64; 16];
                for v in l.iter_mut() { *v = s.f32("a dummy's matrix")? as f64; }
                let w = mul(&l, &parent);
                if name.get(..3).map_or(false, |p| p.eq_ignore_ascii_case("AC_")) { dummies.push(Dummy { name: name.clone(), pos: [w[12], w[13], w[14]], fwd: [w[8], w[9], w[10]] }); }
                w
            }
            2 => { read_mesh(&mut s, &name, &parent, keep, &mut out)?; parent }
            c => return Err(format!("node class {c} at byte {at} is not one a track's road uses (1, a dummy, or 2, a mesh)")),
        };
        if kids > 0 {
            if open.len() >= MOST_DEPTH { return Err(format!("its node tree nests deeper than {MOST_DEPTH}")); }
            open.push((m, kids));
            parent = m;
            continue;
        }
        loop {
            match open.last_mut() {
                None => { if s.at != len { return Err(format!("{} bytes left after the node tree", len - s.at)); } return Ok(Kn5 { meshes: out, dummies }); }
                Some(top) => { top.1 -= 1; if top.1 == 0 { open.pop(); } else { parent = top.0; break; } }
            }
        }
    }
}

fn read_mesh<R: Read + Seek>(s: &mut Src<R>, name: &str, m: &[f64; 16], keep: &dyn Fn(&str) -> bool, out: &mut Vec<Mesh>) -> Result<(), String> {
    s.skip(3, "a mesh's flags")?;
    let nv = s.u32("a mesh's vertex count")? as u64;
    if !keep(name) {
        s.skip(nv * VERTEX, "a mesh's vertices")?;
        let ni = s.u32("a mesh's index count")? as u64;
        s.skip(ni * 2, "a mesh's indices")?;
        return s.skip(MESH_TAIL, "a mesh's material and bounds");
    }
    s.need(nv * VERTEX, "a mesh's vertices")?;
    let mut raw = vec![0u8; (nv * VERTEX) as usize];
    s.bytes(&mut raw, "a mesh's vertices")?;
    let mut pos = Vec::with_capacity(nv as usize * 3);
    for v in raw.chunks_exact(VERTEX as usize) {
        let f = |o: usize| f32::from_le_bytes([v[o], v[o + 1], v[o + 2], v[o + 3]]) as f64;
        let (x, y, z) = (f(0), f(4), f(8));
        pos.push((x * m[0] + y * m[4] + z * m[8] + m[12]) as f32);
        pos.push((x * m[1] + y * m[5] + z * m[9] + m[13]) as f32);
        pos.push((x * m[2] + y * m[6] + z * m[10] + m[14]) as f32);
    }
    let ni = s.u32("a mesh's index count")? as u64;
    s.need(ni * 2, "a mesh's indices")?;
    let mut raw = vec![0u8; (ni * 2) as usize];
    s.bytes(&mut raw, "a mesh's indices")?;
    let idx: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    if let Some(bad) = idx.iter().find(|&&i| i as u64 >= nv) { return Err(format!("mesh {name:?} has index {bad} but {nv} vertices")); }
    if ni % 3 != 0 { return Err(format!("mesh {name:?} has {ni} indices, which is not whole triangles")); }
    if nv as usize > BATCH_VERTICES { return Err(format!("mesh {name:?} has {nv} vertices, more than a 16-bit index reaches")); }
    s.skip(MESH_TAIL, "a mesh's material and bounds")?;
    out.push(Mesh { name: name.to_string(), pos, idx });
    Ok(())
}

/// The layout's files, keys and valid-track meshes, each kn5 read by `read_file` (the real read opens the file; a measurement may read it otherwise).
fn collect_with(tracks: &Path, track: &str, layout: &str, read_file: ReadFile) -> Result<Found, String> {
    crate::reference::plain_name(track, false)?;
    crate::reference::plain_name(layout, true)?;
    let root = fs::canonicalize(tracks).map_err(|e| format!("{}: {e}", tracks.display()))?;
    let td = fs::canonicalize(tracks.join(track)).map_err(|e| format!("no track folder there ({e})"))?;
    if !td.starts_with(&root) { return Err("that track's folder lies outside content\\tracks once its links are followed".into()); }
    let ini = [(!layout.is_empty()).then(|| format!("models_{layout}.ini")), Some("models.ini".to_string())]
        .into_iter().flatten().map(|f| td.join(f)).find(|p| p.is_file());
    let models: Vec<(String, bool)> = match &ini {
        Some(p) => ini_sections(&read_text(p)?).iter()
            .filter_map(|sec| value(sec, "FILE").filter(|f| !f.is_empty()).map(|f| (f.to_string(), moves(value(sec, "POSITION")) || moves(value(sec, "ROTATION")))))
            .collect(),
        None => vec![(format!("{track}.kn5"), false)],
    };
    let surfaces = [(!layout.is_empty()).then(|| (td.join(layout).join("data").join("surfaces.ini"), "layout")), Some((td.join("data").join("surfaces.ini"), "track"))]
        .into_iter().flatten().find(|(p, _)| p.is_file());
    let (keys, surfaces) = match surfaces { Some((p, from)) => (valid_keys(Some(&read_text(&p)?)), from), None => (valid_keys(None), "defaults") };
    let keep = |n: &str| is_valid_track(n, &keys);
    let (mut meshes, mut dummies, mut files, mut missing) = (Vec::new(), Vec::new(), 0, 0);
    for (file, placed) in models {
        let real = match fs::canonicalize(td.join(&file)) {
            Ok(r) => r,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => { missing += 1; continue; }
            Err(e) => return Err(format!("{file}: {e}")),
        };
        if !real.starts_with(&td) { return Err(format!("{file}: the models ini names a file outside the track's folder")); }
        let got = read_file(&real, &keep).map_err(|e| format!("{file}: {e}"))?;
        if placed && !got.meshes.is_empty() { return Err(format!("{file}: the models ini places it at a POSITION or ROTATION and it holds road; a placed model's road is not read yet")); }
        files += 1;
        meshes.extend(got.meshes);
        dummies.extend(got.dummies.into_iter().map(|d| (d, placed)));
    }
    if files == 0 { return Err(format!("the layout names no installed kn5 file ({missing} listed, none there)")); }
    if meshes.is_empty() { return Err(format!("no mesh in the layout's {files} kn5 files is named for a valid-track surface ({})", keys.join(", "))); }
    Ok(Found { meshes, dummies, files, missing, keys, surfaces })
}

fn collect(tracks: &Path, track: &str, layout: &str) -> Result<Found, String> {
    collect_with(tracks, track, layout, &|p, keep| {
        let f = fs::File::open(p).map_err(|e| format!("it could not be opened: {e}"))?;
        let len = f.metadata().map_err(|e| format!("its size could not be read: {e}"))?.len();
        read_kn5(f, len, keep)
    })
}

/// The meshes, in file order, into batches of at most 65,536 vertices (a mesh never splits: read_mesh refuses one larger).
fn assemble(f: Found) -> Road {
    let (mut batches, mut triangles, mut vertices, meshes): (Vec<Batch>, usize, usize, usize) = (Vec::new(), 0, 0, f.meshes.len());
    for m in f.meshes {
        let nv = m.pos.len() / 3;
        triangles += m.idx.len() / 3;
        vertices += nv;
        if nv == 0 { continue; }
        if batches.last().map_or(true, |b| b.pos.len() / 3 + nv > BATCH_VERTICES) { batches.push(Batch { pos: Vec::new(), idx: Vec::new() }); }
        let b = batches.last_mut().expect("a batch was just made");
        let base = b.pos.len() / 3;
        b.idx.extend(m.idx.iter().map(|&i| (base + i as usize) as u16));
        b.pos.extend_from_slice(&m.pos);
    }
    let start = start_of(&f.dummies.iter().filter(|(_, placed)| !placed).map(|(d, _)| d).collect::<Vec<_>>());
    Road { batches, files: f.files, missing: f.missing, meshes, triangles, vertices, keys: f.keys, surfaces: f.surfaces, start }
}

pub fn read_road(tracks: &Path, track: &str, layout: &str) -> Result<Road, String> { Ok(assemble(collect(tracks, track, layout)?)) }

pub fn encode(r: &Road) -> Vec<u8> {
    let mut head = serde_json::json!({ "files": r.files, "missing": r.missing, "meshes": r.meshes, "triangles": r.triangles, "vertices": r.vertices, "keys": r.keys, "surfaces": r.surfaces });
    match &r.start {
        Ok(s) => head["start"] = serde_json::json!({ "pos": s.pos, "T": s.t, "from": s.from }),
        Err(why) => { head["start"] = serde_json::Value::Null; head["noStart"] = serde_json::json!(why); }
    }
    let mut head = head.to_string();
    while head.len() % 4 != 0 { head.push(' '); }
    let size = 16 + head.len() + 4 + r.batches.iter().map(|b| 8 + b.pos.len() * 4 + (b.idx.len() * 2 + 3) / 4 * 4).sum::<usize>();
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(b"T180ROAD");
    out.extend_from_slice(&1u32.to_le_bytes());
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(head.as_bytes());
    out.extend_from_slice(&(r.batches.len() as u32).to_le_bytes());
    for b in &r.batches {
        out.extend_from_slice(&((b.pos.len() / 3) as u32).to_le_bytes());
        out.extend_from_slice(&(b.idx.len() as u32).to_le_bytes());
        for v in &b.pos { out.extend_from_slice(&v.to_le_bytes()); }
        for i in &b.idx { out.extend_from_slice(&i.to_le_bytes()); }
        if b.idx.len() % 2 == 1 { out.extend_from_slice(&[0, 0]); }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Cursor;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);
    fn scratch() -> PathBuf {
        let d = std::env::temp_dir().join(format!("t180-kn5road-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let _ = fs::remove_dir_all(&d); fs::create_dir_all(&d).unwrap(); d
    }
    fn put(p: &Path, bytes: &[u8]) { fs::create_dir_all(p.parent().unwrap()).unwrap(); fs::write(p, bytes).unwrap(); }

    // A kn5 laid out as tools/kn5.cjs reads it: magic, version (an extra int past 5), one texture, one material, then the node tree.
    enum Node { Dummy(&'static str, [f32; 16], Vec<Node>), Mesh(&'static str, Vec<[f32; 3]>, Vec<u16>), Class(i32) }
    const I4: [f32; 16] = [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.];
    fn s(b: &mut Vec<u8>, t: &str) { b.extend_from_slice(&(t.len() as i32).to_le_bytes()); b.extend_from_slice(t.as_bytes()); }
    fn i(b: &mut Vec<u8>, v: i32) { b.extend_from_slice(&v.to_le_bytes()); }
    fn kn5(version: u32, root: &Node) -> Vec<u8> {
        let mut b = b"sc6969".to_vec();
        b.extend_from_slice(&version.to_le_bytes());
        if version > 5 { i(&mut b, 0); }
        i(&mut b, 1); i(&mut b, 1); s(&mut b, "t.dds"); i(&mut b, 300); b.extend(std::iter::repeat(7u8).take(300));
        i(&mut b, 1); s(&mut b, "m"); s(&mut b, "ksPerPixel"); b.push(0); b.push(0); i(&mut b, 0);
        i(&mut b, 1); s(&mut b, "ksDiffuse"); b.extend(std::iter::repeat(0u8).take(40));
        i(&mut b, 1); s(&mut b, "txDiffuse"); i(&mut b, 0); s(&mut b, "t.dds");
        node(&mut b, root);
        b
    }
    fn node(b: &mut Vec<u8>, n: &Node) {
        match n {
            Node::Dummy(name, m, kids) => {
                i(b, 1); s(b, name); i(b, kids.len() as i32); b.push(1);
                for v in m { b.extend_from_slice(&v.to_le_bytes()); }
                for k in kids { node(b, k); }
            }
            Node::Mesh(name, pos, idx) => {
                i(b, 2); s(b, name); i(b, 0); b.push(1);
                b.extend_from_slice(&[1, 1, 0]);
                b.extend_from_slice(&(pos.len() as u32).to_le_bytes());
                for p in pos { for v in p { b.extend_from_slice(&v.to_le_bytes()); } b.extend(std::iter::repeat(0u8).take(32)); }
                b.extend_from_slice(&(idx.len() as u32).to_le_bytes());
                for x in idx { b.extend_from_slice(&x.to_le_bytes()); }
                i(b, 0); i(b, 0); b.extend_from_slice(&0f32.to_le_bytes()); b.extend_from_slice(&0f32.to_le_bytes());
                b.extend(std::iter::repeat(0u8).take(16)); b.push(1);
            }
            Node::Class(c) => { i(b, *c); s(b, "other"); i(b, 0); b.push(1); }
        }
    }
    /// `tris` separate triangles starting at x = `at`, so meshes are told apart by their triangle counts.
    fn tri_mesh(name: &'static str, tris: usize, at: f32) -> Node {
        let (mut pos, mut idx) = (Vec::new(), Vec::new());
        for t in 0..tris {
            let x = at + t as f32;
            pos.extend([[x, 0., 0.], [x + 1., 0., 0.], [x, 0., 1.]]);
            idx.extend([(3 * t) as u16, (3 * t + 1) as u16, (3 * t + 2) as u16]);
        }
        Node::Mesh(name, pos, idx)
    }
    fn group(kids: Vec<Node>) -> Node { Node::Dummy("root", I4, kids) }
    fn read(bytes: &[u8], keep: &dyn Fn(&str) -> bool) -> Result<Vec<Mesh>, String> { read_kn5(Cursor::new(bytes), bytes.len() as u64, keep).map(|k| k.meshes) }
    const SURFACES: &str = "\u{feff}[SURFACE_0]\nKEY=ROAD\nIS_VALID_TRACK=1\n\n[SURFACE_1]\nKEY=GRASS\nIS_VALID_TRACK=0\n\n[SURFACE_2]\r\nKEY=TARMAC-X ; the author's road\r\nIS_VALID_TRACK=1\r\n\n[SURFACE_3]\nKEY=PIT_LANE\nIS_VALID_TRACK=0\n";
    const ROAD_ONLY: &str = "[SURFACE_0]\nKEY=ROAD\nIS_VALID_TRACK=1\n";

    // ---- which meshes are track ----

    #[test]
    fn a_mesh_is_track_when_its_name_after_the_digits_starts_with_a_valid_key() {
        let keys = valid_keys(Some(SURFACES));
        let kept: Vec<&str> = ["1ROAD", "01ROAD_SUB", "12KERB_04", "3TARMAC-X", "21tarmac-x011", "ROAD", "1GRASS", "1PIT_LANE", "1TARMAC", "1WALL", "", "12"]
            .into_iter().filter(|n| is_valid_track(n, &keys)).collect();
        assert_eq!(kept, vec!["1ROAD", "01ROAD_SUB", "12KERB_04", "3TARMAC-X", "21tarmac-x011"]);
    }

    #[test]
    fn a_longer_name_is_not_taken_for_a_shorter_key() {
        // KERB is valid and KERBGRASS is a surface that is not: after the key comes an end, a digit or a separator, never a letter (pane E's read, L250)
        let keys = valid_keys(Some("[SURFACE_0]\nKEY=KERBGRASS\nIS_VALID_TRACK=0\n"));
        let kept: Vec<&str> = ["1KERBGRASS", "1ROADSIDE", "1KERB", "1KERB2", "1KERB_A", "1ROAD-SUB", "1ROAD.001"].into_iter().filter(|n| is_valid_track(n, &keys)).collect();
        assert_eq!(kept, vec!["1KERB", "1KERB2", "1KERB_A", "1ROAD-SUB", "1ROAD.001"]);
    }

    #[test]
    fn with_no_surfaces_ini_the_keys_are_acs_defaults_road_and_kerb() {
        assert_eq!(valid_keys(None), vec!["ROAD".to_string(), "KERB".to_string()]);
    }

    #[test]
    fn only_the_valid_track_meshes_are_read_and_the_rest_skipped() {
        let k = kn5(6, &group(vec![tri_mesh("1ROAD", 1, 0.), tri_mesh("1GRASS", 2, 10.), tri_mesh("3TARMAC-X_1", 4, 20.), tri_mesh("1WALL", 8, 30.)]));
        let keys = valid_keys(Some(SURFACES));
        let got = read(&k, &|n| is_valid_track(n, &keys)).unwrap();
        assert_eq!(got.iter().map(|m| (m.name.as_str(), m.idx.len() / 3)).collect::<Vec<_>>(), vec![("1ROAD", 1), ("3TARMAC-X_1", 4)]);
    }

    // ---- the kn5 itself ----

    #[test]
    fn the_node_tree_places_each_mesh_in_world_space() {
        // a parent moved 10 along x holds a child turned 90 degrees about y; row vectors, child then parent (as tools/kn5.cjs)
        let mv = [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 10., 0., 0., 1.];
        let turn = [0., 0., -1., 0., 0., 1., 0., 0., 1., 0., 0., 0., 0., 0., 0., 1.];
        let k = kn5(5, &Node::Dummy("moved", mv, vec![Node::Dummy("turned", turn, vec![Node::Mesh("1ROAD", vec![[1., 0., 0.], [0., 2., 0.], [0., 0., 3.]], vec![0, 1, 2])])]));
        assert_eq!(read(&k, &|_| true).unwrap()[0].pos, vec![10., 0., -1., 10., 2., 0., 13., 0., 0.]);
    }

    #[test]
    fn a_truncated_file_is_refused_with_a_reason() {
        let k = kn5(6, &group(vec![tri_mesh("1ROAD", 3, 0.), tri_mesh("1WALL", 3, 10.)]));
        // cut in the version, the texture, the material, the second mesh's vertices and its last byte; both kept and skipped
        let keeps: [&dyn Fn(&str) -> bool; 2] = [&|_: &str| true, &|n: &str| n == "1ROAD"];
        for cut in [8, 20, 340, k.len() - 200, k.len() - 1] {
            for keep in keeps {
                let e = read(&k[..cut], keep).err().unwrap_or_else(|| panic!("a file cut at {cut} of {} bytes was read", k.len()));
                assert!(e.contains("ends at byte"), "cut at {cut}: {e}");
            }
        }
    }

    #[test]
    fn a_file_that_is_not_a_kn5_is_refused_with_a_reason() {
        assert!(read(b"\x89PNG\r\n\x1a\n0000000000000000", &|_| true).unwrap_err().contains("not a kn5"));
    }

    #[test]
    fn a_node_class_tracks_do_not_use_is_refused_by_name() {
        let k = kn5(6, &group(vec![tri_mesh("1ROAD", 1, 0.), Node::Class(3)]));
        assert!(read(&k, &|_| true).unwrap_err().contains("node class 3"));
    }

    #[test]
    fn bytes_left_after_the_node_tree_are_refused() {
        let mut k = kn5(6, &group(vec![tri_mesh("1ROAD", 1, 0.)]));
        k.extend_from_slice(b"more");
        assert!(read(&k, &|_| true).unwrap_err().contains("4 bytes left after the node tree"));
    }

    #[test]
    fn an_index_past_its_meshs_vertices_is_refused() {
        let k = kn5(6, &group(vec![Node::Mesh("1ROAD", vec![[0., 0., 0.], [1., 0., 0.], [0., 0., 1.]], vec![0, 1, 3])]));
        assert!(read(&k, &|_| true).unwrap_err().contains("index 3"));
    }

    // ---- a track and layout ----

    #[test]
    fn a_layout_reads_every_kn5_its_own_models_ini_names_with_its_own_surfaces() {
        let t = scratch();
        let one = t.join("one");
        put(&one.join("models_short.ini"), b"[MODEL_0]\r\nFILE=a.kn5\r\nPOSITION=0,0,0\r\nROTATION=0,0,0\r\n\r\n[MODEL_1]\nFILE=b.kn5\n\n[DYNAMIC_OBJECT_0]\nFILE=c.kn5\n");
        put(&one.join("models.ini"), b"[MODEL_0]\nFILE=never.kn5\n");
        put(&one.join("a.kn5"), &kn5(6, &group(vec![tri_mesh("1ROAD", 1, 0.), tri_mesh("1GRASS", 2, 10.)])));
        put(&one.join("b.kn5"), &kn5(6, &group(vec![tri_mesh("1TARMAC-X", 4, 20.)])));
        put(&one.join("c.kn5"), &kn5(5, &group(vec![tri_mesh("1KERB", 8, 30.)])));
        put(&one.join("never.kn5"), &kn5(6, &group(vec![tri_mesh("1ROAD", 16, 0.)])));
        put(&one.join("short").join("data").join("surfaces.ini"), SURFACES.as_bytes());
        put(&one.join("data").join("surfaces.ini"), ROAD_ONLY.as_bytes());
        let r = read_road(&t, "one", "short").unwrap();
        assert_eq!((r.files, r.triangles, r.surfaces), (3, 1 + 4 + 8, "layout"));
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn with_no_surfaces_ini_only_road_and_kerb_are_read() {
        let t = scratch();
        put(&t.join("one").join("one.kn5"), &kn5(6, &group(vec![tri_mesh("1ROAD", 1, 0.), tri_mesh("1KERB", 2, 10.), tri_mesh("1TARMAC-X", 4, 20.)])));
        let r = read_road(&t, "one", "").unwrap();
        assert_eq!((r.files, r.triangles, r.surfaces), (1, 3, "defaults"));
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn a_listed_kn5_that_is_not_installed_is_skipped_and_counted() {
        let t = scratch();
        put(&t.join("one").join("models.ini"), b"[MODEL_0]\nFILE=a.kn5\n[MODEL_1]\nFILE=gone.kn5\n");
        put(&t.join("one").join("a.kn5"), &kn5(6, &group(vec![tri_mesh("1ROAD", 2, 0.)])));
        let r = read_road(&t, "one", "").unwrap();
        assert_eq!((r.files, r.missing, r.triangles), (1, 1, 2));
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn road_in_a_model_that_models_ini_places_elsewhere_is_refused() {
        let t = scratch();
        put(&t.join("one").join("models.ini"), b"[MODEL_0]\nFILE=a.kn5\nPOSITION=0,0,0\n[MODEL_1]\nFILE=b.kn5\nPOSITION=10,0,0\nROTATION=0,0,0\n");
        put(&t.join("one").join("a.kn5"), &kn5(6, &group(vec![tri_mesh("1ROAD", 2, 0.)])));
        put(&t.join("one").join("b.kn5"), &kn5(6, &group(vec![tri_mesh("1ROAD", 1, 0.)])));
        assert!(read_road(&t, "one", "").err().expect("a placed road was read as if unplaced").contains("POSITION"));
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn a_placed_model_with_no_road_in_it_is_read_without_complaint() {
        let t = scratch();
        put(&t.join("one").join("models.ini"), b"[MODEL_0]\nFILE=a.kn5\n[MODEL_1]\nFILE=b.kn5\nPOSITION=270.3,-15.15,-45.8\nROTATION=213,0,0\n");
        put(&t.join("one").join("a.kn5"), &kn5(6, &group(vec![tri_mesh("1ROAD", 2, 0.)])));
        put(&t.join("one").join("b.kn5"), &kn5(6, &group(vec![tri_mesh("1WALL", 1, 0.)])));
        assert_eq!(read_road(&t, "one", "").unwrap().triangles, 2);
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn a_name_that_is_not_one_plain_folder_is_refused_before_anything_is_opened() {
        let t = scratch();
        put(&t.join("one").join("one.kn5"), &kn5(6, &group(vec![tri_mesh("1ROAD", 1, 0.)])));
        for (tr, l) in [("..", ""), ("one/..", ""), ("one", ".."), ("one", "a\\b"), ("", ""), ("c:", "")] {
            let e = read_road(&t, tr, l).err().unwrap_or_else(|| panic!("{tr:?} {l:?} was read"));
            assert!(e.contains("plain folder name") || e.contains("name is empty"), "{tr:?} {l:?}: {e}");
        }
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn a_models_ini_file_outside_the_track_folder_is_refused() {
        let t = scratch();
        put(&t.join("one").join("models.ini"), b"[MODEL_0]\nFILE=..\\two\\two.kn5\n");
        put(&t.join("two").join("two.kn5"), &kn5(6, &group(vec![tri_mesh("1ROAD", 2, 0.)])));
        assert!(read_road(&t, "one", "").err().expect("a file outside the track was read").contains("outside"));
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn a_layout_with_no_track_mesh_is_refused_with_a_reason() {
        let t = scratch();
        put(&t.join("one").join("one.kn5"), &kn5(6, &group(vec![tri_mesh("1WALL", 2, 0.)])));
        assert!(read_road(&t, "one", "").err().expect("an empty road was returned").contains("no mesh"));
        fs::remove_dir_all(&t).ok();
    }

    // ---- the start, for a layout with no AI line ----

    /// a dummy moved to (x, y, z), not turned
    fn at(x: f32, y: f32, z: f32) -> [f32; 16] { [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., x, y, z, 1.] }

    #[test]
    fn the_start_is_the_ac_start_0_dummy_in_world_space_and_reaches_the_page() {
        let t = scratch();
        // under a parent moved 100 along x, AC_START_0 at (5, 1, 7) turned so its forward (third row) is +x; a time line too, which loses to it
        let start = [0., 0., -1., 0., 0., 1., 0., 0., 1., 0., 0., 0., 5., 1., 7., 1.];
        let tree = Node::Dummy("root", at(100., 0., 0.), vec![Node::Dummy("AC_START_0", start, vec![]), Node::Dummy("AC_TIME_0_L", at(-5., 0., 50.), vec![]),
                                                              Node::Dummy("AC_TIME_0_R", at(5., 0., 50.), vec![]), tri_mesh("1ROAD", 1, 0.)]);
        put(&t.join("one").join("one.kn5"), &kn5(6, &tree));
        let r = read_road(&t, "one", "").unwrap();
        let (head, _) = decode(&encode(&r));
        assert_eq!((r.start, head["start"]["from"].as_str()), (Ok(Start { pos: [105., 1., 7.], t: [1., 0., 0.], from: "AC_START_0" }), Some("AC_START_0")));
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn with_no_start_dummy_the_start_is_the_time_lines_middle_facing_across_it() {
        let t = scratch();
        // L at (-5, 2, 10), R at (5, 4, 10): the middle (0, 3, 10), facing up x (R - L) = (0, 0, -1) along the ground
        let tree = group(vec![Node::Dummy("AC_TIME_0_L", at(-5., 2., 10.), vec![]), Node::Dummy("AC_TIME_0_R", at(5., 4., 10.), vec![]), tri_mesh("1ROAD", 1, 0.)]);
        put(&t.join("one").join("one.kn5"), &kn5(6, &tree));
        assert_eq!(read_road(&t, "one", "").unwrap().start, Ok(Start { pos: [0., 3., 10.], t: [0., 0., -1.], from: "AC_TIME_0" }));
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn with_neither_the_start_is_missing_and_the_header_says_so() {
        let t = scratch();
        // a pit box and half a time line are no start; nothing is guessed from them
        let tree = group(vec![Node::Dummy("AC_PIT_0", at(1., 0., 1.), vec![]), Node::Dummy("AC_TIME_0_L", at(-5., 0., 10.), vec![]), tri_mesh("1ROAD", 1, 0.)]);
        put(&t.join("one").join("one.kn5"), &kn5(6, &tree));
        let (head, _) = decode(&encode(&read_road(&t, "one", "").unwrap()));
        assert_eq!((head["start"].is_null(), head["noStart"].as_str().map_or(false, |w| w.contains("not guessed"))), (true, true));
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn a_start_in_a_model_the_ini_places_elsewhere_is_not_used() {
        let t = scratch();
        put(&t.join("one").join("models.ini"), b"[MODEL_0]\nFILE=a.kn5\n[MODEL_1]\nFILE=b.kn5\nPOSITION=10,0,0\n");
        put(&t.join("one").join("a.kn5"), &kn5(6, &group(vec![tri_mesh("1ROAD", 1, 0.)])));
        put(&t.join("one").join("b.kn5"), &kn5(6, &group(vec![Node::Dummy("AC_START_0", at(3., 0., 3.), vec![])])));
        assert!(read_road(&t, "one", "").unwrap().start.is_err());
        fs::remove_dir_all(&t).ok();
    }

    // ---- the bytes for the page ----

    /// The page's side of encode, written from the format in the header: (header, [(positions, indices)]).
    fn decode(b: &[u8]) -> (serde_json::Value, Vec<(Vec<f32>, Vec<u16>)>) {
        assert_eq!(&b[..8], b"T180ROAD");
        let u = |o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) as usize;
        assert_eq!(u(8), 1, "format version");
        let j = u(12);
        assert_eq!(j % 4, 0, "the header pads to 4 bytes");
        let head: serde_json::Value = serde_json::from_slice(&b[16..16 + j]).unwrap();
        let (mut o, mut out) = (16 + j + 4, Vec::new());
        for _ in 0..u(16 + j) {
            let (nv, ni) = (u(o), u(o + 4));
            o += 8;
            let pos = b[o..o + nv * 12].chunks(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect();
            o += nv * 12;
            let idx = b[o..o + ni * 2].chunks(2).map(|c| u16::from_le_bytes(c.try_into().unwrap())).collect();
            o += ni * 2 + (ni % 2) * 2;
            out.push((pos, idx));
        }
        assert_eq!(o, b.len(), "nothing after the last batch");
        (head, out)
    }

    #[test]
    fn the_bytes_for_the_page_split_at_65536_vertices_and_decode_back() {
        let t = scratch();
        // two meshes of 40,002 vertices cannot share a 16-bit batch; the 3-vertex one after them joins the second
        put(&t.join("one").join("one.kn5"), &kn5(6, &group(vec![tri_mesh("1ROAD_A", 13334, 0.), tri_mesh("1ROAD_B", 13334, 0.), tri_mesh("1KERB", 1, 5.)])));
        let r = read_road(&t, "one", "").unwrap();
        let (head, batches) = decode(&encode(&r));
        let shape: Vec<(usize, usize, Vec<u16>)> = batches.iter().map(|(p, x)| (p.len() / 3, x.len() / 3, x[x.len() - 3..].to_vec())).collect();
        assert_eq!((head["triangles"].as_u64(), shape), (Some(26669), vec![(40002, 13334, vec![39999, 40000, 40001]), (40005, 13335, vec![40002, 40003, 40004])]));
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn the_positions_reach_the_page_unchanged() {
        let t = scratch();
        put(&t.join("one").join("one.kn5"), &kn5(6, &group(vec![tri_mesh("1ROAD", 3, 0.25)])));
        let (_, batches) = decode(&encode(&read_road(&t, "one", "").unwrap()));
        assert_eq!(batches[0].0[..9].to_vec(), vec![0.25, 0., 0., 1.25, 0., 0., 0.25, 0., 1.]);
        fs::remove_dir_all(&t).ok();
    }

    // ---- on the installed tracks: ignored, because they need L's AC folder and pane B's LOCAL key (gitignored: it holds the names) ----
    // T180_AC_TRACKS = AC's content\tracks; T180_REFERENCE_KEY = pane B's out\reference-key.json. Names are never printed: "reference track 1".., "layout 7"..
    //   cargo test --lib kn5road -- --ignored --nocapture --test-threads=1

    fn installed() -> PathBuf { PathBuf::from(std::env::var("T180_AC_TRACKS").expect("T180_AC_TRACKS names AC's content\\tracks")) }
    fn references() -> Vec<(String, String, String)> {
        let key = std::env::var("T180_REFERENCE_KEY").expect("T180_REFERENCE_KEY names pane B's local reference key");
        let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(key).unwrap()).unwrap();
        let mut out: Vec<(String, String, String)> = v.as_object().unwrap().iter().filter(|(k, _)| k.starts_with("reference track"))
            .map(|(k, e)| (k.clone(), e["track"].as_str().unwrap().to_string(), e["layout"].as_str().unwrap_or("").to_string())).collect();
        out.sort();
        assert_eq!(out.len(), 3, "pane B's key names three references");
        out
    }
    fn fnv(h: &mut u32, bytes: impl Iterator<Item = u8>) { for b in bytes { *h ^= b as u32; *h = h.wrapping_mul(0x0100_0193); } }
    fn ms(t: std::time::Instant) -> f64 { t.elapsed().as_secs_f64() * 1e3 }

    /// tools/kn5.cjs readKn5 over the same layout, choosing files and meshes by the same rules, in node. Prints
    /// { files, missing, meshes, triangles, vertices, hash (FNV-1a over each kept mesh's f32 positions then u16 indices), runRuleTriangles (pane B's L243 rule),
    ///   startsWithTriangles (cac348e's rule), dummies: [[name, pos, fwd]] (kn5.cjs:30, every file in order), start: { pos, T, from } | null (the same choice) }.
    const KN5_CJS: &str = r#"
const fs = require('fs'), path = require('path');
const [K, tracks, track, layout] = process.argv.slice(-4);
const { readKn5 } = require(K);
const td = path.join(tracks, track);
const ini = [layout ? `models_${layout}.ini` : null, 'models.ini'].filter(Boolean).map((f) => path.join(td, f)).find((f) => fs.existsSync(f));
const files = ini ? [...fs.readFileSync(ini, 'utf8').matchAll(/^\s*FILE\s*=\s*(.+?)\s*$/gmi)].map((m) => m[1]) : [track + '.kn5'];
const sIni = [layout ? path.join(td, layout, 'data', 'surfaces.ini') : null, path.join(td, 'data', 'surfaces.ini')].filter(Boolean).find((x) => fs.existsSync(x));
const valid = new Set(['ROAD', 'KERB']);
if (sIni) for (const sec of fs.readFileSync(sIni, 'utf8').split(/^\s*\[/m)) { const k = /^\s*KEY\s*=\s*(\S+)/mi.exec(sec), v = /^\s*IS_VALID_TRACK\s*=\s*(\d)/mi.exec(sec); if (k && v && v[1] === '1') valid.add(k[1].toUpperCase()); }
let h = 0x811c9dc5; const fnv = (u8) => { for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193) >>> 0; } };
const r = { files: 0, missing: 0, meshes: 0, triangles: 0, vertices: 0, runRuleTriangles: 0, startsWithTriangles: 0, dummies: [] };
for (const f of files) {
  const p = path.join(td, f); if (!fs.existsSync(p)) { r.missing++; continue; } r.files++;
  const k5 = readKn5(p);
  for (const m of k5.meshes) {
    const up = m.name.toUpperCase(), run = (/^\d+([A-Z]+)/.exec(up) || [])[1], rest = up.replace(/^\d+/, '');
    if (run && valid.has(run)) r.runRuleTriangles += m.idx.length / 3;
    if (/^\d/.test(up) && [...valid].some((k) => rest.startsWith(k))) r.startsWithTriangles += m.idx.length / 3;
    if (!/^\d/.test(up) || ![...valid].some((k) => rest.startsWith(k) && !/\p{L}/u.test(rest.charAt(k.length)))) continue;
    r.meshes++; r.triangles += m.idx.length / 3; r.vertices += m.pos.length / 3;
    fnv(new Uint8Array(m.pos.buffer, m.pos.byteOffset, m.pos.byteLength)); fnv(new Uint8Array(m.idx.buffer, m.idx.byteOffset, m.idx.byteLength));
  }
  for (const d of k5.dummies) r.dummies.push([d.name, d.pos, d.fwd]);
}
const txt = (v) => v.map(String);
const find = (n) => r.dummies.find((d) => d[0].toUpperCase() === n);
const S = find('AC_START_0'), L = find('AC_TIME_0_L'), R = find('AC_TIME_0_R');
if (S) { const f = S[2], l = Math.sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]); r.start = { pos: S[1], T: [f[0] / l, f[1] / l, f[2] / l], from: 'AC_START_0' }; }
else if (L && R) { const dx = R[1][0] - L[1][0], dz = R[1][2] - L[1][2], l = Math.sqrt(dz * dz + dx * dx); r.start = { pos: [(L[1][0] + R[1][0]) / 2, (L[1][1] + R[1][1]) / 2, (L[1][2] + R[1][2]) / 2], T: [dz / l, 0, -dx / l], from: 'AC_TIME_0' }; }
else r.start = null;
r.dummies = r.dummies.map(([n, p, f]) => [n, txt(p), txt(f)]); if (r.start) r.start = { pos: txt(r.start.pos), T: txt(r.start.T), from: r.start.from };
r.hash = h >>> 0; console.log(JSON.stringify(r));
"#;

    #[test]
    #[ignore]
    fn the_three_references_read_as_tools_kn5_cjs_reads_them() {
        let tracks = installed();
        let cjs = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("tools").join("kn5.cjs");
        for (alias, track, layout) in references() {
            let out = std::process::Command::new("node").arg("-e").arg(KN5_CJS).arg(&cjs).arg(&tracks).arg(&track).arg(&layout).output().expect("node runs");
            assert!(out.status.success(), "{alias}: node failed: {}", String::from_utf8_lossy(&out.stderr));
            let js: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
            let f = collect(&tracks, &track, &layout).unwrap();
            let mut h = 0x811c_9dc5u32;
            for m in &f.meshes { fnv(&mut h, m.pos.iter().flat_map(|v| v.to_le_bytes())); fnv(&mut h, m.idx.iter().flat_map(|v| v.to_le_bytes())); }
            let tris: usize = f.meshes.iter().map(|m| m.idx.len() / 3).sum();
            let verts: usize = f.meshes.iter().map(|m| m.pos.len() / 3).sum();
            let rust = serde_json::json!({ "files": f.files, "missing": f.missing, "meshes": f.meshes.len(), "triangles": tris, "vertices": verts, "hash": h });
            let start = start_of(&f.dummies.iter().filter(|(_, placed)| !placed).map(|(d, _)| d).collect::<Vec<_>>());
            let mut shown = js.clone();
            shown.as_object_mut().unwrap().remove("dummies");
            println!("{alias}: rust {rust}, {} AC_ dummies, start {start:?}\n{alias}: tools/kn5.cjs {shown}, {} AC_ dummies",
                     f.dummies.len(), js["dummies"].as_array().unwrap().len());
            for k in ["files", "missing", "meshes", "triangles", "vertices", "hash"] { assert_eq!(rust[k], js[k], "{alias}: {k}"); }
            // the dummies and the start, number by number: node sends each as its shortest decimal TEXT and str::parse reads it back exactly
            // (serde_json's own float parsing, without its float_roundtrip feature, may land one ulp off: the first run of this row failed on that)
            let v3 = |v: &serde_json::Value| -> Vec<f64> { v.as_array().unwrap().iter().map(|x| x.as_str().unwrap().parse::<f64>().unwrap()).collect() };
            let jd = js["dummies"].as_array().unwrap();
            assert_eq!(f.dummies.len(), jd.len(), "{alias}: how many AC_ dummies");
            for ((d, _), j) in f.dummies.iter().zip(jd) {
                assert_eq!((d.name.as_str(), d.pos.to_vec(), d.fwd.to_vec()), (j[0].as_str().unwrap(), v3(&j[1]), v3(&j[2])), "{alias}: a dummy");
            }
            match (&start, &js["start"]) {
                (Ok(s), j) if !j.is_null() => assert_eq!((s.pos.to_vec(), s.t.to_vec(), s.from), (v3(&j["pos"]), v3(&j["T"]), j["from"].as_str().unwrap()), "{alias}: the start"),
                (Err(_), j) if j.is_null() => {}
                (s, j) => panic!("{alias}: the start is {s:?} here and {j} in tools/kn5.cjs"),
            }
        }
    }

    // ---- measuring: a cold read with no OS cache, and the process's peak memory (Windows only; no crate: kernel32's own export) ----

    #[cfg(windows)]
    static DISK_BYTES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    /// A kn5 opened with FILE_FLAG_NO_BUFFERING: every byte comes off the disk, none from the OS cache, so each run is a cold read.
    /// Reads in 64 KiB blocks at 4 KiB-aligned offsets into a 4 KiB-aligned buffer, as that flag requires.
    #[cfg(windows)]
    struct Unbuffered { f: fs::File, len: u64, pos: u64, buf: Vec<u8>, off: usize, start: u64, have: usize }
    #[cfg(windows)]
    impl Unbuffered {
        const BLOCK: usize = 64 << 10;
        fn open(p: &Path) -> std::io::Result<Self> {
            use std::os::windows::fs::OpenOptionsExt;
            let f = fs::OpenOptions::new().read(true).custom_flags(0x2000_0000).open(p)?;
            let len = f.metadata()?.len();
            let buf = vec![0u8; Self::BLOCK + 4096];
            let off = (4096 - buf.as_ptr() as usize % 4096) % 4096;
            Ok(Unbuffered { f, len, pos: 0, buf, off, start: 0, have: 0 })
        }
    }
    #[cfg(windows)]
    impl Read for Unbuffered {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            use std::io::SeekFrom;
            if self.pos >= self.len || out.is_empty() { return Ok(0); }
            if !(self.pos >= self.start && self.pos < self.start + self.have as u64) {
                self.start = self.pos & !4095;
                self.f.seek(SeekFrom::Start(self.start))?;
                self.have = self.f.read(&mut self.buf[self.off..self.off + Self::BLOCK])?;
                DISK_BYTES.fetch_add(self.have as u64, Ordering::SeqCst);
                if self.have == 0 { return Ok(0); }
            }
            let at = (self.pos - self.start) as usize;
            let n = out.len().min(self.have - at);
            out[..n].copy_from_slice(&self.buf[self.off + at..self.off + at + n]);
            self.pos += n as u64;
            Ok(n)
        }
    }
    #[cfg(windows)]
    impl Seek for Unbuffered {
        fn seek(&mut self, to: std::io::SeekFrom) -> std::io::Result<u64> {
            use std::io::SeekFrom;
            self.pos = match to { SeekFrom::Start(n) => n, SeekFrom::Current(d) => (self.pos as i64 + d) as u64, SeekFrom::End(d) => (self.len as i64 + d) as u64 };
            Ok(self.pos)
        }
    }

    #[cfg(windows)]
    #[repr(C)]
    struct Counters { cb: u32, faults: u32, peak_ws: usize, ws: usize, qpp: usize, qp: usize, qpnp: usize, qnp: usize, private: usize, peak_private: usize }
    #[cfg(windows)]
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn K32GetProcessMemoryInfo(process: isize, counters: *mut Counters, cb: u32) -> i32;
    }
    /// (peak working set, peak private bytes) of this process so far, in MB
    #[cfg(windows)]
    fn peak_mb() -> (f64, f64) {
        let mut c = Counters { cb: std::mem::size_of::<Counters>() as u32, faults: 0, peak_ws: 0, ws: 0, qpp: 0, qp: 0, qpnp: 0, qnp: 0, private: 0, peak_private: 0 };
        assert!(unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut c, c.cb) } != 0, "K32GetProcessMemoryInfo failed");
        (c.peak_ws as f64 / 1e6, c.peak_private as f64 / 1e6)
    }

    #[test]
    #[ignore]
    #[cfg(windows)]
    fn measure_the_three_references_cold_and_warm() {
        let tracks = installed();
        let (ws0, pr0) = peak_mb();
        println!("before any read: peak working set {ws0:.1} MB, peak private {pr0:.1} MB");
        for (alias, track, layout) in references() {
            DISK_BYTES.store(0, Ordering::SeqCst);
            let t = std::time::Instant::now();
            let f = collect_with(&tracks, &track, &layout, &|p, keep| { let u = Unbuffered::open(p).map_err(|e| e.to_string())?; let len = u.len; read_kn5(u, len, keep) }).unwrap();
            let bytes = encode(&assemble(f)).len();
            let cold = ms(t);
            let disk = DISK_BYTES.load(Ordering::SeqCst) as f64 / 1e6;
            let mut warm: Vec<f64> = (0..5).map(|_| { let t = std::time::Instant::now(); let n = encode(&read_road(&tracks, &track, &layout).unwrap()).len(); assert_eq!(n, bytes); ms(t) }).collect();
            warm.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let r = read_road(&tracks, &track, &layout).unwrap();
            if let Ok(dir) = std::env::var("T180_ROAD_DUMP") { fs::write(Path::new(&dir).join(format!("{alias}.road")), encode(&r)).unwrap(); }   // for a frame-time harness
            let (ws, pr) = peak_mb();
            println!("{alias}: cold {cold:.0} ms ({disk:.1} MB off the disk, unbuffered); warm {:.0} ms median of 5 ({:.0} to {:.0}); read and encoded. \
                      {} files, {} meshes, {} triangles, {} vertices, {} batches, {bytes} bytes to the page. Peak so far: working set {ws:.1} MB, private {pr:.1} MB",
                     warm[2], warm[0], warm[4], r.files, r.meshes, r.triangles, r.vertices, r.batches.len());
        }
    }

    /// A refusal's reason with the file name before it and any quoted mesh name taken out, so no author's name is printed.
    fn reason(e: &str) -> String {
        let e = e.split_once(".kn5: ").map_or(e, |x| x.1);
        let mut out = String::new();
        let mut quoted = false;
        for c in e.chars() { if c == '"' { quoted = !quoted; if quoted { out.push_str("<mesh>"); } } else if !quoted { out.push(c); } }
        out
    }

    #[test]
    #[ignore]
    #[cfg(windows)]
    fn every_installed_layout_reads_or_says_why() {
        let tracks = installed();
        let all = crate::reference::list_layouts(&tracks).unwrap();
        let (mut read, mut most) = (0, (0usize, 0usize, 0f64));
        let mut starts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();   // (has an AI line, where the start is from) -> layouts
        for (n, l) in all.iter().enumerate() {
            let t = std::time::Instant::now();
            match read_road(&tracks, &l.track, &l.layout) {
                Ok(r) => {
                    let bytes = encode(&r).len();
                    let took = ms(t);
                    read += 1;
                    if r.triangles > most.0 {
                        most = (r.triangles, bytes, took);
                        if let Ok(dir) = std::env::var("T180_ROAD_DUMP") { fs::write(Path::new(&dir).join("the largest layout.road"), encode(&r)).unwrap(); }
                    }
                    let from = r.start.as_ref().map_or("no start", |s| s.from);
                    *starts.entry(format!("{} AI line, start from {from}", if l.has_ai { "with an" } else { "NO" })).or_insert(0) += 1;
                    println!("layout {}: {} files ({} missing), {} meshes, {} triangles, {} batches, {bytes} bytes, {took:.0} ms, surfaces from {}, {} AI line, start from {from}",
                             n + 1, r.files, r.missing, r.meshes, r.triangles, r.batches.len(), r.surfaces, if l.has_ai { "with an" } else { "NO" });
                }
                Err(e) => println!("layout {}: REFUSED: {}", n + 1, reason(&e)),
            }
        }
        let (ws, pr) = peak_mb();
        println!("{read} of {} layouts read. The most: {} triangles, {} bytes, {:.0} ms. Peak: working set {ws:.1} MB, private {pr:.1} MB", all.len(), most.0, most.1, most.2);
        for (k, v) in &starts { println!("{v} layouts: {k}"); }
    }
}
