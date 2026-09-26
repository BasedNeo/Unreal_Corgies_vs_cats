// U1: room browser logic — endpoint from the server URL, validation of the untrusted list, room-name cleaning,
// and the poller's loading / ready / empty / error / busy / offline / bad-url states with a 5 s refresh.
import { describe, expect, it } from 'vitest';
import { RoomPoller, cleanRoomName, isFull, modeLabel, parseRooms, roomsEndpoint, serverBase, type FetchLike, type RoomsState } from '../../src/client/ui/rooms';

const ROOM = { name: 'porch', mode: 'yard-skirmish', players: 5, humans: 2, bots: 3, maxPlayers: 12, phase: 'live' };

describe('room list helpers', () => {
  it('derives the HTTP /rooms endpoint from the WebSocket server URL', () => {
    expect(roomsEndpoint('ws://localhost:8787')).toBe('http://localhost:8787/rooms');
    expect(roomsEndpoint('wss://play.example/ws?room=abc')).toBe('https://play.example/rooms');
    expect(roomsEndpoint(' ws://10.0.0.2:9000/ ')).toBe('http://10.0.0.2:9000/rooms');
    expect(roomsEndpoint('http://x')).toBeNull();
    expect(roomsEndpoint('')).toBeNull();
    expect(roomsEndpoint(null)).toBeNull();
    expect(serverBase('ws://h:1/ws?room=abc&enc=raw')).toBe('ws://h:1/ws?enc=raw');
    expect(serverBase('ws://localhost:8787')).toBe('ws://localhost:8787');
  });

  it('validates the untrusted list: malformed or unlisted rows are dropped, never rendered; capped', () => {
    expect(parseRooms({ rooms: [] })).toEqual([]);
    const rows = parseRooms([
      ROOM,
      { ...ROOM, name: '<img src=x onerror=1>' },
      { ...ROOM, name: '_hidden' },
      { ...ROOM, name: 'neg', humans: -1 },
      { ...ROOM, name: 'frac', bots: 1.5 },
      { ...ROOM, name: 'phase', phase: 'party' },
      { ...ROOM, name: 'mode', mode: 'Yard <b>' },
      { ...ROOM, name: 'ok2', phase: 'warmup', ip: '1.2.3.4' },
      null, 7, 'x',
    ]);
    expect(rows.map((r) => r.name)).toEqual(['porch', 'ok2']);
    expect(rows[1]).not.toHaveProperty('ip'); // only known fields survive
    const many = Array.from({ length: 80 }, (_, i) => ({ ...ROOM, name: `r${i}` }));
    expect(parseRooms(many)).toHaveLength(50);
    expect(parseRooms(many, 3)).toHaveLength(3);
  });

  it('cleans typed room names to the server rule, with an optional unlisted prefix', () => {
    expect(cleanRoomName('  Porch Party!! ')).toBe('Porch-Party');
    expect(cleanRoomName('x'.repeat(40))).toHaveLength(24);
    expect(cleanRoomName('secret', true)).toBe('_secret');
    expect(cleanRoomName('__sneaky')).toBe('sneaky'); // only the toggle makes a room unlisted
    expect(cleanRoomName('!!!')).toBe('');
    expect(cleanRoomName('x'.repeat(40), true)).toHaveLength(24);
  });

  it('labels modes and full rooms', () => {
    expect(modeLabel('yard-skirmish')).toBe('Yard Skirmish');
    expect(modeLabel('capture-the-ball')).toBe('Capture The Ball');
    expect(isFull({ ...ROOM, humans: 12 } as never)).toBe(true);
  });
});

