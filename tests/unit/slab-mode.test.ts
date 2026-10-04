// W13 TW-SIM: the slab mode in the TS authority, copied from the Godot game (engines/godot/game/match.gd, slab.gd,
// tuning.gd): hold the slab alone for 1 point per full second, contested or empty scores nothing, downed pets don't
// count; first to 60, else the leader at 3:00, tied: overtime (60 s at most) then a draw; 3 s respawns with a 1 s shield;
// the Assault kit with the Squeaker Rifle only; the result holds until a human's Reload (bots-only rooms restart alone).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { Btn, emptyInput } from '../../src/shared/input';
import { CLASS_IDS, EFlag, EntityKind, Species, Team, type EntityKindId, type TeamId } from '../../src/shared/types';
import type { GameEvent, MatchState, ServerMsg } from '../../src/shared/protocol';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import { SLAB, SLAB_TEXT, SLAB_ZONE_SEED, onSlab, type SlabConfig } from '../../src/shared/content/modes';
import { weaponIndex } from '../../src/shared/content/weapons';
import {
  MODES, SLAB_CAT_OFFSET, SLAB_CAT_SLOTS, SLAB_CORGI_TRIPS, SLAB_FALL_DEPTH, slabCatSlots, slabRespawnPoints, slabSlotOf, slabSlots, slabZone, type SlabLayout,
} from '../../src/sim/match';
import { createWorldData } from '../../src/shared/world/world-data';
import type { SpawnPoint } from '../../src/shared/world/world-types';
import { applyDamage, isInvulnerable, kill, respawnNow } from '../../src/sim/combat';
import { createBrain } from '../../src/sim/ai';
import { createOrdnanceBot } from '../../src/sim/ai/ordnance-ai';
import { WebSocket as WsClient } from 'ws';
import { startGameServer } from '../../server/app';
import { botsForMode, loadConfig } from '../../server/config';
import { SnapDecoder, decodeServerFrame } from '../../src/host/wire';
import { ROOM_MODES, sanitizeRoomSetup } from '../../src/host/guard';
import { mapForMode, mapForRoom, mapsForMode } from '../../src/shared/world/maps';

const SEED = 1;

/** A slab sim whose match has started (its first tick ran: pets present then would have been moved to their start
 *  slots; the test pets come after it, where the tests put them, and take a slot at their first respawn). */
async function slabSim(over: Partial<SlabConfig> = {}): Promise<Sim> {
  const sim = await Sim.create({ seed: SEED, map: 'the_lot' });
  sim.state.room = { mode: 'slab' };
  sim.state.matchConfig = { slab: over };
  sim.step();
  sim.drainEvents();
  return sim;
}

/** Step whole ticks; returns the events. */
function run(sim: Sim, ticks: number, until?: () => boolean): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    out.push(...sim.drainEvents());
    if (until?.()) break;
  }
  return out;
}

const match = (sim: Sim) => sim.state.match as MatchState;

/** A pet (a human by default: EntityKind.Player) standing on the slab at (dx, dz) from its centre. */
function pet(sim: Sim, team: TeamId, dx = 0, dz = 0, kind: EntityKindId = EntityKind.Player): SimEntity {
  const x = SLAB.center.x + dx, z = SLAB.center.z + dz;
  return sim.spawnCharacter({ kind, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'assault', name: `p${team}${dx}`, x, y: sim.worldData.height(x, z) + 0.02, z, yaw: 0 });
}

/** Move a living pet off the slab (to a spot 20 m out, on the ground). */
function offSlab(sim: Sim, e: SimEntity): void {
  const x = SLAB.center.x + 20, z = SLAB.center.z;
  sim.placeCharacter(e, x, sim.worldData.height(x, z) + 0.02, z);
}

const src = (e: SimEntity) => ({ id: e.id, team: e.team, weapon: weaponIndex('squeaker_rifle') });

/** Godot's W14 rule, written out independently: straight-line sprint time to the slab centre (classes.ts sprint speeds). */
const w14Time = (p: { x: number; z: number }, team: TeamId) => Math.hypot(p.x - SLAB.center.x, p.z - SLAB.center.z) / (team === Team.Cats ? 8.8 : 9.6);
/** W14 start_slots for the Cats: indices (in their spawn list) greedily matched to the Corgis' farthest-first times. */
function w14CatOrder(cats: readonly SpawnPoint[], corgis: readonly SpawnPoint[]): number[] {
  const ref = [...corgis].sort((a, b) => w14Time(b, Team.Corgis) - w14Time(a, Team.Corgis));
  const left = cats.map((_, i) => i), out: number[] = [];
  for (const r of ref) {
    if (!left.length) break;
    const want = w14Time(r, Team.Corgis);
    let best = 0;
    for (let i = 1; i < left.length; i++) if (Math.abs(w14Time(cats[left[i]], Team.Cats) - want) < Math.abs(w14Time(cats[left[best]], Team.Cats) - want)) best = i;
    out.push(left[best]);
    left.splice(best, 1);
  }
  return [...out, ...left];
}
/** W14 _pick_respawn_slots for the Cats: their spawns within 0.3 s below the Corgis' slot 0, else the one nearest the middle. */
function w14CatRespawns(cats: readonly SpawnPoint[], corgis: readonly SpawnPoint[]): SpawnPoint[] {
  const t0 = Math.max(...corgis.map((p) => w14Time(p, Team.Corgis)));
  const inside = cats.filter((p) => w14Time(p, Team.Cats) <= t0 + 1e-4 && w14Time(p, Team.Cats) >= t0 - 0.3 - 1e-4);
  if (inside.length) return inside;
  let nearest = cats[0];
  for (const p of cats) if (Math.abs(w14Time(p, Team.Cats) - (t0 - 0.15)) < Math.abs(w14Time(nearest, Team.Cats) - (t0 - 0.15))) nearest = p;
  return [nearest];
}

