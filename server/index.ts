// Online authority: Node WebSocket server running the same Room + Sim as the offline worker.
//   npm run server            -> ws://localhost:8787
//   PORT=9000 MODE=team-deathmatch BOTS=3,3 npm run server
import { WebSocketServer, type WebSocket } from 'ws';
import { Sim } from '../src/sim/sim';
import { Room, startRoomLoop, type Conn } from '../src/host/room';
import type { ClientMsg } from '../src/shared/protocol';

const PORT = Number(process.env.PORT ?? 8787);
const MODE = process.env.MODE ?? 'yard-skirmish';
const BOTS = (process.env.BOTS ?? '0,4').split(',').map(Number) as [number, number];
const SEED = Number(process.env.SEED ?? 1);

const sim = await Sim.create({ seed: SEED });
const room = new Room(sim, { mode: MODE, botsPerTeam: BOTS });
startRoomLoop(room);

const wss = new WebSocketServer({ port: PORT, maxPayload: 64 * 1024 });
let nextConn = 1;

wss.on('connection', (ws: WebSocket, req) => {
  const id = `c${nextConn++}`;
  const conn: Conn = {
    id,
    send: (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); },
    close: () => ws.close(),
  };
  let joined = false;
  let msgCount = 0;
  const rate = setInterval(() => { msgCount = 0; }, 1000);
  ws.on('message', (data) => {
    if (++msgCount > 240) return; // flood guard: >240 msgs/s is never legitimate
    let msg: ClientMsg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (!joined) {
      if (msg?.t !== 'hello') return;
      joined = !!room.join(conn, msg);
      if (joined) console.log(`[cvc] ${id} joined from ${req.socket.remoteAddress}`);
      return;
    }
    room.handle(id, msg);
  });
  ws.on('close', () => { clearInterval(rate); room.leave(id); console.log(`[cvc] ${id} left`); });
});

console.log(`[cvc] Corgis vs Cats authority on ws://localhost:${PORT} mode=${MODE} bots=${BOTS.join(',')}`);
