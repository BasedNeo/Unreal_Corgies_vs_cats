// S1 client: contextual Interact targets (the prompt + picker gate), the pickup-event buff tracker, and a
// headless sync of the interaction views (budgets, style-factory materials, states → visibility).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import type { EntityState } from '../../src/shared/protocol';
import { Anim, EFlag, EntityKind, Team } from '../../src/shared/types';
import { terminalIndex, terminalKindAt } from '../../src/shared/content/terminals';
import { PICKUP_IDS, PICKUPS } from '../../src/shared/content/pickups';
import { objectiveChainIndex, OBJECTIVE_CHAINS } from '../../src/shared/content/objectives';
import { findInteractTarget, atOwnOrdnanceKiosk, BuffTracker, createInteractViews, kioskAssets } from '../../src/client/interact';
import { measureObject } from '../../src/client/vehicles';

const ORD = terminalIndex('ordnance_terminal');
function st(p: Partial<EntityState>): EntityState {
  return { id: 1, kind: EntityKind.Player, team: Team.Corgis, species: 0, cls: 0, seed: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 100, maxHp: 100, anim: Anim.Idle, flags: EFlag.Grounded, weapon: 0, ammo: 0, ...p };
}
const map = (...s: EntityState[]) => new Map(s.map((x) => [x.id, x]));

describe('interact targets (prompts)', () => {
  it('own-team Ordnance Kiosk in reach → "change kit"; enemy kiosk or out of reach → nothing', () => {
    const me = st({ id: 1 });
    const kiosk = st({ id: 2, kind: EntityKind.Terminal, cls: ORD, x: 2 });
    expect(findInteractTarget(map(me, kiosk), me)).toMatchObject({ kind: 'ordnance', verb: 'change kit', id: 2, ready: true });
    expect(atOwnOrdnanceKiosk(map(me, kiosk), me)).toBe(true);
    expect(findInteractTarget(map(me, { ...kiosk, team: Team.Cats }), me)).toBeNull();
    expect(findInteractTarget(map(me, { ...kiosk, x: 3.2 }), me)).toBeNull();
    expect(findInteractTarget(map({ ...me, flags: EFlag.Dead }, kiosk), { ...me, flags: EFlag.Dead })).toBeNull();
    expect(terminalKindAt(-1)).toBe('vehicle'); // V1's kart terminals are sent with cls -1
    expect(terminalKindAt(ORD)).toBe('ordnance');
  });

  it('Kart-O-Matic: vend, cooling countdown (greyed), kart out; a kart in reach wins; seated → hop out', () => {
    const me = st({ id: 1 });
    const kt = st({ id: 3, kind: EntityKind.Terminal, cls: -1, x: 1.5, weapon: -1 });
    expect(findInteractTarget(map(me, kt), me)).toMatchObject({ kind: 'kart_terminal', verb: 'vend a kart', ready: true });
    expect(findInteractTarget(map(me, { ...kt, flags: EFlag.Busy, ammo: 12 }), me)).toMatchObject({ verb: 'cooling 12 s', ready: false });
    const kart = st({ id: 4, kind: EntityKind.Vehicle, cls: 0, x: -2, weapon: -1, hp: 260 });
    expect(findInteractTarget(map(me, kt, kart), me)).toMatchObject({ kind: 'kart', verb: 'hop in' });
    expect(findInteractTarget(map(me, kt, { ...kart, weapon: 9 }), me)?.kind).toBe('kart_terminal'); // taken
    const seated = { ...me, flags: EFlag.Mounted };
    expect(findInteractTarget(map(seated, { ...kart, weapon: 1 }), seated)).toMatchObject({ kind: 'dismount', verb: 'hop out' });
  });

  it('objective beacon: interact steps prompt within their radius, hold steps do not', () => {
    const me = st({ id: 1, x: 47, z: 80 });
    const chain = objectiveChainIndex('yard_squeaker');
    const b = st({ id: 9, kind: EntityKind.Prop, cls: chain, x: 47, z: 78.4, weapon: 0 });
    expect(findInteractTarget(map(me, b), me)).toMatchObject({ kind: 'objective', verb: 'grab the Squeaker' });
    expect(findInteractTarget(map(me, { ...b, weapon: 1 }), me)).toBeNull(); // hold step
    expect(findInteractTarget(map(me, { ...b, weapon: -1 }), me)).toBeNull(); // inactive
    const cat = { ...me, team: Team.Cats };
    expect(findInteractTarget(map(cat, b), cat)).toBeNull(); // not their mission
    expect(OBJECTIVE_CHAINS.yard_squeaker.steps.length).toBe(3);
  });
});

