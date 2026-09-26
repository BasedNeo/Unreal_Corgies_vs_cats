// Q2 P1-1 regression: "bots help, never steal the win". In chapter 3 with a human in the squad, the Breacher pups
// escorting the first reach step must not mine the zone next to the Garage breach wall: X1's breaching fuse would
// blow it long before the human's own "blow the wall" step.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { adventureState } from '../../src/sim/adventure';
import { destructiblesByTag } from '../../src/sim/destruct';
import { PROTOCOL_VERSION, TICK_HZ } from '../../src/shared/constants';
import { EntityKind } from '../../src/shared/types';
import { Btn } from '../../src/shared/input';
import { DESTROY_HOLD_OFF } from '../../src/sim/ai/tactics';

describe('adventure: pups never do the human\'s set piece', () => {
  it('ch3 with an idle human Breacher: the wall stands through step 1; it falls to the step meant for it', async () => {
    for (const seed of [1, 3]) {
      const sim = await Sim.create({ seed });
      const room = new Room(sim, { mode: 'adventure', chapter: 'garage_job', botsPerTeam: [4, 0] });
      const conn = { id: `human-${seed}`, send() {} };
      room.join(conn as never, { t: 'hello', v: PROTOCOL_VERSION, name: 'Human', team: 0, cls: 'breacher' });
      const wall = () => destructiblesByTag(sim, 'garage_breach_wall')[0];
      let brokeInStep1 = false;
      for (let i = 0; i < 30 * TICK_HZ; i++) {
        room.tick();
        if (wall().dsx!.broken && (adventureState(sim)?.step ?? 0) === 0) brokeInStep1 = true;
      }
      expect(adventureState(sim)!.phase).toBe('live');
      expect(adventureState(sim)!.step).toBe(0); // the human hasn't reached the wall yet
      expect(brokeInStep1, `seed ${seed}: the pups breached during step 1`).toBe(false);
      expect(wall().dsx!.broken).toBe(false);
      // the human walks up: step 2 (blow the wall) starts with the wall still standing
      const h = [...sim.entities.values()].find((e) => e.kind === EntityKind.Player)!;
      sim.placeCharacter(h, 97, sim.worldData.height(97, -66) + 0.05, -66);
      for (let i = 0; i < 3 * TICK_HZ && adventureState(sim)!.step < 1; i++) room.tick();
      expect(adventureState(sim)!.step).toBe(1);
      expect(wall().dsx!.broken).toBe(false);
      room.dispose();
    }
  }, 180_000);

  it('ch3 step 2 (blow the wall): the human who plants blows it; an idle human gets help only after the hold-off', async () => {
    // Q3 P1-1: pups planted 0.02–0.5 s into the human's own step, so even a quick player lost the moment
    for (const plant of [true, false]) {
      const sim = await Sim.create({ seed: 3 });
      const room = new Room(sim, { mode: 'adventure', chapter: 'garage_job', botsPerTeam: [4, 0] });
      const slot = room.join({ id: 'h', send() {} } as never, { t: 'hello', v: PROTOCOL_VERSION, name: 'Human', team: 0, cls: 'breacher' })!;
      const wall = () => destructiblesByTag(sim, 'garage_breach_wall')[0];
      let seq = 0;
      const input = (buttons = 0) => room.handle(slot.pid, { t: 'input', cmds: [{ seq: ++seq, mx: 0, mz: 0, yaw: Math.PI / 2, pitch: 0, buttons, rt: Math.max(0, sim.tick - 2) }] });
      for (let i = 0; i < 30 * TICK_HZ; i++) { input(); room.tick(); }
      const h = [...sim.entities.values()].find((e) => e.kind === EntityKind.Player)!;
      sim.placeCharacter(h, 95.5, sim.worldData.height(95.5, -66) + 0.05, -66); // at the boards
      let s2 = -1;
      for (let i = 0; i < 3 * TICK_HZ && s2 < 0; i++) { input(); room.tick(); if (adventureState(sim)!.step >= 1) s2 = sim.tick; }
      expect(s2).toBeGreaterThan(0);
      let broke = -1;
      for (let i = 0; i < (DESTROY_HOLD_OFF + 35) * TICK_HZ && broke < 0; i++) {
        const t = (sim.tick - s2) / TICK_HZ;
        input(plant && t >= 1 && t < 1.2 ? Btn.Ability : 0);
        room.tick();
        h.health!.hp = h.health!.max; // the test is about the wall, not the fight
        if (wall().dsx!.broken) broke = sim.tick;
      }
      expect(broke, `plant=${plant}: the wall never fell`).toBeGreaterThan(0);
      const by = sim.entities.get(wall().dsx!.brokeBy);
      if (plant) expect(by?.kind, 'the human planted first, so the breach is theirs').toBe(EntityKind.Player);
      else expect((broke - s2) / TICK_HZ, 'the pups wait out the hold-off before they help').toBeGreaterThanOrEqual(DESTROY_HOLD_OFF);
      room.dispose();
    }
  }, 240_000);
});
