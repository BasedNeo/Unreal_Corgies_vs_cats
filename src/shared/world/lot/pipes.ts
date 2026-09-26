// Concrete drainage pipes: a 'ring' VisualPrim (the client lathes it with `seg` segments: an N-sided tube, vertices
// at lathe angles 2*pi*k/N) and one box collider per facet, lying exactly on the lathe's flat outer and inner faces,
// so the collider IS the visual (the only difference: the lathe's 0.12 m chamfers at the two mouths).
//
// Orientation: the ring's lathe axis (local +Y) is turned onto the pipe axis by roll = -pi/2 (local +Y -> +X), spun
// about its own axis by pitch = spin (Euler 'YXZ': Rz first, then Rx about the now-horizontal axis, then yaw). With
// spin = pi/N the bottom and top facets are flat: the inner bottom facet is the tunnel's walkable floor.
// Facet k (lathe angle phi_k = 2*pi*(k + 0.5)/N) has the outward normal Ry(yaw) * (0, -sin(phi+spin), cos(phi+spin)),
// which is a box's local +Y for a box rotated Ry(yaw) * Rx(phi + spin + pi/2): local +X stays on the pipe axis.
import type { Kit } from '../kit';

export interface PipeSpec {
  /** Outer / inner radius (m, lathe vertex radius), facets, length. */
  ro: number; ri: number; seg: number; len: number;
}

export interface PipePlaced {
  /** Axis centre (world). */
  x: number; y: number; z: number;
  /** Heading of the pipe axis: the axis runs along (cos yaw, 0, -sin yaw) (yaw = -pi/2: along z). */
  yaw: number;
  /** Height of the inner floor facet (world) and of the outer crown facet. */
  floorY: number; crownY: number;
}

/** Flat-bottom spin for an N-sided ring (a facet centred straight down). */
export const pipeSpin = (seg: number): number => Math.PI / seg;

/**
 * A pipe lying on its flat bottom facet at `bottomY` (world height of the outer bottom face), centred at (x, z) with
 * its axis heading `yaw`. Emits the ring prim and seg box colliders of type `type`.
 */
export function addPipe(kit: Kit, spec: PipeSpec, x: number, bottomY: number, z: number, yaw: number, col: string, type = 'pipe'): PipePlaced {
  const N = spec.seg, spin = pipeSpin(N), cosH = Math.cos(Math.PI / N), sinH = Math.sin(Math.PI / N);
  const y = bottomY + spec.ro * cosH;
  kit.prims.push({ s: 'ring', x, y, z, a: spec.ro, b: spec.len, c: spec.ro - spec.ri, yaw, pitch: spin, roll: -Math.PI / 2, col, seg: N });
  const rMid = ((spec.ro + spec.ri) / 2) * cosH, thick = (spec.ro - spec.ri) * cosH, width = 2 * spec.ro * sinH;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let k = 0; k < N; k++) {
    const phi = (2 * Math.PI * (k + 0.5)) / N + spin;
    // normal before yaw: (0, -sin phi, cos phi); Ry(yaw): x' = z sin(yaw), z' = z cos(yaw)
    const ny = -Math.sin(phi), nzl = Math.cos(phi);
    const nx = nzl * sy, nz = nzl * cy;
    kit.colBox(type, x + nx * rMid, y + ny * rMid, z + nz * rMid, spec.len / 2, thick / 2, width / 2, yaw, phi + Math.PI / 2, 0);
  }
  return { x, y, z, yaw, floorY: y - spec.ri * cosH, crownY: y + spec.ro * cosH };
}

/** Outer and inner facet planes of a placed pipe (for tests): facet k -> world unit normal and its offsets along it. */
export function pipeFacets(p: PipePlaced, spec: PipeSpec): { n: [number, number, number]; outer: number; inner: number }[] {
  const N = spec.seg, spin = pipeSpin(N), cosH = Math.cos(Math.PI / N);
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  const out: { n: [number, number, number]; outer: number; inner: number }[] = [];
  for (let k = 0; k < N; k++) {
    const phi = (2 * Math.PI * (k + 0.5)) / N + spin;
    const nzl = Math.cos(phi);
    out.push({ n: [nzl * sy, -Math.sin(phi), nzl * cy], outer: spec.ro * cosH, inner: spec.ri * cosH });
  }
  return out;
}
