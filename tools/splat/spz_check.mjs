// spz_check.mjs (W17 AAA pass 4 SPLAT, lane BL-DCC): proves a baked .spz parses with three 0.186.1's own SPZLoader
// in Node, and that what three decodes keeps the splat's limits and agrees with the bake's receipt.
//
//   node tools/splat/spz_check.mjs assets/backdrop/lot_backdrop_untrained.spz [--receipt <file>] [--json]
//
// The receipt defaults to <stem>.receipt.json. Checks (each failure is listed; exit 1 on any):
//   - SPZLoader.parse returns a geometry with position (3), covariance (6) and color (4, normalised) attributes
//   - splats <= limits.splats_max (300k), file bytes <= limits.bytes_max (15 MB)
//   - every position, covariance and colour finite; covariance diagonals > 0; alpha > 0
//   - nothing inside the crop: max(|x|, |z|) >= limits.min_cheb_m (165 m) for every decoded centre
//   - the receipt: label UNTRAINED, the file's sha256 and bytes, the splat count, and every sample splat
//     (position to float32, colour bytes exactly, covariance to 1e-5 relative) as three decodes it
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SPZLoader } from 'three/addons/loaders/SPZLoader.js';

export const SPLAT = { splatsMax: 300000, bytesMax: 15 * 1000 * 1000, minChebM: 165, label: 'UNTRAINED' };

export function receiptPathFor(spzPath) {
  return spzPath.replace(/\.spz$/i, '') + '.receipt.json';
}

/**
 * @typedef {{ ok: boolean, errors: string[], path: string, bytes: number, sha256: string, splats: number,
 *   minChebM: number, boundsMin: number[], boundsMax: number[], meanColour: number[], samplesChecked: number,
 *   limits: { splatsMax: number, bytesMax: number, minChebM: number }, label: string | null }} SpzReport
 */

/**
 * Parse `spzPath` with three's SPZLoader and check it against the limits and (when found) its receipt.
 * @param {string} spzPath
 * @param {{ receipt?: string, requireReceipt?: boolean }} [opts]
 * @returns {SpzReport}
 */
