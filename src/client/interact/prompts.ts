// OWNER: interaction lane (S1). DOM overlay for the interaction layer (comic style, sized in --u like L5's HUD):
//   createInteractPrompts(uiRoot, { send? }) -> { update(states, localId, dt), onGameEvent(ev, localId), openPicker(),
//                                                 closePicker(), readonly pickerOpen, readonly target, dispose() }
//   · contextual prompt  "E  change kit" / "E  vend a kart" / "E  hop in" / "E  grab the Squeaker" (computed from
//                        states + the local player's position; greyed while a kiosk is cooling)
//   · kit picker         pressing E at your team's Ordnance Kiosk opens six class cards (1–6 / click / pad A);
//                        the pick is sent as a normal `{t:'class'}` message — the authority swaps it in place
//   · buff chips         active Upgrade Cores with draining timers (from `pickup` events: buffs are not in snapshots)
//   · mission card       the objective chain: done / current (with hold progress + CONTESTED) / next steps
//   · kibble counter     Golden Kibble found this match
// Keys: listens to window keydown for E (open), 1–6 (pick), Escape (close). Nothing here decides an outcome.
import type { ClientMsg, EntityState, GameEvent } from '../../shared/protocol';
import { CLASS_IDS, EFlag, EntityKind, type ClassId } from '../../shared/types';
import { CLASSES } from '../../shared/content/classes';
import { abilityDef } from '../../shared/content/abilities';
import { PICKUPS, type CoreId } from '../../shared/content/pickups';
import { objectiveChainByIndex } from '../../shared/content/objectives';
import { PALETTE } from '../style/style-tokens.js';
import { classIcon } from '../ui/icons';
import { CLASS_BLURBS } from '../ui/strings';
import { FONT_BODY, FONT_DISPLAY, ensureFonts } from '../ui/fonts';
import { PadNav } from '../ui/menu';
import { BuffTracker, atOwnOrdnanceKiosk, beaconStep, findInteractTarget, type InteractTarget } from './targets';

