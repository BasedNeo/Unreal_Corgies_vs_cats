// W9 X4 (arms-2): throwable ordnance, authoritative. One per character (players and room bots; never wave cats or
// bosses), in the room modes ORDNANCE_RULES.modes lists (or `sim.state.ordnanceConfig = { enabled }` for tests/labs).
//
//   order 455  ordnance        in-flight throwables step (fuse → explode(), the combat lane's blast: damage with LOS
//                              and falloff, knockback, destructibles via the blast listeners); kiosk restocks; throws.
//                              Throw = Btn.Throw released after a press made while carrying (hold to aim, a tap
//                              throws too; edges from our own last-seen state, so Room catch-up can't swallow them). The launch comes from the character's own feet, yaw and pitch through the
//                              shared throwLaunch() (never a client vector), after: alive, carrying, not in a vehicle,
//                              not stunned, not taunting (emoteLock), the throw cooldown, combat live.
//   order 805  ordnance-life   after respawns (700) and match rules (800): spawn with one, lose it on death, get one on
//                              respawn, a match restart fizzles every one in flight and refills everybody; EFlag.Ordnance.
//
// A thrown one is an EntityKind.Projectile snapshot entity (see src/shared/content/ordnance.ts for the fields) from a
// per-sim pool; it steps with the shared stepBody() against Rapier (static world + vehicles, own-team barriers pass)
// with the collider-exact terrain backstop, and bounces off enemy characters (no damage: the blast is the damage).
// No sim.rng draws. Throw and flight allocate nothing after warm-up (tests/unit/ordnance-perf.test.ts).
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { held } from '../entity';
import { Anim, EFlag, EntityKind, type EntityId, type TeamId } from '../../shared/types';
import { Btn, emptyInput } from '../../shared/input';
import { TICK_DT } from '../../shared/constants';
import {
  FUSE_TICKS, HAND_BACKOFF, ORDNANCE, ORDNANCE_IDS, ORDNANCE_RULES, arcTerrain, arcWorldOf, launchBody, makeBody, makeLaunch, makeSegHit,
  ordnanceFor, ordnanceWire, stepBody, throwLaunch, type ArcWorld, type OrdBody, type SegHit, type SegQuery,
} from '../../shared/content/ordnance';
import { abilityDef } from '../../shared/content/abilities';
import type { ProjectileDef } from '../../shared/content/weapons';
import { explode } from './projectiles';
import { capsuleOf, combatLive, eyeHeight, isStealthed, ticksOf } from './state';
import { rayCapsule, worldRay, worldRayNormal, type WorldHit } from './geometry';
import { friendlyShotPass } from './ability-core';
import { restockAtKiosk } from '../interact/ordnance-kiosk';

/** Per-character carry state (players and room bots). */
export interface OrdnanceCarry {
  carry: boolean;
  /** Btn.Throw went down while carrying: the release throws. */
  armed: boolean;
  /**
   * Btn.Throw as this system last saw it. Edges come from this, not from e.prevButtons: the Room's catch-up replays
   * extra inputs movement-only (host/room.ts stepExtra) and rewrites prevButtons, which could swallow a press or a
   * release tick; tracking our own last state still sees both.
   */
  held: boolean;
  /** Tick from which the next throw is allowed. */
  nextThrow: number;
  /** Tick from which the own kiosk restocks (set by a throw). */
  restockAt: number;
  wasDead: boolean;
  /** Telemetry: throws and kiosk restocks so far. */
  thrown: number;
  restocks: number;
}

/** A thrown one in flight / on the ground. */
export interface OrdnanceProj {
  /** ORDNANCE_IDS index. */
  kind: number;
  owner: EntityId;
  ownerTeam: TeamId;
  body: OrdBody;
  /** Ticks left on the fuse (mirrored to EntityState.ammo). */
  fuse: number;
  /** Contact code of the last step (Contact.*), for tests. */
  contact: number;
}

declare module '../entity' {
  interface SimEntity {
    ordCarry?: OrdnanceCarry;
    ordProj?: OrdnanceProj;
  }
}

/** Test/lab knobs: `sim.state.ordnanceConfig = { enabled: true }` (default: by the Room's mode). */
export interface OrdnanceConfig { enabled?: boolean }

