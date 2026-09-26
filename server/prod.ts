// Production server: serves the Vite build (dist/) AND the game WebSocket on ONE port.
//   npm run build && npx tsx server/prod.ts          -> http://localhost:8080  (WebSocket: /ws)
//   PORT=80 STATIC_DIR=dist BOTS=0,4 npx tsx server/prod.ts
// index.html is served with <meta name="cvc-ws" content="/ws"> injected, which makes the client
// connect online automatically (src/client/net/server-url.ts). ?room=<name> selects a room.
// Put TLS in front (reverse proxy / platform) and the page will use wss:// automatically.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';
import { startGameServer, installShutdownHandlers } from './app';

const cfg = loadConfig(process.env, { port: 8080, wsPath: '/ws', staticDir: 'dist' });
const dir = path.resolve(cfg.staticDir ?? 'dist');
if (!existsSync(path.join(dir, 'index.html'))) {
  console.error(`[cvc] ${dir}/index.html not found — run \`npm run build\` first (or set STATIC_DIR).`);
  process.exit(1);
}
const server = await startGameServer({ ...cfg, staticDir: dir });
installShutdownHandlers(server);
console.log(`[cvc] Corgis vs Cats on ${server.httpUrl} (static ${dir}, WebSocket ${cfg.wsPath}) mode=${cfg.mode} bots=${cfg.bots.join(',')}`);
