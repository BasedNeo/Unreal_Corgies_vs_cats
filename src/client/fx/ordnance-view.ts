// W9 X4 (arms-2): the throwables on screen, from snapshots only (the authority throws; nothing here is predicted).
//   · the thrown ones: a battered rubber Squeaker Grenade (hazard-ochre ribbed rubber, gunmetal cap, a spoon and pin,
//     a wrap of team tape) and a wet, taped Hairball Bomb (a lumpy fur mass in two tapes of team colour, a brass clip,
//     a wick). Instanced per faction and team (≤ 4 draws), tumbling in flight, lifted by their radius so they sit on
//     the ground; materials from the style factory (nothing is inked).
//   · the fuse telegraph, readable by the TARGET: a cap light (squeaker) or a spitting wick (hairball) blinking faster
//     as the fuse runs down (EntityState.ammo = fuse ticks left), a tick sound per blink (cue), and in the last
//     ORDNANCE_RULES.telegraph seconds a danger ring on the ground at the blast radius.
//   · the arc preview (the local player holding Throw): dots along the SAME arc the authority flies (throwLaunch +
//     clampLaunch + predictArc over the arc world), a small ring where it first lands and the blast-radius ring where
//     it will go off after its bounces.
//   · faction FX on the X3 pools recipes (presets-ordnance.ts: trail, bounce, fuse spark, the blast's faction layer —
//     the generic explosion comes from fx/index.ts) in its own two particle draws, and presentation cues for audio
//     (throw / bounce / tick / blast; one reused object, see createOrdnanceAudio()).
// Allocation-free per frame after warm-up (tracks are pooled; the preview writes into preallocated buffers).
import * as THREE from 'three/webgpu';
import type { EntityState, GameEvent } from '../../shared/protocol';
import { EFlag, EntityKind, Species, Team, type SpeciesId } from '../../shared/types';
import { TICK_HZ } from '../../shared/constants';
import type { WorldData } from '../../shared/world/world-data';
import {
  FUSE_TICKS, ORDNANCE_BLAST, ORDNANCE_RULES, arcGround, arcWorldOf, clampLaunch, makeArcResult, makeLaunch, ordnanceByWire,
  ordnanceFor, predictArc, throwLaunch, type ArcWorld,
} from '../../shared/content/ordnance';
import { PALETTE } from '../style/style-tokens.js';
import { glow, toon } from '../style/style-webgpu.js';
import { PartBuilder, at, ball, cone, cyl, rbox, torus } from '../vehicles/parts';
import { FxRng, ParticlePool } from './particle-pool';
import { createParticleMesh, type ParticleMesh } from './particle-mesh';
import type { FxPools } from './presets';
import * as O from './presets-ordnance';

/** A presentation cue for audio (one object, reused: read it inside the callback). */
export interface OrdnanceCue {
  type: 'throw' | 'bounce' | 'tick' | 'blast';
  /** 0 = squeaker grenade (corgis), 1 = hairball bomb (cats). */
  kind: 0 | 1;
  x: number; y: number; z: number;
  /** bounce: impact 0..1 · tick: urgency 0..1 (fuse running out) · blast: radius scale. */
  k: number;
  /** Thrown by the local player. */
  local: boolean;
}

/** The local player's throw aim (feed it from input: Btn.Throw held + the view angles sent with it). */
export interface OrdnanceAim { holding: boolean; yaw: number; pitch: number }

export interface OrdnanceViewOptions {
  /** The world the preview arc flies over (the same WorldData the sim built). */
  world: WorldData;
  onCue?: (c: OrdnanceCue) => void;
  quality?: 'low' | 'medium' | 'high';
  seed?: number;
}

export interface OrdnanceViewStats { live: number; dots: number; rings: number; particles: number; drawCalls: number; cpuMs: number }

