#!/usr/bin/env node
// Q4 verification probe (read-only): Base Assault through the real Room and the shipping brain (W9 G4a/G4b + X4).
// Every tick checks checkBallInvariants(); every carry (steal → capture / drop / home) is recorded with its carrier,
// route, speed and killer, so a fairness lean can be traced to a cause.
//
//   npx tsx tools/qa4-ba.mjs matches [--map west_yard|the_lot] [--seeds 6,7,8] [--seconds 300] [--limit 3]
//                                    [--variant base|speed|mirror|both] [--json out.json]
//        variant speed : cats move at the corgis' walk/run/sprint (BASE_MOVE[1] patched in this process only)
//        variant mirror: the teams swap sides (spawns and bases swapped in a copy of the map's WorldData)
//        variant both  : speed + mirror
//        variant cover : the West Yard fix experiment: 1.6 m crates every 5 m from 12 to 62 m (--cover-every/-from/-to)
//                        along the cat thief's
//                        route home, 2.2 m to its corgi-spawn side (props added to a WorldData copy; sim only)
//   npx tsx tools/qa4-ba.mjs join    [--seeds 1,2,3]    a human joining a team removes a bot (Room.fillBots): the carrier?
//   npx tsx tools/qa4-ba.mjs hostile [--seeds 1,2]      hostile ClientMsgs through Room.handle mid-carry (see below)
//   npx tsx tools/qa4-ba.mjs plane                     a human carrier at an RC plane and a kart: no seat
//   npx tsx tools/qa4-ba.mjs los [--map west_yard|the_lot] [--variant base|cover …]
//        each thief's exposure on its nav route home: per 10 m, the share of the defenders' spawn points and 8 guard
//        spots 9 m round their stand (eye 1.0 m, target 0.8 m, <= 60 m) with a clear line of sight
//   npx tsx tools/qa4-ba.mjs stucktrace --seed 9 [--map the_lot] [--variant base] [--seconds 300] [--over 3]
//        replays one match and prints every bot stuck > `over` s: where, its goal and mode, and the props within 1.2 m
// Nothing here edits product code: the variants patch a content table or a WorldData copy inside this process.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadavg } from 'node:os';
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { createWorldData } from '../src/shared/world/world-data';
import { BASE_MOVE } from '../src/shared/content/classes';
import { BA_BALL_SEED, BA_REASON, BallState } from '../src/shared/content/modes';
import { baseAssaultBalls, baseAssaultState, checkBallInvariants } from '../src/sim/match';
import { surfaceAt } from '../src/shared/world/queries';
import { baRoleOf } from '../src/sim/ai/base-assault-ai';
import { ordnanceStats } from '../src/sim/combat';
import { Btn, emptyInput } from '../src/shared/input';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';
import { EFlag, EntityKind, Team } from '../src/shared/types';

const argv = process.argv.slice(2);
const scenario = argv[0] ?? 'matches';
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const seedsOf = (d) => String(opt('seeds', d)).split(',').map(Number);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const load = () => loadavg()[0].toFixed(1);
const out = (o) => console.log(JSON.stringify(o));
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/** The soak's stuck rule: wants to move (|input| > 0.5 for 90 % of 0.5 s) but moves < 0.25 m. */
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

// ------------------------------------------------------------------------------------------------ variants

const CORGI_SPEEDS = { walkSpeed: BASE_MOVE[0].walkSpeed, runSpeed: BASE_MOVE[0].runSpeed, sprintSpeed: BASE_MOVE[0].sprintSpeed };
function applySpeed(on) {
  if (on) Object.assign(BASE_MOVE[1], CORGI_SPEEDS);
}

/** The map's WorldData with the teams on each other's side: spawns relabelled, bases (flag + stand) swapped. */
async function mirroredWorld(seed, map) {
  const base = createWorldData(seed, map);
  // the bases the mode resolves on the real map (E4 flags on the West Yard, WorldData.bases on The Lot)
  const sim = await Sim.create({ seed, ...(map ? { map } : {}) });
  const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [0, 0] });
  room.tick();
  const spots = baseAssaultState(sim).spots;
  room.dispose();
  const P = (p) => [p.x, p.y, p.z];
  return {
    ...base,
    spawns: base.spawns.map((s) => ({ ...s, team: s.team === 0 ? 1 : s.team === 1 ? 0 : s.team })),
    bases: [{ team: 0, flag: P(spots[1].flag), ballStand: P(spots[1].stand) }, { team: 1, flag: P(spots[0].flag), ballStand: P(spots[0].stand) }],
  };
}

/** The West Yard with cover along the cat thief's exit (the route from the corgi stand to the cat flag). */
async function coveredWorld(seed, map) {
  const base = createWorldData(seed, map);
  const sim = await Sim.create({ seed, ...(map ? { map } : {}) });
  const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [0, 0] });
  room.tick();
  const spots = baseAssaultState(sim).spots;
  const { navGridFor, findPath } = await import('../src/sim/ai/nav');
  const g = navGridFor(sim);
  const s = spots[0].stand, f = spots[1].flag;
  const p = [];
  findPath(g, s.x, s.z, f.x, f.z, p);
  const pts = [];
  let px = s.x, pz = s.z;
  for (let i = 0; i < p.length; i += 2) { const L = Math.hypot(p[i] - px, p[i + 1] - pz); for (let k = 0; k < L; k += 1) pts.push([px + ((p[i] - px) * k) / L, pz + ((p[i + 1] - pz) * k) / L, (p[i] - px) / L, (p[i + 1] - pz) / L]); px = p[i]; pz = p[i + 1]; }
  const sp = base.spawns.filter((q) => q.team === 0);
  const cx = sp.reduce((a, q) => a + q.x, 0) / sp.length, cz = sp.reduce((a, q) => a + q.z, 0) / sp.length;
  const props = [...base.props];
  const added = [];
  const every = Number(opt('cover-every', 5)), from = Number(opt('cover-from', 12)), to = Number(opt('cover-to', 62));
  for (let m = from; m <= to && m < pts.length; m += every) {
    const [x, z, dx, dz] = pts[m];
    let nx = -dz, nz = dx;
    if (nx * (cx - x) + nz * (cz - z) < 0) { nx = -nx; nz = -nz; }
    const bx = x + nx * 2.2, bz = z + nz * 2.2, gy = base.height(bx, bz);
    const box = { type: 'crate', x: bx, y: gy + 0.65, z: bz, hx: 0.8, hy: 0.65, hz: 0.8, rotY: 0 };
    props.push(box); added.push([Math.round(bx * 10) / 10, Math.round(bz * 10) / 10]);
  }
  room.dispose();
  console.error(`[qa4-ba] cover crates at ${JSON.stringify(added)}`);
  return { ...base, props };
}

