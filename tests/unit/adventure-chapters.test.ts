// A1 on the real West Yard: chapter data sanity (every point on real walkable ground, spawns known and placeable,
// the kiosk step on the runtime Ordnance Kiosk), chapter 1 "Yard Day" completed by a bot squad with no human (first
// objective inside 60 s, deterministic), chapter 2 "The Tall Grass" completed by bots, and chapter 2's stealth with a
// human hiding in the meadow: no alarm, and the pups hang back instead of blundering into the sentries.
import { describe, it, expect, beforeAll } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room, type Conn } from '../../src/host/room';
import { createDefaultSystems } from '../../src/sim/systems';
import { adventureSystems, adventureState, knownAdventureArchetype } from '../../src/sim/adventure';
import { navGridFor, cellIndex, nearestWalkable, type NavGrid } from '../../src/sim/ai/nav';
import { createWorldData, type WorldData } from '../../src/shared/world/world-data';
import { concealmentAt, occupiedAt, surfaceAt, waterAt } from '../../src/shared/world/queries';
import { EntityKind, Team } from '../../src/shared/types';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import { TERMINALS, terminalIndex } from '../../src/shared/content/terminals';
import type { MatchState, ServerMsg } from '../../src/shared/protocol';
import { CHAPTERS, CHAPTER_PLAN, KIOSK_PROMPT, chapterById, type ChapterDef } from '../../src/shared/content/chapters';

/** The default systems plus the adventure's (once the lead registers them in the default list, not twice). */
function withAdventure() {
  const sys = createDefaultSystems();
  return sys.some((s) => s.name === 'adventure') ? sys : [...sys, ...adventureSystems()];
}

let data: WorldData;
let grid: NavGrid;
beforeAll(async () => {
  data = createWorldData(1);
  const sim = await Sim.create({ seed: 1 });
  sim.step();
  grid = navGridFor(sim);
  sim.dispose();
});

const walkable = (x: number, z: number) => {
  const c = cellIndex(grid, x, z);
  return c >= 0 && grid.walk[c] === 1 && grid.region[c] === grid.mainRegion;
};

/** Per-tick cost samples (ms) of the runner and of S1's interaction layer, when a test asks for them. */
const cost: Record<string, number[]> = {};
async function adventureRoom(chapter: string, seed = 1, bots = 4, timed = false): Promise<{ sim: Sim; room: Room }> {
  const systems = withAdventure().map((s) => !timed || (s.name !== 'adventure' && s.name !== 'interact') ? s : {
    ...s, update(sim: Sim, dt: number) { const t0 = performance.now(); s.update(sim, dt); (cost[s.name] ??= []).push(performance.now() - t0); },
  });
  const sim = await Sim.create({ seed, systems });
  const room = new Room(sim, { mode: 'adventure', chapter, botsPerTeam: [bots, 0] });
  return { sim, room };
}

interface RunResult { complete: boolean; firstStepAt: number; tick: number; time: number; medal: string; counters: Record<string, number>; digest: string }

function playOut(sim: Sim, room: Room, maxSeconds: number): RunResult {
  let firstStepAt = -1;
  for (let i = 0; i < maxSeconds * 60; i++) {
    room.tick();
    const st = adventureState(sim)!;
    if (firstStepAt < 0 && st.step >= 1) firstStepAt = sim.tick / 60;
    if (st.phase === 'complete') break;
  }
  const st = adventureState(sim)!;
  const digest = sim.snapshotEntities().filter((s) => s.kind === EntityKind.Bot || s.kind === EntityKind.Player)
    .map((s) => `${s.id}:${s.x.toFixed(3)}:${s.z.toFixed(3)}:${s.hp}`).join('|');
  return { complete: st.phase === 'complete', firstStepAt, tick: sim.tick, time: st.time, medal: st.medal, counters: { ...st.counters }, digest };
}

