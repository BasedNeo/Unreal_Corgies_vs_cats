// Palette helpers: every character color is a PALETTE token or a mix of two tokens.
import * as THREE from 'three/webgpu';

const a = new THREE.Color(), b = new THREE.Color();

/** Mix two palette hex colors (linear-space lerp) → hex. */
export function mixHex(x: number, y: number, t: number): number {
  return a.setHex(x).lerp(b.setHex(y), t).getHex();
}

