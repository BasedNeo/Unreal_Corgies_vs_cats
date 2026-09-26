// Adventure state: the plain-data contract in sim.state.adventure (docs/design/ADVENTURE.md), the per-Sim runtime,
// entity components and the read-only helpers bot tactics use (src/sim/ai/tactics.ts). Light imports only: the AI
// imports this module, so it must not import the AI (the runner, runner.ts, does).
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { EntityKind, Team, type EntityId } from '../../shared/types';
import type { ChapterDef, ChapterStep, AdventurePhase, Medal } from '../../shared/content/chapters';

/** sim.state.adventure — plain data, read by the match fold, bots, tools and tests. */
export interface AdventureState {
  // ---- contract (ADVENTURE.md) ----
  /** Chapter id. */
  chapter: string;
  /** -1 = briefing, 0..n-1 = current step, n = chapter complete. */
  step: number;
  phase: AdventurePhase;
  /** Current step progress 0..1. */
  progress: number;
  /**
   * Chapter counters: `kills` (adventure cats down), `kills:<tag>`, `broken:<tag>`, `<item>` (collected),
   * `alarms` (stealth alarms raised), `deaths` (squad knock-outs). Restored with the checkpoint on a wipe.
   */
  counters: Record<string, number>;
  /** Tick the chapter went live (-1 during the briefing). */
  startTick: number;
  /** Step a squad wipe restarts at. */
  checkpoint: number;
  // ---- extras ----
  index: number;
  total: number;
  /** Chapter time (s): running while live, final once complete. */
  time: number;
  medal: Medal | '';
  /** The current stealth step's alarm is up. */
  alarm: boolean;
  wipes: number;
  /** Seconds left in the briefing / fail beat / result hold. */
  timer: number;
  /** Current target (the beacon; ground point). */
  x: number; y: number; z: number;
  /** Squad rally point: the chapter start, then the last target the squad reached (checkpoint restarts here). */
  anchorX: number; anchorZ: number;
  /** Hold progress is contested (cats in the zone). */
  contested: boolean;
}

/** Tests / tools: `sim.state.adventureConfig = { ... }` before the first tick. */
export interface AdventureConfig {
  /** Chapter override (default: CHAPTERS by sim.state.room.chapter, else the first). */
  chapter?: ChapterDef;
  /** Seconds of briefing / fail beat / result hold (defaults in chapters.ts). */
  briefing?: number;
  /** Most seconds the briefing waits for a human before counting down anyway (default BRIEFING_WAIT_SECONDS). */
  briefingWait?: number;
  failBeat?: number;
  completeHold?: number;
  /** Switch S1's interaction layer on for the chapter (kiosks, cores, kibble). Default true. */
  interact?: boolean;
  /** After the result hold, load the next chapter (default true; false replays the same one). */
  advance?: boolean;
}

/** A cat the chapter spawned (e.adv). */
export interface AdventureTag {
  tag: string;
  /** Step that spawned it. */
  step: number;
  /** Sentry post (stealth steps) until the alarm: waypoints [x0, z0, x1, z1, …], current index, dwell end tick. */
  sentry?: { route: number[]; i: number; until: number };
}

/** Sentries dwell this long (s) at each waypoint of their loop (bots' tactics pace them). */
export const SENTRY_DWELL: [number, number] = [2.2, 4];

/** A collect item (e.advItem). */
export interface AdventureItem { item: string; spot: number }

declare module '../entity' {
  interface SimEntity {
    adv?: AdventureTag;
    advItem?: AdventureItem;
  }
}

export interface EnemyRecord {
  arch: string;
  tag: string;
  step: number;
  counted: boolean;
  /** BOSSES id when it is a boss. */
  boss?: string;
}

export interface CheckpointEnemy {
  arch: string; tag: string; step: number; x: number; y: number; z: number; yaw: number;
  route?: number[];
}

