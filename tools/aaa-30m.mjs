// The 30 m team-read check (W17-AAA-QA, QA-30M; docs/qa/w17/AAA-30M.md): after every AAA pass (SKY, WET, AIR,
// BACKDROP) a Corgi bot and a Cat bot stand 30 m from the play camera in four configs (Godot Compatibility, Godot
// Forward+, twin WebGL, twin WebGPU high) and three views (face: facing the camera, side: side on, both on the Lot
// asphalt in the Corgi pit's flood pool; horizon: side on at the Cat plateau's front lip, above the hoarding line, the
// band the backdrop pass fills). Each view is TWO frames of the same state: the normal frame and a known-colour matte
// (no AA, no post, unlit, black sky) that says which pixels are each bot's armour, coat and the rest. The metric reads
// only the PNG pair, so a later pass re-runs it unchanged.
//
//   node tools/aaa-30m.mjs run --sha <rev> --out <dir> [--baseline <dir>]
//        a private copy of <rev> (git archive, node_modules linked, fresh Godot --import; the copy is stamped with the
//        SHA and a reused --out holding another SHA is refused), all configs and views, measured
//   node tools/aaa-30m.mjs run --tree <dir> --out <dir> [--baseline <dir>]
//        an existing archive copy (a git checkout is refused: the Godot helper is written into the tree for the run)
//   node tools/aaa-30m.mjs measure --out <dir> [--baseline <dir>] [--mutate] [--mutate-ring <ΔL*> [--mutate-views v,..]]
//        re-measure saved frames. Mutants (in memory, nothing written over the frames): --mutate paints the Cat bot's
//        armour pixels the Corgi bot's mean armour colour; --mutate-ring shifts L* of the background within 3 px of
//        either bot (the ring the edge reads) in the given views (horizon)
//   --baseline <dir>: the regression rule [lead ruling 2026-10-17]. The baseline's saved frames are re-measured with this
//        metric; every barred number that passes there must still pass, and every barred number that fails there may
//        not fall by more than the noise floor (2 L* / 2 ΔE: --noise n, or --noise-<config> n). Exit 1 lists each
//        regressed number with its baseline and new value; exit 2 if a view is missing or the lineup moved (> 5 cm).
//   options: --configs compat,fplus,webgl,webgpu · --views face,side,horizon · --godot <binary> (or $GODOT) ·
//            --port <vite port> (5199) · --max-load 8 (wait for load5 below it before each render batch) · --settle N
//            (Godot frames before the shot, 60) · --steps N (twin frames, 8) · --keep (leave the Godot helper in place)
// Godot: xvfb-run 1280x720, Compatibility = --rendering-method gl_compatibility --rendering-driver opengl3, Forward+ =
// the project default. Twin: vite from the tree, Playwright Chromium on SwiftShader (WebGL2: ANGLE; WebGPU: the
// swiftshader adapter with a TEST-ONLY shim for Chromium 141's texture-view swizzle); frames are read back from a
// render target (a page screenshot misses a WebGPU canvas). Renders run at nice 10, one renderer at a time.
//
// Per view and bot, in colour, greyscale (= L*) and the Machado (2009, severity 1) deuteranopia and protanopia
// simulations applied in linear RGB: armour px and share of the pet, mean L* / C* of armour and coat, ΔL* armour vs own
// coat; the teams' armour ΔE (CIE76 of the mean L*a*b*); the silhouette's EDGE contrast (mean |ΔL*| across the outline,
// the pixel 2 px inside vs the pixel 2 px past the first background pixel, as labs/cover-metric.mjs reads it); and,
// reported only, the pet's mean L* minus its ring's (the matte's background within 2 px, Chebyshev).
// The bar [card W17-AAA-QA; lead rulings 2026-10-17]: teams ΔE >= 20 in colour and both CVD views, ΔL* >= 10 in
// greyscale; every pet's edge |ΔL*| >= 15 in all four images; a bot of >= 30 px with >= 6 armour px. (Species read in a
// 1:1 crop is judged by eye from the crops this writes.) Exit 0 = AAA-30M PASS in every measured config, 1 = a FAIL,
// 2 = could not measure; with --baseline the exit is the regression verdict instead (0 none, 1 regressed, 2 unmeasured).
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { setPriority, loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'run';
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const OUT = resolve(String(opt('out', 'artifacts/aaa-30m')));
const CONFIGS = String(opt('configs', 'compat,fplus,webgl,webgpu')).split(',');
const VIEWS = String(opt('views', 'face,side,horizon')).split(',');
const MAX_LOAD = Number(opt('max-load', 8));
const SETTLE = Number(opt('settle', 60));
const STEPS = Number(opt('steps', 8));
const PORT = Number(opt('port', 5199));
/** This process runs at nice 10 (its renderers inherit it: Godot, vite, Chromium); else Godot is started through nice. */
let RENICED = false;
const LABEL = { compat: 'Godot Compatibility', fplus: 'Godot Forward+', webgl: 'twin WebGL', webgpu: 'twin WebGPU high' };

// --------------------------------------------------------------------------------------------- the views (shared)
/** Where each view stands. face: Godot's own --lineup search (match.gd _place_lineup) around the Corgi pit's flood
 *  pool (flood_pit_east's target, the_lot.json floodlights) instead of the slab; side: the same spot and camera, the
 *  bots turned side on as --lineup-side places them (its own search picks a spot a crate hides them from); horizon: the bots on the Cat
 *  plateau's front lip (terrain 4.6 m from z 95), the human 30 m south on the yard (bearing 180 from the bots). */
const VIEW_ARGS = {
  face: ['--qa-view', 'face', '--qa-centre', '-22,-2.4,-108'],
  side: ['--qa-view', 'side', '--qa-centre', '-22,-2.4,-108'],
  horizon: ['--qa-view', 'horizon', '--qa-centre', '74,4.6,95.8', '--qa-bearing', '180'],
};

// --------------------------------------------------------------------------------------------- colour science
const LIN = Float64Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const f3 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
/** CIE L*a*b* (D65) of a linear-RGB triple. */
function labLin(r, g, b) {
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const fy = f3(Y);
  return [116 * fy - 16, 500 * (f3(X) - fy), 200 * (fy - f3(Z))];
}
/** Machado, Oliveira & Fernandes (2009), severity 1.0, applied to linear RGB. */
const MACHADO = {
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const cvd = (M, r, g, b) => [clamp01(M[0][0] * r + M[0][1] * g + M[0][2] * b), clamp01(M[1][0] * r + M[1][1] * g + M[1][2] * b), clamp01(M[2][0] * r + M[2][1] * g + M[2][2] * b)];
const SIMS = ['colour', 'grey', 'deutan', 'protan'];
/** L*a*b* of an sRGB8 pixel in one simulation (grey = L* only). */
function labSim(sim, R, G, B) {
  const r = LIN[R], g = LIN[G], b = LIN[B];
  if (sim === 'colour') return labLin(r, g, b);
  if (sim === 'grey') { const L = labLin(r, g, b)[0]; return [L, 0, 0]; }
  const [x, y, z] = cvd(MACHADO[sim], r, g, b);
  return labLin(x, y, z);
}
const enc = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
/** The image as a simulation shows it (sRGB8 out), for the sheets. */
function simImage(img, sim) {
  const o = Buffer.alloc(img.d.length);
  for (let i = 0; i < img.d.length; i += 3) {
    const r = LIN[img.d[i]], g = LIN[img.d[i + 1]], b = LIN[img.d[i + 2]];
    let c;
    if (sim === 'grey') { const L = labLin(r, g, b)[0]; const Y = L > 8 ? ((L + 16) / 116) ** 3 : L / 903.3; c = [Y, Y, Y]; }
    else if (sim === 'colour') c = [r, g, b];
    else c = cvd(MACHADO[sim], r, g, b);
    o[i] = enc(c[0]); o[i + 1] = enc(c[1]); o[i + 2] = enc(c[2]);
  }
  return { d: o, w: img.w, h: img.h };
}

// --------------------------------------------------------------------------------------------- the matte
/** Matte codes (one bit per channel, threshold 128): 0 background · Corgi bot 4 armour, 2 coat, 1 other · Cat bot
 *  6 armour, 3 coat, 5 other · 7 never written (an error). The same codes in Godot and the twin. */
const PART = { 4: ['corgi', 'armour'], 2: ['corgi', 'coat'], 1: ['corgi', 'other'], 6: ['cat', 'armour'], 3: ['cat', 'coat'], 5: ['cat', 'other'] };
async function rgb(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, w: info.width, h: info.height };
}
function codes(m) {
  const c = new Uint8Array(m.w * m.h);
  for (let k = 0, i = 0; k < c.length; k++, i += 3) c[k] = (m.d[i] > 127 ? 4 : 0) | (m.d[i + 1] > 127 ? 2 : 0) | (m.d[i + 2] > 127 ? 1 : 0);
  return c;
}

/** Everything the bar reads, for one view (normal frame + matte). */
function measureView(img, code) {
  const { w, h } = img;
  const bad = code.reduce((n, v) => n + (v === 7 ? 1 : 0), 0);
  const pets = {};
  for (const pet of ['corgi', 'cat']) {
    const inPet = new Uint8Array(w * h);
    const parts = { armour: [], coat: [], other: [] };
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let k = 0; k < code.length; k++) {
      const p = PART[code[k]];
      if (!p || p[0] !== pet) continue;
      inPet[k] = 1; parts[p[1]].push(k);
      const x = k % w, y = (k - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const all = [...parts.armour, ...parts.coat, ...parts.other];
    // the ring: background pixels within 2 px (Chebyshev) of the silhouette
    const ring = [];
    for (let y = Math.max(0, y0 - 2); y <= Math.min(h - 1, y1 + 2); y++) for (let x = Math.max(0, x0 - 2); x <= Math.min(w - 1, x1 + 2); x++) {
      const k = y * w + x;
      if (code[k] !== 0) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && inPet[yy * w + xx]) { near = true; break; }
      }
      if (near) ring.push(k);
    }
    const stat = (list, sim) => {
      let L = 0, A = 0, B = 0, C = 0;
      for (const k of list) { const i = k * 3; const [l, a, b] = labSim(sim, img.d[i], img.d[i + 1], img.d[i + 2]); L += l; A += a; B += b; C += Math.hypot(a, b); }
      const n = list.length || 1;
      return { L: L / n, a: A / n, b: B / n, C: C / n, n: list.length };
    };
    // edge contrast, THE silhouette bar (lead ruling 2026-10-17): for every pet pixel next to the background (4-way),
    // the pixel 2 px further inside vs the pixel 2 px past the first background pixel, mean |ΔL*|, as
    // labs/cover-metric.mjs reads the cover edge; in each image (colour, grey, deuteranopia, protanopia)
    const pairs = [];
    for (const k of all) {
      const x = k % w, y = (k - x) / w;
      for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const qx = x + sx, qy = y + sy;
        if (qx < 2 || qy < 2 || qx >= w - 2 || qy >= h - 2 || code[qy * w + qx] !== 0) continue;
        let ix = x - 2 * sx, iy = y - 2 * sy; if (!inPet[iy * w + ix]) { ix = x; iy = y; }
        let ox = qx + 2 * sx, oy = qy + 2 * sy; if (code[oy * w + ox] !== 0) { ox = qx; oy = qy; }
        pairs.push(iy * w + ix, oy * w + ox);
      }
    }
    const Lk = (sim, k) => labSim(sim, img.d[k * 3], img.d[k * 3 + 1], img.d[k * 3 + 2])[0];
    const edge = {};
    for (const sim of SIMS) {
      let e = 0;
      for (let i = 0; i < pairs.length; i += 2) e += Math.abs(Lk(sim, pairs[i]) - Lk(sim, pairs[i + 1]));
      edge[sim] = pairs.length ? e / (pairs.length / 2) : 0;
    }
    const sims = {};
    for (const sim of SIMS) sims[sim] = { armour: stat(parts.armour, sim), coat: stat(parts.coat, sim), pet: stat(all, sim), ring: stat(ring, sim) };
    pets[pet] = { px: all.length, armourPx: parts.armour.length, coatPx: parts.coat.length, otherPx: parts.other.length,
      share: all.length ? parts.armour.length / all.length : 0, bbox: [x0, y0, x1, y1], ringPx: ring.length,
      edge, edgePairs: pairs.length / 2, sims };
  }
  const team = {};
  for (const sim of SIMS) {
    const a = pets.corgi.sims[sim].armour, b = pets.cat.sims[sim].armour;
    team[sim] = Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
  }
  return { bad, pets, team };
}

