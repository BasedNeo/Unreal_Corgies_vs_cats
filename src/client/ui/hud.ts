// OWNER: L5 (juice). Comic-panel HUD + menus: health (damage ghosting), ammo + reload, class/ability cooldown,
// spread-aware crosshair + hit markers, damage direction, kill feed, match bar, death/respawn screen,
// scoreboard (Tab), main menu, settings, click-to-play overlay.
//
// Wiring (see docs/handoff/L5.md): createHud(ui, actions) · hud.update(model) every frame ·
// bus 'game' → hud.onGameEvent(ev) · bus 'notice' → hud.notice(text). HudModel stays backward compatible:
// every L5 addition is optional.
// U1 (ux, docs/handoff/U1.md): text chat (Enter/T; bus 'chat' → hud.chat, bus 'notice' → hud.serverNotice,
// actions.sendChat, actions.chatOpenChanged → input.suspended), first-match tips, the room browser in the menu and
// the quality "applies after reload" notice. All optional: the old wiring still compiles and runs.
import type { Look } from '../../shared/content/cosmetics';
import type { EntityState, GameEvent, MatchState, RosterEntry } from '../../shared/protocol';
import { CLASS_IDS, EFlag, EntityKind, Species, type ClassId, type TeamId } from '../../shared/types';
import { CLASSES } from '../../shared/content/classes';
import { PICKUPS } from '../../shared/content/pickups';
import { WEAPON_FX, WeaponTable } from '../fx/weapon-fx';
import { ensureFonts } from './fonts';
import { injectHudStyle } from './hud-style';
import { classIcon, weaponGlyph, WEAPON_GLYPHS } from './icons';
import { KillFeed, seatedGlyph, type FeedParty } from './kill-feed';
import { createMenu, createSettingsPanel, firstPad, PadNav, type Menu, type MenuDeps, type PlayOptions, type UiSoundKind } from './menu';
import { buildScoreboard, renderScoreboardHtml } from './scoreboard';
import { counterFirst, objectiveForTeam, scoreboardMeta } from './objective';
import { loadSettings, saveSettings, safeStorage, type KV, type QualitySetting, type Settings, type SettingKey } from './settings';
import { ABILITY_COOLDOWN_ESTIMATE, CONTROLS, DEATH_QUIPS, RELOAD_ESTIMATE, RESPAWN_ESTIMATE, TEAM_NAMES } from './strings';
import { createChat } from './chat';
import { isPresenceNotice } from './chat-model';
import { TipScheduler, createTipView } from './tips';
import { bootQuality, reloadUrl } from './quality-note';
import type { RoomPoller } from './rooms';
import { findInteractTarget } from '../interact/targets';
import { serverUrlForPage } from '../net/server-url';

export type { PlayOptions } from './menu';
export type { Settings, SettingKey } from './settings';

export interface HudModel {
  local: EntityState | null;
  match: MatchState | null;
  roster: RosterEntry[];
  fps: number;
  rttMs: number;
  locked: boolean;
  backend: string;
  transport: string;
  // ---- optional L5 additions ----
  /** All interpolated entity states this frame (damage direction, names/species for the feed). */
  states?: Map<number, EntityState>;
  /** Authoritative seconds until the local player respawns (else a 5 s estimate from the death event). */
  respawnIn?: number;
  /** A status cue (HIDDEN / SPOTTED / DOT ON YOU) or the plane's cockpit strip holds the bottom centre: first-match
   *  tips wait (their timers pause) instead of covering it (Q2 P2-4). */
  cueUp?: boolean;
  /** Authoritative ability cooldown (else estimated from the local `ability` event). */
  ability?: { id: string; cooldownLeft: number; cooldownTotal: number };
  /** Magazine size of the equipped weapon (else the largest ammo count seen since the weapon was equipped). */
  magSize?: number;
  /** 0..1 reload progress (else estimated from the local `reload` event). */
  reloadFrac?: number;
  /** Show the fps/backend/rtt line (default true). */
  showDebug?: boolean;
}

export interface HudActions {
  /** Menu "Play offline" / "Join" — the lead (re)connects with these options. */
  play(opts: PlayOptions): void;
  chooseClass(cls: ClassId): void;
  chooseTeam(team: TeamId | -1): void;
  /** Called after the HUD has persisted the change; apply it (input sensitivity, audio volumes, quality). */
  setSetting<K extends SettingKey>(key: K, value: Settings[K]): void;
  // ---- U1 additions ----
  /** Send a chat line (already cleaned, ≤ 120 chars) to the authority. Return false when not connected. */
  sendChat(text: string): boolean;
  /** Chat opened/closed: suspend game input while it is open (`input.suspended = open`). */
  chatOpenChanged(open: boolean): void;
  /** Settings › Quality › Reload now. Default: reload this page without ?quality=. */
  reload(): void;
  /** U2: a look was equipped in the LOCKER (that species' full look): send it so the next spawn wears it. */
  setLook(species: 'corgi' | 'cat', look: Required<Look>): void;
}

