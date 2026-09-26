// E4 (Wave 7) the Yard War front on the real West Yard (createWorldData): both forward bases stand and mirror each
// other, collider == visual on every fortification (1 cm), nothing blocks the kiosks, terminals, spawns, core pads,
// kart exits, adventure steps, spawn groups, barricade spots or pickup routes (the runtime sites and pads land exactly
// where they did before E4), terrain stamps (trenches, craters) never move an existing prop, both species climb the
// bird-table watchtowers, the walls are chest cover a pet shoots over, and bots still path everywhere.
import { describe, it, expect, beforeAll } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { createWorldData, type WorldData, type PropBox, type PropCylinder, type VisualPrim } from '../../src/shared/world/world-data';
import { boxTopAt, nearestPropDist, surfaceAt, waterAt } from '../../src/shared/world/queries';
import {
  battleOf, craterList, trenchLines, trenchPositions, mirrorXZ, MIRROR, SACK, WALL_H, TOWER_DECK, TRENCH, type BattleLayout,
} from '../../src/shared/world/fortifications';
import { findTerminalSite, hangarSite } from '../../src/sim/vehicles/sites';
import { findOrdnanceSite, kartKeepOut } from '../../src/sim/interact/sites';
import { corePadSpots } from '../../src/sim/match/core-rush';
import { PICKUP_LAYOUTS } from '../../src/shared/content/pickups';
import { CHAPTERS } from '../../src/shared/content/chapters';
import { worldSystems } from '../../src/sim/world/systems';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem, killPlaneSystem } from '../../src/sim/systems/core';
import { worldLineClear } from '../../src/sim/combat';
import { navGridFor, findPath, isWalkable, type NavGrid } from '../../src/sim/ai';
import { kartNavFor, driveLineClear } from '../../src/sim/ai/drive';
import { Btn } from '../../src/shared/input';
import { Species, Team, type SpeciesId } from '../../src/shared/types';

type P3 = readonly [number, number, number];
let data: WorldData;
let battle: BattleLayout;
let fobBoxes: PropBox[], fobCyls: PropCylinder[], fob: WorldData, old: WorldData;
const isFob = (t: string) => t.startsWith('fob_');
beforeAll(() => {
  data = createWorldData(1);
  battle = battleOf(data)!;
  fobBoxes = data.props.filter((b) => isFob(b.type));
  fobCyls = (data.cylinders ?? []).filter((c) => isFob(c.type));
  fob = { ...data, props: fobBoxes, cylinders: fobCyls };
  old = { ...data, props: data.props.filter((b) => !isFob(b.type) && b.type !== 'boundary'), cylinders: (data.cylinders ?? []).filter((c) => !isFob(c.type)) };
});

/** Which base's half of the yard a point is in (the perpendicular bisector of the two spawn centroids). */
const sideOf = (x: number, z: number) => ((x - MIRROR.x) * 0.511 + (z - MIRROR.z) * 0.86 < 0 ? 0 : 1);
/** Horizontal distance from (x, z) to the nearest fortification collider. */
const fobDist = (x: number, z: number) => nearestPropDist(fob, x, z);
/** A sandbag wall's height over the mean ground under its footprint (0.38 = one sack, 0.76 = two). */
function wallHeight(w: PropBox): number {
  const c = Math.cos(w.rotY), s = Math.sin(w.rotY);
  let sum = 0, n = 0;
  for (const u of [-1, -0.5, 0, 0.5, 1]) for (const v of [-1, 0, 1]) {
    const lx = u * w.hx, lz = v * w.hz;
    sum += data.height(w.x + lx * c + lz * s, w.z - lx * s + lz * c); n++;
  }
  return w.y + w.hy - sum / n;
}