// ------------------------------------------------------------------------------------------------ one match

async function match(seed, { map, seconds, limit, variant }) {
  const mirror = variant === 'mirror' || variant === 'both';
  const world = mirror ? await mirroredWorld(seed, map) : variant === 'cover' ? await coveredWorld(seed, map) : undefined;
  const sim = await Sim.create({ seed, ...(world ? { world } : map ? { map } : {}) });
  sim.state.matchConfig = { baseAssault: { timeLimit: seconds, endedHold: 2, ...(limit ? { captureLimit: limit } : {}) } };
  const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [4, 4] });
  const M = {
    seed, map: map || 'west_yard', variant, captures: [0, 0], steals: [0, 0], drops: [0, 0], returns: [0, 0], teleHome: [0, 0],
    deaths: [0, 0], invariantViolations: 0, firstViolation: '', stuckMax: 0, stuckWho: '', liveSec: 0, winner: null, score: null,
    firstSteal: [null, null], carries: [], throws: 0,
  };
  const emit = sim.emit.bind(sim);
  const deathsThisTick = [];
  sim.emit = (ev) => {
    if (ev.e === 'death') { const v = sim.entities.get(ev.id); if (v && (v.team === 0 || v.team === 1)) M.deaths[v.team]++; deathsThisTick.push(ev); }
    if (ev.e === 'score') {
      const t = ev.team;
      if (ev.reason === BA_REASON.captured) M.captures[t]++;
      else if (ev.reason === BA_REASON.taken) { M.steals[t]++; if (M.firstSteal[t] === null) M.firstSteal[t] = r1(liveTicks / TICK_HZ); }
      else if (ev.reason === BA_REASON.dropped) M.drops[t]++;
      else if (ev.reason === BA_REASON.returned) M.returns[t]++;
    }
    emit(ev);
  };
  const meters = new Map();
  const prev = [{ state: BallState.Home, carrier: -1 }, { state: BallState.Home, carrier: -1 }];
  const open = [null, null]; // the live carry of ball i (carried by team 1 - i)
  let liveTicks = 0, ended = false, capBefore = [0, 0];
  const total = Math.round((seconds + 12) * TICK_HZ);
  for (let i = 0; i < total && !ended; i++) {
    deathsThisTick.length = 0;
    capBefore = [...M.captures];
    room.tick();
    const bad = checkBallInvariants(sim);
    if (bad.length) { M.invariantViolations++; if (!M.firstViolation) M.firstViolation = `tick ${sim.tick}: ${bad.join('; ')}`; }
    const m = room.match;
    if (m.phase === 'live') liveTicks++;
    if (m.phase === 'ended') { ended = true; M.winner = m.winner ?? null; M.score = m.score ?? null; }
    const st = baseAssaultState(sim);
    if (st) {
      for (const b of st.balls) {
        const thieves = 1 - b.team;
        const o = open[b.team];
        // the carry in progress: odometer, speed samples
        if (o && b.state === BallState.Carried && b.carrier === o.id) {
          const c = sim.entities.get(o.id);
          if (c) {
            const d = Math.hypot(c.pos.x - o.px, c.pos.z - o.pz);
            if (d < 4) o.path += d;
            o.px = c.pos.x; o.pz = c.pos.z;
            const sp = Math.hypot(c.vel.x, c.vel.z);
            if (sim.tick - o.t0 > 6 && sp > 0.5) { o.speedSum += sp; o.speedN++; if (sp > o.vmax) o.vmax = sp; }
          }
        }
        const changed = b.state !== prev[b.team].state || b.carrier !== prev[b.team].carrier;
        if (changed && o) {
          // the carry ended this tick
          const c = sim.entities.get(o.id);
          const ring = st.spots[thieves].flag;
          const ex = c ? c.pos.x : o.px, ez = c ? c.pos.z : o.pz;
          let reason = 'home';
          if (M.captures[thieves] > capBefore[thieves]) reason = 'captured';
          else if (b.state === BallState.Dropped) reason = 'dropped';
          else if (b.state === BallState.Carried) reason = 'handover';
          const death = deathsThisTick.find((d) => d.id === o.id);
          const killer = death ? sim.entities.get(death.by) : undefined;
          const killerStand = killer ? st.spots[killer.team]?.stand : undefined;
          o.end = {
            reason, tick: sim.tick, x: r1(ex), z: r1(ez), dur: r2((sim.tick - o.t0) / TICK_HZ),
            leftToRing: r1(Math.hypot(ex - ring.x, ez - ring.z)),
            killer: killer ? { team: killer.team, cls: killer.cls, role: baRoleOf(killer), kind: killer.kind, fromOwnStand: killerStand ? r1(Math.hypot(killer.pos.x - killerStand.x, killer.pos.z - killerStand.z)) : null } : null,
          };
          o.avgSpeed = o.speedN ? r2(o.speedSum / o.speedN) : 0;
          o.path = r1(o.path); o.vmax = r2(o.vmax);
          delete o.px; delete o.pz; delete o.speedSum; delete o.speedN;
          M.carries.push(o);
          open[b.team] = null;
        }
        if (changed && b.state === BallState.Carried) {
          const c = sim.entities.get(b.carrier);
          const ring = st.spots[thieves].flag;
          open[b.team] = {
            team: thieves, id: c.id, cls: c.cls, t0: sim.tick, liveAt: r1(liveTicks / TICK_HZ), x0: r1(c.pos.x), z0: r1(c.pos.z),
            fromDrop: prev[b.team].state === BallState.Dropped, startToRing: r1(Math.hypot(c.pos.x - ring.x, c.pos.z - ring.z)),
            px: c.pos.x, pz: c.pos.z, path: 0, speedSum: 0, speedN: 0, vmax: 0,
          };
        }
        prev[b.team] = { state: b.state, carrier: b.carrier };
      }
    }
    for (const e of sim.entities.values()) {
      if (!e.char || e.kind !== EntityKind.Bot) continue;
      let mt = meters.get(e.id);
      if (!mt) { mt = stuckMeter(e); meters.set(e.id, mt); }
      mt.tick();
      if (mt.max > M.stuckMax) { M.stuckMax = mt.max; M.stuckWho = `${e.name} ${e.cls} (${r1(e.pos.x)}, ${r1(e.pos.z)}) ${baRoleOf(e)}`; }
    }
  }
  M.liveSec = r1(liveTicks / TICK_HZ);
  M.throws = ordnanceStats(sim).throws;
  room.dispose();
  return M;
}

