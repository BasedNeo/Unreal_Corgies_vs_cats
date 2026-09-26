// Lifecycle under emulated 150 ms RTT / 3 % loss: late join sees existing entities, leave removes the
// entity for everyone, rejoin is a fresh entity, a mid-session class switch re-spawns the predicted
// player without dropping the snapshot buffer, and a kill-plane teleport snaps instead of smoothing.
// (Real-socket lifecycle incl. room cleanup: net-server.test.ts.)
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { LoopbackSession, type LinkEmulation } from '../../src/client/net/loopback';
import type { InputCmd } from '../../src/shared/input';
import { NetClient } from '../../src/client/net/net-client';
import type { Transport } from '../../src/client/net/transport';
import { packEntity, type EntityState, type MatchState, type ServerMsg } from '../../src/shared/protocol';
import { bus } from '../../src/client/core/events';

const LINK: LinkEmulation = { lagMs: 75, jitterMs: 15, lossPct: 3 };
const forward = (k: number): Partial<InputCmd> => ({ mz: 1, yaw: k * 0.02 });

describe('lifecycle under 150 ms / 3 %', () => {
  it('late join, leave, rejoin', async () => {
    const sim = await Sim.create({ seed: 1 });
    const room = new Room(sim, { mode: 'test', botsPerTeam: [0, 0] });
    const s = new LoopbackSession(room);
    const a = s.addClient({ id: 'a', up: LINK, down: LINK, seed: 1, input: forward });
    await s.run(1500);
    const aEnt = a.net.localEntity;
    expect(a.net.prediction.active).toBe(true);
    const b = s.addClient({ id: 'b', up: LINK, down: LINK, seed: 2, input: () => ({}) });
    await s.run(600);
    // Late joiner sees the existing player close to where the authority has it (~RTT/2 + interp delay behind).
    const seen = b.net.latestState(aEnt)!;
    const truth = sim.entities.get(aEnt)!.pos;
    expect(seen).toBeTruthy();
    expect(Math.hypot(seen.x - truth.x, seen.z - truth.z)).toBeLessThan(6.4 * 0.3);
    s.removeClient(a);
    await s.run(600);
    expect(b.net.latestState(aEnt)).toBeNull();
    expect(sim.entities.has(aEnt)).toBe(false);
    const a2 = s.addClient({ id: 'a2', up: LINK, down: LINK, seed: 3, input: forward });
    await s.run(800);
    expect(a2.net.localEntity).not.toBe(aEnt);
    expect(b.net.latestState(a2.net.localEntity)).not.toBeNull();
    expect(a2.net.prediction.active).toBe(true);
    for (const c of [...s.clients]) s.removeClient(c);
    expect(room.humanCount).toBe(0);
    room.dispose();
  });

  it('class switch re-spawns the predicted player; a kill-plane teleport snaps', async () => {
    const sim = await Sim.create({ seed: 1 });
    const room = new Room(sim, { mode: 'test', botsPerTeam: [0, 0] });
    const s = new LoopbackSession(room);
    const a = s.addClient({ id: 'a', up: LINK, down: LINK, seed: 4, input: forward });
    const b = s.addClient({ id: 'b', up: LINK, down: LINK, seed: 5, input: () => ({}) });
    await s.run(1500);
    const e0 = a.net.localEntity;
    const snaps0 = a.net.prediction.snaps;
    a.net.transport.send({ t: 'class', cls: 'breacher' });
    await s.run(800);
    expect(a.net.localEntity).not.toBe(e0);
    expect(a.net.latest()!.ents.has(b.net.localEntity)).toBe(true); // snapshot buffer survived
    expect(a.net.prediction.active).toBe(true);
    expect(a.net.prediction.snaps).toBe(snaps0 + 1);
    // Fall out of the world: the authority's kill plane teleports to a spawn.
    const ent = sim.entities.get(a.net.localEntity)!;
    sim.placeCharacter(ent, ent.pos.x, sim.worldData.killY - 1, ent.pos.z);
    const snaps1 = a.net.prediction.snaps;
    await s.run(800);
    expect(a.net.prediction.snaps).toBeGreaterThan(snaps1);
    expect(a.net.prediction.bigCorrections).toBe(0);
    for (const c of [...s.clients]) s.removeClient(c);
    room.dispose();
  });
});

