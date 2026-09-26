// B1 — the Vac-Tank model (client): budgets, style, animation robustness, determinism.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { createBossAvatar, bossTelegraphFx, BOSS_TRI_BUDGET, BOSS_DRAW_BUDGET, type TelegraphPrimitive } from '../../src/client/procgen/boss';
import { Anim, EntityKind, EFlag } from '../../src/shared/types';
import type { AvatarFrame } from '../../src/client/views/avatar';
import type { EntityState } from '../../src/shared/protocol';
import { BOSSES, BossAttack, BossStage, packBossFlags } from '../../src/shared/content/bosses';

const frame = (o: Partial<AvatarFrame> = {}): AvatarFrame => ({
  speed: 0, vy: 0, grounded: true, anim: Anim.Idle, flags: EFlag.Grounded, aimPitch: 0, aimYawOffset: 0, hpFrac: 1,
  dead: false, firing: false, aiming: false, sprinting: false, ...o,
});

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
}

function boneHash(root: THREE.Object3D): number {
  let h = 0;
  root.updateMatrixWorld(true);
  root.traverse((o) => { if ((o as THREE.Bone).isBone) for (const v of o.matrixWorld.elements) h = (h * 31 + Math.round(v * 1e4)) | 0; });
  return h;
}

describe('Vac-Tank avatar', () => {
  it('fits the boss budget: ≤ 15k triangles, ≤ 8 draw calls, style materials only', () => {
    const a = createBossAvatar({ boss: 0, seed: 1 });
    const ms = meshes(a.root);
    const tris = ms.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0);
    expect(tris).toBe(a.stats.triangles);
    expect(tris).toBeLessThanOrEqual(BOSS_TRI_BUDGET);
    expect(ms.length).toBe(a.stats.drawCalls);
    expect(ms.length).toBeLessThanOrEqual(BOSS_DRAW_BUDGET);
    for (const m of ms) {
      const mat = m.material as THREE.Material;
      expect(['toon', 'glow']).toContain(mat.userData.style);
      if (mat.userData.style === 'toon') expect(m.geometry.userData.outlineReady).toBe(true);
    }
    expect(a.height).toBeGreaterThan(4);
    a.dispose();
  });

  it('animates every boss state (both phases, defeat + eject) without NaN, feet on the ground', () => {
    const a = createBossAvatar({ boss: 0, seed: 3 });
    const states: [number, number][] = [
      [BossAttack.Intro, BossStage.Active], [BossAttack.None, BossStage.Idle],
      [BossAttack.Laser, BossStage.Telegraph], [BossAttack.Laser, BossStage.Active], [BossAttack.Laser, BossStage.Recover],
      [BossAttack.Mortar, BossStage.Telegraph], [BossAttack.Mortar, BossStage.Active],
      [BossAttack.Spin, BossStage.Telegraph], [BossAttack.Spin, BossStage.Active], [BossAttack.Spin, BossStage.Recover],
      [BossAttack.PhaseShift, BossStage.Active], [BossAttack.Kittens, BossStage.Telegraph], [BossAttack.Kittens, BossStage.Active],
    ];
    let hp = 1;
    for (const [atk, stage] of states) {
      for (let i = 0; i < 40; i++) {
        hp -= 0.002;
        const p2 = atk === BossAttack.PhaseShift || atk === BossAttack.Kittens;
        a.update(frame({ speed: i % 20 < 10 ? 2.5 : 0, flags: EFlag.Grounded | packBossFlags(atk, stage, p2, i / 40), aimYawOffset: Math.sin(i * 0.2), aimPitch: -0.2, hpFrac: hp }), i === 7 ? 0 : i === 13 ? 0.5 : 1 / 60);
      }
      expect(a.state.attack).toBe(atk);
    }
    a.trigger('hit', 2); a.trigger('land', 8); a.trigger('lid_pop'); a.trigger('fire');
    for (let i = 0; i < 180; i++) a.update(frame({ dead: true, anim: Anim.Dead, hpFrac: 0, flags: EFlag.Dead | packBossFlags(BossAttack.Dying, BossStage.Active, true, i / 180) }), 1 / 60);
    a.root.updateMatrixWorld(true);
    let finite = true;
    a.root.traverse((o) => { for (const v of o.matrixWorld.elements) if (!Number.isFinite(v)) finite = false; });
    expect(finite).toBe(true);
    // the pilot was ejected (flew off and shrank away) and the muzzle query still works
    expect(a.pilot.root.parent).toBe(a.root);
    expect(a.pilot.root.visible).toBe(false);
    const m = a.muzzleWorld(new THREE.Vector3());
    expect(Number.isFinite(m.x + m.y + m.z)).toBe(true);
    a.dispose();
  });

  it('points the laser lens where the snapshot aims (turret yaw offset + barrel pitch)', () => {
    const a = createBossAvatar({ boss: 0, seed: 1 });
    const def = BOSSES[0];
    for (let i = 0; i < 30; i++) a.update(frame({ aimYawOffset: Math.PI / 2, aimPitch: 0 }), 1 / 60);
    const m = a.muzzleWorld(new THREE.Vector3());
    // yaw +90° (left, -X): the lens sits pivotFwd + barrel out along -X at the pivot height
    expect(m.x).toBeLessThan(-(def.turret.pivotFwd + def.turret.barrel) * 0.9);
    expect(Math.abs(m.z)).toBeLessThan(0.3);
    expect(Math.abs(m.y - def.turret.pivotY)).toBeLessThan(0.25);
    a.dispose();
  });

  it('is deterministic for the same seed and frames', () => {
    const run = () => {
      const a = createBossAvatar({ boss: 0, seed: 11 });
      for (let i = 0; i < 90; i++) a.update(frame({ speed: 2, aimYawOffset: 0.4, flags: EFlag.Grounded | packBossFlags(BossAttack.Spin, i < 45 ? BossStage.Telegraph : BossStage.Active, false, 0) }), 1 / 60);
      const h = boneHash(a.root);
      a.dispose();
      return h;
    };
    expect(run()).toBe(run());
  });
});