/** The bar [card W17-AAA-QA, lead rulings 2026-10-17]; species read is by eye (crops). The pet-vs-ring mean ΔL* is
 *  reported, not barred: a light/dark split pet can average to its background and still read (the edge says so). */
const BAR = { teamDE: 20, teamDL: 10, edgeDL: 15, minArmourPx: 6, minPetPx: 30 };
const METRIC_VERSION = 2;
/** Every barred number of a view: { key, unit, value, bar, lower? }. Higher is better (value >= bar), except `lower`
 *  items (value <= bar): the matte's integrity, its px with an unknown code, must stay 0 (PARITY G34). */
const passes = (n) => (n.lower ? n.value <= n.bar : n.value >= n.bar);
function barred(m) {
  const out = [{ key: 'matte unknown-code', unit: 'px', value: m.bad, bar: 0, lower: true }];
  for (const sim of SIMS) out.push({ key: `teams ${sim}`, unit: sim === 'grey' ? 'ΔL*' : 'ΔE', value: m.team[sim], bar: sim === 'grey' ? BAR.teamDL : BAR.teamDE });
  for (const pet of ['corgi', 'cat']) {
    const p = m.pets[pet];
    for (const sim of SIMS) out.push({ key: `${pet} edge ${sim}`, unit: '|ΔL*|', value: p.edge[sim], bar: BAR.edgeDL });
    out.push({ key: `${pet} px`, unit: 'px', value: p.px, bar: BAR.minPetPx });
    out.push({ key: `${pet} armour px`, unit: 'px', value: p.armourPx, bar: BAR.minArmourPx });
  }
  return out;
}
function judge(m) {
  const fails = [];
  // (pipes escaped: the messages go into a markdown table cell)
  for (const n of barred(m)) if (!passes(n)) fails.push(`${n.key} ${n.unit.replace(/\|/g, '\\|')} ${n.unit === 'px' ? n.value : n.value.toFixed(1)} (${n.lower ? '>' : '<'} ${n.bar})`);
  return fails;
}

