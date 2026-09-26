#!/usr/bin/env node
// Q3 verification probe (read-only): MASTER_PLAN §8.7 draws and triangles in a LIVE match, now that bots drive karts
// and fly the plane (Wave 5). tools/perf-render.mjs reports the median of a few frames; this samples a long window,
// splits every frame by pass (shadow / scene / fullscreen, same attribution as perf-render), tracks the vehicles in the
// offline worker's snapshots, and screenshots the heaviest frames.
//   npx vite preview --port 5390 --strictPort   then
//   node tools/qa3-render.mjs [--base http://127.0.0.1:5390/] [--tier high] [--query '&mode=team-deathmatch'] [--frames 90] [--tag tdm]
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:5390/');
const TIER = opt('tier', 'high');
const QUERY = opt('query', '&mode=team-deathmatch');
const FRAMES = Number(opt('frames', 90));
const TAG = opt('tag', 'tdm');
const OUT = 'artifacts/q3';
mkdirSync(OUT, { recursive: true });

const INIT = () => {
  const P = WebGL2RenderingContext.prototype;
  const cur = { shadow: [0, 0], scene: [0, 0], fullscreen: [0, 0] };
  let vw = 0, vh = 0;
  window.__perf = { frames: [] };
  const vp = P.viewport;
  P.viewport = function (x, y, w, h) { vw = w; vh = h; return vp.call(this, x, y, w, h); };
  const isShadow = (w, h) => w === h && w >= 256 && w !== (document.querySelector('canvas')?.width ?? -1);
  const add = (mode, count, inst = 1) => {
    const tris = mode === 4 ? (count / 3) * inst : mode === 5 || mode === 6 ? Math.max(0, count - 2) * inst : 0;
    const pass = isShadow(vw, vh) ? 'shadow' : tris > 0 && tris <= 2 ? 'fullscreen' : 'scene';
    cur[pass][0]++; cur[pass][1] += tris;
  };
  const wrap = (name, f) => { const o = P[name]; P[name] = function (...a) { f(a); return o.apply(this, a); }; };
  wrap('drawArrays', (a) => add(a[0], a[2]));
  wrap('drawElements', (a) => add(a[0], a[1]));
  wrap('drawArraysInstanced', (a) => add(a[0], a[2], a[3]));
  wrap('drawElementsInstanced', (a) => add(a[0], a[1], a[4]));
  // vehicles (kind 4) in the offline worker's snapshots: id -> [x, y, z, weapon (= rider id, -1 empty)]
  window.__veh = new Map();
  window.__me = -1;
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (e) => {
        const m = e.data;
        if (!m || m.t !== 'snap') return;
        window.__me = m.you;
        for (const r of m.ents ?? []) if (r[1] === 4) window.__veh.set(r[0], [r[6], r[7], r[8], r[18]]);
        for (const id of m.gone ?? []) window.__veh.delete(id);
      });
    }
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    const f = {};
    for (const k of Object.keys(cur)) { f[k] = { calls: cur[k][0], tris: Math.round(cur[k][1]) }; cur[k][0] = 0; cur[k][1] = 0; }
    f.calls = f.shadow.calls + f.scene.calls + f.fullscreen.calls;
    f.tris = f.shadow.tris + f.scene.tris + f.fullscreen.tris;
    const L = globalThis.__cvc?.local;
    let near = 0, seated = 0;
    for (const [, v] of window.__veh) { if (L && Math.hypot(v[0] - L.x, v[2] - L.z) < 60) near++; if (v[3] >= 0) seated++; }
    f.veh = window.__veh.size; f.vehNear60 = near; f.vehSeated = seated;
    if (f.calls > 0) { window.__perf.frames.push(f); if (window.__perf.frames.length > 400) window.__perf.frames.shift(); }
    cb(t);
  });
};

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.addInitScript(INIT);
await page.goto(`${BASE}?webgl&autoplay&quality=${TIER}${QUERY}`);
await page.waitForFunction(() => globalThis.__cvc?.ready === true, null, { timeout: 300000 });
const t0 = Date.now();
const f0 = await page.evaluate(() => globalThis.__cvc.frames);
let best = [];
const shots = [];
// sample in chunks, keep a screenshot of the heaviest frame seen so far in each chunk
for (let chunk = 0; chunk < 3; chunk++) {
  await page.waitForFunction((n) => globalThis.__cvc.frames >= n, f0 + Math.round(((chunk + 1) * FRAMES) / 3), { timeout: 900000, polling: 500 });
  const path = `${OUT}/render-${TAG}-${TIER}-${chunk}.png`;
  await page.screenshot({ path });
  const last = await page.evaluate(() => window.__perf.frames.at(-1));
  shots.push({ path, calls: last.calls, tris: last.tris, veh: last.veh, vehNear60: last.vehNear60 });
}
const fr = await page.evaluate((n) => window.__perf.frames.slice(-n), FRAMES);
const q = (get, p) => { const v = fr.map(get).sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))]; };
const maxF = fr.reduce((a, f) => (f.tris > a.tris ? f : a), fr[0]);
const maxC = fr.reduce((a, f) => (f.calls > a.calls ? f : a), fr[0]);
const res = {
  tier: TIER, query: QUERY, frames: fr.length, wallS: Math.round((Date.now() - t0) / 1000),
  calls: { p50: q((f) => f.calls, 0.5), p95: q((f) => f.calls, 0.95), max: maxC.calls },
  tris: { p50: q((f) => f.tris, 0.5), p95: q((f) => f.tris, 0.95), max: maxF.tris },
  heaviest: { shadow: maxF.shadow, scene: maxF.scene, fullscreen: maxF.fullscreen, veh: maxF.veh, vehNear60: maxF.vehNear60, vehSeated: maxF.vehSeated },
  sceneOnly: { p50: q((f) => f.scene.tris, 0.5), max: Math.max(...fr.map((f) => f.scene.tris)) },
  shadowTris: { p50: q((f) => f.shadow.tris, 0.5), max: Math.max(...fr.map((f) => f.shadow.tris)) },
  framesWithVehicleNear60: fr.filter((f) => f.vehNear60 > 0).length, maxVehicles: Math.max(...fr.map((f) => f.veh)),
  trisWithVehNear: fr.filter((f) => f.vehNear60 > 0).length ? Math.max(...fr.filter((f) => f.vehNear60 > 0).map((f) => f.tris)) : null,
  shots, errors, pageErrors: await page.evaluate(() => globalThis.__cvc.errors),
};
console.log(JSON.stringify(res));
writeFileSync(`${OUT}/render-${TAG}-${TIER}.json`, JSON.stringify({ ...res, series: fr }, null, 1));
await browser.close();
