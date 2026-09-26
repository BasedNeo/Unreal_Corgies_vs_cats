import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Team, Species, EntityKind, EFlag, type TeamId } from '../../src/shared/types';
import type { GameEvent, MatchState } from '../../src/shared/protocol';
import { createWorldData } from '../../src/shared/world/world-data';
import { Room } from '../../src/host/room';
import { kill, applyDamage } from '../../src/sim/combat';
import type { MatchConfigOverrides } from '../../src/sim/match';

async function matchSim(mode: string, cfg: MatchConfigOverrides, seed = 9): Promise<Sim> {
  const sim = await Sim.create({ seed, world: createWorldData(seed) });
  sim.state.room = { mode }; // exactly what Room does
  sim.state.matchConfig = cfg;
  return sim;
}

function dummy(sim: Sim, team: TeamId, name = 'p'): SimEntity {
  const s = sim.pickSpawn(team);
  return sim.spawnCharacter({ team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'assault', name, x: s.x, y: s.y, z: s.z, yaw: s.yaw });
}

const match = (sim: Sim) => sim.state.match as MatchState;

function run(sim: Sim, seconds: number, until?: () => boolean): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    sim.step();
    out.push(...sim.drainEvents());
    if (until?.()) break;
  }
  return out;
}

const cats = (sim: Sim) => [...sim.entities.values()].filter((e) => e.char && e.team === Team.Cats);
const liveCats = (sim: Sim) => cats(sim).filter((e) => !e.dead);

describe('yard-skirmish', () => {
  const cfg: MatchConfigOverrides = {
    skirmish: {
      warmup: 1, intermission: 1, endedHold: 2, spawnInterval: 0.2, spawnBatch: 4, wipeLives: 0,
      waves: [{ counts: { grunt: 2 } }, { counts: { grunt: 1, kitten: 2 } }, { counts: { brute: 1, sniper: 1 }, label: 'FINAL WAVE' }],
    },
  };

  it('warms up, spawns escalating waves of cats, advances on clears and ends in victory, then restarts', async () => {
    const sim = await matchSim('yard-skirmish', cfg);
    const hero = dummy(sim, Team.Corgis, 'hero');
    run(sim, 0.2);
    expect(match(sim)).toMatchObject({ mode: 'yard-skirmish', phase: 'warmup', wave: 0 });
    // no damage during warmup
    expect(applyDamage(sim, hero, 10, { id: 99, team: Team.Cats, weapon: 0 }, 0, 0, 0, false)).toBe(0);
    const events: GameEvent[] = [];
    for (let wave = 1; wave <= 3; wave++) {
      events.push(...run(sim, 5, () => match(sim).wave === wave && match(sim).phase === 'live' && liveCats(sim).length > 0 && (sim.state.matchRt as { queue: unknown[] }).queue.length === 0));
      expect(match(sim).wave).toBe(wave);
      expect(match(sim).objective).toMatch(wave === 3 ? /FINAL WAVE/ : new RegExp(`Wave ${wave}/3`));
      const wcats = liveCats(sim);
      expect(wcats.length).toBeGreaterThan(0);
      for (const c of wcats) {
        expect(c.kind).toBe(EntityKind.Bot);
        expect(c.combat?.pve).toBe(true);
        expect(c.ai).toBeTruthy();
      }
      if (wave === 3) {
        const brute = wcats.find((c) => c.ai!.arch === 'brute');
        expect(brute?.health?.max).toBe(320);
      }
      for (const c of wcats) kill(sim, c, { id: hero.id, team: Team.Corgis, weapon: 0 });
      events.push(...run(sim, 0.1));
    }
    expect(match(sim)).toMatchObject({ phase: 'ended', winner: Team.Corgis });
    expect(match(sim).objective).toMatch(/secured/i);
    const kills = 2 + 3 + 2;
    expect(match(sim).score[Team.Corgis]).toBe(kills + 3 * 5); // kills + wave bonuses
    expect(events.filter((e) => e.e === 'score' && e.reason === 'kill').length).toBe(kills);
    expect(events.filter((e) => e.e === 'score' && e.reason === 'wave').length).toBe(3);
    // dead wave cats are cleaned up; then the match restarts from warmup
    run(sim, 2.2);
    expect(match(sim)).toMatchObject({ phase: 'warmup', wave: 0, score: [0, 0], winner: -1 });
    expect(cats(sim).length).toBe(0);
    expect(hero.dead).toBe(false);
  });

  it('is lost when the whole squad is down at once (beyond the forgiven wipes)', async () => {
    const sim = await matchSim('yard-skirmish', { skirmish: { ...cfg.skirmish, wipeLives: 1 } });
    const a = dummy(sim, Team.Corgis, 'a'), b = dummy(sim, Team.Corgis, 'b');
    run(sim, 3, () => match(sim).phase === 'live' && liveCats(sim).length > 0);
    const cat = liveCats(sim)[0];
    const byCat = { id: cat.id, team: Team.Cats as TeamId, weapon: 0 };
    kill(sim, a, byCat);
    run(sim, 0.1);
    expect(match(sim).phase).toBe('live'); // one corgi still up
    kill(sim, b, byCat);
    run(sim, 0.1);
    expect(match(sim).phase).toBe('live'); // first wipe is forgiven
    expect(match(sim).objective).toMatch(/Squad down/);
    expect(match(sim).score[Team.Cats]).toBe(2);
    run(sim, 3.2); // both respawn
    expect(a.dead || b.dead).toBe(false);
    kill(sim, a, byCat);
    kill(sim, b, byCat);
    run(sim, 0.1);
    expect(match(sim)).toMatchObject({ phase: 'ended', winner: Team.Cats });
  });

  it('room-slot cats fight in waves and stay down until the next wave', async () => {
    const sim = await matchSim('yard-skirmish', cfg);
    const hero = dummy(sim, Team.Corgis);
    const roomCat = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, cls: 'assault', name: 'Cat 1' });
    run(sim, 3, () => match(sim).phase === 'live' && (sim.state.matchRt as { queue: unknown[] }).queue.length === 0 && liveCats(sim).length >= 2);
    // the room cat counts toward the wave: 2 grunts planned, 1 spawned + the room cat
    expect(liveCats(sim).filter((c) => c.combat?.pve).length).toBe(1);
    expect(match(sim).objective).toMatch(/2 cats left/);
    kill(sim, roomCat, { id: hero.id, team: Team.Corgis, weapon: 0 });
    run(sim, 4);
    expect(roomCat.dead).toBe(true); // no mid-wave respawn for cats
    for (const c of liveCats(sim)) kill(sim, c, { id: hero.id, team: Team.Corgis, weapon: 0 });
    run(sim, 1.5, () => match(sim).wave === 2);
    expect(match(sim).wave).toBe(2);
    expect(roomCat.dead).toBe(false);
  });
});