export type ThrowResult = 'thrown' | 'empty' | 'dead' | 'vehicle' | 'stunned' | 'emote' | 'cooldown' | 'not_live';

interface Runtime {
  pool: SimEntity[];
  live: SimEntity[];
  wasOn: boolean;
  matchSeen: boolean;
  matchRef: unknown;
  aw: ArcWorld;
  /** Bound contact query for this sim (the projectile being stepped sets owner/team first). */
  query: SegQuery;
  qOwner: EntityId;
  qTeam: TeamId;
  qRadius: number;
  /** Living characters this tick (the contact query's enemies), gathered once per tick while any are in flight. */
  chars: SimEntity[];
  /** The last blasts (tick, owner, x, y, z, ORDNANCE_IDS index; a ring of BLAST_RING), for ordnanceBlastOf(). */
  recent: Float64Array;
  recentAt: number;
  /** Telemetry. */
  throws: number;
  blasts: number;
  fizzles: number;
}

const runtimes = new WeakMap<Sim, Runtime>();
const POOL_MAX = 64;
const BLAST_RING = 8;
const wh: WorldHit = { t: 0, nx: 0, ny: 0, nz: 0 };
const th: SegHit = makeSegHit();
const hit: SegHit = makeSegHit();
const launch = makeLaunch();

function runtime(sim: Sim): Runtime {
  let rt = runtimes.get(sim);
  if (!rt) {
    const r: Runtime = {
      pool: [], live: [], wasOn: false, matchSeen: false, matchRef: undefined, aw: arcWorldOf(sim.worldData),
      query: null as unknown as SegQuery, qOwner: -1, qTeam: 0, qRadius: 0.13, chars: [], recent: new Float64Array(BLAST_RING * 6).fill(-1), recentAt: 0, throws: 0, blasts: 0, fizzles: 0,
    };
    // Rapier (static world + vehicles; own-team barriers and drones let their team's throws through), the terrain
    // collider's exact surface as a backstop, and enemy capsules (bounce, no damage).
    r.query = (ox, oy, oz, dx, dy, dz, len, out) => {
      let best = Infinity;
      const w = worldRayNormal(sim, ox, oy, oz, dx, dy, dz, len, wh, friendlyShotPass(sim, r.qTeam));
      if (w) { best = w.t; out.t = w.t; out.nx = w.nx; out.ny = w.ny; out.nz = w.nz; }
      if (arcTerrain(r.aw, ox, oy, oz, dx, dy, dz, len, th) && th.t < best) { best = th.t; out.t = th.t; out.nx = th.nx; out.ny = th.ny; out.nz = th.nz; }
      for (let i = 0; i < r.chars.length; i++) {
        const t = r.chars[i];
        if (t.dead || t.id === r.qOwner || t.team === r.qTeam) continue;
        const cap = capsuleOf(t), R = cap.r + r.qRadius;
        const tc = rayCapsule(ox, oy, oz, dx, dy, dz, t.pos.x, t.pos.y + cap.r, t.pos.z, cap.len, R, Math.min(best, len));
        if (tc >= 0 && tc < best) {
          best = tc;
          // capsule normal at the contact: from the closest point of its axis
          const px = ox + dx * tc, py = oy + dy * tc, pz = oz + dz * tc;
          const ay = Math.min(Math.max(py - (t.pos.y + cap.r), 0), cap.len) + t.pos.y + cap.r;
          let nx = px - t.pos.x, ny = py - ay, nz = pz - t.pos.z;
          const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (l > 1e-6) { nx /= l; ny /= l; nz /= l; } else { nx = -dx; ny = -dy; nz = -dz; }
          out.t = tc; out.nx = nx; out.ny = ny; out.nz = nz;
        }
      }
      return best <= len;
    };
    rt = r;
    runtimes.set(sim, rt);
  }
  return rt;
}

/** Is the ordnance layer on in this sim? (config override, else the Room's mode). */
export function ordnanceEnabled(sim: Sim): boolean {
  const cfg = sim.state.ordnanceConfig as OrdnanceConfig | undefined;
  if (cfg?.enabled !== undefined) return cfg.enabled;
  const mode = (sim.state.room as { mode?: string } | undefined)?.mode;
  return mode !== undefined && ORDNANCE_RULES.modes.includes(mode);
}

