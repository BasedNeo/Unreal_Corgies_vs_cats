// Adventure chapters as data — "The Last Tennis Ball" (docs/design/ADVENTURE.md; contract types below are the
// lead's contract, verbatim). The authoritative runner is src/sim/adventure/ (mode `adventure`, chapter from
// sim.state.room.chapter); the client draws captions, the chapter-complete card and the chapter picker from this
// file. Pure data + pure helpers: no three, no DOM, no Math.random().
//
// Trigger rules (what the runner does with each type; A2's guide is docs/handoff/A1.md):
//   reach     a squad member inside the cylinder (radius, feet from ground − 2 to ground + 12) — a human when the
//             squad has one (the pups escort; the player's arrival is the success). `vehicle`: that member must be
//             seated (EFlag.Mounted) or drive a vehicle that is inside; `airborne`: that member must be off the
//             ground. A squad with no human: any pup counts and both are waived (bots don't drive or glide on purpose).
//   interact  Interact (E) pressed inside the radius. If the squad has a human, only a human counts (bots help,
//             never steal the win). prompt === KIOSK_PROMPT marks a step done AT the Ordnance Kiosk: the client
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
// every sentry into a hunter. A squad wipe restarts at the last step with `checkpoint` (step 0 always is one).
import { Team, type ClassId } from '../types';
import { OBJECTIVE_CHAIN_IDS, ADVENTURE_CHAIN_INDEX, type ObjectiveChain, type ObjectiveDef, type ObjectiveTrigger } from './objectives';

// ---------------------------------------------------------------------------------------------- contract types
export interface ChapterDef {
  id: string; index: number; title: string; district: string; cls: ClassId;
  intro: string[]; outro: string[];          // 2–3 comic caption lines each
  squad: number;                             // corgi bots filling the squad (humans replace them)
  start: { x: number; z: number; yaw: number };
  par: number;                               // seconds for the gold paw medal
  steps: ChapterStep[];
  t?: number;                                // time of day 0..1 (optional, e.g. dawn)
}

export interface ChapterStep {
  id: string; text: string;
  trigger:
    | { type: 'reach'; params: { x: number; z: number; radius: number; vehicle?: boolean; airborne?: boolean } }
    | { type: 'interact'; params: { x: number; z: number; radius: number; prompt: string } }
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
export const ADVENTURE_ITEM_IDS = ['catnip'] as const;

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
  par: 170,
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

/** Playable chapters, in order (A2 appends chapters 3–6). */
export const CHAPTERS: readonly ChapterDef[] = [YARD_DAY, TALL_GRASS];

/** The six chapter slots of the adventure (menu picker): a slot is playable once CHAPTERS has its index. */
export const CHAPTER_PLAN: ReadonlyArray<{ index: number; id: string; title: string; district: string; cls: ClassId }> = [
  { index: 1, id: 'yard_day', title: 'Yard Day', district: 'West Yard', cls: 'assault' },
  { index: 2, id: 'tall_grass', title: 'The Tall Grass', district: 'The Garden', cls: 'infiltrator' },
  { index: 3, id: 'garage_job', title: 'The Garage Job', district: 'The Garage', cls: 'breacher' },
  { index: 4, id: 'laser_dawn', title: 'Laser Pointer at Dawn', district: 'The Rooftops', cls: 'overwatch' },
  { index: 5, id: 'porch_siege', title: 'The Porch Siege', district: 'West Yard deck', cls: 'warden' },
  { index: 6, id: 'last_ball', title: 'The Last Tennis Ball', district: 'The Sky', cls: 'skyraider' },
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
