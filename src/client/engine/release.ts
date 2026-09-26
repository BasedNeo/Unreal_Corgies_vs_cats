// Dropping a subtree from the scene: free the renderer's per-object state without touching shared resources.
// three's RenderObject subscribes to the 'dispose' event of its object, its material and its geometry. An object that
// is only removed from the scene stays referenced from the listener lists of any geometry or material it shares with
// other objects (cached kit meshes, team materials, ink), together with its render objects and their uniform buffers,
// for the life of the page: TDM leaked ~6 ability drones a minute this way (+188 WebGL buffers in 5 minutes).
import type * as THREE from 'three/webgpu';

/** Tell the renderer every object under `root` is gone (its geometry and materials stay usable by others). */
export function releaseObject3D(root: THREE.Object3D): void {
  root.traverse((o) => (o as unknown as { dispatchEvent(e: { type: string }): void }).dispatchEvent({ type: 'dispose' }));
}
