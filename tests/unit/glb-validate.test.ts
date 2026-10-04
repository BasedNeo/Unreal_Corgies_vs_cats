// W11 P-GLB1: tools/assets/validate-glb.mjs passes the shipped master and web variant and fails every deliberate
// defect (tools/assets/break-glb.mjs), and pbr() (the sanctioned PBR entry point of the style) keeps a GLB's maps.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { readFileSync } from 'node:fs';
import { validateGlb, createIO } from '../../tools/assets/validate-glb.mjs';
import { breakDocument } from '../../tools/assets/break-glb.mjs';
import { pbr, StylePbrMaterial, toon, stylize } from '../../src/client/style/style-webgpu.js';

const NAME = 'Kit_Lot_Container20_01';
const MASTER = `assets/masters/${NAME}.glb`;
const WEB = `public/assets/kits/${NAME}.glb`;
const manifest = JSON.parse(readFileSync('assets/manifest.json', 'utf8'));

describe('P-GLB1 validate-glb', () => {
  it('the master passes (PNG, plain, budgets, COL_, ORM, 1024^2)', async () => {
    const r = await validateGlb(MASTER, { manifest });
    expect(r.errors).toEqual([]);
    expect(r.report.variant).toBe('master');
    expect(r.report.colliders).toBe(13);
    expect(r.report.lods.map((l: { tris: number }) => l.tris)).toEqual([manifest.assets[0].tris.LOD0, manifest.assets[0].tris.LOD1, manifest.assets[0].tris.LOD2]);
  });

  it('the web variant passes (meshopt + WebP, <= 600 KB)', async () => {
    const r = await validateGlb(WEB, { manifest });
    expect(r.errors).toEqual([]);
    expect(r.report.variant).toBe('web');
    expect(r.report.bytes).toBeLessThanOrEqual(600 * 1024);
  });

  const cases: [string, RegExp][] = [
    ['scale', /root .* must have no transform/],
    ['pivot', /pivot: the ground contact is centred at x/],
    ['lodname', /missing Kit_Lot_Container20_01_LOD1/],
    ['col', /COL_Kit_Lot_Container20_01_0: (rotated|has a material)/],
    ['tris', /LOD2: \d+ triangles > budget 200/],
    ['zup', /LOD0: no rotation allowed/],
  ];
  for (const [defect, re] of cases) {
    it(`a broken copy fails: ${defect}`, async () => {
      const io = await createIO();
      const doc = breakDocument(await io.read(MASTER), [defect]);
      const r = await validateGlb(MASTER, { manifest, doc });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e: string) => re.test(e)), r.errors.join('\n')).toBe(true);
    });
  }
});

describe('P-GLB1 pbr()', () => {
  const tex = () => new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const src = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex(), roughnessMap: tex(), metalnessMap: tex(), aoMap: tex(), normalMap: tex(), roughness: 1, metalness: 1 });
  src.name = 'M_test';

  it('keeps the maps and factors, is tagged pbr, and is cached per source', () => {
    const m = pbr(src);
    expect(m).toBeInstanceOf(StylePbrMaterial);
    expect(m.userData.style).toBe('pbr');
    for (const k of ['map', 'roughnessMap', 'metalnessMap', 'aoMap', 'normalMap'] as const) expect(m[k]).toBe(src[k]);
    expect([m.roughness, m.metalness]).toEqual([1, 1]);
    expect(m.openNode).not.toBeNull();                 // the interiors test is compiled in (STYLE.pbr.interiors)
    expect(pbr(src)).toBe(m);
    expect(pbr(src, { env: 0.5 })).not.toBe(m);
  });

  it('is not a toon material (no ink hull); toon() and stylize() are unchanged', () => {
    const m = pbr(src) as unknown as { isMeshToonMaterial?: boolean; isMeshToonNodeMaterial?: boolean };
    expect(m.isMeshToonMaterial).toBeFalsy();
    expect(m.isMeshToonNodeMaterial).toBeFalsy();
    expect(toon({ color: 0x808080 }).userData.style).toBe('toon');
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x808080 })));
    stylize(g);
    expect((g.children[0] as THREE.Mesh).material).toHaveProperty('userData.style', 'toon');
  });
});
