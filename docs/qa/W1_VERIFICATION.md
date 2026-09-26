# W1 Verification — Q1 independent verifier

**Verdict: Wave 1 is NOT done.** The commit that claims "Wave 1 integrated … full gate green" (`484a2e2`, docs `b8b79e0`)
does not boot, fails its own unit gate, and fails its e2e smoke. The crash was fixed 45 minutes later by an unrelated
checkpoint (`84ec1cc`), but nothing in the process caught it. With the crash patched out, the sim, netcode and
unit suites reproduce their claims exactly. The player-facing layer does not hold up: the camera goes through
walls, the crosshair lies while you move, the HUD lies about respawn and cooldowns, the offline match starts
without you, and online solo skirmish is lost in about 30 s. Scorecard **55 / 100 (R 52 · I 68 · F 40), gate FAIL**.

| | |
|---|---|
| Verified SHA | `b8b79e0` (Wave 1 claim point). Re-checked at `84ec1cc` for the P0 fix and for the code behind every other finding. All P1/P2 code paths are unchanged at `84ec1cc`. |
| Method | Clean `git archive` snapshots in the scratchpad (other lanes were editing the tree), so every run is pinned to a SHA. Only one change was made to the snapshot: 24 missing palette keys were added so the game could be played past the P0. That scratch patch was never applied to the repo. |
| Box | 4 shared cores, load 6–9 from other lanes. Headless Chromium uses SwiftShader: **0.3–1 fps** at 480×270…1280×720. |
| Consequence | At 1 fps the client produces only about 25 % of real-time input (0.25 s frame cap), so browser sessions verify integration, presentation, HUD, menus, netcode and errors, **not feel**. Feel was measured on the shared `stepCharacter` at 60 Hz (`tools/qa-feel.mjs`). Difficulty was measured with an AI stand-in playing through the human input path (`tools/qa-difficulty.mjs`). |
| My outputs | `tools/qa-{feel,budget,difficulty,abuse,play,hud,fps}.mjs`, `artifacts/qa/*.png` + `*.json`. The lead's checkpoint `84ec1cc` committed three of these tools; I did not commit anything. |

---

## 1. Gate and tests (re-run, not trusted)

| Check | Command | Result | Verdict |
|---|---|---|---|
| Fast gate, working tree 03:01 | `npm run gate:fast` | `Tests 1 failed \| 190 passed (191)` · `× uses only palette colors that exist … 'tomatoGreen'` · `GATE FAIL \| typecheck:ok boundaries:ok unit:FAIL` | **FAIL** |
| Fast gate, pristine `b8b79e0` | `node tools/gate.mjs --fast` | same failure, `GATE FAIL` | **FAIL** |
| E2E smoke, pristine `b8b79e0` | `npx playwright test tests/e2e/smoke.spec.ts` | `2 failed` (both time out on `__cvc.ready`) | **FAIL** |
| Boot, `b8b79e0` build | `probe '?webgl&autoplay&quality=low'` | `Failed to start: world palette: unknown color key 'tomatoGreen'`. After patching that key: `'wire'`. **24 garden keys missing** in total. `artifacts/qa/q1-boot-head.png` | **P0** |
| Boot, `84ec1cc` | `vitest tests/unit/world` + prim-key scan | `15 passed`, `missing []` | fixed after the fact |
| L1 unit | `vitest run tests/unit/characters` | 26/26 | PASS |
| L1 audit | `node tools/char-audit.mjs` | `all 24 character kits PASS` | PASS |
| L2 unit | `vitest run tests/unit/world` | 14/15 at HEAD, 15/15 with the palette patch | FAIL at HEAD |
| L3 unit | `vitest run tests/unit/combat tests/unit/ai tests/unit/match` | 33/33 | PASS |
| Movement | `vitest run tests/unit/sim-movement` | 6/6 | PASS |
| L4 | `vitest run tests/unit/net --reporter=verbose` (= `npm run test:net`) | 33/33. Net matrix and bandwidth tables reproduce **bit-identical** to the handoff (pred err 0.00 at 80/150 ms, 14.06 / 30.61 KB/s) | PASS |
| L5 unit | `vitest run tests/unit/ui tests/unit/audio tests/unit/fx` | 36/36 | PASS |
| Soak | `npx tsx tools/soak.mjs` | `SOAK PASS \| score 96 \| modes 2 · errors 0 · stuck max 1s · tick p95 1.21 ms · completed 2/2` (skirmish R99/I100/F85, TDM R98/I100/F85, deterministic ×3) | PASS, but see §4: it only covers 6–8 characters |

