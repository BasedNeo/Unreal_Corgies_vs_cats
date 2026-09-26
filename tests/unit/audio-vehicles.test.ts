// S2: vehicle engine loops (vehicle-loops.ts + presets-engines.ts), vehicle/destructible event voices and the
// adventure stingers (index.ts), on the strict tracking fake context in ./audio-fakes.ts. The steady-state
// allocation test is in audio-vehicles-alloc.test.ts (its own process).
import { afterEach, describe, expect, it } from 'vitest';
import type { EntityState, GameEvent } from '../../src/shared/protocol';
import { EFlag, EntityKind } from '../../src/shared/types';
import { packPlaneAux, unpackPlaneAux } from '../../src/shared/content/vehicles';
import { VoiceLimiter } from '../../src/client/audio/voice-limiter';
import { LOOPS, VehicleLoops, planeThrottle } from '../../src/client/audio/vehicle-loops';
import { KART_ENGINE, PLANE_ENGINE, kartEngine, planeEngine, type EngineParams } from '../../src/client/audio/presets-engines';
import { noise } from '../../src/client/audio/synth';
import * as S from '../../src/client/audio/presets';
import { abilitySfx, createAudio, SCORE_STINGERS } from '../../src/client/audio';
import { FNode, byId, expectNoLeaks, fakeCtx, host, next, oscs, p, run, vehicle } from './audio-fakes';

describe('S2 engine voices (strict context)', () => {
  it('kart and plane voices build, take every parameter combination and release without Web Audio errors', () => {
    const f = fakeCtx();
    const P: EngineParams = { now: 0, speed: 0, throttle: 0, boost: false, crouch: false, grounded: true, doppler: 1 };
    for (const build of [kartEngine, planeEngine]) {
      const v = build(f.ctx, 0.01, 0.37);
      expect(v.sources.length).toBeGreaterThan(0);
      expect(v.nodes.length).toBeLessThanOrEqual(24); // cheap: a couple of dozen nodes per vehicle at most
      for (const speed of [0, 3, 15, 27, 40, 1e3]) for (const throttle of [0, 0.5, 1, 7]) for (const bits of [0, 1, 2, 3, 4, 7]) {
        P.speed = speed; P.throttle = throttle; P.boost = !!(bits & 1); P.crouch = !!(bits & 2); P.grounded = !!(bits & 4); P.doppler = 0.82 + 0.1 * bits;
        f.ctx.currentTime += 0.03;
        P.now = f.ctx.currentTime;
        v.set(P);
      }
      v.release(P);
    }
  });

  it('kart firing rate follows speed (putt-putt at idle → buzz flat out → higher boosting)', () => {
    const f = fakeCtx();
    const v = kartEngine(f.ctx, 0, 0);
    const fire = oscs(f, 'custom')[0];
    const P: EngineParams = { now: 0, speed: 0, throttle: 0, boost: false, crouch: false, grounded: true, doppler: 1 };
    const rate = (o: Partial<EngineParams>) => { Object.assign(P, o); f.ctx.currentTime += 0.1; P.now = f.ctx.currentTime; v.set(P); return p(fire, 'frequency').lastTarget; };
    const idle = rate({ speed: 0 });
    const half = rate({ speed: KART_ENGINE.topSpeed / 2 });
    const top = rate({ speed: KART_ENGINE.topSpeed });
    const boost = rate({ boost: true });
    const air = rate({ boost: false, grounded: false });
    expect(idle).toBeCloseTo(KART_ENGINE.idleHz, 5);
    expect(half).toBeGreaterThan(idle);
    expect(top).toBeCloseTo(KART_ENGINE.topHz, 5);
    expect(boost).toBeGreaterThan(top);
    expect(air).toBeGreaterThan(top); // wheels spin free in the air
    expect(idle).toBeLessThan(14); // individual putts are audible at idle
  });

  it('plane pitch and brightness follow throttle and airspeed; boost adds the roar; a stall sputters', () => {
    const f = fakeCtx();
    const v = planeEngine(f.ctx, 0, 0);
    const buzz = oscs(f, 'sawtooth')[0];
    const tone = f.nodes.find((n) => n.kind === 'biquad' && n.type === 'lowpass' && p(n, 'frequency').value === PLANE_ENGINE.toneBase)!;
    const sputLfo = oscs(f, 'square').find((n) => p(n, 'frequency').value === PLANE_ENGINE.sputterHz)!;
    const sputDepth = next(sputLfo);
    const brown = noise(f.ctx, 'brown');
    const roar = next(next(f.nodes.find((n) => n.kind === 'src' && n.buffer === brown)!));
    const P: EngineParams = { now: 0, speed: 9, throttle: 0.2, boost: false, crouch: false, grounded: false, doppler: 1 };
    const at = (o: Partial<EngineParams>) => { Object.assign(P, o); f.ctx.currentTime += 0.1; P.now = f.ctx.currentTime; v.set(P); return { hz: p(buzz, 'frequency').lastTarget, tone: p(tone, 'frequency').lastTarget, roar: p(roar, 'gain').lastTarget, sput: p(sputDepth, 'gain').lastTarget }; };
    const slow = at({});
    const fast = at({ throttle: 1, speed: 20 });
    const boost = at({ boost: true, speed: 26 });
    const stall = at({ boost: false, crouch: true, throttle: 1, speed: 6 });
    const recovered = at({ crouch: false, speed: 20 });
    expect(fast.hz).toBeGreaterThan(slow.hz * 1.8);
    expect(fast.tone).toBeGreaterThan(slow.tone + 450);
    expect(fast.tone).toBeLessThanOrEqual(PLANE_ENGINE.toneMax);
    expect(boost.hz).toBeGreaterThan(fast.hz);
    expect(boost.roar).toBeCloseTo(PLANE_ENGINE.roarLevel, 5);
    expect(fast.roar || 0).toBe(0);
    expect(stall.sput).toBeGreaterThan(0.3);
    expect(stall.hz).toBeLessThan(fast.hz);
    expect(stall.roar).toBe(0);
    expect(recovered.sput).toBe(0);
  });

  it('planeThrottle matches unpackPlaneAux without allocating', () => {
    for (let t = 0; t <= 1; t += 0.05) for (const roll of [-0.9, 0, 0.4]) {
      const a = packPlaneAux(t, roll);
      expect(planeThrottle(a)).toBe(unpackPlaneAux(a).throttle);
    }
    expect(planeThrottle(Number.NaN)).toBe(unpackPlaneAux(Number.NaN).throttle);
  });
});

