/// <reference lib="webworker" />
// Offline/local authority: runs the same Room + Sim as the Node server inside a Web Worker.
// Messages: the client posts ClientMsg objects; the worker posts ServerMsg objects back.
import { Sim } from '../sim/sim';
import { Room, startRoomLoop, type Conn } from './room';
import type { ClientMsg, ServerMsg } from '../shared/protocol';

declare const self: DedicatedWorkerGlobalScope;

let room: Room | null = null;
const pending: ClientMsg[] = [];
const conn: Conn = { id: 'local', send: (m: ServerMsg) => self.postMessage(m) };

async function boot(cfg: { seed: number; mode: string; bots: [number, number] }) {
  const sim = await Sim.create({ seed: cfg.seed });
  room = new Room(sim, { mode: cfg.mode, botsPerTeam: cfg.bots, defaultTeam: 0 });
  startRoomLoop(room);
  for (const m of pending.splice(0)) handle(m);
}

function handle(msg: ClientMsg) {
  if (!room) { pending.push(msg); return; }
  if (msg.t === 'hello') room.join(conn, msg);
  else room.handle('local', msg);
}

self.onmessage = (ev: MessageEvent) => {
  const d = ev.data as { t: string };
  if (d.t === '__boot') void boot(ev.data.cfg);
  else handle(ev.data as ClientMsg);
};
