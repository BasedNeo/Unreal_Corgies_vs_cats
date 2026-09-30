// W10 AU2 (audio-2): the level table. Every new voice rendered on the offline renderer the way X3 measured its
// weapons (docs/handoff/X3.md §5: the recipe × its play gain, no buses, no master chain, the loudest 100 ms RMS), next
// to the references it is balanced against, and held to that balance:
//   · the renderer reproduces X3's Chromium numbers for the rifle, the thwack and the boom (±1.5 dB)
//   · Base Assault calls sit with L5's score sting (±3 dB); the capture fanfare with the chapter fanfare (±2 dB), and
//     their capture lament under it; the ball's voice under a rifle shot
//   · the threatened player's fuse tick lands between X4's texture level and a local rifle shot
//   · the site's one-shots stay texture: under a rifle shot by ≥ 10 dB at their typical distance
// AU2_TABLE=1 prints the table (docs/handoff/AU2.md §2).
import { describe, expect, it } from 'vitest';
import * as S from '../../src/client/audio/presets';
import { ORDNANCE_SFX, FUSE_THREAT } from '../../src/client/audio/presets-ordnance';
import { OBJECTIVE_SFX, BA_GAIN, CALL_TRIM } from '../../src/client/audio/presets-objective';
import { SITE_SFX, dustDrive } from '../../src/client/audio/presets-site';
import { AMB } from '../../src/client/audio/site-ambience';
import type { Voice } from '../../src/client/audio/synth';
import { RenderContext, maxWindowDb, peak } from './audio-w10-render';

const SR = 48000;
/** The same references rendered by Chromium 1194's OfflineAudioContext, 48 kHz, same method (docs/handoff/AU2.md §6). */
const CHROMIUM = { rifle: -19.5, boom: -8.1, stingMine: -20.8, stingTheirs: -23.1, chapter: -17.5 } as const;
type Recipe = (v: Voice, k: number) => number;

/** Render `recipe` at play gain `g` (optionally `dist` m off to the side through an inverse panner, X4/X3 style). */
function level(recipe: Recipe, k: number, g: number, dist = 0, refDist = 3): { db: number; peak: number } {
  const ctx = new RenderContext(SR);
  let seed = 11;
  const out = ctx.createGain(); out.gain.value = g;
  if (dist > 0) {
    const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = refDist; p.rolloffFactor = 1.15;
    p.positionX.value = 0; p.positionY.value = 0; p.positionZ.value = -dist;
    out.connect(p); p.connect(ctx.destination as unknown as AudioNode);
  } else out.connect(ctx.destination as unknown as AudioNode);
  const dur = recipe({ ctx: ctx.asContext(), out, t: 0.05, rand: () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; } }, k);
  const o = ctx.render(Math.min(4, dur + 0.5));
  // panned voices: judge the louder ear (a centred 2D voice has L = R)
  const ch = dist > 0 ? [o[0]] : o;
  return { db: maxWindowDb(ch, SR, 0.1), peak: peak(o, SR) };
}

const rows: [string, number, number][] = [];
const row = (name: string, r: { db: number; peak: number }) => { rows.push([name, r.db, r.peak]); return r.db; };

