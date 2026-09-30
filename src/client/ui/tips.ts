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
//
// W10 U3 (ux-3): Base Assault tips, during the player's first Base Assault match (the first match of the mode with at
// least 10 s of play, whatever came before it), each once, in the same slot and by the same rules:
//   ba_goal    4 s into the mode                 steal their ball, run it home, touch your ring to capture
//   ba_return  the first time our ball is down   touch it to send it home (else it goes back by itself)
//   ba_home    the first time they carry ours    we capture only while our own ball is home: stop their carrier
//   ba_carry   the first time a teammate carries theirs   escort: a carrier is slower, no glide, no rides
// The situational three end when the situation does (the ball is home again, the carry is over); ba_goal is skipped
// silently if you already carried a ball. While you carry, the carrier cue owns the slot (HudModel.cueUp) and tips
// wait. Their state has its own key (cvc.tips.ba) so the first-match record keeps its shape; Show again resets both.
// The HUD passes the Base Assault picture as TipFrame.ba (baseAssaultTipFacts, from the snapshot's ball props).
import type { EntityState, MatchPhase } from '../../shared/protocol';
import { EntityKind } from '../../shared/types';
import { BA_BALL_SEED, BallState } from '../../shared/content/modes';
import type { KV } from './settings';
import { safeStorage } from './settings';
import { TIP_STRINGS, TIP_TEXT } from './strings';

export type TipId = keyof typeof TIP_TEXT;
export const TIP_IDS: readonly TipId[] = ['basics', 'kiosk', 'moves'];
/** W10 U3: the first-Base-Assault-match tips. */
export const BA_TIP_IDS: readonly TipId[] = ['ba_goal', 'ba_return', 'ba_home', 'ba_carry'];
export const TIPS_KEY = 'cvc.tips';
/** W10 U3: where the Base Assault tips' seen / done state persists. */
export const TIPS_BA_KEY = 'cvc.tips.ba';

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
  /** Seconds of Base Assault play before the goal tip (W10 U3). */
  baGoalDelay: 4,
  duration: { basics: 10, kiosk: 7, moves: 9, ba_goal: 10, ba_return: 8, ba_home: 8, ba_carry: 8 } as Record<TipId, number>,
};

export type BallStateName = 'home' | 'taken' | 'dropped';

/** W10 U3: the Base Assault picture the tips need, from the local player's side. */
export interface BaTipFacts {
  /** Our own ball. */
  own: BallStateName;
  /** Their ball. */
  enemy: BallStateName;
  /** You carry their ball. */
  localCarrying: boolean;
  /** A teammate (not you) carries their ball. */
  teamCarrying: boolean;
}

export interface TipFrame {
  /** You are playing right now: in a match, alive, HUD visible (no menu, chat or death screen). */
  active: boolean;
  phase: MatchPhase | null;
  /** Your team's Ordnance Kiosk is in reach (the same rule as its E prompt). */
  nearKiosk: boolean;
  moving: boolean;
  firing: boolean;
  aiming: boolean;
  /** W10 U3: a Base Assault match is on (baseAssaultTipFacts); absent / null in other modes. */
  ba?: BaTipFacts | null;
}

interface Stored { v: 1; seen: TipId[]; done: boolean }

/**
 * W10 U3: the Base Assault facts for the tips, read from the snapshot's ball props (layout: shared/content/modes.ts),
 * or null when no Base Assault match runs (`mode` given and not base-assault, no balls, no team yet).
 */
export function baseAssaultTipFacts(states: ReadonlyMap<number, EntityState>, localId: number, mode?: string | null): BaTipFacts | null {
  if (mode != null && mode !== 'base-assault') return null;
  const local = states.get(localId);
  if (!local || (local.team !== 0 && local.team !== 1)) return null;
  let own: BallStateName | null = null, enemy: BallStateName | null = null, carrier = -1;
  for (const s of states.values()) {
    if (s.kind !== EntityKind.Prop || s.seed !== BA_BALL_SEED || (s.team !== 0 && s.team !== 1)) continue;
    const st: BallStateName = s.weapon === BallState.Carried ? 'taken' : s.weapon === BallState.Dropped ? 'dropped' : 'home';
    if (s.team === local.team) own = st;
    else { enemy = st; carrier = st === 'taken' ? s.ammo : -1; }
  }
  if (!own || !enemy) return null;
  const localCarrying = carrier === localId;
  return { own, enemy, localCarrying, teamCarrying: enemy === 'taken' && !localCarrying }; // only our side carries theirs
}

export class TipScheduler {
  private seen = new Set<TipId>();
  private done = false;
  private play = 0;
  private cooldown = 0;
  private current: { id: TipId; shown: number; away: number } | null = null;
  private lastPhase: MatchPhase | null = null;
  private did = { moved: false, fired: false, aimed: false, slid: false, pounded: false, carried: false };
  // W10 U3: the first Base Assault match
  private baSeen = new Set<TipId>();
  private baDone = false;
  private baPlay = 0;

  constructor(private readonly store: KV | null = safeStorage()) { this.load(); }