// --------------------------------------------------------------------------------------------- sheets (images)
const svgLabel = (text, w, h = 18) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#000"/><text x="4" y="${h - 5}" font-family="DejaVu Sans, sans-serif" font-size="12" fill="#fff">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);
async function cropRaw(img, x, y, w, h, scale = 1) {
  x = Math.max(0, Math.min(img.w - w, x)); y = Math.max(0, Math.min(img.h - h, y));
  let s = sharp(img.d, { raw: { width: img.w, height: img.h, channels: 3 } }).extract({ left: x, top: y, width: w, height: h });
  if (scale !== 1) s = sharp(await s.png().toBuffer()).resize(w * scale, h * scale, { kernel: 'nearest' });
  return s.png().toBuffer();
}
async function grid(cells, cols, cw, ch, out) {
  const rows = Math.ceil(cells.length / cols), lh = 18;
  const comp = [];
  cells.forEach((c, i) => {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * (ch + lh);
    comp.push({ input: svgLabel(c.label, cw, lh), left: x, top: y }, { input: c.png, left: x, top: y + lh });
  });
  await sharp({ create: { width: cols * cw, height: rows * (ch + lh), channels: 3, background: '#000' } }).composite(comp).jpeg({ quality: 86 }).toFile(out);
}
/** The pets' union box (from the matte) padded to at least w x h around its centre. */
function around(m, w, h) {
  const a = m.pets.corgi.bbox, b = m.pets.cat.bbox;
  const cx = Math.round((Math.min(a[0], b[0]) + Math.max(a[2], b[2])) / 2), cy = Math.round((Math.min(a[1], b[1]) + Math.max(a[3], b[3])) / 2);
  return [cx - (w >> 1), cy - (h >> 1)];
}

// --------------------------------------------------------------------------------------------- measuring a directory
/** sRGB8 of a L*a*b* (D65) colour (the inverse of labLin + the sRGB curve). */
function labToSrgb8(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  return [enc(clamp01(3.2406 * X - 1.5372 * Y - 0.4986 * Z)), enc(clamp01(-0.9689 * X + 1.8758 * Y + 0.0415 * Z)), enc(clamp01(0.0557 * X - 0.204 * Y + 1.057 * Z))];
}
/** --mutate-ring <ΔL*>: shift L* of every background pixel within 3 px (Chebyshev) of either bot (the ring the edge
 *  reads: its outer sample is the 3rd pixel out) by ΔL*, hue kept, in the views of --mutate-views (horizon). */
function shiftRing(img, code, dL) {
  const { w, h } = img;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (code[k] !== 0) continue;
    let near = false;
    for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && PART[code[yy * w + xx]]) { near = true; break; }
    }
    if (!near) continue;
    const [L, a, b] = labSim('colour', img.d[k * 3], img.d[k * 3 + 1], img.d[k * 3 + 2]);
    const c = labToSrgb8(Math.max(0, Math.min(100, L + dL)), a, b);
    img.d[k * 3] = c[0]; img.d[k * 3 + 1] = c[1]; img.d[k * 3 + 2] = c[2];
  }
}

async function measureDir(dir, mutation = {}) {
  const results = { version: METRIC_VERSION, bar: BAR, dir, configs: {}, mutation };
  for (const cfg of CONFIGS) {
    const views = {};
    for (const v of VIEWS) {
      const p = join(dir, `${cfg}-${v}.png`), mp = join(dir, `${cfg}-${v}-mask.png`);
      if (!existsSync(p) || !existsSync(mp)) { views[v] = { missing: true }; continue; }
      const img = await rgb(p), code = codes(await rgb(mp));
      if (Number.isFinite(mutation.ring) && (mutation.ringViews ?? ['horizon']).includes(v)) shiftRing(img, code, mutation.ring);
      if (mutation.armour) {
        // the Cat bot's armour pixels painted the Corgi bot's mean armour colour (linear mean)
        let r = 0, g = 0, b = 0, n = 0;
        for (let k = 0; k < code.length; k++) if (code[k] === 4) { r += LIN[img.d[k * 3]]; g += LIN[img.d[k * 3 + 1]]; b += LIN[img.d[k * 3 + 2]]; n++; }
        const c = n ? [enc(r / n), enc(g / n), enc(b / n)] : [0, 0, 0];
        for (let k = 0; k < code.length; k++) if (code[k] === 6) { img.d[k * 3] = c[0]; img.d[k * 3 + 1] = c[1]; img.d[k * 3 + 2] = c[2]; }
      }
      const m = measureView(img, code);
      m.fails = judge(m);
      m.pass = m.fails.length === 0;
      views[v] = m;
    }
    const measured = Object.values(views).filter((x) => !x.missing);
    results.configs[cfg] = { views, measured: measured.length, pass: measured.length === VIEWS.length && measured.every((x) => x.pass) };
  }
  return results;
}

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : 'n/a');
const f0 = (v) => (Number.isFinite(v) ? v.toFixed(0) : 'n/a');
function report(results) {
  const lines = [];
  for (const cfg of CONFIGS) {
    const c = results.configs[cfg];
    lines.push(`\n### ${LABEL[cfg] ?? cfg}: ${c.pass ? 'PASS' : c.measured === VIEWS.length ? 'FAIL' : 'NOT MEASURED'}\n`);
    lines.push('| View | Pet | Armour px (share) | Armour L*/C* | Coat L*/C* | ΔL* armour−coat | Edge \\|ΔL*\\| colour / grey / deutan / protan (bar ≥ 15) | Pet vs ring ΔL* colour / grey / deutan / protan (reported) |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const v of VIEWS) {
      const m = c.views[v];
      if (!m || m.missing) { lines.push(`| ${v} | – | not measured | | | | | |`); continue; }
      for (const pet of ['corgi', 'cat']) {
        const p = m.pets[pet], s = p.sims;
        const ring = SIMS.map((sim) => f1(s[sim].pet.L - s[sim].ring.L)).join(' / ');
        const edge = SIMS.map((sim) => (p.edge[sim] >= BAR.edgeDL ? f1(p.edge[sim]) : `**${f1(p.edge[sim])}**`)).join(' / ');
        lines.push(`| ${v} | ${pet === 'corgi' ? 'Corgi Company' : 'Cat Cadre'} | ${p.armourPx} of ${p.px} (${(100 * p.share).toFixed(0)}%) | ${f0(s.colour.armour.L)}/${f0(s.colour.armour.C)} | ${f0(s.colour.coat.L)}/${f0(s.colour.coat.C)} | ${f1(s.colour.armour.L - s.colour.coat.L)} | ${edge} | ${ring} |`);
      }
    }
    lines.push('');
    lines.push('| View | Teams ΔE colour | ΔL* grey | ΔE deutan | ΔE protan | Bar |');
    lines.push('|---|---|---|---|---|---|');
    for (const v of VIEWS) {
      const m = c.views[v];
      if (!m || m.missing) continue;
      lines.push(`| ${v} | ${f1(m.team.colour)} | ${f1(m.team.grey)} | ${f1(m.team.deutan)} | ${f1(m.team.protan)} | ${m.pass ? 'PASS' : 'FAIL: ' + m.fails.join('; ')} |`);
    }
  }
  lines.push('');
  lines.push(CONFIGS.map((cfg) => `AAA-30M ${LABEL[cfg] ?? cfg}: ${results.configs[cfg].pass ? 'PASS' : results.configs[cfg].measured === VIEWS.length ? 'FAIL' : 'NOT MEASURED'}`).join('\n'));
  return lines.join('\n');
}

