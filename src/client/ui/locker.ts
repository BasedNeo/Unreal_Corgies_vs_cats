// OWNER: U2 (ux). The LOCKER view of the main menu: species toggle (corgi / cat), three slots (coat, neckwear, taunt),
// an item grid where locked looks show how to earn them, the level and XP bar with the next look to play for.
// Equipping saves to the profile (src/client/profile) and applies on the next spawn (the lead sends currentLook() in
// hello). Previews are swatches, glyphs and a taunt pack's first line: no second renderer.
// Keyboard and gamepad: every control is [data-nav], so the menu's navMove / PadNav drive it; Esc / pad B go back.
// Locked tiles stay focusable (aria-disabled, not disabled) so keyboard and pad players can read their hints.
import { COSMETICS, LOOK_SLOTS, TAUNT_PACKS, cosmeticsFor, resolveLook, unlockHint, type CosmeticDef, type CosmeticSlot, type Look } from '../../shared/content/cosmetics';
import { PALETTE } from '../style/style-tokens.js';
import { profileStore, type ProfileStore } from '../profile';
import type { Profile, SpeciesKey } from '../profile/schema';
import { isUnlocked, lookFor, nextLevelUnlock } from '../profile/unlocks';
import { levelProgress } from '../profile/xp';
import { LOCKER_STRINGS as S } from './strings';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const mix = (a: number, b: number, t: number) => {
  const c = (s: number) => [(a >> s) & 255, (b >> s) & 255];
  const ch = (s: number) => { const [x, y] = c(s); return Math.round(x + (y - x) * t) << s; };
  return ch(16) | ch(8) | ch(0);
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ------------------------------------------------------------------------------------------------ pure parts
export interface LockerItemView {
  id: string;
  name: string;
  slot: CosmeticSlot;
  locked: boolean;
  /** How to earn it (C3's unlockHint), '' for defaults. */
  hint: string;
  equipped: boolean;
  /** Unlocked, and the locker has not shown it yet. */
  isNew: boolean;
}

export interface LockerModel {
  species: SpeciesKey;
  slot: CosmeticSlot;
  level: number;
  into: number;
  need: number;
  frac: number;
  maxed: boolean;
  /** The next level that unlocks a look, and its names (for "Next look at level N: …"). */
  next: { level: number; names: string[] } | null;
  items: LockerItemView[];
  /** Name of what the species wears in this slot. */
  wearing: string;
  /** Unlocked looks the locker has not shown yet (any species, any slot). */
  newCount: number;
}

/** Unlocked looks not seen in the locker yet. */
export function unseenLooks(p: Pick<Profile, 'unlocked' | 'seen'>): string[] {
  const seen = new Set(p.seen);
  return p.unlocked.filter((id) => !seen.has(id) && COSMETICS.some((c) => c.id === id));
}

/** Everything the locker shows for one species and slot. Pure. `fresh` marks NEW badges (default: unseen looks). */
export function lockerModel(p: Profile, species: SpeciesKey, slot: CosmeticSlot, fresh: ReadonlySet<string> = new Set(unseenLooks(p))): LockerModel {
  const wearing = lookFor(p, species, COSMETICS)[slot];
  const items = cosmeticsFor(species, slot).map((c): LockerItemView => {
    const locked = !isUnlocked(p, c);
    return { id: c.id, name: c.name, slot: c.slot, locked, hint: c.unlock.kind === 'default' ? '' : unlockHint(c.unlock), equipped: c.id === wearing, isNew: !locked && fresh.has(c.id) };
  });
  const lp = levelProgress(p.xp);
  const nx = nextLevelUnlock(p, COSMETICS);
  return {
    species, slot, level: lp.level, into: lp.into, need: lp.need, frac: lp.frac, maxed: lp.need === 0,
    next: nx ? { level: nx.level, names: nx.items.map((i) => i.name) } : null,
    items, wearing: COSMETICS.find((c) => c.id === wearing)?.name ?? '', newCount: unseenLooks(p).length,
  };
}

/** The "next look" line (always show the next reward). */
export function nextLine(m: Pick<LockerModel, 'next'>): string {
  if (!m.next) return S.noNext;
  const [first, ...rest] = m.next.names;
  return rest.length ? S.nextMore(m.next.level, first, rest.length) : S.next(m.next.level, first);
}

const P = PALETTE as Record<string, number>;
const dapple = (x: number, y: number, r: number, c: string) => `radial-gradient(circle at ${x}% ${y}%,${c} 0 ${r}%,transparent ${r + 1}%)`;
const bib = (c: string, r = 36) => `radial-gradient(ellipse at 50% 108%,${c} 0 ${r}%,transparent ${r + 1}%)`;
/** A coat's swatch as a CSS background (species-true colours from the style tokens). Unknown ids get a neutral one. */
export function coatSwatch(id: string): string {
  const cream = hex(P.corgiCream), orange = hex(P.corgiOrange), tri = hex(P.corgiTri), red = hex(P.corgiRed);
  const grey = hex(P.catGrey), black = hex(P.catBlack), white = hex(P.catWhite), ginger = hex(P.catGinger);
  switch (id) {
    case 'corgi_red': return `${bib(cream)},${orange}`;
    case 'corgi_tricolor': return `${bib(cream, 32)},linear-gradient(180deg,${tri} 0 38%,${orange} 38%)`;
    case 'corgi_sable': return `${bib(cream, 30)},linear-gradient(180deg,${hex(mix(P.corgiRed, P.corgiTri, 0.45))} 0 22%,${hex(mix(P.corgiOrange, P.corgiRed, 0.35))} 58%)`;
    case 'corgi_merle': return `${dapple(30, 28, 13, tri)},${dapple(70, 40, 11, tri)},${dapple(48, 58, 8, tri)},${bib(white, 30)},${hex(mix(P.catGrey, P.catWhite, 0.42))}`;
    case 'cat_tabby': return `repeating-linear-gradient(105deg,${grey} 0 11%,${hex(mix(P.catGrey, P.catBlack, 0.6))} 11% 17%)`;
    case 'cat_tuxedo': return `${bib(white, 38)},${black}`;
    case 'cat_calico': return `${dapple(28, 30, 20, ginger)},${dapple(72, 58, 18, black)},${dapple(74, 18, 11, ginger)},${white}`;
    case 'cat_siamese': return `radial-gradient(circle at 50% 50%,${hex(P.catSiamese)} 0 40%,${hex(mix(P.hullDark ?? 0x2b2a33, P.corgiTri, 0.35))} 78%)`;
    default: return `repeating-linear-gradient(45deg,#c9c0ae 0 8%,#e9e1d0 8% 16%)`;
  }
}

const INK = hex(PALETTE.ink);
/** Neckwear glyph (inline SVG). The team collar takes the team colour of the menu (var(--team)). */
export function neckGlyph(id: string): string {
  const ring = (fill: string, stroke = INK) => `<path d="M8 20 Q24 34 40 20 L40 27 Q24 41 8 27 Z" fill="${fill}" stroke="${stroke}" stroke-width="2.6" stroke-linejoin="round"/>`;
  const body = (() => {
    switch (id) {
      case 'neck_none': return ring('var(--team,#2f6fd6)');
      case 'neck_bandana': return `${ring('#c8322e')}<path d="M14 29 L34 29 L24 44 Z" fill="#e0453c" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/><circle cx="21" cy="33" r="1.6" fill="#fff"/><circle cx="27" cy="33" r="1.6" fill="#fff"/><circle cx="24" cy="38" r="1.6" fill="#fff"/>`;
      case 'neck_nametag': return `${ring('#7a4a2a')}<circle cx="24" cy="39" r="6.5" fill="#ffd04a" stroke="${INK}" stroke-width="2.6"/><path d="M21 39 h6" stroke="${INK}" stroke-width="1.8"/>`;
      case 'neck_spiked': return `${ring('#2b2a33')}${[12, 18, 24, 30, 36].map((x) => `<path d="M${x - 2.6} ${x === 24 ? 34 : x === 18 || x === 30 ? 32.6 : 29.5} l2.6 7 l2.6 -7 z" fill="#e9e6df" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`).join('')}`;
      case 'neck_bowtie': return `<path d="M24 29 L11 21 L11 39 Z M24 29 L37 21 L37 39 Z" fill="#8e44ad" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/><rect x="20.5" y="25.5" width="7" height="7" rx="2" fill="#b86bd6" stroke="${INK}" stroke-width="2.4"/>`;
      default: return ring('#c9c0ae');
    }
  })();
  return `<svg viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;
}

/** A taunt pack's first line (its preview). */
export function tauntPreview(id: string): string {
  return TAUNT_PACKS[id]?.[0] ?? '';
}

/** The preview markup of an item (swatch / glyph / quote). Text is escaped. */
export function itemPreview(item: Pick<CosmeticDef, 'id' | 'slot'>): string {
  if (item.slot === 'coat') return `<span class="lo-sw" style="background:${coatSwatch(item.id)}"></span>`;
  if (item.slot === 'neck') return `<span class="lo-gl">${neckGlyph(item.id)}</span>`;
  return `<span class="lo-q">${esc(S.tauntQuote(tauntPreview(item.id)))}</span>`;
}

// ------------------------------------------------------------------------------------------------ the view
/** The part of ProfileStore the locker uses (tests pass a store over fake storage). */
export type LockerStore = Pick<ProfileStore, 'load' | 'equip' | 'markSeen'>;

export interface LockerDeps {
  /** Species the locker opens on (default corgi; the menu passes the picked team's). */
  species?(): SpeciesKey;
  onBack(): void;
  backLabel?(): string;
  /** UI sounds (menu.ts UiSoundKind). */
  sound?(kind: 'click' | 'hover' | 'back' | 'open'): void;
  store?: LockerStore;
  /** After a successful equip: the species' full look now (every slot). The lead forwards it for the next spawn. */
  onEquip?(species: SpeciesKey, look: Required<Look>): void;
}

export interface Locker {
  el: HTMLElement;
  open(): void;
  close(): void;
  refresh(): void;
  readonly species: SpeciesKey;
  readonly slot: CosmeticSlot;
}

export function createLocker(deps: LockerDeps): Locker {
  const store = (): LockerStore => deps.store ?? profileStore();
  let species: SpeciesKey = deps.species?.() ?? 'corgi';
  let slot: CosmeticSlot = 'coat';
  let fresh = new Set<string>();
  let status = S.idle;
  let statusKind: '' | 'ok' | 'warn' = '';
  const el = document.createElement('div');
  el.className = 'lo';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', S.title);
  el.innerHTML = `
    <h2 class="mm-h">${S.title} <small>${S.note}</small><span class="lo-new hidden"></span></h2>
    <div class="lo-top">
      <div class="seg lo-sp" role="radiogroup" aria-label="Species">
        <button class="t0" data-nav data-sp="corgi" role="radio">${S.species.corgi}</button><button class="t1" data-nav data-sp="cat" role="radio">${S.species.cat}</button>
      </div>
      <div class="lo-xp">
        <span class="lo-lv"><small>${S.level}</small><b></b></span>
        <div class="lo-xpcol"><div class="lo-bar" role="progressbar" aria-label="XP" aria-valuemin="0" aria-valuemax="100"><i></i></div>
          <div class="lo-xpt"><span class="lo-into"></span><span class="lo-next"></span></div></div>
      </div>
    </div>
    <div class="seg lo-slots" role="tablist" aria-label="Slot">
      ${LOOK_SLOTS.map((s) => `<button data-nav data-slot="${s}" role="tab">${S.slots[s] ?? s.toUpperCase()}</button>`).join('')}
    </div>
    <div class="lo-grid" role="radiogroup" aria-label="Looks"></div>
    <div class="lo-foot"><span class="lo-status" role="status" aria-live="polite"></span><button class="btn small" data-nav data-back>${S.back}</button></div>`;
  const spBtns = [...el.querySelectorAll<HTMLButtonElement>('[data-sp]')];
  const slotBtns = [...el.querySelectorAll<HTMLButtonElement>('[data-slot]')];
  const grid = el.querySelector<HTMLElement>('.lo-grid')!;
  const lvB = el.querySelector<HTMLElement>('.lo-lv b')!;
  const bar = el.querySelector<HTMLElement>('.lo-bar')!;
  const barFill = el.querySelector<HTMLElement>('.lo-bar i')!;
  const intoEl = el.querySelector<HTMLElement>('.lo-into')!;
  const nextEl = el.querySelector<HTMLElement>('.lo-next')!;
  const newEl = el.querySelector<HTMLElement>('.lo-new')!;
  const statusEl = el.querySelector<HTMLElement>('.lo-status')!;
  const backBtn = el.querySelector<HTMLButtonElement>('[data-back]')!;
  let gridKey = '';

  const paint = () => {
    const p = store().load();
    const m = lockerModel(p, species, slot, fresh);
    for (const b of spBtns) b.setAttribute('aria-checked', String(b.dataset.sp === species));
    for (const b of slotBtns) b.setAttribute('aria-selected', String(b.dataset.slot === slot));
    el.classList.toggle('t1', species === 'cat');
    el.classList.toggle('t0', species !== 'cat');
    lvB.textContent = String(m.level);
    barFill.style.transform = `scaleX(${m.frac.toFixed(4)})`;
    bar.setAttribute('aria-valuenow', String(Math.round(m.frac * 100)));
    intoEl.textContent = m.maxed ? S.maxed : S.xpOf(m.into, m.need);
    nextEl.textContent = nextLine(m);
    nextEl.title = nextEl.textContent;
    newEl.classList.toggle('hidden', fresh.size === 0);
    newEl.textContent = S.newCount(fresh.size);
    const key = JSON.stringify(m.items);
    if (key !== gridKey) {
      // rebuild only when something changed, and keep focus on the same tile (keyboard / pad players)
      const focused = (document.activeElement as HTMLElement | null)?.dataset?.look;
      gridKey = key;
      grid.innerHTML = m.items.map((it) => `
        <button class="lo-it${it.locked ? ' locked' : ''}${it.equipped ? ' on' : ''} lo-${it.slot}" data-nav data-look="${esc(it.id)}" role="radio"
          aria-checked="${it.equipped}" aria-disabled="${it.locked}" title="${esc(it.locked ? it.hint : it.name)}">
          <span class="lo-pv">${itemPreview(it)}</span>
          <span class="lo-nm">${esc(it.name)}</span>
          <span class="lo-tag">${it.equipped ? `✓ ${S.equipped}` : it.locked ? `🔒 ${esc(it.hint)}` : '&nbsp;'}</span>
          ${it.isNew ? `<span class="lo-nb">${S.isNew}</span>` : ''}
        </button>`).join('');
      if (focused) grid.querySelector<HTMLElement>(`[data-look="${CSS.escape(focused)}"]`)?.focus();
    }
    statusEl.textContent = status;
    statusEl.className = `lo-status ${statusKind}`;
    backBtn.textContent = deps.backLabel?.() ?? S.back;
  };

  for (const b of spBtns) b.addEventListener('click', () => { species = b.dataset.sp as SpeciesKey; status = S.idle; statusKind = ''; deps.sound?.('click'); paint(); });
  for (const b of slotBtns) b.addEventListener('click', () => { slot = b.dataset.slot as CosmeticSlot; status = S.idle; statusKind = ''; deps.sound?.('click'); paint(); });
  grid.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-look]');
    if (!t) return;
    const id = t.dataset.look!;
    const item = COSMETICS.find((c) => c.id === id);
    if (!item) return;
    const res = store().equip(species, { [slot]: id });
    if (res.ok) {
      status = S.wearNote(item.name); statusKind = 'ok'; deps.sound?.('click');
      deps.onEquip?.(species, resolveLook(lookFor(res.profile, species, COSMETICS), species));
    }
    else { status = S.lockedNote(item.name, unlockHint(item.unlock)); statusKind = 'warn'; deps.sound?.('back'); t.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 220 }); }
    paint();
  });
  backBtn.addEventListener('click', () => { deps.sound?.('back'); deps.onBack(); });

  return {
    el,
    open() {
      species = deps.species?.() ?? species;
      status = S.idle; statusKind = '';
      // NEW badges show for this visit; the looks count as seen from now on
      fresh = new Set(unseenLooks(store().load()));
      if (fresh.size) store().markSeen([...fresh]);
      gridKey = '';
      paint();
    },
    close() { fresh = new Set(); },
    refresh: paint,
    get species() { return species; },
    get slot() { return slot; },
  };
}
