// W9 G4a presentation, headless: the 3D view (style-factory materials only, a draw/triangle budget, the ball on the
// carrier's back, beacons only away from home, the ring's open / blocked / relief looks, clean removal and disposal) and
// the HUD model (chip texts, carrier names, blocked rings, the stalemate clock, banners from each side's point of view).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import type { EntityState, GameEvent } from '../../src/shared/protocol';
import { Anim, EFlag, EntityKind, Species, Team } from '../../src/shared/types';
import { BA_BALL, BA_BALL_SEED, BA_GOAL_SEED, BA_REASON, BA_STAND_SEED, BallState } from '../../src/shared/content/modes';
import { createBaseAssaultView } from '../../src/client/modes/base-assault-view';
import { bannerFor, chipText, readBaseAssault } from '../../src/client/ui/base-assault-hud';

function st(p: Partial<EntityState>): EntityState {
  return { id: 1, kind: EntityKind.Prop, team: Team.Corgis, species: 0, cls: -1, seed: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 0, maxHp: 0, anim: Anim.Idle, flags: 0, weapon: 0, ammo: 0, ...p };
}
const map = (...s: EntityState[]) => new Map(s.map((x) => [x.id, x]));

/** A base-assault frame: stands + rings at (±40, 0), the corgi ball `corgi`, the cat ball `cat`, plus extras. */
function frame(corgi: Partial<EntityState>, cat: Partial<EntityState>, goals: Partial<EntityState>[] = [{}, {}], ...extra: EntityState[]): Map<number, EntityState> {
  return map(
    st({ id: 10, seed: BA_STAND_SEED, team: 0, x: -40, y: 0.2, z: 0 }),
    st({ id: 11, seed: BA_GOAL_SEED, team: 0, x: -44, y: 0.2, z: 0, maxHp: 60, ...goals[0] }),
    st({ id: 12, seed: BA_BALL_SEED, team: 0, x: -40, y: 0.2 + BA_BALL.standTop + BA_BALL.radius, z: 0, maxHp: 20, ...corgi }),
    st({ id: 20, seed: BA_STAND_SEED, team: 1, x: 40, y: 0.1, z: 0, yaw: Math.PI }),
    st({ id: 21, seed: BA_GOAL_SEED, team: 1, x: 44, y: 0.1, z: 0, maxHp: 60, ...goals[1] }),
    st({ id: 22, seed: BA_BALL_SEED, team: 1, x: 40, y: 0.1 + BA_BALL.standTop + BA_BALL.radius, z: 0, maxHp: 20, ...cat }),
    ...extra,
  );
}
const pet = (id: number, team: 0 | 1, x: number, z: number, yaw = 0, flags = EFlag.Grounded) =>
  st({ id, kind: EntityKind.Player, team, species: team === 1 ? Species.Cat : Species.Corgi, cls: 0, seed: id, x, y: 0, z, yaw, flags, hp: 100, maxHp: 100 });

describe('base-assault view (3D)', () => {
  it('draws two stands, two rings and two balls with style-factory materials, inside a small budget; beacons only away', () => {
    const scene = new THREE.Scene();
    const v = createBaseAssaultView(scene, { heightAt: (x, z) => 0.1 + 0.02 * Math.sin(x + z) });
    v.sync(frame({}, {}), -1, 1 / 60);
    expect(v.active).toBe(true);
    const s = v.stats();
    expect([s.balls, s.stands, s.rings]).toEqual([2, 2, 2]);
    expect(s.drawCalls).toBeLessThanOrEqual(34);
    expect(s.triangles).toBeLessThanOrEqual(12_000);
    scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) expect(['toon', 'glow']).toContain(mat.userData.style);
    });
    const beacon = (t: number) => scene.getObjectByName(`ba_ball_${t}`)!.getObjectByName('ba_beacon')!;
    expect(beacon(0).visible).toBe(false); // home: no beacon
    expect(beacon(1).visible).toBe(false);
    // on the stand's cup
    expect(v.ballPosition(0)!.y).toBeCloseTo(0.2 + BA_BALL.standTop + BA_BALL.radius, 5);
    v.dispose();
    expect(scene.getObjectByName('base-assault')).toBeUndefined();
  });

  it('a carried ball rides high on the carrier\'s back (behind its facing); a dropped ball hops, shows a halo and a beacon', () => {
    const scene = new THREE.Scene();
    const v = createBaseAssaultView(scene, { heightOf: () => 1.2 });
    const dog = pet(5, 0, 10, 3, 0); // yaw 0 faces -Z: its back is +Z
    v.sync(frame({}, { weapon: BallState.Carried, ammo: 5, flags: EFlag.Busy, x: 10, y: 1, z: 3 }, [{}, {}], dog), 5, 1 / 60);
    const p = v.ballPosition(1)!;
    expect(p.z).toBeGreaterThan(dog.z + 0.15);
    expect(p.y).toBeGreaterThan(0.8);
    expect(p.y).toBeLessThan(1.3);
    expect(Math.abs(p.x - dog.x)).toBeLessThan(1e-6);
    const ball = scene.getObjectByName('ba_ball_1')!;
    expect(ball.getObjectByName('ba_beacon')!.visible).toBe(true);
    expect(ball.getObjectByName('ba_halo')!.visible).toBe(false);
    // the carrier turns: the ball stays on its back
    v.sync(frame({}, { weapon: BallState.Carried, ammo: 5, flags: EFlag.Busy }, [{}, {}], { ...dog, yaw: Math.PI / 2 }), 5, 1 / 60);
    expect(v.ballPosition(1)!.x).toBeGreaterThan(dog.x + 0.15); // yaw π/2 faces -X: back is +X
    // dropped
    v.sync(frame({}, { weapon: BallState.Dropped, flags: EFlag.Busy, x: 12, y: 0.3, z: 4, hp: 19.5 }), 5, 1 / 60);
    expect(ball.getObjectByName('ba_halo')!.visible).toBe(true);
    expect(ball.getObjectByName('ba_beacon')!.visible).toBe(true);
    expect(v.ballPosition(1)!.y).toBeGreaterThan(0.3); // mid-hop
    for (let i = 0; i < 60; i++) v.sync(frame({}, { weapon: BallState.Dropped, flags: EFlag.Busy, x: 12, y: 0.3, z: 4, hp: 19 }), 5, 1 / 60);
    expect(v.ballPosition(1)!.y).toBeCloseTo(0.3, 1); // settled
    v.dispose();
  });

  it('the ring reads open (team), blocked (dull) and relief (gold glow); everything goes when the props leave the snapshot', () => {
    const scene = new THREE.Scene();
    const v = createBaseAssaultView(scene);
    const ring = () => scene.getObjectByName('ba_ring_0')!.getObjectByName('ba_ring') as THREE.Mesh;
    v.sync(frame({}, {}), -1, 1 / 60);
    const open = ring().material;
    v.sync(frame({ weapon: BallState.Carried, ammo: 7, flags: EFlag.Busy }, {}, [{ flags: EFlag.Busy }, {}]), -1, 1 / 60);
    const dull = ring().material;
    expect(dull).not.toBe(open);
    v.sync(frame({ weapon: BallState.Carried, ammo: 7 }, { weapon: BallState.Carried, ammo: 8 }, [{ weapon: 1 }, { weapon: 1 }]), -1, 1 / 60);
    expect((ring().material as THREE.Material).userData.style).toBe('glow');
    v.sync(new Map(), -1, 1 / 60);
    expect(v.active).toBe(false);
    expect(v.stats()).toMatchObject({ balls: 0, stands: 0, rings: 0, drawCalls: 0 });
    v.dispose();
  });
});

