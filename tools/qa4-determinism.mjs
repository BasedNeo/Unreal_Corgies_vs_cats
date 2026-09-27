#!/usr/bin/env node
// Q4 verification probe (read-only): same seed → same match, on both maps, with the Wave 9 systems in play (Base Assault
// balls, throwables, lanes, the Lot's weather). D1's check (tools/qa-determinism.mjs) and Q3's interleave check
// (tools/qa3-interleave.mjs) only take the West Yard and have no base-assault config; this one does both:
//   sequential : the target alone in a fresh process vs the target after the `--pre` rooms in another fresh process
//   interleave : A and B alone vs A and B ticked alternately in one process, B created --late ticks after A
// Spec: <mode>[@<map>]:<seconds>   mode = tdm | core-rush | yard-skirmish | base-assault;  map = west_yard | the_lot
//   npx tsx tools/qa4-determinism.mjs sequential --target base-assault@the_lot:60 --pre tdm:30,base-assault:20 [--seed 3]
//   npx tsx tools/qa4-determinism.mjs interleave --a base-assault@the_lot:60 --b base-assault:60 [--late 300] [--seed-a 1] [--seed-b 2]
// The per-tick hash covers every entity (balls, stands, rings, thrown ordnance, karts, planes, characters): id, kind,
// position, velocity, yaw, pitch, hp, flags, dead. Also compared: deaths, captures, throws. Exit 1 on any difference.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { ordnanceStats } from '../src/sim/combat';
import { TICK_HZ } from '../src/shared/constants';
import { Team } from '../src/shared/types';

const argv = process.argv.slice(2);
const kind = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'sequential';
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const CONFIG = {
  'team-deathmatch': { tdm: { warmup: 3, killLimit: 12, timeLimit: 45, endedHold: 5 } },
  'core-rush': { coreRush: { warmup: 3, scoreLimit: 40, timeLimit: 45, endedHold: 5 } },
  'base-assault': { baseAssault: { warmup: 3, timeLimit: 45, endedHold: 5 } },
  'yard-skirmish': { skirmish: { warmup: 2, intermission: 2, endedHold: 4, spawnInterval: 0.5, wipeLives: 2, scaleMax: 1,
    waves: [{ counts: { grunt: 1 } }, { counts: { kitten: 1, sniper: 1 } }, { counts: { grunt: 1, brute: 1, kitten: 1 }, label: 'FINAL WAVE' }] } },
};
const LINEUP = [[Team.Corgis, 'assault'], [Team.Corgis, 'overwatch'], [Team.Corgis, 'breacher'], [Team.Corgis, 'skyraider'],
  [Team.Cats, 'assault'], [Team.Cats, 'overwatch'], [Team.Cats, 'breacher'], [Team.Cats, 'skyraider']];
function parse(spec) {
  const [head, secs] = spec.split(':');
  const [m, map] = head.split('@');
  const mode = m === 'tdm' ? 'team-deathmatch' : m;
  if (!CONFIG[mode]) throw new Error(`unknown mode in ${spec}`);
  return { spec, mode, map: map && map !== 'west_yard' ? map : '', ticks: Math.round(Number(secs ?? 45) * TICK_HZ) };
}
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
const mix = (h, v) => { f64[0] = v; for (let k = 0; k < 2; k++) { h ^= u32[k]; h = Math.imul(h, 16777619) >>> 0; } return h; };
function worldHash(sim) {
  let h = 2166136261;
  for (const e of sim.entities.values()) for (const v of [e.id, e.kind, e.pos.x, e.pos.y, e.pos.z, e.vel.x, e.vel.y, e.vel.z, e.yaw, e.pitch, e.health?.hp ?? -1, e.flags, e.dead ? 1 : 0]) h = mix(h, v);
  return h;
}
async function make(spec, seed) {
  const s = parse(spec);
  const sim = await Sim.create({ seed, ...(s.map ? { map: s.map } : {}) });
  sim.state.matchConfig = CONFIG[s.mode];
  const room = new Room(sim, { mode: s.mode, botsPerTeam: s.mode === 'yard-skirmish' ? [4, 0] : [0, 0] });
  if (s.mode !== 'yard-skirmish') for (const [team, cls] of LINEUP) room.addBot(team, cls);
  const r = { s, sim, room, hashes: [], deaths: 0, captures: 0 };
  const emit = sim.emit.bind(sim);
  sim.emit = (ev) => { if (ev.e === 'death') r.deaths++; if (ev.e === 'score' && ev.reason === 'captured') r.captures++; emit(ev); };
  return r;
}
const summary = (r) => ({ hashes: r.hashes, deaths: r.deaths, captures: r.captures, throws: ordnanceStats(r.sim).throws });

