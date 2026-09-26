// A2: the runner's chapter 3–6 features on A1's flat trimesh yard — the pups' kits (ChapterDef.pups), the height
// rules of reach / interact (minY for humans, waived for a bot-only squad; maxY lifts the ceiling), the fail-forward
// grace for the human-only rules, an interact step's object (the last tennis ball), vehicles parked for a step
// (re-parked after a wreck and at a checkpoint restart), barricades raised when a step completes (Squeak Barrier
// walls that stand again at a restart), a step's rally point, and sentries walking their posts.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { createDefaultSystems } from '../../src/sim/systems';
import { adventureSystems, adventureState, adventureRuntime, restartAtCheckpoint, type AdventureConfig } from '../../src/sim/adventure';
import { applyArchetype } from '../../src/sim/ai';
import { kill } from '../../src/sim/combat/damage';
import { BARRIER_GROUPS } from '../../src/sim/combat/ability-core';
import { destroyKart } from '../../src/sim/vehicles';
import { Btn } from '../../src/shared/input';
import { EntityKind, Species, Team, type ClassId, type TeamId } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import type { WorldData } from '../../src/shared/world/world-data';
import { TICK_HZ } from '../../src/shared/constants';
import { ABILITY_IDS } from '../../src/shared/content/abilities';
import {
  ADVENTURE_ITEM_IDS, ADVENTURE_ITEM_SEED, BARRICADE_HP, GRACE_BARK, STRICT_GRACE_SECONDS, VEHICLE_REPARK_SECONDS,
  type ChapterDef, type ChapterStep,
} from '../../src/shared/content/chapters';

function withAdventure() {
  const sys = createDefaultSystems();
  return sys.some((s) => s.name === 'adventure') ? sys : [...sys, ...adventureSystems()];
}

function yard(): WorldData {
  const n = 81, cell = 2;
  return {
    seed: 1, name: 'adventure a2 test yard', height: () => 0, halfExtent: 80, killY: -30, props: [], concealZones: [],
    terrain: { x0: -80, z0: -80, cell, n, heights: new Float32Array(n * n) },
    spawns: [{ x: -40, y: 0, z: 60, yaw: 0, team: Team.Corgis }, { x: 40, y: 0, z: -60, yaw: Math.PI, team: Team.Cats }],
  } as WorldData;
}

function chapter(steps: ChapterStep[], extra: Partial<ChapterDef> = {}): ChapterDef {
  return {
    id: 'a2_test', index: 9, title: 'Test', district: 'Test', cls: 'assault', intro: ['a', 'b'], outro: ['c', 'd'],
    squad: 4, start: { x: 0, z: 40, yaw: 0 }, par: 60, steps, ...extra,
  };
}

async function advSim(def: ChapterDef, cfg: AdventureConfig = {}, seed = 5): Promise<Sim> {
  const sim = await Sim.create({ seed, world: yard(), systems: withAdventure() });
  sim.state.room = { mode: 'adventure' };
  sim.state.adventureConfig = { chapter: def, briefing: 0.1, briefingWait: 0.1, interact: false, ...cfg } satisfies AdventureConfig;
  return sim;
}

function human(sim: Sim, x = 0, z = 40, cls: ClassId = 'assault'): SimEntity {
  return sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls, name: `Rex${sim.entities.size}`, ownerPid: `p${sim.entities.size}`, x, y: 0.02, z });
}

function bot(sim: Sim, team: TeamId, x: number, z: number, external = false): SimEntity {
  const e = sim.spawnCharacter({ kind: EntityKind.Bot, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'assault', name: `b${sim.entities.size}`, x, y: 0.02, z });
  if (external) applyArchetype(e, 'rifleman', { external: true });
  return e;
}

let seq = 1;
function press(sim: Sim, e: SimEntity, buttons: number): void {
  sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw: e.yaw, pitch: 0, buttons, rt: 0 });
}

function run(sim: Sim, seconds: number, out: GameEvent[] = [], until?: () => boolean): GameEvent[] {
  for (let i = 0; i < Math.round(seconds * TICK_HZ); i++) {
    sim.step();
    out.push(...sim.drainEvents());
    if (until?.()) break;
  }
  return out;
}

const st = (sim: Sim) => adventureState(sim)!;
const live = (sim: Sim) => run(sim, 2, [], () => st(sim).phase === 'live');
const teleport = (sim: Sim, e: SimEntity, x: number, z: number, y = 0.02) => sim.placeCharacter(e, x, y, z);
const karts = (sim: Sim) => [...sim.entities.values()].filter((e) => e.kart && !e.removed);
const barricades = (sim: Sim) => [...sim.entities.values()].filter((e) => e.abx?.kind === 'barrier' && e.health?.max === BARRICADE_HP);

