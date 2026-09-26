import { randomLook, tauntLines } from '../../src/shared/content/cosmetics';
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Btn, sanitizeInput } from '../../src/shared/input';
import { EntityKind, Species, Team } from '../../src/shared/types';
import { TAUNTS, TAUNT_COOLDOWN } from '../../src/shared/content/taunts';
import { emoteSystem } from '../../src/sim/systems/emote';
import { combatBus } from '../../src/sim/combat/state';
import { TICK_HZ } from '../../src/shared/constants';

async function setup() {
  const sim = await Sim.create({ seed: 4, systems: [emoteSystem] });
  const dog = sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'Rex' });
  return { sim, dog };
}
const press = (sim: Sim, id: number, seq: number, b: number) => { sim.setInput(id, { seq, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: b, rt: 0 }); sim.step(); };

describe('emote / taunt', () => {
  it('Emote (B) survives input sanitizing and makes the player bark a species taunt, at most once per cooldown', async () => {
    const { sim, dog } = await setup();
    expect(sanitizeInput({ seq: 1, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: Btn.Emote, rt: 0 })!.buttons & Btn.Emote).toBeTruthy();
    let seq = 1;
    const barks: string[] = [];
    for (let i = 0; i < TICK_HZ * TAUNT_COOLDOWN * 2 + 10; i++) {
      press(sim, dog.id, seq++, i % 20 < 2 ? Btn.Emote : 0); // mashing B every third of a second
      for (const ev of sim.drainEvents()) if (ev.e === 'bark' && ev.id === dog.id) barks.push(ev.line);
    }
    expect(barks.length).toBe(3); // t = 0, 3 s, 6 s
    for (const l of barks) expect(TAUNTS[Species.Corgi]).toContain(l);
  });

  it('bots sometimes taunt their knockouts, deterministically and without consuming the shared sim RNG', async () => {
    const run = async (withEmotes: boolean) => {
      const sim = await Sim.create({ seed: 4, systems: withEmotes ? [emoteSystem] : [] });
      const cat = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, cls: 'assault', name: 'Tom' });
      const lines: string[] = [];
      for (let k = 0; k < 40; k++) {
        combatBus(sim).kills.push({ victim: 1000 + k, killer: cat.id, victimTeam: Team.Corgis, killerTeam: Team.Cats, tick: sim.tick + 1, weapon: 0 });
        for (let i = 0; i < TICK_HZ * TAUNT_COOLDOWN + 1; i++) sim.step();
        combatBus(sim).kills.length = 0;
        for (const ev of sim.drainEvents()) if (ev.e === 'bark') lines.push(ev.line);
      }
      return { lines, rngNext: sim.rng(), pack: tauntLines(randomLook(cat.seed, Species.Cat), Species.Cat) };
    };
    const a = await run(true), b = await run(true), off = await run(false);
    expect(a.lines).toEqual(b.lines);
    expect(a.lines.length).toBeGreaterThan(4);   // ~30 % of 40
    expect(a.lines.length).toBeLessThan(25);
    for (const l of a.lines) expect(a.pack).toContain(l); // N2: the bot's seeded look picks its taunt pack
    expect(a.rngNext).toBe(off.rngNext); // taunts never draw from sim.rng: outcomes can't shift
  });
});