describe('E4 the Yard War front: layout', () => {
  it('both forward bases stand: nest, walls, watchtower, flag, armory, motor pool, generator, floodlights, obstacles', () => {
    const types = new Set([...fobBoxes.map((b) => b.type), ...fobCyls.map((c) => c.type)]);
    for (const t of ['fob_sacks', 'fob_hedgehog', 'fob_barricade', 'fob_crate', 'fob_gascan', 'fob_generator', 'fob_pole', 'fob_tower', 'fob_deck', 'fob_rim', 'fob_post', 'fob_roof', 'fob_flagbase', 'fob_sign']) {
      expect(types.has(t), t).toBe(true);
    }
    expect(battle, 'battle layout registered for the world').toBeTruthy();
    expect(battleOf(data.fences!), 'and for its fence list').toBe(battle);
    expect(battleOf(createWorldData(1))).toBe(battle);                         // cached per seed
    for (const s of [0, 1]) {
      expect(battle.banners.filter((b) => b.team === s && b.icon !== false).length, `banner ${s}`).toBe(1);
      expect(battle.banners.filter((b) => b.team === s && b.icon === false).length, `tower pennant ${s}`).toBe(1);
      expect(battle.towers.filter((t) => t.side === s).length, `tower ${s}`).toBe(1);
      expect(battle.floods.filter((f) => sideOf(f.pos[0], f.pos[2]) === s).length, `floodlights ${s}`).toBe(3);
      expect(battle.nets.filter((n) => sideOf(n.corners[0][0], n.corners[0][2]) === s).length, `camo net ${s}`).toBe(1);
    }
    for (const n of ['corgi_fob', 'cat_fob', 'corgi_spawn', 'cat_spawn', 'midfield', 'corgi_tower']) expect(data.bookmarks!.some((b) => b.name === n), n).toBe(true);
    expect(battle.marks.length).toBeGreaterThan(20);
    expect(battle.ruts.length).toBe(3);
    expect(battle.clutter.some((c) => c.kind === 'paws') && battle.clutter.some((c) => c.kind === 'casings')).toBe(true);
    console.log(`[fob] ${fobBoxes.length} boxes + ${fobCyls.length} cylinders, ${(data.prims ?? []).length} prims, ${battle.marks.length} marks, ${battle.clutter.length} clutter groups`);
  });

  it('fair: the cat base is the corgi base turned about the mid point (same pieces per type, same cover heights)', () => {
    const count = (s: number) => {
      const m = new Map<string, number>();
      for (const b of fobBoxes) if (sideOf(b.x, b.z) === s) m.set(b.type, (m.get(b.type) ?? 0) + 1);
      for (const c of fobCyls) if (sideOf(c.x, c.z) === s) m.set(c.type, (m.get(c.type) ?? 0) + 1);
      return m;
    };
    const a = count(0), b = count(1);
    for (const [t, n] of a) expect(b.get(t) ?? 0, t).toBe(n);
    // wall heights are the same on both sides: every sandbag wall stands one or two sacks over the ground it covers
    for (const w of fobBoxes.filter((x) => x.type === 'fob_sacks')) {
      const h = wallHeight(w);
      const rows = Math.round(h / SACK.H);
      expect([1, 2], `wall @ ${w.x.toFixed(1)},${w.z.toFixed(1)} is ${h.toFixed(2)} m`).toContain(rows);
      expect(Math.abs(h - rows * SACK.H), `wall @ ${w.x.toFixed(1)},${w.z.toFixed(1)} is ${h.toFixed(2)} m`).toBeLessThan(0.08);
    }
    const t0 = battle.towers[0].route, t1 = battle.towers[1].route;
    const [mx, mz] = mirrorXZ(t0[4][0], t0[4][2]);
    expect(Math.hypot(t1[4][0] - mx, t1[4][2] - mz), 'the cat tower stands roughly where the mirror puts it').toBeLessThan(25);
  });
});