describe('A2 runner: the pups’ kits', () => {
  it('ChapterDef.pups kits the squad pups in id order (featured kit first) with a fresh brain; a pup joining later gets its rank’s kit; humans keep theirs', async () => {
    const def = chapter([{ id: 'wait', text: 'Wait', trigger: { type: 'survive', params: { seconds: 30 } } }], { pups: ['breacher', 'warden', 'overwatch'] });
    const sim = await advSim(def);
    const h = human(sim);
    const a = bot(sim, Team.Corgis, 0, 40), b = bot(sim, Team.Corgis, 0, 40);
    live(sim);
    run(sim, 0.2);
    expect([a.cls, b.cls]).toEqual(['breacher', 'warden']);
    expect([a.abil!.id, b.abil!.id]).toEqual(['dig_charge', 'squeak_barrier']);
    expect([a.ai!.arch, b.ai!.arch]).toEqual(['bomber', 'guard']); // the kit's bot profile
    expect(a.health!.hp).toBe(a.health!.max);
    expect(h.cls).toBe('assault');
    const c = bot(sim, Team.Corgis, 5, 40); // joins mid-chapter (its spawn event)
    run(sim, 0.2);
    expect(c.cls).toBe('overwatch');
    expect(c.wpn!.id).toBe('laser_longshot');
    // without `pups` (chapters 1–2) the Room's kits stay
    const plain = await advSim(chapter([{ id: 'wait', text: 'Wait', trigger: { type: 'survive', params: { seconds: 30 } } }]));
    const p = bot(plain, Team.Corgis, 0, 40);
    live(plain);
    run(plain, 0.2);
    expect(p.cls).toBe('assault');
  });
});

describe('A2 runner: height rules and the grace', () => {
  const up: ChapterStep = { id: 'up', text: 'Up there', trigger: { type: 'reach', params: { x: 20, z: 0, radius: 3, minY: 4 } } };

  it('minY: a human below the floor does not count, one up there does; a bot-only squad too (N1: bots climb), until the grace', async () => {
    const sim = await advSim(chapter([up, { id: 'after', text: 'After', trigger: { type: 'survive', params: { seconds: 60 } } }]));
    const h = human(sim);
    live(sim);
    teleport(sim, h, 20, 0);
    run(sim, 0.5);
    expect(st(sim).step).toBe(0); // on the ground under it
    teleport(sim, h, 20, 0, 5); // up there (the yard has no roof: mid-air counts the same)
    run(sim, 1 / TICK_HZ);
    expect(st(sim).step).toBe(1);
    const bots = await advSim(chapter([up, { id: 'after', text: 'After', trigger: { type: 'survive', params: { seconds: 60 } } }]));
    const pup = bot(bots, Team.Corgis, 0, 40, true);
    live(bots);
    teleport(bots, pup, 20, 0);
    run(bots, 0.2);
    expect(st(bots).step).toBe(0); // bots climb since N1: on the ground under it is not enough for them either
    teleport(bots, pup, 20, 0, 5);
    run(bots, 1 / TICK_HZ);
    expect(st(bots).step).toBe(1);
  });

  it('maxY lifts the zone’s ceiling (a plane over the shed): 20 m up counts only with it', async () => {
    const high = (maxY?: number): ChapterStep => ({ id: 'fly', text: 'Fly', trigger: { type: 'reach', params: { x: 20, z: 0, radius: 6, maxY } } });
    for (const [maxY, done] of [[undefined, 0], [30, 1]] as const) {
      const sim = await advSim(chapter([high(maxY), { id: 'after', text: 'After', trigger: { type: 'survive', params: { seconds: 60 } } }]));
      const h = human(sim);
      live(sim);
      teleport(sim, h, 20, 0, 20);
      run(sim, 1 / TICK_HZ);
      expect(st(sim).step, `maxY ${maxY}`).toBe(done);
    }
  });

  it('after STRICT_GRACE_SECONDS on a step the human-only rules fail forward (walking in counts) and a pup says so', async () => {
    const glide: ChapterStep = { id: 'glide', text: 'Glide', trigger: { type: 'reach', params: { x: 20, z: 0, radius: 4, airborne: true, minY: 4 } } };
    const sim = await advSim(chapter([glide, { id: 'after', text: 'After', trigger: { type: 'survive', params: { seconds: 60 } } }]));
    const h = human(sim);
    bot(sim, Team.Corgis, 0, 40, true);
    live(sim);
    teleport(sim, h, 20, 0);
    const evs = run(sim, STRICT_GRACE_SECONDS - 1);
    expect(st(sim).step).toBe(0); // standing in it on the ground: not airborne, not up there
    run(sim, 2, evs);
    expect(st(sim).step).toBe(1);
    expect(evs.some((e) => e.e === 'bark' && e.line === GRACE_BARK)).toBe(true);
  }, 60000);
});

