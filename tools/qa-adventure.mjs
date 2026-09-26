#!/usr/bin/env node
// Q2 verification probe (read-only): the adventure's headline claims on the real West Yard, re-measured.
//   npx tsx tools/qa-adventure.mjs bots   [--seeds 7,8] [--chapters yard_day,...]   bot-only squads: time vs par, wipes, steps, tick
//   npx tsx tools/qa-adventure.mjs offkit [--seeds 1]                                 same, but every pup an Assault: does the kit matter?
//   npx tsx tools/qa-adventure.mjs wipe   [--seeds 7]                                 force a squad wipe on the first checkpoint step > 0
//   npx tsx tools/qa-adventure.mjs grace                                              a human stand-in without the kit: 120 s grace
//   npx tsx tools/qa-adventure.mjs stealth                                            ch2: spotted in the open → alarm; hidden → none
//   npx tsx tools/qa-adventure.mjs steal  [--seeds 1,2,3]                             ch3 with a human (AFK, then teleported to the wall): do the pups breach first?
// Rooms are built like the shipping client/server (Room + default systems); "humans" are Room slots with a stub Conn.
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { createDefaultSystems } from '../src/sim/systems';
import { adventureSystems, adventureState, adventureRuntime } from '../src/sim/adventure';
import { kill } from '../src/sim/combat/damage';
import { destructiblesByTag } from '../src/sim/destruct';
import { chapterById, CHAPTERS, GRACE_BARK } from '../src/shared/content/chapters';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';
import { EFlag, EntityKind, Team } from '../src/shared/types';
import { concealmentAt, surfaceAt } from '../src/shared/world/queries';

const argv = process.argv.slice(2);
const scenario = argv[0] ?? 'bots';
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = String(opt('seeds', scenario === 'bots' ? '7,8' : '7')).split(',').map(Number);
const CH = String(opt('chapters', CHAPTERS.map((c) => c.id).join(','))).split(',');

const systems = () => { const s = createDefaultSystems(); return s.some((x) => x.name === 'adventure') ? s : [...s, ...adventureSystems()]; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };

async function room(chapter, seed, { bots = [4, 0], cfg } = {}) {
  const sim = await Sim.create({ seed, systems: systems() });
  if (cfg) sim.state.adventureConfig = cfg;
  const r = new Room(sim, { mode: 'adventure', chapter, botsPerTeam: bots });
  const events = [];
  const drain = sim.drainEvents.bind(sim);
  sim.drainEvents = () => { const a = drain(); events.push(...a); return a; };
  return { sim, room: r, events };
}

function tickUntil(ctx, seconds, until, perTick) {
  const ms = [];
  for (let i = 0; i < seconds * TICK_HZ; i++) {
    const t0 = performance.now(); ctx.room.tick(); ms.push(performance.now() - t0);
    perTick?.(i);
    if (until?.()) break;
  }
  return ms;
}

async function botRun(chapter, seed, cfg) {
  const def = chapterById(chapter);
  const ctx = await room(chapter, seed, { cfg });
  const steps = []; let step = -1, since = 0;
  const ms = tickUntil(ctx, def.par * 2 + 40, () => adventureState(ctx.sim)?.phase === 'complete', () => {
    const st = adventureState(ctx.sim);
    if (st?.phase === 'live' && st.step !== step) { if (step >= 0) steps[step] = (steps[step] ?? 0) + (ctx.sim.tick - since) / TICK_HZ; step = st.step; since = ctx.sim.tick; }
    if (st?.phase === 'complete' && step >= 0 && steps.length <= step) steps[step] = (steps[step] ?? 0) + (ctx.sim.tick - since) / TICK_HZ;
  });
  const st = adventureState(ctx.sim);
  const out = { chapter, seed, complete: st.phase === 'complete', time: st.time, par: def.par, medal: st.medal, wipes: st.wipes, step: st.step, of: def.steps.length,
    steps: steps.map((s, i) => `${def.steps[i].id} ${s.toFixed(1)}`).join(' · '), tickP50: pct(ms, 0.5).toFixed(3), tickP95: pct(ms, 0.95).toFixed(3), tickMax: Math.max(...ms).toFixed(1),
    chars: [...ctx.sim.entities.values()].filter((e) => e.char).length, counters: JSON.stringify(st.counters) };
  ctx.room.dispose();
  return out;
}

function humanSlot(ctx, cls) {
  const conn = { id: `qa-${Math.random()}`, sent: [], send(m) { this.sent.push(m); } };
  const slot = ctx.room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: 'QA', team: 0, cls });
  return { conn, slot, ent: () => ctx.sim.entities.get(slot.entity ?? ctx.room.players?.get?.(slot.pid)?.entity) };
}

