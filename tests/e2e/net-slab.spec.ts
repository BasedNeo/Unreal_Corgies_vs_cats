import { test, expect, chromium, type Page, type Browser, type BrowserContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { TICK_HZ } from '../../src/shared/constants';
import { SLAB as SLAB_CFG, onSlab } from '../../src/shared/content/modes';

// W15 Sprint D (TW-VIEW): two people play the slab match together online. The Node authority (server/index.ts) runs
// a named slab room; two pages, each in a browser of its own (one SwiftShader GPU process each, as net.spec.ts),
// join it from opposite sides: Alpha the Corgis (&team=0), Bravo the Cats (&team=1). A named room is set up from its
// first joiner's ?mode=slab (botsForMode('slab'): a bot a side), and the bot fill drops a side's bot when a human
// takes that side, so it is a 1 v 1 of people. Then:
//   1. each page sees the other player's pet, and its own YOU line names its own side;
//   2. the score and the clock agree on both pages: every snapshot tick both pages logged carries the same timeLeft,
//      score and phase (__cvc.twin.log), compared at the start (0 - 0), at the takedown, while the Corgis score (3
//      points or more) and at the end (the result); the HUD's clock and scores read the same within a second;
//   3. both walk toward the slab at once and stop clearly off it, Bravo for good (the Cats never score); Alpha turns
//      to Bravo, closes to 10 m across the slab and fires until Bravo is down. The kill feed shows "Alpha  >  Bravo"
//      on both pages; the death panel shows only on Bravo's, naming Alpha and Corgi Company. Shots: each page once
//      Alpha has first aimed (artifacts/net-slab-{a,b}-aim.png, both pets standing) and when Bravo's panel shows
//      (artifacts/net-slab-{a,b}.png);
//   4. Alpha holds the slab until the match ends; R on Alpha's page, pressed once the authority's own clock is
//      SLAB.rematchDelay past the end (its tick: the server drops time on overrun, so a wall-clock wait can lose the
//      press), rematches both pages to 0 - 0 from a non-zero result. The HUD's cue resets on a rematch (no death
//      panel, confirm, wedge, flash or feed line) are not checked here: the takedown's cues are normally long gone
//      when R lands, so such a check would pass without the reset. They are proven offline by modes.spec.ts (SLAB
//      rematch, a feed line up when R lands) and tests/unit/slab-hud.test.ts §5.
// Turning: a test-only gamepad (init script) feeds input.ts's right stick for an exact number of samples, so the view
// turns by an exact angle (input.ts: yaw -= x * 3.2 * dt, pitch -= y * 2.2 * dt, dt = 1/60 per sample); RT fires,
// LT aims. Pages run at 640 x 360 and quality low: the authority moves a pet only by the inputs its page sends, one
// per frame (a frame's step is capped at 0.25 s), so slow SwiftShader frames walk it slower.
// Ports (CI and agents): the authority on the first free port from NET_SLAB_PORT (default 8791) up to 8799; the pages
// from playwright's webServer. On a failure the spec prints the server log and, per page, the reason of any bus
// 'disconnected' (main.ts logs "[net] disconnected: <reason>" to the console), its net state, text and console tail.

test.describe.configure({ mode: 'serial' });

const PORT0 = Number(process.env.NET_SLAB_PORT ?? 8791);
let PORT = PORT0;
const VIEW = { width: 640, height: 360 };
const SLAB = { x: SLAB_CFG.center.x, z: SLAB_CFG.center.z }; // the slab's centre on the ground
const TICK_DT = 1 / 60;

let server: { proc: ChildProcess; log: string[] } | null = null;
const browsers: Browser[] = [];
const pages: Page[] = [];
const consoles: string[][] = [];

function killGroup(s: ChildProcess, sig: NodeJS.Signals): void {
  try { if (s.pid) process.kill(-s.pid, sig); } catch { s.kill(sig); }
}

/** Whether `port` can be bound on 127.0.0.1 now. */
const portFree = (port: number) => new Promise<boolean>((resolve) => {
  const t = createServer();
  t.once('error', () => resolve(false));
  t.listen(port, '127.0.0.1', () => t.close(() => resolve(true)));
});
/** Wait until the authority's port is free (a stopped server's socket can linger for a few seconds). */
async function waitPortFree(port: number, ms = 30_000): Promise<void> {
  const t0 = Date.now();
  while (!(await portFree(port))) {
    if (Date.now() - t0 > ms) throw new Error(`port ${port} still in use after ${ms / 1000} s`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function startServer(): Promise<void> {
  for (let port = PORT0; port <= Math.max(PORT0, 8799); port++) {
    if (!(await portFree(port))) continue;
    PORT = port;
    try { await startServerOn(); return; } catch (err) { if (!/EADDRINUSE/.test(String(err))) throw err; } // taken meanwhile
  }
  throw new Error(`no free port in ${PORT0}..8799`);
}

async function startServerOn(): Promise<void> {
  const log: string[] = [];
  const proc = spawn('npx', ['tsx', 'server/index.ts'], {
    env: {
      ...process.env, PORT: String(PORT), HOST: '127.0.0.1', MODE: 'slab', LOG: '1', // (the room's bots: its URL setup)
      // SwiftShader frames on a busy box can take seconds; this spec tests play, not timeouts or the abuse meter
      // (net-server tests cover those), so both are relaxed (KICK_SCORE: no code reason found, docs/handoff/TW-VIEW.md)
      IDLE_TIMEOUT_MS: '180000', PEER_TIMEOUT_MS: '180000', CONGESTION_KICK_MS: '180000', HELLO_TIMEOUT_MS: '60000', KICK_SCORE: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true, // its own process group: npx + tsx + node stop together
  });
  server = { proc, log };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${log.join('')}`)), 60_000);
    proc.stdout!.on('data', (d: Buffer) => { log.push(String(d)); if (/authority on ws:/.test(log.join(''))) { clearTimeout(timer); resolve(); } });
    proc.stderr!.on('data', (d: Buffer) => log.push(String(d)));
    proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}:\n${log.join('')}`)); });
  });
}