describe('telegraph primitives (bossTelegraphFx)', () => {
  const base = (flags: number): EntityState => ({
    id: 1, kind: EntityKind.Boss, team: 1, species: 1, cls: 0, seed: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: -0.2,
    vx: 0, vy: 0, vz: 0, hp: 100, maxHp: 100, anim: Anim.Idle, flags, weapon: -1, ammo: 0,
  });
  it('laser telegraph: pointer + dot on the ground where the aim ray lands; sweep: thick beam', () => {
    const out: TelegraphPrimitive[] = [];
    bossTelegraphFx(base(packBossFlags(BossAttack.Laser, BossStage.Telegraph, false, 0.5)), () => 0, 0, out);
    const dot = out.find((p) => p.kind === 'dot')!;
    const ptr = out.find((p) => p.kind === 'pointer')!;
    expect(dot.y).toBeCloseTo(0, 2);
    expect(dot.z).toBeLessThan(-10); // yaw 0 faces -Z; pitch -0.2 from ~2.8 m lands ~13 m ahead
    expect(ptr.x2).toBeCloseTo(dot.x, 5);
    out.length = 0;
    bossTelegraphFx(base(packBossFlags(BossAttack.Laser, BossStage.Active, false, 0.5)), () => 0, 0, out);
    expect(out.some((p) => p.kind === 'beam')).toBe(true);
  });
  it('brush spin telegraph: danger ring at the spin radius + a growing ring', () => {
    const out: TelegraphPrimitive[] = [];
    bossTelegraphFx(base(packBossFlags(BossAttack.Spin, BossStage.Telegraph, false, 0.5)), () => 0, 0, out);
    expect(out.find((p) => p.kind === 'ring')!.r).toBeCloseTo(BOSSES[0].spin.radius, 5);
    const g = out.find((p) => p.kind === 'growRing')!;
    expect(g.r).toBeGreaterThan(BOSSES[0].radius);
    expect(g.r).toBeLessThan(BOSSES[0].spin.radius);
  });
});
