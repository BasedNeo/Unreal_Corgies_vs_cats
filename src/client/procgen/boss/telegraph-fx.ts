// Boss telegraph FX: everything that warns players BEFORE damage, drawn from authoritative data only.
//
//   bossTelegraphFx(state, heightAt, t, out, others?)  pure: primitives to draw for one boss EntityState
//     Vac-Tank (B1):
//       laser telegraph → thin pointer beam lens→ground + pulsing red dot where the ray meets the ground
//       laser sweep     → thick beam + bright dot (the dot scorches whatever it crosses)
//       brush spin      → danger ring (spin radius) + a ring growing from the hull to it over the wind-up
//     Sniper elite (E1), from the snapshot aim (yaw/pitch) + dot distance (ammo, cm):
//       tracking        → pointer beam lens→dot + a glowing dot core wherever it lands (ground, walls,
//                         characters); a flat ring when it is on the ground; a pulsing ring at the feet of
//                         the character it is on (`others`) — "you are painted"
//       glint           → a gold-white star on the laser device for the last `glint` s (the weak point:
//                         shoot it to spoil the shot); a flash at the shot
//   createBossTelegraphFx(scene, { heightAt })  renderer (3–4 draw calls, zero allocations per frame):
//       onGameEvent(ev) → hairball warning circles (`hairball_mortar`: outer ring = blast radius, a ring
//                          closing to the centre as the shell falls; removed by the matching `explode`),
//                          sweep-arc markers (`laser_sweep`)
//       update(dt, states) → state primitives above + hairball meshes (projectile states owned by a boss)
// Red = "this hurts". All glow materials come from the style system (bloom picks them up).
import * as THREE from 'three/webgpu';
import { glow, toon } from '../../style/style-webgpu.js';
import { PALETTE } from '../../style/style-tokens.js';
import { EntityKind } from '../../../shared/types';
import type { EntityState, GameEvent } from '../../../shared/protocol';
import {
  BossAttack, BossStage, BOSS_ABILITY, SNIPER_ABILITY, SniperAct, bossByIndex, bossMuzzle, bossTime, hairballSpec, rayGround,
  sniperDot, sniperGlinting, sniperLens, unpackBossFlags, type BossFlagState, type P3, type SniperDef,
} from '../../../shared/content/bosses';
import { mixHex } from '../characters/colors';
import { smoothNormalsByPosition } from '../../style/style-utils.js';

export type TelegraphKind = 'dot' | 'pointer' | 'beam' | 'ring' | 'growRing' | 'spark' | 'glint' | 'target';

export interface TelegraphPrimitive {
  kind: TelegraphKind;
  x: number; y: number; z: number;
  /** End point (beams/pointers). */
  x2: number; y2: number; z2: number;
  /** Radius (rings/dots) or beam thickness. */
  r: number;
  /** 0..1 emphasis (pulse, progress). */
  k: number;
}

const flags: BossFlagState = { attack: 0, stage: 0, phase2: false, progress: 0 };
const mz: P3 = { x: 0, y: 0, z: 0 }, gp: P3 = { x: 0, y: 0, z: 0 };
const pool: TelegraphPrimitive[] = [];
let used = 0;
function prim(kind: TelegraphKind): TelegraphPrimitive {
  let p = pool[used];
  if (!p) { p = { kind, x: 0, y: 0, z: 0, x2: 0, y2: 0, z2: 0, r: 0, k: 0 }; pool[used] = p; }
  used++;
  p.kind = kind;
  return p;
}

/**
 * What to draw for one boss state (appends to `out`; the objects are pooled — read them this frame).
 * `t` = presentation clock (s) for pulses. `others` (optional) = every entity state, so a sniper's dot can
 * ring the feet of the character it is painting. Returns `out`.
 */
