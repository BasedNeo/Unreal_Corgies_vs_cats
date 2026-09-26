// W9 X4 (arms-2): the throwable HUD slot, bottom right above the ammo panel, in the HUD's comic ink style. It shows the
// faction's throwable (squeaker grenade / hairball bomb) with its key (G): lit while you carry one (EFlag.Ordnance);
// after a throw a ring fills and counts down the kiosk restock (ORDNANCE_RULES.restockCooldown from the throw, the same
// rule the authority applies), then says KIOSK until your own Ordnance Kiosk refills you. Dimmed while dead; hidden in
// modes without throwables (never carried this session).
//   const ordHud = createOrdnanceHud(document.getElementById('cvc-hud') ?? ui);
//   ordHud.update(states.get(localId) ?? null, performance.now() / 1000);   // each frame
// OrdnanceHudModel is pure (tests/unit/ordnance-client.test.ts); the view only touches the DOM when something changed.
import type { EntityState } from '../../shared/protocol';
import { EFlag, Species } from '../../shared/types';
import { ORDNANCE_RULES } from '../../shared/content/ordnance';

export interface OrdnanceHudState {
  /** Show the slot at all (this session has had a throwable). */
  shown: boolean;
  carrying: boolean;
  dead: boolean;
  /** 0 = squeaker grenade, 1 = hairball bomb. */
  kind: 0 | 1;
  team: number;
  /** Seconds until the kiosk can restock you (0 when it can, or when you carry one). */
  restockLeft: number;
  /** Not carrying, restock time passed: go to your kiosk. */
  ready: boolean;
}

export class OrdnanceHudModel {
  readonly state: OrdnanceHudState = { shown: false, carrying: false, dead: false, kind: 0, team: 0, restockLeft: 0, ready: false };
  private had = false;
  private thrownAt = -Infinity;

  /** `now` in seconds (any monotonic clock). */
  update(local: EntityState | null, now: number): OrdnanceHudState {
    const s = this.state;
    if (!local) { s.carrying = false; s.dead = false; s.ready = false; s.restockLeft = 0; return s; }
    const dead = (local.flags & EFlag.Dead) !== 0;
    const carrying = !dead && (local.flags & EFlag.Ordnance) !== 0;
    // a carried one gone while alive = thrown: the kiosk's restock clock starts now (a death is not a throw)
    if (this.had && !carrying && !dead && !s.dead) this.thrownAt = now;
    if (carrying) { s.shown = true; this.thrownAt = -Infinity; }
    this.had = carrying;
    s.carrying = carrying; s.dead = dead;
    s.kind = local.species === Species.Cat ? 1 : 0;
    s.team = local.team;
    s.restockLeft = carrying || dead ? 0 : Math.max(0, ORDNANCE_RULES.restockCooldown - (now - this.thrownAt));
    s.ready = !carrying && !dead && s.restockLeft <= 0;
    return s;
  }
}

const INK = '#1a120c';
/** Squeaker grenade: ribbed ochre rubber, gunmetal cap, a pin ring, a strip of (team) tape. */
export const SQUEAKER_ICON = `<svg class="ico" viewBox="0 0 32 32" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><ellipse cx="15" cy="19" rx="9.5" ry="10" fill="#c8952a"/><path d="M6.5 15.5c5.5 1.6 11.5 1.6 17 0M6 21c6 1.6 12 1.6 18 0" stroke="#8f6a2c" stroke-width="1.8"/><path d="M5.8 18.2c6 2.2 12.4 2.2 18.4 0" stroke="currentColor" stroke-width="3.2"/><rect x="11" y="5.5" width="8" height="5" rx="1.2" fill="#3a3e44"/><circle cx="23.5" cy="6.5" r="3" stroke-width="1.8"/><path d="M19 8l2.6-.8"/></svg>`;
/** Hairball bomb: a lumpy grey fur ball, two crossed strips of (team) tape, a wick with a spark. */
export const HAIRBALL_ICON = `<svg class="ico" viewBox="0 0 32 32" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><path fill="#7d8591" d="M16 8.5c2.4-1.2 4.6.2 5.6 1.6 2.6-.2 4.6 2 4.4 4.6 1.8 1.6 1.8 4.6 0 6.2.2 2.8-2.2 5-5 4.6-1.6 1.8-4.6 2-6.4.6-2.8.4-5.2-1.8-5-4.6-2-1.4-2.4-4.4-.6-6.2-.4-2.8 1.8-5.2 4.6-5 .6-.8 1.6-1.6 2.4-1.8z"/><path d="M8.6 12.4l15.6 12M22.8 11.2L9.4 24.6" stroke="currentColor" stroke-width="3"/><path d="M21.6 8.4l2.2-4" stroke-width="1.6"/><path d="M25.2 2.2l1.4-1M26.4 4.2l1.6.2M23.6 1.4l-.2-1" stroke="#ff9b3d" stroke-width="1.6"/></svg>`;

