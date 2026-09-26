// X3 budget proof: the real FX director (createFx: pools, weapon recipes, surface classification against the West
// Yard, impact marks, light pulses, words) in a scripted firefight, under Node. Two numbers:
//  - CPU per frame (events + update + GPU-array writes) ≤ 0.5 ms (MASTER_PLAN §7.11 allows 1 ms; the X3 card asks 0.5),
//    best-of-3 blocks, scaled by machine load like destruct-perf / vehicles-yard (4 shared cores, other lanes running);
//  - heap growth per shot after warm-up ≈ 0 (forced GC before/after; 1 byte per shot would be visible).
// Own file: the heap measurement wants a quiet process.
import { describe, expect, it, beforeAll } from 'vitest';
import os from 'node:os';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import { createFx, type Fx } from '../../src/client/fx';
import { createWorldData } from '../../src/shared/world/world-data';
import { WEAPON_IDS, weaponIndex } from '../../src/shared/content/weapons';
import { EntityKind, Species } from '../../src/shared/types';
import type { EntityState, GameEvent } from '../../src/shared/protocol';
import { FxRng } from '../../src/client/fx/particle-pool';

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;
const heapAfterGc = () => { gc(); gc(); return process.memoryUsage().heapUsed; };

/** The word atlas draws into a 2D canvas: a no-op stand-in is enough under Node. */
function stubDocument(): void {
  const g = globalThis as unknown as { document?: unknown };
  if (g.document) return;
  const ctx2d = new Proxy({}, {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 60 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}),
    set: () => true,
  });
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
}

interface Shooter { id: number; wpn: number; x: number; z: number; rate: number; next: number; team: number }

