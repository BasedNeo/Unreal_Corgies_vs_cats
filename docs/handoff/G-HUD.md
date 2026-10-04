# G-HUD (W15): the HUD contract in the Godot build

**Status:** done for integration. Nothing is staged or committed; the lead integrates.

**Spec:** `docs/qa/w15/HUD_CONTRACT.md` §1-§5, revision 4 (the lead's file). Godot's strings are the reference, so the web twin copies
the strings below.

**Base:** `816489c` (Sprint B landed) plus the Sprint C working tree, 2026-10-04 (first written on `0ddc7d2`,
2026-10-01). `match.gd` (the lead's `respawn_zone()` / `BASE_NAMES`, G-BOT's `CAT_SLOTS`) is read only. Godot 4.7.2.

## 1. Files

| Path | Change |
|---|---|
| `engines/godot/game/hud.gd` | Rewritten around pure static geometry and words (§2). Every pre-W15 string is kept, except the one-line death text, which contract §2 replaces. |
| `engines/godot/tests/test_hud_marker.gd` | New. §1 (the slab marker) and the §4 hiding rules. |
| `engines/godot/tests/test_hud_death.gd` | New. §2 (the death panel). |
| `engines/godot/tests/test_hud_hits.gd` | New. §3 (the hit cues) and the §4 fields. |
| `engines/godot/tests/test_hud_draw.gd` | New in Sprint C. What the overlay draws (`build_overlay` / `overlay_prims`): the marker's shape and words, the crosshair, the confirms, the wedges, the dimming, nothing over the win screen; the glyph's shape and colour. |
| `engines/godot/tests/test_hud_clauses.gd` | New in Sprint C. One check per contract clause: the confirm, kill, wedge and chip timings, the death panel's backing, and every field string. |
| `engines/godot/tests/test_game_rematch.gd` | Mine since Sprint C (was G-GAME's): its old checks kept, plus contract §5 with the real R and Enter keys. |
| `engines/godot/tests/test_game_fall.gd` | New after the Sprint C check: a fall below `match.gd`'s plane (40 m under the slab's ground) is a takedown by The Lot. |
| `engines/godot/tests/shot_hud.gd` | New. The screenshot harness, a SceneTree script. `tests/run.gd` only runs `test_*.gd` files, so it never runs headless. |
| `docs/qa/w15/hud-godot-*.jpg` | 12 shots (§5). |
| `docs/handoff/G-HUD.md` | This file. |

Not touched: `match.gd`, `pet.gd`, `player.gd`, `bot.gd`, `sfx.gd`, `slab.gd` (the marker needed nothing from it),
`src/**` and `HUD_CONTRACT.md`.

## 2. What the HUD does now

### §1 The slab marker
- **Anchor.** `slab.center + 4.5 m` (`MARKER_LIFT`). The shape, a diamond 10 px from its centre to each tip, sits on the
  projected anchor. Above it are two lines of words:
  - `SLAB  <N> m`: the camera's ground (x, z) distance to the slab's centre, rounded to whole metres;
  - the state word.
- **State, from `marker_spec(slab_state)`.** The slab line uses the same colours.

  | State | Word | Shape | Colour |
  |---|---|---|---|
  | Nobody on it | `NEUTRAL` | a hollow diamond | white `(0.9, 0.92, 0.95)` |
  | One team alone | `CORGI COMPANY` / `CAT CADRE` | a filled diamond | the team colour, lightened 0.35 |
  | Both teams | `CONTESTED` | the diamond's top and bottom halves, 6 px apart, with a 2 px bar in the gap that reaches 5 px past both side tips | amber `(1.0, 0.65, 0.2)` |

  Every shape has a 2 px dark rim, so it reads on lit and dark ground alike.
- **Placement (`place_marker`, contract revision 3, "Placement, in this order").** The marker's box covers both lines
  and the shape. Each other living pet's box is the 8 corners of its model's `Body` mesh bounds, projected through the
  camera (`pet_screen_rect`); the pet whose camera is the view (the player's own) does not count.
  1. The anchor is clamped so the box sits inside the safe area (below).
  2. While the box covers a pet's box, it moves up by what it needs plus 2 px: at most 120 px in all, and never above
     the safe top (y 110), so the scores, the timer and the slab line stay clear.
  3. If that cannot clear the pet, the box goes just below the lowest pet box it still covers (2 px under it). If it
     then covers another pet, it goes just below that one too, and so on down, while the box stays above the safe
     bottom (revision 4).
  4. If neither clears, it keeps the lifted place. Nothing clamps after this.

  `marker_frame()` reports which happened as `dodge` (`none`, `lift`, `below`, `blocked`). The canvas is always 720
  units tall (stretch mode `canvas_items`), so the contract's 720p pixels are these.
- **Off screen.** The whole box clamps inside a safe area, keeping both lines. The safe area is:
  - 16 px in from the left and right edges;
  - below the slab line (y ≥ 110);
  - 112 px above the bottom edge, so it stays clear of YOU / HP and the ammo.

  When the anchor is behind the camera, `behind_point` puts the marker on the bottom edge, shifted toward the side
  the slab lies on, and the same placement steps run against the pets on screen. When the slab is ahead but the view
  is pitched down past it, the marker goes on the top edge.
- **Hidden** in these cases:
  - while the player stands on the slab (`slab.contains`): the top slab line says the state;
  - while the player is down (decision 1 in §6);
  - once the match is over;
  - when there is no player (the spectator view), as before.
- `match.gd LINEUP_AIM_LIFT` is untouched.

### §2 The death panel
Four lines sit centred on the screen, on a dim rounded backing sized to the lines:
1. `TAKEN DOWN BY <killer display_name>  ·  <KILLER TEAM>`, or `TAKEN DOWN BY THE LOT` when there is no killer. The
   killer's team glyph sits between the `·` and the team name, in that team's colour lightened 0.3: a square for
   Corgi Company, a triangle for Cat Cadre (`team_glyph`). The team name is in the score labels' colour.
2. `YOU: <TEAM>`.
3. `BACK AT <respawn_zone(team).name>  ·  <round(dist)> m TO THE SLAB`.
4. `BACK IN <respawn_left(player), %.1f>`.

`death_lines()` builds the four strings; the HUD keeps them in `death_text`. The killer is captured from the local
player's own `died(pet, killer)` signal as `{name, team}`; this is the same pair that `match.gd pet_down` re-emits. A
takedown of another pet does not change it. The old `TAKEN DOWN  ·  back in %.1f` is gone, and `Click to play` is
unchanged.

### §3 Hits
`hit_cue(kind, centre, dir)` builds each cue from primitives (lines, fills, outlines, rings). Each kind differs in
shape:

| Kind | Shape | Colour | Shown |
|---|---|---|---|
| body | an X of four lines, 7-14 px out along the diagonals | white | 0.18 s (as before) |
| head | the same X with a filled diamond in its centre, 4.5 px to a tip | yellow `(1, 0.85, 0.2)` | 0.18 s |
| kill | a larger X (8.5-21 px out, 3 px wide) with an outline ring 18 px across | red `(1, 0.25, 0.2)` | 0.35 s |
| received | a filled arrowhead, 24 px long and 16 px wide, on a 110 px ring around the crosshair, its tip toward the attacker | red-orange `(1, 0.45, 0.36)` | fades over 0.6 s |

A received hit (`pet.damaged(amount, from)` on the local player) does three things:
- **The wedge.** `wedge_dir()` gives the ground bearing from the player to where the attacker stood at its last hit,
  relative to the camera's facing: up = ahead, right = right, down = behind. Turning the camera turns the wedge. There
  is one wedge per attacker, and a new hit refreshes it.
- **The chip.** A white segment on the HP bar runs from the HP that was there to the HP that is left, with a 2 px dark
  seam where it meets the fill, and drains linearly over 0.4 s. It follows the hit points themselves (each frame's
  drop), so a takedown with no hit before it (`die()`: a fall) drains as well (decision 2).
- **The flash.** The existing red full-screen flash, now `minf(0.25, …)`. Its peak is still 0.175 (0.35 × 0.5), and the
  cap holds however long the flash runs.

The crosshair (its gap opens with the spread) and the rifle's muzzle flash are unchanged.

Sprint C, contract revision 4:
- **A kill is not cut short.** A body or head confirm inside a running kill confirm is not shown; the kill runs its
  0.35 s. A confirm after it shows as usual.
- **A wedge over the marker dims the marker.** While a wedge's box (its arrowhead grown by the 2 px rim) overlaps the
  marker's box, the marker's words and shape draw at alpha 0.35, so the wedge never reads as part of the marker (or
  as Cat Cadre's triangle glyph).
- **Nothing over the win screen.** Once the match is over the overlay draws no crosshair and no cue (the marker is
  hidden too), whatever the cue timers still hold.
- **The overlay is a list.** `build_overlay(state)` (pure) returns every draw item in order: the marker's two lines and
  its shape, the crosshair, the confirm, the wedges. `overlay_prims()` builds it from the live HUD, and `draw_overlay`
  only iterates it, so the tests check what is drawn. `glyph_prims(team)` does the same for the death panel's glyph.

### §5 Rematch
`_reset_cues()` clears every HUD leftover:
- the confirm (`hit_t`), the red flash (`_dmg_t` and its alpha), the wedges, the HP chip (`chip_top`, `_hp_seen`, its
  drain rate);
- the remembered killer (`down_by`), the death panel and its lines.

It runs on `match.gd match_started` (connected once, in `_ready`), so on every rematch and every F2 switch, and from
`_hook_player` when the player changes. The winner screen and the takedown feed follow the match itself (`over()`,
`feed`).

### §4 Fields
- `YOU: <TEAM>` over the HP bar: right-aligned to the bar's right end, 15 px, in the team's score colour, with the HP
  number to its left as before.
- The slab line (`_slab`) and the marker hide once the match is over; the rematch brings them back.
- There is no fps line. The hint names X with R for reload: `… Shift sprint · R / X reload` (both are bound,
  `input_setup.gd`). Every other string is unchanged.
  - `test_hud_hits.gd` checks the strings at the match's start (`CORGI COMPANY  0`, `0  CAT CADRE`, `SLAB  NEUTRAL`,
    `30 / 30`, `120`, the hint, `PLACEHOLDER PETS`, the timer as `m:ss`).
  - `test_hud_clauses.gd` (Sprint C) checks every other state's string:
    - the timer: white above 30 s, red from 30 s down, and `OVERTIME` in amber;
    - the slab line: `SLAB  <TEAM> HOLDING  +1/s` for both teams, and `SLAB  CONTESTED`;
    - the ammo: `12 / 30`, then `RELOADING`;
    - the win screen: `CORGI COMPANY WINS`, `CAT CADRE WINS` and `DRAW` with their colours, and the full win sub.

## 3. API used (read-only)
- **`match.gd`:**
  - `slab` (`center`, `size`, `contains()`), `slab_state`, `player`, `pets`, `over()`, `playing()`;
  - `respawn_zone(team)`, `respawn_left(pet)`;
  - `score`, `winner`, `time_left`, `overtime`, `feed`.
  - Tests and shots also use: `step_score(0.0)` (to refresh the slab state for a placed arrangement, with no points),
    `end_match()`, `rematch()`, `respawn_slots`, `spawns`.
- **`pet.gd`:**
  - signals `damaged(amount, from)` and `died(pet, killer)`;
  - `display_name`, `team`, `alive`, `hp`, `species`;
  - `model` (its `Body` MeshInstance3D, for the screen box).
- **`player.gd`:** `hit_confirmed(res)` (`kill`, `head`), `camera`, `rifle`, `current_spread()`.
- **`tuning.gd`:** `TEAM_NAMES`, `TEAM_COLORS`, `MAX_HP`, `RIFLE.mag`, `MOVE`, `height()`, `WIN_SCORE`.

## 4. Tests

Run with `godot --headless --path engines/godot --script res://tests/run.gd -- --only hud` (the five HUD files) and
`-- --only rematch`.

| File | Checks |
|---|---|
| `test_hud_marker.gd` | **Contract numbers as literals** (after the Sprint C check): lift cap 120, clearance 2, safe area [16, 110, 16, 112], anchor 4.5 m. **Pure:** the words, shape and colour per state; the three shapes differ in their primitives; the words sit above the shape. Placement (revision 3): a pet under the marker lifts it clear (by no more than it needs); stacked pets lift it over both; a pet too tall to clear upward puts the box just below it; with no room either way it keeps the lifted place (120 px, the cap); anchor (640, -300) with a pet `(600, 100, 80, 60)` under the clamped box stays at or below y 110, off the timer `(578, 23, 110, 42)` and the slab line `(340, 76, 600, 26)`; with some room above (anchor y 130, 175, 260) it never rises past y 110; anchors off screen to the left, right and top clamp the whole box inside the safe area; behind the camera it goes on the bottom edge, toward the slab's side. **Live, 2v2, every Corgi and Cat spawn and respawn point** (the data's: 18 + 16 points), the play camera at the respawn pitch and aimed at the slab, the three bots placed six ways (a row across the view, a file along it, the Cats alone, the Corgi alone, two pets at the top of a jump, nobody), 408 views in all. In every view the marker hangs at the slab centre + 4.5 m (or above it, lifted), is on screen, reads `SLAB  <N> m` and the right state word, covers no living pet's box (measured by the test itself, not by the HUD), nor the scores, the timer or the slab line (their own label rects), stays at or below y 110, and lifts at most 120 px; 186 views needed the lift (largest 9.2 px). **Step 3 (revision 4), pure:** a file A, B, C settles 2 px under C; A then B settles 2 px under B; a chain down past the safe bottom is blocked and keeps the 120 px lift. Behind the camera, a pet on the bottom edge lifts the marker clear. **Close and pitched down (Sprint C, widened):** the play camera 4.5, 6, 8, 9 and 14 m from the slab's centre on eight bearings, `cam_pitch` -0.3, -0.45 and -0.6, the six arrangements: 720 views. 72 stand on the slab, and there the marker must be hidden. In the other 648, the box never rises above y 110 or covers the scores, the timer or the slab line, and covers no pet. A view the HUD labels "blocked" is re-checked independently: the test scans every allowed place (the lift range and everything below to the safe bottom, every 0.5 px, 2 px clearance) and fails if one clears. Results: 352 anchored, 296 below a pet, 0 lifted, 0 blocked. **Own pet (Sprint C):** with the slab behind, the bottom-edge marker sits over the player's own pet and stays there (dodge `none`), and `marker_frame` does not list the own pet's box. **Hiding:** on the slab, while down, after the win (with the slab line); back after the respawn and the rematch. |
| `test_hud_death.gd` | **Pure:** `death_lines` with a Cat killer, with none, and for a Cat player downed by a Corgi (`SCAFFOLDS`, 126.5 rounds to 127); the glyph is a square for Corgi Company and a triangle for Cat Cadre. **Live, 1v1:** the Cat bot downs the player. The panel shows exactly the four lines, with the base and the distance from `respawn_zone(0)` and the countdown within 0.15 s of `respawn_left()`. Line 1 on screen is the killer's part + the glyph + the team name. The triangle sits between them, the panel is centred, and the old one-line text is gone. The marker is hidden and the HP bar empties. A bot's takedown keeps the killer. The panel hides after the respawn. A fall reads `TAKEN DOWN BY THE LOT`, with no glyph and no team name. **`--demo`:** the panel reads `BACK AT THE SLAB'S EDGE` with that spot's distance, the player then respawns within 1.5 m of it, and after the rematch the panel reads the base again. |
| `test_hud_draw.gd` | **Pure, `build_overlay`:** for each state, the marker draws its two lines and then its shape: the state's own shape (CONTESTED as two halves and a bar) in the state's colour, both lines' bottoms above the shape's top tip, and the state word in the state colour. While alive and playing: one crosshair; the confirm on show with its own shape (body white X, head yellow X with a diamond, kill red X with a ring) and none when no hit is on show; a wedge per hit, about 110 px out along its direction, with alpha 1.0 then 0.5 at half life. A wedge over the marker dims every marker item to 0.35; one elsewhere does not. Over (the win screen) or down: no crosshair, confirm or wedge, whatever the timers hold. **`glyph_prims`:** a square for Corgi Company and a triangle for Cat Cadre, each in its team colour lightened. **Live, 1v1:** the overlay draws the marker and the crosshair; after a kill confirm, the kill cue; after a hit from the Cat bot, a wedge; once the match is won, nothing. |
| `test_hud_clauses.gd` | §3 numbers as literals: the flash cap 0.25, the dimmed marker's alpha 0.35, the wedge ring about 110 px. The HUD's `_process` is stepped by hand with exact deltas. **Timings:** body confirm shown at 0.17 s, gone at 0.19 s; kill shown at 0.30 s, gone at 0.36 s; a body hit 0.1 s into a kill leaves the kill with 0.25 s, and a body hit after it shows. A 30 HP chip is 60 px, then 30 px at 0.2 s, 15 px at 0.3 s and 0 at 0.41 s. The wedge is there at 0.54 s and gone at 0.61 s. **Backing:** black at alpha 0.55, rounded, enclosing the four lines. **Fields:** the timer (`1:36` and `0:31` white, `0:30` and `0:07` red), `OVERTIME` in amber, the four slab lines, `12 / 30` then `RELOADING`, the hint's `R / X reload`, and the three win titles with their colours and the exact win sub for each. |
| `test_game_rematch.gd` | The old G-GAME checks: rematch ignored mid-match, first to 60, the winner screen, rematch resets, time-out and overtime. **§5, with real key events through `Input`:** R pressed on the winner screen of a match that ended mid-cue (a kill confirm, a wedge, the flash, the chip, a takedown in the feed), and Enter on one that ended mid-death (the death panel and its countdown up, plus those cues). It first checks the cues were up. After each rematch: score 0 - 0; no respawn countdown left (`respawn_left` 0); the clock at `3:00`; every pet alive at its start slot (`start_slots`, within 0.3 m); no confirm, wedge, red flash, HP chip, death panel, remembered killer or winner screen; the feed empty; and no confirm or wedge drawn. |
| `test_hud_hits.gd` | **Pure:** the four cue kinds have four different primitive signatures. Body is an X; head is the X with a centred diamond (6 px reach or less); kill has a ring about 18 px across and a larger X; received is one triangle about 110 px out whose tip points along the direction, at least 1.3× longer than wide. `wedge_dir`: ahead, right, behind and left map to up, right, down and left, for a level camera and one pitched down 60°; yaw turns it. **Live, 1v1:** `hit_confirmed` shows body, head and kill. A hit from the Cat bot on the right gives one wedge pointing right (from behind: down), a white chip exactly the HP lost at the fill's end, and a red flash between 0 and 0.25. The chip is gone 0.45 s later and the wedge 0.7 s later. The flash stays at or below 0.25 with a 3 s flash timer. The wedge holds where the attacker stood: after the hit from the right the Cat bot moves 9 m to the player's left, and the wedge keeps its stored position and still points right. **Fields:** `YOU: CORGI COMPANY` visible over the HP bar; no `fps` in any label; the start-of-match and win-screen strings listed in §2 §4 (not the other states' strings: Sprint C). |

**Each test fails on regression.** Each breakage below was applied to `hud.gd` alone, the three files run, and the file
restored (sha256 checked):

| Breakage | Fails |
|---|---|
| The whole pre-W15 `hud.gd` (from `git show HEAD`) | all 3 files |
| The marker never lifts | marker (74 failures: the jump arrangement at the bases, the stacked-pets pure case, and no view needed the lift) |
| The slab line stays after the win | marker |
| The marker stays after the win | marker |
| The marker shows on the slab | marker |
| The marker shows while down | marker, death |
| CONTESTED drawn as a filled diamond | marker |
| NEUTRAL drawn filled | marker |
| The words not above the shape | marker |
| The anchor at 1.5 m | marker (408 views) |
| The kill cue without its ring | hits (same shape as body) |
| The head cue without its diamond | hits (same shape as body) |
| The wedge mirrored | hits (pure and live) |
| No HP chip | hits |
| The chip never drains | hits, death |
| The flash uncapped | hits (alpha 1.49) |
| No YOU line | hits |
| No-killer line `TAKEN DOWN` | death |
| No team glyph | death |
| BACK AT from a fixed 140 m, not `respawn_zone` | death |
| The killer not captured | death |
| The received cue drawn as an X | hits |
| Sprint B patch: the lift ignores the safe top (the bug Sprint B found) | marker (257 failures: the pure (640, -300) case, close views over the timer) |
| Sprint B patch: no "below the pet" step | marker (165 failures; a below step that reports "blocked" instead of moving fails only the 2 pure cases: the live check trusts the HUD's label) |
| Sprint B patch: the wedge follows the attacker (`wd.from.global_position`) | hits (the wedge points left after the attacker moved) |

**Sprint C mutants.** 28 breakages, each applied to `hud.gd` in a private copy of `engines/godot`, with the files named
below run, then restored (sha256 checked); all 28 fail. The private copy was needed because G-BOT's `bot.gd` briefly
did not parse on the shared tree; it used HEAD's `bot.gd`. The final full suite ran on the shared tree.

| Mutant | Fails, with |
|---|---|
| R1 `_reset_cues` does nothing | rematch, 11: "R rematch mid-cue: the confirm is still there after the rematch" |
| R2 `_reset_cues` not on `match_started` | rematch, 11: the same |
| N3 the player's own pet not excluded | marker, 142: "labelled blocked, but a box top at y 378.0 clears every pet" (and the own-pet check) |
| S3 step 3 takes one step only | marker, 96: "a file A, B, C: box top 126.0 (blocked), want 492.0 (below)" |
| B1 a clearable view labelled blocked | marker, 302: "a pet too tall to clear upward: … (blocked), want its top at 402" (and the live independent check) |
| W1 a wedge over the marker does not dim it | draw, 3: "marker_text drawn at alpha 0.92, want 0.32" |
| M03 CONTESTED drawn filled | draw: "CONTESTED is drawn as … fills [4] …, want … fills [3, 3, 4]" |
| M13 words drawn below the shape | draw, 8: "marker line 'SLAB  42 m' is drawn at y 260.0-280.0, not above the shape's top tip 240.0" |
| M24 no marker drawn | draw, 5: "the overlay draws 0 marker lines and 0 shapes, want 2 and 1" |
| M25 no wedge drawn | draw, 3: "0 wedges drawn for 2 received hits" |
| M26 no confirm drawn | draw, 4: "body: 0 confirm cues drawn, want 1" |
| X1 crosshair and cues over the win screen | draw, 4: "over: the overlay still draws a crosshair" |
| K1 a body hit cuts a kill short | clauses: "a body hit 0.1 s into a kill: body with 0.180 s left (want the kill, 0.25 s left)" |
| M11 `KILL_SHOW` 0.18 | clauses: "a kill confirm: kill with 0.000 s left at 0.30 s" |
| M12a no backing (override removed) | clauses: "the death panel's backing is 1a1a1a99 (alpha 0.60, corner 3), want black at alpha 0.55, rounded" |
| M12b a transparent backing | clauses: "… (alpha 0.00, corner 6) …" |
| M14 the wedge's life 0.3 s | clauses: "the wedge: 0 at 0.54 s, 0 at 0.61 s after the hit" |
| M15 the timer never red | clauses, 2: "time left 30.0 s: the timer reads 0:30 in ffffff, want 0:30 in red" |
| M16 the glyph in the other team's colour | draw, 2: "team 0's glyph is drawn in d97180, want its team colour 2f6fd6 lightened" |
| M17 HOLDING without `+1/s` | clauses, 2: "the slab line reads 'SLAB  CORGI COMPANY HOLDING', want '… HOLDING  +1/s'" |
| M18 `OVER TIME` | clauses: "overtime: the timer reads OVER TIME" |
| M19 head and kill colours swapped | draw, 2: "head confirm drawn in ff40338e, want yellow" |
| M28 the chip drains in 0.2 s | clauses: "60.0 px, then 0.0 at 0.2 s, 0.0 at 0.3 s" |
| M30 `RELOAD` | clauses: "then 'RELOAD' while reloading" |
| F1 `TIE` for a draw | clauses: "winner -1: the win screen reads 'TIE' …" |
| F2 `CONTESTED` without `SLAB` | clauses: "the slab line reads 'CONTESTED', want 'SLAB  CONTESTED'" |
| F3 the win sub's second line changed | clauses, 3: "'You: 3 takedowns, 2 knockouts' …" |
| F4 the hint without X | clauses and hits: "the hint does not name X with R for reload" |

**After the Sprint C check.** Three more mutants, in the private copy (two edit `match.gd`, which is not mine), each
restored after:

| Mutant | Fails, with |
|---|---|
| P1 `MARKER_MAX_LIFT` 60 and the safe bottom 60 (it survived every symbol-based check) | marker: "the marker lifts at most 60.0 px, the contract says 120", "the safe area is [16.0, 110.0, 16.0, 60.0] …" |
| P2 `match.gd`'s fall-plane check removed | fall: "Cat Bot 1 40.5 m below the slab's ground is still up" (and the same for `You`) |
| P3 `start_match` keeps the respawn queue | rematch: "Enter rematch mid-death: the player's respawn countdown is still 2.78 s after the rematch, want 0" |

`test_game_fall.gd`: a 1v1 with the pets' own physics off. The Cat bot, then the human, is put 39.5 m below the slab's
ground (nothing happens: still up, no tally or feed change). Then it is put 40.5 m below. It is downed with no killer
and no credit (its knockouts + 1, nobody's takedowns), the feed gains `The Lot  >  <name>` with no team, and
`respawn_left` is within 0.1 s of `RESPAWN_TIME`. For the human, the death panel reads `TAKEN DOWN BY THE LOT` with no
glyph. Both respawn after.

## 5. Shots

Made with:

```
xvfb-run -a -s "-screen 0 1280x720x24" godot --path engines/godot \
  --rendering-method gl_compatibility --rendering-driver opengl3 --audio-driver Dummy \
  --script res://tests/shot_hud.gd -- --out docs/qa/w15
```

Sprint C re-rendered all twelve and compared them with the published ones. Only the win shot changed through the
code (the crosshair is gone). The hits and received shots differ by the random camera kick a hit gives (their marker
moved 4 px), so they were replaced from the same run. The marker and death shots matched within noise (at most 5
pixels over 60 grey levels apart) and were kept.

The renderer is Mesa llvmpipe. The run takes about 3.5 min with `LP_NUM_THREADS=2`; `--only <name>` takes a subset.
Each cue is staged after time is frozen (`Engine.time_scale` 0), so it shows at its first frame's strength. The
controls hint (shown only in the first 14 s of a match) is put away. The grey copies use Rec. 709 luma. All files are
JPG, 250 KB or less.

| File | What I saw |
|---|---|
| `hud-godot-marker-corgi.jpg` (+ `-gray`) | The play camera at the Corgis' middle respawn point, as a respawn leaves it. `SLAB  145 m` / `CAT CADRE` over a filled pink diamond, about 90 px above the crosshair. The two Cat bots, a few px tall on the slab, sit under it, uncovered: the marker lifted 2.8 px off them. The Corgi bot stands beside the human. In grey the words and the solid diamond read. |
| `hud-godot-marker-cat.jpg` (+ `-gray`) | The same at the Cats' middle respawn point (the human stands in for a Cat), with the scaffolds. `SLAB  136 m` / `CORGI COMPANY` over a filled light-blue diamond; the Corgi bot is on the slab under it. It reads in grey. |
| `hud-godot-marker-near.jpg` (+ `-gray`) | `--lineup 30`. `SLAB  33 m` (the camera is about 3 m behind the pet) / `CONTESTED` over the split amber shape, which reads as two halves with a bar through the gap. The Corgi bot and the Cat bot stand on the slab below the crosshair, clear of the marker. It reads in grey. |
| `hud-godot-death.jpg` | `TAKEN DOWN BY Cat Bot 1  ·  ▲ CAT CADRE` (a crimson triangle), then `YOU: CORGI COMPANY`, `BACK AT THE FOUNDATION  ·  142 m TO THE SLAB` and `BACK IN 2.5`, centred on the dim backing. There is no marker, the HP bar is empty (0), and the feed reads `Cat Bot 1  >  You`. |
| `hud-godot-hits.jpg` (+ `-gray`) | A 2×2 sheet, 1.5× (the captions are the harness's). BODY: a white X on the Cat bot under the crosshair. HEAD: a yellow X with a centre diamond. KILL: a red X with a ring. RECEIVED: an arrowhead at the lower right pointing down-right, toward the Cat bot behind on the right, on the red flash. In grey the four still differ: an X, an X with a diamond, an X with a ring, and an arrowhead. |
| `hud-godot-hit-received.jpg` (+ `-gray`) | The whole screen after that hit: the arrowhead about 110 px out at the lower right; HP `105` with a white chip from 105 to 120 behind a dark seam; the red flash. The slab is behind, so the marker (`SLAB  16 m` / `NEUTRAL`, hollow diamond) sits on the bottom edge with both lines: the off-screen clamp. In grey the chip still reads as its own segment. |
| `hud-godot-win.jpg` | Re-rendered in Sprint C (the crosshair no longer draws over the win screen). `CORGI COMPANY WINS`, `60  –  41`, `You: 0 takedowns · 1 knockouts` and the rematch line. There is no slab line under the timer, no marker and no crosshair. |

## 6. Decisions: confirmed by the lead (now in `HUD_CONTRACT.md` revision 2)
1. **The marker hides while the player is down.** The death panel says `142 m TO THE SLAB` (from the respawn), while the
   marker would still say `SLAB  29 m` from where the player fell: two distances at once. The first death shot showed
   exactly that, with the marker on top of the panel. I propose adding this to contract §1, "On the slab", and to the
   web twin.
2. **The HP chip follows the hit points, not only `damaged`.** A takedown with no hit before it (`die()`, a fall) left
   the chip stuck at full width: a white bar all through the death. The `damaged` signal still drives the wedge and the
   flash.
3. **The wedge points at where the attacker stood at its last hit**, and turns with the camera. It does not track the
   attacker afterwards (that would show a hidden attacker for 0.6 s).
4. **A kill shows 0.35 s.** Body and head stay at 0.18 s, as before.
5. **The death panel has a dim backing** (`0.55` alpha, rounded): lit scenery behind the words crossed the `·`
   separators.

## 7. Known limits
- **The crosshair can cross the marker.** When you aim at pets on the slab from beyond about 65 m, the marker (4.5 m up,
  about 20 px at that range) meets the crosshair's top arm. The crosshair draws on top, and the slab line still says the
  state.
- **The player's own pet is not counted** as a pet to clear: it is the view's own body. When the slab is behind, the
  bottom-edge marker can sit over your own pet, as in `hit-received`.
- **Close and pitched down, the marker drops below the pets** (contract step 3). At 4.5-14 m with the view pitched
  down, the anchor is far above the screen and the clamped box sits on the pets, so it goes just under them (296 of
  the 648 close views off the slab). It never enters the top HUD band. Only when neither a lift (at most 120 px, and
  only up to y 110) nor the scan below clears every pet does it stay on one (step 4). The live sweep met none of those,
  so its independent blocked check found nothing to judge; N3 and B1 show that it fires when a view is wrongly
  labelled blocked.
- **The pet boxes are bounds, not silhouettes:** the body mesh's AABB, so the marker keeps a little more clearance than
  it strictly needs.
- **The sweep uses the human's (Corgi) camera at the Cat bases.** That rig sits 5 cm lower than a Cat's.
- **Sounds are not covered.** Contract §3 "Sound" (the six cues in `--sfx-log`, own vs enemy slab tick) belongs to the
  audio lane.

## NEED
- None open. The `--demo` gap is resolved: the lead added `respawn_zone(team, pet)` (match.gd, `DEMO_SPOT_NAME`). The
  HUD passes the local player, so in `--demo`'s first match the panel reads `BACK AT THE SLAB'S EDGE  ·  <N> m TO THE
  SLAB`, measured from the spot the player really respawns at. `test_hud_death.gd` part 3 covers it: it fails with
  `'BACK AT THE FOUNDATION  ·  142 m TO THE SLAB', want 'BACK AT THE SLAB'S EDGE  ·  7 m TO THE SLAB'` when the
  player is not passed.
