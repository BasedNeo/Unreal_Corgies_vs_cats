# G4b handoff: bots play Base Assault, and both maps work online (Wave 9, mode-1)

**Status: done for integration. Nothing is committed or staged.** The lead's X4 bot hook is in too, as a separate block (§6).

- Bots play the objective: roles per team (attack, defend, escort, carry, return, chase), a rally-then-storm attack, and
  carriers that run home through fights and never ride. The logic is a pure, deterministic module,
  `src/sim/ai/base-assault-ai.ts`. The hooks are 7 marked lines in `tactics.ts` and 7 in `brain.ts` (§2).
- **Acceptance, bot-only 4v4, 5 seeds × a 5-minute match:**

  | Map | Seeds with ≥ 1 capture | Captures (corgis : cats) | Worst stuck |
  |---|---|---|---|
  | West Yard | 5 / 5 | 15 : 3 | 3 s |
  | The Lot, HEAD's spawn-fallback bases (~260 m runs) | 5 / 5 | 9 : 5 | 3 s |
  | The Lot, L3's real `WorldData.bases` (~230 m runs, trialled from the working tree) | 5 / 5 | 8 : 7 | 3.5 s |

  Carriers never ride, and roles never flicker.
- **Online:** a room with two network clients (loopback links: 40 ± 10 ms, 1 % loss, delta snapshots, prediction) plus
  bots to 4v4 plays a full round on The Lot and on the West Yard. Both clients agree with the authority on the balls
  at every snapshot (0 mismatches in ~18,250 checks per map), on the score and winner, and on the restart.
- **Soak PASS** with base-assault in the default mode list (West Yard, 4 modes, score 96), and on The Lot (score 94).
  The `tools/soak.mjs` change is a snippet (§8).
- **Cost of the new code:** 1.7 µs/tick with 8 bots, 3.1 µs/tick with 16 (per-core load 4.1). Up to ~30 µs/tick on the
  busiest runs (load 5+ per core).
- Existing AI tests are unchanged and green: the kart-ram gate, climb, core-rush and ai budget. Two of my own G4a tests
  whose premises changed (bots now play the objective; L3 gives The Lot bases) are updated (§7.3).
- `npm run gate:fast` on the working tree: typecheck and boundaries pass. Unit: 728 passed, 2 failed, 24 files failed to
  load. None of it is mine; §5b has the breakdown.

## 1. What the bots do, and why (game-design-psychology)
Every ball state has a readable answer, a stolen ball always gets a response (comebacks), and no state is dead. Roles are
planned per team every 0.5 s, or at once when a ball changes hands or a bot respawns.

Roles are sticky: a bot keeps its role unless another bot is 25 m cheaper for that slot, so they don't flicker. The
flicker metric counts a role that flips back within 1 s with no ball event in between: it is 0 in every measured match.

