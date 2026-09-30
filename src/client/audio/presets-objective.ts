// W10 AU2 (audio-2): the sound of Base Assault (W9 G4a), procedural like every other voice, through the shared
// AudioEngine, its voice limiter and its buses. Two layers per event, both keyed on "mine" = the event's team is the
// local team (G4a's `score.team` is the thieves / the scorers / the ball's own team, so "mine" is always good news):
//   the ball    positional, where it happens (sfx bus): the squeaky tennis ball itself, a different squeeze per event
//               grab      two squeezes (mine: up, eager · theirs: the second one strangled, falling)
//               bounce    it hits the ground and bounces three times (mine: each bounce higher · theirs: sagging)
//               home      a squeeze and the tin cup on the stand (mine: a bright tink · theirs: a dull clunk)
//               squeal    at the capture ring (mine: a long rising SQUEEEAK · theirs: a falling squeal, air leaking)
//   the call    2D (ui bus): field-bugle calls in the music's key (F), the soldiering the joke lives in (HARDENED)
//               taken     mine: a rising "go" call + snare flam · theirs: a two-tone alarm over tom thumps
//               dropped   mine: "hup-HUP" · theirs: "uh-oh", falling
//               returned  mine: "secured", a warm resolving chord · theirs: a muted "womp"
//               captured  mine: the capture fanfare (snare roll, bugle, full chord, timpani, crash, and the ball
//                         squeaking along in tune on top) · theirs: a grim low brass fall and a deflating squeak
// The carrier tension layer (a heartbeat and a pulse on the music bus) is driven from `objectiveTension` below and
// scheduled by music-tension.ts. Replaces G4a's placeholder audio (the HUD's C2 barrier squeak and the chapter
// fanfare) and index.ts's generic pickup chime / score sting for these events.
import { ad, ahr, filter, gain, glide, noiseSrc, osc, type Voice } from './synth';
import type { AudioEngine, PlayOptions } from './engine';
import type { EntityState, GameEvent } from '../../shared/protocol';
import { EFlag, EntityKind } from '../../shared/types';
import { BA_BALL_SEED, BA_GOAL_SEED, BA_PICKUP_ITEM, BA_REASON, BA_STAND_SEED, BallState } from '../../shared/content/modes';

type Recipe = (v: Voice, k: number) => number;
const vary = (v: Voice, amt: number) => 1 + (v.rand() * 2 - 1) * amt;

// ------------------------------------------------------------------------------------------------ the ball

/** One squeeze of the rubber ball: a reedy saw through a formant, pitch a → b (fast) → c, rubber flutter. */
function squeeze(v: Voice, at: number, a: number, b: number, c: number, d: number, peak: number): void {
  const g = gain(v);
  ahr(g.gain, at, 0.006, peak, d * 0.45, d * 0.55);
  const f = filter(v, 'bandpass', Math.min(5200, b * 1.55), 3.2, g, at);
  const o = osc(v, 'sawtooth', a, f, d + 0.05, at);
  o.frequency.setValueAtTime(a, at);
  o.frequency.exponentialRampToValueAtTime(b, at + d * 0.3);
  o.frequency.exponentialRampToValueAtTime(c, at + d);
  const vib = v.ctx.createOscillator(); vib.frequency.value = 34;
  const vg = v.ctx.createGain(); vg.gain.value = b * 0.035;
  vib.connect(vg); vg.connect(o.frequency); vib.start(at); vib.stop(at + d + 0.05);
}

/** The felt ball's body: a soft thock. */
function thock(v: Voice, at: number, f: number, peak: number): void {
  const g = gain(v);
  ad(g.gain, at, 0.002, peak, 0.06);
  const o = osc(v, 'sine', f, g, 0.09, at);
  glide(o.frequency, at, f, f * 0.5, 0.05);
}

/** A steal (k 0 = ours, 1 = theirs): two squeezes as a paw clamps the ball. */
export const ballGrab: Recipe = (v, k) => {
  const t = v.t, p = vary(v, 0.04);
  thock(v, t, 190, 0.35);
  squeeze(v, t, 1000 * p, 1500 * p, 1350 * p, 0.07, 0.3);
  if (k >= 1) squeeze(v, t + 0.08, 1700 * p, 1900 * p, 950 * p, 0.17, 0.42);
  else squeeze(v, t + 0.09, 1150 * p, 2100 * p, 1850 * p, 0.12, 0.42);
  return 0.32;
};

