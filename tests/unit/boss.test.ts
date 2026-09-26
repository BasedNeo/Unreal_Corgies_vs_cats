// B1 — the Vac-Tank boss: authoritative behaviour, fairness (telegraphs) and balance, headless.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Team, Species, EntityKind, EFlag, type TeamId, type ClassId } from '../../src/shared/types';
import type { GameEvent, MatchState } from '../../src/shared/protocol';
import { createWorldData, createFlatWorldData } from '../../src/shared/world/world-data';
import { Btn } from '../../src/shared/input';
import { WEAPONS } from '../../src/shared/content/weapons';
import {
  VAC_TANK, BossAttack, BOSS_ABILITY, BOSS_FLAG_PHASE2, MIN_TELEGRAPH, bossMaxHp, unpackBossFlags, bossContactPush,
} from '../../src/shared/content/bosses';
import { spawnBoss, forceBossAttack, skipBossIntro, countSquad } from '../../src/sim/boss';
import { applyDamage, kill, eyeHeight, capsuleOf } from '../../src/sim/combat';
import type { MatchConfigOverrides } from '../../src/sim/match';

const DEF = VAC_TANK;
type Ev = GameEvent & { t: number };

async function flatSim(seed = 3): Promise<Sim> {
  const sim = await Sim.create({ seed, world: { ...createFlatWorldData(seed), props: [] } });
  sim.step(); // Rapier query structures + nav grid
  sim.drainEvents();
  return sim;
}

function dummy(sim: Sim, x: number, z: number, team: TeamId = Team.Corgis, cls: ClassId = 'assault'): SimEntity {
  return sim.spawnCharacter({ team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `d${sim.entities.size}`, x, y: sim.worldData.height(x, z) + 0.02, z, yaw: 0 });
}

/** Step the sim, collecting events stamped with sim time, until `until` holds or `seconds` pass. */
function run(sim: Sim, seconds: number, out: Ev[] = [], until?: (evs: Ev[]) => boolean, each?: () => void): Ev[] {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    each?.();
    sim.step();
    for (const ev of sim.drainEvents()) out.push({ ...ev, t: sim.time } as Ev);
    if (until?.(out)) break;
  }
  return out;
}

/** A boss standing at the origin, intro skipped, ready to take orders. */
async function arena(seed = 3): Promise<{ sim: Sim; boss: SimEntity }> {
  const sim = await flatSim(seed);
  const boss = spawnBoss(sim, { x: 0, z: 0, yaw: 0 }, { drop: false, players: 1 });
  run(sim, 0.3);
  skipBossIntro(sim, boss);
  boss.boss!.readyAt = 1e9; // hold: attacks only when a test forces one
  sim.drainEvents();
  return { sim, boss };
}

/** Push the boss into phase 2 and let the phase shift play out (kittens removed so they don't interfere). */
function toPhase2(sim: Sim, boss: SimEntity): Ev[] {
  const h = boss.health!;
  applyDamage(sim, boss, h.hp - h.max * 0.45, { id: 999, team: Team.Corgis, weapon: -1 }, boss.pos.x, boss.pos.y + 1, boss.pos.z, false);
  const evs = run(sim, 6, [], () => boss.boss!.phase2 && boss.boss!.attack === BossAttack.None);
  for (const id of boss.boss!.kittens) sim.removeEntity(id);
  boss.boss!.kittens.length = 0;
  boss.boss!.readyAt = 1e9;
  return evs;
}

const firstBossHit = (evs: Ev[], boss: SimEntity) => evs.find((e) => e.e === 'hit' && e.src === boss.id) as (Ev & { e: 'hit' }) | undefined;
const abilityAt = (evs: Ev[], name: string) => evs.find((e) => e.e === 'ability' && e.ability === name) as (Ev & { e: 'ability' }) | undefined;

