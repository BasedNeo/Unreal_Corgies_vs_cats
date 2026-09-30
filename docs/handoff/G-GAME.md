# G-GAME handoff — the playable match in Godot (Wave 12)

**Status: done for integration; nothing staged or committed.** `npm run godot` opens a match: the player (Corgi
Company) against a Cat Cadre bot on The Lot. Move, look, jump, shoot one rifle, go down and respawn, and fight for
the slab. Holding it alone scores 1 point a second, and a contested slab scores nothing. First to 60 or the lead at
3:00 wins. A tie at 3:00 goes to overtime until someone leads (60 s at most, then a draw). A winner screen follows,
and R / Enter / Start starts a rematch. F2 / Back switches between 1v1 and 2v2 (you plus a Corgi bot against two Cat
bots). The game only uses the world through the README contract, and it runs on both the skeleton world and
G-WORLD's The Lot (`2d2ff28`).

## 1. Files (all under the lane's paths)
| Path | What |
|---|---|
| `engines/godot/game/input_setup.gd` | **Edited.** The `GameInput` autoload binds every action in code: keyboard, mouse and gamepad (deadzone 0.2). |
| `engines/godot/game/match.gd` | **Replaces the stub.** Match flow: waits for `built` (connected in `_enter_tree`, so an early emit is not missed, plus `is_built`), spawns, slab scoring, timer, overtime, respawn at the spawn farthest from enemies, winner, rematch, 1v1 / 2v2, user args, the perf probe. It adds a fallback floor and nav region **only** when the world has no collider or no `nav_region()` (the skeleton). |
| `engines/godot/game/tuning.gd` | Numbers from TS: `BASE_MOVE` per species (classes.ts), `GRAVITY` (constants.ts), `squeaker_rifle` (weapons.ts), assault `maxHp` 120, team colours (style-tokens.js), physics layers. |
| `engines/godot/game/pet.gd` | Base pet: a `CharacterBody3D` on layer 2 with a capsule collider (never the render mesh) and an `Area3D` capsule hitbox on layer 3. Shared movement: accel/decel, air control, buffered and coyote jump, variable jump height, heavier fall. Also HP, death and respawn with a 1 s spawn shield. |
| `engines/godot/game/player.gd` | Third-person boom camera: `SpringArm3D` over the right shoulder that collides with layer 1. Mouse or stick look, camera-relative movement, sprint, aim (zoom plus tight spread), recoil kick, and the crosshair ray from the camera. |
| `engines/godot/game/rifle.gd` | Hitscan, 10 rps auto, 15 damage, ×1.6 head (top 20 % of the capsule), falloff 24→48 m down to 0.6×, 90 m range, 30-round magazine, 1.6 s reload, hip / aim spread, bloom. Muzzle flash (billboard plus light), tracer, impact spark. No friendly fire: teammates' hitboxes are excluded. Bots within 38 m hear shots. |
| `engines/godot/game/bot.gd` | `NavigationAgent3D` to the slab. A 150° view cone, or hearing, plus line of sight, then a 0.4–0.7 s reaction delay, 5 rad/s aim tracking, and bursts of 5–9 with 2° extra spread. Strafes, and jumps at ledges and when stuck. Thinks at 10 Hz. Waits for `nav_ready()` when the world has it. |
| `engines/godot/game/slab.gd` | Occupancy (`contains`, `evaluate` → holder / contested / counts) and the read-out: a glowing frame, fill and light in white (neutral), the team colour (held) or flashing amber (contested). |
| `engines/godot/game/hud.gd` | Scores with bars to 60, timer (red under 30 s, OVERTIME), slab state, crosshair that opens with spread, hit marker (white body, gold head, red takedown), a SLAB marker clamped to the screen edge, HP, ammo / RELOADING, takedown feed, "TAKEN DOWN · back in n", damage flash, a 14 s controls hint, the **PLACEHOLDER PETS** tag, and the winner screen with your takedowns and knockouts. |
| `engines/godot/game/pet_model.gd` | Placeholder pets built from primitives. **Corgi:** a long, low barrel body, short legs, big upright ears. **Cat:** slimmer, longer legs, small pointed ears, a tall curled tail. Both wear a team vest plate. Glowing team trim marks each species' signature (the Corgi's inner ears and back line, the Cat's upper tail). Closed mouths, no mouth or tongue geometry. Uses `Look.pet_material(kind, species, team)` (coat / plate / metal) when present; otherwise fallback materials (fur rim sheen, emissive team plate). |
| `engines/godot/game/testkit.gd` | Test support: boot `main.tscn` with options, step physics, and a `Logger` that turns every engine or script error into a test failure. |
| `engines/godot/tests/test_game_{move,rifle,slab,rematch,soak}.gd` | The headless tests (§4). |

## 2. Controls
WASD / left stick: move (camera-relative, no auto-walk) · mouse / right stick: look · Space / A: jump · LMB / RT (or
RB): fire · RMB / LT (or LB): aim · Shift / L3: sprint · R / X: reload · R / Enter / Start on the winner screen:
rematch · Esc: free the mouse (a click captures it again, and that click does not fire) · F2 / Back: 1v1 ⇄ 2v2
(restarts the match).
User args after `--`: `--2v2`, `--bots-only` (a bot takes your place; spectator camera), `--debug` (a PLACEHOLDER
Label3D over each pet), `--demo` (the first round starts 9–13 m from the slab, for proof shots), `--perf N`
(prints the tick cost after N s and quits).

