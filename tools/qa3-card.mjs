#!/usr/bin/env node
// Q3 verification (read-only): the finale's card after the lead's Q2 P2-6 fix, rendered by the REAL client module
// (src/client/adventure/hud.ts via the Vite dev server) from synthetic beacon snapshots, like Q2's tools/qa-card.mjs.
//   offline ch6: THE END!, MAIN MENU ▸ (+ REPLAY), ENTER = main menu, BACKSPACE = replay
//   offline ch5: CHAPTER COMPLETE!, NEXT CHAPTER enabled, ENTER = next
//   online ch6 (roomAdvances): a countdown back to chapter 1, no buttons
//   npx vite --port 5391 --strictPort   then   node tools/qa3-card.mjs [--base http://127.0.0.1:5391]
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://127.0.0.1:5391';
mkdirSync('artifacts/q3', { recursive: true });
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.route('**/qa3-card', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:#6a9b5a"><div id="ui" style="position:absolute;inset:0"></div></body></html>' }));
await page.goto(`${BASE}/qa3-card`);
const cases = [
  { chapter: 6, time: 212.4, par: 360, step: 5, name: 'finale-offline', online: false, key: 'Enter' },
  { chapter: 6, time: 212.4, par: 360, step: 5, name: 'finale-offline-backspace', online: false, key: 'Backspace' },
  { chapter: 5, time: 80.2, par: 160, step: 4, name: 'ch5-offline', online: false, key: 'Enter' },
  { chapter: 6, time: 212.4, par: 360, step: 5, name: 'finale-online', online: true, key: 'Enter' },
];
for (const c of cases) {
  const r = await page.evaluate(async (c) => {
    const { createAdventureHud } = await import('/src/client/adventure/index.ts');
    const { ADVENTURE_PHASES, ADVENTURE_CHAIN_INDEX } = await import('/src/shared/content/chapters.ts');
    const { EntityKind, EFlag } = await import('/src/shared/types.ts');
    const ui = document.getElementById('ui'); ui.innerHTML = '';
    window.__calls = [];
    window.__hud?.dispose?.();
    const hud = createAdventureHud(ui, { roomAdvances: c.online, onNext: (id) => window.__calls.push(['next', id]), onReplay: (id) => window.__calls.push(['replay', id]), onMenu: () => window.__calls.push(['menu']) });
    window.__hud = hud;
    const beacon = (phase, over = {}) => ({ id: 900, kind: EntityKind.Prop, team: 0, species: 0, cls: ADVENTURE_CHAIN_INDEX, seed: c.chapter, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 0, maxHp: 0, anim: ADVENTURE_PHASES.indexOf(phase), flags: 0, weapon: 0, ammo: 0, ...over });
    const me = { id: 5, kind: EntityKind.Player, team: 0, species: 0, cls: 0, seed: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 100, maxHp: 100, anim: 0, flags: EFlag.Grounded, weapon: 0, ammo: 0 };
    const live = new Map([[900, beacon('live', { weapon: c.step - 1 })], [5, me]]);
    const matchLive = { mode: 'adventure', phase: 'live', timeLeft: 0, score: [30, 0], objective: 'x', wave: c.step, winner: -1 };
    for (let i = 0; i < 20; i++) hud.update(live, matchLive, 5, 0.1);
    const done = new Map([[900, beacon('complete', { weapon: c.step, hp: c.time, maxHp: c.par, ammo: 100 })], [5, me]]);
    const matchEnd = { ...matchLive, phase: 'ended', winner: 0, timeLeft: 17 };
    for (let i = 0; i < 130; i++) hud.update(done, matchEnd, 5, 0.1);
    return { txt: ui.innerText.replace(/\s+/g, ' ').slice(0, 300), buttons: [...ui.querySelectorAll('button')].map((b) => `${b.textContent.trim()}${b.disabled ? ' (disabled)' : ''}`) };
  }, c);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `artifacts/q3/card-${c.name}.png` });
  await page.keyboard.press(c.key);
  await page.waitForTimeout(300);
  const calls = await page.evaluate(() => window.__calls);
  console.log(`card ${c.name}: ${JSON.stringify({ ...r, pressed: c.key, calls })}`);
}
console.log(`page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
await browser.close();
