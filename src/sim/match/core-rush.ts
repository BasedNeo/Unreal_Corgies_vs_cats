// core-rush: PvP domination over three Core Pads (A, B, C). Standing on a pad takes it: a neutral pad in
// `captureTime` s for one player (faster with teammates), an enemy pad in twice that (neutralize, then take).
// Both teams on a pad = contested (frozen). Held pads score `holdRate` points/s for their team; taking one
// scores `captureBonus` (announced). First to `scoreLimit`, or the leader at the horn, wins.
//
// Pads are placed at runtime, fairly: B on the midpoint between the two teams' spawn centroids, A and C out to
// the sides on the perpendicular (equidistant from both bases before snapping), each snapped to open lawn in the
// main nav region. Pads are EntityKind.Zone entities (snapshot layout: src/shared/content/modes.ts).
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, EFlag, EntityKind, Team, type EntityId, type TeamId } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import { CAPTURE_SCALE, CORE_PAD_LABELS, CORE_RUSH, type CoreRushConfig } from '../../shared/content/modes';
import { simNavGrid } from '../ai';
import { cellIndex, cellX, cellZ, type NavGrid } from '../ai/nav';
import { creditRoster } from '../interact/state';

/** Authoritative pad state (plain data on the entity: `e.pad`). */
export interface CorePad {
  index: number;
  /** Owning team, or Team.Neutral. */
  owner: TeamId;
  /** Team whose progress `progress` is (-1 = none). An owned pad has progress 1 for its owner. */
  holder: TeamId | -1;
  /** 0..1 */
  progress: number;
  contested: boolean;
  /** Characters of each team on the pad this tick. */
  count: [number, number];
}

declare module '../entity' {
  interface SimEntity {
    pad?: CorePad;
  }
}

/** Pad view for bots and tools (read-only copies). */
export interface CorePadInfo { id: EntityId; index: number; x: number; y: number; z: number; owner: TeamId; holder: TeamId | -1; progress: number; contested: boolean }

export function coreRushConfig(sim: Sim): CoreRushConfig {
  const o = (sim.state.matchConfig as { coreRush?: Partial<CoreRushConfig> } | undefined)?.coreRush;
  return { ...CORE_RUSH, ...o };
}

/** The pads of a running core-rush match (empty in other modes). */
export function coreRushPads(sim: Sim): CorePadInfo[] {
  const ids = (sim.state.coreRushPads as EntityId[] | undefined) ?? [];
  const out: CorePadInfo[] = [];
  for (const id of ids) {
    const e = sim.entities.get(id);
    if (!e?.pad) continue;
    const p = e.pad;
    out.push({ id, index: p.index, x: e.pos.x, y: e.pos.y, z: e.pos.z, owner: p.owner, holder: p.holder, progress: p.progress, contested: p.contested });
  }
  return out;
}

function centroid(sim: Sim, team: TeamId): { x: number; z: number } | null {
  let x = 0, z = 0, n = 0;
  for (const s of sim.worldData.spawns) if (s.team === team) { x += s.x; z += s.z; n++; }
  return n ? { x: x / n, z: z / n } : null;
}

/** Share of walkable lawn cells (cost 1, main region) within r of cell c. */
function openness(g: NavGrid, c: number, r: number): number {
  const cx = cellX(g, c), cz = cellZ(g, c);
  let ok = 0, all = 0;
  for (let dz = -r; dz <= r; dz += g.cell) for (let dx = -r; dx <= r; dx += g.cell) {
    if (dx * dx + dz * dz > r * r) continue;
    all++;
    const i = cellIndex(g, cx + dx, cz + dz);
    if (i >= 0 && g.walk[i] && g.cost[i] === 1 && g.region[i] === g.mainRegion) ok++;
  }
  return all ? ok / all : 0;
}

