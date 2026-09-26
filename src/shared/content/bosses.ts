// Boss set pieces as data (theme content, MASTER_PLAN §12). OWNER: boss lane (B1 Vac-Tank, E1 sniper elite).
// The authoritative boss systems (src/sim/boss) read these numbers; the client (src/client/procgen/boss)
// reads the same table for geometry anchors (muzzle, weak point), telegraph radii and timings, so a
// tuning change here moves the sim, the model and the FX together.
//
// Two kinds of boss share one table (BOSSES, indexed by EntityState.cls) and one entity kind:
//   'tank'   — The Vac-Tank (B1): a robot-vacuum war machine driven over the lawn by Baron Von Floof.
//   'sniper' — Madame Pointillé (E1): a Siamese sniper elite who "paints" her targets with a laser dot
//              from three perches across the lawn from the garage Rooftops (the laser-pointer duel).
//
// Snapshot encoding for EntityKind.Boss entities (no protocol change):
//   EntityState.cls    index into BOSSES
//   EntityState.yaw    turret/laser aim yaw (world); pitch = laser aim pitch
//   EntityState.flags  EFlag bits 0..11 as usual + the boss state in bits 16..26 (packBossFlags)
//   EntityState.x/y/z  feet (ground contact) like every character; the hit volume is a sphere of
//                      `radius` centered `radius` above the feet (L3's capsule with half-height 0).
// Units: meters, seconds, radians, hit points.
import type { ProjectileDef } from './weapons';

export const BOSS_IDS = ['vac_tank', 'madame_pointille'] as const;
export type BossId = (typeof BOSS_IDS)[number];
export type BossKind = 'tank' | 'sniper';

/** Attack / state ids carried in the snapshot flags (3 bits). */
export const BossAttack = { None: 0, Laser: 1, Mortar: 2, Spin: 3, Kittens: 4, PhaseShift: 5, Intro: 6, Dying: 7 } as const;
export type BossAttackId = (typeof BossAttack)[keyof typeof BossAttack];
export const BOSS_ATTACK_NAMES = ['none', 'laser', 'mortar', 'spin', 'kittens', 'phase_shift', 'intro', 'dying'] as const;

/** Stage of the current attack (2 bits). Telegraph always precedes any damage. */
export const BossStage = { Idle: 0, Telegraph: 1, Active: 2, Recover: 3 } as const;
export type BossStageId = (typeof BossStage)[keyof typeof BossStage];

/**
 * `GameEvent.ability` names emitted by bosses (id = boss entity; x,y,z as noted). FX/audio/HUD key off
 * these; the avatar also accepts them as `trigger()` actions.
 */
export const BOSS_ABILITY = {
  /** Spawn drop-in (x,y,z = landing spot). */
  intro: 'boss_intro',
  /** Laser telegraph starts: the red dot appears (x,y,z = first dot position on the ground). */
  laserPaint: 'laser_pointer',
  /** Telegraph over, the dot locks and the beam sweeps (x,y,z = locked dot = centre of the sweep arc). */
  laserSweep: 'laser_sweep',
  /** Hairball wind-up (x,y,z = boss feet). */
  mortarWindup: 'hairball_windup',
  /** One hairball launched (x,y,z = its exact landing point = centre of the warning circle). */
  mortarShell: 'hairball_mortar',
  /** Brush spin wind-up (x,y,z = boss feet; danger radius = spin.radius). */
  spinWindup: 'brush_spin',
  /** Brush spin sweep starts (x,y,z = boss feet). */
  spinGo: 'brush_spin_go',
  /** Rear hatch opens and kittens pop out (x,y,z = hatch). */
  kittens: 'kitten_deploy',
  /** Phase 2: the lid pops off (x,y,z = lid). */
  lidPop: 'lid_pop',
  /** Defeat: the pilot is ejected and flies off (x,y,z = pilot seat). */
  eject: 'pilot_eject',
} as const;

export interface WeakZone {
  /** Vertical extent above the feet (m) and radius of the pilot capsule around the turret axis. */
  y0: number;
  y1: number;
  r: number;
}

