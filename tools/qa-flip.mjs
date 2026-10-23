// The perceptual before/after check (QA-FLIP-1; docs/qa/w17/QA-FLIP.md, docs/design/TOOLS_RADAR.md §3.4): NVIDIA FLIP
// 1.7 (LDR-FLIP on sRGB PNG screenshots) per fixed view, so every AAA pass (SKY, WET, AIR, BACKDROP) shows one number
// per view for "before vs after" and "Godot vs twin", with the error map that says where the change sits.
//
//   node tools/qa-flip.mjs pair <ref.png> <test.png> [--out dir] [--mask m.png] [--max-mean x]
//        one view (named after the test file)
//   node tools/qa-flip.mjs dirs <refDir> <testDir> --out <dir> [--mask m.png | --mask-dir dir] [--max-mean x]
//        every *.png in the two folders, paired by FILE NAME. A view on one side only is an error (exit 2), never a skip
//   options: --flip <bin> (or $FLIP_BIN): the `flip` console script of the scratch venv (never a package.json
//            dependency; the hash-pinned install is in QA-FLIP.md) · --ppd n (pixels per degree; FLIP's default 67) ·
//            --mask <png>: the stats are read only where the mask is lit (any of R,G,B >= 128, and alpha >= 128 if it
//            has one: a white mask, or a 30 m matte as it is), e.g. sky only or ground only; the complement is reported
//            beside it, with the region's share of all the error · --mask-dir <dir>: one mask per view, by the same
//            file name · --no-magma: skip the second FLIP run that writes the magma map for eyes
//   --max-mean x: exit 1 when any view's mean (the masked region's, with a mask) is above x.
//
// Per view FLIP runs twice: once with --no-magma, whose grey map holds the per-pixel error linearly (value / 255; the
// tool checks its mean against FLIP's printed mean, to 0.5/255), and once for the magma map people look at. Without a
// mask, mean and max are FLIP's own printed numbers and p95 (nearest rank, unweighted, over pixels) is read from the
// grey map. With a mask, mean, p95 and max are the region's, read from the grey map, so they are quantised to 1/255.
// Writes <out>/maps/<view>.flip.png (magma) and <view>.flip-grey.png, <out>/results.json and <out>/verdict.txt.
// Exit 0 = every view measured (and at or under --max-mean), 1 = a view over --max-mean, 2 = could not measure.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { setPriority } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

/** Anything that stops a measurement (exit 2): a missing view, binary, file or mask, a FLIP failure, bad arguments. */
export class QaFlipError extends Error {}

// --------------------------------------------------------------------------------------------- PNG (read only)
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Decode a non-interlaced PNG (grey at 1-16 bits, grey+alpha, RGB, RGBA at 8 or 16, palette at 1-8) to 8 bits a channel.
 *  Returns { w, h, ch, d } with ch = 1 (grey), 2 (grey+alpha), 3 (RGB; a palette expands to it) or 4 (RGBA). */