/** Manual timers + a scripted fetch. */
function harness(script: Array<'ok' | 'empty' | 'fail' | 429 | 500 | 'hang'>) {
  const timers: Array<{ fn: () => void; at: number; id: number }> = [];
  let clock = 0, nextId = 1, online = true;
  const calls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push(url);
    const step = script.shift() ?? 'ok';
    if (step === 'hang') return new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    if (step === 'fail') throw new TypeError('Failed to fetch');
    if (step === 429 || step === 500) return { ok: false, status: step, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => (step === 'empty' ? [] : [ROOM]) };
  };
  const states: RoomsState['kind'][] = [];
  const p = new RoomPoller({
    fetch, online: () => online, now: () => clock,
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ fn, at: clock + ms, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  });
  p.onChange = (s) => states.push(s.kind);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  /** Advance the fake clock, firing due timers in order. */
  const advance = async (ms: number) => {
    const end = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      clock = t.at;
      t.fn();
      await flush(); await flush();
    }
    clock = end;
  };
  return { p, states, calls, advance, flush, setOnline: (v: boolean) => { online = v; }, pending: () => timers.length };
}

describe('room poller', () => {
  it('loading → ready, then refreshes every 5 s; stop() cancels everything', async () => {
    const h = harness(['ok', 'empty', 'ok']);
    h.p.start('ws://localhost:8791');
    expect(h.states).toEqual(['loading']);
    await h.flush(); await h.flush();
    expect(h.p.state).toMatchObject({ kind: 'ready', rooms: [{ name: 'porch' }] });
    expect(h.calls).toEqual(['http://localhost:8791/rooms']);
    await h.advance(4999);
    expect(h.calls).toHaveLength(1);
    await h.advance(1);
    expect(h.calls).toHaveLength(2);
    expect(h.p.state.kind).toBe('empty');
    h.p.stop();
    expect(h.p.state.kind).toBe('idle');
    await h.advance(20_000);
    expect(h.calls).toHaveLength(2);
    expect(h.pending()).toBe(0);
  });

  it('keeps the last good list through errors; 429/503 read as busy; offline and bad URLs have their own state', async () => {
    const h = harness(['ok', 'fail', 429, 500, 'fail', 'fail', 'ok']);
    h.p.start('ws://h:1');
    await h.flush(); await h.flush();
    await h.advance(5000);
    expect(h.p.state).toMatchObject({ kind: 'error', rooms: [{ name: 'porch' }] });
    await h.advance(5000); // 1st failure: retry after 5 s
    expect(h.p.state.kind).toBe('busy');
    await h.advance(9999); // 2nd: backs off to 10 s
    expect(h.calls).toHaveLength(3);
    await h.advance(1);
    expect(h.p.state.kind).toBe('error');
    await h.advance(20_000); // 3rd: 20 s
    expect(h.calls).toHaveLength(5);
    await h.advance(30_000); // capped at 30 s
    expect(h.calls).toHaveLength(6);
    expect(h.p.state.kind).toBe('error');
    await h.advance(30_000); // success resets the cadence to 5 s
    expect(h.p.state.kind).toBe('ready');
    await h.advance(5000);
    expect(h.calls).toHaveLength(8);
    h.setOnline(false);
    await h.advance(5000);
    expect(h.p.state).toMatchObject({ kind: 'offline', rooms: [{ name: 'porch' }] });
    h.p.start('http://not-a-ws-url');
    expect(h.p.state.kind).toBe('bad-url');
  });

  it('times out a hung request, and ignores responses that arrive after switching servers', async () => {
    const h = harness(['hang', 'ok']);
    h.p.start('ws://a:1');
    await h.advance(4000); // ROOMS_TIMEOUT_MS aborts the hung fetch
    expect(h.p.state.kind).toBe('error');
    const g = harness(['hang', 'ok']);
    g.p.start('ws://a:1');
    g.p.start('ws://b:2'); // switch while the first request hangs
    await g.flush(); await g.flush();
    expect(g.p.state.kind).toBe('ready');
    expect(g.calls).toEqual(['http://a:1/rooms', 'http://b:2/rooms']);
  });

  it('Retry polls immediately', async () => {
    const h = harness(['fail', 'ok']);
    h.p.start('ws://h:1');
    await h.flush(); await h.flush();
    expect(h.p.state.kind).toBe('error');
    h.p.refresh();
    expect(h.p.state.kind).toBe('loading');
    await h.flush(); await h.flush();
    expect(h.p.state.kind).toBe('ready');
  });
});
