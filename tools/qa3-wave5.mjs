#!/usr/bin/env node
// Q3 verification probe (read-only): Wave 5 (N1 climb, B2a karts, B2b RC plane) re-measured on seeds the lanes never
// used, through the shipping brain (the B2 hook is in brain.ts at 3b3bfb3) and the real Room + default systems.
//   npx tsx tools/qa3-wave5.mjs perch     [--seeds 11,12,13,14,15,16]   Overwatch told to hold a roof perch, from its base
//   npx tsx tools/qa3-wave5.mjs fallback  [--seeds 21,22,23]            misses (no Jump) and contested (shot on leg 1 / 3)
//   npx tsx tools/qa3-wave5.mjs tdm       [--seeds 31,32,33,34] [--seconds 180] [--lineup b2|room] [--config soak|ship] [--mode core-rush|yard-skirmish]
//                                          per-match: kart rides, rams, ram kills, kart stuck, sorties, crashes,
//                                          perch time, empty karts at kiosks, ride thrash, pointless rides
//   npx tsx tools/qa3-wave5.mjs kartwalk  [--seeds 6,7,8,9,10]          60 m goal on the West Yard: walk vs board + drive
//   npx tsx tools/qa3-wave5.mjs ch3       [--seeds 4,5,6,7,8,9]         bot-only garage_job: who completes the getaway
//   npx tsx tools/qa3-wave5.mjs ch6       [--seeds 2,3,4,5,6,7]         bot-only last_ball: vehicle/airborne met for real?
//   npx tsx tools/qa3-wave5.mjs takeoff   [--seeds 1,2,3,4,5]           a Skyraider bot at the hangar, 8 targets round the yard
//   npx tsx tools/qa3-wave5.mjs humanvehicle [--seeds 1,2]              ch3 / ch6 with an idle human: does a pup take a vehicle step?
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { createDefaultSystems } from '../src/sim/systems';
import { adventureSystems, adventureState } from '../src/sim/adventure';
import { ensureBrain, holdPerch } from '../src/sim/ai/brain';
import { navGridFor } from '../src/sim/ai/nav';
import { navLinksFor } from '../src/sim/ai/nav-links';
import { kartNavFor, nearestDrivable } from '../src/sim/ai/drive';
import { spawnKart } from '../src/sim/vehicles';
import { createWorldData } from '../src/shared/world/world-data';
import { ROOF_PERCHES } from '../src/shared/world/garage';
import { chapterById } from '../src/shared/content/chapters';
import { VEHICLES } from '../src/shared/content/vehicles';
import { mulberry32 } from '../src/shared/rng';
import { Btn } from '../src/shared/input';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';
import { EFlag, EntityKind, Species, Team } from '../src/shared/types';
import { loadavg } from 'node:os';

const argv = process.argv.slice(2);
const scenario = argv[0] ?? 'perch';
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const seedsOf = (d) => String(opt('seeds', d)).split(',').map(Number);
const r1 = (v) => Math.round(v * 10) / 10;
const withAdventure = () => { const s = createDefaultSystems(); return s.some((x) => x.name === 'adventure') ? s : [...s, ...adventureSystems()]; };
const load = () => loadavg()[0].toFixed(1);
const out = (o) => console.log(JSON.stringify(o));

/** The soak's stuck rule (N1 test): wants to move (|input| > 0.5 for 90 % of 0.5 s) but moves < 0.25 m. */
function stuckMeter(e) {
  let px = e.pos.x, pz = e.pos.z, odo = 0, want = 0, n = 0, stuck = 0, max = 0;
  return {
    tick() {
      odo += Math.hypot(e.pos.x - px, e.pos.z - pz); px = e.pos.x; pz = e.pos.z;
      if (!e.dead && Math.hypot(e.input.mx, e.input.mz) > 0.5) want++;
      if (++n >= 30) { stuck = !e.dead && want >= 27 && odo < 0.25 ? stuck + 0.5 : 0; max = Math.max(max, stuck); odo = 0; want = 0; n = 0; }
    },
    get max() { return max; },
  };
}
const spawnBot = (s, team, cls, x, y, z) => s.spawnCharacter({ kind: EntityKind.Bot, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `${cls}${team}`, x, y, z, yaw: 0 });

