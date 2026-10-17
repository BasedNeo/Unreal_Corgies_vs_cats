# W17 parity checklist: Godot and the web twin (match depth items 2, 3, 5 and 6)

Lane QA-P17, the grader. This file re-runs every row of `docs/qa/w15/PARITY.md` (95 rows, built at `b222e37`) on the
current head and adds the W17 card's rows: the death card (item 2), the hit read (item 3), the rematch (item 5), the
ink, the second client, two PENDING rows and two HUMAN rows. Every row cites a test (file and line at this head) or a
shot per build that was opened and looked at. The contract is `docs/qa/w15/HUD_CONTRACT.md`. At the QA pass it was
revision 4, unchanged since `b222e37`; the lead's revision 5 (W17) then added the death card's distance tolerance
(§2, row K6). Godot wins any clash. Line numbers are cited at `7a671f1`: the commit that adds this file also adds
comment lines to bot.gd (+4) and test_bot_roles.gd (+3), so citations into those two files are that many lines short
after it.

**Tree:** HEAD `7a671f1` (CI run 156: `gate` and `godot` jobs green, 2026-10-04). Checked on a private copy
(`git archive 7a671f1` into `scratchpad/qa17`, the shared `node_modules` linked) on 2026-10-10. The shared tree holds
other lanes' uncommitted work (item 11, the cover read), so nothing was tested there.

**What moved since `b222e37`:** nothing under `engines/`, `src/sim`, `src/client/ui` or `src/client/input`
(`git diff --quiet` on those paths), so every Godot test line and every slab-HUD line cited by w15 is unchanged. The
web changes are `src/host/room.ts` (the CI 154 guard), the slab audio gate, the intensity guard, the ink removal and
`tests/e2e/net-slab.spec.ts`. Four cited test files moved: `slab-mode.test.ts` (+23 lines after :414, the CI 154
case), `tests/e2e/modes.spec.ts` (the rematch case rewritten), `fx-particles.test.ts` and `audio-slab-cues.test.ts`.
Their cells below are re-cited at this head (a difflib map of `b222e37` to `7a671f1`, then each line read).

## Lead rulings (W17, after the QA-P17 pass)
- **K6 → MATCH:** HUD_CONTRACT rev 5 §2 gives `<N>` a tolerance of ±4 m (zone centre; the point is chosen after the
  card shows).
