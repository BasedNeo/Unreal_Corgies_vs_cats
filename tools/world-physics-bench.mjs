// Terrain collider robustness + cost bench for the West Yard (world lane).
//   npx tsx tools/world-physics-bench.mjs
// For several terrain collider variants: vertical-ray miss rate (0.5 m lattice + random points),
// characters dropped exactly on grid vertices (fall-through), and KCC movement cost for 8 runners.
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorldData } from '../src/shared/world/world-data.ts';
import { heightfieldMatrix } from '../src/sim/world/build.ts';
import { WORLD_GROUPS, CHARACTER_GROUPS, CHARACTER_MOVE_FILTER } from '../src/sim/rapier.ts';
import { mulberry32 } from '../src/shared/rng.ts';

await RAPIER.init();
const data = createWorldData(1);
const g = data.terrain;

function terrainCollider(world, variant) {
  const res = g.n - 1, size = res * g.cell;
  if (variant.kind === 'heightfield') {
    const flags = variant.fix ? RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES : undefined;
    world.createCollider(RAPIER.ColliderDesc.heightfield(res, res, heightfieldMatrix(g), { x: size, y: 1, z: size }, flags)
      .setTranslation(g.x0 + size / 2, 0, g.z0 + size / 2).setCollisionGroups(WORLD_GROUPS));
  } else if (variant.kind === 'chunks') {
    const per = variant.per, cells = res / per;
    for (let cj = 0; cj < per; cj++) for (let ci = 0; ci < per; ci++) {
      const n = cells + 1, m = new Float32Array(n * n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) m[i * n + j] = g.heights[(cj * cells + j) * g.n + ci * cells + i];
      const s = cells * g.cell;
      const flags = variant.fix ? RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES : undefined;
      world.createCollider(RAPIER.ColliderDesc.heightfield(cells, cells, m, { x: s, y: 1, z: s }, flags)
        .setTranslation(g.x0 + ci * s + s / 2, 0, g.z0 + cj * s + s / 2).setCollisionGroups(WORLD_GROUPS));
    }
  } else if (variant.kind === 'trimesh') {
    const v = new Float32Array(g.n * g.n * 3), idx = new Uint32Array(res * res * 6);
    for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) { const k = j * g.n + i; v[k * 3] = g.x0 + i * g.cell; v[k * 3 + 1] = g.heights[k]; v[k * 3 + 2] = g.z0 + j * g.cell; }
    let o = 0;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const a = j * g.n + i, b = a + 1, c = a + g.n, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    const flags = variant.fix ? RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES : undefined;
    world.createCollider(RAPIER.ColliderDesc.trimesh(v, idx, flags).setCollisionGroups(WORLD_GROUPS));
  }
}

function makeWorld(variant) {
  const world = new RAPIER.World({ x: 0, y: -24, z: 0 });
  world.timestep = 1 / 60;
  terrainCollider(world, variant);
  world.step();
  return world;
}

function rayMisses(world) {
  let miss = 0, n = 0, missR = 0, nR = 0;
  for (let z = -99; z <= 99; z += 0.5) for (let x = -99; x <= 99; x += 0.5) {
    n++;
    const hit = world.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true);
    if (!hit) miss++;
  }
  const rnd = mulberry32(5);
  for (let k = 0; k < 20000; k++) {
    nR++;
    const x = -99 + rnd() * 198, z = -99 + rnd() * 198;
    const hit = world.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true);
    if (!hit) missR++;
  }
  return { latticeMissPct: +(100 * miss / n).toFixed(3), randomMissPct: +(100 * missR / nR).toFixed(3) };
}

function kcc(world, { drops = false } = {}) {
  const ctl = world.createCharacterController(0.02);
  ctl.setUp({ x: 0, y: 1, z: 0 }); ctl.enableAutostep(0.45, 0.2, true); ctl.enableSnapToGround(0.35);
  ctl.setMaxSlopeClimbAngle((52 * Math.PI) / 180); ctl.setMinSlopeSlideAngle((58 * Math.PI) / 180);
  const chars = [];
  const pts = drops ? [] : [[-20, -30], [10, -40], [-40, 10], [30, 10], [0, 40], [-60, -60], [60, -60], [-10, 70]];
  if (drops) for (let z = -90; z <= 90; z += 20) for (let x = -90; x <= 90; x += 20) pts.push([x, z]);   // exact grid vertices
  for (const [x, z] of pts) {
    const y = data.height(x, z) + (drops ? 3 : 0.1);
    const c = world.createCollider(RAPIER.ColliderDesc.capsule(0.24, 0.36).setTranslation(x, y + 0.6, z).setCollisionGroups(CHARACTER_GROUPS));
    chars.push({ c, vy: 0, a: (x * 7 + z) % 6.28 });
  }
  let t = 0;
  const T = drops ? 120 : 600;
  for (let s = 0; s < T; s++) {
    const t0 = performance.now();
    for (const ch of chars) {
      ch.vy = Math.max(-40, ch.vy - 24 / 60);
      ch.a += 0.01;
      const dx = drops ? 0 : Math.cos(ch.a) * 6.4 / 60, dz = drops ? 0 : Math.sin(ch.a) * 6.4 / 60;
      ctl.computeColliderMovement(ch.c, { x: dx, y: ch.vy / 60, z: dz }, undefined, CHARACTER_MOVE_FILTER);
      const mv = ctl.computedMovement(), p = ch.c.translation();
      ch.c.setTranslation({ x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z });
      if (ctl.computedGrounded()) ch.vy = 0;
    }
    world.step();
    t += performance.now() - t0;
  }
  let fell = 0;
  for (const ch of chars) { const p = ch.c.translation(); if (p.y - 0.6 < data.height(p.x, p.z) - 0.5) fell++; }
  return { msPerTick: +(t / T).toFixed(3), chars: chars.length, fellThrough: fell };
}

const variants = [
  { name: 'heightfield 1m FIX_INTERNAL_EDGES', kind: 'heightfield', fix: true },
  { name: 'heightfield 1m no flags', kind: 'heightfield', fix: false },
  { name: 'heightfield 4x4 chunks no flags', kind: 'chunks', per: 4, fix: false },
  { name: 'trimesh 1m', kind: 'trimesh', fix: false },
  { name: 'trimesh 1m FIX_INTERNAL_EDGES', kind: 'trimesh', fix: true },
];
for (const v of variants) {
  const w1 = makeWorld(v);
  const rays = rayMisses(w1);
  const w2 = makeWorld(v);
  const move = kcc(w2);
  const w3 = makeWorld(v);
  const drop = kcc(w3, { drops: true });
  console.log(JSON.stringify({ variant: v.name, ...rays, kccMsPerTick8: move.msPerTick, runnersFell: move.fellThrough, dropsOnVertices: drop.chars, dropsFell: drop.fellThrough }));
  w1.free(); w2.free(); w3.free();
}
