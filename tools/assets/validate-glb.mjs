// validate-glb.mjs (W11 P-GLB1): enforces docs/design/ASSET_PIPELINE.md "Standards" on one GLB (glTF-Transform).
//   node tools/assets/validate-glb.mjs <file.glb> [--manifest assets/manifest.json] [--hero] [--json]
// Exit 0 = PASS, 1 = FAIL (every broken rule is listed), 2 = usage / unreadable file.
// Checks:
//   names   one scene, one root node named Kit_<Set>_<Thing>_<NN> or Char_<Species>_<Class>; kits have <root>_LOD0|1|2
//           and COL_<root>_<n> children and nothing else that renders
//   units   metres, +Y up, pivot at the base centre: the root has no transform, LOD0's world bounds sit on y = 0
//           (+-1 cm) and its ground contact (vertices within 1 cm of the bottom) is centred on x = z = 0 (+-1 cm); with a manifest entry, the size matches it (+-5 cm per axis,
//           which also pins the axes: a Z-up or a centimetre export fails)
//   LODs    triangle budgets LOD0 <= 2500, LOD1 <= 800, LOD2 <= 200, each LOD cheaper than the one before, footprints
//           within 15 cm of LOD0, TRIANGLES mode, POSITION/NORMAL/TEXCOORD_0 present (TANGENT recommended)
//   COL_    every collision node is an axis-aligned box (one primitive, 8 corner positions, 12 triangles, no rotation),
//           has no material (never rendered) and extras.collider = 'box'
//   PBR     every visual primitive has a material with baseColor, ORM (occlusion + metallicRoughness = one texture) and
//           normal textures, alpha OPAQUE; textures square, power of two, 1024^2 for kits (2048^2 only with --hero)
//   files   master: PNG images, no compression extensions (the file Godot imports); web variant: EXT_meshopt_compression +
//           EXT_texture_webp, WebP images, <= 600 KB
//   misc    no skins / animations on kit pieces; finite positions
// validateGlb(path, opts) is exported for tests (tests/unit/glb-validate.test.ts).
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO, ImageUtils, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

export const BUDGETS = { tris: [2500, 800, 200], webBytes: 600 * 1024, kitTexture: 1024, heroTexture: 2048 };
const NAME_RE = /^(Kit_[A-Z][A-Za-z0-9]*_[A-Z][A-Za-z0-9]*_\d{2}|Char_[A-Z][A-Za-z0-9]*_[A-Z][A-Za-z0-9]*)$/;
const EPS = 0.01;

export async function createIO() {
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

function triCount(mesh) {
  let n = 0;
  for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
}

const isIdentityRot = (q) => Math.abs(q[0]) < 1e-6 && Math.abs(q[1]) < 1e-6 && Math.abs(q[2]) < 1e-6 && Math.abs(Math.abs(q[3]) - 1) < 1e-6;

/** World-space corner positions of a node's mesh (node world matrix applied). */
function worldPositions(node) {
  const m = node.getWorldMatrix();
  const out = [];
  for (const p of node.getMesh().listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      out.push([
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
      ]);
    }
  }
  return out;
}

/** COL_ boxes of a document in the root's space: { name, min, max, center, half }. */
export function colliderBoxes(doc) {
  const out = [];
  for (const n of doc.getRoot().listNodes()) {
    if (!n.getName().startsWith('COL_') || !n.getMesh()) continue;
    const ps = worldPositions(n);
    const min = [0, 1, 2].map((k) => Math.min(...ps.map((p) => p[k])));
    const max = [0, 1, 2].map((k) => Math.max(...ps.map((p) => p[k])));
    out.push({ name: n.getName(), min, max, center: min.map((v, k) => (v + max[k]) / 2), half: min.map((v, k) => (max[k] - v) / 2) });
  }
  return out;
}

/**
 * Validates one GLB. opts: { manifest?: object (parsed assets/manifest.json), hero?: boolean, bytes?: number (file size
 * when validating an in-memory document), doc?: Document (skip reading the file) }.
 * Returns { ok, errors, warnings, report }.
 */
