// W10 A7 (adventure-2): chapter 7 "Night Shift at The Lot", the adventure's first chapter on The Lot (W8 M2 / W9 L3,
// src/shared/world/the-lot.ts). Pure data, the same contract as chapters 1–6 (chapters.ts), built only from the
// existing step types; chapters.ts registers it (CHAPTERS, CHAPTER_PLAN slot 7: it unlocks after chapter 6 like any
// chapter). `map: 'the_lot'` (W10 C10): an adventure room playing it runs The Lot (mapForRoom: the guard, the worker
// and the page), and the runner only ever loads a chapter of its sim's own map (src/sim/adventure/runner.ts).
// No three, no DOM, no Math.random; this file imports only types from chapters.ts (chapters.ts imports it).
//
// The beats (docs/handoff/A7.md explains the choices and the numbers):
//   1 pipes   stealth reach   in by the site gate, over the causeway and through the Pipeworks' dark pipes to the
//                             heap's east foot. Three sentries pace: the causeway (by the west mouth), the south mud
//                             (the tunnels' exits) and the east strip. The pipes' walls hide you; the open mud doesn't.
//                             Infiltrator: a cloak crosses the causeway, a second one (after a wait in the dark pipe)
//                             the mud. Seen → the heap's night shift comes hunting (the alarm), never a failure.
//   2 siren   stealth interact the floodlight tower's siren fuse (an item at the tower's ballast box: E takes it), past
//                             two cats standing in the floodlight pools.
//   3 stash   collect 4       the cats' tennis-ball stash around the scaffold; the night shift turns up anyway.
//   4 hold    hold 40 s       the scaffold (deck, nest and the heap top round it) against the counter-attack: a Heavy
//                             up from the mud, tabbies over the west side, kittens from the spawn yard, a Siamese
//                             lookout at the pipes. The Lot's rain rolls in 1.3–1.8 min after a room opens: offline
//                             this is usually the wet part of the night (fair: AI sight drops in rain for both sides).
//   5 escape  reach + vehicle the cats' site kart parked on the heap's gentle west side; drive the stash home to the
//                             Foundation (the pit's vehicle ramp, ~230 m through the middle causeway) past chasers.
// Landmarks (world coords, x east, z south; lot/layout.ts): site gate x 152, z -38..-22 · the ditch along z 0, pipes
// causeway x 68..106 · tunnels x 79.5 (west) and 91.5 (east), z 13.7..44.3 · the spoil heap x 0..80, z 95..125, top
// 4.6 m, steep north face (north ramp x 60..66), gentle east (x 80..91) and west (x -16..0) sides · scaffold x 12..60,
// z 96.5..101.3, deck 9 m, nest 13.4 m (x 40.8..50.4) · heap floodlight towers (20, 123.5) and (44, 123.5) aimed at
// (26, 106) / (44, 106) · the cats' Ordnance Kiosk (65, 108) · pit vehicle ramp x 0..10, z -109 (the corgi base).
import type { ChapterDef } from './chapters';

/** Yaw that faces (tx, tz) from (x, z) (yaw 0 faces -Z). */
const face = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

