// The RC plane's cockpit strip, bottom centre while you fly (R1 left the plane without a HUD). Everything comes from
// the plane's own snapshot:
//   hull = hp/maxHp · throttle = unpackPlaneAux(ammo) · airspeed = |v| · height = y − ground under it
//   flags: Sprinting = boosting · Reloading = boost recharging · Aiming = gun overheated · Crouching = stalled
//          Grounded = on its wheels
// planeReadout() is pure (unit-tested); the DOM part only writes what changed.
import type { EntityState } from '../../shared/protocol';
import { EFlag } from '../../shared/types';
import { planeByIndex, unpackPlaneAux } from '../../shared/content/vehicles';
import { PALETTE } from '../style/style-tokens.js';
import { FONT_BODY, FONT_DISPLAY, ensureFonts } from './fonts';

export type BoostState = 'ready' | 'on' | 'charging';

export interface PlaneReadout {
  /** Plane display name for the rider's team ("Fetch Flyer" / "Pounce Plane"). */
  name: string;
  /** 0..1 */
  hull: number;
  /** 0..1 */
  throttle: number;
  /** Airspeed, m/s (rounded). */
  speed: number;
  /** Height of the landing gear above the ground under it, m (rounded, ≥ 0). */
  alt: number;
  boost: BoostState;
  overheat: boolean;
  stall: boolean;
  grounded: boolean;
}

