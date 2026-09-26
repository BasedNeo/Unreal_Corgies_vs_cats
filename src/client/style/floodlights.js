// floodlights.js — sodium floodlights for the HARDENED battle mood (W7 S4). OWNER: style lane; placement: the
// environment lane (bases, watchtowers, terminals). Cheap by construction:
//   - every floodlight gets a glowing lamp head, a soft halo (bigger in rain) and a fake warm light pool on the ground:
//     three instanced draws for ALL floodlights together (heads, halos, pools);
//   - only the `budget` nearest to the camera get a REAL SpotLight (lit characters, specular on wet ground). The light
//     count is fixed when the floodlights are added (lights cost every lit pixel, and adding/removing one recompiles
//     every lit material in three.js), so add them all while the world builds, before the first frame; update()
//     only moves the real lights between floodlights. Budget per tier: STYLE.floodlight.budget (high 4, medium 2,
//     low 0: low draws the fake pools only and costs 3 draws, no light).
//   - pools of floodlights that own a real light dim to `poolWithLight` so the two never double up.
// Usage (world build):
//   const floods = createFloodlights({ tier });                 // tier from engine/quality.ts
//   floods.add({ pos: [x, 9, z], target: [x + 2, groundY, z + 3] });
//   scene.add(floods.group);  ...  per frame: floods.update(camera);   on teardown: floods.dispose()
import * as THREE from 'three/webgpu';
import {
  uniform, vec3, vec4, float, instancedBufferAttribute, positionGeometry, cameraViewMatrix, cameraProjectionMatrix,
  uv, length, max, pow, mix,
} from 'three/tsl';
import { PALETTE, STYLE } from './style-tokens.js';
import { glow, STYLE_WEATHER } from './style-webgpu.js';

/** Real spot lights a tier may spend on floodlights. */
export function floodlightBudget(tier = 'high') {
  const b = /** @type {Record<string, number>} */ (STYLE.floodlight.budget);
  return b[tier === 'med' ? 'medium' : tier] ?? 0;
}

/**
 * @typedef {Object} FloodlightSpec
 * @property {[number, number, number]} pos lamp head position (m)
 * @property {[number, number, number]} target the ground point it aims at (the pool's centre)
 * @property {number} [color] default PALETTE.sodium
 * @property {number} [intensity] candela (decay 2), default STYLE.floodlight.intensity
 * @property {number} [range] m, default STYLE.floodlight.range
 * @property {number} [angle] cone half-angle (rad)
 * @property {number} [penumbra]
 * @property {number} [poolRadius] fake pool radius (m)
 */

/**
 * @param {{ tier?: string, budget?: number, capacity?: number }} [opts]
 */
