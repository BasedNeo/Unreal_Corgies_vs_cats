// base-assault presentation, 3D (W9 G4a, mode-1). Reads only the Base Assault props in the snapshot (EntityKind.Prop,
// seeds BA_BALL_SEED / BA_STAND_SEED / BA_GOAL_SEED; layout: src/shared/content/modes.ts) plus the carriers' states.
// Idle and invisible in other modes.
//   stand   a field-kit trophy stand: a pallet, an olive ammo can wrapped in team tape, a tin cup for the ball, and a
//           whip aerial with a team pennant (so it reads from across the yard)
//   ring    the capture ring around the base's flag: a tube hugging the ground, team coloured while this team can
//           capture, dark and dull while its own ball is away, gold during the stalemate relief
//   ball    a scuffed, fuzzy tennis ball (jittered felt sphere, a cream seam, two strips of team tape): on its stand at
//           home; strapped high on the carrier's back while carried; on the ground (bobbing in water) when dropped.
//           Away from home a beacon pillar and a diamond stand over it, so both teams can find it.
// Materials only through the style factory (toon/glow). Geometry is built once and shared by both teams.
import * as THREE from 'three/webgpu';
import type { EntityState, GameEvent } from '../../shared/protocol';
import { EFlag, EntityKind } from '../../shared/types';
import { hash2 } from '../../shared/world/noise';
import { BA_BALL, BA_BALL_SEED, BA_GOAL_SEED, BA_PICKUP_ITEM, BA_STAND_SEED, BASE_ASSAULT, BallState } from '../../shared/content/modes';
import { glow, toon } from '../style/style-webgpu.js';
import { PALETTE } from '../style/style-tokens.js';

/** Team signal colours (never the camo): corgis blue + gold, cats crimson + black. */
const TEAM = [PALETTE.teamCorgis, PALETTE.teamCats] as const;
const TEAM_TRIM = [PALETTE.teamCorgisTrim, PALETTE.teamCatsTrim] as const;
/** Grimy but readable felt: brighter than the spent balls in the clutter, still under the emissive tennis-ball key. */
const FELT = 0xc6d34c;
const SEAM = 0xe6dfc8;
const R = BA_BALL.radius;
const BEACON_H = 22;

export interface BaseAssaultViewOptions {
  /** Ground height (the capture ring hugs it); flat at the ring's centre when omitted. */
  heightAt?: (x: number, z: number) => number;
  /** A character's avatar height (the ball rides on the carrier's back); 1.2 m when unknown. */
  heightOf?: (id: number) => number | undefined;
  /** The render camera: beacons keep a minimum on-screen width at range (else they thin to nothing past ~60 m). */
  camera?: THREE.Camera;
}

export interface BaseAssaultView {
  readonly group: THREE.Group;
  /** Any Base Assault props in the snapshot this frame. */
  readonly active: boolean;
  sync(states: ReadonlyMap<number, EntityState>, localId: number, dt: number): void;
  onGameEvent(ev: GameEvent): void;
  /** Draw calls and triangles of what is shown (tests, budgets). */
  stats(): { drawCalls: number; triangles: number; balls: number; stands: number; rings: number };
  /** World position of a team's ball as drawn this frame (labs, HUD markers). */
  ballPosition(team: number): THREE.Vector3 | null;
  dispose(): void;
}

// ------------------------------------------------------------------------------------------------ geometry

/** Felt sphere, worn: per-vertex fuzz lumps, rubbed-flat scuffs, and grime / grass stains baked into vertex colours
 *  (grey-brown factors that multiply the felt colour). Seeded: the same for every ball. */
function ballGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(R, 24, 18);
  const p = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const scuffs = [new THREE.Vector3(0.55, 0.3, 0.78), new THREE.Vector3(-0.6, -0.5, 0.2), new THREE.Vector3(0.1, -0.9, -0.4)].map((d) => d.normalize());
  const stains = [new THREE.Vector3(-0.3, 0.2, -0.93), new THREE.Vector3(0.8, -0.55, 0.2), new THREE.Vector3(-0.2, -0.95, 0.25)].map((d) => d.normalize());
  for (let i = 0; i < p.count; i++) {
    n.fromBufferAttribute(p, i).normalize();
    const h = hash2(Math.round(n.x * 211), Math.round(n.y * 211) + Math.round(n.z * 97) * 173, 7);
    const fuzz = (h - 0.5) * 0.06;
    let scuff = 0;
    for (const d of scuffs) scuff += Math.max(0, n.dot(d) - 0.84) * 0.4;
    v.copy(n).multiplyScalar(R * (1 + fuzz - scuff));
    p.setXYZ(i, v.x, v.y, v.z);
    // grime: speckle everywhere, darker where it was rubbed, brown-green stains where it rolled through mud and grass
    let k = 0.9 + (h - 0.5) * 0.16 - scuff * 2.2;
    let r = 1, gg = 1, b = 1;
    for (const d of stains) {
      const t = Math.max(0, (n.dot(d) - 0.7) / 0.3);
      r -= t * 0.28; gg -= t * 0.3; b -= t * 0.42;
    }
    k = Math.max(0.55, Math.min(1.02, k));
    col[i * 3] = r * k; col[i * 3 + 1] = gg * k; col[i * 3 + 2] = b * k;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A strip of tape wrapped part-way round the ball (hand-wrapped: not a full loop, a little proud of the felt). */
function tapeGeometry(arc: number, width: number): THREE.BufferGeometry {
  const t = new THREE.TorusGeometry(R * 1.02, width, 3, 24, arc);
  t.scale(1, 1, 0.55); // flat, like tape, not a rope
  return t;
}

/** The tennis-ball seam: two interlocking lobes on the sphere. */
function seamGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) + 0.42 * Math.cos(3 * a), Math.sin(a) - 0.42 * Math.sin(3 * a), 0.9 * Math.sin(2 * a)).normalize().multiplyScalar(R * 1.01));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, 0.017, 4, true);
}

/** A stand: pallet, ammo can, tape band, cup, aerial and pennant (y = 0 at the stand's foot). */
interface StandParts { pallet: THREE.BufferGeometry; slats: THREE.BufferGeometry; can: THREE.BufferGeometry; lid: THREE.BufferGeometry; handle: THREE.BufferGeometry; tape: THREE.BufferGeometry; cup: THREE.BufferGeometry; mast: THREE.BufferGeometry; pennant: THREE.BufferGeometry }

function standGeometry(): StandParts {
  const pallet = new THREE.BoxGeometry(1.05, 0.07, 1.05);
  pallet.translate(0, 0.035, 0);
  const slats = new THREE.BoxGeometry(1.1, 0.06, 0.2);
  const s2 = slats.clone(); s2.translate(0, 0.1, -0.36);
  const s3 = slats.clone(); s3.translate(0, 0.1, 0);
  const s4 = slats.clone(); s4.translate(0, 0.1, 0.36);
  slats.dispose();
  const slatsAll = mergeGeos([s2, s3, s4]);
  const can = new THREE.BoxGeometry(0.46, 0.6, 0.34);
  can.translate(0, 0.13 + 0.3, 0);
  const lid = new THREE.BoxGeometry(0.5, 0.05, 0.38);
  lid.translate(0, 0.755, 0);
  const handle = new THREE.TorusGeometry(0.1, 0.018, 4, 10, Math.PI);
  handle.rotateY(Math.PI / 2);
  handle.translate(0.16, 0.78, 0);
  const tape = new THREE.BoxGeometry(0.475, 0.1, 0.355);
  tape.translate(0, 0.46, 0);
  const cup = new THREE.CylinderGeometry(0.17, 0.13, 0.1, 12, 1, true);
  cup.translate(0, BA_BALL.standTop - 0.03, 0);
  const mast = new THREE.CylinderGeometry(0.012, 0.018, 1.7, 5);
  mast.translate(-0.21, 0.78 + 0.85, -0.12);
  const pennant = new THREE.BufferGeometry();
  pennant.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.26, 0, 0.46, -0.1, 0.02], 3));
  pennant.setIndex([0, 1, 2]);
  pennant.computeVertexNormals();
  pennant.translate(-0.21, 0.78 + 1.68, -0.12);
  return { pallet, slats: slatsAll, can, lid, handle, tape, cup, mast, pennant };
}