/** Best open lawn cell near (x, z): main region, plain lawn, mostly open around, as close to the target as possible. */
function openCellNear(g: NavGrid, x: number, z: number, r: number): number {
  let best = -1, bestScore = Infinity;
  const R = 14;
  for (let dz = -R; dz <= R; dz += g.cell) for (let dx = -R; dx <= R; dx += g.cell) {
    const d = Math.hypot(dx, dz);
    if (d > R) continue;
    const c = cellIndex(g, x + dx, z + dz);
    if (c < 0 || !g.walk[c] || g.cost[c] !== 1 || g.region[c] !== g.mainRegion) continue;
    const open = openness(g, c, r);
    if (open < 0.8) continue;
    const score = d + (1 - open) * 20;
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

export interface PadSpot { x: number; y: number; z: number }

/** Deterministic fair pad spots for this world (3, or fewer if the map has no room). */
export function corePadSpots(sim: Sim, cfg: CoreRushConfig = coreRushConfig(sim)): PadSpot[] {
  const a = centroid(sim, Team.Corgis), b = centroid(sim, Team.Cats);
  if (!a || !b) return [];
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const px = -(b.z - a.z) / L, pz = (b.x - a.x) / L; // perpendicular to the base-to-base axis
  const spread = Math.min(40, Math.max(18, L * 0.35));
  const targets = [[mx + px * spread, mz + pz * spread], [mx, mz], [mx - px * spread, mz - pz * spread]];
  const g = simNavGrid(sim);
  const out: PadSpot[] = [];
  for (const [tx, tz] of targets) {
    if (!g) { out.push({ x: tx, y: sim.worldData.height(tx, tz), z: tz }); continue; }
    const c = openCellNear(g, tx, tz, cfg.padRadius);
    if (c < 0) continue;
    out.push({ x: cellX(g, c), y: g.ground[c], z: cellZ(g, c) });
  }
  return out;
}

/** Create the pad entities for a new core-rush match (idempotent: existing pads are reset instead). */
export function setupCorePads(sim: Sim): void {
  const have = (sim.state.coreRushPads as EntityId[] | undefined) ?? [];
  if (have.length && have.every((id) => sim.entities.has(id))) { resetCorePads(sim); return; }
  const ids: EntityId[] = [];
  corePadSpots(sim).forEach((s, i) => {
    const id = sim.allocId();
    const e: SimEntity = {
      id, kind: EntityKind.Zone, team: Team.Neutral, species: 0, cls: null, seed: i, name: `pad ${CORE_PAD_LABELS[i] ?? i}`,
      pos: { x: s.x, y: s.y, z: s.z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, collider: null,
      input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null,
      health: { hp: 0, max: CAPTURE_SCALE, lastDamageTick: -9999, lastAttacker: -1 },
      anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
      ownerPid: null, removed: false, data: {},
      pad: { index: i, owner: Team.Neutral, holder: -1, progress: 0, contested: false, count: [0, 0] },
    };
    sim.entities.set(id, e);
    ids.push(id);
  });
  sim.state.coreRushPads = ids;
}

/** Every pad back to neutral (match restart). */
export function resetCorePads(sim: Sim): void {
  for (const id of (sim.state.coreRushPads as EntityId[] | undefined) ?? []) {
    const e = sim.entities.get(id);
    if (!e?.pad) continue;
    Object.assign(e.pad, { owner: Team.Neutral, holder: -1, progress: 0, contested: false, count: [0, 0] });
    writePad(e);
  }
}

function writePad(e: SimEntity): void {
  const p = e.pad!;
  e.team = p.owner;
  e.health!.hp = Math.round(p.progress * CAPTURE_SCALE);
  e.ammo = p.holder === -1 ? 0 : p.holder + 1;
  e.flags = p.contested ? EFlag.Busy : 0;
}

export interface PadTickResult {
  /** Pads owned per team after this tick. */
  held: [number, number];
  /** Pads taken this tick: [team, pad index]. */
  captured: Array<[TeamId, number]>;
}

/** Advance capture on every pad (only while the match is live). */
export function stepCorePads(sim: Sim, dt: number, cfg: CoreRushConfig = coreRushConfig(sim)): PadTickResult {
  const res: PadTickResult = { held: [0, 0], captured: [] };
  const ids = (sim.state.coreRushPads as EntityId[] | undefined) ?? [];
  const r2 = cfg.padRadius * cfg.padRadius;
  for (const id of ids) {
    const e = sim.entities.get(id);
    if (!e?.pad) continue;
    const p = e.pad;
    p.count[0] = 0; p.count[1] = 0;
    const on: SimEntity[] = [];
    for (const c of sim.entities.values()) {
      if (!c.char || c.dead || (c.team !== Team.Corgis && c.team !== Team.Cats) || (c.flags & EFlag.Mounted)) continue;
      const dx = c.pos.x - e.pos.x, dz = c.pos.z - e.pos.z;
      if (dx * dx + dz * dz > r2 || Math.abs(c.pos.y - e.pos.y) > cfg.padReach) continue;
      p.count[c.team]++;
      on.push(c);
    }
    const [c0, c1] = p.count;
    p.contested = c0 > 0 && c1 > 0;
    if (!p.contested && (c0 > 0 || c1 > 0)) {
      const t: TeamId = c0 > 0 ? Team.Corgis : Team.Cats;
      const n = Math.min(3, c0 + c1);
      const rate = (1 + cfg.perExtraPlayer * (n - 1)) / cfg.captureTime;
      if (p.holder === t || p.holder === -1) {
        p.holder = t;
        p.progress = Math.min(1, p.progress + rate * dt);
        if (p.progress >= 1 && p.owner !== t) {
          p.owner = t;
          res.captured.push([t, p.index]);
          for (const c of on) creditRoster(sim, c.id, cfg.captureBonus * 2, 'capture'); // the players who took it
        }
      } else {
        p.progress = Math.max(0, p.progress - rate * dt);
        if (p.progress <= 0) { p.holder = -1; p.owner = Team.Neutral; }
      }
    } else if (!p.contested) {
      // nobody on it: an owned pad refills for its owner, a neutral one drains back to nothing
      if (p.owner !== Team.Neutral) { p.holder = p.owner; p.progress = Math.min(1, p.progress + cfg.drift * dt); }
      else { p.progress = Math.max(0, p.progress - cfg.drift * dt); if (p.progress <= 0) p.holder = -1; }
    }
    if (p.owner === Team.Corgis || p.owner === Team.Cats) res.held[p.owner]++;
    writePad(e);
  }
  return res;
}
