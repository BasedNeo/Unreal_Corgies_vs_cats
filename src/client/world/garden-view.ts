// The Garden's living parts (G1): tall-grass concealment patches and sprinkler water jets.
//
//  - Tall grass: every ConcealZone is filled with 2-2.8 m tufts (taller than a 1.2 m character) on a
//    deterministic jittered grid (hash of cell coords), thinned and shrunk toward the ellipse edge the
//    same way concealmentAt() fades, skipping colliders/water. Two instanced draws for the whole
//    district (grass/weeds tufts + flower tufts), always visible (it is gameplay, not near-field
//    decoration), wind sway scaled by the weather wind uniform.
//  - Sprinkler jets: per sprinkler one instanced draw of droplet billboards streaming along a parabolic
//    arc. The CPU evaluates the SAME sprinklerAt(seed, sprinkler, tick) as the authority and writes the
//    jet direction / pressure uniforms; droplets flow in the vertex shader. Wet sweep circles go to the
//    terrain material (WORLD_WEATHER.spr0/1), drying visually over ~15 s after a burst.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, positionGeometry, cameraViewMatrix, cameraProjectionMatrix, instancedBufferAttribute,
  fract, length, smoothstep, uv, time, mix,
} from 'three/tsl';
import type { WorldData, ConcealZone, Sprinkler } from '../../shared/world/world-data';
import { hash2, hashSeed, smoothstep as smooth } from '../../shared/world/noise';
import { occupiedAt, waterAt } from '../../shared/world/queries';
import { sprinklerAt, type SprinklerState } from '../../shared/world/weather';
import { createFoliageMaterial, WORLD_WEATHER } from './materials';
import { blade, finish } from './foliage';
import { worldColor } from './world-palette';

export interface GardenView {
  group: THREE.Group;
  /** tick: the same (server) tick the authority uses for sprinklers; dt for visual drying. */
  update(tick: number, dt: number): void;
  stats(): Record<string, number>;
  /** Visible share of the tall grass/flower instances, 0..1 (quality tier; live, no rebuild). */
  setDensity(d: number): void;
  dispose(): void;
}

function tallTuft(seed: number, dry: boolean): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; color: THREE.Color }[] = [];
  const base = worldColor('grassDark').clone().multiplyScalar(0.85);
  const tip = worldColor(dry ? 'tallGrassDry' : 'tallGrass').clone();
  for (let b = 0; b < 9; b++) {
    const r = hash2(b, seed, 21);
    const yaw = (b / 9) * Math.PI * 2 + r * 0.7;
    const h = 1.7 + 1.2 * hash2(b, seed, 22);
    parts.push(...blade(h, 0.13, 0.45 + 0.45 * r, yaw, b % 3 === 0 ? tip.clone().lerp(worldColor('grassDry'), 0.35) : tip, base));
  }
  // seed-head stalks poke above the blades: a ragged, readable silhouette instead of a flat top
  {
    const a = 2.6 + seed, h = 2.8 + 0.4 * hash2(1, seed, 23), x = Math.cos(a) * 0.18, z = Math.sin(a) * 0.18;
    const head = worldColor(dry ? 'grassDry' : 'tallGrassDry').clone().lerp(worldColor('tallGrass'), dry ? 0.2 : 0.55);
    parts.push({ geo: new THREE.CylinderGeometry(0.02, 0.03, h, 3).translate(x, h / 2, z), color: worldColor('grassDark') });
    parts.push({ geo: new THREE.ConeGeometry(0.075, 0.55, 4).rotateX(Math.PI).translate(x, h + 0.22, z), color: head });
  }
  return finish(parts);
}

function flowerTuft(seed: number): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; color: THREE.Color }[] = [];
  const base = worldColor('grassDark').clone().multiplyScalar(0.85), tip = worldColor('tallGrass');
  for (let b = 0; b < 6; b++) {
    const r = hash2(b, seed, 31);
    parts.push(...blade(1.8 + 0.6 * hash2(b, seed, 32), 0.12, 0.35 + 0.4 * r, (b / 6) * Math.PI * 2 + r, tip, base));
  }
  const heads = ['zinnia', 'cosmos', 'flowerYellow', 'catWhite', 'purple', 'marigold'];
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + seed, d = 0.35, h = 2.1 + 0.5 * hash2(k, seed, 33);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    parts.push({ geo: new THREE.CylinderGeometry(0.035, 0.05, h, 4).translate(x, h / 2, z), color: worldColor('leafDark') });
    const col = worldColor(heads[(k + seed) % heads.length]);
    parts.push({ geo: new THREE.SphereGeometry(0.34, 7, 4).scale(1, 0.45, 1).translate(x, h + 0.05, z), color: col });
    parts.push({ geo: new THREE.SphereGeometry(0.13, 6, 3).translate(x, h + 0.16, z), color: worldColor('flowerYellow') });
  }
  return finish(parts);
}

