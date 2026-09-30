// OWNER: L5 (juice). Kill feed model: newest first, capped, entries expire. Pure (tested in ui-killfeed.test.ts).
// W10 U3: killGlyph() picks an entry's glyph from the death event's weapon (C10 `death.wpn`), falling back to the
// pre-W10 guesses when the authority didn't name one (tested in ui-killfeed-w10.test.ts).
import type { EntityState } from '../../shared/protocol';
import { EFlag, EntityKind } from '../../shared/types';
import { planeByIndex } from '../../shared/content/vehicles';
import { ordnanceByWire } from '../../shared/content/ordnance';
import { throwableGlyphId } from './icons';

/**
 * The glyph for a kill made from a vehicle seat: 'plane' (its ram or its gun) or 'kart' (a ram), else null. The killer's
 * last hand-held weapon would be stale: a seated pet doesn't fire it.
 */
export function seatedGlyph(states: ReadonlyMap<number, EntityState>, killer: number): 'plane' | 'kart' | null {
  const k = states.get(killer);
  if (!k || !(k.flags & EFlag.Mounted)) return null;
  for (const v of states.values()) if (v.kind === EntityKind.Vehicle && v.weapon === killer) return planeByIndex(v.cls) ? 'plane' : 'kart';
  return null;
}

export interface KillGlyphInput {
  /** A self-knockout (by = the victim, or by < 0: the yard, a fall). */
  self: boolean;
  /** The killer's `explode` event landed in the last 0.5 s (the pre-W10 blast guess). */
  exploded: boolean;
  /** seatedGlyph(states, killer): the killer rides a plane or a kart. */
  ride: 'plane' | 'kart' | null;
  /** W10 C10: `death.wpn`, the killing weapon's wire index (a gun, or a throwable ≥ ORDNANCE_RULES.wireBase). */
  wpn?: number;
  /** The killer's last `fire` event weapon (the pre-W10 guess). */
  lastWpn?: number;
  /** A gun's kill-feed glyph by wire index (the HUD's WeaponTable → WEAPON_FX glyph), null when the index is unknown. */
  gunGlyph(wpn: number): string | null;
}

/**
 * The kill-feed glyph of a knockout. The death event's own weapon wins:
 *   1. a throwable (death.wpn ≥ wireBase) → its glyph: the squeaker grenade or the hairball bomb, even on a self-knockout
 *      (a pet caught in its own blast);
 *   2. a self-knockout → the fall arrow;
 *   3. a gun (death.wpn) → the vehicle when the killer is seated (the plane's gun reports a hand gun), else that gun;
 *   4. no weapon (death.wpn absent or unknown: rams, abilities, bosses' swipes, old authorities) → exactly the pre-W10
 *      guesses: a blast, the vehicle, the killer's last fired gun, else a paw.
 */
export function killGlyph(i: KillGlyphInput): string {
  const thrown = i.wpn !== undefined ? ordnanceByWire(i.wpn) : null;
  if (thrown) return throwableGlyphId(thrown.id);
  if (i.self) return 'fall';
  const gun = i.wpn !== undefined && i.wpn >= 0 ? i.gunGlyph(i.wpn) : null;
  if (gun) return i.ride ?? gun;
  if (i.exploded) return 'boom';
  return i.ride ?? (i.lastWpn !== undefined ? i.gunGlyph(i.lastWpn) ?? 'paw' : 'paw');
}

export interface FeedParty { /** Entity id (lets the view re-resolve names once the roster arrives). */ id: number; name: string; team: number; local: boolean; bot: boolean }

export interface KillEntry {
  id: number;
  /** Seconds (monotonic) when it was added. */
  t: number;
  killer: FeedParty | null;
  victim: FeedParty;
  /** Weapon/cause glyph id (ui/icons.ts). */
  glyph: string;
  crit: boolean;
}

export class KillFeed {
  readonly max: number;
  readonly ttl: number;
  private list: KillEntry[] = [];
  private nextId = 1;
  /** Bumps on every change so the view knows when to re-render. */
  version = 0;

  constructor(max = 5, ttl = 6) { this.max = max; this.ttl = ttl; }

  get entries(): readonly KillEntry[] { return this.list; }

  push(e: Omit<KillEntry, 'id' | 't'>, now: number): KillEntry {
    const entry: KillEntry = { ...e, id: this.nextId++, t: now };
    this.list.unshift(entry);
    if (this.list.length > this.max) this.list.length = this.max;
    this.version++;
    return entry;
  }

  /** Drops expired entries; entries involving the local player linger 50% longer. Returns true if changed. */
  prune(now: number): boolean {
    const before = this.list.length;
    this.list = this.list.filter((e) => now - e.t < this.ttl * (e.victim.local || e.killer?.local ? 1.5 : 1));
    if (this.list.length !== before) { this.version++; return true; }
    return false;
  }

  clear(): void { if (this.list.length) { this.list = []; this.version++; } }
}
