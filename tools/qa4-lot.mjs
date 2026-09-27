#!/usr/bin/env node
// Q4 verification probe (read-only): The Lot after W9 L3.
//   npx tsx tools/qa4-lot.mjs lanes [--mode team-deathmatch] [--per 14] [--seeds 5,6,7,8] [--seconds 90]
//        bot-seconds per district (L3's method: 2 Hz samples of living room bots after a 5 s warm-up), perch time,
//        pickups collected, deaths, stuck max. The lane gate is Canyon and Pipeworks each >= 25 % of the Mud.
//   npx tsx tools/qa4-lot.mjs weather [--seeds 1..20]
//        the schedule the client builds (createWorldData(seed, map), what main.ts uses) against the authority's
//        (sim.worldData via simWeather), tick by tick over 13 min; rain arrival, wet and storm share; West Yard unchanged
import { loadavg } from 'node:os';
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { createWorldData } from '../src/shared/world/world-data';
import { weatherAt } from '../src/shared/world/weather';
import { simWeather } from '../src/sim/world/env';
import { districtAt } from '../src/shared/world/queries';
import { laneRunOf } from '../src/sim/ai/lanes';
import { TICK_HZ } from '../src/shared/constants';
import { EntityKind } from '../src/shared/types';

const argv = process.argv.slice(2);
const scenario = argv[0] ?? 'lanes';
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const seedsOf = (d) => String(opt('seeds', d)).split(',').map(Number);
const r2 = (v) => Math.round(v * 100) / 100;
const out = (o) => console.log(JSON.stringify(o));

function stuckMeter(e) {
  let px = e.pos.x, pz = e.pos.z, odo = 0, want = 0, n = 0, stuck = 0, max = 0, where = '';
  return {
    tick() {
      odo += Math.hypot(e.pos.x - px, e.pos.z - pz); px = e.pos.x; pz = e.pos.z;
      if (!e.dead && Math.hypot(e.input.mx, e.input.mz) > 0.5) want++;
      if (++n >= 30) { stuck = !e.dead && want >= 27 && odo < 0.25 ? stuck + 0.5 : 0; if (stuck > max) { max = stuck; where = `${e.name} ${e.cls} (${r2(e.pos.x)}, ${r2(e.pos.z)})`; } odo = 0; want = 0; n = 0; }
    },
    get max() { return max; }, get where() { return where; },
  };
}