describe('Vac-Tank spawn', () => {
  it('is an EntityKind.Boss character with hp scaled by the squad, cls = BOSSES index, a drop-in intro', async () => {
    const sim = await flatSim();
    dummy(sim, 0, 20); dummy(sim, 3, 20); dummy(sim, -3, 20);
    expect(countSquad(sim, Team.Cats)).toBe(3);
    const boss = spawnBoss(sim, { x: 0, z: 0 });
    expect(boss.kind).toBe(EntityKind.Boss);
    expect(boss.health!.max).toBe(bossMaxHp(DEF, 3));
    expect(bossMaxHp(DEF, 1)).toBe(DEF.baseHp);
    expect(bossMaxHp(DEF, 2)).toBe(DEF.baseHp + DEF.hpPerExtraPlayer);
    expect(bossMaxHp(DEF, 4)).toBe(DEF.baseHp + 3 * DEF.hpPerExtraPlayer);
    expect(bossMaxHp(DEF, 4)).toBeGreaterThan(bossMaxHp(DEF, 2));
    expect(sim.toState(boss).cls).toBe(0);
    expect(unpackBossFlags(sim.toState(boss).flags).attack).toBe(BossAttack.Intro);
    // drop-in: falls from above and lands with a `land` event; invulnerable during the intro
    expect(boss.pos.y).toBeGreaterThan(DEF.dropHeight - 1);
    expect(applyDamage(sim, boss, 100, { id: 2, team: Team.Corgis, weapon: 0 }, 0, 1, 0, false)).toBe(0);
    const evs = run(sim, 2);
    expect(evs.some((e) => e.e === 'land' && e.id === boss.id)).toBe(true);
    expect(boss.pos.y).toBeLessThan(0.2);
    run(sim, DEF.intro);
    expect(unpackBossFlags(boss.flags).attack).not.toBe(BossAttack.Intro);
    expect(applyDamage(sim, boss, 100, { id: 2, team: Team.Corgis, weapon: 0 }, 0, 1, 0, false)).toBe(100);
  });

  it('pushes characters out of its hull (they never walk through the tank)', async () => {
    const { sim, boss } = await arena();
    const d = dummy(sim, 0.5, -1.2);
    const dir = { x: 0, z: 0 };
    const cap = capsuleOf(d);
    expect(bossContactPush(DEF, boss.pos.x, boss.pos.y, boss.pos.z, d.pos.x, d.pos.y, d.pos.z, cap.height, cap.r, dir)).toBeGreaterThan(0.5);
    run(sim, 0.2);
    expect(bossContactPush(DEF, boss.pos.x, boss.pos.y, boss.pos.z, d.pos.x, d.pos.y, d.pos.z, cap.height, cap.r, dir)).toBeLessThan(0.02);
    expect(Math.hypot(d.pos.x - boss.pos.x, d.pos.z - boss.pos.z)).toBeGreaterThan(2.4);
    expect(bossContactPush(DEF, 0, 0, 0, 1, 0, 0, 1.2, 0.36, dir)).toBeGreaterThan(0);
    expect(bossContactPush(DEF, 0, 0, 0, 1, 5.2, 0, 1.2, 0.36, dir)).toBe(0); // above the hull
  });
});

describe('phases', () => {
  it('switches to phase 2 at 50 %: lid pops, taunt, flag bit, faster attacks, kittens released', async () => {
    const { sim, boss } = await arena();
    const h = boss.health!;
    dummy(sim, 0, -40);
    applyDamage(sim, boss, h.max * 0.49, { id: 999, team: Team.Corgis, weapon: -1 }, 0, 1, 0, false);
    run(sim, 0.1);
    expect(boss.boss!.phase2).toBe(false); // 51 %
    applyDamage(sim, boss, h.max * 0.02, { id: 999, team: Team.Corgis, weapon: -1 }, 0, 1, 0, false);
    const evs = run(sim, 0.1);
    expect(boss.boss!.phase2).toBe(true);
    expect(boss.flags & BOSS_FLAG_PHASE2).toBeTruthy();
    expect(abilityAt(evs, BOSS_ABILITY.lidPop)).toBeTruthy();
    expect(evs.some((e) => e.e === 'bark' && e.id === boss.id)).toBe(true);
    expect(boss.char!.move.runSpeed).toBeCloseTo(DEF.move.speed * DEF.phase2.moveMult, 5);
    // kittens pop out of the rear hatch during the phase shift
    const more = run(sim, DEF.phase2.shiftTime + 0.2);
    const kittens = [...sim.entities.values()].filter((e) => e.kind === EntityKind.Bot && e.team === Team.Cats && e.ai?.arch === 'kitten');
    expect(kittens.length).toBe(DEF.kittens.count);
    for (const k of kittens) {
      expect(k.combat?.pve).toBe(true);
      expect(Math.hypot(k.pos.x - boss.pos.x, k.pos.z - boss.pos.z)).toBeLessThan(10);
    }
    expect(abilityAt(more, BOSS_ABILITY.kittens)).toBeTruthy();
    // phase 2 telegraphs are 1.3× faster (but never below the 0.8 s floor)
    forceBossAttack(boss, 'laser');
    run(sim, 0.1, [], () => boss.boss!.attack === BossAttack.Laser);
    expect(boss.boss!.stageLen).toBeCloseTo(Math.max(MIN_TELEGRAPH, DEF.laser.telegraph / DEF.phase2.speedup), 5);
  });
});