function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of list) {
    const gi = g.index ? g : g.toNonIndexed();
    const p = gi.attributes.position, n = gi.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    if (gi.index) for (let i = 0; i < gi.index.count; i++) idx.push(gi.index.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

/** A closed tube around (cx, cz) at radius r that hugs the ground (y relative to cy). */
function ringGeometry(cx: number, cy: number, cz: number, r: number, heightAt?: (x: number, z: number) => number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const y = heightAt ? heightAt(x, z) : cy;
    pts.push(new THREE.Vector3(x - cx, y - cy + 0.07, z - cz));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, 0.08, 5, true);
}

/** Chevrons around the ring pointing in (12 small wedges, one geometry). */
function chevronGeometry(cx: number, cy: number, cz: number, r: number, heightAt?: (x: number, z: number) => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    const x = cx + Math.cos(a) * (r - 0.45), z = cz + Math.sin(a) * (r - 0.45);
    const y = (heightAt ? heightAt(x, z) : cy) - cy + 0.05;
    const c = new THREE.BufferGeometry();
    c.setAttribute('position', new THREE.Float32BufferAttribute([0.22, 0, -0.2, 0.22, 0, 0.2, -0.16, 0, 0], 3));
    c.setIndex([0, 2, 1]);
    c.computeVertexNormals();
    c.rotateY(-a);
    c.translate(x - cx, y, z - cz);
    parts.push(c);
  }
  return mergeGeos(parts);
}

// ------------------------------------------------------------------------------------------------ view

interface BallView {
  root: THREE.Group;
  body: THREE.Group;
  beacon: THREE.Mesh;
  diamond: THREE.Mesh;
  halo: THREE.Mesh;
  team: number;
  /** Squash-and-stretch pop (s left) and landing bounce (s left). */
  pop: number;
  bounce: number;
  spin: number;
  state: number;
  carrier: number;
}

interface StandView { root: THREE.Group }
interface RingView { root: THREE.Group; tube: THREE.Mesh; chev: THREE.Mesh; key: string; look: string; x: number; z: number }

