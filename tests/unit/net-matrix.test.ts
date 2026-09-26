// Network matrix (MASTER_PLAN §9): 20/80/150 ms RTT x 0/1/3 % loss, in-process Room + Sim and three
// NetClients over the same frame path as the WebSocket server (validation, delta snapshots), on a
// virtual clock. Client 0 plays a scripted run/jump/double-jump/strafe/slide/ground-pound sequence;
// clients 1-2 random-walk. Measures prediction error at the acked input, visual corrections,
// remote interpolation error (client 1 watching client 0 vs ground truth), server input-buffer
// health and snapshot bandwidth. Writes artifacts/net-matrix.md.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { LoopbackSession, type LinkEmulation } from '../../src/client/net/loopback';
import { Btn, type InputCmd } from '../../src/shared/input';
import { mulberry32 } from '../../src/shared/rng';
import { TICK_HZ } from '../../src/shared/constants';

const DURATION_MS = 12_000;
const WARMUP_MS = 2_000;

/** Scripted local-player sequence: 6 s cycle, turning so the path stays near the spawn. */
export function scriptedInput(k: number): Partial<InputCmd> {
  const t = k / TICK_HZ;
  const phase = t % 6;
  let mx = 0, mz = 1, buttons = 0;
  if (phase >= 1.5 && phase < 1.7) buttons |= Btn.Jump;                  // jump while running
  if (phase >= 2 && phase < 3.5) { mx = 1; buttons |= Btn.Sprint; }       // sprint-strafe
  if (phase >= 2.6 && phase < 2.8) buttons |= Btn.Jump;                  // jump...
  if (phase >= 2.95 && phase < 3.1) buttons |= Btn.Jump;                 // ...double jump
  if (phase >= 3.5 && phase < 4.5) buttons |= Btn.Sprint;
  if (phase >= 3.8 && phase < 3.85) buttons |= Btn.Crouch;               // slide
  if (phase >= 4.5 && phase < 5.2) { mx = -1; mz = 0.3; }                // strafe left
  if (phase >= 5.2 && phase < 5.3) buttons |= Btn.Jump;                  // short hop
  if (phase >= 5.5 && phase < 5.55) buttons |= Btn.Crouch;               // ground pound
  if (phase >= 5.8) { mx = 0; mz = 0; }
  return { mx, mz, yaw: t * 0.9, pitch: -0.1, buttons };
}

function randomWalk(seed: number): (k: number) => Partial<InputCmd> {
  const rng = mulberry32(seed);
  let mx = 0, mz = 1, yaw = rng() * 6.28, until = 0, buttons = 0;
  return (k) => {
    if (k >= until) {
      until = k + 30 + Math.floor(rng() * 60);
      mx = rng() * 2 - 1; mz = rng() * 2 - 1; yaw += rng() * 2 - 1;
      buttons = rng() < 0.3 ? Btn.Sprint : 0;
    }
    return { mx, mz, yaw, pitch: 0, buttons: buttons | (k % 97 < 8 ? Btn.Jump : 0) };
  };
}

const q = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))] : 0);
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

interface CellResult {
  rtt: number; loss: number; jitter: number;
  errMean: number; errP95: number; errMax: number; samples: number;
  maxCorrection: number; snapsAfterSpawn: number; corrections: number;
  remoteMean: number; remoteP95: number; extrapPct: number; interpDelayMs: number;
  starves: number; catchups: number; drops: number; snapKBs: number; upKBs: number;
}

