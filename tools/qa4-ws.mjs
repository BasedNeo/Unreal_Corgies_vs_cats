#!/usr/bin/env node
// Q4 verification probe (read-only): hostile raw-WebSocket clients against a running authority in a Base Assault room,
// with an observer client that checks the ball rules from the wire in every snapshot.
//   PORT=8796 npx tsx server/index.ts                 (another shell, from the snapshot)
//   npx tsx tools/qa4-ws.mjs --url ws://127.0.0.1:8796 [--map the_lot] [--seconds 90] [--room q4ws]
// Clients in one room (?room=…&mode=base-assault&map=…; bots fill the teams):
//   observer  (enc=raw) decodes each snapshot: exactly one ball prop per team; a carried ball's `ammo` names a living
//             entity that wears EFlag.Carrier; nobody else wears it; no entity carries two; every number finite
//   spammer   every button bit (Throw, Interact, Fire, …) toggled each frame, 3 inputs a frame
//   evil      non-finite and huge numbers, forged fields (x/y/z/hp/team/flags) inside inputs, a repeated hello
//   jumper    far-ahead seq jumps (the guard should kick it) · rogue: an unknown message type (kicked)
//   switcher  team and class messages every 50 ms (pending unless at deploy)
//   storm     closes and reconnects with a fresh hello every second
// Then: /health, /rooms and the observer's counts. Exit 1 on any ball-rule violation or an unhealthy server.
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../src/shared/constants';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const URL0 = opt('url', 'ws://127.0.0.1:8796');
const HTTP = URL0.replace(/^ws/, 'http');
const MAP = opt('map', 'west_yard');
const SECONDS = Number(opt('seconds', 90));
const ROOM = opt('room', `q4ws${MAP === 'the_lot' ? 'lot' : 'wy'}`);
const Q = `?room=${ROOM}&mode=base-assault&map=${MAP}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const F = ['id', 'kind', 'team', 'species', 'cls', 'seed', 'x', 'y', 'z', 'yaw', 'pitch', 'vx', 'vy', 'vz', 'hp', 'maxHp', 'anim', 'flags', 'weapon', 'ammo'];
const unpack = (a) => Object.fromEntries(F.map((f, i) => [f, a[i] ?? 0]));
const CARRIER = 1 << 20, DEAD = 1 << 4;
const KIND_PROP = 5; // EntityKind.Prop (the snapshot's ball/stand/ring entities)
const BALL_SEED = Number(opt('ball-seed', NaN));

function open(query, name, team, cls = 'assault', enc = '') {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${URL0}${query}${enc ? `&enc=${enc}` : ''}`);
    const s = { ws, name, snaps: 0, welcome: null, closed: null, lastSnap: null, onSnap: null };
    ws.on('message', (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch { return; }
      if (m.t === 'welcome') s.welcome = m;
      if (m.t === 'snap') { s.snaps++; s.lastSnap = m; s.onSnap?.(m); }
    });
    ws.on('close', (code, reason) => { s.closed = { code, reason: reason.toString() }; });
    ws.on('error', () => {});
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name, team, cls })); resolve(s); });
  });
}

