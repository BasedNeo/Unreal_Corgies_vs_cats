// W9 L3 (M5) on The Lot: PICKUP_LAYOUTS['The Lot'] (4 Upgrade Core spots + 18 Golden Kibble). Sane data (surfaces,
// open-ground starts, clear of colliders, spread out, balanced between the bases), and every spot is reachable by
// S1's brute-force hop search (run / sprint / jump / double-jump timings, the authority's own touch predicate) for a
// corgi AND a cat. A real TDM room on The Lot spawns the layout.
import { describe, it, expect, beforeAll } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem, killPlaneSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { touchesPickup, interactRuntime } from '../../src/sim/interact';
import { createWorldData, type WorldData } from '../../src/shared/world/world-data';
import { occupiedAt, surfaceAt } from '../../src/shared/world/queries';
import { Btn } from '../../src/shared/input';
import { EntityKind, Species, Team, type SpeciesId, type TeamId } from '../../src/shared/types';
import { terminalIndex } from '../../src/shared/content/terminals';
import { PICKUP_LAYOUTS, PICKUPS, pickupLayoutFor, type PickupSpot, type RoutePoint } from '../../src/shared/content/pickups';

let data: WorldData;
const LAYOUT = PICKUP_LAYOUTS['The Lot'];
beforeAll(() => { data = createWorldData(1, 'the_lot'); });

const centroid = (team: TeamId) => {
  const s = data.spawns.filter((p) => p.team === team);
  return { x: s.reduce((a, p) => a + p.x, 0) / s.length, z: s.reduce((a, p) => a + p.z, 0) / s.length };
};

describe('The Lot: pickup layout', () => {
  it('4 core spots + 18 kibble, keyed by the map name; sane data (surfaces, open-ground starts, clear, spread out)', () => {
    expect(pickupLayoutFor(data.name)).toBe(LAYOUT);
    expect(LAYOUT.cores.length).toBe(4);
    expect(LAYOUT.kibble.length).toBe(18);
    const all: PickupSpot[] = [...LAYOUT.cores, ...LAYOUT.kibble];
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) {
      for (const dy of [0, 0.3]) expect(occupiedAt(data, s.x, s.y + dy, s.z), `${s.id} +${dy} inside a collider`).toBe(false);
      expect(s.route?.length, `${s.id} has a proof route`).toBeGreaterThan(0);
      const r = s.route!;
      expect(surfaceAt(data, r[0][0], r[0][2], r[0][1] + 0.5).kind, `${s.id} starts on open ground`).toBe('terrain');
      for (const p of r) expect(Math.abs(surfaceAt(data, p[0], p[2], p[1] + 0.5).y - p[1]), `${s.id} route point ${p}`).toBeLessThan(0.15);
      for (const o of all) if (o !== s) expect(Math.hypot(o.x - s.x, o.z - s.z, o.y - s.y), `${s.id} vs ${o.id}`).toBeGreaterThan(2.5);
      // the pickup floats just over its surface (or over the water's floor)
      const under = surfaceAt(data, s.x, s.z, s.y + 0.2).y;
      expect(s.y - under, `${s.id} height over its surface`).toBeGreaterThan(0.2);
      expect(s.y - under, `${s.id} height over its surface`).toBeLessThan(1.3);
    }
    // cores come in point-symmetric pairs: as a set, as close to one base as to the other (±10 %)
    const cc = centroid(Team.Corgis), kc = centroid(Team.Cats);
    const dc = LAYOUT.cores.reduce((a, s) => a + Math.hypot(s.x - cc.x, s.z - cc.z), 0), dk = LAYOUT.cores.reduce((a, s) => a + Math.hypot(s.x - kc.x, s.z - kc.z), 0);
    expect(Math.max(dc, dk) / Math.min(dc, dk)).toBeLessThan(1.1);
    // every quarter of the lot has kibble to find
    expect(new Set(LAYOUT.kibble.map((s) => `${s.x < 0 ? 'W' : 'E'}${s.z < 0 ? 'N' : 'S'}`)).size).toBe(4);
  });

  it('every kibble and core spot is reachable from open ground by a corgi (brute-force hop search)', async () => {
    const result = await hopSearch(data, [...LAYOUT.kibble, ...LAYOUT.cores], Species.Corgi);
    expect(result.filter((r) => !r.ok).map((r) => r.key)).toEqual([]);
    expect(result.length).toBeGreaterThanOrEqual(30);
  }, 300_000);

  it('... and by a cat', async () => {
    const result = await hopSearch(data, [...LAYOUT.kibble, ...LAYOUT.cores], Species.Cat);
    expect(result.filter((r) => !r.ok).map((r) => r.key)).toEqual([]);
  }, 300_000);

  it('a TDM room on The Lot spawns the layout (one pickup entity per spot) and both Ordnance Terminals', async () => {
    const sim = await Sim.create({ seed: 1, map: 'the_lot' });
    const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [2, 2] });
    for (let i = 0; i < 60 * 3; i++) room.tick();
    const states = sim.snapshotEntities();
    expect(states.filter((s) => s.kind === EntityKind.Pickup).length).toBe(LAYOUT.cores.length + LAYOUT.kibble.length);
    expect(interactRuntime(sim).pickupEnts.length).toBe(LAYOUT.cores.length + LAYOUT.kibble.length);
    expect(states.filter((s) => s.kind === EntityKind.Terminal && s.cls === terminalIndex('ordnance_terminal')).map((k) => k.team).sort()).toEqual([Team.Corgis, Team.Cats]);
    room.dispose();
  }, 60_000);
});