describe('S2 VoiceLimiter additions for continuous voices', () => {
  it('extend() renews a held voice and reports a stolen or released one', () => {
    const v = new VoiceLimiter(2, {});
    const a = v.acquire(0, 0.5, 0, 'engine')!;
    expect(v.extend(a.id, 3)).toBe(true);
    v.prune(1);
    expect(v.active).toBe(1); // renewed past its original end
    v.release(a.id);
    expect(v.extend(a.id, 5)).toBe(false);
  });

  it('acquire(canSteal = false) takes a free voice or nothing — never a victim', () => {
    const v = new VoiceLimiter(2, { engine: 1 });
    v.acquire(0, 5, 0, 'foot');
    expect(v.acquire(0, 5, 1, 'engine', false)).not.toBeNull();
    expect(v.acquire(0, 5, 1, 'engine', false)).toBeNull(); // category cap
    const w = new VoiceLimiter(2, {});
    w.acquire(0, 5, 0, 'foot'); w.acquire(0, 5, 0, 'foot');
    expect(w.acquire(0, 5, 3, 'engine', false)).toBeNull(); // global cap: the footsteps stay
    expect(w.countIn('foot')).toBe(2);
    expect(w.stats.stolen).toBe(0);
  });
});

describe('S2 vehicle loop manager', () => {
  it('a kart appears, speeds up and disappears: the loop starts, follows speed, fades and leaks nothing', () => {
    const f = fakeCtx();
    const limiter = new VoiceLimiter(28);
    const loops = new VehicleLoops(host(f, limiter), f.ctx, new FNode('sfx') as unknown as AudioNode);
    const kart = vehicle(10, { weapon: 5, z: 8 });
    const states = byId([kart]);
    run(f, loops, states, 0.5);
    expect(loops.debug()).toEqual([{ id: 10, plane: false, local: false, state: 'on' }]);
    expect(limiter.countIn('engine')).toBe(1);
    const fire = oscs(f, 'custom')[0];
    expect(p(fire, 'frequency').lastTarget).toBeCloseTo(KART_ENGINE.idleHz, 3);
    const level = f.nodes.find((n) => n.kind === 'panner')!;
    expect(level.refDistance).toBe(LOOPS.kartRef);
    kart.vx = KART_ENGINE.topSpeed; // position fixed: no doppler, pure speed → pitch
    run(f, loops, states, 0.5);
    expect(p(fire, 'frequency').lastTarget).toBeCloseTo(KART_ENGINE.topHz, 3);
    states.delete(10);
    run(f, loops, states, 0.1);
    expect(loops.debug()).toEqual([{ id: 10, plane: false, local: false, state: 'off' }]); // fading
    run(f, loops, states, 1);
    expectNoLeaks(f, loops, limiter);
    expect(loops.stats).toMatchObject({ built: 1, released: 1, torn: 1 });
  });

  it('empty, wrecked and far vehicles stay silent; a rider hopping off spools the engine down', () => {
    const f = fakeCtx();
    const limiter = new VoiceLimiter(28);
    const loops = new VehicleLoops(host(f, limiter), f.ctx, new FNode('sfx') as unknown as AudioNode);
    const states = byId([
      vehicle(10, { weapon: -1, flags: EFlag.Grounded }),                   // parked, empty
      vehicle(11, { weapon: 5, flags: EFlag.Dead }),                        // wrecked
      vehicle(12, { weapon: 5, z: LOOPS.kartMaxDist + 5 }),                 // kart out of earshot
      vehicle(13, { weapon: 6, cls: 1, z: 60, y: 12 }),                     // a plane carries further
    ]);
    run(f, loops, states, 0.3);
    expect(loops.debug().map((d) => d.id)).toEqual([13]);
    states.get(13)!.weapon = -1; // pilot bails
    run(f, loops, states, 0.1);
    expect(loops.debug()).toEqual([{ id: 13, plane: true, local: false, state: 'off' }]);
    const buzz = oscs(f, 'sawtooth')[0];
    expect(p(buzz, 'frequency').lastTarget).toBeLessThan(PLANE_ENGINE.idleHz); // spooling down
    run(f, loops, states, 1);
    expectNoLeaks(f, loops, limiter);
  });

  it("the local rider's own vehicle is centered and the loudest, and always gets a loop", () => {
    const f = fakeCtx();
    const loops = new VehicleLoops(host(f), f.ctx, new FNode('sfx') as unknown as AudioNode);
    // 6 remote karts near the listener, and ours 50 m away (camera far behind: still ours, still on)
    const list = [1, 2, 3, 4, 5, 6].map((i) => vehicle(20 + i, { weapon: 100 + i, z: 2 + i }));
    list.push(vehicle(10, { weapon: 1, z: 50 }));
    const states = byId(list);
    run(f, loops, states, 0.3, 1);
    const d = loops.debug();
    expect(d.length).toBe(LOOPS.maxActive);
    expect(d.find((s) => s.id === 10)).toEqual({ id: 10, plane: false, local: true, state: 'on' });
    expect(d.filter((s) => s.id !== 10).map((s) => s.id).sort()).toEqual([21, 22, 23]); // nearest three
    expect(LOOPS.localGain).toBeGreaterThan(LOOPS.remoteGain);
    // ours: direct (2D) path on, panner send off; remote ones the other way round
    const panners = f.nodes.filter((n) => n.kind === 'panner');
    const sends = panners.map((pn) => f.nodes.find((n) => n.kind === 'gain' && n.dests[0] === pn)!);
    const levels = sends.map((s) => f.nodes.find((n) => n.kind === 'gain' && n.dests.includes(s))!);
    const directs = levels.map((l) => l.dests[0] as FNode); // level → direct (2D), level → send → panner
    const local = levels.findIndex((l) => p(l, 'gain').lastTarget === LOOPS.localGain);
    expect(local).toBeGreaterThanOrEqual(0);
    expect(p(directs[local], 'gain').value).toBe(1);
    expect(p(sends[local], 'gain').value).toBe(0);
    for (let i = 0; i < levels.length; i++) if (i !== local) {
      expect(p(levels[i], 'gain').lastTarget).toBe(LOOPS.remoteGain);
      expect(p(sends[i], 'gain').value).toBe(1);
    }
  });

  it('nearest first with hysteresis: no slot churn when two karts trade places by a little', () => {
    const f = fakeCtx();
    const loops = new VehicleLoops(host(f), f.ctx, new FNode('sfx') as unknown as AudioNode);
    const list = [5, 10, 15, 20, 25, 30, 35].map((d, i) => vehicle(30 + i, { weapon: 200 + i, z: d }));
    const states = byId(list);
    run(f, loops, states, 0.3);
    expect(loops.debug().map((s) => s.id).sort()).toEqual([30, 31, 32, 33]);
    const built = loops.stats.built;
    states.get(34)!.z = 19; // a hair nearer than the 20 m kart: no swap
    run(f, loops, states, 0.5);
    expect(loops.stats.built).toBe(built);
    expect(loops.debug().filter((s) => s.state === 'on').map((s) => s.id).sort()).toEqual([30, 31, 32, 33]);
    states.get(34)!.z = 3; // clearly the nearest now: it takes the farthest one's slot
    run(f, loops, states, 0.2);
    expect(loops.debug().filter((s) => s.state === 'on').map((s) => s.id).sort()).toEqual([30, 31, 32, 34]);
    expect(loops.stats.built).toBe(built + 1);
    expect(loops.active).toBeLessThanOrEqual(LOOPS.maxActive);
  });

  it('inside the voice limiter: a loop never steals a one-shot, a one-shot can steal a loop', () => {
    const f = fakeCtx();
    const limiter = new VoiceLimiter(4, {});
    const loops = new VehicleLoops(host(f, limiter), f.ctx, new FNode('sfx') as unknown as AudioNode);
    for (let i = 0; i < 4; i++) limiter.acquire(0, 60, 0, 'foot'); // four long footsteps fill the budget
    const states = byId([vehicle(10, { weapon: 5 })]);
    run(f, loops, states, 0.3);
    expect(loops.active).toBe(0);
    expect(loops.stats.rejected).toBeGreaterThan(0);
    expect(limiter.countIn('foot')).toBe(4); // nothing was cut off
    expect(loops.stats.rejected).toBeLessThanOrEqual(2); // retries back off (not every frame)

    const f2 = fakeCtx();
    const lim2 = new VoiceLimiter(4, {});
    const loops2 = new VehicleLoops(host(f2, lim2), f2.ctx, new FNode('sfx') as unknown as AudioNode);
    run(f2, loops2, states, 0.3);
    expect(loops2.active).toBe(1);
    for (let i = 0; i < 3; i++) lim2.acquire(f2.ctx.currentTime, 5, 1, 'fire');
    const shot = lim2.acquire(f2.ctx.currentTime, 5, 1, 'fire'); // budget full: the engine (priority 0) goes
    expect(shot?.stolen?.category).toBe('engine');
    run(f2, loops2, states, 0.1);
    expect(loops2.stats.stolen).toBe(1);
    expect(loops2.active).toBe(0);
  });

  it('the engines sub-bus ducks under combat intensity', () => {
    const f = fakeCtx();
    const loops = new VehicleLoops(host(f), f.ctx, new FNode('sfx') as unknown as AudioNode);
    const bus = f.nodes[0];
    const states = byId([vehicle(10, { weapon: 5 })]);
    run(f, loops, states, 0.2, 1, 1);
    expect(p(bus, 'gain').lastTarget).toBeCloseTo(1 - LOOPS.duck, 5);
    run(f, loops, states, 0.2, 1, 0);
    expect(p(bus, 'gain').lastTarget).toBe(1);
  });

  it('a remote plane flying past bends pitch: up approaching, down going away (clamped)', () => {
    const f = fakeCtx();
    const loops = new VehicleLoops(host(f), f.ctx, new FNode('sfx') as unknown as AudioNode);
    const plane = vehicle(40, { cls: 1, weapon: 7, ammo: packPlaneAux(1, 0), vz: -25, z: 60, y: 8, flags: 0 });
    const states = byId([plane]);
    const fly = (s: number) => { for (let t = 0; t < s; t += 1 / 60) { plane.z += plane.vz / 60; f.ctx.currentTime += 1 / 60; loops.update(states, 1, 1 / 60, 0); } };
    fly(0.8);
    const buzz = oscs(f, 'sawtooth')[0];
    const approaching = p(buzz, 'frequency').lastTarget;
    fly(3.6); // past the listener, now going away
    const receding = p(buzz, 'frequency').lastTarget;
    const still = PLANE_ENGINE.fullHz + PLANE_ENGINE.airHz * (25 - 8);
    expect(approaching).toBeGreaterThan(still * 1.08);
    expect(receding).toBeLessThan(still * 0.92);
    expect(approaching).toBeLessThanOrEqual(still * LOOPS.dopplerMax + 1e-6);
    expect(receding).toBeGreaterThanOrEqual(still * LOOPS.dopplerMin - 1e-6);
  });

  it('dispose stops and disconnects every running loop at once', () => {
    const f = fakeCtx();
    const limiter = new VoiceLimiter(28);
    const loops = new VehicleLoops(host(f, limiter), f.ctx, new FNode('sfx') as unknown as AudioNode);
    const states = byId([vehicle(10, { weapon: 5 }), vehicle(11, { weapon: 6, cls: 1, z: 12 })]);
    run(f, loops, states, 0.3);
    states.delete(11);
    run(f, loops, states, 0.1); // one fading, one running
    loops.dispose();
    for (const n of f.nodes) expect(n.disconnects).toBeGreaterThanOrEqual(1);
    for (const n of f.nodes.filter((n) => n.kind === 'osc' || n.kind === 'src')) expect(n.stops).toBe(1);
    expect(limiter.countIn('engine')).toBe(0);
  });

});

