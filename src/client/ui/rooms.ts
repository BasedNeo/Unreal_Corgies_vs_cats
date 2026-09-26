// OWNER: U1 (ux). Room browser logic: which HTTP endpoint lists a server's rooms, validation of the list, and a
// poller with explicit loading / ready / empty / error / busy / offline / bad-url states. Pure except for the
// injected fetch and timers, so tests/unit/ui-rooms.test.ts drives it with fakes.
//
// The server (server/app.ts) answers GET /rooms at the root of its HTTP port with
//   [{ name, mode, players, humans, bots, maxPlayers, phase }]   (live public rooms, busiest first)
import { sanitizeRoomName } from '../../host/guard';
import type { MatchPhase } from '../../shared/protocol';
import type { ClassId } from '../../shared/types';
import { chapterById } from '../../shared/content/chapters';

export interface RoomInfo {
  name: string;
  mode: string;
  /** Everyone in the match (humans + bots). */
  players: number;
  humans: number;
  bots: number;
  /** Human slots. */
  maxPlayers: number;
  phase: MatchPhase;
  /** Adventure rooms: the chapter being played. */
  chapter?: string;
}

/** Rows the browser shows at most (the server caps its response too). */
export const ROOMS_MAX = 50;
export const ROOMS_REFRESH_MS = 5000;
export const ROOMS_TIMEOUT_MS = 4000;
/** Failed polls back off (5 → 10 → 20 → 30 s) so a dead server isn't hammered (or the console flooded). */
export const ROOMS_MAX_BACKOFF_MS = 30_000;
/** Server rule (server/rooms.ts UNLISTED_PREFIX): rooms named `_…` are joinable but never listed. */
export const UNLISTED_PREFIX = '_';

const ROOM_RE = /^[A-Za-z0-9_-]{1,24}$/;
const PHASES: readonly MatchPhase[] = ['warmup', 'live', 'ended'];

