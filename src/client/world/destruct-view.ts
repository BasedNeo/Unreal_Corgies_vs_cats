// X1: the destructibles' look — the Garage breach wall (boards, plywood, target), the tuna-can stacks and the crate
// stacks while they stand, low rubble once broken, and a debris burst when they break.
//
// Draw calls: every destructible's intact AND rubble prims are merged into one mesh per render group (solid / soft /
// noink, + one crease-ink LineSegments2 for solid), the prim-mesh way. Each destructible owns index ranges in those
// buffers; showing or hiding one rewrites only its ranges (degenerate triangles = hidden; its crease segments parked
// far below the world), so a break costs a small buffer upload and no geometry rebuild or allocation. Debris: two
// instanced meshes (destruct-debris.ts). Camera: invisible per-destructible proxies (layer 0 while standing).
//
// Wiring (main.ts): the world view creates this and adds its camera proxies to cameraColliders; per frame
//   worldView.destruct.sync(states)   (snapshot truth: late joins, resets, missed events)
// and on every game event
//   worldView.destruct.onGameEvent(ev)   (`ability destruct:<kind>` -> break now, with debris).
import * as THREE from 'three/webgpu';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { EntityState, GameEvent } from '../../shared/protocol';
import { EFlag, EntityKind } from '../../shared/types';
import type { Destructible, PrimGroup, WorldData } from '../../shared/world/world-types';
import { boxAabb } from '../../shared/world/destructibles';
import { quatYXZ } from '../../shared/world/queries';
import { hash2 } from '../../shared/world/noise';
import { Builder, creaseEdges, inkMaterial, primGeometry } from './prim-mesh';
import { toonFrom, toonNoInk } from './materials';
import { worldColor } from './world-palette';
import { createDebris, type DebrisSystem } from './destruct-debris';

const GROUPS: PrimGroup[] = ['solid', 'soft', 'noink'];
/** Baked debris landing surface around each destructible: SURF_N x SURF_N cells of SURF_CELL m. */
const SURF_CELL = 0.5, SURF_N = 44;
/** Where hidden crease segments are parked (below everything, never on screen). */
const PARK_Y = -1e4;
/** After a break event, ignore "standing" snapshot states this long (interpolated states lag the event). */
const EVENT_GUARD_MS = 1500;

interface Range { i0: number; i1: number; l0: number; l1: number }
interface Slot {
  def: Destructible;
  /** ranges[state][group]: state 0 = standing, 1 = rubble. */
  ranges: [Range[], Range[]];
  broken: boolean;
  /** Snapshot break counter we last saw (EntityState.ammo), -1 = never synced. */
  breaks: number;
  eventAt: number;
  proxy: THREE.Group;
  aabb: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
}

interface GroupMesh {
  mesh: THREE.Mesh;
  index: THREE.BufferAttribute;
  orig: Uint16Array | Uint32Array;
  lines: LineSegments2 | null;
  lineBuf: THREE.InterleavedBuffer | null;
  lineOrig: Float32Array | null;
}

export interface DestructView {
  group: THREE.Group;
  /** Invisible proxies of the standing destructibles for the third-person camera's wall avoidance. */
  cameraGroup: THREE.Group;
  /** Snapshot states (every frame): broken / standing truth for late joiners, resets and missed events. */
  sync(states: Map<number, EntityState> | Iterable<EntityState>, nowMs?: number): void;
  /** Game events: `ability { ability: 'destruct:<kind>' }` breaks the destructible at once, with debris. */
  onGameEvent(ev: GameEvent, nowMs?: number): void;
  /** Debris motion (presentation dt). */
  update(dt: number): void;
  /** Lab/tests: force a state by WorldData index (with or without the debris burst). */
  setBroken(index: number, broken: boolean, fx?: boolean): void;
  isBroken(index: number): boolean;
  setCreases(on: boolean): void;
  stats(): Record<string, number>;
  dispose(): void;
}

