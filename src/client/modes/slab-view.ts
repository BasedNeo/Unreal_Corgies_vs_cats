// slab presentation, 3D (W13 TW-VIEW): the control slab's state read-out on The Lot, the web twin of
// engines/godot/game/slab.gd (Godot is the main build: when the two disagree, Godot wins). A thin glowing frame round
// the 8 x 8 m slab and a faint fill on it: dim white = neutral, the team colour = held, flashing amber = contested.
// Frame and fill drape over the ground under them (heightAt), so the read-out sits on the slab's real surface the way
// slab.gd's raycast probe does. Godot also hangs a coloured omni light over the slab; the web read-out leaves it out
// (every forward-lit material in view would pay for it) and lets the glow frame carry the colour.
//
// Reads the slab from the snapshot (match mode 'slab'; contract in src/shared/content/modes.ts): the one EntityKind.Zone
// entity (seed SLAB_ZONE_SEED = 0) at the slab centre, team = holder (Team.Neutral = 2: nobody), flags & Busy = contested. main.ts passes the
// states only while MatchState.mode is 'slab' (a core-rush pad is a seed-0 Zone too). Idle and invisible otherwise.
// W15: the reading also lists the living pets (players and bots) of the frame: the HUD keeps its slab marker off them
// and aims its received-hit wedges at them (slab-hud.ts), with no extra wiring.
// Materials only through the style factory: glow() for the frame, toon() for the fill. Two draws in all.
import * as THREE from 'three/webgpu';
import type { EntityState } from '../../shared/protocol';
import { EFlag, EntityKind } from '../../shared/types';
import { SLAB_ZONE_SEED } from '../../shared/content/modes';
import { glow, toon } from '../style/style-webgpu.js';
import { PALETTE } from '../style/style-tokens.js';

/** A living pet of the frame (feet position). */
export interface SlabPet { id: number; team: number; species: number; x: number; y: number; z: number }

/** The slab in one snapshot. */
export interface SlabReading {
  id: number;
  /** Slab centre on the ground (the Zone entity's position). */
  x: number; y: number; z: number;
  /** The team alone on the slab (0 corgis, 1 cats), or -1 (nobody, or contested). */
  holder: -1 | 0 | 1;
  /** Both teams on the slab: nobody scores. */
  contested: boolean;
  /** W15: every living player and bot of the frame (the HUD's marker dodges them; its wedges point at them). */
  pets: SlabPet[];
}

/** The slab of this snapshot: the EntityKind.Zone entity with seed SLAB_ZONE_SEED, or null (no slab match running). */
export function readSlab(states: ReadonlyMap<number, EntityState>): SlabReading | null {
  let zone: EntityState | null = null;
  const pets: SlabPet[] = [];
  for (const s of states.values()) {
    if (s.kind === EntityKind.Zone && s.seed === SLAB_ZONE_SEED) zone ??= s;
    else if ((s.kind === EntityKind.Player || s.kind === EntityKind.Bot) && (s.flags & EFlag.Dead) === 0) {
      pets.push({ id: s.id, team: s.team, species: s.species, x: s.x, y: s.y, z: s.z });
    }
  }
  if (!zone) return null;
  const contested = (zone.flags & EFlag.Busy) !== 0;
  const holder = !contested && (zone.team === 0 || zone.team === 1) ? zone.team : -1;
  return { id: zone.id, x: zone.x, y: zone.y, z: zone.z, holder, contested, pets };
}

// slab.gd's colours: NEUTRAL Color(0.8, 0.82, 0.86), CONTESTED Color(1.0, 0.62, 0.12), a held slab
// TEAM_COLORS[team].lightened(0.2) (tuning.gd TEAM_COLORS = PALETTE.teamCorgis / teamCats).
export const SLAB_NEUTRAL = 0xccd1db;
export const SLAB_CONTESTED = 0xff9e1f;
const WHITE = 0xffffff;
/** Contested flash rate (rad/s: slab.gd sin(_t * 12)) and the steps it is drawn in (one cached material per step). */
const FLASH_RATE = 12;
const FLASH_STEPS = 6;
/** Frame strip width (m, slab.gd w = 0.16) and height above the ground under it (m, its boxes are 0.05 tall). */
const FRAME_W = 0.16;
const FRAME_H = 0.05;
/** The fill floats this far above the ground (m, slab.gd's 0.03). */
const FILL_LIFT = 0.03;
/** The fill's self-light: slab.gd's fill is unshaded; a lit toon fill with a little emissive reads as faint as it. */
const FILL_EMISSIVE = 0.35;

