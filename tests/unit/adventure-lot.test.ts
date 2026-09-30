// W10 A7 chapter 7 "Night Shift at The Lot" (src/shared/content/chapters-lot.ts): the chapter after chapter 6, on The
// Lot, and the plumbing that makes a chapter play on its own map.
//   · data: registered as slot 7 (locked until chapter 6 is done), map 'the_lot', captions and barks in the comic
//     voice's limits, every point on real walkable Lot ground, the stash spots clear, the siren fuse by the tower, the
//     kart parked on drivable ground with a kart route home, a gold-paw look for it (one per chapter)
//   · the map: the room guard, the offline worker and the page all run The Lot for it (C10 mapForRoom), and an online
//     room (in-process server) welcomes on The Lot, lists it, and plays chapter 7 there
//   · map-generic runner: a sim only ever loads a chapter of its own map (a room asked for another map's chapter plays
//     this map's first one), and an online room moves on along its own map's chapters (West Yard 6 → 1, The Lot 7 → 7)
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { createDefaultSystems } from '../../src/sim/systems';
import {
  adventureSystems, adventureState, adventureChapter, chapterAfterOnMap, chapterForSim, chapterFitsSim, knownAdventureArchetype,
} from '../../src/sim/adventure';
import { navGridFor, cellIndex, nearestWalkable, type NavGrid } from '../../src/sim/ai/nav';
import { findDrivePath, kartNavFor } from '../../src/sim/ai/drive';
import { createWorldData, type WorldData } from '../../src/shared/world/world-data';
import { mapForRoom } from '../../src/shared/world/maps';
import { occupiedAt, surfaceAt, waterAt } from '../../src/shared/world/queries';
import {
  CHAPTERS, CHAPTER_PLAN, afterChapter, chapterById, nextChapter, roomChapterAfter, type ChapterDef,
} from '../../src/shared/content/chapters';
import { NIGHT_SHIFT } from '../../src/shared/content/chapters-lot';
import { COSMETICS, TAUNT_PACKS, unlockHint } from '../../src/shared/content/cosmetics';
import { sanitizeRoomSetup } from '../../src/host/guard';
import { startGameServer, type GameServer } from '../../server/app';
import { loadConfig } from '../../server/config';
import { SnapDecoder, decodeServerFrame } from '../../src/host/wire';
import type { ServerMsg } from '../../src/shared/protocol';
import { PROTOCOL_VERSION, TICK_HZ } from '../../src/shared/constants';
import { withCompletion, isUnlocked } from '../../src/client/adventure';

function withAdventure() {
  const sys = createDefaultSystems();
  return sys.some((s) => s.name === 'adventure') ? sys : [...sys, ...adventureSystems()];
}

let lot: WorldData;
let grid: NavGrid;
beforeAll(async () => {
  const sim = await Sim.create({ seed: 1, map: 'the_lot' });
  sim.step();
  lot = sim.worldData;
  grid = navGridFor(sim);
  sim.dispose();
});
const walkable = (x: number, z: number) => {
  const c = cellIndex(grid, x, z);
  return c >= 0 && grid.walk[c] === 1 && grid.region[c] === grid.mainRegion;
};