/** Who carries throwables: players and room bots (not PvE wave/chapter cats, not bosses). */
export function ordnanceEligible(e: SimEntity): boolean {
  return !!e.char && !e.removed && (e.kind === EntityKind.Player || (e.kind === EntityKind.Bot && !e.combat?.pve));
}

function newCarry(alive: boolean): OrdnanceCarry {
  return { carry: alive, armed: false, held: false, nextThrow: 0, restockAt: 0, wasDead: !alive, thrown: 0, restocks: 0 };
}

// ------------------------------------------------------------------------------------------------ entities

function blank(): SimEntity {
  return {
    id: 0, kind: EntityKind.Projectile, team: 0, species: 0, cls: null, seed: 0, name: '',
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, collider: null,
    input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null, health: null,
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
    ownerPid: null, removed: false, data: {},
  };
}

function spawnThrown(sim: Sim, rt: Runtime, owner: SimEntity, kind: number, L: typeof launch): SimEntity {
  const def = ORDNANCE[ORDNANCE_IDS[kind]];
  const e = rt.pool.pop() ?? blank();
  e.id = sim.allocId();
  e.kind = EntityKind.Projectile;
  e.team = owner.team; e.species = owner.species; e.seed = owner.id; e.name = def.id;
  e.pos.x = L.x; e.pos.y = L.y; e.pos.z = L.z;
  e.vel.x = L.vx; e.vel.y = L.vy; e.vel.z = L.vz;
  e.yaw = Math.atan2(-L.vx, -L.vz); e.pitch = Math.atan2(L.vy, Math.hypot(L.vx, L.vz));
  e.flags = 0; e.dead = false; e.removed = false; e.anim = Anim.Idle;
  e.weapon = ordnanceWire(def.id);
  e.ammo = FUSE_TICKS;
  const p = e.ordProj ?? { kind, owner: 0, ownerTeam: 0, body: makeBody(), fuse: 0, contact: 0 };
  p.kind = kind; p.owner = owner.id; p.ownerTeam = owner.team; p.fuse = FUSE_TICKS; p.contact = 0;
  launchBody(p.body, L);
  e.ordProj = p;
  sim.entities.set(e.id, e);
  rt.live.push(e);
  return e;
}

function despawn(sim: Sim, rt: Runtime, e: SimEntity, i: number): void {
  sim.removeEntity(e.id);
  const last = rt.live.length - 1;
  rt.live[i] = rt.live[last];
  rt.live.length = last;
  if (rt.pool.length < POOL_MAX) rt.pool.push(e);
}

/** Every throwable in flight disappears without a blast (a match restart, the layer switching off). */
function fizzleAll(sim: Sim, rt: Runtime): void {
  for (let i = rt.live.length - 1; i >= 0; i--) {
    const e = rt.live[i];
    if (!e.removed) { rt.fizzles++; despawn(sim, rt, e, i); } else { rt.live[i] = rt.live[rt.live.length - 1]; rt.live.length--; }
  }
}

function stepThrown(sim: Sim, rt: Runtime, e: SimEntity, i: number): void {
  const p = e.ordProj!;
  const def = ORDNANCE[ORDNANCE_IDS[p.kind]];
  const b = p.body;
  p.fuse--;
  e.ammo = p.fuse;
  if (p.fuse <= 0) {
    // the blast (a restart / the end of the match makes it a dud: no damage, no shove after the whistle)
    if (combatLive(sim)) {
      const o = (rt.recentAt++ % BLAST_RING) * 6, r = rt.recent;
      r[o] = sim.tick; r[o + 1] = p.owner; r[o + 2] = b.x; r[o + 3] = b.y + 0.15; r[o + 4] = b.z; r[o + 5] = p.kind;
      explode(sim, b.x, b.y + 0.15, b.z, def.projectile, p.owner, p.ownerTeam, e.weapon);
      rt.blasts++;
    } else rt.fizzles++;
    despawn(sim, rt, e, i);
    return;
  }
  rt.qOwner = p.owner; rt.qTeam = p.ownerTeam; rt.qRadius = def.projectile.radius;
  p.contact = stepBody(b, def, TICK_DT, rt.query, hit);
  e.pos.x = b.x; e.pos.y = b.y; e.pos.z = b.z;
  e.vel.x = b.vx; e.vel.y = b.vy; e.vel.z = b.vz;
  const hs = b.vx * b.vx + b.vz * b.vz;
  if (hs > 1e-4) e.yaw = Math.atan2(-b.vx, -b.vz);
  e.pitch = hs + b.vy * b.vy > 1e-4 ? Math.atan2(b.vy, Math.sqrt(hs)) : 0;
  e.flags = b.rest ? EFlag.Grounded : 0;
  const lim = sim.worldData.halfExtent + 30;
  if (b.y < sim.worldData.killY || Math.abs(b.x) > lim || Math.abs(b.z) > lim) { rt.fizzles++; despawn(sim, rt, e, i); }
}

