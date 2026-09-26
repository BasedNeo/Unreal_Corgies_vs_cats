// S1 interaction systems on a deterministic flat test yard: Ordnance Terminal (placement, range/team,
// in-place kit swap + the Room's class/team rules), Upgrade Cores (spawn/respawn, buffs that restore
// exactly), Golden Kibble (collection, roster score, shared respawn, authority only) and the objective
// chain (order, hold contest/decay, rewards, reset on match restart).
import { describe, it, expect } from 'vitest';
import { Sim, type SimSystem } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room, type Conn } from '../../src/host/room';
import { Btn, type InputCmd } from '../../src/shared/input';
import { EFlag, EntityKind, Species, Team, type ClassId, type TeamId } from '../../src/shared/types';
import type { GameEvent, MatchState, ServerMsg } from '../../src/shared/protocol';
import type { WorldData } from '../../src/shared/world/world-data';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { combatSystems, kill } from '../../src/sim/combat';
import { matchSystems } from '../../src/sim/match';
import { vehicleSystems, findTerminalSite } from '../../src/sim/vehicles';
import {
  interactSystems, trySwapKit, grantBuff, clearBuffs, objectiveState, takeObjectiveScore, foldObjectiveText,
  kartKeepOut, touchesPickup, type InteractConfig,
} from '../../src/sim/interact';
import { TERMINALS, terminalIndex } from '../../src/shared/content/terminals';
import { CORE_IDS, PICKUPS, PICKUP_IDS, type PickupLayout } from '../../src/shared/content/pickups';
import type { ObjectiveChain } from '../../src/shared/content/objectives';
import { CLASSES } from '../../src/shared/content/classes';
import { WEAPON_IDS } from '../../src/shared/content/weapons';
import { validateClientMsg } from '../../src/host/guard';

const ORD = TERMINALS.ordnance_terminal;

// ------------------------------------------------------------------------------------------------ fixtures
function yard(): WorldData {
  const n = 81, cell = 2;
  return {
    seed: 1, name: 'interact test yard', height: () => 0, halfExtent: 80, killY: -30,
    terrain: { x0: -80, z0: -80, cell, n, heights: new Float32Array(n * n) },
    props: [],
    spawns: [
      { x: -40, y: 0, z: 40, yaw: 0, team: Team.Corgis }, { x: -34, y: 0, z: 42, yaw: 0, team: Team.Corgis },
      { x: 40, y: 0, z: -40, yaw: Math.PI, team: Team.Cats }, { x: 34, y: 0, z: -42, yaw: Math.PI, team: Team.Cats },
    ],
    bounds: { minX: -78, maxX: 78, minZ: -78, maxZ: 78 },
  };
}

const LAYOUT: PickupLayout = {
  cores: [
    { id: 'c0', x: 1, y: 0.8, z: 1, hint: 'middle' },
    { id: 'c1', x: 13, y: 0.8, z: 1, hint: 'east' },
  ],
  kibble: [
    { id: 'k0', x: 1, y: 0.55, z: 13, hint: 'south' },
    { id: 'k1', x: -11, y: 0.55, z: 13, hint: 'south-west' },
  ],
};

const CHAIN: ObjectiveChain = {
  id: 'yard_squeaker', map: 'interact test yard', mode: 'test', team: Team.Corgis, doneText: 'Done!', doneTime: 2,
  steps: [
    { id: 'grab', district: 'test', text: 'Grab it', trigger: { type: 'interact', params: { x: 20, z: 20, radius: 2.6, prompt: 'grab it' } },
      reward: { score: 5, roster: 50, bark: 'Got it!', item: 'squeaker' } },
    { id: 'hold', district: 'test', text: 'Hold the pad', trigger: { type: 'hold', params: { x: -20, z: 20, radius: 5, height: 10, seconds: 2, decay: 0.5 } },
      reward: { score: 5, roster: 30, bark: 'Held!' } },
    { id: 'bark', district: 'test', text: 'Bark at it', trigger: { type: 'interact', params: { x: 20, z: -20, radius: 3, prompt: 'bark' } },
      reward: { score: 25, roster: 100, bark: 'BORK!' } },
  ],
};

const SYSTEMS = (): SimSystem[] => [...interactSystems(), movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems()];

async function makeSim(config: InteractConfig = {}, systems: SimSystem[] = SYSTEMS()): Promise<Sim> {
  const sim = await Sim.create({ seed: 5, world: yard(), systems });
  sim.state.interactConfig = { auto: true, layout: LAYOUT, chain: CHAIN, ...config } satisfies InteractConfig;
  return sim;
}