export interface Hud {
  update(m: HudModel): void;
  /** Hit confirmation. kill = red X (+"KO!"), crit = gold headshot variant. */
  hitMarker(kill: boolean, crit?: boolean): void;
  /** Red edge flash, strength from damage amount. */
  damageFlash(amount: number): void;
  /** Hit markers, damage direction, kill feed, death screen, reload/ability timers, banners. */
  onGameEvent(ev: GameEvent): void;
  /** Toast line (bus 'notice'). */
  notice(text: string): void;
  showMenu(open: boolean, view?: 'main' | 'settings'): void;
  readonly menuOpen: boolean;
  /** Force the scoreboard open/closed (Tab and gamepad Back are handled internally). */
  setScoreboard(open: boolean): void;
  /** Persisted settings (read at boot to configure input/audio/quality). */
  readonly settings: Settings;
  setWeaponIds(ids: readonly string[]): void;
  /** Optional UI sound hook (e.g. audio.ui). */
  setUiSound(fn: (kind: UiSoundKind) => void): void;
  // ---- U1 additions ----
  /** A chat line from the authority (bus 'chat'). */
  /** `team` from the server when known; otherwise the roster is searched by name. */
  chat(from: string, text: string, team?: number): void;
  /** A server notice (bus 'notice'): goes to the chat feed; also toasts unless it is a join/leave line. */
  serverNotice(text: string): void;
  /** True while the chat input is open (game input should be suspended). */
  readonly chatOpen: boolean;
  /** Forget which first-match tips were seen (Settings › Show again does this too). */
  resetTips(): void;
  dispose(): void;
}

const DMG_SLOTS = 4;
// Web Animations keyframes (restartable without forcing a synchronous layout, unlike class toggles + offsetWidth).
const BUMP: Keyframe[] = [{ transform: 'scale(1)' }, { transform: 'scale(1.45) rotate(-6deg)', offset: 0.4 }, { transform: 'scale(1)' }];
const SHAKE: Keyframe[] = [{ transform: 'skewX(-10deg) translateX(0)' }, { transform: 'skewX(-10deg) translateX(-5px)', offset: 0.25 }, { transform: 'skewX(-10deg) translateX(4px)', offset: 0.6 }, { transform: 'skewX(-10deg) translateX(0)' }];
const POP_IN: Keyframe[] = [{ transform: 'scale(.2) rotate(-12deg)', opacity: 0 }, { transform: 'none', opacity: 1 }];
const RING_R = 26, RING_C = 2 * Math.PI * RING_R;
const DS_R = 44, DS_C = 2 * Math.PI * DS_R;
const HM_ANGLES = [45, 135, 225, 315];

export interface HudOptions {
  /** Seconds clock for HUD animations (labs/tests inject a pausable one). Default performance.now()/1000. */
  clock?: () => number;
  // ---- U1 additions ----
  /** The quality tier the world view was built with. Default: ?quality= or the saved setting (as main.ts does). */
  appliedQuality?: QualitySetting;
  /** Set true once changing quality fully applies live (hides the "applies after reload" notice). */
  qualityLive?: boolean;
  /** The server this page plays on (room browser + server field). Default serverUrlForPage(). */
  pageServer?: string | null;
  /** First-match tips on/off (labs pass false) and their storage (tests pass a double). */
  tips?: boolean;
  tipsStorage?: KV | null;
  /** Room list poller for the menu's room browser (tests/labs inject a fake fetch). */
  roomPoller?: RoomPoller;
  /** Offline match type pre-selected in the menu (the page's ?mode=). */
  match?: string;
  /** W8: the map pre-selected in the menu (the page's ?map=). */
  map?: string;
}

