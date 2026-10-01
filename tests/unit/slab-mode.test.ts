// W13 TW-SIM: the slab mode in the TS authority, copied from the Godot game (engines/godot/game/match.gd, slab.gd,
// tuning.gd): hold the slab alone for 1 point per full second, contested or empty scores nothing, downed pets don't
// count; first to 60, else the leader at 3:00, tied: overtime (60 s at most) then a draw; 3 s respawns with a 1 s shield;
// the Assault kit with the Squeaker Rifle only; the result holds until a human's Reload (bots-only rooms restart alone).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { Btn } from '../../src/shared/input';
import { CLASS_IDS, EFlag, EntityKind, Species, Team, type EntityKindId, type TeamId } from '../../src/shared/types';
import type { GameEvent, MatchState, ServerMsg } from '../../src/shared/protocol';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import { SLAB, SLAB_TEXT, SLAB_ZONE_SEED, onSlab, type SlabConfig } from '../../src/shared/content/modes';
import { weaponIndex } from '../../src/shared/content/weapons';
import { MODES, slabZone } from '../../src/sim/match';
import { applyDamage, isInvulnerable, kill, respawnNow } from '../../src/sim/combat';
import { WebSocket as WsClient } from 'ws';
import { startGameServer } from '../../server/app';
import { botsForMode, loadConfig } from '../../server/config';
import { SnapDecoder, decodeServerFrame } from '../../src/host/wire';
import { ROOM_MODES, sanitizeRoomSetup } from '../../src/host/guard';
import { mapForMode, mapForRoom, mapsForMode } from '../../src/shared/world/maps';

const SEED = 1;

async function slabSim(over: Partial<SlabConfig> = {}): Promise<Sim> {
  const sim = await Sim.create({ seed: SEED, map: 'the_lot' });
  sim.state.room = { mode: 'slab' };
  sim.state.matchConfig = { slab: over };
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
    expect(ms.timeLeft).toBeCloseTo(SLAB.timeLimit - 1 / 60, 6);
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
    const spawns = sim.worldData.spawns.filter((s) => s.team === Team.Cats);
    expect(Math.min(...spawns.map((s) => Math.hypot(s.x - k.pos.x, s.z - k.pos.z)))).toBeLessThan(1);
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

describe('slab mode: the end', () => {
  it('first to 60 wins (the real numbers): ended, the winner, its line, the clock frozen', async () => {
    const sim = await slabSim();
    pet(sim, Team.Cats);
    let ticks = 0;
    const evs = run(sim, 60 * 70, () => (ticks++, match(sim).phase === 'ended'));
    expect(ticks).toBe(3600);
    expect(match(sim)).toMatchObject({ phase: 'ended', score: [0, 60], winner: Team.Cats, objective: SLAB_TEXT.win[Team.Cats] });
    expect(match(sim).timeLeft).toBeCloseTo(SLAB.timeLimit - 60, 3);
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
    let ticks = 120;
    run(sim, 600, () => (ticks++, match(sim).phase === 'ended'));
    expect(ticks).toBe(300);
    expect(match(sim)).toMatchObject({ phase: 'ended', score: [2, 0], winner: Team.Corgis, objective: SLAB_TEXT.win[Team.Corgis], timeLeft: 0 });
  });

  it('tied at the horn: overtime until someone leads', async () => {
    const sim = await slabSim({ timeLimit: 2 });
    run(sim, 120);
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
    expect(ticks).toBe(60 + 120); // the horn's tick starts the overtime; then 120 ticks (2 s) of it
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
    // everybody back at a team spawn, shielded for 1 s
    for (const e of [c, k]) {
      expect(e.dead).toBe(false);
      const d = Math.min(...sim.worldData.spawns.filter((s) => s.team === e.team).map((s) => Math.hypot(s.x - e.pos.x, s.z - e.pos.z)));
      expect(d).toBeLessThan(1);
      expect(isInvulnerable(sim, e)).toBe(true);
    }
    run(sim, 60);
    expect(isInvulnerable(sim, c)).toBe(false);
  });

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