// ------------------------------------------------------------------------------------------------ throws

/**
 * Authority: throw `e`'s carried ordnance now, from its own feet, yaw and pitch. Returns why not, when it can't.
 * (The system calls this on a Btn.Throw release; tests and tools may call it directly.)
 */
export function tryThrow(sim: Sim, e: SimEntity): ThrowResult {
  const st = e.ordCarry;
  if (!st || !st.carry) return 'empty';
  if (e.dead || !e.char || e.removed) return 'dead';
  if (e.flags & EFlag.Mounted) return 'vehicle';
  if (e.flags & EFlag.Stunned) return 'stunned';
  const taunt = e.data.tauntTick as number | undefined;
  if (taunt !== undefined && sim.tick - taunt < ticksOf(ORDNANCE_RULES.emoteLock)) return 'emote';
  if (sim.tick < st.nextThrow) return 'cooldown';
  if (!combatLive(sim)) return 'not_live';
  const rt = runtime(sim);
  const def = ordnanceFor(e.species);
  throwLaunch(e.pos.x, e.pos.y, e.pos.z, e.yaw, e.pitch, e.species, launch);
  // a hand pushed into a wall throws from where the arm is still in the open (like the muzzle clamp; the preview's
  // clampLaunch() does the same against the static world)
  const ex = e.pos.x, ey = e.pos.y + eyeHeight(e), ez = e.pos.z;
  const hx = launch.x - ex, hy = launch.y - ey, hz = launch.z - ez, hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
  const free = worldRay(sim, ex, ey, ez, hx / hl, hy / hl, hz / hl, hl, friendlyShotPass(sim, e.team));
  if (free < hl) { const k = Math.max(0, free - HAND_BACKOFF) / hl; launch.x = ex + hx * k; launch.y = ey + hy * k; launch.z = ez + hz * k; }
  spawnThrown(sim, rt, e, ORDNANCE_IDS.indexOf(def.id), launch);
  st.carry = false;
  st.armed = false;
  st.thrown++;
  st.nextThrow = sim.tick + ticksOf(ORDNANCE_RULES.throwCooldown);
  st.restockAt = sim.tick + ticksOf(ORDNANCE_RULES.restockCooldown);
  e.flags &= ~EFlag.Ordnance;
  rt.throws++;
  // like a shot: ends spawn protection and breaks a fire-breaking cloak. The throw itself is quiet (no noise record:
  // nothing allocated per throw); the blast is loud (explode() reports it) and the pin's ping is client audio.
  const meta = e.combat;
  if (meta) {
    if (meta.invulnUntil > sim.tick) { meta.invulnUntil = 0; e.flags &= ~EFlag.Invulnerable; }
    if (isStealthed(sim, e) && abilityDef(e.abil?.id ?? '')?.breakOnFire) { meta.stealthUntil = 0; e.flags &= ~EFlag.Stealthed; }
  }
  return 'thrown';
}

// ------------------------------------------------------------------------------------------------ systems

