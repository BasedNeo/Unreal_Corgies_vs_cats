// W9 X4: throwable ordnance on the authority. Carry (spawn with one, lose it on death, a fresh one on respawn), the
// throw (hold to aim, release throws, a tap throws; launch from the sim's own state only), every refusal (empty,
// cooldown, dead, in a vehicle, stunned, taunting, not live), the kiosk restock rules (own kiosk only, the cooldown from
// the throw, never more than one: no fountain), the fuse and blast (2.2 s, the shared blast, no one-shots), bouncing
// off an enemy without damage, a match restart with one in flight, and determinism per seed.
import { describe, it, expect } from 'vitest';
import { Sim, type SimSystem } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Btn, sanitizeInput } from '../../src/shared/input';
import { EFlag, EntityKind, Species, Team, CLASS_IDS, type ClassId, type TeamId } from '../../src/shared/types';
import type { GameEvent, MatchState } from '../../src/shared/protocol';
import type { WorldData } from '../../src/shared/world/world-data';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { emoteSystem } from '../../src/sim/systems/emote';
import { combatSystems, explode, kill, liveOrdnance, ordnanceBlastOf, ordnanceStats, tryThrow } from '../../src/sim/combat';
import { matchSystems } from '../../src/sim/match';
import { interactSystems, ordnanceTerminalFor, type InteractConfig } from '../../src/sim/interact';
import { ownKioskFor } from '../../src/sim/interact/ordnance-kiosk';
import { FUSE_TICKS, ORDNANCE, ORDNANCE_BLAST, ORDNANCE_RULES, makeLaunch, ordnanceByWire, ordnanceFor, throwLaunch } from '../../src/shared/content/ordnance';
import { CLASSES } from '../../src/shared/content/classes';
import { TERMINALS } from '../../src/shared/content/terminals';
import { PROTOCOL_VERSION, TICK_HZ } from '../../src/shared/constants';
import { Room, type Conn } from '../../src/host/room';
import { validateClientMsg } from '../../src/host/guard';
import type { ServerMsg } from '../../src/shared/protocol';

// ------------------------------------------------------------------------------------------------ fixtures
function yard(): WorldData {
  const n = 81, cell = 2;
  return {
    seed: 1, name: 'ordnance test yard', height: () => 0, halfExtent: 80, killY: -30,
    terrain: { x0: -80, z0: -80, cell, n, heights: new Float32Array(n * n) },
    props: [],
    spawns: [
      { x: -40, y: 0, z: 40, yaw: 0, team: Team.Corgis }, { x: -34, y: 0, z: 42, yaw: 0, team: Team.Corgis },
      { x: 40, y: 0, z: -40, yaw: Math.PI, team: Team.Cats }, { x: 34, y: 0, z: -42, yaw: Math.PI, team: Team.Cats },
    ],
    bounds: { minX: -78, maxX: 78, minZ: -78, maxZ: 78 },
  };
}

const INTERACT: InteractConfig = { auto: true, cores: false, kibble: false, objectives: false, layout: { cores: [], kibble: [] } };

async function makeSim(o: { mode?: string; seed?: number; match?: boolean; tdm?: Record<string, number> } = {}): Promise<Sim> {
  const systems: SimSystem[] = [...interactSystems(), movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems(), emoteSystem, ...(o.match ? matchSystems() : [])];
  const sim = await Sim.create({ seed: o.seed ?? 5, world: yard(), systems });
  sim.state.interactConfig = INTERACT;
  sim.state.room = { mode: o.mode ?? 'team-deathmatch' };
  if (o.tdm) sim.state.matchConfig = { tdm: o.tdm };
  return sim;
}

function spawn(sim: Sim, team: TeamId, x: number, z: number, cls: ClassId = 'assault', kind: number = EntityKind.Player): SimEntity {
  return sim.spawnCharacter({ kind: kind as 0, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `t${sim.entities.size}`, x, y: 0.02, z, ownerPid: kind === EntityKind.Player ? `p${sim.entities.size}` : null });
}