export function decodePng(buf, name = 'PNG') {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new QaFlipError(`${name}: not a PNG`);
  let w = 0, h = 0, depth = 0, type = -1, interlace = 0, palette = null;
  const idat = [];
  for (let p = 8; p + 8 <= buf.length;) {
    const len = buf.readUInt32BE(p), kind = buf.toString('latin1', p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === 'PLTE') palette = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  const ch = CHANNELS[type];
  if (!w || !h || ch === undefined) throw new QaFlipError(`${name}: no usable IHDR`);
  if (interlace) throw new QaFlipError(`${name}: interlaced PNG is not supported`);
  const low = depth < 8 && (type === 0 || type === 3) && [1, 2, 4].includes(depth); // packed grey or palette samples
  if (!(low || depth === 8 || (depth === 16 && type !== 3))) throw new QaFlipError(`${name}: bit depth ${depth} (colour type ${type}) is not supported`);
  if (type === 3 && !palette) throw new QaFlipError(`${name}: palette PNG without PLTE`);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = low ? 1 : ch * (depth / 8), stride = low ? Math.ceil((w * depth) / 8) : w * bpp;
  const sample = (px) => (cur[(px * depth) >> 3] >> (8 - depth - ((px * depth) & 7))) & ((1 << depth) - 1);
  if (raw.length < h * (stride + 1)) throw new QaFlipError(`${name}: truncated image data`);
  const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  const outCh = type === 3 ? 3 : ch, d = new Uint8Array(w * h * outCh);
  for (let y = 0; y < h; y++) {
    const off = y * (stride + 1), f = raw[off];
    for (let i = 0; i < stride; i++) {
      const x = raw[off + 1 + i], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else throw new QaFlipError(`${name}: bad filter ${f} on row ${y}`);
      cur[i] = v & 255;
    }
    for (let px = 0; px < w; px++) {
      if (type === 3) { const k = (low ? sample(px) : cur[px]) * 3; d.set([palette[k] ?? 0, palette[k + 1] ?? 0, palette[k + 2] ?? 0], (y * w + px) * 3); continue; }
      if (low) { d[y * w + px] = Math.round((sample(px) * 255) / ((1 << depth) - 1)); continue; }
      for (let k = 0; k < ch; k++) d[(y * w + px) * ch + k] = cur[px * bpp + k * (depth / 8)]; // 16 bit: the high byte
    }
    prev.set(cur);
  }
  return { w, h, ch: outCh, d };
}
const readPng = (path) => decodePng(readFileSync(path), path);

// --------------------------------------------------------------------------------------------- the stats
/** The mask's region: 1 where any colour channel is >= 128 (white, or a 30 m matte's colour; black is out), and
 *  alpha >= 128 if the mask has alpha. */
export function maskRegion(img) {
  const { w, h, ch, d } = img, colour = ch >= 3 ? 3 : 1, alpha = ch === 2 || ch === 4;
  const m = new Uint8Array(w * h);
  for (let k = 0; k < m.length; k++) {
    let hi = 0;
    for (let c = 0; c < colour; c++) hi = Math.max(hi, d[k * ch + c]);
    m[k] = hi >= 128 && (!alpha || d[k * ch + ch - 1] >= 128) ? 1 : 0;
  }
  return m;
}
/** Histograms (256 bins) of a grey error map's first channel: all pixels, the region and its complement. */
function histograms(map, region) {
  const all = new Float64Array(256), inR = new Float64Array(256), outR = new Float64Array(256);
  for (let k = 0; k < map.w * map.h; k++) {
    const v = map.d[k * map.ch];
    all[v]++;
    if (region) (region[k] ? inR : outR)[v]++;
  }
  return { all, inR, outR };
}
/** mean, p95 (nearest rank) and max of a 256-bin histogram of value/255 errors; sum is the summed error. */
export function histStats(hist) {
  let n = 0, sum = 0, max = 0;
  for (let v = 0; v < 256; v++) if (hist[v]) { n += hist[v]; sum += v * hist[v]; max = v; }
  if (!n) return { pixels: 0, mean: 0, p95: 0, max: 0, sum: 0 };
  const rank = Math.ceil(0.95 * n);
  let c = 0, p95 = 0;
  for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= rank) { p95 = v; break; } }
  return { pixels: n, mean: sum / n / 255, p95: p95 / 255, max: max / 255, sum: sum / 255 };
}
/** The numbers of one view from its grey error map, FLIP's printed stats and an optional region mask. */
export function viewStats(map, flip, region) {
  const { all, inR, outR } = histograms(map, region);
  const full = histStats(all);
  if (Math.abs(full.mean - flip.mean) > 0.5 / 255 + 1e-6) {
    throw new QaFlipError(`the grey error map's mean ${full.mean.toFixed(6)} is not FLIP's mean ${flip.mean.toFixed(6)}: the map format changed`);
  }
  const out = { full: { ...full, mean: flip.mean, max: flip.max }, region: null, outside: null };
  if (region) {
    const r = histStats(inR), o = histStats(outR);
    if (!r.pixels) throw new QaFlipError('the mask selects no pixel');
    out.region = { ...r, share: full.sum > 0 ? r.sum / full.sum : null };
    out.outside = { ...o, share: full.sum > 0 ? o.sum / full.sum : null };
  }
  const head = out.region ?? out.full;
  return { ...out, mean: head.mean, p95: head.p95, max: head.max };
}

