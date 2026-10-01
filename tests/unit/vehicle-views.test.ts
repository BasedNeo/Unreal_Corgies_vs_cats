// V1 vehicle views: budgets (kart ≤ 3k tris / ≤ 4 draw calls), style-factory materials, and a
// headless sync of kart + terminal states (spinning wheels, flame, screen states, puff pool).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import type { EntityState } from '../../src/shared/protocol';
import { Anim, EFlag, EntityKind, Team } from '../../src/shared/types';
import { createVehicleViews, kartAssets, terminalAssets, planeAssets, hangarAssets, vehicleCameraFor, mountedVehicle, mountedBodyYaw, mountedBodyTilt, measureObject } from '../../src/client/vehicles';
import { packPlaneAux, vehicleIndex, VEHICLES } from '../../src/shared/content/vehicles';
import { terminalIndex } from '../../src/shared/content/terminals';

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

// ---------------------------------------------------------------------------------------------
// R1: RC plane + Rooftop Hangar views
// ---------------------------------------------------------------------------------------------
const PLANE_CLS = vehicleIndex('rc_plane');
const planeState = (p: Partial<EntityState>): EntityState => state({ cls: PLANE_CLS, hp: 140, maxHp: 140, ammo: packPlaneAux(0, 0), ...p });

describe('plane views (R1)', () => {
  it('plane and hangar stay inside the budgets, style-factory materials only', () => {
    for (const team of [Team.Corgis, Team.Cats]) {
      const a = planeAssets(team);
      expect(a.triangles).toBeLessThanOrEqual(3600);
      expect(a.body.getAttribute('color')).toBeDefined();
      expect(a.body.userData.outlineReady).toBe(true);
      expect('lines' in a).toBe(false);                   // W13: no crease-ink lines
    }
    expect(hangarAssets().triangles).toBeLessThanOrEqual(3500);
  });

  it('syncs planes: ≤ 5 draw calls, banks from the snapshot, the prop spins with throttle, booster flame', () => {
    const scene = new THREE.Scene();
    const views = createVehicleViews(scene);
    const states = new Map<number, EntityState>();
    const s = planeState({ id: 1, vz: -20, flags: EFlag.Busy | EFlag.Sprinting, weapon: 5, ammo: packPlaneAux(1, 0.8), pitch: 0.2, y: 12 });
    states.set(1, s);
    states.set(2, state({ id: 2, kind: EntityKind.Terminal, team: Team.Neutral, cls: terminalIndex('plane_hangar'), x: 5, flags: 0, weapon: -1, hp: 25, maxHp: 25, ammo: 0 }));
    views.sync(states, 1 / 60);
    const root = scene.getObjectByName('plane_1')!;
    expect(root).toBeDefined();
    expect(scene.getObjectByName('kart_1')).toBeUndefined();
    const m = measureObject(root);
    console.log(`[plane view] ${m.triangles} tris, ${m.drawCalls} draws (boosting, prop blurred)`);
    expect(m.drawCalls).toBeLessThanOrEqual(5);
    expect(m.triangles).toBeLessThanOrEqual(3600);
    root.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && !(o as unknown as { isLineSegments2?: boolean }).isLineSegments2) expect(['toon', 'glow']).toContain(mat.userData.style);
    });
    root.traverse((o) => { if ((o as unknown as { isLineSegments2?: boolean }).isLineSegments2) expect(o.userData.styleInk).toBe(true); });
    // Bank eases toward the snapshot roll (no snapping), pitch follows the state, the root sits on the pivot.
    const r0 = root.rotation.z;
    expect(r0).toBeGreaterThan(0);
    expect(r0).toBeLessThan(0.8);
    for (let i = 0; i < 60; i++) views.sync(states, 1 / 60);
    expect(root.rotation.z).toBeCloseTo(0.8, 2);
    expect(root.rotation.x).toBeCloseTo(0.2, 5);
    expect(root.position.y).toBeCloseTo(12 + VEHICLES.rc_plane.pivotY, 5);
    // Propeller: fast at full throttle (whirl strokes on), slow at idle.
    const prop = scene.getObjectByName('plane_prop')!;
    const a0 = prop.rotation.z; views.sync(states, 1 / 60); const fast = Math.abs(prop.rotation.z - a0);
    expect(scene.getObjectByName('plane_whirl')!.visible).toBe(true);
    expect(scene.getObjectByName('plane_flame')!.visible).toBe(true);
    states.set(1, { ...s, ammo: packPlaneAux(0, 0), vz: 0, flags: EFlag.Busy | EFlag.Grounded });
    for (let i = 0; i < 90; i++) views.sync(states, 1 / 60);
    const a1 = prop.rotation.z; views.sync(states, 1 / 60); const slow = Math.abs(prop.rotation.z - a1);
    expect(slow).toBeLessThan(fast);
    expect(scene.getObjectByName('plane_whirl')!.visible).toBe(false);
    expect(scene.getObjectByName('plane_flame')!.visible).toBe(false);
    // The hangar: kiosk + spinning sign + runway markings (no ink on the decals).
    const hangar = scene.getObjectByName('hangar_2')!;
    expect(hangar).toBeDefined();
    expect(measureObject(hangar).drawCalls).toBeLessThanOrEqual(5);
    expect(scene.getObjectByName('hangar_runway')).toBeDefined();
    expect(views.stats().planes).toBe(1);
    expect(views.stats().terminals).toBe(1);
    states.delete(1); states.delete(2);
    views.sync(states, 1 / 60);
    expect(scene.getObjectByName('plane_1')).toBeUndefined();
    expect(scene.getObjectByName('hangar_runway')).toBeUndefined();
    views.dispose();
  });

  it('plane chase camera: longer and higher than the kart\'s, follows the plane\'s pitch when idle', () => {
    const kart = vehicleCameraFor(state({ vz: -15 }));
    const plane = vehicleCameraFor(planeState({ vz: -20, pitch: 0.3, flags: EFlag.Busy }));
    expect(plane.distance).toBeGreaterThan(kart.distance);
    expect(plane.height).toBeGreaterThan(kart.height);
    expect(plane.pitch).toBeCloseTo(0.3, 5);
    expect(plane.pitchFollow).toBeGreaterThan(0);
    expect(kart.pitchFollow).toBe(0);
    const boost = vehicleCameraFor(planeState({ vz: -27, flags: EFlag.Busy | EFlag.Sprinting }));
    expect(boost.fov).toBeGreaterThan(plane.fov);
  });

  it('tilts a plane pilot with the plane (not kart drivers)', () => {
    const states = new Map<number, EntityState>();
    const plane = planeState({ id: 3, yaw: 0.7, pitch: 0.25, weapon: 9, flags: EFlag.Busy, ammo: packPlaneAux(0.5, -0.6) });
    const rider = state({ id: 9, kind: EntityKind.Player, flags: EFlag.Mounted, anim: Anim.Drive });
    states.set(3, plane); states.set(9, rider);
    expect(mountedBodyYaw(rider, states)).toBe(0.7);
    expect(mountedBodyTilt(rider, states)).toEqual({ pitch: 0.25, roll: -0.6 });
    states.set(3, state({ id: 3, weapon: 9, flags: EFlag.Busy }));
    expect(mountedBodyTilt(rider, states)).toBeNull();
  });
});
