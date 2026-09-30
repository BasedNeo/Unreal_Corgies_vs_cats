// Adventure chapters as data — "The Last Tennis Ball" (docs/design/ADVENTURE.md; contract types below are the
// lead's contract, verbatim). The authoritative runner is src/sim/adventure/ (mode `adventure`, chapter from
// sim.state.room.chapter); the client draws captions, the chapter-complete card and the chapter picker from this
// file. Pure data + pure helpers: no three, no DOM, no Math.random().
//
// Trigger rules (what the runner does with each type; A2's guide is docs/handoff/A1.md):
//   reach     a squad member inside the cylinder (radius, feet from ground − 2 to ground + 12, or up to `maxY`) — a
//             human when the squad has one (the pups escort; the player's arrival is the success). `vehicle`: that
//             member must be seated (EFlag.Mounted) or drive a vehicle that is inside; `airborne`: that member must be
//             off the ground; `minY`: its feet at least that high (a roof). A squad with no human: any pup counts, and
//             all three hold for pups too (B2: bots drive, fly and glide; N1: they climb). Either way they fail
//             forward after STRICT_GRACE_SECONDS on the step (a pup says GRACE_BARK): nobody is stuck without the kit.
//   interact  Interact (E) pressed inside the radius (`minY` as for reach). If the squad has a human, only a human
//             counts (bots help, never steal the win). `item`: the object waits at the point as an item prop and E
//             takes it (a `pickup` event). prompt === KIOSK_PROMPT marks a step done AT the Ordnance Kiosk: the client
//             then shows the kiosk's own "E change kit" prompt (so E opens the kit picker), and E or a kit swap there
//             completes the step.
//   hold      S1's hold: squad inside with no cats → progress; contested (cats inside) pauses; empty drains at ½.
//   collect   `count` items spawn at `spots` (spots.length ≥ count); a squad member walking into one takes it.
//   defeat    boss: that boss (BOSSES id) spawned by this chapter is down · tag + count: `count` cats with that
//             spawn tag down (counted over the chapter) · count alone: that many cats down during the step ·
//             tag alone: every cat with that tag spawned so far is down.
//   destroy   `count` destructibles (EntityKind.Destructible, X1 lane) with that tag broken.
//   survive   `seconds` pass without a squad wipe (MatchState.timeLeft counts down).
// Spawns: `archetype` = an AI archetype (grunt, sniper, brute, kitten, or a class profile), a BOSSES id, or an id a
// lane registered with registerAdventureSpawner (src/sim/adventure). In a `stealth` step they are SENTRIES: they pace
// a small loop around `at` until a cat is alerted — which starts the step's `alarm` spawns (hunters) once and turns
// every sentry into a hunter. A squad wipe restarts at the last step with `checkpoint` (step 0 always is one); its
// barricades stand again and the vehicles of the steps so far are parked again (A2, src/sim/adventure/props.ts).
import { Team, type ClassId } from '../types';
import { OBJECTIVE_CHAIN_IDS, ADVENTURE_CHAIN_INDEX, type ObjectiveChain, type ObjectiveDef, type ObjectiveTrigger } from './objectives';
import { NIGHT_SHIFT } from './chapters-lot'; // W10 A7: chapter 7 on The Lot

// ---------------------------------------------------------------------------------------------- contract types
// The lead's contract (ADVENTURE.md) verbatim, plus A2's OPTIONAL fields (marked A2; every one may be left out, so
// chapters 1–2 read exactly as before):
//   start.y         an elevated start (feet height, e.g. a roof): humans start up there, pups on the ground below
//   pups            the kits of the squad pups in order (humans replace pups from the end); default: the Room's kits
//   reach/interact  minY / maxY: world feet height the member must be at (a roof; a plane over the shed). On a reach
//                   step minY holds for pups too (they climb since N1); on an interact step it is a human rule (no
//                   bot climb route onto the shed roof yet). maxY raises the zone's ceiling (default: ground +
//                   REACH_HEIGHT).
//   interact item   an item prop drawn at the point while the step runs (the last tennis ball); E takes it
//   vehicles        vehicles parked for the squad when the step starts (re-parked if wrecked while still needed)
//   raise           barricades raised when the step completes (long-lived Squeak Barrier walls: the Porch Siege)
//   rally           where the squad regroups and respawns once the step is done (default: its target on the ground)
export interface ChapterDef {
  id: string; index: number; title: string; district: string; cls: ClassId;
  intro: string[]; outro: string[];          // 2–3 comic caption lines each
  squad: number;                             // corgi bots filling the squad (humans replace them)
  start: { x: number; z: number; yaw: number; y?: number };
  par: number;                               // seconds for the gold paw medal
  steps: ChapterStep[];
  t?: number;                                // time of day 0..1 (optional, e.g. dawn)
  pups?: ClassId[];                          // A2: squad pup kits, featured kit first
  map?: string;                              // W10 C10: the map the chapter plays on (a MAP_IDS id; absent = the West Yard)
}

