// OWNER: L5 (juice). Main menu (play offline / join server, name, team, class picker) and the settings panel,
// with keyboard + gamepad navigation (spatial focus movement over [data-nav] elements).
// U1 (ux): the Online rooms view (room-browser.ts), the quality "applies after reload" notice and the tips reset.
// A1 (adventure): ADVENTURE in the MATCH selector; with it picked, the right card shows the chapter picker (six slots:
// playable, locked-but-visible, or coming soon; paws from localStorage `cvc.adventure`) instead of the class grid —
// a chapter plays its featured kit (swap at any Ordnance Kiosk), on the corgi side.
import { CLASSES } from '../../shared/content/classes';
import { CLASS_IDS, type ClassId, type TeamId } from '../../shared/types';
import { classIcon } from './icons';
import { cleanName, type QualitySetting, type Settings, type SettingKey } from './settings';
import { CLASS_BLURBS, CONTROLS, QUALITY_STRINGS, ROOM_STRINGS, TEAM_NAMES, TIP_STRINGS, TITLE } from './strings';
import { qualityNote } from './quality-note';
import { createRoomBrowser, type RoomBrowser } from './room-browser';
import { adventureJoinKit, serverBase, type RoomInfo, type RoomPoller } from './rooms';
import { ADVENTURE_STRINGS } from './strings';
import { FONT_BODY, FONT_DISPLAY } from './fonts';
import { CHAPTER_PLAN, chapterById, type ChapterDef } from '../../shared/content/chapters';
import { isUnlocked, loadProgress, type AdventureProgress } from '../adventure/progress';
import { pawSvg } from '../adventure/hud';

/** Offline match types the menu offers (the online server decides its own). */
export type MatchMode = 'yard-skirmish' | 'team-deathmatch' | 'core-rush' | 'adventure';
export const MATCH_MODES: ReadonlyArray<{ id: MatchMode; label: string; hint: string }> = [
  { id: 'adventure', label: ADVENTURE_STRINGS.matchLabel, hint: ADVENTURE_STRINGS.matchHint },
  { id: 'yard-skirmish', label: 'SKIRMISH', hint: 'Co-op: your squad vs five waves of cats and the Vac-Tank' },
  { id: 'team-deathmatch', label: 'DEATHMATCH', hint: '4 vs 4: first team to 30 knockouts' },
  { id: 'core-rush', label: 'CORE RUSH', hint: '4 vs 4: hold the three Core Pads, first to 250' },
];

