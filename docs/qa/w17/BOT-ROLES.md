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
- Held = seconds alone on the slab (scored).
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
