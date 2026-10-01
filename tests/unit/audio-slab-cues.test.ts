// W13 A-HOOK: the slab match's cues in the browser (src/client/audio/slab-cues.ts), the twin of Godot's
// engines/godot/game/sfx.gd. Which cue for which event (no audio device), the same files and levels as sfx.gd, and,
// through createAudio on the strict fake AudioContext, the shared file in place of the synth shot in slab mode only,
// and no music bed while a slab match runs (Godot has none).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SLAB_CUES, SLAB_CUE_DB, SLAB_CUE_FILE, SLAB_SHOT_MAX, SLAB_SHOT_REF, SlabMatchCues, SlabSamples, slabEventCue, type SlabCue } from '../../src/client/audio/slab-cues';
import type { GameEvent, MatchState } from '../../src/shared/protocol';
import { createAudio } from '../../src/client/audio';
import * as S from '../../src/client/audio/presets';
import { Music } from '../../src/client/audio/music';
import { bus } from '../../src/client/core/events';
import { EntityKind } from '../../src/shared/types';
import { weaponIndex } from '../../src/shared/content/weapons';
import type { EntityState } from '../../src/shared/protocol';
import { byId, fakeCtx } from './audio-fakes';

const fire = (id: number): GameEvent => ({ e: 'fire', id, wpn: weaponIndex('squeaker_rifle'), x: 3, y: 1, z: -4, dx: 0, dy: 0, dz: -1, hx: 0, hy: 0, hz: -300, hit: -1 });
const hit = (src: number, dst: number): GameEvent => ({ e: 'hit', src, dst, dmg: 15, x: 0, y: 1, z: -5, crit: false });
const ms = (o: Partial<MatchState>): MatchState => ({ mode: 'slab', phase: 'live', timeLeft: 100, score: [0, 0], objective: '', wave: 0, winner: -1, ...o });

