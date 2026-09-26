#!/usr/bin/env node
// Q2 verification (read-only): the adventure chapter-complete card, the squad-down beat and device progress, rendered by
// the REAL client module (src/client/adventure/hud.ts via the Vite dev server) from synthetic beacon snapshots.
// (A headless human can't finish a chapter at ~1 fps; the authority side of completion is covered by tools/qa-adventure.mjs.)
//   npx vite --port 5191 --strictPort   then   node tools/qa-card.mjs [--base http://127.0.0.1:5191]
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://127.0.0.1:5191';
mkdirSync('artifacts/q2', { recursive: true });
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.route('**/qa-card', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:#6a9b5a"><div id="ui" style="position:absolute;inset:0"></div></body></html>' }));
await page.goto(`${BASE}/qa-card`);
const cases = [
  { chapter: 3, time: 58.2, par: 120, step: 4, name: 'gold' },      // gold, first clear of ch3
  { chapter: 3, time: 150.7, par: 120, step: 4, name: 'silver' },   // replay slower: best stays gold
  { chapter: 6, time: 600.4, par: 360, step: 5, name: 'bronze-final' }, // bronze, last chapter (no NEXT)
];
const out = [];
for (const c of cases) {
  const r = await page.evaluate(async (c) => {
    const { createAdventureHud } = await import('/src/client/adventure/index.ts');
    const { ADVENTURE_PHASES, ADVENTURE_CHAIN_INDEX } = await import('/src/shared/content/chapters.ts');
    const { EntityKind, EFlag } = await import('/src/shared/types.ts');
    const ui = document.getElementById('ui'); ui.innerHTML = '';
    const calls = [];
    const hud = createAdventureHud(ui, { onNext: (id) => calls.push(['next', id]), onReplay: (id) => calls.push(['replay', id]) });
    const beacon = (phase, over = {}) => ({ id: 900, kind: EntityKind.Prop, team: 0, species: 0, cls: ADVENTURE_CHAIN_INDEX, seed: c.chapter, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 0, maxHp: 0, anim: ADVENTURE_PHASES.indexOf(phase), flags: 0, weapon: 0, ammo: 0, ...over });
    const me = { id: 5, kind: EntityKind.Player, team: 0, species: 0, cls: 0, seed: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 100, maxHp: 100, anim: 0, flags: EFlag.Grounded, weapon: 0, ammo: 0 };
    const live = new Map([[900, beacon('live', { weapon: c.step - 1 })], [5, me]]);
    const matchLive = { mode: 'adventure', phase: 'live', timeLeft: 0, score: [30, 0], objective: 'x', wave: c.step, winner: -1 };
    for (let i = 0; i < 20; i++) hud.update(live, matchLive, 5, 0.1);
    const done = new Map([[900, beacon('complete', { weapon: c.step, hp: c.time, maxHp: c.par, ammo: 100 })], [5, me]]);
    const matchEnd = { ...matchLive, phase: 'ended', winner: 0 };
    for (let i = 0; i < 120; i++) hud.update(done, matchEnd, 5, 0.1); // 12 s: outro captions, then the card
    const txt = ui.innerText.replace(/\s+/g, ' ');
    return { txt: txt.slice(0, 400), progress: localStorage.getItem('cvc.adventure'), buttons: [...ui.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  }, c);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `artifacts/q2/card-${c.name}.png` });
  out.push({ ...c, ...r });
  console.log(`card ${c.name}: ${JSON.stringify(r)}`);
}
// the squad-down beat
const beat = await page.evaluate(async () => {
  const { createAdventureHud } = await import('/src/client/adventure/index.ts');
  const { ADVENTURE_PHASES, ADVENTURE_CHAIN_INDEX } = await import('/src/shared/content/chapters.ts');
  const { EntityKind } = await import('/src/shared/types.ts');
  const ui = document.getElementById('ui'); ui.innerHTML = '';
  const hud = createAdventureHud(ui, {});
  const b = { id: 900, kind: EntityKind.Prop, team: 0, species: 0, cls: ADVENTURE_CHAIN_INDEX, seed: 5, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 0, maxHp: 0, anim: ADVENTURE_PHASES.indexOf('failed'), flags: 0, weapon: 3, ammo: 0 };
  const m = { mode: 'adventure', phase: 'live', timeLeft: 2, score: [0, 0], objective: 'Squad down! Back to the checkpoint in 2', wave: 4, winner: -1 };
  for (let i = 0; i < 10; i++) hud.update(new Map([[900, b]]), m, -1, 0.1);
  return ui.innerText.replace(/\s+/g, ' ').slice(0, 200);
});
await page.screenshot({ path: 'artifacts/q2/card-squad-down.png' });
console.log(`squad-down: ${beat}`);
console.log(`page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
await browser.close();