function summarize(runs) {
  const s = { matches: runs.length, wins: [0, 0], draws: 0, captures: [0, 0], steals: [0, 0], drops: [0, 0], returns: [0, 0], deaths: [0, 0],
    invariantViolations: 0, stuckMax: 0, throwsPerMatch: r1(mean(runs.map((r) => r.throws))) };
  for (const r of runs) {
    for (const t of [0, 1]) { s.captures[t] += r.captures[t]; s.steals[t] += r.steals[t]; s.drops[t] += r.drops[t]; s.returns[t] += r.returns[t]; s.deaths[t] += r.deaths[t]; }
    if (r.winner === 0 || r.winner === 1) s.wins[r.winner]++; else s.draws++;
    s.invariantViolations += r.invariantViolations;
    s.stuckMax = Math.max(s.stuckMax, r.stuckMax);
  }
  s.perTeam = [0, 1].map((t) => {
    const cs = runs.flatMap((r) => r.carries.filter((c) => c.team === t));
    const fresh = cs.filter((c) => !c.fromDrop);
    const drops = cs.filter((c) => c.end.reason === 'dropped');
    const killers = {};
    for (const c of drops) { const k = c.end.killer ? `${c.end.killer.role ?? 'player'}` : 'none'; killers[k] = (killers[k] ?? 0) + 1; }
    const dropProgress = drops.map((c) => 1 - c.end.leftToRing / Math.max(1, c.startToRing));
    return {
      team: t === 0 ? 'corgis' : 'cats', carries: cs.length, captured: cs.filter((c) => c.end.reason === 'captured').length,
      dropped: drops.length, home: cs.filter((c) => c.end.reason === 'home').length,
      successRate: r2(cs.filter((c) => c.end.reason === 'captured').length / Math.max(1, cs.length)),
      freshSteals: fresh.length, medianCarryS: r1(median(cs.map((c) => c.end.dur))), medianPathM: r1(median(cs.map((c) => c.path))),
      avgCarrierSpeed: r2(mean(cs.filter((c) => c.avgSpeed > 0).map((c) => c.avgSpeed))),
      carrierVmaxMedian: r2(median(cs.map((c) => c.vmax))),
      carrierClasses: cs.reduce((a, c) => ((a[c.cls] = (a[c.cls] ?? 0) + 1), a), {}),
      medianDropProgress: r2(median(dropProgress)), killersOfCarriers: killers,
      medianKillerFromOwnStand: r1(median(drops.filter((c) => c.end.killer?.fromOwnStand != null).map((c) => c.end.killer.fromOwnStand))),
      medianFirstSteal: r1(median(runs.map((r) => r.firstSteal[t]).filter((v) => v !== null))),
    };
  });
  return s;
}

if (scenario === 'matches') {
  const map = opt('map', '') === 'west_yard' ? '' : opt('map', '');
  const seconds = Number(opt('seconds', 300));
  const limit = opt('limit', '') ? Number(opt('limit', '')) : 0;
  const variant = opt('variant', 'base');
  applySpeed(variant === 'speed' || variant === 'both');
  const runs = [];
  const t0 = performance.now();
  for (const seed of seedsOf('6,7,8,9,10')) {
    const t1 = performance.now();
    const r = await match(seed, { map, seconds, limit, variant });
    runs.push(r);
    out({ seed, map: r.map, variant, captures: r.captures, steals: r.steals, drops: r.drops, returns: r.returns, deaths: r.deaths,
      winner: r.winner, liveSec: r.liveSec, invariantViolations: r.invariantViolations, firstViolation: r.firstViolation || undefined,
      stuckMax: r.stuckMax, stuckWho: r.stuckMax > 2 ? r.stuckWho : undefined, throws: r.throws, firstSteal: r.firstSteal,
      wallS: r1((performance.now() - t1) / 1000), load: load() });
  }
  const sum = summarize(runs);
  console.log(`[qa4-ba] ${map || 'west_yard'} variant ${variant} · ${runs.length} matches × ${seconds} s (limit ${limit || 3}) · ${r1((performance.now() - t0) / 1000)} s wall · load ${load()}`);
  console.log(JSON.stringify(sum, null, 1));
  const file = opt('json', '');
  if (file) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ summary: sum, runs }, null, 1)); }
}

