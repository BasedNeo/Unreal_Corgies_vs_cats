// A2 on the real West Yard with a scripted human stand-in: each chapter's featured kit (or vehicle) is what gets a
// step done, and the human-only rules really hold there.
//   3 The Garage Job     the breach wall falls only to a Breacher (a squad without one never breaks it); the escape
//                        needs the Mower Kart parked by the roll-up door (walking to the gate doesn't count; driving does)
//   4 Laser Pointer      the perch step needs feet up on the garage roof (the garage below doesn't count)
//   5 The Porch Siege    E at the plank piles raises the barricades; they stand again after a checkpoint restart
//   6 The Last Ball      only a Skyraider's Ear Glide off the roof reaches the glide zone (a double jump or another kit
//                        lands short); vend + board the RC plane at the Rooftop Hangar, fly over the shed (the
//                        autopilot); the ball is taken from the shed roof, not from the lawn under it; a crashed
//                        pilot respawns up by the hangar while the pups rally on the ground
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { createDefaultSystems } from '../../src/sim/systems';
import { adventureSystems, adventureState, adventureRuntime, restartAtCheckpoint, type AdventureConfig } from '../../src/sim/adventure';
import { breakDestructibles, destructibleCount } from '../../src/sim/destruct';
import { planeAutopilot } from '../../src/sim/vehicles';
import { kill } from '../../src/sim/combat/damage';
import { Btn, type InputCmd } from '../../src/shared/input';
import { EFlag, EntityKind, Species, Team, type ClassId } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import { TICK_HZ } from '../../src/shared/constants';
import { surfaceAt, yawToward } from '../../src/shared/world/queries';
import { BARRICADE_HP, REGROUP_SECONDS, chapterById, type ChapterDef } from '../../src/shared/content/chapters';

function withAdventure() {
  const sys = createDefaultSystems();
  return sys.some((s) => s.name === 'adventure') ? sys : [...sys, ...adventureSystems()];
}

interface Play { sim: Sim; h: SimEntity; evs: GameEvent[]; tick(cmd?: Partial<InputCmd>): void; ticks(n: number, cmd?: Partial<InputCmd>): void; st(): NonNullable<ReturnType<typeof adventureState>> }

/** A chapter on the West Yard with one scripted human (no pups unless `pups` bots are added), live after a short briefing. */
async function play(chapter: string, cls: ClassId, pups = 0, cfg: AdventureConfig = {}): Promise<Play> {
  const sim = await Sim.create({ seed: 1, systems: withAdventure() });
  sim.state.room = { mode: 'adventure', chapter };
  sim.state.adventureConfig = { briefing: 0.1, briefingWait: 0.1, ...cfg } satisfies AdventureConfig;
  const h = sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls, name: 'Rex', ownerPid: 'p1', x: 0, y: 0.02, z: 0 });
  for (let i = 0; i < pups; i++) sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: `Pup ${i + 1}`, x: 0, y: 0.02, z: 0 });
  let seq = 1;
  const evs: GameEvent[] = [];
  const tick = (cmd: Partial<InputCmd> = {}) => {
    sim.setInput(h.id, { seq: seq++, mx: 0, mz: 0, yaw: h.yaw, pitch: 0, buttons: 0, rt: 0, ...cmd });
    sim.step();
    evs.push(...sim.drainEvents());
  };
  const ticks = (n: number, cmd: Partial<InputCmd> = {}) => { for (let i = 0; i < n; i++) tick(cmd); };
  for (let i = 0; i < 60 && adventureState(sim)?.phase !== 'live'; i++) tick();
  expect(adventureState(sim)!.phase).toBe('live');
  return { sim, h, evs, tick, ticks, st: () => adventureState(sim)! };
}

/** E once (a press, then a release). */
function interact(p: Play): void {
  p.tick({ buttons: Btn.Interact });
  p.tick();
}