describe('AU2 level table (X3 method: recipe × play gain, loudest 100 ms RMS)', () => {
  const ref = {
    rifle: row('ref: rifle, local (0.6)', level(S.rifleShot, 0, 0.6)),
    thwack: row('ref: thwack (1)', level(S.thwack, 0, 1)),
    boom: row('ref: boom (1)', level(S.boom, 1, 1)),
    stingMine: row('ref: L5 score sting, ours (0.7)', level(S.sting, 1, 0.7)),
    stingTheirs: row('ref: L5 score sting, theirs (0.7)', level(S.sting, 2, 0.7)),
    chapter: row('ref: chapter fanfare (0.85)', level(S.chapterFanfare, 0, 0.85)),
    squeakX4: row('ref: X4 bounce squeak k=1 @ 4 m (0.85)', level(ORDNANCE_SFX.squeak, 1, 0.85, 4, 4)),
  };

  it('the renderer reproduces Chromium: X3\'s published rifle −19.3 / boom −7.4 dB (±1.5), and the AU2 cross-check\'s own renders (±0.7)', () => {
    expect(ref.rifle).toBeGreaterThan(-19.3 - 1.5); expect(ref.rifle).toBeLessThan(-19.3 + 1.5);
    expect(ref.boom).toBeGreaterThan(-7.4 - 1.5); expect(ref.boom).toBeLessThan(-7.4 + 1.5);
    for (const [k, db] of Object.entries(CHROMIUM)) expect(Math.abs(ref[k as keyof typeof CHROMIUM] - db), k).toBeLessThan(0.7);
  });

  it('Base Assault: the calls sit with the score sting, the fanfare with the chapter fanfare, the ball under a rifle', () => {
    const O = OBJECTIVE_SFX;
    const calls = [0, 1, 2, 3, 4, 5].map((k) => row(`AU2 call k=${k} (${(BA_GAIN.call * CALL_TRIM[k]).toFixed(2)})`, level(O.baCall, k, BA_GAIN.call * CALL_TRIM[k])));
    const sting = (ref.stingMine + ref.stingTheirs) / 2;
    for (const c of calls) { expect(c).toBeGreaterThan(sting - 3); expect(c).toBeLessThan(sting + 3); }
    const fan = row(`AU2 capture fanfare (${BA_GAIN.fanfare})`, level(O.captureFanfare, 0, BA_GAIN.fanfare));
    const lament = row(`AU2 capture lament (${BA_GAIN.lament})`, level(O.captureLament, 0, BA_GAIN.lament));
    expect(fan).toBeGreaterThan(ref.chapter - 2); expect(fan).toBeLessThan(ref.chapter + 2);
    expect(lament).toBeLessThan(fan);
    for (const [name, r, k] of [['grab', O.ballGrab, 0], ['grab', O.ballGrab, 1], ['bounce', O.ballBounce, 0], ['bounce', O.ballBounce, 1], ['home', O.ballHome, 0], ['home', O.ballHome, 1], ['squeal', O.ballSqueal, 0], ['squeal', O.ballSqueal, 1]] as const) {
      const db = row(`AU2 ball ${name} k=${k} @ 6 m (${BA_GAIN.ball})`, level(r, k, BA_GAIN.ball, 6, 6));
      expect(db).toBeLessThan(ref.rifle);
      expect(db).toBeGreaterThan(ref.squeakX4 - 8);
    }
  });

  it('the threatened fuse tick: louder than X4\'s texture peep, under a local rifle shot', () => {
    const x4 = row('X4 fuse peep k=1 @ 4 m (0.7)', level(ORDNANCE_SFX.fusePeep, 1, 0.7, 4));
    const x4w = row('X4 wick crackle k=1 @ 4 m (0.7)', level(ORDNANCE_SFX.wickCrackle, 1, 0.7, 4));
    const alarm = row(`AU2 fuse alarm k=1 @ 4 m (0.7 × ${1 + FUSE_THREAT.boost[0]})`, level(ORDNANCE_SFX.fuseAlarm, 1, 0.7 * (1 + FUSE_THREAT.boost[0]), 4));
    const wick = row(`AU2 threatened crackle k=1 @ 4 m (0.7 × ${1 + FUSE_THREAT.boost[1]})`, level(ORDNANCE_SFX.wickCrackle, 1, 0.7 * (1 + FUSE_THREAT.boost[1]), 4));
    expect(alarm).toBeGreaterThan(x4 + 15);
    expect(wick).toBeGreaterThan(x4w + 10);
    // a warning at your feet may be as loud as your own shot, never louder
    expect(alarm).toBeLessThan(ref.rifle + 0.5);
    expect(wick).toBeLessThan(ref.rifle + 0.5);
  });

  it('the site\'s one-shots stay texture (≥ 10 dB under a rifle shot where they are heard)', () => {
    const drip = row(`AU2 drip @ 4 m (${AMB.gain.drip})`, level(SITE_SFX.drip, 0, AMB.gain.drip, 4, 3));
    const pipe = row(`AU2 drip in a pipe @ 4 m (${AMB.gain.drip})`, level(SITE_SFX.drip, 1, AMB.gain.drip, 4, 3));
    const creak = row(`AU2 crane creak, storm @ 115 m (${AMB.gain.creak})`, level(SITE_SFX.craneCreak, 1, AMB.gain.creak, 115, 45));
    const creakDry = row(`AU2 crane creak, dry @ 115 m (${AMB.gain.creak})`, level(SITE_SFX.craneCreak, 0.22, AMB.gain.creak, 115, 45));
    const far = [0, 1, 2, 3].map((k) => row(`AU2 far site noise k=${k} @ 120 m (${AMB.gain.distant})`, level(SITE_SFX.siteDistant, k, AMB.gain.distant, 120, 45)));
    for (const db of [drip, pipe, creak, creakDry, ...far]) expect(db).toBeLessThan(ref.rifle - 10);
    for (const db of [drip, creakDry, ...far]) expect(db).toBeGreaterThan(-70); // still there
    expect(creak).toBeGreaterThan(creakDry);
  });

  it('dust drive: click rate follows the drive gain (P(|g·x| > th) = 1 − th/g)', () => {
    expect(dustDrive(0, SR)).toBeLessThan(0.985);
    const g = dustDrive(480, SR);
    expect(1 - 0.985 / g).toBeCloseTo(480 / SR, 6);
  });

  it('prints the table (AU2_TABLE=1)', () => {
    if (process.env.AU2_TABLE) console.log(`\n${rows.map(([n, db, pk]) => `${n.padEnd(58)} ${db.toFixed(1).padStart(6)} dB  peak ${pk.toFixed(2)}`).join('\n')}`);
    expect(rows.length).toBeGreaterThan(20);
  });
});