if (argv.includes('--child')) {
  const job = JSON.parse(opt('job', '{}'));
  const res = {};
  if (job.type === 'seq') {
    for (const p of job.pre) { const r = await make(p, job.preSeed); for (let i = 0; i < r.s.ticks; i++) r.room.tick(); r.room.dispose(); }
    const t = await make(job.target, job.seed);
    for (let i = 0; i < t.s.ticks; i++) { t.room.tick(); t.hashes.push(worldHash(t.sim)); }
    res.t = summary(t);
  } else if (job.type === 'one') {
    const t = await make(job.spec, job.seed);
    for (let i = 0; i < t.s.ticks; i++) { t.room.tick(); t.hashes.push(worldHash(t.sim)); }
    res.t = summary(t);
  } else {
    const a = await make(job.a, job.seedA);
    let b = null;
    const nb = parse(job.b).ticks;
    const n = Math.max(a.s.ticks, job.late + nb);
    for (let i = 0; i < n; i++) {
      if (i < a.s.ticks) { a.room.tick(); a.hashes.push(worldHash(a.sim)); }
      if (i === job.late) b = await make(job.b, job.seedB);
      if (b && b.hashes.length < nb) { b.room.tick(); b.hashes.push(worldHash(b.sim)); }
    }
    res.a = summary(a); res.b = summary(b);
  }
  writeFileSync(job.out, JSON.stringify(res)); // a file, not stdout: exit() can cut a long pipe write short
  process.exit(0);
}
const tmp = mkdtempSync(join(tmpdir(), 'q4det-'));
let jobs = 0;
const child = (job) => {
  const file = join(tmp, `job${jobs++}.json`);
  const r = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--child', '--job', JSON.stringify({ ...job, out: file })], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stdout + r.stderr);
  return JSON.parse(readFileSync(file, 'utf8'));
};
const firstDiff = (x, y) => { for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return i + 1; return x.length === y.length ? -1 : Math.min(x.length, y.length) + 1; };
const same = (x, y) => firstDiff(x.hashes, y.hashes) < 0 && x.deaths === y.deaths && x.captures === y.captures && x.throws === y.throws;
const line = (l, r) => `${l}: deaths ${r.deaths} captures ${r.captures} throws ${r.throws} last hash ${r.hashes.at(-1).toString(16)}`;
const t0 = Date.now();
let ok;
if (kind === 'sequential') {
  const target = opt('target', 'base-assault@the_lot:60'), seed = Number(opt('seed', 1));
  const pre = opt('pre', 'tdm:30').split(','), preSeed = Number(opt('pre-seed', seed));
  const alone = child({ type: 'seq', pre: [], target, seed, preSeed }).t;
  const after = child({ type: 'seq', pre, target, seed, preSeed }).t;
  ok = same(alone, after);
  console.log(`[q4-det] sequential · target ${target} seed ${seed} · pre ${pre.join(',')} (seed ${preSeed}) · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(`[q4-det] ${line('alone', alone)}`);
  console.log(`[q4-det] ${line('after', after)} · first divergent tick ${firstDiff(alone.hashes, after.hashes)}`);
} else {
  const A = opt('a', 'base-assault@the_lot:60'), B = opt('b', 'base-assault:60');
  const seedA = Number(opt('seed-a', 1)), seedB = Number(opt('seed-b', 2)), late = Number(opt('late', 0));
  const aAlone = child({ type: 'one', spec: A, seed: seedA }).t, bAlone = child({ type: 'one', spec: B, seed: seedB }).t;
  const both = child({ type: 'inter', a: A, b: B, seedA, seedB, late });
  ok = same(aAlone, both.a) && same(bAlone, both.b);
  console.log(`[q4-det] interleave · A ${A} (seed ${seedA}) + B ${B} (seed ${seedB}, created at A tick ${late}) · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(`[q4-det] A ${line('alone', aAlone)} | ${line('interleaved', both.a)} · first divergent tick ${firstDiff(aAlone.hashes, both.a.hashes)}`);
  console.log(`[q4-det] B ${line('alone', bAlone)} | ${line('interleaved', both.b)} · first divergent tick ${firstDiff(bAlone.hashes, both.b.hashes)}`);
}
console.log(`[q4-det] ${ok ? 'SAME' : 'DIFFERENT'}`);
process.exit(ok ? 0 : 1);
