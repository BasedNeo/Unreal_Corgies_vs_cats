// W9 L3 (M5) on The Lot: bots climb and bases stand where Base Assault can use them.
//   - WorldData.climbRoutes (the gangway, both scaffold ramps, the nest ramp, the pallet stair): every standing point
//     stands on its surface with a clear body; N1's buildLinkSet turns each into a climb + a descent and seeds a deck at
//     its top (the container roof, the scaffold deck, the crow's nest, a pipe crown); every perch is on a deck a climb
//     reaches (autoPerch covers all four).
//   - N1's per-profile validation: every route link lands for corgis AND cats, all six kits; the validated legs replay in
//     a real Sim (the real stepCharacter, world effects, physics step); Overwatch bots told to hold each perch get there
//     from their base.
//   - WorldData.bases: a flag and a ball stand per team, on open floor in its own base, point-symmetric; G4a's Base
//     Assault (baseAssaultSpots) uses them as given.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem, killPlaneSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { navGridFor, nearestWalkable, cellX, cellZ } from '../../src/sim/ai/nav';
import { type NavLinkSet, type LegOut, legStep, locate, navLinksFor, newLegRun, profileLinks, canReach } from '../../src/sim/ai/nav-links';
import { ensureBrain, holdPerch } from '../../src/sim/ai/brain';
import { moveStatsFor } from '../../src/shared/content/classes';
import { nearestPropDist, occupiedAt, surfaceAt, waterAt } from '../../src/shared/world/queries';
import { baseAssaultSpots } from '../../src/sim/match/base-assault';
import { CLASS_IDS, EntityKind, Species, Team, type ClassId, type SpeciesId, type TeamId } from '../../src/shared/types';

const PROFILES: [SpeciesId, ClassId][] = [];
for (const sp of [Species.Corgi, Species.Cat] as SpeciesId[]) for (const cls of CLASS_IDS) PROFILES.push([sp, cls]);
const who = (sp: SpeciesId, cls: string) => `${sp === Species.Cat ? 'cat' : 'corgi'} ${cls}`;

let sim: Sim;
let set: NavLinkSet;
beforeAll(async () => {
  sim = await Sim.create({ seed: 1, map: 'the_lot' });
  sim.step();
  sim.step();
  set = navLinksFor(sim)!;
}, 120_000);
afterAll(() => sim.dispose());