/** Fields every boss has (boss bar, hp scaling, taunts). */
export interface BossBase {
  id: BossId;
  kind: BossKind;
  /** Boss bar title. */
  name: string;
  /** Who says the taunts (bark subtitles: "Speaker: “line”"). */
  speaker: string;
  /** Boss bar suffix in phase 2 (e.g. "LID OFF!"). */
  phase2Label: string;
  /**
   * Max hp = baseHp + hpPerExtraPlayer × (squad − 1). The squad counts human corgis as 1 and corgi bots
   * as `botWeight` each (bots that can't reach a boss shouldn't make a solo player's fight longer).
   */
  baseHp: number;
  hpPerExtraPlayer: number;
  botWeight: number;
  /** Points for the squad on defeat (`score` event, reason 'boss'). */
  score: number;
  /** Visual top (crown / ears) for nameplates/camera. */
  height: number;
  /** Seconds of the intro (invulnerable, no attacks). */
  intro: number;
  /** Minimum seconds between two taunts. */
  barkCooldown: number;
}

/** The Vac-Tank (B1): hp sphere + turret + mortar + brushes + kitten hatch. */
export interface VacTankDef extends BossBase {
  kind: 'tank';
  pilot: string;
  /** Hit sphere radius (m), centred `radius` above the feet. Also the KCC collider and the push-out body. */
  radius: number;
  /** Top of the chassis disc. */
  deckY: number;
  /** Spawn height above the ground for the drop-in. */
  dropHeight: number;
  move: {
    speed: number;
    /** Chassis turn rate (rad/s). */
    turnRate: number;
    accel: number;
    decel: number;
    /** Preferred distance band to the current target (m, centre to feet). */
    band: [number, number];
    /** Max distance from the arena anchor (spawn) before it heads back. */
    leash: number;
  };
  turret: {
    /** Laser barrel pivot: `pivotFwd` ahead of the axis along the aim yaw, `pivotY` up. */
    pivotFwd: number;
    pivotY: number;
    /** Barrel length from the pivot to the lens along the aim direction. */
    barrel: number;
    /** Mortar tubes: behind the axis (along -aim yaw) and height. */
    mortarBack: number;
    mortarY: number;
    /** Kitten hatch: behind the chassis (along -heading), height. */
    hatchBack: number;
    hatchY: number;
  };
  weak: { mult: number; phase1: WeakZone; phase2: WeakZone };
  /** Damage multiplier for hits that are not on the weak point. */
  hullMult: number;
  phase2: {
    /** Health fraction that triggers phase 2. */
    at: number;
    /** Attack timings ÷ speedup (telegraphs never drop below MIN_TELEGRAPH). */
    speedup: number;
    moveMult: number;
    dmgMult: number;
    /** Phase-shift sequence length and the moment kittens are released. */
    shiftTime: number;
    kittensAt: number;
  };
  /** Vulnerable pause after every attack (the punish window). */
  recover: number;
  laser: {
    telegraph: number;
    sweep: number;
    /** Half-angle of the sweep arc around the locked dot. */
    arc: number;
    damage: number;
    /** How fast the dot runs across the ground toward the target (m/s). */
    dotSpeed: number;
    minRange: number;
    maxRange: number;
    /** A `fire` event (beam segment for FX/audio) every N ticks while sweeping. */
    fireEvery: number;
  };
  mortar: {
    windup: number;
    count: number;
    /** Shells per volley in phase 2. */
    countP2: number;
    stagger: number;
    /** Flight time of each hairball = how long its warning circle is up before it lands. */
    flight: number;
    gravity: number;
    /** Lateral spacing when several shells bracket one target. */
    bracket: number;
    minRange: number;
    maxRange: number;
    /** Blast handed to the combat lane's explode() (falloff, LOS, knockback). */
    blast: ProjectileDef;
  };
  spin: {
    windup: number;
    duration: number;
    radius: number;
    damage: number;
    knockback: number;
    knockUp: number;
    /** Characters whose feet are more than this above the boss's feet are jumped clear of the brushes. */
    maxFeet: number;
    /** Enemies closer than this make the boss spin. */
    trigger: number;
    cooldown: number;
  };
  kittens: { windup: number; count: number; stagger: number; cooldown: number; maxAlive: number };
}

/** Hard floor for every telegraph / wind-up / warning (s), whatever the phase speed-up. */
export const MIN_TELEGRAPH = 0.8;

const DEG = Math.PI / 180;

const HAIRBALL_BLAST: ProjectileDef = {
  speed: 0, gravity: -22, radius: 0.35, lifetime: 3, bounces: 0, restitution: 0, bounceBonus: 0,
  explodeRadius: 3.6, explodeDamage: 44, explodeInner: 0.8, explodeEdgeFrac: 0.25, selfDamageMult: 0,
  knockback: 8, fuse: true,
};