// ------------------------------------------------------------------------------------------------ hostile & join helpers

/** A fake connection that decodes nothing: it keeps the messages the Room sends it. */
function fakeConn(id) {
  const c = { id, sent: [], send(m) { c.sent.push(m); if (c.sent.length > 400) c.sent.splice(0, 200); } };
  return c;
}
const hello = (team, cls = 'assault', name = 'Q4') => ({ t: 'hello', v: PROTOCOL_VERSION, name, team, cls });

/** Put a character next to the enemy stand so it takes the ball on the next tick (setup only; the steal is authoritative). */
function placeAtEnemyStand(sim, e) {
  const b = baseAssaultBalls(sim)[1 - e.team];
  sim.placeCharacter(e, b.x, surfaceAt(sim.worldData, b.x, b.z, b.y).y + 0.02, b.z);
}
/** Move a character (setup only). */
const place = (sim, e, x, z, y) => sim.placeCharacter(e, x, y ?? surfaceAt(sim.worldData, x, z, 50).y + 0.02, z);

/** Walk a character to (x, z) in `step` m moves, one per tick (never a teleport), stepping the room. */
function walkTo(room, sim, e, x, z, step = 3, each) {
  const bad = [];
  for (let n = 0; n < 400; n++) {
    const d = Math.hypot(x - e.pos.x, z - e.pos.z);
    if (d < 0.05) break;
    const s = Math.min(step, d);
    place(sim, e, e.pos.x + ((x - e.pos.x) / d) * s, e.pos.z + ((z - e.pos.z) / d) * s);
    if (e.health) e.health.hp = e.health.max;
    each?.(n);
    room.tick();
    const b = checkBallInvariants(sim);
    if (b.length) bad.push(`tick ${sim.tick}: ${b.join('; ')}`);
  }
  return bad;
}

function stepN(room, sim, n, each) {
  const bad = [];
  for (let i = 0; i < n; i++) {
    each?.(i);
    room.tick();
    const b = checkBallInvariants(sim);
    if (b.length) bad.push(`tick ${sim.tick}: ${b.join('; ')}`);
  }
  return bad;
}

if (scenario === 'join') {
  // A human joining a team makes Room.fillBots remove that team's LAST bot. When that bot carries the enemy ball, the
  // carrier vanishes mid-run and the ball drops where it stood.
  for (const seed of seedsOf('1,2,3')) {
    const sim = await Sim.create({ seed });
    const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [4, 4] });
    const bad = [];
    let tries = 0, removedCarrier = 0, joins = 0, dropsByJoin = 0;
    const log = [];
    for (let i = 0; i < 300 * TICK_HZ && tries < 6; i++) {
      room.tick();
      const b = checkBallInvariants(sim);
      if (b.length) bad.push(b.join('; '));
      const st = baseAssaultState(sim);
      if (!st) continue;
      for (const ball of st.balls) {
        if (ball.state !== BallState.Carried) continue;
        const carrier = sim.entities.get(ball.carrier);
        if (!carrier || carrier.kind !== EntityKind.Bot) continue;
        // which bot would a join on the carrier's team remove? the team's last bot slot
        const slots = [...room.players.values()].filter((p) => p.team === carrier.team && p.bot);
        const last = slots.at(-1);
        if (last?.entity !== carrier.id) continue;
        tries++;
        const conn = fakeConn(`q4-join-${seed}-${tries}`);
        const before = { state: ball.state, carrier: ball.carrier };
        room.join(conn, hello(carrier.team, 'assault', `Joiner${tries}`));
        joins++;
        const gone = !sim.entities.has(carrier.id) || sim.entities.get(carrier.id).removed;
        room.tick();
        const after = { state: ball.state, carrier: ball.carrier };
        if (gone) removedCarrier++;
        if (after.state === BallState.Dropped) dropsByJoin++;
        log.push({ t: r1(sim.tick / TICK_HZ), carrierTeam: carrier.team, carrier: carrier.name, removed: gone, before, after,
          ballAt: [r1(sim.entities.get(ball.ball).pos.x), r1(sim.entities.get(ball.ball).pos.z)] });
        room.leave(conn.id); // the joiner leaves again: a bot is added back
        i += 60;
        for (let k = 0; k < 60; k++) room.tick();
      }
    }
    out({ scenario: 'join', seed, joins, removedCarrier, dropsByJoin, invariantViolations: bad.length, log });
    room.dispose();
  }
}

