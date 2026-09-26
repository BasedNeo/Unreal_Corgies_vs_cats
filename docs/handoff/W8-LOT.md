# W8 M2 handoff: "The Lot" layout (world-2 lane)

Status: **done for integration.** `createWorldData(seed, 'the_lot')` builds a second battleground. It is the
construction lot next door, at pet scale: 320 × 320 m inside the fences (half extent 160). The corgis hold a
foundation pit and its trenches. The cats hold a spoil heap and its scaffold. Three lanes (Container Canyon, the
open mud middle, the Pipeworks) cross a drainage ditch on dry causeways.

The map is registered for `yard-skirmish`, `team-deathmatch` and `core-rush`. Adventure and boss-rush fall back to
the West Yard. `?map=the_lot&mode=team-deathmatch&autoplay` works, and so does the menu path (MATCH = DEATHMATCH,
MAP ▸ THE LOT, PLAY OFFLINE).

Bots play a 14v14 TDM on it:
- 43 deaths in 65 s, final score 21:22, identical over two runs;
- no bot stuck longer than 1.5 s;
- sim tick p95 is 2.06 ms at load 13 on 4 cores.

The soak passes in all three modes. The only contract edit is the registry entry in `maps.ts`.

## Files
| Path | What |
|---|---|
| `src/shared/world/the-lot.ts` | **new.** `buildTheLot(seed): WorldData` (name `'The Lot'`), `lotFloodlights(data)` (S4 hook: tower `pos` + aim `target`), `LOT_PIPES` (placed pipes, for tests) |
| `src/shared/world/lot/layout.ts` | **new.** Every layout number: pit, heap, ramps, trenches, ditch and causeways, containers, gangway, pipes, pads, roads, mounds, scaffold, spawns, floodlight towers, crane, toilet, gate |
| `src/shared/world/lot/terrain.ts` | **new.** `createLotField(seed)`: raw height (mud undulation + mounds, ruts, pads, the heap, carves) and surface weights. Baked by `terrain.ts` (`bakeTerrainGrid`, `gridHeight`), used read-only |
| `src/shared/world/lot/pipes.ts` | **new.** `addPipe()`: a 12-sided `ring` prim plus one box collider per lathe facet (exact), `pipeFacets()` |
| `src/shared/world/lot/props.ts` | **new.** Prop catalog: site-office container, gangway, cement-bag wall, pallet stack, ammo crate, cable drum, rebar bundle, cone, barrel, tarp skip, floodlight tower, portable toilet, scaffold, banner pole, footing, `slab()` (sloped slab, collider = visual) |
| `src/shared/world/lot/scenery.ts` | **new.** Hoarding (N, E, S) with the site gate, the West Yard's board fence (W), the skyline (West Yard house, big tree and shed; the neighbours' house; rooftops and trees), the tower crane |
| `src/shared/world/maps.ts` | **+ registry entry** (`'the_lot'` in `MAP_IDS`, `MAPS.the_lot`), nothing else |
| `tests/unit/lot-world.test.ts` | **new.** 15 tests: registry and fallbacks, determinism, build time, terrain collider = `height()`, colliders = visuals (boxes, cylinders, pipe facets vs the real lathe geometry, cones, perimeter), palette, spawns, lamps, perches, districts, bookmarks |
| `tests/unit/lot-sim.test.ts` | **new.** 9 tests: nav grid, every lane reachable from both bases, a dry ditch crossing, kart / kiosk / core-pad sites, kart routes base to base; real-KCC traversals of both tunnels, the containers and side doors, the gangway, scaffold deck and nest, and the pallet stair onto a pipe crown |
| `tests/unit/lot-tdm.test.ts` | **new.** 14v14 TDM, 60 s live × 2: kills, stuck, lane traffic, tick p95 |
| `labs/lot.html`, `labs/lot.ts` | **new.** The world lab on any map (default The Lot, `&map=west_yard` for comparisons) |
| `artifacts/lot/*` | Screenshots, the live-TDM render JSON, `soak-lot.json` |

