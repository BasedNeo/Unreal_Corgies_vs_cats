#!/usr/bin/env node
// Character audit (L1): builds every species × class × tier × a few seeds and checks the MASTER_PLAN §6
// contract in one table — triangles (hero ≤ 6k, NPC ≤ 3.5k), draw calls (≤ 6), bones (≤ 48),
// style-system materials only, welded normals on the skinned body, no ink lines at all (W13 LOOK.md: the
// stylised-realistic look retired the ink hull and the crease lines), grounded feet, determinism. Exit 1 on any failure.
//   node tools/char-audit.mjs [--seeds 1,2,3] [--json]
import { tsImport } from 'tsx/esm/api';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const seeds = opt('seeds', '1,2,3').split(',').map(Number);
const url = import.meta.url;
const THREE = await tsImport('three/webgpu', url);
const chars = await tsImport('../src/client/procgen/characters/index.ts', url);
const { CLASS_IDS } = await tsImport('../src/shared/types.ts', url);
const { createCharacter, HERO_TRI_BUDGET, NPC_TRI_BUDGET, characterCacheSize } = chars;

const splitNormalRatio = (g) => {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const seen = new Map(); let split = 0, shared = 0;
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    const nn = [n.getX(i), n.getY(i), n.getZ(i)], prev = seen.get(k);
    if (!prev) { seen.set(k, nn); continue; }
    shared++;
    if (Math.abs(prev[0] - nn[0]) + Math.abs(prev[1] - nn[1]) + Math.abs(prev[2] - nn[2]) > 1e-3) split++;
  }
  return shared ? split / shared : 0;
};

const rows = [];
let failed = 0;
const frame = { speed: 0, vy: 0, grounded: true, anim: 0, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false };
for (const species of [0, 1]) for (const cls of CLASS_IDS) for (const isLocal of [true, false]) {
  const budget = isLocal ? HERO_TRI_BUDGET : NPC_TRI_BUDGET;
  let maxTris = 0, maxDraws = 0, bones = 0, minFoot = Infinity, maxFoot = -Infinity, ms = 0;
  const errors = [], variants = new Set();
  for (const seed of seeds) {
    const t0 = performance.now();
    const av = createCharacter({ species, cls, team: species, seed, isLocal });
    ms = Math.max(ms, performance.now() - t0);
    variants.add(av.stats.variant);
    let tris = 0, draws = 0;
    av.root.traverse((o) => {
      if (o.isLineSegments2) { draws++; errors.push(`${o.name}: ink lines (the look has none)`); return; }
      if (!o.isMesh) return;
      draws++;
      tris += (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3;
      for (const m of [o.material].flat()) {
        if (!m.userData?.style) errors.push(`${o.name}: material not from the style system`);
        if (o.isSkinnedMesh && !o.geometry.userData.outlineReady && splitNormalRatio(o.geometry) > 0.05) errors.push(`${o.name}: split normals on the skinned body`);
      }
    });
    bones = av.skinned.skeleton.bones.length;
    for (let i = 0; i < 20; i++) av.update(frame, 1 / 60);
    av.root.updateMatrixWorld(true);
    const pos = av.skinned.geometry.getAttribute('position'), v = new THREE.Vector3();
    let minY = Infinity;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); av.skinned.applyBoneTransform(i, v); minY = Math.min(minY, v.y); }
    minFoot = Math.min(minFoot, minY); maxFoot = Math.max(maxFoot, minY);
    maxTris = Math.max(maxTris, tris); maxDraws = Math.max(maxDraws, draws);
    if (tris > budget) errors.push(`${tris} tris > ${budget}`);
    if (draws > 6) errors.push(`${draws} draw calls > 6`);
    if (bones > 48) errors.push(`${bones} bones > 48`);
    if (Math.abs(minY) > 0.02) errors.push(`feet at y=${minY.toFixed(3)}`);
    // Determinism: a second avatar with the same seed shares the kit and the same variant.
    const twin = createCharacter({ species, cls, team: species, seed, isLocal });
    if (twin.skinned.geometry !== av.skinned.geometry || twin.stats.variant !== av.stats.variant) errors.push('same seed produced a different kit');
    twin.dispose(); av.dispose();
  }
  const pass = errors.length === 0;
  if (!pass) failed++;
  rows.push({ species: species ? 'cat' : 'corgi', cls, tier: isLocal ? 'hero' : 'npc', tris: maxTris, budget, draws: maxDraws, bones, feet: `${minFoot.toFixed(3)}..${maxFoot.toFixed(3)}`, buildMs: ms.toFixed(0), variants: [...variants].join('/'), ok: pass ? 'ok' : 'FAIL', errors: [...new Set(errors)] });
}
if (characterCacheSize() !== 0) { failed++; console.log(`cache leak: ${characterCacheSize()} kits still cached after dispose`); }

if (argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else {
  const cols = ['species', 'cls', 'tier', 'tris', 'budget', 'draws', 'bones', 'feet', 'buildMs', 'variants', 'ok'];
  const width = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c]).length))]));
  console.log(cols.map((c) => c.padEnd(width[c])).join('  '));
  for (const r of rows) {
    console.log(cols.map((c) => String(r[c]).padEnd(width[c])).join('  '));
    r.errors.slice(0, 4).forEach((e) => console.log(`    ✗ ${e}`));
  }
  console.log(failed ? `\n${failed} row(s) FAILED` : `\nall ${rows.length} character kits PASS (seeds ${seeds.join(',')})`);
}
process.exit(failed ? 1 : 0);