describe('E4: collider == visual', () => {
  /** Visual top of box/cylinder prims along the vertical line (x, z), at or below yMax (D3's method). */
  function visualTop(prims: VisualPrim[], x: number, z: number, yMax: number): number {
    let best = -Infinity;
    for (const p of prims) {
      let t = -Infinity;
      if (p.s === 'box') t = boxTopAt({ type: 'v', x: p.x, y: p.y, z: p.z, hx: p.a / 2, hy: p.b / 2, hz: p.c / 2, rotY: p.yaw ?? 0, pitch: p.pitch, roll: p.roll }, x, z);
      else if (p.s === 'cyl' && !p.pitch && !p.roll && Math.hypot(x - p.x, z - p.z) <= Math.max(p.a, p.c)) t = p.y + p.b / 2;
      if (t <= yMax && t > best) best = t;
    }
    return best;
  }

  /** Standing surfaces only: faces steeper than the walkable 52 deg are not floors. */
  const walkable = (pitch = 0, roll = 0) => Math.cos(pitch) * Math.cos(roll) >= Math.cos((52 * Math.PI) / 180);
  /** The propped garden signs are 7 cm plates leaning at 77 deg: their edge is no floor (a vertical line through them
   *  meets the slanted face, where their painted decals sit 1 cm proud). */
  const floorBoxes = () => fobBoxes.filter((b) => b.type !== 'fob_sign' && walkable(b.pitch, b.roll));
  /** Collider top along the vertical line at or below yMax (overlapping solids: the highest one wins, like the KCC). */
  function colliderTop(x: number, z: number, yMax: number): number {
    let best = -Infinity;
    for (const b of floorBoxes()) { const t = boxTopAt(b, x, z); if (t <= yMax && t > best) best = t; }
    for (const c of fobCyls) if (Math.hypot(x - c.x, z - c.z) <= c.r && c.y + c.hh <= yMax) best = Math.max(best, c.y + c.hh);
    return best;
  }

  it('every fortification standing surface (collider top, 3x3 samples) has a visual top within 1 cm', () => {
    // (noink prims count here: an open crate's standing surface is its packed tennis balls, drawn without ink)
    // (the garden signs: plates and decals leaning at pitch -0.22 are not floors either)
    const prims = (data.prims ?? []).filter((p) => fobDist(p.x, p.z) < 3 && walkable(p.pitch, p.roll) && !(p.pitch && Math.abs(p.pitch + 0.22) < 1e-9));
    let worst = 0, where = '', n = 0;
    for (const b of floorBoxes()) {
      for (const u of [-0.8, 0, 0.8]) for (const v of [-0.8, 0, 0.8]) {
        const c = Math.cos(b.rotY), s = Math.sin(b.rotY), lx = u * b.hx, lz = v * b.hz;
        const x = b.x + lx * c + lz * s, z = b.z - lx * s + lz * c;
        const own = boxTopAt(b, x, z);
        if (!Number.isFinite(own)) continue;
        n++;
        const top = colliderTop(x, z, own + 0.05);
        const err = Math.abs(visualTop(prims, x, z, top + 0.05) - top);
        if (err > worst) { worst = err; where = `${b.type} @ ${x.toFixed(2)},${z.toFixed(2)} collider ${top.toFixed(3)}`; }
      }
    }
    for (const cy of fobCyls) {
      for (const [dx, dz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) {
        const x = cy.x + dx * cy.r, z = cy.z + dz * cy.r;
        const top = colliderTop(x, z, cy.y + cy.hh + 0.05);
        n++;
        const err = Math.abs(visualTop(prims, x, z, top + 0.05) - top);
        if (err > worst) { worst = err; where = `${cy.type} @ ${x.toFixed(2)},${z.toFixed(2)} collider ${top.toFixed(3)}`; }
      }
    }
    console.log(`[fob] collider==visual: ${n} samples, worst ${(worst * 100).toFixed(2)} cm ${where}`);
    expect(n).toBeGreaterThan(600);
    expect(worst, where).toBeLessThanOrEqual(0.01);
  });

  it('every sandbag wall collider IS its sacks: the union of the sacks equals the box within 1 cm on all six faces', () => {
    const prims = (data.prims ?? []).filter((p) => p.s === 'box' && p.g === 'soft');
    let checked = 0;
    for (const w of fobBoxes.filter((b) => b.type === 'fob_sacks')) {
      const c = Math.cos(w.rotY), s = Math.sin(w.rotY);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const p of prims) {
        if (Math.abs((p.yaw ?? 0) - w.rotY) > 1e-6 && Math.abs(Math.abs((p.yaw ?? 0) - w.rotY) - Math.PI * 2) > 1e-6) continue;
        const dx = p.x - w.x, dz = p.z - w.z;
        const lx = dx * c - dz * s, lz = dx * s + dz * c, ly = p.y - w.y;
        if (Math.abs(lx) > w.hx || Math.abs(lz) > w.hz || Math.abs(ly) > w.hy) continue;     // a sack of this wall
        lo[0] = Math.min(lo[0], lx - p.a / 2); hi[0] = Math.max(hi[0], lx + p.a / 2);
        lo[1] = Math.min(lo[1], ly - p.b / 2); hi[1] = Math.max(hi[1], ly + p.b / 2);
        lo[2] = Math.min(lo[2], lz - p.c / 2); hi[2] = Math.max(hi[2], lz + p.c / 2);
      }
      const ext = [w.hx, w.hy, w.hz];
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(lo[k] + ext[k]), `wall @ ${w.x.toFixed(1)},${w.z.toFixed(1)} face -${k}`).toBeLessThanOrEqual(0.01);
        expect(Math.abs(hi[k] - ext[k]), `wall @ ${w.x.toFixed(1)},${w.z.toFixed(1)} face +${k}`).toBeLessThanOrEqual(0.01);
      }
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });
});

