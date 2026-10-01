// W7 P3 render budget (MASTER_PLAN §8.7: ≤ 400 draws, ≤ 1.5 M triangles, 24 characters on screen), headless:
//   per-character draws and triangles per pass (scene, shadow) at each LOD, for every class × species, and a
//   24-character crowd at 12v12 distances; the world's props draw no line sets.
// W13 (docs/design/LOOK.md): the stylised-realistic look has no ink, so the P3 ink LOD (the hull cut, the crease-tile
// draw distance) and its tests are gone with it; the prop meshes carry no crease-ink children.
// The live numbers come from tools/perf-render.mjs (docs/handoff/P3.md); this file pins the mechanisms and the model.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  createCharacter, characterFarAt, CHARACTER_DETAIL_DISTANCE, CHARACTER_DETAIL_BAND, characterCacheSize, type CharacterAvatar,
} from '../../src/client/procgen/characters';
import { buildPrimMeshes } from '../../src/client/world/prim-mesh';
import { createDestructView } from '../../src/client/world/destruct-view';
import { createWorldData } from '../../src/shared/world/world-data';
import { cosmeticsFor } from '../../src/shared/content/cosmetics';
import { CLASS_IDS, Species, Team, type ClassId, type SpeciesId } from '../../src/shared/types';

// ---------------------------------------------------------------------------------------------------------------
// Characters: a per-pass cost model of one avatar (what the renderer draws for it), per LOD.

interface Cost { scene: number; shadow: number; tris: number }
const isLines = (o: THREE.Object3D) => !!(o as unknown as { isLineSegments2?: boolean }).isLineSegments2;
const trisOf = (o: THREE.Object3D): number => {
  const g = (o as THREE.Mesh).geometry;
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
};
/** Draws and triangles of an avatar as it stands (its own LOD): scene pass + shadow pass. */
function costAt(av: CharacterAvatar): Cost {
  const c: Cost = { scene: 0, shadow: 0, tris: 0 };
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const t = trisOf(o);
      c.scene++; c.tris += t;
      if (m.castShadow) { c.shadow++; c.tris += t; }
    }
    for (const ch of o.children) walk(ch);
  };
  walk(av.root);
  return c;
}
/** Renders the body once from a camera `dist` m away: the body's own hook picks the LOD (as in the scene pass). */
function viewFrom(av: CharacterAvatar, dist: number, ortho = false): void {
  const cam = ortho ? new THREE.OrthographicCamera() : new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 2500);
  cam.position.set(0, 1.2, dist); cam.updateMatrixWorld();
  av.root.updateMatrixWorld(true);
  const scene = new THREE.Scene();
  av.skinned.onBeforeRender(null as never, scene, cam, av.skinned.geometry, av.skinned.material as THREE.Material, null as never);
}
const npc = (species: SpeciesId, cls: ClassId, neck?: string, seed = 3) =>
  createCharacter({ species, cls, team: species === Species.Cat ? Team.Cats : Team.Corgis, seed, isLocal: false, look: neck ? { neck } : null });

