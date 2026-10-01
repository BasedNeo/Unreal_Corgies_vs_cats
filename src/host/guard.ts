// Untrusted-input guard for the authority: strict ClientMsg validation, token-bucket rate limits and
// an abuse score that decays over time. Pure (no Node/DOM APIs) so the Node server, the offline worker
// and the in-process test harness all validate exactly the same way.
import type { ClientMsg } from '../shared/protocol';
import { sanitizeInput, type InputCmd } from '../shared/input';
import { CLASS_IDS, type ClassId, type TeamId } from '../shared/types';
import { CHAPTERS, chapterById } from '../shared/content/chapters';
import { BOSS_IDS } from '../shared/content/bosses';
import { mapForRoom, type MapId } from '../shared/world/maps';
import { sanitizeLook } from '../shared/content/cosmetics';

/** Most commands one input message may carry (new + redundant resends). */
export const MAX_CMDS_PER_MSG = 32;
/** Largest accepted text frame, checked before JSON.parse. */
export const MAX_MSG_BYTES = 8 * 1024;
const MAX_NAME = 16;
const MAX_CHAT = 120;

/** Result of validation: a well-formed message, or a reason it was refused. */
export type Validated = { ok: true; msg: ClientMsg } | { ok: false; reason: string };

const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]', 'g');

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Strip control/bidi characters and collapse whitespace. */
export function cleanText(s: string, max: number): string {
  return s.replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Validate an untrusted, already JSON-parsed client message. Unknown types, wrong field types,
 * oversize arrays and non-finite numbers are refused; inputs are sanitized (clamped) here.
 */
export function validateClientMsg(raw: unknown): Validated {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not an object' };
  const r = raw as Record<string, unknown>;
  switch (r.t) {
    case 'hello': {
      if (!finite(r.v)) return { ok: false, reason: 'hello.v' };
      const name = typeof r.name === 'string' ? cleanText(r.name, 64).replace(/[^\w \-.]/g, '').slice(0, MAX_NAME) : '';
      const team: TeamId | -1 = r.team === 0 || r.team === 1 ? r.team : -1;
      const cls: ClassId = typeof r.cls === 'string' && (CLASS_IDS as readonly string[]).includes(r.cls) ? (r.cls as ClassId) : 'assault';
      // N2: looks are sanitized here, so the Room never sees raw input (unknown ids, wrong species, huge strings dropped)
      const L = r.looks && typeof r.looks === 'object' && !Array.isArray(r.looks) ? (r.looks as Record<string, unknown>) : {};
      const own = (k: string) => (Object.prototype.hasOwnProperty.call(L, k) ? L[k] : undefined);
      const looks = { corgi: sanitizeLook(own('corgi'), 'corgi'), cat: sanitizeLook(own('cat'), 'cat') };
      return { ok: true, msg: { t: 'hello', v: r.v, name: name || 'Player', team, cls, looks } };
    }
    case 'input': {
      if (!Array.isArray(r.cmds) || r.cmds.length === 0) return { ok: false, reason: 'input.cmds' };
      if (r.cmds.length > MAX_CMDS_PER_MSG) return { ok: false, reason: 'input.cmds too long' };
      // Structure check only: the Room sanitizes each command exactly once (sanitizing twice is not
      // bit-identical for yaw, and client prediction must replay the authority's exact inputs).
      const cmds: InputCmd[] = [];
      for (const c of r.cmds) {
        const s = sanitizeInput(c);
        if (s && s.seq > 0 && s.seq <= Number.MAX_SAFE_INTEGER) cmds.push(c as InputCmd);
      }
      if (!cmds.length) return { ok: false, reason: 'input.cmds invalid' };
      if (cmds.length < r.cmds.length) return { ok: false, reason: 'input.cmds partly invalid' };
      return { ok: true, msg: { t: 'input', cmds } };
    }
    case 'ping':
      if (!finite(r.id) || !finite(r.ct)) return { ok: false, reason: 'ping fields' };
      return { ok: true, msg: { t: 'ping', id: r.id, ct: r.ct } };
    case 'class':
      if (typeof r.cls !== 'string' || !(CLASS_IDS as readonly string[]).includes(r.cls)) return { ok: false, reason: 'class.cls' };
      return { ok: true, msg: { t: 'class', cls: r.cls as ClassId } };
    case 'team':
      if (r.team !== 0 && r.team !== 1) return { ok: false, reason: 'team.team' };
      return { ok: true, msg: { t: 'team', team: r.team } };
    case 'chat': {
      if (typeof r.text !== 'string') return { ok: false, reason: 'chat.text' };
      const text = cleanText(r.text, MAX_CHAT);
      if (!text) return { ok: false, reason: 'chat empty' };
      return { ok: true, msg: { t: 'chat', text } };
    }
    case 'look': {
      if (r.species !== 'corgi' && r.species !== 'cat') return { ok: false, reason: 'look.species' };
      return { ok: true, msg: { t: 'look', species: r.species, look: sanitizeLook(r.look, r.species) } };
    }
    default:
      return { ok: false, reason: 'unknown type' };
  }
}

const ROOM_RE = /^[A-Za-z0-9_-]{1,24}$/;

/** Room names are 1-24 chars of [A-Za-z0-9_-]; anything else maps to the default room. */
export function sanitizeRoomName(name: string | null | undefined): string {
  return name && ROOM_RE.test(name) ? name : 'default';
}

/** Parse + validate a raw text frame. Oversize frames are refused before parsing. */
export function parseClientFrame(text: string): Validated {
  if (text.length > MAX_MSG_BYTES) return { ok: false, reason: 'frame too large' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, reason: 'malformed json' }; }
  return validateClientMsg(raw);
}

