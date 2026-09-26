// C3 looks on the procedural characters: budgets + style audit for every coat × class × team × tier and every
// neckwear, K1 class silhouettes and team-colour readability unchanged by any look, applyLook idempotent and leak-free.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  createCharacter, characterCacheSize, variantFor, breedFor, prewarmCharacters, releasePrewarmedCharacters, HERO_TRI_BUDGET, NPC_TRI_BUDGET, type CharacterAvatar,
} from '../../src/client/procgen/characters';
import { applyLook, wearsLooks, NECK_TRI_BUDGET, neckwearCacheSize } from '../../src/client/procgen/cosmetics';
import { teamRead } from '../../src/client/procgen/cosmetics/readability';
import { silhouetteMasks, silhouetteDistance } from '../../src/client/procgen/characters/silhouette';
import { createBossAvatar } from '../../src/client/procgen/boss';
import { cosmeticsFor, defaultLook, randomLook, type Look } from '../../src/shared/content/cosmetics';
import { Anim, CLASS_IDS, Species, Team, type AnimId, type ClassId, type SpeciesId, type TeamId } from '../../src/shared/types';
import type { AvatarFrame } from '../../src/client/views/avatar';

const SPECIES: [string, SpeciesId][] = [['corgi', Species.Corgi], ['cat', Species.Cat]];
const TEAMS: TeamId[] = [Team.Corgis, Team.Cats];
const frame = (o: Partial<AvatarFrame> = {}): AvatarFrame => ({ speed: 0, vy: 0, grounded: true, anim: Anim.Idle as AnimId, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false, ...o });
const settle = (av: CharacterAvatar, n = 30, f: Partial<AvatarFrame> = {}) => { for (let i = 0; i < n; i++) av.update(frame(f), 1 / 60); };
const ids = (sp: SpeciesId, slot: 'coat' | 'neck') => cosmeticsFor(sp, slot).map((c) => c.id);
const make = (species: SpeciesId, cls: ClassId, look: Look | null, o: { team?: TeamId; seed?: number; isLocal?: boolean } = {}) =>
  createCharacter({ species, cls, team: o.team ?? (species === Species.Cat ? Team.Cats : Team.Corgis), seed: o.seed ?? 3, isLocal: o.isLocal ?? false, look });
/** The first seed with this breed (chonk / sphynx cats keep their body under any look). */
const seedOfBreed = (sp: SpeciesId, breed: string) => { for (let s = 1; s < 500; s++) if (breedFor(sp, s) === breed) return s; throw new Error(breed); };

/** The char-audit rules (tools/char-audit.mjs): budget, draws, style-system materials, ink on rigid parts only. */
function audit(av: CharacterAvatar, budget: number): string[] {
  const errors: string[] = [];
  let tris = 0, draws = 0;
  av.root.traverse((o) => {
    const m = o as THREE.Mesh & { isLineSegments2?: boolean };
    if (m.isLineSegments2) { draws++; if ((o.parent as THREE.SkinnedMesh | null)?.isSkinnedMesh) errors.push('crease ink on a skinned mesh'); return; }
    if (!m.isMesh) return;
    draws++;
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
    for (const mat of [m.material].flat()) {
      if (!['toon', 'glow'].includes(mat.userData?.style)) errors.push(`${o.name}: material not from the style system`);
      if (mat.userData?.style === 'toon' && (o as THREE.SkinnedMesh).isSkinnedMesh && !m.geometry.userData.outlineReady) errors.push(`${o.name}: ink hull without outline-safe normals`);
    }
    const toonRigid = !(o as THREE.SkinnedMesh).isSkinnedMesh && [m.material].flat().some((mat) => mat.userData?.style === 'toon');
    if (toonRigid && !o.children.some((c) => c.userData.styleInk)) errors.push(`${o.name}: rigid toon mesh without crease ink`);
  });
  if (tris !== av.stats.triangles) errors.push(`stats.triangles ${av.stats.triangles} != measured ${tris}`);
  if (tris > budget) errors.push(`${tris} tris > ${budget}`);
  if (draws !== av.stats.drawCalls) errors.push(`stats.drawCalls ${av.stats.drawCalls} != measured ${draws}`);
  if (draws > 6) errors.push(`${draws} draws > 6`);
  if (av.skinned.skeleton.bones.length > 48) errors.push('bones > 48');
  return errors;
}

