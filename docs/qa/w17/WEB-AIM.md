# W17 TW-SIM B3: the twin's slab bots aim like Godot's (one aim geometry)

> **Lead ruling (2026-10-12): NOT ADOPTED. B3 stays DEFECT.** With Godot's aim-height parity the twin's 1v1 moves
> from 56.9 % to 68.8 % Cat (n 160, sign test p 0.032), over the 60 % bar, and the opposite way from Godot's lab
> (57.9 % to 49.9 %). The twin's fire gate is a yaw/pitch window, not Godot's FIRE_CONE, so the same geometry change
> does not carry the same effect. The patch is parked (scratchpad `b3-parked/`: the diff and the test), the shipped twin
> is unchanged, and a new card root-causes the twin's own 1v1 Cat edge (HEAD already 56.9-59.8 % Cat) before parity is
> retried. These numbers are the lane's measurements; the fresh check did not run (session limit), which is why
> nothing lands from this card.


**Result: the rule is mirrored and pinned, but the balance bar is NOT met in 1v1. The lead rules on adoption.**
- **Code:** in the slab match every twin bot looks, checks its line of sight and fires from `BOT_AIM_EYE` 0.936 m over
  its feet, and aims at `BOT_AIM_CHEST` 0.66 m over its target's feet, whatever either species. It never aims at the
  head (Godot bot.gd has no head aim). Humans and every other mode are unchanged.
- **Aim, 3 m apart on the slab:** the Corgi bot aims at -0.0916 rad and the Cat bot at -0.0919 rad, 0.0003 apart (bar
  0.008; Godot 0.0021). HEAD aims at -0.1183 and -0.1466, 0.0283 apart (Godot's shipped build: 0.0284).
- **Tests:** a new `tests/unit/slab-aim-parity.test.ts` (5 tests) pins the eye, the aim point, the sight line, the shot
  origin, the head roll, the human branch and one non-slab mode. **All 11 mutants fail it.**
- **Other modes:** team-deathmatch, core-rush, base-assault and yard-skirmish are hash-identical to HEAD, tick by tick.
- **Balance (paired, the same seeds at HEAD and after):**
  - **1v1, n 160: Cat 56.9 % → 68.8 %.** Winners moved 45 to Cat and 26 to Corgi (sign test p 0.032, Fisher p 0.037).
    That is **over the 60 % bar**, and the shift is significant.
  - **2v2, n 320: Cat 59.1 % → 60.9 %.** Winners moved 80 to Cat and 74 to Corgi (p 0.69). That is no detectable
    change, but it ends 0.9 points over the bar (HEAD was 0.9 under it).
- **It does not match Godot's lab direction.** In Godot one geometry moved close slab fights toward even (standoff and
  brawl 57.9 % → 49.9 % Cat) and left whole matches inside the noise. On the twin the 2v2 also stays inside the noise,
  but the 1v1 moves 12 points **toward the Cat**. The twin has no FIRE_CONE (its fire gate is a yaw/pitch alignment
  window, `brain.ts` `aligned`), so Godot's mechanism does not carry over; the card warned of this.
- **PARITY B3 / G25:** the rules now MATCH, but the bar fails. The lead owns PARITY.md and the ruling.

## The rule and where it lives
| Godot (bot.gd, W17 G-BAL) | Web | Notes |
|---|---|---|
| `AIM_EYE := 0.936`, `AIM_CHEST := 0.66` (:21-22) | `BOT_AIM_EYE`, `BOT_AIM_CHEST` in `src/shared/content/modes.ts` (slab section), with a comment citing bot.gd:21-22 | The test reads bot.gd and checks the two are equal. |
| a bot, not the human (`player.gd` fires from the camera) | `slabBotAim(sim, e)` in `src/sim/combat/state.ts`: `e.ownerPid === null` and the room's mode is `slab` | One gate for every site. A headless client driving a player slot (ownerPid set) stays human. |
| `_eye()` and `_aim_point()` in the aim tracking (:157, :159) | `idealAim()` (`brain.ts`): from `BOT_AIM_EYE` to `BOT_AIM_CHEST` | The twin's fire gate (`aligned`) compares the bot's pitch with this line, so it follows. |
| view check (:199) and `_los()` (:299): one ray, eye to aim point | `perceive()`: the eye is `BOT_AIM_EYE`, and one line goes to `BOT_AIM_CHEST` | The twin's fallback line to 0.9 h (the head) is dropped for slab bots, as Godot has none. |
| shot origin `rifle.shoot(_eye(), ...)` (:314) | `fire()` in `src/sim/combat/weapon-system.ts`: a bot-only branch, `slabBotAim ? BOT_AIM_EYE : eyeHeight(e)` | A human's shot is the HEAD expression, bit for bit (the test checks every shot with `===`). |
| no head aim | `ai.aimHead` is never set for a slab bot | The random draw stays, so each target pick draws the same numbers as at HEAD. |