export interface CheckpointSnap {
  step: number;
  counters: Record<string, number>;
  anchorX: number; anchorZ: number;
  enemies: CheckpointEnemy[];
  /** Destructibles already counted as broken at the checkpoint. */
  broken: EntityId[];
  /** Whatever registered checkpoint hooks saved (by hook name). */
  extra: Record<string, unknown>;
}

/**
 * Extra world state a checkpoint restart must put back (other lanes' systems), e.g. X1's destructibles:
 *   registerCheckpointHook('destruct', { save: destructSnapshot, restore: (sim, ids) => restoreDestructSnapshot(sim, ids as string[]) })
 * save() runs when a checkpoint step begins; restore() runs on a restart, before the squad and the cats come back.
 */
export interface CheckpointHook { save(sim: Sim): unknown; restore(sim: Sim, saved: unknown): void }
const hooks = new Map<string, CheckpointHook>();
export function registerCheckpointHook(name: string, hook: CheckpointHook | null): void {
  if (hook) hooks.set(name, hook); else hooks.delete(name);
}
export function checkpointHooks(): ReadonlyMap<string, CheckpointHook> {
  return hooks;
}

export interface AdventureRuntime {
  def: ChapterDef | null;
  beacon: EntityId;
  enemies: Map<EntityId, EnemyRecord>;
  /** Items of the current collect step (taken ones are removed from the sim and from this list). */
  items: EntityId[];
  /** Destructibles seen (id → tag) and the ones already counted as broken. */
  destructSeen: Map<EntityId, string>;
  destructBroken: Set<EntityId>;
  snap: CheckpointSnap | null;
  /** Ticks into the current step; hold progress (0..1); cats down during the step. */
  stepTicks: number;
  hold: number;
  stepKills: number;
  barks: Array<{ tick: number; line: string }>;
  barkTurn: number;
  /** Humans who pressed E during the briefing (all ready → skip). */
  ready: Set<EntityId>;
  /** Ticks spent in the briefing (its countdown waits for a human, up to BRIEFING_WAIT_SECONDS). */
  briefingTicks: number;
  /** Squad members placed this tick (so a respawn relocation doesn't move them twice). */
  placed: Set<EntityId>;
  placedTick: number;
  setup: boolean;
  rng: () => number;
}

const runtimes = new WeakMap<Sim, AdventureRuntime>();

export function adventureRuntime(sim: Sim): AdventureRuntime | null {
  return runtimes.get(sim) ?? null;
}

export function setAdventureRuntime(sim: Sim, rt: AdventureRuntime): void {
  runtimes.set(sim, rt);
}

export function adventureState(sim: Sim): AdventureState | null {
  return (sim.state.adventure as AdventureState | undefined) ?? null;
}

export function adventureConfig(sim: Sim): AdventureConfig {
  return (sim.state.adventureConfig as AdventureConfig | undefined) ?? {};
}

export function isAdventureMode(sim: Sim): boolean {
  return (sim.state.room as { mode?: string } | undefined)?.mode === 'adventure';
}

/** The chapter being played (null outside adventure mode / before setup). */
export function adventureChapter(sim: Sim): ChapterDef | null {
  return adventureRuntime(sim)?.def ?? null;
}

/** The step being played (null in the briefing, on the result screen and outside adventure mode). */
export function adventureStep(sim: Sim): ChapterStep | null {
  const def = adventureChapter(sim), st = adventureState(sim);
  if (!def || !st || st.step < 0 || st.step >= def.steps.length) return null;
  return def.steps[st.step];
}

/** A squad member: a corgi player or room bot (not a PvE spawn). */
export function isSquad(e: SimEntity): boolean {
  return !!e.char && e.team === Team.Corgis && !e.removed && !e.combat?.pve && (e.kind === EntityKind.Player || e.kind === EntityKind.Bot);
}

/** Squad members (alive or not). */
export function squadOf(sim: Sim, out: SimEntity[] = []): SimEntity[] {
  out.length = 0;
  for (const e of sim.entities.values()) if (isSquad(e)) out.push(e);
  return out;
}

