# Corgis vs Cats

A chaotic third-person action-platformer shooter in the browser. A corgi squad fights the cat army across West Yard,
a suburban back yard at pet scale. Play alone with bot pups, in co-op, or head-to-head online.

Built with **Three.js** (`three/webgpu` + TSL, a toon/comic look, WebGL2 fallback) and **Rapier** physics. An
authoritative **TypeScript simulation** runs in a Web Worker offline or on a Node WebSocket server online, with
the same code and protocol in both. Everything is procedural (characters, world, audio); there are no licensed
assets. Original IP.

## Play
```bash
npm install
npm run dev                 # http://localhost:5173 → main menu → pick a MATCH → PLAY
```
- Use a desktop browser with a real GPU (Chrome or Edge; WebGPU where available).
- Online on your LAN: run `npm run start` (it builds, then serves the game and its WebSocket on port 8787). Friends
  open `http://<your-ip>:8787` and use ROOMS ▸ to join your room.
- Useful URL params:
  - `?mode=team-deathmatch|core-rush|yard-skirmish`
  - `?boss=1` (boss rush)
  - `?quality=low|medium|high`
  - `?bots=4,4`
  - `?room=name`
  - `?autoplay` (skip the menu)

### Modes
| Mode | What |
|---|---|
| **Skirmish** | Co-op vs five waves of cats and the Vac-Tank boss. Your squad is you plus bot pups, or friends. |
| **Deathmatch** | 4v4, first team to 30 knockouts. Bots fill empty slots. |
| **Core Rush** | 4v4: hold the three Core Pads (A, B, C) for points; first team to 250 wins. |
| **Adventure** *(in progress)* | "The Last Tennis Ball": six district chapters, one class each (`docs/design/ADVENTURE.md`). |

### Controls
| Key | Action |
|---|---|
| WASD, Space ×2, Shift | move, double jump, sprint |
| Mouse, RMB | aim and fire, aim down |
| Q | class ability |
| R | reload |
| E | interact (kiosks, karts, mission) |
| C | slide while sprinting; in the air, ground-pound |
| Enter | chat |
| B | taunt (a voiced comic line) |
| Tab | scoreboard |

Six classes can be swapped at your base's Ordnance Kiosk:
- **Assault**: Bark Blast.
- **Infiltrator**: Shadow Cloak.
- **Overwatch**: Spotter Drone.
- **Breacher**: Dig Charge.
- **Warden**: Squeak Barrier.
- **Skyraider**: Ear Glide.

## Develop
| Command | What |
|---|---|
| `npm run verify` | Checks the committed tree in isolation: typecheck, boundaries, unit tests, build. Add `-- --e2e` for Playwright. |
| `npm run gate` | The same checks on the working tree. |
| `npm test` | Vitest unit tests. |
| `npm run soak` | Headless bot matches in every mode: errors, stuck bots, tick budget, determinism. |
| `npm run server` | Dev authority on ws://localhost:8787 (play with `?server=ws://localhost:8787`). |

Read these before changing anything:
- `AGENTS.md`: protocol and pitfalls.
- `MASTER_PLAN.md`: the constitution and the waves.
- `ARCHITECTURE.md`: the live module map.
- `PROGRESS.md`: status, log, known issues.

Lane handoffs are in `docs/handoff/`. A human playtest script is in `docs/qa/PLAYTEST_SCRIPT.md`.

## Deploy
The game server needs long-lived WebSockets, so it runs as one container: a `Dockerfile` plus a DigitalOcean App
Platform spec (`.do/app.yaml`). Steps and costs: `docs/ops/DEPLOY.md`. Nothing is deployed automatically.
