// Network-precision quantization of predicted characters.
// Snapshots carry positions at 1 mm and velocities at 1 cm/s (packEntity). Rapier's character
// controller is sensitive to sub-millimetre differences near the ground (its 2 cm skin), so a client
// that rewinds to a rounded snapshot state would not reproduce the authority's future exactly.
// Instead, the authority rounds every player-controlled character to exactly the transmitted
// precision after each tick, and client prediction does the same after every predicted step:
// a snapshot is then an exact restart point and replays match the authority bit for bit.
import type { SimEntity } from '../sim/entity';
import { fieldScale } from './wire';

const SX = fieldScale('x'), SY = fieldScale('y'), SZ = fieldScale('z');
const SVX = fieldScale('vx'), SVY = fieldScale('vy'), SVZ = fieldScale('vz');
const q = (v: number, s: number) => (s ? Math.round(v * s) / s : v);
/** Height rounds UP: rounding to nearest parked resting characters exactly on the controller's 2 cm skin
 *  distance, where Rapier's KCC deadlocks on flat ground (QA W1 / lead repro: frozen at z=34.709). */
const qUp = (v: number, s: number) => (s ? Math.ceil(v * s - 1e-6) / s : v);

/** Round position and velocity to snapshot precision and move the collider to match. */
export function quantizeMotion(e: SimEntity): void {
  const x = q(e.pos.x, SX), y = qUp(e.pos.y, SY), z = q(e.pos.z, SZ);
  e.pos.x = x; e.pos.y = y; e.pos.z = z;
  e.vel.x = q(e.vel.x, SVX); e.vel.y = q(e.vel.y, SVY); e.vel.z = q(e.vel.z, SVZ);
  if (e.collider && e.char) {
    const m = e.char.move;
    // Same expression as Sim.placeCharacter, so a client reset lands on the identical collider pose.
    e.collider.setTranslation({ x, y: y + m.capsuleHalfHeight + m.capsuleRadius, z });
  }
}
