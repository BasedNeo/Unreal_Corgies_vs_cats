// Cover metric on the web twin (W15 item 11, TW-LOOK): Godot's test_look_cover.gd measure, on labs/cover.html.
//   npx vite --port 5190            (another terminal)
//   node labs/cover-metric.mjs [outDir=artifacts/cover] [base=http://localhost:5190/]
//   env: ONLY=<piece substring> · DISTS=10,30,60 · Q=high|med|low (the world tier) · SHOTS=1 saves every frame ·
//        CONFIGS=fill:sheen[:sat:pool[:container:mast]],... sweeps the per-build gains (the last two: the Container20 and
//        FloodMast fill scales) in one pass (default: STYLE.cover and KIT_COVER_SCALE as built) ·
//        VIEWS=i:d,... only those (sample index, distance) views (a tuning loop; the bar needs them all) ·
//        REGATE=<results.json> re-applies the report and the bar to a saved run, without measuring · GATE=<config label>
//        bars that config instead of the first
// Per sample (place, piece, part, approach) and distance: the play camera placed as Godot does, then four frames: the
// normal frame with the cover read ON and OFF (the A/B; draw calls of each), the part's visible pixels (mask 'vis') and
// its whole outline (mask 'alone'). Read = mean |ΔL*| (CIE L* from the displayed sRGB) across the outline's exterior
// edge, 2 px inside the visible part against 2 px outside. Body = the mean L* (and its std, and the mean C*) of the
// part's visible pixels, every 2nd px [godot _body]. Bars [godot test_look_cover.gd]: every cover read >= 15; at each
// place and distance (10 and 30 m; reported at 60 m) the darkest cover piece's body L* >= the mast pole's + 10; the
// ceiling on every cover piece
// (Container20, Pipe, Footing, BagWall, the FloodMast's ballast) at 10 and 30 m [lead ruling, shared with Godot]: a dark
// view (read-off body L* < 35) stays <= 40 L* with the read on, a lit view (read-off >= 35: a flood pool) is lifted by
// <= 5 L*; in every view the read keeps >= 0.85 of the read-off body's L* std (no flattening); the draws with the read
// equal to those without it in every view (x1.000).
// Prints a table, writes results.json and, like Godot's rendered test_look_cover, EXITS 1 when the first measured config
// (the built values unless CONFIGS says otherwise) misses a bar ("COVER FAIL: ..."), 0 on "COVER PASS". A view with too
// few pixels is skipped, as Godot's is; a run where no cover view was measured fails.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const out = process.argv[2] ?? 'artifacts/cover';
const base = process.argv[3] ?? process.env.PROBE_URL ?? 'http://localhost:5190/';
const DISTS = (process.env.DISTS ?? '10,30,60').split(',').map(Number);
const ONLY = process.env.ONLY ?? '';
const VIEWS = process.env.VIEWS ? new Set(process.env.VIEWS.split(',')) : null;
const BAR_EDGE = 15, BAR_GAP = 10;
/** The ceiling [lead ruling]: every cover piece at <= CEILING_D m; dark views (read off < LIT) <= BODY_MAX with the read,
 *  lit views lifted by <= LIFT_MAX; every view keeps >= STD_KEEP of its read-off L* std. */
const BODY_MAX = 40, LIT = 35, LIFT_MAX = 5, STD_KEEP = 0.85, CEILING_D = 30;
/**
 * Calibrated std floors (lead ruling 2026-10-12: the measured best ratio, holding every other bar, minus 0.05), per
 * sample; every other view keeps STD_KEEP. The pipe: its read-off std is shading across the cylinder, not texture, which
 * any fill compresses in L*. The corgi-rim bag wall (lit, its fill pooled away): the sheen flattens it, and the sheen
 * the pipe's edge needs (>= 15 at 60 m) is more than it keeps 0.85 under (docs/qa/w15/COVER.md, Web).
 */