/** A drop (k 0 = our ball fell from their carrier: good · 1 = our carrier fell): three bounces and a roll. */
export const ballBounce: Recipe = (v, k) => {
  const t = v.t, p = vary(v, 0.05);
  const at = [0, 0.2, 0.34, 0.44], amp = [1, 0.62, 0.4, 0.24];
  for (let i = 0; i < at.length; i++) {
    thock(v, t + at[i], 230 - 20 * i, 0.4 * amp[i]);
    const f = (k >= 1 ? 1450 * (1 - 0.11 * i) : 1150 * (1 + 0.1 * i)) * p;
    squeeze(v, t + at[i] + 0.004, f * 0.85, f * 1.2, f, 0.06, 0.28 * amp[i]);
  }
  return 0.56;
};

/** A return (k 0 = ours is home · 1 = theirs is): a squeeze, then the tin cup on the stand. */
export const ballHome: Recipe = (v, k) => {
  const t = v.t, p = vary(v, 0.04);
  squeeze(v, t, 900 * p, 1400 * p, 1200 * p, 0.09, 0.28);
  const at = t + 0.1;
  if (k >= 1) {
    const g = gain(v);
    ad(g.gain, at, 0.002, 0.3, 0.09);
    const o = osc(v, 'triangle', 330, filter(v, 'lowpass', 900, 0.7, g, at), 0.12, at);
    glide(o.frequency, at, 330, 240, 0.08);
  } else {
    for (const [f, pk] of [[2640, 0.16], [3960, 0.08], [5290, 0.04]] as const) {
      const g = gain(v);
      ad(g.gain, at, 0.002, pk, 0.35);
      osc(v, 'sine', f * p, g, 0.4, at);
    }
  }
  return 0.5;
};

/** The ball at the capture ring (k 0 = our capture: a long rising squeak · 1 = theirs: a falling squeal, air out). */
export const ballSqueal: Recipe = (v, k) => {
  const t = v.t, p = vary(v, 0.03);
  if (k >= 1) {
    squeeze(v, t, 2100 * p, 2300 * p, 700 * p, 0.5, 0.4);
    const h = gain(v);
    ahr(h.gain, t + 0.2, 0.05, 0.09, 0.15, 0.25);
    noiseSrc(v, filter(v, 'highpass', 3000, 0.7, h), 0.5, 'white', t + 0.2);
    return 0.7;
  }
  squeeze(v, t, 900 * p, 2200 * p, 2700 * p, 0.45, 0.45);
  return 0.55;
};

// ------------------------------------------------------------------------------------------------ the calls

/** A field bugle: saw + square blend, a lip scoop into the pitch, a brassy filter "blat". */
function horn(v: Voice, f: number, at: number, d: number, peak: number, bright = 1, dest: AudioNode = v.out): OscillatorNode {
  const g = gain(v, 0.0001, dest);
  ahr(g.gain, at, 0.018, peak, d * 0.6, d * 0.4 + 0.05);
  const lp = filter(v, 'lowpass', 600, 1.3, g, at);
  lp.frequency.exponentialRampToValueAtTime(2800 * bright, at + 0.04);
  lp.frequency.exponentialRampToValueAtTime(1300 * bright, at + d);
  const o = osc(v, 'sawtooth', f * 0.97, lp, d + 0.1, at);
  glide(o.frequency, at, f * 0.97, f, 0.03);
  const s = gain(v, 0.35, lp);
  const q = osc(v, 'square', f * 0.97, s, d + 0.1, at);
  glide(q.frequency, at, f * 0.97, f, 0.03);
  return o;
}