if (scenario === 'bots' || scenario === 'offkit') {
  for (const chapter of CH) for (const seed of SEEDS) {
    const def = chapterById(chapter);
    const cfg = scenario === 'offkit' ? { chapter: { ...def, pups: ['assault', 'assault', 'assault', 'assault'] } } : undefined;
    const r = await botRun(chapter, seed, cfg);
    console.log(JSON.stringify(r));
  }
}

if (scenario === 'wipe') {
  for (const chapter of CH) for (const seed of SEEDS) {
    const def = chapterById(chapter);
    const at = opt('at', null); const cp = at !== null ? Number(at) : def.steps.findIndex((s, i) => i > 0 && s.checkpoint);
    if (cp < 0) { console.log(JSON.stringify({ chapter, note: 'no checkpoint after step 0' })); continue; }
    const ctx = await room(chapter, seed);
    // reach the checkpoint step, then 1 s into it: every squad member down at once
    tickUntil(ctx, def.par * 2, () => { const st = adventureState(ctx.sim); return st.phase === 'live' && st.step === cp; });
    tickUntil(ctx, 1);
    const squad = [...ctx.sim.entities.values()].filter((e) => e.char && e.team === Team.Corgis && !e.dead);
    const src = { id: -1, team: Team.Cats, weapon: -1 };
    for (const e of squad) kill(ctx.sim, e, src);
    let failed = false, failedTick = -1;
    tickUntil(ctx, 2, () => { const st = adventureState(ctx.sim); if (st.phase === 'failed' && !failed) { failed = true; failedTick = ctx.sim.tick; } return failed; });
    let restartStep = -1, restartTick = -1;
    tickUntil(ctx, 10, () => { const st = adventureState(ctx.sim); if (st.phase === 'live') { restartStep = st.step; restartTick = ctx.sim.tick; return true; } return false; });
    const alive = [...ctx.sim.entities.values()].filter((e) => e.char && e.team === Team.Corgis && !e.dead).length;
    tickUntil(ctx, def.par * 3, () => adventureState(ctx.sim).phase === 'complete');
    const st = adventureState(ctx.sim);
    console.log(JSON.stringify({ chapter, seed, checkpointStep: cp, killed: squad.length, failed, beat: ((restartTick - failedTick) / TICK_HZ).toFixed(2), restartStep, aliveAfter: alive, wipes: st.wipes, laterWipes: st.wipes - 1, complete: st.phase === "complete", time: st.time, medal: st.medal }));
    ctx.room.dispose();
  }
}

if (scenario === 'grace') {
  // A human stand-in (no input) placed in the step's zone the "wrong" way; bots off so nothing else can finish it.
  const cases = [
    { chapter: 'last_ball', step: 0, cls: 'assault', at: { x: 84, y: 0.05, z: -26 }, what: 'glide step, standing on the lawn in the zone (no glide)' },
    { chapter: 'laser_dawn', step: 0, cls: 'assault', at: { x: 69.1, y: 0.2, z: -49.1 }, what: 'perch step, inside the garage under the perch (minY 6.5)' },
    { chapter: 'garage_job', step: 3, cls: 'breacher', at: { x: -77, y: 0.05, z: -63.5 }, what: 'escape step, on foot at the garden gate (vehicle)' },
  ];
  for (const c of cases) {
    const def = chapterById(c.chapter);
    const cfg = { chapter: { ...def, steps: def.steps.slice(c.step) }, briefing: 0.1, briefingWait: 0.1 };
    const ctx = await room(c.chapter, 7, { bots: [0, 0], cfg });
    const h = humanSlot(ctx, c.cls);
    tickUntil(ctx, 20, () => adventureState(ctx.sim).phase === 'live');
    const e = [...ctx.sim.entities.values()].find((x) => x.kind === EntityKind.Player);
    let doneAt = -1, bark = -1, deaths = 0; const t0 = ctx.sim.tick;
    let at119 = null;
    tickUntil(ctx, 135, () => doneAt >= 0, () => {
      if (!e.dead && Math.hypot(e.pos.x - c.at.x, e.pos.z - c.at.z) > 1.5) ctx.sim.placeCharacter(e, c.at.x, c.at.y, c.at.z);
      if (e.dead) deaths++;
      e.health.hp = e.health.max; // stand-in is not what's measured here: keep it alive
      const st = adventureState(ctx.sim);
      const t = (ctx.sim.tick - t0) / TICK_HZ;
      if (at119 === null && t >= 119) at119 = st.step;
      if (st.step > 0 || st.phase === 'complete') doneAt = t;
    });
    for (const ev of ctx.events) if (ev.e === 'bark' && ev.line === GRACE_BARK && bark < 0) bark = 1;
    console.log(JSON.stringify({ chapter: c.chapter, case: c.what, stepAt119s: at119, completedAfter: doneAt < 0 ? 'never (135 s)' : `${doneAt.toFixed(2)} s`, graceBark: bark > 0, y: +e.pos.y.toFixed(2), deaths }));
    ctx.room.dispose();
  }
}

