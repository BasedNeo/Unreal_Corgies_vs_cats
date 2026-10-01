# W14 SAMPLE: bots-only win split on the integrated build (lane G-BOT)

**Build:** a private copy of HEAD 3b9b956 plus two working-tree files:
- G-MOVE's `engines/godot/game/match.gd`: respawns at the equal-time band, start slots at equal straight-line sprint
  time;
- G-BOT's `engines/godot/game/bot.gd`: sprint to the slab, ledge jump 0.45 m, hold inside the slab's margin.

**Harness:** `engines/godot/tests/balance.gd`, `--speed 30` (60 Hz ticks), real match rules.
- Seed sets: 1-40 / 1-60 (as in W13-W14) and the second set 101-140 / 101-160.
- Total run time was 36 min, with 2 processes at most.

**Result:**
- 1v1 is even: 41 Corgi wins, 39 Cat.
- 2v2 is just over the bar: the Cats won 73 of 120 (61 %, 52-69 %).
- The slope-jump fix (§ Jump fix) gave 1v1 42-38 and 2v2 30-90 (Cat 75 %), with no trip-time gain. **It is
  reverted.** The shipped bot.gd is the CONTEST version: 2v2 stays at 61 % Cat, one point over the bar. NEXT is not
  done.
- So I made the one allowed start-offset change: start and respawn slots by nav-path sprint time instead of straight
  line. It made 2v2 worse (73 % Cat), so **it is reverted**. match.gd is G-MOVE's file again, byte for byte. The
  candidate is kept in my scratch copy only.

## Table
Held = seconds alone on the slab (scored). First = the side that reached the slab first in each match. Margin = Corgi
score minus Cat score.

| Format | Slots | Seeds | n | Corgi wins | Cat wins | Draws | Cat share (95 % CI) | Mean margin | Held (Corgi-Cat) | First on slab (Corgi / Cat) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1v1 | straight line (integrated) | 1-40 | 40 | 23 | 17 | 0 | 42 % (29-58 %) | +1.7 | 2257-2170 s | 40 / 0 |
| 1v1 | straight line (integrated) | 101-140 | 40 | 18 | 22 | 0 | 55 % (40-69 %) | -1.5 | 2195-2232 s | 39 / 1 |
| **1v1** | **straight line (integrated)** | **both** | **80** | **41** | **39** | **0** | **49 % (38-60 %)** | **+0.1** | **4452-4402 s (49.7 % Cat)** | **79 / 1** |
| 2v2 | straight line (integrated) | 1-60 | 60 | 24 | 36 | 0 | 60 % (47-71 %) | -6.8 | 3067-3536 s | 6 / 54 |
| 2v2 | straight line (integrated) | 101-160 | 60 | 23 | 37 | 0 | 62 % (49-73 %) | -5.5 | 3131-3515 s | 4 / 56 |
| **2v2** | **straight line (integrated)** | **both** | **120** | **47** | **73** | **0** | **61 % (52-69 %)** | **-6.1** | **6198-7051 s (53.2 % Cat)** | **10 / 110** |
| 1v1 | nav path (candidate, reverted) | both | 80 | 35 | 45 | 0 | 56 % (45-67 %) | -2.6 | 4340-4577 s (51.3 % Cat) | 0 / 80 |
| 2v2 | nav path (candidate, reverted) | both | 120 | 32 | 88 | 0 | **73 % (65-80 %)** | -10.0 | 5858-7141 s (54.9 % Cat) | 0 / 120 |

Mean spawn-to-slab time per life in these matches, Corgi-Cat:

| Format | Straight line (integrated) | Nav path (candidate) |
|---|---|---|
| 1v1 | 16.3-16.4 / 16.0 s | not logged |
| 2v2 | 16.8 / 16.1 s | 16.9 / 15.6 s |

## Why nav-path time made it worse
A lone bot sprinted from every spawn to the slab (`balance.gd --routes`), and I compared its measured time with both
estimates. The estimates are sprint time to the slab centre: by straight line, and by the Godot nav path (the bots'
own map).