describe('E4: nothing gameplay-relevant moved or got blocked', () => {
  it('Kart-O-Matics, Ordnance Kiosks, the Rooftop Hangar, core-rush pads and spawns are exactly where they were', async () => {
    // pre-E4 values (the runtime placement searches are pure functions of the world; a new prop on a site moves it)
    const kart = [[-29.5, -63.8724, -26.8153, -65.4224], [44.8816, 63.7723, 42.5068, 65.7649]];
    const ord = [[-38.2613, -66.1132], [54.1667, 64.6045]];
    const pads = [[-26.0443, 19.9494], [8.3333, -0.5], [42.7109, -20.9494]];
    for (const t of [0, 1] as const) {
      const k = findTerminalSite(data, t)!;
      expect(Math.hypot(k.x - kart[t][0], k.z - kart[t][1]), `kart kiosk ${t}`).toBeLessThan(0.01);
      expect(Math.hypot(k.padX - kart[t][2], k.padZ - kart[t][3]), `kart pad ${t}`).toBeLessThan(0.01);
      const o = findOrdnanceSite(data, t, kartKeepOut(data, t))!;
      expect(Math.hypot(o.x - ord[t][0], o.z - ord[t][1]), `ordnance kiosk ${t}`).toBeLessThan(0.01);
    }
    const h = hangarSite(data)!;
    expect(h && Math.hypot(h.x - 92, h.z + 68.3)).toBeLessThan(0.01);
    const sim = await Sim.create({ seed: 1, world: data });
    const spots = corePadSpots(sim);
    sim.dispose();
    expect(spots.length).toBe(3);
    spots.forEach((p, i) => expect(Math.hypot(p.x - pads[i][0], p.z - pads[i][1]), `core pad ${i}`).toBeLessThan(0.01));
    const spawns = [[-64, -70], [-50, -68], [-40, -71], [-28, -70], [-16, -72], [-6, -79], [24, 70], [34, 72], [46, 71], [58, 71], [68, 76], [74, 64]];
    expect(data.spawns.map((s) => [s.x, s.z])).toEqual(spawns);
    for (const s of data.spawns) expect(fobDist(s.x, s.z), `spawn ${s.x},${s.z}`).toBeGreaterThan(2.5);
  });

  it('kart exits stay clear: 22 m from each Kart-O-Matic pad along its launch heading, 3.2 m either side', () => {
    for (const t of [0, 1] as const) {
      const k = findTerminalSite(data, t)!;
      const fx = -Math.sin(k.padYaw), fz = -Math.cos(k.padYaw);
      for (let d = 0; d <= 22; d += 0.5) for (const o of [-2.4, -1.2, 0, 1.2, 2.4]) {
        const x = k.padX + fx * d - fz * o, z = k.padZ + fz * d + fx * o;
        expect(fobDist(x, z), `team ${t} kart exit at ${d} m, ${o} m`).toBeGreaterThan(0.8);
      }
      expect(fobDist(k.x, k.z), `kiosk ${t}`).toBeGreaterThan(3);
      expect(fobDist(k.padX, k.padZ), `pad ${t}`).toBeGreaterThan(3);
      const o = findOrdnanceSite(data, t, kartKeepOut(data, t))!;
      expect(fobDist(o.x, o.z), `ordnance ${t}`).toBeGreaterThan(3.3);
    }
    // the ch3 getaway: the straight drive from the kart parked by the garage door to the garden gate zone (the A2
    // test and a human both steer straight at it): 3.5 m clear either side of the line
    for (let t = 0; t <= 1; t += 0.01) {
      const x = 81 + (-77 - 81) * t, z = -43 + (-63.5 + 43) * t;
      expect(fobDist(x, z), `ch3 getaway at ${x.toFixed(1)},${z.toFixed(1)}`).toBeGreaterThan(3.5);
    }
  });

  it('adventure chapters: step zones, spawn groups, barricade spots, parked karts, rally and start points stay clear', () => {
    for (const ch of CHAPTERS) {
      expect(fobDist(ch.start.x, ch.start.z), `${ch.id} start`).toBeGreaterThan(4);
      for (const s of ch.steps) {
        const p = s.trigger.params as { x?: number; z?: number; radius?: number; spots?: { x: number; z: number }[] };
        // a zone may hold scenery (a pet walks into it around the props) but its centre stays open
        if (p.x !== undefined && p.z !== undefined) expect(fobDist(p.x, p.z), `${ch.id}/${s.id} zone`).toBeGreaterThan(Math.min(p.radius ?? 0, 3) + 0.5);
        for (const q of p.spots ?? []) expect(fobDist(q.x, q.z), `${ch.id}/${s.id} collect`).toBeGreaterThan(2);
        for (const g of [...(s.spawns ?? []), ...(s.alarm ?? [])]) expect(fobDist(g.at.x, g.at.z), `${ch.id}/${s.id} spawn group ${g.archetype}`).toBeGreaterThan(3.5);
        for (const b of s.raise ?? []) for (const o of [-2.4, 0, 2.4]) expect(fobDist(b.x + o * Math.cos(b.yaw), b.z - o * Math.sin(b.yaw)), `${ch.id}/${s.id} barricade`).toBeGreaterThan(3);
        for (const v of s.vehicles ?? []) expect(fobDist(v.x, v.z), `${ch.id}/${s.id} kart`).toBeGreaterThan(4);
        if (s.rally) expect(fobDist(s.rally.x, s.rally.z), `${ch.id}/${s.id} rally`).toBeGreaterThan(3);
      }
    }
    // the Vac-Tank (r 2.5) spawns in the cats' plaza in ch6: keep its body and a lane around it free
    expect(fobDist(47, 60), 'vac-tank spawn').toBeGreaterThan(4);
  });

  it('pickups and their proof routes, destructibles, jump pads, water, The Garden and The Garage stay clear', () => {
    const L = PICKUP_LAYOUTS['West Yard'];
    for (const p of [...L.cores, ...L.kibble]) {
      expect(fobDist(p.x, p.z), p.id).toBeGreaterThan(2);
      for (const r of p.route ?? []) expect(fobDist(r[0], r[2]), `${p.id} route ${r}`).toBeGreaterThan(2);
    }
    for (const d of data.destructibles ?? []) expect(fobDist(d.x, d.z), d.id).toBeGreaterThan(4);
    for (const j of data.jumpPads ?? []) expect(fobDist(j.x, j.z), j.id).toBeGreaterThan(j.r + 3);
    for (const b of fobBoxes) {
      expect(waterAt(data, b.x, b.z), `${b.type} in water`).toBeNull();
      for (const d of data.districts ?? []) {
        const inside = b.x > d.minX && b.x < d.maxX && b.z > d.minZ && b.z < d.maxZ;
        expect(inside, `${b.type} @ ${b.x.toFixed(1)},${b.z.toFixed(1)} inside ${d.id}`).toBe(false);
      }
    }
  });

  it('trenches and craters never move an existing prop, a spawn, a pad or a pickup route (props sit on height())', () => {
    const stamps: [number, number, number][] = [];                       // x, z, influence radius
    for (const [x, z, r] of craterList()) stamps.push([x, z, r * 1.17 + 1.75]);
    for (const { pts } of trenchLines()) for (let i = 0; i + 3 < pts.length; i += 2) {
      const n = Math.ceil(Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]) / 0.5);
      for (let k = 0; k <= n; k++) stamps.push([pts[i] + ((pts[i + 2] - pts[i]) * k) / n, pts[i + 1] + ((pts[i + 3] - pts[i + 1]) * k) / n, TRENCH.width]);
    }
    const L = PICKUP_LAYOUTS['West Yard'];
    const points: [string, number, number][] = [
      ...data.spawns.map((s) => ['spawn', s.x, s.z] as [string, number, number]),
      ...[...L.cores, ...L.kibble].flatMap((p) => [[p.id, p.x, p.z] as [string, number, number], ...(p.route ?? []).map((r) => [`${p.id} route`, r[0], r[2]] as [string, number, number])]),
      ['pad A', -26.04, 19.95], ['pad B', 8.33, -0.5], ['pad C', 42.71, -20.95],
    ];
    for (const [x, z, R] of stamps) {
      expect(nearestPropDist(old, x, z), `stamp at ${x.toFixed(1)},${z.toFixed(1)} vs an existing prop`).toBeGreaterThan(R);
      for (const [id, px, pz] of points) expect(Math.hypot(px - x, pz - z), `stamp at ${x.toFixed(1)},${z.toFixed(1)} vs ${id}`).toBeGreaterThan(R + 1);
    }
  });
});

