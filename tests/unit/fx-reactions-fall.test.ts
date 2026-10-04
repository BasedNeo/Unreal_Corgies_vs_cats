// W15 (lead's fix round): a fall is a death with `by: -1`. With no local pet (me -1: a spectator, the menu) the camera
// must not get the kill shake, hit-stop and FOV punch as if you had made the kill (src/client/fx/reactions.ts).
import { describe, expect, it } from 'vitest';
import { makeReaction, reactionFor, REACT, type ReactionContext } from '../../src/client/fx/reactions';

const ctx = (localId: number): ReactionContext => ({ localId, lx: 0, ly: 0, lz: 0, hasLocal: localId >= 0, weaponOf: () => 'squeaker_rifle' });

describe('a death by -1 (a fall) is nobody\'s kill', () => {
  it('with no local pet (me -1) it does nothing to the camera', () => {
    const r = reactionFor({ e: 'death', id: 5, by: -1 }, ctx(-1), makeReaction());
    expect(r).toEqual(makeReaction());
  });

  it('while you play, a fall is not your kill; your own kill still shakes, stops and punches', () => {
    expect(reactionFor({ e: 'death', id: 5, by: -1 }, ctx(1), makeReaction())).toEqual(makeReaction());
    const k = reactionFor({ e: 'death', id: 5, by: 1 }, ctx(1), makeReaction()); // the control
    expect([k.shake, k.hitStopFrames, k.fovPunch]).toEqual([REACT.killDealtShake, REACT.killDealtStop, REACT.killPunch]);
    expect(reactionFor({ e: 'death', id: 1, by: -1 }, ctx(1), makeReaction()).shake).toBe(REACT.deathSelfShake); // your own fall
  });
});
