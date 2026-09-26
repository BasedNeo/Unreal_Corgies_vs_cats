// Transports to the authority: a local Web Worker (offline) or a WebSocket (online).
// Both can emulate network conditions (?lag=80&loss=1) so netcode is tested with real delay.
import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export interface Transport {
  kind: 'worker' | 'ws';
  send(msg: ClientMsg): void;
  onMessage(cb: (msg: ServerMsg) => void): void;
  onClose(cb: (reason: string) => void): void;
  close(): void;
}

export interface NetEmulation {
  /** One-way latency in ms (applied both directions). */
  lagMs: number;
  /** Random extra delay 0..jitterMs. */
  jitterMs: number;
  /** Packet loss percent (0-100), applied to input/snapshot messages only. */
  lossPct: number;
}

function emulate<T extends { t: string }>(em: NetEmulation | null, deliver: (m: T) => void): (m: T) => void {
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

export function createWorkerTransport(cfg: { seed: number; mode: string; bots: [number, number] }, em: NetEmulation | null): Transport {
  const worker = new Worker(new URL('../../host/worker-host.ts', import.meta.url), { type: 'module' });
  worker.postMessage({ t: '__boot', cfg });
  let onMsg: (m: ServerMsg) => void = () => {};
  let onClose: (r: string) => void = () => {};
  const up = emulate<ClientMsg>(em, (m) => worker.postMessage(m));
  const down = emulate<ServerMsg>(em, (m) => onMsg(m));
  worker.onmessage = (ev) => down(ev.data as ServerMsg);
  worker.onerror = (ev) => onClose(`worker error: ${ev.message}`);
  return {
    kind: 'worker',
    send: (m) => up(m),
    onMessage: (cb) => { onMsg = cb; },
    onClose: (cb) => { onClose = cb; },
    close: () => worker.terminate(),
  };
}

export function createWebSocketTransport(url: string, em: NetEmulation | null): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let onMsg: (m: ServerMsg) => void = () => {};
    let onClose: (r: string) => void = () => {};
    const queue: ClientMsg[] = [];
    const rawSend = (m: ClientMsg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); else queue.push(m); };
    const up = emulate<ClientMsg>(em, rawSend);
    const down = emulate<ServerMsg>(em, (m) => onMsg(m));
    ws.onmessage = (ev) => { try { down(JSON.parse(String(ev.data))); } catch { /* ignore malformed */ } };
    ws.onclose = (ev) => onClose(ev.reason || 'connection closed');
    ws.onerror = () => reject(new Error(`could not connect to ${url}`));
    ws.onopen = () => {
      for (const m of queue.splice(0)) rawSend(m);
      resolve({ kind: 'ws', send: up, onMessage: (cb) => { onMsg = cb; }, onClose: (cb) => { onClose = cb; }, close: () => ws.close() });
    };
  });
}