describe('slab cues: which cue for which event', () => {
  it('a shot is the rifle_shot (yours centred, anyone else\'s at the muzzle); your landed shot is the hit_confirm', () => {
    expect(slabEventCue(fire(1), 1)).toEqual({ cue: 'rifle_shot' });
    expect(slabEventCue(fire(2), 1)).toEqual({ cue: 'rifle_shot', at: { x: 3, y: 1, z: -4 } });
    expect(slabEventCue(hit(1, 2), 1)).toEqual({ cue: 'hit_confirm' });
    expect(slabEventCue(hit(2, 1), 1)).toBeNull(); // you were hit: not your confirm
    expect(slabEventCue(hit(2, 3), 1)).toBeNull(); // someone else's hit
    expect(slabEventCue(hit(1, 1), 1)).toBeNull(); // your own blast
    expect(slabEventCue({ e: 'score', team: 0, pts: 0, reason: 'win' }, 1)).toBeNull();
    expect(slabEventCue({ e: 'spawn', id: 1 }, 1)).toBeNull();
  });

  it('a point for your side ticks, the other side\'s ticks enemy; the end is win or lose (a draw loses)', () => {
    const c = new SlabMatchCues();
    expect(c.update(ms({ score: [4, 7] }), 0)).toEqual([]); // the first snapshot is only the baseline (joined mid-match)
    expect(c.active).toBe(true);
    expect(c.update(ms({ score: [4, 7] }), 0)).toEqual([]);
    expect(c.update(ms({ score: [5, 7] }), 0)).toEqual(['slab_tick']);
    expect(c.update(ms({ score: [5, 8] }), 0)).toEqual(['slab_tick_enemy']);
    expect(c.update(ms({ score: [5, 10] }), 0)).toEqual(['slab_tick_enemy']); // two points in one snapshot: one tick
    // you are a Cat: the same points flip
    expect(c.update(ms({ score: [6, 10] }), 1)).toEqual(['slab_tick_enemy']);
    expect(c.update(ms({ score: [6, 11] }), 1)).toEqual(['slab_tick']);
    // the last point and the end in one snapshot: tick, then the sting (Godot: slab_point, then match_over)
    expect(c.update(ms({ score: [6, 60], phase: 'ended', winner: 1 }), 1)).toEqual(['slab_tick', 'match_end_win']);
    expect(c.update(ms({ score: [6, 60], phase: 'ended', winner: 1 }), 1)).toEqual([]); // the result holds: once
    // rematch: 0-0 and live again, nothing plays
    expect(c.update(ms({ score: [0, 0] }), 0)).toEqual([]);
    expect(c.update(ms({ score: [0, 0], phase: 'ended', winner: 1 }), 0)).toEqual(['match_end_lose']); // the time ran out
    expect(c.update(ms({ score: [0, 0] }), 0)).toEqual([]);
    expect(c.update(ms({ score: [0, 0], phase: 'ended', winner: -1 }), 0)).toEqual(['match_end_lose']); // a draw
  });

  it('plays nothing outside slab mode, and a new slab match starts from a fresh baseline', () => {
    const c = new SlabMatchCues();
    expect(c.update(ms({ mode: 'team-deathmatch' }), 0)).toEqual([]);
    expect(c.update(ms({ mode: 'team-deathmatch', score: [3, 0] }), 0)).toEqual([]);
    expect(c.update(ms({ mode: 'team-deathmatch', phase: 'ended', winner: 0 }), 0)).toEqual([]);
    expect(c.active).toBe(false);
    expect(c.update(ms({ score: [20, 0] }), 0)).toEqual([]);
    expect(c.update(ms({ score: [21, 0] }), 0)).toEqual(['slab_tick']);
  });

  it('uses the same files, levels and shot range as Godot\'s sfx.gd', () => {
    const gd = readFileSync('engines/godot/game/sfx.gd', 'utf8');
    const block = (name: string) => gd.slice(gd.indexOf(`const ${name} := {`), gd.indexOf('}', gd.indexOf(`const ${name} := {`)));
    const files = Object.fromEntries([...block('CUES').matchAll(/"(\w+)": "([\w.]+)"/g)].map((m) => [m[1], m[2]]));
    const db = Object.fromEntries([...block('VOLUME_DB').matchAll(/"(\w+)": (-?[\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(files).toEqual(SLAB_CUE_FILE);
    expect(db).toEqual(SLAB_CUE_DB);
    expect(Number(/const SHOT_UNIT := ([\d.]+)/.exec(gd)?.[1])).toBe(SLAB_SHOT_REF);
    expect(Number(/const SHOT_MAX_DIST := ([\d.]+)/.exec(gd)?.[1])).toBe(SLAB_SHOT_MAX);
    for (const cue of SLAB_CUES) expect(SLAB_CUE_FILE[cue]).toBe(`synth_${cue}.wav`);
  });
});

// ---------------------------------------------------------------- through createAudio (strict fake AudioContext)

const g = globalThis as unknown as { AudioContext?: unknown; window?: unknown; fetch?: unknown; location?: unknown };
const saved = { AudioContext: g.AudioContext, window: g.window, fetch: g.fetch, location: g.location };
afterEach(() => { g.AudioContext = saved.AudioContext; g.window = saved.window; g.fetch = saved.fetch; g.location = saved.location; vi.restoreAllMocks(); });

const pet = (id: number, team: 0 | 1, x = 0, z = 0): EntityState => ({ id, kind: EntityKind.Player, team, species: team, cls: 0, seed: id, x, y: 0, z, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 120, maxHp: 120, anim: 0, flags: 1, weapon: 0, ammo: 30 });

async function rig(missing: SlabCue[] = [], o: { music?: boolean; before?: () => void } = {}) {
  const f = fakeCtx();
  const decoded: string[] = [];
  Object.assign(f.ctx, { decodeAudioData: async (b: ArrayBuffer) => { decoded.push(new TextDecoder().decode(b)); return { duration: 0.2, length: 8820, sampleRate: 44100, numberOfChannels: 1, tag: new TextDecoder().decode(b) }; } });
  g.AudioContext = function FakeAudioContext() { return f.ctx; };
  g.window = { addEventListener() {}, removeEventListener() {} };
  const urls: string[] = [];
  g.fetch = async (u: string) => {
    urls.push(u);
    const ok = !missing.some((c) => u.endsWith(SLAB_CUE_FILE[c]));
    return { ok, status: ok ? 200 : 404, arrayBuffer: async () => new TextEncoder().encode(u.split('/').pop()!).buffer };
  };
  const audio = createAudio({ autoUnlock: false, music: o.music ?? false });
  o.before?.();
  expect(await audio.unlock()).toBe(true);
  const plays: { r: S.Recipe; o: Record<string, unknown> }[] = [];
  const real = audio.engine.play.bind(audio.engine);
  audio.engine.play = (r, o = {}) => { plays.push({ r, o: o as Record<string, unknown> }); return real(r, o); };
  const listener = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.5, 0, 1] } } as never;
  audio.update(listener, byId([pet(1, 0), pet(2, 1, 3, -4)]), 1, 1 / 60);
  return { f, audio, plays, urls, decoded };
}
/** The file a play used (its buffer source's buffer tag), or '' for a synth recipe. */
const fileOf = (f: ReturnType<typeof fakeCtx>, from: number) => {
  const src = f.nodes.slice(from).find((n) => n.kind === 'src' && (n.buffer as { tag?: string } | null)?.tag);
  return (src?.buffer as { tag?: string } | undefined)?.tag ?? '';
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('slab cues through createAudio', () => {
  it('outside slab mode the web keeps its synth shot and loads no file', async () => {
    const { audio, plays, urls } = await rig();
    bus.emit('match', ms({ mode: 'team-deathmatch' }));
    await settle();
    audio.onGameEvent(fire(2));
    expect(plays[0].r).toBe(S.rifleShot);
    expect(urls).toEqual([]);
    audio.dispose();
  });

  it('in slab mode the shot, the hit confirm, the ticks and the end play the shared files', async () => {
    const { f, audio, plays, urls } = await rig();
    bus.emit('match', ms({ score: [0, 0] }));
    await settle(); await settle();
    expect(urls.sort()).toEqual(SLAB_CUES.map((c) => `/assets/audio/${SLAB_CUE_FILE[c]}`).sort());
    const at = () => f.nodes.length;
    let n = at();
    audio.onGameEvent(fire(2)); // the Cat's shot: at its muzzle, the Godot range
    expect(plays.some((p) => p.r === S.rifleShot)).toBe(false);
    expect(fileOf(f, n)).toBe('synth_rifle_shot.wav');
    expect(plays[0].o).toMatchObject({ x: 3, y: 1, z: -4, refDist: SLAB_SHOT_REF, maxDist: SLAB_SHOT_MAX });
    plays.length = 0; n = at();
    audio.onGameEvent(fire(1)); // yours: centred
    expect(plays[0].o.x).toBeUndefined();
    expect(fileOf(f, n)).toBe('synth_rifle_shot.wav');
    expect(plays.some((p) => p.r === S.brassTinkle)).toBe(true); // the rest of the web's gun sound stays
    plays.length = 0; n = at();
    audio.onGameEvent(hit(1, 2));
    expect(plays.some((p) => p.r === S.hitThud)).toBe(false);
    expect(fileOf(f, n)).toBe('synth_hit_confirm.wav');
    for (const [score, file] of [[[1, 0], 'synth_slab_tick.wav'], [[1, 1], 'synth_slab_tick_enemy.wav']] as const) {
      n = at();
      bus.emit('match', ms({ score: [score[0], score[1]] }));
      expect(fileOf(f, n)).toBe(file);
    }
    plays.length = 0; n = at();
    bus.emit('match', ms({ score: [2, 1], phase: 'ended', winner: 0 }));
    audio.onGameEvent({ e: 'score', team: 0, pts: 0, reason: 'win' }); // the generic team sting stays out of it
    expect(plays.some((p) => p.r === S.sting)).toBe(false);
    expect(f.nodes.slice(n).filter((x) => x.kind === 'src').map((x) => (x.buffer as { tag: string }).tag)).toEqual(['synth_slab_tick.wav', 'synth_match_end_win.wav']);
    audio.dispose();
  });

  it('a missing file: one warning, that cue silent (the shot falls back to the synth), the rest still play', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { f, audio, plays } = await rig(['rifle_shot', 'slab_tick']);
    bus.emit('match', ms({ score: [0, 0] }));
    await settle(); await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('rifle_shot, slab_tick');
    audio.onGameEvent(fire(2));
    expect(plays[0].r).toBe(S.rifleShot);
    const n = f.nodes.length;
    bus.emit('match', ms({ score: [1, 0] })); // your tick: no file, silent
    expect(fileOf(f, n)).toBe('');
    bus.emit('match', ms({ score: [1, 1] }));
    expect(fileOf(f, n)).toBe('synth_slab_tick_enemy.wav');
    audio.dispose();
  });

  it('loads the files once per page, not per snapshot', async () => {
    const { audio, urls } = await rig();
    for (let i = 0; i < 5; i++) bus.emit('match', ms({}));
    await settle();
    expect(urls.length).toBe(SLAB_CUES.length);
    audio.dispose();
    const s = new SlabSamples('/x/', async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));
    expect(s.get('rifle_shot')).toBeUndefined();
  });

  it('no music bed in slab mode: it never starts there, stops on the way in and starts again on the way out', async () => {
    const start = vi.spyOn(Music.prototype, 'start').mockImplementation(() => {});
    const stop = vi.spyOn(Music.prototype, 'stop').mockImplementation(() => {});
    // a slab page: the match state comes before the first gesture builds the music
    const a = await rig([], { music: true, before: () => bus.emit('match', ms({})) });
    expect(start).not.toHaveBeenCalled();
    bus.emit('match', ms({ mode: 'team-deathmatch' }));
    expect(start).toHaveBeenCalledTimes(1);
    a.audio.dispose();
    start.mockClear(); stop.mockClear();
    // another mode first (the music plays), then a slab match
    const b = await rig([], { music: true, before: () => bus.emit('match', ms({ mode: 'team-deathmatch' })) });
    expect(start).toHaveBeenCalledTimes(1);
    bus.emit('match', ms({}));
    expect(stop).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) bus.emit('match', ms({ score: [i, 0] }));
    expect(start).toHaveBeenCalledTimes(1); // not restarted per snapshot
    expect(stop).toHaveBeenCalledTimes(1);
    b.audio.dispose();
  });

  it('?sfxlog: one `SFX <cue>` console line per play, all six cues (W14 LISTEN evidence)', async () => {
    g.location = { search: '?mode=slab&sfxlog' };
    const lines: string[] = [];
    const real = console.log.bind(console);
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { if (String(a[0]).startsWith('SFX ')) lines.push(String(a[0])); else real(...a); });
    const { audio } = await rig();
    bus.emit('match', ms({ score: [0, 0] }));
    await settle(); await settle();
    audio.onGameEvent(fire(1)); // your shot
    audio.onGameEvent(fire(2)); // the Cat's shot, 5 m off
    audio.onGameEvent(hit(1, 2)); // yours lands
    bus.emit('match', ms({ score: [1, 0] })); // your point
    bus.emit('match', ms({ score: [1, 1] })); // theirs
    bus.emit('match', ms({ score: [2, 1], phase: 'ended', winner: 0 })); // your last point and the win
    bus.emit('match', ms({ score: [0, 0] })); // rematch
    bus.emit('match', ms({ score: [0, 1], phase: 'ended', winner: 1 })); // their last point and your loss
    real(lines.join('\n'));
    expect(lines).toEqual(['SFX rifle_shot', 'SFX rifle_shot', 'SFX hit_confirm', 'SFX slab_tick', 'SFX slab_tick_enemy', 'SFX slab_tick',
      'SFX match_end_win', 'SFX slab_tick_enemy', 'SFX match_end_lose']);
    audio.dispose();
  });
});
