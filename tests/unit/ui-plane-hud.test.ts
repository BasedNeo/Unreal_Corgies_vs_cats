// The RC plane cockpit strip reads everything from the plane's snapshot (docs/handoff/R1.md "Snapshot conventions").
import { describe, expect, it } from 'vitest';
import { planeReadout } from '../../src/client/ui/plane-hud';
import { EFlag, EntityKind } from '../../src/shared/types';
import { VEHICLES, packPlaneAux, vehicleIndex } from '../../src/shared/content/vehicles';
import type { EntityState } from '../../src/shared/protocol';

const PLANE = vehicleIndex('rc_plane');

function plane(over: Partial<EntityState> = {}): EntityState {
  return {
    id: 40, kind: EntityKind.Vehicle, team: 0, species: 0, cls: PLANE, seed: 0,
    x: 10, y: 14.6, z: -3, yaw: 0, pitch: 0, vx: 12, vy: -5, vz: 16, hp: 105, maxHp: 140,
    anim: 0, flags: 0, weapon: 7, ammo: packPlaneAux(0.8, 0.4), ...over,
  } as EntityState;
}

describe('plane HUD readout', () => {
  it('reads hull, throttle, airspeed and height from the snapshot', () => {
    const r = planeReadout(plane(), 2.1)!;
    expect(r.name).toBe(VEHICLES.rc_plane.name);
    expect(r.hull).toBeCloseTo(0.75, 5);
    expect(r.throttle).toBeCloseTo(0.8, 5);
    expect(r.speed).toBe(Math.round(Math.hypot(12, -5, 16)));
    expect(r.alt).toBe(Math.round(14.6 - 2.1));
    expect(r).toMatchObject({ boost: 'ready', overheat: false, stall: false, grounded: false });
  });

  it('maps the plane flags: boost / recharging, overheated gun, stall, on the ground', () => {
    expect(planeReadout(plane({ flags: EFlag.Sprinting }), 0)!.boost).toBe('on');
    expect(planeReadout(plane({ flags: EFlag.Reloading }), 0)!.boost).toBe('charging');
    const r = planeReadout(plane({ flags: EFlag.Aiming | EFlag.Crouching | EFlag.Grounded, y: 1 }), 3)!;
    expect(r).toMatchObject({ overheat: true, stall: true, grounded: true, alt: 0 });
  });

  it('uses the cat name for the cat team, and is null for karts', () => {
    expect(planeReadout(plane({ team: 1 }), 0)!.name).toBe(VEHICLES.rc_plane.catName);
    expect(planeReadout(plane({ cls: -1 }), 0)).toBeNull();
    expect(planeReadout(plane({ maxHp: 0 }), 0)!.hull).toBe(0);
  });
});
