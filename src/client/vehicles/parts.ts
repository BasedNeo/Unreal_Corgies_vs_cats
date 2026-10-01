// Merged-part geometry builder for vehicle props: many small primitives -> ONE indexed geometry with
// vertex colors (one style material, one draw call). Mirrors the world lane's prim merger
// (src/client/world/prim-mesh.ts) at prop scale. W13 (docs/design/LOOK.md): no crease lines; hard edges keep their
// faces' normals (the style's crease angle), smooth parts are welded.
import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { STYLE } from '../style/style-tokens.js';
import { smoothNormalsByPosition } from '../style/style-utils.js';

const tmpV = new THREE.Vector3(), tmpN = new THREE.Vector3(), nm = new THREE.Matrix3();

export class PartBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  /**
   * Add a part. The geometry is consumed. color < 0 keeps the geometry's own vertex colors (a pre-merged
   * sub-assembly). `_crease` is ignored (W13: no crease lines; kept so the model builders' calls stay as they are).
   */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, color: number, _crease = false): this {
    // weld seams, keep edges sharper than the crease angle hard (PBR shading reads the edges)
    if (!g.userData.outlineReady) smoothNormalsByPosition(THREE, g, 1e-4, STYLE.crease.angleDeg);
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    nm.getNormalMatrix(m);
    const c = new THREE.Color(Math.max(0, color));
    const vc = color < 0 ? g.getAttribute('color') : null;
    const base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      tmpV.fromBufferAttribute(p, i).applyMatrix4(m);
      tmpN.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(tmpV.x, tmpV.y, tmpV.z);
      this.nor.push(tmpN.x, tmpN.y, tmpN.z);
      if (vc) this.col.push(vc.getX(i), vc.getY(i), vc.getZ(i));
      else this.col.push(c.r, c.g, c.b);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    g.dispose();
    return this;
  }

  get triangles(): number { return this.idx.length / 3; }

  build(): { geometry: THREE.BufferGeometry } {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.userData.outlineReady = true;
    return { geometry: g };
  }
}

// ---- transform helpers -------------------------------------------------------------------------

const e = new THREE.Euler(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
/** Matrix from position, Euler (YXZ like the rest of the project) and scale. */
export function at(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  e.set(rx, ry, rz, 'YXZ');
  q.setFromEuler(e);
  return new THREE.Matrix4().compose(pv.set(x, y, z), q, sv.set(sx, sy, sz));
}

export const rbox = (w: number, h: number, d: number, r = 0.06, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, r);
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg);
export const torus = (r: number, tube: number, rs = 5, ts = 14, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, rs, ts, arc);
export const ball = (r: number, ws = 10, hs = 7) => new THREE.SphereGeometry(r, ws, hs);

/** Triangles + draw calls actually present under a root (lines count as draws). */
export function measureObject(root: THREE.Object3D): { triangles: number; drawCalls: number } {
  let triangles = 0, drawCalls = 0;
  root.traverse((o) => {
    if (!o.visible) return;
    const m = o as THREE.Mesh & { isLineSegments2?: boolean; isInstancedMesh?: boolean; count?: number };
    if (m.isLineSegments2) { drawCalls++; return; }
    if (!m.isMesh) return;
    drawCalls++;
    const g = m.geometry;
    const t = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    triangles += m.isInstancedMesh ? t * (m.count ?? 1) : t;
  });
  return { triangles, drawCalls };
}
