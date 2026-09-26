#!/usr/bin/env node
// Q1 verification: server abuse sanity (read-only probe against a running authority).
//   PORT=8797 npx tsx server/index.ts            (in another shell)
//   npx tsx tools/qa-abuse.mjs --url ws://localhost:8797 [--http http://localhost:8797]
// Part A (network): malformed JSON, oversize frames, binary, pre-hello traffic, message floods, spoofed/forged fields,
//   non-finite numbers, far-ahead seq — each must be refused/kicked while the server stays healthy.
// Part B (network): room-creation pressure from ONE IP (rooms are created on demand from ?room=, and persist
//   ROOM_TTL_MS after their last client leaves): can one IP fill MAX_ROOMS and stall a victim's snapshots?
// Part C (in-process Room, no network): input-rate "catch-up" speed exploit — a client that sends 2 inputs per
//   tick vs an honest client at 1 per tick; distance run in 10 s on the West Yard lawn.
import WebSocket from 'ws';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const URL0 = opt('url', 'ws://localhost:8797');
const HTTP = opt('http', URL0.replace(/^ws/, 'http'));
const results = [];
const rec = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const health = async () => { try { const r = await fetch(`${HTTP}/health`); return r.ok ? await r.json() : { ok: false, status: r.status }; } catch (e) { return { ok: false, err: String(e) }; } };
const stats = async (reset = false) => (await fetch(`${HTTP}/stats${reset ? '?reset=1' : ''}`)).json();
const hello = (extra = {}) => JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'QA', team: 0, cls: 'assault', ...extra });