describe('chapter 7 "Night Shift at The Lot": the data', () => {
  it('is slot 7, after chapter 6, on The Lot; it unlocks when chapter 6 is done; it is the finale', () => {
    const def = chapterById('night_shift')!;
    expect(def).toBe(NIGHT_SHIFT);
    expect([def.index, def.map, def.cls, def.squad]).toEqual([7, 'the_lot', 'infiltrator', 4]);
    expect(CHAPTERS.indexOf(def)).toBe(6);
    expect(CHAPTER_PLAN[6]).toEqual({ index: 7, id: def.id, title: def.title, district: def.district, cls: def.cls });
    expect(nextChapter('last_ball')).toBe(def);
    expect([afterChapter(chapterById('last_ball')!), afterChapter(def)]).toEqual(['next', 'end']); // THE END moves to ch7
    expect(roomChapterAfter(def).id).toBe('yard_day');
    // the picker's rule (client/adventure/progress.ts): locked until chapter 6 is completed, with any paw
    let p = { unlocked: 6, medals: {} as Record<string, 'gold' | 'silver' | 'bronze'> };
    expect(isUnlocked(p, 7)).toBe(false);
    p = withCompletion(p, 'last_ball', 6, 'bronze');
    expect(isUnlocked(p, 7)).toBe(true);
    // every other chapter stays on the West Yard (C10: absent = the default map)
    expect(CHAPTERS.filter((c) => c !== def).every((c) => c.map === undefined)).toBe(true);
  });

  it('captions, barks and step texts stay in the comic voice limits; only existing step types', () => {
    const def = NIGHT_SHIFT;
    for (const lines of [def.intro, def.outro]) {
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines.length).toBeLessThanOrEqual(3);
      for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(80);
    }
    expect(def.steps.map((s) => s.trigger.type)).toEqual(['reach', 'interact', 'collect', 'hold', 'reach']);
    for (const s of def.steps) {
      expect(s.text.length, s.text).toBeLessThanOrEqual(60);
      expect(s.barks?.length, s.id).toBeGreaterThanOrEqual(1);
      for (const b of s.barks ?? []) expect(b.length, b).toBeLessThanOrEqual(72);
    }
    // stealth first (the sneak and the siren), loud after; a checkpoint before every fight, none on the drive home
    expect(def.steps.map((s) => !!s.stealth)).toEqual([true, true, false, false, false]);
    expect(def.steps.map((s) => !!s.checkpoint)).toEqual([true, true, true, true, false]);
    expect(def.pups?.[0]).toBe(def.cls);
  });

  it('every point sits on real walkable Lot ground; spawns are known and placeable; the stash is clear and spread out', () => {
    const def = NIGHT_SHIFT;
    expect(walkable(def.start.x, def.start.z)).toBe(true);
    for (const s of def.steps) {
      const t = s.trigger;
      if (t.type === 'reach' || t.type === 'interact' || t.type === 'hold') {
        let open = 0;
        for (const k of [0.3, 0.6, 0.9]) for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2, x = t.params.x + Math.cos(a) * t.params.radius * k, z = t.params.z + Math.sin(a) * t.params.radius * k;
          if (walkable(x, z) && !waterAt(lot, x, z)) open++;
        }
        expect(open, s.id).toBeGreaterThanOrEqual(12);
      }
      if (t.type === 'collect') {
        expect(t.params.spots.length).toBeGreaterThanOrEqual(t.params.count);
        for (const p of t.params.spots) {
          expect(walkable(p.x, p.z), `spot ${p.x},${p.z}`).toBe(true);
          const y = surfaceAt(lot, p.x, p.z, lot.height(p.x, p.z) + 2).y; // where spawnItem puts it
          expect(occupiedAt(lot, p.x, y + 0.6, p.z), `spot ${p.x},${p.z} inside a collider`).toBe(false);
          expect(Math.abs(y - 4.6), 'on the heap top (one under the scaffold deck)').toBeLessThan(0.05);
        }
        for (const p of t.params.spots) for (const q of t.params.spots) if (p !== q) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(5);
      }
      for (const g of [...(s.spawns ?? []), ...(s.alarm ?? [])]) {
        expect(knownAdventureArchetype(g.archetype), g.archetype).toBe(true);
        expect(nearestWalkable(grid, g.at.x, g.at.z, 4), `${s.id} spawn at ${g.at.x},${g.at.z}`).toBeGreaterThanOrEqual(0);
      }
      if (s.stealth) expect(s.alarm?.length, `${s.id} has an alarm`).toBeGreaterThan(0);
    }
    // the siren fuse lies on the heap top at the east floodlight tower's ballast box, clear of it
    const siren = def.steps[1].trigger as Extract<ChapterDef['steps'][number]['trigger'], { type: 'interact' }>;
    expect(siren.params.item).toBe('siren_fuse');
    expect(Math.abs(surfaceAt(lot, siren.params.x, siren.params.z, 8).y - 4.6)).toBeLessThan(0.05);
    expect(occupiedAt(lot, siren.params.x, 5.3, siren.params.z)).toBe(false);
    expect(occupiedAt(lot, 44, 5.3, 123.5)).toBe(true); // the tower's ballast box right behind it
  });

  it('the escape: the kart parks on the heap top with a kart route home to the pit', async () => {
    const def = NIGHT_SHIFT;
    const esc = def.steps[4];
    expect(esc.trigger.type === 'reach' && esc.trigger.params.vehicle).toBe(true);
    const spot = esc.vehicles![0];
    expect(Math.abs(lot.height(spot.x, spot.z) - 4.6)).toBeLessThan(0.05);
    const t = esc.trigger.params as { x: number; z: number; radius: number };
    expect(Math.hypot(t.x - 12, t.z + 108)).toBeLessThan(3); // the pit's vehicle ramp (the corgis' Foundation)
    const route: number[] = [];
    expect(findDrivePath(grid, kartNavFor(grid, lot), spot.x, spot.z, t.x, t.z, route, 4)).toBe(true);
    let len = 0;
    for (let i = 2, px = spot.x, pz = spot.z; i <= route.length; i += 2) { len += Math.hypot(route[i - 2] - px, route[i - 1] - pz); px = route[i - 2]; pz = route[i - 1]; }
    expect(Math.hypot(route[route.length - 2] - t.x, route[route.length - 1] - t.z)).toBeLessThan(t.radius);
    expect(len).toBeGreaterThan(200); // home is ~230 m of driving: the finale's getaway
    expect(len).toBeLessThan(300);
  });

  it('a gold paw on chapter 7 unlocks a look (one per chapter): the corgis\' Night Shift taunt pack', () => {
    const look = COSMETICS.find((c) => c.unlock.kind === 'medal' && c.unlock.chapter === 'night_shift')!;
    expect(look).toMatchObject({ id: 'taunt_corgi_nightshift', slot: 'taunt', species: 'corgi' });
    expect(TAUNT_PACKS[look.id].length).toBeGreaterThanOrEqual(4);
    expect(unlockHint(look.unlock)).toBe('Gold paw: Night Shift at The Lot');
  });
});

