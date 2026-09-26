#!/usr/bin/env node
// Q1 verification probe (read-only): shipping-config yard-skirmish outcomes for the lineups players actually get.
//   offline default (main.ts): bots '3,0' → you + 2 corgi bots vs PvE waves
//   online default (server/config.ts): BOTS 0,4 → you alone + 4 room cats (team-fill accuracy) + PvE waves
// "You" is a human slot fed by the bot brain through Room.handle (like tools/soak.mjs's net-bot) — a competent
// stand-in, not a human. Also an AFK variant (you never send input) to see how the squad carries a new player.
//   npx tsx tools/qa-difficulty.mjs [--seconds 480] [--seeds 1,2]
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';
import { applyArchetype } from '../src/sim/ai';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SECONDS = Number(opt('seconds', 480));
const SEEDS = opt('seeds', '1,2').split(',').map(Number);

async function run(label, bots, afk, seed, mode = 'yard-skirmish') {
  const sim = await Sim.create({ seed });
  const room = new Room(sim, { mode, botsPerTeam: bots });
  const slot = room.join({ id: 'you', send() {} }, { t: 'hello', v: PROTOCOL_VERSION, name: 'You', team: 0, cls: 'assault' });
  let seq = 0, deaths = 0, kills = 0, firstDeath = -1, maxWave = 0, results = [], wipes = 0;
  const drain = sim.drainEvents.bind(sim);
  sim.drainEvents = () => {
    const evs = drain();
    for (const e of evs) {
      if (e.e === 'death' && e.id === slot.entity) { deaths++; if (firstDeath < 0) firstDeath = sim.tick; }
      if (e.e === 'death' && e.by === slot.entity && e.id !== slot.entity) kills++;
      if (e.e === 'score' && e.reason === 'win') results.push({ t: +(sim.tick / TICK_HZ).toFixed(0), winner: e.team });
    }
    return evs;
  };
  let lastObj = '';
  for (let t = 0; t < SECONDS * TICK_HZ; t++) {
    const e = sim.entities.get(slot.entity);
    if (e && !afk) {
      if (!e.ai) applyArchetype(e, 'rifleman', { external: true });
      const c = e.ai?.out;
      if (c) room.handle('you', { t: 'input', cmds: [{ seq: ++seq, mx: c.mx, mz: c.mz, yaw: c.yaw, pitch: c.pitch, buttons: c.buttons, rt: Math.max(0, sim.tick - 6) }] });
    }
    room.tick();
    const m = room.match;
    maxWave = Math.max(maxWave, m.wave);
    if (m.objective !== lastObj && /Squad down/.test(m.objective) && !/Squad down/.test(lastObj)) wipes++;
    lastObj = m.objective;
    if (results.length) break;
  }
  const m = room.match;
  console.log(`${label.padEnd(34)} seed ${seed} · ${results.length ? `RESULT @${results[0].t}s winner ${results[0].winner === 0 ? 'Corgis' : results[0].winner === 1 ? 'Cats' : 'draw'} ${m.score[0]}:${m.score[1]}` : `no result in ${SECONDS}s`} · max wave ${maxWave} · squad wipes ${wipes} · you: ${kills} kills / ${deaths} deaths, first death @${firstDeath < 0 ? '-' : (firstDeath / TICK_HZ).toFixed(0) + 's'} · end "${m.objective}"`);
}

const MODES = opt('modes', 'skirmish').split(',');
for (const seed of SEEDS) {
  if (MODES.includes('tdm')) {
    await run('TDM offline default (4,5) you=corgi', [4, 5], false, seed, 'team-deathmatch');
    await run('TDM mirrored (5,5) you=corgi', [5, 5], false, seed, 'team-deathmatch');
  }
  if (!MODES.includes('skirmish')) continue;
  await run('offline default (3,0) competent you', [3, 0], false, seed);
  await run('offline default (3,0) AFK you', [3, 0], true, seed);
  await run('online default (0,4) competent you', [0, 4], false, seed);
}
