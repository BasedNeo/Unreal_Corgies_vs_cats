// A1: the adventure runner on a flat trimesh yard — every trigger type, the briefing, the stealth alarm (a sentry
// that sees a corgi raises it; a still corgi in tall grass is never seen), fail forward (a forced squad wipe restarts
// at the last checkpoint after the beat, with that checkpoint's cats and counters), the result (time vs par → medal,
// then the next chapter), bots following steps, and determinism (same seed ⇒ same run).
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { createDefaultSystems } from '../../src/sim/systems';
import { adventureSystems, adventureState, adventureRuntime, registerCheckpointHook, type AdventureConfig } from '../../src/sim/adventure';
import { objectiveState } from '../../src/sim/interact';
import { applyArchetype } from '../../src/sim/ai';
import { kill } from '../../src/sim/combat/damage';
import { Btn } from '../../src/shared/input';
import { EFlag, EntityKind, Species, Team, type ClassId, type TeamId } from '../../src/shared/types';
import type { GameEvent, MatchState } from '../../src/shared/protocol';
import type { WorldData, ConcealZone } from '../../src/shared/world/world-data';
import { TICK_HZ } from '../../src/shared/constants';
import {
  ADVENTURE_CHAIN_INDEX, ADVENTURE_ITEM_SEED, ADVENTURE_PHASES, CHAPTER_POINTS, KIOSK_PROMPT, STEP_POINTS,
  type ChapterDef, type ChapterStep,
} from '../../src/shared/content/chapters';

/** The default systems plus the adventure's (once the lead registers them in the default list, not twice). */
function withAdventure() {
  const sys = createDefaultSystems();
  return sys.some((s) => s.name === 'adventure') ? sys : [...sys, ...adventureSystems()];
}

function yard(conceal: ConcealZone[] = []): WorldData {
  const n = 81, cell = 2;
  return {
    seed: 1, name: 'adventure test yard', height: () => 0, halfExtent: 80, killY: -30, props: [], concealZones: conceal,
    terrain: { x0: -80, z0: -80, cell, n, heights: new Float32Array(n * n) },
    spawns: [{ x: -40, y: 0, z: 60, yaw: 0, team: Team.Corgis }, { x: 40, y: 0, z: -60, yaw: Math.PI, team: Team.Cats }],
  } as WorldData;
}

function chapter(steps: ChapterStep[], extra: Partial<ChapterDef> = {}): ChapterDef {
  return {
    id: 'test_chapter', index: 9, title: 'Test', district: 'Test', cls: 'assault', intro: ['a', 'b'], outro: ['c', 'd'],
    squad: 4, start: { x: 0, z: 40, yaw: 0 }, par: 60, steps, ...extra,
  };
}

