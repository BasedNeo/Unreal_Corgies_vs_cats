// E4 client (headless): the Yard War dressing and ground from the battle layout — draw budget, style materials, the
// low tier dropping the clutter, clutter never inside a collider, the terrain's baked battle channels (scorch, mud,
// puddles, twin tyre ruts), damaged fence boards, and the merged props carrying per-vertex weathering.
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three/webgpu';
import { createWorldData, createFlatWorldData, type WorldData } from '../../src/shared/world/world-data';
import { battleOf, craterList, type BattleLayout } from '../../src/shared/world/fortifications';
import { occupiedAt } from '../../src/shared/world/queries';
import { createBattleDressing } from '../../src/client/world/battle-dressing';
import { battleChannels } from '../../src/client/world/terrain-view';
import { createFenceView } from '../../src/client/world/fence-view';
import { buildPrimMeshes, disposePrimMeshes } from '../../src/client/world/prim-mesh';

let data: WorldData;
let battle: BattleLayout;
beforeAll(() => { data = createWorldData(1); battle = battleOf(data)!; });

const meshesOf = (g: THREE.Object3D) => { const out: THREE.Mesh[] = []; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };

describe('E4 battle dressing (client)', () => {
  it('high tier: banners, nets, floodlights and clutter in <= 10 draws, every material from the style factory', () => {
    const d = createBattleDressing(data, { quality: 'high' });
    const st = d.stats();
    console.log('[fob-view] high', JSON.stringify(st));
    expect(st.dressingDraws).toBeLessThanOrEqual(10);
    expect(st.banners).toBe(4);
    expect(st.nets).toBe(2);
    expect(st.floods).toBe(6);
    expect(st.casings).toBeGreaterThan(150);
    expect(st.paws).toBeGreaterThan(100);
    expect(st.dressingTris).toBeLessThan(15000);
    for (const m of meshesOf(d.group)) {
      const style = (m.material as THREE.Material).userData.style;
      expect(['toon', 'toon-noink', 'glow', 'fx'], m.name).toContain(style);
      expect(m.userData.noCameraCollide, m.name).toBe(true);
    }
    // clutter lies on the ground and never inside a wall or a crate
    for (const m of meshesOf(d.group).filter((x) => (x as THREE.InstancedMesh).isInstancedMesh && x.name.startsWith('fob_'))) {
      const im = m as THREE.InstancedMesh, mat = new THREE.Matrix4(), p = new THREE.Vector3();
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, mat);
        p.setFromMatrixPosition(mat);
        expect(occupiedAt(data, p.x, data.height(p.x, p.z) + 0.12, p.z), `${m.name} #${i}`).toBe(false);
        expect(Math.abs(p.y - data.height(p.x, p.z)), `${m.name} #${i} on the ground`).toBeLessThan(0.12);
      }
    }
    d.dispose();
  });

  it('low tier drops the clutter (casings, balls, paw prints, splinters), keeps banners, nets and floodlights', () => {
    const d = createBattleDressing(data, { quality: 'low' });
    const st = d.stats();
    expect(st.casings + st.balls + st.paws + st.splinters).toBe(0);
    expect(st.banners).toBe(4);
    expect(st.floods).toBe(6);
    expect(st.dressingDraws).toBeLessThanOrEqual(5);
    d.dispose();
  });

  it('worlds without a battle layout get an empty dressing', () => {
    const d = createBattleDressing(createFlatWorldData(1));
    expect(d.group.children.length).toBe(0);
    expect(d.stats().dressingDraws).toBe(0);
  });
});

describe('E4 battle ground (terrain channels) and damaged fences', () => {
  it('bakes scorch + puddles into the craters, mud on the trench floors and twin ruts along the kart lines', () => {
    const at = (x: number, z: number) => battleChannels(battle, [x, 0, z], 1);
    for (const [x, z] of craterList()) {
      const c = at(x, z);
      expect(c[0], `scorch in crater ${x},${z}`).toBeGreaterThan(0.6);
      expect(c[2], `puddle in crater ${x},${z}`).toBeGreaterThan(0.5);
    }
    const t = battle.trenches[0].pts;
    expect(at((t[0] + t[2]) / 2, (t[1] + t[3]) / 2)[1], 'mud on the trench floor').toBeGreaterThan(0.8);
    // the corgi kart line: signed distance (m) across the line, 0.85 = a tyre track
    // (its 4th leg, clear of the ch3 getaway line that crosses it at the kart gate)
    const r = battle.ruts[0].pts, mx = (r[6] + r[8]) / 2, mz = (r[7] + r[9]) / 2;
    const dx = r[8] - r[6], dz = r[9] - r[7], L = Math.hypot(dx, dz), nx = -dz / L, nz = dx / L;
    const a = at(mx + nx * 0.85, mz + nz * 0.85)[3], b = at(mx - nx * 0.85, mz - nz * 0.85)[3];
    expect(Math.abs(Math.abs(a) - 0.85)).toBeLessThan(0.05);
    expect(Math.sign(a)).toBe(-Math.sign(b));
    expect(at(0, 90)[3], 'no rut far away').toBeGreaterThan(4);
    expect([...at(-70, 20)].slice(0, 3)).toEqual([0, 0, 0]);                         // untouched lawn
  });

  it('damages fence boards in the layout zones only (snapped, askew, scorched, shot through, patched)', () => {
    const f = createFenceView(data.fences!, data.height);
    const bare = createFenceView(data.fences!.map((r) => ({ ...r })), data.height);  // a copy: no layout registered
    expect(f.boards.count).toBe(bare.boards.count);
    const holes = f.prims.filter((p) => p.col === 'soot').length, patches = f.prims.filter((p) => p.col === 'plywood').length;
    console.log(`[fob-view] fence damage: ${holes} bullet holes, ${patches} plywood patches`);
    expect(holes).toBeGreaterThan(20);
    expect(patches).toBeGreaterThan(0);
    expect(bare.prims.filter((p) => p.col === 'soot' || p.col === 'plywood').length).toBe(0);
    f.dispose(); bare.dispose();
  });

  it('merged props carry per-vertex weathering (rough, metal, grime, wear) for the hardened material', () => {
    const pm = buildPrimMeshes(data.prims!.filter((p) => Math.hypot(p.x + 37, p.z + 56) < 20));
    for (const m of pm.meshes) {
      const s = m.geometry.getAttribute('surface');
      expect(s, m.name).toBeTruthy();
      expect(s.count).toBe(m.geometry.getAttribute('position').count);
    }
    disposePrimMeshes(pm);
  });
});
