// W10 U3: the kill feed names the killing weapon from the death event (C10 `death.wpn`).
// - a throwable knockout shows its own glyph (the corgis' squeaker grenade, the cats' hairball bomb, in their tape),
//   a gun knockout the gun's glyph, a seated killer's gun kill the vehicle; with no wpn, exactly the pre-W10 guesses;
// - end to end: a real Sim throw kills, the death event crosses the wire encoder (online) and the worker's structured
//   clone (offline) and resolves to the throwable's glyph on the other side.
import { describe, it, expect } from 'vitest';
import { killGlyph, type KillGlyphInput } from '../../src/client/ui/kill-feed';
import { WEAPON_GLYPHS, weaponGlyph } from '../../src/client/ui/icons';
import { WEAPON_FX, WeaponTable } from '../../src/client/fx/weapon-fx';
import { ORDNANCE_IDS, ORDNANCE_RULES, ordnanceWire } from '../../src/shared/content/ordnance';
import { WEAPON_IDS, weaponIndex } from '../../src/shared/content/weapons';
import { Sim, type SimSystem } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Btn } from '../../src/shared/input';
import { EntityKind, Species, Team, type TeamId } from '../../src/shared/types';
import type { GameEvent, ServerMsg } from '../../src/shared/protocol';
import type { WorldData } from '../../src/shared/world/world-data';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { emoteSystem } from '../../src/sim/systems/emote';
import { combatSystems, kill } from '../../src/sim/combat';
import { interactSystems, type InteractConfig } from '../../src/sim/interact';
import { SnapDecoder, SnapEncoder, decodeServerFrame, encodeServerMsg } from '../../src/host/wire';

type Death = Extract<GameEvent, { e: 'death' }>;
const table = new WeaponTable();
/** The HUD's gun lookup (hud.ts: its WeaponTable → WEAPON_FX glyph; unknown index → null). */
const gunGlyph = (w: number): string | null => { const id = table.id(w); return id === 'unknown' ? null : WEAPON_FX[id].glyph; };
const base: KillGlyphInput = { self: false, exploded: false, ride: null, gunGlyph };
const RIFLE = weaponIndex('squeaker_rifle'), MORTAR = weaponIndex('tennis_mortar'), LASER = weaponIndex('laser_longshot');
const SQUEAKER = ordnanceWire('squeaker_grenade'), HAIRBALL = ordnanceWire('hairball_bomb');

/** The pre-W10 expression from hud.ts, kept as the oracle for "no wpn". */
function legacy(self: boolean, exploded: boolean, rideOnFoot: 'plane' | 'kart' | null, lastWpn: number | undefined): string {
  const ride = !self && !exploded ? rideOnFoot : null;
  return self ? 'fall' : exploded ? 'boom' : ride ?? (lastWpn !== undefined ? WEAPON_FX[table.id(lastWpn)].glyph : 'paw');
}