describe('slab mode: data and registry', () => {
  it('matches the Godot game: the slab of the_lot.json and the rules of tuning.gd', () => {
    const lot = JSON.parse(readFileSync('engines/godot/data/the_lot.json', 'utf8')) as { slab: { center: number[]; size: number[] } };
    expect([SLAB.center.x, SLAB.center.y, SLAB.center.z]).toEqual(lot.slab.center);
    expect([SLAB.size.x, SLAB.size.z]).toEqual(lot.slab.size);
    const tuning = readFileSync('engines/godot/game/tuning.gd', 'utf8');
    const num = (k: string) => Number(new RegExp(`const ${k} := ([0-9.]+)`).exec(tuning)?.[1]);
    expect(SLAB.winScore).toBe(num('WIN_SCORE'));
    expect(SLAB.timeLimit).toBe(num('MATCH_TIME'));
    expect(SLAB.overtimeMax).toBe(num('OVERTIME_MAX'));
    expect(SLAB.respawn).toBe(num('RESPAWN_TIME'));
    expect(SLAB.spawnShield).toBe(num('SPAWN_SHIELD'));
    expect([SLAB.winScore, SLAB.timeLimit, SLAB.overtimeMax, SLAB.respawn, SLAB.spawnShield]).toEqual([60, 180, 60, 3, 1]);
    // slab.gd contains(): inside the square (edges included), feet strictly within center.y - 1 .. center.y + 3
    const c = SLAB.center;
    expect(onSlab(c.x + 4, c.y, c.z - 4)).toBe(true);
    expect(onSlab(c.x + 4.01, c.y, c.z)).toBe(false);
    expect(onSlab(c.x, c.y, c.z + 4.01)).toBe(false);
    expect(onSlab(c.x, c.y - 0.99, c.z)).toBe(true);
    expect(onSlab(c.x, c.y - 1, c.z)).toBe(false);
    expect(onSlab(c.x, c.y + 2.99, c.z)).toBe(true);
    expect(onSlab(c.x, c.y + 3, c.z)).toBe(false);
  });

  it("is a match mode that plays on The Lot (its home map: no request can put it elsewhere)", () => {
    expect(MODES).toContain('slab');
    for (const id of [undefined, null, 'nope', 'west_yard', 'the_lot']) expect(mapForMode(id, 'slab')).toBe('the_lot');
    expect(mapForRoom(undefined, 'slab')).toBe('the_lot');
    expect(mapsForMode('slab')).toEqual(['the_lot']);
    // the other modes keep the West Yard as their fallback
    expect(mapForMode('nope', 'team-deathmatch')).toBe('west_yard');
    expect(mapForMode('the_lot', 'adventure')).toBe('west_yard');
  });
});

describe('slab mode: scoring', () => {
  it('live from the first tick; holding alone scores exactly 1 point per full second; the Zone shows the holder', async () => {
    const sim = await slabSim();
    const c = pet(sim, Team.Corgis);
    run(sim, 1);
    const ms = match(sim);
    expect(ms).toMatchObject({ mode: 'slab', phase: 'live', score: [0, 0], objective: SLAB_TEXT.hold, winner: -1 });
    expect(ms.timeLeft).toBeCloseTo(SLAB.timeLimit - 2 / 60, 6); // (slabSim ran the first tick)
    const z = slabZone(sim)!;
    const s = sim.toState(sim.entities.get(z.id)!);
    expect(s).toMatchObject({ kind: EntityKind.Zone, seed: SLAB_ZONE_SEED, team: Team.Corgis, x: SLAB.center.x, y: SLAB.center.y, z: SLAB.center.z });
    expect(s.flags & EFlag.Busy).toBe(0);
    run(sim, 58); // 59 ticks held
    expect(match(sim).score).toEqual([0, 0]);
    run(sim, 1); // the 60th
    expect(match(sim).score).toEqual([1, 0]);
    run(sim, 540); // 10 s in all
    expect(match(sim).score).toEqual([10, 0]);
    expect(c.dead).toBe(false);
    // the holder stays on: two pets of one team still score 1/s, not 2
    pet(sim, Team.Corgis, 2, 2);
    run(sim, 300);
    expect(match(sim).score).toEqual([15, 0]);
    // off the slab: nobody holds it, nothing scores, the Zone goes neutral
    for (const e of sim.entities.values()) if (e.char) offSlab(sim, e);
    run(sim, 300);
    expect(match(sim).score).toEqual([15, 0]);
    expect(sim.toState(sim.entities.get(z.id)!).team).toBe(Team.Neutral);
  });

  it('contested scores nothing, and the second being counted starts over whenever the holder changes', async () => {
    const sim = await slabSim();
    const c = pet(sim, Team.Corgis, -2);
    const k = pet(sim, Team.Cats, 2);
    run(sim, 600);
    expect(match(sim).score).toEqual([0, 0]);
    const z = slabZone(sim)!;
    expect(z).toMatchObject({ holder: -1, contested: true, counts: [1, 1] });
    const zs = sim.toState(sim.entities.get(z.id)!);
    expect(zs.team).toBe(Team.Neutral);
    expect(zs.flags & EFlag.Busy).toBe(EFlag.Busy);
    // 0.5 s alone, 1 s contested, 0.75 s alone: no full second alone yet
    offSlab(sim, k);
    run(sim, 30);
    const back = pet(sim, Team.Cats, 1, 1);
    run(sim, 60);
    offSlab(sim, back);
    run(sim, 45);
    expect(match(sim).score).toEqual([0, 0]);
    run(sim, 15); // the full second
    expect(match(sim).score).toEqual([1, 0]);
    expect(c.dead).toBe(false);
  });

  it("downed pets don't count; they respawn after 3 s at their team spawn with a 1 s shield", async () => {
    const sim = await slabSim();
    const c = pet(sim, Team.Corgis, -1);
    const k = pet(sim, Team.Cats, 1);
    run(sim, 120);
    expect(match(sim).score).toEqual([0, 0]);
    kill(sim, k, src(c));
    expect(k.dead).toBe(true);
    let steps = 0;
    run(sim, 400, () => (steps++, !k.dead));
    // killed between ticks: the respawn runs in the 181st tick (a kill inside a tick respawns 180 ticks later)
    expect(steps).toBe(181);
    expect(match(sim).score).toEqual([3, 0]); // the corpse on the slab never contested it
    // W14 (Godot best_spawn): on the Cats' respawn point farthest from the corgi (The Lot's data points, W15), facing the slab
    const pts = slabRespawnPoints(sim, Team.Cats);
    const far = [...pts].sort((a, b) => Math.hypot(b.x - c.pos.x, b.z - c.pos.z) - Math.hypot(a.x - c.pos.x, a.z - c.pos.z))[0];
    expect([k.pos.x, k.pos.z, k.yaw]).toEqual([far.x, far.z, far.yaw]);
    expect(sim.worldData.spawns.some((s) => s.team === Team.Cats && s.x === k.pos.x && s.z === k.pos.z)).toBe(true);
    expect(k.health!.hp).toBe(120);
    // the shield: 1 s (60 ticks after the respawn tick), not the default 1.5 s
    expect(isInvulnerable(sim, k)).toBe(true);
    run(sim, 30);
    expect(applyDamage(sim, k, 50, src(c), k.pos.x, k.pos.y + 0.5, k.pos.z, false)).toBe(0);
    run(sim, 29); // 60 ticks after the respawn tick: still shielded through this one
    expect(applyDamage(sim, k, 50, src(c), k.pos.x, k.pos.y + 0.5, k.pos.z, false)).toBe(0);
    run(sim, 1);
    expect(isInvulnerable(sim, k)).toBe(false);
    expect(applyDamage(sim, k, 50, src(c), k.pos.x, k.pos.y + 0.5, k.pos.z, false)).toBe(50);
  });
});

