#!/usr/bin/env node
// Q4 verification probe (read-only): the look gallery, before/after a style change. One Chromium, a fresh page per
// shot (a page reused across bookmarks carries the pipeline's adapted state: L3 §8), long timeouts for a loaded box,
// and tools/world-shots.mjs's statistics (whole-frame Rec. 709 luma mean / std-dev = "contrast") so the numbers line up
// with docs/qa/W7_GALLERY.md and the lanes' hand-backs.
//   npx vite --port 5306   (from the tree under test)   then
//   node tools/qa4-shots.mjs --base http://localhost:5306 --out artifacts/q4/gallery/before [--sets w7,lot,lotstorm,lineup]
//   node tools/qa4-shots.mjs … --mask-from <before dir>   also score each masked shot against that pass's masks
//   node tools/qa4-shots.mjs --compare artifacts/q4/gallery/before,artifacts/q4/gallery/after --out docs/qa/w9-q4 [--only a,b]
//        before | after sheets (JPEG, 1280 px wide, each half 640×360; a crop box `--crop x,y,w,h` zooms both halves)
// Sets:
//   w7        labs/world.html  overview, deck, cats, center, flank at t = 0.74 (the W7 bookmark set, high tier)
//   lot       labs/lot.html    lot_corgi_base, lot_container_canyon, lot_pipe_mouth, lot_cat_scaffold, lot_overview,
//                              t = 0.74, the default (frozen) weather
//   lotstorm  the same five in storm (&wx=storm)
//   lineup    labs/characters.html K3's 35 m lineup (NPC tier, the lab's dusk rig), fronts and backs. Each also takes the
//             lab's &mask=1 frame (pets flat white on black) and reports, per team, the mean luma inside the mask and the
//             share of masked pixels that read as the team's hue (readability.ts readsAsTeam: within 22 deg of the team
//             colour, s >= 0.45, l 0.18-0.78), the K3/P4 bench metric
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('base', 'http://localhost:5306');
const OUT = opt('out', 'artifacts/q4/gallery/before');
const SETS = opt('sets', 'w7,lot,lotstorm,lineup').split(',');
const ONLY = opt('only', '');
/** Score masked metrics against another pass's masks (same frozen geometry; exposure changes a glow mask's size). */
const MASK_FROM = opt('mask-from', '');
mkdirSync(OUT, { recursive: true });

const COMPARE = opt('compare', '');
const shots = [];
if (SETS.includes('w7')) for (const bm of ['overview', 'deck', 'cats', 'center', 'flank']) shots.push({ name: `w7-${bm}`, url: `/labs/world.html?webgl&bm=${bm}&t=0.74&hud=0` });
const LOT = ['lot_corgi_base', 'lot_container_canyon', 'lot_pipe_mouth', 'lot_cat_scaffold', 'lot_overview'];
if (SETS.includes('lot')) for (const bm of LOT) shots.push({ name: `lot-${bm}`, url: `/labs/lot.html?webgl&bm=${bm}&t=0.74&hud=0&freeze` });
if (SETS.includes('lotstorm')) for (const bm of LOT) shots.push({ name: `lotstorm-${bm}`, url: `/labs/lot.html?webgl&bm=${bm}&t=0.74&hud=0&freeze&wx=storm` });
// P4's real-sky readability bench (labs/look.ts, from f1b1d34): 12 NPC kits on a 35 m sightline in the West Yard's real
// sky, grade, fog and weather at t = 0.74, with its own mask (&mask=1) and __lab.boxes
if (SETS.includes('bench')) for (const wx of ['storm', 'clear']) for (const q of ['high', 'low']) for (const f of ['front', 'back']) {
  if (wx === 'clear' && q === 'low') continue;
  shots.push({ name: `bench-${wx}-${q}-${f}`, url: `/labs/look.html?webgl&cam=42,1.7,2&at=74.3,0.6,-11.4&t=0.74&lineup=35&freeze&hud=0&flood=0&quality=${q}&facing=${f}&wx=${wx}`, bench: true });
}
if (SETS.includes('lineup')) {
  shots.push({ name: 'lineup-35m-front', url: '/labs/characters.html?webgl&view=lineup&npc&t=1', lab: true });
  shots.push({ name: 'lineup-35m-back', url: '/labs/characters.html?webgl&view=lineup&npc&t=1&facing=back', lab: true });
}

