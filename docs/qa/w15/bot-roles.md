# W15 Sprint C: contest guard, 2v2 roles, rematch reset (lane G-BOT)

**Build:** HEAD 816489c plus the working tree's `engines/godot/**` (other lanes' HUD edits included), with this
lane's bot.gd, tests/balance.gd, test_bot_contest.gd and test_bot_roles.gd.
- `match.gd` and `tuning.gd` are untouched. The role comes from the pet meta `slot` that `start_match()` sets.
- Runs used at most 2 Godot processes at once.
- The harness does not replay a seed exactly across processes (docs/qa/w15/bot-route.md, Reproducibility), so each
  seed block is an independent sample.

## (7) Contest guard: `tests/test_bot_contest.gd`
**Setup.**
- The four bots of a bots-only 2v2 stand on the slab, two per side, and fight there for 20 s of game time.
- Everyone is kept unhurt (shield), so the fight never ends and nobody leaves for a spawn.
- **Measure:** the share of on-slab time spent in the 1 m edge band (inside slab.gd `contains()`, less than 1 m from
  an edge).
- **FAIL** if the share is over 5 %.
- The test takes about 7-14 s of wall time (boot included).

**Ten runs each**, separate processes:

| bot.gd | Edge-band share, 10 runs | Max | Result |
|---|---|---|---|
| shipped (`_hold_inside()`, `SLAB_MARGIN` 1.0, `EDGE_LOOK` 1.2) | 0.2, 0.4, 0.9, 0.9, 0.9, 0.4, 0.8, 0.9, 0.4, 0.4 % | 0.9 % | 10/10 PASS |
| mutation: no `_hold_inside()` call | 19.2, 19.6, 19.2, 31.6, 28.6, 27.3, 16.5, 16.5, 31.6, 16.5 % | 31.6 % | 10/10 FAIL |
| mutation: `SLAB_MARGIN` 0 (the 1 m inside rule gone) | 17.5, 17.5, 17.5, 17.5, 17.5, 14.2, 10.4, 15.2, 18.4, 17.5 % | 18.4 % | 10/10 FAIL |

**`EDGE_LOOK` 0.8 → 1.2 m.** The one bot.gd number changed for the guard. With 0.8 m (W14), six runs gave 1.0-2.9 %
(max 2.9 %); with 1.2 m, six runs gave 0.5-1.7 %. 1.2 m keeps the shipped share well under the 5 % cap. It is how
far ahead `_hold_inside()` looks before it cuts a wish heading for the edge. **0.8 m also passes the guard** (the
checker measured 2.3 %), so the guard does not pin `EDGE_LOOK`; 1.2 m is headroom, not a fix the test demands.