## 2. Lane claims: PASS/FAIL

| Lane | Claim | Evidence | Verdict |
|---|---|---|---|
| Lead | "Full gate: typecheck, boundaries, unit, build, e2e (4) all pass" (`484a2e2`) | §1: unit FAIL, e2e FAIL, boot crash from `484a2e2` through `79abd1c` (`world-palette.ts` untouched until `84ec1cc`) | **FAIL** |
| Lead | Wave 1 commit integrates Wave 1 | `git show --stat 484a2e2` also adds about 3,000 lines of in-flight Wave 2 code: `sim/boss/*` 1,251, `sim/vehicles/systems.ts` 686, `garden.ts` 517, `weather.ts` 339, `bosses.ts` 341. None of it is covered by a Wave 1 proof, and it is what broke boot. | **FAIL (process)** |
| Lead | Camera §7.4: "no clipping at tight spots" | `q1-cam-1-back-to-wall.png` (fence back face fills the screen), `-2` / `-3` (black interior), `-4` / `-5` (wall on the right shoulder: character gone) | **FAIL** |
| Lead / L3 | Camera uses AIM_RAY, "hits land under the crosshair" | True only when standing still. `qa-feel`: 0.29 m lateral error strafing at run, 0.44 m at sprint, 0.60 m vertical in a jump, plus 214 ms of shoulder mismatch after pressing RMB | **PARTIAL** |
| Lead | Main menu while the room runs | `skirmish.json`: after about 75 s in the menu, PLAY OFFLINE lands in "Wave 2/5 — 3 cats left". An AFK player's squad loses at 189 s / 222 s (`qa-difficulty`, AFK rows) | **FAIL (FTUE)** |
| L1 | Rigged, animated, budgeted characters, glow fixed | audit 24/24; glow visible on the rifle in `q1-aim.png` | PASS |
| L1 | "Species, team, class readable at 50 m" | Team reads by color and nameplate. Species reads up to about 25 m. Class is only a hat, and at 30–40 m characters are about 20 px tall (`q1-perf-high.png`, `q1-tdm-start.png`) | **PARTIAL** |
| L2 | Collider = visual; trimesh has no spurious ray/KCC misses | 4×67 s of running on open West Yard lawn, raw and quantized: 0 spurious stops. The flat test slab does produce them (7–11 per 30 s), so it is a test-world artifact only | PASS |
| L2 | Frame budgets | 1280×720 TDM: **182–190 draw calls, 1.00–1.01 M tris** at high. Low tier: 177–185 / 0.93–0.94 M, so low is only 3 % / 7 % cheaper | PASS (tier weak) |
| L2 | Spawns face the map | spawn (-64, -70) yaw 4.05 rad ≈ bearing to the yard centre (3.88) | PASS |
| L3 | Soak ≤ 3 ms p95, 0 stuck, match completes | reproduced at 6–8 characters | PASS |
| L3 | "≤ 3 ms at 12 players + 16 bots" (§8.7) | `qa-budget`, 28 characters, live TDM, best-of-3 min(wall,cpu): **p50 2.89 · p95 3.71 · max 6.1 ms**. Single run p95 6.3 ms at load 8.7 | **FAIL / unproven** |
| L3 | Bots "deliberately beatable", abilities live | AI stand-in in offline skirmish dies **3–4×/min, first death at 14–16 s**. Bark blast used 0× in 180 s by 4 assault bots in TDM (cloak 18×) | **PARTIAL** |
| L4 | Prediction exact, matrix within budget | matrix reproduced bit-identical | PASS |
| L4 | 2-client online over `npm run server` | 80 ms / 1 %: both joined, predicting. B saw A move **54.38 m**; A's own view vs B's view of A converged to **0.00 m**. `q1-online-a.png` / `-b.png` | PASS |
| L4 | Server hardening | `qa-abuse` Part A **10/10** (malformed → 1008 after 21 frames; 12 KB refused / 40 KB → 1009; binary + pre-hello → 1008; 800-message flood → 1008 in 14 ms; hostile hello sanitized; Infinity / far-ahead seq, class/team spam survive; no-hello → 4001) | PASS |
| L4 | Server hardening: pressure | Part B: **one IP creates 31 of 32 rooms**. Victim snapshot gap goes from 38 ms to **288 / 399 ms**, 987 overruns, RSS 770 MB. Part C: **+14 % speed** from 2 inputs/tick | **FAIL** |
| L4 | Bandwidth ≤ 40 KB/s | 28 characters in a live TDM, delta wire: **28.1 KB/s per client** | PASS |
| L4 | Initial download ≤ 5 MB gz | index 0.40 + worker 1.71 + prediction 1.68 = **3.79 MB gz**. `dist/` also ships **17 MB of source maps** | PASS (maps P2) |
| L5 | HUD, menus, scoreboard, death screen, settings | `q1-menu.png`, `q1-settings.png`, `q1-scoreboard.png`, `q1-dead.png`, `q1-tdm-scoreboard.png` all render and read cleanly at 1280×720 | PASS |
| L5 | HUD truthfulness | `tools/qa-hud.mjs` (real module): Q ring `cooling 8` after a **slide** and after a **ground pound**; death countdown reads **"2"** at the 3.0 s respawn; wave timer `0:00` with class `low` (red) for the whole wave | **FAIL** |
| L5 | 0 console errors | 5 sessions on the patched build (skirmish 5.7 min, TDM 4 min, online, camera, perf): 0 page errors, 0 console errors | PASS (patched) |
| L5 | FX ≤ 1 ms, zero allocations per spawn | unit tests pass; CPU not measurable headless | unverified |
| All | Memory: no growth | skirmish 82–93 MB over 5.7 min; TDM 77–101 MB over 4 min; no upward trend. Only about 300 frames at 1 fps, so this is weak evidence | PASS (weak) |

