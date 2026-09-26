// OWNER: U1 (ux). Chat feed model: pure (no DOM), so the rules are unit-tested (tests/unit/ui-chat.test.ts).
//
// Rules:
//  - Text is cleaned exactly like the authority does (host/guard cleanText: control + bidi characters stripped,
//    whitespace collapsed, max 120 chars). The model never produces markup: the view renders with textContent.
//  - The authority drops a player's chat when it arrives < 0.5 s after the previous one (room.ts). The client keeps
//    a wider gap (CHAT_MIN_GAP) so it never sends a message the server would silently drop.
//  - Your own line shows as `pending` until the server echoes it back (every chat is broadcast to the sender too),
//    then `sent`; no echo within CHAT_PENDING_TIMEOUT (dropped / disconnected) → `failed`.
//  - Closed chat: the newest CHAT_FEED_LINES lines, each visible for CHAT_FADE_AFTER s (fading in its last
//    CHAT_FADE_TIME s). Open chat: the whole history (CHAT_HISTORY lines), fully opaque.
import { cleanText } from '../../host/guard';

export const CHAT_MAX_LEN = 120;
/** Seconds a line stays in the closed feed. */
export const CHAT_FADE_AFTER = 8;
/** The last second of that fades out. */
export const CHAT_FADE_TIME = 1;
/** Lines the closed feed shows at most. */
export const CHAT_FEED_LINES = 6;
/** Lines kept for the open history. */
export const CHAT_HISTORY = 50;
/** Client-side minimum gap between sends (the authority's limit is 0.5 s, measured in ticks on arrival). */
export const CHAT_MIN_GAP = 0.75;
/** A pending line with no echo after this long is marked failed. */
export const CHAT_PENDING_TIMEOUT = 4;

export type ChatLineKind = 'chat' | 'system';
/** received: someone else's line · pending/sent/failed: your own line before/after the server echo. */
export type ChatLineState = 'received' | 'pending' | 'sent' | 'failed';

export interface ChatLine {
  id: number;
  kind: ChatLineKind;
  /** Sender name (empty for system lines). */
  from: string;
  /** Sender's team (colors the name); -1 = unknown / system. */
  team: -1 | 0 | 1;
  text: string;
  /** Clock time (s) the line (re)appeared; the closed-feed fade counts from here. */
  at: number;
  state: ChatLineState;
  /** The local player's own line. */
  self: boolean;
}

export type SendResult =
  | { ok: true; text: string; line: ChatLine }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'rate'; waitSec: number };

export interface VisibleLine { line: ChatLine; opacity: number }

/** The authority's chat cleaning, applied client-side so pending lines match their echo exactly. */
export function cleanChatText(raw: unknown): string {
  return typeof raw === 'string' ? cleanText(raw, CHAT_MAX_LEN) : '';
}

/** Player names from the server are already sanitized; clean again anyway (a hostile server must not inject). */
export function cleanChatName(raw: unknown): string {
  return typeof raw === 'string' ? cleanText(raw, 16) : '';
}

export class ChatFeed {
  readonly lines: ChatLine[] = [];
  /** Bumped on every change the view must re-render (not on pure fade progress). */
  version = 0;
  private nextId = 1;
  private lastSendAt = -Infinity;

  /**
   * Try to send `raw` as the local player. On success the line is added as `pending` and the cleaned text is
   * returned for the transport. Too soon after the last send → `rate` (keep the draft, retry after waitSec).
   */
  send(raw: string, now: number, me: { name: string; team: -1 | 0 | 1 }): SendResult {
    const text = cleanChatText(raw);
    if (!text) return { ok: false, reason: 'empty' };
    const since = now - this.lastSendAt;
    if (since < CHAT_MIN_GAP) return { ok: false, reason: 'rate', waitSec: CHAT_MIN_GAP - since };
    this.lastSendAt = now;
    const line = this.push({ kind: 'chat', from: me.name, team: me.team, text, at: now, state: 'pending', self: true });
    return { ok: true, text, line };
  }

  /** The transport refused to send (not connected): the pending line fails at once. */
  markFailed(line: ChatLine): void {
    if (line.state !== 'pending') return;
    line.state = 'failed';
    this.version++;
  }

