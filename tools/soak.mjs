#!/usr/bin/env node
// Headless bot soak (L3 proof). Runs a real Room per match mode with bots on both teams, as fast as
// possible, and scores the result in the spirit of the game-sprint-gates skill (Realism · Intensity ·
// Fairness) plus hard limits. No humans: a stub Conn joins as a headless "net-bot" client that is
// driven by the same bot brain but goes through the full client path (sanitizeInput → input queue →
// InputCmd.rt lag compensation → packed snapshots), so the soak also exercises the network authority.
//
//   npx tsx tools/soak.mjs                      # 60 s per mode, soak match config (a full match fits in 60 s)
//   npx tsx tools/soak.mjs --seconds 300 --full # shipping match config, longer
//   options: --modes yard-skirmish,team-deathmatch,core-rush,base-assault (+ boss-rush,adventure: completion not required)  --seed 1  --no-netbot  --repeat 3  --json artifacts/soak.json
//            --map the_lot (default: the West Yard)
// Adventure always runs bot-only (a squad of four pups): with a "human" in the squad the reach steps wait for that
// human, and the net-bot is a combat brain that never walks to one (Q2 P2-8).
// Snapshot bandwidth is measured at wire size (the server's delta SnapEncoder, JSON text); raw JSON is reported too.
// --heap samples the authority's heap after a GC every simulated minute (run node with --expose-gc, e.g.
//   NODE_OPTIONS=--expose-gc npx tsx tools/soak.mjs --seconds 600 --repeat 1 --heap) and reports the growth per
//   minute after the first (MASTER_PLAN §8.7: no growth over a 10-minute soak).
//
// Exit 1 on: any runtime error / non-finite state, a bot stuck (wants to move, doesn't) > 5 s,
// tick p95 > 3 ms, or (soak config) a mode that never completes a match.
// Tick cost per Room.tick() = min(wall time, process CPU time): wall time is inflated by preemption on
// a busy shared machine, process CPU time by V8's background GC/JIT threads; the minimum is the tick's
// own work. The simulation is deterministic, so each mode runs --repeat times (default 3): the runs
// must produce identical outcomes (else it's a determinism error), and the timing gate uses the
// per-tick minimum across repeats (best-of-N filters out other processes on a shared machine). Raw
// single-run series are reported too. A per-system breakdown shows which lane owns the cost
// (L3 = ai + combat + match systems).
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadavg, cpus } from 'node:os';
import { dirname } from 'node:path';
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';
import { Team } from '../src/shared/types';
import { applyArchetype } from '../src/sim/ai';
import { weaponByIndex } from '../src/shared/content/weapons';
import { SnapEncoder, encodeServerMsg } from '../src/host/wire';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SECONDS = Number(opt('seconds', 60));
const SEED = Number(opt('seed', 1));
const MODES = opt('modes', 'yard-skirmish,team-deathmatch,core-rush,base-assault').split(',');
const MAP = opt('map', '');
const FULL = argv.includes('--full');
const NETBOT = !argv.includes('--no-netbot');
const OUT = opt('json', 'artifacts/soak.json');
const REPEAT = Math.max(1, Number(opt('repeat', 3)));
const HEAP = argv.includes('--heap');
const LIMITS = { maxStuckSec: 5, maxTickP95Ms: 3, maxErrors: 0 };
const DRAMA_BAND = [0.6, 4]; // drama events per player-minute (kills, wave clears, match results)
const MAX_DOWNTIME = 20;

