// C2a client: headless sync of the ability-entity views (budgets, style-factory materials, states → visibility,
// spotted markers for the local team only, exit animations) — the GPU look is checked in labs/abilities.html.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import type { EntityState } from '../../src/shared/protocol';
import { Anim, EFlag, EntityKind, Species, Team } from '../../src/shared/types';
import { ABILITY_IDS } from '../../src/shared/content/abilities';
import { objectiveChainIndex } from '../../src/shared/content/objectives';
import { createAbilityViews, abilityKindOf } from '../../src/client/abilities';
import { measureObject } from '../../src/client/vehicles';

function st(p: Partial<EntityState>): EntityState {
  return { id: 1, kind: EntityKind.Player, team: Team.Corgis, species: 0, cls: 0, seed: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 100, maxHp: 100, anim: Anim.Idle, flags: EFlag.Grounded, weapon: 0, ammo: 0, ...p };
}
const map = (...s: EntityState[]) => new Map(s.map((x) => [x.id, x]));
const ab = (id: string) => ABILITY_IDS.indexOf(id as (typeof ABILITY_IDS)[number]);
const abil = (id: number, ability: string, p: Partial<EntityState> = {}) => st({ id, kind: EntityKind.Ability, cls: ab(ability), weapon: -1, ...p });

describe('ability views', () => {
  it('draws drones, charges and barriers (not the objective beacon) within budget, with style materials only', () => {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera();
    const v = createAbilityViews(scene, { camera: cam });
    const states = map(
      abil(10, 'spotter_drone', { y: 4, hp: 60, maxHp: 60, weapon: 2 }),
      abil(11, 'spotter_drone', { team: Team.Cats, species: Species.Cat, x: 6, y: 4, hp: 60, maxHp: 60, flags: EFlag.Busy }),
      abil(20, 'dig_charge', { x: 2, flags: EFlag.Busy }),
      abil(21, 'dig_charge', { x: -2, team: Team.Cats, species: Species.Cat }),
      abil(30, 'squeak_barrier', { z: -4, hp: 300, maxHp: 300 }),
      abil(31, 'squeak_barrier', { z: 6, team: Team.Cats, species: Species.Cat, hp: 120, maxHp: 300, yaw: 1 }),
      st({ id: 40, kind: EntityKind.Prop, cls: objectiveChainIndex('yard_squeaker'), weapon: 1 }),
    );
    expect(abilityKindOf(states.get(40)!)).toBeNull();
    v.sync(states, Team.Corgis, 1 / 60);
    expect(v.stats()).toMatchObject({ drones: 2, charges: 2, barriers: 2, spotted: 0 });
    const budget: Record<string, number> = { ability_10: 4, ability_20: 4, ability_21: 4, ability_30: 2, ability_31: 2 };
    for (const [name, max] of Object.entries(budget)) expect(measureObject(scene.getObjectByName(name)!).drawCalls).toBeLessThanOrEqual(max);
    expect(scene.getObjectByName('ability_40')).toBeUndefined();
    scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && !(o as unknown as { isLineSegments2?: boolean }).isLineSegments2) expect(['toon', 'glow']).toContain(mat.userData.style);
      if ((o as unknown as { isLineSegments2?: boolean }).isLineSegments2) expect(o.userData.styleInk).toBe(true);
    });
    // enemy charge: sunk into its mound, no trigger ring; ally charge: full + ring
    const ally = scene.getObjectByName('ability_20')!, enemy = scene.getObjectByName('ability_21')!;
    expect(ally.children[0].position.y).toBe(0);
    expect(enemy.children[0].position.y).toBeLessThan(-0.1);
    expect(ally.children[1].visible).toBe(true);
    expect(enemy.children[1].visible).toBe(false);
    // hits flash (and don't throw), :down + removal animate out and then free the view
    v.onGameEvent({ e: 'hit', src: 99, dst: 30, dmg: 15, x: 0, y: 1, z: -4, crit: false });
    v.sync(states, Team.Corgis, 1 / 60);
    expect(((scene.getObjectByName('ability_30')!.children[0] as THREE.Mesh).material as THREE.Material)).not.toBe(undefined);
    v.onGameEvent({ e: 'ability', id: 10, ability: 'spotter_drone:down', x: 0, y: 4, z: 0 });
    const less = new Map(states); less.delete(10); less.delete(30); less.delete(20);
    v.sync(less, Team.Corgis, 1 / 60);
    expect(v.stats()).toMatchObject({ drones: 1, charges: 1, barriers: 1 });
    expect(scene.getObjectByName('ability_10')).toBeTruthy(); // tumbling down
    // every object of a view that goes gets a 'dispose' event: the renderer's per-object state (render objects and
    // their uniform buffers) hangs off the shared drone geometry and team materials until it does (a TDM leak)
    const gone: THREE.Object3D[] = [];
    scene.getObjectByName('ability_10')!.traverse((o) => gone.push(o));
    const released = new Set<THREE.Object3D>();
    for (const o of gone) (o as unknown as THREE.EventDispatcher<{ dispose: object }>).addEventListener('dispose', () => released.add(o));
    for (let i = 0; i < 60; i++) v.sync(less, Team.Corgis, 1 / 60);
    expect(scene.getObjectByName('ability_10')).toBeUndefined();
    expect(released.size).toBe(gone.length);
    expect(scene.getObjectByName('ability_30')).toBeUndefined();
    v.dispose();
    expect(scene.getObjectByName('ability-views')).toBeUndefined();
  });

  it('marks enemies spotted by the local team — one instanced draw, never allies, the dead or spectators', () => {
    const scene = new THREE.Scene();
    const v = createAbilityViews(scene, { camera: new THREE.PerspectiveCamera() });
    const states = map(
      st({ id: 1, team: Team.Corgis, flags: EFlag.Spotted }), // spotted by the cats: not our cue
      st({ id: 2, kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, flags: EFlag.Spotted, x: 10 }),
      st({ id: 3, kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, flags: EFlag.Spotted | EFlag.Dead, x: 12 }),
      st({ id: 4, kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, x: 14 }),
      st({ id: 5, kind: EntityKind.Boss, team: Team.Cats, species: Species.Cat, flags: EFlag.Spotted, x: 30 }),
    );
    v.sync(states, Team.Corgis, 1 / 60);
    expect(v.stats().spotted).toBe(2);
    const markers = scene.getObjectByProperty('isInstancedMesh', true) as THREE.InstancedMesh;
    expect(markers.count).toBe(2);
    expect((markers.material as THREE.Material).depthTest).toBe(false); // through walls
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    markers.getMatrixAt(0, m); p.setFromMatrixPosition(m);
    expect(p.x).toBe(10);
    expect(p.y).toBeGreaterThan(1.5);
    v.sync(states, Team.Cats, 1 / 60);
    expect(v.stats().spotted).toBe(1); // the cats see the spotted corgi
    v.sync(states, -1, 1 / 60);
    expect(v.stats().spotted).toBe(0);
    v.dispose();
  });
});
