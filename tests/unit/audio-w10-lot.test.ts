// W10 AU2 (audio-2), acceptance 2: The Lot's ambience comes from its world data, changes with the weather and the
// listener's position, and the West Yard's ambience output is unchanged.
//   · emitters: containers, tarps, floodlights, the crane, drips, the ditch found on The Lot; none on the West Yard
//   · siteMix (pure) sampled over dry / rain / storm × positions: what should play where, and when
//   · rendered: the ambience's band levels at 6 places × 3 weathers move the way the mix says
//   · the West Yard: the site ambience builds nothing, and the whole ambience output (weather beds, a sprinkler, a
//     storm with thunder) under the AU2 stack reproduces the fingerprint rendered from the pre-AU2 code (HEAD b128cb5,
//     identical at c783329; regenerate with AU2_GOLDEN=1 on a snapshot of that commit + these test helpers) to 1e-9
import { afterEach, describe, expect, it } from 'vitest';
import { createWorldData } from '../../src/shared/world/world-data';
import { weatherAt, WEATHER_PARAMS } from '../../src/shared/world/weather';
import { createSiteAmbience, emptyMix, hasSite, siteEmitters, siteMix, AMB } from '../../src/client/audio/site-ambience';
import { band, rmsDb } from './audio-w10-render';
import { camera, pet, weatherSample, SR, type Scene } from './audio-w10-scenes';
import { play, renderAndRestore, type Rendered } from './audio-w10-driver';

const lot = createWorldData(1, 'the_lot');
const yard = createWorldData(1, 'west_yard');
const H = (x: number, z: number) => lot.height(x, z) + 2.2;
/** Listener spots on The Lot (camera height over the ground). */
const SPOT = {
  containerOut: [-103, H(-103, -32), -32], containerIn: [-95.5, H(-95.5, -32), -32], floodBase: [-82, H(-82, -112), -112],
  skip: [-54, H(-54, 50), 50], ditch: [-41, H(-41, 6), 6], mud: [0, H(0, 30), 30],
} as const satisfies Record<string, readonly [number, number, number]>;
type Spot = keyof typeof SPOT;