describe('A2 runner: an interact step’s object', () => {
  it('the item waits at the point (item prop), E takes it: a pickup event, and it is gone', async () => {
    const def = chapter([
      { id: 'grab', text: 'Grab the ball', trigger: { type: 'interact', params: { x: 10, z: 20, radius: 3, prompt: 'grab the tennis ball', item: 'tennis_ball' } } },
      { id: 'after', text: 'After', trigger: { type: 'survive', params: { seconds: 60 } } },
    ]);
    const sim = await advSim(def);
    const h = human(sim);
    live(sim);
    const ball = sim.snapshotEntities().find((s) => s.kind === EntityKind.Prop && s.seed === ADVENTURE_ITEM_SEED)!;
    expect(ball).toBeTruthy();
    expect(ball.weapon).toBe(ADVENTURE_ITEM_IDS.indexOf('tennis_ball'));
    expect(Math.hypot(ball.x - 10, ball.z - 20)).toBeLessThan(0.01);
    teleport(sim, h, 11, 21);
    run(sim, 0.3);
    press(sim, h, Btn.Interact);
    const evs = run(sim, 2 / TICK_HZ);
    expect(st(sim).step).toBe(1);
    expect(evs).toContainEqual({ e: 'pickup', id: h.id, item: 'tennis_ball' });
    expect(sim.entities.has(ball.id)).toBe(false);
  });
});

describe('A2 runner: vehicles parked for a step', () => {
  it('a step parks its kart when it starts; a wreck is parked again after the beat; a checkpoint restart parks it anew', async () => {
    const def = chapter([
      { id: 'go', text: 'Go', trigger: { type: 'reach', params: { x: 0, z: 30, radius: 3 } } },
      { id: 'drive', text: 'Drive', trigger: { type: 'reach', params: { x: -40, z: -40, radius: 4, vehicle: true } }, vehicles: [{ vehicle: 'mower_kart', x: 10, z: 20, yaw: 0 }], checkpoint: true },
    ]);
    const sim = await advSim(def, { failBeat: 1 });
    const h = human(sim);
    live(sim);
    expect(karts(sim).length).toBe(0);
    teleport(sim, h, 0, 30);
    run(sim, 0.2);
    expect(st(sim).step).toBe(1);
    const k = karts(sim);
    expect(k.length).toBe(1);
    expect([k[0].pos.x, k[0].pos.z]).toEqual([10, 20]);
    expect(k[0].team).toBe(Team.Corgis);
    destroyKart(sim, k[0]);
    run(sim, VEHICLE_REPARK_SECONDS - 0.5);
    expect(karts(sim).length).toBe(0);
    run(sim, 1);
    expect(karts(sim).length).toBe(1); // parked again at its spot
    const before = karts(sim)[0].id;
    teleport(sim, h, 30, 30);
    kill(sim, h, { id: -1, team: Team.Cats, weapon: -1 });
    run(sim, 3, [], () => st(sim).phase === 'live' && st(sim).wipes > 0);
    expect(st(sim).wipes).toBe(1);
    expect(st(sim).step).toBe(1);
    const after = karts(sim);
    expect(after.length).toBe(1);
    expect(after[0].id).not.toBe(before);
    expect(adventureRuntime(sim)!.vehicles.length).toBe(1);
  });
});

