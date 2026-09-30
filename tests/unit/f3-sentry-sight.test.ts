// W11 F3 (P2-1): chapter 7's sentries are drawn at the range they really see. The cone's far arc (client/adventure/
// views.ts) is drawn at archetype sight × the weather's sight multiplier, from what a snapshot carries (class + max hp),
// and that radius is where the real brain starts to spot a pet in the open: seen 0.4 m inside it, not 0.4 m outside it.
import { describe, it, expect, afterAll } from 'vitest';
import * as THREE from 'three/webgpu';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { applyArchetype } from '../../src/sim/ai/brain';
import { ensureCombat } from '../../src/sim/combat/state';
import { ARCHETYPES, archetypeForSnapshot, detectionRange, type ArchetypeId } from '../../src/sim/ai/archetypes';
import { weatherSightMult } from '../../src/sim/world/env';
import { NIGHT_SHIFT } from '../../src/shared/content/chapters-lot';
import { ADVENTURE_CHAIN_INDEX } from '../../src/shared/content/chapters';
import { WEATHER_PARAMS } from '../../src/shared/world/weather';
import type { EntityState } from '../../src/shared/protocol';
import type { PropBox, WorldData } from '../../src/shared/world/world-types';
import { Anim, CLASS_IDS, EFlag, EntityKind, Species, Team } from '../../src/shared/types';
import { createAdventureViews, readAdventure } from '../../src/client/adventure';
import { sentrySightRange } from '../../src/client/adventure/views';

/** Every archetype chapter 7 puts on the ground (its steps' spawns and alarms), with the stealth steps' sentries first. */
const SENTRIES = [...new Set(NIGHT_SHIFT.steps.filter((s) => s.stealth).flatMap((s) => (s.spawns ?? []).map((p) => p.archetype)))] as ArchetypeId[];
const ALL = [...new Set(NIGHT_SHIFT.steps.flatMap((s) => [...(s.spawns ?? []), ...(s.alarm ?? [])].map((p) => p.archetype)))] as ArchetypeId[];

function flat(props: PropBox[] = []): WorldData {
  const n = 161;
  return {
    seed: 1, name: 'f3 flat yard', height: () => 0, halfExtent: 80, killY: -30, props, cylinders: [],
    terrain: { x0: -80, z0: -80, cell: 1, n, heights: new Float32Array(n * n) },
    spawns: [{ x: 0, y: 0, z: 70, yaw: 0, team: Team.Corgis }, { x: 0, y: 0, z: -70, yaw: Math.PI, team: Team.Cats }],
  } as WorldData;
}
function st(p: Partial<EntityState>): EntityState {
  return { id: 50, kind: EntityKind.Prop, team: Team.Corgis, species: 0, cls: ADVENTURE_CHAIN_INDEX, seed: 2, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 0, maxHp: 0, anim: Anim.Idle, flags: 0, weapon: 0, ammo: 0, ...p };
}
/** A stealth step's beacon (the adventure-client test's): the view model says "sneaking". */
const sneaking = () => readAdventure(new Map([[50, st({ anim: 1 as never })]]));

/** A chapter cat the way spawnChapterCat makes one (the class kit, the archetype, PvE). */
function spawnCat(sim: Sim, arch: ArchetypeId, x: number, z: number, yaw: number): SimEntity {
  const A = ARCHETYPES[arch];
  const e = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, cls: A.cls, name: `${A.label} 1`, x, y: 0.05, z, yaw });
  ensureCombat(e);
  e.combat!.pve = true;
  applyArchetype(e, arch);
  return e;
}

const sims: Sim[] = [];
afterAll(() => { for (const s of sims) s.dispose(); });