function spawn(sim: Sim, team: TeamId, x: number, z: number, cls: ClassId = 'assault'): SimEntity {
  return sim.spawnCharacter({ team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `t${sim.entities.size}`, x, y: 0.02, z, ownerPid: team === Team.Corgis ? 'p' : null });
}

let seq = 1;
function input(sim: Sim, e: SimEntity, over: Partial<InputCmd> = {}): void {
  sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw: e.yaw, pitch: 0, buttons: 0, rt: 0, ...over });
}

function run(sim: Sim, ticks: number, each?: () => void): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) { each?.(); sim.step(); out.push(...sim.drainEvents()); }
  return out;
}

/** Walk a character to (x, z) (steering every tick) and stop there. */
function walkTo(sim: Sim, e: SimEntity, x: number, z: number, maxTicks = 600): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < maxTicks; i++) {
    const dx = x - e.pos.x, dz = z - e.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.15) break;
    input(sim, e, { mz: d > 0.4 ? 1 : 0.3, yaw: Math.atan2(-dx, -dz) });
    sim.step();
    out.push(...sim.drainEvents());
  }
  input(sim, e);
  out.push(...run(sim, 10));
  return out;
}

const kiosks = (sim: Sim) => [...sim.entities.values()].filter((e) => e.ordnance);
const kioskOf = (sim: Sim, team: TeamId) => kiosks(sim).find((k) => k.team === team)!;
const pickups = (sim: Sim) => [...sim.entities.values()].filter((e) => e.pickup);
const spot = (sim: Sim, id: string) => pickups(sim).find((e) => e.pickup!.spotId === id)!;
/** A standing point `d` m in front of a kiosk's screen. */
function inFront(k: SimEntity, d: number): [number, number] {
  return [k.pos.x - Math.sin(k.yaw) * d, k.pos.z - Math.cos(k.yaw) * d];
}

