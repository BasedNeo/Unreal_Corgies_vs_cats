// OWNER: interaction lane (S1). Client views for the interaction layer, driven purely by EntityStates
// (presentation only — the sim decides everything):
//   createInteractViews(scene, { world?, camera? }) -> { group, sync(states, dt), onGameEvent(ev), dispose(), stats() }
// Draws: Ordnance Kiosks (EntityKind.Terminal with the ordnance index — V1's vehicle views draw the rest),
// Upgrade Cores and Golden Kibble (EntityKind.Pickup) and the objective beacon (EntityKind.Prop).
// Juice: kiosk screens cycle a highlight across the class tiles and flash + squash on a kit swap, the roof
// ball spins; cores spin in a gyroscope cage and bob, empty spots show a dim ghost of the next core growing
// with 12 countdown pips; kibble bob, spin and sparkle (one InstancedMesh for all kibble + one for sparkles);
// the beacon draws a light pillar + bobbing chevron, the Squeaker toy on its first step, and the hold ring
// with 24 progress pips that turns red while contested.
import * as THREE from 'three/webgpu';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import type { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { releaseObject3D } from '../engine/release';
import type { EntityState, GameEvent } from '../../shared/protocol';
import { EFlag, EntityKind, Team, type TeamId } from '../../shared/types';
import type { WorldData } from '../../shared/world/world-data';
import { surfaceAt } from '../../shared/world/queries';
import { terminalKindAt } from '../../shared/content/terminals';
import { PICKUPS, isCore, pickupByIndex, type PickupDef } from '../../shared/content/pickups';
import { objectiveChainByIndex } from '../../shared/content/objectives';
import { toon, glow } from '../style/style-webgpu.js';
import { PALETTE, STYLE } from '../style/style-tokens.js';
import { measureObject } from '../vehicles/parts';
import {
  kioskAssets, pickupAssets, KIOSK_SCREEN, KIOSK_TILES, KIOSK_BALL, TILE_W, TILE_H, type Built,
} from './models';
import { beaconStep } from './targets';

export interface InteractViewsOptions {
  /** World data: grounds core pedestals and ring markers on the real surface (recommended). */
  world?: WorldData;
  /** Render camera: sparkles/bobbing are skipped for far kibble (cheap culling). */
  camera?: THREE.Camera;
}

export interface InteractViews {
  readonly group: THREE.Group;
  sync(states: ReadonlyMap<number, EntityState>, dt: number): void;
  /** Feed game events (kit swaps bounce the kiosk, pickups pop). */
  onGameEvent(ev: GameEvent): void;
  dispose(): void;
  stats(): { kiosks: number; cores: number; kibble: number; beacon: boolean; triangles: number; drawCalls: number };
}

let inkMat: THREE.Line2NodeMaterial | null = null;
function ink(lines: LineSegmentsGeometry | null, parent: THREE.Object3D): void {
  if (!lines) return;
  inkMat ??= new THREE.Line2NodeMaterial({ color: PALETTE.ink, linewidth: STYLE.crease.widthPx, worldUnits: false });
  const l = new LineSegments2(lines, inkMat);
  l.userData.styleInk = true;
  parent.add(l);
}
const bodyMat = () => toon({ color: 0xffffff, vertexColors: true });
function builtMesh(b: Built, name: string): THREE.Mesh {
  const m = new THREE.Mesh(b.geometry, bodyMat());
  m.name = name;
  m.castShadow = true; m.receiveShadow = true;
  ink(b.lines, m);
  return m;
}
const colorOf = (d: PickupDef) => PALETTE[d.color] as number;
const TEAM_GLOW = (t: TeamId) => (t === Team.Cats ? PALETTE.laserRed : PALETTE.glowCyan);

// ------------------------------------------------------------------------------------------------ kiosk
class KioskView {
  readonly root = new THREE.Group();
  private body: THREE.Group = new THREE.Group();
  private tiles: THREE.Mesh;
  private hi: THREE.Mesh;
  private screen: THREE.Mesh;
  private ball: THREE.Mesh;
  private t: number;
  private bounce = 0;
  private flash = 0;
  constructor(s: EntityState, world: WorldData | undefined) {
    const a = kioskAssets(s.team as TeamId);
    this.t = s.id * 1.3;
    this.root.name = `ordnance_${s.id}`;
    this.root.add(this.body);
    this.body.add(builtMesh(a.body, 'kiosk_body'));
    // Screen: backing + six tiles + highlight tile + inked symbols, grouped on the tilted screen plane.
    const S = KIOSK_SCREEN;
    const panel = new THREE.Group();
    panel.position.set(S.x, S.y, S.z);
    panel.rotation.x = -S.tilt;
    this.screen = new THREE.Mesh(a.screen, glow(0x1d4c63, 1.0));
    this.screen.userData.noCameraCollide = true;
    // All six tiles in one merged glow geometry (one draw).
    const tg: THREE.BufferGeometry[] = KIOSK_TILES.map((t) => a.tile.clone().translate(t.x, t.y, -0.004));
    this.tiles = new THREE.Mesh(mergeTiles(tg), glow(TEAM_GLOW(s.team as TeamId), 1.25));
    this.hi = new THREE.Mesh(a.tile, glow(PALETTE.tennisBall, 2.6));
    this.hi.scale.set(1.08, 1.1, 1);
    const icons = new THREE.Mesh(a.icons, bodyMat());
    icons.position.z = -0.006;
    panel.add(this.screen, this.tiles, this.hi, icons);
    this.body.add(panel);
    this.ball = builtMesh(a.ball, 'kiosk_ball');
    this.ball.position.set(KIOSK_BALL.x, KIOSK_BALL.y, KIOSK_BALL.z);
    this.body.add(this.ball);
    const pad = new THREE.Mesh(a.pad, bodyMat());
    pad.receiveShadow = true;
    pad.userData.noCameraCollide = true;
    // "Stand here" ring in front of the screen, on the real ground.
    const fx = -Math.sin(s.yaw) * 1.55, fz = -Math.cos(s.yaw) * 1.55;
    const gy = world ? surfaceAt(world, s.x + fx, s.z + fz, s.y + 1).y : s.y;
    pad.position.set(0, gy - s.y, -1.55);
    this.root.add(pad);
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
  }

  vend(): void { this.bounce = 1; this.flash = 1; }

  update(s: EntityState, dt: number): void {
    this.t += dt;
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
    // Highlight hops across the six tiles (a "choose me" attract loop); a swap flashes the whole screen.
    const k = Math.floor(this.t * 1.6) % KIOSK_TILES.length;
    const tile = KIOSK_TILES[k];
    this.hi.position.set(tile.x, tile.y, -0.008);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    const f = this.flash;
    this.hi.scale.set(1.08 + f * 2.2, 1.1 + f * 1.5, 1);
    this.hi.position.x = tile.x * (1 - f);
    this.hi.position.y = tile.y * (1 - f);
    // Vend squash & stretch.
    this.bounce = Math.max(0, this.bounce - dt * 3);
    const b = Math.sin(this.bounce * Math.PI) * this.bounce;
    this.body.scale.set(1 + b * 0.08, 1 - b * 0.1, 1 + b * 0.08);
    this.ball.rotation.y += dt * (1.2 + f * 12);
    this.ball.position.y = KIOSK_BALL.y + Math.abs(Math.sin(this.t * 2.2)) * 0.06 + b * 0.5;
  }

  dispose(): void {
    this.root.removeFromParent();
    releaseObject3D(this.root);
    this.tiles.geometry.dispose();
  }
}

function mergeTiles(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (const g of list) {
    const p = g.getAttribute('position');
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

// ------------------------------------------------------------------------------------------------ cores
const PIPS = 12;
class CoreView {
  readonly root = new THREE.Group();
  private spin = new THREE.Group();
  private crystal: THREE.Mesh;
  private ghost: THREE.Mesh;
  private rings: THREE.Mesh[] = [];
  private halo: THREE.Mesh;
  private pips: THREE.InstancedMesh;
  private groundY = 0;
  private t: number;
  private shown = true;
  private pop = 0;
  private def: PickupDef = PICKUPS.overclock;
  constructor(s: EntityState, world: WorldData | undefined) {
    const a = pickupAssets();
    this.root.name = `core_${s.id}`;
    this.t = s.seed * 1.7;
    const ped = builtMesh(a.pedestal, 'core_pedestal');
    this.root.add(ped);
    this.crystal = new THREE.Mesh(a.crystal, glow(PALETTE.glowOrange, 1.6));
    this.ghost = new THREE.Mesh(a.crystal, glow(PALETTE.glowOrange, 0.55));
    for (let i = 0; i < 2; i++) { const r = builtMesh(a.ring, `core_ring${i}`); this.rings.push(r); this.spin.add(r); }
    this.spin.add(this.crystal);
    this.root.add(this.spin, this.ghost);
    this.halo = new THREE.Mesh(a.halo, glow(PALETTE.glowOrange, 1.6));
    this.halo.scale.setScalar(0.85);
    this.halo.position.y = 0.03;
    this.root.add(this.halo);
    this.pips = new THREE.InstancedMesh(a.pip, glow(PALETTE.accentHot, 2.0), PIPS);
    this.pips.frustumCulled = false;
    this.root.add(this.pips);
    this.place(s, world);
    this.setDef(pickupByIndex(s.cls) ?? PICKUPS.overclock);
  }

  private place(s: EntityState, world: WorldData | undefined): void {
    this.groundY = world ? surfaceAt(world, s.x, s.z, s.y - 0.2).y : s.y - 0.75;
    this.root.position.set(s.x, this.groundY, s.z);
  }

  private setDef(d: PickupDef): void {
    if (this.crystal.userData.id === d.id) return;
    this.def = d;
    const c = colorOf(d);
    this.crystal.material = glow(c, 1.6);
    this.crystal.userData.id = d.id;
    this.ghost.material = glow(c, 0.5);
    this.halo.material = glow(c, 1.15);
  }

  collected(): void { this.pop = 1; }

  update(s: EntityState, dt: number): void {
    this.t += dt;
    const d = pickupByIndex(s.cls);
    if (d) this.setDef(d);
    const avail = (s.flags & EFlag.Busy) === 0;
    const hover = s.y - this.groundY;
    if (avail !== this.shown) { this.shown = avail; if (avail) this.pop = 0; }
    this.spin.visible = avail || this.pop > 0;
    this.halo.visible = avail;
    this.ghost.visible = !avail && s.maxHp > 0;
    // Spin, tumble and bob; a pickup pops the core up and away.
    this.pop = Math.max(0, this.pop - dt * 3);
    const bob = Math.sin(this.t * 2.4) * 0.08;
    this.spin.position.y = hover + bob + (this.pop > 0 ? (1 - this.pop) * 1.4 : 0);
    const sc = this.pop > 0 ? this.pop : 1;
    this.spin.scale.setScalar(sc);
    this.crystal.rotation.y += dt * 2.2;
    this.rings[0].rotation.set(this.t * 1.3, this.t * 0.7, 0);
    this.rings[1].rotation.set(0, this.t * 1.1 + 1.2, this.t * 1.7);
    this.halo.scale.setScalar(0.85 + Math.sin(this.t * 3) * 0.06);
    // Empty spot: a dim ghost of the next core grows as the refill completes; pips count it down.
    const prog = s.maxHp > 0 ? Math.min(1, s.hp / s.maxHp) : 0;
    this.ghost.position.y = hover + bob * 0.5;
    this.ghost.scale.setScalar(0.35 + 0.45 * prog);
    this.ghost.rotation.y += dt * (0.6 + prog * 3);
    const lit = avail ? PIPS : Math.floor(prog * PIPS);
    const m = new THREE.Matrix4();
    for (let i = 0; i < lit; i++) {
      const a = (i / PIPS) * Math.PI * 2;
      m.makeRotationY(-a);
      m.setPosition(Math.cos(a) * 0.63, 0.13, Math.sin(a) * 0.63);
      this.pips.setMatrixAt(i, m);
    }
    this.pips.count = lit;
    this.pips.instanceMatrix.needsUpdate = true;
  }

  dispose(): void { this.root.removeFromParent(); releaseObject3D(this.root); this.pips.dispose(); }
}

// ------------------------------------------------------------------------------------------------ kibble
const KIBBLE_MAX = 64;
const SPARKS = 2;
class KibbleField {
  readonly body: THREE.InstancedMesh;
  readonly sparks: THREE.InstancedMesh;
  private t = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private pops = new Map<number, number>();
  constructor() {
    const a = pickupAssets();
    this.body = new THREE.InstancedMesh(a.kibble, toon({ color: 0xffffff, vertexColors: true, emissive: 0x6a3f00, emissiveIntensity: 0.55 }), KIBBLE_MAX);
    this.body.name = 'kibble';
    this.body.castShadow = true;
    this.body.frustumCulled = false;
    this.body.count = 0;
    this.sparks = new THREE.InstancedMesh(a.sparkle, glow(0xfff1b0, 2.8), KIBBLE_MAX * SPARKS);
    this.sparks.name = 'kibble_sparks';
    this.sparks.frustumCulled = false;
    this.sparks.count = 0;
  }

  collected(id: number): void { this.pops.set(id, 1); }

  update(list: EntityState[], dt: number, cam: THREE.Vector3 | null): void {
    this.t += dt;
    let n = 0, k = 0;
    for (const [id, p] of this.pops) { const v = p - dt * 2.5; if (v <= 0) this.pops.delete(id); else this.pops.set(id, v); }
    for (const s of list) {
      if (n >= KIBBLE_MAX) break;
      const pop = this.pops.get(s.id) ?? 0;
      const avail = (s.flags & EFlag.Busy) === 0;
      if (!avail && pop <= 0) continue;
      const ph = s.seed * 1.37;
      const up = pop > 0 ? (1 - pop) * 1.6 : 0;
      const scale = pop > 0 ? pop * 1.3 : 1;
      this.v.set(s.x, s.y + Math.sin(this.t * 2.6 + ph) * 0.09 + up, s.z);
      this.e.set(0.25 * Math.sin(this.t * 1.3 + ph), this.t * 1.6 + ph, 0.18);
      this.q.setFromEuler(this.e);
      this.s.setScalar(scale);
      this.body.setMatrixAt(n++, this.m.compose(this.v, this.q, this.s));
      if (cam && Math.hypot(s.x - cam.x, s.z - cam.z) > 45) continue;
      for (let j = 0; j < SPARKS; j++) {
        const a = this.t * (1.3 + j * 0.4) + ph + j * Math.PI;
        const tw = 0.55 + 0.45 * Math.sin(this.t * 7 + ph * 3 + j * 2);
        this.v.set(s.x + Math.cos(a) * 0.42, s.y + 0.18 + Math.sin(this.t * 3 + j) * 0.15 + up, s.z + Math.sin(a) * 0.42);
        this.e.set(0, 0, this.t * 2 + j);
        this.q.setFromEuler(this.e);
        this.s.setScalar(tw * (pop > 0 ? pop : 1));
        this.sparks.setMatrixAt(k++, this.m.compose(this.v, this.q, this.s));
      }
    }
    this.body.count = n;
    this.sparks.count = k;
    this.body.instanceMatrix.needsUpdate = true;
    this.sparks.instanceMatrix.needsUpdate = true;
  }

  get visible(): number { return this.body.count; }

  dispose(): void { this.body.dispose(); this.sparks.dispose(); }
}

// ------------------------------------------------------------------------------------------------ beacon
const HOLD_PIPS = 24;
class BeaconView {
  readonly root = new THREE.Group();
  private pillar: THREE.Mesh;
  private chevron: THREE.Mesh;
  private squeaker: THREE.Mesh;
  private ring: THREE.Mesh;
  private pips: THREE.InstancedMesh;
  private t = 0;
  constructor(private world: WorldData | undefined) {
    const a = pickupAssets();
    this.root.name = 'objective_beacon';
    this.pillar = new THREE.Mesh(a.pillar, glow(PALETTE.accentHot, 1.1));
    this.pillar.scale.set(0.7, 16, 0.7);
    this.chevron = new THREE.Mesh(a.chevron, glow(PALETTE.accentHot, 2.6));
    this.squeaker = builtMesh(a.squeaker, 'squeaker');
    this.ring = new THREE.Mesh(a.halo, glow(PALETTE.glowCyan, 1.6));
    this.pips = new THREE.InstancedMesh(a.pip, glow(PALETTE.accentHot, 2.4), HOLD_PIPS);
    this.pips.frustumCulled = false;
    for (const o of [this.pillar, this.chevron, this.ring]) o.userData.noCameraCollide = true;
    this.root.add(this.pillar, this.chevron, this.squeaker, this.ring, this.pips);
  }

  update(s: EntityState, dt: number): boolean {
    this.t += dt;
    const b = beaconStep(s);
    this.root.visible = !!b;
    if (!b) return false;
    const step = b.chain.steps[b.index];
    const t = step.trigger;
    const top = this.world ? surfaceAt(this.world, s.x, s.z).y : s.y;
    this.root.position.set(s.x, s.y, s.z);
    const hold = t.type === 'hold';
    const contested = (s.flags & EFlag.Busy) !== 0;
    const item = step.id === 'grab_squeaker';
    const base = top - s.y;
    // The pillar starts above the chevron so it never hides the item or the target.
    this.pillar.visible = !hold;
    this.pillar.position.y = base + 3.9;
    this.chevron.position.set(0, base + 3.2 + Math.sin(this.t * 3) * 0.25, 0);
    this.chevron.rotation.y += dt * 1.5;
    this.squeaker.visible = item;
    this.squeaker.position.set(0, 1.0 + Math.sin(this.t * 2.2) * 0.12, 0);
    this.squeaker.rotation.set(0.25, this.t * 1.4, Math.sin(this.t * 3) * 0.2);
    // A squeeze-and-release "squeak" pulse every 1.6 s.
    const sq = Math.max(0, Math.sin(this.t * 3.9)) ** 8;
    this.squeaker.scale.set(1.7 + sq * 0.25, 1.7 - sq * 0.35, 1.7);
    // Ring: the trigger radius on the ground (the trampoline's rim for the hold), pips = hold progress.
    const r = t.params.radius;
    this.ring.position.y = 0.06; // beacon y = the terrain under the target: the ring lies on the lawn
    this.ring.scale.setScalar(r);
    this.ring.material = glow(contested ? PALETTE.laserRed : hold ? PALETTE.accentHot : PALETTE.glowCyan, contested ? 2.2 + Math.sin(this.t * 14) * 0.6 : 1.5);
    const lit = hold ? Math.round((s.ammo / 100) * HOLD_PIPS) : 0;
    const m = new THREE.Matrix4();
    for (let i = 0; i < lit; i++) {
      const a = (i / HOLD_PIPS) * Math.PI * 2 - Math.PI / 2;
      m.makeRotationY(-a);
      m.scale(new THREE.Vector3(2.2, 2.2, 2.2));
      m.setPosition(Math.cos(a) * (r - 0.35), this.ring.position.y + 0.05, Math.sin(a) * (r - 0.35));
      this.pips.setMatrixAt(i, m);
    }
    this.pips.count = lit;
    this.pips.instanceMatrix.needsUpdate = true;
    return true;
  }

  dispose(): void { this.root.removeFromParent(); releaseObject3D(this.root); this.pips.dispose(); }
}

// ------------------------------------------------------------------------------------------------ factory
export function createInteractViews(scene: THREE.Scene, opts: InteractViewsOptions = {}): InteractViews {
  const group = new THREE.Group();
  group.name = 'interact';
  scene.add(group);
  const kiosks = new Map<number, KioskView>();
  const cores = new Map<number, CoreView>();
  const kibble = new KibbleField();
  group.add(kibble.body, kibble.sparks);
  let beacon: BeaconView | null = null;
  let beaconOn = false;
  let last: ReadonlyMap<number, EntityState> | null = null;
  const kibbleList: EntityState[] = [];
  const camPos = new THREE.Vector3();

  return {
    group,
    sync(states, dt) {
      for (const [id, v] of kiosks) if (!states.has(id)) { v.dispose(); kiosks.delete(id); }
      for (const [id, v] of cores) if (!states.has(id)) { v.dispose(); cores.delete(id); }
      kibbleList.length = 0;
      let sawBeacon = false;
      for (const [id, s] of states) {
        if (s.kind === EntityKind.Terminal) {
          if (terminalKindAt(s.cls) !== 'ordnance') continue;
          let v = kiosks.get(id);
          if (!v) { v = new KioskView(s, opts.world); kiosks.set(id, v); group.add(v.root); }
          v.update(s, dt);
        } else if (s.kind === EntityKind.Pickup) {
          const d = pickupByIndex(s.cls);
          if (!d) continue;
          if (d.kind === 'collectible') { kibbleList.push(s); continue; }
          let v = cores.get(id);
          if (!v) { v = new CoreView(s, opts.world); cores.set(id, v); group.add(v.root); }
          v.update(s, dt);
        } else if (s.kind === EntityKind.Prop && objectiveChainByIndex(s.cls)) {
          if (!beacon) { beacon = new BeaconView(opts.world); group.add(beacon.root); }
          beaconOn = beacon.update(s, dt);
          sawBeacon = true;
        }
      }
      last = states;
      if (!sawBeacon && beacon) { beacon.root.visible = false; beaconOn = false; }
      const cam = opts.camera ? opts.camera.getWorldPosition(camPos) : null;
      kibble.update(kibbleList, dt, cam);
    },
    onGameEvent(ev) {
      if (ev.e === 'ability' && ev.ability === 'kit_swap') kiosks.get(ev.id)?.vend();
      else if (ev.e === 'pickup' && last) {
        // The event names the collector: pop the nearest pickup of that kind next to it.
        const c = last.get(ev.id);
        const core = isCore(ev.item);
        if (!c || (!core && ev.item !== 'golden_kibble')) return;
        let best: EntityState | null = null, bd = 3;
        for (const s of last.values()) {
          if (s.kind !== EntityKind.Pickup || (pickupByIndex(s.cls)?.kind === 'core') !== core) continue;
          const d = Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z);
          if (d < bd) { bd = d; best = s; }
        }
        if (!best) return;
        if (core) cores.get(best.id)?.collected();
        else kibble.collected(best.id);
      }
    },
    dispose() {
      for (const v of kiosks.values()) v.dispose();
      for (const v of cores.values()) v.dispose();
      kiosks.clear(); cores.clear();
      beacon?.dispose();
      kibble.dispose();
      group.removeFromParent();
    },
    stats() {
      const m = measureObject(group);
      return { kiosks: kiosks.size, cores: cores.size, kibble: kibble.visible, beacon: beaconOn, triangles: m.triangles, drawCalls: m.drawCalls };
    },
  };
}

