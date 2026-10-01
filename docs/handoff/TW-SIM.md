# TW-SIM handoff — the slab mode in the TS authority (Wave 13)

**Status: done for integration; nothing committed or staged.** Room mode `slab` runs the Godot game's rules
(`engines/godot/game/match.gd`, `slab.gd`, `tuning.gd`) in the TS sim, on The Lot. No protocol change.

## Rules (as Godot)
- The slab: The Lot's control slab, centre (0, −0.0572, 0), 8 × 8 m (`slab` of `engines/godot/data/the_lot.json`,
  written by `tools/godot/export-lot.mjs`). A pet is on it when its feet are inside the square and
  centre.y − 1 < y < centre.y + 3.
- A team scores 1 point per full second while it alone has an alive pet on the slab. Contested or empty scores
  nothing, and the second being counted starts over whenever the holder changes (Godot `hold_acc`).
- First to 60 wins, else the leader at 180 s. Tied then: overtime until someone leads, at most 60 s, then a draw.
- No warm-up: live from the first tick.
- Downed pets respawn after 3 s at a team spawn (the sim's `pickSpawn`) with a 1 s spawn shield: the 60 ticks after
  the respawn tick.
- Everyone carries the Assault kit (120 hp) with the Squeaker Rifle only, and no class ability. A joiner's class or a
  class change is re-kitted before the AI and combat systems run. No ordnance, pickups, vehicles or terminals: those
  layers are gated by mode lists that don't name `slab`.
- The result holds. A human's Reload press (R / pad X, an edge at least 1 s after the end) restarts the match at 0-0
  and 3:00 with everyone back at a spawn. With no human present, it restarts after `endedHold` (10 s).
- Bots walk to the slab and hold it, fighting from it. They pick a random spot within 35 % of the slab's size of its
  centre, and a new one each time they get there. Off the slab, a bot keeps heading for it while trading shots,
  strafing as it goes (Godot `bot.gd _steer`).

## Snapshot contract
Written in full as the header of the slab section in `src/shared/content/modes.ts`. In short:
- `MatchState`:
  - `mode` is `'slab'`. `phase` is `'live'` or `'ended'`.
  - `score` is `[corgis, cats]` in whole points.
  - `timeLeft` is the regulation seconds left, or the overtime seconds left during overtime. It freezes while ended.
  - `objective` is `'HOLD THE SLAB'`, or `'OVERTIME'` during overtime. When ended it is `'CORGI COMPANY WINS'`,
    `'CAT CADRE WINS'` or `'DRAW'`.
  - `winner` is the winning team, or −1 for a draw.
- Zone: one `EntityKind.Zone` entity with seed 0 that is never removed.
  - x, y, z are the slab centre. `team` is the holder (Neutral = 2 when nobody holds it).
  - `flags & Busy` means contested. hp, maxHp and ammo are 0.
  - Its state freezes while ended and goes back to neutral on a restart.
- Exports: `SLAB` (center, size, below/above, winScore, timeLimit, overtimeMax, respawn, spawnShield, rematchDelay,
  endedHold, teamSize 1, teamSizes [1, 2], cls, weapon), `SLAB_TEXT`, `SLAB_ZONE_SEED` and `onSlab()`.
- Events: `score` with reason `'reset'` and `'win'` (both 0 points). Points for holding make no event.

## Files
| Path | What |
|---|---|
| `src/sim/match/slab.ts` | **New.** Zone entity (`setupSlab`, `resetSlab`, `evaluateSlab`, `slabZone`), `slabConfig` (`sim.state.matchConfig.slab` overrides), the kit (`applySlabKit`, `slabKitSystem` order 90), respawn delay, spawn shield. |
| `src/sim/match/index.ts` | `'slab'` in `MODES`, `updateSlab` (scoring, clock, overtime, end, rematch), `init` starts it live, `matchSystems()` adds the kit system. |
| `src/shared/content/modes.ts` | `SlabConfig`, `SLAB`, `SLAB_TEXT`, `SLAB_ZONE_SEED`, `onSlab`, the contract header. |
| `src/shared/world/maps.ts` | `MODE_HOME` (`slab` → `the_lot`), `homeMapFor`, `mapHosts`. `mapForMode`, `mapsForMode` and `mapForRoom` send every slab request to The Lot. `MAPS[*].modes` is unchanged. |
| `src/sim/ai/tactics.ts` | `slabGoal` (hold the slab). `TacticsState.advance`. |
| `src/sim/ai/brain.ts` | Engage: with `advance` set, keep heading for the zone while fighting. Only slab sets it. |
| `tests/unit/slab-mode.test.ts` | **New**, 15 tests. |

## Proof (private copy of HEAD 71d05d5 plus these files)
- `npx tsc --noEmit`: exit 0. `node tools/check-boundaries.mjs`: `BOUNDARIES: PASS`.
- `CI=1 npx vitest run tests/unit/slab-mode.test.ts`: 15/15 pass.
- maps, lot-world, contracts-w10, match-core-rush, match and ai-tactics pass when run in sequence.
  - Under parallel load, `ai-tactics` (core-rush 4v4) and `match` (TDM room) timed out. Both pass alone.
  - The `ai.test.ts` p95 budget test fails at load average ~36 (p95 5.6 ms). It fails the same way at a clean HEAD
    copy (5.4 ms), so the machine load causes it, not this change.
- Mutation checks:
  - Keeping class abilities fails the kit test.
  - Not resetting the hold count on a holder change fails the contested test.
  - Counting downed pets fails the downed test.
  - Without the engage advance, a bot stops in its band ~19.5 m out and never contests.
- Bots-only 1v1, seed 1: first point at 18 s; both teams score; deaths happen. The run is deterministic: two runs give
  identical traces.

## Follow-up (lead's second brief)
| Path | What |
|---|---|
| `src/host/guard.ts` | `'slab'` in `ROOM_MODES`: an online room accepts `?mode=slab`, and `sanitizeRoomSetup` maps it to The Lot. |
| `server/config.ts` | `botsForMode('slab')` returns `[SLAB.teamSize, SLAB.teamSize]` = `[1, 1]`. |
| `src/sim/combat/weapon-system.ts` | `fireEndsShield`: in slab, firing no longer ends spawn protection (Godot). Other modes are unchanged. |
| `src/shared/content/cosmetics.ts` | `'slab'` in `FIRST_WIN_MODES`. The first-win unlock is the cats' **Sun Spot** taunt pack (`taunt_cat_sunspot`, 5 lines). Hint text: "Win a Slab match". |
| `tests/unit/maps.test.ts`, `tests/unit/cosmetics.test.ts` | Updated for slab's home map and for 6 taunt packs per species. |
| `tests/unit/slab-mode.test.ts` | +2 tests, 17 in all. One checks the shield lasts through firing in slab, with the no-mode control showing a shot still ends it. The other runs online: a `?mode=slab` room welcomes on `the_lot`, its listing says slab, and it plays you against one Cat bot. |

Proof: `tsc` exit 0 and `BOUNDARIES: PASS`. Each of these passes when run alone: slab-mode 17/17, maps 9, cosmetics 13,
combat 18, net-room-setup 9, profile-content 11, ui-locker 9, lot-world 16, contracts-w10 4. Removing the
`fireEndsShield` gate fails the shield test.

## Open (outside these files)
1. `server/rooms.ts`: a server started with `MODE=slab` and no `?mode=` creates its Sim without a map, so the
   West Yard. It needs `map: setup?.map ?? mapForMode(undefined, this.cfg.mode)`.
2. Client (TW-VIEW):
   - `src/client/main.ts botsFor('slab')` should give `'1,1'` (2v2: `'2,2'`).
   - `src/client/ui/strings.ts MODE_NAMES` needs `slab: 'Slab'`. Until then the first-win and awards lines show the
     raw id.
3. The roster shows a human's chosen class (`room.ts sendRoster` uses `p.cls`). The entity is always Assault.
4. ARCHITECTURE.md line:
   `match/slab.ts  W13 slab: the Godot mode (hold the slab alone 1/s, first to 60 / 3:00 / overtime), Zone, kit`.

## Wave 14: respawn parity (start slots and respawn points)
`src/sim/match/slab.ts` copies Godot. Sprint speeds come from `classes.ts`: Corgi 9.6 m/s, Cat 8.8 m/s.

**Starts** follow `match.gd start_slots()` and `_sprint_time()`: equal straight-line sprint time to the slab, not
equal distance.
- Corgi slots run from the farthest spawn to the nearest.
- Cat slot k is the unused cat spawn whose sprint time is closest to the Corgis' slot k.
- Pets take slots at the match start and on a restart: humans first, then by id.

**Respawns** follow lane G-MOVE's `_pick_respawn_slots()` and `best_spawn()` (still uncommitted in the working tree).
- Every respawn point lies within 0.3 s below the Corgis' slot-0 time t0.
- Corgi points: slot 0 plus points 1.3 m apart on its straight line to the slab, while they stay in the band.
- Cat points: the cat spawns inside the band (else the one nearest its middle).
- A pet takes a point no living teammate stands on (within 1.2 m), the one farthest from the nearest living enemy.
- `slabRespawns` (order 800) places pets on their slot or point, facing the slab, with the 1 s shield.

| | Corgi | Cat | gap |
|---|---|---|---|
| Before, start and respawn (`pickSpawn`: farthest from enemies) | 143.5 m / 14.95 s | 143.5 m / 16.31 s | 1.36 s |
| After, start slot 0 | 143.5 m / 14.95 s | 132.4 m / 15.05 s | 0.09 s |
| After, start slot 1 (2v2) | 140.5 m / 14.64 s | 128.5 m / 14.60 s | 0.04 s |
| After, respawn points | 14.95 / 14.82 / 14.68 s | 14.74 / 14.79 s | ≤ 0.21 s, any pair |
| After, a lone bot respawned to the slab, measured | 15.75 s | 15.68 s | 0.07 s |

Before, in a 2v2 both pets of a team started on the same spawn. Start slots 0-5 match within 0.22 s; from slot 6 on,
the leftover spawns drift apart (0.37 s, then 1-4 s), which is more slots than this mode's teams use.

Tests: `tests/unit/slab-mode.test.ts` is now 19/19.
- `slabSim()` runs the match's first tick, so the test pets are placed after the start move.
- New: slot and respawn-point times; a 2v2 on its start slots, then all downed and back on distinct respawn points,
  every cross-team pair within 0.3 s; a respawned bot of each team reaches the slab (deterministic).
- The downed test checks Godot's farthest-from-enemy point. The rematch test checks the start slot.
- Mutation-checked: start slots off, or respawn points off, each fails tests.
