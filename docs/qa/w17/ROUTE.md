# W17 match depth 4: ROUTE, do the Cats still arrive first? (lane G-BOT2)

**Answer: no. match.gd is unchanged.**
- On the real path the Corgis reach the slab first, in every build measured for docs/qa/w17/BOT-ROLES.md:
  - first in 114-120 of 120 2v2 matches;
  - first in 78 of 80 1v1 matches;
  - the Cats were first in 0-5 matches.
- No build has the Cats ahead on the mean spawn-to-slab trip by more than 0.5 s; the largest lead is 0.35 s.
- By the card's rule, no `CAT_SLOTS` offset is made. The Cat slots stay W15's (`CAT_OFFSET` 0.6, row z = 117).

## Method
- The same 16 runs as BOT-ROLES.md: HEAD 7a671f1, `tests/balance.gd --speed 30 --events --trace`.
  - 2v2 used seeds 1-60 and 101-160; 1v1 used seeds 1-40 and 101-140.
  - The four bot.gd builds were shipped, trap fix, trap fix + post in zone, and trap fix + no roles.
- **First arrival:** the first time in a match that a live pet of that side stands in the score volume (slab.gd
  `contains()`).
  - **First, Corgi / Cat / tie** counts the matches each side was first. A tie is within 0.1 s, or neither side
    reaching the slab.
  - The mean is over the matches in which that side reached the slab.
- **Trip per life:** spawn to the slab, for every life that reached it, all roles.
  - In the role builds an APPROACH life may go to its post first, so the HOLD bots' trip is given too.
  - In 1v1 and in the no-roles build every bot holds.

## Table
| Build | Format | Seeds | n | First, Corgi / Cat / tie | First arrival, mean Corgi / Cat (Cat - Corgi) | Trip per life, Corgi / Cat (Cat - Corgi) | HOLD bots' trip, Corgi / Cat | Died before reaching the slab, Corgi-Cat |
|---|---|---|---|---|---|---|---|---|
| shipped | 2v2 | 1-60 | 60 | 57 / 2 / 1 | 16.21 / 17.16 s | 16.5 / 16.6 s (n 433 / 429) | 16.3 / 16.6 s | 145-144 |
| shipped | 2v2 | 101-160 | 60 | 57 / 3 / 0 | 16.53 / 16.78 s | 16.5 / 16.6 s (n 440 / 426) | 16.3 / 16.6 s | 137-142 |
| shipped | **2v2** | **both** | **120** | **114 / 5 / 1** | **16.37 / 16.97 s (+0.60)** | **16.50 / 16.60 s (+0.10)** | **16.3 / 16.6 s** | **282-286** |
| trap fix | 2v2 | 1-60 | 60 | 57 / 2 / 1 | 16.22 / 17.16 s | 17.0 / 16.6 s (n 491 / 534) | 16.7 / 16.6 s | 181-137 |
| trap fix | 2v2 | 101-160 | 60 | 57 / 3 / 0 | 16.63 / 17.42 s | 16.9 / 16.6 s (n 521 / 563) | 16.6 / 16.6 s | 194-137 |
| trap fix | **2v2** | **both** | **120** | **114 / 5 / 1** | **16.43 / 17.29 s (+0.86)** | **16.95 / 16.60 s (-0.35)** | **16.6 / 16.6 s** | **375-274** |
| post in zone | 2v2 | 1-60 | 60 | 59 / 0 / 1 | 15.79 / 18.06 s | 16.6 / 16.5 s (n 530 / 541) | 16.4 / 16.5 s | 182-152 |
| post in zone | 2v2 | 101-160 | 60 | 57 / 2 / 1 | 16.17 / 17.98 s | 16.5 / 16.5 s (n 521 / 530) | 16.4 / 16.6 s | 187-161 |
| post in zone | **2v2** | **both** | **120** | **116 / 2 / 2** | **15.98 / 18.02 s (+2.04)** | **16.55 / 16.50 s (-0.05)** | **16.4 / 16.5 s** | **369-313** |
| no roles | 2v2 | 1-60 | 60 | 60 / 0 / 0 | 15.20 / 17.91 s | 16.3 / 16.5 s (n 497 / 454) | (all hold) | 87-140 |
| no roles | 2v2 | 101-160 | 60 | 60 / 0 / 0 | 15.21 / 17.24 s | 16.3 / 16.5 s (n 484 / 449) | (all hold) | 106-136 |
| no roles | **2v2** | **both** | **120** | **120 / 0 / 0** | **15.21 / 17.57 s (+2.36)** | **16.30 / 16.50 s (+0.20)** | **(all hold)** | **193-276** |
| every build | 1v1 | 1-40 | 40 | 39 / 0 / 1 | 15.72 / 20.41 s | 16.1 / 16.4 s (n 142 / 133) | (all hold) | 16-25 |
| every build | 1v1 | 101-140 | 40 | 39 / 0 / 1 | 15.77 / 18.57 s | 16.1 / 16.3 s (n 148 / 140) | (all hold) | 10-18 |
| every build | **1v1** | **both** | **80** | **78 / 0 / 2** | **15.75 / 19.49 s (+3.74)** | **16.10 / 16.35 s (+0.25)** | **(all hold)** | **26-43** |

The 1v1 rows are the shipped build's. The other three builds play the same 1v1 code and gave the same winners and
trips; the no-roles build's seeds 1-40 differ only in that 2 of its 40 winners swapped places, still 21-19, with the
Corgis dying 14 times before reaching the slab instead of 16 and the Cats 24 instead of 25.

## Reading
- **First to the slab.** The Corgis are first, by 0.6 s in the shipped 2v2 and by 0.9-2.4 s in the other builds.
  - In the no-roles build both Corgi bots go straight for the slab; one starts on the faster slot, (-68, -123),
    a measured 14.82 s.
  - In the shipped build that slot's bot is the APPROACH bot, which heads for its post first.
  - The Cats' mean first arrival in 1v1 (19.5 s) includes the matches in which the Corgi bot downed them before they
    arrived.
- **Trip per life.** Cat minus Corgi is +0.10 s in the shipped 2v2 and +0.25 s in 1v1, so the Cats are slower.
  - In the role builds it is -0.35 s (trap fix) and -0.05 s (post in zone). Both are inside 0.5 s, and those trips
    mix in APPROACH lives that went to the post first.
  - The HOLD bots, whose trips do not mix in a post, are level: 16.3-16.7 s against 16.5-16.6 s.
- **W15's measurement still holds.** It had the Corgis first in 120 of 120 2v2 matches, trips 16.5 / 16.7 s.

## Decision
- The card allows one start or respawn offset in `CAT_SLOTS` only if the Cats arrive more than 0.5 s first. They do
  not, so match.gd is unchanged. `tests/test_game_respawn.gd` (the measured-trip check on the slots) passes in the
  suite.
- The 2v2 lean to the Cats in BOT-ROLES.md does not come from arrival. The Corgis are on the slab first, and their
  trips are level or shorter.

## Commands
The four 2v2 and 1v1 commands in BOT-ROLES.md; the route table is computed from their MATCH and SUMMARY lines.
