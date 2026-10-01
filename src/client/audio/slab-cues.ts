// OWNER: A-HOOK (W13). The slab match's four cues in the browser, the web twin of engines/godot/game/sfx.gd (Godot is
// the main build: when the two disagree, Godot wins). Same WAV files (public/assets/audio, served at /assets/audio/),
// same choices:
//   rifle_shot                      every 'fire': yours centred, anyone else's at the muzzle (inverse distance from
//                                   SLAB_SHOT_REF m, culled past SLAB_SHOT_MAX m: sfx.gd SHOT_UNIT / SHOT_MAX_DIST)
//   hit_confirm                     your shot landed on a pet ('hit' with src = you, dst = someone else)
//   slab_tick / slab_tick_enemy     a slab point for your side / the other side (the snapshot's MatchState score rose:
//                                   the authority adds slab points silently, with no event per point)
//   match_end_win / match_end_lose  the match ended (live -> ended): your side won / did not (a draw too)
// "Your side" is the local pet's team, or Corgi Company (0) without one, as sfx.gd my_team(). In slab mode these take
// the place of the synth rifle report, the shooter's hit thud and the generic score stings (index.ts).
import type { GameEvent, MatchState } from '../../shared/protocol';
import type { Recipe } from './presets';

export type SlabCue = 'rifle_shot' | 'hit_confirm' | 'slab_tick' | 'slab_tick_enemy' | 'match_end_win' | 'match_end_lose';

/** Cue -> file under /assets/audio/ (sfx.gd CUES). */
export const SLAB_CUE_FILE: Readonly<Record<SlabCue, string>> = {
  rifle_shot: 'synth_rifle_shot.wav',
  hit_confirm: 'synth_hit_confirm.wav',
  slab_tick: 'synth_slab_tick.wav',
  slab_tick_enemy: 'synth_slab_tick_enemy.wav',
  match_end_win: 'synth_match_end_win.wav',
  match_end_lose: 'synth_match_end_lose.wav',
};
export const SLAB_CUES = Object.keys(SLAB_CUE_FILE) as SlabCue[];
export const SLAB_AUDIO_BASE = '/assets/audio/';

/** Play levels in dB (sfx.gd VOLUME_DB: A-CUES's starting gains, each file peaks at -3 dBFS); slabCueGain turns them
 *  into the engine's linear gain. */
export const SLAB_CUE_DB: Readonly<Record<SlabCue, number>> = {
  rifle_shot: 0, hit_confirm: -6, slab_tick: -14, slab_tick_enemy: -14, match_end_win: -4, match_end_lose: -4,
};
export const slabCueGain = (cue: SlabCue): number => 10 ** (SLAB_CUE_DB[cue] / 20);
/** Shots: full level within this many m, then inverse distance (sfx.gd SHOT_UNIT). */
export const SLAB_SHOT_REF = 4;
/** Shots past this many m are not played (sfx.gd SHOT_MAX_DIST). */
export const SLAB_SHOT_MAX = 80;

/** A cue to play: `at` = a world position (3D), absent = centred (2D). */
export interface SlabCuePlay { cue: SlabCue; at?: { x: number; y: number; z: number } }

/** The cue for one game event in a slab match (null: none of the four). */
export function slabEventCue(ev: GameEvent, localId: number): SlabCuePlay | null {
  if (ev.e === 'fire') return ev.id === localId ? { cue: 'rifle_shot' } : { cue: 'rifle_shot', at: { x: ev.x, y: ev.y, z: ev.z } };
  if (ev.e === 'hit' && ev.src === localId && ev.dst !== localId) return { cue: 'hit_confirm' };
  return null;
}

/**
 * The match cues, from the snapshot's MatchState (bus 'match', one per snapshot, before that snapshot's events): a tick
 * for each team whose score rose while the match was live, and the end sting on live -> ended (the last point and the
 * end come in one snapshot: tick, then sting, as Godot's slab_point then match_over). The first slab snapshot only sets
 * the baseline (joining mid-match plays nothing); a rematch (ended -> live, 0-0) plays nothing; another mode resets.
 */
export class SlabMatchCues {
  private last: { phase: string; score: [number, number] } | null = null;

  /** True while the latest MatchState is a slab match. */
  get active(): boolean { return this.last !== null; }

  /** The cues this snapshot brings, in order. `myTeam`: your side (0 Corgi Company, 1 Cat Cadre). */
  update(ms: MatchState, myTeam: number): SlabCue[] {
    if (ms.mode !== 'slab') { this.last = null; return []; }
    const prev = this.last;
    this.last = { phase: ms.phase, score: [ms.score[0], ms.score[1]] };
    if (!prev || prev.phase !== 'live') return [];
    const out: SlabCue[] = [];
    for (const t of [0, 1] as const) if (ms.score[t] > prev.score[t]) out.push(t === myTeam ? 'slab_tick' : 'slab_tick_enemy');
    if (ms.phase === 'ended') out.push(ms.winner !== -1 && ms.winner === myTeam ? 'match_end_win' : 'match_end_lose');
    return out;
  }
}

type Fetch = (url: string) => Promise<{ ok: boolean; status?: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/**
 * The six files, fetched and decoded once (on the first slab match with a live AudioContext). get() is undefined while
 * a file loads and null when it is missing or does not decode: one console warning lists those, and they stay silent.
 */
export class SlabSamples {
  private buffers = new Map<SlabCue, AudioBuffer | null>();
  private recipes = new Map<SlabCue, Recipe>();
  private started = false;
  constructor(private base = SLAB_AUDIO_BASE, private fetcher: Fetch = (u) => fetch(u)) {}

  get loading(): boolean { return this.started && this.buffers.size < SLAB_CUES.length; }

  load(ctx: BaseAudioContext): Promise<void> {
    if (this.started) return Promise.resolve();
    this.started = true;
    const failed: SlabCue[] = [];
    return Promise.all(SLAB_CUES.map(async (cue) => {
      try {
        const r = await this.fetcher(this.base + SLAB_CUE_FILE[cue]);
        if (!r.ok) throw new Error(`HTTP ${r.status ?? '?'}`);
        const buf = await ctx.decodeAudioData(await r.arrayBuffer());
        this.buffers.set(cue, buf);
        this.recipes.set(cue, sampleRecipe(buf));
      } catch {
        this.buffers.set(cue, null);
        failed.push(cue);
      }
    })).then(() => {
      if (failed.length) console.warn(`[audio] slab cues: no playable file for ${failed.join(', ')} under ${this.base}; those cues stay silent`);
    });
  }

  get(cue: SlabCue): AudioBuffer | null | undefined { return this.buffers.get(cue); }
  /** The cue as an engine recipe (one per file, made once). */
  recipe(cue: SlabCue): Recipe | undefined { return this.recipes.get(cue); }
}

/** A decoded file as an engine recipe: one buffer source into the voice, its length as the voice's duration. */
export function sampleRecipe(buf: AudioBuffer): Recipe {
  return (v) => {
    const s = v.ctx.createBufferSource();
    s.buffer = buf;
    s.connect(v.out);
    s.start(v.t);
    s.stop(v.t + buf.duration + 0.05);
    return buf.duration;
  };
}
