// E1 — Madame Pointillé, the Siamese sniper elite (laser-pointer duel), headless on the real West Yard:
// perches + sightlines, fair telegraphs (≥ 0.8 s of dot tracking before every hit), cover, relocation,
// phase 2, the weak point, the hairball lob, a scripted-marksman duel inside 2–4 min, determinism.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Team, Species, EntityKind, EFlag, type ClassId } from '../../src/shared/types';
import type { GameEvent, MatchState } from '../../src/shared/protocol';
import { createWorldData } from '../../src/shared/world/world-data';
import { surfaceAt } from '../../src/shared/world/queries';
import { Btn } from '../../src/shared/input';
import { mulberry32 } from '../../src/shared/rng';
import { WEAPONS } from '../../src/shared/content/weapons';
import {
  MADAME_POINTILLE as DEF, BOSSES, BOSS_ABILITY, BOSS_FLAG_PHASE2, BossStage, MIN_TELEGRAPH, SNIPER_ABILITY, SniperAct,
  bossIndex, bossMaxHp, hopAt, sniperDot, sniperGlinting, sniperLens, sniperPainting, sniperRoute, sniperTrackTime, unpackBossFlags,
  type P3, type SniperHop,
} from '../../src/shared/content/bosses';
import { spawnBoss, skipBossIntro, findBoss, bossRushConfig } from '../../src/sim/boss';
import { applyDamage, eyeHeight, worldLineClear } from '../../src/sim/combat';
import type { MatchConfigOverrides } from '../../src/sim/match';

type Ev = GameEvent & { t: number };
const IDX = bossIndex('madame_pointille');

async function yard(seed = 1): Promise<Sim> {
  const sim = await Sim.create({ seed, world: createWorldData(1) });
  sim.step(); // Rapier query structures
  sim.drainEvents();
  return sim;
}

function run(sim: Sim, seconds: number, out: Ev[] = [], until?: (evs: Ev[]) => boolean, each?: () => void): Ev[] {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    each?.();
    sim.step();
    for (const ev of sim.drainEvents()) out.push({ ...ev, t: sim.time } as Ev);
    if (until?.(out)) break;
  }
  return out;
}

const roofPerch = (sim: Sim, id: string) => sim.worldData.perches!.find((p) => p.id === id)!;

function corgi(sim: Sim, x: number, y: number, z: number, cls: ClassId = 'overwatch'): SimEntity {
  return sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls, name: `c${sim.entities.size}`, x, y: y + 0.02, z, yaw: 0 });
}

/** The sniper on her first perch (the patio umbrella), intro skipped, no timed relocations. */
async function duelArena(seed = 1, perch = 0): Promise<{ sim: Sim; boss: SimEntity }> {
  const sim = await yard(seed);
  const boss = spawnBoss(sim, undefined, { boss: 'madame_pointille', players: 1, drop: false, perch });
  skipBossIntro(sim, boss);
  boss.sniper!.relocateAt = 1e9;
  sim.drainEvents();
  return { sim, boss };
}

const bossHits = (evs: Ev[], boss: SimEntity) => evs.filter((e) => e.e === 'hit' && e.src === boss.id) as (Ev & { e: 'hit' })[];
const abil = (evs: Ev[], name: string) => evs.filter((e) => e.e === 'ability' && e.ability === name) as (Ev & { e: 'ability' })[];

/** A roof point (feet) near (x, z) hidden from the boss's lens (chest and head), reachable in a straight line. */
function hiddenSpotNear(sim: Sim, boss: SimEntity, x: number, z: number, maxR = 6): P3 | null {
  const p = boss.sniper!.perches[boss.sniper!.perch];
  const lx = p.x, ly = p.y + DEF.lens.pivotY, lz = p.z;
  let best: P3 | null = null, bd = Infinity;
  for (let dx = -maxR; dx <= maxR; dx += 0.5) for (let dz = -maxR; dz <= maxR; dz += 0.5) {
    const d = Math.hypot(dx, dz);
    if (d > maxR || d >= bd) continue;
    const s = surfaceAt(sim.worldData, x + dx, z + dz);
    if (Math.abs(s.y - 7.2) > 0.05) continue;
    const q = { x: x + dx, y: s.y, z: z + dz };
    if (worldLineClear(sim, lx, ly, lz, q.x, q.y + 0.66, q.z) || worldLineClear(sim, lx, ly, lz, q.x, q.y + 1.1, q.z)) continue;
    best = q; bd = d;
  }
  return best;
}

// ------------------------------------------------------------------ the scripted marksman (human stand-in)

interface DuelResult { won: boolean; time: number; deaths: number; hpMax: number; shots: number; hits: number; minTracked: number; minPaintToHit: number; hash: number; marksmanHits: number; boss: SimEntity }

/**
 * A scripted Overwatch corgi on the garage roof, playing like a decent human with a sniper rifle: it sees what a
 * player sees (the dot, the beam, the glint, the hairball circles), reacts to the dot on itself after 0.25–0.6 s
 * by stepping back into the nearest cover (unless it is about to finish a charged shot: greed), peeks again once
 * the dot is gone, aims at her chest — or at the glinting device when she is painting someone else — with a
 * ~0.28° aim error, charges the Laser Longshot fully and fires. A death costs 15 s out of the fight (running back
 * from the corgi base and climbing the roof). Optional L3 corgi bots fight from wherever the AI takes them.
 */