## Layout
Axes as in the West Yard: x east, z south. The corgis hold the north and the cats the south. The layout is
point-symmetric about the origin where balance needs it: pit ↔ heap, canyon ↔ pipes, the three causeways. The map
below is generated from the built world, 10 m per row and 5 m per column.

```
        x -160                          0                           +160
 -150 z |  ............................................................  |   N: hoarding, the neighbours' house beyond
 -130 z |  .............._cccc_x___x_x___FF.....................x......  |   _ foundation pit (-2.4), c corgi spawns
 -120 z |  ............FF_cccc_____x_xx__.F.....................x......  |   F floodlight towers, x footings / crates
 -110 z |  ....n........._cccc_____x_xx__bbb...........................  |   b cement-bag walls (rim, ramp top)
 -100 z |  ..nnnn........_______x__x_xx__..............................  |   pit ramps: vehicle (E), foot (S)
  -90 z |  ...................=......=.................................  |   = communication trenches (-2.0)
  -80 z |  ...............===........=.................................  |     T1 to the canyon, T2 to the middle,
  -70 z |  .............=..g..........=.........................nnnn...  |     T3 across; g gangway to the roof
  -60 z |  ...........b=b..g....xx.....=.........xxx...........nnnnn...  |
  -50 z |  ..........##bb##g..........bbbnnn......xx.............n.....  |   # Container Canyon (2 x 24 m, 10.4 m tall)
  -40 z |  ..........##..##....OO............xx........................  |   OO loose pipe (walk-through cover)
  -30 z |  ..........##..##....OOOnnxx............n....................  |   n mud mounds
  -20 z |  ..................xx...nn..xx..x.xxx........................  |
  -10 z |  ~~~~~~~xx...x...~x~~~~~~~~x......~~~xx~~~~~~.......~~~~~~~~~  |   ~ drainage ditch (0.9 m of water)
    0 z |  ~~~~~~~~~.......~~~~~~xx~~~......x~~~~~~~~x~...x...xx~~~~~~~  |     dry causeways: canyon / middle / pipes
   10 z |  ........................xxx.xx.xx..nn...xx...OOOO...........  |   OOOO the Pipeworks: 2 tunnels x 3 pipes
   20 z |  ....................nn...........xxnnOOO.....OOOO...........  |   xxx pallet stair onto the west crown
   30 z |  ........................xx............OO..xxxOOOO...........  |
   40 z |  ...................xx......nnn............xxxOOOO...........  |
   90 z |  ............................n^SSSSSSSSSSSSSS^^n.......nnnn..  |   ^ spoil heap (+4.6), S scaffold
  100 z |  ............................n^^xSSSSSSSSSkkkk^n........nn...  |     deck +4.4 (9 m), nest +8.8 (13.4 m)
  110 z |  ............................n^xx^^x^^^^xxkkkk^^n............  |   k cat spawns
  120 z |  ............................n^xx^FF^^^FFxkkkk^n.............  |   S: hoarding; the tower crane beyond
```
Rows 50–80 (the open south mud) are left out.

- **The Foundation (corgi base).** A pit 80 × 30 m (x −80..0, z −125..−95), 2.4 m deep, with 65° walls.
  - Inside: 16 spawns on the floor, a banner, tennis-ball ammo crates, and six concrete footings (the foundation
    grid, 1.4 m cover).
  - Exits: a vehicle ramp (east, 13.5°, 10 m wide), a foot ramp (south, 17°, 6 m), and three communication
    trenches (2 m deep, 4 m wide). T1 surfaces inside the canyon's north mouth.
  - Defences: cement-bag walls on the south rim and at the ramp top, plus two floodlight towers.
- **Container Canyon (west lane).** Two site-office containers (24 × 9.6 × 10.4 m).
  - Both ends are open, so you can walk through. Each has a side door opening onto the 11 m lane between them.
  - Two ceiling tubes glow inside each container, and one piece of cover sits against a far wall.
  - A steel gangway (30°) climbs to the east container's roof, a 10.4 m sniper spot on the corgi side.
