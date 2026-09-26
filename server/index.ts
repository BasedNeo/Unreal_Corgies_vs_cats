// Online authority (development / standalone): WebSocket rooms + /health + /stats + /rooms on one port.
//   npm run server                                  -> ws://localhost:8787 (any path; ?room=name picks a room)
//   PORT=9000 MODE=team-deathmatch BOTS=3,3 npm run server
// All settings: see server/config.ts (MAX_ROOMS, ROOM_TTL_MS, IDLE_TIMEOUT_MS, MSG_RATE, ...).
// Production (static dist/ + WebSocket on /ws, one port): server/prod.ts.
import { loadConfig } from './config';
import { startGameServer, installShutdownHandlers } from './app';

const cfg = loadConfig(process.env, { port: 8787, wsPath: null, staticDir: null });
const server = await startGameServer(cfg);
installShutdownHandlers(server);
console.log(`[cvc] Corgis vs Cats authority on ${server.wsUrl} mode=${cfg.mode} bots=${cfg.bots.join(',')} (rooms on demand, max ${cfg.maxRooms}; ${server.httpUrl}/stats · room list ${cfg.listRooms ? `${server.httpUrl}/rooms` : 'off'})`);
