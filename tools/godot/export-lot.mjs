// tools/godot/export-lot.mjs (W12 G-WORLD): The Lot for the Godot game, exported from the same TypeScript that builds
// the web world and the sim, so all three stand on the same ground.
//   npx tsx tools/godot/export-lot.mjs            writes engines/godot/data/the_lot.json + the_lot_heights.bin
//   npx tsx tools/godot/export-lot.mjs --check    exits 1 when the committed files differ from a fresh export
// Source: buildTheLot(LOT_SEED) (src/shared/world/the-lot.ts) and the web's kit split (splitLotKitPrims in
// src/client/assets/kit-glb.ts), so Godot places the six shared kit GLBs on exactly the placements ?kit=glb uses.
// Units and axes are the sim's: metres, +Y up, the same x / z. Rotations are Euler 'YXZ' (yaw, then pitch about the
// turned x, then roll), as PropBox / VisualPrim / KitPlacement. Numbers are rounded to 1e-5 m (1e-6 for angles).
// The heightfield goes to a little-endian float32 file: the sim's own Float32Array, byte for byte (433 KB; as JSON
// text it would be ~760 KB and rounded). tests/unit/godot-lot-data.test.ts fails when either file drifts.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import { buildTheLot, lotFloodlights } from '../../src/shared/world/the-lot';
import { gridHeight } from '../../src/shared/world/terrain';
import { splitLotKitPrims, kitTint } from '../../src/client/assets/kit-glb';
import { worldHex, worldSurface } from '../../src/client/world/world-palette';

/** The fixed seed of the Godot Lot (the seed moves the mud and the clutter jitter, never the layout). */
export const LOT_SEED = 1;
export const OUT_DIR = 'engines/godot/data';
export const JSON_NAME = 'the_lot.json';
export const BIN_NAME = 'the_lot_heights.bin';

/**
 * The slab: the one neutral control area. The map is point-symmetric about the origin (the corgi base at the
 * north-west pit, the cats' at the south-east heap), so the origin is the only spot equally far from both teams by
 * construction. It lies on the middle causeway (dry, x -14..14) across the ditch, clear of every collider and prim.
 */
export const SLAB = { x: 0, z: 0, size: [8, 8] };

const r5 = (v) => { const r = Math.round(v * 1e5) / 1e5; return r === 0 ? 0 : r; };
const r6 = (v) => { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; };
const v3 = (a) => [r5(a[0]), r5(a[1]), r5(a[2])];
const SHAPES = ['box', 'cyl', 'cone', 'sphere', 'ring', 'torus'];

/** A prim as a row: [shape, x, y, z, a, b, c, yaw, pitch, roll, col, seg, bev]. */
const primRow = (q) => [q.s, r5(q.x), r5(q.y), r5(q.z), r5(q.a), r5(q.b), r5(q.c), r6(q.yaw ?? 0), r6(q.pitch ?? 0), r6(q.roll ?? 0), q.col, q.seg ?? 0, r5(q.bev ?? 0)];

/** Corners of a PropBox as the sim turns it (three's Euler 'YXZ'): the reference for Godot's Basis.from_euler test. */
function boxCorners(b) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.pitch ?? 0, b.rotY ?? 0, b.roll ?? 0, 'YXZ'));
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const v = new THREE.Vector3(sx * b.hx, sy * b.hy, sz * b.hz).applyQuaternion(q);
    out.push(v3([b.x + v.x, b.y + v.y, b.z + v.z]));
  }
  return out;
}

/** Height of a grid cell split on the other (a-d) diagonal: where it differs most, a probe tells the two apart. */
function otherDiagonal(g, x, z) {
  const u = (x - g.x0) / g.cell, v = (z - g.z0) / g.cell, i = Math.floor(u), j = Math.floor(v), fx = u - i, fz = v - j, n = g.n, H = g.heights;
  const a = H[j * n + i], b = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
  return fx >= fz ? a + (b - a) * fx + (d - b) * fz : a + (c - a) * fz + (d - c) * fx;
}

