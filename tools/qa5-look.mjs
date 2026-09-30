#!/usr/bin/env node
// Q5 verification probe (read-only): P5's look calls re-measured at its bookmarks, plus real pets inside a Lot tunnel.
//   npx vite --port 5320   (from the tree under test)   then
//   node tools/qa5-look.mjs --base http://127.0.0.1:5320 --out artifacts/q5/look/after [--sets day,dusk,lot,pets]
// Sets (whole-frame Rec. 709 luma / std-dev "contrast", tools/world-shots.mjs's statistic; a fresh page per shot):
//   day   labs/world.html  the W7 bookmarks at t = 0.5 (noon) and t = 0.68 (match start)    (P5: within 5 % of pre-P4)
//   dusk  the same at t = 0.74 and the night overview / center at t = 0.9                   (P5: P4's dusk kept)
//   lot   labs/lot.html (frozen): the pipe mouth, the west container's end and wall (P5's cameras), the canyon, the
//         overview; dusk and storm; the overview also in the default weather
//   pets  labs/lot.html at the pipe mouth (dusk, frozen, no dummies): four real pets (createCharacter, the game's
//         kits) inside the tunnel bore that holds the camera, measured with the interiors on (as shipped) and off
//         (setStyleInteriors([]): the fill as before P5). A pet mask comes from the same frame with the pets hidden.
//         Reports the pets' mean luma, their team-hue share (P4's readsAsTeam rule) and the wall around them.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:5320');
const OUT = opt('out', 'artifacts/q5/look/after');
const SETS = opt('sets', 'day,dusk,lot,pets').split(',');
mkdirSync(OUT, { recursive: true });