describe('A2 runner: barricades', () => {
  it('a step raises its walls when it completes (corgi Squeak Barriers with BARRICADE_HP), shoving a pup out of the way; they stand again at full health after a restart and go at the chapter’s end', async () => {
    const def = chapter([
      { id: 'build', text: 'Build', trigger: { type: 'interact', params: { x: 0, z: 25, radius: 3, prompt: 'raise the barricade' } }, raise: [{ x: 0, z: 20, yaw: Math.PI }, { x: 4.2, z: 20, yaw: Math.PI }] },
      { id: 'hold', text: 'Hold', trigger: { type: 'survive', params: { seconds: 3 } }, checkpoint: true },
    ]);
    const sim = await advSim(def, { failBeat: 1, completeHold: 60 });
    const h = human(sim);
    const pup = bot(sim, Team.Corgis, 0, 40, true);
    live(sim);
    teleport(sim, h, 0, 24);
    teleport(sim, pup, 0.5, 20.1); // right where the wall rises (a hair to its front: yaw π faces +z)
    run(sim, 0.2);
    press(sim, h, Btn.Interact);
    const evs = run(sim, 2 / TICK_HZ);
    expect(st(sim).step).toBe(1);
    const walls = barricades(sim);
    expect(walls.length).toBe(2);
    const snap = sim.snapshotEntities().find((s) => s.id === walls[0].id)!;
    expect(snap.kind).toBe(EntityKind.Ability);
    expect(snap.cls).toBe(ABILITY_IDS.indexOf('squeak_barrier'));
    expect(snap.team).toBe(Team.Corgis);
    expect(snap.hp).toBe(BARRICADE_HP);
    expect(walls[0].collider!.collisionGroups()).toBe(BARRIER_GROUPS);
    expect(walls[0].abx!.until - sim.tick).toBeGreaterThan(600 * TICK_HZ); // outlasts the chapter
    const pops = evs.filter((e) => e.e === 'ability' && e.ability === 'squeak_barrier') as Array<{ id: number }>;
    expect(pops.map((e) => e.id)).toEqual(walls.map((w) => w.id)); // on the walls' ids: the human's own Q ring stays put
    expect(h.abil!.cooldown).toBe(0);
    expect(pup.pos.z).toBeGreaterThan(20.5); // shoved out of the wall, to the side it was on
    walls[0].health!.hp = 5;
    kill(sim, h, { id: -1, team: Team.Cats, weapon: -1 });
    kill(sim, pup, { id: -1, team: Team.Cats, weapon: -1 });
    run(sim, 3, [], () => st(sim).phase === 'live' && st(sim).wipes > 0);
    expect(st(sim).wipes).toBe(1);
    const again = barricades(sim);
    expect(again.length).toBe(2);
    expect(again.every((w) => w.health!.hp === BARRICADE_HP)).toBe(true);
    expect(again.map((w) => [w.pos.x, w.pos.z])).toEqual([[0, 20], [4.2, 20]]);
    run(sim, 4, [], () => st(sim).phase === 'complete');
    expect(st(sim).phase).toBe('complete');
    run(sim, 0.2);
    expect(barricades(sim).length).toBe(0); // combat off: C2 clears ability entities
  });
});

describe('A2 runner: rally points and sentries', () => {
  it('a step’s rally point is where the squad regroups and respawns once it is done', async () => {
    const def = chapter([
      { id: 'go', text: 'Go', trigger: { type: 'reach', params: { x: 0, z: 30, radius: 3 } }, rally: { x: -30, z: -30 } },
      { id: 'wait', text: 'Wait', trigger: { type: 'survive', params: { seconds: 60 } } },
    ]);
    const sim = await advSim(def);
    const h = human(sim);
    bot(sim, Team.Corgis, 0, 40, true); // a pup still standing: the human's knock-out is not a squad wipe
    live(sim);
    teleport(sim, h, 0, 30);
    run(sim, 0.2);
    expect([st(sim).anchorX, st(sim).anchorZ, st(sim).anchorY]).toEqual([-30, -30, -1]);
    kill(sim, h, { id: -1, team: Team.Cats, weapon: -1 });
    run(sim, 6, [], () => !h.dead);
    expect(h.dead).toBe(false);
    expect(Math.hypot(h.pos.x + 30, h.pos.z + 30)).toBeLessThan(6);
  });

  it('sentries walk their posts (walk speed), they don’t jog them', async () => {
    const def = chapter([{
      id: 'sneak', text: 'Sneak', trigger: { type: 'reach', params: { x: 60, z: 60, radius: 3 } }, stealth: true,
      spawns: [{ archetype: 'grunt', count: 2, at: { x: 0, z: -20 }, tag: 'sentry' }], alarm: [{ archetype: 'kitten', count: 1, at: { x: 0, z: -40 } }],
    }], { start: { x: 50, z: 60, yaw: 0 } });
    const sim = await advSim(def);
    human(sim, 50, 60);
    live(sim);
    const sentries = [...sim.entities.values()].filter((e) => e.adv?.sentry);
    expect(sentries.length).toBe(2);
    let top = 0, moved = 0;
    run(sim, 20, [], () => {
      for (const s of sentries) { const v = Math.hypot(s.vel.x, s.vel.z); top = Math.max(top, v); moved += v / TICK_HZ; }
      return false;
    });
    expect(st(sim).alarm).toBe(false);
    expect(moved).toBeGreaterThan(8); // they do pace
    expect(top).toBeLessThanOrEqual(sentries[0].char!.move.walkSpeed * 1.02);
  });
});
