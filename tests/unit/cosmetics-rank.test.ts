// W9 K3: the veteran rank look. A 'rank' slot (the corgi sergeant's chevrons, the cat commander's medal; worn as the K2
// veteran kit) unlocks at level 10 through the profile/XP flow and the LOCKER, persists in `cvc.profile`, is sanitized
// like every other slot in hello and the `look` message, shows on another client (in-process room, through the real
// wire encoder), and changes nothing in the simulation.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { validateClientMsg } from '../../src/host/guard';
import { SnapDecoder, SnapEncoder, encodeServerMsg, decodeServerFrame } from '../../src/host/wire';
import { PROTOCOL_VERSION, TICK_HZ } from '../../src/shared/constants';
import { unpackEntity, type ClientMsg, type EntityState, type RosterEntry, type ServerMsg } from '../../src/shared/protocol';
import {
  COSMETICS, LOOK_SLOTS, VETERAN_RANKS, cosmeticsFor, defaultLook, randomLook, resolveLook, sanitizeLook, unlockHint, wearsVeteranRank, type Look,
} from '../../src/shared/content/cosmetics';
import { Btn } from '../../src/shared/input';
import { Species, Team } from '../../src/shared/types';
import { ProfileStore } from '../../src/client/profile';
import { freshProfile } from '../../src/client/profile/schema';
import { nextLevelUnlock } from '../../src/client/profile/unlocks';
import { xpForLevel, levelForXp } from '../../src/client/profile/xp';
import { lockerModel, itemPreview } from '../../src/client/ui/locker';
import { EntityViews } from '../../src/client/views/entity-views';
import { characterCacheSize, type CharacterAvatar } from '../../src/client/procgen/characters';

class MemKV { map = new Map<string, string>(); getItem(k: string) { return this.map.get(k) ?? null; } setItem(k: string, v: string) { this.map.set(k, v); } }

describe('K3 rank: content', () => {
  it('a rank slot: no rank by default, the sergeant (corgi) and the commander (cat) at level 10', () => {
    expect(LOOK_SLOTS).toContain('rank');
    expect(cosmeticsFor(Species.Corgi, 'rank').map((c) => c.id)).toEqual(['rank_none', 'rank_sergeant']);
    expect(cosmeticsFor(Species.Cat, 'rank').map((c) => c.id)).toEqual(['rank_none', 'rank_commander']);
    for (const id of VETERAN_RANKS) expect(COSMETICS.find((c) => c.id === id)!.unlock).toEqual({ kind: 'level', level: 10 });
    expect(unlockHint({ kind: 'level', level: 10 })).toBe('Reach level 10');
    expect(defaultLook(Species.Corgi).rank).toBe('rank_none');
    expect(defaultLook(Species.Cat).rank).toBe('rank_none');
    // bots never draw a rank from their look (their veterans come from the seed): every existing bot look is unchanged
    for (let seed = 0; seed < 50; seed++) expect(randomLook(seed, Species.Cat).rank).toBe('rank_none');
  });

  it('sanitized like every slot: the other species\' rank, unknown, huge and prototype ids are dropped; wearsVeteranRank follows', () => {
    expect(sanitizeLook({ rank: 'rank_sergeant' }, 'corgi')).toEqual({ rank: 'rank_sergeant' });
    expect(sanitizeLook({ rank: 'rank_sergeant' }, 'cat')).toEqual({});            // a corgi rank on a cat
    expect(sanitizeLook({ rank: 'rank_general' }, 'corgi')).toEqual({});
    expect(sanitizeLook({ rank: 'r'.repeat(10_000) }, 'corgi')).toEqual({});
    expect(sanitizeLook({ rank: 'coat_red', coat: 'rank_sergeant' }, 'corgi')).toEqual({}); // wrong slots
    expect(sanitizeLook(JSON.parse('{"__proto__": {"rank": "rank_sergeant"}}'), 'corgi')).toEqual({});
    expect(resolveLook({ rank: 'rank_commander' }, Species.Cat).rank).toBe('rank_commander');
    expect(wearsVeteranRank({ rank: 'rank_sergeant' }, Species.Corgi)).toBe(true);
    expect(wearsVeteranRank({ rank: 'rank_sergeant' }, Species.Cat)).toBe(false);
    expect(wearsVeteranRank({ rank: 'rank_none' }, Species.Corgi)).toBe(false);
    expect(wearsVeteranRank(null, Species.Corgi)).toBe(false);
    expect(wearsVeteranRank({ rank: 42 } as unknown as Look, Species.Corgi)).toBe(false);
    // the guard (hello + look) goes through the same sanitizer
    const hello = validateClientMsg({ t: 'hello', v: PROTOCOL_VERSION, name: 'A', team: 0, cls: 'assault', looks: { corgi: { rank: 'rank_sergeant' }, cat: { rank: 'rank_sergeant' } } });
    expect(hello.ok && hello.msg.t === 'hello' && hello.msg.looks).toEqual({ corgi: { rank: 'rank_sergeant' }, cat: {} });
    const look = validateClientMsg({ t: 'look', species: 'cat', look: { rank: 'rank_commander', neck: 'x'.repeat(99) } });
    expect(look.ok && look.msg).toEqual({ t: 'look', species: 'cat', look: { rank: 'rank_commander' } });
  });
});

