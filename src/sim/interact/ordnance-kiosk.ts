// W9 X4 (arms-2): the Ordnance Kiosk restocks your throwable. Automatic: stand at your OWN team's kiosk (the same
// reach as its E prompt and kit picker, so S1's class-picker flow is untouched: E still opens the picker) without one,
// alive and on foot, once ORDNANCE_RULES.restockCooldown has passed since your last throw → one throwable and a
// `pickup` event (item = the ordnance id: the HUD says "Picked up squeaker grenade", a chime, a sparkle). The cooldown
// runs from the throw, so a kiosk is never a grenade fountain: one per restockCooldown per pet, at most one carried.
//
// A leaf module on purpose (no runtime import of interact/ordnance.ts, which imports combat): the combat lane's ordnance
// system calls restockAtKiosk() every tick for characters without one. ownKioskFor() is ordnanceTerminalFor()'s rule
// (own team, |dy| ≤ maxDy, horizontal distance ≤ useRange, nearest wins); tests/unit/ordnance-sim.test.ts proves they
// agree everywhere around a kiosk.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { EFlag } from '../../shared/types';
import { TERMINALS } from '../../shared/content/terminals';
import { ordnanceFor } from '../../shared/content/ordnance';
import type { OrdnanceCarry } from '../combat/ordnance';

const DEF = TERMINALS.ordnance_terminal;
/** Kiosks are fixtures placed by the interaction layer on its first tick: re-scan for them this often. */
const RESCAN_TICKS = 60;

interface KioskCache { tick: number; list: SimEntity[] }
const caches = new WeakMap<Sim, KioskCache>();

/** The Ordnance Kiosk entities of this sim (cached; re-scanned every second). */
export function kiosksOf(sim: Sim): readonly SimEntity[] {
  let c = caches.get(sim);
  if (!c) { c = { tick: -Infinity, list: [] }; caches.set(sim, c); }
  if (sim.tick - c.tick >= RESCAN_TICKS) {
    c.tick = sim.tick;
    c.list.length = 0;
    for (const t of sim.entities.values()) if (t.ordnance && !t.removed) c.list.push(t);
  }
  return c.list;
}

/** The own-team kiosk `c` stands at (ordnanceTerminalFor's rule), or null. */
export function ownKioskFor(sim: Sim, c: SimEntity): SimEntity | null {
  const list = kiosksOf(sim);
  let best: SimEntity | null = null, bd = Infinity;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.removed || t.team !== c.team) continue;
    if (Math.abs(c.pos.y - t.pos.y) > DEF.maxDy) continue;
    const d = Math.hypot(c.pos.x - t.pos.x, c.pos.z - t.pos.z);
    if (d <= DEF.useRange && d < bd) { bd = d; best = t; }
  }
  return best;
}

/** Restock `c` at its own kiosk when the rules allow it. True when it got one. */
export function restockAtKiosk(sim: Sim, c: SimEntity, st: OrdnanceCarry): boolean {
  if (st.carry || c.dead || !c.char || c.flags & EFlag.Mounted || sim.tick < st.restockAt) return false;
  if (!ownKioskFor(sim, c)) return false;
  st.carry = true;
  st.armed = false;
  st.restocks++;
  c.flags |= EFlag.Ordnance;
  sim.emit({ e: 'pickup', id: c.id, item: ordnanceFor(c.species).id });
  return true;
}
