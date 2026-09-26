// G1 The Garden: layout invariants, tall-grass concealment values, the conceal system (stance, firing,
// Stealthed flag), AI stealth (a still corgi in tall grass is not spotted at 8 m but is when it fires),
// and climb reachability (brute-forced hops like L2's world tests).
import { describe, it, expect, beforeAll } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { createWorldData, type WorldData } from '../../src/shared/world/world-data';
import { concealmentAt, districtAt, surfaceAt, boxTopAt } from '../../src/shared/world/queries';
import { GARDEN_DISTRICT } from '../../src/shared/world/garden';
import { worldSystems } from '../../src/sim/world/systems';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem, killPlaneSystem } from '../../src/sim/systems/core';
import { worldLineClear } from '../../src/sim/combat';
import { Btn } from '../../src/shared/input';
import { EFlag, EntityKind, Species, Team, type TeamId } from '../../src/shared/types';
import { concealRevealRange, CONCEAL_REVEAL } from '../../src/sim/world/env';

const coreSystems = () => [movementSystem, ...worldSystems(), physicsStepSystem, killPlaneSystem];
let data: WorldData;
beforeAll(() => { data = createWorldData(1); });

function spawn(sim: Sim, x: number, z: number, opts: { team?: TeamId; kind?: number; yaw?: number; y?: number } = {}): SimEntity {
  const team = opts.team ?? Team.Corgis;
  return sim.spawnCharacter({
    kind: (opts.kind ?? EntityKind.Player) as 0, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'assault',
    name: 'G', x, y: opts.y ?? sim.worldData.height(x, z) + 0.05, z, yaw: opts.yaw ?? 0,
  });
}

describe('The Garden layout', () => {
  it('lives in its district on the west flank, with zones, sprinklers, bookmarks and landmarks', () => {
    const d = data.districts!.find((x) => x.id === 'garden')!;
    expect(d).toEqual(GARDEN_DISTRICT);
    expect(districtAt(data, -85, -14)?.name).toBe('The Garden');
    expect(districtAt(data, 0, 0)).toBeNull();
    expect(data.concealZones!.length).toBeGreaterThanOrEqual(6);
    for (const z of data.concealZones!) {
      expect(z.x - z.rx, z.id).toBeGreaterThanOrEqual(d.minX - 0.5);
      expect(z.x + z.rx, z.id).toBeLessThanOrEqual(d.maxX);
      expect(z.z - z.rz, z.id).toBeGreaterThanOrEqual(d.minZ);
      expect(z.z + z.rz, z.id).toBeLessThanOrEqual(d.maxZ);
      expect(z.h).toBeGreaterThan(1.9);                     // taller than any character (1.2-1.3 m)
    }
    for (const s of data.sprinklers!) {
      expect(districtAt(data, s.x, s.z)?.id).toBe('garden');
      expect(s.y - data.height(s.x, s.z)).toBeGreaterThan(1);
    }
    for (const name of ['garden', 'garden_south', 'garden_bridge', 'garden_high']) expect(data.bookmarks!.some((b) => b.name === name), name).toBe(true);
    const types = new Set(data.props.map((p) => p.type).concat((data.cylinders ?? []).map((c) => c.type)));
    for (const t of ['bed', 'leaf', 'bridge', 'tomato', 'vine', 'pumpkin', 'zucchini', 'tower', 'gnome', 'pot', 'compost', 'scarecrow', 'sprinkler']) expect(types.has(t), t).toBe(true);
    // the district stays mostly walkable ground (a jungle, not a wall)
    let walk = 0, n = 0;
    for (let z = d.minZ + 1; z < d.maxZ; z += 2) for (let x = d.minX + 1; x < d.maxX; x += 2) { n++; if (surfaceAt(data, x, z).kind === 'terrain') walk++; }
    expect(walk / n).toBeGreaterThan(0.75);
  });
});

