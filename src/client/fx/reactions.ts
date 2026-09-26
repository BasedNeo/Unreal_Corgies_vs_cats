// OWNER: L5 (juice). Camera trauma + hit-stop suggestions per GameEvent, and the hit-stop clock.
// Pure logic: the lead feeds `shake` into cam.shake() and applies HitStop.scale to presentation only
// (avatar animation / camera), never to the simulation or input.
import type { GameEvent } from '../../shared/protocol';
import type { WeaponFxId } from './weapon-fx';
import { WEAPON_FX } from './weapon-fx';

export interface FxReaction {
  /** Trauma to add to the camera (0..1; the rig squares it). */
  shake: number;
  /** Presentation freeze frames at 60 Hz (0 = none). */
  hitStopFrames: number;
}

export interface ReactionContext {
  localId: number;
  /** Local player position (for distance falloff of explosions), or null. */
  lx: number; ly: number; lz: number; hasLocal: boolean;
  weaponOf(wpn: number): WeaponFxId;
}

/** Tuning table (MASTER_PLAN §4: hit-stop 3–5 frames on melee/crit; trauma shake). */
export const REACT = {
  hitTakenBase: 0.12, hitTakenPerDmg: 1 / 180, hitTakenMax: 0.45,
  critDealtStop: 3, killDealtStop: 5, killDealtShake: 0.08, critDealtShake: 0.05,
  explodeMax: 0.7, explodeRangeMul: 3.5,
  landMinImpact: 12, landShake: 0.22,
  deathSelfShake: 0.35,
} as const;

export function reactionFor(ev: GameEvent, c: ReactionContext, out: FxReaction = { shake: 0, hitStopFrames: 0 }): FxReaction {
  out.shake = 0; out.hitStopFrames = 0;
  const me = c.localId;
  switch (ev.e) {
    case 'fire':
      if (ev.id === me) out.shake = WEAPON_FX[c.weaponOf(ev.wpn)].kick;
      break;
    case 'hit':
      if (ev.dst === me) out.shake = Math.min(REACT.hitTakenMax, REACT.hitTakenBase + ev.dmg * REACT.hitTakenPerDmg);
      else if (ev.src === me && ev.crit) { out.shake = REACT.critDealtShake; out.hitStopFrames = REACT.critDealtStop; }
      break;
    case 'death':
      if (ev.id === me) out.shake = REACT.deathSelfShake;
      else if (ev.by === me) { out.shake = REACT.killDealtShake; out.hitStopFrames = REACT.killDealtStop; }
      break;
    case 'explode':
      if (c.hasLocal) {
        const d = Math.hypot(ev.x - c.lx, ev.y - c.ly, ev.z - c.lz);
        const range = Math.max(4, ev.r * REACT.explodeRangeMul);
        const k = 1 - d / range;
        if (k > 0) out.shake = REACT.explodeMax * k * k;
      }
      break;
    case 'land':
      if (ev.id === me && ev.impact > REACT.landMinImpact) out.shake = Math.min(0.4, REACT.landShake * (ev.impact / 16));
      break;
    case 'ability':
      if (ev.id === me && ev.ability === 'bark_blast') out.shake = 0.18;
      break;
    default:
      break;
  }
  return out;
}

/**
 * Hit-stop clock. request(frames) freezes presentation for frames/60 s (the longest request wins), then eases
 * back to full speed over 60 ms. Advance with real (unscaled) dt.
 */
export class HitStop {
  private hold = 0;
  private recover = 0;
  static readonly FROZEN = 0.04;
  static readonly RECOVER = 0.06;

  request(frames: number): void {
    if (frames <= 0) return;
    this.hold = Math.max(this.hold, frames / 60);
    this.recover = HitStop.RECOVER;
  }

  update(realDt: number): void {
    if (this.hold > 0) { this.hold = Math.max(0, this.hold - realDt); return; }
    if (this.recover > 0) this.recover = Math.max(0, this.recover - realDt);
  }

  /** Presentation time scale in (0, 1]. */
  get scale(): number {
    if (this.hold > 0) return HitStop.FROZEN;
    if (this.recover > 0) { const u = 1 - this.recover / HitStop.RECOVER; return HitStop.FROZEN + (1 - HitStop.FROZEN) * u * u; }
    return 1;
  }
}