async function runCell(rtt: number, loss: number, seed: number, jitterOverride?: number): Promise<CellResult & { sane: boolean; moved: number }> {
  const sim = await Sim.create({ seed: 1 });
  // Neutral mode: no match rules/cat waves, so the numbers measure netcode, not combat balance.
  const room = new Room(sim, { mode: 'net-matrix', botsPerTeam: [0, 0] });
  const jitter = jitterOverride ?? Math.max(2, Math.round(rtt * 0.1));
  const link: LinkEmulation = { lagMs: rtt / 2, jitterMs: jitter, lossPct: loss };
  const truth = new Map<number, [number, number, number]>();
  let watched = -1;
  const session = new LoopbackSession(room, () => {
    const e = watched >= 0 ? sim.entities.get(watched) : undefined;
    if (e) truth.set(sim.tick, [e.pos.x, e.pos.y, e.pos.z]);
  });
  const errors: number[] = [], corrections: number[] = [], remote: number[] = [];
  let snaps = 0, extrap = 0, frames = 0;
  const measuring = () => session.loop.now > WARMUP_MS;
  const c0 = session.addClient({
    id: 'c0', up: link, down: link, seed: seed * 10 + 1, phaseMs: 5.3, input: scriptedInput,
    onReconcile: (r) => {
      if (!measuring()) return;
      if (Number.isFinite(r.error)) errors.push(r.error);
      if (r.snapped) snaps++; else if (r.correction > 0) corrections.push(r.correction);
    },
  });
  session.addClient({
    id: 'c1', up: link, down: link, seed: seed * 10 + 2, phaseMs: 9.1, input: randomWalk(seed * 10 + 2),
    onFrame: (now, states, net) => {
      if (!measuring() || watched < 0) return;
      const s = states.get(watched);
      if (!s) return;
      frames++;
      if (net.stats.extrapolating) extrap++;
      const t = net.renderTime(now) * TICK_HZ;
      const a = truth.get(Math.floor(t)), b = truth.get(Math.floor(t) + 1);
      if (!a || !b) return;
      const f = t - Math.floor(t);
      remote.push(Math.hypot(s.x - (a[0] + (b[0] - a[0]) * f), s.y - (a[1] + (b[1] - a[1]) * f), s.z - (a[2] + (b[2] - a[2]) * f)));
    },
  });
  session.addClient({ id: 'c2', up: link, down: link, seed: seed * 10 + 3, phaseMs: 12.7, input: randomWalk(seed * 10 + 3) });
  await session.run(300);
  watched = room.players.get('c0')!.entity;
  const startPos = { ...sim.entities.get(watched)!.pos };
  const snapBytes0 = c0.link.stats.snapBytes, upBytes0 = c0.link.stats.upBytes, t0 = session.loop.now;
  await session.run(DURATION_MS);
  const secs = (session.loop.now - t0) / 1000;
  const slot = room.players.get('c0')!;
  const endPos = sim.entities.get(slot.entity)!.pos;
  const h = sim.worldData.halfExtent + 5;
  const sane = [endPos.x, endPos.y, endPos.z].every(Number.isFinite) && Math.abs(endPos.x) < h && Math.abs(endPos.z) < h && endPos.y > sim.worldData.killY;
  const res: CellResult & { sane: boolean; moved: number } = {
    sane, moved: Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z),
    rtt, loss, jitter,
    errMean: mean(errors), errP95: q(errors, 0.95), errMax: Math.max(0, ...errors), samples: errors.length,
    maxCorrection: Math.max(0, ...corrections), snapsAfterSpawn: snaps, corrections: corrections.length,
    remoteMean: mean(remote), remoteP95: q(remote, 0.95), extrapPct: frames ? (100 * extrap) / frames : 0,
    interpDelayMs: session.clients[1].net.stats.interpDelayMs,
    starves: slot.net.starves, catchups: slot.net.catchups, drops: slot.net.drops,
    snapKBs: (c0.link.stats.snapBytes - snapBytes0) / 1024 / secs, upKBs: (c0.link.stats.upBytes - upBytes0) / 1024 / secs,
  };
  for (const c of [...session.clients]) session.removeClient(c);
  room.dispose();
  return res;
}

const cm = (m: number) => (m * 100).toFixed(2);

