// Keeps one visual per sim entity in sync with interpolated/predicted states.
// Blob shadows: when the quality tier has no shadow pass (low), a soft dark disc on the ground under each character
// keeps it grounded (and shows jump height); one instanced draw for all characters.
import * as THREE from 'three/webgpu';
import { float, length, smoothstep, uv, uniform } from 'three/tsl';
import { releaseObject3D } from '../engine/release';
import type { EntityState } from '../../shared/protocol';
import { CLASS_IDS, EFlag, EntityKind, type ClassId, type TeamId, type SpeciesId } from '../../shared/types';
import { angleDelta, damp, lerpAngle } from '../../shared/math';
import { createAvatar, isVeteranSeed } from '../procgen/characters';
import { createBossAvatar } from '../procgen/boss';
import { applyLook } from '../procgen/cosmetics';
import { randomLook, type Look } from '../../shared/content/cosmetics';
import type { Avatar } from './avatar';
import { mountedBodyTilt, mountedBodyYaw } from '../vehicles';

interface View {
  id: number;
  avatar: Avatar;
  bodyYaw: number;
  lastState: EntityState;
  key: string;
  /** N2: the look it wears ('' = classic) */
  lookKey: string;
}

const MAX_BLOBS = 64;

export interface EntityViewsOptions {
  /** Walkable surface height (m) at or below y (terrain, decks, roofs): blob shadows sit on it. */
  surfaceAt?: (x: number, z: number, y: number) => number;
  /** N2: a player's equipped look (from the roster); bots wear randomLook(seed) without asking. */
  lookOf?: (entityId: number) => Look | undefined;
}

export class EntityViews {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();
  private blobs: THREE.InstancedMesh;
  private blobsOn = false;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  constructor(scene: THREE.Scene, private readonly opts: EntityViewsOptions = {}) {
    this.group.name = 'entities';
    scene.add(this.group);
    const geo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.name = 'fx_blob_shadow';
    mat.userData.style = 'fx'; // a decal, not a lit surface: no toon bands, no ink hull
    mat.transparent = true;
    mat.depthWrite = false;
    mat.colorNode = uniform(new THREE.Color(0x1a120c));
    const r = length(uv().sub(0.5)).mul(2);
    mat.opacityNode = smoothstep(float(1), float(0.35), r).mul(0.6);
    this.blobs = new THREE.InstancedMesh(geo, mat, MAX_BLOBS);
    this.blobs.name = 'blob_shadows';
    this.blobs.count = 0;
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = 2;
    this.blobs.visible = false;
    scene.add(this.blobs);
  }

  /** Blob shadows on/off (on when the quality tier has no shadow pass). */
  setBlobShadows(on: boolean): void {
    this.blobsOn = on;
    this.blobs.visible = on;
  }

  get(id: number): View | undefined { return this.views.get(id); }