test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) {
    if (server) console.log(`[net-slab] server log (tail):\n${server.log.join('').slice(-6000)}`);
    for (const [i, p] of pages.entries()) {
      const d = await p.evaluate(() => {
        const text = document.body.innerText.replace(/\s+/g, ' ');
        const net = (globalThis as unknown as { __cvc?: { net?: Record<string, unknown> } }).__cvc?.net ?? {};
        return { disconnected: /Disconnected: [^.·]*/.exec(text)?.[0] ?? 'none', net: { connected: net.connected, tick: net.tick, rttMs: net.rttMs, pending: net.pending }, text: text.slice(0, 600) };
      }).catch((e) => ({ error: String(e) }));
      const reasons = consoles[i]?.filter((l) => /\[net\] disconnected:/.test(l)) ?? [];
      console.log(`[net-slab] page ${'AB'[i]}: disconnect reason: ${reasons.join(' | ') || 'none logged'}; ${JSON.stringify(d)}\n  console: ${consoles[i]?.slice(-30).join('\n  ') ?? ''}`);
    }
  }
  pages.length = 0;
  consoles.length = 0;
  for (const b of browsers.splice(0)) await b.close().catch(() => {});
  const s = server;
  server = null;
  if (s) {
    await new Promise<void>((resolve) => {
      s.proc.once('exit', () => resolve());
      killGroup(s.proc, 'SIGTERM');
      setTimeout(() => { killGroup(s.proc, 'SIGKILL'); resolve(); }, 6000);
    });
    await waitPortFree(PORT).catch(() => killGroup(s.proc, 'SIGKILL'));
  }
});

/** The test-only gamepad: right stick for `n` samples at a time (queue), RT / LT held by flags. */
const PAD_INIT = () => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const pad = { id: 'e2e pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons, vibrationActuator: null };
  const P = { turns: [] as Array<{ x: number; y: number; n: number }>, fire: false, aim: false, samples: 0 };
  (window as unknown as { __pad: typeof P }).__pad = P;
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => {
      P.samples++;
      const t = P.turns[0];
      pad.axes[2] = t ? t.x : 0;
      pad.axes[3] = t ? t.y : 0;
      if (t && --t.n <= 0) P.turns.shift();
      buttons[7].pressed = P.fire;
      buttons[6].pressed = P.aim;
      return [pad];
    },
  });
};

