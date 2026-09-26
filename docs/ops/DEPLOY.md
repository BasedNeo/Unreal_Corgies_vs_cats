# Deploy — Corgis vs Cats

**Status: prepared, not deployed.** Deploying publishes the game on the internet and starts a monthly bill, so the
owner triggers it.

## Where and why
| Piece | Host | Why |
|---|---|---|
| Game server + client (one process) | **DigitalOcean App Platform**, 1 service, `apps-s-1vcpu-1gb` (~$10–12/mo) | The authority is a long-running 60 Hz process holding WebSockets. Serverless (Vercel) can't host it. One port serves `dist/` and `/ws`, so there's no CORS and no second deploy. |
| Domain | GoDaddy DNS → CNAME to the `*.ondigitalocean.app` host | Keep all domains at one registrar. |
| Database | none yet | Rooms and matches live in memory. Neon joins when accounts/progression do. |
| Errors | Sentry (existing account), later | Client + server SDK once real players arrive. |

A static-only split (client on Vercel, `/ws` on DO) is possible via `?server=wss://…`. It is not worth a second deploy
until the client needs a CDN edge.

## What ships
- `Dockerfile`: a two-stage build. The build stage runs `npm ci` → `npm run build` (client) → `npm run precompress`
  → `npm run build:server` (a Vite SSR bundle of `server/prod.ts` into `dist-server/prod.js`).
  - `precompress` writes a Brotli (q11) and a gzip -9 copy next to every compressible file in `dist/`.
  - The server sends the Brotli copy to browsers that accept it: 3.92 → 2.91 MB of JS for offline play, about 26 %
    less.
  - Without the copies (for example `npm run start`), it gzips on the fly. The runtime stage is `npm ci --omit=dev`
  (rapier, three, ws) and `node dist-server/prod.js`, running as user `node`, with a `/health` HEALTHCHECK.
- `.do/app.yaml`: the App Platform spec. Env:
  - `TRUST_PROXY=true`, because DO sits in front and sets X-Forwarded-For;
  - `MAX_ROOMS=16`;
  - a secret `STATS_TOKEN`.
- Everything else is configured through `server/config.ts` env vars:
  - `PORT`, `MODE`, `BOTS`, `SEED`, `MAX_ROOMS`, `MAX_CONNECTIONS`, `MAX_CONN_PER_IP`, `MAX_ROOMS_PER_IP`;
  - `ALLOWED_ORIGINS`, `ROOM_TTL_MS`, the rate limits, `WIRE`, `LOG`, `STATS_TOKEN`.

## Proof so far (2026-09-26, in the cloud dev container, which has no Docker daemon)
- The bundled server (`node dist-server/prod.js`, with no tsx) boots from a production-only `npm ci --omit=dev`.
- `/health` returns ok, and the page gets `<meta name="cvc-ws" content="/ws">` injected.
- A WebSocket client gets `welcome` + `roster` + snapshots (40 messages in < 1 s).
- `docker build` itself is not proven yet. Run it on the Mac before the first deploy:
  `docker build -t cvc . && docker run --rm -p 8080:8080 cvc`, then open http://localhost:8080.

## Steps (owner)
1. Merge the working branch into `main`: the spec deploys `main` on push.
2. Build and run locally with the `docker build … && docker run …` line above. Play one round in two browser tabs.
3. `doctl auth init`, then `doctl apps create --spec .do/app.yaml`. Or in the DO dashboard: Create App → GitHub
   repo → it detects the Dockerfile → paste the env from the spec.
4. Set `STATS_TOKEN` in the dashboard (Settings → App-Level/Component env → Encrypt).
5. Optional domain: add it in the App settings, then create a GoDaddy CNAME `play` → `<app>.ondigitalocean.app`.
6. Share `https://<host>/?room=<name>`. Friends in the same `room` play together; the page connects over `wss://`
   automatically.

## Scaling notes
- One instance handles about 8 active rooms of 12 humans + bots. Tick budget: 3 ms/room at 28 characters on a desktop
  core, so budget more on shared vCPUs. Measure with `/stats` (tick p95, overruns) before adding rooms.
- Rooms are process-local. More than one instance needs a room router (sticky by `?room=`) first. Until then, scale
  up the instance size, not the instance count.