async function duel(seed: number, bots = 0, seconds = 360): Promise<DuelResult> {
  const sim = await yard(seed);
  const W = sim.worldData;
  const rng = mulberry32(seed * 7919 + 13);
  const roof = W.perches!.filter((p) => p.id !== 'roof_gutter');
  const m = corgi(sim, roof[0].x, roof[0].y, roof[0].z);
  m.name = 'marksman';
  const classes: ClassId[] = ['assault', 'overwatch', 'infiltrator'];
  for (let i = 0; i < bots; i++) sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: Species.Corgi, cls: classes[i % 3], name: `bot${i}` });
  const boss = spawnBoss(sim, undefined, { boss: 'madame_pointille' });
  // roof standing points, and per sniper perch the firing spot with the closest cover (what a player learns)
  const pts: P3[] = [];
  for (let x = 67; x <= 95; x += 0.75) for (let z = -71; z <= -47; z += 0.75) {
    const s = surfaceAt(W, x, z);
    if (Math.abs(s.y - 7.2) < 0.05) pts.push({ x, y: s.y, z });
  }
  const plan = DEF.perches.map((p) => {
    const lx = p.x, ly = p.y + DEF.lens.pivotY, lz = p.z;
    const seen = (q: P3) => worldLineClear(sim, lx, ly, lz, q.x, q.y + 0.66, q.z) || worldLineClear(sim, lx, ly, lz, q.x, q.y + 1.1, q.z);
    const shoot = (q: P3) => worldLineClear(sim, q.x, q.y + 1.05, q.z, p.x, p.y + 1.0, p.z);
    const hidden = pts.filter((q) => !seen(q));
    let best: { f: P3; c: P3; d: number } | null = null;
    for (const f of pts) {
      if (!shoot(f)) continue;
      for (const c of hidden) {
        const d = Math.hypot(c.x - f.x, c.z - f.z);
        if (d < 1.2 || d > 9 || (best && d >= best.d)) continue;
        if (!worldLineClear(sim, f.x, f.y + 0.35, f.z, c.x, c.y + 0.35, c.z) || !worldLineClear(sim, f.x, f.y + 0.9, f.z, c.x, c.y + 0.9, c.z)) continue;
        best = { f, c, d };
      }
    }
    return best!;
  });
  let mode: 'fire' | 'hide' = 'fire';
  let paintedSince = -1, react = 0.35, clearSince = 0, charge = 0, deaths = 0, backAt = -1, marksmanHits = 0;
  let errYaw = 0, errPitch = 0;
  let circle: { x: number; z: number; until: number } | null = null;
  let hash = 2166136261, bossTime = 0;
  const mix = (v: number) => { hash = Math.imul(hash ^ (Math.round(v * 1000) | 0), 16777619) >>> 0; };
  const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rng(); return (s - 3) / Math.sqrt(0.5); };
  const newErr = () => { const sd = (0.28 * Math.PI) / 180; errYaw = gauss() * sd; errPitch = gauss() * sd; };
  newErr();
  const paintTimes: { t: number; x: number; y: number; z: number }[] = [];
  let minPaintToHit = Infinity;
  const dotP: P3 = { x: 0, y: 0, z: 0 }, lensP: P3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    const bs = sim.toState(boss);
    const f = unpackBossFlags(bs.flags);
    const pl = plan[boss.sniper!.perch];
    let buttons = 0, mx = 0, mz = 0, yaw = m.input.yaw, pitch = m.input.pitch;
    if (!m.dead && backAt < 0 && m.pos.y < 5) { backAt = sim.time + 15; sim.placeCharacter(m, 78, 0.25, -62); } // respawned: out of the fight (parked in the garage) while it runs back
    else if (!m.dead && backAt > 0 && sim.time >= backAt) { sim.placeCharacter(m, pl.f.x, pl.f.y + 0.02, pl.f.z); backAt = -1; mode = 'fire'; }
    if (!m.dead && backAt < 0) {
      const dot = sniperDot(DEF, bs, dotP);
      const painted = f.attack === SniperAct.Track && f.stage === BossStage.Telegraph && !!dot && Math.hypot(dot.x - m.pos.x, dot.y - (m.pos.y + 0.66), dot.z - m.pos.z) < 1.4;
      if (painted) { if (paintedSince < 0) { paintedSince = sim.time; react = 0.25 + rng() * 0.35; } } else paintedSince = -1;
      if (mode === 'fire' && painted && sim.time - paintedSince >= react && !(charge > 0.3 && charge < 0.62)) { mode = 'hide'; clearSince = sim.time; }
      if (mode === 'hide') {
        if (f.attack === SniperAct.Track && f.stage === BossStage.Telegraph) clearSince = sim.time;
        if (sim.time - clearSince > 0.5) mode = 'fire';
      }
      let goal = mode === 'hide' ? pl.c : pl.f;
      if (circle && sim.time < circle.until && Math.hypot(goal.x - circle.x, goal.z - circle.z) < DEF.lob.blast.explodeRadius + 0.6) goal = mode === 'hide' ? pl.f : pl.c;
      const gx = goal.x - m.pos.x, gz = goal.z - m.pos.z, gd = Math.hypot(gx, gz);
      const ex = m.pos.x, ey = m.pos.y + eyeHeight(m), ez = m.pos.z;
      let tx = bs.x, ty = bs.y + 0.95, tz = bs.z;
      if (sniperGlinting(DEF, f) && !painted) { const L = sniperLens(DEF, bs.x, bs.y, bs.z, bs.yaw, bs.pitch, lensP); tx = L.x; ty = L.y; tz = L.z; }
      yaw = Math.atan2(-(tx - ex), -(tz - ez)) + errYaw;
      pitch = Math.atan2(ty - ey, Math.hypot(tx - ex, tz - ez)) + errPitch;
      if (gd > 0.35) {
        const wx = gx / gd, wz = gz / gd, sy = Math.sin(yaw), cy = Math.cos(yaw);
        mz = wx * -sy + wz * -cy; mx = wx * cy + wz * -sy;
        if (mode === 'hide') buttons |= Btn.Sprint;
        charge = 0;
      } else if (mode === 'fire' && f.attack !== SniperAct.Leap && f.attack !== SniperAct.Intro && f.attack !== SniperAct.Dying) {
        if (worldLineClear(sim, ex, ey, ez, tx, ty, tz) && m.wpn!.reload === 0) {
          buttons |= Btn.Aim;
          charge += 1 / 60;
          if (charge < 0.62) buttons |= Btn.Fire; else { charge = 0; newErr(); }
        } else charge = 0;
      }
    }
    sim.setInput(m.id, { seq: sim.tick + 1, mx, mz, yaw, pitch, buttons, rt: 0 });
    sim.step();
    for (const ev of sim.drainEvents()) {
      mix(ev.e.length); if ('x' in ev) mix(ev.x); if ('dmg' in ev) mix(ev.dmg);
      if (ev.e === 'death' && ev.id === m.id) deaths++;
      if (ev.e === 'hit' && ev.src === m.id && ev.dst === boss.id) marksmanHits++;
      if (ev.e === 'ability' && ev.id === boss.id && ev.ability === SNIPER_ABILITY.paint) paintTimes.push({ t: sim.time, x: ev.x, y: ev.y, z: ev.z });
      if (ev.e === 'hit' && ev.src === boss.id && ev.dmg > 0 && paintTimes.length) minPaintToHit = Math.min(minPaintToHit, sim.time - paintTimes[paintTimes.length - 1].t);
      if (ev.e === 'ability' && ev.ability === BOSS_ABILITY.mortarShell) circle = { x: ev.x, z: ev.z, until: sim.time + 1.6 };
    }
    for (const e of sim.entities.values()) if (!Number.isFinite(e.pos.x + e.pos.y + e.pos.z)) throw new Error(`non-finite ${e.name}`);
    if (!boss.dead) bossTime = sim.time;
    if (boss.dead) break;
  }
  mix(boss.health!.hp); mix(m.pos.x); mix(m.pos.z);
  const log = boss.sniper!.stats.shotLog;
  return {
    won: boss.dead, time: bossTime, deaths, hpMax: boss.health!.max, shots: boss.sniper!.stats.shots, hits: boss.sniper!.stats.hits,
    minTracked: log.reduce((a, s) => Math.min(a, s.tracked), Infinity), minPaintToHit, hash, marksmanHits, boss,
  };
}