let seq = 1;
function hold(sim: Sim, e: SimEntity, buttons: number, yaw = e.yaw, pitch = e.pitch): void {
  sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw, pitch, buttons, rt: 0 });
}
function steps(sim: Sim, n: number, into?: GameEvent[]): void {
  for (let i = 0; i < n; i++) { sim.step(); const ev = sim.drainEvents(); if (into) into.push(...ev); sim.removedIds.length = 0; }
}
/** Press Throw for a tick, then release: returns the thrown entity (or null). */
function throwNow(sim: Sim, e: SimEntity, yaw = e.yaw, pitch = e.pitch, into?: GameEvent[]): SimEntity | null {
  const before = ordnanceStats(sim).throws;
  hold(sim, e, Btn.Throw, yaw, pitch); steps(sim, 1, into);
  hold(sim, e, 0, yaw, pitch); steps(sim, 1, into);
  if (ordnanceStats(sim).throws === before) return null;
  let g: SimEntity | null = null;
  for (const o of liveOrdnance(sim)) if (o.ordProj!.owner === e.id && (!g || o.id > g.id)) g = o;
  return g;
}
const kiosks = (sim: Sim) => [...sim.entities.values()].filter((t) => t.ordnance);
const kioskOf = (sim: Sim, team: TeamId) => kiosks(sim).find((t) => t.team === team)!;
/** Stand next to a kiosk (1.9 m out along +x of its screen, clear of its collider). */
function standAt(sim: Sim, e: SimEntity, k: SimEntity): void {
  const dx = Math.cos(k.yaw) * 1.9, dz = -Math.sin(k.yaw) * 1.9;
  sim.placeCharacter(e, k.pos.x + dx, k.pos.y + 0.02, k.pos.z + dz);
}