function snare(v: Voice, at: number, peak: number): void {
  const g = gain(v);
  ad(g.gain, at, 0.002, peak, 0.13);
  noiseSrc(v, filter(v, 'bandpass', 2100, 0.8, g, at), 0.16, 'white', at);
  const b = gain(v);
  ad(b.gain, at, 0.002, peak * 0.6, 0.07);
  const o = osc(v, 'triangle', 205, b, 0.1, at);
  glide(o.frequency, at, 205, 150, 0.07);
}

function drum(v: Voice, at: number, f: number, peak: number, d = 0.3): void {
  const g = gain(v);
  ad(g.gain, at, 0.004, peak, d);
  const o = osc(v, 'sine', f, g, d + 0.05, at);
  glide(o.frequency, at, f, f * 0.7, d * 0.8);
}

const N = { Ab3: 207.65, Bb3: 233.08, C4: 261.63, Db4: 277.18, D4: 293.66, Eb4: 311.13, E4: 329.63, F4: 349.23, G4: 392, Ab4: 415.3, A4: 440, Bb4: 466.16, C5: 523.25, Db5: 554.37, D5: 587.33, F5: 698.46, A5: 880, C6: 1046.5, F6: 1396.9 };

/** The Base Assault calls. k: 0 taken·mine, 1 taken·theirs, 2 dropped·mine, 3 dropped·theirs, 4 returned·mine,
 *  5 returned·theirs. (Captures have their own: captureFanfare / captureLament.) */
export const baCall: Recipe = (v, k) => {
  const t = v.t;
  switch (k | 0) {
    case 0: // a rising "go" call
      snare(v, t, 0.2); snare(v, t + 0.03, 0.14);
      horn(v, N.C5, t, 0.07, 0.16); horn(v, N.F5, t + 0.08, 0.07, 0.16); horn(v, N.A5, t + 0.16, 0.07, 0.16);
      horn(v, N.C6, t + 0.24, 0.3, 0.17); snare(v, t + 0.24, 0.18);
      return 0.68;
    case 1: // alarm: two tones over tom thumps
      for (let i = 0; i < 4; i++) horn(v, i % 2 ? N.C5 : N.Db5, t + i * 0.18, i === 3 ? 0.22 : 0.15, 0.15, 0.8);
      drum(v, t, 110, 0.4); drum(v, t + 0.36, 104, 0.35);
      return 0.9;
    case 2: // "hup-HUP"
      horn(v, N.A4, t, 0.07, 0.13, 0.7); horn(v, N.D5, t + 0.1, 0.17, 0.15, 0.8);
      drum(v, t + 0.1, 150, 0.22, 0.15);
      return 0.42;
    case 3: // "uh-oh"
      horn(v, N.D5, t, 0.12, 0.14, 0.7);
      glide(horn(v, N.Ab4, t + 0.14, 0.3, 0.14, 0.6).frequency, t + 0.3, N.Ab4, N.Ab4 * 0.94, 0.2);
      drum(v, t + 0.14, 95, 0.3, 0.3);
      return 0.58;
    case 4: // "secured": G C, then a soft F chord
      horn(v, N.G4, t, 0.09, 0.12, 0.8); horn(v, N.C5, t + 0.11, 0.09, 0.12, 0.8);
      for (const f of [N.F4, N.A4, N.C5]) horn(v, f, t + 0.23, 0.36, 0.07, 0.7);
      snare(v, t + 0.23, 0.1);
      return 0.72;
    default: { // "womp": muted, the filter closing
      horn(v, N.Bb4, t, 0.13, 0.13, 0.6);
      const o = horn(v, N.A4, t + 0.15, 0.34, 0.14, 0.5);
      glide(o.frequency, t + 0.3, N.A4, N.A4 * 0.95, 0.2);
      return 0.62;
    }
  }
};

/** Our capture (~2.3 s): a snare roll, the bugle (C C F), the full F chord with vibrato over timpani and a crash,
 *  and the squeaky ball joining in on top, in tune (C6 → F6): the soldiers are proud, the ball squeaks anyway. */
