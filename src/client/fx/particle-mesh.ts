// OWNER: L5 (juice). GPU side of the particle system: ONE draw call per system (instanced quad) with a TSL
// material that billboards / stretches / lays quads flat in the vertex stage and draws comic shapes as SDFs in
// the fragment stage.
//
// Two flavors (both non-toon, so toonOutlinePass never gives them a hull — the ink is drawn in-shader):
//  - 'solid': opaque cutout shapes, flat 2-tone fill + warm-black ink rim. Colors stay ≤ ~0.85 luminance so
//    bloom never catches them (STYLE_GUIDE: only emissives glow). Fur tufts, stuffing, dust, debris, smoke.
//  - 'glow':  additive, unlit, colors multiplied > 1 so the bloom pass picks them up — the same contract as
//    style-webgpu glow(). Muzzle flashes, tracers, lasers, sparks, explosion flash.
import * as THREE from 'three/webgpu';
import {
  vec2, vec3, vec4, float, uv, positionGeometry, cameraViewMatrix, cameraProjectionMatrix,
  instancedDynamicBufferAttribute, cos, sin, length, abs, atan, select, smoothstep, max, min, mix, pow, step,
} from 'three/tsl';
import { PALETTE } from '../style/style-tokens.js';
import { createInstanceArrays, type InstanceArrays, type ParticlePool } from './particle-pool';

export type ParticleFlavor = 'solid' | 'glow';

export interface ParticleMesh {
  mesh: THREE.Mesh;
  arrays: InstanceArrays;
  /** Uploads the pool's alive particles (one buffer write per attribute, ranged to the alive count). */
  sync(pool: ParticlePool): number;
  dispose(): void;
}

const INK = new THREE.Color(PALETTE.ink);

