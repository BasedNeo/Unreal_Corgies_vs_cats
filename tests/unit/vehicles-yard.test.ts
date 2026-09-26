// V1 vehicles on the real West Yard (createWorldData): terminals placed at runtime from world data,
// vending + driving out of the base, safe dismounts among real props, and a long random drive.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Btn } from '../../src/shared/input';
import { EFlag, EntityKind, Species, Team, type TeamId } from '../../src/shared/types';
import { createWorldData } from '../../src/shared/world/world-data';
import { nearestPropDist, surfaceAt, waterAt } from '../../src/shared/world/queries';
import { mulberry32 } from '../../src/shared/rng';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { groups, Layer } from '../../src/sim/rapier';
import { vehicleSystems, spawnKart, mountKart, findTerminalSite } from '../../src/sim/vehicles';
import { TERMINALS, VEHICLES } from '../../src/shared/content/vehicles';

const KART = VEHICLES.mower_kart;
const TERM = TERMINALS.kart_terminal;

async function yardSim(autoTerminals = true): Promise<Sim> {
  const sim = await Sim.create({ seed: 1, world: createWorldData(1), systems: [...vehicleSystems(), movementSystem, ...worldSystems(), physicsStepSystem] });
  sim.state.vehicleConfig = { autoTerminals };
  sim.step();
  return sim;
}

let seq = 1;
function tick(sim: Sim, e: SimEntity, mz: number, mx: number, buttons: number, n = 1): void {
  for (let i = 0; i < n; i++) {
    sim.setInput(e.id, { seq: seq++, mx, mz, yaw: e.input.yaw, pitch: 0, buttons, rt: 0 });
    sim.step();
    sim.drainEvents();
  }
}

function pet(sim: Sim, team: TeamId, x: number, z: number): SimEntity {
  return sim.spawnCharacter({ team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'assault', name: `p${sim.entities.size}`, x, y: surfaceAt(sim.worldData, x, z).y + 0.05, z, yaw: 0 });
}

const CAPSULE_TEST = groups(Layer.Character, Layer.World | Layer.Vehicle);
function insideGeometry(sim: Sim, e: SimEntity): boolean {
  const m = e.char!.move;
  const shape = new sim.R.Capsule(m.capsuleHalfHeight, m.capsuleRadius - 0.03);
  return sim.world.intersectionWithShape({ x: e.pos.x, y: e.pos.y + m.capsuleHalfHeight + m.capsuleRadius, z: e.pos.z }, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, CAPSULE_TEST, e.collider ?? undefined) !== null;
}