export const captureFanfare: Recipe = (v) => {
  const t = v.t;
  for (let i = 0; i < 13; i++) snare(v, t + i * 0.035, 0.05 + 0.1 * (i / 12));
  horn(v, N.C5, t + 0.46, 0.09, 0.17); horn(v, N.C5, t + 0.58, 0.09, 0.17);
  horn(v, N.F5, t + 0.7, 0.42, 0.19);
  snare(v, t + 0.7, 0.2);
  const vib = v.ctx.createOscillator(); vib.frequency.value = 5.5;
  const vd = v.ctx.createGain(); vd.gain.setValueAtTime(0, t + 1.2); vd.gain.linearRampToValueAtTime(12, t + 1.6);
  vib.connect(vd); vib.start(t + 1.2); vib.stop(t + 2.35);
  for (const f of [N.F4, N.A4, N.C5, N.F5]) vd.connect(horn(v, f, t + 1.2, 0.95, 0.085).detune);
  snare(v, t + 1.2, 0.22);
  drum(v, t + 0.7, 87.3, 0.5, 0.35); drum(v, t + 1.2, 87.3, 0.55, 0.5);
  const cy = gain(v);
  ahr(cy.gain, t + 1.2, 0.01, 0.1, 0.1, 0.9);
  noiseSrc(v, filter(v, 'highpass', 5200, 0.7, cy), 1.1, 'white', t + 1.2);
  squeeze(v, t + 1.3, N.C6, N.C6 * 1.02, N.F6, 0.55, 0.16);
  return 2.35;
};

/** Their capture (~1.4 s): a snare hit, a low brass chord (Bb minor) sagging a semitone, the ball deflating. */
export const captureLament: Recipe = (v) => {
  const t = v.t;
  snare(v, t, 0.2);
  drum(v, t, 73.4, 0.5, 0.5);
  for (const f of [N.Bb3, N.Db4, N.F4]) glide(horn(v, f, t + 0.02, 0.85, 0.09, 0.6).frequency, t + 0.45, f, f * 0.944, 0.5);
  squeeze(v, t + 0.5, 1900, 2000, 600, 0.55, 0.13);
  return 1.45;
};

/** Every recipe (tests render them all). */
export const OBJECTIVE_SFX = { ballGrab, ballBounce, ballHome, ballSqueal, baCall, captureFanfare, captureLament } as const;

// ------------------------------------------------------------------------------------------------ cue table

export type BaEvent = 'taken' | 'dropped' | 'returned' | 'captured';

/** One Base Assault cue: the ball's voice where it happens + the 2D call. */
export interface BaCue { ball: Recipe; ballK: number; call: Recipe; callK: number; callGain: number; callPriority: number }

const REASON_TO_EVENT: Record<string, BaEvent> = {
  [BA_REASON.taken]: 'taken', [BA_REASON.dropped]: 'dropped', [BA_REASON.returned]: 'returned', [BA_REASON.captured]: 'captured',
};

/** Levels (play gains) from the AU2 offline renders (docs/handoff/AU2.md §2): the calls sit with L5's score sting,
 *  the capture fanfare with the adventure's chapter fanfare, the ball's voice with the X4 squeak. */
export const BA_GAIN = { ball: 1.1, call: 0.72, fanfare: 0.6, lament: 0.5 } as const;
/** Per-call trims (baCall k 0..5) that level the calls with each other (short calls read quieter in 100 ms RMS). */
export const CALL_TRIM: readonly number[] = [0.88, 0.7, 0.95, 0.88, 1.23, 1.07];

/** The cue for a Base Assault event, or null for any other score reason. `mine`: ev.team is the local team. */
export function baCue(reason: string, mine: boolean): BaCue | null {
  const e = REASON_TO_EVENT[reason];
  if (!e) return null;
  const m = mine ? 0 : 1;
  switch (e) {
    case 'taken': return { ball: ballGrab, ballK: m, call: baCall, callK: 0 + m, callGain: BA_GAIN.call * CALL_TRIM[0 + m], callPriority: 2 };
    case 'dropped': return { ball: ballBounce, ballK: m, call: baCall, callK: 2 + m, callGain: BA_GAIN.call * CALL_TRIM[2 + m], callPriority: 2 };
    case 'returned': return { ball: ballHome, ballK: m, call: baCall, callK: 4 + m, callGain: BA_GAIN.call * CALL_TRIM[4 + m], callPriority: 2 };
    case 'captured': return mine
      ? { ball: ballSqueal, ballK: 0, call: captureFanfare, callK: 0, callGain: BA_GAIN.fanfare, callPriority: 3 }
      : { ball: ballSqueal, ballK: 1, call: captureLament, callK: 0, callGain: BA_GAIN.lament, callPriority: 3 };
  }
}