describe('concealment', () => {
  it('concealmentAt: 1 deep in tall grass, fades at the edge, 0 in the open / above the grass', () => {
    const g = (x: number, z: number, above = 0) => concealmentAt(data, x, data.height(x, z) + above, z);
    expect(g(-86, -14)).toBe(1);                         // meadow center, feet on the ground
    expect(g(-86 + 10 * 0.9, -14)).toBeGreaterThan(0.2); // near the edge: partial
    expect(g(-86 + 10 * 0.9, -14)).toBeLessThan(0.5);
    expect(g(-86 + 10 * 1.05, -14)).toBe(0);             // just outside
    expect(g(-40, -14)).toBe(0);                         // open lawn
    expect(g(-86, -14, 1.5)).toBe(0);                    // jumping: head clears the grass
    expect(g(-67.5, -39)).toBe(1);                       // lawn-edge clump
    // standing on a bean-teepee ledge inside the meadow reveals you
    const y = surfaceAt(data, -89, -22.2).y;
    expect(y).toBeCloseTo(6, 1);                          // (L5 perch above L1 at the same spot)
    expect(concealmentAt(data, -89, 1.2, -22.2)).toBeLessThan(0.1);
  });

  it('conceal system: still = hidden (Stealthed flag), sneaking = mostly, sprinting/firing = revealed', async () => {
    const sim = await Sim.create({ seed: 1, systems: coreSystems() });
    const e = spawn(sim, -86, -14);
    const step = (n: number, mz = 0, buttons = 0) => { for (let i = 0; i < n; i++) { sim.setInput(e.id, { seq: sim.tick + 1, mx: 0, mz, yaw: 0, pitch: 0, buttons, rt: 0 }); sim.step(); } };
    step(20);
    expect(e.conceal!.zone).toBe(1);
    expect(e.conceal!.level).toBe(1);
    expect(e.flags & EFlag.Stealthed).toBeTruthy();
    step(30, 1, Btn.Sprint);                              // sprint through the grass
    expect(e.conceal!.level).toBe(0);
    expect(e.flags & EFlag.Stealthed).toBeFalsy();
    step(40, 0);                                          // stop (inside the meadow still)
    expect(e.conceal!.level).toBe(e.conceal!.zone);
    step(20, 0.5, Btn.Crouch | Btn.Aim);                 // sneak (aim = walk speed, crouch held)
    expect(e.conceal!.level).toBeCloseTo(0.85 * e.conceal!.zone, 6);
    step(30, 0);
    const lvl = e.conceal!.level;
    expect(lvl).toBeGreaterThan(0.9);
    e.flags |= EFlag.Firing;                              // (weapon system not loaded: raise the flag by hand)
    step(1);
    e.flags &= ~EFlag.Firing;
    expect(e.conceal!.level).toBe(0);
    expect(e.flags & EFlag.Stealthed).toBeFalsy();
    step(100);
    expect(e.conceal!.level).toBe(0);                     // still revealed ~2 s after the shot
    step(30);
    expect(e.conceal!.level).toBeGreaterThan(0.9);
    sim.dispose();
  });

  it('reveal range: 5 m fully hidden, x2 when already tracked, full sight in the open', () => {
    expect(concealRevealRange(1, 45, false)).toBe(CONCEAL_REVEAL);
    expect(concealRevealRange(1, 45, true)).toBe(CONCEAL_REVEAL * 2);
    expect(concealRevealRange(0, 45, false)).toBe(45);
    expect(concealRevealRange(0.5, 45, false)).toBe(25);
  });
});

