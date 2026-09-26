// X1 destructibles: the entity component, the per-Sim runtime and collider bookkeeping.
//
// Snapshot convention (EntityState, EntityKind.Destructible):
//   team = Neutral · species 0 · cls -1 · seed = index into WorldData.destructibles (the client's view looks the
//   def up there) · x,y,z = the def's anchor (ground under its center) · yaw = the def's yaw · hp/maxHp = health
//   (0 once broken) · flags & EFlag.Busy = BROKEN · ammo = times it has broken (a re-break after a reset reads as a
//   new break) · weapon -1.
import type { Collider } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import type { EntityId, TeamId } from '../../shared/types';
import type { Destructible, DestructKind, PropBox } from '../../shared/world/world-types';
import type { DestructRule } from '../../shared/world/destructibles';
import { WORLD_GROUPS } from '../rapier';
import { quatYXZ } from '../../shared/world/queries';
import { markDestructibleCollider } from './tag';

export interface DestructState {
  /** Index into WorldData.destructibles (= EntityState.seed). */
  index: number;
  def: Destructible;
  rule: DestructRule;
  /** Live colliders while standing (empty once broken). */
  colliders: Collider[];
  broken: boolean;
  /** Times it has broken (EntityState.ammo). */
  breaks: number;
  /** Tick of the last break (-1 never) and who caused it (-1 unknown / scripted). */
  brokeTick: number;
  brokeBy: EntityId;
}

declare module '../entity' {
  interface SimEntity {
    dsx?: DestructState;
  }
}

/** One break, for objectives (adventure `destroy` triggers), barks and tools. */
export interface BreakRecord {
  /** Entity id and def. */
  id: EntityId;
  defId: string;
  tag: string;
  kind: DestructKind;
  by: EntityId;
  byTeam: TeamId | -1;
  tick: number;
  /** True when a script broke it silently (checkpoint restore), not a player. */
  scripted: boolean;
}

export interface DestructRuntime {
  /** Destructible entities in WorldData.destructibles order. */
  list: SimEntity[];
  /** Hitscan `fire` events already applied (tests may step many ticks without draining events). */
  seen: WeakSet<object>;
  /** Dig Charges already checked for a breaching fuse. */
  charges: WeakSet<SimEntity>;
  /** Match restart detection (a new MatchState object, or ended -> anything else). */
  matchRef: unknown;
  lastPhase: string;
  /** Breaks since the last drainBreaks() (bounded). */
  breaks: BreakRecord[];
}

const runtimes = new WeakMap<Sim, DestructRuntime>();

export function destructRuntime(sim: Sim): DestructRuntime | undefined {
  return runtimes.get(sim);
}

export function createDestructRuntime(sim: Sim): DestructRuntime {
  const rt: DestructRuntime = { list: [], seen: new WeakSet(), charges: new WeakSet(), matchRef: undefined, lastPhase: '', breaks: [] };
  runtimes.set(sim, rt);
  return rt;
}

/** Nav blocker key of a destructible. */
export const navKey = (def: Destructible) => `destruct:${def.id}`;

/** A fixed World-layer cuboid for one of a destructible's boxes (same build as buildStaticWorld's props). */
export function createBoxCollider(sim: Sim, b: PropBox, entityId: EntityId): Collider {
  const c = sim.world.createCollider(sim.R.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
    .setTranslation(b.x, b.y, b.z)
    .setRotation(quatYXZ(b.pitch ?? 0, b.rotY, b.roll ?? 0))
    .setCollisionGroups(WORLD_GROUPS));
  markDestructibleCollider(c, entityId);
  return c;
}
