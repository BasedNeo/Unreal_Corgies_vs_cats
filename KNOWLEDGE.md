# KNOWLEDGE — how Corgis vs Cats is built (human explanations)

Short, verified explanations of the techniques this project relies on: what each one is, the numbers that matter,
and how it failed before it worked. Raw lessons with evidence live in `LEARNINGS.jsonl`; lane reports are in
`docs/handoff/`. Updated at milestones (game-worlds-knowledge-extractor). Last update: Wave 7 (HARDENED) + Wave 8 M1–M2.

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
ramp's floor: a 4× lighter suit only moved the lineup from 38 to 41. At range, readability is a lighting job (a rim or
fill light), not a colour job (P4).

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
