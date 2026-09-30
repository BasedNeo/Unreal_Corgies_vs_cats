# KNOWLEDGE — how Corgis vs Cats is built (human explanations)

Short, verified explanations of the techniques this project relies on: what each one is, the numbers that matter,
and how it failed before it worked. Raw lessons with evidence live in `LEARNINGS.jsonl`; lane reports are in
`docs/handoff/`. Updated at milestones (game-worlds-knowledge-extractor). Last update: Wave 9 (Base Assault, throwables, squads,
The Lot finished, readability, Q4).

---

## 1. The weathered toon material (style factory v2, S4)
**What.** Every mesh still gets its material from `toon()` (`src/client/style/style-webgpu.js`). Since W7 that returns a
`HardenedToonMaterial`: still a `MeshToonNodeMaterial`, so the ink-outline hull and the style audit keep working. It
carries its own TSL lighting model and procedural weathering; no textures anywhere.

**Lighting.**
- A soft 4-band ramp with a low floor. v1 lit every back face at 42 %, which read as "plastic".
- Per-light Blinn–Phong specular, driven by a per-pixel roughness.
- A sky reflection that needs no environment map: the sky's zenith, horizon and ground colours, looked up by
  reflection direction and weighted by a roughness-aware Schlick Fresnel, `F = F0 + (1 − F0)(1 − cos θ)^5`.

**Weathering.** Procedural TSL masks in world space:
- grime: broad soft dirt, rare hard blotches, vertical wall streaks;
- edge wear from screen-space curvature (lighter chipped edges);
- a mud band near the local floor;
- sun-bleach.

**Wet.** The weather's `wet` darkens porous albedo and pulls roughness down to a sheen:
`rough_wet = rough × 0.55 + 0.08`. Flat faces with `puddle > 0` mirror the sky and the floodlights.

**Parameters that matter.**
- `surface` presets (fur, cloth, armour, metal, weapon, ground, foliage, water).
- A per-vertex `surface` vec4 (rough, metal, grime, wear), so one merged character mesh can mix fur, plates and metal
  in **one draw**.
- A per-tier detail level:
  - low: ramp + wet + sky reflection only;
  - medium: + specular, one grime octave, wear, mud, puddles;
  - high: + a second octave, streaks and specular anti-aliasing.

**How it failed first.**
- **Far speckle.** Noise must fade with the pixel footprint (the screen-space derivative) or distant siding sparkles.
- **"Dalmatian" dirt.** Hard-edged blotches everywhere; the fix was a mostly soft octave with rare hard blotches.
- **A wet lawn that read as snow.** The wet sheen was a mirror; it needs to be a sheen.
- **Program cache.** three r186 caches node programs by type + node children only. Any per-material variant (detail
  level, attribute, puddle) must be part of the cache key, or materials share the wrong program.

## 2. Floodlights: a few real lights, many fake ones (S4, E4)
**What.** Forward lighting pays for every light on every lit fragment, and changing the light count recompiles every
material. So each floodlight gets a lamp glow, a halo and a **fake ground pool** (an additive disc on the ground). All of
them together cost 3 instanced draws. Only the nearest few get a real `SpotLight`: 4 on high, 2 on medium, 0 on low,
moved each frame without allocating. The count is fixed at build.

**Failure.** An additive decal with the default `fog = true` drew a lit rectangle over its whole quad, because fog mixes
toward the fog colour even where alpha is 0. Fake pools and decals need `fog: false`, or a fog-aware alpha.

## 3. Dusk fog you can see through from above (S4)
**What.** Exponential-squared distance fog, plus a ground-haze layer with density `exp(−y / 7 m)` **integrated along
the view ray**, not looked up at the fragment's height. Haze pools in low ground and thickens in rain, while high
cameras (overview, spectators) look down through it instead of into a grey sheet. The sun is capped at 42°, so the
light always rakes.

## 4. Armoured characters inside a triangle budget (K2)
**What.** Veteran armour (plates, straps, pouches) on the same 47-bone procedural rig, within 6,000 hero / 3,500 NPC
triangles.