**The on-slab floor (lead's must-fix).** The test also fails if the bots stand on the slab under 95 % of their time,
76 of the 80 pet-s (shipped: 80.0). The old floor was 20 pet-s, so a bot that walked off a contested slab passed.
Mutant (bot.gd: APPROACH ignores the step-on latch, and the trap is fixed so it can leave): 41.7 pet-s on the slab,
edge band 4.2 % (under the 5 % cap, so only the floor catches it): **FAIL**. Shipped: 80.0 pet-s, 0.9 %: PASS.

**This test is not real play.** In it four unhurt bots fight on the slab and nobody arrives or leaves. In the 2v2
balance runs (n 120, the per-match slab-position line) bots spend **3-4 % of their slab time in the edge band**
(Corgi 4 %, Cat 3 %, both seed sets; 1v1 1-2 %): arrivals cross the band, and fights pull a bot to it. The 17 % and
1 % in docs/handoff/G-BOT.md section 11 are a third scenario, `balance.gd --holder` (one Cat bot attacks an idle
Corgi); the test's header now says so.

## (8) 2v2 roles (bot.gd)
**The rule.**
- When a team has two bots, the bot in the even start slot APPROACHES and the other HOLDS.
- A team's single bot (1v1, or your ally in a human 2v2) HOLDS, so 1v1 is unchanged.
- No classes and no second weapon.

**HOLD:** as before, sprint to the slab and hold it inside the margin.

**APPROACH:**
- **The post:** 16 m (flat) from the slab's centre, on the enemy's way in. That is the nav path from the enemy
  team's first respawn point to the slab.
- **At the post:** it faces back down that path and fights whatever comes along it.
- **Stepping on:** it goes onto the slab, and stays at least 3 s, when no teammate is alive to hold it or an enemy
  stands on it.

### Balance (bots-only, seeds 1-60 / 101-160 for 2v2, 1-40 / 101-140 for 1v1)
- First = the side that reached the slab first, Corgi / Cat / tie (a tie is within 0.1 s).
- Margin = Corgi score minus Cat score.
- Margin, held and trip are one run's values.

| Format | Seeds | n | Corgi | Cat | Draws | Cat share (95 % Wilson CI) | Margin | Held, Corgi-Cat | First | Trip, Corgi / Cat |
|---|---|---|---|---|---|---|---|---|---|---|
| 2v2 | 1-60 | 60 | 27 | 33 | 0 | 55 % (42-67 %) | -2.6 | 3191-3349 s | 57 / 2 / 1 | 16.5 / 16.6 s |
| 2v2 | 101-160 | 60 | 24 | 36 | 0 | 60 % (47-71 %) | -5.7 | 3080-3402 s | 57 / 3 / 0 | 16.5 / 16.6 s |
| **2v2** | **both** | **120** | **51** | **69** | **0** | **58 % (49-66 %)** | **-4.1** | **6271-6751 s (51.8 % Cat)** | **114 / 5 / 1** | |
| 1v1 | 1-40 | 40 | 22 | 18 | 0 | 45 % (31-60 %) | +1.2 | 2274-2198 s | 39 / 0 / 1 | 16.1 / 16.3 s |
| 1v1 | 101-140 | 40 | 20 | 20 | 0 | 50 % (35-65 %) | +0.1 | 2242-2218 s | 39 / 0 / 1 | 16.1 / 16.3 s |
| **1v1** | **both** | **80** | **42** | **38** | **0** | **48 % (37-58 %)** | **+0.7** | **4516-4416 s (49.4 % Cat)** | **78 / 0 / 2** | |

- **The bar holds on the pooled n.** Neither side is over 60 %: 2v2 Cat 58 %, 1v1 Cat 48 %.
- **Per seed set,** 2v2 seeds 101-160 are at the line, 60 %.
- **Against the A1 build without roles:** 2v2 52-68 and 53-67 (Fisher p 1.0 and 0.90). Against an even split, the
  roles 2v2 gives p 0.12.
- **No tuning change was made:** the rule calls for one only over 60 %.
- **1v1 is unaffected:** 42-38 here, 42-38 for the A1 build, the same wins and the same held share (49.4 % Cat).

### Each role (2v2, n 120, from the harness's per-role lines)
| Team, role | Time to slab (lives that reached it) | Matches it stood on the slab | On the slab, per match | At its post, per match | Kills / deaths |
|---|---|---|---|---|---|
| Corgi HOLD | 16.3 s (471 of 648 lives) | 120/120 | 37.8 s | - | 543 / 531 |
| Corgi APPROACH | 16.8 s (383 of 666) | 120/120 | 31.9 s | 0.8 s | 505 / 548 |
| Cat HOLD | 16.6 s (426 of 633) | 120/120 | 39.2 s | - | 548 / 515 |
| Cat APPROACH | 16.6 s (433 of 650) | 120/120 | 36.4 s | 0.1 s | 531 / 533 |

**Both roles reach the slab:** every role stood on it in 120 of 120 matches.

**Status (lead ruling, end of Sprint C).**
- **Item 8: NOT MET (roles nominal in play).** "One bot holds, one approaches" does not happen in play: the APPROACH
  bot is at its post under 1 % of its alive time (0.8 s / 0.1 s per match; the checker measured 0-2.4 %). The cause
  is a trap in bot.gd, not the step-on rule: `_hold_inside()` clamps an APPROACH bot whose post lies past the slab
  onto the slab (see "Roles are nominal" below).
- **The roles code stays (lead ruling).** By measurement it changes nothing (against the A1 build without roles,
  Fisher p 1.0), it carries the tested rematch reset, and the trap card builds on it. It is not done and not met.
- **The shipped bar holds.** 2v2 pooled n 120 is 51-69 (Cat 58 %), 1v1 pooled n 80 is 42-38 (Cat 48 %), and both
  roles stood on the slab in 120 of 120 matches.
- **The trap fix is the NEXT card, not this sprint.** That card fixes the trap alone, then tries the two options
  (drop the roles, or a post inside the 6 m contest zone). Each gets its own 2v2 n 120 / 1v1 n 80 measurement.

### Roles are nominal: why, and what was tried
**Why.** The shipped APPROACH bot almost never reaches its post: it is there under 1 % of its alive time (0.8 s /
0.1 s per match; the checker measured 0-2.4 %). The reason is mostly a bot.gd defect, not the step-on rule. The post
lies 16 m beyond the slab on the enemy's side, so the way there crosses the slab. On the slab, `_steer()` aims
straight at the goal and `_hold_inside()` cuts every wish that would leave the 1 m margin, so a bot whose goal is
off the slab is held there.

A probe over 6 bots-only 2v2 matches split the shipped APPROACH bots' 1378 s alive into:

| Share of alive time | What the bot was doing |
|---|---|
| 51 % | stepping on |
| 20 % | on the slab, held there while heading for its post |
| 29 % | off the slab, on its way to the post |
| 0 % | within 3 m of its post (this probe; the harness's per-role line gives 0.8 s / 0.1 s per match, under 1 %) |

My earlier "an enemy holder is usually on the slab, so it steps on" was not the reason.

**Tried once (the lead's ruling, in a scratch copy):**
- **The step-on rule:** APPROACH steps on only when no living teammate stands on the slab, or an enemy does (lost or
  contested). Otherwise it keeps its post.
- **The fix it needs:** on the slab with a goal off it, the bot steers as off the slab, so `_hold_inside()` no longer
  holds it. Without that, no step-on rule can reach the post.
- **A staged check** (the Corgi holder alone on the slab, Cats frozen away) showed the bot reaching its post and
  staying.

| Format | Seeds | n | Corgi | Cat | Draws | Cat share (95 % CI) | Margin | Held, % Cat | First, Corgi / Cat / tie |
|---|---|---|---|---|---|---|---|---|---|
| 2v2 | 1-60 | 60 | 22 | 38 | 0 | 63 % (51-74 %) | -4.8 | 52.0 % | 60 / 0 / 0 |
| 2v2 | 101-160 | 60 | 14 | 46 | 0 | 77 % (65-86 %) | -9.3 | 54.0 % | 60 / 0 / 0 |
| **2v2** | **both** | **120** | **36** | **84** | **0** | **70 % (61-77 %)** | **-7.0** | **53.0 %** | **120 / 0 / 0** |
| 1v1 | both | 80 | 41 | 39 | 0 | 49 % (38-60 %) | +0.6 | 49.4 % | 79 / 0 / 1 |

| Bar | Result |
|---|---|
| Pooled 2v2 at most 60 % for either side | **fails**: Cat 70 % (Fisher p 0.06 against the shipped roles' 51-69) |
| APPROACH within 3 m of its post at least 20 % of its alive time | **fails**: 6-9 % (Corgi 7 % and 6 %, Cat 8 % and 9 % per seed set) |
| Both roles stood on the slab in at least 90 % of matches | passes: 120/120 for all four |
| 1v1 unchanged | passes: 41-39 (shipped roles 42-38) |

**Decision:** two bars fail, so the attempt is not taken. bot.gd keeps its rule, its trap and its tests. Only the
roles comment in bot.gd was corrected to name the trap (comment only, lead ruling). This was the single extra change,
and Sprint C stops here.

**What it shows:**
- Once it can leave the slab, APPROACH still keeps its post only 6-9 % of the time.
- The post only matters after a won wave, while the teammate holds alone. The rest of a life is travel (about 16 s
  per life) and fights at the slab.
- Sending a bot off the slab costs its team held time and the reinforcement race, and the Cats gained most.

**NEXT card (not done; the lead ruled no trap fix this sprint):**
1. **Fix the trap on its own:** an APPROACH bot on the slab whose goal is off it can walk off to its post. It is a
   defect whatever the role rule. Measure it alone: 2v2 n 120 (seeds 1-60 and 101-160) and 1v1 n 80 (seeds 1-40 and
   101-140), against the same bars.
2. **Then one of two options, each with its own n 120 / n 80 measurement:**
   - drop the roles (every bot HOLDS);
   - or give APPROACH a post inside the 6 m contest zone.

## (9) Rematch: `tests/test_bot_roles.gd`
**What it checks.**
- Roles by format, using match.gd's own `_spawn_pets` and `start_match`:
  - 1v1: HOLD / HOLD;
  - you + a Corgi bot against two Cat bots: Corgi HOLD, Cats HOLD + APPROACH;
  - bots-only 2v2: HOLD + APPROACH on each side.
- APPROACH finds its post (16 m out) within 2 s and heads there. **This checks intent, not arrival:** the role,
  the post and the goal. It does not show that the bot reaches or keeps its post, and in play it does not (item 8 NOT
  MET).
- **The rematch.**
  - A bots-only 2v2 plays 30 s; all 4 bots leave their start state (targets, timers, posts, deaths).
  - **At 28 s each team's HOLD bot is killed** (respawn takes 3 s), so its APPROACH teammate steps on with its holder
    down. The APPROACH bots are kept unhurt from 25 s so they are alive to do it. The test checks the step-on latch is
    set before the rematch. Before this, the latch was set only when play happened to set it, so a respawn that
    forgot to reset it failed in some runs and passed in others.
  - Then `game.rematch()`.
  - Every bot must equal its start-of-match state: alive, full HP, on its start slot, same role, no target, every
    think timer and latch at its start value, no post and no post facing (`push_look`, added), and a goal on the slab
    with the nav agent's target on it.
- bot.gd `respawn()` (which `start_match` runs for every pet) now resets all of it.

**Results.**
- 6 runs: 4 of 4 bots match the start state after the rematch; PASS, 9-10 s wall.
- **Mutation:** respawn without the new resets. It FAILS with all 4 bots, e.g. "lost 10.8 (start 0.0), heard
  CorgiBot2 (start null), burst 2 (start 6), strafe -1.0 (start 1.0)".
- **With the HOLD kill:** shipped PASS (4 of 4 match). Mutant "respawn does not reset `_step_on_t`": FAILS for both
  APPROACH bots, "step_on_t 3.0 (start 0.0)". Before the kill, the checker's runs of the step-on mutants failed on
  one bot only, whichever APPROACH bot play had left stepping on. Now the latch is set on both bots by construction.
- **`push_look`:** the checker's mutant "respawn does not reset `push_look`" passed the old test. It is now in the
  asserted state, and the Sprint C confirm check re-ran that mutant: it FAILS test_bot_roles for both APPROACH bots
  (Corgi Bot 2 and Cat Bot 2: "push_look (0.68, 0.0, 0.73) (start (0.0, 0.0, 0.0))").

## Suite
On a copy of the whole working tree, `tests/run.gd` **23/23 PASS** at the first Sprint C round, including
test_bot_contest, test_bot_roles and the HUD lane's tests (soak 18-23); **24/24 PASS** at the patched Sprint C tree
(test_game_fall added), run by the confirm check.

## Commands
```
G=<Godot 4.7.2>; B="$G --headless --path engines/godot --script res://tests/balance.gd --"
$B --format 2v2 --n 60 --seed 1 --speed 30 --events --trace;  $B --format 2v2 --n 60 --seed 101 --speed 30 --events --trace
$B --format 1v1 --n 40 --seed 1 --speed 30 --events;          $B --format 1v1 --n 40 --seed 101 --speed 30 --events
$G --headless --path engines/godot --script res://tests/run.gd -- --only bot_contest   # x10, and x10 per mutation
$G --headless --path engines/godot --script res://tests/run.gd -- --only bot_roles
```
The harness prints a `roles ·` line per 2v2 match and a `SUMMARY 2v2 roles` line.