// ------------------------------------------------------------------------------------------------ hop search (S1)
interface Hop { key: string; from: RoutePoint; to: RoutePoint; touch?: { x: number; y: number; z: number; r: number } }
interface Variant { move: number; jump: number; dbl: boolean; sprint: boolean; walk?: boolean }

/** Input timings a player would try: walk, stand-and-jump with a delayed run-up, running jumps; ± double, ± sprint. */
const VARIANTS: Variant[] = [{ move: 0, jump: -1, dbl: false, sprint: false, walk: true }, { move: 0, jump: -1, dbl: false, sprint: true, walk: true }];
for (const sprint of [false, true]) for (const dbl of [false, true]) {
  for (const move of [0, 6, 12, 18]) VARIANTS.push({ move, jump: 0, dbl, sprint });
  for (const jump of [6, 12, 20]) VARIANTS.push({ move: 0, jump, dbl, sprint });
}

function buttons(v: Variant, i: number): number {
  let b = v.sprint ? Btn.Sprint : 0;
  if (v.walk) return b;
  const t = i - v.jump;
  if (t >= 0 && t < 20) b |= Btn.Jump;             // full first jump (held to the apex)
  if (v.dbl && t >= 22 && t < 46) b |= Btn.Jump;   // double jump at the apex
  return b;
}

/**
 * S1's search (tests/unit/interact-yard.test.ts), for either species: every hop of every route is tried by many
 * characters at once in one sim (characters never collide with each other), each steering toward its target every
 * tick with one input timing. A hop to a standing point passes when a character lands on it (grounded, |dy| < 0.3,
 * within 1.5 m); the last hop passes when it touches the pickup (the authority's own predicate).
 */
async function hopSearch(world: WorldData, spots: readonly PickupSpot[], species: SpeciesId): Promise<{ key: string; ok: boolean }[]> {
  const hops: Hop[] = [];
  const seen = new Set<string>();
  for (const s of spots) {
    const pts = s.route ?? [];
    const radius = LAYOUT.cores.includes(s) ? PICKUPS.overclock.radius : PICKUPS.golden_kibble.radius;
    pts.forEach((from, i) => {
      const last = i === pts.length - 1;
      const to: RoutePoint = last ? [s.x, s.y, s.z] : pts[i + 1];
      const key = `${s.id}#${i}`;
      const dedupe = `${from.join()}>${to.join()}>${last ? s.id : ''}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      hops.push({ key, from, to, touch: last ? { x: s.x, y: s.y, z: s.z, r: radius } : undefined });
    });
  }
  const ok = new Set<string>();
  const BATCH = 10;
  let pending = hops;
  for (let b = 0; b * BATCH < VARIANTS.length && pending.length; b++) {
    const sim = await Sim.create({ seed: 1, world, systems: [movementSystem, ...worldSystems(), physicsStepSystem, killPlaneSystem] });
    const runs: { hop: Hop; v: Variant; e: SimEntity }[] = [];
    let ticks = 0;
    for (const hop of pending) for (const v of VARIANTS.slice(b * BATCH, b * BATCH + BATCH)) {
      const e = sim.spawnCharacter({ team: species === Species.Cat ? Team.Cats : Team.Corgis, species, cls: 'assault', name: 'hop', x: hop.from[0], y: hop.from[1] + 0.05, z: hop.from[2], yaw: 0 });
      runs.push({ hop, v, e });
      ticks = Math.max(ticks, Math.round(90 + (Math.hypot(hop.to[0] - hop.from[0], hop.to[2] - hop.from[2]) / 5.5) * 60));
    }
    for (let i = 0; i < 20; i++) sim.step();
    let seq = 1;
    for (let i = 0; i < ticks; i++) {
      for (const r of runs) {
        if (ok.has(r.hop.key)) continue;
        const dx = r.hop.to[0] - r.e.pos.x, dz = r.hop.to[2] - r.e.pos.z;
        sim.setInput(r.e.id, { seq: seq++, mx: 0, mz: i >= r.v.move && Math.hypot(dx, dz) > 0.45 ? 1 : 0, yaw: Math.atan2(-dx, -dz), pitch: 0, buttons: buttons(r.v, i), rt: 0 });
      }
      sim.step();
      for (const r of runs) {
        if (ok.has(r.hop.key)) continue;
        const e = r.e, to = r.hop.to, t = r.hop.touch;
        const hit = t ? touchesPickup(e, t.x, t.y, t.z, t.r)
          : e.char!.grounded && Math.abs(e.pos.y - to[1]) < 0.3 && Math.hypot(e.pos.x - to[0], e.pos.z - to[2]) < 1.5;
        if (hit) ok.add(r.hop.key);
      }
    }
    sim.dispose();
    pending = pending.filter((h) => !ok.has(h.key));
  }
  const res = hops.map((h) => ({ key: h.key, ok: ok.has(h.key) }));
  console.log(`[l3-pickups] ${species === Species.Cat ? 'cat' : 'corgi'}: ${res.filter((r) => r.ok).length}/${res.length} hops pass`);
  return res;
}