describe('slab mode: the fall (W15, Godot match.gd: y < slab y - 40 -> die(null))', () => {
  it('a fall takes the pet down by nobody (THE LOT: death by -1, no credit to its last attacker), then the slab respawn', async () => {
    const sim = await slabSim();
    const c = pet(sim, Team.Corgis);
    const k = pet(sim, Team.Cats, 30, 0); // off the slab
    run(sim, 30);
    expect(applyDamage(sim, c, 30, src(k), c.pos.x, c.pos.y + 0.5, c.pos.z, false)).toBe(30); // k hit it 0.5 s ago
    run(sim, 30);
    const held = [...match(sim).score]; // (c held the slab alone for that second: [1, 0])
    const below = SLAB.center.y - SLAB_FALL_DEPTH;
    // between the map's killY (-20) and Godot's plane (slab y - 40) nothing happens yet: no teleport, no death
    sim.placeCharacter(c, c.pos.x, below + 15, c.pos.z);
    expect(run(sim, 1).some((ev) => ev.e === 'death' || (ev.e === 'spawn' && ev.id === c.id))).toBe(false);
    expect(c.dead).toBe(false);
    expect(c.pos.y).toBeLessThan(sim.worldData.killY);
    // below the plane: down, with no killer
    sim.placeCharacter(c, c.pos.x, below - 0.5, c.pos.z);
    const evs = run(sim, 1);
    expect(c.dead).toBe(true);
    expect(evs.filter((ev) => ev.e === 'death')).toEqual([{ e: 'death', id: c.id, by: -1 }]);
    expect(evs.some((ev) => ev.e === 'spawn')).toBe(false); // not teleported to a spawn
    expect(c.pos.y).toBeLessThan(below);
    expect(match(sim).score).toEqual(held); // no score of its own
    // back after SLAB.respawn s (the fall happened inside a tick: 180 ticks later), on a Corgi respawn point
    let steps = 0;
    run(sim, 400, () => (steps++, !c.dead));
    expect(steps).toBe(SLAB.respawn * 60);
    const pts = slabRespawnPoints(sim, Team.Corgis);
    expect(pts.some((p) => p.x === c.pos.x && p.z === c.pos.z && p.yaw === c.yaw)).toBe(true);
    expect(isInvulnerable(sim, c)).toBe(true);
    expect(match(sim).score).toEqual(held); // nobody held the slab meanwhile (k stands 30 m off it)
  });

  it('a lagging human (Room catch-up inputs) who falls is downed with by -1, not teleported by the catch-up step', async () => {
    const sim = await Sim.create({ seed: SEED, map: 'the_lot' });
    const room = new Room(sim, { mode: 'slab', botsPerTeam: [0, 0] });
    const evs: GameEvent[] = [];
    const drain = sim.drainEvents.bind(sim);
    sim.drainEvents = () => { const ev = drain(); evs.push(...ev); return ev; };
    room.join({ id: 'h', send: () => {} }, { t: 'hello', v: PROTOCOL_VERSION, name: 'Ann', team: 0, cls: 'assault' });
    const slot = room.players.get('h')!;
    const e = sim.entities.get(slot.entity)!;
    let seq = 0;
    const send = (n: number) => {
      const cmds = Array.from({ length: n }, () => ({ ...emptyInput(++seq), yaw: e.yaw }));
      for (let i = 0; i < cmds.length; i += 32) room.handle('h', { t: 'input', cmds: cmds.slice(i, i + 32) });
    };
    for (let i = 0; i < 10; i++) { send(1); room.tick(); } // live, inputs flowing
    // over the slab, 2 m above Godot's plane (and below the map's killY + 2, the catch-up step's out-of-bounds line)
    sim.placeCharacter(e, SLAB.center.x, SLAB.center.y - SLAB_FALL_DEPTH + 2, SLAB.center.z);
    for (let i = 0; i < 20; i++) room.tick(); // its inputs are late: frozen in the air, owed 20 ticks
    expect(e.dead).toBe(false);
    evs.length = 0;
    send(20);
    let t = 0;
    while (!e.dead && t < 60) { room.tick(); t++; }
    expect(slot.net.catchups).toBeGreaterThan(0); // the fall ran through the Room's catch-up steps
    expect(e.dead).toBe(true);
    expect(evs.filter((ev) => ev.e === 'death')).toEqual([{ e: 'death', id: e.id, by: -1 }]);
    expect(evs.some((ev) => ev.e === 'spawn' && ev.id === e.id)).toBe(false);
    expect(e.pos.y).toBeLessThan(SLAB.center.y - SLAB_FALL_DEPTH);
    room.dispose();
  });

  it('in team-deathmatch the kill plane still teleports a faller to a spawn (no death)', async () => {
    const sim = await Sim.create({ seed: SEED, map: 'the_lot' });
    sim.state.room = { mode: 'team-deathmatch' };
    sim.step();
    sim.drainEvents();
    const c = pet(sim, Team.Corgis);
    sim.placeCharacter(c, c.pos.x, sim.worldData.killY - 1, c.pos.z);
    const evs = run(sim, 1);
    expect(c.dead).toBe(false);
    expect(evs.some((ev) => ev.e === 'death')).toBe(false);
    expect(Math.min(...sim.worldData.spawns.filter((s) => s.team === Team.Corgis).map((s) => Math.hypot(s.x - c.pos.x, s.z - c.pos.z)))).toBeLessThan(1);
  });
});

