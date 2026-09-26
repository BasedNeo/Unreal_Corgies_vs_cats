import { Sim } from './src/sim/sim';
import { movementSystem } from './src/sim/systems/movement';
import { physicsStepSystem } from './src/sim/systems/core';
import { vehicleSystems, spawnKart, mountKart } from './src/sim/vehicles';
import { Btn } from './src/shared/input';
import type { WorldData } from './src/shared/world/world-data';
const n = 81;
const world: WorldData = { seed: 1, name: 'flat', height: () => 0, halfExtent: 80, props: [], terrain: { x0: -80, z0: -80, cell: 2, n, heights: new Float32Array(n*n) }, spawns: [{ x: 0, y: 0, z: 10, yaw: 0, team: 0 }], killY: -30 };
async function mk() {
  const sim = await Sim.create({ seed: 3, world, systems: [...vehicleSystems(), movementSystem, physicsStepSystem] });
  sim.state.vehicleConfig = { autoTerminals: false }; sim.step();
  const kart = spawnKart(sim, 'mower_kart', 0, 0, 0, 60, 0);
  const p = sim.spawnCharacter({ team: 0, species: 0, cls: 'assault', name: 'P', x: 20, y: 0, z: 0 });
  sim.step(); mountKart(sim, kart, p);
  let seq = 0;
  const drive = (mz: number, mx: number, b: number, n: number, cb?: () => void) => { for (let i = 0; i < n; i++) { sim.setInput(p.id, { seq: ++seq, mx, mz, yaw: 0, pitch: 0, buttons: b, rt: 0 }); sim.step(); cb?.(); } };
  return { sim, kart, p, drive };
}
const sp = (k: any) => Math.hypot(k.vel.x, k.vel.z);
const slipOf = (k: any) => { const vh = Math.atan2(-k.vel.x, -k.vel.z); let s = vh - k.yaw; while (s > Math.PI) s -= 2*Math.PI; while (s < -Math.PI) s += 2*Math.PI; return s * 180 / Math.PI; };
{
  const { kart, drive } = await mk();
  let t = 0; let t10 = -1, t14 = -1;
  drive(1, 0, 0, 240, () => { t += 1/60; if (t10 < 0 && sp(kart) >= 10) t10 = t; if (t14 < 0 && sp(kart) >= 14) t14 = t; });
  console.log(`0-10 m/s ${t10.toFixed(2)} s, 0-14 ${t14.toFixed(2)} s, top ${sp(kart).toFixed(2)}`);
  const z0 = kart.pos.z; let tb = 0; drive(-1, 0, 0, 1); let ticks = 1;
  while (-Math.sin(kart.yaw)*kart.vel.x - Math.cos(kart.yaw)*kart.vel.z > 0.3 && ticks < 200) { drive(-1, 0, 0, 1); ticks++; }
  console.log(`brake 15->0: ${(ticks/60).toFixed(2)} s over ${Math.abs(kart.pos.z - z0).toFixed(1)} m`);
}
{
  const { kart, drive } = await mk();
  drive(1, 0, 0, 180);
  let minX = 1e9, maxX = -1e9; let maxSlip = 0;
  drive(1, 1, 0, 300, () => { minX = Math.min(minX, kart.pos.x); maxX = Math.max(maxX, kart.pos.x); maxSlip = Math.max(maxSlip, Math.abs(slipOf(kart))); });
  console.log(`grip turn @top: circle diameter ${(maxX-minX).toFixed(1)} m, speed ${sp(kart).toFixed(1)}, slip ${maxSlip.toFixed(1)} deg, yawRate ${kart.kart!.yawRate.toFixed(2)}`);
}
{
  const { kart, drive } = await mk();
  drive(1, 0, 0, 180);
  let minX = 1e9, maxX = -1e9; let slips: number[] = [];
  drive(1, 1, Btn.Jump, 120, () => { minX = Math.min(minX, kart.pos.x); maxX = Math.max(maxX, kart.pos.x); slips.push(slipOf(kart)); });
  console.log(`drift (hold into): diameter ${(maxX-minX).toFixed(1)} m, speed ${sp(kart).toFixed(1)}, slip at 0.5s ${slips[30].toFixed(0)} 1s ${slips[60].toFixed(0)} 2s ${slips[119].toFixed(0)} deg, drifting ${kart.kart!.drifting}, charge ${kart.kart!.driftCharge.toFixed(2)}`);
  drive(1, 1, 0, 1); console.log(`  release: turbo ${kart.kart!.turbo.toFixed(2)}`);
  drive(1, 0, 0, 20); console.log(`  after 20 ticks speed ${sp(kart).toFixed(1)}`);
}
{
  const { kart, drive } = await mk();
  drive(1, 0, 0, 180);
  const slips: number[] = [];
  drive(1, -0.2, Btn.Jump, 10); drive(1, 1, Btn.Jump, 60, () => slips.push(slipOf(kart)));
  console.log(`drift entered left then countersteer right: slip end ${slips[59].toFixed(0)} deg, speed ${sp(kart).toFixed(1)}`);
}