interface Twin {
  match: { phase: string; score: [number, number]; timeLeft: number; tick: number } | null;
  restarts: number; restartScore: [number, number] | null;
  log: Array<[number, number, number, number, string]>;
  view: { yaw: number; pitch: number };
}
interface State {
  me: number; local: { x: number; y: number; z: number; hp: number; flags: number } | null;
  ents: [number, number, number, number, number][]; twin: Twin;
}
const state = (p: Page): Promise<State> => p.evaluate(() => {
  const c = (globalThis as unknown as { __cvc: { localEntity: number; local: State['local']; net?: { entities: State['ents'] }; twin: Twin } }).__cvc;
  return { me: c.localEntity, local: c.local, ents: c.net?.entities ?? [], twin: JSON.parse(JSON.stringify(c.twin)) as Twin };
});
const hud = (p: Page) => p.evaluate(() => {
  const q = (s: string) => document.querySelector(s) as HTMLElement | null;
  const shown = (s: string) => { const e = q(s); return !!e && getComputedStyle(e).display !== 'none'; };
  return {
    s0: q('#cvc-slab [data-slab-s0]')?.textContent ?? '', s1: q('#cvc-slab [data-slab-s1]')?.textContent ?? '',
    clock: q('#cvc-slab [data-slab-clock]')?.textContent ?? '',
    death: shown('#cvc-slab [data-slab-death]') ? [...document.querySelectorAll('#cvc-slab [data-slab-death] > div')].map((d) => d.textContent ?? '') : null,
    feed: [...document.querySelectorAll('#cvc-hud .kf .kf-e')].map((e) => e.textContent ?? ''),
  };
});
const DEAD = 16; // EFlag.Dead
const clockSecs = (t: string) => { const m = /^(\d+):(\d\d)$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Both pages' snapshot logs agree at every tick both logged (at least 10): same timeLeft, score and phase. */
async function sameLog(a: Page, b: Page, what: string): Promise<{ common: number; last: [number, number, number, number, string] }> {
  const [la, lb] = await Promise.all([state(a), state(b)]);
  const byTick = new Map(la.twin.log.map((r) => [r[0], r]));
  const common = lb.twin.log.filter((r) => byTick.has(r[0]));
  expect(common.length, `${what}: common snapshot ticks`).toBeGreaterThanOrEqual(10);
  for (const r of common) expect(byTick.get(r[0]), `${what}: tick ${r[0]}`).toEqual(r);
  return { common: common.length, last: common.at(-1)! };
}

async function openPlayer(browser: Browser, url: string): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: VIEW });
  const page = await ctx.newPage();
  pages.push(page);
  const log: string[] = [];
  consoles.push(log);
  page.on('console', (m) => { log.push(`${m.type()}: ${m.text().slice(0, 300)}`); if (log.length > 200) log.shift(); });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PAD_INIT);
  await page.goto(url);
  return { ctx, page, errors };
}

async function ready(page: Page): Promise<void> {
  // connected, spawned, a few frames drawn, and the slab HUD up (timer polling: rAF polling starves on slow frames)
  await page.waitForFunction(() => {
    const c = (globalThis as unknown as { __cvc?: { frames: number; localEntity: number; local: unknown; net?: { connected: boolean }; twin?: { match: unknown } } }).__cvc;
    const slab = document.querySelector('#cvc-slab') as HTMLElement | null;
    return !!c?.net?.connected && c.localEntity > 0 && !!c.local && c.frames >= 3 && !!c.twin?.match && !!slab && slab.style.display !== 'none';
  }, null, { timeout: 240_000, polling: 500 });
}