describe('telegraphs (fairness)', () => {
  const cases: { attack: 'laser' | 'mortar' | 'spin'; tele: string; dist: number }[] = [
    { attack: 'laser', tele: BOSS_ABILITY.laserPaint, dist: 15 },
    { attack: 'mortar', tele: BOSS_ABILITY.mortarWindup, dist: 16 },
    { attack: 'spin', tele: BOSS_ABILITY.spinWindup, dist: 4.2 },
  ];
  for (const phase of [1, 2]) {
    for (const c of cases) {
      it(`${c.attack} telegraphs ≥ 0.8 s before any damage (phase ${phase})`, async () => {
        const { sim, boss } = await arena();
        if (phase === 2) toPhase2(sim, boss);
        const d = dummy(sim, boss.pos.x, boss.pos.z - c.dist);
        run(sim, 0.05);
        forceBossAttack(boss, c.attack);
        const evs = run(sim, 6, [], (es) => !!firstBossHit(es, boss));
        const tele = abilityAt(evs, c.tele);
        const hit = firstBossHit(evs, boss);
        expect(tele, 'telegraph event').toBeTruthy();
        expect(hit, 'the attack lands on a target who stands still').toBeTruthy();
        expect(hit!.dst).toBe(d.id);
        expect(hit!.t - tele!.t).toBeGreaterThanOrEqual(MIN_TELEGRAPH);
      });
    }
  }
});

describe('Laser Pointer Sweep', () => {
  it('paints the ground toward the target, then sweeps: hits a target who stays, misses one who moved out', async () => {
    const { sim, boss } = await arena();
    const d = dummy(sim, 0, -15);
    run(sim, 0.05);
    forceBossAttack(boss, 'laser');
    const evs = run(sim, 3, [], (es) => !!firstBossHit(es, boss) || boss.boss!.stage === 3);
    const paint = abilityAt(evs, BOSS_ABILITY.laserPaint)!;
    const lock = abilityAt(evs, BOSS_ABILITY.laserSweep)!;
    // the dot started between the boss and the target and was locked at the target
    expect(Math.hypot(paint.x - d.pos.x, paint.z - d.pos.z)).toBeGreaterThan(2);
    expect(Math.hypot(lock.x - d.pos.x, lock.z - d.pos.z)).toBeLessThan(0.6);
    const hit = firstBossHit(evs, boss)!;
    expect(hit).toMatchObject({ dst: d.id, dmg: DEF.laser.damage });
    expect(evs.some((e) => e.e === 'fire' && e.id === boss.id && e.wpn === 2)).toBe(true); // beam segments for FX

    // second target: steps back out of the arc the moment the dot locks
    const { sim: sim2, boss: boss2 } = await arena();
    const d2 = dummy(sim2, 0, -15);
    run(sim2, 0.05);
    forceBossAttack(boss2, 'laser');
    const evs2 = run(sim2, 1.6, [], (es) => !!abilityAt(es, BOSS_ABILITY.laserSweep));
    expect(abilityAt(evs2, BOSS_ABILITY.laserSweep)).toBeTruthy();
    sim2.placeCharacter(d2, d2.pos.x, d2.pos.y, d2.pos.z - 2.5); // 2.5 m further away from the tank
    run(sim2, DEF.laser.sweep + 0.3, evs2);
    expect(firstBossHit(evs2, boss2)).toBeUndefined();
    expect(d2.health!.hp).toBe(d2.health!.max);
  });
});

