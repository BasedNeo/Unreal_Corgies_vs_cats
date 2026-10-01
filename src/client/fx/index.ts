// OWNER: L5 (juice), X3 (weapons + combat feedback). FX director: turns GameEvents + entity states into pooled
// particles, tracers, impact marks, light pulses and camera reactions. W13 (docs/design/LOOK.md): the stylised-realistic
// look has no comic onomatopoeia (the "POW!" / "BARK!" billboards are retired); hit feedback stays.
// Draw calls: 3 total (solid particles, glow particles, impact decals) + a fixed pool of 0–2 pulse lights.
//
//   const fx = createFx(ctx.scene, ctx.camera, views, { heightAt, world: worldData });  // views: EntityViews
//   bus.on('game', (ev) => { const r = fx.onGameEvent(ev); if (r.shake) cam.shake(r.shake); ... });
//   // each frame, after net.interpolated():
//   fx.update(dt, states, net.localEntity);
//   const presentDt = dt * fx.hitStop();                          // hit-stop: presentation only
//
// Sound-to-visual sync: the muzzle flash, tracer, casing and light pulse all spawn inside onGameEvent('fire') — the
// same bus callback that plays the shot's sound — and particles spawned between frames skip their first update, so
// the first rendered frame after the event shows the flash at full strength.
// See docs/handoff/L5.md (base mapping) and docs/handoff/X3.md (weapons, impacts, decals, lights, kick).
import * as THREE from 'three/webgpu';
import type { EntityState, GameEvent } from '../../shared/protocol';
import { EFlag, EntityKind, Species } from '../../shared/types';
import { WEAPONS } from '../../shared/content/weapons';
import { FxRng, ParticlePool } from './particle-pool';
import { createParticleMesh, type ParticleMesh } from './particle-mesh';
import { HitStop, makeReaction, reactionFor, type FxReaction, type ReactionContext } from './reactions';
import { WeaponTable } from './weapon-fx';
import { DecalKind, DecalPool } from './decal-pool';
import { createDecalMesh, type DecalMesh } from './decal-mesh';
import { PulseLights } from './light-pulses';
import { SurfaceMap, Surface, makeSurfaceHit, type SurfaceWorld } from './surfaces';
import { impactDelay } from './delays';
import * as P from './presets';
import * as W from './presets-weapons';
import { ordnanceByWire } from '../../shared/content/ordnance';

export type { FxReaction } from './reactions';

/** Anything that can give a muzzle position for an entity — EntityViews satisfies this structurally. */
export interface MuzzleSource {
  get(id: number): { avatar: { muzzleWorld(target: THREE.Vector3): THREE.Vector3 } } | undefined;
}

export type FxQuality = 'low' | 'medium' | 'high';

export interface FxOptions {
  solidCapacity?: number;
  glowCapacity?: number;
  quality?: FxQuality;
  /** Terrain height for bouncing debris (e.g. worldData.height). Defaults to the event's own y (or `world`). */
  heightAt?: (x: number, z: number) => number;
  /** X3: the world, so impacts know what they hit (dirt, metal, wood, water...) and where marks may sit. */
  world?: SurfaceWorld | null;
  /** Seed for presentation variation (deterministic labs/tests). */
  seed?: number;
}

export interface FxEventContext { localId?: number; states?: Map<number, EntityState> }

export interface FxStats {
  solid: number; glow: number; decals: number; lights: number; drawCalls: number; cpuMs: number; peakCpuMs: number;
}

export interface Fx {
  readonly group: THREE.Group;
  /** Advance particles (real dt). Pass the frame's entity states + local id so events can find positions. */
  update(dt: number, states?: Map<number, EntityState>, localId?: number): void;
  /** Spawns the event's FX and returns suggested camera trauma, hit-stop, view kick and FOV punch (reused object). */
  onGameEvent(ev: GameEvent, ctx?: FxEventContext): FxReaction;
  /** Request `frames` of hit-stop (optional) and return the current presentation time scale (0.04..1). */
  hitStop(frames?: number): number;
  /** Weapon content ids in wpn-index order (defaults to WEAPON_IDS). */
  setWeaponIds(ids: readonly string[]): void;
  setQuality(q: FxQuality): void;
  /** X3: the world impacts classify against (null = everything reads as dirt, no marks on props). */
  setWorld(world: SurfaceWorld | null): void;
  readonly stats: FxStats;
  dispose(): void;
}

