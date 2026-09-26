// Rig runtime: a per-instance pose buffer (Euler rotations + offsets + scales per bone), forward
// kinematics in "rig space" (the root bone's local space), analytic two-bone IK, and write-out to
// THREE.Bone objects. Every bone's rest rotation is identity, so procedural animation is authored
// as plain local Euler angles (order YXZ: yaw, then pitch, then roll) on top of rest offsets.
import * as THREE from 'three/webgpu';

/** Skeleton template shared by every character (species differ only in rest positions/scales). */
export interface RigTemplate {
  names: readonly string[];
  /** Parent index per bone (-1 for the root). Parents always precede children. */
  parent: Int16Array;
  /** Rest head position of each bone in model space (character space, feet at y = 0, facing -Z). */
  modelRest: Float32Array;
  /** Rest local offset from the parent (parent-local, before the parent's rest scale). */
  restLocal: Float32Array;
  /** Rest scale per bone (xyz), e.g. oval eye sockets. */
  restScale: Float32Array;
  /** Model-space tail point per bone (segment used for automatic skin weights). */
  tail: Float32Array;
  index: Readonly<Record<string, number>>;
}

export class PoseBuffer {
  readonly rot: Float32Array;
  readonly off: Float32Array;
  readonly scl: Float32Array;
  constructor(readonly n: number) {
    this.rot = new Float32Array(n * 3);
    this.off = new Float32Array(n * 3);
    this.scl = new Float32Array(n * 3);
    this.clear();
  }
  clear(): void { this.rot.fill(0); this.off.fill(0); this.scl.fill(1); }
  /** Add a weighted rotation (radians). */
  r(b: number, x: number, y: number, z: number, w = 1): void {
    const i = b * 3; this.rot[i] += x * w; this.rot[i + 1] += y * w; this.rot[i + 2] += z * w;
  }
  /** Add a weighted translation offset (parent-local meters). */
  o(b: number, x: number, y: number, z: number, w = 1): void {
    const i = b * 3; this.off[i] += x * w; this.off[i + 1] += y * w; this.off[i + 2] += z * w;
  }
  /** Multiply the scale. */
  s(b: number, x: number, y = x, z = x): void {
    const i = b * 3; this.scl[i] *= x; this.scl[i + 1] *= y; this.scl[i + 2] *= z;
  }
  copy(src: PoseBuffer): void { this.rot.set(src.rot); this.off.set(src.off); this.scl.set(src.scl); }
  /** this = lerp(this, other, t) for rotations/offsets/scales. */
  lerpTo(other: PoseBuffer, t: number): void {
    if (t <= 0) return;
    for (let i = 0; i < this.rot.length; i++) {
      this.rot[i] += (other.rot[i] - this.rot[i]) * t;
      this.off[i] += (other.off[i] - this.off[i]) * t;
      this.scl[i] += (other.scl[i] - this.scl[i]) * t;
    }
  }
}

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
// Private temporaries for decompose() so callers' vectors are never clobbered.
const _dp = new THREE.Vector3(), _ds = new THREE.Vector3();
// IK temporaries.
const kS = new THREE.Vector3(), kE = new THREE.Vector3(), kW = new THREE.Vector3(), kD = new THREE.Vector3();
const kP = new THREE.Vector3(), kEd = new THREE.Vector3(), kA = new THREE.Vector3(), kB = new THREE.Vector3();
const kQ = new THREE.Quaternion(), kQ2 = new THREE.Quaternion(), kQp = new THREE.Quaternion();

/** Per-instance runtime: bones + rig-space matrices. */
export class RigInstance {
  readonly bones: THREE.Bone[];
  readonly pose: PoseBuffer;
  /** Rig-space (root-local) matrices after FK/IK. Index 0 is identity (root). */
  readonly model: THREE.Matrix4[];
  readonly local: THREE.Matrix4[];
  readonly quat: THREE.Quaternion[];
  readonly pos: THREE.Vector3[];
  readonly scale: THREE.Vector3[];
  /** Per-instance multiplicative scale on top of rest scale (seeded proportions). */
  readonly baseScale: Float32Array;

