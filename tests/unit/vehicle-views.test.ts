// V1 vehicle views: budgets (kart ≤ 3k tris / ≤ 4 draw calls), style-factory materials, and a
// headless sync of kart + terminal states (spinning wheels, flame, screen states, puff pool).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import type { EntityState } from '../../src/shared/protocol';
import { Anim, EFlag, EntityKind, Team } from '../../src/shared/types';
import { createVehicleViews, kartAssets, terminalAssets, vehicleCameraFor, mountedVehicle, mountedBodyYaw, measureObject } from '../../src/client/vehicles';

function state(p: Partial<EntityState>): EntityState {
  return { id: 1, kind: EntityKind.Vehicle, team: Team.Corgis, species: 0, cls: 0, seed: 7, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 260, maxHp: 260, anim: Anim.Idle, flags: EFlag.Grounded, weapon: -1, ammo: 100, ...p };
}

describe('vehicle views', () => {
  it('kart and terminal stay inside the style guide budgets', () => {
    for (const team of [Team.Corgis, Team.Cats]) {
      const k = kartAssets(team);
      expect(k.triangles).toBeLessThanOrEqual(3000);
      const t = terminalAssets(team);
      expect(t.triangles).toBeLessThanOrEqual(3000);
      expect(k.body.getAttribute('color')).toBeDefined();
      expect(k.body.userData.outlineReady).toBe(true);
    }
  });

  it('syncs karts and terminals from states: ≤ 4 draw calls per kart, wheels spin, flame on boost', () => {
    const scene = new THREE.Scene();
    const views = createVehicleViews(scene);
    const states = new Map<number, EntityState>();
    states.set(1, state({ id: 1, vz: -12, flags: EFlag.Grounded | EFlag.Busy | EFlag.Sprinting, weapon: 5 }));
    states.set(2, state({ id: 2, kind: EntityKind.Terminal, team: Team.Cats, x: 5, flags: EFlag.Busy, weapon: -1, hp: 5, maxHp: 20, ammo: 15 }));
    views.sync(states, 1 / 60);
    const kartRoot = scene.getObjectByName('kart_1')!;
    const m = measureObject(kartRoot);
    expect(m.drawCalls).toBeLessThanOrEqual(4);
    expect(m.triangles).toBeLessThanOrEqual(3000);
    // every material comes from the style factory
    kartRoot.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && !(o as unknown as { isLineSegments2?: boolean }).isLineSegments2) expect(['toon', 'glow']).toContain(mat.userData.style);
    });
    const wheels = scene.getObjectByName('kart_wheels') as THREE.InstancedMesh;
    const a = new THREE.Matrix4(), b = new THREE.Matrix4();
    wheels.getMatrixAt(0, a);
    for (let i = 0; i < 10; i++) views.sync(states, 1 / 60);
    wheels.getMatrixAt(0, b);
    expect(a.equals(b)).toBe(false);
    expect(scene.getObjectByName('kart_flame')!.visible).toBe(true);
    expect(views.stats().puffs).toBeGreaterThan(0);
    // removal disposes the view
    states.delete(1);
    views.sync(states, 1 / 60);
    expect(scene.getObjectByName('kart_1')).toBeUndefined();
    expect(views.stats().terminals).toBe(1);
    views.dispose();
  });

  it('chase camera widens with speed and never swings to the front while reversing', () => {
    const slow = vehicleCameraFor(state({}));
    const fast = vehicleCameraFor(state({ vz: -18, flags: EFlag.Grounded | EFlag.Sprinting }));
    expect(fast.distance).toBeGreaterThan(slow.distance);
    expect(fast.fov).toBeGreaterThan(slow.fov);
    expect(vehicleCameraFor(state({ vz: 5 })).followRate).toBe(0);
  });

  it('finds a mounted rider\'s kart', () => {
    const states = new Map<number, EntityState>();
    const kart = state({ id: 3, yaw: 1.2, weapon: 9, flags: EFlag.Busy });
    const rider = state({ id: 9, kind: EntityKind.Player, flags: EFlag.Mounted, anim: Anim.Drive });
    states.set(3, kart); states.set(9, rider);
    expect(mountedVehicle(rider, states)?.id).toBe(3);
    expect(mountedBodyYaw(rider, states)).toBe(1.2);
    expect(mountedBodyYaw({ ...rider, flags: 0 }, states)).toBeNull();
  });
});