export interface OrdnanceView {
  readonly group: THREE.Group;
  readonly stats: OrdnanceViewStats;
  /** Each frame after net.interpolated(): states, the local entity id and its throw aim (null = not aiming). */
  update(dt: number, states: ReadonlyMap<number, EntityState>, localId: number, aim: OrdnanceAim | null): void;
  onGameEvent(ev: GameEvent): void;
  /** The local player released Throw while carrying: play the throw now (the snapshot's copy is then skipped). */
  localThrow(species: SpeciesId, x: number, y: number, z: number): void;
  setQuality(q: 'low' | 'medium' | 'high'): void;
  dispose(): void;
}

// ------------------------------------------------------------------------------------------------ models

const RADIUS = 0.12;
/** Where the blink light sits in each model's frame (squeaker: on the cap; hairball: the wick's tip). */
const LIGHT_AT: [number, number, number][] = [[0, 0.165, 0], [0.05, 0.155, 0.02]];
const tapeOf = (team: number) => (team === Team.Cats ? PALETTE.teamCats : PALETTE.teamCorgis);

/** Squeaker Grenade: a ribbed rubber squeak toy with a gunmetal cap, a spoon, a pin ring and a wrap of team tape. */
export function buildSqueaker(team: number): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.add(ball(0.105, 12, 9), at(0, 0, 0, 0, 0, 0, 1, 1.12, 1), PALETTE.hazardOchre, false);
  for (const y of [-0.055, 0.0, 0.055]) b.add(torus(0.1 - Math.abs(y) * 0.45, 0.013, 4, 14), at(0, y, 0, Math.PI / 2), PALETTE.ochreWorn, false);
  b.add(torus(0.108, 0.016, 4, 16), at(0, 0.028, 0, Math.PI / 2 + 0.28, 0, 0.1), tapeOf(team), false); // team tape, wrapped askew
  b.add(cyl(0.042, 0.05, 0.045, 10), at(0, 0.128, 0), PALETTE.gunmetal, true); // cap
  b.add(cone(0.02, 0.03, 6), at(0, 0.155, 0), PALETTE.camoBlack, false); // the squeaker reed
  b.add(rbox(0.018, 0.15, 0.034, 0.006, 1), at(0.052, 0.07, 0, 0, 0, -0.32), PALETTE.steel, true); // spoon
  b.add(torus(0.026, 0.005, 3, 10), at(-0.055, 0.132, 0, 0, Math.PI / 2), PALETTE.steel, false); // pin ring
  return b.build().geometry;
}

/** Hairball Bomb: a wet lumpy fur mass, two strips of team tape across it, a brass clip and a stubby wick. */
export function buildHairball(team: number): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.add(new THREE.IcosahedronGeometry(0.1, 1), at(0, 0, 0, 0.3, 0.5, 0), PALETTE.catGrey, false);
  // a matted mix of coats: grey, cream, ginger, a dark clump — light enough to read on wet mud at dusk
  const lumps: [number, number, number, number, number][] = [
    [0.06, 0.04, 0.02, 0.055, PALETTE.catCream], [-0.05, 0.05, -0.03, 0.05, PALETTE.catGrey], [0.02, -0.06, 0.05, 0.05, PALETTE.charcoal],
    [-0.04, -0.03, 0.06, 0.045, PALETTE.catGinger], [0.03, 0.01, -0.07, 0.05, PALETTE.catWhite], [-0.07, -0.01, 0.0, 0.045, PALETTE.catGrey],
  ];
  for (const [x, y, z, r, c] of lumps) b.add(ball(r, 7, 5), at(x, y, z), c, false);
  b.add(torus(0.106, 0.015, 3, 14), at(0, 0, 0, Math.PI / 2, 0, 0.35), tapeOf(team), false);
  b.add(torus(0.104, 0.015, 3, 14), at(0, 0, 0, 0.3, 0, Math.PI / 2 + 0.2), tapeOf(team), false);
  b.add(rbox(0.05, 0.022, 0.03, 0.006, 1), at(0.045, 0.1, 0.02, 0, 0, -0.4), PALETTE.brass, true); // brass clip
  b.add(cyl(0.008, 0.01, 0.06, 5), at(0.05, 0.125, 0.02, 0, 0, -0.3), PALETTE.ink, false); // wick
  return b.build().geometry;
}

