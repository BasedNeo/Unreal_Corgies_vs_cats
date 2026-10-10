// Bots-only slab balance on the web twin (W17 TW-SIM). It runs n matches of the real slab rules (src/sim/match/slab.ts)
// in the TS authority: no browser, no server. Each match is on The Lot, with one Sim per seed and the Room filling both
// teams with bots; it is ticked until the match ends. It started from G-BOT's W13 scratch script (docs/handoff/G-BOT.md
// §7). docs/qa/w17/WEB-CONTEST.md has the W17 tables it made.
//
//   npx tsx tools/slab-balance.ts [--format 1v1|2v2] [--n 40] [--seed 1] [--out results.jsonl] [--quiet]
//   npx tsx tools/slab-balance.ts --compare base.jsonl after.jsonl
//
// Seeds are deterministic: match k uses seed --seed + k, for k = 0 .. n-1, on the sim's seeded RNG. A seed replays the
// same match in any process. So two builds run on the same seeds form a paired comparison: when a winner changes, the
// change between the builds did it.
// Run mode prints one line per match:
// - the winner, the score, the length;
// - the downs per team;
// - slab time per team (pet-s on the slab);
// - edge-band time: on the slab, but less than 1 m from an edge (Godot test_bot_contest.gd's band).
// Then a summary: wins, the Cat share with its 95 % Wilson interval, a two-sided binomial p against an even split, points,
// downs, and the edge band as a share of slab time.
// --out writes one JSON line per match, appending, so blocks of seeds run in parallel processes can share one file.
// --compare reads two such files and prints, per format, each build's summary and the paired result: the seeds both
// played, how many winners changed and to which side (a two-sided sign test), and Fisher's exact p for the two win tables.
// To compare base with after, run this file in a copy of each build with --out, then --compare.
// Cost: about 7 s of CPU per match. For a large n, split the seeds over processes (--seed, --n) and run them niced.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import type { MatchState } from '../src/shared/protocol';
import { SLAB, onSlab } from '../src/shared/content/modes';
import { TICK_HZ } from '../src/shared/constants';

interface Row {
  format: '1v1' | '2v2';
  seed: number;
  winner: 'corgi' | 'cat' | 'draw';
  score: [number, number];
  seconds: number;
  downed: [number, number];
  onSlab: [number, number];
  band: [number, number];
}

const argv = process.argv.slice(2);
function arg(name: string, def: string): string {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}

/** The outer 1 m of the slab (the band Godot's contest test caps at 5 % of slab time). */
const EDGE = 1;
/** A slab match ends at 3:00 plus at most 60 s of overtime; this is a safety stop. */
const MAX_TICKS = 300 * TICK_HZ;

/** One bots-only slab match on The Lot for `seed`. */
async function play(format: '1v1' | '2v2', seed: number): Promise<Row> {
  const per = format === '2v2' ? 2 : 1;
  const sim = await Sim.create({ seed, map: 'the_lot' });
  const room = new Room(sim, { mode: 'slab', botsPerTeam: [per, per] });
  const hx = SLAB.size.x / 2 - EDGE, hz = SLAB.size.z / 2 - EDGE;
  const downed: [number, number] = [0, 0], on: [number, number] = [0, 0], band: [number, number] = [0, 0];
  const wasDead = new Map<number, boolean>();
  let live = false, ticks = 0;
  for (; ticks < MAX_TICKS; ticks++) {
    room.tick();
    for (const e of sim.entities.values()) {
      if (!e.char || (e.team !== 0 && e.team !== 1)) continue;
      // the Room drains the sim's events, so the downs are read from the state
      if (e.dead && wasDead.get(e.id) === false) downed[e.team]++;
      wasDead.set(e.id, e.dead);
    }
    const m = sim.state.match as MatchState | undefined;
    if (m?.phase === 'live') live = true;
    if (live && m?.phase === 'ended') break;
    for (const e of sim.entities.values()) {
      if (!e.char || e.dead || (e.team !== 0 && e.team !== 1) || !onSlab(e.pos.x, e.pos.y, e.pos.z)) continue;
      on[e.team]++;
      if (Math.abs(e.pos.x - SLAB.center.x) > hx || Math.abs(e.pos.z - SLAB.center.z) > hz) band[e.team]++;
    }
  }
  const m = sim.state.match as MatchState;
  room.dispose();
  const s = (t: number) => Math.round((t / TICK_HZ) * 100) / 100;
  return {
    format, seed, winner: m.winner === 0 ? 'corgi' : m.winner === 1 ? 'cat' : 'draw',
    score: [m.score[0], m.score[1]], seconds: s(ticks), downed, onSlab: [s(on[0]), s(on[1])], band: [s(band[0]), s(band[1])],
  };
}

// ------------------------------------------------------------------ statistics

const logFact: number[] = [0];
function lf(n: number): number {
  for (let i = logFact.length; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  return logFact[n];
}
const lchoose = (n: number, k: number) => lf(n) - lf(k) - lf(n - k);

/** Two-sided exact binomial p of k successes in n against p = 0.5 (the sum of outcomes no likelier than k). */
function binomP(k: number, n: number): number {
  if (n === 0) return 1;
  const obs = lchoose(n, k);
  let p = 0;
  for (let i = 0; i <= n; i++) { const l = lchoose(n, i); if (l <= obs + 1e-9) p += Math.exp(l - n * Math.LN2); }
  return Math.min(1, p);
}

/** Two-sided Fisher exact p for the table [[a, b], [c, d]]. */
function fisherP(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d, r1 = a + b, c1 = a + c;
  const lp = (x: number) => lchoose(r1, x) + lchoose(n - r1, c1 - x) - lchoose(n, c1);
  const obs = lp(a);
  let p = 0;
  for (let x = Math.max(0, c1 - (n - r1)); x <= Math.min(r1, c1); x++) { const l = lp(x); if (l <= obs + 1e-9) p += Math.exp(l); }
  return Math.min(1, p);
}

/** 95 % Wilson interval of k in n, in %. */
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96, p = k / n, den = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [100 * (c - h), 100 * (c + h)];
}

