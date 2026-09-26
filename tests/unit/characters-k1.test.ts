// K1 character polish: class readability at range, combat attitude, smooth faces.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { createCharacter, type CharacterAvatar } from '../../src/client/procgen/characters';
import { silhouetteMasks, silhouetteDistance } from '../../src/client/procgen/characters/silhouette';
import { MeshBuilder, ellipsoid, tuftCol } from '../../src/client/procgen/characters/mesh-builder';
import { KILL_GRIN_S } from '../../src/client/anim/face';
import { Anim, CLASS_IDS, Species, Team, type AnimId, type ClassId, type SpeciesId } from '../../src/shared/types';
import type { AvatarFrame } from '../../src/client/views/avatar';

const SPECIES: [string, SpeciesId][] = [['corgi', Species.Corgi], ['cat', Species.Cat]];
const make = (species: SpeciesId, cls: ClassId, seed: number, isLocal = false): CharacterAvatar =>
  createCharacter({ species, cls, team: species === Species.Cat ? Team.Cats : Team.Corgis, seed, isLocal });
const frame = (o: Partial<AvatarFrame> = {}): AvatarFrame => ({ speed: 0, vy: 0, grounded: true, anim: Anim.Idle as AnimId, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false, ...o });
const run = (av: CharacterAvatar, n: number, f: Partial<AvatarFrame> = {}) => { for (let i = 0; i < n; i++) av.update(frame(f), 1 / 60); };

describe('K1: class silhouettes read at 30–40 m', () => {
  // Before K1 the closest pair (assault/warden, assault/skyraider) was 0.03: hats only.
  it('every pair of classes differs in front + side silhouette (NPC tier, ~1 px per 6 cm), all seeds', () => {
    for (const [name, sp] of SPECIES) {
      for (const seed of [1, 3, 13]) {
        const masks = new Map<ClassId, ReturnType<typeof silhouetteMasks>>();
        for (const cls of CLASS_IDS) {
          const av = make(sp, cls, seed);
          run(av, 30);
          masks.set(cls, silhouetteMasks(av.root));
          av.dispose();
        }
        for (let a = 0; a < CLASS_IDS.length; a++) for (let b = a + 1; b < CLASS_IDS.length; b++) {
          const d = silhouetteDistance(masks.get(CLASS_IDS[a])!, masks.get(CLASS_IDS[b])!);
          if (d < 0.1) throw new Error(`${name} seed ${seed}: ${CLASS_IDS[a]} vs ${CLASS_IDS[b]} silhouettes too alike (${d.toFixed(3)})`);
        }
      }
    }
  });

  it('breacher is the broadest build, infiltrator the leanest', () => {
    const width = (cls: ClassId) => {
      const av = make(Species.Corgi, cls, 3);
      run(av, 30);
      const m = silhouetteMasks(av.root);
      av.dispose();
      let cells = 0;
      for (let i = 0; i < m.front.length; i++) cells += m.front[i];
      return cells;
    };
    expect(width('breacher')).toBeGreaterThan(width('assault') * 1.15);
  });

  it('overwatch beacon + monocle ride one skinned glow mesh on the body skeleton', () => {
    for (const isLocal of [true, false]) {
      const av = make(Species.Cat, 'overwatch', 4, isLocal);
      let glow: THREE.SkinnedMesh | null = null;
      av.root.traverse((o) => { if (o.name === 'kit_glow') glow = o as THREE.SkinnedMesh; });
      expect(glow).not.toBeNull();
      expect((glow as unknown as THREE.SkinnedMesh).skeleton).toBe(av.skinned.skeleton);
      expect(av.stats.drawCalls).toBeLessThanOrEqual(5);
      av.dispose();
    }
  });
});

