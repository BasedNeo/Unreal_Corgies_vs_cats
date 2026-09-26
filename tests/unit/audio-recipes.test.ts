// Every procedural SFX recipe schedules cleanly on a strict stand-in AudioContext. It enforces the Web Audio
// rules browsers throw on (non-finite values, exponential ramps to <= 0, stop before start), so a broken recipe
// fails here instead of silently at runtime.
import { describe, it, expect } from 'vitest';
import * as S from '../../src/client/audio/presets';
import type { Voice } from '../../src/client/audio/synth';

function param(initial = 0) {
  const p = {
    value: initial,
    setValueAtTime(v: number, t: number) { if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError(`setValueAtTime(${v}, ${t})`); return p; },
    linearRampToValueAtTime(v: number, t: number) { if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError(`linearRamp(${v}, ${t})`); return p; },
    exponentialRampToValueAtTime(v: number, t: number) {
      if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError(`expRamp(${v}, ${t})`);
      if (v <= 0) throw new RangeError(`exponentialRampToValueAtTime to ${v}`); // browsers throw on 0 or negative
      return p;
    },
    setTargetAtTime(v: number, t: number, c: number) { if (![v, t, c].every(Number.isFinite)) throw new TypeError('setTargetAtTime'); return p; },
    cancelScheduledValues() { return p; },
  };
  return p;
}

function node(extra: Record<string, unknown> = {}) {
  let started = -1;
  const n: Record<string, unknown> = {
    connect: (d: unknown) => d,
    disconnect: () => {},
    start: (t = 0) => { if (!Number.isFinite(t)) throw new TypeError('start'); started = t; },
    stop: (t = 0) => { if (!Number.isFinite(t) || (started >= 0 && t < started)) throw new RangeError(`stop(${t}) before start(${started})`); },
    ...extra,
  };
  return n;
}

function fakeCtx(): BaseAudioContext {
  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    createGain: () => node({ gain: param(1) }),
    createOscillator: () => node({ type: 'sine', frequency: param(440), detune: param(0) }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) }),
    createBufferSource: () => node({ buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(1) }),
    createWaveShaper: () => node({ curve: null, oversample: 'none' }),
    createBuffer: (_ch: number, len: number, rate: number) => ({ length: len, sampleRate: rate, getChannelData: () => new Float32Array(len) }),
  };
  return ctx as unknown as BaseAudioContext;
}

describe('SFX recipes', () => {
  const HELPERS = new Set(['drive']); // exported node builders, not recipes
  const recipes = Object.entries(S).filter(([n, f]) => typeof f === 'function' && !HELPERS.has(n)) as [string, S.Recipe][];

  it('are all exported and include the Wave 3 ability voices', () => {
    const names = recipes.map(([n]) => n);
    for (const n of ['droneWhir', 'chargeArm', 'squeakWall', 'whoosh', 'poof', 'whoomp']) expect(names).toContain(n);
  });

  it('schedule without Web Audio errors and report a finite duration, for every strength/variant', () => {
    const ctx = fakeCtx();
    for (const [name, recipe] of recipes) {
      for (const k of [0, 1, 2, 3, 8, 20]) {
        let r = 0.37;
        const v: Voice = { ctx, out: node() as unknown as AudioNode, t: 1.5, rand: () => (r = (r * 9301 + 49297) % 1) };
        const d = recipe(v, k);
        expect(Number.isFinite(d) && d > 0, `${name}(k=${k}) duration ${d}`).toBe(true);
      }
    }
  });
});