/** How far each config's lineup (camera origin, pets' feet) sits from the baseline's, in metres: the views must hold. */
function viewDrift(ref) {
  const out = {};
  for (const cfg of CONFIGS) for (const v of VIEWS) {
    const rp = ref ? join(ref, `${cfg}-${v}.json`) : '';
    const p = join(OUT, `${cfg}-${v}.json`), b = rp && existsSync(rp) ? JSON.parse(readFileSync(rp, 'utf8')) : BASELINE_VIEWS[v];
    if (!existsSync(p) || !b) continue;
    const j = JSON.parse(readFileSync(p, 'utf8'));
    let d = Math.hypot(...j.camera.origin.map((x, i) => x - b.camera.origin[i]));
    j.pets.forEach((q, i) => { if (b.pets[i]) d = Math.max(d, Math.hypot(...q.feet.map((x, k) => x - b.pets[i].feet[k]))); });
    out[`${cfg}-${v}`] = +d.toFixed(3);
  }
  return out;
}

async function sheets(results) {
  const dir = join(OUT, 'sheets');
  mkdirSync(dir, { recursive: true });
  const have = (cfg, v) => existsSync(join(OUT, `${cfg}-${v}.png`)) && results.configs[cfg]?.views[v] && !results.configs[cfg].views[v].missing;
  for (const v of VIEWS) {
    const cells = [];
    for (const cfg of CONFIGS) {
      if (!have(cfg, v)) continue;
      const img = await rgb(join(OUT, `${cfg}-${v}.png`));
      const [x, y] = around(results.configs[cfg].views[v], 400, 225);
      cells.push({ label: `${LABEL[cfg]} · ${v} · 1:1`, png: await cropRaw(img, x, y, 400, 225) });
    }
    if (cells.length) await grid(cells, 2, 400, 225, join(dir, `aaa30m-${v}-1x.jpg`));
  }
  // 4x crops: every config and view (species read; the matte beside it)
  const cells = [];
  for (const cfg of CONFIGS) for (const v of VIEWS) {
    if (!have(cfg, v)) continue;
    const img = await rgb(join(OUT, `${cfg}-${v}.png`)), mk = await rgb(join(OUT, `${cfg}-${v}-mask.png`));
    const [x, y] = around(results.configs[cfg].views[v], 80, 40);
    cells.push({ label: `${LABEL[cfg]} · ${v} · 4x`, png: await cropRaw(img, x, y, 80, 40, 4) });
    cells.push({ label: 'matte', png: await cropRaw(mk, x, y, 80, 40, 4) });
  }
  if (cells.length) await grid(cells, 4, 320, 160, join(dir, 'aaa30m-crops-4x.jpg'));
  // grey and colour-blind views of the face and horizon crops
  for (const v of ['face', 'horizon']) {
    const g = [];
    for (const cfg of CONFIGS) {
      if (!have(cfg, v)) continue;
      const img = await rgb(join(OUT, `${cfg}-${v}.png`));
      const [x, y] = around(results.configs[cfg].views[v], 80, 40);
      for (const sim of SIMS) g.push({ label: `${LABEL[cfg]} · ${sim}`, png: await cropRaw(simImage(img, sim), x, y, 80, 40, 3) });
    }
    if (g.length) await grid(g, 4, 240, 120, join(dir, `aaa30m-gray-cvd-${v}.jpg`));
  }
  // the full frames, half size
  const full = [];
  for (const cfg of CONFIGS) {
    if (!have(cfg, 'face')) continue;
    full.push({ label: `${LABEL[cfg]} · face · full frame (½)`, png: await sharp(join(OUT, `${cfg}-face.png`)).resize(640, 360).png().toBuffer() });
  }
  if (full.length) await grid(full, 2, 640, 360, join(dir, 'aaa30m-full-face.jpg'));
  const fullH = [];
  for (const cfg of CONFIGS) {
    if (!have(cfg, 'horizon')) continue;
    fullH.push({ label: `${LABEL[cfg]} · horizon · full frame (½)`, png: await sharp(join(OUT, `${cfg}-horizon.png`)).resize(640, 360).png().toBuffer() });
  }
  if (fullH.length) await grid(fullH, 2, 640, 360, join(dir, 'aaa30m-full-horizon.jpg'));
}

