// "Kart-O-Matic" vehicle terminal: a chunky vending-machine kiosk in team colors with a big glowing
// screen (status), a vending chute, a fat button, a steering-wheel sign on the roof and a painted pad on
// the lawn where the kart pops out. Kiosk space: +Y up, screen faces -Z, ground at y = 0.
// Draw calls: body (vertex-colored toon) + crease ink + screen (glow) + pad ring (toon) = 4.
import * as THREE from 'three/webgpu';
import { PALETTE } from '../style/style-tokens.js';
import { Team, type TeamId } from '../../shared/types';
import { PartBuilder, at, rbox, box, cyl, cone, torus } from './parts';
import { KART_PALETTES } from './kart-model';

export interface TerminalAssets {
  body: THREE.BufferGeometry;
  /** Unit screen quad anchored at its bottom edge (scale.y = fill). */
  screen: THREE.BufferGeometry;
  pad: THREE.BufferGeometry;
  triangles: number;
}

/** Screen placement in kiosk space (center x, bottom y, z) and size. */
export const SCREEN = { x: 0, y: 1.2, z: -0.497, w: 0.66, h: 0.48 };

const cache = new Map<number, TerminalAssets>();

export function terminalAssets(team: TeamId): TerminalAssets {
  const key = team === Team.Cats ? 1 : 0;
  let a = cache.get(key);
  if (a) return a;
  const P = KART_PALETTES[key];
  const b = new PartBuilder();
  // Cabinet on four stubby feet, cream front panel, trim stripes down the sides.
  b.add(rbox(1.16, 1.9, 0.84, 0.12), at(0, 1.07, 0), P.body);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cyl(0.07, 0.085, 0.14, 6), at(sx * 0.46, 0.07, sz * 0.3), P.dark);
  b.add(rbox(0.98, 1.56, 0.06, 0.03, 1), at(0, 1.07, -0.42), PALETTE.hullLight);
  for (const sx of [-1, 1]) b.add(box(0.03, 1.3, 0.5), at(sx * 0.585, 1.0, 0), P.trim);
  // Screen bezel (the glowing screen is a separate mesh in front of it).
  b.add(rbox(0.78, 0.62, 0.05, 0.03, 1), at(0, SCREEN.y + SCREEN.h / 2, -0.462), P.dark, true);
  // Big fat button + coin slot.
  b.add(cyl(0.1, 0.11, 0.07, 12), at(0.28, 0.93, -0.47, Math.PI / 2), P.trim, true);
  b.add(torus(0.115, 0.02, 4, 12), at(0.28, 0.93, -0.455), P.dark);
  b.add(box(0.16, 0.04, 0.03), at(-0.24, 0.95, -0.46), P.dark);
  b.add(box(0.2, 0.12, 0.02), at(-0.24, 0.8, -0.455), P.dark);
  // Vending chute with a swinging flap.
  b.add(rbox(0.72, 0.34, 0.08, 0.04, 1), at(0, 0.42, -0.44), P.dark, true);
  b.add(box(0.62, 0.24, 0.02), at(0, 0.44, -0.49, 0.12), P.metal);
  // Header sign with a trim band and a toy kart mascot on the roof.
  b.add(rbox(1.3, 0.32, 0.94, 0.1), at(0, 2.15, 0), P.trim);
  b.add(box(1.32, 0.07, 0.96), at(0, 2.15, 0), P.body);
  // Roof sign: a big upright steering wheel (reads "vehicles here" from across the yard).
  const sign = team === Team.Cats ? P.accent : P.trim;
  b.add(cyl(0.05, 0.06, 0.3, 6), at(0, 2.42, 0), P.dark);
  b.add(torus(0.36, 0.075, 5, 20), at(0, 2.9, 0), sign, true);
  b.add(cyl(0.11, 0.11, 0.1, 10), at(0, 2.9, 0, Math.PI / 2), P.dark, true);
  for (let i = 0; i < 3; i++) {
    const ang = Math.PI / 2 + (i / 3) * Math.PI * 2;
    b.add(box(0.07, 0.3, 0.06), at(Math.cos(ang) * 0.2, 2.9 + Math.sin(ang) * 0.2, 0, 0, 0, ang - Math.PI / 2), sign);
  }
  // Chevrons on the pad side pointing to where the kart appears.
  for (let i = 0; i < 2; i++) b.add(cone(0.12, 0.2, 3), at(0.6, 1.25 - i * 0.26, 0, Math.PI / 2, 0, -Math.PI / 2, 1, 1, 0.3), P.trim);
  const { geometry } = b.build();

  const screen = new THREE.PlaneGeometry(SCREEN.w, SCREEN.h);
  screen.translate(0, SCREEN.h / 2, 0);
  screen.rotateY(Math.PI); // face -Z

  const pb = new PartBuilder();
  pb.add(torus(1.15, 0.07, 3, 32), at(0, 0.03, 0, Math.PI / 2), P.trim);
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    pb.add(box(0.36, 0.02, 0.1), at(Math.cos(ang) * 0.8, 0.02, Math.sin(ang) * 0.8, 0, -ang), P.trim);
  }
  const pad = pb.build().geometry;
  a = { body: geometry, screen, pad, triangles: geometry.index!.count / 3 + 2 + pad.index!.count / 3 };
  cache.set(key, a);
  return a;
}

export function releaseTerminalAssets(): void {
  for (const a of cache.values()) { a.body.dispose(); a.screen.dispose(); a.pad.dispose(); }
  cache.clear();
}
