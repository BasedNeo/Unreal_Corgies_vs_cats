# Vision — The Lot (world expansion, Wave 8)

One-line fantasy: **the construction lot next door, at pet scale, in the rain at dusk.** Two armies of
battle-hardened pets have dug in among the neighbours' site. The corgis hold the half-dug foundation; the cats
hold the scaffolding and pallet stacks. Floodlights hum over wet mud, and the tower crane looms over everything.

## Reference moods
Describe, don't copy: the owner's mood board `docs/design/refs/*`, and Conker: Live & Reloaded's multiplayer bases.
- Dusk under a low storm sky; sodium floodlight pools on wet asphalt and mud; rain streaks; puddles that mirror
  the lights.
- Distant silhouettes of the crane, light towers and the house's back fence (the West Yard) for context.
- Camera height stays pet-level (≈ 1.2 m characters). The world is backyard ×4 like the West Yard.

## Why a construction lot
The mood board is an industrial dock, but at ×4 pet scale a real shipping container is ~48 m long and a dock
crane ~160 m tall. A building site next door keeps the same mood at a scale pets can fight in:
- **Two site-office containers** (≈ 10 m tall at pet scale) are bunker blocks you can enter.
- **Concrete drainage pipes** are tunnels.
- **The foundation grid** is a trench network.
- **Pallet stacks and scaffolding** are the cats' high ground.
- **Cement-bag walls** are the corgis' sandbags.
- **Background landmarks:** a tower crane, floodlight towers and a portable toilet. Big, but outside the fight.

## Hero moments (camera bookmarks, fixed for the iteration loop)
1. **`lot_corgi_base`**: the corgi forward base in the foundation corner under two floodlights: cement-bag walls,
   the team banner, the ammo crates, rain.
2. **`lot_container_canyon`**: the lane between the site-office containers, looking toward the crane.
3. **`lot_pipe_mouth`**: the view out of a concrete-pipe tunnel onto the muddy middle.
4. **`lot_cat_scaffold`**: the cat base on the scaffolding and pallet stacks, looking down the lanes.
5. **`lot_overview`**: a high overview from the crane jib; the West Yard fence in the distance.

## Quality bar
The same image system as HARDENED (`docs/design/HARDENED.md`). 60 fps on a mid laptop at the high tier, and a
readable firefight at 35 m.

**Size:** half extent 150–170 m (a ~320 m square, ~2.5× the West Yard's area); fog and light hide the far edge.

## Architecture (fits the existing, largely map-agnostic engine)
- **World data:** `src/shared/world/the-lot.ts` → `buildTheLot(seed): WorldData` (name `'The Lot'`), built from
  the same pieces as the West Yard:
  - terrain grid with stamps: foundation pit, trenches, mud mounds, a drainage ditch;
  - props / cylinders (colliders) and prims (visuals);
  - fences, lamps, bookmarks, spawns, districts;
  - `WorldData.water` for the ditch and puddles.
- **Map registry:** `createWorldData(seed, map = 'west_yard')`, with a `MAPS` list in shared content.
  - Rooms take `?map=` from their first joiner, sanitized against the registry like `?mode=`.
  - `RoomListing.map`; the worker and server pass it through; the client builds the world view from whatever
    WorldData it gets.
  - The menu gets a MAP picker for PvP modes. Adventure stays on the West Yard.
- **Gameplay reuse:**
  - core-rush pads, kiosk and terminal sites, pickups and bots' nav/links are derived from WorldData;
  - PvP modes (TDM, core-rush, skirmish) run on The Lot unchanged;
  - kibble and core layouts get a `'The Lot'` entry in `PICKUP_LAYOUTS`.
- **Later:** a base-assault mode (steal the enemy's squeaky tennis ball from their base: Conker-style colours
  capture), Wave 9.

## Frame budget (60 fps, 16.6 ms, high tier, mid laptop)
| Pass | ms |
|---|---|
| Shadows (1 sun map, tight box) | 2.0 |
| Opaque world (merged props per cell, instanced clutter) | 5.0 |
| Characters + weapons | 1.5 |
| Rain, FX, decals | 1.0 |
| Water / puddles / wet sheen | 1.0 |
| Post (grade, bloom, grain) | 1.5 |
| Headroom | 4.6 |

Triangles ≤ 1.5 M and draw calls ≤ 400, as everywhere. The sim tick p95 stays ≤ 3 ms with 28 characters; the
nav grid is larger, but built once per world.

## Techniques (named; see the skills)
- Terrain stamps (flatten, trench, crater, mound) on the height grid (`game-landscape-terrain`).
- A wet-mud / asphalt / gravel TSL material with puddle masks and a wet specular from the weather `wet`
  (`game-landscape-surface`, S4's weathered factory).
- Height fog and aerial perspective; floodlights as a few real spot or point lights plus fake light pools
  (emissive decals and cones) for the rest (`game-landscape-atmosphere`, `game-worlds-polish-perf`).
- Rain streaks as instanced GPU particles around the camera; puddle ripples (S4).
- Static props merged per cell with LOD; clutter instanced; the crane is a low-poly silhouette with blinking
  lamps (`game-worlds-content`).

## Milestones
- **M1 — Multi-map plumbing**: registry, `?map=`, rooms, worker, client and tests; the West Yard unchanged.
- **M2 — The Lot layout**: terrain, big props, spawns, both bases, lanes, colliders = visuals, nav valid; bots
  play TDM on it.
- **M3 — Atmosphere**: rain by default, floodlights, wet ground, crane and landmarks, hero bookmarks shot.
- **M4 — Perf**: budgets at the hero bookmarks and in a live TDM; low tier trimmed.
- **M5 — Gameplay**: kiosks, terminals, pickups and pads placed; karts and plane routes; nav links onto
  containers and scaffolds; soak PASS on The Lot.
- **M6 — Base assault mode** (Wave 9).

## Non-goals
- Streaming open world.
- An ocean (the ditch is a still-water strip).
- Destructible containers.
- Human-scale anything.
- Copying Conker's maps or any dock's layout.

## Risks
- **Draw calls from many props:** merge per cell, instance the clutter.
- **Light count** (forward lighting): ≤ 6 real lights; the rest fake.
- **Nav/physics on a bigger grid:** measure the build time and tick.
- **Readability in rain and dark:** team signal colours and rim light stay strong.
- **Headless verification at 1–4 fps:** judge by screenshots and numbers.
