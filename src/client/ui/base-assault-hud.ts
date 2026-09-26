// base-assault presentation, DOM (W9 G4a, mode-1). Reads the Base Assault props in the snapshot (layout:
// src/shared/content/modes.ts), the roster (carrier names) and Base Assault game events. Idle and hidden in other modes.
//   strip    under the match bar: each ball's state (HOME · TAKEN by <name> · DROPPED with the return countdown), the
//            captures toward the limit as pips, and the stalemate clock / relief
//   banners  comic bursts: BALL TAKEN! · CAPTURED! · BALL RETURNED · BALL DROPPED! (smaller), each with a line for you
//   markers  over a ball that is away from home, seen through walls: whose ball, and the return countdown on the ground
//   cue      for the local carrier: run it home / hold: your own ball must be home first
//   audio    only through the audio module's public API (audio.engine.play with its exported recipes): a squeak where a
//            ball changes hands, the chapter fanfare when your team captures (the score stings play on their own)
// The model (readBaseAssault, bannerFor) is pure and tested headless; the DOM is thin over it.
import { Vector3, type Camera } from 'three/webgpu';
import type { EntityState, GameEvent, MatchState, RosterEntry } from '../../shared/protocol';
import { EFlag, EntityKind, Species } from '../../shared/types';
import { BA_BALL_SEED, BA_GOAL_SEED, BA_PICKUP_ITEM, BA_REASON, BASE_ASSAULT, BallState } from '../../shared/content/modes';
import { PALETTE } from '../style/style-tokens.js';
import { FONT_BODY, FONT_COMIC, FONT_DISPLAY } from './fonts';
import { abilitySfx, SCORE_STINGERS, type GameAudio } from '../audio';

type Side = 0 | 1;
const TEAM_NAME = ['CORGIS', 'CATS'] as const;
const BALL_NAME = ['corgi ball', 'cat ball'] as const;

export interface BallChip {
  team: Side;
  state: 'home' | 'taken' | 'dropped';
  carrier: number;
  carrierName: string;
  /** Seconds until a dropped ball goes home (0 otherwise). */
  returnIn: number;
  x: number; y: number; z: number;
}

export interface BaseAssaultModel {
  balls: [BallChip, BallChip];
  /** Per team: captures blocked (its own ball is away, no relief). */
  blocked: [boolean, boolean];
  relief: boolean;
  /** Seconds until the stalemate relief opens while both balls are away (0 = not counting). */
  reliefIn: number;
  /** The local character carries the enemy ball. */
  localCarrying: boolean;
}

function nameOf(id: number, states: ReadonlyMap<number, EntityState>, roster: readonly RosterEntry[]): string {
  const r = roster.find((p) => p.entity === id);
  if (r) return r.name;
  const s = states.get(id);
  return s ? (s.species === Species.Cat ? `Cat ${id}` : `Pup ${id}`) : `#${id}`;
}

/** The Base Assault picture of this frame, or null when no base-assault match runs. */
export function readBaseAssault(states: ReadonlyMap<number, EntityState>, localId: number, roster: readonly RosterEntry[] = []): BaseAssaultModel | null {
  const balls: (BallChip | null)[] = [null, null];
  const blocked: [boolean, boolean] = [false, false];
  let relief = false, reliefIn = 0;
  for (const s of states.values()) {
    if (s.kind !== EntityKind.Prop || (s.team !== 0 && s.team !== 1)) continue;
    const t = s.team as Side;
    if (s.seed === BA_BALL_SEED) {
      const state = s.weapon === BallState.Carried ? 'taken' : s.weapon === BallState.Dropped ? 'dropped' : 'home';
      balls[t] = {
        team: t, state, carrier: state === 'taken' ? s.ammo : 0, carrierName: state === 'taken' ? nameOf(s.ammo, states, roster) : '',
        returnIn: state === 'dropped' ? Math.max(0, s.hp) : 0, x: s.x, y: s.y, z: s.z,
      };
    } else if (s.seed === BA_GOAL_SEED) {
      blocked[t] = (s.flags & EFlag.Busy) !== 0;
      if (s.weapon === 1) relief = true;
      if (s.hp > 0) reliefIn = Math.max(reliefIn, s.hp);
    }
  }
  if (!balls[0] || !balls[1]) return null;
  const local = states.get(localId);
  const localCarrying = !!local && !(local.flags & EFlag.Dead) && (balls[0].carrier === localId || balls[1].carrier === localId);
  return { balls: [balls[0], balls[1]], blocked, relief, reliefIn: relief ? 0 : reliefIn, localCarrying };
}