// ------------------------------------------------------------------------------------------------ terminals
describe('Ordnance Terminal', () => {
  it('is placed at runtime near each base, clear of spawns and the Kart-O-Matic, as a solid kiosk', async () => {
    const sim = await makeSim({}, [...vehicleSystems(), ...SYSTEMS()]);
    sim.state.vehicleConfig = { autoTerminals: true };
    run(sim, 2);
    const ks = kiosks(sim);
    expect(ks.map((k) => k.team).sort()).toEqual([Team.Corgis, Team.Cats]);
    const data = sim.worldData;
    for (const k of ks) {
      const own = data.spawns.filter((s) => s.team === k.team);
      const cx = own.reduce((a, s) => a + s.x, 0) / own.length, cz = own.reduce((a, s) => a + s.z, 0) / own.length;
      expect(Math.hypot(k.pos.x - cx, k.pos.z - cz)).toBeLessThan(26);
      for (const s of data.spawns) expect(Math.hypot(k.pos.x - s.x, k.pos.z - s.z)).toBeGreaterThan(2.5);
      for (const o of kartKeepOut(data, k.team)) expect(Math.hypot(k.pos.x - o.x, k.pos.z - o.z)).toBeGreaterThanOrEqual(o.r - 1e-6);
      const kart = findTerminalSite(data, k.team)!;
      expect(Math.hypot(k.pos.x - kart.x, k.pos.z - kart.z)).toBeGreaterThan(TERMINALS.kart_terminal.useRange + ORD.useRange + 1);
      // Wire: EntityKind.Terminal with the ordnance index; the kart terminals stay distinguishable.
      const st = sim.toState(k);
      expect(st.kind).toBe(EntityKind.Terminal);
      expect(st.cls).toBe(terminalIndex('ordnance_terminal'));
      expect(k.collider).not.toBeNull();
    }
    // Solid: a character walking straight at the kiosk stops in front of it.
    const k = kioskOf(sim, Team.Corgis);
    const [sx, sz] = inFront(k, 5);
    const c = spawn(sim, Team.Corgis, sx, sz);
    run(sim, 5);
    for (let i = 0; i < 120; i++) { input(sim, c, { mz: 1, yaw: Math.atan2(-(k.pos.x - c.pos.x), -(k.pos.z - c.pos.z)) }); sim.step(); }
    expect(Math.hypot(c.pos.x - k.pos.x, c.pos.z - k.pos.z)).toBeGreaterThan(0.8);
    sim.dispose();
  });

  it('swaps only within range, for its own team, for the living and unseated', async () => {
    const sim = await makeSim();
    run(sim, 1);
    const k = kioskOf(sim, Team.Corgis);
    const [nx, nz] = inFront(k, 1.8);
    const [fx, fz] = inFront(k, ORD.useRange + 1.2);
    const near = spawn(sim, Team.Corgis, nx, nz), far = spawn(sim, Team.Corgis, fx, fz), cat = spawn(sim, Team.Cats, nx + 0.5, nz);
    run(sim, 5);
    expect(trySwapKit(sim, far, 'breacher')).toBe('out_of_range');
    expect(trySwapKit(sim, cat, 'breacher')).toBe('out_of_range');
    near.flags |= EFlag.Mounted;
    expect(trySwapKit(sim, near, 'breacher')).toBe('out_of_range');
    near.flags &= ~EFlag.Mounted;
    expect(trySwapKit(sim, near, 'breacher')).toBe('swapped');
    kill(sim, far, { id: cat.id, team: Team.Cats, weapon: 0 });
    far.pos.x = nx; far.pos.z = nz;
    expect(trySwapKit(sim, far, 'breacher')).toBe('out_of_range'); // dead
    sim.dispose();
  });

  it('swaps the kit in place: same entity, position and hp fraction; new weapon, ability, speeds; 1 s cooldown', async () => {
    const sim = await makeSim();
    run(sim, 1);
    const k = kioskOf(sim, Team.Corgis);
    const [x, z] = inFront(k, 1.6);
    const c = spawn(sim, Team.Corgis, x, z);
    run(sim, 10);
    c.health!.hp = 60; // 60 / 120 = 50 %
    c.wpn!.ammo = 3;
    const pos = { ...c.pos }, id = c.id;
    expect(trySwapKit(sim, c, 'breacher')).toBe('swapped');
    const ev = sim.drainEvents();
    expect(sim.entities.get(id)).toBe(c);
    expect(c.pos).toEqual(pos);
    expect(c.cls).toBe('breacher');
    expect(c.health!.max).toBe(CLASSES.breacher.maxHp);
    expect(c.health!.hp).toBe(80); // 50 % of 160
    expect(WEAPON_IDS[c.weapon]).toBe('tennis_mortar');
    expect(c.ammo).toBeGreaterThan(3); // fresh magazine
    expect(c.abil!.id).toBe('dig_charge');
    expect(c.char!.move.runSpeed).toBe(5.6);
    expect(ev).toContainEqual(expect.objectContaining({ e: 'ability', id: k.id, ability: 'kit_swap' }));
    expect(ev.some((e) => e.e === 'spawn')).toBe(false); // not a respawn
    expect(sim.toState(c).cls).toBe(3);
    // Cooldown: a second swap within 1 s is refused, then allowed.
    run(sim, 30);
    expect(trySwapKit(sim, c, 'infiltrator')).toBe('cooldown');
    run(sim, 31);
    const frac = c.health!.hp / c.health!.max; // (regen may have topped it up meanwhile)
    expect(trySwapKit(sim, c, 'infiltrator')).toBe('swapped');
    expect(c.health!.hp).toBe(Math.round(frac * CLASSES.infiltrator.maxHp));
    expect(c.char!.move.sprintSpeed).toBe(10.4);
    sim.dispose();
  });
});

