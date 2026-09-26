// K2 HARDENED characters: veteran kits in budget, team signal readable and off the camo, K1 class silhouettes not
// below their pre-K2 distances, armour rigid on the bones it rides, the veteran squint, team lamps on every class.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { createCharacter, prewarmCharacters, releasePrewarmedCharacters, characterCacheSize, HERO_TRI_BUDGET, NPC_TRI_BUDGET, type CharacterAvatar } from '../../src/client/procgen/characters';
import { silhouetteMasks, silhouetteDistance } from '../../src/client/procgen/characters/silhouette';
import { teamColors } from '../../src/client/procgen/characters/gear';
import { OCHRE, CAMO_BLACK, CHARCOAL, OXBLOOD, UNDERSUIT } from '../../src/client/procgen/characters/colors';
import { SURF } from '../../src/client/procgen/characters/mesh-builder';
import { teamRead, readsAsTeam, hslOf } from '../../src/client/procgen/cosmetics/readability';
import { PRESETS } from '../../src/client/anim/face';
import { cosmeticsFor } from '../../src/shared/content/cosmetics';
import { Anim, CLASS_IDS, Species, Team, type AnimId, type ClassId, type SpeciesId, type TeamId } from '../../src/shared/types';
import type { AvatarFrame } from '../../src/client/views/avatar';

const SPECIES: [string, SpeciesId][] = [['corgi', Species.Corgi], ['cat', Species.Cat]];
const TEAMS: TeamId[] = [Team.Corgis, Team.Cats];
const frame = (o: Partial<AvatarFrame> = {}): AvatarFrame => ({ speed: 0, vy: 0, grounded: true, anim: Anim.Idle as AnimId, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false, ...o });
const settle = (av: CharacterAvatar, n = 30, f: Partial<AvatarFrame> = {}) => { for (let i = 0; i < n; i++) av.update(frame(f), 1 / 60); };
const make = (species: SpeciesId, cls: ClassId, o: { team?: TeamId; seed?: number; isLocal?: boolean; veteran?: boolean; neck?: string } = {}) =>
  createCharacter({ species, cls, team: o.team ?? (species === Species.Cat ? Team.Cats : Team.Corgis), seed: o.seed ?? 3, isLocal: o.isLocal ?? false, veteran: o.veteran, look: o.neck ? { neck: o.neck } : null });

function measure(av: CharacterAvatar) {
  let tris = 0, draws = 0;
  const styles = new Set<string>();
  av.root.traverse((o) => {
    const m = o as THREE.Mesh & { isLineSegments2?: boolean };
    if (m.isLineSegments2) { draws++; return; }
    if (!m.isMesh) return;
    draws++;
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
    for (const mat of [m.material].flat()) styles.add(String(mat.userData?.style));
  });
  return { tris, draws, styles };
}

describe('K2: budgets', () => {
  it('veterans: every class × species × tier fits the kit budget (with the team collar and with the priciest neckwear)', () => {
    const necks = cosmeticsFor(Species.Corgi, 'neck').map((c) => c.id).filter((id) => id !== 'neck_none');
    const errors: string[] = [];
    for (const [name, sp] of SPECIES) for (const cls of CLASS_IDS) for (const isLocal of [true, false]) {
      for (const neck of [undefined, ...necks]) {
        const av = make(sp, cls, { isLocal, veteran: true, neck });
        try {
          const m = measure(av), budget = isLocal ? HERO_TRI_BUDGET : NPC_TRI_BUDGET;
          if (m.tris !== av.stats.triangles) errors.push(`${name} ${cls} ${neck}: stats ${av.stats.triangles} != ${m.tris}`);
          if (m.tris > budget) errors.push(`${name} ${cls} ${isLocal ? 'hero' : 'npc'} ${neck ?? 'collar'}: ${m.tris} > ${budget}`);
          if (m.draws > 6) errors.push(`${name} ${cls}: ${m.draws} draws`);
          for (const s of m.styles) if (!['toon', 'glow'].includes(s)) errors.push(`${name} ${cls}: material ${s}`);
          expect(av.stats.veteran).toBe(true);
        } finally { av.dispose(); }
      }
    }
    expect(errors).toEqual([]);
    expect(characterCacheSize()).toBe(0);
  });

  it('a veteran is its own cached kit; prewarm pins it; dispose frees it', () => {
    const a = make(Species.Corgi, 'assault'), v = make(Species.Corgi, 'assault', { veteran: true });
    expect(v.skinned.geometry).not.toBe(a.skinned.geometry);
    expect(v.stats.key).not.toBe(a.stats.key);
    expect(v.stats.triangles).toBeGreaterThan(a.stats.triangles); // heavier armour
    a.dispose(); v.dispose();
    prewarmCharacters([{ species: Species.Cat, cls: 'overwatch', team: Team.Cats, seed: 3, veteran: true }]);
    const size = characterCacheSize();
    const c = make(Species.Cat, 'overwatch', { veteran: true });
    expect(characterCacheSize()).toBe(size);
    c.dispose();
    releasePrewarmedCharacters();
    expect(characterCacheSize()).toBe(0);
  });
});