describe('chapter data', () => {
  it('all six chapters are playable and match their slots; captions are 2–3 punchy lines', () => {
    expect(CHAPTER_PLAN.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(CHAPTERS.map((c) => c.id)).toEqual(['yard_day', 'tall_grass', 'garage_job', 'laser_dawn', 'porch_siege', 'last_ball']);
    for (const c of CHAPTERS) {
      const slot = CHAPTER_PLAN[c.index - 1];
      expect([c.id, c.title, c.cls, c.district]).toEqual([slot.id, slot.title, slot.cls, slot.district]);
      for (const lines of [c.intro, c.outro]) {
        expect(lines.length).toBeGreaterThanOrEqual(2);
        expect(lines.length).toBeLessThanOrEqual(3);
        for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(80);
      }
      expect(new Set(c.steps.map((s) => s.id)).size).toBe(c.steps.length);
      expect(c.par).toBeGreaterThan(30);
      expect(c.squad).toBe(4);
    }
  });

  it('every point sits on real walkable ground; spawns are known and placeable; collect has enough spots', () => {
    for (const c of CHAPTERS) {
      expect(walkable(c.start.x, c.start.z), `${c.id} start`).toBe(true);
      for (const s of c.steps) {
        const t = s.trigger;
        if (t.type === 'reach' || t.type === 'interact' || t.type === 'hold') {
          // plenty of standable ground inside the radius (the target itself may be a prop: the kiosk, the trampoline)
          let open = 0;
          for (const k of [0.3, 0.6, 0.9]) for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2, x = t.params.x + Math.cos(a) * t.params.radius * k, z = t.params.z + Math.sin(a) * t.params.radius * k;
            if (walkable(x, z) && !waterAt(data, x, z)) open++;
          }
          expect(open, `${c.id}/${s.id}`).toBeGreaterThanOrEqual(12);
        }
        if (t.type === 'collect') {
          expect(t.params.spots.length).toBeGreaterThanOrEqual(t.params.count);
          for (const p of t.params.spots) {
            expect(walkable(p.x, p.z), `${c.id}/${s.id} spot ${p.x},${p.z}`).toBe(true);
            const y = surfaceAt(data, p.x, p.z).y;
            expect(occupiedAt(data, p.x, y + 0.6, p.z), `${s.id} spot inside a collider`).toBe(false);
          }
          for (const p of t.params.spots) for (const q of t.params.spots) if (p !== q) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(5);
        }
        for (const g of [...(s.spawns ?? []), ...(s.alarm ?? [])]) {
          expect(knownAdventureArchetype(g.archetype), g.archetype).toBe(true);
          expect(nearestWalkable(grid, g.at.x, g.at.z, 4), `${c.id}/${s.id} spawn at ${g.at.x},${g.at.z}`).toBeGreaterThanOrEqual(0);
        }
        if (s.stealth) expect(s.alarm?.length, `${s.id} has an alarm`).toBeGreaterThan(0);
      }
    }
  });

  it('chapter 1: the kiosk steps sit on the corgi Ordnance Kiosk that an adventure room places at runtime', async () => {
    const { sim, room } = await adventureRoom('yard_day', 1, 0);
    room.tick();
    const ord = terminalIndex('ordnance_terminal');
    const kiosk = sim.snapshotEntities().find((s) => s.kind === EntityKind.Terminal && s.cls === ord && s.team === Team.Corgis)!;
    expect(kiosk).toBeTruthy();
    const def = chapterById('yard_day')!;
    const steps = def.steps.filter((s) => s.trigger.type === 'reach' || (s.trigger.type === 'interact' && s.trigger.params.prompt === KIOSK_PROMPT));
    expect(steps.length).toBe(2);
    for (const s of steps) {
      const p = s.trigger.params as { x: number; z: number; radius: number };
      expect(Math.hypot(p.x - kiosk.x, p.z - kiosk.z), s.id).toBeLessThan(0.3);
      expect(p.radius).toBeGreaterThanOrEqual(TERMINALS.ordnance_terminal.useRange);
    }
    room.dispose();
  });

  it('chapter 2: the catnip patch and the first bag are in tall grass (a sneak route exists)', () => {
    const def = chapterById('tall_grass')!;
    const patch = def.steps[0].trigger.params as { x: number; z: number };
    expect(concealmentAt(data, patch.x, data.height(patch.x, patch.z), patch.z)).toBeGreaterThan(0.8);
    const bags = (def.steps[1].trigger.params as { spots: Array<{ x: number; z: number }> }).spots;
    expect(concealmentAt(data, bags[0].x, data.height(bags[0].x, bags[0].z), bags[0].z)).toBeGreaterThan(0.8);
  });
});

