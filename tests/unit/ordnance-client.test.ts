// W9 X4 client, headless: the throwable models (style-factory materials only, inside a small triangle budget), the view
// from snapshot states (instances per faction/team, bounces heard once per bounce, the fuse blinking faster, the blast
// matched to its throwable and its FX + cues, the warning ring in the last 0.8 s), the arc preview (the same dots
// predictArc computes; only for a local player carrying one), per-frame allocations, the HUD model (restock countdown,
// KIOSK, dead, hidden without throwables) and the audio (every recipe schedules on a strict Web Audio stand-in; cues map
// to the right voices, a local throw is 2D).
import { describe, it, expect } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import type { EntityState, GameEvent } from '../../src/shared/protocol';
import { Anim, EFlag, EntityKind, Species, Team } from '../../src/shared/types';
import { createWorldData } from '../../src/shared/world/world-data';
import {
  FUSE_TICKS, ORDNANCE_RULES, arcWorldOf, clampLaunch, makeArcResult, makeLaunch, ordnanceFor, ordnanceWire, predictArc, throwLaunch,
} from '../../src/shared/content/ordnance';
import { buildHairball, buildSqueaker, createOrdnanceView, type OrdnanceCue } from '../../src/client/fx/ordnance-view';
import { OrdnanceHudModel } from '../../src/client/ui/ordnance-hud';
import { ORDNANCE_SFX, createOrdnanceAudio } from '../../src/client/audio/presets-ordnance';
import type { Voice } from '../../src/client/audio/synth';
import type { AudioEngine } from '../../src/client/audio/engine';
import { fakeCtx } from './audio-fakes';

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;
const heapAfterGc = () => { gc(); gc(); return process.memoryUsage().heapUsed; };

const world = createWorldData(1, 'west_yard');
const SP = world.spawns[0];
function ent(p: Partial<EntityState>): EntityState {
  return { id: 1, kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls: 0, seed: 1, x: SP.x, y: SP.y, z: SP.z, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 120, maxHp: 120, anim: Anim.Idle, flags: EFlag.Grounded, weapon: 0, ammo: 30, ...p };
}
const grenade = (id: number, owner: number, cat: boolean, p: Partial<EntityState> = {}) => ent({
  id, kind: EntityKind.Projectile, team: cat ? Team.Cats : Team.Corgis, species: cat ? Species.Cat : Species.Corgi, cls: -1, seed: owner,
  weapon: ordnanceWire(cat ? 'hairball_bomb' : 'squeaker_grenade'), ammo: FUSE_TICKS, flags: 0, hp: 0, maxHp: 0, ...p,
});
function tris(g: THREE.BufferGeometry): number { return (g.index ? g.index.count : g.getAttribute('position').count) / 3; }

