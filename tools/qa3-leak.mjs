#!/usr/bin/env node
// Q3 verification probe (read-only): client object growth over a long offline match, counted directly instead of
// inferred from heap MB. Runs the game from the Vite DEV server (unminified, so the app's own three module can be
// imported by the exact URL it was loaded from: same module instance), and every --every seconds, after a forced
// GC (CDP HeapProfiler.collectGarbage), counts live instances with CDP Runtime.queryObjects:
//   three: Mesh, Object3D, BufferGeometry, Material, Texture · WebGL: WebGLBuffer, WebGLTexture, WebGLVertexArrayObject
// plus the JS heap (performance.memory), DOM nodes and the number of entities the client knows (__cvc.entities).
//   npx vite --port 5391 --strictPort   then
//   node tools/qa3-leak.mjs [--base http://127.0.0.1:5391/] [--query '&mode=team-deathmatch'] [--minutes 10] [--every 60]
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:5391/');
const QUERY = opt('query', '&mode=team-deathmatch');
const MINUTES = Number(opt('minutes', 10));
const EVERY = Number(opt('every', 60));
const OUT = opt('out', 'artifacts/q3/leak.json');
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
await page.goto(`${BASE}?webgl&quality=low&autoplay${QUERY}`);
await page.waitForFunction(() => globalThis.__cvc?.ready && globalThis.__cvc.frames > 5, null, { timeout: 300000 });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Runtime.enable');
const threeUrl = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).find((n) => /three_webgpu\.js/.test(n)) ?? null);
if (!threeUrl) throw new Error('three module URL not found (run against the Vite dev server)');
const protoIds = {};
for (const name of ['Mesh', 'Object3D', 'BufferGeometry', 'Material', 'Texture']) {
  const r = await cdp.send('Runtime.evaluate', { expression: `import(${JSON.stringify(threeUrl)}).then((m) => m.${name}.prototype)`, awaitPromise: true });
  protoIds[name] = r.result.objectId;
}
for (const name of ['WebGLBuffer', 'WebGLTexture', 'WebGLVertexArrayObject']) {
  const r = await cdp.send('Runtime.evaluate', { expression: `${name}.prototype` });
  protoIds[name] = r.result.objectId;
}
async function count(name) {
  const q = await cdp.send('Runtime.queryObjects', { prototypeObjectId: protoIds[name] });
  const n = await cdp.send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
  await cdp.send('Runtime.releaseObject', { objectId: q.objects.objectId });
  return n.result.value;
}
const samples = [];
const t0 = Date.now();
for (;;) {
  await cdp.send('HeapProfiler.collectGarbage');
  const s = { t: Math.round((Date.now() - t0) / 1000) };
  for (const k of Object.keys(protoIds)) s[k] = await count(k);
  Object.assign(s, await page.evaluate(() => ({ heapMB: Math.round(performance.memory.usedJSHeapSize / 10485.76) / 100, dom: document.getElementsByTagName('*').length, entities: globalThis.__cvc.entities, frames: globalThis.__cvc.frames })));
  samples.push(s);
  console.log(JSON.stringify(s));
  if (s.t >= MINUTES * 60) break;
  await page.waitForTimeout(EVERY * 1000);
}
const slope = (key) => {
  const tail = samples.filter((s) => s.t >= 60);
  if (tail.length < 2) return 0;
  const mx = tail.reduce((a, s) => a + s.t, 0) / tail.length, my = tail.reduce((a, s) => a + s[key], 0) / tail.length;
  let num = 0, den = 0;
  for (const s of tail) { num += (s.t - mx) * (s[key] - my); den += (s.t - mx) ** 2; }
  return Math.round((num / den) * 60 * 100) / 100;
};
const summary = { query: QUERY, minutes: MINUTES, perMinute: Object.fromEntries(['Mesh', 'Object3D', 'BufferGeometry', 'Material', 'Texture', 'WebGLBuffer', 'WebGLTexture', 'WebGLVertexArrayObject', 'heapMB', 'dom', 'entities'].map((k) => [k, slope(k)])), first: samples[0], last: samples.at(-1), errors };
console.log('SUMMARY', JSON.stringify(summary));
mkdirSync(OUT.replace(/\/[^/]*$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify({ summary, samples }, null, 2));
await browser.close();
