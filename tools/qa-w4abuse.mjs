#!/usr/bin/env node
// Q2 verification: Wave 4 room-setup abuse against a running authority (read-only probe).
//   PORT=8791 STATIC_DIR=dist node dist-server/prod.js      (in another shell)
//   npx tsx tools/qa-w4abuse.mjs --url ws://127.0.0.1:8791/ws --http http://127.0.0.1:8791
// Hostile ?mode= / ?chapter= / ?boss= room setups, hello payload extras, the adventure corgi-team rule, the /rooms
// listing of what a room really runs, HTTP rate limits on /rooms, and the no-hello timeout (4001, ≤ 10 s + one sweep).
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../src/shared/constants';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const URL0 = opt('url', 'ws://127.0.0.1:8791/ws'), HTTP = opt('http', 'http://127.0.0.1:8791');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };
const rooms = async () => (await fetch(`${HTTP}/rooms`)).json();

function open(query) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${URL0}${query}`);
    const s = { ws, welcome: null, roster: null, closed: null, objective: null, snaps: 0 };
    ws.on('message', (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch { return; }
      if (m.t === 'welcome') s.welcome = m;
      if (m.t === 'roster') s.roster = m.players;
      if (m.t === 'snap') { s.snaps++; if (m.match) s.objective = m.match.objective ?? s.objective; if (m.m) s.objective = m.m.objective ?? s.objective; s.last = m; }
    });
    ws.on('close', (code, reason) => { s.closed = { code, reason: reason.toString() }; });
    ws.on('error', () => {});
    ws.on('open', () => resolve(s));
    ws.on('unexpected-response', (_q, res) => { s.closed = { code: res.statusCode }; resolve(s); });
    setTimeout(() => reject(new Error('open timeout')), 10000);
  });
}
const join = async (query, hello = {}) => {
  const s = await open(query);
  s.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'Q2', team: 0, cls: 'assault', ...hello }));
  const t = Date.now(); while (!s.welcome && !s.closed && Date.now() - t < 20000) await sleep(20);
  const t2 = Date.now(); while (!s.roster && Date.now() - t2 < 3000) await sleep(20);
  return s;
};
const listed = async (name) => (await rooms()).find((r) => r.name === name);

const cases = [
  { room: 'q2m1', q: 'mode=%3Cscript%3E', want: (r) => r?.mode === 'yard-skirmish' && !r.chapter, what: 'unknown mode → server default, no chapter' },
  { room: 'q2m2', q: 'mode=adventure&chapter=..%2F..%2Fetc', want: (r) => r?.mode === 'adventure' && !r.chapter, what: 'path-like chapter dropped' },
  { room: 'q2m3', q: `mode=adventure&chapter=${'x'.repeat(200)}`, want: (r) => r?.mode === 'adventure' && !r.chapter, what: '200-char chapter dropped' },
  { room: 'q2m4', q: 'mode=adventure&chapter=nonexistent', want: (r) => r?.mode === 'adventure' && (!r.chapter || r.chapter === 'yard_day'), what: 'unknown (well-formed) chapter: listing should match what runs' },
  { room: 'q2m5', q: 'mode=boss-rush&boss=..%2Fx', want: (r) => r?.mode === 'boss-rush', what: 'path-like boss dropped' },
  { room: 'q2m6', q: 'mode=team-deathmatch&chapter=yard_day&boss=vac_tank', want: (r) => r?.mode === 'team-deathmatch' && !r.chapter, what: 'chapter/boss ignored outside their modes' },
];
for (const c of cases) {
  const s = await join(`?room=${c.room}&${c.q}`);
  await sleep(600);
  const r = await listed(c.room);
  rec(c.what, !!s.welcome && c.want(r), `welcome.mode ${s.welcome?.mode} · /rooms ${JSON.stringify(r ?? null)} · objective "${s.objective ?? ''}"`);
  s.ws.close();
}

{ // the first joiner decides; hello extras ignored; the adventure squad is all corgis
  const a = await join('?room=q2adv&mode=adventure&chapter=tall_grass', { team: 1, cls: 'overwatch', mode: 'team-deathmatch', chapter: 'last_ball', boss: 'x', admin: true });
  const b = await join('?room=q2adv&mode=team-deathmatch&chapter=last_ball', { team: 1 });
  await sleep(600);
  const r = await listed('q2adv');
  const teams = (b.roster ?? a.roster ?? []).filter((p) => !p.bot).map((p) => p.team);
  rec('adventure room: first joiner decides, hello extras ignored, humans forced to corgis', r?.mode === 'adventure' && r?.chapter === 'tall_grass' && teams.length === 2 && teams.every((t) => t === 0),
    `/rooms ${JSON.stringify(r)} · human teams ${JSON.stringify(teams)} · welcome modes ${a.welcome?.mode}/${b.welcome?.mode}`);
  a.ws.close(); b.ws.close();
}

{ // /rooms HTTP rate limit
  const codes = {};
  await Promise.all(Array.from({ length: 60 }, async () => { const r = await fetch(`${HTTP}/rooms`); codes[r.status] = (codes[r.status] ?? 0) + 1; }));
  rec('/rooms is rate limited (burst 20, 5/s)', (codes[429] ?? 0) > 0, JSON.stringify(codes));
}

{ // no hello: kicked with 4001 within helloTimeout (10 s) + one sweep (≤ 5 s)
  await sleep(4500);
  const s = await open('?room=q2idle');
  const t = Date.now(); while (!s.closed && Date.now() - t < 17000) await sleep(50);
  rec('a connection that never says hello is closed (4001)', s.closed?.code === 4001, `closed ${JSON.stringify(s.closed)} after ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
const h = await (await fetch(`${HTTP}/health`)).json();
rec('server healthy at the end', h.ok === true, JSON.stringify(h));
console.log(`\nW4 ABUSE: ${results.filter((r) => r.pass).length}/${results.length} pass`);
process.exit(0);