// ------------------------------------------------------------------------------------------------ N1: perches
if (scenario === 'perch') {
  const combos = [];
  for (const [i, seed] of seedsOf('11,12,13,14,15,16').entries()) combos.push([seed, i % 2, ROOF_PERCHES[i % 3].id]);
  for (const [seed, team, id] of combos) {
    const s = await Sim.create({ seed });
    s.step();
    const base = s.pickSpawn(team);
    const e = spawnBot(s, team, 'overwatch', base.x, base.y, base.z);
    const ai = ensureBrain(e);
    const p = ROOF_PERCHES.find((x) => x.id === id);
    holdPerch(s, e, p);
    const meter = stuckMeter(e);
    const links = [];
    let at = Infinity, last = -1;
    for (let i = 0; i < 60 * 90; i++) {
      s.step(); s.drainEvents(); meter.tick();
      if (ai.nav.link >= 0 && ai.nav.link !== last) links.push(navLinksFor(s).links[ai.nav.link].name);
      last = ai.nav.link;
      if (ai.perch.reachedAt >= 0) { at = (ai.perch.reachedAt - 1) / 60; break; }
    }
    out({ seed, team: team ? 'cat' : 'corgi', from: [r1(base.x), r1(base.z)], perch: id, reachedS: Number.isFinite(at) ? r1(at) : 'NOT in 90 s', links, stuckMax: meter.max, dFeet: r1(Math.hypot(e.pos.x - p.x, e.pos.z - p.z)), y: r1(e.pos.y), load: load() });
    s.dispose();
  }
}

if (scenario === 'fallback') {
  for (const seed of seedsOf('21,22,23')) {
    // (a) every hop misses: a bot from a new start, told to hold the gutter (east side) this time
    {
      const s = await Sim.create({ seed }); s.step();
      let victim = -1;
      s.addSystem({ name: 'no-jump', order: 150, update(x) { const v = x.entities.get(victim); if (v) v.input.buttons &= ~Btn.Jump; } });
      const start = [[30, -40], [90, -20], [40, -80]][seed % 3];
      const e = spawnBot(s, Team.Cats, 'overwatch', start[0], s.worldData.height(start[0], start[1]) + 0.05, start[1]);
      victim = e.id;
      const ai = ensureBrain(e);
      holdPerch(s, e, ROOF_PERCHES[seed % 3]);
      const meter = stuckMeter(e);
      const started = []; let last = -1, paused = -1;
      for (let i = 0; i < 60 * 45; i++) {
        s.step(); s.drainEvents(); meter.tick();
        if (ai.nav.link >= 0 && ai.nav.link !== last) started.push(navLinksFor(s).links[ai.nav.link].name);
        last = ai.nav.link;
        if (paused < 0 && ai.perch.pauseUntil > s.tick) paused = s.tick;
      }
      out({ case: 'no-jump', seed, start, perch: ROOF_PERCHES[seed % 3].id, linksTried: started, misses: ai.nav.misses, fallbacks: ai.nav.fallbacks, pausedAtS: paused > 0 ? r1(paused / 60) : null, onGround: e.pos.y - s.worldData.height(e.pos.x, e.pos.z) < 0.5, stuckMax: meter.max });
      s.dispose();
    }
    // (b) contested: shot on leg 1 (seed odd) or leg 3 (seed even), from a start by the west crates
    {
      const s = await Sim.create({ seed }); s.step();
      const e = spawnBot(s, Team.Corgis, 'overwatch', 55, s.worldData.height(55, -48) + 0.05, -48);
      const shooter = s.spawnCharacter({ team: Team.Cats, species: Species.Cat, cls: 'assault', name: 'shooter', x: 0, y: s.worldData.height(0, 60) + 0.05, z: 60, yaw: 0 });
      const ai = ensureBrain(e);
      holdPerch(s, e, ROOF_PERCHES[(seed + 1) % 3]);
      const meter = stuckMeter(e);
      const legAt = seed % 2 ? 1 : 3;
      const started = []; let last = -1, shotAt = -1, grounded = -1;
      for (let i = 0; i < 60 * 60; i++) {
        if (shotAt < 0 && ai.nav.link >= 0 && ai.nav.leg >= legAt) { e.health.hp -= 10; e.health.lastDamageTick = s.tick; e.health.lastAttacker = shooter.id; shotAt = s.tick; }
        s.step(); s.drainEvents(); meter.tick();
        if (ai.nav.link >= 0 && ai.nav.link !== last) started.push(navLinksFor(s).links[ai.nav.link].name);
        last = ai.nav.link;
        if (shotAt >= 0 && grounded < 0 && e.char.grounded && e.pos.y - s.worldData.height(e.pos.x, e.pos.z) < 0.5) grounded = s.tick;
        if (ai.perch.reachedAt >= 0) break;
      }
      out({ case: 'contested', seed, shotOnLeg: legAt, shotAtS: shotAt > 0 ? r1(shotAt / 60) : null, contested: ai.nav.contested, backOnGroundAfterS: grounded > 0 ? r1((grounded - shotAt) / 60) : null, linksTried: started, perch: ROOF_PERCHES[(seed + 1) % 3].id, reachedS: ai.perch.reachedAt > 0 ? r1(ai.perch.reachedAt / 60) : 'no', stuckMax: meter.max });
      s.dispose();
    }
  }
}

