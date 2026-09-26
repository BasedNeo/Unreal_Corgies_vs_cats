// OWNER: P2/U2 (profile + ux). The end-of-match / end-of-chapter reward card: +XP with its lines, the XP bar (LEVEL UP
// when it rolls over), any NEW LOOK, and the next look to play for. rewardSummary() is pure (unit-tested); the card is
// a non-interactive overlay that never takes focus or input and never covers the adventure chapter card (it sits beside
// it) or the match scoreboard (it sits under it), so it can never block the next match or chapter.
// rewardSummary lives in src/client/profile/summary.ts (the profile store returns it) and is re-exported here.
import type { XpLine } from '../profile/xp';
import type { RewardSummary } from '../profile/summary';
import { injectHudStyle } from './hud-style';
import { itemPreview } from './locker';
import { REWARD_STRINGS as S } from './strings';

export { rewardSummary, type RewardLook, type RewardSummary } from '../profile/summary';

// ------------------------------------------------------------------------------------------------ card text (pure)
/** A reward line as the card prints it: "Knockouts ×4" · "+40". */
export function lineLabel(l: XpLine): string {
  switch (l.kind) {
    case 'medal': return S.medal(l.medal ?? 'bronze');
    case 'firstWin': return S.firstWin(l.mode ?? '');
    case 'knockouts': case 'steps': case 'cores': case 'pads': return `${S.lines[l.kind]} ×${l.count ?? 1}`;
    default: return S.lines[l.kind] ?? l.kind;
  }
}

export function rewardLines(sum: RewardSummary): Array<{ label: string; xp: string }> {
  return sum.lines.map((l) => ({ label: lineLabel(l), xp: `+${l.xp}` }));
}

// ------------------------------------------------------------------------------------------------ the card (DOM)
/**
 * Where the card sits: 'chapter' = beside the adventure chapter-complete card (right side, vertical); 'match' = under
 * the match-end scoreboard (bottom centre, compact). Neither covers its neighbour at any 16:9 or 4:3 size (--u units).
 */
export type RewardPlacement = 'chapter' | 'match';

export interface RewardCard {
  readonly el: HTMLElement;
  /** Show a summary (an empty one shows nothing). It fades out by itself after `seconds` (default 12). */
  show(sum: RewardSummary, placement?: RewardPlacement, seconds?: number): void;
  hide(): void;
  readonly shown: boolean;
  dispose(): void;
}

export interface RewardCardOptions {
  sound?(kind: 'open'): void;
  /** Default seconds on screen. */
  seconds?: number;
}

/** Look chips on the card (the rest read "+N more"; the LOCKER shows them all). */
const MAX_LOOK_CHIPS = 4;

const escT = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The reward overlay. It never takes pointer events, focus or keys (the chapter card's Enter / Backspace and the next
 * match are never blocked), and it hides by itself. Mount it on the page's UI root (main.ts `ui`).
 */
export function createRewardCard(parent: HTMLElement, opts: RewardCardOptions = {}): RewardCard {
  injectHudStyle();
  const el = document.createElement('div');
  el.className = 'cvc-rw hidden';
  el.setAttribute('aria-live', 'polite');
  parent.appendChild(el);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fade: ReturnType<typeof setTimeout> | null = null;
  const clear = () => { if (timer) clearTimeout(timer); if (fade) clearTimeout(fade); timer = fade = null; };
  /** The match-end scoreboard moves up while the bottom card shows (hud-style.ts: body.cvc-rw-bottom). */
  const setBottom = (on: boolean) => { if (typeof document !== 'undefined') document.body?.classList.toggle('cvc-rw-bottom', on); };
  const card: RewardCard = {
    el,
    show(sum, placement = 'match', seconds = opts.seconds ?? 12) {
      clear();
      if (sum.empty) { el.classList.add('hidden'); setBottom(false); return; }
      el.className = `cvc-rw ${placement === 'chapter' ? 'side' : 'bottom'}`;
      setBottom(placement !== 'chapter');
      const lines = rewardLines(sum).map((l) => `<li><span>${escT(l.label)}</span><b>${escT(l.xp)}</b></li>`).join('');
      const shownLooks = sum.newLooks.slice(0, MAX_LOOK_CHIPS), more = sum.newLooks.length - shownLooks.length;
      const looks = shownLooks.map((l) => `<span class="rw-look">${l.slot ? itemPreview({ id: l.id, slot: l.slot as 'coat' }) : ''}<span>${escT(l.name)}</span></span>`).join('') + (more > 0 ? `<span class="rw-more">${escT(S.more(more))}</span>` : '');
      const next = sum.next ? S.next(sum.next.level, sum.next.looks[0]?.name ?? '') : '';
      el.innerHTML = `<div class="rw-card" role="status">
        <div class="rw-head"><span class="rw-xp">${escT(S.xp(sum.xp))}</span>${sum.levelUps ? `<span class="rw-up">${S.levelUp}</span>` : ''}</div>
        <ul class="rw-lines">${lines}</ul>
        <div class="rw-lvl"><span class="rw-lv">${escT(S.level(sum.levelAfter))}</span><div class="rw-bar"><i></i></div></div>
        ${sum.newLooks.length ? `<div class="rw-new"><div class="rw-nt">${sum.newLooks.length === 1 ? S.newLook : S.newLooks(sum.newLooks.length)}</div><div class="rw-looks">${looks}</div><div class="rw-wear">${S.wearIt}</div></div>` : ''}
        ${next ? `<div class="rw-next">${escT(next)}</div>` : ''}
      </div>`;
      const fill = el.querySelector<HTMLElement>('.rw-bar i')!;
      fill.style.transform = `scaleX(${sum.bar.to.toFixed(4)})`;
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduce && typeof fill.animate === 'function') {
        const sx = (f: number) => ({ transform: `scaleX(${f.toFixed(4)})` });
        const frames = sum.levelUps > 0
          ? [{ ...sx(sum.bar.from), offset: 0 }, { ...sx(1), offset: 0.45 }, { ...sx(0), offset: 0.46 }, { ...sx(sum.bar.to), offset: 1 }]
          : [sx(sum.bar.from), sx(sum.bar.to)];
        fill.animate(frames, { duration: sum.levelUps > 0 ? 1300 : 800, delay: 350, easing: 'ease-out', fill: 'backwards' });
      }
      opts.sound?.('open');
      timer = setTimeout(() => {
        el.querySelector('.rw-card')?.classList.add('out');
        fade = setTimeout(() => { el.classList.add('hidden'); setBottom(false); }, 650);
      }, Math.max(1, seconds) * 1000);
    },
    hide() { clear(); el.classList.add('hidden'); setBottom(false); },
    get shown() { return !el.classList.contains('hidden'); },
    dispose() { clear(); setBottom(false); el.remove(); },
  };
  return card;
}
