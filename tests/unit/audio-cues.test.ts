// W13 A-CUES: the shared SYNTH cue files (public/assets/audio/synth_*.wav) that the Godot game and the web twin both
// play. Fails if a file goes missing, stops being 16-bit mono 44.1 kHz PCM, drifts out of its duration bounds, is not
// peak-normalised (below 0 dBFS, above -6 dBFS), carries DC, grows past its size budget, or no longer matches what
// `node tools/audio/synth-cues.mjs` regenerates byte for byte.
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = join(root, 'public/assets/audio');
const script = join(root, 'tools/audio/synth-cues.mjs');

/** name → duration bounds in seconds [min, max]. */
const CUES: Record<string, [number, number]> = {
  rifle_shot: [0.05, 0.25],
  hit_confirm: [0.03, 0.12],
  slab_tick: [0.04, 0.15],
  slab_tick_enemy: [0.04, 0.15],
  match_end_win: [1.0, 1.8],
  match_end_lose: [1.0, 1.8],
};

interface Wav { format: number; channels: number; rate: number; bits: number; samples: Int16Array }

function parseWav(b: Buffer): Wav {
  expect(b.toString('ascii', 0, 4)).toBe('RIFF');
  expect(b.readUInt32LE(4)).toBe(b.length - 8);
  expect(b.toString('ascii', 8, 12)).toBe('WAVE');
  let fmt: Omit<Wav, 'samples'> | undefined, samples: Int16Array | undefined;
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4), body = o + 8;
    if (id === 'fmt ') {
      fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
      expect(b.readUInt32LE(body + 8)).toBe(fmt.rate * fmt.channels * (fmt.bits / 8)); // byte rate
      expect(b.readUInt16LE(body + 12)).toBe(fmt.channels * (fmt.bits / 8)); // block align
    } else if (id === 'data') {
      expect(body + size).toBeLessThanOrEqual(b.length);
      samples = new Int16Array(size / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = b.readInt16LE(body + i * 2);
    }
    o = body + size + (size & 1);
  }
  expect(fmt, 'fmt chunk').toBeDefined();
  expect(samples, 'data chunk').toBeDefined();
  return { ...fmt!, samples: samples! };
}

/** Zero crossings per second / 2: a rough pitch for a tonal blip. */
const zcrHz = (s: Int16Array, rate: number) => {
  let z = 0;
  for (let i = 1; i < s.length; i++) if ((s[i - 1] < 0) !== (s[i] < 0)) z++;
  return z / (s.length / rate) / 2;
};

const tmp = mkdtempSync(join(tmpdir(), 'cvc-cues-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('W13 A-CUES synth cue files', () => {
  for (const [name, [lo, hi]] of Object.entries(CUES)) {
    it(`${name}: 16-bit mono 44.1 kHz PCM, ${lo}–${hi} s, peak in (-6, 0) dBFS, no DC, small`, () => {
      const path = join(dir, `synth_${name}.wav`);
      expect(existsSync(path), path).toBe(true);
      const b = readFileSync(path);
      expect(b.length).toBeLessThan(200 * 1024);
      const w = parseWav(b);
      expect([w.format, w.channels, w.rate, w.bits]).toEqual([1, 1, 44100, 16]);
      const sec = w.samples.length / w.rate;
      expect(sec).toBeGreaterThanOrEqual(lo);
      expect(sec).toBeLessThanOrEqual(hi);
      let peak = 0, sum = 0;
      for (const s of w.samples) { peak = Math.max(peak, Math.abs(s)); sum += s; }
      const peakDb = 20 * Math.log10(peak / 32768);
      expect(peakDb).toBeLessThan(0);
      expect(peakDb).toBeGreaterThan(-6);
      expect(Math.abs(sum / w.samples.length) / 32768).toBeLessThan(0.01); // DC offset < 1 % of full scale
      // Starts and ends quietly (no click at either edge).
      expect(Math.abs(w.samples[0])).toBeLessThan(peak * 0.05);
      expect(Math.abs(w.samples[w.samples.length - 1])).toBeLessThan(peak * 0.01);
    });
  }

  it('the enemy slab tick is lower than ours', () => {
    const ours = parseWav(readFileSync(join(dir, 'synth_slab_tick.wav')));
    const theirs = parseWav(readFileSync(join(dir, 'synth_slab_tick_enemy.wav')));
    expect(zcrHz(theirs.samples, 44100)).toBeLessThan(zcrHz(ours.samples, 44100) * 0.8);
  });

  it('SYNTH.md labels the files and says how to regenerate them', () => {
    const note = readFileSync(join(dir, 'SYNTH.md'), 'utf8');
    expect(note).toContain('SYNTH');
    expect(note).toContain('node tools/audio/synth-cues.mjs');
  });

  it('`node tools/audio/synth-cues.mjs` regenerates every file byte for byte', () => {
    execFileSync(process.execPath, [script, '--out', tmp], { stdio: 'pipe' });
    expect(readdirSync(tmp).sort()).toEqual(Object.keys(CUES).map((n) => `synth_${n}.wav`).sort());
    for (const name of Object.keys(CUES)) {
      const f = `synth_${name}.wav`;
      expect(readFileSync(join(tmp, f)).equals(readFileSync(join(dir, f))), f).toBe(true);
    }
  });
});
