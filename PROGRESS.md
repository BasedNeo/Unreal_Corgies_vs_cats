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
| W2 V1 Vehicles | ⏳ dispatched | — |
| W2 B1 Vac-Tank boss | ⏳ dispatched | — |
| W2 G1 Garden + weather | ⏳ dispatched | — |
| W2 S1 Ordnance Terminal/cores/objectives, Q1 verification | ⬜ next | — |
| **Wave 1 integration** | ✅ | full gate PASS: typecheck · boundaries · unit · build · e2e (smoke ×2 + 2-client net ×2) |

## Log
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
- Rapier KCC on the West Yard heightfield costs ~0.13 ms/character/tick (8× flat) → 1.1–2.2 ms/tick at full rooms (L3).
- Straight-down raycasts on the heightfield slip through at grid lines ~23 %: use `WorldData.height()` (L3).
- Firefight snapshot bandwidth 30.6 KB/s after delta encoding (was 64 KB/s) — inside budget (L4).
- Combat knockback is not predicted → occasional smoothed corrections > 0.5 m in live soaks (L4).
- Offline play downloads Rapier twice (worker + prediction chunk), ~3.75 MB gz total (L4).
- Client world build blocks the main thread ~1.3 s at load (L2).
- Bots treat decks/roofs as obstacles; Warden bots weak in the open (L3).
- Character faces faceted in close-ups; expressions read cute rather than fierce at portrait distance (lead review of L1).
- Proposed contract additions (L3): archetype on EntityState, weapon on `death`, `MatchState.enemiesLeft`.

## Human verdicts
_(none yet — first human session after Wave 1 integration)_

## Ideas (not in scope yet)
- Corgi "zoomies" leaves a dust trail that briefly slows pursuing cats.
- Sprinkler weather event that knocks cats off the lawn.
