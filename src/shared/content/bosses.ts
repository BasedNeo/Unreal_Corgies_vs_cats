// Boss set pieces as data (theme content, MASTER_PLAN §12). OWNER: B1 boss lane.
// The authoritative boss systems (src/sim/boss) read these numbers; the client (src/client/procgen/boss)
// reads the same table for geometry anchors (muzzle, weak point), telegraph radii and timings, so a
// tuning change here moves the sim, the model and the FX together.
//
// Snapshot encoding for EntityKind.Boss entities (no protocol change):
//   EntityState.cls    index into BOSSES
//   EntityState.yaw    turret/laser aim yaw (world); pitch = laser aim pitch
//   EntityState.flags  EFlag bits 0..11 as usual + the boss state in bits 16..26 (packBossFlags)
//   EntityState.x/y/z  feet (ground contact) like every character; the hit volume is a sphere of
//                      `radius` centered `radius` above the feet (L3's capsule with half-height 0).
// Units: meters, seconds, radians, hit points.
import type { ProjectileDef } from './weapons';

export const BOSS_IDS = ['vac_tank'] as const;
export type BossId = (typeof BOSS_IDS)[number];

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

export interface BossDef {
  id: BossId;
  name: string;
  pilot: string;
  /** Max hp = baseHp + hpPerExtraPlayer × (corgi combatants at spawn − 1). */
  baseHp: number;
  hpPerExtraPlayer: number;
  /** Points for the squad on defeat (`score` event, reason 'boss'). */
  score: number;
  /** Hit sphere radius (m), centred `radius` above the feet. Also the KCC collider and the push-out body. */
  radius: number;
  /** Visual top (crown) for nameplates/camera. */
  height: number;
  /** Top of the chassis disc. */
  deckY: number;
  /** Seconds of the drop-in (invulnerable, no attacks). */
  intro: number;
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
  /** Minimum seconds between two taunts. */
  barkCooldown: number;
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
export const VAC_TANK: BossDef = {
  id: 'vac_tank',
  name: 'The Vac-Tank',
  pilot: 'Baron Von Floof',
  // Calibrated with headless fights (L3 bots vs boss, West Yard): 4 → 29.9k ≈ 3.2 min, 2 → 15.3k.
  baseHp: 8000,
  hpPerExtraPlayer: 7300,
  score: 25,
  radius: 2.5,
  height: 4.75,
  deckY: 2.45,
  intro: 2.4,
  dropHeight: 12,
  move: { speed: 2.7, turnRate: 1.3, accel: 5, decel: 7, band: [10, 19], leash: 42 },
  turret: { pivotFwd: 1.05, pivotY: 2.8, barrel: 0.95, mortarBack: 0.95, mortarY: 3.35, hatchBack: 3.3, hatchY: 1.4 },
  weak: {
    mult: 2,
    phase1: { y0: 3.55, y1: 4.65, r: 0.62 },
    phase2: { y0: 2.9, y1: 4.65, r: 0.9 },
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

export const BOSSES: readonly BossDef[] = [VAC_TANK];

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
export function weakZone(def: BossDef, phase2: boolean): WeakZone {
  return phase2 ? def.weak.phase2 : def.weak.phase1;
}

/** Max hp for a squad of `players` corgi combatants (players and squad bots). */
export function bossMaxHp(def: BossDef, players: number): number {
  return Math.round(def.baseHp + def.hpPerExtraPlayer * Math.max(0, Math.max(1, Math.floor(players)) - 1));
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
export function bossMuzzle(def: BossDef, x: number, y: number, z: number, yaw: number, pitch: number, out: P3): P3 {
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
export function bossContactPush(def: BossDef, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, ch: number, cr: number, dir: { x: number; z: number }): number {
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

export type BossBarkKey = 'intro' | 'laser' | 'mortar' | 'spin' | 'kittens' | 'phase2' | 'kill' | 'lowHp' | 'defeat' | 'victory' | 'hurt';

export const BOSS_BARKS: Record<BossId, Record<BossBarkKey, readonly string[]>> = {
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
};