describe('K2: team signal', () => {
  it('reads in a firefight: ≥ 6 % of the visible cells in the team hue, every class, both species, both teams, veterans too', () => {
    const low: string[] = [];
    for (const [name, sp] of SPECIES) for (const team of TEAMS) for (const cls of CLASS_IDS) for (const veteran of [false, true]) {
      const av = make(sp, cls, { team, veteran });
      settle(av);
      const r = teamRead(av.root, team);
      av.dispose();
      if (r.team < 0.06) low.push(`${name} ${cls} team ${team}${veteran ? ' vet' : ''}: ${(r.team * 100).toFixed(1)} %`);
    }
    expect(low).toEqual([]);
  });

  it('never goes on the camo: faction paint and the under-suit read as neither team; the cat oxblood sits well below the crimson signal', () => {
    for (const c of [OCHRE, CAMO_BLACK, CHARCOAL, UNDERSUIT]) for (const t of TEAMS) expect(readsAsTeam(c, t), `#${c.toString(16)} team ${t}`).toBe(false);
    expect(readsAsTeam(OXBLOOD, Team.Corgis)).toBe(false);
    // Oxblood shares the crimson family (cats' faction echoes their side) but is much darker, so the signal pops on it.
    expect(hslOf(teamColors(Team.Cats).main).l - hslOf(OXBLOOD).l).toBeGreaterThan(0.18);
  });

  it('every class carries team lamps: one skinned glow mesh in the team colour on the body skeleton', () => {
    for (const [, sp] of SPECIES) for (const team of TEAMS) for (const cls of CLASS_IDS) for (const isLocal of [true, false]) {
      const av = make(sp, cls, { team, isLocal });
      let lamp: THREE.SkinnedMesh | null = null;
      av.root.traverse((o) => { if (o.name === 'kit_glow') lamp = o as THREE.SkinnedMesh; });
      expect(lamp, `${cls} team ${team}`).not.toBeNull();
      const l = lamp as unknown as THREE.SkinnedMesh;
      expect(l.skeleton).toBe(av.skinned.skeleton);
      expect((l.material as THREE.Material).userData.style).toBe('glow');
      const c = l.geometry.getAttribute('color');
      expect(new THREE.Color(c.getX(0), c.getY(0), c.getZ(0)).getHex()).toBe(teamColors(team).main);
      av.dispose();
    }
  });
});

describe('K2: K1 class silhouettes', () => {
  // Closest class pair before K2 (K1 + C3 at 72e2229), NPC tier, per seed and species: the armour must not blur them.
  const BEFORE: Record<number, [number, number]> = { 1: [0.129, 0.134], 3: [0.133, 0.136], 13: [0.122, 0.129] };
  it('the closest pair of every seed and species is no closer than before the armour; veterans keep their class read', () => {
    for (const seed of [1, 3, 13]) for (const [si, [name, sp]] of SPECIES.entries()) {
      const masks = new Map<ClassId, ReturnType<typeof silhouetteMasks>>();
      const vets = new Map<ClassId, ReturnType<typeof silhouetteMasks>>();
      for (const cls of CLASS_IDS) {
        for (const veteran of [false, true]) {
          if (veteran && seed !== 3) continue;
          const av = make(sp, cls, { seed, veteran });
          settle(av);
          (veteran ? vets : masks).set(cls, silhouetteMasks(av.root));
          av.dispose();
        }
      }
      let min = 1;
      for (let a = 0; a < CLASS_IDS.length; a++) for (let b = a + 1; b < CLASS_IDS.length; b++) {
        min = Math.min(min, silhouetteDistance(masks.get(CLASS_IDS[a])!, masks.get(CLASS_IDS[b])!));
        if (seed === 3) expect(silhouetteDistance(vets.get(CLASS_IDS[a])!, vets.get(CLASS_IDS[b])!), `${name} veterans ${CLASS_IDS[a]}/${CLASS_IDS[b]}`).toBeGreaterThanOrEqual(0.1);
      }
      expect(min, `${name} seed ${seed}`).toBeGreaterThanOrEqual(BEFORE[seed][si]);
      // A veteran is the same class at range: its own silhouette stays close to the rank-and-file one.
      if (seed === 3) for (const cls of CLASS_IDS) expect(silhouetteDistance(vets.get(cls)!, masks.get(cls)!), `${name} ${cls} vet`).toBeLessThan(0.08);
    }
  });
});