/**
 * The Vac-Tank: a smug Maine Coon (Baron Von Floof) driving a robot vacuum turned war machine —
 * tread undercarriage, crimson disc chassis with cardboard armor, a laser-pointer cannon, cardboard
 * mortar tubes full of hairballs and a rear hatch full of kittens.
 */
export const VAC_TANK: VacTankDef = {
  id: 'vac_tank',
  kind: 'tank',
  name: 'The Vac-Tank',
  pilot: 'Baron Von Floof',
  speaker: 'Baron Von Floof',
  phase2Label: 'LID OFF!',
  // Calibrated with headless fights (L3 bots vs boss, West Yard): 4 → 29.9k ≈ 3.2 min, 2 → 15.3k.
  baseHp: 8000,
  hpPerExtraPlayer: 7300,
  botWeight: 1,
  score: 25,
  radius: 2.5,
  height: 5,
  deckY: 2.45,
  intro: 2.4,
  dropHeight: 12,
  move: { speed: 2.7, turnRate: 1.3, accel: 5, decel: 7, band: [10, 19], leash: 42 },
  turret: { pivotFwd: 1.05, pivotY: 2.8, barrel: 1.25, mortarBack: 0.95, mortarY: 3.35, hatchBack: 3.3, hatchY: 1.4 },
  weak: {
    mult: 2,
    phase1: { y0: 3.55, y1: 4.85, r: 0.62 },
    phase2: { y0: 3.0, y1: 4.85, r: 0.9 },
  },
  hullMult: 1,
  phase2: { at: 0.5, speedup: 1.3, moveMult: 1.15, dmgMult: 1.1, shiftTime: 2.6, kittensAt: 1.4 },
  recover: 1.5,
  laser: { telegraph: 1.3, sweep: 1.0, arc: 18 * DEG, damage: 32, dotSpeed: 8, minRange: 6, maxRange: 42, fireEvery: 6 },
  mortar: { windup: 1.05, count: 3, countP2: 4, stagger: 0.22, flight: 1.5, gravity: -22, bracket: 3.8, minRange: 7, maxRange: 45, blast: HAIRBALL_BLAST },
  spin: { windup: 1.1, duration: 0.9, radius: 6, damage: 22, knockback: 14, knockUp: 6.5, maxFeet: 1.1, trigger: 8, cooldown: 6 },
  kittens: { windup: 1.05, count: 3, stagger: 0.28, cooldown: 22, maxAlive: 2 },
  barkCooldown: 7,
};

// ------------------------------------------------------------------ E1: the Siamese sniper elite

/** Sniper state ids carried in the snapshot flags (the same 3 bits as BossAttack). */
export const SniperAct = { None: 0, Track: 1, Lob: 2, Leap: 3, Stagger: 4, PhaseShift: 5, Intro: 6, Dying: 7 } as const;
export type SniperActId = (typeof SniperAct)[keyof typeof SniperAct];
export const SNIPER_ACT_NAMES = ['none', 'track', 'lob', 'leap', 'stagger', 'phase_shift', 'intro', 'dying'] as const;

/**
 * `GameEvent.ability` names emitted by the sniper (id = boss entity). The shot itself is an ordinary
 * `fire` event (wpn = laser_longshot) so the FX/audio lanes draw the laser beam and play the zap; the
 * hairball lob reuses the Vac-Tank's `hairball_windup` / `hairball_mortar` (warning circle) events.
 */
export const SNIPER_ABILITY = {
  /** The dot appears and sweeps onto a target (x,y,z = where it first lands). Audio: a soft "ping". */
  paint: 'dot_paint',
  /** The device glints: the shot comes in `track.glint` s (x,y,z = lens = weak point). Audio: a "tink". */
  glint: 'dot_glint',
  /** The target broke line of sight long enough: the lock is lost (x,y,z = the last dot). */
  lost: 'dot_lost',
  /** A weak-point hit during the glint spoiled the shot: she staggers (x,y,z = lens). */
  spoiled: 'shot_spoiled',
  /** Relocation starts: a readable crouch, then a leap (x,y,z = destination perch feet: draw a marker). */
  leap: 'sniper_leap',
  /** Phase 2: the beret flies off (x,y,z = head). */
  beretOff: 'beret_off',
} as const;

/** A sniper perch: feet on a surface, facing yaw (0 = -Z). */
export interface SniperPerch { id: string; name: string; x: number; y: number; z: number; yaw: number }

