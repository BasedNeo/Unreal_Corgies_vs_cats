# ARCHITECTURE — live map (update when structure changes)

```
index.html                         client page → src/client/main.ts
server/                            Node authority (lane L4)
  index.ts                         dev WebSocket server (npm run server, ws://localhost:8787)
  prod.ts                          one port: static dist/ + WebSocket at /ws (npm run start / server:prod)
  app.ts rooms.ts                  connection handling, multi-room (?room=), validation, rate limits, timeouts
  static.ts config.ts              static file serving (MIME, gzip, ETag, traversal guard), env config
src/shared/                        PURE contracts + data (runs everywhere; no three/DOM/Math.random)
  constants.ts                     tick 60 Hz, snapshot 30 Hz, interp delay, gravity
  types.ts                         Team, Species, CLASS_IDS, EntityKind (…Boss, Terminal), Anim, EFlag (…Mounted, Busy)
  input.ts                         InputCmd (+ rt lag-comp tick), Btn bits, sanitizeInput
  protocol.ts                      ClientMsg/ServerMsg, EntityState pack/unpack, MatchState, GameEvent
  rng.ts  math.ts                  mulberry32/hash; angles, damp, view dirs
  content/                         theme data: classes, weapons (+ AIM_RAY), abilities, vehicles, bosses,
                                   terminals (vehicle + ordnance kiosks), pickups (cores, kibble), objectives
  world/                           WorldData contract (world-types), West Yard + Garden builders, terrain,
                                   queries (height/surface/concealment), weather/time-of-day from tick, kit;
                                   maps.ts: the map registry (MAP_IDS, mapForMode, mapsForMode; W8)
                                   the-lot.ts + lot/ (layout, terrain, pipes, props, scenery): The Lot (W8 M2); WorldData floodlights /
                                   climbRoutes / bases / weatherBias (W9 L3)
                                   fortifications.ts (W7 E4): the Yard War front as data: both forward bases
                                   (kibble-sack walls, MG nest, bird-table watchtower, flag, armory, motor pool,
                                   floodlights, hedgehogs, barricades) plus trenches and craters; BattleLayout
                                   (battleOf) feeds the client dressing
src/sim/                           AUTHORITATIVE simulation (worker / Node / tests / client prediction)
  rapier.ts entity.ts sim.ts       Rapier init + layers · SimEntity · Sim (ordered systems, spawn, snapshot, events)
  systems/                         movement.ts stepCharacter (shared with prediction) · core.ts (physics step, kill plane)
                                   index.ts order: ai 100 · interact/boss 150 · vehicles 190 · move 200 ·
                                   world 250 · physics 300 · combat 400-700 · kill plane 650 · match 800
  world/                           buildStaticWorld (trimesh terrain + prop colliders), world systems + stepWorldEffects
  combat/                          weapons, lag-compensated hitscan, projectiles, damage, lifecycle/respawn, abilities;
                                   listeners for layers that import combat: addBlastListener (blasts, after characters)
                                   and addProjectileHitListener (non-explosive direct hits on a collider: vehicles,
                                   destructibles); friendlyShotPass lets a team's shots through its own barriers/drones
  ai/                              brain (HFSM, perception, aim), archetypes, nav (1 m grid A* + N1 decks; shared grids =
                                   W10 N3: thin props (beams, posts, poles ≤ 0.2 m) are rasterized into the grid exactly
                                   static world only, per-sim kiosk fixtures and X1 blockers)
  match/                           yard-skirmish (waves) · team-deathmatch
  vehicles/  boss/                 Wave 2 lanes (Mower Kart + terminals; Vac-Tank boss) · boss/ also the sniper elite
                                   (E1: sniper.ts perches/dot/shot/leaps, hairball.ts shared lob); ?boss=<id> → Room
  vehicles/plane*.ts pilot.ts      R1 RC plane: pure flight step (plane.ts), order 191 seats/gun/damage/crashes
                                   (plane-systems.ts), scripted pilot (pilot.ts); common.ts = kart+plane helpers, stun
  interact/                        order 150: Ordnance kiosk kit swaps, Upgrade Cores + buffs, Golden Kibble,
                                   Squeaker mission chain (folded into MatchState by match/)
  combat/ability-*.ts              Spotter Drone / Dig Charge / Squeak Barrier entities (EntityKind.Ability)
  combat/ordnance.ts               W9 X4 throwables (order 455 flight + blast, 805 lifecycle): one carried (EFlag.Ordnance),
                                   launched from the sim's own aim on the Throw release; one integrator step shared with the
                                   client preview (shared/content/ordnance.ts); interact/ordnance-kiosk.ts restock;
                                   ai/ordnance-ai.ts a pure bot throw planner (brain.ts think: room bots, never carriers)
  ai/lanes.ts                      W9 L3 lane goals: a room bot picks a lane per life (weights, seed-hashed) and walks its
                                   waypoints (tactics goal 'lane'), sweeping back home along another; maps list lanes (The Lot:
                                   lot/layout.ts LOT_LANES); marksmen skip lanes so the perches stay manned
  ai/base-assault-ai.ts            W9 G4b base-assault roles per team (attack via a rally point, carry, escort, defend,
                                   return, chase), re-planned every 0.5 s with hysteresis; goal kind 'ball' in tactics.ts;
                                   the ball-run override in brain.ts sits above the HFSM modes
  match/core-rush.ts               core-rush: fair Core Pad placement, capture, hold scoring (EntityKind.Zone)
  match/slab.ts                    W13 slab: the Godot mode (hold the slab alone 1/s, first to 60 / 3:00 / overtime), Zone, kit
  match/base-assault.ts            W9 G4a base-assault: a ball, stand and capture ring per team (props in the snapshot),
                                   steal / carry (EFlag.Carrier: 0.75× speed, no glide, no rides) / drop / return /
                                   capture, stalemate relief; bases from WorldData.bases → battleOf flags → spawns
  adventure/                       A1 mode adventure: setup 95 + runner 790 (chapter steps and triggers, spawns and
                                   W10 A7: the runner plays only chapters of its sim's map (chapterForSim); online rooms
                                   advance along their map (chapterAfterOnMap); chapters-lot.ts = chapter 7 on The Lot
                                   sentries, stealth alarm, checkpoints with fail forward, MatchState/beacon fold);
                                   A2 props.ts: pup kits per chapter, parked karts, barricades (lasting barrier walls)
  ai/brain.ts propShot · tactics   A2: bots shoot a destroy step's props (propTarget), sentries walk their posts
  ai/nav-links.ts                  N1 bots climb: decks (elevated nav grids: garage roof, crow's nest) + links (ROOF_ROUTES
                                   climbs/descents, stepping stones, drops), validated per movement profile with the real
                                   stepCharacter in a cropped scratch world; cross-grid planner; leg controller (legStep)
  ai/brain.ts steerTo(…, gy)       plans across grids via links, runs a link leg by leg; perch goal (holdPerch, auto for
                                   marksman room bots in TDM / yard-skirmish)
  destruct/                        X1 breakable props (EntityKind.Destructible), order 505: breaching fuse, hitscan
                                   damage, blasts via explode()'s blast listeners; break/restore toggles colliders and
                                   nav blockers (ai/nav.ts per-sim dynamic blockers); mirrorDestructibles (prediction)
  ai/tactics.ts                    ability use, objective play (mission, cores, pads), helping humans, vehicles (B2)
  ai/drive.ts                      B2 bots drive and fly: kart nav (kart-sized drivable grid + A*), deterministic kart
                                   driver (pursuit, corner braking, boost, reverse-out), plane strafing dives on R1's
                                   planeAutopilot; ai/tactics.ts vehicleThink boards / rams / hops out / pilots (the
                                   brain hands a seated or boarding bot's tick to it)
  world/build.ts                   also terrainFastMove(): analytic grounded capsule moves over open terrain
src/host/                          Room (players, bots, input buffers, snapshots), wire (delta encoding),
                                   quantize (snapshot-precision parity), guard (validation), worker-host (offline)
src/client/
  main.ts                          boot + frame loop (lead)
  engine/                          renderer (WebGPU → WebGL2 + comic pipeline), adaptive quality, quality tiers
                                   W7 P3 ink LOD (renderer.ts installInkLod): the outline pass skips hulls under 0.3 px
                                   (userData.keepInk opts out: characters) and objects past userData.drawDistance
  style/                           toon/comic style system (tokens, toon/glow/stylize, outline + bloom + grade).
                                   W7 S4 v2: toon() returns HardenedToonMaterial (a MeshToonNodeMaterial with its own
                                   lighting model and TSL weathering); toonMaterial() is uncached; the sky drives the
                                   shared uniforms STYLE_ENV (reflection) and STYLE_WEATHER (wet, rain, dark); material
                                   detail is a build-time tier knob (setStyleDetail); floodlights.js has a fixed
                                   real-light budget per tier plus instanced fake pools
  core/events.ts                   typed client event bus
  input/  camera/                  keyboard/mouse/gamepad → InputCmd · third-person camera (AIM_RAY-aligned)
  net/                             transports (+ emulation), NetClient (interpolation, prediction, reconnect),
                                   prediction.ts, server-url.ts, loopback (tests)
  views/                           Avatar contract, entity-views (entity → avatar), nameplates
  procgen/characters/  anim/       procedural corgi/cat bodies, skeleton (47 bones), class silhouette gear, weapons ·
                                   animator (glide pose, kill grin), face, springs; silhouette.ts = range-readability check
                                   W7 K2: armoured veterans (gear.ts splits faction armour from team signal);
                                   MeshBuilder.surface is a per-vertex weathering channel for S4's material; the
                                   `veteran` variant is picked for bots by isVeteranSeed (≈ 1 in 6); X3 weapons are
                                   hard-surface kits with a `finish`
                                   W7 P3: a detail LOD past 20 m (CharacterAvatar.detail, set by the body's onBeforeRender)
  procgen/characters/squads.ts     W9 K3 squad kits (alley-cat raider / tabby heavy) on the shared rig, same draws; the kit is
                                   picked from class + max hp (ai/archetypes.ts squadKitFor), no protocol field; a `rank`
                                   look slot wears the K2 veteran kit + insignia (cosmetics.ts wearsVeteranRank)
  procgen/cosmetics/               C3: applyLook (coats repaint the fur, neckwear replaces the team collar), readability
  profile/                         P2: `cvc.profile` (schema + migration from `cvc.adventure`), XP + level curve, unlock
                                   rules, MatchTally (events → result), store; currentLook / recordMatch
  world/                           world view: terrain, fences, prims, foliage, water, sky/day-night, lamps
                                   (Garden, Garage + Rooftops districts; quality tiers apply live where possible)
                                   destruct-view.ts + destruct-debris.ts: standing/rubble index ranges, pooled debris
                                   battle-dressing.ts (W7 E4): banners + nets (cloth, TSL icons), S4 floodlights with
                                   real lights (world-view calls lamps.update), instanced battle clutter; terrain-view
                                   bakes the `battle` ground channels (scorch, mud, puddles, ruts)
                                   W13: the ink (outlines, crease lines) and the HARDENED comic look are retired: style/ is
                                   the stylised-realistic night copied from engines/godot/look (docs/design/LOOK.md)
                                   W10 P5: sky.ts drives STYLE_EXPOSURE from the time of day and hands
                                   WorldData.interiors (the-lot.ts lotInteriors) to the hardened material, which keeps
                                   the sky fill out of those boxes; high cameras thin the storm fog (STYLE.mood.highFog)
  ui/  audio/  fx/                 comic HUD + menus (MATCH selector, room browser, LOCKER) + chat + tips + settings ·
                                   W10 U3: ui/awards.ts (AwardsTally from events + roster, the awards card); the kill feed
                                   reads death.wpn. W10 AU2: audio/presets-objective.ts + music-tension.ts (Base Assault
                                   calls, fanfare, heartbeat), site-ambience.ts + presets-site.ts (world-data ambience)
                                   reward card (rewards.ts, never interactive) ·
                                   procedural audio + music (S2: vehicle-loops.ts engine loops from snapshot states,
                                   presets-engines.ts; vehicle/break voices; adventure stingers) · pooled FX (W13: the comic words are retired) ·
                                   plane-hud.ts cockpit strip
  vehicles/                        kart + terminal views (Wave 2) · RC plane + Rooftop Hangar views (R1)
  interact/                        kiosk/core/kibble/beacon views · E prompt, kit picker, buff chips, mission card
  fx/ordnance-view.ts              W9 X4 throwable meshes, arc preview + landing ring, fuse telegraph, faction blast layer ·
                                   ui/ordnance-hud.ts the throwable slot · audio/presets-ordnance.ts
  abilities/                       drone, charge, barrier views + spotted markers
  modes/core-rush-view.ts          Core Pads, A·B·C markers and strip
  modes/slab-view.ts               W13 slab read-out (frame + fill, as Godot's slab.gd) · ui/slab-hud.ts the slab HUD as
                                   hud.gd (scores to 60, clock/OVERTIME, slab line, HP/ammo, winner + R/Enter rematch) ·
                                   audio/slab-cues.ts the slab-mode cues (same WAVs as engines/godot/game/sfx.gd)
  modes/base-assault-view.ts       W9 G4a balls, stands, rings, beacons · ui/base-assault-hud.ts ball strip, banners
  adventure/                       A1: intro/outro captions, step barks, chapter card (medals), sentry cones, catnip
                                   bags, `cvc.adventure` progress; content in shared/content/chapters.ts
  debug/debug-hook.ts              window.__cvc for tests
tools/                             gate, boundaries, probe, soak, net-bots, char-audit, world-* benches/shots
labs/                              lane labs: characters, world, juice (HUD/FX), vehicles, boss, interact
tests/unit/  tests/e2e/            Vitest (sim/host/net/world/combat/ai/ui/fx) · Playwright (smoke, 2-client net)
docs/                              handoff/ (lane reports) · sprints/ (validated lane plans) · legacy/ (Unreal era)
assets/                            W11 shared-GLB pipeline: masters/ (master GLBs, PNG textures: the source of truth
                                   Godot imports) · incoming/ (untouched generator originals) · manifest.json
                                   (versions, budgets, sizes, provenance, licence) · docs/design/ASSET_PIPELINE.md
public/assets/kits/                web GLB variants (meshopt / WebP) that the client loads
tools/assets/  tools/godot/        bpy build / refine / bake scripts + validate-glb.mjs · Godot 4 headless import check
src/client/assets/kit-glb.ts       GLTFLoader → instanced LOD meshes for kit pieces (?kit=glb; ?kitlook=stylize for the toon
                                   side); the style factory's pbr() keeps a GLB's PBR maps inside the rig and grade

Repository layout rules (W11). The repo started as an Unreal plan; only docs/legacy/ (two Unreal-era docs) remains from
it, with no engine files. The web game owns the root. Any engine project (a future Unreal or Godot game client) lives
under engines/<engine>/ with its own .uproject / project.godot, never at the root. Its build folders (Binaries/,
Intermediate/, Saved/, DerivedDataCache/, .godot/) are git-ignored there. Folder names stay lowercase, and no two
paths may differ only by case (macOS and Windows checkouts).
```

## Data flow
Client input (60 Hz, sampled per frame with a 0.25 s cap) → `ClientMsg.input` (batched + redundant) → Room input
buffer → `Sim.setInput` → systems → events + entity states → delta-encoded `snap` (30 Hz) → NetClient:
remote entities interpolated (adaptive delay), local entity predicted with the same `stepCharacter` +
`stepWorldEffects` and reconciled on ack → EntityViews → avatars; events → bus → FX / audio / HUD / avatar triggers.

## Authority
Room + Sim are the only writers of competitive state. Offline: Web Worker (`src/host/worker-host.ts`).
Online: Node (`server/index.ts` dev, `server/prod.ts` production). Same code, same protocol, same tests.

## Physics parity
Player character state is rounded to snapshot precision every tick on the authority and after every predicted
step on the client (`src/host/quantize.ts`), which makes prediction bit-exact at any latency.
