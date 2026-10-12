// Crosshair gap (W17 TW-VIEW, PARITY H1): how far the general HUD's crosshair arms sit from the centre, in 720p px
// (hud.ts draws the four arms, 9 px long, and scales them by its HUD unit). DOM-free: hud.ts writes what
// crosshairFrame returns; tests/unit/slab-crosshair.test.ts pins it against the authority's own spread.
//  - Slab mode (the Godot game's match; lead ruling W17: the web follows Godot there) draws hud.gd's rule
//    (engines/godot/game/hud.gd:815): gap = 5 + spread × 420, spread being the live rifle cone (rad) the authority
//    shoots with: src/sim/combat/weapon-system.ts currentSpread (hip or aim, opened by speed up to the run speed and in
//    the air, plus the bloom). The snapshot carries the stance, the speed and the grounded flag, and the bloom is kept
//    here from your own `fire` events with the weapon's own numbers, so no new snapshot field is needed. Each shot is
//    stamped with its snapshot's sim time, so shots heard in one frame recover between them as the authority's did.
//    No firing term, no kick and no easing: Godot has none (its gap is the spread of the frame).
//  - Every other mode keeps the general HUD's own crosshair exactly as it was: 7 px plus speed, air and sprint terms,
//    +4 while firing, a kick per own shot, halved while aiming, eased 30 % a frame, snapped to half pixels.
import type { EntityState } from '../../shared/protocol';
import { CLASS_IDS, EFlag } from '../../shared/types';
import { moveStatsFor } from '../../shared/content/classes';
import { SLAB } from '../../shared/content/modes';
import { WEAPONS, type WeaponDef, type WeaponId } from '../../shared/content/weapons';

/** hud.gd:815, the crosshair's gap in 720p px: SLAB_GAP.base + spread (rad) × SLAB_GAP.perRad. */
export const SLAB_GAP = { base: 5, perRad: 420 } as const;

/** Godot's gap (720p px) for a spread (rad). */
export const slabGap = (spread: number): number => SLAB_GAP.base + spread * SLAB_GAP.perRad;

/** What the crosshair keeps between frames. */
export interface CrosshairState {
  /** The gap drawn last frame (720p px). */
  spread: number;
  /** General HUD: the own-shot kick still easing out (720p px). */
  kick: number;
  /** The rifle's bloom (rad) as the authority left it at the last own shot: fired at sim time `bloomT` (s, its
   *  snapshot's tick / tick rate) and heard at `shownAt` (s, the HUD clock). */
  bloom: number;
  bloomT: number;
  shownAt: number;
}

export const crosshairState = (): CrosshairState => ({ spread: 10, kick: 0, bloom: 0, bloomT: 0, shownAt: 0 });

/** The weapon behind a snapshot's weapon id (hud.ts maps the index through the room's weapon table); slab's rifle if
 *  the id is not a weapon. */
export function crosshairWeapon(id: string): WeaponDef {
  return WEAPONS[id as WeaponId] ?? WEAPONS[SLAB.weapon];
}

/** The bloom (rad) `dt` s after the last own shot: what it left, recovering at the weapon's rate (weapon-system.ts:164). */
export function bloomAfter(st: Pick<CrosshairState, 'bloom'>, def: WeaponDef, dt: number): number {
  return Math.max(0, st.bloom - def.bloomRecover * Math.max(0, dt));
}

/**
 * An own shot (the local pet's `fire` event), heard at `now` on the HUD clock. `simT` is the sim time (s) of the
 * snapshot that carried it (main.ts: its tick / the tick rate); without one, the HUD clock. The general HUD's kick grows
 * as it always has (`fxKick`: the weapon's WEAPON_FX kick). The bloom grows as the authority's does when it fires
 * (weapon-system.ts:113: + bloomPerShot, capped at bloomMax) on what the last shot left, recovered over the SIM time
 * between the two shots, not the HUD time: shots heard in one frame (a slow frame, a worker backlog, bunched snapshots)
 * recover between them as the authority's did and never stack. A sim clock that went back (a new authority) carries
 * nothing over.
 */
