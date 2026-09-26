// OWNER: world lane (L2 + G1). World-driven sim systems:
//   order 250 `world-effects`: trampoline jump pads, wading water, out-of-bounds guard (L2) and, from G1,
//              weather-wet slippery grass and garden sprinkler jets.
//   order 620 `world-conceal`: tall-grass concealment -> e.conceal + EFlag.Stealthed (after combat-status
//              600 has recomputed the cloak flags, before the snapshot).
//
// stepWorldEffects() is a pure per-entity function (like stepCharacter) so client-side prediction
// can call it right after stepCharacter() for the local player and stay in sync with the authority.
//
// Environment clock (G1): weather and sprinklers are functions of (world seed, tick). The authority
// passes its tick as `clock`; the function then uses the player's own input clock `e.input.rt` (the
// server tick the client was rendering) when it lies within ENV_RT_WINDOW ticks before `clock`, else
// `clock`. Client prediction calls it WITHOUT a clock and uses `rt` directly — the same value the
// authority used for that input — so slippery ground and sprinkler shoves predict exactly with no
// extra wiring. Bots (rt = 0) always use the sim tick. Room.stepExtra (extra inputs between ticks)
// passes no clock either: it falls back to the tick stamped on the entity by the regular system.
import type { SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import type { GameEvent } from '../../shared/protocol';
import type { WorldData } from '../../shared/world/world-data';
import type { MoveStats } from '../../shared/content/classes';
import { concealmentAt, jumpPadAt, waterAt } from '../../shared/world/queries';
import { inSprinklerJet, inSprinklerSweep, sprinklerAt, weatherParamsAt, WEATHER_PARAMS, type SprinklerState, type WeatherParams } from '../../shared/world/weather';
import { TICK_DT } from '../../shared/constants';
import { EFlag } from '../../shared/types';
import { Btn } from '../../shared/input';
import { CONCEAL_FIRE_REVEAL_S, CONCEAL_FLAG_LEVEL } from './env';

export interface WorldEffectResult {
  /** Jump pad id if the entity was launched this tick. */
  bounced: string | null;
  /** True while wading (drag applied). */
  wading: boolean;
  /** True if the entity left the playable bounds (caller should respawn it). */
  outOfBounds: boolean;
  /** Slippery level set for the next tick (0 = full grip ... SLIP_LEVELS = soaked grass). */
  slip: number;
  /** Id of the sprinkler whose jet hit the character this tick. */
  sprayed: string | null;
}

/** Wetness is quantized to this many levels (cached immutable MoveStats variants, exact replays). */
export const SLIP_LEVELS = 8;
/** Fraction of ground acceleration / deceleration lost on soaked grass. */
export const SLIP_ACCEL_LOSS = 0.6;
export const SLIP_DECEL_LOSS = 0.72;
/** Sprinkler jet: push along the jet (m/s^2 at full pressure), hop (m/s), per-tick horizontal keep. */
export const SPRINKLER_PUSH = 55;
export const SPRINKLER_POP = 3.6;
export const SPRINKLER_KEEP = 0.88;
/** Ticks an input's render clock (rt) may lag the authority tick and still drive the environment. */
export const ENV_RT_WINDOW = 30;

// ---- slippery MoveStats variants: immutable per (base, level), so restoring a CharacterState copy
// (prediction history) restores exactly the stats the next tick will use.
const variants = new WeakMap<MoveStats, MoveStats[]>();
const baseOf = new WeakMap<MoveStats, MoveStats>();

/** The unmodified MoveStats behind a (possibly slippery) variant. */
export function baseMoveStats(m: MoveStats): MoveStats {
  return baseOf.get(m) ?? m;
}

/** Cached slippery variant of `base` for a wetness level (0 returns `base`). */
export function slipperyMoveStats(base: MoveStats, level: number): MoveStats {
  if (level <= 0) return base;
  let arr = variants.get(base);
  if (!arr) { arr = []; variants.set(base, arr); }
  let v = arr[level];
  if (!v) {
    const k = level / SLIP_LEVELS;
    v = { ...base, groundAccel: base.groundAccel * (1 - SLIP_ACCEL_LOSS * k), groundDecel: base.groundDecel * (1 - SLIP_DECEL_LOSS * k) };
    arr[level] = v;
    baseOf.set(v, base);
  }
  return v;
}

/** The tick the environment is sampled at for this character (see the header). */
export function envTick(e: SimEntity, clock?: number): number {
  const stamped = e.data.worldTick;
  const ref = clock ?? (typeof stamped === 'number' ? stamped : undefined);
  const rt = e.input.rt;
  if (ref === undefined) return rt;
  return rt > 0 && rt <= ref && rt >= ref - ENV_RT_WINDOW ? rt : ref;
}

const wx: WeatherParams = { ...WEATHER_PARAMS.clear };
const sprState: SprinklerState = { on: 0, angle: 0, dirX: 1, dirZ: 0, t: -1 };

/**
 * Apply map effects to one character after its movement step.
 * - Jump pad: grounded on a pad -> vel.y = pad.vy (one double jump stays available), emits 'jump'.
 * - Water: feet below surface - 0.1 inside a water zone -> horizontal velocity keeps `drag` per 60 Hz
 *   tick, which caps wading speed near groundAccel*dt/(1-drag) (~3 m/s for the pond, sprint included).
 * - Bounds: reports when the entity is outside data.bounds or below killY + 2.
 * - Sprinklers (G1): inside a running jet -> shoved along the jet, horizontal drag, popped off the ground.
 * - Slippery grass (G1): grounded on terrain while wet (rain, or a running sprinkler's sweep) -> the next
 *   tick moves with lower ground accel/decel (a cached MoveStats variant in e.char.move).
 * `clock`: the authority's tick (omit in client prediction; see the header).
 */
export function stepWorldEffects(data: WorldData, e: SimEntity, dt: number, emit?: (ev: GameEvent) => void, clock?: number): WorldEffectResult {
  const r: WorldEffectResult = { bounced: null, wading: false, outOfBounds: false, slip: 0, sprayed: null };
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

  // ---- G1: weather + sprinklers (riders are moved by their vehicle) ----
  if (e.flags & EFlag.Mounted) { c.move = baseMoveStats(c.move); return r; }
  const t = envTick(e, clock);
  let wet = weatherParamsAt(data.seed, t, wx).wet;
  const sps = data.sprinklers;
  if (sps) {
    for (const sp of sps) {
      const dx = x - sp.x, dz = z - sp.z, rr = sp.reach + 1;
      if (dx * dx + dz * dz > rr * rr || y > sp.y + 4) continue;
      const st = sprinklerAt(data.seed, sp, t, sprState);
      if (st.on <= 0) continue;
      if (st.on > wet && inSprinklerSweep(sp, x, z)) wet = st.on;
      if (inSprinklerJet(sp, st, x, z) < 0) continue;
      r.sprayed = sp.id;
      const keep = 1 - (1 - SPRINKLER_KEEP) * st.on;
      e.vel.x = e.vel.x * keep + st.dirX * SPRINKLER_PUSH * st.on * dt;
      e.vel.z = e.vel.z * keep + st.dirZ * SPRINKLER_PUSH * st.on * dt;
      const pop = SPRINKLER_POP * st.on;
      if (c.grounded && e.vel.y < pop && pop > 1) {
        e.vel.y = pop;
        c.grounded = false;
        c.airTime = c.move.coyoteTime;
        if (c.jumpsUsed < 1) c.jumpsUsed = 1;
        c.jumpBuffer = 0;
      }
    }
  }
  const onTerrain = c.grounded && !r.wading && y - data.height(x, z) < 0.3;
  const level = onTerrain && wet > 0 ? Math.round(wet * SLIP_LEVELS) : 0;
  c.move = slipperyMoveStats(baseMoveStats(c.move), level);
  r.slip = level;
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
      e.data.worldTick = sim.tick;
      const res = stepWorldEffects(data, e, dt, emit, sim.tick);
      if (res.outOfBounds) {
        const s = sim.pickSpawn(e.team);
        sim.placeCharacter(e, s.x, s.y, s.z);
      }
    }
  },
};

