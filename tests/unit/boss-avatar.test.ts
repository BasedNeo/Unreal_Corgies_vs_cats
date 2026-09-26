// B1 — the Vac-Tank model (client): budgets, style, animation robustness, determinism.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { createTankAvatar as createBossAvatar, bossTelegraphFx, BOSS_TRI_BUDGET, BOSS_DRAW_BUDGET, type TelegraphPrimitive } from '../../src/client/procgen/boss';
import { Anim, EntityKind, EFlag } from '../../src/shared/types';
import type { AvatarFrame } from '../../src/client/views/avatar';
import type { EntityState } from '../../src/shared/protocol';
import { VAC_TANK, BossAttack, BossStage, packBossFlags } from '../../src/shared/content/bosses';

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
    const def = VAC_TANK;
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
    expect(out.find((p) => p.kind === 'ring')!.r).toBeCloseTo(VAC_TANK.spin.radius, 5);
    const g = out.find((p) => p.kind === 'growRing')!;
    expect(g.r).toBeGreaterThan(VAC_TANK.radius);
    expect(g.r).toBeLessThan(VAC_TANK.spin.radius);
  });
});

// ------------------------------------------------------------------ E1: Madame Pointillé (sniper elite)
import { createBossAvatar as createAnyBossAvatar, type SniperAvatar } from '../../src/client/procgen/boss';
import { MADAME_POINTILLE, SniperAct, bossIndex, sniperLens, SNIPER_DOT_SCALE, sniperTrackTime } from '../../src/shared/content/bosses';

const SNIPER_IDX = bossIndex('madame_pointille');
const sniper = (seed = 3) => createAnyBossAvatar({ boss: SNIPER_IDX, seed }) as SniperAvatar;

describe('Madame Pointillé avatar (E1)', () => {
  it('is the sniper model: ≤ 15k triangles, ≤ 8 draw calls, style materials only, ~1.4× a cat', () => {
    const a = sniper(1);
    expect(a.kind).toBe('sniper');
    const ms = meshes(a.root);
    const tris = ms.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0);
    expect(tris).toBeLessThanOrEqual(BOSS_TRI_BUDGET);
    expect(ms.length).toBeLessThanOrEqual(BOSS_DRAW_BUDGET);
    expect(a.stats.drawCalls).toBe(ms.length);
    for (const m of ms) {
      const mat = m.material as THREE.Material;
      if (m.name === 'mesh_crease') continue; // the style system's own crease-ink lines on the rifle
      expect(['toon', 'glow']).toContain(mat.userData.style);
      if (mat.userData.style === 'toon') expect(m.geometry.userData.outlineReady).toBe(true);
    }
    // 1.4× a regular cat (≈ 1.26 m to the ear tips)
    const box = new THREE.Box3().setFromObject(a.skinned);
    expect(box.max.y).toBeGreaterThan(1.26 * 1.3);
    expect(box.max.y).toBeLessThan(1.26 * 1.6);
    expect(a.height).toBeCloseTo(MADAME_POINTILLE.height, 5);
    a.dispose();
  });

  it('the rifle muzzle matches the sim lens (beam origin + weak point) across the aim range', () => {
    const a = sniper(1);
    for (const pitch of [-0.45, -0.2, 0, 0.25]) {
      for (let i = 0; i < 90; i++) a.update(frame({ flags: EFlag.Grounded | EFlag.Aiming | packBossFlags(SniperAct.Track, BossStage.Telegraph, false, 0.3), aimPitch: pitch, aiming: true }), 1 / 60);
      a.root.updateMatrixWorld(true);
      const m = a.muzzleWorld(new THREE.Vector3());
      const L = sniperLens(MADAME_POINTILLE, 0, 0, 0, 0, pitch, { x: 0, y: 0, z: 0 });
      expect(Math.hypot(m.x - L.x, m.y - L.y, m.z - L.z), `pitch ${pitch}`).toBeLessThan(0.08);
    }
    a.dispose();
  });

  it('animates every sniper state (both phases, leap, stagger, defeat) without NaN; the beret flies off in phase 2', () => {
    const a = sniper(5);
    const states: [number, number, boolean][] = [
      [SniperAct.Intro, BossStage.Active, false], [SniperAct.None, BossStage.Idle, false],
      [SniperAct.Track, BossStage.Telegraph, false], [SniperAct.Track, BossStage.Active, false], [SniperAct.Track, BossStage.Recover, false],
      [SniperAct.Lob, BossStage.Telegraph, false], [SniperAct.Lob, BossStage.Active, false],
      [SniperAct.Leap, BossStage.Telegraph, false], [SniperAct.Leap, BossStage.Active, false], [SniperAct.Leap, BossStage.Recover, false],
      [SniperAct.Stagger, BossStage.Active, false], [SniperAct.PhaseShift, BossStage.Active, true], [SniperAct.Track, BossStage.Telegraph, true],
    ];
    let hp = 1;
    for (const [atk, stage, p2] of states) {
      const flying = atk === SniperAct.Leap && stage === BossStage.Active;
      for (let i = 0; i < 40; i++) {
        hp -= 0.004;
        a.update(frame({ speed: flying ? 14 : 0, vy: flying ? 6 - i * 0.4 : 0, grounded: !flying, anim: flying ? Anim.Jump : Anim.Idle, flags: (flying ? 0 : EFlag.Grounded | EFlag.Aiming) | packBossFlags(atk, stage, p2, i / 40), aimYawOffset: Math.sin(i * 0.2) * 0.5, aimPitch: -0.25, hpFrac: hp, aiming: !flying }), i === 7 ? 0 : 1 / 60);
      }
      expect(a.state.attack).toBe(atk);
    }
    expect(a.beret.parent).toBe(a.root); // popped off the head: flying in the avatar's space
    a.trigger('hit', 2); a.trigger('land', 8); a.trigger('shot_spoiled'); a.trigger('fire');
    for (let i = 0; i < 120; i++) a.update(frame({ dead: true, anim: Anim.Dead, hpFrac: 0, grounded: false, vy: -8, flags: EFlag.Dead | packBossFlags(SniperAct.Dying, BossStage.Active, true, i / 120) }), 1 / 60);
    a.root.updateMatrixWorld(true);
    let finite = true;
    a.root.traverse((o) => { for (const v of o.matrixWorld.elements) if (!Number.isFinite(v)) finite = false; });
    expect(finite).toBe(true);
    expect(a.beret.visible).toBe(false); // gone ~1.5 s after it flew off
    // a model created mid-phase-2 starts without the beret
    const b = sniper(5);
    b.update(frame({ flags: EFlag.Grounded | packBossFlags(SniperAct.None, BossStage.Idle, true, 0) }), 1 / 60);
    expect(b.beret.visible).toBe(false);
    a.dispose(); b.dispose();
  });

  it('is deterministic for the same seed and frames', () => {
    const go = () => {
      const a = sniper(11);
      for (let i = 0; i < 90; i++) a.update(frame({ aimYawOffset: 0.3, aimPitch: -0.1, aiming: true, flags: EFlag.Grounded | EFlag.Aiming | packBossFlags(SniperAct.Track, i < 45 ? BossStage.Telegraph : BossStage.Active, false, i / 90) }), 1 / 60);
      const h = boneHash(a.root);
      a.dispose();
      return h;
    };
    expect(go()).toBe(go());
  });
});