/** A2: a spot on the map, optionally elevated (feet height). */
export interface ChapterSpot { x: number; z: number; y?: number }
/** A2: a vehicle parked for a step (V1's Mower Kart). */
export interface ChapterVehicle { vehicle: 'mower_kart'; x: number; z: number; yaw: number }
/** A2: a barricade wall (a Squeak Barrier that stays up); yaw = the direction it faces (its front). */
export interface ChapterBarricade { x: number; z: number; yaw: number }

export interface ChapterStep {
  id: string; text: string;
  trigger:
    | { type: 'reach'; params: { x: number; z: number; radius: number; vehicle?: boolean; airborne?: boolean; minY?: number; maxY?: number } }
    | { type: 'interact'; params: { x: number; z: number; radius: number; prompt: string; minY?: number; item?: string } }
    | { type: 'hold'; params: { x: number; z: number; radius: number; seconds: number } }
    | { type: 'collect'; params: { item: string; count: number; spots: Array<{ x: number; z: number }> } }
    | { type: 'defeat'; params: { count?: number; boss?: string; tag?: string } }
    | { type: 'destroy'; params: { tag: string; count: number } }
    | { type: 'survive'; params: { seconds: number } };
  spawns?: Array<{ archetype: string; count: number; at: { x: number; z: number }; tag?: string }>;
  stealth?: boolean;                         // being spotted by a cat starts `alarm` spawns
  alarm?: Array<{ archetype: string; count: number; at: { x: number; z: number } }>;
  checkpoint?: boolean;                      // a squad wipe after this step restarts here
  barks?: string[];                          // one-liners shown/spoken when the step starts
  vehicles?: ChapterVehicle[];               // A2
  raise?: ChapterBarricade[];                // A2
  rally?: ChapterSpot;                       // A2
}

export type ChapterTrigger = ChapterStep['trigger'];
export type ChapterTriggerType = ChapterTrigger['type'];
export type Medal = 'gold' | 'silver' | 'bronze';

// ---------------------------------------------------------------------------------------------- tuning
/** Prompt text that marks an interact step done at the Ordnance Kiosk (E opens the kit picker there). */
export const KIOSK_PROMPT = 'change kit';
/** Seconds of briefing (intro captions) before a chapter goes live; every human pressing E skips it. */
export const BRIEFING_SECONDS = 7;
/** The briefing countdown waits until a human is in the squad (a page still loading), at most this long (s). */
export const BRIEFING_WAIT_SECONDS = 10;
/** Seconds between a squad wipe and the restart at the last checkpoint (fail forward). */
export const FAIL_BEAT_SECONDS = 3;
/** After a checkpoint restart the checkpoint's cats hold still this long (the REGROUP bark): the squad gets its
 *  bearings first, so a retry is never harder than arriving there was (Q2 P2-2). */
export const REGROUP_SECONDS = 2;
/** Seconds the result stays up before the room moves on to the next chapter (or replays the last one). */
export const COMPLETE_HOLD_SECONDS = 30;
/** Team points per step and per chapter (MatchState.score; `score` events with reason `step` / `chapter`). */
export const STEP_POINTS = 10;
export const CHAPTER_POINTS = 50;
/** Roster points for the players who completed a step. */
export const STEP_ROSTER = 50;
/** Touch radius (m) of a collect item; cylinder heights of reach/interact/hold zones (m above the ground). */
export const COLLECT_RADIUS = 1.3;
export const REACH_HEIGHT = 12;
export const HOLD_HEIGHT = 14;
export const HOLD_DECAY = 0.5;
/** Medal thresholds: gold ≤ par, silver ≤ SILVER_RATIO × par, bronze otherwise (any completion earns a paw). */
export const SILVER_RATIO = 1.5;
/** What the squad says when it restarts at a checkpoint after a wipe. */
export const REGROUP_BARK = 'Regroup, pups! From the checkpoint. With feeling.';
/** What an alerted cat yells when a stealth alarm goes off (the cat speaks it: `bark` event). */
export const ALARM_BARKS = ['INTRUDERS! Wake the litter!', 'Dogs in the petunias! HISS!', 'I smell wet dog. ALARM!'];
/**
 * A2 fail forward for the human-only rules (`vehicle`, `airborne`, `minY`): after this long on one step they are
 * waived for everyone (a player who can't glide, fly or climb yet is never stuck), and a pup says so (GRACE_BARK).
 */