if (scenario === 'hostile') {
  // One human (a fake conn) per case against 4v4 bots; every message goes through Room.handle, as the server calls it
  // after its structural guard. The setup places the human by the enemy stand (a client cannot do that; the steal
  // itself is the authority's). Invariants every tick.
  const results = [];
  for (const seed of seedsOf('1,2')) {
    for (const kase of (opt('cases', 'spam,teamclass,reconnect,capturetick,restart,bothgrab')).split(',')) {
      const sim = await Sim.create({ seed });
      // 'restart': the horn falls 6 s into the live phase, mid-carry
      sim.state.matchConfig = { baseAssault: { warmup: 1, endedHold: 2, ...(kase === 'restart' ? { timeLimit: 6 } : {}) } };
      const quiet = kase === 'teamclass' || kase === 'capturetick';
      const room = new Room(sim, { mode: 'base-assault', botsPerTeam: quiet ? [0, 0] : [4, 4] });
      const conn = fakeConn(`q4-${kase}`);
      const slot = room.join(conn, hello(Team.Corgis, 'assault', 'Hostile'));
      let bad = stepN(room, sim, 2 * TICK_HZ);
      const st = baseAssaultState(sim);
      let seq = 1;
      const me = () => sim.entities.get(slot.entity);
      const res = { seed, kase, notes: [] };
      const send = (cmd) => room.handle(slot.pid, { t: 'input', cmds: [cmd] });
      placeAtEnemyStand(sim, me());
      bad = bad.concat(stepN(room, sim, 2, () => send({ ...emptyInput(seq++), yaw: 0 })));
      const took = st.balls[1].state === BallState.Carried && st.balls[1].carrier === slot.entity;
      res.stole = took;
      if (kase === 'spam') {
        // every button every tick (Throw, Interact, Fire, Jump, Ability…), impossible sticks and angles, seq games
        const evil = [NaN, Infinity, -Infinity, 1e308, -1e308, 50, -50];
        let abuse = 0;
        bad = bad.concat(stepN(room, sim, 6 * TICK_HZ, (i) => {
          const v = evil[i % evil.length];
          const cmd = { seq: i % 17 === 0 ? -5 : seq++, mx: v, mz: -v, yaw: v, pitch: v, buttons: i % 2 ? 0xffffffff : (i % 3 ? Btn.Throw | Btn.Interact : 0), rt: v };
          const r1_ = room.handle(slot.pid, { t: 'input', cmds: [cmd, cmd, cmd, cmd, cmd, cmd, cmd, cmd] });
          if (r1_ === 'abuse') abuse++;
          room.handle(slot.pid, { t: 'input', cmds: 'x'.repeat(100) });
          room.handle(slot.pid, { t: 'bogus' });
        }));
        const e = me();
        res.after = { alive: !!e && !e.dead, carrier: !!e && (e.flags & EFlag.Carrier) !== 0, pos: e ? [r1(e.pos.x), r1(e.pos.y), r1(e.pos.z)] : null,
          finite: !!e && Number.isFinite(e.pos.x + e.pos.y + e.pos.z + e.yaw + e.pitch), seated: !!e?.seat, ball: st.balls[1].state, abuseResults: abuse,
          ordnance: ordnanceStats(sim) };
      }
      if (kase === 'teamclass') {
        // team and class messages every tick while carrying (away from deploy: pending), then the carrier walks home to
        // its deploy point at full health and switches there (the Room respawns a new body: the ball must drop, once)
        let r = { ok: 0, ignored: 0, abuse: 0 };
        bad = bad.concat(stepN(room, sim, 3 * TICK_HZ, (i) => {
          const a = room.handle(slot.pid, { t: 'team', team: i % 2 ? Team.Cats : Team.Corgis });
          const b = room.handle(slot.pid, { t: 'class', cls: ['assault', 'skyraider', 'breacher', 'nope'][i % 4] });
          r[a] = (r[a] ?? 0) + 1; r[b] = (r[b] ?? 0) + 1;
          send({ ...emptyInput(seq++), yaw: 0 });
        }));
        res.whileCarrying = { ...r, stillCarrier: st.balls[1].carrier === slot.entity, sameEntity: !!me() };
        // one 30 m jump in a tick: the teleport rule sends the ball home
        const e = me();
        const before = st.balls[1].state;
        place(sim, e, e.pos.x + 30, e.pos.z);
        bad = bad.concat(stepN(room, sim, 1));
        res.teleportHome = { before, after: st.balls[1].state };
        // steal again and walk (3 m a tick) to the carrier's own spawn at full health, then switch team and class there
        const sp = sim.worldData.spawns.find((q) => q.team === Team.Corgis);
        placeAtEnemyStand(sim, me());
        bad = bad.concat(stepN(room, sim, 2, () => send({ ...emptyInput(seq++) })));
        const e2 = me();
        const oldId = e2.id;
        bad = bad.concat(walkTo(room, sim, e2, sp.x, sp.z, 3, () => send({ ...emptyInput(seq++) })));
        const carryingAtDeploy = st.balls[1].state === BallState.Carried && st.balls[1].carrier === oldId;
        const cls = room.handle(slot.pid, { t: 'class', cls: 'skyraider' });
        bad = bad.concat(stepN(room, sim, 2));
        const afterClass = { result: cls, newEntity: slot.entity !== oldId, ball: st.balls[1].state, ballAt: [r1(sim.entities.get(st.balls[1].ball).pos.x), r1(sim.entities.get(st.balls[1].ball).pos.z)] };
        // steal once more, walk home, team switch at deploy
        placeAtEnemyStand(sim, me());
        bad = bad.concat(stepN(room, sim, 2, () => send({ ...emptyInput(seq++) })));
        const e3 = me(), id3 = e3.id;
        bad = bad.concat(walkTo(room, sim, e3, sp.x, sp.z, 3, () => send({ ...emptyInput(seq++) })));
        const carrying3 = st.balls[1].carrier === id3;
        room.net = undefined;
        bad = bad.concat(stepN(room, sim, TICK_HZ + 2)); // the 1 s switch cooldown from the class switch
        const t = room.handle(slot.pid, { t: 'team', team: Team.Cats });
        bad = bad.concat(stepN(room, sim, 2));
        res.switchAtDeploy = { carryingAtDeploy, afterClass, carrying3, teamResult: t, newEntity: slot.entity !== id3, ball: st.balls[1].state, team: slot.team };
        // the switched player (now a cat) touches the dropped cat ball: a return (defender), never a pickup
      }
      if (kase === 'reconnect') {
        // the carrier's connection drops and comes back 10 times in 10 s (new hello each time), plus a second conn that
        // joins/leaves the other team every 5 ticks
        let joins = 0;
        const other = [];
        let cur = { conn, slot };
        bad = bad.concat(stepN(room, sim, 10 * TICK_HZ, (i) => {
          if (i % TICK_HZ === 0) {
            room.leave(cur.slot.pid);
            const c = fakeConn(`q4-re-${i}`);
            const s = room.join(c, hello(Team.Corgis, 'assault', 'Again'));
            if (s) { cur = { conn: c, slot: s }; joins++; }
          }
          if (i % 5 === 0) {
            if (other.length) room.leave(other.pop().id);
            else { const c = fakeConn(`q4-o-${i}`); if (room.join(c, hello(Team.Cats, 'assault', 'Storm'))) other.push(c); }
          }
        }));
        res.after = { joins, humans: room.humanCount, players: room.players.size, balls: st.balls.map((b) => b.state), phase: room.match.phase };
      }
      if (kase === 'capturetick') {
        // carry home, then disconnect on the exact tick the carrier would enter its ring (and the tick before / after)
        const results2 = [];
        for (const offset of [-1, 0, 1]) {
          const sim2 = await Sim.create({ seed });
          sim2.state.matchConfig = { baseAssault: { warmup: 1, endedHold: 2 } };
          const room2 = new Room(sim2, { mode: 'base-assault', botsPerTeam: [0, 0] });
          const c2 = fakeConn('q4-cap');
          const s2 = room2.join(c2, hello(Team.Corgis, 'assault', 'Cap'));
          let b2 = stepN(room2, sim2, 2 * TICK_HZ);
          const st2 = baseAssaultState(sim2);
          placeAtEnemyStand(sim2, sim2.entities.get(s2.entity));
          b2 = b2.concat(stepN(room2, sim2, 2));
          // an open approach: a direction whose ground from 6.2 m to the flag stays within 0.4 m of the ring's height
          const ring = st2.spots[0].flag;
          const e = sim2.entities.get(s2.entity);
          const R = 3.2 + 3;
          let dir = 0;
          for (let a = 0; a < 32; a++) {
            const ang = (a / 32) * Math.PI * 2;
            let ok = true;
            for (let r = 0; r <= R + 0.01; r += 0.25) {
              const x = ring.x + Math.cos(ang) * r, z = ring.z + Math.sin(ang) * r;
              if (Math.abs(surfaceAt(sim2.worldData, x, z, ring.y + 1.6).y - ring.y) > 0.4) { ok = false; break; }
            }
            if (ok) { dir = ang; break; }
          }
          const cx = Math.cos(dir), cz = Math.sin(dir);
          b2 = b2.concat(walkTo(room2, sim2, e, ring.x + cx * R, ring.z + cz * R, 3));
          const carryingAtRing = st2.balls[1].carrier === s2.entity;
          const path = [];
          for (let k = 0; k < 60; k++) path.push([ring.x + cx * (R - k * 0.1), ring.z + cz * (R - k * 0.1)]);
          let enter = -1;
          for (let k = 0; k < path.length; k++) if (Math.hypot(path[k][0] - ring.x, path[k][1] - ring.z) <= 3.2 - 0.05) { enter = k; break; }
          let captured = 0, capturedAtK = -1;
          const evs = [];
          for (let k = 0; k < path.length; k++) {
            if (k === enter + offset) { room2.leave(s2.pid); }
            const ent = sim2.entities.get(s2.entity);
            if (ent && !ent.removed) place(sim2, ent, path[k][0], path[k][1], surfaceAt(sim2.worldData, path[k][0], path[k][1], ring.y + 1.6).y + 0.02);
            const sc = room2.match.score?.[0] ?? 0;
            room2.tick();
            if ((room2.match.score?.[0] ?? 0) > sc && capturedAtK < 0) capturedAtK = k;
            for (const m of c2.sent.splice(0)) if (m.t === 'snap') for (const ev of m.ev) if (ev.e === 'score' && ev.reason) evs.push(ev.reason);
            const b = checkBallInvariants(sim2);
            if (b.length) b2.push(b.join('; '));
          }
          void capturedAtK;
          captured = room2.match.score?.[0] ?? null;
          results2.push({ offset, enter, capturedAtK, dirDeg: Math.round((dir * 180) / Math.PI), carryingAtRing, captured, ball: st2.balls[1].state, ballAt: [r1(sim2.entities.get(st2.balls[1].ball).pos.x), r1(sim2.entities.get(st2.balls[1].ball).pos.z)], events: evs, invariantViolations: b2.length });
          room2.dispose();
        }
        res.captureTick = results2;
      }
      if (kase === 'restart') {
        // force the horn mid-carry: the ended phase sends every ball home and clears the flag; then a clean restart
        const before = { carrier: st.balls[1].carrier === slot.entity, flag: ((me()?.flags ?? 0) & EFlag.Carrier) !== 0 };
        const phases = [];
        let carriersInEnded = 0, awayInEnded = 0;
        bad = bad.concat(stepN(room, sim, 8 * TICK_HZ, (i) => {
          send({ ...emptyInput(seq++), buttons: i % 2 ? Btn.Throw : 0 });
          const ph = room.match.phase;
          if (phases.at(-1) !== ph) phases.push(ph);
          if (ph === 'ended') {
            carriersInEnded += [...sim.entities.values()].filter((e) => e.flags & EFlag.Carrier).length;
            awayInEnded += st.balls.filter((b) => b.state !== BallState.Home).length;
          }
        }));
        const carriers = [...sim.entities.values()].filter((e) => e.flags & EFlag.Carrier).length;
        res.after = { before, phases, carriersInEnded, awayInEnded, phase: room.match.phase, balls: st.balls.map((b) => b.state), carriers, score: room.match.score, ballEntities: [...sim.entities.values()].filter((e) => e.kind === EntityKind.Prop && e.seed === BA_BALL_SEED).length };
      }
      if (kase === 'bothgrab') {
        // 6 corgis (bots) at exactly the same distance around the cat stand on the same tick, 20 trials
        let ok = 0;
        for (let k = 0; k < 20; k++) {
          const s = st.spots[1].stand;
          const cs = [...sim.entities.values()].filter((e) => e.char && !e.dead && e.team === Team.Corgis).slice(0, 5);
          cs.forEach((c, j) => { const a = (j / cs.length) * Math.PI * 2 + k; place(sim, c, s.x + Math.cos(a) * 0.45, s.z + Math.sin(a) * 0.45, surfaceAt(sim.worldData, s.x, s.z, s.y + 1).y + 0.02); });
          bad = bad.concat(stepN(room, sim, 1));
          const carriers = [...sim.entities.values()].filter((e) => e.flags & EFlag.Carrier).length;
          if (carriers <= 2 && st.balls[1].state === BallState.Carried) ok++;
          // send it home for the next trial: the carrier moves 10 m (teleport rule)
          const c = sim.entities.get(st.balls[1].carrier);
          if (c) place(sim, c, c.pos.x + 30, c.pos.z);
          bad = bad.concat(stepN(room, sim, 2));
        }
        res.sameTickTrials = { ok, of: 20 };
      }
      res.invariantViolations = bad.length;
      if (bad.length) res.firstViolation = bad[0];
      results.push(res);
      out(res);
      room.dispose();
    }
  }
}

