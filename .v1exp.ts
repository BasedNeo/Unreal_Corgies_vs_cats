import { Sim } from './src/sim/sim';
import { movementSystem } from './src/sim/systems/movement';
import { physicsStepSystem } from './src/sim/systems/core';
import { vehicleSystems, spawnKart, mountKart } from './src/sim/vehicles';
import { Btn } from './src/shared/input';
import type { WorldData } from './src/shared/world/world-data';
const world: WorldData = { seed: 1, name: 'flat', height: () => 0, halfExtent: 80, props: [
  { type: 'wall', x: 0, y: 2, z: -70, hx: 30, hy: 2, hz: 1, rotY: 0 },
], spawns: [{ x: 0, y: 0, z: 10, yaw: 0, team: 0 }, { x: 0, y: 0, z: -10, yaw: 0, team: 1 }], killY: -30 };
const sim = await Sim.create({ seed: 3, world, systems: [...vehicleSystems(), movementSystem, physicsStepSystem] });
sim.state.vehicleConfig = { autoTerminals: false };
const kart = spawnKart(sim, 'mower_kart', 0, 0, 0, 0, 0);
const p = sim.spawnCharacter({ team: 0, species: 0, cls: 'assault', name: 'P', x: 2, y: 0, z: 0 });
for (let i = 0; i < 20; i++) sim.step();
console.log('kart', kart.pos, 'grounded', kart.kart!.grounded);
mountKart(sim, kart, p);
let seq = 0;
const drive = (mz: number, mx: number, b: number, n: number) => { for (let i = 0; i < n; i++) { sim.setInput(p.id, { seq: ++seq, mx, mz, yaw: 0, pitch: 0, buttons: b, rt: 0 }); sim.step(); } };
for (let s = 0; s < 6; s++) { drive(1, 0, 0, 30); console.log('t', ((s+1)*0.5).toFixed(1), 'speed', Math.hypot(kart.vel.x, kart.vel.z).toFixed(2), 'z', kart.pos.z.toFixed(2), 'y', kart.pos.y.toFixed(3), 'rider', p.pos.z.toFixed(2), p.pos.y.toFixed(2), 'flags', p.flags, 'anim', p.anim); }
drive(1, 0, Btn.Sprint, 60); console.log('boost speed', Math.hypot(kart.vel.x, kart.vel.z).toFixed(2), 'meter', kart.kart!.boost.toFixed(2));
drive(1, 1, 0, 60); console.log('turn right 1s: yaw', kart.yaw.toFixed(2), 'speed', Math.hypot(kart.vel.x, kart.vel.z).toFixed(2), 'pos', kart.pos.x.toFixed(1), kart.pos.z.toFixed(1));
drive(1, -1, Btn.Jump, 60); console.log('drift left 1s: yaw', kart.yaw.toFixed(2), 'drifting', kart.kart!.drifting, 'charge', kart.kart!.driftCharge.toFixed(2), 'speed', Math.hypot(kart.vel.x, kart.vel.z).toFixed(2));
drive(1, 0, 0, 2); console.log('release: turbo', kart.kart!.turbo.toFixed(2));
const evs = sim.drainEvents(); console.log('events', evs.map(e => e.e + (e.e==='ability'? ':'+e.ability:'')).join(','));