// ------------------------------------------------------------------------------------------------ TDM
const B2_LINEUP = [[0, 'assault'], [0, 'overwatch'], [0, 'breacher'], [0, 'warden'], [1, 'assault'], [1, 'overwatch'], [1, 'breacher'], [1, 'warden']];
const SOAK_TDM = { tdm: { warmup: 3, killLimit: 12, timeLimit: 45, endedHold: 5 } };

async function tdmRun(seed, seconds, lineup, config, mode = 'team-deathmatch') {
  const sim = await Sim.create({ seed });
  const room = new Room(sim, { mode, botsPerTeam: lineup === 'room' ? (mode === 'yard-skirmish' ? [3, 0] : [4, 4]) : [0, 0] });
  if (config === 'soak') sim.state.matchConfig = SOAK_TDM;
  if (lineup === 'b2') for (const [team, cls] of B2_LINEUP) room.addBot(team, cls);
  const evs = [];
  const drain = sim.drainEvents.bind(sim);
  sim.drainEvents = () => { const a = drain(); evs.push(...a); return a; };
  // plane removals (crash / shot down / despawn) with their context
  const planeInfo = new Map(); // id -> { mountTick, pilot, pilotTeam, lastEnemyDmg }
  const lost = [];
  const planeHits = new Map(), riderSeen = new Map();
  const rm = sim.removeEntity.bind(sim);
  sim.removeEntity = (id) => {
    const v = sim.entities.get(id);
    if (v?.plane && !v.removed) {
      const info = planeInfo.get(id);
      const h = v.health;
      const shot = h && h.lastAttacker >= 0 && h.lastAttacker !== id && sim.tick - h.lastDamageTick <= 3 * TICK_HZ;
      const g = sim.worldData.height(v.pos.x, v.pos.z);
      lost.push({ enemyHitsTaken: planeHits.get(id) ?? 0, pilotAboardLastTick: (riderSeen.get(id) ?? -1) >= 0, phase: room.match.phase, t: r1(sim.tick / TICK_HZ), hp: h?.hp, despawn: (h?.hp ?? 0) > 0, shotDown: !!shot, rider: v.plane.rider, sinceMountS: info ? r1((sim.tick - info.mountTick) / TICK_HZ) : null, pos: [r1(v.pos.x), r1(v.pos.y), r1(v.pos.z)], agl: r1(v.pos.y - g), nearHouse: v.pos.z < -96 });
    }
    return rm(id);
  };
  const matches = [];
  let cur = null, prevPhase = null;
  const newMatch = () => { cur = { idx: matches.length, rides: 0, rideTeams: new Set(), rammed: 0, ramKills: 0, kills: 0, sorties: 0, rounds: 0, strafeHits: 0, kartStuckMax: 0, liveS: 0, perchS: [0, 0], score: null }; matches.push(cur); };
  newMatch();
  const stuck = new Map();
  const planes = new Set();
  const kioskBlock = new Map(); // kart id -> seconds parked empty within 3 m of a kiosk's front
  let kioskBlockMax = 0;
  const rideLog = new Map(); // rider id -> [{t0, x0, z0}]
  const rides = []; // {dist, s}
  const mountsBy = new Map();
  const kiosks = [...sim.entities.values()].filter((e) => e.terminal);
  const mountPhase = { kart: {}, plane: {} };
  const ms = [];
  for (let i = 0; i < seconds * TICK_HZ; i++) {
    const t0 = performance.now();
    room.tick();
    ms.push(performance.now() - t0);
    const m = room.match;
    if (prevPhase === 'ended' && m.phase !== 'ended') newMatch();
    if (m.phase === 'live') cur.liveS += 1 / TICK_HZ;
    if (m.phase === 'ended' && prevPhase !== 'ended') cur.score = [...m.score];
    prevPhase = m.phase;
    if (i === 0) for (const k of sim.entities.values()) if (k.terminal && !kiosks.includes(k)) kiosks.push(k);
    for (const ev of evs.splice(0)) {
      if (ev.e === 'ability' && ev.ability === 'mount') {
        const k = sim.entities.get(ev.id);
        const rid = k?.kart ? k.kart.rider : k?.plane ? k.plane.rider : -1;
        const r = sim.entities.get(rid);
        if (r?.kind === EntityKind.Bot && (k?.kart || k?.plane)) { const b = mountPhase[k.kart ? 'kart' : 'plane']; b[m.phase] = (b[m.phase] ?? 0) + 1; }
        if (r?.kind === EntityKind.Bot && k?.kart) { cur.rides++; cur.rideTeams.add(r.team); rideLog.set(r.id, { t0: sim.tick, x0: k.pos.x, z0: k.pos.z, kart: k.id }); mountsBy.set(r.id, [...(mountsBy.get(r.id) ?? []), sim.tick]); }
        if (r?.kind === EntityKind.Bot && k?.plane) { cur.sorties++; planes.add(k.id); planeInfo.set(k.id, { mountTick: sim.tick, pilot: r.id }); }
      } else if (ev.e === 'ability' && (ev.ability === 'dismount' || ev.ability === 'bail')) {
        for (const [rid, rl] of rideLog) if (rl.kart === ev.id) { const rr = sim.entities.get(rid); rides.push({ t: r1(sim.tick / TICK_HZ), s: r1((sim.tick - rl.t0) / TICK_HZ), dist: r1(Math.hypot(ev.x - rl.x0, ev.z - rl.z0)), from: [r1(rl.x0), r1(rl.z0)], cls: rr?.cls, dead: !!rr?.dead, why: rr?.ai?.tac?.ride?.out ?? null }); rideLog.delete(rid); }
      } else if (ev.e === 'fire' && planes.has(ev.id)) cur.rounds++;
      else if (ev.e === 'hit') {
        const s = sim.entities.get(ev.src), d = sim.entities.get(ev.dst);
        const v = s?.seat ? sim.entities.get(s.seat.vehicle) : undefined;
        if (v?.kart && d?.char) cur.rammed++;
        if (v?.plane && d?.char) cur.strafeHits++;
        if (d?.plane && s && s.team !== d.team) planeHits.set(d.id, (planeHits.get(d.id) ?? 0) + 1);
      } else if (ev.e === 'death') {
        cur.kills++;
        const k = sim.entities.get(ev.by);
        if (k && k.flags & EFlag.Mounted && k.seat && sim.entities.get(k.seat.vehicle)?.kart) cur.ramKills++;
      }
    }
    for (const id of planes) { const pl = sim.entities.get(id); if (!pl || pl.removed) planes.delete(id); }
    for (const v of sim.entities.values()) if (v.plane) riderSeen.set(v.id, v.plane.rider);
    if (i % (TICK_HZ / 2) === 0) {
      for (const k of sim.entities.values()) {
        if (!k.kart) continue;
        if (k.kart.rider >= 0) {
          const r = sim.entities.get(k.kart.rider);
          let st = stuck.get(k.id);
          if (!st) { st = { x: k.pos.x, z: k.pos.z, t: 0 }; stuck.set(k.id, st); }
          const moved = Math.hypot(k.pos.x - st.x, k.pos.z - st.z);
          st.t = r && Math.abs(r.input.mz) > 0.3 && moved < 0.25 ? st.t + 0.5 : 0;
          cur.kartStuckMax = Math.max(cur.kartStuckMax, st.t);
          st.x = k.pos.x; st.z = k.pos.z;
        } else {
          // parked empty in front of a kiosk (within 3 m of its use point)
          const near = kiosks.some((t) => !t.removed && Math.hypot(t.pos.x - k.pos.x, t.pos.z - k.pos.z) < 3 && Math.abs(t.pos.y - k.pos.y) < 2 && t.terminal?.kart !== k.id);
          const v = near ? (kioskBlock.get(k.id) ?? 0) + 0.5 : 0;
          kioskBlock.set(k.id, v); kioskBlockMax = Math.max(kioskBlockMax, v);
        }
      }
      // N1: Overwatch room bots on a perch (within 2.5 m of one, up on the roof)
      for (const e of sim.entities.values()) {
        if (e.kind !== EntityKind.Bot || e.dead || e.cls !== 'overwatch') continue;
        if (ROOF_PERCHES.some((p) => Math.hypot(p.x - e.pos.x, p.z - e.pos.z) < 2.5 && e.pos.y > p.y - 0.8)) cur.perchS[e.team] += 0.5;
      }
    }
  }
  // thrash: a bot that boarded > 4 times within any 60 s
  let thrash = 0;
  for (const ts of mountsBy.values()) for (let a = 0; a < ts.length; a++) { let n = 0; for (let b = a; b < ts.length && ts[b] - ts[a] <= 60 * TICK_HZ; b++) n++; thrash = Math.max(thrash, n); }
  const sorted = [...ms].sort((a, b) => a - b);
  room.dispose();
  return { mountPhase, matches: matches.filter((x) => x.liveS > 1).map((x) => ({ ...x, rideTeams: [...x.rideTeams], liveS: Math.round(x.liveS) })), planesLost: lost, kioskBlockMaxS: kioskBlockMax, maxBoardingsPerBotPerMin: thrash, rides: { n: rides.length, under5m: rides.filter((x) => x.dist < 5).length, short: rides.filter((x) => x.dist < 5), medianDist: rides.length ? [...rides].sort((a, b) => a.dist - b.dist)[rides.length >> 1].dist : 0 }, tickP95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2) };
}