/** The cockpit numbers for a plane snapshot, or null when `s` is not a plane. `groundY` = terrain height under it. */
export function planeReadout(s: EntityState, groundY: number): PlaneReadout | null {
  const def = planeByIndex(s.cls);
  if (!def) return null;
  const f = s.flags;
  return {
    name: s.team === 1 ? def.catName : def.name,
    hull: s.maxHp > 0 ? Math.max(0, Math.min(1, s.hp / s.maxHp)) : 0,
    throttle: unpackPlaneAux(s.ammo).throttle,
    speed: Math.round(Math.hypot(s.vx, s.vy, s.vz)),
    alt: Math.max(0, Math.round(s.y - groundY)),
    boost: f & EFlag.Sprinting ? 'on' : f & EFlag.Reloading ? 'charging' : 'ready',
    overheat: (f & EFlag.Aiming) !== 0,
    stall: (f & EFlag.Crouching) !== 0,
    grounded: (f & EFlag.Grounded) !== 0,
  };
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const u = (n: number) => `calc(var(--u)*${n})`;

const CSS = `
.cvc-ph{position:absolute;left:50%;bottom:${u(22)};transform:translateX(-50%) rotate(-.6deg);pointer-events:none;user-select:none;z-index:5;
  --u:max(0.6px,min(calc(100vw / 1280),calc(100vh / 720)));--ink:${hex(PALETTE.ink)};--paper:#f6ecd8;--gold:#ffd04a;--red:#e8453c;
  --team:${hex(PALETTE.teamCorgis)};font-family:${FONT_DISPLAY};color:var(--ink);line-height:1.1;
  background:var(--paper);border:${u(3)} solid var(--ink);border-radius:${u(14)};box-shadow:${u(4)} ${u(5)} 0 var(--ink);
  padding:${u(7)} ${u(14)} ${u(8)};width:${u(400)};display:grid;grid-template-columns:auto 1fr;gap:${u(4)} ${u(10)};align-items:center}
.cvc-ph.t1{--team:${hex(PALETTE.teamCats)}}
.cvc-ph.hidden,.cvc-ph .hidden{display:none!important}
.cvc-ph h4{grid-column:1/-1;margin:0;display:flex;align-items:baseline;gap:${u(8)};font-size:${u(18)};letter-spacing:.04em}
.cvc-ph h4 b{background:var(--team);color:#fff;-webkit-text-stroke:${u(1.2)} var(--ink);paint-order:stroke fill;padding:0 ${u(8)};
  border:${u(2.5)} solid var(--ink);border-radius:${u(8)};font-weight:400}
.cvc-ph h4 span{margin-left:auto;font-size:${u(22)}} .cvc-ph h4 small{font:700 ${u(11)} ${FONT_BODY};opacity:.65;letter-spacing:.06em}
.cvc-ph label{font:800 ${u(11)} ${FONT_BODY};letter-spacing:.08em;opacity:.75}
.cvc-ph .bar{height:${u(11)};border:${u(2.5)} solid var(--ink);border-radius:${u(6)};background:#d9ceb8;overflow:hidden}
.cvc-ph .bar i{display:block;height:100%;width:0;background:var(--c,#6cc04a);transition:width .12s linear}
.cvc-ph .hull i{--c:#6cc04a} .cvc-ph .hull.low i{--c:var(--red)} .cvc-ph .thr i{--c:var(--gold)}
.cvc-ph .chips{grid-column:1/-1;display:flex;gap:${u(6)};margin-top:${u(3)};font-size:${u(13)};letter-spacing:.05em}
.cvc-ph .chips em{font-style:normal;white-space:nowrap;border:${u(2)} solid var(--ink);border-radius:${u(7)};padding:${u(1)} ${u(7)};background:#e8dfcb}
.cvc-ph .chips em.go{background:var(--gold)} .cvc-ph .chips em.warn{background:var(--red);color:#fff;-webkit-text-stroke:${u(.8)} var(--ink);paint-order:stroke fill}
.cvc-ph .chips em.blink{animation:cvc-ph-blink .5s steps(2) infinite}
.cvc-ph .keys{grid-column:1/-1;white-space:nowrap;font:700 ${u(10.5)} ${FONT_BODY};opacity:.6;letter-spacing:.05em;text-align:center}
@keyframes cvc-ph-blink{50%{opacity:.35}}
`;

let styleEl: HTMLStyleElement | null = null;

export interface PlaneHud {
  /** `plane` = the local rider's plane snapshot (null when not flying one), `groundY` = terrain height under it. */
  update(plane: EntityState | null, groundY: number): void;
  dispose(): void;
}

export function createPlaneHud(root: HTMLElement): PlaneHud {
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.textContent = CSS; document.head.appendChild(styleEl); }
  void ensureFonts();
  const el = document.createElement('div');
  el.className = 'cvc-ph hidden';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<h4><b class="nm"></b><small>RC PLANE</small><span class="spd"></span><small class="alt"></small></h4>
    <label>HULL</label><div class="bar hull"><i></i></div>
    <label>THROTTLE</label><div class="bar thr"><i></i></div>
    <div class="chips"><em class="bst"></em><em class="gun">GUN</em><em class="stl warn blink hidden">STALL!</em><em class="gnd hidden">ON THE GROUND</em></div>
    <div class="keys">MOUSE steer · W/S throttle · SHIFT boost · LMB gun · E bail out</div>`;
  root.appendChild(el);
  const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
  const nm = q('.nm'), spd = q('.spd'), alt = q('.alt');
  const hull = q('.hull'), hullI = q('.hull i'), thrI = q('.thr i');
  const bst = q('.bst'), gun = q('.gun'), stl = q('.stl'), gnd = q('.gnd');
  let shown = false;
  const last: Record<string, string> = {};
  /** Write a text/class only when it changed (no layout churn at 60 fps). */
  const set = (key: string, v: string, apply: (v: string) => void) => { if (last[key] !== v) { last[key] = v; apply(v); } };

  return {
    update(plane, groundY) {
      const r = plane ? planeReadout(plane, groundY) : null;
      if (!r) {
        if (shown) { el.classList.add('hidden'); shown = false; }
        return;
      }
      if (!shown) { el.classList.remove('hidden'); shown = true; }
      set('team', plane!.team === 1 ? 't1' : 't0', (v) => { el.classList.toggle('t1', v === 't1'); });
      set('nm', r.name.toUpperCase(), (v) => { nm.textContent = v; });
      set('spd', `${r.speed} m/s`, (v) => { spd.textContent = v; });
      set('alt', `${r.alt} M UP`, (v) => { alt.textContent = v; });
      set('hull', `${Math.round(r.hull * 100)}`, (v) => { hullI.style.width = `${v}%`; hull.classList.toggle('low', r.hull < 0.3); });
      set('thr', `${Math.round(r.throttle * 100)}`, (v) => { thrI.style.width = `${v}%`; });
      set('bst', r.boost, (v) => {
        bst.textContent = v === 'on' ? 'BOOST!' : v === 'charging' ? 'BOOST …' : 'BOOST READY';
        bst.className = `bst${v === 'charging' ? '' : ' go'}`;
      });
      set('gun', r.overheat ? 'hot' : 'ok', (v) => { gun.textContent = v === 'hot' ? 'GUN OVERHEATED' : 'GUN'; gun.className = `gun${v === 'hot' ? ' warn' : ''}`; });
      set('stl', r.stall ? '1' : '0', (v) => { stl.classList.toggle('hidden', v !== '1'); });
      set('gnd', r.grounded ? '1' : '0', (v) => { gnd.classList.toggle('hidden', v !== '1'); });
    },
    dispose() { el.remove(); },
  };
}
