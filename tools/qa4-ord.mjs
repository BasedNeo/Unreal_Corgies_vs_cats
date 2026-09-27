#!/usr/bin/env node
// Q4 verification probe (read-only): W9 X4 throwables through the real authority paths.
//   npx tsx tools/qa4-ord.mjs room            hostile client through Room.handle on the West Yard: kiosk fountain over
//                                              300 s of Throw spam, forged Throw without a carry, NaN/huge angles,
//                                              throwing while riding / taunting / dead
//   npx tsx tools/qa4-ord.mjs diff            the same throw by an Assault and a Breacher against a kart, an RC plane
//                                              and a Warden barrier: the damage must match (the throwable's numbers)
//   npx tsx tools/qa4-ord.mjs band            a real blast next to full-health targets of every class and species at
//                                              0-4.5 m: never lethal, max 70, falloff, self 35 %, teammates 0
//   npx tsx tools/qa4-ord.mjs bots [--modes team-deathmatch,core-rush,base-assault,yard-skirmish] [--maps west_yard,the_lot]
//                                  [--seeds 1,2,3] [--seconds 180]   bot throw rate, hits, kills, ally damage per match
import { loadavg } from 'node:os';
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { createDefaultSystems } from '../src/sim/systems';
import { kill, explode, ordnanceStats, liveOrdnance, ordnanceArcWorld } from '../src/sim/combat';
import { spawnKart } from '../src/sim/vehicles';
import { spawnPlane } from '../src/sim/vehicles/plane-systems';
import { ORDNANCE, ORDNANCE_RULES, makeSolve, solveThrow } from '../src/shared/content/ordnance';
import { CLASSES } from '../src/shared/content/classes';
import { surfaceAt } from '../src/shared/world/queries';
import { Btn, emptyInput } from '../src/shared/input';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';
import { CLASS_IDS, EFlag, EntityKind, Species, Team } from '../src/shared/types';

const argv = process.argv.slice(2);
const scenario = argv[0] ?? 'room';
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const listOf = (n, d) => String(opt(n, d)).split(',');
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const load = () => loadavg()[0].toFixed(1);
const out = (o) => console.log(JSON.stringify(o));
const fakeConn = (id) => { const c = { id, sent: [], send(m) { c.sent.push(m); if (c.sent.length > 200) c.sent.splice(0, 100); } }; return c; };
const hello = (team, cls = 'assault', name = 'Q4') => ({ t: 'hello', v: PROTOCOL_VERSION, name, team, cls });
const place = (sim, e, x, z, y) => sim.placeCharacter(e, x, y ?? surfaceAt(sim.worldData, x, z, 50).y + 0.02, z);

