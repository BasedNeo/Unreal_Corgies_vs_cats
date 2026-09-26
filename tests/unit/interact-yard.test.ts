// S1 on the real West Yard (createWorldData): Ordnance Terminal sites, the pickup layout (20 Golden Kibble +
// 4 Upgrade Core spots) and its reachability — every spot is proven reachable from open lawn by the weakest
// jumper (corgi) with a brute-force hop search over run / sprint / jump / double-jump timings — the objective
// chain's targets, and the interaction system's cost inside the full default system list.
import { describe, it, expect, beforeAll } from 'vitest';
import { Sim, type SimSystem } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { createDefaultSystems } from '../../src/sim/systems';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem, killPlaneSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { findTerminalSite } from '../../src/sim/vehicles';
import { findOrdnanceSite, searchOrdnanceSite, kartKeepOut, touchesPickup, objectiveState } from '../../src/sim/interact';
import { createWorldData, type WorldData } from '../../src/shared/world/world-data';
import { nearestPropDist, occupiedAt, surfaceAt, waterAt } from '../../src/shared/world/queries';
import { Btn } from '../../src/shared/input';
import { EntityKind, Species, Team, type TeamId } from '../../src/shared/types';
import { PICKUP_LAYOUTS, PICKUPS, type PickupSpot, type RoutePoint } from '../../src/shared/content/pickups';
import { OBJECTIVE_CHAINS } from '../../src/shared/content/objectives';
import { TERMINALS, terminalIndex } from '../../src/shared/content/terminals';

let data: WorldData;
const LAYOUT = PICKUP_LAYOUTS['West Yard'];
beforeAll(() => { data = createWorldData(1); });

const centroid = (team: TeamId) => {
  const s = data.spawns.filter((p) => p.team === team);
  return { x: s.reduce((a, p) => a + p.x, 0) / s.length, z: s.reduce((a, p) => a + p.z, 0) / s.length };
};