describe('C3 looks: budgets + style audit', () => {
  for (const [name, sp] of SPECIES) {
    it(`${name}: every coat × every class × both teams × both tiers builds within the kit budget and passes the style audit`, () => {
      const errors: string[] = [];
      for (const coat of ids(sp, 'coat')) for (const cls of CLASS_IDS) for (const team of TEAMS) for (const isLocal of [true, false]) {
        const av = make(sp, cls, { coat }, { team, isLocal });
        try {
          expect(av.stats.look?.coat).toBe(coat);
          for (const e of audit(av, isLocal ? HERO_TRI_BUDGET : NPC_TRI_BUDGET)) errors.push(`${coat} ${cls} team ${team} ${isLocal ? 'hero' : 'npc'}: ${e}`);
        } finally { av.dispose(); }
      }
      expect(errors).toEqual([]);
      expect(characterCacheSize()).toBe(0);
    });

    it(`${name}: every neckwear on every class, breed and tier stays in budget (the team collar pays for it)`, () => {
      const errors: string[] = [];
      const seeds = sp === Species.Cat ? [seedOfBreed(sp, 'cat'), seedOfBreed(sp, 'chonk'), seedOfBreed(sp, 'sphynx')] : [3];
      for (const neck of ids(sp, 'neck')) for (const cls of CLASS_IDS) for (const seed of seeds) for (const isLocal of [true, false]) {
        const last = ids(sp, 'coat')[3];
        const av = make(sp, cls, { neck, coat: last }, { seed, isLocal });
        try {
          const nw = av.root.getObjectByName('neckwear') as THREE.SkinnedMesh | undefined;
          if (neck === 'neck_none') { if (nw) errors.push(`${cls}: neck_none built a neckwear mesh`); }
          else {
            if (!nw) { errors.push(`${neck} ${cls}: no neckwear mesh`); continue; }
            const t = nw.geometry.index!.count / 3;
            if (t > NECK_TRI_BUDGET) errors.push(`${neck}: ${t} tris > ${NECK_TRI_BUDGET}`);
            if (nw.skeleton !== av.skinned.skeleton) errors.push(`${neck}: not on the body skeleton`);
          }
          for (const e of audit(av, isLocal ? HERO_TRI_BUDGET : NPC_TRI_BUDGET)) errors.push(`${neck} ${cls} seed ${seed} ${isLocal ? 'hero' : 'npc'}: ${e}`);
        } finally { av.dispose(); }
      }
      expect(errors).toEqual([]);
      expect(characterCacheSize()).toBe(0);
      expect(neckwearCacheSize()).toBe(0);
    });
  }

  it('neckwear rides the neck: it stays at the throat through aim, zoomies and the death flop', () => {
    for (const [, sp] of SPECIES) for (const neck of ['neck_bandana', 'neck_spiked']) {
      const av = make(sp, 'assault', { neck }, { isLocal: true });
      const neckBone = av.skinned.skeleton.bones.find((b) => b.name === 'neck')!;
      const nw = av.root.getObjectByName('neckwear') as THREE.SkinnedMesh;
      for (const pose of [{}, { aiming: true, aimPitch: 1.2 }, { aiming: true, aimPitch: -1.2 }, { speed: 9.6, anim: Anim.Sprint as AnimId, sprinting: true }, { dead: true, anim: Anim.Dead as AnimId, hpFrac: 0 }]) {
        settle(av, 50, pose);
        av.root.updateMatrixWorld(true);
        const box = new THREE.Box3(), v = new THREE.Vector3(), pos = nw.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) box.expandByPoint(nw.applyBoneTransform(i, v.fromBufferAttribute(pos, i)));
        const n = new THREE.Vector3().setFromMatrixPosition(neckBone.matrixWorld);
        expect(box.getCenter(v).distanceTo(n)).toBeLessThan(0.16);
      }
      av.dispose();
    }
  });
});