describe('K3 rank: unlocked at level 10, in the locker, persisted', () => {
  it('locked below level 10 (equip refused), unlocked by the match that reaches 10, shown as the next reward, equipped and persisted', () => {
    const kv = new MemKV();
    const almost = xpForLevel(10) - 50;
    expect(levelForXp(almost)).toBe(9);
    kv.setItem('cvc.profile', JSON.stringify({ ...freshProfile(), xp: almost, firstWins: ['team-deathmatch'], unlocked: COSMETICS.filter((c) => c.unlock.kind === 'level' && c.unlock.level < 10).map((c) => c.id) }));
    const store = new ProfileStore({ storage: kv, content: COSMETICS });
    const p9 = store.load();
    expect(p9.level).toBe(9);
    expect(nextLevelUnlock(p9, COSMETICS)).toEqual({ level: 10, items: COSMETICS.filter((c) => VETERAN_RANKS.includes(c.id)) });
    expect(store.equip('corgi', { rank: 'rank_sergeant' })).toMatchObject({ ok: false, reason: 'locked' });
    expect(store.currentLook('corgi').rank).toBe('rank_none');
    const sum = store.recordMatch({ mode: 'team-deathmatch', outcome: 'win', knockouts: 3 });
    expect(store.load().level).toBe(10);
    expect(sum.newLooks.map((l) => l.id).sort()).toEqual(['rank_commander', 'rank_sergeant']);
    expect(store.equip('cat', { rank: 'rank_sergeant' })).toMatchObject({ ok: false, reason: 'species' });
    expect(store.equip('corgi', { rank: 'rank_sergeant' }).ok).toBe(true);
    expect(store.equip('cat', { rank: 'rank_commander' }).ok).toBe(true);
    // persisted: a new store over the same storage (a reload) wears them
    const again = new ProfileStore({ storage: kv, content: COSMETICS });
    expect(again.currentLook('corgi').rank).toBe('rank_sergeant');
    expect(again.currentLook('cat').rank).toBe('rank_commander');
    expect(JSON.parse(kv.getItem('cvc.profile')!).equipped).toMatchObject({ corgi: { rank: 'rank_sergeant' }, cat: { rank: 'rank_commander' } });
    expect(wearsVeteranRank(resolveLook(again.currentLook('corgi'), 'corgi'), 'corgi')).toBe(true);
  });

  it('the LOCKER shows the RANK slot: No Rank + the species\' rank with its level-10 hint, a glyph each', () => {
    const p = { ...freshProfile(), xp: xpForLevel(4), level: 4 };
    const m = lockerModel(p, 'corgi', 'rank');
    expect(m.items.map((i) => [i.id, i.locked, i.hint])).toEqual([['rank_none', false, ''], ['rank_sergeant', true, 'Reach level 10']]);
    expect(lockerModel(p, 'cat', 'rank').items.map((i) => i.id)).toEqual(['rank_none', 'rank_commander']);
    for (const id of ['rank_none', 'rank_sergeant', 'rank_commander']) expect(itemPreview({ id, slot: 'rank' })).toMatch(/^<span class="lo-gl"><svg viewBox="0 0 48 48"/);
  });
});