export interface InteractPromptsOptions {
  /** Sends a client message to the authority (e.g. `(m) => net.transport.send(m)`). Without it the picker only closes. */
  send?(msg: ClientMsg): void;
  /** UI click sound (L5 audio.ui). */
  sound?(kind: 'click' | 'hover' | 'back' | 'open'): void;
  /** Seconds clock (tests). Default performance.now()/1000. */
  clock?(): number;
  /** Keyboard source (tests/labs). Default window. */
  keys?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

export interface InteractPrompts {
  readonly el: HTMLElement;
  update(states: ReadonlyMap<number, EntityState>, localId: number, dt: number): void;
  onGameEvent(ev: GameEvent, localId: number): void;
  openPicker(): void;
  closePicker(): void;
  readonly pickerOpen: boolean;
  /** What E would do right now (null = nothing in reach). */
  readonly target: InteractTarget | null;
  dispose(): void;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const u = (n: number) => `calc(var(--u)*${n})`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CSS = `
.cvc-ix{position:absolute;inset:0;pointer-events:none;overflow:hidden;user-select:none;-webkit-user-select:none;z-index:5;
  --u:max(0.6px,min(calc(100vw / 1280),calc(100vh / 720)));--ink:${hex(PALETTE.ink)};--paper:#f6ecd8;--gold:#ffd04a;--red:#e8453c;
  --corgi:${hex(PALETTE.teamCorgis)};--corgi2:${hex(PALETTE.teamCorgisTrim)};--cat:${hex(PALETTE.teamCats)};--cat2:${hex(PALETTE.teamCatsTrim)};
  font-family:${FONT_DISPLAY};color:var(--ink);font-size:${u(16)};line-height:1.1}
.cvc-ix .hidden{display:none!important}
.cvc-ix .t0{--team:var(--corgi);--team2:var(--corgi2)} .cvc-ix .t1{--team:var(--cat);--team2:var(--cat2)}
.cvc-ix kbd{display:inline-grid;place-items:center;min-width:${u(26)};height:${u(26)};font:${u(16)} ${FONT_DISPLAY};background:var(--gold);color:var(--ink);
  border:${u(2.5)} solid var(--ink);border-radius:${u(7)};box-shadow:0 ${u(3)} 0 var(--ink);padding:0 ${u(5)}}
/* prompt */
.cvc-ix .ix-pr{position:absolute;left:50%;top:61%;transform:translateX(-50%) rotate(-1deg);display:flex;align-items:center;gap:${u(10)};
  background:var(--paper);border:${u(3)} solid var(--ink);border-radius:${u(14)};padding:${u(5)} ${u(14)} ${u(6)} ${u(7)};
  box-shadow:${u(4)} ${u(5)} 0 var(--ink);font-size:${u(19)};letter-spacing:.03em;white-space:nowrap;transition:opacity .12s}
.cvc-ix .ix-pr.off{opacity:.6;filter:grayscale(.7)} .cvc-ix .ix-pr.off kbd{background:#c9c0ae}
.cvc-ix .ix-pr small{font:700 ${u(11)} ${FONT_BODY};opacity:.65;letter-spacing:.04em;text-transform:uppercase;margin-left:${u(2)}}
/* picker */
.cvc-ix .ix-pk{position:absolute;left:50%;top:47%;transform:translate(-50%,-50%) rotate(-.6deg);width:${u(760)};max-width:94vw;
  background:var(--paper);border:${u(4)} solid var(--ink);border-radius:${u(16)};box-shadow:${u(6)} ${u(8)} 0 var(--ink);padding:${u(12)} ${u(16)} ${u(12)};pointer-events:auto}
.cvc-ix .ix-pk::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(circle,rgba(26,18,12,.18) 27%,transparent 30%) 0 0/${u(7)} ${u(7)};-webkit-mask:linear-gradient(135deg,transparent 55%,#000 100%);mask:linear-gradient(135deg,transparent 55%,#000 100%)}
.cvc-ix .ix-pk h2{margin:0 0 ${u(8)};font-size:${u(26)};letter-spacing:.04em;display:flex;align-items:baseline;gap:${u(10)}}
.cvc-ix .ix-pk h2 span{background:var(--team);color:#fff;-webkit-text-stroke:${u(1.4)} var(--ink);paint-order:stroke fill;padding:${u(1)} ${u(10)};border:${u(3)} solid var(--ink);border-radius:${u(9)};transform:rotate(-2deg)}
.cvc-ix .ix-pk h2 small{font:700 ${u(12)} ${FONT_BODY};opacity:.65;letter-spacing:.06em;text-transform:uppercase}
.cvc-ix .ix-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:${u(10)}}
.cvc-ix .ix-cc{position:relative;text-align:left;font:inherit;color:var(--ink);background:#fffaf0;border:${u(3)} solid var(--ink);border-radius:${u(11)};
  padding:${u(8)} ${u(10)} ${u(9)};box-shadow:${u(3)} ${u(3)} 0 var(--ink);cursor:pointer;display:grid;grid-template-columns:${u(42)} 1fr;column-gap:${u(8)};row-gap:${u(1)};align-items:center;transition:transform .1s}
.cvc-ix .ix-cc:hover,.cvc-ix .ix-cc:focus-visible{transform:translateY(${u(-3)}) rotate(-1deg);background:#fff;outline:${u(3)} solid var(--gold);outline-offset:${u(2)}}
.cvc-ix .ix-cc.cur{background:var(--gold)}
.cvc-ix .ix-cc.cur::before{content:'EQUIPPED';position:absolute;right:${u(8)};top:${u(-11)};font:800 ${u(9.5)} ${FONT_BODY};letter-spacing:.08em;background:var(--ink);color:var(--gold);padding:${u(2)} ${u(6)};border-radius:${u(5)}}
.cvc-ix .ix-cc .ic{grid-row:span 2;width:${u(42)};height:${u(42)};border-radius:50%;background:var(--team);border:${u(2.5)} solid var(--ink);display:grid;place-items:center;color:var(--team2)}
.cvc-ix .ix-cc .ic svg{width:74%;height:74%}
.cvc-ix .ix-cc .nm{font-size:${u(18)};letter-spacing:.03em}
.cvc-ix .ix-cc .rl{font:800 ${u(10)} ${FONT_BODY};letter-spacing:.06em;text-transform:uppercase;opacity:.6}
.cvc-ix .ix-cc .st{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:${u(4)} ${u(5)};margin-top:${u(5)};font:700 ${u(10)} ${FONT_BODY}}
.cvc-ix .ix-cc .st b{background:rgba(26,18,12,.09);border-radius:${u(5)};padding:${u(1)} ${u(5)};white-space:nowrap}
.cvc-ix .ix-cc .bl{grid-column:1/-1;font:600 ${u(11)}/1.25 ${FONT_BODY};opacity:.8;margin-top:${u(4)};min-height:${u(28)}}
.cvc-ix .ix-cc kbd{position:absolute;right:${u(-9)};bottom:${u(-9)};transform:rotate(4deg)}
.cvc-ix .ix-ft{display:flex;justify-content:space-between;margin-top:${u(10)};font:700 ${u(11.5)} ${FONT_BODY};opacity:.75}
/* buffs */
.cvc-ix .ix-bf{position:absolute;left:${u(22)};bottom:${u(104)};display:flex;flex-direction:column-reverse;gap:${u(6)}}
.cvc-ix .ix-b{position:relative;display:flex;align-items:center;gap:${u(8)};background:var(--ink);color:var(--paper);border:${u(2.5)} solid var(--paper);border-radius:${u(12)};
  padding:${u(3)} ${u(12)} ${u(7)} ${u(4)};min-width:${u(170)};box-shadow:${u(3)} ${u(3)} 0 rgba(26,18,12,.6);animation:cvc-ix-pop .35s cubic-bezier(.3,1.8,.5,1)}
.cvc-ix .ix-b .gem{width:${u(24)};height:${u(24)};transform:rotate(45deg);border:${u(2.5)} solid var(--paper);border-radius:${u(4)};background:var(--c);box-shadow:0 0 ${u(10)} var(--c)}
.cvc-ix .ix-b .tx{display:flex;flex-direction:column}
.cvc-ix .ix-b .tx b{font-size:${u(15)};letter-spacing:.03em;color:var(--c)}
.cvc-ix .ix-b .tx i{font:700 ${u(10.5)} ${FONT_BODY};font-style:normal;opacity:.85}
.cvc-ix .ix-b .s{margin-left:auto;font-size:${u(16)}}
.cvc-ix .ix-b .bar{position:absolute;left:${u(8)};right:${u(8)};bottom:${u(3)};height:${u(3)};border-radius:${u(2)};background:rgba(246,236,216,.2);overflow:hidden}
.cvc-ix .ix-b .bar>div{height:100%;background:var(--c);transform-origin:left center}
/* mission card */
.cvc-ix .ix-ms{position:absolute;left:${u(14)};top:${u(150)};width:${u(250)};background:var(--paper);border:${u(3)} solid var(--ink);border-radius:${u(12)};
  box-shadow:${u(4)} ${u(5)} 0 var(--ink);padding:${u(6)} ${u(10)} ${u(8)};transform:rotate(-.8deg)}
.cvc-ix .ix-ms h3{margin:0 0 ${u(4)};font-size:${u(14)};letter-spacing:.08em;display:flex;justify-content:space-between;align-items:center}
.cvc-ix .ix-ms h3 span{font:800 ${u(10)} ${FONT_BODY};background:var(--ink);color:var(--gold);border-radius:${u(5)};padding:${u(1)} ${u(6)}}
.cvc-ix .ix-st{display:flex;gap:${u(7)};align-items:flex-start;font:700 ${u(12)}/1.25 ${FONT_BODY};padding:${u(2)} 0;opacity:.55}
.cvc-ix .ix-st i{flex:none;width:${u(16)};height:${u(16)};border:${u(2)} solid var(--ink);border-radius:50%;display:grid;place-items:center;font:${u(10)} ${FONT_DISPLAY};font-style:normal;margin-top:${u(1)}}
.cvc-ix .ix-st.done{opacity:.8;text-decoration:line-through} .cvc-ix .ix-st.done i{background:#8fd14a}
.cvc-ix .ix-st.cur{opacity:1;font-size:${u(13.5)}} .cvc-ix .ix-st.cur i{background:var(--gold);animation:cvc-ix-pulse 1s infinite}
.cvc-ix .ix-pg{height:${u(8)};margin:${u(3)} 0 ${u(1)} ${u(23)};border:${u(2)} solid var(--ink);border-radius:${u(5)};background:#fff;overflow:hidden}
.cvc-ix .ix-pg>div{height:100%;background:var(--gold);transform-origin:left center}
.cvc-ix .ix-pg.hot{border-color:var(--red)} .cvc-ix .ix-pg.hot>div{background:var(--red)}
.cvc-ix .ix-ct{margin-left:${u(23)};font:${u(12)} ${FONT_DISPLAY};color:var(--red);letter-spacing:.06em;animation:cvc-ix-pulse .5s infinite}
.cvc-ix .ix-kb{display:flex;align-items:center;gap:${u(6)};margin-top:${u(6)};padding-top:${u(5)};border-top:${u(2)} dashed rgba(26,18,12,.3);font:700 ${u(12)} ${FONT_BODY}}
.cvc-ix .ix-kb svg{width:${u(20)};height:${u(20)}}
.cvc-ix .ix-kb b{font:${u(15)} ${FONT_DISPLAY};margin-left:auto}
.cvc-ix .ix-kb.flash b{animation:cvc-ix-pop .4s cubic-bezier(.3,1.8,.5,1)}
/* kit flash */
.cvc-ix .ix-fl{position:absolute;left:50%;top:36%;transform:translate(-50%,-50%) rotate(-3deg);font-size:${u(40)};color:#fff;-webkit-text-stroke:${u(3)} var(--ink);
  paint-order:stroke fill;text-shadow:${u(4)} ${u(5)} 0 var(--ink);white-space:nowrap;animation:cvc-ix-kit 1.4s forwards}
@keyframes cvc-ix-pop{from{transform:scale(.4)}to{transform:scale(1)}}
@keyframes cvc-ix-pulse{50%{opacity:.45}}
@keyframes cvc-ix-kit{0%{opacity:0;transform:translate(-50%,-50%) rotate(-3deg) scale(.4)}12%{opacity:1;transform:translate(-50%,-50%) rotate(-3deg) scale(1.12)}
  22%{transform:translate(-50%,-50%) rotate(-3deg) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-62%) rotate(-3deg) scale(1)}}
`;

const KIBBLE_SVG = `<svg viewBox="0 0 24 24"><g stroke="${hex(PALETTE.ink)}" stroke-width="2"><circle cx="12" cy="7.5" r="5" fill="#ffd04a"/><circle cx="7" cy="15" r="5" fill="#ffd04a"/><circle cx="17" cy="15" r="5" fill="#ffd04a"/></g><circle cx="12" cy="12.5" r="2.2" fill="${hex(PALETTE.accent)}"/></svg>`;

let styleEl: HTMLStyleElement | null = null;

export function createInteractPrompts(uiRoot: HTMLElement, opts: InteractPromptsOptions = {}): InteractPrompts {
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.textContent = CSS; document.head.appendChild(styleEl); }
  void ensureFonts();
  const clock = opts.clock ?? (() => performance.now() / 1000);
  const keys = opts.keys ?? window;
  const el = document.createElement('div');
  el.className = 'cvc-ix';
  el.innerHTML = `
    <div class="ix-pr hidden"><kbd>E</kbd><span class="v"></span><small></small></div>
    <div class="ix-ms hidden"><h3><b class="ttl">MISSION</b><span class="n"></span></h3><div class="steps"></div>
      <div class="ix-kb">${KIBBLE_SVG}<span>Golden Kibble</span><b>×0</b></div></div>
    <div class="ix-bf"></div>
    <div class="ix-pk hidden" role="dialog" aria-label="Ordnance Kiosk"><h2><span>ORDNANCE KIOSK</span>Pick a kit <small>swaps right here · keeps your health</small></h2>
      <div class="ix-grid">${CLASS_IDS.map((c, i) => {
        const d = CLASSES[c];
        const ab = abilityDef(d.ability);
        return `<button class="ix-cc" data-nav data-cls="${c}"><span class="ic">${classIcon(c)}</span><span class="nm">${esc(d.displayName)}</span><span class="rl">${esc(d.role)}</span>
          <span class="st"><b>${d.maxHp} HP</b><b>${esc(d.primary.replace(/_/g, ' '))}</b><b>${esc((ab?.id ?? d.ability).replace(/_/g, ' '))}</b></span>
          <span class="bl">${esc(CLASS_BLURBS[c])}</span><kbd>${i + 1}</kbd></button>`;
      }).join('')}</div>
      <div class="ix-ft"><span>1–6 or click · pad: D-pad + A</span><span><kbd>E</kbd> / <kbd>Esc</kbd> close</span></div></div>
    <div class="flashes"></div>`;
  uiRoot.appendChild(el);

  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const prompt = q<HTMLDivElement>('.ix-pr'), promptVerb = prompt.querySelector('.v')!, promptNote = prompt.querySelector('small')!;
  const picker = q<HTMLDivElement>('.ix-pk'), cards = [...picker.querySelectorAll<HTMLButtonElement>('.ix-cc')];
  const mission = q<HTMLDivElement>('.ix-ms'), missionSteps = mission.querySelector('.steps')!, missionN = mission.querySelector('.n')!, missionTtl = mission.querySelector('.ttl')!;
  const kib = mission.querySelector<HTMLDivElement>('.ix-kb')!, kibN = kib.querySelector('b')!;
  const buffsEl = q<HTMLDivElement>('.ix-bf'), flashes = q<HTMLDivElement>('.flashes');
  const tracker = new BuffTracker();
  const pad = new PadNav();
  let open = false;
  let target: InteractTarget | null = null;
  let local: EntityState | null = null;
  let lastStates: ReadonlyMap<number, EntityState> = new Map();
  let localId = -1;
  let lastCls = -1, lastEnt = -1;
  let missionKey = '';
  const buffEls = new Map<CoreId, HTMLDivElement>();
  let kibShown = -1;