// ------------------------------------------------------------------------------------------------ room abuse
if (scenario === 'room') {
  const sim = await Sim.create({ seed: 4 });
  sim.state.matchConfig = { tdm: { warmup: 1, timeLimit: 900, killLimit: 999 } };
  const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [0, 0] });
  const conn = fakeConn('q4-ord');
  const slot = room.join(conn, hello(Team.Corgis, 'assault', 'Grenadier'));
  for (let i = 0; i < 2 * TICK_HZ; i++) room.tick();
  const me = () => sim.entities.get(slot.entity);
  let seq = 1;
  const send = (buttons, extra = {}) => room.handle(slot.pid, { t: 'input', cmds: [{ ...emptyInput(seq++), yaw: me().yaw, pitch: 0.9, buttons, ...extra }] });
  const throws = () => ordnanceStats(sim).throws;
  const res = {};
  // 1. the fountain: stand at your own kiosk and spam G (press/release every other tick) for 300 s
  const kiosk = [...sim.entities.values()].find((t) => t.ordnance && t.team === Team.Corgis);
  const kx = kiosk.pos.x - Math.sin(kiosk.yaw) * 1.4, kz = kiosk.pos.z - Math.cos(kiosk.yaw) * 1.4;
  place(sim, me(), kx, kz);
  let pickups = 0;
  const t0 = throws();
  for (let i = 0; i < 300 * TICK_HZ; i++) {
    send(i % 2 ? Btn.Throw : 0, { yaw: kiosk.yaw + Math.PI, pitch: 1.1 });
    const e = me(); if (e.health) e.health.hp = e.health.max; // setup: the thrower's own blasts never kill it
    if (Math.hypot(e.pos.x - kx, e.pos.z - kz) > 0.5) place(sim, e, kx, kz);
    room.tick();
    for (const m of conn.sent.splice(0)) if (m.t === 'snap') for (const ev of m.ev) if (ev.e === 'pickup' && ev.id === slot.entity) pickups++;
  }
  res.fountain = { seconds: 300, throws: throws() - t0, restockPickups: pickups, limit: 1 + Math.floor(300 / ORDNANCE_RULES.restockCooldown) };
  // 2. forged Throw without a carry: away from the kiosk, empty-handed, spam for 25 s (> the restock time)
  place(sim, me(), kx + 30, kz + 30);
  for (let i = 0; i < TICK_HZ; i++) { send(0); room.tick(); }
  if (me().ordCarry?.carry) { send(Btn.Throw); room.tick(); send(0); room.tick(); }
  const t1 = throws();
  const carry1 = !!me().ordCarry?.carry;
  for (let i = 0; i < 25 * TICK_HZ; i++) { send(i % 2 ? Btn.Throw : 0); room.tick(); }
  res.forged = { carryingAtStart: carry1, throws: throws() - t1, flag: (me().flags & EFlag.Ordnance) !== 0 };
  // 3. hostile numbers with a real carry: NaN / Infinity / 1e308 angles and sticks on the release
  me().ordCarry.carry = true; me().ordCarry.nextThrow = 0; // (setup: hand one back)
  const evil = [NaN, Infinity, -Infinity, 1e308, -1e308];
  const hostile = [];
  for (const v of evil) {
    me().ordCarry.carry = true; me().ordCarry.nextThrow = 0;
    const before = throws();
    room.handle(slot.pid, { t: 'input', cmds: [{ seq: seq++, mx: v, mz: v, yaw: v, pitch: v, buttons: Btn.Throw, rt: v }] }); room.tick();
    room.handle(slot.pid, { t: 'input', cmds: [{ seq: seq++, mx: v, mz: v, yaw: v, pitch: v, buttons: 0, rt: v }] }); room.tick();
    const g = [...liveOrdnance(sim)].filter((o) => o.ordProj?.owner === slot.entity).at(-1);
    hostile.push({ v: String(v), thrown: throws() - before, finite: g ? Number.isFinite(g.pos.x + g.pos.y + g.pos.z + g.vel.x + g.vel.y + g.vel.z) : null,
      speed: g ? r2(Math.hypot(g.vel.x, g.vel.y, g.vel.z)) : null, me: Number.isFinite(me().pos.x + me().yaw + me().pitch) });
    for (let i = 0; i < 10; i++) { send(0); room.tick(); }
  }
  res.hostileNumbers = hostile;
  // 4. riding: a kart beside, E to mount, spam G seated for 3 s; then E out and throw
  me().ordCarry.carry = true; me().ordCarry.nextThrow = 0;
  const e = me();
  const kart = spawnKart(sim, 'mower_kart', Team.Corgis, e.pos.x + 1.6, e.pos.y, e.pos.z, 0);
  for (let i = 0; i < 20 && !me().seat; i++) { send(i % 2 ? Btn.Interact : 0); room.tick(); }
  const seated = !!me().seat;
  const t2 = throws();
  for (let i = 0; i < 3 * TICK_HZ; i++) { send(i % 2 ? Btn.Throw : 0); room.tick(); }
  const seatedThrows = throws() - t2;
  for (let i = 0; i < 40 && me().seat; i++) { send(i % 2 ? Btn.Interact : 0); room.tick(); }
  for (let i = 0; i < TICK_HZ; i++) { send(0); room.tick(); }
  const t3 = throws();
  send(Btn.Throw); room.tick(); send(0); room.tick();
  res.riding = { seated, seatedThrows, afterDismount: throws() - t3, kartAlive: !kart.removed };
  // 5. taunting: Emote, then G 0.5 s later (refused), then again 1.2 s after the taunt (thrown)
  me().ordCarry.carry = true; me().ordCarry.nextThrow = 0;
  send(Btn.Emote); room.tick(); send(0); room.tick();
  for (let i = 0; i < 0.5 * TICK_HZ; i++) { send(0); room.tick(); }
  const t4 = throws();
  send(Btn.Throw); room.tick(); send(0); room.tick();
  const duringTaunt = throws() - t4;
  for (let i = 0; i < 0.8 * TICK_HZ; i++) { send(0); room.tick(); }
  const t5 = throws();
  send(Btn.Throw); room.tick(); send(0); room.tick();
  res.taunt = { tauntTick: me().data.tauntTick ?? null, duringTaunt, after12s: throws() - t5 };
  // 6. dead: killed while carrying; G spam through death; the respawn carries one again
  me().ordCarry.carry = true; me().ordCarry.nextThrow = 0;
  kill(sim, me(), { id: -1, team: -1, weapon: -1 });
  const t6 = throws();
  let deadTicks = 0;
  for (let i = 0; i < 8 * TICK_HZ && (me().dead || i < 2); i++) { if (me().dead) deadTicks++; send(i % 2 ? Btn.Throw : 0); room.tick(); }
  for (let i = 0; i < 10; i++) { send(0); room.tick(); }
  res.dead = { deadTicks, throwsWhileDead: throws() - t6, respawnedCarrying: !!me().ordCarry?.carry && (me().flags & EFlag.Ordnance) !== 0 };
  out({ scenario: 'room', ...res });
  room.dispose();
}

