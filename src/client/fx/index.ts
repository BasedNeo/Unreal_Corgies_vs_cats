// OWNER: L5 (juice). FX director: turns GameEvents + entity states into pooled particles, tracers, comic
// onomatopoeia and camera reactions. Three draw calls total (solid particles, glow particles, words).
//
//   const fx = createFx(ctx.scene, ctx.camera, views);           // views: EntityViews (muzzle positions)
//   bus.on('game', (ev) => { const r = fx.onGameEvent(ev); if (r.shake) cam.shake(r.shake); });
//   // each frame, after net.interpolated():
//   fx.update(dt, states, net.localEntity);
//   const presentDt = dt * fx.hitStop();                          // hit-stop: presentation only
//
// See docs/handoff/L5.md for the event → FX/shake mapping table.
import * as THREE from 'three/webgpu';
import type { EntityState, GameEvent } from '../../shared/protocol';
import { EFlag, EntityKind, Species } from '../../shared/types';
import { FxRng, ParticlePool } from './particle-pool';
import { createParticleMesh, type ParticleMesh } from './particle-mesh';
import { createOnomatopoeiaView, type OnomatopoeiaView } from './onomatopoeia-view';
import { OnomatopoeiaPicker, type WordContext } from './onomatopoeia';
import { HitStop, reactionFor, type FxReaction, type ReactionContext } from './reactions';
import { WeaponTable } from './weapon-fx';
import * as P from './presets';

export type { FxReaction } from './reactions';

/** Anything that can give a muzzle position for an entity — EntityViews satisfies this structurally. */
export interface MuzzleSource {
  get(id: number): { avatar: { muzzleWorld(target: THREE.Vector3): THREE.Vector3 } } | undefined;
}

export type FxQuality = 'low' | 'medium' | 'high';

export interface FxOptions {
  solidCapacity?: number;
  glowCapacity?: number;
  wordCapacity?: number;
  quality?: FxQuality;
  /** Terrain height for bouncing debris (e.g. worldData.height). Defaults to the event's own y. */
  heightAt?: (x: number, z: number) => number;
  /** Seed for presentation variation (deterministic labs/tests). */
  seed?: number;
}

export interface FxEventContext { localId?: number; states?: Map<number, EntityState> }

export interface FxStats { solid: number; glow: number; words: number; drawCalls: number; cpuMs: number; peakCpuMs: number }

export interface Fx {
  readonly group: THREE.Group;
  /** Advance particles (real dt). Pass the frame's entity states + local id so events can find positions. */
  update(dt: number, states?: Map<number, EntityState>, localId?: number): void;
  /** Spawns the event's FX and returns suggested camera trauma + hit-stop frames (already applied to hitStop()). */
  onGameEvent(ev: GameEvent, ctx?: FxEventContext): FxReaction;
  /** Request `frames` of hit-stop (optional) and return the current presentation time scale (0.04..1). */
  hitStop(frames?: number): number;
  /** Weapon content ids in wpn-index order (L3's table). */
  setWeaponIds(ids: readonly string[]): void;
  setQuality(q: FxQuality): void;
  readonly stats: FxStats;
  dispose(): void;
}

const DENSITY: Record<FxQuality, number> = { low: 0.45, medium: 0.75, high: 1 };
const CULL_DIST = 90;