/** Chapter picker CSS (A1; scoped like the HUD's, injected once). */
const CHAPTER_CSS = (u: (n: number) => string) => `
#cvc-hud .seg.mm-match{display:grid;grid-template-columns:1fr 1fr}
#cvc-hud .seg.mm-match button{border-right:${u(3)} solid var(--ink);border-bottom:${u(3)} solid var(--ink);font-size:${u(14)};padding:${u(6)} ${u(6)}}
#cvc-hud .seg.mm-match button:nth-child(2n){border-right:none} #cvc-hud .seg.mm-match button:nth-last-child(-n+2){border-bottom:none}
#cvc-hud .seg.mm-match button[data-match=adventure][aria-checked=true]{background:var(--corgi)}
#cvc-hud .mm-chap-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:${u(10)}}
#cvc-hud .mm-chap{position:relative;text-align:left;font:inherit;color:var(--ink);background:#fffaf0;border:${u(3)} solid var(--ink);border-radius:${u(10)};
  padding:${u(8)} ${u(10)} ${u(9)};box-shadow:${u(3)} ${u(3)} 0 var(--ink);cursor:pointer;display:flex;flex-direction:column;gap:${u(3)};min-height:${u(128)};transition:transform .1s}
#cvc-hud .mm-chap:hover:not(:disabled){transform:translateY(${u(-2)})}
#cvc-hud .mm-chap[aria-checked=true]{background:var(--gold);transform:rotate(-1.5deg) scale(1.03);box-shadow:${u(4)} ${u(5)} 0 var(--ink)}
#cvc-hud .mm-chap:focus-visible{outline:${u(4)} solid var(--gold);outline-offset:${u(3)}}
#cvc-hud .mm-chap-no{font-size:${u(28)};line-height:1;color:#fff;-webkit-text-stroke:${u(2.2)} var(--ink);paint-order:stroke fill;text-shadow:0 ${u(3)} 0 var(--ink)}
#cvc-hud .mm-chap-t{font-size:${u(16)};letter-spacing:.02em;line-height:1.05}
#cvc-hud .mm-chap-d{font:800 ${u(10)} ${FONT_BODY};letter-spacing:.06em;text-transform:uppercase;opacity:.6}
#cvc-hud .mm-chap-kit{position:absolute;right:${u(8)};top:${u(8)};width:${u(30)};height:${u(30)};border-radius:50%;background:var(--corgi);border:${u(2.5)} solid var(--ink);display:grid;place-items:center;color:var(--corgi2)}
#cvc-hud .mm-chap-kit .ico,#cvc-hud .mm-chap-kit svg{width:72%;height:72%}
#cvc-hud .mm-chap-paw{position:absolute;right:${u(6)};bottom:${u(6)};width:${u(34)};height:${u(34)};transform:rotate(-10deg)}
#cvc-hud .mm-chap-paw svg{width:100%;height:100%}
#cvc-hud .mm-chap-tag{margin-top:auto;align-self:flex-start;font:800 ${u(9.5)} ${FONT_BODY};letter-spacing:.08em;background:var(--ink);color:var(--gold);border-radius:${u(5)};padding:${u(2)} ${u(6)}}
#cvc-hud .mm-chap:disabled{cursor:default;filter:grayscale(.85);opacity:.55;background:#e9e1d0}
#cvc-hud .mm-chap:disabled .mm-chap-kit{background:#9a9384}
#cvc-hud .mm-chap-lock{position:absolute;right:${u(9)};bottom:${u(8)};font-size:${u(20)}}
#cvc-hud .mm-chap-sel{margin-top:${u(10)};display:flex;align-items:center;gap:${u(10)};font:800 ${u(12)} ${FONT_BODY};letter-spacing:.04em}
#cvc-hud .mm-chap-sel b{font-size:${u(16)};font-family:${FONT_DISPLAY}}
`;
let chapterCssEl: HTMLStyleElement | null = null;
function ensureChapterCss(): void {
  if (chapterCssEl || typeof document === 'undefined') return;
  chapterCssEl = document.createElement('style');
  chapterCssEl.textContent = CHAPTER_CSS((n) => `calc(var(--u)*${n})`);
  document.head.appendChild(chapterCssEl);
}

/** The chapter the picker starts on: the furthest unlocked playable one. */
export function defaultChapter(p: AdventureProgress): ChapterDef {
  let best = chapterById(CHAPTER_PLAN[0].id)!;
  for (const slot of CHAPTER_PLAN) {
    const def = chapterById(slot.id);
    if (def && isUnlocked(p, slot.index)) best = def;
  }
  return best;
}

export interface PlayOptions {
  mode: 'offline' | 'online';
  /** Offline match type (MATCH selector). */
  match?: MatchMode;
  /** WebSocket URL when mode = 'online'. */
  server?: string;
  /** Online room to join or create (U1 room browser). Absent = the server's default room. */
  room?: string;
  /** Adventure chapter id (match 'adventure', offline or online). */
  chapter?: string;
  name: string;
  team: TeamId | -1;
  cls: ClassId;
}

export type UiSoundKind = 'click' | 'hover' | 'back' | 'open';