export interface Banner {
  text: string;
  sub: string;
  /** Burst colour: a team's, or null for the gold neutral. */
  team: Side | null;
  /** Big (steal, capture, return) or small (a drop). */
  big: boolean;
}

/**
 * The banner a Base Assault event raises for the local player (team -1 = spectating / not spawned: team-neutral
 * lines), or null for other events. `carrier`: the local character carries a ball now (the steal was theirs).
 */
export function bannerFor(ev: GameEvent, localTeam: number, localCarrying = false): Banner | null {
  if (ev.e !== 'score' || (ev.team !== 0 && ev.team !== 1)) return null;
  const t = ev.team as Side, foe = (1 - t) as Side;
  const mine = localTeam === t, known = localTeam === 0 || localTeam === 1;
  switch (ev.reason) {
    case BA_REASON.taken: // team = the thieves
      return {
        text: 'BALL TAKEN!', team: t, big: true,
        sub: !known ? `The ${TEAM_NAME[t].toLowerCase()} have the ${BALL_NAME[foe]}` : mine ? (localCarrying ? 'It\'s on your back. Run it home!' : 'We\'ve got their ball. Cover the carrier!') : 'They took our ball. Stop the carrier!',
      };
    case BA_REASON.captured: // team = the scorers
      return { text: 'CAPTURED!', team: t, big: true, sub: !known ? `+1 for the ${TEAM_NAME[t].toLowerCase()}` : mine ? '+1 for us. Go again!' : `+1 for the ${TEAM_NAME[t].toLowerCase()}` };
    case BA_REASON.returned: // team = the ball's own team
      return { text: 'BALL RETURNED', team: t, big: true, sub: !known ? `The ${BALL_NAME[t]} is home` : mine ? 'Our ball is back on its stand' : 'Their ball is back on its stand' };
    case BA_REASON.dropped: // team = the ball's own team
      return { text: 'BALL DROPPED!', team: null, big: false, sub: !known ? `The ${BALL_NAME[t]} is on the ground` : mine ? 'Touch our ball to send it home!' : 'Grab their ball before it goes home!' };
    default:
      return null;
  }
}

/** The strip text of one ball. */
export function chipText(b: BallChip): string {
  return b.state === 'home' ? 'HOME' : b.state === 'taken' ? `TAKEN · ${b.carrierName}` : `DROPPED · ${Math.ceil(b.returnIn)}`;
}