if (scenario === 'tdm') {
  const SECONDS = Number(opt('seconds', 180)), LINEUP = opt('lineup', 'b2'), CONFIG = opt('config', 'soak');
  for (const seed of seedsOf('31,32,33,34')) {
    const MODE = opt('mode', 'team-deathmatch');
    const r = await tdmRun(seed, SECONDS, LINEUP, CONFIG, MODE);
    out({ seed, mode: MODE, lineup: LINEUP, config: CONFIG, seconds: SECONDS, load: load(), ...r });
  }
}

// ------------------------------------------------------------------------------------------------ kart vs walk
if (scenario === 'kartwalk') {
  const res = [];
  for (const seed of seedsOf('6,7,8,9,10')) {
    const rng = mulberry32(seed * 7919);
    const probe = await Sim.create({ seed, world: createWorldData(1) });
    probe.state.vehicleConfig = { autoTerminals: false, hangar: false };
    probe.step();
    const g = navGridFor(probe);
    const nav = kartNavFor(g, probe.worldData);
    let sx = 0, sz = 0, gx = 0, gz = 0, ky = 0;
    for (let tries = 0; tries < 500; tries++) {
      sx = (rng() - 0.5) * 150; sz = (rng() - 0.5) * 150;
      const a = rng() * Math.PI * 2;
      gx = sx + Math.cos(a) * 60; gz = sz + Math.sin(a) * 60;
      ky = rng() * Math.PI * 2;
      const kx = sx + Math.cos(ky) * 2.4, kz = sz - Math.sin(ky) * 2.4;
      const s = nearestDrivable(g, nav, sx, sz, 0), gg = nearestDrivable(g, nav, gx, gz, 0), k = nearestDrivable(g, nav, kx, kz, 0);
      if (s >= 0 && gg >= 0 && k >= 0 && nav.region[s] === nav.region[gg] && nav.region[k] === nav.region[s]) break;
    }
    probe.dispose?.();
    const time = async (withKart) => {
      const sim = await Sim.create({ seed, world: createWorldData(1) }); // shipping systems: the real brain with the B2 hook
      sim.state.vehicleConfig = { autoTerminals: false, hangar: false };
      sim.step(); sim.drainEvents();
      const b = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'b', x: sx, y: sim.worldData.height(sx, sz) + 0.02, z: sz, yaw: 0 });
      if (withKart) spawnKart(sim, 'mower_kart', Team.Corgis, sx + Math.cos(ky) * 2.4, sim.worldData.height(sx + Math.cos(ky) * 2.4, sz - Math.sin(ky) * 2.4), sz - Math.sin(ky) * 2.4, ky);
      sim.step();
      const ai = ensureBrain(b); ai.mode = 'patrol'; ai.hasGoal = true; ai.goalX = gx; ai.goalZ = gz;
      let mounted = false;
      for (let t = 0; t < 40 * TICK_HZ; t++) {
        sim.step(); sim.drainEvents();
        if (b.flags & EFlag.Mounted) mounted = true;
        if (Math.hypot(b.pos.x - gx, b.pos.z - gz) < 8) return { s: t / TICK_HZ, mounted };
      }
      return { s: Infinity, mounted };
    };
    const w = await time(false), k = await time(true);
    res.push({ seed, from: [r1(sx), r1(sz)], to: [r1(gx), r1(gz)], walk: +w.s.toFixed(2), kart: +k.s.toFixed(2), boarded: k.mounted, kartWins: k.s < w.s });
    out(res.at(-1));
  }
  out({ kartWins: `${res.filter((r) => r.kartWins).length} / ${res.length}`, load: load() });
}