describe('X4 client: models + view', () => {
  it('models: small, merged (one draw each), vertex-coloured, the team tape differs', () => {
    for (const build of [buildSqueaker, buildHairball]) {
      const a = build(0), b = build(1);
      expect(tris(a)).toBeLessThan(900);
      expect(tris(a)).toBe(tris(b));
      expect(a.getAttribute('color')).toBeDefined();
      expect(Array.from(a.getAttribute('color').array)).not.toEqual(Array.from(b.getAttribute('color').array));
      a.computeBoundingSphere();
      expect(a.boundingSphere!.radius).toBeLessThan(0.22); // pet-scale: about a tennis ball
    }
  });

  it('draws both factions per team from snapshots with style-factory materials only, in a few draws', () => {
    const scene = new THREE.Scene();
    const v = createOrdnanceView(scene, { world });
    const states = new Map<number, EntityState>([
      [1, ent({ id: 1 })],
      [50, grenade(50, 1, false, { y: SP.y + 2, vx: 4, vy: 3 })],
      [51, grenade(51, 7, true, { x: SP.x + 3, y: SP.y + 1.5, vx: -3, vy: 2 })],
      [52, grenade(52, 8, false, { team: Team.Cats, x: SP.x - 3, y: SP.y + 1 })], // a corgi on the cat team: its tape is red
      [60, ent({ id: 60, kind: EntityKind.Projectile, weapon: 3, seed: 1 })], // a mortar ball: not ours
    ]);
    v.update(1 / 60, states, 1, null);
    expect(v.stats.live).toBe(3);
    const body = (i: number) => scene.getObjectByName(`ordnance_body_${i}`) as THREE.InstancedMesh;
    expect([body(0).count, body(1).count, body(2).count, body(3).count]).toEqual([1, 1, 0, 1]);
    expect(v.stats.drawCalls).toBeLessThanOrEqual(8);
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) expect(['toon', 'glow', 'fx']).toContain(m.userData.style);
    });
    v.dispose();
    expect(scene.getObjectByName('ordnance')).toBeUndefined();
  });

  it('bounces are heard once each, the fuse blinks faster as it runs down, the last 0.8 s show the danger ring', () => {
    const scene = new THREE.Scene();
    const cues: string[] = [];
    const tickAt: number[] = [];
    let t = 0;
    const v = createOrdnanceView(scene, { world, onCue: (c) => { cues.push(c.type); if (c.type === 'tick') tickAt.push(t); } });
    const g = grenade(50, 9, false, { y: SP.y + 1, vx: 5, vy: -6 });
    const states = new Map<number, EntityState>([[50, g]]);
    // falling, bounce (vy flips), falling, bounce, then resting until the fuse is nearly out
    const seq: [number, number][] = [[-6, 5], [-7, 5], [3, 3], [2, 3], [-2, 2.5], [-3, 2.5], [1, 1.5], [0, 0], [0, 0]];
    for (const [vy, vx] of seq) { g.vy = vy; g.vx = vx; v.update(1 / 30, states, 1, null); t += 1 / 30; }
    expect(cues.filter((c) => c === 'bounce').length).toBe(2);
    expect(cues[0]).toBe('throw');
    g.flags = EFlag.Grounded; g.vx = g.vy = 0;
    for (let f = 0; f < FUSE_TICKS; f++) { g.ammo = FUSE_TICKS - f; v.update(1 / 60, states, 1, null); t += 1 / 60; }
    const gaps = tickAt.slice(1).map((x, i) => x - tickAt[i]);
    expect(gaps[0]).toBeGreaterThan(gaps[gaps.length - 1] * 3); // it speeds up
    expect(tickAt.length).toBeGreaterThan(8);
    expect(v.stats.rings).toBe(1); // the last second: the blast radius on the ground
    v.dispose();
  });

  it('the blast is matched to its throwable (owner + place): faction FX, a blast cue, the body gone; other blasts ignored', () => {
    const scene = new THREE.Scene();
    const got: OrdnanceCue[] = [];
    const v = createOrdnanceView(scene, { world, onCue: (c) => got.push({ ...c }) });
    const states = new Map<number, EntityState>([[51, grenade(51, 7, true, { flags: EFlag.Grounded, ammo: 2 })]]);
    v.update(1 / 60, states, 1, null);
    const ev = (by: number, dx = 0): GameEvent => ({ e: 'explode', x: SP.x + dx, y: SP.y + 0.15, z: SP.z, r: 4, by });
    v.onGameEvent(ev(99)); // someone else's mortar
    v.onGameEvent(ev(7, 20)); // the thrower's, far away (another weapon)
    expect(got.filter((c) => c.type === 'blast').length).toBe(0);
    v.onGameEvent(ev(7));
    const b = got.filter((c) => c.type === 'blast');
    expect(b.length).toBe(1);
    expect(b[0].kind).toBe(1);
    v.update(1 / 60, states, 1, null); // the snapshot still carries it for ~0.1 s: hidden already
    expect((scene.getObjectByName('ordnance_body_3') as THREE.InstancedMesh).count).toBe(0);
    expect(v.stats.particles).toBeGreaterThan(20);
    v.dispose();
  });

  it('the preview draws the same arc the authority flies, only while the local player holds Throw carrying one', () => {
    const scene = new THREE.Scene();
    const v = createOrdnanceView(scene, { world });
    const me = ent({ id: 1, flags: EFlag.Grounded | EFlag.Ordnance });
    const states = new Map<number, EntityState>([[1, me]]);
    v.update(1 / 60, states, 1, { holding: false, yaw: 0.4, pitch: 0.2 });
    expect(v.stats.dots).toBe(0);
    v.update(1 / 60, states, 1, { holding: true, yaw: 0.4, pitch: 0.2 });
    expect(v.stats.dots).toBeGreaterThan(10);
    const land = scene.getObjectByName('ordnance_arc_land')!;
    expect(land.visible).toBe(true);
    const aw = arcWorldOf(world), L = makeLaunch(), arc = makeArcResult();
    throwLaunch(me.x, me.y, me.z, 0.4, 0.2, Species.Corgi, L);
    clampLaunch(aw, me.x, me.y, me.z, Species.Corgi, L);
    predictArc(aw, L, ordnanceFor(Species.Corgi), arc);
    expect(land.position.x).toBeCloseTo(arc.lx + arc.lnx * 0.04, 5);
    expect(land.position.z).toBeCloseTo(arc.lz + arc.lnz * 0.04, 5);
    const dots = scene.getObjectByName('ordnance_arc_dots') as THREE.InstancedMesh, m = new THREE.Matrix4(), p = new THREE.Vector3();
    dots.getMatrixAt(0, m); p.setFromMatrixPosition(m);
    expect(p.distanceTo(new THREE.Vector3(L.x, L.y, L.z))).toBeLessThan(2); // starts at the hand
    // not carrying / dead / in a vehicle: no preview
    for (const f of [EFlag.Grounded, EFlag.Grounded | EFlag.Ordnance | EFlag.Dead, EFlag.Ordnance | EFlag.Mounted]) {
      me.flags = f;
      v.update(1 / 60, states, 1, { holding: true, yaw: 0.4, pitch: 0.2 });
      expect(v.stats.dots).toBe(0);
      expect(land.visible).toBe(false);
    }
    v.dispose();
  });

  it('allocates nothing per frame after warm-up (8 throwables + the preview, 60 s at 60 fps)', () => {
    const scene = new THREE.Scene();
    let cues = 0;
    const v = createOrdnanceView(scene, { world, onCue: () => { cues++; } });
    const me = ent({ id: 1, flags: EFlag.Grounded | EFlag.Ordnance });
    const states = new Map<number, EntityState>([[1, me]]);
    const gs: EntityState[] = [];
    for (let i = 0; i < 8; i++) { const g = grenade(100 + i, 1 + (i % 3), i % 2 === 1, { x: SP.x + i, y: SP.y + 1 }); gs.push(g); states.set(g.id, g); }
    const aim = { holding: true, yaw: 0.4, pitch: 0.2 };
    let f = 0;
    const frame = () => {
      f++;
      for (let i = 0; i < gs.length; i++) {
        const g = gs[i];
        const ph = (f + i * 17) % FUSE_TICKS;
        g.ammo = FUSE_TICKS - ph; g.vy = ph % 40 < 20 ? -5 : 4; g.vx = 3; g.y = SP.y + 1 + (ph % 40) * 0.02;
        g.flags = ph > 100 ? EFlag.Grounded : 0;
      }
      aim.yaw = 0.4 + (f % 100) * 0.01;
      v.update(1 / 60, states, 1, aim);
    };
    for (let i = 0; i < 7200; i++) frame(); // warm-up: optimized code settles on the heap in the first ~2 minutes of frames
    const h0 = heapAfterGc();
    for (let i = 0; i < 3600; i++) frame();
    const grown = heapAfterGc() - h0;
    console.log(`[X4 view] 3600 frames: heap ${grown >= 0 ? '+' : ''}${grown} B, ${cues} cues, ${v.stats.drawCalls} draws, ${v.stats.cpuMs.toFixed(3)} ms/frame`);
    expect(grown).toBeLessThan(96 * 1024);
    expect(v.stats.drawCalls).toBeLessThanOrEqual(11);
    v.dispose();
  });
});