## 3. Feel numbers vs §4 (`npx tsx tools/qa-feel.mjs`, shared movement code at 60 Hz, player quantization on)

| Target | Measured | Verdict |
|---|---|---|
| Corgi run 6.4 / sprint 9.6 / aim-walk 3.6 m/s | 6.41 / 9.60 / 3.61. Cat 6.60 / 8.80 / 3.80. Infiltrator sprint 10.39 | PASS |
| Ground accel 70 m/s² | 0→90 % run in 83 ms; stop from run 133 ms / 0.36 m | PASS |
| Jump / double / variable height | held apex 1.40 m (cat 1.76), double 2.42 m (cat 2.94), 1-tick tap 0.43 m | PASS |
| Coyote 120 ms (cat 140) | ground jump when pressed at 67 / 100 / 117 ms airborne | PASS |
| Jump buffer 120 ms | works at 100 ms, **lost at 116 ms** (effective window about 100 ms, one tick short) | minor FAIL |
| Slide (crouch while sprinting) | 650 ms, **4.78 m vs 6.24 m if you had kept sprinting**. Exit speed 5.1 m/s, below run speed. Hitbox unchanged | **FAIL (feel)** |
| Ground pound | slams at −26 m/s. Pressing C in the first 30 ms after takeoff is ignored and not buffered | minor |
| Input → response ≤ 1 tick + 1 frame | same tick in the sim; local prediction is on | PASS |
| Camera settles ≈ 150 ms | x/z 136 ms; y and distance 300 ms | PASS |
| Aim zoom ≈ 120 ms | FOV λ=8 → **374 ms** to 95 % | **FAIL** |
| Hit-stop 3–5 frames on crit/kill, trauma shake | wired: crit 3 frames, kill 5 frames (L5 table, `main.ts` bus) | PASS |

## 4. Performance budgets §8.7

