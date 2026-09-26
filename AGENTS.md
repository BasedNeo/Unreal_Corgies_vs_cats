# AGENTS.md — Corgis vs Cats (Three.js)

Multiplayer third-person action-platformer shooter. Browser client (Three.js `three/webgpu` + TSL, toon style)
+ authoritative TypeScript simulation (Rapier) running in a Web Worker offline or a Node WebSocket server online.

## Protocol (every agent, every task)
1. Before any significant action re-read: `MASTER_PLAN.md` (§0 + your lane card in §10), `ARCHITECTURE.md`,
   `PROGRESS.md`. Obey them strictly. Implement only the current card — never expand scope.
2. Stay inside your lane's owned paths. Shared contracts (MASTER_PLAN §8.4) change only via the lead.
3. Load the skill for the kind of work (MASTER_PLAN §11) before doing it.
4. Prove it: run the card's proof commands, take the named screenshots with `tools/probe.mjs`, and look at them.
5. Update `PROGRESS.md` (and `ARCHITECTURE.md` if structure changed) when a task finishes. Complete,
   working code only — no placeholder stubs in shipped paths.

## Verify
- `npm run gate` — typecheck · boundaries · unit (Vitest) · build · e2e (Playwright). Must pass before "done".
- `npm run gate:fast` — typecheck · boundaries · unit (for lanes working in parallel).
- `npx vite --port 5173` then `node tools/probe.mjs '?webgl&autoplay' 8 artifacts/x.png` — headless screenshot +
  console + `__cvc` debug state. `PROBE_KEYS=KeyW,Space` holds keys.
- `npm run server` — Node authority on ws://localhost:8787; play online with `?server=ws://localhost:8787`.

## Things that go wrong here
- Import Three.js only as `three/webgpu` / `three/tsl` / `three/addons/...` — never plain `three` (two copies break).
- `src/sim`, `src/host`, `src/shared`: no three, no DOM, no `Math.random()` (seeded `mulberry32`). Checked by the gate.
- Materials only via `toon()` / `glow()` / `stylize()` from `src/client/style/style-webgpu.js`.
- Raycasts in the client must skip ink lines (`LineSegments2`) — use solid mesh lists.
- Headless Chromium renders with SwiftShader (WebGL2 fallback, ~5–10 fps): judge looks from screenshots, fps on real GPUs.
- Movement code is shared by the authority and client prediction: change `stepCharacter` only through the lead.
- Never `git add -A` for an integration commit while other agents are editing: stage explicit paths, then run
  `npm run verify` (checks the committed tree in isolation) before calling it green. Commit first: verify tests
  the commit, not the index. Gate the push on its exit code (`if npm run verify; then git push …`); piping it into
  `tail` hides a FAIL.
- A file another lane is also editing (e.g. a shared test): stage only your hunk (apply your change to
  `git show HEAD:<file>`, then `git hash-object -w` + `git update-index --cacheinfo`).
- Snapshot quantization rounds height UP (`src/host/quantize.ts`): rounding to nearest parks characters on the KCC's
  2 cm skin, where Rapier deadlocks on flat ground.