export function createHud(root: HTMLElement, actions?: Partial<HudActions>, opts: HudOptions = {}): Hud {
  injectHudStyle();
  void ensureFonts();
  const settings = loadSettings();
  const weapons = new WeaponTable();
  let uiSound: ((k: UiSoundKind) => void) | null = null;

  const el = document.createElement('div');
  el.id = 'cvc-hud';
  el.innerHTML = `
    <div class="vig-low"></div><div class="vig"></div>
    <div class="game">
      <div class="dbg"></div>
      <div class="mb hidden">
        <div class="mb-team t0"><span class="mb-name">${TEAM_NAMES[0]}</span><span class="mb-score" data-s0>0</span></div>
        <div class="mb-mid"><div class="mb-timer">0:00</div><div class="mb-obj"></div></div>
        <div class="mb-team t1"><span class="mb-score" data-s1>0</span><span class="mb-name">${TEAM_NAMES[1]}</span></div>
      </div>
      <div class="mb-wave hidden"></div>
      <div class="toasts"></div>
      <div class="kf"></div>
      <div class="dd">${Array.from({ length: DMG_SLOTS }, () => `<div><svg viewBox="0 0 120 44"><path d="M6 40 Q60 -4 114 40 L100 43 Q60 12 20 43 Z" fill="#e8453c" stroke="#1a120c" stroke-width="3.5" stroke-linejoin="round"/><path d="M52 14 L60 3 L68 14 Z" fill="#fff4dc" stroke="#1a120c" stroke-width="2.5" stroke-linejoin="round"/></svg></div>`).join('')}</div>
      <div class="xh"><i class="v" data-xt></i><i class="v" data-xb></i><i class="h" data-xl></i><i class="h" data-xr></i><i class="dot"></i>
        <div class="hm">${HM_ANGLES.map((a) => `<i style="transform:rotate(${a}deg) translateY(calc(var(--u)*-13))"></i>`).join('')}</div>
      </div>
      <div class="hp hidden">
        <div class="hp-badge"></div>
        <div class="hp-body">
          <div class="hp-top"><span class="hp-num">0</span><span class="hp-max">/0</span><span class="hp-cls"></span></div>
          <div class="hp-bar"><div class="hp-ghost"></div><div class="hp-fill"></div><div class="hp-ticks"></div></div>
        </div>
        <div class="ab ready"><svg class="ab-ring" viewBox="0 0 58 58"><circle class="bg" cx="29" cy="29" r="${RING_R}"/><circle class="fg" cx="29" cy="29" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="0"/></svg>
          <div class="ab-core"></div><div class="ab-cd"></div><span class="ab-key">Q</span></div>
      </div>
      <div class="am hidden">
        <div class="am-wpn"></div>
        <div class="am-pips"></div>
        <div class="am-row"><span class="am-num">0</span><span class="am-mag">/ 0</span></div>
        <div class="am-reload hidden"><span>RELOADING</span><div class="am-rbar"><i></i></div></div>
        <div class="am-hint hidden">PRESS R TO RELOAD</div>
      </div>
      <div class="ds hidden"><div class="ds-veil"></div>
        <div class="ds-stack">
          <div class="ds-title">KNOCKED <b>OUT!</b></div>
          <div class="panel halftone ds-card"><div class="ds-icon"></div><div><div class="ds-by">BONKED BY</div><div class="ds-killer"></div></div></div>
          <div class="ds-quip"></div>
          <div class="ds-count"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${DS_R}"/><circle class="fg" cx="50" cy="50" r="${DS_R}" stroke-dasharray="${DS_C.toFixed(1)}"/></svg><span class="ds-num">5</span></div>
          <div class="ds-back">BACK IN THE YARD</div>
        </div>
      </div>
      <div class="bn hidden"><div class="bn-burst"><div class="bn-text"></div></div></div>
      <div class="u1-slot" data-tip-slot></div>
      <div class="u1-slot" data-chat-slot></div>
      <div class="sb panel hidden"><div class="sb-head"><span class="sb-title">SCOREBOARD</span><span class="sb-meta"></span></div><div class="sb-cols"></div></div>
    </div>
    <div class="lk interactive hidden">
      <div class="panel halftone lk-panel">
        <div class="lk-main">
          <div class="lk-title">CLICK TO PLAY</div>
          <div class="lk-sub">Your pointer locks to aim · press Esc to get it back</div>
          <div class="keys">${CONTROLS.map(([k, v]) => `<span><kbd>${k}</kbd>${v}</span>`).join('')}</div>
          <div class="lk-btns"></div>
        </div>
        <div class="lk-settings hidden"></div>
      </div>
    </div>`;
  root.appendChild(el);

  const q = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector(s) as T;
  const game = q('.game');
  const dbg = q('.dbg');
  const mb = q('.mb'), s0 = q('[data-s0]'), s1 = q('[data-s1]'), timer = q('.mb-timer'), obj = q('.mb-obj'), wave = q('.mb-wave');
  const mbTeams = [...el.querySelectorAll<HTMLElement>('.mb-team')];
  const toasts = q('.toasts'), kf = q('.kf');
  const ddSlots = [...el.querySelectorAll<HTMLElement>('.dd > div')];
  const xh = q('.xh'), xt = q('[data-xt]'), xb = q('[data-xb]'), xl = q('[data-xl]'), xr = q('[data-xr]');
  const hm = q('.hm');
  const hp = q('.hp'), hpBadge = q('.hp-badge'), hpNum = q('.hp-num'), hpMax = q('.hp-max'), hpCls = q('.hp-cls');
  const hpBar = q('.hp-bar'), hpGhost = q('.hp-ghost'), hpFill = q('.hp-fill');
  const ab = q('.ab'), abCore = q('.ab-core'), abCd = q('.ab-cd'), abFg = q('.ab-ring .fg') as unknown as SVGCircleElement;
  const am = q('.am'), amWpn = q('.am-wpn'), amPips = q('.am-pips'), amNum = q('.am-num'), amMag = q('.am-mag');
  const amReload = q('.am-reload'), amRbar = q('.am-rbar i'), amHint = q('.am-hint');
  const ds = q('.ds'), dsIcon = q('.ds-icon'), dsKiller = q('.ds-killer'), dsQuip = q('.ds-quip'), dsNum = q('.ds-num'), dsFg = q('.ds-count .fg') as unknown as SVGCircleElement;
  const dsCard = q('.ds-card'), dsBack = q('.ds-back');
  const bn = q('.bn'), bnText = q('.bn-text');
  const sb = q('.sb'), sbCols = q('.sb-cols'), sbMeta = q('.sb-meta');
  const vig = q('.vig'), vigLow = q('.vig-low');
  const lk = q('.lk'), lkMain = q('.lk-main'), lkSettings = q('.lk-settings'), lkBtns = q('.lk-btns');

  // ---------------------------------------------------------------- menus
  const sound = (k: UiSoundKind) => uiSound?.(k);
  const persist = <K extends SettingKey>(key: K, value: Settings[K]) => {
    (settings as unknown as Record<string, unknown>)[key] = value;
    saveSettings(settings);
    actions?.setSetting?.(key, value);
  };
  // U1: first-match tips + session flag (the quality notice warns that a reload leaves the match).
  const tips = opts.tips === false ? null : new TipScheduler(opts.tipsStorage === undefined ? safeStorage() : opts.tipsStorage);
  let session = false;
  const deps: MenuDeps = {
    settings,
    onPlay: (opts) => { menu.close(); actions?.play?.(opts); },
    onClass: (c) => actions?.chooseClass?.(c),
    onTeam: (t) => actions?.chooseTeam?.(t),
    onSetting: persist,
    sound,
    pageServer: opts.pageServer !== undefined ? opts.pageServer : safePageServer(),
    appliedQuality: opts.appliedQuality ?? bootQuality(typeof location !== 'undefined' ? location.search : '', settings.quality),
    qualityLive: opts.qualityLive,
    inSession: () => session,
    onReload: () => { if (actions?.reload) actions.reload(); else location.replace(reloadUrl(location.href)); },
    onResetTips: tips ? () => tips.reset() : undefined,
    onLook: (sp, look) => actions?.setLook?.(sp, look), // U2
    roomPoller: opts.roomPoller,
    match: opts.match,
    map: opts.map,
  };
  const menu: Menu = createMenu(el, deps);
  const pauseSettings = createSettingsPanel(deps, () => { lkSettings.classList.add('hidden'); lkMain.classList.remove('hidden'); }, 'RESUME ▸');
  lkSettings.appendChild(pauseSettings.el);
  if (actions) {
    lkBtns.innerHTML = `<button class="btn small" data-nav data-lk-settings>⚙ SETTINGS</button><button class="btn small" data-nav data-lk-menu>MAIN MENU</button>`;
    q('[data-lk-settings]').addEventListener('click', (e) => { e.stopPropagation(); sound('click'); pauseSettings.refresh(); lkMain.classList.add('hidden'); lkSettings.classList.remove('hidden'); });
    q('[data-lk-menu]').addEventListener('click', (e) => { e.stopPropagation(); sound('open'); menu.open('main'); });
  }
  lk.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.lk-settings, button')) return;
    document.querySelector('canvas')?.requestPointerLock?.();
  });
  lkSettings.addEventListener('click', (e) => e.stopPropagation());
  lk.addEventListener('keydown', (e) => e.stopPropagation());
  const pausePad = new PadNav();

  // ---------------------------------------------------------------- state
  let uPx = 1;
  const measure = () => { uPx = Math.max(0.6, Math.min(innerWidth / 1280, innerHeight / 720)); };
  measure();
  addEventListener('resize', measure);

  let rosterRef: RosterEntry[] | null = null;
  const rosterBy = new Map<number, RosterEntry>();
  let states: Map<number, EntityState> = new Map();
  let localId = -1, localTeam = 0, localDead = false;
  let lastScore: [number, number] = [-1, -1];
  let lastPhase = '';
  let lastWave = -1;
  const lastWpnBy = new Map<number, number>();
  const lastHitOn = new Map<number, { src: number; crit: boolean; t: number }>();
  const lastExplodeBy = new Map<number, number>();
  /** victim → { killer, time }: the death screen looks this up when the Dead flag shows (order-independent). */
  const deathBy = new Map<number, { by: number; t: number }>();
  const feed = new KillFeed(5, 6);
  let feedVersion = -1;
  // health
  let shownHp = -1, ghostHp = 0, ghostHold = 0, lastHpMax = -1, hpClass = '', hurtAnimAt = -1;
  // crosshair
  let spread = 10, kick = 0, lastSpreadPx = -1;
  let hmAt = -10, hmKind = '', dmgFlash = 0;
  const dd: Array<{ src: number; x: number; z: number; until: number }> = Array.from({ length: DMG_SLOTS }, () => ({ src: -1, x: 0, z: 0, until: 0 }));
  let ddNext = 0;
  // ammo/reload/ability
  let lastWeapon = -99, maxAmmoSeen = 0, lastAmmo = -1, lastMag = -1, reloadAt = -10;
  let abilityAt = -100, abilityId = '', abilityScale = 1, lastCls = '', lastCdText = '';
  // death
  let deathAt = -100, killerId = -1, deathCount = 0, lastDsNum = -1;
  // scoreboard
  let tabHeld = false, sbForced = false, padBack = false, sbRenderedAt = -1;
  // banner
  let bannerUntil = 0;
  let lastLocked: boolean | null = null, lastDbg = '';
  const clock = opts.clock ?? (() => performance.now() / 1000);

  // U1: chat (right column, under the kill feed) and first-match tips (bottom centre, under the character).
  // Created after `clock`: the chat renders once while it is built.
  const chat = createChat(q('[data-chat-slot]'), {
    send: (text) => actions?.sendChat?.(text) ?? false,
    clock,
    onOpenChange: (open) => actions?.chatOpenChanged?.(open),
    sound: (k) => sound(k),
  });
  const tipView = createTipView(q('[data-tip-slot]'));
  let tipsLast = -1, kioskAt = -1, nearKiosk = false;

  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Tab' || menu.isOpen) return;
    e.preventDefault();
    tabHeld = e.type === 'keydown';
  };
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKey);
  const onBlur = () => { tabHeld = false; };
  addEventListener('blur', onBlur);

  // ---------------------------------------------------------------- helpers
  const setText = (e: HTMLElement, t: string) => { if (e.textContent !== t) e.textContent = t; };
  // Per-frame style writes go through a last-value cache: unchanged frames touch no DOM at all.
  const opCache = new Map<Element, string>(), tfCache = new Map<Element, string>();
  const setStyle = (e: HTMLElement | SVGElement, prop: 'transform' | 'opacity', v: string) => {
    const cache = prop === 'opacity' ? opCache : tfCache;
    if (cache.get(e) === v) return;
    cache.set(e, v);
    e.style[prop] = v;
  };
  const setAttr = (e: Element, name: string, v: string) => { if (e.getAttribute(name) !== v) e.setAttribute(name, v); };
  const toggle = (e: HTMLElement, cls: string, on: boolean) => { if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on); };
  const show = (e: HTMLElement, on: boolean) => toggle(e, 'hidden', !on);
  const party = (id: number): FeedParty => {
    const r = rosterBy.get(id), s = states.get(id);
    const team = r?.team ?? s?.team ?? 0;
    const name = r?.name ?? (s ? (s.species === Species.Cat ? `Cat ${id}` : `Pup ${id}`) : `#${id}`);
    return { id, name, team, local: id === localId, bot: r?.bot ?? false };
  };
  const banner = (text: string, team: number | null, secs = 2.2) => {
    setText(bnText, text);
    bn.classList.remove('t0', 't1');
    if (team !== null) bn.classList.add(`t${team}`);
    // Restart the pop-in animation.
    (bn.firstElementChild as HTMLElement).animate?.(POP_IN, { duration: 500, easing: 'cubic-bezier(.2,1.6,.4,1)' });
    show(bn, true);
    bannerUntil = clock() + secs;
  };
  const renderFeed = () => {
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    // Names resolve at render time: events can arrive before the roster that names their entities.
    const nm = (p: FeedParty) => esc(rosterBy.get(p.id)?.name ?? p.name);
    kf.innerHTML = feed.entries.map((e) => {
      const me = e.victim.local || e.killer?.local;
      const k = e.killer ? `<span class="kf-n t${e.killer.team}">${nm(e.killer)}</span>` : '';
      return `<div class="kf-e${me ? ' me' : ''}">${k}${weaponGlyph(e.glyph)}${e.crit ? WEAPON_GLYPHS.star.replace('class="glyph"', 'class="glyph star"') : ''}<span class="kf-n t${e.victim.team}">${nm(e.victim)}</span></div>`;
    }).join('');
  };
  const fmtTime = (s: number) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

  // ---------------------------------------------------------------- API
  const hud: Hud = {
    get settings() { return settings; },
    get menuOpen() { return menu.isOpen; },

    update(m) {
      const now = clock();
      if (m.states) states = m.states;
      const L = m.local;
      localId = L?.id ?? -1;
      if (L) localTeam = L.team;
      if (m.roster !== rosterRef) { rosterRef = m.roster; rosterBy.clear(); for (const r of m.roster) rosterBy.set(r.entity, r); feedVersion = -1; }
      const inMenu = menu.isOpen;
      show(game, !inMenu);
      menu.poll(now);

      // ---- debug line
      if (m.showDebug !== false) {
        const t = `${m.fps.toFixed(0)} fps · ${m.backend} · ${m.transport} · rtt ${m.rttMs.toFixed(0)}ms`;
        if (t !== lastDbg) { lastDbg = t; dbg.textContent = t; }
      } else if (lastDbg) { lastDbg = ''; dbg.textContent = ''; }

      // ---- chat + session (U1)
      session = !!m.match || !!m.local;
      chat.update({ roster: m.roster, localEntity: localId, canOpen: session && !inMenu });

      // ---- pause overlay (hidden while chatting: typing is not "paused", and Esc there cancels the chat)
      const wantLock = !m.locked && !inMenu && !chat.isOpen;
      if (wantLock !== lastLocked) {
        lastLocked = wantLock;
        show(lk, wantLock);
        if (!wantLock) { lkSettings.classList.add('hidden'); lkMain.classList.remove('hidden'); }
      }
      if (wantLock) pausePad.poll(now, lk, () => { lkSettings.classList.add('hidden'); lkMain.classList.remove('hidden'); });

      // ---- match bar
      const M = m.match;
      show(mb, !!M);
      if (M) {
        for (let t = 0; t < 2; t++) {
          if (M.score[t] !== lastScore[t]) {
            const e = t === 0 ? s0 : s1;
            e.textContent = String(M.score[t]);
            if (lastScore[t] >= 0) e.animate?.(BUMP, { duration: 450, easing: 'cubic-bezier(.2,1.8,.4,1)' });
            lastScore[t] = M.score[t];
          }
          toggle(mbTeams[t], 'mine', !!L && L.team === t);
        }
        // Untimed live phases (skirmish waves) show the wave instead of a red 0:00.
        const untimed = M.phase === 'live' && M.timeLeft <= 0;
        const tt = M.phase === 'warmup' ? `WARMUP ${fmtTime(M.timeLeft)}` : M.phase === 'ended' ? 'FINAL' : untimed ? (M.wave > 0 ? `${M.mode === 'adventure' ? 'STEP' : 'WAVE'} ${M.wave}` : 'LIVE') : fmtTime(M.timeLeft);
        setText(timer, tt);
        toggle(timer, 'warm', M.phase === 'warmup');
        toggle(timer, 'low', M.phase === 'live' && !untimed && M.timeLeft <= 30);
        setText(obj, counterFirst(objectiveForTeam(M.objective, M.mode, L ? L.team : 0)));
        const showWave = M.wave > 0 && /skirmish|wave|pve/i.test(M.mode);
        show(wave, showWave && !untimed); // an untimed live phase already reads WAVE n in the timer
        if (showWave) setText(wave, `WAVE ${M.wave}`);
        if (M.phase !== lastPhase) {
          if (lastPhase === 'warmup' && M.phase === 'live') banner('FUR WILL FLY!', null, 1.6);
          if (M.phase === 'ended' && M.mode !== 'adventure') banner(M.winner === 0 ? 'CORGIS WIN!' : M.winner === 1 ? 'CATS WIN!' : 'DRAW!', M.winner >= 0 ? M.winner : null, 6);
          lastPhase = M.phase;
        }
        if (showWave && lastWave >= 0 && M.wave > lastWave && M.phase === 'live') banner(`WAVE ${M.wave}!`, null, 1.8);
        lastWave = M.wave;
      }
      if (!bn.classList.contains('hidden') && now > bannerUntil) show(bn, false);

      // ---- local player panels
      const alive = !!L && (L.flags & EFlag.Dead) === 0;
      show(hp, !!L);
      show(xh, alive);
      if (L) {
        const cls = CLASS_IDS[L.cls] ?? 'assault';
        if (cls + L.team !== lastCls) {
          lastCls = cls + L.team;
          hpBadge.innerHTML = classIcon(cls);
          abCore.innerHTML = classIcon(cls);
          hpCls.textContent = CLASSES[cls].displayName.toUpperCase();
          hp.classList.toggle('t0', L.team !== 1); hp.classList.toggle('t1', L.team === 1);
        }
        // Health with damage ghosting: the white ghost holds ~0.45 s, then drains; heals show a green ghost.
        const max = Math.max(1, L.maxHp), cur = Math.max(0, L.hp);
        if (shownHp < 0 || max !== lastHpMax) { ghostHp = cur; shownHp = cur; lastHpMax = max; setText(hpMax, `/${Math.round(max)}`); }
        if (cur < shownHp - 0.01) { ghostHold = now + 0.45; if (now - hurtAnimAt > 0.2) { hurtAnimAt = now; hpBar.animate?.(SHAKE, { duration: 280 }); } }
        if (cur > shownHp + 0.01) ghostHp = Math.max(ghostHp, cur);
        shownHp = cur;
        if (now > ghostHold) ghostHp += (cur - ghostHp) * Math.min(1, (1 / 60) * 6);
        const heal = ghostHp < cur - 0.5;
        setStyle(hpFill, 'transform', `scaleX(${(Math.min(cur, heal ? ghostHp : cur) / max).toFixed(3)})`);
        setStyle(hpGhost, 'transform', `scaleX(${(Math.max(ghostHp, heal ? cur : 0) / max).toFixed(3)})`);
        if (heal) ghostHp += (cur - ghostHp) * 0.08;
        toggle(hpGhost, 'heal', heal);
        const frac = cur / max;
        const c = frac > 0.5 ? '' : frac > 0.25 ? 'mid' : 'low';
        if (c !== hpClass) { hpFill.classList.remove('mid', 'low'); if (c) hpFill.classList.add(c); hpClass = c; }
        setText(hpNum, String(Math.ceil(cur)));
        setStyle(vigLow, 'opacity', alive && frac < 0.3 ? (0.35 + (0.3 - frac) * 2).toFixed(2) : '0');

        // Ability cooldown ring.
        const abil = CLASSES[cls].ability;
        let left = 0, total = 1;
        if (m.ability) { left = m.ability.cooldownLeft; total = Math.max(0.01, m.ability.cooldownTotal); }
        else if (abilityId) { total = (ABILITY_COOLDOWN_ESTIMATE[abilityId] ?? 8) * abilityScale; left = Math.max(0, abilityAt + total - now); }
        const cd = left > 0.05;
        toggle(ab, 'cooling', cd);
        toggle(ab, 'ready', !cd && alive);
        setAttr(abFg, 'stroke-dashoffset', (RING_C * (cd ? left / total : 0)).toFixed(1));
        const cdt = cd ? String(Math.ceil(left)) : '';
        if (cdt !== lastCdText) { abCd.textContent = cdt; lastCdText = cdt; }
        ab.title = abil;

        // Ammo, pips, reload.
        const hasWeapon = L.weapon >= 0;
        show(am, hasWeapon);
        if (hasWeapon) {
          if (L.weapon !== lastWeapon) {
            lastWeapon = L.weapon; maxAmmoSeen = 0; lastAmmo = -1;
            const wfx = weapons.fx(L.weapon);
            amWpn.innerHTML = `${weaponGlyph(wfx.glyph)}<span>${wfx.label.toUpperCase()}</span>`;
          }
          const ammo = Math.max(0, L.ammo);
          maxAmmoSeen = Math.max(maxAmmoSeen, ammo);
          const mag = m.magSize ?? maxAmmoSeen;
          if (ammo !== lastAmmo || mag !== lastMag) {
            setText(amNum, mag > 0 ? String(ammo) : '—');
            setText(amMag, mag > 0 ? `/ ${mag}` : '');
            toggle(amNum, 'low', mag > 0 && ammo > 0 && ammo <= Math.max(1, Math.floor(mag * 0.25)));
            toggle(amNum, 'empty', mag > 0 && ammo === 0);
            if (mag !== lastMag) amPips.innerHTML = mag > 0 && mag <= 40 ? '<i></i>'.repeat(mag) : '';
            const pips = amPips.children;
            for (let i = 0; i < pips.length; i++) toggle(pips[i] as HTMLElement, 'spent', i >= ammo);
            lastAmmo = ammo; lastMag = mag;
          }
          const reloading = (L.flags & EFlag.Reloading) !== 0;
          show(amReload, reloading);
          if (reloading) {
            const f = m.reloadFrac ?? Math.min(0.97, (now - reloadAt) / RELOAD_ESTIMATE);
            setStyle(amRbar, 'transform', `scaleX(${Math.max(0, f).toFixed(2)})`);
          }
          show(amHint, !reloading && mag > 0 && ammo === 0 && alive);
        }
      } else {
        shownHp = -1;
        setStyle(vigLow, 'opacity', '0');
        show(am, false);
      }

      // ---- crosshair: spread from movement/air/sprint/fire, tightened while aiming
      if (L && alive) {
        const f = L.flags;
        const sp = Math.hypot(L.vx, L.vz);
        let target = 7 + sp * 0.9;
        if ((f & EFlag.Grounded) === 0) target += 9;
        if ((f & EFlag.Sprinting) !== 0) target += 8;
        if ((f & EFlag.Firing) !== 0) target += 4;
        target += kick;
        if ((f & EFlag.Aiming) !== 0) target *= 0.5;
        kick *= 0.86;
        spread += (target - spread) * 0.3;
        const px = Math.round(spread * uPx * 2) / 2;
        if (px !== lastSpreadPx) {
          lastSpreadPx = px;
          const len = 9 * uPx;
          setStyle(xt, 'transform', `translateY(${-px - len}px)`);
          setStyle(xb, 'transform', `translateY(${px}px)`);
          setStyle(xl, 'transform', `translateX(${-px - len}px)`);
          setStyle(xr, 'transform', `translateX(${px}px)`);
        }
      }
      // Hit marker pop: scale 1.5 → 1, fade after 120 ms (kill lingers longer).
      const hmLife = hmKind === 'kill' ? 0.55 : 0.28;
      const ht = now - hmAt;
      if (ht < hmLife) {
        const k = Math.min(1, ht / 0.08);
        setStyle(hm, 'opacity', (ht < 0.12 ? 1 : 1 - (ht - 0.12) / (hmLife - 0.12)).toFixed(2));
        setStyle(hm, 'transform', `scale(${(1.5 - 0.5 * k).toFixed(2)}) rotate(${hmKind === 'kill' ? ((1 - k) * 25).toFixed(1) : 0}deg)`);
      } else setStyle(hm, 'opacity', '0');

      // ---- damage direction: arcs point at the attacker, tracking as you turn
      for (let i = 0; i < DMG_SLOTS; i++) {
        const d = dd[i], e = ddSlots[i];
        const left = d.until - now;
        if (left <= 0 || !L) { setStyle(e, 'opacity', '0'); continue; }
        const src = states.get(d.src);
        if (src) { d.x = src.x; d.z = src.z; }
        const dx = d.x - L.x, dz = d.z - L.z;
        // yaw 0 faces −Z; forward = (−sin, −cos), right = (cos, −sin).
        const fwd = -Math.sin(L.yaw) * dx - Math.cos(L.yaw) * dz;
        const rgt = Math.cos(L.yaw) * dx - Math.sin(L.yaw) * dz;
        const ang = Math.atan2(rgt, fwd);
        setStyle(e, 'transform', `rotate(${(ang * 180 / Math.PI).toFixed(1)}deg)`);
        setStyle(e, 'opacity', Math.min(1, left / 0.5).toFixed(2));
      }
      dmgFlash = Math.max(0, dmgFlash - (1 / 60) * 2.2);
      setStyle(vig, 'opacity', dmgFlash.toFixed(2));

      // ---- kill feed
      feed.prune(now);
      if (feed.version !== feedVersion) { feedVersion = feed.version; renderFeed(); }

      // ---- death screen
      const dead = !!L && !alive;
      if (dead && !localDead) {
        localDead = true; deathCount++;
        deathAt = now; killerId = -2; // -2 = card not rendered yet
        const quips = L!.species === Species.Cat ? DEATH_QUIPS.cat : DEATH_QUIPS.corgi;
        dsQuip.textContent = quips[deathCount % quips.length];
      }
      if (dead) {
        // The death event can land before or after the Dead flag (states are interpolated ~100 ms behind).
        const rec = deathBy.get(localId);
        const match = !!rec && rec.t > deathAt - 4; // this death's record (not a stale one from a previous life)
        const by = match ? rec!.by : -1;
        if (match && rec!.t < deathAt) deathAt = rec!.t;
        if (by !== killerId) {
          killerId = by;
          const kp = by >= 0 && by !== localId ? party(by) : null;
          const kcls = kp ? (rosterBy.get(by)?.cls ?? CLASS_IDS[states.get(by)?.cls ?? 0] ?? 'assault') : null;
          dsCard.className = `panel halftone ds-card t${kp ? kp.team : localTeam}`;
          dsIcon.innerHTML = kcls ? classIcon(kcls) : WEAPON_GLYPHS.fall;
          dsKiller.textContent = kp ? rosterBy.get(by)?.name ?? kp.name : 'the yard itself';
        }
      }
      if (!dead && localDead) { localDead = false; killerId = -1; deathBy.delete(localId); }
      show(ds, dead);

      // ---- first-match tips (U1): only while actually playing; never over the crosshair, never modal
      if (tips) {
        const tdt = tipsLast < 0 ? 0 : now - tipsLast;
        tipsLast = now;
        if (L && alive && now - kioskAt > 0.2) { kioskAt = now; nearKiosk = findInteractTarget(states, L)?.kind === 'ordnance'; }
        const f = L?.flags ?? 0;
        const playing = alive && !inMenu && !chat.isOpen && m.locked && !!M && M.phase !== 'ended' && !m.cueUp;
        tipView.show(tips.update(tdt, {
          active: playing, phase: M?.phase ?? null, nearKiosk: alive && nearKiosk,
          moving: !!L && Math.hypot(L.vx, L.vz) > 1, firing: (f & EFlag.Firing) !== 0, aiming: (f & EFlag.Aiming) !== 0,
        }));
      }
      if (dead) {
        const left = m.respawnIn ?? Math.max(0, deathAt + RESPAWN_ESTIMATE - now);
        const n = Math.ceil(left);
        if (n !== lastDsNum) { lastDsNum = n; dsNum.textContent = n > 0 ? String(n) : '…'; setText(dsBack, n > 0 ? 'BACK IN THE YARD' : 'SNIFFING OUT A SPAWN'); }
        const total = m.respawnIn !== undefined ? Math.max(left, RESPAWN_ESTIMATE) : RESPAWN_ESTIMATE;
        setAttr(dsFg, 'stroke-dashoffset', (DS_C * (1 - Math.min(1, left / total))).toFixed(1));
      }

      // ---- scoreboard (Tab / gamepad Back / forced / match end)
      const pad = firstPad();
      padBack = !!pad && !!pad.buttons[8]?.pressed;
      const sbOpen = !inMenu && (tabHeld || sbForced || padBack || (M?.phase === 'ended' && M.mode !== 'adventure' && now > bannerUntil - 3.5));
      show(sb, sbOpen);
      if (sbOpen && now - sbRenderedAt > 0.25) {
        sbRenderedAt = now;
        const model = buildScoreboard(m.roster, localId);
        // skirmish cats are PvE waves (no roster rows): say how many are in the yard instead of "No one here yet"
        let waveCats = 0;
        for (const s of states.values()) if (s.team === 1 && s.kind === EntityKind.Bot && !(s.flags & EFlag.Dead)) waveCats++;
        const pve = !!M && /skirmish|boss/i.test(M.mode);
        // adventure cats are the chapter's own (Q3 P2-6: not "No one here yet" with cats in the yard)
        const catEmpty = M?.mode === 'adventure' ? (waveCats ? `${waveCats} ${waveCats === 1 ? 'cat' : 'cats'} on the prowl` : 'No cats in sight')
          : pve ? (waveCats ? `${waveCats} wave ${waveCats === 1 ? 'cat' : 'cats'} in the yard` : 'The next wave is on its way') : 'No one here yet';
        sbCols.innerHTML = renderScoreboardHtml(model, M ? M.score : null, classIcon, (c) => CLASSES[c].displayName, ['No one here yet', catEmpty]);
        setText(sbMeta, M ? scoreboardMeta(M) : '');
      }
    },

    hitMarker(kill, crit = false) {
      hmAt = clock();
      hmKind = kill ? 'kill' : crit ? 'crit' : 'hit';
      hm.classList.toggle('kill', kill);
      hm.classList.toggle('crit', !kill && crit);
    },

    damageFlash(amount) { dmgFlash = Math.min(0.95, dmgFlash + 0.25 + amount / 60); },

    onGameEvent(ev) {
      const now = clock();
      switch (ev.e) {
        case 'fire':
          lastWpnBy.set(ev.id, ev.wpn);
          if (ev.id === localId) kick = Math.min(18, kick + 3.5 + WEAPON_FX[weapons.id(ev.wpn)].kick * 30);
          break;
        case 'hit':
          lastHitOn.set(ev.dst, { src: ev.src, crit: ev.crit, t: now });
          if (ev.src === localId && ev.dst !== localId) hud.hitMarker(false, ev.crit);
          if (ev.dst === localId) {
            hud.damageFlash(ev.dmg);
            if (ev.src !== localId) {
              // Reuse this attacker's arc if present, else the oldest slot.
              let slot = dd.findIndex((d) => d.src === ev.src && d.until > now);
              if (slot < 0) { slot = ddNext; ddNext = (ddNext + 1) % DMG_SLOTS; }
              const s = states.get(ev.src);
              dd[slot].src = ev.src; dd[slot].x = s?.x ?? ev.x; dd[slot].z = s?.z ?? ev.z; dd[slot].until = now + 1.6;
            }
          }
          break;
        case 'explode':
          lastExplodeBy.set(ev.by, now);
          break;
        case 'death': {
          const by = ev.by;
          const self = by === ev.id || by < 0;
          const lh = lastHitOn.get(ev.id);
          const exploded = !self && (lastExplodeBy.get(by) ?? -9) > now - 0.5;
          const wpn = lastWpnBy.get(by);
          const ride = !self && !exploded ? seatedGlyph(states, by) : null; // a kill from a seat: the vehicle, not a stale gun
          const glyph = self ? 'fall' : exploded ? 'boom' : ride ?? (wpn !== undefined ? WEAPON_FX[weapons.id(wpn)].glyph : 'paw');
          feed.push({ killer: self ? null : party(by), victim: party(ev.id), glyph, crit: !!lh && lh.src === by && lh.crit && now - lh.t < 0.5 }, now);
          if (by === localId && ev.id !== localId) hud.hitMarker(true);
          deathBy.set(ev.id, { by: self ? -1 : by, t: now });
          if (deathBy.size > 64) deathBy.clear();
          break;
        }
        case 'reload':
          if (ev.id === localId) reloadAt = now;
          break;
        case 'ability':
          // Only class abilities start the Q ring (slide, ground pound, vehicle and boss events also use 'ability').
          if (ev.id === localId && ev.ability in ABILITY_COOLDOWN_ESTIMATE) {
            abilityAt = now; abilityId = ev.ability;
            // Squeaky Clean (Upgrade Core, a snapshot flag) drains ability cooldowns faster: shorten the ring's estimate
            abilityScale = (states.get(localId)?.flags ?? 0) & EFlag.BuffSqueaky ? (PICKUPS.squeaky_clean.buff.abilityCooldown ?? 1) : 1;
          }
          if (ev.id === localId) tips?.onAction(ev.ability);
          break;
        case 'pickup':
          if (ev.id === localId) hud.notice(`Picked up ${ev.item.replace(/_/g, ' ')}`);
          break;
        case 'score':
          // 0-point events (win, reset) are bookkeeping, not rewards: no "+0" toast
          if (ev.reason && ev.reason !== 'kill' && ev.pts > 0) hud.notice(`+${ev.pts} ${ev.team === 0 || ev.team === 1 ? TEAM_NAMES[ev.team] : ''} · ${ev.reason.replace(/_/g, ' ')}`);
          break;
        default:
          break;
      }
    },

    notice(text) {
      const t = document.createElement('div');
      t.className = 'toast';
      t.textContent = text;
      toasts.appendChild(t);
      while (toasts.children.length > 3) toasts.firstElementChild!.remove();
      setTimeout(() => t.remove(), 3300);
    },

    chat(from, text, team) { chat.receive(from, text, team); },
    serverNotice(text) {
      chat.system(text);
      if (!isPresenceNotice(text)) hud.notice(text);
    },
    get chatOpen() { return chat.isOpen; },
    resetTips() { tips?.reset(); },

    showMenu(open, view = 'main') { if (open) { chat.close(true); menu.open(view); } else menu.close(); },
    setScoreboard(open) { sbForced = open; },
    setWeaponIds(ids) { weapons.set(ids); lastWeapon = -99; },
    setUiSound(fn) { uiSound = fn; },
    dispose() {
      removeEventListener('keydown', onKey); removeEventListener('keyup', onKey); removeEventListener('blur', onBlur); removeEventListener('resize', measure);
      chat.dispose();
      el.remove();
    },
  };
  return hud;
}

/** serverUrlForPage() without throwing outside a browser page (labs/tests). */
function safePageServer(): string | null {
  try { return typeof location !== 'undefined' ? serverUrlForPage() : null; } catch { return null; }
}