/** Hold W (and Shift) on `page` until `stop(state)` says so; returns the last state. */
async function walk(page: Page, stop: (s: State) => boolean, what: string, ms = 180_000): Promise<State> {
  await page.bringToFront();
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const t0 = Date.now();
  let s = await state(page);
  let last = s.local, still = 0;
  try {
    while (!stop(s)) {
      if (Date.now() - t0 > ms) throw new Error(`walk (${what}) timed out at ${JSON.stringify(s.local)}`);
      await page.waitForTimeout(200);
      s = await state(page);
      if (last && s.local && Math.hypot(s.local.x - last.x, s.local.z - last.z) < 0.05) {
        if (++still % 10 === 0) await page.keyboard.press('Space'); // a lip in the yard: hop it
      } else still = 0;
      last = s.local;
    }
  } finally {
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
  }
  return s;
}

/** Turn `page`'s view to (yaw, pitch) through the test pad: exact counted stick samples, then check. */
async function turnTo(page: Page, yaw: number, pitch: number): Promise<void> {
  const v = (await state(page)).twin.view;
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const plan = (delta: number, rate: number) => {
    // a turn of `delta` rad at `rate` rad per sample at full stick, as one or two exact segments (input.ts' dead zone
    // is 0.15: a tiny turn goes out by 0.1 rad and back)
    const seg = (d: number) => { const n = Math.max(1, Math.ceil(Math.abs(d) / rate)); return { v: d / (n * rate), n }; };
    if (Math.abs(delta) === 0) return [];
    if (Math.abs(delta) / rate >= 0.2) return [seg(delta)];
    const out = Math.sign(delta || 1) * 0.1;
    return [seg(out), seg(delta - out)];
  };
  const turns: Array<{ x: number; y: number; n: number }> = [];
  for (const s of plan(wrap(yaw - v.yaw), 3.2 * TICK_DT)) turns.push({ x: -s.v, y: 0, n: s.n }); // yaw -= x * 3.2 * dt
  for (const s of plan(pitch - v.pitch, 2.2 * TICK_DT)) turns.push({ x: 0, y: -s.v, n: s.n }); // pitch -= y * 2.2 * dt
  await page.evaluate((t) => { (window as unknown as { __pad: { turns: unknown[] } }).__pad.turns.push(...t); }, turns);
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __pad: { turns: unknown[] } }).__pad.turns.length), { timeout: 60_000, intervals: [100] }).toBe(0);
  const now = (await state(page)).twin.view;
  expect(Math.abs(wrap(now.yaw - yaw))).toBeLessThan(1e-3);
  expect(Math.abs(now.pitch - pitch)).toBeLessThan(1e-3);
}

/** The view that puts the authority's crosshair ray (weapons.ts AIM_RAY, aiming: shoulder 0.75 m, pivot 1.25 m up)
 *  through `to` (the target's chest), from a pet standing at `from`. */
function aimAt(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): { yaw: number; pitch: number } {
  const shoulder = 0.75, pivot = 1.25;
  let yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  for (let i = 0; i < 6; i++) {
    const ox = from.x + Math.cos(yaw) * shoulder, oz = from.z - Math.sin(yaw) * shoulder;
    yaw = Math.atan2(-(to.x - ox), -(to.z - oz));
  }
  const ox = from.x + Math.cos(yaw) * shoulder, oz = from.z - Math.sin(yaw) * shoulder;
  const pitch = Math.atan2(to.y - (from.y + pivot), Math.hypot(to.x - ox, to.z - oz));
  return { yaw, pitch };
}

