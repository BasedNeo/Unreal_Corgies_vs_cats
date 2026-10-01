// L1 characters: budgets, rig limits, grounding, orientation, determinism, animation stability.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { createAvatar } from '../../src/client/procgen/characters';
import { createCharacter, characterCacheSize, variantFor, HERO_TRI_BUDGET, NPC_TRI_BUDGET, type CharacterAvatar } from '../../src/client/procgen/characters';
import { Anim, CLASS_IDS, Species, Team, type AnimId, type ClassId, type SpeciesId } from '../../src/shared/types';
import type { AvatarFrame } from '../../src/client/views/avatar';

const SPECIES: [string, SpeciesId][] = [['corgi', Species.Corgi], ['cat', Species.Cat]];
const CLASSES: ClassId[] = ['assault', 'overwatch', 'breacher', 'skyraider'];
const SEEDS = [1, 7];
const MAX_BONES = 48;
const MAX_DRAWS = 6;

function make(species: SpeciesId, cls: ClassId, seed: number, isLocal = true): CharacterAvatar {
  return createCharacter({ species, cls, team: species === Species.Cat ? Team.Cats : Team.Corgis, seed, isLocal });
}

/** Run `fn` with an avatar and always dispose it (a failed expect must not leak cached kits). */
function using(av: CharacterAvatar, fn: (av: CharacterAvatar) => void): void {
  try { fn(av); } finally { av.dispose(); }
}

/** Renderable triangles + draw calls actually present under the avatar root. */
function measure(av: CharacterAvatar) {
  let tris = 0, draws = 0;
  av.root.traverse((o) => {
    const m = o as THREE.Mesh & { isLineSegments2?: boolean };
    if (m.isLineSegments2 || (o as THREE.Line).isLine) { draws++; return; }
    if (!m.isMesh) return;
    draws++;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return { tris, draws };
}

/** Skinned vertex positions in root space (CPU skinning, same math as the GPU). */
function skinnedBox(av: CharacterAvatar): THREE.Box3 {
  av.root.updateMatrixWorld(true);
  const mesh = av.skinned;
  const pos = mesh.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    box.expandByPoint(v);
  }
  return box;
}

const baseFrame = (): AvatarFrame => ({ speed: 0, vy: 0, grounded: true, anim: Anim.Idle as AnimId, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false });

function finiteRig(av: CharacterAvatar): boolean {
  for (const b of av.skinned.skeleton.bones) {
    if (!b.matrix.elements.every(Number.isFinite)) return false;
  }
  return true;
}

describe('characters: budgets, rig, grounding, orientation', () => {
  for (const [name, sp] of SPECIES) {
    for (const cls of CLASSES) {
      for (const seed of SEEDS) {
        it(`${name} ${cls} seed ${seed}`, () => {
          for (const isLocal of [true, false]) {
            using(make(sp, cls, seed, isLocal), (av) => {
              const { tris, draws } = measure(av);
              expect(tris).toBe(av.stats.triangles);
              expect(tris).toBeLessThanOrEqual(isLocal ? HERO_TRI_BUDGET : NPC_TRI_BUDGET);
              expect(draws).toBeLessThanOrEqual(MAX_DRAWS);
              expect(av.skinned.skeleton.bones.length).toBeLessThanOrEqual(MAX_BONES);
              // Feet on the ground (±2 cm) in the settled idle pose, height in the pet-scale range.
              for (let i = 0; i < 30; i++) av.update(baseFrame(), 1 / 60);
              const box = skinnedBox(av);
              expect(Math.abs(box.min.y)).toBeLessThan(0.02);
              expect(av.height).toBeGreaterThan(1.0);
              expect(av.height).toBeLessThan(1.6);
              expect(box.max.y).toBeGreaterThan(av.height - 0.05); // ears/headgear reach at least the head top
              // Faces -Z: snout and weapon muzzle are in front of the body.
              expect(av.stats.snoutTip[2]).toBeLessThan(-0.15);
              const f = baseFrame(); f.aiming = true;
              for (let i = 0; i < 30; i++) av.update(f, 1 / 60);
              const muzzle = av.muzzleWorld(new THREE.Vector3());
              expect(muzzle.z).toBeLessThan(-0.3);
              expect(muzzle.y).toBeGreaterThan(0.3);
            });
          }
        });
      }
    }
  }

  it('every class builds for both species within budget', () => {
    for (const [, sp] of SPECIES) for (const cls of CLASS_IDS) for (const isLocal of [true, false]) {
      const av = make(sp, cls, 3, isLocal);
      expect(measure(av).tris).toBeLessThanOrEqual(isLocal ? HERO_TRI_BUDGET : NPC_TRI_BUDGET);
      av.dispose();
    }
  });

  it('covers the full variant roster from seeds', () => {
    const corgi = new Set<string>(), cat = new Set<string>();
    for (let s = 1; s < 400; s++) { corgi.add(variantFor(Species.Corgi, s).name); cat.add(variantFor(Species.Cat, s).name); }
    expect([...corgi].sort()).toEqual(['red', 'sable', 'tri']);
    expect([...cat].sort()).toEqual(['chonk', 'ginger', 'siamese', 'sphynx', 'tabby', 'tuxedo']);
  });

  it('uses style-system materials, outline-safe normals and normalized skin weights', () => {
    using(make(Species.Cat, 'warden', 11), (av) => {
      const g = av.skinned.geometry;
      expect(g.userData.outlineReady).toBe(true);
      av.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) expect(['toon', 'glow']).toContain(mat.userData.style);
      });
      const w = g.getAttribute('skinWeight'), si = g.getAttribute('skinIndex');
      const nb = av.skinned.skeleton.bones.length;
      for (let i = 0; i < w.count; i++) {
        expect(Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1)).toBeLessThan(1e-4);
        expect(Math.max(si.getX(i), si.getY(i), si.getZ(i), si.getW(i))).toBeLessThan(nb);
      }
    });
  });
});

