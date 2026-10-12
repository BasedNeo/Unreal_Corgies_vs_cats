// W17 TW-VIEW H1 (docs/qa/w17/PARITY.md H1, DEFECT G10; lead ruling W17: the web follows Godot, in slab mode only):
// the crosshair's gap. Slab mode draws hud.gd's rule (engines/godot/game/hud.gd:815), gap = 5 + spread × 420 px at
// 720p, from the authority's live rifle spread: a real slab sim on The Lot is stepped through rest, aiming, moving, the
// air and own shots, and each frame's gap is checked against the sim's own currentSpread (weapon-system.ts) and against
// Godot's numbers written out from tuning.gd (13.8 px at rest; no firing term, no kick). The firing value is the web
// sim's (14.97 on a shot's tick); live Godot differs there by sim order and cadence (docs/handoff/TW-VIEW-H1H20.md, a
// rules follow-up for the lead). Own shots heard in one frame recover between them (each is stamped with its snapshot's
// sim time). Every other mode keeps the general HUD's crosshair: the same frames through a copy of HEAD's hud.ts
// heuristic give the same gaps, to the bit.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { currentSpread } from '../../src/sim/combat/weapon-system';
import { Btn, emptyInput, type InputCmd } from '../../src/shared/input';
import { EFlag, EntityKind, Species, Team, type SpeciesId } from '../../src/shared/types';
import { packEntity, unpackEntity, type EntityState } from '../../src/shared/protocol';
import { SLAB } from '../../src/shared/content/modes';
import { SNAPSHOT_EVERY, TICK_HZ } from '../../src/shared/constants';
import { WEAPONS } from '../../src/shared/content/weapons';
import { WEAPON_FX } from '../../src/client/fx/weapon-fx';
import {
  CROSSHAIR_ARM, SLAB_GAP, bloomAfter, crosshairArms, crosshairFrame, crosshairPx, crosshairShot, crosshairState, crosshairWeapon, slabGap, snapshotSpread,
  type CrosshairState,
} from '../../src/client/ui/crosshair';

const DEG = Math.PI / 180;
const RIFLE = WEAPONS.squeaker_rifle;
/** Godot's rifle and HUD, written out from engines/godot/game/tuning.gd:29-30 and hud.gd:815 (not read from the web). */
const G = { hip: 1.2 * DEG, aim: 0.35 * DEG, move: 1.5, air: 2.2, bloom: 0.16 * DEG, recover: 8 * DEG, run: [6.4, 6.6] };
const godotGap = (spread: number) => 5 + spread * 420;
/** The gaps Godot draws (720p px), each from its own spread. */
const GODOT = {
  rest: godotGap(G.hip), // 13.796: QA-P17 measured 13.8 at rest and firing in place
  aim: godotGap(G.aim), // 7.566
  run: godotGap(G.hip * G.move), // 18.19 at (or past) the run speed
  air: godotGap(G.hip * G.air), // 24.35 standing in the air
  shot: godotGap(G.hip + G.bloom), // 14.97: Godot's formula for rest + one shot's bloom; the web sim's peak on a shot tick (it recovers, then fires). Live Godot draws 13.99 on a shot tick (14.19 on a burst's second tick): rules follow-up
};

