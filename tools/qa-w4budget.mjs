#!/usr/bin/env node
// Q2 verification probe (read-only): MASTER_PLAN §8.7 sim-tick and snapshot budgets with the Wave 4 systems live.
// Like tools/qa-budget.mjs (a real Room, 12 human slots fed by the rifleman brain through Room.handle, + 16 bots,
// delta-encoded snapshots per client), plus: 2 of the human slots fly RC planes on an autopilot circuit over the
// lawn (plane step, gun, lag-compensated plane hits), and the destructibles are live (they break from fire).
//   npx tsx tools/qa-w4budget.mjs [--seconds 90] [--repeat 3] [--planes 2] [--mode team-deathmatch]
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { SnapEncoder, encodeServerMsg } from '../src/host/wire';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';
import { EntityKind, CLASS_IDS } from '../src/shared/types';
import { applyArchetype } from '../src/sim/ai';
import { spawnPlane, mountPlane, planeAutopilot } from '../src/sim/vehicles';
import { loadavg } from 'node:os';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SECONDS = Number(opt('seconds', 90)), HUMANS = 12, BOTS = 16, MODE = opt('mode', 'team-deathmatch');
const REPEAT = Math.max(1, Number(opt('repeat', 3))), PLANES = Number(opt('planes', 2));
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : 0; };
const r = (v) => Math.round(v * 100) / 100;
const CIRCUIT = [{ x: 40, z: 40, y: 16 }, { x: -40, z: 40, y: 18 }, { x: -40, z: -40, y: 16 }, { x: 40, z: -40, y: 18 }];

async function run() {
  const sim = await Sim.create({ seed: 1 });
  const room = new Room(sim, { mode: MODE, botsPerTeam: [0, 0] });
  const bytes = new Array(HUMANS).fill(0), humans = [];
  for (let i = 0; i < HUMANS; i++) {
    const encoder = new SnapEncoder(), idx = i;
    const conn = { id: `h${i}`, send(m) { bytes[idx] += encodeServerMsg(m, m.t === 'snap' ? encoder : null).length; } };
    humans.push({ slot: room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: `H${i}`, team: i % 2, cls: CLASS_IDS[i % 6] }), seq: 0, plane: null, wp: i });
  }
  for (let i = 0; i < BOTS; i++) room.addBot(i % 2, CLASS_IDS[i % 6]);
  const wall = [], cpu = [], ticks = SECONDS * TICK_HZ, warm = 5 * TICK_HZ;
  const ev = { fire: 0, death: 0, destruct: 0, planeLaunch: 0, planeLost: 0, planeFlyingTicks: 0 };
  const drain = sim.drainEvents.bind(sim);
  sim.drainEvents = () => { const a = drain(); for (const e of a) { if (e.e === 'fire') ev.fire++; else if (e.e === 'death') ev.death++; else if (e.e === 'ability' && String(e.ability).startsWith('destruct:')) ev.destruct++; } return a; };
  const t0 = performance.now();
  for (let t = 0; t < ticks; t++) {
    for (let k = 0; k < humans.length; k++) {
      const h = humans[k];
      const e = sim.entities.get(h.slot.entity);
      if (!e) continue;
      // pilots: (re)launch a plane in the air once the match is live, then fly the circuit
      if (k < PLANES && room.match.phase === 'live' && !e.dead && (!h.plane || h.plane.removed || !e.seat)) {
        const w = CIRCUIT[h.wp % CIRCUIT.length];
        const p = spawnPlane(sim, 'rc_plane', e.team, w.x * 0.5, 0, w.z * 0.5, 0);
        if (p) {
          sim.placeCharacter(e, p.pos.x + 2.2, sim.worldData.height(p.pos.x + 2.2, p.pos.z) + 0.05, p.pos.z);
          if (mountPlane(sim, p, e)) { h.plane = p; ev.planeLaunch++; } else { p.removed = true; }
        }
      }
      if (k < PLANES && h.plane && !h.plane.removed && e.seat) {
        const goal = CIRCUIT[h.wp % CIRCUIT.length];
        if (Math.hypot(h.plane.pos.x - goal.x, h.plane.pos.z - goal.z) < 12) h.wp++;
        const { cmd } = planeAutopilot(sim, h.plane, goal);
        room.handle(h.slot.pid, { t: 'input', cmds: [{ ...cmd, seq: ++h.seq, buttons: cmd.buttons | 4, rt: Math.max(0, sim.tick - 6) }] });
        if (h.plane.pos.y > sim.worldData.height(h.plane.pos.x, h.plane.pos.z) + 2) ev.planeFlyingTicks++;
        continue;
      }
      if (!e.ai) applyArchetype(e, 'rifleman', { external: true });
      const c = e.ai?.out;
      if (c) room.handle(h.slot.pid, { t: 'input', cmds: [{ seq: ++h.seq, mx: c.mx, mz: c.mz, yaw: c.yaw, pitch: c.pitch, buttons: c.buttons, rt: Math.max(0, sim.tick - 6) }] });
    }
    const c0 = process.cpuUsage(), w0 = performance.now();
    room.tick();
    const w = performance.now() - w0, d = process.cpuUsage(c0);
    if (t >= warm) { wall.push(w); cpu.push((d.user + d.system) / 1000); }
  }
  const chars = [...sim.entities.values()].filter((e) => e.char).length;
  const destructibles = [...sim.entities.values()].filter((e) => e.kind === EntityKind.Destructible).length;
  const kbps = bytes.map((b) => b / 1024 / SECONDS);
  return { wall, cpu, ev, chars, destructibles, kbps, wallTotal: performance.now() - t0, entities: sim.entities.size };
}
const runs = [];
for (let i = 0; i < REPEAT; i++) runs.push(await run());
const R0 = runs[0];
const n = Math.min(...runs.map((x) => x.wall.length));
const best = Array.from({ length: n }, (_, i) => Math.min(...runs.map((x) => Math.min(x.wall[i], x.cpu[i]))));
console.log(`mode ${MODE} · characters ${R0.chars} + ${PLANES} planes on autopilot + ${R0.destructibles} destructibles (${R0.entities} entities) · ${SECONDS}s sim ×${REPEAT} · load ${loadavg()[0].toFixed(1)}`);
console.log(`events run0: ${JSON.stringify(R0.ev)} (plane airborne ${(R0.ev.planeFlyingTicks / TICK_HZ).toFixed(0)} pilot-s)`);
console.log(`tick best-of-${REPEAT} min(wall,cpu) p50 ${r(pct(best, 0.5))} p95 ${r(pct(best, 0.95))} p99 ${r(pct(best, 0.99))} max ${r(Math.max(...best))} ms  (budget ≤ 3 ms)`);
for (const [i, x] of runs.entries()) console.log(`  run ${i}: wall p95 ${r(pct(x.wall, 0.95))} max ${r(Math.max(...x.wall))} · min(wall,cpu) p95 ${r(pct(x.wall.map((w, j) => Math.min(w, x.cpu[j])), 0.95))} · ${Math.round(x.wallTotal)} ms total`);
console.log(`snapshot KB/s per client (delta wire, incl. roster/events) mean ${r(R0.kbps.reduce((a, b) => a + b, 0) / R0.kbps.length)} max ${r(Math.max(...R0.kbps))}  (budget ≤ 40 KB/s at 12 players)`);
