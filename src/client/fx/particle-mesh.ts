// OWNER: L5 (juice). GPU side of the particle system: ONE draw call per system (instanced quad) with a TSL
// material that billboards / stretches / lays quads flat in the vertex stage and draws shapes as SDFs in the
// fragment stage.
//
// Two flavors. W15 (stylised-realistic, docs/design/LOOK.md): nothing is inked, banded or screened any more.
//  - 'solid': alpha-blended shapes in a flat colour with a soft top-lit gradient. Puffs (dust, smoke) are soft-edged
//    discs; tufts, chunks, shards and casings keep a crisp, anti-aliased edge. Opacity (ParticleSpec.alpha and
//    Fade.Soft) is real alpha. Colours stay ≤ ~0.85 luminance so bloom never catches them (only emissives glow).
//  - 'glow':  additive, unlit, colors multiplied > 1 so the bloom pass picks them up — the same contract as
//    style-webgpu glow(). Muzzle flashes, tracers, lasers, sparks, explosion flash.
import * as THREE from 'three/webgpu';
import {
  vec2, vec3, vec4, float, uv, positionGeometry, cameraViewMatrix, cameraProjectionMatrix,
  instancedDynamicBufferAttribute, cos, sin, length, abs, atan, select, smoothstep, max, min, mix, pow, step, sqrt,
} from 'three/tsl';
import { createInstanceArrays, type InstanceArrays, type ParticlePool } from './particle-pool';

export type ParticleFlavor = 'solid' | 'glow';

export interface ParticleMesh {
  mesh: THREE.Mesh;
  arrays: InstanceArrays;
  /** Uploads the pool's alive particles (one buffer write per attribute, ranged to the alive count). */
  sync(pool: ParticlePool): number;
  dispose(): void;
}

/**
 * Draw order (W15): solids are alpha-blended now, so they must draw AFTER the ground-level transparent layers they hover
 * over (water 2, blob shadows 2, floodlight pools 3) and BEFORE the rain sheet (4) and the additive glows (5).
 */
export const PARTICLE_RENDER_ORDER = { solid: 3.5, glow: 5 } as const;

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

  // ---- fragment: shapes as signed distances (d < 0 inside) in p ∈ [-1,1]² ----
  // Plain node-graph builder (not a TSL Fn): plain expressions keep the graph stack-free, and
  // discarding goes through material.maskNode instead of If/Discard.
  const sdf = () => {
    const p = uv().mul(2).sub(1);
    const shape = aCol.w, param = aMisc.z;
    const r = length(p);
    const ang = atan(p.y, p.x);
    const disc = r.sub(0.9);
    const ring = abs(r.sub(0.78)).sub(max(param, 0.04));
    const tuft = length(vec2(p.x.mul(2.4), p.y)).sub(0.95);
    const chunk = max(abs(p.x), abs(p.y)).sub(0.72);
    const streak = r.sub(0.95);
    // X3 shapes. Shard: thin diamond sliver (splinters, metal chips). Splat: a blob with lobes (the hairball's
    // goo and stains; W15 retired the comic hit splat). Casing: rounded capsule 1:2.5 (brass, shells). Petal: flame
    // tongue, wide at −y, point at +y (muzzle-flash petals and fire, stretched along their axis).
    const shard = abs(p.x).mul(3.2).add(abs(p.y)).sub(0.95);
    const lobes = float(0.62).add(sin(ang.mul(5).add(aMisc.x.mul(2))).mul(0.16)).add(sin(ang.mul(9).sub(aMisc.x)).mul(0.08));
    const splat = r.sub(lobes);
    const cq = vec2(abs(p.x).sub(0.24), abs(p.y).sub(0.66));
    const casing = length(max(cq, vec2(0, 0))).add(min(max(cq.x, cq.y), 0)).sub(0.16);
    const py = p.y.clamp(-1, 1);
    const petalW = sqrt(max(float(1).sub(py).mul(0.5), 0)).mul(0.9).mul(smoothstep(-1, -0.72, py));
    const petal = abs(p.x).sub(petalW);
    // Shape ids: 0 Puff (a disc) · 1 Streak · 2 Ring · 4 Tuft · 5 Chunk · 7 Shard · 8 Splat · 9 Casing · 10 Petal
    // · 11 Glow (a disc; the glow flavor gives it a soft quadratic falloff instead of a hot edge) · 12 Drop (the same
    // disc, but a solid draws it crisp, not soft like a Puff). 3 and 6 (the retired Star and Burst) are never spawned.
    return select(shape.lessThan(0.5), disc,
      select(shape.lessThan(1.5), streak,
        select(shape.lessThan(3.5), ring,
          select(shape.lessThan(4.5), tuft,
            select(shape.lessThan(6.5), chunk,
              select(shape.lessThan(7.5), shard,
                select(shape.lessThan(8.5), splat,
                  select(shape.lessThan(9.5), casing,
                    select(shape.lessThan(10.5), petal, select(shape.lessThan(11.5), r.sub(1), disc))))))))));
  };

  if (flavor === 'solid') {
    // Real alpha (W15): one alpha-blended draw that tests depth but never writes it, so a soft puff never cuts a hole
    // in what is behind it. Puffs are soft translucent blobs (dust and smoke); every other solid keeps a crisp edge with a
    // thin anti-aliasing band. No ink rim, no toon crescent, no halftone screen-door.
    mat.transparent = true;
    mat.depthWrite = false;
    const d = sdf();
    const p = uv().mul(2).sub(1);
    const isPuff = aCol.w.lessThan(0.5);
    // a puff is translucent all through (peak 0.85) and falls off like a soft blob, never a solid disc
    const soft = pow(float(1).sub(smoothstep(0, 1, length(p))), 1.3).mul(0.85);
    const crisp = float(1).sub(smoothstep(-0.04, 0.02, d));
    const alpha = select(isPuff, soft, crisp).mul(aAxis.w);
    mat.opacityNode = alpha;
    mat.maskNode = alpha.greaterThan(0.004);
    // A soft top-lit gradient (continuous, not a band): the lower half sits a little darker.
    mat.colorNode = aCol.rgb.mul(mix(float(0.8), float(1), smoothstep(-1, 0.8, p.y)));
  } else {
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = THREE.AdditiveBlending;
    const d = sdf();
    // Soft core, crisp-ish edge: bright center reads as "hot".
    const edge = float(1).sub(smoothstep(-0.35, 0, d));
    const core = float(1).sub(smoothstep(-1, -0.2, d)).mul(0.6);
    // Glow (11): light spill, (1 − r)² all the way out, no edge.
    const pr = length(uv().mul(2).sub(1));
    const spill = pow(max(float(1).sub(pr), 0), 2);
    const alpha = select(aCol.w.greaterThan(10.5), spill, min(1, edge.add(core)));
    mat.maskNode = alpha.greaterThan(0.01);
    mat.colorNode = aCol.rgb.mul(aAxis.w);
    mat.opacityNode = alpha;
  }

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `fx_${flavor}`;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = flavor === 'glow' ? PARTICLE_RENDER_ORDER.glow : PARTICLE_RENDER_ORDER.solid;
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