describe('H1 the slab gap is hud.gd 5 + spread × 420 (720p px)', () => {
  it('the rule and the numbers it gives for the rifle', () => {
    expect(SLAB_GAP).toEqual({ base: 5, perRad: 420 });
    expect(slabGap(0)).toBe(5);
    expect(slabGap(0.02)).toBeCloseTo(13.4, 9);
    expect(GODOT.rest).toBeCloseTo(13.796, 3);
    expect(GODOT.aim).toBeCloseTo(7.566, 3);
    expect(GODOT.run).toBeCloseTo(18.195, 3);
    expect(GODOT.air).toBeCloseTo(24.352, 3);
    // the web's rifle is Godot's (the rules check, docs/handoff/TW-VIEW-H1H20.md)
    expect([RIFLE.spreadHip, RIFLE.spreadAim, RIFLE.moveSpreadMult, RIFLE.airSpreadMult, RIFLE.bloomPerShot, RIFLE.bloomRecover])
      .toEqual([G.hip, G.aim, G.move, G.air, G.bloom, G.recover]);
    expect(crosshairWeapon('squeaker_rifle')).toBe(RIFLE);
    expect(crosshairWeapon('unknown')).toBe(WEAPONS[SLAB.weapon]);
  });

  it('from a snapshot: hip or aim, opened by the ground speed up to the run speed and by the air, plus the bloom', () => {
    const at = (flags: number, v = 0, species: SpeciesId = Species.Corgi): Pick<EntityState, 'flags' | 'vx' | 'vz' | 'species' | 'cls'> => ({ flags, vx: v * 0.6, vz: -v * 0.8, species, cls: 0 });
    const gap = (s: ReturnType<typeof at>, bloom = 0) => slabGap(snapshotSpread(s, RIFLE, bloom));
    expect(gap(at(EFlag.Grounded))).toBeCloseTo(GODOT.rest, 9);
    expect(gap(at(EFlag.Grounded | EFlag.Aiming))).toBeCloseTo(GODOT.aim, 9);
    expect(gap(at(EFlag.Grounded, G.run[0]))).toBeCloseTo(GODOT.run, 9);
    expect(gap(at(EFlag.Grounded, 9.6))).toBeCloseTo(GODOT.run, 9); // sprinting: clamped at the run speed
    expect(gap(at(EFlag.Grounded, G.run[0] / 2))).toBeCloseTo(godotGap(G.hip * 1.25), 9);
    expect(gap(at(EFlag.Grounded, G.run[1] / 2, Species.Cat))).toBeCloseTo(godotGap(G.hip * 1.25), 9); // the Cat's run 6.6
    expect(gap(at(0))).toBeCloseTo(GODOT.air, 9);
    expect(gap(at(0, G.run[0]))).toBeCloseTo(godotGap(G.hip * G.move * G.air), 9);
    expect(gap(at(EFlag.Grounded), G.bloom)).toBeCloseTo(GODOT.shot, 9);
    // nothing for firing or sprinting as such: Godot has no such term
    expect(gap(at(EFlag.Grounded | EFlag.Firing | EFlag.Sprinting))).toBeCloseTo(GODOT.rest, 9);
  });

  it('the bloom as the authority keeps it: + 0.16° a shot (capped at 1.6°), back at 8°/s', () => {
    const st = crosshairState();
    expect(bloomAfter(st, RIFLE, 0)).toBe(0);
    crosshairShot(st, 0, RIFLE, 5);
    expect([st.bloomT, st.shownAt]).toEqual([5, 5]); // no sim time given: the HUD clock stamps it
    expect(bloomAfter(st, RIFLE, 0)).toBeCloseTo(G.bloom, 12);
    expect(bloomAfter(st, RIFLE, 1 / 60)).toBeCloseTo(G.bloom - G.recover / 60, 12);
    expect(bloomAfter(st, RIFLE, 0.0201)).toBe(0); // 0.16° is gone in 0.02 s: at 10 shots/s it never builds
    for (let i = 0; i < 30; i++) crosshairShot(st, 0, RIFLE, 6);
    expect(bloomAfter(st, RIFLE, 0)).toBeCloseTo(1.6 * DEG, 12);
  });

  it('shots heard in one frame recover between them: each is stamped with its snapshot\'s sim time, not the HUD clock', () => {
    const rest: Pick<EntityState, 'flags' | 'vx' | 'vz' | 'species' | 'cls'> = { flags: EFlag.Grounded | EFlag.Firing, vx: 0, vz: 0, species: Species.Corgi, cls: 0 };
    const frame = (st: CrosshairState, now: number) => crosshairFrame(st, rest, { slab: true, def: RIFLE, now });
    // three own shots 0.1 s apart on the authority (ticks 600, 606, 612), all heard in one slow HUD frame at 20.0 s
    const st = crosshairState();
    for (const tick of [600, 606, 612]) crosshairShot(st, 0, RIFLE, 20, tick / TICK_HZ);
    expect(st.bloom).toBeCloseTo(G.bloom, 12); // the authority's bloom after the third shot: one shot's
    expect([st.bloomT, st.shownAt]).toEqual([612 / TICK_HZ, 20]);
    expect(frame(st, 20)).toBeCloseTo(GODOT.shot, 9); // 14.97, never past it
    expect(frame(st, 20 + 1 / 60)).toBeCloseTo(godotGap(G.hip + G.bloom - G.recover / 60), 9); // recovering on the HUD clock
    expect(frame(st, 20.05)).toBeCloseTo(GODOT.rest, 9);
    // stamped with the HUD clock they would have stacked: 3 × 0.16° (17.3 px)
    const hud = crosshairState();
    for (let i = 0; i < 3; i++) crosshairShot(hud, 0, RIFLE, 20);
    expect(frame(hud, 20)).toBeCloseTo(godotGap(G.hip + 3 * G.bloom), 9);
    // shots one tick apart on the sim keep what the authority's would: the first shot's bloom less one tick's recovery
    const near = crosshairState();
    crosshairShot(near, 0, RIFLE, 30, 10);
    crosshairShot(near, 0, RIFLE, 30, 10 + 1 / 60);
    expect(near.bloom).toBeCloseTo(2 * G.bloom - G.recover / 60, 12);
    // a sim clock that went back (a new authority) carries nothing over
    crosshairShot(near, 0, RIFLE, 31, 2);
    expect(near.bloom).toBeCloseTo(G.bloom, 12);
  });

  it('the DOM write at any screen: each arm starts at the gap (screen px) and runs 9 HUD units; 1920 x 1080 at rest 20.69 px', () => {
    const num = (t: string) => Number(/^translate[XY]\((-?[\d.]+)px\)$/.exec(t)![1]);
    for (const [w, h, rest] of [[1280, 720, 13.8], [1920, 1080, 20.69], [2560, 1440, 27.59], [960, 540, 10.35]] as const) {
      const uPx = Math.max(0.6, Math.min(w / 1280, h / 720)); // hud.ts measure()
      const px = crosshairPx(GODOT.rest, uPx, true);
      expect(px).toBe(rest);
      const [t, b, l, r] = crosshairArms(px, uPx);
      expect(r).toBe(`translateX(${rest}px)`); // [data-xr]: the right arm's inner end
      expect(b).toBe(`translateY(${rest}px)`);
      expect(num(l)).toBeCloseTo(-rest - CROSSHAIR_ARM * uPx, 9); // the left arm's box starts one arm length further out
      expect(num(t)).toBeCloseTo(-rest - CROSSHAIR_ARM * uPx, 9);
    }
    expect(CROSSHAIR_ARM).toBe(9); // hud.gd:854: c + d × gap to c + d × (gap + 9)
  });
});

