#!/usr/bin/env node
// Q2 verification: online co-op adventure over the production server (read-only probe).
//   npm run build && npm run precompress && npm run build:server
//   PORT=8791 STATIC_DIR=dist node dist-server/prod.js      then      node tools/qa-w4online.mjs [--base http://127.0.0.1:8791]
// Two headless Chromium clients join ?room=q2&mode=adventure&chapter=yard_day. Checks: both reach the chapter (HUD),
// both are corgis and see each other, GET /rooms lists { mode: 'adventure', chapter: 'yard_day', humans: 2 },
// the JS the browser downloaded came with Content-Encoding: br, and no page/console errors.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://127.0.0.1:8791';
const ROOM = argv.includes('--room') ? argv[argv.indexOf('--room') + 1] : 'q2';
const OUT = 'artifacts/q2';
mkdirSync(OUT, { recursive: true });
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const T0 = Date.now();
const say = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const log = { base: BASE, pages: {}, rooms: [] };
async function client(name) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } }); // small while loading: two SwiftShader pages share 4 cores
  const L = { errors: [], console: [], js: [] };
  page.on('pageerror', (e) => L.errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') L.console.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('response', async (r) => { if (r.url().endsWith('.js')) L.js.push({ url: r.url().split('/').pop(), enc: (await r.allHeaders())['content-encoding'] ?? null, status: r.status() }); });
  await page.goto(`${BASE}/?webgl&quality=low&room=${ROOM}&mode=adventure&chapter=yard_day&name=${name}&cls=assault`);
  log.pages[name] = L;
  return { page, L };
}
const A = await client('Alpha');
await A.page.waitForFunction(() => globalThis.__cvc?.ready === true, null, { timeout: 180000, polling: 500 });
say('A ready');
const B = await client('Bravo');
await B.page.waitForFunction(() => globalThis.__cvc?.ready === true, null, { timeout: 180000, polling: 500 });
say('B ready');
const state = (p) => p.evaluate(() => {
  const c = globalThis.__cvc, n = c.net ?? {};
  return { transport: c.transport, local: c.localEntity, ents: (n.entities ?? []).filter((e) => e[1] === 0).map((e) => e[0]), rtt: n.rttMs, predErr: n.predErrCm, corrections: n.corrections,
    timer: document.querySelector('.mb-timer')?.textContent, obj: document.querySelector('.mb-obj')?.textContent, card: document.querySelector('#ui')?.innerText.match(/CH \d · [A-Z ]+/)?.[0] ?? null,
    teamOk: !!document.querySelector('.hp.t0') };
});
for (let i = 0; i < 40; i++) {
  const [a, b] = [await state(A.page), await state(B.page)];
  if (/STEP|WARMUP/.test(a.timer ?? '') && /STEP|WARMUP/.test(b.timer ?? '') && a.ents.includes(b.local) && b.ents.includes(a.local)) break;
  await A.page.waitForTimeout(1500);
}
const rooms = await (await fetch(`${BASE}/rooms`)).json();
log.disconnected = await Promise.all([A, B].map((P) => P.page.evaluate(() => /Disconnected/i.test(document.body.innerText))));
log.rooms = rooms;
const [sa, sb] = [await state(A.page), await state(B.page)];
log.a = sa; log.b = sb;
for (const P of [A, B]) await P.page.setViewportSize({ width: 1280, height: 720 });
await A.page.waitForTimeout(3000);
await A.page.screenshot({ path: `${OUT}/online-a.png` });
await B.page.screenshot({ path: `${OUT}/online-b.png` });
// A skips the briefing (E) so both go live; then move A forward a little and check B sees it move
await A.page.keyboard.press('KeyE'); await B.page.keyboard.press('KeyE');
await A.page.waitForFunction(() => /STEP 1/.test(document.querySelector('.mb-timer')?.textContent ?? ''), null, { timeout: 120000, polling: 500 }).catch(() => {});
const posOf = (p, id) => p.evaluate((id) => (globalThis.__cvc.net?.entities ?? []).find((e) => e[0] === id)?.slice(2) ?? null, id);
const b0 = await posOf(B.page, sa.local);
await A.page.keyboard.down('KeyW'); await A.page.waitForTimeout(6000); await A.page.keyboard.up('KeyW');
await B.page.waitForTimeout(2000);
const b1 = await posOf(B.page, sa.local);
log.bSeesAMove = b0 && b1 ? +Math.hypot(b1[0] - b0[0], b1[2] - b0[2]).toFixed(2) : null;
log.aLive = await state(A.page); log.bLive = await state(B.page);
await A.page.screenshot({ path: `${OUT}/online-a-live.png` });
await B.page.screenshot({ path: `${OUT}/online-b-live.png` });
const r = rooms.find((x) => x.name === ROOM);
const checks = [
  ['neither client disconnected', !log.disconnected.some(Boolean), JSON.stringify(log.disconnected)],
  ['both clients online (websocket transport)', sa.transport === 'ws' && sb.transport === 'ws', `${sa.transport}/${sb.transport}`],
  ['both show chapter 1 (mission card) and the adventure bar', /YARD DAY/.test(sa.card ?? '') && /YARD DAY/.test(sb.card ?? ''), `A "${sa.card}" ${sa.timer} · B "${sb.card}" ${sb.timer}`],
  ['each sees the other player entity', sa.ents.includes(sb.local) && sb.ents.includes(sa.local), `A local ${sa.local} sees ${sa.ents} · B local ${sb.local} sees ${sb.ents}`],
  ['/rooms lists mode adventure, chapter yard_day, 2 humans', r?.mode === 'adventure' && r?.chapter === 'yard_day' && r?.humans === 2, JSON.stringify(r ?? null)],
  ['B sees A move after A walks', (log.bSeesAMove ?? 0) > 1, `${log.bSeesAMove} m`],
  ['JS served with Content-Encoding: br', Object.values(log.pages).every((L) => L.js.length && L.js.every((j) => j.enc === 'br')), JSON.stringify(log.pages.Alpha.js)],
  ['no page errors', Object.values(log.pages).every((L) => !L.errors.length), JSON.stringify(Object.fromEntries(Object.entries(log.pages).map(([k, L]) => [k, L.errors])))],
];
for (const [n, ok, d] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} — ${d}`);
console.log('console:', JSON.stringify(Object.fromEntries(Object.entries(log.pages).map(([k, L]) => [k, L.console.slice(0, 5)]))));
writeFileSync(`${OUT}/online.json`, JSON.stringify(log, null, 1));
await browser.close();