const f1 = (x: number) => x.toFixed(1);
const pp = (p: number) => (p < 0.001 ? '< 0.001' : p.toFixed(3));

function summary(tag: string, rows: Row[]): string {
  const corgi = rows.filter((r) => r.winner === 'corgi').length, cat = rows.filter((r) => r.winner === 'cat').length;
  const draws = rows.length - corgi - cat;
  const [lo, hi] = wilson(cat, corgi + cat);
  const sum = (f: (r: Row) => number) => rows.reduce((t, r) => t + f(r), 0);
  const on = sum((r) => r.onSlab[0] + r.onSlab[1]), band = sum((r) => r.band[0] + r.band[1]);
  return `${tag}: n ${rows.length} · Corgi ${corgi} · Cat ${cat} · draws ${draws} · Cat share ${f1((100 * cat) / Math.max(1, corgi + cat))} % `
    + `(95 % CI ${f1(lo)}-${f1(hi)} %) · p vs even ${pp(binomP(cat, corgi + cat))} · points ${sum((r) => r.score[0])}-${sum((r) => r.score[1])} `
    + `· downed ${sum((r) => r.downed[0])}-${sum((r) => r.downed[1])} · edge band ${(100 * band / Math.max(1e-9, on)).toFixed(2)} % of slab time `
    + `· mean length ${f1(sum((r) => r.seconds) / Math.max(1, rows.length))} s`;
}

function readRows(file: string): Row[] {
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Row);
}

// ------------------------------------------------------------------ main

if (argv.includes('--compare')) {
  const i = argv.indexOf('--compare');
  const [fa, fb] = [argv[i + 1], argv[i + 2]];
  if (!fa || !fb) { console.error('usage: npx tsx tools/slab-balance.ts --compare base.jsonl after.jsonl'); process.exit(2); }
  const A = readRows(fa), B = readRows(fb);
  for (const format of ['1v1', '2v2'] as const) {
    const a = new Map(A.filter((r) => r.format === format).map((r) => [r.seed, r]));
    const b = new Map(B.filter((r) => r.format === format).map((r) => [r.seed, r]));
    const seeds = [...a.keys()].filter((s) => b.has(s)).sort((x, y) => x - y);
    if (!seeds.length) continue;
    const ra = seeds.map((s) => a.get(s)!), rb = seeds.map((s) => b.get(s)!);
    console.log(`${format}, ${seeds.length} seeds played by both (${seeds[0]}-${seeds[seeds.length - 1]})`);
    console.log(`  ${summary(path.basename(fa), ra)}`);
    console.log(`  ${summary(path.basename(fb), rb)}`);
    const changed = seeds.filter((s) => a.get(s)!.winner !== b.get(s)!.winner);
    const toCat = changed.filter((s) => b.get(s)!.winner === 'cat').length, toCorgi = changed.filter((s) => b.get(s)!.winner === 'corgi').length;
    const toDraw = changed.length - toCat - toCorgi;
    const catA = ra.filter((r) => r.winner === 'cat').length, corgiA = ra.filter((r) => r.winner === 'corgi').length;
    const catB = rb.filter((r) => r.winner === 'cat').length, corgiB = rb.filter((r) => r.winner === 'corgi').length;
    console.log(`  paired: winners changed on ${changed.length} of ${seeds.length} seeds: ${toCat} to Cat, ${toCorgi} to Corgi${toDraw ? `, ${toDraw} to a draw` : ''} `
      + `(sign test p ${pp(binomP(toCat, toCat + toCorgi))}) · Fisher p ${pp(fisherP(catA, corgiA, catB, corgiB))}`);
  }
} else {
  const format = arg('format', '1v1') === '2v2' ? '2v2' : '1v1';
  const n = Math.max(1, Math.floor(Number(arg('n', '40'))));
  const seed0 = Math.floor(Number(arg('seed', '1')));
  const out = arg('out', '');
  const quiet = argv.includes('--quiet');
  if (out) mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const rows: Row[] = [];
  const t0 = Date.now();
  for (let k = 0; k < n; k++) {
    const r = await play(format, seed0 + k);
    rows.push(r);
    if (out) appendFileSync(out, `${JSON.stringify(r)}\n`);
    if (!quiet) {
      console.log(`${format} seed ${r.seed} · ${r.winner.toUpperCase()} · ${r.score[0]}-${r.score[1]} in ${f1(r.seconds)} s · downed ${r.downed[0]}-${r.downed[1]} `
        + `· on the slab ${f1(r.onSlab[0])}-${f1(r.onSlab[1])} pet-s · edge band ${f1(r.band[0])}-${f1(r.band[1])} pet-s`);
    }
  }
  console.log(summary(`${format} seeds ${seed0}-${seed0 + n - 1}`, rows) + ` · ${Math.round((Date.now() - t0) / 1000)} s real`);
}
