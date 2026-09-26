// Negative cases (MASTER_PLAN §9 Network DoD): invalid, duplicate, stale, out-of-order and far-ahead
// inputs are rejected or harmless; malformed/oversize frames are refused; a client cannot move
// another client's entity; spam is rate limited. Exercised on the same frame path as the server.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room, MAX_SEQ_AHEAD, MAX_QUEUE, type Conn } from '../../src/host/room';
import { parseClientFrame, validateClientMsg, MAX_MSG_BYTES, MAX_CMDS_PER_MSG } from '../../src/host/guard';
import { LoopbackSession } from '../../src/client/net/loopback';
import type { ClientMsg, ServerMsg } from '../../src/shared/protocol';
import { Btn, type InputCmd } from '../../src/shared/input';
import { PROTOCOL_VERSION } from '../../src/shared/constants';

const cmd = (seq: number, over: Partial<InputCmd> = {}): InputCmd => ({ seq, mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: 0, rt: 0, ...over });

async function makeRoom() {
  const sim = await Sim.create({ seed: 1 });
  const room = new Room(sim, { mode: 'test', botsPerTeam: [0, 0] });
  const inbox = new Map<string, ServerMsg[]>();
  const join = (id: string, team: 0 | 1 = 0) => {
    const box: ServerMsg[] = [];
    inbox.set(id, box);
    const conn: Conn = { id, send: (m) => box.push(m) };
    const slot = room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: id, team, cls: 'assault' })!;
    expect(slot).toBeTruthy();
    return slot;
  };
  return { sim, room, join, inbox };
}

describe('negative cases: validation', () => {
  it('refuses malformed, oversize and unknown frames', () => {
    const bad = [
      '{', 'null', '[]', '42', '"x"', '{"t":"nope"}', '{"t":"input"}', '{"t":"input","cmds":"x"}', '{"t":"input","cmds":[]}',
      JSON.stringify({ t: 'input', cmds: Array.from({ length: MAX_CMDS_PER_MSG + 1 }, (_, i) => cmd(i + 1)) }),
      '{"t":"input","cmds":[{"seq":"1","mx":0,"mz":0,"yaw":0,"pitch":0,"buttons":0}]}',
      '{"t":"input","cmds":[{"seq":1,"mx":1e400,"mz":0,"yaw":0,"pitch":0,"buttons":0}]}',
      '{"t":"input","cmds":[{"seq":1,"mx":0,"mz":0,"yaw":0,"pitch":0,"buttons":0},{"seq":2}]}',
      '{"t":"input","cmds":[{"seq":-5,"mx":0,"mz":0,"yaw":0,"pitch":0,"buttons":0}]}',
      '{"t":"ping","id":"a","ct":1}', '{"t":"team","team":5}', '{"t":"class","cls":"hacker"}', '{"t":"chat","text":123}',
      '{"t":"chat","text":"\\u0000\\u0007  "}', '{"t":"hello","v":"1"}',
      '['.repeat(3000) + ']'.repeat(3000),
      `{"t":"chat","text":"${'x'.repeat(MAX_MSG_BYTES)}"}`,
    ];
    for (const f of bad) expect(parseClientFrame(f).ok, f.slice(0, 60)).toBe(false);
    expect(validateClientMsg({ t: 'input', cmds: [cmd(1)] }).ok).toBe(true);
    const hello = validateClientMsg({ t: 'hello', v: 1, name: '<script>‮Evil\u0000Name-that-is-long', team: 7, cls: 'nope' });
    expect(hello.ok && hello.msg.t === 'hello' && hello.msg).toMatchObject({ name: 'scriptEvilName-t', team: -1, cls: 'assault' });
  });

  it('frames refused on the wire have no effect on the room', async () => {
    const sim = await Sim.create({ seed: 1 });
    const room = new Room(sim, { mode: 'test', botsPerTeam: [0, 0] });
    const s = new LoopbackSession(room);
    const net = { lagMs: 5, jitterMs: 0, lossPct: 0 };
    const a = s.addClient({ id: 'a', up: net, down: net, seed: 1, input: () => null });
    await s.run(500);
    const ent = sim.entities.get(room.players.get('a')!.entity)!;
    const before = { ...ent.pos };
    for (const f of ['{', '{"t":"input","cmds":[{"seq":1,"mx":"1"}]}', JSON.stringify({ t: 'input', cmds: [cmd(1, { mx: 1 }), { seq: 2, mx: 'boom' }] }), 'x'.repeat(20_000)]) a.link.sendText(f);
    await s.run(500);
    expect(a.link.stats.refused).toBe(4);
    expect(room.players.get('a')!.net.applied).toBe(0);
    expect(Math.hypot(ent.pos.x - before.x, ent.pos.z - before.z)).toBeLessThan(1e-9);
    room.dispose();
  });

  it('rejects a wrong protocol version and a full room', async () => {
    const { room } = await makeRoom();
    const got: ServerMsg[] = [];
    expect(room.join({ id: 'x', send: (m) => got.push(m) }, { t: 'hello', v: PROTOCOL_VERSION + 1, name: 'x', team: 0, cls: 'assault' })).toBeNull();
    expect(got[0]).toMatchObject({ t: 'reject' });
    room.dispose();
  });
});