// ------------------------------------------------------------------------------------------------ DOM

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const u = (n: number) => `calc(var(--u)*${n})`;
const CSS = `
#cvc-ba{position:absolute;inset:0;pointer-events:none;overflow:hidden;user-select:none;
  --u:max(0.6px,min(calc(100vw / 1280),calc(100vh / 720)));--ink:${hex(PALETTE.ink)};--paper:#f6ecd8;
  --t0:${hex(PALETTE.teamCorgis)};--t0b:${hex(PALETTE.teamCorgisTrim)};--t1:${hex(PALETTE.teamCats)};--t1b:#ffd9de;--gold:#ffd04a;
  --felt:#c6d34c;font-family:${FONT_DISPLAY};color:var(--paper)}
#cvc-ba .strip{position:absolute;left:50%;top:${u(80)};transform:translateX(-50%);display:flex;align-items:stretch;gap:${u(8)};filter:drop-shadow(${u(2)} ${u(3)} 0 var(--ink))}
#cvc-ba .chip{display:flex;align-items:center;gap:${u(7)};min-width:${u(168)};padding:${u(3)} ${u(10)} ${u(3)} ${u(5)};background:var(--paper);color:var(--ink);border:${u(2.5)} solid var(--ink);border-radius:${u(10)}}
#cvc-ba .chip.t1{flex-direction:row-reverse;padding:${u(3)} ${u(5)} ${u(3)} ${u(10)};text-align:right}
#cvc-ba .chip .ico{width:${u(28)};height:${u(28)};flex:none}
#cvc-ba .chip .who{font:800 ${u(9.5)}/1 ${FONT_BODY};letter-spacing:.08em;opacity:.75}
#cvc-ba .chip .st{font-size:${u(15)};line-height:1.05;white-space:nowrap;max-width:${u(150)};overflow:hidden;text-overflow:ellipsis}
#cvc-ba .chip.away{background:var(--team);color:#fff}
#cvc-ba .chip.away .st{-webkit-text-stroke:${u(1)} var(--ink);paint-order:stroke fill}
#cvc-ba .chip.dropped{background:var(--gold);color:var(--ink)}
#cvc-ba .chip.dropped .st{-webkit-text-stroke:0}
#cvc-ba .chip.mine .who::after{content:' · YOURS';color:inherit}
#cvc-ba .t0{--team:var(--t0);--team2:var(--t0b)} #cvc-ba .t1{--team:var(--t1);--team2:var(--t1b)}
#cvc-ba .mid{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${u(2)};min-width:${u(92)};padding:${u(2)} ${u(8)};background:var(--ink);border:${u(2.5)} solid var(--ink);border-radius:${u(10)}}
#cvc-ba .pips{display:flex;gap:${u(3)};align-items:center}
#cvc-ba .pip{width:${u(9)};height:${u(9)};border-radius:50%;border:${u(1.5)} solid var(--paper);opacity:.55}
#cvc-ba .pip.on{background:var(--team);opacity:1;border-color:var(--team2)}
#cvc-ba .pips .vs{font:800 ${u(9)}/1 ${FONT_BODY};opacity:.7;margin:0 ${u(3)}}
#cvc-ba .note{font:800 ${u(9.5)}/1.1 ${FONT_BODY};letter-spacing:.06em;white-space:nowrap}
#cvc-ba .note.hot{color:var(--gold);animation:cvcBaPulse .6s ease-in-out infinite alternate}
#cvc-ba .bn{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:${u(6)}}
#cvc-ba .burst{position:relative;padding:${u(18)} ${u(44)};background:var(--team,var(--gold));
  clip-path:polygon(50% 0,58% 14%,74% 2%,74% 20%,94% 12%,86% 32%,100% 40%,86% 52%,100% 66%,82% 68%,90% 90%,70% 80%,62% 100%,50% 84%,38% 100%,30% 80%,10% 90%,18% 68%,0 66%,14% 52%,0 40%,14% 32%,6% 12%,26% 20%,26% 2%,42% 14%)}
#cvc-ba .bn.small .burst{padding:${u(12)} ${u(30)}}
#cvc-ba .bn-text{font-family:${FONT_COMIC};font-size:${u(50)};letter-spacing:.03em;color:#fff;-webkit-text-stroke:${u(3.5)} var(--ink);paint-order:stroke fill;text-shadow:${u(4)} ${u(5)} 0 var(--ink);white-space:nowrap;transform:rotate(-3deg)}
#cvc-ba .bn.small .bn-text{font-size:${u(32)}}
#cvc-ba .bn-sub{font:800 ${u(14)}/1.2 ${FONT_BODY};background:var(--ink);color:var(--paper);border-radius:${u(14)};padding:${u(4)} ${u(12)};white-space:nowrap}
#cvc-ba .mk{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;will-change:transform}
#cvc-ba .mk .ico{width:${u(30)};height:${u(30)};filter:drop-shadow(0 ${u(2)} 0 var(--ink))}
#cvc-ba .mk .cd{margin-top:${u(1)};font-size:${u(14)};color:#fff;-webkit-text-stroke:${u(1.5)} var(--ink);paint-order:stroke fill}
#cvc-ba .cue{position:absolute;left:50%;bottom:${u(190)};transform:translateX(-50%);padding:${u(5)} ${u(14)};border:${u(3)} solid var(--ink);border-radius:${u(10)};background:var(--felt);color:var(--ink);font-size:${u(17)};letter-spacing:.05em;box-shadow:${u(3)} ${u(3)} 0 var(--ink);white-space:nowrap}
#cvc-ba .cue.hold{background:var(--paper)}
#cvc-ba .cue small{display:block;font:700 ${u(11)}/1.2 ${FONT_BODY};letter-spacing:.02em;opacity:.8}
@keyframes cvcBaPulse{from{opacity:.55}to{opacity:1}}
@keyframes cvcBaPop{0%{transform:scale(.3) rotate(-8deg);opacity:0}60%{transform:scale(1.12) rotate(2deg);opacity:1}100%{transform:scale(1) rotate(0)}}
@keyframes cvcBaOut{to{transform:scale(.8);opacity:0}}
`;