export function checkSpz(spzPath, opts = {}) {
  const errors = [];
  const buf = readFileSync(spzPath);
  const rp = opts.receipt ?? receiptPathFor(spzPath);
  const receipt = existsSync(rp) ? JSON.parse(readFileSync(rp, 'utf8')) : null;
  if (!receipt && opts.requireReceipt !== false) errors.push(`no receipt at ${rp}`);
  const lim = {
    splatsMax: receipt?.limits?.splats_max ?? SPLAT.splatsMax,
    bytesMax: receipt?.limits?.bytes_max ?? SPLAT.bytesMax,
    minChebM: receipt?.limits?.min_cheb_m ?? SPLAT.minChebM,
  };
  // never let a receipt loosen the card's limits
  lim.splatsMax = Math.min(lim.splatsMax, SPLAT.splatsMax);
  lim.bytesMax = Math.min(lim.bytesMax, SPLAT.bytesMax);
  lim.minChebM = Math.max(lim.minChebM, SPLAT.minChebM);

  const sha256 = createHash('sha256').update(buf).digest('hex');
  /** @type {SpzReport} */
  const report = {
    ok: false, errors, path: spzPath, bytes: buf.length, sha256, splats: 0, minChebM: NaN, boundsMin: [], boundsMax: [],
    meanColour: [], samplesChecked: 0, limits: lim, label: receipt?.label ?? null,
  };
  let geo;
  try {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    geo = new SPZLoader().parse(ab);
  } catch (e) {
    errors.push(`SPZLoader.parse threw: ${e instanceof Error ? e.message : e}`);
    return report;
  }
  if (geo && typeof geo.then === 'function') {
    errors.push('SPZ v4 (async ZSTD) is not the baked format: expected v3 gzip');
    return report;
  }
  const P = geo.getAttribute('position');
  const C = geo.getAttribute('covariance');
  const K = geo.getAttribute('color');
  if (!P || P.itemSize !== 3) errors.push('no position (3) attribute');
  if (!C || C.itemSize !== 6) errors.push('no covariance (6) attribute');
  if (!K || K.itemSize !== 4 || !K.normalized) errors.push('no normalised color (4) attribute');
  if (errors.length) return report;

  const n = P.count;
  const p = P.array, c = C.array, k = K.array;
  if (n < 1) errors.push('no splats');
  if (n > lim.splatsMax) errors.push(`splats ${n} > ${lim.splatsMax}`);
  if (buf.length > lim.bytesMax) errors.push(`bytes ${buf.length} > ${lim.bytesMax}`);
  let minCheb = Infinity, nonFinite = 0, badCov = 0, zeroAlpha = 0, inside = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { nonFinite++; continue; }
    const cheb = Math.max(Math.abs(x), Math.abs(z));
    if (cheb < minCheb) minCheb = cheb;
    if (cheb < lim.minChebM) inside++;
    lo[0] = Math.min(lo[0], x); lo[1] = Math.min(lo[1], y); lo[2] = Math.min(lo[2], z);
    hi[0] = Math.max(hi[0], x); hi[1] = Math.max(hi[1], y); hi[2] = Math.max(hi[2], z);
    for (let j = 0; j < 6; j++) if (!Number.isFinite(c[6 * i + j])) { nonFinite++; break; }
    if (!(c[6 * i] > 0 && c[6 * i + 3] > 0 && c[6 * i + 5] > 0)) badCov++;
    if (k[4 * i + 3] === 0) zeroAlpha++;
    mean[0] += k[4 * i]; mean[1] += k[4 * i + 1]; mean[2] += k[4 * i + 2];
  }
  if (nonFinite) errors.push(`${nonFinite} splats with non-finite values`);
  if (badCov) errors.push(`${badCov} splats with a covariance diagonal <= 0`);
  if (zeroAlpha) errors.push(`${zeroAlpha} splats with alpha 0`);
  if (inside) errors.push(`${inside} splats inside the crop: max(|x|,|z|) < ${lim.minChebM} m (nearest ${minCheb.toFixed(3)} m)`);

  let samplesChecked = 0;
  if (receipt) {
    const out = receipt.outputs?.spz ?? {};
    if (receipt.label !== SPLAT.label || out.label !== SPLAT.label) errors.push(`receipt label is not ${SPLAT.label}`);
    if (out.sha256 !== sha256) errors.push(`sha256 ${sha256} != receipt ${out.sha256}`);
    if (out.bytes !== buf.length) errors.push(`bytes ${buf.length} != receipt ${out.bytes}`);
    if (out.splats !== n) errors.push(`splats ${n} != receipt ${out.splats}`);
    for (const s of receipt.samples ?? []) {
      const i = s.index;
      if (!(i >= 0 && i < n)) { errors.push(`sample ${i} out of range`); continue; }
      for (let a = 0; a < 3; a++) {
        if (p[3 * i + a] !== Math.fround(s.position[a])) errors.push(`sample ${i} position[${a}] ${p[3 * i + a]} != ${s.position[a]}`);
      }
      for (let a = 0; a < 4; a++) {
        if (k[4 * i + a] !== s.color_rgba[a]) errors.push(`sample ${i} color[${a}] ${k[4 * i + a]} != ${s.color_rgba[a]}`);
      }
      const scale = Math.max(Math.abs(s.covariance[0]), Math.abs(s.covariance[3]), Math.abs(s.covariance[5]));
      for (let a = 0; a < 6; a++) {
        if (Math.abs(c[6 * i + a] - s.covariance[a]) > 1e-5 * scale) {
          errors.push(`sample ${i} covariance[${a}] ${c[6 * i + a]} != ${s.covariance[a]}`);
        }
      }
      samplesChecked++;
    }
    if (!samplesChecked) errors.push('receipt has no sample splats');
  }
  const r3 = (v) => v.map((x) => Math.round(x * 1000) / 1000);
  return Object.assign(report, {
    ok: errors.length === 0, splats: n, minChebM: Math.round(minCheb * 1000) / 1000, boundsMin: r3(lo), boundsMax: r3(hi),
    meanColour: r3(mean.map((v) => v / n / 255)), samplesChecked,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--receipt');
  const ri = argv.indexOf('--receipt');
  if (!file) {
    console.error('usage: node tools/splat/spz_check.mjs <file.spz> [--receipt <file>] [--json]');
    process.exit(2);
  }
  const r = checkSpz(file, { receipt: ri >= 0 ? argv[ri + 1] : undefined });
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    const { errors, ...facts } = r;
    console.log(JSON.stringify(facts));
    for (const e of errors) console.log('  FAIL ' + e);
  }
  console.log(`SPZ CHECK: ${r.ok ? 'PASS' : 'FAIL'} (${r.splats ?? 0} splats, ${r.bytes} bytes, three SPZLoader)`);
  process.exit(r.ok ? 0 : 1);
}