## 3. How it uses the contracts
`built` / `is_built` · `spawn_points(team)`: if either team is empty, or the two teams' points are within 8 m of each
other (the skeleton), it falls back to both ends of the slab's axis · `slab()` · `nav_region()`: if missing, a flat
fallback region is used · `nav_ready()`: if present, bots re-request their path once it is true · groups `ground`
(fallback floor size) and `world_static` · layers 1 / 2 / 3 · `Look.pet_material`. It does not use `spawn_yaws` or
`ground_height`, because they are not in the README contract. Pets face the slab on spawn.

## 4. Proof (commands run in this lane, Godot 4.7.2, this container)
- **Headless, live tree** (`godot --headless --path engines/godot --script res://tests/run.gd`, final run):
  `PASS test_game_move.gd` · `PASS test_game_rematch.gd` · `PASS test_game_rifle.gd` · `PASS test_game_slab.gd` ·
  `PASS test_game_soak.gd` (plus `test_lead_boot`, `test_look_contract`). The soak line from that run on The Lot:
  `60.0 s game in 15.1 s real · score 6-31 · 5 takedowns · 312 shots`. An earlier run printed `score 21-14 ·
  5 takedowns · 232 shots` and ended in `GODOT TESTS: PASS`, exit 0.
  The final run did not finish (timeout 300 s) because G-LOOK's in-progress `test_look_scene.gd` failed to parse at
  that moment. See risk 1.
- What the tests check: move pressed → ≥ 2 m in 0.5 s at exactly `runSpeed`; release → 0 m/s within 0.25 s, no drift
  over 0.5 s; reverse flips the velocity within 0.25 s; the jump rises ≥ 1 m and lands. The rifle damages the target
  in front (15 at 10 m, 24 on the head), not one behind a wall and not one behind the shooter; the fire-rate cap and
  the falloff (15 / 12 / 9 at 10 / 36 / 60 m) hold. Slab: +3 after 3 s alone, 0.5 + 0.5 s makes 1 point, 0 while
  contested, the Cats score alone, a downed pet neither holds nor contests. Match flow: rematch is ignored during play;
  reaching 60 ends the match and shows the winner screen; rematch resets the score, the timer, the winner, overtime
  and HP; time out goes to the leader; a tie goes to overtime. Soak: 60 s of 2v2 bots (4× speed, still 1/60 s per
  tick) with no engine errors, a changed score, shots fired and every bot having travelled.
- **Screenshots** (xvfb, gl_compatibility, llvmpipe, on The Lot with G-LOOK's look):
  `artifacts/godot/g-game-midmatch.png` (`-- --demo --2v2 --frames 30`): your Corgi, a Cat bot firing on the slab,
  the slab frame in Cat colour, "SLAB CAT CADRE HOLDING +1/s", scores, 2:57, the feed, HP, ammo, the hint and the
  PLACEHOLDER tag. `artifacts/godot/g-game-30m.png` (proof camera about 30 m from the slab): at 6× zoom the Corgi on
  the slab reads as a long, low body under two upright ears.
- **Tick cost, 2v2 bots, 1× on The Lot** (`-- --bots-only --2v2 --perf 30`, 1800 ticks, load average 6.5 on 4 cores
  with other lanes' Godot runs going): scripted physics tick (every `_physics_process` in the tree, all lanes) was
  **avg 0.863 ms · median 0.772 ms · p95 1.436 ms**. `Performance.TIME_PHYSICS_PROCESS`, which is Godot's
  **worst physics frame of each second** and includes the physics server, was **avg 4.909 ms · p95 19.242 ms**. On the
  skeleton world the same probe measured a scripted avg of 0.200 ms and p95 0.292 ms. The 3 ms budget holds for the
  average scripted tick. The per-second-max monitor is dominated by CPU contention here, so it needs a re-measure on
  the reference machine (the same command).

## 5. Open risks
1. **The lead's `tests/run.gd` misreports.** When a test file fails to parse, `load(...).new()` errors and the runner
   never quits: the lead's run hung. When a test coroutine hits a script error it returns null, and the runner prints
   **PASS** (seen with `test_lead_boot` while the game failed to compile). Suggested lead fix: `if t == null` → FAIL,
   and `if not errs is Array` → FAIL. G-GAME tests guard against this themselves by catching every engine error
   through `testkit.gd`.
2. **Ledges:** a `CharacterBody3D` has no step-up, so The Lot's navmesh climbs (up to about 0.7 m) need a jump. Bots
   jump at them, and players must too. Either the game adds a step-up or G-WORLD lowers `agent_max_climb`.
3. **Map balance:** both soaks on The Lot favoured the Cats (6-31 and 0-40 before the ledge fix). The Corgi route
   climbs out of a ditch and reaches the slab about 4 s later than the Cats (about 22 s against 18 s). That is a
   G-WORLD / design question.
4. Bot difficulty (2° aim error, 0.4–0.7 s reaction) is tuned by eye and by soaks, not with human playtests.
   With `--demo` the pets start in view of each other, so takedowns come within seconds.
5. Not yet at the AAA bar: **no audio**; the placeholder pets have no animation (they slide); no death animation (the
   pet vanishes). At 30 m a pet is about 15 px at 720p, and species read from the silhouette plus the glowing trim.
6. The kill plane is the slab height minus 40 m (the world's `killY` is not in the contract).
7. TIME_PHYSICS_PROCESS figures above were measured under heavy contention; see §4.