| Spawn (data index) | Straight line | Nav path | Measured bot trip (to the slab's edge) |
|---|---|---|---|
| Corgi 0 (-74, -123), start slot 0 | 14.95 s | 15.04 s | 15.00 s |
| Corgi 4 (-68, -123), start slot 1 | 14.64 s | 14.71 s | 14.85 s |
| Cat 6 (62, 117): straight-line slot 0 | 15.05 s | 15.89 s | 15.52 s |
| Cat 12 (74, 105): straight-line slot 1, nav-path slot 0 | 14.60 s | 14.93 s | 14.42 s |
| Cat 8 (68, 105): nav-path slot 1 | 14.22 s | 14.61 s | 14.22 s |
| Cat 2 (56, 117): straight-line respawn | 14.74 s | 15.99 s | 15.53 s |
| Cat 9 (68, 111): straight-line respawn | 14.79 s | 15.26 s | 14.78 s |
| Cat 0 (56, 105): nav-path respawn | 13.52 s | 14.82 s | 14.47 s |

- **The Corgi's nav path is almost straight.** From spawn 0 it is 144 m, because of the slab path. Yet the Corgi bot
  needs about 0.4-0.5 s more than its path's sprint time. It also jumped about 7 times per route on the pit ramp and
  in the trench notches, but the jump fix below shows those jumps cost no time. The 0.4 s is the route itself: the
  climbs out of the pit and the notches.
- **The Cat paths bend (+3-10 m),** but Cat bots run them at full sprint and reach the slab's edge in their path time
  minus the last 4 m.
- **Net effect:** matching on nav-path time moved every Cat slot about 0.5 s closer. The Cats were then first on the
  slab in 200 of 200 matches.
- **Measured trip times with the straight-line slots:**
  - slot 0: the Corgi is 0.5 s ahead;
  - slot 1: the Cat is 0.4 s ahead;
  - respawns: the Cat is level, or 0.5 s behind.
- **That fits the table.** 1v1 (slot 0 only) is even, with the Corgi first in 79 of 80. 2v2 leans Cat, with a Cat
  first in 110 of 120 through slot 1.
- **The human:** from spawn 0 a straight W + Shift run takes 16.92 s (respawn.md). That is 1.4 s behind the Cat bot
  at straight-line slot 0 (15.52 s), and it would have been 2.5 s behind at the nav-path slot (14.42 s).

## Jump fix (reverted: made 2v2 worse)
**Reverted by the lead's decision.** bot.gd is back to the CONTEST version that produced the "integrated" rows
(sha256 d1f36474...e59c). This section stays as evidence.

**Change (tried):** bot.gd `_steer`. A bot jumps for a path corner more than 0.45 m up only when the move is blocked
(`_blocked()`): the last `move_and_slide` left it against a wall that faces its wish (wall normal · wish < -0.3).
Godot classes a surface steeper than the 52 deg `floor_max_angle` as a wall, and the step-up takes faces up to
0.45 m. So a walkable slope (the pit ramp, the trench notches) is run, and a real ledge is still jumped.

**Per-trip time lost to jumps** (`--routes`, each side's bot alone from each of its team's 16 spawns, sprint):

| Side | Jumps per trip (before → after) | Step-ups | Mean trip, before → after | After minus before, per route |
|---|---|---|---|---|
| Corgi | 7.2 → 0.6 | 0 → 0.6 | 13.95 → 14.04 s | +0.06 to +0.14 s (mean +0.09) |
| Cat | 0.6 → 0 | 0 → 0 | 15.30 → 15.30 s | -0.02 to +0.01 s |

All 32 routes still reach the slab, and the longest stall is 0.02 s.
- **The jumps cost nothing.** A bot keeps its horizontal speed in the air. Running the notches is 0.09 s slower than
  hopping them.
- **So my "about 0.4 s lost to jumps" was wrong.** The fix is behaviour (no hopping up walkable ramps), and it does
  not move the trip times.
- Corgi slot 0 is now 15.08 s, against 15.52 s for the Cats' slot 0 and 14.43 s for their slot 1.

**Re-measured once on the integrated build, with the same n and seed sets** (HEAD + G-MOVE's match.gd + bot.gd with
the jump fix):

| Format | Build | n | Corgi wins | Cat wins | Draws | Cat share (95 % CI) | Mean margin | Held (Corgi-Cat) | First on slab (Corgi / Cat) |
|---|---|---|---|---|---|---|---|---|---|
| 1v1 | integrated | 80 | 41 | 39 | 0 | 49 % (38-60 %) | +0.1 | 4452-4402 s (49.7 % Cat) | 79 / 1 |
| 1v1 | + jump fix | 80 | 42 | 38 | 0 | 48 % (37-58 %) | +0.2 | 4487-4438 s (49.7 % Cat) | 77 / 3 |
| 2v2 | integrated | 120 | 47 | 73 | 0 | 61 % (52-69 %) | -6.1 | 6198-7051 s (53.2 % Cat) | 10 / 110 |
| 2v2 | + jump fix | 120 | 30 | 90 | 0 | **75 % (67-82 %)** | -10.6 | 5855-7249 s (55.3 % Cat) | 7 / 113 |

The 2v2 halves are 18-42 (seeds 1-60) and 12-48 (seeds 101-160).
- **1v1 is even.**
- **2v2 is further over the bar.** Held time moved only from 53.2 % to 55.3 % Cat, and the Corgi trip by 0.09 s.
  Matches end close (the mean margin is 6-11 points), so a small shift flips many winners.
- **Noise or effect?** A gap of 14 points between two n-120 samples is about 2.3 standard errors, so it is probably
  not noise alone. I did not tune further, as instructed.

**Suite:** the full working tree (every lane's current edits plus mine), `tests/run.gd` 16/16 PASS in 1 min 24 s,
with test_game_respawn.gd included.

## NEXT (not done)
### 1. Start and respawn slots from measured bot trip times
2v2 stays over 60 % (61 % on the shipped build). The candidate is to set the Cats' slots from the measured times in
the routes table, not from an estimate. With the shipped bot.gd (the "before" column of the routes table above):
- Corgi slot 0 is 15.00 s and slot 1 is 14.85 s.
- Cat slot 0: (62, 111), measured 14.93 s.
- Cat slot 1: (68, 111), measured 14.78 s.
- Cat respawns: inside the 0.3 s band the Corgis' line spans, which is 14.7-15.0 s: (62, 111) and (68, 111).
- Today the Cats' slot 1 is (74, 105) at 14.42 s, 0.4 s ahead of the Corgi bot.

It needs the numbers as data, from `balance.gd --routes` (each value is one lone sprint; the run is deterministic),
because neither the straight line nor the nav path predicts the bots' trips. G-MOVE's `test_game_respawn.gd` asserts
straight-line respawn times within 0.3 s and has to change with it.

### 2. Bots hop up walkable ramps (cosmetic)
Corgi bots jump about 7 times per trip on the pit ramp and the trench notches. `_steer` jumps at any path corner
more than 0.45 m up within 2.5 m, which is a slope there, not a ledge. The fix tried above (jump only when blocked by
a wall) removed the hops without changing trip time, yet 2v2 measured worse (75 % Cat), cause unknown. Revisit it
after item 1.

## Commands
```
G=<Godot 4.7.2>; B="$G --headless --path engines/godot --script res://tests/balance.gd --"
$B --format 1v1 --n 40 --seed 1 --speed 30 --events;   $B --format 1v1 --n 40 --seed 101 --speed 30 --events
$B --format 2v2 --n 60 --seed 1 --speed 30 --events;   $B --format 2v2 --n 60 --seed 101 --speed 30 --events
$B --routes --speed 30     # per spawn: measured trip, plus line and nav-path sprint times
```
The harness now prints `SLOTS` (start slots 0-1 and respawn points with their sprint times) before the matches.