// ------------------------------------------------------------------ tests

describe('Madame Pointillé: spawn + data', () => {
  it('spawns through spawnBoss as an EntityKind.Boss on her first perch: cls = BOSSES index, squad-scaled hp, drop-in intro', async () => {
    const sim = await yard();
    corgi(sim, -40, 0, -70, 'assault');
    sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: Species.Corgi, cls: 'overwatch', name: 'bot' });
    const boss = spawnBoss(sim, undefined, { boss: 'madame_pointille' });
    expect(boss.kind).toBe(EntityKind.Boss);
    expect(BOSSES[IDX].id).toBe('madame_pointille');
    expect(sim.toState(boss).cls).toBe(IDX);
    expect(boss.health!.max).toBe(bossMaxHp(DEF, 1 + DEF.botWeight));
    expect(bossMaxHp(DEF, 1)).toBe(DEF.baseHp);
    expect(findBoss(sim, 'madame_pointille')).toBe(boss);
    // drops onto the umbrella, invulnerable through the intro
    expect(boss.pos.y).toBeGreaterThan(DEF.perches[0].y + 5);
    expect(applyDamage(sim, boss, 100, { id: 1, team: Team.Corgis, weapon: 0 }, 0, 0, 0, false)).toBe(0);
    const evs = run(sim, DEF.intro + 0.1);
    expect(evs.some((e) => e.e === 'land' && e.id === boss.id)).toBe(true);
    expect(boss.pos).toMatchObject({ x: DEF.perches[0].x, y: DEF.perches[0].y, z: DEF.perches[0].z });
    expect(unpackBossFlags(boss.flags).attack).not.toBe(SniperAct.Intro);
    expect(applyDamage(sim, boss, 100, { id: 1, team: Team.Corgis, weapon: 0 }, 0, 0, 0, false)).toBe(100);
    // the Vac-Tank is still index 0 and the default
    expect(BOSSES[0].id).toBe('vac_tank');
    expect(bossRushConfig('madame_pointille').skirmish.waves[0].boss).toBe('madame_pointille');
    expect(bossRushConfig('nope').skirmish.waves[0].boss).toBe('vac_tank');
  });

  it('perches: across the lawn from the garage Rooftops, each shootable from the roof perches and from the ground with cover nearby', async () => {
    const sim = await yard();
    const roof = sim.worldData.perches!;
    const report: string[] = [];
    for (const p of DEF.perches) {
      const chest = { x: p.x, y: p.y + 0.95, z: p.z }, head = { x: p.x, y: p.y + 1.55, z: p.z };
      // from the garage roof: a corgi's aim pivot (1.25 m) sees her body; her lens sees the corgi (both ways)
      let duel = 0;
      for (const r of roof) {
        const d = Math.hypot(r.x - p.x, r.z - p.z);
        const see = worldLineClear(sim, r.x, r.y + 1.25, r.z, chest.x, chest.y, chest.z) || worldLineClear(sim, r.x, r.y + 1.25, r.z, head.x, head.y, head.z);
        const seen = worldLineClear(sim, p.x, p.y + DEF.lens.pivotY, p.z, r.x, r.y + 0.66, r.z) || worldLineClear(sim, p.x, p.y + DEF.lens.pivotY, p.z, r.x, r.y + 1.1, r.z);
        if (see && seen && d > 35 && d < DEF.track.range) duel++;
      }
      // from the ground (12–60 m): open vantages that can shoot her, and how many have full cover within 8 m
      let vis = 0, covered = 0;
      const hidden = (x: number, y: number, z: number) => !worldLineClear(sim, p.x, p.y + DEF.lens.pivotY, p.z, x, y + 0.66, z) && !worldLineClear(sim, p.x, p.y + DEF.lens.pivotY, p.z, x, y + 1.1, z);
      const standY = (x: number, z: number) => { const s = surfaceAt(sim.worldData, x, z); return s.y - sim.worldData.height(x, z) < 0.3 ? s.y : null; };
      for (let gx = p.x - 60; gx <= p.x + 60; gx += 6) for (let gz = p.z - 60; gz <= p.z + 60; gz += 6) {
        const r = Math.hypot(gx - p.x, gz - p.z);
        if (r < 12 || r > 60 || Math.abs(gx) > 97 || Math.abs(gz) > 97) continue;
        const gy = standY(gx, gz);
        if (gy === null || !worldLineClear(sim, gx, gy + 1.25, gz, chest.x, chest.y, chest.z)) continue;
        vis++;
        let found = false;
        for (let a = 0; a < 16 && !found; a++) for (const rr of [2, 4, 6, 8]) {
          const x = gx + Math.cos((a / 16) * Math.PI * 2) * rr, z = gz + Math.sin((a / 16) * Math.PI * 2) * rr;
          const y = standY(x, z);
          if (y !== null && hidden(x, y, z)) { found = true; break; }
        }
        if (found) covered++;
      }
      report.push(`${p.id}: roof duels ${duel}/3 · ground vantages ${vis} (cover ≤ 8 m: ${covered})`);
      expect(duel, `${p.id} vs the garage roof perches`).toBeGreaterThanOrEqual(2);
      expect(vis, `${p.id} shootable from the ground`).toBeGreaterThanOrEqual(40);
      // the 30 m high house roof edge sees over most cover (its counter: range, the deck, the grill, the patio table)
      expect(covered / vis, `${p.id} ground cover options`).toBeGreaterThanOrEqual(0.25);
    }
    console.log(`[sniper perches] ${report.join(' | ')}`);
  }, 60_000);

  it('relocation routes: every hop is a clear parabolic leap (≤ maxLeap) that lands exactly on a perch', async () => {
    const sim = await yard();
    const P = DEF.perches;
    const route: SniperHop[] = [];
    const pos: P3 = { x: 0, y: 0, z: 0 }, prev: P3 = { x: 0, y: 0, z: 0 };
    for (let a = 0; a < P.length; a++) for (let b = 0; b < P.length; b++) {
      if (a === b) continue;
      sniperRoute(DEF, P, a, b, route);
      expect(route.length).toBeGreaterThanOrEqual(1);
      expect(route[route.length - 1]).toMatchObject({ x: P[b].x, y: P[b].y, z: P[b].z });
      let sx = P[a].x, sy = P[a].y, sz = P[a].z;
      for (const h of route) {
        expect(Math.hypot(h.x - sx, h.z - sz)).toBeLessThanOrEqual(DEF.relocate.maxLeap + 1e-6);
        expect(h.t).toBeGreaterThanOrEqual(0.8);
        prev.x = sx; prev.y = sy; prev.z = sz;
        for (let k = 1; k <= 24; k++) {
          hopAt(sx, sy, sz, h, (h.t * k) / 24, pos);
          // her capsule (mid-body and head) never passes through world geometry on the way
          for (const oy of [0.9, 1.5]) expect(worldLineClear(sim, prev.x, prev.y + oy, prev.z, pos.x, pos.y + oy, pos.z), `${P[a].id}→${P[b].id}`).toBe(true);
          prev.x = pos.x; prev.y = pos.y; prev.z = pos.z;
        }
        sx = h.x; sy = h.y; sz = h.z;
      }
    }
  });
});