describe('characters: determinism + caching', () => {
  it('same seed → identical geometry, bone names and animation', () => {
    const snapshot = () => {
      const av = make(Species.Corgi, 'assault', 42);
      const pos = av.skinned.geometry.getAttribute('position').array as Float32Array;
      let h = 0;
      for (let i = 0; i < pos.length; i++) h = (h * 31 + Math.round(pos[i] * 1e5)) | 0;
      const f = baseFrame(); f.speed = 6.4; f.anim = Anim.Run;
      for (let i = 0; i < 120; i++) av.update(f, 1 / 60);
      const q = av.skinned.skeleton.bones.map((b) => b.matrix.elements.map((x) => x.toFixed(6)).join(',')).join('|');
      const out = { verts: pos.length / 3, hash: h, bones: av.skinned.skeleton.bones.map((b) => b.name), q, height: av.height };
      av.dispose();
      return out;
    };
    expect(characterCacheSize()).toBe(0);
    const a = snapshot();
    expect(characterCacheSize()).toBe(0); // disposed → rebuilt from scratch next time
    const b = snapshot();
    expect(b).toEqual(a);
  });

  it('shares geometry per kit, separate skeletons per instance, frees on last dispose', () => {
    const a = make(Species.Cat, 'assault', 5), b = make(Species.Cat, 'assault', 5);
    expect(a.skinned.geometry).toBe(b.skinned.geometry);
    expect(a.skinned.skeleton).not.toBe(b.skinned.skeleton);
    expect(characterCacheSize()).toBe(1);
    a.dispose();
    expect(characterCacheSize()).toBe(1);
    b.dispose();
    expect(characterCacheSize()).toBe(0);
  });

  it('createAvatar implements the Avatar contract', () => {
    const av = createAvatar({ species: Species.Corgi, cls: 'infiltrator', team: Team.Corgis, seed: 9, isLocal: false });
    expect(av.root).toBeInstanceOf(THREE.Object3D);
    expect(typeof av.update).toBe('function');
    expect(typeof av.trigger).toBe('function');
    expect(av.muzzleWorld(new THREE.Vector3()).toArray().every(Number.isFinite)).toBe(true);
    av.dispose();
    av.dispose(); // idempotent
  });
});