/** Soak match config: short enough that a whole match (ending + restart) fits in 60 s. */
const SOAK_CONFIG = {
  'yard-skirmish': { skirmish: {
    warmup: 2, intermission: 2, endedHold: 4, spawnInterval: 0.5, wipeLives: 2, scaleMax: 1,
    waves: [{ counts: { grunt: 1 } }, { counts: { kitten: 1, sniper: 1 } }, { counts: { grunt: 1, brute: 1, kitten: 1 }, label: 'FINAL WAVE' }],
  } },
  'team-deathmatch': { tdm: { warmup: 3, killLimit: 12, timeLimit: 45, endedHold: 5 } },
  'core-rush': { coreRush: { warmup: 3, scoreLimit: 40, timeLimit: 45, endedHold: 5 } },
  // G4b: a capture takes a bot squad 40-120 s on the West Yard, so a 60 s soak ends its match at the horn
  'base-assault': { baseAssault: { warmup: 3, timeLimit: 45, endedHold: 5 } },
};
/** Bot lineups (after the net-bot, which plays an assault corgi): every class kit and both species. */
const LINEUP = {
  'yard-skirmish': [[Team.Corgis, 'infiltrator'], [Team.Corgis, 'skyraider'], [Team.Corgis, 'breacher'], [Team.Corgis, 'overwatch']],
  // mirrored so fairness numbers mean something (the net-bot is the corgi assault)
  'team-deathmatch': [[Team.Corgis, 'overwatch'], [Team.Corgis, 'breacher'], [Team.Corgis, 'warden'],
    [Team.Cats, 'assault'], [Team.Cats, 'overwatch'], [Team.Cats, 'breacher'], [Team.Cats, 'warden']],
  'core-rush': [[Team.Corgis, 'skyraider'], [Team.Corgis, 'breacher'], [Team.Corgis, 'warden'],
    [Team.Cats, 'assault'], [Team.Cats, 'skyraider'], [Team.Cats, 'breacher'], [Team.Cats, 'warden']],
  'base-assault': [[Team.Corgis, 'infiltrator'], [Team.Corgis, 'overwatch'], [Team.Corgis, 'assault'],
    [Team.Cats, 'assault'], [Team.Cats, 'infiltrator'], [Team.Cats, 'overwatch'], [Team.Cats, 'assault']],
  // the squad of four pups (plus the bot that stands in for the net-bot); the chapter re-kits them and brings the cats
  adventure: [[Team.Corgis, 'assault'], [Team.Corgis, 'assault'], [Team.Corgis, 'assault']],
};
/** Modes soaked without the net-bot whatever the flag says (see the header). */
const BOT_ONLY = new Set(['adventure']);
const OPEN_ENDED = new Set(['boss-rush', 'adventure']);
const L3_SYSTEMS = new Set(['ai', 'weapons', 'abilities', 'projectiles', 'combat-status', 'respawn-regen', 'lag-record', 'match']);

const pct = (arr, q) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };
const r2 = (v) => Math.round(v * 100) / 100;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** Heap samples (MB, one per simulated minute): first, last, and the least-squares growth per minute after minute 1. */
function heapTrend(h) {
  const tail = h.slice(1);
  let slope = 0;
  if (tail.length >= 2) {
    const n = tail.length, mx = (n - 1) / 2, my = tail.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    tail.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
    slope = num / den;
  }
  return { first: r2(h[0] ?? 0), last: r2(h[h.length - 1] ?? 0), samples: h.length, growthPerMin: r2(slope), gc: typeof globalThis.gc === 'function' };
}