describe('the laser-pointer telegraph (fairness)', () => {
  for (const phase of [1, 2]) {
    it(`the dot tracks a target ≥ ${phase === 1 ? DEF.track.time : DEF.track.timeP2} s (≥ 0.8 s) before every hit; the dot is on the target when it fires (phase ${phase})`, async () => {
      const { sim, boss } = await duelArena();
      if (phase === 2) {
        const h = boss.health!;
        applyDamage(sim, boss, h.hp - h.max * 0.45, { id: 999, team: Team.Corgis, weapon: -1 }, 0, 0, 0, false);
        run(sim, 8, [], () => boss.boss!.phase2 && boss.boss!.attack === SniperAct.None && boss.boss!.stage === BossStage.Idle);
        boss.sniper!.relocateAt = 1e9;
      }
      const rp = roofPerch(sim, 'roof_parapet');
      const d = corgi(sim, rp.x, rp.y, rp.z);
      const dotP: P3 = { x: 0, y: 0, z: 0 };
      let trackedFrames = 0, onTargetAtShot = 0, paintedCue = 0;
      const evs = run(sim, 12, [], (es) => bossHits(es, boss).length >= 2, () => {
        const s = sim.toState(boss);
        const f = unpackBossFlags(s.flags);
        if (f.attack === SniperAct.Track && f.stage === BossStage.Telegraph) {
          expect(s.ammo, 'beam on while tracking').toBeGreaterThan(0);
          trackedFrames++;
          const dot = sniperDot(DEF, s, dotP)!;
          if (f.progress > 0.9 && Math.hypot(dot.x - d.pos.x, dot.z - d.pos.z) < 0.5 && dot.y > d.pos.y && dot.y < d.pos.y + 1.3) onTargetAtShot++;
          if (sniperPainting(s, d.pos.x, d.pos.y, d.pos.z)) paintedCue++;
        }
      });
      const hits = bossHits(evs, boss);
      const paints = abil(evs, SNIPER_ABILITY.paint);
      expect(hits.length).toBeGreaterThanOrEqual(1);
      for (const h of hits) {
        const paint = paints.filter((p) => p.t <= h.t).pop()!;
        expect(paint, 'a paint precedes every hit').toBeTruthy();
        expect(h.t - paint.t).toBeGreaterThanOrEqual(MIN_TELEGRAPH);
        expect(h.t - paint.t).toBeGreaterThanOrEqual(sniperTrackTime(DEF, phase === 2) - 1e-6);
        expect(h.dst).toBe(d.id);
      }
      expect(abil(evs, SNIPER_ABILITY.glint).length).toBeGreaterThanOrEqual(1);
      expect(onTargetAtShot, 'the dot sits on the target before the shot').toBeGreaterThan(0);
      for (const s of boss.sniper!.stats.shotLog) expect(s.tracked).toBeGreaterThanOrEqual(MIN_TELEGRAPH - 1e-9);
      // one `fire` (laser_longshot) per shot for the FX/audio lanes
      expect(evs.filter((e) => e.e === 'fire' && e.id === boss.id && e.wpn === 2).length).toBe(boss.sniper!.stats.shots);
      expect(trackedFrames).toBeGreaterThan(40);
      expect(paintedCue, 'the HUD helper sees the dot on the target').toBeGreaterThan(20);
      if (phase === 2) expect(boss.flags & BOSS_FLAG_PHASE2).toBeTruthy();
    }, 60_000);
  }

  it('cover breaks the track: the lock is lost, no shot lands, and a re-acquire starts the full telegraph again', async () => {
    const { sim, boss } = await duelArena();
    const rp = roofPerch(sim, 'roof_parapet');
    const d = corgi(sim, rp.x, rp.y, rp.z);
    const hide = hiddenSpotNear(sim, boss, rp.x, rp.z)!;
    expect(hide, 'there is cover on the roof within 6 m').toBeTruthy();
    const evs = run(sim, 6, [], (es) => abil(es, SNIPER_ABILITY.paint).length > 0);
    const paint = abil(evs, SNIPER_ABILITY.paint)[0];
    expect(paint).toBeTruthy();
    run(sim, 0.6, evs); // painted for 0.6 s (< the 1.1 s track)...
    sim.placeCharacter(d, hide.x, hide.y + 0.02, hide.z); // ...then steps behind cover
    run(sim, 1.0, evs); // (not long enough to earn a hairball lob: that is tested below)
    expect(abil(evs, SNIPER_ABILITY.lost).length).toBeGreaterThanOrEqual(1);
    expect(bossHits(evs, boss)).toHaveLength(0);
    expect(d.health!.hp).toBe(d.health!.max);
    // back out in the open: a fresh paint, and the next hit comes ≥ the full track time after it
    sim.placeCharacter(d, rp.x, rp.y + 0.02, rp.z);
    const t0 = sim.time;
    run(sim, 6, evs, (es) => bossHits(es, boss).length > 0);
    const hit = bossHits(evs, boss)[0];
    const repaint = abil(evs, SNIPER_ABILITY.paint).filter((p) => p.t >= t0)[0];
    expect(hit && repaint).toBeTruthy();
    expect(hit.t - repaint.t).toBeGreaterThanOrEqual(DEF.track.time - 1e-6);
  }, 60_000);

  it('phase 1: a corgi sprinting across her line of fire outruns the dot — the shot misses', async () => {
    const { sim, boss } = await duelArena();
    const p = DEF.perches[0];
    // open lawn ~30 m out; once painted, sprint (9.6 m/s) straight across the line of fire
    const cx = 10, cz = -62;
    const los = { x: cx - p.x, z: cz - p.z }, l = Math.hypot(los.x, los.z);
    const perp = { x: los.z / l, z: -los.x / l };
    const d = corgi(sim, cx, sim.worldData.height(cx, cz), cz, 'assault');
    let t = -1;
    const evs = run(sim, 10, [], (es) => es.some((e) => e.e === 'fire' && e.id === boss.id), () => {
      if (t < 0 && boss.boss!.attack === SniperAct.Track) t = 0;
      if (t < 0) return;
      t += 1 / 60;
      const x = cx + perp.x * t * 9.6, z = cz + perp.z * t * 9.6;
      sim.placeCharacter(d, x, sim.worldData.height(x, z) + 0.02, z);
      d.vel.x = perp.x * 9.6; d.vel.z = perp.z * 9.6;
    });
    const shot = evs.find((e) => e.e === 'fire' && e.id === boss.id) as Ev & { e: 'fire' };
    expect(shot, 'she took the shot').toBeTruthy();
    expect(abil(evs, SNIPER_ABILITY.lost), 'it stayed in the open (no cover involved)').toHaveLength(0);
    expect(shot.hit).toBe(-1);
    expect(bossHits(evs, boss)).toHaveLength(0);
  }, 60_000);
});

