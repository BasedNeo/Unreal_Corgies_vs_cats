#!/usr/bin/env node
// Client memory over a long session (MASTER_PLAN §8.7: no growth over a 10-minute soak). Plays an offline match in
// headless Chromium and samples, every --every seconds after a forced GC: the main thread's JS heap
// (performance.memory, precise), the DOM node count, and the frame count. The worker's heap (the authority) is not
// in it: tools/soak.mjs --heap covers that side.
//   npx vite build && npx vite preview --port 5192 --strictPort   then
//   node tools/qa-memory.mjs [--base http://127.0.0.1:5192/] [--query '&mode=team-deathmatch'] [--minutes 10] [--every 30]
// Prints one JSON line per sample and a summary: heap growth per minute after the first minute (least squares).
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:5192/');
const QUERY = opt('query', '&mode=team-deathmatch');
const MINUTES = Number(opt('minutes', 10));
const EVERY = Number(opt('every', 30));
const OUT = opt('out', 'artifacts/memory.json');

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(exe) ? exe : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}?webgl&quality=low&autoplay${QUERY}`);
await page.waitForFunction(() => globalThis.__cvc?.ready && globalThis.__cvc.frames > 5, null, { timeout: 240000 });

const sample = () => page.evaluate(() => {
  globalThis.gc?.();
  const m = performance.memory;
  return { heapMB: m ? m.usedJSHeapSize / 1048576 : -1, dom: document.getElementsByTagName('*').length, frames: globalThis.__cvc.frames, gc: typeof globalThis.gc === 'function' };
});
const samples = [];
const t0 = Date.now();
for (;;) {
  const s = { t: Math.round((Date.now() - t0) / 1000), ...(await sample()) };
  s.heapMB = Math.round(s.heapMB * 100) / 100;
  samples.push(s);
  console.log(JSON.stringify(s));
  if (s.t >= MINUTES * 60) break;
  await page.waitForTimeout(EVERY * 1000);
}
// least-squares heap growth per minute over the samples after the first minute (load-time allocations settle)
const tail = samples.filter((s) => s.t >= 60);
let slope = 0;
if (tail.length >= 2) {
  const mx = tail.reduce((a, s) => a + s.t, 0) / tail.length, my = tail.reduce((a, s) => a + s.heapMB, 0) / tail.length;
  let num = 0, den = 0;
  for (const s of tail) { num += (s.t - mx) * (s.heapMB - my); den += (s.t - mx) ** 2; }
  slope = (num / den) * 60;
}
const summary = {
  query: QUERY, minutes: MINUTES, samples: samples.length, frames: samples.at(-1).frames,
  heapFirstMB: samples[0].heapMB, heapLastMB: samples.at(-1).heapMB, heapGrowthMBPerMin: Math.round(slope * 1000) / 1000,
  domFirst: samples[0].dom, domLast: samples.at(-1).dom, domMax: Math.max(...samples.map((s) => s.dom)), errors,
};
console.log('SUMMARY', JSON.stringify(summary));
mkdirSync(OUT.replace(/\/[^/]*$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify({ summary, samples }, null, 2));
await browser.close();