// --------------------------------------------------------------------------------------------- rendering
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitLoad() {
  for (;;) {
    const l = loadavg()[1];
    if (l < MAX_LOAD) return;
    console.log(`  load5 ${l.toFixed(2)} >= ${MAX_LOAD}: waiting`);
    await sleep(20000);
  }
}
function run(cmdline, args, opts = {}) {
  return new Promise((res) => {
    const p = spawn(cmdline, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    p.stdout.on('data', (b) => { out += b; });
    p.stderr.on('data', (b) => { out += b; });
    p.on('close', (code) => res({ code, out }));
  });
}

/** Godot helper: a SceneTree script written into the measured copy for the run (see GD_HELPER). */
function writeHelper(tree) { writeFileSync(join(tree, 'engines/godot/qa30m_lineup.gd'), GD_HELPER); }
function removeHelper(tree) { if (!opt('keep', false)) for (const f of ['qa30m_lineup.gd', 'qa30m_lineup.gd.uid']) rmSync(join(tree, 'engines/godot', f), { force: true }); }

/** A render must never leave an older frame to be measured (PARITY G35): its view files go before it renders. */
function clearView(cfg, view) {
  for (const f of [`${cfg}-${view}.png`, `${cfg}-${view}-mask.png`, `${cfg}-${view}.json`]) rmSync(join(OUT, f), { force: true });
}
let RENDER_FAILED = [];

async function renderGodot(tree, cfg, view) {
  clearView(cfg, view);
  const godot = String(opt('godot', process.env.GODOT ?? 'godot'));
  const ra = cfg === 'compat' ? ['--rendering-method', 'gl_compatibility', '--rendering-driver', 'opengl3'] : [];
  const args = ['-a', '-s', '-screen 0 1280x720x24', godot, '--path', join(tree, 'engines/godot'), ...ra, '--audio-driver', 'Dummy',
    '-s', 'res://qa30m_lineup.gd', '--', ...VIEW_ARGS[view], '--qa-settle', String(SETTLE), '--qa-out', join(OUT, `${cfg}-${view}`)];
  await waitLoad();
  const t0 = Date.now();
  const r = await (RENICED ? run('xvfb-run', args) : run('nice', ['-n', '10', 'xvfb-run', ...args]));
  const line = r.out.split('\n').find((l) => l.startsWith('QA30M ')) ?? r.out.split('\n').filter((l) => /FAIL|ERROR/.test(l)).slice(0, 4).join(' | ');
  console.log(`  ${cfg} ${view}: ${line} (${Math.round((Date.now() - t0) / 1000)} s)`);
  const ok = r.code === 0 && existsSync(join(OUT, `${cfg}-${view}.png`)) && existsSync(join(OUT, `${cfg}-${view}-mask.png`));
  if (!ok) { RENDER_FAILED.push(`${cfg} ${view} (Godot exit ${r.code})`); clearView(cfg, view); }
  return ok;
}

/** The Godot lineup a twin view copies: a fresh Godot run's JSON (Compatibility first), else the baked baseline. */
function godotView(view) {
  for (const c of ['compat', 'fplus']) {
    const p = join(OUT, `${c}-${view}.json`);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  console.log(`  ${view}: no Godot JSON in ${OUT}; using the baseline lineup baked into this script`);
  return BASELINE_VIEWS[view];
}

async function renderTwin(tree, cfgs) {
  for (const cfg of cfgs) for (const v of VIEWS) clearView(cfg, v);
  const { chromium } = await import('@playwright/test');
  await waitLoad();
  // the tree's own vite config, with a private dep cache (node_modules is the shared repo's: its .vite cache belongs to
  // the lanes' own dev servers)
  const vcfg = join(OUT, 'vite.qa30m.config.mjs');
  writeFileSync(vcfg, `import base from ${JSON.stringify(join(tree, 'vite.config.ts'))};\nexport default { ...base, cacheDir: ${JSON.stringify(join(OUT, '.vite-cache'))} };\n`);
  const vite = spawn(join(tree, 'node_modules/.bin/vite'), ['--config', vcfg, '--port', String(PORT), '--strictPort'], { cwd: tree, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  let vlog = '';
  vite.stdout.on('data', (b) => { vlog += b; }); vite.stderr.on('data', (b) => { vlog += b; });
  const ok = {};
  try {
    for (let i = 0; i < 120 && !/Local:/.test(vlog); i++) await sleep(500);
    if (!/Local:/.test(vlog)) throw new Error(`vite did not start on ${PORT}: ${vlog.slice(-400)}`);
    const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    for (const cfg of cfgs) {
      await waitLoad();
      const webgpu = cfg === 'webgpu';
      const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
      if (webgpu) args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader');
      const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, args });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e.stack ?? e).slice(0, 400)}`));
        if (webgpu) {
          // TEST-ONLY shim: Chromium 141 types GPUTextureViewDescriptor.swizzle as a dictionary; three r186 passes the
          // newer string form ('rgba'), so every createView throws. Strip it. Current Chrome needs no shim.
          await page.addInitScript(() => {
            if (globalThis.GPUTexture) {
              const cv = GPUTexture.prototype.createView;
              GPUTexture.prototype.createView = function (d) {
                if (d && typeof d.swizzle === 'string') { const { swizzle, ...rest } = d; void swizzle; return cv.call(this, rest); }
                return cv.call(this, d);
              };
            }
          });
        }
        const q = webgpu ? '?kit=glb&q=high' : '?kit=glb&webgl';
        const t0 = Date.now();
        await page.goto(`http://localhost:${PORT}/labs/lineup.html${q}`);
        await page.waitForFunction(() => globalThis.__lineup?.ready || globalThis.__lineup?.error, null, { timeout: 1800000, polling: 1000 });
        const st = await page.evaluate(() => ({ error: globalThis.__lineup.error, backend: globalThis.__lineup.backend, seeds: globalThis.__lineup.seeds }));
        if (st.error) throw new Error(`lab error: ${st.error.slice(0, 600)}`);
        if (webgpu && st.backend !== 'webgpu') throw new Error(`asked for WebGPU, got ${st.backend} (the WebGPU adapter did not start)`);
        console.log(`  ${cfg}: lab ready on ${st.backend} in ${Math.round((Date.now() - t0) / 1000)} s (bot seeds ${st.seeds.join(', ')})`);
        for (const view of VIEWS) {
          const v = godotView(view);
          await page.evaluate((x) => globalThis.__lineup.place(x), v);
          await page.evaluate((n) => globalThis.__lineup.step(n), STEPS);
          // which builder drew the bots: 'slab' (TW-PETS: Godot's PLACEHOLDER pets ported) or 'k2' (createCharacter); kept
          // as `petBuilder` in the JSON (its `pets` is the lineup)
          const pets = await page.evaluate(() => globalThis.__lineup.pets ?? 'k2');
          const cap = await page.evaluate(() => globalThis.__lineup.capture());
          writeFileSync(join(OUT, `${cfg}-${view}.png`), Buffer.from(cap.normal.split(',')[1], 'base64'));
          writeFileSync(join(OUT, `${cfg}-${view}-mask.png`), Buffer.from(cap.mask.split(',')[1], 'base64'));
          writeFileSync(join(OUT, `${cfg}-${view}.json`), JSON.stringify({ ...v, view, method: `twin-${st.backend}`, petBuilder: pets, seeds: st.seeds, size: [cap.w, cap.h] }, null, 1));
          console.log(`  ${cfg} ${view}: ${cap.w}x${cap.h} read back from a render target (pets: ${pets})`);
        }
        ok[cfg] = true;
      } catch (e) {
        console.log(`  ${cfg}: NOT MEASURED: ${String(e.message ?? e).slice(0, 600)}`);
        ok[cfg] = false;
        RENDER_FAILED.push(`${cfg} (${String(e.message ?? e).slice(0, 120)})`);
        for (const v of VIEWS) clearView(cfg, v);   // a half-rendered config is not measured
      } finally {
        await browser.close();
      }
    }
  } finally {
    vite.kill('SIGTERM');   // by PID: never pkill -f
  }
  return ok;
}