if (scenario === 'plane') {
  // A human carrier next to a parked kart, at the Rooftop Hangar and next to a parked RC plane, pressing E: never seated.
  const sim = await Sim.create({ seed: 3 });
  sim.state.matchConfig = { baseAssault: { warmup: 1, endedHold: 2 } };
  const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [0, 0] });
  const conn = fakeConn('q4-plane');
  const slot = room.join(conn, hello(Team.Corgis, 'skyraider', 'Pilot'));
  const bad = stepN(room, sim, 2 * TICK_HZ);
  const st = baseAssaultState(sim);
  let seq = 1;
  const e = () => sim.entities.get(slot.entity);
  const press = (i) => room.handle(slot.pid, { t: 'input', cmds: [{ ...emptyInput(seq++), buttons: i % 10 < 5 ? Btn.Interact : 0 }] });
  placeAtEnemyStand(sim, e());
  bad.push(...stepN(room, sim, 2, press));
  const carrying = st.balls[1].carrier === slot.entity;
  const { spawnKart } = await import('../src/sim/vehicles');
  const { spawnPlane } = await import('../src/sim/vehicles/plane-systems');
  const res = { scenario: 'plane', carrying };
  // 1. a kart parked 1.6 m away
  const k = spawnKart(sim, 'mower_kart', 0, e().pos.x + 1.6, e().pos.y, e().pos.z, 0);
  let seated = 0;
  bad.push(...stepN(room, sim, 60, (i) => { press(i); if (e().seat) seated++; }));
  res.kart = { seatedTicks: seated, stillCarrier: st.balls[1].carrier === slot.entity };
  sim.removeEntity(k.id);
  // 2. a plane parked 1.5 m away on the lawn
  const p = spawnPlane(sim, 'rc_plane', 0, e().pos.x - 1.5, e().pos.y, e().pos.z + 1.5, 0);
  seated = 0;
  bad.push(...stepN(room, sim, 60, (i) => { press(i); if (e().seat) seated++; }));
  res.plane = { spawned: !!p, seatedTicks: seated, stillCarrier: st.balls[1].carrier === slot.entity };
  if (p) sim.removeEntity(p.id);
  // 3. walk (3 m per tick, never a teleport) to the Rooftop Hangar and press E at it: it may vend, never seat
  const hangar = [...sim.entities.values()].find((x) => x.terminal?.id === 'plane_hangar');
  if (hangar) {
    const tx = hangar.pos.x + 1.4, tz = hangar.pos.z;
    for (let n = 0; n < 200; n++) {
      const d = Math.hypot(tx - e().pos.x, tz - e().pos.z);
      if (d < 0.3) break;
      const s = Math.min(3, d);
      place(sim, e(), e().pos.x + ((tx - e().pos.x) / d) * s, e().pos.z + ((tz - e().pos.z) / d) * s);
      bad.push(...stepN(room, sim, 1));
    }
    seated = 0;
    bad.push(...stepN(room, sim, 240, (i) => { press(i); if (e().seat) seated++; }));
    const planes = [...sim.entities.values()].filter((x) => x.plane);
    res.hangar = { at: [r1(e().pos.x), r1(e().pos.y), r1(e().pos.z)], hangarAt: [r1(hangar.pos.x), r1(hangar.pos.y), r1(hangar.pos.z)], vended: planes.length, seatedTicks: seated, stillCarrier: st.balls[1].carrier === slot.entity };
  } else res.hangar = null;
  res.gliding = (e().flags & EFlag.Gliding) !== 0;
  res.invariantViolations = bad.length;
  out(res);
  room.dispose();
}

