// OWNER: U1 (ux). First-match tips (FTUE, game-design-psychology §5: teach the core loop in play, not in a modal).
//
// Three contextual tips, each shown once, during the player's first match only:
//   basics  1.5 s after you first spawn        [WASD] move · [MOUSE] aim · [LMB] fire · [RMB] zoom
//   kiosk   the first time you stand at your team's Ordnance Kiosk (its "E change kit" prompt is up)
//   moves   after 60 s of play                 slide (crouch while sprinting) · ground-pound (crouch in the air)
// A tip ends after its duration, early once you have done what it teaches (never before 3 s), or (kiosk) when you
// walk away. A tip counts as seen after 2 s on screen; one cut short sooner comes back at the next chance. "moves" is
// skipped silently if you already slid and ground-pounded. When the first match you played at least 10 s of ends,
// tips are done for good. State persists in localStorage (try/catch: privacy mode must not break the HUD); Settings
// › "Show again" resets it. Tips only run while you are actually playing (no menu, chat or death screen), sit
// bottom-centre under the character (never over the crosshair) and never take input.
import type { MatchPhase } from '../../shared/protocol';
import type { KV } from './settings';
import { safeStorage } from './settings';
import { TIP_STRINGS, TIP_TEXT } from './strings';

export type TipId = keyof typeof TIP_TEXT;
export const TIP_IDS: readonly TipId[] = ['basics', 'kiosk', 'moves'];
export const TIPS_KEY = 'cvc.tips';

export const TIP_RULES = {
  /** Seconds of play after the first spawn before the basics tip. */
  basicsDelay: 1.5,
  /** Seconds of play before the movement tip. */
  movesAfter: 60,
  /** On screen this long = seen (a tip interrupted sooner shows again later). */
  minSeen: 2,
  /** Seconds between two tips. */
  gap: 3,
  /** Doing the thing ends a tip early, but not before this. */
  minBeforeDone: 3,
  /** Kiosk tip ends after you have been away from the kiosk this long. */
  kioskAway: 1.5,
  /** A match that ends before this much play does not count as your first match. */
  firstMatchMinPlay: 10,
  duration: { basics: 10, kiosk: 7, moves: 9 } as Record<TipId, number>,
};

export interface TipFrame {
  /** You are playing right now: in a match, alive, HUD visible (no menu, chat or death screen). */
  active: boolean;
  phase: MatchPhase | null;
  /** Your team's Ordnance Kiosk is in reach (the same rule as its E prompt). */
  nearKiosk: boolean;
  moving: boolean;
  firing: boolean;
  aiming: boolean;
}

interface Stored { v: 1; seen: TipId[]; done: boolean }

export class TipScheduler {
  private seen = new Set<TipId>();
  private done = false;
  private play = 0;
  private cooldown = 0;
  private current: { id: TipId; shown: number; away: number } | null = null;
  private lastPhase: MatchPhase | null = null;
  private did = { moved: false, fired: false, aimed: false, slid: false, pounded: false };

  constructor(private readonly store: KV | null = safeStorage()) { this.load(); }

  /** True once every tip is seen or the first match is over: tips never show again (until reset). */
  get finished(): boolean { return this.done || TIP_IDS.every((id) => this.seen.has(id)); }
  isSeen(id: TipId): boolean { return this.seen.has(id); }
  /** Seconds of active play counted so far this match. */
  get playTime(): number { return this.play; }

  /** Local slide / ground-pound (NetClient emits them as `ability` events). */
  onAction(ability: string): void {
    if (ability === 'slide') this.did.slid = true;
    else if (ability === 'ground_pound') this.did.pounded = true;
  }