describe('chapter 7 plays on The Lot: guard, worker, page and an online room', () => {
  const servers: GameServer[] = [];
  const sockets: WsClient[] = [];
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.terminate();
    for (const s of servers.splice(0)) await s.close('test done');
  });

  it('the room guard, the worker boot and the page pick The Lot whatever ?map= says', () => {
    for (const asked of ['west_yard', 'the_lot', null, 'junk']) {
      expect(sanitizeRoomSetup('adventure', 'night_shift', null, asked)).toEqual({ mode: 'adventure', chapter: 'night_shift', map: 'the_lot' });
      // worker-host.ts boot and main.ts: mapForRoom(cfg.map | ?map=, mode, chapterById(chapter)?.map)
      expect(mapForRoom(asked, 'adventure', chapterById('night_shift')?.map)).toBe('the_lot');
    }
    for (const c of CHAPTERS.slice(0, 6)) expect(sanitizeRoomSetup('adventure', c.id, null, 'the_lot')!.map).toBe('west_yard');
  });

  it('an online co-op room for chapter 7 welcomes on The Lot, lists it, and plays chapter 7 there', async () => {
    const s = await startGameServer(loadConfig({}, { host: '127.0.0.1', port: 0, log: false }));
    servers.push(s);
    const ws = new WsClient(`${s.wsUrl}/?room=nightshift&mode=adventure&chapter=night_shift&map=west_yard`);
    sockets.push(ws);
    const dec = new SnapDecoder();
    const welcome = await new Promise<Extract<ServerMsg, { t: 'welcome' }>>((res, rej) => {
      const timer = setTimeout(() => rej(new Error('no welcome')), 20_000);
      ws.on('message', (d) => { const m = decodeServerFrame(String(d), dec); if (m?.t === 'welcome') { clearTimeout(timer); res(m); } });
      ws.on('error', rej);
      ws.once('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'Rex', team: 0, cls: 'infiltrator' })));
    });
    expect(welcome.mode).toBe('adventure');
    expect(welcome.map).toBe('the_lot');
    const mr = (s.rooms as unknown as { rooms: Map<string, { room: Room }> }).rooms.get('nightshift')!;
    for (let i = 0; i < 400 && !adventureState(mr.room.sim); i++) await new Promise((r) => setTimeout(r, 25)); // first tick
    expect(mr.room.sim.worldData.map).toBe('the_lot');
    expect(adventureChapter(mr.room.sim)?.id).toBe('night_shift');
    expect(s.rooms.list(10).find((r) => r.name === 'nightshift')).toMatchObject({ mode: 'adventure', map: 'the_lot', chapter: 'night_shift' });
  }, 60_000);
});