describe('relocation + phase 2', () => {
  it('relocates on a timer and when hurt: a readable crouch, the destination announced, a leap along the route, a landing', async () => {
    const { sim, boss } = await duelArena();
    const s = boss.sniper!;
    const from = s.perch;
    s.relocateAt = sim.time; // timer
    const evs = run(sim, 8, [], (es) => es.some((e) => e.e === 'land' && e.id === boss.id));
    const leap = abil(evs, SNIPER_ABILITY.leap)[0];
    const land = evs.find((e) => e.e === 'land' && e.id === boss.id)!;
    expect(leap).toBeTruthy();
    expect(s.perch).not.toBe(from);
    const to = s.perches[s.perch];
    expect(leap).toMatchObject({ x: to.x, y: to.y, z: to.z });
    expect(land.t - leap.t).toBeGreaterThanOrEqual(DEF.relocate.windup);
    expect(boss.pos).toMatchObject({ x: to.x, y: to.y, z: to.z });
    // hurt: enough damage on one perch makes her move on
    run(sim, 1);
    const at = s.perch;
    s.relocateAt = 1e9;
    const evs2 = run(sim, 8, [], (es) => abil(es, SNIPER_ABILITY.leap).length > 0, () => {
      if (s.hurtHere < DEF.relocate.hurtFrac * boss.health!.max && !boss.dead) {
        applyDamage(sim, boss, 60, { id: 999, team: Team.Corgis, weapon: -1 }, boss.pos.x, boss.pos.y + 1, boss.pos.z, false);
        s.hurtHere += 60; // (scripted damage bypasses the hit regrade that tallies it)
      }
    });
    expect(abil(evs2, SNIPER_ABILITY.leap).length).toBe(1);
    expect(s.perch).not.toBe(at);
    expect(s.stats.leaps).toBe(2);
  }, 60_000);

  it('switches to phase 2 at 50 % (not at 51 %): beret off, taunt, flag bit, faster tracking, then a forced relocation', async () => {
    const { sim, boss } = await duelArena();
    const h = boss.health!;
    applyDamage(sim, boss, h.max * 0.49, { id: 999, team: Team.Corgis, weapon: -1 }, 0, 0, 0, false);
    run(sim, 0.1);
    expect(boss.boss!.phase2).toBe(false);
    applyDamage(sim, boss, h.max * 0.02, { id: 999, team: Team.Corgis, weapon: -1 }, 0, 0, 0, false);
    const evs = run(sim, 0.1);
    expect(boss.boss!.phase2).toBe(true);
    expect(boss.flags & BOSS_FLAG_PHASE2).toBeTruthy();
    expect(unpackBossFlags(boss.flags).attack).toBe(SniperAct.PhaseShift);
    expect(abil(evs, SNIPER_ABILITY.beretOff).length).toBe(1);
    expect(evs.some((e) => e.e === 'bark' && e.id === boss.id)).toBe(true);
    const more = run(sim, DEF.phase2.shiftTime + 3, [], (es) => abil(es, SNIPER_ABILITY.leap).length > 0);
    expect(abil(more, SNIPER_ABILITY.leap).length).toBe(1);
    expect(sniperTrackTime(DEF, true)).toBeLessThan(sniperTrackTime(DEF, false));
    expect(sniperTrackTime(DEF, true)).toBeGreaterThanOrEqual(MIN_TELEGRAPH);
    // phase 2 tracks with the faster clock
    boss.sniper!.relocateAt = 1e9;
    const rp = roofPerch(sim, 'roof_nest');
    corgi(sim, rp.x, rp.y, rp.z);
    run(sim, 10, [], () => boss.boss!.attack === SniperAct.Track);
    expect(boss.boss!.stageLen).toBeCloseTo(DEF.track.timeP2, 5);
  }, 60_000);
});