describe('The Lot: climb routes -> N1 decks and links', () => {
  it('every route point stands on its surface with room for a character', () => {
    const d = sim.worldData;
    expect(d.climbRoutes?.map((r) => r.name)).toEqual(['gangway', 'scaffold_west', 'scaffold_east', 'pallet_stair']);
    for (const r of d.climbRoutes!) {
      for (const [x, y, z] of r.pts) {
        expect(Math.abs(surfaceAt(d, x, z, y + 0.5).y - y), `${r.name} ${x},${y},${z}`).toBeLessThan(0.05);
        for (const dy of [0.3, 0.8, 1.2]) expect(occupiedAt(d, x, y + dy, z), `${r.name} ${x},${y},${z} +${dy}`).toBe(false);
      }
    }
  });

  it('builds a climb and a descent per route, a deck at every top, and every perch on a deck a climb reaches', () => {
    expect(set).toBeTruthy();
    const names = set.links.map((l) => l.name);
    for (const r of sim.worldData.climbRoutes!) for (const k of ['climb', 'descent']) expect(names, `${r.name} ${k}`).toContain(`${r.name} ${k}`);
    const g0 = navGridFor(sim);
    for (const p of sim.worldData.perches!) {
      const at = locate(set, g0, p.x, p.y, p.z, { grid: -1, cell: -1 });
      expect(at.grid, p.id).toBeGreaterThan(0);
      expect(set.links.some((l) => l.kind === 'climb' && l.toGrid === at.grid), `${p.id}: a climb reaches its deck`).toBe(true);
    }
    // every route starts on the ground; the crow's nest is on the scaffold deck's own grid (its ramp floods into it)
    for (const r of sim.worldData.climbRoutes!) expect(set.links.find((l) => l.name === `${r.name} climb`)!.fromGrid, r.name).toBe(0);
    const deck = set.links.find((l) => l.name === 'scaffold_west climb')!.toGrid;
    const nest = sim.worldData.perches!.find((p) => p.id === 'lot_scaffold_nest')!;
    expect(locate(set, g0, nest.x, nest.y, nest.z, { grid: -1, cell: -1 }).grid).toBe(deck);
    console.log(`[l3-nav] decks ${set.decks.map((dk) => `${dk.walkable} cells @${dk.ground[dk.walk.indexOf(1)].toFixed(1)} m`).join(', ')} · links ${set.links.length} · build ${set.buildMs.toFixed(0)} ms`);
  });

  it('every route link validates for corgis and cats, all six kits; most drops land', () => {
    const fails: string[] = [];
    for (const [sp, cls] of PROFILES) {
      const p = profileLinks(sim, set, moveStatsFor(sp, cls));
      for (const [i, l] of set.links.entries()) if (!p.params[i] && (l.kind === 'climb' || l.kind === 'descend')) fails.push(`${who(sp, cls)}: ${l.name}`);
      const drops = set.links.filter((l) => l.kind === 'drop').length, ok = p.params.filter((v, i) => v && set.links[i].kind === 'drop').length;
      expect(ok, `${who(sp, cls)} drops`).toBeGreaterThanOrEqual(Math.ceil(drops * 0.6));
      console.log(`[l3-nav] ${who(sp, cls)}: ${p.params.filter(Boolean).length}/${p.params.length} links (${ok}/${drops} drops), ${p.ticks} ticks, ${p.ms.toFixed(0)} ms`);
    }
    expect(fails).toEqual([]);
  }, 240_000);

  it('every validated route leg lands in a real Sim (corgi breacher, cat assault)', async () => {
    for (const [sp, cls] of [[Species.Corgi, 'breacher'], [Species.Cat, 'assault']] as [SpeciesId, ClassId][]) {
      const prof = profileLinks(sim, set, moveStatsFor(sp, cls));
      const real = await Sim.create({ seed: 1, map: 'the_lot', systems: [movementSystem, ...worldSystems(), physicsStepSystem, killPlaneSystem] });
      real.step();
      const runs = set.links.map((l, i) => ({
        l, params: prof.params[i], leg: 0, run: newLegRun(), failed: false,
        e: real.spawnCharacter({ team: sp === Species.Cat ? Team.Cats : Team.Corgis, species: sp, cls, name: l.name, x: l.from.x, y: l.from.y + 0.05, z: l.from.z, yaw: 0 }),
      })).filter((r) => r.params && r.l.kind !== 'drop');
      for (let i = 0; i < 6; i++) real.step();
      const out: LegOut = { x: 0, z: 0, buttons: 0 };
      let seq = 1;
      for (let t = 0; t < 60 * 40 && runs.some((r) => !r.failed && r.leg < r.l.legs.length); t++) {
        for (const r of runs) {
          if (r.failed || r.leg >= r.l.legs.length) { real.setInput(r.e.id, { seq: seq++, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }); continue; }
          const from = r.leg === 0 ? r.l.from : r.l.legs[r.leg - 1];
          const res = legStep(r.e, from, r.l.legs[r.leg], r.params![r.leg], r.run, out);
          if (res === 1) { r.leg++; r.run = newLegRun(); } else if (res === -1) r.failed = true;
          const k = Math.hypot(out.x, out.z);
          real.setInput(r.e.id, { seq: seq++, mx: 0, mz: Math.min(1, k), yaw: k > 1e-4 ? Math.atan2(-out.x, -out.z) : r.e.yaw, pitch: 0, buttons: out.buttons, rt: 0 });
        }
        real.step();
        real.drainEvents();
      }
      const bad = runs.filter((r) => r.failed || r.leg < r.l.legs.length).map((r) => `${r.l.name} leg ${r.leg} at (${r.e.pos.x.toFixed(1)},${r.e.pos.y.toFixed(2)},${r.e.pos.z.toFixed(1)})`);
      expect(bad, who(sp, cls)).toEqual([]);
      expect(runs.length).toBe(sim.worldData.climbRoutes!.length * 2);
      real.dispose();
    }
  }, 180_000);
});

// ------------------------------------------------------------------------------------------------ bots on the perches

function stuckMeter(e: SimEntity) {
  let px = e.pos.x, pz = e.pos.z, odo = 0, want = 0, n = 0, stuck = 0, max = 0;
  return {
    tick() {
      odo += Math.hypot(e.pos.x - px, e.pos.z - pz); px = e.pos.x; pz = e.pos.z;
      if (!e.dead && Math.hypot(e.input.mx, e.input.mz) > 0.5) want++;
      if (++n >= 30) { stuck = !e.dead && want >= 27 && odo < 0.25 ? stuck + 0.5 : 0; max = Math.max(max, stuck); odo = 0; want = 0; n = 0; }
    },
    get max() { return max; },
  };
}

/** An Overwatch bot from its team's spawn to a perch; seconds to reach it (Infinity = not in `limit` s). */
async function perchRun(seed: number, team: TeamId, perchId: string, limit = 120): Promise<{ s: number; links: number; stuck: number }> {
  const s = await Sim.create({ seed, map: 'the_lot' });
  s.step();
  const base = s.pickSpawn(team);
  const e = s.spawnCharacter({ kind: EntityKind.Bot, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'overwatch', name: 'ow', x: base.x, y: base.y, z: base.z, yaw: 0 });
  const ai = ensureBrain(e);
  holdPerch(s, e, s.worldData.perches!.find((p) => p.id === perchId)!);
  const meter = stuckMeter(e);
  let at = Infinity;
  for (let i = 0; i < 60 * limit; i++) {
    s.step();
    s.drainEvents();
    meter.tick();
    if (ai.perch!.reachedAt >= 0) { at = (ai.perch!.reachedAt - 1) / 60; break; }
  }
  s.dispose();
  return { s: at, links: ai.nav.done, stuck: meter.max };
}

