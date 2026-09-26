// OWNER: L5 (juice). Comic onomatopoeia: which word (if any) a GameEvent pops, with per-entity cooldowns so the
// screen celebrates big moments without turning into word soup. Pure logic (tested in fx-onomatopoeia.test.ts);
// the canvas-atlas billboards that draw the words live in onomatopoeia-view.ts.
import type { GameEvent } from '../../shared/protocol';
import { Species } from '../../shared/types';
import type { WeaponFxId } from './weapon-fx';

/** Every word in the atlas. Original, generic comic sound words (theme strings; swap per theme). */
export const WORDS = [
  'POW!', 'BARK!', 'HISS!', 'SQUEAK!', 'BOING!', 'KA-BOOM!', 'SPLAT!', 'BONK!', 'POOF!', 'ZAP!',
  'THWUMP!', 'WHOOSH!', 'SNAP!', 'YOINK!', 'WOOF!', 'MROW!', 'FSSHH!', 'KO!',
] as const;
export type Word = (typeof WORDS)[number];

export interface WordPick { word: Word; /** Relative size (1 = normal). */ scale: number }

export interface WordContext {
  localId: number;
  /** Seconds (monotonic). */
  now: number;
  /** Species of an entity, or -1 when unknown. */
  speciesOf(id: number): number;
  weaponOf(wpn: number): WeaponFxId;
  /** Uniform random in [0,1) for variety (injected so tests are deterministic). */
  rand(): number;
}

const FIRE_WORDS: Partial<Record<WeaponFxId, { word: Word; cooldown: number; chance: number }>> = {
  squeaker_rifle: { word: 'SQUEAK!', cooldown: 2.5, chance: 0.35 },
  snap_pistol: { word: 'SNAP!', cooldown: 2, chance: 0.4 },
  laser_longshot: { word: 'ZAP!', cooldown: 0.8, chance: 1 },
  tennis_mortar: { word: 'THWUMP!', cooldown: 1, chance: 1 },
  sprinkler_cannon: { word: 'FSSHH!', cooldown: 2.2, chance: 1 },
  frisbee_launcher: { word: 'WHOOSH!', cooldown: 1.5, chance: 1 },
};

const ABILITY_WORDS: Record<string, Word> = {
  bark_blast: 'BARK!', shadow_cloak: 'POOF!', spotter_drone: 'ZAP!', dig_charge: 'BONK!', squeak_barrier: 'SQUEAK!', ear_glide: 'WHOOSH!',
};

export class OnomatopoeiaPicker {
  /** key = category * 2^20 + entity id → next allowed time. Map reuse keeps this allocation-free per event. */
  private next = new Map<number, number>();

  private ready(cat: number, id: number, now: number, cooldown: number): boolean {
    const key = cat * 1048576 + (id & 1048575);
    const t = this.next.get(key);
    if (t !== undefined && now < t) return false;
    this.next.set(key, now + cooldown);
    return true;
  }

  reset(): void { this.next.clear(); }

  pick(ev: GameEvent, c: WordContext): WordPick | null {
    switch (ev.e) {
      case 'hit':
        if (ev.crit) return this.ready(1, ev.dst, c.now, 0.3) ? { word: c.rand() < 0.5 ? 'POW!' : 'BONK!', scale: 1.15 } : null;
        if (ev.dmg >= 25 && this.ready(2, ev.dst, c.now, 0.8)) return { word: 'SPLAT!', scale: 0.95 };
        return null;
      case 'death':
        return ev.by === c.localId && ev.id !== c.localId ? { word: 'KO!', scale: 1.35 } : { word: 'POOF!', scale: 1.05 };
      case 'explode':
        return { word: 'KA-BOOM!', scale: 1.2 + Math.min(0.8, ev.r * 0.1) };
      case 'jump':
        return ev.double && this.ready(3, ev.id, c.now, 1.5) ? { word: 'BOING!', scale: 0.85 } : null;
      case 'land':
        return ev.impact >= 14 && this.ready(4, ev.id, c.now, 1) ? { word: 'THWUMP!', scale: 0.8 + Math.min(0.5, (ev.impact - 14) * 0.04) } : null;
      case 'bark': {
        if (!this.ready(5, ev.id, c.now, 1.2)) return null;
        const cat = c.speciesOf(ev.id) === Species.Cat;
        const alt = c.rand() < 0.35;
        return { word: cat ? (alt ? 'MROW!' : 'HISS!') : alt ? 'WOOF!' : 'BARK!', scale: 1 };
      }
      case 'fire': {
        const rule = FIRE_WORDS[c.weaponOf(ev.wpn)];
        if (!rule) return null;
        if (c.rand() >= rule.chance) return null;
        return this.ready(6, ev.id, c.now, rule.cooldown) ? { word: rule.word, scale: 0.8 } : null;
      }
      case 'pickup':
        return ev.id === c.localId ? { word: 'YOINK!', scale: 0.85 } : null;
      case 'ability': {
        const w = ABILITY_WORDS[ev.ability];
        return w && this.ready(7, ev.id, c.now, 0.5) ? { word: w, scale: ev.ability === 'bark_blast' ? 1.5 : 1.1 } : null;
      }
      default:
        return null; // spawn, score, reload: HUD + audio carry these
    }
  }
}