export const ordnanceSystem: SimSystem = {
  name: 'ordnance',
  order: 455,
  update(sim) {
    const rt = runtime(sim);
    // in flight first: a throw made this tick leaves the hand next tick (the arc preview counts the same way)
    rt.chars.length = 0;
    if (rt.live.length) for (const e of sim.entities.values()) if (e.char && !e.dead) rt.chars.push(e);
    for (let i = rt.live.length - 1; i >= 0; i--) {
      const e = rt.live[i];
      if (e.removed) { // taken out by someone else (a reset, a test): back to the pool
        rt.live[i] = rt.live[rt.live.length - 1]; rt.live.length--;
        if (rt.pool.length < POOL_MAX) rt.pool.push(e);
        continue;
      }
      stepThrown(sim, rt, e, i);
    }
    rt.chars.length = 0;
    if (!ordnanceEnabled(sim)) return;
    for (const e of sim.entities.values()) {
      const st = e.ordCarry;
      if (!st || e.dead || !e.char) continue;
      if (!st.carry) restockAtKiosk(sim, e, st);
      const down = held(e, Btn.Throw);
      if (down && !st.held) st.armed = st.carry; // a press arms only while carrying (and only in this life)
      else if (!down && st.held && st.armed) { st.armed = false; tryThrow(sim, e); }
      st.held = down;
    }
  },
};

export const ordnanceLifecycleSystem: SimSystem = {
  name: 'ordnance-life',
  order: 805,
  update(sim) {
    const rt = runtime(sim);
    if (!ordnanceEnabled(sim)) {
      if (rt.wasOn) {
        fizzleAll(sim, rt);
        for (const e of sim.entities.values()) if (e.ordCarry) { e.ordCarry = undefined; e.flags &= ~EFlag.Ordnance; }
      }
      rt.wasOn = false;
      return;
    }
    rt.wasOn = true;
    // a match restart (the match system builds a fresh MatchState): clean slate
    const ms = sim.state.match;
    const restarted = rt.matchSeen && ms !== rt.matchRef;
    rt.matchSeen = true; rt.matchRef = ms;
    if (restarted) fizzleAll(sim, rt);
    for (const e of sim.entities.values()) {
      if (!e.char) continue;
      if (!ordnanceEligible(e)) {
        if (e.ordCarry) { e.ordCarry = undefined; e.flags &= ~EFlag.Ordnance; }
        continue;
      }
      let st = e.ordCarry;
      if (!st) st = e.ordCarry = newCarry(!e.dead); // spawn with one
      else if (restarted) { st.carry = !e.dead; st.armed = false; st.nextThrow = 0; st.restockAt = 0; st.wasDead = e.dead; }
      else if (e.dead) { if (!st.wasDead) { st.wasDead = true; st.carry = false; st.armed = false; } }
      else if (st.wasDead) { st.wasDead = false; st.carry = true; st.armed = false; } // respawned: a fresh one
      e.flags = st.carry && !e.dead ? e.flags | EFlag.Ordnance : e.flags & ~EFlag.Ordnance;
    }
  },
};

/** Throwables currently in flight or on the ground (tests, tools, the AI). Read-only view. */
export function liveOrdnance(sim: Sim): readonly SimEntity[] {
  return runtime(sim).live;
}

/**
 * The throwable blast behind an `explode` event of this tick, or null (a mortar shell, a boss hairball, a kart). For
 * systems that read blasts from events and pick a damage profile (vehicles' blastDamageOf, ability entities'
 * blastProfile), so a throwable hits them with its own numbers instead of the thrower's weapon's.
 */
export function ordnanceBlastOf(sim: Sim, ev: { x: number; y: number; z: number; by: EntityId }): ProjectileDef | null {
  const r = runtime(sim).recent;
  for (let i = 0; i < BLAST_RING; i++) {
    const o = i * 6;
    if (r[o] === sim.tick && r[o + 1] === ev.by && r[o + 2] === ev.x && r[o + 3] === ev.y && r[o + 4] === ev.z) return ORDNANCE[ORDNANCE_IDS[r[o + 5]]].projectile;
  }
  return null;
}

/** Telemetry for soak/QA tools. */
export function ordnanceStats(sim: Sim): { throws: number; blasts: number; fizzles: number; live: number } {
  const rt = runtime(sim);
  return { throws: rt.throws, blasts: rt.blasts, fizzles: rt.fizzles, live: rt.live.length };
}

/** The per-sim arc world (the same static world the client preview and the bot AI use). */
export function ordnanceArcWorld(sim: Sim): ArcWorld {
  return runtime(sim).aw;
}