describe('slab mode: the end', () => {
  it('first to 60 wins (the real numbers): ended, the winner, its line, the clock frozen', async () => {
    const sim = await slabSim();
    pet(sim, Team.Cats);
    let ticks = 0;
    const evs = run(sim, 60 * 70, () => (ticks++, match(sim).phase === 'ended'));
    expect(ticks).toBe(3600);
    expect(match(sim)).toMatchObject({ phase: 'ended', score: [0, 60], winner: Team.Cats, objective: SLAB_TEXT.win[Team.Cats] });
    expect(match(sim).timeLeft).toBeCloseTo(SLAB.timeLimit - 60 - 1 / 60, 3); // (+ slabSim's first tick)
    expect(evs.some((e) => e.e === 'score' && e.reason === 'win' && e.team === Team.Cats)).toBe(true);
    const frozen = match(sim).timeLeft;
    run(sim, 120);
    expect(match(sim)).toMatchObject({ phase: 'ended', score: [0, 60], timeLeft: frozen }); // nothing scores after the end
  });

  it('at the horn the leader wins (timeLimit shortened)', async () => {
    const sim = await slabSim({ timeLimit: 5 });
    const c = pet(sim, Team.Corgis);
    run(sim, 120);
    offSlab(sim, c);
    let ticks = 121; // (+ slabSim's first tick)
    run(sim, 600, () => (ticks++, match(sim).phase === 'ended'));
    expect(ticks).toBe(300);
    expect(match(sim)).toMatchObject({ phase: 'ended', score: [2, 0], winner: Team.Corgis, objective: SLAB_TEXT.win[Team.Corgis], timeLeft: 0 });
  });

  it('tied at the horn: overtime until someone leads', async () => {
    const sim = await slabSim({ timeLimit: 2 });
    run(sim, 119); // the 120th tick of the match
    expect(match(sim)).toMatchObject({ phase: 'live', score: [0, 0], objective: SLAB_TEXT.overtime });
    expect(match(sim).timeLeft).toBeCloseTo(SLAB.overtimeMax, 6);
    run(sim, 600);
    expect(match(sim)).toMatchObject({ phase: 'live', objective: SLAB_TEXT.overtime });
    expect(match(sim).timeLeft).toBeCloseTo(SLAB.overtimeMax - 10, 3);
    pet(sim, Team.Cats);
    let ticks = 0;
    run(sim, 120, () => (ticks++, match(sim).phase === 'ended'));
    expect(ticks).toBe(60);
    expect(match(sim)).toMatchObject({ phase: 'ended', score: [0, 1], winner: Team.Cats, objective: SLAB_TEXT.win[Team.Cats] });
  });

  it('still tied after the overtime: a draw (contested all along)', async () => {
    const sim = await slabSim({ timeLimit: 1, overtimeMax: 2 });
    pet(sim, Team.Corgis, -1);
    pet(sim, Team.Cats, 1);
    let ticks = 0;
    run(sim, 600, () => (ticks++, match(sim).phase === 'ended'));
    expect(ticks).toBe(60 + 120 - 1); // the horn's tick starts the overtime; then 120 ticks (2 s) of it (slabSim ran tick 1)
    expect(match(sim)).toMatchObject({ phase: 'ended', winner: -1, objective: SLAB_TEXT.draw, score: [0, 0], timeLeft: 0 });
  });
});

