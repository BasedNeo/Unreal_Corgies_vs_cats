// C2b: bots use their class abilities when it makes tactical sense, hunt what their drones spot, and play the
// objectives (Upgrade Cores, the objective chain) — on a flat trimesh yard with the default system list.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Btn } from '../../src/shared/input';
import { Team, Species, EFlag, EntityKind, type TeamId, type ClassId } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import type { WorldData } from '../../src/shared/world/world-data';
import type { PropBox } from '../../src/shared/world/world-types';
import type { PickupLayout } from '../../src/shared/content/pickups';
import type { ObjectiveChain } from '../../src/shared/content/objectives';
import { objectiveState, type InteractConfig } from '../../src/sim/interact';
import { abilityEntities } from '../../src/sim/combat/ability-core';
import { coreRushPads } from '../../src/sim/match';
import { createWorldData } from '../../src/shared/world/world-data';
import { TICK_HZ } from '../../src/shared/constants';

function yard(props: PropBox[] = []): WorldData {
  const n = 81, cell = 2;
  return {
    seed: 1, name: 'tactics test yard', height: () => 0, halfExtent: 80, killY: -30, props,
    terrain: { x0: -80, z0: -80, cell, n, heights: new Float32Array(n * n) },
    spawns: [{ x: -40, y: 0, z: 60, yaw: 0, team: Team.Corgis }, { x: 40, y: 0, z: -60, yaw: Math.PI, team: Team.Cats }],
  } as WorldData;
}

async function sim(props: PropBox[] = [], cfg?: InteractConfig, seed = 7): Promise<Sim> {
  const s = await Sim.create({ seed, world: yard(props) });
  if (cfg) s.state.interactConfig = cfg;
  s.step();
  s.drainEvents();
  return s;
}

function bot(s: Sim, team: TeamId, cls: ClassId, x: number, z: number, yaw = 0): SimEntity {
  return s.spawnCharacter({ kind: EntityKind.Bot, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `b${s.entities.size}`, x, y: 0.02, z, yaw });
}
function dummy(s: Sim, team: TeamId, x: number, z: number, cls: ClassId = 'assault', yaw = 0): SimEntity {
  return s.spawnCharacter({ team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `d${s.entities.size}`, x, y: 0.02, z, yaw });
}

let seq = 1;
function input(s: Sim, e: SimEntity, buttons: number, yaw: number, pitch = 0, mz = 0): void {
  s.setInput(e.id, { seq: seq++, mx: 0, mz, yaw, pitch, buttons, rt: 0 });
}

function run(s: Sim, seconds: number, out: GameEvent[] = [], each?: () => void, until?: () => boolean): GameEvent[] {
  for (let i = 0; i < Math.round(seconds * TICK_HZ); i++) {
    each?.();
    s.step();
    out.push(...s.drainEvents());
    if (until?.()) break;
  }
  return out;
}

const used = (evs: GameEvent[], e: SimEntity, ability: string) => evs.some((v) => v.e === 'ability' && v.id === e.id && v.ability === ability);

