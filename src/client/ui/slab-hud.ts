// slab HUD, DOM (W13 TW-VIEW): the web twin of engines/godot/game/hud.gd for the slab match on The Lot (Godot is the
// main build: when the two disagree, Godot wins). Idle and hidden unless MatchState.mode is 'slab'. It reads like
// hud.gd: plain light sans-serif text in the team colours over a soft shadow, thin bars, no panels.
//   top       "CORGI COMPANY  12" and "7  CAT CADRE" with bars racing to the win score (60), the clock between them
//             (m:ss, red in the last 30 s; OVERTIME in overtime: MatchState.objective 'OVERTIME', timeLeft then counts
//             the overtime down)
//   slab line SLAB NEUTRAL · SLAB <TEAM> HOLDING +1/s · SLAB CONTESTED, in the slab's read-out colour
//   marker    a diamond + SLAB over the slab, clamped to the screen edges (hud.gd's slab direction marker)
//   you       hit points (number + bar, red at 40 or less) bottom left, "30 / 30" or RELOADING bottom right,
//             "TAKEN DOWN · back in 2.4" while down, the controls hint for the first 14 s
//   winner    <TEAM> WINS or DRAW, the score, your takedowns / knockouts, "R / Enter: rematch" (the authority restarts
//             when a human sends the reload bit while the match is ended; main.ts maps Enter to it then)
// While active it takes over from the general HUD (a class on the HUD parent hides its comic match bar, health and
// ability panel, ammo panel, knocked-out screen and, once the match is over, its banner burst and click-to-play
// overlay (hud.gd shows "Click to play" only while the match runs; R / Enter work without the pointer); main.ts holds the
// first-match tips and the end-of-match scoreboard). The general HUD's kill feed and click-to-play overlay take hud.gd's
// plain look from the CSS here (hud.ts writes the feed as slabFeedText lines and the title as SLAB_CLICK_TO_PLAY in
// slab mode). The crosshair, hit markers, damage arcs, chat and the Tab scoreboard stay the general HUD's.
// The model (slabClock, slabStateText, slabWinner, ...) is pure and tested headless (tests/unit/slab-view.test.ts).
import { Vector3, type Camera } from 'three/webgpu';
import type { EntityState, MatchState, RosterEntry } from '../../shared/protocol';
import { EFlag } from '../../shared/types';
import { SLAB, SLAB_TEXT } from '../../shared/content/modes';
import { WEAPONS } from '../../shared/content/weapons';
import { PALETTE } from '../style/style-tokens.js';
import { FONT_BODY } from './fonts';
import { lighten, type SlabReading } from '../modes/slab-view';

/** tuning.gd TEAM_NAMES: the slab match names the teams as the Godot game does (SLAB_TEXT.win says "<name> WINS"). */
export const SLAB_TEAM_NAMES = ['CORGI COMPANY', 'CAT CADRE'] as const;
/** The rematch prompt on the winner screen. */
export const SLAB_REMATCH = 'R / Enter: rematch';
const TEAM = [PALETTE.teamCorgis, PALETTE.teamCats] as const;