describe('network matrix (20/80/150 ms RTT x 0/1/3 % loss)', () => {
  it('keeps prediction error and corrections within budget in every cell', async () => {
    const rows: CellResult[] = [];
    let seed = 1;
    for (const rtt of [20, 80, 150]) for (const loss of [0, 1, 3]) rows.push(await runCell(rtt, loss, seed++));
    // Degradation discovery (legacy contract §5): 500 ms RTT / 10 % loss / 0-50 ms jitter. Recorded,
    // not budgeted: the game may feel poor but must not corrupt authority or deadlock.
    const deg = await runCell(500, 10, 99, 50);
    const header = '| RTT ms | loss % | jitter ms (each way) | pred err mean / p95 / max (cm) | samples | corrections (max cm) | snaps | remote interp err mean / p95 (cm) | extrap % | interp delay ms | server starves / catch-ups / drops | snapshot KB/s | input KB/s |';
    const sep = '|' + header.split('|').slice(1, -1).map(() => '---').join('|') + '|';
    const lines = rows.map((r) => `| ${r.rtt} | ${r.loss} | 0–${r.jitter} | ${cm(r.errMean)} / ${cm(r.errP95)} / ${cm(r.errMax)} | ${r.samples} | ${r.corrections} (${cm(r.maxCorrection)}) | ${r.snapsAfterSpawn} | ${cm(r.remoteMean)} / ${cm(r.remoteP95)} | ${r.extrapPct.toFixed(1)} | ${r.interpDelayMs.toFixed(0)} | ${r.starves} / ${r.catchups} / ${r.drops} | ${r.snapKBs.toFixed(2)} | ${r.upKBs.toFixed(2)} |`);
    const d = deg;
    lines.push(`| **500 (discovery)** | 10 | 0–${d.jitter} | ${cm(d.errMean)} / ${cm(d.errP95)} / ${cm(d.errMax)} | ${d.samples} | ${d.corrections} (${cm(d.maxCorrection)}) | ${d.snapsAfterSpawn} | ${cm(d.remoteMean)} / ${cm(d.remoteP95)} | ${d.extrapPct.toFixed(1)} | ${d.interpDelayMs.toFixed(0)} | ${d.starves} / ${d.catchups} / ${d.drops} | ${d.snapKBs.toFixed(2)} | ${d.upKBs.toFixed(2)} |`);
    const table = [header, sep, ...lines].join('\n');
    console.log(`\nNetwork matrix (${DURATION_MS / 1000} s per cell after 0.3 s join, metrics after ${WARMUP_MS / 1000} s; 3 clients, scripted client 0)\n${table}\n`);
    mkdirSync('artifacts', { recursive: true });
    writeFileSync('artifacts/net-matrix.md', `# Network matrix\n\nGenerated by tests/unit/net-matrix.test.ts on ${new Date().toISOString()}.\nEmulation: one-way lag = RTT/2 each direction, uniform jitter 0–J ms each direction (order preserved), loss on input (up) and snapshot (down) frames.\n\n${table}\n`);
    expect(deg.sane, 'authority state sane at 500 ms / 10 %').toBe(true);
    expect(deg.samples, 'reconciles keep flowing at 500 ms / 10 %').toBeGreaterThan(100);
    expect(deg.moved, 'player still controllable at 500 ms / 10 %').toBeGreaterThan(1);
    for (const r of rows) {
      const limit = r.rtt <= 80 && r.loss <= 1 ? 0.05 : 0.15;
      expect(r.samples, `samples @${r.rtt}/${r.loss}`).toBeGreaterThan(250);
      expect(r.errMean, `mean @${r.rtt}/${r.loss}`).toBeLessThan(limit);
      expect(r.errP95, `p95 @${r.rtt}/${r.loss}`).toBeLessThan(limit);
      expect(r.maxCorrection, `max correction @${r.rtt}/${r.loss}`).toBeLessThan(0.5);
      expect(r.snapsAfterSpawn, `snaps @${r.rtt}/${r.loss}`).toBe(0);
      expect(r.remoteP95, `remote p95 @${r.rtt}/${r.loss}`).toBeLessThan(0.25);
    }
  }, 180_000);
});