describe('W10 U3: the kill-feed glyph follows death.wpn', () => {
  it('a throwable shows its own glyph: grenade for corgis, hairball for cats, over every other guess', () => {
    expect(killGlyph({ ...base, wpn: SQUEAKER })).toBe('squeaker_grenade');
    expect(killGlyph({ ...base, wpn: HAIRBALL })).toBe('hairball_bomb');
    // the blast guess, a stale gun and a seat never override the authority's weapon
    expect(killGlyph({ ...base, wpn: SQUEAKER, exploded: true, ride: 'kart', lastWpn: LASER })).toBe('squeaker_grenade');
    // caught in your own blast: the throwable, not the fall arrow
    expect(killGlyph({ ...base, self: true, wpn: HAIRBALL })).toBe('hairball_bomb');
  });

  it('a gun shows that gun (not the last one fired); a seated killer shows the vehicle', () => {
    expect(killGlyph({ ...base, wpn: RIFLE, lastWpn: LASER })).toBe('rifle');
    expect(killGlyph({ ...base, wpn: LASER })).toBe('laser');
    expect(killGlyph({ ...base, wpn: MORTAR, exploded: true })).toBe('mortar'); // the weapon, not a generic blast
    expect(killGlyph({ ...base, wpn: RIFLE, ride: 'plane' })).toBe('plane'); // the plane's gun reports a hand gun
    expect(killGlyph({ ...base, self: true, wpn: MORTAR })).toBe('fall'); // own mortar splash: as before
  });

  it('no wpn (or an index nobody knows): exactly the pre-W10 behaviour, for every combination', () => {
    for (const self of [false, true]) for (const exploded of [false, true]) for (const ride of [null, 'plane', 'kart'] as const)
      for (const lastWpn of [undefined, 0, 1, 2, 3, 6, 99]) {
        const want = legacy(self, exploded, ride, lastWpn);
        const rideIn = self ? null : ride; // hud.ts computes the seat for any non-self knockout
        expect(killGlyph({ ...base, self, exploded, ride: rideIn, lastWpn })).toBe(want);
        expect(killGlyph({ ...base, self, exploded, ride: rideIn, lastWpn, wpn: 57 })).toBe(want); // unknown index
        expect(killGlyph({ ...base, self, exploded, ride: rideIn, lastWpn, wpn: -1 })).toBe(want);
      }
  });

  it('every throwable has a glyph in its faction tape, distinct from the fallback paw', () => {
    for (const id of ORDNANCE_IDS) {
      const g = WEAPON_GLYPHS[id];
      expect(g, id).toBeTruthy();
      expect(weaponGlyph(id)).toBe(g);
      expect(g).not.toBe(WEAPON_GLYPHS.paw);
      expect(g).toContain('class="glyph"');
      expect(killGlyph({ ...base, wpn: ORDNANCE_RULES.wireBase + ORDNANCE_IDS.indexOf(id) })).toBe(id);
    }
    expect(WEAPON_GLYPHS.squeaker_grenade).toContain('color:#2f6fd6'); // corgi blue tape
    expect(WEAPON_GLYPHS.hairball_bomb).toContain('color:#c9344a'); // cat crimson tape
    for (let i = 0; i < WEAPON_IDS.length; i++) expect(ORDNANCE_RULES.wireBase).toBeGreaterThan(i); // no overlap with guns
  });
});

// ------------------------------------------------------------------------------------------------ end to end

function flat(): WorldData {
  const n = 41, cell = 2;
  return {
    seed: 1, name: 'u3 kill-feed yard', height: () => 0, halfExtent: 40, killY: -30,
    terrain: { x0: -40, z0: -40, cell, n, heights: new Float32Array(n * n) },
    props: [],
    spawns: [{ x: -30, y: 0, z: 30, yaw: 0, team: Team.Corgis }, { x: 30, y: 0, z: -30, yaw: Math.PI, team: Team.Cats }],
    bounds: { minX: -38, maxX: 38, minZ: -38, maxZ: 38 },
  };
}

async function arena(): Promise<Sim> {
  const systems: SimSystem[] = [...interactSystems(), movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems(), emoteSystem];
  const sim = await Sim.create({ seed: 7, world: flat(), systems });
  sim.state.interactConfig = { auto: true, cores: false, kibble: false, objectives: false, layout: { cores: [], kibble: [] } } satisfies InteractConfig;
  sim.state.room = { mode: 'team-deathmatch' };
  return sim;
}

function pet(sim: Sim, team: TeamId, x: number, z: number, yaw: number): SimEntity {
  return sim.spawnCharacter({ kind: EntityKind.Player as 0, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'assault', name: `u3-${team}-${x}`, x, y: 0.02, z, yaw, ownerPid: `p${team}${x}` });
}

