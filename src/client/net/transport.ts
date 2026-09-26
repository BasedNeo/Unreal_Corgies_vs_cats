// Transports to the authority: a local Web Worker (offline) or a WebSocket (online).
// Both can emulate network conditions (?lag=80&jitter=10&loss=1) so netcode is tested with real delay.
// The WebSocket path decodes the server's compact snapshot frames (src/host/wire.ts) back into plain
// ServerMsg objects before emulation, so emulated loss behaves like UDP loss on a real link.
import type { ClientMsg, ServerMsg } from '../../shared/protocol';
import { SnapDecoder, decodeServerFrame } from '../../host/wire';
import type { WorkerBootConfig } from '../../host/worker-host';

export interface TransportStats {
  bytesIn: number;
  bytesOut: number;
  msgsIn: number;
  msgsOut: number;
}

export interface Transport {
  kind: 'worker' | 'ws' | 'loopback';
  send(msg: ClientMsg): void;
  onMessage(cb: (msg: ServerMsg) => void): void;
  onClose(cb: (reason: string) => void): void;
  close(): void;
  /** Byte/message counters (bytes are 0 for the worker, which passes objects). */
  readonly stats?: TransportStats;
  /** Re-open the connection after a disconnect (WebSocket only). Handlers are kept. */
  reconnect?(): Promise<void>;
  /**
   * Can messages be lost? A WebSocket (TCP) or worker never loses messages, so input redundancy is
   * pure overhead there; only emulated loss (?loss=) makes a link lossy. undefined = assume lossy.
   */
  readonly lossy?: boolean;
}

export interface NetEmulation {
  /** One-way latency in ms (applied both directions). */
  lagMs: number;
  /** Random extra delay 0..jitterMs. */
  jitterMs: number;
  /** Packet loss percent (0-100), applied to input/snapshot messages only. */
  lossPct: number;
}

function newStats(): TransportStats {
  return { bytesIn: 0, bytesOut: 0, msgsIn: 0, msgsOut: 0 };
}

export function emulate<T extends { t: string }>(em: NetEmulation | null, deliver: (m: T) => void): (m: T) => void {
  if (!em || (em.lagMs <= 0 && em.jitterMs <= 0 && em.lossPct <= 0)) return deliver;
  let lastDue = 0;
  return (m: T) => {
    const droppable = m.t === 'input' || m.t === 'snap';
    if (droppable && Math.random() * 100 < em.lossPct) return;
    // Keep ordering (TCP-like): never deliver before a previously scheduled message.
    const due = Math.max(performance.now() + em.lagMs + Math.random() * em.jitterMs, lastDue);
    lastDue = due;
    setTimeout(() => deliver(m), due - performance.now());
  };
}

export function createWorkerTransport(cfg: WorkerBootConfig, em: NetEmulation | null): Transport {
  const worker = new Worker(new URL('../../host/worker-host.ts', import.meta.url), { type: 'module' });
  worker.postMessage({ t: '__boot', cfg });
  const stats = newStats();
  let onMsg: (m: ServerMsg) => void = () => {};
  let onClose: (r: string) => void = () => {};
  const up = emulate<ClientMsg>(em, (m) => worker.postMessage(m));
  const down = emulate<ServerMsg>(em, (m) => onMsg(m));
  worker.onmessage = (ev) => { stats.msgsIn++; down(ev.data as ServerMsg); };
  worker.onerror = (ev) => onClose(`worker error: ${ev.message}`);
  return {
    kind: 'worker',
    stats,
    lossy: !!em && em.lossPct > 0,
    send: (m) => { stats.msgsOut++; up(m); },
    onMessage: (cb) => { onMsg = cb; },
    onClose: (cb) => { onClose = cb; },
    close: () => worker.terminate(),
  };
}

function describeClose(ev: CloseEvent): string {
  if (ev.reason) return ev.reason;
  switch (ev.code) {
    case 1000: return 'connection closed';
    case 1001: return 'server shutting down';
    case 1006: return 'connection lost';
    case 1008: return 'kicked by server (policy)';
    case 1009: return 'message too large';
    case 1011: return 'server error';
    case 1013: return 'server busy, try again later';
    case 4000: return 'disconnected: idle';
    case 4001: return 'disconnected: no handshake';
    default: return `connection closed (${ev.code})`;
  }
}

/**
 * WebSocket transport. Resolves once connected. `reconnect()` opens a fresh socket to the same URL
 * (the server treats it as a new join) while keeping the registered handlers.
 */
export function createWebSocketTransport(url: string, em: NetEmulation | null): Promise<Transport> {
  const stats = newStats();
  let onMsg: (m: ServerMsg) => void = () => {};
  let onClose: (r: string) => void = () => {};
  let ws: WebSocket | null = null;
  let queue: ClientMsg[] = [];
  let up: (m: ClientMsg) => void = () => {};

  const open = () => new Promise<void>((resolve, reject) => {
    const sock = new WebSocket(url);
    const decoder = new SnapDecoder(); // one per socket: the server's encoder state is per connection
    const rawSend = (m: ClientMsg) => {
      if (sock.readyState === WebSocket.OPEN) {
        const s = JSON.stringify(m);
        stats.bytesOut += s.length; stats.msgsOut++;
        sock.send(s);
      } else if (sock.readyState === WebSocket.CONNECTING) queue.push(m);
    };
    const down = emulate<ServerMsg>(em, (m) => { if (ws === sock) onMsg(m); });
    let opened = false;
    sock.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      stats.bytesIn += ev.data.length; stats.msgsIn++;
      const m = decodeServerFrame(ev.data, decoder);
      if (m) down(m);
    };
    sock.onclose = (ev) => {
      if (!opened) { reject(new Error(`could not connect to ${url}`)); return; }
      if (ws === sock) onClose(describeClose(ev));
    };
    sock.onerror = () => { /* followed by onclose */ };
    sock.onopen = () => {
      opened = true;
      ws = sock;
      up = emulate<ClientMsg>(em, rawSend);
      const q = queue; queue = [];
      for (const m of q) rawSend(m);
      resolve();
    };
  });

  const transport: Transport = {
    kind: 'ws',
    stats,
    lossy: !!em && em.lossPct > 0,
    send: (m) => up(m),
    onMessage: (cb) => { onMsg = cb; },
    onClose: (cb) => { onClose = cb; },
    close: () => { ws?.close(1000); },
    reconnect: async () => {
      const old = ws;
      ws = null;
      if (old && old.readyState <= WebSocket.OPEN) old.close(1000);
      queue = [];
      await open();
    },
  };
  return open().then(() => transport);
}