describe('sniper telegraph primitives (E1)', () => {
  const D = MADAME_POINTILLE;
  const st = (flags: number, ammo: number, o: Partial<EntityState> = {}): EntityState => ({
    id: 1, kind: EntityKind.Boss, team: 1, species: 1, cls: SNIPER_IDX, seed: 0, x: 0, y: 5, z: 0, yaw: 0, pitch: -0.1,
    vx: 0, vy: 0, vz: 0, hp: 100, maxHp: 100, anim: Anim.Idle, flags, weapon: 2, ammo, ...o,
  });
  it('tracking: a beam from the lens to the dot (lens + aim × ammo) with a glowing core; a ring at the painted character’s feet', () => {
    const out: TelegraphPrimitive[] = [];
    const s = st(packBossFlags(SniperAct.Track, BossStage.Telegraph, false, 0.3), 30 * SNIPER_DOT_SCALE);
    const target: EntityState = { ...st(0, 0), id: 7, kind: EntityKind.Player, cls: 2, x: 0, y: 5 + 0.9 - 30 * Math.sin(0.1) - 0.8, z: -1.44 * Math.cos(0.1) - 30 * Math.cos(0.1) };
    bossTelegraphFx(s, () => -50, 0, out, new Map([[1, s], [7, target]]));
    const L = sniperLens(D, 0, 5, 0, 0, -0.1, { x: 0, y: 0, z: 0 });
    const ptr = out.find((p) => p.kind === 'pointer')!;
    const core = out.find((p) => p.kind === 'spark')!;
    expect(ptr.x).toBeCloseTo(L.x, 5); expect(ptr.y).toBeCloseTo(L.y, 5);
    expect(core.z).toBeCloseTo(L.z - 30 * Math.cos(0.1), 4);
    expect(core.y).toBeCloseTo(L.y - 30 * Math.sin(0.1), 4);
    expect(ptr.x2).toBeCloseTo(core.x, 5);
    expect(out.some((p) => p.kind === 'glint')).toBe(false); // not yet
    expect(out.find((p) => p.kind === 'target')).toMatchObject({ x: target.x, z: target.z });
    // beam off: nothing drawn
    out.length = 0;
    bossTelegraphFx(st(packBossFlags(SniperAct.None, BossStage.Idle, false, 0), 0), () => 0, 0, out);
    expect(out).toHaveLength(0);
  });
  it('the device glints for the last `glint` s of the track (at the lens), and flashes on the shot', () => {
    const out: TelegraphPrimitive[] = [];
    const late = 1 - D.track.glint / sniperTrackTime(D, false) + 0.05;
    bossTelegraphFx(st(packBossFlags(SniperAct.Track, BossStage.Telegraph, false, late), 3000), () => 0, 0, out);
    const g = out.find((p) => p.kind === 'glint')!;
    const L = sniperLens(D, 0, 5, 0, 0, -0.1, { x: 0, y: 0, z: 0 });
    expect(g).toBeTruthy();
    expect(Math.hypot(g.x - L.x, g.y - L.y, g.z - L.z)).toBeLessThan(1e-6);
    out.length = 0;
    bossTelegraphFx(st(packBossFlags(SniperAct.Track, BossStage.Active, false, 0.5), 3000), () => 0, 0, out);
    expect(out.some((p) => p.kind === 'beam')).toBe(true);
    expect(out.some((p) => p.kind === 'glint')).toBe(true);
  });
});