| Budget | Measured | Verdict |
|---|---|---|
| Sim tick, 12 players + 16 bots ≤ 3 ms | best-of-3 p50 2.89 / p95 3.71 ms (`qa-budget`). The soak's 1.2 ms is for 6–8 characters | **FAIL** |
| Snapshot ≤ 40 KB/s at 12 players | 28.1 KB/s | PASS |
| Draw calls ≤ 400 | ≤ 190 | PASS |
| Visible tris ≤ 1.5 M | ≤ 1.02 M | PASS |
| Initial download ≤ 5 MB gz | 3.79 MB | PASS |
| Client CPU ≤ 4 ms, GPU ≤ 12 ms, 60 fps reference | not measurable here (SwiftShader) | unverified |
| No per-frame allocations (§7.2) | camera allocates 3 `Vector3` per frame (`third-person.ts:42,43,52` @b8b79e0). `NetClient.interpolated()` allocates a `Map` and one object per entity per frame (`net-client.ts:275-300`) | **FAIL** |

## 5. Security and abuse (`npx tsx tools/qa-abuse.mjs --url ws://localhost:8797` against `server/index.ts` @b8b79e0)
Rejection paths are solid: 10/10 in Part A (details in §2). Rendering is escaped everywhere I checked (kill feed,
scoreboard, death screen, nameplates, toasts). Names are whitelisted server-side, and there is no entity id in
the protocol to spoof. The holes are about resources and integrity:
1. **Room creation is per request, capped only globally.** One IP (16 sockets) filled 31 of 32 rooms in seconds. Creating rooms stalls every other room: the victim's snapshot gap rose from 38 ms to 399 ms, and RSS reached 770 MB. A second IP, or one more churn cycle, and legitimate players get "server full".
2. **Input-rate speed exploit:** sending 2 inputs per tick earned 42 catch-up ticks in 4 s (about 10 per second, `room.ts:273`), which is **+14 %** distance (37.8 m → 43.2 m in a 4 s sprint).
3. **Class/team switch = full heal + teleport + respawn bypass** (`room.ts:161-170`). 10 hp → `{t:'class'}` → a new entity at spawn with full hp and no death recorded. While dead, a switch respawns you after 62 ticks instead of 180. The normal menu's class cards trigger this, despite the label "applies on your next spawn".
4. `/stats` is unauthenticated, lists every room name (room names act as private-room keys), and anyone can call `?reset=1`. Source maps are served.

---

## 6. Ranked defects

### P0 — crash / blocker
**P0-1. The Wave 1 SHA does not boot, and the gate claim was false.**
- **Repro:** `git archive b8b79e0` → `vite build` → open `/?webgl&autoplay` → "Failed to start: world palette: unknown color key 'tomatoGreen'". `vitest tests/unit/world` fails; e2e smoke 2/2 fail.
- **Cause:** `484a2e2` committed in-flight G1 `src/shared/world/garden.ts` (e.g. `:176` `'tomatoGreen'`, plus 23 more keys). `worldColor()` throws on unknown keys (`src/client/world/world-palette.ts:51`), and `createWorldView` aborts `main()`. The gate that "passed" did not run on the committed tree.
- **Status:** keys added in `84ec1cc` (verified: 15/15, 0 missing).
- **Remaining fix:** (a) integration commits stage only the verified lanes' paths; (b) CI (`game-dev-github`) runs `npm run gate` on every push to the branch; (c) `worldColor` falls back to magenta and `console.warn`s instead of throwing at boot.

**P0-2. The default online experience is an unwinnable 30-second loop for a solo player.**
- **Repro:** `npm run server` (defaults `MODE=yard-skirmish`, `BOTS=0,4`) → join alone as a corgi. `qa-difficulty` "online default" rows: **lost in wave 1 at 27 s and 32 s** (both seeds), 3 deaths. In the browser, A was at 4 hp about 2 min after joining (`q1-online-a.png`).
- **Cause:** `server/config.ts:77` `bots: [0, 4]` adds 4 team-fill cats (the accurate profile) on top of the PvE waves. Solo, every death is a squad wipe, and `wipeLives: 2` (`src/sim/match/config.ts:61`) means the 3rd death loses the match.
- **Smallest fix:** default `BOTS` for skirmish to `3,0` (same as offline `main.ts:47`), or fill corgi bots up to 3 when a mode is PvE.

