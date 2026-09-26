// Water surfaces for WorldData.water zones: polar-grid discs at surfaceY with a per-vertex `depth`
// attribute (water depth over the terrain / pool floor) driving the stylized water material.
import * as THREE from 'three/webgpu';
import type { WaterZone, WorldData } from '../../shared/world/world-data';
import { createWaterMaterial } from './materials';

export function createWaterView(data: WorldData): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = 'water';
  const disposables: { dispose(): void }[] = [];
  for (const w of data.water ?? []) {
    const geo = w.shape === 'circle' ? discGeometry(data, w) : rectGeometry(data, w);
    const mat = createWaterMaterial(new THREE.Vector2(w.x, w.z));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `water_${w.id}`;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    mesh.userData.noCameraCollide = true;
    group.add(mesh);
    disposables.push(geo, mat);
  }
  return { group, dispose() { for (const d of disposables) d.dispose(); } };
}

function depthAt(data: WorldData, w: WaterZone, x: number, z: number, edge: number): number {
  const floor = w.id === 'kiddie_pool' ? w.bottomY : data.height(x, z);
  let d = Math.max(0, w.surfaceY - floor);
  if (w.id === 'kiddie_pool') d = Math.min(d, edge * 0.55);        // foam along the pool wall
  return d;
}

function discGeometry(data: WorldData, w: WaterZone): THREE.BufferGeometry {
  const R = w.r ?? 1, rings = Math.max(8, Math.round(R * 1.6)), segs = 64;
  const pos: number[] = [], depth: number[] = [], nor: number[] = [], idx: number[] = [];
  pos.push(w.x, w.surfaceY, w.z); nor.push(0, 1, 0); depth.push(depthAt(data, w, w.x, w.z, R));
  for (let r = 1; r <= rings; r++) {
    const rr = (R * r) / rings;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2, x = w.x + Math.cos(a) * rr, z = w.z + Math.sin(a) * rr;
      pos.push(x, w.surfaceY, z); nor.push(0, 1, 0); depth.push(depthAt(data, w, x, z, R - rr));
    }
  }
  const vid = (r: number, s: number) => (r === 0 ? 0 : 1 + (r - 1) * segs + (s % segs));
  for (let s = 0; s < segs; s++) idx.push(0, vid(1, s + 1), vid(1, s));
  for (let r = 1; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = vid(r, s), b = vid(r, s + 1), c = vid(r + 1, s), d = vid(r + 1, s + 1);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function rectGeometry(data: WorldData, w: WaterZone): THREE.BufferGeometry {
  const hx = w.hx ?? 1, hz = w.hz ?? 1, nx = Math.max(2, Math.round(hx)), nz = Math.max(2, Math.round(hz));
  const g = new THREE.PlaneGeometry(hx * 2, hz * 2, nx, nz).rotateX(-Math.PI / 2).translate(w.x, w.surfaceY, w.z);
  const p = g.getAttribute('position'), depth = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) depth[i] = depthAt(data, w, p.getX(i), p.getZ(i), Math.min(hx - Math.abs(p.getX(i) - w.x), hz - Math.abs(p.getZ(i) - w.z)));
  g.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
  g.deleteAttribute('uv');
  return g;
}
