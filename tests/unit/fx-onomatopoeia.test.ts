// L5: comic word picker per event type, cooldowns, and camera/hit-stop reactions.
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/shared/protocol';
import { Species } from '../../src/shared/types';
import { OnomatopoeiaPicker, WORDS, type WordContext } from '../../src/client/fx/onomatopoeia';
import { HitStop, REACT, reactionFor, type ReactionContext } from '../../src/client/fx/reactions';
import { WeaponTable } from '../../src/client/fx/weapon-fx';

const weapons = new WeaponTable();
function ctx(over: Partial<WordContext> = {}): WordContext {
  return { localId: 1, now: 0, speciesOf: (id) => (id >= 100 ? Species.Cat : Species.Corgi), weaponOf: (w) => weapons.id(w), rand: () => 0, ...over };
}

describe('onomatopoeia picker', () => {
  it('maps each event type to its word', () => {
    const p = new OnomatopoeiaPicker();
    const c = ctx();
    const pick = (ev: GameEvent) => p.pick(ev, c)?.word ?? null;
    expect(pick({ e: 'explode', x: 0, y: 0, z: 0, r: 3, by: 1 })).toBe('KA-BOOM!');
    expect(pick({ e: 'death', id: 100, by: 1 })).toBe('KO!');   // local got the kill
    expect(pick({ e: 'death', id: 101, by: 7 })).toBe('POOF!');  // someone else's kill
    expect(['POW!', 'BONK!']).toContain(pick({ e: 'hit', src: 1, dst: 102, dmg: 10, x: 0, y: 0, z: 0, crit: true }));
    expect(pick({ e: 'hit', src: 1, dst: 103, dmg: 30, x: 0, y: 0, z: 0, crit: false })).toBe('SPLAT!');
    expect(pick({ e: 'hit', src: 1, dst: 104, dmg: 5, x: 0, y: 0, z: 0, crit: false })).toBeNull(); // chip damage: no word
    expect(pick({ e: 'jump', id: 5, double: true })).toBe('BOING!');
    expect(pick({ e: 'jump', id: 6, double: false })).toBeNull();
    expect(pick({ e: 'land', id: 7, impact: 18 })).toBe('THWUMP!');
    expect(pick({ e: 'land', id: 8, impact: 6 })).toBeNull();
    expect(p.pick({ e: 'bark', id: 9, line: 'arf' }, ctx({ rand: () => 0.9 }))?.word).toBe('BARK!');  // corgi
    expect(p.pick({ e: 'bark', id: 109, line: 'hss' }, ctx({ rand: () => 0.9 }))?.word).toBe('HISS!'); // cat
    expect(p.pick({ e: 'bark', id: 10, line: 'arf' }, ctx({ rand: () => 0.1 }))?.word).toBe('WOOF!');  // corgi variant
    expect(p.pick({ e: 'bark', id: 110, line: 'mrr' }, ctx({ rand: () => 0.1 }))?.word).toBe('MROW!'); // cat variant
    expect(pick({ e: 'pickup', id: 1, item: 'kibble' })).toBe('YOINK!');
    expect(pick({ e: 'pickup', id: 2, item: 'kibble' })).toBeNull();
    expect(pick({ e: 'ability', id: 3, ability: 'bark_blast', x: 0, y: 0, z: 0 })).toBe('BARK!');
    expect(pick({ e: 'score', team: 0, pts: 1, reason: 'kill' })).toBeNull();
    expect(pick({ e: 'reload', id: 1 })).toBeNull();
    expect(pick({ e: 'spawn', id: 1 })).toBeNull();
  });

  it('picks a word per weapon on fire (laser → ZAP!, mortar → THWUMP!, rifle → SQUEAK!)', () => {
    const p = new OnomatopoeiaPicker();
    const fire = (id: number, wpn: number): GameEvent => ({ e: 'fire', id, wpn, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: -1, hx: 0, hy: 0, hz: -5, hit: -1 });
    const c = ctx();
    expect(p.pick(fire(1, 0), c)?.word).toBe('SQUEAK!');
    expect(p.pick(fire(2, 2), c)?.word).toBe('ZAP!');
    expect(p.pick(fire(3, 3), c)?.word).toBe('THWUMP!');
    expect(p.pick(fire(4, 4), c)?.word).toBe('FSSHH!');
    expect(p.pick(fire(5, 5), c)?.word).toBe('WHOOSH!');
  });

  it('rate-limits per entity so rapid fire does not spam words', () => {
    const p = new OnomatopoeiaPicker();
    const fire: GameEvent = { e: 'fire', id: 1, wpn: 0, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: -1, hx: 0, hy: 0, hz: -5, hit: -1 };
    let words = 0;
    for (let i = 0; i < 60; i++) if (p.pick(fire, ctx({ now: i * 0.1 }))) words++; // 6 s of 10 shots/s
    expect(words).toBeGreaterThanOrEqual(2);
    expect(words).toBeLessThanOrEqual(3); // 2.5 s cooldown
  });

  it('every word has an atlas slot', () => {
    expect(new Set(WORDS).size).toBe(WORDS.length);
    expect(WORDS.length).toBeLessThanOrEqual(32); // 4×8 atlas cells
  });
});

describe('camera trauma + hit-stop reactions', () => {
  const rc = (over: Partial<ReactionContext> = {}): ReactionContext => ({ localId: 1, lx: 0, ly: 0, lz: 0, hasLocal: true, weaponOf: (w) => weapons.id(w), ...over });

  it('shakes on hits taken (scaled by damage) and explosions (by distance)', () => {
    const small = reactionFor({ e: 'hit', src: 2, dst: 1, dmg: 5, x: 0, y: 0, z: 0, crit: false }, rc()).shake;
    const big = reactionFor({ e: 'hit', src: 2, dst: 1, dmg: 60, x: 0, y: 0, z: 0, crit: false }, rc()).shake;
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(REACT.hitTakenMax);
    const near = reactionFor({ e: 'explode', x: 1, y: 0, z: 0, r: 3, by: 2 }, rc()).shake;
    const far = reactionFor({ e: 'explode', x: 9, y: 0, z: 0, r: 3, by: 2 }, rc()).shake;
    const outOfRange = reactionFor({ e: 'explode', x: 40, y: 0, z: 0, r: 3, by: 2 }, rc()).shake;
    expect(near).toBeGreaterThan(far);
    expect(outOfRange).toBe(0);
  });

  it('asks for 3–5 frames of hit-stop on crits and kills by the local player only', () => {
    expect(reactionFor({ e: 'hit', src: 1, dst: 2, dmg: 30, x: 0, y: 0, z: 0, crit: true }, rc()).hitStopFrames).toBe(3);
    expect(reactionFor({ e: 'death', id: 2, by: 1 }, rc()).hitStopFrames).toBe(5);
    expect(reactionFor({ e: 'hit', src: 3, dst: 2, dmg: 30, x: 0, y: 0, z: 0, crit: true }, rc()).hitStopFrames).toBe(0);
    expect(reactionFor({ e: 'death', id: 2, by: 3 }, rc()).hitStopFrames).toBe(0);
  });

  it('HitStop freezes presentation for N/60 s then eases back to 1', () => {
    const h = new HitStop();
    expect(h.scale).toBe(1);
    h.request(3);
    expect(h.scale).toBe(HitStop.FROZEN);
    h.update(0.04); // 2.4 frames
    expect(h.scale).toBe(HitStop.FROZEN);
    h.update(0.02); // hold over → recovering
    expect(h.scale).toBeLessThan(1);
    h.update(0.1);
    expect(h.scale).toBe(1);
  });
});
