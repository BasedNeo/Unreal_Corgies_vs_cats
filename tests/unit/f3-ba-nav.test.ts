// W11 F3 (P1-1): Base Assault on the West Yard paths on the grid without N3's thin pass; every other map and mode keeps
// it. The thin pass tilted West Yard Base Assault to the corgis' side (first to 3, seeds 1-40: 23 : 7 with it and the
// pilot, 18 : 15 with the pilot alone; docs/handoff/F3.md). Here: which grid each room gets, that the two grids are
// cached apart (a TDM room and a Base Assault room in one process never share one), and that The Lot is unaffected.
import { describe, it, expect, afterAll } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { navGridFor, sharedNavGrid, thinPassFor, thinObstacleCells } from '../../src/sim/ai/nav';

const sims: Sim[] = [];
const rooms: Room[] = [];
afterAll(() => { for (const r of rooms) r.dispose(); });

async function roomOf(map: 'west_yard' | 'the_lot', mode: string): Promise<Sim> {
  const sim = await Sim.create({ seed: 1, map });
  sims.push(sim);
  const room = new Room(sim, { mode, botsPerTeam: [1, 1] });
  rooms.push(room);
  room.tick();
  return sim;
}

describe('F3 P1-1: the thin pass per map and mode', () => {
  it('West Yard: Base Assault paths without the thin cells, TDM and core-rush with them; the grids are cached apart', async () => {
    const ba = await roomOf('west_yard', 'base-assault');
    const tdm = await roomOf('west_yard', 'team-deathmatch');
    const cr = await roomOf('west_yard', 'core-rush');
    expect(thinPassFor(ba)).toBe(false);
    expect(thinPassFor(tdm)).toBe(true);
    expect(thinPassFor(cr)).toBe(true);
    const gBa = sharedNavGrid(ba), gTdm = sharedNavGrid(tdm);
    expect(gBa).not.toBe(gTdm);
    expect(sharedNavGrid(cr)).toBe(gTdm);                              // one cache entry per flag, shared across rooms
    expect(gBa.thin).toBe(0);
    expect(gTdm.thin).toBeGreaterThan(30);                              // N3: 43-47 cells on the West Yard
    // the Base Assault grid is the TDM grid with every thin cell open again, and nothing else different
    const thin = new Set(thinObstacleCells(ba.worldData, gTdm));
    let reopened = 0;
    for (let i = 0; i < gBa.walk.length; i++) {
      if (gBa.walk[i] === gTdm.walk[i]) continue;
      expect(thin.has(i), `cell ${i}`).toBe(true);
      expect(gBa.walk[i]).toBe(1);
      reopened++;
    }
    expect(reopened).toBe(gTdm.thin);
    expect(navGridFor(ba).thin).toBe(0);                                // what its bots path on
  }, 120_000);

  it('The Lot: Base Assault keeps the thin pass (its grid is the TDM grid)', async () => {
    const ba = await roomOf('the_lot', 'base-assault');
    const tdm = await roomOf('the_lot', 'team-deathmatch');
    expect(thinPassFor(ba)).toBe(true);
    expect(sharedNavGrid(ba)).toBe(sharedNavGrid(tdm));
  }, 120_000);

  it('a sim without a room (tests, labs, the adventure runner before a room) keeps the thin pass', async () => {
    const sim = await Sim.create({ seed: 1, map: 'west_yard' });
    sims.push(sim);
    expect(thinPassFor(sim)).toBe(true);
    expect(sharedNavGrid(sim).thin).toBeGreaterThan(30);
  }, 120_000);
});
