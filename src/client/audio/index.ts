// OWNER: L5 (juice). Audio director: maps GameEvents and entity motion to procedural sounds and drives the
// adaptive music from combat intensity. S2 added vehicle engine loops (vehicle-loops.ts), vehicle/destructible
// event voices (abilitySfx) and the adventure step/chapter stingers. W10 AU2: Base Assault's ball voices, calls and
// capture fanfare (presets-objective.ts) replace the generic pickup chime / score sting for its events, and its carrier
// tension drives the music's pulse layer (music-tension.ts); engine.focus follows the local character. W13 A-HOOK: a
// slab match plays the shared WAVs (slab-cues.ts, as Godot's sfx.gd): the rifle shot, the hit confirm, the slab ticks
// and the match end; `?sfxlog` prints `SFX <cue>` per cue. W15 D (Godot wins): those six are the ONLY event sounds in
// slab mode, and there is no music bed (Godot has none). Non-event sound (footsteps, the site's ambience) stays.
//
//   const audio = createAudio();                                   // attaches first-gesture unlock
//   bus.on('game', (ev) => audio.onGameEvent(ev));
//   // each frame, after net.interpolated():
//   audio.update(ctx.camera, states, net.localEntity, dt);          // listener + footsteps + music mix
//   hud actions: setSetting('masterVolume', v) → audio.setVolumes({ master: v }) (see docs/handoff/L5.md)
import type { Object3D } from 'three/webgpu';
import type { EntityState, GameEvent } from '../../shared/protocol';
import { EFlag, EntityKind, Species } from '../../shared/types';
import { planeByIndex } from '../../shared/content/vehicles';
import { AudioEngine, type PlayOptions, type Volumes } from './engine';
import { CombatIntensity, intensityFor, type IntensityContext } from './intensity';
import { Music } from './music';
import { speak } from './gibberish';
import * as S from './presets';
import { VehicleLoops } from './vehicle-loops';
import { createObjectiveAudio, type ObjectiveAudio } from './presets-objective';
import { WeaponTable, WEAPON_FX, type WeaponFxId } from '../fx/weapon-fx';
import { SurfaceMap, makeSurfaceHit, type SurfaceWorld } from '../fx/surfaces';
import { impactDelay } from '../fx/delays';
import { bus } from '../core/events';
import { SlabMatchCues, SlabSamples, slabCueGain, slabEventCue, SLAB_SHOT_MAX, SLAB_SHOT_REF, type SlabCuePlay } from './slab-cues';

/** Class ability → recipe (bark blast also barks; see the 'ability' case). */
const ABILITY_SFX: Record<string, S.Recipe> = {
  ear_glide: S.whoosh, shadow_cloak: S.poof, spotter_drone: S.droneWhir, dig_charge: S.chargeArm, squeak_barrier: S.squeakWall,
  // E1 sniper: the dot's life (paint → glint → shot, or lost / spoiled), her leaps and phase 2
  dot_paint: S.dotPing, dot_glint: S.glintTink, dot_lost: S.dotLost, shot_spoiled: S.clonk, sniper_leap: S.whoosh, beret_off: S.pop,
};

/** How one `ability` event sounds: recipe + variant, limiter category/priority, spatial reach. */
export interface AbilitySfx {
  recipe: S.Recipe;
  k: number;
  category: string;
  priority: number;
  /** Panner reference distance (m) and cull distance (m). */
  refDist: number;
  maxDist: number;
  gain: number;
  /** Vehicle events: played centered when they're the local rider's own. */
  vehicle: boolean;
}

const sfx = (recipe: S.Recipe, category: string, priority: number, refDist: number, maxDist: number, o: Partial<AbilitySfx> = {}): AbilitySfx =>
  ({ recipe, k: 0, category, priority, refDist, maxDist, gain: 1, vehicle: false, ...o });

/** S2: vehicle events (V1 kart, R1 plane; `id` = the vehicle). */
const VEHICLE_SFX: Record<string, AbilitySfx> = {
  // gains from the S2 offline renders (K-weighted 100 ms max; a local Squeaker shot ≈ −26): clunks level with a shot,
  // boost / bail / horn 2–3 dB over it, all well under a snap-pistol crack (≈ −18) — docs/handoff/S2.md §3
  mount: sfx(S.seatClunk, 'fx', 1, 4, 35, { k: 0, gain: 0.55, vehicle: true }),
  dismount: sfx(S.seatClunk, 'fx', 1, 4, 35, { k: 1, gain: 0.55, vehicle: true }),
  bail: sfx(S.bailPop, 'impact', 2, 5, 55, { gain: 0.75, vehicle: true }),
  boost: sfx(S.rocketFwoosh, 'fx', 1, 5, 55, { gain: 0.55, vehicle: true }),
  horn: sfx(S.honk, 'fx', 1, 6, 50, { gain: 0.35, vehicle: true }),
};

