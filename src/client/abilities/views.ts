// C2 (combat-2). Client views for the ability entities, driven purely by EntityStates (presentation only — the sim
// decides everything; snapshot convention in src/sim/combat/ability-core.ts):
//   createAbilityViews(scene, { camera? }) -> { group, sync(states, localTeam, dt), onGameEvent(ev), dispose(), stats() }
// Draws (EntityKind.Ability with an ABILITY_IDS cls):
//   Spotter Drone   hovers, spins, leans into its flight; lens eye + a pulsing scan ring (glow) while on station.
//                   Shot down: tumbles and drops; expiry: zips up and away.
//   Dig Charge      allies: the full bomb, the trigger-radius ring and an armed blink. Enemies: only the top of the
//                   bomb pokes out of the mound and the blink is dim ("faintly visible"). Defused: pops.
//   Squeak Barrier  pops up out of the ground with an overshoot, squashes + flashes on hits, wobbles more as it
//                   weakens; expiry: sinks back into the ground; destroyed: bursts flat.
//   Spotted cue     a floating diamond-reticle marker over every enemy the local team's drones spot (EFlag.Spotted),
//                   drawn through walls (depthTest off), one InstancedMesh for all.
// Cost: drone 4 draws, charge 3–4, barrier 2, markers 1 (all of them). Geometry is built once per team and shared.
import * as THREE from 'three/webgpu';
import { releaseObject3D } from '../engine/release';
import type { EntityState, GameEvent } from '../../shared/protocol';
import { EFlag, EntityKind, Species, Team, type TeamId } from '../../shared/types';
import { ABILITIES, ABILITY_IDS, type AbilityKind } from '../../shared/content/abilities';
import { toon, glow } from '../style/style-webgpu.js';
import { PALETTE } from '../style/style-tokens.js';
import { measureObject } from '../vehicles/parts';
import { ABILITY_ENTITY_KIND, BARRIER } from '../../sim/combat/ability-tuning';
import { buildBarrier, buildCharge, buildDrone, chargeLight, chargeRing, droneLens, droneRing, spottedMarker, type Built } from './models';

export interface AbilityViewsOptions {
  /** Render camera: billboards the spotted markers (recommended). */
  camera?: THREE.Camera;
}

export interface AbilityViewStats { drones: number; charges: number; barriers: number; spotted: number; drawCalls: number; triangles: number }

export interface AbilityViews {
  readonly group: THREE.Group;
  /** `localTeam` decides who sees charges faintly and whose spotted enemies get markers (-1 = spectator: none). */
  sync(states: ReadonlyMap<number, EntityState>, localTeam: TeamId | -1, dt: number): void;
  /** Hits flash/squash the entity; `<id>:down` plays the destroyed animation. */
  onGameEvent(ev: GameEvent): void;
  dispose(): void;
  stats(): AbilityViewStats;
}

const TEAM_GLOW = (t: TeamId) => (t === Team.Cats ? PALETTE.laserRed : PALETTE.glowCyan);
const BODY = () => toon({ color: 0xffffff, vertexColors: true });
const FLASH = () => toon({ color: 0xffffff, vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.5 });
const MAX_MARKERS = 48;
const FLASH_TIME = 0.09;

/** Ability kind of an EntityState, or null when it is not an ability entity (e.g. the objective beacon). */
export function abilityKindOf(s: EntityState): AbilityKind | null {
  if (s.kind !== ABILITY_ENTITY_KIND) return null;
  const id = ABILITY_IDS[s.cls];
  const k = id ? ABILITIES[id].kind : null;
  return k === 'drone' || k === 'charge' || k === 'barrier' ? k : null;
}

interface TeamAssets { drone: Built; charge: Built; barrier: Built }