export function createDestructView(data: WorldData, opts: { creases?: boolean; surfaceAt?: (x: number, z: number, belowY: number) => number } = {}): DestructView {
  const defs = data.destructibles ?? [];
  const group = new THREE.Group();
  group.name = 'destructibles';
  const cameraGroup = new THREE.Group();
  cameraGroup.name = 'destructible_camera_proxies';
  // Debris lands on a height map baked once around each destructible (queries allocate; the debris never does).
  const surfaceAt = opts.surfaceAt ?? ((x: number, z: number) => data.height(x, z));
  const surf = defs.map((d) => {
    const x0 = d.cx - (SURF_N * SURF_CELL) / 2, z0 = d.cz - (SURF_N * SURF_CELL) / 2, h = new Float32Array(SURF_N * SURF_N);
    for (let j = 0; j < SURF_N; j++) for (let i = 0; i < SURF_N; i++) h[j * SURF_N + i] = surfaceAt(x0 + (i + 0.5) * SURF_CELL, z0 + (j + 0.5) * SURF_CELL, d.cy + 3);
    return { x0, z0, h };
  });
  const groundAt = (x: number, z: number): number => {
    for (const g of surf) {
      const i = Math.floor((x - g.x0) / SURF_CELL), j = Math.floor((z - g.z0) / SURF_CELL);
      if (i >= 0 && j >= 0 && i < SURF_N && j < SURF_N) return g.h[j * SURF_N + i];
    }
    return data.height(x, z);
  };
  const debris: DebrisSystem = createDebris(groundAt);
  group.add(debris.group);

  // ---- merged meshes with per-destructible ranges
  const builders = new Map<PrimGroup, Builder>();
  for (const g of GROUPS) builders.set(g, new Builder());
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), color = new THREE.Color();
  const slots: Slot[] = defs.map((def, di) => {
    const ranges: [Range[], Range[]] = [[], []];
    for (const state of [0, 1] as const) {
      const prims = state ? def.rubble : def.prims;
      for (const g of GROUPS) {
        const b = builders.get(g)!;
        const r: Range = { i0: b.idx.length, i1: 0, l0: b.lines.length, l1: 0 };
        prims.forEach((p, pi) => {
          if ((p.g ?? 'solid') !== g) return;
          const geo = primGeometry(p, g !== 'noink');
          e.set(p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0, 'YXZ');
          m.compose(pos.set(p.x, p.y, p.z), q.setFromEuler(e), one);
          color.copy(worldColor(p.col)).multiplyScalar(1 + (hash2(pi, di * 2 + state, 99) - 0.5) * 0.08);
          b.add(geo, m, color);
          if (g === 'solid') b.addLines(creaseEdges(geo), m);
        });
        r.i1 = b.idx.length; r.l1 = b.lines.length;
        ranges[state].push(r);
      }
    }
    // camera proxy: the collider boxes (invisible; the camera raycasts layer 0 only)
    const proxy = new THREE.Group();
    for (const bx of def.boxes) {
      const pm = new THREE.Mesh(proxyBox ??= new THREE.BoxGeometry(1, 1, 1), proxyMat ??= toonFrom());
      const qq = quatYXZ(bx.pitch ?? 0, bx.rotY, bx.roll ?? 0);
      pm.position.set(bx.x, bx.y, bx.z);
      pm.quaternion.set(qq.x, qq.y, qq.z, qq.w);
      pm.scale.set(bx.hx * 2, bx.hy * 2, bx.hz * 2);
      pm.visible = false;
      pm.updateMatrixWorld();
      proxy.add(pm);
    }
    cameraGroup.add(proxy);
    let a = { x0: def.x - 1, x1: def.x + 1, y0: def.y, y1: def.y + 1, z0: def.z - 1, z1: def.z + 1 };
    def.boxes.forEach((bx, k) => {
      const b = boxAabb(bx);
      a = k === 0 ? b : { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1) };
    });
    return { def, ranges, broken: false, breaks: -1, eventAt: -1e9, proxy, aabb: a };
  });

  const mats: Record<PrimGroup, THREE.Material> = {
    solid: toonFrom({ vertexColors: true }), soft: toonFrom({ vertexColors: true }), noink: toonNoInk({ vertexColors: true }),
  };
  const meshes: (GroupMesh | null)[] = GROUPS.map((g) => {
    const b = builders.get(g)!;
    const geo = b.build();
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, mats[g]);
    mesh.name = `destructibles_${g}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.noCameraCollide = true;          // the camera uses the proxies (they follow the broken state)
    const index = geo.getIndex()!;
    index.setUsage(THREE.DynamicDrawUsage);
    const orig = (index.array as Uint16Array | Uint32Array).slice();
    let lines: LineSegments2 | null = null, lineBuf: THREE.InterleavedBuffer | null = null, lineOrig: Float32Array | null = null;
    if (b.lines.length) {
      const lg = new LineSegmentsGeometry();
      lg.setPositions(new Float32Array(b.lines));
      lines = new LineSegments2(lg, inkMaterial());
      lines.name = `${mesh.name}_crease`;
      lines.userData.styleInk = true;
      lines.frustumCulled = false;
      lineBuf = (lg.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data;
      lineBuf.setUsage(THREE.DynamicDrawUsage);
      lineOrig = (lineBuf.array as Float32Array).slice();
      mesh.add(lines);
    }
    group.add(mesh);
    return { mesh, index, orig, lines, lineBuf, lineOrig };
  });

  /** Show (copy back) or hide (degenerate / park) one destructible state's ranges. */
  function paint(slot: Slot, state: 0 | 1, on: boolean): void {
    GROUPS.forEach((_, gi) => {
      const gm = meshes[gi], r = slot.ranges[state][gi];
      if (!gm) return;
      if (r.i1 > r.i0) {
        const arr = gm.index.array as Uint16Array | Uint32Array;
        if (on) arr.set(gm.orig.subarray(r.i0, r.i1), r.i0);
        else arr.fill(0, r.i0, r.i1);
        gm.index.addUpdateRange(r.i0, r.i1 - r.i0);
        gm.index.needsUpdate = true;
      }
      if (gm.lineBuf && gm.lineOrig && r.l1 > r.l0) {
        const arr = gm.lineBuf.array as Float32Array;
        if (on) arr.set(gm.lineOrig.subarray(r.l0, r.l1), r.l0);
        else for (let k = r.l0; k < r.l1; k += 3) { arr[k] = 0; arr[k + 1] = PARK_Y; arr[k + 2] = 0; }
        gm.lineBuf.addUpdateRange(r.l0, r.l1 - r.l0);
        gm.lineBuf.needsUpdate = true;
      }
    });
  }

  function show(slot: Slot, broken: boolean, fx: boolean): void {
    if (slot.broken === broken) return;
    slot.broken = broken;
    paint(slot, 0, !broken);
    paint(slot, 1, broken);
    for (const c of slot.proxy.children) c.layers.set(broken ? 31 : 0);
    if (broken && fx) debris.burst(slot.def.kind, slot.aabb, slot.def.cx, slot.def.cy, slot.def.cz);
  }
  for (const s of slots) paint(s, 1, false);         // start: everything standing, rubble hidden
  // Warm the break path once at load (JIT the burst/step/paint code) so the first real break costs no more than
  // later ones: a burst of every kind far below the world, a few steps, then nothing is left alive.
  if (slots.length) {
    const far = { x0: 0, x1: 1, y0: -500, y1: -499, z0: 0, z1: 1 };
    for (const k of ['wall_boards', 'tuna_stack', 'crate_stack'] as const) debris.burst(k, far, 0.5, -499.5, 0.5);
    for (let i = 0; i < 3; i++) debris.update(1 / 60);
    debris.clear();
    paint(slots[0], 0, false); paint(slots[0], 0, true);
    for (const gm of meshes) if (gm) { gm.index.clearUpdateRanges(); gm.lineBuf?.clearUpdateRanges(); }
  }

  const byEntity = new Map<number, Slot>();
  let breaksShown = 0, lastBreakMs = 0;
  const syncOne = (s: EntityState, now: number) => {
    if (s.kind !== EntityKind.Destructible) return;
    const slot = slots[s.seed];
    if (!slot) return;
    byEntity.set(s.id, slot);
    const broken = (s.flags & EFlag.Busy) !== 0;
    const first = slot.breaks < 0;
    if (broken && !slot.broken) {
      // a break we got no event for: debris only if we were watching it stand (not on a late join)
      const t0 = performance.now();
      show(slot, true, !first && s.ammo > slot.breaks);
      lastBreakMs = performance.now() - t0;
      breaksShown++;
    } else if (!broken && slot.broken && now - slot.eventAt > EVENT_GUARD_MS) {
      show(slot, false, false);
    }
    slot.breaks = s.ammo;
  };

  let syncNow = 0;
  const syncEach = (s: EntityState) => syncOne(s, syncNow);          // bound once: sync() allocates nothing per frame
  return {
    group, cameraGroup,
    sync(states, nowMs) {
      syncNow = nowMs ?? performance.now();
      if (states instanceof Map) states.forEach(syncEach);
      else for (const s of states) syncOne(s, syncNow);
    },
    onGameEvent(ev, nowMs) {
      if (ev.e !== 'ability' || !ev.ability.startsWith('destruct:')) return;
      // the event carries the destructible's center: match it (works before the first snapshot sync too)
      let slot = byEntity.get(ev.id);
      if (!slot) for (const s of slots) if (Math.abs(s.def.cx - ev.x) + Math.abs(s.def.cy - ev.y) + Math.abs(s.def.cz - ev.z) < 0.05) { slot = s; break; }
      if (!slot) return;
      slot.eventAt = nowMs ?? performance.now();
      const t0 = performance.now();
      if (!slot.broken) { show(slot, true, true); breaksShown++; }
      lastBreakMs = performance.now() - t0;
    },
    update(dt) { debris.update(dt); },
    setBroken(index, broken, fx = false) {
      const slot = slots[index];
      if (!slot) return;
      const t0 = performance.now();
      show(slot, broken, fx);
      lastBreakMs = performance.now() - t0;
    },
    isBroken(index) { return slots[index]?.broken ?? false; },
    setCreases(on) { for (const gm of meshes) if (gm?.lines) gm.lines.visible = on; },
    stats() {
      let tris = 0;
      for (const gm of meshes) if (gm) tris += gm.orig.length / 3;
      return {
        destructibles: slots.length, destructBroken: slots.filter((s) => s.broken).length,
        destructDraws: meshes.filter(Boolean).length + meshes.filter((gm) => gm?.lines).length + (debris.alive ? 2 : 0),
        destructTris: tris, debrisAlive: debris.alive, destructBreaks: breaksShown, destructLastBreakMs: lastBreakMs,
      };
    },
    dispose() {
      for (const gm of meshes) {
        if (!gm) continue;
        gm.mesh.geometry.dispose();
        gm.lines?.geometry.dispose();
      }
      for (const mt of Object.values(mats)) mt.dispose();
      debris.dispose();
    },
  };
}

// camera proxies: shared by every view (never disposed by users, like style-cache materials)
let proxyBox: THREE.BoxGeometry | undefined;
let proxyMat: THREE.Material | undefined;
