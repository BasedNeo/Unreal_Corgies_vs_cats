#!/usr/bin/env node
// Q4 verification probe (read-only): W9 K3 online rank and the heavy's guard.
//   npx tsx tools/qa4-k3.mjs rank  [--seeds 2,5] [--mode team-deathmatch|base-assault] [--seconds 45]
//        the same Room twice, a human (fake conn, fed by a rifleman stand-in through Room.handle) wearing the veteran
//        rank (hello looks: rank_sergeant / rank_commander) vs no rank: every tick's world hash must match
//   npx tsx tools/qa4-k3.mjs guard
//        the frontal guard: a real skirmish tabby heavy vs a player assault standing at the same spot, shot from the front
//        and from behind by the same rifle burst: heavy front ≈ 0.6×, heavy back 1×, player front 1×
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { applyArchetype } from '../src/sim/ai';
import { applyDamage } from '../src/sim/combat';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';
import { EntityKind, Species, Team } from '../src/shared/types';

const argv = process.argv.slice(2);
const scenario = argv[0] ?? 'rank';
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const out = (o) => console.log(JSON.stringify(o));
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
const mix = (h, v) => { f64[0] = v; for (let k = 0; k < 2; k++) { h ^= u32[k]; h = Math.imul(h, 16777619) >>> 0; } return h; };
const worldHash = (sim) => { let h = 2166136261; for (const e of sim.entities.values()) for (const v of [e.id, e.kind, e.pos.x, e.pos.y, e.pos.z, e.vel.x, e.vel.y, e.vel.z, e.yaw, e.pitch, e.health?.hp ?? -1, e.flags, e.dead ? 1 : 0]) h = mix(h, v); return h; };

if (scenario === 'rank') {
  const mode = opt('mode', 'team-deathmatch');
  for (const seed of opt('seeds', '2,5').split(',').map(Number)) {
    const runs = [];
    for (const rank of [true, false]) {
      const sim = await Sim.create({ seed });
      const room = new Room(sim, { mode, botsPerTeam: [3, 3] });
      const conns = [];
      const humans = [];
      for (const [team, cls] of [[Team.Corgis, 'assault'], [Team.Cats, 'overwatch']]) {
        const conn = { id: `h${team}`, sent: 0, send() { conn.sent++; } };
        const looks = rank ? { corgi: { rank: 'rank_sergeant' }, cat: { rank: 'rank_commander' } } : { corgi: { rank: 'rank_none' }, cat: { rank: 'rank_none' } };
        const slot = room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: `H${team}`, team, cls, looks });
        conns.push(conn); humans.push({ slot, seq: 0 });
      }
      const hashes = [];
      let worn = null;
      for (let t = 0; t < Number(opt('seconds', 45)) * TICK_HZ; t++) {
        for (const h of humans) {
          const e = sim.entities.get(h.slot.entity);
          if (!e) continue;
          if (!e.ai) applyArchetype(e, 'rifleman', { external: true });
          const c = e.ai.out;
          room.handle(h.slot.pid, { t: 'input', cmds: [{ seq: ++h.seq, mx: c.mx, mz: c.mz, yaw: c.yaw, pitch: c.pitch, buttons: c.buttons, rt: Math.max(0, sim.tick - 6) }] });
        }
        room.tick();
        hashes.push(worldHash(sim));
        if (t === 60) worn = humans.map((h) => sim.entities.get(h.slot.entity)?.data.look ?? null);
      }
      let deaths = 0; for (const p of room.players.values()) deaths += p.deaths;
      runs.push({ rank, hashes, worn, deaths, rosterLooks: [...room.players.values()].filter((p) => !p.bot).map((p) => p.looks) });
      room.dispose();
    }
    let first = -1;
    for (let i = 0; i < runs[0].hashes.length; i++) if (runs[0].hashes[i] !== runs[1].hashes[i]) { first = i + 1; break; }
    out({ scenario: 'rank', mode, seed, ticks: runs[0].hashes.length, identical: first < 0, firstDiff: first, deaths: runs.map((r) => r.deaths),
      wornWithRank: runs[0].worn, wornWithout: runs[1].worn });
  }
}

if (scenario === 'guard') {
  const sim = await Sim.create({ seed: 3 });
  sim.state.room = { mode: 'yard-skirmish' };
  for (let i = 0; i < 12 * TICK_HZ && sim.state.match?.phase !== 'live'; i++) { sim.step(); sim.drainEvents(); }
  const at = { x: 0, z: 10 };
  const heavy = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, cls: 'assault', name: 'Heavy', x: at.x, y: sim.worldData.height(at.x, at.z) + 0.02, z: at.z, yaw: 0 });
  applyArchetype(heavy, 'tabby_heavy');
  heavy.combat.pve = true;
  const player = sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Cats, species: Species.Cat, cls: 'assault', name: 'Player', x: at.x + 6, y: sim.worldData.height(at.x + 6, at.z) + 0.02, z: at.z, yaw: 0, ownerPid: 'p' });
  const front = sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'F', x: at.x, y: 0.02, z: at.z - 8, yaw: 0, ownerPid: 'f' });
  const back = sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'B', x: at.x, y: 0.02, z: at.z + 8, yaw: 0, ownerPid: 'b' });
  const res = {};
  for (const [label, target, src, yaw] of [['heavy front', heavy, front, 0], ['heavy back', heavy, back, 0], ['player front', player, front, 0]]) {
    target.yaw = yaw; // yaw 0 faces -z (yawToward): toward the front shooter at z - 8
    for (const c of [target]) { if (c.combat) c.combat.invulnUntil = 0; c.health.hp = c.health.max; }
    const hp0 = target.health.hp;
    applyDamage(sim, target, 20, { id: src.id, team: src.team, weapon: 0 }, target.pos.x, target.pos.y + 0.6, target.pos.z, false);
    res[label] = Math.round((hp0 - target.health.hp) * 100) / 100;
  }
  out({ scenario: 'guard', phase: sim.state.match?.phase, dmg20: res, heavyMaxHp: heavy.health.max, playerPve: !!player.combat?.pve, heavyPve: !!heavy.combat?.pve });
}