if (scenario === 'stealth') {
  const def = chapterById('tall_grass');
  for (const where of [
    { name: 'open lawn 8.5 m from the meadow-edge sentry (-73.5,-8.5)', x: -70, z: 0, hidden: false },
    { name: 'hidden (tall grass) at the catnip patch, still, 11 m from the compost-bin sentry', x: -91.5, z: -40, hidden: true, stop: true },
    { name: 'hidden (tall grass) in the meadow, still, 15+ m from every sentry', x: -88, z: -20, hidden: true, stop: true },
  ]) {
    const cfg = { chapter: where.stop ? { ...def, steps: [{ ...def.steps[0], trigger: { type: 'survive', params: { seconds: 999 } } }] } : def, briefing: 0.1, briefingWait: 0.1 };
    const ctx = await room('tall_grass', 7, { bots: [0, 0], cfg });
    humanSlot(ctx, 'infiltrator');
    tickUntil(ctx, 20, () => adventureState(ctx.sim).phase === 'live');
    const e = [...ctx.sim.entities.values()].find((x) => x.kind === EntityKind.Player);
    ctx.sim.placeCharacter(e, where.x, surfaceAt(ctx.sim.worldData, where.x, where.z).y + 0.05, where.z);
    // a teleport leaves e.conceal stale until the world system runs (after the AI): set it as that system would for a still pet
    const zone = concealmentAt(ctx.sim.worldData, e.pos.x, e.pos.y, e.pos.z); e.conceal = { level: zone, zone, revealUntil: 0 };
    const near = Math.min(...[...ctx.sim.entities.values()].filter((c) => c.adv).map((c) => Math.hypot(c.pos.x - e.pos.x, c.pos.z - e.pos.z)));
    let alarmAt = -1, stealthed = 0, n = 0; const t0 = ctx.sim.tick;
    tickUntil(ctx, 25, () => alarmAt >= 0, () => {
      n++; if (e.flags & EFlag.Stealthed) stealthed++;
      const st = adventureState(ctx.sim);
      if (st.alarm && alarmAt < 0) alarmAt = (ctx.sim.tick - t0) / TICK_HZ;
    });
    const st = adventureState(ctx.sim);
    const hunters = [...ctx.sim.entities.values()].filter((x) => x.adv?.tag === 'alarm').length;
    const yell = ctx.events.some((ev) => ev.e === 'bark' && ev.id !== e.id);
    console.log(JSON.stringify({ case: where.name, concealment: zone, nearestSentryAtStart: +near.toFixed(1), alarm: st.alarm, alarmAfter: alarmAt, alarms: st.counters.alarms ?? 0, alarmHunters: hunters, catYelled: yell, stealthedFrac: +(stealthed / n).toFixed(2) }));
    ctx.room.dispose();
  }
}

if (scenario === 'steal') {
  for (const seed of SEEDS) {
    const ctx = await room('garage_job', seed);
    humanSlot(ctx, 'breacher');
    const wall = () => destructiblesByTag(ctx.sim, 'garage_breach_wall')[0];
    let liveAt = -1, brokeAt = -1;
    tickUntil(ctx, 60, null, () => { const st = adventureState(ctx.sim); if (st.phase === 'live' && liveAt < 0) liveAt = ctx.sim.tick; if (wall().dsx.broken && brokeAt < 0) brokeAt = ctx.sim.tick; });
    const charges = ctx.events.filter((e) => e.e === 'ability' && e.ability === 'dig_charge').length;
    const s0 = adventureState(ctx.sim).step;
    const h = [...ctx.sim.entities.values()].find((e) => e.kind === EntityKind.Player);
    ctx.sim.placeCharacter(h, 97, ctx.sim.worldData.height(97, -66) + 0.05, -66); // the human reaches the boarded-up wall
    let s1 = -1, s2 = -1;
    tickUntil(ctx, 30, () => s2 >= 0, () => { const st = adventureState(ctx.sim); if (st.step >= 1 && s1 < 0) s1 = ctx.sim.tick; if (st.step >= 2 && s2 < 0) s2 = ctx.sim.tick; });
    console.log(JSON.stringify({ seed, stepAfter60s: s0, wallBrokenByPups: brokeAt >= 0 ? `${((brokeAt - liveAt) / TICK_HZ).toFixed(1)} s after go-live, during step ${s0}` : 'no', pupCharges: charges, blowTheWallStepDoneAfterArrival: s2 >= 0 ? `${((s2 - s1) / TICK_HZ).toFixed(2)} s` : 'not in 30 s' }));
    ctx.room.dispose();
  }
}