// ------------------------------------------------------------------------------------------------ differential
function flatYard() {
  const n = 81, cell = 2;
  return {
    seed: 1, name: 'q4 ordnance yard', height: () => 0, halfExtent: 80, killY: -30, props: [],
    terrain: { x0: -80, z0: -80, cell, n, heights: new Float32Array(n * n) },
    spawns: [{ x: -40, y: 0, z: 40, yaw: 0, team: Team.Corgis }, { x: 40, y: 0, z: -40, yaw: Math.PI, team: Team.Cats }],
    bounds: { minX: -78, maxX: 78, minZ: -78, maxZ: 78 },
  };
}
async function blastOn(target, cls) {
  const sim = await Sim.create({ seed: 7, world: flatYard(), systems: createDefaultSystems() });
  sim.state.room = { mode: 'team-deathmatch' };
  sim.state.matchConfig = { tdm: { warmup: 0.05, timeLimit: 999, killLimit: 999 } };
  sim.state.interactConfig = { auto: false };
  sim.state.aiConfig = { vehicles: false };
  const step = (n = 1) => { for (let i = 0; i < n; i++) { sim.step(); sim.drainEvents(); sim.removedIds.length = 0; } };
  step(10);
  const thrower = sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls, name: 'T', x: 0, y: 0.02, z: 12, yaw: 0, ownerPid: 'pT' });
  let obj = null, owner = null;
  if (target === 'kart') obj = spawnKart(sim, 'mower_kart', Team.Cats, 0, 0, 0, 0);
  if (target === 'plane') obj = spawnPlane(sim, 'rc_plane', Team.Cats, 0, 0, 0, 0);
  if (target === 'barrier') {
    owner = sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Cats, species: Species.Cat, cls: 'warden', name: 'W', x: 0, y: 0.02, z: -3, yaw: Math.PI, ownerPid: 'pW' });
    step(2);
    sim.setInput(owner.id, { ...emptyInput(1), yaw: Math.PI, buttons: Btn.Ability }); step(1);
    sim.setInput(owner.id, { ...emptyInput(2), yaw: Math.PI, buttons: 0 }); step(20);
    obj = [...sim.entities.values()].find((x) => x.abx && x.abx.kind === 'barrier') ?? null;
  }
  if (!obj) return { target, cls, error: 'no target' };
  step(2);
  const hp0 = obj.health?.hp ?? NaN;
  const sol = makeSolve();
  const aw = ordnanceArcWorld(sim);
  const ok = solveThrow(aw, thrower.pos.x, thrower.pos.y, thrower.pos.z, Species.Corgi, obj.pos.x, obj.pos.y + 0.3, obj.pos.z, sol);
  sim.setInput(thrower.id, { ...emptyInput(10), yaw: sol.yaw, pitch: sol.pitch, buttons: Btn.Throw }); step(1);
  sim.setInput(thrower.id, { ...emptyInput(11), yaw: sol.yaw, pitch: sol.pitch, buttons: 0 }); step(1);
  const thrown = ordnanceStats(sim).throws;
  let blastAt = null;
  const emit = sim.emit.bind(sim);
  sim.emit = (ev) => { if (ev.e === 'explode' && ev.by === thrower.id) blastAt = [r2(ev.x), r2(ev.y), r2(ev.z)]; emit(ev); };
  step(Math.round(2.6 * TICK_HZ));
  if (owner && owner.health) owner.health.hp = owner.health.max;
  return { target, cls, solved: ok, thrown, blastAt, hp0: r1(hp0), hpLoss: r2(hp0 - (obj.health?.hp ?? NaN)), removed: !!obj.removed };
}
if (scenario === 'diff') {
  for (const target of ['kart', 'plane', 'barrier']) {
    const rows = [];
    for (const cls of ['assault', 'breacher', 'warden']) rows.push(await blastOn(target, cls));
    const losses = rows.map((r) => r.hpLoss);
    out({ scenario: 'diff', target, rows, equal: losses.every((l) => Math.abs(l - losses[0]) < 1e-6), mortarWouldBe: 'breacher shell 85 at the centre', generic: 60 });
  }
}