describe('bots use their class ability', () => {
  it('assault: bark blast on an enemy in reach in front', async () => {
    const s = await sim();
    const b = bot(s, Team.Corgis, 'assault', 0, 0, 0);
    dummy(s, Team.Cats, 0.5, -4);
    const evs = run(s, 1.5);
    expect(used(evs, b, 'bark_blast')).toBe(true);
  });

  it('assault: never barks at an enemy it cannot perceive (cloaked just outside the reveal range)', async () => {
    const s = await sim();
    const sneak = dummy(s, Team.Cats, 0.3, -6.3, 'infiltrator', Math.PI);
    input(s, sneak, Btn.Ability, Math.PI);
    run(s, 2 / TICK_HZ);
    input(s, sneak, 0, Math.PI);
    expect(sneak.flags & EFlag.Stealthed).toBeTruthy();
    const b = bot(s, Team.Corgis, 'assault', 0, 0, 0);
    // (the bot may wander up to it and see it inside the 6 m reveal range: a bark is only fair once it does)
    let unfair = 0, barks = 0;
    for (let i = 0; i < 120; i++) {
      s.step();
      for (const v of s.drainEvents()) {
        if (v.e !== 'ability' || v.id !== b.id || v.ability !== 'bark_blast') continue;
        barks++;
        if (!(b.ai!.visible && b.ai!.target === sneak.id)) unfair++;
      }
    }
    expect(unfair).toBe(0);
    if (barks === 0) expect(sneak.health!.hp).toBe(sneak.health!.max);
  });

  it('overwatch: launches a drone while searching with nobody in sight', async () => {
    const s = await sim();
    const b = bot(s, Team.Corgis, 'overwatch', 0, 20);
    dummy(s, Team.Cats, 60, -60); // someone to look for, far away
    const evs = run(s, 6, [], undefined, () => abilityEntities(s).length > 0);
    expect(used(evs, b, 'spotter_drone')).toBe(true);
    expect(abilityEntities(s).some((a) => a.abx!.kind === 'drone' && a.abx!.owner === b.id)).toBe(true);
  });

  it('warden: shot at in the open from range, walls off the shooter and takes cover behind it', async () => {
    const s = await sim();
    const w = bot(s, Team.Corgis, 'warden', 0, 0, Math.PI / 2); // looking sideways; the shooter is at -Z
    const shooter = dummy(s, Team.Cats, 0, -16, 'assault', Math.PI);
    const evs: GameEvent[] = [];
    let k = 0;
    run(s, 4, evs, () => {
      // pepper the warden (hip fire, a burst every half second) until a wall stands
      const dx = w.pos.x - shooter.pos.x, dz = w.pos.z - shooter.pos.z;
      input(s, shooter, k++ % 30 < 8 ? Btn.Fire : 0, Math.atan2(-dx, -dz), -0.02);
    }, () => abilityEntities(s).some((a) => a.abx!.kind === 'barrier'));
    expect(used(evs, w, 'squeak_barrier')).toBe(true);
    const bar = abilityEntities(s).find((a) => a.abx!.kind === 'barrier')!;
    // between the warden and the shooter
    expect(bar.pos.z).toBeLessThan(w.pos.z - 0.5);
    expect(bar.pos.z).toBeGreaterThan(shooter.pos.z);
    run(s, 0.1);
    expect(w.ai!.mode).toBe('cover');
  });

  it('breacher: mines the path of an enemy closing in', async () => {
    const s = await sim();
    const b = bot(s, Team.Corgis, 'breacher', 0, 0, 0);
    const runner = dummy(s, Team.Cats, 0, -15, 'assault', Math.PI);
    const evs = run(s, 5, [], () => input(s, runner, 0, Math.PI, 0, 1), () => abilityEntities(s).some((a) => a.abx!.kind === 'charge'));
    expect(used(evs, b, 'dig_charge')).toBe(true);
  });

  it('infiltrator: cloaks to sneak up on a noise, or when hurt', async () => {
    const s = await sim();
    const b = bot(s, Team.Corgis, 'infiltrator', 0, 0, 0);
    const noisy = dummy(s, Team.Cats, 0, 26, 'assault', 0); // behind the bot, facing away (+Z side)
    let k = 0;
    const evs = run(s, 12, [], () => {
      // fire into the air every ~3 s (each burst is a fresh noise → a fresh "sneak up?" roll)
      input(s, noisy, (k++ % 180) < 6 ? Btn.Fire : 0, 0, 1.2);
      if (b.ai && b.ai.mode === 'engage') { b.health!.hp = Math.min(b.health!.hp, b.health!.max * 0.4); b.health!.lastDamageTick = s.tick; }
    }, () => !!(b.flags & EFlag.Stealthed));
    expect(used(evs, b, 'shadow_cloak')).toBe(true);
  });

  it('skyraider: long trips become double jump + ear glide', async () => {
    const s = await sim();
    const r = bot(s, Team.Corgis, 'skyraider', -50, 50);
    dummy(s, Team.Cats, 60, -60);
    let glided = false;
    const evs = run(s, 20, [], () => { if (r.flags & EFlag.Gliding) glided = true; }, () => glided);
    expect(glided).toBe(true);
    expect(used(evs, r, 'ear_glide')).toBe(true);
  });
});