/** Run off the roof's south parapet toward (tx, tz): jump, jump near the apex, then (glide) Q at the second apex. */
function leapOffTheRoof(p: Play, glide: boolean, tx = 84, tz = -26): 'done' | 'landed' {
  const { h } = p;
  let phase = 0;
  for (let i = 0; i < 8 * TICK_HZ; i++) {
    const c = h.char!;
    let b = Btn.Sprint;
    if (phase === 0) { if (h.pos.z > -50.2) { b |= Btn.Jump; if (!c.grounded) phase = 1; } }
    else if (phase === 1) { if (h.vel.y > 1) b |= Btn.Jump; else phase = 2; }
    else if (phase === 2) { b |= Btn.Jump; if (c.jumpsUsed >= 2) phase = 3; }
    else if (phase === 3) { if (h.vel.y > 0.3) b |= Btn.Jump; else if (glide) { b |= Btn.Ability; phase = 4; } }
    p.tick({ mz: 1, buttons: b, yaw: h.pos.z > -50.5 ? yawToward(h.pos.x, h.pos.z, tx, tz) : Math.PI });
    if (p.st().step !== 0) return 'done';
    if (c.grounded && phase > 0 && h.pos.y < 1) return 'landed';
  }
  return 'landed';
}

describe('chapter 3 "The Garage Job": Breacher and the Mower Kart', () => {
  it('the breach wall falls only to a Breacher: a bot squad without one never breaks it', async () => {
    const def = chapterById('garage_job')!;
    const sim = await Sim.create({ seed: 1, systems: withAdventure() });
    sim.state.adventureConfig = { chapter: { ...def, pups: ['assault', 'assault', 'overwatch', 'infiltrator'] } satisfies ChapterDef };
    const room = new Room(sim, { mode: 'adventure', chapter: 'garage_job', botsPerTeam: [4, 0] });
    for (let i = 0; i < 100 * TICK_HZ; i++) room.tick();
    const st = adventureState(sim)!;
    expect(st.step).toBe(1); // at the wall since ~20 s, 80 s ago
    expect(destructibleCount(sim, 'garage_breach_wall')).toBe(0);
    expect([...sim.entities.values()].filter((e) => e.kind === EntityKind.Bot && e.team === Team.Corgis).every((e) => e.cls !== 'breacher')).toBe(true);
    room.dispose();
  }, 120000);

  it('the escape needs the kart: walking into the gate zone does nothing, driving the parked Mower Kart there finishes the chapter', async () => {
    const p = await play('garage_job', 'breacher');
    const { sim, h } = p;
    sim.placeCharacter(h, 97, sim.worldData.height(97, -66) + 0.05, -66);
    p.ticks(2);
    expect(p.st().step).toBe(1);
    breakDestructibles(sim, 'garage_breach_wall');
    breakDestructibles(sim, 'tuna_stack');
    p.ticks(3);
    expect(p.st().step).toBe(3);
    const kart = [...sim.entities.values()].find((e) => e.kart)!;
    expect(Math.hypot(kart.pos.x - 81, kart.pos.z + 43)).toBeLessThan(0.01);
    // on foot at the gate: nothing
    sim.placeCharacter(h, -77, sim.worldData.height(-77, -63.5) + 0.05, -63.5);
    p.ticks(30);
    expect(p.st().step).toBe(3);
    // hop in, drive west to the garden gate
    sim.placeCharacter(h, kart.pos.x + 1.8, kart.pos.y + 0.1, kart.pos.z);
    p.ticks(10);
    interact(p);
    expect(h.flags & EFlag.Mounted).toBeTruthy();
    let t = 0;
    for (; t < 40 * TICK_HZ && p.st().phase === 'live'; t++) {
      let d = yawToward(kart.pos.x, kart.pos.z, -77, -63.5) - kart.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      p.tick({ mz: 1, mx: Math.max(-1, Math.min(1, -d * 2)) });
      h.health!.hp = h.health!.max; // (the stand-in drives through the chasers; this is about the rule, not the fight)
    }
    console.log(`[a2] garage_job escape: ${(t / TICK_HZ).toFixed(1)} s from the roll-up door to the garden gate`);
    expect(p.st().phase).toBe('complete');
  }, 60000);
});

describe('chapter 4 "Laser Pointer at Dawn": the perch is up on the roof', () => {
  it('standing in the garage under the perch does not count; feet on the roof there do, and Madame Pointillé arrives', async () => {
    const p = await play('laser_dawn', 'overwatch');
    const { sim, h } = p;
    sim.placeCharacter(h, 70, sim.worldData.height(70, -50) + 0.25, -50);
    p.ticks(30);
    expect(h.pos.y).toBeLessThan(1);
    expect(p.st().step).toBe(0);
    sim.placeCharacter(h, 69.4, 7.25, -49.6);
    p.ticks(30);
    expect(h.pos.y).toBeGreaterThan(6.5);
    expect(p.st().step).toBe(1);
    expect([...adventureRuntime(sim)!.enemies.values()].map((r) => r.boss)).toContain('madame_pointille');
  }, 60000);
});

