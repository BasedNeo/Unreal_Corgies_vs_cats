// The garden's tall grass is drawn per concealment zone (Q2 P2-5): one yard-wide InstancedMesh drew every tuft
// (137 k triangles) from views that saw a handful, because an InstancedMesh is frustum-culled as one sphere.
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createWorldData, type WorldData } from '../../src/shared/world/world-data';
import { createGardenView, tallGrassPlacements } from '../../src/client/world/garden-view';

let data: WorldData;
beforeAll(() => { data = createWorldData(1); });

describe('garden view: tall grass per zone', () => {
  it('one grass (and flower) draw per zone, bounded by its zone, every placement drawn once', () => {
    const view = createGardenView(data);
    const meshes: THREE.InstancedMesh[] = [];
    view.group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh && /^garden_tall/.test(o.name)) meshes.push(o as THREE.InstancedMesh); });
    const zones = data.concealZones ?? [];
    expect(zones.length).toBeGreaterThan(4);
    let placed = 0;
    for (const zn of zones) {
      const mine = meshes.filter((m) => m.name.endsWith(`_${zn.id}`));
      expect(mine.length, zn.id).toBeGreaterThanOrEqual(1);
      expect(mine.length, zn.id).toBeLessThanOrEqual(2);
      for (const m of mine) {
        // the culling sphere hugs the zone (not the yard): centre inside the zone's box, radius about its size
        const s = m.boundingSphere!;
        expect(Math.abs(s.center.x - zn.x), `${m.name} x`).toBeLessThan(zn.rx + 1);
        expect(Math.abs(s.center.z - zn.z), `${m.name} z`).toBeLessThan(zn.rz + 1);
        expect(s.radius, m.name).toBeLessThan(Math.max(zn.rx, zn.rz) + 4);
      }
      placed += tallGrassPlacements(data, zn).length;
    }
    const st = view.stats();
    expect(st.tallGrass + st.tallFlowers).toBe(placed);
    view.setDensity(0.5);
    const half = view.stats();
    expect(Math.abs(half.tallGrass + half.tallFlowers - placed / 2)).toBeLessThanOrEqual(meshes.length);
    view.dispose();
  });
});
