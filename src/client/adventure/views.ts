// OWNER: adventure lane (A1). 3D adventure presentation:
//   · sentry cones   during a stealth step (no alarm yet) every cat shows its sight cone on the ground (drawn over the
//                    tall grass, depth test off, so a player sneaking in it can read them): an orange fan
//                    out to CONE_RANGE with a dashed inner arc at CONE_CLOSE (inside it even a still corgi in tall grass
//                    is seen); a cat that turns alerted flashes red. Gone once the alarm is up (everyone hunts).
//                    W11 F3 (P2-1): and a dashed far arc at the range the cat really spots a pet in the open, its
//                    archetype's sight × the weather's sight multiplier (archetypes.ts detectionRange, the brain's own
//                    number), across its field of view: 45 m for a grunt in clear weather, 27 m in a storm. The fan
//                    stays the grass-reach read it was built for (the Garden); the arc is the honest limit (The Lot).
//   · items          collect items (chapters.ts snapshot convention): a burlap catnip sack with a leafy tuft, bobbing
//                    over a glowing ground ring; the last tennis ball (A2: fuzzy yellow-green with its white seam);
//                    unknown kinds draw as a glowing bundle.
// Materials only via toon() / glow() / stylize(); every geometry here is owned and disposed by this module.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { releaseObject3D } from '../engine/release';
import type { EntityState } from '../../shared/protocol';
import { CLASS_IDS, EFlag, EntityKind, Team } from '../../shared/types';
import { archetypeForSnapshot, detectionRange } from '../../sim/ai/archetypes';
import { ADVENTURE_ITEM_IDS, ADVENTURE_ITEM_SEED } from '../../shared/content/chapters';
import { glow, stylize, toon } from '../style/style-webgpu.js';
import { PALETTE } from '../style/style-tokens.js';
import type { AdventureView } from './model';

/** Cone drawn for sentries (m): the reach of a sneaking corgi's cover, and the "too close even hidden" arc. */
export const CONE_RANGE = 14;
export const CONE_CLOSE = 5;
/** Half-angle of a cat's sight cone (the AI archetypes' 55°). */
export const CONE_HALF = (55 * Math.PI) / 180;

/** W11 F3: the far arc's band width at unit radius (0.54 m at a grunt's 45 m) and its dash count. */
const SIGHT_BAND = 0.012, SIGHT_DASHES = 15;

/** W11 F3: the radius (m) a sentry's far arc is drawn at, from its snapshot and the weather's sight multiplier. */
export function sentrySightRange(s: Pick<EntityState, 'cls' | 'maxHp'>, weatherSight: number): number {
  return detectionRange(archetypeForSnapshot(CLASS_IDS[s.cls], s.maxHp), weatherSight);
}

export interface AdventureViews {
  readonly group: THREE.Group;
  /** `weatherSight` (W11 F3): the weather's AI sight multiplier (WorldView.weather.sight; 1 when absent). */
  sync(states: ReadonlyMap<number, EntityState>, view: AdventureView | null, dt: number, weatherSight?: number): void;
  stats(): { cones: number; items: number };
  dispose(): void;
}

/** Flat sector band on the ground facing -Z (yaw 0), from angle -half..half, radii r0..r1. */
function band(r0: number, r1: number, half: number, segs: number, from = -half, to = half): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(r0, r1, segs, 1, Math.PI / 2 + from, to - from);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** The sentry cone outline: edges, the outer arc, a dashed inner arc and a faint middle arc. */
function coneGeometry(): THREE.BufferGeometry {
  // chunky bands: the camera sees them at a grazing angle from 10–20 m away
  const parts: THREE.BufferGeometry[] = [band(CONE_RANGE - 0.5, CONE_RANGE, CONE_HALF, 28), band(CONE_RANGE * 0.62 - 0.14, CONE_RANGE * 0.62 + 0.14, CONE_HALF, 20)];
  for (const s of [-1, 1]) {
    const e = new THREE.BoxGeometry(0.32, 0.02, CONE_RANGE - 0.8);
    e.translate(0, 0, -(CONE_RANGE - 0.8) / 2 - 0.6);
    e.rotateY(-s * CONE_HALF);
    parts.push(e);
  }
  const dashes = 9;
  for (let i = 0; i < dashes; i++) {
    const a0 = -CONE_HALF + (i / dashes) * 2 * CONE_HALF, a1 = a0 + (2 * CONE_HALF / dashes) * 0.55;
    parts.push(band(CONE_CLOSE - 0.2, CONE_CLOSE + 0.15, CONE_HALF, 4, a0, a1));
  }
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
  for (const p of parts) p.dispose();
  return merged;
}

