#!/usr/bin/env node
// C2b probe (read-only): do bots use their class abilities and play the objectives?
//   TDM 6v6, every class kit on both teams (room bots, shipping match config): class-ability uses per class, per
//   bot per 90 s of live combat (the C2b bar is >= 1), plus Upgrade Cores taken by bots.
//   Yard skirmish, 3 corgi bots and no human (then the offline default: 2 bots + an AFK human) vs the PvE waves: the
//   Squeaker mission steps the bots complete with no human help (and when), ability uses by the squad and wave cats.
//   npx tsx tools/qa-abilities.mjs [--seconds 240] [--seeds 1,2] [--modes tdm,skirmish]
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';
import { CLASS_IDS, Team } from '../src/shared/types';
import { CLASSES } from '../src/shared/content/classes';
import { CORE_IDS } from '../src/shared/content/pickups';
import { objectiveState } from '../src/sim/interact';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SECONDS = Number(opt('seconds', 240));
const SEEDS = opt('seeds', '1,2').split(',').map(Number);
const MODES = opt('modes', 'tdm,skirmish').split(',');

/** Wrap drainEvents: class-ability uses per class (and per PvE/room), core pickups, live seconds. */
function instrument(sim, room) {
  const T = { uses: {}, pveUses: {}, bots: {}, cores: 0, liveTicks: 0 };
  for (const c of CLASS_IDS) { T.uses[c] = 0; T.pveUses[c] = 0; }
  const drain = sim.drainEvents.bind(sim);
  sim.drainEvents = () => {
    const evs = drain();
    for (const ev of evs) {
      if (ev.e === 'ability') {
        const e = sim.entities.get(ev.id);
        if (!e?.char || !e.cls || CLASSES[e.cls].ability !== ev.ability) continue;
        if (e.combat?.pve) T.pveUses[e.cls]++; else T.uses[e.cls]++;
      } else if (ev.e === 'pickup' && CORE_IDS.includes(ev.item)) {
        const e = sim.entities.get(ev.id);
        if (e?.ai && !e.ai.external) T.cores++;
      }
    }
    return evs;
  };
  T.tick = () => { if (room.match.phase === 'live') T.liveTicks++; };
  return T;
}

async function tdm(seed) {
  const sim = await Sim.create({ seed });
  const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [0, 0] });
  const T = instrument(sim, room);
  const perClass = {};
  for (const team of [Team.Corgis, Team.Cats]) for (const cls of CLASS_IDS) { room.addBot(team, cls); perClass[cls] = (perClass[cls] ?? 0) + 1; }
  const results = [];
  for (let t = 0; t < SECONDS * TICK_HZ; t++) {
    const before = room.match.phase;
    room.tick();
    T.tick();
    if (before !== 'ended' && room.match.phase === 'ended') results.push(`${room.match.score[0]}:${room.match.score[1]}`);
  }
  const live = T.liveTicks / TICK_HZ;
  const rows = CLASS_IDS.map((c) => {
    const per90 = T.uses[c] / perClass[c] / (live / 90);
    return { cls: c, ability: CLASSES[c].ability, uses: T.uses[c], per90: Math.round(per90 * 100) / 100 };
  });
  const min = Math.min(...rows.map((r) => r.per90));
  console.log(`TDM 6v6 seed ${seed} · ${live.toFixed(0)} s live · matches ${results.join(', ') || '-'} · cores taken by bots ${T.cores}`);
  for (const r of rows) console.log(`  ${r.cls.padEnd(12)} ${r.ability.padEnd(15)} uses ${String(r.uses).padStart(4)} · per bot per 90 s ${r.per90.toFixed(2)}${r.per90 < 1 ? '  ✘ < 1' : ''}`);
  console.log(`  min per bot per 90 s: ${min.toFixed(2)} ${min >= 1 ? 'PASS' : 'FAIL'}`);
  return min >= 1;
}

async function skirmish(seed, afk) {
  const sim = await Sim.create({ seed });
  const room = new Room(sim, { mode: 'yard-skirmish', botsPerTeam: [3, 0] });
  if (afk) room.join({ id: 'you', send() {} }, { t: 'hello', v: PROTOCOL_VERSION, name: 'You', team: 0, cls: 'assault' }); // AFK
  else for (let i = 0; i < 3; i++) room.addBot(Team.Corgis, CLASS_IDS[i]); // fillBots only runs on join
  const T = instrument(sim, room);
  const steps = [];
  let lastStep = -1, result = '';
  for (let t = 0; t < SECONDS * TICK_HZ; t++) {
    room.tick();
    T.tick();
    const st = objectiveState(sim);
    if (st && st.step !== lastStep) {
      if (st.step > lastStep && st.step > 0) steps.push(`${st.step}/${st.total} @${(sim.tick / TICK_HZ).toFixed(0)}s`);
      lastStep = st.step;
    }
    if (!result && room.match.phase === 'ended') result = `${room.match.winner === 0 ? 'Corgis' : 'Cats'} win @${(sim.tick / TICK_HZ).toFixed(0)}s (wave ${room.match.wave})`;
  }
  const fmt = (o) => CLASS_IDS.filter((c) => o[c]).map((c) => `${c} ${o[c]}`).join(' · ') || '-';
  console.log(`skirmish (${afk ? '2 bots + AFK you' : '3 bots, no human'}) seed ${seed} · mission steps done: ${steps.join(', ') || 'none'} · ${result || `no result in ${SECONDS}s (wave ${room.match.wave})`}`);
  console.log(`  squad ability uses: ${fmt(T.uses)} · wave-cat uses: ${fmt(T.pveUses)} · cores taken by bots ${T.cores}`);
  return steps.length > 0;
}

let ok = true;
for (const seed of SEEDS) {
  if (MODES.includes('tdm')) ok = (await tdm(seed)) && ok;
  if (MODES.includes('skirmish')) {
    ok = (await skirmish(seed, false)) && ok; // the C2b bar: bots advance the mission with no human
    await skirmish(seed, true); // reported, not gated: an AFK human anchors the squad (bots help a human under fire)
  }
}
console.log(ok ? 'QA-ABILITIES PASS' : 'QA-ABILITIES FAIL');
process.exit(ok ? 0 : 1);