/** S2: X1 destructible breaks, `destruct:<kind>` (an unknown future kind gets the generic crate crunch). */
const DESTRUCT_PREFIX = 'destruct:';
const DESTRUCT_SFX: Record<string, AbilitySfx> = {
  wall_boards: sfx(S.woodCrash, 'impact', 2, 7, 90, { gain: 0.9 }),
  tuna_stack: sfx(S.canClatter, 'impact', 2, 5, 70, { gain: 0.9 }),
  crate_stack: sfx(S.crateCrunch, 'impact', 2, 6, 80, { gain: 0.8 }),
};

const classSfx = new Map<string, AbilitySfx>();
const WHOOMP = sfx(S.whoomp, 'impact', 2, 5, 55);

/** The sound for an `ability` event name (class abilities, boss cues, vehicle events, destructible breaks). */
export function abilitySfx(name: string): AbilitySfx {
  const v = VEHICLE_SFX[name];
  if (v) return v;
  if (name.startsWith(DESTRUCT_PREFIX)) return DESTRUCT_SFX[name.slice(DESTRUCT_PREFIX.length)] ?? DESTRUCT_SFX.crate_stack;
  const r = ABILITY_SFX[name];
  if (!r) return WHOOMP;
  let c = classSfx.get(name);
  if (!c) { c = sfx(r, 'impact', 2, 5, 55); classSfx.set(name, c); }
  return c;
}

/** Score reasons with their own UI stinger (A1 adventure); everything else gets the team sting. */
export const SCORE_STINGERS = { step: S.stepJingle, chapter: S.chapterFanfare } as const;

export type { Volumes } from './engine';
export type UiSound = 'click' | 'hover' | 'back' | 'open';

export interface GameAudio {
  readonly engine: AudioEngine;
  /** Call from a user gesture (e.g. the menu's Play button) — also happens automatically on the first gesture. */
  unlock(): Promise<boolean>;
  /** Listener = camera; footsteps from entity speed; music layers from combat intensity. */
  update(listener: Object3D, states: Map<number, EntityState>, localId: number, dt: number): void;
  onGameEvent(ev: GameEvent): void;
  setVolumes(v: Partial<Volumes>): void;
  ui(kind: UiSound): void;
  setWeaponIds(ids: readonly string[]): void;
  /** 'low' switches spatialization to equal-power panning (cheaper than HRTF). */
  setQuality(q: 'low' | 'medium' | 'high'): void;
  /** X3: the world, so bullet impacts sound like what they hit (ricochet off metal, thock on wood, splash). */
  setWorld(world: SurfaceWorld | null): void;
  /** Current combat intensity (0..1). */
  readonly intensity: number;
  /** W10 AU2: Base Assault audio (cue counts, the carrier tension). */
  readonly objective: ObjectiveAudio;
  dispose(): void;
}

/** X3: HARDENED reports per weapon (the L5 toy voices — squeakPew, snap, laserZap... — stay exported for labs). */
const FIRE: Record<WeaponFxId, S.Recipe> = {
  squeaker_rifle: S.rifleShot, snap_pistol: S.pistolShot, laser_longshot: S.sniperShot, tennis_mortar: S.mortarShot,
  sprinkler_cannon: S.shotgunBlast, frisbee_launcher: S.discLaunch, claw_swipe: S.whoosh, unknown: S.rifleShot,
};
/** Play gains (local, remote), set from offline renders (docs/handoff/X3.md §5): rifle ≈ −19 dB (100 ms RMS), level
 *  with a thwack; sniper, shotgun, mortar 3–5 dB over it; the suppressed pistol 3 dB under; an explosion stays loudest. */
const FIRE_GAIN: Record<WeaponFxId, [number, number]> = {
  squeaker_rifle: [0.6, 0.8], snap_pistol: [0.45, 0.6], laser_longshot: [0.7, 1], tennis_mortar: [0.52, 0.7],
  sprinkler_cannon: [0.62, 0.85], frisbee_launcher: [1, 1], claw_swipe: [0.5, 0.6], unknown: [0.6, 0.8],
};
/** Bullet impacts are texture: only near the listener, and at most one every 45 ms. */
const IMPACT_RANGE = 26;
const IMPACT_GAP = 0.045;