describe('bots hunt what their drones spot', () => {
  it('a patrolling bot with nobody in sight goes to investigate a spotted enemy', async () => {
    // the enemy is behind a wall: the bot cannot see it, it only knows through the Spotted flag
    const s = await sim([{ type: 'fence', x: 0, y: 2, z: -12, hx: 6, hy: 2, hz: 0.3, rotY: 0 }]);
    const b = bot(s, Team.Corgis, 'assault', 0, 0, Math.PI); // facing away
    const hidden = dummy(s, Team.Cats, 0, -16);
    run(s, 0.5);
    hidden.spotUntil = s.tick + 10 * TICK_HZ; // as if a corgi drone saw it
    run(s, 0.5, [], () => { hidden.spotUntil = s.tick + 30; });
    expect(b.ai!.mode).toBe('alert');
    expect(Math.hypot(b.ai!.alertX - hidden.pos.x, b.ai!.alertZ - hidden.pos.z)).toBeLessThan(1);
  });
});

describe('bots shoot down enemy drones', () => {
  it('with nobody to fight, a bot shoots an enemy drone in sight out of the air', async () => {
    // the drone's owner hides behind a low wall; the drone flies over it into the cat's view
    const s = await sim([{ type: 'fence', x: 0, y: 0.7, z: -3, hx: 3, hy: 0.7, hz: 0.3, rotY: 0 }]);
    const owner = dummy(s, Team.Corgis, 0, 0, 'overwatch', 0);
    const cat = bot(s, Team.Cats, 'assault', 0, -18, Math.PI);
    run(s, 0.3);
    input(s, owner, Btn.Ability, 0);
    run(s, 2 / TICK_HZ);
    input(s, owner, 0, 0);
    const drone = abilityEntities(s).find((a) => a.abx!.kind === 'drone')!;
    expect(drone).toBeTruthy();
    const evs = run(s, 5, [], undefined, () => drone.removed);
    expect(evs.some((v) => v.e === 'hit' && v.dst === drone.id && v.src === cat.id)).toBe(true);
    expect(drone.removed).toBe(true);
    expect(owner.health!.hp).toBe(owner.health!.max);
  });
});

describe('bots stick with their human', () => {
  it('a patrolling bot goes to help a human teammate who is being shot, instead of wandering off', async () => {
    // the shooter is out of the bot's earshot (48 m > the rifle's 38 m noise) and behind its back
    const s = await sim();
    const b = bot(s, Team.Corgis, 'assault', 0, 0, Math.PI);
    const human = s.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'you', x: 14, y: 0.02, z: -20, yaw: 0, ownerPid: 'p' });
    const foe = dummy(s, Team.Cats, 44, -20, 'assault', Math.PI / 2);
    run(s, 0.3);
    run(s, 1.2, [], () => {
      const dx = human.pos.x - foe.pos.x, dz = human.pos.z - foe.pos.z;
      input(s, foe, Btn.Fire, Math.atan2(-dx, -dz), 0);
      input(s, human, 0, 0);
    });
    expect(human.health!.lastDamageTick).toBeGreaterThan(0);
    expect(['alert', 'engage']).toContain(b.ai!.mode);
    // heading into the fight: between the human and the shooter
    if (b.ai!.mode === 'alert') {
      expect(b.ai!.alertX).toBeGreaterThan(human.pos.x - 1);
      expect(b.ai!.alertX).toBeLessThan(foe.pos.x + 1);
      expect(Math.abs(b.ai!.alertZ - human.pos.z)).toBeLessThan(3);
    }
  });
});