**How it was paid for.**
- Culling geometry nobody can see: skull triangles whose three corners sit inside the helmet or hood volume.
- Cheaper X-eyes, 3-sided rims and straps.
- Fewer segments on cheeks and pupils.
- X3's hard-surface guns built from boxes and prisms instead of superellipsoids (the kit budget includes the weapon).

**Readability rules, measured by tests.**
- **Team read:** ≥ 5 % of a character's visible cells in the team hue, from any angle. Markings one vertex row wide
  fail the metric and render as a soft gradient; make them at least two rows.
- **Class read:** the K1 silhouette distance (Jaccard between class masks). Common armour and global proportion
  changes *shrink* it, so shared armour stays within ~3 cm of the body and each class's signature shape is enlarged.

**Open.** K3 lifted the under-suit's value (luma 35 → 71 up close), but at 35 m under dusk the pets still sit on the toon
ramp's floor: a 4× lighter suit only moved the lineup from 38 to 41. At range, readability is a lighting job, not a colour job. P4 proved it: a distance-graded
rim + fill term on character materials only, plus a dusk fill from the sky's anti-sun light, took the 35 m lineup from
luma 39 to 70 and the team hue from 7.9 % to 13.1 % with no new light and no new draw. In storm, characters shed 60 %
of the fog and the grade protects the two team hues (team read 0.1 % → ≥ 6.7 %).

## 5. Combat feedback that costs almost nothing (X3)
**Surfaces.** `fx/surfaces.ts` classifies an impact point from WorldData (prop `type` keywords, cylinders, water,
destructibles, terrain) into dirt, grass, sand, stone, metal, wood, water or soft. It is grid-accelerated and
allocation-free: 200 k classifications allocate < 64 KB.

**Timing.** Hitscan impacts read best when sparks, the hole and the ricochet sound arrive **when the tracer does**:
`impactDelay(distance) = distance / tracer speed`, shared by FX and audio, so they stay in sync.

**Pools.** Bullet holes and scorch go in a capped ring (64 / 40 / 16 by tier) drawn in 1 instanced call; the oldest
fades out first. Muzzle and blast lights come from a fixed pool (2 / 1 / 0).

**The first frame.** Network events arrive between frames. Without `freshFirstFrame`, a flash had aged a whole frame
before it was first drawn and looked weak.

**Colour space.** Particle colours written straight into `colorNode` are taken as linear, so palette hex needs an
sRGB → linear conversion, or the effects look washed out.

**Measured.** A 12-shooter firefight costs 0.22 ms of CPU per frame, 4 draws and 1.65 B of heap per shot.

## 6. Authoring battlefields without breaking the game (E4, world-2)
- **Collider == visual.** Sample standing surfaces (3 × 3 per box, 5 per cylinder, the highest hit) and compare them
  with the rendered top; the worst allowed error is 1 cm. Sampling exactly at ±0.8 of the half extents hits seams
  between abutting boxes and slanted plates, so jitter the samples.
- **Terrain stamps.** The `bowl` op is absolute (the floor goes to −depth in world height). Craters on slopes need the
  relative `hole` + `raise` ops.
- **Hidden keep-outs.** Scripted, straight-line vehicle routes in tests (the ch3 getaway, random-drive starts) are as
  real as nav paths. New props must clear them. Make them explicit tests.
- **Cold-build cost.** A per-seed terrain height closure took 440 ms cold, about 60 ms after a JIT warm-up pass on a
  small grid.
- **Nav.** The 1 m nav grid is terrain height plus a capsule probe 0.45–1.53 m above it. Bot high ground must be terrain,
  or sit under +0.45 m, or have explicit climb links.

## 7. Many maps, one engine (W8 M1)
- A registry (`src/shared/world/maps.ts`): `MAP_IDS`, `MAPS[id].build(seed)`, the modes each map can host.
- Every untrusted id goes through `sanitizeMap` / `mapForMode`, so a room never names a map it isn't running.
- The welcome carries `map` + `mapSeed`. The page builds its world view before it knows the room's map and reloads into
  the room's world on a mismatch. `worldReloadSearch` never loops: a page that already asked for that world stays put.