### P1 — fun / feel / readability breakers (highest player impact first)

**P1-1. The camera goes through walls and fences on contact.**
- **Repro:** `?mode=free&bots=0,0`, back into the NW fence corner (`q1-cam-1`), look up or down (`-2`, `-3`), or strafe right into a wall (`-4`, `-5`).
- **Cause:** `src/client/camera/third-person.ts:46-48` @b8b79e0 (`:58-60` @84ec1cc). The ray starts at the shoulder point, which can already be inside geometry, and the proxies are FrontSide. `d = Math.max(0.6, hit - 0.3)` forces the camera 0.6 m back even when the hit is closer, which puts it through the wall. It is a single thin ray, and the near plane is not accounted for.
- **Fix:** ray pivot→shoulder first and shorten the shoulder to (hit − 0.2); then sphere-cast (r≈0.25) shoulder→camera; drop the 0.6 floor (fade the avatar under 0.8 m); `side: DoubleSide` on the proxies. Keep the 5 shots above as a bookmark regression.

**P1-2. The offline match starts behind the main menu, and players join mid-match or lose it without playing.**
- **Repro:** open `/` and read the class cards → PLAY OFFLINE drops you into wave 2+ (`skirmish.json`). An AFK squad loses at 189–222 s.
- **Cause:** `main.ts:50` creates the worker room and joins at boot; `main.ts:91` only overlays the menu. The warmup (5 s) runs out behind it.
- **Fix:** create the worker transport, or send `hello`, on PLAY; alternatively keep the room in warmup while the menu is open.

**P1-3. The crosshair lies while you strafe or jump.**
- **Repro:** `qa-feel`: the authority ray starts at the exact position; the camera ray starts at a damped pivot (λ22 x/z, λ10 y). That is a parallel offset of **0.29 m strafing, 0.44 m sprint-strafing, 0.60 m mid-jump**, the same miss at every range. Capsule radius is 0.33–0.36 m, so strafe and jump shots at an edge or head whiff with the crosshair on target. Pressing RMB also changes the authority shoulder instantly while the camera eases over 214 ms.
- **Cause:** `third-person.ts:32-36` @b8b79e0 (damped pivot and shoulder) vs `src/sim/combat/weapon-system.ts:82-83`.
- **Fix:** build the camera's look ray from the undamped predicted pivot and damp only the camera body offset behind it; snap the camera shoulder on the aim edge, or ease the authority shoulder the same way.

**P1-4. The HUD contradicts the sim.**
- **Repro:** `node tools/qa-hud.mjs` (real module). The Q ring shows **cooling 8 s** after every slide or ground pound; the ability was never used. The death screen counts 5→2 and you are back at 3.0 s (browser: 6/6 respawns at exactly 3.00 s while the ring read 5, 4, 3). The wave timer is red **"0:00"** for the whole wave (`q1-play-start.png`). The reload chip assumes 1.6 s for every weapon. The cloak estimate is 12 s; the real cooldown is 16 s.
- **Cause:** `hud.ts:590-591` treats any local `ability` event as the Q ability, and `NetClient` predicts `slide`/`ground_pound` as `ability`. `main.ts:159` passes no `respawnIn`/`ability`/`reloadFrac`/`magSize`, so the HUD falls back to `strings.ts:25-32` guesses. `hud.ts:347` marks `timeLeft ≤ 30` as urgent even when it is 0 by contract.
- **Fix:** ignore `slide`/`ground_pound` in the ring; compute `respawnIn` from the death tick + `COMBAT_RULES.respawnDelay`, and cooldown/reload from `ABILITIES`/`WEAPONS`; hide the timer when `wave > 0 && timeLeft === 0`.

**P1-5. Class/team switch is a free heal, teleport and respawn skip, and the normal menu triggers it.**
- **Repro:** at 10 hp, send `{t:'class'}` (or click a class card: Esc → MAIN MENU) → a new entity at spawn with full hp and no death recorded; while dead → alive after 1.0 s instead of 3 s.
- **Cause:** `src/host/room.ts:161-170` → `respawnAs()` immediately, even when the class is unchanged.
- **Fix:** store `p.pendingCls` / `pendingTeam` and apply it in the respawn path (after the next death), or only when full hp and not damaged in 5 s. This makes the UI label true.