// ------------------------------------------------------------------------------------------------ damage band
if (scenario === 'band') {
  const rows = [];
  for (const species of [Species.Corgi, Species.Cat]) {
    for (const cls of CLASS_IDS) {
      for (const d of [0, 0.5, 1, 2, 3, 4, 4.5]) {
        const sim = await Sim.create({ seed: 3, world: flatYard(), systems: createDefaultSystems() });
        sim.state.room = { mode: 'team-deathmatch' };
        sim.state.matchConfig = { tdm: { warmup: 0.05, timeLimit: 999, killLimit: 999 } };
        sim.state.interactConfig = { auto: false };
        for (let i = 0; i < 6; i++) { sim.step(); sim.drainEvents(); }
        const enemyTeam = species === Species.Cat ? Team.Cats : Team.Corgis;
        const throwerTeam = enemyTeam === Team.Cats ? Team.Corgis : Team.Cats;
        const thrower = sim.spawnCharacter({ kind: EntityKind.Player, team: throwerTeam, species: throwerTeam === Team.Cats ? Species.Cat : Species.Corgi, cls: 'assault', name: 'T', x: 20, y: 0.02, z: 20, yaw: 0, ownerPid: 'pT' });
        const t = sim.spawnCharacter({ kind: EntityKind.Player, team: enemyTeam, species, cls, name: 'V', x: d, y: 0.02, z: 0, yaw: 0, ownerPid: 'pV' });
        const mate = sim.spawnCharacter({ kind: EntityKind.Player, team: throwerTeam, species: throwerTeam === Team.Cats ? Species.Cat : Species.Corgi, cls: 'infiltrator', name: 'M', x: -d, y: 0.02, z: 0.6, yaw: 0, ownerPid: 'pM' });
        if (t.combat) t.combat.invulnUntil = 0; t.flags &= ~EFlag.Invulnerable;
        const hp0 = t.health.hp, mhp0 = mate.health.hp;
        const def = ORDNANCE[throwerTeam === Team.Cats ? 'hairball_bomb' : 'squeaker_grenade'];
        explode(sim, 0, 0.15, 0, def.projectile, thrower.id, throwerTeam, ORDNANCE_RULES.wireBase);
        rows.push({ species: species === Species.Cat ? 'cat' : 'corgi', cls, maxHp: CLASSES[cls].maxHp, d, dmg: r1(hp0 - t.health.hp), left: r1(t.health.hp), dead: t.dead, mateDmg: r1(mhp0 - mate.health.hp) });
      }
    }
  }
  // self damage at the centre
  const sim = await Sim.create({ seed: 3, world: flatYard(), systems: createDefaultSystems() });
  sim.state.room = { mode: 'team-deathmatch' };
  sim.state.matchConfig = { tdm: { warmup: 0.05, timeLimit: 999, killLimit: 999 } };
  sim.state.interactConfig = { auto: false };
  for (let i = 0; i < 6; i++) { sim.step(); sim.drainEvents(); }
  const me = sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls: 'infiltrator', name: 'S', x: 0, y: 0.02, z: 0, yaw: 0, ownerPid: 'pS' });
  if (me.combat) me.combat.invulnUntil = 0; me.flags &= ~EFlag.Invulnerable;
  const h0 = me.health.hp;
  explode(sim, 0, 0.15, 0, ORDNANCE.squeaker_grenade.projectile, me.id, Team.Corgis, ORDNANCE_RULES.wireBase);
  const worst = rows.reduce((a, r) => (r.left < a.left ? r : a), rows[0]);
  out({ scenario: 'band', maxDmg: Math.max(...rows.map((r) => r.dmg)), anyDead: rows.some((r) => r.dead), worstLeft: worst, mateDmgMax: Math.max(...rows.map((r) => r.mateDmg)),
    byDistance: [0, 0.5, 1, 2, 3, 4, 4.5].map((d) => ({ d, dmg: rows.find((r) => r.d === d && r.cls === 'assault' && r.species === 'corgi').dmg })),
    selfAtCentre: r1(h0 - me.health.hp) });
}

