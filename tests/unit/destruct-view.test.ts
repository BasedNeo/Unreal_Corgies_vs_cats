// X1 client: the destructible view headless — merged draw calls within budget, style materials + tagged ink, states
// and events switch standing <-> rubble by rewriting index ranges (no rebuild), the event guard against lagging
// interpolated states, camera proxies follow the state, debris is pooled (fixed buffers, bounded count) and settles.
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three/webgpu';
import type { EntityState, GameEvent } from '../../src/shared/protocol';
import { Anim, EFlag, EntityKind, Team } from '../../src/shared/types';
import { createWorldData, type WorldData } from '../../src/shared/world/world-data';
import { createDestructView } from '../../src/client/world/destruct-view';
import { createDebris } from '../../src/client/world/destruct-debris';
import { OnomatopoeiaPicker, WORDS } from '../../src/client/fx/onomatopoeia';

let data: WorldData;
beforeAll(() => { data = createWorldData(1); });

function st(index: number, broken: boolean, breaks = broken ? 1 : 0): EntityState {
  const d = data.destructibles![index];
  return {
    id: 100 + index, kind: EntityKind.Destructible, team: Team.Neutral, species: 0, cls: -1, seed: index,
    x: d.x, y: d.y, z: d.z, yaw: d.yaw, pitch: 0, vx: 0, vy: 0, vz: 0, hp: broken ? 0 : d.hp, maxHp: d.hp,
    anim: Anim.Idle, flags: broken ? EFlag.Busy : 0, weapon: -1, ammo: breaks,
  };
}
const all = (broken: (i: number) => boolean) => new Map(data.destructibles!.map((_, i) => [100 + i, st(i, broken(i))]));

/** Non-degenerate triangles currently drawn by a merged mesh. */
function liveTris(mesh: THREE.Mesh): number {
  const a = mesh.geometry.getIndex()!.array;
  let n = 0;
  for (let i = 0; i < a.length; i += 3) if (a[i] !== a[i + 1] || a[i] !== a[i + 2]) n++;
  return n;
}