interface Placement { x: number; y: number; z: number; yaw: number; s: number; tint: [number, number, number]; flower: boolean }

/** Deterministic tall-grass placements for a zone (exported for tests/tools). */
export function tallGrassPlacements(data: WorldData, zn: ConcealZone, spacing = 0.78): Placement[] {
  const out: Placement[] = [];
  const zs = hashSeed(`tallgrass:${zn.id}:${data.seed}`) | 0;
  const sp = spacing / Math.sqrt(zn.density ?? 1);
  const R = Math.max(zn.rx, zn.rz);
  const c = Math.cos(zn.yaw ?? 0), s = Math.sin(zn.yaw ?? 0);
  const n = Math.ceil((2 * R) / sp);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = zn.x - R + (i + hash2(i, j, zs)) * sp, z = zn.z - R + (j + hash2(i, j, zs ^ 0x51)) * sp;
    const dx = x - zn.x, dz = z - zn.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const e = Math.sqrt((lx / zn.rx) ** 2 + (lz / zn.rz) ** 2);
    if (e >= 1) continue;
    const inside = 1 - smooth(0.72, 1, e);
    if (hash2(i, j, zs ^ 0x7e) > 0.35 + 0.65 * inside) continue;             // thin out at the edge
    const h = data.height(x, z);
    if (occupiedAt(data, x, h + 0.3, z, 0.25) || occupiedAt(data, x, h + 1.2, z, 0.1)) continue;
    const w = waterAt(data, x, z);
    if (w && h < w.surfaceY + 0.05) continue;
    const r = hash2(i, j, zs ^ 0x3c);
    const dry = zn.style === 'weeds' ? 0.5 + 0.5 * r : r * 0.35;
    const tint: [number, number, number] = [0.9 + 0.2 * dry, 0.92 + 0.12 * r, 0.85 - 0.2 * dry];
    out.push({
      x, y: h - 0.05, z, yaw: hash2(i, j, zs ^ 0x9a) * Math.PI * 2,
      s: (0.78 + 0.34 * r) * (0.5 + 0.5 * inside) * (zn.h / 2.3),
      tint, flower: zn.style === 'flowers' && hash2(i, j, zs ^ 0x44) < 0.5,
    });
  }
  return out;
}

