// N2 (Wave 6): looks online. The hello carries each species' equipped look, the authority sanitizes it (unknown ids,
// wrong species, huge strings and prototype keys dropped, never echoed), the roster carries the look the body wears,
// bots wear a seeded randomLook (no network, same on every machine), taunts use the look's pack, and a LOCKER equip
// mid-session is worn from the next spawn. Looks ride the roster, never the snapshot.
import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { validateClientMsg } from '../../src/host/guard';
import { PROTOCOL_VERSION, TICK_HZ } from '../../src/shared/constants';
import type { ClientMsg, RosterEntry, ServerMsg } from '../../src/shared/protocol';
import { TAUNT_PACKS, randomLook, type Look } from '../../src/shared/content/cosmetics';
import { Btn } from '../../src/shared/input';
import { EntityKind, Team } from '../../src/shared/types';

type Hello = Extract<ClientMsg, { t: 'hello' }>;
const TRICOLOR: Look = { coat: 'corgi_tricolor', neck: 'neck_bandana', taunt: 'taunt_corgi_herder' };
const TUXEDO: Look = { coat: 'cat_tuxedo', neck: 'neck_bowtie', taunt: 'taunt_cat_royal' };

function hello(looks?: unknown, team: 0 | 1 = 0): Hello {
  const v = validateClientMsg({ t: 'hello', v: PROTOCOL_VERSION, name: 'Ann', team, cls: 'assault', looks });
  if (!v.ok || v.msg.t !== 'hello') throw new Error('hello refused');
  return v.msg;
}

async function room(seed = 1, bots: [number, number] = [0, 0]) {
  const sim = await Sim.create({ seed });
  const r = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: bots });
  const inbox: ServerMsg[] = [];
  const conn = { id: 'c1', send: (m: ServerMsg) => inbox.push(m) };
  const roster = (): RosterEntry[] => [...inbox].reverse().find((m): m is Extract<ServerMsg, { t: 'roster' }> => m.t === 'roster')?.players ?? [];
  return { sim, r, inbox, conn, roster };
}

describe('N2: looks online', () => {
  it('the guard keeps known ids of the right species only: hostile looks are dropped, never echoed', () => {
    expect(hello({ corgi: TRICOLOR, cat: TUXEDO }).looks).toEqual({ corgi: TRICOLOR, cat: TUXEDO });
    const bad = hello({
      corgi: { coat: 'x'.repeat(10_000), neck: 'neck_bandana', taunt: 'taunt_cat_royal' }, // 10 kB id; a cat pack
      cat: { coat: 'corgi_red' },                                                          // a corgi coat on a cat
    });
    expect(bad.looks).toEqual({ corgi: { neck: 'neck_bandana' }, cat: {} });
    const proto = JSON.parse('{"__proto__": {"coat": "corgi_merle"}, "constructor": {"coat": "corgi_sable"}}');
    expect(hello(proto).looks).toEqual({ corgi: {}, cat: {} });
    expect(hello('look at me').looks).toEqual({ corgi: {}, cat: {} });
    expect(hello([TRICOLOR]).looks).toEqual({ corgi: {}, cat: {} });
    expect(JSON.stringify(bad)).not.toContain('xxxx');
  });

  it('the roster carries the look for the species you play; a team switch wears the other one; no look → none', async () => {
    const { r, conn, roster, sim } = await room();
    const slot = r.join(conn, hello({ corgi: TRICOLOR, cat: TUXEDO }))!;
    r.tick();
    expect(roster().find((p) => p.pid === slot.pid)?.look).toEqual(TRICOLOR);
    expect(sim.entities.get(slot.entity)!.data.look).toEqual(TRICOLOR); // what the sim's taunts read
    r.handle(slot.pid, { t: 'team', team: Team.Cats });                 // at deploy: respawns as a cat
    r.tick();
    expect(roster().find((p) => p.pid === slot.pid)?.look).toEqual(TUXEDO);
    r.dispose();
    const b = await room();
    const plain = b.r.join(b.conn, hello(undefined))!;                  // an old client: the seed's classic coat
    b.r.tick();
    expect(b.roster().find((p) => p.pid === plain.pid)).not.toHaveProperty('look');
    b.r.dispose();
  });

  it('bots wear randomLook(seed): the same on two rooms with the same seed, never on the roster', async () => {
    const looksOf = async () => {
      const { sim, r, conn, roster } = await room(4, [3, 3]);
      r.join(conn, hello(undefined));
      r.tick();
      const bots = [...sim.entities.values()].filter((e) => e.kind === EntityKind.Bot);
      expect(bots.length).toBe(5); // 3 per team, the human fills one corgi slot
      for (const e of bots) expect(e.data.look).toEqual(randomLook(e.seed, e.species));
      expect(roster().filter((p) => p.bot).every((p) => p.look === undefined)).toBe(true);
      const out = bots.map((e) => JSON.stringify(e.data.look));
      r.dispose();
      return out;
    };
    expect(await looksOf()).toEqual(await looksOf());
  });

  it('a taunt uses the look\'s pack', async () => {
    const { sim, r, conn, inbox } = await room();
    const slot = r.join(conn, hello({ corgi: TRICOLOR }))!;
    r.tick();
    r.handle(slot.pid, { t: 'input', cmds: [{ seq: 1, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: Btn.Emote, rt: sim.tick }] });
    for (let i = 0; i < 6; i++) r.tick();
    const barks = inbox.flatMap((m) => (m.t === 'snap' ? m.ev : [])).filter((e) => e.e === 'bark' && e.id === slot.entity);
    expect(barks.length).toBe(1);
    expect(TAUNT_PACKS.taunt_corgi_herder).toContain((barks[0] as { line: string }).line);
    r.dispose();
  });

  it('a LOCKER equip mid-session is worn from the next spawn (sanitized), not before', async () => {
    const { sim, r, conn, roster } = await room();
    const slot = r.join(conn, hello({ corgi: TRICOLOR }))!;
    r.tick();
    const next = validateClientMsg({ t: 'look', species: 'corgi', look: { coat: 'corgi_merle', neck: 'neck_spiked', taunt: 'taunt_cat_royal' } });
    expect(next.ok).toBe(true);
    expect(validateClientMsg({ t: 'look', species: 'dog', look: {} }).ok).toBe(false);
    r.handle(slot.pid, (next as { msg: ClientMsg }).msg);
    r.tick();
    expect(roster().find((p) => p.pid === slot.pid)?.look).toEqual(TRICOLOR); // still the old body
    sim.emit({ e: 'spawn', id: slot.entity });                               // the next (re)spawn
    r.tick();
    expect(roster().find((p) => p.pid === slot.pid)?.look).toEqual({ coat: 'corgi_merle', neck: 'neck_spiked' });
    r.dispose();
  });

  it('looks never ride the snapshot', async () => {
    const { r, conn, inbox } = await room(2, [2, 2]);
    r.join(conn, hello({ corgi: TRICOLOR, cat: TUXEDO }));
    for (let i = 0; i < TICK_HZ; i++) r.tick();
    const snaps = inbox.filter((m) => m.t === 'snap');
    expect(snaps.length).toBeGreaterThan(0);
    for (const s of snaps) expect(JSON.stringify(s)).not.toMatch(/corgi_|cat_|neck_|taunt_/);
    r.dispose();
  });
});