/** Ball icon: felt, seam and a strip of team tape. */
function ballIcon(team: Side): string {
  const tape = team === 0 ? hex(PALETTE.teamCorgis) : hex(PALETTE.teamCats);
  const trim = team === 0 ? hex(PALETTE.teamCorgisTrim) : '#2b2a33';
  return `<svg class="ico" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13.5" fill="#c6d34c" stroke="#1a120c" stroke-width="2.5"/>
    <path d="M5.5 9.5c6 3.5 6 9.5 0 13M26.5 9.5c-6 3.5-6 9.5 0 13" fill="none" stroke="#f3eedb" stroke-width="2"/>
    <path d="M9 4.5L23 27.5" stroke="${tape}" stroke-width="5"/><path d="M9 4.5L23 27.5" stroke="${trim}" stroke-width="1.2" stroke-dasharray="2 3"/></svg>`;
}

export interface BaseAssaultHudFrame {
  states: ReadonlyMap<number, EntityState>;
  localId: number;
  roster: readonly RosterEntry[];
  match: MatchState | null;
  camera: Camera;
  /** Drawn ball positions from the 3D view (markers follow the drawn ball; falls back to the snapshot). */
  ballAt?: (team: number) => { x: number; y: number; z: number } | null;
}

export interface BaseAssaultHud {
  readonly active: boolean;
  /** The carrier cue holds the bottom centre (main.ts ORs it into the HUD's cueUp, so first-match tips wait). */
  readonly cueUp: boolean;
  update(f: BaseAssaultHudFrame, dt: number): void;
  onGameEvent(ev: GameEvent, localId: number): void;
  /** The banner up now (tests, labs). */
  readonly banner: Banner | null;
  dispose(): void;
}

export interface BaseAssaultHudOptions {
  audio?: Pick<GameAudio, 'engine'> | null;
  /** Banner time (s). */
  bannerSecs?: number;
}

