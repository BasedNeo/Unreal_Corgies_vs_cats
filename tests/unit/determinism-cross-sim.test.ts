// D1: a room's outcome must not depend on the rooms that ran before it in the same process (the Node server hosts
// many rooms in one process). Module-level caches (the shared nav grid, deck grids and link sets, kart grids, ...) are
// the only channel between sims, so each scenario here runs in a FRESH module graph (vi.resetModules: empty caches, as
// in a new process), either alone or after other rooms, and the two runs must agree bit for bit.
//   · the nav a sim plans on (ground grid, its decks, its kart grid) is the same whatever room built the shared caches
//     (a TDM room with karts on its pads and a plane on the roof, or a boss-rush room); a sim's own kiosks close cells
//     in its nav, other rooms' kiosks don't
//   · chapter 6 (bot-only) plays out tick for tick the same alone and after two TDM ticks (the pair lane B2 found: the
//     TDM room's bots build the shared nav grid on tick 1, its Kart-O-Matic by the shed stayed in it and moved chapter
//     6's Vac-Tank fight at 54.8 s)
import { describe, it, expect, vi } from 'vitest';

type SimMod = typeof import('../../src/sim/sim');
type RoomMod = typeof import('../../src/host/room');
type NavMod = typeof import('../../src/sim/ai/nav');
type LinksMod = typeof import('../../src/sim/ai/nav-links');
type DriveMod = typeof import('../../src/sim/ai/drive');
type TypesMod = typeof import('../../src/shared/types');
type VehiclesMod = typeof import('../../src/sim/vehicles');
interface Mods { Sim: SimMod['Sim']; Room: RoomMod['Room']; nav: NavMod; links: LinksMod; drive: DriveMod; T: TypesMod; V: VehiclesMod }
type Sim = import('../../src/sim/sim').Sim;
type Room = import('../../src/host/room').Room;

/** A fresh module graph: every module-level cache starts empty, as in a new server process. */
async function fresh(): Promise<Mods> {
  vi.resetModules();
  const [{ Sim }, { Room }, nav, links, drive, T, V] = await Promise.all([
    import('../../src/sim/sim'), import('../../src/host/room'), import('../../src/sim/ai/nav'),
    import('../../src/sim/ai/nav-links'), import('../../src/sim/ai/drive'), import('../../src/shared/types'),
    import('../../src/sim/vehicles'),
  ]);
  return { Sim, Room, nav, links, drive, T, V };
}

/** A room as the server makes it: PvP modes with the soak's short match config and a 4v4 bot lineup, PvE modes with a
 *  squad of four corgi bots. */
async function room(m: Mods, spec: string, seed = 1): Promise<Room> {
  const [mode, chapter] = spec.split(':');
  const squad = mode === 'adventure' || mode === 'boss-rush';
  const sim = await m.Sim.create({ seed });
  const r = new m.Room(sim, { mode, botsPerTeam: squad ? [4, 0] : [0, 0], ...(chapter ? { chapter } : {}) });
  if (!squad) {
    sim.state.matchConfig = { tdm: { warmup: 3, killLimit: 12, timeLimit: 45, endedHold: 5 } };
    const { Corgis, Cats } = m.T.Team;
    for (const [team, cls] of [[Corgis, 'assault'], [Corgis, 'overwatch'], [Corgis, 'breacher'], [Corgis, 'skyraider'],
      [Cats, 'assault'], [Cats, 'overwatch'], [Cats, 'breacher'], [Cats, 'skyraider']] as const) r.addBot(team, cls);
  }
  return r;
}

/** Everything nav-shaped a sim's bots plan on, built now (so this sim builds whatever shared cache is still empty). */
function navOf(m: Mods, sim: Sim) {
  const g = m.nav.navGridFor(sim);
  const set = m.links.navLinksFor(sim);
  const kart = m.drive.kartNavFor(g, sim.worldData);
  return { g, decks: set?.decks ?? [], kart };
}

