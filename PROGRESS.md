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
| W5 B2 bots drive + fly (B2a karts, B2b RC plane) | ✅ merged + wired | 18 tests (12 + 6 through the brain hook); TDM: kart rides every match (both teams), ram hits every match, kart stuck ≤ 0.5 s; kart beats walking 60 m 5/5; ch3 getaway driven bot-only (12.7 s); plane flown 4/4 TDM seeds, 5/5 take-offs no crash; ch6 bot-only 214.9 s with glide/plane/flyover met for real; 28-char tick p95 2.33 ms; soak PASS (stuck max 1.5 s, p95 ≤ 1.40 ms) |
| W5 N1 bots climb (nav links) | ✅ merged | 12 tests; perch from base 21–25 s (4 seeds, < 60); 14/15 links valid × 6 profiles, every leg replayed in a real Sim; misses → retry → other route → ground (stuck ≤ 1.5 s); 28-char tick p95 1.43 ms; soak PASS 5 modes (stuck max 1 s, p95 ≤ 1.26 ms) |
| **W10 A7 chapter 7 "Night Shift at The Lot" (adventure-2)** | ✅ merged | The first chapter on The Lot (map: the_lot, dusk pinned), unlocked after chapter 6: slip through the Pipeworks (3 sentries; the pipes hide you; the Infiltrator's cloak crosses the open ground) → pull the floodlight tower's siren fuse (E, stealth) → grab the tennis-ball stash (collect 4) → hold the scaffold 40 s (the rain usually starts here) → drive the stash home to the pit in the cats' kart. Par 4:00.<br>Bot squads 5/5 gold (122–146 s); a scripted player 127 / 132 s gold; stealth: a blind sprint is spotted 6/8, the two-cloak route unseen 7/8; a wipe in every step restarts at its checkpoint and still finishes. The runner plays only its sim's map's chapters (online rooms advance along their map); the West Yard chapters are bit-identical (12/12 gold). Gold paw: the corgis' Night Shift taunt pack. Lead: the adventure QA tool builds each chapter's map; the online card names what the room really loads next. 19 new tests. docs/handoff/A7.md |
| **W10 U3 match awards + kill feed + Base Assault tips (ux-3)** | ✅ merged | A post-match awards card: 3–5 of 13 comic awards (BEST IN SHOW, GUARD DOG, captures, longest carry, grenade kills, streaks, comebacks…), the local player's own in gold; ties shared by up to 3; computed from events + roster + match state only (Base Assault returns / pad credits derived from the roster score when the whole match was seen). The card sits between the win banner and the scoreboard. The kill feed shows the grenade / hairball glyph (C10 `wpn`), unchanged without it. Four once-only Base Assault tips. 35 new tests + 22 mutants caught. docs/handoff/U3.md |
| **W10 AU2 the sound of the new war (audio-2)** | ✅ merged | **Base Assault:** the ball squeaks where it changes hands (steal / drop / return / capture), a field-bugle call per event (ours vs theirs), a capture fanfare, and a heartbeat + rising pulse while a ball is on the move. **Throwables:** the fuse tick was ~23 dB under a storm firefight in its band; for the threatened player it now plays louder, gets a 4.6–5.6 kHz partial, its own top-priority voice category, and ducks rain/ambience up to 11 dB: every tick in the last 1.2 s ≥ +4 dB over the mix (median +9 to +13). **The Lot:** rain on steel and tarps, drips, the crane creak, floodlight hum, the ditch, far site noise, from world data, weather- and position-driven; the West Yard's output identical to 1e-9. 75 tests (an offline Web Audio renderer cross-checked in Chromium). **Watch:** storm ambience cost on a real machine; judged by measurement, a human should listen. docs/handoff/AU2.md |
| **W10 P5 look calls with data (look-4)** | ✅ merged | Exposure follows the time of day (1 at dusk, night and storm; 0.78 from 16° of sun up): all 10 noon / match-start views within +3 % of pre-P4 (HEAD was +15 to +34 %). The sky fill stays out of The Lot's 10 interior boxes (8 pipe bores, 2 containers): pipe mouth 43.6 → 23.6, container 43.8 → 16.4 luma at dusk; no new light, pass or draw. Storm overview from 114 m: fog thinned for high cameras, contrast 18.8 → 23.5. Team read, draw calls and triangles unchanged; 12 unit tests. Watch: the tunnels are near-black inside (Q5 / a real monitor), rain still falls inside them. `docs/handoff/P5.md` |
| **W10 Q5 independent verification (qa-5)** | ✅ 75 / 100 (R 85 · I 75 · F 60), gate PASS, no P0 | Chapter 7 gold on 8 / 8 new seeds, and checkpoints recover. The awards match an authority-side oracle on every counter. The audio never clips at the output. P5's numbers reproduce within 2 luma. Soak PASS on both maps. **P1-1:** the West Yard's corgi side wins Base Assault again (23 of 30 decided, seeds 1–40; 11 of 27 before, p = 0.008). N3's pilot and thin-beam nav are the suspects → F3. P2s: the ch7 sentry cone is drawn 14 m against a 45 m sight; pets in tunnels are black silhouettes (team hue 3 % → 0.1 %); container rain hits the limiter at +6 dBFS; a residual heap-ramp hop (7–9 s); two mirrored West Yard pins; same-tick Base Assault endings. `docs/qa/W10_VERIFICATION.md` |
| **W11 P-GLB1 shared-GLB pipeline slice (pipeline-1)** | ✅ merged (behind `?kit=glb`) | The first asset through the owner's pipeline. `Kit_Lot_Container20_01` is built by a bpy script (Blender 5.0.1 headless, deterministic): metres, pivot at the base centre, LOD0/1/2 612 / 252 / 122 tris, 13 `COL_` boxes, Cycles-baked 1024² baseColor / ORM / normal. `validate-glb.mjs` passes the master (2.35 MB) and the web variant (246 KB, meshopt + WebP) and fails a broken copy with 30 errors. Godot 4.7.2 headless import + runtime: PASS on the master; Godot rejects the web variant (meshopt / quantization), so Godot imports the master. In game, the GLB is drawn instanced with LODs; `COL_` equals the sim's colliders within 1 cm (test). Lot 4v4 high: 236 draws with `pbr()` vs 230 off. Look: more detailed than the procedural box, but soft up close (22 px/m) with a too-saturated tint: not yet the owner's reference look. `docs/handoff/P-GLB1.md` |
| **W11 P-GLB1b container look pass + the bag wall (pipeline-1b)** | ✅ merged (behind `?kit=glb`) | Container v2: a paint mask in baseColor alpha (only paint takes the per-instance tint); rust as edge wear and run-off streaks; a world-space detail layer in `pbr()` (dents, grain, scratches: the non-destructive Stage 6 layer); wet darkening, rivulets and puddles in rain; `STYLE.pbr` shade knobs (shaded wall luma 18 → 30, toon 27). Second kit piece `Kit_Lot_BagWall_01` (8 on the map, the canyon foreground), picked from the data: LOD 1760 / 400 / 96, collider test. Validator, Godot 4.7.2 and determinism PASS on both; Lot 4v4 high +2.2 % draws, −2 % triangles. Honest gap to the mood board: the saturated blue palette colour, flat grey ground (not wet asphalt), no floodlight glints, sandbags read soft. `docs/handoff/P-GLB1b.md` |
| **W11 F3 Q5 fixes (fix-3)** | ✅ merged | **P1-1:** the West Yard Base Assault lean came from both halves of N3 together: each alone was not significant (pilot 55 %, thin-beam nav 62 %), together 77 %. Base Assault on the West Yard now paths without the thin pass (`thinPassFor`), the pilot stays → corgis 18 : 15 (55 %, p = 0.31 against pre-W10); mirror 6 : 6; The Lot identical. Cost in that mode: worst hedgehog pin 2.5 s. **P2-1:** chapter 7's sentries draw their real range (a dashed far arc at sight × weather, 45 m clear / 27 m storm); a test ties the drawn radius to detection; still gold on 4 seeds. **P2-6:** a soft ceiling on the container-rain voice and a combat duck at full depth by intensity 0.35: the peak into the limiter goes from +6.1 to −6.4 dBFS; the fuse tick keeps its headroom; West Yard audio bit-identical. `docs/handoff/F3.md` |
| **W11 lead: pets readable inside interiors (Q5 P2-2)** | ✅ merged | The cause: at short range a pet's main light is the sky fill, which P5 shut out of tunnels for characters too. The P4 rim barely acts under 8 m, so `charKeep` alone moved nothing (0.25 → 1: corgi luma 24.9 → 27.1). Characters now keep `STYLE.interior.charSky` (1.0) of the sky fill inside; walls stay dark (frame luma unchanged). A Lot pipe at dusk, `tools/qa5-look.mjs --sets pets`: corgi 24.9 → 36.6 luma, team hue 0.1 → 2.6 % (outdoor-equivalent 2.9 %); cat 22.0 → 27.3, 0.1 → 1.1 %. Storm: corgi team hue 0.1 → 2.1 %. `artifacts/w11-ab/tunnel-pets-before-after.png` |
| **W11 P-GLB3 Lot kit batch 1 (pipeline-3)** | ✅ merged (behind `?kit=glb`) | Four more pieces through the pipeline: the Pipeworks pipe (12-sided concrete; its bore fits P5's interior box tightly on every side), the footing (the most repeated remaining prop), and the floodlight tower as mast + lamp housing (each tower pitches its housings differently, so one rigid GLB could not match the colliders). Validator PASS on all 12 GLBs; Godot 4.7.2 PASS on all 6 masters; 24 files rebuild byte-identical; 28 collider / interior tests. Lot 4v4 high: +4.5 % draws, −1.7 % triangles (batch 1 draws LOD0 only). Honest look: the sodium tower heads read at night; the pipes turn blue under the sky fill; the GLB tunnel is 11 % darker. `docs/handoff/P-GLB3.md` |
| **W11 P-GLB4 batched distance LODs (pipeline-4)** | ✅ merged (behind `?kit=glb`) | The six Lot kit pieces draw real LOD0/1/2 by distance with hysteresis: one static batch per piece (every LOD of every placement, baked in world space; an instance switches LOD by rewriting its index range) plus one shared shadow-only caster. Lot 4v4 high, 3 runs each: flag off 227.7 draws; batch 1 +5.4 %; now +0.3 %; triangles 548–554 k (batch 1 LOD0-only: 563 k). 17 tests (switch edges, no flicker over 400 frames of jitter, exact baking against the web GLBs); the procedural fallback also no longer throws on a failed fetch. Open: the toon side's wear noise now runs in world metres; the sun's shadow camera carries its own layer mask while the flag is on. `docs/handoff/P-GLB4.md` |
| **W12 GODOT-BOOT + G-WORLD: The Lot in Godot** | ✅ merged | `npm run godot` opens the Godot 4 project (`engines/godot/`). The Lot is built from the same data as the sim: `tools/godot/export-lot.mjs` writes `data/the_lot.json` + `the_lot_heights.bin` from `buildTheLot(1)` and the web's own kit split, with a drift test. The six kit GLBs are loaded at runtime from `assets/masters` (no copies) as one MultiMesh per piece plus a shared shadow mesh. Terrain height matches the sim within 1e-5 m; the most-rotated box collider matches within 1 mm; the nav mesh has 6,175 polys and all 32 spawns path to the slab (centre (0, −0.06, 0), 8 × 8 m, point-symmetric). Build 954 ms. Draws: overview 131 with the kit vs 118 without. Godot picks LOD per MultiMesh, not per instance. `docs/handoff/G-WORLD.md` |
| **W12 LOOP (G-GAME): the match in Godot** | ✅ merged | On The Lot you can move (WASD / stick, no auto-walk), look (mouse / stick), jump and sprint. One rifle: hitscan from the camera, muzzle flash, hit marker, reload. Death and respawn. A NavigationAgent bot (1v1, or 2v2 with F2). Holding the slab alone scores 1/s; first to 60 or the most at 3:00. HUD: score, timer, slab state, feed, HP, ammo. Winner screen with R / Start to rematch. PLACEHOLDER pets by species (corgi: long, low, upright ears; cat: slim, pointed ears, tail), team-coloured, mouths closed. 5 headless tests (move / stop, rifle vs cover, slab held vs contested, rematch reset, 60 s 2v2 soak). Scripted physics tick 0.86 ms avg / 1.44 ms p95 under load. Open: no step-up (ledges up to 0.7 m need a jump); the soak leans Cat (6–31: the Corgi route climbs out of a ditch); species read at 30 m is weak in the dark; no audio or animation. The lead's test runner now fails on parse errors, script errors and hangs. `docs/handoff/G-GAME.md` |
| **W12 LOOK-GODOT (G-LOOK): a wet night on The Lot** | ✅ merged | Stylised-realistic, no ink: a moonlit overcast sky shader, AgX, glow on emissives only, distance and height fog (on Forward+ also volumetric fog, SSR and SSAO), a muted grade. Sodium SpotLight3D per floodlight (4) with lit lenses; the container tubes and crane beacons as practicals. Wet asphalt on the ground (puddles at roughness 0.05, dry 0.55–0.7, ripples). The kit and prims are wetted in place, keeping their maps, and the kit shader applies the paint mask. `pet_material(coat / plate / metal, species, team)`. Rain; LOW / MEDIUM / HIGH quality. Shots before and after on Compatibility and Forward+ (lavapipe). Draws 103–158 with the look on vs 60–90 off (shadow passes); the terrain stops casting shadows (1.41 M → 0.69 M primitives in the canyon). Open: no hero pets yet; the overview is dark and plain (one terrain material); sandbags read pale; Forward+ cost unmeasured on a real GPU. `docs/handoff/G-LOOK.md` |
| **W12 Q6: independent verification + lead fixes** | ✅ merged | CONDITIONAL PASS on 7bcaa41: with real xdotool input through `npm run godot` a stranger can move, stop, reverse, look, jump, fire, lose to a bot that fights over the slab, read the score and timer, and rematch with R; the tests bite (slab, jump and rematch mutations fail them); wet night with no ink; 257 draws in the play view. Lead fixes: the Cat is a grey tabby with a faint self-lit coat and a brighter team band, so it reads at 30 m at night (it was a black speck); `tests/test_lead_input.gd` checks the real keys, mouse buttons and pad buttons reach their actions (Q6 showed rebinding W still passed every test); the README lists `GODOT=` and the controls; a 1-in-~14 headless flake (parallel GLB reads making textures on the non-thread-safe dummy renderer) is fixed by reading in turn when headless. Open: the human holding the slab on a real GPU, audio, `--demo` placing the human, Compatibility SSR / volumetric warnings, the sky reads dusk and the ground mud, a step-up for ledges, bot balance; every frame time is software raster. `docs/qa/W12_VERIFICATION.md` |
| **W13 TWIN: the web plays the Godot match** | ✅ merged | `npm run twin` (or `?mode=slab`): The Lot with the six shared kit GLBs (no second kit), one rifle, a Cat bot (1v1; `&2v2`), hold the slab alone for 1 point/s, first to 60 or the most at 3:00 (overtime ≤ 60 s, then a draw), winner screen, R or Enter rematch; online rooms accept `slab` (1v1 bots). Authority: `src/sim/match/slab.ts` copies Godot's rules (17 unit tests, mutation-checked). The HUD reads like Godot's hud.gd; the slab frame like slab.gd. The ink and the HARDENED comic look are retired on the web: no outline pass, no crease lines (86 sets, 11,532 segments gone on The Lot; corgi-base view 155 → 146 draws, 273k → 245k triangles), no comic words; materials are the Godot wet-night PBR (`docs/design/LOOK.md`). Lanes TW-SIM, TW-VIEW, TW-LOOK. `docs/handoff/TW-*.md` |
| **W13 READ: corgi vs cat at 30 m** | ⚠️ conditional | Placeholder pets rebuilt for range: corgi long and low with big upright ears and a white bib, cat tall with small ears and a raised S tail, warm tan vs cool grey; one merged mesh per species and team (draws per pet 26 → 7); the plate glow bug (emission ADD) fixed. Independent Q-READ: species readable at 30 m in the play camera (coat colour in every frame; tail and body side on); team is NOT readable on its own (the band is under 10 px and fails in greyscale and red-green colour-blind simulations). Next: team colour on a large part seen head-on. `docs/qa/w13/READ_VERIFICATION.md` |
| **W13 FEEL: the first minute** | ✅ merged | The spawn berm (the Corgi pit wall, 2.2 m at 65°) has a 7 m ramp at about 27° in the shared map data, in the sandbag gap; Godot moves like the web (0.45 m step-up, 52° slopes, wall slide): 8/8 spawn-to-slab routes with no stall. `--demo` puts the player by the slab; `--lineup 30 [--lineup-side]` for the READ shots. Night sky, wet asphalt, tighter sodium pools, no SSR / volumetric-fog warnings on Compatibility (3 → 0). Bots sprint to the slab and both teams start at equal sprint time to it: 1v1 n 40 from 19–21 to 16–24, 2v2 n 60 from 22–38 to 27–33 (Corgi–Cat; neither side over 60 %, 1v1 on the line). Lanes G-MOVE, G-ATMOS, G-BOT. `docs/handoff/G-*.md` |
| **W13 AUDIO: four cues in both builds** | ✅ merged | Rifle shot, hit confirm, own / enemy slab tick, match end win / lose: SYNTH placeholders from `tools/audio/synth-cues.mjs` (deterministic, regenerated byte-identically) in `public/assets/audio/`, played by Godot (`game/sfx.gd`, runtime load, 3D shots) and the web slab mode (`audio/slab-cues.ts`); no music in slab. `--sfx-log` / `?sfxlog` print every cue: `docs/qa/w13/sfx-log-godot.txt`, `sfx-log-web.txt`. Not yet tuned by ear. NEED (once): no SCENARIO_API_KEY / SCENARIO_API_SECRET / XAI_API_KEY and those hosts are blocked, so CHAR and P-GLB2 stay parked; frame times are software-raster only. Lanes A-CUES, A-HOOK |
| **W13 VERIFY (V-PLAY, independent) + follow-ups** | ✅ merged | On a64ce51 (CI run 146 green): `npm run godot` launches (kit 6/6); headless 15/15; W only (no jump) walks out of the Corgi pit by the ramp to the slab edge; 22 `SFX rifle_shot` lines from real left-click fire; the web twin shows The Lot, the plain HUD, no ink or comic words; the slab e2e (winner screen, R and Enter rematch) passes. Standing on the slab with real input: shown only with aids (`--fixed-fps 60` slow motion and a scripted xdotool driver; the Corgi score goes 0 → 1 at 2:59, `docs/qa/w13/play-slab-hud-f015-f016.jpg`); at normal pace on software rendering the bot downs you within 1–2 s. The human step that remains: on a real GPU, `npm run godot -- -- --demo`, stand in the middle of the slab and hold it 1 s. Follow-ups: the web slab line is hidden after the win and the fps line is off in slab (`?debug` brings it back); the dead ink helpers are removed (the look and draws unchanged: 146 draws / 245k triangles). Open: a downed player respawns about 140 m back; the Cat bot contests from the slab corners. `docs/qa/w13/W13_VERIFICATION.md` |
| **W10 N3 open bot items (ai-3)** | ✅ merged | **Thin beams:** the nav grid rasterizes beams, posts and poles (an exact overlap with each cell's body column, 0.08–1.53 m, no inflation), so the West Yard's hedgehogs close all 5–9 of their beam cells (HEAD 1–3): 46 cells on the West Yard, 0 on The Lot, no region split, build +0.7 % CPU. A bot sent through a hedgehog 64 ways: all arrive within 2.5 s (HEAD: 14 over 4 s, worst 12.6 s). Worst hedgehog pin in 30 matches 1 s.<br>**Lane weights** live in `LOT_LANES` (picks bit-identical: digest over 33,792 picks). **A plane pilot in Base Assault** from the attackers after its team's first storm (19 of 20 matches fly; captures 5.00 → 4.85, noise); carriers never board.<br>Lead: the soak gives Yard Skirmish a 150 s window (its 3-wave match ends at 53–141 s across seeds, pooled mean 77–83 s before and after F2's parked karts: chaos, not a regression). 14 new tests. docs/handoff/N3.md |
| **W9 F2 bot fixes (mode-1)** | ✅ merged | Q4's P2-2 … P2-5.<br>• **Parked karts** are nav fixtures (`vehicles/parked.ts`); the AI's cached nav grid now follows fixture changes (a latent bug: fixtures added after tick 1 were invisible); Base Assault kart trips end 14 m short of stands and rings; a pinned bot steps straight off what it presses against (`unhug`). 0 bots stuck > 5 s in 20 matches (max 2.5 s; was 11 s).<br>• **Grenades:** bots throw only at targets holding still for 1 s (a lone target at ≥ 60 % hp), stand still during the wind-up and re-aim at release, never walk into their own. TDM 4.0 / 2.2 throws per match (West Yard / Lot), 35 % / 46 % of blasts hit; Base Assault hits 24–31 % (26 % pooled). Teammate hits 0, carrier throws 0. Core Rush throws fewer (the approach move is TDM-only: the objective decides where bots stand).<br>• **The Lot in Base Assault:** each push picks one of L3's lanes and rallies at its far end: 43 % of attack runs via the Canyon or the Pipeworks (Q4: 0); 21 captures in G4b's acceptance (was 15).<br>• **Lane weights:** Canyon 0.29 / 0.37 of the Mud's bot-seconds on Q4's / L3's seeds (Pipeworks 0.50 / 0.35); was 0.22.<br>West Yard at F1: 5.3 captures per match, 10/10 seeds. Lead follow-up: The Lot's scaffold facade braces now meet their standards 1.8 m up (they dipped to heap level and wedged pets on the heap-top path; Lot tests 50/50, Lot soak stuck max 1.5 s). docs/handoff/F2.md |
| **W9 F1 West Yard Base Assault balance (world-2)** | ✅ merged | Q4's P1-1. Not cover: five single cover pieces left the corgi side at 67–84 % of captures. The cause was respawn distance (the corgi stand mid-row, 27–35 m from the defenders' respawn; the cat stand at the end of its row, 42–48 m). The corgi flag, and the Base Assault stand beside it, moved to mirror the cats': (−33.8, −67.4) → (−13.1, −69.2).<br>**Seeds 6–15:** base 25 : 26 captures (49 %), swapped sides 27 : 27 (50 %); was 68 % / 80 %. Line-of-sight gap 26.6 → 5.5; stuck max 11 → 2 s. E4 tests 17/17, adventure 12/12 gold, soak PASS 97, 12v12 TDM 372 draws. docs/handoff/F1.md |
| **W9 Q4 independent verification (qa-4)** | ✅ 75 / 100, gate PASS, no P0 | Realism 85 · Intensity 73 · Fairness 61. Base Assault held its ball invariant on every tick of 70 bot matches and 9,000 wire snapshots against hostile clients (button spam, forged positions, team/class spam, 111 reconnects, a carrier leaving on the capture tick); throwables are spam-proof and never lethal from full health; prediction error 0 for a carrier and a thrower up to 75 ms / 3 % loss; 7/7 determinism runs identical on both maps; worst frame 383 draws / 1.29 M tris; P4's numbers reproduce.<br>**P1-1:** on the West Yard the corgi side wins Base Assault (25 : 12 on 10 new seeds; swapped sides flip it): exposure on the cat thief's run home → fix lane F1 (cover). **P2s:** a joining human deleted a bot ball carrier (fixed by the lead: `fillBots` trims carriers last, tested); parked karts pin bots, bot grenades rarely hit, The Lot's side lanes unused in Base Assault, the Canyon at 0.22 → fix lane F2. docs/qa/W9_VERIFICATION.md |
| **W9 P4 readability + grade pass (look-3)** | ✅ merged | A character rim + fill (a material term, distance-graded, characters only: no real light, no pass); a dusk sky fill (the anti-sun light ×2.5, near-horizontal at low sun); exposure 1.0 → 1.25, vignette 0.62 → 0.5; storm team signal (characters shed 60 % of the fog; the grade protects the two team hues). The Lot's fog scales with the map (L3; West Yard exactly 1).<br>**W7 bookmarks at t = 0.74:** luma 47–79 (was 31–61), contrast up on all five (deck 35.1 → 58.9, flank 31.3 → 46.7). **35 m lineup:** 39.1 → 69.9 luma, team hue 7.9 → 13.1 %. **Storm team read** ≥ 6.7 % per species, high and low (was 0.1–0.4 %). Draws unchanged (12v12 high 373). The Lot's sodium pools kept their colour (sat 0.47).<br>**Watch:** daytime is ~18 % brighter (exposure is global); the Lot's pipe interior is now lit (luma 20 → 50); a real-GPU look is still owed. docs/handoff/P4.md, artifacts/p4/ |
| **W9 L3 The Lot M3 + M5 (world-2)** | ✅ merged | **Atmosphere:** floodlight pools on the pit floor and scaffold deck (`WorldData.floodlights` → the S4 rig, on any map; the towers' 33–39 m throw scaled from the style's 12 m pole light), red crane aviation lights and a lit cab, muddy ditch water, pale cement sacks, calmer gravel rims. A per-map weather bias (`WorldData.weatherBias`): The Lot opens overcast, rain arrives after 1.3–1.8 min, wet ~78 % of the time (West Yard 34 %, its schedule bit-identical; rain at tick 0 made the skirmish soak miss its match).<br>**Gameplay:** bots climb (climbRoutes → N1 links, 12 profiles validated; marksmen hold all 4 perches), 22 pickups (hop search both species), Base Assault bases, lane goals: Canyon and Pipeworks 0.36 / 0.38 of the Mud's bot-seconds (4 seeds pooled; W8 0.04 / 0.05).<br>Live 14v14 358 draws / 0.72 M tris (≤ 400 / 1.5 M; 42 draws of margin left); soak PASS on The Lot (95; base-assault 93); 24 new tests. The fog-by-map-size snippet lands with P4 (both edit sky.ts). docs/handoff/L3.md, artifacts/l3/ |
| **W9 G4b bots play Base Assault (mode-1) + the X4 bot throw hook** | ✅ merged | Per-team roles in `ai/base-assault-ai.ts` (pure, deterministic, 0.5 s re-plan with hysteresis; 0 role flicker): attackers gather 35 m short of the enemy stand and storm it together (without the rally: 7–11 steals, 0 captures), the carrier runs straight home and never rides, escorts shadow it, defenders guard, the nearest two return a dropped ball, everyone chases a thief; all-in attack when behind with < 90 s left.<br>**Bot-only 4v4, 5 seeds × 5 min:** West Yard 5/5 seeds capture (15 : 3); The Lot 5/5 (9 : 5 on the spawn fallback, 8 : 7 on L3's bases); worst stuck 3.5 s. Online, 2 clients at 40 ± 10 ms / 1 % loss: a full round and a clean restart on both maps, 0 ball mismatches in ≈ 18 k checks per map. Soak PASS (West Yard 4 modes score 96; The Lot 94). 1.7 / 3.1 µs per tick at 8 / 16 bots.<br>X4 hook: bots throw at visible clusters (base-assault 7–10 per match, TDM 0–1: X4's cluster gate rarely opens in TDM). **Watch:** the West Yard leans corgi (15 : 3; carrier sprint 7.2 vs 6.6 m/s and the base layout) — for Q4 and the owner. docs/handoff/G4b.md |
| **W9 K3 hardened squads + veteran rank (char-3)** | ✅ merged | Two Yard Skirmish squads, waves 2–5:<br>• alley-cat raiders: 60 hp, fast flankers, scavenged bottle-cap / bike-chain kit;<br>• tabby heavies: 180 hp shield-bearers, −40 % frontal guard (PvE only, one guarded line in damage.ts), a dented bin-lid shield.<br>qa-difficulty over 24 seeds stays in band (won / unfinished / lost 19 / 3 / 2 vs 20 / 3 / 1; AFK and online unchanged).<br>A player **rank** slot (Sergeant's Chevrons / Commander's Medal) unlocks at level 10 and is worn online as the veteran kit; snapshots are identical with or without it (no combat power).<br>Suit luma 35 → 71 / 43 → 69 up close, full-sleeve team bands, rear team strobes; team read ≥ HEAD on 48/48 kits (min 6.52 %), K1 pairs not lower, no new draws, worst tris 5,894 / 3,476.<br>**Open:** at 35 m under dusk the lift barely shows (luma 38.4 → 39.2): it is a lighting limit, P4's first item. 23 new tests. docs/handoff/K3.md |
| **W9 X4 throwables (arms-2)** | ✅ merged + wired (bots at G4b) | Corgis carry a Squeaker Grenade, cats a Hairball Bomb: one at most, spawn with one, restock automatically at your own Ordnance Kiosk 20 s after a throw. Hold G (gamepad D-pad down) for the arc preview, release to throw.<br>One shared blast: 70 at the centre (the 90 hp classes keep 20: it opens a kill, never makes one), falloff to 14 at 4 m, knockback 7 m/s, self 35 %, fuse 2.2 s with a blinking telegraph and a red radius ring in the last 0.8 s. They differ only in bounce. Off in Adventure (its par medals were tuned without them).<br>Authoritative: launched from the sim's own position and aim; refusals tested (no throwable, cooldown, dead, riding, stunned, taunting, not live). Gun tables byte-identical (content hash). Karts, planes, drones and barriers take the throwable's own blast numbers; Throw joined the Room's combat buttons.<br>Proof: 43 tests; preview vs flight < 1 mm at the landing point (flat, slope, props, both maps: 157 throws); 0 retained allocations per throw after warm-up. docs/handoff/X4.md, artifacts/x4/ |
| **W9 G4a Base Assault (mode-1)** | ✅ merged + wired | Steal the enemy's squeaky tennis ball from its stand and run it to your own flag's ring; first to 3, or the most at the 480 s horn. You can only capture while your own ball is home; after 60 s with both balls away both rings open (stalemate relief).<br>The carrier moves at 0.75× (slide boost included), can't glide or ride, and drops the ball where knocked out; a dropped ball goes home after 20 s or at a defender's touch.<br>No protocol change: ball, stand and ring are props in the snapshot; events reuse `score` / `pickup`. MATCH ▸ BASE ASSAULT on both maps (`?mode=base-assault`); kiosks, karts and the plane are in the mode.<br>Proof: 30 tests (every edge case: same-tick grabs, disconnect, team/class switch, killY, water, restart, horn) with a ball invariant after every tick, including a 45 s seeded chaos run; prediction parity 0 error for a carrier; a scripted human wins 3–0 in an in-process Room; rules cost ≈ 8 µs/tick. Bots don't play the objective yet (G4b). docs/handoff/G4a.md, artifacts/g4a/ |
| **W7 P3 render budget pass (Block 4 perf)** | ✅ merged | An ink LOD: the scene pass skips outline hulls under 0.3 px; characters keep theirs, which carry the class read at range. A character detail LOD past 20 m (weapon ink, glow and small shadows) and distance-culled crease-ink tiles (40 m).<br>**Budgets, high tier, now all inside §8.7:**<br>• live 4v4 328 → 262 draws, 1.52 → 1.19 M tris;<br>• 12v12 514 → 373, 1.69 → 1.32 M;<br>• The Lot 14v14 449 → 331;<br>• low 217 → 168.<br>Nothing changes within 18.5 m (screenshots looked at). 11 new tests; char-audit 24/24. docs/handoff/P3.md, artifacts/p3/ |
| **W7 Block 2: E4 the Yard War front** | ✅ merged (budgets met by P3) | A forward base per team (mirrored):<br>• kibble-sack walls and an MG nest with BEWARE OF DOG / NO DOGS sign armour;<br>• a bird-table watchtower (deck 4.8 m, crate stair);<br>• a 12.5 m flag with a torn paw / cat banner;<br>• a tennis-ball armory under camo nets, a gas-can motor pool, a generator and cables;<br>• sodium floodlights with real lights; hedgehogs and an X-barricade.<br>The contested middle has zig-zag trenches (drivable), 8 craters and low sack cover, on weathered ground (mud, ruts, scorch, puddles). Every site, pad, spawn, step, route and pickup is unchanged (tested).<br>Proof:<br>• 21 tests (collider == visual, worst 0.00 cm); full unit suite green;<br>• **SOAK PASS 96** (3 modes, 0 errors, stuck ≤ 1.5 s, p95 1.56 ms); **adventure 12/12 gold** inside par.<br>Rams: 3 per 6 matches, was 6 (the cover blocks ram lines; the gate now pools 6 matches).<br>**Budgets, high tier:**<br>• live 4v4 TDM 333 draws / **1.53 M tris (+2 %)**;<br>• 12v12 **512 / 1.69 M** (over);<br>• low 4v4 217 / 0.87 M.<br>The budget pass is next. artifacts/e4/, docs/qa/W7_GALLERY.md |
| **W7 Block 3: X3 weapons + combat feedback** | ✅ merged | Firing:<br>• a muzzle flash by weight class (flame tongue, petals, sparks, halftone smoke) with point-light pulses (2 / 1 / 0 by tier);<br>• amber tracers and bouncing brass.<br>Impacts by surface (dirt, grass, sand, stone, metal, wood, water, soft) from WorldData, landing when the tracer arrives with the sound delayed to match. Pooled bullet holes and scorch (64 / 40 / 16) in 1 draw. Pet hits: fur tufts + a small comic splat + THWACK! (never blood). Bigger explosions.<br>A new hitmarker (white hit / gold crit / red kill), a visual recoil kick and a kill FOV punch (view only), layered weapon audio and a hit/kill thud. **No gameplay numbers changed.**<br>Proof: a 12-shooter firefight costs 0.22 ms of FX CPU per frame, 4 draws, 1.65 B allocated per shot; 31 new tests. artifacts/x3/, docs/handoff/X3.md |
| **W7 Block 1: K2 hardened characters + X3 weapon models** | ✅ merged | Armoured veterans:<br>• faction camo plate carriers (corgis: hazard ochre + gunmetal; cats: oxblood + charcoal + brass) over a dark under-suit;<br>• collar, chipped chest plate, pauldrons, bracers, knee pads, boots, belt, webbing, tags;<br>• wet, muddy fur, brow scar, notched ear;<br>• heavier, grounded proportions; a squint under heavy brows (the K1 comedy faces are kept).<br>Team signal only on shells, armbands, bands and a glowing team lamp per class. Veterans (rank stripe, crest, second scar, eye-patched cat commander): bots about 1 in 6 by seed. X3's six hard-surface weapons carry faction wear and a `finish`.<br>Proof:<br>• char-audit 24/24; character/cosmetic/boss/weapon tests green;<br>• budgets: hero ≤ 5,910 / 6,000 tris, NPC ≤ 3,480 / 3,500 (a 20-triangle margin);<br>• K1 closest class pair 0.122 → ≥ 0.144; team read ≥ 6.2 %.<br>artifacts/k2/*.png, docs/handoff/K2.md |
| **W7 S4 HARDENED look (Block 4 core)** | ✅ merged `94336ce` | Style factory v2:<br>• weathered TSL (grime, edge wear, mud, sun-bleach, wet sheen, puddles), a soft 4-band ramp, specular, sky reflection, thinner ink;<br>• gritty grade (split tone, protected team colours, grain, vignette);<br>• a dusk/storm sky with ground haze; sodium floodlights (3 draws, 4 / 2 / 0 real lights by tier).<br>Live 4v4 TDM on high: 300 → 301 draws, 1.406 → 1.407 M tris; low identical. 21 tests; artifacts/s4/gallery/ |
| W6 C3 looks · P2 profile · U2 locker/rewards · N2 looks online · INT6 | ✅ merged + wired | C3: coats, neckwear, taunt packs via `applyLook` (cosmetics tests). P2/U2: 55 unit + 1 e2e (`cvc.profile`, XP, unlocks, LOCKER, reward card; artifacts/p2-profile/*.png). N2: hello carries both species' looks, guard + room sanitize (hostile → dropped, never echoed), the roster carries the worn look, bots wear `randomLook(seed)`, taunts use the pack, a LOCKER equip mid-session (`look` msg) is worn from the next spawn, snapshots unchanged (net-look, 6 tests). INT6: profile → hello, tally → reward card; e2e "an equipped look is worn by the local avatar in the next match" |
| **W8 M2 The Lot (world-2)** | ✅ merged | A second battleground, 320 m across (half extent 160), at dusk:<br>• the corgi base in an 80 × 30 m foundation pit (2.4 m deep, ramps, cement bags, floodlight towers) with 3 trenches;<br>• the cat base on a spoil heap with a 48 m scaffold (deck 9 m, crow's nest 13.4 m);<br>• Container Canyon (site offices you can walk through, a gangway to a roof); the Mud (mounds, walk-through pipes, cover pairs); the Pipeworks (two 3-pipe tunnels); a 4-zone ditch with 3 dry causeways;<br>• the tower crane, the hoarding, the West Yard's fence and house beyond.<br>`?map=the_lot` and MAP ▸ THE LOT. Lead: terrain edge, far-prop radius and pond-bed level follow the map (`WorldData.bedLevel`).<br>Proof:<br>• 25 tests (collider == visual, spawns, nav reach, kart routes, the real KCC through the tunnels, containers and scaffold);<br>• 14v14 TDM 43 deaths, stuck ≤ 1.5 s, tick p95 2.06 ms; soak PASS 3 modes (score 95);<br>• build about 180 ms; live 14v14 TDM 0.79–0.84 M tris.<br>Next: M3 atmosphere (floodlights, rain, water tint, crane lamps), M5 gameplay (pickups, climb routes). docs/handoff/W8-LOT.md, docs/qa/w7-gallery/lot/ |
| W8 M1 multi-map plumbing (lead) | ✅ | `src/shared/world/maps.ts` registry (`MAP_IDS`, `mapForMode`); `?map=` → worker / room setup → `Sim.create({ map })` → welcome `map` → predictor per (map, seed); the page reloads into the room's world on a mismatch (never loops); `/rooms` lists `map`, and an adventure room lists the chapter it plays now (Q3 P2-1). 8 + 3 tests; the West Yard unchanged. Vision: docs/design/EXPANSION_VISION.md ("The Lot") |
| Server heartbeat vs stalls | ✅ | a blocked event loop (world build, GC, overload) no longer terminates live peers: stalled time is credited, real silence still caught (test fails without the fix) |
| Q3 Wave 5 verification | ✅ | docs/qa/W5_VERIFICATION.md at `3b3bfb3`: 78/100 (R 84 · I 73 · F 75), gate PASS; P1-1 (pups breached ch3's wall right after the human's step began) fixed by the lead (pups hold off `DESTROY_HOLD_OFF` = 25 s on a destroy step when a human is in the squad). P2s fixed by the lead: P2-1 listing names the chapter playing now; P2-2 a restart clears every kart and plane (`clearVehicles`) and bots start no ride or sortie in the result hold; P2-4 no ram boarding below `RIDER_BAIL`; P2-6 `/rooms` + browser show the boss (and a non-default map), the adventure scoreboard's cats column counts the chapter's cats, Q2's abuse probe expects `yard_day`. Each fix has a test that fails without it. P2-5 (budget margins) rides with Wave 7's budget work |
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

## Next quality loop: highest-leverage items (after Wave 9, 2026-09-27)
Wave 9 is complete and pushed: every lane, Q4's verification (75 / 100, no P0) and the fixes for its P1 and P2s
(F1, F2, lead). Evidence: `docs/qa/W9_GALLERY.md`, `docs/qa/W9_VERIFICATION.md` (with a resolution section).
1. **Human playtest on a real GPU (MASTER_PLAN §9 milestone DoD).** Base Assault on both maps, throwables, the new
   squads, the HARDENED look after P4. Nothing since W6 has been judged by a human; "humans certify fun". Real-GPU fps
   at high and medium is still unmeasured.
2. **Look calls for the owner, on a real monitor:**
   - daytime is ~18 % brighter after P4 (exposure is global);
   - The Lot's pipe and container interiors are now lit by the sky fill;
   - The Lot's storm overview from the high camera is still a grey wash.
3. **Open bot and world items:**
   - thin hedgehog beams are missing from the nav grid (F1 §7; `src/sim/ai/nav.ts`);
   - The Lot's lane weights should move into `LOT_LANES` (F2);
   - Base Assault has no plane pilot (`PLANE_MODES`).
4. **A throwable kill shows the gun glyph** in the kill feed: the `death` event has no weapon (a protocol decision).
5. **Earlier design questions still open:**
   - kart rams halved on the fortified yard (Q3 P2-3);
   - X3's shotgun extra impacts;
   - the ~0.4° visual-kick offset;
   - the rifle's SQUEAK! word;
   - later match start times.

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
  - bots shoot adventure props and breach with Dig Charges. They climb when a goal sets a roof height (N1; the roof-zone
    tactics of `docs/handoff/N1.md` §4.1 landed with B2), so a reach step's `minY` now holds for bot-only squads
    (ch4's perch: same times as with the waiver, 6/6 seeds). An interact step's `minY` stays waived for bots: they
    have no climb route onto the shed roof, and ch6's ball would wait out the 120 s grace (6/6 seeds).
    Bot-only squads drive ch3's getaway and fly/glide ch6 for real: `vehicle`/`airborne` are strict for them too,
    with the same 120 s grace as humans (B2). Pups don't take karts for plain travel;
  - ch6 step 1 needs a Skyraider. Joining a listed adventure room now takes the chapter's kit (`096be58`); a joiner
    who types the room name by hand keeps their kit and waits out the grace.
  - ch5's difficulty for humans is unknown. Bot squads do wipe on its last wave: 3 of 12 seeds on the first try
    (`qa-adventure.mjs bots --chapters porch_siege`), gold every time;
  - one adventure chapter per page on the client; picker locks are cosmetic; sentry cones draw through walls
    (intended readability).
- Sniper elite (E1): perches are hard-coded West Yard spots (tests catch lost sightlines, not looks); L3 bots don't
  dodge the dot; a human must confirm the 2–4 minute duel target.
- Bots drive karts (B2a): rides every match, but ram kills are rare. Targets back off from karts, so rams close at
  ~12 m/s for 51–63 damage. The kart grid costs 60–100 ms once per world (first need), 12 ms per destructible change.
- Destructibles (X1): outside adventure destroy steps bots ignore props; a match reset relabels nav regions once
  (~5–9 ms).
- RC plane (R1):
  - the cockpit strip `ui/plane-hud.ts` shows hull, throttle, airspeed, height, boost, gun heat and STALL!; engines
    are voiced by S2;
  - planes are interpolated, not predicted (mouse-aim hides most of the latency);
  - one Overwatch/Skyraider room bot per team flies strafing sorties in TDM / core-rush / yard-skirmish (B2b); its gun
    hits are few (0–3 a sortie);
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
  - rooms in one process no longer leak into each other (D1, `docs/handoff/D1.md`). The shared nav grid baked in the
    kiosks (and any parked kart) of whichever room built it first, and 11 of 30 room pairs diverged; now 0 of 30. The
    shared grid, decks and kart flat mask come from the static world only, and each room closes its own kiosk cells
    (`setNavFixture`). `tools/qa-determinism.mjs` checks any pair; `determinism-cross-sim.test.ts` guards it. The
    shared grid builds in ~100 ms cold / ~26 ms warm (was ~200 / ~115);
  - client memory: views that leave the scene release their render objects (`engine/release.ts`). Shared geometry
    and materials had kept every dropped drone, avatar, kart and core alive with its uniform buffers (+188 WebGL
    buffers in 5 min of TDM). Separately, the ability views kept a list of every ink line they ever made, pinning
    ~78 dead meshes per 5 min. Now 0 meshes, render objects or buffers are retained (heap snapshot diff and
    retainer paths; `tools/qa-memory.mjs` for the 10-minute run). The authority's heap grows ≤ 0.14 MB/min with no
    collection growing (`soak.mjs --heap`);
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

Open questions for the first human session:
- **Featured kits (Q2 P2-1).** Bot squads finish chapters 2, 4, 5 and 6 as fast with four Assaults as with the
  featured kit; only chapter 3's breach wall needs it (a Breacher's Dig Charge). For humans the kit gates only
  chapter 6 step 1, and only for the 120 s grace. Should a chapter's kit be required, only rewarded (par, medal), or
  stay a recommendation? Play chapter 4 (range in the duel) and chapter 2 (cloak in the grass) with and without it.

## Ideas (not in scope yet)
- Corgi "zoomies" leaves a dust trail that briefly slows pursuing cats.
- Sprinkler weather event that knocks cats off the lawn.