if (scenario === 'stucktrace') {
  const seed = Number(opt('seed', 9));
  const map = opt('map', '') === 'west_yard' ? '' : opt('map', '');
  const variant = opt('variant', 'base');
  const over = Number(opt('over', 3));
  applySpeed(variant === 'speed' || variant === 'both');
  const world = variant === 'mirror' || variant === 'both' ? await mirroredWorld(seed, map) : undefined;
  const sim = await Sim.create({ seed, ...(world ? { world } : map ? { map } : {}) });
  sim.state.matchConfig = { baseAssault: { timeLimit: Number(opt('seconds', 300)), endedHold: 2, captureLimit: Number(opt('limit', 99)) } };
  const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [4, 4] });
  const runs = new Map(); // id -> { from, samples }
  const W = sim.worldData;
  const near = (x, y, z) => {
    const o = [];
    for (const b of W.props) {
      const dx = Math.max(0, Math.abs(x - b.x) - b.hx), dz = Math.max(0, Math.abs(z - b.z) - b.hz);
      if (Math.hypot(dx, dz) < 1.2 && b.y + b.hy > y && b.y - b.hy < y + 1.5) o.push(`box ${b.kind ?? b.type ?? ''} c(${r1(b.x)},${r1(b.y)},${r1(b.z)}) h(${r2(b.hx)},${r2(b.hy)},${r2(b.hz)})`);
    }
    for (const c of W.cylinders ?? []) {
      const d = Math.hypot(x - c.x, z - c.z) - c.r;
      if (d < 1.2 && c.y + c.hh > y && c.y - c.hh < y + 1.5) o.push(`cyl ${c.kind ?? c.type ?? ''} c(${r1(c.x)},${r1(c.y)},${r1(c.z)}) r ${r2(c.r)} hh ${r2(c.hh)}`);
    }
    return o;
  };
  const meters = new Map();
  for (let i = 0; i < (Number(opt('seconds', 300)) + 8) * TICK_HZ; i++) {
    room.tick();
    for (const e of sim.entities.values()) {
      if (!e.char || e.kind !== EntityKind.Bot) continue;
      let mt = meters.get(e.id);
      if (!mt) { mt = { px: e.pos.x, pz: e.pos.z, odo: 0, want: 0, n: 0, stuck: 0 }; meters.set(e.id, mt); }
      mt.odo += Math.hypot(e.pos.x - mt.px, e.pos.z - mt.pz); mt.px = e.pos.x; mt.pz = e.pos.z;
      if (!e.dead && Math.hypot(e.input.mx, e.input.mz) > 0.5) mt.want++;
      if (++mt.n >= 30) {
        const was = mt.stuck;
        mt.stuck = !e.dead && mt.want >= 27 && mt.odo < 0.25 ? mt.stuck + 0.5 : 0;
        if (mt.stuck >= over && (mt.stuck === over || mt.stuck % 2 === 0)) {
          const t = e.ai?.tac;
          out({ t: r1(sim.tick / TICK_HZ), bot: e.name, cls: e.cls, stuckS: mt.stuck, pos: [r2(e.pos.x), r2(e.pos.y), r2(e.pos.z)], input: [r2(e.input.mx), r2(e.input.mz), r2(e.input.yaw)],
            mode: e.ai?.mode, goal: t?.goal, g: t ? [r1(t.gx), r1(t.gz)] : null, role: baRoleOf(e), carrier: (e.flags & EFlag.Carrier) !== 0, props: near(e.pos.x, e.pos.y, e.pos.z),
            ents: mt.stuck === over ? [...sim.entities.values()].filter((o) => o !== e && Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < 3.5).map((o) => `${o.kind}:${o.name ?? ''}${o.kart ? ' kart' : ''}${o.terminal ? ' terminal ' + o.terminal.id : ''}${o.ordnance ? ' kiosk' : ''} (${r2(o.pos.x)},${r2(o.pos.y)},${r2(o.pos.z)})${o.dead ? ' dead' : ''}`) : undefined,
            spawnsNear: mt.stuck === over ? W.spawns.filter((q) => Math.hypot(q.x - e.pos.x, q.z - e.pos.z) < 4).map((q) => [q.team, r1(q.x), r1(q.z)]) : undefined,
            ground: r2(W.height(e.pos.x, e.pos.z)) });
        }
        if (was >= over && mt.stuck === 0) out({ t: r1(sim.tick / TICK_HZ), bot: e.name, freedAfterS: was, pos: [r2(e.pos.x), r2(e.pos.z)] });
        mt.odo = 0; mt.want = 0; mt.n = 0;
      }
    }
  }
  room.dispose();
}

