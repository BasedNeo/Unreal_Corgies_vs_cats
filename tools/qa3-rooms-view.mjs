#!/usr/bin/env node
// Q3 copy of tools/qa-rooms-view.mjs (port 8793, artifacts/q3; adds an unknown chapter and a boss room). Q2 verification (read-only): the menu's room browser lists adventure rooms with their chapter. Holds two adventure
// rooms open with Node WebSocket clients (laser_dawn, and a bogus-but-well-formed chapter id), then opens the menu from
// the production server (?offline keeps the page on the menu) and the ROOMS view.
//   PORT=8793 STATIC_DIR=dist node dist-server/prod.js   then   npx tsx tools/qa-rooms-view.mjs
import WebSocket from 'ws';
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { PROTOCOL_VERSION } from '../src/shared/constants';
const BASE = 'http://127.0.0.1:8793';
const hold = (q) => new Promise((res) => { const ws = new WebSocket(`ws://127.0.0.1:8793/ws${q}`); ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'Holder', team: 0, cls: 'assault' })); const iv = setInterval(() => ws.send(JSON.stringify({ t: 'ping', id: 1, ct: 0 })), 1000); res({ ws, iv }); }); });
const a = await hold('?room=q3-dawn&mode=adventure&chapter=laser_dawn');
const b = await hold('?room=q3-bogus&mode=adventure&chapter=buy_gold_at_example');
const c = await hold('?room=q3-final&mode=adventure&chapter=last_ball');
const d = await hold('?room=q3-boss&mode=boss-rush&boss=madame_pointille');
const e = await hold('?room=q3-tdm&mode=team-deathmatch&chapter=laser_dawn&boss=madame_pointille');
await new Promise((r) => setTimeout(r, 1500));
console.log('/rooms', JSON.stringify(await (await fetch(`${BASE}/rooms`)).json()));
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${BASE}/?offline&webgl&quality=low`);
await page.locator('[data-rooms]').waitFor({ timeout: 120000 });
await page.locator('[data-server]').fill('ws://127.0.0.1:8793/ws');
await page.locator('[data-server]').dispatchEvent('change');
await page.locator('[data-rooms]').click();
await page.waitForFunction(() => /q3-dawn/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'artifacts/q3/rooms-browser.png' });
console.log('rows:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.rb-mode')].map((e) => e.parentElement?.parentElement?.innerText.replace(/\s+/g, ' ').slice(0, 140)))));
await browser.close();
for (const h of [a, b, c, d, e]) { clearInterval(h.iv); h.ws.close(); }
process.exit(0);