export const STRICT_GRACE_SECONDS = 120;
export const GRACE_BARK = 'Forget style points. Just get there, we will say you flew.';
/** A2: hit points of a raised barricade (a Squeak Barrier wall has 300 for 8 s; a barricade stays up). */
export const BARRICADE_HP = 650;
/** A2: seconds before a wrecked chapter vehicle is parked again at its spot (while its step still needs it). */
export const VEHICLE_REPARK_SECONDS = 4;

// ---------------------------------------------------------------------------------------------- snapshot conventions
/**
 * The adventure beacon: S1's objective beacon (EntityKind.Prop) with cls = ADVENTURE_CHAIN_INDEX, so the existing
 * beacon view, E prompt and mission card follow chapter steps (via `chapterChain`, see setActiveAdventureChain).
 *   seed = chapter index (1-based) · team = Corgis · x, y, z = the current target (ground point)
 *   weapon = step (-1 briefing, steps.length = chapter complete) · ammo = step progress %
 *   hp / maxHp = hold or survive seconds done / needed — when complete: chapter time (s) / par (s)
 *   anim = ADVENTURE_PHASES index · flags & Busy = hold contested, or the stealth alarm is up
 */
export const ADVENTURE_PHASES = ['briefing', 'live', 'complete', 'failed'] as const;
export type AdventurePhase = (typeof ADVENTURE_PHASES)[number];
export { ADVENTURE_CHAIN_INDEX };
/**
 * Collect items: EntityKind.Prop, cls −1, seed = ADVENTURE_ITEM_SEED, weapon = ADVENTURE_ITEM_IDS index (−1 = other),
 * team Neutral, x, y, z = the item (0.45 m above the ground), yaw = spin phase. Taken items are removed.
 */
export const ADVENTURE_ITEM_SEED = 0x0ad71e;
/** Item kinds the client has a model for (append only; others draw as a generic glowing bundle). */
export const ADVENTURE_ITEM_IDS = ['catnip', 'tennis_ball'] as const;

export function adventureItemIndex(item: string): number {
  return (ADVENTURE_ITEM_IDS as readonly string[]).indexOf(item);
}

// ---------------------------------------------------------------------------------------------- chapters
// West Yard landmarks used below (world coords, x east, z south): corgi Ordnance Kiosk (runtime site, pinned by
// tests/unit/adventure-chapters.test.ts) (-38.3, -66.1) · teal lawn chair (-20, 10) · trampoline (0, 0) ·
// Garden (x -100..-64): flower jungle (-89, 18), hedge-row grass (-93, 3), meadow (-86, -14), compost bin
// (-94, -33), north grass patch (-91.5, -39.6), corn row (-97.6, -52), raised beds (-91 / -71, -54).
const YARD_DAY: ChapterDef = {
  id: 'yard_day', index: 1, title: 'Yard Day', district: 'West Yard', cls: 'assault',
  intro: [
    'West Yard. Eight a.m. The last tennis ball in the neighbourhood is GONE.',
    'The cats took it. Of course the cats took it.',
    'Squad: kit up, clear the lawn, take back the trampoline.',
  ],
  outro: [
    'The trampoline is ours. The cats are furious. Excellent.',
    'Word from the Garden: they are guarding catnip. Lots of it.',
  ],
  squad: 4,
  start: { x: -56, z: -50, yaw: -0.83 },   // open lawn west of the deck, facing the kiosk (~25 m)
  par: 120,
  steps: [
    {
      id: 'report_kiosk', text: 'Report to the Ordnance Kiosk',
      trigger: { type: 'reach', params: { x: -38.3, z: -66.1, radius: 5 } },
      checkpoint: true,
      barks: ['Squad, on me! Kit check at the kiosk.'],
    },
    {
      id: 'kit_swap', text: 'Use the kiosk: E, then pick a kit',
      trigger: { type: 'interact', params: { x: -38.3, z: -66.1, radius: 3, prompt: KIOSK_PROMPT } },
      barks: ['New kit, same good pup. Pick one.'],
    },
    {
      id: 'clear_patrol', text: 'Clear the cat patrol',
      trigger: { type: 'defeat', params: { count: 6, tag: 'patrol' } },
      spawns: [
        // two halves: three tabbies come over the lawn first, the rest trail in from the middle ~10 s later
        { archetype: 'grunt', count: 3, at: { x: -22, z: -38 }, tag: 'patrol' },
        { archetype: 'grunt', count: 1, at: { x: -14, z: 4 }, tag: 'patrol' },
        { archetype: 'kitten', count: 2, at: { x: -14, z: 4 }, tag: 'patrol' },
      ],
      checkpoint: true,
      barks: ['Patrol incoming! Tails up!', 'Six cats. Easy. Probably.'],
    },
    {
      id: 'grab_squeaker', text: 'Grab the Squeaker by the lawn chair',
      trigger: { type: 'interact', params: { x: -16, z: 14, radius: 3, prompt: 'grab the Squeaker' } },
      barks: ['Is that... the SQUEAKER? They dropped the SQUEAKER!'],
    },
    {
      id: 'hold_trampoline', text: 'Hold the trampoline',
      trigger: { type: 'hold', params: { x: 0, z: 0, radius: 8.5, seconds: 20 } },
      spawns: [
        { archetype: 'grunt', count: 2, at: { x: 12, z: 40 }, tag: 'crash' },
        { archetype: 'kitten', count: 2, at: { x: -24, z: 38 }, tag: 'crash' },
        { archetype: 'grunt', count: 2, at: { x: 30, z: 30 }, tag: 'crash' },
      ],
      checkpoint: true,
      barks: ['Hold the trampoline! Do NOT bounce off!', 'Here comes the whole litter!'],
    },
  ],
};