// --------------------------------------------------------------------------------------------- FLIP
/** FLIP 1.7's verbosity-2 report: Mean, Weighted median, quartiles, Min, Max, PPD and the error map's path. */
export function parseFlipOutput(text) {
  const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : undefined; };
  const r = {
    mean: num(/^\s*Mean:\s*([-+0-9.eE]+)\s*$/m),
    median: num(/^\s*Weighted median:\s*([-+0-9.eE]+)\s*$/m),
    q1: num(/^\s*1st weighted quartile:\s*([-+0-9.eE]+)\s*$/m),
    q3: num(/^\s*3rd weighted quartile:\s*([-+0-9.eE]+)\s*$/m),
    min: num(/^\s*Min:\s*([-+0-9.eE]+)\s*$/m),
    max: num(/^\s*Max:\s*([-+0-9.eE]+)\s*$/m),
    ppd: num(/^\s*Pixels per degree:\s*([-+0-9.eE]+)\s*$/m),
    seconds: num(/^\s*Evaluation time:\s*([-+0-9.eE]+) seconds\s*$/m),
    map: text.match(/^\s*FLIP error map location:\s*(.+?)\s*$/m)?.[1],
  };
  if (!Number.isFinite(r.mean) || !Number.isFinite(r.max) || !r.map) {
    throw new QaFlipError(`could not read FLIP's report (no Mean, Max or error map line):\n${text.trim().split('\n').slice(-12).join('\n')}`);
  }
  return r;
}
/** The FLIP binary: --flip, else $FLIP_BIN. A clear error when neither names an existing file. */
export function resolveFlip(flag, env = process.env) {
  const bin = flag ?? env.FLIP_BIN;
  if (!bin) throw new QaFlipError('no FLIP binary: pass --flip <venv>/bin/flip or set FLIP_BIN (install: docs/qa/w17/QA-FLIP.md)');
  if (!existsSync(bin)) throw new QaFlipError(`FLIP binary not found: ${bin} (install: docs/qa/w17/QA-FLIP.md)`);
  return resolve(bin);
}
function runFlip(bin, ref, test, dir, base, { grey, ppd }) {
  const args = ['-r', ref, '-t', test, '-d', dir, '-b', base, '-v', '2'];
  if (grey) args.push('-nm');
  if (ppd !== undefined) args.push('-ppd', String(ppd));
  const res = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (res.error) throw new QaFlipError(`could not run FLIP (${bin}): ${res.error.message}`);
  const text = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (res.status !== 0) throw new QaFlipError(`FLIP exit ${res.status} on ${ref} vs ${test}:\n${text.trim().split('\n').slice(-6).join('\n')}`);
  const r = parseFlipOutput(text), want = join(dir, `${base}.png`);
  if (resolve(r.map) !== want || !existsSync(want)) throw new QaFlipError(`FLIP reported its map at ${r.map}, expected ${want}`);
  return { ...r, map: want };
}
const isPng = (p) => /\.png$/i.test(p);
function needPng(p, what) {
  if (!existsSync(p) || !statSync(p).isFile()) throw new QaFlipError(`${what} not found: ${p}`);
  if (!isPng(p)) throw new QaFlipError(`${what} must be a PNG (FLIP reads png or exr; this tool runs LDR-FLIP on PNG only): ${p}`);
}

