// Spring-damper helpers for procedural secondary motion (ears, tails, fluff, squash & stretch).
// Semi-implicit Euler with fixed sub-steps so behaviour is stable and identical at 30, 60 or 144 fps.

const SUB = 1 / 120;

/** 1-D damped spring. `k` = stiffness (1/s²), `zeta` = damping ratio (1 = critical, < 1 = bouncy). */
export class Spring {
  x = 0;
  v = 0;
  constructor(public k = 120, public zeta = 0.5) {}

  step(target: number, dt: number): number {
    const c = 2 * this.zeta * Math.sqrt(this.k);
    let rem = Math.min(Math.max(dt, 0), 0.1);
    while (rem > 1e-6) {
      const h = rem < SUB ? rem : SUB;
      this.v += (this.k * (target - this.x) - c * this.v) * h;
      this.x += this.v * h;
      rem -= h;
    }
    if (!Number.isFinite(this.x) || !Number.isFinite(this.v)) this.reset(target);
    return this.x;
  }

  impulse(dv: number): void { this.v += dv; }
  reset(x = 0): void { this.x = x; this.v = 0; }
}

/** Frame-rate independent exponential approach. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Linear move toward target by at most `maxDelta`. */
export function moveToward(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  return Math.abs(d) <= maxDelta ? target : current + Math.sign(d) * maxDelta;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth01 = (v: number) => { const t = clamp01(v); return t * t * (3 - 2 * t); };

/** Elastic "pop" curve 0→1 with overshoot, t in [0,1]. */
export function elasticOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 + Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3));
}
