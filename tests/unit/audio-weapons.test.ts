// X3: weapon sound through createAudio — each weapon's HARDENED report, your own brass, impacts by surface that wait
// for the tracer (same timing as the visual impact), the shooter's hit thud and kill thump. Strict fake AudioContext.
import { afterEach, describe, expect, it } from 'vitest';
import { createAudio } from '../../src/client/audio';
import * as S from '../../src/client/audio/presets';
import { byId, fakeCtx } from './audio-fakes';
import { EntityKind } from '../../src/shared/types';
import { weaponIndex } from '../../src/shared/content/weapons';
import type { EntityState, GameEvent } from '../../src/shared/protocol';
import { impactDelay } from '../../src/client/fx/delays';
import { Surface } from '../../src/client/fx/surfaces';

const g = globalThis as unknown as { AudioContext?: unknown; window?: unknown };
const saved = { AudioContext: g.AudioContext, window: g.window };
afterEach(() => { g.AudioContext = saved.AudioContext; g.window = saved.window; });

async function rig() {
  const f = fakeCtx();
  g.AudioContext = function FakeAudioContext() { return f.ctx; };
  g.window = { addEventListener() {}, removeEventListener() {} };
  const audio = createAudio({ autoUnlock: false, music: false });
  expect(await audio.unlock()).toBe(true);
  const plays: { r: S.Recipe; o: Record<string, unknown> }[] = [];
  const real = audio.engine.play.bind(audio.engine);
  audio.engine.play = (r, o = {}) => { plays.push({ r, o: o as Record<string, unknown> }); return real(r, o); };
  const listener = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.5, 0, 1] } } as never;
  return { f, audio, plays, listener };
}
const pet = (id: number, x = 0, z = 0): EntityState => ({ id, kind: EntityKind.Player, team: 0, species: 0, cls: 0, seed: id, x, y: 0, z, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 120, maxHp: 120, anim: 0, flags: 1, weapon: 0, ammo: 30 });
const fire = (id: number, wpn: string, hz = -12, hit = -1): GameEvent => ({ e: 'fire', id, wpn: weaponIndex(wpn), x: 0, y: 1, z: 0, dx: 0, dy: 0, dz: -1, hx: 0, hy: 0.02, hz, hit });

describe('weapon audio (X3)', () => {
  it('plays each weapon its own report; local shots are 2D and drop brass, remote shots are spatial', async () => {
    const { audio, plays, listener } = await rig();
    audio.update(listener, byId([pet(1), pet(2, 3, -4)]), 1, 1 / 60);
    const map: [string, S.Recipe][] = [['squeaker_rifle', S.rifleShot], ['snap_pistol', S.pistolShot], ['laser_longshot', S.sniperShot],
      ['tennis_mortar', S.mortarShot], ['sprinkler_cannon', S.shotgunBlast], ['frisbee_launcher', S.discLaunch]];
    for (const [w, r] of map) {
      plays.length = 0;
      audio.onGameEvent(fire(2, w, -300)); // far miss: no impact sound
      expect(plays[0].r, w).toBe(r);
      expect(plays[0].o.x, w).toBe(0); // spatial at the shooter
      expect(plays.some((p) => p.r === S.brassTinkle), w).toBe(false); // someone else's brass is noise
    }
    plays.length = 0;
    audio.onGameEvent(fire(1, 'squeaker_rifle', -300));
    expect(plays[0].r).toBe(S.rifleShot);
    expect(plays[0].o.x).toBeUndefined(); // your own gun: centered
    expect(plays.find((p) => p.r === S.brassTinkle)?.o).toMatchObject({ k: 0 });
    plays.length = 0;
    audio.onGameEvent(fire(1, 'sprinkler_cannon', -300));
    expect(plays.find((p) => p.r === S.brassTinkle)?.o).toMatchObject({ k: 1 }); // a plastic hull, not brass
    plays.length = 0;
    audio.onGameEvent(fire(1, 'tennis_mortar', -300));
    expect(plays.some((p) => p.r === S.brassTinkle)).toBe(false); // no casing
    audio.dispose();
  });

  it('bullet impacts sound like the surface and land when the tracer does (throttled)', async () => {
    const { audio, plays, listener } = await rig();
    audio.setWorld({ height: () => 0, props: [{ type: 'car', x: 0, y: 1, z: -8, hx: 1, hy: 1, hz: 0.1, rotY: 0 }] });
    audio.update(listener, byId([pet(1)]), 1, 1 / 60);
    audio.onGameEvent({ ...fire(2, 'squeaker_rifle'), hx: 0, hy: 1, hz: -7.9 } as GameEvent);
    const imp = plays.find((p) => p.r === S.impactSfx)!;
    expect(imp.o.k).toBe(Surface.Metal);
    const d = Math.hypot(0, 1 - 1, -7.9);
    expect(imp.o.delay as number).toBeCloseTo(impactDelay('bullet', d), 5);
    expect(imp.o.delay as number).toBeGreaterThan(0.03);
    // a second impact on the same frame is throttled (texture, not a wall of pings)
    const n = plays.filter((p) => p.r === S.impactSfx).length;
    audio.onGameEvent({ ...fire(2, 'squeaker_rifle'), hz: -6 } as GameEvent);
    expect(plays.filter((p) => p.r === S.impactSfx).length).toBe(n);
    // ground hit after the gap: grass thud
    audio.update(listener, byId([pet(1)]), 1, 0.1);
    audio.onGameEvent(fire(2, 'squeaker_rifle', -6));
    expect(plays.filter((p) => p.r === S.impactSfx).pop()!.o.k).toBe(Surface.Grass);
    // the voice really starts later on the audio clock
    audio.dispose();
  });

  it('the shooter hears a body thud on hits (crit: + tink), a kill thump + sting; victims get the thwack', async () => {
    const { audio, plays, listener } = await rig();
    audio.update(listener, byId([pet(1), pet(2, 0, -5)]), 1, 1 / 60);
    audio.onGameEvent({ e: 'hit', src: 1, dst: 2, dmg: 15, x: 0, y: 1, z: -5, crit: false });
    expect(plays.map((p) => p.r)).toEqual([S.thwack, S.hitThud]);
    expect(plays[1].o).toMatchObject({ bus: 'ui', k: 0 });
    plays.length = 0;
    audio.onGameEvent({ e: 'hit', src: 1, dst: 2, dmg: 24, x: 0, y: 1, z: -5, crit: true });
    expect(plays[1].o).toMatchObject({ k: 1 });
    plays.length = 0;
    audio.onGameEvent({ e: 'death', id: 2, by: 1 });
    expect(plays.find((p) => p.r === S.hitThud)?.o).toMatchObject({ k: 2 });
    expect(plays.some((p) => p.r === S.sting)).toBe(true);
    plays.length = 0;
    audio.onGameEvent({ e: 'hit', src: 2, dst: 1, dmg: 15, x: 0, y: 1, z: 0, crit: false });
    expect(plays.map((p) => p.r)).toEqual([S.thwack]); // taking a hit: no confirmation thud
    audio.dispose();
  });

  it('PlayOptions.delay starts the voice later on the audio clock', async () => {
    const { f, audio } = await rig();
    const n0 = f.nodes.length;
    audio.engine.play(S.impactSfx, { k: Surface.Wood, delay: 0.2 });
    const started = f.nodes.slice(n0).filter((n) => n.kind === 'src' || n.kind === 'osc').map((n) => n.started);
    expect(started.length).toBeGreaterThan(0);
    expect(Math.min(...started)).toBeGreaterThanOrEqual(0.2);
    audio.dispose();
  });
});