describe('vehicles on the West Yard', () => {
  it('places one terminal per team near its base on clear, flat, dry lawn', async () => {
    const data = createWorldData(1);
    const sim = await yardSim();
    const terms = [...sim.entities.values()].filter((e) => e.kind === EntityKind.Terminal);
    expect(terms.map((t) => t.team).sort()).toEqual([Team.Corgis, Team.Cats]);
    for (const t of terms) {
      const sp = data.spawns.filter((s) => s.team === t.team);
      const cx = sp.reduce((a, s) => a + s.x, 0) / sp.length, cz = sp.reduce((a, s) => a + s.z, 0) / sp.length;
      expect(Math.hypot(t.pos.x - cx, t.pos.z - cz)).toBeLessThan(32);
      expect(surfaceAt(data, t.pos.x, t.pos.z).kind).toBe('terrain');
      expect(nearestPropDist(data, t.pos.x, t.pos.z, t.pos.y - 0.5, t.pos.y + 3)).toBeGreaterThan(1.5);
      const tt = t.terminal!;
      expect(surfaceAt(data, tt.padX, tt.padZ).kind).toBe('terrain');
      expect(waterAt(data, tt.padX, tt.padZ)).toBeNull();
      expect(nearestPropDist(data, tt.padX, tt.padZ, tt.padY - 0.5, tt.padY + 3)).toBeGreaterThan(KART.radius + 0.5);
      for (const s of data.spawns) expect(Math.hypot(s.x - t.pos.x, s.z - t.pos.z)).toBeGreaterThan(1.5);
      expect(findTerminalSite(data, t.team as TeamId)).not.toBeNull();
    }
  });

  it('vends a kart at each base that drives out into the yard', async () => {
    const sim = await yardSim();
    for (const team of [Team.Corgis, Team.Cats] as TeamId[]) {
      const term = [...sim.entities.values()].find((e) => e.kind === EntityKind.Terminal && e.team === team)!;
      const fx = Math.sin(term.yaw), fz = Math.cos(term.yaw);
      const p = pet(sim, team, term.pos.x - fx * 1.8, term.pos.z - fz * 1.8);
      tick(sim, p, 0, 0, 0, 20);
      tick(sim, p, 0, 0, Btn.Interact); tick(sim, p, 0, 0, 0);
      const kart = [...sim.entities.values()].find((e) => e.kart && e.kart.terminal === term.id)!;
      expect(kart).toBeDefined();
      expect(Math.hypot(p.pos.x - kart.pos.x, p.pos.z - kart.pos.z)).toBeLessThan(KART.mountRange + TERM.padOffset);
      // Walk over and hop in.
      sim.placeCharacter(p, kart.pos.x + Math.cos(kart.yaw) * 1.6, kart.pos.y + 0.05, kart.pos.z - Math.sin(kart.yaw) * 1.6);
      tick(sim, p, 0, 0, 0, 10);
      tick(sim, p, 0, 0, Btn.Interact); tick(sim, p, 0, 0, 0);
      expect(p.flags & EFlag.Mounted).toBeTruthy();
      const x0 = kart.pos.x, z0 = kart.pos.z;
      let top = 0;
      for (let i = 0; i < 240; i++) { tick(sim, p, 1, 0, 0); top = Math.max(top, Math.hypot(kart.vel.x, kart.vel.z)); }
      expect(top).toBeGreaterThan(10);
      expect(Math.hypot(kart.pos.x - x0, kart.pos.z - z0)).toBeGreaterThan(20);
      // Heading out toward the middle of the yard, not into the fence behind the base.
      expect(Math.hypot(kart.pos.x, kart.pos.z)).toBeLessThan(Math.hypot(x0, z0));
      tick(sim, p, 0, 0, Btn.Interact); tick(sim, p, -1, 0, 0, 60);
    }
  });

  it('50 random dismounts among real props never leave the rider inside geometry or under the terrain', async () => {
    const sim = await yardSim(false);
    const data = sim.worldData;
    const rng = mulberry32(7);
    const probe = new sim.R.Cylinder(0.3, KART.radius + 0.05);
    let done = 0, attempts = 0;
    while (done < 50 && attempts < 3000) {
      attempts++;
      const prop = data.props[Math.floor(rng() * data.props.length)];
      if (prop.type === 'boundary') continue;
      const a = rng() * Math.PI * 2, r = Math.hypot(prop.hx, prop.hz) + 0.5 + rng() * 2.5;
      const x = prop.x + Math.cos(a) * r, z = prop.z + Math.sin(a) * r;
      if (Math.abs(x) > 95 || Math.abs(z) > 95) continue;
      const s = surfaceAt(data, x, z, data.height(x, z) + 0.6);
      if (s.kind !== 'terrain' || waterAt(data, x, z)) continue;
      if (sim.world.intersectionWithShape({ x, y: s.y + 0.4, z }, { x: 0, y: 0, z: 0, w: 1 }, probe) !== null) continue;
      const kart = spawnKart(sim, 'mower_kart', Team.Corgis, x, s.y, z, rng() * Math.PI * 2);
      const p = pet(sim, Team.Corgis, x + 3, z + 3);
      sim.step();
      if (!mountKart(sim, kart, p)) { sim.removeEntity(kart.id); sim.removeEntity(p.id); continue; }
      tick(sim, p, 0, 0, 0, 3);
      tick(sim, p, 0, 0, Btn.Interact);
      if (!(p.flags & EFlag.Mounted)) {
        tick(sim, p, 0, 0, 0, 1);
        expect(insideGeometry(sim, p)).toBe(false);
        expect(p.pos.y).toBeGreaterThan(data.height(p.pos.x, p.pos.z) - 0.02);
        expect(Math.hypot(p.pos.x - kart.pos.x, p.pos.z - kart.pos.z)).toBeLessThan(4.5);
        done++;
      }
      sim.removeEntity(kart.id);
      sim.removeEntity(p.id);
      sim.step();
    }
    expect(done).toBe(50);
  });

  it('a 40 s random drive stays finite, above the terrain and inside the yard', async () => {
    const sim = await yardSim(false);
    const data = sim.worldData;
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, -30, surfaceAt(data, -30, -55).y, -55, 0);
    const p = pet(sim, Team.Corgis, -20, -50);
    sim.step();
    mountKart(sim, kart, p);
    const rng = mulberry32(3);
    let mz = 1, mx = 0, b = 0, below = 0, moved = 0;
    let lx = kart.pos.x, lz = kart.pos.z;
    for (let i = 0; i < 60 * 40; i++) {
      if (i % 45 === 0) { mz = rng() < 0.85 ? 1 : -1; mx = rng() * 2 - 1; b = (rng() < 0.25 ? Btn.Jump : 0) | (rng() < 0.3 ? Btn.Sprint : 0); }
      tick(sim, p, mz, mx, b);
      if (kart.removed) break;
      for (const v of [kart.pos.x, kart.pos.y, kart.pos.z, kart.vel.x, kart.vel.y, kart.vel.z, kart.yaw, kart.pitch]) expect(Number.isFinite(v)).toBe(true);
      if (kart.pos.y < data.height(kart.pos.x, kart.pos.z) - 0.15) below++;
      moved += Math.hypot(kart.pos.x - lx, kart.pos.z - lz); lx = kart.pos.x; lz = kart.pos.z;
    }
    expect(below).toBe(0);
    expect(moved).toBeGreaterThan(150);
    const bd = data.bounds!;
    expect(kart.pos.x).toBeGreaterThan(bd.minX);
    expect(kart.pos.x).toBeLessThan(bd.maxX);
  });
});