describe('team-deathmatch', () => {
  it('ends at the kill limit, shows the winner, then restarts with reset scores', async () => {
    const sim = await matchSim('team-deathmatch', { tdm: { warmup: 0.5, killLimit: 3, timeLimit: 60, endedHold: 1 } });
    const c = dummy(sim, Team.Corgis, 'c');
    const k = [dummy(sim, Team.Cats, 'k1'), dummy(sim, Team.Cats, 'k2'), dummy(sim, Team.Cats, 'k3')];
    run(sim, 0.2);
    expect(match(sim)).toMatchObject({ mode: 'team-deathmatch', phase: 'warmup' });
    run(sim, 0.4);
    expect(match(sim).phase).toBe('live');
    expect(match(sim).timeLeft).toBeGreaterThan(59);
    const events: GameEvent[] = [];
    for (const v of k) { kill(sim, v, { id: c.id, team: Team.Corgis, weapon: 0 }); events.push(...run(sim, 0.05)); }
    expect(match(sim)).toMatchObject({ phase: 'ended', winner: Team.Corgis, score: [3, 0] });
    expect(match(sim).objective).toMatch(/Corgis win 3–0/);
    expect(events.filter((e) => e.e === 'score' && e.reason === 'kill').length).toBe(3);
    // combat is frozen while the result shows
    expect(applyDamage(sim, c, 10, { id: k[0].id, team: Team.Cats, weapon: 0 }, 0, 0, 0, false)).toBe(0);
    const reset = run(sim, 1.1);
    expect(match(sim)).toMatchObject({ phase: 'warmup', score: [0, 0], winner: -1 });
    expect(reset.filter((e) => e.e === 'score' && e.reason === 'reset').length).toBe(2);
    for (const e of [c, ...k]) {
      expect(e.dead).toBe(false);
      expect(e.health!.hp).toBe(e.health!.max);
      expect(e.flags & EFlag.Invulnerable).toBeTruthy();
    }
  });

  it('ends on the time limit with the higher score (or a draw)', async () => {
    const sim = await matchSim('team-deathmatch', { tdm: { warmup: 0.2, killLimit: 30, timeLimit: 1, endedHold: 5 } });
    const c = dummy(sim, Team.Corgis), k = dummy(sim, Team.Cats);
    run(sim, 0.3);
    kill(sim, c, { id: k.id, team: Team.Cats, weapon: 0 });
    run(sim, 1.2);
    expect(match(sim)).toMatchObject({ phase: 'ended', winner: Team.Cats, score: [0, 1] });
    const sim2 = await matchSim('team-deathmatch', { tdm: { warmup: 0.2, killLimit: 30, timeLimit: 1, endedHold: 5 } });
    dummy(sim2, Team.Corgis); dummy(sim2, Team.Cats);
    run(sim2, 1.5);
    expect(match(sim2)).toMatchObject({ phase: 'ended', winner: -1 });
    expect(match(sim2).objective).toMatch(/Draw/);
  });

  it('a Room of bots plays a live match: kills credit the roster and the team score', async () => {
    const sim = await Sim.create({ seed: 3, world: createWorldData(3) });
    const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [3, 3] });
    sim.state.matchConfig = { tdm: { warmup: 1 } };
    for (let i = 0; i < 60 * 45; i++) room.tick();
    const m = room.match;
    expect(m.phase === 'live' || m.phase === 'ended').toBe(true);
    const kills = [...room.players.values()].reduce((s, p) => s + p.kills, 0);
    expect(kills).toBeGreaterThan(0);
    expect(m.score[0] + m.score[1]).toBe(kills);
  }, 90000); // 45 s of a live 6-bot room: ~4 s alone, but the whole suite on a loaded shared box has hit 30 s
});