- **Left alone (as the card says):** `droneShot`, `propShot` and `tactics.ts:379`. Also left alone: the ordnance throw
  origin (`ordnance.ts:266`). A bot throws only while it carries a pickup (`EFlag.Ordnance`); this card did not check
  whether a slab bot ever does. Godot has none of these. Adventure and wave modes keep `eyeHeight`.
- **Visuals:** the tracer and the flash start at the avatar's muzzle (`src/client/fx/index.ts` `muzzleOf`), not at the
  shot origin, as in Godot (rifle.gd:177). Nothing floats.
- **Not touched:** `stepCharacter`, speeds, routes, spawn slots, `PERF_HOST_FACTOR`, roles.

## Test (`tests/unit/slab-aim-parity.test.ts`)
1. `BOT_AIM_EYE` / `BOT_AIM_CHEST` equal bot.gd's `AIM_EYE` / `AIM_CHEST` (read from the file).
2. **Godot's part 4 on the twin.** A bots-only 1v1 slab room. Its Corgi bot and Cat bot stand 3 m apart across the
   slab's centre, held in place and unhurt, for 3 s, carrying the rifle. Their aim error is zeroed: Godot's `aim_dir`
   carries none, since its AIM_ERROR goes on the shot.
   - Each sees the other. The pitches are at most 0.008 rad apart, and each is within 1e-4 rad of the line from
     `BOT_AIM_EYE` to `BOT_AIM_CHEST`.
   - Every sight line each bot cast at the other (a spy on `worldLineClear`; 60 cast) runs from 0.936 to 0.66.
   - Every shot (the `fire` event) leaves 0.936 m over the shooter's feet (17 and 16 shots).
   - The pair stands on a line 9° off the z axis. The Lot's ground under the slab has a grade of about 2 cm per m
     along x, which alone would put two equal aims 0.04 rad apart; this line is level within 0.4 mm (the test checks
     1 mm).
3. **No head roll:** with the archetype's `headChance` forced to 1, the slab bots never set `aimHead` and still aim at
   the chest line.
4. **Humans:** a slab 2v2 with one human on each side, everyone placed on the slab. Every human shot (30 a side) leaves
   exactly `e.pos.y + eyeHeight(e)`: 1.0500 m for the Corgi, 1.1025 m for the Cat. The bots beside them (24 and 20
   shots) fire from 0.936.
5. **Another mode keeps HEAD's aim:** the same standoff in team-deathmatch on The Lot aims along HEAD's species lines
   exactly. Body aim gives -0.1183 / -0.1466 (0.0283 apart). With the head forced it aims at 0.9 h (+0.0281 / -0.0076).
   Every shot leaves `eyeHeight`, and the sight lines keep the species eye and the 0.55 h line.

## Mutants (each in a copy, restored and cmp-checked identical; the new test file)
| Mutant | Failing tests |
|---|---|
| M0: HEAD's `brain.ts` + `weapon-system.ts` (the exports kept) | 3: part 4 (0.0283 apart), the head test, the human test (its bots fire from 1.05 / 1.1025) |
| M1: shot origin back to the species eye | 2: part 4 (shots from the species eye), the bots in the human test |
| M2: aim point back to 0.55 h | 2: part 4, the head test |
| M3: idealAim eye back to the species eye | 2: part 4, the head test |
| M4: sight line back to 0.55 h / 0.9 h | 1: part 4 (sight lines) |
| M5: sight eye back to the species eye | 1: part 4 (sight lines) |
| M6: slab gate dropped (every bot in every mode) | 1: team-deathmatch |
| M6b: slab gate dropped at the fire site only | 1: team-deathmatch (shot origin) |
| M7: human branch broken (every slab character) | 1: the human test |
| M7b: human branch broken at the fire site only | 1: the human test |
| M8: head roll back in slab | 1: the head test |

## Balance (`tools/slab-balance.ts`, paired by seed, HEAD against after)
| Format | Seeds | HEAD Cat share | After Cat share | Winners moved (to Cat / to Corgi) | Sign test p | Fisher p | Pets downed (Corgis-Cats) HEAD → after |
|---|---|---|---|---|---|---|---|
| 1v1 | 1-160 | 91/160 = **56.9 %** (CI 49.1-64.3) | 110/160 = **68.8 %** (CI 61.2-75.4) | 45 / 26 | 0.032 | 0.037 | 490-460 → 517-427 |
| 2v2 | 1-320 | 189/320 = **59.1 %** (CI 53.6-64.3) | 195/320 = **60.9 %** (CI 55.5-66.1) | 80 / 74 | 0.687 | 0.687 | 2323-2295 → 2364-2358 |

