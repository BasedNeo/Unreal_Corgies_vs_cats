// E4 (W7 HARDENED): the Yard War's client-only dressing, from the world's battle layout (fortifications.ts battleOf):
//   - torn team banners on the FOB flag poles (corgi paw on blue / cat face on crimson, drawn in TSL from the cloth's
//     uv; ragged fly edge, bullet holes, flapping with the weather's wind): ONE merged mesh;
//   - camo netting draped over the armories (sagging cloth, burlap fringe, diamond mesh holes by alpha test): ONE mesh;
//   - sodium floodlights on the watchtowers and poles (style/floodlights.js: lamp heads, halos, fake light pools —
//     three instanced draws for all of them; real spot lights only when the caller drives update(camera), `lights`);
//   - clutter, instanced and dropped on the low tier: spent casings and tennis balls behind the firing positions,
//     muddy paw-print trails (alpha-tested decals hugging the terrain), splinters by the barricades.
// Static except the cloth sway (GPU) and the floodlights' light hand-off. All materials from the style factory
// (materials.ts toonFrom/toonNoInk, glow via floodlights.js). Deterministic: hash2 of the layout's seeds.
import * as THREE from 'three/webgpu';
import {
  attribute, positionLocal, normalLocal, uv, time, sin, vec2, vec3, float, mix, smoothstep, length, max, abs, step, fract,
} from 'three/tsl';
import type { WorldData } from '../../shared/world/world-data';
import { battleOf, WIND_DIR, type BannerSpec, type BattleLayout, type ClutterSpec, type NetSpec } from '../../shared/world/fortifications';
import { hash2 } from '../../shared/world/noise';
import { occupiedAt } from '../../shared/world/queries';
import { toonFrom, toonNoInk, WORLD_WEATHER } from './materials';
import { worldColor } from './world-palette';
import * as FLOODLIGHTS from '../style/floodlights.js';
import * as STYLE_FACTORY from '../style/style-webgpu.js';

export interface BattleDressingOptions {
  /** Quality tier: 'low' drops the clutter (casings, balls, paw prints, splinters). Default: the style's detail tier. */
  quality?: 'low' | 'med' | 'medium' | 'high';
  /** Give floodlights real spot lights (the tier's budget); only when the caller calls update(camera) every frame. */
  lights?: boolean;
}

export interface BattleDressing {
  group: THREE.Group;
  /** Moves the floodlights' real lights to the ones nearest the camera (no-op without `lights`). */
  update(camera: THREE.Camera): void;
  stats(): Record<string, number>;
  dispose(): void;
}

type FloodApi = { group: THREE.Group; add(s: { pos: number[]; target: number[]; poolRadius?: number }): number; update(c: THREE.Camera): void; count: number };

/** Tier from the style factory's material detail (fixed per tier by the renderer: 0 low, 1 medium, 2 high). */
function styleTier(): 'low' | 'medium' | 'high' {
  const f = (STYLE_FACTORY as unknown as Record<string, unknown>).styleDetail;
  const d = typeof f === 'function' ? Number((f as () => number)()) : 2;
  return d <= 0 ? 'low' : d === 1 ? 'medium' : 'high';
}

const H = (a: number, b: number, s: number) => hash2(a, b, s);

// ------------------------------------------------------------------------------------------------ clutter
interface Inst { x: number; y: number; z: number; yaw: number; tilt: number; s: number; tint: number }

function scatter(data: WorldData, c: ClutterSpec): Inst[] {
  const out: Inst[] = [];
  const trail = c.kind === 'paws' && c.x1 !== undefined && c.z1 !== undefined;
  for (let k = 0; k < c.count; k++) {
    let x: number, z: number, yaw: number;
    if (trail) {
      // alternating left/right prints along the trail, a pace every ~0.5 m
      const t = (k + 0.5) / c.count, dx = c.x1! - c.x, dz = c.z1! - c.z, L = Math.hypot(dx, dz) || 1;
      const side = k % 2 ? 1 : -1, wob = (H(c.seed, k, 3) - 0.5) * 0.25;
      x = c.x + dx * t + (-dz / L) * (0.16 * side + wob);
      z = c.z + dz * t + (dx / L) * (0.16 * side + wob);
      yaw = Math.atan2(dx, dz) + (H(c.seed, k, 4) - 0.5) * 0.4;
    } else {
      const a = H(c.seed, k, 1) * Math.PI * 2, r = c.r * Math.sqrt(H(c.seed, k, 2));
      x = c.x + Math.cos(a) * r; z = c.z + Math.sin(a) * r; yaw = H(c.seed, k, 5) * Math.PI * 2;
    }
    const y = data.height(x, z);
    if (occupiedAt(data, x, y + 0.12, z)) continue;               // never inside a wall or a crate
    out.push({ x, y, z, yaw, tilt: H(c.seed, k, 6), s: 0.85 + 0.3 * H(c.seed, k, 7), tint: H(c.seed, k, 8) });
  }
  return out;
}