// ------------------------------------------------------------------------------------------------ chapters
function squadIn(sim, p) {
  const inZone = (x, z) => Math.hypot(x - p.x, z - p.z) <= p.radius;
  const how = [];
  for (const e of sim.entities.values()) {
    if (!e.char || e.team !== Team.Corgis || e.dead) continue;
    const v = e.seat ? sim.entities.get(e.seat.vehicle) : undefined;
    if (!inZone(e.pos.x, e.pos.z) && !(v && inZone(v.pos.x, v.pos.z))) continue;
    const seated = !!(e.flags & EFlag.Mounted), air = !e.char.grounded;
    how.push(`${e.kind === EntityKind.Player ? 'HUMAN' : e.name} ${e.cls}${seated ? (v?.plane ? ' in-plane' : ' in-kart') : ' on-foot'}${air ? ' airborne' : ''} y${r1(e.pos.y)}`);
  }
  return how;
}

async function chapterRun(chapter, seed, human) {
  const def = chapterById(chapter);
  const sim = await Sim.create({ seed, systems: withAdventure() });
  const room = new Room(sim, { mode: 'adventure', chapter, botsPerTeam: [4, 0] });
  let h = null;
  if (human) {
    const conn = { id: 'qa3', send() {} };
    h = room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: 'QA3', team: 0, cls: human });
  }
  const steps = [];
  let step = -1, since = 0, pupMounted = 0;
  const emit = sim.emit.bind(sim);
  sim.emit = (ev) => {
    if (step >= 0 && ev.e === 'score' && (ev.reason === 'step' || ev.reason === 'chapter')) {
      const tr = def.steps[step]?.trigger;
      if (tr?.type === 'reach') steps.push({ step: def.steps[step].id, atS: r1(sim.tick / TICK_HZ), tookS: r1((sim.tick - since) / TICK_HZ), rule: `${tr.params.vehicle ? 'vehicle ' : ''}${tr.params.airborne ? 'airborne ' : ''}${tr.params.minY !== undefined ? `minY ${tr.params.minY}` : ''}`.trim(), inZone: squadIn(sim, tr.params) });
      else steps.push({ step: def.steps[step]?.id, atS: r1(sim.tick / TICK_HZ), tookS: r1((sim.tick - since) / TICK_HZ) });
    }
    emit(ev);
  };
  const limit = (human ? 200 : def.par * 2 + 30) * TICK_HZ;
  for (let i = 0; i < limit; i++) {
    if (h) { const e = sim.entities.get(h.entity); if (e) { e.health.hp = e.health.max; } }
    room.tick(); sim.drainEvents();
    const st = adventureState(sim);
    if (st.phase === 'live' && st.step !== step) { step = st.step; since = sim.tick; }
    for (const e of sim.entities.values()) if (e.kind === EntityKind.Bot && e.team === Team.Corgis && e.flags & EFlag.Mounted) pupMounted++;
    if (st.phase === 'complete') break;
  }
  const st = adventureState(sim);
  room.dispose();
  return { chapter, seed, human: human ?? null, complete: st.phase === 'complete', time: st.time, par: def.par, medal: st.medal, wipes: st.wipes, stepNow: st.step, pupSeatedTicks: pupMounted, steps };
}