/** Per-tier knobs: particle density, mark cap, brass, light pulses. The low tier trims decals, casings and lights. */
export const FX_TIERS: Record<FxQuality, { density: number; decals: number; casings: boolean; lights: number }> = {
  low: { density: 0.45, decals: 16, casings: false, lights: 0 },
  medium: { density: 0.75, decals: 40, casings: true, lights: 1 },
  high: { density: 1, decals: 64, casings: true, lights: 2 },
};
const DECAL_CAPACITY = 64;
const CULL_DIST = 90;
/** Pending impacts (waiting for their tracer): fixed ring, 16 floats each. */
const PENDING = 48, PF = 16;
/** Beyond this, impacts skip debris-heavy detail (a far hit still flashes and marks). */
const IMPACT_DIST = 60;

export function createFx(scene: THREE.Scene, camera: THREE.Camera, views: MuzzleSource | null, opts: FxOptions = {}): Fx {
  const tier0 = FX_TIERS[opts.quality ?? 'high'];
  const solidPool = new ParticlePool(opts.solidCapacity ?? 1600);
  const glowPool = new ParticlePool(opts.glowCapacity ?? 900);
  solidPool.freshFirstFrame = glowPool.freshFirstFrame = true;
  const solidMesh: ParticleMesh = createParticleMesh(solidPool.capacity, 'solid');
  const glowMesh: ParticleMesh = createParticleMesh(glowPool.capacity, 'glow');
  const decalPool = new DecalPool(DECAL_CAPACITY, tier0.decals);
  const decalMesh: DecalMesh = createDecalMesh(DECAL_CAPACITY);
  const lights = new PulseLights(2, tier0.lights);
  const group = new THREE.Group();
  group.name = 'fx';
  group.add(decalMesh.mesh, solidMesh.mesh, glowMesh.mesh, lights.group);
  scene.add(group);

  const rng = new FxRng(opts.seed ?? 0xc0ffee);
  const pools: P.FxPools = { solid: solidPool, glow: glowPool, rng, density: tier0.density };
  let casings = tier0.casings;
  const weapons = new WeaponTable();
  const hitStop = new HitStop();
  const heightAt = opts.heightAt ?? (opts.world ? (x: number, z: number) => opts.world!.height(x, z) : null);
  // Without the world (not wired yet), impacts still know the terrain from heightAt: grass/dirt puffs + ground holes.
  const terrainOnly = (h: (x: number, z: number) => number): SurfaceWorld => ({ height: h, props: [] });
  const surfaces = new SurfaceMap(opts.world ?? (heightAt ? terrainOnly(heightAt) : null));
  const sHit = makeSurfaceHit();

  let states: Map<number, EntityState> = new Map();
  let localId = -1;
  let clock = 0;
  const camPos = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const reaction: FxReaction = makeReaction();
  const stats: FxStats = { solid: 0, glow: 0, decals: 0, lights: 0, drawCalls: 0, cpuMs: 0, peakCpuMs: 0 };

  const weaponOf = (wpn: number) => weapons.id(wpn);
  const reactCtx: ReactionContext = { localId: -1, lx: 0, ly: 0, lz: 0, hasLocal: false, weaponOf };

  // Per-entity accumulators for continuous emitters (sprint dust, projectile trails).
  const trailAcc = new Map<number, number>();
  let frameDt = 0;
  const emitContinuous = (s: EntityState, id: number) => {
    const cx = s.x - camPos.x, cy = s.y - camPos.y, cz = s.z - camPos.z;
    if (cx * cx + cy * cy + cz * cz > 50 * 50) return;
    if (s.kind === EntityKind.Projectile) {
      if (ordnanceByWire(s.weapon)) return; // W9 X4: throwables draw their own trail (fx/ordnance-view.ts)
      const a = (trailAcc.get(id) ?? 0) + frameDt;
      if (a >= 0.035) { P.ballTrail(pools, s.x, s.y, s.z); trailAcc.set(id, 0); } else trailAcc.set(id, a);
      return;
    }
    if (s.kind !== EntityKind.Player && s.kind !== EntityKind.Bot) return;
    const f = s.flags;
    if ((f & EFlag.Sprinting) === 0 || (f & EFlag.Grounded) === 0 || (f & EFlag.Dead) !== 0 || (f & EFlag.Stealthed) !== 0) return;
    const sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
    if (sp < 5) return;
    const a = (trailAcc.get(id) ?? 0) + sp * frameDt;
    if (a >= 1.1) { P.sprintPuff(pools, s.x, s.y, s.z, s.vx, s.vz); trailAcc.set(id, 0); } else trailAcc.set(id, a);
  };

  const near = (x: number, y: number, z: number, d = CULL_DIST) => {
    const dx = x - camPos.x, dy = y - camPos.y, dz = z - camPos.z;
    return dx * dx + dy * dy + dz * dz < d * d;
  };
  const ground = (x: number, y: number, z: number) => (heightAt ? heightAt(x, z) : y);
  const muzzleOf = (id: number, fx: number, fy: number, fz: number): THREE.Vector3 => {
    const v = views?.get(id);
    if (v) return v.avatar.muzzleWorld(muzzle);
    return muzzle.set(fx, fy, fz);
  };
  /** A persistent mark where the surface allows it. */
  const mark = (x: number, y: number, z: number, radius: number, kind: number) => {
    if (!sHit.decal || radius <= 0) return;
    decalPool.spawn(x, y, z, sHit.nx, sHit.ny, sHit.nz, radius * rng.range(0.85, 1.2), kind, sHit.kind, rng.range(0, Math.PI * 2), rng.next());
  };
  // Impacts waiting for their tracer to arrive (fixed ring; a full ring lands the impact at once).
  // Layout: 0 due · 1 surface · 2-4 pos · 5-7 normal · 8-10 shot dir · 11 scale · 12 decal radius (0 = none) · 13 groundY · 14 live
  const pend = new Float32Array(PENDING * PF);
  let pendLive = 0;
  const land = (o: number, a: Float32Array) => {
    W.impact(pools, a[o + 1], a[o + 2], a[o + 3], a[o + 4], a[o + 5], a[o + 6], a[o + 7], a[o + 8], a[o + 9], a[o + 10], a[o + 11], a[o + 13]);
    if (a[o + 12] > 0) decalPool.spawn(a[o + 2], a[o + 3], a[o + 4], a[o + 5], a[o + 6], a[o + 7], a[o + 12] * rng.range(0.85, 1.2), DecalKind.Hole, a[o + 1], rng.range(0, Math.PI * 2), rng.next());
  };
  const scratch = new Float32Array(PF);
  /** Impact at (x, y, z) on the surface in `sHit`, after `delay` s. */
  const impactAt = (x: number, y: number, z: number, dx: number, dy: number, dz: number, scale: number, decal: number, delay: number) => {
    let a = scratch, o = 0;
    if (delay > 0.012 && pendLive < PENDING) {
      for (let i = 0; i < PENDING; i++) if (pend[i * PF + 14] === 0) { a = pend; o = i * PF; break; }
    }
    a[o] = clock + delay; a[o + 1] = sHit.kind; a[o + 2] = x; a[o + 3] = y; a[o + 4] = z;
    a[o + 5] = sHit.nx; a[o + 6] = sHit.ny; a[o + 7] = sHit.nz; a[o + 8] = dx; a[o + 9] = dy; a[o + 10] = dz;
    a[o + 11] = scale; a[o + 12] = sHit.decal ? decal : 0; a[o + 13] = ground(x, y, z);
    if (a === scratch) { land(0, scratch); return; }
    a[o + 14] = 1; pendLive++;
  };
  const landDue = () => {
    if (pendLive === 0) return;
    for (let i = 0; i < PENDING; i++) {
      const o = i * PF;
      if (pend[o + 14] !== 0 && clock >= pend[o]) { pend[o + 14] = 0; pendLive--; land(o, pend); }
    }
  };

  const fire = (ev: Extract<GameEvent, { e: 'fire' }>) => {
    const wid = weapons.id(ev.wpn), w = weapons.fx(ev.wpn);
    const def = wid === 'unknown' ? null : WEAPONS[wid];
    const m = muzzleOf(ev.id, ev.x, ev.y, ev.z);
    if (!near(m.x, m.y, m.z) && !near(ev.hx, ev.hy, ev.hz)) return;
    const mine = ev.id === localId;
    const projectile = def?.kind === 'projectile';
    // Shot line: muzzle → the authoritative hit point (hitscan), or the launch direction (projectiles, tiny hops).
    let dx = ev.hx - m.x, dy = ev.hy - m.y, dz = ev.hz - m.z;
    let dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (projectile || dl < 0.3) { dx = ev.dx; dy = ev.dy; dz = ev.dz; dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; }
    dx /= dl; dy /= dl; dz /= dl;
    // Right vector = forward × up (horizontal), for brake petals and brass ejection.
    let rx = -dz, rz = dx;
    const rl = Math.sqrt(rx * rx + rz * rz) || 1;
    rx /= rl; rz /= rl;
    if (w.klass === 'melee') {
      if (ev.hit === -1) return;
      W.clawSlash(pools, ev.hx, ev.hy, ev.hz, rx, rz);
      return;
    }
    W.muzzle(pools, w, m.x, m.y, m.z, dx, dy, dz, rx, 0, rz);
    const gy = ground(m.x, m.y, m.z);
    if (w.light > 0) {
      lights.pulse(m.x + dx * 0.15, m.y + dy * 0.15 + 0.05, m.z + dz * 0.15, w.lightColor, w.light, w.lightRange, w.klass === 'rifle' ? 0.06 : 0.09, mine ? 1.5 : 0);
      if (m.y - gy < 2) W.groundGlow(pools, m.x + dx * 0.3, gy, m.z + dz * 0.3, w.lightColor, 0.3 + w.flashSize * 1.3, 0.4);
    }
    if (casings && w.casing !== 'none' && near(m.x, m.y, m.z, 30)) {
      // Port: back along the barrel, a touch right and up; brass flies right, slightly back.
      const bx = m.x - dx * w.ejectBack + rx * 0.035, by = m.y - dy * w.ejectBack + 0.02, bz = m.z - dz * w.ejectBack + rz * 0.035;
      W.casing(pools, w.casing, bx, by, bz, rx, 0, rz, -dx, -dy, -dz, ground(bx, by, bz));
    }
    if (projectile) {
      if (w.tracer === 'disc') P.discWhoosh(pools, m.x, m.y, m.z, m.x + dx * 1.6, m.y + dy * 1.6, m.z + dz * 1.6);
      return; // the round is an entity: its trail comes from states, its blast from 'explode'
    }
    if (w.tracer === 'bullet') W.tracer(pools, m.x, m.y, m.z, ev.hx, ev.hy, ev.hz, w.tracerColor, w.tracerGlow, w.tracerWidth);
    else if (w.tracer === 'laser') P.laserBeam(pools, m.x, m.y, m.z, ev.hx, ev.hy, ev.hz, w.tracerColor, w.tracerGlow);
    else if (w.tracer === 'water') P.waterSpray(pools, m.x, m.y, m.z, ev.hx, ev.hy, ev.hz);
    // World impacts come from `fire` (no `hit` event is sent when nothing was hit). They land when the tracer does.
    if (ev.hit === -1 && near(ev.hx, ev.hy, ev.hz, IMPACT_DIST)) {
      surfaces.classify(ev.hx, ev.hy, ev.hz, dx, dy, dz, sHit);
      const k = sHit.kind === Surface.Water && w.tracer === 'water' ? w.impact * 0.7 : w.impact;
      const delay = impactDelay(w.tracer, dl);
      impactAt(ev.hx, ev.hy, ev.hz, dx, dy, dz, k, w.decal, delay);
      if (w.klass === 'shotgun' && def) {
        // Presentation only: the authority traces 9 pellets but reports the first; scatter a few smaller impacts
        // across the cone on the same surface so the blast reads as buckshot (never used for gameplay).
        const spread = def.spreadHip * dl * 0.8;
        for (let i = 0; i < 3; i++) {
          const ox = rng.sym(spread), oy = rng.sym(spread);
          // offsets in the surface plane: tangent = n × up (or x), bitangent = n × tangent
          let tx = sHit.nz, tz = -sHit.nx, ty = 0;
          if (tx * tx + tz * tz < 1e-4) { tx = 1; tz = 0; }
          const tl = Math.sqrt(tx * tx + tz * tz); tx /= tl; tz /= tl;
          const bx = sHit.ny * tz - sHit.nz * ty, by = sHit.nz * tx - sHit.nx * tz, bz = sHit.nx * ty - sHit.ny * tx;
          const px = ev.hx + tx * ox + bx * oy, py = ev.hy + ty * ox + by * oy, pz = ev.hz + tz * ox + bz * oy;
          impactAt(px, py, pz, dx, dy, dz, 0.45, w.decal * 0.8, delay + rng.range(0, 0.05));
        }
      }
    }
  };

  const fx: Fx = {
    group,
    stats,
    update(dt, st, lid) {
      const t0 = performance.now();
      if (st) states = st;
      if (lid !== undefined) localId = lid;
      clock += dt;
      hitStop.update(dt);
      camera.getWorldPosition(camPos);
      frameDt = dt;
      states.forEach(emitContinuous);
      if (trailAcc.size > 64) trailAcc.forEach((_, id) => { if (!states.has(id)) trailAcc.delete(id); });
      landDue();
      solidPool.update(dt);
      glowPool.update(dt);
      decalPool.update(dt);
      stats.solid = solidMesh.sync(solidPool);
      stats.glow = glowMesh.sync(glowPool);
      stats.decals = decalMesh.sync(decalPool);
      stats.lights = lights.update(dt);
      stats.drawCalls = (stats.solid > 0 ? 1 : 0) + (stats.glow > 0 ? 1 : 0) + (stats.decals > 0 ? 1 : 0);
      const ms = performance.now() - t0;
      stats.cpuMs = stats.cpuMs * 0.9 + ms * 0.1;
      stats.peakCpuMs = Math.max(stats.peakCpuMs * 0.995, ms);
    },

    onGameEvent(ev, ctx) {
      if (ctx?.states) states = ctx.states;
      if (ctx?.localId !== undefined) localId = ctx.localId;
      const me = states.get(localId);
      reactCtx.localId = localId; reactCtx.hasLocal = !!me;
      if (me) { reactCtx.lx = me.x; reactCtx.ly = me.y; reactCtx.lz = me.z; }
      reactionFor(ev, reactCtx, reaction);
      if (reaction.hitStopFrames > 0) hitStop.request(reaction.hitStopFrames);

      switch (ev.e) {
        case 'fire':
          fire(ev);
          break;
        case 'hit': {
          if (!near(ev.x, ev.y, ev.z)) break;
          const victim = states.get(ev.dst), src = states.get(ev.src);
          let dx = 0, dz = 0;
          if (src) { dx = ev.x - src.x; dz = ev.z - src.z; const l = Math.sqrt(dx * dx + dz * dz) || 1; dx /= l; dz /= l; }
          P.furHit(pools, ev.x, ev.y, ev.z, victim?.species === Species.Cat, victim?.team ?? 0, ev.crit, dx, dz);
          // the comic splat pops on the viewer's side of the pet
          let cx = camPos.x - ev.x, cy = camPos.y - ev.y, cz = camPos.z - ev.z;
          const cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
          cx /= cl; cy /= cl; cz /= cl;
          if (victim && victim.kind !== EntityKind.Vehicle && victim.kind !== EntityKind.Destructible) W.comicSplat(pools, ev.x, ev.y, ev.z, cx, cy, cz, ev.crit);
          break;
        }
        case 'death': {
          const s = states.get(ev.id);
          if (!s || !near(s.x, s.y, s.z)) break;
          P.deathPoof(pools, s.x, s.y, s.z, s.species === Species.Cat);
          break;
        }
        case 'spawn': {
          const s = states.get(ev.id);
          if (s && near(s.x, s.y, s.z)) P.respawnSparkle(pools, s.x, s.y, s.z, s.team);
          break;
        }
        case 'jump': {
          const s = states.get(ev.id);
          if (!s || !near(s.x, s.y, s.z, 50)) break;
          P.jumpDust(pools, s.x, s.y, s.z, ev.double);
          break;
        }
        case 'land': {
          const s = states.get(ev.id);
          if (!s || !near(s.x, s.y, s.z, 50) || ev.impact < 4) break;
          P.landDust(pools, s.x, s.y, s.z, ev.impact);
          break;
        }
        case 'explode': {
          const gy = ground(ev.x, ev.y, ev.z);
          P.explosion(pools, ev.x, ev.y, ev.z, ev.r, gy);
          W.explosionExtras(pools, ev.x, ev.y, ev.z, ev.r, gy);
          lights.pulse(ev.x, ev.y + 0.8, ev.z, 0xff9b3d, 7 * Math.min(2, ev.r / 3), Math.max(6, ev.r * 2), 0.28, 2);
          W.groundGlow(pools, ev.x, gy, ev.z, 0xff9b3d, ev.r * 1.1, 0.9, 0.2);
          // scorch on whatever it went off against (the ground, a wall, a deck), when it's close enough to mark
          surfaces.classify(ev.x, ev.y, ev.z, 0, -1, 0, sHit);
          if (sHit.what === 0 && ev.y - gy < 1) { surfaces.classify(ev.x, gy, ev.z, 0, -1, 0, sHit); }
          if (sHit.what !== 0) mark(ev.x, sHit.what === 1 ? gy : ev.y, ev.z, Math.min(2.4, 0.3 + ev.r * 0.38), DecalKind.Scorch);
          break;
        }
        case 'pickup': {
          const s = states.get(ev.id);
          if (s && near(s.x, s.y, s.z)) P.pickupSparkle(pools, s.x, s.y, s.z);
          break;
        }
        case 'ability': {
          if (!near(ev.x, ev.y, ev.z)) break;
          if (ev.ability.startsWith('destruct:')) {
            // X1: a destructible broke (its planks/cans fly in the world view): dust and splinters
            const wall = ev.ability === 'destruct:wall_boards';
            P.destructDust(pools, ev.x, ev.y, ev.z, ground(ev.x, ev.y - 1, ev.z), wall ? 2.4 : 1.4, wall);
            break;
          }
          const s = states.get(ev.id);
          P.abilityRing(pools, ev.x, ev.y, ev.z, s?.team ?? 0, ev.ability === 'bark_blast');
          break;
        }
        default:
          break; // score, reload: HUD + audio
      }
      return reaction;
    },

    hitStop(frames) {
      if (frames && frames > 0) hitStop.request(frames);
      return hitStop.scale;
    },
    setWeaponIds(ids) { weapons.set(ids); },
    setQuality(q) {
      const t = FX_TIERS[q] ?? FX_TIERS.high;
      pools.density = t.density;
      casings = t.casings;
      decalPool.setCap(t.decals);
      lights.setCount(t.lights);
    },
    setWorld(world) { surfaces.setWorld(world ?? (heightAt ? terrainOnly(heightAt) : null)); },
    dispose() {
      scene.remove(group);
      solidMesh.dispose(); glowMesh.dispose(); decalMesh.dispose(); lights.dispose();
    },
  };
  return fx;
}