// ------------------------------------------------------------------------------------------------ bot throw rates
const SHIP = {
  'team-deathmatch': { tdm: { warmup: 3 } },
  'core-rush': { coreRush: { warmup: 3 } },
  'base-assault': { baseAssault: { warmup: 3 } },
  'yard-skirmish': {},
};
if (scenario === 'bots') {
  const seconds = Number(opt('seconds', 180));
  const rows = [];
  for (const map of listOf('maps', 'west_yard,the_lot')) {
    for (const mode of listOf('modes', 'team-deathmatch,core-rush,base-assault,yard-skirmish')) {
      if (mode === 'yard-skirmish' && map === 'the_lot') { /* the Lot hosts skirmish too */ }
      for (const seed of listOf('seeds', '1,2,3').map(Number)) {
        const sim = await Sim.create({ seed, ...(map === 'west_yard' ? {} : { map }) });
        sim.state.matchConfig = SHIP[mode];
        const room = new Room(sim, { mode, botsPerTeam: mode === 'yard-skirmish' ? [4, 0] : [4, 4] });
        const S = { map, mode, seed, throws: 0, blasts: 0, fizzles: 0, enemyHits: 0, enemyDmg: 0, kills: 0, allyHits: 0, selfHits: 0, blastsWithHit: 0, maxVictimsPerBlast: 0, throwers: new Set() };
        const emit = sim.emit.bind(sim);
        let pending = []; // this tick's events
        sim.emit = (ev) => { pending.push(ev); emit(ev); };
        for (let i = 0; i < seconds * TICK_HZ; i++) {
          pending = [];
          const b0 = ordnanceStats(sim).blasts;
          room.tick();
          if (ordnanceStats(sim).blasts === b0) continue;
          // blasts this tick: attribute the hits/deaths by the same owner on this tick to the throwable
          const owners = new Set(pending.filter((e) => e.e === 'explode').map((e) => e.by));
          for (const o of owners) {
            const who = sim.entities.get(o);
            const hits = pending.filter((e) => e.e === 'hit' && e.src === o);
            let victims = 0;
            for (const h of hits) {
              const v = sim.entities.get(h.dst);
              if (!v?.char) continue;
              if (h.dst === o) S.selfHits++;
              else if (who && v.team === who.team) S.allyHits++;
              else { S.enemyHits++; S.enemyDmg += h.dmg; victims++; }
            }
            if (victims) S.blastsWithHit++;
            S.maxVictimsPerBlast = Math.max(S.maxVictimsPerBlast, victims);
            S.kills += pending.filter((e) => e.e === 'death' && e.by === o).length;
          }
        }
        const st = ordnanceStats(sim);
        S.throws = st.throws; S.blasts = st.blasts; S.fizzles = st.fizzles;
        for (const e of sim.entities.values()) if (e.ordCarry?.thrown) S.throwers.add(e.id);
        const row = { ...S, throwers: S.throwers.size, enemyDmg: r1(S.enemyDmg), perMin: r2(S.throws / (seconds / 60)), load: load() };
        rows.push(row);
        out(row);
        room.dispose();
      }
    }
  }
  const by = {};
  for (const r of rows) {
    const k = `${r.map}/${r.mode}`;
    const a = (by[k] ??= { matches: 0, throws: 0, blasts: 0, blastsWithHit: 0, enemyHits: 0, kills: 0, allyHits: 0 });
    a.matches++; a.throws += r.throws; a.blasts += r.blasts; a.blastsWithHit += r.blastsWithHit; a.enemyHits += r.enemyHits; a.kills += r.kills; a.allyHits += r.allyHits;
  }
  for (const [k, a] of Object.entries(by)) out({ pooled: k, ...a, throwsPerMatch: r1(a.throws / a.matches), hitRate: r2(a.blastsWithHit / Math.max(1, a.blasts)) });
}