// ------------------------------------------------------------------------------------------------ carry
describe('X4 ordnance: carry', () => {
  it('every player and room bot spawns with one (EFlag.Ordnance); wave cats and chapter/adventure sims get none', async () => {
    const sim = await makeSim();
    const dog = spawn(sim, Team.Corgis, 0, 0);
    const bot = spawn(sim, Team.Cats, 5, 0, 'assault', EntityKind.Bot);
    const wave = spawn(sim, Team.Cats, 8, 0, 'assault', EntityKind.Bot);
    steps(sim, 1);
    wave.combat!.pve = true; // a match's wave cat
    steps(sim, 1);
    expect(dog.flags & EFlag.Ordnance).toBeTruthy();
    expect(dog.ordCarry?.carry).toBe(true);
    expect(bot.flags & EFlag.Ordnance).toBeTruthy();
    expect(wave.flags & EFlag.Ordnance).toBe(0);
    expect(wave.ordCarry).toBeUndefined();
    // adventure (tuned chapters) and bare sims of other lanes: off
    for (const mode of ['adventure', undefined]) {
      const s2 = await makeSim({ mode });
      if (mode === undefined) delete s2.state.room;
      const p = spawn(s2, Team.Corgis, 0, 0);
      steps(s2, 3);
      expect(p.flags & EFlag.Ordnance).toBe(0);
      expect(throwNow(s2, p)).toBeNull();
    }
  });

  it('dying loses it, respawning brings a fresh one (and the flag follows)', async () => {
    const sim = await makeSim();
    const dog = spawn(sim, Team.Corgis, 0, 0);
    const cat = spawn(sim, Team.Cats, 10, 0);
    steps(sim, 2);
    expect(throwNow(sim, dog)).not.toBeNull(); // spent
    steps(sim, 1);
    expect(dog.flags & EFlag.Ordnance).toBe(0);
    kill(sim, dog, { id: cat.id, team: cat.team, weapon: 0 });
    steps(sim, 1);
    expect(dog.ordCarry!.carry).toBe(false);
    expect(dog.flags & EFlag.Ordnance).toBe(0);
    steps(sim, TICK_HZ * 3 + 2); // the respawn delay
    expect(dog.dead).toBe(false);
    expect(dog.ordCarry!.carry).toBe(true);
    expect(dog.flags & EFlag.Ordnance).toBeTruthy();
    // a death while still carrying: the flag clears with the corpse, no free extra on respawn (still just one)
    kill(sim, cat, { id: dog.id, team: dog.team, weapon: 0 });
    steps(sim, 1);
    expect(cat.flags & EFlag.Ordnance).toBe(0);
    steps(sim, TICK_HZ * 3 + 2);
    expect(cat.ordCarry!.carry).toBe(true);
    expect(throwNow(sim, cat)).not.toBeNull();
    expect(throwNow(sim, cat)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ throw
describe('X4 ordnance: the throw', () => {
  it('hold to aim, release throws; a one-tick tap throws too; nothing without one', async () => {
    const sim = await makeSim();
    const dog = spawn(sim, Team.Corgis, 0, 0);
    steps(sim, 2);
    hold(sim, dog, Btn.Throw, 0.4, 0.2);
    steps(sim, 90); // aiming for 1.5 s: nothing leaves the paw
    expect(liveOrdnance(sim).length).toBe(0);
    expect(dog.ordCarry!.armed).toBe(true);
    hold(sim, dog, 0, 0.4, 0.2);
    steps(sim, 1);
    expect(liveOrdnance(sim).length).toBe(1);
    expect(dog.ordCarry!.carry).toBe(false);
    // no second one: another tap does nothing, a direct call says why
    expect(throwNow(sim, dog)).toBeNull();
    expect(tryThrow(sim, dog)).toBe('empty');
    const cat = spawn(sim, Team.Cats, 20, 0);
    steps(sim, 2);
    expect(throwNow(sim, cat)).not.toBeNull(); // the tap
  });

  it('a press held across a death does not throw the respawn one on release (the press is dropped with the life)', async () => {
    const sim = await makeSim();
    const dog = spawn(sim, Team.Corgis, 0, 0), cat = spawn(sim, Team.Cats, 30, 0);
    steps(sim, 2);
    hold(sim, dog, Btn.Throw); steps(sim, 5);
    expect(dog.ordCarry!.armed).toBe(true);
    kill(sim, dog, { id: cat.id, team: cat.team, weapon: 0 });
    steps(sim, TICK_HZ * 3 + 2); // still holding G through the respawn
    expect(dog.dead).toBe(false);
    expect(dog.ordCarry!.carry).toBe(true);
    hold(sim, dog, 0); steps(sim, 2);
    expect(liveOrdnance(sim).length).toBe(0);
    expect(dog.ordCarry!.carry).toBe(true);
    expect(throwNow(sim, dog)).not.toBeNull(); // a fresh press throws
  });

  it('through the Room (the real authority path): a guarded input message throws, the snapshot carries it, a hostile one cannot', async () => {
    const sim = await makeSim();
    const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [0, 0] });
    const inbox: ServerMsg[] = [];
    const conn: Conn = { id: 'a', send: (m) => inbox.push(m) };
    const slot = room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: 'a', team: 0, cls: 'assault' })!;
    for (let i = 0; i < 70; i++) room.tick();
    const me = sim.entities.get(slot.entity)!;
    expect(me.flags & EFlag.Ordnance).toBeTruthy();
    let s = 1000;
    const send = (buttons: number, extra: Record<string, unknown> = {}) => {
      const v = validateClientMsg({ t: 'input', cmds: [{ seq: s++, mx: 0, mz: 0, yaw: 0.2, pitch: 0.3, buttons, rt: 0, ...extra }] });
      expect(v.ok).toBe(true);
      expect(room.handle('a', (v as { msg: Parameters<Room['handle']>[1] }).msg)).toBe('ok');
      room.tick();
    };
    // a hostile client adds a launch vector and bogus button bits: stripped, the throw is still the sim's own
    send(Btn.Throw | (1 << 25), { vx: 500, vy: 500, launch: [0, 99, 0] });
    send(0);
    for (let i = 0; i < 4; i++) room.tick();
    const g = liveOrdnance(sim)[0];
    expect(g).toBeDefined();
    expect(Math.hypot(g.vel.x, g.vel.y, g.vel.z)).toBeLessThan(ORDNANCE.squeaker_grenade.projectile.speed + 3);
    expect(me.flags & EFlag.Ordnance).toBe(0);
    const snaps = inbox.filter((m) => m.t === 'snap') as Extract<ServerMsg, { t: 'snap' }>[];
    const last = snaps[snaps.length - 1];
    const packed = last.ents.find((a) => a[0] === g.id);
    expect(packed).toBeDefined(); // it rides the normal snapshot (no protocol change)
    // spamming the button does not make a second one
    for (let i = 0; i < 20; i++) send(i % 2 ? Btn.Throw : 0);
    expect(ordnanceStats(sim).throws).toBe(1);
    room.dispose();
  });

  it('Room catch-up (movement-only replays after a stall) cannot swallow the press or the release', async () => {
    for (const lost of ['press', 'release'] as const) {
      const sim = await makeSim();
      const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [0, 0] });
      const conn: Conn = { id: 'a', send: () => {} };
      const slot = room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: 'a', team: 0, cls: 'assault' })!;
      let s = 1;
      const cmd = (buttons: number) => ({ seq: s++, mx: 0, mz: 0, yaw: 0.2, pitch: 0.3, buttons, rt: 0 });
      const send = (...cmds: ReturnType<typeof cmd>[]) => room.handle('a', { t: 'input', cmds });
      for (let i = 0; i < 70; i++) { send(cmd(0)); room.tick(); }
      if (lost === 'release') { send(cmd(Btn.Throw)); room.tick(); } // the press reaches its own tick
      for (let i = 0; i < 8; i++) room.tick(); // a stall: the player is frozen, owed ticks pile up
      // the late batch: the edge we lose sits inside the catch-up replays (movement only, prevButtons rewritten)
      if (lost === 'press') send(cmd(Btn.Throw), cmd(Btn.Throw), cmd(Btn.Throw), cmd(Btn.Throw), cmd(Btn.Throw), cmd(0), cmd(0));
      else send(cmd(Btn.Throw), cmd(0), cmd(0), cmd(0), cmd(0), cmd(0));
      for (let i = 0; i < 10; i++) { send(cmd(0)); room.tick(); }
      expect(sim.entities.get(slot.entity)!.ordCarry!.thrown).toBe(1);
      expect(ordnanceStats(sim).throws).toBe(1);
      room.dispose();
    }
  });

  it('the launch comes from the sim state only (feet, yaw, pitch): extra input fields are stripped, the hand is the shared one', async () => {
    const sim = await makeSim();
    const dog = spawn(sim, Team.Corgis, 3, -2);
    steps(sim, 2);
    const raw = sanitizeInput({ seq: seq++, mx: 0, mz: 0, yaw: 1.1, pitch: 0.3, buttons: Btn.Throw, rt: 0, vx: 999, vy: 999, x: -50, launch: [1, 2, 3] });
    expect(Object.keys(raw!).sort()).toEqual(['buttons', 'mx', 'mz', 'pitch', 'rt', 'seq', 'yaw']);
    sim.setInput(dog.id, raw!); steps(sim, 1);
    hold(sim, dog, 0, 1.1, 0.3); sim.step();
    const g = liveOrdnance(sim)[0];
    const L = throwLaunch(dog.pos.x, dog.pos.y, dog.pos.z, dog.yaw, dog.pitch, Species.Corgi, makeLaunch());
    expect(g.pos).toEqual({ x: L.x, y: L.y, z: L.z }); // it leaves the hand next tick
    expect(g.vel).toEqual({ x: L.vx, y: L.vy, z: L.vz });
    const s = sim.toState(g);
    expect(s.kind).toBe(EntityKind.Projectile);
    expect(ordnanceByWire(s.weapon)?.id).toBe('squeaker_grenade');
    expect(s.seed).toBe(dog.id);
    expect(s.ammo).toBe(FUSE_TICKS);
    expect(s.cls).toBe(-1);
    sim.drainEvents();
  });

  it('refuses: the cooldown, dead, in a vehicle, stunned, taunting, and outside live play', async () => {
    const sim = await makeSim();
    const dog = spawn(sim, Team.Corgis, 0, 0);
    const cat = spawn(sim, Team.Cats, 30, 0);
    steps(sim, 2);
    expect(tryThrow(sim, dog)).toBe('thrown');
    // (white-box) hand it another one at once: the throw cooldown still holds it for 0.8 s
    dog.ordCarry!.carry = true;
    expect(tryThrow(sim, dog)).toBe('cooldown');
    steps(sim, Math.round(ORDNANCE_RULES.throwCooldown * TICK_HZ) - 1);
    expect(tryThrow(sim, dog)).toBe('cooldown');
    steps(sim, 1);
    dog.ordCarry!.carry = true;
    // in a vehicle / stunned: refused, and the input path throws nothing either
    dog.flags |= EFlag.Mounted;
    expect(tryThrow(sim, dog)).toBe('vehicle');
    const n = liveOrdnance(sim).length;
    expect(throwNow(sim, dog)).toBeNull();
    dog.flags = (dog.flags & ~EFlag.Mounted) | EFlag.Stunned;
    expect(tryThrow(sim, dog)).toBe('stunned');
    dog.flags &= ~EFlag.Stunned;
    // taunting (Btn.Emote): the paws are busy for emoteLock
    hold(sim, dog, Btn.Emote); steps(sim, 1); hold(sim, dog, 0); steps(sim, 1);
    expect(dog.data.tauntTick).toBeDefined();
    expect(tryThrow(sim, dog)).toBe('emote');
    expect(throwNow(sim, dog)).toBeNull();
    steps(sim, Math.round(ORDNANCE_RULES.emoteLock * TICK_HZ));
    expect(liveOrdnance(sim).length).toBe(n);
    // outside live play (warmup / match over)
    sim.state.rules = { combatLive: false, respawn: [true, true, true] };
    expect(tryThrow(sim, dog)).toBe('not_live');
    delete sim.state.rules;
    // dead (before the life system clears the carry, the same tick): 'dead'; after: 'empty'
    kill(sim, dog, { id: cat.id, team: cat.team, weapon: 0 });
    expect(tryThrow(sim, dog)).toBe('dead');
    steps(sim, 1);
    expect(tryThrow(sim, dog)).toBe('empty');
    expect(throwNow(sim, dog)).toBeNull();
    expect(tryThrow(sim, cat)).toBe('thrown');
  });

  it('throwing ends spawn protection and breaks the Infiltrator cloak, like a shot', async () => {
    const sim = await makeSim();
    const sneak = spawn(sim, Team.Corgis, 0, 0, 'infiltrator');
    steps(sim, 2);
    sneak.combat!.invulnUntil = sim.tick + 600;
    sneak.combat!.stealthUntil = sim.tick + 600;
    expect(tryThrow(sim, sneak)).toBe('thrown');
    expect(sneak.combat!.invulnUntil).toBe(0);
    expect(sneak.combat!.stealthUntil).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ kiosk
describe('X4 ordnance: kiosk restock', () => {
  it("restocks only at your own team's kiosk, only restockCooldown after the throw, one at a time (no fountain)", async () => {
    const sim = await makeSim();
    const dog = spawn(sim, Team.Corgis, -30, 30);
    steps(sim, 2);
    expect(kiosks(sim).length).toBe(2);
    const own = kioskOf(sim, Team.Corgis), theirs = kioskOf(sim, Team.Cats);
    const events: GameEvent[] = [];
    standAt(sim, dog, own);
    steps(sim, 2, events);
    expect(events.filter((e) => e.e === 'pickup')).toEqual([]); // carrying already: nothing
    expect(throwNow(sim, dog, dog.yaw, 0.6, events)).not.toBeNull();
    const cd = Math.round(ORDNANCE_RULES.restockCooldown * TICK_HZ);
    steps(sim, cd - 10, events); // standing at the kiosk the whole time
    expect(dog.ordCarry!.carry).toBe(false);
    expect(dog.flags & EFlag.Ordnance).toBe(0);
    steps(sim, 12, events);
    expect(dog.ordCarry!.carry).toBe(true);
    expect(dog.flags & EFlag.Ordnance).toBeTruthy();
    const picks = events.filter((e) => e.e === 'pickup');
    expect(picks).toEqual([{ e: 'pickup', id: dog.id, item: 'squeaker_grenade' }]);
    // staying at the kiosk never stacks a second one
    steps(sim, cd * 2, events);
    expect(events.filter((e) => e.e === 'pickup').length).toBe(1);
    // the enemy kiosk and open ground never restock
    for (const at of ['enemy', 'field'] as const) {
      expect(throwNow(sim, dog, dog.yaw, 0.6)).not.toBeNull();
      if (at === 'enemy') standAt(sim, dog, theirs); else sim.placeCharacter(dog, 0, 0.02, 0);
      steps(sim, cd + 30);
      expect(dog.ordCarry!.carry).toBe(false);
      dog.ordCarry!.carry = true; dog.ordCarry!.nextThrow = 0; // (hand one back for the next leg)
    }
    // the fountain rate: over 2 minutes at the kiosk, one throw per restockCooldown at most
    dog.ordCarry!.carry = false; dog.ordCarry!.restockAt = sim.tick;
    standAt(sim, dog, own);
    let thrown = 0;
    for (let t = 0; t < TICK_HZ * 120; t++) {
      const b = t % 4 === 0 ? Btn.Throw : 0;
      hold(sim, dog, b, dog.yaw, 0.9);
      const before = ordnanceStats(sim).throws;
      steps(sim, 1);
      thrown += ordnanceStats(sim).throws - before;
    }
    expect(thrown).toBeLessThanOrEqual(Math.floor(120 / ORDNANCE_RULES.restockCooldown) + 1);
    expect(thrown).toBeGreaterThanOrEqual(Math.floor(120 / ORDNANCE_RULES.restockCooldown) - 1);
  });

  it("the restock reach is exactly the kiosk's E reach (ordnanceTerminalFor), both teams, all around, up and down", async () => {
    const sim = await makeSim();
    const dog = spawn(sim, Team.Corgis, 0, 0), cat = spawn(sim, Team.Cats, 4, 0);
    steps(sim, 2);
    let checked = 0, inReach = 0;
    for (const k of kiosks(sim)) {
      for (const c of [dog, cat]) {
        for (let dx = -3.5; dx <= 3.5; dx += 0.35) for (let dz = -3.5; dz <= 3.5; dz += 0.35) for (const dy of [0, 1.5, 2.5]) {
          c.pos.x = k.pos.x + dx; c.pos.y = k.pos.y + dy; c.pos.z = k.pos.z + dz;
          const a = ownKioskFor(sim, c), b = ordnanceTerminalFor(sim, c);
          expect(a?.id ?? -1).toBe(b?.id ?? -1);
          checked++; if (a) inReach++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(inReach).toBeGreaterThan(100);
    expect(TERMINALS.ordnance_terminal.useRange).toBeGreaterThan(1.9); // standAt() is inside the reach
  });
});

// ------------------------------------------------------------------------------------------------ fuse + blast
describe('X4 ordnance: fuse and blast', () => {
  it('goes off exactly fuse seconds after the release with the shared blast; bounces, rests, reports Grounded', async () => {
    const sim = await makeSim();
    const dog = spawn(sim, Team.Corgis, 0, 0);
    steps(sim, 2);
    hold(sim, dog, Btn.Throw, 0, 0.1); steps(sim, 1);
    hold(sim, dog, 0, 0, 0.1);
    const release = sim.tick;
    const events: GameEvent[] = [];
    steps(sim, 1, events);
    const g = liveOrdnance(sim)[0];
    const def = ORDNANCE.squeaker_grenade;
    let blastTick = -1, rested = false, bounces = 0;
    for (let t = 0; t < FUSE_TICKS + 5 && blastTick < 0; t++) {
      const tick = sim.tick;
      steps(sim, 1, events);
      if (!g.removed) { rested ||= (g.flags & EFlag.Grounded) !== 0; bounces = g.ordProj!.body.bounces; }
      if (events.some((e) => e.e === 'explode')) blastTick = tick;
    }
    expect(blastTick - release).toBe(FUSE_TICKS);
    expect(FUSE_TICKS / TICK_HZ).toBeCloseTo(def.projectile.lifetime, 6);
    const ex = events.find((e) => e.e === 'explode') as Extract<GameEvent, { e: 'explode' }>;
    expect(ex).toMatchObject({ r: ORDNANCE_BLAST.explodeRadius, by: dog.id });
    // systems that read blasts from events can tell it is a throwable (and which): only on the blast's own tick
    sim.tick--; expect(ordnanceBlastOf(sim, ex)).toBe(def.projectile); sim.tick++;
    expect(ordnanceBlastOf(sim, ex)).toBeNull();
    expect(ordnanceBlastOf(sim, { ...ex, by: 999 })).toBeNull();
    expect(rested).toBe(true);
    expect(bounces).toBeGreaterThanOrEqual(2); // a lively squeaker
    expect(g.removed).toBe(true);
    expect(ordnanceStats(sim)).toMatchObject({ throws: 1, blasts: 1, live: 0 });
  });

  it('never one-shots: a centre blast leaves every class alive at full health (90 hp included); falloff, self and team rules', async () => {
    const sim = await makeSim();
    const thrower = spawn(sim, Team.Corgis, -20, 0);
    steps(sim, 2);
    for (const def of Object.values(ORDNANCE)) {
      for (const cls of CLASS_IDS) {
        const victim = spawn(sim, Team.Cats, 0, 0, cls);
        steps(sim, 1);
        victim.combat!.invulnUntil = 0;
        const before = victim.health!.hp;
        expect(before).toBe(CLASSES[cls].maxHp);
        explode(sim, victim.pos.x, victim.pos.y + 0.15, victim.pos.z, def.projectile, thrower.id, thrower.team, 100);
        expect(victim.dead).toBe(false);
        expect(before - victim.health!.hp).toBe(ORDNANCE_BLAST.explodeDamage);
        expect(victim.health!.hp).toBeGreaterThanOrEqual(20);
        sim.removeEntity(victim.id);
        sim.drainEvents();
      }
    }
    // falloff: 2 m ≈ 48, the 4 m edge ≈ 14; its own thrower takes 35 %; a teammate takes nothing
    const a = spawn(sim, Team.Cats, 2.0 + 0.36, 10), b = spawn(sim, Team.Cats, 30, 10), mate = spawn(sim, Team.Corgis, 30.5, 10.5);
    steps(sim, 1);
    for (const e of [a, b, mate, thrower]) e.combat!.invulnUntil = 0;
    const pd = ORDNANCE.hairball_bomb.projectile;
    explode(sim, 0, 0.15, 10, pd, thrower.id, thrower.team, 101);
    expect(a.health!.max - a.health!.hp).toBeGreaterThan(40);
    expect(a.health!.max - a.health!.hp).toBeLessThan(55);
    sim.placeCharacter(thrower, 30, 0.02, 10);
    explode(sim, 30, 0.15, 10, pd, thrower.id, thrower.team, 101);
    expect(b.health!.max - b.health!.hp).toBe(70);
    expect(thrower.health!.max - thrower.health!.hp).toBe(Math.round(70 * ORDNANCE_BLAST.selfDamageMult));
    expect(mate.health!.hp).toBe(mate.health!.max);
    // both factions: the same blast numbers (they differ in bounce only)
    const blast = (d: typeof pd) => [d.explodeRadius, d.explodeDamage, d.explodeInner, d.explodeEdgeFrac, d.selfDamageMult, d.knockback];
    expect(blast(ORDNANCE.squeaker_grenade.projectile)).toEqual(blast(ORDNANCE.hairball_bomb.projectile));
    expect(ORDNANCE.squeaker_grenade.projectile.restitution).toBeGreaterThan(ORDNANCE.hairball_bomb.projectile.restitution * 2);
  });

  it('a thrown one punishes a cluster: two cats next to the landing are hurt, knocked back, and alive', async () => {
    const sim = await makeSim();
    const dog = spawn(sim, Team.Corgis, 0, 0);
    steps(sim, 2);
    // where a flat-ish throw straight ahead (−Z) comes to rest, from the sim itself
    const probe = throwNow(sim, dog, 0, -0.05)!;
    const events: GameEvent[] = [];
    let last = { x: 0, z: 0 };
    for (let t = 0; t < FUSE_TICKS + 2; t++) { if (!probe.removed) last = { x: probe.pos.x, z: probe.pos.z }; steps(sim, 1, events); }
    const c1 = spawn(sim, Team.Cats, last.x + 1.2, last.z), c2 = spawn(sim, Team.Cats, last.x - 1.0, last.z + 0.6);
    steps(sim, 2);
    for (const c of [c1, c2]) c.combat!.invulnUntil = 0;
    dog.ordCarry!.carry = true; dog.ordCarry!.nextThrow = 0;
    events.length = 0;
    expect(throwNow(sim, dog, 0, -0.05, events)).not.toBeNull();
    steps(sim, FUSE_TICKS + 2, events);
    const hits = events.filter((e) => e.e === 'hit' && (e.dst === c1.id || e.dst === c2.id));
    expect(new Set(hits.map((h) => (h as { dst: number }).dst)).size).toBe(2);
    for (const c of [c1, c2]) {
      expect(c.dead).toBe(false);
      expect(c.health!.hp).toBeLessThan(c.health!.max - 30);
    }
  });

  it('bounces off an enemy it hits in flight without hurting it (the blast is the damage)', async () => {
    const sim = await makeSim();
    const dog = spawn(sim, Team.Corgis, 0, 0);
    const cat = spawn(sim, Team.Cats, 0, -3);
    steps(sim, 2);
    cat.combat!.invulnUntil = 0;
    const g = throwNow(sim, dog, 0, -ORDNANCE.squeaker_grenade.lob)!; // flat, at chest height
    let bounced = false;
    for (let t = 0; t < 20 && !bounced; t++) {
      steps(sim, 1);
      if (g.ordProj!.body.landed) bounced = true;
    }
    expect(bounced).toBe(true);
    expect(g.ordProj!.body.lz).toBeGreaterThan(-3); // stopped at the cat, not behind it
    expect(g.vel.z).toBeGreaterThan(-1); // knocked back toward the thrower
    expect(cat.health!.hp).toBe(cat.health!.max);
  });
});

// ------------------------------------------------------------------------------------------------ match + determinism
describe('X4 ordnance: match restart and determinism', () => {
  it('a throw in flight across a match end/restart never goes off; a throw in the ended phase is refused; everybody restarts with one', async () => {
    const sim = await makeSim({ match: true, tdm: { warmup: 0.2, timeLimit: 3, killLimit: 99, endedHold: 0.5 } });
    const dog = spawn(sim, Team.Corgis, 0, 0);
    const cat = spawn(sim, Team.Cats, 30, 0);
    const events: GameEvent[] = [];
    steps(sim, Math.round(0.4 * TICK_HZ), events);
    expect((sim.state.match as MatchState).phase).toBe('live');
    expect(throwNow(sim, cat, cat.yaw, 0.4, events)).not.toBeNull(); // spent: must come back on the restart
    // throw late: the match ends at 3 s (combat stops) and restarts at 3.5 s, before this one's 2.2 s fuse
    steps(sim, Math.round(2.6 * TICK_HZ) - sim.tick, events);
    const g = throwNow(sim, dog, dog.yaw, 0.5, events)!;
    expect(g).not.toBeNull();
    const ref = sim.state.match;
    while ((sim.state.match as MatchState).phase !== 'ended') steps(sim, 1, events);
    dog.ordCarry!.carry = true; dog.ordCarry!.nextThrow = 0; // (white-box) even carrying one, the ended phase refuses
    expect(tryThrow(sim, dog)).toBe('not_live');
    while (sim.state.match === ref) steps(sim, 1, events);
    steps(sim, 1, events);
    expect(g.removed).toBe(true);
    expect(liveOrdnance(sim).length).toBe(0);
    steps(sim, FUSE_TICKS, events);
    expect(events.filter((e) => e.e === 'explode').length).toBe(1); // only the cat's early one went off
    for (const c of [dog, cat]) {
      expect(c.ordCarry!.carry).toBe(true);
      expect(c.flags & EFlag.Ordnance).toBeTruthy();
    }
    expect(ordnanceStats(sim).fizzles).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic per seed and never draws from sim.rng', async () => {
    const run = async (throws: boolean) => {
      const sim = await makeSim({ seed: 11 });
      const dog = spawn(sim, Team.Corgis, 0, 0), cat = spawn(sim, Team.Cats, 6, -40);
      steps(sim, 2);
      const trace: number[] = [];
      const events: GameEvent[] = [];
      for (let t = 0; t < 400; t++) {
        const b = throws && (t === 5 || t === 200) ? Btn.Throw : 0;
        hold(sim, dog, b, 0.3 + t * 0.001, 0.35);
        hold(sim, cat, b, Math.PI + 0.2, 0.2);
        if (throws && t === 150) { dog.ordCarry!.carry = true; cat.ordCarry!.carry = true; }
        steps(sim, 1, events);
        for (const g of liveOrdnance(sim)) trace.push(g.id, g.pos.x, g.pos.y, g.pos.z, g.ammo);
      }
      return { trace, events: JSON.stringify(events), rng: sim.rng(), stats: ordnanceStats(sim) };
    };
    const a = await run(true), b = await run(true), none = await run(false);
    expect(a.trace.length).toBeGreaterThan(400);
    expect(a.trace).toEqual(b.trace);
    expect(a.events).toBe(b.events);
    expect(a.stats).toEqual(b.stats);
    expect(a.stats.throws).toBe(4);
    expect(a.rng).toBe(none.rng); // throws, flights and blasts never touch the shared sim RNG
  });

  it('the species picks the throwable and its wire index (never a weapon index)', () => {
    expect(ordnanceFor(Species.Corgi).id).toBe('squeaker_grenade');
    expect(ordnanceFor(Species.Cat).id).toBe('hairball_bomb');
    expect(ordnanceByWire(0)).toBeNull();
    expect(ordnanceByWire(ORDNANCE_RULES.wireBase)?.id).toBe('squeaker_grenade');
    expect(ordnanceByWire(ORDNANCE_RULES.wireBase + 1)?.id).toBe('hairball_bomb');
    expect(ordnanceByWire(ORDNANCE_RULES.wireBase + 2)).toBeNull();
  });
});
