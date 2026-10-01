// W13 TW-VIEW, headless: the slab read-out (engines/godot/game/slab.gd's twin: dim white neutral, team colour held,
// flashing amber contested; style-factory materials, two draws, draped on the ground) and the slab HUD model (hud.gd's
// twin: m:ss clock, OVERTIME, the slab line, the winner screen with the rematch prompt).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import type { EntityState, MatchState } from '../../src/shared/protocol';
import { Anim, EFlag, EntityKind, Team } from '../../src/shared/types';
import { SLAB, SLAB_TEXT, SLAB_ZONE_SEED } from '../../src/shared/content/modes';
import { PALETTE } from '../../src/client/style/style-tokens.js';
import {
  SLAB_CONTESTED, SLAB_NEUTRAL, buildFillGeometry, buildFrameGeometry, createSlabView, lighten, mixColor, readSlab, slabLook,
} from '../../src/client/modes/slab-view';
import {
  SLAB_CLICK_TO_PLAY, SLAB_CLOCK_COLOR, SLAB_HINT, SLAB_REMATCH, SLAB_TEAM_NAMES, slabAmmoText, slabClock, slabClockText, slabDownText, slabFeedText, slabFrac,
  slabHpColor, slabHudColor, slabLineFor, slabOvertime, slabShowDebug, slabStateText, slabWinner,
} from '../../src/client/ui/slab-hud';

function st(p: Partial<EntityState>): EntityState {
  return { id: 4, kind: EntityKind.Zone, team: Team.Neutral, species: 0, cls: -1, seed: SLAB_ZONE_SEED, x: 0, y: -0.0572, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 0, maxHp: 0, anim: Anim.Idle, flags: 0, weapon: 0, ammo: 0, ...p };
}
const map = (...s: EntityState[]) => new Map(s.map((x) => [x.id, x]));
const ms = (p: Partial<MatchState>): MatchState => ({ mode: 'slab', phase: 'live', timeLeft: 180, score: [0, 0], objective: SLAB_TEXT.hold, wave: 0, winner: -1, ...p });
const ground = (x: number, z: number) => -0.2 + 0.03 * x - 0.02 * z; // a tilted causeway

