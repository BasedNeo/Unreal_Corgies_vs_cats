// OWNER: world lane (L2). World-driven sim systems (order 250 = after movement, before the physics
// step): trampoline jump pads, wading water, out-of-bounds guard.
//
// stepWorldEffects() is a pure per-entity function (like stepCharacter) so client-side prediction
// can call it right after stepCharacter() for the local player and stay in sync with the authority.
import type { SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import type { GameEvent } from '../../shared/protocol';
import type { WorldData } from '../../shared/world/world-data';
import { jumpPadAt, waterAt } from '../../shared/world/queries';
import { TICK_DT } from '../../shared/constants';

export interface WorldEffectResult {
  /** Jump pad id if the entity was launched this tick. */
  bounced: string | null;
  /** True while wading (drag applied). */
  wading: boolean;
  /** True if the entity left the playable bounds (caller should respawn it). */
  outOfBounds: boolean;
}

/**
 * Apply map effects to one character after its movement step.
 * - Jump pad: grounded on a pad -> vel.y = pad.vy (one double jump stays available), emits 'jump'.
 * - Water: feet below surface - 0.1 inside a water zone -> horizontal velocity keeps `drag` per 60 Hz
 *   tick, which caps wading speed near groundAccel*dt/(1-drag) (~3 m/s for the pond, sprint included).
 * - Bounds: reports when the entity is outside data.bounds or below killY + 2.
 */
export function stepWorldEffects(data: WorldData, e: SimEntity, dt: number, emit?: (ev: GameEvent) => void): WorldEffectResult {
  const r: WorldEffectResult = { bounced: null, wading: false, outOfBounds: false };
  const c = e.char;
  if (!c || e.dead) return r;
  const { x, y, z } = e.pos;
  const b = data.bounds;
  if (b && (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ)) r.outOfBounds = true;
  if (y < data.killY + 2) r.outOfBounds = true;

  if (c.grounded && e.vel.y <= 0.01) {
    const pad = jumpPadAt(data, x, y, z);
    if (pad) {
      e.vel.y = pad.vy;
      c.grounded = false;
      c.jumpsUsed = 1;                  // the bounce counts as the first jump: a double jump remains
      c.airTime = c.move.coyoteTime;    // no coyote jump off the pad
      c.jumpBuffer = 0;
      r.bounced = pad.id;
      emit?.({ e: 'jump', id: e.id, double: false });
    }
  }

  const w = waterAt(data, x, z);
  if (w && y < w.surfaceY - 0.1) {
    const keep = Math.pow(w.drag, dt / TICK_DT);
    e.vel.x *= keep;
    e.vel.z *= keep;
    if (e.vel.y < -6) e.vel.y = -6;     // water breaks falls
    r.wading = true;
  }
  return r;
}

export const worldEffectsSystem: SimSystem = {
  name: 'world-effects',
  order: 250,
  update(sim, dt) {
    const data = sim.worldData;
    const emit = (ev: GameEvent) => sim.emit(ev);
    for (const e of sim.entities.values()) {
      if (e.dead || !e.char) continue;
      const res = stepWorldEffects(data, e, dt, emit);
      if (res.outOfBounds) {
        const s = sim.pickSpawn(e.team);
        sim.placeCharacter(e, s.x, s.y, s.z);
      }
    }
  },
};

export function worldSystems(): SimSystem[] {
  return [worldEffectsSystem];
}
