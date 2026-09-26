// W7 P3 render budget (MASTER_PLAN §8.7: ≤ 400 draws, ≤ 1.5 M triangles, 24 characters on screen), headless:
//   1. the ink LOD's math and the scene-pass hook (engine/renderer.ts): hulls under 0.3 px and objects past their
//      drawDistance are skipped, nothing else changes, objects without trustworthy bounds keep their ink;
//   2. per-character draws and triangles per pass (scene, ink hull, shadow) at each LOD, for every class × species,
//      and a 24-character crowd at 12v12 distances;
//   3. the world's crease-ink tiles (prim-mesh.ts): every segment kept exactly once, tiles inside their cell, only a
//      minority of them within CREASE_DRAW_DISTANCE of a spawn.
// The live numbers come from tools/perf-render.mjs (docs/handoff/P3.md); this file pins the mechanisms and the model.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  INK_MIN_PX, inkWidthPx, inkCutDistance, distanceToBounds, installInkLod,
} from '../../src/client/engine/renderer';
import {
  createCharacter, characterFarAt, CHARACTER_DETAIL_DISTANCE, CHARACTER_DETAIL_BAND, characterCacheSize, type CharacterAvatar,
} from '../../src/client/procgen/characters';
import { buildPrimMeshes, creaseEdges, creaseTiles, primGeometry, CREASE_DRAW_DISTANCE } from '../../src/client/world/prim-mesh';
import { createDestructView } from '../../src/client/world/destruct-view';
import { createWorldData } from '../../src/shared/world/world-data';
import { STYLE } from '../../src/client/style/style-tokens.js';
import { cosmeticsFor } from '../../src/shared/content/cosmetics';
import { CLASS_IDS, Species, Team, type ClassId, type SpeciesId } from '../../src/shared/types';

const T = STYLE.outline.thickness, CAP = STYLE.outline.farCap;

describe('P3 ink LOD: math', () => {
  it('the hull keeps its full width inside the far cap and thins as 1/d beyond it', () => {
    expect(inkWidthPx(3, T, CAP, 720)).toBeCloseTo(T * 360, 6);
    expect(inkWidthPx(CAP, T, CAP, 720)).toBeCloseTo(T * 360, 6);
    expect(inkWidthPx(2 * CAP, T, CAP, 720)).toBeCloseTo(T * 180, 6);
    for (let d = 1; d < 80; d++) expect(inkWidthPx(d + 1, T, CAP, 720)).toBeLessThanOrEqual(inkWidthPx(d, T, CAP, 720));
  });

  it('the cut distance is where the hull is INK_MIN_PX wide: ~19 m at a 720 px buffer, ~28 m at 1080, never inside 12 m', () => {
    const c720 = inkCutDistance(T, CAP, 720), c1080 = inkCutDistance(T, CAP, 1080);
    expect(inkWidthPx(c720, T, CAP, 720)).toBeCloseTo(INK_MIN_PX, 6);
    expect(inkWidthPx(c1080, T, CAP, 1080)).toBeCloseTo(INK_MIN_PX, 6);
    expect(c720).toBeGreaterThan(18); expect(c720).toBeLessThan(19.5);
    expect(c1080).toBeGreaterThan(27.5); expect(c1080).toBeLessThan(29);
    for (const h of [480, 600, 720, 900, 1080, 1440, 2160]) expect(inkCutDistance(T, CAP, h)).toBeGreaterThan(12);
    expect(inkCutDistance(T, CAP, 720, 0)).toBe(Infinity);          // inkMinPx 0: every hull (labs' A/B)
    console.log(`[p3] ink hull cut: ${c720.toFixed(1)} m at 720 px, ${c1080.toFixed(1)} m at 1080 px, ${inkCutDistance(T, CAP, 1350).toFixed(1)} m at 1350 px`);
  });

  it('distance to bounds is from the eye to the nearest point of the world bounding sphere', () => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(2), new THREE.MeshBasicNodeMaterial());
    m.position.set(0, 0, -30); m.scale.setScalar(1.5); m.updateMatrixWorld();
    expect(distanceToBounds(m, new THREE.Vector3())).toBeCloseTo(27, 3);
    expect(distanceToBounds(m, new THREE.Vector3(0, 0, -30))).toBe(0);
  });
});