describe('chapter 5 "The Porch Siege": barricades', () => {
  it('E at each plank pile raises two corgi walls; the checkpoint remembers all four; a restart stands them again at full health', async () => {
    const p = await play('porch_siege', 'warden', 3);
    const { sim, h } = p;
    const walls = () => [...sim.entities.values()].filter((e) => e.abx?.kind === 'barrier' && e.health?.max === BARRICADE_HP);
    sim.placeCharacter(h, -62, sim.worldData.height(-62, -70) + 0.05, -70);
    p.ticks(10);
    interact(p);
    expect(p.st().step).toBe(1);
    expect(walls().map((w) => [w.pos.x, w.pos.z])).toEqual([[-64.2, -68], [-59.8, -68]]);
    expect(walls().every((w) => w.team === Team.Corgis && w.yaw === Math.PI)).toBe(true);
    sim.placeCharacter(h, -44, sim.worldData.height(-44, -72) + 0.05, -72);
    p.ticks(10);
    interact(p);
    expect(p.st().step).toBe(2);
    expect(walls().length).toBe(4);
    expect(adventureRuntime(sim)!.snap!.barricades.length).toBe(4);
    walls()[0].health!.hp = 3;
    const spots = adventureRuntime(sim)!.snap!.squad!;
    expect(spots.length).toBeGreaterThanOrEqual(3); // the squad on its feet as the hold step began
    restartAtCheckpoint(sim);
    p.tick();
    expect(walls().length).toBe(4);
    expect(walls().every((w) => w.health!.hp === BARRICADE_HP)).toBe(true);
    expect(p.st().step).toBe(2);
    // Q2 P2-2: the squad is back where it stood when the step began (not bunched on the anchor), no two on one spot,
    // and the checkpoint's cats hold still for the regroup beat
    const back = spots.filter((s) => { const e = sim.entities.get(s.id)!; return Math.hypot(e.pos.x - s.x, e.pos.z - s.z) < 0.5; });
    expect(back.length).toBeGreaterThanOrEqual(spots.length - 1);
    const squad = [...sim.entities.values()].filter((e) => e.char && e.team === Team.Corgis);
    for (const a of squad) for (const b of squad) if (a.id < b.id) expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThan(0.9);
    const cats = [...sim.entities.values()].filter((e) => e.char && e.team === Team.Cats && !e.dead);
    expect(cats.length).toBeGreaterThan(0);
    const at = cats.map((c) => [c.pos.x, c.pos.z]);
    expect(cats.every((c) => (c.flags & EFlag.Stunned) !== 0)).toBe(true);
    p.ticks(Math.round((REGROUP_SECONDS - 0.3) * TICK_HZ));
    cats.forEach((c, i) => expect(Math.hypot(c.pos.x - at[i][0], c.pos.z - at[i][1])).toBeLessThan(0.3));
    p.ticks(Math.round(1.5 * TICK_HZ));
    expect(cats.some((c) => Math.hypot(c.pos.x - at[cats.indexOf(c)][0], c.pos.z - at[cats.indexOf(c)][1]) > 1)).toBe(true);
  }, 60000);
});