- **H1 (crosshair gap) and H20 (confirm X size):** the web follows Godot. Queued for tw-view. H1 also checks that the
  web sim's rifle spread matches Godot's tuning.gd (a rules check, not only the display). **Done (W17 H1/H20, three
  rounds, a fresh check each):** H1 MATCH (the spread rules are equal); H20 MATCH under the lead's ruling of
  2026-10-12 (parity is the drawing rule: geometry, butt caps, widths w and w + 2, underlay 0.8·a and the paint order,
  pinned in both builds; the rasterisers' antialiasing at the ends is reported, not gated, and the ends are within
  1 px). New: H1a (Godot's burst double tap and in-tick order), H1b (the web sprints while firing), H20b (paint style).
- **X3 (rematch delay):** Godot adopts the web's 1 s guard, so a reload spam at the horn cannot skip the result screen;
  both builds then match. Queued for a Godot game lane. **Done (W17 G-REMATCH):** `REMATCH_DELAY` 1.0 in
  tuning.gd, the guard on the input path in match.gd; a fresh check passed it and the lead re-ran its mutants. Logged,
  not changed: on Godot's winner screen F2 / pad Back (switch 1v1 / 2v2) still restarts at once; the web has no F2.
- **X4 (pad X rematches on the web only):** deferred and logged. It needs a protocol split of Reload from rematch; not
  this wave.
- **B2 (2v2 roles):** NOT MET. **W17 G-BAL done:** no single cause of the Cat advantage. The one clean lab effect is
  the aim geometry in close slab fights: standoff + brawl 57.9 % Cat, 49.9 % with one aim geometry (n 700, Fisher
  p 0.003; a fresh check re-ran it on new seeds: 58.8 % against 47.1 %, p 0.013). Landed: aim-height parity in bot.gd
  (AIM_EYE 0.936 m, AIM_CHEST 0.66 m, both species; humans fire from the camera; new row B3). Whole matches: no change
  detectable at n 240 (2v2 106-134 against 104-136, Fisher p 0.93; it detects about 12 points; 1v1 44-36). It is a
  parity and cleanliness change, adopted for the lab asymmetry. Post in zone + the fix: 62.5 % Cat and the APPROACH bot
  at its post 16-18 % of its alive time (bar 20 %), so not adopted. B2 stays DEFECT (docs/qa/w17/BOT-ROLES.md § G-BAL).
- **B1 → MATCH, G15 closed for the edge band (lane TW-SIM).** The twin now runs Godot's contest rule. B1's web proof,
  `tests/unit/slab-contest.test.ts`, lands in the TW-SIM commit after the commit that adds this file, so its row cites a
  file that is not at `7a671f1`. A fresh check passed it. Beyond the 6 m contest zone the twin keeps its W13 pull: an
  allowed DIFF, logged in G15 only, until the lead rules on porting Godot's far branch (G-BAL did not address it),
  so the DIFF (allowed) total stays 3.

## Totals (95 w15 rows + 26 W17 rows = 121)
| Status | w15 rows (95) | W17 rows (26) | All |
|---|---|---|---|
| MATCH | 79 | 12 (K1-K6, T1-T4, N1, H20a) | 91 |
| GODOT ONLY | 3 (D9, F12, M20) | 1 (K7) | 4 |
| WEB ONLY | 8 (R2, R4, R9b, R14, F13, H19, R15a, R15b) | 2 (X10, N2) | 10 |
| DIFF (allowed) | 3 (D2, F10, H11) | 1 (P2) | 4 |
| DEFECT | 2 (X4, B2) | 7 (B3, H1a, H1b, H20b, P2a, P2b, P2c) | 9 |
| PENDING (lead fills in) | 0 | 1 (P1 sky source) | 1 |
| HUMAN (logged, not done) | 0 | 2 (U1 slab hold, U2 listen) | 2 |

**DEFECT rows (9 now: 6 at the QA pass, 5 after the lead's rulings, 4 after X3 closed by W17 G-REMATCH, 5 after B3 opened by W17 G-BAL, 6 after H1 and H20 closed and H1a, H1b, H20b opened by W17 H1/H20, then P2a, P2b, P2c opened by W17 item 11), each with its owner in the DEFECT table below.** K6
was ruled MATCH: the card's distance is the zone centre, the measured respawn an end point 1.1-3.3 m off, within
HUD_CONTRACT rev 5's ±4 m. The rest: H1a (rifle fire timing; lead, then g-game), H1b (sprint while firing; tw-sim via the lead), H20b (paint style;
lead, then tw-view), X4 (pad X rematches on the web; lead), B2 (2v2 roles NOT MET; g-bot), B3 (bot aim geometry: the twin does not mirror G-BAL; tw-sim). Since w15: H2 is now MATCH (a
muzzle flash shot in both builds); everything else kept its status. The card's own asks hold: the death card names
the killer, the team, the base and a true countdown in both builds, and you come back at the base it names (measured,
80 respawns); the hit, the confirm and a received hit read in grey in both builds; R and Enter reset everything in
both builds; the CI 154 fix stands and its mutant still fails the test; no ink; net-slab passed in CI 156.

## Runs at this head (each on the private copy, under `nice -n 10`)
| Command | Result |
|---|---|
| `$G --headless --path engines/godot --import` | exit 0 |
| `$G --headless --path engines/godot --script res://tests/run.gd` | `GODOT TESTS: PASS`, 24 of 24 files. Printed: contest 80.0 pet-s on the slab, edge band 0.8 % (w15: 0.9 %); roles "after the rematch 4 match it"; sfx counts 9/8/2/2/1/1; respawn "2 distinct points over 9 rounds" per team |
| `npx vitest run` on slab-mode, slab-hud, slab-view, slab-view-input, audio-slab-cues, audio-cue-measure, audio-death-by, audio-intensity-fall, fx-reactions-fall, fx-particles, style-no-comic | 11 files, 128 of 128 pass: 28 + 36 + 10 + 7 + 13 + 4 + 2 + 2 + 2 + 18 + 6 |
| CI 154 mutant: in `src/host/room.ts:375` the guard `((cmd.buttons ^ e.prevButtons) & COMBAT_BUTTONS) === 0 &&` removed, then `npx vitest run tests/unit/slab-mode.test.ts -t "CI 154"` | **FAIL** (killed): `AssertionError: expected { mode: 'slab', phase: 'ended', …(5) } to match object { phase: 'live', …(2) }`, 1 failed, 27 skipped. The file was restored (`cmp` with `git show 7a671f1:src/host/room.ts`: same) |
| `node tools/audio/measure-cues.mjs` | the six files measure exactly as LISTEN.md §1: own tick 906 Hz / 65 ms, enemy tick 585 Hz / 59 ms, "centroid gap 321 Hz (min 150) … they differ". The cue files are byte-identical to `b222e37` |
| Death-card probe, Godot (`scratchpad/qa17-probes/test_zz_qa17_card.gd`, copied into the copy's tests, run with `--only zz_qa17`, then removed) | PASS. 1v1 and 2v2, 10 rounds each, the other pets placed round the map each round; per round the human (a Corgi) and a Cat bot are taken down by an enemy. 40 respawns: see rows K1 to K6. Log `scratchpad/qa17-logs/godot-card-probe2.log` |
| Death-card probe, web (`scratchpad/qa17-probes/zz-qa17-card.test.ts`, copied into the copy's tests/unit, run, then removed) | 4 of 4 pass. A real `Room` (bots thinking), the human joined as a Corgi and then as a Cat, 1v1 and 2v2, 10 knockouts each by an enemy bot (`kill()`). The panel is the HUD's own frame model (`slabHudFrame`, fed the sim's drained events). 40 respawns: rows K1 to K6. Log `scratchpad/qa17-logs/web-card-probe.out` |
| Godot shots: `xvfb-run … --rendering-method gl_compatibility --script res://tests/shot_hud.gd -- --out <scratch>` (the repo's harness, unchanged) | 0 failed: marker-corgi, marker-cat, death, hit-received, hits, win, marker-near |
| Godot own-shot shots (`scratchpad/qa17-probes/qa17_shot_own.gd`, same render flags) | idle: spread 0.0209 rad, crosshair gap 13.8 px, no flash; firing through the real `fire` action, frozen after the 4th shot: spread 0.0209 rad, **bloom 0.0000**, gap 13.8 px, flash visible, ammo 26 |
| Web shots (`scratchpad/qa17-probes/qa17-web-shots.mjs`, Playwright on a private vite, port 5280, SwiftShader) | Sessions on the copy's own vite (`scratchpad/qa17-logs/web-*.log`): own shot (at rest, then three held firing frames), confirms (body, head, kill), the received hit and the Corgi knockout (`&slabHurt`), the Cat knockout (`&slabHurt&team=1`). Long matches (`&slabWin=999&slabTime=3600`) so the Cat bot's hold could not end a session. No page error in any session (`errors []`) |
| CI run 156 (`7a671f1`), job `gate`, read through the GitHub API | `Test Files 153 passed`, `Tests 1341 passed, 4 skipped`; e2e `12 passed (5.1m)`, among them `net-slab.spec.ts:268 … (2.6m)` and `modes.spec.ts:137` (SLAB rematch, 50.1 s); `GATE PASS`. Job `godot`: success |

Not re-run here: the w15 mutants P1, P2, P3 and the two `respawn()` mutants. Their files (`engines/godot/game/*.gd`,
`engines/godot/tests/*.gd`) are byte-identical at this head, so their results stand as logged in w15. The web probe
`probe-rematch` (X7) was not re-run; `slab-mode.test.ts` "fresh brain" (:455-483) was, and passes.

## Key
- **MATCH:** both builds are proven to follow the rule. **GODOT ONLY / WEB ONLY:** only that build is proven, or only
  that build has the rule. **DIFF (allowed):** the builds differ in a way the contract allows. **DEFECT:** the rule
  fails or is unproven in a way the lead has to route (owner, file:line and repro in the DEFECT table). **PENDING:**
  the lead fills it in. **HUMAN:** a person has to do it; logged, not done.
- **Godot tests** are in `engines/godot/tests/`: `marker` = test_hud_marker.gd, `death` = test_hud_death.gd, `hits` =
  test_hud_hits.gd, `draw` = test_hud_draw.gd, `clauses` = test_hud_clauses.gd, `rematch` = test_game_rematch.gd,
  `fall` = test_game_fall.gd, `slab` = test_game_slab.gd, `sfx` = test_game_sfx.gd, `respawn` = test_game_respawn.gd,
  `demo` = test_game_demo.gd, `input` = test_lead_input.gd, `bot_roles`, `bot_contest`, `look_scene` and
  `look_contract`.
- **Web tests** are in `tests/unit/`: `slab-hud`, `slab-mode`, `slab-view`, `view-input` (slab-view-input),
  `audio-cues` (audio-slab-cues), `cue-measure` (audio-cue-measure), `audio-death-by`, `fx-reactions-fall`,
  `audio-intensity-fall`, `fx-particles`, `no-comic` (style-no-comic). `e2e` = tests/e2e/modes.spec.ts, `net-slab` =
  tests/e2e/net-slab.spec.ts.
- **Shots** are in `docs/qa/w17/` (`p17-*`), each opened. **L** = live play, **S** = staged (pets placed, a hit or
  knockout scheduled or injected), **Y** = synthetic events through the real HUD. Web shots were held still by a
  test-side init script: `performance.now` is frozen the moment the staged event's snapshot arrives (before the game
  handles it) and later snapshots are held back, so the cue is drawn at its first frame and the slow SwiftShader
  compositor can catch up before the screenshot. Greyscale copies are Rec. 709 luma.

## A. The W17 card

### Item 2: the death card ("no 140 m surprise")
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| K1 | Line 1 names who took you down | death:130-131 (live, `TAKEN DOWN BY Cat Bot 1  ·  CAT CADRE`), :138-139 (the labels on screen say it). Probe: 40 of 40 knockouts of the human read `TAKEN DOWN BY Cat Bot 1  ·  CAT CADRE` (the killer was Cat Bot 1 each time). Shot `p17-godot-death.jpg` (S) | slab-hud:373-374 (the roster's `Whiskers`), :387 (`Pup 4` before the roster names it). Probe: 40 of 40 panels name the bot that `kill()` credited (`Cat 1`, `Cat 2`, `Pup 1`). Shot `p17-web-death.jpg` (S, a real &slabHurt knockout): `TAKEN DOWN BY Cat 2` | MATCH (each build's display names: D2) |
| K2 | Their team: the team name, after a glyph in its shape (Corgi square, Cat triangle) | death:105-108, :149-152 (the triangle between the name and CAT CADRE); draw:166-171. Shot `p17-godot-death.jpg`: ▲ CAT CADRE | slab-hud:154, :157, :172-175; the probe's line 1 reads `CAT CADRE` (Corgi human) and `CORGI COMPANY` (Cat human) 20 of 20 each. Shots `p17-web-death.jpg` (▲ CAT CADRE) and `p17-web-death-cat.jpg` (■ CORGI COMPANY, `BACK AT THE SCAFFOLDS  ·  132 m TO THE SLAB`) | MATCH |
| K3 | Line 3: where you come back and how far: `BACK AT THE FOUNDATION  ·  142 m TO THE SLAB` (Corgis), `BACK AT THE SCAFFOLDS  ·  132 m TO THE SLAB` (Cats) | death:121-123, :126-131 (the panel reads `respawn_zone(0)`: THE FOUNDATION). Probe: `respawn_zone(0)` = THE FOUNDATION, centre (-73.3, -121.9), 142.24 m, card `142 m`; `respawn_zone(1)` = THE SCAFFOLDS, centre (62.0, 117.0), 132.41 m, card `132 m`. The human's panel read the Corgi line 40 of 40. Godot has no Cat human, so its Cat card is never on screen (G9: no standing Godot test of 132 m). Shot `p17-godot-death.jpg` | slab-hud:139, :143 (142 and 132), :151, :156; slab-mode:628, :635-637 (132 is Godot's, parsed from match.gd). Probe: 20 of 20 Corgi panels read the FOUNDATION line, 20 of 20 Cat panels the SCAFFOLDS line. Shots `p17-web-death.jpg`, `p17-web-death-cat.jpg` (■ CORGI COMPANY, `BACK AT THE SCAFFOLDS  ·  132 m TO THE SLAB`) | MATCH |
| K4 | Line 4: the countdown, and it is true | death:134-136 (against `respawn_left`, ±0.15 s). Probe: down to up is 181 physics frames (3.017 s) in 40 of 40; at the read the card was at most 0.15 s ahead of the measured time left (e.g. `BACK IN 3.0`, up 2.850 s later; headless runs several physics frames per drawn frame) | slab-hud:152-153, :163, :381. Probe: `BACK IN 3.0` on the first dead frame and up after 181 ticks (3.017 s), 40 of 40. Shot `p17-web-death.jpg`: `BACK IN 2.7` (frozen at the knockout's snapshot, then stepped 0.32 s for the interpolated state; 3.0 − 0.32) | MATCH |
| K5 | You come back at the base the card names | Probe, measured positions: 40 of 40 respawns stand on one of that team's `respawn_slots` (within 0.3 m), all inside the named base: the human (Corgi) at (-74.0, -123.0) 17 times and (-72.7, -120.8) 3 times; the Cat bots at (68.0, 117.0) 17 times and (56.0, 117.0) 3 times | Probe, measured positions: 40 of 40 on one of `slabRespawnPoints(team)` (within 0.3 m): the Corgi human at (-74.0, -123.0) 20 times; the Cat human at (68.0, 117.0) 18 times and (56.0, 117.0) twice | MATCH |
| K6 | The distance you then run is the distance the card said | Measured ground distance to the slab centre: Corgi 143.5 m (17) and 140.9 m (3) against the card's 142 m (off +1.5 / -1.1 m); Cat 135.3 m (17) and 129.7 m (3) against 132 m (off +3.3 / -2.3 m). The zone centre (142.2 m, 132.4 m), which is what the card's number is, was never a respawn spot | The same numbers: Corgi 143.5 m (20 of 20, off +1.5 m); Cat 135.3 m (18, off +3.3 m) and 129.7 m (2, off -2.3 m). Never the centre point | **MATCH** (lead ruling, HUD_CONTRACT rev 5 §2: `<N>` is the zone centre with a tolerance of ±4 m; measured 1.1-3.3 m off, always at the named base. Was DEFECT at the QA-P17 pass) |
| K7 | `--demo`'s first match: the card says THE SLAB'S EDGE with that spot's distance, and you really come back there | death:51-57 (the panel reads `BACK AT THE SLAB'S EDGE  ·  <N> m`), **:58-65 measures the respawn: within 1.5 m of the card's spot**; :66-76 (the rematch reads the base again). demo: "after a takedown the human comes back 1.7 m off the slab's edge" (this run) | n/a (the twin has no `--demo`) | GODOT ONLY (allowed: §2 names it Godot's) |

The base row (K5) is proven by measured positions in both builds, not by reading code. Nothing in either build puts a
pet back anywhere else: no respawn in 80 left its team's points, and the countdown matched the measured 3.017 s.

### Item 3: the hit read, without colour
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| T1 | Your shot reads without colour: a muzzle flash, the ammo count going down | Shot `p17-godot-own-shot-gray.jpg` (L: the real `fire` action held, time frozen after the 4th shot; left at rest, right firing): the flash quad at the muzzle and its light on the pet's back and the crate; `p17-godot-own-fire.jpg` reads `26 / 30`. rifle.gd:29-41 (the flash and its light), :173-176 (shown 0.05 s per shot). From the play camera the flash sits half behind the pet's head: in grey the light it throws reads more than the quad. No test (G11) | Shot `p17-web-own-shot-gray.jpg` (L: a stand-in pad holds RT, the game's own pad path; held at the frame of an own `fire` event; left at rest, right firing): the flash glow at the muzzle and its light on the pet, the tracer, the crosshair open; `p17-web-own-fire.jpg` reads `25 / 30`. Weak test only: fx-particles:148 (G11) | MATCH (by shot in both; tests G11) |
| T2 | The hit confirm reads without colour: body an X, head the X plus a filled diamond, kill a larger X plus a ring | hits:61-62 (the kinds differ in shape); shot `p17-godot-hits-gray.jpg` (Y: `hit_confirmed.emit` on a placed Cat bot): BODY, HEAD, KILL and RECEIVED cells; each reads by shape in grey | slab-hud:199 (shapes differ); shot `p17-web-hits-gray.jpg` (Y: hit, head-hit and knockout events added to real worker snapshots): body X, head X with a centre diamond, kill a larger X with a ring. In grey at 1x body and head differ only by the head's centre diamond, small because the web's X sits 1/√2 closer in (H20); `p17-confirm-size-gray.png` shows both builds at 3x | MATCH (shape; the web's X is 1/√2 of Godot's size: H20) |
| T3 | A received hit reads without colour: the wedge toward the attacker, the white HP chip | hits:199-204 (live wedge), :208-212 (chip); shot `p17-godot-hit-received-gray.jpg` (S: `take_damage` from a placed Cat behind on the right): the wedge low right of the crosshair, the chip a white end on the HP bar (105), the marker undimmed | slab-hud:240-243, :267-279; shot `p17-web-hit-received-gray.jpg` (S: the first &slabHurt hit, frozen at its snapshot): `95` with a white chip from 95 to 120 on the HP bar, the wedge at full strength on its ring toward the Cat on the slab (the marker under it dimmed to 0.35), the red tint; in grey the wedge and the chip read | MATCH |
| T4 | Your slab tick and the enemy's differ in length or pitch | sfx:123-125 (`streams.slab_tick.data != streams.slab_tick_enemy.data`); sfx `_wiring` reads the shared `public/assets/audio` files. LISTEN.md §1: centroid 906 against 585 Hz (gap 321 Hz), dominant 883 against 587 Hz, audible 65 against 59 ms (gap 6 ms), both files 130 ms. **Re-measured here: the same numbers** | cue-measure:58-64 (gap ≥ 150 Hz or ≥ 20 ms), :66-82 (the guard can fail); audio-cues (the web plays sfx.gd's files). The same files, the same measurement | MATCH (one set of files; the ticks differ in pitch, not length). How they sound: row U2, HUMAN |

### Item 5: the rematch (R and Enter)
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| X10 | The held-R press stays fixed: a Reload held over a late burst of inputs (the Room replays it as catch-up) still rematches | n/a: Godot has no network Room and no catch-up (the press is an `InputMap` action read each frame) | slab-mode:415-436 'CI 154' passes at this head. The server fix: room.ts:374-376, the extra-input guard `((cmd.buttons ^ e.prevButtons) & COMBAT_BUTTONS) === 0` (comment :371-372). **Mutant (that guard removed): the test fails**, `expected { mode: 'slab', phase: 'ended', …(5) } to match object { phase: 'live', …(2) }`. CI 156: modes.spec.ts:137 (R, then Enter, on the real build) passed | WEB ONLY (Godot has no Room) |

The R and Enter resets themselves (score, positions, bot state, hit marker, countdown) are rows X1 and X5 to X9 below,
all MATCH: Godot presses the real R and Enter keys mid-cue and mid-death (rematch:80-81, :115-159), the web proves it
in unit tests, the e2e (both keys) and net-slab (R on two pages).

### Ink, the second client
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| N1 | No ink: no outline pass, no inverted hull, no comic death face | look_scene:54 (`outline_scan` of the real main scene: no outline node, no front-culled grown hull, no outline or ink material); look_contract:109-118 (the scan catches a planted inverted hull, so its PASS means something). Shots `p17-godot-own-fire.jpg` (L, the Corgi from behind at 4 m), `p17-godot-marker-cat.jpg` (S, two Cat bots close by) and `p17-godot-marker-near.jpg` (S, both bots on the slab): no ink line on any pet or prop | no-comic:14 (no comic/ink/outline/crease/halftone export), :18 (no ink in labs), :32 (no `styleInk` or comic pipeline name in src, labs, tests), :46, :57, :66 (the dead face: lids shut, no X eyes, no eye bars): 6 of 6 pass. Shot `p17-web-own-fire.jpg` (L, the Corgi from behind at about 4 m) and `p17-web-death.jpg` (the downed pet): no ink line on any pet or prop | MATCH |
| N2 | A second client on the slab | n/a: Godot has no online client | net-slab:268 (two browsers on the Node authority, Alpha a Corgi and Bravo a Cat: they see each other, their snapshot logs agree tick for tick at the start, the takedown, while scoring and at the end; the kill feed on both pages, the death panel on Bravo's; Alpha's R rematches both from 60-0). **Last CI pass: run 156** on `7a671f1`, 2.6 min, log: "start: 120 common ticks agree", "takedown: 120 common ticks agree … end: 120 agree … R 45 s after the takedown rematched both pages from 60-0". Not re-run here (the card allows it) | WEB ONLY (Godot has no second client) |

### Look rows (the lead fills these in: P1 PENDING; P2 filled in at W17 item 11 from the fresh confirm)
| # | Rule | Godot | Web | Status |
|---|---|---|---|---|
| P1 | Sky source: the same sky in both builds | the sky stitch is a later AAA pass | – | PENDING (lead) |
| P2 | Cover read (item 11): the cover pieces read as cover from each lane and base | kit_wet.gdshader:93-110: zone :93, graze and up-face mask :97-98, gain :100, guard :101-102, sat :103, pool :105-108, emission :109. look.gd:40 COVER; :54-56 COVER_VALUES (Forward+ fill .38, sheen .5, pool .2; Compatibility .5 / .35 / .2; band .22 / .28, guard .08 / .5, power 3); :62 COVER_MEAN; :64 moon; :72-82 COVER_SCALE (Forward+: Footing, BagWall, FloodMast, Container20; Compatibility: Container20 fill ×2.2, sheen ×.5); :220 _cover_params; :243 _cover_floods. CI, headless test_look_cover.gd: SHADER_RULE :99-114, COVER_MEAN from the GLBs :328-366, per-renderer values, scales and floods :251-287, glow bound :293-303, draw items exact :304-312. PASS, suite 26/26. Rendered, local (15 split runs per renderer, COVER.md §8): Forward+ 15/15, Compatibility 15/15. Dark bodies ≤ 39.8 / ≤ 36.7; std ≥ ×1.00 on cover views; edge minimum 15.9 / 17.9. Gap at 10 / 30 m: corgi base 30.7 / 13.2, cat base 38.8 / 34.7 (Forward+). Corgi base at 60 m on Forward+ is 7.8, REPORTED (W17 AIR). Draws ×1.000 | style-webgpu.js:600-633 coverRead: zone :605, gain :610, guard :611-612, sat :613, pool :615-618, graze :621, up mask :624-625, moon :626, emission :632. style-webgpu.js:570 STYLE_COVER. style-tokens.js:225-229: fill .16, sheen .10, sat 1, pool 1, plus the shared terms. kit-glb.ts:113 KIT_COVER_SCALE (Container20 ×2.1, FloodMast ×0.85, fill only); :118 KIT_COVER_MEAN; :503-504 coverBase; :576 kitCoverFloods; :664 zone 1.25. CI: kit-cover.test.ts 11/11 (shared terms parsed from look.gd and kit_wet.gdshader; COVER_MEAN recomputed to ≤ 0.0005; floods = the_lot.json). Local: labs/cover-metric.mjs (bar :33-43, exit :260-261), 29 views at q=high: COVER PASS; q=med gives identical numbers (verifier). Edge minimum 15.1 (Pipe 60 m); dark ≤ 39.5; lit lift ≤ +4.1; std Pipe ×0.65 (floor 0.60), rim BagWall ×0.64 (floor 0.59); draws 2106 → 2106 | DIFF (allowed: per-build gains and per-piece scales, lead ruling 2026-10-12). The shared rule MATCHES term for term (verifier: 9 Godot-only mutants fail the web test; COVER_MEAN recomputed independently) |
| P2a | The pool fade where no flood actually lights the piece | n/a. Every Godot quality builds all 4 floods (only shadows vary), and pool_k 0.2 keeps ≥ 80 % of the fill. | The web's flood budget is high 4 / medium 2 / low 0 (style-tokens.js:209), but kitCoverFloods (kit-glb.ts:576) always passes all 4, and pool_k is 1.0. At q=low the pit footings (pool .95–1.0) and rim bag walls 2–6 (.94–.98) lose the fill with no light to replace it: Footing[1] edge 12.2 / 10.7 at 10 / 30 m, COVER FAIL. q=med and q=high PASS. | DEFECT (web only, low tier; not in the gated config; no regression, since read-off is also 12.2). Owner: tw-look |
| P2b | Flood light on the corgi pit, read off | Forward+ body L* 13.3–17.7, Compatibility 8.5–18.6 (COVER.md §4): a dark view; the cool fill makes the read | 39.0–40.9 at 10 / 30 m (COVER.md Web): a lit view; warm sodium light makes the read, which is why the web's pool_k is 1.0 | DEFECT (pre-existing flood look, predates item 11; Godot wins). Owner: tw-look, in the W17 AAA/AIR pass |
| P2c | The rule's untested seams | Neither test pins `ly = VERTEX.y` (kit_wet.gdshader:61) or the sheen colour that _cover_params sends (look.gd:231). SHADER_RULE matches substrings, so an extra term after the rule passes headless. | kit-cover parses constants, not the form of the graze or ly. Floods-not-passed and coverBase-0 pass CI; only the local metric catches them. | DEFECT (test gap, minor). Owners: g-atmos and tw-look |

### HUMAN (logged, not done)
| # | Step | Status |
|---|---|---|
| U1 | The plain slab hold: `npm run godot -- -- --demo`, walk to the middle of the slab, hold it alone for 1 s; the slab line turns to `SLAB  CORGI COMPANY HOLDING  +1/s`, one point lands and `slab_tick` plays. Aided runs (a test, `--bots-only`, a script) do not count | HUMAN, not done |
| U2 | A listen of the six cues on a machine with speakers, both builds, per LISTEN.md §3 (heard or not, loudness against the shot, clipping, length, your tick against theirs without looking, the confirm against your own shot at 10 shots/s, win and lose) | HUMAN, not done |

## B. The 95 w15 rows, re-run at this head

### §1 The slab marker
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| M1 | Hangs over the slab centre + 4.5 m | marker:71-72 (`Hud.MARKER_LIFT` == 4.5); :272-276 (408 live views) | slab-hud:32; :333-334 | MATCH |
| M2 | The words sit above the shape, never below | marker:130-132; draw:77-81 | slab-hud:37; DOM order by shot only (G16): `p17-web-hit-received.jpg` (the marker's words over its diamond) | MATCH (G16) |
| M3 | Step 1: clamp the box into the safe area (16 sides, 110 top, 112 bottom; 720p units) | marker:69-70 (literal); :212-213; :429-430 | slab-hud:67; :74; :459-462 | MATCH |
| M4 | Step 2: lift off another living pet, 2 clear, at most 120, never above the safe top | marker:65-66, :67-68; :148-151, :156-157, :168-170, :177-179, :184-185; live :278-279 | slab-hud:68-69; :105-106, :109, :113, :117-118; :452-457 | MATCH |
| M5 | Step 3: just below the lowest covered pet, then on down past each next pet (rev. 4) | marker:162-164; :194-199 | slab-hud:86-87; :439-441 | MATCH |
| M6 | Step 4: nothing clears, the box keeps step 2's place; nothing clamps after | marker:168-170; :191 + :194; :354-356 | slab-hud:109-110, :113-114, :445-446 | MATCH |
| M7 | Never covers the scores, the timer or the slab line | marker:177-179; :425-435 | slab-hud:94-97 | MATCH |
| M8 | Only other living pets are dodged, never the player's own | marker:416-422; :283-289 | slab-hud:321-323; :332, :336 | MATCH |
| M9 | Line 1 `SLAB  <N> m` (the camera's ground distance), line 2 the state word | marker:88-89; live :267-269 | slab-hud:27-31; :343-344 | MATCH |
| M10 | Nobody on it: `NEUTRAL`, hollow diamond, white | marker:100-101, :106-108; draw:69-72 | slab-hud:27; :38-39 | MATCH |
| M11 | One team alone: the team name, filled diamond, team colour lightened | marker:98-99, :110-113 | slab-hud:29-30; :40 | MATCH |
| M12 | Both teams: `CONTESTED`, a diamond split by a bar, amber | marker:94-95, :115-126; draw:69-70; shot `p17-godot-marker-near.jpg` (CONTESTED, split diamond) | slab-hud:31; :43 | MATCH |
| M13 | The shape carries the state without colour | marker:127-128 | slab-hud:44 | MATCH |
| M14 | Off screen: clamps to the edge, keeps both lines | marker:212-213 | slab-hud:74 | MATCH |
| M15 | Behind the camera: on the bottom edge, toward the slab's side | marker:220-223 | slab-hud:78-79; :470-471 | MATCH (the formulas differ, as w15 noted; only Godot tests the side from a world position) |
| M16 | Behind the camera the steps still run against the pets on screen | marker:206-207 | slab-hud:475-476 | MATCH |
| M17 | Hidden while the player stands on the slab | marker:477-478; :338-339 | slab-hud:124, :126 | MATCH |
| M18 | Hidden while the player is down | marker:491-492; death:164-165; shot `p17-godot-death.jpg` (no marker) | slab-hud:125-126; :380; shot `p17-web-death.jpg` (no marker) | MATCH |
| M19 | Hidden once the match is over, with the slab line; back after the rematch | marker:504-507, :513-515 | slab-hud:127; :292-293; e2e:166 | MATCH |
| M20 | `LINEUP_AIM_LIFT` 1.5 m left unchanged | no test (match.gd unchanged since w15) | n/a (`--lineup` is Godot's) | GODOT ONLY (G19) |

### §2 The death panel
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| D1 | Four lines in the centre of the screen | death:130-131; :156-157 | slab-hud:373-378; centring by shot only (G16): `p17-web-death.jpg` (centred on a dim rounded backing) | MATCH (G16) |
| D2 | Line 1 with each build's display names | death:91-92; :130-131, :138-139 | slab-hud:148-149; :374; :387 | DIFF (allowed: §2) |
| D3 | No killer: `TAKEN DOWN BY THE LOT`, no glyph, no team | death:96-97; :187-190; fall:59-65 | slab-hud:162-164; :392 | MATCH |
| D4 | Line 2 `YOU: <YOUR TEAM>` | death:89-92; :140-141 | slab-hud:150; :375 | MATCH |
| D5 | Killer-team glyph before the team name, in its shape and colour | death:105-108; :149-152; draw:166-171 | slab-hud:154, :157, :172-175; colour by shot only (G16): `p17-web-death.jpg` (a red-pink ▲ before CAT CADRE) | MATCH (G16) |
| D6 | Base names `THE FOUNDATION` / `THE SCAFFOLDS` | death:122-123 (`respawn_zone(0)`); SCAFFOLDS only as synthetic input (:98-102); probe: `respawn_zone(1)` names THE SCAFFOLDS | slab-hud:134-136 | MATCH (G9) |
| D7 | `<N>`: 142 m for the Corgis, 132 m for the Cats | No Godot test pins either number (G9). Probe: 142.24 and 132.41 m. Shot `p17-godot-death.jpg`: 142 m | slab-hud:139, :143; slab-mode:628, :635-637 | MATCH (G9) |
| D8 | `BACK IN <s.s>` in tenths | death:134-136 | slab-hud:152-153, :163; :381; :527 | MATCH |
| D9 | `--demo` first match: `THE SLAB'S EDGE` and that spot's distance; the rematch the base again | death:55-57, :64-65, :75-76 | n/a | GODOT ONLY (allowed) |
| D10 | Backing: a dim rounded panel, black at 0.55, behind the lines | clauses:135-137, :140-141; shot `p17-godot-death.jpg` | slab-hud:168; rounded and behind by shot only (G16): `p17-web-death.jpg` (centred on a dim rounded backing) | MATCH (G16) |
| D11 | The panel goes once the player is back up | death:181-182 | slab-hud:394; :579 | MATCH |

### §3 Hits and sound
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| H1 | Own shot: the crosshair gap opens with the spread (slab mode only; Godot wins, lead ruling W17) | test_hud_crosshair.gd:286-311 (build_overlay: gap = 5 + spread × 420 for six spreads, centred; the rifle's spreads give 13.796 hip, 7.566 aim, 18.195 run, 24.352 air, 14.969 one shot; :305-310 pin tuning.gd RIFLE), with :57-81 + :132-175 (hud.gd's own _draw_item compiled into a recorder) and :258-284 (each arm from c + d·gap to c + d·(gap + 9), 4 px dark under 2 px, dot r 1.6); :343-417 live 1v0 (gap = 5 + (current_spread() + rifle.bloom) × 420: rest :350-356, one shot's bloom :357-362, aim :363-369, every frame of a run to 18.195 and the stop :371-392, every frame in the air to 24.352 and the landing :393-417) | slab-crosshair.test.ts:42-55 (the rule; the web rifle equals tuning.gd), :57-71 (from a snapshot: hip, aim, run, sprint clamp, air, bloom; firing and sprinting add nothing), :73-108 (bloom +0.16°, cap 1.6°, 8°/s; shots heard in one frame recover over sim time), :110-123 (DOM write at 4 screens: 13.8, 20.69, 27.59, 10.35 px), :159-205 (a real slab sim on The Lot: rest 13.796, aim 7.566, every tick of a run to 18.195, every tick in the air, 24.352 standing), :207-223 (fire in place: no +4, no kick; peak 14.969 on a shot tick), :225-261 (a slow frame), :274-301 (every other mode keeps HEAD's rule; snapping), :303-319 (wiring: hud.ts slab gate, crosshairArms, simT; main.ts serverSec). Live (verify r3, 720p): [data-xr] translateX(13.8px). Shots h1h20-web-rest.jpg, h1h20-web-moving.jpg, h1h20-web-crosshair.jpg | **MATCH** at rest, aiming, moving and in the air (G10 closed; both builds test it). Firing: the display rule matches; the two sims' rifle timing differs (row H1a) |
| H1a | Rifle fire timing: Godot's burst double tap and its in-tick order | rifle.gd:79 floors the cooldown at −1/fire_rate, so an idle rifle banks a whole interval. Every fresh pull after at least 0.1 s idle fires on two back-to-back ticks (can_fire :76, cooldown += 1/rate :104): 5 shots in the first 20 ticks instead of 4. player.gd:106-107 fires before rifle.gd:80 recovers the bloom in the same tick (the rifle is the player's descendant), so the HUD reads 13.992 on each shot tick and 14.187 on a burst's second tick. No test of either; test_game_rifle.gd:56-59 pins only the refusal straight after a shot | weapon-system.ts:163 decrements only a positive cooldown and :203 zeroes a negative one: no banking, 4 shots in 20 ticks (combat.test.ts:138-145 pins exactly fireRate shots per 60 ticks). :164 recovers the bloom before :196 fires, so the HUD reads 14.969 on each shot tick (slab-crosshair.test.ts:217 pins the web peak) | **DEFECT**. Owner: lead (the rule), then g-game (rifle.gd / player.gd: floor the cooldown at −delta and/or recover before firing). If the lead keeps Godot's timing instead, tw-sim takes weapon-system.ts and tw-view realigns slab-crosshair.test.ts:217. Steady-state cones are equal; H1's display rule is unaffected |
| H1b | Sprint while firing | player.gd:100: `sprint := … and not aiming and not firing`, so a firing corgi runs at 6.4 m/s (Cat 6.6; tuning.gd:19-21). No test | movement.ts:73: `wantsSprint = held(Sprint) && !aiming && cmd.mz > 0.1`, with no firing check, so a firing corgi sprints at 9.6 m/s (Cat 8.8). No test. H1's gap is unaffected: the spread clamps at the run speed (player.gd:119, crosshair.ts:76) | **DEFECT**. Owner: tw-sim, via the lead (src/sim/systems/movement.ts: drop sprint while Fire is held, plus a unit test); Godot wins |
| H2 | Own shot: a muzzle flash | no test (rifle.gd:29-41, :173-176); shot `p17-godot-own-shot-gray.jpg` (L) shows it | weak test: fx-particles:148 (the recipe spawns; nothing ties it to a slab shot); shot `p17-web-own-shot-gray.jpg` (L) shows it | MATCH (by shot; w15 WEB ONLY, weak; tests still G11) |
| H3 | Body and head confirms 0.18 s, a kill 0.35 s; a body hit does not cut a kill short | clauses:69-70, :77-79, :84-86, :89-90 | slab-hud:208-210, :216-219 | MATCH |
| H4 | Body: an X of four short lines, white | hits:64-65; draw:104-105 | slab-hud:181, :193-194, :201 | MATCH (shape; size H20) |
| H5 | Head: the X plus a small filled diamond, yellow | hits:67-70; draw:106-107 | slab-hud:182, :195-196, :201 | MATCH |
| H6 | Kill: a larger X plus a ring about 18 px across, red | hits:72-80; draw:108-109 | slab-hud:183, :186-187, :197, :201 | MATCH (shape and ring; size H20) |
| H7 | The kinds differ in shape, not only colour | hits:61-62; shot `p17-godot-hits-gray.jpg` (Y) | slab-hud:199; shot `p17-web-hits-gray.jpg` (Y) | MATCH |
| H8 | Received: a wedge on a ring about 110 px out, toward the attacker, relative to the camera | clauses:51-52; hits:84-104, :119-125; live :199-204 | slab-hud:240-243, :257-262; :357, :361 | MATCH |
| H9 | The wedge holds the point of the hit, never follows the attacker | hits:223-225 | slab-hud:233; :355-357 | MATCH |
| H10 | The wedge fades over 0.6 s | clauses:112-113; draw:128-129; hits:232-233 | slab-hud:232, :234; :358 | MATCH |
| H11 | A wedge appears for every received hit | always (hits:199-200) | no wedge for an attacker never seen in a snapshot (slab-hud:237-239) | DIFF (allowed, G20) |
| H12 | HP chip: white, the HP lost, drains over 0.4 s, follows the HP | clauses:104-106; hits:208-212, :228-229; death:162-163; shot `p17-godot-hit-received-gray.jpg` | slab-hud:267-279; :400-404 | MATCH |
| H13 | Red flash at alpha 0.25 or less, never the only cue | clauses:47-48; hits:213-215, :238-239 | slab-hud:249-251 (peak 0.175; the web shots log `flash 0.175`) | MATCH |
| H14 | A wedge over the marker dims the marker to 0.35 | clauses:49-50; draw:144-150 | slab-hud:503-505, :508, :514; shot `p17-web-hit-received.jpg` (the wedge over the marker, the marker dimmed) | MATCH |
| H15 | While the player is down: no confirm and no wedge | draw:152-158 | slab-hud:418-419, :424-425 | MATCH |
| H16 | All six cues play | sfx:217, :285 (this run 9/8/2/2/1/1) | audio-cues:227-228; :153-162 | MATCH |
| H17 | Own and enemy ticks differ in length or pitch | sfx:123-125 | cue-measure:58-64, :66-82 | MATCH (row T4) |
| H18 | Your point `slab_tick`, theirs `slab_tick_enemy`; win or lose; a draw loses | sfx:62-64, :287-288 | audio-cues:39-52 | MATCH |
| H19 | No music | no test (sfx.gd:4) | audio-cues:195-207 | WEB ONLY (G13) |
| H20 | Confirm X (Godot wins). Lead ruling 2026-10-12: parity is the drawing rule, pinned by tests in both builds: arms from d·r0 to d·r1 on the unnormalised (±1, ±1) diagonals (5-10, 6-15 for a kill); no caps (butt, as draw_line); the cue colour; colour width w (2.5, 2.5, 3.0) over an underlay w + 2 at Color(0, 0, 0, 0.8·a); paint order dark lines, colour lines, then the kill ring dark, then in colour. Painted ends within 1 px; the AA residual is reported, not gated | test_hud_crosshair.gd:112-130 with :313-321 (pure hit_cue: four lines d·r0→d·r1 reaching 7.071-14.142 and 8.485-21.213 ±0.01) and :426 (live body, head, kill hits). Paint: :57-81 + :147-175 (hud.gd's own _draw_item and draw_prims compiled into a recorder; _draw_item must call draw_prims exactly once) and :44-53 + :177-256 (the exact call list: [head: 4 px dark rim polyline]; 4 draw_line dark 0.8·a, w + 2; 4 draw_line CUE colour, alpha a, w; [head: fill]; [kill: draw_arc dark w + 2, then colour w, r 9, 0-TAU]; each call's colour and alpha, width and geometry; pr.width 2.5/2.5/3.0), run pure at a = 1 and 0.5 (:322-329) and live (:427). Mutants killed: verify r3 GV1-GV8 (incl. the rings between the line loops, a per-arm interleave, colour w + 0.5, dark w + 1.5, kill width 3.5, alpha 0.8·a², fade dropped); the maker's G2-G13 | slab-hud.test.ts:181-203 (the shapes; colours 0xffffff / 0xffd933 / 0xff4033 at :202), :205-231 (slabHitArms = hud.gd's arms in its order; the SVG draws exactly those 8 lines), :233-280 (the SVG's paint in document order: 4 dark lines rgba(0,0,0,0.8) w + 2 butt; 4 colour lines w butt; for a kill the dark ring, then the colour ring, after the lines; the head diamond last; w + 2 = 4.5/5, w = 2.5/3), :282-302 (.hc: 1 viewBox unit = 1 HUD unit; no CSS stroke rule and no opacity attribute may repaint the X: the lead's V8/V9 mutants fail). Mutants killed: verify r3 V1-V6; the maker's W1-W7. Live 720p (verify r3): computed kill paint g.under[rgba(0,0,0,0.8) 5px butt]{4 lines} → g.over[rgb(255,64,51) 3px butt]{4 lines} → g.under[0.8 5px]{circle r 9} → g.over[3px]{circle r 9}; body and head 4.5/2.5 butt 0.8. Painted (meas.py, at least 50% lit; Godot = verify r3's render of draw_prims, gl_compatibility): body and head 7.78-13.44 against 7.11-14.16 (0.67 / 0.72 px); kill outer 20.51 against 21.22 (0.71 px); kill inner 7.78 in both. Kill notch at 10.6 px: web luminance 53.5, Godot 51.2 (round 2: 104). The web pins the underlay alpha at full show only (the ·a is the .hc opacity, slab-hud.ts:964; see row H20b). Shot h1h20-web-confirm-x.jpg | **MATCH** (G21 closed). Residual reported, not gated: Godot's AA feather about 0.42 px past each line end and on the arc (k8: Godot 77, web 104); off-axis pixels more than 0.25 apart: kill 24, body and head 32 (AA ends, the .hc drop-shadow, the crosshair style; row H20b) |
| H20a | No confirm or wedge once the match is over or while you are down | hud.gd:786; test_hud_draw.gd:151-158 | slab-hud.ts:710; slab-hud.test.ts:502-549 (W17 H1/H20 round 2) | **MATCH** |
| H20b | Paint style around the X and the crosshair (pre-existing, outside H20's rule) | (a) Fade: each primitive's alpha is multiplied (dark 0.8·a, colour a; hud.gd:737). (b) Head diamond: a 4 px dark rim polyline first (hud.gd:741-744), the fill after the colour lines (:752-753); pinned by test_hud_crosshair.gd:177-198. (c) Crosshair: 2 px arms over a 4 px Color(0, 0, 0, 0.6) line, dot r 1.6 (hud.gd:854-856). (d) No glow or shadow | (a) The composed SVG is faded once by the .hc opacity (slab-hud.ts:964), after its drop-shadow: equal at full show, different mid-fade; no unit test of the write (V7 survives). (b) The diamond last, with a 1.2 px rgba(0,0,0,.75) stroke and no 4 px rim (slab-hud.ts:445-447; pinned last by slab-hud.test.ts:233-280). (c) The general HUD's 3 px arms with an ink shadow (hud.ts:172). (d) `.hc` drop-shadow(0 0 1.5u rgba(0,0,0,.9)) (slab-hud.ts:776) darkens the pixel past each X end (body k10: web 43, Godot 132) | **DEFECT** (minor; logged, not routed until the lead rules adopt-Godot or allowed DIFF). Owner: lead, then tw-view. The painted crosshair gap still agrees (13.97 against 14.0) |

### §4 HUD fields
| # | Field | Godot proof | Web proof | Status |
|---|---|---|---|---|
| F1 | Scores and a bar racing to 60 | hits:146-151; shot `p17-godot-hit-received.jpg` | e2e:93-97; slab-view:140-141; shot `p17-web-death.jpg` | MATCH |
| F2 | Timer `m:ss`, red in the last 30 s | clauses:157-159 | slab-view:115-121; :151 | MATCH |
| F3 | `OVERTIME` in amber after 3:00 while tied | clauses:163-164 | slab-view:122-123, :126, :151 | MATCH |
| F4 | Slab line; hidden once won | clauses:174-175, :204-205; marker:504-505 | slab-view:132-136, :159-161; slab-hud:291-293; e2e:98, :166 | MATCH |
| F5 | `YOU: <TEAM>` over the HP bar | hits:136-140 | slab-hud:285-286; e2e:112 | MATCH |
| F6 | HP: the number and the bar, with the chip | hits:146 | e2e:99; slab-view:145-146 | MATCH |
| F7 | Ammo `<n> / 30` or `RELOADING` | clauses:183-184; shot `p17-godot-own-fire.jpg` (`26 / 30` while firing) | slab-view:147-148; e2e:100; shot `p17-web-own-fire.jpg` (`25 / 30`) | MATCH |
| F8 | Win title | clauses:197-203; shot `p17-godot-win.jpg` | slab-view:174-178; e2e:163 | MATCH |
| F9 | Win sub: score, `You: <k> takedowns · <d> knockouts`, the rematch line | clauses:196-199; shot `p17-godot-win.jpg` | slab-view:174-176 | MATCH |
| F10 | Rematch line | clauses:18, :196; shot `p17-godot-win.jpg` | slab-view:179; e2e:164 | DIFF (allowed: §4) |
| F11 | fps: none in Godot; the web only with `?debug` | hits:142-145 | slab-view:166-168; e2e:102 | MATCH |
| F12 | Hint (Godot) names X with R | clauses:187-188; hits:146-151 | not tested | GODOT ONLY (allowed) |
| F13 | No nameplates in a slab match | no test | e2e:116 | WEB ONLY (G12) |
| F14 | `PLACEHOLDER PETS` tag | hits:146; every Godot shot | e2e:114-115; every web shot | MATCH |

### §5 Rematch
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| X1 | R, Enter and pad Start rematch on the winner screen | rematch:80-81 (real R and Enter key events), :132-133; input:30-31, :39-40 | view-input:48-54; :79; slab-mode:397-399; e2e:161, :182 (real R, then real Enter; CI 156 pass); net-slab:268 (R, two pages) | MATCH |
| X2 | No rematch during play | rematch:32-33 | view-input:45-46; slab-mode:438-453 | MATCH |
| X3 | Rematch delay | W17 G-REMATCH: a press within 1 s of the end is ignored and a key held over the end never rematches (`REMATCH_DELAY` 1.0, tuning.gd:44, applied at match.gd:442-450). Tests at the X3 commit: test_game_rematch.gd `_guard` (:265-340: R at 0.02 s and Enter at 0.52 s ignored, R at 1.00 s rematches, R held 1.5 s ignored) and `_end_frame` (:234-261: the end frame's delta is skipped, so the guard is 60 frames as on the web) | a press within 1 s of the end is ignored: slab-mode:389-391 at the X3 commit (`SLAB.rematchDelay` 1, modes.ts:194); e2e:169-172 waits for the authority's tick. slab-mode:109 pins the web value to tuning.gd's `REMATCH_DELAY` | **MATCH** (W17 G-REMATCH; was DEFECT, G3) |
| X4 | Which pad buttons rematch | Start only (input_setup.gd:20-21; input:19) | pad X sends Reload (input.ts:113) and any Reload press rematches (match/index.ts:281-284) | **DEFECT** (G4, lead) |
| X5 | Score 0 - 0, the clock back to 3:00, no respawn countdown left | rematch:135-136, :139-140, :137-138 | slab-mode:399-400; e2e:185, :188-189 | MATCH |
| X6 | Every pet at its start slot, alive, full HP | rematch:148-149, :62-64; bot_roles:84-92 | slab-mode:404-410; :477-478 | MATCH |
| X7 | The bots' state reset | bot_roles:84-92 (this run: "after the rematch 4 match it"); :69-76 | slab-mode:455-483 (passes: a fresh brain on its start slot, odometer < 1 m a tick later); match/index.ts:316, :347, :350-354; brain.ts:197-206 | MATCH |
| X8 | No HUD leftovers, mid-cue and mid-death | rematch:115-121, :150-159 | slab-hud:550-564, :566-580 (unit); e2e:187-198 (smoke: e2e:127-136 says why) | MATCH (web: unit-proven) |
| X9 | Kill feed cleared | rematch:116, :153 | e2e:141-156 (a takedown rides every result snapshot), :180-181 (the feed is up), :183-186 (0 lines one frame after the rematch's snapshot); CI 156 pass | MATCH |

### Match rules
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| R1 | 1 point per full second, one team alone | slab:27-28, :33-34 | slab-mode:145-149 | MATCH |
| R2 | Two pets of one team still score 1/s | no test | slab-mode:154 | WEB ONLY (G7) |
| R3 | Contested or empty: nobody scores | slab:39-42 | slab-mode:167-169; :158 | MATCH |
| R4 | The second being counted starts over when the holder changes | no test | slab-mode:180-182 | WEB ONLY (G7) |
| R5 | A downed pet neither holds nor contests | slab:51-52 | slab-mode:198 | MATCH |
| R6 | First to 60 wins | rematch:43-44 | slab-mode:301-302 | MATCH |
| R7 | At 3:00 the leader wins | rematch:69-70; sfx:282-283 | slab-mode:317-318 | MATCH |
| R8 | 60, 180 s, 60 s, 3 s, 1 s | tuning.gd:37-41 | slab-mode:104-109 (reads tuning.gd) | MATCH |
| R9a | Tied at 3:00: overtime | rematch:77-78 | slab-mode:324-325 | MATCH |
| R9b | Overtime ends when someone leads | no test | slab-mode:332-333 | WEB ONLY (G7) |
| R10 | Overtime at most 60 s, then a draw | sfx:279-283 | slab-mode:342-343 | MATCH |
| R11 | Start slots | respawn:110-112, :117-119; rematch:148-149 | slab-mode:529-530; :557; :581-587 | MATCH |
| R12 | Respawn points; teammates on different points | respawn:77-79, :84-85, :128-130; probe (K5) | slab-mode:533-534; :568-569; :202; probe (K5) | MATCH |
| R13 | Back 3 s after a takedown | death:134-136; probe: 181 physics frames, 40 of 40 | slab-mode:197; :243; probe: 181 ticks, 40 of 40 | MATCH |
| R14 | A 1 s spawn shield that holds through firing | no test | slab-mode:206-213; :705 | WEB ONLY (G6) |
| R15 | A fall below y − 40 m: taken down by THE LOT, no credit | fall:38-41, :43-58 | slab-mode:218-248; :274-276; slab-hud:392; slab-view:153 | MATCH |
| R15a | A fall is nobody's kill in the sound | n/a (no death sound in Godot) | audio-death-by:36-42, :44-52; guard audio/index.ts:321; audio-intensity-fall:9-11, :13-17 (guard audio/intensity.ts:32); audio-cues:265-295 | WEB ONLY |
| R15b | A fall is nobody's kill for the camera | n/a (no kill camera reaction in Godot) | fx-reactions-fall:9-12, :14-19; guard fx/reactions.ts:70 | WEB ONLY |
| R16 | Takedown feed `<killer>  >  <victim>` | shot `p17-godot-death.jpg` (S): `Cat Bot 1  >  You` | slab-view:152; shot `p17-web-death.jpg`: `Cat 2  >  Rex` | MATCH |

### Bots
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| B1 | Bots spend at most 5 % of their slab time in the 1 m edge band | bot_contest:85-87 (this run 0.8 %), :81-84 (80.0 pet-s) | tests/unit/slab-contest.test.ts (W17 TW-SIM: Godot's scenario, seeds 1-3, 80.0 of 80 pet-s, edge band 0.0 / 0.0 / 0.3 %; step-in case; crowded-line case; Godot's on-slab mix and the final cut pinned per tick; 7 mutants fail; docs/qa/w17/WEB-CONTEST.md) | **MATCH** (W17: the twin runs Godot's contest rule; was GODOT ONLY) |
| B2 | 2v2 roles: one bot holds, one approaches (Sprint C card item 8) | Labels and intent only (bot_roles parts 1-3); in play the roles stay nominal: the trap in bot.gd `_steer()` is unchanged in behaviour since `7a671f1` (G-BAL changed only the aim and moved the lines; the APPROACH bot is at its post 0-1 % of its alive time, and 16-18 % with post in zone + the fix, BOT-ROLES § G-BAL) | no roles | **DEFECT** (w15 NOT MET, G22, g-bot) |
| B3 | Bot aim geometry (W17 G-BAL): every bot looks, checks sight and fires from 0.936 m over its feet and aims 0.66 m over its target's feet, whatever either species; humans fire from the camera | At the G-BAL commit: bot.gd:21-22 (AIM_EYE, AIM_CHEST), `_eye()` / `_aim_point()`, used by the aim tracking, the view check, `_los`, the FIRE_CONE gate and the shot origin. bot_roles part 4 (`_aim_parity`: a Corgi and a Cat bot 3 m apart aim 0.0021 rad apart, max 0.008; shipped 0.0284 FAIL) and part 5 (`_aim_sites`: every site on the helpers, and the constants equal the Corgi's pet.gd 0.78 h / 0.55 h); the lead's mutants on the shot origin, `_los`, the cone, the view check and AIM_EYE each fail | species heights: eye 0.875 h (Corgi 1.050 m, Cat 1.1025 m; src/shared/content/weapons.ts:231, src/sim/combat/state.ts:153-155), aim 0.55 h (0.660 / 0.693 m) or 0.9 h on a head roll (src/sim/ai/brain.ts:243, :263, :274, :660-662); shots from eyeHeight (src/sim/combat/weapon-system.ts:119); no test | **DEFECT** (W17 G-BAL, G25, tw-sim). W17 B3 attempt NOT ADOPTED: mirroring the heights moved the twin's 1v1 from 56.9 % to 68.8 % Cat (n 160, p 0.03), over the bar and opposite to Godot's lab; the twin's fire gate is a yaw/pitch window, not FIRE_CONE (docs/qa/w17/WEB-AIM.md) |

## DEFECT rows: owner, file:line, repro
| Row | Defect | Owner | Where | Repro |
|---|---|---|---|---|
| K6 (new; RULED MATCH, HUD_CONTRACT rev 5) | The card's `<N> m` is the distance of the centre of the base's respawn points, but nobody respawns there: the respawn rule, run 3 s later, takes the point farthest from the nearest enemy, an end point. Measured in 80 respawns (40 per build): Corgis 143.5 m (37) or 140.9 m (3) against `142 m`; Cats 135.3 m (35) or 129.7 m (5) against `132 m`. The base is always right (K5). Both builds follow HUD_CONTRACT §2 as written, so this is the contract against the W17 card's "the place you respawn must match what the card said" | lead (rule), then g-hud (Godot) and tw-view (web) | Godot `engines/godot/game/match.gd:477-491` (`respawn_zone`: the centre) against :540-559 (`best_spawn`); web `src/client/ui/slab-hud.ts:327-342` (`slabRespawnZone`: the centre) against `src/sim/match/slab.ts:319-334` (`slabRespawnPoint`) | Godot: `npm run godot`, let the Cat bot take you down while it stands on its own half: the panel reads `… 142 m TO THE SLAB`; you stand up at (-74.0, -123.0), 143.5 m from the slab centre. A Cat bot downed comes back at (68.0, 117.0), 135.3 m, against `respawn_zone(1)` 132 m. Web: `npm run twin`, add `&team=1&slabHurt`: the panel reads `BACK AT THE SCAFFOLDS  ·  132 m TO THE SLAB`; you stand up at (68, 117), 135.3 m. Probes: `scratchpad/qa17-probes/test_zz_qa17_card.gd`, `zz-qa17-card.test.ts`. Ways out: (a) the lead rules the base's spread (Corgis ±1.5 m, Cats ±3.3 m) acceptable, and this row turns MATCH; (b) choose the point at the knockout, keep it, and print its distance; (c) print the range (`130-135 m`) |
| H1 | **CLOSED (W17 H1/H20, row H1 MATCH).** Was: no test in either build that the crosshair gap opens with the spread, and the builds differed (w15 G10) | tw-view | `src/client/ui/crosshair.ts`, `hud.ts` (slab gate), `engines/godot/tests/test_hud_crosshair.gd` | `tests/unit/slab-crosshair.test.ts` |
| H1a | Rifle fire timing: Godot banks one interval when idle, so every fresh trigger pull fires on two back-to-back ticks (5 shots in the first 20 ticks against the web's 4), and it fires before the tick's bloom recovery (the web recovers first) | lead, then g-game (or tw-sim if the lead keeps Godot's timing) | `engines/godot/game/rifle.gd:76`, `:79`, `:80`, `:104`; `player.gd:106-107`; against `src/sim/combat/weapon-system.ts:163`, `:164`, `:196`, `:203` | From 0.1 s idle hold fire for 20 ticks: Godot 5 shots, web 4; the HUD on a shot tick reads 13.992 in Godot and 14.969 on the web |
| H1b | Sprint while firing: the web lets a firing pet sprint (9.6 m/s corgi); Godot does not (6.4 m/s) | tw-sim, via the lead (movement is shared with prediction) | `src/sim/systems/movement.ts:73` against `engines/godot/game/player.gd:100` | Hold sprint, forward and fire: web 9.6 m/s, Godot 6.4 m/s (corgi) |
| H20 | **CLOSED (W17 H1/H20, row H20 MATCH under the lead's drawing-rule ruling).** Was: the web's confirm X was 1/√2 of Godot's | tw-view | `src/client/ui/slab-hud.ts` | `tests/unit/slab-hud.test.ts` |
| H20b | Paint style around the X and the crosshair (pre-existing, outside H20's rule): the fade composition, the head diamond's rim and order, the crosshair arm style and the `.hc` drop-shadow | lead (adopt Godot or allow as a DIFF), then tw-view | `src/client/ui/slab-hud.ts:445-447`, `:776`, `:964` against `engines/godot/game/hud.gd:737-753`, `:854-856` | scratchpad verify-h1h20c/analysis-720.txt (body k10: web 43 against Godot 132) and docs/qa/w17/h1h20-web-confirm-x.jpg |
| X3 | **CLOSED (W17 G-REMATCH, row X3 MATCH).** Was: the web ignores a rematch press for 1 s after the end; Godot rematched on the first press. Not in the contract (w15 G3) | lead | `src/shared/content/modes.ts:194` (`rematchDelay: 1`), applied at `src/sim/match/index.ts:307`; Godot `engines/godot/tests/test_game_rematch.gd:45-55` | Web: end a match and press R within 1 s: nothing (`tests/unit/slab-mode.test.ts:387-389`); Godot: the first R rematches |
| X4 | Pad X rematches on the web only (w15 G4) | lead | `src/client/input/input.ts:113` (pad X sends Reload) and `src/sim/match/index.ts:281-283` (any Reload press rematches); Godot `engines/godot/game/input_setup.gd:20-21` (pad X is `reload` only, Start is `rematch`) | On the web winner screen press pad X: rematch. In Godot pad X does not |
| B2 | Sprint C item 8 NOT MET: the 2v2 roles stay nominal in play (the APPROACH bot is at its post under 1 % of its alive time) | g-bot (the trap card) | `engines/godot/game/bot.gd` `_steer()` (behaviour unchanged since 7a671f1; the lines moved with G-BAL) | `docs/qa/w15/bot-roles.md:89-93`; docs/qa/w17/BOT-ROLES.md § G-BAL role bar (post in zone + the fix: at its post 16.2 % / 17.9 %) |
| B3 | The twin's bots aim with species eye and aim heights; Godot's use one geometry since W17 G-BAL. The twin's Cat bot looks 0.4425 m down to a Corgi's aim point and its Corgi bot 0.357 m (Godot: 0.276 m both). At 3 m their idealAim pitches differ by about 0.028 rad (Godot 0.0021) | tw-sim | `src/sim/ai/brain.ts:243`, `:263`, `:660-662`; `src/sim/combat/weapon-system.ts:119` (shared with humans: a bot-only branch on `ownerPid === null`) against `engines/godot/game/bot.gd:21-22` and its `_eye()` / `_aim_point()` | Godot: `run.gd -- --only bot_roles` parts 4-5. Web: no test; compute idealAim for a Corgi bot and a Cat bot 3 m apart on the slab |
| P2a | Web q=low: the pool term fades the cover fill inside the 4 floods' cones, but the low tier draws no flood light, so the corgi pit's footings get no read (no regression: read off is the same) | tw-look | `src/client/assets/kit-glb.ts:576` (kitCoverFloods passes all 4 floods), `src/client/style/style-tokens.js:209` (flood budget high 4 / medium 2 / low 0), `:226` (pool 1.0) | `Q=low node labs/cover-metric.mjs <out> <url>`: Footing[1] edge 12.2 / 10.7 at 10 / 30 m, COVER FAIL; q=med and q=high PASS on all 29 views |
| P2b | Flood light on the corgi pit with the read off: Godot's pit is a dark view (body L\* 8.5-18.6), the web's a flood-lit one (39.0-40.9); pre-existing, Godot wins | tw-look (W17 AAA, the AIR pass) | the web's flood pools (`style-tokens.js` floodlight, `kit-glb.ts`) against Godot's floods (`engines/godot/look/look.gd`) | `docs/qa/w15/COVER.md` §4 (Godot) against its Web section, the corgi-base views with the read off |
| P2c | The cover rule's untested seams: Godot's SHADER_RULE is a substring pin, so an extra emission term after the rule passes headless (mutant V6); `set_cover_read` ignored passes both gates (V7; V6+V7 bleaches BagWall to L\* 47.9 and exits 0); neither test pins `ly = VERTEX.y` or the sheen colour; the glow bound is on luminance while Godot 4.7.2's glow keys on the max channel (Compatibility FloodMast 0.942 against the asserted 0.900; every real peak < 1.3). Web: floods not passed and coverBase 0 pass CI (m4, m5) | g-atmos (Godot), tw-look (web) | `engines/godot/tests/test_look_cover.gd:99-114`, `:293-312`; `tests/unit/kit-cover.test.ts` | the W17 item 11 confirm's mutants V6, V7, m4, m5 (lead scratchpad `verify-i11c`) |

## Shots (each opened and looked at)
All in `docs/qa/w17/`. Godot shots are 1280 × 720 renders (gl_compatibility under Xvfb) except the hits grid (906 ×
906, 1.5x cells); web shots are 1280 × 720 headless Chromium (SwiftShader) screenshots or crops of them. Each was
opened and looked at; "gray" files are Rec. 709 luma copies.

| Shot | Build | How it was made | What it shows |
|---|---|---|---|
| `p17-godot-death.jpg` | Godot | S: the repo's `shot_hud.gd` `death` (`me.die(cat)`, time frozen at 2.5 s left) | `TAKEN DOWN BY Cat Bot 1 · ▲ CAT CADRE` / `YOU: CORGI COMPANY` / `BACK AT THE FOUNDATION · 142 m TO THE SLAB` / `BACK IN 2.5` on the dim backing; no marker; feed `Cat Bot 1 > You` |
| `p17-godot-hits.jpg`, `-gray` | Godot | Y: `shot_hud.gd` `hits` (`hit_confirmed.emit` on a placed Cat bot; the received cell is a real `take_damage`) | BODY X, HEAD X with a filled diamond, KILL larger X with a ring, RECEIVED wedge; in grey each reads by its shape |
| `p17-godot-hit-received.jpg`, `-gray` | Godot | S: `shot_hud.gd` `hit-received` (a Cat bot behind on the right fires) | the wedge low right of the crosshair, the white chip at the end of the HP bar (105), the red tint; in grey the wedge and the chip read, the tint does not (allowed: never the only cue) |
| `p17-godot-own-shot-gray.jpg` | Godot | L: `qa17_shot_own.gd`, the real `fire` action held, time frozen after the 4th shot; left at rest, right firing (crop 400 × 340 round the pet) | firing: the flash at the muzzle and its light on the pet and the crate; the crosshair gap the same in both halves (13.8 px) |
| `p17-godot-own-fire.jpg` | Godot | the full colour frame of the right half | `26 / 30`; the flash's orange light; no ink line on the pet |
| `p17-godot-marker-near.jpg` | Godot | S: `shot_hud.gd` `marker-near` (`--lineup 30`) | `SLAB 33 m CONTESTED` with the split diamond; the Corgi from behind, no ink line |
| `p17-godot-win.jpg` | Godot | S: `shot_hud.gd` `win` (score set to 60-41, `end_match(0)`) | `CORGI COMPANY WINS`, `60 – 41`, `You: 0 takedowns · 1 knockouts`, `R / Enter / Start: rematch   ·   F2 / Back: switch 1v1 / 2v2`; the slab line and the marker gone |
| `p17-godot-marker-cat.jpg` | Godot | S: `shot_hud.gd` `marker-cat` (the human standing in at the Cats' middle respawn point) | `SLAB 136 m CORGI COMPANY` over a filled diamond; the two Cat bots close by, no ink line |
| `p17-web-own-shot-gray.jpg` | web | L: a stand-in pad holds RT; held at the frame of an own `fire` event; left at rest, right firing (same crop as Godot's) | firing: the flash glow and its light on the pet, the tracer, the crosshair open (7 px at rest, 18.5 px firing) |
| `p17-web-own-fire.jpg` | web | the full colour frame of the right half | `25 / 30`; the pet up close: no ink line |
| `p17-web-hits.jpg`, `-gray` | web | Y: hit, head-hit and knockout events added to real worker snapshots by a test-side Worker wrapper (as the e2e does), `performance.now` frozen first; three 300 px crops at 1x | body X, head X with a centre diamond, kill larger X with a ring. In grey at 1x body and head differ only by the centre diamond (see `p17-confirm-size-gray.png`) |
| `p17-confirm-size-gray.png` | both | crops of `p17-godot-hits-gray.jpg` and `p17-web-hits-gray.jpg` at the same 3x scale; top Godot, bottom web; body, head, kill | the web's X ends inside the crosshair's arms and is about 0.7 of Godot's (H20); Godot's head diamond sits in a clear gap, the web's fills it |
| `p17-web-hit-received.jpg`, `-gray` | web | S: `&slabHurt` (a real Cat hits the human), the page frozen at the hit's snapshot (the HP drop was already drawn on the first frozen frame, so no step was needed) | `95` and a white chip to 120; the wedge at full strength over the dimmed marker (the attacker stands on the slab); the red tint (flash 0.175). In grey the wedge and the chip read. The respawn glow and debris from the previous knockout are still round the pet |
| `p17-web-death.jpg` | web | S: a real `&slabHurt` knockout of the Corgi human, frozen at the death's snapshot, then stepped 320 ms on, so the interpolated local state reached the knockout (hence `BACK IN 2.7`, 3.0 − 0.32) | `TAKEN DOWN BY Cat 2 · ▲ CAT CADRE` / `YOU: CORGI COMPANY` / `BACK AT THE FOUNDATION · 142 m TO THE SLAB` / `BACK IN 2.7`, centred on the dim rounded backing; the marker hidden; feed `Cat 2 > Rex`; no ink on the downed pet |
| `p17-web-death-cat.jpg` | web | S: the same with `&team=1` (the human a Cat) | `TAKEN DOWN BY Pup 1 · ■ CORGI COMPANY` / `YOU: CAT CADRE` / `BACK AT THE SCAFFOLDS · 132 m TO THE SLAB` / `BACK IN 2.9` (stepped 80 ms), centred on the backing, the scaffolds behind; feed `Pup 1 > Rex` |

Also opened, not cited: the Godot `marker-corgi` render, and the first unheld web received and death frames
(`scratchpad/qa17-shots/web-hurt-corgi/`), which showed why the shots are held. The death frames of sessions B, C
and E are not cited and were not used: their logs show no panel on screen (see the method notes).

## Gaps (owner)
Carried from w15 (its numbers), each re-checked at this head, then the new ones.

| Gap | Severity | Row | What is missing | Owner | Status |
|---|---|---|---|---|---|
| G1 | major | X7 | The web rematch did not reset the bots' brain | tw-sim | closed (w15); slab-mode:455-483 passes here |
| G2 | minor | X9 | The web's kill-feed clear had no test | tw-view | closed (w15); e2e:141-186 rewritten for CI 154, passed in CI 156 |
| G3 | minor | X3 | The web ignores a rematch press for 1 s after the end; Godot does not | lead | closed (W17 G-REMATCH: Godot adopted the guard; X3 MATCH) |
| G4 | minor | X4 | Pad X rematches on the web only | lead | open (DEFECT X4) |
| G5 | minor | R15 | Godot fall-plane test | lead | closed (w15) |
| G6 | minor | R14 | Godot: no spawn-shield test | lead | open |
| G7 | minor | R2, R4, R9b | Godot: no test of 1/s with two holders, the part-counted second, overtime ending on a lead | lead | open |
| G8 | minor | M3, M4 | Godot pinned the 120 px cap and the safe edges by symbol only | g-hud | closed (w15) |
| G9 | minor | D6, D7, K3 | No Godot test asserts `respawn_zone(1)` is THE SCAFFOLDS at 132 m, or `respawn_zone(0)` 142 m. This file's probe measured 132.41 m and 142.24 m, but a probe is not a standing test | g-hud | open |
| G10 | minor | H1 | Neither build tests the crosshair gap; measured now, they differ (DEFECT H1) | g-hud, tw-view (after the lead's rule) | closed (W17 H1/H20: both builds test it; H1 MATCH) |
| G11 | minor | H2, T1 | Godot has no muzzle-flash test; the web's is a generic recipe test. Shots now show the flash in both builds | lead, tw-view | open (shots only) |
| G12 | note | F13 | Godot: no test that a slab match shows no nameplate | g-hud | open |
| G13 | note | H19 | Godot: no "no music" test | a-hook | open |
| G14 | note | X2 | Web: R during play | tw-sim | closed (w15); slab-mode:438-453 |
| G15 | note | B1, B2 | The twin's bots have no roles and no edge-band test | lead | edge band CLOSED (W17 TW-SIM, B1 MATCH); roles stay Godot-only (B2 NOT MET in both). Logged allowed DIFF: beyond the 6 m contest zone the twin keeps its W13 straight pull until the lead rules on the far branch (G-BAL landed without it; porting it gave 1v1 65 % Cat at n 200) |
| G16 | note | M2, D1, D5, D10 | Web layout clauses proven by shot only | tw-view | open (this file's web shots re-confirm them) |
| G17 | note | shots | – | g-hud, tw-view | closed (w15) |
| G18 | note | X8 | The e2e cannot put a cue up before the end | tw-view | settled (w15); e2e:127-136 says so at this head |
| G19 | note | M20 | `LINEUP_AIM_LIFT` has no test | lead | open |
| G20 | note | H11 | Web: no wedge for an attacker never seen in a snapshot | lead (ruling) | open |
| G21 | minor | H20 | The web's confirm X is 1/√2 of Godot's | tw-view | closed (W17 H1/H20: H20 MATCH, the drawing rule pinned in both builds) |
| G22 | major | B2 | Card item 8 NOT MET: the bot.gd trap | g-bot | open (DEFECT B2). W17 G-BAL: post in zone + aim parity is 62.5 % Cat (n 240), and the APPROACH bot is at its post 16-18 % of its alive time (bar 20 %), so still NOT MET. Closing it needs a step-on rule that keeps the APPROACH bot at its post (BOT-ROLES § G-BAL Decision) |
| G23 | minor | K6 | The card's distance is the zone centre; the measured respawn is an end point (±1.5 m Corgis, ±3.3 m Cats) | lead | **new**, closed: ruled MATCH (HUD_CONTRACT rev 5 §2, ±4 m) |
| G24 | note | K5, K6 | No standing test in either build checks that a base respawn lands where the card says. Godot tests it only for `--demo` (death:58-65); the web not at all. This file's two probes do it (40 respawns each) and could be adopted | g-hud, tw-view | **new**, open |
| G25 | minor | B3 | The twin's bots do not use Godot's aim-height parity (bot.gd AIM_EYE / AIM_CHEST), and no web test pins bot aim geometry | tw-sim | **new**, open (DEFECT B3) |
| G26 | minor | H1a | Rifle fire timing differs (Godot's banked double tap and in-tick order); no test of either in Godot | lead, then g-game | **new**, open (DEFECT H1a) |
| G27 | minor | H1b | The web lets a firing pet sprint; Godot does not; no test in either build | tw-sim via the lead | **new**, open (DEFECT H1b) |
| G28 | note | H20b | Paint style around the X and the crosshair differs (fade, head diamond, arm style, drop-shadow) | lead, then tw-view | **new**, open (DEFECT H20b) |
| G29 | minor | P2a | Web q=low: the cover read's pool fade has no flood light to replace the fill | tw-look | **new**, open (DEFECT P2a) |
| G30 | note | P2b | The corgi pit is flood-lit on the web, dark in Godot (read off) | tw-look (AAA AIR) | **new**, open (DEFECT P2b) |
| G31 | minor | P2c | Cover-rule gate holes (V6, V7, m4, m5, glow bound on luminance) | g-atmos, tw-look | **new**, open (DEFECT P2c) |

## Method notes
- **Probes.** Five files in `scratchpad/qa17-probes/`: the two death-card probes (`test_zz_qa17_card.gd`,
  `zz-qa17-card.test.ts`), the Godot own-shot render (`qa17_shot_own.gd`), the web shot harness
  (`qa17-web-shots.mjs`) and a web diagnosis (`qa17-diag-death.mjs`), plus the private vite config. Each was copied
  into the private copy, run and removed; nothing was added to the repo. Logs: `scratchpad/qa17-logs/`. After the
  runs every one of the 596 tracked files under `src/`, `engines/`, `tests/`, `tools/` and `server/` in the copy hashes
  the same as `7a671f1` (`git hash-object` against `git ls-tree`); the copy also holds Godot's generated `.godot/`,
  `.uid` and `.import` files.
- **Why the web shots are held still.** The machine ran two G-BOT2 balance batches, other lanes' Godot renders and a
  cover-metric browser at the same time; under SwiftShader the page drew about one frame every few seconds, with
  main-thread stalls of up to 45 s, and a screenshot took 50 to 90 s. An unheld screenshot of a knockout came back
  without the death panel while the DOM already showed it (the compositor presented an older frame), and the 0.6 s
  wedge and the 0.18 s confirm cannot be caught live at that rate. So the harness freezes the page's
  `performance.now` the moment the staged event's snapshot arrives (in a test-side Worker listener that runs before
  the game's), holds back later snapshots, waits 20 s, then shoots. Each shot's log line records the DOM it was taken
  in.
- **The interpolation step.** The HUD reads the local pet from the interpolated state, which runs up to 0.25 s behind
  the snapshots (`MAX_INTERP_DELAY`). With the clock frozen at the knockout's snapshot that state never reaches the
  knockout, so three death frames (sessions B, C and E) came out with no panel; they are not cited. The harness now
  steps the frozen clock on in 40 ms steps until the panel (or the HP drop) is drawn: 0 ms for the received hit,
  320 ms and 80 ms for the two knockouts, so those cards read `BACK IN 2.7` and `BACK IN 2.9`. The probe (K4) reads
  `BACK IN 3.0` on the first dead frame without any freezing.
- **Not Playwright's `page.clock`.** A first harness used it. Under it `performance.now` ran backwards between message
  handlers (`welcome` at 18972 ms, then a knockout at 5473 ms), the HUD's stamps were garbage, and a knockout by
  Cat 2 read `TAKEN DOWN BY THE LOT`. The same page in real time (`scratchpad/qa17-logs/web-diag-death.log`) names
  `Cat 2  ·  CAT CADRE`. That was the tool, not the game; HUD timing proofs should not use `page.clock`.
- **What was not re-run:** the w15 mutants (P1, P2, P3, the two `respawn()` mutants) and the w15 `probe-rematch`
  (their files are byte-identical here); `net-slab.spec.ts` (cited from CI 156, as the card allows); the full web unit
  and e2e suites (CI 156 ran them on this exact commit; the 11 unit files this file cites were re-run).
- **Shared machine.** Everything ran under `nice -n 10`. My two Godot renders ran one after the other, while no other
  lane's render was running. One stuck shot run of mine was stopped by a pattern match on its own script name
  (`pgrep -f "node qa17-web-shots.mjs"`); it matched only my processes. The session was cut off by a session limit
  at about 06:16 UTC and resumed at 14:45 UTC after the machine restarted; the private vite (port 5280) was restarted,
  and the received-hit and both death shots were re-taken then.