// ------------------------------------------------------------------------------------------------ why bot throws miss
//   npx tsx tools/qa4-ord.mjs whymiss [--map west_yard] [--mode base-assault] [--seeds 1,2,3] [--seconds 180]
// Every bot throw: the plan when it was released (cluster centre, predicted blast point, predicted hits), then at the
// blast: its distance from the plan, the thrower's enemies within the radius (alive, spawn-protected, line of sight
// from the blast), where the cluster's pets went, and whether the planned cluster stood at their own spawn.
if (scenario === 'whymiss') {
  const { worldLineClear } = await import('../src/sim/combat');
  const map = opt('map', 'west_yard'), mode = opt('mode', 'base-assault'), seconds = Number(opt('seconds', 180));
  const all = [];
  for (const seed of listOf('seeds', '1,2,3').map(Number)) {
    const sim = await Sim.create({ seed, ...(map === 'west_yard' ? {} : { map }) });
    sim.state.matchConfig = SHIP[mode];
    const room = new Room(sim, { mode, botsPerTeam: [4, 4] });
    const pending = new Map(); // owner -> plan snapshot
    const blasts = [];
    const emit = sim.emit.bind(sim);
    sim.emit = (ev) => { if (ev.e === 'explode') blasts.push(ev); emit(ev); };
    const lastThrows = new Map();
    for (let i = 0; i < seconds * TICK_HZ; i++) {
      blasts.length = 0;
      room.tick();
      for (const e of sim.entities.values()) {
        const ob = e.ai?.ord;
        if (!ob) continue;
        const n = ob.throws, prev = lastThrows.get(e.id) ?? 0;
        if (n > prev) {
          const p = ob.plan;
          const enemies = [...sim.entities.values()].filter((o) => o.char && !o.dead && o.team !== e.team && (o.team === 0 || o.team === 1));
          const near = enemies.filter((o) => Math.hypot(o.pos.x - p.cx, o.pos.z - p.cz) < 4.5);
          pending.set(e.id, { seed, tick: sim.tick, thrower: e.name, from: [r1(e.pos.x), r1(e.pos.z)], plan: { c: [r1(p.cx), r1(p.cz)], b: [r1(p.bx), r1(p.bz)], hits: p.hits },
            nearAtThrow: near.map((o) => ({ id: o.id, at: [r1(o.pos.x), r1(o.pos.z)], invuln: (o.flags & EFlag.Invulnerable) !== 0,
              atOwnSpawn: sim.worldData.spawns.some((s) => s.team === o.team && Math.hypot(s.x - o.pos.x, s.z - o.pos.z) < 3), carrier: (o.flags & (1 << 20)) !== 0 })) });
        }
        lastThrows.set(e.id, n);
      }
      for (const b of blasts) {
        const pl = pending.get(b.by);
        if (!pl) continue;
        pending.delete(b.by);
        const owner = sim.entities.get(b.by);
        const inR = [...sim.entities.values()].filter((o) => o.char && !o.dead && owner && o.team !== owner.team && (o.team === 0 || o.team === 1) && Math.hypot(o.pos.x - b.x, o.pos.z - b.z) < 4.4);
        const planned = pl.nearAtThrow.map((q) => { const o = sim.entities.get(q.id); return o ? r1(Math.hypot(o.pos.x - b.x, o.pos.z - b.z)) : null; });
        const row = { ...pl, flightS: r2((sim.tick - pl.tick) / TICK_HZ), blast: [r1(b.x), r1(b.z)], offPlan: r1(Math.hypot(b.x - pl.plan.b[0], b.z - pl.plan.b[1])),
          inRadius: inR.map((o) => ({ invuln: (o.flags & EFlag.Invulnerable) !== 0, los: worldLineClear(sim, b.x, b.y, b.z, o.pos.x, o.pos.y + 0.6, o.pos.z) })),
          plannedTargetsNowAt: planned };
        all.push(row);
      }
    }
    room.dispose();
  }
  for (const r of all) out(r);
  const n = all.length;
  out({ summary: true, map, mode, throws: n,
    plannedHitsMean: r2(all.reduce((a, r) => a + r.plan.hits, 0) / Math.max(1, n)),
    clusterAtOwnSpawn: all.filter((r) => r.nearAtThrow.some((q) => q.atOwnSpawn)).length,
    clusterSpawnProtected: all.filter((r) => r.nearAtThrow.some((q) => q.invuln)).length,
    blastOffPlanMedian: all.length ? all.map((r) => r.offPlan).sort((a, b) => a - b)[Math.floor(n / 2)] : null,
    blastsWithEnemyInRadius: all.filter((r) => r.inRadius.length).length,
    enemiesInRadiusProtected: all.reduce((a, r) => a + r.inRadius.filter((q) => q.invuln).length, 0),
    enemiesInRadiusBlocked: all.reduce((a, r) => a + r.inRadius.filter((q) => !q.los).length, 0),
    plannedTargetsMedianDistAtBlast: (() => { const v = all.flatMap((r) => r.plannedTargetsNowAt.filter((x) => x !== null)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; })() });
}