// ------------------------------------------------------------------------------------------------ Room rules
describe('Room: class and team choices', () => {
  async function makeRoom() {
    const sim = await makeSim({ cores: false, kibble: false, objectives: false });
    const room = new Room(sim, { mode: 'test', botsPerTeam: [0, 0] });
    const inbox: ServerMsg[] = [];
    const conn: Conn = { id: 'a', send: (m) => inbox.push(m) };
    const slot = room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: 'a', team: 0, cls: 'assault' })!;
    room.tick();
    return { sim, room, slot, inbox, ent: () => sim.entities.get(slot.entity)! };
  }
  const welcomes = (inbox: ServerMsg[]) => inbox.filter((m) => m.t === 'welcome').length;

  it('at the team kiosk: in place (same entity, spot, hp fraction), no welcome, then a 1 s cooldown', async () => {
    const { sim, room, slot, inbox, ent } = await makeRoom();
    const e0 = ent();
    const [x, z] = inFront(kioskOf(sim, Team.Corgis), 1.6);
    sim.placeCharacter(e0, x, 0.02, z);
    for (let i = 0; i < 70; i++) room.tick();
    e0.health!.hp = 90; // 75 %
    const pos = { ...e0.pos }, w0 = welcomes(inbox);
    expect(room.handle('a', { t: 'class', cls: 'warden' })).toBe('ok');
    expect(slot.entity).toBe(e0.id);
    expect(ent().pos).toEqual(pos);
    expect(slot.cls).toBe('warden');
    expect(e0.health!.hp).toBe(Math.round(0.75 * CLASSES.warden.maxHp));
    expect(WEAPON_IDS[e0.weapon]).toBe('sprinkler_cannon');
    expect(welcomes(inbox)).toBe(w0);
    expect(room.handle('a', { t: 'class', cls: 'assault' })).toBe('ignored'); // < 1 s later
    for (let i = 0; i < 61; i++) room.tick();
    expect(room.handle('a', { t: 'class', cls: 'assault' })).toBe('ok');
    expect(slot.cls).toBe('assault');
    room.dispose();
  });

  it('away from a kiosk: no free heal or teleport — the class waits for the next respawn', async () => {
    const { sim, room, slot, ent } = await makeRoom();
    const e0 = ent();
    sim.placeCharacter(e0, 0, 0.02, 30);
    for (let i = 0; i < 70; i++) room.tick();
    e0.health!.hp = 40;
    const pos = { ...e0.pos };
    expect(room.handle('a', { t: 'class', cls: 'breacher' })).toBe('ok');
    expect(slot.entity).toBe(e0.id);
    expect(slot.cls).toBe('assault');
    expect(slot.pendingCls).toBe('breacher');
    expect(e0.health!.hp).toBe(40);
    expect(e0.cls).toBe('assault');
    expect(ent().pos).toEqual(pos);
    // The next respawn (normal 3 s timer) brings the new kit, in place on the respawned entity.
    kill(sim, e0, { id: e0.id, team: Team.Corgis, weapon: -1 });
    for (let i = 0; i < 60; i++) room.tick();
    expect(e0.dead).toBe(true);
    expect(e0.cls).toBe('assault');
    for (let i = 0; i < 150; i++) room.tick();
    expect(e0.dead).toBe(false);
    expect(slot.entity).toBe(e0.id);
    expect(slot.cls).toBe('breacher');
    expect(slot.pendingCls).toBeUndefined();
    expect(e0.cls).toBe('breacher');
    expect(e0.health!.hp).toBe(CLASSES.breacher.maxHp);
    expect(WEAPON_IDS[e0.weapon]).toBe('tennis_mortar');
    room.dispose();
  });

  it('a team switch while alive in the field waits for the next respawn; while dead it rides the respawn timer', async () => {
    const { sim, room, slot, ent } = await makeRoom();
    const e0 = ent();
    sim.placeCharacter(e0, 0, 0.02, 30);
    for (let i = 0; i < 70; i++) room.tick();
    expect(room.handle('a', { t: 'team', team: Team.Cats })).toBe('ok');
    expect(slot.team).toBe(Team.Corgis);
    expect(slot.entity).toBe(e0.id);
    // dies: still a corgi until the respawn timer runs out, then a cat at a cat spawn
    kill(sim, e0, { id: e0.id, team: Team.Corgis, weapon: -1 });
    for (let i = 0; i < 150; i++) room.tick();
    expect(slot.team).toBe(Team.Corgis);
    expect(sim.entities.get(slot.entity)!.dead).toBe(true);
    for (let i = 0; i < 60; i++) room.tick();
    expect(slot.team).toBe(Team.Cats);
    const cat = ent();
    expect(cat.id).not.toBe(e0.id);
    expect(cat.species).toBe(Species.Cat);
    expect(cat.dead).toBe(false);
    expect(sim.worldData.spawns.some((s) => s.team === Team.Cats && Math.hypot(s.x - cat.pos.x, s.z - cat.pos.z) < 1)).toBe(true);
    room.dispose();
  });

  it('at a spawn with full health (the deploy menu) choices apply right away, as before', async () => {
    const { room, slot, ent } = await makeRoom();
    const e0 = ent();
    expect(room.handle('a', { t: 'class', cls: 'overwatch' })).toBe('ok');
    expect(slot.cls).toBe('overwatch');
    expect(slot.entity).not.toBe(e0.id); // respawned (nothing to gain at spawn)
    for (let i = 0; i < 61; i++) room.tick();
    expect(room.handle('a', { t: 'team', team: Team.Cats })).toBe('ok');
    expect(slot.team).toBe(Team.Cats);
    expect(ent().species).toBe(Species.Cat);
    room.dispose();
  });
});