const CSS = `
#cvc-hud .ord{position:absolute;right:calc(var(--u)*28);bottom:calc(var(--u)*128);width:calc(var(--u)*54);height:calc(var(--u)*54);pointer-events:none}
#cvc-hud .ord-core{position:absolute;inset:calc(var(--u)*5);border-radius:50%;background:var(--paper);border:calc(var(--u)*3) solid var(--ink);display:grid;place-items:center;color:var(--team,var(--corgi));box-shadow:calc(var(--u)*3) calc(var(--u)*4) 0 var(--ink)}
#cvc-hud .ord-core .ico{width:74%;height:74%}
#cvc-hud .ord-ring{position:absolute;inset:0;transform:rotate(-90deg)}
#cvc-hud .ord-ring circle{fill:none;stroke-width:5}
#cvc-hud .ord-ring .bg{stroke:var(--ink)} #cvc-hud .ord-ring .fg{stroke:var(--gold);stroke-linecap:round}
#cvc-hud .ord-key{position:absolute;left:calc(var(--u)*-8);bottom:calc(var(--u)*-4);background:var(--gold);color:var(--ink);border:calc(var(--u)*2.5) solid var(--ink);border-radius:calc(var(--u)*6);font-size:calc(var(--u)*13);padding:0 calc(var(--u)*5);line-height:1.35}
#cvc-hud .ord-cd{position:absolute;inset:0;display:grid;place-items:center;font-size:calc(var(--u)*19);color:#fff;-webkit-text-stroke:calc(var(--u)*2) var(--ink);paint-order:stroke fill}
#cvc-hud .ord-lbl{position:absolute;left:50%;top:calc(var(--u)*-17);transform:translateX(-50%);font-size:calc(var(--u)*11);letter-spacing:.1em;color:var(--gold);-webkit-text-stroke:calc(var(--u)*1.2) var(--ink);paint-order:stroke fill;white-space:nowrap}
#cvc-hud .ord.empty .ord-core{filter:grayscale(.9) brightness(.7)}
#cvc-hud .ord.ready .ord-core{animation:cvc-ord-ready 1.2s infinite}
#cvc-hud .ord.dead{opacity:.45}
#cvc-hud .ord.gone{display:none}
@keyframes cvc-ord-ready{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
`;

export interface OrdnanceHud {
  readonly el: HTMLElement;
  readonly model: OrdnanceHudModel;
  update(local: EntityState | null, now: number): void;
  dispose(): void;
}

const R = 24, CIRC = 2 * Math.PI * R;

export function createOrdnanceHud(parent: HTMLElement): OrdnanceHud {
  const doc = parent.ownerDocument ?? document;
  if (!doc.getElementById('cvc-ord-css')) {
    const st = doc.createElement('style');
    st.id = 'cvc-ord-css';
    st.textContent = CSS;
    doc.head.appendChild(st);
  }
  const el = doc.createElement('div');
  el.className = 'ord gone';
  el.innerHTML = `<svg class="ord-ring" viewBox="0 0 54 54"><circle class="bg" cx="27" cy="27" r="${R}"/><circle class="fg" cx="27" cy="27" r="${R}" stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="0"/></svg><div class="ord-core"></div><div class="ord-cd"></div><div class="ord-key">G</div><div class="ord-lbl"></div>`;
  parent.appendChild(el);
  const core = el.querySelector('.ord-core') as HTMLElement;
  const fg = el.querySelector('.ord-ring .fg') as SVGCircleElement;
  const cd = el.querySelector('.ord-cd') as HTMLElement;
  const lbl = el.querySelector('.ord-lbl') as HTMLElement;
  const model = new OrdnanceHudModel();
  let lastCls = '', lastKind = -1, lastCd = '', lastLbl = '', lastDash = '';
  return {
    el,
    model,
    update(local, now) {
      const s = model.update(local, now);
      const cls = `ord t${s.team === 1 ? 1 : 0}${s.shown ? '' : ' gone'}${s.carrying ? '' : ' empty'}${s.ready ? ' ready' : ''}${s.dead ? ' dead' : ''}`;
      if (cls !== lastCls) { el.className = cls; lastCls = cls; }
      if (s.kind !== lastKind) { core.innerHTML = s.kind === 1 ? HAIRBALL_ICON : SQUEAKER_ICON; lastKind = s.kind; }
      const frac = s.carrying ? 1 : s.dead ? 0 : 1 - s.restockLeft / ORDNANCE_RULES.restockCooldown;
      const dash = (CIRC * (1 - frac)).toFixed(1);
      if (dash !== lastDash) { fg.setAttribute('stroke-dashoffset', dash); lastDash = dash; }
      const t = !s.carrying && !s.dead && s.restockLeft > 0 ? String(Math.ceil(s.restockLeft)) : '';
      if (t !== lastCd) { cd.textContent = t; lastCd = t; }
      const l = s.ready ? 'KIOSK' : '';
      if (l !== lastLbl) { lbl.textContent = l; lastLbl = l; }
    },
    dispose() { el.remove(); },
  };
}