async function advSim(def: ChapterDef, cfg: AdventureConfig = {}, seed = 3, conceal: ConcealZone[] = []): Promise<Sim> {
  const sim = await Sim.create({ seed, world: yard(conceal), systems: withAdventure() });
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
const ms = (sim: Sim) => sim.state.match as MatchState;
const beacon = (sim: Sim) => sim.snapshotEntities().find((s) => s.kind === EntityKind.Prop && s.cls === ADVENTURE_CHAIN_INDEX)!;
const live = (sim: Sim) => run(sim, 2, [], () => st(sim).phase === 'live');
const teleport = (sim: Sim, e: SimEntity, x: number, z: number, y = 0.02) => sim.placeCharacter(e, x, y, z);

describe('adventure: briefing and setup', () => {
  it('briefs (warmup, no combat), places the squad at the start, then goes live; every human pressing E skips it', async () => {
    const def = chapter([{ id: 'go', text: 'Go', trigger: { type: 'reach', params: { x: 30, z: 0, radius: 3 } } }], { start: { x: -20, z: 10, yaw: 1 } });
    const sim = await advSim(def, { briefing: 30 });
    const h = human(sim, 50, 50);
    const b = bot(sim, Team.Corgis, -50, -50);
    run(sim, 0.5);
    expect(st(sim).phase).toBe('briefing');
    expect(ms(sim).phase).toBe('warmup');
    expect(ms(sim).mode).toBe('adventure');
    expect((sim.state.rules as { combatLive: boolean }).combatLive).toBe(false);
    expect(ms(sim).objective).toMatch(/^Chapter 9: Test — starts in \d+$/);
    for (const e of [h, b]) expect(Math.hypot(e.pos.x + 20, e.pos.z - 10)).toBeLessThan(5); // gathered at the start
    expect(beacon(sim).weapon).toBe(-1);
    expect(beacon(sim).anim).toBe(ADVENTURE_PHASES.indexOf('briefing'));
    expect(beacon(sim).seed).toBe(9);
    press(sim, h, Btn.Interact);
    run(sim, 2 / TICK_HZ);
    expect(st(sim).phase).toBe('live');
    expect(st(sim).step).toBe(0);
    expect(ms(sim).phase).toBe('live');
    expect((sim.state.rules as { combatLive: boolean }).combatLive).toBe(true);
    expect(objectiveState(sim)!.text).toBe('Go (1/1)');
  });
});

describe('adventure: trigger types', () => {
  it('reach: the human entering the cylinder completes it (+10 step points, wave = step + 1); a pup there first does not', async () => {
    const def = chapter([
      { id: 'a', text: 'Reach A', trigger: { type: 'reach', params: { x: 20, z: 0, radius: 3 } } },
      { id: 'b', text: 'Reach B', trigger: { type: 'reach', params: { x: -20, z: 0, radius: 3 } } },
    ]);
    const sim = await advSim(def);
    const h = human(sim);
    const pup = bot(sim, Team.Corgis, 0, 40, true);
    live(sim);
    expect(ms(sim).wave).toBe(1);
    teleport(sim, pup, 20, 0); // the pup escorts; the player's arrival is the success
    teleport(sim, h, 23.5, 0); // just outside
    expect(run(sim, 0.2).some((e) => e.e === 'score')).toBe(false);
    teleport(sim, h, 21.5, 1);
    const evs = run(sim, 2 / TICK_HZ);
    expect(evs).toContainEqual({ e: 'score', team: Team.Corgis, pts: STEP_POINTS, reason: 'step' });
    expect(st(sim).step).toBe(1);
    expect(ms(sim).wave).toBe(2);
    expect(ms(sim).objective).toBe('Reach B (2/2)');
    expect([beacon(sim).x, beacon(sim).z]).toEqual([-20, 0]);
    expect(evs.some((e) => e.e === 'bark')).toBe(false); // no barks on these steps
  });

  it('reach (vehicle / airborne): a human must be in a vehicle / in the air; a bot-only squad waives it', async () => {
    const def = chapter([
      { id: 'air', text: 'Glide in', trigger: { type: 'reach', params: { x: 20, z: 0, radius: 4, airborne: true } } },
      { id: 'car', text: 'Drive in', trigger: { type: 'reach', params: { x: -20, z: 0, radius: 4, vehicle: true } } },
    ]);
    const sim = await advSim(def);
    const h = human(sim);
    live(sim);
    teleport(sim, h, 20, 0);
    run(sim, 0.3);
    expect(st(sim).step).toBe(0); // standing there is not enough
    teleport(sim, h, 20, 0, 4); // in the air over it
    run(sim, 2 / TICK_HZ);
    expect(st(sim).step).toBe(1);
    teleport(sim, h, -20, 0);
    run(sim, 0.3);
    expect(st(sim).step).toBe(1); // on foot
    const id = sim.allocId(); // a vehicle it drives (vehicle snapshot convention: weapon = rider id)
    sim.entities.set(id, { ...h, id, kind: EntityKind.Vehicle, char: null, collider: null, weapon: h.id, pos: { x: -19, y: 0, z: 1 }, vel: { x: 0, y: 0, z: 0 }, data: {}, health: null });
    teleport(sim, h, 30, 30);
    run(sim, 2 / TICK_HZ);
    expect(st(sim).phase).toBe('complete');

    const sim2 = await advSim(chapter([def.steps[1]]));
    const b = bot(sim2, Team.Corgis, 0, 40);
    live(sim2);
    teleport(sim2, b, -20, 0);
    run(sim2, 2 / TICK_HZ);
    expect(st(sim2).phase).toBe('complete'); // no human: bots don't drive, so the vehicle rule is waived
  });

  it('interact: E inside the radius; with a human in the squad only a human counts; the kiosk variant takes a kit swap too', async () => {
    const def = chapter([
      { id: 'use', text: 'Use it', trigger: { type: 'interact', params: { x: 10, z: 0, radius: 2.5, prompt: 'use it' } } },
      { id: 'kit', text: 'Swap kit', trigger: { type: 'interact', params: { x: -10, z: 0, radius: 3, prompt: KIOSK_PROMPT } } },
      { id: 'use2', text: 'Use it again', trigger: { type: 'interact', params: { x: 10, z: 10, radius: 2.5, prompt: 'use it' } } },
    ]);
    const sim = await advSim(def);
    const h = human(sim);
    const b = bot(sim, Team.Corgis, 0, 40, true); // external brain: this test drives its buttons
    live(sim);
    teleport(sim, h, 10, 4); press(sim, h, Btn.Interact); run(sim, 1 / TICK_HZ); press(sim, h, 0); run(sim, 1 / TICK_HZ);
    expect(st(sim).step).toBe(0); // out of reach
    teleport(sim, b, 10, 1); press(sim, b, Btn.Interact); run(sim, 1 / TICK_HZ); press(sim, b, 0); run(sim, 1 / TICK_HZ);
    expect(st(sim).step).toBe(0); // a bot doesn't steal it while a human plays
    teleport(sim, h, 10.5, 1); press(sim, h, Btn.Interact); run(sim, 2 / TICK_HZ); press(sim, h, 0);
    expect(st(sim).step).toBe(1);
    teleport(sim, h, -9, 1);
    sim.emit({ e: 'ability', id: 777, ability: 'kit_swap', x: h.pos.x, y: 0, z: h.pos.z }); // S1: an in-place kit swap there
    run(sim, 2 / TICK_HZ);
    expect(st(sim).step).toBe(2);
    sim.removeEntity(h.id); // the human leaves: now the bot may use it
    teleport(sim, b, 10, 9.5); press(sim, b, Btn.Interact); run(sim, 2 / TICK_HZ);
    expect(st(sim).phase).toBe('complete');
  });

  it('hold: progress while the squad holds it, paused while a cat contests it, drains when empty', async () => {
    const def = chapter([{ id: 'hold', text: 'Hold it', trigger: { type: 'hold', params: { x: 0, z: 0, radius: 6, seconds: 4 } } }]);
    const sim = await advSim(def);
    const h = human(sim);
    live(sim);
    teleport(sim, h, 1, 1);
    run(sim, 2);
    expect(st(sim).progress).toBeGreaterThan(0.45);
    const cat = bot(sim, Team.Cats, 2, -1, true);
    run(sim, 1);
    const p = st(sim).progress;
    expect(st(sim).contested).toBe(true);
    expect(beacon(sim).flags & EFlag.Busy).toBeTruthy();
    expect(ms(sim).objective).toContain('CONTESTED!');
    run(sim, 1);
    expect(st(sim).progress).toBeCloseTo(p, 5);
    sim.removeEntity(cat.id);
    teleport(sim, h, 30, 30);
    run(sim, 1);
    expect(st(sim).progress).toBeLessThan(p);
    teleport(sim, h, 0, 1);
    run(sim, 4, [], () => st(sim).phase === 'complete');
    expect(st(sim).phase).toBe('complete');
  });

  it('collect: an item waits at every spot; walking into `count` of them completes it (pickup events)', async () => {
    const spots = [{ x: 10, z: 0 }, { x: -10, z: 0 }, { x: 0, z: -12 }];
    const def = chapter([{ id: 'bags', text: 'Grab the bags', trigger: { type: 'collect', params: { item: 'catnip', count: 2, spots } } }]);
    const sim = await advSim(def);
    const h = human(sim);
    live(sim);
    const items = sim.snapshotEntities().filter((s) => s.kind === EntityKind.Prop && s.seed === ADVENTURE_ITEM_SEED);
    expect(items.map((s) => [s.x, s.z, s.cls, s.weapon])).toEqual(spots.map((s) => [s.x, s.z, -1, 0]));
    expect([beacon(sim).x, beacon(sim).z]).toEqual([10, 0]); // the item nearest the squad (both at 40 m… first wins)
    teleport(sim, h, 10.4, 0.5);
    const evs = run(sim, 2 / TICK_HZ);
    expect(evs).toContainEqual({ e: 'pickup', id: h.id, item: 'catnip' });
    expect(st(sim).counters.catnip).toBe(1);
    expect(ms(sim).objective).toBe('Grab the bags 1/2 (1/1)');
    teleport(sim, h, 0, -11.5);
    run(sim, 2 / TICK_HZ);
    expect(st(sim).phase).toBe('complete');
    expect(sim.snapshotEntities().some((s) => s.seed === ADVENTURE_ITEM_SEED)).toBe(false); // the spare one goes too
  });

  it('defeat: tag + count, a boss by id, and a plain count during the step', async () => {
    const def = chapter([
      { id: 'tagged', text: 'Down the patrol', trigger: { type: 'defeat', params: { count: 2, tag: 'patrol' } }, spawns: [{ archetype: 'grunt', count: 2, at: { x: 0, z: -50 }, tag: 'patrol' }, { archetype: 'grunt', count: 1, at: { x: 40, z: -50 }, tag: 'other' }] },
      { id: 'boss', text: 'Beat the Vac-Tank', trigger: { type: 'defeat', params: { boss: 'vac_tank' } }, spawns: [{ archetype: 'vac_tank', count: 1, at: { x: -30, z: -40 } }] },
      { id: 'any', text: 'Two more', trigger: { type: 'defeat', params: { count: 2 } }, spawns: [{ archetype: 'kitten', count: 2, at: { x: 30, z: -40 } }] },
    ]);
    const sim = await advSim(def);
    human(sim);
    live(sim);
    const cats = () => [...sim.entities.values()].filter((e) => e.adv && !e.dead);
    const src = { id: -1, team: Team.Corgis, weapon: -1 } as const;
    expect(cats().map((e) => e.adv!.tag).sort()).toEqual(['other', 'patrol', 'patrol']);
    kill(sim, cats().find((e) => e.adv!.tag === 'other')!, src);
    run(sim, 0.1);
    expect(st(sim).step).toBe(0); // the wrong tag doesn't count
    for (const e of cats().filter((c) => c.adv!.tag === 'patrol')) kill(sim, e, src);
    const evs = run(sim, 2 / TICK_HZ);
    expect(st(sim).step).toBe(1);
    expect(st(sim).counters['kills:patrol']).toBe(2);
    expect(evs.filter((e) => e.e === 'score' && e.reason === 'kill').length).toBe(2); // a point per cat down
    const boss = [...sim.entities.values()].find((e) => e.kind === EntityKind.Boss)!;
    expect(boss).toBeTruthy();
    run(sim, 0.2);
    expect([beacon(sim).x, beacon(sim).z].map(Math.round)).toEqual([Math.round(boss.pos.x), Math.round(boss.pos.z)]); // marks the target
    kill(sim, boss, src);
    run(sim, 2 / TICK_HZ);
    expect(st(sim).step).toBe(2);
    const left = [...sim.entities.values()].filter((e) => e.adv && !e.dead);
    expect(left.map((e) => e.adv!.step)).toEqual([2, 2]);
    kill(sim, left[0], src);
    run(sim, 0.1);
    expect(st(sim).step).toBe(2);
    expect(ms(sim).objective).toBe('Two more 1/2 (3/3)');
    kill(sim, left[1], src);
    run(sim, 2 / TICK_HZ);
    expect(st(sim).phase).toBe('complete');
  });

  it('destroy: counts destructibles with the tag as they break or vanish (default probe: component / data tag / WorldData entry)', async () => {
    const def = chapter([{ id: 'wreck', text: 'Wreck the stacks', trigger: { type: 'destroy', params: { tag: 'tuna_stack', count: 3 } } }]);
    const sim = await advSim(def);
    (sim.worldData as { destructibles?: unknown[] }).destructibles = [{ id: 'tuna_stack_9', tag: 'tuna_stack', x: 30, z: 5 }];
    human(sim);
    const mk = (x: number, z: number, name: string, data: Record<string, unknown> = {}, comp?: Record<string, unknown>) => {
      const id = sim.allocId();
      const e = {
        id, kind: EntityKind.Destructible, team: Team.Neutral, species: 0, cls: null, seed: 0, name, pos: { x, y: 0, z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0,
        collider: null, input: { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }, prevButtons: 0, lastInputSeq: 0, char: null,
        health: { hp: 100, max: 100, lastDamageTick: -1, lastAttacker: -1 }, anim: 0, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
        ownerPid: null, removed: false, data, ...(comp ? { destruct: comp } : {}),
      } as unknown as SimEntity;
      sim.entities.set(id, e);
      return e;
    };
    const a = mk(10, 0, 'a', { tag: 'tuna_stack' });
    const b = mk(20, 0, 'b', {}, { tag: 'tuna_stack', broken: false });
    const c = mk(30, 5, 'tuna_stack_9');
    const wall = mk(-10, 0, 'wall', { tag: 'breach_wall' });
    live(sim);
    run(sim, 0.2);
    expect([beacon(sim).x, beacon(sim).z]).toEqual([10, 0]);
    a.health!.hp = 0;                                    // broken by damage
    (b as unknown as { destruct: { broken: boolean } }).destruct.broken = true; // broken by its component
    run(sim, 0.1);
    expect(st(sim).counters['broken:tuna_stack']).toBe(2);
    expect(st(sim).phase).toBe('live');
    wall.dead = true;
    sim.removeEntity(c.id);                               // gone from the sim (X1 may remove broken props)
    run(sim, 2 / TICK_HZ);
    expect(st(sim).counters['broken:tuna_stack']).toBe(3);
    expect(st(sim).counters['broken:breach_wall']).toBe(1);
    expect(st(sim).phase).toBe('complete');
  });

  it('survive: completes after the seconds without a wipe; MatchState.timeLeft counts down', async () => {
    const def = chapter([{ id: 'hang', text: 'Hang on', trigger: { type: 'survive', params: { seconds: 3 } } }]);
    const sim = await advSim(def);
    human(sim);
    live(sim);
    run(sim, 1);
    expect(ms(sim).timeLeft).toBeGreaterThan(1.9);
    expect(ms(sim).timeLeft).toBeLessThan(2.1);
    expect(ms(sim).objective).toBe('Hang on 2s (1/1)');
    expect(beacon(sim).maxHp).toBe(3);
    run(sim, 2.1);
    expect(st(sim).phase).toBe('complete');
  });
});

describe('adventure: stealth alarm', () => {
  const grass: ConcealZone[] = [{ id: 'grass', x: 0, z: 20, rx: 7, rz: 7, h: 2.4 }];
  const def = chapter([{
    id: 'sneak', text: 'Sneak past', trigger: { type: 'reach', params: { x: 60, z: 60, radius: 3 } },
    spawns: [{ archetype: 'grunt', count: 1, at: { x: 0, z: 0 }, tag: 'sentry' }], stealth: true,
    alarm: [{ archetype: 'kitten', count: 2, at: { x: 0, z: -40 } }],
  }], { start: { x: 50, z: 60, yaw: 0 } });

  it('a sentry that spots a corgi in the open raises the alarm: alarm spawns, sentries turn hunter, the beacon shows it', async () => {
    const sim = await advSim(def, {}, 3, grass);
    const h = human(sim);
    live(sim);
    const sentry = [...sim.entities.values()].find((e) => e.adv?.tag === 'sentry')!;
    expect(sentry.adv!.sentry!.route.length).toBeGreaterThanOrEqual(4); // a pacing loop around its post
    teleport(sim, h, 14, 12); // in the open, ~18 m from the post
    const evs = run(sim, 25, [], () => st(sim).alarm);
    expect(st(sim).alarm).toBe(true);
    expect(st(sim).counters.alarms).toBe(1);
    expect([...sim.entities.values()].filter((e) => e.adv?.tag === 'alarm').length).toBe(2);
    expect(sentry.adv!.sentry).toBeUndefined();
    expect(evs.some((e) => e.e === 'bark' && e.id === sentry.id)).toBe(true); // the cat yells
    run(sim, 2 / TICK_HZ);
    expect(beacon(sim).flags & EFlag.Busy).toBeTruthy();
    expect(ms(sim).objective).toContain('ALARM!');
  }, 30000);

  it('a still corgi hidden in the tall grass is never spotted: no alarm', async () => {
    const sim = await advSim(def, {}, 3, grass);
    const h = human(sim);
    live(sim);
    teleport(sim, h, 0, 20); // the middle of the grass, 15+ m from the sentry's loop
    run(sim, 1);
    expect(h.conceal!.level).toBeGreaterThan(0.9);
    let alerted = false;
    run(sim, 25, [], () => { alerted ||= [...sim.entities.values()].some((e) => e.adv && (e.flags & EFlag.Alerted)); return false; });
    expect(alerted).toBe(false);
    expect(st(sim).alarm).toBe(false);
    expect(st(sim).counters.alarms).toBe(0);
    expect([...sim.entities.values()].filter((e) => e.adv?.tag === 'alarm').length).toBe(0);
  }, 30000);
});

describe('adventure: fail forward', () => {
  it('a squad wipe holds respawns for the beat, then restarts at the last checkpoint (its cats and counters), not from zero', async () => {
    const def = chapter([
      { id: 'go', text: 'Go', trigger: { type: 'reach', params: { x: 10, z: 0, radius: 3 } } },
      { id: 'fight', text: 'Down both', trigger: { type: 'defeat', params: { count: 2, tag: 'x' } }, spawns: [{ archetype: 'grunt', count: 2, at: { x: 0, z: -50 }, tag: 'x' }], checkpoint: true },
      { id: 'wait', text: 'Wait', trigger: { type: 'survive', params: { seconds: 60 } } },
    ]);
    const sim = await advSim(def, { failBeat: 4 });
    const h = human(sim);
    live(sim);
    teleport(sim, h, 10, 0);
    run(sim, 0.2);
    expect(st(sim).step).toBe(1);
    const src = { id: -1, team: Team.Cats, weapon: -1 } as const;
    const x = () => [...sim.entities.values()].filter((e) => e.adv?.tag === 'x' && !e.dead);
    kill(sim, x()[0], { ...src, team: Team.Corgis });
    run(sim, 0.1);
    expect(st(sim).counters['kills:x']).toBe(1);
    teleport(sim, h, 40, 40);
    kill(sim, h, src); // the whole squad (one human) is down
    run(sim, 2 / TICK_HZ);
    expect(st(sim).phase).toBe('failed');
    expect(st(sim).wipes).toBe(1);
    expect(ms(sim).objective).toMatch(/^Squad down! Back to the checkpoint in \d$/);
    expect(beacon(sim).anim).toBe(ADVENTURE_PHASES.indexOf('failed'));
    run(sim, 3.8);
    expect(h.dead).toBe(true); // the 3 s respawn timer is held during the beat
    run(sim, 1, [], () => st(sim).phase === 'live');
    expect(st(sim).phase).toBe('live');
    expect(st(sim).step).toBe(1); // the checkpoint, not step 0
    expect(h.dead).toBe(false);
    expect(Math.hypot(h.pos.x - 10, h.pos.z)).toBeLessThan(5); // back at the rally point (where step 1 began)
    expect(st(sim).counters['kills:x'] ?? 0).toBe(0);
    const again = x();
    expect(again.length).toBe(2); // both cats of the checkpoint are back
    expect(again.map((e) => [e.pos.x, e.pos.z])).toEqual(adventureRuntime(sim)!.snap!.enemies.map((e) => [e.x, e.z])); // where they stood
    expect(adventureRuntime(sim)!.enemies.size).toBe(2);
    expect(beacon(sim).weapon).toBe(1);
  });
});

describe('adventure: fail forward with destructibles', () => {
  const fake = (sim: Sim, x: number, z: number, name: string): SimEntity => {
    const id = sim.allocId();
    const e = {
      id, kind: EntityKind.Destructible, team: Team.Neutral, species: 0, cls: null, seed: 0, name, pos: { x, y: 0, z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0,
      collider: null, input: { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }, prevButtons: 0, lastInputSeq: 0, char: null,
      health: { hp: 100, max: 100, lastDamageTick: -1, lastAttacker: -1 }, anim: 0, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
      ownerPid: null, removed: false, data: {}, dsx: { def: { id: name, tag: 'tuna_stack' }, broken: false }, // X1's component shape
    } as unknown as SimEntity;
    sim.entities.set(id, e);
    return e;
  };
  const brk = (e: SimEntity, on: boolean) => { (e as unknown as { dsx: { broken: boolean } }).dsx.broken = on; };
  const def = chapter([{ id: 'wreck', text: 'Wreck', trigger: { type: 'destroy', params: { tag: 'tuna_stack', count: 3 } }, checkpoint: true }]);

  it('a wipe rolls back the broken count: with a restore hook the props stand again; without one they recount', async () => {
    for (const withHook of [false, true]) {
      const sim = await advSim(def, { failBeat: 0.5 });
      const h = human(sim);
      const cans = [fake(sim, 10, 0, 'tuna_stack_0'), fake(sim, 12, 0, 'tuna_stack_1'), fake(sim, 14, 0, 'tuna_stack_2')];
      if (withHook) {
        registerCheckpointHook('test_destruct', {
          save: () => cans.map((c) => (c as unknown as { dsx: { broken: boolean } }).dsx.broken),
          restore: (_s, saved) => cans.forEach((c, i) => brk(c, (saved as boolean[])[i])),
        });
      }
      live(sim);
      brk(cans[0], true);
      run(sim, 0.1);
      expect(st(sim).counters['broken:tuna_stack']).toBe(1);
      kill(sim, h, { id: -1, team: Team.Cats, weapon: -1 });
      run(sim, 1, [], () => st(sim).phase === 'live' && st(sim).wipes === 1);
      run(sim, 0.1);
      expect(st(sim).wipes).toBe(1);
      if (withHook) {
        expect((cans[0] as unknown as { dsx: { broken: boolean } }).dsx.broken).toBe(false); // stood back up
        expect(st(sim).counters['broken:tuna_stack'] ?? 0).toBe(0);
      } else {
        expect(st(sim).counters['broken:tuna_stack']).toBe(1); // still broken in the world: counted again, not lost
      }
      brk(cans[1], true); brk(cans[2], true); if (withHook) brk(cans[0], true);
      run(sim, 2 / TICK_HZ);
      expect(st(sim).phase).toBe('complete'); // the step can still finish either way
      registerCheckpointHook('test_destruct', null);
    }
  });
});

describe('adventure: boss fights', () => {
  it('a defeat-boss step with no spawn for it brings the boss in at its default spot', async () => {
    const def = chapter([{ id: 'boss', text: 'Beat it', trigger: { type: 'defeat', params: { boss: 'vac_tank' } } }]);
    const sim = await advSim(def);
    human(sim);
    live(sim);
    const bosses = [...sim.entities.values()].filter((e) => e.kind === EntityKind.Boss);
    expect(bosses.length).toBe(1);
    expect(adventureRuntime(sim)!.enemies.get(bosses[0].id)?.boss).toBe('vac_tank');
    kill(sim, bosses[0], { id: -1, team: Team.Corgis, weapon: -1 });
    run(sim, 2 / TICK_HZ);
    expect(st(sim).phase).toBe('complete');
  });
});

describe('adventure: chapter complete', () => {
  it('time vs par → medal; MatchState ends with the corgis winning; the beacon carries time / par; then the next chapter loads', async () => {
    const def = chapter([{ id: 'go', text: 'Go', trigger: { type: 'reach', params: { x: 10, z: 0, radius: 3 } } }], { par: 2 });
    const sim = await advSim(def, { completeHold: 1 });
    const h = human(sim);
    live(sim);
    run(sim, 2.5);
    teleport(sim, h, 10, 0);
    const evs = run(sim, 2 / TICK_HZ);
    expect(st(sim).phase).toBe('complete');
    expect(st(sim).time).toBeGreaterThan(2.4);
    expect(st(sim).medal).toBe('silver'); // over par, under 1.5 × par
    expect(evs).toContainEqual({ e: 'score', team: Team.Corgis, pts: CHAPTER_POINTS, reason: 'chapter' });
    expect(ms(sim).phase).toBe('ended');
    expect(ms(sim).winner).toBe(Team.Corgis);
    expect(ms(sim).objective).toMatch(/^Chapter complete! 0:02 · SILVER paw$/);
    const b = beacon(sim);
    expect(b.weapon).toBe(1);
    expect(b.anim).toBe(ADVENTURE_PHASES.indexOf('complete'));
    expect(b.hp).toBeCloseTo(st(sim).time, 1);
    expect(b.maxHp).toBe(2);
    const oldMatch = sim.state.match;
    const evs2 = run(sim, 1.5, [], () => st(sim).phase === 'briefing');
    expect(evs2.filter((e) => e.e === 'score' && e.reason === 'reset').length).toBe(2);
    expect(st(sim).phase).toBe('briefing'); // not in CHAPTERS: it replays
    expect(sim.state.match).not.toBe(oldMatch);
    expect(h.dead).toBe(false);
  });
});

describe('adventure: bots', () => {
  it('bot squad (no human) runs reach → interact → collect → defeat by itself', async () => {
    const def = chapter([
      { id: 'r', text: 'Reach', trigger: { type: 'reach', params: { x: 20, z: 10, radius: 3 } } },
      { id: 'i', text: 'Use', trigger: { type: 'interact', params: { x: -15, z: 0, radius: 2.5, prompt: 'use' } } },
      { id: 'c', text: 'Collect', trigger: { type: 'collect', params: { item: 'catnip', count: 3, spots: [{ x: 0, z: -10 }, { x: 10, z: -20 }, { x: -12, z: -24 }] } } },
      { id: 'd', text: 'Defeat', trigger: { type: 'defeat', params: { count: 2, tag: 'd' } }, spawns: [{ archetype: 'grunt', count: 2, at: { x: 0, z: -45 }, tag: 'd' }] },
    ]);
    const sim = await advSim(def);
    for (let i = 0; i < 3; i++) bot(sim, Team.Corgis, 0, 40);
    live(sim);
    run(sim, 120, [], () => st(sim).phase === 'complete');
    expect(st(sim).phase).toBe('complete');
    expect(st(sim).time).toBeLessThan(100);
  }, 60000);

  it('with a human in the squad, bots hang back during a stealth step, and join once the alarm is up', async () => {
    const def = chapter([{
      id: 'sneak', text: 'Sneak', trigger: { type: 'reach', params: { x: 0, z: -40, radius: 3 } }, stealth: true,
      spawns: [{ archetype: 'grunt', count: 1, at: { x: 60, z: -60 }, tag: 'sentry' }], alarm: [{ archetype: 'grunt', count: 1, at: { x: 60, z: -60 } }],
    }], { start: { x: 0, z: 40, yaw: 0 } });
    const sim = await advSim(def);
    human(sim, 0, 40);
    const pups = [bot(sim, Team.Corgis, 0, 40), bot(sim, Team.Corgis, 0, 40)];
    live(sim);
    run(sim, 8);
    for (const p of pups) expect(Math.hypot(p.pos.x, p.pos.z - 40)).toBeLessThan(8); // at the rally point
    st(sim).alarm = true; // (as if a sentry had spotted the human)
    run(sim, 10);
    for (const p of pups) expect(p.pos.z).toBeLessThan(10); // on their way to the objective
  }, 60000);
});

describe('adventure: determinism', () => {
  it('same seed ⇒ same run (bots, spawns, sentries, alarm)', async () => {
    const def = chapter([
      { id: 'sneak', text: 'Sneak', trigger: { type: 'reach', params: { x: 0, z: -20, radius: 3 } }, stealth: true, spawns: [{ archetype: 'grunt', count: 2, at: { x: 0, z: 0 }, tag: 'sentry' }], alarm: [{ archetype: 'kitten', count: 2, at: { x: 30, z: -30 } }], checkpoint: true },
      { id: 'd', text: 'Defeat', trigger: { type: 'defeat', params: { tag: 'alarm' } } },
      { id: 's', text: 'Survive', trigger: { type: 'survive', params: { seconds: 5 } } },
    ]);
    const once = async () => {
      const sim = await advSim(def, {}, 11);
      for (let i = 0; i < 3; i++) bot(sim, Team.Corgis, 0, 40);
      const evs = run(sim, 40);
      const s = st(sim);
      const digest = sim.snapshotEntities().map((e) => [e.id, e.kind, e.team, +e.x.toFixed(4), +e.z.toFixed(4), e.hp, e.flags].join(':')).join('|');
      return { phase: s.phase, step: s.step, tick: s.startTick, counters: JSON.stringify(s.counters), events: evs.length, digest, time: s.time };
    };
    const a = await once(), b = await once();
    expect(b).toEqual(a);
    expect(a.counters).not.toBe('{"kills":0,"alarms":0,"deaths":0}'); // something happened
  }, 60000);
});
