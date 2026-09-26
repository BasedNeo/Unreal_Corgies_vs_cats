// OWNER: L5 (juice). Presentation data per weapon: tracer look, muzzle flash, camera kick, kill-feed glyph.
// GameEvent.fire carries a weapon *index* into the combat lane's content table. Until the lead wires the real
// table (fx.setWeaponIds(WEAPON_IDS) / audio.setWeaponIds(...)), indices map to the class primaries in CLASS_IDS
// order — the order the class kits list them in src/shared/content/classes.ts.
import { CLASSES } from '../../shared/content/classes';
import { CLASS_IDS } from '../../shared/types';
import { PALETTE } from '../style/style-tokens.js';

export type WeaponFxId = 'squeaker_rifle' | 'snap_pistol' | 'laser_longshot' | 'tennis_mortar' | 'sprinkler_cannon' | 'frisbee_launcher' | 'unknown';

export interface WeaponFx {
  /** 'ball' = tennis-ball streak · 'laser' = full beam · 'water' = droplet spray · 'disc' = frisbee whoosh · 'none'. */
  tracer: 'ball' | 'laser' | 'water' | 'disc' | 'none';
  tracerColor: number;
  /** Glow multiplier (>1 blooms). */
  tracerGlow: number;
  flashColor: number;
  flashSize: number;
  /** Camera trauma added when the LOCAL player fires. */
  kick: number;
  /** Kill-feed glyph id (see ui/icons.ts). */
  glyph: string;
  label: string;
}

export const WEAPON_FX: Record<WeaponFxId, WeaponFx> = {
  squeaker_rifle: { tracer: 'ball', tracerColor: PALETTE.tennisBall, tracerGlow: 2.6, flashColor: PALETTE.accentHot, flashSize: 0.26, kick: 0.035, glyph: 'rifle', label: 'Squeaker Rifle' },
  snap_pistol: { tracer: 'ball', tracerColor: PALETTE.tennisBall, tracerGlow: 2.2, flashColor: PALETTE.accentHot, flashSize: 0.2, kick: 0.05, glyph: 'pistol', label: 'Snap Pistol' },
  laser_longshot: { tracer: 'laser', tracerColor: PALETTE.laserRed, tracerGlow: 4, flashColor: PALETTE.laserRed, flashSize: 0.3, kick: 0.09, glyph: 'laser', label: 'Laser Longshot' },
  tennis_mortar: { tracer: 'none', tracerColor: PALETTE.tennisBall, tracerGlow: 2, flashColor: PALETTE.glowOrange, flashSize: 0.42, kick: 0.14, glyph: 'mortar', label: 'Tennis Mortar' },
  sprinkler_cannon: { tracer: 'water', tracerColor: PALETTE.water, tracerGlow: 1, flashColor: PALETTE.glowCyan, flashSize: 0.22, kick: 0.02, glyph: 'sprinkler', label: 'Sprinkler Cannon' },
  frisbee_launcher: { tracer: 'disc', tracerColor: PALETTE.corgiCream, tracerGlow: 1.6, flashColor: PALETTE.glowCyan, flashSize: 0.2, kick: 0.06, glyph: 'frisbee', label: 'Frisbee Launcher' },
  unknown: { tracer: 'ball', tracerColor: PALETTE.tennisBall, tracerGlow: 2.4, flashColor: PALETTE.accentHot, flashSize: 0.24, kick: 0.04, glyph: 'paw', label: 'Paws' },
};

export const DEFAULT_WEAPON_IDS: readonly string[] = CLASS_IDS.map((c) => CLASSES[c].primary);

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