describe('AU2 site ambience: emitters from the world data', () => {
  it('The Lot: 2 container roofs, 2 tarp-covered skips, 4 floodlights, the crane, eaves + pipe drips, 4 ditch pools', () => {
    const e = siteEmitters(lot);
    expect(e.steel.length).toBe(2);
    expect(e.tarp.length).toBe(2);
    for (const t of e.tarp) expect(t.hy).toBeLessThan(0.5); // the tarp cap, not the steel body
    expect(e.flood.length).toBe(4);
    expect(e.tall.length).toBeGreaterThanOrEqual(1);
    for (const t of e.tall) expect(t[1]).toBeGreaterThan(40);
    expect(e.drips.filter((d) => !d.pipe).length).toBeGreaterThanOrEqual(8);
    expect(e.drips.filter((d) => d.pipe).length).toBeGreaterThanOrEqual(6);
    expect(e.ditch.length).toBe(4);
    expect(hasSite(e)).toBe(true);
  });

  it('the West Yard has none of them (its water is untinted, it has no floodlight data, no container, no crane)', () => {
    const e = siteEmitters(yard);
    expect([e.steel, e.tarp, e.flood, e.tall, e.drips, e.ditch].map((a) => a.length)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(hasSite(e)).toBe(false);
  });
});

describe('AU2 site ambience: the mix follows the weather and the listener (pure)', () => {
  const e = siteEmitters(lot);
  const at = (s: Spot, kind: 'clear' | 'rain' | 'storm' | 'clearing') => siteMix(e, WEATHER_PARAMS[kind], SPOT[s][0], SPOT[s][1], SPOT[s][2], emptyMix());

  it('rain on steel: silent when dry, pinging in rain, a roar in a storm; the drum overhead inside the container', () => {
    expect(at('containerOut', 'clear').steel[0].on).toBe(false);
    const rain = at('containerOut', 'rain').steel[0], storm = at('containerOut', 'storm').steel[0];
    expect(rain.on).toBe(true);
    expect(storm.ping).toBeGreaterThan(rain.ping);
    expect(storm.dense).toBeGreaterThan(rain.dense * 1.5);
    const inside = at('containerIn', 'rain').steel[0];
    expect(inside.inside).toBe(true);
    expect(rain.inside).toBe(false);
    expect(inside.pingLvl).toBeGreaterThan(rain.pingLvl * 1.8);
    expect(inside.drum).toBe(1);
    expect(at('mud', 'storm').steel.every((t) => !t.on)).toBe(true); // too far from the containers
  });

  it('tarps: patter in rain, flapping in storm gusts, nothing in dry calm', () => {
    expect(at('skip', 'clear').tarp.on).toBe(false);
    const rain = at('skip', 'rain').tarp, storm = at('skip', 'storm').tarp;
    expect(rain.pingLvl).toBeGreaterThan(0);
    expect(storm.flap).toBeGreaterThan(rain.flap);
    expect(storm.flap).toBeGreaterThan(0.2);
  });

  it('floodlight hum near the towers in any weather (rain sizzles on the lens), none out in the mud', () => {
    for (const k of ['clear', 'rain', 'storm'] as const) expect(at('floodBase', k).flood[0].hum).toBeGreaterThan(0);
    expect(at('floodBase', 'clear').flood[0].sizzleLvl).toBe(0);
    expect(at('floodBase', 'rain').flood[0].sizzleLvl).toBeGreaterThan(0);
    expect(at('mud', 'clear').flood.every((t) => !t.on)).toBe(true);
  });

  it('the ditch runs when wet (and still after the rain), drops plop into it only while it rains', () => {
    expect(at('ditch', 'clear').ditch.on).toBe(false);
    const clearing = at('ditch', 'clearing').ditch, storm = at('ditch', 'storm').ditch;
    expect(clearing.gurgle).toBeGreaterThan(0);
    expect(storm.gurgle).toBeGreaterThan(clearing.gurgle);
    expect(storm.plopLvl).toBeGreaterThan(0);
  });

  it('one-shots: drips near eaves and pipes when wet; the crane creaks more in wind; far site noise goes quiet in a storm', () => {
    expect(at('containerOut', 'clear').dripRate).toBe(0);
    expect(at('containerOut', 'rain').dripRate).toBeGreaterThan(1);
    expect(at('mud', 'rain').dripRate).toBe(0);
    expect(at('mud', 'storm').creakEvery).toBeLessThan(at('mud', 'clear').creakEvery);
    expect(at('mud', 'clear').distantEvery).toBeLessThan(at('mud', 'rain').distantEvery);
    expect(at('mud', 'storm').distantEvery).toBe(Infinity);
    expect(at('mud', 'clear').bed).toBeGreaterThan(at('mud', 'storm').bed);
  });
});

describe('AU2 site ambience: rendered', () => {
  const done: Rendered[] = [];
  afterEach(() => { for (const r of done.splice(0)) r.m.restore(); });
  const scene = (p: readonly [number, number, number], sky: 'clear' | 'rain' | 'storm', o: Partial<Scene> = {}): Scene => ({
    seconds: 3, music: false, world: lot, weather: false, ambience: true, localId: 1,
    listener: () => camera(p[0], p[1], p[2]), states: () => new Map([[1, pet(1, { x: p[0], y: p[1] - 2.2, z: p[2] })]]), sky: () => weatherSample(sky), ...o,
  });
  /** Band level (dB) of the ambience alone over the settled last 2 s. */
  const lv = async (s: Spot, sky: 'clear' | 'rain' | 'storm', lo: number, hi: number) => {
    const r = await renderAndRestore(scene(SPOT[s], sky));
    return rmsDb(band(r.master, SR, lo, hi), SR, 1, 3);
  };

  it('by a container: the steel band rises dry → rain → storm, and louder again inside it', async () => {
    const dry = await lv('containerOut', 'clear', 700, 3000), rain = await lv('containerOut', 'rain', 700, 3000), storm = await lv('containerOut', 'storm', 700, 3000);
    const inRain = await lv('containerIn', 'rain', 700, 3000);
    expect(rain - dry).toBeGreaterThan(25);
    expect(storm - rain).toBeGreaterThan(3);
    expect(inRain - rain).toBeGreaterThan(4);
    expect(rain - (await lv('mud', 'rain', 700, 3000))).toBeGreaterThan(12); // the same rain, far from the steel
  }, 60000);

  it('at a floodlight tower the 100 Hz hum stands ≥ 12 dB over the open mud; by a skip the tarp band rises with rain', async () => {
    expect((await lv('floodBase', 'clear', 60, 140)) - (await lv('mud', 'clear', 60, 140))).toBeGreaterThan(12);
    expect((await lv('skip', 'rain', 250, 500)) - (await lv('skip', 'clear', 250, 500))).toBeGreaterThan(15);
    expect((await lv('ditch', 'storm', 250, 500)) - (await lv('ditch', 'clear', 250, 500))).toBeGreaterThan(15);
  }, 60000);

  it('the crane creaks and the far site clanks as positional one-shots, inside the limiter (category amb, priority 0)', async () => {
    const plays: { cat: unknown; pri: unknown; x: unknown }[] = [];
    const r = await play(scene(SPOT.mud, 'clear', {
      seconds: 30,
      frame: (m, t) => {
        if (t !== 0) return;
        const e = m.audio.engine, orig = e.play.bind(e);
        e.play = (rc, o = {}) => { if (o.category === 'amb') plays.push({ cat: o.category, pri: o.priority, x: o.x }); return orig(rc, o); };
      },
    }));
    done.push(r);
    const st = r.m.ambience!.stats;
    expect(st.creaks).toBeGreaterThanOrEqual(1);
    expect(st.distant).toBeGreaterThanOrEqual(1);
    expect(plays.length).toBe(st.creaks + st.distant + st.drips);
    for (const p of plays) { expect(p.pri).toBe(0); expect(p.x).toBeTypeOf('number'); }
  }, 60000);

  it('a loop\'s nodes exist only while it sounds: built by the rain, torn down after a dry spell', async () => {
    let sky: 'clear' | 'rain' = 'clear';
    const r = await play(scene(SPOT.containerOut, 'clear', { seconds: 12, sky: () => weatherSample(sky), frame: (_m, t) => { sky = t >= 2 && t < 6 ? 'rain' : 'clear'; } }));
    done.push(r);
    const a = r.m.ambience!;
    expect(a.lifecycle.built).toBeGreaterThanOrEqual(1);          // the steel roof, when the rain came
    expect(a.lifecycle.torn).toBeGreaterThanOrEqual(1);           // and gone again 3 s after it stopped
    expect(a.loops).toBe(0);                                       // (no floodlight within 60 m of this spot)
    expect(r.m.audio.engine.limiter.countIn('ambloop')).toBe(0);
  }, 60000);

  it('the low quality tier keeps one container and one floodlight loop (the worst case halves)', async () => {
    const at = [-85, lot.height(-85, -32) + 2.2, -32] as const; // between the two containers
    // (a live settings change: the dropped loop fades, then is torn down after AMB.idle s)
    const hi = await play(scene(at, 'storm', { seconds: 4.5 }));
    done.push(hi);
    const lo = await play(scene(at, 'storm', { seconds: 4.5, frame: (m, t) => { if (t === 0) m.ambience!.setQuality('low'); } }));
    done.push(lo);
    expect(hi.m.ambience!.loops).toBe(3); // both roofs + the ditch 32 m south
    expect(lo.m.ambience!.loops).toBe(2); // one roof + the ditch
  }, 60000);

  it('loops hold ambloop voices at priority 0 and give them back when silent', async () => {
    const r = await play(scene(SPOT.containerOut, 'rain', { seconds: 1.5 }));
    done.push(r);
    const lim = r.m.audio.engine.limiter;
    expect(lim.countIn('ambloop')).toBeGreaterThanOrEqual(1);
    for (const v of lim.list()) if (v.category === 'ambloop') expect(v.priority).toBe(0);
    // a gameplay burst takes the loops' voices, never the other way round
    for (let i = 0; i < lim.maxVoices + 4; i++) lim.acquire(r.m.ctx.currentTime, 2, 1, `burst${i}`);
    expect(lim.countIn('ambloop')).toBe(0);
  }, 60000);
});

// ------------------------------------------------------------------------------------------------ the West Yard

/** West Yard ambience scenes: a garden sprinkler bursting in clear weather, steady rain, a storm with three thunders. */
const YARD: { name: string; t0: number; secs: number; at: [number, number, number] }[] = [
  { name: 'sprinkler', t0: 9870, secs: 3, at: [-80, yard.height(-80, -12) + 2.2, -12] },
  { name: 'rain', t0: 20779, secs: 3, at: [0, yard.height(0, 0) + 2.2, 0] },
  { name: 'storm', t0: 28700, secs: 5, at: [-60, yard.height(-60, -30) + 2.2, -30] },
];
const yardScene = (y: (typeof YARD)[number], ambience: boolean): Scene => ({
  seconds: y.secs, music: false, world: yard, weather: true, ambience, localId: 1,
  listener: () => camera(y.at[0], y.at[1], y.at[2], 0.4),
  states: () => new Map([[1, pet(1, { x: y.at[0], y: y.at[1] - 2.2, z: y.at[2] })]]),
  tick: (t) => y.t0 + Math.round(t * 60), sky: (t) => weatherAt(yard, y.t0 + Math.round(t * 60)),
});
/** Energy per 0.25 s window of the stereo output (float64), the fingerprint. */
function fingerprint(out: Float32Array[]): number[] {
  const w = SR / 4, n = Math.floor(out[0].length / w), f: number[] = [];
  for (let i = 0; i < n; i++) { let e = 0; for (const ch of out) for (let j = i * w; j < (i + 1) * w; j++) e += ch[j] * ch[j]; f.push(e); }
  return f;
}
/** Rendered from HEAD b128cb5 (pre-AU2 weather.ts, engine and director; identical at c783329) with AU2_GOLDEN=1. */
const GOLDEN: Record<string, number[]> = {
  sprinkler: [
    14.9514079500110, 35.8563042268213, 64.2379576607406, 65.3884069706339, 53.6284083146989, 82.5343490667469,
    61.0133967230832, 70.9101110529732, 85.0859788130021, 54.5715613247497, 75.3813270969392, 68.9725257339246,
  ],
  rain: [
    5.70985842278648, 31.2664277932504, 65.7933866102959, 91.1344023983130, 107.914141908787, 118.290752118319,
    127.456701265218, 135.509521336163, 137.282402149257, 141.633507063791, 146.553623083635, 154.493225982067,
  ],
  storm: [
    11.3982325538181, 62.9188907263986, 135.142778198086, 180.913563502031, 218.780760293946, 236.019196981375,
    242.090578540364, 260.602861030735, 332.512286722292, 522.778554470598, 594.567524344214, 544.941755789421,
    580.845426605832, 460.582181478927, 477.771340575379, 559.801627743930, 405.329444884965, 349.421899280770,
    614.426165851180, 688.392720159626,
  ],
};

describe('AU2: the West Yard\'s ambience output is unchanged', () => {
  it('the site ambience builds nothing on the West Yard', () => {
    let built = 0;
    const engine = { whenReady: () => { built++; } } as never;
    const a = createSiteAmbience({ engine, intensity: 0 }, yard);
    expect(a.active).toBe(false);
    expect(built).toBe(0);
  });

  for (const y of YARD) {
    it(`${y.name}: the weather beds, sprinklers and thunder reproduce the pre-AU2 render`, async () => {
      const r = await renderAndRestore(yardScene(y, true));
      const f = fingerprint(r.out);
      if (process.env.AU2_GOLDEN) { console.log(`GOLDEN ${y.name}: [${f.map((x) => x.toPrecision(15)).join(', ')}],`); return; }
      const g = GOLDEN[y.name];
      expect(f.length).toBe(g.length);
      expect(f.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
      for (let i = 0; i < g.length; i++) expect(Math.abs(f[i] - g[i])).toBeLessThanOrEqual(1e-9 * Math.max(1e-12, Math.abs(g[i])) + 1e-15);
    }, 60000);
  }

  it('and the AU2 site ambience adds nothing to it (the same scene with and without it is sample-identical)', async () => {
    const a = await renderAndRestore(yardScene(YARD[2], true));
    const b = await renderAndRestore(yardScene(YARD[2], false));
    let same = true;
    for (let c = 0; c < 2; c++) for (let i = 0; i < a.out[c].length; i++) if (a.out[c][i] !== b.out[c][i]) { same = false; break; }
    expect(same).toBe(true);
  }, 60000);
});

void AMB;