describe('S2 event voices and adventure stingers', () => {
  it('vehicle and destructible events map to their recipes; class and boss names are kept', () => {
    expect(abilitySfx('mount')).toMatchObject({ recipe: S.seatClunk, k: 0, vehicle: true });
    expect(abilitySfx('dismount')).toMatchObject({ recipe: S.seatClunk, k: 1, vehicle: true });
    expect(abilitySfx('bail')).toMatchObject({ recipe: S.bailPop, vehicle: true });
    expect(abilitySfx('boost')).toMatchObject({ recipe: S.rocketFwoosh, vehicle: true });
    expect(abilitySfx('horn')).toMatchObject({ recipe: S.honk, vehicle: true });
    expect(abilitySfx('destruct:wall_boards').recipe).toBe(S.woodCrash);
    expect(abilitySfx('destruct:tuna_stack').recipe).toBe(S.canClatter);
    expect(abilitySfx('destruct:crate_stack').recipe).toBe(S.crateCrunch);
    expect(abilitySfx('destruct:garden_gnome').recipe).toBe(S.crateCrunch); // an unknown future kind: a generic break
    for (const [name, r] of [['dot_paint', S.dotPing], ['dot_glint', S.glintTink], ['dot_lost', S.dotLost], ['shot_spoiled', S.clonk], ['sniper_leap', S.whoosh], ['beret_off', S.pop], ['dig_charge', S.chargeArm], ['ear_glide', S.whoosh]] as const) {
      expect(abilitySfx(name).recipe, name).toBe(r);
    }
    expect(abilitySfx('slide').recipe).toBe(S.whoomp);
    expect(abilitySfx('destruct:wall_boards').category).toBe('impact');
    expect(abilitySfx('mount').priority).toBeLessThan(abilitySfx('destruct:wall_boards').priority);
    expect(SCORE_STINGERS).toEqual({ step: S.stepJingle, chapter: S.chapterFanfare });
  });

  describe('through createAudio', () => {
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
    const me = (o: Partial<EntityState> = {}): EntityState => ({ ...vehicle(1), kind: EntityKind.Player, cls: 0, weapon: 0, z: 2, ...o });

    it('step jingle and chapter fanfare replace the team sting; the chapter tick plays the fanfare alone', async () => {
      const { audio, plays, listener } = await rig();
      const states = byId([me()]);
      const score = (reason: string, pts = 10): GameEvent => ({ e: 'score', team: 0, pts, reason });
      audio.update(listener, states, 1, 1 / 60);
      audio.onGameEvent(score('step'));
      expect(plays.length).toBe(0); // waits one frame for a same-tick 'chapter'
      audio.update(listener, states, 1, 1 / 60);
      expect(plays.map((x) => x.r)).toEqual([S.stepJingle]);
      expect(plays[0].o).toMatchObject({ bus: 'ui', category: 'ui' });
      plays.length = 0;
      // the last step: step + chapter + win on one tick
      audio.onGameEvent(score('step')); audio.onGameEvent(score('chapter', 50)); audio.onGameEvent(score('win', 0));
      audio.update(listener, states, 1, 1 / 60);
      expect(plays.map((x) => x.r)).toEqual([S.chapterFanfare]);
      expect(plays[0].o).toMatchObject({ bus: 'ui', priority: 3 });
      plays.length = 0;
      for (let i = 0; i < 180; i++) audio.update(listener, states, 1, 1 / 60); // after the fanfare
      audio.onGameEvent(score('objective'));
      expect(plays.map((x) => x.r)).toEqual([S.sting]);
      audio.dispose();
    });

    it('vehicle events play centered for the local rider and spatially for others; breaks play at the break', async () => {
      const { audio, plays, listener } = await rig();
      const kart = vehicle(10, { weapon: 1, z: 2 });
      const states = byId([me({ flags: EFlag.Mounted | EFlag.Grounded }), kart, vehicle(11, { weapon: 7, z: 20 })]);
      audio.update(listener, states, 1, 1 / 60);
      audio.onGameEvent({ e: 'ability', id: 10, ability: 'boost', x: 0, y: 0.4, z: 2 });
      audio.onGameEvent({ e: 'ability', id: 11, ability: 'boost', x: 0, y: 0.4, z: 20 });
      audio.onGameEvent({ e: 'ability', id: 55, ability: 'destruct:tuna_stack', x: 4, y: 1, z: 9 });
      expect(plays.map((x) => x.r)).toEqual([S.rocketFwoosh, S.rocketFwoosh, S.canClatter]);
      expect(plays[0].o.x).toBeUndefined();
      expect(plays[1].o).toMatchObject({ x: 0, z: 20, category: 'fx' });
      expect(plays[2].o).toMatchObject({ x: 4, y: 1, z: 9, category: 'impact', priority: 2 });
      audio.dispose();
    });

    it('a seated rider makes no footsteps, and the engine loops run from GameAudio.update', async () => {
      const { f, audio, plays, listener } = await rig();
      const rider = me({ flags: EFlag.Mounted | EFlag.Grounded, vx: 12 });
      const states = byId([rider, vehicle(10, { weapon: 1, z: 2, vx: 12 })]);
      for (let i = 0; i < 60; i++) { f.ctx.currentTime += 1 / 60; audio.update(listener, states, 1, 1 / 60); }
      expect(plays.filter((x) => x.r === S.footstep).length).toBe(0);
      expect(oscs(f, 'custom').length).toBe(1); // the kart's firing oscillator
      rider.flags = EFlag.Grounded; // off the kart, running: footsteps are back
      states.get(10)!.weapon = -1;
      for (let i = 0; i < 60; i++) { f.ctx.currentTime += 1 / 60; audio.update(listener, states, 1, 1 / 60); }
      expect(plays.filter((x) => x.r === S.footstep).length).toBeGreaterThan(3);
      audio.dispose();
      const fire = oscs(f, 'custom')[0];
      expect(fire.stops).toBe(1);
      expect(fire.disconnects).toBeGreaterThanOrEqual(1);
    });
  });
});