// ------------------------------------------------------------------------------------------------ cores
describe('Upgrade Cores', () => {
  it('light up staggered once the match is live, refill after a pickup with a different core', async () => {
    const sim = await makeSim({ kibble: false, objectives: false, coreFirstSpawn: 2, coreStagger: 1, coreRespawn: 3 });
    sim.state.match = { mode: 'x', phase: 'warmup', timeLeft: 5, score: [0, 0], objective: '', wave: 0, winner: -1 } satisfies MatchState;
    run(sim, 300);
    const c0 = spot(sim, 'c0'), c1 = spot(sim, 'c1');
    expect(c0.pickup!.available || c1.pickup!.available).toBe(false); // warmup: dark
    expect(sim.toState(c0).flags & EFlag.Busy).toBeTruthy();
    (sim.state.match as MatchState).phase = 'live';
    run(sim, 60);
    expect(sim.toState(c0).ammo).toBe(1); // 1 s left (2 s after live)
    run(sim, 62);
    expect(c0.pickup!.available).toBe(true);
    expect(c1.pickup!.available).toBe(false);
    run(sim, 60);
    expect(c1.pickup!.available).toBe(true);
    expect(c0.pickup!.id).not.toBe(c1.pickup!.id); // first cores are dealt, not rolled
    const first = c0.pickup!.id;
    expect(sim.toState(c0).cls).toBe(PICKUP_IDS.indexOf(first));
    const dog = spawn(sim, Team.Corgis, 1, 7);
    run(sim, 5);
    const ev = walkTo(sim, dog, 1, 1);
    expect(ev).toContainEqual({ e: 'pickup', id: dog.id, item: first });
    expect(dog.buffs!.map((b) => b.id)).toEqual([first]);
    expect(c0.pickup!.available).toBe(false);
    expect(c0.pickup!.id).not.toBe(first); // next core already known (ghost)
    expect(sim.toState(c0).ammo).toBe(3);
    input(sim, dog, { mz: 1, yaw: 0 });
    run(sim, 40); input(sim, dog); run(sim, 150);
    expect(c0.pickup!.available).toBe(true);
    sim.dispose();
  });

  it('buffs change stats through existing fields and restore them exactly on expiry', async () => {
    const sim = await makeSim({ kibble: false, objectives: false, cores: false });
    const dog = spawn(sim, Team.Corgis, 0, 30);
    run(sim, 5);
    const move0 = { ...dog.char!.move }, max0 = dog.health!.max;
    grantBuff(sim, dog, 'zoomies_plus');
    expect(dog.char!.move.runSpeed).toBeCloseTo(move0.runSpeed * 1.15, 10);
    expect(dog.char!.move.sprintSpeed).toBeCloseTo(move0.sprintSpeed * 1.15, 10);
    dog.health!.hp = 100;
    grantBuff(sim, dog, 'thick_fur');
    expect(dog.health!.max).toBe(max0 + 36);
    expect(dog.health!.hp).toBe(136); // the bonus arrives as a shield
    // Zoomies+ ends first (20 s), Thick Fur later (25 s): each restores its own fields bit-exactly.
    run(sim, 20 * 60 + 1);
    expect(dog.char!.move).toEqual(move0);
    expect(dog.health!.max).toBe(max0 + 36);
    run(sim, 5 * 60);
    expect(dog.health!.max).toBe(max0);
    expect(dog.health!.hp).toBeLessThanOrEqual(max0);
    expect(dog.buffs).toEqual([]);
    // Moving faster is real: 1 s of running covers ~15 % more ground with Zoomies+.
    const runFor = () => { const x0 = dog.pos.x; for (let i = 0; i < 60; i++) { input(sim, dog, { mz: 1, yaw: -Math.PI / 2 }); sim.step(); } const d = dog.pos.x - x0; input(sim, dog); run(sim, 30); return d; };
    const plain = runFor();
    grantBuff(sim, dog, 'zoomies_plus');
    const fast = runFor();
    expect(fast / plain).toBeGreaterThan(1.12);
    expect(fast / plain).toBeLessThan(1.18);
    sim.dispose();
  });

  it('Overclock fires 20 % faster; Squeaky Clean halves the ability cooldown', async () => {
    const sim = await makeSim({ kibble: false, objectives: false, cores: false });
    const dog = spawn(sim, Team.Corgis, 0, 30);
    run(sim, 5);
    const shots = () => {
      dog.wpn!.ammo = 999; dog.wpn!.cooldown = 0;
      const ev = run(sim, 120, () => input(sim, dog, { buttons: Btn.Fire, yaw: Math.PI / 2, pitch: 0.2 }));
      input(sim, dog); run(sim, 30);
      return ev.filter((e) => e.e === 'fire' && e.id === dog.id).length;
    };
    const base = shots();
    grantBuff(sim, dog, 'overclock');
    const fast = shots();
    expect(base).toBe(20); // 10 rps
    expect(fast).toBe(24); // 12 rps
    clearBuffs(dog);
    // Ability: bark blast cooldown 8 s → 4 s.
    const barks = (n: number) => {
      const t: number[] = [];
      for (let i = 0; i < n; i++) {
        input(sim, dog, { buttons: sim.tick % 2 ? Btn.Ability : 0 });
        sim.step();
        for (const e of sim.drainEvents()) if (e.e === 'ability' && e.ability === 'bark_blast' && e.id === dog.id) t.push(sim.tick);
      }
      return t;
    };
    run(sim, 9 * 60);
    const plain = barks(9 * 60);
    expect(plain.length).toBe(2);
    expect((plain[1] - plain[0]) / 60).toBeCloseTo(8, 1);
    run(sim, 9 * 60);
    grantBuff(sim, dog, 'squeaky_clean');
    const quick = barks(9 * 60);
    expect(quick.length).toBeGreaterThanOrEqual(3);
    expect((quick[1] - quick[0]) / 60).toBeCloseTo(4, 1);
    sim.dispose();
  });

  it('buffs end on death and when the match ends; a repeat pickup refreshes; kit swaps keep them', async () => {
    const sim = await makeSim({ kibble: false, objectives: false, cores: false });
    sim.state.match = { mode: 'x', phase: 'live', timeLeft: 0, score: [0, 0], objective: '', wave: 1, winner: -1 } satisfies MatchState;
    run(sim, 1);
    const k = kioskOf(sim, Team.Corgis);
    const [x, z] = inFront(k, 1.6);
    const dog = spawn(sim, Team.Corgis, x, z);
    run(sim, 5);
    grantBuff(sim, dog, 'thick_fur');
    const until = dog.buffs![0].until;
    run(sim, 60);
    grantBuff(sim, dog, 'thick_fur');
    expect(dog.buffs!.length).toBe(1);
    expect(dog.buffs![0].until).toBeGreaterThan(until);
    // Kit swap under Thick Fur: the bonus follows the new base max.
    expect(trySwapKit(sim, dog, 'breacher')).toBe('swapped');
    expect(dog.health!.max).toBe(160 + 48);
    expect(dog.health!.hp).toBe(208);
    // Match end clears it, stats back to the kit's own.
    (sim.state.match as MatchState).phase = 'ended';
    run(sim, 1);
    expect(dog.buffs).toEqual([]);
    expect(dog.health!.max).toBe(160);
    // Death clears too.
    (sim.state.match as MatchState).phase = 'live';
    grantBuff(sim, dog, 'zoomies_plus');
    kill(sim, dog, { id: dog.id, team: Team.Corgis, weapon: -1 });
    run(sim, 1);
    expect(dog.buffs).toEqual([]);
    expect(dog.char!.move.runSpeed).toBe(CLASSES.breacher.move.runSpeed);
    sim.dispose();
  });
});

