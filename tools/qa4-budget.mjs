#!/usr/bin/env node
// Q4 verification probe (read-only): tools/qa-budget.mjs (Q1's MASTER_PLAN §8.7 tick + bandwidth budget room) with a
// --map option, so the budgets are measured on The Lot and in Base Assault too. Everything else is Q1's method: a real
// Room, human slots fed AI inputs through Room.handle (stub Conns measuring the delta wire), bots, best-of-N
// min(wall, process CPU) per tick.
//   npx tsx tools/qa4-budget.mjs [--map the_lot] [--mode base-assault] [--seconds 60] [--humans 12] [--bots 12] [--repeat 3]
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { SnapEncoder, encodeServerMsg } from '../src/host/wire';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';
import { Team, CLASS_IDS } from '../src/shared/types';
import { applyArchetype } from '../src/sim/ai';
import { loadavg } from 'node:os';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const MAP = opt('map', '') === 'west_yard' ? '' : opt('map', '');
const SECONDS = Number(opt('seconds', 60)), HUMANS = Number(opt('humans', 12)), BOTS = Number(opt('bots', 16)), MODE = opt('mode', 'team-deathmatch');
const REPEAT = Math.max(1, Number(opt('repeat', 3)));
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : 0; };
const r = (v) => Math.round(v * 100) / 100;

async function run() {
const sim = await Sim.create({ seed: 1, ...(MAP ? { map: MAP } : {}) });
const room = new Room(sim, { mode: MODE, botsPerTeam: [0, 0] });
const enc = [];
const bytes = new Array(HUMANS).fill(0);
const humans = [];
for (let i = 0; i < HUMANS; i++) {
  const encoder = new SnapEncoder();
  const idx = i;
  const conn = { id: `h${i}`, send(m) { bytes[idx] += encodeServerMsg(m, m.t === 'snap' ? encoder : null).length; } };
  enc.push(encoder);
  const slot = room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: `H${i}`, team: (i % 2), cls: CLASS_IDS[i % 6] });
  humans.push({ slot, seq: 0 });
}
for (let i = 0; i < BOTS; i++) room.addBot(i % 2, CLASS_IDS[i % 6]);
const chars = [...sim.entities.values()].filter((e) => e.char).length;

const ticks = SECONDS * TICK_HZ, warm = 5 * TICK_HZ;
const wall = [], cpu = [];
let kills = 0, fires = 0, deaths = 0, hits = 0; const phases = new Map();
const drain = sim.drainEvents.bind(sim);
sim.drainEvents = () => { const evs = drain(); for (const e of evs) { if (e.e === 'fire') fires++; else if (e.e === 'death') deaths++; else if (e.e === 'hit') hits++; } return evs; };
const t0 = performance.now();
for (let t = 0; t < ticks; t++) {
  for (const h of humans) {
    const e = sim.entities.get(h.slot.entity);
    if (!e) continue;
    if (!e.ai) applyArchetype(e, 'rifleman', { external: true });
    const c = e.ai?.out;
    if (c) room.handle(h.slot.pid, { t: 'input', cmds: [{ seq: ++h.seq, mx: c.mx, mz: c.mz, yaw: c.yaw, pitch: c.pitch, buttons: c.buttons, rt: Math.max(0, sim.tick - 6) }] });
  }
  const c0 = process.cpuUsage(), w0 = performance.now();
  room.tick();
  const w = performance.now() - w0, d = process.cpuUsage(c0);
  if (t >= warm) { wall.push(w); cpu.push((d.user + d.system) / 1000); }
  if (t % 60 === 0) { const ph = room.match.phase; phases.set(ph, (phases.get(ph) ?? 0) + 1); }
}
// spawn crowding: characters within 1 m of another character at the end
const cs = [...sim.entities.values()].filter((e) => e.char && !e.dead);
let crowded = 0; for (const a of cs) if (cs.some((b) => b !== a && Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 1)) crowded++;
const spawnsPerTeam = [0, 1].map((t) => sim.worldData.spawns.filter((s) => s.team === t).length);
for (const p of room.players.values()) kills += p.kills;
const wallTotal = performance.now() - t0;
const kbps = bytes.map((b) => b / 1024 / SECONDS);
return { wall, cpu, kills, fires, deaths, hits, phases, crowded, spawnsPerTeam, kbps, wallTotal, chars, match: room.match };
}
const runs = [];
for (let i = 0; i < REPEAT; i++) runs.push(await run());
const R0 = runs[0];
const best = R0.wall.map((_, i) => Math.min(...runs.map((x) => Math.min(x.wall[i], x.cpu[i]))));
const { wall, cpu, kills, fires, deaths, hits, phases, crowded, spawnsPerTeam, kbps, wallTotal, chars } = R0;
console.log(`map ${MAP || 'west_yard'} · mode ${MODE} · characters ${chars} (${HUMANS} human slots + ${BOTS} bots) · ${SECONDS}s sim in ${Math.round(wallTotal)} ms · load ${loadavg()[0].toFixed(1)}`);
console.log(`combat: fire ${fires} · hit ${hits} · death ${deaths} · roster kills ${kills} · phases(s) ${JSON.stringify(Object.fromEntries(phases))} · final ${R0.match.objective} · spawn points per team ${spawnsPerTeam} · alive chars within 1 m of another at end: ${crowded}`);
console.log(`tick best-of-${REPEAT} min(wall,cpu) p50 ${r(pct(best, 0.5))} p95 ${r(pct(best, 0.95))} max ${r(Math.max(...best))} ms  (budget ≤ 3 ms)`);
console.log(`tick wall ms p50 ${r(pct(wall, 0.5))} p95 ${r(pct(wall, 0.95))} p99 ${r(pct(wall, 0.99))} max ${r(Math.max(...wall))} · cpu ms p50 ${r(pct(cpu, 0.5))} p95 ${r(pct(cpu, 0.95))} · min(wall,cpu) p95 ${r(pct(wall.map((w, i) => Math.min(w, cpu[i])), 0.95))}  (budget ≤ 3 ms)`);
console.log(`snapshot KB/s per client (delta wire, incl. roster/events) mean ${r(kbps.reduce((a, b) => a + b, 0) / kbps.length)} max ${r(Math.max(...kbps))}  (budget ≤ 40 KB/s at 12 players)`);