describe('slab read-out (3D)', () => {
  it('reads the slab Zone: neutral, held by a team alone, contested (Busy beats the team); nothing else', () => {
    expect(readSlab(new Map())).toBeNull();
    expect(readSlab(map(st({ seed: 1 })))).toBeNull(); // a core-rush pad B is not the slab
    expect(readSlab(map(st({ kind: EntityKind.Prop })))).toBeNull();
    expect(readSlab(map(st({})))).toMatchObject({ id: 4, x: 0, z: 0, holder: -1, contested: false });
    expect(readSlab(map(st({ team: Team.Cats })))!.holder).toBe(1);
    expect(readSlab(map(st({ team: Team.Corgis, flags: EFlag.Busy })))).toMatchObject({ holder: -1, contested: true });
  });

  it('colours as slab.gd: dim white neutral (fill 6 %), team colour lightened 0.2 held (14 %), amber to white contested', () => {
    expect(lighten(PALETTE.teamCorgis, 0.2)).toBe(0x598cde); // Godot Color("2f6fd6").lightened(0.2)
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(slabLook({ holder: -1, contested: false }, 0)).toMatchObject({ color: SLAB_NEUTRAL, fill: 0.06 });
    expect(slabLook({ holder: 0, contested: false }, 0)).toMatchObject({ color: lighten(PALETTE.teamCorgis, 0.2), fill: 0.14 });
    expect(slabLook({ holder: 1, contested: false }, 0)).toMatchObject({ color: lighten(PALETTE.teamCats, 0.2), fill: 0.14 });
    // contested: sin(t * 12) sweeps amber .. white; stepped, so the flash reuses a few cached materials
    const seen = new Set<number>();
    for (let t = 0; t < 1; t += 1 / 120) seen.add(slabLook({ holder: -1, contested: true }, t).color);
    expect(seen.has(SLAB_CONTESTED)).toBe(true);
    expect(seen.has(0xffffff)).toBe(true);
    expect(seen.size).toBeLessThanOrEqual(6);
    expect(slabLook({ holder: -1, contested: true }, 0.3).fill).toBe(0.14);
  });

  it('frame and fill drape over the ground: every fill vertex 3 cm over it, the frame never under it, covering 8 x 8 m', () => {
    const fill = buildFillGeometry(0, 0, 8, 8, ground);
    const p = fill.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(ground(p.getX(i), p.getZ(i)) + 0.03, 6);
    fill.computeBoundingBox();
    expect(fill.boundingBox!.min.x).toBeCloseTo(-4, 6);
    expect(fill.boundingBox!.max.z).toBeCloseTo(4, 6);
    const frame = buildFrameGeometry(0, 0, 8, 8, ground);
    frame.computeBoundingBox();
    expect(frame.boundingBox!.max.x).toBeGreaterThan(4); // the strips sit on the edge, half outside
    expect(frame.boundingBox!.max.x).toBeLessThan(4.2);
    const fp = frame.getAttribute('position');
    let tops = 0;
    for (let i = 0; i < fp.count; i++) {
      if (i % 4 === 1 || i % 4 === 2) { // the strip's top verts
        expect(fp.getY(i)).toBeGreaterThanOrEqual(ground(fp.getX(i), fp.getZ(i)) + 0.05 - 1e-6);
        tops++;
      }
    }
    expect(tops).toBeGreaterThan(40);
  });

  it('draws in two style-factory draws, swaps materials with the state, hides without a slab and leaves on dispose', () => {
    const scene = new THREE.Scene();
    const v = createSlabView(scene, { heightAt: ground, size: SLAB.size });
    v.sync(new Map(), 1 / 60);
    expect(v.active).toBe(false);
    v.sync(map(st({})), 1 / 60);
    expect(v.active).toBe(true);
    expect(v.stats().drawCalls).toBe(2);
    expect(v.stats().triangles).toBeLessThan(2000);
    const frame = scene.getObjectByName('slab_frame') as THREE.Mesh, fill = scene.getObjectByName('slab_fill') as THREE.Mesh;
    scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) expect(['glow', 'toon', 'toon-noink']).toContain(mat.userData.style);
    });
    expect((frame.material as THREE.Material).userData.style).toBe('glow');
    expect((fill.material as THREE.Material).transparent).toBe(true);
    expect((fill.material as THREE.Material).opacity).toBeCloseTo(0.06, 6);
    expect(v.color).toBe(SLAB_NEUTRAL);
    const neutral = frame.material;
    v.sync(map(st({ team: Team.Cats })), 1 / 60);
    expect(frame.material).not.toBe(neutral);
    expect(v.color).toBe(lighten(PALETTE.teamCats, 0.2));
    expect((fill.material as THREE.Material).opacity).toBeCloseTo(0.14, 6);
    // contested flashes: the frame's material changes over a quarter second
    const mats = new Set<THREE.Material>();
    for (let i = 0; i < 15; i++) { v.sync(map(st({ team: Team.Neutral, flags: EFlag.Busy })), 1 / 60); mats.add(frame.material as THREE.Material); }
    expect(mats.size).toBeGreaterThan(1);
    // the snapshot loses the slab (another mode): hidden
    v.sync(new Map(), 1 / 60);
    expect(v.active).toBe(false);
    expect(scene.getObjectByName('slab')!.visible).toBe(false);
    v.dispose();
    expect(scene.getObjectByName('slab')).toBeUndefined();
  });
});