**P1-6. The first minute is a death treadmill (FTUE, §2 flow).**
- **Evidence:** offline default (you + 2 bot corgis), with an AI stand-in playing competently: first death **14–16 s**, 20–30 deaths in a 7–8 min win, 1–2 of the 2 allowed squad wipes used (coin-flip). TDM: first death 12–15 s. The game-design-psychology target is first success within 60 s.
- **Cause:** 0.7 s rifle TTK, and waves of up to 10 cats that focus the nearest corgi in open lawn. Wave 1 has no ramp.
- **Fix (one knob):** wave 1–2 `maxAlive` 4 and grunt damage vs players ×0.6 for the first two waves (`src/sim/match/config.ts`); re-run `qa-difficulty`.

**P1-7. The slide is a dead mechanic.**
- **Evidence:** it loses 23 % distance vs sprinting, exits below run speed, has no hitbox change and no combat effect. Bots never use it.
- **Cause:** `src/sim/systems/movement.ts:14-15,51` (boost only to 1.08× sprint, friction 1.1/s).
- **Fix:** friction 0.35/s and exit at ≥ sprint, or lower the capsule while sliding.

**P1-8. Input-flood speed hack, +14 %** (§5.2). **Cause:** `room.ts:273` grants catch-ups whenever the queue stayed ≥ 3 for a window, regardless of wall clock. **Fix:** credit a catch-up "time bank" only from starved ticks (a client can never run ahead of real time).

**P1-9. One IP can exhaust rooms and stall the server** (§5.1). **Cause:** `server/rooms.ts:66-80`: no per-IP room-creation cap. Each room builds its own Rapier world and nav grid on the shared event loop; the 2-client run recorded a 263 ms tick and 10 overruns. Rooms live 10 s (`ROOM_TTL_MS`) after they empty. **Fix:** cap rooms created per IP (2) and rate-limit creation; share the static `WorldData`/nav across rooms with the same seed; build rooms off the tick loop.

**P1-10. The full-room tick is over budget and unproven** (§4). The soak never exceeds 8 characters. **Fix:** make `qa-budget --humans 12 --bots 16` part of the soak gate. The movement KCC is the known cost (L3 handoff).

### P2 — polish
- **Aim zoom is 374 ms vs ≈ 120 ms** (FOV λ 8 → 25, `third-person.ts:37`).
- **Jump buffer is effectively 100 ms** (the landing tick is detected after the jump check). Ground pound drops C presses in the first 30 ms of a jump, because `airTime` starts at the coyote value. Buffer the crouch press like the jump.
- **The low quality tier saves only 7 % tris and 3 % draws**, so there is no headroom for the §2 30-fps-on-iGPU target. Low should cut foliage, the shadow map, ink on far props and pixel ratio.
- **Per-frame allocations** in the camera and `interpolated()` (§4).
- **Skirmish UI:** the scoreboard shows "CATS — No one here yet" while 9 cats are alive (`q1-scoreboard.png`). Human cats in skirmish see the corgi objective text (`q1-online-b.png`).
- **TDM default is 4v5 against the player** (`main.ts:47` `'4,5'`). In 3 seeds with the stand-in, the player's K/D was 12/26 at 4v5 vs 16/19 at 5v5. Use `4,4`.
- **4 of 6 classes have a dead Q** (data-only abilities) while the HUD shows it READY. Assault bots almost never bark.
- **Classes are unreadable beyond about 15 m** (only the hat differs). Add a class icon to enemy nameplates, or give each class a distinct weapon silhouette.
- **Changing Quality in settings does not rebuild the world until reload**, and nothing tells the player (`main.ts:67-73`).
- **Ops:** 17 MB of source maps in `dist/`. `/stats` is public, lists room names and accepts `?reset=1`. Behind a proxy without `TRUST_PROXY`, the per-IP cap (16) becomes a global cap.
- **Chat:** the server validates and broadcasts it, but no client UI renders it (dead feature).
- **Tests are weak where it matters:**
  - e2e smoke only needs 12 frames and a 3 m move.
  - Nothing asserts the camera tight spots.
  - The net matrix models loss as dropped frames on what is a reliable TCP stream. Real loss shows up as head-of-line stalls of 200 ms+, which is untested.
  - The flat test slab produces spurious one-tick KCC stops that the real map does not.