describe('P3 characters: distance LOD', () => {
  it('holds its level inside a band around CHARACTER_DETAIL_DISTANCE (no flicker at the threshold)', () => {
    const D = CHARACTER_DETAIL_DISTANCE, B = CHARACTER_DETAIL_BAND;
    expect(characterFarAt(D, false)).toBe(false);
    expect(characterFarAt(D + B - 0.01, false)).toBe(false);
    expect(characterFarAt(D + B + 0.01, false)).toBe(true);
    expect(characterFarAt(D, true)).toBe(true);
    expect(characterFarAt(D - B + 0.01, true)).toBe(true);
    expect(characterFarAt(D - B - 0.01, true)).toBe(false);
    expect(D - B).toBeGreaterThan(15);                                   // 5 m and 12 m views never change
  });

  it('the body picks the level from the camera that draws it; the sun\'s orthographic shadow camera never does', () => {
    const av = npc(Species.Corgi, 'assault', 'neck_bandana');
    try {
      expect(av.detail).toBe('near');
      viewFrom(av, 30, true);
      expect(av.detail).toBe('near');
      viewFrom(av, 30);
      expect(av.detail).toBe('far');
      const neck = av.root.getObjectByName('neckwear') as THREE.Mesh;
      expect(neck.castShadow).toBe(false);
      expect((av.root.getObjectByName('weapon_glow') as THREE.Mesh).visible).toBe(false);
      // a look swapped while far: the new body keeps the hook, the new neckwear casts no shadow
      av.setLook({ neck: 'neck_bowtie' });
      expect((av.root.getObjectByName('neckwear') as THREE.Mesh).castShadow).toBe(false);
      viewFrom(av, 5);
      expect(av.detail).toBe('near');
      expect((av.root.getObjectByName('neckwear') as THREE.Mesh).castShadow).toBe(true);
      expect((av.root.getObjectByName('weapon_glow') as THREE.Mesh).visible).toBe(true);
    } finally { av.dispose(); }
    expect(characterCacheSize()).toBe(0);
  });

  it('per class × species: near (5 m) is unchanged; far (30 m) keeps body, weapon, lamps and look, drops the detail; no ink hull (W13)', () => {
    const necks = cosmeticsFor(Species.Corgi, 'neck').map((c) => c.id).filter((id) => id !== 'neck_none');
    const rows: string[] = [];
    const errors: string[] = [];
    let nearMax = 0, farMax = 0;
    for (const [name, sp] of [['corgi', Species.Corgi], ['cat', Species.Cat]] as const) for (const cls of CLASS_IDS) {
      const av = npc(sp, cls, necks[0]);
      try {
        const drawn0 = av.stats.drawCalls;
        const near = costAt(av);
        av.detail = 'far';
        const far = costAt(av);
        av.detail = 'near';
        const back = costAt(av);
        if (JSON.stringify(back) !== JSON.stringify(near)) errors.push(`${name} ${cls}: near → far → near changed the cost`);
        if (av.stats.drawCalls !== drawn0) errors.push(`${name} ${cls}: stats.drawCalls moved`);
        // near: body, weapon, weapon glow, team lamps, neckwear
        if (near.scene !== drawn0 || near.shadow !== 3) errors.push(`${name} ${cls}: near ${JSON.stringify(near)}`);
        // far: body, weapon, team lamps, neckwear; only the body's shadow
        if (far.scene !== 4 || far.shadow !== 1) errors.push(`${name} ${cls}: far ${JSON.stringify(far)}`);
        nearMax = Math.max(nearMax, near.scene + near.shadow);
        farMax = Math.max(farMax, far.scene + far.shadow);
        rows.push(`${name.padEnd(5)} ${cls.padEnd(11)} near ${near.scene}+${near.shadow} draws ${near.tris} tris · far ${far.scene}+${far.shadow} draws ${far.tris} tris (${(100 * (1 - far.tris / near.tris)).toFixed(0)} % fewer)`);
      } finally { av.dispose(); }
    }
    console.log(`[p3] per character (scene + shadow), NPC tier with a neckwear:\n${rows.join('\n')}`);
    expect(errors).toEqual([]);
    expect(nearMax).toBeLessThanOrEqual(12);
    expect(farMax).toBeLessThanOrEqual(7);
    expect(characterCacheSize()).toBe(0);
  });

  it('a 24-character crowd at 12v12 distances: about two thirds of the draws of full detail, well inside the 400-draw frame', () => {
    // the measured 12v12 spawn view (tools/perf-render.mjs): the local hero ~4 m, a few pets 10-18 m, most 25-90 m
    const dists = [4, 9, 13, 17, 22, 26, 29, 33, 36, 40, 44, 47, 51, 55, 58, 62, 66, 70, 73, 77, 81, 84, 88, 92];
    const necks = cosmeticsFor(Species.Cat, 'neck').map((c) => c.id).filter((id) => id !== 'neck_none');
    let before = 0, after = 0, trisBefore = 0, trisAfter = 0;
    dists.forEach((d, i) => {
      const sp = i % 2 ? Species.Cat : Species.Corgi;
      const av = npc(sp, CLASS_IDS[i % CLASS_IDS.length], i % 5 ? necks[i % necks.length] : undefined, 11 + i);
      try {
        // full detail at every distance (pre-P3 this also drew every hull)
        const full = costAt(av);
        before += full.scene + full.shadow; trisBefore += full.tris;
        viewFrom(av, d);
        const c = costAt(av);
        after += c.scene + c.shadow; trisAfter += c.tris;
      } finally { av.dispose(); }
    });
    console.log(`[p3] 24-character crowd: ${before} → ${after} draws, ${trisBefore} → ${trisAfter} triangles`);
    // W13 (no ink hulls): 182 → 126 draws, 149 k → 144 k triangles; the hulls were ~100 draws of the W7 crowd
    expect(after).toBeLessThanOrEqual(190);
    expect(after).toBeLessThan(before * 0.72);
    expect(before).toBeGreaterThan(160);
    expect(trisAfter).toBeLessThan(trisBefore * 0.98);                    // the far LOD drops the detail meshes
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('W13 world: no line sets', () => {
  it('the West Yard and The Lot props and the destructibles draw no crease ink: one draw per merged mesh', () => {
    for (const id of [undefined, 'the_lot'] as const) {
      const data = createWorldData(1, id as never);
      const pm = buildPrimMeshes(data.prims ?? [], { far: 125 });
      let lines = 0;
      pm.group.traverse((o) => { if (isLines(o)) lines++; });
      expect(lines, id ?? 'west_yard').toBe(0);
      for (const mesh of pm.meshes) expect(mesh.children.length).toBe(0);
      console.log(`[w13] ${id ?? 'west_yard'} props: ${pm.meshes.length} draws, no line sets`);
    }
    const v = createDestructView(createWorldData(1));
    try {
      let lines = 0;
      v.group.traverse((o) => { if (isLines(o)) lines++; });
      expect(lines).toBe(0);
    } finally { v.dispose(); }
  });
});
