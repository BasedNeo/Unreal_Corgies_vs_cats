// Bot archetypes as data. PvE cat archetypes (grunt/sniper/brute/kitten) are spawned by the
// yard-skirmish waves; team-fill bots (both species) get a profile from their class kit.
// Theme names only appear in `label` (used for bot names); behaviour is keyed by `id`.
import type { ClassId } from '../../shared/types';
import type { WeaponId } from '../../shared/content/weapons';

export type ArchetypeId = 'grunt' | 'sniper' | 'brute' | 'kitten' | 'rifleman' | 'skirmisher' | 'marksman' | 'bomber' | 'guard' | 'raider';

export interface Archetype {
  id: ArchetypeId;
  /** Display prefix for bot names. */
  label: string;
  /** Class kit used when spawning (snapshot `cls`), and the weapon override (else the class primary). */
  cls: ClassId;
  weapon?: WeaponId;
  /** Max hp override (else the class value). */
  hp?: number;
  /** Multiplier on run/sprint speed. */
  speedMult: number;
  /** Seconds between first seeing a target and the first shot (uniform in range). */
  reaction: [number, number];
  /** Aim error (radians): starts at aimErr and settles toward aimErrMin with time constant aimSettle (s) while tracking. */
  aimErr: number;
  aimErrMin: number;
  aimSettle: number;
  /** Max turn rate (rad/s) and aim smoothing (1/s). */
  turnRate: number;
  aimLambda: number;
  /** Perception. */
  sightRange: number;
  fovHalf: number;
  /** Engagement band override (m); else the weapon's aiRange. */
  preferRange?: [number, number];
  /** Auto-fire bursts: shots per burst and pause between bursts (s). */
  burst: [number, number];
  burstPause: [number, number];
  /** 0..1: how much the bot strafes while engaging. */
  strafe: number;
  /** Random jumps per second while engaging. */
  jumpRate: number;
  /** Retreat to cover below this hp fraction (0 = never retreats). */
  retreatHp: number;
  /** Seconds the bot visibly aims (EFlag.Aiming → laser telegraph) before a charged shot. */
  telegraph: number;
  /** Chance per acquisition to go for the head. */
  headChance: number;
  /** Aim-down-sights beyond this distance (m); Infinity = never. */
  adsBeyond: number;
  /** 0..1 scale on the tactical rolls for the class ability (src/sim/ai/tactics.ts); PvE fodder uses less. */
  abilityUse: number;
}

const DEG = Math.PI / 180;

const BASE: Omit<Archetype, 'id' | 'label' | 'cls'> = {
  // Human-feeling aim: bots settle to ~1.6° (a near miss at 20 m), not laser accuracy (QA W1 difficulty).
  speedMult: 1, reaction: [0.35, 0.55], aimErr: 7.5 * DEG, aimErrMin: 1.6 * DEG, aimSettle: 0.9,
  turnRate: 5.5, aimLambda: 9, sightRange: 45, fovHalf: 55 * DEG, burst: [3, 7], burstPause: [0.2, 0.45],
  strafe: 0.8, jumpRate: 0.12, retreatHp: 0.3, telegraph: 0, headChance: 0.1, adsBeyond: 14, abilityUse: 1,
};

/** Long-range charge-shot behaviour: keeps distance, stands still and telegraphs with the laser. */
const SNIPER_TUNING: Partial<Archetype> = {
  reaction: [0.35, 0.5], aimErr: 3.5 * DEG, aimErrMin: 0.3 * DEG, aimSettle: 0.9, turnRate: 3.5, aimLambda: 6,
  sightRange: 75, fovHalf: 45 * DEG, preferRange: [20, 50], strafe: 0.15, jumpRate: 0, retreatHp: 0.45,
  telegraph: 0.9, headChance: 0.2, adsBeyond: 0,
};

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  // --- PvE cats ---
  // PvE wave fodder: a touch slower and looser than team-fill bots so co-op squads feel strong
  grunt: {
    ...BASE, id: 'grunt', label: 'Tabby', cls: 'assault', weapon: 'squeaker_rifle',
    reaction: [0.45, 0.7], aimErr: 9 * DEG, aimErrMin: 2.2 * DEG, burstPause: [0.35, 0.7], retreatHp: 0.25, abilityUse: 0.5,
  },
  sniper: { ...BASE, ...SNIPER_TUNING, telegraph: 1.1, aimErrMin: 0.45 * DEG, abilityUse: 0.6, id: 'sniper', label: 'Siamese', cls: 'overwatch', weapon: 'laser_longshot' },
  brute: {
    ...BASE, id: 'brute', label: 'Chonk', cls: 'warden', weapon: 'sprinkler_cannon', hp: 320, speedMult: 0.85,
    reaction: [0.3, 0.45], aimErr: 5 * DEG, aimErrMin: 1.2 * DEG, aimSettle: 0.5, turnRate: 4, sightRange: 40,
    preferRange: [2.5, 8], strafe: 0.3, jumpRate: 0.04, retreatHp: 0, adsBeyond: Infinity, abilityUse: 0.7,
  },
  kitten: {
    ...BASE, id: 'kitten', label: 'Kitten', cls: 'infiltrator', weapon: 'claw_swipe', hp: 45, speedMult: 1.2,
    reaction: [0.25, 0.35], aimErr: 3 * DEG, aimErrMin: 1 * DEG, aimSettle: 0.3, turnRate: 8, aimLambda: 14,
    sightRange: 35, preferRange: [0, 1.2], burst: [3, 6], burstPause: [0.15, 0.3], strafe: 0.5, jumpRate: 0.6,
    retreatHp: 0, adsBeyond: Infinity, abilityUse: 0.35,
  },
  // --- team-fill profiles (per class kit, either species; weapon = class primary) ---
  rifleman: { ...BASE, id: 'rifleman', label: 'Rifle', cls: 'assault' },
  skirmisher: { ...BASE, id: 'skirmisher', label: 'Scout', cls: 'infiltrator', jumpRate: 0.25, headChance: 0.2 },
  marksman: { ...BASE, ...SNIPER_TUNING, aimErrMin: 0.35 * DEG, id: 'marksman', label: 'Marksman', cls: 'overwatch' },
  bomber: { ...BASE, id: 'bomber', label: 'Bomber', cls: 'breacher', strafe: 0.5, adsBeyond: Infinity },
  guard: { ...BASE, id: 'guard', label: 'Guard', cls: 'warden', strafe: 0.4, retreatHp: 0.2, adsBeyond: Infinity },
  raider: { ...BASE, id: 'raider', label: 'Raider', cls: 'skyraider', jumpRate: 0.45, adsBeyond: Infinity },
};

const BY_CLASS: Record<ClassId, ArchetypeId> = {
  assault: 'rifleman', infiltrator: 'skirmisher', overwatch: 'marksman', breacher: 'bomber', warden: 'guard', skyraider: 'raider',
};

/** Behaviour profile for a team-fill bot carrying a class kit. */
export function archetypeForClass(cls: ClassId | null): Archetype {
  return ARCHETYPES[BY_CLASS[cls ?? 'assault']];
}