export function crosshairShot(st: CrosshairState, fxKick: number, def: WeaponDef, now: number, simT = now): void {
  st.kick = Math.min(18, st.kick + 3.5 + fxKick * 30);
  const left = simT >= st.bloomT ? bloomAfter(st, def, simT - st.bloomT) : 0;
  st.bloom = Math.min(def.bloomMax, left + def.bloomPerShot);
  st.bloomT = simT;
  st.shownAt = now;
}

/**
 * The authority's spread (rad) for the pet in a snapshot, as src/sim/combat/weapon-system.ts currentSpread computes it:
 * the aim cone while Btn.Aim is held (EFlag.Aiming), else the hip cone; × (1 + (moveSpreadMult - 1) × min(1, ground
 * speed / the class's run speed)); × airSpreadMult off the ground (EFlag.Grounded clear); + the bloom unless the weapon
 * charges.
 */
export function snapshotSpread(s: Pick<EntityState, 'flags' | 'vx' | 'vz' | 'species' | 'cls'>, def: WeaponDef, bloom: number): number {
  const run = moveStatsFor(s.species === 1 ? 1 : 0, CLASS_IDS[s.cls] ?? SLAB.cls).runSpeed;
  const moveT = Math.min(1, Math.hypot(s.vx, s.vz) / run);
  const base = (s.flags & EFlag.Aiming) !== 0 ? def.spreadAim : def.spreadHip;
  return base * (1 + (def.moveSpreadMult - 1) * moveT) * ((s.flags & EFlag.Grounded) !== 0 ? 1 : def.airSpreadMult)
    + (def.chargeTime > 0 ? 0 : bloom);
}

export interface CrosshairFrame {
  /** A slab match runs (MatchState.mode 'slab'). */
  slab: boolean;
  /** The local pet's weapon (crosshairWeapon). */
  def: WeaponDef;
  /** Seconds (the HUD's clock, the one crosshairShot was given as `now`): the last shot's bloom recovers from when it
   *  was heard. */
  now: number;
}

/** One frame of the crosshair for the living local pet `L`: the gap (720p px) to draw. */
export function crosshairFrame(st: CrosshairState, L: Pick<EntityState, 'flags' | 'vx' | 'vz' | 'species' | 'cls'>, f: CrosshairFrame): number {
  if (f.slab) {
    // hud.gd: the spread of the frame, nothing added, nothing eased; the general HUD's terms stay at rest meanwhile
    st.spread = slabGap(snapshotSpread(L, f.def, bloomAfter(st, f.def, f.now - st.shownAt)));
    st.kick = 0;
    return st.spread;
  }
  const fl = L.flags;
  const sp = Math.hypot(L.vx, L.vz);
  let target = 7 + sp * 0.9;
  if ((fl & EFlag.Grounded) === 0) target += 9;
  if ((fl & EFlag.Sprinting) !== 0) target += 8;
  if ((fl & EFlag.Firing) !== 0) target += 4;
  target += st.kick;
  if ((fl & EFlag.Aiming) !== 0) target *= 0.5;
  st.kick *= 0.86;
  st.spread += (target - st.spread) * 0.3;
  return st.spread;
}

/** Screen px for a gap at the HUD unit `uPx` (min(width / 1280, height / 720), at least 0.6): the general HUD snaps to
 *  half pixels; slab mode keeps Godot's value (to 0.01 px). */
export function crosshairPx(gap: number, uPx: number, slab: boolean): number {
  return slab ? Math.round(gap * uPx * 100) / 100 : Math.round(gap * uPx * 2) / 2;
}

/** Each arm is 9 HUD units long (hud.gd:854-855: from c + d × gap to c + d × (gap + 9)). */
export const CROSSHAIR_ARM = 9;

/** The four arms' CSS transforms, [top, bottom, left, right], for a gap of `px` SCREEN px (crosshairPx; uPx is already
 *  in it) at the HUD unit `uPx`: each arm starts `px` from the centre and runs CROSSHAIR_ARM × uPx out. hud.ts writes
 *  them to [data-xt], [data-xb], [data-xl] and [data-xr] as they are. */
export function crosshairArms(px: number, uPx: number): [string, string, string, string] {
  const len = CROSSHAIR_ARM * uPx;
  return [`translateY(${-px - len}px)`, `translateY(${px}px)`, `translateX(${-px - len}px)`, `translateX(${px}px)`];
}