/** m:ss of whole seconds, rounded up (hud.gd: int(ceil(time_left))). */
export function slabClockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The match runs in overtime (the slab authority's objective reads SLAB_TEXT.overtime). */
export function slabOvertime(ms: Pick<MatchState, 'objective' | 'phase'>): boolean {
  return ms.phase === 'live' && ms.objective.trimStart().startsWith(SLAB_TEXT.overtime);
}

export type ClockTone = '' | 'warm' | 'low' | 'ot';
/**
 * The clock in the middle of the top bar (hud.gd): m:ss of regulation (red in the last 30 s), OVERTIME in overtime.
 * Ended, the authority freezes timeLeft and the objective turns into the result, so `endedInOvertime` (the last live
 * frame was overtime) keeps OVERTIME up the way Godot's flag does.
 */
export function slabClock(ms: Pick<MatchState, 'objective' | 'phase' | 'timeLeft'>, endedInOvertime = false): { text: string; tone: ClockTone } {
  if (ms.phase === 'warmup') return { text: `WARMUP ${slabClockText(ms.timeLeft)}`, tone: 'warm' };
  if (slabOvertime(ms) || (ms.phase === 'ended' && endedInOvertime)) return { text: 'OVERTIME', tone: 'ot' };
  return { text: slabClockText(ms.timeLeft), tone: ms.phase === 'live' && ms.timeLeft <= 30 ? 'low' : '' };
}

/** The slab line, word for word as hud.gd (double spaces included): contested beats a holder; nobody = neutral. */
export function slabStateText(r: Pick<SlabReading, 'holder' | 'contested'> | null): string {
  if (r?.contested) return 'SLAB  CONTESTED';
  if (r && r.holder !== -1) return `SLAB  ${SLAB_TEAM_NAMES[r.holder]} HOLDING  +1/s`;
  return 'SLAB  NEUTRAL';
}

/** hud.gd slab_color(): the slab line's and the marker's colour. */
export function slabHudColor(r: Pick<SlabReading, 'holder' | 'contested'> | null): number {
  if (r?.contested) return 0xffa633; // Color(1.0, 0.65, 0.2)
  if (r && r.holder !== -1) return lighten(TEAM[r.holder], 0.35);
  return 0xe6ebf2; // Color(0.9, 0.92, 0.95)
}

export interface SlabWinner {
  /** "<TEAM> WINS" or "DRAW". */
  title: string;
  team: 0 | 1 | -1;
  /** "12  –  7" (corgis first, as hud.gd). */
  score: string;
  /** "You: 3 takedowns · 2 knockouts" (empty when the local player isn't on the roster). */
  you: string;
  prompt: string;
}

/** The winner screen of an ended slab match, or null while it runs. */
export function slabWinner(ms: Pick<MatchState, 'phase' | 'winner' | 'score'>, me: Pick<RosterEntry, 'kills' | 'deaths'> | null = null): SlabWinner | null {
  if (ms.phase !== 'ended') return null;
  const team = ms.winner === 0 || ms.winner === 1 ? ms.winner : -1;
  return {
    title: team === -1 ? SLAB_TEXT.draw : SLAB_TEXT.win[team],
    team,
    score: `${ms.score[0]}  –  ${ms.score[1]}`,
    you: me ? `You: ${me.kills} takedowns · ${me.deaths} knockouts` : '',
    prompt: SLAB_REMATCH,
  };
}

/** Score bar fill toward the win score, 0..1. */
export const slabFrac = (score: number, winScore: number): number => Math.max(0, Math.min(1, winScore > 0 ? score / winScore : 0));

/** hud.gd's clock colours: overtime amber, the last 30 s red, else white. */
export const SLAB_CLOCK_COLOR: Record<ClockTone, number> = { '': 0xffffff, warm: 0xffffff, low: 0xff7366, ot: 0xff9933 };

/** hud.gd's hit-point bar: green above 40, red at 40 or less. */
export const slabHpColor = (hp: number): number => (hp > 40 ? 0x8ce673 : 0xff664d);

/** hud.gd's ammo line: RELOADING while reloading, else "ammo / magazine". */
export function slabAmmoText(local: Pick<EntityState, 'ammo' | 'flags'>, mag: number = WEAPONS[SLAB.weapon].magSize): string {
  return (local.flags & EFlag.Reloading) !== 0 ? 'RELOADING' : `${Math.max(0, local.ammo)} / ${mag}`;
}

/** hud.gd's down line: "TAKEN DOWN  ·  back in 2.4" (one decimal, never below 0). */
export const slabDownText = (secondsLeft: number): string => `TAKEN DOWN  ·  back in ${Math.max(0, secondsLeft).toFixed(1)}`;

/** hud.gd's kill feed line (match.gd _on_died): "Killer  >  Victim"; no killer = "The Lot". */
export const slabFeedText = (killer: string | null, victim: string): string => `${killer ?? 'The Lot'}  >  ${victim}`;

/** hud.gd's line while the mouse is free. */
export const SLAB_CLICK_TO_PLAY = 'Click to play';

/** hud.gd's controls hint (shown for the first 14 s of play), with the web's pad bindings. */
export const SLAB_HINT = 'WASD / stick move · mouse / stick look · Space / A jump · LMB / RT fire · RMB / LT aim · Shift sprint · R / X reload\n'
  + 'Hold the slab alone to score · Esc frees the mouse';
const HINT_SECS = 14;

// ------------------------------------------------------------------------------------------------ DOM

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const u = (n: number) => `calc(var(--u)*${n})`;
/** hud.gd draws its labels in white or team colours over a dark outline; the web uses a soft dark shadow instead. */
const SHADOW = `0 0 ${u(3)} rgba(0,0,0,.85),0 ${u(1)} ${u(2)} rgba(0,0,0,.9)`;
const CSS = `
.cvc-slab #cvc-hud .mb,.cvc-slab #cvc-hud .mb-wave,.cvc-slab #cvc-hud .hp,.cvc-slab #cvc-hud .am,.cvc-slab #cvc-hud .ds,
.cvc-slab #cvc-hud .lk [data-k="Q"],.cvc-slab-end #cvc-hud .bn,.cvc-slab-end #cvc-hud .lk{display:none!important}
.cvc-slab #cvc-hud .kf{gap:${u(2)}}
.cvc-slab #cvc-hud .kf-e.kf-plain{background:none;border:0;box-shadow:none;padding:0;animation:none;white-space:pre;
  font:500 ${u(15)}/1.25 ${FONT_BODY};color:rgba(255,255,255,.9);text-shadow:${SHADOW}}
.cvc-slab #cvc-hud .lk{background:rgba(0,0,0,.28)}
.cvc-slab #cvc-hud .lk .lk-panel{background:none;border:0;box-shadow:none;transform:none;color:#fff;text-shadow:${SHADOW}}
.cvc-slab #cvc-hud .lk .lk-panel::after{display:none}
.cvc-slab #cvc-hud .lk .lk-title{font:600 ${u(26)} ${FONT_BODY};color:#fff;-webkit-text-stroke:0;text-shadow:${SHADOW}}
.cvc-slab #cvc-hud .lk .lk-sub{font:500 ${u(14)} ${FONT_BODY};opacity:.85}
.cvc-slab #cvc-hud .lk .keys{font:500 ${u(13)} ${FONT_BODY}}
.cvc-slab #cvc-hud .lk kbd{font:600 ${u(11.5)} ${FONT_BODY};background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.45);border-radius:${u(3)};box-shadow:none}
.cvc-slab #cvc-hud .lk-main .btn{font:600 ${u(14)} ${FONT_BODY};letter-spacing:.02em;background:rgba(0,0,0,.45);color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:${u(4)};box-shadow:none;text-shadow:none}
.cvc-slab #cvc-hud .lk-main .btn:hover{background:rgba(255,255,255,.15)}
#cvc-slab{position:absolute;inset:0;pointer-events:none;overflow:hidden;user-select:none;
  --u:max(0.6px,min(calc(100vw / 1280),calc(100vh / 720)));font:500 ${u(16)}/1.2 ${FONT_BODY};color:#fff;text-shadow:${SHADOW}}
#cvc-slab .top{position:absolute;left:50%;top:${u(14)};transform:translateX(-50%);display:flex;align-items:flex-start;gap:${u(18)}}
#cvc-slab .tm{width:${u(250)};display:flex;flex-direction:column;gap:${u(5)}}
#cvc-slab .tm .row{font-size:${u(22)};font-weight:600;white-space:pre;letter-spacing:.02em}
#cvc-slab .t0 .row{text-align:right}
#cvc-slab .bar{position:relative;height:${u(8)};background:rgba(0,0,0,.55)}
#cvc-slab .bar i{position:absolute;top:0;bottom:0;width:0;transition:width .25s}
#cvc-slab .t0 .bar i{right:0} #cvc-slab .t1 .bar i{left:0}
#cvc-slab .clk{width:${u(110)};text-align:center;font-size:${u(30)};font-weight:600;line-height:1.05;white-space:nowrap}
#cvc-slab .clk.ot{font-size:${u(24)};line-height:${u(32)}}
#cvc-slab .st{position:absolute;left:50%;top:${u(76)};transform:translateX(-50%);font-size:${u(18)};font-weight:600;letter-spacing:.06em;white-space:pre}
#cvc-slab .mk{position:absolute;left:0;top:0;width:0;height:0;will-change:transform}
#cvc-slab .mk svg{position:absolute;left:${u(-9)};top:${u(-9)};width:${u(18)};height:${u(18)};overflow:visible;filter:drop-shadow(0 0 ${u(2)} rgba(0,0,0,.8))}
#cvc-slab .mk b{position:absolute;left:0;bottom:${u(12)};transform:translateX(-50%);font-size:${u(13)};font-weight:600}
#cvc-slab .hpn{position:absolute;left:${u(24)};bottom:${u(52)};font-size:${u(22)};font-weight:600}
#cvc-slab .hpb{position:absolute;left:${u(24)};bottom:${u(32)};width:${u(240)};height:${u(14)};background:rgba(0,0,0,.55)}
#cvc-slab .hpb i{position:absolute;left:0;top:0;bottom:0;width:100%}
#cvc-slab .amm{position:absolute;right:${u(24)};bottom:${u(28)};font-size:${u(26)};font-weight:600;text-align:right;white-space:nowrap}
#cvc-slab .ctr{position:absolute;left:50%;top:calc(50% + ${u(80)});transform:translateX(-50%);font-size:${u(26)};font-weight:600;white-space:pre}
#cvc-slab .hint{position:absolute;left:50%;bottom:${u(76)};transform:translateX(-50%);width:${u(1000)};text-align:center;font-size:${u(14)};opacity:.85;white-space:pre-line}
#cvc-slab .win{position:absolute;inset:0;background:rgba(5,5,10,.62);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${u(10)};text-align:center}
#cvc-slab .wt{font-size:${u(58)};font-weight:700;letter-spacing:.02em;white-space:nowrap}
#cvc-slab .ws{font-size:${u(22)};font-weight:600;white-space:pre}
#cvc-slab .wy{font-size:${u(22)}}
#cvc-slab .wr{margin-top:${u(26)};font-size:${u(22)}}
`;

export interface SlabHudFrame {
  match: MatchState | null;
  /** The slab this frame (SlabView.reading). */
  slab: SlabReading | null;
  localId: number;
  /** The local character this frame (null = not spawned yet). */
  local: EntityState | null;
  roster: readonly RosterEntry[];
  camera: Camera;
}

export interface SlabHud {
  /** A slab match is running (MatchState.mode 'slab'). */
  readonly active: boolean;
  /** The winner screen is up (the match is over): Enter rematches, the general scoreboard waits. */
  readonly winnerUp: boolean;
  /** Every snapshot's MatchState (main.ts: bus 'match'): remembers overtime even when frames are seconds apart, so a
   *  match that ends in overtime keeps OVERTIME on the clock. */
  onMatch(ms: MatchState): void;
  update(f: SlabHudFrame, dt: number): void;
  dispose(): void;
}

export interface SlabHudOptions {
  /** Points to win (SLAB.winScore, 60). */
  winScore: number;
}

export function createSlabHud(ui: HTMLElement, opts: SlabHudOptions): SlabHud {
  const root = document.createElement('div');
  root.id = 'cvc-slab';
  root.innerHTML = `<style>${CSS}</style>
    <div class="top">
      <div class="tm t0"><div class="row" data-slab-s0-row>${SLAB_TEAM_NAMES[0]}  <span data-slab-s0>0</span></div><div class="bar"><i></i></div></div>
      <div class="clk" data-slab-clock>3:00</div>
      <div class="tm t1"><div class="row" data-slab-s1-row><span data-slab-s1>0</span>  ${SLAB_TEAM_NAMES[1]}</div><div class="bar"><i></i></div></div>
    </div>
    <div class="st" data-slab-state>SLAB NEUTRAL</div>
    <div class="mk"><svg viewBox="-10 -10 20 20" aria-hidden="true"><path d="M0 -9L9 0L0 9L-9 0Z"/></svg><b>SLAB</b></div>
    <div class="hpn" data-slab-hp>120</div><div class="hpb"><i></i></div>
    <div class="amm" data-slab-ammo>30 / 30</div>
    <div class="ctr" data-slab-down style="display:none"></div>
    <div class="hint" data-slab-hint style="display:none"></div>
    <div class="win" data-slab-win style="display:none"><div class="wt"></div><div class="ws"></div><div class="wy"></div><div class="wr"></div></div>`;
  ui.appendChild(root);
  root.style.display = 'none';
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as unknown as T;
  const rows = [q('[data-slab-s0-row]'), q('[data-slab-s1-row]')];
  const scores = [q('[data-slab-s0]'), q('[data-slab-s1]')];
  const fills = [q('.t0 .bar i'), q('.t1 .bar i')];
  const clock = q('.clk'), state = q('.st'), mk = q('.mk'), mkPath = q<SVGPathElement>('.mk path'), mkText = q('.mk b');
  const hpNum = q('.hpn'), hpBar = q('.hpb'), hpFill = q('.hpb i'), ammo = q('.amm'), down = q('.ctr'), hint = q('.hint');
  const win = q('.win'), wt = q('.wt'), ws = q('.ws'), wy = q('.wy'), wr = q('.wr');
  hint.textContent = SLAB_HINT;
  for (const t of [0, 1] as const) {
    rows[t].style.color = hex(lighten(TEAM[t], 0.45));
    fills[t].style.background = hex(lighten(TEAM[t], 0.15));
  }
  const cache = new Map<Element, string>();
  const text = (e: Element, t: string) => { if (cache.get(e) !== t) { cache.set(e, t); e.textContent = t; } };
  const disp = (e: HTMLElement, on: boolean) => { const v = on ? '' : 'none'; if (e.style.display !== v) e.style.display = v; };
  const style = (e: HTMLElement, k: string, v: string) => { if (e.style.getPropertyValue(k) !== v) e.style.setProperty(k, v); };
  const v = new Vector3();
  let active = false, winnerUp = false, overtime = false;
  let hintLeft = HINT_SECS, downSince = -1, clockT = 0;

  const setActive = (on: boolean, ended: boolean) => {
    active = on;
    winnerUp = on && ended;
    disp(root, on);
    ui.classList.toggle('cvc-slab', on);
    ui.classList.toggle('cvc-slab-end', on && ended);
  };

  return {
    get active() { return active; },
    get winnerUp() { return winnerUp; },
    onMatch(ms) {
      if (ms.mode === 'slab' && ms.phase === 'live') overtime = slabOvertime(ms);
    },
    update(f, dt) {
      const M = f.match;
      if (!M || M.mode !== 'slab') { if (active) setActive(false, false); return; }
      setActive(true, M.phase === 'ended');
      clockT += dt;
      for (const t of [0, 1] as const) {
        text(scores[t], String(M.score[t]));
        style(fills[t], 'width', `${(slabFrac(M.score[t], opts.winScore) * 100).toFixed(1)}%`);
      }
      if (M.phase === 'live') overtime = slabOvertime(M);
      const c = slabClock(M, overtime);
      text(clock, c.text);
      clock.className = c.tone === 'ot' ? 'clk ot' : 'clk';
      style(clock, 'color', hex(SLAB_CLOCK_COLOR[c.tone]));
      const col = hex(slabHudColor(f.slab));
      text(state, slabStateText(f.slab));
      style(state, 'color', col);
      // the slab marker (hud.gd): over the slab centre, clamped to the screen; behind the camera it flips to the bottom
      const W = innerWidth, H = innerHeight;
      if (f.slab && !winnerUp) {
        v.set(f.slab.x, f.slab.y + 1.5, f.slab.z);
        const near = v.distanceTo(f.camera.position) <= 1;
        v.project(f.camera);
        const behind = v.z > 1;
        let sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
        if (behind) { sx = W - sx; sy = H - 40; }
        const m = 36;
        sx = Math.max(m, Math.min(W - m, sx));
        sy = Math.max(m + 70, Math.min(H - m, sy));
        disp(mk, !near);
        mk.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
        mkPath.setAttribute('fill', col);
        style(mkText, 'color', col);
      } else disp(mk, false);
      // you: hit points, ammo, the down line, the controls hint (hud.gd)
      const L = f.local;
      for (const e of [hpNum, hpBar, ammo]) disp(e, !!L);
      const dead = !!L && (L.flags & EFlag.Dead) !== 0;
      if (L) {
        const hp = Math.max(0, L.hp);
        text(hpNum, String(Math.ceil(hp)));
        style(hpFill, 'width', `${((hp / Math.max(1, L.maxHp)) * 100).toFixed(1)}%`);
        style(hpFill, 'background', hex(slabHpColor(hp)));
        text(ammo, slabAmmoText(L));
      }
      if (dead && downSince < 0) downSince = clockT;
      if (!dead) downSince = -1;
      disp(down, dead && M.phase === 'live');
      if (dead) text(down, slabDownText(SLAB.respawn - (clockT - downSince)));
      hintLeft -= dt;
      disp(hint, !!L && hintLeft > 0 && M.phase === 'live');
      // the winner screen
      const me = f.roster.find((r) => r.entity === f.localId) ?? null;
      const w = slabWinner(M, me);
      disp(win, !!w);
      if (w) {
        text(wt, w.title);
        style(wt, 'color', w.team === -1 ? '#ffffff' : hex(lighten(TEAM[w.team], 0.4)));
        text(ws, w.score);
        text(wy, w.you);
        text(wr, w.prompt);
      }
    },
    dispose() {
      ui.classList.remove('cvc-slab', 'cvc-slab-end');
      root.remove();
      cache.clear();
    },
  };
}
