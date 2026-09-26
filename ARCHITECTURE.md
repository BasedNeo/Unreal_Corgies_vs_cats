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
                                   queries (height/surface/concealment), weather/time-of-day from tick, kit
src/sim/                           AUTHORITATIVE simulation (worker / Node / tests / client prediction)
  rapier.ts entity.ts sim.ts       Rapier init + layers · SimEntity · Sim (ordered systems, spawn, snapshot, events)
  systems/                         movement.ts stepCharacter (shared with prediction) · core.ts (physics step, kill plane)
                                   index.ts order: ai 100 · interact/boss 150 · vehicles 190 · move 200 ·
                                   world 250 · physics 300 · combat 400-700 · kill plane 650 · match 800
  world/                           buildStaticWorld (trimesh terrain + prop colliders), world systems + stepWorldEffects
  combat/                          weapons, lag-compensated hitscan, projectiles, damage, lifecycle/respawn, abilities
  ai/                              brain (HFSM, perception, aim), archetypes, nav (1 m grid A*)
  match/                           yard-skirmish (waves) · team-deathmatch
  vehicles/  boss/                 Wave 2 lanes (Mower Kart + terminals; Vac-Tank boss) · boss/ also the sniper elite
                                   (E1: sniper.ts perches/dot/shot/leaps, hairball.ts shared lob); ?boss=<id> → Room
  vehicles/plane*.ts pilot.ts      R1 RC plane: pure flight step (plane.ts), order 191 seats/gun/damage/crashes
                                   (plane-systems.ts), scripted pilot (pilot.ts); common.ts = kart+plane helpers, stun
  interact/                        order 150: Ordnance kiosk kit swaps, Upgrade Cores + buffs, Golden Kibble,
                                   Squeaker mission chain (folded into MatchState by match/)
  combat/ability-*.ts              Spotter Drone / Dig Charge / Squeak Barrier entities (EntityKind.Ability)
  match/core-rush.ts               core-rush: fair Core Pad placement, capture, hold scoring (EntityKind.Zone)
  adventure/                       A1 mode adventure: setup 95 + runner 790 (chapter steps and triggers, spawns and
                                   sentries, stealth alarm, checkpoints with fail forward, MatchState/beacon fold)
  destruct/                        X1 breakable props (EntityKind.Destructible), order 505: breaching fuse, hitscan
                                   damage, blasts via explode()'s blast listeners; break/restore toggles colliders and
                                   nav blockers (ai/nav.ts per-sim dynamic blockers); mirrorDestructibles (prediction)
  ai/tactics.ts                    ability use, objective play (mission, cores, pads), helping humans
  world/build.ts                   also terrainFastMove(): analytic grounded capsule moves over open terrain
src/host/                          Room (players, bots, input buffers, snapshots), wire (delta encoding),
                                   quantize (snapshot-precision parity), guard (validation), worker-host (offline)
src/client/
  main.ts                          boot + frame loop (lead)
  engine/                          renderer (WebGPU → WebGL2 + comic pipeline), adaptive quality, quality tiers
  style/                           toon/comic style system (tokens, toon/glow/stylize, outline + bloom + grade)
  core/events.ts                   typed client event bus
  input/  camera/                  keyboard/mouse/gamepad → InputCmd · third-person camera (AIM_RAY-aligned)
  net/                             transports (+ emulation), NetClient (interpolation, prediction, reconnect),
                                   prediction.ts, server-url.ts, loopback (tests)
  views/                           Avatar contract, entity-views (entity → avatar), nameplates
  procgen/characters/  anim/       procedural corgi/cat bodies, skeleton (47 bones), class silhouette gear, weapons ·
                                   animator (glide pose, kill grin), face, springs; silhouette.ts = range-readability check
  world/                           world view: terrain, fences, prims, foliage, water, sky/day-night, lamps
                                   (Garden, Garage + Rooftops districts; quality tiers apply live where possible)
                                   destruct-view.ts + destruct-debris.ts: standing/rubble index ranges, pooled debris
  ui/  audio/  fx/                 comic HUD + menus (MATCH selector, room browser) + chat + tips + settings ·
                                   procedural audio + music · pooled FX + words
  vehicles/                        kart + terminal views (Wave 2) · RC plane + Rooftop Hangar views (R1)
  interact/                        kiosk/core/kibble/beacon views · E prompt, kit picker, buff chips, mission card
  abilities/                       drone, charge, barrier views + spotted markers
  modes/core-rush-view.ts          Core Pads, A·B·C markers and strip
  adventure/                       A1: intro/outro captions, step barks, chapter card (medals), sentry cones, catnip
                                   bags, `cvc.adventure` progress; content in shared/content/chapters.ts
  debug/debug-hook.ts              window.__cvc for tests
tools/                             gate, boundaries, probe, soak, net-bots, char-audit, world-* benches/shots
labs/                              lane labs: characters, world, juice (HUD/FX), vehicles, boss, interact
tests/unit/  tests/e2e/            Vitest (sim/host/net/world/combat/ai/ui/fx) · Playwright (smoke, 2-client net)
docs/                              handoff/ (lane reports) · sprints/ (validated lane plans) · legacy/ (Unreal era)
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
