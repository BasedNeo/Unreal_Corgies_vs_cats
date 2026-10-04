// A-HOOK (W15): objective numbers for the six shared SYNTH cues (public/assets/audio/synth_*.wav). These are
// measurements, not a listening test. Node only, no dependencies, deterministic.
//   node tools/audio/measure-cues.mjs [folder] [--json]
// Per file:
//   durationMs   the file's length
//   peakDb       the largest sample (dBFS)
//   rmsDb        RMS over the whole file (dBFS)
//   rms50Db      RMS over the loudest 50 ms window (dBFS)
//   attackMs     from the first 1 ms RMS window within -20 dB of the loudest window, to that window
//   audibleMs    until the 1 ms RMS envelope last sits above -40 dB of its loudest window
//   centroidHz   spectral centroid: magnitude-weighted mean frequency, whole file, Hann window, 20 Hz - 20 kHz
//   dominantHz   the largest FFT bin over the same range
// tests/unit/audio-cue-measure.test.ts imports these functions (the own / enemy slab tick must stay apart).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CUE_NAMES = ['rifle_shot', 'hit_confirm', 'slab_tick', 'slab_tick_enemy', 'match_end_win', 'match_end_lose'];
export const cueFile = (cue) => `synth_${cue}.wav`;

/** The samples of a 16-bit PCM mono WAV, scaled to [-1, 1). Throws on any other format. */
export function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= buf.length;) {
    const id = buf.toString('ascii', o, o + 4), size = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(o + 8), channels: buf.readUInt16LE(o + 10), rate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) };
    else if (id === 'data') data = buf.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('no fmt or data chunk');
  if (fmt.format !== 1 || fmt.bits !== 16 || fmt.channels !== 1) throw new Error(`want 16-bit PCM mono, got format ${fmt.format}, ${fmt.bits} bit, ${fmt.channels} ch`);
  const samples = new Float64Array(data.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
  return { rate: fmt.rate, samples };
}

const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));

/** |X[k]| for k = 0 .. n/2 of the Hann-windowed signal, zero-padded to n (a power of two). */
function spectrum(x) {
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  const last = Math.max(1, x.length - 1);
  for (let i = 0; i < x.length; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / last));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const p = i + k, q = p + h;
        const vr = re[q] * cr - im[q] * ci, vi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const mag = new Float64Array((n >> 1) + 1);
  for (let k = 0; k < mag.length; k++) mag[k] = Math.hypot(re[k], im[k]);
  return { mag, n };
}

/** The numbers above for one signal. */
export function measure(samples, rate) {
  let peak = 0, sum = 0;
  for (const v of samples) { const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
  const win = Math.max(1, Math.round(rate / 1000));
  const env = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += samples[j] * samples[j];
    env.push(Math.sqrt(s / win));
  }
  const emax = env.length ? Math.max(...env) : 0;
  const top = env.indexOf(emax);
  const onset = env.findIndex((e) => e >= emax * 0.1);
  let last = env.length - 1;
  while (last > 0 && env[last] < emax * 0.01) last--;
  const w50 = Math.min(samples.length, Math.round(rate * 0.05));
  let run = 0, best = 0;
  for (let i = 0; i < samples.length; i++) {
    run += samples[i] * samples[i];
    if (i >= w50) run -= samples[i - w50] * samples[i - w50];
    if (i >= w50 - 1 && run > best) best = run;
  }
  const { mag, n } = spectrum(samples);
  let kTop = -1, num = 0, den = 0;
  for (let k = 0; k < mag.length; k++) {
    const f = (k * rate) / n;
    if (f < 20 || f > 20000) continue;
    if (kTop < 0 || mag[k] > mag[kTop]) kTop = k;
    num += f * mag[k];
    den += mag[k];
  }
  return {
    durationMs: (samples.length / rate) * 1000,
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(sum / Math.max(1, samples.length))),
    rms50Db: db(Math.sqrt(best / Math.max(1, w50))),
    attackMs: (top - onset) * (win / rate) * 1000,
    audibleMs: (last + 1) * (win / rate) * 1000,
    centroidHz: den > 0 ? num / den : 0,
    dominantHz: kTop >= 0 ? (kTop * rate) / n : 0,
  };
}

/** measure() of one WAV file. */
export function measureFile(path) {
  const { samples, rate } = parseWav(readFileSync(path));
  return measure(samples, rate);
}

/** The own / enemy slab tick pair is told apart by pitch or by length: a spectral centroid gap of at least minCentroidHz,
 *  or an audible-length gap of at least minLengthMs. */
export const TICK_GAP = { minCentroidHz: 150, minLengthMs: 20 };
export function ticksDiffer(own, enemy, gap = TICK_GAP) {
  const centroidGap = Math.abs(own.centroidHz - enemy.centroidHz);
  const lengthGap = Math.abs(own.audibleMs - enemy.audibleMs);
  return { differ: centroidGap >= gap.minCentroidHz || lengthGap >= gap.minLengthMs, centroidGap, lengthGap };
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const dir = args.find((a) => !a.startsWith('--')) ?? join(fileURLToPath(new URL('../../', import.meta.url)), 'public/assets/audio');
  const rows = CUE_NAMES.map((cue) => ({ cue, file: cueFile(cue), ...measureFile(join(dir, cueFile(cue))) }));
  if (json) { console.log(JSON.stringify(rows, null, 2)); return; }
  console.log('| Cue | File | Duration | Peak | RMS (file) | RMS (loudest 50 ms) | Attack | Audible (to -40 dB) | Centroid | Dominant |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(`| ${r.cue} | \`${r.file}\` | ${r.durationMs.toFixed(0)} ms | ${r.peakDb.toFixed(1)} dBFS | ${r.rmsDb.toFixed(1)} dBFS | ${r.rms50Db.toFixed(1)} dBFS | ${r.attackMs.toFixed(0)} ms | ${r.audibleMs.toFixed(0)} ms | ${r.centroidHz.toFixed(0)} Hz | ${r.dominantHz.toFixed(0)} Hz |`);
  }
  const own = rows.find((r) => r.cue === 'slab_tick'), enemy = rows.find((r) => r.cue === 'slab_tick_enemy');
  const t = ticksDiffer(own, enemy);
  console.log(`\nslab_tick vs slab_tick_enemy: centroid gap ${t.centroidGap.toFixed(0)} Hz (min ${TICK_GAP.minCentroidHz}), audible-length gap ${t.lengthGap.toFixed(0)} ms (min ${TICK_GAP.minLengthMs}): ${t.differ ? 'they differ' : 'TOO ALIKE'}`);
  if (!t.differ) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
