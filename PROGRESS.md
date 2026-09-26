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
| W5 N1 bots climb (nav links) | ✅ merged | 12 tests; perch from base 21–25 s (4 seeds, < 60); 14/15 links valid × 6 profiles, every leg replayed in a real Sim; misses → retry → other route → ground (stuck ≤ 1.5 s); 28-char tick p95 1.43 ms; soak PASS 5 modes (stuck max 1 s, p95 ≤ 1.26 ms) |
| Q2 Wave 4 verification | ✅ | docs/qa/W4_VERIFICATION.md at `a5177fd`: 76/100 (R 82 · I 70 · F 74), gate PASS; P1-1 fixed `ad28d0f`; P2-2 … P2-9 fixed (lead); P2-1 is a design question for a human |
| W4 A2 adventure chapters 3–6 | ✅ merged + wired | 24 new tests; bot-only squads, 6 seeds, all complete inside par, deterministic: ch3 42–63 s / 120, ch4 87–97 s / 180, ch5 74–79 s / 160, ch6 165–186 s / 360; runner ≤ 0.027 ms/tick; artifacts/a2-*.png |
| W4 S2 vehicle + world audio | ✅ merged | 19 new audio tests; kart putt-putt + plane prop loops (≤ 4, nearest first, 0 allocs/update), vehicle and break voices, adventure step jingle + chapter fanfare; nothing clips (peak 0.825), engines 5–6.6 dB under a shot |
| W4 A1 adventure framework + ch1–2 | ✅ merged + wired | 32 tests; ch1 bots 52 s (first objective 19 s), ch2 bots 80 s, deterministic; runner ~0.03 ms/tick; artifacts/a1-*.png |
| W4 E1 sniper elite (Madame Pointillé) | ✅ merged + wired | 15 sniper + 6 model/FX tests; marksman duel 151–213 s (sweep 125–242 s), with squad 62–107 s; ?boss=madame_pointille; artifacts/e1-*.png |
| W4 X1 destructibles | ✅ merged + wired | 17 tests (destruct 11, view 5, perf 1); a Dig Charge breaches the Garage wall (walk, nav and prediction open); tuna + crate stacks break; break ≤ 0.3 ms authority / ~0.2 ms client; artifacts/x1/*.png |
| W4 R1 RC plane + Rooftop Hangar | ✅ merged + wired | 25 new tests (flight, crash + eject + stun, no tunnelling, ceiling/box, Skyraider, own-plane gun, PvP, determinism, Rooftops→shed 8.8 s); stun predicted; artifacts/r1-*.png |
| **Wave 1 integration** | ⚠️ corrected | first claim was false (did not boot); fixed + verified in `3d2de26` — see log |
| Q1 verification | ✅ | docs/qa/W1_VERIFICATION.md — 55/100, P0/P1 fixes landed |

## Log
### 2026-09-26 — Wave 4 in flight (lead)
- Lanes A1 (adventure framework, chapters 1–2), X1 (destructibles), R1 (RC plane), E1 (Siamese sniper elite) are
  building against `docs/design/ADVENTURE.md`; A2 (chapters 3–6) and INT4 follow.
- **A2 integrated**: all six chapters of "The Last Tennis Ball" are playable.
  - Ch3 **The Garage Job** (Breacher): blow the boarded wall (explosives only), wreck the 4 tuna stacks, then kart out
    to the gate.
  - Ch4 **Laser Pointer at Dawn** (Overwatch): the roof perch (feet really on the roof), the Madame Pointillé duel,
    then survive 40 s.
  - Ch5 **The Porch Siege** (Warden): raise the porch barricades (650 hp barrier walls), then hold and survive
    3 waves.
  - Ch6 **The Last Tennis Ball** (Skyraider): Ear Glide off the garage roof, fly the RC plane over the shed, beat the
    Vac-Tank, grab the ball.
  - Bots:
    - they shoot a destroy step's props;
    - Breachers plant where the breach fuse fires (the breach step went from 32 s to 2.7 s);
    - sentries walk their posts;
    - pups carry the chapter's kits.
  - After 120 s on one step, the human-only rules relax, so a player without the kit is never stuck.
  - Lead: the scoreboard shows a pup's chapter kit.
- **S2 integrated** (sound): the game had no vehicle audio at all. Now there is a mower-kart putt-putt and a buzzy
  toy-plane prop (throttle, airspeed, boost roar, stall cough, doppler on fly-bys), a seat clunk, bail, boost
  fwoosh, a kart horn, three distinct breaks (wood crash, tin clatter, crate crunch), a step jingle and a chapter
  fanfare. Riders no longer make footsteps. Levels were measured offline in Chromium (nothing clips; engines sit under
  combat and never mask footsteps).
- **A1 integrated**: ADVENTURE in the MATCH selector with a chapter picker. Chapter 1 "Yard Day" (Assault) and chapter 2
  "The Tall Grass" (Infiltrator, stealth with sentry cones and an alarm) run on chapter data: reach, interact, hold,
  collect, defeat, destroy and survive steps; checkpoints with fail forward; intro/outro panels; a chapter card with
  time vs par and a paw medal. Bots finish both chapters alone; with a human, the human completes reach and interact
  steps. Lead: systems registered (+ the X1 checkpoint hook, so a wipe stands later-broken props back up), the adventure
  HUD/views in main.ts, the corgi-team rule, bot damage ×0.42 like the skirmish, STEP instead of WAVE, no win banner or
  scoreboard over the chapter card, and a respawn-facing fix in Room.
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
- INT4 lead loop after the lanes landed, each commit verified in isolation:
  - soak of all five modes on the integrated HEAD: 0 errors, 0 stuck, tick p95 0.94–1.79 ms. The ~90 ms tick max is
    identical before Wave 4 (A/B against `62a41ba`: 90/87 vs 92/88 ms), so it is a startup artifact, not a regression.
    Boss-rush and adventure now report completion instead of failing on it (`9e7d144`).
  - spawn facing held until the first snapshot (`3117ad1`);
  - karts ram destructible stacks (`7891c87`); frisbees hit karts, planes and stacks directly (`4dd5190`); the plane
    rams pets (`64d2684`);
  - an e2e for ADVENTURE → chapter 2 from the menu (`90e7f93`); the controls list and menu footer (`626fde5`);
  - a plane lift-off whoosh (`9fb5410`); no duplicate WAVE chip (`4bdfcb7`); kart/plane kill-feed glyphs (`2abe2c5`).
  - Budgets after Wave 4 (§8.7), measured at the free-mode spawn view with `tools/perf-render.mjs`, A/B against
    `62a41ba`:

    | | Before Wave 4 | After | Budget |
    |---|---|---|---|
    | High: draws | 121 | 125 | 400 |
    | High: triangles | 1.19 M | 1.29 M | 1.5 M |
    | Low: draws | 71 | 74 | |
    | Low: triangles | 680 k | 733 k | |

    Initial download: 4.02 MB gzipped offline, 2.99 MB Brotli (budget 5 MB); online skips the worker chunk, about
    2.3 MB gzipped.
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
- Warden bots weak in the open (L3); the corgi porch deck and the shed roof have no nav links yet (no goal needs them)
  (N1).
- Proposed contract additions (L3): archetype on EntityState, weapon on `death`, `MatchState.enemiesLeft`.
- `EntityState.cls` carries content indexes through `CLASS_IDS`: 6 entries per content table at most (S1, B1).
- Bots climb to The Rooftops (N1): Overwatch room bots hold perches in TDM and yard-skirmish. Link validation costs
  45–100 ms once per movement profile, on first need (a start-of-match hitch, not in p95).
- Ability entities: shotgun damage to drones/barriers is estimated from the first pellet (C2).
- Adventure (A1/A2):
  - bots shoot adventure props and breach with Dig Charges. They climb when a goal sets a roof height (N1), but the
    ch4/ch6 roof steps still waive `minY` for bot-only squads until the tactics snippet in `docs/handoff/N1.md` §4.1
    lands. They don't drive or fly yet (B2). Humans get a 120 s grace;
  - ch6 step 1 needs a Skyraider. Joining a listed adventure room now takes the chapter's kit (`096be58`); a joiner
    who types the room name by hand keeps their kit and waits out the grace.
  - ch5's difficulty for humans is unknown. Bot squads do wipe on its last wave: 3 of 12 seeds on the first try
    (`qa-adventure.mjs bots --chapters porch_siege`), gold every time;
  - one adventure chapter per page on the client; picker locks are cosmetic; sentry cones draw through walls
    (intended readability).
- Sniper elite (E1): perches are hard-coded West Yard spots (tests catch lost sightlines, not looks); L3 bots don't
  dodge the dot; a human must confirm the 2–4 minute duel target.
- Destructibles (X1): outside adventure destroy steps bots ignore props; a match reset relabels nav regions once
  (~5–9 ms).
- RC plane (R1):
  - the cockpit strip `ui/plane-hud.ts` shows hull, throttle, airspeed, height, boost, gun heat and STALL!; engines
    are voiced by S2;
  - planes are interpolated, not predicted (mouse-aim hides most of the latency);
  - bots don't fly;
  - an empty plane after a bail-out is a guided bomb (intended; watch it in balance).
- Fixed since first logged:
  - upgrade-core buffs now ride in snapshots as `EFlag` buff bits, so late joiners see them and Zoomies+ no longer
    causes corrections (M2);
  - the low tier has blob shadows (`4724e38`);
  - faces are smoother, with attitude expressions (K1).
  - your team's shots, and your bots' sight lines, now pass through your own Squeak Barriers and drones; they still
    stop the other team's shots (lead).
  - a kart rammed hard into a tuna or crate stack flattens it (the breach wall stays explosions-only) (lead);
  - direct frisbee hits now damage enemy karts, planes and destructible stacks (lead);
  - an RC plane flying into a pet rams it (enemies take 48 at cruise, 73 in a boosted dive; teammates get a nudge),
    and the plane slows and takes a knock (lead);
  - spawn facing: the client holds inputs until its entity is in a snapshot, so a fresh spawn keeps the sim's facing
    in every mode (lead; found by A1).
  - Q2's Wave 4 polish (lead; `docs/qa/W4_VERIFICATION.md` §P2):
    - adaptive resolution steps before the frame renders, so a resize can't present a blank frame (P2-9);
    - the objective line puts its "(n/N)" first; the scoreboard header drops "0:00" when untimed and says STEP in an
      adventure; the plane's height is measured to the roof under it and reads 0 on its wheels (P2-7);
    - the menu hint and control labels are shorter, so the cards clear the footer and it fits one row at 1280×720;
      in adventure the room browser says "‹ CHAPTERS" and "Joining as <featured kit> · CORGIS" (P2-7);
    - rooms list a chapter by its real title on its own line, and a room always lists the chapter it really runs
      (an unknown or missing id → Yard Day, as the sim plays it); boss ids must be known bosses (P2-3);
    - first-match tips wait while HIDDEN / SPOTTED / DOT ON YOU or the plane strip is up; the Tab scoreboard sits
      above the mission card and the adventure intro, the main menu above both (P2-4);
    - the finale's card is THE END with MAIN MENU (ENTER) and REPLAY; an online room goes back to chapter 1 after the
      finale instead of replaying it (P2-6).
    - a checkpoint restart puts the squad back where it stood when the step began, never two on one spot, and the
      checkpoint's cats hold still for a 2 s regroup beat. The cause: a restart bunched the Porch Siege squad on the
      hold anchor, behind the porch, and the respawned brains start without targets. Forced wipes at the last wave now
      re-wipe in 1 of 15 seeds (2 later wipes); before, 3 of 15 (13 later wipes, one seed looping 8 times) (P2-2);
    - the soak runs adventure bot-only with a real 4-pup squad, so chapter 1 completes in it, and reports snapshot
      bandwidth at wire size (the delta encoder), with the raw JSON beside it (P2-8);
    - a live high-tier TDM went from 1.50 M to 1.38 M triangles per frame (276 → 254 draws; `perf-render.mjs --query
      '&mode=team-deathmatch'`). The garden's tall grass was one yard-wide InstancedMesh, culled as one sphere: it drew
      137 k triangles for 23 tufts in view. It is now drawn per concealment zone. Kibble went from 1 132 to 692
      triangles a piece (P2-5).

## Human verdicts
_(none yet — first human session after Wave 1 integration)_

## Ideas (not in scope yet)
- Corgi "zoomies" leaves a dust trail that briefly slows pursuing cats.
- Sprinkler weather event that knocks cats off the lawn.