  sync(states: Map<number, EntityState>, localId: number, dt: number): void {
    for (const [id, v] of this.views) {
      if (!states.has(id)) { this.group.remove(v.avatar.root); releaseObject3D(v.avatar.root); v.avatar.dispose(); this.views.delete(id); }
    }
    for (const [id, s] of states) {
      const isBoss = s.kind === EntityKind.Boss;
      if (!isBoss && s.kind !== EntityKind.Player && s.kind !== EntityKind.Bot) continue;
      const cls: ClassId = CLASS_IDS[s.cls] ?? 'assault';
      // K2: about 1 bot in 6 is a veteran, picked from the seed (the same on every machine, no network)
      const veteran = !isBoss && s.kind === EntityKind.Bot && isVeteranSeed(s.seed);
      const key = isBoss ? `boss:${s.cls}:${s.seed}` : `${s.species}:${cls}:${s.team}:${s.seed}${veteran ? ':vet' : ''}`;
      let v = this.views.get(id);
      if (v && v.key !== key) { this.group.remove(v.avatar.root); releaseObject3D(v.avatar.root); v.avatar.dispose(); this.views.delete(id); v = undefined; }
      // N2: players wear their roster look, bots their seeded one (deterministic, no network), bosses none
      const look: Look | null = isBoss ? null
        : this.opts.lookOf?.(id) ?? (s.kind === EntityKind.Bot ? randomLook(s.seed, s.species as SpeciesId) : null);
      const lookKey = look ? `${look.coat ?? ''}|${look.neck ?? ''}` : '';
      if (!v) {
        const avatar = isBoss
          ? createBossAvatar({ boss: s.cls, seed: s.seed, team: s.team as TeamId })
          : createAvatar({ species: s.species as SpeciesId, cls, team: s.team as TeamId, seed: s.seed, isLocal: id === localId, look, veteran });
        this.group.add(avatar.root);
        v = { id, avatar, bodyYaw: s.yaw, lastState: s, key, lookKey };
        this.views.set(id, v);
      } else if (v.lookKey !== lookKey) {
        applyLook(v.avatar, look); // a roster look arrived (or changed): repaint in place, same view
        v.lookKey = lookKey;
      }
      const speed = Math.hypot(s.vx, s.vz);
      const aiming = (s.flags & (EFlag.Aiming | EFlag.Firing)) !== 0;
      // Body faces movement while running free; faces the aim while aiming/firing (shooter convention).
      let targetYaw = v.bodyYaw;
      if (aiming || speed < 0.5) targetYaw = aiming ? s.yaw : v.bodyYaw;
      if (!aiming && speed >= 0.5) targetYaw = Math.atan2(-s.vx, -s.vz);
      const mountedYaw = mountedBodyYaw(s, states); // riders face their kart, not their velocity
      if (mountedYaw !== null) targetYaw = mountedYaw;
      v.bodyYaw = lerpAngle(v.bodyYaw, targetYaw, 1 - Math.exp(-(isBoss ? 5 : 14) * dt)); // bosses turn heavily
      v.avatar.root.position.set(s.x, s.y, s.z);
      const tilt = mountedBodyTilt(s, states); // R1: plane pilots pitch and bank with their plane (null otherwise)
      v.avatar.root.rotation.set(tilt?.pitch ?? 0, v.bodyYaw, tilt?.roll ?? 0, 'YXZ');
      v.avatar.update({
        speed, vy: s.vy, grounded: (s.flags & EFlag.Grounded) !== 0, anim: s.anim, flags: s.flags,
        aimPitch: s.pitch, aimYawOffset: angleDelta(v.bodyYaw, s.yaw), hpFrac: s.maxHp ? s.hp / s.maxHp : 1,
        dead: (s.flags & EFlag.Dead) !== 0, firing: (s.flags & EFlag.Firing) !== 0, aiming, sprinting: (s.flags & EFlag.Sprinting) !== 0,
      }, dt);
      v.lastState = s;
    }
    if (this.blobsOn) this.updateBlobs();
    void damp;
  }

  private updateBlobs(): void {
    let n = 0;
    for (const v of this.views.values()) {
      if (n >= MAX_BLOBS) break;
      const s = v.lastState;
      if (s.flags & EFlag.Dead) continue;
      const boss = s.kind === EntityKind.Boss;
      const ground = this.opts.surfaceAt ? this.opts.surfaceAt(s.x, s.z, s.y + 0.1) : s.y;
      const above = Math.max(0, s.y - ground);
      // smaller and fainter the higher the character is (reads jump height), gone above ~6 m
      const k = Math.max(0, 1 - above / 6);
      if (k <= 0.05) continue;
      const r = (boss ? 2.8 : 0.62) * (0.55 + 0.45 * k);
      this.p.set(s.x, Math.min(s.y, ground) + 0.035, s.z);
      this.sc.set(r, 1, r);
      this.m4.compose(this.p, this.q, this.sc);
      this.blobs.setMatrixAt(n++, this.m4);
    }
    this.blobs.count = n;
    this.blobs.instanceMatrix.needsUpdate = true;
  }

  trigger(id: number, action: string, strength?: number): void {
    this.views.get(id)?.avatar.trigger(action, strength);
  }
}