export function createAudio(opts: { maxVoices?: number; autoUnlock?: boolean; music?: boolean } = {}): GameAudio {
  const engine = new AudioEngine(opts.maxVoices ?? 28);
  const weapons = new WeaponTable();
  const intensity = new CombatIntensity();
  let music: Music | null = null;
  let states: Map<number, EntityState> = new Map();
  let localId = -1;
  let musicSetAt = 0;
  const barkNext = new Map<number, number>();
  const stepPhase = new Map<number, number>();
  let clock = 0;
  let loops: VehicleLoops | null = null;
  const surfaces = new SurfaceMap(null);
  const sHit = makeSurfaceHit();
  let impactAt = -1;
  // Adventure stingers: the last step of a chapter lands on the same tick as 'chapter' (+ 'win'), so the step
  // jingle waits one frame (it is dropped if the fanfare comes), and the fanfare mutes the team sting while it plays.
  let pendingStep = false;
  let fanfareUntil = -1;
  const objective = createObjectiveAudio(engine);
  const focus = { x: 0, y: 0, z: 0, species: 0 };
  // W13 A-HOOK: the slab match's cues. slabCues.active = the latest MatchState is a slab match (bus 'match' comes once
  // per snapshot, before that snapshot's events); the files load once the context exists.
  const slabCues = new SlabMatchCues();
  const slabSamples = new SlabSamples();
  const sfxLog = typeof location !== 'undefined' && new URLSearchParams(location.search).has('sfxlog');
  let slabLoadQueued = false;
  let slabMusicOff = false;
  /** Plays a slab cue from its file. Without the file (still loading, or missing) the cue stays silent, as in Godot;
   *  with ?sfxlog it prints `SFX <cue>`, or `SFX <cue> silent (<why>)` when it could not play. */
  const slabPlay = (c: SlabCuePlay): void => {
    const r = slabSamples.recipe(c.cue);
    const gain = slabCueGain(c.cue);
    const shot = c.cue === 'rifle_shot';
    const why = !engine.unlocked ? 'audio locked' : !r ? (slabSamples.get(c.cue) === null ? 'no file' : 'loading')
      : engine.play(r, c.at ? { x: c.at.x, y: c.at.y, z: c.at.z, gain, priority: 1, category: 'fire', refDist: SLAB_SHOT_REF, maxDist: SLAB_SHOT_MAX }
        : { bus: shot ? 'sfx' : 'ui', gain, priority: shot ? 2 : 3, category: shot ? 'fire' : 'ui' }) ? '' : 'culled';
    if (sfxLog) console.log(why ? `SFX ${c.cue} silent (${why})` : `SFX ${c.cue}`);
  };
  // your side for the slab cues: the local pet's team, kept while that pet is missing from a frame's states;
  // Corgi Company (0) with no local pet at all, as Godot's --bots-only (sfx.gd my_team)
  let slabTeam = 0;
  const offMatch = bus.on('match', (ms) => {
    const me = states.get(localId);
    if (me) slabTeam = me.team;
    else if (localId < 0) slabTeam = 0;
    for (const cue of slabCues.update(ms, slabTeam)) slabPlay({ cue });
    if (slabCues.active !== slabMusicOff) { // no music bed in slab mode: stop it on the way in, start it on the way out
      slabMusicOff = slabCues.active;
      if (slabMusicOff) music?.stop(); else if (engine.unlocked) music?.start();
    }
    if (slabCues.active && !slabLoadQueued) {
      slabLoadQueued = true;
      engine.whenReady((ctx) => { void slabSamples.load(ctx); });
    }
  });

  engine.whenReady((ctx) => {
    loops = new VehicleLoops(engine, ctx, engine.buses!.sfx);
    if (opts.music === false) return;
    music = new Music(ctx, engine.buses!.music);
    if (ctx.state === 'running' && !slabCues.active) music.start(); // W13 A-HOOK: no music bed in slab mode
    ctx.addEventListener('statechange', () => { if (ctx.state === 'running' && !slabCues.active) music?.start(); });
  });
  if (opts.autoUnlock !== false && typeof window !== 'undefined') engine.attachUnlock(window);

  const ictx: IntensityContext = { localId: -1, hasLocal: false, lx: 0, ly: 0, lz: 0, posOf: (id) => states.get(id) };
  const at = (id: number, extra: Partial<PlayOptions> = {}): PlayOptions => {
    const s = states.get(id);
    if (!s) return extra;
    // The local player's own sounds play 2D-ish (at the listener would pan erratically with camera shake).
    if (id === localId) return { ...extra, refDist: 6 };
    return { x: s.x, y: s.y + 0.8, z: s.z, ...extra };
  };
  const speciesOf = (id: number) => states.get(id)?.species ?? Species.Corgi;
  /** A vehicle event of the local rider's own vehicle (interpolated states lag ~0.1 s, so near the local pet counts). */
  const isLocalVehicleEvent = (vid: number, x: number, z: number): boolean => {
    const v = states.get(vid);
    if (v && v.kind === EntityKind.Vehicle && v.weapon === localId) return true;
    const me = states.get(localId);
    return !!me && Math.hypot(me.x - x, me.z - z) < 3;
  };

  // Footsteps: per-entity phase accumulators; cadence rises with speed (corgi legs are short → quicker patter).
  let frameDt = 0;
  const stepCb = (s: EntityState, id: number) => {
    if (s.kind !== EntityKind.Player && s.kind !== EntityKind.Bot) return;
    const f = s.flags;
    // Riders are Grounded with their vehicle's velocity: no footsteps while seated (S2).
    if ((f & EFlag.Grounded) === 0 || (f & (EFlag.Dead | EFlag.Mounted)) !== 0) { stepPhase.set(id, 0.6); return; }
    const sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz); // not Math.hypot: it allocates per call
    if (sp < 0.8) { stepPhase.set(id, 0.6); return; }
    if (id !== localId && engine.distanceTo(s.x, s.y, s.z) > 28) return;
    const cat = s.species === Species.Cat;
    const rate = (1.4 + sp * 0.36) * (cat ? 0.9 : 1.2);
    let ph = (stepPhase.get(id) ?? 0) + rate * frameDt;
    if (ph >= 1) {
      ph -= Math.floor(ph);
      const sprint = (f & EFlag.Sprinting) !== 0;
      const k = (cat ? 1 : 0) + (sprint ? 2 : 0);
      const stealth = (f & EFlag.Stealthed) !== 0 ? 0.35 : 1;
      engine.play(S.footstep, id === localId
        ? { k, gain: 0.55 * stealth, priority: 0, category: 'foot' }
        : { x: s.x, y: s.y, z: s.z, k, gain: 0.8 * stealth, priority: 0, category: 'foot', maxDist: 28, refDist: 2 });
    }
    stepPhase.set(id, ph);
  };

  const audio: GameAudio = {
    engine,
    objective,
    get intensity() { return intensity.level; },
    unlock: () => engine.unlock(),

    update(listener, st, lid, dt) {
      states = st;
      localId = lid;
      clock += dt;
      const e = listener.matrixWorld.elements;
      // Camera looks down its local −Z; up is local +Y.
      engine.setListener(e[12], e[13], e[14], -e[8], -e[9], -e[10], e[4], e[5], e[6]);
      frameDt = dt;
      if (engine.unlocked) {
        st.forEach(stepCb);
        loops?.update(st, lid, dt, intensity.level);
        if (pendingStep) {
          pendingStep = false;
          engine.play(SCORE_STINGERS.step, { bus: 'ui', gain: 0.85, priority: 2, category: 'ui' });
        }
      }
      // W10 AU2: the local character (threat-aware cues measure from it) and the carrier tension
      const me = st.get(lid);
      if (me && (me.flags & EFlag.Dead) === 0) { focus.x = me.x; focus.y = me.y + 0.6; focus.z = me.z; focus.species = me.species; engine.focus = focus; }
      else engine.focus = null;
      const tension = objective.update(st, lid, dt);
      intensity.update(dt);
      if (music && clock - musicSetAt > 0.25) { music.setIntensity(intensity.level); music.setTension(tension.level, tension.hunted); musicSetAt = clock; }
      if (stepPhase.size > 96) stepPhase.forEach((_, id) => { if (!st.has(id)) stepPhase.delete(id); });
    },

    onGameEvent(ev) {
      const me = states.get(localId);
      ictx.localId = localId; ictx.hasLocal = !!me;
      if (me) { ictx.lx = me.x; ictx.ly = me.y; ictx.lz = me.z; }
      intensity.add(intensityFor(ev, ictx));
      if (!engine.unlocked) {
        if (sfxLog && slabCues.active) { const c = slabEventCue(ev, localId); if (c) console.log(`SFX ${c.cue} silent (audio locked)`); }
        return;
      }
      // W15 D (lead ruling, Godot wins): in slab mode the twin plays only the event sounds Godot plays, the six shared
      // cues (the ticks and the end sting come from bus 'match' above). Every other event sound stays out there: the
      // brass and the impacts, the hit thwack, the death poof, voice, kill thump and stings, spawn, jump, land, reload
      // and bark sounds, and the synth stand-ins for a missing or loading file (Godot is silent then).
      if (slabCues.active) {
        const c = slabEventCue(ev, localId);
        if (c) slabPlay(c);
        return;
      }
      switch (ev.e) {
        case 'fire': {
          const w = weapons.id(ev.wpn);
          const g = FIRE_GAIN[w];
          const mine = ev.id === localId;
          engine.play(FIRE[w], mine ? { gain: g[0], priority: 2, category: 'fire' } : { x: ev.x, y: ev.y, z: ev.z, gain: g[1], priority: 1, category: 'fire', maxDist: 80, refDist: 4 });
          const fx = WEAPON_FX[w];
          // brass on the ground: your own gun only (everyone's would be noise)
          if (mine && fx.casing !== 'none') engine.play(S.brassTinkle, { k: fx.casing === 'shell' ? 1 : 0, gain: 0.5, priority: 0, category: 'foot' });
          // the bullet's impact, by surface (hitscan misses that land near you)
          if (ev.hit === -1 && (fx.tracer === 'bullet' || fx.tracer === 'laser' || fx.tracer === 'water') && clock - impactAt >= IMPACT_GAP
            && engine.distanceTo(ev.hx, ev.hy, ev.hz) < IMPACT_RANGE) {
            impactAt = clock;
            surfaces.classify(ev.hx, ev.hy, ev.hz, ev.dx, ev.dy, ev.dz, sHit);
            // lands with the visible impact (fx impactDelay: the tracer's flight / the spray's arc)
            const ddx = ev.hx - ev.x, ddy = ev.hy - ev.y, ddz = ev.hz - ev.z;
            const delay = impactDelay(fx.tracer, Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz));
            engine.play(S.impactSfx, { x: ev.hx, y: ev.hy, z: ev.hz, k: sHit.kind, gain: fx.klass === 'sniper' ? 0.9 : 0.55, priority: 0, category: 'impact', maxDist: IMPACT_RANGE, refDist: 2.5, delay });
          }
          break;
        }
        case 'hit': {
          engine.play(S.thwack, ev.dst === localId ? { k: ev.crit ? 1 : 0, gain: 0.9, priority: 3, category: 'hit' } : { x: ev.x, y: ev.y, z: ev.z, k: ev.crit ? 1 : 0, priority: 1, category: 'hit' });
          // X3: the shooter's confirmation is a body thud under the tick (same frame as the hitmarker)
          if (ev.src === localId && ev.dst !== localId) engine.play(S.hitThud, { bus: 'ui', k: ev.crit ? 1 : 0, gain: 0.75, priority: 3, category: 'ui' });
          break;
        }
        case 'death': {
          const cat = speciesOf(ev.id) === Species.Cat;
          engine.play(S.poof, at(ev.id, { priority: 2, category: 'impact' }));
          engine.play(cat ? S.meow : S.yelp, at(ev.id, { k: 2, gain: 0.7, priority: 1, category: 'voice' }));
          if (ev.by >= 0 && ev.by === localId && ev.id !== localId) { // a fall (by -1) is nobody's kill, also with no local pet
            engine.play(S.hitThud, { bus: 'ui', k: 2, gain: 0.8, priority: 3, category: 'ui' }); // X3: the kill thump
            engine.play(S.sting, { bus: 'ui', k: 0, priority: 3, category: 'ui' });
          }
          if (ev.id === localId) engine.play(S.sting, { bus: 'ui', k: 3, gain: 0.8, priority: 3, category: 'ui' });
          break;
        }
        case 'spawn':
          engine.play(S.sparkle, at(ev.id, { gain: ev.id === localId ? 0.8 : 0.6, priority: 1, category: 'fx' }));
          break;
        case 'jump': {
          const v = states.get(ev.id);
          if (v?.kind === EntityKind.Vehicle && planeByIndex(v.cls)) { // a plane's lift-off: a rising whoosh, not a pet's boing
            engine.play(S.whoosh, at(ev.id, { gain: 0.55, priority: 1, category: 'fx', maxDist: 45 }));
            break;
          }
          engine.play(S.boing, at(ev.id, { k: ev.double ? 1 : 0, gain: ev.id === localId ? 0.6 : 0.7, priority: ev.id === localId ? 2 : 0, category: 'fx', maxDist: 35 }));
          break;
        }
        case 'land':
          if (ev.impact > 3) engine.play(S.thud, at(ev.id, { k: ev.impact, gain: ev.id === localId ? 0.8 : 0.7, priority: ev.id === localId ? 2 : 0, category: 'impact', maxDist: 35 }));
          break;
        case 'explode':
          engine.play(S.boom, { x: ev.x, y: ev.y, z: ev.z, k: ev.r / 3, priority: 3, category: 'impact', maxDist: 120, refDist: 8 });
          break;
        case 'pickup':
          if (objective.onGameEvent(ev, localId, states)) break; // W10 AU2: the squeaky ball changes hands
          engine.play(S.chime, ev.id === localId ? { bus: 'ui', priority: 2, category: 'ui' } : at(ev.id, { priority: 1, category: 'fx' }));
          break;
        case 'bark': {
          const nextOk = barkNext.get(ev.id) ?? 0;
          if (clock < nextOk) break;
          barkNext.set(ev.id, clock + 0.8);
          const sp = speciesOf(ev.id);
          const cat = sp === Species.Cat;
          const line = ev.line || (cat ? 'mrrow?' : 'arf!');
          engine.play((v) => speak(v, sp, line), at(ev.id, { gain: 0.85, priority: 1, category: 'voice', maxDist: 40 }));
          engine.play(cat ? (line.toLowerCase().includes('s') ? S.hiss : S.meow) : S.bark, at(ev.id, { k: cat ? 1 : 0, gain: 0.6, priority: 1, category: 'voice', maxDist: 40 }));
          break;
        }
        case 'score': {
          if (objective.onGameEvent(ev, localId, states)) break; // W10 AU2: Base Assault's own cues
          if (ev.reason === 'step') { pendingStep = true; break; }
          if (ev.reason === 'chapter') {
            pendingStep = false;
            fanfareUntil = clock + 2.4;
            engine.play(SCORE_STINGERS.chapter, { bus: 'ui', gain: 0.85, priority: 3, category: 'ui' });
            break;
          }
          if (clock < fanfareUntil) break; // the chapter's 'win' lands with the fanfare: it already says so
          const mine = me ? ev.team === me.team : ev.team === 0;
          engine.play(S.sting, { bus: 'ui', k: mine ? 1 : 2, gain: 0.7, priority: 2, category: 'ui' });
          break;
        }
        case 'reload':
          engine.play(S.reloadClicks, at(ev.id, { gain: ev.id === localId ? 0.7 : 0.5, priority: ev.id === localId ? 2 : 0, category: 'fx', maxDist: 20 }));
          break;
        case 'ability': {
          // each class ability has its own voice (readability: you can hear what was used and where); vehicles
          // and destructibles too (S2); anything unmapped lands with a whoomp
          const a = abilitySfx(ev.ability);
          if (a.vehicle && isLocalVehicleEvent(ev.id, ev.x, ev.z)) engine.play(a.recipe, { k: a.k, gain: a.gain * 0.8, priority: a.priority + 1, category: a.category });
          else engine.play(a.recipe, { x: ev.x, y: ev.y, z: ev.z, k: a.k, gain: a.gain, priority: a.priority, category: a.category, refDist: a.refDist, maxDist: a.maxDist });
          if (ev.ability === 'bark_blast') engine.play(S.bark, { x: ev.x, y: ev.y + 1, z: ev.z, k: 0.8, gain: 1, priority: 2, category: 'voice', refDist: 6 });
          break;
        }
        default:
          break;
      }
    },

    setVolumes(v) { engine.setVolumes(v); },
    ui(kind) {
      const k = kind === 'click' ? 0 : kind === 'hover' ? 1 : kind === 'back' ? 2 : 3;
      engine.play(S.uiBlip, { bus: 'ui', k, priority: 1, category: 'ui' });
    },
    setWeaponIds(ids) { weapons.set(ids); },
    setQuality(q) { engine.panningModel = q === 'low' ? 'equalpower' : 'HRTF'; },
    setWorld(world) { surfaces.setWorld(world); },
    dispose() { offMatch(); music?.stop(); loops?.dispose(); loops = null; engine.dispose(); },
  };
  return audio;
}
