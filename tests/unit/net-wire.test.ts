// Wire codec (per-connection delta snapshots) and the client's server-URL rule.
import { describe, it, expect } from 'vitest';
import { SnapEncoder, SnapDecoder, encodeServerMsg, decodeServerFrame, FIELD_SCALES, type SnapMsg } from '../../src/host/wire';
import { packEntity, unpackEntity, type EntityState, type MatchState } from '../../src/shared/protocol';
import { resolveServerUrl } from '../../src/client/net/server-url';
import { mulberry32 } from '../../src/shared/rng';

const rng = mulberry32(5);
function randomState(id: number): EntityState {
  return {
    id, kind: 0, team: (id % 2) as 0 | 1, species: 0, cls: id % 6, seed: Math.floor(rng() * 1e9),
    x: (rng() - 0.5) * 200, y: rng() * 10, z: (rng() - 0.5) * 200, yaw: rng() * 6.28, pitch: rng() - 0.5,
    vx: rng() * 10 - 5, vy: rng() * 10 - 5, vz: rng() * 10 - 5, hp: rng() * 120, maxHp: 120, anim: 2, flags: 1, weapon: 0, ammo: 30,
  } as EntityState;
}
const match = (t: number): MatchState => ({ mode: 'tdm', phase: 'live', timeLeft: 300 - t / 60, score: [Math.floor(t / 600), 0], objective: 'Win', wave: 1, winner: -1 });

describe('wire codec', () => {
  it('derives quantization scales from packEntity', () => {
    const names = Object.keys(unpackEntity([]));
    const scale = (n: string) => FIELD_SCALES[names.indexOf(n)];
    expect([scale('x'), scale('yaw'), scale('vx'), scale('hp'), scale('seed')]).toEqual([1000, 1000, 100, 10, 0]);
  });

  it('round-trips snapshots exactly across deltas, keyframes, spawns and removals', () => {
    const enc = new SnapEncoder(7), dec = new SnapDecoder();
    let states = new Map<number, EntityState>();
    for (let id = 1; id <= 12; id++) states.set(id, randomState(id));
    let nextId = 13;
    let rawBytes = 0, deltaBytes = 0;
    for (let tick = 2; tick < 400; tick += 2) {
      const gone: number[] = [];
      for (const s of states.values()) { s.x += s.vx / 30; s.z += s.vz / 30; if (rng() < 0.1) s.hp = Math.max(0, s.hp - 7.25); if (rng() < 0.05) s.anim = Math.floor(rng() * 8) as EntityState['anim']; }
      if (rng() < 0.05) { const id = [...states.keys()][0]; states.delete(id); gone.push(id); }
      if (rng() < 0.05) states.set(nextId, randomState(nextId++));
      const msg: SnapMsg = { t: 'snap', tick, ack: tick * 2, you: 3, ents: [...states.values()].map(packEntity), gone, match: match(tick), ev: [{ e: 'jump', id: 3, double: false }] };
      const text = encodeServerMsg(msg, enc);
      deltaBytes += text.length; rawBytes += JSON.stringify(msg).length;
      const out = decodeServerFrame(text, dec) as SnapMsg;
      expect(out.t).toBe('snap');
      expect(out.tick).toBe(tick);
      expect(out.ack).toBe(tick * 2);
      const sort = (a: number[][]) => [...a].sort((p, q) => p[0] - q[0]);
      expect(sort(out.ents)).toEqual(sort(msg.ents));
      expect(out.match).toEqual({ ...msg.match, timeLeft: Math.round(msg.match.timeLeft * 10) / 10 });
      expect(out.ev).toEqual(msg.ev);
      states = new Map([...states].map(([k, v]) => [k, { ...v }]));
    }
    expect(deltaBytes).toBeLessThan(rawBytes * 0.6);
  });

  it('rounds event floats to millimetres and passes other messages through', () => {
    const enc = new SnapEncoder(), dec = new SnapDecoder();
    const msg: SnapMsg = { t: 'snap', tick: 2, ack: 0, you: 1, ents: [], gone: [], match: match(0), ev: [{ e: 'hit', src: 1, dst: 2, dmg: 12.3456789, x: 1.23456, y: 2.000049, z: -3.9999, crit: false }] };
    const out = decodeServerFrame(encodeServerMsg(msg, enc), dec) as SnapMsg;
    expect(out.ev[0]).toEqual({ e: 'hit', src: 1, dst: 2, dmg: 12.346, x: 1.235, y: 2, z: -4, crit: false });
    expect(decodeServerFrame(encodeServerMsg({ t: 'notice', text: 'hi' }, enc), dec)).toEqual({ t: 'notice', text: 'hi' });
    expect(decodeServerFrame('not json', dec)).toBeNull();
    expect(decodeServerFrame(encodeServerMsg(msg, null), dec)).toEqual(msg); // raw encoding still decodes
  });
});

describe('server URL rule', () => {
  const loc = (search: string, protocol = 'http:', host = 'game.example:8080') => ({ protocol, host, search });
  it('picks offline, explicit, ?online and prod-served pages correctly', () => {
    expect(resolveServerUrl(loc(''), null)).toBeNull();
    expect(resolveServerUrl(loc('?offline'), '/ws')).toBeNull();
    expect(resolveServerUrl(loc('?server=ws://localhost:8787'), null)).toBe('ws://localhost:8787');
    expect(resolveServerUrl(loc('?server=ws://localhost:8787&room=abc'), null)).toBe('ws://localhost:8787/?room=abc');
    expect(resolveServerUrl(loc('?online'), null)).toBe('ws://game.example:8080/ws');
    expect(resolveServerUrl(loc('', 'https:', 'cvc.example'), '/ws')).toBe('wss://cvc.example/ws');
    expect(resolveServerUrl(loc('?room=a%20b', 'https:', 'cvc.example'), '/ws')).toBe('wss://cvc.example/ws?room=default');
    expect(resolveServerUrl(loc('?server=javascript:alert(1)'), null)).toBeNull();
  });
});