if (scenario === 'lanes') {
  const mode = opt('mode', 'team-deathmatch');
  const per = Number(opt('per', 14));
  const LIVE = Number(opt('seconds', 90)) * TICK_HZ, WARM = 5 * TICK_HZ;
  const pool = new Map();
  let deaths = 0, stuckMax = 0, stuckWhere = '', pickups = 0, laneWalkers = 0;
  const perched = new Map();
  for (const seed of seedsOf('5,6,7,8')) {
    const sim = await Sim.create({ seed, map: 'the_lot' });
    const cfg = { 'team-deathmatch': { tdm: { warmup: 3 } }, 'core-rush': { coreRush: { warmup: 3 } }, 'base-assault': { baseAssault: { warmup: 3 } }, 'yard-skirmish': {} };
    sim.state.matchConfig = cfg[mode];
    const room = new Room(sim, { mode, botsPerTeam: mode === 'yard-skirmish' ? [per, 0] : [per, per] });
    let d = 0, pk = 0;
    const emit = sim.emit.bind(sim);
    sim.emit = (ev) => { if (ev.e === 'death') d++; if (ev.e === 'pickup' && ev.item !== 'squeaky_ball' && !/grenade|bomb/.test(ev.item)) pk++; emit(ev); };
    const perD = new Map();
    const meters = new Map();
    const walkers = new Set();
    for (let i = 0; i < WARM + LIVE; i++) {
      room.tick();
      for (const e of sim.entities.values()) {
        if (!e.char || e.kind !== EntityKind.Bot) continue;
        let m = meters.get(e.id);
        if (!m) { m = stuckMeter(e); meters.set(e.id, m); }
        m.tick();
        if (i < WARM || i % 30 || e.dead) continue;
        if (laneRunOf(e)) walkers.add(e.id);
        const k = districtAt(sim.worldData, e.pos.x, e.pos.z)?.name ?? 'open ground';
        perD.set(k, (perD.get(k) ?? 0) + 0.5);
        const p = e.ai?.perch;
        if (p && p.reachedAt >= 0) perched.set(p.id, (perched.get(p.id) ?? 0) + 0.5);
      }
    }
    for (const m of meters.values()) if (m.max > stuckMax) { stuckMax = m.max; stuckWhere = `seed ${seed}: ${m.where}`; }
    for (const [k, v] of perD) pool.set(k, (pool.get(k) ?? 0) + v);
    deaths += d; pickups += pk; laneWalkers += walkers.size;
    const g = (k) => perD.get(k) ?? 0;
    out({ seed, mode, per, deaths: d, pickups: pk, laneWalkers: walkers.size, mud: g('The Mud'), canyon: g('Container Canyon'), pipeworks: g('The Pipeworks'),
      canyonRatio: r2(g('Container Canyon') / Math.max(1, g('The Mud'))), pipesRatio: r2(g('The Pipeworks') / Math.max(1, g('The Mud'))), load: loadavg()[0].toFixed(1) });
    room.dispose();
  }
  const g = (k) => pool.get(k) ?? 0;
  out({ pooled: true, mode, per, seeds: seedsOf('5,6,7,8'), mud: g('The Mud'), canyon: g('Container Canyon'), pipeworks: g('The Pipeworks'),
    canyonRatio: r2(g('Container Canyon') / Math.max(1, g('The Mud'))), pipesRatio: r2(g('The Pipeworks') / Math.max(1, g('The Mud'))),
    all: Object.fromEntries([...pool].sort((a, b) => b[1] - a[1])), perched: Object.fromEntries(perched), deaths, pickups, laneWalkers, stuckMax, stuckWhere });
}

if (scenario === 'weather') {
  const rows = [];
  let mismatches = 0, wyMismatch = 0;
  for (const seed of seedsOf('1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20')) {
    const client = createWorldData(seed, 'the_lot');
    const sim = await Sim.create({ seed, map: 'the_lot' });
    let firstRain = -1, wet = 0, storm = 0, n = 0;
    const cs = weatherAt(client, 0);
    for (let t = 0; t < 13 * 60 * TICK_HZ; t += 30) {
      sim.tick = t;
      const a = simWeather(sim);
      weatherAt(client, t, cs);
      const ca = weatherAt(sim.worldData, t);
      if (cs.kind !== ca.kind || Math.abs(cs.blend - ca.blend) > 1e-12) mismatches++;
      for (const k of ['cloud', 'rain', 'storm', 'wind', 'wet', 'fog', 'dark', 'sight']) if (Math.abs(cs[k] - a[k]) > 1e-12) { mismatches++; break; }
      n++;
      if (cs.wet > 0.5) wet++;
      if (cs.kind === 'storm') storm++;
      if (firstRain < 0 && (cs.kind === 'rain' || cs.kind === 'storm')) firstRain = t / TICK_HZ;
      void a;
    }
    // the West Yard: the world key and the bare seed give the same schedule (no bias)
    const wy = createWorldData(seed);
    for (let t = 0; t < 13 * 60 * TICK_HZ; t += 120) { const x = weatherAt(wy, t), y = weatherAt(seed, t); if (x.kind !== y.kind || x.blend !== y.blend) wyMismatch++; }
    rows.push({ seed, bias: !!client.weatherBias, firstRainMin: r2(firstRain / 60), wet: r2(wet / n), storm: r2(storm / n) });
    sim.dispose?.();
  }
  out({ scenario: 'weather', clientVsAuthorityMismatches: mismatches, westYardKeyVsSeedMismatches: wyMismatch,
    firstRainMin: [Math.min(...rows.map((r) => r.firstRainMin)), Math.max(...rows.map((r) => r.firstRainMin))],
    wetMean: r2(rows.reduce((a, r) => a + r.wet, 0) / rows.length), stormMean: r2(rows.reduce((a, r) => a + r.storm, 0) / rows.length), rows });
}
