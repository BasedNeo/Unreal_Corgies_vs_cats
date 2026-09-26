# MASTER_PLAN — Corgis vs Cats (Three.js)

> The brain of this project. Every agent re-reads §0, the current wave/lane card in §10, `ARCHITECTURE.md`
> and `PROGRESS.md` before any significant action, and obeys them. If this file and the code disagree,
> fix the code or propose a plan change in `PROGRESS.md` — never silently drift.

---

## §0 Constitution (always read first)

**Operating rules**
1. Re-read `MASTER_PLAN.md` (§0 + your card), `ARCHITECTURE.md`, `PROGRESS.md` and `AGENTS.md` before starting a
   phase, a lane task, or after any context reset.
2. Work only inside your lane's owned paths (§10). Shared contracts (§8.4) change only through the lead.
3. Never expand scope. Implement what the current card asks; log ideas in `PROGRESS.md › Ideas` instead.
4. Proof or it didn't happen: a task is done only when `npm run gate` passes (or the card's narrower proof
   command, for lanes working in parallel) **and** you looked at the screenshot/log the card names.
5. Every phase card is written as **outcome · constraints · reason · proof** (destination brief format).
6. Update `PROGRESS.md` (and `ARCHITECTURE.md` when structure changes) at the end of every task. Commit per task.
7. Prefer complete, working, Accept-ready code. No placeholder TODO stubs in shipped paths.
8. Maximize Three.js + the installed game skills; do **not** recreate Unreal complexity (no editor, no
   hand-authored asset pipeline, no reflection systems, no Blueprint-like layers). Procedural first, data-driven,
   browser-native.

**Product red lines (carried from the legacy Unreal roadmap — owner-locked)**
- Original IP only. **Zero Conker/Rare expressive IP**: no copied names, silhouettes, animation language, VO,
  jokes, props or presentation. The legacy class name "Demolisher" (a Conker: Live & Reloaded class) is renamed
  **Breacher**.
- Multiplayer-first: every competitive truth (health, damage, death, score, teams, spawns, objectives, ammo,
  cooldowns, terminals, cores, vehicles, win conditions) is decided by the authoritative simulation. Clients own
  input, camera, prediction and cosmetics only. No client trust, ever.
- Soft counters only (~60/40 skilled matchups); no permanent combat-power progression across matches.
- One excellent weapon before class breadth; three proven classes before six; terminals before vehicles;
  one map before a second.
- Graybox until fun: art polish never repairs an unfun loop. **Humans certify fun**; agents prove correctness.
- Every external asset or tool records source, license and version before use (AI meshes via
  `ai-mesh-to-threejs-asset`, license-gated).

---

## §1 Vision & tone

**One line:** A war between corgis and cats, played as a chaotic third-person action-platformer shooter:
a corgi warrior squad fights the cat army across West Yard — a suburban backyard at pet scale — one outrageous
district at a time, alone, in co-op, or head-to-head online.

**Tone:** irreverent, chaotic, expressive. Adult-leaning comedy without forcing it — humor from character and
situation (smug cats, overly earnest corgis, household objects as military hardware), never a joke per line.
Default rating target: Teen-equivalent — cartoon violence (fur and stuffing puffs, no gore), innuendo and satire,
bleeped swearing. Characters are stylized, big-headed, readable at thumbnail size, and *act*: ears, tails, brows.

**The adapted queue test** (asked after every milestone, answered by a human): *"Would I immediately play the
next encounter / queue another match?"*

---

## §2 Technical constraints & stack

