#!/usr/bin/env node
// Q2 verification (read-only): the real HUD module's kill feed shows kart/plane glyphs for kills made from a seat, and a
// weapon glyph on foot (synthetic states + death events through createHud). Needs the Vite dev server (TS modules).
//   npx vite --port 5191 --strictPort   then   node tools/qa-killfeed.mjs
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.route('**/qa-kf', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:#5d8f4e"><div id="ui" style="position:absolute;inset:0"></div></body></html>' }));
await page.goto('http://127.0.0.1:5191/qa-kf');
const res = await page.evaluate(async () => {
  const { createHud } = await import('/src/client/ui/hud.ts');
  const { WEAPON_GLYPHS } = await import('/src/client/ui/icons.ts');
  const { EntityKind, EFlag } = await import('/src/shared/types.ts');
  const { vehicleIndex } = await import('/src/shared/content/vehicles.ts');
  const ui = document.getElementById('ui');
  const hud = createHud(ui, {}, { match: 'team-deathmatch' });
  const st = (o) => ({ id: 0, kind: EntityKind.Player, team: 0, species: 0, cls: 0, seed: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 100, maxHp: 100, anim: 0, flags: EFlag.Grounded, weapon: 0, ammo: 0, ...o });
  const states = new Map([
    [1, st({ id: 1, flags: EFlag.Mounted })], [2, st({ id: 2, flags: EFlag.Mounted })], [3, st({ id: 3 })],
    [7, st({ id: 7, team: 1 })], [8, st({ id: 8, team: 1 })], [9, st({ id: 9, team: 1 })],
    [20, st({ id: 20, kind: EntityKind.Vehicle, cls: vehicleIndex('rc_plane'), weapon: 1 })], [21, st({ id: 21, kind: EntityKind.Vehicle, cls: -1, weapon: 2 })],
  ]);
  const roster = [1, 2, 3, 7, 8, 9].map((id) => ({ pid: `p${id}`, name: ['', 'Pilot', 'Driver', 'Walker', '', '', '', 'Cat A', 'Cat B', 'Cat C'][id], team: id < 5 ? 0 : 1, cls: 'assault', entity: id, bot: false, kills: 0, deaths: 0, score: 0, ping: 0 }));
  const match = { mode: 'team-deathmatch', phase: 'live', timeLeft: 300, score: [0, 0], objective: 'x', wave: 0, winner: -1 };
  const model = { local: states.get(3), match, roster, fps: 60, rttMs: 20, locked: true, backend: 'webgl', transport: 'worker', states };
  hud.update(model);
  hud.onGameEvent({ e: 'fire', id: 3, wpn: 0, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, hx: 0, hy: 0, hz: 0, hit: 9 });
  hud.onGameEvent({ e: 'death', id: 7, by: 1 });
  hud.onGameEvent({ e: 'death', id: 8, by: 2 });
  hud.onGameEvent({ e: 'death', id: 9, by: 3 });
  for (let i = 0; i < 5; i++) hud.update(model);
  const kf = ui.querySelector('.kf');
  const html = kf?.innerHTML ?? '';
  return { text: kf?.innerText.replace(/\s+/g, ' '), plane: html.includes(WEAPON_GLYPHS.plane.slice(0, 60)), kart: html.includes(WEAPON_GLYPHS.kart.slice(0, 60)), rows: kf?.children.length };
});
await page.waitForTimeout(600);
await page.locator('.kf').screenshot({ path: 'artifacts/q2/killfeed.png' }).catch(() => page.screenshot({ path: 'artifacts/q2/killfeed.png' }));
console.log(JSON.stringify(res), 'errors', errs);
await browser.close();