if (scenario === 'los') {
  const { navGridFor, findPath } = await import('../src/sim/ai/nav');
  const { worldLineClear } = await import('../src/sim/combat');
  const map = opt('map', '') === 'west_yard' ? '' : opt('map', '');
  const variant = opt('variant', 'base');
  const seed = Number(opt('seed', 6));
  const world = variant === 'mirror' || variant === 'both' ? await mirroredWorld(seed, map) : variant === 'cover' ? await coveredWorld(seed, map) : undefined;
  const sim = await Sim.create({ seed, ...(world ? { world } : map ? { map } : {}) });
  const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [0, 0] });
  for (let i = 0; i < 30; i++) room.tick();
  const st = baseAssaultState(sim);
  const g = navGridFor(sim);
  const H = (x, z) => sim.worldData.height(x, z);
  for (const thief of [0, 1]) {
    const def = 1 - thief;
    const s = st.spots[def].stand, f = st.spots[thief].flag;
    const p = [];
    findPath(g, s.x, s.z, f.x, f.z, p);
    const pts = [];
    let px = s.x, pz = s.z;
    for (let i = 0; i < p.length; i += 2) { const L = Math.hypot(p[i] - px, p[i + 1] - pz); for (let k = 0; k < L; k += 1) pts.push([px + ((p[i] - px) * k) / L, pz + ((p[i + 1] - pz) * k) / L]); px = p[i]; pz = p[i + 1]; }
    const watch = [...sim.worldData.spawns.filter((q) => q.team === def).map((q) => [q.x, q.z]),
      ...Array.from({ length: 8 }, (_, k) => [s.x + Math.cos((k / 8) * Math.PI * 2) * 9, s.z + Math.sin((k / 8) * Math.PI * 2) * 9])];
    const per10 = [];
    for (let b = 0; b < 70; b += 10) {
      let seen = 0, n = 0;
      for (let i = b; i < Math.min(b + 10, pts.length); i++) {
        const [x, z] = pts[i];
        for (const [wx, wz] of watch) {
          if (Math.hypot(wx - x, wz - z) > 60) continue;
          n++;
          if (worldLineClear(sim, wx, H(wx, wz) + 1.0, wz, x, H(x, z) + 0.8, z)) seen++;
        }
      }
      per10.push(n ? Math.round((100 * seen) / n) : null);
    }
    out({ scenario: 'los', map: map || 'west_yard', variant, thief: thief ? 'cats' : 'corgis', from: def ? 'cat stand' : 'corgi stand', routeM: pts.length, exposurePct0to70by10: per10 });
  }
  room.dispose();
}
