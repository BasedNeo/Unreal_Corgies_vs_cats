#!/usr/bin/env node
// Q1 verification: isolated HUD repro through the real module served by the Vite dev server (read-only probe).
//   npx vite --port 5173   (already running)   then   node tools/qa-hud.mjs [--base http://localhost:5173]
// Checks: (1) the Q-ability ring after a local `slide` / `ground_pound` movement event (not an ability),
// (2) the death-screen countdown the HUD shows when main.ts passes no `respawnIn` (authority respawn = 3 s),
// (3) the skirmish wave timer text while a wave is running (MatchState.timeLeft = 0 by contract).
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://localhost:5173';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${BASE}/qa-blank-404`); // same origin, no game boot
const out = await page.evaluate(async () => {
  const { createHud } = await import('/src/client/ui/hud.ts');
  const { CLASS_IDS } = await import('/src/shared/types.ts');
  document.body.innerHTML = '<div id="ui" style="position:fixed;inset:0"></div>';
  let t = 0; const clock = () => t;
  const hud = createHud(document.getElementById('ui'), {}, { clock });
  const me = { id: 7, kind: 0, team: 0, species: 0, cls: CLASS_IDS.indexOf('assault'), seed: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 120, maxHp: 120, anim: 0, flags: 1, weapon: 0, ammo: 30 };
  const match = { mode: 'yard-skirmish', phase: 'live', timeLeft: 0, score: [3, 1], objective: 'Wave 2/5 — 4 cats left', wave: 2, winner: -1 };
  const roster = [{ pid: 'p', name: 'Rex', team: 0, cls: 'assault', entity: 7, bot: false, kills: 0, deaths: 0, score: 0, ping: 0 }, { pid: 'b', name: 'Cat 9', team: 1, cls: 'assault', entity: 9, bot: true, kills: 0, deaths: 0, score: 0, ping: 0 }];
  const frame = (local) => hud.update({ local, match, roster, fps: 60, rttMs: 0, locked: true, backend: 'webgl', transport: 'worker', states: new Map([[7, local]]) });
  const q = (s) => document.querySelector(`#cvc-hud ${s}`);
  const res = {};
  frame(me); t += 0.1; frame(me);
  res.abilityBefore = { cls: q('.ab').className, cd: q('.ab-cd').textContent };
  hud.onGameEvent({ e: 'ability', id: 7, ability: 'slide', x: 0, y: 0, z: 0 });
  t += 0.1; frame(me);
  res.abilityAfterSlide = { cls: q('.ab').className, cd: q('.ab-cd').textContent };
  t += 20; frame(me);
  hud.onGameEvent({ e: 'ability', id: 7, ability: 'ground_pound', x: 0, y: 0, z: 0 });
  t += 0.1; frame(me);
  res.abilityAfterPound = { cls: q('.ab').className, cd: q('.ab-cd').textContent };
  res.timerDuringWave = { text: q('.mb-timer').textContent, cls: q('.mb-timer').className, obj: q('.mb-obj').textContent };
  // death at t, authority respawns 3.0 s later (COMBAT_RULES.respawnDelay)
  t += 20; frame(me);
  hud.onGameEvent({ e: 'hit', src: 9, dst: 7, dmg: 120, x: 0, y: 1, z: 0, crit: false });
  hud.onGameEvent({ e: 'death', id: 7, by: 9 });
  const dead = { ...me, hp: 0, flags: me.flags | 16, anim: 7 };
  const seen = [];
  for (let i = 0; i <= 30; i++) { frame(dead); seen.push(`${t.toFixed(1)}s:${q('.ds').classList.contains('hidden') ? 'hidden' : q('.ds-num').textContent}`); t += 0.1; }
  frame(me);
  res.deathCountdownAtRespawn = { at3s: seen[30], samples: seen.filter((_, i) => i % 5 === 0), afterRespawn: q('.ds').className };
  return res;
});
console.log(JSON.stringify(out, null, 2));
await page.screenshot({ path: 'artifacts/qa/q1-hud-repro.png' });
await browser.close();