/** Terrain normal at (x, z) from the exact height function. */
function groundNormal(data: WorldData, x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const e = 0.35;
  return out.set(data.height(x - e, z) - data.height(x + e, z), 2 * e, data.height(x, z - e) - data.height(x, z + e)).normalize();
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: Inst[], place: (i: Inst, m: THREE.Matrix4) => void, tint: (i: Inst, c: THREE.Color) => void, name: string): THREE.InstancedMesh | null {
  if (!list.length) { geo.dispose(); return null; }
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const colors = new Float32Array(list.length * 3);
  list.forEach((it, i) => {
    place(it, m);
    mesh.setMatrixAt(i, m);
    tint(it, c);
    colors.set([c.r, c.g, c.b], i * 3);
  });
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = name;
  mesh.userData.noCameraCollide = true;
  return mesh;
}

// ------------------------------------------------------------------------------------------------ cloth
/** Paw-print / icon helpers in TSL: inside-ness (1 inside, 0 outside, soft over `e`) of an ellipse. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL node types are too narrow for small helpers
type N = any;
const ellipse = (q: N, cx: number, cy: number, rx: number, ry: number, e = 0.02): N =>
  float(1).sub(smoothstep(1 - e / Math.min(rx, ry), 1 + e / Math.min(rx, ry), length(q.sub(vec2(cx, cy)).div(vec2(rx, ry)))));
/** Triangle (a, b, c in either winding) as a hard mask: the three edge functions share a sign inside. */
const tri = (q: N, a: [number, number], b: [number, number], c: [number, number]): N => {
  const edge = (p: [number, number], r: [number, number]) => q.x.sub(p[0]).mul(r[1] - p[1]).sub(q.y.sub(p[1]).mul(r[0] - p[0]));
  const e1 = edge(a, b), e2 = edge(b, c), e3 = edge(c, a);
  return step(0, e1.mul(e2)).mul(step(0, e2.mul(e3)));
};