export function createFx(scene: THREE.Scene, camera: THREE.Camera, views: MuzzleSource | null, opts: FxOptions = {}): Fx {
  const solidPool = new ParticlePool(opts.solidCapacity ?? 1400);
  const glowPool = new ParticlePool(opts.glowCapacity ?? 700);
  const solidMesh: ParticleMesh = createParticleMesh(solidPool.capacity, 'solid');
  const glowMesh: ParticleMesh = createParticleMesh(glowPool.capacity, 'glow');
  const words: OnomatopoeiaView = createOnomatopoeiaView(opts.wordCapacity ?? 14);
  const group = new THREE.Group();
  group.name = 'fx';
  group.add(solidMesh.mesh, glowMesh.mesh, words.mesh);
  scene.add(group);

  const rng = new FxRng(opts.seed ?? 0xc0ffee);
  const pools: P.FxPools = { solid: solidPool, glow: glowPool, rng, density: DENSITY[opts.quality ?? 'high'] };
  const weapons = new WeaponTable();
  const picker = new OnomatopoeiaPicker();
  const hitStop = new HitStop();
  const heightAt = opts.heightAt ?? null;

  let states: Map<number, EntityState> = new Map();
  let localId = -1;
  let clock = 0;
  const camPos = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const reaction: FxReaction = { shake: 0, hitStopFrames: 0 };
  const stats: FxStats = { solid: 0, glow: 0, words: 0, drawCalls: 0, cpuMs: 0, peakCpuMs: 0 };

  const speciesOf = (id: number) => states.get(id)?.species ?? -1;
  const weaponOf = (wpn: number) => weapons.id(wpn);
  const wordCtx: WordContext = { localId: -1, now: 0, speciesOf, weaponOf, rand: () => rng.next() };
  const reactCtx: ReactionContext = { localId: -1, lx: 0, ly: 0, lz: 0, hasLocal: false, weaponOf };

  // Per-entity accumulators for continuous emitters (sprint dust, projectile trails).
  const trailAcc = new Map<number, number>();
  let frameDt = 0;
  const emitContinuous = (s: EntityState, id: number) => {
    const cx = s.x - camPos.x, cy = s.y - camPos.y, cz = s.z - camPos.z;
    if (cx * cx + cy * cy + cz * cz > 50 * 50) return;
    if (s.kind === EntityKind.Projectile) {
      const a = (trailAcc.get(id) ?? 0) + frameDt;
      if (a >= 0.035) { P.ballTrail(pools, s.x, s.y, s.z); trailAcc.set(id, 0); } else trailAcc.set(id, a);
      return;
    }
    if (s.kind !== EntityKind.Player && s.kind !== EntityKind.Bot) return;
    const f = s.flags;
    if ((f & EFlag.Sprinting) === 0 || (f & EFlag.Grounded) === 0 || (f & EFlag.Dead) !== 0 || (f & EFlag.Stealthed) !== 0) return;
    const sp = Math.hypot(s.vx, s.vz);
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
  const word = (ev: GameEvent, x: number, y: number, z: number) => {
    // Never pop a word in the player's face (own death/jumps sit right under the camera; the HUD covers those).
    if (near(x, y, z, 3)) return;
    const pick = picker.pick(ev, wordCtx);
    if (pick) words.spawn(pick.word, x, y, z, pick.scale);
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
      solidPool.update(dt);
      glowPool.update(dt);
      stats.solid = solidMesh.sync(solidPool);
      stats.glow = glowMesh.sync(glowPool);
      words.update(dt, camera);
      stats.words = words.count;
      stats.drawCalls = (stats.solid > 0 ? 1 : 0) + (stats.glow > 0 ? 1 : 0) + (stats.words > 0 ? 1 : 0);
      const ms = performance.now() - t0;
      stats.cpuMs = stats.cpuMs * 0.9 + ms * 0.1;
      stats.peakCpuMs = Math.max(stats.peakCpuMs * 0.995, ms);
    },

    onGameEvent(ev, ctx) {
      if (ctx?.states) states = ctx.states;
      if (ctx?.localId !== undefined) localId = ctx.localId;
      wordCtx.localId = localId; wordCtx.now = clock;
      const me = states.get(localId);
      reactCtx.localId = localId; reactCtx.hasLocal = !!me;
      if (me) { reactCtx.lx = me.x; reactCtx.ly = me.y; reactCtx.lz = me.z; }
      reactionFor(ev, reactCtx, reaction);
      if (reaction.hitStopFrames > 0) hitStop.request(reaction.hitStopFrames);

      switch (ev.e) {
        case 'fire': {
          const w = weapons.fx(ev.wpn);
          const m = muzzleOf(ev.id, ev.x, ev.y, ev.z);
          if (!near(m.x, m.y, m.z) && !near(ev.hx, ev.hy, ev.hz)) break;
          P.muzzleFlash(pools, m.x, m.y, m.z, ev.dx, ev.dy, ev.dz, w.flashColor, w.flashSize);
          if (w.tracer === 'ball') P.tracer(pools, m.x, m.y, m.z, ev.hx, ev.hy, ev.hz, w.tracerColor, w.tracerGlow);
          else if (w.tracer === 'laser') P.laserBeam(pools, m.x, m.y, m.z, ev.hx, ev.hy, ev.hz, w.tracerColor, w.tracerGlow);
          else if (w.tracer === 'water') P.waterSpray(pools, m.x, m.y, m.z, ev.hx, ev.hy, ev.hz);
          else if (w.tracer === 'disc') P.discWhoosh(pools, m.x, m.y, m.z, ev.hx, ev.hy, ev.hz);
          // World impacts come from `fire` (no `hit` event is sent when nothing was hit).
          if (ev.hit === -1 && w.tracer !== 'none' && near(ev.hx, ev.hy, ev.hz, 60)) P.worldHit(pools, ev.hx, ev.hy, ev.hz, ground(ev.hx, ev.hy - 0.02, ev.hz));
          word(ev, m.x, m.y + 0.5, m.z);
          break;
        }
        case 'hit': {
          if (!near(ev.x, ev.y, ev.z)) break;
          const victim = states.get(ev.dst), src = states.get(ev.src);
          let dx = 0, dz = 0;
          if (src) { dx = ev.x - src.x; dz = ev.z - src.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
          P.furHit(pools, ev.x, ev.y, ev.z, victim?.species === Species.Cat, victim?.team ?? 0, ev.crit, dx, dz);
          word(ev, ev.x, ev.y + 0.45, ev.z);
          break;
        }
        case 'death': {
          const s = states.get(ev.id);
          if (!s || !near(s.x, s.y, s.z)) break;
          P.deathPoof(pools, s.x, s.y, s.z, s.species === Species.Cat);
          word(ev, s.x, s.y + 1.7, s.z);
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
          word(ev, s.x, s.y + 0.3, s.z);
          break;
        }
        case 'land': {
          const s = states.get(ev.id);
          if (!s || !near(s.x, s.y, s.z, 50) || ev.impact < 4) break;
          P.landDust(pools, s.x, s.y, s.z, ev.impact);
          word(ev, s.x, s.y + 0.4, s.z);
          break;
        }
        case 'explode':
          P.explosion(pools, ev.x, ev.y, ev.z, ev.r, ground(ev.x, ev.y, ev.z));
          word(ev, ev.x, ev.y + 1.4, ev.z);
          break;
        case 'pickup': {
          const s = states.get(ev.id);
          if (s && near(s.x, s.y, s.z)) { P.pickupSparkle(pools, s.x, s.y, s.z); word(ev, s.x, s.y + 1.8, s.z); }
          break;
        }
        case 'bark': {
          const s = states.get(ev.id);
          if (s && near(s.x, s.y, s.z, 45)) word(ev, s.x, s.y + 2, s.z);
          break;
        }
        case 'ability': {
          if (!near(ev.x, ev.y, ev.z)) break;
          const s = states.get(ev.id);
          P.abilityRing(pools, ev.x, ev.y, ev.z, s?.team ?? 0, ev.ability === 'bark_blast');
          word(ev, ev.x, ev.y + 2, ev.z);
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
    setQuality(q) { pools.density = DENSITY[q] ?? 1; },
    dispose() {
      scene.remove(group);
      solidMesh.dispose(); glowMesh.dispose(); words.dispose();
    },
  };
  return fx;
}