describe('AI vs concealment', () => {
  /** Corgi in the lawn-edge tall grass, a cat bot 8 m east in the open, facing it. */
  async function stealthRun(hidden: boolean, fireAt: number) {
    const sim = await Sim.create({ seed: 1 });
    sim.step(); sim.step();
    const cx = hidden ? -67.5 : -63.5, cz = hidden ? -39 : -27;   // open control spot: plain lawn
    expect(concealmentAt(sim.worldData, cx, sim.worldData.height(cx, cz), cz)).toBe(hidden ? 1 : 0);
    const bx = cx + 8, bz = cz;
    const corgi = spawn(sim, cx, cz, { yaw: -Math.PI / 2 });
    for (let i = 0; i < 10; i++) sim.step();            // settle (the conceal system has run) before the bot arrives
    const bot = spawn(sim, bx, bz, { team: Team.Cats, kind: EntityKind.Bot, yaw: Math.PI / 2 });
    expect(worldLineClear(sim, bx, sim.worldData.height(bx, bz) + 1.05, bz, cx, sim.worldData.height(cx, cz) + 0.7, cz)).toBe(true);
    let spottedFar = -1, spotted = -1;
    for (let i = 0; i < 200; i++) {
      const firing = i >= fireAt && i < fireAt + 12;
      sim.setInput(corgi.id, { seq: i + 1, mx: 0, mz: 0, yaw: -Math.PI / 2, pitch: 0.05, buttons: firing ? Btn.Fire : 0, rt: 0 });
      sim.step();
      const d = Math.hypot(bot.pos.x - corgi.pos.x, bot.pos.z - corgi.pos.z);
      const sees = !!bot.ai?.visible && bot.ai.target === corgi.id;
      if (sees && spotted < 0) spotted = i;
      if (sees && d > 6 && spottedFar < 0 && i < fireAt) spottedFar = i;
    }
    sim.dispose();
    return { spotted, spottedFar };
  }

  it('a still corgi in tall grass is not spotted at 8 m, but is once it fires', async () => {
    const control = await stealthRun(false, 999);
    expect(control.spotted).toBeGreaterThanOrEqual(0);    // same geometry in the open: spotted
    expect(control.spotted).toBeLessThan(40);
    const r = await stealthRun(true, 120);
    expect(r.spottedFar).toBe(-1);                        // not seen from > 6 m while hidden (2 s)
    expect(r.spotted).toBeGreaterThanOrEqual(120);        // ...and only after firing
    expect(r.spotted).toBeLessThan(120 + 45);
  }, 60000);
});