/** Godot's Color.lerp on 0xRRGGBB. */
export function mixColor(a: number, b: number, k: number): number {
  const ch = (c: number, s: number) => (c >> s) & 255;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

/** Godot's Color.lightened(k): every channel k of the way to white. */
export const lighten = (c: number, k: number): number => mixColor(c, WHITE, k);

export const SLAB_TEAM: readonly [number, number] = [PALETTE.teamCorgis, PALETTE.teamCats];

/** slab.gd show_state(): the read-out colour, the fill's alpha and the light's energy (the glow's intensity here). */
export function slabLook(r: Pick<SlabReading, 'holder' | 'contested'>, t: number): { color: number; fill: number; energy: number; flash: number } {
  if (r.contested) {
    // stepped so the flash reuses a handful of cached style materials instead of one per frame
    const f = Math.round((0.5 + 0.5 * Math.sin(t * FLASH_RATE)) * (FLASH_STEPS - 1)) / (FLASH_STEPS - 1);
    return { color: mixColor(SLAB_CONTESTED, WHITE, f), fill: 0.14, energy: 1.6, flash: f };
  }
  if (r.holder !== -1) return { color: lighten(SLAB_TEAM[r.holder], 0.2), fill: 0.14, energy: 1.8, flash: 0 };
  return { color: SLAB_NEUTRAL, fill: 0.06, energy: 0.8, flash: 0 };
}

/** One quad strip along a slab edge, draped: [x, z] centre line from a to b, `w` across, top FRAME_H over the ground. */
function pushStrip(pos: number[], idx: number[], heightAt: (x: number, z: number) => number, a: [number, number], b: [number, number], w: number, segs: number): void {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len * (w / 2), nz = dx / len * (w / 2); // across the strip
  const base = pos.length / 3;
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    const cx = a[0] + dx * k, cz = a[1] + dz * k;
    // the strip's foot follows the higher ground under either edge (never buried), its top FRAME_H above that
    const g = Math.max(heightAt(cx - nx, cz - nz), heightAt(cx + nx, cz + nz), heightAt(cx, cz));
    const top = g + FRAME_H, bot = g - 0.03;
    // 4 verts per station: left-bottom, left-top, right-top, right-bottom
    pos.push(cx - nx, bot, cz - nz, cx - nx, top, cz - nz, cx + nx, top, cz + nz, cx + nx, bot, cz + nz);
  }
  for (let i = 0; i < segs; i++) {
    const p = base + i * 4, n = p + 4;
    // top (lt, rt; counter-clockwise from above), left side (lb, lt), right side (rt, rb) - the sides in both winding
    // orders so either face shows
    idx.push(p + 1, p + 2, n + 1, p + 2, n + 2, n + 1);
    idx.push(p, n, p + 1, p + 1, n, n + 1, p, p + 1, n, p + 1, n + 1, n);
    idx.push(p + 2, n + 2, p + 3, p + 3, n + 2, n + 3, p + 2, p + 3, n + 2, p + 3, n + 3, n + 2);
  }
}