export function createParticleMesh(capacity: number, flavor: ParticleFlavor): ParticleMesh {
  const arrays = createInstanceArrays(capacity);
  const mk = (a: Float32Array) => { const at = new THREE.InstancedBufferAttribute(a, 4); at.setUsage(THREE.DynamicDrawUsage); return at; };
  const aPosAttr = mk(arrays.pos), aColAttr = mk(arrays.col), aAxisAttr = mk(arrays.axis), aMiscAttr = mk(arrays.misc);

  const plane = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.getAttribute('position'));
  geo.setAttribute('uv', plane.getAttribute('uv'));
  geo.instanceCount = 0;

  const aPos = instancedDynamicBufferAttribute<'vec4'>(aPosAttr, 'vec4');
  const aCol = instancedDynamicBufferAttribute<'vec4'>(aColAttr, 'vec4');
  const aAxis = instancedDynamicBufferAttribute<'vec4'>(aAxisAttr, 'vec4');
  const aMisc = instancedDynamicBufferAttribute<'vec4'>(aMiscAttr, 'vec4');

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.name = `fx_particles_${flavor}`;
  mat.userData.style = flavor === 'glow' ? 'glow' : 'fx';
  mat.fog = true;

  // ---- vertex: billboard / stretched / ground ----
  {
    const q = positionGeometry.xy; // quad corners in [-0.5, 0.5]
    const size = aPos.w.mul(2);
    const rot = aMisc.x, mode = aMisc.y;
    const c = cos(rot), s = sin(rot);
    const rq = vec2(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c)));
    const viewCenter = cameraViewMatrix.mul(vec4(aPos.xyz, 1));
    const billboard = viewCenter.add(vec4(rq.mul(size), 0, 0));
    // Stretched: long axis follows the projected world axis (foreshortens naturally), width stays `size`.
    const axV = cameraViewMatrix.mul(vec4(aAxis.xyz, 0)).xy;
    const axLen = length(axV);
    const along = axV.div(max(axLen, 1e-5));
    // (perp, along) must keep the quad's winding (det > 0) or FrontSide culling drops it.
    const perp = vec2(along.y, along.x.negate());
    const stretched = viewCenter.add(vec4(along.mul(q.y.mul(axLen.add(size))).add(perp.mul(q.x.mul(size))), 0, 0));
    // Ground: flat on the XZ plane (dust rings, shockwaves); quad +y → world −z keeps it facing up.
    const gw = vec3(aPos.x.add(rq.x.mul(size)), aPos.y, aPos.z.sub(rq.y.mul(size)));
    const ground = cameraViewMatrix.mul(vec4(gw, 1));
    // Arithmetic blend instead of select(): camera matrices are shared Fn nodes and must not be first built
    // inside a conditional branch (r186 throws "reading 'addToStack'" at VarNode.build).
    const wS = step(0.5, mode).mul(float(1).sub(step(1.5, mode)));
    const wG = step(1.5, mode);
    const wB = float(1).sub(step(0.5, mode));
    const view = billboard.mul(wB).add(stretched.mul(wS)).add(ground.mul(wG));
    mat.vertexNode = cameraProjectionMatrix.mul(view);
  }

  // ---- fragment: comic shapes as signed distances (d < 0 inside) in p ∈ [-1,1]² ----
  // Plain node-graph builder (not a TSL Fn): plain expressions keep the graph stack-free, and
  // discarding goes through material.maskNode instead of If/Discard.
  const sdf = () => {
    const p = uv().mul(2).sub(1);
    const shape = aCol.w, param = aMisc.z;
    const r = length(p);
    const ang = atan(p.y, p.x);
    const puff = r.sub(float(0.9).add(sin(ang.mul(7).add(aMisc.x.mul(3))).mul(0.06)));
    const ring = abs(r.sub(0.78)).sub(max(param, 0.04));
    const star = pow(abs(p.x), 0.5).add(pow(abs(p.y), 0.5)).sub(1);
    const tuft = length(vec2(p.x.mul(2.4), p.y)).sub(0.95);
    const chunk = max(abs(p.x), abs(p.y)).sub(0.72);
    const spikes = float(0.58).add(pow(abs(cos(ang.mul(4))), 3).mul(0.4));
    const burst = r.sub(spikes);
    const streak = r.sub(0.95);
    // Shape ids: 0 Puff · 1 Streak · 2 Ring · 3 Star · 4 Tuft · 5 Chunk · 6 Burst
    return select(shape.lessThan(0.5), puff,
      select(shape.lessThan(1.5), streak,
        select(shape.lessThan(2.5), ring,
          select(shape.lessThan(3.5), star,
            select(shape.lessThan(4.5), tuft,
              select(shape.lessThan(5.5), chunk, burst))))));
  };

  if (flavor === 'solid') {
    const d = sdf();
    mat.maskNode = d.lessThanEqual(0);
    const p = uv().mul(2).sub(1);
    // 2-tone toon fill: a lower-right crescent in shade (key light from the upper left), like the toon bands.
    const k = p.x.sub(p.y).mul(0.7071).add(length(p).mul(0.25));
    const shade = smoothstep(0.42, 0.47, k);
    const fill = mix(aCol.rgb, aCol.rgb.mul(0.7), shade);
    // Rings use param as band thickness: ink both edges with a thinner line.
    const isRing = aCol.w.greaterThan(1.5).and(aCol.w.lessThan(2.5));
    const inkW = select(isRing, aMisc.z.mul(0.45), aMisc.z);
    const ink = step(inkW.negate(), d).mul(step(0.001, inkW));
    mat.colorNode = vec4(mix(fill, vec3(INK.r, INK.g, INK.b), ink), 1);
  } else {
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = THREE.AdditiveBlending;
    const d = sdf();
    // Soft core, crisp-ish edge: bright center reads as "hot".
    const edge = float(1).sub(smoothstep(-0.35, 0, d));
    const core = float(1).sub(smoothstep(-1, -0.2, d)).mul(0.6);
    const alpha = min(1, edge.add(core));
    mat.maskNode = alpha.greaterThan(0.01);
    mat.colorNode = aCol.rgb;
    mat.opacityNode = alpha;
  }

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `fx_${flavor}`;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = flavor === 'glow' ? 5 : 1;
  mesh.userData.noCameraCollide = true;
  mesh.userData.fxArrays = arrays; // debug/lab inspection
  // Stays visible with 0 instances: the renderer builds the pipeline at load (no draw is issued while
  // instanceCount = 0), instead of hitching on the first shot of the match.
  mesh.visible = true;

  const attrs = [aPosAttr, aColAttr, aAxisAttr, aMiscAttr];
  // One reusable range object per attribute: backends empty `updateRanges` after each upload, and
  // addUpdateRange() would allocate a fresh {start,count} every frame.
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
