/// <reference lib="webworker" />
// Offline/local authority: runs the same Room + Sim as the Node server inside a Web Worker.
// Messages: the client posts ClientMsg objects; the worker posts ServerMsg objects back.
// Messages go through the same validator as the Node server so both authorities behave alike.
import { Sim } from '../sim/sim';
import { Room, startRoomLoop, type Conn } from './room';
import { validateClientMsg } from './guard';
import type { ServerMsg } from '../shared/protocol';

declare const self: DedicatedWorkerGlobalScope;

let room: Room | null = null;
const pending: unknown[] = [];
const conn: Conn = { id: 'local', send: (m: ServerMsg) => self.postMessage(m) };

async function boot(cfg: { seed: number; mode: string; bots: [number, number] }) {
  const sim = await Sim.create({ seed: cfg.seed });
  room = new Room(sim, { mode: cfg.mode, botsPerTeam: cfg.bots, defaultTeam: 0 });
  startRoomLoop(room);
  for (const m of pending.splice(0)) handle(m);
}

function handle(raw: unknown) {
  if (!room) { pending.push(raw); return; }
  const v = validateClientMsg(raw);
  if (!v.ok) return;
  if (v.msg.t === 'hello') room.join(conn, v.msg);
  else room.handle('local', v.msg);
}

self.onmessage = (ev: MessageEvent) => {
  const d = ev.data as { t?: string; cfg?: { seed: number; mode: string; bots: [number, number] } };
  if (d?.t === '__boot' && d.cfg) void boot(d.cfg);
  else handle(ev.data);
};
