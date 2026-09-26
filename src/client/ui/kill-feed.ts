// OWNER: L5 (juice). Kill feed model: newest first, capped, entries expire. Pure (tested in ui-killfeed.test.ts).
import type { EntityState } from '../../shared/protocol';
import { EFlag, EntityKind } from '../../shared/types';
import { planeByIndex } from '../../shared/content/vehicles';

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