describe('F3 P2-1: chapter 7 sentries are drawn at the range they see', () => {
  it('chapter 7 has sentries in its stealth steps (grunts, kittens) and alarms with other archetypes', () => {
    expect(SENTRIES.sort()).toEqual(['grunt', 'kitten']);
    expect(ALL).toContain('alley_raider');
  });

  it('the far arc is drawn at archetype sight × the weather multiplier, for every chapter 7 archetype and weather', async () => {
    const sim = await Sim.create({ seed: 1, world: flat() });
    sims.push(sim);
    const scene = new THREE.Scene();
    const v = createAdventureViews(scene);
    const view = sneaking();
    expect(view?.sneaking).toBe(true);
    let n = 0;
    for (const arch of ALL) {
      const e = spawnCat(sim, arch, 10 * n++, 0, 0.3);
      const s = sim.toState(e);                                       // what the client gets: class + max hp
      expect(archetypeForSnapshot(CLASS_IDS[s.cls], s.maxHp).id, arch).toBe(arch);
      for (const w of ['clear', 'overcast', 'rain', 'storm', 'clearing'] as const) {
        const sight = WEATHER_PARAMS[w].sight;
        v.sync(new Map([[s.id, s]]), view, 0.016, sight);
        const cone = v.group.getObjectByName('sentry_cone') as THREE.Mesh;
        const far = cone.getObjectByName('sentry_sight') as THREE.Mesh;
        const want = detectionRange(ARCHETYPES[arch], sight);        // the brain's number (brain.ts perceive)
        expect(far.scale.x, `${arch} ${w}`).toBe(want);
        expect(far.scale.z).toBe(want);
        expect(sentrySightRange(s, sight)).toBe(want);
        // the arc's outer edge really is at that radius in the world, across the archetype's field of view
        far.geometry.computeBoundingBox();
        const bb = far.geometry.boundingBox!;
        expect(-bb.min.z * want).toBeCloseTo(want, 2);                // the outer edge, dead ahead (-Z), at radius 1 × want
        expect(bb.max.x * want).toBeCloseTo(want * Math.sin(ARCHETYPES[arch].fovHalf), 1);
      }
      if (arch === 'grunt') { v.sync(new Map([[s.id, s]]), view, 0.016); expect((v.group.getObjectByName('sentry_sight') as THREE.Mesh).scale.x).toBe(45); } // no weather given: clear
      v.sync(new Map(), view, 0.016);
      expect(v.stats().cones).toBe(0);
    }
    // an alerted sentry's arc goes red with its fan; the alarm hides both
    const g = spawnCat(sim, 'grunt', -30, 0, 0);
    const s = { ...sim.toState(g), flags: EFlag.Alerted };
    v.sync(new Map([[s.id, s]]), view, 0.016, 1);
    const far = v.group.getObjectByName('sentry_sight') as THREE.Mesh;
    const calmArc = far.material;
    v.sync(new Map([[s.id, { ...s, flags: 0 }]]), view, 0.016, 1);
    expect(far.material).not.toBe(calmArc);
    v.dispose();
  });

  for (const arch of ['grunt', 'kitten', 'alley_raider'] as const) {
    it(`${arch}: the real brain spots a pet in the open 0.4 m inside the drawn arc, and not 0.4 m outside it`, async () => {
      for (const [d, seen] of [[-0.4, true], [0.4, false]] as const) {
        const sim = await Sim.create({ seed: 3, world: flat() });
        sims.push(sim);
        sim.state.aiConfig = { vehicles: false };
        const cat = spawnCat(sim, arch, 0, 0, 0);                    // facing -Z
        const sight = weatherSightMult(sim);
        const R = sentrySightRange(sim.toState(cat), sight);          // what the view draws in this sim's weather
        expect(R).toBe(detectionRange(ARCHETYPES[arch], sight));
        const pet = sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'pup', x: 0, y: 0.05, z: -(R + d), yaw: 0 });
        let spotted = false;
        for (let i = 0; i < 2; i++) { sim.step(); if (cat.ai!.seen.includes(pet)) spotted = true; }
        expect(spotted, `${arch} at ${(R + d).toFixed(1)} m (drawn ${R.toFixed(1)} m)`).toBe(seen);
      }
    }, 60_000);
  }
});