/** Is a human in the squad (alive or waiting to respawn)? Humans trigger interact steps and lead stealth. */
export function squadHasHuman(sim: Sim): boolean {
  for (const e of sim.entities.values()) if (e.kind === EntityKind.Player && isSquad(e)) return true;
  return false;
}

/** Untaken items of the current collect step. */
export function adventureItems(sim: Sim, out: SimEntity[] = []): SimEntity[] {
  out.length = 0;
  for (const id of adventureRuntime(sim)?.items ?? []) {
    const e = sim.entities.get(id);
    if (e && !e.removed) out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- destructibles
/** What the `destroy` trigger needs to know about a breakable prop. */
export interface DestructibleInfo { tag: string; broken: boolean }
export type DestructibleProbe = (sim: Sim, e: SimEntity) => DestructibleInfo | null;

type Bag = Record<string, unknown> | undefined;
/**
 * Default reader for X1's destructibles (EntityKind.Destructible): X1's `e.dsx` (def.tag, broken) when present, else a
 * component (`destruct` / `destructible` with `tag`), `e.data.tag`, or the WorldData.destructibles entry the entity is
 * named after or stands on; broken = dead, removed, hp ≤ 0 or the component's `broken` flag. setDestructibleProbe
 * replaces it.
 */
export const defaultDestructibleProbe: DestructibleProbe = (sim, e) => {
  if (e.kind !== EntityKind.Destructible) return null;
  const x = e as unknown as { dsx?: { def?: { tag?: string }; broken?: boolean }; destruct?: Bag; destructible?: Bag };
  if (x.dsx?.def?.tag) return { tag: x.dsx.def.tag, broken: !!x.dsx.broken || e.removed }; // X1's component
  const comp = x.destruct ?? x.destructible;
  let tag = (comp?.tag as string | undefined) ?? (e.data?.tag as string | undefined);
  if (!tag) {
    const list = (sim.worldData as { destructibles?: Array<{ id: string; tag: string; x: number; z: number }> }).destructibles ?? [];
    const d = list.find((d) => d.id === e.name) ?? list.find((d) => Math.hypot(d.x - e.pos.x, d.z - e.pos.z) < 0.75);
    tag = d?.tag;
  }
  if (!tag) return null;
  const broken = e.dead || e.removed || !!comp?.broken || (!!e.health && e.health.max > 0 && e.health.hp <= 0);
  return { tag, broken };
};

let probe: DestructibleProbe = defaultDestructibleProbe;

/** X1 hook: how to read a destructible's tag and broken state (default: defaultDestructibleProbe). */
export function setDestructibleProbe(fn: DestructibleProbe | null): void {
  probe = fn ?? defaultDestructibleProbe;
}

export function readDestructible(sim: Sim, e: SimEntity): DestructibleInfo | null {
  return probe(sim, e);
}

/**
 * Living targets of the current defeat / destroy step: tagged (or any) chapter cats, the boss, or unbroken
 * destructibles with the tag.
 */
export function adventureTargets(sim: Sim, out: SimEntity[] = []): SimEntity[] {
  out.length = 0;
  const rt = adventureRuntime(sim), step = adventureStep(sim);
  if (!rt || !step) return out;
  const t = step.trigger;
  if (t.type === 'defeat') {
    for (const [id, r] of rt.enemies) {
      const e = sim.entities.get(id);
      if (!e || e.dead || e.removed) continue;
      if (t.params.boss ? r.boss === t.params.boss : !t.params.tag || r.tag === t.params.tag) out.push(e);
    }
  } else if (t.type === 'destroy') {
    for (const e of sim.entities.values()) {
      if (e.kind !== EntityKind.Destructible) continue;
      const d = readDestructible(sim, e);
      if (d && !d.broken && d.tag === t.params.tag) out.push(e);
    }
  }
  return out;
}