describe('slab mode: kit, rematch, bots', () => {
  it('only the Squeaker Rifle: every pet carries the Assault kit with no ability; no ordnance, pickups, vehicles or terminals', async () => {
    const sim = await Sim.create({ seed: SEED, map: 'the_lot' });
    const room = new Room(sim, { mode: 'slab', botsPerTeam: [2, 2] });
    room.join({ id: 'h', send: () => {} }, { t: 'hello', v: PROTOCOL_VERSION, name: 'Ann', team: 0, cls: 'breacher' });
    for (let i = 0; i < 90; i++) room.tick();
    const chars = [...sim.entities.values()].filter((e) => e.char);
    expect(chars.length).toBe(4); // 2v2: the human + a Corgi bot vs two Cat bots
    for (const e of chars) {
      expect(e.cls).toBe('assault');
      expect(e.wpn!.id).toBe('squeaker_rifle');
      expect(e.abil!.id).toBe('');
      const s = sim.toState(e);
      expect(s.cls).toBe(CLASS_IDS.indexOf('assault'));
      expect(s.weapon).toBe(weaponIndex('squeaker_rifle'));
      expect(s.maxHp).toBe(120);
      expect(s.flags & EFlag.Ordnance).toBe(0);
    }
    for (const e of sim.entities.values()) {
      expect([EntityKind.Vehicle, EntityKind.Terminal, EntityKind.Pickup, EntityKind.Ability]).not.toContain(e.kind);
    }
    // the Ability button does nothing
    const human = chars.find((e) => e.kind === EntityKind.Player)!;
    const evs: GameEvent[] = [];
    for (let i = 0; i < 4; i++) {
      room.handle('h', { t: 'input', cmds: [{ ...human.input, seq: human.lastInputSeq + 1, buttons: i % 2 ? 0 : Btn.Ability }] });
      room.tick();
      evs.push(...sim.drainEvents());
    }
    expect(evs.some((e) => e.e === 'ability' && e.id === human.id)).toBe(false);
    expect(human.abil!.cooldown).toBe(0);
    room.dispose();
  });

  it('the result holds for the humans; a Reload press at least 1 s after the end restarts at 0-0 and 3:00', async () => {
    const sim = await slabSim({ winScore: 2 });
    const c = pet(sim, Team.Corgis);
    const k = pet(sim, Team.Cats, 30, 0);
    run(sim, 120);
    expect(match(sim)).toMatchObject({ phase: 'ended', winner: Team.Corgis, score: [2, 0] });
    const press = (e: SimEntity, down: boolean) => sim.setInput(e.id, { ...e.input, seq: e.input.seq + 1, buttons: down ? Btn.Reload : 0 });
    // too early: a press within the first second does nothing
    press(c, true); run(sim, 1); press(c, false); run(sim, 1);
    expect(match(sim).phase).toBe('ended');
    // held down past the delay: no new edge, no restart; and no countdown with humans present
    press(k, true);
    run(sim, (SLAB.endedHold + 2) * 60);
    expect(match(sim).phase).toBe('ended');
    press(k, false); run(sim, 1);
    // the edge: the match restarts
    press(k, true);
    const evs = run(sim, 1);
    expect(match(sim)).toMatchObject({ phase: 'live', score: [0, 0], winner: -1, objective: SLAB_TEXT.hold });
    expect(match(sim).timeLeft).toBeCloseTo(SLAB.timeLimit, 6);
    expect(evs.filter((e) => e.e === 'score' && e.reason === 'reset').length).toBe(2);
    expect(slabZone(sim)).toMatchObject({ holder: -1, contested: false });
    // everybody back at its start slot (W14: slot 0 of each team, equal sprint time to the slab), shielded for 1 s
    for (const e of [c, k]) {
      expect(e.dead).toBe(false);
      const slot = slabSlots(sim, e.team)[0];
      expect([e.pos.x, e.pos.z]).toEqual([slot.x, slot.z]);
      expect(isInvulnerable(sim, e)).toBe(true);
    }
    expect([k.pos.x, k.pos.z]).toEqual([56, 117]); // W15: the Cats' start slot 0 on The Lot (Godot CAT_SLOTS)
    run(sim, 60);
    expect(isInvulnerable(sim, c)).toBe(false);
  });

  it('CI 154: a Reload held over a late burst of inputs (the Room replays it as catch-up) still rematches', async () => {
    // The e2e that caught it: a slow browser frame sends 15 commands at once, all with R held, after the Room had
    // frozen the starving player (owed ticks). The first of them is the press edge; it must reach a regular tick.
    const sim = await Sim.create({ seed: SEED, map: 'the_lot' });
    sim.state.matchConfig = { slab: { timeLimit: 1, overtimeMax: 1 } }; // nobody on the slab: 0-0, then a draw at 2 s
    const room = new Room(sim, { mode: 'slab', botsPerTeam: [0, 0] });
    room.join({ id: 'h', send: () => {} }, { t: 'hello', v: PROTOCOL_VERSION, name: 'Ann', team: 0, cls: 'assault' });
    const slot = room.players.get('h')!;
    const e = sim.entities.get(slot.entity)!;
    let seq = 0;
    const send = (...buttons: number[]) => room.handle('h', { t: 'input', cmds: buttons.map((b) => ({ ...emptyInput(++seq), yaw: e.yaw, buttons: b })) });
    let t = 0;
    while ((sim.state.match as MatchState | undefined)?.phase !== 'ended' && t++ < 600) { send(0); room.tick(); }
    expect(match(sim)).toMatchObject({ phase: 'ended', winner: -1, objective: SLAB_TEXT.draw });
    for (let i = 0; i < (SLAB.rematchDelay + 0.5) * 60; i++) { send(0); room.tick(); } // past the rematch delay
    for (let i = 0; i < 8; i++) room.tick(); // its inputs are late: the player is frozen, owed ticks pile up
    expect(slot.net.owed).toBe(8); // so the burst below is replayed as catch-up (movement-only extras) where it can be
    send(Btn.Reload, Btn.Reload, Btn.Reload, Btn.Reload, Btn.Reload, 0, 0); // the late burst: R held over 5 commands
    room.tick();
    expect(match(sim)).toMatchObject({ phase: 'live', score: [0, 0], winner: -1 }); // the press edge took its own tick
    room.dispose();
  });

  it('X2: Reload mid-match (live) is not a rematch request', async () => {
    const sim = await slabSim();
    const c = pet(sim, Team.Corgis);
    run(sim, 120);
    const before = { score: [...match(sim).score], timeLeft: match(sim).timeLeft };
    expect(before.score).toEqual([2, 0]);
    const evs: GameEvent[] = [];
    for (let i = 0; i < 4; i++) { // two presses (edges)
      sim.setInput(c.id, { ...c.input, seq: c.input.seq + 1, buttons: i % 2 ? 0 : Btn.Reload });
      evs.push(...run(sim, 30));
    }
    expect(match(sim).phase).toBe('live');
    expect(evs.some((ev) => ev.e === 'score' && ev.reason === 'reset')).toBe(false);
    expect(match(sim).score).toEqual([4, 0]); // still counting, never back to 0-0
    expect(match(sim).timeLeft).toBeCloseTo(before.timeLeft - 2, 3); // the clock ran on, never back to 3:00
  });

  it('W15: a rematch gives every bot a fresh brain on its start slot (Godot test_bot_roles.gd)', async () => {
    const sim = await Sim.create({ seed: SEED, map: 'the_lot' });
    sim.state.matchConfig = { slab: { timeLimit: 30, overtimeMax: 0.1, endedHold: 0.5 } }; // 30 s of play, then a quick result
    const room = new Room(sim, { mode: 'slab', botsPerTeam: [2, 2] });
    const bots = () => [...sim.entities.values()].filter((e) => e.char && e.kind === EntityKind.Bot);
    let t = 0;
    while (match(sim)?.phase !== 'ended' && t < 40 * 60) { room.tick(); t++; }
    expect(match(sim).phase).toBe('ended');
    expect(t).toBeGreaterThanOrEqual(30 * 60);
    // the last match left its mark: every bot has a slab goal, and some fought or walked a path
    expect(bots().every((b) => b.ai!.tac.goal === 'step')).toBe(true);
    expect(bots().some((b) => b.ai!.mode !== 'patrol' || b.ai!.target >= 0 || b.ai!.path.length > 0)).toBe(true);
    while (match(sim).phase === 'ended' && t < 50 * 60) { room.tick(); t++; }
    expect(match(sim)).toMatchObject({ phase: 'live', score: [0, 0] }); // the restart tick
    expect(bots().length).toBe(4);
    for (const b of bots()) {
      const fresh = createBrain(b.ai!.arch, b.yaw);
      fresh.ord = createOrdnanceBot(b.id);
      fresh.lastX = b.pos.x; fresh.lastZ = b.pos.z;
      fresh.external = b.ai!.external;
      fresh.seq = b.ai!.seq;
      expect(b.ai).toEqual(fresh);
      const slot = slabSlotOf(sim, b)!;
      expect([b.pos.x, b.pos.z, b.yaw]).toEqual([slot.x, slot.z, slot.yaw]);
    }
    room.tick();
    for (const b of bots()) expect(b.ai!.odo).toBeLessThan(1); // no jump from where it stood before the rematch
    room.dispose();
  }, 120_000);

  it('a bots-only room restarts by itself after endedHold', async () => {
    const sim = await slabSim({ winScore: 1, endedHold: 2 });
    const b = pet(sim, Team.Cats, 0, 0, EntityKind.Bot);
    let ticks = 0;
    run(sim, 600, () => (ticks++, match(sim).phase === 'ended'));
    expect(match(sim)).toMatchObject({ phase: 'ended', winner: Team.Cats });
    run(sim, 119);
    expect(match(sim).phase).toBe('ended');
    run(sim, 1);
    expect(match(sim)).toMatchObject({ phase: 'live', score: [0, 0] });
    expect(b.cls).toBe('assault');
  });

  it('a bot keeps heading for the slab while trading shots (Godot bot.gd): it contests a holder it cannot down', async () => {
    const sim = await slabSim();
    const k = pet(sim, Team.Cats); // a human holding the slab, too tough to down in this test
    // 60 m out: without the advance it stops in its range band ~19.5 m off the holder and never contests (mutation-checked)
    const x = SLAB.center.x, z = SLAB.center.z - 60;
    const b = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'b', x, y: sim.worldData.height(x, z) + 0.02, z, yaw: Math.PI });
    let contested = 0, shots = 0;
    for (let i = 0; i < 20 * 60; i++) {
      k.health!.hp = 1e6;
      sim.step();
      for (const ev of sim.drainEvents()) if (ev.e === 'fire' && ev.id === b.id) shots++;
      if (slabZone(sim)!.contested) contested++;
    }
    expect(shots).toBeGreaterThan(20); // it fought on the way in
    expect(contested).toBeGreaterThan(3 * 60);
    expect(b.dead).toBe(false);
  });

  it('W14/W15 (Godot start_slots, _pick_respawn_slots, CAT_SLOTS): the slots on The Lot', async () => {
    const sim0 = await Sim.create({ seed: SEED, map: 'the_lot' });
    sim0.state.room = { mode: 'slab' };
    const slots = [slabSlots(sim0, Team.Corgis), slabSlots(sim0, Team.Cats)];
    expect(slots[0].length).toBe(16);
    expect(slots[1].length).toBe(16);
    // Corgis (unchanged since W14): farthest first, slot 0 their spawn 0 (143.5 m at 9.6 m/s)
    expect(Math.hypot(slots[0][0].x, slots[0][0].z)).toBeCloseTo(143.5, 1);
    expect(slots[0][0].time).toBeCloseTo(14.95, 2);
    for (let i = 1; i < 16; i++) expect(slots[0][i].time).toBeLessThanOrEqual(slots[0][i - 1].time);
    // Cats (W15): CAT_SLOTS start first (spawns 2 and 6: (56, 117), (62, 117)), then the W14 order of the rest
    const cats = sim0.worldData.spawns.filter((p) => p.team === Team.Cats);
    const idx = (s: { x: number; z: number }) => cats.findIndex((p) => p.x === s.x && p.z === s.z);
    expect(slots[1].slice(0, 2).map((s) => [idx(s), s.x, s.z])).toEqual([[2, 56, 117], [6, 62, 117]]);
    expect(slots[1].slice(2).map(idx)).toEqual(w14CatOrder(cats, sim0.worldData.spawns.filter((p) => p.team === Team.Corgis)).filter((i) => i !== 2 && i !== 6));
    // respawn points: the Corgis' slot 0 and two points 1.3 m on toward the slab; the Cats' CAT_SLOTS respawn row
    const resp = [slabRespawnPoints(sim0, Team.Corgis), slabRespawnPoints(sim0, Team.Cats)];
    expect(resp[0].map((p) => +p.time.toFixed(2))).toEqual([14.95, 14.82, 14.68]); // (143.5 m, then 1.3 m and 2.6 m nearer, at 9.6 m/s)
    expect(resp[1].map((p) => [idx(p), p.x, p.z])).toEqual([[2, 56, 117], [6, 62, 117], [10, 68, 117]]);
    // the data's reference (as Godot's test_game_respawn.gd): each Cat slot's measured trip is the Corgis' + 0.49-0.76 s
    for (const kind of ['start', 'respawn'] as const) {
      SLAB_CAT_SLOTS[kind].forEach((c, k) => {
        const lag = c.trip - SLAB_CORGI_TRIPS[kind][k];
        expect(lag).toBeGreaterThanOrEqual(0.49 - 1e-9);
        expect(lag).toBeLessThanOrEqual(0.76 + 1e-9);
        expect(Math.abs(lag - SLAB_CAT_OFFSET)).toBeLessThan(0.17);
      });
    }
    // a 2v2 room: everyone starts on its slot; then everyone is downed and comes back on a respawn point
    const sim = await Sim.create({ seed: SEED, map: 'the_lot' });
    const room = new Room(sim, { mode: 'slab', botsPerTeam: [2, 2] });
    room.tick();
    const pets = () => [Team.Corgis, Team.Cats].map((t) => [...sim.entities.values()].filter((e) => e.char && e.team === t).sort((a, b) => (a.data.slabSlot as number) - (b.data.slabSlot as number)));
    {
      const [cs, ks] = pets();
      expect(cs.map((e) => e.data.slabSlot)).toEqual([0, 1]);
      expect(ks.map((e) => e.data.slabSlot)).toEqual([0, 1]);
      for (const e of [...cs, ...ks]) {
        const s = slabSlotOf(sim, e)!;
        expect([e.pos.x, e.pos.z, e.yaw]).toEqual([s.x, s.z, s.yaw]);
      }
      expect(ks.map((e) => [e.pos.x, e.pos.z])).toEqual([[56, 117], [62, 117]]);
    }
    for (let i = 0; i < 60; i++) room.tick(); // they walk off
    const [cs, ks] = pets();
    for (const e of [...cs, ...ks]) kill(sim, e, src(e.team === Team.Corgis ? ks[0] : cs[0]));
    for (let i = 0; i < 181; i++) room.tick();
    for (const e of [...cs, ...ks]) expect(e.dead).toBe(false);
    // everyone back on a respawn point of its team (teammates on different ones), facing the slab
    for (const team of [cs, ks]) {
      const pts = slabRespawnPoints(sim, team[0].team);
      const at = team.map((e) => pts.findIndex((p) => p.x === e.pos.x && p.z === e.pos.z && p.yaw === e.yaw));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect(new Set(at).size).toBe(team.length);
    }
    room.dispose();
  });

  it("W15: the web's Cat slots are match.gd's CAT_SLOTS (indices, coordinates, trips) and the_lot.json's spawns", () => {
    const gd = readFileSync('engines/godot/game/match.gd', 'utf8');
    const block = /const CAT_SLOTS := \{([\s\S]*?)\n\}/.exec(gd)![1];
    const entries = (kind: string) => {
      const list = new RegExp(`"${kind}": \\[([\\s\\S]*?)\\]`).exec(block)![1];
      return [...list.matchAll(/\{"i": (\d+), "x": ([\d.-]+), "z": ([\d.-]+), "trip": ([\d.]+)\}/g)].map((m) => ({ i: +m[1], x: +m[2], z: +m[3], trip: +m[4] }));
    };
    expect(SLAB_CAT_SLOTS.start).toEqual(entries('start'));
    expect(SLAB_CAT_SLOTS.respawn).toEqual(entries('respawn'));
    expect(SLAB_CAT_SLOTS.respawn.length).toBe(3);
    expect(SLAB_CAT_OFFSET).toBe(Number(/const CAT_OFFSET := ([\d.]+)/.exec(gd)![1]));
    const trips = /const CORGI_TRIPS := \{"start": \[([^\]]*)\], "respawn": \[([^\]]*)\]\}/.exec(gd)!;
    expect(SLAB_CORGI_TRIPS.start).toEqual(trips[1].split(',').map(Number));
    expect(SLAB_CORGI_TRIPS.respawn).toEqual(trips[2].split(',').map(Number));
    // each entry's x, z is the spawn at its index in the_lot.json spawns["1"] (the web's Cat spawns, same order)
    const lot = JSON.parse(readFileSync('engines/godot/data/the_lot.json', 'utf8')) as { spawns: Record<string, number[][]> };
    const lotCats = createWorldData(SEED, 'the_lot').spawns.filter((p) => p.team === Team.Cats);
    for (const e of [...SLAB_CAT_SLOTS.start, ...SLAB_CAT_SLOTS.respawn]) {
      expect([lot.spawns['1'][e.i][0], lot.spawns['1'][e.i][2]]).toEqual([e.x, e.z]);
      expect([lotCats[e.i].x, lotCats[e.i].z]).toEqual([e.x, e.z]);
    }
  });

  it('W15 guard and fallback: off The Lot (or with a moved spawn) the W14 straight-line rule picks the Cat slots', async () => {
    // the West Yard: no data slots; the Cats' starts are the W14 greedy match, their respawns the band rule
    const yard = createWorldData(SEED, 'west_yard');
    const layout: SlabLayout = { worldData: yard }; // a layout, not a Sim: no cast
    expect(slabCatSlots(layout, 'start')).toEqual([]);
    expect(slabCatSlots(layout, 'respawn')).toEqual([]);
    const cats = yard.spawns.filter((p) => p.team === Team.Cats), corgis = yard.spawns.filter((p) => p.team === Team.Corgis);
    expect(slabSlots(layout, Team.Cats).map((s) => cats.findIndex((p) => p.x === s.x && p.z === s.z))).toEqual(w14CatOrder(cats, corgis));
    expect(slabRespawnPoints(layout, Team.Cats).map((s) => [s.x, s.z])).toEqual(w14CatRespawns(cats, corgis).map((p) => [p.x, p.z]));
    // The Lot with the Cats' spawn 2 moved 2 cm: the guard (0.01 m) drops the data, W14 picks again
    const lot = createWorldData(SEED, 'the_lot');
    let n = -1;
    const moved = lot.spawns.map((p) => (p.team === Team.Cats && ++n === 2 ? { ...p, x: p.x + 0.02 } : p));
    const off: SlabLayout = { worldData: { spawns: moved, height: (x, z) => lot.height(x, z) } };
    expect(slabCatSlots(off, 'start')).toEqual([]);
    const offCats = moved.filter((p) => p.team === Team.Cats), lotCorgis = moved.filter((p) => p.team === Team.Corgis);
    expect(slabSlots(off, Team.Cats).map((s) => offCats.findIndex((p) => p.x === s.x && p.z === s.z))).toEqual(w14CatOrder(offCats, lotCorgis));
    expect(slabRespawnPoints(off, Team.Cats).map((s) => [s.x, s.z])).toEqual(w14CatRespawns(offCats, lotCorgis).map((p) => [p.x, p.z]));
    // and the untouched Lot as a plain layout gives the data slots (what the client HUD runs)
    expect(slabRespawnPoints({ worldData: lot }, Team.Cats).map((s) => [s.x, s.z])).toEqual([[56, 117], [62, 117], [68, 117]]);
  });

  it("W15: the Cats' respawn zone is 132 m from the slab centre, as Godot's respawn_zone(1); the Corgis' 142 m", () => {
    // Godot: the centroid of respawn_slots[1] (CAT_SLOTS "respawn" -> the_lot.json spawns["1"][i]), its x/z distance to
    // the slab centre (the_lot.json slab.center), computed here from the Godot data alone
    const gd = readFileSync('engines/godot/game/match.gd', 'utf8');
    const resp = /"respawn": \[([\s\S]*?)\]/.exec(/const CAT_SLOTS := \{([\s\S]*?)\n\}/.exec(gd)![1])![1];
    const ids = [...resp.matchAll(/"i": (\d+)/g)].map((m) => +m[1]);
    const lot = JSON.parse(readFileSync('engines/godot/data/the_lot.json', 'utf8')) as { spawns: Record<string, number[][]>; slab: { center: number[] } };
    const gx = ids.reduce((a, i) => a + lot.spawns['1'][i][0], 0) / ids.length, gz = ids.reduce((a, i) => a + lot.spawns['1'][i][2], 0) / ids.length;
    const godot = Math.hypot(gx - lot.slab.center[0], gz - lot.slab.center[2]);
    expect(Math.round(godot)).toBe(132);
    // the web: the centroid of slabRespawnPoints (what the death panel's BACK AT reads)
    const zone = (team: TeamId) => {
      const pts = slabRespawnPoints({ worldData: createWorldData(SEED, 'the_lot') }, team);
      const x = pts.reduce((a, p) => a + p.x, 0) / pts.length, z = pts.reduce((a, p) => a + p.z, 0) / pts.length;
      return Math.hypot(x - SLAB.center.x, z - SLAB.center.z);
    };
    expect(zone(Team.Cats)).toBeCloseTo(godot, 6);
    expect(Math.round(zone(Team.Cats))).toBe(132);
    expect(Math.round(zone(Team.Corgis))).toBe(142); // unchanged (Godot test_hud_death.gd: 142 m TO THE SLAB)
  });

  it('a respawned bot of each team reaches the slab from its respawn point (bots only, deterministic)', async () => {
    const reach = async (team: TeamId) => {
      const sim = await Sim.create({ seed: SEED, map: 'the_lot' });
      const room = new Room(sim, { mode: 'slab', botsPerTeam: team === Team.Corgis ? [1, 0] : [0, 1] });
      room.tick();
      const b = [...sim.entities.values()].find((e) => e.char)!;
      for (let i = 0; i < 120; i++) room.tick();
      kill(sim, b, src(b));
      let t = 0;
      while (b.dead && t < 400) { room.tick(); t++; }
      expect(b.dead).toBe(false);
      const slot = slabRespawnPoints(sim, team).find((p) => p.x === b.pos.x && p.z === b.pos.z)!;
      expect(slot).toBeDefined();
      for (t = 0; t < 40 * 60; t++) {
        room.tick();
        if (onSlab(b.pos.x, b.pos.y, b.pos.z)) break;
      }
      room.dispose();
      return { s: t / 60, time: slot.time };
    };
    const c = await reach(Team.Corgis), k = await reach(Team.Cats);
    expect(c.s).toBeLessThan(30);
    expect(k.s).toBeLessThan(30);
    expect(await reach(Team.Cats)).toEqual(k); // deterministic
    console.log(`[slab W14] respawn to slab: corgi ${c.s.toFixed(2)} s (straight sprint ${c.time.toFixed(2)} s) · cat ${k.s.toFixed(2)} s (${k.time.toFixed(2)} s)`);
  }, 120_000);

  it('1v1 bots only: both walk to the slab, someone scores; the run is deterministic', async () => {
    const play = async () => {
      const sim = await Sim.create({ seed: SEED, map: 'the_lot' });
      const room = new Room(sim, { mode: 'slab', botsPerTeam: [1, 1] });
      const trace: string[] = [];
      let first = -1, onSlabTicks = 0;
      for (let i = 0; i < 40 * 60; i++) {
        room.tick();
        const ms = match(sim);
        if (first < 0 && ms.score[0] + ms.score[1] > 0) first = i;
        for (const e of sim.entities.values()) if (e.char && !e.dead && onSlab(e.pos.x, e.pos.y, e.pos.z)) onSlabTicks++;
        if (i % 60 === 0) trace.push(`${ms.score.join('-')} ${[...sim.entities.values()].filter((e) => e.char).map((e) => `${e.pos.x.toFixed(3)},${e.pos.z.toFixed(3)}`).join(' ')}`);
      }
      const chars = [...sim.entities.values()].filter((e) => e.char && e.kind === EntityKind.Bot);
      room.dispose();
      return { first, onSlabTicks, trace, score: [...match(sim).score], bots: chars.length };
    };
    const a = await play();
    expect(a.bots).toBe(2);
    expect(a.first).toBeGreaterThan(0);
    expect(a.score[0] + a.score[1]).toBeGreaterThan(0);
    expect(a.onSlabTicks).toBeGreaterThan(5 * 60);
    const b = await play();
    expect(b.trace).toEqual(a.trace);
  }, 120_000);

  it('the spawn shield lasts through firing in slab (Godot); without the slab, a shot still ends it', async () => {
    for (const mode of ['slab', undefined]) {
      const sim = await Sim.create({ seed: SEED, map: 'the_lot' });
      if (mode) sim.state.room = { mode };
      const e = pet(sim, Team.Cats, 30, 0);
      const foe = pet(sim, Team.Corgis, 30, 6);
      run(sim, 2);
      respawnNow(sim, e, { x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: 0 });
      sim.setInput(e.id, { ...e.input, seq: e.input.seq + 1, buttons: Btn.Fire });
      const shots = run(sim, 20).filter((ev) => ev.e === 'fire' && ev.id === e.id).length;
      expect(shots).toBeGreaterThan(0);
      const dmg = applyDamage(sim, e, 30, src(foe), e.pos.x, e.pos.y + 0.5, e.pos.z, false);
      if (mode) { expect(isInvulnerable(sim, e)).toBe(true); expect(dmg).toBe(0); }
      else { expect(isInvulnerable(sim, e)).toBe(false); expect(dmg).toBe(30); }
    }
  });

  it('online: a room created with ?mode=slab runs slab on The Lot, 1v1 against a bot', async () => {
    expect(ROOM_MODES).toContain('slab');
    expect(sanitizeRoomSetup('slab', null, null, 'west_yard')).toEqual({ mode: 'slab', map: 'the_lot' });
    expect(botsForMode('slab')).toEqual([1, 1]);
    expect(loadConfig({ MODE: 'slab' }, { log: false }).bots).toEqual([1, 1]);
    const s = await startGameServer(loadConfig({}, { host: '127.0.0.1', port: 0, log: false }));
    const ws = new WsClient(`${s.wsUrl}/?room=slab1&mode=slab`);
    try {
      const dec = new SnapDecoder();
      const msgs: ServerMsg[] = [];
      ws.on('message', (d) => { const m = decodeServerFrame(String(d), dec); if (m) msgs.push(m); });
      await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
      ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'Ann', team: -1, cls: 'overwatch' }));
      const snap = async () => {
        for (let i = 0; i < 600; i++) {
          const m = msgs.find((x): x is Extract<ServerMsg, { t: 'snap' }> => x.t === 'snap' && x.match.mode === 'slab');
          if (m) return m;
          await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error('no slab snapshot');
      };
      const first = await snap();
      expect(msgs.find((m) => m.t === 'welcome')).toMatchObject({ t: 'welcome', mode: 'slab', map: 'the_lot' });
      expect(first.match).toMatchObject({ mode: 'slab', phase: 'live', objective: SLAB_TEXT.hold });
      expect(s.rooms.list(10).find((r) => r.name === 'slab1')).toMatchObject({ mode: 'slab', map: 'the_lot' });
      const mr = (s.rooms as unknown as { rooms: Map<string, { room: Room }> }).rooms.get('slab1')!;
      const players = [...mr.room.players.values()];
      expect(players.map((p) => `${p.bot ? 'bot' : 'human'} ${p.team}`).sort()).toEqual([`bot ${Team.Cats}`, `human ${Team.Corgis}`]); // you vs one Cat bot
    } finally {
      ws.terminate();
      await s.close('test done');
    }
    // a server whose own MODE is slab: a room joined without ?mode= runs it on The Lot too (server/rooms.ts create)
    const s2 = await startGameServer(loadConfig({ MODE: 'slab' }, { host: '127.0.0.1', port: 0, log: false }));
    const ws2 = new WsClient(`${s2.wsUrl}/?room=plain`);
    try {
      const welcome = await new Promise<ServerMsg>((res, rej) => {
        const dec = new SnapDecoder();
        const timer = setTimeout(() => rej(new Error('no welcome')), 15_000);
        ws2.on('message', (d) => { const m = decodeServerFrame(String(d), dec); if (m?.t === 'welcome') { clearTimeout(timer); res(m); } });
        ws2.once('error', rej);
        ws2.once('open', () => ws2.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'Bo', team: -1, cls: 'assault' })));
      });
      expect(welcome).toMatchObject({ t: 'welcome', mode: 'slab', map: 'the_lot' });
    } finally {
      ws2.terminate();
      await s2.close('test done');
    }
  }, 60_000);

  it('no Math.random in the files of this mode', () => {
    for (const f of ['src/sim/match/slab.ts', 'src/sim/match/index.ts', 'src/sim/ai/tactics.ts', 'src/sim/ai/brain.ts', 'src/sim/combat/weapon-system.ts', 'src/shared/content/modes.ts', 'src/shared/world/maps.ts']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/Math\.random\s*\(/);
    }
  });
});
