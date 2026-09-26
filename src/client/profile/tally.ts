// OWNER: P2 (profile). Builds the local player's MatchResult from what the client already receives: game events (bus
// 'game') and the MatchState + entity states each frame. Pure (no DOM, no three): tests drive it with fake frames.
//
//   knockouts  `death` events with `by` = you, the victim not on your team
//   steps      `score` events for your team with reason 'step' (adventure) or 'objective' (Squeaker mission)
//   cores      `pickup` events by you of an Upgrade Core
//   pads       `score` 'took pad X' for your team while you stand on that pad (core-rush, Zone entity seed = index)
//   outcome    the MatchState's winner vs your team when the phase turns 'ended' (adventure: a completed chapter = win,
//              with its paw read from the adventure beacon)
//   seconds    time you were in the live phase
// A result comes out once per match, at its end; a match you only saw ended (joined during the result) gives none.
import type { EntityState, GameEvent, MatchState } from '../../shared/protocol';
import { CORE_PAD_LABELS, CORE_RUSH } from '../../shared/content/modes';
import { isCore } from '../../shared/content/pickups';
import { EFlag, EntityKind } from '../../shared/types';
import type { Medal } from '../../shared/content/chapters';
import { readAdventure } from '../adventure/model';
import type { MatchResult } from './xp';

export interface TallyFrame {
  match: MatchState | null;
  localId: number;
  /** All interpolated entity states this frame (the local player's, pads, victims, the adventure beacon). */
  states: ReadonlyMap<number, EntityState>;
  dt: number;
  /** Optional: A1's adventure view (adventure.view); read from the beacon in `states` when absent. */
  adventure?: { phase: string; chapter: { id: string }; medal: Medal | null } | null;
  /** Optional: the room's mode when MatchState.mode says less (boss-rush runs as 'yard-skirmish'). */
  mode?: string;
}

/** Slack on the pad radius: interpolated positions trail the authority by the render delay. */
const PAD_SLACK = 1.5;
/** How long an ended adventure waits for the beacon to show the paw before the result goes out without it. */
const PAW_WAIT = 2;

export class MatchTally {
  private mode = '';
  private phase: MatchState['phase'] | null = null;
  private sawLive = false;
  private reported = false;
  private endWait = -1;
  private localId = -1;
  private team = -1;
  private seconds = 0;
  private knockouts = 0;
  private steps = 0;
  private cores = 0;
  private pads = 0;
  private deaths: number[] = [];
  private padTakes: number[] = [];

  /** Forget the running match (a new one starts). */
  reset(): void {
    this.sawLive = false; this.reported = false; this.endWait = -1;
    this.seconds = 0; this.knockouts = 0; this.steps = 0; this.cores = 0; this.pads = 0;
    this.deaths.length = 0; this.padTakes.length = 0;
  }

  /** Feed every game event (bus 'game'). `localId`: net.localEntity (default: the last frame's). */
  onEvent(ev: GameEvent, localId = this.localId): void {
    if (this.reported) return;
    switch (ev.e) {
      case 'death':
        if (localId >= 0 && ev.by === localId && ev.id !== localId && this.deaths.length < 64) this.deaths.push(ev.id);
        break;
      case 'pickup':
        if (localId >= 0 && ev.id === localId && isCore(ev.item)) this.cores++;
        break;
      case 'score': {
        if (ev.reason === 'reset') { this.reset(); break; }
        const mine = this.team < 0 || ev.team === this.team;
        if (!mine) break;
        if (ev.reason === 'step' || ev.reason === 'objective') this.steps++;
        const m = /^took pad (\w+)$/.exec(ev.reason);
        if (m && this.padTakes.length < 16) {
          const i = (CORE_PAD_LABELS as readonly string[]).indexOf(m[1]);
          if (i >= 0) this.padTakes.push(i);
        }
        break;
      }
      default:
        break;
    }
  }

  /** Call every frame. Returns the local player's result once, when the match (or chapter) ends; otherwise null. */
  update(f: TallyFrame): MatchResult | null {
    const ms = f.match;
    if (!ms) return null;
    this.localId = f.localId;
    const local = f.localId >= 0 ? f.states.get(f.localId) ?? null : null;
    if (local && (local.team === 0 || local.team === 1)) this.team = local.team;
    if (ms.mode !== this.mode) { this.mode = ms.mode; this.reset(); }
    if (this.phase === 'ended' && ms.phase !== 'ended') this.reset(); // the next match
    this.phase = ms.phase;
    this.resolve(f.states, local);
    if (ms.phase === 'live') {
      this.sawLive = true;
      if (local) this.seconds += Math.max(0, Math.min(0.25, f.dt));
      return null;
    }
    if (ms.phase !== 'ended' || !this.sawLive || this.reported) return null;
    // ended: the result (an adventure waits a moment for the beacon's paw)
    let chapter: MatchResult['chapter'] = null;
    if (ms.mode === 'adventure') {
      const adv = f.adventure !== undefined ? f.adventure : readAdventure(f.states);
      if (adv && adv.phase === 'complete' && adv.medal) chapter = { id: adv.chapter.id, medal: adv.medal };
      else {
        this.endWait = this.endWait < 0 ? 0 : this.endWait + Math.max(0, f.dt);
        if (this.endWait < PAW_WAIT) return null;
      }
    }
    this.reported = true;
    const outcome = ms.winner === -1 ? 'draw' : ms.winner === this.team ? 'win' : 'loss';
    return {
      mode: f.mode ?? ms.mode, outcome,
      knockouts: this.knockouts, steps: this.steps, cores: this.cores, pads: this.pads,
      chapter, seconds: Math.round(this.seconds * 10) / 10,
    };
  }

  /** Settle queued knockouts (victim team) and pad captures (were you on the pad?) against this frame's states. */
  private resolve(states: ReadonlyMap<number, EntityState>, local: EntityState | null): void {
    for (const id of this.deaths) {
      const v = states.get(id);
      if (!v || v.team !== this.team) this.knockouts++;
    }
    this.deaths.length = 0;
    if (!this.padTakes.length) return;
    const alive = !!local && (local.flags & EFlag.Dead) === 0;
    for (const i of this.padTakes) {
      if (!alive) continue;
      for (const s of states.values()) {
        if (s.kind !== EntityKind.Zone || s.seed !== i) continue;
        if (Math.hypot(s.x - local!.x, s.z - local!.z) <= CORE_RUSH.padRadius + PAD_SLACK) this.pads++;
        break;
      }
    }
    this.padTakes.length = 0;
  }
}