function prepareTree() {
  const sha = opt('sha', '');
  let tree = opt('tree', '');
  if (sha) {
    tree = join(OUT, 'tree');
    const full = spawnSync('git', ['-C', REPO, 'rev-parse', '--verify', `${sha}^{commit}`], { encoding: 'utf8' }).stdout.trim();
    if (!full) throw new Error(`${sha} is not a commit in ${REPO}`);
    const stamp = join(tree, '.qa30m-sha');
    if (existsSync(join(tree, 'package.json'))) {
      const had = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : '?';
      if (had !== full) throw new Error(`${tree} holds ${had}, not ${full}: give a new --out`);
    } else {
      mkdirSync(tree, { recursive: true });
      const a = spawnSync('bash', ['-c', `git -C "${REPO}" archive "${full}" | tar -x -C "${tree}"`], { stdio: 'inherit' });
      if (a.status !== 0) throw new Error(`git archive ${sha} failed`);
      symlinkSync(join(REPO, 'node_modules'), join(tree, 'node_modules'));
      writeFileSync(stamp, full + '\n');
    }
    console.log(`tree ${tree} = ${full}`);
    const godot = String(opt('godot', process.env.GODOT ?? 'godot'));
    if (CONFIGS.some((c) => c === 'compat' || c === 'fplus') && !existsSync(join(tree, 'engines/godot/.godot/imported'))) {
      console.log(`fresh Godot import in ${tree}`);
      spawnSync('nice', ['-n', '10', godot, '--headless', '--path', join(tree, 'engines/godot'), '--import'], { stdio: 'ignore' });
    }
  }
  if (!tree) throw new Error('give --sha <rev> (a private copy is made under --out) or --tree <a copy no other lane edits>');
  tree = resolve(String(tree));
  // a tree from before the lab landed: measure it with this checkout's lab (it draws with the TREE's own builders)
  if (CONFIGS.some((c) => c === 'webgl' || c === 'webgpu') && !existsSync(join(tree, 'labs/lineup.ts'))) {
    for (const f of ['labs/lineup.ts', 'labs/lineup.html']) copyFileSync(join(REPO, f), join(tree, f));
    console.log(`labs/lineup.* is not in ${tree}: copied from ${REPO}`);
  }
  // a git checkout is where lanes edit: measure an archive copy (no .git) unless told otherwise
  if (existsSync(join(tree, '.git')) && !opt('shared-tree-ok', false)) throw new Error(`--tree ${tree} is a git checkout: measure a private copy (--sha) instead`);
  return tree;
}

// --------------------------------------------------------------------------------------------- the regression rule
/** The noise floor (lead ruling 2026-10-17): 2 L* / 2 ΔE, measured repeats at f7f45b5 within it (docs/qa/w17/AAA-30M.md);
 *  --noise <n> overrides it for every config, --noise-<config> <n> for one. Pixel counts have no floor. */
const noiseFor = (cfg) => Number(opt(`noise-${cfg}`, opt('noise', 2)));
/** Every barred item that passes at the baseline must still pass, the matte's integrity included (unknown-code px must
 *  stay 0, PARITY G34); every barred number that fails there may not get worse by more than the noise floor (pixel
 *  counts: by nothing). So a config that passes at the baseline keeps passing, and goes PASS -> FAIL only with exit 1. */
function regressions(base, cur) {
  const list = [], missing = [];
  for (const cfg of CONFIGS) for (const v of VIEWS) {
    const b = base.configs[cfg]?.views[v], c = cur.configs[cfg]?.views[v];
    if (!b || b.missing) { missing.push(`${cfg} ${v}: no baseline frames`); continue; }
    if (!c || c.missing) { missing.push(`${cfg} ${v}: not measured`); continue; }
    const now = new Map(barred(c).map((n) => [n.key, n]));
    for (const B of barred(b)) {
      const C = now.get(B.key), noise = B.unit === 'px' ? 0 : noiseFor(cfg);
      const passB = passes(B), passC = passes(C);
      const worse = B.lower ? C.value - B.value : B.value - C.value;
      const why = passB && !passC ? 'passed at the baseline, fails now'
        : !passB && worse > noise ? `failed at the baseline and got ${worse.toFixed(1)} worse (noise floor ${noise})` : '';
      if (why) list.push({ config: cfg, view: v, key: B.key, unit: B.unit, baseline: B.value, now: C.value, bar: B.bar, why });
    }
  }
  return { list, missing };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (cmd === 'run') {
    try { setPriority(10); RENICED = true; } catch { /* not allowed: Godot still goes through nice */ }
    const tree = prepareTree();
    console.log(`AAA-30M run: tree ${tree} · out ${OUT} · configs ${CONFIGS.join(',')} · views ${VIEWS.join(',')}`);
    const gcfg = CONFIGS.filter((c) => c === 'compat' || c === 'fplus');
    if (gcfg.length) {
      writeHelper(tree);
      try {
        for (const cfg of gcfg) for (const v of VIEWS) await renderGodot(tree, cfg, v);
      } finally { removeHelper(tree); }
    }
    const tcfg = CONFIGS.filter((c) => c === 'webgl' || c === 'webgpu');
    if (tcfg.length) await renderTwin(tree, tcfg);
  } else if (cmd !== 'measure') {
    console.log('usage: node tools/aaa-30m.mjs run --sha <rev> --out <dir> [--baseline <dir>] | run --tree <dir> --out <dir> [--baseline <dir>] | measure --out <dir> [--baseline <dir>] [--mutate] [--mutate-ring <ΔL*>]');
    process.exit(2);
  }
  const mutation = {};
  if (opt('mutate', false)) mutation.armour = true;
  if (opt('mutate-ring', false) !== false) { mutation.ring = Number(opt('mutate-ring')); mutation.ringViews = String(opt('mutate-views', 'horizon')).split(','); }
  const mutated = Object.keys(mutation).length > 0;
  const results = await measureDir(OUT, mutation);
  const baseDir = opt('baseline', false) ? resolve(String(opt('baseline'))) : '';
  results.drift = viewDrift(baseDir);
  const moved = Object.entries(results.drift).filter(([, d]) => d > 0.05);
  let rep = report(results) + `\nviews vs the ${baseDir ? 'baseline run' : 'f7f45b5 baseline lineup'}: ${moved.length ? 'MOVED ' + moved.map(([k, d]) => `${k} ${d} m`).join(', ') + ' (the numbers are not like for like)' : 'unchanged (every camera and pet within 5 cm)'}`;
  let reg = null;
  if (baseDir) {
    // the baseline's saved frames, re-measured with this metric (stored numbers are never trusted across versions)
    const base = await measureDir(baseDir, {});
    reg = regressions(base, results);
    results.regression = { baseline: baseDir, noise: Object.fromEntries(CONFIGS.map((c) => [c, noiseFor(c)])), ...reg };
    rep += `\n\nREGRESSION vs ${baseDir} (noise floor ${CONFIGS.map((c) => `${c} ${noiseFor(c)}`).join(', ')}): ` +
      (reg.missing.length ? `NOT MEASURED (${reg.missing.join('; ')})` : reg.list.length ? `${reg.list.length} regressed number(s)` : 'none');
    for (const r of reg.list) rep += `\n  REGRESSED ${LABEL[r.config]} · ${r.view} · ${r.key}: ${r.unit === 'px' ? r.baseline : r.baseline.toFixed(1)} -> ${r.unit === 'px' ? r.now : r.now.toFixed(1)} ${r.unit} (bar ${r.bar}): ${r.why}`;
  }
  if (RENDER_FAILED.length) rep += `\n\nRENDER FAILED (exit 2; nothing stale was measured): ${RENDER_FAILED.join('; ')}`;
  console.log(rep);
  const stem = mutation.ring !== undefined ? 'results-mutant-ring' : mutated ? 'results-mutated' : 'results';
  writeFileSync(join(OUT, `${stem}.json`), JSON.stringify(results, null, 1));
  writeFileSync(join(OUT, `${stem}.md`), rep + '\n');
  if (!mutated) await sheets(results);
  const all = CONFIGS.map((c) => results.configs[c]);
  if (RENDER_FAILED.length || all.some((c) => c.measured < VIEWS.length)) process.exit(2);
  if (reg) process.exit(reg.missing.length || moved.length ? 2 : reg.list.length ? 1 : 0);
  process.exit(all.every((c) => c.pass) ? 0 : 1);
}