describe('bots play the objectives', () => {
  const CHAIN: ObjectiveChain = {
    id: 'yard_squeaker', map: 'tactics test yard', mode: 'test', team: Team.Corgis, doneText: 'Done!', doneTime: 2,
    steps: [
      { id: 'grab', district: 'test', text: 'Grab it', trigger: { type: 'interact', params: { x: 14, z: -6, radius: 2.6, prompt: 'grab it' } },
        reward: { score: 5, roster: 50, bark: 'Got it!', item: 'squeaker' } },
      { id: 'hold', district: 'test', text: 'Hold the pad', trigger: { type: 'hold', params: { x: -12, z: 8, radius: 6, height: 10, seconds: 3, decay: 0.5 } },
        reward: { score: 5, roster: 30, bark: 'Held!' } },
    ],
  };

  it('corgi bots run the chain with no human: walk to the interact point and use it, then hold the zone', async () => {
    const s = await sim([], { auto: true, terminals: false, cores: false, kibble: false, chain: CHAIN });
    bot(s, Team.Corgis, 'assault', 0, 0);
    bot(s, Team.Corgis, 'infiltrator', 2, 0);
    let grabbedAt = -1, doneAt = -1;
    run(s, 40, [], () => {
      const st = objectiveState(s)!;
      if (grabbedAt < 0 && st.step >= 1) grabbedAt = s.time;
      if (doneAt < 0 && st.step >= 2) doneAt = s.time;
    }, () => doneAt >= 0);
    expect(grabbedAt).toBeGreaterThan(0);
    expect(grabbedAt).toBeLessThan(15);
    expect(doneAt).toBeGreaterThan(grabbedAt);
    expect(doneAt).toBeLessThan(35);
  });

  it('a healthy bot walks over to an Upgrade Core in reach and takes it', async () => {
    const layout: PickupLayout = { cores: [{ id: 'c0', x: 12, y: 0.8, z: 6, hint: 'east' }], kibble: [] };
    const s = await sim([], { auto: true, terminals: false, kibble: false, objectives: false, layout, coreFirstSpawn: 0.05, coreStagger: 0 });
    const b = bot(s, Team.Corgis, 'assault', -4, 0);
    const evs: GameEvent[] = [];
    run(s, 12, evs, undefined, () => evs.some((v) => v.e === 'pickup'));
    const pick = evs.find((v) => v.e === 'pickup');
    expect(pick).toBeTruthy();
    expect(pick!.e === 'pickup' && pick!.id).toBe(b.id);
  });
});

describe('bots play core-rush', () => {
  it('4v4 bots on the West Yard: both teams own at least one Core Pad within 90 s', async () => {
    const s = await Sim.create({ seed: 9, world: createWorldData(9) });
    s.state.room = { mode: 'core-rush' };
    s.state.matchConfig = { coreRush: { warmup: 0.1 } };
    const classes: ClassId[] = ['assault', 'infiltrator', 'breacher', 'warden'];
    for (const team of [Team.Corgis, Team.Cats] as TeamId[]) {
      for (const cls of classes) {
        const sp = s.pickSpawn(team);
        s.spawnCharacter({ kind: EntityKind.Bot, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `${team}${cls}`, x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw });
      }
    }
    const owned = [false, false];
    let at = -1;
    run(s, 90, [], () => {
      for (const p of coreRushPads(s)) if (p.owner === Team.Corgis || p.owner === Team.Cats) owned[p.owner] = true;
    }, () => { if (owned[0] && owned[1]) { at = s.time; return true; } return false; });
    expect(coreRushPads(s).length).toBe(3);
    expect(owned).toEqual([true, true]);
    expect(at).toBeLessThan(90);
  });
});