describe('negative cases: input pipeline', () => {
  it('applies each input exactly once despite duplicates and redundant resends', async () => {
    const { room, join } = await makeRoom();
    const p = join('a');
    const send = (seqs: number[]) => room.handle('a', { t: 'input', cmds: seqs.map((q) => cmd(q)) });
    expect(send([1, 2, 3, 4])).toBe('ok');
    send([2, 3, 4, 5, 6]);
    send([5, 5, 5, 6]);
    send([4, 5, 6, 7, 8]);
    for (let i = 0; i < 8; i++) room.tick();
    expect(p.net.applied).toBe(8);
    expect(p.lastCmd.seq).toBe(8);
    send([6, 7, 8]); // all stale now
    expect(p.queue.length).toBe(0);
    room.tick();
    expect(p.net.applied).toBe(8);
    room.dispose();
  });

  it('orders out-of-order inputs and ignores ones that arrive after a later input was applied', async () => {
    const { room, join } = await makeRoom();
    const p = join('a');
    room.handle('a', { t: 'input', cmds: [cmd(1)] }); // the first input establishes the sequence base
    room.tick();
    for (const q of [4, 2, 3]) room.handle('a', { t: 'input', cmds: [cmd(q)] });
    const order: number[] = [];
    for (let i = 0; i < 3; i++) { room.tick(); order.push(p.lastCmd.seq); }
    expect(order).toEqual([2, 3, 4]);
    room.handle('a', { t: 'input', cmds: [cmd(6)] });
    room.tick();
    room.handle('a', { t: 'input', cmds: [cmd(5, { mx: 1, mz: 0 })] }); // arrives after 6 was applied: stale
    expect(p.queue.length).toBe(0);
    room.tick();
    expect(p.lastCmd.seq).toBe(6);
    expect(p.net.applied).toBe(5);
    room.dispose();
  });

  it('refuses inputs far ahead of the applied sequence and bounds the queue', async () => {
    const { room, join } = await makeRoom();
    const p = join('a');
    room.handle('a', { t: 'input', cmds: [cmd(1)] });
    room.tick();
    expect(room.handle('a', { t: 'input', cmds: [cmd(1 + MAX_SEQ_AHEAD + 10)] })).toBe('abuse');
    expect(p.queue.length).toBe(0);
    expect(p.net.refused).toBe(1);
    // more than MAX_QUEUE inputs at once (in legal-size messages): the oldest are dropped, the queue stays bounded
    for (let k = 0, seq = 2; k < Math.ceil((MAX_QUEUE + 10) / 30); k++) {
      room.handle('a', { t: 'input', cmds: Array.from({ length: 30 }, () => cmd(seq++)) });
    }
    expect(p.queue.length).toBeLessThanOrEqual(MAX_QUEUE);
    expect(p.net.drops).toBeGreaterThan(0);
    room.dispose();
  });

  it('a client cannot move or respawn another client\'s entity', async () => {
    const { sim, room, join } = await makeRoom();
    const a = join('a', 0), b = join('b', 1);
    for (let i = 0; i < 30; i++) room.tick();
    const eb = sim.entities.get(b.entity)!;
    const bBefore = { ...eb.pos };
    const aBefore = { ...sim.entities.get(a.entity)!.pos };
    for (let q = 1; q <= 60; q++) {
      // Forged ownership fields are simply not part of the protocol.
      const forged = { t: 'input', pid: 'b', entity: b.entity, cmds: [{ ...cmd(q, { mx: 1, mz: 1, buttons: Btn.Jump }), entity: b.entity, id: b.entity, pid: 'b' }] } as unknown as ClientMsg;
      room.handle('a', forged);
      room.tick();
    }
    room.handle('a', { t: 'team', team: 1 });
    expect(b.entity).toBe(eb.id);
    expect(sim.entities.get(b.entity)).toBe(eb);
    expect(Math.hypot(eb.pos.x - bBefore.x, eb.pos.z - bBefore.z)).toBeLessThan(1e-6);
    const ea = sim.entities.get(a.entity)!;
    expect(Math.hypot(ea.pos.x - aBefore.x, ea.pos.z - aBefore.z)).toBeGreaterThan(3);
    expect(room.handle('nobody', { t: 'input', cmds: [cmd(1)] })).toBe('ignored');
    room.dispose();
  });

  it('rate-limits chat and class/team switching', async () => {
    const { sim, room, join, inbox } = await makeRoom();
    const a = join('a');
    join('b');
    for (let i = 0; i < 5; i++) room.handle('a', { t: 'chat', text: `spam ${i}` });
    expect(inbox.get('b')!.filter((m) => m.t === 'chat').length).toBe(1);
    const e0 = a.entity;
    room.handle('a', { t: 'class', cls: 'breacher' });
    const e1 = a.entity;
    room.handle('a', { t: 'class', cls: 'warden' }); // class limiter: ignored
    expect(e1).not.toBe(e0);
    expect(a.entity).toBe(e1);
    expect(a.cls).toBe('breacher');
    // team has its own limiter: the menu sends class + team in one tick and both must land
    room.handle('a', { t: 'team', team: 1 });
    const e2 = a.entity;
    expect(a.team).toBe(1);
    expect(e2).not.toBe(e1);
    room.handle('a', { t: 'team', team: 0 }); // team limiter: ignored
    expect(a.team).toBe(1);
    expect(a.entity).toBe(e2);
    for (let i = 0; i < 61; i++) room.tick();
    room.handle('a', { t: 'class', cls: 'warden' });
    expect(a.cls).toBe('warden');
    expect(sim.entities.has(e0)).toBe(false);
    room.dispose();
  });

  it('stops a starved player instead of running on forever', async () => {
    const { sim, room, join } = await makeRoom();
    const p = join('a');
    for (let q = 1; q <= 30; q++) { room.handle('a', { t: 'input', cmds: [cmd(q)] }); room.tick(); }
    for (let i = 0; i < 90; i++) room.tick(); // client went silent
    const e = sim.entities.get(p.entity)!;
    expect(Math.hypot(e.vel.x, e.vel.z)).toBeLessThan(0.01);
    expect(p.net.starves).toBe(90);
    room.dispose();
  });
});
