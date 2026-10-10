# W17 match depth 4, the web half: the contest stays 1 m inside the edge on the twin (lane TW-SIM)

**Result: DONE. The lead accepted the port on 2026-10-10 (rulings below).**
- **The rule is ported.** The twin's slab bots follow Godot bot.gd's numbers: `SLAB_MARGIN` 1.0 m, `EDGE_LOOK` 1.2 m and
  `CONTEST_ZONE` 6.0 m. The code is in `src/sim/ai/brain.ts`.
- **The acceptance test passes.** `tests/unit/slab-contest.test.ts` mirrors Godot's `test_bot_contest.gd`. Four unhurt
  bots stay on the slab for 20 s on seeds 1, 2 and 3: 80.0 of 80 pet-s on the slab, and 0.0 %, 0.0 % and 0.3 % of
  that time in the edge band (the limit is 5 %).
- **Every mutant fails the test.** Out of the 10 tests:
  - the margin set to 0 fails 9;
  - removing the contest step-in fails 3;
  - the on-slab mix set to the in-zone weights fails 3;
  - removing the second cut, the one after teammate separation, fails 9.
- **Balance bar: met, but close.** Pooled n 400 per format, after the change:
  - 1v1: Cat 59.5 % (base 59.8 %). The change does not move it: 86 winners moved to Cat and 87 to Corgi.
  - 2v2: Cat 58.5 % (base 49.0 %). This shift is real: 113 winners moved to Cat and 75 to Corgi, sign test
    p 0.007.
  - Neither side is over 60 %. But the twin's 1v1 already leaned 60 % Cat before this card, and the change adds
    9.5 points of Cat lean to the 2v2 (see Balance).
- **What did not change:** speeds, `PERF_HOST_FACTOR`, `stepCharacter`, roles (every twin bot still HOLDs) and every
  mode other than slab.
- **PARITY B1 / G15 can close for the edge band.** The lead owns PARITY.md.
- **B2 (roles) is a Godot DEFECT owned by lane G-BAL.** The 2v2 roles stay nominal in Godot. The twin's bots all HOLD
  until G-BAL lands.
- **The balance harness is now a tool:** `tools/slab-balance.ts` (see Balance).

## Lead rulings (2026-10-10)
1. **The port is accepted; Godot wins.**
   - The 2v2 shift to 58.5 % Cat matches Godot's 2v2 (about 58 %) and stays under 60 %.
   - Lane G-BAL is root-causing the underlying Cat advantage in Godot. Its fix will be mirrored to the twin later.
   - No n 800 hunt for the cause now.
2. **LOGGED, ALLOWED DIFF until G-BAL lands: the clash beyond the contest zone.**
   - **Where:** farther than 6 m off the square but within 18 m of the slab's centre.
   - **The twin:** an engaged bot keeps the W13 `holdZone` straight pull, straight at the centre with no strafe.
   - **Godot:** its far branch, a 0.8 strafe and a 0.6 back-off inside 7 m.
   - **Why the diff stays:** porting the far branch too (variant P2) pushed the 1v1 to **65.0 % Cat** at n 200
     (70-130; paired 58 to Cat and 40 to Corgi, sign test p 0.085). Its 2v2 read 50.5 % (99-101).
   - **When to revisit:** with G-BAL's fix.
3. **Fresh check: PASS** (a separate verifier, 2026-10-10). Every number in the tables above reproduced, and other
   modes stay hash-identical to HEAD tick by tick. Its own paired 2v2 sample, seeds 1-40, read 19 Cat to 21 Corgi at
   both HEAD and this port (9 winners flipped each way), so that sub-sample shows no Cat shift. That does not refute
   the n 400 result above: 9 or fewer of 18 flips going to Cat happens 26 % of the time at the claimed rate. The two
   mutants it found surviving (the on-slab mix and the second cut) are now pinned; the lead re-ran both and each fails.

## What HEAD did (7a671f1)
- **On the slab:** HEAD used `holdZone`'s circle. In a fight it dropped the part of the wish that pointed out, past
  1.6 m from the centre. Past 3-3.8 m it pulled the bot straight back in.