- **The Mud (middle).** Open wet mud with 6 mounds and 2 loose walk-through pipes. Cover: cable drums, pallets,
  rebar bundles, tarp skips, barrels and cones in point-symmetric pairs. Three haul roads leave twin tyre ruts.
- **The ditch.** It runs along z = 0 across the lot (floor −1.9, water −1.0). There are four `WorldData.water`
  rect zones. The dry causeways are canyon x −106..−68, middle −14..14, and pipes 68..106.
- **The Pipeworks (east lane).** Two tunnels, each three concrete pipes (Ø 6 m, 9 m long).
  - A 1.8 m gap between pipes leaves side windows; concrete inverts keep the floor level through the gaps.
  - A wedge at every mouth leads up to the floor.
  - A pallet stair (1.2 m steps) climbs onto the west tunnel's 5.7 m crown, on the cat side.
- **The Scaffolds (cat base).** The spoil from the pit forms a heap: a flat top at +4.6, a steep north face with a
  ramp, and a gentle west side for karts. It holds 16 spawns.
  - The scaffold is 48 m long on the north edge. Deck 1 is +4.4 (9.0 m absolute), with 0.6 m toe boards for chest
    cover.
  - Ramps lead up at both ends. The crow's nest is +8.8 (13.4 m), reached by a ramp in bay 3.
  - Cat banners and a flag, pallets, tuna-tin crates, and two floodlight towers aimed at the scaffold.
- **Landmarks** (all visual only, outside the fight unless noted):
  - the tower crane south of the lot: 96 m mast, 118 m lattice jib over the cat base, a pallet of cement bags on the hook;
  - the portable toilet by the east hoarding, which is inside the lot and solid;
  - the neighbours' house over the north hoarding;
  - the West Yard beyond its own fence, which is the lot's west edge (its house, big tree and cat shed at their real
    yard positions).
- **Other data.** Six districts (+ The Ditch) for the HUD, and four `perches` (container roof, scaffold deck, nest,
  pipe crown), inert until the N1 links cover them. `bounds` ±156, `killY` −20, `timeOfDay` 0.74. Ten bookmarks:
  the five heroes plus `lot_mud`, `lot_trenches`, `lot_heap_front`, `lot_ditch` and `lot_hook`.

## Numbers
**Build.** The world build is 172–183 ms CPU (257–288 ms wall) in a cold process at load ~19. The West Yard takes
271–291 ms CPU on the same machine. Inside a vitest worker at load 21 it is 540 ms CPU. The fix that got it there:
a JIT warm-up pass over the terrain function, which cut the cold bake from 440 to about 130 ms (see `LEARNINGS.jsonl`).

**Contents and nav.**
- 1875 prims (894 of them beyond 125 m: perimeter and skyline), 265 box colliders (96 are pipe facets),
  40 cylinders, 20 lamps (16 sodium flood heads, 4 container tubes), 4 water zones.
- Terrain grid 329² at 1 m: 216 k triangles, 231 k with the outer ring.
- Nav grid 320 × 320: 92.3 k walkable cells, 97.3 % of them in the main region. It builds in 200–235 ms under load.
- Base-to-base walking route: ~290 m, one A* leg. Kart routes base to base: 289 m and 301 m.

**Tests.** 25 new, all passing. `maps`, `world` and `world-districts` still pass (63/63 in one run).
- Colliders = visuals, worst error per check (limit 0.01 m):

  | Check | Items | Worst error |
  |---|---|---|
  | Box tops on the 3×3 lattice | 161 boxes | < 0.01 m |
  | Cylinder tops | 32 cylinders | < 0.01 m |
  | Pipe lathe vertices against their facet boxes | 8 pipes | < 0.01 m |

- Terrain collider vs `height()`: all within 1 cm. That covers 400 random rays plus 0 misses on a 0.5 m lattice
  (> 20 k rays) over the pit, trenches, ditch and heap.