/** Torn banners: one merged double-sided cloth, streaming downwind from each pole top. */
function buildBanners(list: BannerSpec[]): THREE.Mesh | null {
  if (!list.length) return null;
  const NU = 10, NV = 6;
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [], team: number[] = [], col: number[] = [], idx: number[] = [];
  const iconA: number[] = [], aspectA: number[] = [];
  const wx = WIND_DIR.x, wz = WIND_DIR.z, nx = -wz, nz = wx;
  const cA = new THREE.Color(), cB = new THREE.Color();
  for (const b of list) {
    const base = pos.length / 3;
    const field = worldColor(b.team === 0 ? 'teamCorgis' : 'teamCats');
    const reach: number[] = [];
    for (let j = 0; j <= NV; j++) reach.push(1 - 0.3 * H(b.seed, j, 31) * (j === 0 ? 0.3 : 1));   // ragged fly edge
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const u = (i / NU) * reach[j], v = j / NV;
      const droop = Math.pow(u, 1.6) * b.h * 0.28;
      pos.push(b.x + wx * u * b.w, b.y - v * b.h - droop, b.z + wz * u * b.w);
      nor.push(nx, 0, nz);
      uvs.push(u, v);
      team.push(b.team);
      iconA.push(b.icon === false ? 0 : 1);
      aspectA.push(b.w / b.h);
      // weathering: faded and grimy toward the fly and the bottom, a pale frayed rag border at the torn end
      const g = 0.72 + 0.28 * (1 - 0.5 * v) * (1 - 0.4 * u) + (H(b.seed + i, j, 32) - 0.5) * 0.06;
      cA.copy(field).multiplyScalar(g);
      if (u > 0.86 * reach[j]) cA.lerp(cB.copy(worldColor('bannerRag')), 0.55);
      col.push(cA.r, cA.g, cA.b);
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      // bullet holes / tears: drop a few quads away from the hoist
      if (i > 2 && H(b.seed, i * 17 + j, 33) < 0.07) continue;
      const a = base + j * (NU + 1) + i, c = a + NU + 1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('team', new THREE.Float32BufferAttribute(team, 1));
  g.setAttribute('icon', new THREE.Float32BufferAttribute(iconA, 1));
  g.setAttribute('aspect', new THREE.Float32BufferAttribute(aspectA, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  // (vertexColors off: the colour node reads the cloth colour itself, the icon replaces it)
  const m = toonNoInk({ vertexColors: false, side: THREE.DoubleSide, surface: 'cloth' });
  // flap: travelling waves along the fly, growing away from the hoist, scaled by the weather's wind
  const U = uv();
  const flap = sin(time.mul(3.1).sub(U.x.mul(7))).mul(0.2).add(sin(time.mul(5.7).sub(U.x.mul(13)).add(U.y.mul(2))).mul(0.06));
  m.positionNode = positionLocal.add(normalLocal.mul(flap.mul(U.x).mul(WORLD_WEATHER.wind)));
  // the team icon, drawn from the uv (aspect-corrected around the cloth's middle)
  const q = vec2(U.x.sub(0.5).mul(attribute('aspect', 'float')), U.y.sub(0.52));
  const paw = max(ellipse(q, 0, 0.1, 0.2, 0.15), max(max(ellipse(q, -0.23, -0.09, 0.07, 0.085), ellipse(q, -0.08, -0.2, 0.07, 0.085)), max(ellipse(q, 0.08, -0.2, 0.07, 0.085), ellipse(q, 0.23, -0.09, 0.07, 0.085))));
  const head = max(ellipse(q, 0, 0.06, 0.23, 0.19), max(tri(q, [-0.23, 0.0], [-0.07, -0.08], [-0.2, -0.27]), tri(q, [0.07, -0.08], [0.23, 0.0], [0.2, -0.27])));
  const eyes = max(ellipse(q, -0.09, 0.02, 0.055, 0.03), ellipse(q, 0.09, 0.02, 0.055, 0.03));
  const t = attribute('team', 'float');
  const icon = mix(paw, head.mul(float(1).sub(eyes)), t).mul(attribute('icon', 'float'));
  const iconCol = mix(vec3(...worldColor('teamCorgisTrim').toArray()), vec3(...worldColor('teamCatsTrim').toArray()), t);
  const cloth = attribute('color', 'vec3');
  // the icon is painted on and weathers with the cloth (a little darker where the cloth is grimy)
  m.colorNode = mix(cloth, iconCol.mul(cloth.x.add(cloth.y).add(cloth.z).mul(0.6).add(0.55).min(1)), icon.mul(0.92));
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'fob_banners';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.noCameraCollide = true;
  return mesh;
}

/** Camo nets: sagging cloth over four pole tops, a burlap fringe, diamond mesh holes (alpha test). One mesh. */
function buildNets(list: NetSpec[]): THREE.Mesh | null {
  if (!list.length) return null;
  const NU = 12, NV = 8;
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [], col: number[] = [], idx: number[] = [];
  const camo = ['camoA', 'camoB', 'camoC', 'oliveDark'].map((k) => worldColor(k));
  const P = new THREE.Vector3(), c = new THREE.Color();
  const vert = (x: number, y: number, z: number, u: number, v: number, k: number) => {
    pos.push(x, y, z); nor.push(0, 1, 0); uvs.push(u, v);
    c.copy(camo[k]).multiplyScalar(0.85 + 0.3 * H(Math.round(x * 3), Math.round(z * 3), 41));
    col.push(c.r, c.g, c.b);
    return pos.length / 3 - 1;
  };
  for (const n of list) {
    const [c0, c1, c2, c3] = n.corners.map((p) => new THREE.Vector3(...p));
    const base = pos.length / 3;
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const u = i / NU, v = j / NV;
      // bilinear between the pole tops, sagging in the middle, a little lumpy
      P.copy(c0).multiplyScalar((1 - u) * (1 - v)).addScaledVector(c1, u * (1 - v)).addScaledVector(c2, u * v).addScaledVector(c3, (1 - u) * v);
      P.y -= n.sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) + (H(n.seed + i, j, 42) - 0.5) * 0.12;
      // camo blotches: big cells picked by hash
      const k = Math.floor(H(Math.floor(u * 4.5 + n.seed), Math.floor(v * 3.2), 43) * 4);
      vert(P.x, P.y, P.z, u * 6, v * 4, k);
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = base + j * (NU + 1) + i, b2 = a + NU + 1;
      idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
    }
    // burlap fringe: ragged strips hanging from the front and side edges (the back stays open: the way in)
    const edges: [THREE.Vector3, THREE.Vector3][] = [[c1, c2], [c2, c3], [c3, c0]];
    const fr = n.fringe ?? 0.6;
    edges.forEach(([a, b2], e) => {
      const L = a.distanceTo(b2), n2 = Math.floor(L / 0.4);
      for (let s = 0; s < n2; s++) {
        const t0 = (s + 0.15) / n2, t1 = (s + 0.8) / n2, len = fr * (0.45 + 0.55 * H(n.seed + e, s, 44));
        const p0 = new THREE.Vector3().lerpVectors(a, b2, t0), p1 = new THREE.Vector3().lerpVectors(a, b2, t1);
        p0.y -= 0.05; p1.y -= 0.05;
        const k = Math.floor(H(e, s + n.seed, 45) * 4);
        const i0 = vert(p0.x, p0.y, p0.z, 0.5, 0.5, k), i1 = vert(p1.x, p1.y, p1.z, 0.5, 0.5, k);
        const i2 = vert(p1.x, p1.y - len, p1.z, 0.5, 0.5, k), i3 = vert(p0.x, p0.y - len * 0.8, p0.z, 0.5, 0.5, k);
        idx.push(i0, i1, i2, i0, i2, i3);
      }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = toonNoInk({ vertexColors: true, side: THREE.DoubleSide, surface: 'cloth' });
  // diamond mesh with fabric "leaves": holes where neither the net cords nor a garnish patch cover
  const U = uv();
  const d1 = abs(fract(U.x.add(U.y)).sub(0.5)), d2 = abs(fract(U.x.sub(U.y)).sub(0.5));
  const cords = step(0.42, max(d1, d2));
  const patch = step(0.38, fract(sin(U.x.mul(3.7).floor().add(U.y.mul(5.3).floor().mul(7.1))).mul(43758.5)));
  m.opacityNode = max(cords, patch);
  m.alphaTest = 0.5;
  const sway = sin(time.mul(1.7).add(positionLocal.x.mul(0.6)).add(positionLocal.z.mul(0.4))).mul(0.05).mul(WORLD_WEATHER.wind);
  m.positionNode = positionLocal.add(vec3(0, sway, 0));
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'fob_nets';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.noCameraCollide = true;
  return mesh;
}

// ------------------------------------------------------------------------------------------------ the view
export function createBattleDressing(data: WorldData, opts: BattleDressingOptions = {}): BattleDressing {
  const group = new THREE.Group();
  group.name = 'battle_dressing';
  const layout: BattleLayout | null = battleOf(data);
  const tier = opts.quality === 'med' ? 'medium' : opts.quality ?? styleTier();
  const clutterOn = tier !== 'low';
  const disposables: { dispose(): void }[] = [];
  const counts = { casings: 0, balls: 0, paws: 0, splinters: 0, banners: 0, nets: 0, floods: 0, dressingTris: 0 };
  let floods: FloodApi | null = null;
  if (!layout) {
    return { group, update() {}, stats: () => ({ dressingDraws: 0 }), dispose() { group.removeFromParent(); } };
  }
  const add = (mesh: THREE.Mesh | null) => {
    if (!mesh) return;
    group.add(mesh);
    disposables.push(mesh.geometry, mesh.material as THREE.Material);
    const tris = (mesh.geometry.getIndex()?.count ?? mesh.geometry.getAttribute('position').count) / 3;
    counts.dressingTris += tris * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1);
  };

  // --- cloth
  const banners = buildBanners(layout.banners);
  add(banners);
  counts.banners = layout.banners.length;
  const nets = buildNets(layout.nets);
  add(nets);
  counts.nets = layout.nets.length;

  // --- floodlights (the style lane helper; if it is ever missing, the poles and ballast boxes stay, unlit)
  const create = (FLOODLIGHTS as unknown as Record<string, unknown>).createFloodlights as ((o: Record<string, unknown>) => FloodApi) | undefined;
  if (typeof create === 'function' && layout.floods.length) {
    floods = create({ tier, ...(opts.lights ? {} : { budget: 0 }), capacity: Math.max(8, layout.floods.length) });
    for (const f of layout.floods) {
      const ty = data.height(f.target[0], f.target[2]);
      floods.add({ pos: f.pos, target: [f.target[0], ty, f.target[2]], poolRadius: f.poolRadius });
    }
    floods.group.traverse((o) => { o.userData.noCameraCollide = true; });
    group.add(floods.group);
    counts.floods = layout.floods.length;
  }

  // --- clutter (dropped on the low tier)
  if (clutterOn) {
    const by = (k: ClutterSpec['kind']) => layout.clutter.filter((c) => c.kind === k).flatMap((c) => scatter(data, c));
    const n = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), e = new THREE.Euler();
    const sc = new THREE.Vector3(), p = new THREE.Vector3();
    // spent casings: short brass tubes lying on their sides
    const casingGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.17, 3, 1);           // 8 tris: they are specks
    const casings = by('casings');
    add(instanced(casingGeo, toonNoInk({ color: 0xffffff, surface: 'metal' }), casings, (i, m) => {
      e.set(Math.PI / 2, i.yaw, (i.tilt - 0.5) * 0.3, 'YXZ');
      m.compose(p.set(i.x, i.y + 0.03, i.z), q.setFromEuler(e), sc.setScalar(i.s));
    }, (i, c) => c.copy(worldColor('brassCasing')).multiplyScalar(0.7 + 0.5 * i.tint), 'fob_casings'));
    counts.casings = casings.length;
    // spent tennis balls, half sunk in the mud
    const balls = by('balls');
    add(instanced(new THREE.SphereGeometry(0.13, 6, 4), toonNoInk({ color: 0xffffff, surface: 'cloth' }), balls, (i, m) => {
      m.compose(p.set(i.x, i.y + 0.07, i.z), q.setFromEuler(e.set(i.tilt * 3, i.yaw, 0)), sc.setScalar(i.s));
    }, (i, c) => c.copy(worldColor('tennisFelt')).lerp(worldColor('mud'), 0.15 + 0.45 * i.tint), 'fob_balls'));
    counts.balls = balls.length;
    // splinters by the barricades and the tower
    const splinters = by('splinters');
    add(instanced(new THREE.BoxGeometry(0.08, 0.04, 0.46), toonNoInk({ color: 0xffffff, surface: 'wood' }), splinters, (i, m) => {
      m.compose(p.set(i.x, i.y + 0.03, i.z), q.setFromEuler(e.set(0, i.yaw, (i.tilt - 0.5) * 0.4)), sc.set(1, 1, i.s * 1.3));
    }, (i, c) => c.copy(worldColor(i.tint > 0.5 ? 'splinter' : 'trim')).multiplyScalar(0.8), 'fob_splinters'));
    counts.splinters = splinters.length;
    // muddy paw prints: alpha-tested decals on the terrain (pad + four toes), aligned to the ground's slope
    const paws = by('paws');
    const pawGeo = new THREE.PlaneGeometry(0.3, 0.34);
    pawGeo.rotateX(-Math.PI / 2);
    const pawMat = toonNoInk({ color: 0xffffff, surface: 'ground' });
    const pu = vec2(uv().x.sub(0.5), uv().y.sub(0.5));
    pawMat.opacityNode = max(ellipse(pu, 0, -0.12, 0.2, 0.17, 0.03), max(max(ellipse(pu, -0.25, 0.1, 0.08, 0.1, 0.03), ellipse(pu, -0.09, 0.24, 0.08, 0.1, 0.03)), max(ellipse(pu, 0.09, 0.24, 0.08, 0.1, 0.03), ellipse(pu, 0.25, 0.1, 0.08, 0.1, 0.03))));
    pawMat.alphaTest = 0.5;
    pawMat.polygonOffset = true;
    pawMat.polygonOffsetFactor = -2;
    pawMat.polygonOffsetUnits = -2;
    add(instanced(pawGeo, pawMat, paws, (i, m) => {
      groundNormal(data, i.x, i.z, n);
      q.setFromUnitVectors(up, n).multiply(qy.setFromAxisAngle(up, i.yaw));
      m.compose(p.set(i.x, i.y + 0.025, i.z), q, sc.setScalar(i.s * 0.9));
    }, (i, c) => c.copy(worldColor('mudWet')).multiplyScalar(0.8 + 0.4 * i.tint), 'fob_paws'));
    counts.paws = paws.length;
  }

  const draws = group.children.filter((o) => (o as THREE.Mesh).isMesh).length;
  return {
    group,
    update(camera) { if (opts.lights) floods?.update(camera); },
    stats: () => ({ dressingDraws: draws + (floods ? 3 : 0), ...counts, dressingTris: Math.round(counts.dressingTris) }),
    dispose() {
      for (const d of disposables) d.dispose();
      (floods as unknown as { dispose?(): void } | null)?.dispose?.();
      group.removeFromParent();
    },
  };
}