describe('C3 looks: class silhouettes (K1 metric) and team colours unchanged', () => {
  it('a coat only repaints: same positions, indices and skinning as the classic body, only colours differ', () => {
    for (const [, sp] of SPECIES) for (const cls of CLASS_IDS) {
      const classic = make(sp, cls, null);
      const g0 = classic.skinned.geometry;
      for (const coat of ids(sp, 'coat')) {
        const av = make(sp, cls, { coat });
        const g = av.skinned.geometry;
        expect(g.getAttribute('position').array).toEqual(g0.getAttribute('position').array);
        expect(g.index!.array).toEqual(g0.index!.array);
        expect(g.getAttribute('skinIndex').array).toEqual(g0.getAttribute('skinIndex').array);
        if (av.stats.variant !== classic.stats.variant) expect(g.getAttribute('color').array).not.toEqual(g0.getAttribute('color').array);
        av.dispose();
      }
      classic.dispose();
    }
  });

  it('every class pair stays ≥ 0.10 apart with any neckwear (K1 seeds 1/3/13) and moves < 0.01 from the classic look', () => {
    for (const [name, sp] of SPECIES) for (const seed of [1, 3, 13]) {
      const masksOf = (look: Look | null) => {
        const m = new Map<ClassId, ReturnType<typeof silhouetteMasks>>();
        for (const cls of CLASS_IDS) { const av = make(sp, cls, look, { seed }); settle(av); m.set(cls, silhouetteMasks(av.root)); av.dispose(); }
        return m;
      };
      const base = masksOf(null);
      for (const neck of ids(sp, 'neck')) {
        const m = masksOf({ neck });
        for (let a = 0; a < CLASS_IDS.length; a++) {
          const A = CLASS_IDS[a];
          expect(silhouetteDistance(m.get(A)!, base.get(A)!), `${name} ${neck} ${A} vs classic`).toBeLessThan(0.01);
          for (let b = a + 1; b < CLASS_IDS.length; b++) {
            const B = CLASS_IDS[b];
            const d = silhouetteDistance(m.get(A)!, m.get(B)!), d0 = silhouetteDistance(base.get(A)!, base.get(B)!);
            expect(d, `${name} seed ${seed} ${neck}: ${A}/${B}`).toBeGreaterThanOrEqual(0.1);
            expect(Math.abs(d - d0)).toBeLessThan(0.01);
          }
        }
      }
    }
  });

  for (const [name, sp] of SPECIES) {
    it(`${name}: no look adds enemy colour or costs more than 1% of the visible team colour (both teams, NPC tier)`, () => {
      const looks: Look[] = [...ids(sp, 'coat').map((coat) => ({ coat })), ...ids(sp, 'neck').map((neck) => ({ neck }))];
      for (const team of TEAMS) for (const cls of CLASS_IDS) {
        const classic = make(sp, cls, null, { team });
        settle(classic);
        const r0 = teamRead(classic.root, team);
        classic.dispose();
        expect(r0.team).toBeGreaterThan(0.05);
        for (const look of looks) {
          const av = make(sp, cls, look, { team });
          settle(av);
          const r = teamRead(av.root, team);
          av.dispose();
          const tag = `${name} ${cls} team ${team} ${JSON.stringify(look)}`;
          expect(r.enemy, tag).toBeLessThanOrEqual(r0.enemy);
          expect(r.team, tag).toBeGreaterThanOrEqual(r0.team - 0.01);
        }
      }
    });
  }
});

