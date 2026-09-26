// Ordnance lab captures (W9 X4): frame-exact stills of the throw, the arc, the bounces, the fuse telegraph and the
// blast for both factions, from labs/ordnance.html (one sim tick per rendered frame, paused at exact ticks).
//   npx vite --port 5303            (another terminal)
//   node labs/ordnance-shots.mjs [outDir=artifacts/x4] [view=corgi,cat] [base=http://localhost:5303/]
// Shot list per view: `<view>-<cam>-t<tick>.png`, ticks relative to the release (r) and the blast (b) found in a first
// pass; also prints the lab's stats (draws, particles, the plan, the targets' hp) at each still.
// ONLY=cat-close,models (env) shoots just those; TICKS=72,204 (env) skips the first pass (release, blast ticks).
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'artifacts/x4';
const viewsArg = (process.argv[3] ?? 'corgi,cat').split(',');
const base = process.argv[4] ?? process.env.PROBE_URL ?? 'http://localhost:5303/';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: existsSync(exe) ? exe : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function open(view, cam) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.stack ?? e}`.slice(0, 600)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text()}`.slice(0, 300)); });
  await page.goto(`${base}labs/ordnance.html?webgl&hold&view=${view}&cam=${cam}`);
  await page.waitForFunction(() => globalThis.__olab?.ready || globalThis.__olab?.error, null, { timeout: 120000 });
  const err = await page.evaluate(() => globalThis.__olab.error);
  if (err) throw new Error(err);
  return page;
}
async function runTo(page, tick) {
  // fast-forward (several ticks per rendered frame) to 2 ticks before the still, then one tick per frame
  await page.evaluate((t) => { const l = globalThis.__olab; l.pauseAt = [t]; l.ffTo = t - 2; l.pause = false; }, tick);
  await page.waitForFunction((t) => !!globalThis.__olab && globalThis.__olab.ticks >= t && globalThis.__olab.pause, tick, { timeout: 900000 });
  await page.waitForTimeout(250); // a couple of rendered frames at the held tick
}

const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
for (const view of viewsArg) {
  if (only && !only.some((o) => o.startsWith(view))) continue;
  // first pass: when does it leave the paw and go off?
  let throwTick, blastTick;
  if (process.env.TICKS) [throwTick, blastTick] = process.env.TICKS.split(',').map(Number);
  else {
    const probe = await open(view, 'side');
    await runTo(probe, 240);
    ({ throwTick, blastTick } = await probe.evaluate(() => ({ throwTick: globalThis.__olab.throwTick, blastTick: globalThis.__olab.blastTick })));
    await probe.close();
  }
  console.log(`${view}: thrown at tick ${throwTick}, blast at tick ${blastTick}`);
  const r = throwTick, b = blastTick;
  const plan = {
    ots: [r - 12],                               // aiming: the arc preview (dots, landing ring, blast ring) + the HUD slot
    side: [r + 12, r + 26, r + 44, b - 6, b + 2], // in flight, the first bounce, rolling, about to go, the blast
    target: [b - 40, b - 12, b + 1, b + 4, b + 12, b + 40], // the target's view: blinking, the ring, the blast frames, the aftermath
    close: [b - 30, b - 3],                       // the telegraph up close (cap light / wick, ring)
  };
  for (const [cam, ticks] of Object.entries(plan)) {
    if (only && !only.includes(`${view}-${cam}`)) continue;
    const page = await open(view, cam);
    for (const t of ticks) {
      await runTo(page, t);
      const file = `${out}/${view}-${cam}-t${t}.png`;
      await page.screenshot({ path: file, timeout: 180000 });
      const stats = await page.evaluate(() => JSON.stringify(globalThis.__olab.stats));
      console.log(file, stats);
    }
    await page.close();
  }
}
if (!only || only.includes('models')) {
  const page = await open('models', 'side');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/models.png`, timeout: 180000 });
  console.log(`${out}/models.png`);
  await page.close();
}
await browser.close();