  constructor(readonly tpl: RigTemplate) {
    const n = tpl.names.length;
    this.pose = new PoseBuffer(n);
    this.baseScale = new Float32Array(n * 3).fill(1);
    this.bones = [];
    this.model = []; this.local = []; this.quat = []; this.pos = []; this.scale = [];
    for (let i = 0; i < n; i++) {
      const b = new THREE.Bone();
      b.name = tpl.names[i];
      b.position.fromArray(tpl.restLocal, i * 3);
      b.scale.fromArray(tpl.restScale, i * 3);
      // Local matrices are written directly each frame (skips three's quaternion→Euler sync).
      b.matrixAutoUpdate = false;
      b.updateMatrix();
      this.bones.push(b);
      if (tpl.parent[i] >= 0) this.bones[tpl.parent[i]].add(b);
      this.model.push(new THREE.Matrix4());
      this.local.push(new THREE.Matrix4());
      this.quat.push(new THREE.Quaternion());
      this.pos.push(new THREE.Vector3());
      this.scale.push(new THREE.Vector3(1, 1, 1));
    }
  }

  get root(): THREE.Bone { return this.bones[0]; }

  /** Model-space bind matrices (for bone inverses). */
  static bindMatrices(tpl: RigTemplate): THREE.Matrix4[] {
    const n = tpl.names.length, out: THREE.Matrix4[] = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.Matrix4().compose(_v.fromArray(tpl.restLocal, i * 3), _q.identity(), _s.fromArray(tpl.restScale, i * 3));
      out.push(tpl.parent[i] >= 0 ? new THREE.Matrix4().multiplyMatrices(out[tpl.parent[i]], l) : l);
    }
    return out;
  }

  /** Pose buffer → local TRS for every bone (bone 0 excluded from rig space: its matrix stays identity). */
  evaluate(): void {
    const { tpl, pose } = this;
    const n = tpl.names.length;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      _e.set(pose.rot[i3], pose.rot[i3 + 1], pose.rot[i3 + 2], 'YXZ');
      this.quat[i].setFromEuler(_e);
      this.pos[i].set(tpl.restLocal[i3] + pose.off[i3], tpl.restLocal[i3 + 1] + pose.off[i3 + 1], tpl.restLocal[i3 + 2] + pose.off[i3 + 2]);
      this.scale[i].set(
        tpl.restScale[i3] * this.baseScale[i3] * pose.scl[i3],
        tpl.restScale[i3 + 1] * this.baseScale[i3 + 1] * pose.scl[i3 + 1],
        tpl.restScale[i3 + 2] * this.baseScale[i3 + 2] * pose.scl[i3 + 2],
      );
    }
    this.model[0].identity();
    for (let i = 1; i < n; i++) this.updateModel(i);
  }

  updateModel(i: number): void {
    this.local[i].compose(this.pos[i], this.quat[i], this.scale[i]);
    const p = this.tpl.parent[i];
    if (p <= 0) this.model[i].copy(this.local[i]);
    else this.model[i].multiplyMatrices(this.model[p], this.local[i]);
  }

  /** Recompute model matrices of bone `i` and all of its descendants (template order). */
  updateSubtree(i: number): void {
    this.updateModel(i);
    const n = this.tpl.names.length, par = this.tpl.parent;
    // Descendants appear after `i`; a bone is in the subtree if its parent is.
    const inTree = RigInstance._mark;
    inTree.fill(0, 0, n);
    inTree[i] = 1;
    for (let j = i + 1; j < n; j++) if (par[j] >= 0 && inTree[par[j]]) { inTree[j] = 1; this.updateModel(j); }
  }
  private static _mark = new Uint8Array(64);

  modelPos(i: number, out: THREE.Vector3): THREE.Vector3 { return out.setFromMatrixPosition(this.model[i]); }
  modelQuat(i: number, out: THREE.Quaternion): THREE.Quaternion {
    this.model[i].decompose(_dp, out, _ds);
    return out;
  }

  /** Point in bone-local space → rig space. */
  toModel(i: number, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 { return out.copy(local).applyMatrix4(this.model[i]); }

  /**
   * Set a bone's local transform so that its rig-space matrix equals `m` (rig space).
   * Used for props (weapon) whose placement is computed directly in rig space.
   */
  setModelMatrix(i: number, m: THREE.Matrix4): void {
    const p = this.tpl.parent[i];
    if (p > 0) _m.copy(this.model[p]).invert().multiply(m); else _m.copy(m);
    _m.decompose(this.pos[i], this.quat[i], this.scale[i]);
    this.updateSubtree(i);
  }

  /**
   * Analytic two-bone IK (upper → lower → end) in rig space.
   * `target` = desired end position, `pole` = direction the middle joint should bend toward.
   */
  solveTwoBone(upper: number, lower: number, end: number, target: THREE.Vector3, pole: THREE.Vector3, weight: number): void {
    if (weight <= 0.001) return;
    const S = this.modelPos(upper, kS), E = this.modelPos(lower, kE), W = this.modelPos(end, kW);
    const la = S.distanceTo(E), lb = E.distanceTo(W);
    if (la < 1e-5 || lb < 1e-5) return;
    const D = kD.subVectors(target, S);
    let dist = D.length();
    if (dist < 1e-5) return;
    D.divideScalar(dist);
    // Clamp the reach so the chain never snaps fully straight or folds through itself.
    dist = Math.min(Math.max(dist, Math.abs(la - lb) + 1e-3), (la + lb) * 0.999);
    const P = kP.copy(pole).addScaledVector(D, -pole.dot(D));
    if (P.lengthSq() < 1e-8) { P.subVectors(E, S); P.addScaledVector(D, -P.dot(D)); }
    if (P.lengthSq() < 1e-8) P.set(0, -1, 0);
    P.normalize();
    const cosA = Math.min(1, Math.max(-1, (la * la + dist * dist - lb * lb) / (2 * la * dist)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const Ed = kEd.copy(S).addScaledVector(D, la * cosA).addScaledVector(P, la * sinA);

    // Upper bone: rotate the current direction onto the desired one (rig-space delta) → local.
    const par = this.tpl.parent[upper];
    this.modelQuat(upper, kQ);
    kQ2.setFromUnitVectors(kA.subVectors(E, S).normalize(), kB.subVectors(Ed, S).normalize()).multiply(kQ);
    if (par > 0) this.modelQuat(par, kQp).invert().multiply(kQ2); else kQp.copy(kQ2);
    this.quat[upper].slerp(kQp, weight);
    this.updateSubtree(upper);

    // Lower bone: from the new elbow, aim the end at the target.
    this.modelPos(lower, kE); this.modelPos(end, kW);
    this.modelQuat(lower, kQ);
    kQ2.setFromUnitVectors(kA.subVectors(kW, kE).normalize(), kB.subVectors(target, kE).normalize()).multiply(kQ);
    this.modelQuat(upper, kQp).invert().multiply(kQ2);
    this.quat[lower].slerp(kQp, weight);
    this.updateSubtree(lower);
  }

  /**
   * Write local matrices into the THREE bones (matrixAutoUpdate is off, so position/quaternion/
   * scale on the Bone objects are not maintained). `rootPos`/`rootQuat`/`rootScale` drive bone 0.
   */
  apply(rootPos: THREE.Vector3, rootQuat: THREE.Quaternion, rootScale: THREE.Vector3): void {
    const b0 = this.bones[0];
    b0.matrix.compose(rootPos, rootQuat, rootScale);
    b0.matrixWorldNeedsUpdate = true;
    for (let i = 1; i < this.bones.length; i++) {
      const b = this.bones[i];
      b.matrix.copy(this.local[i]);
      b.matrixWorldNeedsUpdate = true;
    }
  }
}