describe('Garden climbing (corgi, the weakest jumper)', () => {
  // Brute-force a few input timings per hop, like a player would; a hop counts if any lands on top.
  const hop = async (from: [number, number, number], to: [number, number, number], sprint = false): Promise<boolean> => {
    for (const delay of [0, 3, 6, 9, 12, 16]) for (const dbl of [false, true]) {
      const sim = await Sim.create({ seed: 1, systems: coreSystems() });
      const e = spawn(sim, from[0], from[2], { y: from[1] + 0.05 });
      for (let i = 0; i < 20; i++) sim.step();
      const yaw = Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
      let seq = 1;
      for (let i = 0; i < 110; i++) {
        const jump = i < 12 || (dbl && i >= 20 && i < 32) ? Btn.Jump : 0;
        const released = dbl && i >= 12 && i < 20;
        const d = Math.hypot(e.pos.x - to[0], e.pos.z - to[2]);
        const mz = i >= delay && d > 0.6 ? 1 : 0;
        sim.setInput(e.id, { seq: seq++, mx: 0, mz, yaw, pitch: 0, buttons: (released ? 0 : jump) | (sprint ? Btn.Sprint : 0), rt: 0 });
        sim.step();
      }
      const ok = e.char!.grounded && Math.abs(e.pos.y - to[1]) < 0.2 && Math.hypot(e.pos.x - to[0], e.pos.z - to[2]) < 2.2;
      sim.dispose();
      if (ok) return true;
    }
    return false;
  };
  const top = (x: number, z: number): [number, number, number] => [x, surfaceAt(data, x, z).y, z];

  it('veg plot: bed -> tomato-cage ledges -> trellis bridge -> the other cage -> its crown (6.1 m)', async () => {
    // bed A (-91, -54), cage core (-91, -54.6); ledges N 2.5 / E 3.7 / S 4.9; bridge 3.7 at z -54.6
    expect(await hop([-91, 0, -44.8], top(-91, -49.5)), 'ground -> bed A (1.3)').toBe(true);
    expect(await hop(top(-91, -59.6), top(-91, -57.2)), 'bed -> ledge 1 (2.5)').toBe(true);
    expect(await hop(top(-91.2, -56.6), top(-88.7, -54.4)), 'ledge 1 -> ledge 2 (3.7)').toBe(true);
    // walk the bridge (3.7) from cage A's east ledge to cage B's west ledge
    {
      const sim = await Sim.create({ seed: 1, systems: coreSystems() });
      const [x, y, z] = top(-88.4, -54.6);
      const e = spawn(sim, x, z, { y: y + 0.05 });
      for (let i = 0; i < 20; i++) sim.step();
      for (let i = 0; i < 180; i++) { sim.setInput(e.id, { seq: i + 1, mx: 0, mz: 1, yaw: -Math.PI / 2, pitch: 0, buttons: 0, rt: 0 }); sim.step(); }
      expect(e.pos.x, 'crossed the bridge').toBeGreaterThan(-75);
      expect(e.pos.y).toBeGreaterThan(3.5);
      sim.dispose();
    }
    expect(await hop(top(-73.4, -54.4), top(-71.2, -56.9)), 'cage B ledge 2 -> ledge 3 (4.9)').toBe(true);
    expect(await hop(top(-71.1, -57.0), top(-71, -54.8)), 'ledge 3 -> crown (6.1)').toBe(true);
    expect(surfaceAt(data, -71, -54.6).y).toBeCloseTo(6.1, 1);
  }, 180000);

  it('bean teepee: ground -> five leaf ledges -> 6 m perch -> vine crown (7.2 m)', async () => {
    // teepee (-89, -20): ledges N 1.2 / E 2.4 / S 3.6 / W 4.8 / N 6.0
    const L: [number, number, number][] = [[-89, 1.2, -22.1], top(-86.9, -20), top(-89, -17.9), top(-91.1, -20)];
    expect(await hop([-89, 0, -25.6], L[0]), 'ground -> L1').toBe(true);
    for (let k = 0; k < 3; k++) expect(await hop(L[k], L[k + 1]), `L${k + 1} -> L${k + 2}`).toBe(true);
    // L5 is directly above L1 (same XZ): check the top of the column there
    expect(surfaceAt(data, -89, -22.1).y).toBeCloseTo(6, 1);
    expect(await hop(L[3], [-89, 6.0, -22.1]), 'L4 -> L5 perch').toBe(true);
    expect(await hop([-89, 6.0, -22.4], top(-89, -20.2)), 'perch -> crown').toBe(true);
  }, 180000);

  it('watchtower: flowerpot stair (1.3 / 2.5 / 3.7) -> lookout deck (4.9)', async () => {
    const pots = [top(-75.8, 38.5), top(-75.8, 36), top(-75.8, 33.5)];
    expect(pots.map((p) => p[1])).toEqual([1.3, 2.5, 3.7].map((v) => expect.closeTo(v, 2)));
    expect(await hop([-72.2, 0, 38.5], pots[0]), 'ground -> pot 1').toBe(true);
    expect(await hop(pots[0], pots[1]), 'pot 1 -> pot 2').toBe(true);
    expect(await hop(pots[1], pots[2]), 'pot 2 -> pot 3').toBe(true);
    expect(await hop(pots[2], top(-78.6, 33.2)), 'pot 3 -> deck').toBe(true);
    const deck = data.props.find((p) => p.type === 'tower' && Math.abs(boxTopAt(p, -78.6, 33.2) - 4.9) < 0.01);
    expect(deck).toBeTruthy();
  }, 180000);
});