abstract class AbilityView {
  readonly root = new THREE.Group();
  protected t = 0;
  protected flash = 0;
  /** Seconds since the entity left the snapshot (-1 = alive). */
  gone = -1;
  wasDown = false;
  constructor(readonly id: number, readonly team: TeamId, protected body: THREE.Mesh) {
    this.root.name = `ability_${id}`;
    this.root.add(body);
  }
  hit(): void { this.flash = FLASH_TIME; }
  protected tickFlash(dt: number): void {
    if (this.flash > 0) { this.flash -= dt; this.body.material = this.flash > 0 ? FLASH() : BODY(); }
  }
  abstract update(s: EntityState, enemy: boolean, dt: number): void;
  /** Animate the exit; true when finished. */
  abstract exit(dt: number): boolean;
}

function bodyMesh(b: Built, name: string): THREE.Mesh {
  const m = new THREE.Mesh(b.geometry, BODY());
  m.name = name;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

class DroneView extends AbilityView {
  private ring: THREE.Mesh;
  private vy = 0;
  constructor(id: number, team: TeamId, body: THREE.Mesh, lens: THREE.BufferGeometry, ring: THREE.BufferGeometry) {
    super(id, team, body);
    this.body.add(new THREE.Mesh(lens, glow(TEAM_GLOW(team), 2.2)));
    this.ring = new THREE.Mesh(ring, glow(TEAM_GLOW(team), 1.3));
    this.ring.userData.noCameraCollide = true;
    this.root.add(this.ring);
  }
  update(s: EntityState, _enemy: boolean, dt: number): void {
    this.t += dt;
    this.tickFlash(dt);
    this.root.position.set(s.x, s.y, s.z);
    this.body.rotation.y = s.yaw;
    // lean into the flight (world-space velocity -> small pitch/roll), plus a hover wobble
    this.root.rotation.x = Math.max(-0.4, Math.min(0.4, s.vz * 0.08)) + Math.sin(this.t * 2.3) * 0.04;
    this.root.rotation.z = Math.max(-0.4, Math.min(0.4, -s.vx * 0.08)) + Math.sin(this.t * 1.7) * 0.04;
    const onStation = (s.flags & EFlag.Busy) === 0;
    this.ring.visible = onStation;
    const k = 1 + 0.18 * Math.sin(this.t * 6) + (s.weapon > 0 ? 0.25 : 0);
    this.ring.scale.set(k, 1, k);
    const sc = this.flash > 0 ? 1.12 : 1;
    this.body.scale.setScalar(sc);
  }
  exit(dt: number): boolean {
    this.gone += dt;
    this.ring.visible = false;
    if (this.wasDown) {
      // tumble and drop
      this.vy -= 18 * dt;
      this.root.position.y += this.vy * dt;
      this.body.rotation.x += 9 * dt; this.body.rotation.z += 6 * dt;
      this.body.scale.setScalar(Math.max(0.01, 1 - this.gone * 1.2));
      return this.gone > 0.7;
    }
    // zip up and away
    this.root.position.y += 6 * dt;
    this.body.rotation.y += 12 * dt;
    this.body.scale.setScalar(Math.max(0.01, 1 - this.gone * 2.5));
    return this.gone > 0.4;
  }
}

class ChargeView extends AbilityView {
  private light: THREE.Mesh;
  private ring: THREE.Mesh;
  private enemy = false;
  private readonly mats: { armed: THREE.Material; idle: THREE.Material; faint: THREE.Material };
  constructor(id: number, team: TeamId, body: THREE.Mesh, light: THREE.BufferGeometry, ring: THREE.BufferGeometry) {
    super(id, team, body);
    this.mats = { armed: glow(PALETTE.laserRed, 2.6), idle: glow(TEAM_GLOW(team), 1.2), faint: glow(TEAM_GLOW(team), 0.6) };
    this.light = new THREE.Mesh(light, this.mats.idle);
    this.ring = new THREE.Mesh(ring, glow(TEAM_GLOW(team), 0.9));
    this.ring.userData.noCameraCollide = true;
    this.body.add(this.light);
    this.root.add(this.ring);
    this.body.castShadow = false;
  }
  update(s: EntityState, enemy: boolean, dt: number): void {
    this.t += dt;
    this.tickFlash(dt);
    this.enemy = enemy;
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
    const armed = (s.flags & EFlag.Busy) !== 0;
    // enemies see only the top of the bomb in its mound, and a dim blink
    this.body.position.y = enemy ? -0.2 : 0;
    this.ring.visible = !enemy;
    const blink = armed ? (Math.sin(this.t * Math.PI * 5) > 0.2) : true;
    this.light.visible = enemy ? armed && Math.sin(this.t * Math.PI * 1.2) > 0.85 : blink;
    this.light.material = enemy ? this.mats.faint : armed ? this.mats.armed : this.mats.idle;
    const k = armed ? 1 : 0.85 + 0.15 * Math.min(1, this.t);
    this.ring.scale.set(k, 1, k);
  }
  exit(dt: number): boolean {
    this.gone += dt;
    if (!this.wasDown) return true; // detonated: the explosion FX covers it
    this.ring.visible = false;
    this.light.visible = false;
    const k = this.gone < 0.08 ? 1 + this.gone * 4 : Math.max(0.01, 1.3 - (this.gone - 0.08) * 6);
    this.body.scale.setScalar(k);
    return this.gone > 0.3 || this.enemy && this.gone > 0.2;
  }
}

class BarrierView extends AbilityView {
  private hpFrac = 1;
  private squash = 0;
  constructor(id: number, team: TeamId, body: THREE.Mesh) {
    super(id, team, body);
  }
  override hit(): void { super.hit(); this.squash = 1; }
  update(s: EntityState, _enemy: boolean, dt: number): void {
    this.t += dt;
    this.tickFlash(dt);
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
    this.hpFrac = s.maxHp > 0 ? Math.max(0, s.hp / s.maxHp) : 1;
    // pop up out of the ground with an overshoot (0.35 s)
    const u = Math.min(1, this.t / 0.35);
    const pop = u >= 1 ? 1 : 1 - Math.cos(u * Math.PI * 2.5) * Math.exp(-u * 5) * (1 - u);
    this.squash = Math.max(0, this.squash - dt * 7);
    const sq = Math.sin(this.squash * Math.PI) * 0.06;
    this.body.scale.set(1 + sq, Math.max(0.02, pop) * (1 - sq), 1 + sq);
    // weaker walls wobble more
    const wob = (1 - this.hpFrac) * 0.05 + 0.006;
    this.body.rotation.z = Math.sin(this.t * 7.3) * wob;
    this.body.rotation.x = Math.sin(this.t * 5.1 + 1) * wob * 0.6;
  }
  exit(dt: number): boolean {
    this.gone += dt;
    if (this.wasDown) {
      // burst flat
      const k = this.gone / 0.25;
      this.body.scale.set(1 + k * 0.4, Math.max(0.01, 1 - k), 1 + k * 0.4);
      return this.gone > 0.25;
    }
    this.root.position.y -= dt * (BARRIER.height + BARRIER.sink) / 0.45;
    return this.gone > 0.45;
  }
}

export function createAbilityViews(scene: THREE.Scene, opts: AbilityViewsOptions = {}): AbilityViews {
  const group = new THREE.Group();
  group.name = 'ability-views';
  scene.add(group);
  const assets = new Map<TeamId, TeamAssets>();
  const assetsFor = (team: TeamId): TeamAssets => {
    let a = assets.get(team);
    if (!a) {
      a = { drone: buildDrone(team), charge: buildCharge(team), barrier: buildBarrier(team, ABILITIES.squeak_barrier.range) };
      assets.set(team, a);
    }
    return a;
  };
  const lens = droneLens(), ring = droneRing(), light = chargeLight(), cring = chargeRing();

  // Spotted markers: one instanced glow mesh, drawn through walls. The material is a private clone of the factory
  // glow (the shared cached glow must keep its depth test).
  const markerGeo = spottedMarker();
  const markerMat = glow(PALETTE.laserRed, 2.4).clone();
  markerMat.depthTest = false;
  markerMat.depthWrite = false;
  markerMat.userData.style = 'glow';
  const markers = new THREE.InstancedMesh(markerGeo, markerMat, MAX_MARKERS);
  markers.count = 0;
  markers.frustumCulled = false;
  markers.renderOrder = 20;
  markers.userData.noCameraCollide = true;
  group.add(markers);
  const mtx = new THREE.Matrix4(), mq = new THREE.Quaternion(), mp = new THREE.Vector3(), ms = new THREE.Vector3();

  const views = new Map<number, AbilityView>();
  const leaving: AbilityView[] = [];
  let time = 0, spottedCount = 0;

  const make = (s: EntityState, kind: AbilityKind): AbilityView => {
    const team = s.team as TeamId;
    const a = assetsFor(team);
    let v: AbilityView;
    if (kind === 'drone') v = new DroneView(s.id, team, bodyMesh(a.drone, 'drone'), lens, ring);
    else if (kind === 'charge') v = new ChargeView(s.id, team, bodyMesh(a.charge, 'charge'), light, cring);
    else v = new BarrierView(s.id, team, bodyMesh(a.barrier, 'barrier'));
    group.add(v.root);
    return v;
  };

  const seen = new Set<number>();
  return {
    group,
    sync(states, localTeam, dt) {
      time += dt;
      seen.clear();
      let n = 0;
      const cam = opts.camera;
      for (const s of states.values()) {
        const kind = abilityKindOf(s);
        if (kind) {
          seen.add(s.id);
          let v = views.get(s.id);
          if (!v) { v = make(s, kind); views.set(s.id, v); }
          v.update(s, localTeam !== -1 && s.team !== localTeam, dt);
          continue;
        }
        // spotted enemies of the local team (characters only)
        if (localTeam === -1 || n >= MAX_MARKERS || !(s.flags & EFlag.Spotted) || s.flags & EFlag.Dead || s.team === localTeam) continue;
        if (s.kind !== EntityKind.Player && s.kind !== EntityKind.Bot && s.kind !== EntityKind.Boss) continue;
        const h = s.kind === EntityKind.Boss ? 5.6 : s.species === Species.Cat ? 1.26 : 1.2;
        mp.set(s.x, s.y + h + 0.75 + Math.sin(time * 4 + s.id) * 0.08, s.z);
        if (cam) mq.copy(cam.quaternion); else mq.identity();
        const pulse = 1 + 0.12 * Math.sin(time * 7 + s.id * 0.7);
        const far = cam ? Math.max(1, cam.position.distanceTo(mp) / 14) : 1; // keeps its screen size past ~14 m
        ms.setScalar(pulse * far);
        markers.setMatrixAt(n++, mtx.compose(mp, mq, ms));
      }
      markers.count = n;
      if (n) markers.instanceMatrix.needsUpdate = true;
      spottedCount = n;
      for (const [id, v] of views) {
        if (seen.has(id)) continue;
        views.delete(id);
        v.gone = 0;
        leaving.push(v);
      }
      for (let i = leaving.length - 1; i >= 0; i--) {
        const v = leaving[i];
        if (v.exit(dt)) { group.remove(v.root); releaseObject3D(v.root); leaving.splice(i, 1); }
      }
    },
    onGameEvent(ev) {
      if (ev.e === 'hit') views.get(ev.dst)?.hit();
      else if (ev.e === 'ability' && ev.ability.endsWith(':down')) {
        const v = views.get(ev.id) ?? leaving.find((l) => l.id === ev.id);
        if (v) v.wasDown = true;
      }
    },
    dispose() {
      scene.remove(group);
      for (const a of assets.values()) for (const b of [a.drone, a.charge, a.barrier]) b.geometry.dispose();
      for (const g of [lens, ring, light, cring, markerGeo]) g.dispose();
      markers.dispose();
      markerMat.dispose();
      views.clear();
      leaving.length = 0;
    },
    stats() {
      let drones = 0, charges = 0, barriers = 0;
      for (const v of views.values()) {
        if (v instanceof DroneView) drones++; else if (v instanceof ChargeView) charges++; else barriers++;
      }
      const m = measureObject(group);
      return { drones, charges, barriers, spotted: spottedCount, drawCalls: m.drawCalls, triangles: m.triangles };
    },
  };
}