const res = { url: URL0, map: MAP, room: ROOM, seconds: SECONDS, snapshots: 0, violations: [], ballStates: {}, carriesSeen: 0, captures: 0, nonFinite: 0, kicked: {} };
const obs = await open(Q, 'Observer', 1, 'overwatch', 'raw');
await sleep(1500);
if (!obs.welcome) { console.log(JSON.stringify({ error: 'no welcome', closed: obs.closed })); process.exit(1); }
// the ball seed: the prop entities with cls -1 whose weapon is a BallState; learn it from the first snapshot (3 props per
// team: ball, stand, ring; the ball is the one that moves / carries weapon ∈ {0,1,2} and sits 1.08 m over its stand)
let ballSeed = Number.isFinite(BALL_SEED) ? BALL_SEED : null;
let lastCarrier = [-1, -1], lastScore = [0, 0];
let fPrev = null;
let forgerRef = null;
obs.onSnap = (m) => {
  res.snapshots++;
  const ents = (m.ents ?? []).map(unpack);
  for (const e of ents) if (![e.x, e.y, e.z, e.vx, e.vy, e.vz, e.yaw, e.hp].every(Number.isFinite)) res.nonFinite++;
  const props = ents.filter((e) => e.kind === KIND_PROP && e.cls === -1);
  if (ballSeed === null) {
    // group by seed: the ball seed is the one whose two props (one per team) sit highest above ground at home
    const bySeed = new Map();
    for (const p of props) (bySeed.get(p.seed) ?? bySeed.set(p.seed, []).get(p.seed)).push(p);
    let best = null;
    for (const [seed, ps] of bySeed) if (ps.length === 2 && ps.every((p) => [0, 1, 2].includes(p.weapon))) { const y = ps.reduce((a, p) => a + p.y, 0); if (!best || y > best.y) best = { seed, y }; }
    if (best) ballSeed = best.seed;
  }
  if (ballSeed === null) return;
  const balls = props.filter((p) => p.seed === ballSeed);
  const bad = [];
  for (const t of [0, 1]) if (balls.filter((b) => b.team === t).length !== 1) bad.push(`team ${t}: ${balls.filter((b) => b.team === t).length} balls`);
  const carriers = new Set();
  for (const b of balls) {
    res.ballStates[b.weapon] = (res.ballStates[b.weapon] ?? 0) + 1;
    if (b.weapon === 1) {
      const c = ents.find((e) => e.id === b.ammo);
      if (!c) bad.push(`ball ${b.team} carried by ${b.ammo}, not in the snapshot`);
      else {
        if (!(c.flags & CARRIER)) bad.push(`carrier ${c.id} without the Carrier flag`);
        if (c.flags & DEAD) bad.push(`carrier ${c.id} dead`);
        if (c.team === b.team) bad.push(`ball ${b.team} carried by its own team`);
      }
      if (carriers.has(b.ammo)) bad.push(`${b.ammo} carries two balls`);
      carriers.add(b.ammo);
      if (lastCarrier[b.team] !== b.ammo) res.carriesSeen++;
      lastCarrier[b.team] = b.ammo;
    } else lastCarrier[b.team] = -1;
  }
  for (const e of ents) if ((e.flags & CARRIER) && !carriers.has(e.id)) bad.push(`${e.id} wears Carrier with no ball`);
  if (m.match?.score) { const s = m.match.score; if (s[0] + s[1] > lastScore[0] + lastScore[1]) res.captures += s[0] + s[1] - lastScore[0] - lastScore[1]; lastScore = [...s]; }
  if (res.forger && res.forger.entity === null && forgerRef?.welcome) res.forger.entity = forgerRef.welcome.entity;
  const fe = ents.find((e) => e.id === res.forger?.entity);
  if (fe && !(fe.flags & DEAD)) {
    res.forger.maxY = Math.max(res.forger.maxY, fe.y);
    if (fPrev) res.forger.maxStep = Math.max(res.forger.maxStep, Math.hypot(fe.x - fPrev.x, fe.z - fPrev.z));
    if (fe.hp > fe.maxHp) res.forger.hpOver++;
    fPrev = fe;
  } else fPrev = null;
  if (bad.length && res.violations.length < 10) res.violations.push(`tick ${m.tick}: ${bad.join('; ')}`);
};

