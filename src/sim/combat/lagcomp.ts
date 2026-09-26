// Lag compensation. Every tick (order 850, after combat, respawns and match placement) each
// character's feet position is recorded under the snapshot tick that will carry it (sim.tick + 1).
// When a player's shot arrives with InputCmd.rt (the server tick the client was rendering remote
// entities at), hitscan tests use the targets' capsules as they were at rt, clamped to at most
// COMBAT_RULES.maxRewind seconds back. Rewinding is done on copies, so nothing needs restoring.
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { COMBAT_RULES } from '../../shared/content/weapons';
import { ticksOf } from './state';

const N = COMBAT_RULES.historyTicks;
export const MAX_REWIND_TICKS = ticksOf(COMBAT_RULES.maxRewind);

/** Snapshot tick label of the state currently being simulated. */
export function currentStateTick(sim: Sim): number {
  return sim.tick + 1;
}

/** Clamp an untrusted render tick into the allowed rewind range; returns the tick to test against. */
export function rewindTick(sim: Sim, rt: number): number {
  const now = currentStateTick(sim);
  if (!rt || rt >= now) return now;
  return Math.max(rt, now - MAX_REWIND_TICKS);
}

function record(e: SimEntity, tick: number): void {
  let h = e.lag;
  if (!h) {
    h = { ticks: new Int32Array(N).fill(-1), xyz: new Float32Array(N * 3), alive: new Uint8Array(N) };
    e.lag = h;
  }
  const i = tick % N;
  h.ticks[i] = tick;
  h.xyz[i * 3] = e.pos.x; h.xyz[i * 3 + 1] = e.pos.y; h.xyz[i * 3 + 2] = e.pos.z;
  h.alive[i] = e.dead ? 0 : 1;
}

export const lagRecordSystem: SimSystem = {
  name: 'lag-record',
  order: 850,
  update(sim) {
    const tick = currentStateTick(sim);
    for (const e of sim.entities.values()) if (e.char) record(e, tick);
  },
};

/** Reusable list of hittable characters with (possibly rewound) feet positions. */
export class TargetSet {
  n = 0;
  ents: SimEntity[] = [];
  x = new Float64Array(64);
  y = new Float64Array(64);
  z = new Float64Array(64);

  private push(e: SimEntity, x: number, y: number, z: number): void {
    if (this.n >= this.x.length) {
      const grow = (a: Float64Array) => { const b = new Float64Array(a.length * 2); b.set(a); return b; };
      this.x = grow(this.x); this.y = grow(this.y); this.z = grow(this.z);
    }
    this.ents[this.n] = e;
    this.x[this.n] = x; this.y[this.n] = y; this.z[this.n] = z;
    this.n++;
  }

  /**
   * Fill with every living character the shooter may damage (friendly fire off => enemies only),
   * positioned as they were at `tick` (current positions when tick is the current state tick or no
   * history exists). Characters that were dead at `tick` are skipped.
   */
  fill(sim: Sim, shooter: SimEntity, tick: number, friendlyFire: boolean): void {
    this.n = 0;
    const now = currentStateTick(sim);
    for (const e of sim.entities.values()) {
      if (!e.char || e.dead || e === shooter) continue;
      if (!friendlyFire && e.team === shooter.team) continue;
      if (tick < now && e.lag) {
        const i = tick % N;
        const h = e.lag;
        if (h.ticks[i] === tick) {
          if (!h.alive[i]) continue;
          this.push(e, h.xyz[i * 3], h.xyz[i * 3 + 1], h.xyz[i * 3 + 2]);
          continue;
        }
      }
      this.push(e, e.pos.x, e.pos.y, e.pos.z);
    }
  }
}
