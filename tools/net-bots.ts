// Headless load/soak client: N WebSocket players with random-walk inputs against a running server,
// using the real client stack (transport + NetClient + prediction). Reports server tick health
// (tick rate observed through snapshots, server-side tick ms from /stats), RTT via pings,
// snapshot rate/jitter, bandwidth and prediction error.
//
//   npx tsx tools/net-bots.ts [--url ws://localhost:8787] [--bots 12] [--seconds 60] [--room soak]
//                             [--warmup 5] [--lag 0 --jitter 0 --loss 0] [--no-predict] [--json artifacts/net-bots.json]
// Health numbers cover the steady state after --warmup seconds (connects, JIT, first-tick nav builds).
// Against the production server use --url ws://host:8080/ws. Exit code 1 if the soak is unhealthy
// (tick rate < 55 Hz, disconnects, RTT p95 > 250 ms + emulated lag, server tick avg > 8 ms).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createWebSocketTransport, type NetEmulation } from '../src/client/net/transport';
import { NetClient } from '../src/client/net/net-client';
import { LocalPredictor } from '../src/client/net/prediction';
import { bus } from '../src/client/core/events';
import { Btn, type InputCmd } from '../src/shared/input';
import { mulberry32 } from '../src/shared/rng';
import { TICK_HZ } from '../src/shared/constants';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
const URL0 = arg('url', 'ws://localhost:8787');
const BOTS = Math.max(1, Number(arg('bots', '12')));
const SECONDS = Math.max(1, Number(arg('seconds', '60')));
const ROOM = arg('room', 'soak');
const PREDICT = !process.argv.includes('--no-predict');
const JSON_OUT = arg('json', '');
const WARMUP = Math.max(0, Math.min(Number(arg('warmup', '5')), SECONDS / 2));
const em: NetEmulation = { lagMs: Number(arg('lag', '0')), jitterMs: Number(arg('jitter', '0')), lossPct: Number(arg('loss', '0')) };

const q = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))] : 0);

interface Bot {
  i: number;
  net: NetClient;
  seq: number;
  input: (k: number) => Partial<InputCmd>;
  firstTick: number;
  firstAt: number;
  rtts: number[];
  errors: number[];
  bigCorrections: number;
  disconnected: string | null;
}

function walker(seed: number): (k: number) => Partial<InputCmd> {
  const rng = mulberry32(seed);
  let mx = 0, mz = 1, yaw = rng() * 6.28, until = 0, buttons = 0;
  return (k) => {
    if (k >= until) {
      until = k + 30 + Math.floor(rng() * 90);
      mx = rng() * 2 - 1; mz = rng() * 2 - 0.5; yaw += rng() * 2 - 1;
      buttons = (rng() < 0.4 ? Btn.Sprint : 0) | (rng() < 0.2 ? Btn.Fire : 0);
    }
    return { mx, mz, yaw, pitch: 0, buttons: buttons | (k % 111 < 8 ? Btn.Jump : 0) };
  };
}

function withRoom(url: string): string {
  const u = new URL(url);
  if (!u.searchParams.has('room')) u.searchParams.set('room', ROOM);
  return u.toString();
}