/**
 * The two body materials (style factory, cached). No mud band: the `fur`/`plastic` presets' mud splash sits around the
 * model's local y = 0, which on a 12 cm throwable is the whole body (it rendered mud-brown on mud: invisible).
 * The hairball is wet: low roughness for the sheen.
 */
export function ordnanceMaterials(): [THREE.Material, THREE.Material] {
  return [
    toon({ color: 0xffffff, vertexColors: true, surface: 'plastic', mud: 0, grime: 0.25 }),
    toon({ color: 0xffffff, vertexColors: true, surface: 'plastic', rough: 0.3, mud: 0, grime: 0.2, wear: 0 }),
  ];
}

// ------------------------------------------------------------------------------------------------ view

interface Track {
  id: number; kind: 0 | 1; team: number; owner: number;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  fuse: number; grounded: boolean;
  lastVy: number; lastSpeed: number; bounceAt: number; trailAcc: number; blinkAcc: number; blinkOn: number;
  rotX: number; rotZ: number; seen: number; blasted: boolean; local: boolean;
}

const CAP = 24;
const DOTS = 64;

export function createOrdnanceView(scene: THREE.Object3D, opts: OrdnanceViewOptions): OrdnanceView {
  const aw: ArcWorld = arcWorldOf(opts.world);
  const group = new THREE.Group();
  group.name = 'ordnance';
  // bodies: [squeaker blue, squeaker red, hairball blue, hairball red]
  const bodyGeos = [buildSqueaker(0), buildSqueaker(1), buildHairball(0), buildHairball(1)];
  const [rubber, fur] = ordnanceMaterials();
  const bodies = bodyGeos.map((g, i) => {
    const m = new THREE.InstancedMesh(g, i < 2 ? rubber : fur, CAP);
    m.name = `ordnance_body_${i}`; m.castShadow = true;
    return m;
  });
  const lightGeo = new THREE.IcosahedronGeometry(1, 1);
  const lights = new THREE.InstancedMesh(lightGeo, glow(PALETTE.laserRed, 3.2), CAP * 2);
  lights.name = 'ordnance_fuse_lights';
  const ringGeo = new THREE.RingGeometry(0.93, 1, 48, 1).rotateX(-Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringGeo, glow(PALETTE.danger, 1.6), CAP * 2);
  rings.name = 'ordnance_warning_rings';
  const dotGeo = new THREE.IcosahedronGeometry(1, 1);
  const dots = new THREE.InstancedMesh(dotGeo, glow(0xfff4dc, 1.5), DOTS);
  dots.name = 'ordnance_arc_dots';
  const landGeo = new THREE.RingGeometry(0.7, 1, 32, 1).rotateX(-Math.PI / 2);
  const landRing = new THREE.Mesh(landGeo, glow(PALETTE.accentHot, 1.8));
  landRing.name = 'ordnance_arc_land';
  const blastRing = new THREE.Mesh(ringGeo, glow(PALETTE.accentHot, 1.1));
  blastRing.name = 'ordnance_arc_blast';
  const instanced = [...bodies, lights, rings, dots];
  for (const m of instanced) { m.count = 0; m.frustumCulled = false; group.add(m); }
  for (const m of [landRing, blastRing]) { m.visible = false; m.frustumCulled = false; group.add(m); }
  // own particle pools (2 draws while anything lives), X3 recipes
  const solidPool = new ParticlePool(384), glowPool = new ParticlePool(256);
  solidPool.freshFirstFrame = glowPool.freshFirstFrame = true;
  const solidMesh: ParticleMesh = createParticleMesh(solidPool.capacity, 'solid');
  const glowMesh: ParticleMesh = createParticleMesh(glowPool.capacity, 'glow');
  group.add(solidMesh.mesh, glowMesh.mesh);
  const DENSITY = { low: 0.45, medium: 0.75, high: 1 };
  const pools: FxPools = { solid: solidPool, glow: glowPool, rng: new FxRng(opts.seed ?? 0x0d0d), density: DENSITY[opts.quality ?? 'high'] };
  scene.add(group);

  const tracks = new Map<number, Track>();
  const free: Track[] = [];
  const live: Track[] = [];
  const cue: OrdnanceCue = { type: 'throw', kind: 0, x: 0, y: 0, z: 0, k: 0, local: false };
  const emit = (type: OrdnanceCue['type'], t: { kind: 0 | 1; x: number; y: number; z: number; local: boolean }, k: number) => {
    if (!opts.onCue) return;
    cue.type = type; cue.kind = t.kind; cue.x = t.x; cue.y = t.y; cue.z = t.z; cue.k = k; cue.local = t.local;
    opts.onCue(cue);
  };
  const stats: OrdnanceViewStats = { live: 0, dots: 0, rings: 0, particles: 0, drawCalls: 0, cpuMs: 0 };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), lp = new THREE.Vector3();
  const L = makeLaunch(), arc = makeArcResult(), pts = new Float32Array(DOTS * 3);
  const up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();
  let clock = 0, frame = 0, localThrowAt = -1e9;

  const newTrack = (s: EntityState, kind: 0 | 1, localId: number): Track => {
    const t = free.pop() ?? {
      id: 0, kind: 0, team: 0, owner: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0, grounded: false,
      lastVy: 0, lastSpeed: 0, bounceAt: 0, trailAcc: 0, blinkAcc: 0, blinkOn: 0, rotX: 0, rotZ: 0, seen: 0, blasted: false, local: false,
    } as Track;
    t.id = s.id; t.kind = kind; t.team = s.team; t.owner = s.seed; t.local = s.seed === localId;
    t.x = s.x; t.y = s.y; t.z = s.z; t.vx = s.vx; t.vy = s.vy; t.vz = s.vz; t.fuse = s.ammo; t.grounded = false;
    t.lastVy = s.vy; t.lastSpeed = Math.hypot(s.vx, s.vy, s.vz); t.bounceAt = -1; t.trailAcc = 0; t.blinkAcc = 0; t.blinkOn = 0;
    t.rotX = (s.id * 1.7) % 6.28; t.rotZ = (s.id * 0.9) % 6.28; t.blasted = false;
    tracks.set(s.id, t);
    // the throw: the pin's ping and the whoosh (the local thrower already heard it on release)
    if (!(t.local && clock - localThrowAt < 0.8)) emit('throw', t, 0);
    return t;
  };

  let fLocal = -1, fDt = 0;
  /** One snapshot entity per call (bound once: no per-frame closures). */
  const visit = (s: EntityState): void => {
    const localId = fLocal, dt = fDt;
    if (s.kind !== EntityKind.Projectile) return;
    const def = ordnanceByWire(s.weapon);
    if (!def) return;
    const kind: 0 | 1 = def.species === Species.Cat ? 1 : 0;
    const t = tracks.get(s.id) ?? newTrack(s, kind, localId);
    t.seen = frame;
    t.x = s.x; t.y = s.y; t.z = s.z; t.vx = s.vx; t.vy = s.vy; t.vz = s.vz; t.fuse = s.ammo;
    t.grounded = (s.flags & EFlag.Grounded) !== 0;
    if (t.blasted) return;
    const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
    // a bounce: the fall reverses (or dies) / the speed drops hard at once
    if (clock - t.bounceAt > 0.1 && ((t.lastVy < -1.5 && s.vy > t.lastVy + 1.2) || (t.lastSpeed > 3 && sp < t.lastSpeed * 0.6))) {
      t.bounceAt = clock;
      const k = Math.min(1, Math.max(-t.lastVy, t.lastSpeed * 0.5) / 12);
      O.ordBounce(pools, t.kind, s.x, s.y, s.z, k, arcGround(aw, s.x, s.z));
      emit('bounce', t, k);
    }
    t.lastVy = s.vy; t.lastSpeed = sp;
    // tumbling in flight (about the horizontal axis across the motion), settling when it rests
    if (!t.grounded) { t.rotX += sp * dt * 3.2; t.rotZ += sp * dt * 1.1; }
    if (sp > 2) {
      t.trailAcc += dt;
      if (t.trailAcc >= 0.045) { t.trailAcc = 0; O.ordTrail(pools, t.kind, s.x, s.y + RADIUS, s.z, s.vx, s.vy, s.vz); }
    }
    // the fuse telegraph: blinks from every 0.45 s down to every 0.07 s
    const left = Math.max(0, t.fuse) / FUSE_TICKS;
    const period = 0.07 + 0.38 * left;
    t.blinkAcc += dt;
    if (t.blinkOn > 0) t.blinkOn -= dt;
    if (t.blinkAcc >= period) {
      t.blinkAcc = 0; t.blinkOn = Math.min(0.06, period * 0.5);
      const urgency = 1 - left;
      O.ordFuse(pools, t.kind, s.x + LIGHT_AT[t.kind][0], s.y + RADIUS + LIGHT_AT[t.kind][1], s.z + LIGHT_AT[t.kind][2], urgency);
      emit('tick', t, urgency);
    }
  };
  const sweep = (t: Track): void => {
    if (t.seen !== frame) { tracks.delete(t.id); free.push(t); } else if (!t.blasted) live.push(t);
  };

  const view: OrdnanceView = {
    group,
    stats,
    update(dt, states, localId, aim) {
      const t0 = performance.now();
      clock += dt; frame++;
      // ---- tracks from the snapshot entities
      fLocal = localId; fDt = dt;
      states.forEach(visit);
      // ---- forget the ones that left the snapshot (blasted, fizzled, out of range)
      live.length = 0;
      tracks.forEach(sweep);
      // ---- instances
      let nb0 = 0, nb1 = 0, nb2 = 0, nb3 = 0, nl = 0, nr = 0;
      const R = ORDNANCE_BLAST.explodeRadius;
      const tele = ORDNANCE_RULES.telegraph * TICK_HZ;
      for (let i = 0; i < live.length; i++) {
        const t = live[i];
        const slot = t.kind * 2 + (t.team === Team.Cats ? 1 : 0);
        const mesh = bodies[slot];
        const idx = slot === 0 ? nb0++ : slot === 1 ? nb1++ : slot === 2 ? nb2++ : nb3++;
        if (idx >= CAP) continue;
        // resting: the squeaker settles upright-ish, the hairball sits wherever it squashed
        const rx = t.grounded && t.kind === 0 ? 0.15 : t.rotX, rz = t.grounded && t.kind === 0 ? 0.1 : t.rotZ;
        e3.set(rx, t.id * 0.61, rz, 'YXZ');
        q.setFromEuler(e3);
        pos.set(t.x, t.y + RADIUS * 0.92, t.z);
        scl.set(1, t.grounded && t.kind === 1 ? 0.82 : 1, 1); // a wet hairball slumps a little
        m4.compose(pos, q, scl);
        mesh.setMatrixAt(idx, m4);
        // the blink light, in the model's frame
        if (t.blinkOn > 0 && nl < CAP * 2) {
          const a = LIGHT_AT[t.kind];
          lp.set(a[0], a[1], a[2]).applyMatrix4(m4);
          const s = t.kind === 0 ? 0.048 : 0.04;
          m4.compose(lp, q.identity(), scl.set(s, s, s));
          lights.setMatrixAt(nl++, m4);
        }
        // the target's last warning: the blast radius on the ground, pulsing with the blink
        if (t.fuse <= tele && t.fuse > 0) {
          const gy = t.grounded ? t.y : arcGround(aw, t.x, t.z);
          const pulse = t.blinkOn > 0 ? 1 : 0.97;
          m4.compose(pos.set(t.x, gy + 0.06, t.z), q.identity(), scl.set(R * pulse, 1, R * pulse));
          rings.setMatrixAt(nr++, m4);
        }
      }
      bodies[0].count = Math.min(CAP, nb0); bodies[1].count = Math.min(CAP, nb1); bodies[2].count = Math.min(CAP, nb2); bodies[3].count = Math.min(CAP, nb3);
      lights.count = nl;
      // ---- the arc preview (local player holding Throw, alive, on foot, carrying)
      const me = states.get(localId);
      let nd = 0;
      landRing.visible = false; blastRing.visible = false;
      if (aim && aim.holding && me && (me.flags & EFlag.Ordnance) && !(me.flags & (EFlag.Dead | EFlag.Mounted | EFlag.Stunned))) {
        const sp = me.species as SpeciesId;
        throwLaunch(me.x, me.y, me.z, aim.yaw, aim.pitch, sp, L);
        clampLaunch(aw, me.x, me.y, me.z, sp, L);
        predictArc(aw, L, ordnanceFor(sp), arc, pts, 2);
        for (let i = 1; i < arc.n && nd < DOTS; i++) {
          // the flight dots, then smaller ones along the bounces
          const s = arc.landIdx > 0 && i >= arc.landIdx ? 0.026 : 0.042;
          m4.compose(pos.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]), q.identity(), scl.set(s, s, s));
          dots.setMatrixAt(nd++, m4);
        }
        if (arc.landed) {
          nrm.set(arc.lnx, arc.lny, arc.lnz);
          landRing.quaternion.setFromUnitVectors(up, nrm);
          landRing.position.set(arc.lx + arc.lnx * 0.04, arc.ly + arc.lny * 0.04, arc.lz + arc.lnz * 0.04);
          landRing.scale.setScalar(0.32);
          landRing.visible = true;
        }
        if (!arc.lost) {
          const gy = arc.resting ? arc.by : arcGround(aw, arc.bx, arc.bz);
          blastRing.position.set(arc.bx, Math.max(gy, arc.by - 1) + 0.05, arc.bz);
          blastRing.scale.set(R, 1, R);
          blastRing.visible = true;
        }
      }
      dots.count = nd;
      rings.count = nr;
      for (const m of instanced) if (m.count) m.instanceMatrix.needsUpdate = true;
      // ---- particles
      solidPool.update(dt);
      glowPool.update(dt);
      const ns = solidMesh.sync(solidPool), ng = glowMesh.sync(glowPool);
      stats.live = live.length; stats.dots = nd; stats.rings = nr; stats.particles = ns + ng;
      let draws = (ns ? 1 : 0) + (ng ? 1 : 0) + (landRing.visible ? 1 : 0) + (blastRing.visible ? 1 : 0);
      for (const m of instanced) if (m.count) draws++;
      stats.drawCalls = draws;
      stats.cpuMs = stats.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
    },

    onGameEvent(ev) {
      if (ev.e !== 'explode') return;
      // whose blast: the thrower's throwable nearest the blast point (the snapshot still shows it ~0.1 s behind)
      let best: Track | null = null, bd = 3.5 * 3.5;
      tracks.forEach((t) => {
        if (t.blasted || t.owner !== ev.by) return;
        const d = (t.x - ev.x) * (t.x - ev.x) + (t.y - ev.y) * (t.y - ev.y) + (t.z - ev.z) * (t.z - ev.z);
        if (d < bd) { bd = d; best = t; }
      });
      const t = best as Track | null;
      if (!t) return;
      t.blasted = true;
      O.ordBlast(pools, t.kind, t.team, ev.x, ev.y, ev.z, ev.r, arcGround(aw, ev.x, ev.z));
      cue.type = 'blast'; cue.kind = t.kind; cue.x = ev.x; cue.y = ev.y; cue.z = ev.z; cue.k = ev.r / 3.5; cue.local = t.local;
      opts.onCue?.(cue);
    },

    localThrow(species, x, y, z) {
      localThrowAt = clock;
      cue.type = 'throw'; cue.kind = species === Species.Cat ? 1 : 0; cue.x = x; cue.y = y; cue.z = z; cue.k = 0; cue.local = true;
      opts.onCue?.(cue);
    },

    setQuality(qq) { pools.density = DENSITY[qq] ?? 1; },

    dispose() {
      scene.remove(group);
      for (const g of bodyGeos) g.dispose();
      lightGeo.dispose(); ringGeo.dispose(); dotGeo.dispose(); landGeo.dispose();
      for (const m of instanced) m.dispose();
      solidMesh.dispose(); glowMesh.dispose();
      tracks.clear(); free.length = 0; live.length = 0;
    },
  };
  return view;
}
