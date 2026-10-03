# W15 ROUTE: Cat slots from measured bot trips (lane G-BOT)

**Build:** a private copy of HEAD 0ddc7d2 plus the working tree's `engines/godot/**`: the lead's `respawn_zone()`
helper, kept and working, and my match.gd, balance.gd and test_game_respawn.gd. bot.gd is the shipped CONTEST version
(sha256 d1f36474...e59c).

**Harness:** `engines/godot/tests/balance.gd`, real match rules, 60 Hz ticks at `--speed 30`, at most 2 Godot
processes at once.

## A1. Result
The Cat start and respawn slots are now data in match.gd (`CAT_SLOTS`). Each spawn has its measured lone-bot trip
beside it, and the Corgi slots are unchanged.

| Step | 1v1 (n 80): Corgi-Cat, Cat share | 2v2 (n 120): Corgi-Cat, Cat share |
|---|---|---|
| W14 slots (straight-line sprint time) | 41-39, 49 % | 47-73, 61 % |
| Equal measured trips (the one A1 change) | 41-39, 49 % | 43-77, **64 %** |
| + every Cat start and respawn slot on the row z = 117 (`CAT_OFFSET` 0.6: 0.49-0.76 s more measured trip per life than the Corgis'; the one allowed follow-up, a start offset) | 42-38, 48 % | 52-68, **57 %** |

**How the bar reads.**
- **Pooled n** (1v1 n 80, 2v2 n 120), the lead's ruling as in the W13/W14 precedent: with the offset, neither side
  is over 60 % in either format. The last row is what match.gd ships.
- **Per seed set:** 2v2 seeds 101-160 are 62 % Cat (60 % on a rerun), so A1 is still over. The lane stopped after
  the one allowed change, as the card says.

**Significance.**
- No row differs significantly from another: pairwise Fisher p >= 0.29 between the three 2v2 rows (0.24 between
  equal trips and the offset's rerun, below), and p = 1.0 between the 1v1 rows.
- Against an even split (two-sided binomial), the 2v2 rows give:
  - W14: p 0.02;
  - equal trips: p 0.002;
  - with the offset: p 0.17 (rerun 0.24).
- Held share with the offset: 51.2 % Cat in 2v2 and 49.4 % in 1v1.

### Table (all runs; seeds 1-40 / 101-140 for 1v1, 1-60 / 101-160 for 2v2)
- Held = seconds alone on the slab (scored).
- First = matches in which that side reached the slab first, Corgi / Cat / tie. A tie is both within 0.1 s, or
  neither.
- Trip = mean spawn-to-slab time per life in those matches.
- Margin = Corgi score minus Cat score.
- Margin, held time and trip in each block are one run's values. The harness does not replay a seed exactly in
  another process (see Reproducibility).

| Slots | Format | Seeds | n | Corgi | Cat | Draws | Cat share (95 % Wilson CI) | Margin | Held, Corgi-Cat | First, Corgi / Cat / tie | Trip, Corgi / Cat |
|---|---|---|---|---|---|---|---|---|---|---|---|
| W14 | 1v1 | 1-40 | 40 | 23 | 17 | 0 | 42 % (29-58 %) | +1.7 | 2257-2170 s | 38 / 0 / 2 | 16.4 / 16.0 s |
| W14 | 1v1 | 101-140 | 40 | 18 | 22 | 0 | 55 % (40-69 %) | -1.5 | 2195-2232 s | 39 / 0 / 1 | 16.3 / 16.0 s |
| W14 | **1v1** | **both** | **80** | **41** | **39** | **0** | **49 % (38-60 %)** | **+0.1** | **4452-4402 s (49.7 % Cat)** | **77 / 0 / 3** | |
| W14 | 2v2 | 1-60 | 60 | 24 | 36 | 0 | 60 % (47-71 %) | -6.8 | 3067-3536 s | 6 / 52 / 2 | 16.8 / 16.1 s |
| W14 | 2v2 | 101-160 | 60 | 23 | 37 | 0 | 62 % (49-73 %) | -5.5 | 3131-3515 s | 2 / 55 / 3 | 16.8 / 16.1 s |
| W14 | **2v2** | **both** | **120** | **47** | **73** | **0** | **61 % (52-69 %)** | **-6.1** | **6198-7051 s (53.2 % Cat)** | **8 / 107 / 5** | |
| equal trips | 1v1 | 1-40 | 40 | 18 | 22 | 0 | 55 % (40-69 %) | -4.3 | 2095-2277 s | 1 / 34 / 5 | 16.5 / 15.8 s |
| equal trips | 1v1 | 101-140 | 40 | 23 | 17 | 0 | 42 % (29-58 %) | +0.6 | 2215-2204 s | 2 / 32 / 6 | 16.5 / 15.8 s |
| equal trips | **1v1** | **both** | **80** | **41** | **39** | **0** | **49 % (38-60 %)** | **-1.9** | **4310-4481 s (51.0 % Cat)** | **3 / 66 / 11** | |
| equal trips | 2v2 | 1-60 | 60 | 25 | 35 | 0 | 58 % (46-70 %) | -3.2 | 3171-3408 s | 24 / 16 / 20 | 16.7 / 16.0 s |
| equal trips | 2v2 | 101-160 | 60 | 18 | 42 | 0 | 70 % (57-80 %) | -7.4 | 3021-3488 s | 27 / 14 / 19 | 16.7 / 16.0 s |
| equal trips | **2v2** | **both** | **120** | **43** | **77** | **0** | **64 % (55-72 %)** | **-5.3** | **6192-6896 s (52.7 % Cat)** | **51 / 30 / 39** | |
| + offset 0.6 s | 1v1 | 1-40 | 40 | 22 | 18 | 0 | 45 % (31-60 %) | +1.6 | 2319-2234 s | 39 / 0 / 1 | 16.3 / 16.5 s |
| + offset 0.6 s | 1v1 | 101-140 | 40 | 20 | 20 | 0 | 50 % (35-65 %) | +0.2 | 2237-2207 s | 39 / 0 / 1 | 16.3 / 16.5 s |
| + offset 0.6 s | **1v1** | **both** | **80** | **42** | **38** | **0** | **48 % (37-58 %)** | **+0.9** | **4556-4441 s (49.4 % Cat)** | **78 / 0 / 2** | |
| + offset 0.6 s | 2v2 | 1-60 | 60 | 29 | 31 | 0 | 52 % (39-64 %) | -0.5 | 3292-3291 s | 60 / 0 / 0 | 16.5 / 16.7 s |
| + offset 0.6 s | 2v2 | 101-160 | 60 | 23 | 37 | 0 | 62 % (49-73 %) | -5.8 | 3194-3525 s | 60 / 0 / 0 | 16.5 / 16.7 s |
| + offset 0.6 s | **2v2** | **both** | **120** | **52** | **68** | **0** | **57 % (48-65 %)** | **-3.2** | **6486-6816 s (51.2 % Cat)** | **120 / 0 / 0** | |

The W14 rows were measured in W14 (docs/qa/w14/bot-sample.md) on HEAD 3b9b956 + match.gd + bot.gd, the same code
paths. Their First column is recounted from those runs' logs with the tie rule. On seeds 101-160 the shipped 2v2 is
62 % Cat in this run.

### Reproducibility
The shipped build was run three times on 2v2 seeds 101-160:
- A1: 23-37 (Cat 62 %, 49-73 %);
- A2: 24-36 (60 %, 47-71 %);
- the verifier: 23-37.

Between A1 and A2, 15 of the 60 winners changed, while seeds 1-60 reproduced 60 of 60 matches. Pooled, the shipped
2v2 is 68/120 Cat (57 %, 48-65 %) in A1 and 67/120 (56 %, 47-64 %) with A2's second block. A seed does not reliably
replay a match in another process, so treat each seed block as an independent sample. The likely cause, not proven,
is that the boot's pre-match physics ticks depend on wall time.

### Why equal trips were not enough
In a match each side's bots reached the slab later than alone, and the Corgis lost more:

| Slots | Alone (11-run mean, start slot 0) | 1v1 match trip | 2v2 match trip |
|---|---|---|---|
| Corgi | 15.07 s | 16.5 s | 16.7 s |
| Cat at equal trips | 15.05 s | 15.8 s | 16.0 s |
| Cat with the offset | 15.64 s | 16.5 s | 16.7 s |

- **Run speed.** Within sight or hearing of an enemy a bot runs instead of sprinting (bot.gd `_gait`), and the Cat
  runs faster (6.6 against 6.4 m/s).
- **The Corgis' way in.** It comes up out of the pit and along the slab path in sight of the slab longer. In the
  equal-trip 2v2 runs the Corgis died before reaching the slab 136 and 146 times per 60 matches, against the Cats'
  104 and 98.
- **The offset gives that back at the slots.** With it the match trips are about equal (Corgi 16.3 / 16.5 s against
  Cat 16.5 / 16.7 s, in 1v1 / 2v2), and held time is 49.4 % and 51.2 % Cat.
- **One gap remains:** Corgi shooters hit 29-30 % against the Cats' 31-33 % in every 2v2 run. The 2v2 trace (the
  offset rows) finds:
  - no bot jump within 60 m of the slab;
  - every death but one within 20 m of it;
  - 4 of about 56,000 shots at an airborne target.

### Routes: measured trip for every slot in use
`balance.gd --routes --reps 3 --seed 1` and `--reps 8 --seed 101`: 11 runs per point, each with its own goal on the
slab. The trip is a lone bot sprinting to the slab's edge. The "centre goal" column is test_game_respawn.gd's
deterministic run with the goal at the slab's centre.

| Team | Slot | Data spawn index | x, z | Trip, 11-run mean (range) | Centre goal | Straight-line sprint |
|---|---|---|---|---|---|---|
| Corgi | start 0, respawn | spawns["0"][0] | -74, -123 | 15.07 s (14.93-15.28) | 15.13 s | 14.95 s |
| Corgi | start 1 | spawns["0"][4] | -68, -123 | 14.82 s (14.63-14.98) | 14.82 s | 14.64 s |
| Corgi | respawn | line point 1 | -73.3, -121.9 | 15.01 s (14.83-15.48) | 14.98 s | 14.82 s |
| Corgi | respawn | line point 2 | -72.7, -120.8 | 14.88 s (14.67-15.35) | - | 14.68 s |
| Cat | start 0, respawn | spawns["1"][2] | 56, 117 | 15.64 s (15.50-15.97) | 15.62 s | 14.74 s |
| Cat | start 1, respawn | spawns["1"][6] | 62, 117 | 15.56 s (15.42-15.92) | 15.53 s (start), 15.50 s (respawn) | 15.05 s |
| Cat | respawn | spawns["1"][10] | 68, 117 | 15.61 s (15.42-15.87) | 15.55 s | 15.38 s |

- The Corgi line points are `s0 + dir * 1.3 k` on the line from spawn 0 to the slab's centre, set on the ground by a
  ray (match.gd `_pick_respawn_slots`, G-MOVE, unchanged).
- Cat minus Corgi, by 11-run means: start slot 0 +0.57 s, start slot 1 +0.74 s, respawns +0.49 to +0.76 s.
- **W14's Cat slots,** for comparison: slot 0 at (62, 117) 15.56 s, slot 1 at (74, 105) 14.56 s, respawns at
  (56, 117) 15.64 s and (68, 111) 14.93 s.
- **The equal-trip step's Cat slots:** slot 0 at (56, 111) 15.05 s, slot 1 at (68, 111) 14.93 s, respawns at
  (56, 111), (62, 111) and (68, 111), 14.93-15.05 s.

### For tw-sim (port to src/sim/match/slab.ts)
| Team | Use | x, z | the_lot.json index | Measured trip |
|---|---|---|---|---|
| Cat | start slot 0 | 56, 117 | spawns["1"][2] | 15.64 s |
| Cat | start slot 1 | 62, 117 | spawns["1"][6] | 15.56 s |
| Cat | respawn | 56, 117 | spawns["1"][2] | 15.64 s |
| Cat | respawn | 62, 117 | spawns["1"][6] | 15.56 s |
| Cat | respawn | 68, 117 | spawns["1"][10] | 15.61 s |
| Corgi | start slot 0 / respawn (unchanged) | -74, -123 | spawns["0"][0] | 15.07 s |
| Corgi | start slot 1 (unchanged) | -68, -123 | spawns["0"][4] | 14.82 s |
| Corgi | respawn (unchanged, computed) | -73.3, -121.9 and -72.7, -120.8 | spawn 0's line | 15.01 and 14.88 s |

The trips are Godot's bot (`bot.gd`), not the web bot's. If the web bots' trips differ, the web needs its own
measurement.

### Tests
- `tests/test_game_respawn.gd` (now G-BOT's) keeps W14's rounds: every respawn must be one of the team's
  `respawn_slots`, and two teammates downed together must not respawn on one point. It keeps the straight-walk check
  from every respawn point.
- **New measured-trip check.** A lone bot runs from each 2v2 start slot and each respawn point seen. A Cat trip less
  `CAT_OFFSET` must be within 0.3 s of the Corgis' slot k, and of every Corgi respawn. Every trip must be within
  0.4 s of the value match.gd keeps.
- **It fails on the old slots.** With HEAD's match.gd the test FAILS twice: "start slot 0: Corgi (-74.0, -123.0)
  15.13 s against Cat (62.0, 117.0) 15.53 s less 0.00 s", and "respawns: Corgi (-73.3, -121.9) 14.98 s against Cat
  (56.0, 117.0) 15.60 s".
- **Suite (A1):** HEAD plus the A1 files, `tests/run.gd` 16/16 PASS. The whole working tree also passed, 19/19 in
  1 min 54 s, but that count includes the HUD lane's three new test_hud_*.gd.

### Human play
- **The slots are matched for bots,** by measured bot trips.
- **A human Corgi is still behind.** Running straight with W + Shift from spawn 0 takes about 16.9 s
  (test_game_stepup.gd: 16.92 s). From the Cats' slots, the Cat bots take 15.5-15.6 s. The human is about 1.3 s
  behind every life, at the start and on every respawn.
- **Narrower than W14.** There the Cats' slot 1 and a respawn were at 14.56 s and 14.93 s, 2.3 and 2.0 s ahead of
  the human.

### Commands
```
G=<Godot 4.7.2>; B="$G --headless --path engines/godot --script res://tests/balance.gd --"
$B --format 2v2 --n 60 --seed 1 --speed 30 --events --trace;  $B --format 2v2 --n 60 --seed 101 --speed 30 --events --trace
$B --format 1v1 --n 40 --seed 1 --speed 30 --events --trace;  $B --format 1v1 --n 40 --seed 101 --speed 30 --events --trace
$B --routes --reps 3 --seed 1 --speed 30;  $B --routes --reps 8 --seed 101 --speed 30   # the 11 runs per point
$G --headless --path engines/godot --script res://tests/run.gd
# The regression the respawn test guards, in a scratch copy (never in your working tree): expect 2 FAIL lines
cp -a engines/godot /tmp/rt && git show 0ddc7d2:engines/godot/game/match.gd > /tmp/rt/game/match.gd  # 0ddc7d2 = before W15
$G --headless --path /tmp/rt --script res://tests/run.gd -- --only respawn
```

## A2. HOPS (scratch only: bot.gd is unchanged)
**Question.** W14's wall-only jump fix took 2v2 from 61 % to 75 % Cat (47-73 against 30-90 at n 120, Fisher p 0.03).
Why? The fix: a bot jumps for a path
corner more than 0.45 m up only when a wall it faces blocks it (`_blocked()`), never on a walkable slope.

**Setup.**
- Both builds use the new slots (A1, with `CAT_OFFSET`) and the same seeds: 2v2, 1-60 and 101-160, n 120.
- "Shipped" is bot.gd as it is (sha256 d1f36474...e59c). "Hop fix" is the same file plus W14's `_blocked()` test, in
  a scratch copy.
- `balance.gd --trace` adds:
  - jumps by distance from the slab;
  - airborne time;
  - hits on airborne targets;
  - deaths by place;
  - per Corgi life, the time to cross the slab path's 26-64 m band (the pit ramp and the trench notches);
  - teammate contact there;
  - stalls.

### Matches
| bot.gd | Seeds 1-60 | Seeds 101-160 | Both, n 120 | Cat share (95 % CI) | Held, % Cat | First on slab, Corgi (mean, Corgi / Cat) | Band crossing per Corgi life | Corgi jumps, 60-100 / 100+ m | Corgi airborne | Died before the slab, Corgi-Cat | Kills from the slab, Corgi-Cat |
|---|---|---|---|---|---|---|---|---|---|---|---|
| shipped | 29-31 (52 %) | 24-36 (60 %) | 53-67 | 56 % (47-64 %) | 50.8 % | 120 / 120 (15.21 / 17.58 s) | 4.00 s (n 1247) | 6321 / 3862 | 1726 s | 181-277 | 249-147 |
| hop fix | 28-32 (53 %) | 22-38 (63 %) | 50-70 | 58 % (49-67 %) | 51.1 % | 120 / 120 (15.38 / 17.39 s) | 4.10 s (n 1251) | 0 / 1291 | 524 s | 200-259 | 229-169 |

In both builds:
- no jump within 60 m of the slab, and none in a fight;
- about 1 s airborne within 30 m of the slab over all 120 matches;
- of about 110,000 shots, 3 (shipped) and 1 (hop fix) were at an airborne target;
- one airborne death in all, a Cat in the hop-fix runs;
- every death within 20 m of the slab;
- no stall;
- 8-9 s of Corgi teammate contact in the band, over 120 matches.

### Lone trips (`--routes --reps 3`)
| Slot | Shipped | Hop fix |
|---|---|---|
| Corgi start 0 / respawn (-74, -123) | 15.00 s, 8 jumps, 1.33 s airborne | 15.08 s, 1 jump and 1 step-up, 0.40 s airborne |
| Corgi start 1 (-68, -123) | 14.86 s | 14.95 s |
| Corgi respawn (-73.3, -121.9) / (-72.7, -120.8) | 15.00 / 14.97 s | 15.08 / 15.06 s |
| Band 26-64 m along the slab path | 4.00 s | 4.08 s |
| Cat slots (56, 117) / (62, 117) / (68, 117) | 15.64 / 15.68 / 15.59 s | the same; the one Cat jump at (68, 117) is gone |

### Cause, with numbers
1. **The hops never reach a fight.** All of them happen 60 m or more from the slab, on the pit ramp, in the trench
   notches and at the pit (the 100+ m bin). Fights and deaths are within 20 m of the slab, where bots are airborne
   about 1 s in 120 matches.
2. **Removing them costs the Corgis 0.08-0.10 s per trip.** The band crossing goes from 4.00 to 4.08 s alone and
   from 4.00 to 4.10 s in matches. The lone slot trips are 0.08-0.09 s longer. The Corgis' first arrival is 0.17 s
   later, but they are still first in all 120 matches. A bot keeps its horizontal speed in the air, so the hops were
   slightly faster than running the notches' slopes.
3. **On the new slots the effect is inside the noise.** The Cat share goes from 56 % to 58 % (53-67 against 50-70, Fisher
   p 0.79), about 0.3 standard errors.
   - The harness is not bit-identical between processes. The shipped build run twice on seeds 101-160 gave 23-37
     (A1) and 24-36 (A2), and 15 of 60 winners changed. Seeds 1-60 reproduced 60 of 60 matches.
   - Between the two builds 53 of 120 winners change: 28 to Cat, 25 to Corgi. A 0.1 s shift re-rolls close matches
     both ways.
4. **W14's 61 % to 75 %** was measured on the old slots, where the Cats were first on the slab in 110 of 120 matches.
   It came from the same 0.1 s per Corgi trip, plus run-to-run noise of the size measured here. I cannot separate the
   two at n 120, and nothing else in the traces differs.

**Decision.** The rule is to apply the fix only if 2v2 stays at or under 60 % on both seed sets at n 120. The hop fix
gives 63 % Cat on seeds 101-160, so it is **not applied**, and bot.gd is unchanged. The hops are cosmetic: they are
60 m or more from any fight and cost no trip time.

**Next, if the hops are wanted gone for looks:**
- **A determinism fix first.** Start every match after a fixed number of physics ticks. Today the boot waits on
  process frames at time scale 1, so the pre-match tick count probably depends on wall time (not proven).
- **Then a larger sample** (n 240 per build) or a paired design (same process, both builds) to see a 2-point effect.
- **Or keep the hops and smooth them:** a jump only where the slope over the next 2.5 m is above 52 deg. That is
  untested.

### A2 commands (one Godot process at a time)
```
B="$G --headless --path engines/godot --script res://tests/balance.gd --"
$B --format 2v2 --n 60 --seed 1 --speed 30 --events --trace;   $B --format 2v2 --n 60 --seed 101 --speed 30 --events --trace
$B --routes --seed 1 --reps 3 --speed 30
```
The hop-fix runs are the same commands in a scratch copy whose bot.gd has W14's `_blocked()` jump test.