  /** True once every tip is seen or the first match is over: tips never show again (until reset). */
  get finished(): boolean { return this.done || TIP_IDS.every((id) => this.seen.has(id)); }
  /** W10 U3: the Base Assault tips are over (every one seen, or the first Base Assault match ended). */
  get baFinished(): boolean { return this.baDone || BA_TIP_IDS.every((id) => this.baSeen.has(id)); }
  isSeen(id: TipId): boolean { return this.seen.has(id) || this.baSeen.has(id); }
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
      if (f.phase === 'ended' && !this.baDone && this.baPlay >= TIP_RULES.firstMatchMinPlay) {
        this.baDone = true;
        if (this.current && isBaTip(this.current.id)) this.current = null;
        this.saveBa();
      }
      this.lastPhase = f.phase;
    }
    const general = !this.done, ba = !this.baDone && !!f.ba;
    if (this.current && isBaTip(this.current.id) && !ba) this.current = null; // left the mode
    if (f.ba?.localCarrying) this.did.carried = true; // (while you carry, the carrier cue pauses tips: note it first)
    if ((!general && !ba) || !f.active) return null; // hidden; every timer pauses
    const step = Math.max(0, Math.min(dt, 0.25));
    this.play += step;
    if (ba) this.baPlay += step;
    if (f.moving) this.did.moved = true;
    if (f.firing) this.did.fired = true;
    if (f.aiming) this.did.aimed = true;

    const c = this.current;
    if (c) {
      c.shown += step;
      c.away = this.gone(c.id, f) ? c.away + step : 0;
      const learned = c.shown >= TIP_RULES.minBeforeDone && this.learned(c.id);
      if (c.shown >= TIP_RULES.minSeen || learned) this.markSeen(c.id);
      if (c.shown < TIP_RULES.duration[c.id] && !learned && c.away < TIP_RULES.kioskAway) return c.id;
      this.current = null;
      this.cooldown = TIP_RULES.gap;
      return null;
    }
    if (this.cooldown > 0) { this.cooldown -= step; return null; }
    const next = this.pick(f, general, ba);
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
    this.did = { moved: false, fired: false, aimed: false, slid: false, pounded: false, carried: false };
    this.baSeen.clear();
    this.baDone = false;
    this.baPlay = 0;
    this.save();
    this.saveBa();
  }

  private pick(f: TipFrame, general: boolean, ba: boolean): TipId | null {
    if (general && !this.seen.has('basics') && this.play >= TIP_RULES.basicsDelay) return 'basics';
    if (ba) {
      // the situation first (it is happening now), then the goal; all before the general kiosk / moves tips
      const b = f.ba!, un = (id: TipId) => !this.baSeen.has(id);
      if (un('ba_return') && b.own === 'dropped') return 'ba_return';
      if (un('ba_home') && b.own === 'taken') return 'ba_home';
      if (un('ba_carry') && b.teamCarrying) return 'ba_carry';
      if (un('ba_goal') && this.baPlay >= TIP_RULES.baGoalDelay) {
        if (!this.learned('ba_goal')) return 'ba_goal';
        this.markSeen('ba_goal'); // already carried a ball: nothing to teach
      }
    }
    if (!general) return null;
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
    if (id === 'ba_goal') return d.carried;
    return false;
  }

  /** The situation a tip is about is over (it ends after TIP_RULES.kioskAway of that). */
  private gone(id: TipId, f: TipFrame): boolean {
    switch (id) {
      case 'kiosk': return !f.nearKiosk;
      case 'ba_return': return f.ba?.own !== 'dropped';
      case 'ba_home': return f.ba?.own !== 'taken';
      case 'ba_carry': return !f.ba?.teamCarrying;
      default: return false;
    }
  }

  private markSeen(id: TipId): void {
    const set = isBaTip(id) ? this.baSeen : this.seen;
    if (set.has(id)) return;
    set.add(id);
    if (set === this.baSeen) this.saveBa(); else this.save();
  }

  private load(): void {
    const read = (key: string): Partial<Stored> | null => {
      try {
        const raw = this.store?.getItem(key);
        return raw ? (JSON.parse(raw) as Partial<Stored>) : null;
      } catch { return null; } // corrupt or unavailable storage: start fresh
    };
    const o = read(TIPS_KEY);
    if (o) {
      if (Array.isArray(o.seen)) for (const id of o.seen) if ((TIP_IDS as readonly string[]).includes(id)) this.seen.add(id);
      this.done = o.done === true;
    }
    const b = read(TIPS_BA_KEY);
    if (b) {
      if (Array.isArray(b.seen)) for (const id of b.seen) if (isBaTip(id)) this.baSeen.add(id);
      this.baDone = b.done === true;
    }
  }

  private save(): void {
    try { this.store?.setItem(TIPS_KEY, JSON.stringify({ v: 1, seen: [...this.seen], done: this.done } satisfies Stored)); } catch { /* storage full / blocked */ }
  }

  private saveBa(): void {
    try { this.store?.setItem(TIPS_BA_KEY, JSON.stringify({ v: 1, seen: [...this.baSeen], done: this.baDone } satisfies Stored)); } catch { /* storage full / blocked */ }
  }
}

function isBaTip(id: TipId): boolean { return (BA_TIP_IDS as readonly string[]).includes(id); }

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