test('SLAB online: two players in one room see each other, share the score and clock, a takedown and the rematch', async ({ browser }) => {
  test.setTimeout(1_200_000); // ~4 min normally; SwiftShader on a saturated box is far slower
  const base = test.info().project.use.baseURL ?? 'http://localhost:4173';
  await startServer();
  const room = `slab-e2e-${Date.now().toString(36)}`;
  const url = (name: string, team: number) => `${base}/?mode=slab&room=${room}&server=ws://127.0.0.1:${PORT}&name=${name}&team=${team}&webgl&autoplay&quality=low`;
  // Bravo's browser of its own (net.spec.ts W11: two contexts of one Chromium starve each other's GPU process)
  const browserB = await chromium.launch(test.info().project.use.launchOptions);
  browsers.push(browserB);
  const [A, B] = await Promise.all([openPlayer(browser, url('Alpha', 0)), openPlayer(browserB, url('Bravo', 1))]);
  await Promise.all([ready(A.page), ready(B.page)]);

  // 1. each sees the other's pet (a Player entity, not a bot), and its own side
  await expect.poll(async () => {
    const [a, b] = await Promise.all([state(A.page), state(B.page)]);
    return [a.ents.some((e) => e[0] === b.me && e[1] === 0), b.ents.some((e) => e[0] === a.me && e[1] === 0), a.ents.filter((e) => e[1] <= 1).length, b.ents.filter((e) => e[1] <= 1).length];
  }, { timeout: 90_000, intervals: [1000] }).toEqual([true, true, 2, 2]); // 1 v 1 of people: the bots left as they joined
  await expect(A.page.locator('#cvc-slab [data-slab-you]')).toHaveText('YOU: CORGI COMPANY');
  await expect(B.page.locator('#cvc-slab [data-slab-you]')).toHaveText('YOU: CAT CADRE');
  const [sa0, sb0] = await Promise.all([state(A.page), state(B.page)]);
  const idA = sa0.me, idB = sb0.me;

  // 2. the same score and clock: tick for tick in the snapshot logs, and on the HUD
  await A.page.waitForTimeout(3000);
  const start = await sameLog(A.page, B.page, 'start');
  // the HUDs: each page draws its latest snapshot on its own (slow) frames, so poll for a moment both have drawn
  let ha = await hud(A.page), hb = await hud(B.page);
  await expect.poll(async () => {
    [ha, hb] = await Promise.all([hud(A.page), hud(B.page)]);
    return ha.s0 === hb.s0 && ha.s1 === hb.s1 && Math.abs((clockSecs(ha.clock) ?? -9) - (clockSecs(hb.clock) ?? 9)) <= 1;
  }, { timeout: 30_000, intervals: [100] }).toBe(true);
  console.log(`[net-slab] start: ${start.common} common ticks agree (latest ${JSON.stringify(start.last)}); HUD ${ha.s0}-${ha.s1} ${ha.clock} / ${hb.s0}-${hb.s1} ${hb.clock}`);

  // 3. a takedown. Both walk toward the slab at once (walked one after the other, the two 132 m walks on a loaded box
  // once used up the 180 s clock before the takedown) and stop clearly off it: W is released once a pet is within 7 m
  // of the slab's edge (checked every 0.2 s; on a loaded box a pet ran on up to about 3 m past the check), and where
  // Bravo settles must be off the slab with 1 m to spare. So no Cat points ever accrue. Then Alpha turns to Bravo,
  // closes to 10 m across the slab (the Corgis score while it is on it) and fires.
  const half = SLAB_CFG.size.x / 2;
  const box = (p: { x: number; z: number }) => Math.max(Math.abs(p.x - SLAB.x), Math.abs(p.z - SLAB.z));
  /** Where `page`'s pet settles once the inputs already sent have played out (two reads 0.5 s apart agree). */
  const settle = async (page: Page) => {
    let at = (await state(page)).local!;
    await expect.poll(async () => {
      const prev = at;
      await page.waitForTimeout(500);
      at = (await state(page)).local!;
      return Math.hypot(at.x - prev.x, at.z - prev.z) < 0.02;
    }, { timeout: 30_000, intervals: [0] }).toBe(true);
    return at;
  };
  await Promise.all([
    walk(B.page, (s) => !!s.local && box(s.local) < half + 7, 'Bravo toward the slab'),
    walk(A.page, (s) => !!s.local && box(s.local) < half + 7, 'Alpha toward the slab'),
  ]);
  const [bravoAt, alphaEdge] = await Promise.all([settle(B.page), settle(A.page)]);
  expect(onSlab(bravoAt.x, bravoAt.y, bravoAt.z)).toBe(false);
  expect(box(bravoAt)).toBeGreaterThan(half + 1); // with margin
  const alphaView = (await state(A.page)).twin.view;
  await turnTo(A.page, Math.atan2(-(bravoAt.x - alphaEdge.x), -(bravoAt.z - alphaEdge.z)), alphaView.pitch);
  await walk(A.page, (s) => {
    const b = s.ents.find((e) => e[0] === idB);
    return !!s.local && !!b && Math.hypot(s.local.x - b[2], s.local.z - b[4]) < 10;
  }, 'Alpha toward Bravo', 60_000);
  // the Cats have no points and gain none (Bravo never set foot on the slab): the fight cannot race a Cat win
  const catsNow = async () => (await state(B.page)).twin.match!.score[1];
  expect(await catsNow()).toBe(0);
  await B.page.waitForTimeout(2500);
  expect(await catsNow()).toBe(0);
  const alphaOnSlab = ((l) => onSlab(l.x, l.y, l.z))((await state(A.page)).local!); // logged
  const fightT0 = Date.now();
  const deadline = Date.now() + 240_000;
  const pad = (p: Page, fire: boolean, aim: boolean) => p.evaluate(([f, a]) => { const q = (window as unknown as { __pad: { fire: boolean; aim: boolean } }).__pad; q.fire = f; q.aim = a; }, [fire, aim]);
  const down = async () => { const b = await state(B.page); return !!b.local && (b.local.flags & DEAD) !== 0; };
  mkdirSync('artifacts', { recursive: true });
  let aimShots = false;
  while (!(await down())) {
    if (Date.now() > deadline) throw new Error('no takedown in 4 min');
    const a = await state(A.page), b = await state(B.page);
    if (a.twin.match?.phase === 'ended') throw new Error(`the match ended before the takedown (${JSON.stringify(a.twin.match)})`);
    const target = b.local ?? bravoAt;
    const v = aimAt(a.local!, { x: target.x, y: target.y + 0.75, z: target.z });
    await pad(A.page, false, true);
    await turnTo(A.page, v.yaw, v.pitch);
    if (!aimShots) { // both pets standing about 10 m apart, Alpha aimed down its sights at Bravo
      aimShots = true;
      await Promise.all([A.page.screenshot({ path: 'artifacts/net-slab-a-aim.png' }), B.page.screenshot({ path: 'artifacts/net-slab-b-aim.png' })]);
    }
    await pad(A.page, true, true);
    if (process.env.NET_SLAB_DEBUG) {
      console.log(`[net-slab] aim: A ${JSON.stringify(a.local)} B ${JSON.stringify(b.local)} dist ${Math.hypot(a.local!.x - target.x, a.local!.z - target.z).toFixed(1)} view ${JSON.stringify(v)}`);
      await A.page.screenshot({ path: `artifacts/net-slab-aim-${Date.now()}.png` });
    }
    const until = Date.now() + 6000; // fire for up to 6 s
    while (Date.now() < until && !(await down())) await A.page.waitForTimeout(150);
  }
  await pad(A.page, false, false);
  // Bravo is down: its death panel shows on its next frames and holds for the 3 s respawn; read it then
  let panel: string[] | null = null;
  await expect.poll(async () => (panel = (await hud(B.page)).death), { timeout: 15_000, intervals: [100] }).not.toBeNull();
  const panelOnA = (await hud(A.page)).death;
  const downAt = Date.now();
  const fightSecs = (downAt - fightT0) / 1000;
  await Promise.all([A.page.screenshot({ path: 'artifacts/net-slab-a.png' }), B.page.screenshot({ path: 'artifacts/net-slab-b.png' })]);
  // line 1 is "TAKEN DOWN BY Alpha  ·", the triangle glyph (no text), then the team: its text runs together
  expect(panel).toEqual(['TAKEN DOWN BY Alpha  ·CORGI COMPANY', 'YOU: CAT CADRE', 'BACK AT THE SCAFFOLDS  ·  132 m TO THE SLAB', expect.stringMatching(/^BACK IN [0-3]\.\d$/)]);
  expect(panelOnA).toBeNull(); // the killer's page shows no panel
  // the kill feed on both pages
  await expect.poll(async () => (await hud(A.page)).feed, { timeout: 30_000, intervals: [250] }).toContain('Alpha  >  Bravo');
  await expect.poll(async () => (await hud(B.page)).feed, { timeout: 30_000, intervals: [250] }).toContain('Alpha  >  Bravo');
  expect((await hud(A.page)).death).toBeNull();
  const atTakedown = await sameLog(A.page, B.page, 'takedown');
  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);

  // 4. Alpha holds the slab until the match ends (60 points, or the horn)
  // face the slab centre first (the view still points where Bravo stood), then walk until well inside the slab
  const at = (await state(A.page)).local!;
  await turnTo(A.page, Math.atan2(-(SLAB.x - at.x), -(SLAB.z - at.z)), (await state(A.page)).twin.view.pitch);
  await walk(A.page, (s) => !!s.local && box(s.local) < half - 1, 'Alpha onto the slab', 60_000);
  // the logs agree while the score moves: Alpha holds the slab alone, so the Corgis gain a point a second
  await expect.poll(async () => { const m = (await state(A.page)).twin.match!; return m.score[0] >= 3 || m.phase === 'ended'; }, { timeout: 120_000, intervals: [500] }).toBe(true);
  const scoring = await sameLog(A.page, B.page, 'scoring');
  expect(scoring.last[2]).toBeGreaterThan(0);
  await expect.poll(async () => (await state(A.page)).twin.match?.phase, { timeout: 420_000, intervals: [2000] }).toBe('ended');
  await expect.poll(async () => (await state(B.page)).twin.match?.phase, { timeout: 30_000, intervals: [500] }).toBe('ended');
  await expect(A.page.locator('#cvc-slab [data-slab-win]')).toBeVisible({ timeout: 30_000 });
  await expect(B.page.locator('#cvc-slab [data-slab-win]')).toBeVisible({ timeout: 30_000 });
  const atEnd = await sameLog(A.page, B.page, 'end');
  expect(atEnd.last[4]).toBe('ended');
  expect(atEnd.last[2] + atEnd.last[3]).toBeGreaterThan(0); // compared on a real result, not 0 - 0
  // R once the authority's clock is SLAB.rematchDelay past its end tick (the latest snapshot's tick is at or past it)
  const before = [(await state(A.page)).twin.restarts, (await state(B.page)).twin.restarts];
  const endTick: number = await A.page.evaluate(() => (globalThis as unknown as { __cvc: { net: { tick: number } } }).__cvc.net.tick);
  await A.page.waitForFunction((t) => (globalThis as unknown as { __cvc: { net: { tick: number } } }).__cvc.net.tick >= t,
    endTick + SLAB_CFG.rematchDelay * TICK_HZ + 6, { timeout: 60_000, polling: 100 });
  await A.page.bringToFront();
  await A.page.keyboard.press('KeyR');
  for (const [i, P] of [A, B].entries()) {
    await P.page.waitForFunction((n) => (globalThis as unknown as { __cvc: { twin: { restarts: number } } }).__cvc.twin.restarts > n, before[i], { timeout: 60_000, polling: 250 });
    expect((await state(P.page)).twin.restartScore).toEqual([0, 0]);
    await expect(P.page.locator('#cvc-slab [data-slab-win]')).toBeHidden({ timeout: 30_000 });
    await expect(P.page.locator('#cvc-slab [data-slab-s0]')).toHaveText('0');
    await expect(P.page.locator('#cvc-slab [data-slab-s1]')).toHaveText('0');
  }
  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
  console.log(`[net-slab] Bravo stopped ${(box(bravoAt) - half).toFixed(1)} m off the slab, Alpha ${(box(alphaEdge) - half).toFixed(1)} m; Alpha fired from ${alphaOnSlab ? 'on' : 'off'} it and took Bravo down in ${fightSecs.toFixed(0)} s (${atTakedown.last[1]} s on the clock at the takedown check)`);
  console.log(`[net-slab] takedown: ${atTakedown.common} common ticks agree (latest ${JSON.stringify(atTakedown.last)}); scoring: ${scoring.common} agree (latest ${JSON.stringify(scoring.last)}); end: ${atEnd.common} agree (latest ${JSON.stringify(atEnd.last)}); R ${((Date.now() - downAt) / 1000).toFixed(0)} s after the takedown rematched both pages from ${atEnd.last[2]}-${atEnd.last[3]}; ids A ${idA} B ${idB}`);
  await A.ctx.close();
  await B.ctx.close();
});