**14v14 TDM on The Lot** (`lot-tdm.test.ts`, seed 8, 60 s live, best of 2):
- 43 deaths, score 21:22, the same in both runs;
- stuck max 1.5 s;
- tick p50 1.15 / p95 2.06 / max 10.97 ms at load 13.2 on 4 cores;
- bot-seconds by district: The Mud 599, The Foundation 301, open ground 207, The Trenches 207, The Scaffolds 204,
  The Ditch 124, The Pipeworks 31, Container Canyon 26.

**Soak** (a scratch copy of `tools/soak.mjs` with `map: 'the_lot'`, 60 s, repeat 2): SOAK PASS, score 95.

| Mode | Score | Match | Tick p95 | Stuck max |
|---|---|---|---|---|
| yard-skirmish | 96 | 21:2 (wave 3) | 0.92 ms | 0 s |
| team-deathmatch | 94 | 3:4 | 1.08 ms | 0.5 s |
| core-rush | 95 | 0:43 | 1.32 ms | 1.5 s |

0 errors, deterministic, load 18.

**Render cost.** High tier, headless SwiftShader, same build and same tool for both maps.

| View | Draws | Triangles |
|---|---|---|
| The Lot, world only, at the hero bookmarks | 63–110 | 0.31–0.48 M |
| West Yard, world only, overview / center / deck / cats | 79–145 | 0.67–1.39 M |
| **The Lot, live 14v14 TDM** (`qa3-render`, 45 frames) | **p50 413 / p95 436 / max 445** | **p50 0.79 M / max 0.84 M** |
| West Yard, live 14v14 TDM, same tree, same tool | p50 528 / max 563 | p50 1.71 M / max 1.78 M |

"World only" means `labs/lot.html?dummies=0`, the world lab without characters.

The Lot stays well inside the triangle bar. Its draws are over 400 in a live match, but the characters, weapons
and FX drive that, and they are shared by both maps: the world itself is ~60–110 draws. The West Yard is over both
bars on the current working tree, with the other lanes' in-flight work. Characters are the M4 lever (see below).

## Screenshots (looked at)
All shots are from `labs/lot.html`, `&t=0.74&freeze`, headless SwiftShader at 0.15–1 fps. Files prefixed `m2a-`
are the first pass and `m2b-` / `m2c-` the fixed pass.

- `m2b-lot_overview.png`, from beside the crane jib. **Reads:** the pale gravel rims now outline the pit and the
  whole trench network; the canyon, the ditch strips, the pipes and the pallet stair, the hoarding and the
  neighbours' house. **Doesn't:** the fog tuned for the 200 m yard hazes the far third, and the heap is behind the
  camera. In `m2a-` the pit and trenches were invisible.
- `m2b-lot_corgi_base.png`, from the vehicle ramp top. **Reads:** the ramp down into the pit, the footings, the
  banner, a floodlight tower with its four glowing sodium heads, the spawn dummies, the bag wall, and the West Yard
  house against the sun. **Doesn't:** the pit floor is almost black. The terrain material darkens everything below
  y −0.12 as a "pond bed", and there are no floodlight pools yet (M3).
- `m2b-lot_container_canyon.png`. **Reads** best of the five: open ends with glowing tubes, a side door, the lane,
  and the crane and hook framed over it. The containers were black in `m2a-`; they are now light blue-grey and
  khaki. **Doesn't:** the sandbags read as black rubber.
- `m2c-lot_pipe_mouth.png`. **Reads:** a 12-sided mouth frames the mud outside, with a cat dummy silhouetted in the
  tunnel. The `m2a-` / `m2b-` framings looked into the pipe wall.
- `m2c-lot_cat_scaffold.png`, from over the crow's nest. **Reads:** the nest's deck and toe boards, then the lanes
  toward the pit: pallets, skip, drums, the canyon, the pipes and the pallet stair.
- `m2-westyard-overview.png` / `m2-nodummy-wy-*.png`: the West Yard at the same time of day, for comparison. The
  yard is far denser in dressing and has E4's lamp pools. The Lot reads as a large, empty, dark mud field until M3
  lights it.