  /** Advance by `dt` seconds; returns the tip to show now, or null. */
  update(dt: number, f: TipFrame): TipId | null {
    if (f.phase !== this.lastPhase) {
      if (f.phase === 'ended' && !this.done && this.play >= TIP_RULES.firstMatchMinPlay) {
        this.done = true;
        this.current = null;
        this.save();
      }
      this.lastPhase = f.phase;
    }
    if (this.done || !f.active) return null; // hidden; every timer pauses
    const step = Math.max(0, Math.min(dt, 0.25));
    this.play += step;
    if (f.moving) this.did.moved = true;
    if (f.firing) this.did.fired = true;
    if (f.aiming) this.did.aimed = true;

    const c = this.current;
    if (c) {
      c.shown += step;
      c.away = c.id === 'kiosk' && !f.nearKiosk ? c.away + step : 0;
      const learned = c.shown >= TIP_RULES.minBeforeDone && this.learned(c.id);
      if (c.shown >= TIP_RULES.minSeen || learned) this.markSeen(c.id);
      if (c.shown < TIP_RULES.duration[c.id] && !learned && c.away < TIP_RULES.kioskAway) return c.id;
      this.current = null;
      this.cooldown = TIP_RULES.gap;
      return null;
    }
    if (this.cooldown > 0) { this.cooldown -= step; return null; }
    const next = this.pick(f);
    if (!next) return null;
    this.current = { id: next, shown: 0, away: 0 };
    return next;
  }

  /** Settings › Show again: forget everything (tips return from the next moment you play). */
  reset(): void {
    this.seen.clear();
    this.done = false;
    this.play = 0;
    this.cooldown = 0;
    this.current = null;
    this.did = { moved: false, fired: false, aimed: false, slid: false, pounded: false };
    this.save();
  }

  private pick(f: TipFrame): TipId | null {
    if (!this.seen.has('basics') && this.play >= TIP_RULES.basicsDelay) return 'basics';
    if (!this.seen.has('kiosk') && f.nearKiosk) return 'kiosk';
    if (!this.seen.has('moves') && this.play >= TIP_RULES.movesAfter) {
      if (this.learned('moves')) { this.markSeen('moves'); return null; } // already does both: nothing to teach
      return 'moves';
    }
    return null;
  }

  private learned(id: TipId): boolean {
    const d = this.did;
    if (id === 'basics') return d.moved && d.fired && d.aimed;
    if (id === 'moves') return d.slid && d.pounded;
    return false;
  }

  private markSeen(id: TipId): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.save();
  }

  private load(): void {
    try {
      const raw = this.store?.getItem(TIPS_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) as Partial<Stored>;
      if (Array.isArray(o.seen)) for (const id of o.seen) if ((TIP_IDS as readonly string[]).includes(id)) this.seen.add(id);
      this.done = o.done === true;
    } catch { /* corrupt or unavailable storage: start fresh */ }
  }

  private save(): void {
    try { this.store?.setItem(TIPS_KEY, JSON.stringify({ v: 1, seen: [...this.seen], done: this.done } satisfies Stored)); } catch { /* storage full / blocked */ }
  }
}

/** `[E]`-style keycaps → parts (pure, tested). */
export function tipParts(text: string): Array<{ key: string } | { text: string }> {
  const out: Array<{ key: string } | { text: string }> = [];
  const re = /\[([^\]]{1,12})\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ key: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export interface TipView {
  readonly el: HTMLElement;
  /** Show this tip (null hides). Cheap to call every frame. */
  show(id: TipId | null): void;
}

export function createTipView(parent: HTMLElement): TipView {
  const el = document.createElement('div');
  el.className = 'tip hidden';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const tag = document.createElement('span');
  tag.className = 'tip-tag';
  tag.textContent = TIP_STRINGS.tag;
  const body = document.createElement('span');
  body.className = 'tip-body';
  el.append(tag, body);
  parent.appendChild(el);
  let shown: TipId | null = null;
  return {
    el,
    show(id) {
      if (id === shown) return;
      shown = id;
      el.classList.toggle('hidden', !id);
      if (!id) return;
      body.textContent = '';
      for (const p of tipParts(TIP_TEXT[id])) {
        if ('key' in p) { const k = document.createElement('kbd'); k.textContent = p.key; body.appendChild(k); }
        else body.appendChild(document.createTextNode(p.text));
      }
      el.animate?.([{ transform: 'translateX(-50%) translateY(12px) scale(.9)', opacity: 0 }, { transform: 'translateX(-50%)', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,1.5,.4,1)' });
    },
  };
}