async function soakMode(mode) {
  const sim = await Sim.create({ seed: SEED, ...(MAP ? { map: MAP } : {}) });
  const room = new Room(sim, { mode, botsPerTeam: [0, 0] });
  if (!FULL) sim.state.matchConfig = SOAK_CONFIG[mode];
  // per-system CPU cost (diagnostic: reaches into the Sim's system list at runtime)
  const sysCost = new Map();
  if (Array.isArray(sim.systems)) {
    for (const sys of sim.systems) {
      const update = sys.update.bind(sys);
      const acc = { total: 0 };
      sysCost.set(sys.name, acc);
      sys.update = (a, b) => { const c = process.cpuUsage(); update(a, b); const d = process.cpuUsage(c); acc.last = (d.user + d.system) / 1000; acc.total += acc.last; };
    }
  }

  // ---- telemetry
  const T = {
    errors: [], ticks: 0, tickMs: [], wallMs: [], cpuMs: [], aiMs: [], snapBytes: 0, wireBytes: 0, snaps: 0, results: [], heap: [],
    kills: 0, deaths: [0, 0], shots: 0, hitShots: 0, hits: 0, crits: 0, explosions: 0, abilities: 0, reloads: 0,
    firstLiveTick: -1, firstHitTick: -1, drama: [], matchesEnded: 0, winners: [], maxWave: 0,
    deadTicks: 0, charTicks: 0, stuckMax: 0, stuckBots: new Set(), kd: new Map(), midLeader: null,
  };
  const drain = sim.drainEvents.bind(sim);
  sim.drainEvents = () => {
    const evs = drain();
    for (const e of evs) {
      if (e.e === 'fire') { if (weaponByIndex(e.wpn)?.kind === 'hitscan') { T.shots++; if (e.hit >= 0) T.hitShots++; } }
      else if (e.e === 'hit') { T.hits++; if (e.crit) T.crits++; if (T.firstHitTick < 0 && T.firstLiveTick >= 0) T.firstHitTick = sim.tick; }
      else if (e.e === 'death') {
        T.kills++;
        const v = sim.entities.get(e.id);
        if (v) T.deaths[v.team] = (T.deaths[v.team] ?? 0) + 1;
        if (e.by !== e.id && e.by >= 0) T.kd.set(e.by, (T.kd.get(e.by) ?? 0) + 1);
        T.drama.push(sim.tick);
      }
      else if (e.e === 'explode') T.explosions++;
      else if (e.e === 'ability') T.abilities++;
      else if (e.e === 'reload') T.reloads++;
      else if (e.e === 'score' && (e.reason === 'wave' || e.reason === 'win' || e.reason === 'captured' || e.reason === 'ball taken')) T.drama.push(sim.tick);
      for (const k in e) if (typeof e[k] === 'number' && !Number.isFinite(e[k])) T.errors.push(`non-finite ${k} in ${e.e} event`);
    }
    return evs;
  };

  // ---- headless net-bot client (stub Conn) through the real input path
  let netbot = null;
  const withNetbot = NETBOT && !BOT_ONLY.has(mode);
  if (withNetbot) {
    const enc = new SnapEncoder(); // what server/app.ts sends by default ('delta' encoding)
    const conn = {
      id: 'netbot',
      send(msg) {
        if (msg.t !== 'snap') return;
        const json = JSON.stringify(msg);
        T.snapBytes += json.length; T.snaps++;
        T.wireBytes += encodeServerMsg(msg, enc).length;
        for (const row of msg.ents) for (const v of row) if (!Number.isFinite(v)) { T.errors.push('non-finite value in snapshot'); return; }
      },
    };
    const slot = room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: 'NetBot', team: Team.Corgis, cls: 'assault' });
    if (!slot) throw new Error('net-bot could not join');
    netbot = { slot, seq: 0 };
  }
  // explicit lineup (Room.addBot) so all six kits fight; fillBots only runs on join/leave
  if (!withNetbot) room.addBot(Team.Corgis, 'assault');
  for (const [team, cls] of LINEUP[mode] ?? LINEUP['team-deathmatch']) room.addBot(team, cls);
  const attachNetbot = () => {
    const e = sim.entities.get(netbot.slot.entity);
    if (e && !e.ai) applyArchetype(e, 'rifleman', { external: true });
    return e;
  };

  // ---- stuck tracking: wants to move (|input| > 0.5) but travels < 0.25 m per 0.5 s window
  const track = new Map();
  const sampleEvery = TICK_HZ / 2;

  const ticksTotal = Math.round(SECONDS * TICK_HZ);
  let lastPhase = room.match.phase, mid = Math.floor(ticksTotal / 2);
  const wall0 = performance.now();
  // the soak's own per-tick telemetry grows ~0.11 MB/min (4 number arrays): take it out, it isn't the room's
  const telemetryBytes = () => (T.tickMs.length + T.wallMs.length + T.cpuMs.length + T.aiMs.length) * 8;
  const heapSample = () => { globalThis.gc?.(); T.heap.push((process.memoryUsage().heapUsed - telemetryBytes()) / 1048576); };
  for (let i = 0; i < ticksTotal; i++) {
    if (HEAP && i % (TICK_HZ * 60) === 0) heapSample();
    if (netbot) {
      const e = attachNetbot();
      if (e?.ai) {
        const c = e.ai.out;
        const cmd = { seq: ++netbot.seq, mx: c.mx, mz: c.mz, yaw: c.yaw, pitch: c.pitch, buttons: c.buttons, rt: Math.max(0, sim.tick - 6) };
        room.handle(netbot.slot.pid, { t: 'input', cmds: [cmd] });
      }
    }
    const t0 = performance.now(), c0 = process.cpuUsage();
    try { room.tick(); } catch (err) { T.errors.push(String(err?.stack ?? err)); }
    const c1 = process.cpuUsage(c0), wall = performance.now() - t0, cpu = (c1.user + c1.system) / 1000;
    T.tickMs.push(Math.min(wall, cpu));
    T.wallMs.push(wall);
    T.cpuMs.push(cpu);
    const aiWall = sim.state.aiPerf?.ms ?? 0, aiCpu = sysCost.get('ai')?.last;
    T.aiMs.push(aiCpu === undefined ? aiWall : Math.min(aiWall, aiCpu));
    T.ticks++;
    const m = room.match;
    if (T.firstLiveTick < 0 && m.phase === 'live') T.firstLiveTick = sim.tick;
    if (m.phase === 'ended' && lastPhase !== 'ended') { T.matchesEnded++; T.winners.push(m.winner); T.results.push(`${m.score[0]}:${m.score[1]}${mode === 'yard-skirmish' ? ` w${m.wave}` : ''} ${['Corgis', 'Cats'][m.winner] ?? 'draw'} @${((sim.tick - T.firstLiveTick) / TICK_HZ).toFixed(0)}s`); T.drama.push(sim.tick); }
    lastPhase = m.phase;
    T.maxWave = Math.max(T.maxWave, m.wave);
    if (i === mid) T.midLeader = m.score[0] === m.score[1] ? -1 : m.score[0] > m.score[1] ? 0 : 1;
    for (const e of sim.entities.values()) {
      if (!e.char) continue;
      T.charTicks++;
      if (e.dead) T.deadTicks++;
      for (const k of ['x', 'y', 'z']) if (!Number.isFinite(e.pos[k]) || !Number.isFinite(e.vel[k])) { T.errors.push(`non-finite ${k} on ${e.name}`); break; }
      if (!e.ai) continue;
      let s = track.get(e.id);
      if (!s) { s = { x: e.pos.x, z: e.pos.z, odo: 0, want: 0, n: 0, stuck: 0 }; track.set(e.id, s); }
      s.odo += Math.hypot(e.pos.x - s.x, e.pos.z - s.z); s.x = e.pos.x; s.z = e.pos.z;
      const inp = e.ai.external ? e.ai.out : e.input;
      if (!e.dead && Math.hypot(inp.mx, inp.mz) > 0.5) s.want++;
      if (++s.n >= sampleEvery) {
        if (!e.dead && s.want >= sampleEvery * 0.9 && s.odo < 0.25) s.stuck += s.n / TICK_HZ; else s.stuck = 0;
        if (s.stuck > T.stuckMax) T.stuckMax = s.stuck;
        if (s.stuck > LIMITS.maxStuckSec) T.stuckBots.add(e.name);
        s.odo = 0; s.want = 0; s.n = 0;
      }
    }
    if (T.errors.length > 20) break;
  }
  const wallMs = performance.now() - wall0;
  const nav = sim.state.aiPerf?.navBuildMs ?? 0;
  if (HEAP) heapSample();
  const simSec = T.ticks / TICK_HZ;

  // ---- session (game-sprint-gates telemetry schema + L3 extras)
  const players = [...room.players.values()];
  let maxGap = 0, prev = T.firstLiveTick >= 0 ? T.firstLiveTick : 0;
  for (const d of [...T.drama].sort((a, b) => a - b)) { maxGap = Math.max(maxGap, (d - prev) / TICK_HZ); prev = d; }
  maxGap = Math.max(maxGap, (sim.tick - prev) / TICK_HZ);
  const kdTotal = [...T.kd.values()].reduce((a, b) => a + b, 0);
  const top = Math.max(0, ...T.kd.values());
  const finalWinner = T.winners.length ? T.winners[T.winners.length - 1] : (room.match.score[0] === room.match.score[1] ? -1 : room.match.score[0] > room.match.score[1] ? 0 : 1);
  const session = {
    mode, durationSec: r2(simSec), wallMs: Math.round(wallMs), players: withNetbot ? 1 : 0, bots: players.filter((p) => p.bot).length,
    completed: T.matchesEnded > 0, matchesEnded: T.matchesEnded, winners: T.winners, maxWave: T.maxWave, finalScore: room.match.score,
    tickMs: { p50: r2(pct(T.tickMs, 0.5)), p95: r2(pct(T.tickMs, 0.95)), max: r2(Math.max(...T.tickMs)) },
    tickWallMs: { p50: r2(pct(T.wallMs, 0.5)), p95: r2(pct(T.wallMs, 0.95)), max: r2(Math.max(...T.wallMs)) },
    tickCpuMs: { p50: r2(pct(T.cpuMs, 0.5)), p95: r2(pct(T.cpuMs, 0.95)), max: r2(Math.max(...T.cpuMs)) },
    results: T.results,
    systemMsPerTick: Object.fromEntries([...sysCost].map(([k, v]) => [k, Math.round((v.total / T.ticks) * 1000) / 1000])),
    l3MsPerTick: r2([...sysCost].filter(([k]) => L3_SYSTEMS.has(k)).reduce((a, [, v]) => a + v.total, 0) / T.ticks),
    characters: [...sim.entities.values()].filter((e) => e.char).length,
    aiMs: { p50: r2(pct(T.aiMs, 0.5)), p95: r2(pct(T.aiMs, 0.95)), max: r2(Math.max(...T.aiMs)) },
    navBuildMs: r2(nav),
    kills: T.kills, deathsByTeam: T.deaths, shots: T.shots, hitRate: r2(T.shots ? T.hitShots / T.shots : 0), critRate: r2(T.hits ? T.crits / T.hits : 0),
    explosions: T.explosions, abilities: T.abilities, reloads: T.reloads,
    timeToFirstEngagementSec: T.firstHitTick >= 0 ? r2((T.firstHitTick - T.firstLiveTick) / TICK_HZ) : null,
    deadTimeFrac: r2(T.charTicks ? T.deadTicks / T.charTicks : 0),
    maxDowntimeSec: r2(maxGap), stuckMaxSec: r2(T.stuckMax), stuckBots: [...T.stuckBots],
    snapshotKBps: r2(T.snaps ? T.wireBytes / 1024 / simSec : 0),
    snapshotRawJsonKBps: r2(T.snaps ? T.snapBytes / 1024 / simSec : 0),
    heapMB: HEAP ? heapTrend(T.heap) : null,
    netbot: withNetbot ? { kills: netbot.slot.kills, deaths: netbot.slot.deaths, starves: netbot.slot.net?.starves ?? 0 } : null,
    errors: T.errors.length, errorSamples: T.errors.slice(0, 3),
    topPlayerShare: r2(kdTotal ? top / kdTotal : 0),
    comeback: T.midLeader !== null && T.midLeader !== -1 && finalWinner !== -1 && finalWinner !== T.midLeader,
    events: { knockout: T.kills, drama: T.drama.length },
    desyncEvents: 0, stuckEvents: T.stuckBots.size, clippingEvents: 0, conservationViolations: 0, crashes: 0,
    fps: { p5: null, p50: null }, rttMs: { p50: null, p95: null }, inputLatencyMs: { p95: null },
  };

  // ---- scorecard (Realism · Intensity · Fairness, weights 0.40 / 0.35 / 0.25)
  const realism = 100 * (0.5 * clamp01(1 - (session.tickMs.p95 - 1) / (LIMITS.maxTickP95Ms * 1.5)) + 0.5 * clamp01(1 - (session.errors + session.stuckEvents * 0.2)));
  const playerMin = ((players.length) * simSec) / 60 || 1;
  const rate = T.drama.length / playerMin;
  const band = rate < DRAMA_BAND[0] ? rate / DRAMA_BAND[0] : rate > DRAMA_BAND[1] ? Math.max(0, 1 - (rate - DRAMA_BAND[1]) / DRAMA_BAND[1]) : 1;
  const intensity = 100 * (0.45 * band + 0.3 * clamp01(1 - Math.max(0, maxGap - MAX_DOWNTIME) / MAX_DOWNTIME) + 0.25 * (session.completed ? 1 : 0));
  const maxShare = mode === 'yard-skirmish' ? 0.6 : 0.35;
  const fairness = 100 * (0.7 * clamp01(1 - Math.max(0, session.topPlayerShare - maxShare) / (1 - maxShare)) + 0.3 * (session.comeback ? 1 : 0.5));
  session.score = { total: Math.round(0.4 * realism + 0.35 * intensity + 0.25 * fairness), realism: Math.round(realism), intensity: Math.round(intensity), fairness: Math.round(fairness), dramaPerPlayerMinute: r2(rate) };
  session.raw = { tick: T.tickMs, ai: T.aiMs };
  session.signature = JSON.stringify([T.ticks, T.kills, T.shots, T.hits, T.explosions, T.results, room.match.score, T.snapBytes]);
  return session;
}