- `render-lot-tdm-high-{0,1,2}.png`: the live TDM frames. `m2-menu-map-the-lot.png` + `m2-menu-played.png`: the menu
  path, spawned at (−74, −2.4, −123) on the pit floor.

## Known issues
1. **Draw calls in a live 14v14 TDM are 413–445 (bar: 400).** The map is not the driver: it is ~60–110 of them,
   and the West Yard is at 528–563 in the same tree. See M4.
2. **Terrain material (E4, `materials.ts`), two West Yard assumptions:**
   - Beyond `yardHalf = 118` the ground is tinted as a neighbour's lawn (85 %). On The Lot that covers the outer
     34 m band, including the north end of the pit and the east strip.
   - Everything below y −0.12 is darkened as a pond bed. The pit floor, trenches and ditch banks lose their
     gravel and mud tones.

   Snippets 1 and 2 below fix both.
3. **`prim-mesh.ts` (E4): "far" is hard-wired to 125 m.** Prims past it get no shadow and no crease ink. On The Lot
   that is the whole hoarding (152 m) as well as the skyline. Snippet 3.
4. **Water reads as blue slabs.** The ditch zones use the pond material, which has no muddy tint. M3 (S4/E4):
   an optional per-zone tint (snippet 6).
5. **Bots don't climb.** N1 links are hard-wired to the garage `ROOF_ROUTES`, so on The Lot bots stay on the
   ground grid. They cover every lane but never use the scaffold decks, the container roof or the pipe crown. The
   four perches exist; `autoPerch` skips them because there is no link set. Snippet 5 (M5).
6. **Bots mostly fight in the middle.** The Pipeworks got 31 bot-seconds and the canyon 26 against 599 for The
   Mud. Bots take shortest paths; lane goals are an M5 tactics item.
7. **Approximations** (tested and bounded):
   - The cone colliders are inscribed cylinders (`r` 0.29), so there are no invisible walls, but you can clip
     0.3 m into a cone's skirt.
   - The pipe facet boxes are square-ended, while the lathe has 0.12 m chamfers at the mouths.
8. **Materials read dark at dusk.** Bags and the khaki container are close to black without floodlight pools (M3).
9. **Tooling.**
   - Port 5197 was already held by another lane's Vite (PID 16159, E4 scratch config), so I did not touch it.
   - I ran my own Vite on 5297 with HMR and file watching off; other lanes' edits kept reloading the page
     mid-shot.
   - It is stopped by that port.

## Paste-ready snippets (outside my paths)
**1. `src/client/world/world-view.ts`**: pass the map's extent to the terrain material. The West Yard is unchanged:
its bounds give 117 + 1 = 118, today's default.
```ts
const b = data.bounds;
const yardHalf = (b ? Math.max(-b.minX, b.maxX, -b.minZ, b.maxZ) : data.halfExtent) + 1;
const terrainMat = createTerrainMaterial({ ink: opts.terrainInk ?? false, detail: P.terrainDetail, yardHalf });
```
**2. `src/client/world/materials.ts`**: only darken "pond bed" where there is water. Add a uniform, set it to 0 for
maps whose pits are dry. Minimal version:
```ts
// createTerrainMaterial({ ..., bedLevel = -0.12 })  ->  const wet = smoothstep(bedLevel, bedLevel - 0.33, p.y);
// world-view: createTerrainMaterial({ ..., bedLevel: data.map === 'the_lot' ? -3 : -0.12 })   // the ditch water covers its own bed
```
**3. `src/client/world/prim-mesh.ts`**: make "far" follow the map.
```ts
export function buildPrimMeshes(prims, opts: { cell?: number; creases?: boolean; far?: number } = {}) {
  const farR = opts.far ?? 125;
  ... const far = Math.max(Math.abs(p.x), Math.abs(p.z)) > farR;
// world-view: buildPrimMeshes([...], { far: (data.bounds ? Math.max(-data.bounds.minX, data.bounds.maxX) : data.halfExtent) + 8 })  // West Yard: 125
```
**4. S4 floodlights (`src/client/style/floodlights.js`)**: the positions and aims. `lotFloodlights(data)` returns
them from a built world:
```ts
import { lotFloodlights } from '../../shared/world/the-lot';
const floods = createFloodlights({ tier: q });
for (const f of lotFloodlights(data)) floods.add({ pos: f.pos, target: f.target });   // add all before the first frame
root.add(floods.group);  // per frame: floods.update(camera)
```
Seed 1 values, as lamp-bar centre → aim point:

| Tower | Base | Lamp bar | Aim |
|---|---|---|---|
| `flood_pit_west` | pit rim | [−84.53, 22.56, −111.97] | [−58, −2.4, −110] |
| `flood_pit_east` | pit rim | [5.07, 22.66, −120.79] | [−22, −2.4, −108] |
| `flood_heap_west` | heap top | [20.11, 27.24, 123.04] | [26, 4.6, 99] |
| `flood_heap_east` | heap top | [44, 27.24, 123.03] | [44, 4.6, 99] |

Each tower has 4 heads, which are `WorldData.lamps` with `col: 'sodium'` (the glowing lenses). A contract-level
alternative is an optional `WorldData.floodlights?: { pos, target }[]`, filled by `buildTheLot`: one line in
`world-types.ts`.

Crane lamps for M3: the jib tip is roughly (−11.8, 99.4, 71.4), and the apex is 20 m over the mast top
(−30, 116, 188). `towerCrane()` returns `tip` and `hook`.

**5. N1 nav links onto the scaffold, the container roof and the pipe crown (M5).** Generalise `buildLinkSet` step
1. Add `climbRoutes?: { name: string; pts: [number, number, number][] }[]` to `WorldData` and loop over
`[...(rooftops ? Object.entries(ROOF_ROUTES) : []), ...(data.climbRoutes ?? []).map((r) => [r.name, r.pts])]`.
The Lot's routes (standing points, feet). Every point sits on its surface (`surfaceAt`, 0.00 m) with a clear body
above it. N1's per-profile validation has not run on them yet:
```ts
climbRoutes: [
  { name: 'gangway', pts: [[-68.3, 0, -63], [-68.3, 5.2, -53], [-68.3, 10.4, -43], [-71.4, 10.4, -30]] },
  { name: 'scaffold_west', pts: [[1, 4.6, 98.9], [7, 6.8, 98.9], [14, 9.0, 98.9]] },
  { name: 'scaffold_east', pts: [[71, 4.6, 98.9], [65, 6.8, 98.9], [58, 9.0, 98.9]] },
  { name: 'nest', pts: [[28, 9.0, 99.95], [36, 11.2, 99.95], [42.5, 13.4, 99.95]] },
  { name: 'pallet_stair', pts: [[58, 0, 39], [62.4, 1.17, 39], [66.4, 2.37, 39], [70.4, 3.57, 39], [74.4, 4.77, 39], [79.5, 5.68, 38.5]] },
],
```
**6. Ditch water tint (M3)**: `WaterZone.tint?: string` (a palette key, e.g. `'mud'`), used by `createWaterView` as
the shallow colour. Set `tint: 'mud'` on the four `ditch_*` zones.

