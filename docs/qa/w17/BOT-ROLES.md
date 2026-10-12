# W17 match depth 1: 2v2 roles, the trap fix and the two options (lane G-BOT2)

**Result: NOT MET. Neither option passes both bars, so nothing was picked.**
- **The trap fix works.** A bot on the slab whose goal is off it can now walk off to its post. With the fix, the
  APPROACH bot is at its post 13-15 % of its alive time; before the fix it was 0.1-0.5 %.
- **The fix breaks the balance bar.** It takes 2v2 to 24-96 (Cat 80 %).
- **Option "post inside the 6 m contest zone"** gives 33-87 (Cat 72 %). It also misses the roles bar.
- **Option "drop the roles"** gives 43-77 (Cat 64 %). It cannot make "one approaches" true: no bot approaches.
- **The 7a671f1 code, measured the same day:** 50-70 (Cat 58 %).
- **What ships:** bot.gd behaves as it did at 7a671f1. The trap stays and the roles stay nominal. Only the roles
  comment changed, to point here. The lead rules on what comes next (see Decision).
  - Superseded by § G-BAL: bot.gd now ships aim-height parity (`AIM_EYE` / `AIM_CHEST`); the trap and the nominal
    roles are unchanged.
- **Contest rule:** `test_bot_contest.gd` 5/5 PASS, edge band 0.4-1.4 %.
- **1v1:** 41-39 in every build.

## Build and method
- A private copy of HEAD 7a671f1. Four copies of `engines/godot` differ only in `game/bot.gd`; all of them run this
  lane's `tests/balance.gd`. `match.gd` and `tuning.gd` are untouched.
- Harness: `balance.gd --format F --n N --seed S --speed 30 --events --trace`, with the real match rules and 60 Hz
  ticks.
- Seeds: 2v2 used 1-60 and 101-160 (n 120); 1v1 used 1-40 and 101-140 (n 80). One block is one process. There were
  16 blocks, all complete (60 or 40 MATCH lines each, a SUMMARY, no script error).
- Runs used `nice -n 10`, at most 2 Godot processes at once, on 2026-10-10 from 04:54 to 06:46 UTC.
- A seed does not replay a 2v2 match exactly in another process (docs/qa/w15/bot-route.md, Reproducibility), so
  each block is an independent sample.
  - 1v1 nearly does. The four builds run the same 1v1 code: no team has two bots, so every bot HOLDS.
  - Against the shipped build, the other three builds' 1v1 MATCH lines are identical in 229 of 240. Of the 11 that
    differ, 10 are in one block, with 2 winners swapped.

| Build | bot.gd change (sha256 prefix) |
|---|---|
| shipped | none: 7a671f1 (`7b53a15a`) |
| trap fix | `_steer()`: `var on_slab: bool = game.slab.contains(pos) and game.slab.contains(goal)` (`3ce4b63b`) |
| trap fix + post in zone | the trap fix, and `_find_post()` puts the post where the enemy's nav path in first comes within `POST_OFF` 4.0 m of the slab's square (bisection on `_off_square`), not 16 m from its centre (`22be5d5a`) |
| trap fix + no roles | the trap fix, and `_role_from_slot()` returns `ROLE_HOLD` (`3076e5ec`) |

**Why 4 m.** It is inside the 6 m `CONTEST_ZONE` even with the post's 1 m goal jitter. It is also outside the 3 m
lip, where W13's bots circled a holder and clipped the corners (balance.gd LIP). A post on the lip would bring
back "fighting a holder from the lip", which the contest rule removed. The dose response below makes a farther post
look worse, not better.

**The step-on rule is unchanged in every build.** APPROACH steps on, and stays at least `STEP_ON_MIN` (3 s), when
no teammate is alive or an enemy stands on the slab.