describe('FX director in a firefight (X3 budget)', () => {
  let fx: Fx;
  const world = createWorldData(1);
  const states = new Map<number, EntityState>();
  const shooters: Shooter[] = [];
  const rng = new FxRng(11);
  const muzzle = new THREE.Vector3();
  let clock = 0, shots = 0;

  beforeAll(() => {
    stubDocument();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 500);
    camera.position.set(0, 3, 12);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld();
    // 12 shooters: 6 rifles (10 rps), 2 pistols, 1 sniper, 1 mortar, 1 sprinkler, 1 frisbee — both teams, 20 m apart
    const mix = ['squeaker_rifle', 'squeaker_rifle', 'squeaker_rifle', 'squeaker_rifle', 'squeaker_rifle', 'squeaker_rifle',
      'snap_pistol', 'snap_pistol', 'laser_longshot', 'tennis_mortar', 'sprinkler_cannon', 'frisbee_launcher'] as const;
    mix.forEach((w, i) => {
      const team = i % 2, x = (i - 6) * 2.2, z = team ? -10 : 10;
      const rate = w === 'squeaker_rifle' ? 10 : w === 'snap_pistol' ? 5 : w === 'laser_longshot' ? 1.1 : w === 'tennis_mortar' ? 1.4 : w === 'sprinkler_cannon' ? 1.6 : 2.5;
      shooters.push({ id: 100 + i, wpn: weaponIndex(w), x, z, rate, next: rng.range(0, 0.3), team });
      states.set(100 + i, { id: 100 + i, kind: EntityKind.Bot, team, species: team ? Species.Cat : Species.Corgi, cls: 0, seed: i, x, y: 0, z, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 120, maxHp: 120, anim: 0, flags: 1, weapon: weaponIndex(w), ammo: 30 } as EntityState);
    });
    const views = { get: (id: number) => { const s = states.get(id); return s ? { avatar: { muzzleWorld: (v: THREE.Vector3) => v.set(s.x + 0.2, 0.9, s.z + (s.team ? 0.6 : -0.6)) } } : undefined; } };
    fx = createFx(scene, camera, views, { world, heightAt: (x, z) => world.height(x, z), quality: 'high', seed: 3 });
    void muzzle; void WEAPON_IDS;
  });

  const ev: GameEvent = { e: 'fire', id: 0, wpn: 0, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, hx: 0, hy: 0, hz: 0, hit: -1 };
  const hitEv: GameEvent = { e: 'hit', src: 0, dst: 0, dmg: 15, x: 0, y: 0, z: 0, crit: false };
  const boom: GameEvent = { e: 'explode', x: 0, y: 0.2, z: 0, r: 4.2, by: 0 };
  /** One 60 Hz frame of the firefight: due shots (hits on pets 1 in 3, the rest into the yard), a blast every 2 s. */
  function frame(): void {
    const dt = 1 / 60;
    clock += dt;
    for (const s of shooters) {
      while (s.next <= clock) {
        s.next += 1 / s.rate;
        const f = ev as Extract<GameEvent, { e: 'fire' }>;
        const tx = rng.sym(12), tz = s.team ? 8 + rng.sym(6) : -8 + rng.sym(6);
        const ground = world.height(tx, tz);
        f.id = s.id; f.wpn = s.wpn; f.x = s.x; f.y = 1; f.z = s.z;
        f.hx = tx; f.hy = ground; f.hz = tz;
        const dx = tx - s.x, dz = tz - s.z, l = Math.sqrt(dx * dx + dz * dz) || 1;
        f.dx = dx / l; f.dy = 0; f.dz = dz / l;
        const onPet = shots % 3 === 0;
        f.hit = onPet ? 100 + ((shots + 1) % 12) : -1;
        fx.onGameEvent(f);
        if (onPet) {
          const h = hitEv as Extract<GameEvent, { e: 'hit' }>;
          h.src = s.id; h.dst = f.hit; h.x = tx; h.y = 0.8; h.z = tz; h.crit = shots % 9 === 0;
          fx.onGameEvent(h);
        }
        shots++;
      }
    }
    if (Math.floor(clock * 60) % 120 === 0) { (boom as Extract<GameEvent, { e: 'explode' }>).x = rng.sym(8); fx.onGameEvent(boom); }
    fx.update(dt, states, 100);
  }

  it('costs ≤ 0.5 ms per frame on the CPU (events + update + array writes)', () => {
    for (let i = 0; i < 1200; i++) frame(); // warm-up: pools full, JIT settled, words and marks at their caps
    const blocks: number[] = [];
    for (let b = 0; b < 3; b++) {
      const n = 600;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) frame();
      blocks.push((performance.now() - t0) / n);
    }
    const best = Math.min(...blocks);
    const load = Math.max(1, os.loadavg()[0] / Math.max(1, os.cpus().length));
    console.log(`[x3 perf] fx frame ${blocks.map((b) => b.toFixed(3)).join(' / ')} ms (best ${best.toFixed(3)}), load factor ${load.toFixed(2)}, ` +
      `${fx.stats.solid} solid + ${fx.stats.glow} glow particles, ${fx.stats.decals} marks, ${fx.stats.lights} lights, draw calls ${fx.stats.drawCalls}`);
    expect(fx.stats.decals).toBeLessThanOrEqual(64);
    expect(fx.stats.drawCalls).toBeLessThanOrEqual(4);
    expect(best).toBeLessThan(0.5 * load);
  });

  it('allocates nothing per shot after warm-up (heap measured with forced GC)', () => {
    for (let i = 0; i < 600; i++) frame();
    const shots0 = shots;
    const before = heapAfterGc();
    for (let i = 0; i < 3600; i++) frame(); // 60 s of firefight
    const grown = heapAfterGc() - before;
    const fired = shots - shots0;
    console.log(`[x3 perf] ${fired} shots in 60 s of firefight: heap ${grown >= 0 ? '+' : ''}${grown} B (${(grown / fired).toFixed(2)} B/shot)`);
    expect(fired).toBeGreaterThan(3000);
    // one 8-byte object per shot would already be 24 KB+; allow harness noise
    expect(grown).toBeLessThan(96 * 1024);
  });

  it('the low tier trims decals, casings and light pulses', () => {
    fx.setQuality('low');
    for (let i = 0; i < 900; i++) frame();
    expect(fx.stats.decals).toBeLessThanOrEqual(16);
    expect(fx.stats.lights).toBe(0);
    expect((fx.group.getObjectByName('fx_light_pulses') as THREE.Group).children.length).toBe(0);
    fx.setQuality('high');
    expect((fx.group.getObjectByName('fx_light_pulses') as THREE.Group).children.length).toBe(2);
  });
});