export function createFloodlights(opts = {}) {
  const T = STYLE.floodlight;
  const budget = opts.budget ?? floodlightBudget(opts.tier);
  const capacity = opts.capacity ?? 48;
  const group = new THREE.Group();
  group.name = 'floodlights';
  group.userData.noCameraCollide = true;
  /** @type {{ pos: THREE.Vector3, target: THREE.Vector3, color: THREE.Color, intensity: number, range: number, angle: number, penumbra: number, radius: number }[]} */
  const list = [];

  // --- lamp heads: one instanced glow draw (bloom catches them; never inked) ---
  const headGeo = new THREE.CylinderGeometry(0.42, 0.5, 0.16, 14);
  headGeo.rotateX(Math.PI / 2);                     // lens faces +Z, turned toward the target per instance
  const heads = new THREE.InstancedMesh(headGeo, glow(PALETTE.sodium, 5), capacity);
  heads.name = 'flood_heads';
  heads.count = 0;
  heads.frustumCulled = false;
  heads.castShadow = false;

  // --- halos: camera-facing soft sprites, one instanced draw ---
  const quad = new THREE.PlaneGeometry(1, 1);
  const haloGeo = new THREE.InstancedBufferGeometry();
  haloGeo.index = quad.index;
  haloGeo.setAttribute('position', quad.getAttribute('position'));
  haloGeo.setAttribute('uv', quad.getAttribute('uv'));
  const haloData = new Float32Array(capacity * 4);   // xyz centre, size
  const haloAttr = new THREE.InstancedBufferAttribute(haloData, 4);
  haloGeo.setAttribute('fh', haloAttr);
  haloGeo.instanceCount = 0;
  const fh = instancedBufferAttribute(haloAttr, 'vec4');
  const sodium = uniform(new THREE.Color(PALETTE.sodium));
  const haloMat = new THREE.MeshBasicNodeMaterial();
  haloMat.name = 'fx_flood_halo';
  haloMat.userData.style = 'glow';
  haloMat.transparent = true;
  haloMat.depthWrite = false;
  haloMat.blending = THREE.AdditiveBlending;
  haloMat.fog = false;
  const haloSize = fh.w.mul(float(1).add(STYLE_WEATHER.rain.mul(0.6)));
  const hv = cameraViewMatrix.mul(vec4(fh.xyz, 1)).add(vec4(positionGeometry.xy.mul(haloSize), 0, 0));
  haloMat.vertexNode = cameraProjectionMatrix.mul(hv);
  const hd = length(uv().sub(0.5)).mul(2);
  haloMat.colorNode = sodium.mul(pow(max(float(1).sub(hd), 0), 2.4).mul(mix(float(0.55), float(0.9), STYLE_WEATHER.rain)));
  const halos = new THREE.Mesh(haloGeo, haloMat);
  halos.name = 'fx_flood_halos';
  halos.frustumCulled = false;
  halos.renderOrder = 5;

  // --- fake light pools on the ground: one instanced additive draw ---
  const flat = new THREE.PlaneGeometry(2, 2);
  flat.rotateX(-Math.PI / 2);
  const poolGeo = new THREE.InstancedBufferGeometry();
  poolGeo.index = flat.index;
  poolGeo.setAttribute('position', flat.getAttribute('position'));
  poolGeo.setAttribute('uv', flat.getAttribute('uv'));
  const poolData = new Float32Array(capacity * 4);   // xyz centre, radius
  const poolTint = new Float32Array(capacity * 4);   // rgb, strength
  const poolAttr = new THREE.InstancedBufferAttribute(poolData, 4);
  const tintAttr = new THREE.InstancedBufferAttribute(poolTint, 4);
  poolGeo.setAttribute('fp', poolAttr);
  poolGeo.setAttribute('fk', tintAttr);
  poolGeo.instanceCount = 0;
  const fp = instancedBufferAttribute(poolAttr, 'vec4');
  const fk = instancedBufferAttribute(tintAttr, 'vec4');
  const poolMat = new THREE.MeshBasicNodeMaterial();
  poolMat.name = 'fx_flood_pool';
  poolMat.userData.style = 'fx';
  poolMat.transparent = true;
  poolMat.depthWrite = false;
  poolMat.blending = THREE.AdditiveBlending;
  poolMat.fog = false;                              // fog on an additive decal ADDS the fog colour (a lit square)
  poolMat.polygonOffset = true;
  poolMat.polygonOffsetFactor = -2;
  poolMat.polygonOffsetUnits = -2;
  const world = fp.xyz.add(vec3(positionGeometry.x, positionGeometry.y.add(0.06), positionGeometry.z).mul(vec3(fp.w, 1, fp.w)));
  poolMat.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1)));
  const pd = length(uv().sub(0.5)).mul(2);
  // soft pool: warm core, long falloff; a wet ground reads brighter (it would mirror the lamp)
  poolMat.colorNode = fk.xyz.mul(pow(max(float(1).sub(pd), 0), 1.7)).mul(fk.w).mul(float(0.3).add(STYLE_WEATHER.wet.mul(0.12)));
  const pools = new THREE.Mesh(poolGeo, poolMat);
  pools.name = 'fx_flood_pools';
  pools.frustumCulled = false;
  pools.renderOrder = 3;
  pools.receiveShadow = false;
  group.add(heads, halos, pools);

  /** @type {THREE.SpotLight[]} */
  const lights = [];
  /** floodlight index each real light serves (-1 = idle) */
  const owner = [];
  const order = [];
  const dist = new Float32Array(capacity);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();

  function writeInstance(i) {
    const f = list[i];
    m4.lookAt(f.pos, f.target, up);                // -Z toward the target
    q.setFromRotationMatrix(m4);
    heads.setMatrixAt(i, m4.compose(f.pos, q, sc));
    heads.instanceMatrix.needsUpdate = true;
    haloData.set([f.pos.x, f.pos.y, f.pos.z, 2.2], i * 4);
    haloAttr.needsUpdate = true;
    poolData.set([f.target.x, f.target.y, f.target.z, f.radius], i * 4);
    poolAttr.needsUpdate = true;
    c.copy(f.color);
    poolTint.set([c.r, c.g, c.b, 1], i * 4);
    tintAttr.needsUpdate = true;
  }

  return {
    group,
    lights,
    get count() { return list.length; },
    get budget() { return budget; },
    /** @param {FloodlightSpec} s  @returns {number} index */
    add(s) {
      if (list.length >= capacity) return -1;
      const f = {
        pos: new THREE.Vector3(...s.pos), target: new THREE.Vector3(...s.target),
        color: new THREE.Color(s.color ?? PALETTE.sodium), intensity: s.intensity ?? T.intensity,
        range: s.range ?? T.range, angle: s.angle ?? T.angle, penumbra: s.penumbra ?? T.penumbra, radius: s.poolRadius ?? T.poolRadius,
      };
      list.push(f);
      const i = list.length - 1;
      writeInstance(i);
      heads.count = list.length;
      haloGeo.instanceCount = list.length;
      poolGeo.instanceCount = list.length;
      if (lights.length < budget) {
        const L = new THREE.SpotLight(f.color, 0, f.range, f.angle, f.penumbra, 2);
        L.name = `flood_light_${lights.length}`;
        L.castShadow = false;
        group.add(L, L.target);
        lights.push(L);
        owner.push(-1);
      }
      return i;
    },
    /** Gives the real lights to the floodlights nearest the camera. Allocation-free. */
    update(camera) {
      const n = list.length;
      if (!n) return;
      const cp = camera.position;
      order.length = n;
      for (let i = 0; i < n; i++) { order[i] = i; dist[i] = list[i].target.distanceToSquared(cp); }
      if (n > lights.length) order.sort((a, b) => dist[a] - dist[b]);
      for (let k = 0; k < lights.length; k++) {
        const L = lights[k];
        const i = k < n ? order[k] : -1;
        if (i < 0) { L.intensity = 0; owner[k] = -1; continue; }
        const f = list[i];
        if (owner[k] !== i) {
          owner[k] = i;
          L.position.copy(f.pos);
          L.target.position.copy(f.target);
          L.target.updateMatrixWorld();
          L.color.copy(f.color);
          L.distance = f.range; L.angle = f.angle; L.penumbra = f.penumbra;
        }
        L.intensity = f.intensity;
      }
      // pools: dim the ones a real light already paints
      let dirty = false;
      for (let i = 0; i < n; i++) {
        const lit = owner.includes(i);
        const s = lit ? T.poolWithLight : 1;
        if (poolTint[i * 4 + 3] !== s) { poolTint[i * 4 + 3] = s; dirty = true; }
      }
      if (dirty) tintAttr.needsUpdate = true;
    },
    /** Shows/hides everything (idle real lights go to 0 so the light count never changes). */
    setVisible(on) {
      heads.visible = halos.visible = pools.visible = on;
      if (!on) for (const L of lights) L.intensity = 0;
    },
    dispose() {
      group.removeFromParent();
      headGeo.dispose(); quad.dispose(); haloGeo.dispose(); flat.dispose(); poolGeo.dispose();
      haloMat.dispose(); poolMat.dispose(); heads.dispose();
      for (const L of lights) L.dispose();
    },
  };
}