describe('H1 against a real slab sim (The Lot): the drawn gap is 5 + 420 × the sim\'s own spread, every tick', () => {
  let sim: Sim;
  let me: SimEntity;
  const xs = crosshairState();
  const RNG_SEED = 7;

  beforeAll(async () => {
    sim = await Sim.create({ seed: RNG_SEED, map: 'the_lot' });
    sim.state.room = { mode: 'slab' };
    sim.step();
    sim.drainEvents();
    // a human corgi on open dry ground 20 m south of the slab, facing north (-Z), toward it (east and west of the slab
    // the ground at z 0 wades a pet down to 1.9 m/s)
    const x = SLAB.center.x, z = SLAB.center.z + 20;
    me = sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls: SLAB.cls, name: 'me', x, y: sim.worldData.height(x, z) + 0.05, z, yaw: 0 });
    tick({}, 40);
  });
  afterAll(() => sim?.dispose());

  /** Step `n` ticks with one input; the HUD hears the frame's own `fire` events at the sim's clock (as hud.ts does). */
  function tick(inp: Partial<InputCmd>, n: number, each?: () => void): void {
    for (let i = 0; i < n; i++) {
      sim.setInput(me.id, { ...emptyInput(sim.tick), ...inp });
      sim.step();
      for (const ev of sim.drainEvents()) if (ev.e === 'fire' && ev.id === me.id) crosshairShot(xs, WEAPON_FX.squeaker_rifle.kick, RIFLE, sim.time);
      each?.();
    }
  }
  /** What the HUD draws now: from the snapshot as it comes over the wire (packed, velocities to 0.01 m/s). */
  const drawn = () => crosshairFrame(xs, unpackEntity(packEntity(sim.toState(me))), { slab: true, def: RIFLE, now: sim.time });
  const simGap = () => slabGap(currentSpread(me, RIFLE, me.wpn!));
  const speed = () => Math.hypot(me.vel.x, me.vel.z);

  it('at rest: 13.8 px', () => {
    expect(me.char!.grounded).toBe(true);
    expect(speed()).toBeLessThan(1e-3);
    expect(drawn()).toBeCloseTo(simGap(), 6);
    expect(drawn()).toBeCloseTo(GODOT.rest, 6);
  });

  it('aiming: 7.6 px', () => {
    tick({ buttons: Btn.Aim }, 3);
    expect((me.flags & EFlag.Aiming) !== 0).toBe(true);
    expect(drawn()).toBeCloseTo(simGap(), 6);
    expect(drawn()).toBeCloseTo(GODOT.aim, 6);
    tick({}, 3);
    expect(drawn()).toBeCloseTo(GODOT.rest, 6);
  });

  it('moving opens it through the spread: every tick of a run from rest, 18.2 px at the run speed', () => {
    const seen: number[] = [];
    tick({ mz: 1 }, 30, () => {
      expect(Math.abs(drawn() - simGap())).toBeLessThan(0.01); // the wire rounds velocity to 0.01 m/s: < 0.01 px
      seen.push(drawn());
    });
    expect(speed()).toBeCloseTo(6.4, 3); // the corgi's run speed (classes.ts BASE_MOVE, Godot tuning.gd MOVE[0].run)
    expect(Math.abs(drawn() - GODOT.run)).toBeLessThan(0.01);
    expect(seen[0]).toBeGreaterThan(GODOT.rest); // opens from the first moving tick
    expect(Math.abs(Math.max(...seen) - GODOT.run)).toBeLessThan(0.01); // and never past the run-speed cap
    tick({}, 40);
    expect(speed()).toBeLessThan(1e-3);
    expect(drawn()).toBeCloseTo(GODOT.rest, 6);
  });

  it('in the air: 24.4 px standing (× 2.2), back to 13.8 on landing', () => {
    let air = 0;
    tick({ buttons: Btn.Jump }, 1);
    tick({}, 12, () => {
      if (!me.char!.grounded) {
        air++;
        expect(Math.abs(drawn() - simGap())).toBeLessThan(0.01);
        expect(Math.abs(drawn() - godotGap(G.hip * G.air * (1 + (G.move - 1) * Math.min(1, speed() / G.run[0]))))).toBeLessThan(0.01);
      }
    });
    expect(air).toBeGreaterThan(5);
    expect(Math.abs(drawn() - GODOT.air)).toBeLessThan(0.05);
    tick({}, 60);
    expect(me.char!.grounded).toBe(true);
    expect(drawn()).toBeCloseTo(GODOT.rest, 6);
  });

  it('firing in place: no +4 and no kick; only the bloom, as the sim has it, gone within two ticks', () => {
    const seen: number[] = [];
    let shots = 0;
    const fired = me.wpn!.shots;
    tick({ buttons: Btn.Fire }, 60, () => {
      expect(drawn()).toBeCloseTo(simGap(), 9); // the bloom included
      seen.push(drawn());
    });
    shots = me.wpn!.shots - fired;
    expect(shots).toBeGreaterThanOrEqual(9); // 10 shots/s
    expect(Math.max(...seen)).toBeCloseTo(GODOT.shot, 6); // the web sim's shot-tick peak, 14.97 (the web's old rule: 18.5); Godot's live peak differs by sim order and cadence, see TW-VIEW-H1H20.md
    expect(seen.filter((g) => Math.abs(g - GODOT.rest) < 1e-9).length).toBeGreaterThan(30); // rest the rest of the time
    expect(Math.min(...seen)).toBeCloseTo(GODOT.rest, 9);
    expect(xs.kick).toBe(0); // the general HUD's kick never reaches a slab frame
    tick({}, 2);
    expect(drawn()).toBeCloseTo(GODOT.rest, 9);
  });

  it('a slow frame: three snapshots\' worth of fire heard at once leave the authority\'s bloom (one shot\'s), not three stacked', () => {
    tick({}, 30); // the trigger let go, the bloom gone
    const st = crosshairState();
    for (let f = 0; f < 3; f++) {
      // 20 ticks of fire; each own shot is stamped as main.ts stamps it: the tick of the snapshot that carries it
      const heard: Array<{ snapT: number; bloom: number }> = [];
      for (let i = 0; i < 20; i++) {
        sim.setInput(me.id, { ...emptyInput(sim.tick), buttons: Btn.Fire });
        sim.step();
        for (const ev of sim.drainEvents()) {
          if (ev.e === 'fire' && ev.id === me.id) heard.push({ snapT: Math.ceil(sim.tick / SNAPSHOT_EVERY) * SNAPSHOT_EVERY / TICK_HZ, bloom: me.wpn!.bloom });
        }
      }
      expect(heard.length).toBeGreaterThanOrEqual(3);
      const now = 200 + f; // the one HUD frame that hears them all
      for (const h of heard) crosshairShot(st, WEAPON_FX.squeaker_rifle.kick, RIFLE, now, h.snapT);
      expect(st.bloom).toBeCloseTo(heard[heard.length - 1].bloom, 12); // the authority's bloom as its last shot left
      expect(crosshairFrame(st, unpackEntity(packEntity(sim.toState(me))), { slab: true, def: RIFLE, now })).toBeCloseTo(GODOT.shot, 9);
    }
  });
});

