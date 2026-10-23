// QA-FLIP-1: the wrapper around NVIDIA FLIP 1.7 (tools/qa-flip.mjs; docs/qa/w17/QA-FLIP.md). CI has no FLIP venv, so
// these tests drive the wrapper with a FAKE `flip`: a small node script written into the test's temp dir that prints
// FLIP 1.7's real verbosity-2 report (the format copied verbatim from a real run) and writes its error map as FLIP does
// (-d dir, -b basename; -nm = grey, the error linear as value/255). Its error is |ref - test| of the grey inputs, so
// every number below is known exactly. Each behaviour has a mutant that fails here: pairing by index instead of file
// name, a missing view skipped, --max-mean not applied, the mask ignored (QA-FLIP.md lists them with their results).
// The last block runs the REAL binary, only when FLIP_BIN is set (local).
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodePng, histStats, main, maskRegion, pairViews, parseFlipOutput, verdict } from '../../tools/qa-flip.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

// --------------------------------------------------------------------------------------------- tiny PNG writer
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b: Buffer): number { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(kind: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const kb = Buffer.concat([Buffer.from(kind, 'latin1'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(kb));
  return Buffer.concat([len, kb, crc]);
}
/** An 8-bit grey PNG (filter 0) of w x h values. */
function greyPng(w: number, h: number, v: (x: number, y: number) => number): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = v(x, y);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// --------------------------------------------------------------------------------------------- the fake FLIP
// Reads the grey filter-0 PNGs written above; prints FLIP 1.7's report; writes the map as RGB (grey with -nm, a stand-in
// colour map without). Logs each call to $FAKE_FLIP_LOG. $FAKE_FLIP_SKEW adds to the printed mean (a format change).
const FAKE = String.raw`#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
const a = process.argv.slice(2), opt = (k) => { const i = a.indexOf(k); return i < 0 ? undefined : a[i + 1]; };
const ref = opt('-r'), test = opt('-t'), dir = opt('-d') ?? '.', base = opt('-b'), grey = a.includes('-nm'), ppd = opt('-ppd') ?? '67';
if (process.env.FAKE_FLIP_LOG) appendFileSync(process.env.FAKE_FLIP_LOG, JSON.stringify({ ref, test, grey }) + '\n');
for (const [what, p] of [['reference', ref], ['test', test]]) if (!existsSync(p)) { console.log('Error: ' + what + ' file <' + p + '> does not exist. Exiting.'); process.exit(1); }
function read(p) {
  const b = readFileSync(p); let w = 0, h = 0; const id = [];
  for (let q = 8; q < b.length;) { const n = b.readUInt32BE(q), k = b.toString('latin1', q + 4, q + 8);
    if (k === 'IHDR') { w = b.readUInt32BE(q + 8); h = b.readUInt32BE(q + 12); } if (k === 'IDAT') id.push(b.subarray(q + 8, q + 8 + n)); q += 12 + n; }
  const raw = inflateSync(Buffer.concat(id)), d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = raw[y * (w + 1) + 1 + x];
  return { w, h, d };
}
const R = read(ref), T = read(test);
console.log('Invoking LDR-FLIP\n     Pixels per degree: ' + ppd + '\n');
if (R.w !== T.w || R.h !== T.h) { console.log('Error: reference <' + R.w + 'x' + R.h + '> and test <' + T.w + 'x' + T.h + '> images must be of equal dimensions. Exiting.'); process.exit(1); }
const n = R.w * R.h, e = new Uint8Array(n); let s = 0, mx = 0, mn = 255;
for (let k = 0; k < n; k++) { e[k] = Math.abs(R.d[k] - T.d[k]); s += e[k]; mx = Math.max(mx, e[k]); mn = Math.min(mn, e[k]); }
const T32 = new Int32Array(256).map((_, c) => { for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = T32[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const ch = (k, body) => { const l = Buffer.alloc(4); l.writeUInt32BE(body.length); const kb = Buffer.concat([Buffer.from(k, 'latin1'), body]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(kb)); return Buffer.concat([l, kb, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(R.w, 0); ih.writeUInt32BE(R.h, 4); ih[8] = 8; ih[9] = 2;
const raw = Buffer.alloc(R.h * (R.w * 3 + 1));
for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) { const v = e[y * R.w + x], o = y * (R.w * 3 + 1) + 1 + x * 3; raw[o] = v; raw[o + 1] = grey ? v : 0; raw[o + 2] = grey ? v : 255 - v; }
if (!existsSync(dir)) { console.log('Creating new directory(s): <' + dir + '>.'); mkdirSync(dir, { recursive: true }); }
const map = join(dir, (base ?? 'flip') + '.png');
writeFileSync(map, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', deflateSync(raw)), ch('IEND', Buffer.alloc(0))]));
const f = (v) => v.toFixed(6), mean = s / n / 255 + Number(process.env.FAKE_FLIP_SKEW ?? 0);
console.log('FLIP between reference image <' + ref + '> and test image <' + join(dirname(test), (base ?? basename(test, '.png')) + '.png') + '>');
console.log('     Mean: ' + f(mean));
console.log('     Weighted median: ' + f(mx / 255));
console.log('     1st weighted quartile: ' + f(mx / 255));
console.log('     3rd weighted quartile: ' + f(mx / 255));
console.log('     Min: ' + f(mn / 255));
console.log('     Max: ' + f(mx / 255));
console.log('     Evaluation time: 0.0100 seconds');
console.log('     FLIP error map location: ' + map + '\n');
console.log('Total time: 0.0200 seconds');
`;

// The real report (FLIP 1.7, flip-evaluator wheel, 2026-10-23): a 40x40 magenta block painted on aaa30m-face-1x.
const REAL_REPORT = `Invoking LDR-FLIP
     Pixels per degree: 67

FLIP between reference image <../aaa30m-face-1x.png> and test image <../gray.png>
     Mean: 0.005331
     Weighted median: 0.976662
     1st weighted quartile: 0.974456
     3rd weighted quartile: 0.981240
     Min: 0.000000
     Max: 0.985037
     Evaluation time: 0.3893 seconds
     FLIP error map location: ./gray.png

Total time: 0.5368 seconds
`;

let tmp = '';
let fake = '';
let flipLog = '';
const W = 16, H = 8;
/** Write <dir>/<name>.png as grey w x h. */
function put(dir: string, name: string, v: (x: number, y: number) => number, w = W, h = H): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${name}.png`);
  writeFileSync(p, greyPng(w, h, v));
  return p;
}
/** Run the CLI in-process against the fake binary; returns exit code, stdout/stderr lines and the parsed results.json. */
function run(args: string[], env: Record<string, string | undefined> = {}) {
  const out: string[] = [], err: string[] = [];
  const code = main(args, { env: { FLIP_BIN: fake, ...env }, log: (s: string) => out.push(s), err: (s: string) => err.push(s) });
  const oi = args.indexOf('--out');
  const rj = oi >= 0 ? join(args[oi + 1], 'results.json') : '';
  const results = rj && existsSync(rj) ? JSON.parse(readFileSync(rj, 'utf8')) : null;
  return { code, out: out.join('\n'), err: err.join('\n'), results };
}
function calls(): { ref: string; test: string; grey: boolean }[] {
  return existsSync(flipLog) ? readFileSync(flipLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'qa-flip-'));
  fake = join(tmp, 'fake-flip.mjs');
  writeFileSync(fake, FAKE);
  chmodSync(fake, 0o755);
  flipLog = join(tmp, 'calls.jsonl');
  process.env.FAKE_FLIP_LOG = flipLog;
});
afterAll(() => {
  delete process.env.FAKE_FLIP_LOG;
  rmSync(tmp, { recursive: true, force: true });
});

describe('FLIP report and PNG reading', () => {
  it('reads FLIP 1.7\'s real report', () => {
    const r = parseFlipOutput(REAL_REPORT);
    expect(r).toMatchObject({ mean: 0.005331, median: 0.976662, q1: 0.974456, q3: 0.98124, min: 0, max: 0.985037, ppd: 67, seconds: 0.3893, map: './gray.png' });
  });
  it('refuses a report without Mean, Max or the map line', () => {
    expect(() => parseFlipOutput(REAL_REPORT.replace(/^\s*Mean:.*$/m, ''))).toThrow(/could not read FLIP/);
    expect(() => parseFlipOutput(REAL_REPORT.replace(/^.*error map location.*$/m, ''))).toThrow(/could not read FLIP/);
  });
  it('decodes PNGs written by another encoder (sharp: every filter, grey, grey+alpha, RGB, RGBA, palette, 16 bit)', async () => {
    const w = 37, h = 11;
    const px = (x: number, y: number, c: number) => (x * 7 + y * 31 + c * 89 + ((x * y) % 13) * 5) & 255;
    for (const channels of [1, 2, 3, 4] as const) {
      const raw = Buffer.alloc(w * h * channels);
      for (let k = 0; k < w * h; k++) for (let c = 0; c < channels; c++) raw[k * channels + c] = px(k % w, (k / w) | 0, c);
      for (const adaptiveFiltering of [false, true]) {
        const src = sharp(raw, { raw: { width: w, height: h, channels } });
        const png = await (channels <= 2 ? src.toColourspace('b-w') : src).png({ adaptiveFiltering, compressionLevel: 9 }).toBuffer();
        const img = decodePng(png);
        expect([img.w, img.h, img.ch]).toEqual([w, h, channels]);
        expect(Buffer.from(img.d).equals(raw)).toBe(true);
      }
    }
    // 16 bit: the high byte
    const raw16 = Buffer.alloc(w * h * 3);
    for (let k = 0; k < raw16.length; k++) raw16[k] = (k * 5) & 255;
    const p16 = await sharp(raw16, { raw: { width: w, height: h, channels: 3 } }).toColourspace('rgb16').png().toBuffer();
    expect(Buffer.from(decodePng(p16).d).equals(raw16)).toBe(true);
    // palette: expands to RGB
    const flat = Buffer.alloc(w * h * 3);
    for (let k = 0; k < w * h; k++) flat.set(k % 3 === 0 ? [200, 10, 30] : [0, 90, 255], k * 3);
    const pal = await sharp(flat, { raw: { width: w, height: h, channels: 3 } }).png({ palette: true, colours: 4, dither: 0 }).toBuffer();
    const pi = decodePng(pal);
    expect(pi.ch).toBe(3);
    expect(Buffer.from(pi.d).equals(flat)).toBe(true);
    // a 1-bit grey mask (as image editors save them), 10 px wide: packed samples, rows padded to a byte
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(10, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 1; ihdr[9] = 0;
    const bits = Buffer.from([0, 0b10110000, 0b01000000, 0, 0b00000001, 0b11000000]); // filter 0 + 2 bytes, per row
    const one = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(bits)), chunk('IEND', Buffer.alloc(0))]);
    expect(Array.from(decodePng(one).d)).toEqual([255, 0, 255, 255, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255]);
    expect(() => decodePng(Buffer.from('not a png at all'))).toThrow(/not a PNG/);
  });
  it('reads a mask: in where any colour channel is >= 128 (white, or a matte colour), and alpha >= 128 when present', () => {
    const m = maskRegion({ w: 5, h: 1, ch: 4, d: Uint8Array.from([255, 255, 255, 255, 127, 127, 127, 255, 255, 255, 255, 127, 0, 0, 0, 255, 255, 0, 0, 255]) });
    expect(Array.from(m)).toEqual([1, 0, 0, 0, 1]);
    expect(Array.from(maskRegion({ w: 3, h: 1, ch: 1, d: Uint8Array.from([128, 127, 255]) }))).toEqual([1, 0, 1]);
  });
  it('p95 is the nearest rank over pixels; mean and max are the histogram\'s', () => {
    const hist = new Float64Array(256);
    hist[0] = 94; hist[51] = 5; hist[255] = 1; // 100 px: rank 95 is the first 51
    expect(histStats(hist)).toMatchObject({ pixels: 100, p95: 51 / 255, max: 1, mean: (5 * 51 + 255) / 100 / 255 });
    hist[51] = 0; hist[0] = 99; // rank 95 falls in the zeros
    expect(histStats(hist).p95).toBe(0);
  });
});

describe('qa-flip with a fake FLIP (CI)', () => {
  it('identical images give 0.000 everywhere, with both maps written', () => {
    const d = join(tmp, 'ident');
    const a = put(d, 'a', (x, y) => (x * 13 + y * 7) & 255);
    const r = run(['pair', a, a, '--out', join(d, 'out'), '--max-mean', '0']);
    expect(r.code).toBe(0);
    expect(r.results.views[0]).toMatchObject({ view: 'a', mean: 0, p95: 0, max: 0 });
    expect(existsSync(r.results.views[0].map)).toBe(true);
    expect(existsSync(r.results.views[0].greyMap)).toBe(true);
    expect(r.out).toMatch(/^QA-FLIP PASS: 1 view\(s\)/m);
    expect(readFileSync(join(d, 'out', 'verdict.txt'), 'utf8')).toMatch(/^QA-FLIP PASS/);
  });

  it('pairs by FILE NAME: each view is measured against its namesake', () => {
    const d = join(tmp, 'byname');
    // ref: alpha 0, beta 0, gamma 0. test: alpha 51, beta 102, gamma 0. So the means are 0.2, 0.4 and 0 by name.
    for (const n of ['alpha', 'beta', 'gamma']) put(join(d, 'ref'), n, () => 0);
    put(join(d, 'test'), 'alpha', () => 51);
    put(join(d, 'test'), 'beta', () => 102);
    put(join(d, 'test'), 'gamma', () => 0);
    writeFileSync(flipLog, '');
    const r = run(['dirs', join(d, 'ref'), join(d, 'test'), '--out', join(d, 'out')]);
    expect(r.code).toBe(0);
    const by = Object.fromEntries(r.results.views.map((v: { view: string; mean: number }) => [v.view, v.mean]));
    expect(by).toEqual({ alpha: 0.2, beta: 0.4, gamma: 0 });
    for (const c of calls()) expect(c.ref.split('/').pop()).toBe(c.test.split('/').pop());
    expect(r.out).toMatch(/QA-FLIP REPORT: 3 view\(s\); worst mean 0\.4000 \(beta\)/);
  });

  it('a different name on each side (same count) is an error, not an index pair', () => {
    const d = join(tmp, 'renamed');
    put(join(d, 'ref'), 'hero', () => 0); put(join(d, 'ref'), 'slab', () => 0);
    put(join(d, 'test'), 'hero', () => 0); put(join(d, 'test'), 'spawn', () => 0);
    const r = run(['dirs', join(d, 'ref'), join(d, 'test'), '--out', join(d, 'out')]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/only in .*ref: slab\.png/);
    expect(r.err).toMatch(/only in .*test: spawn\.png/);
    expect(() => pairViews(join(d, 'ref'), join(d, 'test'))).toThrow(/missing on one side/);
  });

  it('a view missing on one side is an error (exit 2, nothing measured), never a skip', () => {
    const d = join(tmp, 'missing');
    put(join(d, 'ref'), 'hero', () => 0); put(join(d, 'ref'), 'slab10', () => 0);
    put(join(d, 'test'), 'hero', () => 9);
    writeFileSync(flipLog, '');
    const r = run(['dirs', join(d, 'ref'), join(d, 'test'), '--out', join(d, 'out')]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/QA-FLIP ERROR: views missing on one side.*slab10\.png/);
    expect(r.results).toBeNull();
    expect(calls()).toHaveLength(0);
    const e = run(['dirs', join(d, 'test'), join(d, 'ref'), '--out', join(d, 'out2')]);
    expect(e.code).toBe(2);
    expect(e.err).toMatch(/slab10\.png/);
  });

  it('--max-mean fails (exit 1) exactly the views above it, and a view equal to it passes', () => {
    const d = join(tmp, 'thresh');
    put(join(d, 'ref'), 'calm', () => 0); put(join(d, 'ref'), 'loud', () => 0);
    put(join(d, 'test'), 'calm', () => 51); put(join(d, 'test'), 'loud', () => 153); // 0.2 and 0.6
    const fail = run(['dirs', join(d, 'ref'), join(d, 'test'), '--out', join(d, 'o1'), '--max-mean', '0.5']);
    expect(fail.code).toBe(1);
    expect(fail.results.failed).toEqual(['loud']);
    expect(fail.results.exit).toBe(1);
    expect(fail.out).toMatch(/^QA-FLIP FAIL: 1 of 2 view\(s\) over --max-mean 0\.5: loud 0\.6000$/m);
    const edge = run(['dirs', join(d, 'ref'), join(d, 'test'), '--out', join(d, 'o2'), '--max-mean', '0.6']);
    expect(edge.code).toBe(0);
    expect(edge.out).toMatch(/^QA-FLIP PASS: 2 view\(s\) at or under --max-mean 0\.6; worst mean 0\.6000 \(loud\)$/m);
    const none = run(['dirs', join(d, 'ref'), join(d, 'test'), '--out', join(d, 'o3')]);
    expect(none.code).toBe(0);
    expect(none.out).toMatch(/^QA-FLIP REPORT/m);
    expect(verdict([{ view: 'x', mean: Number.NaN }], 1).exit).toBe(1); // a NaN mean never passes
  });

  it('--mask restricts the stats to the region and reports its share; the threshold reads the region', () => {
    const d = join(tmp, 'mask');
    // The change: the top half (rows 0-3) differs by 102 (0.4); the bottom half by 0. Full-image mean 0.2.
    const ref = put(d, 'ref', () => 0);
    const test = put(d, 'test', (_x, y) => (y < 4 ? 102 : 0));
    const top = put(d, 'top', (_x, y) => (y < 4 ? 255 : 0));
    const bottom = put(d, 'bottom', (_x, y) => (y < 4 ? 0 : 255));
    const plain = run(['pair', ref, test, '--out', join(d, 'o0')]);
    expect(plain.results.views[0]).toMatchObject({ mean: 0.2, region: null });
    const t = run(['pair', ref, test, '--out', join(d, 'o1'), '--mask', top, '--max-mean', '0.3']);
    expect(t.code).toBe(1);
    const tv = t.results.views[0];
    expect(tv).toMatchObject({ mean: 0.4, p95: 0.4, max: 0.4 });
    expect(tv.region).toMatchObject({ pixels: W * 4, share: 1 });
    expect(tv.outside).toMatchObject({ pixels: W * 4, mean: 0, max: 0, share: 0 });
    expect(tv.full.mean).toBeCloseTo(0.2, 6);
    const b = run(['pair', ref, test, '--out', join(d, 'o2'), '--mask', bottom, '--max-mean', '0.1']);
    expect(b.code).toBe(0);
    expect(b.results.views[0]).toMatchObject({ mean: 0, max: 0 });
    expect(b.results.views[0].region.share).toBe(0);
    expect(b.results.views[0].outside.mean).toBeCloseTo(0.4, 6);
  });

  it('--mask-dir gives each view its own mask, and a view without one is an error', () => {
    const d = join(tmp, 'maskdir');
    for (const n of ['sky', 'ground']) { put(join(d, 'ref'), n, () => 0); put(join(d, 'test'), n, (_x, y) => (y < 4 ? 51 : 0)); }
    put(join(d, 'masks'), 'sky', (_x, y) => (y < 4 ? 255 : 0));
    put(join(d, 'masks'), 'ground', (_x, y) => (y < 4 ? 0 : 255));
    const r = run(['dirs', join(d, 'ref'), join(d, 'test'), '--out', join(d, 'o'), '--mask-dir', join(d, 'masks')]);
    expect(r.code).toBe(0);
    const by = Object.fromEntries(r.results.views.map((v: { view: string; mean: number }) => [v.view, v.mean]));
    expect(by).toEqual({ ground: 0, sky: 0.2 });
    rmSync(join(d, 'masks', 'ground.png'));
    const m = run(['dirs', join(d, 'ref'), join(d, 'test'), '--out', join(d, 'o2'), '--mask-dir', join(d, 'masks')]);
    expect(m.code).toBe(2);
    expect(m.err).toMatch(/no mask for view ground/);
  });

  it('refuses what it cannot measure: no binary, a FLIP failure, a mask of another size, an empty mask, a changed map format', () => {
    const d = join(tmp, 'errors');
    const a = put(d, 'a', () => 0), b = put(d, 'b', () => 10);
    const nobin = run(['pair', a, b], { FLIP_BIN: undefined });
    expect(nobin.code).toBe(2);
    expect(nobin.err).toMatch(/no FLIP binary: pass --flip .* or set FLIP_BIN/);
    expect(run(['pair', a, b, '--flip', join(d, 'nope')]).err).toMatch(/FLIP binary not found/);
    const small = put(d, 'small', () => 0, 8, 4);
    const size = run(['pair', a, small, '--out', join(d, 'o1')]);
    expect(size.code).toBe(2);
    expect(size.err).toMatch(/FLIP exit 1 .*\n(.*\n)*Error: reference <16x8> and test <8x4> images must be of equal dimensions/);
    expect(run(['pair', a, b, '--out', join(d, 'o2'), '--mask', small]).err).toMatch(/mask .* is 8x4, the view b is 16x8/);
    const black = put(d, 'black', () => 0);
    expect(run(['pair', a, b, '--out', join(d, 'o3'), '--mask', black]).err).toMatch(/the mask selects no pixel/);
    process.env.FAKE_FLIP_SKEW = '0.01'; // the fake inherits the test's environment
    const skew = run(['pair', a, b, '--out', join(d, 'o4')]);
    delete process.env.FAKE_FLIP_SKEW;
    expect(skew.code).toBe(2);
    expect(skew.err).toMatch(/the map format changed/);
    writeFileSync(join(d, 'c.jpg'), 'x');
    expect(run(['pair', a, join(d, 'c.jpg')]).err).toMatch(/must be a PNG/);
    expect(run(['dirs', d, d]).err).toMatch(/dirs needs --out/);
    expect(run(['pair', a, b, '--max-mean', 'lots']).err).toMatch(/--max-mean must be a number/);
    expect(run(['pair', a, b, '--bogus', '1']).err).toMatch(/unknown option --bogus/);
  });
});

// Local only: the real FLIP 1.7 binary (FLIP_BIN=<scratch venv>/bin/flip npx vitest run tests/unit/qa-flip.test.ts).
describe.runIf(!!process.env.FLIP_BIN)('qa-flip with the real FLIP (FLIP_BIN set)', () => {
  it('a committed shot against itself is 0.000; a 40x40 block lights only the block and its filter halo', async () => {
    const d = mkdtempSync(join(tmpdir(), 'qa-flip-real-'));
    try {
      const { data, info } = await sharp(join(REPO, 'docs/qa/w17/aaa30m-face-1x.jpg')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const ref = join(d, 'face.png');
      await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toFile(ref);
      const painted = Buffer.from(data);
      for (let y = 200; y < 240; y++) for (let x = 300; x < 340; x++) painted.set([255, 0, 255], (y * info.width + x) * 3);
      const test = join(d, 'block.png');
      await sharp(painted, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toFile(test);
      const near = Buffer.alloc(info.width * info.height);
      for (let y = 188; y < 252; y++) for (let x = 288; x < 352; x++) near[y * info.width + x] = 255;
      const mask = join(d, 'near.png');
      await sharp(near, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toFile(mask);
      const env = { FLIP_BIN: process.env.FLIP_BIN };
      const same = run(['pair', ref, ref, '--out', join(d, 'o1'), '--max-mean', '0'], env);
      expect(same.code).toBe(0);
      expect(same.results.views[0]).toMatchObject({ mean: 0, max: 0, p95: 0 });
      const blk = run(['pair', ref, test, '--out', join(d, 'o2'), '--mask', mask], env);
      expect(blk.code).toBe(0);
      const v = blk.results.views[0];
      expect(v.full.mean).toBeGreaterThan(0.004);
      expect(v.region.share).toBe(1);
      expect(v.outside.max).toBe(0);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