describe('characters: animation states stay finite and grounded', () => {
  type State = { name: string; frame: (t: number) => Partial<AvatarFrame>; trig?: (av: CharacterAvatar, i: number) => void };
  const STATES: State[] = [
    { name: 'idle', frame: () => ({}) },
    { name: 'walk', frame: () => ({ speed: 3.6, anim: Anim.Walk }) },
    { name: 'run', frame: () => ({ speed: 6.4, anim: Anim.Run }) },
    { name: 'sprint/zoomies', frame: () => ({ speed: 9.6, anim: Anim.Sprint, sprinting: true }) },
    { name: 'jump+fall', frame: (t) => ({ grounded: false, vy: 8 - 18 * (t % 1), anim: Anim.Jump }), trig: (av, i) => { if (i % 60 === 0) av.trigger('jump'); if (i % 60 === 20) av.trigger('jump'); if (i % 60 === 59) av.trigger('land', 14); } },
    { name: 'aim', frame: (t) => ({ aiming: true, aimPitch: Math.sin(t) * 1.4, aimYawOffset: Math.cos(t) * 2.5 }) },
    { name: 'fire', frame: () => ({ aiming: true, firing: true }), trig: (av, i) => { if (i % 8 === 0) av.trigger('fire', 1); } },
    { name: 'hit', frame: (t) => ({ hpFrac: Math.max(0.05, 1 - t * 0.2) }), trig: (av, i) => { if (i % 25 === 0) av.trigger('hit', 2); } },
    { name: 'death', frame: () => ({ dead: true, anim: Anim.Dead, hpFrac: 0 }) },
    { name: 'spawn', frame: () => ({}), trig: (av, i) => { if (i % 100 === 0) av.trigger('spawn'); } },
    { name: 'emote', frame: () => ({}), trig: (av, i) => { if (i % 150 === 0) av.trigger('emote'); } },
    { name: 'slide', frame: () => ({ speed: 7, anim: Anim.Slide }) },
    { name: 'swim', frame: () => ({ speed: 2, anim: Anim.Swim }) },
    { name: 'drive', frame: () => ({ anim: Anim.Drive }) },
  ];
  for (const [name, sp] of SPECIES) {
    it(`${name}: 300 frames of every state, no NaN; feet stay near the ground while walking`, () => {
      const av = make(sp, 'assault', 21);
      for (const st of STATES) {
        for (let i = 0; i < 300; i++) {
          const t = i / 60;
          st.trig?.(av, i);
          // Mix in pathological dts (0, huge) — the animator must clamp them.
          const dt = i === 100 ? 0 : i === 200 ? 0.5 : 1 / 60;
          av.update({ ...baseFrame(), ...st.frame(t) }, dt);
          if (!finiteRig(av)) throw new Error(`${name} ${st.name}: non-finite bone at frame ${i}`);
        }
        expect(av.muzzleWorld(new THREE.Vector3()).toArray().every(Number.isFinite)).toBe(true);
        if (st.name === 'walk' || st.name === 'run') {
          const box = skinnedBox(av);
          expect(box.min.y).toBeGreaterThan(-0.06);
          expect(box.min.y).toBeLessThan(0.08);
        }
      }
      av.dispose();
    });
  }

  it('the weapon points where the player aims (pitch + yaw offset)', () => {
    for (const [, sp] of SPECIES) {
      using(make(sp, 'overwatch', 8), (av) => {
        for (const [pitch, yawOff] of [[0, 0], [0.5, 0], [-0.4, 0.3], [0.9, -0.5]]) {
          const f = { ...baseFrame(), aiming: true, aimPitch: pitch, aimYawOffset: yawOff };
          for (let i = 0; i < 40; i++) av.update(f, 1 / 60);
          av.root.updateMatrixWorld(true);
          let weapon: THREE.Object3D | null = null;
          av.root.traverse((o) => { if (o.name.startsWith('weapon_') && (o as THREE.Mesh).isMesh && o.name !== 'weapon_glow') weapon = o; });
          const dir = new THREE.Vector3(0, 0, -1).transformDirection((weapon as unknown as THREE.Object3D).matrixWorld);
          const want = new THREE.Vector3(-Math.sin(yawOff) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yawOff) * Math.cos(pitch));
          expect(dir.angleTo(want)).toBeLessThan(0.05);
        }
      });
    }
  });

  it('state-only hosts still get reactions (death/spawn edges, auto recoil)', () => {
    const av = make(Species.Corgi, 'assault', 4);
    const f = baseFrame();
    for (let i = 0; i < 60; i++) av.update(f, 1 / 60);
    const before = skinnedBox(av).max.y;
    for (let i = 0; i < 90; i++) av.update({ ...f, dead: true, anim: Anim.Dead }, 1 / 60);
    const dead = skinnedBox(av);
    expect(dead.max.y).toBeLessThan(before - 0.2); // flopped over
    for (let i = 0; i < 90; i++) av.update(f, 1 / 60);
    expect(Math.abs(skinnedBox(av).max.y - before)).toBeLessThan(0.08); // popped back up
    av.dispose();
  });
});