- **The circle crosses the edge band.** The band starts 3 m from the centre on each axis, so the circle reaches into it.
- **In the contest:** an engaged bot within 18 m of the centre ran straight at the centre, with no strafe. Farther
  out, the W13 advance applied: the path, a 0.8 strafe, and a back-off inside 7 m.
- **No margin and no test.** HEAD had no square margin and no test of it (PARITY G15).
- **HEAD already met the 5 % in Godot's scenario.** HEAD's code passes case 1 of the new test (0.5 / 1.4 / 1.7 %).
  It fails case 2 on seed 2 only: the straight pull aims at the centre, not at the bot's spot (30.7 deg). So this card
  mainly changes the rule the twin follows. It does not fix a measured edge-band failure.

## The port (`src/sim/ai/brain.ts`)
| Godot bot.gd | Web | What it does |
|---|---|---|
| `SLAB_MARGIN`, `EDGE_LOOK`, `CONTEST_ZONE` | the same names, exported; the test reads bot.gd and checks they are equal | 1.0, 1.2, 6.0 |
| `_hold_inside()` | `holdInside()` | Per axis, the part of the wish that would carry the bot past the inner square (half-size minus 1 m) within 1.2 m is cut back to reach it. A bot already past it is turned back in. When the cut leaves less than half of the wish, the strafe turns round (new strafe timer 0.5-1.3 s). |
| `_steer()`: `on_slab` then `_hold_inside` | `holdSlab()` on the slab, in every mode (it replaces `holdZone`'s circle there) | It runs once before stuck detection, so a bot held at the line does not count as stuck. It runs again after teammate separation and any detour, so nothing pushes the bot past the line. |
| `_steer()` on the slab: `dir * 0.7 + side * 0.8`, no back-off | think's engage, on the slab | The bot heads straight at its spot (no path) at 0.7, plus a 0.8 strafe. It never backs off. |
| `_steer()` `elif contest` (`_off_square() <= CONTEST_ZONE`): `dir + side * 0.4`, no back-off | think's engage, off the slab within 6 m of the square (`offSquare()` = Godot `_off_square`) | It steps in along the nav path with a 0.4 strafe and no back-off. Here `holdSlab` does not pull it straight in. |
| none: Godot strafes into whatever is beside it | `slabStrafe()`: `openAhead` drops a strafe that would run into a wall within about 1 m | **Allowed web-only DIFF.** It is carried over from W13's slab advance, which made the same check. Godot has no such check. Well inside the slab it never dropped a strafe in the test: there, the wish matched Godot's mix on every checked tick. |
| `_steer()` far: `dir + side * 0.8`, back off `0.6` inside `ai_range[0]` 7 m | unchanged W13 web advance | Inside 18 m of the centre, `holdZone`'s W13 straight pull still overrides it. This is a **logged, allowed diff until G-BAL lands** (lead ruling 2). Porting it, as variant P2, took 1v1 to 65.0 % Cat. |
| bot.gd has no alert, cover or regroup mode: it hears only to aim | `holdSlab`: on the slab, a bot in alert, cover or regroup walks to its own slab spot, not to the noise, the cover or a teammate | Without this, an alerted bot walked out to the line and stood at 3.000x m. That counted as edge band: 11.5 s in one match (1v1 seed 132, an earlier build of this port). |

- **Roles:** the twin's bots all HOLD, as before.
- **Unchanged:** speeds, sprint rules and `stepCharacter`.
- **Holding the line is not slowing down.** The cut only shortens a wish that would cross the inner square, as
  Godot's does. Holding a bot back from the inner square also stops its sprint there. A twin bot only sprints on the
  slab in alert, cover or regroup toward something far away, and Godot always runs on the slab.
- **Other modes are unchanged.**
  - The new branches run only for a bot whose tactics hold the slab (`tac.advance`, which only `slabGoal` sets).
  - No new random number is drawn outside slab.
  - A position hash of five other modes is identical before and after (Proof).

## Acceptance test (`tests/unit/slab-contest.test.ts`, 10 tests)
1. **Godot's scenario** (`test_bot_contest.gd`):
   - A bots-only 2v2 `Room` on The Lot. The four bots start at Godot's `PLACES`: Corgis at (+-2, -2.5), Cats at
     (+-2, 2.5), each facing the centre with a fresh brain.
   - Everyone is unhurt: `invulnUntil` is set every tick, the field the spawn shield uses, as Godot's `shield = 1.0`.
   - The match never ends: `winScore` and `timeLimit` are set to 1e9.
   - The run lasts 20 s (1200 ticks). Pass: on the slab at least 76 of 80 pet-s, and at most 5 % of that time in the
     1 m band.
2. **The step-in** (the web's own case):
   - The Cats start 4 m off their edge, inside the 6 m zone, and the Corgis stand on the slab.
   - Every tick a Cat fights from the zone (off the slab, enemy in sight), its wish must be within asin(0.4) + 1 deg of
     its way in (its nav path's corner).
   - Each Cat must be on the slab within 1.5 s, and case 1's budgets must hold.
   - **Why this case exists:** in case 1 the cut keeps every bot on the slab, so no bot is ever in the zone. Case 1
     alone passes both step-in mutants below.
3. **The crowd** (the patch round): both Corgis start on their inner line, 0.35 m apart along z, so teammate
   separation pushes the outer one out. At least 10 ticks must have that push, and case 1's budgets must hold.
4. **Two checks on every tick of every case**, read from the input the bot sent:
   - **The final cut.** A bot inside the inner square never sends a wish that would carry it past that square within
     1.2 m, to the float (1e-9 m). That includes what teammate separation adds after the first cut.
   - **Godot's on-slab mix,** asserted in case 1. On every tick a bot fights well inside the inner square (no cut can
     apply) with no teammate in separation range, its wish is normalize(0.7 * to its spot + 0.8 * strafe), within
     1 deg. Case 1 checks 2183-2520 such ticks per seed, and the worst miss is 0.00 deg.
5. **The numbers are Godot's.** The test reads `engines/godot/game/bot.gd` and compares the three constants.

Seeds 1, 2, 3, fixed, on the sim's seeded RNG. The file runs in about 10 s.

| Case | Seed | On the slab | Edge band | First on (s) | Step-in ticks checked, worst angle |
|---|---|---|---|---|---|
| 1 Godot's | 1 | 80.0 / 80 pet-s | 0.00 pet-s, 0.0 % | 0.02 x4 | - |
| 1 Godot's | 2 | 80.0 | 0.00, 0.0 % | 0.02 x4 | - |
| 1 Godot's | 3 | 80.0 | 0.22, 0.3 % | 0.02 x4 | - |
| 2 step-in | 1 | 78.7 | 0.32, 0.4 % | Cats 0.67 / 0.70 | 82, 22.9 deg (max 24.6) |
| 2 step-in | 2 | 78.7 | 0.52, 0.7 % | 0.68 / 0.67 | 81, 23.6 deg |
| 2 step-in | 3 | 78.7 | 0.30, 0.4 % | 0.67 / 0.67 | 80, 23.6 deg |
| 3 crowd | 1 | 80.0 | 0.07, 0.1 % | 0.02 x4 | separation at the line on 216 ticks |
| 3 crowd | 2 | 80.0 | 0.00, 0.0 % | 0.02 x4 | 76 ticks |
| 3 crowd | 3 | 80.0 | 0.18, 0.2 % | 0.02 x4 | 86 ticks |

The final cut's worst overshoot is 0.0000 m on all 9 runs, over 4688-4800 ticks per run.

Godot's own run of this scenario (PARITY.md, w17): 0.8 % band, 80.0 pet-s.

## Mutants (each in the private copy, then restored; `brain.ts` was byte-compared back)
| Mutant | Result | What fails |
|---|---|---|
| `SLAB_MARGIN = 0` | **FAIL**, 9 of 10 | the constants test; case 1 seeds 1 and 2, at 13.3 % and 11.0 % band (seed 3 passes at 4.1 %); case 2, all three seeds at 10.6-11.7 %; case 3, seeds 2 and 3 at 13.5 % and 5.8 %, and seed 1 never crowds the line |
| **contest step-in removed** (the `offSquare() <= CONTEST_ZONE` branch deleted, so the zone takes the far rule: 0.8 strafe and the back-off; Godot's `elif contest:` deleted) | **FAIL**, 3 of 10 | case 2: the worst angle is 64.1 / 76.4 / 71.1 deg (max 24.6) |
| W13 revert near the slab (the step-in removed and the back-off put back on the slab, as Godot's W13 `_steer`) | **FAIL**, 6 of 10 | case 1, the on-slab mix: 36.9 deg off on every seed (max 1); case 2: 68.7 / 76.4 / 71.1 deg |
| **on-slab mix set to the in-zone weights** (`slabStrafe(…, 1, 0.4)` in place of `0.7, 0.8`) | **FAIL**, 3 of 10 | case 1, the on-slab mix: `expected 179.88648572634526 to be less than or equal to 1` (seed 1; seeds 2 and 3 read 179.1 and 180.0 deg) |
| **second cut removed** (the `holdInside(…, false)` after teammate separation deleted) | **FAIL**, 9 of 10 | the final cut overshoots in every case, e.g. `expected 0.3965763632688204 to be less than or equal to 1e-9` (case 3 seed 1, in m). Case 1 reads 0.15-0.20 m, case 2 0.02-0.57 m, case 3 0.25-0.40 m |
| no `holdInside` at all | **FAIL**, 9 of 10 | all three cases: 71.2-75.8 pet-s on the slab (min 76), or 13.1 % band, or 31.1 deg |
| `CONTEST_ZONE = 0` | **FAIL**, 2 of 10 | the constants test, and case 2 seed 2 at 30.7 deg. With no zone, `holdSlab`'s W13 straight pull takes over, and it steps in too (no strafe, no back-off), aimed at the centre rather than the spot. |

The two mutants in bold type in the middle of the table (the mix and the second cut) survived the first version of
the test (7 tests). The fresh verifier found them, and cases 3 and 4 were added to pin them.

## Balance (bots-only, the TS authority, no browser)
**Harness: `tools/slab-balance.ts`.**
- **Why a new tool:** before this card, no file under `tests/unit` or `tools` measured a slab win share. W13
  G-BOT's web numbers (`docs/handoff/G-BOT.md` §7, seeds 1-10) came from a scratch script, and this tool grew out of
  it.
- **What one match is:** `new Room(sim, { mode: 'slab', botsPerTeam: [k, k] })` on The Lot, with one
  `Sim.create({ seed })` per match, ticked until the match ends. It uses the real rules and the real bots.
- **What it records:**
  - downs, read from entity state, because the Room drains the events;
  - slab time and edge-band time, per team.
- **It is deterministic:** seed k replays the same match in any process. So base and after are paired on the same
  seeds, and when a winner changes, the change did it.
- **Its output:**
  - a summary: wins, Cat share, 95 % Wilson CI, binomial p against an even split, points, downs, edge band;
  - `--out` writes one JSON line per match;
  - `--compare` prints the paired result: winners changed to Cat and to Corgi, a sign test, and Fisher's p.
- **The tables below came from the tool's scratch version,** which has the same per-match code. The committed tool
  reproduces its per-seed results exactly. I checked 1v1 seeds 1-4 and 2v2 seeds 1-3 in both builds.

To rerun a table, run this in a copy of each build. The two copies differ only in `brain.ts`. The command splits the
seeds over 4 processes; seeds are 1-400 for each format:
```
for s in 1 101 201 301; do nice -n 10 npx tsx tools/slab-balance.ts --format 2v2 --n 100 --seed $s --out base.jsonl --quiet & done; wait
# the same in the other copy, with --out after.jsonl; then, from either copy:
npx tsx tools/slab-balance.ts --compare base.jsonl after.jsonl
```

Seeds 1-400 in each format: n 400 per build per format. A match takes about 7 s of CPU. The runs used `nice -n 10`
on a shared box on 2026-10-10, with up to 8 scratch processes at once.

### Before and after, n 400 per format (seeds 1-400 each, paired)
- **Held:** points scored, Corgi-Cat.
- **Edge band:** the share of slab time, during matches, spent in the outer 1 m.
- **Paired:** the same seed played in both builds. "Changed" counts the seeds whose winner differs, split by the side
  that gained it.

| Format | Build | Corgi | Cat | Draws | Cat share (95 % Wilson CI) | p vs even | Held | Downed, Corgi-Cat | Edge band | Mean length |
|---|---|---|---|---|---|---|---|---|---|---|
| 1v1 | base (HEAD 7a671f1) | 161 | 239 | 0 | 59.8 % (55-64 %) | < 0.001 | 17627-20456 | 1226-1100 | 0.87 % | 121.9 s |
| 1v1 | **after** | 162 | 238 | 0 | **59.5 % (55-64 %)** | < 0.001 | 18172-20416 | 1215-1122 | 0.87 % | 123.1 s |
| 2v2 | base (HEAD 7a671f1) | 204 | 196 | 0 | 49.0 % (44-54 %) | 0.73 | 18200-18326 | 2815-3034 | 1.44 % | 120.4 s |
| 2v2 | **after** | 166 | 234 | 0 | **58.5 % (54-63 %)** | 0.001 | 17169-19573 | 2887-2859 | 1.45 % | 120.4 s |

- **1v1, paired:** 173 winners changed, 86 to Cat and 87 to Corgi (sign test p 1.0).
- **2v2, paired:** 188 winners changed, 113 to Cat and 75 to Corgi (sign test p 0.007; Fisher p 0.009).

| Format | Seeds | Base | After |
|---|---|---|---|
| 1v1 | 1-200 | 88-112 (56.0 %) | 82-118 (59.0 %) |
| 1v1 | 201-400 | 73-127 (63.5 %) | 80-120 (60.0 %) |
| 2v2 | 1-200 | 95-105 (52.5 %) | 80-120 (60.0 %) |
| 2v2 | 201-400 | 109-91 (45.5 %) | 86-114 (57.0 %) |

### Variants measured on the way (n 200, seeds 1-200, paired with the base)
| Variant | 1v1 Cat share | 2v2 Cat share | 2v2 paired: to Cat / to Corgi |
|---|---|---|---|
| base (HEAD) | 56.0 % (88-112) | 52.5 % (95-105) | - |
| **after** (this card) | 59.0 % (82-118) | 60.0 % (80-120) | 54 / 39 (p 0.15) |
| P2: after + Godot's far branch inside 18 m (a 0.8 strafe with back-off, in place of the W13 straight pull) | **65.0 %** (70-130; paired 58 / 40, p 0.085) | 50.5 % (99-101) | 54 / 58 |
| D: after with the step-in removed (`CONTEST_ZONE` 0: the W13 pull in the zone) | - | 52.5 % (95-105) | 40 / 40 |
| E: after with the cut removed (the W13 circle on the slab) | - | 50.0 % (100-100) | 42 / 47 |
| B: after with the W13 band fight kept on the slab (no back-off), not Godot's 0.7 / 0.8 mix | - | 58.5 % (83-117) | 54 / 42 |
| C: after without the spot-hold for alert / cover / regroup | - | 58.0 % (84-116) (edge band 2.83 %) | 50 / 39 |

**What it shows.**
- **1v1 leaned Cat before this card.** HEAD's 1v1 is 59.8 % Cat at n 400 (p < 0.001 against an even split). The
  change leaves it where it was: 59.5 %, and the paired winners moved 86 to Cat and 87 to Corgi.
  - The twin uses Godot's Cat slots (`CAT_OFFSET` 0.6 s, matched on Godot's bot trips). bot-route.md warned that the
    web bots' trips differ and the web would need its own measurement. Godot's 1v1 is 41-39 or 42-38.
- **2v2 moved 9.5 points toward the Cats, and it is significant.** It went from 49.0 % to 58.5 % (sign test
  p 0.007). The shift shows in both seed halves (+7.5 and +11.5 points).
  - It stays under the 60 % bar: 58.5 %, with a CI of 54-63 %.
  - It lands where Godot's 2v2 is: 58 % on the same day (`docs/qa/w17/BOT-ROLES.md`, "this code"), 57 % in W15.
- **No single part of the change explains the 2v2 shift at n 200.**
  - With the step-in removed (D) the 2v2 reads 52.5 %, and with the cut removed (E) it reads 50.0 %. Both
    together read 60.0 %.
  - Keeping the W13 band fight on the slab (B) or dropping the spot-hold (C) does not undo it (58.5 %, 58.0 %).
  - At n 200 the paired shifts have about +-5 points of noise, so I cannot say which rule carries it. It may need
    both.
- **Why the twin keeps its W13 pull beyond the zone (P2).** Porting Godot's far branch too balanced the 2v2
  (50.5 %) but pushed the 1v1 to 65.0 % Cat at n 200. That is over the bar. So the W13 straight pull stays between
  6 m off the square and 18 m from the centre. This is the one part of Godot's `_steer` the twin does not follow. The
  lead logged it as an allowed diff until G-BAL lands (ruling 2).
- **Edge band in real matches:** 0.87 % (1v1) and 1.45 % (2v2) of slab time, the same as HEAD (0.87 %, 1.44 %).
  - Most of what is left is the walk across the band when a bot steps on.
  - Without the spot-hold (variant C), alerted and hurt bots stood at the line and the 2v2 band rose to 2.83 %.

## Proof
| Command (in the private copy) | Result |
|---|---|
| `npx tsc --noEmit` (tsconfig includes `tools/*.ts`, so it checks `tools/slab-balance.ts` too) | exit 0 |
| `node tools/check-boundaries.mjs` | `BOUNDARIES: PASS` |
| `tools/slab-balance.ts` against the scratch harness: 1v1 seeds 1-4 and 2v2 seeds 1-3, in both builds | The same winner, score, length, downs and edge band on every seed. |
| `tools/slab-balance.ts --compare`, fed the n 400 results | It prints the table above: 1v1 86 / 87, sign p 1.000; 2v2 113 / 75, sign p 0.007, Fisher p 0.009. |
| `npx vitest run tests/unit/slab-contest.test.ts tests/unit/slab-mode.test.ts` (after the patch round) | 2 files, 38 / 38 (slab-contest 10, slab-mode 28) |
| full `npx vitest run` (before the patch round, on the 7-test version of slab-contest), started once the 5-min load was under 8 (7.95 at the start, 12-13 during the run with its own workers; 17:18-17:43 UTC) | **154 / 154 files, 1348 passed, 4 skipped, exit 0** (1502 s) |
| an earlier full run at load 18-27 | 1343 passed and 5 failed, all for load: 4 time-outs (boss, lot-lanes, ordnance-perf, ui-awards-room) and ai.test's p95 budget. None of them runs slab. Rerun at load ~10, those 5 files passed (13 / 13 and 23 / 23), and the boss trace was unchanged ("defeated at 318.1 s"). |
| `modes-hash.ts` (scratch): a bots-only room per mode for 3600 ticks, every entity's position hashed every tick, HEAD against after | The hashes are identical for team-deathmatch (The Lot, West Yard), core-rush, base-assault and yard-skirmish. Only slab differs. |
| mutants (table above) | 7 of 7 fail the test |
| balance (above) | 1v1 59.5 %, 2v2 58.5 % Cat at n 400: neither side over 60 % |

## Open
1. **The allowed diff beyond the zone (ruling 2):** revisit it when G-BAL's fix lands.
   - Re-measure P2, the twin with Godot's far branch, against the fixed twin.
   - Use `tools/slab-balance.ts --compare`.
2. **The twin's 1v1 leans Cat at HEAD:** 59.8 % at n 400, p < 0.001.
   - Lane G-BAL is root-causing the Cat advantage in Godot.
   - Next TW-SIM card: measure the web bots' own spawn-to-slab trips per team, as `docs/qa/w15/bot-route.md` asks.
     Report whether the twin's Cats arrive more than 0.5 s early. Measure and propose only; the slots stay as they
     are.
3. **The 2v2 shift** (+9.5 points, p 0.007): accepted by the lead (ruling 1). Its cause is not separated: D and E
   each read balanced at n 200.
4. **PARITY (lead):** B1 can read MATCH, with web proof `slab-contest.test.ts`.
   - Close G15 for the edge band.
   - B2 (roles) is a Godot DEFECT owned by G-BAL: the 2v2 roles stay nominal in Godot. The twin's bots all HOLD
     until G-BAL lands.
   - Log the diff beyond the contest zone (ruling 2).