/** One view: FLIP's grey map for the numbers, then (unless magma is false) its magma map for eyes. */
export function measurePair({ flip, ref, test, out, view, mask, ppd, magma = true }) {
  needPng(ref, 'reference'); needPng(test, 'test');
  if (mask) needPng(mask, 'mask');
  const dir = resolve(out, 'maps');
  mkdirSync(dir, { recursive: true });
  const t0 = performance.now();
  const g = runFlip(flip, resolve(ref), resolve(test), dir, `${view}.flip-grey`, { grey: true, ppd });
  const map = readPng(g.map);
  let region = null;
  if (mask) {
    const m = readPng(mask);
    if (m.w !== map.w || m.h !== map.h) throw new QaFlipError(`mask ${mask} is ${m.w}x${m.h}, the view ${view} is ${map.w}x${map.h}`);
    region = maskRegion(m);
  }
  const s = viewStats(map, g, region);
  const magmaMap = magma ? runFlip(flip, resolve(ref), resolve(test), dir, `${view}.flip`, { grey: false, ppd }).map : null;
  return {
    view, ref: resolve(ref), test: resolve(test), mask: mask ? resolve(mask) : null, size: [map.w, map.h],
    mean: s.mean, p95: s.p95, max: s.max, map: magmaMap, greyMap: g.map,
    flip: { mean: g.mean, median: g.median, q1: g.q1, q3: g.q3, min: g.min, max: g.max, ppd: g.ppd, evalSeconds: g.seconds },
    full: s.full, region: s.region, outside: s.outside, seconds: (performance.now() - t0) / 1000,
  };
}

/** Pair two folders' PNGs by file name. A name on one side only, or no PNG at all, is an error. */
export function pairViews(refDir, testDir) {
  const list = (d) => {
    if (!existsSync(d) || !statSync(d).isDirectory()) throw new QaFlipError(`not a folder: ${d}`);
    return readdirSync(d).filter((f) => isPng(f) && statSync(join(d, f)).isFile()).sort();
  };
  const a = list(refDir), b = list(testDir), sa = new Set(a), sb = new Set(b);
  const onlyRef = a.filter((f) => !sb.has(f)), onlyTest = b.filter((f) => !sa.has(f));
  if (onlyRef.length || onlyTest.length) {
    throw new QaFlipError(`views missing on one side (pairing is by file name):${onlyRef.length ? ` only in ${refDir}: ${onlyRef.join(', ')};` : ''}${onlyTest.length ? ` only in ${testDir}: ${onlyTest.join(', ')}` : ''}`);
  }
  if (!a.length) throw new QaFlipError(`no PNG in ${refDir} or ${testDir}`);
  return a.map((f) => ({ view: f.replace(/\.png$/i, ''), ref: join(refDir, f), test: join(testDir, f) }));
}

const f4 = (v) => (v === null || v === undefined ? '-' : v.toFixed(4));
/** The one-line verdict and exit code: REPORT (no threshold), PASS, or FAIL (exit 1) naming each view over it. */
export function verdict(views, maxMean) {
  const where = views.some((v) => v.region) ? ' (masked region)' : '';
  const worst = views.reduce((w, v) => (!w || v.mean > w.mean ? v : w), null);
  const tail = `worst mean ${f4(worst.mean)} (${worst.view})${where}`;
  if (maxMean === undefined) return { line: `QA-FLIP REPORT: ${views.length} view(s); ${tail}`, exit: 0, failed: [] };
  const over = views.filter((v) => !(v.mean <= maxMean));
  if (over.length) {
    return { line: `QA-FLIP FAIL: ${over.length} of ${views.length} view(s) over --max-mean ${maxMean}${where}: ${over.map((v) => `${v.view} ${f4(v.mean)}`).join(', ')}`, exit: 1, failed: over.map((v) => v.view) };
  }
  return { line: `QA-FLIP PASS: ${views.length} view(s) at or under --max-mean ${maxMean}; ${tail}`, exit: 0, failed: [] };
}
function viewLine(v) {
  const r = v.region ? `  region ${v.region.pixels} px holds ${(100 * (v.region.share ?? 0)).toFixed(1)}% of the error (outside mean ${f4(v.outside.mean)})` : '';
  return `${v.view.padEnd(24)} mean ${f4(v.mean)}  p95 ${f4(v.p95)}  max ${f4(v.max)}${r}  map ${v.map ?? v.greyMap}  ${v.seconds.toFixed(2)} s`;
}

