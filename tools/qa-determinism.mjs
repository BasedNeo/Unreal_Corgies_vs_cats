#!/usr/bin/env node
// D1 cross-sim determinism check. The Node server hosts many rooms in one process, so a room's outcome must not depend
// on which rooms ran before it in that process. This runs the target scenario alone in a fresh process (baseline),
// then in a second fresh process after the "pre" scenarios, and compares the two target runs tick by tick.
//
//   npx tsx tools/qa-determinism.mjs          # ch6 last_ball (60 s) alone vs after two TDM ticks: the D1 minimal pair
//   npx tsx tools/qa-determinism.mjs --target adventure:garage_job:90 --pre tdm:45,boss-rush:5 --seed 1
//   options: --target adventure:<chapter>:<seconds> | tdm:<seconds> | core-rush:<seconds> | yard-skirmish:<seconds>
//              | boss-rush:<seconds>   (or <n>t for n ticks: tdm:2t = tick 0 and tick 1, where the AI builds its nav)
//            --pre <spec>[,<spec>...]  (default tdm:2t; the pre runs' seed: --pre-seed, default --seed)
//            --seed N (default 1)   --dump-at <tick> (print every entity at that tick and the one before)
//            --json <file>
// Signature of a target run: a hash per tick of every entity's state (id, kind, position, velocity, yaw, pitch, hp,
// flags, dead), the adventure step ticks, deaths. Exit 1 when the two target runs differ (first divergent tick shown).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { TICK_HZ } from '../src/shared/constants';
import { Team } from '../src/shared/types';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SEED = Number(opt('seed', 1));
const PRE_SEED = Number(opt('pre-seed', SEED));
const TARGET = opt('target', 'adventure:last_ball:60');
const PRE = opt('pre', 'tdm:2t');
const OUT = opt('json', '');

/** The soak's short match configs (tools/soak.mjs) and a 4v4 bot lineup (every kit that can fly or drive). */
const CONFIG = {
  'team-deathmatch': { tdm: { warmup: 3, killLimit: 12, timeLimit: 45, endedHold: 5 } },
  'core-rush': { coreRush: { warmup: 3, scoreLimit: 40, timeLimit: 45, endedHold: 5 } },
  'yard-skirmish': { skirmish: { warmup: 2, intermission: 2, endedHold: 4, spawnInterval: 0.5, wipeLives: 2, scaleMax: 1,
    waves: [{ counts: { grunt: 1 } }, { counts: { kitten: 1, sniper: 1 } }, { counts: { grunt: 1, brute: 1, kitten: 1 }, label: 'FINAL WAVE' }] } },
};
const LINEUP = [
  [Team.Corgis, 'assault'], [Team.Corgis, 'overwatch'], [Team.Corgis, 'breacher'], [Team.Corgis, 'skyraider'],
  [Team.Cats, 'assault'], [Team.Cats, 'overwatch'], [Team.Cats, 'breacher'], [Team.Cats, 'skyraider'],
];

/** PvE modes: a squad of four corgi bots (adventure: the chapter re-kits them and brings the cats). */
const SQUAD = new Set(['adventure', 'boss-rush']);

/** Ticks of a length: "<n>t" ticks or seconds. */
const ticksOf = (v) => (v.endsWith('t') ? Number(v.slice(0, -1)) : Math.round(Number(v) * TICK_HZ));

function parse(spec) {
  const [kind, a, b] = spec.split(':');
  if (kind === 'adventure') return { mode: 'adventure', chapter: a, ticks: ticksOf(b ?? '60') };
  const mode = kind === 'tdm' ? 'team-deathmatch' : kind;
  if (!CONFIG[mode] && !SQUAD.has(mode)) throw new Error(`unknown scenario ${spec}`);
  return { mode, ticks: ticksOf(a ?? '45') };
}

