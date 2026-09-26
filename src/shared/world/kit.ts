// Prop kit: emits collider data (PropBox / PropCylinder) and visual primitives (VisualPrim) together,
// so every solid thing in the yard has a matching collider by construction. Frames place a prop in
// its own local space (origin + yaw). Pure data, no three.
import type { PrimGroup, PropBox, PropCylinder, VisualPrim } from './world-types';

export interface PrimOpts {
  yaw?: number; pitch?: number; roll?: number;
  bev?: number; seg?: number; g?: PrimGroup;
}

export class Kit {
  readonly props: PropBox[] = [];
  readonly cylinders: PropCylinder[] = [];
  readonly prims: VisualPrim[] = [];

  frame(x: number, y: number, z: number, yaw = 0): Frame {
    return new Frame(this, x, y, z, yaw);
  }

  colBox(type: string, x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0, pitch = 0, roll = 0): void {
    const b: PropBox = { type, x, y, z, hx, hy, hz, rotY };
    if (pitch) b.pitch = pitch;
    if (roll) b.roll = roll;
    this.props.push(b);
  }

  colCyl(type: string, x: number, y: number, z: number, r: number, hh: number): void {
    this.cylinders.push({ type, x, y, z, r, hh });
  }
}

export class Frame {
  private readonly c: number;
  private readonly s: number;
  constructor(readonly kit: Kit, readonly ox: number, readonly oy: number, readonly oz: number, readonly yaw: number) {
    this.c = Math.cos(yaw); this.s = Math.sin(yaw);
  }

  /** Local -> world. Yaw rotates +Z toward +X (right-handed about +Y, like three.js). */
  w(lx: number, ly: number, lz: number): [number, number, number] {
    return [this.ox + lx * this.c + lz * this.s, this.oy + ly, this.oz - lx * this.s + lz * this.c];
  }

  sub(lx: number, ly: number, lz: number, yaw = 0): Frame {
    const [x, y, z] = this.w(lx, ly, lz);
    return new Frame(this.kit, x, y, z, this.yaw + yaw);
  }

  private prim(s: VisualPrim['s'], lx: number, ly: number, lz: number, a: number, b: number, c: number, col: string, o: PrimOpts = {}): VisualPrim {
    const [x, y, z] = this.w(lx, ly, lz);
    const p: VisualPrim = { s, x, y, z, a, b, c, col };
    const yaw = this.yaw + (o.yaw ?? 0);
    if (yaw) p.yaw = yaw;
    if (o.pitch) p.pitch = o.pitch;
    if (o.roll) p.roll = o.roll;
    if (o.bev !== undefined) p.bev = o.bev;
    if (o.seg !== undefined) p.seg = o.seg;
    if (o.g) p.g = o.g;
    this.kit.prims.push(p);
    return p;
  }

  /** Visual rounded box centered at local (lx, ly, lz), size w x h x d. (E4: `seg: 1` asks the client for a cheaper
   *  single-chamfer bevel, 44 tris instead of 92 — sacks and other soft shapes.) */
  box(lx: number, ly: number, lz: number, w: number, h: number, d: number, col: string, o: PrimOpts = {}): void {
    this.prim('box', lx, ly, lz, w, h, d, col, { bev: Math.min(0.12, w * 0.25, h * 0.25, d * 0.25), ...o });
  }

  /** Collider-only box (full dims), same rotation convention. */
  colBox(type: string, lx: number, ly: number, lz: number, w: number, h: number, d: number, o: PrimOpts = {}): void {
    const [x, y, z] = this.w(lx, ly, lz);
    this.kit.colBox(type, x, y, z, w / 2, h / 2, d / 2, this.yaw + (o.yaw ?? 0), o.pitch ?? 0, o.roll ?? 0);
  }

  /** Visual + collider box. */
  solid(type: string, lx: number, ly: number, lz: number, w: number, h: number, d: number, col: string, o: PrimOpts = {}): void {
    this.box(lx, ly, lz, w, h, d, col, o);
    this.colBox(type, lx, ly, lz, w, h, d, o);
  }

  /** Visual cylinder (axis local +Y before rotation). rTop, height, rBottom. */
  cyl(lx: number, ly: number, lz: number, rTop: number, h: number, rBot: number, col: string, o: PrimOpts = {}): void {
    this.prim('cyl', lx, ly, lz, rTop, h, rBot, col, o);
  }

  /** Visual + upright collider cylinder (collider radius = the larger radius). */
  solidCyl(type: string, lx: number, ly: number, lz: number, rTop: number, h: number, rBot: number, col: string, o: PrimOpts = {}): void {
    this.cyl(lx, ly, lz, rTop, h, rBot, col, o);
    this.colCyl(type, lx, ly, lz, Math.max(rTop, rBot), h / 2);
  }

  colCyl(type: string, lx: number, ly: number, lz: number, r: number, hh: number): void {
    const [x, y, z] = this.w(lx, ly, lz);
    this.kit.colCyl(type, x, y, z, r, hh);
  }

  sphere(lx: number, ly: number, lz: number, rx: number, ry: number, rz: number, col: string, o: PrimOpts = {}): void {
    this.prim('sphere', lx, ly, lz, rx, ry, rz, col, o);
  }

  torus(lx: number, ly: number, lz: number, R: number, tube: number, col: string, o: PrimOpts & { arc?: number } = {}): void {
    this.prim('torus', lx, ly, lz, R, tube, o.arc ?? 0, col, o);
  }

  /** Thick open tube (e.g. a paddling-pool wall): outer radius, height, wall thickness. */
  ring(lx: number, ly: number, lz: number, rOuter: number, h: number, wall: number, col: string, o: PrimOpts = {}): void {
    this.prim('ring', lx, ly, lz, rOuter, h, wall, col, o);
  }

  cone(lx: number, ly: number, lz: number, r: number, h: number, col: string, o: PrimOpts = {}): void {
    this.prim('cone', lx, ly, lz, r, h, 0, col, o);
  }

  /**
   * Walkable ramp collider whose TOP face runs from local point `top` to local point `bot` (edge
   * centers), `width` wide and `thick` deep below the surface. Returns the ramp slope (deg).
   */
  ramp(type: string, top: [number, number, number], bot: [number, number, number], width: number, thick = 1): number {
    const [tx, ty, tz] = this.w(...top), [bx, by, bz] = this.w(...bot);
    const dx = bx - tx, dy = by - ty, dz = bz - tz;
    const hl = Math.hypot(dx, dz), len = Math.hypot(hl, dy);
    const yaw = Math.atan2(dx, dz);           // local +Z points downhill (horizontal part)
    const pitch = Math.atan2(-dy, hl);        // positive pitch tilts local +Z downward
    // top-face normal = Ry(yaw) Rx(pitch) (0,1,0)
    const sp = Math.sin(pitch), cp = Math.cos(pitch);
    const nx = sp * Math.sin(yaw), ny = cp, nz = sp * Math.cos(yaw);
    const cx = (tx + bx) / 2 - nx * thick / 2, cy = (ty + by) / 2 - ny * thick / 2, cz = (tz + bz) / 2 - nz * thick / 2;
    this.kit.colBox(type, cx, cy, cz, width / 2, thick / 2, len / 2, yaw, pitch, 0);
    return (Math.atan2(-dy, hl) * 180) / Math.PI;
  }
}