describe('Hairball Mortar', () => {
  it('lands exactly on its warning circles (≥ 0.8 s after each appears) and explodes with falloff', async () => {
    const { sim, boss } = await arena();
    const a = dummy(sim, 0, -16);
    const near = dummy(sim, 0, 45);   // parked out of range until the volley is planned
    const far = dummy(sim, -50, 30);  // never in range
    run(sim, 0.05);
    forceBossAttack(boss, 'mortar');
    const evs: Ev[] = [];
    let moved = false;
    run(sim, 6, evs, () => boss.boss!.attack === BossAttack.None && evs.some((e) => e.e === 'explode'), () => {
      if (!moved && abilityAt(evs, BOSS_ABILITY.mortarShell)) {
        moved = true; // 2 m from the first landing point, toward the boss
        const s = abilityAt(evs, BOSS_ABILITY.mortarShell)!;
        sim.placeCharacter(near, s.x, sim.worldData.height(s.x, s.z + 2) + 0.02, s.z + 2);
      }
    });
    const circles = evs.filter((e) => e.e === 'ability' && e.ability === BOSS_ABILITY.mortarShell) as (Ev & { e: 'ability' })[];
    const booms = evs.filter((e) => e.e === 'explode') as (Ev & { e: 'explode' })[];
    expect(circles.length).toBe(DEF.mortar.count);
    expect(booms.length).toBe(DEF.mortar.count);
    for (const c of circles) {
      const b = booms.find((x) => Math.hypot(x.x - c.x, x.z - c.z) < 0.01);
      expect(b, 'explosion on its circle').toBeTruthy();
      expect(b!.t - c.t).toBeGreaterThanOrEqual(MIN_TELEGRAPH);
      expect(b!.r).toBeCloseTo(DEF.mortar.blast.explodeRadius, 5);
    }
    // the first circle is on the target (it stood still): centre damage > 2 m damage > 0; far away = 0
    expect(Math.hypot(circles[0].x - a.pos.x, circles[0].z - a.pos.z)).toBeLessThan(0.5);
    const dmgTo = (id: number) => evs.filter((e) => e.e === 'hit' && e.dst === id && e.src === boss.id).map((e) => (e as { dmg: number }).dmg);
    const centre = Math.max(...dmgTo(a.id));
    const side = Math.max(...dmgTo(near.id));
    expect(centre).toBeGreaterThan(side);
    expect(side).toBeGreaterThan(0);
    expect(centre).toBeLessThanOrEqual(DEF.mortar.blast.explodeDamage);
    expect(dmgTo(far.id).length).toBe(0);
    // hairballs are snapshot projectiles owned by the boss (the client renders them) and are gone after landing
    expect([...sim.entities.values()].some((e) => e.hairball)).toBe(false);
  });
});

describe('Brush Spin', () => {
  it('damages and knocks back everyone within 6 m, nobody beyond', async () => {
    const { sim, boss } = await arena();
    const inside = dummy(sim, 0, -4.5);
    const outside = dummy(sim, 0, 8.5);
    run(sim, 0.05);
    forceBossAttack(boss, 'spin');
    const evs = run(sim, 3, [], (es) => !!firstBossHit(es, boss));
    run(sim, 0.05, evs);
    const hit = firstBossHit(evs, boss)!;
    expect(hit).toMatchObject({ dst: inside.id, dmg: DEF.spin.damage });
    const away = (inside.vel.x * (inside.pos.x - boss.pos.x) + inside.vel.z * (inside.pos.z - boss.pos.z)) / Math.hypot(inside.pos.x - boss.pos.x, inside.pos.z - boss.pos.z);
    expect(away).toBeGreaterThan(5);
    expect(inside.vel.y > 0 || !inside.char!.grounded).toBe(true);
    run(sim, 1.2, evs);
    expect(evs.some((e) => e.e === 'hit' && e.dst === outside.id)).toBe(false);
  });
});