const TALL_GRASS: ChapterDef = {
  id: 'tall_grass', index: 2, title: 'The Tall Grass', district: 'The Garden', cls: 'infiltrator',
  intro: [
    'The Garden. Where tall grass hides short dogs.',
    'The cats hoard catnip up by the veg beds. Steal it and they will talk.',
    'Stay low. Stay quiet. Hug the fence. No barking. Especially you.',
  ],
  outro: [
    'Three bags of the good stuff. The cats want to negotiate.',
    'They say the ball went to the Garage. Bring something loud.',
  ],
  squad: 4,
  start: { x: -86, z: 68, yaw: 0.05 },     // south of the Garden, facing the catnip patch; out of every sentry's sight (> 50 m)
  par: 160,
  steps: [
    {
      id: 'sneak_patch', text: 'Sneak through the tall grass to the catnip patch',
      trigger: { type: 'reach', params: { x: -91.5, z: -40, radius: 4 } },
      spawns: [
        { archetype: 'grunt', count: 1, at: { x: -79, z: 12 }, tag: 'sentry' },    // garden path by the flower jungle
        { archetype: 'grunt', count: 1, at: { x: -74, z: -8 }, tag: 'sentry' },    // path at the meadow's east edge
        { archetype: 'grunt', count: 1, at: { x: -83, z: -31 }, tag: 'sentry' },   // the open gap by the compost bin
      ],
      stealth: true,
      alarm: [{ archetype: 'grunt', count: 2, at: { x: -70, z: -30 } }],
      checkpoint: true,
      barks: ['Sentries on the path. Hug the fence.', 'In the grass and holding still, they cannot see you.'],
    },
    {
      id: 'catnip', text: 'Grab the catnip bags',
      trigger: {
        type: 'collect',
        params: { item: 'catnip', count: 3, spots: [{ x: -97.5, z: -48 }, { x: -86, z: -41 }, { x: -81, z: -50 }] },
      },
      spawns: [{ archetype: 'grunt', count: 1, at: { x: -79, z: -45 }, tag: 'sentry' }], // veg-plot junction
      stealth: true,
      alarm: [{ archetype: 'kitten', count: 2, at: { x: -72, z: -45 } }],
      checkpoint: true,
      barks: ['Catnip! Do not sniff it. Do NOT sniff it.'],
    },
    {
      id: 'lie_low', text: 'Lie low till they give up, or survive the alarm',
      trigger: { type: 'survive', params: { seconds: 45 } },
      spawns: [
        { archetype: 'kitten', count: 1, at: { x: -86, z: -36 }, tag: 'sniffer' },
        { archetype: 'kitten', count: 1, at: { x: -92, z: -24 }, tag: 'sniffer' },
      ],
      stealth: true,
      alarm: [
        { archetype: 'grunt', count: 2, at: { x: -70, z: -30 } },
        { archetype: 'kitten', count: 1, at: { x: -70, z: 0 } },
      ],
      barks: ['They smell it on us. Down in the grass, now!'],
    },
  ],
};