/** Madame Pointillé (E1): a character-sized, kinematic boss that holds perches and paints targets. */
export interface SniperDef extends BossBase {
  kind: 'sniper';
  /** Model scale relative to a regular cat; the hit capsule scales with it. */
  scale: number;
  capsule: { r: number; halfH: number };
  /**
   * Aim pivot (the rifle's shoulder pivot: `pivotY` above the feet, `side` m to her right) and the laser
   * device's reach along the aim from it — matched to the model's muzzle in the aim pose. The device (lens)
   * is the beam origin, the glint and the weak point (a sphere of radius `r` around the lens).
   */
  lens: { pivotY: number; side: number; reach: number; r: number };
  /** Damage multiplier for shots through the device (crit). */
  weak: { mult: number };
  track: {
    /** Seconds of painted tracking before the shot (phase 1 / 2; never below MIN_TELEGRAPH). */
    time: number;
    timeP2: number;
    /** How fast the aim point (so the dot) chases the target's chest (m/s at the target): sprinting outruns phase 1. */
    dotSpeed: number;
    dotSpeedP2: number;
    /** Line of sight broken this long (s) loses the lock: the dot drifts off and she re-acquires from zero. */
    lose: number;
    /** While the target is hidden, tracking progress drains `decay`× as fast as it builds. */
    decay: number;
    /** The device glints for the last `glint` s of the track: a weak-point hit then spoils the shot. */
    glint: number;
    /** Acquisition range (m); the dot starts `sweepIn` m to the side of its target and sweeps onto it. */
    range: number;
    sweepIn: number;
  };
  shot: { damage: number; knockback: number };
  /** Pause after a shot (the punish window) and after a spoiled shot. */
  recover: number;
  stagger: number;
  /** Pause between attacks (s, random in range). */
  idle: [number, number];
  /** Hairball lob: flushes a target that hid behind cover. */
  lob: {
    windup: number;
    /** Flight time = how long each warning circle is up before it lands. */
    flight: number;
    count: number;
    countP2: number;
    bracket: number;
    /** A lost target still hidden this long (s) earns a lob at its last seen spot. */
    hiddenFor: number;
    cooldown: number;
    minRange: number;
    maxRange: number;
    gravity: number;
    /** Launch height above the feet (her mouth). */
    mouthY: number;
    blast: ProjectileDef;
  };
  relocate: {
    /** Seconds on a perch before she moves on (phase 1 / 2, random in range). */
    every: [number, number];
    everyP2: [number, number];
    /** Damage taken on one perch (fraction of max hp) that makes her move. */
    hurtFrac: number;
    /** An enemy this close (and level with her) makes her move. */
    close: number;
    /** Crouch before the leap (readable) and the landing recovery. */
    windup: number;
    land: number;
    /** Longest single leap (m); longer trips hop via the perch nearest the midpoint. */
    maxLeap: number;
  };
  phase2: { at: number; speedup: number; dmgMult: number; shiftTime: number };
  /** Default perches (West Yard). spawnBoss can pass others; index 0 is where she starts. */
  perches: SniperPerch[];
}

const yawFacing = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));
/** Garage roof (D3's Rooftops) centroid: every West Yard sniper perch faces it. */
const ROOFTOPS_C = { x: 78.5, z: -55 };
const westYardPerch = (id: string, name: string, x: number, y: number, z: number): SniperPerch => ({ id, name, x, y, z, yaw: yawFacing(x, z, ROOFTOPS_C.x, ROOFTOPS_C.z) });

/**
 * West Yard perches, across the lawn from the garage Rooftops (the patio side, 44–92 m from the roof
 * perches). Each has its own character: the umbrella (mid range, 12 m up), the house roof edge (long
 * range, 30 m up, overlooks everything) and the kettle-grill lid (close, low, easy to flank). They sit on
 * visual-only surfaces (umbrella canopy, the eave in front of the house collider, the lid dome): the sniper
 * is kinematic, so nothing under her needs a collider — and when she is defeated she tumbles off.
 */
export const WEST_YARD_SNIPER_PERCHES: SniperPerch[] = [
  westYardPerch('patio_umbrella', 'Patio umbrella', 23, 12.1, -90),
  westYardPerch('house_eave', 'House roof edge', -5, 30.1, -97.5),
  westYardPerch('grill_lid', 'Kettle grill lid', 43.4, 5.6, -91.3),
];

const LOB_BLAST: ProjectileDef = {
  speed: 0, gravity: -22, radius: 0.35, lifetime: 3, bounces: 0, restitution: 0, bounceBonus: 0,
  explodeRadius: 3.2, explodeDamage: 34, explodeInner: 0.7, explodeEdgeFrac: 0.25, selfDamageMult: 0,
  knockback: 9, fuse: true,
};