// FNV-1a over the float64 bits of every value
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
function mix(h: number, v: number): number {
  f64[0] = v;
  for (let k = 0; k < 2; k++) { h ^= u32[k]; h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
function digest(...arrays: ArrayLike<number>[]): string {
  let h = 2166136261;
  for (const a of arrays) { h = mix(h, a.length); for (let i = 0; i < a.length; i++) h = mix(h, a[i]); }
  return h.toString(16);
}
function navDigest(m: Mods, sim: Sim): Record<string, string> {
  const n = navOf(m, sim);
  const out: Record<string, string> = { ground: digest(n.g.walk, n.g.region), kart: digest(n.kart.ok, n.kart.region, n.kart.cost) };
  n.decks.forEach((d, k) => { out[`deck${k}`] = digest([d.ox, d.oz, d.w, d.h], d.walk, d.region); });
  return out;
}

/** Per-tick hash of every entity (id, kind, pose, velocity, hp, flags). */
function worldHash(sim: Sim): number {
  let h = 2166136261;
  for (const e of sim.entities.values()) {
    for (const v of [e.id, e.kind, e.pos.x, e.pos.y, e.pos.z, e.vel.x, e.vel.y, e.vel.z, e.yaw, e.pitch, e.health?.hp ?? -1, e.flags, e.dead ? 1 : 0]) h = mix(h, v);
  }
  return h;
}

/** Play `spec` for `ticks` in the given module graph; the per-tick hashes and the adventure step ticks. */
async function play(m: Mods, spec: string, ticks: number): Promise<{ hashes: number[]; steps: string[] }> {
  const r = await room(m, spec);
  const hashes: number[] = [], steps: string[] = [];
  let step = -1;
  for (let i = 0; i < ticks; i++) {
    r.tick();
    hashes.push(worldHash(r.sim));
    const st = r.sim.state.adventure as { step?: number } | undefined;
    if (st && typeof st.step === 'number' && st.step !== step) { step = st.step; steps.push(`${step}@${r.sim.tick}`); }
  }
  r.dispose();
  return { hashes, steps };
}

const firstDiff = (a: number[], b: number[]) => a.findIndex((v, i) => v !== b[i]);

describe('D1: rooms in one process do not leak into each other', () => {
  it('a sim plans on the same nav (ground grid, decks, kart grid) whatever room built the shared caches', async () => {
    // alone: chapter 6 builds every shared cache itself
    let m = await fresh();
    const r0 = await room(m, 'adventure:last_ball');
    r0.tick();
    const alone = navDigest(m, r0.sim);
    const g0 = m.nav.navGridFor(r0.sim);
    const kiosks = [...r0.sim.entities.values()].filter((e) => e.kind === m.T.EntityKind.Terminal);
    // its own kiosks close their cells (the Ordnance Kiosks on the ground; the Rooftop Hangar on the roof deck)
    const ground = kiosks.filter((e) => e.pos.y < 3), roof = kiosks.find((e) => e.pos.y > 5)!;
    expect(ground.length).toBe(2);
    for (const e of ground) expect(m.nav.isWalkable(g0, e.pos.x, e.pos.z), `${e.name} at ${e.pos.x.toFixed(1)}, ${e.pos.z.toFixed(1)}`).toBe(false);
    const deck = navOf(m, r0.sim).decks.find((d) => { const c = m.nav.cellIndex(d, roof.pos.x, roof.pos.z); return c >= 0 && Math.abs(d.ground[c] - roof.pos.y) < 0.5; });
    expect(deck, 'the roof deck under the Rooftop Hangar').toBeTruthy();
    expect(m.nav.isWalkable(deck!, roof.pos.x, roof.pos.z), 'the Rooftop Hangar on the roof deck').toBe(false);
    r0.dispose();

    // after other rooms built the shared caches: TDM (Kart-O-Matics, a hangar, and a kart waiting on each pad and a plane
    // on the roof when it builds them), boss-rush (kiosks only, no hangar)
    for (const pre of ['team-deathmatch', 'boss-rush']) {
      m = await fresh();
      const p = await room(m, pre);
      if (pre === 'team-deathmatch') {
        const data = p.sim.worldData;
        for (const team of [m.T.Team.Corgis, m.T.Team.Cats]) {
          const s = m.V.findTerminalSite(data, team)!;
          m.V.spawnKart(p.sim, 'mower_kart', team, s.padX, s.padY + 0.02, s.padZ, s.padYaw);
        }
        const h = m.V.hangarSite(data)!;
        expect(m.V.spawnPlane(p.sim, 'rc_plane', m.T.Team.Corgis, h.padX, h.padY, h.padZ, h.padYaw), 'a plane on the hangar pad').toBeTruthy();
      }
      p.tick();       // tick 0 (the physics step puts the vehicles in Rapier's query structures)
      navOf(m, p.sim);
      const karts = [...p.sim.entities.values()].filter((e) => e.terminal?.id === 'kart_terminal');
      expect(karts.length, `${pre}: Kart-O-Matics`).toBe(pre === 'team-deathmatch' ? 2 : 0);
      // the pre room's own Kart-O-Matics are closed in its grid ...
      for (const e of karts) expect(m.nav.isWalkable(m.nav.navGridFor(p.sim), e.pos.x, e.pos.z), `${pre}: its ${e.name}`).toBe(false);
      p.dispose();
      const r = await room(m, 'adventure:last_ball');
      r.tick();
      // ... and open in chapter 6's (it has none)
      for (const e of karts) expect(m.nav.isWalkable(m.nav.navGridFor(r.sim), e.pos.x, e.pos.z), `ch6 after ${pre}: the ${pre} ${e.name}`).toBe(true);
      expect(navDigest(m, r.sim), `chapter 6's nav after a ${pre} room`).toEqual(alone);
      r.dispose();
    }
  }, 120000);

  it('chapter 6 (bot-only) plays out tick for tick the same alone and after two TDM ticks (60 s)', async () => {
    const TICKS = 60 * 60;
    const alone = await play(await fresh(), 'adventure:last_ball', TICKS);
    const m = await fresh();
    const pre = await room(m, 'team-deathmatch');
    pre.tick();
    pre.tick();   // tick 1: the room's bots build their nav grid (the shared cache, before the fix from this room)
    pre.dispose();
    const after = await play(m, 'adventure:last_ball', TICKS);
    const d = firstDiff(alone.hashes, after.hashes);
    console.log(`[d1] ch6 alone: steps ${alone.steps.join(' ')} · last ${alone.hashes.at(-1)!.toString(16)} | after TDM: steps ${after.steps.join(' ')} · last ${after.hashes.at(-1)!.toString(16)}${d >= 0 ? ` · first divergent tick ${d + 1}` : ''}`);
    expect(alone.steps.length).toBeGreaterThanOrEqual(4);   // glide, plane, flyover done: the Vac-Tank fight is on
    expect(d, 'first tick where chapter 6 after a TDM room differs from chapter 6 alone').toBe(-1);
    expect(after.steps).toEqual(alone.steps);
  }, 180000);
});