// ---------------------------------------------------------------------------------------------- chapters 3–6 (A2)
// More landmarks (world coords): the Garage (D3) spans x 68..94, z -70..-48, flat roof at 7.2 m; its boarded breach
// wall (X1) faces the east alley at x 93.4..94, z -68.4..-62.6; four tuna stacks inside; the roll-up door is south.
// Roof climbs: west crate stair from (59, -57.4), east alley scaffold from (97.8, -46.2). Roof perches: SW parapet
// (69.1, 7.2, -49.1). Rooftop Hangar (R1) pad (89.3, 7.2, -67.2). Madame Pointillé's perches (E1): patio umbrella
// (23, -90), house eave, grill lid. The deck (Corgi base): x -72..-34, z -100..-84, top 3 m, stairs south at
// x -58..-48. Garden gate arch (-81, -63.5). Shed (Cats base) x 34..60, z 80..96, ridge 10.6 m, north eave z 78.9;
// cat tree (22, 84) with a plank bridge up onto the shed roof.
/** Yaw that faces (tx, tz) from (x, z) (yaw 0 faces -Z). */
const face = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

const GARAGE_JOB: ChapterDef = {
  id: 'garage_job', index: 3, title: 'The Garage Job', district: 'The Garage', cls: 'breacher',
  intro: [
    'The Garage. The cats keep their tuna hoard in there, behind one boarded wall.',
    'Breacher, you are the key. The key is explosives. That is the whole plan.',
    'Blow the wall, flatten the hoard, then borrow their mower. Forever.',
  ],
  outro: [
    'The hoard is flat, the mower is ours, and the cats are VERY upset.',
    'A tabby cracked: the ball is guarded from the Rooftops. At dawn. By a dot.',
  ],
  squad: 4,
  pups: ['breacher', 'breacher', 'assault', 'overwatch'],
  start: { x: 86, z: -88, yaw: face(86, -88, 97, -66) },   // the lawn north of the garage, facing the alley (~25 m)
  par: 120,
  steps: [
    {
      id: 'to_wall', text: 'Sneak round the back to the boarded-up wall',
      trigger: { type: 'reach', params: { x: 97, z: -66, radius: 4.5 } },
      barks: ['Round the back, squad. Front doors are for amateurs.'],
    },
    {
      id: 'breach', text: 'Blow the wall: plant a Dig Charge on it (Q), then back off',
      trigger: { type: 'destroy', params: { tag: 'garage_breach_wall', count: 1 } },
      spawns: [{ archetype: 'grunt', count: 2, at: { x: 97, z: -38 }, tag: 'alley' }],
      checkpoint: true,
      barks: ['Charge on the boards, then RUN. Running is the important part.', 'Alley cats! Literally!'],
    },
    {
      id: 'hoard', text: 'Wreck the tuna hoard',
      trigger: { type: 'destroy', params: { tag: 'tuna_stack', count: 4 } },
      spawns: [
        // two halves: the hoard's guards are inside, their backup comes in through the roll-up door later
        { archetype: 'grunt', count: 2, at: { x: 79, z: -62 }, tag: 'guards' },
        { archetype: 'kitten', count: 2, at: { x: 78, z: -30 }, tag: 'guards' },
        { archetype: 'brute', count: 1, at: { x: 64, z: -26 }, tag: 'guards' },
      ],
      checkpoint: true,
      barks: ['That is a LOT of tuna. Wreck every can!', 'Guards! Flatten the cans, not your tail!'],
    },
    {
      id: 'escape', text: 'Hop in the mower kart (E) and floor it to the garden gate',
      trigger: { type: 'reach', params: { x: -77, z: -63.5, radius: 6, vehicle: true } },
      vehicles: [{ vehicle: 'mower_kart', x: 81, z: -43, yaw: Math.PI / 2 }],   // by the roll-up door, nose west
      spawns: [{ archetype: 'grunt', count: 3, at: { x: 18, z: -64 }, tag: 'chasers' }],
      barks: ['Their mower! It has no keys. It has no brakes either.', 'West! Through the garden gate!'],
    },
  ],
};