/** Run a mode REPEAT times; outcomes must match; timing = per-tick minimum across the runs. */
async function soakRepeated(mode) {
  const runs = [];
  for (let r = 0; r < REPEAT; r++) runs.push(await soakMode(mode));
  const s = runs[0];
  s.repeats = REPEAT;
  s.deterministic = runs.every((x) => x.signature === s.signature);
  if (!s.deterministic) { s.errors++; s.errorSamples.push(`non-deterministic: repeat outcomes differ (${runs.map((x) => x.signature.slice(0, 60)).join(' | ')})`); }
  const n = Math.min(...runs.map((x) => x.raw.tick.length));
  const best = (k) => Array.from({ length: n }, (_, i) => Math.min(...runs.map((x) => x.raw[k][i])));
  const tick = best('tick'), ai = best('ai');
  s.tickSingleRunMs = s.tickMs;
  s.tickMs = { p50: r2(pct(tick, 0.5)), p95: r2(pct(tick, 0.95)), max: r2(Math.max(...tick)) };
  s.aiMs = { p50: r2(pct(ai, 0.5)), p95: r2(pct(ai, 0.95)), max: r2(Math.max(...ai)) };
  for (const x of runs) { delete x.raw; delete x.signature; }
  // Realism uses the best-of-N tick p95 (recompute the stored score)
  const R = 100 * (0.5 * clamp01(1 - (s.tickMs.p95 - 1) / (LIMITS.maxTickP95Ms * 1.5)) + 0.5 * clamp01(1 - (s.errors + s.stuckEvents * 0.2)));
  s.score.realism = Math.round(R);
  s.score.total = Math.round(0.4 * R + 0.35 * s.score.intensity + 0.25 * s.score.fairness);
  return s;
}