/** HEAD's hud.ts crosshair (before W17 H1), copied as it was: the general HUD's rule for every mode but slab. */
function headRule(s: { spread: number; kick: number }, L: Pick<EntityState, 'flags' | 'vx' | 'vz'>): number {
  const f = L.flags;
  const sp = Math.hypot(L.vx, L.vz);
  let target = 7 + sp * 0.9;
  if ((f & EFlag.Grounded) === 0) target += 9;
  if ((f & EFlag.Sprinting) !== 0) target += 8;
  if ((f & EFlag.Firing) !== 0) target += 4;
  target += s.kick;
  if ((f & EFlag.Aiming) !== 0) target *= 0.5;
  s.kick *= 0.86;
  s.spread += (target - s.spread) * 0.3;
  return Math.round(s.spread * 1 * 2) / 2;
}
const headShot = (s: { kick: number }, fxKick: number) => { s.kick = Math.min(18, s.kick + 3.5 + fxKick * 30); };

describe('H1 every other mode keeps its crosshair exactly', () => {
  /** A scripted minute: rest, run, sprint, jump, fire with shots, aim, aim and fire, stop. */
  const script: Array<{ L: Pick<EntityState, 'flags' | 'vx' | 'vz' | 'species' | 'cls'>; shot?: boolean }> = [];
  for (let i = 0; i < 400; i++) {
    const phase = Math.floor(i / 40);
    const v = [0, 4, 6.4, 9.6, 5, 0, 0, 3.6, 0, 0][phase];
    const flags = EFlag.Grounded * (phase === 4 && i % 40 < 25 ? 0 : 1) | (phase === 3 ? EFlag.Sprinting : 0)
      | (phase === 5 || phase === 7 ? EFlag.Firing : 0) | (phase >= 6 && phase <= 8 ? EFlag.Aiming : 0);
    script.push({ L: { flags, vx: v * 0.6, vz: v * 0.8, species: (i % 2 ? Species.Cat : Species.Corgi) as SpeciesId, cls: 0 }, shot: (phase === 5 || phase === 7) && i % 6 === 0 });
  }

  it('a frame outside slab: the same gaps as HEAD\'s hud.ts, frame by frame (shots kick, +4 firing, halved aiming)', () => {
    const st: CrosshairState = crosshairState();
    const ref = { spread: 10, kick: 0 };
    let t = 0;
    const got: number[] = [], want: number[] = [];
    for (const fr of script) {
      t += 1 / 60;
      if (fr.shot) { crosshairShot(st, WEAPON_FX.squeaker_rifle.kick, RIFLE, t); headShot(ref, WEAPON_FX.squeaker_rifle.kick); }
      got.push(crosshairPx(crosshairFrame(st, fr.L, { slab: false, def: RIFLE, now: t }), 1, false));
      want.push(headRule(ref, fr.L));
    }
    expect(got).toEqual(want);
    expect(st.spread).toBe(ref.spread);
    expect(st.kick).toBe(ref.kick);
    // its own numbers: 7 px at rest after easing in from 10, wider on the move and in the air, +4 and kicks firing
    expect(want[0]).toBe(9);
    expect(want[39]).toBe(7);
    expect(want[79]).toBe(10.5); // 7 + 4 m/s × 0.9
    expect(Math.max(...want.slice(160, 200))).toBeGreaterThan(20); // airborne (+9) at 5 m/s
    expect(Math.max(...want.slice(200, 240))).toBeGreaterThan(14); // firing in place: +4 and the kicks
  });

  it('half-pixel snapping stays for them; slab keeps hud.gd\'s value to 0.01 px', () => {
    expect(crosshairPx(9.1, 1, false)).toBe(9);
    expect(crosshairPx(13.796, 1, false)).toBe(14);
    expect(crosshairPx(13.796, 1, true)).toBe(13.8);
    expect(crosshairPx(13.796, 1.5, true)).toBe(20.69);
  });

  it('hud.ts gates the rule on the match mode: slab only; it writes crosshairArms as they are; shots carry the sim time', () => {
    const src = readFileSync('src/client/ui/hud.ts', 'utf8');
    expect(src).toMatch(/const slabMode = m\.match\?\.mode === 'slab';/);
    expect(src).toMatch(/crosshairFrame\(xs, L, \{ slab: slabMode,/);
    expect(src).toMatch(/crosshairPx\(gap, uPx, slabMode\)/);
    expect(src).not.toMatch(/let spread = 10, kick = 0/); // one crosshair state, crosshair.ts's
    // the DOM write: crosshairArms(px, uPx), each transform written untouched (uPx is applied once, in crosshairPx)
    expect(src).toMatch(/const \[tt, tb, tl, tr\] = crosshairArms\(px, uPx\);/);
    for (const [el, t] of [['xt', 'tt'], ['xb', 'tb'], ['xl', 'tl'], ['xr', 'tr']]) expect(src).toContain(`setStyle(${el}, 'transform', ${t});`);
    expect(src).not.toMatch(/translate[XY]\(\$\{/); // no other crosshair transform
    // an own shot: crosshairShot(..., now, simT), simT from main.ts's serverSec() (the event's snapshot tick / tick rate)
    expect(src).toMatch(/onGameEvent\(ev, simT\) \{/);
    expect(src).toMatch(/crosshairShot\(xs, [^;]*, now, simT\);/);
    const main = readFileSync('src/client/main.ts', 'utf8');
    expect(main).toMatch(/hud\.onGameEvent\(ev, serverSec\(\)\);/);
    expect(main).toMatch(/const serverSec = \(\) => \(net\?\.latest\(\)\?\.tick \?\? 0\) \/ \(net\?\.tickHz \|\| 60\);/);
  });
});