export async function validateGlb(path, opts = {}) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  const io = await createIO();
  const doc = opts.doc ?? await io.read(path);
  const bytes = opts.bytes ?? statSync(path).size;
  const root = doc.getRoot();
  const report = { file: path, bytes, variant: null, root: null, nodes: [], lods: [], colliders: 0, materials: [], textures: [], extensions: root.listExtensionsUsed().map((e) => e.extensionName) };

  // ---- variant
  const exts = new Set(report.extensions);
  const images = root.listTextures().map((t) => t.getMimeType());
  const web = exts.has('EXT_meshopt_compression') || images.includes('image/webp');
  report.variant = web ? 'web' : 'master';
  if (web) {
    if (!exts.has('EXT_meshopt_compression')) err('web variant: EXT_meshopt_compression missing');
    if (!exts.has('EXT_texture_webp')) err('web variant: EXT_texture_webp missing');
    if (images.some((m) => m !== 'image/webp')) err(`web variant: every image must be WebP (got ${images.join(', ')})`);
    if (bytes > BUDGETS.webBytes) err(`web variant: ${bytes} bytes > ${BUDGETS.webBytes} (600 KB)`);
  } else {
    for (const e of ['EXT_meshopt_compression', 'KHR_draco_mesh_compression', 'EXT_texture_webp', 'KHR_texture_basisu', 'KHR_mesh_quantization']) if (exts.has(e)) err(`master: ${e} is not allowed (the master stays plain for Godot)`);
    if (images.some((m) => m !== 'image/png')) err(`master: every image must be PNG (got ${images.join(', ')})`);
  }

  // ---- scene + root
  const scenes = root.listScenes();
  if (scenes.length !== 1) err(`expected 1 scene, got ${scenes.length}`);
  const tops = scenes[0]?.listChildren() ?? [];
  if (tops.length !== 1) { err(`expected 1 root node, got ${tops.length}`); }
  const top = tops[0];
  if (!top) return { ok: false, errors, warnings, report };
  const name = top.getName();
  report.root = name;
  if (!NAME_RE.test(name)) err(`root name "${name}" breaks Kit_<Set>_<Thing>_<NN> / Char_<Species>_<Class>`);
  const t = top.getTranslation(), r = top.getRotation(), s = top.getScale();
  if (t.some((v) => Math.abs(v) > 1e-6) || !isIdentityRot(r) || s.some((v) => Math.abs(v - 1) > 1e-6)) err(`root "${name}" must have no transform (got T ${t} R ${r} S ${s}): scale and pivot live in the mesh`);
  const isKit = name.startsWith('Kit_');
  if (isKit && (root.listSkins().length || root.listAnimations().length)) err('a kit piece has no skins or animations');

  // ---- nodes
  const kids = top.listChildren();
  const lods = [0, 1, 2].map((i) => kids.find((k) => k.getName() === `${name}_LOD${i}`));
  const cols = kids.filter((k) => k.getName().startsWith('COL_'));
  for (const k of kids) {
    const kn = k.getName();
    report.nodes.push(kn);
    if (!lods.includes(k) && !cols.includes(k)) err(`unexpected child "${kn}" (only ${name}_LOD0|1|2 and COL_${name}_<n>)`);
    if (k.listChildren().length) err(`"${kn}" must have no children`);
  }
  if (isKit) lods.forEach((l, i) => { if (!l || !l.getMesh()) err(`missing ${name}_LOD${i} (with a mesh)`); });

  // ---- LODs: bounds, budgets, attributes, materials
  let b0 = null;
  const matSet = new Set();
  lods.forEach((l, i) => {
    if (!l || !l.getMesh()) return;
    if (!isIdentityRot(l.getRotation())) err(`${l.getName()}: no rotation allowed`);
    const tris = triCount(l.getMesh());
    const b = getBounds(l);
    report.lods.push({ name: l.getName(), tris, min: b.min.map((v) => +v.toFixed(4)), max: b.max.map((v) => +v.toFixed(4)) });
    if (tris > BUDGETS.tris[i]) err(`${l.getName()}: ${tris} triangles > budget ${BUDGETS.tris[i]}`);
    if (i > 0 && report.lods[i - 1] && tris >= report.lods[i - 1].tris) err(`${l.getName()}: ${tris} triangles, not cheaper than LOD${i - 1}`);
    if (i === 0) b0 = b;
    else if (b0) for (let k = 0; k < 3; k++) if (Math.abs(b.min[k] - b0.min[k]) > 0.15 || Math.abs(b.max[k] - b0.max[k]) > 0.15) { err(`${l.getName()}: footprint differs from LOD0 by more than 15 cm`); break; }
    for (const p of l.getMesh().listPrimitives()) {
      if (p.getMode() !== 4) err(`${l.getName()}: primitive mode ${p.getMode()} (TRIANGLES required)`);
      for (const a of ['POSITION', 'NORMAL', 'TEXCOORD_0']) if (!p.getAttribute(a)) err(`${l.getName()}: ${a} missing`);
      if (!p.getAttribute('TANGENT')) warn(`${l.getName()}: no TANGENT (engines derive them)`);
      const pos = p.getAttribute('POSITION'), v = [0, 0, 0];
      for (let j = 0; j < pos.getCount(); j++) { pos.getElement(j, v); if (!v.every(Number.isFinite)) { err(`${l.getName()}: non-finite position`); break; } }
      const m = p.getMaterial();
      if (!m) { err(`${l.getName()}: primitive without a material`); continue; }
      matSet.add(m);
    }
  });
  if (b0) {
    const size = b0.max.map((v, k) => v - b0.min[k]);
    report.size = size.map((v) => +v.toFixed(4));
    if (Math.abs(b0.min[1]) > EPS) err(`pivot: LOD0 bottom at y = ${b0.min[1].toFixed(4)} m (must sit on y = 0)`);
    // the base centre: the middle of LOD0's ground contact (vertices within 1 cm of its bottom), so an appendage above the
    // ground (an open door leaf, a lamp arm) does not move the pivot
    const foot = worldPositions(lods[0]).filter((p) => p[1] < b0.min[1] + EPS);
    for (const k of [0, 2]) {
      const c = (Math.min(...foot.map((p) => p[k])) + Math.max(...foot.map((p) => p[k]))) / 2;
      report[`base_${'xyz'[k]}`] = +c.toFixed(4);
      if (Math.abs(c) > EPS) err(`pivot: the ground contact is centred at ${'xyz'[k]} = ${c.toFixed(4)} m (must be 0: base centre)`);
    }
    if (size.some((v) => v < 0.05 || v > 60)) err(`units: size ${report.size.join(' x ')} m is not a metre-scale kit piece`);
    const entry = opts.manifest?.assets?.find((a) => a.name === name);
    if (entry?.size_m) entry.size_m.forEach((v, k) => { if (Math.abs(size[k] - v) > 0.05) err(`units/axes: LOD0 ${'xyz'[k]} size ${size[k].toFixed(3)} m, manifest says ${v} (+Y up, front +Z)`); });
    else if (opts.manifest) warn(`no manifest entry with size_m for ${name}`);
  }

  // ---- COL_
  report.colliders = cols.length;
  if (isKit && !cols.length) err('no COL_ collision boxes');
  const colRe = new RegExp(`^COL_${name}_\\d+$`);
  for (const c of cols) {
    const cn = c.getName();
    if (!colRe.test(cn)) err(`collision node "${cn}" must be named COL_${name}_<n>`);
    const mesh = c.getMesh();
    if (!mesh) { err(`${cn}: no mesh`); continue; }
    if (!isIdentityRot(c.getRotation())) err(`${cn}: rotated (COL_ boxes are axis-aligned)`);
    const prims = mesh.listPrimitives();
    if (prims.length !== 1) err(`${cn}: ${prims.length} primitives (1 box)`);
    if (prims.some((p) => p.getMaterial())) err(`${cn}: has a material (collision is never rendered)`);
    if (triCount(mesh) !== 12) err(`${cn}: ${triCount(mesh)} triangles (a box has 12)`);
    const ps = worldPositions(c);
    const uniq = new Set(ps.map((p) => p.map((v) => v.toFixed(4)).join(',')));
    if (uniq.size !== 8) err(`${cn}: ${uniq.size} distinct corners (a box has 8)`);
    const min = [0, 1, 2].map((k) => Math.min(...ps.map((p) => p[k]))), max = [0, 1, 2].map((k) => Math.max(...ps.map((p) => p[k])));
    if (ps.some((p) => p.some((v, k) => Math.abs(v - min[k]) > 1e-4 && Math.abs(v - max[k]) > 1e-4))) err(`${cn}: not an axis-aligned box`);
    if (c.getExtras()?.collider !== 'box') err(`${cn}: extras.collider must be "box"`);
    if (b0 && min.some((v, k) => v < b0.min[k] - 0.5) || b0 && max.some((v, k) => v > b0.max[k] + 0.5)) err(`${cn}: outside the visual bounds by more than 0.5 m`);
  }

  // ---- materials + textures
  const texLimit = opts.hero ? BUDGETS.heroTexture : BUDGETS.kitTexture;
  for (const m of matSet) {
    const mr = { name: m.getName(), alpha: m.getAlphaMode(), baseColor: !!m.getBaseColorTexture(), orm: false, normal: !!m.getNormalTexture() };
    const bc = m.getBaseColorTexture(), rm = m.getMetallicRoughnessTexture(), oc = m.getOcclusionTexture(), nm = m.getNormalTexture();
    if (!bc) err(`material "${m.getName()}": no baseColor texture`);
    if (!rm || !oc) err(`material "${m.getName()}": ORM needs both occlusion and metallicRoughness textures`);
    else if (rm !== oc) err(`material "${m.getName()}": occlusion and metallicRoughness must share one ORM texture`);
    else mr.orm = true;
    if (!nm) err(`material "${m.getName()}": no normal texture`);
    if (m.getAlphaMode() !== 'OPAQUE') err(`material "${m.getName()}": alphaMode ${m.getAlphaMode()} (kit pieces are OPAQUE)`);
    report.materials.push(mr);
  }
  const textures = root.listTextures();
  if (isKit && textures.length > 3) err(`${textures.length} textures (a kit piece has 3: baseColor, ORM, normal)`);
  for (const tx of textures) {
    const size = ImageUtils.getSize(tx.getImage(), tx.getMimeType());
    const [w, h] = size ?? [0, 0];
    report.textures.push({ name: tx.getName() || tx.getURI(), mime: tx.getMimeType(), size: [w, h], bytes: tx.getImage()?.byteLength ?? 0 });
    if (!size) { err(`texture "${tx.getName()}": unreadable size`); continue; }
    if (w !== h || (w & (w - 1)) !== 0) err(`texture "${tx.getName()}": ${w}x${h} (square power of two)`);
    if (w > texLimit) err(`texture "${tx.getName()}": ${w}^2 > ${texLimit}^2${opts.hero ? '' : ' (2048^2 is for heroes: --hero)'}`);
    if (isKit && !opts.hero && w !== BUDGETS.kitTexture) err(`texture "${tx.getName()}": kit pieces bake at ${BUDGETS.kitTexture}^2 (got ${w})`);
  }
  return { ok: errors.length === 0, errors, warnings, report };
}