/** W11 F3: the far arc at unit radius (scaled by the sight range): dashes on the outer edge across ±half. */
function sightArcGeometry(half: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < SIGHT_DASHES; i++) {
    const a0 = -half + (i / SIGHT_DASHES) * 2 * half, a1 = a0 + (2 * half / SIGHT_DASHES) * 0.6;
    parts.push(band(1 - SIGHT_BAND, 1, half, 4, a0, a1));
  }
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
  for (const p of parts) p.dispose();
  return merged;
}

interface ItemView { root: THREE.Group; body: THREE.Group; ring: THREE.Mesh; t: number }

export function createAdventureViews(scene: THREE.Scene): AdventureViews {
  const group = new THREE.Group();
  group.name = 'adventure';
  scene.add(group);
  const coneGeo = coneGeometry();
  // drawn over the tall grass they are about (a ground decal inside 2.4 m grass is invisible to the sneaking player):
  // the style's glow, as owned copies with the depth test off
  const overlay = (m: THREE.Material) => { const c = m.clone(); c.depthTest = false; c.depthWrite = false; return c; };
  const calm = overlay(glow(PALETTE.glowOrange, 1.05));
  const hot = overlay(glow(PALETTE.laserRed, 1.6));
  const cones = new Map<number, THREE.Mesh>();
  // W11 F3: the far arcs (one geometry per field of view; dimmer than the fan, red when alerted like it)
  const arcGeos = new Map<number, THREE.BufferGeometry>();
  const arcGeo = (half: number) => { let g = arcGeos.get(half); if (!g) { g = sightArcGeometry(half); arcGeos.set(half, g); } return g; };
  const calmFar = overlay(glow(PALETTE.glowOrange, 0.8));
  const hotFar = overlay(glow(PALETTE.laserRed, 1.3));
  // item parts (shared geometry)
  const sackGeo = new THREE.SphereGeometry(0.3, 14, 10);
  sackGeo.scale(1, 0.9, 1);
  const neckGeo = new THREE.CylinderGeometry(0.09, 0.15, 0.16, 10);
  neckGeo.translate(0, 0.3, 0);
  const twineGeo = new THREE.TorusGeometry(0.1, 0.028, 6, 14);
  twineGeo.rotateX(Math.PI / 2);
  twineGeo.translate(0, 0.33, 0);
  const leafGeo = new THREE.SphereGeometry(1, 8, 6);
  leafGeo.scale(0.05, 0.14, 0.03);
  const patchGeo = new THREE.BoxGeometry(0.2, 0.16, 0.04);
  const ringGeo = new THREE.RingGeometry(0.55, 0.72, 28);
  ringGeo.rotateX(-Math.PI / 2);
  const bundleGeo = new THREE.IcosahedronGeometry(0.28, 0);
  // A2: the last tennis ball (0.34 m: pet scale) and its seam, the classic two-lobe curve wrapped onto the ball
  const BALL_R = 0.34;
  const ballGeo = new THREE.SphereGeometry(BALL_R, 20, 14);
  const seamPts: THREE.Vector3[] = [];
  for (let i = 0; i < 48; i++) {
    const u = (i / 48) * Math.PI * 2;
    const v = new THREE.Vector3(0.7 * Math.cos(u) + 0.3 * Math.cos(3 * u), 0.7 * Math.sin(u) - 0.3 * Math.sin(3 * u), 0.9165 * Math.sin(2 * u));
    seamPts.push(v.setLength(BALL_R * 1.012));
  }
  const seamGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seamPts, true), 96, 0.022, 5, true);
  const items = new Map<number, ItemView>();

  const makeItem = (s: EntityState): ItemView => {
    const root = new THREE.Group();
    root.name = 'adventure_item';
    const body = new THREE.Group();
    const kind = ADVENTURE_ITEM_IDS[s.weapon] as string | undefined;
    if (kind === 'catnip') {
      body.add(new THREE.Mesh(sackGeo, toon({ color: 0xc9a26a })));
      body.add(new THREE.Mesh(neckGeo, toon({ color: 0xa9844f })));
      body.add(new THREE.Mesh(twineGeo, toon({ color: 0x7a4f2a })));
      const patch = new THREE.Mesh(patchGeo, toon({ color: 0x4fa83a }));
      patch.position.set(0, 0.02, 0.27);
      patch.rotation.x = -0.25;
      body.add(patch);
      for (let i = 0; i < 4; i++) {
        const leaf = new THREE.Mesh(leafGeo, toon({ color: i % 2 ? 0x5cbf3a : 0x3f8f2a }));
        const a = (i / 4) * Math.PI * 2;
        leaf.position.set(Math.cos(a) * 0.05, 0.47, Math.sin(a) * 0.05);
        leaf.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
        body.add(leaf);
      }
      stylize(body, { creases: false });
    } else if (kind === 'tennis_ball') {
      body.add(new THREE.Mesh(ballGeo, toon({ color: PALETTE.tennisBall })));
      body.add(new THREE.Mesh(seamGeo, toon({ color: PALETTE.catWhite })));
      body.rotation.z = 0.35;
      stylize(body, { creases: false });
    } else {
      body.add(new THREE.Mesh(bundleGeo, glow(PALETTE.accentHot, 1.8)));
    }
    const ring = new THREE.Mesh(ringGeo, glow(PALETTE.tennisBall, 1.35));
    ring.userData.noCameraCollide = true;
    root.add(body, ring);
    group.add(root);
    return { root, body, ring, t: s.yaw };
  };

  const seen = new Set<number>();
  return {
    group,
    sync(states, view, dt, weatherSight = 1) {
      seen.clear();
      // items
      for (const s of states.values()) {
        if (s.kind !== EntityKind.Prop || s.seed !== ADVENTURE_ITEM_SEED) continue;
        seen.add(s.id);
        let it = items.get(s.id);
        if (!it) { it = makeItem(s); items.set(s.id, it); }
        it.t += dt;
        it.root.position.set(s.x, s.y - 0.45, s.z);
        it.body.position.y = 0.45 + Math.sin(it.t * 2.2) * 0.08;
        it.body.rotation.y = it.t * 0.9;
        it.ring.position.y = 0.05;
        it.ring.scale.setScalar(1 + Math.sin(it.t * 3.1) * 0.08);
      }
      for (const [id, it] of items) if (!seen.has(id)) { it.root.removeFromParent(); releaseObject3D(it.root); items.delete(id); }
      // sentry cones
      const show = !!view?.sneaking;
      seen.clear();
      if (show) {
        for (const s of states.values()) {
          if (s.kind !== EntityKind.Bot || s.team !== Team.Cats || (s.flags & EFlag.Dead)) continue;
          seen.add(s.id);
          let m = cones.get(s.id);
          if (!m) {
            m = new THREE.Mesh(coneGeo, calm);
            m.name = 'sentry_cone';
            m.userData.noCameraCollide = true;
            m.castShadow = false; m.receiveShadow = false;
            m.renderOrder = 4;
            const far = new THREE.Mesh(arcGeo(archetypeForSnapshot(CLASS_IDS[s.cls], s.maxHp).fovHalf), calmFar);
            far.name = 'sentry_sight';
            far.userData.noCameraCollide = true;
            far.castShadow = false; far.receiveShadow = false;
            far.renderOrder = 4;
            m.add(far);
            group.add(m);
            cones.set(s.id, m);
          }
          m.position.set(s.x, s.y + 0.12, s.z);
          m.rotation.y = s.yaw;
          m.material = s.flags & EFlag.Alerted ? hot : calm;
          const far = m.children[0] as THREE.Mesh;
          const r = sentrySightRange(s, weatherSight);
          far.scale.set(r, 1, r);
          far.material = s.flags & EFlag.Alerted ? hotFar : calmFar;
        }
      }
      for (const [id, m] of cones) if (!seen.has(id)) { m.removeFromParent(); releaseObject3D(m); cones.delete(id); }
    },
    stats() { return { cones: cones.size, items: items.size }; },
    dispose() {
      group.removeFromParent();
      for (const g of [coneGeo, sackGeo, neckGeo, twineGeo, leafGeo, patchGeo, ringGeo, bundleGeo, ballGeo, seamGeo]) g.dispose();
      calm.dispose(); hot.dispose();
      for (const g of arcGeos.values()) g.dispose();
      calmFar.dispose(); hotFar.dispose(); arcGeos.clear();
      cones.clear(); items.clear();
    },
  };
}
