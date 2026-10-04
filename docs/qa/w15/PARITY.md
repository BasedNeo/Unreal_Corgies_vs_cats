# W15 parity checklist: Godot and the web twin (Sprint C, card item 10)

One row per rule the player can see that both builds must share: every clause of `HUD_CONTRACT.md` revision 4, plus
the match rules and the Sprint C bot items. Each proof cell names a test assertion (file and line) or a shot that was
opened and looked at. Godot wins clashes.

**Tree:** HEAD `816489c` plus Sprint C's 59 uncommitted files after the patch round (`scratchpad/trial-c2`; the list
is `scratchpad/c2-files.txt`, and this file is one of them). Re-checked on a private copy (`scratchpad/q-cc-parity/tree`)
on 2026-10-04 by q-cc-parity, which built neither Sprint C nor the patch round. The first version of this file
(q-parity, against the pre-patch tree `scratchpad/trial-c`, 51 files) is superseded. The patch round moved lines in
seven cited test files, so every proof cell below is cited at trial-c2's line numbers. A cell copied from the first
version points at the same, unchanged text.

**Card item 8 (2v2 roles, "one bot holds, one approaches") is NOT MET.** In play the roles are nominal (row B2). The
cause is a trap in bot.gd. The lead ruled that the roles code stays: it measured behaviour-neutral (Fisher p 1.0) and
it carries the tested rematch reset. The trap fix is the next card.