describe('weak point: the glinting laser device', () => {
  /** Fire one charged Laser Longshot shot from `shooter` at a world point (no lag compensation). */
  function shoot(sim: Sim, shooter: SimEntity, x: number, y: number, z: number, evs: Ev[]): void {
    const ex = shooter.pos.x, ey = shooter.pos.y + eyeHeight(shooter), ez = shooter.pos.z;
    const yaw = Math.atan2(-(x - ex), -(z - ez)), pitch = Math.atan2(y - ey, Math.hypot(x - ex, z - ez));
    for (let i = 0; i < 38; i++) { sim.setInput(shooter.id, { seq: sim.tick + 1, mx: 0, mz: 0, yaw, pitch, buttons: Btn.Fire | Btn.Aim, rt: 0 }); run(sim, 1 / 60, evs); }
    sim.setInput(shooter.id, { seq: sim.tick + 1, mx: 0, mz: 0, yaw, pitch, buttons: Btn.Aim, rt: 0 });
    run(sim, 1 / 60, evs);
  }

  it('a shot through the device crits ×2; during the glint it spoils her shot (stagger, no hit); body shots are ×1', async () => {
    const { sim, boss } = await duelArena();
    const rp = roofPerch(sim, 'roof_parapet');
    const d = corgi(sim, rp.x, rp.y, rp.z);
    const s = boss.sniper!;
    const base = WEAPONS.laser_longshot.damage;
    // wait for the glint on the corgi, then shoot the lens
    const evs = run(sim, 8, [], () => boss.boss!.attack === SniperAct.Track && s.trackT >= DEF.track.time - DEF.track.glint - 0.62 + 0.02);
    expect(boss.boss!.attack).toBe(SniperAct.Track);
    const L = sniperLens(DEF, boss.pos.x, boss.pos.y, boss.pos.z, s.aimYaw, s.aimPitch, { x: 0, y: 0, z: 0 });
    shoot(sim, d, L.x, L.y, L.z, evs);
    const devHit = evs.find((e) => e.e === 'hit' && e.src === d.id && e.dst === boss.id) as Ev & { e: 'hit' };
    expect(devHit, 'the shot hit her').toBeTruthy();
    expect(devHit).toMatchObject({ dmg: base * DEF.weak.mult, crit: true });
    expect(s.stats.deviceHits).toBe(1);
    expect(abil(evs, SNIPER_ABILITY.spoiled).length).toBe(1);
    expect(unpackBossFlags(boss.flags).attack).toBe(SniperAct.Stagger);
    run(sim, DEF.stagger, evs);
    expect(bossHits(evs, boss), 'the spoiled shot never fired').toHaveLength(0);
    expect(s.stats.spoiled).toBe(1);
    // a body shot when she is not aiming at the shooter: ×1, no crit
    s.hurtHere = 0;
    boss.boss!.readyAt = 1e9;
    s.lastLock = -1; // no one to glare at...
    s.aimYaw += Math.PI / 2; // ...and looking away: the device is off to the side
    shoot(sim, d, boss.pos.x, boss.pos.y + 0.7, boss.pos.z, evs);
    const body = evs.filter((e) => e.e === 'hit' && e.src === d.id && e.dst === boss.id).pop() as Ev & { e: 'hit' };
    expect(body).toMatchObject({ dmg: base, crit: false });
  }, 60_000);
});