## The bars
- **Balance (the card):** neither side over 60 %, pooled 1v1 n 80 and 2v2 n 120.
- **Roles true in play.** The card names the measure, the share of alive time at the post or approaching, but gives
  no number. I set this bar after a 2-match smoke run and before the n 120 runs. For each team's APPROACH bot:
  - at its post or approaching, at least 50 % of its alive time (most of its life doing the approach job);
  - at its post, at least 20 % of its alive time (W15 Sprint C's arrival bar, so travel alone cannot pass).
- The balance bar alone already rules out every option here, so the roles bar decides nothing.

**Where an APPROACH bot's alive time goes** (`balance.gd _role_where`, every tick):
- **at its post:** within 3 m of `push_point`, flat;
- **approaching:** on its way to the post, not stepping on and off the slab. This includes the trip from a respawn.
- **stepping on:** going to or holding the slab for its reason;
- **on the slab bound for the post:** the W15 trap holds it there. With the fix this is only the walk across.

## Balance (bots-only; the table format of docs/qa/w15/bot-route.md)
- Held = seconds alone on the slab (scored): the sum of the per-match MATCH lines. The block's SUMMARY line prints
  the unrounded total, which can differ by a few seconds (shipped 2v2 seeds 1-60: 3254-3363 here, 3251-3366 in the
  SUMMARY).
- First = matches in which that side reached the slab first, Corgi / Cat / tie. A tie is within 0.1 s, or neither
  side reaching it.
- Trip = mean spawn-to-slab time per life that reached the slab (all roles).
- Margin = Corgi score minus Cat score.

| Build | Format | Seeds | n | Corgi | Cat | Draws | Cat share (95 % Wilson CI) | Margin | Held, Corgi-Cat | First, Corgi / Cat / tie | Trip, Corgi / Cat |
|---|---|---|---|---|---|---|---|---|---|---|---|
| shipped | 2v2 | 1-60 | 60 | 29 | 31 | 0 | 52 % (39-64 %) | -1.8 | 3254-3363 s | 57 / 2 / 1 | 16.5 / 16.6 s |
| shipped | 2v2 | 101-160 | 60 | 21 | 39 | 0 | 65 % (52-76 %) | -6.5 | 3088-3468 s | 57 / 3 / 0 | 16.5 / 16.6 s |
| shipped | **2v2** | **both** | **120** | **50** | **70** | **0** | **58 % (49-67 %)** | **-4.2** | **6342-6831 s (51.9 % Cat)** | **114 / 5 / 1** | **16.50 / 16.60 s** |
| trap fix | 2v2 | 1-60 | 60 | 11 | 49 | 0 | 82 % (70-89 %) | -11.4 | 2933-3620 s | 57 / 2 / 1 | 17.0 / 16.6 s |
| trap fix | 2v2 | 101-160 | 60 | 13 | 47 | 0 | 78 % (66-87 %) | -11.6 | 2887-3581 s | 57 / 3 / 0 | 16.9 / 16.6 s |
| trap fix | **2v2** | **both** | **120** | **24** | **96** | **0** | **80 % (72-86 %)** | **-11.5** | **5820-7201 s (55.3 % Cat)** | **114 / 5 / 1** | **16.95 / 16.60 s** |
| trap fix + post in zone | 2v2 | 1-60 | 60 | 16 | 44 | 0 | 73 % (61-83 %) | -8.6 | 3037-3535 s | 59 / 0 / 1 | 16.6 / 16.5 s |
| trap fix + post in zone | 2v2 | 101-160 | 60 | 17 | 43 | 0 | 72 % (59-81 %) | -6.7 | 3074-3481 s | 57 / 2 / 1 | 16.5 / 16.5 s |
| trap fix + post in zone | **2v2** | **both** | **120** | **33** | **87** | **0** | **72 % (64-80 %)** | **-7.6** | **6111-7016 s (53.4 % Cat)** | **116 / 2 / 2** | **16.55 / 16.50 s** |
| trap fix + no roles | 2v2 | 1-60 | 60 | 22 | 38 | 0 | 63 % (51-74 %) | -3.4 | 3227-3386 s | 60 / 0 / 0 | 16.3 / 16.5 s |
| trap fix + no roles | 2v2 | 101-160 | 60 | 21 | 39 | 0 | 65 % (52-76 %) | -5.2 | 3168-3454 s | 60 / 0 / 0 | 16.3 / 16.5 s |
| trap fix + no roles | **2v2** | **both** | **120** | **43** | **77** | **0** | **64 % (55-72 %)** | **-4.3** | **6395-6840 s (51.7 % Cat)** | **120 / 0 / 0** | **16.30 / 16.50 s** |
| shipped | 1v1 | 1-40 | 40 | 21 | 19 | 0 | 48 % (33-63 %) | +0.8 | 2265-2206 s | 39 / 0 / 1 | 16.1 / 16.4 s |
| shipped | 1v1 | 101-140 | 40 | 20 | 20 | 0 | 50 % (35-65 %) | +0.1 | 2242-2218 s | 39 / 0 / 1 | 16.1 / 16.3 s |
| shipped | **1v1** | **both** | **80** | **41** | **39** | **0** | **49 % (38-60 %)** | **+0.5** | **4507-4424 s (49.5 % Cat)** | **78 / 0 / 2** | **16.10 / 16.35 s** |
| trap fix | 1v1 | 1-40 | 40 | 21 | 19 | 0 | 48 % (33-63 %) | +0.8 | 2265-2206 s | 39 / 0 / 1 | 16.1 / 16.4 s |
| trap fix | 1v1 | 101-140 | 40 | 20 | 20 | 0 | 50 % (35-65 %) | +0.1 | 2242-2218 s | 39 / 0 / 1 | 16.1 / 16.3 s |
| trap fix | **1v1** | **both** | **80** | **41** | **39** | **0** | **49 % (38-60 %)** | **+0.5** | **4507-4424 s (49.5 % Cat)** | **78 / 0 / 2** | **16.10 / 16.35 s** |
| trap fix + post in zone | 1v1 | 1-40 | 40 | 21 | 19 | 0 | 48 % (33-63 %) | +0.8 | 2265-2206 s | 39 / 0 / 1 | 16.1 / 16.4 s |
| trap fix + post in zone | 1v1 | 101-140 | 40 | 20 | 20 | 0 | 50 % (35-65 %) | +0.1 | 2242-2218 s | 39 / 0 / 1 | 16.1 / 16.3 s |
| trap fix + post in zone | **1v1** | **both** | **80** | **41** | **39** | **0** | **49 % (38-60 %)** | **+0.5** | **4507-4424 s (49.5 % Cat)** | **78 / 0 / 2** | **16.10 / 16.35 s** |
| trap fix + no roles | 1v1 | 1-40 | 40 | 21 | 19 | 0 | 48 % (33-63 %) | +0.7 | 2246-2192 s | 39 / 0 / 1 | 16.1 / 16.4 s |
| trap fix + no roles | 1v1 | 101-140 | 40 | 20 | 20 | 0 | 50 % (35-65 %) | +0.1 | 2242-2218 s | 39 / 0 / 1 | 16.1 / 16.3 s |
| trap fix + no roles | **1v1** | **both** | **80** | **41** | **39** | **0** | **49 % (38-60 %)** | **+0.4** | **4488-4410 s (49.6 % Cat)** | **78 / 0 / 2** | **16.10 / 16.35 s** |

**Significance (2v2, n 120).**
- Two-sided binomial against an even split: shipped p 0.08; trap fix p < 0.001; post in zone p < 0.001; no roles
  p 0.002.
- Fisher exact, against the shipped build of the same day:
  - trap fix p < 0.001;
  - post in zone p 0.03;
  - no roles p 0.43.
- Fisher exact, between the options: trap fix vs post in zone p 0.23; trap fix vs no roles p 0.009; post in zone vs no
  roles p 0.21.
- Against W15 Sprint C's shipped 51-69: post in zone p 0.02, no roles p 0.36, and today's shipped 50-70 p 1.0.
- **1v1, n 80:** 41-39 in all four builds (binomial p 0.91; Fisher p 1.0 between any two).

**The bar, per build:**
- shipped passes pooled (58 %), but its seeds 101-160 are at 65 %;
- trap fix fails (80 %, both seed sets over 75 %);
- post in zone fails (72 %; 73 % and 72 % per seed set);
- no roles fails (64 %; 63 % and 65 % per seed set);
- 1v1 passes for all (49 %).

## Roles in play (2v2, n 120 per build, both seed sets pooled)
| Build | Team | APPROACH at its post | Approaching | **Post or approaching** | Stepping on | On the slab bound for the post | Spawn-to-post (lives) | One on the slab, one at its post or approaching (of both-alive time) |
|---|---|---|---|---|---|---|---|---|
| shipped | Corgi | 77 s (0.5 %) | 26 % | **27 %** | 52 % | 22 % (the trap) | 18.2 s (11 of 672) | 15 % |
| shipped | Cat | 9 s (0.1 %) | 26 % | **27 %** | 50 % | 24 % (the trap) | 18.5 s (2 of 655) | 14 % |
| trap fix | Corgi | 2231 s (13.3 %) | 33 % | **46 %** | 52 % | 2 % | 21.5 s (291 of 813) | 27 % |
| trap fix | Cat | 2601 s (15.4 %) | 37 % | **52 %** | 46 % | 2 % | 20.9 s (327 of 801) | 32 % |
| post in zone | Corgi | 2589 s (15.4 %) | 34 % | **49 %** | 49 % | 2 % | 19.9 s (285 of 838) | 28 % |
| post in zone | Cat | 3123 s (18.5 %) | 34 % | **52 %** | 46 % | 2 % | 19.7 s (320 of 804) | 31 % |
| no roles | both | - (no APPROACH bot) | - | **0 %** | - | - | - | 0 % |

- **Every build fails the roles bar.**
  - Post in zone: Corgi 49 % and 15.4 %, Cat 52 % and 18.5 %, against 50 % and 20 %.
  - Trap fix: 46 % / 13.3 % and 52 % / 15.4 %.
  - Shipped: 27 % / 0.5 % and 27 % / 0.1 %.
  - No roles: 0 % by construction.
  - The per-seed-set values agree within 1 point, for example post in zone Corgi 15.4 % / 15.4 % and Cat
    18.7 % / 18.3 %.
- **What keeps the post share low is stepping on, 46-52 % of an APPROACH bot's alive time.**
  - Its reasons are real: its holder is down (3 s to respawn, then 3 s of latch), or an enemy is on the slab, which in
    2v2 is most of the time.
  - At a respawn it goes for the slab instead of its post when either reason holds.
  - The trap fix only turns the 22-24 % "held on the slab" into travel and post time.
- **The HOLD bot holds in every build.** Its time to the slab is 16.3-16.6 s, and it stood on the slab in 120/120
  matches.
  - A HOLD bot's slab time per match: shipped Corgi 38.6 s / Cat 40.2 s; trap fix 42.5 / 52.9 s; post in zone 45.1 /
    51.1 s.

## Why the Cats gain when the roles are real (observed, not isolated)
Whenever the APPROACH bot really leaves the slab, these move together:

| Build | Cat share | Cat HOLD on the slab per match, Corgi HOLD | Slot-1 kills of the other slot-1 bot, Cat > Corgi / Corgi > Cat | Died before reaching the slab, Corgi-Cat | Hit rate, Corgi-Cat |
|---|---|---|---|---|---|
| shipped | 58 % | 40.2 s, 38.6 s | 274 / 265 | 282-286 | 29 / 31-32 % |
| trap fix (post 16 m out) | 80 % | 52.9 s, 42.5 s | 352 / 274 | 375-274 | 23-24 / 27-28 % |
| post in zone (4 m off) | 72 % | 51.1 s, 45.1 s | 342 / 300 | 369-313 | 29 / 32 % |
| no roles | 64 % | (both hold) | 313 / 244 | 193-276 | 29 / 32 % |

- **Dose response.** In the W15 trap, the APPROACH bot stands about 1 m inside the edge on its way to the post. Moving
  the post outward raises the Cat share: 1 m inside the edge (the trap) 58 %, 4 m off the edge 72 %, 16 m from the
  centre 80 %.
- **A likely reason, not proven.** With one bot per team on the slab, the slab is decided by more holder-against-holder
  fights. The Cats win more of those (their bots hit 31-32 % against the Corgis' 29 % in every build), and the Corgis
  die more often on their way in.
- None of this can be tuned in this card: no speed change, and no class or weapon.

## How much an n 120 sample can show
- The roles code at 7a671f1 measured behaviour-neutral against no roles (W15 Fisher p 1.0; today p 0.43). Five 2v2
  samples of that build or its equivalent: W15 Sprint C 51-69, W15 A1 52-68, its rerun 53-67, today 50-70, and today's
  no roles 43-77.
- Pooled, that is **351 of 600 Cat wins: 58.5 % (54.5-62.4 %)**.
- If that is the true rate, one n 120 sample lands over 60 % (73 or more Cat wins) about 1 time in 3 (binomial,
  p 0.34).
- So the 2v2 bar sits on the build's own noise. Today's no-roles 64 % fails the bar but does not differ from the
  shipped 58 % (p 0.43).
- The role builds' 72 % and 80 % do differ from it.

## Contest rule: the 1 m edge band
- **`tests/test_bot_contest.gd` x5** on the final copy (bot.gd at 7a671f1 behaviour): PASS 5/5. Edge band 0.8, 1.4,
  1.3, 1.0, 0.4 % (cap 5 %), 80.0 of 80 pet-s on the slab each run.
- **On the post-in-zone candidate,** x3: PASS 3/3, 0.9 % each. In that test an enemy is always on the slab, so
  APPROACH is always stepping on.
- **In real play** (the harness's slab-position line, in the whole percents it prints): shipped 3-4 %, no roles 3 %,
  trap fix 5-6 %, post in zone 5 %. With a role option the bots step off the slab alive 141-198 times per side per
  60 matches, against 0 in the shipped and no-roles builds. Each step off crosses the band.
  - **If a role option is adopted later,** real-play edge-band time sits at the 5 % cap. The guard test does not
    see it.

## Arrival test (written, proven on the candidate, not shipped)
The card wants `test_bot_roles.gd` to check ARRIVAL and KEEPING in play for the chosen option. No option was chosen.
- The shipped bot.gd keeps the trap, so the check would fail on it. The shipped `test_bot_roles.gd` therefore keeps
  W15's checks, and its header points here.
- The check was built and proven on the post-in-zone candidate, so it is ready if the lead picks a role option.
- **Parts 1-3, W15's:** roles by format, intent, and the mid-match rematch reset.
- **Part 4, staged, each team in turn.** The other team stands still at its start slots, out of sight. The bots are
  picked by start slot, not by the role field, so a role swap fails here too.
  - The slot-2 bot must come within 3 m of its post within 30 s and stay there 90 % of the next 8 s, while the slot-1
    bot holds the slab as long.
  - Then a still, unhurt enemy stands on the slab: slot 2 must step on within 6 s.
  - Then the enemy goes home: slot 2 must walk off the slab back to its post within `STEP_ON_MIN` + 6 s and keep it
    90 % of 8 s.
- **Part 5, in play.** A fresh bots-only 2v2 fights for 150 s, with the score held at 0-0.
  - The slot-2 bots must be at their posts at least 6 % of their alive time, and at them or approaching at least 40 %.
  - Floors are from the n 120 runs, per match with both APPROACH bots pooled:
    - the candidate: at the post 8.5-26.6 % (5th percentile 11 %), post or approaching 45-59 % (5th percentile 47.5 %);
    - the trap: at the post 0-12.9 % (95th percentile 3.2 %), post or approaching 14-48 % (95th percentile 35 %).
  - The staged part catches the trap every time; part 5 is the evidence from real play.

| Run (candidate bot.gd + this test) | Part 4 Corgi: arrive / keep / step on / back / keep | Part 4 Cat | Part 5: at post, post or approaching | Result |
|---|---|---|---|---|
| 1 | 16.7 s / 100 % / 1.1 s / 3.9 s / 100 % | 16.8 s / 100 % / 0.8 s / 3.8 s / 100 % | 22 %, 51 % | PASS (45 s wall) |
| 2 | 16.0 s / 100 % / 0.9 s / 4.3 s / 100 % | 16.8 s / 100 % / 0.7 s / 3.6 s / 100 % | 17 %, 53 % | PASS |
| 3 | 16.7 s / 100 % / 1.1 s / 3.9 s / 100 % | 16.8 s / 100 % / 0.8 s / 3.8 s / 100 % | 22 %, 51 % | PASS |
| **Mutant: the trap re-introduced** (`on_slab` = `contains(pos)` only) | arrives 16.0 s, then **not back at its post 9 s after the enemy left (on the slab, 5.4 m from the post)** | **never at its post in 30 s** (its path from the start crosses the slab) | **0 %, 25 %** | **FAIL** (5 lines) |
| **Mutant: roles swapped** (the odd slot APPROACHES) | **never at its post** (slot 2 is HOLD, no post) | **never at its post** | **0 %, 0 %** | **FAIL** (9 lines, including the format checks) |

The candidate files are in the lane's scratchpad: `gbot2-candidate/bot.post-in-zone.gd`,
`test_bot_roles.arrival.gd`, and their `.diff` against 7a671f1.

## Decision
- **Not applied:**
  - the trap fix alone fails the balance bar (80 %);
  - post in zone fails the balance bar (72 %) and the roles bar;
  - no roles fails the balance bar in this sample (64 %) and cannot make "one approaches" true.
- **Kept:** bot.gd at 7a671f1 behaviour. Its 2v2 passes the pooled bar today (58 %).
  - Superseded by § G-BAL: bot.gd now ships aim-height parity (`AIM_EYE` / `AIM_CHEST`); the trap and the nominal
    roles are unchanged.
- **Changed:**
  - the bot.gd roles comment (comment only);
  - balance.gd's role metrics (harness only);
  - the test_bot_roles.gd header (comment only).
- **For the lead, which is outside this card:**
  - keep nominal roles;
  - or drop the roles code (balance-neutral: today p 0.43, W15 p 1.0, and honest code);
  - or first close the holder-against-holder gap and then take a role option. The candidate and its arrival test are
    ready for that.

## Commands
```
G=<Godot 4.7.2>; B="$G --headless --path engines/godot --script res://tests/balance.gd --"
$B --format 2v2 --n 60 --seed 1 --speed 30 --events --trace;  $B --format 2v2 --n 60 --seed 101 --speed 30 --events --trace
$B --format 1v1 --n 40 --seed 1 --speed 30 --events --trace;  $B --format 1v1 --n 40 --seed 101 --speed 30 --events --trace
$G --headless --path engines/godot --script res://tests/run.gd                       # suite
$G --headless --path engines/godot --script res://tests/run.gd -- --only bot_contest  # x5
$G --headless --path engines/godot --script res://tests/run.gd -- --only bot_roles    # with the candidate's files
```
The `SUMMARY 2v2 roles` line has the role table's numbers.

## G-BAL: where the Cat advantage comes from (W17, lane G-BOT2)
**Card.** Root-cause the Cats' 2v2 edge with controlled experiments, then fix it with one allowed change. The
allowed changes are hurt-volume parity, eye or muzzle-height parity, or a respawn-side cover or approach fix with no
new mesh, placement or collider. A speed change is not allowed.

**Short answer.**
- **The edge is small and spread over several things.** The behaviour-neutral builds pool to a 58.5 % Cat win share
  (351 of 600: § "How much an n 120 sample can show" above), but only 51-52 % of held time and 51 % of takedowns.
  - Three species differences each take a little held time back from the Cats in real 2v2: the Cat's eye height
    over its target's aim point, its narrower hitbox, and its faster run.
  - The Cat's held share, against shipped's 51.8 %: aim parity 51.3; plus the hitbox 51.2; plus the run 50.8; all
    three 50.5. That is under a point each, about 1.3 together.
  - None of them alone moves the win share measurably at n 120-240.
  - All three together (aim parity, the Corgi's hitbox and the Corgi's run, accel and decel on the Cat bots) give
    118-122, Cat 50.8 %, held 50.5 % (n 240). That is a diagnostic, it includes a speed change, and it is not a
    significant difference from shipped (p 0.31).
- **The one effect that is large and clean in the lab is the aim geometry in close slab fights.** Two holders on
  opposite edges of the slab: the Cat wins 60 % (n 400). In a 2v2 brawl on the slab: 55 % (n 300).
  - With one aim geometry for both species, those become 51 % and 49 % (Fisher p 0.003 over the 700).
  - That is the fix measured below. It is allowed: eye-height parity, in bot.gd only.
- **Route exposure (b) is real but does not convert.** On the way in, the Corgi bot is in a slab holder's sight
  1.25 s per trip at 20-40 m from the slab; the Cat bot 0.38 s. In play, though, both sides die before reaching the
  slab equally often (282-286 in 120 matches). Kills of victims 12-20 m out are 102-106.

### Builds and harness
- `tests/balance.gd` gains the lab modes `--hitrate`, `--duel2`, `--exposure`, `--standoff`, `--arrival` and
  `--brawl`.
- They use one lab bot per team and species; the match's own bots are frozen and parked.
- `--lab-patch move|hitbox|eye|eyeonly|chestonly` gives the Cats one Corgi attribute. It is a diagnostic only, never
  a fix, and it works on lab bots and, with `--format`, on a match's Cat bots.
  - The eye, eyeonly and chestonly rows below were measured on f1a79c5's bot.gd, which aimed with pet.gd `eye()` and
    `chest()`.
  - Since the fix, every bot aims with the Corgi's heights (`_eye()` / `_aim_point()`), so those three patches change
    nothing on today's bot.gd: `--standoff --n 40 --lab-patch eyeonly` prints the same lines as no patch.
  - `--lab-patch own` gives each lab bot its own species' pet.gd heights back, which is the aim as shipped before
    G-BAL. On today's bot.gd it brings the Cat back to 94 of 160 standoffs (58.8 %), against 82 of 160 with no
    patch.
  - So the old pairs reproduce as `own` against no patch.
  - LabBot overrides both height pairs, and every lab statistic reads the bot's own helpers.
- `--lab-order cat` puts the Cat lab bots first in the tree. Physics runs in tree order; match.gd adds the Corgis
  first.
- All runs use `--speed 30`, `nice -n 10` and at most 2 Godot processes.
- The bot.gd is f1a79c5's unless a row names the fix. The fix is G-BAL's aim parity; "post in zone" is
  `gbot2-candidate/bot.post-in-zone.gd`.

### (a) Hurt volume, eye and aim heights (pet.gd; bots fire from `eye()` at `chest()` — as shipped before G-BAL)
| | Corgi | Cat |
|---|---|---|
| Height (capsule) | 1.20 m | 1.26 m |
| Eye, `eye()` (0.78 h) | 0.936 m | 0.983 m |
| Aim point, `chest()` (0.55 h) | 0.660 m | 0.693 m |
| Hitbox capsule (r + 0.04, h + 0.08) | r 0.40, h 1.28 | r 0.37, h 1.34 |
| Side-on hitbox area | 0.887 m2 | 0.874 m2 (7.5 % narrower, 4.7 % taller) |
| Head band (hits above 0.8 h) | from 0.960 m | from 1.008 m |
| Drop from this shooter's eye to the enemy's aim point | 0.243 m | 0.323 m |
| Rifle muzzle | visual only: bots fire from the eye | visual only |

**One-way fire, (a).** A thinking bot shoots at an unhurt bot that does not think, on level open ground found by
the harness.
- Every shooter species × target species pair is tested at 10, 20 and 30 m.
- Still: both pinned. Moving: both slide sideways in a ±2.5 m lane at their species' run speed.
- 60 trials of 6 s per cell, about 1,870 shots each.
- "Geometry" is 20,000 rays from the shooter's eye at the target's aim point, with the bot's standing cone (rifle
  spread 1.2° + bot.gd AIM_ERROR 2°).

| Distance, stance | Corgi > Corgi | Corgi > Cat | Cat > Corgi | Cat > Cat | Target effect (Corgi target - Cat target) |
|---|---|---|---|---|---|
| 10 m geometry | 80.5 % | 76.7 % | 80.7 % | 76.7 % | +3.9 |
| 10 m still | 78.2 % | 75.3 % | 80.0 % | 76.3 % | +3.3 |
| 10 m moving | 59.0 % | 57.2 % | 60.3 % | 58.2 % | +2.0 |
| 20 m geometry | 22.3 % | 21.9 % | 22.3 % | 22.2 % | +0.3 |
| 20 m still | 23.3 % | 23.1 % | 22.4 % | 22.0 % | +0.3 |
| 20 m moving | 16.6 % | 16.1 % | 16.0 % | 15.9 % | +0.3 |
| 30 m geometry | 9.9 % | 9.5 % | 9.8 % | 9.9 % | +0.2 |
| 30 m still | 11.0 % | 10.9 % | 10.0 % | 9.6 % | +0.3 |
| 30 m moving | 8.2 % | 7.4 % | 6.6 % | 6.6 % | +0.4 |

- **The Cat is harder to hit at 10 m,** by 2-4 points, and not at 20-30 m. Its hitbox is 7.5 % narrower, and at
  10 m the spread cone (0.56 m) is wider than either hitbox, so width counts.
- **The shooter species makes no consistent difference:** the Cat is +1.0 to +1.8 at 10 m and -0.8 to -1.6 at 30 m.

**Two-way duels, (a).** A Corgi and a Cat, both thinking and mortal, on the same two spots, with the species swapped
every other trial.

| Distance | Free (each bot moves itself), n 200 | Still (pinned), n 100 | Moving (lanes), n 100 |
|---|---|---|---|
| 6 m | Corgi 100 - Cat 100 | - | - |
| 10 m | 116 - 84 | 52 - 48 | 65 - 35 |
| 15 m | 95 - 105 | - | - |
| 20 m | 101 - 99 | 56 - 44 | 53 - 47 |
| 30 m | - | 53 - 45 (2 undecided) | 41 - 34 (25 undecided) |

- **On open ground the Cat has no edge in a duel.** Free duels: Corgi 412, Cat 388.
- **With aim parity they are the same:** 416-384.
- The "moving" 65-35 at 10 m is a harness effect. The lanes set the pets' positions each tick, and the second pet in
  tree order (the Cat) then fires at a hitbox that the physics server has not yet moved. This is likely, not proven;
  see the processing order below.

### (b) Route exposure
- A lone bot runs from each of its team's start slots and respawn points to the slab, 3 runs each.
- Every tick the harness checks whether its chest is in the line of sight of an enemy holder's eye. The holder eyes
  are five points on the slab (the centre, and 2 m in towards each corner) at the enemy species' eye height.

| Runner | 60-40 m from the slab's centre | 40-20 m | 20-8 m | 8-0 m | In sight within 60 m, per trip | Last hidden |
|---|---|---|---|---|---|---|
| Corgi (4 points) | 0.00 of 2.09 s | **1.25 of 2.11 s (59 %)** | 1.46 of 1.46 s | 0.55 of 0.55 s | 3.26 s | 31.9 m out |
| Cat (3 points) | 0.00 of 2.28 s | **0.38 of 2.35 s (16 %)** | 1.57 of 1.57 s | 0.40 of 0.40 s | 2.35 s | 23.2 m out |

- **The Corgis' way in is open from 32 m out; the Cats' from 23 m.** Both are fully in sight over the last 20 m.
- **It does not convert in play** (W17 shipped, 120 matches):
  - died before reaching the slab: Corgi 282, Cat 286;
  - victims killed 12-20 m from the slab: by Corgis 102, by Cats 106;
  - kills from 15-25 m: 193-94 in the Corgis' favour.

### (c) Holder standoff, holder against an attacker, and a 2v2 brawl
- **Standoff.** A Corgi and a Cat stand on opposite slab edges, 1 m inside (z = -3 and +3, ground -0.047 / -0.045:
  flat). Both are thinking and mortal. They face each other, or face away, and the sides are swapped. n 100 per
  condition.
- **Arrival.** One species holds in the slab's middle; the other starts 16 m out on its own way in. n 200 per role.
- **Brawl.** Two of each species start on the slab as in test_bot_contest.gd, with no respawns. n 300.

| Scenario (n) | Cat wins, as shipped | Cat wins, the Cat's aim geometry set to the Corgi's (eye 0.936, aim 0.660) |
|---|---|---|
| Standoff, facing each other, Corgi on its own side (100) | 58 | 47 |
| Standoff, facing each other, sides swapped (100) | 54 | 44 |
| Standoff, facing away, own sides (100) | 61 | 52 |
| Standoff, facing away, sides swapped (100) | 66 | 60 |
| **Standoff, all (400)** | **239 (59.8 %, p < 0.001 vs even)** | **203 (50.8 %)** |
| Brawl 2v2 on the slab (300) | 166 (55.3 %) | 146 (48.7 %) |
| **Slab fights together (700)** | **405 (57.9 %)** | **349 (49.9 %); Fisher p 0.003** |
| Arrival, both roles (400) | 190 (47.5 %): the attacker wins 59-64 % either way | 191 (47.8 %) |

**What decides the standoff:**
- The gap shrinks to 1.7-2.3 m, and both bots hit 99-100 % of the shots they fire.
- What differs is how often they can fire. bot.gd fires only when its aim is within FIRE_CONE (0.12 rad) of the
  target's chest. At 2 m the aim is outside it in about 90 % of the frames the bot is otherwise ready.
- The Cat looks 0.32 m down to a Corgi's chest; the Corgi only 0.24 m down to a Cat's. The steeper line keeps the
  target's sideways motion a smaller angle.
- Pooled over the four conditions, the Cat's aim is inside the cone in 9.7 % of its ready frames and the Corgi's in
  8.8 %: about 10 % more shots.
- With one geometry the shares are 9.3 % and 9.2 %. This mechanism is likely, not proven; the outcome numbers are
  measured.

**Diagnostics on the standoff** (n 400 each, Cat wins):

| Change on the Cat bots | Cat wins |
|---|---|
| none | 59.8 % |
| the Corgi's run, accel and decel | 61.5 % |
| the Corgi's hitbox | 59.5 % |
| the Corgi's eye only | 56.5 % |
| the Corgi's aim point only | 56.0 % |
| the Corgi's eye and aim point | **50.8 %** |
| all three | 48.8 % |

Each half alone removes 3.3-3.8 points; both together remove 9.0.

**Processing order.**
- With the lab Cats first in the tree, the standoff Cat share rises from 59.8 % to 65.3 %, +5.5 points, Fisher p
  0.13.
- So, likely: whoever runs first in a physics frame has a small edge.
- In match.gd the Corgis are added first, so if anything this favours the Corgis. It is not the cause, and it is not
  an allowed fix. It would be a pet.gd or match.gd matter: hitboxes follow their pets only at the transform flush
  after all scripts ran.

### Where real 2v2 kills happen (2v2 logs)
On the slab means the victim is at most 5 m from the slab, as the log prints it. Each cell is Corgi kills - Cat
kills.

| Victim, killer-to-victim gap | W17 shipped, n 120 (gbot2-out/v0, 7a671f1) | G-BAL shipped, same seeds, n 240 (m/s) | Shipped + aim parity, n 240, 4298 kills (m/sf) |
|---|---|---|---|
| on the slab, under 6 m | 117-176 (Cat 60 %) | 269-337 (Cat 56 %) | 249-369 (Cat 60 %) |
| on the slab, 6-12 m | 357-419 (Cat 54 %) | 694-885 (Cat 56 %) | 729-840 (Cat 54 %) |
| on the slab, 12 m and more | 300-246 (Cat 45 %) | 609-451 (Cat 43 %) | 606-465 (Cat 43 %) |
| off the slab | 276-246 (Cat 47 %) | 535-522 (Cat 49 %) | 528-512 (Cat 49 %) |

- **The Cats' edge is close-range kills of pets on the slab.**
- **Aim parity removes it in the lab scenarios, but not measurably in real matches.** On the same seeds, close slab
  kills go from 56 % to 60 % Cat with the fix (Fisher p 0.15, noise), and the 6-12 m kills from 56 % to 54 %.
- Real slab fights come with arrivals, crowding and reinforcements, which the standoff and brawl do not reproduce.

### Real 2v2: the fix and the diagnostics (continuous measures)
Continuous measures from the MATCH lines, mean ± standard error over matches. The diagnostic rows add Corgi attributes
to the Cat bots on top of the fix (seeds 1-60 and 101-160 unless the row says otherwise).

| Build | Cat wins | Cat share of held time | Cat share of takedowns | Margin, Corgi - Cat | Hit rate, Corgi / Cat |
|---|---|---|---|---|---|
| shipped (n 240, seeds 1-120 and 101-220) | 55.8 % | 51.8 ± 0.6 % | 51.2 ± 0.4 % | -3.5 ± 1.1 | 28.8 / 31.3 % |
| shipped + aim parity, **the fix** (n 240) | 56.7 % | 51.3 ± 0.6 % | 50.9 ± 0.4 % | -2.6 ± 1.2 | 29.3 / 31.6 % |
| + the Corgi's hitbox on the Cats (diagnostic, n 120) | 63.3 % | 51.2 ± 0.9 % | 51.2 ± 0.5 % | -2.8 ± 1.7 | 29.2 / 31.0 % |
| + the Corgi's run, accel, decel on the Cats (diagnostic, not allowed, n 120) | 57.5 % | 50.8 ± 0.7 % | 51.0 ± 0.4 % | -1.9 ± 1.4 | 28.8 / 31.2 % |
| + both (diagnostic, not allowed, n 240: seeds 1-60, 101-160, 201-260, 301-360) | 50.8 % | 50.5 ± 0.6 % | 50.7 ± 0.3 % | -1.2 ± 1.2 | 29.5 / 30.9 % |
| post in zone (W17, n 120) | 72.5 % | 53.6 ± 0.8 % | 52.0 ± 0.4 % | -7.6 ± 1.5 | 28.8 / 31.9 % |
| post in zone + aim parity (n 240) | 62.5 % | 52.2 ± 0.5 % | 51.3 ± 0.3 % | -4.8 ± 1.1 | 29.5 / 32.2 % |

- **No arm differs from shipped by a significant amount.**
  - The fix: Fisher p 0.93; paired on the same seeds, McNemar p 0.67 and 0.88.
  - All three Corgi attributes on the Cats: wins p 0.31, held time z -1.5.
- **Only the pair of role builds differs:** post in zone 72.5 % against 62.5 % with the fix (Fisher p 0.06; held time
  z -1.4).
- **The hit-rate gap (Cats about 2 points higher) survives every arm.** It is a result of where each side fights, not
  a cause. In every build the Cats win the kills at 4-12 m (55-59 %; slot-1 bot against slot-1 bot on the slab
  57-70 %), and the Corgis win the kills at 12 m and more (60-79 %). Hit rates are far higher at short range.

### Root cause, as far as these samples reach
1. **Close slab fights: the aim geometry.** In the lab this is large and clean: the Cat wins 58 % of standoffs and
   brawls, 50 % with one aim geometry (n 700, p 0.003). It is the only one of the three that an allowed change
   reaches.
2. **The rest is the species package.** In real 2v2 the Cat's narrower hitbox (2-4 points harder to hit at 10 m) and
   its faster run, accel and decel add up with (1). Only all three on the Corgi's numbers bring shipped 2v2 to 50.8 %
   (held 50.5 %).
   - That needs a movement change, which this card forbids.
   - Even so, it is not a significant difference from shipped at n 240.
3. **Not causes:**
   - route exposure (it does not convert);
   - spawn and trip timing (the Corgis are first in 229-232 of 240 matches; trips level);
   - processing order (it favours the Corgis);
   - which side of the slab a pet stands on (standoffs with the sides swapped).

### The fix: aim-height parity (bot.gd only)
- **What it is.** Every bot looks, checks line of sight and fires from 0.936 m over its feet (`AIM_EYE`). It aims
  0.66 m over its target's feet (`AIM_CHEST`). Both are the Corgi's pet.gd `eye()` and `chest()`.
- **What changes.**
  - The Cat bots' eye drops 4.7 cm.
  - Every bot's aim point on a Cat drops 3.3 cm.
  - The human's own aim and shots are unchanged (player.gd:107 fires from the camera).
  - The bots in a human match change as described: Cat bots look, check sight and fire 4.7 cm lower, and every bot
    (your Corgi ally included) aims 3.3 cm lower on a Cat.
  - Movement, routes, slots, pet.gd, match.gd and tuning.gd are unchanged.
- **Where.**
  - bot.gd:14-22: the constants and their comment.
  - :157 and :159: aim tracking.
  - :199: the view check in `_think`.
  - :291-296: `_eye()` and `_aim_point()`.
  - :299: `_los`.
  - :308 and :314: the fire cone and the shot origin.
- **Proof: `tests/test_bot_roles.gd` parts 4 and 5 pin all six sites.**
- **Part 4 pins the aim tracking (bot.gd:157).** A Corgi bot and a Cat bot stand 3 m apart on the slab, each aiming
  at the other while it stands still.
  - The fix: -0.0907 and -0.0928 rad, 0.0021 apart (max 0.008).
  - Mutant "bot.gd as shipped": 0.0284 apart, FAIL.
  - Mutant "aim tracking back on `eye()` / `chest()`": 0.0284 apart, FAIL.
- **Part 5 pins the constants, the helpers and the other four sites.**
  - `AIM_EYE` and `AIM_CHEST` must equal the Corgi's pet.gd eye and chest (0.78 and 0.55 of `T.height(CORGI)`).
  - For a Corgi bot and a Cat bot, `_eye()` must be `AIM_EYE` over the feet and `_aim_point()` `AIM_CHEST`.
  - A spy bot whose `_eye()` is lifted then faces a still enemy 5 m away on the slab, three times:
    - lifted 61 m: it must not see the enemy (the view check, :199);
    - lifted 3 m under a test-only plate that blocks only the lifted line: it must not see it (`_los`, :299);
    - lifted 3 m in the open: it must fire and hit (the FIRE_CONE `to`, :308, and the shot origin, :314).
  - The fix: not seen, not seen, then 6 shots and 6 hits.
- **Part 5 mutants, each made in a copy and restored with `cmp`:**
  - M1, shot origin back to `eye()`: 6 shots, 0 hits, FAIL.
  - M4, `_los` back to `eye()` / `chest()`: the spy sees through the plate, FAIL.
  - M5, cone `to` back to `chest() - eye()`: 0 shots, FAIL.
  - M6, view check back to `chest() - eye()`: the spy sees the enemy from 61 m up, FAIL.
  - M7, `AIM_EYE` drifted to 0.95: part 4 still passes, and part 5 FAILS on the constant.
- **Runs on HEAD 36df32f plus these files:** `test_bot_roles` PASS; `test_bot_contest` x2 PASS (edge band 2.5 % and
  1.0 %); the full suite 24/24 PASS.

### Measured: shipped against the fix, and post in zone with the fix (2v2 seeds 1-120 and 101-220; 1v1 seeds 1-40 and 101-140)
| Build | Format | Seeds | n | Corgi | Cat | Draws | Cat share (95 % Wilson CI) | Margin | Held, Corgi-Cat | First, Corgi / Cat / tie | Trip, Corgi / Cat |
|---|---|---|---|---|---|---|---|---|---|---|---|
| shipped | 2v2 | 1-120 | 120 | 59 | 61 | 0 | 51 % (42-60 %) | -2.0 | 6497-6738 s | 113 / 5 / 2 | 16.5 / 16.6 s |
| shipped | 2v2 | 101-220 | 120 | 47 | 73 | 0 | **61 % (52-69 %)** | -5.0 | 6247-6824 s | 116 / 4 / 0 | 16.5 / 16.6 s |
| shipped | **2v2** | **both** | **240** | **106** | **134** | **0** | **56 % (50-62 %)** | **-3.5** | **12744-13562 s (51.6 % Cat)** | **229 / 9 / 2** | **16.50 / 16.60 s** |
| shipped + fix | 2v2 | 1-120 | 120 | 55 | 65 | 0 | 54 % (45-63 %) | -1.0 | 6474-6606 s | 113 / 5 / 2 | 16.6 / 16.6 s |
| shipped + fix | 2v2 | 101-220 | 120 | 49 | 71 | 0 | 59 % (50-68 %) | -4.2 | 6257-6754 s | 116 / 4 / 0 | 16.6 / 16.6 s |
| shipped + fix | **2v2** | **both** | **240** | **104** | **136** | **0** | **57 % (50-63 %)** | **-2.6** | **12731-13360 s (51.2 % Cat)** | **229 / 9 / 2** | **16.60 / 16.60 s** |
| post in zone + fix | 2v2 | 1-120 | 120 | 41 | 79 | 0 | **66 % (57-74 %)** | -6.6 | 6221-6981 s | 116 / 3 / 1 | 16.6 / 16.5 s |
| post in zone + fix | 2v2 | 101-220 | 120 | 49 | 71 | 0 | 59 % (50-68 %) | -3.0 | 6416-6787 s | 116 / 1 / 3 | 16.5 / 16.5 s |
| post in zone + fix | **2v2** | **both** | **240** | **90** | **150** | **0** | **62.5 % (56-68 %)** | **-4.8** | **12637-13768 s (52.1 % Cat)** | **232 / 4 / 4** | **16.55 / 16.50 s** |
| shipped (W17) | 1v1 | both | 80 | 41 | 39 | 0 | 49 % (38-60 %) | +0.5 | 4507-4424 s | 78 / 0 / 2 | 16.10 / 16.35 s |
| shipped + fix | 1v1 | 1-40 | 40 | 23 | 17 | 0 | 42 % (29-58 %) | +1.2 | 2262-2189 s | 39 / 0 / 1 | 16.1 / 16.3 s |
| shipped + fix | 1v1 | 101-140 | 40 | 21 | 19 | 0 | 48 % (33-63 %) | +0.9 | 2251-2198 s | 39 / 0 / 1 | 16.1 / 16.3 s |
| shipped + fix | **1v1** | **both** | **80** | **44** | **36** | **0** | **45 % (35-56 %)** | **+1.1** | **4513-4387 s (49.3 % Cat)** | **78 / 0 / 2** | **16.10 / 16.30 s** |
| post in zone + fix | 1v1 | both | 80 | 44 | 36 | 0 | 45 % (35-56 %) | +1.1 | 4513-4387 s | 78 / 0 / 2 | 16.10 / 16.30 s |

- **2v2.**
  - Shipped against the fix: Fisher p 0.93.
  - Paired on the same seeds: the same winner in 70 and 76 of 120; flips Corgi→Cat 27 / Cat→Corgi 23 (McNemar p
    0.67) and 21 / 23 (p 0.88).
  - Binomial against even: shipped p 0.08, the fix p 0.045, post in zone + fix p < 0.001.
  - **"No measurable effect" is all this sample can say; it does not show the effect is zero.** n 240 can detect
    about 12.7 points unpaired, or 11.3 paired.
  - The paired difference is +0.8 points toward the Cat (95 % CI -7.1 to +8.8).
  - Pairing is weak here because a 2v2 seed does not replay across processes (balance.gd header), so the McNemar
    values are valid but carry little information. 1v1, the standoff and the brawl do replay exactly.
- **Seeds 101-120 run in both blocks, as the card asks.** The same winner came out in 12 / 16 / 19 of the 20 (shipped
  / fix / post in zone + fix). Without the second copy (n 220) the shares are 54.5 / 55.9 / 64.1 %.
- **1v1.** The roles never act in 1v1, so the fix is the only change. Against the W17 shipped run on the same seeds:
  65 of 80 winners the same, flips 6 / 9 (McNemar p 0.69 and 1.0).

**The bar.**
- Shipped + fix: neither side over 60 % in either format or in any seed block (2v2 54 % and 59 %; 1v1 42 % and
  48 %).
  - Shipped itself, this run: one block at 61 %.
  - The difference between the two is noise.
- Post in zone + fix fails: 62.5 % pooled, and the 1-120 block at 66 %.

**The role bar** (APPROACH at its post at least 20 % of its alive time, and at its post or approaching at least
50 %). It is unchanged since it was set before any role build's n 120 run: travel alone gives a trapped bot 27 %
post-or-approaching, so arrival has to be measured too.

| Post in zone + fix, n 240 | At its post | Post or approaching | Stepping on | Spawn-to-post | One on the slab, one out (of both-alive time) |
|---|---|---|---|---|---|
| Corgi APPROACH (seeds 1-120 / 101-220) | 16.2 % / 16.2 % | 50 % / 51 % | 49 % / 47 % | 19.8 s (597 lives) | 30 % |
| Cat APPROACH | 18.4 % / 17.5 % | 53 % / 52 % | 46 % / 47 % | 19.6 s (652 lives) | 31 % |

- **Post or approaching passes; at the post fails** (16-18 % against 20 %), as before the fix (15-18 %).
- Balance fixes do not move it. Stepping on, which takes half of an APPROACH bot's life, is what keeps it under 20 %.
- In real play the edge band is 5 % with a role option (the APPROACH bots step off the slab 284-342 times per side per
  120 matches) and 3-4 % without.
- The arrival test passes on post in zone + fix: at its post in 16.0 / 16.8 s, kept 100 %, back at its post in
  4.3 / 3.6 s; in play 20 % at the post, 56 % at it or approaching.

### Decision
- **The fix (aim-height parity, bot.gd) is ready to land.**
  - **The reason to adopt is the lab asymmetry:** it removes the one clean asymmetry the lab finds (close slab
    fights, 58 % → 50 %).
  - It keeps both formats under 60 % in every seed block. But the 101-220 block is 71 of 120 (59.2 %), one match
    under the bar.
    - Shipped's 61 % block (73 of 120) is noise of the same size, and seeds do not replay across processes
      (balance.gd header). So the blocks are not the reason to adopt.
  - It changes no movement, route or slot.
  - In whole shipped matches its effect is inside the noise.
- **Post in zone is not adopted.** With the fix it still fails both bars: 2v2 62.5 %, and at its post 16-18 %.
  Nothing new went into `gbot2-candidate/`.
- **What would close the rest is outside this card:**
  - the Cat's run, accel and decel (a movement change, not allowed), or a design call on the species trade;
  - for the roles, a step-on rule that leaves the APPROACH bot at its post more than 80 % of the time it is not
    travelling.

### Commands (G-BAL)
```
B="$G --headless --path engines/godot --script res://tests/balance.gd --"
$B --hitrate --n 60 --secs 6 --dists 10,20,30 --speed 30;   $B --duel2 --n 100 --dists 10,20,30 --speed 30
$B --duel2 --stance free --dists 6,10,15,20 --n 200 --speed 30 [--lab-patch eye]
$B --exposure --n 3 --speed 30;   $B --standoff --n 100 --speed 30 [--lab-patch move|hitbox|eye|eyeonly|chestonly] [--lab-order cat]
$B --arrival --n 200 --speed 30 [--lab-patch eye];   $B --brawl --n 300 --speed 30 [--lab-patch eye]
# The [--lab-patch eye|eyeonly|chestonly] rows reproduce only on f1a79c5's bot.gd. On today's bot.gd use
# --lab-patch own (the pre-G-BAL aim) against no patch.
$B --format 2v2 --n 120 --seed 1 --speed 30 --events --trace;   $B --format 2v2 --n 120 --seed 101 --speed 30 --events --trace
$B --format 2v2 --n 60 --seed S --speed 30 --events --trace --lab-patch hitbox,move   # diagnostic only
$G --headless --path engines/godot --script res://tests/run.gd -- --only bot_roles   # parts 4-5: aim parity, every aim site
```