describe('base-assault HUD model', () => {
  it('reads both balls: HOME · TAKEN by name · DROPPED with the countdown; blocked rings and the stalemate clock', () => {
    expect(readBaseAssault(map(pet(1, 0, 0, 0)), 1)).toBeNull(); // not a base-assault match
    const roster = [{ pid: 'a', name: 'Rex', team: 0 as const, cls: 'assault' as const, entity: 5, bot: false, kills: 0, deaths: 0, score: 0, ping: 0 }];
    let m = readBaseAssault(frame({}, {}), 5, roster)!;
    expect(m.balls.map(chipText)).toEqual(['HOME', 'HOME']);
    expect([m.blocked, m.relief, m.reliefIn, m.localCarrying]).toEqual([[false, false], false, 0, false]);
    m = readBaseAssault(frame({ weapon: BallState.Dropped, hp: 13.2, flags: EFlag.Busy }, { weapon: BallState.Carried, ammo: 5, flags: EFlag.Busy },
      [{ flags: EFlag.Busy, hp: 41.5 }, { hp: 41.5 }], pet(5, 0, 10, 0)), 5, roster)!;
    expect(m.balls.map(chipText)).toEqual(['DROPPED · 14', 'TAKEN · Rex']);
    expect(m.blocked).toEqual([true, false]);
    expect(m.reliefIn).toBeCloseTo(41.5, 6);
    expect(m.localCarrying).toBe(true);
    // a carrier with no roster entry is named from its species; the relief hides the countdown
    m = readBaseAssault(frame({ weapon: BallState.Carried, ammo: 9 }, { weapon: BallState.Carried, ammo: 5 }, [{ weapon: 1 }, { weapon: 1 }], pet(9, 1, 0, 0), pet(5, 0, 1, 1, 0, EFlag.Dead)), 5, roster)!;
    expect(chipText(m.balls[0])).toBe('TAKEN · Cat 9');
    expect([m.relief, m.reliefIn, m.localCarrying]).toEqual([true, 0, false]); // a dead carrier isn't carrying
  });

  it('banners: each Base Assault event from both sides (and none for other score events)', () => {
    const ev = (reason: string, team: 0 | 1, pts = 0): GameEvent => ({ e: 'score', team, pts, reason });
    expect(bannerFor(ev(BA_REASON.taken, 0), 0, true)).toMatchObject({ text: 'BALL TAKEN!', team: 0, big: true, sub: expect.stringMatching(/Run it home/) });
    expect(bannerFor(ev(BA_REASON.taken, 0), 0, false)?.sub).toMatch(/Cover the carrier/);
    expect(bannerFor(ev(BA_REASON.taken, 0), 1)?.sub).toMatch(/Stop the carrier/);
    expect(bannerFor(ev(BA_REASON.captured, 1, 1), 1)).toMatchObject({ text: 'CAPTURED!', team: 1, sub: '+1 for us. Go again!' });
    expect(bannerFor(ev(BA_REASON.captured, 1, 1), 0)?.sub).toBe('+1 for the cats');
    expect(bannerFor(ev(BA_REASON.returned, 0), 0)).toMatchObject({ text: 'BALL RETURNED', sub: 'Our ball is back on its stand' });
    expect(bannerFor(ev(BA_REASON.dropped, 1), 0)).toMatchObject({ text: 'BALL DROPPED!', big: false, sub: expect.stringMatching(/Grab their ball/) });
    expect(bannerFor(ev(BA_REASON.dropped, 1), 1)?.sub).toMatch(/send it home/);
    expect(bannerFor(ev(BA_REASON.taken, 1), -1)?.sub).toBe('The cats have the corgi ball');
    expect(bannerFor(ev('kill', 0, 1), 0)).toBeNull();
    expect(bannerFor({ e: 'pickup', id: 1, item: 'golden_kibble' }, 0)).toBeNull();
  });
});
