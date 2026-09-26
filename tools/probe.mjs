// Headless probe: open the game, print console output + debug state, save a screenshot.
//   node tools/probe.mjs [urlQuery] [seconds] [out.png]
// Starts no server itself: run `npx vite --port 5173` first (or pass PROBE_URL).
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';

const q = process.argv[2] ?? '?webgl&autoplay';
const secs = Number(process.argv[3] ?? 8);
const out = process.argv[4] ?? 'artifacts/probe.png';
const base = process.env.PROBE_URL ?? 'http://localhost:5173/';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(exe) ? exe : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text()}`.slice(0, 400)));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.stack ?? e}`.slice(0, 800)));
await page.goto(base + q);
const keys = (process.env.PROBE_KEYS ?? '').split(',').filter(Boolean);
for (const k of keys) await page.keyboard.down(k);
await page.waitForTimeout(secs * 1000);
for (const k of keys) await page.keyboard.up(k);
const dbg = await page.evaluate(() => globalThis.__cvc ?? null);
console.log('DEBUG', JSON.stringify(dbg));
mkdirSync(out.split('/').slice(0, -1).join('/') || '.', { recursive: true });
await page.screenshot({ path: out });
console.log('screenshot', out);
await browser.close();