// ------------------------------------------------------------------------------------------------ hop search (D3's)
interface Leg { key: string; from: P3; to: P3 }
interface Variant { move: number; jump: number; dbl: boolean; sprint: boolean; walk?: boolean }
const VARIANTS: Variant[] = [{ move: 0, jump: -1, dbl: false, sprint: false, walk: true }];
for (const sprint of [false, true]) for (const dbl of [false, true]) {
  for (const move of [0, 6, 12, 18]) VARIANTS.push({ move, jump: 0, dbl, sprint });
  for (const jump of [6, 12, 20]) VARIANTS.push({ move: 0, jump, dbl, sprint });
}
function buttons(v: Variant, i: number): number {
  let b = v.sprint ? Btn.Sprint : 0;
  if (v.walk) return b;
  const t = i - v.jump;
  if (t >= 0 && t < 20) b |= Btn.Jump;
  if (v.dbl && t >= 22 && t < 46) b |= Btn.Jump;
  return b;
}
const coreSystems = () => [movementSystem, ...worldSystems(), physicsStepSystem, killPlaneSystem];
async function hopSearch(legs: Leg[], species: SpeciesId): Promise<Map<string, boolean>> {
  const ok = new Set<string>();
  const BATCH = 10;
  let pending = legs;
  for (let b = 0; b * BATCH < VARIANTS.length && pending.length; b++) {
    const sim = await Sim.create({ seed: 1, world: data, systems: coreSystems() });
    const runs: { leg: Leg; v: Variant; e: SimEntity }[] = [];
    let ticks = 0;
    for (const leg of pending) for (const v of VARIANTS.slice(b * BATCH, b * BATCH + BATCH)) {
      const e = sim.spawnCharacter({ team: species === Species.Cat ? Team.Cats : Team.Corgis, species, cls: 'assault', name: 'hop', x: leg.from[0], y: leg.from[1] + 0.05, z: leg.from[2], yaw: 0 });
      runs.push({ leg, v, e });
      ticks = Math.max(ticks, Math.round(90 + (Math.hypot(leg.to[0] - leg.from[0], leg.to[2] - leg.from[2]) / 5) * 60));
    }
    for (let i = 0; i < 20; i++) sim.step();
    let seq = 1;
    for (let i = 0; i < ticks; i++) {
      for (const r of runs) {
        if (ok.has(r.leg.key)) continue;
        const dx = r.leg.to[0] - r.e.pos.x, dz = r.leg.to[2] - r.e.pos.z;
        sim.setInput(r.e.id, { seq: seq++, mx: 0, mz: i >= r.v.move && Math.hypot(dx, dz) > 0.4 ? 1 : 0, yaw: Math.atan2(-dx, -dz), pitch: 0, buttons: buttons(r.v, i), rt: 0 });
      }
      sim.step();
      for (const r of runs) {
        if (ok.has(r.leg.key)) continue;
        const e = r.e, to = r.leg.to;
        if (e.char!.grounded && Math.abs(e.pos.y - to[1]) < 0.3 && Math.hypot(e.pos.x - to[0], e.pos.z - to[2]) < 1.2) ok.add(r.leg.key);
      }
    }
    sim.dispose();
    pending = pending.filter((l) => !ok.has(l.key));
  }
  return new Map(legs.map((l) => [l.key, ok.has(l.key)]));
}