/** Classic token bucket. `take()` returns false when the caller is over its rate. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(readonly capacity: number, readonly perSecond: number, now: number) {
    this.tokens = capacity;
    this.last = now;
  }
  take(now: number, cost = 1): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/**
 * Abuse score with exponential decay: each strike adds its weight, the score halves every
 * `halfLifeMs`. `strike()` returns true once the score crosses the kick threshold.
 */
export class AbuseMeter {
  score = 0;
  total = 0;
  private last: number;
  constructor(readonly threshold: number, readonly halfLifeMs: number, now: number) {
    this.last = now;
  }
  strike(now: number, weight = 1): boolean {
    this.score = this.score * Math.pow(0.5, Math.max(0, now - this.last) / this.halfLifeMs) + weight;
    this.last = now;
    this.total++;
    return this.score >= this.threshold;
  }
}

/** Match modes a room can be created with (the first joiner's ?mode= picks it; later joiners get the room as is). */
export const ROOM_MODES = ['yard-skirmish', 'team-deathmatch', 'core-rush', 'base-assault', 'boss-rush', 'adventure', 'slab'] as const; // W13: slab plays on The Lot (maps.ts MODE_HOME)
export type RoomMode = (typeof ROOM_MODES)[number];

/**
 * A requested room setup from untrusted query params: known modes only. An adventure room always carries the chapter
 * it will really run (an unknown or missing id → the first chapter, as the sim would), so `/rooms` never lists a
 * chapter the room isn't playing (Q2 P2-3). A boss id must be a known boss (else the sim's default boss runs).
 * The map is always the one the room will run: a registered map that can host the mode, else the default map.
 */
export function sanitizeRoomSetup(mode: string | null, chapter: string | null, boss: string | null = null, map: string | null = null): { mode: RoomMode; chapter?: string; boss?: string; map: MapId } | null {
  if (!mode || !(ROOM_MODES as readonly string[]).includes(mode)) return null;
  const ch = mode === 'adventure' ? (chapterById(chapter)?.id ?? CHAPTERS[0].id) : undefined;
  const b = mode === 'boss-rush' && boss && (BOSS_IDS as readonly string[]).includes(boss) ? boss : undefined;
  return { mode: mode as RoomMode, ...(ch ? { chapter: ch } : {}), ...(b ? { boss: b } : {}), map: mapForRoom(map, mode, chapterById(ch)?.map) }; // W10: a chapter's own map
}
