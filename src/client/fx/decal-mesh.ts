// OWNER: X3. GPU side of the impact marks: ONE draw call for every bullet hole and scorch (instanced quads laid on
// the hit surface), a non-toon material (no ink hull) that draws each mark as a signed-distance shape in the fragment
// stage: a dark hole with a rim that tells the surface (bright dented steel, pale splintered wood, chipped stone,
// a dark pock in soil), or a sooty scorch with a ragged edge. Alpha-blended, depth-tested, never writes depth.
import * as THREE from 'three/webgpu';
import {
  vec2, vec3, vec4, float, uv, positionGeometry, cameraViewMatrix, cameraProjectionMatrix,
  instancedDynamicBufferAttribute, sin, length, abs, atan, select, smoothstep, mix, pow, fract,
} from 'three/tsl';
import { PALETTE } from '../style/style-tokens.js';
import { createDecalArrays, type DecalArrays, type DecalPool } from './decal-pool';

export interface DecalMesh {
  mesh: THREE.Mesh;
  arrays: DecalArrays;
  sync(pool: DecalPool): number;
  dispose(): void;
}

const lin = (hex: number) => { const c = new THREE.Color(hex); return vec3(c.r, c.g, c.b); };

export function createDecalMesh(capacity: number): DecalMesh {
  const arrays = createDecalArrays(capacity);
  const mk = (a: Float32Array) => { const at = new THREE.InstancedBufferAttribute(a, 4); at.setUsage(THREE.DynamicDrawUsage); return at; };
  const aPosAttr = mk(arrays.pos), aTanAttr = mk(arrays.tan), aBitAttr = mk(arrays.bit), aMiscAttr = mk(arrays.misc);
  const plane = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.getAttribute('position'));
  geo.setAttribute('uv', plane.getAttribute('uv'));
  geo.instanceCount = 0;

  const aPos = instancedDynamicBufferAttribute<'vec4'>(aPosAttr, 'vec4');
  const aTan = instancedDynamicBufferAttribute<'vec4'>(aTanAttr, 'vec4');
  const aBit = instancedDynamicBufferAttribute<'vec4'>(aBitAttr, 'vec4');
  const aMisc = instancedDynamicBufferAttribute<'vec4'>(aMiscAttr, 'vec4');

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.name = 'fx_decals';
  mat.userData.style = 'fx';
  mat.transparent = true;
  mat.depthWrite = false;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -4;
  mat.fog = true;

  // ---- vertex: quad on the surface plane (tangent, bitangent), radius aPos.w ----
  {
    const q = positionGeometry.xy; // [-0.5, 0.5]
    const r2 = aPos.w.mul(2);
    const world = aPos.xyz.add(aTan.xyz.mul(q.x.mul(r2))).add(aBit.xyz.mul(q.y.mul(r2)));
    mat.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1)));
  }

  // ---- fragment ----
  {
    const p = uv().mul(2).sub(1);
    const r = length(p);
    const ang = atan(p.y, p.x);
    const kind = aTan.w, surf = aBit.w, alpha = aMisc.x, seed = aMisc.y.mul(40);
    // Surface ids (fx/surfaces.ts): 0 dirt · 1 grass · 2 sand · 3 stone · 4 metal · 5 wood · 6 water · 7 soft
    const isMetal = surf.greaterThan(3.5).and(surf.lessThan(4.5));
    const isWood = surf.greaterThan(4.5).and(surf.lessThan(5.5));
    const isStone = surf.greaterThan(2.5).and(surf.lessThan(3.5));
    const isSoil = surf.lessThan(2.5);
    // --- bullet hole: a dark core, a rim that tells the surface ---
    const wob = sin(ang.mul(7).add(seed)).mul(0.035).add(sin(ang.mul(13).sub(seed.mul(0.7))).mul(0.02));
    const core = r.sub(float(0.2).add(wob));
    const spikes = pow(abs(sin(ang.mul(2.5).add(seed))), 6).mul(0.42).add(pow(abs(sin(ang.mul(4).sub(seed))), 10).mul(0.25));
    const rimR = select(isMetal, float(0.44),
      select(isWood, float(0.3).add(spikes),
        select(isStone, float(0.3).add(spikes.mul(0.7)), float(0.62).add(wob.mul(3)))));
    const rim = r.sub(rimR);
    const steel = lin(PALETTE.concrete), dent = lin(PALETTE.hullDark);
    const rawWood = lin(PALETTE.fenceWood).mul(1.12), chip = lin(PALETTE.hullLight).mul(0.9), soil = lin(PALETTE.mulch).mul(0.55);
    const ringT = smoothstep(0.2, 0.44, r);
    const rimCol = select(isMetal, mix(steel, dent, ringT.mul(0.85)),
      select(isWood, rawWood, select(isStone, chip, soil)));
    const hole = lin(PALETTE.ink);
    const holeCol = select(core.lessThanEqual(0), hole, rimCol);
    // Soil pocks are soft and dark; the rest have a crisp edge.
    const edgeSoft = select(isSoil, smoothstep(0, -0.25, rim), smoothstep(0.02, -0.01, rim));
    const holeA = select(core.lessThanEqual(0), float(0.96), edgeSoft.mul(select(isSoil, float(0.7), float(0.85))));
    // --- scorch: soot with a ragged edge and a brown halo ---
    const n = sin(ang.mul(5).add(seed)).mul(0.1).add(sin(ang.mul(11).sub(seed.mul(1.3))).mul(0.06)).add(sin(ang.mul(23).add(seed.mul(2.1))).mul(0.03));
    const edge = float(0.82).add(n);
    // soot core → brown char → a pale ash rim, so a scorch still reads on dark, wet dusk ground
    const char = mix(lin(PALETTE.ink).mul(0.6), lin(PALETTE.mulch).mul(0.8), smoothstep(0.15, edge.mul(0.7), r));
    const soot = mix(char, lin(PALETTE.concrete).mul(0.75), smoothstep(edge.mul(0.72), edge.mul(0.92), r));
    // speckles of unburnt ground inside the scorch
    const speck = fract(sin(vec2(p.x.mul(91.3), p.y.mul(47.9)).dot(vec2(12.9898, 78.233)).add(seed)).mul(43758.5));
    const scorchA = float(1).sub(smoothstep(edge.mul(0.55), edge, r)).mul(0.88).mul(select(speck.greaterThan(0.93), float(0.55), float(1)));
    const isHole = kind.lessThan(0.5);
    const col = select(isHole, holeCol, soot);
    const a = select(isHole, holeA, scorchA).mul(alpha);
    mat.colorNode = col;
    mat.opacityNode = a;
    mat.maskNode = a.greaterThan(0.01);
  }

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx_decals';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 0;
  mesh.userData.noCameraCollide = true;
  mesh.userData.fxArrays = arrays;
  mesh.visible = true; // compiled at load with 0 instances (no hitch on the first mark)

  const attrs = [aPosAttr, aTanAttr, aBitAttr, aMiscAttr];
  const ranges = attrs.map(() => ({ start: 0, count: 0 }));
  return {
    mesh,
    arrays,
    sync(pool) {
      const n = pool.write(arrays);
      geo.instanceCount = n;
      if (n > 0) {
        for (let i = 0; i < attrs.length; i++) {
          const at = attrs[i], rg = ranges[i];
          rg.count = n * 4;
          at.updateRanges.length = 0;
          at.updateRanges.push(rg);
          at.needsUpdate = true;
        }
      }
      return n;
    },
    dispose() { geo.dispose(); plane.dispose(); mat.dispose(); },
  };
}