**7. `PICKUP_LAYOUTS['The Lot']`** (`src/shared/content/pickups.ts`). Heights come from `surfaceAt`. Every spot is
clear of colliders at +0.3 / 0.8 / 1.2 m, and every route point is a clear standing point (scratch-validated). Run
S1's hop search before shipping: the rises onto 1.8 m crates and 2.4 m pallets need the corgi double jump.
Cores are four contested spots. Two are inside the walk-through pipes in the middle. Two are up high: the
container roof on the corgi side and the pipe crown on the cat side.
```ts
'The Lot': {
  cores: [
    { id: 'container_roof', x: -72.2, y: 11.02, z: -24, hint: "on the east container's roof (gangway)", side: -1, route: [[-68.3, 0, -63], [-68.3, 10.4, -42]] },
    { id: 'pipe_crown', x: 79.5, y: 6.3, z: 29, hint: "on the west pipe tunnel's crown (pallet stair)", side: -1, route: [[62.4, 1.17, 39], [66.4, 2.37, 39], [70.4, 3.57, 39], [74.4, 4.77, 39], [79.5, 5.68, 38.5]] },
    { id: 'loose_pipe_w', x: -44, y: 0.93, z: -29.5, hint: 'inside the loose pipe, corgi side of the mud', side: -1, route: [[-51, 0.07, -29.5]] },
    { id: 'loose_pipe_e', x: 44, y: 0.93, z: 29.5, hint: 'inside the loose pipe, cat side of the mud', side: -1, route: [[51, -0.07, 29.5]] },
  ],
  kibble: [
    { id: 'pit_banner', x: -35.45, y: -1.25, z: -112.2, hint: 'on the corgi banner plinth', side: 0, route: [[-38, -2.4, -112]] },
    { id: 'pit_footing', x: -16, y: -0.49, z: -100, hint: 'on a footing block in the pit', side: 0, route: [[-16, -2.4, -97.5]] },
    { id: 'pit_ammo', x: -49, y: -0.08, z: -122, hint: 'on the tennis-ball ammo crate', side: 0, route: [[-49, -2.4, -119.5]] },
    { id: 'flood_ballast_pit', x: -84.1, y: 1.6, z: -112.9, hint: 'on the pit floodlight ballast', side: 0, route: [[-85, -0.05, -109]] },
    { id: 'trench_t3', x: -37, y: -1.45, z: -80, hint: 'in the cross trench', side: 0, route: [[-37, -2, -80]] },
    { id: 'gangway_landing', x: -68.4, y: 10.95, z: -42, hint: 'on the gangway landing', side: 0, route: [[-68.3, 0, -63], [-68.3, 9.24, -46]] },
    { id: 'container_pallet', x: -97.3, y: 1.72, z: -36.5, hint: 'on the pallets inside the west container', side: 0, route: [[-93.5, 0.3, -36.5]] },
    { id: 'rebar_n', x: 24, y: 1.77, z: -12, hint: 'on the rebar bundle (north)', side: -1, route: [[23.2, -0.04, -9.6]] },
    { id: 'ditch_west', x: -40, y: -1.35, z: 0, hint: 'on the ditch floor (wade in)', side: -1, route: [[-40, -0.47, 4]] },
    { id: 'ditch_east', x: 40, y: -1.35, z: 0, hint: 'on the ditch floor (wade in)', side: -1, route: [[40, -0.47, -4]] },
    { id: 'rebar_s', x: -24, y: 1.78, z: 12, hint: 'on the rebar bundle (south)', side: -1, route: [[-23.2, 0.01, 9.6]] },
    { id: 'tunnel_invert', x: 91.5, y: 0.86, z: 23.6, hint: 'in the east tunnel, on the invert between two pipes', side: 1, route: [[91.5, 0, 10]] },
    { id: 'pallet_stair_top', x: 74.4, y: 5.32, z: 39, hint: 'on top of the pallet stair', side: 1, route: [[62.4, 1.17, 39], [66.4, 2.37, 39], [70.4, 3.57, 39]] },
    { id: 'scaffold_deck', x: 54, y: 9.55, z: 98.9, hint: 'on the scaffold deck', side: 1, route: [[70, 4.6, 98.9], [62, 8.12, 98.9]] },
    { id: 'scaffold_nest', x: 46, y: 13.95, z: 99.5, hint: "in the scaffold's crow's nest", side: 1, route: [[26, 9, 99.95], [42, 13.4, 99.95]] },
    { id: 'heap_ammo', x: 50, y: 6.92, z: 122, hint: 'on the tuna-tin crates', side: 1, route: [[50, 4.6, 124.4]] },
    { id: 'mid_pallets', x: 40, y: 2.79, z: 52, hint: 'on the tall pallet stack (south mud)', side: 1, route: [[43.5, -0.09, 52]] },
    { id: 'mid_pallets_n', x: -40, y: 2.91, z: -52, hint: 'on the tall pallet stack (north mud)', side: 0, route: [[-43.5, 0.06, -52]] },
  ],
},
```
**Core-rush pads.** The runtime `corePadSpots()` already picks fair spots: (−34.5, 0, 19.5), the middle causeway
(0.5, −0.05, 0.5), and (34.5, −0.05, −19.5). These are the mud flanks either side of the ditch, perpendicular to
the base axis, so no hints are needed. If a lane-based variant is wanted later, the canyon causeway (−87, 0) and
the pipes causeway (87, 0) are flat, dry and equidistant.

