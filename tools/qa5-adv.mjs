#!/usr/bin/env node
// Q5 verification probe (read-only): chapter 7 "Night Shift at The Lot" beyond the bot runs of qa-adventure.mjs.
//   npx tsx tools/qa5-adv.mjs [--seed 21]
// 1. unlock: the picker's progress rules (chapter 6 → 7), independent of A7's tests;
// 2. online advance: chapterAfterOnMap for every chapter on a West Yard sim and a Lot sim (a room stays on its map);
// 3. a real Lot adventure Room (no holdResult, as the Node server runs it) plays chapter 7 to the end, then reloads:
//    what it loads next, on which map, and that the squad is live again (no softlock at the loop point).
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { createDefaultSystems } from '../src/sim/systems';
import { adventureSystems, adventureState, chapterAfterOnMap, chapterForSim } from '../src/sim/adventure';
import { chapterById, CHAPTERS, CHAPTER_PLAN, afterChapter } from '../src/shared/content/chapters';
import { withCompletion, isUnlocked } from '../src/client/adventure/progress';
import { TICK_HZ } from '../src/shared/constants';
import { Team } from '../src/shared/types';
import { sanitizeRoomSetup } from '../src/host/guard';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const seed = Number(opt('seed', 21));
const systems = () => { const s = createDefaultSystems(); return s.some((x) => x.name === 'adventure') ? s : [...s, ...adventureSystems()]; };
const out = (o) => console.log(JSON.stringify(o));

// 1. unlock
const ns = chapterById('night_shift');
let p = { unlocked: 1, medals: {} };
const trail = [];
for (const c of CHAPTERS.filter((x) => (x.map ?? 'west_yard') === 'west_yard')) {
  trail.push({ before: c.id, ch7Unlocked: isUnlocked(p, ns.index) });
  p = withCompletion(p, c.id, c.index, 'bronze');
}
out({ probe: 'unlock', ch7Index: ns.index, plan: CHAPTER_PLAN.length, chapters: CHAPTERS.map((c) => `${c.index}:${c.id}@${c.map ?? 'west_yard'}`),
  lockedUntilCh6Done: trail.every((t) => !t.ch7Unlocked), unlockedAfterCh6: isUnlocked(p, ns.index), unlocked: p.unlocked,
  afterCh6: afterChapter(chapterById('last_ball')), afterCh7: afterChapter(ns),
  guardCh7: sanitizeRoomSetup('adventure', 'night_shift', null, 'west_yard'), guardBad: sanitizeRoomSetup('adventure', 'nope', null, 'the_lot') });

// 2. advance along the map
for (const map of ['west_yard', 'the_lot']) {
  const sim = await Sim.create({ seed, map });
  out({ probe: 'advance', map, loadsFor: Object.fromEntries(CHAPTERS.map((c) => [c.id, chapterForSim(sim, c).id])),
    next: Object.fromEntries(CHAPTERS.map((c) => [c.id, chapterAfterOnMap(sim, c).id])) });
}

// 3. a Lot room plays chapter 7 through and loops
const sim = await Sim.create({ seed, map: ns.map, systems: systems() });
const room = new Room(sim, { mode: 'adventure', chapter: 'night_shift', botsPerTeam: [4, 0] });
let done = -1, reloaded = -1, liveAgain = -1; let first = null;
for (let i = 0; i < (ns.par * 2 + 90) * TICK_HZ; i++) {
  room.tick();
  const st = adventureState(sim);
  if (done < 0 && st.phase === 'complete') { done = sim.tick; first = { time: st.time, medal: st.medal, wipes: st.wipes }; }
  if (done >= 0 && reloaded < 0 && st.phase !== 'complete') reloaded = sim.tick;
  if (reloaded >= 0 && st.phase === 'live') { liveAgain = sim.tick; break; }
}
const st = adventureState(sim);
const squad = [...sim.entities.values()].filter((e) => e.char && e.team === Team.Corgis);
out({ probe: 'loop', map: sim.worldData?.map, seed, first, reloadAfter: reloaded > 0 ? ((reloaded - done) / TICK_HZ).toFixed(1) : null,
  liveAgainAfter: liveAgain > 0 ? ((liveAgain - done) / TICK_HZ).toFixed(1) : null, nowChapter: st.chapter, step: st.step, phase: st.phase,
  squadAlive: squad.filter((e) => !e.dead).length, squadNearStart: squad.filter((e) => Math.hypot(e.pos.x - 138, e.pos.z + 34) < 25).length });
room.dispose();
