// OWNER: L5 (juice). Audio director: maps GameEvents and entity motion to procedural sounds and drives the
// adaptive music from combat intensity.
//
//   const audio = createAudio();                                   // attaches first-gesture unlock
//   bus.on('game', (ev) => audio.onGameEvent(ev));
//   // each frame, after net.interpolated():
//   audio.update(ctx.camera, states, net.localEntity, dt);          // listener + footsteps + music mix
//   hud actions: setSetting('masterVolume', v) → audio.setVolumes({ master: v }) (see docs/handoff/L5.md)
import type { Object3D } from 'three/webgpu';
import type { EntityState, GameEvent } from '../../shared/protocol';
import { EFlag, EntityKind, Species } from '../../shared/types';
import { AudioEngine, type PlayOptions, type Volumes } from './engine';
import { CombatIntensity, intensityFor, type IntensityContext } from './intensity';
import { Music } from './music';
import { speak } from './gibberish';
import * as S from './presets';
import { WeaponTable, type WeaponFxId } from '../fx/weapon-fx';

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
  /** Current combat intensity (0..1). */
  readonly intensity: number;
  dispose(): void;
}

const FIRE: Record<WeaponFxId, S.Recipe> = {
  squeaker_rifle: S.squeakPew, snap_pistol: S.snap, laser_longshot: S.laserZap, tennis_mortar: S.mortarThunk,
  sprinkler_cannon: S.sprinkler, frisbee_launcher: S.whoosh, unknown: S.squeakPew,
};

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

  engine.whenReady((ctx) => {
    if (opts.music === false) return;
    music = new Music(ctx, engine.buses!.music);
    if (ctx.state === 'running') music.start();
    ctx.addEventListener('statechange', () => { if (ctx.state === 'running') music?.start(); });
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

  // Footsteps: per-entity phase accumulators; cadence rises with speed (corgi legs are short → quicker patter).
  let frameDt = 0;
  const stepCb = (s: EntityState, id: number) => {
    if (s.kind !== EntityKind.Player && s.kind !== EntityKind.Bot) return;
    const f = s.flags;
    if ((f & EFlag.Grounded) === 0 || (f & EFlag.Dead) !== 0) { stepPhase.set(id, 0.6); return; }
    const sp = Math.hypot(s.vx, s.vz);
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
      if (engine.unlocked) st.forEach(stepCb);
      intensity.update(dt);
      if (music && clock - musicSetAt > 0.25) { music.setIntensity(intensity.level); musicSetAt = clock; }
      if (stepPhase.size > 96) stepPhase.forEach((_, id) => { if (!st.has(id)) stepPhase.delete(id); });
    },

    onGameEvent(ev) {
      const me = states.get(localId);
      ictx.localId = localId; ictx.hasLocal = !!me;
      if (me) { ictx.lx = me.x; ictx.ly = me.y; ictx.lz = me.z; }
      intensity.add(intensityFor(ev, ictx));
      if (!engine.unlocked) return;
      switch (ev.e) {
        case 'fire': {
          const w = weapons.id(ev.wpn);
          engine.play(FIRE[w], ev.id === localId ? { gain: 0.75, priority: 2, category: 'fire' } : { x: ev.x, y: ev.y, z: ev.z, gain: 0.9, priority: 1, category: 'fire', maxDist: 70, refDist: 4 });
          break;
        }
        case 'hit': {
          engine.play(S.thwack, ev.dst === localId ? { k: ev.crit ? 1 : 0, gain: 0.9, priority: 3, category: 'hit' } : { x: ev.x, y: ev.y, z: ev.z, k: ev.crit ? 1 : 0, priority: 1, category: 'hit' });
          if (ev.src === localId && ev.dst !== localId) engine.play(S.hitTick, { bus: 'ui', k: ev.crit ? 1 : 0, gain: 0.8, priority: 3, category: 'ui' });
          break;
        }
        case 'death': {
          const cat = speciesOf(ev.id) === Species.Cat;
          engine.play(S.poof, at(ev.id, { priority: 2, category: 'impact' }));
          engine.play(cat ? S.meow : S.yelp, at(ev.id, { k: 2, gain: 0.7, priority: 1, category: 'voice' }));
          if (ev.by === localId && ev.id !== localId) engine.play(S.sting, { bus: 'ui', k: 0, priority: 3, category: 'ui' });
          if (ev.id === localId) engine.play(S.sting, { bus: 'ui', k: 3, gain: 0.8, priority: 3, category: 'ui' });
          break;
        }
        case 'spawn':
          engine.play(S.sparkle, at(ev.id, { gain: ev.id === localId ? 0.8 : 0.6, priority: 1, category: 'fx' }));
          break;
        case 'jump':
          engine.play(S.boing, at(ev.id, { k: ev.double ? 1 : 0, gain: ev.id === localId ? 0.6 : 0.7, priority: ev.id === localId ? 2 : 0, category: 'fx', maxDist: 35 }));
          break;
        case 'land':
          if (ev.impact > 3) engine.play(S.thud, at(ev.id, { k: ev.impact, gain: ev.id === localId ? 0.8 : 0.7, priority: ev.id === localId ? 2 : 0, category: 'impact', maxDist: 35 }));
          break;
        case 'explode':
          engine.play(S.boom, { x: ev.x, y: ev.y, z: ev.z, k: ev.r / 3, priority: 3, category: 'impact', maxDist: 120, refDist: 8 });
          break;
        case 'pickup':
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
          const mine = me ? ev.team === me.team : ev.team === 0;
          engine.play(S.sting, { bus: 'ui', k: mine ? 1 : 2, gain: 0.7, priority: 2, category: 'ui' });
          break;
        }
        case 'reload':
          engine.play(S.reloadClicks, at(ev.id, { gain: ev.id === localId ? 0.7 : 0.5, priority: ev.id === localId ? 2 : 0, category: 'fx', maxDist: 20 }));
          break;
        case 'ability':
          // movement abilities swish (air), the rest land with a whoomp
          engine.play(ev.ability === 'ear_glide' ? S.whoosh : S.whoomp, { x: ev.x, y: ev.y, z: ev.z, priority: 2, category: 'impact', refDist: 5 });
          if (ev.ability === 'bark_blast') engine.play(S.bark, { x: ev.x, y: ev.y + 1, z: ev.z, k: 0.8, gain: 1, priority: 2, category: 'voice', refDist: 6 });
          break;
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
    dispose() { music?.stop(); engine.dispose(); },
  };
  return audio;
}