export interface MenuDeps {
  settings: Settings;
  onPlay(opts: PlayOptions): void;
  onClass(cls: ClassId): void;
  onTeam(team: TeamId | -1): void;
  onSetting<K extends SettingKey>(key: K, value: Settings[K]): void;
  sound?(kind: UiSoundKind): void;
  // ---- U1 additions (all optional) ----
  /** The server this page itself plays on (serverUrlForPage()); prefills the server field and the room browser. */
  pageServer?: string | null;
  /** The quality tier the world was built with (see quality-note.ts). Default: the saved setting. */
  appliedQuality?: QualitySetting;
  /** True once a quality change fully applies without a reload (hides the notice). */
  qualityLive?: boolean;
  /** Whether a match is running (the reload notice warns that reloading leaves it). */
  inSession?(): boolean;
  /** Reload button under the quality notice. */
  onReload?(): void;
  /** Settings › First-match tips › Show again. */
  onResetTips?(): void;
  /** Room list poller (tests/labs inject one with a fake fetch). */
  roomPoller?: RoomPoller;
  /** The offline match type pre-selected in the MATCH selector (the page's ?mode=). */
  match?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------------------------------------------------------------- settings panel
export interface SettingsPanel { el: HTMLElement; refresh(): void }

const SLIDERS: Array<{ key: 'sensitivity' | 'fov' | 'shake' | 'masterVolume' | 'musicVolume' | 'sfxVolume'; label: string; min: number; max: number; step: number; fmt(v: number): string }> = [
  { key: 'sensitivity', label: 'LOOK SPEED', min: 0.2, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { key: 'fov', label: 'FIELD OF VIEW', min: 55, max: 80, step: 1, fmt: (v) => `${Math.round(v)}°` },
  { key: 'shake', label: 'SCREEN SHAKE', min: 0, max: 1, step: 0.05, fmt: (v) => (v <= 0 ? 'OFF' : `${Math.round(v * 100)}%`) },
  { key: 'masterVolume', label: 'MASTER', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'musicVolume', label: 'MUSIC', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'sfxVolume', label: 'SOUND FX', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
];

export function createSettingsPanel(deps: MenuDeps, onBack: () => void, backLabel = 'BACK'): SettingsPanel {
  const s = deps.settings;
  const el = document.createElement('div');
  el.className = 'st';
  el.innerHTML = `
    <h2 class="mm-h">SETTINGS <small>saved automatically</small></h2>
    ${SLIDERS.map((d) => `
      <label class="st-row"><span class="st-name">${d.label}</span>
        <input type="range" data-nav data-k="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}">
        <span class="st-val" data-v="${d.key}"></span></label>`).join('')}
    <div class="st-row"><span class="st-name">INVERT LOOK Y</span><button class="tog" data-nav data-k="invertY" role="switch" aria-label="Invert look Y"></button><span></span></div>
    <div class="st-row"><span class="st-name">QUALITY</span>
      <div class="seg" role="radiogroup" aria-label="Quality">${(['low', 'medium', 'high'] as const).map((q) => `<button data-nav data-q="${q}" role="radio" class="auto">${q === 'medium' ? 'MED' : q.toUpperCase()}</button>`).join('')}</div><span></span></div>
    <div class="st-qn hidden" role="status" aria-live="polite"><span class="st-qn-i" aria-hidden="true">⟳</span><span class="st-qn-t"></span><button class="btn small" data-nav data-reload>${QUALITY_STRINGS.reloadButton}</button></div>
    ${deps.onResetTips ? `<div class="st-row"><span class="st-name">${TIP_STRINGS.resetLabel}</span><button class="btn small st-tips" data-nav data-tips>${TIP_STRINGS.resetButton}</button><span></span></div>` : ''}
    <div class="st-actions"><span class="st-note">Keyboard: arrows · Enter · Esc — Gamepad: D-pad · A · B</span><button class="btn small" data-nav data-back>${backLabel}</button></div>`;
  const sliders = [...el.querySelectorAll<HTMLInputElement>('input[type=range]')];
  const paint = (inp: HTMLInputElement) => {
    const d = SLIDERS.find((x) => x.key === inp.dataset.k)!;
    const v = Number(inp.value);
    inp.style.setProperty('--p', `${((v - d.min) / (d.max - d.min)) * 100}%`);
    el.querySelector(`[data-v="${d.key}"]`)!.textContent = d.fmt(v);
  };
  for (const inp of sliders) {
    inp.addEventListener('input', () => {
      const k = inp.dataset.k as (typeof SLIDERS)[number]['key'];
      const v = Number(inp.value);
      s[k] = v;
      paint(inp);
      deps.onSetting(k, v);
    });
  }
  const tog = el.querySelector<HTMLButtonElement>('.tog')!;
  tog.addEventListener('click', () => { s.invertY = !s.invertY; tog.setAttribute('aria-checked', String(s.invertY)); deps.onSetting('invertY', s.invertY); deps.sound?.('click'); });
  const qs = [...el.querySelectorAll<HTMLButtonElement>('[data-q]')];
  const qn = el.querySelector<HTMLElement>('.st-qn')!, qnText = el.querySelector<HTMLElement>('.st-qn-t')!;
  const applied = deps.appliedQuality ?? s.quality;
  const paintQualityNote = () => {
    const note = qualityNote(applied, s.quality, !!deps.qualityLive, deps.inSession?.() ?? false);
    qn.classList.toggle('hidden', !note);
    qnText.textContent = note ?? '';
  };
  for (const b of qs) b.addEventListener('click', () => {
    s.quality = b.dataset.q as Settings['quality'];
    for (const x of qs) x.setAttribute('aria-checked', String(x === b));
    deps.onSetting('quality', s.quality);
    deps.sound?.('click');
    paintQualityNote();
  });
  el.querySelector('[data-reload]')!.addEventListener('click', () => { deps.sound?.('click'); deps.onReload?.(); });
  const tipsBtn = el.querySelector<HTMLButtonElement>('[data-tips]');
  tipsBtn?.addEventListener('click', () => {
    deps.onResetTips?.();
    deps.sound?.('click');
    tipsBtn.textContent = TIP_STRINGS.resetDone;
    tipsBtn.title = TIP_STRINGS.resetNote;
  });
  el.querySelector('[data-back]')!.addEventListener('click', () => { deps.sound?.('back'); onBack(); });
  const refresh = () => {
    for (const inp of sliders) { inp.value = String(s[inp.dataset.k as (typeof SLIDERS)[number]['key']]); paint(inp); }
    tog.setAttribute('aria-checked', String(s.invertY));
    for (const b of qs) b.setAttribute('aria-checked', String(b.dataset.q === s.quality));
    paintQualityNote();
    if (tipsBtn) { tipsBtn.textContent = TIP_STRINGS.resetButton; tipsBtn.title = TIP_STRINGS.resetNote; }
  };
  refresh();
  return { el, refresh };
}

// ---------------------------------------------------------------- spatial navigation
export function navMove(container: HTMLElement, dx: number, dy: number): HTMLElement | null {
  const items = [...container.querySelectorAll<HTMLElement>('[data-nav]')].filter((e) => e.offsetParent !== null && !(e as HTMLButtonElement).disabled);
  if (!items.length) return null;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !items.includes(cur)) { items[0].focus(); return items[0]; }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  // Prefer targets inside a ±~27° cone of the pressed direction; fall back to anything on that side.
  let best: HTMLElement | null = null;
  for (const cone of [0.5, Infinity]) {
    let bestScore = Infinity;
    for (const e of items) {
      if (e === cur) continue;
      const b = e.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const px = (bx - ax) * dx + (by - ay) * dy; // along the direction
      if (px <= 4) continue;
      const sx = Math.abs((bx - ax) * dy) + Math.abs((by - ay) * dx); // across
      if (sx > px * cone) continue;
      const score = px + sx * 2.2;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) break;
  }
  if (best) best.focus();
  return best;
}

/** True once any gamepad has connected (getGamepads() allocates; skip it entirely for keyboard players). */
let padSeen = false;
if (typeof window !== 'undefined') window.addEventListener('gamepadconnected', () => { padSeen = true; });
export function firstPad(): Gamepad | null {
  if (!padSeen || typeof navigator === 'undefined' || !navigator.getGamepads) return null;
  for (const g of navigator.getGamepads()) if (g && g.connected) return g;
  return null;
}

/** Gamepad → menu navigation with key-repeat. Call poll() every frame while a menu is visible. */
export class PadNav {
  private held = new Map<string, number>();
  private prevA = false; private prevB = false; private prevStart = false;
  poll(now: number, container: HTMLElement, onBack: () => void, onStart?: () => void): void {
    const pad = firstPad();
    if (!pad) return;
    const bt = (i: number) => !!pad.buttons[i]?.pressed;
    const ax0 = pad.axes[0] ?? 0, ax1 = pad.axes[1] ?? 0;
    const dirs: Array<[string, boolean, number, number]> = [
      ['u', bt(12) || ax1 < -0.55, 0, -1], ['d', bt(13) || ax1 > 0.55, 0, 1], ['l', bt(14) || ax0 < -0.55, -1, 0], ['r', bt(15) || ax0 > 0.55, 1, 0],
    ];
    for (const [k, on, dx, dy] of dirs) {
      if (!on) { this.held.delete(k); continue; }
      const next = this.held.get(k);
      if (next === undefined || now >= next) {
        this.held.set(k, now + (next === undefined ? 0.35 : 0.11));
        const cur = document.activeElement as HTMLInputElement | null;
        if (cur && cur.type === 'range' && dx !== 0 && container.contains(cur)) {
          const step = Number(cur.step) || 0.05;
          cur.value = String(Math.min(Number(cur.max), Math.max(Number(cur.min), Number(cur.value) + dx * step)));
          cur.dispatchEvent(new Event('input', { bubbles: true }));
        } else navMove(container, dx, dy);
      }
    }
    const a = bt(0), b = bt(1), st = bt(9);
    if (a && !this.prevA) (document.activeElement as HTMLElement | null)?.click();
    if (b && !this.prevB) onBack();
    if (st && !this.prevStart) onStart?.();
    this.prevA = a; this.prevB = b; this.prevStart = st;
  }
}

// ---------------------------------------------------------------- main menu
export type MenuView = 'main' | 'settings' | 'rooms';

export interface Menu {
  el: HTMLElement;
  readonly isOpen: boolean;
  open(view?: MenuView): void;
  close(): void;
  poll(now: number): void;
  refresh(): void;
}

export function createMenu(parent: HTMLElement, deps: MenuDeps): Menu {
  const s = deps.settings;
  const el = document.createElement('div');
  el.className = 'mm interactive hidden';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Main menu');
  el.innerHTML = `
    <div class="mm-bg"></div>
    <div class="mm-logo"><span class="mm-word l">${TITLE.left}</span><span class="mm-vs"><span>${TITLE.vs}</span></span><span class="mm-word r">${TITLE.right}</span></div>
    <div class="mm-tag">${esc(TITLE.tagline)}</div>
    <div class="mm-main">
      <div class="panel halftone mm-card mm-left">
        <h2 class="mm-h">DEPLOY</h2>
        <label class="mm-field"><span class="mm-label">CALL SIGN</span><input type="text" data-nav data-name maxlength="16" spellcheck="false" autocomplete="off"></label>
        <div class="mm-field"><span class="mm-label">TEAM</span>
          <div class="seg" role="radiogroup" aria-label="Team">
            <button class="t0" data-nav data-team="0" role="radio">CORGIS</button>
            <button class="auto" data-nav data-team="-1" role="radio">AUTO</button>
            <button class="t1" data-nav data-team="1" role="radio">CATS</button>
          </div></div>
        <div class="mm-field"><span class="mm-label">MATCH</span>
          <div class="seg mm-match" role="radiogroup" aria-label="Match">
            ${MATCH_MODES.map((m) => `<button data-nav data-match="${m.id}" role="radio">${m.label}</button>`).join('')}
          </div>
          <span class="mm-label" data-match-hint style="opacity:.8;letter-spacing:0;text-transform:none;margin-top:.3em"></span></div>
        <div class="mm-play">
          <button class="btn primary" data-nav data-play>PLAY OFFLINE ▸</button>
          <div class="mm-join"><input type="text" data-nav data-server spellcheck="false" autocomplete="off" aria-label="Server URL"><button class="btn small" data-nav data-join>JOIN</button></div>
          <div class="mm-row"><button class="btn small" data-nav data-rooms>${ROOM_STRINGS.browse}</button><button class="btn small" data-nav data-settings>⚙ SETTINGS</button></div>
        </div>
      </div>
      <div class="panel halftone mm-card mm-right">
        <div class="mm-classes">
          <h2 class="mm-h">PICK YOUR CLASS <small>applies on your next spawn</small></h2>
          <div class="cc-grid" role="radiogroup" aria-label="Class">
            ${CLASS_IDS.map((c) => `
              <button class="cc" data-nav data-cls="${c}" role="radio">
                <span class="cc-icon">${classIcon(c)}</span>
                <span class="cc-name">${CLASSES[c].displayName}</span>
                <span class="cc-role">${esc(CLASSES[c].role)}</span>
                <span class="cc-blurb">${esc(CLASS_BLURBS[c])}</span>
                <span class="cc-check">✓</span>
              </button>`).join('')}
          </div>
        </div>
        <div class="mm-chapters hidden">
          <h2 class="mm-h">${ADVENTURE_STRINGS.pickerTitle} <small>${ADVENTURE_STRINGS.pickerNote}</small></h2>
          <div class="mm-chap-grid" role="radiogroup" aria-label="Chapter">
            ${CHAPTER_PLAN.map((c) => `
              <button class="mm-chap" data-nav data-ch="${c.id}" data-idx="${c.index}" role="radio">
                <span class="mm-chap-no">${c.index}</span>
                <span class="mm-chap-t">${esc(c.title)}</span>
                <span class="mm-chap-d">${esc(c.district)}</span>
                <span class="mm-chap-kit">${classIcon(c.cls)}</span>
                <span class="mm-chap-tag"></span>
                <span class="mm-chap-paw"></span>
              </button>`).join('')}
          </div>
          <div class="mm-chap-sel"></div>
        </div>
        <div class="mm-settings hidden"></div>
        <div class="mm-rooms hidden"></div>
      </div>
    </div>
    <div class="mm-foot">${CONTROLS.map(([k, v]) => `<span><kbd>${k}</kbd> ${v}</span>`).join('')}</div>`;
  parent.appendChild(el);

  const nameIn = el.querySelector<HTMLInputElement>('[data-name]')!;
  const serverIn = el.querySelector<HTMLInputElement>('[data-server]')!;
  const teamBtns = [...el.querySelectorAll<HTMLButtonElement>('[data-team]')];
  const clsBtns = [...el.querySelectorAll<HTMLButtonElement>('[data-cls]')];
  const matchBtns = [...el.querySelectorAll<HTMLButtonElement>('[data-match]')];
  const matchHint = el.querySelector<HTMLElement>('[data-match-hint]')!;
  let match: MatchMode = MATCH_MODES.some((m) => m.id === deps.match) ? (deps.match as MatchMode) : 'yard-skirmish';
  const classesView = el.querySelector<HTMLElement>('.mm-classes')!;
  const chaptersView = el.querySelector<HTMLElement>('.mm-chapters')!;
  const chBtns = [...el.querySelectorAll<HTMLButtonElement>('[data-ch]')];
  const chSel = el.querySelector<HTMLElement>('.mm-chap-sel')!;
  ensureChapterCss();
  let progress = loadProgress();
  let chapter: ChapterDef = defaultChapter(progress);
  const settingsView = el.querySelector<HTMLElement>('.mm-settings')!;
  const roomsView = el.querySelector<HTMLElement>('.mm-rooms')!;
  const right = el.querySelector<HTMLElement>('.mm-right')!;
  let open = false;
  let view: MenuView = 'main';

  const settingsPanel = createSettingsPanel(deps, () => showView('main'));
  settingsView.appendChild(settingsPanel.el);
  const pageServer = deps.pageServer ? serverBase(deps.pageServer) : null;
  /** The server the room browser and JOIN use: what the field holds (prefilled with the page's own server). */
  const currentServer = () => serverIn.value.trim() || pageServer || s.server;
  const rooms: RoomBrowser = createRoomBrowser({
    server: currentServer,
    join: (room, info) => play('online', room, info),
    back: () => showView('main'),
    joinAs: () => `Joining as ${CLASSES[s.cls].displayName.toUpperCase()} · ${s.team === -1 ? 'AUTO TEAM' : TEAM_NAMES[s.team]} · ${s.name}`,
    poller: deps.roomPoller,
    sound: deps.sound,
  });
  roomsView.appendChild(rooms.el);

  const paint = () => {
    nameIn.value = s.name;
    if (document.activeElement !== serverIn) serverIn.value = pageServer ?? s.server;
    for (const b of teamBtns) b.setAttribute('aria-checked', String(Number(b.dataset.team) === s.team));
    for (const b of clsBtns) b.setAttribute('aria-checked', String(b.dataset.cls === s.cls));
    for (const b of matchBtns) b.setAttribute('aria-checked', String(b.dataset.match === match));
    matchHint.textContent = MATCH_MODES.find((m) => m.id === match)?.hint ?? '';
    paintChapters();
    const teamRow = teamBtns[0]?.closest<HTMLElement>('.mm-field');
    if (teamRow) { teamRow.style.opacity = match === 'adventure' ? '0.45' : ''; teamRow.title = match === 'adventure' ? 'Adventure: the squad is all corgis' : ''; }
    if (view === 'main') { classesView.classList.toggle('hidden', match === 'adventure'); chaptersView.classList.toggle('hidden', match !== 'adventure'); }
    // Class icons take the chosen team's colors (auto → corgis).
    right.classList.toggle('t1', s.team === 1);
    right.classList.toggle('t0', s.team !== 1);
    settingsPanel.refresh();
  };
  const paintChapters = () => {
    for (const b of chBtns) {
      const idx = Number(b.dataset.idx);
      const def = chapterById(b.dataset.ch);
      const open = !!def && isUnlocked(progress, idx);
      b.disabled = !open;
      b.setAttribute('aria-checked', String(!!def && def.id === chapter.id));
      const medal = def ? progress.medals[def.id] ?? null : null;
      b.querySelector('.mm-chap-tag')!.textContent = !def ? ADVENTURE_STRINGS.comingSoon : !open ? ADVENTURE_STRINGS.locked : medal ? ADVENTURE_STRINGS.medal[medal] : `${ADVENTURE_STRINGS.chapter} ${idx}`;
      b.title = !def ? ADVENTURE_STRINGS.comingSoon : !open ? ADVENTURE_STRINGS.lockedHint(idx - 1) : '';
      b.querySelector('.mm-chap-paw')!.innerHTML = open && medal ? pawSvg(medal) : !def || !open ? '<span class="mm-chap-lock">🔒</span>' : '';
    }
    chSel.innerHTML = `<span>${ADVENTURE_STRINGS.featured}</span><b>${esc(CLASSES[chapter.cls].displayName.toUpperCase())}</b><span style="opacity:.65">· ${ADVENTURE_STRINGS.kitNote}</span>`;
  };
  const showView = (v: MenuView) => {
    view = v;
    classesView.classList.toggle('hidden', v !== 'main' || match === 'adventure');
    chaptersView.classList.toggle('hidden', v !== 'main' || match !== 'adventure');
    settingsView.classList.toggle('hidden', v !== 'settings');
    roomsView.classList.toggle('hidden', v !== 'rooms');
    // the controls strip belongs to the main card; the taller settings panel needs the room
    el.querySelector<HTMLElement>('.mm-foot')?.classList.toggle('hidden', v === 'settings');
    if (v === 'rooms' && open) rooms.open(); else rooms.close();
    const first = (v === 'settings' ? settingsView : v === 'rooms' ? roomsView : el.querySelector('[data-play]')) as HTMLElement | null;
    (v === 'main' ? first : first?.querySelector<HTMLElement>('[data-nav]'))?.focus();
  };

  const commitName = () => {
    const n = cleanName(nameIn.value, s.name);
    if (n !== s.name) { s.name = n; deps.onSetting('name', n); }
    nameIn.value = n;
  };
  nameIn.addEventListener('change', commitName);
  nameIn.addEventListener('blur', commitName);
  serverIn.addEventListener('change', () => {
    const v = serverIn.value.trim();
    if (/^wss?:\/\/\S+$/.test(v)) { if (v !== pageServer) { s.server = v; deps.onSetting('server', v); } } else serverIn.value = pageServer ?? s.server;
    rooms.serverChanged();
  });
  for (const b of teamBtns) b.addEventListener('click', () => { s.team = Number(b.dataset.team) as -1 | 0 | 1; deps.onSetting('team', s.team); deps.onTeam(s.team); deps.sound?.('click'); paint(); });
  for (const b of matchBtns) b.addEventListener('click', () => { match = b.dataset.match as MatchMode; deps.sound?.('click'); paint(); });
  for (const b of clsBtns) b.addEventListener('click', () => { s.cls = b.dataset.cls as ClassId; deps.onSetting('cls', s.cls); deps.onClass(s.cls); deps.sound?.('click'); paint(); });
  for (const b of chBtns) b.addEventListener('click', () => {
    const def = chapterById(b.dataset.ch);
    if (!def || b.disabled) return;
    chapter = def;
    deps.sound?.('click');
    paint();
  });
  const play = (mode: 'offline' | 'online', room?: string, listing?: RoomInfo) => {
    commitName();
    let server: string | undefined;
    if (mode === 'online') {
      const v = currentServer();
      if (!/^wss?:\/\/\S+$/.test(v)) { serverIn.focus(); serverIn.select(); return; }
      if (v !== pageServer) { s.server = v; deps.onSetting('server', v); }
      server = serverBase(v);
      // a room typed into the URL itself (ws://host/?room=abc) still counts when no room was picked
      if (room === undefined) { try { room = new URL(v).searchParams.get('room') ?? undefined; } catch { /* not a URL */ } }
    }
    deps.sound?.('open');
    const kit = listing ? adventureJoinKit(listing) : null;
    if (kit) {
      // joining a listed adventure room: its chapter's featured kit, corgi side (whatever the menu had picked)
      deps.onPlay({ mode, server, room, match: 'adventure', chapter: kit.chapter, name: s.name, team: 0, cls: kit.cls });
      return;
    }
    if (match === 'adventure') {
      // a chapter plays its featured kit on the corgi side (the kiosk swaps kits in play)
      deps.onPlay({ mode, server, room: mode === 'online' ? room : undefined, match: 'adventure', chapter: chapter.id, name: s.name, team: 0, cls: chapter.cls });
      return;
    }
    deps.onPlay({ mode, server, room: mode === 'online' ? room : undefined, match: mode === 'offline' ? match : undefined, name: s.name, team: s.team, cls: s.cls });
  };
  el.querySelector('[data-play]')!.addEventListener('click', () => play('offline'));
  el.querySelector('[data-join]')!.addEventListener('click', () => play('online'));
  el.querySelector('[data-settings]')!.addEventListener('click', () => { deps.sound?.('click'); showView('settings'); });
  el.querySelector('[data-rooms]')!.addEventListener('click', () => { deps.sound?.('click'); showView('rooms'); });
  for (const b of el.querySelectorAll<HTMLElement>('[data-nav]')) b.addEventListener('mouseenter', () => deps.sound?.('hover'));

  const back = () => { if (view !== 'main') { deps.sound?.('back'); showView('main'); } };
  // Keys never leak to the game's window-level input while the menu is up (typing a name must not walk the
  // corgi, and Tab must move focus instead of opening the scoreboard).
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const t = e.target as HTMLInputElement;
    const typing = t.tagName === 'INPUT' && t.type === 'text';
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); if (typing) t.blur(); else back(); return; }
    if (k === 'Enter' && typing) { e.preventDefault(); if (t === serverIn) play('online'); else navMove(el, 0, 1); return; }
    const dir: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const d = dir[k];
    if (!d) return;
    if ((typing || t.type === 'range') && d[0] !== 0) return; // native caret / slider handling
    e.preventDefault();
    navMove(el, d[0], d[1]);
  });
  el.addEventListener('keyup', (e) => e.stopPropagation());

  const pad = new PadNav();
  paint();
  return {
    el,
    get isOpen() { return open; },
    open(v = 'main') { open = true; progress = loadProgress(); if (!isUnlocked(progress, chapter.index)) chapter = defaultChapter(progress); el.classList.remove('hidden'); paint(); showView(v); },
    close() { open = false; rooms.close(); el.classList.add('hidden'); (document.activeElement as HTMLElement | null)?.blur?.(); },
    poll(now) { if (open) pad.poll(now, el, back, () => { if (view === 'main') play('offline'); }); },
    refresh: paint,
  };
}