  const flash = (text: string) => {
    const f = document.createElement('div');
    f.className = 'ix-fl';
    f.textContent = text;
    flashes.appendChild(f);
    setTimeout(() => f.remove(), 1500);
  };

  const choose = (cls: ClassId) => {
    if (!open) return;
    opts.sound?.('click');
    opts.send?.({ t: 'class', cls });
    closePicker();
  };
  for (const b of cards) {
    b.addEventListener('click', () => choose(b.dataset.cls as ClassId));
    b.addEventListener('mouseenter', () => opts.sound?.('hover'));
  }

  function openPicker(): void {
    if (open) return;
    open = true;
    picker.classList.remove('hidden');
    picker.classList.toggle('t1', local?.team === 1);
    picker.classList.toggle('t0', local?.team !== 1);
    for (const c of cards) c.classList.toggle('cur', local ? CLASS_IDS[local.cls] === c.dataset.cls : false);
    opts.sound?.('open');
  }
  function closePicker(): void {
    if (!open) return;
    open = false;
    picker.classList.add('hidden');
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  const onKey = (e: Event) => {
    const k = e as KeyboardEvent;
    if (k.repeat) return;
    const t = k.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (k.code === 'KeyE') {
      if (open) closePicker();
      else if (target?.kind === 'ordnance') openPicker();
    } else if (open && k.code === 'Escape') closePicker();
    else if (open && /^Digit[1-6]$/.test(k.code)) choose(CLASS_IDS[Number(k.code.slice(5)) - 1]);
  };
  keys.addEventListener('keydown', onKey);

  const renderMission = (states: ReadonlyMap<number, EntityState>) => {
    let beacon: EntityState | null = null;
    for (const s of states.values()) if (s.kind === EntityKind.Prop && objectiveChainByIndex(s.cls)) { beacon = s; break; }
    const chain = beacon ? objectiveChainByIndex(beacon.cls) : null;
    const b = beacon ? beaconStep(beacon) : null;
    const done = !!beacon && !!chain && beacon.weapon >= chain.steps.length;
    if (!beacon || !chain || (!b && !done) || (local && chain.team !== local.team)) { mission.classList.add('hidden'); return; }
    mission.classList.remove('hidden');
    const cur = done ? chain.steps.length : b!.index;
    const contested = (beacon.flags & EFlag.Busy) !== 0;
    const step = !done ? chain.steps[cur] : null;
    const hold = step?.trigger.type === 'hold' ? step.trigger.params : null;
    const key = `${chain.id}:${cur}:${hold ? `${beacon.ammo}:${contested}` : ''}`;
    if (key === missionKey) return;
    missionKey = key;
    missionTtl.textContent = done ? 'MISSION COMPLETE!' : 'SQUEAKER MISSION';
    missionN.textContent = done ? `+${chain.steps.reduce((a, s) => a + s.reward.score, 0)}` : `${cur + 1}/${chain.steps.length}`;
    missionSteps.innerHTML = chain.steps.map((s, i) => {
      const cls = i < cur ? 'done' : i === cur ? 'cur' : '';
      let extra = '';
      if (i === cur && hold) {
        const secs = Math.floor((beacon!.ammo / 100) * hold.seconds);
        extra = `<div class="ix-pg${contested ? ' hot' : ''}"><div style="transform:scaleX(${beacon!.ammo / 100})"></div></div>`
          + (contested ? '<div class="ix-ct">CONTESTED! CLEAR THE CATS</div>' : `<div class="ix-ct" style="color:inherit;animation:none;opacity:.7">${secs}/${hold.seconds} s</div>`);
      }
      return `<div class="ix-st ${cls}"><i>${i < cur ? '✓' : i + 1}</i><span>${esc(s.text)}</span></div>${extra}`;
    }).join('') + (done ? `<div class="ix-st done" style="text-decoration:none"><i>★</i><span>${esc(chain.doneText)}</span></div>` : '');
  };

  const renderBuffs = (now: number) => {
    const list = localId >= 0 ? tracker.active(localId, now) : [];
    const want = new Set(list.map((b) => b.id));
    for (const [id, d] of buffEls) if (!want.has(id)) { d.remove(); buffEls.delete(id); }
    for (const b of list) {
      let d = buffEls.get(b.id);
      const def = PICKUPS[b.id];
      if (!d) {
        d = document.createElement('div');
        d.className = 'ix-b';
        d.style.setProperty('--c', hex(PALETTE[def.color] as number));
        d.innerHTML = `<span class="gem"></span><span class="tx"><b>${esc(def.name.toUpperCase())}</b><i>${esc(def.blurb)}</i></span><span class="s"></span><span class="bar"><div></div></span>`;
        buffsEl.appendChild(d);
        buffEls.set(b.id, d);
      }
      const left = Math.max(0, b.until - now);
      d.querySelector<HTMLElement>('.s')!.textContent = `${Math.ceil(left)}s`;
      d.querySelector<HTMLElement>('.bar>div')!.style.transform = `scaleX(${left / b.duration})`;
    }
  };

  return {
    el,
    get pickerOpen() { return open; },
    get target() { return target; },
    openPicker,
    closePicker,
    update(states, id, dt) {
      void dt;
      lastStates = states;
      localId = id;
      local = states.get(id) ?? null;
      const now = clock();
      tracker.prune(states);
      if (local) tracker.syncFlags(local.id, local.flags, now);
      target = findInteractTarget(states, local);
      // Prompt (hidden while the picker is up).
      if (target && !open) {
        prompt.classList.remove('hidden');
        prompt.classList.toggle('off', !target.ready);
        promptVerb.textContent = target.verb;
        promptNote.textContent = target.kind === 'ordnance' ? '1–6 after' : '';
      } else prompt.classList.add('hidden');
      // The picker closes when you walk away, die or get seated.
      if (open && (!local || (local.flags & (EFlag.Dead | EFlag.Mounted)) || !atOwnOrdnanceKiosk(states, local))) closePicker();
      if (open) pad.poll(now, picker, closePicker);
      // In-place kit swap confirmation: same entity, new class.
      if (local) {
        if (local.id === lastEnt && lastCls >= 0 && local.cls !== lastCls) {
          const c = CLASS_IDS[local.cls];
          if (c) flash(`KIT: ${CLASSES[c].displayName.toUpperCase()}!`);
        }
        lastEnt = local.id; lastCls = local.cls;
      }
      renderMission(states);
      renderBuffs(now);
      if (tracker.kibble !== kibShown) {
        kibShown = tracker.kibble;
        kibN.textContent = `×${kibShown}`;
        kib.classList.remove('flash'); void kib.offsetWidth; kib.classList.add('flash');
      }
    },
    onGameEvent(ev, id) {
      tracker.onEvent(ev, clock(), id);
      void lastStates;
    },
    dispose() {
      keys.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}