/**
 * Madame Pointillé, the Dot Artiste: an elite Siamese sniper (1.4× a cat) in a crimson beret who
 * "paints" her subjects with a laser dot before every shot. Original character.
 */
export const MADAME_POINTILLE: SniperDef = {
  id: 'madame_pointille',
  kind: 'sniper',
  name: 'Madame Pointillé',
  speaker: 'Madame Pointillé',
  phase2Label: 'BERET OFF!',
  baseHp: 2200,
  hpPerExtraPlayer: 1600,
  botWeight: 1,
  score: 20,
  height: 1.78,
  intro: 1.8,
  barkCooldown: 6,
  scale: 1.4,
  capsule: { r: 0.46, halfH: 0.42 },
  lens: { pivotY: 0.9, side: 0.17, reach: 1.44, r: 0.24 },
  weak: { mult: 2 },
  track: { time: 1.1, timeP2: 0.85, dotSpeed: 8.5, dotSpeedP2: 11.5, lose: 0.45, decay: 1.5, glint: 0.45, range: 125, sweepIn: 3.2 },
  shot: { damage: 44, knockback: 4 },
  recover: 1.3,
  stagger: 1.5,
  idle: [0.5, 1.0],
  lob: { windup: 0.7, flight: 1.4, count: 1, countP2: 2, bracket: 2.8, hiddenFor: 1.2, cooldown: 7, minRange: 8, maxRange: 80, gravity: -22, mouthY: 1.5, blast: LOB_BLAST },
  relocate: { every: [16, 22], everyP2: [10, 14], hurtFrac: 0.14, close: 5.5, windup: 0.45, land: 0.35, maxLeap: 36 },
  phase2: { at: 0.5, speedup: 1.3, dmgMult: 1.1, shiftTime: 1.6 },
  perches: WEST_YARD_SNIPER_PERCHES,
};

export type BossDef = VacTankDef | SniperDef;

/** Every boss; EntityState.cls = index here (append only: snapshots carry the number). */
export const BOSSES: readonly BossDef[] = [VAC_TANK, MADAME_POINTILLE];

export const isTankDef = (d: BossDef): d is VacTankDef => d.kind === 'tank';
export const isSniperDef = (d: BossDef): d is SniperDef => d.kind === 'sniper';

/** Hairball blast + flight time for either boss (phase 2 flies faster, never under MIN_TELEGRAPH + 0.35). */
export function hairballSpec(def: BossDef, phase2: boolean): { blast: ProjectileDef; flight: number } {
  const flight = def.kind === 'tank' ? def.mortar.flight : def.lob.flight;
  return { blast: def.kind === 'tank' ? def.mortar.blast : def.lob.blast, flight: bossTime(def, flight, phase2, MIN_TELEGRAPH + 0.35) };
}

/** Seconds of painted tracking before a shot (never below the fairness floor). */
export function sniperTrackTime(def: SniperDef, phase2: boolean): number {
  return Math.max(MIN_TELEGRAPH, phase2 ? def.track.timeP2 : def.track.time);
}

/** Snapshot `ammo` of a sniper = dot distance from the lens along the aim, in these units per meter (0 = no beam). */
export const SNIPER_DOT_SCALE = 100;

/** Aim pivot (the rifle's shoulder pivot, to her right) of a sniper at feet (x, y, z) aiming at `yaw`. */
export function sniperPivot(def: SniperDef, x: number, y: number, z: number, yaw: number, out: P3): P3 {
  out.x = x + Math.cos(yaw) * def.lens.side;
  out.y = y + def.lens.pivotY;
  out.z = z - Math.sin(yaw) * def.lens.side;
  return out;
}

/** Laser device (lens = beam origin = weak point) for a sniper at feet (x,y,z) aiming (yaw, pitch). */
export function sniperLens(def: SniperDef, x: number, y: number, z: number, yaw: number, pitch: number, out: P3): P3 {
  const c = Math.cos(pitch);
  sniperPivot(def, x, y, z, yaw, out);
  out.x += -Math.sin(yaw) * c * def.lens.reach;
  out.y += Math.sin(pitch) * def.lens.reach;
  out.z += -Math.cos(yaw) * c * def.lens.reach;
  return out;
}

