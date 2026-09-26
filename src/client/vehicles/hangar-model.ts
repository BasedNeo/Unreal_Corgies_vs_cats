// "Rooftop Hangar" (R1): the neutral Vehicle Terminal on The Rooftops that vends RC planes. A chunky cream and
// tennis-ball-yellow vending cabinet (neutral: both teams use it) with a big idle-spinning propeller sign on the
// roof, a striped windsock on a pole, the Kart-O-Matic's status screen, and painted runway markings on the roof
// (a paw pad under the plane, a dashed centerline down the take-off run, chevrons at the end).
// Kiosk space: +Y up, the screen faces -Z, ground at y = 0 (like terminal-model.ts).
// Draw calls: body (vertex-colored toon) + crease ink + screen (glow) + sign propeller + runway decals (no ink) = 5.
import * as THREE from 'three/webgpu';
import type { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { PALETTE } from '../style/style-tokens.js';
import { PartBuilder, at, rbox, box, cyl, cone, torus } from './parts';
import { SCREEN } from './terminal-model';

export interface HangarAssets {
  body: THREE.BufferGeometry;
  lines: LineSegmentsGeometry | null;
  screen: THREE.BufferGeometry;
  /** Sign propeller (spins about its local Z), placed at HANGAR_SIGN. */
  sign: THREE.BufferGeometry;
  triangles: number;
}

/** Sign propeller hub (kiosk space). */
export const HANGAR_SIGN = new THREE.Vector3(0, 2.72, -0.1);

const H = {
  body: PALETTE.hullLight, trim: PALETTE.tennisBall, dark: PALETTE.ink, band: PALETTE.accent, metal: PALETTE.concrete,
  sockA: PALETTE.glowOrange, sockB: PALETTE.catWhite,
};

let cached: HangarAssets | null = null;

export function hangarAssets(): HangarAssets {
  if (cached) return cached;
  const b = new PartBuilder();
  // Cabinet on stubby feet, a yellow front panel, orange side bands (neutral "airfield" colors).
  b.add(rbox(1.16, 1.9, 0.84, 0.12), at(0, 1.07, 0), H.body);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cyl(0.07, 0.085, 0.14, 6), at(sx * 0.46, 0.07, sz * 0.3), H.dark);
  b.add(rbox(0.98, 1.56, 0.06, 0.03, 1), at(0, 1.07, -0.42), H.trim);
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) b.add(box(0.03, 0.14, 0.7), at(sx * 0.585, 0.5 + i * 0.4, 0), i % 2 ? H.dark : H.band);
  // Screen bezel (the glowing screen is a separate mesh), a fat launch button and a coin slot.
  b.add(rbox(0.78, 0.62, 0.05, 0.03, 1), at(0, SCREEN.y + SCREEN.h / 2, -0.462), H.dark, true);
  b.add(cyl(0.11, 0.12, 0.07, 12), at(0.28, 0.93, -0.47, Math.PI / 2), H.band, true);
  b.add(torus(0.125, 0.02, 4, 12), at(0.28, 0.93, -0.455), H.dark);
  b.add(box(0.16, 0.04, 0.03), at(-0.24, 0.95, -0.46), H.dark);
  // A little toy plane silhouette on the front panel (reads "planes here" up close).
  b.add(box(0.36, 0.05, 0.02), at(0, 0.62, -0.46), H.dark);
  b.add(box(0.07, 0.24, 0.02), at(0, 0.64, -0.46), H.dark);
  b.add(box(0.16, 0.035, 0.02), at(0, 0.53, -0.46), H.dark);
  // Header with a checker band and the sign mast.
  b.add(rbox(1.3, 0.32, 0.94, 0.1), at(0, 2.15, 0), H.trim);
  for (let i = 0; i < 6; i++) b.add(box(0.2, 0.08, 0.96), at(-0.55 + i * 0.22, 2.15, 0), i % 2 ? H.dark : H.body);
  b.add(cyl(0.05, 0.06, 0.36, 6), at(0, 2.45, -0.1), H.dark);
  b.add(cyl(0.12, 0.12, 0.14, 10), at(HANGAR_SIGN.x, HANGAR_SIGN.y, HANGAR_SIGN.z + 0.08, Math.PI / 2), H.band, true);
  // Windsock on a pole at the kiosk's back corner: orange/white rings tapering downwind.
  b.add(cyl(0.03, 0.04, 2.6, 6), at(0.5, 1.3 + 1.0, 0.35), H.metal, true);
  b.add(torus(0.13, 0.02, 3, 10), at(0.5, 3.45, 0.35, 0, Math.PI / 2, 0), H.dark);
  for (let i = 0; i < 4; i++) {
    const r0 = 0.13 - i * 0.022, len = 0.2;
    b.add(cyl(r0 - 0.022, r0, len, 10), at(0.5 + 0.12 + i * len, 3.42 - i * 0.03, 0.35, 0, 0, Math.PI / 2 + 0.12), i % 2 ? H.sockB : H.sockA);
  }
  const { geometry, lines } = b.build();

  const screen = new THREE.PlaneGeometry(SCREEN.w, SCREEN.h);
  screen.translate(0, SCREEN.h / 2, 0);
  screen.rotateY(Math.PI);

  const sb = new PartBuilder();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    sb.add(rbox(0.13, 0.46, 0.03, 0.03, 1), at(Math.cos(a + Math.PI / 2) * 0.25, Math.sin(a + Math.PI / 2) * 0.25, 0, 0, 0, a), i === 0 ? H.band : H.dark);
  }
  sb.add(cone(0.09, 0.16, 8), at(0, 0, -0.08, -Math.PI / 2), H.trim);
  const sign = sb.build().geometry;
  cached = { body: geometry, lines, screen, sign, triangles: geometry.index!.count / 3 + 2 + sign.index!.count / 3 };
  return cached;
}

/**
 * Runway markings in PAD space (origin = the pad's ground point, the take-off heading = -Z): a paw pad under the
 * plane, a dashed centerline over `runway` m, and two chevrons at the end. 1 cm above the roof.
 */
export function runwayGeometry(runway: number): THREE.BufferGeometry {
  const b = new PartBuilder();
  const y = 0.012;
  b.add(torus(1.05, 0.06, 3, 28), at(0, y, 0, Math.PI / 2), PALETTE.tennisBall);
  // A paw print on the pad: a big pad and four toe beans.
  b.add(cyl(0.34, 0.34, 0.01, 16), at(0, y, 0.15), PALETTE.catWhite);
  for (let i = 0; i < 4; i++) b.add(cyl(0.12, 0.12, 0.01, 10), at(-0.33 + i * 0.22, y, -0.32 + Math.abs(i - 1.5) * 0.1), PALETTE.catWhite);
  for (let d = 2.2; d < runway - 1.5; d += 2) b.add(box(0.14, 0.01, 1.0), at(0, y, -d), PALETTE.catWhite);
  for (const k of [0, 1]) {
    for (const s of [-1, 1]) b.add(box(0.12, 0.01, 0.7), at(s * 0.24, y, -(runway - 1.2 - k * 0.6), 0, s * 0.6, 0), PALETTE.tennisBall);
  }
  return b.build().geometry;
}

export function releaseHangarAssets(): void {
  if (!cached) return;
  cached.body.dispose(); cached.lines?.dispose(); cached.screen.dispose(); cached.sign.dispose();
  cached = null;
}