const load0 = loadavg()[0];
const sessions = [];
for (const mode of MODES) sessions.push(await soakRepeated(mode));
const load1 = loadavg()[0], cores = cpus().length;

const fails = [];
for (const s of sessions) {
  if (s.errors > LIMITS.maxErrors) fails.push(`${s.mode}: ${s.errors} errors (${s.errorSamples.join(' | ').slice(0, 300)})`);
  if (s.stuckMaxSec > LIMITS.maxStuckSec) fails.push(`${s.mode}: bot stuck ${s.stuckMaxSec}s (${s.stuckBots.join(', ')})`);
  if (s.tickMs.p95 > LIMITS.maxTickP95Ms) fails.push(`${s.mode}: tick p95 ${s.tickMs.p95} ms > ${LIMITS.maxTickP95Ms}`);
  // Boss-rush (one long boss fight) and adventure (chapter 1 takes a bot squad ~65 s) needn't finish inside a short
  // soak: for them completion is reported, not required.
  if (!FULL && !s.completed && !OPEN_ENDED.has(s.mode)) fails.push(`${s.mode}: no match completed in ${s.durationSec}s`);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), seed: SEED, map: MAP || 'west_yard', seconds: SECONDS, full: FULL, netbot: NETBOT, machine: { cores, load: [r2(load0), r2(load1)] }, sessions }, null, 2));