describe('roster stats', () => {
  it('reset per-player kills/deaths/score when the match restarts', async () => {
    const sim = await Sim.create({ seed: 1 });
    const room = new Room(sim, { mode: 'test', botsPerTeam: [0, 0] });
    const conn = (id: string) => ({ id, send: () => {} });
    const a = room.join(conn('a'), { t: 'hello', v: 1, name: 'a', team: 0, cls: 'assault' })!;
    const b = room.join(conn('b'), { t: 'hello', v: 1, name: 'b', team: 1, cls: 'assault' })!;
    sim.emit({ e: 'death', id: b.entity, by: a.entity });
    room.tick();
    expect([a.kills, a.score, b.deaths]).toEqual([1, 100, 1]);
    sim.emit({ e: 'score', team: 0, pts: 0, reason: 'reset' }); // what the match rules emit on restart
    room.tick();
    expect([a.kills, a.score, b.deaths]).toEqual([0, 0, 0]);
    // Fallback signal: phase leaves 'ended'.
    sim.emit({ e: 'death', id: a.entity, by: b.entity });
    sim.state.match = { mode: 'test', phase: 'ended', timeLeft: 5, score: [0, 1], objective: '', wave: 0, winner: 1 };
    room.tick();
    expect([b.kills, a.deaths]).toEqual([1, 1]);
    sim.state.match = { mode: 'test', phase: 'warmup', timeLeft: 5, score: [0, 0], objective: '', wave: 0, winner: -1 };
    room.tick();
    expect([b.kills, a.deaths]).toEqual([0, 0]);
    room.dispose();
  });
});

describe('client liveness', () => {
  function fake() {
    let deliver: (m: ServerMsg) => void = () => {};
    let closed = false;
    const t: Transport = { kind: 'loopback', lossy: false, send: () => {}, onMessage: (cb) => { deliver = cb; }, onClose: () => {}, close: () => { closed = true; } };
    return { t, deliver: (m: ServerMsg) => deliver(m), isClosed: () => closed };
  }
  const welcome: ServerMsg = { t: 'welcome', pid: 'p', entity: 1, tick: 0, mapSeed: 1, mode: 'x', tickHz: 60 };

  it('awaits its spawn after a welcome: inputs wait until our entity is in a snapshot (spawn-facing race)', () => {
    const f = fake();
    const net = new NetClient(f.t, { now: () => 0, pingIntervalMs: 0, predict: false });
    const spawned: number[] = [];
    const off = bus.on('localSpawn', (id) => spawned.push(id));
    expect(net.awaitingSpawn).toBe(false);
    f.deliver(welcome);
    expect(net.awaitingSpawn).toBe(true);
    const me = { id: 1, kind: 0, team: 0, species: 0, cls: 0, seed: 0, x: 0, y: 0, z: 0, yaw: -0.83, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 100, maxHp: 100, anim: 0, flags: 0, weapon: 0, ammo: 0 };
    const match: MatchState = { mode: 'x', phase: 'live', timeLeft: 0, score: [0, 0], objective: '', wave: 0, winner: -1 };
    f.deliver({ t: 'snap', tick: 1, ack: 0, you: 1, ents: [], gone: [], match, ev: [] });
    expect(net.awaitingSpawn).toBe(true); // a snapshot without us yet
    f.deliver({ t: 'snap', tick: 2, ack: 0, you: 1, ents: [packEntity(me as EntityState)], gone: [], match, ev: [] });
    expect(net.awaitingSpawn).toBe(false);
    expect(spawned).toEqual([1]);
    expect(net.latestState(1)!.yaw).toBeCloseTo(-0.83, 2); // what main.ts turns the camera to before sending
    off();
  });

  it('times out a silent link after timeoutMs worth of silent timer periods', () => {
    const f = fake();
    let now = 0;
    const net = new NetClient(f.t, { now: () => now, pingIntervalMs: 0, predict: false, timeoutMs: 5000 });
    const reasons: string[] = [];
    const off = bus.on('disconnected', (r) => reasons.push(r));
    f.deliver(welcome);
    for (let i = 0; i < 5; i++) { now += 1000; net.tickTimers(); }
    expect(net.connected).toBe(true); // the first period still saw the welcome
    now += 1000; net.tickTimers();
    expect(net.connected).toBe(false);
    expect(f.isClosed()).toBe(true);
    expect(reasons).toEqual(['connection timed out']);
    off();
  });

  it('never times out because the main thread stalled', () => {
    const f = fake();
    let now = 0;
    const net = new NetClient(f.t, { now: () => now, pingIntervalMs: 0, predict: false, timeoutMs: 5000 });
    f.deliver(welcome);
    for (let i = 0; i < 20; i++) {
      now += 30_000; // a 30 s frame: timers and queued messages all run late
      net.tickTimers();
      f.deliver({ t: 'pong', id: i, ct: now - 20, st: 0 });
    }
    expect(net.connected).toBe(true);
  });
});