describe('X4 client: HUD model', () => {
  it('lit while carrying; after a throw it counts the kiosk restock down, then says KIOSK; a death is not a throw', () => {
    const m = new OrdnanceHudModel();
    const me = ent({ id: 1, flags: EFlag.Grounded });
    expect(m.update(me, 0).shown).toBe(false); // a mode without throwables: hidden
    me.flags |= EFlag.Ordnance;
    let s = m.update(me, 1);
    expect(s).toMatchObject({ shown: true, carrying: true, ready: false, restockLeft: 0, kind: 0 });
    me.flags &= ~EFlag.Ordnance; // thrown at t = 2
    s = m.update(me, 2);
    expect(s.carrying).toBe(false);
    expect(s.restockLeft).toBeCloseTo(ORDNANCE_RULES.restockCooldown, 6);
    s = m.update(me, 2 + ORDNANCE_RULES.restockCooldown - 5);
    expect(s.restockLeft).toBeCloseTo(5, 6);
    expect(s.ready).toBe(false);
    s = m.update(me, 2 + ORDNANCE_RULES.restockCooldown + 0.1);
    expect(s).toMatchObject({ ready: true, restockLeft: 0 });
    me.flags |= EFlag.Ordnance; // restocked at the kiosk
    expect(m.update(me, 30).ready).toBe(false);
    me.flags = EFlag.Dead; // died carrying: no restock clock, dimmed
    s = m.update(me, 31);
    expect(s).toMatchObject({ dead: true, carrying: false, ready: false, restockLeft: 0 });
    me.flags = EFlag.Grounded | EFlag.Ordnance; // respawned with one
    expect(m.update(me, 34).carrying).toBe(true);
    me.species = Species.Cat;
    expect(m.update(me, 35).kind).toBe(1);
  });
});