/** The laser dot of a sniper snapshot (null when the beam is off): lens + aim × ammo / SNIPER_DOT_SCALE. */
export function sniperDot(def: SniperDef, s: { x: number; y: number; z: number; yaw: number; pitch: number; ammo: number }, out: P3): P3 | null {
  if (!(s.ammo > 0)) return null;
  sniperLens(def, s.x, s.y, s.z, s.yaw, s.pitch, out);
  const d = s.ammo / SNIPER_DOT_SCALE, c = Math.cos(s.pitch);
  out.x += -Math.sin(s.yaw) * c * d;
  out.y += Math.sin(s.pitch) * d;
  out.z += -Math.cos(s.yaw) * c * d;
  return out;
}

/** Is the device glinting (the weak-point window before a shot) in this flag state? */
export function sniperGlinting(def: SniperDef, f: BossFlagState): boolean {
  if (f.attack !== SniperAct.Track || f.stage !== BossStage.Telegraph) return false;
  return f.progress >= 1 - def.track.glint / sniperTrackTime(def, f.phase2) - 1e-6;
}

/**
 * HUD helper: is a sniper boss snapshot painting a character standing at feet (x, y, z) right now (the dot on
 * its body while she tracks)? For a "DOT ON YOU" cue on the local player. Pure; any boss state is accepted.
 */
export function sniperPainting(s: { cls: number; flags: number; x: number; y: number; z: number; yaw: number; pitch: number; ammo: number }, x: number, y: number, z: number, height = 1.3): boolean {
  const def = BOSSES[s.cls];
  if (!def || def.kind !== 'sniper') return false;
  const f = unpackBossFlags(s.flags, paintScratch);
  if (f.attack !== SniperAct.Track || f.stage !== BossStage.Telegraph) return false;
  const d = sniperDot(def, s, paintDot);
  return !!d && Math.hypot(d.x - x, d.z - z) < 1.2 && d.y > y - 0.3 && d.y < y + height + 0.3;
}
const paintScratch: BossFlagState = { attack: 0, stage: 0, phase2: false, progress: 0 };
const paintDot: P3 = { x: 0, y: 0, z: 0 };

/** One hop of a relocation: a parabolic leap from the previous point to (x, y, z) in `t` s with `bump` m of arc. */
export interface SniperHop { x: number; y: number; z: number; t: number; bump: number }

/** Leap time and arc for a hop of horizontal length d (m) and height change dy. */
export function leapShape(d: number, dy: number): { t: number; bump: number } {
  return { t: Math.min(1.9, Math.max(0.8, 0.5 + d / 24 + Math.max(0, dy) / 30)), bump: 2 + 0.07 * d + Math.max(0, dy) * 0.25 };
}

/** Relocation route between two perches: one leap, or two via the perch nearest the midpoint when too far. */
export function sniperRoute(def: SniperDef, perches: readonly SniperPerch[], from: number, to: number, out: SniperHop[] = []): SniperHop[] {
  out.length = 0;
  const a = perches[from], b = perches[to];
  const hop = (p: SniperPerch, q: SniperPerch) => { const s = leapShape(Math.hypot(q.x - p.x, q.z - p.z), q.y - p.y); out.push({ x: q.x, y: q.y, z: q.z, t: s.t, bump: s.bump }); };
  if (Math.hypot(b.x - a.x, b.z - a.z) > def.relocate.maxLeap) {
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    let via = -1, vd = Infinity;
    for (let i = 0; i < perches.length; i++) {
      if (i === from || i === to) continue;
      const d = Math.hypot(perches[i].x - mx, perches[i].z - mz);
      if (d < vd) { vd = d; via = i; }
    }
    if (via >= 0) { hop(a, perches[via]); hop(perches[via], b); return out; }
  }
  hop(a, b);
  return out;
}

/** Position (and velocity) along one hop at time t ∈ [0, hop.t] from (sx, sy, sz): chord + parabolic bump. */
export function hopAt(sx: number, sy: number, sz: number, h: SniperHop, t: number, pos: P3, vel?: P3): P3 {
  const u = Math.min(1, Math.max(0, t / h.t));
  pos.x = sx + (h.x - sx) * u;
  pos.z = sz + (h.z - sz) * u;
  pos.y = sy + (h.y - sy) * u + 4 * h.bump * u * (1 - u);
  if (vel) {
    vel.x = (h.x - sx) / h.t;
    vel.z = (h.z - sz) / h.t;
    vel.y = ((h.y - sy) + 4 * h.bump * (1 - 2 * u)) / h.t;
  }
  return pos;
}


export function bossIndex(id: string): number {
  return BOSSES.findIndex((b) => b.id === id);
}

/** Boss definition for a snapshot `cls` (falls back to the first boss). */
export function bossByIndex(i: number): BossDef {
  return BOSSES[i] ?? BOSSES[0];
}