/** ws(s)://host[:port][/path][?query] → http(s)://host[:port]/rooms; null when it is not a WebSocket URL. */
export function roomsEndpoint(wsUrl: string | null | undefined): string | null {
  if (!wsUrl || !/^wss?:\/\//i.test(wsUrl.trim())) return null;
  try {
    const u = new URL(wsUrl.trim());
    return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}/rooms`;
  } catch { return null; }
}

/** The server URL without its `room` parameter (joins pass the room separately: `?server=…&room=…`). */
export function serverBase(wsUrl: string): string {
  const raw = wsUrl.trim();
  try {
    const u = new URL(raw);
    if (!u.searchParams.has('room')) return raw;
    u.searchParams.delete('room');
    return u.toString();
  } catch { return raw; }
}

const int = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null);

/** Validate an untrusted /rooms body: malformed rows are dropped, never rendered; at most `max` rows. */
export function parseRooms(body: unknown, max = ROOMS_MAX): RoomInfo[] {
  if (!Array.isArray(body)) return [];
  const out: RoomInfo[] = [];
  for (const r of body) {
    if (out.length >= max) break;
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const name = typeof o.name === 'string' && ROOM_RE.test(o.name) ? o.name : null;
    const mode = typeof o.mode === 'string' && /^[a-z0-9-]{1,32}$/.test(o.mode) ? o.mode : null;
    const humans = int(o.humans, 999), bots = int(o.bots, 999), maxPlayers = int(o.maxPlayers, 999);
    const players = int(o.players, 9999);
    const phase = PHASES.includes(o.phase as MatchPhase) ? (o.phase as MatchPhase) : null;
    if (!name || name.startsWith(UNLISTED_PREFIX) || !mode || humans === null || bots === null || maxPlayers === null || players === null || !phase) continue;
    const chapter = typeof o.chapter === 'string' && /^[a-z0-9_]{1,32}$/.test(o.chapter) ? o.chapter : undefined;
    out.push({ name, mode, players, humans, bots, maxPlayers, phase, ...(chapter ? { chapter } : {}) });
  }
  return out;
}

/** What someone typed as a new room name → a valid room name ('' if nothing usable). */
export function cleanRoomName(input: string, unlisted = false): string {
  const base = input.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '').replace(/^_+/, '').slice(0, unlisted ? 23 : 24);
  if (!base) return '';
  const name = unlisted ? `${UNLISTED_PREFIX}${base}` : base;
  return sanitizeRoomName(name) === name ? name : '';
}

export const MODE_LABELS: Record<string, string> = {
  'yard-skirmish': 'Yard Skirmish',
  'team-deathmatch': 'Team Deathmatch',
  'boss-rush': 'Boss Rush',
  'core-rush': 'Core Rush',
  adventure: 'Adventure',
};
/** "yard_day" → "Yard Day" (chapter ids are snake_case; titles live in content/chapters.ts). */
export const chapterLabel = (id: string): string => id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const modeLabel = (mode: string): string => MODE_LABELS[mode] ?? mode.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const PHASE_LABELS: Record<MatchPhase, string> = { warmup: 'WARMUP', live: 'IN PLAY', ended: 'POST-MATCH' };
export const isFull = (r: RoomInfo): boolean => r.humans >= r.maxPlayers;
/**
 * Joining an adventure room from the list: play that chapter's featured kit on the corgi side (a step can need it,
 * e.g. chapter 6's Ear Glide), like the chapter picker does. Null for other rooms (your own kit and team apply).
 */
export function adventureJoinKit(r: Pick<RoomInfo, 'mode' | 'chapter'>): { chapter: string; cls: ClassId } | null {
  if (r.mode !== 'adventure' || !r.chapter) return null;
  const def = chapterById(r.chapter);
  return def ? { chapter: def.id, cls: def.cls } : null;
}

export type RoomsState =
  | { kind: 'idle' }
  | { kind: 'bad-url' }
  | { kind: 'loading' }
  | { kind: 'ready'; rooms: RoomInfo[]; at: number }
  | { kind: 'empty'; at: number }
  /** error/busy/offline keep the last good list (if any) so a blip doesn't blank the screen. */
  | { kind: 'error' | 'busy' | 'offline'; rooms: RoomInfo[] };

export type FetchLike = (url: string, init: { signal: AbortSignal; cache: 'no-store'; credentials: 'omit' }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface RoomPollerDeps {
  fetch?: FetchLike;
  /** navigator.onLine (default: true when unknown). */
  online?(): boolean;
  now?(): number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(t: unknown): void;
  intervalMs?: number;
  timeoutMs?: number;
}

/** Polls one server's /rooms every intervalMs while started. Emits every state change to `onChange`. */
export class RoomPoller {
  state: RoomsState = { kind: 'idle' };
  onChange: (s: RoomsState) => void = () => {};
  private url: string | null = null;
  private timer: unknown = null;
  private ctrl: AbortController | null = null;
  private gen = 0;
  private last: RoomInfo[] = [];
  private failures = 0;
  private readonly d: Required<RoomPollerDeps>;

  constructor(deps: RoomPollerDeps = {}) {
    this.d = {
      fetch: deps.fetch ?? ((u, i) => globalThis.fetch(u, i)),
      online: deps.online ?? (() => (typeof navigator === 'undefined' || navigator.onLine !== false)),
      now: deps.now ?? (() => Date.now()),
      setTimer: deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)),
      intervalMs: deps.intervalMs ?? ROOMS_REFRESH_MS,
      timeoutMs: deps.timeoutMs ?? ROOMS_TIMEOUT_MS,
    };
  }

  get running(): boolean { return this.url !== null || this.state.kind === 'bad-url'; }

  /** Start (or switch) polling the server at `wsUrl`. */
  start(wsUrl: string): void {
    const url = roomsEndpoint(wsUrl);
    if (url && url === this.url) return; // already polling it
    this.stop();
    if (!url) { this.set({ kind: 'bad-url' }); return; }
    this.url = url;
    this.last = [];
    this.failures = 0;
    this.set({ kind: 'loading' });
    void this.poll();
  }

  stop(): void {
    this.gen++;
    this.url = null;
    if (this.timer !== null) this.d.clearTimer(this.timer);
    this.timer = null;
    this.ctrl?.abort();
    this.ctrl = null;
    if (this.state.kind !== 'idle') this.set({ kind: 'idle' });
  }

  /** Poll now (Retry button); the regular cadence restarts from here. */
  refresh(): void {
    if (!this.url) return;
    if (this.timer !== null) this.d.clearTimer(this.timer);
    this.timer = null;
    if (!this.last.length) this.set({ kind: 'loading' });
    void this.poll();
  }

  private async poll(): Promise<void> {
    const gen = ++this.gen;
    const url = this.url;
    if (!url) return;
    this.ctrl?.abort();
    if (!this.d.online()) { this.finish(gen, { kind: 'offline', rooms: this.last }); return; }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    this.ctrl = ctrl;
    const timeout = this.d.setTimer(() => ctrl?.abort(), this.d.timeoutMs);
    let next: RoomsState;
    try {
      const res = await this.d.fetch(url, { signal: ctrl?.signal as AbortSignal, cache: 'no-store', credentials: 'omit' });
      if (res.status === 429 || res.status === 503) next = { kind: 'busy', rooms: this.last };
      else if (!res.ok) next = { kind: 'error', rooms: this.last };
      else {
        const rooms = parseRooms(await res.json());
        this.last = rooms;
        next = rooms.length ? { kind: 'ready', rooms, at: this.d.now() } : { kind: 'empty', at: this.d.now() };
      }
    } catch {
      next = this.d.online() ? { kind: 'error', rooms: this.last } : { kind: 'offline', rooms: this.last };
    } finally {
      this.d.clearTimer(timeout);
    }
    this.finish(gen, next);
  }

  private finish(gen: number, next: RoomsState): void {
    if (gen !== this.gen || !this.url) return; // stopped or superseded while in flight
    this.set(next);
    this.failures = next.kind === 'ready' || next.kind === 'empty' ? 0 : this.failures + 1;
    const wait = Math.min(ROOMS_MAX_BACKOFF_MS, this.d.intervalMs * 2 ** Math.max(0, this.failures - 1));
    this.timer = this.d.setTimer(() => { this.timer = null; void this.poll(); }, wait);
  }

  private set(s: RoomsState): void {
    this.state = s;
    this.onChange(s);
  }
}