const LASER_DAWN: ChapterDef = {
  id: 'laser_dawn', index: 4, title: 'Laser Pointer at Dawn', district: 'The Rooftops', cls: 'overwatch',
  intro: [
    'Dawn on the Rooftops. Somewhere out there, a red dot is waiting.',
    'Madame Pointillé, the Dot Artiste. She paints with a laser. On dogs.',
    'Get up high, find her perch, and out-snipe the snob.',
  ],
  outro: [
    'The Dot Artiste has left the umbrella. Face first. Very abstract.',
    'Bad news: the cats are marching on the porch. OUR porch.',
  ],
  squad: 4,
  pups: ['overwatch', 'overwatch', 'assault', 'breacher'],
  start: { x: 60, z: -42, yaw: face(60, -42, 59, -57.4) },   // SW of the garage, facing the crate stair (~16 m)
  par: 180,
  t: 0.27,
  steps: [
    {
      id: 'perch', text: 'Climb to the sniper perch on the garage roof',
      trigger: { type: 'reach', params: { x: 69.1, z: -49.1, radius: 3, minY: 6.5 } },
      barks: ['Crates, lean-to, roof. Up we go.', 'The corner by the parapet. Best seat in the house.'],
    },
    {
      id: 'duel', text: 'Out-snipe Madame Pointillé (hit the glinting lens!)',
      trigger: { type: 'defeat', params: { boss: 'madame_pointille' } },
      checkpoint: true,
      barks: ['A red dot. On the lawn. Nobody chase it. NOBODY.', 'When the dot sticks, break line of sight!'],
    },
    {
      id: 'crossing', text: 'Cover the squad crossing the lawn',
      trigger: { type: 'survive', params: { seconds: 40 } },
      spawns: [
        { archetype: 'grunt', count: 3, at: { x: 32, z: -62 }, tag: 'crossing' },
        { archetype: 'sniper', count: 1, at: { x: 22, z: -46 }, tag: 'crossing' },
        { archetype: 'kitten', count: 2, at: { x: 30, z: -18 }, tag: 'crossing' },
      ],
      checkpoint: true,
      barks: ['We are crossing! Keep their heads down!', 'Kittens on the left! Why is it always kittens?'],
    },
  ],
};

const PORCH_SIEGE: ChapterDef = {
  id: 'porch_siege', index: 5, title: 'The Porch Siege', district: 'West Yard deck', cls: 'warden',
  intro: [
    'The porch. Our porch. Where the best naps happen. The cats want it.',
    'Warden, you build the walls. Everybody else: stand behind the walls.',
    'Three waves are coming. The porch does not fall. Not today.',
  ],
  outro: [
    'The porch stands! Three waves, zero naps lost. Well, one nap.',
    'A spy in the hedge says the ball is on the shed roof. Guarded by a vacuum.',
  ],
  squad: 4,
  pups: ['warden', 'warden', 'assault', 'overwatch'],
  start: { x: -53, z: -66, yaw: face(-53, -66, -62, -71.5) },   // in front of the porch steps, facing the west pile
  par: 160,
  steps: [
    {
      id: 'wall_west', text: 'Fortify the porch: raise the west barricade (E)',
      trigger: { type: 'interact', params: { x: -62, z: -71.5, radius: 3, prompt: 'raise the barricade' } },
      raise: [{ x: -64.2, z: -68, yaw: Math.PI }, { x: -59.8, z: -68, yaw: Math.PI }],
      barks: ['Squeaky walls! Point the squeaky side at the cats.'],
    },
    {
      id: 'wall_east', text: 'Fortify the porch: raise the east barricade (E)',
      trigger: { type: 'interact', params: { x: -44, z: -71.5, radius: 3, prompt: 'raise the barricade' } },
      raise: [{ x: -46.2, z: -68, yaw: Math.PI }, { x: -41.8, z: -68, yaw: Math.PI }],
      barks: ['One more. A porch needs two walls. That is just science.'],
    },
    {
      id: 'hold_porch', text: 'Hold the porch steps',
      trigger: { type: 'hold', params: { x: -53, z: -77, radius: 9, seconds: 30 } },
      spawns: [
        // waves 1 and 2: from the south-west first, then the south-east (farther: they arrive in halves)
        { archetype: 'grunt', count: 3, at: { x: -64, z: -40 }, tag: 'wave1' },
        { archetype: 'kitten', count: 1, at: { x: -70, z: -44 }, tag: 'wave1' },
        { archetype: 'grunt', count: 2, at: { x: -30, z: -28 }, tag: 'wave2' },
        { archetype: 'kitten', count: 2, at: { x: -30, z: -28 }, tag: 'wave2' },
        { archetype: 'sniper', count: 1, at: { x: -48, z: -14 }, tag: 'wave2' },
      ],
      checkpoint: true,
      barks: ['Here they come! Stay on the steps!', 'Wave two! They brought kittens. Of COURSE they did.'],
    },
    {
      id: 'last_wave', text: 'Last wave! Keep the porch standing',
      trigger: { type: 'survive', params: { seconds: 40 } },
      spawns: [
        { archetype: 'brute', count: 1, at: { x: -53, z: -38 }, tag: 'wave3' },
        { archetype: 'grunt', count: 3, at: { x: -76, z: -44 }, tag: 'wave3' },
        { archetype: 'kitten', count: 2, at: { x: -28, z: -46 }, tag: 'wave3' },
        { archetype: 'brute', count: 1, at: { x: -34, z: -30 }, tag: 'wave3' },
        { archetype: 'sniper', count: 1, at: { x: -60, z: -18 }, tag: 'wave3' },
      ],
      checkpoint: true,
      barks: ['That one is a CHONK. Walls up!', 'Forty seconds! Nobody leaves the porch!'],
    },
  ],
};

