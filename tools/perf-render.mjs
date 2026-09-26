// Render cost per quality tier at the same view: draw calls and triangles per frame, split by pass.
//   PROBE_URL=http://localhost:5175/ node tools/perf-render.mjs [--tiers high,medium,low] [--query '&mode=free&bots=0,0']
//        [--frames 6] [--out artifacts/p2] [--size 1280x720]
// Headless Chromium renders with SwiftShader (WebGL2 backend, ~1 fps): judge cost by draws/triangles, not fps.
// Counting wraps the WebGL2 draw calls (harness-only, like tools/qa-play.mjs perf). A draw is attributed to
//   shadow      the viewport is square and not the canvas (the sun's shadow map: 1024/1536/2048)
//   fullscreen  a draw of <= 2 triangles (post passes: bloom mips, outline/grade/output quads)
//   scene       everything else (the main colour pass incl. the toon outline hulls)
// The default query is free mode without bots (spawn, camera and time of day are deterministic): the same view for
// every tier. Use --query '&mode=team-deathmatch' for a firefight (bots move, so frames differ a little).
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const tiers = opt('tiers', 'high,low').split(',');
const query = opt('query', '&mode=free&bots=0,0&t=0.45');
const frames = Number(opt('frames', 6));
const out = opt('out', 'artifacts/p2');
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const base = process.env.PROBE_URL ?? 'http://localhost:5173/';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const GLCOUNT = () => {
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
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    const f = {};
    for (const k of Object.keys(cur)) { f[k] = { calls: cur[k][0], tris: Math.round(cur[k][1]) }; cur[k][0] = 0; cur[k][1] = 0; }
    f.calls = f.shadow.calls + f.scene.calls + f.fullscreen.calls;
    f.tris = f.shadow.tris + f.scene.tris + f.fullscreen.tris;
    if (f.calls > 0) { window.__perf.frames.push(f); if (window.__perf.frames.length > 60) window.__perf.frames.shift(); }
    cb(t);
  });
};

const browser = await chromium.launch({
  executablePath: existsSync(exe) ? exe : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
mkdirSync(out, { recursive: true });
const rows = [];
for (const tier of tiers) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.addInitScript(GLCOUNT);
  await page.goto(`${base}?webgl&autoplay&quality=${tier}${query}`);
  await page.waitForFunction(() => globalThis.__cvc?.ready === true, null, { timeout: 300000 });
  const f0 = await page.evaluate(() => globalThis.__cvc.frames);
  await page.waitForFunction((n) => globalThis.__cvc.frames >= n, f0 + frames + 2, { timeout: 600000, polling: 500 });
  const fr = await page.evaluate((n) => window.__perf.frames.slice(-n), frames);
  const info = await page.evaluate(() => ({ ratio: globalThis.__cvc.pixelRatio ?? null, quality: globalThis.__cvc.quality ?? null, errors: globalThis.__cvc.errors }));
  const shot = `${out}/p2-${tier}.png`;
  await page.screenshot({ path: shot });
  await page.close();
  const med = (get) => { const v = fr.map(get).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const row = {
    tier, calls: med((f) => f.calls), tris: med((f) => f.tris),
    shadow: `${med((f) => f.shadow.calls)} / ${med((f) => f.shadow.tris)}`,
    scene: `${med((f) => f.scene.calls)} / ${med((f) => f.scene.tris)}`,
    fullscreen: `${med((f) => f.fullscreen.calls)} / ${med((f) => f.fullscreen.tris)}`,
    engine: info, errors: [...errors, ...info.errors].length, shot,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
await browser.close();
if (rows.length > 1) {
  const hi = rows[0];
  for (const r of rows.slice(1)) {
    console.log(`${r.tier} vs ${hi.tier}: draw calls ${r.calls} vs ${hi.calls} (${(100 * (1 - r.calls / hi.calls)).toFixed(0)} % fewer) · triangles ${r.tris} vs ${hi.tris} (${(100 * (1 - r.tris / hi.tris)).toFixed(0)} % fewer)`);
  }
}
