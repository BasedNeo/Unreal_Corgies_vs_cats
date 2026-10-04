// W15 (lead's fix round): a fall is a death with `by: -1`. With no local pet (localId -1: a spectator, the menu) it
// must not play the kill thump and the kill sting as if you had made the kill (src/client/audio/index.ts 'death').
import { afterEach, describe, expect, it } from 'vitest';
import { createAudio, type GameAudio } from '../../src/client/audio';
import * as S from '../../src/client/audio/presets';
import { EntityKind } from '../../src/shared/types';
import type { EntityState } from '../../src/shared/protocol';
import { byId, fakeCtx } from './audio-fakes';

const g = globalThis as unknown as { AudioContext?: unknown; window?: unknown };
const saved = { AudioContext: g.AudioContext, window: g.window };
const live = new Set<GameAudio>();
afterEach(() => { for (const a of live) a.dispose(); live.clear(); g.AudioContext = saved.AudioContext; g.window = saved.window; });

const pet = (id: number): EntityState => ({ id, kind: EntityKind.Player, team: 1, species: 1, cls: 0, seed: id, x: 3, y: 0, z: -4, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 0, maxHp: 120, anim: 0, flags: 1, weapon: 0, ammo: 30 });
const listener = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.5, 0, 1] } } as never;

/** createAudio on the strict fake AudioContext, unlocked, its plays recorded; `localId` is who you are (-1: nobody). */
async function rig(localId: number) {
  const f = fakeCtx();
  g.AudioContext = function FakeAudioContext() { return f.ctx; };
  g.window = { addEventListener() {}, removeEventListener() {} };
  const audio = createAudio({ autoUnlock: false, music: false });
  live.add(audio);
  expect(await audio.unlock()).toBe(true);
  const plays: { r: S.Recipe; o: Record<string, unknown> }[] = [];
  const real = audio.engine.play.bind(audio.engine);
  audio.engine.play = (r, o = {}) => { plays.push({ r, o: o as Record<string, unknown> }); return real(r, o); };
  audio.update(listener, byId(localId >= 0 ? [pet(5), { ...pet(localId), team: 0, species: 0 }] : [pet(5)]), localId, 1 / 60);
  return { audio, plays };
}
const killThump = (p: { r: S.Recipe; o: Record<string, unknown> }) => p.r === S.hitThud && p.o.k === 2;
const killSting = (p: { r: S.Recipe; o: Record<string, unknown> }) => p.r === S.sting && p.o.k === 0;

describe('a death by -1 (a fall) is nobody\'s kill', () => {
  it('with no local pet (localId -1) it plays the poof at the victim, and no kill thump or kill sting', async () => {
    const { audio, plays } = await rig(-1);
    audio.onGameEvent({ e: 'death', id: 5, by: -1 });
    expect(plays.some((p) => p.r === S.poof)).toBe(true); // the death itself still sounds
    expect(plays.filter(killThump), 'kill thump').toEqual([]);
    expect(plays.filter(killSting), 'kill sting').toEqual([]);
  });

  it('a fall while you play is no kill of yours either; your own kill still thumps and stings', async () => {
    const { audio, plays } = await rig(1);
    audio.onGameEvent({ e: 'death', id: 5, by: -1 });
    expect(plays.some(killThump) || plays.some(killSting)).toBe(false);
    plays.length = 0;
    audio.onGameEvent({ e: 'death', id: 5, by: 1 }); // the control: you took the Cat down
    expect(plays.some(killThump)).toBe(true);
    expect(plays.some(killSting)).toBe(true);
  });
});