export function createBaseAssaultView(scene: THREE.Scene, opts: BaseAssaultViewOptions = {}): BaseAssaultView {
  const group = new THREE.Group();
  group.name = 'base-assault';
  scene.add(group);
  const geo = {
    ball: ballGeometry(),
    seam: seamGeometry(),
    tape: tapeGeometry(Math.PI * 1.85, 0.05),
    tape2: tapeGeometry(Math.PI * 1.4, 0.038),
    beacon: new THREE.CylinderGeometry(0.07, 0.07, BEACON_H, 6, 1, true),
    diamond: new THREE.OctahedronGeometry(0.45, 0),
    halo: new THREE.TorusGeometry(0.55, 0.035, 4, 24),
    stand: standGeometry(),
  };
  geo.beacon.translate(0, BEACON_H / 2 + R + 0.35, 0);
  geo.diamond.scale(0.8, 1.3, 0.8);
  geo.diamond.translate(0, BEACON_H + R + 0.9, 0);
  geo.halo.rotateX(Math.PI / 2);
  const mats = {
    felt: toon({ color: FELT, emissive: FELT, emissiveIntensity: 0.06, vertexColors: true, rough: 0.97, grime: 0.45, wear: 0.15, mud: 0.5, fade: 0.1 }),
    seam: toon({ color: SEAM, emissive: SEAM, emissiveIntensity: 0.12, rough: 0.8, grime: 0.3, wear: 0 }),
    tape: TEAM.map((c) => toon({ color: c, emissive: c, emissiveIntensity: 0.12, rough: 0.7, grime: 0.35, wear: 0.4 })),
    tapeTrim: TEAM_TRIM.map((c) => toon({ color: c, rough: 0.7, grime: 0.35, wear: 0.4 })),
    beacon: TEAM.map((c) => glow(c, 1.6)),
    diamond: TEAM.map((c) => glow(c, 2.4)),
    pallet: toon({ color: PALETTE.fenceWood, surface: 'wood' }),
    slats: toon({ color: PALETTE.fenceDark, surface: 'wood' }),
    can: toon({ color: PALETTE.khaki, surface: 'metal', metal: 0.35, wear: 0.75, grime: 0.5 }),
    lid: toon({ color: PALETTE.gunmetal, surface: 'metal' }),
    cup: toon({ color: PALETTE.steel, surface: 'metal', side: THREE.DoubleSide }),
    mast: toon({ color: PALETTE.gunmetal, surface: 'metal' }),
    pennant: TEAM.map((c) => toon({ color: c, emissive: c, emissiveIntensity: 0.2, surface: 'cloth', side: THREE.DoubleSide })),
    ring: TEAM.map((c) => toon({ color: c, emissive: c, emissiveIntensity: 0.55, rough: 0.6, grime: 0.2 })),
    ringDull: toon({ color: PALETTE.hullDark, rough: 0.9, grime: 0.5 }),
    ringRelief: glow(PALETTE.accentHot, 1.4),
  };
  const balls = new Map<number, BallView>();
  const stands = new Map<number, StandView>();
  const rings = new Map<number, RingView>();
  const ringGeos: THREE.BufferGeometry[] = [];
  const shown = new Map<number, THREE.Vector3>();
  let active = false;
  let clock = 0;
  let lastStates: ReadonlyMap<number, EntityState> | null = null;

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, name: string) => {
    const o = new THREE.Mesh(g, m);
    o.name = name;
    o.castShadow = false;
    o.receiveShadow = false;
    return o;
  };

  const makeBall = (s: EntityState): BallView => {
    const t = s.team === 1 ? 1 : 0;
    const root = new THREE.Group();
    root.name = `ba_ball_${t}`;
    const body = new THREE.Group();
    const felt = mesh(geo.ball, mats.felt, 'ba_felt');
    felt.castShadow = true;
    const seam = mesh(geo.seam, mats.seam, 'ba_seam');
    const tapeA = mesh(geo.tape, mats.tape[t], 'ba_tape');
    tapeA.rotation.set(Math.PI / 2 + 0.25, 0.1, 0.35);
    const tapeB = mesh(geo.tape2, t === 0 ? mats.tapeTrim[0] : mats.tape[1], 'ba_tape2');
    tapeB.rotation.set(0.35, Math.PI / 2 - 0.3, 2.2);
    body.add(felt, seam, tapeA, tapeB);
    const beacon = mesh(geo.beacon, mats.beacon[t], 'ba_beacon');
    const diamond = mesh(geo.diamond, mats.diamond[t], 'ba_diamond');
    const halo = mesh(geo.halo, mats.beacon[t], 'ba_halo');
    root.add(body, beacon, diamond, halo);
    group.add(root);
    return { root, body, beacon, diamond, halo, team: t, pop: 0, bounce: 0, spin: 0, state: -1, carrier: 0 };
  };

  const makeStand = (s: EntityState): StandView => {
    const t = s.team === 1 ? 1 : 0;
    const root = new THREE.Group();
    root.name = `ba_stand_${t}`;
    const g = geo.stand;
    root.add(
      mesh(g.pallet, mats.pallet, 'ba_pallet'), mesh(g.slats, mats.slats, 'ba_slats'), mesh(g.can, mats.can, 'ba_can'),
      mesh(g.lid, mats.lid, 'ba_lid'), mesh(g.handle, mats.lid, 'ba_handle'), mesh(g.tape, mats.tape[t], 'ba_can_tape'),
      mesh(g.cup, mats.cup, 'ba_cup'), mesh(g.mast, mats.mast, 'ba_mast'), mesh(g.pennant, mats.pennant[t], 'ba_pennant'),
    );
    for (const c of root.children) c.castShadow = true;
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = s.yaw;
    group.add(root);
    return { root };
  };

  const makeRing = (s: EntityState): RingView => {
    const t = s.team === 1 ? 1 : 0;
    const root = new THREE.Group();
    root.name = `ba_ring_${t}`;
    const tg = ringGeometry(s.x, s.y, s.z, BASE_ASSAULT.captureRadius, opts.heightAt);
    const cg = chevronGeometry(s.x, s.y, s.z, BASE_ASSAULT.captureRadius, opts.heightAt);
    ringGeos.push(tg, cg);
    const tube = mesh(tg, mats.ring[t], 'ba_ring');
    const chev = mesh(cg, mats.ring[t], 'ba_chevrons');
    root.add(tube, chev);
    root.position.set(s.x, s.y, s.z);
    group.add(root);
    return { root, tube, chev, key: `${s.x},${s.y},${s.z}`, look: '', x: s.x, z: s.z };
  };

  const back = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const carrierSpot = (c: EntityState, out: THREE.Vector3): THREE.Vector3 => {
    // high on the back, between the shoulder blades: behind the facing (yaw 0 faces -Z, so the back is +Z)
    const h = opts.heightOf?.(c.id) ?? 1.2;
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    return out.set(c.x + sy * 0.34, c.y + h * 0.64 + R * 0.3, c.z + cy * 0.34);
  };

  const view: BaseAssaultView = {
    group,
    get active() { return active; },
    sync(states, localId, dt) {
      void localId;
      lastStates = states;
      clock += dt;
      const seen = new Set<number>();
      for (const s of states.values()) {
        if (s.kind !== EntityKind.Prop) continue;
        if (s.seed === BA_STAND_SEED) {
          seen.add(s.id);
          if (!stands.has(s.id)) stands.set(s.id, makeStand(s));
        } else if (s.seed === BA_GOAL_SEED) {
          seen.add(s.id);
          let r = rings.get(s.id);
          if (!r) { r = makeRing(s); rings.set(s.id, r); }
          const t = s.team === 1 ? 1 : 0;
          const look = s.weapon === 1 ? 'relief' : (s.flags & EFlag.Busy) ? 'dull' : 'team';
          if (look !== r.look) {
            r.look = look;
            const m = look === 'relief' ? mats.ringRelief : look === 'dull' ? mats.ringDull : mats.ring[t];
            r.tube.material = m;
            r.chev.material = m;
          }
          // chevrons creep inward while open ("bring it here"); still while blocked
          const k = look === 'dull' ? 1 : 1 - 0.06 * (0.5 + 0.5 * Math.sin(clock * 4));
          r.chev.scale.set(k, 1, k);
        } else if (s.seed === BA_BALL_SEED) {
          seen.add(s.id);
          let b = balls.get(s.id);
          if (!b) { b = makeBall(s); balls.set(s.id, b); }
          const carrier = s.weapon === BallState.Carried ? states.get(s.ammo) : undefined;
          if (s.weapon !== b.state) {
            // squeak on every change of hands (taken, picked up, sent home); a dropped ball hops as it lands
            if (b.state >= 0) { if (s.weapon === BallState.Dropped) b.bounce = 0.7; else b.pop = 0.35; }
            b.state = s.weapon;
          }
          b.carrier = s.weapon === BallState.Carried ? s.ammo : 0;
          const p = b.root.position;
          if (carrier && !(carrier.flags & EFlag.Dead)) carrierSpot(carrier, p);
          else p.set(s.x, s.y, s.z);
          const away = s.weapon !== BallState.Home;
          b.pop = Math.max(0, b.pop - dt);
          b.bounce = Math.max(0, b.bounce - dt);
          b.spin += dt * (s.weapon === BallState.Home ? 0.6 : s.weapon === BallState.Dropped ? 1.5 : 0);
          // dropped: a hop that settles; in water it bobs (the authority floats it on the surface)
          if (s.weapon === BallState.Dropped) p.y += Math.abs(Math.sin(b.bounce * 9)) * b.bounce * 0.7 + Math.sin(clock * 2.2 + b.team) * 0.02;
          const q = b.pop > 0 ? Math.sin((b.pop / 0.35) * Math.PI) : 0; // squeak: squash, then stretch back
          b.body.scale.set(1 + 0.22 * q, 1 - 0.3 * q, 1 + 0.22 * q);
          if (carrier) b.body.rotation.set(0.3, (carrier.yaw ?? 0) + 0.4, 0);
          else b.body.rotation.set(0.25, b.spin, 0);
          b.beacon.visible = away;
          b.diamond.visible = away;
          b.halo.visible = s.weapon === BallState.Dropped;
          if (away) {
            const pulse = s.weapon === BallState.Dropped ? 0.75 + 0.25 * Math.sin(clock * 6) : 1;
            // at least ~3 px wide on a 720 p screen: the base radius (0.07 m) up close, wider with distance
            const d = opts.camera ? opts.camera.getWorldPosition(camPos).distanceTo(p) : 0;
            const wide = Math.max(1, (d * 0.0024) / 0.07);
            b.beacon.scale.set(pulse * wide, 1, pulse * wide);
            b.diamond.scale.setScalar(Math.max(1, (d * 0.012) / 0.45));
            b.diamond.rotation.y = clock * 1.8;
            b.halo.scale.setScalar(1 + 0.25 * Math.sin(clock * 5));
          }
          let sp = shown.get(b.team);
          if (!sp) { sp = new THREE.Vector3(); shown.set(b.team, sp); }
          sp.copy(p);
        }
      }
      for (const [id, b] of balls) if (!seen.has(id)) { group.remove(b.root); balls.delete(id); shown.delete(b.team); }
      for (const [id, s] of stands) if (!seen.has(id)) { group.remove(s.root); stands.delete(id); }
      for (const [id, r] of rings) if (!seen.has(id)) { group.remove(r.root); rings.delete(id); }
      active = balls.size + stands.size + rings.size > 0;
      group.visible = active;
    },
    onGameEvent(ev) {
      // a steal squeaks at once, before the snapshot that moves the ball reaches the interpolated states
      if (ev.e !== 'pickup' || ev.item !== BA_PICKUP_ITEM) return;
      const c = lastStates?.get(ev.id);
      if (!c) return;
      for (const b of balls.values()) if (b.state !== BallState.Carried && b.root.position.distanceTo(back.set(c.x, c.y + 0.6, c.z)) < 3) b.pop = 0.35;
    },
    stats() {
      let drawCalls = 0, triangles = 0;
      group.traverseVisible((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        drawCalls++;
        const g = m.geometry;
        triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
      });
      return { drawCalls, triangles, balls: balls.size, stands: stands.size, rings: rings.size };
    },
    ballPosition(team) {
      return shown.get(team) ?? null;
    },
    dispose() {
      scene.remove(group);
      geo.ball.dispose(); geo.seam.dispose(); geo.tape.dispose(); geo.tape2.dispose(); geo.beacon.dispose(); geo.diamond.dispose(); geo.halo.dispose();
      for (const g of Object.values(geo.stand)) g.dispose();
      for (const g of ringGeos) g.dispose();
      balls.clear(); stands.clear(); rings.clear(); shown.clear();
    },
  };
  return view;
}