  /**
   * A chat line from the authority. If it is the echo of our oldest matching pending line (same name + text), that
   * line becomes `sent` instead of appearing twice.
   */
  receive(from: string, text: string, now: number, team: -1 | 0 | 1, myName: string | null): ChatLine | null {
    const name = cleanChatName(from);
    const body = cleanChatText(text);
    if (!body) return null;
    if (myName && name === myName) {
      const mine = this.lines.find((l) => l.self && (l.state === 'pending' || l.state === 'failed') && l.text === body);
      if (mine) {
        mine.state = 'sent';
        mine.at = now;
        mine.team = team >= 0 ? team : mine.team;
        this.version++;
        return mine;
      }
    }
    return this.push({ kind: 'chat', from: name || '???', team, text: body, at: now, state: 'received', self: !!myName && name === myName });
  }

  /** Server notice / presence line ("Rex joined the yard"). */
  system(text: string, now: number): ChatLine | null {
    const body = cleanText(typeof text === 'string' ? text : '', 160);
    if (!body) return null;
    return this.push({ kind: 'system', from: '', team: -1, text: body, at: now, state: 'received', self: false });
  }

  /** Expire pending lines with no echo. Returns true when something changed. */
  tick(now: number): boolean {
    let changed = false;
    for (const l of this.lines) {
      if (l.state === 'pending' && now - l.at > CHAT_PENDING_TIMEOUT) { l.state = 'failed'; changed = true; }
    }
    if (changed) this.version++;
    return changed;
  }

  /** Lines to draw now, oldest first, with their opacity. */
  visible(now: number, open: boolean): VisibleLine[] {
    if (open) return this.lines.map((line) => ({ line, opacity: 1 }));
    const out: VisibleLine[] = [];
    for (let i = this.lines.length - 1; i >= 0 && out.length < CHAT_FEED_LINES; i--) {
      const line = this.lines[i];
      const age = now - line.at;
      // Pending lines stay until they resolve; everything else fades after CHAT_FADE_AFTER.
      if (line.state !== 'pending' && age >= CHAT_FADE_AFTER) continue; // (an echo refreshes `at`: not strictly ordered)
      const fadeStart = CHAT_FADE_AFTER - CHAT_FADE_TIME;
      const opacity = line.state === 'pending' || age <= fadeStart ? 1 : Math.max(0, 1 - (age - fadeStart) / CHAT_FADE_TIME);
      out.push({ line, opacity });
    }
    return out.reverse();
  }

  /**
   * Fill in teams that were unknown when a line arrived (chat can beat the roster that names its sender).
   * Returns true when a line changed.
   */
  resolveTeams(teamOf: (name: string) => -1 | 0 | 1): boolean {
    let changed = false;
    for (const l of this.lines) {
      if (l.kind !== 'chat' || l.team !== -1) continue;
      const t = teamOf(l.from);
      if (t !== -1) { l.team = t; changed = true; }
    }
    if (changed) this.version++;
    return changed;
  }

  clear(): void {
    this.lines.length = 0;
    this.version++;
  }

  private push(l: Omit<ChatLine, 'id'>): ChatLine {
    const line: ChatLine = { id: this.nextId++, ...l };
    this.lines.push(line);
    if (this.lines.length > CHAT_HISTORY) this.lines.splice(0, this.lines.length - CHAT_HISTORY);
    this.version++;
    return line;
  }
}

/** Team of the player called `name` in the roster (first match; names are not unique), else -1. */
export function teamOfName(roster: ReadonlyArray<{ name: string; team: number }>, name: string): -1 | 0 | 1 {
  for (const r of roster) if (r.name === name) return r.team === 1 ? 1 : r.team === 0 ? 0 : -1;
  return -1;
}

/** Presence notices from server/app.ts ("<name> joined the yard" / "<name> left the yard"): chat feed only, no toast. */
export const PRESENCE_RE = /^.{1,16} (joined|left) the yard$/;
export const isPresenceNotice = (text: string): boolean => PRESENCE_RE.test(text);