// ------------------------------------------------------------------------------------------------ kibble
describe('Golden Kibble', () => {
  it('walking over it: pickup event, +25 roster score through the Room, gone for everyone, back after 60 s', async () => {
    const sim = await makeSim({ cores: false, objectives: false });
    const room = new Room(sim, { mode: 'test', botsPerTeam: [0, 0] });
    const conn: Conn = { id: 'a', send: () => {} };
    const slot = room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: 'a', team: 0, cls: 'assault' })!;
    room.tick();
    const dog = sim.entities.get(slot.entity)!;
    sim.placeCharacter(dog, 1, 0.02, 17);
    let seqN = 1;
    const k0 = spot(sim, 'k0');
    expect(sim.toState(k0).cls).toBe(PICKUP_IDS.indexOf('golden_kibble'));
    for (let i = 0; i < 90; i++) {
      room.handle('a', { t: 'input', cmds: [{ seq: seqN++, mx: 0, mz: dog.pos.z > 13.2 ? 1 : 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }] });
      room.tick();
    }
    expect(k0.pickup!.available).toBe(false);
    expect(sim.toState(k0).flags & EFlag.Busy).toBeTruthy();
    expect(slot.score).toBe(PICKUPS.golden_kibble.score);
    expect(sim.toState(k0).ammo).toBeGreaterThan(55);
    // Standing on the spot does nothing while it is gone; it comes back for everyone after 60 s.
    for (let i = 0; i < 60 * 30; i++) room.tick();
    expect(k0.pickup!.available).toBe(false);
    sim.placeCharacter(dog, 1, 0.02, 21);
    for (let i = 0; i < 60 * 31; i++) room.tick();
    expect(k0.pickup!.available).toBe(true);
    expect(slot.score).toBe(PICKUPS.golden_kibble.score);
    for (let i = 0; i < 150; i++) {
      room.handle('a', { t: 'input', cmds: [{ seq: seqN++, mx: 0, mz: dog.pos.z > 13.2 ? 1 : 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }] });
      room.tick();
    }
    expect(slot.score).toBe(2 * PICKUPS.golden_kibble.score);
    room.dispose();
  });

  it('is authority-only: no remote grab by Interact, messages or corpses; PvE cats cannot take it', async () => {
    const sim = await makeSim({ cores: false, objectives: false });
    const room = new Room(sim, { mode: 'test', botsPerTeam: [0, 0] });
    const conn: Conn = { id: 'a', send: () => {} };
    const slot = room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: 'a', team: 0, cls: 'assault' })!;
    room.tick();
    const dog = sim.entities.get(slot.entity)!;
    sim.placeCharacter(dog, 1, 0.02, 16); // 3 m from k0
    let n = 1;
    for (let i = 0; i < 120; i++) {
      room.handle('a', { t: 'input', cmds: [{ seq: n++, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: i % 2 ? Btn.Interact : 0, rt: 0 }] });
      room.tick();
    }
    const k0 = spot(sim, 'k0');
    expect(k0.pickup!.available).toBe(true);
    // No message can ask for a pickup: unknown message types are refused by the guard and the Room.
    expect(validateClientMsg({ t: 'pickup', id: k0.id }).ok).toBe(false);
    expect(room.handle('a', { t: 'pickup', id: k0.id } as never)).toBe('abuse');
    // A corpse slid onto the kibble does not collect it.
    kill(sim, dog, { id: dog.id, team: Team.Corgis, weapon: -1 });
    sim.placeCharacter(dog, 1, 0.02, 13);
    room.tick();
    expect(k0.pickup!.available).toBe(true);
    // A PvE wave cat walking through does not collect it.
    const cat = spawn(sim, Team.Cats, -11, 17);
    cat.combat = { invulnUntil: 0, stealthUntil: 0, pve: true, removeTick: 0, diedTick: -9999, corpseSettled: false };
    walkTo(sim, cat, -11, 13);
    expect(touchesPickup(cat, -11, 0.55, 13, PICKUPS.golden_kibble.radius)).toBe(true);
    expect(spot(sim, 'k1').pickup!.available).toBe(true);
    expect(slot.score).toBe(0);
    room.dispose();
  });
});

