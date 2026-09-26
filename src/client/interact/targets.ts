// Pure client-side interaction logic (no three, no DOM): which thing an Interact press would use right now
// (for the contextual prompt and the Ordnance Kiosk picker), and the local buff/kibble tracker fed by
// `pickup` events. Presentation only — the authority decides every outcome.
import type { EntityState, GameEvent } from '../../shared/protocol';
import { EFlag, EntityKind, type TeamId } from '../../shared/types';
import { TERMINALS, terminalKindAt } from '../../shared/content/terminals';
import { VEHICLES, vehicleByIndex } from '../../shared/content/vehicles';
import { CORE_FLAGS, CORE_IDS, PICKUPS, isCore, type CoreId } from '../../shared/content/pickups';
import { objectiveChainByIndex, type ObjectiveChain } from '../../shared/content/objectives';

export type InteractKind = 'ordnance' | 'kart_terminal' | 'kart' | 'dismount' | 'objective';

export interface InteractTarget {
  kind: InteractKind;
  /** Entity the prompt is about (kiosk, kart, beacon). */
  id: number;
  /** Prompt text without the key ("change kit", "vend a kart", "hop in", "grab the Squeaker"). */
  verb: string;
  /** False when the thing is there but unavailable (cooling kiosk): the prompt shows `verb` greyed. */
  ready: boolean;
  /** Horizontal distance (m). */
  dist: number;
  x: number; y: number; z: number;
}

const ORD = TERMINALS.ordnance_terminal;
const KART_T = TERMINALS.kart_terminal;

/** The objective step a beacon state shows, or null (inactive / complete). */
export function beaconStep(s: EntityState): { chain: ObjectiveChain; index: number } | null {
  const chain = objectiveChainByIndex(s.cls);
  if (!chain || s.weapon < 0 || s.weapon >= chain.steps.length) return null;
  return { chain, index: s.weapon };
}

/**
 * What Interact (E) would do for the local character, mirroring the authority's rules: seated → hop out;
 * else the nearest empty, slow kart in reach → hop in; an objective interact step in reach; own-team kiosks
 * in reach (Ordnance Kiosk → change kit, Kart-O-Matic → vend a kart). Nearest wins within a tier.
 */
export function findInteractTarget(states: ReadonlyMap<number, EntityState>, local: EntityState | null | undefined): InteractTarget | null {
  if (!local || (local.flags & EFlag.Dead) || (local.kind !== EntityKind.Player && local.kind !== EntityKind.Bot)) return null;
  if (local.flags & EFlag.Mounted) {
    for (const s of states.values()) {
      if (s.kind === EntityKind.Vehicle && s.weapon === local.id) return { kind: 'dismount', id: s.id, verb: 'hop out', ready: true, dist: 0, x: s.x, y: s.y, z: s.z };
    }
    return null;
  }
  let best: InteractTarget | null = null;
  let bestTier = Infinity;
  const offer = (t: InteractTarget, tier: number) => {
    if (tier < bestTier || (tier === bestTier && t.dist < best!.dist)) { best = t; bestTier = tier; }
  };
  for (const s of states.values()) {
    const dist = Math.hypot(s.x - local.x, s.z - local.z);
    if (dist > 12) continue;
    const dy = Math.abs(local.y - s.y);
    if (s.kind === EntityKind.Vehicle) {
      const d = vehicleByIndex(s.cls) ?? VEHICLES.mower_kart;
      if (s.weapon >= 0 || s.hp <= 0 || Math.hypot(s.vx, s.vz) > d.mountMaxSpeed || dy > 1.6 || dist > d.mountRange) continue;
      offer({ kind: 'kart', id: s.id, verb: 'hop in', ready: true, dist, x: s.x, y: s.y, z: s.z }, 0);
    } else if (s.kind === EntityKind.Prop) {
      const b = beaconStep(s);
      const t = b?.chain.steps[b.index].trigger;
      if (!b || !t || t.type !== 'interact' || b.chain.team !== local.team) continue;
      if (dist > t.params.radius || local.y < s.y - 2 || local.y > s.y + 9) continue;
      offer({ kind: 'objective', id: s.id, verb: t.params.prompt, ready: true, dist, x: s.x, y: s.y, z: s.z }, 1);
    } else if (s.kind === EntityKind.Terminal) {
      if (s.team !== local.team) continue;
      if (terminalKindAt(s.cls) === 'ordnance') {
        if (dist > ORD.useRange || dy > ORD.maxDy) continue;
        offer({ kind: 'ordnance', id: s.id, verb: 'change kit', ready: true, dist, x: s.x, y: s.y, z: s.z }, 2);
      } else {
        if (dist > KART_T.useRange || dy > 2) continue;
        const busy = (s.flags & EFlag.Busy) !== 0;
        const verb = !busy ? 'vend a kart' : s.weapon >= 0 ? 'kart is out' : `cooling ${Math.max(1, s.ammo)} s`;
        offer({ kind: 'kart_terminal', id: s.id, verb, ready: !busy, dist, x: s.x, y: s.y, z: s.z }, 2);
      }
    }
  }
  return best;
}