describe('E4: the bird-table watchtowers', () => {
  // standing points snapped onto the surface under them (the first one is on the lawn behind the stair)
  const snap = (p: P3): P3 => [p[0], surfaceAt(data, p[0], p[2], p[1] + 0.5).y, p[2]];
  const legs = (): Leg[] => battle.towers.flatMap((t) => t.route.slice(0, -1).map((p, i) => ({ key: `tower ${t.side} leg ${i}`, from: snap(p), to: snap(t.route[i + 1]) })));

  it('the crate stair: every standing point is on a real surface, each step <= 1.2 m, the deck is at 4.8 m', () => {
    for (const t of battle.towers) {
      const r = t.route;
      expect(surfaceAt(data, r[0][0], r[0][2], r[0][1] + 0.5).kind, 'starts on the lawn').toBe('terrain');
      for (const p of r.slice(1)) expect(Math.abs(surfaceAt(data, p[0], p[2], p[1] + 0.5).y - p[1]), `${t.side} ${p}`).toBeLessThan(0.05);
      for (let i = 1; i + 1 < r.length; i++) expect(r[i + 1][1] - r[i][1]).toBeLessThanOrEqual(1.21);
      expect(r[r.length - 1][1] - r[1][1] + 1.2).toBeCloseTo(TOWER_DECK, 1);
    }
  });

  it('corgi (the weakest jumper) climbs both towers', async () => {
    const res = await hopSearch(legs(), Species.Corgi);
    expect([...res].filter(([, v]) => !v).map(([k]) => k)).toEqual([]);
  }, 300000);

  it('cat climbs both towers', async () => {
    const res = await hopSearch(legs(), Species.Cat);
    expect([...res].filter(([, v]) => !v).map(([k]) => k)).toEqual([]);
  }, 300000);
});

