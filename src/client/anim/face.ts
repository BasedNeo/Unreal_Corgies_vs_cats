// Facial expressions: a small parameter set (lids, brows, jaw, tongue, pupils, ears, head tilt)
// with presets, seeded blinking and smooth transitions. Pure numbers — the animator maps them to bones.
import { mulberry32 } from '../../shared/rng';
import { approach } from './springs';

export const EXPRESSIONS = ['neutral', 'smug', 'furious', 'terrified', 'derp', 'happy'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export interface FaceParams {
  lidUp: number;      // 0 open … 1 closed
  lidLo: number;      // 0 open … 1 raised (smiling squint)
  slant: number;      // + angry (inner corners down), - worried
  browY: number;      // -1 low … +1 raised
  browTilt: number;   // + inner ends up (worried), - inner down (angry)
  browAsym: number;   // + left up / right down (smug skeptic)
  jaw: number;        // 0 closed … 1 wide open
  tongue: number;     // 0 in … 1 out
  pupil: number;      // pupil size multiplier
  slit: number;       // cats: 0 thin slit … 1 round
  lookX: number;      // -1 left … +1 right (character space)
  lookY: number;
  cross: number;      // + converge, - diverge (derp)
  earsBack: number;   // 0 upright … 1 pinned back
  earsDroop: number;  // 0 upright … 1 "airplane" ears
  tilt: number;       // head roll (radians)
  lidAsym: number;    // + left lid lower (derp wink)
}

const base = (): FaceParams => ({ lidUp: 0.12, lidLo: 0, slant: 0, browY: 0, browTilt: -0.1, browAsym: 0, jaw: 0, tongue: 0, pupil: 1, slit: 0.6, lookX: 0, lookY: 0, cross: 0, earsBack: 0, earsDroop: 0, tilt: 0, lidAsym: 0 });

export const PRESETS: Record<Expression, FaceParams> = {
  neutral: base(),
  smug: { ...base(), lidUp: 0.5, lidLo: 0.22, slant: -0.05, browY: 0.1, browTilt: 0, browAsym: 0.7, pupil: 0.85, slit: 0.4, lookX: 0.45, tilt: 0.14, earsBack: 0.1 },
  furious: { ...base(), lidUp: 0.46, lidLo: 0.3, slant: 0.85, browY: -0.9, browTilt: -1.1, jaw: 0.4, pupil: 0.7, slit: 0.15, earsBack: 0.75 },
  terrified: { ...base(), lidUp: 0, lidLo: 0, slant: -0.35, browY: 1, browTilt: 1, jaw: 0.62, pupil: 0.45, slit: 1, earsBack: 0.85, earsDroop: 0.7 },
  derp: { ...base(), lidUp: 0.28, lidAsym: 0.35, browY: 0.3, browAsym: -0.6, jaw: 0.42, tongue: 0.95, pupil: 0.95, slit: 0.9, cross: -0.45, tilt: 0.28, earsDroop: 0.45 },
  happy: { ...base(), lidUp: 0.18, lidLo: 0.62, browY: 0.4, browTilt: 0.35, jaw: 0.55, tongue: 0.55, pupil: 1.12, slit: 0.95, earsBack: -0.1 },
};

const KEYS = Object.keys(base()) as (keyof FaceParams)[];

export interface FaceInput {
  dead: boolean; firing: boolean; hpFrac: number; zoomies: boolean; emote: boolean; hit: number; falling: boolean; speed: number;
}

export class FaceController {
  readonly cur: FaceParams = base();
  mood: Expression = 'neutral';
  forced: Expression | null = null;
  private rng: () => number;
  private moodTimer = 0;
  private idleMood: Expression = 'neutral';
  private blinkTimer: number;
  private blinkT = -1;
  private doubleBlink = false;
  private lastFire = -10;
  private t = 0;
  private saccadeT = 0;
  private saccadeX = 0;
  private saccadeY = 0;
  private sx = 0;
  private sy = 0;
  constructor(seed: number, private readonly isCat: boolean) {
    this.rng = mulberry32((seed * 2654435761) ^ 0x5eed);
    this.blinkTimer = 0.8 + this.rng() * 2.5;
    this.moodTimer = 2 + this.rng() * 4;
  }

  /** Picks the expression from game state. */
  choose(i: FaceInput): Expression {
    if (this.forced) return this.forced;
    if (i.firing) this.lastFire = this.t;
    if (i.emote) return 'happy';
    if (i.firing || this.t - this.lastFire < 0.6) return 'furious';
    if (i.hpFrac < 0.3) return 'terrified';
    if (i.falling) return 'terrified';
    if (i.zoomies) return 'happy';
    return this.idleMood;
  }

  /** Eased expression state (presets only) and the per-frame output (+ blink, flinch, saccades). */
  readonly out: FaceParams = base();

  update(i: FaceInput, dt: number): FaceParams {
    this.t += dt;
    this.moodTimer -= dt;
    if (this.moodTimer <= 0) {
      const r = this.rng();
      // Cats lean smug, corgis lean earnest/happy.
      this.idleMood = this.isCat
        ? (r < 0.45 ? 'neutral' : r < 0.88 ? 'smug' : r < 0.95 ? 'derp' : 'happy')
        : (r < 0.55 ? 'neutral' : r < 0.72 ? 'smug' : r < 0.8 ? 'derp' : 'happy');
      this.moodTimer = 3.5 + this.rng() * 5;
    }
    this.mood = this.choose(i);
    const target = PRESETS[this.mood];
    const rate = this.mood === 'furious' || i.hit > 0.2 ? 22 : 9;
    const a = 1 - Math.exp(-rate * dt);
    const o = this.out, cur = this.cur;
    for (let i = 0; i < KEYS.length; i++) { const k = KEYS[i]; cur[k] += (target[k] - cur[k]) * a; o[k] = cur[k]; }

    // Idle eye darts (saccades) while relaxed.
    this.saccadeT -= dt;
    if (this.saccadeT <= 0) { this.saccadeX = (this.rng() - 0.5) * 0.5; this.saccadeY = (this.rng() - 0.5) * 0.2; this.saccadeT = 0.7 + this.rng() * 2.2; }
    const relaxed = (this.mood === 'neutral' || this.mood === 'smug') && !i.dead ? 1 : 0;
    this.sx = approach(this.sx, this.saccadeX * relaxed, 30, dt);
    this.sy = approach(this.sy, this.saccadeY * relaxed, 30, dt);
    o.lookX += this.sx; o.lookY += this.sy;

    // Blink (one or two quick closes on a seeded timer).
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkT < 0) {
      this.blinkT = 0;
      this.doubleBlink = this.rng() < 0.18;
      this.blinkTimer = 1.6 + this.rng() * 3.6;
    }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const d = 0.13;
      const env = this.blinkT < d ? 1 - Math.abs((this.blinkT / d) * 2 - 1) : 0;
      const env2 = this.doubleBlink && this.blinkT > d + 0.06 && this.blinkT < 2 * d + 0.06 ? 1 - Math.abs(((this.blinkT - d - 0.06) / d) * 2 - 1) : 0;
      o.lidUp = Math.max(o.lidUp, Math.max(env, env2));
      if (this.blinkT > 2 * d + 0.1) this.blinkT = -1;
    }
    // Hit flinch: squeeze eyes shut, brows down, ears pinned.
    if (i.hit > 0.05 && !i.dead) {
      const h = Math.min(1, i.hit);
      o.lidUp = Math.max(o.lidUp, 0.85 * h);
      o.lidLo = Math.max(o.lidLo, 0.5 * h);
      o.browY -= 0.6 * h;
      o.earsBack = Math.max(o.earsBack, h);
    }
    // Comic death read: eyes wide (X marks drawn by the rig), tongue out.
    if (i.dead) { o.lidUp = 0; o.lidLo = 0; o.tongue = 1; o.jaw = 0.35; o.earsDroop = 0.9; o.tilt = 0.3; }
    return o;
  }
}