export function bossTelegraphFx(s: EntityState, heightAt: (x: number, z: number) => number, t: number, out: TelegraphPrimitive[], others?: Map<number, EntityState>): TelegraphPrimitive[] {
  if (s.kind !== EntityKind.Boss) return out;
  const def = bossByIndex(s.cls);
  unpackBossFlags(s.flags, flags);
  if (def.kind === 'sniper') return sniperFx(def, s, heightAt, t, out, others);
  if (flags.attack === BossAttack.Laser && (flags.stage === BossStage.Telegraph || flags.stage === BossStage.Active)) {
    bossMuzzle(def, s.x, s.y, s.z, s.yaw, s.pitch, mz);
    const c = Math.cos(s.pitch);
    rayGround(heightAt, mz.x, mz.y, mz.z, -Math.sin(s.yaw) * c, Math.sin(s.pitch), -Math.cos(s.yaw) * c, def.laser.maxRange + 20, gp);
    const active = flags.stage === BossStage.Active;
    const b = prim(active ? 'beam' : 'pointer');
    b.x = mz.x; b.y = mz.y; b.z = mz.z; b.x2 = gp.x; b.y2 = gp.y; b.z2 = gp.z;
    b.r = active ? 0.11 : 0.04; b.k = active ? 1 : 0.4 + 0.6 * flags.progress;
    out.push(b);
    const d = prim('dot');
    d.x = gp.x; d.y = gp.y; d.z = gp.z; d.x2 = gp.x; d.y2 = gp.y + (active ? 1.1 : 0.7); d.z2 = gp.z;
    d.r = active ? 0.85 : 0.55 + 0.12 * Math.sin(t * 18);
    d.k = active ? 1 : 0.5 + 0.5 * Math.abs(Math.sin(t * 9));
    out.push(d);
  }
  if (flags.attack === BossAttack.Spin && (flags.stage === BossStage.Telegraph || flags.stage === BossStage.Active)) {
    const ring = prim('ring');
    ring.x = s.x; ring.y = s.y; ring.z = s.z; ring.x2 = ring.x; ring.y2 = ring.y; ring.z2 = ring.z;
    ring.r = def.spin.radius; ring.k = flags.stage === BossStage.Active ? 1 : 0.5 + 0.5 * Math.abs(Math.sin(t * 10));
    out.push(ring);
    if (flags.stage === BossStage.Telegraph) {
      const g = prim('growRing');
      g.x = s.x; g.y = s.y; g.z = s.z; g.x2 = g.x; g.y2 = g.y; g.z2 = g.z;
      g.r = def.radius + (def.spin.radius - def.radius) * flags.progress; g.k = flags.progress;
      out.push(g);
    }
  }
  return out;
}

const dp: P3 = { x: 0, y: 0, z: 0 };

/** E1: the laser pointer (beam + dot + painted ring) and the glinting device. */
function sniperFx(def: SniperDef, s: EntityState, heightAt: (x: number, z: number) => number, t: number, out: TelegraphPrimitive[], others?: Map<number, EntityState>): TelegraphPrimitive[] {
  const tracking = flags.attack === SniperAct.Track && flags.stage === BossStage.Telegraph;
  const shot = flags.attack === SniperAct.Track && flags.stage === BossStage.Active;
  const glinting = sniperGlinting(def, flags);
  sniperLens(def, s.x, s.y, s.z, s.yaw, s.pitch, mz);
  const dot = (tracking || shot) ? sniperDot(def, s, dp) : null;
  if (dot) {
    const b = prim(shot ? 'beam' : 'pointer');
    b.x = mz.x; b.y = mz.y; b.z = mz.z; b.x2 = dot.x; b.y2 = dot.y; b.z2 = dot.z;
    b.r = shot ? 0.09 : glinting ? 0.05 : 0.035; b.k = shot ? 1 : 0.5 + 0.5 * flags.progress;
    out.push(b);
    const c = prim('spark');
    c.x = dot.x; c.y = dot.y; c.z = dot.z; c.x2 = dot.x; c.y2 = dot.y; c.z2 = dot.z;
    c.r = (glinting ? 0.17 : 0.13) + 0.03 * Math.sin(t * 20); c.k = 0.6 + 0.4 * Math.abs(Math.sin(t * 9));
    out.push(c);
    if (Math.abs(dot.y - heightAt(dot.x, dot.z)) < 0.3) {
      const d = prim('dot');
      d.x = dot.x; d.y = dot.y; d.z = dot.z; d.x2 = dot.x; d.y2 = dot.y + 0.5; d.z2 = dot.z;
      d.r = 0.42 + 0.1 * Math.sin(t * 18); d.k = c.k;
      out.push(d);
    }
    // "you are painted": a ring at the feet of the character the dot is on
    if (others) {
      let best: EntityState | null = null, bd = 1.1;
      for (const o of others.values()) {
        if ((o.kind !== EntityKind.Player && o.kind !== EntityKind.Bot) || o.id === s.id) continue;
        const dy = dot.y < o.y ? o.y - dot.y : dot.y > o.y + 1.4 ? dot.y - o.y - 1.4 : 0;
        const d = Math.hypot(dot.x - o.x, dot.z - o.z) + dy;
        if (d < bd) { bd = d; best = o; }
      }
      if (best) {
        const r = prim('target');
        r.x = best.x; r.y = best.y; r.z = best.z; r.x2 = r.x; r.y2 = r.y; r.z2 = r.z;
        r.r = 0.9 - 0.35 * flags.progress + 0.06 * Math.sin(t * 16); r.k = flags.progress;
        out.push(r);
      }
    }
  }
  if (glinting || shot) {
    const g = prim('glint');
    g.x = mz.x; g.y = mz.y; g.z = mz.z;
    // x2..z2 = the aim direction (the star faces along it: toward the target)
    const c = Math.cos(s.pitch);
    g.x2 = -Math.sin(s.yaw) * c; g.y2 = Math.sin(s.pitch); g.z2 = -Math.cos(s.yaw) * c;
    g.r = shot ? 0.55 : def.lens.r * (1 + 0.35 * Math.abs(Math.sin(t * 14)));
    g.k = shot ? 1 : 0.7 + 0.3 * Math.abs(Math.sin(t * 14));
    out.push(g);
  }
  return out;
}