describe('X4 client: audio', () => {
  it('every ordnance recipe schedules cleanly on a strict Web Audio stand-in, for every k', () => {
    const f = fakeCtx();
    let seed = 1;
    const voice = (): Voice => ({ ctx: f.ctx, out: f.ctx.createGain(), t: 0.1, rand: () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; } });
    for (const [name, r] of Object.entries(ORDNANCE_SFX)) {
      for (const k of [0, 0.3, 1, 2]) {
        const d = r(voice(), k);
        expect(d, name).toBeGreaterThan(0);
        expect(d, name).toBeLessThan(1.5);
      }
    }
    expect(f.nodes.length).toBeGreaterThan(100);
  });

  it('cues play the faction voices: squeak vs wet thup, peep vs wick, squeak-pop vs splat over a concussive thump; a local throw is 2D', () => {
    const plays: { r: unknown; o: Record<string, unknown> }[] = [];
    const engine = { play: (r: unknown, o: Record<string, unknown> = {}) => { plays.push({ r, o: { ...o } }); return true; } } as unknown as AudioEngine;
    const a = createOrdnanceAudio(engine);
    const c: OrdnanceCue = { type: 'bounce', kind: 0, x: 1, y: 2, z: 3, k: 0.5, local: false };
    a.cue(c); expect(plays.pop()!.r).toBe(ORDNANCE_SFX.squeak);
    c.kind = 1; a.cue(c); expect(plays.pop()!.r).toBe(ORDNANCE_SFX.wetThup);
    c.type = 'tick'; a.cue(c); expect(plays.pop()!.r).toBe(ORDNANCE_SFX.wickCrackle);
    c.kind = 0; a.cue(c); expect(plays.pop()!.r).toBe(ORDNANCE_SFX.fusePeep);
    c.type = 'blast'; a.cue(c);
    expect(plays.slice(-2).map((p) => p.r)).toEqual([ORDNANCE_SFX.concussion, ORDNANCE_SFX.squeakPop]);
    expect(plays[plays.length - 2].o).toMatchObject({ x: 1, y: 2, z: 3, priority: 3 });
    c.kind = 1; a.cue(c);
    expect(plays.slice(-2).map((p) => p.r)).toEqual([ORDNANCE_SFX.concussion, ORDNANCE_SFX.wetSplat]);
    plays.length = 0;
    c.type = 'throw'; c.kind = 0; c.local = true; a.cue(c);
    expect(plays.map((p) => p.r)).toEqual([ORDNANCE_SFX.pinPing, ORDNANCE_SFX.throwWhoosh]);
    for (const p of plays) expect(p.o.x).toBeUndefined();
    expect(a.counts).toEqual({ throw: 1, bounce: 2, tick: 2, blast: 2 });
  });
});