describe('C3 applyLook', () => {
  const meshes = (av: CharacterAvatar) => { const out: THREE.Object3D[] = []; av.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o); }); return out; };
  const listenerCount = (o: object) => {
    const l = (o as { _listeners?: Record<string, unknown[]> })._listeners;
    return l ? Object.values(l).reduce((a, x) => a + x.length, 0) : 0;
  };

  it('is idempotent, releases what it replaces (renderer dispose + cache refs) and leaves no extra meshes or listeners', () => {
    for (const [, sp] of SPECIES) {
      const av = make(sp, 'overwatch', null, { isLocal: true });
      const before = meshes(av).length;
      const skeleton = av.skinned.skeleton, weapon = meshes(av).find((m) => m.name.startsWith('weapon_') && m.name !== 'weapon_glow')!;
      // A renderer subscribes to 'dispose' on every drawn object (three RenderObject); count what gets released.
      const released = new Set<THREE.Object3D>();
      const watch = () => { for (const m of meshes(av)) if (!m.userData.c3watched) { m.userData.c3watched = true; m.addEventListener('dispose', () => released.add(m)); } };
      watch();
      const [coatA, coatB] = [ids(sp, 'coat')[1], ids(sp, 'coat')[2]];
      const look: Look = { coat: coatA, neck: 'neck_bandana' };
      expect(applyLook(av, look)).toBe(true);
      const body1 = av.skinned, neck1 = av.root.getObjectByName('neckwear')!;
      expect(meshes(av).length).toBe(before + 1);
      expect(released.size).toBe(1); // the classic body
      watch();
      expect(applyLook(av, { ...look })).toBe(false); // same look again: nothing changes
      expect(applyLook(av, look)).toBe(false);
      expect(av.skinned).toBe(body1);
      expect(av.root.getObjectByName('neckwear')).toBe(neck1);
      expect(meshes(av).length).toBe(before + 1);
      expect(released.size).toBe(1);
      // Swap both slots twice: every replaced mesh is released once, the count never grows.
      expect(applyLook(av, { coat: coatB, neck: 'neck_spiked' })).toBe(true);
      watch();
      expect(applyLook(av, { coat: coatB, neck: 'neck_spiked' })).toBe(false);
      expect(released.has(body1) && released.has(neck1)).toBe(true);
      expect(released.size).toBe(3);
      expect(meshes(av).length).toBe(before + 1);
      // The rig, skeleton and weapon are the same objects throughout; only one body and one neckwear exist.
      expect(av.skinned.skeleton).toBe(skeleton);
      expect(meshes(av).filter((m) => m.name === 'character_body')).toHaveLength(1);
      expect(meshes(av).filter((m) => m.name === 'neckwear')).toHaveLength(1);
      expect(weapon.parent).not.toBeNull();
      expect(av.root.children[0]).toBe(av.skinned);
      // No listeners of ours pile up on shared geometry or materials (a renderer adds its own; we add none).
      for (const m of meshes(av)) {
        const mesh = m as THREE.Mesh;
        expect(listenerCount(mesh.geometry)).toBe(0);
        for (const mat of [mesh.material].flat()) expect(listenerCount(mat)).toBe(0);
      }
      // Back to the classic look: collar body again, no neckwear.
      expect(applyLook(av, null)).toBe(true);
      expect(av.root.getObjectByName('neckwear')).toBeUndefined();
      expect(meshes(av).length).toBe(before);
      expect(av.stats.look).toBeNull();
      av.dispose();
    }
    expect(characterCacheSize()).toBe(0);
    expect(neckwearCacheSize()).toBe(0);
  });

  it('shares cached geometry: a look applied in place = the same look built directly; refs balance on dispose', () => {
    const look = { coat: 'cat_calico', neck: 'neck_nametag' };
    const a = make(Species.Cat, 'warden', look), b = make(Species.Cat, 'warden', null, { seed: 3 });
    applyLook(b, look);
    expect(b.skinned.geometry).toBe(a.skinned.geometry);
    expect((b.root.getObjectByName('neckwear') as THREE.Mesh).geometry).toBe((a.root.getObjectByName('neckwear') as THREE.Mesh).geometry);
    expect(b.stats).toEqual(a.stats);
    expect(characterCacheSize()).toBe(1);
    expect(neckwearCacheSize()).toBe(1);
    a.dispose();
    expect(characterCacheSize()).toBe(1);
    b.dispose();
    expect(characterCacheSize()).toBe(0);
    expect(neckwearCacheSize()).toBe(0);
  });

  it('prewarm builds the roster\'s looks once; spawning them reuses the pinned geometry', () => {
    const look = { coat: 'corgi_merle', neck: 'neck_bowtie' };
    prewarmCharacters([{ species: Species.Corgi, cls: 'breacher', team: Team.Corgis, seed: 5, look }]);
    expect(characterCacheSize()).toBe(1);
    expect(neckwearCacheSize()).toBe(1);
    const av = make(Species.Corgi, 'breacher', look, { seed: 5 });
    expect(characterCacheSize()).toBe(1);
    expect(neckwearCacheSize()).toBe(1);
    av.dispose();
    expect(characterCacheSize()).toBe(1); // still pinned
    releasePrewarmedCharacters();
    expect(characterCacheSize()).toBe(0);
    expect(neckwearCacheSize()).toBe(0);
  });

  it('unknown ids fall back to the species default; wrong-species ids too; the breed never changes', () => {
    const sphynx = seedOfBreed(Species.Cat, 'sphynx');
    const av = make(Species.Cat, 'assault', { coat: 'corgi_merle', neck: 'neck_cape' } as Look, { seed: sphynx });
    expect(av.stats.look).toEqual(defaultLook(Species.Cat));
    expect(av.stats.variant).toBe('tabby');
    expect(av.root.getObjectByName('neckwear')).toBeUndefined();
    const heightBefore = av.height, bones = av.skinned.skeleton.boneInverses.map((m) => m.elements.join());
    applyLook(av, { coat: 'cat_siamese', neck: 'neck_bowtie' });
    expect(av.stats.variant).toBe('siamese');
    expect(av.height).toBe(heightBefore);
    expect(av.skinned.skeleton.boneInverses.map((m) => m.elements.join())).toEqual(bones); // same (sphynx) rig
    expect(breedFor(Species.Cat, sphynx)).toBe('sphynx');
    av.dispose();
  });

  it('bots: a seeded random look builds and animates, and bosses ignore applyLook', () => {
    for (const [, sp] of SPECIES) for (let seed = 1; seed <= 6; seed++) {
      const look = randomLook(seed, sp);
      const av = make(sp, CLASS_IDS[seed % 6], look, { seed });
      expect(av.stats.look).toEqual(look);
      settle(av, 60, { speed: 6.4, anim: Anim.Run as AnimId });
      av.trigger('emote');
      settle(av, 30);
      for (const b of av.skinned.skeleton.bones) expect(b.matrix.elements.every(Number.isFinite)).toBe(true);
      av.dispose();
    }
    const boss = createBossAvatar({ boss: 0, seed: 1, team: Team.Cats });
    expect(wearsLooks(boss)).toBe(false);
    expect(applyLook(boss, { coat: 'cat_calico' })).toBe(false);
    boss.dispose();
    const classic = make(Species.Corgi, 'assault', null);
    expect(classic.stats.variant).toBe(variantFor(Species.Corgi, 3).name); // no look = the seeded classic coat
    classic.dispose();
    expect(characterCacheSize()).toBe(0);
  });
});