**Kiosk and terminal sites** (runtime, `findTerminalSite` / `findOrdnanceSite`, seed 1):

| Team | Kart-O-Matic | Kart pad | Ordnance kiosk | Where |
|---|---|---|---|---|
| Corgis | (−62.7, −101.2) | (−59.7, −101.7) | (−59, −114) | pit floor |
| Cats | (53.7, 107.5) | (52.2, 110.2) | (65, 108) | heap top |

- Corgi karts leave the pit by the vehicle ramp (east) or the foot ramp.
- Cat karts leave the heap by the gentle west side or the north ramp.
- `lot-sim.test.ts` proves kart routes from both pads to the middle and on to the other base.
- No fixed sites are needed. The Rooftop Hangar (R1) is district-bound and absent here.

**`PROGRESS.md` line** (lead):
`| W8 M2 The Lot layout (world-2) | ✅ ready | 25 tests (lot-world/-sim/-tdm); 14v14 TDM 43 deaths, stuck ≤ 1.5 s, tick p95 2.06 ms @ load 13; soak PASS 3 modes; build ~180 ms; live TDM 413–445 draws / 0.79–0.84 M tris (West Yard same tree 528–563 / 1.71–1.78 M); docs/handoff/W8-LOT.md |`

**`ARCHITECTURE.md`**, under `world/`: add `the-lot.ts + lot/ (layout, terrain, pipes, props, scenery): The Lot (W8 M2)`.

## Next: M3 (atmosphere)
1. Land snippets 1–3 first: the ground is currently mis-shaded and the hoarding has no ink or shadow. Then run the
   hero bookmarks again.
2. Floodlights (snippet 4): four towers, real lights on the nearest 4 at high tier. Pools on the pit floor and the
   scaffold deck will fix the "black base" read.
3. Rain by default on The Lot: a per-map weather bias, so storm and rain are more likely. Wet ground plus
   puddles in the ruts; the ruts are already mulch-dark and flat-bottomed, where the material puts puddles.
4. Crane lamps: red aviation lights at the jib tip and apex (positions above). Warm cab glass.
5. Muddy ditch water (snippet 6).
6. Fog distance scaled by `halfExtent`: at 0.74 the far third of a 320 m lot is lost.
7. Dressing density: M4-safe instanced clutter. Rubble, spoil lumps, bag stacks, rebar starters in the pit,
   debris netting on the scaffold.

## Next: M4 (perf)
1. **Live-TDM draws (413–445).** Characters, weapons and FX dominate, as the West Yard at 528–563 in the same
   tree shows. Candidates:
   - character part merging, or instancing the shared rigs' static gear;
   - dropping crease ink on characters past ~35 m;
   - a draw cap on FX.
2. **World cost is small: ~60–110 draws** and 0.3–0.5 M tris at the heroes. Remaining world levers:
   - the far bucket (snippet 3 keeps it one mesh);
   - water zones: 4 draws, which could be 1 merged mesh;
   - skyline prims into the far bucket without the ink hull.
3. **Low tier.** The terrain is 216 k tris at 1 m. A 2 m LOD for chunks past 120 m, render only (the collider
   stays exact), would halve it. The skyline and crane lattice could be dropped on low.
