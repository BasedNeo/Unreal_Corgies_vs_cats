// The authoritative game simulation. Runs identically in a Web Worker (offline/local play),
// in Node (online server) and in unit tests. No Three.js, no DOM, no Math.random().
import type { World, KinematicCharacterController } from '@dimforge/rapier3d-compat';
import { loadRapier, type Rapier, CHARACTER_GROUPS } from './rapier';
import type { SimEntity } from './entity';
import { type ClassId, type EntityId, type EntityKindId, type SpeciesId, type TeamId, Anim, EFlag, EntityKind, CLASS_IDS } from '../shared/types';
import { emptyInput, type InputCmd } from '../shared/input';
import { TICK_DT, GRAVITY } from '../shared/constants';
import { mulberry32 } from '../shared/rng';
import { moveStatsFor, CLASSES } from '../shared/content/classes';
import type { EntityState, GameEvent } from '../shared/protocol';
import { createWorldData, type WorldData } from '../shared/world/world-data';
import { buildSimWorld } from './world/build';
import { createDefaultSystems } from './systems';

export interface SimSystem {
  name: string;
  /** Lower runs first. Convention: 100 ai, 200 movement, 300 physics step, 400 weapons, 500 projectiles, 600 damage/death, 700 respawn, 800 match. */
  order: number;
  init?(sim: Sim): void;
  update(sim: Sim, dt: number): void;
}

export interface SimOptions {
  seed?: number;
  world?: WorldData;
  /** Override the system list (tests). */
  systems?: SimSystem[];
}

export interface SpawnCharacterOptions {
  kind?: EntityKindId;
  team: TeamId;
  species: SpeciesId;
  cls: ClassId;
  name: string;
  ownerPid?: string | null;
  seed?: number;
  x?: number; y?: number; z?: number; yaw?: number;
}

export class Sim {
  readonly R: Rapier;
  readonly world: World;
  readonly kcc: KinematicCharacterController;
  readonly worldData: WorldData;
  readonly rng: () => number;
  readonly seed: number;
  tick = 0;
  time = 0;
  readonly entities = new Map<EntityId, SimEntity>();
  /** Entity ids removed since the last snapshot. */
  readonly removedIds: EntityId[] = [];
  private events: GameEvent[] = [];
  private nextId = 1;
  private systems: SimSystem[];
  /** Arbitrary shared state for systems (match rules, waves...). Plain data only. */
  readonly state: Record<string, unknown> = {};

  private constructor(R: Rapier, opts: SimOptions) {
    this.R = R;
    this.seed = opts.seed ?? 1;
    this.rng = mulberry32(this.seed);
    this.world = new R.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = TICK_DT;
    this.kcc = this.world.createCharacterController(0.02);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.enableAutostep(0.45, 0.2, true);
    this.kcc.enableSnapToGround(0.35);
    this.kcc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((58 * Math.PI) / 180);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.worldData = opts.world ?? createWorldData(this.seed);
    buildSimWorld(this);
    this.systems = [...(opts.systems ?? createDefaultSystems())].sort((a, b) => a.order - b.order);
    for (const s of this.systems) s.init?.(this);
  }

  static async create(opts: SimOptions = {}): Promise<Sim> {
    const R = await loadRapier();
    return new Sim(R, opts);
  }

  allocId(): EntityId {
    return this.nextId++;
  }