| Role | Who | What it does |
|---|---|---|
| **carry** | our bot with the enemy ball | Straight home to a walkable spot inside our capture ring, and waits there. It captures the moment our own ball is home, or when the G4a stalemate relief opens. It runs through fights (a *ball run*, below), hip-fires only at what is within 55° of its route, never retreats to cover, and never boards (carriers can't mount). In the ring it holds the ring and fights from inside it. |
| **escort** | half the rest (≤ 3) when we carry and our ball is home; 1 when both balls are out | Shadows the carrier (bot or human) 3 m to its side, 1.5 m ahead, and fights from an 8 m zone around it. |
| **attack** | the rest while their ball is home | Gathers at a **rally point** 35 m short of the enemy stand (back along the route home) and fights from there. It **storms** the stand once 2 attackers are there (3 from 5 attackers), or 8 s after the first arrived. A storm lasts ≥ 8 s, then while an attacker is within 22 m of the stand. A healthy attacker (≥ 50 % hp) pushes through fights on its way (a ball run); a hurt one fights its way. A ball on the ground (our carrier fell) is rushed directly. |
| **defend** | 1 (2 from 6 bots) while both balls are home; all the rest while we carry | Guards a spot within 9 m of our stand and fights from inside that zone. |
| **return** | the nearest 2 when our ball is on the ground | Runs to it and touches it home (a ball run over the last 14 m). |
| **chase** | everyone but one attacker (or one escort) when our ball is taken | Hunts the thief. A chaser closer to the thieves' ring than the thief is cuts it off at the ring; the others run it down. Every bot also gets a +15 m perception priority on a visible carrier, so everyone focuses the carrier. |
| all-in | a team behind on captures with < 90 s left | No guard: everybody attacks (the comeback). |

The design decisions below each come from a measurement.
- **Why a rally.** The first version sent every attacker at the stand on its own. Result on the West Yard: 7–11 steals
  and 0 captures per 5 minutes. Every thief was down within 20 m of the stand, next to the enemy spawns, with no escort
  (traces: carrier alone, the nearest mate 80–140 m away). With the rally, the squad steals with its escort already
  there: 3–4 captures a match.
- **Why ball runs override every FSM mode.** The first hook only covered `engage`. A carrier that heard gunfire switched
  to `alert` and walked toward the noise. A carrier shooting ahead used ADS, which drops it to walk speed (2.7 m/s).
  Now a rushing bot steers its route in every mode but patrol (patrol already follows the goal), sprints, and doesn't
  ADS.
- **Why bots help a human only within 30 m in this mode (90 m elsewhere).** Online, a human stand-in is nearly always in
  some fight. At 90 m, every guard, rally and return nearby left its role to help (C2's `buddyInTrouble`). The Lot's
  online round went from 0:0 to 1:0 on the same seed with the smaller radius.
- **Kart rides.** A kart ride to the rally point, the stand, a far guard post, a chase or a return is taken when it beats
  walking (B2a's `considerBoarding`: 8–15 rides per match). Carriers and escorts never ride. A bot on its way to a kart
  that picks up a ball drops the ride on its next think.

Relief: carriers always head straight to their own ring, so the relief (both balls away for 60 s) resolves the standoff
by itself. It was observed working, for example West Yard seed 1 at 103 s.

## 2. The hunks (G4b; each line marked `G4b` in the source)
**`src/sim/ai/tactics.ts`.** The working tree also has L3's lane hook. My lines are separate. One exception: the `goal`
union line, where I appended `| 'ball'` to L3's `| 'lane'`.

| Line (working tree) | Hunk |
|---|---|
| 78 | `import { BALL_HELP, ballTrip, baseAssaultGoal, isCarrier, type BaBot } from './base-assault-ai';` |
| 100 | `goal: '' \| 'core' \| 'step' \| 'post' \| 'lane' \| 'ball'; // G4b: …` (on HEAD alone: `… \| 'post' \| 'ball'`) |
| 136–137 | `TacticsState.ba?: BaBot` (optional; the module creates it) |
| 441 | `buddyInTrouble`: `< (e.ai?.tac.goal === 'ball' ? BALL_HELP : 90)` in place of `< 90` |
| 499 | `updateObjectiveGoal` (L3's `objectiveGoal` body): `if (roomModeOf(sim) === 'base-assault') { baseAssaultGoal(…); return; }` right after the pve/kind check |
| 846 | `objectiveTrip`: `if (t.goal === 'ball') return ballTrip(t, trip) ? trip : null;` |
| 1312 | `vehicleThink`: `if (isCarrier(e)) { if (r.phase === 'board') endRide(sim, e, ai, 1); return false; }` after the leap line |

**`src/sim/ai/brain.ts`.** It equals HEAD plus my lines; nobody else has edited it.

| Line | Hunk |
|---|---|
| 52 | `import { CARRIER_FOCUS, ballRunIgnores } from './base-assault-ai';` |
| 231 | `perceive` score: `- (t.flags & EFlag.Carrier ? CARRIER_FOCUS : 0)` appended |
| 695–698 | Before the mode switch: `const ballRun = …; if (ballRun) { steerTo(goal…); sprint; look along the route }`, then `else switch (ai.mode) {` (the `switch` line gained `else`) |
| 705 | Patrol straight-in over the last 4.5 m: `(t.goal === 'core' \|\| t.goal === 'ball')` |
| 932 | Aim block condition: `&& !ballRunIgnores(e, ai.tac, target, mv.x, mv.z)` |
| 934 | `aiming = … && !ballRun` |
| 1109 | `holdZone`: `(t.goal !== 'step' && t.goal !== 'ball')` |

Not touched: `lanes.ts`, `nav-links.ts`, `nav.ts`, `match/base-assault.ts` (no rules change), and every path the card
lists as off-limits.

## 3. The numbers (bot-only 4v4, Room with `botsPerTeam [4,4]`, a 5-minute match, first to 3)
Commands:
- `G4B_ACCEPT=1 npx vitest run tests/unit/ai-base-assault.test.ts -t acceptance --silent=false`
- Run on a clean snapshot: HEAD `282e2ec` + my files. The Lot with real bases: HEAD + L3's in-flight world files + my files.

Legend:
- Steals are counted by the thieves' team; drops and returns by the ball's own team.
- Knockouts are shown as corgis down / cats down.
- Stuck uses the soak's rule.
- All runs in `artifacts/g4b/acceptance-*.txt`.

**West Yard.** 5/5 seeds capture. Captures 15 : 3; the cats score in 3 of the 5.

| Seed | Captures | Steals | Drops | Returns | Knockouts (c / k) | Rides | Live s | Stuck max |
|---|---|---|---|---|---|---|---|---|
| 1 | 3 / 1 | 6 / 3 | 2 / 3 | 2 / 1 | 53 (23 / 30) | 13 | 236 | 3 s (hedgehog, §7) |
| 2 | 3 / 1 | 9 / 3 | 2 / 6 | 2 / 2 | 70 (33 / 37) | 14 | 257 | 1.5 s |
| 3 | 3 / 0 | 6 / 11 | 11 / 3 | 5 / 2 | 59 (27 / 32) | 11 | 214 | 2.5 s |
| 4 | 3 / 0 | 10 / 6 | 6 / 7 | 4 / 3 | 65 (28 / 37) | 14 | 238 | 1.5 s |
| 5 | 3 / 1 | 7 / 5 | 4 / 4 | 2 / 3 | 52 (21 / 31) | 8 | 209 | 1 s |

**The Lot, HEAD (spawn-centroid fallback bases, 259/260 m runs).** 5/5 seeds capture. Captures 9 : 5.

| Seed | Captures | Steals | Drops | Returns | Knockouts (c / k) | Rides | Stuck max |
|---|---|---|---|---|---|---|---|
| 1 | 2 / 2 | 5 / 6 | 4 / 3 | 2 / 2 | 45 (23 / 22) | 14 | 3 s |
| 2 | 1 / 1 | 6 / 6 | 4 / 4 | 2 / 4 | 45 (22 / 23) | 15 | 1.5 s |
| 3 | 2 / 1 | 9 / 5 | 3 / 7 | 2 / 4 | 47 (23 / 24) | 11 | 1.5 s |
| 4 | 2 / 1 | 5 / 6 | 5 / 3 | 3 / 2 | 47 (23 / 24) | 14 | 1.5 s |
| 5 | 2 / 0 | 4 / 4 | 4 / 2 | 3 / 1 | 52 (25 / 27) | 12 | 1 s |

**The Lot with L3's `WorldData.bases`.** These are in the working tree, not yet in HEAD: flags (−36, −112) / (36, 112),
stands 8.1 m from them, 230 m runs. Measured on HEAD + L3's world files + mine. 5/5 seeds capture; captures 8 : 7. Re-run
it once L3 lands: the command above, on the tree.

| Seed | Captures | Steals | Drops | Returns | Knockouts (c / k) | Rides | Stuck max |
|---|---|---|---|---|---|---|---|
| 1 | 2 / 1 | 4 / 6 | 5 / 2 | 4 / 1 | 48 (22 / 26) | 13 | 1.5 s |
| 2 | 1 / 1 | 8 / 7 | 5 / 7 | 4 / 6 | 48 (28 / 20) | 13 | 2 s |
| 3 | 2 / 2 | 5 / 5 | 3 / 3 | 3 / 3 | 51 (30 / 21) | 12 | 3.5 s |
| 4 | 1 / 2 | 5 / 6 | 3 / 4 | 3 / 4 | 46 (25 / 21) | 14 | 1.5 s |
| 5 | 2 / 1 | 5 / 7 | 6 / 3 | 5 / 2 | 48 (24 / 24) | 15 | 2 s |

**Gate test (default suite)**, pooled per KNOWLEDGE §8: three 150 s West Yard matches.
- Requirements: ≥ 2 captures pooled, ≥ 2 of 3 matches capture, both teams steal, stuck ≤ 5 s, 0 carrier rides,
  ≤ 2 flickers per match, and the cost bound.
- Measured with G4b only: captures 2/1, 1/0 and 1/1.
- Measured with the X4 hook: 2/0, 1/0 and 2/1.
- The gate test takes 73 s at load 17.

**Cost** (`baPerf`: the goal hook, team plans included; the brain hooks are a few comparisons):
- 8 bots: 1.7 µs/tick. 16 bots: 3.1 µs/tick (per-core load 4.1).
- Busy runs reached 12–30 µs/tick (load 5+ per core). That is ≤ 2 % of the AI budget (1.5 ms).
- About 0.25 goal calls per tick with 8 bots (each bot every 0.5 s). A team plan is O(bots²) with bots ≤ 14. The rally
  point's A* runs once per team per sim.

## 4. Online (`tests/unit/ai-base-assault-online.test.ts`)
The setup:
- `LoopbackSession` with the server's frame path: JSON input frames up, delta snapshots down.
- Links: 40 ± 10 ms one way, 1 % loss.
- Two clients with prediction, one per team. Each is a stand-in: a bot brain on its authority entity writes the input
  the client sends over the wire (the soak's net-bot). The stand-ins fight but don't play the objective.
- Bots top up to 4v4 (3 objective bots per team).

The round runs `warmup 3 s → live 300 s → ended → restart`. The test checks:
- At every client snapshot, each client's ball model (`readBaseAssault`, the HUD's own reader) equals the authority's
  balls at that snapshot's tick: state and carrier.
- At the end, both clients' `match` agrees with the authority's (phase, score, winner).
- After the hold, a clean restart: 0:0, both balls home, as seen by both clients.

Results:

| Map (seed) | Result | Ball checks | Mismatches | Restart |
|---|---|---|---|---|
| The Lot (2) | 1:0 corgis after 300 s | 18,264 | 0 | clean |
| West Yard (2) | 1:0 corgis after 300 s | 18,244 | 0 | clean |
| (with the X4 hook) The Lot (2) / West Yard (2) | 1:0 / 2:0 | 18,268 / 18,243 | 0 | clean |

Captures are asserted pooled over the two rounds (≥ 1). With two combat-only stand-ins holding bot slots, single Lot
rounds are a coin flip:
- seed 1: 1:0 (measured before the help-radius change);
- seed 2: 1:0;
- seed 3: 0:0 at the horn.

The West Yard captured in every seed tried. Runtime: 85 s for both rounds at load 17. `G4B_ONLINE=the_lot:3` runs one
map and seed on its own.

## 5. Soak
`npx tsx tools/soak.mjs` with the §8 snippet (defaults now include base-assault; `--map` added). Artifacts:
`artifacts/g4b/soak.txt`, `soak-west-yard.json`, `soak-the-lot.json`. The machine load was 14.

| Map | Mode | Score (R · I · F) | Tick p95 (best of 3) | Stuck max | Result |
|---|---|---|---|---|---|
| West Yard | yard-skirmish | 95 (96 · 100 · 85) | 1.39 ms | 1.5 s | |
| West Yard | team-deathmatch | 98 (95 · 100 · 100) | 1.46 ms | 0.5 s | |
| West Yard | core-rush | 98 (95 · 100 · 100) | 1.47 ms | 1 s | |
| West Yard | base-assault | 93 (95 · 100 · 80) | 1.41 ms | 1.5 s | the horn at 45 s, 0:0; 8.2–9.7 KB/s snapshots |
| West Yard | **overall** | 96 | 1.47 ms | 1.5 s | **SOAK PASS**: 4 modes, errors 0, 4/4 completed, deterministic |
| The Lot | base-assault (`--map the_lot`) | 94 | 1.18 ms | 1 s | **SOAK PASS** |

The soak's 60 s runs end base-assault at the horn (a capture takes a squad 40–120 s). The captures are proven by §3.

## 5b. `npm run gate:fast` on the shared working tree (the other lanes' in-flight files included)
- **typecheck** ok; **boundaries** ok.
- **unit:** 728 passed, 2 failed, 4 skipped; 24 files failed to load:
  - **24 client test files fail to load** with `TypeError … reading 'color'` at `src/client/style/style-webgpu.js:62`
    (`STYLE_RIM = … STYLE.rim.color`). That is P4's in-flight readability edit, not mine.
  - `base-assault.test.ts` › the spawn fallback. It was mine, the premise L3 changed; fixed after the gate started
    (§7.3). It passes on HEAD and on the working tree.
  - L3's untracked `lot-lanes.test.ts` › "canyon and pipeworks ≥ 25 % of the Mud's". In the gate it measured 0.24 / 0.22
    with stuck max 7 s. I A/B'd it on a fresh snapshot of the working tree (KNOWLEDGE §8) and **it passes both with and
    without the X4 hook**:

    | Variant | Canyon / Mud | Pipeworks / Mud | Stuck max |
    |---|---|---|---|
    | with the X4 hook | 0.36 | 0.38 | 3.5 s |
    | without it | 0.31 | 0.34 | 3.5 s |

    So the gate's failure was an earlier state of L3's lanes work (their test output has changed since). G4b itself is
    inert in TDM: every hook keys on goal `'ball'` or `EFlag.Carrier`.
- My own suites on the working tree: `ai-base-assault*`, `base-assault*`, the ai suites and `ordnance-ai` are green. The
  kart-ram, climb and core-rush gates are unchanged.

## 6. The X4 bot hook (the lead's request; separate block, marked `W9 X4 hook`)
This is `docs/handoff/X4.md` §5.4, in `brain.ts`. Its own diff: `artifacts/g4b/x4-hook-brain.diff`.

| Line | Hunk |
|---|---|
| 53–54 | Imports: `ordnance-ai` (createOrdnanceBot, makeIntent, ordnanceBotThink, types) and `ordnanceArcWorld` from `../combat/ordnance`. The module is imported directly rather than through the combat index. |
| 117–118 | `AiState`: `ord`, `ordIntent`, `seen`. |
| 164 | `createBrain`: `ord: createOrdnanceBot(0), ordIntent: makeIntent(), seen: []`. |
| 182 | `applyArchetype`: `e.ai.ord = createOrdnanceBot(e.id)` (staggered re-plans; `ensureBrain` goes through it). |
| 215, 230 | `perceive`: `ai.seen.length = 0` before the loop; `ai.seen.push(t)` right after the line-of-sight test passes. |
| 972–982 | `think`, just before `// ---- write the input`: X4's block (the wind-up turn, the exact release, Fire/Aim cleared). It is gated to `e.kind === EntityKind.Bot` (room bots only; not player stand-ins), `!e.combat?.pve`, and room mode ≠ `adventure`. **Carriers skip it.** A carrier's wind-up is dropped (`ai.ord.phase = 'idle'`), so a carrier never stops to throw, and an old plan can't fire after a capture. |

X4 acceptance:
- **Tests:** `ordnance-ai.test.ts` passes, and so do the ai suites, base-assault, core-rush and match: 108 passed with
  both hooks, 1 G4a test updated (§7).
- **Existing gates unchanged:**
  - kart-ram: 3 ram hits over 6 seeds, rides in every match;
  - climb: N1 suite green;
  - core-rush: green;
  - the ai budget test.
- **Throws per match, 4v4, shipping config** (`artifacts/g4b/x4-throws.txt`):

  | Mode | Throws per match (seeds 1 / 2 / 3) | Blasts |
  |---|---|---|
  | team-deathmatch | 0 / 1 / 1 | 0 / 1 / 1 |
  | base-assault | 10 / 8 / 7 (0–3 per bot) | 10 / 8 / 7 |

  G4b still plays out with throws on: 3:1 in all three base-assault matches.
- **TDM is below "a handful". That is `planThrow`'s cluster gate, not the hook.** I sampled every bot at 2 Hz through
  150 s of 4v4 TDM (2,130 samples, all carrying):
  - an enemy pair within 4 m of each other existed in 4 % of samples;
  - both were perceived by the sampling bot in 4 samples;
  - they were inside the 8–22 m band in 0.

  TDM bots simply don't bunch. Base Assault's guards, rally squads and escorts do. Options for X4, whose module I did not
  touch:
  - also take a single perceived enemy in cover ("flush a camper" is in X4's own role statement);
  - or allow `clusterR` 5–6 m in TDM.

## 7. Findings for the lead and Q4
1. **West Yard fairness leans corgi** (captures 15 : 3; cat carriers dropped 25 of 28 steals vs the corgis' 23 of 38).
   The Lot is fair with the same AI (8 : 7 on L3's bases), so the bots are symmetric. Likely causes:
   - species: corgi sprint 9.6 vs cat 8.8 m/s, so carriers run 7.2 vs 6.6 m/s and chasers 9.6 vs 8.8; corgis also have
     the lower capsule;
   - West Yard FOB specifics.

   It is not spawn distance: the cat stand has a cat spawn 3 m away. Removing the hedgehogs still gave 7 : 3. This is a
   balance call (carrier speed per species, or the FOB) for Q4 and the owner.
2. **Thin E4 obstacles vs the 1 m nav grid.** Two cases:
   - The FOB hedgehog at (−24.4, −49.4) (three crossed 0.1 m beams) is blocked on the grid for one beam only.
   - A camo-net `fob_pole` (r 0.09 m) stands 2 m from the cat stand at (26.2, 66.8).

   Bots routed past them can pin themselves: 1.5–3.5 s in the runs above. In a scratch world without hedgehogs (a world
   change reshuffles everything), a carrier pressed into the pole for 7 s. The cause:
   - the pet is free (inputs move it in every direction);
   - the brain's stuck detour checks its line from 0.6 m ahead of the pet, so it can pick a target straight through the
     thin obstacle.

   Repro: `NOHOG` scratch world, seed 3, `Pup 1` at 189–197 s. Fix options (shared nav/brain code, not mine):
   - inflate cylinders and thin boxes by the capsule radius in the nav build;
   - check the detour line from the pet itself.
3. **Two of my G4a tests were updated.**
   - `base-assault-room.test.ts`: its premise "the bots don't play the objective yet (G4b)" is gone. A corgi bot made one
     of the three captures, so the human's roster credit was 24 < 30. The test now counts the human's own captures (≥ 2,
     each credited 10). The rest is unchanged: 3–0 corgis, the slow ratio, the restart.
   - `base-assault.test.ts` › the spawn fallback: it asserted "The Lot (no bases yet)". L3's in-flight `WorldData.bases`
     make that false, so the test now takes The Lot's world with `bases` removed. It passes on HEAD and on the working
     tree.
4. **No RC plane in base-assault.** `tactics.ts` `PLANE_MODES` doesn't list base-assault, so no bot pilots there. Kart
   rides do happen. Adding it is one word; I left it out, since pulling a 4v4 team's bot into the sky cost objective
   play and the card didn't ask for it.
5. **Soak intensity.** The snippet counts `captured` and `ball taken` as drama events, like `win`/`wave`.

## 8. Snippets for the lead
**`tools/soak.mjs`** (applied and run in my scratch copy; full diff `artifacts/g4b/soak-snippet.diff`):
```js
// header usage: --modes …,core-rush,base-assault · --map the_lot (default: the West Yard)
const MODES = opt('modes', 'yard-skirmish,team-deathmatch,core-rush,base-assault').split(',');
const MAP = opt('map', '');
// SOAK_CONFIG
  // G4b: a capture takes a bot squad 40-120 s on the West Yard, so a 60 s soak ends its match at the horn
  'base-assault': { baseAssault: { warmup: 3, timeLimit: 45, endedHold: 5 } },
// LINEUP
  'base-assault': [[Team.Corgis, 'infiltrator'], [Team.Corgis, 'overwatch'], [Team.Corgis, 'assault'],
    [Team.Cats, 'assault'], [Team.Cats, 'infiltrator'], [Team.Cats, 'overwatch'], [Team.Cats, 'assault']],
// drama events: … || e.reason === 'captured' || e.reason === 'ball taken'
// soakMode: const sim = await Sim.create({ seed: SEED, ...(MAP ? { map: MAP } : {}) });
// the JSON header: map: MAP || 'west_yard'
```

**`PROGRESS.md` status row** (suggested):
> **W9 G4b bots play Base Assault (mode-1)** | ✅ | Roles per team (attack with a rally-then-storm, defend, escort,
> carry, return, chase), carriers run home through fights and never ride; bot-only 4v4, 5 seeds × 5 min: West Yard 5/5
> (15:3), The Lot 5/5 (9:5 fallback bases, 8:7 on L3's bases), stuck ≤ 3.5 s; online 2 clients on both maps: full round,
> 0 ball mismatches in ~18 k checks per map; soak PASS 4 modes (96) + The Lot (94); 1.7–3.1 µs/tick (8/16 bots). X4
> bot hook wired (TDM 0–1 throws/match: planThrow's cluster gate; base-assault 7–10). docs/handoff/G4b.md, artifacts/g4b/

## 9. Files touched (exact)
| Path | What |
|---|---|
| `src/sim/ai/base-assault-ai.ts` | **New.** Roles, rally/storm, goals, `ballRunIgnores`, `ballTrip`, `isCarrier`, `BALL_HELP`, `CARRIER_FOCUS`, `baPerf`/`baRoleOf`/`baPlanCount`/`baPushCount` telemetry |
| `src/sim/ai/tactics.ts` | 7 G4b lines (§2) |
| `src/sim/ai/brain.ts` | 7 G4b hunks (§2) + the X4 block (§6) |
| `tests/unit/ai-base-assault.test.ts` | **New.** 6 role tests, 5 behaviour tests, the pooled gate, determinism; `G4B_ACCEPT=1` acceptance + cost |
| `tests/unit/ai-base-assault-online.test.ts` | **New.** Two clients, both maps |
| `tests/unit/base-assault-room.test.ts` | G4a test, premise updated (§7.3) |
| `tests/unit/base-assault.test.ts` | G4a test: the spawn-fallback case runs on The Lot without its bases (§7.3) |
| `docs/handoff/G4b.md` | This file |
| `artifacts/g4b/` | Acceptance, online, soak (txt + json), the soak and X4 diffs, X4 throw counts |
| `LEARNINGS.jsonl` | 3 lines appended (`"source": "mode-1 (W9 G4b)"`) |