/** A stand-in for three's ToonOutlinePassNode: its "PassNode" parent renders every listed object once. */
class FakePassNode {
  list: [THREE.Object3D, THREE.Material][] = [];
  updateBefore(frame: { renderer: FakeRenderer }): void {
    const fn = frame.renderer.getRenderObjectFunction()!;
    for (const [o, m] of this.list) fn(o, null, null, (o as THREE.Mesh).geometry, m, null, null, null);
  }
}
class FakeOutlinePass extends FakePassNode {
  hull = new THREE.MeshBasicNodeMaterial();
  constructor(public camera: THREE.Camera) { super(); }
  _getOutlineMaterial(): THREE.Material { return this.hull; }
}
type Fn = (...a: unknown[]) => void;
class FakeRenderer {
  fn: Fn | null = null;
  drawn: [THREE.Object3D, THREE.Material][] = [];
  getRenderObjectFunction() { return this.fn; }
  setRenderObjectFunction(f: Fn | null) { this.fn = f; }
  getDrawingBufferSize(v: THREE.Vector2) { return v.set(1280, 720); }
  renderObject = vi.fn((o: THREE.Object3D, _s: unknown, _c: unknown, _g: unknown, m: THREE.Material) => { this.drawn.push([o, m]); });
}

describe('P3 ink LOD: the scene-pass hook', () => {
  it('skips only sub-pixel hulls and objects past their drawDistance; restores the previous render function', () => {
    const cam = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 2500);
    cam.updateMatrixWorld();
    const pass = new FakeOutlinePass(cam);
    const toon = new THREE.MeshToonNodeMaterial(), basic = new THREE.MeshBasicNodeMaterial();
    const at = (z: number, mat: THREE.Material, name: string) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); m.name = name; m.position.set(0, 0, -z); m.updateMatrixWorld();
      pass.list.push([m, mat]);
      return m;
    };
    const near = at(5, toon, 'near'), mid = at(15, toon, 'mid'), far = at(40, toon, 'far');
    const debris = at(40, toon, 'debris'); debris.frustumCulled = false;       // stale bounds: keeps its ink
    const pet = at(40, toon, 'pet'); pet.userData.keepInk = true;              // a character: keeps its ink
    const glowFar = at(40, basic, 'glow');                                      // no hull, drawn
    const tileNear = at(30, basic, 'tileNear'); tileNear.userData.drawDistance = 40;
    const tileFar = at(60, basic, 'tileFar'); tileFar.userData.drawDistance = 40;
    const stats = installInkLod(pass, { thickness: { value: T }, inkFar: { value: CAP } });
    const r = new FakeRenderer();
    const before: Fn = () => {};
    r.fn = before;
    pass.updateBefore({ renderer: r });
    expect(r.fn).toBe(before);
    const count = (o: THREE.Object3D) => r.drawn.filter(([x]) => x === o).length;
    const hull = (o: THREE.Object3D) => r.drawn.some(([x, m]) => x === o && m === pass.hull);
    expect([count(near), count(mid), count(far), count(debris), count(pet)]).toEqual([2, 2, 1, 2, 2]);
    expect([hull(near), hull(mid), hull(far), hull(debris), hull(pet)]).toEqual([true, true, false, true, true]);
    expect([count(glowFar), count(tileNear), count(tileFar)]).toEqual([1, 1, 0]);
    // hull before mesh, as three's pass draws them
    const i = r.drawn.findIndex(([x]) => x === near);
    expect(r.drawn[i][1]).toBe(pass.hull); expect(r.drawn[i + 1][1]).toBe(toon);
    expect(stats).toMatchObject({ hullsDrawn: 4, hullsSkipped: 1, distanceCulled: 1 });
    expect(stats.cut).toBeCloseTo(inkCutDistance(T, CAP, 720), 6);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Characters: a per-pass cost model of one avatar (what the renderer draws for it), per LOD.

interface Cost { scene: number; hull: number; shadow: number; tris: number }
const trisOf = (o: THREE.Object3D): number => {
  const g = (o as THREE.Mesh).geometry;
  if ((o as unknown as { isLineSegments2?: boolean }).isLineSegments2) {
    return (g.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).count * (g.index!.count / 3);
  }
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
};
/** Draws and triangles of an avatar at `dist` m on a `bufferH` px buffer: its own LOD, plus the renderer's hull rule. */
function costAt(av: CharacterAvatar, dist: number, bufferH = 720): Cost {
  const cut = inkCutDistance(T, CAP, bufferH);
  const c: Cost = { scene: 0, hull: 0, shadow: 0, tris: 0 };
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh || (o as unknown as { isLineSegments2?: boolean }).isLineSegments2) {
      const t = trisOf(o);
      c.scene++; c.tris += t;
      const mat = m.material as THREE.Material & { isMeshToonNodeMaterial?: boolean };
      if (mat.isMeshToonNodeMaterial && (dist <= cut || o.userData.keepInk)) { c.hull++; c.tris += t; }
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

  it('per class × species: near (5 m) is unchanged; far (30 m) keeps body, weapon, their ink, lamps and look, drops the detail', () => {
    const necks = cosmeticsFor(Species.Corgi, 'neck').map((c) => c.id).filter((id) => id !== 'neck_none');
    const rows: string[] = [];
    const errors: string[] = [];
    let nearMax = 0, farMax = 0;
    for (const [name, sp] of [['corgi', Species.Corgi], ['cat', Species.Cat]] as const) for (const cls of CLASS_IDS) {
      const av = npc(sp, cls, necks[0]);
      try {
        const drawn0 = av.stats.drawCalls;
        const near = costAt(av, 5);
        av.detail = 'far';
        const far = costAt(av, 30), far1080 = costAt(av, 30, 1080);
        av.detail = 'near';
        const back = costAt(av, 5);
        if (JSON.stringify(back) !== JSON.stringify(near)) errors.push(`${name} ${cls}: near → far → near changed the cost`);
        if (av.stats.drawCalls !== drawn0) errors.push(`${name} ${cls}: stats.drawCalls moved`);
        // near: body, weapon, weapon ink, weapon glow, team lamps, neckwear + hulls for the three toon meshes
        if (near.scene !== drawn0 || near.hull !== 3 || near.shadow !== 3) errors.push(`${name} ${cls}: near ${JSON.stringify(near)}`);
        // far: body, weapon, team lamps, neckwear; the body's and weapon's hulls (keepInk; the neckwear's is sub-pixel at
        // 720 and 1080 px); only the body's shadow
        if (far.scene !== 4 || far.hull !== 2 || far.shadow !== 1) errors.push(`${name} ${cls}: far ${JSON.stringify(far)}`);
        let weapon: THREE.Object3D | null = null;
        av.root.traverse((o) => { if (o.name.startsWith('weapon_') && o.name !== 'weapon_glow' && (o as THREE.Mesh).isMesh) weapon = o; });
        if (!av.skinned.userData.keepInk || !(weapon as THREE.Object3D | null)?.userData.keepInk) errors.push(`${name} ${cls}: body / weapon without keepInk`);
        if (JSON.stringify(far1080) !== JSON.stringify(far)) errors.push(`${name} ${cls}: 1080 px far ${JSON.stringify(far1080)}`);
        nearMax = Math.max(nearMax, near.scene + near.hull + near.shadow);
        farMax = Math.max(farMax, far.scene + far.hull + far.shadow);
        rows.push(`${name.padEnd(5)} ${cls.padEnd(11)} near ${near.scene}+${near.hull}+${near.shadow} draws ${near.tris} tris · far ${far.scene}+${far.hull}+${far.shadow} draws ${far.tris} tris (${(100 * (1 - far.tris / near.tris)).toFixed(0)} % fewer)`);
      } finally { av.dispose(); }
    }
    console.log(`[p3] per character (scene + hull + shadow), NPC tier with a neckwear:\n${rows.join('\n')}`);
    expect(errors).toEqual([]);
    expect(nearMax).toBeLessThanOrEqual(12);
    expect(farMax).toBeLessThanOrEqual(7);
    expect(characterCacheSize()).toBe(0);
  });

  it('a 24-character crowd at 12v12 distances: about two thirds of the draws it was, well inside the 400-draw frame', () => {
    // the measured 12v12 spawn view (tools/perf-render.mjs): the local hero ~4 m, a few pets 10-18 m, most 25-90 m
    const dists = [4, 9, 13, 17, 22, 26, 29, 33, 36, 40, 44, 47, 51, 55, 58, 62, 66, 70, 73, 77, 81, 84, 88, 92];
    const necks = cosmeticsFor(Species.Cat, 'neck').map((c) => c.id).filter((id) => id !== 'neck_none');
    let before = 0, after = 0, trisBefore = 0, trisAfter = 0;
    dists.forEach((d, i) => {
      const sp = i % 2 ? Species.Cat : Species.Corgi;
      const av = npc(sp, CLASS_IDS[i % CLASS_IDS.length], i % 5 ? necks[i % necks.length] : undefined, 11 + i);
      try {
        // pre-P3: every hull at every distance, full detail
        const full = costAt(av, 0);
        before += full.scene + full.hull + full.shadow; trisBefore += full.tris;
        viewFrom(av, d);
        const c = costAt(av, d);
        after += c.scene + c.hull + c.shadow; trisAfter += c.tris;
      } finally { av.dispose(); }
    });
    console.log(`[p3] 24-character crowd: ${before} → ${after} draws, ${trisBefore} → ${trisAfter} triangles`);
    expect(after).toBeLessThanOrEqual(190);
    expect(after).toBeLessThan(before * 0.7);
    expect(before).toBeGreaterThan(250);
    expect(trisAfter).toBeLessThan(trisBefore * 0.92);                    // the body and weapon hulls stay (keepInk)
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('P3 world: crease-ink tiles', () => {
  it('creaseTiles keeps every segment exactly once, keyed by its midpoint', () => {
    const lines = [0, 0, 0, 1, 0, 0,  34, 0, 5, 40, 0, 5,  -1, 0, -1, -2, 1, -2,  33, 0, 0, 34, 0, 0];   // mids x 0.5, 37, -1.5, 33.5
    const tiles = creaseTiles(lines, 33.3);
    expect([...tiles.keys()]).toEqual(['0,0', '1,0', '-1,-1']);
    expect(tiles.get('1,0')!.length).toBe(12);
    expect([...tiles.values()].reduce((a, t) => a + t.length, 0)).toBe(lines.length);
  });

  it('West Yard props: consistent tiles, tagged ink with a draw distance, all segments kept; a minority near a spawn', () => {
    const data = createWorldData(1);
    const pm = buildPrimMeshes(data.prims ?? [], { far: 125 });
    let segs = 0, near = 0, tiles = 0;
    const spawn = (data.spawns ?? [])[0];
    const eye = new THREE.Vector3(spawn.x, spawn.y + 2, spawn.z);
    const tile = 100 / 3;                                                   // a third of the default 100 m cell
    for (const mesh of pm.meshes) {
      for (const c of mesh.children) {
        const [tx, tz] = c.name.split('_crease_')[1].split(',').map(Number);
        expect(c.userData.styleInk).toBe(true);
        expect(c.userData.drawDistance).toBe(CREASE_DRAW_DISTANCE);
        const a = ((c as THREE.Mesh).geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute);
        const b = ((c as THREE.Mesh).geometry.getAttribute('instanceEnd') as THREE.InterleavedBufferAttribute);
        for (let i = 0; i < a.count; i++) {
          const mx = (a.getX(i) + b.getX(i)) / 2, mz = (a.getZ(i) + b.getZ(i)) / 2;
          expect(Math.floor(mx / tile)).toBe(tx); expect(Math.floor(mz / tile)).toBe(tz);
        }
        segs += a.count; tiles++;
        if (distanceToBounds(c, eye) <= CREASE_DRAW_DISTANCE) near += a.count;
      }
    }
    let expected = 0;
    for (const p of data.prims ?? []) {
      if ((p.g ?? 'solid') === 'solid' && Math.max(Math.abs(p.x), Math.abs(p.z)) <= 125) expected += creaseEdges(primGeometry(p, true)).length / 6;
    }
    expect(segs).toBe(expected);
    console.log(`[p3] West Yard crease ink: ${segs} segments in ${tiles} tiles; within ${CREASE_DRAW_DISTANCE} m of spawn 0: ${near} (${(100 * near / segs).toFixed(0)} %)`);
    expect(near / segs).toBeLessThan(0.5);
  });

  it('the destructibles\' single crease set carries the draw distance (bounds from where they stand)', () => {
    const data = createWorldData(1);
    const v = createDestructView(data);
    try {
      const lines = v.group.getObjectByName('destructibles_solid_crease')!;
      expect(lines.userData.drawDistance).toBe(CREASE_DRAW_DISTANCE);
      const s = (lines as THREE.Mesh).geometry.boundingSphere!;
      expect(s.center.y).toBeGreaterThan(-100);                            // not dragged to the parking depth
      expect(s.radius).toBeLessThan(80);
    } finally { v.dispose(); }
  });
});
