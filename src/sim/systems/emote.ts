// Emote / taunt (order 790, after combat, before match rules consume this tick's kills). A player's Emote press
// (Btn.Emote, key B) or, sometimes, a bot's knockout emits a `bark` with a taunt line: clients voice it, pop a
// comic word and play the avatar's emote. Cosmetic only; rate-limited per character.
// Deterministic without touching sim.rng (so adding taunts never changes match outcomes): choices hash (tick, id).
import type { SimSystem } from '../sim';
import { pressed } from '../entity';
import { Btn } from '../../shared/input';
import { EntityKind } from '../../shared/types';
import { combatBus } from '../combat/state';
import { BOT_TAUNT_CHANCE, TAUNT_COOLDOWN } from '../../shared/content/taunts';
import { randomLook, tauntLines, type Look } from '../../shared/content/cosmetics';
import type { SimEntity } from '../entity';

/** The character's look (N2: set by the Room); chapter-spawned bots have no slot, so theirs comes from the seed. */
const lookOf = (e: SimEntity): Look | undefined =>
  (e.data.look as Look | undefined) ?? (e.kind === EntityKind.Bot ? randomLook(e.seed, e.species) : undefined);
import { TICK_HZ } from '../../shared/constants';

function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export const emoteSystem: SimSystem = {
  name: 'emote',
  order: 790,
  update(sim) {
    const cd = TAUNT_COOLDOWN * TICK_HZ;
    const taunt = (e: SimEntity) => {
      const last = (e.data.tauntTick as number | undefined) ?? -1e9;
      if (sim.tick - last < cd) return;
      e.data.tauntTick = sim.tick;
      const lines = tauntLines(lookOf(e), e.species); // C3: the look's taunt pack (the species' classic lines by default)
      sim.emit({ e: 'bark', id: e.id, line: lines[Math.floor(hash01(sim.tick, e.id) * lines.length) % lines.length] });
    };
    for (const e of sim.entities.values()) {
      if (!e.char || e.dead || e.kind !== EntityKind.Player) continue;
      if (pressed(e, Btn.Emote)) taunt(e);
    }
    for (const k of combatBus(sim).kills) {
      if (k.tick !== sim.tick || k.killer === k.victim) continue;
      const killer = sim.entities.get(k.killer);
      if (!killer?.char || killer.dead || killer.kind !== EntityKind.Bot) continue;
      if (hash01(k.victim, sim.tick) < BOT_TAUNT_CHANCE) taunt(killer);
    }
  },
};