// FNV-1a over the float64 bits of every value: any bit of drift shows.
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
function mix(h, v) {
  f64[0] = v;
  for (let k = 0; k < 2; k++) { h ^= u32[k]; h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
function entityHash(e) {
  let h = 2166136261;
  for (const v of [e.id, e.kind, e.pos.x, e.pos.y, e.pos.z, e.vel.x, e.vel.y, e.vel.z, e.yaw, e.pitch, e.health?.hp ?? -1, e.flags, e.dead ? 1 : 0]) h = mix(h, v);
  return h;
}
function worldHash(sim) {
  let h = 2166136261;
  for (const e of sim.entities.values()) h = mix(h, entityHash(e));
  return h;
}

async function run(spec, seed, record) {
  const s = parse(spec);
  const sim = await Sim.create({ seed });
  const room = new Room(sim, { mode: s.mode, botsPerTeam: SQUAD.has(s.mode) ? [4, 0] : [0, 0], ...(s.chapter ? { chapter: s.chapter } : {}) });
  if (!SQUAD.has(s.mode)) {
    sim.state.matchConfig = CONFIG[s.mode];
    for (const [team, cls] of LINEUP) room.addBot(team, cls);
  }
  const sig = { spec, seed, ticks: [], steps: [], deaths: 0, final: '' };
  const emit = sim.emit.bind(sim);
  let lastStep = -1;
  sim.emit = (ev) => {
    if (ev.e === 'death') sig.deaths++;
    emit(ev);
  };
  for (let i = 0; i < s.ticks; i++) {
    room.tick();
    if (record) {
      sig.ticks.push(worldHash(sim));
      if (sim.tick === DUMP_AT || sim.tick === DUMP_AT - 1) {
        for (const e of sim.entities.values()) console.log(`[dump] t${sim.tick} ${e.id} k${e.kind} ${e.name ?? ''} ${e.cls ?? ''} ${entityHash(e).toString(16)} p ${e.pos.x},${e.pos.y},${e.pos.z} v ${e.vel.x},${e.vel.y},${e.vel.z} yaw ${e.yaw} f ${e.flags} in ${JSON.stringify(e.input)}`);
      }
      const st = sim.state.adventure;
      const step = st && typeof st === 'object' ? st.step : undefined;
      if (typeof step === 'number' && step !== lastStep) { sig.steps.push(`${step}@${sim.tick}`); lastStep = step; }
    }
  }
  if (record) {
    sig.final = [...sim.entities.values()].filter((e) => e.char || e.kart || e.plane)
      .map((e) => `${e.id}:${e.pos.x.toFixed(3)},${e.pos.y.toFixed(3)},${e.pos.z.toFixed(3)}`).join(' ');
    // entity-level detail for the first divergent tick is recomputed by the caller from the per-tick hashes
  }
  room.dispose();
  return sig;
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i + 1; // sim.tick after that room.tick()
  return a.length === b.length ? -1 : n + 1;
}

const CHILD = argv.includes('--child');
const DUMP_AT = Number(opt('dump-at', -1));

if (CHILD) {
  // one process: the pre runs (if any), then the target; the signature goes to stdout as the last line
  const pres = PRE === 'none' ? [] : PRE.split(',');
  const t0 = performance.now();
  for (const p of pres) await run(p, PRE_SEED, false);
  const t1 = performance.now();
  const sig = await run(TARGET, SEED, true);
  sig.ms = { pre: Math.round(t1 - t0), target: Math.round(performance.now() - t1) };
  process.stdout.write(`\n${JSON.stringify(sig)}\n`);
  process.exit(0);
}

/** Run one scenario list in a fresh process (so nothing from this process leaks into it). */
function child(pre) {
  const args = [...process.execArgv, fileURLToPath(import.meta.url), '--child', '--target', TARGET, '--seed', String(SEED), '--pre', pre, '--pre-seed', String(PRE_SEED)];
  if (DUMP_AT >= 0) args.push('--dump-at', String(DUMP_AT));
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { process.stderr.write(r.stdout + r.stderr); throw new Error(`child (pre ${pre}) failed: ${r.status}`); }
  const lines = r.stdout.trim().split('\n');
  for (const l of lines.slice(0, -1)) if (l.startsWith('[dump]')) console.log(`${pre === 'none' ? 'alone' : 'after'} ${l}`);
  return JSON.parse(lines.at(-1));
}

const base = child('none');
const after = child(PRE);

const diffTick = firstDiff(base.ticks, after.ticks);
const same = diffTick < 0 && base.deaths === after.deaths && base.steps.join() === after.steps.join() && base.final === after.final;
const line = (label, s) => `${label}: steps [${s.steps.join(' ')}] deaths ${s.deaths} last-tick hash ${(s.ticks.at(-1) ?? 0).toString(16)} (${(s.ms.target / 1000).toFixed(1)} s)`;
console.log(`[d1] target ${TARGET} seed ${SEED} · alone (fresh process) vs after pre ${PRE} (seed ${PRE_SEED}, ${(after.ms.pre / 1000).toFixed(1)} s) in one process`);
console.log(`[d1] ${line('alone', base)}`);
console.log(`[d1] ${line('after', after)}`);
if (same) console.log('[d1] DETERMINISM: SAME (the pre runs did not change the target)');
else {
  console.log(`[d1] DETERMINISM: DIFFERENT, first divergent tick ${diffTick} (${(diffTick / TICK_HZ).toFixed(2)} s)`);
  if (base.final !== after.final) {
    const fa = base.final.split(' '), fb = after.final.split(' ');
    const d = fa.map((x, i) => (x !== fb[i] ? `${x} vs ${fb[i]}` : null)).filter(Boolean).slice(0, 6);
    console.log(`[d1] final positions differ: ${d.join(' · ')}`);
  }
}
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ target: TARGET, pre: PRE, seed: SEED, same, diffTick, alone: { ...base, ticks: undefined }, after: { ...after, ticks: undefined } }, null, 2));
}
process.exit(same ? 0 : 1);