describe('K2: animation-ready armour', () => {
  /** Bones that rigidly carry armour or metal vertices (weight 1 on one bone). */
  function rigidGearBones(av: CharacterAvatar): Set<string> {
    const g = av.skinned.geometry, surf = g.getAttribute('surface'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
    const names = av.skinned.skeleton.bones.map((b) => b.name);
    const out = new Set<string>();
    for (let i = 0; i < g.getAttribute('position').count; i++) {
      const metal = surf.getY(i);
      if (Math.abs(metal - SURF.armor[1]) > 1e-4 && Math.abs(metal - SURF.metal[1]) > 1e-4) continue;
      if (sw.getX(i) > 0.999) out.add(names[si.getX(i)]);
    }
    return out;
  }

  it('the body carries per-vertex style surfaces (fur, cloth, armour, metal) for the weathered toon material', () => {
    const av = make(Species.Corgi, 'assault', { isLocal: true });
    const s = av.skinned.geometry.getAttribute('surface');
    expect(s?.itemSize).toBe(4);
    const kinds = new Set<string>();
    for (let i = 0; i < s.count; i++) kinds.add(`${s.getX(i).toFixed(2)},${s.getY(i).toFixed(2)}`);
    for (const k of [SURF.fur, SURF.cloth, SURF.armor, SURF.eye]) expect(kinds.has(`${k[0].toFixed(2)},${k[1].toFixed(2)}`)).toBe(true);
    av.dispose();
  });

  it('plates ride the bones they cover: shoulder plates on the upper arms, knee pads on the shins, boots on the feet, helmet on the head', () => {
    for (const [, sp] of SPECIES) for (const cls of CLASS_IDS) {
      const av = make(sp, cls, { veteran: true });
      const bones = rigidGearBones(av);
      for (const b of ['upperArm.L', 'upperArm.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R', 'thigh.L', 'thigh.R']) expect(bones.has(b), `${cls}: ${b}`).toBe(true);
      if (cls !== 'infiltrator' && cls !== 'overwatch') expect(bones.has('head'), `${cls}: head`).toBe(true);
      av.dispose();
    }
  });

  it('every state (run, sprint / zoomies, fire, emote, knockout) stays finite and the boots stay on the ground while standing', () => {
    for (const [, sp] of SPECIES) {
      const av = make(sp, 'breacher', { veteran: true, isLocal: true });
      const states: Partial<AvatarFrame>[] = [
        { speed: 6.4, anim: Anim.Run as AnimId }, { speed: 9.6, anim: Anim.Sprint as AnimId, sprinting: true },
        { aiming: true, firing: true }, {}, { dead: true, hpFrac: 0, anim: Anim.Dead as AnimId },
      ];
      for (const s of states) { if (Object.keys(s).length === 0) av.trigger('emote'); settle(av, 45, s); }
      for (const b of av.skinned.skeleton.bones) expect(b.matrix.elements.every(Number.isFinite)).toBe(true);
      settle(av, 90, {}); // respawned standing
      av.trigger('spawn'); settle(av, 60, {});
      av.root.updateMatrixWorld(true);
      const pos = av.skinned.geometry.getAttribute('position'), v = new THREE.Vector3();
      let minY = Infinity;
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); av.skinned.applyBoneTransform(i, v); minY = Math.min(minY, v.y); }
      expect(Math.abs(minY)).toBeLessThan(0.02);
      av.dispose();
    }
  });
});

describe('K2: faces', () => {
  it('rest is the veteran squint (lids low, brows down and knit, mouth set); the comedy expressions stay distinct', () => {
    const n = PRESETS.neutral;
    expect(n.lidUp).toBeGreaterThanOrEqual(0.3);
    expect(n.browY).toBeLessThan(-0.2);
    expect(n.browIn).toBeGreaterThan(0.2);
    expect(n.smile).toBeLessThanOrEqual(0);
    expect(PRESETS.terrified.lidUp).toBeLessThan(0.1); // wide-eyed panic still reads
    expect(PRESETS.happy.smile).toBeGreaterThan(0.8);
    expect(PRESETS.derp.tongue).toBeGreaterThan(0.8);
    expect(PRESETS.smug.smirk).toBeGreaterThan(0.5);
  });
});