/** Phase-scaled duration (phase 2 runs faster), never below `floor`. */
export function bossTime(def: BossDef, seconds: number, phase2: boolean, floor = 0): number {
  return Math.max(floor, phase2 ? seconds / def.phase2.speedup : seconds);
}

/** Weak-point zone for the current phase. */
export function weakZone(def: VacTankDef, phase2: boolean): WeakZone {
  return phase2 ? def.weak.phase2 : def.weak.phase1;
}

/** Max hp for a squad of `players` corgi combatants (bots already weighted by `botWeight`; may be fractional). */
export function bossMaxHp(def: BossDef, players: number): number {
  return Math.round(def.baseHp + def.hpPerExtraPlayer * Math.max(0, Math.max(1, players) - 1));
}

// ------------------------------------------------------------------ snapshot flags

export const BOSS_FLAG_ATTACK_SHIFT = 16;
export const BOSS_FLAG_STAGE_SHIFT = 19;
export const BOSS_FLAG_PHASE2 = 1 << 21;
export const BOSS_FLAG_PROGRESS_SHIFT = 22;
/** Every bit the boss state uses (bits 16..26); EFlag keeps bits 0..15. */
export const BOSS_FLAG_MASK = (0x7 << BOSS_FLAG_ATTACK_SHIFT) | (0x3 << BOSS_FLAG_STAGE_SHIFT) | BOSS_FLAG_PHASE2 | (0x1f << BOSS_FLAG_PROGRESS_SHIFT);

/** Boss state bits (OR them into EntityState.flags). `progress` is 0..1 through the current stage. */
export function packBossFlags(attack: number, stage: number, phase2: boolean, progress: number): number {
  const p = Math.max(0, Math.min(31, Math.floor(progress * 32)));
  return ((attack & 0x7) << BOSS_FLAG_ATTACK_SHIFT) | ((stage & 0x3) << BOSS_FLAG_STAGE_SHIFT) | (phase2 ? BOSS_FLAG_PHASE2 : 0) | (p << BOSS_FLAG_PROGRESS_SHIFT);
}

export interface BossFlagState { attack: BossAttackId; stage: BossStageId; phase2: boolean; progress: number }

export function unpackBossFlags(flags: number, out: BossFlagState = { attack: 0, stage: 0, phase2: false, progress: 0 }): BossFlagState {
  out.attack = ((flags >>> BOSS_FLAG_ATTACK_SHIFT) & 0x7) as BossAttackId;
  out.stage = ((flags >>> BOSS_FLAG_STAGE_SHIFT) & 0x3) as BossStageId;
  out.phase2 = (flags & BOSS_FLAG_PHASE2) !== 0;
  out.progress = ((flags >>> BOSS_FLAG_PROGRESS_SHIFT) & 0x1f) / 31;
  return out;
}

// ------------------------------------------------------------------ geometry shared by sim + client

export interface P3 { x: number; y: number; z: number }

/** Laser lens (beam origin) in world space for a boss at feet (x,y,z) aiming (yaw, pitch). */
export function bossMuzzle(def: VacTankDef, x: number, y: number, z: number, yaw: number, pitch: number, out: P3): P3 {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), c = Math.cos(pitch);
  const t = def.turret;
  out.x = x + fx * t.pivotFwd + fx * c * t.barrel;
  out.y = y + t.pivotY + Math.sin(pitch) * t.barrel;
  out.z = z + fz * t.pivotFwd + fz * c * t.barrel;
  return out;
}

/**
 * Where a ray from (ox,oy,oz) along unit (dx,dy,dz) meets the ground `height(x,z)` (march + bisect),
 * or the end point at maxT. Used by the sim for the laser dot and by the client to draw it.
 */
export function rayGround(height: (x: number, z: number) => number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, out: P3): P3 {
  const step = 0.5;
  let prev = 0;
  for (let t = step; ; t += step) {
    const tt = Math.min(t, maxT);
    const y = oy + dy * tt, gx = ox + dx * tt, gz = oz + dz * tt;
    if (y <= height(gx, gz)) {
      let lo = prev, hi = tt;
      for (let i = 0; i < 10; i++) {
        const m = (lo + hi) * 0.5;
        if (oy + dy * m <= height(ox + dx * m, oz + dz * m)) hi = m; else lo = m;
      }
      out.x = ox + dx * hi; out.y = oy + dy * hi; out.z = oz + dz * hi;
      return out;
    }
    prev = tt;
    if (tt >= maxT) break;
  }
  out.x = ox + dx * maxT; out.y = oy + dy * maxT; out.z = oz + dz * maxT;
  return out;
}