describe('hairball lob (flushes a target out of cover)', () => {
  it('a target that hid gets a hairball at its hiding spot: the circle is up ≥ 0.8 s and the shell lands exactly on it', async () => {
    const { sim, boss } = await duelArena();
    const rp = roofPerch(sim, 'roof_parapet');
    const d = corgi(sim, rp.x, rp.y, rp.z);
    const evs = run(sim, 6, [], (es) => abil(es, SNIPER_ABILITY.paint).length > 0);
    run(sim, 0.5, evs);
    // hide right where it stands: the lob targets the last seen spot
    const hide = hiddenSpotNear(sim, boss, d.pos.x, d.pos.z)!;
    sim.placeCharacter(d, hide.x, hide.y + 0.02, hide.z);
    run(sim, 8, evs, (es) => es.some((e) => e.e === 'explode'));
    const wind = abil(evs, BOSS_ABILITY.mortarWindup)[0];
    const circles = abil(evs, BOSS_ABILITY.mortarShell);
    const boom = evs.find((e) => e.e === 'explode') as Ev & { e: 'explode' };
    expect(wind && circles.length && boom).toBeTruthy();
    expect(Math.hypot(circles[0].x - rp.x, circles[0].z - rp.z)).toBeLessThan(1.5); // where it was last seen
    expect(Math.hypot(boom.x - circles[0].x, boom.z - circles[0].z)).toBeLessThan(0.01);
    expect(boom.t - circles[0].t).toBeGreaterThanOrEqual(MIN_TELEGRAPH);
    expect(boom.r).toBeCloseTo(DEF.lob.blast.explodeRadius, 5);
    expect(boss.sniper!.stats.lobs).toBe(1);
  }, 60_000);
});

