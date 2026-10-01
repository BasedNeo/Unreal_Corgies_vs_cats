# G-BOT handoff: balance harness, bot travel gait, ledge jump (Wave 13)

**Status: done for integration; nothing staged or committed.** A headless harness plays whole bots-only matches with
the real rules and prints win counts. The Cat lean was a 2v2 effect of trip time: bots only ran, the Cat runs faster
(6.6 vs 6.4 m/s), and the Corgi route out of the pit is rougher. In 2v2 the side whose respawns get back to the slab
first wins the next fight. The one change: **bots sprint on the way to the slab**, as players and the web bots do,
and the Corgi's faster sprint (9.6 vs 8.8 m/s) evens the trip. Separately, the bot's ledge jump goes from 0.3 m to
0.45 m (the step-up height).

## 1. Files
| Path | What |
|---|---|
| `engines/godot/game/bot.gd` | W14: `_hold_inside()`, `SLAB_MARGIN`, `EDGE_LOOK`, `CONTEST_ZONE` (§11). W13: `_gait()`: sprint while off the slab, nobody seen or heard, goal more than `SPRINT_MIN` 12 m away (the web bot's 12 m, `src/sim/ai/brain.ts`); run otherwise. `LEDGE_JUMP` 0.45 (was 0.3 inline). `ledge_jump` and `jumps` vars for the harness. |
| `engines/godot/tests/balance.gd` | The harness (`--script`, not in `tests/run.gd`). |
| `engines/godot/tests/test_game_balance.gd` | Smoke check, about 10 s: ledge jump not below the step-up; both bots leave their spawn at their sprint speed; a bot with an enemy in sight runs; a bot on the slab is held 1 m inside its edges (W14). |

| `engines/godot/game/match.gd` | Follow-up, at the lead's request: `start_slots(team)` and `_sprint_time()`. The match-start slots are matched on straight-line sprint time to the slab (§10). Nothing else; A-HOOK's `slab_point` is kept. |

`tuning.gd` is unchanged. Nothing in pet.gd, player.gd, pet_model.gd or look/ was touched.

## 2. The harness
`godot --headless --path engines/godot --script res://tests/balance.gd -- --format 1v1|2v2 --n N --seed S [--speed K] [--events]`

- It boots `main.tscn` bots-only (`--bots-only`, or with `--2v2`), waits for the nav map, and plays N matches in a row
  through `start_match()` (the R rematch path) with the match's own rules: first to 60, else the leader at 3:00,
  overtime up to 60 s.
- Match i uses seed S + i for the global RNG (spawn jitter) and for each bot's and rifle's RNG. It also resets the
  bots' think state, so a seed replays the same match.
- `--speed K`: K x 60 physics ticks per real second and `Engine.time_scale` K, so every tick still steps 1/60 s (the
  soak's method). The run goes as fast as the CPU allows, up to K.
- Per match it prints: format, seed, winner, score, takedowns per side, seconds each side had a pet on the slab, seconds
  each side held it alone (scored), contested seconds, shots, hits and hit rate per side, first arrival on the slab per
  side, mean spawn-to-slab time per life, deaths before reaching the slab, and kills made from the slab. Then a summary
  with the 95 % Wilson interval of the Cat win share.
- `--routes`: pathing only, no fight. Each side's bot walks alone from each of its 16 spawns.
- `--ttk M`: lethality. The Cat bot on the slab against you (the Corgi) M m away (the `--lineup` spot).
- `--jump-up H`: override the ledge jump for an A/B.

**The time scale does not change outcomes.** Seeds 1-3 of 1v1 at x1 (real time, 401 s game in 414 s real) and at
x30 gave the same per-event log: every takedown at the same game time, same killer, victim and distance (to 0.1 m),
same scores, shots and hits (`diff` of the two outputs is empty). Seed 1 at x8 equals x30 as well. Under this
container's load (load average 15-27 on 4 cores, other lanes running) x30 ran at x6-x14: 20 1v1 matches in about
200 s, 20 2v2 matches in about 440 s.

## 3. Results
Current working tree (G-MOVE's step-up, 52 deg and the slab path included). The "after" rows change only the gait:
they ran with `--jump-up 0.3`, so the ledge jump stays at the baseline value. The spawn rows add the
match.gd start slots on the shipped bot, with the ledge jump at 0.45 (§10). The equal-distance rows were the first
try, and the code no longer does that; the equal-time rows are the shipped match.gd. Margin = Corgi score minus Cat score.

| Format | Build | n | Corgi wins | Cat wins | Draws | Cat share (95 % CI) | Mean margin |
|---|---|---|---|---|---|---|---|
| 1v1 | baseline (run only) | 40 | 19 | 21 | 0 | 52 % (37-67 %) | -2.4 |
| 1v1 | bots sprint | 40 | 20 | 20 | 0 | 50 % (35-65 %) | +1.0 |
| 1v1 | equal-distance spawns | 40 | 20 | 20 | 0 | 50 % (35-65 %) | +2.5 |
| 1v1 | **equal-time spawns** | 40 | 16 | 24 | 0 | 60 % (45-74 %) | -1.1 |
| 2v2 | baseline (run only) | 60 | 22 | 38 | 0 | **63 % (51-74 %)** | -7.2 |
| 2v2 | bots sprint | 60 | 35 | 25 | 0 | 42 % (30-54 %) | +1.1 |
| 2v2 | equal-distance spawns | 60 | 40 | 20 | 0 | **33 % (23-46 %)**: Corgi 67 % | +6.9 |
| 2v2 | **equal-time spawns** | 60 | 27 | 33 | 0 | 55 % (42-67 %) | -1.3 |

Seeds 1-40 (1v1) and 1-60 (2v2), the same seeds for every build. At n 40 the 2v2 rows were 14-26 (Cat 65 %,
50-78 %) and 24-16 (Cat 40 %, 26-55 %); 2v2 was borderline, so I added seeds 41-60 to both. With sprint (row 2) the
Corgi side wins 58 % of 2v2 (46-70 %). That is a coin flip at this n: the held time per side is 50.0 % and the mean
margin is +1.1 points.

Per side, Corgi-Cat, all matches of each row:

| Format | Build | Held (s) | Takedowns | Hit rate | Spawn-to-slab (s) | Died before the slab | Kills from the slab |
|---|---|---|---|---|---|---|---|
| 1v1 | baseline | 2064-2206 | 97-100 | 28-29 % | 22.8-20.9 | 36-15 | 12-25 |
| 1v1 | sprint | 2282-2257 | 137-138 | 30-31 % | 16.6-17.0 | 38-23 | 21-34 |
| 1v1 | equal-distance spawns | 2329-2227 | 139-138 | 34-35 % | 16.2-17.3 | 11-32 | 27-10 |
| 1v1 | equal-time spawns | 2222-2263 (50 % Cat) | 131-141 | 31-33 % | 16.4-17.2 | 22-23 | 21-16 |
| 2v2 | baseline | 2949-3452 (54 % Cat) | 377-399 | 27-29 % | 22.9-21.3 | 149-56 | 40-124 |
| 2v2 | sprint | 3467-3458 (50 % Cat) | 570-556 | 28-32 % | 16.8-17.2 | 154-160 | 117-116 |
| 2v2 | equal-distance spawns | 3560-3151 (47 % Cat) | 571-536 | 31-33 % | 16.5-17.6 | 97-233 | 192-75 |
| 2v2 | equal-time spawns | 3351-3447 (51 % Cat) | 545-548 | 28-32 % | 16.8-17.2 | 140-153 | 101-105 |

- **Held:** seconds a side was alone on the slab (it scores). The slab is almost never contested (0-2 s per match):
  fights end before the arriving side steps on.
- **Spawn-to-slab:** the mean time per life from respawn to the slab, per 20-seed run (the runs agree within 0.3 s).
- **Died before the slab:** deaths in a life that never reached the slab.
- **Kills from the slab:** the killer on the slab, the victim off it (the holder's kills).

In baseline 2v2 the Corgis died on the way in 149 times against the Cats' 56, and the Cats made 124 of the 164
kills from the slab. After the change those are 154-160 and 117-116. With sprint, fights come about every 20 s instead of
25 s, so takedowns go up 40-45 %; matches are 5-10 s longer.

## 4. Diagnosis
- **Hit rate: no species effect.** Corgi shooters hit 28 %, Cat shooters 29 % (1v1 baseline, n 40). The Cat's
  capsule is slimmer (r 0.33 vs 0.36) but taller (1.26 vs 1.2 m). Its hitbox (r + 0.04, h + 0.08) shows 0.99 m²
  against the Corgi's 1.02 m², 3 % less.
- **Aim and reaction:** the same code and numbers for both sides (bot.gd). Kill distances are 10-12 m for both.
- **Spawn shield:** 1 s, at spawns 119-143 m from the slab. No fight happens that early.
- **Trip time: the cause.** From the spawns `best_spawn` picks (the corner farthest from the enemy, 143.5 m for
  both), a running Cat bot reached the slab in 20.8-21.4 s and a Corgi bot in 22.7-22.9 s. That is 1.5-1.8 s, about
  8 %. Of that, 0.7 s is the Cat's run speed (6.6 vs 6.4 m/s). The rest is the Corgi route: up out of the pit and
  through the two trench notches.
- **Why it decides 2v2 and not 1v1.** Fights at the slab come in waves about 25 s apart: respawn 3 s plus the trip.
  After a fight, the losers' respawns and the winners' own dead respawn at about the same time. In 2v2 the faster side
  is reinforced first. When the Cats won a wave, their dead rejoined the holder before the Corgis arrived. When the
  Corgis won, the two Cats got back before the dead Corgi did and caught a lone holder 2v1. In 1v1 there is no
  reinforcement: every wave is one duel, and the result there was even before the change.
- **Match start (not a bot issue, see §9).** The Cat reached the slab first in **199 of 200** matches, before and
  after the change. match.gd starts each team at `spawns[team][0]`. For the Corgis that is the far corner, 143.5 m;
  for the Cats it is the near corner, 119.0 m.
- **The fix.** The species trade speed by design (classes.ts: the Corgi is the "fast sprinter", the Cat runs a little
  faster and jumps higher). The Godot bot only ever ran. The web bot sprints while more than 12 m of path is left.
  With sprint, the trip in the matches is 16.6-16.9 s for the Corgis and 17.0-17.3 s for the Cats. Alone, with no
  fight (§5), a Corgi sprints from its 16 spawns in 13.9 s on average and a Cat from its 16 in 15.3 s. So the Corgis
  now have the slightly faster trip. That fits the 58 % Corgi share in 2v2, whose interval includes 50 %.

## 5. Ledge jump 0.3 → 0.45 m (on its own)
`--routes`, the final gait, only `--jump-up` differs. Each side's bot walks alone from each of its team's 16 spawns.

| Ledge jump | Reached | Mean (Corgi / Cat) | Slowest (Corgi / Cat) | Jumps (Corgi / Cat) | Longest stall |
|---|---|---|---|---|---|
| 0.30 m | 32/32 | 13.9 / 15.3 s | 14.98 / 16.60 s | 143 / 15 | 0.02 s |
| 0.45 m | 32/32 | 13.9 / 15.3 s | 15.00 / 16.45 s | 116 / 9 | 0.02 s |

Pathing is not hurt: same times to 0.02 s, no stall, and 19-40 % fewer jumps. No route used a step-up (`steps`
stayed 0). Corgi bots still jump about 7 times per route: the nav corners on the pit ramp and in the trench notches
are more than 0.45 m above the feet within 2.5 m, which is a slope, not a ledge (§9).

## 6. The human case: lethality
`--ttk 15 --n 10`: the Cat bot (thinking, on the slab) against you, a Corgi, on open ground 15 m away. "Still" means no
input. "Strafing" means A/D, switching every 0.5-1.0 s, a mean of 5.7 m/s.

| Build | You | Kills | Time to kill (from exposure, incl. 0.4-0.7 s reaction) | From its first shot | Bot hit rate |
|---|---|---|---|---|---|
| baseline | still | 10/10 | 3.3 s | 2.8 s | 34 % (73/212) |
| baseline | strafing | 10/10 | 3.3 s | 2.8 s | 34 % (74/217) |
| sprint | still | 10/10 | 3.3 s | 2.8 s | 34 % (73/212) |
| sprint | strafing | 10/10 | 3.3 s | 2.8 s | 34 % (74/217) |

- **My change does not touch lethality.** A bot sprints only with nobody in sight or heard and away from the slab. At
  a fight it runs, with the same spread as before. The runs are identical shot for shot.
- **Strafing does not help against it.** Its aim turns at 5 rad/s, and a strafe at 15 m moves the chest by 0.4 rad/s.
  It has hitscan and needs no lead.
- **For comparison, aimed human fire is much tighter.** The bot's cone has a half-angle of 1.2 deg hip spread (x 1.5
  while moving), plus 2 deg aim error, plus bloom: a radius of 1.0-1.4 m at 15 m. A human aiming down sights has
  0.35 deg (9 cm at 15 m) plus recoil, and needs 8 body hits (120 HP / 15): 0.8 s at 10 rounds a second if every
  shot lands. At 1 FPS (Q6) nobody can track a target inside the bot's 3.3 s. Not measured with a human.
- **What the change does do to a human:** the Cat bot now gets to the slab sooner. From the Cats' start slot
  (119 m) it takes about 14.5 s, against 19.3 s running. A human Corgi sprinting from the Corgis' start slot
  (143.5 m) takes 15-17 s, so with the data's start slots the Cat bot is usually on the slab first. With the
  equal-time slots (§10) the Cat bot starts at (62, 117), 132.4 m out, and takes 15.5 s on its route. A Corgi on the
  bots' route takes 15.0 s; walking straight with W + Shift it took 16.9 s in G-MOVE's test, sliding 2-3 s along
  the pallet stack. 1v1: the Corgi bot was first in 37 of 40 matches.

## 7. Web twin (report only, no src/ edit)
I copied the working tree's `src/` and `server/` (TW-SIM's uncommitted slab mode included) into a scratch dir. A tsx
script ran `new Room(sim, {mode: 'slab', botsPerTeam: [k, k]})` and ticked it to the end, `Sim.create({seed})` with
seeds 1-10. Sim only, no browser.

| Format | n | Corgi wins | Cat wins | Draws | Mean margin |
|---|---|---|---|---|---|
| 1v1 | 10 | 5 | 5 | 0 | -6.6 |
| 2v2 | 10 | 7 | 3 | 0 | +13.6 |

No Cat lean in this sample. The web 2v2 results swing hard (60-0 twice for the Corgis, 9-60 for the Cats), so a
single 0-60 run says little. The web bots already sprint while more than 12 m of path is left (`brain.ts`).

## 8. Suite
Final tree (equal-time slots, shipped bot, A-HOOK's sfx): the full suite passed 15/15 in 1 min 17 s, and the soak
read 19-20. With the equal-distance slots it was also 15/15, with a soak of 18-17. Before the follow-up:
In the private copy (HEAD plus the working tree's `engines/godot/**` and `src/shared/world/lot/**` as of this wave,
plus my files), the full suite `tests/run.gd` passed 14/14 in 1 min 26 s. The soak now reads `score 16-17 · 9
takedowns · 273 shots`; it was 10-25 in G-MOVE's run and 6-29 in Q6. `--only balance` passes in 8 s. On the baseline
bot.gd it fails with four messages:
- LEDGE_JUMP 0.30 below STEP_HEIGHT;
- the Corgi bot tops out at 6.40 m/s;
- the Cat bot tops out at 6.60 m/s;
- no `_gait()`.

## 9. For the lead (outside my files)
- **Done in the follow-up (§10), matched on sprint time.** The original finding about the start slots in match.gd
  `start_match()`:
  `list[used % size]` gives the Corgis spawn 0 (-74, -123), 143.5 m from
  the slab, and the Cats spawn 0 (56, 105), 119.0 m. The spawns are point-symmetric; the mirror of Corgi slot i is
  Cat slot 15 - i. Using `spawns[1][15 - i]` for the Cats (or ordering `the_lot.json` that way) gives both 143.5 m.
  After my change this matters more for a human: the Cat bot now sprints from 119 m (about 14.5 s) and beats a
  sprinting human Corgi from 143.5 m (about 15-17 s) to the slab. Before, the running Cat bot took about 19.3 s.
- Bots jump on the pit ramp and in the trench notches (§5): `_steer` jumps on any corner more than `LEDGE_JUMP` up
  within 2.5 m, which includes slopes. A slope test (the rise over the horizontal distance) would stop that. It does
  not slow the routes, so I left it.

## 10. Follow-up: equal-time start slots (match.gd)
**Shipped: equal time.** `start_match()` takes each team's slots from `start_slots(team)`:
- The Corgis' slots run from their farthest spawn to the nearest. Slot 0 is the human's: spawn 0, 143.5 m out, with
  the straight walk up the slab path.
- Every other team's slot k is the unused spawn whose straight-line sprint time to the slab (distance / the species'
  sprint, tuning.gd MOVE) is closest to the Corgis' slot k.
- `spawns` keeps the data order, so `--demo`, `--lineup` and respawns (`best_spawn`) are unchanged. `test_game_demo`
  passes, and A-HOOK's `slab_point` is kept.

| Slot | Corgi spawn | Sprint time | Cat spawn | Sprint time | Residual |
|---|---|---|---|---|---|
| 0 (you, or bot 1) | (-74, -123), 143.5 m | 14.95 s | (62, 117), 132.4 m | 15.05 s | +0.09 s |
| 1 (2v2) | (-68, -123), 140.5 m | 14.64 s | (74, 105), 128.5 m | 14.60 s | -0.04 s |

Both are within the 0.3 s asked for. The spawn grid is 6 m apart, so 131 m exactly is not on offer.

**Measured** (the "equal-time spawns" rows in §3): the same harness and seeds, on the shipped bot (sprint, ledge
jump 0.45 m), with the working tree as of the follow-up. That tree adds A-HOOK's sfx.gd; it does not change gameplay.
- **Wins: neither side is over 60 %.** 1v1 is 16-24 (Cat 60 %, 45-74 %); 2v2 is 27-33 (Cat 55 %, 42-67 %).
  Held time is 50 % and 51 % Cat, and the mean margins are -1.1 and -1.3 points.
- **First on the slab:**
  - 1v1: the Corgi in 37 of 40 matches (at 16.5 s on average), the Cat in 3.
  - 2v2: the Cats in 43 of 60, the Corgis in 17. The first of two bots counts there, and the Corgis' slot 1 goes
    through the pit and the trenches.
  - Equal straight-line time is not equal route time: on the bots' routes, Corgi slot 0 takes 15.0 s and the Cats'
    (62, 117) takes 15.5 s (§5).
- **Before it, in the data's order:** the Corgis started 143.5 m out and the Cats 119.0 m. The Cat was first on the
  slab in 199 of 200 matches.
- **Before it, at equal distance** (the first try, rows "equal-distance spawns"): the faster-sprinting Corgis were
  first in 100 of 100 matches and won 2v2 40-20 (67 %, 54-77 %). From the same distance the Corgi trip is 1.5 s
  shorter, so they also won the reinforcement race at every wave (§4).
- **Full suite** on this tree: 15/15 pass in 1 min 17 s; the soak read 19-20.

## 11. Wave 14 CONTEST: holding and contesting inside the score volume (bot.gd)
**The problem (W13 READ check):** the Cat bot fought from the slab's corners and lip. Only the middle held.
- As a holder, a bot strafed (and backed off to the rifle's 7 m minimum range) across the edge, in and out of the
  volume.
- As an attacker, it stopped at 7 m from a holder in the middle and circled. 7 m is outside the 8 x 8 m square
  (whose corners are 5.7 m from the centre), so it only clipped the corners: CONTESTED flickered, and each flicker
  reset the holder's count.

**The one change (bot.gd):**
- **On the slab** (slab.gd `contains()`), a bot's wish goes through `_hold_inside()`. Per axis, the part that would
  carry it within `SLAB_MARGIN` 1.0 m of an edge in the next `EDGE_LOOK` 0.8 m is cut back. From inside that margin
  it points back in. A strafe the edge stops turns round. The goal pull, the strafe and the shooting are as before;
  a bot on the slab no longer backs off to its minimum range.
- **Within `CONTEST_ZONE` 6 m of the square**, a bot with an enemy in sight steps in: it follows its path with less
  strafe (0.4 instead of 0.8) and never backs off.
- Standing still on the slab no longer counts as stuck, so a bot does not jump there.

**Measured** on a private copy of HEAD 3b9b956 plus my bot.gd only (HEAD's match.gd: sprint, equal-time slots). The
same seeds as before: 1v1 n 40, seeds 1-40; 2v2 n 60, seeds 1-60. Slab metrics are new in `balance.gd`:
- **inside**: share of the pets' slab time spent at least 1 m from every edge;
- **lip fights**: seconds a pet spent outside the volume, within 3 m of the square, fighting an enemy on the slab;
- **steps off**: times a living pet left the volume.

| Format | Build | n | Corgi wins | Cat wins | Draws | Cat share (95 % CI) | Mean margin | Inside (Corgi / Cat) | Lip fights per match | Steps off per match |
|---|---|---|---|---|---|---|---|---|---|---|
| 1v1 | HEAD | 40 | 16 | 24 | 0 | 60 % (45-74 %) | -1.1 | 97 / 96 % | 0.9 s | 8.0 |
| 1v1 | hold inside | 40 | 22 | 18 | 0 | 45 % (31-60 %) | +2.7 | 99 / 99 % | 0.9 s | 0.0 |
| 2v2 | HEAD | 60 | 28 | 32 | 0 | 53 % (41-65 %) | -0.6 | 94 / 92 % | 2.4 s | 20.7 |
| 2v2 | hold inside | 60 | 24 | 36 | 0 | 60 % (47-71 %) | -0.9 | 98 / 97 % | 2.5 s | 0.0 |

- **Wins: neither side is over 60 %, but 2v2 is at the line.** The Cats win 36 of 60. The interval includes 50 %,
  the held time is 50.4 % Cat (3348 against 3404 s) and the mean margin is -0.9 points. The second seed set the lead
  plans will settle it.

- The lip time did not change (0.9 and 2.5 s per match). It is the step across the 3 m ring into the volume: about
  0.5 s at run speed, once or twice a match in 1v1. Steps off the slab went to zero, and the share inside the margin
  rose.
- HEAD's 2v2 row is 28-32 here against 27-33 in §3's equal-time row. That tree had other lanes' uncommitted edits.

**The verifier's case: `--holder 40 --n 10`.** You stand in the middle of the slab, a Corgi with no input, kept
unhurt so the fight lasts. The Cat bot comes from its start slot and fights you for 40 s per trial. Its position is
counted from its first sight of you (at 13.4 s):

| Build | Bot inside the 1 m margin | Edge band (last 1 m) | On the lip (3 m out) | Farther (on its way in) | CONTESTED flips per trial | Your points after its first sight |
|---|---|---|---|---|---|---|
| HEAD | 69 % | 17 % | 5 % | 9 % | 3.2 | 3.1 |
| hold inside | 88 % | 1 % | 3 % | 8 % | 1.0 | 3.0 |

After the change the bot walks in and contests from inside, once and for good (one flip per trial). Before, it
crossed the edge band 2-6 times per trial.

**Suite:** HEAD plus my three files, full `tests/run.gd` 15/15 PASS in 1 min 15 s (soak 18-21).
`test_game_balance.gd` adds a check: a bot 0.5 m from the edge heading out is turned in, and one in the middle is
left alone.

**Harness, ready for the second seed set:** `--format 1v1|2v2 --n N --seed S` (for example `--seed 101`) prints the
slab-position line per match and in the summary; `--holder S` is the scenario above.

## 11b. Wave 14 SAMPLE (integrated build)
The table and the analysis are in `docs/qa/w14/bot-sample.md`. The build was HEAD plus G-MOVE's match.gd plus this
bot.gd, with seeds 1-40/1-60 and 101-140/101-160:
- **1v1:** n 80, 41-39 (Cat 49 %).
- **2v2:** n 120, 47-73 (Cat 61 %, 52-69 %).
- **The one allowed start-offset change, slots by nav-path sprint time:** 2v2 went to 73 % Cat, so it is reverted.
  match.gd is G-MOVE's version again. The nav path does not see the Corgi bots' extra 0.4 s per trip.
- **Jump fix, tried and reverted.** A ledge jump only against a wall the movement cannot take cut Corgi jumps per trip
  from 7.2 to 0.6, with no trip-time gain (+0.09 s). 2v2 went to 30-90 (Cat 75 %), so bot.gd is back to the CONTEST
  version. NEXT, in bot-sample.md:
  1. slots from measured bot trip times (test_game_respawn.gd changes with it);
  2. the ramp hops (cosmetic).

## 12. Commands
```
G=<Godot 4.7.2>
$G --headless --path engines/godot --import
$G --headless --path engines/godot --script res://tests/balance.gd -- --format 1v1 --n 20 --seed 1 --speed 30 --events
$G --headless --path engines/godot --script res://tests/balance.gd -- --format 2v2 --n 20 --seed 1 --speed 30 --events
$G --headless --path engines/godot --script res://tests/balance.gd -- --format 1v1 --n 3 --seed 1 --speed 1 --events   # x1 check
$G --headless --path engines/godot --script res://tests/balance.gd -- --routes --speed 30 [--jump-up 0.3]
$G --headless --path engines/godot --script res://tests/balance.gd -- --ttk 15 --n 10 --speed 30
$G --headless --path engines/godot --script res://tests/balance.gd -- --holder 40 --n 10 --seed 1 --speed 30
$G --headless --path engines/godot --script res://tests/run.gd -- --only balance
```
"After" rows: add `--jump-up 0.3` to hold the ledge jump at the baseline value. Seeds 21-40: `--seed 21`.