- The view's constants follow the map (terrain edge, far-prop radius, `WorldData.bedLevel`), so the West Yard's numbers
  stay exactly the same.

## 8. Running a parallel agent studio safely (lead)
- **Paths aren't the only dependencies.** Two lanes with disjoint paths can still depend on each other: K2's triangle
  budgets were measured with X3's lighter guns, and K2 alone failed 2 of its own tests on HEAD. Before landing, **trial
  each lane on a clean copy of HEAD**, and land in dependency order (S4 → K2 + X3's weapons → the rest of X3 → E4).
- **Verify the commit, not the tree.** `tools/verify-commit.mjs <sha> --e2e` exports the commit and runs typecheck,
  boundaries, unit, build and the acceptance e2e specs. Push that exact SHA only on PASS. The e2e list must include
  every acceptance spec: the locker spec was once missing from it.
- **Budgets need their conditions.** A draw or triangle number means nothing without the character count and the tool:
  301 draws in a 4v4 TDM and 413 at 28 characters are not the same measurement.
- **Chaotic bot statistics.** Kart-ram counts flip with any world change. Before redesigning around one, A/B it against
  a reverted copy. Gate on a pooled sample (6 matches), and track the rate as a design metric.
- **Timing tests on a shared box.** `process.cpuUsage()` counts every vitest worker thread, so CPU-per-tick inflates
  under load too. Scale timing limits by `loadavg / cores` (≥ 1) and keep the strict limit when the machine is idle.
- **A shared LEARNINGS.jsonl.** Lanes append in their own order. Stage "HEAD + this lane's lines" (a set difference),
  never the whole working file.

## 9. An objective mode with no protocol change (W9 G4a, G4b)
**What.** Base Assault is authoritative from end to end, and it adds no message and no field.
- **Snapshot:** each team's ball, stand and capture ring are ordinary prop entities in the snapshot. Their seed says
  which is which; their `weapon`, `ammo` and `hp` fields carry the state, the carrier's id and the return countdown.
- **Events:** the existing `score` and `pickup` events.

**What it takes to hold.**
- **Carried state must survive every way the authority moves a living character:** the out-of-bounds guard, the kill
  plane, a stall's catch-up and a kit swap, not only death.
- **An invariant checked after every tick of every test** ("exactly one ball per team, never two carriers") is what
  caught the edge cases.
- **Prediction has to see any authority flag that changes movement.** The carrier's 0.75× speed was invisible to the
  predictor until it copied `EFlag.Carrier` from snapshots. After that the error was 0.

**Bots.** Objective bots that each chase the goal alone never score: 7–11 steals and 0 captures per match, because
every lone thief died by the enemy spawn.
- **Team roles** (attack, carry, escort, defend, return, chase) are re-planned every 0.5 s with hysteresis.
- **A rally point** 35 m short of the stand, then a group storm, turned steals into captures.
- **One override above the FSM modes** ("carriers run home") works where patching a single mode failed.

## 10. An honest throw preview (W9 X4)
- **One integrator step, shared.** The authority and the client use the same step function, with a pluggable contact
  query, and the client's world query is collider-exact (the terrain's own triangles, not a smoothed height).
  The preview and the real flight then agree to under 1 mm at the landing point, on both maps.
- **Button edges need care.** Edge-detecting a button from `prevButtons` is unsafe for any button the Room's stall
  replay doesn't treat as a combat button: a press or release inside a catch-up batch can vanish. Track the edge
  yourself, and list the button in `COMBAT_BUTTONS`.
- **Balance as a soft counter.** 70 at the centre, so the frailest class keeps 20: a grenade opens a kill, it never
  makes one. A fuse of 2.2 s leaves the target 0.5–1.6 s to react after it lands.
- **Q4's lesson for bots:** a planner that aims at where a cluster stands works only while the cluster holds still.
  In Base Assault the targets had sprinted a median 19 m away by the time the fuse went off (1 blast in 35 hit).