/** The slab frame (four draped strips, corners overlapped like slab.gd's boxes) in world space, one geometry. */
export function buildFrameGeometry(cx: number, cz: number, sx: number, sz: number, heightAt: (x: number, z: number) => number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const hx = sx / 2, hz = sz / 2, e = FRAME_W / 2;
  const segX = Math.max(2, Math.ceil(sx / 0.5)), segZ = Math.max(2, Math.ceil(sz / 0.5));
  pushStrip(pos, idx, heightAt, [cx - hx - e, cz - hz], [cx + hx + e, cz - hz], FRAME_W, segX);
  pushStrip(pos, idx, heightAt, [cx + hx + e, cz + hz], [cx - hx - e, cz + hz], FRAME_W, segX);
  pushStrip(pos, idx, heightAt, [cx - hx, cz + hz + e], [cx - hx, cz - hz - e], FRAME_W, segZ);
  pushStrip(pos, idx, heightAt, [cx + hx, cz - hz - e], [cx + hx, cz + hz + e], FRAME_W, segZ);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** The fill: a grid over the slab, FILL_LIFT above the ground under every vertex, facing up. */
export function buildFillGeometry(cx: number, cz: number, sx: number, sz: number, heightAt: (x: number, z: number) => number): THREE.BufferGeometry {
  const nx = Math.max(2, Math.ceil(sx / 0.5)), nz = Math.max(2, Math.ceil(sz / 0.5));
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = cx - sx / 2 + (sx * i) / nx, z = cz - sz / 2 + (sz * j) / nz;
      pos.push(x, heightAt(x, z) + FILL_LIFT, z);
      nor.push(0, 1, 0);
    }
  }
  const row = nx + 1;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d); // counter-clockwise seen from above (+y)
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export interface SlabViewOptions {
  /** Ground height under (x, z) (main.ts: the world's surface just above the slab). */
  heightAt: (x: number, z: number) => number;
  /** Slab footprint (m): SLAB.size from src/shared/content/modes.ts (8 x 8). */
  size: { x: number; z: number };
}

export interface SlabView {
  /** `states`: this frame's entities while the match is a slab match (else an empty map: the view hides). */
  sync(states: ReadonlyMap<number, EntityState>, dt: number): void;
  /** The slab this frame (null = no slab match). */
  readonly reading: SlabReading | null;
  readonly active: boolean;
  /** The read-out colour now (0xRRGGBB): the HUD's slab line and marker use it too. */
  readonly color: number;
  stats(): { drawCalls: number; triangles: number };
  dispose(): void;
}

export function createSlabView(scene: THREE.Scene, opts: SlabViewOptions): SlabView {
  const group = new THREE.Group();
  group.name = 'slab';
  group.visible = false;
  scene.add(group);
  let frame: THREE.Mesh | null = null, fill: THREE.Mesh | null = null;
  let built: { x: number; z: number } | null = null;
  let reading: SlabReading | null = null;
  let t = 0, color = SLAB_NEUTRAL, lookKey = '';

  const build = (r: SlabReading) => {
    if (frame) { group.remove(frame); frame.geometry.dispose(); }
    if (fill) { group.remove(fill); fill.geometry.dispose(); }
    frame = new THREE.Mesh(buildFrameGeometry(r.x, r.z, opts.size.x, opts.size.z, opts.heightAt), glow(SLAB_NEUTRAL, 0.8));
    fill = new THREE.Mesh(buildFillGeometry(r.x, r.z, opts.size.x, opts.size.z, opts.heightAt), toon({ color: SLAB_NEUTRAL, emissive: SLAB_NEUTRAL, emissiveIntensity: FILL_EMISSIVE, transparent: true, opacity: 0.06, ink: false }));
    for (const m of [frame, fill]) { m.castShadow = false; m.receiveShadow = false; m.name = m === frame ? 'slab_frame' : 'slab_fill'; }
    fill.renderOrder = 1; // over the ground, under nothing else
    group.add(fill, frame);
    built = { x: r.x, z: r.z };
    lookKey = '';
  };

  return {
    get reading() { return reading; },
    get active() { return !!reading; },
    get color() { return color; },
    sync(states, dt) {
      reading = readSlab(states);
      group.visible = !!reading;
      if (!reading) return;
      t += dt;
      if (!built || Math.abs(built.x - reading.x) > 0.01 || Math.abs(built.z - reading.z) > 0.01) build(reading);
      const look = slabLook(reading, t);
      color = look.color;
      const key = `${look.color}:${look.fill}:${look.energy}`;
      if (key === lookKey) return;
      lookKey = key;
      frame!.material = glow(look.color, look.energy);
      fill!.material = toon({ color: look.color, emissive: look.color, emissiveIntensity: FILL_EMISSIVE, transparent: true, opacity: look.fill, ink: false });
    },
    stats() {
      let drawCalls = 0, triangles = 0;
      for (const m of [frame, fill]) if (m) { drawCalls++; triangles += (m.geometry.index?.count ?? 0) / 3; }
      return { drawCalls, triangles };
    },
    dispose() {
      scene.remove(group);
      frame?.geometry.dispose();
      fill?.geometry.dispose();
      frame = fill = null;
      built = null;
      reading = null;
    },
  };
}
