// X3: HARDENED weapon models — the kit contract (ids, muzzle, support grip, glow), triangle ceilings per weapon (the
// shared character budgets stay safe), outline-safe finite geometry, faction paint and determinism.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { buildWeapon, WEAPON_TRI_BUDGET } from '../../src/client/procgen/characters/weapons';
import { DETAIL } from '../../src/client/procgen/characters';
import { CLASSES } from '../../src/shared/content/classes';
import { CLASS_IDS, Team, type TeamId } from '../../src/shared/types';

const TIERS: [string, number][] = [['hero', DETAIL.hero], ['npc', DETAIL.npc]];
const TEAMS: TeamId[] = [Team.Corgis, Team.Cats];

describe('weapon models (X3)', () => {
  for (const cls of CLASS_IDS) {
    it(`${cls}: kit contract, budget, clean geometry`, () => {
      for (const [tier, q] of TIERS) for (const team of TEAMS) {
        const w = buildWeapon(cls, team, q);
        const tag = `${cls} ${tier} team ${team}`;
        expect(w.id, tag).toBe(CLASSES[cls].primary);
        // triangles never exceed the pre-X3 count for this weapon (the character budgets are shared with K2)
        const budget = WEAPON_TRI_BUDGET[w.id];
        expect(budget, tag).toBeDefined();
        expect(w.triangles, tag).toBeLessThanOrEqual(tier === 'hero' ? budget.hero : budget.npc);
        const tris = (w.geometry.index!.count + (w.glow ? w.glow.index!.count : 0)) / 3;
        expect(tris, tag).toBe(w.triangles);
        // geometry: finite positions/normals/colours, unit normals, indices in range, outline-ready
        const pos = w.geometry.getAttribute('position'), nrm = w.geometry.getAttribute('normal'), col = w.geometry.getAttribute('color');
        expect(w.geometry.userData.outlineReady, tag).toBe(true);
        for (let i = 0; i < pos.count; i++) {
          const n = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
          expect(Math.abs(n - 1), tag).toBeLessThan(1e-3);
          for (const v of [pos.getX(i), pos.getY(i), pos.getZ(i), col.getX(i), col.getY(i), col.getZ(i)]) expect(Number.isFinite(v), tag).toBe(true);
          expect(Math.min(col.getX(i), col.getY(i), col.getZ(i)), tag).toBeGreaterThanOrEqual(0);
          expect(Math.max(col.getX(i), col.getY(i), col.getZ(i)), tag).toBeLessThanOrEqual(1);
        }
        const idx = w.geometry.index!;
        for (let i = 0; i < idx.count; i++) expect(idx.getX(i), tag).toBeLessThan(pos.count);
        // the kit contract the animator relies on: barrel along -Z from a grip at the origin, muzzle at the front
        w.geometry.computeBoundingBox();
        const bb = w.geometry.boundingBox!;
        expect(w.muzzle[2], tag).toBeLessThan(-0.25);
        expect(w.muzzle[2], tag).toBeLessThanOrEqual(bb.min.z + 0.03); // nothing sticks out past the muzzle
        expect(Math.abs(w.muzzle[0]), tag).toBeLessThan(0.02);
        expect(bb.containsPoint(new THREE.Vector3(...w.leftGrip)) || bb.distanceToPoint(new THREE.Vector3(...w.leftGrip)) < 0.03, tag).toBe(true);
        expect(bb.max.z - bb.min.z, tag).toBeGreaterThan(0.35); // weighty: every gun is at least 35 cm long at pet scale
        expect(bb.max.z - bb.min.z, tag).toBeLessThan(1.25);
        // one glow part per weapon (sights, emitters, the tennis-ball rounds)
        expect(w.glow, tag).not.toBeNull();
        expect(w.finish.metal, tag).toBeGreaterThan(0);
        expect(w.finish.rough, tag).toBeGreaterThan(0.5); // battered, not glossy
        expect(w.geometry.userData.weaponFinish, tag).toEqual(w.finish);
        w.geometry.dispose(); w.glow?.dispose();
      }
    });
  }

  it('is deterministic and paints the two factions differently (same parts, different finish)', () => {
    for (const cls of CLASS_IDS) {
      const a = buildWeapon(cls, Team.Corgis, DETAIL.hero), b = buildWeapon(cls, Team.Corgis, DETAIL.hero);
      expect(Array.from(a.geometry.getAttribute('position').array)).toEqual(Array.from(b.geometry.getAttribute('position').array));
      expect(Array.from(a.geometry.getAttribute('color').array)).toEqual(Array.from(b.geometry.getAttribute('color').array));
      const c = buildWeapon(cls, Team.Cats, DETAIL.hero);
      // factions differ in paint (ochre vs oxblood) — compare mean colour
      const mean = (g: THREE.BufferGeometry) => { const a = g.getAttribute('color').array as Float32Array; let r = 0, gg = 0; for (let i = 0; i < a.length; i += 3) { r += a[i]; gg += a[i + 1]; } return [r / (a.length / 3), gg / (a.length / 3)]; };
      const [ra, ga] = mean(a.geometry), [rc, gc] = mean(c.geometry);
      expect(Math.abs(ra - rc) + Math.abs(ga - gc), cls).toBeGreaterThan(0.01);
      for (const w of [a, b, c]) { w.geometry.dispose(); w.glow?.dispose(); }
    }
  });

  it('spends detail where a pet-scale gun reads: more parts per triangle than the pre-X3 blobs', () => {
    // A part here costs 12 triangles (box/slab) where the old superellipsoid box cost 30+; the rifle carries
    // receiver, rail, handguard, barrel, brake, optic, mag, grips, stock, pad, charging handle, sling, tape, charm.
    const w = buildWeapon('assault', Team.Corgis, DETAIL.hero);
    expect(w.triangles).toBeLessThan(WEAPON_TRI_BUDGET.squeaker_rifle.hero);
    expect(w.geometry.getAttribute('position').count).toBeGreaterThan(300);
    w.geometry.dispose(); w.glow?.dispose();
  });
});