export const NIGHT_SHIFT: ChapterDef = {
  id: 'night_shift', index: 7, title: 'Night Shift at The Lot', district: 'The Lot', cls: 'infiltrator', map: 'the_lot',
  intro: [
    'Next door: the Lot. Floodlights on. The cats are working the night shift.',
    'Turns out the last ball was not the last. They keep a whole stash on the heap.',
    'Infiltrator: through the pipes, kill the siren, grab the balls, drive home.',
  ],
  outro: [
    'A kart full of tennis balls, parked in the pit. The night shift is over.',
    'The cats have clocked out. The Lot is ours, and so is every single ball.',
  ],
  squad: 4,
  pups: ['infiltrator', 'warden', 'assault', 'overwatch'],
  start: { x: 138, z: -34, yaw: face(138, -34, 92, 0) },   // squeezed in under the site gate, facing the pipes
  // gold paw (A7 measured, docs/handoff/A7.md): bot squads 128–150 s on 8 seeds (median 139), a scripted Infiltrator
  // stand-in that sneaks and fights 102–132 s on 5; a first run that waits out the sentries and learns the heap takes
  // about twice that. 4:00 asks for a clean route; silver (6:00) is any steady run.
  par: 240,
  t: 0.74,                                                  // The Lot's own dusk, pinned: the floodlights are on
  steps: [
    {
      id: 'pipes', text: 'Slip through the Pipeworks to the foot of the heap',
      trigger: { type: 'reach', params: { x: 93, z: 101, radius: 6 } },
      spawns: [
        { archetype: 'grunt', count: 1, at: { x: 50, z: 10 }, tag: 'sentry' },     // off the causeway's west end: the west mouth
        { archetype: 'grunt', count: 1, at: { x: 70, z: 58 }, tag: 'sentry' },     // the south mud: the tunnels' exits
        { archetype: 'grunt', count: 1, at: { x: 136, z: 40 }, tag: 'sentry' },    // the east strip (the long way round)
      ],
      stealth: true,
      alarm: [{ archetype: 'grunt', count: 2, at: { x: 76, z: 102 } }, { archetype: 'kitten', count: 1, at: { x: 76, z: 102 } }],
      checkpoint: true,
      barks: ['The pipes are dark. The floodlights are not. Stay in the dark.', 'Sentry on the causeway. Wait for the turn, or cloak and go.'],
    },
    {
      id: 'siren', text: 'Pull the siren fuse at the east floodlight tower (E)',
      trigger: { type: 'interact', params: { x: 44, z: 120.8, radius: 3, prompt: 'pull the siren fuse', item: 'siren_fuse' } },
      spawns: [
        { archetype: 'kitten', count: 1, at: { x: 40, z: 106 }, tag: 'sentry' },   // standing in the east tower's pool
        { archetype: 'kitten', count: 1, at: { x: 26, z: 108 }, tag: 'sentry' },   // and in the west one's
      ],
      stealth: true,
      alarm: [{ archetype: 'grunt', count: 2, at: { x: 72, z: 118 } }, { archetype: 'alley_raider', count: 1, at: { x: 72, z: 118 } }],
      checkpoint: true,
      barks: ['The tower has a siren. No fuse, no siren, no backup.', 'Two of them standing in the light. Go round the back.'],
    },
    {
      id: 'stash', text: 'Grab the tennis-ball stash',
      trigger: { type: 'collect', params: { item: 'tennis_ball', count: 4, spots: [{ x: 36, z: 99 }, { x: 28, z: 110 }, { x: 52, z: 114 }, { x: 66, z: 104 }] } },
      spawns: [
        { archetype: 'grunt', count: 2, at: { x: 74, z: 120 }, tag: 'nightshift' },
        { archetype: 'kitten', count: 2, at: { x: 4, z: 118 }, tag: 'nightshift' },
        { archetype: 'alley_raider', count: 2, at: { x: 30, z: 128 }, tag: 'nightshift' },
      ],
      checkpoint: true,
      barks: ['Siren is dead! Grab every ball you can carry.', 'They noticed anyway. Cats ALWAYS notice. Grab and go!'],
    },
    {
      id: 'hold', text: 'Hold the scaffold against the night shift',
      trigger: { type: 'hold', params: { x: 36, z: 99, radius: 10, seconds: 40 } },
      spawns: [
        { archetype: 'tabby_heavy', count: 1, at: { x: 60, z: 72 }, tag: 'counter' },
        { archetype: 'grunt', count: 3, at: { x: -8, z: 112 }, tag: 'counter' },
        { archetype: 'kitten', count: 2, at: { x: 78, z: 122 }, tag: 'counter' },
        { archetype: 'sniper', count: 1, at: { x: 86, z: 58 }, tag: 'counter' },
      ],
      checkpoint: true,
      barks: ['Here comes the whole night shift. Up on the scaffold!', 'High ground, pups. Cats HATE being looked down on.'],
    },
    {
      id: 'escape', text: 'Take their site kart (E): drive the stash home to the pit',
      trigger: { type: 'reach', params: { x: 12, z: -108, radius: 7, vehicle: true } },
      vehicles: [{ vehicle: 'mower_kart', x: 4, z: 112, yaw: Math.PI / 2 }],   // on the heap's gentle west side, nose west
      spawns: [
        { archetype: 'grunt', count: 2, at: { x: -10, z: 50 }, tag: 'chasers' },
        { archetype: 'grunt', count: 2, at: { x: 4, z: -30 }, tag: 'chasers' },
      ],
      barks: ['Kart, balls, pit. In that order. GO!', 'Home through the middle! Mind the ditch!'],
    },
  ],
};