if (scenario === 'ch3' || scenario === 'ch6') {
  const chapter = scenario === 'ch3' ? 'garage_job' : 'last_ball';
  for (const seed of seedsOf(scenario === 'ch3' ? '4,5,6,7,8,9' : '2,3,4,5,6,7')) out({ ...(await chapterRun(chapter, seed, null)), load: load() });
}

if (scenario === 'humanvehicle') {
  for (const seed of seedsOf('1,2')) {
    out({ ...(await chapterRun('last_ball', seed, 'skyraider')), note: 'idle human (never moves) in ch6; HP pinned' });
    out({ ...(await chapterRun('garage_job', seed, 'breacher')), note: 'idle human in ch3; HP pinned' });
  }
}

// ------------------------------------------------------------------------------------------------ take-offs
if (scenario === 'takeoff') {
  const targets = [[-44, -86], [-78, -88], [-8, -90], [-60, -60], [20, 20], [60, 70], [-70, 60], [110, -90]];
  const rep = [];
  for (const seed of seedsOf('1,2,3,4,5')) {
    for (const [tx, tz] of targets) {
      const sim = await Sim.create({ seed, world: createWorldData(1) });
      sim.state.room = { mode: 'team-deathmatch' };
      sim.state.vehicleConfig = { autoTerminals: false, hangar: true };
      sim.state.matchConfig = { tdm: { warmup: 0, killLimit: 999, timeLimit: 999, endedHold: 5 } };
      sim.step(); sim.drainEvents();
      const hangar = [...sim.entities.values()].find((e) => e.terminal?.id === 'plane_hangar');
      // a pilot a little off the kiosk each seed (the lanes used one spot)
      const px = 86 + (seed % 3) - 1, pz = -63 + ((seed * 7) % 3) - 1;
      sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: Species.Corgi, cls: seed % 2 ? 'skyraider' : 'overwatch', name: 'Ace', x: px, y: hangar.pos.y + 0.05, z: pz, yaw: 0 });
      const cat = sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Cats, species: Species.Cat, cls: 'assault', name: 'tgt', x: tx, y: sim.worldData.height(tx, tz) + 0.02, z: tz, yaw: 0 });
      let plane, maxY = -Infinity, minHp = Infinity, exploded = false, removedAt = -1, boarded = -1;
      for (let t = 0; t < 25 * TICK_HZ; t++) {
        sim.setInput(cat.id, { seq: t + 1, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 });
        sim.step();
        for (const ev of sim.drainEvents()) if (ev.e === 'explode') exploded = true;
        cat.health.hp = cat.health.max;
        if (!plane && hangar.terminal.kart >= 0) plane = sim.entities.get(hangar.terminal.kart);
        if (plane && plane.plane?.rider >= 0 && boarded < 0) boarded = t;
        if (plane && !plane.removed) { maxY = Math.max(maxY, plane.pos.y); minHp = Math.min(minHp, plane.health.hp); } else if (plane && removedAt < 0) removedAt = t;
      }
      const row = { seed, target: [tx, tz], vended: !!plane, boardedS: boarded >= 0 ? r1(boarded / TICK_HZ) : null, topY: r1(maxY), minHull: minHp === Infinity ? null : minHp, destroyed: !!plane?.removed, destroyedAtS: removedAt >= 0 ? r1(removedAt / TICK_HZ) : null, explode: exploded };
      rep.push(row); out(row);
    }
  }
  const crashes = rep.filter((r) => r.destroyed || r.explode || (r.minHull !== null && r.minHull < VEHICLES.rc_plane.maxHp));
  out({ runs: rep.length, vended: rep.filter((r) => r.vended).length, boarded: rep.filter((r) => r.boardedS !== null).length, crashesOrHullLoss: crashes.length, load: load() });
}