const hostile = [];
const spam = await open(Q, 'Spammer', 0, 'skyraider');
const evil = await open(Q, 'Evil', 1, 'breacher');
const sw = await open(Q, 'Switcher', 0, 'infiltrator');
const jumper = await open(Q, 'Jumper', 1, 'assault');
const rogue = await open(Q, 'Rogue', 0, 'assault');
const forger = await open(Q, 'Forger', 0, 'assault');
hostile.push(spam, evil, sw, jumper, rogue, forger);
forgerRef = forger;
let seqF = 0;
res.forger = { entity: forger.welcome?.entity ?? null, maxY: -1e9, maxStep: 0, hpOver: 0, flagCarrierNoBall: 0 };
let seqJ = 0, seqO = 0, seqO2 = 0;
let stormConns = 0, storm = await open(Q, 'Storm', 1, 'assault');
let seqS = 0, seqE = 0, seqW = 0, i = 0;
const t0 = Date.now();
const evilNums = [NaN, Infinity, -Infinity, 1e308, -1e308, 1e9, -0];
while (Date.now() - t0 < SECONDS * 1000) {
  i++;
  // spammer: every bit toggled, 3 inputs per frame, and a far-ahead seq now and then
  if (spam.ws.readyState === 1) {
    const cmds = [];
    for (let k = 0; k < 3; k++) cmds.push({ seq: ++seqS, mx: (i % 3) - 1, mz: 1, yaw: (i % 628) / 100, pitch: 0.2, buttons: i % 2 ? 0xfff : 0x800 | 0x10, rt: 0 });
    spam.ws.send(JSON.stringify({ t: 'input', cmds }));
  }
  // evil: non-finite / huge numbers, forged fields, unknown messages
  if (evil.ws.readyState === 1) {
    const v = evilNums[i % evilNums.length];
    evil.ws.send(JSON.stringify({ t: 'input', cmds: [{ seq: ++seqE, mx: v, mz: v, yaw: v, pitch: v, buttons: 0x800, rt: v, x: 0, y: 50, z: 0, hp: 9999, team: 0, flags: CARRIER }] }).replace(/null/g, i % 2 ? '1e999' : 'null'));
    if (i % 15 === 0) evil.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'Evil2', team: 0, cls: 'warden' }));
  }
  // jumper: honest for 10 s, then a far-ahead seq jump; rogue: an unknown message type at 20 s
  if (jumper.ws.readyState === 1) jumper.ws.send(JSON.stringify({ t: 'input', cmds: [{ seq: i === 600 ? (seqJ += 1e6) : ++seqJ, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }] }));
  if (rogue.ws.readyState === 1) { rogue.ws.send(JSON.stringify({ t: 'input', cmds: [{ seq: ++seqO2, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }] })); if (i === 1200) rogue.ws.send(JSON.stringify({ t: 'score', team: 0, pts: 3 })); }
  // forger: valid numbers with forged fields (position, hp, team, flags, a carrier id) on every input
  if (forger.ws.readyState === 1) forger.ws.send(JSON.stringify({ t: 'input', cmds: [{ seq: ++seqF, mx: 0, mz: 1, yaw: 1, pitch: 0, buttons: 2, rt: 0, x: 26.6, y: 60, z: 68.8, hp: 9999, maxHp: 9999, team: 1, flags: CARRIER, ammo: 1, weapon: 1, entity: 1, id: 1 }] }));
  // the observer stays connected (idle timeout): a still input each frame
  if (obs.ws.readyState === 1) obs.ws.send(JSON.stringify({ t: 'input', cmds: [{ seq: ++seqO, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }] }));
  // switcher: team and class every ~50 ms, moving
  if (sw.ws.readyState === 1) {
    sw.ws.send(JSON.stringify({ t: 'input', cmds: [{ seq: ++seqW, mx: 0, mz: 1, yaw: (i % 314) / 50, pitch: 0, buttons: 2, rt: 0 }] }));
    if (i % 3 === 0) sw.ws.send(JSON.stringify({ t: 'team', team: (i / 3) % 2 ? 1 : 0 }));
    if (i % 3 === 1) sw.ws.send(JSON.stringify({ t: 'class', cls: ['assault', 'skyraider', 'warden', 'breacher'][i % 4] }));
  }
  // storm: reconnect every second
  if (i % 60 === 0) { storm.ws.close(); storm = await open(Q, 'Storm', stormConns % 2, 'assault'); stormConns++; }
  await sleep(16);
}
for (const h of [...hostile, storm]) if (h.closed) res.kicked[h.name] = h.closed;
res.observerClosed = obs.closed;
res.stormReconnects = stormConns;
const health = await (await fetch(`${HTTP}/health`)).json().catch((e) => ({ err: String(e) }));
const rooms = await (await fetch(`${HTTP}/rooms`)).json().catch((e) => ({ err: String(e) }));
res.health = health;
res.room = Array.isArray(rooms) ? rooms.find((r) => r.name === ROOM) : rooms;
res.ballSeed = ballSeed;
for (const h of [...hostile, storm, obs]) try { h.ws.close(); } catch { /* */ }
console.log(JSON.stringify(res));
process.exit(res.violations.length || res.nonFinite || !health?.ok ? 1 : 0);