  emit(ev: GameEvent): void {
    this.events.push(ev);
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  addSystem(s: SimSystem): void {
    this.systems.push(s);
    this.systems.sort((a, b) => a.order - b.order);
    s.init?.(this);
  }

  spawnCharacter(o: SpawnCharacterOptions): SimEntity {
    const move = moveStatsFor(o.species, o.cls);
    const id = this.allocId();
    const spawn = o.x !== undefined ? { x: o.x, y: o.y ?? 0, z: o.z ?? 0, yaw: o.yaw ?? 0 } : this.pickSpawn(o.team);
    const e: SimEntity = {
      id, kind: o.kind ?? EntityKind.Player, team: o.team, species: o.species, cls: o.cls,
      seed: o.seed ?? Math.floor(this.rng() * 1e9), name: o.name,
      pos: { x: spawn.x, y: spawn.y, z: spawn.z }, vel: { x: 0, y: 0, z: 0 },
      yaw: spawn.yaw, pitch: 0, collider: null,
      input: { ...emptyInput(0), yaw: spawn.yaw }, prevButtons: 0, lastInputSeq: 0,
      char: { move, grounded: false, airTime: 0, jumpBuffer: 0, jumpsUsed: 0, jumpHeld: false, landImpact: 0, sprinting: false, slideTime: 0, slideCooldown: 0, pounding: false, restX: NaN, restY: NaN, restZ: NaN },
      health: { hp: CLASSES[o.cls].maxHp, max: CLASSES[o.cls].maxHp, lastDamageTick: -9999, lastAttacker: -1 },
      anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
      ownerPid: o.ownerPid ?? null, removed: false, data: {},
    };
    const R = this.R;
    const cd = R.ColliderDesc.capsule(move.capsuleHalfHeight, move.capsuleRadius)
      .setTranslation(e.pos.x, e.pos.y + move.capsuleHalfHeight + move.capsuleRadius, e.pos.z)
      .setCollisionGroups(CHARACTER_GROUPS);
    e.collider = this.world.createCollider(cd);
    e.collider.setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT | R.ActiveCollisionTypes.KINEMATIC_FIXED);
    (e.collider as unknown as { __entityId: number }).__entityId = id;
    this.entities.set(id, e);
    this.emit({ e: 'spawn', id });
    return e;
  }

  /** Map a Rapier collider back to its entity (for hit detection). */
  entityOfCollider(c: { handle: number } | null | undefined): SimEntity | null {
    if (!c) return null;
    const id = (c as unknown as { __entityId?: number }).__entityId;
    return id !== undefined ? this.entities.get(id) ?? null : null;
  }

  pickSpawn(team: TeamId): { x: number; y: number; z: number; yaw: number } {
    const pts = this.worldData.spawns.filter((s) => s.team === team);
    const list = pts.length ? pts : this.worldData.spawns;
    // Prefer the spawn farthest from living enemies.
    let best = list[0], bestScore = -Infinity;
    for (const s of list) {
      let nearest = Infinity;
      for (const e of this.entities.values()) {
        if (e.dead || e.team === team || !e.char) continue;
        nearest = Math.min(nearest, Math.hypot(e.pos.x - s.x, e.pos.z - s.z));
      }
      const score = nearest + this.rng() * 2;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return { x: best.x, y: best.y, z: best.z, yaw: best.yaw };
  }

  /** Move a character's feet to a position immediately (teleport/respawn). */
  placeCharacter(e: SimEntity, x: number, y: number, z: number): void {
    e.pos.x = x; e.pos.y = y; e.pos.z = z;
    e.vel.x = e.vel.y = e.vel.z = 0;
    if (e.collider && e.char) {
      const m = e.char.move;
      e.collider.setTranslation({ x, y: y + m.capsuleHalfHeight + m.capsuleRadius, z });
    }
  }

  removeEntity(id: EntityId): void {
    const e = this.entities.get(id);
    if (!e) return;
    if (e.collider) this.world.removeCollider(e.collider, false);
    e.removed = true;
    this.entities.delete(id);
    this.removedIds.push(id);
  }

  setInput(id: EntityId, cmd: InputCmd): void {
    const e = this.entities.get(id);
    if (!e) return;
    e.input = cmd;
    e.lastInputSeq = cmd.seq;
  }

  step(): void {
    const dt = TICK_DT;
    for (const s of this.systems) s.update(this, dt);
    for (const e of this.entities.values()) e.prevButtons = e.input.buttons;
    this.tick++;
    this.time += dt;
  }

  toState(e: SimEntity): EntityState {
    return {
      id: e.id, kind: e.kind, team: e.team, species: e.species,
      cls: e.cls ? CLASS_IDS.indexOf(e.cls) : -1, seed: e.seed,
      x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: e.yaw, pitch: e.pitch,
      vx: e.vel.x, vy: e.vel.y, vz: e.vel.z,
      hp: e.health?.hp ?? 0, maxHp: e.health?.max ?? 0,
      anim: e.anim, flags: e.flags | (e.dead ? EFlag.Dead : 0), weapon: e.weapon, ammo: e.ammo,
    };
  }

  snapshotEntities(): EntityState[] {
    const out: EntityState[] = [];
    for (const e of this.entities.values()) out.push(this.toState(e));
    return out;
  }

  dispose(): void {
    this.world.free();
  }
}