const LAST_BALL: ChapterDef = {
  id: 'last_ball', index: 6, title: 'The Last Tennis Ball', district: 'The Sky', cls: 'skyraider',
  intro: [
    'The garage roof. The ball is on the shed roof. The shed is WAY over there.',
    'Skyraider: ears out, glide. If the ears are not enough, we have a plane.',
    'Then the Vac-Tank. Then the ball. Then the longest nap in history.',
  ],
  outro: [
    'THE BALL. The last tennis ball in the neighbourhood is ours again.',
    'Somebody throw it. No, wait. Somebody throw it AGAIN.',
  ],
  squad: 4,
  pups: ['skyraider', 'skyraider', 'assault', 'overwatch'],
  // humans start up on the garage roof (y) at the south end of the runway, facing the south parapet (~5 m); the pups
  // (no climbing) in the garage below
  start: { x: 90, z: -52.5, yaw: Math.PI, y: 7.2 },
  par: 360,
  steps: [
    {
      id: 'glide', text: 'Ear Glide off the roof toward the shed (jump, jump, Q)',
      // only a glide off the roof is still 4 m up this far out (a double jump off the edge drops out of it)
      trigger: { type: 'reach', params: { x: 84, z: -26, radius: 5, airborne: true, minY: 4 } },
      barks: ['Ears OUT! Aim for the shed!', 'Jump, jump, ears. Jump, jump, EARS.'],
    },
    {
      id: 'plane', text: 'Too far! Take the RC plane at the Rooftop Hangar (E)',
      trigger: { type: 'reach', params: { x: 89.3, z: -67.2, radius: 4, vehicle: true, minY: 6.5 } },
      rally: { x: 86, z: -63, y: 7.2 },   // a crashed pilot starts over up by the hangar
      barks: ['That was forty metres. The shed is a hundred and fifty. PLANE.', 'Up the scaffold, round the back!'],
    },
    {
      id: 'flyover', text: 'Fly the plane over the shed roof',
      trigger: { type: 'reach', params: { x: 47, z: 84, radius: 14, vehicle: true, minY: 8, maxY: 30 } },
      rally: { x: 47, z: 70 },
      barks: ['Nose up, tail down, ears... wherever ears go in a plane.'],
    },
    {
      id: 'vac_tank', text: 'Beat the Vac-Tank!',
      trigger: { type: 'defeat', params: { boss: 'vac_tank' } },
      spawns: [{ archetype: 'vac_tank', count: 1, at: { x: 47, z: 60 }, tag: 'boss' }],
      checkpoint: true,
      barks: ['Oh no. It is the VACUUM.', 'Hit the glowing bits! Glowing bits are always the weak bits!'],
    },
    {
      id: 'the_ball', text: 'Grab the last tennis ball off the shed roof',
      trigger: { type: 'interact', params: { x: 47, z: 79.4, radius: 3, prompt: 'grab the tennis ball', minY: 7, item: 'tennis_ball' } },
      barks: ['There it is. Up on the gutter. Fuzzy. Perfect.', 'Cat tree, plank, roof. Go get it!'],
    },
  ],
};

/** Playable chapters, in order. */
export const CHAPTERS: readonly ChapterDef[] = [YARD_DAY, TALL_GRASS, GARAGE_JOB, LASER_DAWN, PORCH_SIEGE, LAST_BALL, NIGHT_SHIFT];

/** The chapter slots of the adventure (menu picker; W10 A7: seven): a slot is playable once CHAPTERS has its index. */
export const CHAPTER_PLAN: ReadonlyArray<{ index: number; id: string; title: string; district: string; cls: ClassId }> = [
  { index: 1, id: 'yard_day', title: 'Yard Day', district: 'West Yard', cls: 'assault' },
  { index: 2, id: 'tall_grass', title: 'The Tall Grass', district: 'The Garden', cls: 'infiltrator' },
  { index: 3, id: 'garage_job', title: 'The Garage Job', district: 'The Garage', cls: 'breacher' },
  { index: 4, id: 'laser_dawn', title: 'Laser Pointer at Dawn', district: 'The Rooftops', cls: 'overwatch' },
  { index: 5, id: 'porch_siege', title: 'The Porch Siege', district: 'West Yard deck', cls: 'warden' },
  { index: 6, id: 'last_ball', title: 'The Last Tennis Ball', district: 'The Sky', cls: 'skyraider' },
  { index: 7, id: NIGHT_SHIFT.id, title: NIGHT_SHIFT.title, district: NIGHT_SHIFT.district, cls: NIGHT_SHIFT.cls }, // W10 A7
];

