// Wire protocol between clients and the authority (Web Worker host offline, Node server online).
// JSON messages; entity states are packed into fixed-order number arrays to keep snapshots small.
import type { ClassId, EntityId, EntityKindId, SpeciesId, TeamId, AnimId } from './types';
import type { InputCmd } from './input';

/** Authoritative per-entity state, as seen by clients. */
export interface EntityState {
  id: EntityId;
  kind: EntityKindId;
  team: TeamId;
  species: SpeciesId;
  /**
   * Characters: index into CLASS_IDS (-1 = none). Non-character entities (vehicles, pickups, terminals,
   * projectiles, bosses): index into that kind's content table (e.g. VEHICLES, PICKUPS, TERMINALS, WEAPONS).
   */
  cls: number;
  /** Appearance seed (procedural character variation). */
  seed: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  vx: number; vy: number; vz: number;
  hp: number; maxHp: number;
  anim: AnimId;
  flags: number;
  /** Equipped weapon id index (content table), -1 none. */
  weapon: number;
  /** Ammo in magazine (only meaningful for the owner). */
  ammo: number;
}

const FIELDS = ['id', 'kind', 'team', 'species', 'cls', 'seed', 'x', 'y', 'z', 'yaw', 'pitch', 'vx', 'vy', 'vz', 'hp', 'maxHp', 'anim', 'flags', 'weapon', 'ammo'] as const;
const ROUND: Partial<Record<(typeof FIELDS)[number], number>> = { x: 1000, y: 1000, z: 1000, yaw: 1000, pitch: 1000, vx: 100, vy: 100, vz: 100, hp: 10 };

export function packEntity(s: EntityState): number[] {
  return FIELDS.map((f) => {
    const v = s[f] as number;
    const r = ROUND[f];
    return r ? Math.round(v * r) / r : v;
  });
}

export function unpackEntity(a: number[]): EntityState {
  const o: Record<string, number> = {};
  for (let i = 0; i < FIELDS.length; i++) o[FIELDS[i]] = a[i] ?? 0;
  return o as unknown as EntityState;
}

export type MatchPhase = 'warmup' | 'live' | 'ended';

export interface MatchState {
  mode: string;
  phase: MatchPhase;
  /** Seconds left in the current phase. */
  timeLeft: number;
  /** Team scores indexed by TeamId (Corgis, Cats). */
  score: [number, number];
  /** Current objective text for the HUD (short). */
  objective: string;
  wave: number;
  winner: TeamId | -1;
}

/** Gameplay events for presentation (FX, audio, HUD). Never used by clients to decide outcomes. */
export type GameEvent =
  | { e: 'fire'; id: EntityId; wpn: number; x: number; y: number; z: number; dx: number; dy: number; dz: number; hx: number; hy: number; hz: number; hit: EntityId | -1 }
  | { e: 'hit'; src: EntityId; dst: EntityId; dmg: number; x: number; y: number; z: number; crit: boolean }
  | { e: 'death'; id: EntityId; by: EntityId }
  | { e: 'spawn'; id: EntityId }
  | { e: 'jump'; id: EntityId; double: boolean }
  | { e: 'land'; id: EntityId; impact: number }
  | { e: 'explode'; x: number; y: number; z: number; r: number; by: EntityId }
  | { e: 'pickup'; id: EntityId; item: string }
  | { e: 'bark'; id: EntityId; line: string }
  | { e: 'score'; team: TeamId; pts: number; reason: string }
  | { e: 'reload'; id: EntityId }
  | { e: 'ability'; id: EntityId; ability: string; x: number; y: number; z: number };

export interface RosterEntry {
  pid: string;
  name: string;
  team: TeamId;
  cls: ClassId;
  entity: EntityId;
  bot: boolean;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
}

// ---- client -> authority ----
export type ClientMsg =
  | { t: 'hello'; v: number; name: string; team: TeamId | -1; cls: ClassId }
  | { t: 'input'; cmds: InputCmd[] }
  | { t: 'ping'; id: number; ct: number }
  | { t: 'class'; cls: ClassId }
  | { t: 'team'; team: TeamId }
  | { t: 'chat'; text: string };

// ---- authority -> client ----
export type ServerMsg =
  /** `map`: the registry id the room runs (src/shared/world/maps.ts); absent from pre-Wave-8 authorities = the default map. */
  | { t: 'welcome'; pid: string; entity: EntityId; tick: number; mapSeed: number; map?: string; mode: string; tickHz: number }
  | { t: 'snap'; tick: number; ack: number; you: EntityId; ents: number[][]; gone: EntityId[]; match: MatchState; ev: GameEvent[] }
  | { t: 'roster'; players: RosterEntry[] }
  | { t: 'pong'; id: number; ct: number; st: number }
  | { t: 'notice'; text: string }
  /** team: the sender's team when sent (names are not unique; clients color by it). */
  | { t: 'chat'; from: string; text: string; team?: TeamId }
  | { t: 'reject'; reason: string };
