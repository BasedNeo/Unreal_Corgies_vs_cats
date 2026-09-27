// W9 F2 (mode-1, Q4 P2-2): a parked kart is an obstacle bots walk around. A riderless kart that has been at rest
// PARK_TICKS registers its footprint as a nav fixture of this sim (ai/nav.ts setNavFixture, as the kiosks do); the
// fixture goes when the kart moves off its spot, is mounted, destroyed, despawned or cleared by a restart. Without it,
// routes ran through gaps a parked kart closes (Q4: two bots pinned 8 and 11 s between an FOB box and a kart left in the
// corgis' capture ring). Cost: a check per kart per tick; the grid changes (a region relabel, 2-5 ms) only on a
// park or an unpark, a few times a match. The kart nav (drive.ts) follows the grid, so drivers route round it too.
import type { Sim } from '../sim';
import type { EntityId } from '../../shared/types';
import type { PropBox } from '../../shared/world/world-types';
import { setNavFixture } from '../ai/nav';
import { kartDef } from './state';

/** At rest (m/s), for this long (ticks: 1 s, so a vend-and-board at a kiosk never touches the grid). */
const PARK_SPEED = 0.3, PARK_TICKS = 60;
/** A parked kart shoved farther than this (m) re-registers where it now stands. */
const MOVE_EPS = 0.4;

interface Parked { still: number; boxes: PropBox[] | null; x: number; z: number }
const parked = new WeakMap<Sim, Map<EntityId, Parked>>();
const keyOf = (id: EntityId) => `kart:${id}`;

/** Called once per tick by the kart step (after every kart moved). */
export function syncParkedKarts(sim: Sim): void {
  let m = parked.get(sim);
  for (const kart of sim.entities.values()) {
    const k = kart.kart;
    if (!k || kart.removed) continue;
    if (!m) { m = new Map(); parked.set(sim, m); }
    let p = m.get(kart.id);
    if (!p) { p = { still: 0, boxes: null, x: 0, z: 0 }; m.set(kart.id, p); }
    const resting = k.rider < 0 && k.grounded && Math.hypot(kart.vel.x, kart.vel.z) < PARK_SPEED;
    p.still = resting ? p.still + 1 : 0;
    if (p.boxes && (!resting || Math.hypot(kart.pos.x - p.x, kart.pos.z - p.z) > MOVE_EPS)) {
      setNavFixture(sim, keyOf(kart.id), null);
      p.boxes = null;
    }
    if (!p.boxes && p.still >= PARK_TICKS) {
      const d = kartDef(kart);
      p.x = kart.pos.x; p.z = kart.pos.z;
      p.boxes = [{ type: 'parked_kart', x: p.x, y: kart.pos.y + d.halfHeight + 0.02, z: p.z, hx: d.radius, hy: d.halfHeight, hz: d.radius, rotY: 0 }];
      setNavFixture(sim, keyOf(kart.id), p.boxes);
    }
  }
  if (!m) return;
  // karts that are gone: destroyed, despawned after the abandon time, cleared by a match restart
  for (const [id, p] of m) {
    const kart = sim.entities.get(id);
    if (kart?.kart && !kart.removed) continue;
    if (p.boxes) setNavFixture(sim, keyOf(id), null);
    m.delete(id);
  }
}

/** Karts whose footprint is in the nav now (tests, telemetry). */
export function parkedKarts(sim: Sim): EntityId[] {
  const out: EntityId[] = [];
  for (const [id, p] of parked.get(sim) ?? []) if (p.boxes) out.push(id);
  return out;
}