describe('weak point', () => {
  function shoot(sim: Sim, shooter: SimEntity, x: number, y: number, z: number): Ev[] {
    const ex = shooter.pos.x, ey = shooter.pos.y + eyeHeight(shooter), ez = shooter.pos.z;
    const yaw = Math.atan2(-(x - ex), -(z - ez)), pitch = Math.atan2(y - ey, Math.hypot(x - ex, z - ez));
    sim.setInput(shooter.id, { seq: sim.tick + 1, mx: 0, mz: 0, yaw, pitch, buttons: Btn.Fire | Btn.Aim, rt: 0 });
    const evs = run(sim, 1 / 60);
    sim.setInput(shooter.id, { seq: sim.tick + 2, mx: 0, mz: 0, yaw, pitch, buttons: Btn.Aim, rt: 0 });
    run(sim, 0.3, evs);
    return evs;
  }

  it('the pilot takes ×2 damage; the hull ×1; the exposed pilot is a bigger target in phase 2', async () => {
    const { sim, boss } = await arena();
    const shooter = dummy(sim, 0, -12);
    run(sim, 0.3);
    boss.boss!.readyAt = 1e9; // hold fire so nothing else changes the numbers
    const w = WEAPONS.squeaker_rifle;
    const hp0 = boss.health!.hp;
    const hull = shoot(sim, shooter, boss.pos.x, boss.pos.y + 1.6, boss.pos.z).find((e) => e.e === 'hit' && e.dst === boss.id) as Ev & { e: 'hit' };
    expect(hull).toMatchObject({ dmg: w.damage, crit: false });
    const pilot = shoot(sim, shooter, boss.pos.x, boss.pos.y + 4.1, boss.pos.z).find((e) => e.e === 'hit' && e.dst === boss.id) as Ev & { e: 'hit' };
    expect(pilot).toMatchObject({ dmg: w.damage * DEF.weak.mult, crit: true });
    expect(pilot.dmg / hull.dmg).toBe(2);
    expect(hp0 - boss.health!.hp).toBe(w.damage * 3);
    // chest height of the seated pilot: hull while the lid is on, weak point once it is off
    const chestP1 = shoot(sim, shooter, boss.pos.x, boss.pos.y + 3.2, boss.pos.z).find((e) => e.e === 'hit' && e.dst === boss.id) as Ev & { e: 'hit' };
    expect(chestP1.crit).toBe(false);
    toPhase2(sim, boss);
    boss.boss!.readyAt = 1e9;
    const chestP2 = shoot(sim, shooter, boss.pos.x, boss.pos.y + 3.2, boss.pos.z).find((e) => e.e === 'hit' && e.dst === boss.id) as Ev & { e: 'hit' };
    expect(chestP2).toMatchObject({ dmg: w.damage * DEF.weak.mult, crit: true });
    expect(boss.boss!.stats.weakHits).toBe(2);
  });
});

describe('defeat', () => {
  it('big explosion, pilot ejects, taunt, a score event, then the wreck is removed', async () => {
    const { sim, boss } = await arena();
    const hero = dummy(sim, 0, -14);
    kill(sim, boss, { id: hero.id, team: Team.Corgis, weapon: 0 });
    const evs = run(sim, 1);
    expect(evs.some((e) => e.e === 'death' && e.id === boss.id && e.by === hero.id)).toBe(true);
    const boom = evs.find((e) => e.e === 'explode') as Ev & { e: 'explode' };
    expect(boom.r).toBeGreaterThan(5);
    expect(abilityAt(evs, BOSS_ABILITY.eject)).toBeTruthy();
    expect(evs.some((e) => e.e === 'score' && e.reason === 'boss' && e.team === Team.Corgis && e.pts === DEF.score)).toBe(true);
    expect(unpackBossFlags(boss.flags).attack).toBe(BossAttack.Dying);
    expect(boss.flags & EFlag.Dead).toBeTruthy();
    run(sim, 5.5);
    expect(sim.entities.has(boss.id)).toBe(false);
  });
});

describe('skirmish finale (match hook)', () => {
  it('the boss wave spawns the Vac-Tank, holds the wave open, and its defeat wins the match', async () => {
    const cfg: MatchConfigOverrides = { skirmish: { warmup: 0.5, intermission: 0.5, endedHold: 1, spawnInterval: 0.1, waves: [{ counts: { grunt: 1 } }, { counts: {}, boss: 'vac_tank', label: 'FINAL WAVE' }] } };
    const sim = await Sim.create({ seed: 9, world: createWorldData(9) });
    sim.state.room = { mode: 'yard-skirmish' };
    sim.state.matchConfig = cfg;
    const s = sim.pickSpawn(Team.Corgis);
    const hero = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'hero', x: s.x, y: s.y, z: s.z, yaw: s.yaw });
    const match = () => sim.state.match as MatchState;
    const evs = run(sim, 4, [], () => match().wave === 1 && [...sim.entities.values()].some((e) => e.combat?.pve && !e.dead));
    for (const e of [...sim.entities.values()]) if (e.combat?.pve && !e.dead) kill(sim, e, { id: hero.id, team: Team.Corgis, weapon: 0 });
    run(sim, 3, evs, () => match().wave === 2);
    const boss = [...sim.entities.values()].find((e) => e.kind === EntityKind.Boss)!;
    expect(boss).toBeTruthy();
    expect(match().objective).toMatch(/FINAL WAVE/);
    run(sim, 4, evs);
    expect(match().phase).toBe('live'); // the boss holds the wave open
    kill(sim, boss, { id: hero.id, team: Team.Corgis, weapon: 0 });
    run(sim, 0.2, evs);
    expect(match()).toMatchObject({ phase: 'ended', winner: Team.Corgis });
    expect(evs.filter((e) => e.e === 'score' && e.reason === 'boss')).toHaveLength(1);
    run(sim, 1.3, evs); // restart clears the wreck
    expect(match().phase).toBe('warmup');
    expect([...sim.entities.values()].some((e) => e.kind === EntityKind.Boss)).toBe(false);
  });
});

