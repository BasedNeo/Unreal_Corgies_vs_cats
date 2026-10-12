# G-REMATCH (W17 X3): Godot adopts the web's 1 s rematch guard

**Card.** X3, a lead ruling in W17. The web holds the result until a human presses Reload. The press must be a fresh
edge at least `rematchDelay` (1 s) after the end (`src/shared/content/modes.ts:138`, `:194`; applied at
`src/sim/match/index.ts:307`). At HEAD, Godot rematched on the first `rematch` just-press after the end
(`match.gd:367`, `:431`). After this card, both builds follow the same rule.

**Base.** HEAD `71defe3`. No git writes: the lead integrates. Proof runs used a private copy, `scratchpad/grematch/`
(`git archive HEAD` plus my files, with the repo's `node_modules` linked in for vitest), with Godot 4.7.2 headless.
The finished files were copied into the tree, and `cmp` shows that the saved file, the private copy and the repo file
are the same for all four (three in the first round, plus `slab-mode.test.ts` in the patch round).
`engines/godot/game/tuning.gd` was clean (`git diff --quiet` returned 0), so the constant lives there.

## Files

| Path | Change |
|---|---|
| `engines/godot/game/tuning.gd` | :42-44 `REMATCH_DELAY := 1.0`, next to the other match rules. |
| `engines/godot/game/match.gd` | :4-5 header. :44-49 `since_end`, the seconds since `end_match`, summed from process delta (it is game time, never the wall clock), and `_end_fresh`, so the delta of the frame the match ended in is not counted. :278-279 `start_match` resets both. :382-383 `end_match` resets both. :442-450 `_process` rematches only on a just-press once `since_end >= REMATCH_DELAY`. A press inside the guard is dropped, not queued. F2 (`toggle_mode`) is unchanged. `rematch()` stays an unguarded programmatic restart. |
| `engines/godot/tests/test_game_rematch.gd` | :13-24 header. :62 and :143-154 make the existing presses wait out the guard. :95-96 and :188-340 add `wait_guard`, `_end_by_score`, `_holds`, `_tap`, `_end_frame` (:234-261, patch round) and `_guard` (:265-340, cases (a) to (c)). |
| `tests/unit/slab-mode.test.ts` | Patch round, one line, :109: `expect(SLAB.rematchDelay).toBe(num('REMATCH_DELAY'))`. It sits with the other tuning.gd parity checks, :103-110. This file belongs to the web lane; nothing else in it changed. |

## Behaviour

- **Before.** On the winner screen, R, Enter or pad Start rematched on the first frame. A press at the horn could
  skip the result.
- **After.** The result holds. A press within 1 s of the end is ignored, and the match stays over with the same score.
  A key held down across the end never rematches by itself, because it produces no new edge, and releasing it does
  not rematch either. A fresh press at or after 1 s rematches.

## Tests (`test_game_rematch.gd`)

- The existing presses (first to 60; R mid-cue; Enter mid-death) now wait out the guard on the match's own clock
  (`wait_guard`), and every reset check is kept.
  - In the mid-cue and mid-death cases the HUD is frozen during the wait, because its cues fade in 0.35-0.6 s and
    the guard is 1 s.
  - The cues are checked again just before the press.
  - Without the freeze, that check fails 8 times: the confirm, wedge, flash and chip, in both cases. So the reset
    checks for those four cues would otherwise pass without testing anything.
- (a) R two frames after the end, and Enter at half the guard: both ignored. The match stays over, the winner screen
  stays up, and the score and winner do not change.
- (c) The result holds by itself past the guard. A fresh R at 1.00 s rematches.
- (b) R held from before the end until 1.5 s after it does not rematch, and its release does not rematch. The next
  press does.
- Run line: `guard 1.0 s: (a) R within 0.02 s and Enter within 0.52 s of the end ignored; (c) R at 1.00 s rematched;
  (b) R held 1.50 s past the end ignored, pressed again at 1.51 s rematched`.
- **Patch round: `_end_frame` pins the clock.**
  - Setup: `end_match` is called before the `_process` of frame N.
  - After Game's `_process(N)`, `since_end` must be exactly 0, because frame N's delta is time from before the end.
  - After `_process(N + 1)`, it must be exactly frame N + 1's process delta.
  - Run line: `end frame: since_end 0 after the end frame (its 0.0069 s delta skipped), then 0.0069 s = the next
    frame's delta`.
  - Without the skip, the guard would open one frame before the web's 60 ticks.
- **Patch round: the value is pinned on the web side.** `slab-mode.test.ts:109` checks that `SLAB.rematchDelay`
  equals tuning.gd's `REMATCH_DELAY`. The Godot test reads the constant itself, so on its own it cannot pin the
  value.

**Mutants** (in the private copy, each restored and then checked with `cmp` against the saved file):

| Mutant | Result |
|---|---|
| Guard removed (`match.gd:449`: `if Input.is_action_just_pressed("rematch"):`) | `FAIL test_game_rematch.gd: (a) R pressed 0.01 s after the end: the match restarted (score [0, 0], state 1); the result must hold` |
| Delay 0 (`tuning.gd:44`: `REMATCH_DELAY := 0.0`) | `FAIL test_game_rematch.gd: (a) R pressed 0.01 s after the end: the match restarted (score [0, 0], state 1); the result must hold` |
| Patch round: end-frame skip removed (`match.gd:446-447` becomes `since_end += delta`) | `FAIL test_game_rematch.gd: end frame: since_end is 0.006944 s after the _process of the frame the match ended in, want exactly 0 (that frame's 0.006944 s delta is from before the end)`, plus `… 0.013820 s one frame later, want exactly that frame's process delta, 0.006876 s` |
| Patch round: `REMATCH_DELAY := 0.6` (`tuning.gd:44`) | vitest: `FAIL tests/unit/slab-mode.test.ts > slab mode: data and registry > matches the Godot game: the slab of the_lot.json and the rules of tuning.gd`, `AssertionError: expected 1 to be 0.6 // Object.is equality` at `slab-mode.test.ts:109:31` (1 failed, 27 passed). As expected, `test_game_rematch.gd` alone still passes: the pin is the web-side line. |

In the patch round, the first two mutants were run again against the new test file and still fail with the same
lines.

## Other rematch paths: checked, none broken

All of these call `game.rematch()`, `end_match()` or `start_match()` directly, not through the input path, so the
guard does not apply to them:
- `test_hud_death.gd:67-68`
- `test_game_demo.gd:61-62` (the `--demo` path; there is no `main.gd`, because `--demo` lives in `match.gd`)
- `test_game_sfx.gd:210`, `:273`, `:284`, `:312-313`
- `test_hud_clauses.gd:194`, `:206`
- `test_hud_draw.gd:198`, `:205`
- `test_hud_hits.gd:158`, `:165`
- `test_hud_marker.gd:501`, `:510`
- `test_bot_contest.gd:36`
- `test_game_balance.gd:36`
- `shot_hud.gd:254`, which ends the match and never rematches
- G-BAL's `test_bot_roles.gd:87` and `:112`, and `balance.gd:196`, `:393`, `:493` (not touched)

Also checked:
- `testkit.gd:51` only releases the action.
- `test_lead_input.gd` checks the bindings only.
- `tools/`, `tools/godot/` and `engines/godot/tools/` have no rematch driver.

No other file needed a change.

## Full headless suite

`nice -n 10 $G --headless --path engines/godot --script res://tests/run.gd` on the private copy (HEAD plus my files):

| Round | Result | Lines it printed |
|---|---|---|
| First | `GODOT TESTS: PASS`, **24 of 24 files**, exit 0, 172 s | roles "after the rematch 4 match it"; the guard line |
| Patch | `GODOT TESTS: PASS`, **24 of 24 files**, exit 0, 166 s | roles "after the rematch 4 match it"; the end-frame line; the guard line, with (c) at 1.01 s |

Also in the patch round:
- `npx vitest run tests/unit/slab-mode.test.ts` in the repo tree: `Test Files 1 passed`, `Tests 28 passed (28)`.
- `--only rematch`: `PASS test_game_rematch.gd`.

The copy is built from HEAD, so it does not include g-atmos's uncommitted `look/*` edits or the untracked
`tests/test_look_cover.gd`.