const STD_FLOOR = { 'east lane Pipe[0]': 0.6, 'corgi base BagWall[3]': 0.59 };
const stdFloor = (r) => STD_FLOOR[`${r.place} ${r.piece}[${r.idx}]`] ?? STD_KEEP;
const REGATE = process.env.REGATE ?? '';
/** The cover values to measure; `null` = as built (STYLE.cover). Each config is labelled fill:sheen. */
const CONFIGS = process.env.CONFIGS ? process.env.CONFIGS.split(',').map((c) => {
  const [fill, sheen, sat, pool, cont, mast] = c.split(':').map(Number);
  const scale = Number.isFinite(cont) ? { Kit_Lot_Container20_01: cont, ...(Number.isFinite(mast) ? { Kit_Lot_FloodMast_01: mast } : {}) } : undefined;
  return { fill, sheen, ...(Number.isFinite(sat) ? { sat } : {}), ...(Number.isFinite(pool) ? { pool } : {}), ...(scale ? { scale } : {}) };
}) : [null];
const label = (c) => (c ? [c.fill, c.sheen, ...(c.sat !== undefined ? [c.sat] : []), ...(c.pool !== undefined ? [c.pool] : []),
  ...(c.scale ? Object.values(c.scale) : [])].join(':') : 'built');
mkdirSync(out, { recursive: true });

const LIN = Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
/** CIE C*ab (chroma) of an sRGB pixel: how coloured it reads (a bleached piece goes pale and grey: high L*, low C*). */
const chroma = (d, i) => {
  const r = LIN[d[i]], g = LIN[d[i + 1]], b = LIN[d[i + 2]];
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const a = 500 * (f(X) - f(Y)), bb = 200 * (f(Y) - f(Z));
  return Math.hypot(a, bb);
};
const lstar = (d, i) => {
  const y = 0.2126 * LIN[d[i]] + 0.7152 * LIN[d[i + 1]] + 0.0722 * LIN[d[i + 2]];
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
};

async function rgb(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, w: info.width, h: info.height };
}

/** The part's pixels in a mask frame (part A red, part B green), seams of 1-2 px closed [godot _mask]. */
function mask(m, r, partB) {
  const { d, w, h } = m;
  const inm = new Uint8Array(w * h);
  for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) {
    const i = (y * w + x) * 3, R = d[i], G = d[i + 1], B = d[i + 2];
    if (!partB && R - Math.max(G, B) > 40) inm[y * w + x] = 1;
    if (partB && G - Math.max(R, B) > 40) inm[y * w + x] = 1;
  }
  const closed = inm.slice();
  for (let y = r[1] + 2; y < r[3] - 2; y++) for (let x = r[0] + 2; x < r[2] - 2; x++) {
    const k = y * w + x;
    if (inm[k]) continue;
    if (((inm[k - 1] || inm[k - 2]) && (inm[k + 1] || inm[k + 2])) || ((inm[k - w] || inm[k - 2 * w]) && (inm[k + w] || inm[k + 2 * w]))) closed[k] = 1;
  }
  return closed;
}

/**
 * Silhouette read [godot _edge_read]: visible part pixels next to the exterior; L* 2 px in vs 2 px out. Plus the body
 * [godot _body]: mean and std of L* and mean C* over the visible pixels, every 2nd px from the rect's corner.
 */
function edgeRead(img, vis, full, r) {
  const { d, w } = img;
  let px = 0;
  for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) if (vis[y * w + x]) px++;
  let n2 = 0, lsum = 0, l2sum = 0, white = 0, csum = 0;
  for (let y = r[1]; y < r[3]; y += 2) for (let x = r[0]; x < r[2]; x += 2) {
    if (!vis[y * w + x]) continue;
    n2++;
    const L = lstar(d, (y * w + x) * 3);
    lsum += L; l2sum += L * L; if (L > 80) white++;
    csum += chroma(d, (y * w + x) * 3);
  }
  const body = n2 ? lsum / n2 : 0, bodyStd = n2 ? Math.sqrt(Math.max(0, l2sum / n2 - body * body)) : 0;
  const bleached = n2 ? white / n2 : 0, chr = n2 ? csum / n2 : 0;
  const ext = new Uint8Array(full.length);
  const stack = [];
  for (let x = r[0]; x < r[2]; x++) stack.push(r[1] * w + x, (r[3] - 1) * w + x);
  for (let y = r[1]; y < r[3]; y++) stack.push(y * w + r[0], y * w + r[2] - 1);
  while (stack.length) {
    const k = stack.pop(), kx = k % w, ky = (k - kx) / w;
    if (kx < r[0] || kx >= r[2] || ky < r[1] || ky >= r[3] || ext[k] || full[k]) continue;
    ext[k] = 1;
    stack.push(k + 1, k - 1, k + w, k - w);
  }
  const vals = [];
  let si = 0, so = 0;
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = r[1] + 3; y < r[3] - 3; y++) for (let x = r[0] + 3; x < r[2] - 3; x++) {
    if (!vis[y * w + x]) continue;
    for (const [sx, sy] of steps) {
      const qx = x + sx, qy = y + sy;
      if (!ext[qy * w + qx]) continue;
      let ix = x - 2 * sx, iy = y - 2 * sy;
      if (!vis[iy * w + ix]) { ix = x; iy = y; }
      let ox = qx + 2 * sx, oy = qy + 2 * sy;
      if (!ext[oy * w + ox]) { ox = qx; oy = qy; }
      const li = lstar(d, (iy * w + ix) * 3), lo = lstar(d, (oy * w + ox) * 3);
      vals.push(Math.abs(li - lo)); si += li; so += lo;
    }
  }
  const n = vals.length;
  if (!n) return { edge: 0, median: 0, inner: 0, outer: 0, px, pairs: 0, body, bodyStd, bleached, chroma: chr };
  vals.sort((a, b) => a - b);
  return { edge: vals.reduce((a, b) => a + b, 0) / n, median: vals[n >> 1], inner: si / n, outer: so / n, px, pairs: n, body, bodyStd, bleached, chroma: chr };
}