describe('E4: cover and navigation', () => {
  it('a two-sack wall hides a pet\'s chest and shows its head; the defender shoots over it', async () => {
    const sim = await Sim.create({ seed: 1, world: data });
    sim.step();
    let walls = 0;
    for (const w of fobBoxes.filter((b) => b.type === 'fob_sacks' && b.hx > 2 && wallHeight(b) > 0.6)) {
      const fx = Math.sin(w.rotY), fz = Math.cos(w.rotY);                // the wall's front (local +z)
      const bx = w.x - fx * (w.hz + 0.55), bz = w.z - fz * (w.hz + 0.55);   // a defender pressed behind it
      const ax = w.x + fx * 12, az = w.z + fz * 12;                        // an attacker 12 m out front
      const gb = data.height(bx, bz), ga = data.height(ax, az);
      if (Math.abs(gb - (w.y + w.hy - WALL_H)) > 0.15) continue;            // skip spots where the ground drops away
      // skip lanes where something else (another wall, a crater rim) stands between them
      if (!worldLineClear(sim, ax, ga + 1.25, az, w.x, w.y + w.hy + 0.25, w.z)) continue;
      walls++;
      expect(worldLineClear(sim, ax, ga + 1.25, az, bx, gb + 0.55, bz), `chest hidden behind wall @ ${w.x.toFixed(1)},${w.z.toFixed(1)}`).toBe(false);
      expect(worldLineClear(sim, ax, ga + 1.25, az, bx, gb + 1.05, bz), `head shows @ ${w.x.toFixed(1)},${w.z.toFixed(1)}`).toBe(true);
      expect(worldLineClear(sim, bx, gb + 1.25, bz, ax, ga + 0.6, az), `defender shoots over @ ${w.x.toFixed(1)},${w.z.toFixed(1)}`).toBe(true);
    }
    sim.dispose();
    expect(walls).toBeGreaterThanOrEqual(6);
  });

  it('trench firing positions stand on every salient, facing the enemy; the trench floor is walkable', () => {
    for (const { pts, side } of trenchLines()) {
      const ps = trenchPositions(pts, side);
      expect(ps.length, `side ${side}`).toBe(3);
      for (const p of ps) {
        const w = fobBoxes.find((b) => b.type === 'fob_sacks' && Math.hypot(b.x - p.x, b.z - p.z) < 0.05);
        expect(w, `position @ ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBeTruthy();
        expect(Math.abs(wallHeight(w!) - WALL_H)).toBeLessThan(0.08);
      }
      for (let k = 0; k + 1 < pts.length; k += 2) expect(data.height(pts[k], pts[k + 1]), 'trench floor').toBeLessThan(0.1);
    }
  });

  it('bots: every spawn paths to every core pad and into the enemy base; both FOBs have at least two open gates', async () => {
    const sim = await Sim.create({ seed: 1, world: data });
    sim.step();
    const grid: NavGrid = navGridFor(sim);
    sim.dispose();
    const out: number[] = [];
    const pads = [[-26.04, 19.95], [8.33, -0.5], [42.71, -20.95]];
    const len = (sx: number, sz: number) => { let l = 0, px = sx, pz = sz; for (let k = 0; k + 1 < out.length; k += 2) { l += Math.hypot(out[k] - px, out[k + 1] - pz); px = out[k]; pz = out[k + 1]; } return l; };
    for (const s of data.spawns) {
      for (const [x, z] of pads) {
        expect(findPath(grid, s.x, s.z, x, z, out), `spawn ${s.x},${s.z} -> pad ${x},${z}`).toBe(true);
        expect(len(s.x, s.z), `spawn ${s.x},${s.z} -> pad ${x},${z} detour`).toBeLessThan(Math.hypot(x - s.x, z - s.z) * 1.35 + 8);
      }
    }
    // gates: from the west, centre and east approaches 16+ m in front of each FOB, bots reach the kiosk plaza with
    // little detour (the west gate + main path, the kart gate and the east lane are open)
    for (const s of [0, 1] as const) {
      const o = findOrdnanceSite(data, s, kartKeepOut(data, s))!;
      for (const [x0, z0] of [[-56, -40], [-40, -40], [-18, -40]]) {
        const [ax, az] = s ? mirrorXZ(x0, z0) : [x0, z0];
        expect(findPath(grid, ax, az, o.x, o.z, out), `gate ${s} from ${ax.toFixed(0)},${az.toFixed(0)}`).toBe(true);
        expect(len(ax, az), `gate ${s} from ${ax.toFixed(0)},${az.toFixed(0)}: little detour`).toBeLessThan(Math.hypot(o.x - ax, o.z - az) * 1.3 + 4);
      }
    }
    // the tower decks are not nav cells (bots do not climb them), the ground under them is
    for (const t of battle.towers) expect(isWalkable(grid, t.route[0][0], t.route[0][2]), 'behind the tower').toBe(true);
    // karts (B2's kart grid: a 0.26 m ledge stops them) drive the kart lines out of both bases, across the trench lines
    const nav = kartNavFor(grid, data);
    for (const r of battle.ruts.slice(0, 2)) {
      for (let k = 2; k + 3 < r.pts.length; k += 2) {
        expect(driveLineClear(grid, nav, r.pts[k], r.pts[k + 1], r.pts[k + 2], r.pts[k + 3]), `kart line ${r.pts[k]},${r.pts[k + 1]} -> ${r.pts[k + 2]},${r.pts[k + 3]}`).toBe(true);
      }
    }
    // and straight across every trench leg and its berm, both ways (cover for pets, not a kart wall)
    for (const { pts } of trenchLines()) for (let k = 0; k + 3 < pts.length; k += 2) {
      const mx = (pts[k] + pts[k + 2]) / 2, mz = (pts[k + 1] + pts[k + 3]) / 2;
      const L = Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]), nx = -(pts[k + 3] - pts[k + 1]) / L * 4.2, nz = (pts[k + 2] - pts[k]) / L * 4.2;   // bank to bank + 1 m
      expect(driveLineClear(grid, nav, mx - nx, mz - nz, mx + nx, mz + nz), `kart across the trench @ ${mx.toFixed(1)},${mz.toFixed(1)}`).toBe(true);
    }
  });
});