// ------------------------------------------------------------------------------------------------ tension

/** The carrier tension for the local player: `level` 0..1 (0 = nothing at stake) and `hunted`: the local player
 *  carries, or our ball is on an enemy's back (the minor-second pulse) rather than a teammate carrying theirs. */
export interface Tension { level: number; hunted: boolean; progress: number }

export const TENSION = {
  /** Our carrier (a teammate): base + progress toward our ring. */
  oursBase: 0.5, oursRise: 0.35,
  /** The local player carries: you are the one being hunted. */
  selfBase: 0.72, selfRise: 0.28,
  /** Our ball is carried by an enemy: base + their progress toward their ring. */
  theirsBase: 0.52, theirsRise: 0.4,
  /** A ball on the ground. */
  oursDropped: 0.3, theirsDropped: 0.25,
  /** Both balls carried at once. */
  both: 0.1,
  /** Smoothing (s): rise fast, fall slow. */
  rise: 0.25, fall: 1.2,
} as const;

interface BaProps { ball: (EntityState | null)[]; stand: (EntityState | null)[]; goal: (EntityState | null)[] }

function progressOf(carrier: EntityState, from: EntityState | null, to: EntityState | null): number {
  if (!to) return 0;
  const d = Math.hypot(carrier.x - to.x, carrier.z - to.z);
  const d0 = from ? Math.max(8, Math.hypot(from.x - to.x, from.z - to.z)) : 60;
  return Math.max(0, Math.min(1, 1 - d / d0));
}

/** Pure: the tension of this snapshot for `localId` (0 outside Base Assault, dead or spectating). */
export function objectiveTension(states: ReadonlyMap<number, EntityState>, localId: number, props?: BaProps): Tension {
  const p = props ?? collect(states, { ball: [null, null], stand: [null, null], goal: [null, null] });
  const out: Tension = { level: 0, hunted: false, progress: 0 };
  const me = states.get(localId);
  if (!me || (me.team !== 0 && me.team !== 1) || !p.ball[0] || !p.ball[1]) return out;
  const L = me.team, F = 1 - L;
  const ours = p.ball[F]!, theirs = p.ball[L]!;         // ours = the enemy ball we carry; theirs = our ball they carry
  let lv = 0, hunted = false, prog = 0;
  if (ours.weapon === BallState.Carried) {
    const self = ours.ammo === localId && (me.flags & EFlag.Dead) === 0;
    prog = progressOf(ours, p.stand[F], p.goal[L]);
    lv = self ? TENSION.selfBase + TENSION.selfRise * prog : TENSION.oursBase + TENSION.oursRise * prog;
    hunted = self;
  } else if (ours.weapon === BallState.Dropped) lv = TENSION.theirsDropped;
  if (theirs.weapon === BallState.Carried) {
    const q = progressOf(theirs, p.stand[L], p.goal[F]);
    const t = TENSION.theirsBase + TENSION.theirsRise * q;
    if (ours.weapon === BallState.Carried) lv = Math.max(lv, t) + TENSION.both;
    else if (t > lv) lv = t;
    hunted = true;
    prog = Math.max(prog, q);
  } else if (theirs.weapon === BallState.Dropped && TENSION.oursDropped > lv) lv = TENSION.oursDropped;
  out.level = Math.min(1, lv); out.hunted = hunted; out.progress = prog;
  return out;
}

function collect(states: ReadonlyMap<number, EntityState>, p: BaProps): BaProps {
  p.ball[0] = p.ball[1] = p.stand[0] = p.stand[1] = p.goal[0] = p.goal[1] = null;
  for (const s of states.values()) {
    if (s.kind !== EntityKind.Prop || (s.team !== 0 && s.team !== 1)) continue;
    if (s.seed === BA_BALL_SEED) p.ball[s.team] = s;
    else if (s.seed === BA_STAND_SEED) p.stand[s.team] = s;
    else if (s.seed === BA_GOAL_SEED) p.goal[s.team] = s;
  }
  return p;
}