- The edge band is unchanged: 1v1 0.89 % → 0.88 % of slab time, 2v2 1.44 % → 1.44 %.
- The size was set to about 30 min of runs on this box (single process, niced; the box was loaded at 7-18 by other lanes,
  so it took 34 min, plus 7 min for the diagnostic below). 2v2 seeds 1-160 alone read HEAD 63.8 % and after 56.3 %; seeds 161-320 read 54.4 % and 65.6 %.
  So blocks of 160 swing by ±5 points, and only the pooled numbers above count.
- **The pairing is weak.** A changed winner on 44 % (1v1) and 48 % (2v2) of the seeds means the matches diverge
  early, so the sign test is close to an unpaired test.
- **Diagnostic: the head roll is not the cause** (card item (d), the lead's choice). Variant D1 keeps the roll for slab
  bots, and a rolled head aims at one species-neutral height (1.08 m, the Corgi's 0.9 h). 1v1 seeds 1-160: Cat 104/160 =
  **65.0 %**. Against the change as built: 16 winners to Corgi, 10 to Cat (p 0.33). Against HEAD: 40 to Cat, 27 to
  Corgi (p 0.14). So the Cat's 1v1 gain comes from the shared eye, aim point, sight line and shot origin, not from
  dropping the roll. Not decomposed further: one more run of 160 per part is about 7 min on this box.
- **What the bar needs:** a ruling. The options are (a) adopt for parity, with the twin's 1v1 at about 69 % Cat; (b)
  hold B3 open until the twin's 1v1 Cat edge is understood (the twin's bodies: the Corgi capsule is wider, r 0.36
  against 0.33, and the Cat runs faster, 6.6 against 6.4 m/s); or (c) decompose eye, aim point, sight line and shot
  origin first.

## Other modes (the TW-SIM verifier's method, `modes-hash.ts` scratch)
A bots-only room per mode, 3600 ticks. Every entity's position is hashed every tick, and a second hash also folds in
yaw, pitch and hp. HEAD against after:

| Mode | Map | Bots | Seed | Position hash | Pos + aim + hp hash | Same |
|---|---|---|---|---|---|---|
| team-deathmatch | the_lot | 4v4 | 7 | 87c170ce | 40c4b89d | yes |
| team-deathmatch | west_yard | 4v4 | 7 | 390bc29d | ac2375ef | yes |
| core-rush | west_yard | 3v3 | 7 | b079fd6f | 538282f1 | yes |
| base-assault | the_lot | 3v3 | 7 | 83250e99 | e016d31a | yes |
| yard-skirmish | west_yard | 3v0 | 7 | 9fc41366 | 8433ae8e | yes |
| team-deathmatch | the_lot | 2v2 | 11 | eea182c7 | 5f8c0985 | yes |
| core-rush | west_yard | 2v2 | 11 | e6b5dd9f | 20b1f7aa | yes |
| base-assault | the_lot | 2v2 | 11 | b96a8f2 | 104ad4a2 | yes |
| slab | the_lot | 2v2 | 7 | ef9f71b6 → 71011c4c | 4c079a73 → a823003a | no (the change) |

## Trial (`trial.sh twsimb3`: HEAD d7953cb plus the six files below; niced, load 16-20 from other lanes)
- **vitest:** `slab-aim-parity`, `slab-mode`, `slab-contest` and the 14 `ai*.test.ts` files: 17 files, 136 passed and
  3 skipped (the env-gated G4b acceptance in `ai-base-assault.test.ts`), exit 0.
- **slab-contest edge band** (bar 5 %): 0.1 / 0.0 / 0.2 % (Godot's scenario), 0.2 / 0.3 / 0.0 % (crowd), 0.4 / 0.7 /
  0.4 % (step-in). The four bots spend 78.7-80.0 of their 80 pet-s on the slab.
- **`npx tsc --noEmit`:** exit 0. **`npm run check:boundaries`:** BOUNDARIES: PASS.
- **HEAD moved to bd8adca during the run.** That commit changes only `tests/e2e/net-slab.spec.ts`. On the trial rebuilt
  from bd8adca, `tsc --noEmit`, the new test (5 of 5) and `check:boundaries` pass again.
- **Files:** `src/shared/content/modes.ts`, `src/sim/combat/state.ts`, `src/sim/combat/weapon-system.ts`,
  `src/sim/ai/brain.ts`, `tests/unit/slab-aim-parity.test.ts` (new), `docs/qa/w17/WEB-AIM.md` (new).