describe('West Yard: Ordnance Terminal sites', () => {
  it('one flat, clear site per base near the spawns, away from the Kart-O-Matic, pickups and objectives; deterministic', () => {
    const avoid = [...LAYOUT.cores, ...LAYOUT.kibble].map((s) => ({ x: s.x, z: s.z, r: 4 }));
    for (const team of [Team.Corgis, Team.Cats] as TeamId[]) {
      const a = findOrdnanceSite(data, team, [...avoid, ...kartKeepOut(data, team)])!;
      const b = searchOrdnanceSite(data, team, [...avoid, ...kartKeepOut(data, team)])!; // uncached: same answer
      expect(b).toEqual(a);
      const c = centroid(team);
      expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeLessThan(20);
      expect(surfaceAt(data, a.x, a.z).kind).toBe('terrain');
      expect(waterAt(data, a.x, a.z)).toBeNull();
      expect(nearestPropDist(data, a.x, a.z, a.y - 0.5, a.y + 4)).toBeGreaterThan(Math.hypot(TERMINALS.ordnance_terminal.hx, TERMINALS.ordnance_terminal.hz) + 1);
      for (const s of data.spawns) expect(Math.hypot(s.x - a.x, s.z - a.z)).toBeGreaterThan(2.5);
      const kart = findTerminalSite(data, team)!;
      expect(Math.hypot(kart.x - a.x, kart.z - a.z)).toBeGreaterThan(TERMINALS.kart_terminal.useRange + TERMINALS.ordnance_terminal.useRange + 2);
      expect(Math.hypot(kart.padX - a.x, kart.padZ - a.z)).toBeGreaterThan(3.5);
      for (const s of [...LAYOUT.cores, ...LAYOUT.kibble]) expect(Math.hypot(s.x - a.x, s.z - a.z)).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('West Yard: pickup layout', () => {
  it('20 Golden Kibble + 4 core spots, sane data (surfaces, open-lawn starts, clear of colliders, spread out)', () => {
    expect(LAYOUT.kibble.length).toBe(20);
    expect(LAYOUT.cores.length).toBe(4);
    const all: PickupSpot[] = [...LAYOUT.cores, ...LAYOUT.kibble];
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) {
      expect(occupiedAt(data, s.x, s.y, s.z), `${s.id} inside a collider`).toBe(false);
      expect(s.route?.length, `${s.id} has a proof route`).toBeGreaterThan(0);
      const r = s.route!;
      expect(surfaceAt(data, r[0][0], r[0][2], r[0][1] + 0.5).kind, `${s.id} starts on open lawn`).toBe('terrain');
      for (const p of r) expect(Math.abs(surfaceAt(data, p[0], p[2], p[1] + 0.5).y - p[1]), `${s.id} route point ${p}`).toBeLessThan(0.15);
      for (const o of all) if (o !== s) expect(Math.hypot(o.x - s.x, o.z - s.z, o.y - s.y), `${s.id} vs ${o.id}`).toBeGreaterThan(2.5);
    }
    // Contested cores: each spot is about as far from the corgi base as from the cat base (±25 %).
    const cc = centroid(Team.Corgis), kc = centroid(Team.Cats);
    for (const s of LAYOUT.cores) {
      const dc = Math.hypot(s.x - cc.x, s.z - cc.z), dk = Math.hypot(s.x - kc.x, s.z - kc.z);
      expect(Math.max(dc, dk) / Math.min(dc, dk), s.id).toBeLessThan(1.25);
    }
    // Every quarter of the yard has kibble to find.
    const quad = new Set(LAYOUT.kibble.map((s) => `${s.x < 0 ? 'W' : 'E'}${s.z < 0 ? 'N' : 'S'}`));
    expect(quad.size).toBe(4);
  });

  it('every kibble and core spot is reachable from the lawn (brute-force hop search, weakest jumper)', async () => {
    const result = await hopSearch(data, [...LAYOUT.kibble, ...LAYOUT.cores]);
    const failed = result.filter((r) => !r.ok).map((r) => r.key);
    expect(failed).toEqual([]);
    expect(result.length).toBeGreaterThanOrEqual(50);
  }, 240000);
});

describe('West Yard: objective chain + the full system list', () => {
  it('objective targets sit on reachable ground; a real skirmish room runs the layer cheaply', async () => {
    const chain = OBJECTIVE_CHAINS.yard_squeaker;
    for (const st of chain.steps) {
      const p = st.trigger.params;
      // Plenty of open, dry, standable ground inside the trigger radius (the target itself may be a prop:
      // the shed door, the trampoline, the cat tree).
      let open = 0;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, x = p.x + Math.cos(a) * p.radius * 0.75, z = p.z + Math.sin(a) * p.radius * 0.75;
        const y = surfaceAt(data, x, z).y;
        if (!occupiedAt(data, x, y + 0.6, z) && !waterAt(data, x, z)) open++;
      }
      expect(open, st.id).toBeGreaterThanOrEqual(6);
    }
    // Wrap the interaction system with a timer inside the default list (TDM, 4v4 bots, 25 s).
    let ms = 0, ticks = 0, placeMs = 0;
    const systems: SimSystem[] = createDefaultSystems().map((s) => s.name !== 'interact' ? s : {
      ...s, update(sim, dt) {
        const t0 = performance.now(); s.update(sim, dt); const d = performance.now() - t0;
        if (ticks++ === 0) placeMs = d; else ms += d; // tick 0 = one-time runtime placement (site searches)
      },
    });
    const sim = await Sim.create({ seed: 1, systems });
    const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [4, 4] });
    for (let i = 0; i < 25 * 60; i++) room.tick();
    const states = sim.snapshotEntities();
    const kiosks = states.filter((s) => s.kind === EntityKind.Terminal && s.cls === terminalIndex('ordnance_terminal'));
    expect(kiosks.map((k) => k.team).sort()).toEqual([Team.Corgis, Team.Cats]);
    expect(states.filter((s) => s.kind === EntityKind.Pickup).length).toBe(24);
    for (const s of states) for (const v of [s.x, s.y, s.z, s.hp, s.ammo]) expect(Number.isFinite(v)).toBe(true);
    expect(objectiveState(sim)).toBeNull(); // the Squeaker chain is a skirmish chain
    const avg = ms / (ticks - 1);
    console.log(`[interact budget] placement ${placeMs.toFixed(1)} ms once · then ${ticks - 1} ticks avg ${avg.toFixed(4)} ms/tick`);
    expect(avg).toBeLessThan(process.env.CI ? 0.08 : 0.2);
    expect(placeMs).toBeLessThan(process.env.CI ? 250 : 800);
    room.dispose();
  }, 120000);

  it('a skirmish room places the Squeaker chain at the shed once the waves start', async () => {
    const sim = await Sim.create({ seed: 1 });
    const room = new Room(sim, { mode: 'yard-skirmish', botsPerTeam: [0, 0] });
    for (let i = 0; i < 60; i++) room.tick();
    expect(objectiveState(sim)!.step).toBe(-1); // warmup
    for (let i = 0; i < 6 * 60; i++) room.tick();
    const st = objectiveState(sim)!;
    expect(st.step).toBe(0);
    expect(st.text).toBe('Grab the Squeaker from the shed (1/3)');
    expect(Math.hypot(st.x - 47, st.z - 78.4)).toBeLessThan(0.01);
    const beacon = sim.snapshotEntities().find((s) => s.kind === EntityKind.Prop)!;
    expect(beacon.weapon).toBe(0);
    room.dispose();
  }, 60000);
});

// ------------------------------------------------------------------------------------------------ hop search
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
 * Every hop of every route is tried by many corgis at once in one sim (characters never collide with each
 * other): each steers toward its target every tick with one input timing. A hop to a standing point passes
 * when a corgi lands on it (grounded, |dy| < 0.3, within 1.5 m); the last hop passes when a corgi touches the
 * pickup (the authority's own predicate). Timings are tried in batches until every hop passes or all fail.
 */
async function hopSearch(world: WorldData, spots: readonly PickupSpot[]): Promise<{ key: string; ok: boolean }[]> {
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
      const e = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'hop', x: hop.from[0], y: hop.from[1] + 0.05, z: hop.from[2], yaw: 0 });
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
  return hops.map((h) => ({ key: h.key, ok: ok.has(h.key) }));
}
