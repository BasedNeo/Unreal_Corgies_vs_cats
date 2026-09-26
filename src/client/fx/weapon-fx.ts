// OWNER: L5 (juice), X3 (weapons + combat feedback). Presentation data per weapon: tracer look, muzzle flash (size,
// forward tongue, brake petals), smoke, ejected casings, the light pulse, impact scale, decal size, camera kick
// (trauma + a visual view kick scaled from the weapon's RecoilDef) and the kill-feed glyph.
// GameEvent.fire carries a weapon *index* into the combat lane's content table (WEAPON_IDS); WeaponTable resolves it.
// Everything here is presentation: the sim decides the shot, spread and aim (never read back into input).
import { WEAPON_IDS, WEAPONS, type WeaponId } from '../../shared/content/weapons';
import { PALETTE } from '../style/style-tokens.js';

export type WeaponFxId = WeaponId | 'unknown';

/** Weight class: drives flash size, kick and casing brass in one word (see HARDENED: heavier = bigger). */
export type WeaponClass = 'rifle' | 'pistol' | 'sniper' | 'launcher' | 'shotgun' | 'disc' | 'melee';
export type TracerKind = 'bullet' | 'laser' | 'water' | 'disc' | 'none';
export type CasingKind = 'rifle' | 'pistol' | 'magnum' | 'shell' | 'none';

export interface WeaponFx {
  klass: WeaponClass;
  /** 'bullet' = glowing tracer streak · 'laser' = full beam · 'water' = droplet spray · 'disc' = frisbee whoosh · 'none'. */
  tracer: TracerKind;
  tracerColor: number;
  /** Glow multiplier (>1 blooms). */
  tracerGlow: number;
  /** Tracer halo width (m). */
  tracerWidth: number;
  flashColor: number;
  /** Flash burst radius (m). */
  flashSize: number;
  /** Forward flame tongue length (m); 0 = none (suppressed). */
  flashLen: number;
  /** Side petals from a muzzle brake / nozzle (0, 2, 3 or 4). */
  petals: number;
  /** Smoke wisps per shot (before the quality density). */
  smoke: number;
  casing: CasingKind;
  /** Ejection port distance behind the muzzle along the barrel (m). */
  ejectBack: number;
  /** Peak light-pulse intensity (0 = no light) and its reach (m). */
  light: number;
  lightRange: number;
  lightColor: number;
  /** Impact FX scale (1 = rifle bullet). */
  impact: number;
  /** Bullet-hole decal radius (m); 0 = no mark. */
  decal: number;
  /** Camera trauma added when the LOCAL player fires. */
  kick: number;
  /** Visual view kick as a fraction of the weapon's RecoilDef (pitch/yaw/recover): presentation only. */
  viewKick: number;
  /** Kill-feed glyph id (see ui/icons.ts). */
  glyph: string;
  label: string;
}

/** Tracer amber: between the palette's tennis-ball gold and glow orange. */
const tracerAmber = mixHexPlain(PALETTE.accentHot, PALETTE.glowOrange, 0.45);