| Layer | Decision |
|---|---|
| Platform | Browser-only client; Node 22+ authority server. No other backend required for core play. |
| Language/build | TypeScript (strict) + Vite 8. One `three` import path: **`three/webgpu`** (+ `three/tsl`). |
| Renderer | `WebGPURenderer` (auto-fallback to WebGL2). TSL for materials, post and GPU compute. |
| Look | `threejs-toon-comic-style-system`: tokens → `toon()`/`glow()`/`stylize()` → `toonOutlinePass` + bloom + grade. |
| Physics | Rapier (`@dimforge/rapier3d-compat`) in the authority **and** client prediction; kinematic character controller. |
| Networking | JSON over WebSocket (`ws`) online; the same Room runs in a Web Worker offline. Server-authoritative, client prediction + reconciliation, snapshot interpolation, lag-compensated hitscan. |
| Audio | Web Audio API, procedural synthesis first (no files required). |
| Testing | Vitest (sim, host, netcode, generators) · Playwright on headless Chromium (smoke, screenshots, net) · `npm run gate`. |
| Targets | 60 fps on the reference machine (owner's Apple Silicon Mac, Chrome/Safari) at the High tier; 30 fps floor at Low on an integrated-GPU laptop. |

---

## §3 Art direction & theme tokens

- **Look:** hand-inked comic/cartoon. Chunky shapes, warm-black ink outlines, 3-band toon light, warm sun key +
  cool sky rim, saturated backyard greens, corgi oranges, cat greys/blacks. Team colors: Corgis royal blue + gold,
  Cats crimson + black. Only emissives bloom (laser pointers, tennis-ball tracers, glowing cores).
- **Pet scale:** characters ≈ 1.2 m tall; the world is a backyard scaled ~×4 (fence ≈ 8 m, garden hose ≈ 0.4 m
  thick, lawn chair seat ≈ 2 m high). Scale sells the comedy and gives platforming for free.
- All colors and look numbers live in `src/client/style/style-tokens.js` (+ `STYLE_GUIDE.md` for intent).
  No one-off materials: everything goes through `toon()`/`glow()`/`stylize()`.
- Theme-swappable by construction: theme content lives in `src/shared/content/` and the style tokens; engine
  systems never hard-code theme names or colors (see §12).

---

## §4 Core loop & feel targets

**Second-to-second:** move → jump/double-jump → aim → fire → dodge → react; every action gets feedback < 100 ms.
**Minute loop:** encounter (cat squad / enemy players) → reward (kibble, Upgrade Core, objective progress) →
new route or tool (terminal, vehicle, class swap) → next encounter.
**Session loop:** match/district objective → set piece → result → rematch / next district.

**Feel numbers (starting targets, all data in `src/shared/content/classes.ts`)**
- Input → visible response ≤ 1 sim tick + 1 frame (< 33 ms locally, predicted online).
- Run 6.4 m/s · zoomies sprint 9.6 m/s · walk/aim 3.6 m/s (corgi); cats slightly more agile, higher jump.
- Jump buffer 120 ms · coyote 120 ms · double jump · variable jump height (release early = short hop).
- Fall gravity ×1.55 (snappy arcs) · ground accel 70 m/s² · air accel 22 m/s².
- Camera settles ≈ 150 ms; aim zoom transition ≈ 120 ms; hit-stop 3–5 frames on melee/crit; trauma shake.
- No input-locking animations except committed heavy attacks (with cancel windows).

**Win/lose/progression:** match modes decide (see §7.13). Persistent progression = kit unlocks + cosmetics only.

---

## §5 World structure (Conker-like variety, cohesive semi-open world)

West Yard is the hub. Each district is built around one class job, so variety comes from data + one mechanic,
and each kit is proven in PvE before PvP uses it. District names are placeholders until a story doc exists.

| District | Class job | Gameplay flavour | Signature mechanic |
|---|---|---|---|
| West Yard (hub) | Assault | run-and-gun, platforming, first weapon | trampoline jump pads, deck/stairs verticality |
| The Garden | Infiltrator | stealth, climbing | tall-grass concealment, cat sentries with sight cones |
| The Rooftops | Overwatch | sniper set piece | long sightlines, laser-pointer duel |
| The Warehouse (garage) | Breacher | explosives, vehicle breach | destructible stacks, kart via Vehicle Terminal |
| The Porch Siege | Warden | hold the line | barriers, wave defense |
| The Sky | Skyraider | flight section | ear-glide, RC plane |

Terminals and cores in the campaign: **Ordnance Terminals** swap kits, **Vehicle Terminals** spawn vehicles,
**Upgrade Cores** are power-ups that reset when you leave a district / at match end.

---

## §6 Characters (procedural pipeline — no licensed meshes needed)

The legacy project stalled for days on a licensed corgi mesh; here characters are **code-generated**:

1. **Species as numbers:** one anthropomorphic body plan (biped with digitigrade-ish legs, big head, expressive
   ears/tail) parameterized per species/variant: corgi (long body, stubby legs, huge upright ears, fluffy rear,
   stub tail; red/sable/tri coats) and cats (tabby, Siamese, chonk, sphynx, tuxedo, ginger; boss Maine Coon).
   Seeded variation (proportions ±, coat patterns, accessories). Same seed ⇒ same character everywhere.
2. **Geometry:** smooth, blobby toon forms (lathe/superellipsoid/metaball-style merged primitives) with
   outline-safe normals; built once per (species, class, seed) and cached.
3. **Rig:** one shared skeleton template (≤ 48 bones incl. ears, tail chain, jaw, brows); automatic skin weights.
   Animations are authored in code and retarget across species.
4. **Face:** separate eyes (sclera/pupil/lids with blinking), brows, jaw/mouth shapes → expression set
   (neutral, smug, furious, terrified, derp, happy).
5. **Animation:** locomotion blend (idle/walk/run/sprint — corgi sprint drops to all fours: "zoomies"), jump/fall/
   land, upper-body aim layer (pitch + yaw twist), fire recoil, hit react, death, emotes; procedural secondary
   motion (spring ears/tail/cheeks), squash & stretch.
6. **Checks:** triangles (hero ≤ 6k, NPC ≤ 3.5k, boss ≤ 15k), bones ≤ 48, feet at y = 0, faces −Z, style audit,
   silhouette distinctness per species at 64 px.
7. **Crowds:** LOD0 skinned ≤ 25 m, simplified beyond; far crowds may bake animation to instanced meshes.
8. Every character iteration is reviewed side by side with the owner's target stills (legacy CHAR-01A) and scored
   on the owner's 1–10 scale.

---

## §7 Systems specification

Each system lists purpose → contract → acceptance. Code locations are in `ARCHITECTURE.md`.

### 7.1 Bootstrap & build
Vite client (`index.html` → `src/client/main.ts`), Node server (`server/index.ts`, `npm run server`),
`npm run gate`. Accept: gate green on a fresh clone with only `npm install`.

### 7.2 Render loop, renderer, performance monitoring
`createRenderContext` (WebGPU→WebGL2), comic pipeline, resize, adaptive pixel ratio (0.6–1.5), fps + frame ms
in the debug hook and HUD. Quality tiers (low/med/high) as data. Accept: no per-frame allocations in hot paths;
`__cvc.fps` exposed; resize keeps aspect.

### 7.3 Input
Keyboard/mouse (pointer lock) + gamepad → `InputCmd` at 60 Hz (latched taps). Remappable map (settings).
Accept: taps shorter than a tick still register; gamepad dead zones; no stuck keys on blur.

### 7.4 Camera
Third-person spring camera, over-shoulder aim mode, FOV kick on sprint, wall avoidance (solid meshes only),
trauma shake, vehicle mode, spectator/death cam, first-person toggle (optional). Accept: no clipping at the
5 bookmarked tight spots; no jitter entering/exiting vehicles.

### 7.5 Player controller (authoritative + predicted)
`stepCharacter()` in `src/sim/systems/movement.ts` is the single movement implementation used by the authority
and client prediction. Run/sprint/walk, jump buffer, coyote, double jump, variable height, slopes/steps via
Rapier KCC. Next: slide (crouch while sprinting), ground pound, ledge grab, swim. Accept: unit tests for each.

### 7.6 Vehicles / traversal
Vehicle Terminal spawns a kart (raycast vehicle, authoritative) and an RC plane (later); enter/exit with E,
distinct handling, camera transitions; jump pads (trampoline), ear-glide (Skyraider). Accept: enter/exit never
teleports or drops the player through geometry; predicted driving feels responsive at 80 ms.

### 7.7 World streaming / chunks
Districts share one global deterministic height function; chunked terrain with LOD rings from
`game-landscape-streaming` once the world exceeds ~300 m. Accept: seam/crack checks pass; no hitches > 4 ms.

### 7.8 Terrain / world generation
`src/shared/world/`: deterministic height field (lawn undulation, mounds, garden beds, pond/pool cut, dirt paths)
+ gameplay stamps (flattened building pads). Identical on server and client. Accept: sim collider = rendered
surface within 1 cm on the play area.

### 7.9 Props & instanced decoration
Procedural backyard props (fence, deck, house wall, shed, doghouse, cat tree tower, picnic table, grill, pots,
hose, trampoline, sandbox, swing set, planters, bricks), stylized; instanced grass/clover/flowers/pebbles with
wind; big trees and hedges. Accept: draw calls ≤ 400; all props through the style factory.

### 7.10 Atmosphere, weather, post
Sky + sun/hemisphere driven by time of day (`game-landscape-atmosphere`), fog tuned to hide the far edge,
shadows sized to the play area; weather state machine (clear → overcast → rain → storm, plus sprinkler events)
with blended transitions; post = toon outline + selective bloom + split-tone grade + vignette/grain. Accept:
screenshots at dawn/noon/dusk readable, no banding/black holes.

### 7.11 FX framework
Pooled GPU-friendly particles (instanced sprites, TSL), muzzle flash, tracers, impact puffs (fur/stuffing),
dust on land, jump-pad rings, explosions, comic onomatopoeia billboards ("POW!", "BARK!", "HISS!").
Accept: zero allocations per spawn after warm-up; ≤ 1 ms at peak combat.

### 7.12 Audio
Web Audio: spatial one-shots (panner), procedural SFX (bark, hiss, squeak-rifle, hits, footsteps, jump, land,
explosions), procedural gibberish voices, music layers crossfaded by combat intensity; master/music/sfx volume.
Accept: every player action has audio; no clicks; muted until first user gesture.

### 7.13 Entities, combat, weapons, abilities, match rules
- Entity model: `SimEntity` + components (module augmentation), systems ordered by `order`.
- Health/damage/death/respawn authoritative; headshot/crit multiplier; friendly fire off by default.
- Weapons as data (`src/shared/content/weapons.ts`): hitscan + projectile (arcing tennis balls), fire rate,
  spread, recoil, ammo/reload, damage falloff. Lag-compensated hitscan using `InputCmd.rt`.
- Abilities as data: bark blast (Assault), shadow cloak (Infiltrator), spotter drone (Overwatch), dig charge
  (Breacher), squeak barrier (Warden), ear glide (Skyraider).
- Modes: `yard-skirmish` (co-op PvE: waves of cats, objectives) and `team-deathmatch` (PvP with bot fill);
  later `core-rush` (capture Upgrade Cores). MatchState in `sim.state.match`.
Accept: deterministic unit tests for damage, death, respawn, ammo, win rule, lag compensation.

### 7.14 AI
Bots produce `InputCmd`s (same authority path as players). Hierarchical FSM: idle/patrol → alert → engage
(strafe, take cover, reposition) → flee/regroup; perception (sight cone + LOS raycast, hearing via events);
navigation on a grid A* built from `WorldData` (props + slopes) with steering. Archetypes: grunt tabby, sniper
Siamese (laser-pointer telegraph), brute chonk, swarm kittens, and one large signature threat (Maine Coon
mech-boss). Accept: bots navigate the yard without sticking; fair reaction times; ≤ 1.5 ms/tick for 16 bots.

### 7.15 Spawn / population
Team spawn points from `WorldData`, safest-spawn selection, wave spawner for PvE tied to districts.

### 7.16 Interaction / discovery
Interact (E) with terminals, vehicles, pickups; collectibles (golden kibble), points of interest, trigger volumes
for objectives and comedy barks.

### 7.17 Inventory / loadout / progression
Class kit = primary + ability (+ secondary later). Ordnance Terminal swaps kit in-match. Persistent: unlocked
kits/cosmetics in localStorage profile.

### 7.18 UI / HUD
Comic-panel HUD: health, ammo, class/ability cooldown, crosshair + hit markers, damage direction, kill feed,
match timer/score/objective, respawn countdown, scoreboard (Tab), main menu (play offline / join server, name,
class, team), settings (sensitivity, invert Y, volumes, quality). Accept: keyboard + gamepad navigable,
readable at 1280×720 and 2560×1440.

### 7.19 Save / load
Profile + settings in localStorage (versioned JSON with migration). Match state is server-side only.

### 7.20 Performance systems
LOD, instancing (`InstancedMesh`/`BatchedMesh`), frustum culling (correct bounding spheres), pooling, disposal
discipline (owner-scoped `dispose()`), adaptive pixel ratio, quality tiers, no per-frame allocations.

### 7.21 Debug / dev tools
`window.__cvc` debug hook (ready, fps, local, entities, errors, bookmarks), `tools/probe.mjs` headless probe,
URL params (`?server`, `?lag/jitter/loss`, `?webgl`, `?bots`, `?mode`, `?cls`, `?team`), fly camera + lil-gui
panel (later), camera bookmarks for screenshots.

---

## §8 Architecture rules

### 8.1 Folder structure
See `ARCHITECTURE.md` (live map). Top level: `src/shared` (pure data/contracts), `src/sim` (authoritative rules),
`src/host` (room/session), `src/client` (everything the player sees/hears), `server/` (Node entry),
`tools/` (gates, probes), `tests/` (unit + e2e), `docs/`.

### 8.2 Naming
Files kebab-case; classes PascalCase; functions camelCase; constants UPPER_SNAKE; content ids snake_case.
Events `e: 'fire' | 'hit' | …` in `src/shared/protocol.ts`.

### 8.3 Communication
- Client ↔ authority: only `ClientMsg`/`ServerMsg` from `src/shared/protocol.ts`.
- Sim systems: ordered `SimSystem`s; shared state via `sim.state`; entity components via module augmentation.
- Client systems: `bus` (typed event bus) for net → HUD/FX/audio; direct references only inside a lane.

### 8.4 Shared contracts (lead-owned; change only via the lead)
`src/shared/protocol.ts`, `src/shared/input.ts`, `src/shared/types.ts`, `src/shared/constants.ts`,
`src/sim/sim.ts` (Sim API), `src/sim/entity.ts`, `src/client/views/avatar.ts`, `src/client/core/events.ts`,
`src/sim/systems/movement.ts`, `package.json`.

### 8.5 Boundaries (enforced by `tools/check-boundaries.mjs`)
`src/sim`, `src/host`, `src/shared` must run headless: no `three`, no DOM, no `Math.random()`.
`src/shared` imports nothing from sim/host/client.

### 8.6 Resource management
Every GPU resource has an owner that disposes it (geometry, material, texture, render target). Shared materials
come from the style cache and are never disposed by users. Pools for anything spawned > 1/s.

### 8.7 Performance budgets (60 fps = 16.6 ms)
| Budget | Target |
|---|---|
| Sim tick (authority, 12 players + 16 bots) | ≤ 3 ms (physics ≤ 1.5, AI ≤ 1.5) |
| Client CPU (net + views + anim + fx) | ≤ 4 ms |
| GPU: shadows 2 · world 5 · characters 1.5 · particles 1 · post 1.5 | ≤ 12 ms |
| Draw calls | ≤ 400 |
| Visible triangles | ≤ 1.5 M |
| Fully animated characters on screen | ≤ 24 |
| Snapshot bandwidth per client | ≤ 40 KB/s at 12 players |
| Initial download | ≤ 5 MB gzipped |
| Memory | no growth over a 10-minute soak |

---

## §9 Verification & Definition of Done

**Universal DoD (every task):** `npm run gate` green (typecheck · boundaries · unit · build · e2e smoke) —
lanes working in parallel may use `npm run gate:fast` + their card's proof and leave the full gate to integration;
screenshots named in the card taken with `tools/probe.mjs` **and looked at**; `PROGRESS.md` updated;
committed.

**Milestone DoD:** a human plays the build (offline worker or `npm run server`) and records three separate
verdicts — play feel, visuals, technical — plus the queue-test answer, in `PROGRESS.md`.

**Network DoD (competitive features):** authority path identified; invalid/duplicate/stale input rejected;
lifecycle (spawn, death, respawn, disconnect, late join) tested; behavior checked at emulated 20/80/150 ms RTT
with 0/1/3 % loss (`?lag=`/`?loss=` or Node room tests).

---

## §10 Implementation order — waves and lanes

### Wave 0 — Foundation (lead) ✅
Outcome: walking skeleton end to end — input → worker authority (Rapier KCC) → snapshots → interpolated toon
render → camera → HUD; Node server; gate. Proof: `npm run gate` (4 unit + 2 e2e) and `artifacts/smoke.png`.

### Wave 1 — Parallel lanes (agents, disjoint paths)

**L1 Characters & animation** — owns `src/client/procgen/characters/**`, `src/client/anim/**`,
`tests/unit/characters*.test.ts`, `char.html`, `tools/char-*.mjs`.
Outcome: `createAvatar()` returns procedural, rigged, animated corgi and cat characters per §6 (species variants,
team colors, class gear, weapon prop, face + expressions, locomotion/jump/land/aim/fire/hit/death, spring ears/tail).
Constraints: implement the `Avatar` contract in `src/client/views/avatar.ts` unchanged; style factory only;
budgets §6. Proof: unit tests (tris/bones/grounded/determinism), `char.html` turntable screenshots of every
species × 3 classes, in-game probe screenshot.

**L2 West Yard world** — owns `src/shared/world/**`, `src/sim/world/**`, `src/client/world/**`,
`tests/unit/world*.test.ts`.
Outcome: the West Yard hub at pet scale (≈200 × 200 m): deterministic terrain, house back wall + deck,
fence perimeter, shed, doghouse (Corgi base) and cat-tree tower (Cats base), trampoline jump pads, garden beds,
pool, props and instanced foliage, sky/day-night/fog/shadows; sim heightfield + prop colliders; spawns per team;
world systems (jump pads, water). Constraints: keep `createWorldData()` / `buildStaticWorld()` / `worldSystems()` /
`createWorldView()` signatures; collider = visual. Proof: unit tests (determinism, collider vs height, spawns
clear of props), probe screenshots from 5 bookmarks.

**L3 Combat, weapons, abilities, AI, match** — owns `src/sim/combat/**`, `src/sim/ai/**`, `src/sim/match/**`,
`src/shared/content/weapons.ts`, `src/shared/content/abilities.ts`, `tests/unit/{combat,ai,match}*.test.ts`.
Outcome: authoritative weapons (Assault squeaker rifle first, excellent), lag-compensated hitscan, projectiles,
damage/death/respawn, ammo/reload, abilities (bark blast first), cat AI archetypes with navigation, match modes
`yard-skirmish` and `team-deathmatch` writing `sim.state.match`. Proof: headless tests incl. a 60 s bot-vs-bot
soak with no errors and a completed match.

**L4 Netcode & server** — owns `src/client/net/**`, `src/host/**`, `server/**`, `tests/unit/net*.test.ts`,
`tests/e2e/net*.spec.ts`.
Outcome: client-side prediction + reconciliation for the local player (using `stepCharacter`), smooth correction,
interpolation tuning, input redundancy, server hardening (validation, rate limits), production server serving
`dist/` + WebSocket on one port, reconnect, network-emulation test matrix (20/80/150 ms × 0/1/3 %), headless bot
clients for load. Proof: tests showing prediction error < 5 cm at 80 ms/1 % and a 2-client e2e over `npm run server`.

**L5 HUD, audio, FX** — owns `src/client/ui/**`, `src/client/audio/**`, `src/client/fx/**`,
`tests/unit/{ui,audio,fx}*.test.ts`.
Outcome: comic HUD + menus + scoreboard + kill feed + hit markers + settings; procedural audio + music layers;
pooled FX + onomatopoeia. Constraints: consume `bus` events and `EntityViews`; expose `create*()` factories the lead
wires in `main.ts`. Proof: probe screenshots of HUD states (menu, combat, death, scoreboard), unit tests for pools.

**Lead (integration)** — owns `src/client/main.ts`, `src/client/views/**`, `src/client/camera/**`,
`src/client/input/**`, `src/client/engine/**`, shared contracts, docs, `package.json`. Integrates each lane,
runs the full gate, commits, pushes.

### Wave 2 — The slice (after Wave 1 integrates)
Vehicle Terminal + kart; Ordnance Terminal (kit swap) + Upgrade Cores; Infiltrator kit + Garden edge district;
Maine Coon boss set piece; weather state machine; performance pass; bots polish; menus/lobby.

**Vertical Slice DoD:** West Yard + Garden edge, 2 kits (Assault, Infiltrator), 3 cat archetypes + boss, kart,
3-step objective chain, 20 collectibles, day/night + 2 weather states, adaptive music, full HUD/menus, playable
offline and online with 2+ humans; 60 fps on the reference machine; 0 console errors; bots complete 3/3 soaks.

**Wave 2 as built ✅** — V1 kart + Kart-O-Matic, S1 Ordnance kiosk + Upgrade Cores + 20 Golden Kibble + Squeaker
mission, G1 Garden + concealment + deterministic weather/day-night, B1 Vac-Tank boss (a vacuum mech, not the Maine
Coon mech first sketched), Q1 independent verification (55/100 → P0/P1 fixes). Slice DoD still open: 60 fps on a
real GPU (headless is SwiftShader), 2+ humans online, and the human queue test itself.

### Wave 3+ — Breadth
Remaining districts/classes (Overwatch, Breacher, Warden, Skyraider), `core-rush` mode, RC plane, hosting
(`infra-stack-advisor`), matchmaking-lite (room list), then the continuous quality loop.
The owner directed continuous autonomous building (2026-09-26), so Wave 3 starts before the human queue test; the
test stays the first item in PROGRESS "Human verdicts" and its findings pre-empt any lane.

**Wave 3 lanes** (`docs/sprints/WAVE3_PLAN.md`, validated: no path collisions):
- **C2 combat-2** — Spotter Drone, Dig Charge, Squeak Barrier as authoritative ability entities + views; then bots
  use abilities and play objectives (cores, mission, kiosk).
- **P1/P2 perf** — full-room sim tick p95 ≤ 3 ms (KCC vs terrain); a low quality tier that is really cheaper.
- **D3 districts** — Rooftops (Overwatch perches) and the Garage (Breacher close quarters) in the West Yard.
- **U1 ux** — chat, room browser, first-match tips, quality-change notice.
- **Lead** — M1 Ear Glide in the shared movement (predicted), M2 buff bits in snapshots, integration.

**Wave 3 as built ✅** — all lanes above plus core-rush mode, netcode freeze + catch-up (TCP stall emulation),
deploy prep; K1 character polish (class silhouettes, attitude). See PROGRESS.

### Wave 4 — The adventure (`docs/design/ADVENTURE.md`, `docs/sprints/WAVE4_PLAN.md`)
"The Last Tennis Ball": six district chapters, one kit each, alone with bot pups or in online co-op (rooms are set
up by their first joiner's `?mode=adventure&chapter=`).
- **A1 adventure** — mode, chapter contract, triggers (reach/interact/hold/collect/defeat/destroy/survive), stealth
  alarm, checkpoints (fail forward), captions, chapter picker; chapters 1–2. Then **A2**: chapters 3–6.
- **X1 destruct** — breakable props (garage breach wall, tuna-can stacks) with nav + prediction updates.
- **R1 vehicles** — RC plane from a Rooftops hangar (Skyraider flies it best).
- **E1 boss** — the Siamese sniper elite: a laser-pointer duel mini-boss.
- **Lead** — per-room setup (done), integration, chapter wiring, verification.

**Wave 4 as built ✅**:
- all six chapters (A1: framework and chapters 1–2; A2: chapters 3–6), bot-completable inside par, deterministic;
- X1: destructibles (the Garage breach wall, tuna and crate stacks; nav and prediction open on a break);
- R1: the RC plane from a neutral Rooftop Hangar;
- E1: Madame Pointillé, the sniper elite;
- S2: vehicle and world audio.

Lead:
- `EFlag.Stunned`, the plane HUD, `?boss=<id>`, friendly shots through your own barriers;
- spawn facing held until the first snapshot;
- rams (kart vs stacks, plane vs pets) and direct frisbee hits on vehicles and props;
- Brotli precompression; e2e for core-rush and adventure from the menu.

Q2 (independent verification) is next. See PROGRESS.

### Quality loop (runs forever after the slice)
Capture bookmarks → diagnose with `game-worlds-iteration-coach` → change one thing → gate → before/after →
`LEARNINGS.jsonl` (`game-worlds-knowledge-extractor`). Consistency check of all docs every 3 loops.

---

## §11 Skill routing (load the skill before doing its kind of work)

| Work | Skill(s) |
|---|---|
| Project direction, asset gates, runtime glue | `threejs-stylized-game-director` |
| Look, outlines, post, palette | `threejs-toon-comic-style-system` |
| Terrain, streaming, surface/scatter, sky/fog | `game-landscape-director`, `-terrain`, `-streaming`, `-surface`, `-atmosphere` |
| Frame budgets, post/audio/perf | `game-worlds-vision`, `game-worlds-polish-perf` |
| Props/content placement | `game-worlds-content` |
| "Looks wrong" loops | `game-worlds-iteration-coach` |
| Learnings capture | `game-worlds-knowledge-extractor` |
| Loop, feel, difficulty | `game-design-psychology` |
| Architecture, netcode, pooling | `game-dev-architecture` |
| Planning lanes, DoD gates, velocity | `game-sprint-planner`, `game-sprint-gates`, `game-sprint-metrics`, `game-sprint-director` |
| CI / repo | `game-dev-github` |
| Hero props from AI meshes | `ai-mesh-to-threejs-asset` (license first) |
| Launch/growth (later) | `game-growth-ua` |
| Hosting (later) | `infra-stack-advisor` |

Not installed (referenced by the director skills): `threejs-procedural-characters`,
`threejs-procedural-3d-generator`, `threejs-gaussian-splats` — follow their contracts in-house (§6, §7.9).

---

## §11b Risks & non-goals
- Risk: procedural characters not expressive enough → face rig + expressions + owner scoring loop; AI-mesh
  escape hatch for bosses only.
- Risk: WebGPU availability/perf variance → WebGL2 fallback + adaptive resolution + tiers.
- Risk: netcode feel at high latency → prediction + reconciliation + lag compensation tested at 150 ms.
- Non-goals now: accounts, monetization, matchmaking backend, mobile touch controls, voice chat.

---

## §12 Theme injection guide
Everything theme-specific lives in: `src/client/style/style-tokens.js` (palette/look), `src/shared/content/**`
(classes, weapons, abilities, names, barks), character species parameter tables
(`src/client/procgen/characters/species*.ts`), world prop catalog and district definitions
(`src/shared/world/**`), audio synth presets (`src/client/audio/presets*.ts`) and UI strings. Swapping these
turns the same engine into space, fantasy or underwater without touching `src/sim` systems, netcode or the
renderer. Engine code must not import theme names/colors except through these modules.

---

## §13 Narrative & quest framework
Story slot (owner to supply). Data-driven objectives: `{ id, district, text, trigger: {type, params}, reward }`
with trigger types `reach`, `collect`, `defeat`, `hold`, `interact`, `survive`; comedy barks keyed by events;
set pieces scripted as timed sequences of spawns + camera rails.