export function createBaseAssaultHud(ui: HTMLElement, opts: BaseAssaultHudOptions = {}): BaseAssaultHud {
  const root = document.createElement('div');
  root.id = 'cvc-ba';
  root.innerHTML = `<style>${CSS}</style>
    <div class="strip">
      <div class="chip t0"><span class="i0"></span><div><div class="who">CORGI BALL</div><div class="st">HOME</div></div></div>
      <div class="mid"><div class="pips"></div><div class="note"></div></div>
      <div class="chip t1"><span class="i1"></span><div><div class="who">CAT BALL</div><div class="st">HOME</div></div></div>
    </div>
    <div class="bn" style="display:none"><div class="burst"><div class="bn-text"></div></div><div class="bn-sub"></div></div>
    <div class="cue" style="display:none"></div>`;
  ui.appendChild(root);
  root.style.display = 'none';
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  q('.i0').outerHTML = ballIcon(0);
  q('.i1').outerHTML = ballIcon(1);
  const chips = [q('.chip.t0'), q('.chip.t1')];
  const chipSt = chips.map((c) => c.querySelector('.st') as HTMLElement);
  const pips = q('.pips'), note = q('.note'), bn = q('.bn'), bnText = q('.bn-text'), bnSub = q('.bn-sub'), burst = q('.burst'), cue = q('.cue');
  const markers = ([0, 1] as const).map((t) => {
    const el = document.createElement('div');
    el.className = 'mk';
    el.innerHTML = `${ballIcon(t)}<div class="cd"></div>`;
    el.style.display = 'none';
    root.appendChild(el);
    return { el, cd: el.querySelector('.cd') as HTMLElement };
  });
  const cache = new Map<Element, string>();
  const text = (e: HTMLElement, t: string) => { if (cache.get(e) !== t) { cache.set(e, t); e.textContent = t; } };
  const html = (e: HTMLElement, t: string) => { if (cache.get(e) !== t) { cache.set(e, t); e.innerHTML = t; } };
  const cls = (e: HTMLElement, c: string) => { if (e.className !== c) e.className = c; };
  const disp = (e: HTMLElement, on: boolean) => { const v = on ? '' : 'none'; if (e.style.display !== v) e.style.display = v; };
  const v = new Vector3();
  let active = false, bannerUntil = 0, clock = 0, current: Banner | null = null, localTeam = -1, carrying = false;
  let last: BaseAssaultModel | null = null, lastStates: ReadonlyMap<number, EntityState> | null = null;
  let localPickAt = -10, pipsKey = '';
  const bannerSecs = opts.bannerSecs ?? 2.4;

  const play = (kind: 'squeak' | 'capture', at?: { x: number; y: number; z: number }) => {
    const engine = opts.audio?.engine;
    if (!engine) return;
    if (kind === 'squeak') {
      const s = abilitySfx('squeak_barrier'); // the squeak toy's own voice (C2's Squeak Barrier)
      engine.play(s.recipe, at ? { x: at.x, y: at.y, z: at.z, gain: 0.8, priority: 2, category: 'fx', refDist: 6, maxDist: 70 } : { gain: 0.7, priority: 2, category: 'fx' });
    } else engine.play(SCORE_STINGERS.chapter, { bus: 'ui', gain: 0.8, priority: 3, category: 'ui' });
  };

  const hud: BaseAssaultHud = {
    get active() { return active; },
    get cueUp() { return active && carrying; },
    get banner() { return current; },
    update(f, dt) {
      clock += dt;
      const m = readBaseAssault(f.states, f.localId, f.roster);
      last = m;
      lastStates = f.states;
      active = !!m;
      disp(root, active);
      if (!m) return;
      const local = f.states.get(f.localId);
      localTeam = local ? local.team : -1;
      carrying = m.localCarrying;
      for (const t of [0, 1] as const) {
        const b = m.balls[t];
        cls(chips[t], `chip t${t}${b.state === 'home' ? '' : b.state === 'dropped' ? ' away dropped' : ' away'}${localTeam === t ? ' mine' : ''}`);
        text(chipSt[t], chipText(b));
      }
      // captures toward the limit (the match bar shows the numbers)
      const limit = BASE_ASSAULT.captureLimit, score = f.match?.score ?? [0, 0];
      const key = `${score[0]}:${score[1]}`;
      if (key !== pipsKey) {
        pipsKey = key;
        const row = (t: number) => Array.from({ length: limit }, (_, i) => `<i class="pip t${t}${score[t] > i ? ' on' : ''}"></i>`).join('');
        html(pips, `${row(0)}<span class="vs">FIRST TO ${limit}</span>${row(1)}`);
      }
      const hot = m.relief;
      text(note, m.relief ? 'STALEMATE · RINGS OPEN' : m.reliefIn > 0 ? `STALEMATE IN ${Math.ceil(m.reliefIn)}` : 'STEAL · CARRY · CAPTURE');
      cls(note, hot ? 'note hot' : 'note');
      // markers over balls away from home (seen through walls; hidden behind the camera)
      for (const t of [0, 1] as const) {
        const b = m.balls[t], mk = markers[t];
        const carriedByMe = b.carrier === f.localId;
        if (b.state === 'home' || carriedByMe) { disp(mk.el, false); continue; }
        const at = f.ballAt?.(t) ?? b;
        v.set(at.x, at.y + 1.1, at.z).project(f.camera);
        const vis = v.z < 1 && Math.abs(v.x) < 1.02 && Math.abs(v.y) < 1.02;
        disp(mk.el, vis);
        if (!vis) continue;
        mk.el.style.transform = `translate(${((v.x * 0.5 + 0.5) * innerWidth - 15).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * innerHeight - 15).toFixed(1)}px)`;
        text(mk.cd, b.state === 'dropped' ? String(Math.ceil(b.returnIn)) : '');
      }
      // the local carrier's cue
      if (m.localCarrying && local) {
        const own = local.team === 1 ? 1 : 0;
        const hold = m.blocked[own];
        disp(cue, true);
        cls(cue, hold ? 'cue hold' : 'cue');
        html(cue, hold ? `HOLD THE BALL<small>Your own ball must be home to capture${m.reliefIn > 0 ? ` · rings open in ${Math.ceil(m.reliefIn)}` : ''}</small>` : 'RUN IT HOME!<small>Touch your flag\'s ring to capture</small>');
      } else disp(cue, false);
      if (current && clock > bannerUntil) { current = null; disp(bn, false); }
    },
    onGameEvent(ev, localId) {
      if (ev.e === 'pickup' && ev.item === BA_PICKUP_ITEM) {
        // (the authority sends the pickup just before its 'ball taken' score event: remember a steal of our own)
        if (ev.id === localId) localPickAt = clock;
        const c = lastStates?.get(ev.id);
        play('squeak', c ? { x: c.x, y: c.y + 1, z: c.z } : undefined);
        return;
      }
      const b = bannerFor(ev, localTeam, carrying || clock - localPickAt < 0.25);
      if (!b) return;
      if (ev.e === 'score' && ev.reason === BA_REASON.captured && ev.team === localTeam) play('capture');
      if (ev.e === 'score' && ev.reason === BA_REASON.dropped && last) { const d = last.balls[ev.team as Side]; play('squeak', d); }
      // a drop never hides a big banner still up
      if (!b.big && current?.big && clock < bannerUntil) return;
      current = b;
      bannerUntil = clock + (b.big ? bannerSecs : bannerSecs * 0.7);
      text(bnText, b.text);
      text(bnSub, b.sub);
      cls(bn, `bn${b.big ? '' : ' small'}${b.team === null ? '' : ` t${b.team}`}`);
      burst.style.background = b.team === null ? 'var(--gold)' : b.team === 0 ? 'var(--t0b)' : '#ff8c95';
      disp(bn, true);
      burst.animate?.([{ transform: 'scale(.3) rotate(-8deg)', opacity: 0 }, { transform: 'scale(1.12) rotate(2deg)', opacity: 1, offset: 0.6 }, { transform: 'scale(1) rotate(0)' }], { duration: 450, easing: 'cubic-bezier(.2,1.5,.4,1)' });
    },
    dispose() {
      root.remove();
      cache.clear();
    },
  };
  return hud;
}