describe('the duel (headless, West Yard)', () => {
  it('one scripted Overwatch marksman on the garage roof defeats her within 2–4 min; every shot she fired was tracked ≥ 0.8 s', async () => {
    // (the SNIPER_SWEEP balance sweep below covers seeds 1–8: 125–242 s, median ~208 s)
    for (const seed of [1, 3, 4]) {
      const r = await duel(seed, 0);
      console.log(`[sniper duel] seed ${seed} · 1 marksman · hp ${r.hpMax} · defeated at ${r.time.toFixed(1)} s · marksman deaths ${r.deaths} · her shots ${r.shots} (hits ${r.hits}) · marksman hits ${r.marksmanHits} · leaps ${r.boss.sniper!.stats.leaps} · lobs ${r.boss.sniper!.stats.lobs} · spoiled ${r.boss.sniper!.stats.spoiled} · min tracked ${r.minTracked.toFixed(2)} s · min paint→hit ${r.minPaintToHit.toFixed(2)} s`);
      expect(r.won).toBe(true);
      expect(r.time).toBeGreaterThanOrEqual(120);
      expect(r.time).toBeLessThanOrEqual(240);
      expect(r.shots).toBeGreaterThan(0);
      expect(r.deaths, 'a real threat: the marksman goes down now and then').toBeGreaterThan(0);
      expect(r.minTracked).toBeGreaterThanOrEqual(MIN_TELEGRAPH);
      expect(r.minPaintToHit).toBeGreaterThanOrEqual(MIN_TELEGRAPH);
      expect(r.boss.boss!.phase2).toBe(true);
    }
  }, 240_000);

  it('faster with a squad: the marksman + 3 L3 corgi bots win in well under the solo time', async () => {
    const r = await duel(1, 3);
    console.log(`[sniper squad] seed 1 · marksman + 3 bots · hp ${r.hpMax} · defeated at ${r.time.toFixed(1)} s · her shots ${r.shots} · min tracked ${r.minTracked.toFixed(2)} s`);
    expect(r.won).toBe(true);
    expect(r.time).toBeLessThan(120);
    expect(r.minTracked).toBeGreaterThanOrEqual(MIN_TELEGRAPH);
  }, 240_000);

  it('is deterministic: same seed ⇒ identical fight', async () => {
    const a = await duel(5, 1, 45);
    const b = await duel(5, 1, 45);
    expect(b.hash).toBe(a.hash);
    expect(b.boss.health!.hp).toBe(a.boss.health!.hp);
    expect(b.boss.pos).toEqual(a.boss.pos);
  }, 240_000);
});

// Balance sweep (not part of the gate): SNIPER_SWEEP=1 npx vitest run tests/unit/boss-sniper -t sweep
describe.runIf(process.env.SNIPER_SWEEP)('balance sweep', () => {
  it('sweep: solo marksman and squad over seeds 1–8', async () => {
    const rows: string[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const r = await duel(seed, Number(process.env.SNIPER_BOTS ?? 0));
      rows.push(`seed ${seed}: ${r.won ? 'won' : 'LOST'} ${r.time.toFixed(1)} s · deaths ${r.deaths} · her shots ${r.shots} · marksman hits ${r.marksmanHits} · leaps ${r.boss.sniper!.stats.leaps} · lobs ${r.boss.sniper!.stats.lobs} · spoiled ${r.boss.sniper!.stats.spoiled}`);
    }
    console.log(`[sniper sweep] bots ${process.env.SNIPER_BOTS ?? 0}\n${rows.join('\n')}`);
  }, 900_000);
});

describe('match hook', () => {
  it('a skirmish boss wave with the sniper holds the wave open and her defeat wins the match', async () => {
    const cfg: MatchConfigOverrides = { skirmish: { warmup: 0.5, intermission: 0.5, endedHold: 1, waves: [{ counts: {}, boss: 'madame_pointille', label: 'BOSS' }] } };
    const sim = await Sim.create({ seed: 4, world: createWorldData(1) });
    sim.state.room = { mode: 'yard-skirmish' };
    sim.state.matchConfig = cfg;
    const hero = corgi(sim, -40, 0, -70, 'assault');
    const match = () => sim.state.match as MatchState;
    const evs = run(sim, 3, [], () => [...sim.entities.values()].some((e) => e.kind === EntityKind.Boss));
    const boss = findBoss(sim, 'madame_pointille')!;
    expect(boss).toBeTruthy();
    run(sim, 3, evs);
    expect(match().phase).toBe('live');
    boss.health!.hp = 1;
    applyDamage(sim, boss, 5, { id: hero.id, team: Team.Corgis, weapon: 0 }, boss.pos.x, boss.pos.y + 1, boss.pos.z, false);
    run(sim, 0.3, evs);
    expect(match()).toMatchObject({ phase: 'ended', winner: Team.Corgis });
    expect(evs.filter((e) => e.e === 'score' && e.reason === 'boss')).toHaveLength(1);
    // she tumbles off her perch (corpse physics) and is removed after the defeat beat
    run(sim, 1, evs);
    expect(boss.pos.y).toBeLessThan(DEF.perches[0].y - 1);
    expect(boss.flags & EFlag.Dead).toBeTruthy();
  }, 60_000);
});