function decode(file) {
  const buf = readFileSync(file);
  let off = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), d = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } else if (type === 'IDAT') idat.push(d);
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const r = raw[y * (stride + 1) + 1 + x], a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = r;
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
function stats(file) {
  const { w, h, bpp, px } = decode(file);
  let sum = 0, sq = 0;
  for (let i = 0; i < w * h; i++) { const l = 0.2126 * px[i * bpp] + 0.7152 * px[i * bpp + 1] + 0.0722 * px[i * bpp + 2]; sum += l; sq += l * l; }
  const mean = sum / (w * h);
  return { luma: +mean.toFixed(1), contrast: +Math.sqrt(sq / (w * h) - mean * mean).toFixed(1) };
}
const hsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  let hh = 0;
  if (d > 1e-6) { if (max === r) hh = ((g - b) / d) % 6; else if (max === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; }
  return { h: hh, s: d < 1e-6 ? 0 : d / (1 - Math.abs(2 * l - 1)), l };
};
const TEAM_HUE = [hsl(0x2f, 0x6f, 0xd6).h, hsl(0xc9, 0x34, 0x4a).h];
/** Per team: mean luma inside the mask and the share of masked pixels in the team's hue (boxes: CSS px = image px). */
function maskMetrics(file, maskFile, boxes) {
  const A = decode(file), M = decode(maskFile);
  const acc = [{ n: 0, luma: 0, hue: 0 }, { n: 0, luma: 0, hue: 0 }];
  for (const b of boxes) {
    const t = b.team === 1 ? 1 : 0;
    for (let y = Math.max(0, Math.floor(b.y0)); y < Math.min(A.h, Math.ceil(b.y1)); y++) for (let x = Math.max(0, Math.floor(b.x0)); x < Math.min(A.w, Math.ceil(b.x1)); x++) {
      const mi = (y * M.w + x) * M.bpp;
      if (M.px[mi] + M.px[mi + 1] + M.px[mi + 2] < 3 * 128) continue;
      const i = (y * A.w + x) * A.bpp, r = A.px[i], g = A.px[i + 1], bl = A.px[i + 2];
      acc[t].n++; acc[t].luma += 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      const c = hsl(r, g, bl), dh = Math.abs(((c.h - TEAM_HUE[t] + 540) % 360) - 180);
      if (dh <= 22 && c.s >= 0.45 && c.l >= 0.18 && c.l <= 0.78) acc[t].hue++;
    }
  }
  const all = { n: acc[0].n + acc[1].n, luma: acc[0].luma + acc[1].luma, hue: acc[0].hue + acc[1].hue };
  const f = (a) => ({ px: a.n, luma: a.n ? +(a.luma / a.n).toFixed(1) : null, teamHuePct: a.n ? +((100 * a.hue) / a.n).toFixed(1) : null });
  return { corgis: f(acc[0]), cats: f(acc[1]), all: f(all) };
}

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (COMPARE) {
  const [A, B] = COMPARE.split(',');
  const crop = opt('crop', '') ? opt('crop', '').split(',').map(Number) : null; // x,y,w,h in source px
  const names = (ONLY ? ONLY.split(',') : shots.map((x) => x.name)).filter((n) => existsSync(`${A}/${n}.png`) && existsSync(`${B}/${n}.png`));
  for (const n of names) {
    const src = (d) => `data:image/png;base64,${readFileSync(`${d}/${n}.png`).toString('base64')}`;
    const page = await browser.newPage({ viewport: { width: 1280, height: 390 } });
    const [cx, cy, cw, ch] = crop ?? [0, 0, 1280, 720];
    const cell = (u, label) => `<div style="position:relative;width:640px;height:360px;overflow:hidden;display:inline-block">
      <img src="${u}" style="position:absolute;left:${(-cx * 640) / cw}px;top:${(-cy * 360) / ch}px;width:${(1280 * 640) / cw}px;height:${(720 * 360) / ch}px">
      <span style="position:absolute;left:6px;top:4px;font:bold 15px sans-serif;color:#fff;text-shadow:0 0 3px #000">${label}</span></div>`;
    await page.setContent(`<body style="margin:0;background:#111;font:13px sans-serif;color:#ddd"><div style="height:30px;line-height:30px;padding-left:8px">${n}${crop ? ' (crop)' : ''}</div>${cell(src(A), 'before')}${cell(src(B), 'after')}</body>`);
    await page.waitForTimeout(300);
    mkdirSync(OUT, { recursive: true });
    const outFile = `${OUT}/cmp-${n}${crop ? '-crop' : ''}.jpg`;
    await page.screenshot({ path: outFile, type: 'jpeg', quality: Number(opt('quality', 70)) });
    await page.close();
    console.log(outFile);
  }
  await browser.close();
  process.exit(0);
}
const rows = [];
for (const s of shots) {
  if (ONLY && !ONLY.split(',').includes(s.name)) continue;
  const file = `${OUT}/${s.name}.png`;
  let row = { shot: s.name };
  for (let attempt = 0; attempt < 2; attempt++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    const t0 = Date.now();
    try {
      await page.goto(BASE + s.url, { timeout: 300000 });
      if (s.lab) await page.waitForFunction(() => globalThis.__lab?.ready === true, null, { timeout: 400000, polling: 1000 });
      else {
        await page.waitForFunction(() => globalThis.__cvc?.ready === true, null, { timeout: 400000, polling: 1000 });
        const f0 = await page.evaluate(() => globalThis.__cvc.frames);
        await page.waitForFunction((n) => globalThis.__cvc.frames >= n, f0 + 3, { timeout: 400000, polling: 1000 });
      }
      const boxes = s.lab || s.bench ? await page.evaluate(() => (globalThis.__lab?.boxes ?? []).map((b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, team: b.team, species: b.species }))) : null;
      const dbg = await page.evaluate(() => { const d = globalThis.__cvc ?? {}; return { drawCalls: d.drawCalls ?? null, triangles: d.triangles ?? null, weather: globalThis.__lab?.weather ?? null }; });
      await page.screenshot({ path: file, timeout: 300000 });
      row = { shot: s.name, ...stats(file), ...dbg, errors: errors.length, s: Math.round((Date.now() - t0) / 1000), attempt };
      if ((s.lab || s.bench) && boxes?.length) {
        const mp = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        await mp.goto(BASE + s.url + '&mask=1', { timeout: 300000 });
        if (s.lab) await mp.waitForFunction(() => globalThis.__lab?.ready === true, null, { timeout: 400000, polling: 1000 });
        else {
          await mp.waitForFunction(() => globalThis.__cvc?.ready === true, null, { timeout: 400000, polling: 1000 });
          const m0 = await mp.evaluate(() => globalThis.__cvc.frames);
          await mp.waitForFunction((n) => globalThis.__cvc.frames >= n, m0 + 3, { timeout: 400000, polling: 1000 });
        }
        const mfile = `${OUT}/${s.name}-mask.png`;
        await mp.screenshot({ path: mfile, timeout: 300000 });
        await mp.close();
        row.mask = maskMetrics(file, mfile, boxes);
        if (MASK_FROM && existsSync(`${MASK_FROM}/${s.name}-mask.png`)) row.maskFrom = maskMetrics(file, `${MASK_FROM}/${s.name}-mask.png`, boxes);
        row.boxes = boxes.length;
      }
    } catch (e) { row = { shot: s.name, error: String(e).slice(0, 160), attempt }; }
    await page.close();
    if (!row.error && row.contrast > 6) break;
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
await browser.close();
writeFileSync(`${OUT}/stats.json`, JSON.stringify(rows, null, 1));