/** The full set piece: L3's corgi bots (AI) vs the Vac-Tank on West Yard, as the skirmish finale. */
async function botFight(seed: number, bots: number, seconds: number) {
  const sim = await Sim.create({ seed, world: createWorldData(1) });
  sim.state.room = { mode: 'yard-skirmish' };
  sim.state.matchConfig = { skirmish: { warmup: 1, endedHold: 5, waves: [{ counts: {}, boss: 'vac_tank', label: 'FINAL WAVE' }] } } satisfies MatchConfigOverrides;
  const classes: ClassId[] = ['assault', 'infiltrator', 'overwatch', 'assault'];
  for (let i = 0; i < bots; i++) sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: Species.Corgi, cls: classes[i % classes.length], name: `Corgi ${i}` });
  let hash = 2166136261;
  const mix = (v: number) => { hash = Math.imul(hash ^ (Math.round(v * 1000) | 0), 16777619) >>> 0; };
  let boss: SimEntity | undefined;
  let bossTime = 0, events = 0;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    sim.step();
    for (const ev of sim.drainEvents()) { events++; mix(ev.e.length); if ('x' in ev) mix(ev.x); if ('dmg' in ev) mix(ev.dmg); }
    boss ??= [...sim.entities.values()].find((e) => e.kind === EntityKind.Boss);
    if (boss && !boss.dead) bossTime = sim.time;
    if ((sim.state.match as MatchState).phase === 'ended') break;
  }
  for (const e of sim.entities.values()) { mix(e.pos.x); mix(e.pos.z); if (!Number.isFinite(e.pos.x + e.pos.y + e.pos.z)) throw new Error(`non-finite ${e.name}`); }
  return { sim, boss: boss!, hash, match: sim.state.match as MatchState, bossTime, events };
}

describe('the set piece (headless)', () => {
  it('a squad of corgi bots (L3 AI) defeats the Vac-Tank in < 6 min of sim time with no errors', async () => {
    const { sim, boss, match, bossTime } = await botFight(1, 4, 6 * 60);
    expect(boss).toBeTruthy();
    expect(match).toMatchObject({ phase: 'ended', winner: Team.Corgis });
    expect(bossTime).toBeLessThan(6 * 60);
    const st = boss.boss!.stats;
    // every attack in the kit was used, and the squad found the weak point
    expect(st.attacks[BossAttack.Laser]).toBeGreaterThan(3);
    expect(st.attacks[BossAttack.Mortar]).toBeGreaterThan(3);
    expect(st.attacks[BossAttack.Kittens] + 1).toBeGreaterThan(1);
    expect(st.weakHits).toBeGreaterThan(10);
    expect(boss.boss!.phase2).toBe(true);
    console.log(`[boss fight] seed 1 · 4 bots · hp ${boss.health!.max} · defeated at ${bossTime.toFixed(1)} s · attacks laser ${st.attacks[1]} mortar ${st.attacks[2]} spin ${st.attacks[3]} kittens ${st.attacks[4]} · weak ${st.weakHits} / hull ${st.hullHits} · squad deaths by boss ${st.kills}`);
    void sim;
  }, 240_000);

  it('is deterministic: same seed ⇒ identical fight', async () => {
    const a = await botFight(7, 3, 40);
    const b = await botFight(7, 3, 40);
    expect(a.events).toBeGreaterThan(100);
    expect(b.hash).toBe(a.hash);
    expect(b.boss.health!.hp).toBe(a.boss.health!.hp);
    expect(b.boss.pos).toEqual(a.boss.pos);
  }, 120_000);
});