describe('slab HUD model', () => {
  it('the clock: m:ss rounded up, red in the last 30 s, OVERTIME in overtime (and after an overtime end), warm-up if any', () => {
    expect(slabClockText(180)).toBe('3:00');
    expect(slabClockText(179.2)).toBe('3:00');
    expect(slabClockText(59.01)).toBe('1:00');
    expect(slabClockText(9)).toBe('0:09');
    expect(slabClockText(0)).toBe('0:00');
    expect(slabClock(ms({ timeLeft: 161 }))).toEqual({ text: '2:41', tone: '' });
    expect(slabClock(ms({ timeLeft: 30 }))).toEqual({ text: '0:30', tone: 'low' });
    expect(slabOvertime(ms({ objective: SLAB_TEXT.overtime, timeLeft: 42 }))).toBe(true);
    expect(slabClock(ms({ objective: SLAB_TEXT.overtime, timeLeft: 42 }))).toEqual({ text: 'OVERTIME', tone: 'ot' });
    const ended = ms({ phase: 'ended', objective: SLAB_TEXT.draw, timeLeft: 0 });
    expect(slabOvertime(ended)).toBe(false);
    expect(slabClock(ended, true)).toEqual({ text: 'OVERTIME', tone: 'ot' });
    expect(slabClock(ms({ phase: 'ended', objective: SLAB_TEXT.win[0], timeLeft: 71.4 }))).toEqual({ text: '1:12', tone: '' }); // frozen
    expect(slabClock(ms({ phase: 'warmup', timeLeft: 4 })).tone).toBe('warm');
  });

  it('the slab line and its colour (hud.gd slab_color)', () => {
    expect(slabStateText(null)).toBe('SLAB  NEUTRAL'); // hud.gd's spacing
    expect(slabStateText({ holder: -1, contested: false })).toBe('SLAB  NEUTRAL');
    expect(slabStateText({ holder: 0, contested: false })).toBe('SLAB  CORGI COMPANY HOLDING  +1/s');
    expect(slabStateText({ holder: 1, contested: false })).toBe('SLAB  CAT CADRE HOLDING  +1/s');
    expect(slabStateText({ holder: -1, contested: true })).toBe('SLAB  CONTESTED');
    expect(slabHudColor({ holder: -1, contested: true })).toBe(0xffa633);
    expect(slabHudColor({ holder: 1, contested: false })).toBe(lighten(PALETTE.teamCats, 0.35));
    expect(slabHudColor(null)).toBe(0xe6ebf2);
    expect(slabFrac(30, 60)).toBe(0.5);
    expect(slabFrac(75, 60)).toBe(1);
  });

  it('you, as hud.gd: hit points green above 40, "30 / 30" or RELOADING, the down countdown, the hint, clock colours', () => {
    expect(slabHpColor(120)).toBe(0x8ce673);
    expect(slabHpColor(40)).toBe(0xff664d);
    expect(slabAmmoText({ ammo: 17, flags: 0 })).toBe('17 / 30'); // the Squeaker Rifle's magazine
    expect(slabAmmoText({ ammo: 0, flags: EFlag.Reloading })).toBe('RELOADING');
    expect(slabDownText(2.44)).toBe('TAKEN DOWN  ·  back in 2.4');
    expect(slabDownText(-0.2)).toBe('TAKEN DOWN  ·  back in 0.0');
    expect(SLAB_HINT).toMatch(/Hold the slab alone to score/);
    expect(SLAB_HINT).not.toMatch(/\bQ\b|[Aa]bility/); // the slab kit has no ability
    expect([SLAB_CLOCK_COLOR[''], SLAB_CLOCK_COLOR.low, SLAB_CLOCK_COLOR.ot]).toEqual([0xffffff, 0xff7366, 0xff9933]);
    expect(slabFeedText('Rex', 'Cat 2')).toBe('Rex  >  Cat 2'); // match.gd _on_died
    expect(slabFeedText(null, 'Rex')).toBe('The Lot  >  Rex');
    expect(SLAB_CLICK_TO_PLAY).toBe('Click to play');
  });

  it('once the match is over the slab line goes: no frozen HOLDING +1/s claim behind the winner screen', () => {
    const held = { holder: 1 as const, contested: false };
    expect(slabLineFor({ phase: 'live' }, held)).toBe('SLAB  CAT CADRE HOLDING  +1/s');
    expect(slabLineFor({ phase: 'ended' }, held)).toBeNull();
    expect(slabLineFor({ phase: 'ended' }, { holder: -1, contested: true })).toBeNull();
    expect(slabLineFor({ phase: 'live' }, null)).toBe('SLAB  NEUTRAL');
  });

  it('the fps / rtt debug line: hidden in a slab match (Godot has none) unless ?debug; other modes keep it', () => {
    expect(slabShowDebug(true, '?mode=slab&autoplay')).toBe(false);
    expect(slabShowDebug(true, '?mode=slab&debug')).toBe(true);
    expect(slabShowDebug(false, '?mode=core-rush')).toBe(true);
  });

  it('the winner screen: <TEAM> WINS or DRAW, the score, your takedowns and knockouts, the rematch prompt', () => {
    expect(slabWinner(ms({}))).toBeNull();
    const me = { kills: 3, deaths: 2 };
    expect(slabWinner(ms({ phase: 'ended', winner: 1, score: [41, 60], objective: SLAB_TEXT.win[1] }), me)).toEqual({
      title: 'CAT CADRE WINS', team: 1, score: '41  –  60', you: 'You: 3 takedowns · 2 knockouts', prompt: 'R / Enter: rematch',
    });
    expect(slabWinner(ms({ phase: 'ended', winner: 0, score: [60, 12] }))!.title).toBe(`${SLAB_TEAM_NAMES[0]} WINS`);
    expect(slabWinner(ms({ phase: 'ended', winner: -1, score: [7, 7], objective: SLAB_TEXT.draw }))).toMatchObject({ title: 'DRAW', team: -1, you: '' });
    expect(SLAB_REMATCH).toBe('R / Enter: rematch');
  });
});