describe('buff tracker (HUD chips from pickup events)', () => {
  it('tracks timed cores per entity, refreshes, expires, clears on death / restart; counts local kibble', () => {
    const t = new BuffTracker();
    t.onEvent({ e: 'pickup', id: 1, item: 'overclock' }, 0, 1);
    t.onEvent({ e: 'pickup', id: 1, item: 'thick_fur' }, 5, 1);
    expect(t.active(1, 6).map((b) => b.id)).toEqual(['overclock', 'thick_fur']);
    t.onEvent({ e: 'pickup', id: 1, item: 'overclock' }, 10, 1);
    expect(t.active(1, 25).map((b) => b.id)).toEqual(['overclock', 'thick_fur']); // refreshed to 30
    expect(t.active(1, 30.5).map((b) => b.id)).toEqual([]);
    t.onEvent({ e: 'pickup', id: 2, item: 'zoomies_plus' }, 0, 1);
    t.onEvent({ e: 'death', id: 2, by: 3 }, 1, 1);
    expect(t.active(2, 1)).toEqual([]);
    t.onEvent({ e: 'pickup', id: 1, item: 'golden_kibble' }, 0, 1);
    t.onEvent({ e: 'pickup', id: 7, item: 'golden_kibble' }, 0, 1);
    expect(t.kibble).toBe(1);
    t.onEvent({ e: 'pickup', id: 1, item: 'squeaky_clean' }, 0, 1);
    t.onEvent({ e: 'score', team: 0, pts: 0, reason: 'reset' }, 1, 1);
    expect(t.kibble).toBe(0);
    expect(t.active(1, 1)).toEqual([]);
  });

  it('snapshot flags decide which buffs run: a late joiner sees them, an early end drops them after a grace', () => {
    const t = new BuffTracker();
    t.syncFlags(4, EFlag.BuffZoomies | EFlag.BuffSqueaky, 10); // joined mid-buff: no pickup event ever seen
    expect(t.active(4, 10).map((b) => b.id).sort()).toEqual(['squeaky_clean', 'zoomies_plus']);
    t.syncFlags(4, EFlag.BuffSqueaky, 12); // Zoomies+ ended (flag cleared)
    expect(t.active(4, 12).map((b) => b.id)).toEqual(['squeaky_clean']);
    // the pickup event can arrive before the interpolated state carries the flag: no flicker inside the grace
    t.onEvent({ e: 'pickup', id: 4, item: 'overclock' }, 20, 4);
    t.syncFlags(4, EFlag.BuffSqueaky, 20.2);
    expect(t.active(4, 20.2).map((b) => b.id).sort()).toEqual(['overclock', 'squeaky_clean']);
    t.syncFlags(4, EFlag.BuffSqueaky, 21);
    expect(t.active(4, 21).map((b) => b.id)).toEqual(['squeaky_clean']);
  });
});

describe('interact views', () => {
  it('kiosk budget + headless sync: kiosks, cores (ghost while refilling), kibble, beacon; style materials only', () => {
    for (const team of [Team.Corgis, Team.Cats]) expect(kioskAssets(team).triangles).toBeLessThanOrEqual(6000);
    const scene = new THREE.Scene();
    const v = createInteractViews(scene);
    const pk = (id: number, item: (typeof PICKUP_IDS)[number], p: Partial<EntityState> = {}) =>
      st({ id, kind: EntityKind.Pickup, team: Team.Neutral, cls: PICKUP_IDS.indexOf(item), y: 0.8, seed: id, ...p });
    const states = map(
      st({ id: 1, kind: EntityKind.Terminal, cls: ORD }),
      st({ id: 2, kind: EntityKind.Terminal, cls: -1, x: 8 }), // a Kart-O-Matic: not ours to draw
      pk(10, 'overclock', { x: 3 }),
      pk(11, 'thick_fur', { x: 5, flags: EFlag.Busy, ammo: 10, hp: 25, maxHp: 35 }),
      pk(20, 'golden_kibble', { x: -3, y: 0.55 }),
      pk(21, 'golden_kibble', { x: -5, y: 0.55, flags: EFlag.Busy, ammo: 40 }),
      st({ id: 30, kind: EntityKind.Prop, cls: objectiveChainIndex('yard_squeaker'), weapon: 1, ammo: 50, x: 20 }),
    );
    v.sync(states, 1 / 60);
    const s = v.stats();
    expect(s).toMatchObject({ kiosks: 1, cores: 2, kibble: 1, beacon: true });
    const kiosk = scene.getObjectByName('ordnance_1')!;
    expect(measureObject(kiosk).drawCalls).toBeLessThanOrEqual(10);
    expect(scene.getObjectByName('ordnance_2')).toBeUndefined();
    scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && !(o as unknown as { isLineSegments2?: boolean }).isLineSegments2) expect(['toon', 'glow']).toContain(mat.userData.style);
    });
    // Kit swap bounce + a kibble pickup pop don't throw; the collected kibble disappears after its pop.
    v.onGameEvent({ e: 'ability', id: 1, ability: 'kit_swap', x: 0, y: 0, z: 0 });
    for (let i = 0; i < 30; i++) v.sync(states, 1 / 60);
    expect(v.stats().drawCalls).toBeLessThanOrEqual(60);
    expect(PICKUPS.golden_kibble.kind).toBe('collectible');
    v.dispose();
    expect(scene.getObjectByName('interact')).toBeUndefined();
  });
});
