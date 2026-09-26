#!/usr/bin/env node
// Q3 verification probe (read-only): D1 says rooms in one process no longer affect each other. tools/qa-determinism.mjs
// checks rooms run one AFTER another. The Node server ticks its rooms INTERLEAVED (room A tick, room B tick, ...), and
// creates a room whenever its first player joins, so this checks that too:
//   baseline: each room alone in a fresh process;
//   interleaved: both rooms in one fresh process, ticked alternately, B created --late ticks after A (default 0).
// Every room's per-tick world hash must equal its baseline, tick for tick.
//   npx tsx tools/qa3-interleave.mjs --a tdm:45 --b adventure:last_ball:60 [--late 120] [--seed-a 1] [--seed-b 2]
// Specs as in qa-determinism.mjs: adventure:<chapter>:<s> | tdm:<s> | core-rush:<s> | yard-skirmish:<s> | boss-rush:<s>
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { TICK_HZ } from '../src/shared/constants';
import { Team } from '../src/shared/types';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const A = opt('a', 'tdm:45'), B = opt('b', 'adventure:last_ball:60');
const SA = Number(opt('seed-a', 1)), SB = Number(opt('seed-b', 2)), LATE = Number(opt('late', 0));
const CONFIG = {
  'team-deathmatch': { tdm: { warmup: 3, killLimit: 12, timeLimit: 45, endedHold: 5 } },
  'core-rush': { coreRush: { warmup: 3, scoreLimit: 40, timeLimit: 45, endedHold: 5 } },
  'yard-skirmish': { skirmish: { warmup: 2, intermission: 2, endedHold: 4, spawnInterval: 0.5, wipeLives: 2, scaleMax: 1,
    waves: [{ counts: { grunt: 1 } }, { counts: { kitten: 1, sniper: 1 } }, { counts: { grunt: 1, brute: 1, kitten: 1 }, label: 'FINAL WAVE' }] } },
};
const LINEUP = [[Team.Corgis, 'assault'], [Team.Corgis, 'overwatch'], [Team.Corgis, 'breacher'], [Team.Corgis, 'skyraider'],
  [Team.Cats, 'assault'], [Team.Cats, 'overwatch'], [Team.Cats, 'breacher'], [Team.Cats, 'skyraider']];
const SQUAD = new Set(['adventure', 'boss-rush']);
function parse(spec) {
  const [kind, a, b] = spec.split(':');
  if (kind === 'adventure') return { mode: 'adventure', chapter: a, ticks: Math.round(Number(b ?? 60) * TICK_HZ) };
  const mode = kind === 'tdm' ? 'team-deathmatch' : kind;
  return { mode, ticks: Math.round(Number(a ?? 45) * TICK_HZ) };
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
  const sim = await Sim.create({ seed });
  const room = new Room(sim, { mode: s.mode, botsPerTeam: SQUAD.has(s.mode) ? [4, 0] : [0, 0], ...(s.chapter ? { chapter: s.chapter } : {}) });
  if (!SQUAD.has(s.mode)) { sim.state.matchConfig = CONFIG[s.mode]; for (const [team, cls] of LINEUP) room.addBot(team, cls); }
  let deaths = 0;
  const emit = sim.emit.bind(sim);
  sim.emit = (ev) => { if (ev.e === 'death') deaths++; emit(ev); };
  return { s, sim, room, hashes: [], get deaths() { return deaths; } };
}

if (argv.includes('--child')) {
  const which = opt('which', 'both');
  const res = {};
  if (which === 'a' || which === 'b') {
    const r = await make(which === 'a' ? A : B, which === 'a' ? SA : SB);
    for (let i = 0; i < r.s.ticks; i++) { r.room.tick(); r.hashes.push(worldHash(r.sim)); }
    res[which] = { hashes: r.hashes, deaths: r.deaths };
  } else {
    const a = await make(A, SA);
    let b = null;
    const n = Math.max(a.s.ticks, LATE + parse(B).ticks);
    for (let i = 0; i < n; i++) {
      if (i < a.s.ticks) { a.room.tick(); a.hashes.push(worldHash(a.sim)); }
      if (i === LATE) b = await make(B, SB);
      if (b && b.hashes.length < b.s.ticks) { b.room.tick(); b.hashes.push(worldHash(b.sim)); }
    }
    res.a = { hashes: a.hashes, deaths: a.deaths }; res.b = { hashes: b.hashes, deaths: b.deaths };
  }
  process.stdout.write(`\n${JSON.stringify(res)}\n`);
  process.exit(0);
}
const child = (which) => {
  const r = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--child', '--which', which, '--a', A, '--b', B, '--seed-a', String(SA), '--seed-b', String(SB), '--late', String(LATE)], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stdout + r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').at(-1));
};
const firstDiff = (x, y) => { for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return i + 1; return x.length === y.length ? -1 : Math.min(x.length, y.length) + 1; };
const t0 = Date.now();
const aAlone = child('a').a, bAlone = child('b').b, both = child('both');
const da = firstDiff(aAlone.hashes, both.a.hashes), db = firstDiff(bAlone.hashes, both.b.hashes);
const same = da < 0 && db < 0 && aAlone.deaths === both.a.deaths && bAlone.deaths === both.b.deaths;
console.log(`[q3-interleave] A ${A} (seed ${SA}) + B ${B} (seed ${SB}, created at A tick ${LATE}), ticked alternately in one process · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`[q3-interleave] A: alone deaths ${aAlone.deaths} hash ${aAlone.hashes.at(-1).toString(16)} · interleaved deaths ${both.a.deaths} hash ${both.a.hashes.at(-1).toString(16)} · first divergent tick ${da}`);
console.log(`[q3-interleave] B: alone deaths ${bAlone.deaths} hash ${bAlone.hashes.at(-1).toString(16)} · interleaved deaths ${both.b.deaths} hash ${both.b.hashes.at(-1).toString(16)} · first divergent tick ${db}`);
console.log(`[q3-interleave] ${same ? 'SAME' : 'DIFFERENT'}`);
process.exit(same ? 0 : 1);