## 11. Readability at range is lighting, not colour (W9 K3, P4)
At 35 m under the dusk rig a pet is 20–30 px, mostly ink, and seen from behind it sits on the toon ramp's floor.
- **Colour didn't carry it.** K3 lifted the under-suit's luma from 35 to 71, and the 35 m lineup moved from 38.4 to
  only 39.2.
- **Light did.** P4 added a distance-graded rim + fill on character materials only (no real light, no extra pass) and a
  dusk fill from the sky's anti-sun light. The lineup went to 70, and the team hue from 7.9 % to 13.1 %.
- **The dark bookmarks were backlit views,** so ambient light barely moved them (it lands on the ramp's floor band).
- **In storm, fog erased the team read** (0.1–0.4 %). Characters shed 60 % of the fog, and the grade protects the two
  team hues: ≥ 6.7 % per species.
- **A metric trap:** changing a colour next to a team marking can break the team-read metric, because edge triangles
  average the two colours.

## 12. A map's defaults are gameplay (W9 L3)
- **Weather.** Opening The Lot in rain at tick 0 made the soak's skirmish miss its match: wet ground is slippery and AI
  sight drops. The per-map weather bias now opens overcast and brings the rain after 1.3–1.8 min. Every weather function
  takes a seed (the old schedule, bit-identical) or the world.
- **Light.** A light tuned for a 12 m pole, scaled by inverse square onto 33–39 m towers, clipped the stepped ramp to
  white. The fix was a gain on top of the physical scale.
- **Lanes.** Shortest-path bots crowd a big map's middle (Canyon 26, Pipeworks 31, Mud 599 bot-seconds). A pure lane
  module (a lane per life, hashed from seed, id and life) with a 3-line hook took the side lanes to 0.36 / 0.38 of the
  Mud.

## 13. Verifying bot statistics and landing lanes safely (W9 Q4, lead)
- **Mirror the map before blaming a mechanic.** The West Yard's corgi side won Base Assault 25 : 12. With equal
  species speeds the lean stayed (27 : 13); with swapped sides it flipped (6 : 24). Line-of-sight exposure on the run
  home was the cause.
- **Backfill by state, not by list order.** `fillBots` removed a team's newest bot, which was sometimes the ball
  carrier.
- **Content counts are pinned in many test files.** Adding a room mode broke two tests (the Lot's mode list, one
  first-win unlock per mode); a new look pack then broke a third, in the locker tests. Run the whole unit suite on a
  trial tree before verifying, not only the suites that look related.
- **Two lanes in one file.** Build the committed version from HEAD plus the landing lane's hunks. The other lane's lines
  stay in the working tree for its own landing.
- **Timing tests under parallel vitest forks:** warm the JIT, then take the fastest of several batches. The
  1-minute load average lags bursts: one run read 4.5 ms for code that costs 0.18 ms warm.
- **A container restart kills processes, not files.** Commits, lanes' edits and scratch folders survived; verifies and
  measurements had to be re-run, and the stopped lanes resumed with their own context.


## 14. Depth without new plumbing (W10 A7, U3, AU2, P5, N3)
- **A light can stay out of a room without a shadow map.** Give the lighting model a per-fragment "open" factor from
  a small uniform array of interior boxes (tunnels, containers), tested at a point 0.45 m in front of the surface, and
  scale only the fill by it. No new light, pass or program variant. The loop runs zero times on a map without
  interiors. P5: a pipe mouth went from 43.6 to 23.6 luma at dusk.
- **An exposure lift tuned for dusk re-lights the whole day.** A match starts in daytime (t 0.40–0.46), so a global
  1.25 hit the common case (+15 to +34 %). Drive exposure from the time of day instead (a ramp: 1 at dusk, night and
  storm; 0.78 by 16° of sun).
- **A grey storm view from above is fog, not light.** At 114 m the camera looks through 200–300 m of air. Thin the
  weather's extra fog density for high cameras only: contrast went 18.8 → 23.5, and player views are unchanged.
- **Credit that no event names can still be exact.** The roster's authoritative score minus the score the client can
  attribute from events leaves the rest, such as who returned the ball. U3's awards need no protocol change.
- **Warnings mask under weather, not guns.** A storm's rain bed was the main masker at 2–5 kHz. Measure a cue's
  headroom in its own band against the loudest continuous layer. AU2 renders and measures audio offline in the Node
  unit suite, with a small Web Audio renderer that matches Chromium's timing.
- **Thin props need exact rasterization in the nav grid.** A probe at each cell centre misses a 0.2 m beam that
  crosses the cell off-centre. Close any cell whose body column a thin prop's box crosses (box-vs-box SAT). When a
  change must leave a map untouched, prove it with match digests, not with statistics within noise.
- **Score a mode the way the game scores it.** The Base Assault bench reported the horn winner, not first to 3, and a
  first scoring pass got same-tick 3 : 3 draws wrong. `tools/qa5-ba-sum.mjs` groups same-tick captures as the sim does.
  An independent verifier should re-derive the result from the rule, not from the tool's summary line (Q5).
- **A chapter on a second map needs the map rule in the runner too.** A sim builds one world, so the runner loads
  only chapters whose map is its own, and online rooms advance along their own map.

---

## Proposed skill updates (evidence-backed; the skills are read-only here, so apply them via skill-creator)
1. **threejs-toon-comic-style-system**, a new "Weathered / hardened variant" section:
   - noise LOD by pixel footprint;
   - wet = roughness × 0.55 + 0.08, never a mirror;
   - fixed light counts (changing the count recompiles every material);
   - fake light pools need `fog: false`;
   - ground haze integrated along the view ray;
   - put every material variant into the node-program cache key.

   Evidence: S4's iterations 1–7, `artifacts/s4/`.
2. **game-sprint-gates**, add under "Budgets and statistics":
   - record the character count + tool with every render budget;
   - gate chaotic bot statistics on pooled seeds after an A/B against a reverted copy;
   - scale timing gates by machine load.

   Evidence: 4v4 vs 14v14 draw counts; the ram A/B (6 vs 3 over seeds 1–6); the N1 tick test at p95 3.60 ms, load 29.
3. **game-sprint-director / planner**, add a rule:
   - "Declared paths catch file collisions, not logical ones. Before landing, trial each lane on HEAD and land in
     dependency order. Also check that parallel tasks don't need the same module under a different name."

   Evidence: K2 depending on X3's weapons; X4's bot throws needing `tactics.ts`, which G4b owns (fixed with a separate
   `ordnance-ai.ts`).

### Wave 9 proposals (evidence-backed; apply via skill-creator)
4. **threejs-toon-comic-style-system**, under "Things that go wrong": "Characters read as silhouettes at range under a
   dark rig → it is a lighting job, not a colour job: add a distance-graded character-only rim/fill term and a sky fill;
   protect team hues in the grade; cut fog on characters in storm." Evidence: K3 (suit luma ×2, lineup +0.8) vs P4
   (lineup 39 → 70, team hue 7.9 → 13.1 %).
5. **game-sprint-gates**, under "Budgets and statistics": "Before attributing a one-sided bot statistic to a mechanic,
   replay the same seeds on a mirrored map (swapped spawns and bases)." Evidence: Q4's 25 : 12 → swapped 6 : 24.
6. **game-design-psychology**, under objective modes: "Solo objective bots never finish the objective: give teams roles
   and a rally point before the objective." Evidence: G4b, 7–11 steals and 0 captures per match without it.

### Wave 10 proposals (evidence-backed; apply via skill-creator)
7. **threejs-toon-comic-style-system**, under "Things that go wrong":
   - "Sky fill leaks into tunnels and containers": use a per-fragment interior-box mask on the fill term, not a
     shadow map.
   - "The whole day is too bright after a dusk exposure lift": drive exposure from the time of day.

   Evidence: P5, `docs/handoff/P5.md`.
8. **game-sprint-gates**, under "Budgets and statistics": "Audio is gated by measurement. Render the mix offline and
   gate each warning cue's in-band headroom over the loudest continuous layer, not over the guns." Evidence: AU2's
   fuse tick went from −23 dB to +4 to +13 dB.
