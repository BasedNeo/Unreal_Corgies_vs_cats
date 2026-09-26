// OWNER: adventure lane (A1). DOM overlay for the adventure (comic style, sized in --u like the HUD):
//   · intro panel      the briefing: CHAPTER N · TITLE, the featured kit, 2–3 caption boxes popping in; E / Enter /
//                      click skips (E also tells the authority you're ready: when every human is, the chapter starts)
//   · bark bubbles     the step one-liners the authority's `bark` events carry (and the cats' alarm yells)
//   · squad-down beat  the fail-forward beat: "SQUAD DOWN! Back to the checkpoint in 3…"
//   · outro + card     the outro captions, then the chapter-complete card: time, par, the paw medal, NEXT CHAPTER ▸
//                      (Enter) / REPLAY (Backspace); progress is saved to localStorage `cvc.adventure` (progress.ts)
// Reads only the adventure beacon (model.ts), MatchState.timeLeft and game events. Nothing here decides an outcome.
import type { EntityState, GameEvent, MatchState } from '../../shared/protocol';
import { ALARM_BARKS, CHAPTER_PLAN, REGROUP_BARK, chapterByIndex, type ChapterDef } from '../../shared/content/chapters';
import { CLASSES } from '../../shared/content/classes';
import { PALETTE } from '../style/style-tokens.js';
import { classIcon } from '../ui/icons';
import { ADVENTURE_STRINGS as S } from '../ui/strings';
import { FONT_BODY, FONT_DISPLAY, ensureFonts } from '../ui/fonts';
import { captionLinesShown, fmtClock, outroSeconds, readAdventure, syncAdventureChain, type AdventureView } from './model';
import { recordCompletion, type ProgressStorage } from './progress';

export interface AdventureHudOptions {
  /** NEXT CHAPTER / REPLAY on the chapter-complete card (chapter id to play; the page decides how). */
  onNext?(chapter: string): void;
  onReplay?(chapter: string): void;
  /** The running chapter changed (e.g. apply its time of day: `def.t`). */
  onChapter?(def: ChapterDef): void;
  /** True when the authority moves the room on by itself (online): the card shows the countdown instead of buttons. */
  roomAdvances?: boolean;
  sound?(kind: 'click' | 'hover' | 'back' | 'open'): void;
  keys?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  storage?: ProgressStorage | null;
}