/** sRGB-space mix of two palette colours (presentation data; no three import here so this stays Node-pure). */
function mixHexPlain(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round((((a >> s) & 255) * (1 - t)) + (((b >> s) & 255) * t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const BASE: Omit<WeaponFx, 'klass' | 'glyph' | 'label'> = {
  tracer: 'bullet', tracerColor: tracerAmber, tracerGlow: 3, tracerWidth: 0.034,
  flashColor: PALETTE.accentHot, flashSize: 0.28, flashLen: 0.34, petals: 2, smoke: 2,
  casing: 'rifle', ejectBack: 0.42, light: 2.4, lightRange: 3.5, lightColor: PALETTE.glowOrange,
  impact: 1, decal: 0.12, kick: 0.045, viewKick: 0.5,
};

export const WEAPON_FX: Record<WeaponFxId, WeaponFx> = {
  // Assault: a hard 10 rps rifle — brake flash to both sides, amber tracers, brass arcing to the right.
  squeaker_rifle: { ...BASE, klass: 'rifle', glyph: 'rifle', label: 'Squeaker Rifle' },
  // Infiltrator: suppressed — a small cough of flash, thin tracer, pistol brass.
  snap_pistol: {
    ...BASE, klass: 'pistol', tracerGlow: 2.2, tracerWidth: 0.024, flashSize: 0.15, flashLen: 0.1, petals: 0, smoke: 1,
    casing: 'pistol', ejectBack: 0.3, light: 1.2, lightRange: 2.5, impact: 0.85, decal: 0.1, kick: 0.06, viewKick: 0.55,
    glyph: 'pistol', label: 'Snap Pistol',
  },
  // Overwatch: the laser-pointer anti-materiel shot — red beam, red flash with 4 petals, magnum brass, big impacts.
  laser_longshot: {
    ...BASE, klass: 'sniper', tracer: 'laser', tracerColor: PALETTE.laserRed, tracerGlow: 4, tracerWidth: 0.06,
    flashColor: PALETTE.laserRed, flashSize: 0.42, flashLen: 0.55, petals: 4, smoke: 4, casing: 'magnum', ejectBack: 0.6,
    light: 4.5, lightRange: 5, lightColor: PALETTE.laserRed, impact: 1.6, decal: 0.16, kick: 0.12, viewKick: 0.6,
    glyph: 'laser', label: 'Laser Longshot',
  },
  // Breacher: the tube coughs a big orange flash and a ring of smoke; the round itself is a projectile entity.
  tennis_mortar: {
    ...BASE, klass: 'launcher', tracer: 'none', flashColor: PALETTE.glowOrange, flashSize: 0.55, flashLen: 0.32, petals: 0,
    smoke: 7, casing: 'none', ejectBack: 0, light: 4, lightRange: 4.5, impact: 1, decal: 0, kick: 0.16, viewKick: 0.6,
    glyph: 'mortar', label: 'Tennis Mortar',
  },
  // Warden: a pump blast of pressurised water — nozzle spray, mist, red shotgun hulls.
  sprinkler_cannon: {
    ...BASE, klass: 'shotgun', tracer: 'water', tracerColor: PALETTE.water, tracerGlow: 1, flashColor: PALETTE.glowCyan,
    flashSize: 0.3, flashLen: 0.3, petals: 3, smoke: 3, casing: 'shell', ejectBack: 0.3, light: 0, lightRange: 0,
    impact: 0.8, decal: 0.07, kick: 0.1, viewKick: 0.55, glyph: 'sprinkler', label: 'Sprinkler Cannon',
  },
  // Skyraider: flywheels fling the disc — a pale whoosh, an air puff, no brass, no fire.
  frisbee_launcher: {
    ...BASE, klass: 'disc', tracer: 'disc', tracerColor: PALETTE.corgiCream, tracerGlow: 1.6, tracerWidth: 0.09,
    flashColor: PALETTE.glowCyan, flashSize: 0.2, flashLen: 0, petals: 0, smoke: 2, casing: 'none', ejectBack: 0, light: 0,
    lightRange: 0, impact: 0.8, decal: 0, kick: 0.06, viewKick: 0.5, glyph: 'frisbee', label: 'Frisbee Launcher',
  },
  // Swarm kittens: a claw swipe — no flash, no tracer (the hit's fur tufts carry it).
  claw_swipe: {
    ...BASE, klass: 'melee', tracer: 'none', flashSize: 0, flashLen: 0, petals: 0, smoke: 0, casing: 'none', light: 0,
    lightRange: 0, impact: 0.5, decal: 0, kick: 0.02, viewKick: 0, glyph: 'paw', label: 'Claw Swipe',
  },
  unknown: { ...BASE, klass: 'rifle', glyph: 'paw', label: 'Paws' },
};

/** Visual view-kick for a weapon: its RecoilDef scaled by `viewKick` (radians / seconds). */
export function viewKickOf(id: WeaponFxId, out: { pitch: number; yaw: number; recover: number }): { pitch: number; yaw: number; recover: number } {
  const w = id === 'unknown' ? null : WEAPONS[id];
  const k = WEAPON_FX[id].viewKick;
  out.pitch = w ? w.recoil.pitch * k : 0;
  out.yaw = w ? w.recoil.yaw * k : 0;
  out.recover = w ? Math.max(0.08, w.recoil.recover) : 0.1;
  return out;
}

/** The authoritative weapon table order (GameEvent.fire.wpn / EntityState.weapon index into it). */
export const DEFAULT_WEAPON_IDS: readonly string[] = WEAPON_IDS;

/** Resolves a weapon index through a content id table to a presentation id. */
export class WeaponTable {
  private ids: readonly string[] = DEFAULT_WEAPON_IDS;
  set(ids: readonly string[]): void { this.ids = ids.slice(); }
  id(wpn: number): WeaponFxId {
    const id = this.ids[wpn];
    return id && id in WEAPON_FX ? (id as WeaponFxId) : 'unknown';
  }
  fx(wpn: number): WeaponFx { return WEAPON_FX[this.id(wpn)]; }
}