describe('chapters played by a bot squad (no human)', () => {
  let first: RunResult;
  it('chapter 1 "Yard Day": completed; first objective inside 60 s', async () => {
    const { sim, room } = await adventureRoom('yard_day', 1, 4, true);
    first = playOut(sim, room, 480);
    room.dispose();
    // trimmed mean: the slowest 2 % of ticks are GC / scheduler pauses on a loaded box (seen on idle briefing ticks too)
    const trimmed = (n: string) => { const a = cost[n].slice().sort((x, y) => x - y); const k = Math.floor(a.length * 0.98); return a.slice(0, k).reduce((s, v) => s + v, 0) / Math.max(1, k); };
    console.log(`[adventure] yard_day bots: first objective ${first.firstStepAt.toFixed(1)} s · complete ${first.time} s (${first.medal}) · runner ${trimmed('adventure').toFixed(4)} ms/tick (S1 interact ${trimmed('interact').toFixed(4)}; trimmed means) · ${JSON.stringify(first.counters)}`);
    expect(trimmed('adventure')).toBeLessThan(process.env.CI ? 0.06 : 0.15);
    expect(first.complete).toBe(true);
    expect(first.firstStepAt).toBeGreaterThan(0);
    expect(first.firstStepAt).toBeLessThan(60);
    expect(first.counters['kills:patrol']).toBeGreaterThanOrEqual(6);
  }, 120000);

  it('chapter 1 is deterministic: the same seed plays out identically', async () => {
    const { sim, room } = await adventureRoom('yard_day', 1);
    const again = playOut(sim, room, 480);
    room.dispose();
    expect(again).toEqual(first);
  }, 120000);

  it('chapter 2 "The Tall Grass": completed (bots blow the stealth and survive the alarm)', async () => {
    const { sim, room } = await adventureRoom('tall_grass', 1);
    const r = playOut(sim, room, 480);
    room.dispose();
    console.log(`[adventure] tall_grass bots: complete ${r.time} s (${r.medal}) · ${JSON.stringify(r.counters)}`);
    expect(r.complete).toBe(true);
    expect(r.counters.catnip).toBe(3);
  }, 120000);
});

describe('chapter 2 stealth with a human', () => {
  it('a still human hidden in the meadow is not spotted; the pups hang back at the rally point instead of charging', async () => {
    const { sim, room } = await adventureRoom('tall_grass', 1);
    const sent: ServerMsg[] = [];
    const conn: Conn = { id: 'rex', send: (m) => sent.push(m) };
    const slot = room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: 'Rex', team: Team.Corgis, cls: 'infiltrator' })!;
    for (let i = 0; i < 60; i++) room.tick();
    const rex = sim.entities.get(slot.entity)!;
    const hide = { x: -93, z: -14 }; // the meadow's west side, by the fence (placed during the briefing: no sentries yet)
    sim.placeCharacter(rex, hide.x, data.height(hide.x, hide.z) + 0.02, hide.z);
    for (let i = 0; i < 9 * 60 && adventureState(sim)?.phase !== 'live'; i++) room.tick();
    expect(adventureState(sim)!.phase).toBe('live');
    expect(rex.conceal!.level).toBeGreaterThan(0.9);
    const def = chapterById('tall_grass')!;
    for (let i = 0; i < 20 * 60; i++) room.tick();
    const st = adventureState(sim)!;
    expect(rex.dead).toBe(false);
    expect(st.alarm).toBe(false);
    expect(st.counters.alarms).toBe(0);
    for (const s of room.players.values()) {
      if (!s.bot) continue;
      const e = sim.entities.get(s.entity)!;
      expect(Math.hypot(e.pos.x - def.start.x, e.pos.z - def.start.z), `${s.name} hangs back`).toBeLessThan(9);
    }
    expect((sim.state.match as MatchState).objective).toMatch(/^Sneak through the tall grass/);
    room.dispose();
  }, 120000);
});

export type { ChapterDef };