describe('destructible view', () => {
  it('merges every destructible into <= 3 meshes + 1 ink line set, style materials only, ink tagged', () => {
    const v = createDestructView(data);
    const meshes: THREE.Mesh[] = [];
    v.group.traverse((o) => {
      const m = o as THREE.Mesh & { isLineSegments2?: boolean; isInstancedMesh?: boolean };
      if (m.isLineSegments2) { expect(m.userData.styleInk).toBe(true); return; }
      if (!m.isMesh) return;
      expect(['toon', 'toon-noink']).toContain((m.material as THREE.Material).userData.style);
      if (!m.isInstancedMesh) meshes.push(m);
    });
    expect(meshes.length).toBeLessThanOrEqual(3);
    const s = v.stats();
    expect(s.destructibles).toBe(8);
    expect(s.destructDraws).toBeLessThanOrEqual(4);                 // + 2 debris instanced meshes only while debris flies
    console.log(`[x1] destructible view: ${s.destructDraws} draws, ${s.destructTris} tris (standing + rubble buffers)`);
    v.dispose();
  });

  it('snapshot states switch standing <-> rubble in place (index ranges), with camera proxies to match', () => {
    const v = createDestructView(data);
    const solid = v.group.getObjectByName('destructibles_solid') as THREE.Mesh;
    const arr = solid.geometry.getIndex()!.array;
    const standing = liveTris(solid);
    // a late joiner: the very first snapshot already has the wall broken -> rubble, no debris burst
    v.sync(all((i) => i === 0), 10);
    expect(v.isBroken(0)).toBe(true);
    expect(solid.geometry.getIndex()!.array).toBe(arr);            // same buffer, rewritten ranges
    expect(liveTris(solid)).not.toBe(standing);
    expect(v.stats().debrisAlive).toBe(0);
    const proxies = v.cameraGroup.children[0].children;
    expect(proxies.every((p) => !p.layers.test(new THREE.Layers()))).toBe(true);   // out of the camera's raycasts
    // restored (match restart)
    v.sync(all(() => false), 10_000);
    expect(v.isBroken(0)).toBe(false);
    expect(liveTris(solid)).toBe(standing);
    expect(proxies.every((p) => p.layers.test(new THREE.Layers()))).toBe(true);
    v.dispose();
  });

  it('a break event breaks at once with debris; lagging "standing" states do not undo it; a missed event still breaks', () => {
    const v = createDestructView(data);
    v.sync(all(() => false), 0);
    const d = data.destructibles![2];
    const ev: GameEvent = { e: 'ability', id: 102, ability: 'destruct:tuna_stack', x: d.cx, y: d.cy, z: d.cz };
    v.onGameEvent(ev, 1000);
    expect(v.isBroken(2)).toBe(true);
    expect(v.stats().debrisAlive).toBeGreaterThan(20);             // planks + 14 cans
    v.sync(all(() => false), 1100);                                // interpolated states still show it standing
    expect(v.isBroken(2)).toBe(true);
    v.sync(all((i) => i === 2), 1200);
    expect(v.isBroken(2)).toBe(true);
    // a crate stack whose event was lost: the state's break counter moved while we watched -> debris anyway
    const before = v.stats().debrisAlive;
    v.sync(all((i) => i === 2 || i === 5), 1300);
    expect(v.isBroken(5)).toBe(true);
    expect(v.stats().debrisAlive).toBeGreaterThan(before);
    v.dispose();
  });

  it('debris is pooled: fixed buffers, bounded count, it falls, settles on the surface and shrinks away', () => {
    const debris = createDebris(() => 0.2, { chunks: 64, cans: 16, seed: 3 });
    const [chunks, cans] = debris.group.children as THREE.InstancedMesh[];
    const bufs = [chunks.instanceMatrix.array, cans.instanceMatrix.array, chunks.instanceColor!.array];
    const box = { x0: -1.3, x1: 1.3, y0: 0.2, y1: 1.6, z0: -1.3, z1: 1.3 };
    for (let k = 0; k < 6; k++) debris.burst('tuna_stack', box, 0, 0.9, 0);    // more than the pools hold: recycles
    expect(chunks.count).toBeLessThanOrEqual(64);
    expect(debris.alive).toBeLessThanOrEqual(80);
    let minY = Infinity;
    for (let f = 0; f < 90; f++) {
      debris.update(1 / 60);
      const m = chunks.instanceMatrix.array;
      for (let i = 0; i < chunks.count; i++) minY = Math.min(minY, m[i * 16 + 13]);
    }
    expect(minY).toBeGreaterThan(0.2);                               // never sinks below the floor it lands on
    for (let f = 0; f < 60 * 5; f++) debris.update(1 / 60);
    expect(debris.alive).toBe(0);
    expect([chunks.instanceMatrix.array, cans.instanceMatrix.array, chunks.instanceColor!.array]).toEqual(bufs);
    expect(chunks.instanceMatrix.array).toBe(bufs[0]);
    debris.dispose();
  });

  it('breaks pop a comic word (CRASH! for the wall) from the atlas', () => {
    expect(WORDS).toContain('CRASH!');
    expect(WORDS.length).toBeLessThanOrEqual(32);
    const p = new OnomatopoeiaPicker();
    const ctx = { localId: 1, now: 0, speciesOf: () => 0, weaponOf: () => 'squeaker_rifle' as const, rand: () => 0.5 };
    expect(p.pick({ e: 'ability', id: 7, ability: 'destruct:wall_boards', x: 0, y: 0, z: 0 }, ctx)).toMatchObject({ word: 'CRASH!' });
    expect(p.pick({ e: 'ability', id: 8, ability: 'destruct:tuna_stack', x: 0, y: 0, z: 0 }, ctx)).toMatchObject({ word: 'CLANG!' });
  });
});