describe('K3 rank: online', () => {
  type Conn = { id: string; send(m: ServerMsg): void; inbox: ServerMsg[] };
  /** A client connection that receives through the real wire path (per-connection delta encoder → decoder). */
  function wireConn(id: string): Conn {
    const enc = new SnapEncoder(), dec = new SnapDecoder(), inbox: ServerMsg[] = [];
    return { id, inbox, send(m) { const d = decodeServerFrame(encodeServerMsg(m, enc), dec); if (d) inbox.push(d); } };
  }
  const hello = (looks: unknown, team: 0 | 1, name: string): Extract<ClientMsg, { t: 'hello' }> => {
    const v = validateClientMsg({ t: 'hello', v: PROTOCOL_VERSION, name, team, cls: 'assault', looks });
    if (!v.ok || v.msg.t !== 'hello') throw new Error('hello refused');
    return v.msg;
  };
  const lastRoster = (c: Conn): RosterEntry[] => [...c.inbox].reverse().find((m): m is Extract<ServerMsg, { t: 'roster' }> => m.t === 'roster')?.players ?? [];
  const lastStates = (c: Conn): Map<number, EntityState> => {
    const snap = [...c.inbox].reverse().find((m): m is Extract<ServerMsg, { t: 'snap' }> => m.t === 'snap')!;
    return new Map(snap.ents.map((a) => { const s = unpackEntity(a); return [s.id, s]; }));
  };

  it('worn online: A\'s rank rides hello → roster, and B\'s client draws A as the veteran kit; a LOCKER equip is worn from the next spawn', async () => {
    const sim = await Sim.create({ seed: 3 });
    const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [0, 0] });
    const a = wireConn('a'), b = wireConn('b');
    const A = room.join(a, hello({ corgi: { coat: 'corgi_tricolor', rank: 'rank_sergeant' } }, 0, 'Ann'))!;
    const B = room.join(b, hello(undefined, 1, 'Bob'))!;
    for (let i = 0; i < 10; i++) room.tick();
    const rosterA = lastRoster(b).find((r) => r.pid === A.pid)!;
    expect(rosterA.look).toEqual({ coat: 'corgi_tricolor', rank: 'rank_sergeant' });
    expect(lastRoster(b).find((r) => r.pid === B.pid)).not.toHaveProperty('look');
    // B's client: its entity views over what B received
    const views = new EntityViews(new THREE.Scene(), { lookOf: (id) => lastRoster(b).find((r) => r.entity === id)?.look });
    views.sync(lastStates(b), B.entity, 1 / 60);
    const av = (id: number) => views.get(id)!.avatar as CharacterAvatar;
    expect(av(A.entity).stats.veteran).toBe(true);
    expect(av(A.entity).stats.look).toMatchObject({ coat: 'corgi_tricolor', rank: 'rank_sergeant' });
    expect(av(B.entity).stats.veteran).toBe(false);
    // A takes the rank off in the LOCKER: sanitized, worn from the next spawn, B's view rebuilds A as the plain kit
    const msg = validateClientMsg({ t: 'look', species: 'corgi', look: { coat: 'corgi_tricolor', rank: 'rank_none' } });
    room.handle(A.pid, (msg as { msg: ClientMsg }).msg);
    room.tick();
    expect(lastRoster(b).find((r) => r.pid === A.pid)!.look?.rank).toBe('rank_sergeant'); // still the old body
    sim.emit({ e: 'spawn', id: A.entity });
    for (let i = 0; i < 3; i++) room.tick();
    expect(lastRoster(b).find((r) => r.pid === A.pid)!.look?.rank).toBe('rank_none');
    views.sync(lastStates(b), B.entity, 1 / 60);
    expect(av(A.entity).stats.veteran).toBe(false);
    views.sync(new Map(), B.entity, 1 / 60);
    expect(characterCacheSize()).toBe(0);
    room.dispose();
  });

  it('no combat power: the same room with and without the rank plays out identically (every snapshot equal) through a firefight', async () => {
    const run = async (rank: string) => {
      const sim = await Sim.create({ seed: 8 });
      const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [2, 2] });
      const snaps: string[] = [];
      const conn = { id: 'c', send: (m: ServerMsg) => { if (m.t === 'snap') snaps.push(JSON.stringify(m.ents)); } };
      const slot = room.join(conn, hello({ corgi: { rank } }, 0, 'Ann'))!;
      let seq = 0;
      for (let t = 0; t < TICK_HZ * 12; t++) {
        const buttons = (t % 90 < 60 ? Btn.Fire : 0) | (t % 240 < 120 ? Btn.Aim : 0);
        room.handle(slot.pid, { t: 'input', cmds: [{ seq: ++seq, mx: t % 200 < 100 ? 0 : 1, mz: -1, yaw: (t % 360) * 0.01, pitch: 0, buttons, rt: Math.max(0, sim.tick - 4) }] });
        room.tick();
      }
      const look = sim.entities.get(slot.entity)!.data.look as Look;
      room.dispose();
      return { snaps, look };
    };
    const ranked = await run('rank_sergeant'), plain = await run('rank_none');
    expect(ranked.look.rank).toBe('rank_sergeant');
    expect(plain.look.rank).toBe('rank_none');
    expect(ranked.snaps.length).toBeGreaterThan(TICK_HZ * 5);
    expect(ranked.snaps).toEqual(plain.snaps);
    expect(ranked.snaps.join('')).not.toMatch(/rank_/); // looks never ride the snapshot
  }, 60_000);
});