/** Open a socket; resolves with helpers once open. Records close code/reason and received messages. */
function open(query = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${URL0}${query}`);
    const s = { ws, msgs: [], closed: null, snaps: [], welcome: null, roster: null };
    ws.on('message', (d) => {
      const txt = d.toString();
      let m; try { m = JSON.parse(txt); } catch { return; }
      s.msgs.push(m.t);
      if (m.t === 'welcome') s.welcome = m;
      if (m.t === 'roster') s.roster = m.players;
      if (m.t === 'snap') s.snaps.push({ at: performance.now(), tick: m.tick, you: m.you, ents: m.ents });
      if (s.snaps.length > 4000) s.snaps.splice(0, 2000);
    });
    ws.on('close', (code, reason) => { s.closed = { code, reason: reason.toString() }; });
    ws.on('error', () => {});
    ws.on('open', () => resolve(s));
    ws.on('unexpected-response', (_req, res) => { s.closed = { code: res.statusCode, reason: 'http ' + res.statusCode }; resolve(s); });
    setTimeout(() => reject(new Error('open timeout')), 10000);
  });
}
const waitClose = async (s, ms = 5000) => { const t = Date.now(); while (!s.closed && Date.now() - t < ms) await sleep(20); return s.closed; };
const waitWelcome = async (s, ms = 20000) => { const t = Date.now(); while (!s.welcome && !s.closed && Date.now() - t < ms) await sleep(20); return s.welcome; };

// ------------------------------------------------------------------------------------------------ Part A
async function partA() {
  const h0 = await health();
  rec('server healthy before abuse', h0.ok === true, JSON.stringify(h0));

  { // malformed JSON
    const s = await open('?room=qa-a1'); let n = 0;
    while (!s.closed && n < 200) { s.ws.send('{"t":"input",'); n++; await sleep(5); }
    const c = await waitClose(s);
    rec('malformed JSON frames → kicked (1008)', c?.code === 1008, `closed ${JSON.stringify(c)} after ${n} frames`);
  }
  { // oversize: > 8 KB parse limit but < 16 KB ws maxPayload, then > maxPayload
    const s = await open('?room=qa-a2');
    s.ws.send(hello()); await waitWelcome(s);
    s.ws.send(JSON.stringify({ t: 'chat', text: 'x'.repeat(12 * 1024) }));
    await sleep(300);
    const alive = !s.closed;
    s.ws.send('x'.repeat(40 * 1024));
    const c = await waitClose(s);
    rec('12 KB frame refused (strike), 40 KB frame → ws close 1009', alive && c?.code === 1009, `after 12 KB alive=${alive}; 40 KB → ${JSON.stringify(c)}`);
  }
  { // binary + pre-hello chatter
    const s = await open('?room=qa-a3'); let n = 0;
    while (!s.closed && n < 100) { s.ws.send(n % 2 ? Buffer.from([1, 2, 3]) : JSON.stringify({ t: 'input', cmds: [{ seq: 1, mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: 0, rt: 0 }] })); n++; await sleep(5); }
    const c = await waitClose(s);
    rec('binary frames + input before hello → kicked (1008)', c?.code === 1008, `closed ${JSON.stringify(c)} after ${n} frames`);
  }
  { // message flood after hello
    const s = await open('?room=qa-a4'); s.ws.send(hello()); await waitWelcome(s);
    let n = 0; const t0 = Date.now();
    while (!s.closed && n < 20000) { s.ws.send(JSON.stringify({ t: 'ping', id: n, ct: 0 })); n++; if (n % 200 === 0) await sleep(1); }
    const c = await waitClose(s);
    rec('ping flood → rate-limited then kicked (1008)', c?.code === 1008, `closed ${JSON.stringify(c)} after ${n} msgs in ${Date.now() - t0} ms`);
  }
  { // forged/spoofed fields, non-finite numbers, far-ahead seq, class/team spam
    const s = await open('?room=qa-a5&enc=raw');
    s.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: '<img src=x onerror=alert(1)>‮GOD\u0000', team: 7, cls: 'god', hp: 9999, entity: 1 }));
    await waitWelcome(s);
    const me = s.welcome?.entity;
    await sleep(300);
    const myRow = s.roster?.find((p) => p.entity === me);
    rec('hello: hostile name sanitized, bad team/cls defaulted', !!myRow && !/[<>‮\u0000]/.test(myRow.name) && (myRow.team === 0 || myRow.team === 1) && myRow.cls === 'assault', `roster row ${JSON.stringify(myRow)}`);
    // forged input fields: try to move another entity / set hp; mx out of range
    let seq = 1;
    for (let i = 0; i < 60; i++) { s.ws.send(JSON.stringify({ t: 'input', cmds: [{ seq: seq++, mx: 50, mz: 50, yaw: 0, pitch: 99, buttons: 0xffff, rt: 1e12, id: 1, entity: 1, hp: 9999 }] })); await sleep(16); }
    await sleep(400);
    const last = s.snaps[s.snaps.length - 1];
    const meRow = last?.ents.find((e) => e[0] === me);
    const speed = meRow ? Math.hypot(meRow[11], meRow[13]) : -1;
    rec('forged input fields ignored; mx/mz 50 clamped (speed ≤ sprint 9.6)', !s.closed && speed >= 0 && speed <= 9.61 && meRow[14] <= 120, `me hp ${meRow?.[14]} speed ${speed.toFixed(2)} m/s, closed=${JSON.stringify(s.closed)}`);
    s.ws.send('{"t":"input","cmds":[{"seq":1e999,"mx":0,"mz":0,"yaw":0,"pitch":0,"buttons":0,"rt":0}]}');
    s.ws.send(JSON.stringify({ t: 'input', cmds: [{ seq: seq + 5000, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }] }));
    for (let i = 0; i < 30; i++) { s.ws.send(JSON.stringify({ t: i % 2 ? 'class' : 'team', cls: 'overwatch', team: i % 2 })); }
    await sleep(500);
    const h = await health();
    rec('Infinity seq / far-ahead seq / class+team spam survive (no crash)', h.ok === true, `health ${JSON.stringify(h)}, socket ${s.closed ? 'closed ' + JSON.stringify(s.closed) : 'open'}`);
    s.ws.close();
  }
  { // idle before hello — should time out (4001) after HELLO_TIMEOUT_MS; skip wait if long
    const s = await open('?room=qa-a6');
    const c = await waitClose(s, 12000);
    rec('connection that never says hello is closed (4001)', c?.code === 4001, `closed ${JSON.stringify(c)} (server HELLO_TIMEOUT_MS may be raised for this run)`);
  }
}

// ------------------------------------------------------------------------------------------------ Part B
async function partB() {
  const victim = await open('?room=victim&enc=raw');
  victim.ws.send(hello()); await waitWelcome(victim);
  const vping = setInterval(() => { if (!victim.closed) victim.ws.send(JSON.stringify({ t: 'ping', id: 1, ct: 0 })); }, 1000);
  await sleep(3000);
  await stats(true);
  const gapStats = (from, to) => { const a = victim.snaps.filter((x) => x.at >= from && x.at <= to).map((x) => x.at); let max = 0; for (let i = 1; i < a.length; i++) max = Math.max(max, a[i] - a[i - 1]); return { snaps: a.length, maxGapMs: Math.round(max) }; };
  const t0 = performance.now(); await sleep(3000); const base = gapStats(t0, performance.now());
  // wave 1: 15 more sockets from this IP (per-IP cap 16), each creating a new room
  const w1 = [];
  const t1 = performance.now();
  for (let i = 0; i < 15; i++) { const s = await open(`?room=spam${i}`).catch(() => null); if (s) { s.ws.send(hello()); w1.push(s); } }
  await Promise.all(w1.map((s) => waitWelcome(s, 30000)));
  await sleep(2000);
  const during1 = gapStats(t1, performance.now());
  const st1 = await stats();
  const roomsAfter1 = st1.rooms.length;
  // close them: rooms stay alive for ROOM_TTL_MS; open 16 more with new names
  for (const s of w1) s.ws.close();
  await sleep(500);
  const w2 = []; let refused = 0;
  const t2 = performance.now();
  for (let i = 0; i < 16; i++) { const s = await open(`?room=spamB${i}`).catch(() => null); if (!s) continue; if (s.closed) { refused++; continue; } s.ws.send(hello()); w2.push(s); }
  await Promise.all(w2.map((s) => waitWelcome(s, 30000)));
  await sleep(1500);
  const full = w2.filter((s) => s.closed && /full|no free rooms/i.test(s.closed.reason ?? '')).length;
  const st2 = await stats();
  const during2 = gapStats(t2, performance.now());
  // a legit newcomer from the same IP (other IPs would behave the same once rooms are full)
  for (const s of w2) if (!s.closed) { /* keep them */ }
  const tickMax = Math.max(...st2.rooms.map((r) => r.tickMsMax)), overruns = st2.rooms.reduce((a, r) => a + r.overruns, 0);
  rec('one IP can create rooms on demand (no per-IP room cap)', roomsAfter1 < 16, `rooms after 15 sockets: ${roomsAfter1}; after churn + 16 more: ${st2.rooms.length} (MAX_ROOMS 32), refused at upgrade ${refused}, rejected 'server full' ${full}`);
  rec('victim snapshots stay smooth while rooms are created (max gap < 150 ms)', during1.maxGapMs < 150 && during2.maxGapMs < 150, `baseline ${JSON.stringify(base)} · during wave 1 ${JSON.stringify(during1)} · during wave 2 ${JSON.stringify(during2)} · server tickMsMax ${tickMax} overruns ${overruns} memoryMB ${st2.memoryMB}`);
  clearInterval(vping);
  for (const s of [...w2, victim]) try { s.ws.close(); } catch {}
  await sleep(300);
}

// ------------------------------------------------------------------------------------------------ Part C
async function partC() {
  const { Sim } = await import('../src/sim/sim');
  const { Room } = await import('../src/host/room');
  const { Btn } = await import('../src/shared/input');
  const run = async (perTick) => {
    const sim = await Sim.create({ seed: 1 });
    const room = new Room(sim, { mode: 'free', botsPerTeam: [0, 0] });
    const slot = room.join({ id: 'p', send() {} }, { t: 'hello', v: PROTOCOL_VERSION, name: 'P', team: 0, cls: 'assault' });
    const e = sim.entities.get(slot.entity);
    // open lawn leg found by tools/qa-feel.mjs: (-43, -17) yaw 0.785
    sim.placeCharacter(e, -43, sim.worldData.height(-43, -17) + 0.05, -17);
    const yaw = 0.7853981633974483;
    let seq = 0;
    for (let t = 0; t < 30; t++) { room.handle('p', { t: 'input', cmds: [{ seq: ++seq, mx: 0, mz: 0, yaw, pitch: 0, buttons: 0, rt: 0 }] }); room.tick(); }
    const x0 = e.pos.x, z0 = e.pos.z;
    for (let t = 0; t < 4 * TICK_HZ; t++) {
      const cmds = []; for (let k = 0; k < perTick; k++) cmds.push({ seq: ++seq, mx: 0, mz: 1, yaw, pitch: 0, buttons: Btn.Sprint, rt: 0 });
      room.handle('p', { t: 'input', cmds });
      room.tick();
    }
    const p = room.players.get('p');
    return { dist: Math.hypot(e.pos.x - x0, e.pos.z - z0), catchups: p.net.catchups, drops: p.net.drops };
  };
  const honest = await run(1), cheat = await run(2), cheat3 = await run(3);
  const gain = cheat.dist / honest.dist - 1;
  rec('input-rate speed exploit bounded (≤ 5 % over honest)', gain <= 0.05, `4 s sprint: honest ${honest.dist.toFixed(1)} m · 2 inputs/tick ${cheat.dist.toFixed(1)} m (+${(gain * 100).toFixed(0)} %, ${cheat.catchups} catch-up ticks, ${cheat.drops} drops) · 3/tick ${cheat3.dist.toFixed(1)} m (+${((cheat3.dist / honest.dist - 1) * 100).toFixed(0)} %)`);
}

const parts = opt('parts', 'A,B,C').split(',');
if (parts.includes('A')) await partA();
if (parts.includes('B')) await partB();
if (parts.includes('C')) await partC();
const h = await health().catch(() => ({ ok: false }));
rec('server still healthy at the end', h.ok === true, JSON.stringify(h));
console.log(`\nABUSE: ${results.filter((r) => r.pass).length}/${results.length} pass`);
process.exit(0);
