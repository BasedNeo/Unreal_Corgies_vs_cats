// Class abilities as data (theme content). src/sim/combat/abilities.ts runs the ones marked
// `live: true`; the rest are fully specified data waiting for their kits (see docs/handoff/L3.md).
// Units: meters, seconds, radians, hit points.

export type AbilityKind = 'cone_blast' | 'cloak' | 'drone' | 'charge' | 'barrier' | 'glide';

export interface AbilityDef {
  id: string;
  /** Corgi-side and cat-side display names. */
  name: string;
  catName: string;
  kind: AbilityKind;
  /** One-line HUD/tooltip description. */
  description: string;
  /** Seconds between uses (counted from activation). */
  cooldown: number;
  /** Active duration in seconds (0 = instant). */
  duration: number;
  /** Effect range (m). */
  range: number;
  /** Cone half-angle (radians) for directional abilities. */
  halfAngle: number;
  /** Damage dealt to each enemy affected. */
  damage: number;
  /** Horizontal / vertical knockback speed (m/s) applied to affected enemies. */
  knockback: number;
  knockUp: number;
  /** Cloak: enemies (and bots) cannot see the user beyond this distance (m). */
  revealRange: number;
  /** Ends early when the user fires. */
  breakOnFire: boolean;
  /** How far (m) enemies hear the activation. */
  noise: number;
  /** True when the authority implements the ability; false = data only (activation is ignored). */
  live: boolean;
}

const DEG = Math.PI / 180;

export const ABILITY_IDS = ['bark_blast', 'shadow_cloak', 'spotter_drone', 'dig_charge', 'squeak_barrier', 'ear_glide'] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  bark_blast: {
    id: 'bark_blast', name: 'Bark Blast', catName: 'Hiss Burst', kind: 'cone_blast',
    description: 'A point-blank shockwave bark: knocks enemies in front of you back and stings a little.',
    cooldown: 8, duration: 0, range: 6.5, halfAngle: 50 * DEG, damage: 15, knockback: 12, knockUp: 6.5,
    revealRange: 0, breakOnFire: false, noise: 28, live: true,
  },
  shadow_cloak: {
    id: 'shadow_cloak', name: 'Shadow Cloak', catName: 'Alley Shade', kind: 'cloak',
    description: 'Go nearly invisible for 5 s. Firing breaks the cloak; enemies only spot you up close.',
    cooldown: 16, duration: 5, range: 0, halfAngle: 0, damage: 0, knockback: 0, knockUp: 0,
    revealRange: 6, breakOnFire: true, noise: 0, live: true,
  },
  spotter_drone: {
    id: 'spotter_drone', name: 'Spotter Drone', catName: 'Bird Watcher', kind: 'drone',
    description: 'Launch a squeaky drone that marks enemies in a 30 m radius for your team for 6 s.',
    cooldown: 20, duration: 6, range: 30, halfAngle: 0, damage: 0, knockback: 0, knockUp: 0,
    revealRange: 0, breakOnFire: false, noise: 20, live: true,
  },
  dig_charge: {
    id: 'dig_charge', name: 'Dig Charge', catName: 'Litter Mine', kind: 'charge',
    description: 'Bury a charge that detonates when an enemy steps within 3 m (70 damage, 5 m blast).',
    cooldown: 14, duration: 30, range: 5, halfAngle: 0, damage: 70, knockback: 9, knockUp: 5,
    revealRange: 0, breakOnFire: false, noise: 10, live: true,
  },
  squeak_barrier: {
    id: 'squeak_barrier', name: 'Squeak Barrier', catName: 'Scratch Wall', kind: 'barrier',
    description: 'Raise a 4 m wide squeaky-toy wall with 300 hp for 8 s that blocks enemy shots; your squad fires through it.',
    cooldown: 18, duration: 8, range: 4, halfAngle: 0, damage: 0, knockback: 0, knockUp: 0,
    revealRange: 0, breakOnFire: false, noise: 12, live: true,
  },
  ear_glide: {
    id: 'ear_glide', name: 'Ear Glide', catName: 'Tail Sail', kind: 'glide',
    description: 'Spread your ears to glide: fall speed capped at 2.5 m/s for up to 4 s.',
    cooldown: 6, duration: 4, range: 0, halfAngle: 0, damage: 0, knockback: 0, knockUp: 0,
    revealRange: 0, breakOnFire: false, noise: 0, live: false,
  },
};

export function abilityDef(id: string): AbilityDef | null {
  return (ABILITIES as Record<string, AbilityDef>)[id] ?? null;
}
