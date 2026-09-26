// Keeps one visual per sim entity in sync with interpolated/predicted states.
import * as THREE from 'three/webgpu';
import type { EntityState } from '../../shared/protocol';
import { CLASS_IDS, EFlag, EntityKind, type ClassId, type TeamId, type SpeciesId } from '../../shared/types';
import { angleDelta, damp, lerpAngle } from '../../shared/math';
import { createAvatar } from '../procgen/characters';
import { createBossAvatar } from '../procgen/boss';
import type { Avatar } from './avatar';
import { mountedBodyYaw } from '../vehicles';

interface View {
  id: number;
  avatar: Avatar;
  bodyYaw: number;
  lastState: EntityState;
  key: string;
}

export class EntityViews {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();
  constructor(scene: THREE.Scene) {
    this.group.name = 'entities';
    scene.add(this.group);
  }

  get(id: number): View | undefined { return this.views.get(id); }

  sync(states: Map<number, EntityState>, localId: number, dt: number): void {
    for (const [id, v] of this.views) {
      if (!states.has(id)) { this.group.remove(v.avatar.root); v.avatar.dispose(); this.views.delete(id); }
    }
    for (const [id, s] of states) {
      const isBoss = s.kind === EntityKind.Boss;
      if (!isBoss && s.kind !== EntityKind.Player && s.kind !== EntityKind.Bot) continue;
      const cls: ClassId = CLASS_IDS[s.cls] ?? 'assault';
      const key = isBoss ? `boss:${s.cls}:${s.seed}` : `${s.species}:${cls}:${s.team}:${s.seed}`;
      let v = this.views.get(id);
      if (v && v.key !== key) { this.group.remove(v.avatar.root); v.avatar.dispose(); this.views.delete(id); v = undefined; }
      if (!v) {
        const avatar = isBoss
          ? createBossAvatar({ boss: s.cls, seed: s.seed, team: s.team as TeamId })
          : createAvatar({ species: s.species as SpeciesId, cls, team: s.team as TeamId, seed: s.seed, isLocal: id === localId });
        this.group.add(avatar.root);
        v = { id, avatar, bodyYaw: s.yaw, lastState: s, key };
        this.views.set(id, v);
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
      v.avatar.root.rotation.y = v.bodyYaw;
      v.avatar.update({
        speed, vy: s.vy, grounded: (s.flags & EFlag.Grounded) !== 0, anim: s.anim, flags: s.flags,
        aimPitch: s.pitch, aimYawOffset: angleDelta(v.bodyYaw, s.yaw), hpFrac: s.maxHp ? s.hp / s.maxHp : 1,
        dead: (s.flags & EFlag.Dead) !== 0, firing: (s.flags & EFlag.Firing) !== 0, aiming, sprinting: (s.flags & EFlag.Sprinting) !== 0,
      }, dt);
      v.lastState = s;
    }
    void damp;
  }

  trigger(id: number, action: string, strength?: number): void {
    this.views.get(id)?.avatar.trigger(action, strength);
  }
}