// --------------------------------------------------------------------------------------------- CLI
const VALUE_OPTS = new Set(['out', 'max-mean', 'mask', 'mask-dir', 'flip', 'ppd']);
const FLAG_OPTS = new Set(['no-magma']);
export function parseArgs(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (FLAG_OPTS.has(k)) { o[k] = true; continue; }
    if (!VALUE_OPTS.has(k)) throw new QaFlipError(`unknown option ${a}`);
    if (i + 1 >= argv.length) throw new QaFlipError(`${a} needs a value`);
    o[k] = argv[++i];
  }
  const cmd = pos.shift();
  if (cmd !== 'pair' && cmd !== 'dirs') throw new QaFlipError('usage: qa-flip.mjs pair <ref.png> <test.png> [--out dir] | dirs <refDir> <testDir> --out <dir> [--max-mean x] [--mask m.png | --mask-dir d] [--flip bin]');
  if (pos.length !== 2) throw new QaFlipError(`${cmd} takes two paths, got ${pos.length}`);
  if (cmd === 'dirs' && !o.out) throw new QaFlipError('dirs needs --out <dir>');
  if (o.mask && o['mask-dir']) throw new QaFlipError('--mask and --mask-dir are exclusive');
  if (cmd === 'pair' && o['mask-dir']) throw new QaFlipError('--mask-dir is for dirs; pair takes --mask');
  const num = (k, min) => {
    if (o[k] === undefined) return undefined;
    const v = Number(o[k]);
    if (!Number.isFinite(v) || v < min || (k === 'ppd' && v === 0)) throw new QaFlipError(`--${k} must be a number >= ${min}${k === 'ppd' ? ' and > 0' : ''}, got ${o[k]}`);
    return v;
  };
  return { cmd, a: pos[0], b: pos[1], out: o.out ?? 'artifacts/qa-flip', maxMean: num('max-mean', 0), ppd: num('ppd', 0), mask: o.mask, maskDir: o['mask-dir'], flip: o.flip, magma: !o['no-magma'] };
}

/** Run a command line; returns the exit code (0, 1 or 2) and prints the per-view lines and the verdict. */
export function main(argv, { env = process.env, log = console.log, err = console.error } = {}) {
  try {
    const a = parseArgs(argv);
    const flip = resolveFlip(a.flip, env);
    const out = resolve(a.out);
    const pairs = a.cmd === 'pair'
      ? [{ view: basename(a.b).replace(/\.png$/i, ''), ref: a.a, test: a.b }]
      : pairViews(resolve(a.a), resolve(a.b));
    const maskFor = (view) => (a.maskDir ? join(a.maskDir, `${view}.png`) : a.mask);
    if (a.maskDir) for (const p of pairs) if (!existsSync(maskFor(p.view))) throw new QaFlipError(`no mask for view ${p.view} in ${a.maskDir}`);
    const views = [];
    for (const p of pairs) {
      const v = measurePair({ flip, ref: p.ref, test: p.test, out, view: p.view, mask: maskFor(p.view), ppd: a.ppd, magma: a.magma });
      views.push(v);
      log(viewLine(v));
    }
    const vd = verdict(views, a.maxMean);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'results.json'), `${JSON.stringify({ tool: 'qa-flip', flip, command: a.cmd, ref: resolve(a.a), test: resolve(a.b), mask: a.mask ? resolve(a.mask) : a.maskDir ? resolve(a.maskDir) : null, maxMean: a.maxMean ?? null, ppd: a.ppd ?? null, verdict: vd.line, exit: vd.exit, failed: vd.failed, views }, null, 2)}\n`);
    writeFileSync(join(out, 'verdict.txt'), `${vd.line}\n`);
    log(vd.line);
    return vd.exit;
  } catch (e) {
    if (!(e instanceof QaFlipError)) throw e;
    err(`QA-FLIP ERROR: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { setPriority(10); } catch { /* not allowed: run at the current priority */ }
  process.exit(main(process.argv.slice(2)));
}