/** Is the local character standing at one of its own team's Ordnance Kiosks? (closes the picker when not) */
export function atOwnOrdnanceKiosk(states: ReadonlyMap<number, EntityState>, local: EntityState | null | undefined, slack = 0.6): boolean {
  if (!local) return false;
  for (const s of states.values()) {
    if (s.kind !== EntityKind.Terminal || s.team !== local.team || terminalKindAt(s.cls) !== 'ordnance') continue;
    if (Math.hypot(s.x - local.x, s.z - local.z) <= ORD.useRange + slack && Math.abs(local.y - s.y) <= ORD.maxDy) return true;
  }
  return false;
}

export interface TrackedBuff { id: CoreId; until: number; duration: number; /** When it was added (s). */ added?: number }

/**
 * Local presentation of timed buffs + kibble count. Timers come from `pickup` events; which buffs run comes
 * from the snapshot flags (EFlag.Buff*, via `syncFlags`). Times are in the caller's clock (seconds).
 */
const SYNC_GRACE = 0.6;

export class BuffTracker {
  readonly buffs = new Map<number, TrackedBuff[]>();
  kibble = 0;

  onEvent(ev: GameEvent, now: number, localId: number): void {
    if (ev.e === 'pickup') {
      if (isCore(ev.item)) {
        const list = this.buffs.get(ev.id) ?? [];
        const d = PICKUPS[ev.item].duration;
        const cur = list.find((b) => b.id === ev.item);
        if (cur) { cur.until = now + d; cur.added = now; }
        else list.push({ id: ev.item, until: now + d, duration: d, added: now });
        this.buffs.set(ev.id, list);
      } else if (ev.item === 'golden_kibble' && ev.id === localId) this.kibble++;
    } else if (ev.e === 'death') this.buffs.delete(ev.id);
    else if (ev.e === 'score' && ev.reason === 'reset') { this.buffs.clear(); this.kibble = 0; }
    else if (ev.e === 'score' && ev.reason === 'win') this.buffs.clear(); // match over: cores end
  }

  /**
   * The snapshot flags are the truth for WHICH buffs run: add one a late joiner never saw an event for (its timer
   * is unknown, so it shows the full duration), drop one that ended early. Interpolated states lag the pickup event
   * by ~0.1 s, so an event-added buff gets a short grace before a clear flag removes it.
   */
  syncFlags(id: number, flags: number, now: number): void {
    let list = this.buffs.get(id);
    for (const core of CORE_IDS) {
      const on = (flags & CORE_FLAGS[core]) !== 0;
      const cur = list?.find((b) => b.id === core);
      if (on && !cur) {
        list ??= [];
        const d = PICKUPS[core].duration;
        list.push({ id: core, until: now + d, duration: d, added: now });
        this.buffs.set(id, list);
      } else if (!on && cur && now - (cur.added ?? -Infinity) > SYNC_GRACE) list!.splice(list!.indexOf(cur), 1);
    }
  }

  /** Active buffs of an entity at `now` (expired ones dropped). */
  active(id: number, now: number): TrackedBuff[] {
    const list = this.buffs.get(id);
    if (!list) return [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].until <= now) list.splice(i, 1);
    if (!list.length) this.buffs.delete(id);
    return list;
  }

  /** Forget entities that left the snapshot. */
  prune(states: ReadonlyMap<number, EntityState>): void {
    for (const id of this.buffs.keys()) if (!states.has(id)) this.buffs.delete(id);
  }
}

export type { TeamId };