export function exportLot(seed = LOT_SEED) {
  const d = buildTheLot(seed);
  const g = d.terrain;
  const split = splitLotKitPrims(d);
  const cols = new Set();
  const note = (rows) => { for (const r of rows) cols.add(r[10]); return rows; };

  const kit = split.pieces.map((p) => {
    const tint = p.piece.paintTint;
    return {
      name: p.piece.name,
      glb: `assets/masters/${p.piece.name}.glb`,
      lodDist: [...p.piece.lodDist],
      centreY: r5(p.piece.centreY),
      paintTint: tint,
      missing: p.missing,
      /** [x, y, z, yaw, pitch, sz, tintR, tintG, tintB] (the tint is linear, 1 1 1 when the piece is not tinted). */
      placements: p.placements.map((q) => {
        const t = tint ? kitTint(q.col) : { r: 1, g: 1, b: 1 };
        return [r5(q.x), r5(q.y), r5(q.z), r6(q.yaw), r6(q.pitch ?? 0), r6(q.sz ?? 1), r5(t.r), r5(t.g), r5(t.b)];
      }),
      ids: p.placements.map((q) => q.id),
      /** The procedural stand-in (what the piece replaces): drawn only if the GLB fails to load. */
      fallbackPrims: note(p.matched.map(primRow)),
    };
  });
  const prims = note(split.rest.map(primRow));
  for (const w of d.water) if (w.tint) cols.add(w.tint);
  cols.add('fenceWood');
  const palette = {};
  for (const k of [...cols].sort()) {
    const s = worldSurface(k);
    palette[k] = { hex: '#' + worldHex(k).toString(16).padStart(6, '0'), rough: r5(s[0]), metal: r5(s[1]) };
  }

  // spawns per team, in the sim's order (16 each)
  const spawns = { 0: [], 1: [] };
  for (const s of d.spawns) spawns[s.team].push([r5(s.x), r5(s.y), r5(s.z), r6(s.yaw)]);

  // the slab: centre on the ground, and the ground's range under it (for the walkability test)
  let lo = Infinity, hi = -Infinity;
  for (let x = SLAB.x - SLAB.size[0] / 2; x <= SLAB.x + SLAB.size[0] / 2 + 1e-9; x += 0.25)
    for (let z = SLAB.z - SLAB.size[1] / 2; z <= SLAB.z + SLAB.size[1] / 2 + 1e-9; z += 0.25) { const h = d.height(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }

  // terrain probes: the 16 off-grid points (a fixed lattice) where the sim's b-c split differs most from the a-d split
  const probes = [];
  for (let x = -150.37; x < 150; x += 3.1) for (let z = -150.61; z < 150; z += 2.9) {
    const h = gridHeight(g, x, z);
    probes.push([r5(x), r5(z), h, Math.abs(h - otherDiagonal(g, x, z))]);
  }
  probes.sort((p, q) => q[3] - p[3] || p[0] - q[0] || p[1] - q[1]);
  const turned = [...d.props].sort((p, q) => (Math.abs(q.pitch ?? 0) + Math.abs(q.roll ?? 0)) - (Math.abs(p.pitch ?? 0) + Math.abs(p.roll ?? 0)))[0];
  const turnedIndex = d.props.indexOf(turned);

  const heights = Buffer.from(g.heights.buffer, g.heights.byteOffset, g.heights.byteLength);
  let hmin = Infinity, hmax = -Infinity;
  for (const h of g.heights) { hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); }
  const json = {
    format: 'cvc-lot/1',
    source: 'buildTheLot(seed) src/shared/world/the-lot.ts; kit placements: splitLotKitPrims() src/client/assets/kit-glb.ts; tools/godot/export-lot.mjs',
    seed,
    name: d.name,
    units: 'metres, +Y up, x/z as the TS sim; rotations Euler YXZ (yaw, pitch, roll)',
    halfExtent: d.halfExtent,
    bounds: d.bounds,
    killY: d.killY,
    bedLevel: d.bedLevel,
    timeOfDay: d.timeOfDay,
    weatherBias: d.weatherBias,
    terrain: {
      x0: g.x0, z0: g.z0, cell: g.cell, n: g.n,
      heights: BIN_NAME, heightsFormat: 'float32 little-endian, row-major: heights[j * n + i] at (x0 + i * cell, z0 + j * cell)',
      split: 'each cell (a=(i,j), b=(i+1,j), c=(i,j+1), d=(i+1,j+1)) is two triangles (a,c,b) and (b,c,d): the b-c diagonal (Rapier, gridHeight)',
      min: r5(hmin), max: r5(hmax),
      sha256: createHash('sha256').update(heights).digest('hex'),
    },
    palette,
    primFields: ['shape', 'x', 'y', 'z', 'a', 'b', 'c', 'yaw', 'pitch', 'roll', 'col', 'seg', 'bev'],
    primShapes: 'box [a,b,c = size x,y,z]; cyl [a = top radius, b = height, c = bottom radius]; cone [a = radius, b = height]; sphere [a,b,c = radii]; ring [a = outer radius, b = height, c = wall] along its local y; all centre-positioned',
    prims,
    colliders: {
      boxFields: ['type', 'x', 'y', 'z', 'hx', 'hy', 'hz', 'yaw', 'pitch', 'roll'],
      boxes: d.props.map((p) => [p.type, r5(p.x), r5(p.y), r5(p.z), r5(p.hx), r5(p.hy), r5(p.hz), r6(p.rotY ?? 0), r6(p.pitch ?? 0), r6(p.roll ?? 0)]),
      cylinderFields: ['type', 'x', 'y', 'z', 'r', 'hh'],
      cylinders: d.cylinders.map((c) => [c.type, r5(c.x), r5(c.y), r5(c.z), r5(c.r), r5(c.hh)]),
    },
    kitFields: ['x', 'y', 'z', 'yaw', 'pitch', 'sz', 'tintR', 'tintG', 'tintB'],
    kit,
    spawns,
    slab: { center: v3([SLAB.x, d.height(SLAB.x, SLAB.z), SLAB.z]), size: SLAB.size, groundMin: r5(lo), groundMax: r5(hi),
      why: 'the origin: the centre of point symmetry (equally far from both bases), on the dry middle causeway across the ditch, clear of every collider and prim' },
    floodlights: lotFloodlights(d).map((f) => ({ id: f.id, team: f.team, pos: v3(f.pos), target: v3(f.target) })),
    bases: (d.bases ?? []).map((b) => ({ team: b.team, flag: v3(b.flag), ballStand: v3(b.ballStand) })),
    interiors: (d.interiors ?? []).map((b) => ({ min: v3(b.min), max: v3(b.max) })),
    water: d.water.map((w) => ({ id: w.id, x: r5(w.x), z: r5(w.z), hx: r5(w.hx ?? 0), hz: r5(w.hz ?? 0), surfaceY: r5(w.surfaceY), bottomY: r5(w.bottomY), tint: w.tint ?? null })),
    fences: (d.fences ?? []).map((f) => ({ x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1, h: f.h, face: f.face })),
    lamps: (d.lamps ?? []).map((l) => [r5(l.x), r5(l.y), r5(l.z), r5(l.len), r6(l.yaw ?? 0), l.col ?? null]),
    districts: d.districts ?? [],
    perches: (d.perches ?? []).map((p) => ({ ...p, x: r5(p.x), y: r5(p.y), z: r5(p.z), yaw: r6(p.yaw) })),
    bookmarks: d.bookmarks.map((b) => ({ name: b.name, pos: v3(b.pos), look: v3(b.look), fov: b.fov ?? 60 })),
    checks: {
      terrainProbes: probes.slice(0, 16).map((p) => [p[0], p[1], r5(p[2]), r5(p[3])]),
      turnedBox: { index: turnedIndex, corners: boxCorners(turned) },
    },
  };
  return { json: JSON.stringify(json, null, 1) + '\n', bin: heights };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { json, bin } = exportLot();
  const jp = `${OUT_DIR}/${JSON_NAME}`, bp = `${OUT_DIR}/${BIN_NAME}`;
  if (process.argv.includes('--check')) {
    const same = (p, b) => { try { return Buffer.compare(readFileSync(p), Buffer.from(b)) === 0; } catch { return false; } };
    const ok = same(jp, json) && same(bp, bin);
    console.log(ok ? 'LOT EXPORT: up to date' : 'LOT EXPORT: DRIFT (run npx tsx tools/godot/export-lot.mjs)');
    process.exit(ok ? 0 : 1);
  }
  mkdirSync(dirname(jp), { recursive: true });
  writeFileSync(jp, json);
  writeFileSync(bp, bin);
  console.log(`wrote ${jp} (${(json.length / 1024).toFixed(1)} KB) and ${bp} (${(bin.length / 1024).toFixed(1)} KB), seed ${LOT_SEED}`);
}