## 7. Scorecard (game-sprint-gates: 0.40 R + 0.35 I + 0.25 F)
| Axis | Score | Justification |
|---|---|---|
| **Realism** | **52** | **For:** deterministic sim, 0 desync, exact prediction, 0 stuck bots, 0 console errors (patched), draw-call / tri / bandwidth budgets met. **Against:** boot crash at the Wave 1 SHA (hard DoD: crashes = 0); camera clipping at every wall contact; crosshair vs hit mismatch of 0.3–0.6 m while moving; HUD numbers that contradict the sim; full-room tick over budget; fps never measured on the reference machine. |
| **Intensity** | **68** | **For:** drama rate is high (soak 1.9–3.4 per player-minute); every match reaches an ending (TDM 2–2.7 min, skirmish 7–8 min); dead time is short (3 s respawn, about 10 % dead). **Against:** it overshoots into anxiety (first death at 12–16 s, 3–4 deaths/min); the match starts without you; online solo ends in 30 s; slide and pound add nothing; bots rarely use abilities, so fights are all rifle. |
| **Fairness** | **40** | **For:** bot reactions are human-like (0.35–0.55 s, 45–56 % hits); lag compensation is bounded at 200 ms; no runaway leader (top share 0.21–0.25); mirrored bot TDM is balanced. **Against:** online solo skirmish is unwinnable (0/2); the class-switch heal is reachable from the UI; +14 % speed exploit; the crosshair punishes strafe and jump shots; 4v5 default; the HUD misleads. |
| **Total** | **55** | **FAIL** (minScore 70). Hard limits also fail: a crash at `b8b79e0`, clipping, and an integrity exploit. |

## 8. Quality loop: "change one thing", highest player impact first
1. **Camera collision from the pivot (P1-1).** Pivot→shoulder ray + shoulder→camera sphere cast, no 0.6 m floor, DoubleSide proxies. **Before/after:** `node tools/qa-play.mjs camera` → the 5 `q1-cam-*` shots.
2. **Don't start without the player; don't strand a solo player online (P1-2 + P0-2).** Join the offline room on PLAY; default server skirmish bots to `3,0`. **Before/after:** `qa-difficulty` online rows (27–32 s loss) and `skirmish.json` "after PLAY OFFLINE" wave.
3. **Make the crosshair true (P1-3).** Aim ray from the undamped predicted pivot; damp only the camera body. **Before/after:** `qa-feel` crosshair rows (0.29 / 0.44 / 0.60 m → ≈ 0).
4. **HUD truth pass (P1-4).** Drop movement events from the Q ring; derive respawn, cooldown and reload from the content tables; hide the 0:00 wave timer. **Before/after:** `node tools/qa-hud.mjs` (ring `ready`; countdown reads 0 at 3.0 s; no red timer).
5. **Queue class/team switches to the next respawn (P1-5).** Closes a heal, teleport and respawn exploit that the normal UI exposes, and makes "applies on your next spawn" true. **Before/after:** the class-switch probe in §5.3 (hp 10 → stays 10, respawn stays 180 ticks).

### Reproduce
`npx tsx tools/qa-feel.mjs` · `npx tsx tools/qa-budget.mjs` · `npx tsx tools/qa-difficulty.mjs [--modes tdm]` ·
`PORT=8797 npx tsx server/index.ts` then `npx tsx tools/qa-abuse.mjs --url ws://localhost:8797` ·
`vite build && vite preview --port 4174` then `node tools/qa-play.mjs skirmish|tdm|camera|perf|online [--server ws://localhost:8797 --query '&lag=80&loss=1']` ·
`npx vite --port 5173` then `node tools/qa-hud.mjs`.
