// Taunt lines (theme content, original): what a character says when its player presses Emote (B), and what bots
// sometimes say after a knockout. The voice synth turns the text into species gibberish; keep lines short.
import { Species, type SpeciesId } from '../types';

export const TAUNTS: Record<SpeciesId, readonly string[]> = {
  [Species.Corgi]: ['Bring it, whiskers!', 'Zoomies incoming!', "Who's a good boy? Me!", 'Sit. Stay. Lose.', 'Fetch THIS!', 'Tail wag of victory!'],
  [Species.Cat]: ['Pathetic.', 'Nap time, doggo.', 'I knocked that off the table.', 'Kneel, mutt.', 'Purrfectly executed.', 'Hiss-terical.'],
};

/** Seconds between two taunts from the same character (players and bots). */
export const TAUNT_COOLDOWN = 3;
/** Share of bot knockouts that get a taunt (decided by a hash, never the shared sim RNG). */
export const BOT_TAUNT_CHANCE = 0.3;