describe('chapter 6 "The Last Tennis Ball": Ear Glide, the RC plane, the ball on the shed roof', () => {
  it('the human starts on the garage roof; only a Skyraider gliding off it reaches the glide zone', async () => {
    const glider = await play('last_ball', 'skyraider');
    expect(glider.h.pos.y).toBeGreaterThan(7); // up on the roof
    expect(leapOffTheRoof(glider, true)).toBe('done');
    expect(glider.h.pos.y).toBeGreaterThan(4);
    const jumper = await play('last_ball', 'skyraider');
    expect(leapOffTheRoof(jumper, false)).toBe('landed'); // a double jump drops out of it
    const other = await play('last_ball', 'assault');
    expect(leapOffTheRoof(other, true)).toBe('landed'); // no ears to spread
    expect(other.st().step).toBe(0);
  }, 60000);

  it('vend + board the plane at the hangar; a crashed pilot respawns by the hangar, pups on the ground; fly over the shed; the ball comes off the roof, not the lawn', async () => {
    const p = await play('last_ball', 'skyraider', 1);
    const { sim, h } = p;
    const pup = [...sim.entities.values()].find((e) => e.kind === EntityKind.Bot && e.team === Team.Corgis)!;
    sim.placeCharacter(h, 84, 7, -26); // (through the glide zone)
    p.ticks(2);
    expect(p.st().step).toBe(1);
    const term = [...sim.entities.values()].find((e) => e.terminal?.id === 'plane_hangar')!;
    sim.placeCharacter(h, term.pos.x - Math.sin(term.yaw) * 1.4, term.pos.y + 0.05, term.pos.z - Math.cos(term.yaw) * 1.4);
    p.ticks(10);
    interact(p); // vend
    const plane = [...sim.entities.values()].find((e) => e.plane)!;
    expect(plane).toBeTruthy();
    expect(p.st().step).toBe(1); // standing next to it isn't flying it
    sim.placeCharacter(h, plane.pos.x + 1.4, plane.pos.y + 0.05, plane.pos.z);
    p.ticks(5);
    interact(p); // hop in
    expect(h.flags & EFlag.Mounted).toBeTruthy();
    expect(p.st().step).toBe(2);
    expect(p.st().anchorY).toBeCloseTo(7.2, 3); // the rally is up by the hangar now
    // a crash: the human respawns on the roof by the hangar; a pup knocked out later rallies on the ground below
    kill(sim, h, { id: -1, team: Team.Cats, weapon: -1 });
    for (let i = 0; i < 8 * TICK_HZ && h.dead; i++) p.tick();
    expect(h.dead).toBe(false);
    expect(h.pos.y).toBeGreaterThan(6.5);
    expect(Math.hypot(h.pos.x - 86, h.pos.z + 63)).toBeLessThan(6);
    kill(sim, pup, { id: -1, team: Team.Cats, weapon: -1 });
    for (let i = 0; i < 8 * TICK_HZ && pup.dead; i++) p.tick();
    expect(pup.dead).toBe(false);
    expect(pup.pos.y).toBeLessThan(1);
    expect(Math.hypot(pup.pos.x - 86, pup.pos.z + 63)).toBeLessThan(12);
    expect(p.st().wipes).toBe(0);
    // board again (the first plane waits on the runway) and fly to the shed
    p.ticks(30);
    const ride = [...sim.entities.values()].find((e) => e.plane && !e.removed)!;
    sim.placeCharacter(h, ride.pos.x + 1.4, ride.pos.y + 0.05, ride.pos.z);
    p.ticks(5);
    interact(p);
    expect(h.flags & EFlag.Mounted).toBeTruthy();
    let t = 0;
    for (; t < 60 * TICK_HZ && p.st().step === 2 && !ride.removed; t++) p.tick(planeAutopilot(sim, ride, { x: 47, z: 84, y: 13 }).cmd);
    console.log(`[a2] last_ball flyover: ${(t / TICK_HZ).toFixed(1)} s from the hangar to over the shed`);
    expect(p.st().step).toBe(3);
    expect(h.pos.y).toBeGreaterThan(8);
    // the Vac-Tank (its fight is B1's; here it just goes down)
    interact(p); // bail out
    p.ticks(90);
    const boss = [...adventureRuntime(sim)!.enemies.keys()].map((id) => sim.entities.get(id)).find((e) => e?.boss)!;
    expect(boss.name).toBe('The Vac-Tank');
    p.ticks(200);
    boss.combat!.invulnUntil = 0;
    kill(sim, boss, { id: h.id, team: Team.Corgis, weapon: 0 });
    for (let i = 0; i < 10 * TICK_HZ && p.st().step === 3; i++) p.tick();
    expect(p.st().step).toBe(4);
    const ball = [...sim.entities.values()].find((e) => e.advItem?.item === 'tennis_ball')!;
    expect(ball.pos.y).toBeGreaterThan(7.5); // on the shed's gutter
    // E on the lawn under it: nothing
    sim.placeCharacter(h, 47, sim.worldData.height(47, 78) + 0.05, 78);
    p.ticks(20);
    interact(p);
    expect(p.st().step).toBe(4);
    // up on the roof: the ball, the chapter
    sim.placeCharacter(h, 47, surfaceAt(sim.worldData, 47, 80.8).y + 0.05, 80.8);
    p.ticks(30);
    interact(p);
    expect(p.st().phase).toBe('complete');
    expect(p.evs).toContainEqual({ e: 'pickup', id: h.id, item: 'tennis_ball' });
    expect(sim.entities.has(ball.id)).toBe(false);
  }, 120000);
});