// --------------------------------------------------------------------------------------------- baked baseline lineup
/** The baseline (f7f45b5) Godot lineup (Compatibility JSON, rounded), used by a twin-only run with no fresh Godot JSON. */
const BASELINE_VIEWS = {"face":{"camera":{"origin":[-54.0607,-1.0346,-99.3186],"x":[0.2404,0.0,0.9707],"y":[-0.0226,0.9997,0.0056],"z":[-0.9704,-0.0233,0.2403],"fov":72.0,"near":0.05,"far":400.0},
  "pets":[{"team":0,"species":0,"bot":false,"feet":[-51.1203,-2.3999,-100.7885],"yaw":-1.328},{"team":0,"species":0,"bot":true,"feet":[-21.7837,-2.3999,-107.1264],"yaw":1.7836},{"team":1,"species":1,"bot":true,"feet":[-22.2163,-2.3999,-108.8736],"yaw":1.8435}]},
  "side":{"camera":{"origin":[-54.0607,-1.0346,-99.3186],"x":[0.2404,0.0,0.9707],"y":[-0.0226,0.9997,0.0056],"z":[-0.9704,-0.0233,0.2403],"fov":72.0,"near":0.05,"far":400.0},
  "pets":[{"team":0,"species":0,"bot":false,"feet":[-51.1203,-2.3999,-100.7885],"yaw":-1.328},{"team":0,"species":0,"bot":true,"feet":[-21.6635,-2.3999,-106.6411],"yaw":-2.8988},{"team":1,"species":1,"bot":true,"feet":[-22.3365,-2.3996,-109.3589],"yaw":-2.8988}]},
  "horizon":{"camera":{"origin":[73.28,0.8996,62.586],"x":[-1.0,0.0,-0.0],"y":[0.0,0.9849,-0.1734],"z":[0.0,-0.1734,-0.9849],"fov":72.0,"near":0.05,"far":400.0},
  "pets":[{"team":0,"species":0,"bot":false,"feet":[74.0,0.0198,65.8],"yaw":3.1416},{"team":0,"species":0,"bot":true,"feet":[75.4,4.6004,95.8],"yaw":-1.5708},{"team":1,"species":1,"bot":true,"feet":[72.6,4.6004,95.8],"yaw":-1.5708}]}};

