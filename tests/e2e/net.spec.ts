import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';

// Two browser pages play together through the Node authority (server/index.ts on a free port):
// each page must see the other player's entity move, and both must be predicting locally.
// Uses the default playwright.config.ts (Vite on :5173) plus a server spawned here.

let server: ChildProcess | null = null;
let port = 0;
const serverLog: string[] = [];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  });
}

test.beforeAll(async () => {
  port = await freePort();
  // Own process group (detached) so afterAll can stop npx + tsx + node together.
  server = spawn('npx', ['tsx', 'server/index.ts'], { env: {
    ...process.env, PORT: String(port), BOTS: '0,0', MODE: 'team-deathmatch', HOST: '127.0.0.1', LOG: '1',
    // This spec tests netcode, not timeouts (unit-tested in net-server.test.ts). SwiftShader frames on
    // a busy CI box can take 10+ s, during which Chrome stops reading the socket.
    IDLE_TIMEOUT_MS: '180000', PEER_TIMEOUT_MS: '180000', CONGESTION_KICK_MS: '180000',
  }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${serverLog.join('')}`)), 30_000);
    const onData = (d: Buffer) => {
      serverLog.push(String(d));
      if (/authority on ws:/.test(serverLog.join(''))) { clearTimeout(timer); resolve(); }
    };
    server!.stdout!.on('data', onData);
    server!.stderr!.on('data', (d: Buffer) => serverLog.push(String(d)));
    server!.once('exit', (code) => reject(new Error(`server exited ${code}:\n${serverLog.join('')}`)));
  });
});

function killGroup(s: ChildProcess, sig: NodeJS.Signals): void {
  try { if (s.pid) process.kill(-s.pid, sig); } catch { s.kill(sig); }
}

test.afterAll(async () => {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((resolve) => {
    s.once('exit', () => resolve());
    killGroup(s, 'SIGTERM'); // graceful shutdown path of server/app.ts
    setTimeout(() => { killGroup(s, 'SIGKILL'); resolve(); }, 6000);
  });
});

interface NetDebug { connected: boolean; predicting: boolean; localEntity: number; entities: [number, number, number, number, number][]; predErrCm: { p95: number }; rttMs: number; kbIn: number }
const dbg = (p: Page) => p.evaluate(() => {
  const c = (globalThis as unknown as { __cvc: { ready: boolean; localEntity: number; errors: string[]; net?: unknown } }).__cvc;
  return { ready: c.ready, localEntity: c.localEntity, errors: c.errors, net: c.net as NetDebug | undefined };
});
const posOf = async (viewer: Page, id: number) => {
  const d = await dbg(viewer);
  const e = d.net?.entities.find((x) => x[0] === id);
  return e ? { x: e[2], y: e[3], z: e[4] } : null;
};

async function open(page: Page, name: string, team: number): Promise<number> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Other lanes edit files while this runs; Vite's HMR socket would full-reload the page mid-test.
  // Stub only the dev server's HMR socket (port 5173); the game's socket goes to the Node server.
  await page.routeWebSocket((url) => url.port === '5173', () => { /* mocked: never sends updates */ });
  await page.goto(`/?webgl&autoplay&server=ws://127.0.0.1:${port}&name=${name}&team=${team}`);
  // Net readiness: connected with a spawned local entity and the frame loop running. (Not
  // __cvc.ready, which needs 6 rendered frames: SwiftShader on a busy CI box can take minutes.)
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(4000);
    const st = await page.evaluate(() => { const c = (globalThis as any).__cvc; return c && { frames: c.frames, localEntity: c.localEntity, fps: c.fps, errors: c.errors, net: c.net && { connected: c.net.connected, n: c.net.entities?.length, tick: c.net.tick } }; });
    console.log(`[dbg ${name} t=${(i + 1) * 4}]`, JSON.stringify(st));
  }
  console.log('[dbg server]', serverLog.join('').slice(-1500));
  await page.waitForFunction(() => {
    const c = (globalThis as unknown as { __cvc?: { frames: number; localEntity: number; net?: { connected: boolean; entities: unknown[] } } }).__cvc;
    return !!c?.net?.connected && c.localEntity > 0 && c.frames >= 2 && (c.net.entities?.length ?? 0) > 0;
  }, null, { timeout: 150_000, polling: 500 }); // timer polling: rAF polling starves at ~0 fps
  expect(errors).toEqual([]);
  return (await dbg(page)).localEntity;
}

async function holdAndCheck(mover: Page, moverId: number, viewer: Page) {
  await expect.poll(() => posOf(viewer, moverId), { timeout: 60_000, intervals: [500] }).not.toBeNull();
  const before = (await posOf(viewer, moverId))!;
  await mover.bringToFront();
  await mover.keyboard.down('KeyW');
  let moved = 0;
  await expect.poll(async () => {
    const now = await posOf(viewer, moverId);
    moved = now ? Math.hypot(now.x - before.x, now.z - before.z) : 0;
    return moved;
  }, { timeout: 90_000, intervals: [500] }).toBeGreaterThan(2);
  await mover.keyboard.up('KeyW');
  return moved;
}

test('two browser clients see each other move through the Node server', async ({ browser }) => {
  test.setTimeout(600_000); // ~30 s normally; SwiftShader on a saturated box can be ~100x slower
  const ctxA = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const ctxB = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const idA = await open(a, 'Alpha', 0);
  const idB = await open(b, 'Bravo', 1);
  expect(idA).toBeGreaterThan(0);
  expect(idB).toBeGreaterThan(0);

  const movedA = await holdAndCheck(a, idA, b);
  const movedB = await holdAndCheck(b, idB, a);

  const da = await dbg(a), db = await dbg(b);
  expect(da.net!.predicting).toBe(true);
  expect(db.net!.predicting).toBe(true);
  expect(da.errors).toEqual([]);
  expect(db.errors).toEqual([]);
  mkdirSync('artifacts', { recursive: true });
  await a.screenshot({ path: 'artifacts/l4-net-a.png' });
  await b.screenshot({ path: 'artifacts/l4-net-b.png' });
  console.log(`[net.e2e] A moved ${movedA.toFixed(2)} m as seen by B; B moved ${movedB.toFixed(2)} m as seen by A; A net=${JSON.stringify({ rtt: da.net!.rttMs, kbIn: da.net!.kbIn, predErrCm: da.net!.predErrCm })}`);
  await ctxA.close();
  await ctxB.close();
});