## Runs at this tree (each once, on the copy)
| Command | Result |
|---|---|
| `$G --headless --path engines/godot --import` | exit 0 |
| `$G --headless --path engines/godot --script res://tests/run.gd` | `GODOT TESTS: PASS`: 24 of 24 files (test_game_fall.gd is new). Printed: contest 80.0 pet-s on the slab, edge band 0.9 %; roles "after the rematch 4 match it"; sfx counts 9/8/2/2/1/1 |
| `npx vitest run tests/unit/slab-mode.test.ts tests/unit/audio-death-by.test.ts tests/unit/fx-reactions-fall.test.ts` | 3 files, 31 of 31 pass (27 + 2 + 2) |
| `npx vitest run` on slab-hud, slab-view, slab-view-input, audio-slab-cues, audio-cue-measure and fx-particles | 6 files, 80 of 80 pass (36 + 10 + 7 + 12 + 4 + 11) |
| `npx playwright test -g SLAB` (a private config on port 5196 with its own vite cache; the port was free afterwards) | 2 of 2 pass (54.9 s): `modes.spec.ts:70` and `:131` |
| `npx tsc --noEmit` · `node tools/check-boundaries.mjs` | exit 0 · `BOUNDARIES: PASS` |
| Web probe (`scratchpad/q-cc-parity/zz-cc-parity-rematch-probe.test.ts`, run from the copy's tests/unit and then removed): bots-only 2v2 rooms, seeds 7, 1, 2 and 3, two restarts each, every bot read at the restart tick and for the next 180 ticks | `probe-rematch.out`: **8 of 8 restarts clean.** At the restart tick every bot is in `patrol` with target −1, no path, no goal, `lastHurtTick` −9999 and odometer 0. One tick later the largest odometer reads 0.00 m. In the next 3 s no bot engages anything, so none engages a target past 80 m (the largest `sightRange` is 75 m). |
| The same probe on a mutant: match/index.ts:316 `if (start) slabFreshBrains(sim);` removed (the rematch branch) | `probe-rematch-mutant.out`: **8 of 8 restarts stale.** Bots stay in `engage` on targets 270-276 m away in 7 of 8 restarts, and odometers jump 131-145 m one tick later. |
| Mutant above, then `npx vitest run tests/unit/slab-mode.test.ts -t "fresh brain"` | **FAIL** (killed): `expected { arch: 'rifleman', …(64) } to deeply equal { arch: 'rifleman', …(64) }` |
| Mutants: `ev.by >= 0 &&` removed at audio/index.ts:314 and at fx/reactions.ts:70, then the two new tests | **FAIL** (killed): audio-death-by:36 and fx-reactions-fall:9 fail; the other two cases pass |
| Mutant P1, hud.gd: `MARKER_MAX_LIFT` 60 and `MARKER_SAFE` bottom 60, then `--only hud_marker` | **FAIL** (killed; this mutant survived the first version's run): "the marker lifts at most 60.0 px, the contract says 120" and "the safe area is [16.0, 110.0, 16.0, 60.0] …" |
| Mutant P2, match.gd: the fall-plane check (:386-387) removed, then `--only fall` | **FAIL** (killed): "Cat Bot 1 40.5 m below the slab's ground is still up" (and the same for `You`) |
| Mutant P3, match.gd: `_respawns.clear()` (:275) removed from `start_match`, then `--only game_rematch` | **FAIL** (killed): "R rematch mid-cue: the player's respawn countdown is still 2.87 s after the rematch, want 0" (and 2.80 s for Enter mid-death) |
| Mutants, bot.gd `respawn()`: no `push_look` reset (:111), then no `_step_on_t` reset (:112); each with `--only bot_roles` | **FAIL** both (killed), for both APPROACH bots: "push_look (0.68, 0.0, 0.73) (start (0.0, 0.0, 0.0))" and "step_on_t 3.0 (start 0.0)" |

Every mutated file was restored afterwards. The copy then differs from trial-c2 only in Godot's generated `.uid` and
`.import` files (`diff -rq`). Logs are in `scratchpad/q-cc-parity/`.

## Totals (95 rows)
| Status | Rows |
|---|---|
| MATCH | 74 |
| DIFFERS (allowed) | 3 (D2, F10, H11) |
| GODOT ONLY | 4 (2 allowed: D9, F12; 1 noted: M20; 1 gap: B1) |
| WEB ONLY | 9 (R2, R4, R9b, R14, F13, H2, H19; and R15a, R15b, which Godot does not have) |
| DIFFERS (defect) | 4 (X3, X4, H1, H20) |
| NOT MET (card item 8) | 1 (B2) |

Since the first version: X2, X7, X9 and R15 became MATCH (gaps G14, G1, G2 and G5 closed). M3 and M4 are pinned as
literals in Godot (G8 closed). The G-HUD half of G17 is retracted, and its TW-VIEW half is closed. G18 is settled:
the web proof of X8 is unit-only, and the e2e is a smoke check. New rows: H20 (the web's confirm X is 1/√2 of
Godot's size), and R15a and R15b (a fall is nobody's kill in the web's sound and camera). B2 is now NOT MET.

Eight MATCH rows carry an open gap note: M2, D1, D5 and D10 (G16), D6 and D7 (G9), and H4 and H6 (G21). The gaps
table is at the end of this file.

## Key
- **Status:** **MATCH** means both builds are proven to follow the rule. **GODOT ONLY** or **WEB ONLY** means only that
  build is proven, or only that build has the rule. **DIFFERS (allowed / defect)** means the builds behave differently.
  **NOT MET** means the card item's behaviour does not happen in play. `no test` means that no test was found by grep
  in that build.
- **Godot tests** are in `engines/godot/tests/`. `marker` = test_hud_marker.gd, `death` = test_hud_death.gd, `hits` =
  test_hud_hits.gd, `draw` = test_hud_draw.gd, `clauses` = test_hud_clauses.gd, `rematch` = test_game_rematch.gd,
  `fall` = test_game_fall.gd, `slab` = test_game_slab.gd, `sfx` = test_game_sfx.gd, `respawn` = test_game_respawn.gd,
  `input` = test_lead_input.gd, `bot_roles` and `bot_contest`.
- **Web tests** are in `tests/unit/`. `slab-hud`, `slab-mode`, `slab-view`, `view-input` (slab-view-input),
  `audio-cues` (audio-slab-cues), `cue-measure` (audio-cue-measure), `audio-death-by` and `fx-reactions-fall`.
  `e2e` = tests/e2e/modes.spec.ts.
- **Shots** are in `docs/qa/w15/`. **L** = live play, **S** = staged (pets placed, a hit or knockout scheduled or
  injected, or the score set), **Y** = synthetic events.

## §1 The slab marker
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| M1 | Hangs over the slab centre + 4.5 m | marker:71-72 (`Hud.MARKER_LIFT` == 4.5, a literal); :272-276 (408 live views from every spawn and respawn point) | slab-hud:32 (`SLAB_MARKER_LIFT` 4.5); :333-334 (camera aimed at centre + 4.5 m: the marker sits at screen centre) | MATCH |
| M2 | The words sit above the shape, never below | marker:130-132 (box); draw:77-81 (the drawn lines' bottoms sit above the top tip) | slab-hud:37 (geometry pins equal hud.gd:22-24); DOM order by shot only: `hud-web-marker-states.jpg` (L, L, S) | MATCH (G16) |
| M3 | Step 1: clamp the box into the safe area (16 sides, 110 top, 112 bottom; 720p units) | marker:69-70 (`Hud.MARKER_SAFE` == [16, 110, 16, 112], a literal; mutant P1 fails here); :212-213 (off-screen anchors, against the test's own rect 16/110/112, :138); :429-430 (live: never above `MARKER_SAFE[1]`) | slab-hud:67 (pins 16/110/112); :74; :459-462 (u = 1.5 gives 24/165/168) | MATCH |
| M4 | Step 2: lift off another living pet, 2 clear, at most 120, never above the safe top | marker:65-66 (`Hud.MARKER_MAX_LIFT` == 120; mutant P1 fails here), :67-68 (`Hud.MARKER_CLEAR` == 2); :148-151, :156-157, :168-170 (cap = `Hud.MARKER_MAX_LIFT`), :177-179, :184-185; live :278-279 | slab-hud:68-69 (pins 2 and 120); :105-106, :109, :113, :117-118; :452-457 (u = 1.5) | MATCH |
| M5 | Step 3: just below the lowest covered pet, then on down past each next pet while above the safe bottom (rev. 4) | marker:162-164; :194-199 (A, B, C settles at 492; A then B at 352) | slab-hud:86-87; :439-441 | MATCH |
| M6 | Step 4: nothing clears, so the box keeps step 2's place; nothing clamps after | marker:168-170; :191 + :194 (chain past the safe bottom: blocked); :354-356 (live "blocked" checked by an independent scan) | slab-hud:109-110, :113-114, :445-446 | MATCH |
| M7 | Never covers the scores, the timer or the slab line | marker:177-179 (pure); :425-435 (live, against the labels' own rects: 408 base views and 648 close views) | slab-hud:94-97 (timer and slab-line boxes at 720p) | MATCH |
| M8 | Only other living pets are dodged, never the player's own | marker:416-422 (own pet: dodge `none`, not listed); :283-289 | slab-hud:321-323; :332, :336 | MATCH |
| M9 | Line 1 `SLAB  <N> m` (the camera's ground distance, whole metres), line 2 the state word | marker:88-89; live :267-269 | slab-hud:27-31; :343-344 (camera 40 m, player 32 m: reads 40) | MATCH |
| M10 | Nobody on it: `NEUTRAL`, hollow diamond, white | marker:100-101, :106-108; draw:69-72 | slab-hud:27 (`0xe6ebf2` = hud.gd:34 `NEUTRAL_COLOR`); :38-39 | MATCH |
| M11 | One team alone: `CORGI COMPANY` / `CAT CADRE`, filled diamond, team colour lightened | marker:98-99, :110-113 | slab-hud:29-30 (lighten 0.35 = hud.gd:36); :40 | MATCH |
| M12 | Both teams: `CONTESTED`, a diamond split by a bar, amber | marker:94-95, :115-126; draw:69-70 | slab-hud:31 (`0xffa633` = hud.gd:35); :43 | MATCH |
| M13 | The shape carries the state without colour | marker:127-128 | slab-hud:44; shot `hud-web-marker-states-gray.jpg` (CONTESTED panel S) | MATCH |
| M14 | Off screen: clamps to the edge and keeps both lines | marker:212-213 | slab-hud:74 | MATCH |
| M15 | Behind the camera: on the bottom edge, toward the slab's side | marker:220-223 (straight behind: bottom centre; behind on the right: the right half) | slab-hud:78-79 (bottom edge, x mirrored 1000 → 280); :470-471 | MATCH (the formulas differ: hud.gd `behind_point` uses the bearing, the web mirrors the projected x; only Godot tests the side from a world position) |
| M16 | Behind the camera the steps still run against the pets on screen (rev. 4) | marker:206-207 | slab-hud:475-476 | MATCH |
| M17 | Hidden while the player stands on the slab | marker:477-478; :338-339 (72 close views on the slab) | slab-hud:124, :126 | MATCH |
| M18 | Hidden while the player is down | marker:491-492; death:164-165 | slab-hud:125-126; :380 | MATCH |
| M19 | Hidden once the match is over, with the slab line; back after the rematch | marker:504-507, :513-515 | slab-hud:127; :292-293; e2e:156 | MATCH |
| M20 | `LINEUP_AIM_LIFT` 1.5 m left unchanged | no test (match.gd:584 still reads 1.5; the file is not in Sprint C's list) | n/a (`--lineup` is a Godot flag) | GODOT ONLY (G19) |

## §2 The death panel
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| D1 | Four lines in the centre of the screen | death:130-131; :156-157 (centred) | slab-hud:373-378; centring by shot only: `hud-web-death.jpg` (S) | MATCH (G16) |
| D2 | Line 1 `TAKEN DOWN BY <name>  ·  <TEAM>`, with each build's display names | death:91-92 (`Cat Bot 1`); :130-131, :138-139 (live) | slab-hud:148-149; :374 (the roster's `Whiskers`); :387 (fallback `Pup 4`) | DIFFERS (allowed: §2, display names are per build, the format is the same) |
| D3 | No killer (a fall, the map): `TAKEN DOWN BY THE LOT`, no glyph, no team | death:96-97; :187-190 (live `die(null)`); fall:59-65 (a real fall below the plane: the panel reads `TAKEN DOWN BY THE LOT`, no glyph) | slab-hud:162-164; :392 | MATCH |
| D4 | Line 2 `YOU: <YOUR TEAM>` | death:89-92; :140-141 | slab-hud:150; :375 | MATCH |
| D5 | Killer-team glyph before the team name: Corgi a square, Cat a triangle, in the team colour | death:105-108; :149-152 (between the name and the team, same row); draw:166-171 (4 and 3 corners, team colour lightened) | slab-hud:154, :157, :172-175; colour by shot only: `hud-web-death.jpg` (S) | MATCH (G16) |
| D6 | Base names `THE FOUNDATION` / `THE SCAFFOLDS` | death:122-123 (`respawn_zone(0)`); `THE SCAFFOLDS` only as a synthetic input, :98-102 | slab-hud:134-136 | MATCH (G9) |
| D7 | `<N>`: 142 m for the Corgis, 132 m for the Cats | No Godot test pins either number: death:87-91 feeds a synthetic 142.24. Shot `hud-godot-death.jpg` (S) reads 142 m. slab-mode:605 computes Godot's 132 from match.gd `CAT_SLOTS` and the_lot.json. | slab-hud:139, :143; slab-mode:612-614 | MATCH (G9) |
| D8 | `BACK IN <s.s>`, the respawn countdown in tenths | death:134-136 (against `respawn_left`, ±0.15 s) | slab-hud:152-153, :163 (never below 0); :381; :527 | MATCH |
| D9 | `--demo` first match: `THE SLAB'S EDGE` and that spot's distance; the rematch reads the base again | death:55-57, :64-65, :75-76 | n/a (the twin has no `--demo`) | GODOT ONLY (allowed: §2 names it Godot's) |
| D10 | Backing: a dim rounded panel, black at alpha 0.55, behind the four lines | clauses:135-137, :140-141 | slab-hud:168 (`rgba(0,0,0,0.55)`); rounded and behind the lines by shot only: `hud-web-death.jpg` (S) | MATCH (G16) |
| D11 | The panel goes once the player is back up | death:181-182 | slab-hud:394; :579 | MATCH |

## §3 Hits and sound
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| H1 | Own shot: the crosshair gap opens with the spread | no test (draw:94-95 checks only that a crosshair is drawn) | no test | DIFFERS (defect: unproven in both, G10) |
| H2 | Own shot: a muzzle flash | no test (rifle.gd:29-35) | weak: fx-particles:136 (the recipe spawns; nothing ties it to a slab shot) | WEB ONLY (weak; G11) |
| H3 | Body and head confirms 0.18 s, a kill 0.35 s; a body hit does not cut a kill short | clauses:69-70, :77-79, :84-86, :89-90 | slab-hud:208-210, :216-219 | MATCH |
| H4 | Body: an X of four short lines, white | hits:64-65; draw:104-105 | slab-hud:181, :193-194, :201 | MATCH (shape; the web's X is 1/√2 of Godot's size: H20, G21) |
| H5 | Head: the X plus a small filled diamond in its centre, yellow | hits:67-70; draw:106-107 | slab-hud:182, :195-196, :201 (`0xffd933` = hud.gd:49) | MATCH |
| H6 | Kill: a larger X plus a ring about 18 px across, red | hits:72-80; draw:108-109 | slab-hud:183, :186-187, :197, :201 | MATCH (shape and ring; the web's X is 1/√2 of Godot's size: H20, G21) |
| H7 | The kinds differ in shape, not only colour | hits:61-62; shot `hud-godot-hits-gray.jpg` (Y) | slab-hud:199; shot `hud-web-hits.jpg` (Y) | MATCH |
| H8 | Received: a wedge on a ring about 110 px out, toward where the attacker stood, relative to the camera; it turns with the camera | clauses:51-52 (`Hud.HIT_RING` within 10 px of 110, a literal); hits:84-104, :119-125 (yaw turns it, pitch does not); live :199-204 | slab-hud:240-243, :257-262; :357, :361 | MATCH |
| H9 | The wedge holds the point of the hit and never follows the attacker | hits:223-225 | slab-hud:233; :355-357 | MATCH |
| H10 | The wedge fades over 0.6 s | clauses:112-113; draw:128-129; hits:232-233 | slab-hud:232, :234; :358 | MATCH |
| H11 | A wedge appears for every received hit | always (hits:199-200: the attacker is a node) | no wedge for an attacker never seen in a snapshot; the flash and chip still show (slab-hud:237-239) | DIFFERS (allowed: the client has no position to point at; G20) |
| H12 | HP chip: a white segment of the HP lost, drains over 0.4 s, follows the hit points (a fall leaves no stuck chip) | clauses:104-106 (linear: half at 0.2 s); hits:208-212 (white, exactly the HP lost), :228-229; death:162-163 (takedown with no hit) | slab-hud:267-279 (fall at :277-279); :400-404; white: shot `hud-web-hit-received.jpg` (S) | MATCH |
| H13 | Red flash at alpha 0.25 or less, never the only cue | clauses:47-48 (`Hud.FLASH_MAX` == 0.25, a literal); hits:213-215, :238-239 | slab-hud:249-251 (peak 0.175) | MATCH |
| H14 | A wedge over the marker dims the marker to 0.35 (rev. 4) | clauses:49-50 (`Hud.MARKER_DIM` == 0.35, a literal); draw:144-150 | slab-hud:503-505, :508, :514; shot `hud-web-hit-received.jpg` (S) | MATCH |
| H15 | While the player is down: no confirm and no wedge | draw:152-158 (also over the win screen) | slab-hud:418-419, :424-425 (the win-screen half is CSS only, slab-hud.ts:692, no test) | MATCH |
| H16 | All six cues play (`rifle_shot`, `hit_confirm`, `slab_tick`, `slab_tick_enemy`, `match_end_win`, `match_end_lose`) | sfx:217, :285 (plays = events, each cue; this run: 9/8/2/2/1/1) | audio-cues:227-228 (`?sfxlog`, all six); :153-162 | MATCH |
| H17 | Own and enemy ticks differ in length or pitch (LISTEN.md: centroid 906 against 585 Hz) | sfx:123-125 (not the same data); sfx `_wiring` (:98-104) reads the shared `public/assets/audio` files | cue-measure:58-64 (gap ≥ 150 Hz or ≥ 20 ms), :66-82 (the guard can fail); audio-cues:70 (the web plays sfx.gd's files) | MATCH (one set of files, measured once) |
| H18 | Your point plays `slab_tick`, theirs `slab_tick_enemy`; the end plays win or lose; a draw loses | sfx:62-64 (event → cue), :287-288 (two lose stings: a loss and a draw) | audio-cues:39-52 | MATCH |
| H19 | No music | no test (sfx.gd:4 "No music.") | audio-cues:195-207 | WEB ONLY (G13) |
| H20 | Confirm X size (Godot wins: hud.gd `hit_cue`): the arms reach 7.07-14.1 px from the centre for body and head, and 8.5-21.2 px for a kill (720p) | hud.gd:446-449 draws each arm from `c + d * r0` to `c + d * r1` with an unnormalised `d` = (±1, ±1), so an arm reaches r·√2: r 5-10 px gives 7.07-14.1 px, and r 6-15 px gives 8.5-21.2 px. G-HUD.md:94-96 states 7-14 px and 8.5-21 px, which is correct. No test pins the size: hits:79-80 only checks that the kill X reaches 4 px past the body X. | slab-hud.ts:405-408 uses unit `cos` / `sin` (π/4), so an arm reaches r itself: 5-10 px and 6-15 px, 1/√2 (about 71 %) of Godot's. slab-hud:180-183 pins r0 and r1 to 5/10 and 6/15 as "hud.gd hit_cue", the same numbers with a different meaning. | DIFFERS (defect, G21: tw-view, later) |

## §4 HUD fields
| # | Field | Godot proof | Web proof | Status |
|---|---|---|---|---|
| F1 | Scores `CORGI COMPANY  <n>` / `<n>  CAT CADRE`, a bar under each racing to 60 | hits:146-151 (strings at 0-0); bar: shot `hud-godot-win.jpg` (S) | e2e:91-95; slab-view:140-141 (bar = score / 60); shot `hud-web-marker-scaffolds.jpg` (L) | MATCH |
| F2 | Timer `m:ss`, red in the last 30 s | clauses:157-159 (0:31 white, 0:30 red) | slab-view:115-121; :151 (`0xff7366` = hud.gd:647) | MATCH |
| F3 | `OVERTIME` in amber after 3:00 while tied | clauses:163-164 | slab-view:122-123, :126, :151 (`0xff9933` = hud.gd:643); shot `hud-web-win.jpg` (L) | MATCH |
| F4 | Slab line `SLAB  NEUTRAL` · `SLAB  CONTESTED` · `SLAB  <TEAM> HOLDING  +1/s`; hidden once won | clauses:174-175, :204-205; marker:504-505 | slab-view:132-136, :159-161; slab-hud:291-293; e2e:96, :156 | MATCH |
| F5 | `YOU: <TEAM>` over the HP bar | hits:136-140 | slab-hud:285-286; e2e:110; placement: shot `hud-web-marker-foundation.jpg` (L) | MATCH |
| F6 | HP: the number and the bar, with the chip | hits:146 (`120`); H12 | e2e:97; slab-view:145-146 | MATCH |
| F7 | Ammo `<n> / 30` or `RELOADING` | clauses:183-184 | slab-view:147-148; e2e:98 | MATCH |
| F8 | Win title `<TEAM> WINS` or `DRAW` | clauses:197-203 | slab-view:174-178; e2e:153 | MATCH |
| F9 | Win sub: `<a>  –  <b>`, then `You: <k> takedowns · <d> knockouts`, then the rematch line | clauses:196-199 | slab-view:174-176 | MATCH |
| F10 | Rematch line | clauses:18, :196 (`R / Enter / Start: rematch   ·   F2 / Back: switch 1v1 / 2v2`) | slab-view:179; e2e:154 (`R / Enter / Start: rematch`) | DIFFERS (allowed: §4 drops what the web lacks; its 2 v 2 is the `&2v2` page flag) |
| F11 | fps: none in Godot; the web only with `?debug` | hits:142-145 | slab-view:166-168; e2e:100 | MATCH |
| F12 | Hint (Godot) names X with R for reload | clauses:187-188; hits:146-151 (the full hint) | not tested (slab-view:149-150 checks two other things; slab-hud.ts:161 does name `R / X reload`) | GODOT ONLY (allowed: the row is Godot's) |
| F13 | No nameplates in a slab match | no test (pet.gd:94-95 adds a Label3D only with `--debug`) | e2e:114 | WEB ONLY (G12) |
| F14 | `PLACEHOLDER PETS` tag | hits:146 | e2e:112-113 | MATCH |

## §5 Rematch
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| X1 | R, Enter and pad Start rematch on the winner screen | rematch:80-81 (real R and Enter key events), :132-133; input:30-31 with :14 (R and Enter → `rematch`), :39-40 with :19 (pad Start) | view-input:48-54 (Enter only on the winner screen, R always); :79 (pad Start); slab-mode:397-399; e2e:167-169 (real R, then real Enter) | MATCH |
| X2 | No rematch during play | rematch:32-33 | Enter: view-input:45-46. R (the Reload bit): slab-mode:415-430, two presses while live; no `reset` event, the score keeps counting (4 - 0) and the clock runs on | MATCH |
| X3 | Rematch delay | none: the first press after the end rematches (rematch:45-55) | a press within 1 s of the end is ignored (slab-mode:389-390; e2e:166 waits 1.5 s) | DIFFERS (defect: not in the contract, G3) |
| X4 | Which pad buttons rematch | Start only (input_setup.gd:20-21 binds pad X to `reload`, Start to `rematch`; input:19) | pad X sends the reload bit (input.ts:113), and any Reload press rematches (match/index.ts:281-283): no test either way | DIFFERS (defect, G4) |
| X5 | Score 0 - 0, the clock back to 3:00, no respawn countdown left | rematch:135-136 (score), :139-140 (timer text `3:00`), :137-138 (`respawn_left` 0 after the rematch; mutant P3 fails here) | slab-mode:399-400; e2e:169, :172-173 | MATCH |
| X6 | Every pet at its start slot, alive and at full HP | rematch:148-149, :62-64 (1v1); bot_roles:84-92 with `_state` :137-138 (bots-only 2v2: alive, full HP, at its start slot) | slab-mode:404-410 (1v1; the Cat at (56, 117)); :454-455 (bots-only 2v2: every bot on its start slot and facing) | MATCH |
| X7 | The bots' state reset: target, path, role, timers | bot_roles:84-92: after `game.rematch()` every bot's think state equals its start-of-match state (this run: "after the rematch 4 match it"). `push_look` is in the state (:143). :69-76: each HOLD bot is killed 2 s before, so both APPROACH bots are stepping on when the rematch runs. Mutants of `respawn()` without the `push_look` or `_step_on_t` reset fail for both APPROACH bots. | slab-mode:432-460. A bots-only 2v2 (Room, a 30 s match) plays to the horn and restarts. Then every bot's `ai` equals a fresh brain and it stands on its start slot (:447-456), and its odometer is under 1 m one tick later (:457-458). The reset: brain.ts:197-206 `resetBrain`, called for every bot by match/index.ts:350-354 `slabFreshBrains` on a rematch (:316) and at the first start (:347). Mutant (:316 removed): the test fails. Runtime probe `scratchpad/q-cc-parity/probe-rematch.out` (see Runs): 8 of 8 restarts clean, with no engage on a far target; the mutant gives 8 of 8 stale. | MATCH |
| X8 | No HUD leftovers: confirm, wedge, chip, flash, death panel and countdown, win screen; tested mid-cue and mid-death | rematch:115-121 (the cues are up first), :150-159 (R mid-cue, Enter mid-death, real keys) | **Unit-proven:** slab-hud:550-564 (mid-cue: the cues are up first, :556-559), :566-580 (mid-death, a stale dead frame). **The e2e is a smoke check:** e2e:171-182 reads the DOM after a real R and a real Enter, but no cue can be up at a rematch in a production build (e2e:126-130; TW-VIEW.md:17-21). | MATCH (web: unit-proven; the e2e is a smoke check) |
| X9 | Kill feed cleared | rematch:116 (the feed is up before the end), :153 (empty after R and after Enter) | e2e:158-165: a takedown of the Cat bot is injected into a real worker snapshot by the test's Worker wrapper (:135-146), and one `.kf .kf-e` line is up before each key. e2e:170: 0 lines within 2 s after R and after Enter. The line would otherwise stay 9 s: the feed is `KillFeed(5, 6)` (hud.ts:298), and a line with you in it lasts 1.5 × 6 s (kill-feed.ts:91). The clear is hud.ts:715. This run: 2 of 2. Mutant K1 (TW-VIEW.md:21) was not re-run here: one e2e run per lens. | MATCH |

## Match rules
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| R1 | 1 point per full second while one team alone holds the slab | slab:27-28, :33-34 | slab-mode:145-149 | MATCH |
| R2 | Two pets of one team still score 1/s | no test | slab-mode:154 | WEB ONLY (G7) |
| R3 | Contested or empty: nobody scores | slab:39-42 | slab-mode:167-169; :158 | MATCH |
| R4 | The second being counted starts over when the holder changes | no test (match.gd:403-405) | slab-mode:180-182 | WEB ONLY (G7) |
| R5 | A downed pet neither holds nor contests | slab:51-52 | slab-mode:198 | MATCH |
| R6 | First to 60 wins | rematch:43-44 | slab-mode:301-302 | MATCH |
| R7 | At 3:00 the leader wins | rematch:69-70; sfx:282-283 | slab-mode:317-318 | MATCH |
| R8 | The numbers 60, 180 s, 60 s, 3 s, 1 s | tuning.gd:37-41, read by the web test | slab-mode:104-109 (reads tuning.gd and pins 60/180/60/3/1) | MATCH (one cross-build test) |
| R9a | Tied at 3:00: overtime | rematch:77-78 | slab-mode:324-325 | MATCH |
| R9b | Overtime ends when someone leads | no test | slab-mode:332-333 | WEB ONLY (G7) |
| R10 | Overtime at most 60 s, then a draw | sfx:279-283 (`overtime_t` forced to the max: winner −1) | slab-mode:342-343 | MATCH |
| R11 | Start slots: Corgis farthest first; Cats `CAT_SLOTS` (56, 117) then (62, 117) | respawn:110-112 (trips within 0.4 s of `CAT_SLOTS` / `CORGI_TRIPS`), :117-119; rematch:148-149 | slab-mode:506-507; :534 (a 2v2 room starts there); :558-564 (equal to match.gd's, parsed) | MATCH |
| R12 | Respawn points: Corgi slot 0 and 1.3 m steps; Cats `CAT_SLOTS` respawn (56/62/68, 117); teammates on different points | respawn:77-79, :84-85, :128-130 | slab-mode:510-511; :545-546; :202 | MATCH |
| R13 | Back 3 s after a takedown | death:134-136 (`respawn_left`); 3.0 pinned by R8 | slab-mode:197 (181 ticks); :243 | MATCH |
| R14 | A 1 s spawn shield that holds through firing | no test (pet.gd:190, :218) | slab-mode:206-213; :682 | WEB ONLY (G6) |
| R15 | A fall below the slab's y − 40 m: taken down by THE LOT, no killer, no credit; feed `The Lot  >  <name>` | fall:38-41: at 39.5 m below, nothing happens. fall:43-58: at 40.5 m below, the pet is down, its knockouts go up by 1, nobody is credited, the feed gains one line `The Lot  >  <name>` with team −1, and `respawn_left` is within 0.1 s of `RESPAWN_TIME`. It runs for the Cat bot and for the human (:23-24). It drives match.gd's own plane (match.gd:386-387) and feed line (match.gd:455); mutant P2 fails here. Godot stages no hit before the fall: `die(null)` passes no killer (match.gd:387, :455), so there is nobody to credit. | slab-mode:218-248: a hit 0.5 s before (:223); nothing between −20 and −40 (:228-231); death `by` −1, no spawn, no score (:233-239); back after 180 ticks on a Corgi respawn point (:241-245). :274-276 (a lagging human). slab-hud:392; slab-view:153 | MATCH |
| R15a | A fall (death `by` −1) is nobody's kill in the sound: no kill thump or kill sting, also with no local pet | n/a: Godot plays no sound on a death. Its one confirm sound comes from the player's own `hit_confirmed` (sfx.gd:106, :118-119), which `die(null)` never emits. No test. | audio-death-by:36-42 (local id −1: the poof plays, with no kill thump and no kill sting); :44-52 (while you play: neither; your own kill still thumps and stings). The guard: audio/index.ts:314 `ev.by >= 0 &&`; with the guard removed, audio-death-by:36-42 fails. Not covered: audio/intensity.ts:31 still counts `by` −1 as yours when there is no local pet. It feeds only the music and vehicle-loop mix (audio/index.ts:257, :269), and a slab match has no music bed (audio/index.ts:8). | WEB ONLY (Godot has no kill sound on a death event) |
| R15b | A fall is nobody's kill for the camera: no kill shake, hit-stop or FOV punch, also with no local pet | n/a: Godot has no kill camera reaction (no shake, hit-stop or FOV punch in engines/godot/game; player.gd:46 and :132 set the aim FOV only) | fx-reactions-fall:9-12 (me −1: no reaction at all); :14-19 (while you play: none for a fall, the full one for your own kill, the self-death shake for your own fall). The guard: fx/reactions.ts:70; with the guard removed, fx-reactions-fall:9-12 fails. | WEB ONLY (Godot has no kill camera reaction) |
| R16 | Takedown feed `<killer>  >  <victim>` | shot `hud-godot-death.jpg` (S): `Cat Bot 1  >  You` | slab-view:152 | MATCH |

## Bots (Sprint C card items 7-9; item 8 NOT MET)
| # | Rule | Godot proof | Web proof | Status |
|---|---|---|---|---|
| B1 | Bots spend at most 5 % of their slab time in the 1 m edge band (card item 7) | bot_contest:85-87 (fails over 5 %; this run 0.9 %); :81-84 (and under 76 of the 80 pet-s on the slab; this run 80.0). A synthetic scenario: four unhurt bots placed on the slab. | no test (tactics.ts:21-22: a random spot within 35 % of the slab's size of its centre) | GODOT ONLY (G15) |
| B2 | 2v2 roles: one bot HOLDS, one APPROACHES; a 1v1 bot HOLDS (card item 8) | **Labels and intent only.** bot_roles:115-117 (roles by format; this run HOLD / HOLD in 1v1, HOLD + APPROACH in a 2v2 team of two bots) and :56-65 (APPROACH finds its post and heads there: intent, not arrival). **In play the APPROACH bot is at its post under 1 % of its alive time** (0.8 s and 0.1 s per match; the checker measured 0-2.4 %: bot-roles.md:89-93). **The trap** (bot.gd:40-44): `_steer()` counts any bot inside the slab as on it and aims straight at its goal (bot.gd:303-306); `_hold_inside()` clamps that wish inside the margin (:338-339); `_think()` does nothing while the bot pushes (:228-229). So an APPROACH bot whose post lies past the slab is held on the slab. **Lead ruling:** the roles code stays (behaviour-neutral, Fisher p 1.0; it carries the tested rematch reset: bot-roles.md:94-95). The trap fix is the next card (bot-roles.md:98-99, :151-157). | no roles | **NOT MET** (card item 8: roles nominal in play, G22) |

The rematch reset of the bots is row X7.

## Shots used (each one opened)
| Shot | Build | How it was made |
|---|---|---|
| `hud-godot-death.jpg` | Godot | S: shot_hud.gd, `me.die(cat)` with time frozen |
| `hud-godot-hits-gray.jpg` | Godot | Y: confirms through `hit_confirmed.emit`; the received hit S (`take_damage` from a placed Cat) |
| `hud-godot-win.jpg` | Godot | S: score set to 60-41, `end_match(0)` |
| `hud-web-marker-states.jpg` (+ `-gray`) | web | L for NEUTRAL and CAT CADRE; **CONTESTED S** (the zone flagged Busy in the delivered snapshots) |
| `hud-web-marker-foundation.jpg`, `hud-web-marker-scaffolds.jpg` | web | L: `&autoplay` (`&team=1`) |
| `hud-web-hits.jpg` | web | Y: hit, head-hit and knockout events added to a real snapshot |
| `hud-web-hit-received.jpg`, `hud-web-death.jpg` | web | S: `&slabHurt` schedules a real enemy's hits and its knockout of the human |
| `hud-web-win.jpg` | web | L: a real end, the clock shortened (`&slabTime=8&slabOvertime=4`) |

Also opened and consistent: `hud-godot-hits.jpg`, `hud-godot-hit-received.jpg`, `hud-godot-marker-near.jpg`,
`hud-godot-marker-corgi.jpg` and `hud-godot-marker-cat.jpg` (all S, from shot_hud.gd). The patch round changed no
shot. q-parity opened every shot. q-cc-parity reopened five and found each as described: `hud-godot-death.jpg`,
`hud-web-death.jpg`, `hud-web-marker-states.jpg`, `hud-web-hits.jpg` and `hud-godot-hits.jpg`. Sizes, read from the
JPEG headers:
- Godot: 1280 × 720, except the hits grids, which are 906 × 906.
- Web: 1200 × 675, except the states strip (1200 × 350) and the hits strip (1092 × 364).

TW-VIEW.md:84-85 now says the web shots were captured at 1280 × 720 and published at these sizes.

## Gaps (owner)
| Gap | Severity | Row | What is missing | Owner | Status |
|---|---|---|---|---|---|
| G1 | major | X7 | The web rematch did not reset the bots' brain. | tw-sim | **closed**: `resetBrain` + slab-mode:432-460 + probe (X7) |
| G2 | minor | X9 | The web's kill-feed clear on the rematch had no test. | tw-view | **closed**: e2e:158-170 (X9) |
| G3 | minor | X3 | The web ignores a rematch press for 1 s after the end; Godot does not. Rule on it (add it to §5, or remove it). | lead | open |
| G4 | minor | X4 | Pad X rematches on the web only. Rule on it, then test it. | lead | open |
| G5 | minor | R15 | Godot had no test of the fall plane or of the `The Lot  >` feed line. | lead | **closed**: test_game_fall.gd; mutant P2 killed (R15) |
| G6 | minor | R14 | Godot: the spawn shield has no test. | lead | open |
| G7 | minor | R2, R4, R9b | Godot: no test of 1/s with two holders, the reset of a part-counted second, or overtime ending on a lead. | lead | open |
| G8 | minor | M3, M4 | Godot pinned the 120 px cap and the safe edges only by symbol. | g-hud | **closed**: marker:65-72 literals; mutant P1 killed |
| G9 | minor | D6, D7 | Godot never asserts `respawn_zone(1)` is THE SCAFFOLDS at 132 m, nor that `respawn_zone(0)` is 142 m. | g-hud | open |
| G10 | minor | H1 | Neither build tests that the crosshair gap opens with the spread. | g-hud, tw-view | open |
| G11 | minor | H2 | Godot has no muzzle-flash test, and the web's is a generic allocation test. | lead, tw-view | open |
| G12 | note | F13 | Godot: no test that a slab match shows no Label3D nameplates. | g-hud | open |
| G13 | note | H19 | Godot: no test for "no music" (it holds by construction). | a-hook | open |
| G14 | note | X2 | Web: no test that R during play does not rematch. | tw-sim | **closed**: slab-mode:415-430 (X2) |
| G15 | note | B1, B2 | The twin's bots have no roles and no edge-band test. Rule whether the twin follows. | lead | open |
| G16 | note | M2, D1, D5, D10 | Web layout clauses are proven by shot only: words above the shape, the panel centred, the glyph colour, the rounded backing. | tw-view | open |
| G17 | note | shots | **Retracted in part.** The first version called G-HUD.md's arm lengths stale. They are not: G-HUD.md:94-96 (7-14 px body, 8.5-21 px kill) is right for hud.gd's unnormalised diagonals (H20). The real gap is the web's size (G21). The TW-VIEW half (shots said to be 1280 × 720) is fixed at TW-VIEW.md:84-85. | g-hud, tw-view | **closed** |
| G18 | note | X8 | The e2e rematch case cannot put a cue up before the end, so the web's §5 cue proof is the unit tests. | tw-view | **settled**: e2e:126-130 and TW-VIEW.md:17-21 now call it a smoke check (X8) |
| G19 | note | M20 | `LINEUP_AIM_LIFT` has no test. | lead | open |
| G20 | note | H11 | Web: no wedge for an attacker never seen in a snapshot. | lead (ruling) | open |
| G21 | minor | H20 (H4, H6) | The web's confirm X is 1/√2 of Godot's size: slab-hud.ts:405-408 uses unit diagonals, while hud.gd:446-449 uses (±1, ±1). Adopt Godot's geometry (an arm from (±1, ±1)·r0 to (±1, ±1)·r1). Fix the slab-hud:180 comment, pin the arm reach in both builds, and reshoot `hud-web-hits.jpg`. This predates Sprint C. | tw-view | open (later) |
| G22 | major | B2 | Card item 8 is NOT MET: the roles are nominal in play because of the trap at bot.gd:228-229, :303-306 and :338-339. test_bot_roles.gd checks labels and intent, never arrival. The next card fixes the trap, re-measures 2v2 n 120 and 1v1 n 80, then picks between dropping the roles and a post inside the 6 m zone. It also lands an arrival check. | g-bot (trap card), lead (report) | open (next card) |