interface Circle { x: number; y: number; z: number; r: number; t0: number; T: number; boss: number; alive: boolean }
interface Arc { x: number; z: number; bx: number; bz: number; half: number; t0: number; T: number; alive: boolean }
/** E1: where a relocating sniper will land (drawn until she lands). */
interface LeapMark { boss: number; x: number; y: number; z: number; t0: number; alive: boolean }

export interface BossTelegraphFx {
  group: THREE.Group;
  onGameEvent(ev: GameEvent): void;
  update(dt: number, states: Map<number, EntityState>): void;
  /** Live counts (for the debug hook / lab). */
  stats: { circles: number; rings: number; beams: number; hairballs: number; sparks: number; glints: number; leapMarks: number; drawCalls: number };
  dispose(): void;
}

/** Fuzzy hairball: a lumpy icosphere with tufts (vertex-displaced, style toon material). */
function hairballGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.34, 1);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 23.1) * Math.cos(v.y * 19.7) * Math.sin(v.z * 17.3);
    v.multiplyScalar(1 + 0.22 * n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', p);
  smoothNormalsByPosition(THREE, m); // outline-safe normals (the ink hull must not tear)
  m.userData.outlineReady = true;
  g.dispose();
  return m;
}

export function createBossTelegraphFx(scene: THREE.Object3D, opts: { heightAt: (x: number, z: number) => number; capacity?: number }): BossTelegraphFx {
  const heightAt = opts.heightAt;
  const cap = opts.capacity ?? 48;
  const group = new THREE.Group();
  group.name = 'boss_telegraph_fx';
  const red = glow(PALETTE.laserRed, 1.2);
  const thinGeo = new THREE.RingGeometry(0.93, 1, 64, 1).rotateX(-Math.PI / 2);
  const thickGeo = new THREE.RingGeometry(0.52, 1, 28, 1).rotateX(-Math.PI / 2);
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0);
  const ballGeo = hairballGeometry();
  const thin = new THREE.InstancedMesh(thinGeo, red, cap);
  const thick = new THREE.InstancedMesh(thickGeo, red, cap);
  const beams = new THREE.InstancedMesh(beamGeo, glow(PALETTE.laserRed, 1.6), 16);
  const balls = new THREE.InstancedMesh(ballGeo, toon({ color: mixHex(PALETTE.catGrey, PALETTE.dirt, 0.45) }), 16);
  // E1: dot cores (red) and the device glint (gold-white core + 4-point star rays)
  const sparkGeo = new THREE.IcosahedronGeometry(1, 2);
  const sparks = new THREE.InstancedMesh(sparkGeo, glow(PALETTE.laserRed, 3.4), 8);
  const glintColor = mixHex(PALETTE.catWhite, PALETTE.accentHot, 0.35);
  const glints = new THREE.InstancedMesh(sparkGeo, glow(glintColor, 3.2), 4);
  const glintRays = new THREE.InstancedMesh(beamGeo, glow(glintColor, 2.8), 8);
  const meshes = [thin, thick, beams, balls, sparks, glints, glintRays];
  for (const m of meshes) { m.count = 0; m.frustumCulled = false; m.castShadow = false; group.add(m); }
  balls.castShadow = true;
  thin.name = 'boss_fx_rings'; thick.name = 'boss_fx_dots'; beams.name = 'boss_fx_beams'; balls.name = 'boss_fx_hairballs';
  sparks.name = 'boss_fx_sparks'; glints.name = 'boss_fx_glints'; glintRays.name = 'boss_fx_glint_rays';
  scene.add(group);

  const circles: Circle[] = [];
  const arcs: Arc[] = [];
  const leaps: LeapMark[] = [];
  const prims: TelegraphPrimitive[] = [];
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let clock = 0;
  let states: Map<number, EntityState> = new Map();
  const stats = { circles: 0, rings: 0, beams: 0, hairballs: 0, sparks: 0, glints: 0, leapMarks: 0, drawCalls: 0 };
  const side = new THREE.Vector3(), upv = new THREE.Vector3(), aimv = new THREE.Vector3();

  const setRing = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, r: number) => {
    pos.set(x, y + 0.1, z); quat.identity(); scl.set(r, 1, r);
    mesh.setMatrixAt(i, m4.compose(pos, quat, scl));
  };
  const setBeam = (i: number, x: number, y: number, z: number, x2: number, y2: number, z2: number, r: number, mesh: THREE.InstancedMesh = beams) => {
    dir.set(x2 - x, y2 - y, z2 - z);
    const len = dir.length();
    if (len < 1e-4) return false;
    quat.setFromUnitVectors(up, dir.multiplyScalar(1 / len));
    pos.set(x, y, z); scl.set(r, len, r);
    mesh.setMatrixAt(i, m4.compose(pos, quat, scl));
    return true;
  };
  const setSphere = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, r: number) => {
    pos.set(x, y, z); quat.identity(); scl.setScalar(r);
    mesh.setMatrixAt(i, m4.compose(pos, quat, scl));
  };

  const fx: BossTelegraphFx = {
    group,
    stats,
    onGameEvent(ev) {
      if (ev.e === 'ability') {
        const boss = states.get(ev.id);
        const def = bossByIndex(boss?.cls ?? 0);
        const p2 = boss ? unpackBossFlags(boss.flags, flags).phase2 : false;
        if (ev.ability === BOSS_ABILITY.mortarShell) {
          let c = circles.find((q) => !q.alive);
          if (!c) { c = { x: 0, y: 0, z: 0, r: 0, t0: 0, T: 0, boss: 0, alive: false }; circles.push(c); }
          const spec = hairballSpec(def, p2);
          c.x = ev.x; c.y = ev.y; c.z = ev.z; c.r = spec.blast.explodeRadius; c.t0 = clock;
          c.T = spec.flight; c.boss = ev.id; c.alive = true;
        } else if (ev.ability === SNIPER_ABILITY.leap) {
          let l = leaps.find((q) => !q.alive);
          if (!l) { l = { boss: 0, x: 0, y: 0, z: 0, t0: 0, alive: false }; leaps.push(l); }
          l.boss = ev.id; l.x = ev.x; l.y = ev.y; l.z = ev.z; l.t0 = clock; l.alive = true;
        } else if (ev.ability === BOSS_ABILITY.laserSweep && boss && def.kind === 'tank') {
          let a = arcs.find((q) => !q.alive);
          if (!a) { a = { x: 0, z: 0, bx: 0, bz: 0, half: 0, t0: 0, T: 0, alive: false }; arcs.push(a); }
          a.x = ev.x; a.z = ev.z; a.bx = boss.x; a.bz = boss.z; a.half = def.laser.arc; a.t0 = clock; a.T = bossTime(def, def.laser.sweep, p2) + 0.1; a.alive = true;
        }
      } else if (ev.e === 'explode') {
        for (const c of circles) if (c.alive && Math.hypot(c.x - ev.x, c.z - ev.z) < 0.6) c.alive = false;
      }
    },
    update(dt, st) {
      states = st;
      clock += dt;
      used = 0;
      prims.length = 0;
      for (const s of st.values()) if (s.kind === EntityKind.Boss) bossTelegraphFx(s, heightAt, clock, prims, st);
      let nThin = 0, nThick = 0, nBeam = 0, nBall = 0, nSpark = 0, nGlint = 0, nRay = 0;
      for (const p of prims) {
        if (p.kind === 'ring') { if (nThin < cap) setRing(thin, nThin++, p.x, p.y, p.z, p.r * (0.97 + 0.03 * p.k)); }
        else if (p.kind === 'growRing') { if (nThin < cap) setRing(thin, nThin++, p.x, p.y, p.z, p.r); }
        else if (p.kind === 'target') {
          if (nThin < cap - 1) { setRing(thin, nThin++, p.x, p.y, p.z, p.r); setRing(thin, nThin++, p.x, p.y, p.z, p.r * 0.72); }
        } else if (p.kind === 'spark') { if (nSpark < 8) setSphere(sparks, nSpark++, p.x, p.y, p.z, p.r); }
        else if (p.kind === 'glint') {
          if (nGlint < 4) setSphere(glints, nGlint++, p.x, p.y, p.z, p.r * 0.55);
          // a 4-point star in the plane facing the aim (so the target sees it face-on)
          aimv.set(p.x2, p.y2, p.z2);
          side.set(-aimv.z, 0, aimv.x).normalize();
          upv.crossVectors(side, aimv).normalize();
          const L = p.r * 2.6, w = 0.02 + 0.025 * p.k;
          for (const v of [side, upv]) {
            if (nRay >= 8) break;
            if (setBeam(nRay, p.x - v.x * L, p.y - v.y * L, p.z - v.z * L, p.x + v.x * L, p.y + v.y * L, p.z + v.z * L, w, glintRays)) nRay++;
          }
        }
        else if (p.kind === 'dot') {
          if (nThick < cap - 1) { setRing(thick, nThick++, p.x, p.y, p.z, p.r); setRing(thick, nThick++, p.x, p.y, p.z, p.r * 0.38); }
          if (nBeam < 16 && setBeam(nBeam, p.x, p.y, p.z, p.x2, p.y2, p.z2, 0.05 + 0.04 * p.k)) nBeam++;
        } else if (nBeam < 16 && setBeam(nBeam, p.x, p.y, p.z, p.x2, p.y2, p.z2, p.r)) nBeam++;
      }
      // hairball warning circles: blast radius + a ring closing on the centre as the shell falls
      let live = 0;
      for (const c of circles) {
        if (!c.alive) continue;
        const u = (clock - c.t0) / c.T;
        if (u > 1.2) { c.alive = false; continue; }
        live++;
        if (nThin < cap - 1) {
          setRing(thin, nThin++, c.x, c.y, c.z, c.r);
          setRing(thin, nThin++, c.x, c.y, c.z, Math.max(0.15, c.r * (1 - Math.min(1, u))));
        }
        if (nThick < cap) setRing(thick, nThick++, c.x, c.y, c.z, 0.3 + 0.1 * Math.sin(clock * 20));
      }
      // sweep arc markers along the locked arc
      for (const a of arcs) {
        if (!a.alive) continue;
        if (clock - a.t0 > a.T) { a.alive = false; continue; }
        const dx = a.x - a.bx, dz = a.z - a.bz, d = Math.hypot(dx, dz), base = Math.atan2(dx, dz);
        for (let k = -3; k <= 3 && nThick < cap; k++) {
          const ang = base + (k / 3) * a.half;
          const x = a.bx + Math.sin(ang) * d, z = a.bz + Math.cos(ang) * d;
          setRing(thick, nThick++, x, heightAt(x, z), z, 0.22);
        }
      }
      // E1: leap destination markers (until the sniper has landed)
      let marks = 0;
      for (const l of leaps) {
        if (!l.alive) continue;
        const b = st.get(l.boss);
        const f = b ? unpackBossFlags(b.flags, flags) : null;
        if (!b || !f || f.attack !== SniperAct.Leap || f.stage === BossStage.Recover || clock - l.t0 > 6) { l.alive = false; continue; }
        marks++;
        if (nThin < cap - 1) {
          setRing(thin, nThin++, l.x, l.y, l.z, 1.2);
          setRing(thin, nThin++, l.x, l.y, l.z, 0.35 + 0.85 * (((clock - l.t0) * 1.6) % 1));
        }
      }
      // hairballs: projectile snapshot entities owned by a boss (seed = owner id)
      for (const s of st.values()) {
        if (s.kind !== EntityKind.Projectile || nBall >= 16) continue;
        if (states.get(s.seed)?.kind !== EntityKind.Boss) continue;
        pos.set(s.x, s.y, s.z);
        quat.setFromAxisAngle(dir.set(1, 0.3, 0.2).normalize(), clock * 9 + s.id);
        scl.setScalar(1);
        balls.setMatrixAt(nBall++, m4.compose(pos, quat, scl));
      }
      thin.count = nThin; thick.count = nThick; beams.count = nBeam; balls.count = nBall;
      sparks.count = nSpark; glints.count = nGlint; glintRays.count = nRay;
      let draws = 0;
      for (const m of meshes) if (m.count) { m.instanceMatrix.needsUpdate = true; draws++; }
      stats.circles = live; stats.rings = nThin + nThick; stats.beams = nBeam; stats.hairballs = nBall;
      stats.sparks = nSpark; stats.glints = nGlint; stats.leapMarks = marks;
      stats.drawCalls = draws;
    },
    dispose() {
      scene.remove(group);
      thinGeo.dispose(); thickGeo.dispose(); beamGeo.dispose(); ballGeo.dispose(); sparkGeo.dispose();
      for (const m of meshes) m.dispose();
    },
  };
  return fx;
}