/**
 * Tall-grass concealment (order 620, after combat-status 600 recomputed cloak flags). Writes
 * e.conceal (see env.ts) and ORs EFlag.Stealthed into the snapshot flags while level >= 0.5.
 */
export const concealSystem: SimSystem = {
  name: 'world-conceal',
  order: 620,
  update(sim) {
    const data = sim.worldData;
    const zones = !!data.concealZones?.length;
    const fireReveal = Math.round(CONCEAL_FIRE_REVEAL_S / TICK_DT);
    for (const e of sim.entities.values()) {
      if (!e.char || (!zones && !e.conceal)) continue;
      const st = e.conceal ?? (e.conceal = { level: 0, zone: 0, revealUntil: 0 });
      const wasFlagged = st.level >= CONCEAL_FLAG_LEVEL;
      st.level = 0; st.zone = 0;
      if (!e.dead && !(e.flags & EFlag.Mounted) && zones) {
        st.zone = concealmentAt(data, e.pos.x, e.pos.y, e.pos.z);
        if (e.flags & EFlag.Firing) st.revealUntil = Math.max(st.revealUntil, sim.tick + fireReveal);
        if (e.health && e.health.lastDamageTick > 0 && sim.tick - e.health.lastDamageTick < 2) st.revealUntil = Math.max(st.revealUntil, sim.tick + 30);
        if (st.zone > 0 && sim.tick >= st.revealUntil) {
          const sp = Math.sqrt(e.vel.x * e.vel.x + e.vel.z * e.vel.z);
          const m = e.char.move;
          let stance: number;
          if (e.flags & EFlag.Sprinting) stance = 0;
          else if (sp < 0.7) stance = 1;
          else if (sp <= m.walkSpeed + 0.5) stance = (e.input.buttons & Btn.Crouch) ? 0.85 : 0.7;
          else stance = 0.3;
          st.level = st.zone * stance;
        }
      }
      if (st.level >= CONCEAL_FLAG_LEVEL) e.flags |= EFlag.Stealthed;
      else if (wasFlagged) {
        // Clear our flag unless the shadow cloak (combat lane) holds it this tick.
        const cloak = (e as { combat?: { stealthUntil: number } }).combat;
        if (!cloak || cloak.stealthUntil <= sim.tick) e.flags &= ~EFlag.Stealthed;
      }
    }
  },
};

export function worldSystems(): SimSystem[] {
  return [worldEffectsSystem, concealSystem];
}