// ------------------------------------------------------------------------------------------------ director

export interface ObjectiveAudio {
  /** Plays a Base Assault event's cue. True when the event was a Base Assault one (the caller skips its generic
   *  pickup chime / score sting then). */
  onGameEvent(ev: GameEvent, localId: number, states: ReadonlyMap<number, EntityState>): boolean;
  /** Per frame: the smoothed tension for the music (music-tension.ts). */
  update(states: ReadonlyMap<number, EntityState>, localId: number, dt: number): Tension;
  readonly tension: Tension;
  /** Telemetry: cues played, by event and side ("taken:mine", ...). */
  readonly counts: Record<string, number>;
}

export function createObjectiveAudio(engine: AudioEngine): ObjectiveAudio {
  const props: BaProps = { ball: [null, null], stand: [null, null], goal: [null, null] };
  const tension: Tension = { level: 0, hunted: false, progress: 0 };
  const counts: Record<string, number> = {};
  const o: PlayOptions = {};
  const at = (s: { x: number; y: number; z: number } | null | undefined, dy: number, gainV: number, priority: number): PlayOptions => {
    o.bus = 'sfx'; o.gain = gainV; o.priority = priority; o.category = 'fx'; o.refDist = 6; o.maxDist = 70; o.k = 0;
    if (s) { o.x = s.x; o.y = s.y + dy; o.z = s.z; } else { o.x = undefined; o.y = undefined; o.z = undefined; }
    return o;
  };
  const count = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
  const localTeamOf = (states: ReadonlyMap<number, EntityState>, localId: number) => {
    const me = states.get(localId);
    return me && (me.team === 0 || me.team === 1) ? me.team : 0;
  };
  return {
    tension,
    counts,
    onGameEvent(ev, localId, states) {
      if (ev.e === 'pickup') {
        if (ev.item !== BA_PICKUP_ITEM) return false;
        // the ball changes hands: its voice where the new carrier stands (the 'ball taken' score brings the call)
        const c = states.get(ev.id);
        const mine = (c ? c.team : 0) === localTeamOf(states, localId);
        const opt = c && ev.id !== localId ? at(c, 1, BA_GAIN.ball, 2) : at(null, 0, BA_GAIN.ball * 0.85, 2);
        opt.k = mine ? 0 : 1;
        engine.play(ballGrab, opt);
        count(`grab:${mine ? 'mine' : 'theirs'}`);
        return true;
      }
      if (ev.e !== 'score' || (ev.team !== 0 && ev.team !== 1)) return false;
      const mine = ev.team === localTeamOf(states, localId);
      const cue = baCue(ev.reason, mine);
      if (!cue) return false;
      collect(states, props);
      // where: a drop / return at the ball; a capture at the scorers' ring (the grab already sounded at the pickup)
      if (ev.reason !== BA_REASON.taken) {
        const where = ev.reason === BA_REASON.captured ? props.goal[ev.team] : props.ball[ev.team];
        const opt = at(where, where === props.goal[ev.team] ? 0.6 : 0.2, BA_GAIN.ball, cue.callPriority);
        opt.k = cue.ballK;
        engine.play(cue.ball, opt);
      }
      engine.play(cue.call, { bus: 'ui', k: cue.callK, gain: cue.callGain, priority: cue.callPriority, category: 'ui' });
      count(`${REASON_TO_EVENT[ev.reason]}:${mine ? 'mine' : 'theirs'}`);
      return true;
    },
    update(states, localId, dt) {
      const want = objectiveTension(states, localId, collect(states, props));
      const tc = want.level > tension.level ? TENSION.rise : TENSION.fall;
      tension.level += (want.level - tension.level) * (1 - Math.exp(-Math.max(0, dt) / tc));
      if (tension.level < 1e-3 && want.level === 0) tension.level = 0;
      tension.hunted = want.level > 0 ? want.hunted : tension.hunted;
      tension.progress = want.progress;
      return tension;
    },
  };
}
