# PROGRESS — Corgis vs Cats (Three.js)

Newest first. Every task appends: what changed, proof (command + result + screenshot), next.

## Status board
| Wave/Lane | State | Proof |
|---|---|---|
| W0 Foundation | ✅ done | gate: typecheck ✓ boundaries ✓ 4 unit ✓ 2 e2e ✓; artifacts/smoke.png |
| W1 L1 Characters | ✅ merged | 26 unit tests; char-audit 24/24 kits in budget; artifacts/l1-lab*.png |
| W1 L2 West Yard world | ✅ merged | 15 world tests (collider≈visual ≤1 cm, spawns, climbs); artifacts/l2/*.png |
| W1 L3 Combat/AI/match | ✅ merged | 33 unit tests; soak PASS (0 errors, 0 stuck, tick p95 ≤ 1.6 ms) |
| W1 L4 Netcode/server | ✅ merged + wired | 33 net tests, matrix 20/80/150 ms × 0/1/3 % (pred err 0 cm at 80/150); 2-client e2e (dev + prod server) |
| W1 L5 HUD/audio/FX | ✅ merged + wired | 36 unit tests; FX 0.19 ms/frame, 0 allocs/spawn; artifacts/l5-*.png |
| W2 V1 Vehicles | ✅ merged + wired | 27 tests; kart + Kart-O-Matic; chase camera |
| W2 B1 Vac-Tank boss | ✅ merged + wired | 23 tests; bots beat it in 217 s; boss bar, telegraphs, ?boss=1 |
| W2 G1 Garden + weather | ✅ merged + wired | concealment, deterministic weather + day/night; `de82d72` |
| W2 S1 Ordnance kiosk/cores/kibble/mission | ✅ merged + wired | 27 interact tests; 20/20 kibble + 4/4 cores hop-validated; 0.022 ms/tick; artifacts/s1-*.png |
| W3 C2 abilities + bot play | ✅ merged + wired | 29 new tests; bots use every ability 2–11×/90 s; bot-only Squeaker run done ~285 s; `8c4e174` |
| W3 P1/P2 perf | ✅ merged + wired | 28-char tick p95 4.47 → 2.75 ms; low tier −42 % draws / −43 % tris; `f3789bf` |
| W3 D3 Rooftops + Garage | ✅ merged | 14 district tests (hop search, cover, nav, collider=visual); +0 prop draws; `ac9eb63` |
| Lead: core-rush mode | ✅ | 4 match tests; bots play pads; soak PASS incl. core-rush; `4ca8b2a` |
| Lead: netcode stalls | ✅ | TCP head-of-line emulation; 150 ms/2 %: max err 4.2 m → 0.78 m, teleports 1 → 0; `808f246` |
| W3 U1 chat/rooms/tips | ✅ merged + wired | 39 new tests; `d110c7a` VERIFY PASS incl. e2e; artifacts/u1-*.png |
| W3 K1 character polish | ✅ merged | silhouette distance 0.033 → 0.122; 24/24 kits in budget; `9d8b11f` |
| W3 lead M1 Ear Glide · M2 buff bits | ✅ | prediction parity 0 cm while gliding; Zoomies+ corrections 1182 → ≤ 2 |
| Deploy prep (not deployed) | ✅ | docs/ops/DEPLOY.md; bundled server runs on an --omit=dev install |
| W4 E1 sniper elite (Madame Pointillé) | ✅ merged + wired | 15 sniper + 6 model/FX tests; marksman duel 151–213 s (sweep 125–242 s), with squad 62–107 s; ?boss=madame_pointille; artifacts/e1-*.png |
| W4 X1 destructibles | ✅ merged + wired | 17 tests (destruct 11, view 5, perf 1); a Dig Charge breaches the Garage wall (walk, nav and prediction open); tuna + crate stacks break; break ≤ 0.3 ms authority / ~0.2 ms client; artifacts/x1/*.png |
| W4 R1 RC plane + Rooftop Hangar | ✅ merged + wired | 25 new tests (flight, crash + eject + stun, no tunnelling, ceiling/box, Skyraider, own-plane gun, PvP, determinism, Rooftops→shed 8.8 s); stun predicted; artifacts/r1-*.png |
| **Wave 1 integration** | ⚠️ corrected | first claim was false (did not boot); fixed + verified in `3d2de26` — see log |
| Q1 verification | ✅ | docs/qa/W1_VERIFICATION.md — 55/100, P0/P1 fixes landed |

## Log
### 2026-09-26 — Wave 4 in flight (lead)
- Lanes A1 (adventure framework, chapters 1–2), X1 (destructibles), R1 (RC plane), E1 (Siamese sniper elite) are
  building against `docs/design/ADVENTURE.md`; A2 (chapters 3–6) and INT4 follow.
- **E1 integrated**: Madame Pointillé, the Dot Artiste, a Siamese sniper elite (second boss): three perches across
  the lawn, a laser dot that must track you 1.1 s before she fires (break line of sight to lose it), a lens that
  glints before each shot (hit it to spoil the shot), hairball lobs at hiders, leaps between perches, phase 2 at
  50 % (beret off, faster dot). Lead: boss bar shows PHASE 1 / PHASE 2 · <label>, `?boss=<id>` offline and online
  (guard + room setup), a DOT ON YOU cue, and five SFX (ping, tink, lost, clonk, pop).
- **X1 integrated**: the Garage's east wall has a boarded breach (a Dig Charge planted there blows it 2.5 s later;
  explosions only), 4 tuna-can stacks inside and 3 crate stacks in the yard (shots and blasts). Breaks open nav cells
  in place and drop the predictor's mirrored colliders; everything stands again on a match restart. Lead: system
  registration, prediction mirror, view/FX wiring; net-bandwidth now counts players only.
- **R1 integrated**: the RC plane ("Fetch Flyer" / "Pounce Plane") and one neutral Rooftop Hangar on the garage roof,
  in every PvP and co-op mode. Mouse-aim flight, squeaky gun, crashes explode and throw the pilot out stunned. Lead
  edits: camera pitch follow, pilot tilt, the hangar's E prompt ("launch a plane", "bail out" in the air), and the
  new `EFlag.Stunned` contract bit, which the predictor honors (48 → ≤ 3 corrections through a stun).
- Lead quality loop meanwhile, each commit verified in isolation with e2e:
  - blob shadows on the low tier (`4724e38`);
  - outline ink capped beyond 8 m (`59d357d`);
  - a voice per class ability (`f2237ae`);
  - B = taunt, where bots taunt too on some kills (`17cc1c9`);
  - the kill cam faces your killer while you wait to respawn (`62a41ba`);
  - adventure rooms list their chapter in the room browser (`0859476`);
  - an e2e for the menu's MATCH selector (`74c2fb2`);
  - the README and playtest script were rewritten.
### 2026-09-26 — Wave 3 complete (lead)
- **All lanes merged**; every integration commit verified in isolation including e2e (`npm run verify -- --e2e`).
  Soak PASS across skirmish, TDM and core-rush (0 errors, tick p95 ≤ 1.4 ms).
- **C2**: Spotter Drone / Dig Charge / Squeak Barrier (authoritative, deterministic); bots use every class ability,
  hunt spotted enemies, run the Squeaker mission with no human, take cores, play core-rush pads. Lead: ability
  entities got their own `EntityKind.Ability` (as Props they could read as S1's beacon), `Sim.peekEvents()`, the
  predictor mirrors barriers, a SPOTTED cue.
- **P1/P2**: analytic terrain fast path for grounded capsule moves (tick p95 within the 3 ms budget); low tier
  finally cheaper, mostly live-switchable. **Integration catch:** the fast path also took the ball-shaped Vac-Tank
  (read as a capsule): the boss sank and bots never beat it (0/4 seeds). Capsule-only now, with a regression test;
  both lanes had blamed that failing test on each other's work in progress.
- **D3**: the Garage (Breacher CQB, 3 entrances) and the Rooftops (3 perches, 2 climb routes, one-way hatch); two
  Golden Kibble added up there (22); district name toasts.
- **K1**: class silhouettes readable at 35 m, attitude faces (glare, snarl, grit, smug kill grin), smoother faces.
- **Lead**: core-rush mode + MATCH selector in the menu; netcode freeze + catch-up for late inputs (TCP stall
  emulation exposed the authority improvising on held inputs); per-frame allocation cleanup; deploy prep.
- Open for a human: the queue test (`docs/qa/PLAYTEST_SCRIPT.md`), TDM balance with bots helping the player side
  (corgis won 4/4 bot-stand-in runs), the Overwatch beacon as a long-range tell.
### 2026-09-26 — Wave 3 in flight (lead)
- Plan: `docs/sprints/WAVE3_PLAN.md` (validated, no path collisions). Lanes C2, P, D3, U1 dispatched; K1 after U1.
- **M1 Ear Glide** (Skyraider): Q in the air caps the fall at 2.5 m/s for 4 s (6 s cooldown); Q again, crouch or
  landing ends it. In the shared `stepCharacter`, so prediction replays it exactly (test: 0 cm error, identical
  Gliding flag over 3 glides). Airplane-ear pose (`artifacts/m1-glide.png`), whoosh audio.
- **M2 buff bits**: `EFlag.Buff*` mirror running Upgrade Cores into snapshots. The predictor applies Zoomies+ from
  the flag (corrections 1182 → ≤ 2 per 20 s buff); buff chips follow the flags (late joiners see them); the Q ring
  and the glide cooldown honour Squeaky Clean.
- **U1 merged**: chat (input suspended while typing, echo-confirmed lines, sender team on the wire), `/rooms` +
  menu room browser (unlisted `_rooms`), three first-match tips, quality "applies after reload" notice.
- **Deploy prep**: Dockerfile + DigitalOcean App spec + `npm run build:server` (Vite SSR bundle, plain node at
  runtime). Owner steps and costs in `docs/ops/DEPLOY.md`. Nothing deployed.
- Process: `verify` now gates every push on its exit code (a piped `tail` hid a FAIL once — the failure was a
  load-sensitive 3 s wait in net tests, fixed); human playtest script `docs/qa/PLAYTEST_SCRIPT.md`.
### 2026-09-26 — QA quick fixes + S1 integrated (lead)
- QA W1 quick fixes (`4eaeab8`, VERIFY PASS): skirmish waves 1–2 trickle in (per-wave `maxAlive` 2/4); TDM 4v4;
  aim zoom λ26; class icons on nameplates; `/stats?reset=1` local/token only; ground-pound crouch buffered and the
  jump buffer honours its full 120 ms (tests fail without each fix); skirmish cats read their own objective; the
  scoreboard counts wave cats instead of "No one here yet".
- Difficulty (bot stand-in, `tools/qa-difficulty.mjs`, seeds 1–2): offline skirmish first death **46–65 s** (was
  14–42 s), won both seeds at K/D 21/15 and 27/15; AFK player: the squad reaches the final wave. TDM 4v4 splits 1:1.
- S1 wired: kiosks, cores, kibble and the Squeaker mission in game (`artifacts/s1-ingame.png`, 0 errors). Mission
  points join the team score; the step rides `MatchState.objective` (the banner drops it — the mission card shows
  it). Class and team switches have separate 1 s limiters (the menu sends both in one tick).
### 2026-09-26 — Correction + QA W1 fixes (lead)
- **Correction:** the "Wave 1 integrated … full gate green" commit (`484a2e2`) did **not** boot. The gate ran green,
  then `git add -A` swept in the Garden lane's in-flight world files (24 missing palette keys). Caught by the
  independent verifier (`docs/qa/W1_VERIFICATION.md`, scorecard 55/100). Process fix: explicit-path staging +
  `npm run verify` on the committed tree (`tools/verify-commit.mjs`).
- Fixed from the verifier's list (commit `3d2de26`, VERIFY PASS): camera wall clipping + crosshair truth (exact
  pivot), offline match starts on PLAY, server skirmish bots 3,0, HUD truth (Q ring, respawn, wave timer), slide
  faster than sprint, movement velocity projection, quantization skin deadlock (flat-ground freeze), per-IP room
  cap, softened bot damage/aim, no shipped source maps.
- Pending in the S1 integration: input-credit speed-exploit fix and class/team switch no longer a free heal
  (both in `src/host/room.ts`, which S1 is also editing).
- Still open: full-room tick p95 3.7 ms vs 3 ms budget (28 characters) · difficulty needs a human verdict (stand-in
  bot: ~3 deaths/min after tuning, first death 19–42 s) · class readability beyond 30 m is hat-only.

### 2026-09-26 — Wave 1 integrated (lead)
- L2 merged (trimesh terrain collider: heightfield leaked 24.5 % of grid-aligned rays and cost 3×); nav uses
  `isTerrainCollider`; world quality from saved settings / `?quality=`, time of day from `?t=`.
- L4 merged: prediction exact (quantized parity), delta snapshots 14 KB/s @ 12 players, multi-room hardened server,
  prod server (`npm run start`), reconnect UI, `serverUrlForPage()`; frame dt cap 0.25 s.
- E2E moved to a `vite preview` production build (dev-server HMR reloads broke tests while agents edit files);
  smoke tests wait on game state at `quality=low` (SwiftShader renders the full yard at ~1 fps headless).
- Proof: `npm run gate` → GATE PASS (typecheck, boundaries, unit, build, e2e 4/4).
- **How to play now:** `npm install && npm run dev` → http://localhost:5173 (offline, main menu) ·
  online: `npm run start` → http://localhost:8787 (one port, share the URL on your LAN) or `npm run server` +
  `?server=ws://localhost:8787`.

### 2026-09-26 — Wave 1 lanes landing (lead)
- L5 wired into `main.ts`: game events → FX (shake/hit-stop), audio, HUD, avatar triggers; nameplates; persisted
  settings apply to input/audio/FX; main menu unless `?autoplay`/`?server`.
- L1 merged; fixed `glow()` (three r186 renders `vec3(Color)` black → uniform).
- L3 merged; camera now uses the authority's `AIM_RAY` so the crosshair ray matches server hitscan; offline skirmish
  defaults to a 3-bot corgi squad (cats come from waves), TDM 4v5.
- Movement: slide (crouch while sprinting) and ground pound (crouch in air) in the shared `stepCharacter`.
- Contracts (additive): EntityKind Boss/Terminal, EFlag Mounted/Busy, `cls` = content index for non-characters.
- Proof: full-tree `gate:fast` PASS (145 unit tests); probe `artifacts/int-l5.png` shows West Yard + new corgi + comic
  HUD + wave 1 of skirmish, 0 errors.

### 2026-09-26 — Wave 0 foundation (lead)
- Pivot from Unreal to Three.js; legacy docs archived in `docs/legacy/`. Direction: adventure-first,
  multiplayer-first architecture (authority in Worker offline / Node online).
- Walking skeleton: shared protocol + input + types; Rapier KCC movement (run/sprint/walk, buffer, coyote,
  double jump, variable height); Room with input queues, snapshots, bot fill; worker host; Node ws server;
  client with WebGPU renderer + toon comic pipeline, interpolation, third-person camera, placeholder avatars, HUD.
- Proof: `npm run gate` → GATE PASS (typecheck, boundaries, 4 unit, build, 2 e2e). Screenshot `artifacts/smoke.png`
  shows the toon-shaded corgi placeholder, ink outlines, crates and a cat bot.
- Next: Wave 1 lanes in parallel (see MASTER_PLAN §10).

## Known issues
- Rapier KCC on the heightfield was ~0.13 ms/character/tick. The P1 terrain fast path (grounded capsules only) brought
  28 characters to tick p95 1.72 ms, max 3.16 ms; airborne and structure moves still pay the full KCC (L3, P1).
- Straight-down raycasts on the heightfield slip through at grid lines ~23 %: use `WorldData.height()` (L3).
- Firefight snapshot bandwidth 30.6 KB/s after delta encoding (was 64 KB/s) — inside budget (L4).
- Combat knockback is not predicted → occasional smoothed corrections > 0.5 m in live soaks (L4).
- Offline play downloads Rapier twice (worker + prediction chunk), ~3.75 MB gz total (L4).
- Client world build blocks the main thread ~1.3 s at load (L2).
- Bots treat decks/roofs as obstacles; Warden bots weak in the open (L3).
- Proposed contract additions (L3): archetype on EntityState, weapon on `death`, `MatchState.enemiesLeft`.
- `EntityState.cls` carries content indexes through `CLASS_IDS`: 6 entries per content table at most (S1, B1).
- Bots don't climb to the Rooftops perches (they fight in the Garage fine) (D3/C2).
- Ability entities: shotgun damage to drones/barriers is estimated from the first pellet (C2).
- Sniper elite (E1): perches are hard-coded West Yard spots (tests catch lost sightlines, not looks); L3 bots don't
  dodge the dot; a human must confirm the 2–4 minute duel target.
- Destructibles (X1): bots don't breach on their own yet (A2); kart rams don't break stacks (kart wrecks do); a match
  reset relabels nav regions once (~5–9 ms).
- RC plane (R1):
  - there is no engine sound yet (the cockpit strip `ui/plane-hud.ts` shows hull, throttle, airspeed, height, boost,
    gun heat and STALL!);
  - planes are interpolated, not predicted (mouse-aim hides most of the latency);
  - direct tennis-ball and frisbee hits do no plane damage (blasts do);
  - planes pass through characters;
  - bots don't fly;
  - an empty plane after a bail-out is a guided bomb (intended; watch it in balance).
- Fixed since first logged:
  - upgrade-core buffs now ride in snapshots as `EFlag` buff bits, so late joiners see them and Zoomies+ no longer
    causes corrections (M2);
  - the low tier has blob shadows (`4724e38`);
  - faces are smoother, with attitude expressions (K1).
  - your team's shots, and your bots' sight lines, now pass through your own Squeak Barriers and drones; they still
    stop the other team's shots (lead).

## Human verdicts
_(none yet — first human session after Wave 1 integration)_

## Ideas (not in scope yet)
- Corgi "zoomies" leaves a dust trail that briefly slows pursuing cats.
- Sprinkler weather event that knocks cats off the lawn.