// ---------------------------------------------------------------------------------------------------------- CLI
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--manifest');
  if (!file) { console.error('usage: node tools/assets/validate-glb.mjs <file.glb> [--manifest assets/manifest.json] [--hero] [--json]'); process.exit(2); }
  const mi = argv.indexOf('--manifest');
  const manifestPath = mi >= 0 ? argv[mi + 1] : resolve(import.meta.dirname, '../../assets/manifest.json');
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* validated without a manifest */ }
  let res;
  try { res = await validateGlb(file, { manifest, hero: argv.includes('--hero') }); } catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(2); }
  if (argv.includes('--json')) console.log(JSON.stringify(res, null, 2));
  else {
    const R = res.report;
    console.log(`${file}  [${R.variant}]  ${R.bytes} bytes  root ${R.root}  size ${R.size?.join(' x ') ?? '?'} m  COL_ ${R.colliders}`);
    for (const l of R.lods) console.log(`  ${l.name}: ${l.tris} tris  min ${l.min.join(',')}  max ${l.max.join(',')}`);
    for (const m of R.materials) console.log(`  material ${m.name}: baseColor ${m.baseColor} ORM ${m.orm} normal ${m.normal} ${m.alpha}`);
    for (const t of R.textures) console.log(`  texture ${t.name}: ${t.mime} ${t.size.join('x')} ${t.bytes} bytes`);
    console.log(`  extensions: ${R.extensions.join(', ') || 'none'}`);
    for (const w of res.warnings) console.log(`  warn: ${w}`);
    for (const e of res.errors) console.log(`  FAIL: ${e}`);
    console.log(res.ok ? 'VALIDATE: PASS' : `VALIDATE: FAIL (${res.errors.length})`);
  }
  process.exit(res.ok ? 0 : 1);
}