describe('the runner is map-generic: a sim plays only its own map\'s chapters', () => {
  it('chapterFitsSim / chapterForSim / chapterAfterOnMap', async () => {
    const yard = await Sim.create({ seed: 1 }), onLot = await Sim.create({ seed: 1, map: 'the_lot' });
    const ch = (id: string) => chapterById(id)!;
    expect(chapterFitsSim(yard, ch('yard_day'))).toBe(true);
    expect(chapterFitsSim(yard, NIGHT_SHIFT)).toBe(false);
    expect(chapterFitsSim(onLot, NIGHT_SHIFT)).toBe(true);
    expect(chapterForSim(yard, NIGHT_SHIFT).id).toBe('yard_day');
    expect(chapterForSim(onLot, ch('porch_siege')).id).toBe('night_shift');
    for (const c of CHAPTERS.slice(0, 6)) expect(chapterForSim(yard, c)).toBe(c); // the six West Yard chapters: as asked
    // online rooms move on along their map's chapters (a room can't change its world)
    expect(CHAPTERS.slice(0, 6).map((c) => chapterAfterOnMap(yard, c).id)).toEqual(['tall_grass', 'garage_job', 'laser_dawn', 'porch_siege', 'last_ball', 'yard_day']);
    expect(chapterAfterOnMap(onLot, NIGHT_SHIFT).id).toBe('night_shift');
    // a hand-made test world (no registry id) plays any chapter, as before
    const flat = await Sim.create({ seed: 1, world: { ...createWorldData(1), map: undefined } });
    expect(chapterFitsSim(flat, NIGHT_SHIFT)).toBe(true);
    for (const s of [yard, onLot, flat]) s.dispose();
  });

  it('a room on The Lot asked for a West Yard chapter plays chapter 7; a West Yard room asked for chapter 7 plays chapter 1', async () => {
    for (const [map, asked, plays] of [['the_lot', 'yard_day', 'night_shift'], ['west_yard', 'night_shift', 'yard_day'], ['west_yard', 'porch_siege', 'porch_siege']] as const) {
      const sim = await Sim.create({ seed: 2, map, systems: withAdventure() });
      const room = new Room(sim, { mode: 'adventure', chapter: asked, botsPerTeam: [1, 0] });
      room.tick();
      expect(adventureChapter(sim)?.id, `${map} asked ${asked}`).toBe(plays);
      room.dispose();
    }
  }, 60_000);

  it('an online room on The Lot replays chapter 7 after its result (it never loads a West Yard chapter on The Lot)', async () => {
    const sim = await Sim.create({ seed: 3, map: 'the_lot', systems: withAdventure() });
    // a one-step version of chapter 7 (reach the start) so the result comes at once; a 1 s result hold
    sim.state.adventureConfig = { chapter: { ...NIGHT_SHIFT, steps: [{ ...NIGHT_SHIFT.steps[0], trigger: { type: 'reach', params: { x: NIGHT_SHIFT.start.x, z: NIGHT_SHIFT.start.z, radius: 8 } }, spawns: [], stealth: false }] }, briefing: 0.1, briefingWait: 0.1, completeHold: 1 };
    const room = new Room(sim, { mode: 'adventure', chapter: 'night_shift', botsPerTeam: [1, 0] });
    let completed = false;
    for (let i = 0; i < 20 * TICK_HZ; i++) {
      room.tick();
      const st = adventureState(sim)!;
      if (st.phase === 'complete') completed = true;
      if (completed && st.phase === 'briefing') break;
    }
    expect(completed).toBe(true);
    expect(adventureState(sim)!.chapter).toBe('night_shift');
    expect(adventureState(sim)!.phase).toBe('briefing');
    room.dispose();
  }, 60_000);
});