export function chapterById(id: string | undefined | null): ChapterDef | null {
  return CHAPTERS.find((c) => c.id === id) ?? null;
}

export function chapterByIndex(index: number): ChapterDef | null {
  return CHAPTERS.find((c) => c.index === index) ?? null;
}

/** The chapter after `id` (null after the last playable one). */
export function nextChapter(id: string): ChapterDef | null {
  const c = chapterById(id);
  return c ? chapterByIndex(c.index + 1) : null;
}

/** What follows `def`: a playable next chapter, one that is planned but not built yet ('soon'), or the end. */
export function afterChapter(def: ChapterDef): 'next' | 'soon' | 'end' {
  return nextChapter(def.id) ? 'next' : def.index < CHAPTER_PLAN.length ? 'soon' : 'end';
}

/** The chapter an online room moves on to after `def`: the next one; the same one while the next is still 'soon';
 *  after the finale, back to chapter 1 (Q2 P2-6: the room used to replay the finale forever). */
export function roomChapterAfter(def: ChapterDef): ChapterDef {
  const kind = afterChapter(def);
  return kind === 'next' ? nextChapter(def.id)! : kind === 'end' ? CHAPTERS[0] : def;
}

/** Medal for a chapter time (s) against its par: gold ≤ par · silver ≤ 1.5 × par · bronze otherwise. */
export function medalFor(time: number, par: number): Medal {
  if (time <= par) return 'gold';
  if (time <= par * SILVER_RATIO) return 'silver';
  return 'bronze';
}

// ---------------------------------------------------------------------------------------------- beacon chain
/**
 * The chapter as an S1 objective chain for the client's beacon view, E prompt and mission card (they read
 * objectiveChainByIndex(beacon.cls)). Only the existing trigger shapes go out: collect → a reach ring around the
 * next item, defeat / destroy → a small ring under the next target, survive → no ring, a kiosk interact → reach
 * (so E opens the kiosk's picker instead). The authority never runs this chain; src/sim/adventure does.
 */
export function chapterChain(def: ChapterDef): ObjectiveChain {
  let c = chainCache.get(def);
  if (!c) {
    c = {
      id: def.id, map: 'West Yard', mode: 'adventure', team: Team.Corgis,
      title: `CH ${def.index} · ${def.title.toUpperCase()}`,
      steps: def.steps.map((s): ObjectiveDef => ({
        id: s.id, district: def.district, text: s.text, trigger: clientTrigger(s.trigger),
        reward: { score: STEP_POINTS, roster: STEP_ROSTER, bark: s.barks?.[0] ?? '' },
      })),
      doneText: def.outro[0] ?? 'Chapter complete!', doneTime: COMPLETE_HOLD_SECONDS,
    };
    chainCache.set(def, c);
  }
  return c;
}
const chainCache = new WeakMap<ChapterDef, ObjectiveChain>();

/** Target ring radius drawn under a defeat / destroy target (m). */
export const TARGET_RING = 1.4;

function clientTrigger(t: ChapterTrigger): ObjectiveTrigger {
  switch (t.type) {
    case 'reach': return { type: 'reach', params: { x: t.params.x, z: t.params.z, radius: t.params.radius, height: REACH_HEIGHT } };
    case 'interact':
      return t.params.prompt === KIOSK_PROMPT
        ? { type: 'reach', params: { x: t.params.x, z: t.params.z, radius: t.params.radius, height: 9 } }
        : { type: 'interact', params: { x: t.params.x, z: t.params.z, radius: t.params.radius, prompt: t.params.prompt } };
    case 'hold': return { type: 'hold', params: { x: t.params.x, z: t.params.z, radius: t.params.radius, height: HOLD_HEIGHT, seconds: t.params.seconds, decay: HOLD_DECAY } };
    case 'collect': {
      const s = t.params.spots[0] ?? { x: 0, z: 0 };
      return { type: 'reach', params: { x: s.x, z: s.z, radius: COLLECT_RADIUS, height: 4 } };
    }
    case 'defeat':
    case 'destroy': return { type: 'reach', params: { x: 0, z: 0, radius: TARGET_RING, height: 0 } };
    case 'survive': return { type: 'reach', params: { x: 0, z: 0, radius: 0, height: 0 } };
  }
}

/** Beacon cls sanity: the adventure chain slot exists in the wire table. */
export const ADVENTURE_CHAIN_ID: (typeof OBJECTIVE_CHAIN_IDS)[number] = OBJECTIVE_CHAIN_IDS[ADVENTURE_CHAIN_INDEX];
