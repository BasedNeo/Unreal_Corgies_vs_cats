// OWNER: character lane. Procedural corgi + cat characters (body plan, skeleton, face, animation).
// Walking-skeleton placeholder: a toon capsule with ears so species/team read at a glance.
import * as THREE from 'three/webgpu';
import type { Avatar, AvatarFrame, AvatarOptions } from '../../views/avatar';
import { toon, stylize } from '../../style/style-webgpu.js';
import { PALETTE } from '../../style/style-tokens.js';
import { Species, Team } from '../../../shared/types';

export function createAvatar(o: AvatarOptions): Avatar {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const isCat = o.species === Species.Cat;
  const fur = isCat ? PALETTE.catGrey : PALETTE.corgiOrange;
  const team = o.team === Team.Cats ? PALETTE.teamCats : PALETTE.teamCorgis;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.45, 6, 12), toon({ color: team }));
  torso.position.y = 0.6;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), toon({ color: fur }));
  head.position.set(0, 1.12, -0.05);
  const earGeo = new THREE.ConeGeometry(isCat ? 0.1 : 0.13, isCat ? 0.22 : 0.3, 8);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, toon({ color: fur }));
    ear.position.set(0.16 * s, 1.4, -0.02);
    ear.rotation.z = -0.25 * s;
    body.add(ear);
  }
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), toon({ color: isCat ? PALETTE.catWhite : PALETTE.corgiCream }));
  snout.position.set(0, 1.06, -0.3);
  snout.scale.set(1, 0.8, 1.2);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.6), toon({ color: PALETTE.hullDark }));
  gun.position.set(0.3, 0.75, -0.35);
  body.add(torso, head, snout, gun);
  stylize(root, { creases: false });
  root.traverse((m) => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.3, 0.75, -0.7);
  body.add(muzzle);
  let t = 0, bob = 0, squash = 0;
  return {
    root,
    height: 1.5,
    update(f: AvatarFrame, dt: number) {
      t += dt;
      const run = Math.min(1, f.speed / 7);
      bob = f.grounded ? Math.abs(Math.sin(t * (8 + run * 8))) * 0.08 * run : 0;
      squash = Math.max(0, squash - dt * 4);
      body.position.y = bob;
      body.scale.set(1 + squash * 0.25, 1 - squash * 0.3, 1 + squash * 0.25);
      body.rotation.x = f.dead ? -1.4 : f.grounded ? run * 0.12 : -0.1;
      gun.rotation.x = f.aimPitch;
    },
    trigger(action: string, s = 1) {
      if (action === 'land') squash = Math.min(1, 0.3 + s * 0.05);
      if (action === 'jump') squash = 0.2;
    },
    muzzleWorld(target) { return muzzle.getWorldPosition(target); },
    dispose() { root.traverse((m) => (m as THREE.Mesh).geometry?.dispose()); },
  };
}