for (const s of sessions) {
  const sc = s.score;
  console.log(`${s.mode.padEnd(16)} score ${sc.total} (R ${sc.realism} · I ${sc.intensity} · F ${sc.fairness}) | ${s.durationSec}s sim in ${s.wallMs} ms | matches ${s.matchesEnded}: ${s.results.join(', ') || `none (wave ${s.maxWave}, ${s.finalScore.join(':')})`}`);
  console.log(`  kills ${s.kills} · hit ${Math.round(s.hitRate * 100)}% · crit ${Math.round(s.critRate * 100)}% · boom ${s.explosions} · abil ${s.abilities} · ttfe ${s.timeToFirstEngagementSec ?? '-'}s · dead ${Math.round(s.deadTimeFrac * 100)}% · downtime ${s.maxDowntimeSec}s · drama ${sc.dramaPerPlayerMinute}/p-min · top ${s.topPlayerShare}`);
  console.log(`  tick p50 ${s.tickMs.p50} p95 ${s.tickMs.p95} max ${s.tickMs.max} ms (best of ${s.repeats}${s.deterministic ? ', deterministic' : ', NON-DETERMINISTIC'}; single run p95 ${s.tickSingleRunMs.p95} · raw wall ${s.tickWallMs.p95} · cpu ${s.tickCpuMs.p95}; nav build ${s.navBuildMs} ms) · ai p95 ${s.aiMs.p95} ms · stuck max ${s.stuckMaxSec}s · errors ${s.errors}${s.netbot ? ` · net-bot k${s.netbot.kills}/d${s.netbot.deaths} snap ${s.snapshotKBps} KB/s wire (${s.snapshotRawJsonKBps} raw JSON)` : ''}`);
  if (s.heapMB) console.log(`  heap ${s.heapMB.first} → ${s.heapMB.last} MB over ${s.heapMB.samples} samples, ${s.heapMB.growthPerMin >= 0 ? '+' : ''}${s.heapMB.growthPerMin} MB/min after minute 1${s.heapMB.gc ? '' : ' (no --expose-gc: noisy)'}`);
  const sm = s.systemMsPerTick;
  if (Object.keys(sm).length) console.log(`  avg ms/tick: L3 ${s.l3MsPerTick} (ai ${sm.ai ?? 0} · weapons ${sm.weapons ?? 0} · projectiles ${sm.projectiles ?? 0} · match ${sm.match ?? 0}) · movement ${sm.movement ?? 0} · physics ${sm['physics-step'] ?? 0} · world ${sm['world-effects'] ?? 0} · chars ${s.characters}`);
}
const total = Math.round(sessions.reduce((a, s) => a + s.score.total, 0) / sessions.length);
const worst = (k) => Math.max(...sessions.map((s) => s.tickMs[k]));
console.log(`${fails.length ? 'SOAK FAIL' : 'SOAK PASS'} | score ${total} | modes ${sessions.length} · errors ${sessions.reduce((a, s) => a + s.errors, 0)} · stuck max ${Math.max(...sessions.map((s) => s.stuckMaxSec))}s · tick p95 ${worst('p95')} ms · completed ${sessions.filter((s) => s.completed).length}/${sessions.length} | ${OUT}`);
for (const f of fails) console.log(`  ✘ ${f}`);
if (Math.max(load0, load1) > cores) console.log(`  ! machine load ${r2(Math.max(load0, load1))} on ${cores} cores during the run: single-run timings are inflated; the gate uses best-of-${REPEAT} per tick${REPEAT < 3 ? ' (use --repeat 3+ on a shared machine)' : ''}`);
process.exit(fails.length ? 1 : 0);
