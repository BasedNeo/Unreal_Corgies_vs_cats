// Facial expressions: a small parameter set (lids, brows, jaw, tongue, pupils, ears, head tilt)
// with presets, seeded blinking and smooth transitions. Pure numbers — the animator maps them to bones.
import { mulberry32 } from '../../shared/rng';
import { approach } from './springs';

export const EXPRESSIONS = ['neutral', 'smug', 'furious', 'terrified', 'derp', 'happy', 'determined', 'grit'] as const;
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
  browIn: number;     // 0 … 1 brows knit toward the nose (focus, anger)
  smile: number;      // mouth corners: + up (grin) … - down (frown)
  smirk: number;      // + left corner up, right down (one-sided smirk)
  snarl: number;      // 0 … 1 corners pulled back and out (bared teeth with an open jaw)
  chin: number;       // head pitch, + = chin down (a glare from under the brows; eyes compensate)
}

const base = (): FaceParams => ({ lidUp: 0.14, lidLo: 0.05, slant: 0.05, browY: -0.05, browTilt: -0.2, browAsym: 0, jaw: 0, tongue: 0, pupil: 1, slit: 0.6, lookX: 0, lookY: 0, cross: 0, earsBack: 0, earsDroop: 0, tilt: 0, lidAsym: 0, browIn: 0, smile: 0.15, smirk: 0, snarl: 0, chin: 0 });

/**
 * HARDENED resting face (K2, docs/design/HARDENED.md): a veteran's steady squint. Lids low (the upper lid cuts the top
 * of the iris, the lower lid lifts: weariness), brows down and a little knit, the mouth set flat, chin a touch down.
 * The comedy stays in the other expressions: the smug kill grin, the derp, the terrified wide eyes, the knockout.
 */
const veteranRest = (): FaceParams => ({ ...base(), lidUp: 0.38, lidLo: 0.24, slant: 0.24, browY: -0.34, browTilt: -0.42, browIn: 0.32, smile: -0.08, chin: 0.05, pupil: 0.92 });

// K1 attitude pass: combat faces read determined / scrappy / mischievous, never cute-startled and
// never horror. Lids really cover the iris now (body.ts), brows knit down and in, the mouth line
// bends at its corners, and cats narrow to slits.
export const PRESETS: Record<Expression, FaceParams> = {
  neutral: veteranRest(),
  smug: { ...base(), lidUp: 0.5, lidLo: 0.3, slant: 0.1, browY: 0.1, browTilt: 0, browAsym: 0.75, pupil: 0.85, slit: 0.3, lookX: 0.35, tilt: 0.16, earsBack: 0.1, smile: 0.8, smirk: 0.7, jaw: 0.1 },
  furious: { ...base(), lidUp: 0.48, lidLo: 0.36, slant: 0.9, browY: -1, browTilt: -1.2, browIn: 1, jaw: 0.34, pupil: 0.68, slit: 0.06, earsBack: 0.8, smile: -0.35, snarl: 1, chin: 0.1 },
  terrified: { ...base(), lidUp: 0, lidLo: 0, slant: -0.35, browY: 1, browTilt: 1, jaw: 0.62, pupil: 0.45, slit: 1, earsBack: 0.85, earsDroop: 0.7, smile: -0.8 },
  derp: { ...base(), lidUp: 0.28, lidAsym: 0.35, browY: 0.3, browAsym: -0.6, jaw: 0.42, tongue: 0.95, pupil: 0.95, slit: 0.9, cross: -0.45, tilt: 0.28, earsDroop: 0.45, smile: 0.3, smirk: -0.4 },
  happy: { ...base(), lidUp: 0.18, lidLo: 0.62, browY: 0.4, browTilt: 0.35, jaw: 0.55, tongue: 0.55, pupil: 1.12, slit: 0.95, earsBack: -0.1, smile: 1 },
  /** Aiming: a narrowed, level glare from under knitted brows, mouth set. */
  determined: { ...base(), lidUp: 0.44, lidLo: 0.32, slant: 0.6, browY: -0.75, browTilt: -0.95, browIn: 0.85, pupil: 0.78, slit: 0.1, earsBack: 0.4, smile: -0.2, smirk: 0.15, chin: 0.12 },
  /** Taking a hit: squeezed eyes, gritted teeth bared by a small jaw drop. */
  grit: { ...base(), lidUp: 0.7, lidLo: 0.6, slant: 0.7, browY: -0.9, browTilt: -1.1, browIn: 1, jaw: 0.2, pupil: 0.7, slit: 0.05, earsBack: 1, smile: -0.5, snarl: 1, chin: 0.05 },
};

const KEYS = Object.keys(base()) as (keyof FaceParams)[];

export interface FaceInput {
  dead: boolean; firing: boolean; hpFrac: number; zoomies: boolean; emote: boolean; hit: number; falling: boolean; speed: number;
  /** Aiming down sights (optional for older hosts). */
  aiming?: boolean;
}

/** Seconds the smug kill grin holds (it pre-empts the firing face, so it reads mid-fight). */
export const KILL_GRIN_S = 1.8;
/** Seconds the gritted-teeth face holds after a hit. */
export const GRIT_S = 0.55;

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
  private lastKill = -10;
  private lastHit = -10;
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

  /** The owner scored a kill: smug grin. */
  kill(): void { this.lastKill = this.t; }
  /** Took damage: gritted teeth (the eye-squeeze flinch comes from FaceInput.hit). */
  hurt(): void { this.lastHit = this.t; }

  /** Picks the expression from game state. */
  choose(i: FaceInput): Expression {
    if (this.forced) return this.forced;
    if (i.dead) return 'neutral';
    if (i.firing) this.lastFire = this.t;
    if (i.emote) return 'happy';
    if (this.t - this.lastKill < KILL_GRIN_S) return 'smug';
    if (this.t - this.lastHit < GRIT_S) return 'grit';
    if (i.firing || this.t - this.lastFire < 0.6) return 'furious';
    if (i.aiming) return 'determined';
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
      // Cats lean smug, corgis lean stoic (HARDENED: mostly the veteran squint, a rare derp or grin between fights).
      this.idleMood = this.isCat
        ? (r < 0.5 ? 'neutral' : r < 0.9 ? 'smug' : r < 0.96 ? 'derp' : 'happy')
        : (r < 0.68 ? 'neutral' : r < 0.84 ? 'smug' : r < 0.92 ? 'derp' : 'happy');
      this.moodTimer = 3.5 + this.rng() * 5;
    }
    this.mood = this.choose(i);
    const target = PRESETS[this.mood];
    const rate = this.mood === 'furious' || this.mood === 'grit' || this.mood === 'smug' || i.hit > 0.2 ? 22 : this.mood === 'determined' ? 14 : 9;
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
    // Hit flinch: squeeze eyes shut, brows down, ears pinned, teeth bared.
    if (i.hit > 0.05 && !i.dead) {
      const h = Math.min(1, i.hit);
      o.lidUp = Math.max(o.lidUp, 0.85 * h);
      o.lidLo = Math.max(o.lidLo, 0.5 * h);
      o.browY -= 0.6 * h;
      o.earsBack = Math.max(o.earsBack, h);
      o.snarl = Math.max(o.snarl, h);
      o.jaw = Math.max(o.jaw, 0.18 * h);
    }
    // Comic death read: eyes wide (X marks drawn by the rig), tongue out.
    if (i.dead) { o.lidUp = 0; o.lidLo = 0; o.tongue = 1; o.jaw = 0.35; o.earsDroop = 0.9; o.tilt = 0.3; o.smile = -0.3; o.snarl = 0; o.chin = 0; }
    return o;
  }
}