describe('The Lot: bots climb to the perches', () => {
  it('Overwatch bots reach the container roof, the scaffold deck, the crow\'s nest and the pipe crown by links', async () => {
    const cases: [number, TeamId, string][] = [
      [1, Team.Corgis, 'lot_container_roof'], [2, Team.Cats, 'lot_scaffold_deck'], [3, Team.Cats, 'lot_scaffold_nest'], [4, Team.Cats, 'lot_pipe_crown'],
    ];
    const res: string[] = [];
    for (const [seed, team, id] of cases) {
      const r = await perchRun(seed, team, id);
      res.push(`seed ${seed} ${team ? 'cat' : 'corgi'} -> ${id}: ${r.s.toFixed(1)} s (${r.links} links, stuck max ${r.stuck} s)`);
      expect(r.s, `seed ${seed} ${id}`).toBeLessThan(120);
      expect(r.links, id).toBeGreaterThanOrEqual(1);
      expect(r.stuck, id).toBeLessThanOrEqual(5);
    }
    console.log(`[l3-nav] perch runs: ${res.join(' · ')}`);
  }, 240_000);

  it('canReach: every perch is reachable from both bases for both species (finite planner cost)', () => {
    for (const team of [Team.Corgis, Team.Cats] as TeamId[]) {
      const b = sim.pickSpawn(team);
      const e = sim.spawnCharacter({ kind: EntityKind.Bot, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'overwatch', name: 'probe', x: b.x, y: b.y, z: b.z, yaw: 0 });
      sim.step();
      for (const p of sim.worldData.perches!) expect(canReach(sim, e, p.x, p.y, p.z), `${team ? 'cat' : 'corgi'} -> ${p.id}`).toBeLessThan(Infinity);
      sim.removeEntity(e.id);
    }
  });
});

// ------------------------------------------------------------------------------------------------ Base Assault bases

describe('The Lot: Base Assault bases (WorldData.bases)', () => {
  it('a flag and a ball stand per team on open, walkable floor in its own base, point-symmetric', () => {
    const d = sim.worldData, g = navGridFor(sim);
    expect(d.bases?.map((b) => b.team).sort()).toEqual([0, 1]);
    for (const b of d.bases!) {
      const spawns = d.spawns.filter((s) => s.team === b.team);
      const cx = spawns.reduce((a, s) => a + s.x, 0) / spawns.length, cz = spawns.reduce((a, s) => a + s.z, 0) / spawns.length;
      for (const [name, [x, y, z]] of [['flag', b.flag], ['stand', b.ballStand]] as const) {
        expect(Math.abs(surfaceAt(d, x, z, y + 0.5).y - y), `${b.team} ${name} on its surface`).toBeLessThan(0.05);
        expect(Math.abs(y - d.height(x, z)), `${b.team} ${name} on the ground`).toBeLessThan(0.05);
        expect(waterAt(d, x, z), `${b.team} ${name} dry`).toBeNull();
        const c = nearestWalkable(g, x, z, 2);
        expect(c, `${b.team} ${name} walkable`).toBeGreaterThanOrEqual(0);
        expect(g.region[c], `${b.team} ${name} main region`).toBe(g.mainRegion);
        // (the flag is a banner pole on a 1.6 m plinth: its capture ring, 3.2 m, reaches the floor around it)
        expect(Math.hypot(cellX(g, c) - x, cellZ(g, c) - z), `${b.team} ${name} near a walkable cell`).toBeLessThan(name === 'flag' ? 2.2 : 1.2);
        expect(Math.hypot(x - cx, z - cz), `${b.team} ${name} in its base`).toBeLessThan(40);
      }
      const [sx, sy, sz] = b.ballStand;
      expect(nearestPropDist(d, sx, sz, sy + 0.1, sy + 2), `${b.team} stand clear of props`).toBeGreaterThan(2.5);
      for (const s of d.spawns) expect(Math.hypot(s.x - sx, s.z - sz), `${b.team} stand vs spawn`).toBeGreaterThan(4);
      expect(Math.hypot(b.flag[0] - sx, b.flag[2] - sz)).toBeGreaterThan(6);
    }
    // G4a's Base Assault takes them as they are (source 'bases'; the stand settled on the floor under it)
    const spots = baseAssaultSpots(sim);
    for (const sp of spots) {
      const b = d.bases!.find((q) => q.team === sp.team)!;
      expect(sp.source, `team ${sp.team}`).toBe('bases');
      expect([sp.flag.x, sp.flag.y, sp.flag.z]).toEqual(b.flag);
      expect(Math.hypot(sp.stand.x - b.ballStand[0], sp.stand.y - b.ballStand[1], sp.stand.z - b.ballStand[2])).toBeLessThan(0.01);
    }
    const [a, c] = [d.bases!.find((b) => b.team === 0)!, d.bases!.find((b) => b.team === 1)!];
    expect(a.flag[0] + c.flag[0]).toBeCloseTo(0, 5);
    expect(a.flag[2] + c.flag[2]).toBeCloseTo(0, 5);
    expect(a.ballStand[0] + c.ballStand[0]).toBeCloseTo(0, 5);
    expect(a.ballStand[2] + c.ballStand[2]).toBeCloseTo(0, 5);
  });
});
