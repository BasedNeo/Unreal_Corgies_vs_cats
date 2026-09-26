// OWNER: interaction lane (S1). Client side of Ordnance Terminals, Upgrade Cores, Golden Kibble and the
// objective chain (presentation only). Wiring for main.ts: docs/handoff/S1.md.
//   createInteractViews(scene, { world, camera })  -> 3D kiosks, cores, kibble, objective beacon
//   createInteractPrompts(uiRoot, { send, sound }) -> prompts, kit picker, buff chips, mission card
export { createInteractViews, type InteractViews, type InteractViewsOptions } from './views';
export { createInteractPrompts, type InteractPrompts, type InteractPromptsOptions } from './prompts';
export { findInteractTarget, atOwnOrdnanceKiosk, beaconStep, BuffTracker, type InteractTarget, type InteractKind, type TrackedBuff } from './targets';
export { kioskAssets, pickupAssets, releaseInteractAssets } from './models';