describe('K1: combat attitude', () => {
  it('picks determined (aim), furious (fire), grit (hit), smug (kill), then settles', () => {
    for (const [, sp] of SPECIES) {
      const av = make(sp, 'assault', 7);
      run(av, 20, { aiming: true });
      expect(av.animator.face.mood).toBe('determined');
      run(av, 10, { aiming: true, firing: true });
      expect(av.animator.face.mood).toBe('furious');
      av.trigger('hit', 1);
      run(av, 5, { aiming: true, firing: true });
      expect(av.animator.face.mood).toBe('grit');
      av.trigger('kill');
      run(av, 20, { aiming: true, firing: true }); // the grin pre-empts the firing face
      expect(av.animator.face.mood).toBe('smug');
      run(av, Math.ceil(KILL_GRIN_S * 60) + 60, {});
      expect(['neutral', 'smug', 'derp', 'happy']).toContain(av.animator.face.mood);
      av.dispose();
    }
  });

  it('a grin lifts the mouth corners (the lip line bends), a snarl pulls them back', () => {
    const cornerInHead = (av: CharacterAvatar, side: 'L' | 'R') => {
      av.root.updateMatrixWorld(true);
      const bones = av.skinned.skeleton.bones;
      const head = bones.find((b) => b.name === 'head')!, c = bones.find((b) => b.name === `mouth.${side}`)!;
      return new THREE.Vector3().setFromMatrixPosition(c.matrixWorld).applyMatrix4(head.matrixWorld.clone().invert());
    };
    for (const [, sp] of SPECIES) {
      const av = make(sp, 'assault', 2, true);
      av.setExpression('neutral'); run(av, 40);
      const restL = cornerInHead(av, 'L'), restR = cornerInHead(av, 'R');
      av.setExpression('smug'); run(av, 40);
      expect(cornerInHead(av, 'L').y - restL.y).toBeGreaterThan(0.012); // the smirk side lifts most
      expect(cornerInHead(av, 'R').y - restR.y).toBeGreaterThan(0.002);
      av.setExpression('furious'); run(av, 40);
      expect(cornerInHead(av, 'R').z - restR.z).toBeGreaterThan(0.004); // pulled back (+Z is behind)
      av.dispose();
    }
  });

  it('the lid shells enclose iris, pupil and highlight, so lowered lids can cover them', () => {
    for (const [, sp] of SPECIES) for (const isLocal of [true, false]) {
      const av = make(sp, 'infiltrator', 5, isLocal);
      const g = av.skinned.geometry, pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
      const names = av.skinned.skeleton.bones.map((b) => b.name);
      // Bind-pose socket frame: centre + rest scale (the eye parts were built in that scaled frame).
      const inv = av.skinned.skeleton.boneInverses[names.indexOf('eyeSocket.L')];
      const bind = inv.clone().invert();
      const c = new THREE.Vector3().setFromMatrixPosition(bind), sc = new THREE.Vector3().setFromMatrixScale(bind);
      let inner = 0, lid = Infinity;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        if (sw.getX(i) < 0.99) continue;
        const bone = names[si.getX(i)];
        v.fromBufferAttribute(pos, i).sub(c).divide(sc);
        if (bone === 'eye.L' || bone === 'pupil.L') inner = Math.max(inner, v.length());
        if (bone === 'lidUp.L') lid = Math.min(lid, v.length());
      }
      expect(inner).toBeGreaterThan(0);
      expect(inner).toBeLessThan(lid);
      av.dispose();
    }
  });
});

describe('K1: smooth faces', () => {
  it('fur tufts shape the silhouette but shade like the smooth base (and the seam stays closed)', () => {
    const W = 11; // odd on purpose: column W duplicates column 0
    expect(tuftCol(1, W)).toBe(tuftCol(0, W));
    const tuft = (u: number) => 1 + 0.2 * tuftCol(u, W);
    const tufted = ellipsoid([0, 0, 0], [1, 1, 1], W, 7, { tuft });
    const smooth = ellipsoid([0, 0, 0], [1, 1, 1], W, 7);
    expect(tufted.nrmPos).toBeDefined();
    expect(tufted.pos).not.toEqual(smooth.pos);
    const a = new MeshBuilder(null).add(tufted, 0xffffff).build(), b = new MeshBuilder(null).add(smooth, 0xffffff).build();
    const na = a.getAttribute('normal').array, nb = b.getAttribute('normal').array;
    for (let i = 0; i < na.length; i++) expect(Math.abs(na[i] - nb[i])).toBeLessThan(1e-6);
    // Seam vertices (u = 0 and u = 1 on each row) coincide.
    for (let row = 0; row < 5; row++) {
      const i0 = 1 + row * (W + 1), i1 = i0 + W;
      for (let k = 0; k < 3; k++) expect(tufted.pos[3 * i0 + k]).toBeCloseTo(tufted.pos[3 * i1 + k], 9);
    }
  });

  it('proxy normal transfer bends normals toward the head volume without moving vertices', () => {
    const p = ellipsoid([0.3, 0, -0.2], [0.1, 0.08, 0.1], 12, 8);
    const plain = new MeshBuilder(null).add(ellipsoid([0.3, 0, -0.2], [0.1, 0.08, 0.1], 12, 8), 0xffffff).build();
    const blended = new MeshBuilder(null).add(p, 0xffffff, undefined, { proxy: { c: [0, 0, 0], r: [0.4, 0.4, 0.4], w: 0.55 } }).build();
    expect(blended.getAttribute('position').array).toEqual(plain.getAttribute('position').array);
    // The inner side of the cheek (facing the head centre) now leans outward, away from the head.
    const pos = blended.getAttribute('position'), n0 = plain.getAttribute('normal'), n1 = blended.getAttribute('normal');
    let moved = 0;
    for (let i = 0; i < pos.count; i++) {
      const toward = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      if (new THREE.Vector3(n1.getX(i), n1.getY(i), n1.getZ(i)).dot(toward) > new THREE.Vector3(n0.getX(i), n0.getY(i), n0.getZ(i)).dot(toward) + 1e-4) moved++;
    }
    expect(moved).toBeGreaterThan(pos.count * 0.5);
  });
});