// --------------------------------------------------------------------------------------------- the Godot helper
const GD_HELPER = String.raw`extends SceneTree
## QA-30M lineup (W17-AAA-QA). Written into the MEASURED COPY by tools/aaa-30m.mjs and removed after the run; never
## committed under engines/. Boots res://main.tscn with the game's own --lineup machinery (bots that stand still and
## hold fire, the play camera), re-centres the lineup (side reuses the face search's spot), and saves two frames of the
## SAME state:
##   <out>.png       the normal frame (HUD and rain particles hidden; everything else as the look draws it)
##   <out>-mask.png  a known-colour matte: MSAA off, environment black/linear, every mesh unshaded; the Corgi bot's
##                   armour (plate + band) 255,0,0 · coat 0,255,0 · other (accent, eyes, rifle) 0,0,255; the Cat bot's
##                   255,255,0 · 0,255,255 · 255,0,255; everything else 0,0,0 (occluders kept, transparent geometry hidden)
##   <out>.json      camera (origin, basis, fov, near, far) and the pets (team, species, feet, yaw), for the twin
## User args: --qa-view face|side|horizon  --qa-out <abs prefix>  --qa-centre x,y,z  [--qa-dist 30] [--qa-bearing deg]
##            [--qa-settle 60]
const SURFACES := ["coat", "accent", "dark", "plate", "band"]
const L_WORLD := 1
var A := {}
var main: Node
var game: Node
var look: Node
var cam: Camera3D

func _initialize() -> void:
	var a := OS.get_cmdline_user_args()
	for i in a.size():
		if a[i].begins_with("--qa-") and i + 1 < a.size():
			A[a[i].substr(5)] = a[i + 1]
	_run.call_deferred()

func _v3(s: String) -> Vector3:
	var f := s.split_floats(",")
	return Vector3(f[0], f[1], f[2])

func _ground(p: Vector3) -> Dictionary:
	var space := root.get_world_3d().direct_space_state
	return space.intersect_ray(PhysicsRayQueryParameters3D.create(p + Vector3(0, 30, 0), p - Vector3(0, 30, 0), L_WORLD))

func _frames(n: int) -> void:
	for i in n:
		await process_frame

func _die(msg: String) -> void:
	printerr("QA30M FAIL " + msg)
	quit(2)

func _run() -> void:
	var view: String = A.get("view", "face")
	var out: String = A.get("out", "")
	if out == "":
		_die("--qa-out missing")
		return
	main = load("res://main.tscn").instantiate()
	game = main.get_node("Game")
	look = main.get_node("Look")
	game.opts.lineup = float(A.get("dist", "30"))
	game.opts.lineup_side = false
	root.add_child(main)
	for i in 1200:
		if game.playing():
			break
		await process_frame
	if not game.playing():
		_die("the match did not start")
		return
	await _frames(5)
	var g := _ground(_v3(A.get("centre", "0,0,0")))
	if g.is_empty():
		_die("no ground under --qa-centre")
		return
	var c: Vector3 = g.position
	var dist := float(A.get("dist", "30"))
	var bots: Array = game.pets.filter(func(p): return p != game.player)
	if view == "horizon":
		if not _place_horizon(c, dist, bots):
			return
	else:
		game.slab.center = c  # the game's own lineup search, around the flood pool instead of the slab
		game._place_lineup(dist)
		cam = game.player.camera
		if view == "side":
			# side on from the face view's (clear) spot: the --lineup-side placement (1.4 m off the centre, facing along
			# the row) on the face view's bearing; --lineup-side's own search can pick a spot a crate hides the bots from
			var spot: Vector3 = game.lineup_spot
			var vd := Vector3(c.x - spot.x, 0.0, c.z - spot.z).normalized()
			var across := Vector3(-vd.z, 0.0, vd.x)
			for p in bots:
				var at: Vector3 = c + across * (1.4 if p.team == 0 else -1.4)
				var gs := _ground(at)
				var pos: Vector3 = (gs.position if not gs.is_empty() else at) + Vector3(0, 0.05, 0)
				p.respawn(pos, game._yaw_to(pos, pos + across))
	if game.hud != null:
		game.hud.visible = false
	for n in root.find_children("*", "GPUParticles3D", true, false):
		n.visible = false
		n.emitting = false
	await _frames(int(A.get("settle", "60")))
	var info := _info(view, c)
	var f := FileAccess.open(out + ".json", FileAccess.WRITE)
	f.store_string(JSON.stringify(info, " "))
	f.close()
	var img := root.get_texture().get_image()
	var err := img.save_png(out + ".png")
	_mask_mode(bots)
	await _frames(6)
	var m := root.get_texture().get_image()
	err = err | m.save_png(out + "-mask.png")
	print("QA30M %s %s err=%d %dx%d adapter=%s method=%s" % [view, out, err, img.get_width(), img.get_height(),
		RenderingServer.get_video_adapter_name(), RenderingServer.get_current_rendering_method()])
	quit(0 if err == OK else 1)

## Horizon view: the bots side on, a body length apart, across the line of sight at c (the Cat plateau's front lip, so
## from the yard below they stand above the hoarding line: the band the backdrop pass fills); the human dist m away on
## --qa-bearing (degrees, the direction from c to the human), the play camera aimed as --lineup aims it.
func _place_horizon(c: Vector3, dist: float, bots: Array) -> bool:
	var a := deg_to_rad(float(A.get("bearing", "180")))
	var d := Vector3(sin(a), 0.0, cos(a))
	var across := Vector3(-d.z, 0.0, d.x)
	var gh := _ground(c + d * dist)
	if gh.is_empty():
		_die("horizon: no ground under the camera spot")
		return false
	var spot: Vector3 = gh.position
	var off := 1.4
	for p in bots:
		var at: Vector3 = c + across * (off if p.team == 0 else -off)
		var g := _ground(at)
		var pos: Vector3 = (g.position if not g.is_empty() else at) + Vector3(0, 0.05, 0)
		p.respawn(pos, game._yaw_to(pos, pos + across))
	game.player.respawn(spot + Vector3(0, 0.05, 0), game._yaw_to(spot, c))
	game.player.cam_pitch = atan2(c.y + 0.6 + 1.5 - (spot.y + 1.4), Vector2(c.x - spot.x, c.z - spot.z).length())
	cam = game.player.camera
	return true

func _info(view: String, c: Vector3) -> Dictionary:
	var t := cam.global_transform
	var pets := []
	for p in game.pets:
		var mb: Basis = p.model.global_basis
		var fwd := -mb.z
		pets.append({"team": p.team, "species": p.species, "bot": p != game.player,
			"feet": [p.model.global_position.x, p.model.global_position.y, p.model.global_position.z],
			"yaw": atan2(-fwd.x, -fwd.z)})
	return {"view": view, "method": RenderingServer.get_current_rendering_method(),
		"adapter": RenderingServer.get_video_adapter_name(), "centre": [c.x, c.y, c.z],
		"bearing": float(A.get("bearing", "-1")) if view == "horizon" else null,
		"camera": {"origin": [t.origin.x, t.origin.y, t.origin.z],
			"x": [t.basis.x.x, t.basis.x.y, t.basis.x.z], "y": [t.basis.y.x, t.basis.y.y, t.basis.y.z],
			"z": [t.basis.z.x, t.basis.z.y, t.basis.z.z], "fov": cam.fov, "near": cam.near, "far": cam.far},
		"pets": pets, "size": [root.size.x, root.size.y]}

func _flat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = c
	m.disable_fog = true
	return m

func _transparent(g: GeometryInstance3D) -> bool:
	if g.transparency > 0.0:
		return true
	var mats := []
	if g.material_override != null:
		mats.append(g.material_override)
	elif g is MeshInstance3D and g.mesh != null:
		for i in g.mesh.get_surface_count():
			mats.append(g.get_active_material(i))
	for m in mats:
		if m is BaseMaterial3D and m.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED:
			return true
		if m is ShaderMaterial and m.shader != null and ("ALPHA" in m.shader.code or "blend_add" in m.shader.code):
			return true
	return false

func _mask_mode(bots: Array) -> void:
	root.msaa_3d = Viewport.MSAA_DISABLED
	root.screen_space_aa = Viewport.SCREEN_SPACE_AA_DISABLED
	root.use_taa = false
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color.BLACK
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.tonemap_exposure = 1.0
	for we in root.find_children("*", "WorldEnvironment", true, false):
		we.environment = env
		we.camera_attributes = null
	cam.environment = null
	cam.attributes = null
	var black := _flat(Color.BLACK)
	var cls := {}
	for p in bots:
		var k: int = 0 if p.team == 0 else 1
		var col: Array = [[Color(1, 0, 0), Color(0, 1, 0), Color(0, 0, 1)], [Color(1, 1, 0), Color(0, 1, 1), Color(1, 0, 1)]][k]
		for g in p.find_children("*", "GeometryInstance3D", true, false):
			cls[g] = [_flat(col[0]), _flat(col[1]), _flat(col[2])]
	for n in root.find_children("*", "Node3D", true, false):
		if n is Decal or n is FogVolume or n is GPUParticles3D or n is CPUParticles3D or n is Label3D or n is SpriteBase3D:
			n.visible = false
			continue
		if not (n is GeometryInstance3D):
			continue
		var g: GeometryInstance3D = n
		if cls.has(g):
			var mats: Array = cls[g]
			if g is MeshInstance3D and g.name == "Body" and g.get_parent() != null and g.get_parent().name == "Model":
				g.material_override = null
				for i in g.mesh.get_surface_count():
					var kind: String = SURFACES[i] if i < SURFACES.size() else "other"
					g.set_surface_override_material(i, mats[0] if kind in ["plate", "band"] else (mats[1] if kind == "coat" else mats[2]))
			else:
				g.material_override = mats[2]
			g.transparency = 0.0
			continue
		if _transparent(g):
			g.visible = false
			continue
		g.material_override = black
`;

main().catch((e) => { console.error(e); process.exit(2); });