// ------------------------------------------------------------------------------------------------ objectives
describe('Objective chain', () => {
  it('completes its 3 steps in order: interact, contested hold, interact → rewards, barks, points', async () => {
    const sim = await makeSim({ cores: false, kibble: false });
    run(sim, 1);
    const st = () => objectiveState(sim)!;
    expect(st().step).toBe(0);
    expect(st().text).toBe('Grab it (1/3)');
    const dog = spawn(sim, Team.Corgis, 20, -20.5);
    run(sim, 5);
    // Barking at step 3's target first does nothing (order matters).
    let ev = run(sim, 4, () => input(sim, dog, { buttons: sim.tick % 2 ? Btn.Interact : 0 }));
    expect(st().step).toBe(0);
    expect(ev.some((e) => e.e === 'bark')).toBe(false);
    // Step 1: interact at the squeaker.
    ev = walkTo(sim, dog, 20, 19);
    ev.push(...run(sim, 2, () => input(sim, dog, { buttons: sim.tick % 2 ? Btn.Interact : 0 })));
    expect(st().step).toBe(1);
    expect(ev).toContainEqual({ e: 'pickup', id: dog.id, item: 'squeaker' });
    expect(ev).toContainEqual({ e: 'bark', id: dog.id, line: 'Got it!' });
    expect(ev).toContainEqual({ e: 'score', team: Team.Corgis, pts: 5, reason: 'objective' });
    const beacon = [...sim.entities.values()].find((e) => e.beacon)!;
    expect(sim.toState(beacon).weapon).toBe(1);
    expect(sim.toState(beacon).kind).toBe(EntityKind.Prop);
    // Step 2: hold. Progress while alone, paused while a cat contests, drains when empty.
    walkTo(sim, dog, -20, 20);
    const p0 = st().progress;
    run(sim, 30);
    expect(st().progress).toBeGreaterThan(p0 + 0.2);
    const cat = spawn(sim, Team.Cats, -18, 20);
    run(sim, 2);
    const p1 = st().progress;
    run(sim, 30);
    expect(st().contested).toBe(true);
    expect(st().progress).toBeCloseTo(p1, 6);
    expect(st().text).toContain('CONTESTED');
    expect(sim.toState(beacon).flags & EFlag.Busy).toBeTruthy();
    sim.removeEntity(cat.id);
    sim.placeCharacter(dog, -20, 0.02, 30);
    run(sim, 60);
    expect(st().progress).toBeLessThan(p1); // nobody holding: it drains
    expect(st().progress).toBeGreaterThan(0);
    sim.placeCharacter(dog, -20, 0.02, 20);
    ev = run(sim, 150);
    expect(st().step).toBe(2);
    expect(ev).toContainEqual({ e: 'bark', id: dog.id, line: 'Held!' });
    // Step 3: bark at the target → chain done.
    walkTo(sim, dog, 20, -19);
    ev = run(sim, 2, () => input(sim, dog, { buttons: sim.tick % 2 ? Btn.Interact : 0 }));
    expect(st().step).toBe(3);
    expect(st().text).toBe('Done!');
    expect(ev).toContainEqual({ e: 'score', team: Team.Corgis, pts: 25, reason: 'objective' });
    expect(st().score).toEqual([35, 0]);
    expect(takeObjectiveScore(sim)).toEqual([35, 0]);
    expect(takeObjectiveScore(sim)).toEqual([0, 0]);
    expect(foldObjectiveText('Wave 2/5', st())).toBe('Wave 2/5 · ▶ Done!');
    run(sim, 3 * 60);
    expect(st().text).toBe('');
    expect(foldObjectiveText('Wave 2/5', st())).toBe('Wave 2/5');
    sim.dispose();
  });

  it('resets on match restart (the real match system: wave cleared → ended → restart)', async () => {
    const sim = await makeSim({ cores: false, kibble: false }, [...SYSTEMS(), ...matchSystems()]);
    sim.state.room = { mode: 'yard-skirmish' };
    sim.state.matchConfig = { skirmish: { warmup: 0.2, endedHold: 0.5, intermission: 0.2, waves: [{ counts: { grunt: 1 } }] } };
    const dog = spawn(sim, Team.Corgis, 20, 19);
    run(sim, 30);
    const st = () => objectiveState(sim)!;
    const ms = () => sim.state.match as MatchState;
    expect(ms().phase).toBe('live');
    run(sim, 2, () => input(sim, dog, { buttons: sim.tick % 2 ? Btn.Interact : 0 }));
    expect(st().step).toBe(1);
    // Clear the wave (kill its grunt) → Corgis win → ended: the chain freezes and hides.
    const grunt = [...sim.entities.values()].find((e) => e.char && e.team === Team.Cats)!;
    kill(sim, grunt, { id: dog.id, team: Team.Corgis, weapon: 0 });
    run(sim, 3);
    expect(ms().phase).toBe('ended');
    expect(st().text).toBe('');
    // Restart → warmup: fresh chain, no step until live again, then step 1 anew.
    run(sim, 40);
    expect(ms().phase).not.toBe('ended');
    expect(st().step).toBeLessThanOrEqual(0);
    run(sim, 30);
    expect(ms().phase).toBe('live');
    expect(st().step).toBe(0);
    expect(st().score).toEqual([0, 0]);
    sim.dispose();
  });
});

describe('content tables', () => {
  it('cores are soft, timed and match-scoped; kibble is worth 25', () => {
    for (const id of CORE_IDS) {
      const d = PICKUPS[id];
      expect(d.kind).toBe('core');
      expect(d.duration).toBeGreaterThanOrEqual(15);
      expect(d.duration).toBeLessThanOrEqual(30);
      for (const v of Object.values(d.buff)) expect(Math.abs(Math.log(v as number))).toBeLessThanOrEqual(Math.log(2) + 1e-9);
    }
    expect(PICKUPS.golden_kibble.score).toBe(25);
    expect(PICKUP_IDS.length).toBeLessThanOrEqual(6); // carried in EntityState.cls through CLASS_IDS (see handoff)
  });
});