const W7 = ['overview', 'deck', 'cats', 'center', 'flank'];
const shots = [];
if (SETS.includes('day')) for (const t of [0.5, 0.68]) for (const bm of W7) shots.push({ name: `w7-${bm}-t${t}`, url: `/labs/world.html?webgl&bm=${bm}&t=${t}&hud=0` });
if (SETS.includes('dusk')) {
  for (const bm of W7) shots.push({ name: `w7-${bm}-t0.74`, url: `/labs/world.html?webgl&bm=${bm}&t=0.74&hud=0` });
  for (const bm of ['overview', 'center']) shots.push({ name: `w7-${bm}-t0.9`, url: `/labs/world.html?webgl&bm=${bm}&t=0.9&hud=0` });
}
if (SETS.includes('lot')) {
  const cams = {
    pipe_mouth: 'bm=lot_pipe_mouth', canyon: 'bm=lot_container_canyon', overview: 'bm=lot_overview',
    cw_end: 'pos=-95.5,2,-24&look=-95.5,1.8,-50&fov=66', cw_wall: 'pos=-92.2,2.2,-40&look=-99.9,3.2,-31',
  };
  for (const [k, q] of Object.entries(cams)) for (const wx of ['dusk', 'storm']) shots.push({ name: `lot-${k}-${wx}`, url: `/labs/lot.html?webgl&${q}&t=0.74&hud=0&freeze${wx === 'storm' ? '&wx=storm' : ''}` });
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
const lum = (px, i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
function stats(file) {
  const { w, h, bpp, px } = decode(file);
  let sum = 0, sq = 0;
  for (let i = 0; i < w * h; i++) { const l = lum(px, i * bpp); sum += l; sq += l * l; }
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
/** Pets = pixels that change when they are hidden; per box (team), the pets' luma and team-hue share, and the frame
 *  around them (the box grown by 60 %, pets excluded). */
function petMetrics(withFile, withoutFile, boxes) {
  const A = decode(withFile), B = decode(withoutFile);
  const res = [];
  for (const b of boxes) {
    let n = 0, l = 0, hue = 0, bn = 0, bl = 0;
    const gx = (b.x1 - b.x0) * 0.3, gy = (b.y1 - b.y0) * 0.3;
    for (let y = Math.max(0, Math.floor(b.y0 - gy)); y < Math.min(A.h, Math.ceil(b.y1 + gy)); y++) for (let x = Math.max(0, Math.floor(b.x0 - gx)); x < Math.min(A.w, Math.ceil(b.x1 + gx)); x++) {
      const i = (y * A.w + x) * A.bpp, j = (y * B.w + x) * B.bpp;
      const diff = Math.abs(A.px[i] - B.px[j]) + Math.abs(A.px[i + 1] - B.px[j + 1]) + Math.abs(A.px[i + 2] - B.px[j + 2]);
      const inBox = x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
      if (diff > 12 && inBox) {
        n++; l += lum(A.px, i);
        const c = hsl(A.px[i], A.px[i + 1], A.px[i + 2]), dh = Math.abs(((c.h - TEAM_HUE[b.team] + 540) % 360) - 180);
        if (dh <= 22 && c.s >= 0.45 && c.l >= 0.18 && c.l <= 0.78) hue++;
      } else if (diff <= 12) { bn++; bl += lum(B.px, j); }
    }
    res.push({ pet: b.tag, px: n, luma: n ? +(l / n).toFixed(1) : null, teamHuePct: n ? +((100 * hue) / n).toFixed(1) : null, around: bn ? +(bl / bn).toFixed(1) : null });
  }
  return res;
}

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ready = async (page) => {
  await page.waitForFunction(() => globalThis.__cvc?.ready === true, null, { timeout: 400000, polling: 1000 });
  const f0 = await page.evaluate(() => globalThis.__cvc.frames);
  await page.waitForFunction((n) => globalThis.__cvc.frames >= n, f0 + 3, { timeout: 400000, polling: 1000 });
};
const rows = [];
for (const s of shots) {
  const file = `${OUT}/${s.name}.png`;
  let row = { shot: s.name };
  for (let attempt = 0; attempt < 2; attempt++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    try {
      await page.goto(BASE + s.url, { timeout: 300000 });
      await ready(page);
      const dbg = await page.evaluate(() => { const d = globalThis.__cvc ?? {}; return { drawCalls: d.drawCalls ?? null, triangles: d.triangles ?? null }; });
      await page.screenshot({ path: file, timeout: 300000 });
      row = { shot: s.name, ...stats(file), ...dbg, errors: errors.length, attempt };
    } catch (e) { row = { shot: s.name, error: String(e).slice(0, 160), attempt }; }
    await page.close();
    if (!row.error && row.contrast > 3) break;
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}

if (SETS.includes('pets')) {
  for (const wx of ['dusk', 'storm']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(`${BASE}/labs/lot.html?webgl&pos=79.5,1.6,22.4&look=79.5,1.2,0&fov=66&t=0.74&hud=0&freeze&dummies=0${wx === 'storm' ? '&wx=storm' : ''}`, { timeout: 300000 });
    await ready(page);
    const setup = await page.evaluate(async () => {
      const lab = globalThis.__lab; const { THREE } = lab; const cam = lab.ctx.camera;
      const { createCharacter } = await import('/src/client/procgen/characters/index.ts');
      const boxes = lab.data.interiors ?? [];
      const p = cam.position;
      const box = boxes.find((b) => p.x >= b.min[0] && p.x <= b.max[0] && p.y >= b.min[1] && p.y <= b.max[1] && p.z >= b.min[2] && p.z <= b.max[2]);
      const dir = new THREE.Vector3(); cam.getWorldDirection(dir); dir.y = 0; dir.normalize();
      // the bore's far face along the view, then the pets 55 % of the way there (well inside, clear of the feather)
      let far = 30;
      if (box) for (let d = 0.5; d < 40; d += 0.25) { const x = p.x + dir.x * d, z = p.z + dir.z * d; if (x < box.min[0] || x > box.max[0] || z < box.min[2] || z > box.max[2]) { far = d; break; } }
      const at = Math.max(3, Math.min(7, far - 1.5)); // inside the bore, clear of the 0.4 m feather at its mouth
      const cx = p.x + dir.x * at, cz = p.z + dir.z * at;
      const ray = new THREE.Raycaster(new THREE.Vector3(cx, p.y + 0.2, cz), new THREE.Vector3(0, -1, 0), 0, 6);
      ray.camera = cam;
      const solids = []; lab.scene.traverse((o) => { if (o.isMesh && !o.isLineSegments2 && !o.isSprite && o.visible) solids.push(o); });
      const hit = ray.intersectObjects(solids, false).find((h) => h.object.isMesh && h.object.visible);
      const gy = hit ? hit.point.y : 0.3;
      const frame = { speed: 0, vy: 0, grounded: true, anim: 0, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false };
      const specs = [{ species: 0, cls: 'assault', team: 0, off: -0.9 }, { species: 1, cls: 'assault', team: 1, off: 0.9 }];
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const group = new THREE.Group(); const pets = [];
      for (const s of specs) {
        const av = createCharacter({ species: s.species, cls: s.cls, team: s.team, seed: 5, isLocal: false });
        av.root.position.set(cx + side.x * s.off, gy, cz + side.z * s.off);
        av.root.rotation.y = Math.atan2(p.x - av.root.position.x, p.z - av.root.position.z) + Math.PI;
        av.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
        for (let i = 0; i < 72; i++) av.update(frame, 1 / 60);
        group.add(av.root); pets.push({ av, team: s.team, tag: `${s.species ? 'cat' : 'corgi'}` });
      }
      lab.scene.add(group);
      globalThis.__q5 = { group, pets, box, THREE, cam };
      return { box, cam: [p.x, p.y, p.z], far: +far.toFixed(2), at: +at.toFixed(2), pets: [cx, gy, cz].map((v) => +v.toFixed(2)), insideBox: !!box };
    });
    const boxesPx = await page.evaluate(() => {
      const { pets, THREE, cam } = globalThis.__q5; const out = [];
      for (const pt of pets) {
        const bb = new THREE.Box3().setFromObject(pt.av.root); const c = [];
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) c.push(new THREE.Vector3(x, y, z).project(cam));
        const xs = c.map((v) => (v.x * 0.5 + 0.5) * 1280), ys = c.map((v) => (1 - (v.y * 0.5 + 0.5)) * 720);
        out.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), team: pt.team, tag: pt.tag });
      }
      return out;
    });
    const shot = async (name) => { const f0 = await page.evaluate(() => globalThis.__cvc.frames); await page.waitForFunction((n) => globalThis.__cvc.frames >= n, f0 + 3, { timeout: 400000, polling: 1000 }); const file = `${OUT}/${name}.png`; await page.screenshot({ path: file, timeout: 300000 }); return file; };
    // mask pass: everything but the pets hidden, the pets flat white (unlit, no fog), a black background
    await page.evaluate(() => {
      const lab = globalThis.__lab, q = globalThis.__q5, T = lab.THREE, keep = new Set();
      q.group.traverse((o) => keep.add(o));
      q.saved = []; const white = new T.MeshBasicNodeMaterial({ color: 0xffffff }); white.fog = false;
      lab.scene.traverse((o) => { if (o === lab.scene || o === q.group) return; if (!keep.has(o)) { if (o.visible && (o.isMesh || o.isLine || o.isPoints || o.isSprite)) { q.saved.push([o, 'v']); o.visible = false; } } else if (o.isMesh && !o.isLineSegments2) { q.saved.push([o, 'm', o.material]); o.material = white; } else if (o.isLineSegments2 && o.visible) { q.saved.push([o, 'v']); o.visible = false; } });
      q.bg = lab.scene.background; lab.scene.background = new T.Color(0); q.fog = lab.scene.fog; lab.scene.fog = null;
    });
    const maskFile = await shot(`pets-${wx}-mask`);
    await page.evaluate(() => { const lab = globalThis.__lab, q = globalThis.__q5; for (const [o, k, m] of q.saved) { if (k === 'v') o.visible = true; else o.material = m; } lab.scene.background = q.bg; lab.scene.fog = q.fog; });
    const on1 = await shot(`pets-${wx}-interiors-on`);
    await page.evaluate(async () => { const m = await import('/src/client/style/style-webgpu.js'); m.setStyleInteriors([]); });
    const off1 = await shot(`pets-${wx}-interiors-off`);
    const M = decode(maskFile);
    const petStats = (file) => {
      const A = decode(file); const res = [];
      for (const b of boxesPx) {
        let n = 0, l = 0, hue = 0, bn = 0, bl = 0;
        const gx = (b.x1 - b.x0) * 0.3, gy = (b.y1 - b.y0) * 0.3;
        for (let y = Math.max(0, Math.floor(b.y0 - gy)); y < Math.min(A.h, Math.ceil(b.y1 + gy)); y++) for (let x = Math.max(0, Math.floor(b.x0 - gx)); x < Math.min(A.w, Math.ceil(b.x1 + gx)); x++) {
          const i = (y * A.w + x) * A.bpp, mi = (y * M.w + x) * M.bpp;
          const isPet = lum(M.px, mi) > 100;
          if (isPet && x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) {
            n++; l += lum(A.px, i);
            const c = hsl(A.px[i], A.px[i + 1], A.px[i + 2]), dh = Math.abs(((c.h - TEAM_HUE[b.team] + 540) % 360) - 180);
            if (dh <= 22 && c.s >= 0.45 && c.l >= 0.18 && c.l <= 0.78) hue++;
          } else if (!isPet && lum(M.px, mi) < 20) { bn++; bl += lum(A.px, i); }
        }
        res.push({ pet: b.tag, px: n, luma: n ? +(l / n).toFixed(1) : null, teamHuePct: n ? +((100 * hue) / n).toFixed(1) : null, around: bn ? +(bl / bn).toFixed(1) : null });
      }
      return res;
    };
    const row = { shot: `pets-${wx}`, setup, errors, on: { frame: stats(on1), pets: petStats(on1) }, off: { frame: stats(off1), pets: petStats(off1) } };
    rows.push(row);
    console.log(JSON.stringify(row));
    await page.close();
  }
}
await browser.close();
writeFileSync(`${OUT}/stats.json`, JSON.stringify(rows, null, 1));