/**
 * Horizontal push that keeps a character capsule (feet at `cy`, height `ch`, radius `cr`) out of a
 * boss body (feet at bx,by,bz). Returns the push distance and writes the unit direction into `dir`
 * (0 when not touching). Pure — client prediction can use it to stay in sync with the authority.
 */
export function bossContactPush(def: VacTankDef, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, ch: number, cr: number, dir: { x: number; z: number }): number {
  const R = def.radius;
  const sc = by + R; // sphere centre height
  const lo = cy, hi = cy + ch;
  const dy = sc < lo ? lo - sc : sc > hi ? sc - hi : 0;
  if (dy >= R) return 0;
  const rs = Math.sqrt(R * R - dy * dy) + cr;
  const ox = cx - bx, oz = cz - bz;
  const d = Math.hypot(ox, oz);
  if (d >= rs) return 0;
  if (d < 1e-4) { dir.x = 1; dir.z = 0; } else { dir.x = ox / d; dir.z = oz / d; }
  return rs - d;
}

// ------------------------------------------------------------------ taunts (original lines)

export type BossBarkKey = 'intro' | 'laser' | 'mortar' | 'spin' | 'kittens' | 'phase2' | 'kill' | 'lowHp' | 'defeat' | 'victory' | 'hurt'
  | 'miss' | 'leap' | 'spoiled';

export const BOSS_BARKS: Record<BossId, Partial<Record<BossBarkKey, readonly string[]>>> = {
  vac_tank: {
    intro: ['Behold the Vac-Tank! This yard is now my personal lounge.', 'Sit. Stay. Get vacuumed.', 'Ah, corgis. I have cushions older than you.'],
    laser: ['Chase the dot. CHASE IT.', 'Red dot! Irresistible, isn\'t it?', 'Follow the light, little loaf.'],
    mortar: ['Hairballs away! Hhhk... HHHK!', 'A gift. From my throat to your face.', 'Incoming delicacies!'],
    spin: ['Personal space, peasants!', 'Deep clean cycle engaged!', 'Off my carpet!'],
    kittens: ['Children! Fetch Papa\'s slippers. And the corgis.', 'Kittens, remember your manners. Then bite.'],
    phase2: ['My LID! Do you know what that lid COST?', 'Very well. No more Mister Nice Kitty.', 'You dented the upholstery. Now it is personal.'],
    kill: ['Bad dog.', 'Who is a good boy? Not you.', 'Swept under the rug.', 'Another one for the lint trap.'],
    lowHp: ['This is not how a Baron goes down!', 'Mother warned me about corgis...', 'Warning lights? I do not DO warning lights!'],
    hurt: ['Mind the paint job!', 'Ow. My dignity.', 'Do you KNOW who I am?'],
    defeat: ['Curse you and your stubby little legs!', 'I shall return... after a nap!', 'Not the ejector seeeaaat!'],
    victory: ['And THAT is why cats rule the yard.', 'Tidy. Spotless. Corgi-free.'],
  },
  madame_pointille: {
    intro: ['Hold still, darlings. I am painting.', 'A fresh canvas! How delightful.', 'Every masterpiece begins with one little dot.'],
    laser: ['Hold that pose.', 'Ah, the light is perfect.', 'Say \'kibble\'!', 'A little red... just... there.'],
    kill: ['Magnifique.', 'Art is pain. Mostly yours.', 'Signed, framed, done.', 'Hm. Needs more drama.'],
    miss: ['Hold STILL!', 'Philistine! You moved!', 'The light was wrong. Obviously.'],
    mortar: ['Hhhk... a sculpture! Catch!', 'Try hiding from THIS medium.'],
    leap: ['Too crowded. I need space to create.', 'Moving my easel.', 'The critics are too close!'],
    hurt: ['My whiskers!', 'Rude!', 'Do you know how long this pose took?'],
    spoiled: ['My LENS!', 'You smudged it!', 'Ow! Right in the art!'],
    phase2: ['You knocked off my beret. Now it is personal.', 'No more watercolours. Only red.', 'Fine. Abstract expressionism it is!'],
    lowHp: ['I am... misunderstood!', 'The critics will hear of this!'],
    defeat: ['My final piece... \'Still Life with Corgi\'...', 'I was ahead of my tiiime!'],
    victory: ['Another gallery of sleepy corgis.', 'Exhibition closed.'],
  },
};
