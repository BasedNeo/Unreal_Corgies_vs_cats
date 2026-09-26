// Objective chains as data (MASTER_PLAN §13 format): each step is `{ id, district, text, trigger: {type,
// params}, reward }`. The authoritative runner is src/sim/interact/objectives.ts; it writes plain data to
// `sim.state.objective` (ObjectiveState) and drives one beacon entity for clients.
//
// Trigger types implemented by the runner: `interact` (press Interact within `radius` of the point),
// `hold` (keep at least one squad member inside the cylinder with no enemies for `seconds`; progress
// pauses while contested and drains at `decay` ×/s while empty), `reach` (any squad member enters the
// cylinder). §13's `collect`, `defeat` and `survive` are reserved for later chains.
//
// Snapshot convention for the beacon (EntityState, EntityKind.Prop — one per running chain):
//   cls = index into OBJECTIVE_CHAIN_IDS · team = the chain's team · x, y, z = current target point ·
//   weapon = current step index (-1 = inactive, steps.length = chain complete) · ammo = hold progress % ·
//   hp / maxHp = hold seconds done / needed · flags & Busy = contested.
// Events: `bark { id: player, line }` on every step, `score { team, pts, reason: 'objective' }`,
// `pickup { id: player, item }` when an interact step carries an item.
import { Team, type TeamId } from '../types';

export type ObjectiveTrigger =
  | { type: 'interact'; params: { x: number; z: number; radius: number; prompt: string } }
  | { type: 'hold'; params: { x: number; z: number; radius: number; height: number; seconds: number; decay: number } }
  | { type: 'reach'; params: { x: number; z: number; radius: number; height: number } };

export interface ObjectiveReward {
  /** Team points (MatchState score after the lead's fold; always announced with a `score` event). */
  score: number;
  /** Roster points for the player(s) who completed the step. */
  roster: number;
  /** Comedy bark line (GameEvent `bark`), spoken by the completing player. */
  bark: string;
  /** Item handed to the completing player (GameEvent `pickup`), e.g. the Squeaker. */
  item?: string;
}

export interface ObjectiveDef {
  id: string;
  district: string;
  /** HUD text (short). */
  text: string;
  trigger: ObjectiveTrigger;
  reward: ObjectiveReward;
}

export interface ObjectiveChain {
  id: string;
  /** Map (WorldData.name) and match mode the chain runs in. */
  map: string;
  mode: string;
  /** Team the chain belongs to (its squad progresses it; the other team contests holds). */
  team: TeamId;
  steps: readonly ObjectiveDef[];
  /** HUD text shown for `doneTime` s after the last step. */
  doneText: string;
  doneTime: number;
}

/** Wire order (beacon EntityState.cls). Append only. */
export const OBJECTIVE_CHAIN_IDS = ['yard_squeaker'] as const;
export type ObjectiveChainId = (typeof OBJECTIVE_CHAIN_IDS)[number];

export const OBJECTIVE_CHAINS: Record<ObjectiveChainId, ObjectiveChain> = {
  // West Yard skirmish: the cats stole the squad's favourite squeaky toy and stashed it by their shed.
  // Grab it (behind the cat spawns), rally on the trampoline while the waves come at you, then take the
  // fight to the Cat Tree and bark the yard back.
  yard_squeaker: {
    id: 'yard_squeaker', map: 'West Yard', mode: 'yard-skirmish', team: Team.Corgis,
    doneText: 'The yard is OURS! Squeaker returned', doneTime: 10,
    steps: [
      {
        id: 'grab_squeaker', district: 'west_yard', text: 'Grab the Squeaker from the shed',
        trigger: { type: 'interact', params: { x: 47, z: 78.4, radius: 2.6, prompt: 'grab the Squeaker' } },
        reward: { score: 5, roster: 50, bark: 'Squeaker secured! SQUEAK SQUEAK!', item: 'squeaker' },
      },
      {
        id: 'hold_trampoline', district: 'west_yard', text: 'Hold the trampoline',
        trigger: { type: 'hold', params: { x: 0, z: 0, radius: 8.5, height: 14, seconds: 20, decay: 0.5 } },
        reward: { score: 5, roster: 30, bark: 'Trampoline is ours! Boing boing!' },
      },
      {
        id: 'bark_cat_tree', district: 'west_yard', text: 'Bark at the Cat Tree',
        trigger: { type: 'interact', params: { x: 22, z: 84, radius: 4.8, prompt: 'bark at the Cat Tree' } },
        reward: { score: 25, roster: 100, bark: 'BORK! This yard belongs to the CORGIS!' },
      },
    ],
  },
};

export function objectiveChainIndex(id: string): number {
  return (OBJECTIVE_CHAIN_IDS as readonly string[]).indexOf(id);
}

export function objectiveChainByIndex(i: number): ObjectiveChain | null {
  const id = OBJECTIVE_CHAIN_IDS[i];
  return id ? OBJECTIVE_CHAINS[id] : null;
}

/** Chains that run on a map in a mode. */
export function chainsFor(mapName: string, mode: string): ObjectiveChain[] {
  return Object.values(OBJECTIVE_CHAINS).filter((c) => c.map === mapName && c.mode === mode);
}