async function main(): Promise<void> {
  const url = withRoom(URL0);
  const httpBase = URL0.replace(/^ws/, 'http').replace(/\/ws\/?(\?.*)?$/, '').replace(/\/(\?.*)?$/, '');
  console.log(`[net-bots] ${BOTS} bots -> ${url} for ${SECONDS}s (predict=${PREDICT}, emulation lag=${em.lagMs} jitter=${em.jitterMs} loss=${em.lossPct})`);
  const disconnects: string[] = [];
  let measuring = WARMUP === 0;
  bus.on('disconnected', (r) => disconnects.push(r));
  const bots: Bot[] = [];
  for (let i = 0; i < BOTS; i++) {
    const transport = await createWebSocketTransport(url, em.lagMs || em.jitterMs || em.lossPct ? em : null);
    const bot: Bot = { i, net: null as unknown as NetClient, seq: 0, input: walker(1000 + i), firstTick: -1, firstAt: 0, rtts: [], errors: [], bigCorrections: 0, disconnected: null };
    bot.net = new NetClient(transport, {
      predict: PREDICT, pingIntervalMs: 500,
      createPredictor: (seed) => LocalPredictor.create(seed),
      onReconcile: (r) => {
        if (!measuring) return;
        if (Number.isFinite(r.error)) bot.errors.push(r.error);
        if (!r.snapped && r.correction > 0.5) bot.bigCorrections++;
      },
    });
    transport.onClose((r) => { bot.disconnected = r; });
    bot.net.join(`Bot${i}`, 'assault', (i % 2) as 0 | 1);
    bots.push(bot);
  }
  const t0 = performance.now();
  let acc = 0, last = t0;
  const TICK = 1000 / TICK_HZ;
  const inputTimer = setInterval(() => {
    const now = performance.now();
    acc += now - last; last = now;
    let n = 0;
    while (acc >= TICK && n < 6) {
      acc -= TICK; n++;
      for (const b of bots) {
        if (!b.net.connected) continue;
        const k = ++b.seq;
        b.net.pushInput({ seq: k, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, ...b.input(k), rt: Math.max(0, Math.round(b.net.renderTime(now) * b.net.tickHz)) });
      }
    }
    if (n === 6) acc = 0;
    for (const b of bots) {
      b.net.flush();
      b.net.interpolated(now);
      const snap = b.net.latest();
      if (snap && b.firstTick < 0 && measuring) { b.firstTick = snap.tick; b.firstAt = now; }
    }
  }, 4);
  const sampler = setInterval(() => { if (measuring) for (const b of bots) if (b.net.stats.rttMs) b.rtts.push(b.net.stats.rttMs); }, 500);
  type RoomLine = { name: string; tickMsAvg: number; tickMsMax: number; overruns: number; inputStarves: number; inputCatchups: number; inputDrops: number; humans: number };
  const readRoom = async (reset: boolean): Promise<RoomLine | null> => {
    try {
      const res = await fetch(`${httpBase}/stats${reset ? '?reset=1' : ''}`);
      const js = await res.json() as { rooms?: RoomLine[] };
      return js.rooms?.find((r) => r.name === ROOM) ?? null;
    } catch (err) {
      console.log(`[net-bots] could not read ${httpBase}/stats: ${err}`);
      return null;
    }
  };
  let roomAtWarmup: RoomLine | null = null;
  const warm = setTimeout(async () => {
    roomAtWarmup = await readRoom(true);
    for (const b of bots) b.firstTick = -1; // re-measure tick rate from here
    measuring = true;
    console.log(`[net-bots] warm-up (${WARMUP}s) done; measuring steady state`);
  }, WARMUP * 1000);

  const report = (final: boolean) => {
    const now = performance.now();
    const rtts = bots.flatMap((b) => b.rtts);
    const rates = bots.filter((b) => b.firstTick >= 0 && b.net.latest()).map((b) => (b.net.latest()!.tick - b.firstTick) / ((now - b.firstAt) / 1000));
    const errs = bots.flatMap((b) => b.errors);
    const line = {
      t: +((now - t0) / 1000).toFixed(1),
      connected: bots.filter((b) => b.net.connected).length,
      tickHz: +q(rates, 0.5).toFixed(1),
      tickHzMin: +Math.min(...(rates.length ? rates : [0])).toFixed(1),
      rttP50: +q(rtts, 0.5).toFixed(1), rttP95: +q(rtts, 0.95).toFixed(1),
      snapsPerSec: +q(bots.map((b) => b.net.stats.snapshotsPerSec), 0.5).toFixed(1),
      jitterMs: +q(bots.map((b) => b.net.stats.jitterMs), 0.95).toFixed(2),
      kbIn: +q(bots.map((b) => b.net.stats.kbIn), 0.5).toFixed(2),
      kbOut: +q(bots.map((b) => b.net.stats.kbOut), 0.5).toFixed(2),
      predErrP95Cm: +(q(errs, 0.95) * 100).toFixed(2), predErrMaxCm: +(Math.max(0, ...errs) * 100).toFixed(2),
      bigCorrections: bots.reduce((s, b) => s + b.bigCorrections, 0),
      disconnects: disconnects.length,
    };
    console.log(`[net-bots]${final ? ' FINAL' : ''} ${JSON.stringify(line)}`);
    return line;
  };
  const periodic = setInterval(() => report(false), 5000);
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(periodic);
  const final = report(true);
  clearTimeout(warm);
  const room = await readRoom(false);
  const w = roomAtWarmup as RoomLine | null;
  const steady = room && w ? {
    tickMsAvg: room.tickMsAvg, tickMsMax: room.tickMsMax, overruns: room.overruns,
    starvesPerPlayerMin: +(((room.inputStarves - w.inputStarves) / Math.max(1, room.humans)) / ((SECONDS - WARMUP) / 60)).toFixed(2),
    catchups: room.inputCatchups - w.inputCatchups, drops: room.inputDrops - w.inputDrops,
  } : null;
  console.log(`[net-bots] server room '${ROOM}' steady state ${JSON.stringify(steady ?? room)}`);
  clearInterval(inputTimer);
  clearInterval(sampler);
  for (const b of bots) { b.net.dispose(); b.net.transport.close(); }
  const problems: string[] = [];
  if (final.tickHzMin < 55) problems.push(`tick rate ${final.tickHzMin} Hz < 55`);
  if (final.disconnects > 0 || final.connected < BOTS) problems.push(`${final.disconnects} disconnects (${final.connected}/${BOTS} connected)`);
  if (final.rttP95 > 250 + 2 * em.lagMs) problems.push(`RTT p95 ${final.rttP95} ms`);
  if (room && room.tickMsAvg > 8) problems.push(`server tick avg ${room.tickMsAvg} ms`);
  // Corrections > 0.5 m are reported, not failed: in a live match they include legitimate authority
  // forces prediction cannot know (knockback, explosions). The scripted matrix test budgets them.
  if (final.bigCorrections > 0) console.log(`[net-bots] note: ${final.bigCorrections} corrections > 0.5 m (knockback etc.)`);
  const summary = { url, bots: BOTS, seconds: SECONDS, warmup: WARMUP, predict: PREDICT, emulation: em, final, serverRoom: steady ?? room ?? null, healthy: problems.length === 0, problems };
  if (JSON_OUT) {
    mkdirSync(path.dirname(JSON_OUT), { recursive: true });
    writeFileSync(JSON_OUT, JSON.stringify(summary, null, 2));
    console.log(`[net-bots] wrote ${JSON_OUT}`);
  }
  console.log(problems.length ? `[net-bots] UNHEALTHY: ${problems.join('; ')}` : '[net-bots] HEALTHY');
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => { console.error('[net-bots] failed:', err); process.exit(1); });
