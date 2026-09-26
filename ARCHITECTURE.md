# ARCHITECTURE — live map (update when structure changes)

```
index.html                       client page → src/client/main.ts
server/index.ts                  Node WebSocket authority (npm run server)
src/shared/                      PURE contracts + data (runs everywhere; no three/DOM/Math.random)
  constants.ts                   tick 60 Hz, snapshot 30 Hz, interp delay, gravity
  types.ts                       Team, Species, CLASS_IDS, EntityKind, Anim, EFlag, Vec3
  input.ts                       InputCmd (+ rt lag-comp tick), Btn bits, sanitizeInput
  protocol.ts                    ClientMsg/ServerMsg, EntityState pack/unpack, MatchState, GameEvent
  rng.ts  math.ts                mulberry32/hash, angles/damp/view dirs
  content/classes.ts             class kits + per-species movement stats (theme data)
  world/world-data.ts            WorldData: height(x,z), props, spawns, killY  [L2 world lane]
src/sim/                         AUTHORITATIVE simulation (worker / Node / tests)
  rapier.ts                      Rapier init + collision layers/groups
  entity.ts                      SimEntity (+ module augmentation for components)
  sim.ts                         Sim: entities, systems (ordered), spawn/remove, snapshot, events
  systems/movement.ts            stepCharacter() — shared with client prediction (KCC, jumps, coyote)
  systems/core.ts                physics step (300), kill plane (650)
  systems/index.ts               default system order: ai(100) move(200) world(250) phys(300) combat(400-700) match(800)
  world/build.ts                 buildStaticWorld(R, world, data) — colliders  [L2]
  world/systems.ts               jump pads/water/hazards  [L2]
  combat/  ai/  match/           weapons+damage+respawn / bots / modes  [L3]
src/host/                        Room (players, bots, input queues, snapshots), loop driver, worker entry  [L4]
src/client/                      everything the player sees and hears
  main.ts                        boot + frame loop (lead)
  engine/renderer.ts             WebGPURenderer (WebGL2 fallback) + comic pipeline
  engine/adaptive-quality.ts     pixel-ratio governor
  style/                         toon/comic style system (tokens, toon/glow/stylize, outline+bloom+grade)
  core/events.ts                 typed client event bus
  input/input.ts                 keyboard/mouse/gamepad → InputCmd
  camera/third-person.ts         spring camera, aim mode, wall avoidance, shake
  net/transport.ts               worker + WebSocket transports with network emulation  [L4]
  net/net-client.ts              snapshot buffer, clock sync, interpolation, input batching  [L4]
  views/avatar.ts                Avatar contract (lead)
  views/entity-views.ts          entity → avatar sync, body facing
  procgen/characters/            procedural corgi/cat avatars  [L1]
  world/world-view.ts            terrain/props/sky visuals  [L2]
  ui/hud.ts                      HUD/menus  [L5]     audio/  fx/  [L5]
  debug/debug-hook.ts            window.__cvc for tests
tools/                           gate.mjs, check-boundaries.mjs, probe.mjs
tests/unit/                      Vitest (headless sim/host/net)   tests/e2e/  Playwright
docs/legacy/                     Unreal-era roadmap/readme (read-only history)
```

## Data flow
Client input (60 Hz) → `ClientMsg.input` (batched, redundant) → Room queue (≤ 8) → `Sim.setInput` → systems →
events + entity states → `ServerMsg.snap` (30 Hz) → NetClient buffer → interpolation (100 ms) / prediction
(local player) → EntityViews → avatars; events → bus → HUD/FX/audio.

## Authority
The Room + Sim are the only writers of competitive state. Offline play runs them in a Web Worker
(`src/host/worker-host.ts`); online play runs them in Node (`server/index.ts`). Same code, same protocol.
