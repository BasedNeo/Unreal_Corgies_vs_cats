import { test, expect, chromium, type Page, type Browser } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Two browser pages play together through the Node authority and must each see the other player's
// entity move, while predicting their own player locally.
//   1. server/index.ts on a free port, pages served by Vite (playwright.config.ts webServer).
//   2. server/prod.ts serving a fresh production build + /ws on ONE port (built into a temp dir here,
//      so a stale dist/ can never be tested by accident).
// SwiftShader on a busy CI box renders at ~1 fps, so waits are generous and poll on timers.

test.describe.configure({ mode: 'serial', retries: 1 });

interface Srv { proc: ChildProcess; port: number; log: string[] }
const servers: Srv[] = [];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  });
}

async function startServer(entry: string, extraEnv: Record<string, string>, ready: RegExp): Promise<Srv> {
  const port = await freePort();
  const log: string[] = [];
  // Own process group (detached) so we can stop npx + tsx + node together.
  const proc = spawn('npx', ['tsx', entry], {
    env: {
      ...process.env, PORT: String(port), BOTS: '0,0', MODE: 'team-deathmatch', HOST: '127.0.0.1', LOG: '1',
      // This spec tests netcode, not timeouts (unit-tested in net-server.test.ts). SwiftShader frames on
      // a busy box can take 10+ s, during which Chrome stops reading the socket.
      IDLE_TIMEOUT_MS: '180000', PEER_TIMEOUT_MS: '180000', CONGESTION_KICK_MS: '180000', HELLO_TIMEOUT_MS: '60000',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  const srv = { proc, port, log };
  servers.push(srv);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${entry} did not start:\n${log.join('')}`)), 60_000);
    proc.stdout!.on('data', (d: Buffer) => { log.push(String(d)); if (ready.test(log.join(''))) { clearTimeout(timer); resolve(); } });
    proc.stderr!.on('data', (d: Buffer) => log.push(String(d)));
    proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`${entry} exited ${code}:\n${log.join('')}`)); });
  });
  return srv;
}

function killGroup(s: ChildProcess, sig: NodeJS.Signals): void {
  try { if (s.pid) process.kill(-s.pid, sig); } catch { s.kill(sig); }
}

const extraBrowsers: Browser[] = [];
test.afterEach(async () => {
  for (const b of extraBrowsers.splice(0)) await b.close().catch(() => {});
  for (const s of servers.splice(0)) {
    await new Promise<void>((resolve) => {
      s.proc.once('exit', () => resolve());
      killGroup(s.proc, 'SIGTERM'); // graceful shutdown path of server/app.ts
      setTimeout(() => { killGroup(s.proc, 'SIGKILL'); resolve(); }, 6000);
    });
  }
});

interface NetDebug { connected: boolean; predicting: boolean; entities: [number, number, number, number, number][]; predErrCm: { p95: number }; rttMs: number; kbIn: number }
const dbg = (p: Page) => p.evaluate(() => {
  const c = (globalThis as unknown as { __cvc?: { localEntity: number; frames: number; errors: string[]; net?: unknown } }).__cvc;
  return c ? { localEntity: c.localEntity, frames: c.frames, errors: c.errors, net: c.net as NetDebug | undefined } : null;
});
const posOf = async (viewer: Page, id: number) => {
  const e = (await dbg(viewer))?.net?.entities.find((x) => x[0] === id);
  return e ? { x: e[2], y: e[3], z: e[4] } : null;
};

async function open(page: Page, url: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  // Net readiness: connected with a spawned local entity and the frame loop running. (Not
  // __cvc.ready, which needs 6 rendered frames.) Timer polling: rAF polling starves at ~1 fps.
  await page.waitForFunction(() => {
    const c = (globalThis as unknown as { __cvc?: { frames: number; localEntity: number; net?: { connected: boolean; entities: unknown[] } } }).__cvc;
    return !!c?.net?.connected && c.localEntity > 0 && c.frames >= 2 && (c.net.entities?.length ?? 0) > 0;
  }, null, { timeout: 150_000, polling: 500 });
  expect(errors).toEqual([]);
}

/** Hold W on `mover` until `viewer` sees the mover's entity travel > 2 m (re-resolving it after a reload). */
async function holdAndCheck(mover: Page, viewer: Page): Promise<number> {
  let id = -1, moved = 0;
  let start: { x: number; z: number } | null = null;
  await mover.bringToFront();
  await expect.poll(async () => {
    const me = (await dbg(mover))?.localEntity ?? -1;
    if (me !== id) { // first time, or the page was reloaded (dev-server HMR) and re-joined
      id = me; start = null;
      await mover.keyboard.up('KeyW');
      await mover.keyboard.down('KeyW');
    }
    const p = id > 0 ? await posOf(viewer, id) : null;
    if (!p) return 0;
    start ??= { x: p.x, z: p.z };
    moved = Math.hypot(p.x - start.x, p.z - start.z);
    return moved;
  }, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(2);
  await mover.keyboard.up('KeyW');
  return moved;
}

async function twoClients(browser: Browser, pageUrl: (name: string, team: number) => string, shot: string): Promise<void> {
  // W11: client B gets a browser (and a GPU process) of its own, like a second player on another machine. Two contexts
  // of one headless Chromium share one SwiftShader GPU process, so A's continuous rendering starved B's first-frame
  // shader compile (B sat at frame 1 for ~150 s, and the readiness wait timed out on a slow runner).
  const browserB = await chromium.launch(test.info().project.use.launchOptions);
  extraBrowsers.push(browserB);
  const ctxA = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const ctxB = await browserB.newContext({ viewport: { width: 480, height: 270 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await open(a, pageUrl('Alpha', 0));
  await open(b, pageUrl('Bravo', 1));
  const movedA = await holdAndCheck(a, b);
  const movedB = await holdAndCheck(b, a);
  const da = (await dbg(a))!, db = (await dbg(b))!;
  expect(da.net!.predicting).toBe(true);
  expect(db.net!.predicting).toBe(true);
  expect(da.errors).toEqual([]);
  expect(db.errors).toEqual([]);
  mkdirSync('artifacts', { recursive: true });
  await a.screenshot({ path: `artifacts/${shot}-a.png` });
  await b.screenshot({ path: `artifacts/${shot}-b.png` });
  console.log(`[net.e2e ${shot}] A moved ${movedA.toFixed(2)} m as seen by B; B moved ${movedB.toFixed(2)} m as seen by A; A net=${JSON.stringify({ rtt: da.net!.rttMs, kbIn: da.net!.kbIn, predErrCm: da.net!.predErrCm })}`);
  await ctxA.close();
  await ctxB.close();
}

test('two browser clients see each other move through the Node server (server/index.ts)', async ({ browser }) => {
  test.setTimeout(600_000); // ~30 s normally; SwiftShader on a saturated box can be ~100x slower
  const s = await startServer('server/index.ts', {}, /authority on ws:/);
  await twoClients(browser, (name, team) => `/?webgl&autoplay&server=ws://127.0.0.1:${s.port}&name=${name}&team=${team}`, 'l4-net');
});

test('the production server serves the build and the game socket on one port (server/prod.ts)', async ({ browser }) => {
  test.setTimeout(900_000);
  const out = mkdtempSync(path.join(tmpdir(), 'cvc-dist-'));
  try {
    const build = spawnSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { encoding: 'utf8', timeout: 300_000 });
    expect(build.status, `vite build failed:\n${build.stderr}`).toBe(0);
    const s = await startServer('server/prod.ts', { STATIC_DIR: out }, /Corgis vs Cats on http:/);
    const base = `http://127.0.0.1:${s.port}`;
    await twoClients(browser, (name, team) => `${base}/?webgl&autoplay&server=ws://127.0.0.1:${s.port}/ws&name=${name}&team=${team}`, 'l4-prod');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