let rows = [], LABELS = CONFIGS.map(label), browser = null;
if (REGATE) {
  const saved = JSON.parse(readFileSync(REGATE, 'utf8'));
  rows = saved.rows; LABELS = saved.configs;
  console.log(`COVER regate ${REGATE}: ${rows.length} views, configs ${LABELS.join(' ')}`);
} else {
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.stack ?? e}`.slice(0, 600)));
page.on('console', (m) => { if (m.type() === 'error') console.log(`[console.error] ${m.text()}`.slice(0, 300)); });
await page.goto(`${base}labs/cover.html?webgl&kit=glb&q=${process.env.Q ?? 'high'}`);
await page.waitForFunction(() => globalThis.__cover?.ready || globalThis.__cover?.error, null, { timeout: 900000, polling: 1000 });
const err = await page.evaluate(() => globalThis.__cover.error);
if (err) { console.log('lab error', err); process.exit(1); }
const samples = await page.evaluate(() => globalThis.__cover.samples);

const settle = async () => { const f = await page.evaluate(() => globalThis.__cover.frames); await page.waitForFunction((n) => globalThis.__cover.frames >= n, f + 2, { timeout: 600000, polling: 200 }); };
const shot = async () => page.screenshot({ timeout: 600000 });

const t0 = Date.now();
for (let i = 0; i < samples.length; i++) {
  const [place, piece, idx, part] = samples[i];
  if (ONLY && !piece.includes(ONLY)) continue;
  for (const d of DISTS) {
    if (VIEWS && !VIEWS.has(`${i}:${d}`)) continue;
    const short = piece.replace('Kit_Lot_', '').replace('_01', '');
    const tag = `${place} ${short}[${idx}] ${part} d=${d}`;
    const v = await page.evaluate(([a, b]) => globalThis.__cover.view(a, b), [i, d]);
    if (!v) { console.log(`COVER ${tag.padEnd(44)} no clear view (skipped)`); continue; }
    const frames = {};
    const draws = {};
    for (const c of [...CONFIGS, 'off']) {
      const k = c === 'off' ? 'off' : `on_${label(c)}`;
      await page.evaluate(([o, v]) => { globalThis.__cover.cover(o); globalThis.__cover.values(v ?? {}); globalThis.__cover.mode('normal'); }, [c !== 'off', c === 'off' ? null : c]);
      await settle();
      frames[k] = await shot();
      draws[k] = await page.evaluate(() => globalThis.__cover.drawCalls);
    }
    await page.evaluate(() => { globalThis.__cover.cover(true); globalThis.__cover.mode('vis'); });
    await settle();
    frames.vis = await shot();
    await page.evaluate(() => globalThis.__cover.mode('alone'));
    await settle();
    frames.alone = await shot();
    await page.evaluate(() => globalThis.__cover.mode('normal'));
    const stem = `${place.replace(/ /g, '-')}_${short}_${idx}_${part}_${d}m`;
    if (process.env.SHOTS === '1' || d === 30) for (const [k, b] of Object.entries(frames)) writeFileSync(`${out}/${stem}_${k}.png`, b);
    const [vis, alone, off] = await Promise.all([rgb(frames.vis), rgb(frames.alone), rgb(frames.off)]);
    const full = mask(alone, v.rect, part === 'pole');
    const seen = mask(vis, v.rect, part === 'pole');
    for (let k = 0; k < seen.length; k++) seen[k] &= full[k];
    const before = edgeRead(off, seen, full, v.rect);
    const after = {};
    for (const c of CONFIGS) after[label(c)] = edgeRead(await rgb(frames[`on_${label(c)}`]), seen, full, v.rect);
    const ok = before.px >= 20 && before.pairs >= 10;
    rows.push({ place, piece: short, idx, part, d, turn: v.turn, ok, before, after, draws });
    writeFileSync(`${out}/results.partial.json`, JSON.stringify({ configs: LABELS, rows }, null, 1));   // a run that dies keeps its views
    console.log(`COVER ${tag.padEnd(44)} ${ok ? '' : 'TOO FEW PX '}before ${before.edge.toFixed(1).padStart(5)} (body L* ${before.body.toFixed(1)} C* ${before.chroma.toFixed(1)})  ${before.px} px ${before.pairs} pairs  turn ${v.turn}  draws off ${draws.off}  [${((Date.now() - t0) / 60000).toFixed(1)} min]`);
    for (const c of CONFIGS) {
      const a = after[label(c)];
      console.log(`      after ${label(c).padEnd(14)} edge ${a.edge.toFixed(1).padStart(5)}  inner L* ${a.inner.toFixed(1)}  outer ${a.outer.toFixed(1)}  body L* ${a.body.toFixed(1)} std ${a.bodyStd.toFixed(1)} C* ${a.chroma.toFixed(1)}  near-white ${(a.bleached * 100).toFixed(0)}%  draws ${draws[`on_${label(c)}`]}`);
    }
  }
}
}
// per config: the worst cover read, the value gap (darkest cover vs the mast pole, body L* [godot]), bleaching, draws
const cover = rows.filter((r) => r.part === 'cover' && r.ok);
const gapOf = (pick) => {
  const out = [];
  for (const key of [...new Set(rows.map((r) => `${r.place}|${r.d}`))]) {
    const at = rows.filter((r) => `${r.place}|${r.d}` === key && r.ok);
    const cv = at.filter((r) => r.part === 'cover'), pl = at.filter((r) => r.part === 'pole');
    if (!cv.length || !pl.length) continue;
    const worst = Math.min(...cv.map((r) => pick(r).body)), pole = Math.max(...pl.map((r) => pick(r).body));
    out.push({ key, worst, pole, gap: worst - pole });
  }
  return out;
};
const summary = {};
const report = (name, pick, drawKey) => {
  const reads = cover.map((r) => pick(r).edge), worst = Math.min(...reads);
  const gaps = gapOf(pick);
  const draws = rows.reduce((a, r) => a + r.draws[drawKey], 0);
  const body = Math.max(...cover.map((r) => pick(r).body)), white = Math.max(...cover.map((r) => pick(r).bleached));
  const poles = rows.filter((r) => r.part === 'pole' && r.ok).map((r) => pick(r).edge);
  summary[name] = { worst, under: reads.filter((x) => x < BAR_EDGE).length, of: reads.length, gapMin: gaps.length ? Math.min(...gaps.map((g) => g.gap)) : null, gaps, draws, bodyMax: body, whiteMax: white, poleEdge: poles };
  console.log(`COVER ${name.padEnd(16)} worst read ${worst.toFixed(1)} (${summary[name].under} of ${reads.length} under ${BAR_EDGE})  value gap min ${summary[name].gapMin?.toFixed(1) ?? 'n/a (no pole view)'}  `
    + `brightest cover body L* ${body.toFixed(1)}  most near-white ${(white * 100).toFixed(0)}%  pole reads ${poles.map((x) => x.toFixed(1)).join(' ') || 'n/a'}  draws ${draws}`);
  for (const g of gaps) console.log(`      value ${g.key.padEnd(16)} darkest cover body L* ${g.worst.toFixed(1)}  mast pole body L* ${g.pole.toFixed(1)}  gap ${g.gap.toFixed(1)}`);
};
report('before (off)', (r) => r.before, 'off');
for (const l of LABELS) report(`after ${l}`, (r) => r.after[l], `on_${l}`);
if (!REGATE) {
  writeFileSync(`${out}/results.json`, JSON.stringify({ configs: LABELS, rows, summary }, null, 1));
  await browser.close();
}
// the bar, on the first config measured (the built values by default)
const G = process.env.GATE ?? LABELS[0], gate = summary[`after ${G}`];
if (!gate) { console.log(`COVER FAIL: no config ${G} (have ${LABELS.join(' ')})`); process.exit(1); }
const tagOf = (r) => `${r.place} ${r.piece}[${r.idx}] ${r.part} d=${r.d}`;
const fails = [];
if (!gate.of) fails.push('no cover view was measured');
for (const r of cover) { const a = r.after[G]; if (a.edge < BAR_EDGE) fails.push(`${tagOf(r)}: edge dL* ${a.edge.toFixed(1)} < ${BAR_EDGE}`); }
for (const g of gate.gaps) if (g.gap < BAR_GAP && Number(g.key.split('|')[1]) <= CEILING_D) fails.push(`${g.key}: darkest cover body L* ${g.worst.toFixed(1)} vs mast pole body L* ${g.pole.toFixed(1)}, gap ${g.gap.toFixed(1)} < ${BAR_GAP}`);
console.log(`COVER ceiling (${G}; <= ${CEILING_D} m: dark view = read-off body < ${LIT}: on <= ${BODY_MAX}; lit view: lift <= ${LIFT_MAX}) and std (every view: on >= ${STD_KEEP} x off; calibrated: ${Object.entries(STD_FLOOR).map(([k, v]) => `${k} ${v}`).join(', ')})`);
for (const r of rows.filter((x) => x.ok)) {
  const a = r.after[G], b = r.before, ratio = b.bodyStd > 0 ? a.bodyStd / b.bodyStd : 1;
  const ceil = r.part === 'cover' && r.d <= CEILING_D;
  const lit = b.body >= LIT, over = ceil && (lit ? a.body - b.body > LIFT_MAX : a.body > BODY_MAX), flat = a.bodyStd < stdFloor(r) * b.bodyStd;
  console.log(`      ${tagOf(r).padEnd(40)} off ${b.body.toFixed(1).padStart(4)} std ${b.bodyStd.toFixed(1).padStart(4)} C* ${b.chroma.toFixed(1).padStart(4)}  on ${a.body.toFixed(1).padStart(4)} std ${a.bodyStd.toFixed(1).padStart(4)} C* ${a.chroma.toFixed(1).padStart(4)}  `
    + `${ceil ? (lit ? `lit, lift ${(a.body - b.body).toFixed(1)}` : 'dark') : '-'}  std x${ratio.toFixed(2)}${over ? '  OVER' : ''}${flat ? '  FLAT' : ''}`);
  if (over && lit) fails.push(`lift (lit view, read off ${b.body.toFixed(1)} >= ${LIT}): ${tagOf(r)}: body L* ${b.body.toFixed(1)} -> ${a.body.toFixed(1)}, +${(a.body - b.body).toFixed(1)} > ${LIFT_MAX}`);
  if (over && !lit) fails.push(`ceiling (dark view, read off ${b.body.toFixed(1)} < ${LIT}): ${tagOf(r)}: body L* ${a.body.toFixed(1)} > ${BODY_MAX}`);
  if (flat) fails.push(`flattened: ${tagOf(r)}: L* std ${b.bodyStd.toFixed(2)} -> ${a.bodyStd.toFixed(2)} < ${stdFloor(r)} x read off`);
}
for (const r of rows) if (r.draws[`on_${G}`] !== r.draws.off) fails.push(`draws: ${tagOf(r)}: ${r.draws.off} -> ${r.draws[`on_${G}`]} (not x1.000)`);
if (fails.length) { console.log(`COVER FAIL (${G}):\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`COVER PASS (${G}): every cover read >= ${BAR_EDGE}, every value gap at <= ${CEILING_D} m >= ${BAR_GAP}, the ceiling (dark <= ${BODY_MAX}, lit lift <= ${LIFT_MAX}) at <= ${CEILING_D} m, no view flattened, draws x1.000`);
