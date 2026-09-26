// Terrain meshes built from the SAME baked grid + triangle diagonal the Rapier heightfield uses
// (buildTerrainChunkArrays at step 1), so what players see is exactly what they stand on.
// 3x3 chunks for frustum culling, a flat outer ground ring to the horizon, and a coarse invisible
// proxy (step 2) for camera raycasts.
import * as THREE from 'three/webgpu';
import type { WorldData } from '../../shared/world/world-data';
import { buildTerrainChunkArrays } from '../../shared/world/terrain';
import { toonFrom } from './materials';

export interface TerrainView {
  group: THREE.Group;
  chunks: THREE.Mesh[];
  proxy: THREE.Group;
  triangles: number;
  dispose(): void;
}

function geometryFrom(a: ReturnType<typeof buildTerrainChunkArrays>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  if (a.surf) g.setAttribute('surf', new THREE.BufferAttribute(a.surf, 4));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.userData.outlineReady = true;
  return g;
}

export function createTerrainView(data: WorldData, material: THREE.Material, opts: { chunks?: number; outer?: number } = {}): TerrainView {
  const group = new THREE.Group();
  group.name = 'terrain';
  const proxy = new THREE.Group();
  proxy.name = 'terrain_proxy';
  const chunks: THREE.Mesh[] = [];
  const disposables: THREE.BufferGeometry[] = [];
  let triangles = 0;
  const g = data.terrain;
  const outerR = opts.outer ?? 900;
  let inner = 0;
  if (g) {
    const res = g.n - 1, per = opts.chunks ?? 3, cells = Math.ceil(res / per);
    inner = res * g.cell / 2;
    const proxyMat = toonFrom();
    for (let cj = 0; cj < per; cj++) for (let ci = 0; ci < per; ci++) {
      const i0 = ci * cells, j0 = cj * cells, i1 = Math.min(res, i0 + cells), j1 = Math.min(res, j0 + cells);
      const arrays = buildTerrainChunkArrays(g, i0, j0, i1, j1, 1, data.surface);
      const geo = geometryFrom(arrays);
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = `terrain_${ci}_${cj}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData.noCameraCollide = true;
      group.add(mesh);
      chunks.push(mesh);
      disposables.push(geo);
      triangles += arrays.index.length / 3;
      // camera proxy (every 2nd sample)
      const pa = buildTerrainChunkArrays(g, i0, j0, i1, j1, 2);
      const pg = geometryFrom(pa);
      const pm = new THREE.Mesh(pg, proxyMat);
      pm.visible = false;
      pm.name = `terrain_proxy_${ci}_${cj}`;
      proxy.add(pm);
      disposables.push(pg);
    }
  }
  // Outer ground ring (flat, y = 0) from the grid edge to the horizon; a square hole of half-size `inner`.
  {
    const step = 20, R = outerR, pos: number[] = [], nor: number[] = [], surf: number[] = [], idx: number[] = [];
    const n = Math.round((2 * R) / step);
    const vid = (i: number, j: number) => j * (n + 1) + i;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      let x = -R + i * step, z = -R + j * step;
      // snap the ring's inner vertices onto the grid border so there are no gaps
      if (Math.abs(x) < inner && Math.abs(z) < inner) { x = Math.max(-inner, Math.min(inner, x)); z = Math.max(-inner, Math.min(inner, z)); }
      pos.push(x, data.height(x, z), z); nor.push(0, 1, 0); surf.push(0, 0, 0, 0.35);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const cx = -R + (i + 0.5) * step, cz = -R + (j + 0.5) * step;
      if (inner > 0 && Math.abs(cx) < inner && Math.abs(cz) < inner) continue;
      const a = vid(i, j), b = vid(i + 1, j), c = vid(i, j + 1), d = vid(i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('surf', new THREE.Float32BufferAttribute(surf, 4));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.userData.outlineReady = true;
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'terrain_outer';
    mesh.receiveShadow = true;
    mesh.userData.noCameraCollide = true;
    group.add(mesh);
    disposables.push(geo);
    triangles += idx.length / 3;
    if (!g) {
      const pm = new THREE.Mesh(geo, toonFrom());
      pm.visible = false;
      proxy.add(pm);
    }
  }
  return {
    group, chunks, proxy, triangles,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}

/** Invisible collider proxies (props + cylinders) for cheap, accurate camera raycasts. */
export function createColliderProxy(data: WorldData): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = 'collider_proxy';
  const cell = 50;
  const buckets = new Map<string, { pos: number[]; idx: number[] }>();
  const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Matrix4, x: number, z: number) => {
    const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    let b = buckets.get(k);
    if (!b) { b = { pos: [], idx: [] }; buckets.set(k, b); }
    const p = geo.getAttribute('position'), index = geo.getIndex()!;
    const base = b.pos.length / 3;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mat); b.pos.push(v.x, v.y, v.z); }
    for (let i = 0; i < index.count; i++) b.idx.push(base + index.getX(i));
  };
  for (const p of data.props) {
    if (p.type === 'boundary') continue;
    e.set(p.pitch ?? 0, p.rotY, p.roll ?? 0, 'YXZ');
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromEuler(e), new THREE.Vector3(p.hx * 2, p.hy * 2, p.hz * 2));
    add(box, m, p.x, p.z);
  }
  for (const c of data.cylinders ?? []) {
    m.compose(new THREE.Vector3(c.x, c.y, c.z), q.identity(), new THREE.Vector3(c.r, c.hh * 2, c.r));
    add(cyl, m, c.x, c.z);
  }
  const mat = toonFrom();
  const geos: THREE.BufferGeometry[] = [];
  for (const [k, b] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setIndex(b.idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.visible = false;
    mesh.name = `collider_proxy_${k}`;
    group.add(mesh);
    geos.push(g);
  }
  box.dispose(); cyl.dispose();
  return { group, dispose() { for (const g of geos) g.dispose(); mat.dispose(); } };
}