let seq = 1;
/** Throw at the ground just ahead (tap Throw, looking down), then run the fuse out; returns the deaths. */
function throwAt(sim: Sim, thrower: SimEntity): Death[] {
  const out: GameEvent[] = [];
  const step = (buttons: number) => {
    sim.setInput(thrower.id, { seq: seq++, mx: 0, mz: 0, yaw: thrower.yaw, pitch: -0.7, buttons, rt: 0 });
    sim.step();
    out.push(...sim.drainEvents());
    sim.removedIds.length = 0;
  };
  step(0); step(0); // a fresh pet gets its throwable on its first tick (ordnance-life, order 805)
  step(Btn.Throw); // a one-tick tap throws
  for (let i = 0; i < 60 * 4; i++) step(0); // the 2.2 s fuse and the blast
  return out.filter((e): e is Death => e.e === 'death');
}

/** Online: the Node server's frame path (per-connection SnapEncoder → JSON text → SnapDecoder). */
function overTheWire(ev: GameEvent[]): GameEvent[] {
  const enc = new SnapEncoder(), dec = new SnapDecoder();
  const snap = { t: 'snap', tick: 1, ack: 0, you: 1, ents: [], gone: [], match: { mode: 'team-deathmatch', phase: 'live', timeLeft: 60, score: [0, 0], objective: '', wave: 0, winner: -1 }, ev } as ServerMsg;
  const back = decodeServerFrame(encodeServerMsg(snap, enc), dec) as Extract<ServerMsg, { t: 'snap' }>;
  return back.ev;
}

/** Offline: the worker posts ServerMsg objects (structured clone). */
const overTheWorker = (ev: GameEvent[]): GameEvent[] => (structuredClone({ t: 'snap', ev }) as { ev: GameEvent[] }).ev;

describe('W10 U3: a real throwable knockout reaches the feed as its glyph, online and offline', () => {
  it.each([
    ['corgi throws a squeaker grenade', Team.Corgis, 'squeaker_grenade'],
    ['cat throws a hairball bomb', Team.Cats, 'hairball_bomb'],
  ] as const)('%s', async (_label, team, glyph) => {
    const sim = await arena();
    const thrower = pet(sim, team, 0, 0, 0); // yaw 0 faces -Z
    const victim = pet(sim, (1 - team) as TeamId, 0, -2.5, Math.PI);
    victim.health!.hp = 1; // any blast inside the radius knocks it out (the blast never one-shots a full pet)
    const deaths = throwAt(sim, thrower);
    const d = deaths.find((e) => e.id === victim.id);
    expect(d, 'the blast knocked the victim out').toBeTruthy();
    expect(d!.by).toBe(thrower.id);
    expect(d!.wpn).toBe(ordnanceWire(glyph));
    for (const [path, ev] of [['online', overTheWire([d!])], ['offline', overTheWorker([d!])]] as const) {
      const got = ev[0] as Death;
      expect(got, path).toEqual(d);
      const g = killGlyph({ ...base, self: got.by === got.id, exploded: true, lastWpn: RIFLE, wpn: got.wpn });
      expect(g, path).toBe(glyph);
      expect(weaponGlyph(g)).toBe(WEAPON_GLYPHS[glyph]);
    }
    sim.dispose();
  });

  it('a gun knockout shows the gun; an old authority (no wpn) keeps the old guess', async () => {
    const sim = await arena();
    const a = pet(sim, Team.Corgis, 0, 0, 0), b = pet(sim, Team.Cats, 0, -6, Math.PI), c = pet(sim, Team.Cats, 4, -6, Math.PI);
    kill(sim, b, { id: a.id, team: a.team, weapon: LASER });
    const [gunDeath] = sim.drainEvents().filter((e): e is Death => e.e === 'death');
    for (const ev of [overTheWire([gunDeath]), overTheWorker([gunDeath])]) {
      expect(killGlyph({ ...base, lastWpn: RIFLE, wpn: (ev[0] as Death).wpn })).toBe('laser');
    }
    kill(sim, c, { id: a.id, team: a.team, weapon: -1 }); // an ability, a ram: no weapon on the event
    const [noWpn] = overTheWire(sim.drainEvents().filter((e) => e.e === 'death')) as Death[];
    expect(noWpn.wpn).toBeUndefined();
    expect(killGlyph({ ...base, lastWpn: RIFLE, wpn: noWpn.wpn })).toBe('rifle');
    sim.dispose();
  });
});