export function createGardenView(data: WorldData, opts: { density?: number } = {}): GardenView {
  const group = new THREE.Group();
  group.name = 'garden';
  const disposables: { dispose(): void }[] = [];

  // ---- tall grass: per zone, one instanced draw for its grass and one for its flowers ----
  // Per zone so the renderer culls the zones out of view: one yard-wide InstancedMesh drew all ~1 270 tufts
  // (137 k triangles) from a TDM spawn that sees 23 of them (Q2 P2-5). One shared geometry per kind and one material.
  const windDir = new THREE.Vector2(0.8, 0.45).normalize();
  const grassGeo = tallTuft(3, false), flowerGeo = flowerTuft(5);
  const mat = createFoliageMaterial(0.32, windDir, { side: THREE.FrontSide });
  disposables.push(grassGeo, flowerGeo, mat);
  const mkInst = (geo: THREE.BufferGeometry, list: Placement[], name: string) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, list.length) * 3), 3);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
    list.forEach((pl, k) => {
      q.setFromAxisAngle(up, pl.yaw);
      m4.compose(p.set(pl.x, pl.y, pl.z), q, sc.set(pl.s, pl.s * (0.9 + 0.2 * ((k * 0.618) % 1)), pl.s));
      mesh.setMatrixAt(k, m4);
      mesh.setColorAt(k, new THREE.Color(pl.tint[0], pl.tint[1], pl.tint[2]));
    });
    mesh.count = list.length;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = name;
    mesh.userData.noCameraCollide = true;
    mesh.computeBoundingSphere(); // over the instances: the frustum test is per zone
    group.add(mesh);
    disposables.push(mesh);
    return mesh;
  };
  // Instances sorted by a per-tuft hash, so any prefix (mesh.count) is a uniform thinning: density is live.
  const thinKey = (p: Placement) => hash2(Math.round(p.x * 16), Math.round(p.z * 16), 0x2b);
  const byThin = (a: Placement, b: Placement) => thinKey(a) - thinKey(b);
  const chunks: { mesh: THREE.InstancedMesh; n: number; flower: boolean }[] = [];
  for (const zn of data.concealZones ?? []) {
    const all = tallGrassPlacements(data, zn);
    const grass = all.filter((p) => !p.flower).sort(byThin), flowers = all.filter((p) => p.flower).sort(byThin);
    if (grass.length) chunks.push({ mesh: mkInst(grassGeo, grass, `garden_tallgrass_${zn.id}`), n: grass.length, flower: false });
    if (flowers.length) chunks.push({ mesh: mkInst(flowerGeo, flowers, `garden_tallflowers_${zn.id}`), n: flowers.length, flower: true });
  }
  const setDensity = (d: number) => {
    const k = Math.max(0, Math.min(1, d));
    for (const c of chunks) c.mesh.count = Math.round(c.n * k);
  };
  setDensity(opts.density ?? 1);

  // ---- sprinkler jets ----
  interface Jet { sp: Sprinkler; st: SprinklerState; mesh: THREE.Mesh; U: { nozzle: { value: THREE.Vector3 }; dir: { value: THREE.Vector2 }; on: { value: number } }; wetVis: number }
  const jets: Jet[] = [];
  const M = 170;
  for (const sp of data.sprinklers ?? []) {
    const seeds = new Float32Array(M * 4);
    for (let i = 0; i < M; i++) {
      seeds[i * 4] = (i + hash2(i, 1, 0x5a)) / M;                 // position along the stream
      seeds[i * 4 + 1] = hash2(i, 2, 0x5a) - 0.5;                  // lateral jitter
      seeds[i * 4 + 2] = hash2(i, 3, 0x5a) - 0.5;                  // vertical jitter
      seeds[i * 4 + 3] = hash2(i, 4, 0x5a);                        // size / mist
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setAttribute('uv', plane.getAttribute('uv'));
    geo.instanceCount = M;
    const a = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(seeds, 4), 'vec4');
    const U = { nozzle: uniform(new THREE.Vector3(sp.x, sp.y, sp.z)), dir: uniform(new THREE.Vector2(1, 0)), on: uniform(0) };
    const u = fract(a.x.add(time.mul(0.9)));
    const reach = float(sp.reach).mul(float(0.35).add(U.on.mul(0.65)));
    const arcH = float(2.4).mul(U.on);
    const side = vec2(U.dir.y.negate(), U.dir.x);
    const spread = float(0.1).add(u.mul(u).mul(1.6));
    const center = vec3(
      U.nozzle.x.add(U.dir.x.mul(u.mul(reach))).add(side.x.mul(a.y.mul(spread))),
      U.nozzle.y.add(arcH.mul(u.mul(float(1).sub(u)).mul(4))).sub(u.mul(u).mul(1.1)).add(a.z.mul(spread).mul(0.6)),
      U.nozzle.z.add(U.dir.y.mul(u.mul(reach))).add(side.y.mul(a.y.mul(spread))),
    );
    const size = float(0.07).add(u.mul(0.22)).add(a.w.mul(0.08)).mul(U.on.mul(0.6).add(0.4));
    const view = cameraViewMatrix.mul(vec4(center, 1)).add(vec4(positionGeometry.xy.mul(size), 0, 0));
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.name = 'fx_sprinkler';
    mat.userData.style = 'fx';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.fog = true;
    mat.vertexNode = cameraProjectionMatrix.mul(view);
    const r = length(uv().sub(0.5)).mul(2);
    const disc = smoothstep(1, 0.7, r);
    mat.colorNode = mix(vec3(0.45, 0.7, 0.9), vec3(0.85, 0.95, 1.0), smoothstep(0.7, 0.0, r).mul(a.w));
    mat.opacityNode = disc.mul(smoothstep(1, 0.75, u)).mul(float(0.3).add(a.w.mul(0.35))).mul(smoothstep(0, 0.15, U.on));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `fx_sprinkler_${sp.id}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.visible = false;
    mesh.userData.noCameraCollide = true;
    group.add(mesh);
    disposables.push(geo, plane, mat);
    jets.push({ sp, st: { on: 0, angle: 0, dirX: 1, dirZ: 0, t: -1 }, mesh, U: U as unknown as Jet['U'], wetVis: 0 });
  }

  let live = 0;
  return {
    setDensity,
    group,
    update(tick, dt) {
      live = 0;
      jets.forEach((j, i) => {
        sprinklerAt(data, j.sp, tick, j.st); // W9 L3: the world's schedule
        j.mesh.visible = j.st.on > 0.005;
        if (j.mesh.visible) live++;
        j.U.on.value = j.st.on;
        j.U.dir.value.set(j.st.dirX, j.st.dirZ);
        // the swept grass stays dark for a while after the burst (visual only)
        j.wetVis = Math.max(j.st.on, j.wetVis - dt / 15);
        const u = i === 0 ? WORLD_WEATHER.spr0 : i === 1 ? WORLD_WEATHER.spr1 : null;
        if (u) (u.value as THREE.Vector4).set(j.sp.x, j.sp.z, j.sp.reach, j.wetVis);
      });
    },
    stats() {
      let tallGrass = 0, tallFlowers = 0;
      for (const c of chunks) if (c.flower) tallFlowers += c.mesh.count; else tallGrass += c.mesh.count;
      return { tallGrass, tallFlowers, sprinklersOn: live };
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
