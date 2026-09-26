// OWNER: L5 (juice). Combat intensity for adaptive music: recent fire/hit/explosion events near the local
// player push it up; it decays exponentially. Pure (unit-tested); music.ts maps it to layer gains.
import type { GameEvent } from '../../shared/protocol';

export interface IntensityContext { localId: number; hasLocal: boolean; lx: number; ly: number; lz: number; posOf(id: number): { x: number; y: number; z: number } | undefined }

export const INTENSITY = {
  nearRadius: 26,
  fireNear: 0.05, fireLocal: 0.035, hitNear: 0.07, hitTaken: 0.24, hitDealt: 0.08, deathNear: 0.1, explodeNear: 0.3,
  /** Decay time constant (s). */
  tau: 5.5,
  max: 1.6,
} as const;

function dist(c: IntensityContext, x: number, y: number, z: number): number {
  return c.hasLocal ? Math.hypot(x - c.lx, y - c.ly, z - c.lz) : Infinity;
}

/** How much one event raises combat intensity for the local listener. */
export function intensityFor(ev: GameEvent, c: IntensityContext): number {
  const R = INTENSITY.nearRadius;
  switch (ev.e) {
    case 'fire':
      if (ev.id === c.localId) return INTENSITY.fireLocal;
      return dist(c, ev.x, ev.y, ev.z) < R || dist(c, ev.hx, ev.hy, ev.hz) < R * 0.5 ? INTENSITY.fireNear : 0;
    case 'hit':
      if (ev.dst === c.localId) return INTENSITY.hitTaken;
      if (ev.src === c.localId) return INTENSITY.hitDealt;
      return dist(c, ev.x, ev.y, ev.z) < R ? INTENSITY.hitNear : 0;
    case 'death': {
      if (ev.id === c.localId || ev.by === c.localId) return INTENSITY.deathNear * 1.5;
      const p = c.posOf(ev.id);
      return p && dist(c, p.x, p.y, p.z) < R ? INTENSITY.deathNear : 0;
    }
    case 'explode':
      return dist(c, ev.x, ev.y, ev.z) < R * 1.4 ? INTENSITY.explodeNear : 0;
    default:
      return 0;
  }
}

export class CombatIntensity {
  value = 0;
  add(amount: number): void { if (amount > 0) this.value = Math.min(INTENSITY.max, this.value + amount); }
  update(dt: number): void { this.value *= Math.exp(-Math.max(0, dt) / INTENSITY.tau); if (this.value < 1e-4) this.value = 0; }
  /** 0..1 for layer mixing. */
  get level(): number { return Math.min(1, this.value); }
}

/** Layer targets for a level (bed always on, groove fades in first, stabs on top at high intensity). */
export function layerGains(level: number): { bed: number; groove: number; stabs: number } {
  const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const groove = ss(0.1, 0.42, level);
  const stabs = ss(0.5, 0.85, level);
  return { bed: 1 - 0.35 * groove, groove, stabs };
}