export interface AdventureHud {
  readonly el: HTMLElement;
  /** Call every frame BEFORE the interact views/prompts sync (it points S1's chain slot at the chapter). */
  update(states: ReadonlyMap<number, EntityState>, match: MatchState | null, localId: number, dt: number): void;
  onGameEvent(ev: GameEvent): void;
  /** What the overlay shows now (tests, debug). */
  readonly showing: { intro: boolean; card: boolean; down: boolean; barks: number };
  readonly view: AdventureView | null;
  dispose(): void;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const u = (n: number) => `calc(var(--u)*${n})`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const PAW_COLORS = { gold: ['#ffd04a', '#b8860b'], silver: ['#e4e8ef', '#8b95a5'], bronze: ['#e0995a', '#8a4d24'] } as const;
export function pawSvg(medal: 'gold' | 'silver' | 'bronze' | null): string {
  const [fill, dark] = medal ? PAW_COLORS[medal] : ['#c9c0ae', '#7d7466'];
  const ink = hex(PALETTE.ink);
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><g stroke="${ink}" stroke-width="3.2" fill="${fill}">
    <ellipse cx="32" cy="42" rx="14" ry="12"/><ellipse cx="15" cy="27" rx="6" ry="8" transform="rotate(-18 15 27)"/>
    <ellipse cx="26" cy="17" rx="6" ry="8.5"/><ellipse cx="38" cy="17" rx="6" ry="8.5"/><ellipse cx="49" cy="27" rx="6" ry="8" transform="rotate(18 49 27)"/></g>
    <ellipse cx="28" cy="38" rx="4" ry="3" fill="#fff" opacity=".55"/><path d="M22 50 q10 6 20 0" stroke="${dark}" stroke-width="2.5" fill="none"/></svg>`;
}

const CSS = `
.cvc-adv{position:absolute;inset:0;pointer-events:none;overflow:hidden;user-select:none;-webkit-user-select:none;z-index:7;
  --u:max(0.6px,min(calc(100vw / 1280),calc(100vh / 720)));--ink:${hex(PALETTE.ink)};--paper:#f6ecd8;--gold:#ffd04a;--red:#e8453c;
  --corgi:${hex(PALETTE.teamCorgis)};--corgi2:${hex(PALETTE.teamCorgisTrim)};--cap:#ffe45c;
  font-family:${FONT_DISPLAY};color:var(--ink);font-size:${u(16)};line-height:1.15}
.cvc-adv .hidden{display:none!important}
.cvc-adv kbd{display:inline-grid;place-items:center;min-width:${u(24)};height:${u(24)};font:${u(14)} ${FONT_DISPLAY};background:var(--gold);color:var(--ink);
  border:${u(2.5)} solid var(--ink);border-radius:${u(6)};box-shadow:0 ${u(3)} 0 var(--ink);padding:0 ${u(5)};margin:0 ${u(3)}}
/* the big comic panel (intro / outro) */
.cvc-adv .av-panel{position:absolute;left:50%;top:${u(112)};transform:translateX(-50%) rotate(-1.2deg);width:${u(740)};max-width:94vw;
  background:var(--paper);border:${u(5)} solid var(--ink);border-radius:${u(6)};box-shadow:${u(8)} ${u(10)} 0 var(--ink);padding:${u(16)} ${u(22)} ${u(18)};
  pointer-events:auto;animation:cvc-av-in .45s cubic-bezier(.3,1.6,.5,1)}
.cvc-adv .av-panel::before{content:'';position:absolute;inset:0;pointer-events:none;border-radius:inherit;
  background:radial-gradient(circle,rgba(26,18,12,.16) 26%,transparent 29%) 0 0/${u(8)} ${u(8)};-webkit-mask:linear-gradient(160deg,transparent 45%,#000 100%);mask:linear-gradient(160deg,transparent 45%,#000 100%)}
.cvc-adv .av-head{display:flex;align-items:center;gap:${u(14)};margin-bottom:${u(12)}}
.cvc-adv .av-num{flex:none;background:var(--corgi);color:#fff;-webkit-text-stroke:${u(1.6)} var(--ink);paint-order:stroke fill;border:${u(4)} solid var(--ink);
  border-radius:${u(10)};padding:${u(4)} ${u(12)};font-size:${u(18)};letter-spacing:.08em;transform:rotate(-3deg);box-shadow:${u(3)} ${u(4)} 0 var(--ink)}
.cvc-adv .av-title{font-size:${u(46)};line-height:1;color:#fff;-webkit-text-stroke:${u(3.2)} var(--ink);paint-order:stroke fill;text-shadow:${u(4)} ${u(5)} 0 var(--ink);letter-spacing:.02em}
.cvc-adv .av-kit{margin-left:auto;display:flex;align-items:center;gap:${u(8)};font:800 ${u(11)} ${FONT_BODY};letter-spacing:.08em;text-align:right}
.cvc-adv .av-kit b{display:block;font:${u(18)} ${FONT_DISPLAY};letter-spacing:.04em}
.cvc-adv .av-kit .ic{width:${u(46)};height:${u(46)};border-radius:50%;background:var(--corgi);border:${u(3)} solid var(--ink);display:grid;place-items:center;color:var(--corgi2)}
.cvc-adv .av-kit .ic svg{width:74%;height:74%}
.cvc-adv .av-caps{display:flex;flex-direction:column;gap:${u(10)}}
.cvc-adv .av-cap{align-self:flex-start;max-width:92%;background:var(--cap);border:${u(3.5)} solid var(--ink);box-shadow:${u(4)} ${u(4)} 0 var(--ink);
  padding:${u(7)} ${u(14)};font:italic 800 ${u(21)}/1.25 ${FONT_BODY};letter-spacing:.01em;animation:cvc-av-pop .35s cubic-bezier(.3,1.8,.5,1) both}
.cvc-adv .av-cap:nth-child(2){margin-left:${u(46)};transform:rotate(.6deg)} .cvc-adv .av-cap:nth-child(3){margin-left:${u(92)};transform:rotate(-.5deg)}
.cvc-adv .av-foot{display:flex;justify-content:space-between;align-items:center;margin-top:${u(14)};font:800 ${u(12)} ${FONT_BODY};letter-spacing:.06em;opacity:.75}
.cvc-adv .av-skip{pointer-events:auto;cursor:pointer;font:${u(14)} ${FONT_DISPLAY};letter-spacing:.06em;background:transparent;border:none;color:var(--ink)}
/* bark bubbles */
.cvc-adv .av-barks{position:absolute;left:50%;top:70%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:${u(6)}}
.cvc-adv .av-bark{position:relative;background:#fff;border:${u(3)} solid var(--ink);border-radius:${u(16)};padding:${u(5)} ${u(14)};box-shadow:${u(3)} ${u(4)} 0 var(--ink);
  font:800 ${u(16)} ${FONT_BODY};white-space:nowrap;animation:cvc-av-pop .3s cubic-bezier(.3,1.8,.5,1) both}
.cvc-adv .av-bark::after{content:'';position:absolute;left:${u(26)};bottom:${u(-13)};border:${u(7)} solid transparent;border-top:${u(8)} solid var(--ink)}
.cvc-adv .av-bark.cat{background:#ffd9de;color:#6e0f1c;font-family:${FONT_DISPLAY};letter-spacing:.04em;transform:rotate(-2deg)}
.cvc-adv .av-bark.fade{opacity:0;transition:opacity .5s}
/* squad down */
.cvc-adv .av-down{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%) rotate(-4deg);text-align:center}
.cvc-adv .av-down b{display:block;font-size:${u(78)};color:#ffd9de;-webkit-text-stroke:${u(5)} var(--ink);paint-order:stroke fill;text-shadow:${u(6)} ${u(7)} 0 var(--ink);
  animation:cvc-av-pop .4s cubic-bezier(.3,1.8,.5,1) both}
.cvc-adv .av-down span{display:inline-block;margin-top:${u(8)};background:var(--ink);color:var(--paper);font:800 ${u(18)} ${FONT_BODY};padding:${u(4)} ${u(14)};border-radius:${u(6)}}
/* chapter-complete card */
.cvc-adv .av-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-.8deg);width:${u(560)};max-width:94vw;background:var(--paper);
  border:${u(5)} solid var(--ink);border-radius:${u(14)};box-shadow:${u(8)} ${u(10)} 0 var(--ink);padding:${u(16)} ${u(22)} ${u(18)};pointer-events:auto;
  animation:cvc-av-in .45s cubic-bezier(.3,1.6,.5,1)}
.cvc-adv .av-card h2{margin:0;font-size:${u(34)};color:var(--gold);-webkit-text-stroke:${u(2.6)} var(--ink);paint-order:stroke fill;text-shadow:${u(4)} ${u(4)} 0 var(--ink);letter-spacing:.03em}
.cvc-adv .av-card .sub{font:800 ${u(13)} ${FONT_BODY};letter-spacing:.08em;opacity:.7;margin-top:${u(2)}}
.cvc-adv .av-res{display:grid;grid-template-columns:${u(150)} 1fr;gap:${u(18)};align-items:center;margin:${u(14)} 0 ${u(10)}}
.cvc-adv .av-paw{width:${u(150)};height:${u(150)};transform:rotate(-8deg);animation:cvc-av-stamp .6s .25s cubic-bezier(.3,1.9,.45,1) both}
.cvc-adv .av-paw svg{width:100%;height:100%;filter:drop-shadow(${u(4)} ${u(5)} 0 rgba(26,18,12,.85))}
.cvc-adv .av-medal{font-size:${u(30)};letter-spacing:.04em}
.cvc-adv .av-best{display:inline-block;margin-left:${u(8)};font-size:${u(13)};background:var(--red);color:#fff;border:${u(2.5)} solid var(--ink);border-radius:${u(6)};padding:${u(1)} ${u(6)};transform:rotate(-4deg);vertical-align:middle}
.cvc-adv .av-stats{display:flex;gap:${u(12)};margin-top:${u(10)}}
.cvc-adv .av-stat{flex:1;background:#fffaf0;border:${u(3)} solid var(--ink);border-radius:${u(10)};padding:${u(6)} ${u(10)};box-shadow:${u(3)} ${u(3)} 0 var(--ink)}
.cvc-adv .av-stat i{display:block;font:800 ${u(11)} ${FONT_BODY};font-style:normal;letter-spacing:.1em;opacity:.65}
.cvc-adv .av-stat b{font-size:${u(28)};letter-spacing:.02em}
.cvc-adv .av-stat.beat b{color:#2f8a2f}
.cvc-adv .av-btns{display:flex;gap:${u(12)};margin-top:${u(14)}}
.cvc-adv .av-btn{flex:1;font:${u(19)} ${FONT_DISPLAY};letter-spacing:.05em;border:${u(3.5)} solid var(--ink);border-radius:${u(12)};padding:${u(9)} ${u(12)};
  background:#fffaf0;color:var(--ink);box-shadow:${u(4)} ${u(5)} 0 var(--ink);cursor:pointer}
.cvc-adv .av-btn.primary{flex:1.6;background:var(--gold)}
.cvc-adv .av-btn:hover,.cvc-adv .av-btn:focus-visible{transform:translateY(${u(-2)}) rotate(-1deg);outline:${u(3)} solid var(--corgi);outline-offset:${u(2)}}
.cvc-adv .av-btn:disabled{opacity:.55;cursor:default;transform:none}
.cvc-adv .av-keys{margin-top:${u(10)};text-align:center;font:800 ${u(11.5)} ${FONT_BODY};letter-spacing:.06em;opacity:.65}
@keyframes cvc-av-in{from{opacity:0;transform:translateX(-50%) translateY(${u(-30)}) rotate(-6deg) scale(.8)}}
@keyframes cvc-av-pop{from{opacity:0;transform:scale(.5)}}
@keyframes cvc-av-stamp{from{opacity:0;transform:rotate(-30deg) scale(2.4)}to{opacity:1;transform:rotate(-8deg) scale(1)}}
`;

let styleEl: HTMLStyleElement | null = null;

export function createAdventureHud(uiRoot: HTMLElement, opts: AdventureHudOptions = {}): AdventureHud {
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.textContent = CSS; document.head.appendChild(styleEl); }
  void ensureFonts();
  const keys = opts.keys ?? window;
  const el = document.createElement('div');
  el.className = 'cvc-adv';
  el.innerHTML = `<div class="av-panel hidden" role="dialog" aria-live="polite"></div><div class="av-barks"></div>
    <div class="av-down hidden" role="status"><b>${esc(S.squadDown)}</b><span></span></div><div class="av-card hidden" role="dialog"></div>`;
  uiRoot.appendChild(el);
  const panel = el.querySelector<HTMLDivElement>('.av-panel')!;
  const barksEl = el.querySelector<HTMLDivElement>('.av-barks')!;
  const down = el.querySelector<HTMLDivElement>('.av-down')!, downText = down.querySelector('span')!;
  const card = el.querySelector<HTMLDivElement>('.av-card')!;

  let view: AdventureView | null = null;
  let lastPhase = '';
  let lastChapter = '';
  let panelKind: '' | 'intro' | 'outro' = '';
  let panelT = 0, panelLines = -1; // panel time from frame dt (a stalled page doesn't skip captions)
  let skipped = false;
  let cardShown = false, cardKey = '';
  let saved = '';
  let newBest = false;
  const barkLines = new Set<string>();

  const openPanel = (kind: 'intro' | 'outro', def: ChapterDef) => {
    panelKind = kind; panelT = 0; panelLines = -1; skipped = false;
    const c = CLASSES[def.cls];
    panel.innerHTML = `<div class="av-head"><span class="av-num">${esc(S.chapter)} ${def.index}</span><span class="av-title">${esc(kind === 'outro' ? S.complete : def.title.toUpperCase())}</span>
      <span class="av-kit">${kind === 'intro' ? `<span>${esc(S.featured)}<b>${esc(c.displayName.toUpperCase())}</b></span><span class="ic">${classIcon(def.cls)}</span>` : ''}</span></div>
      <div class="av-caps"></div>
      <div class="av-foot"><span>${esc(def.district.toUpperCase())}${kind === 'intro' ? ` · ${esc(S.kitNote)}` : ''}</span><button class="av-skip" data-skip><kbd>E</kbd>${esc(S.skip)} ▸</button></div>`;
    panel.querySelector('[data-skip]')!.addEventListener('click', () => { opts.sound?.('click'); closePanel(); });
    panel.classList.remove('hidden');
  };
  const closePanel = () => { skipped = true; panelKind = ''; panel.classList.add('hidden'); };

  const renderCaptions = (lines: readonly string[]) => {
    const n = captionLinesShown(lines.length, panelT);
    if (n === panelLines) return;
    panelLines = n;
    panel.querySelector('.av-caps')!.innerHTML = lines.slice(0, n).map((l) => `<div class="av-cap">${esc(l)}</div>`).join('');
  };

  const nextOf = (def: ChapterDef) => chapterByIndex(def.index + 1);
  const renderCard = (v: AdventureView, match: MatchState | null) => {
    const def = v.chapter;
    const next = nextOf(def);
    const soon = !next && def.index < CHAPTER_PLAN.length;
    const left = Math.max(0, Math.ceil(match?.timeLeft ?? 0));
    const key = `${def.id}:${v.medal}:${v.time}:${newBest}:${opts.roomAdvances ? left : ''}`;
    if (key === cardKey) return;
    cardKey = key;
    const beat = v.time <= v.par;
    const medal = v.medal ?? 'bronze';
    const auto = opts.roomAdvances ? `<div class="av-keys">${esc(next || !soon ? S.nextIn(left) : S.replayIn(left))}</div>` : '';
    card.innerHTML = `<h2>${esc(S.complete)}</h2><div class="sub">${esc(S.chapter)} ${def.index} · ${esc(def.title.toUpperCase())}</div>
      <div class="av-res"><div class="av-paw">${pawSvg(medal)}</div><div>
        <div class="av-medal">${esc(S.medal[medal])}${newBest ? `<span class="av-best">${esc(S.newBest)}</span>` : ''}</div>
        <div class="av-stats"><div class="av-stat${beat ? ' beat' : ''}"><i>${esc(S.time)}</i><b>${fmtClock(v.time)}</b></div>
          <div class="av-stat"><i>${esc(S.par)}</i><b>${fmtClock(v.par, false)}</b></div></div></div></div>
      ${opts.roomAdvances ? auto : `<div class="av-btns"><button class="av-btn" data-replay>${esc(S.replay)}</button>
        <button class="av-btn primary" data-next ${next ? '' : 'disabled'}>${esc(next ? S.next : soon ? S.nextSoon : S.next)}</button></div>
        <div class="av-keys">${esc(S.keysHint)}</div>`}`;
    card.querySelector('[data-next]')?.addEventListener('click', () => doNext());
    card.querySelector('[data-replay]')?.addEventListener('click', () => doReplay());
  };
  const doNext = () => {
    if (!cardShown || !view || opts.roomAdvances) return;
    const next = nextOf(view.chapter);
    if (!next) return;
    opts.sound?.('click');
    opts.onNext?.(next.id);
  };
  const doReplay = () => {
    if (!cardShown || !view || opts.roomAdvances) return;
    opts.sound?.('click');
    opts.onReplay?.(view.chapter.id);
  };

  const onKey = (e: Event) => {
    const k = e as KeyboardEvent;
    if (k.repeat) return;
    const t = k.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (panelKind === 'intro' && (k.code === 'KeyE' || k.code === 'Enter')) closePanel();
    else if (panelKind === 'outro' && k.code === 'Enter') closePanel();
    else if (cardShown && k.code === 'Enter') doNext();
    else if (cardShown && k.code === 'Backspace') doReplay();
  };
  keys.addEventListener('keydown', onKey);

  const showBark = (line: string, cat: boolean) => {
    const b = document.createElement('div');
    b.className = `av-bark${cat ? ' cat' : ''}`;
    b.textContent = line;
    barksEl.appendChild(b);
    while (barksEl.children.length > 2) barksEl.firstElementChild!.remove();
    setTimeout(() => b.classList.add('fade'), 2600);
    setTimeout(() => b.remove(), 3200);
  };

  return {
    el,
    get view() { return view; },
    get showing() { return { intro: panelKind === 'intro', card: cardShown, down: !down.classList.contains('hidden'), barks: barksEl.children.length }; },
    update(states, match, localId, dt) {
      void localId;
      panelT += Math.min(0.25, Math.max(0, dt));
      view = readAdventure(states);
      syncAdventureChain(view);
      const v = view;
      if (!v) {
        if (lastPhase) { panel.classList.add('hidden'); card.classList.add('hidden'); down.classList.add('hidden'); panelKind = ''; cardShown = false; lastPhase = ''; }
        return;
      }
      const def = v.chapter;
      if (def.id !== lastChapter) {
        lastChapter = def.id; barkLines.clear();
        opts.onChapter?.(def);
        for (const s of def.steps) for (const l of s.barks ?? []) barkLines.add(l);
        barkLines.add(REGROUP_BARK);
      }
      const phase = v.phase;
      if (phase !== lastPhase) {
        if (phase === 'briefing') { card.classList.add('hidden'); cardShown = false; cardKey = ''; openPanel('intro', def); }
        // (a late page load may join near the end of the briefing: the intro finishes its captions anyway)
        if (phase === 'complete') openPanel('outro', def);
        if (phase !== 'complete') { card.classList.add('hidden'); cardShown = false; }
        lastPhase = phase;
      }
      if (panelKind === 'intro' && !skipped) {
        renderCaptions(def.intro);
        if (phase !== 'briefing' && panelT > outroSeconds(def.intro.length)) closePanel();
      }
      if (panelKind === 'outro' && !skipped) {
        renderCaptions(def.outro);
        if (panelT > outroSeconds(def.outro.length)) closePanel();
      }
      // squad down: the fail-forward beat
      down.classList.toggle('hidden', phase !== 'failed');
      if (phase === 'failed') downText.textContent = S.backToCheckpoint(Math.max(1, Math.ceil(match?.timeLeft ?? 1)));
      // chapter complete: save once, then the card (after the outro)
      if (phase === 'complete') {
        const key = `${def.id}:${v.time}`;
        if (saved !== key && v.medal) {
          saved = key;
          newBest = recordCompletion(def.id, def.index, v.medal, opts.storage).newBest;
        }
        if (panelKind !== 'outro') {
          if (!cardShown) { cardShown = true; card.classList.remove('hidden'); opts.sound?.('open'); }
          renderCard(v, match);
        }
      }
    },
    onGameEvent(ev) {
      if (ev.e !== 'bark' || !view) return;
      if (barkLines.has(ev.line)) showBark(ev.line, false);
      else if (ALARM_BARKS.includes(ev.line)) showBark(ev.line, true);
    },
    dispose() {
      keys.removeEventListener('keydown', onKey);
      syncAdventureChain(null);
      el.remove();
    },
  };
}
