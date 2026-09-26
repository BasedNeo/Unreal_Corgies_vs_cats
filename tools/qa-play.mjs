#!/usr/bin/env node
// Q1 verification: scripted "play it like a player" sessions in headless Chromium (read-only probe).
//   node tools/qa-play.mjs <scenario> [--base http://localhost:4174/] [--minutes 3] [--query '&lag=80&loss=1']
// scenarios: skirmish (menu → play → move/jump/slide/pound/aim/fire → die → respawn → Tab → Esc/settings, memory)
//            tdm      (?mode=team-deathmatch autoplay: engage, scoreboard, match flow)
//            online   (two pages on ?server=…, one moves; each must see the other; lag/loss via --query)
// SwiftShader renders ~1 fps here, so every step waits on rendered frames, not wall time. The offline worker
// snapshots are snooped from the Worker message channel (test harness only; no game code is touched) to get
// teams, yaw, hp and events that window.__cvc does not expose. Output: artifacts/qa/<scenario>.json + PNGs.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const scenario = argv[0] ?? 'skirmish';
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('base', 'http://localhost:4174/');
const MINUTES = Number(opt('minutes', 3));
const EXTRA = opt('query', '');
const OUT = 'artifacts/qa';
mkdirSync(OUT, { recursive: true });
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(exe) ? exe : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
});
const log = { scenario, base: BASE, startedAt: new Date().toISOString(), steps: [], errors: [], consoleErrors: [], memory: [], shots: [] };
const note = (k, v) => { log.steps.push({ t: Math.round((Date.now() - T0) / 1000), k, v }); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`); };
const T0 = Date.now();

// Snoop authority → client messages on the offline Worker (the page keeps using them untouched).
const SNOOP = () => {
  const W = window.Worker;
  window.__qa = { snap: null, roster: null, ev: [], welcome: null };
  window.Worker = class extends W {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (e) => {
        const m = e.data;
        if (!m || typeof m !== 'object') return;
        if (m.t === 'snap') { window.__qa.snap = m; if (m.ev?.length) { window.__qa.ev.push(...m.ev.map((x) => ({ ...x, tick: m.tick }))); if (window.__qa.ev.length > 4000) window.__qa.ev.splice(0, 2000); } }
        else if (m.t === 'roster') window.__qa.roster = m.players;
        else if (m.t === 'welcome') window.__qa.welcome = m;
      });
    }
  };
};


// Draw-call / triangle counter per animation frame (WebGL2 backend; harness-only instrumentation).
const GLCOUNT = () => {
  const P = WebGL2RenderingContext.prototype;
  const st = { calls: 0, tris: 0, lines: 0 };
  window.__qaGl = { frames: [] };
  const add = (mode, count, inst = 1) => { st.calls++; if (mode === 4) st.tris += (count / 3) * inst; else if (mode === 5 || mode === 6) st.tris += Math.max(0, count - 2) * inst; else st.lines += count * inst; };
  const wrap = (name, f) => { const o = P[name]; P[name] = function (...a) { f(a); return o.apply(this, a); }; };
  wrap('drawArrays', (a) => add(a[0], a[2]));
  wrap('drawElements', (a) => add(a[0], a[1]));
  wrap('drawArraysInstanced', (a) => add(a[0], a[2], a[3]));
  wrap('drawElementsInstanced', (a) => add(a[0], a[1], a[4]));
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (st.calls) { window.__qaGl.frames.push({ calls: st.calls, tris: Math.round(st.tris), lines: st.lines }); if (window.__qaGl.frames.length > 200) window.__qaGl.frames.shift(); } st.calls = 0; st.tris = 0; st.lines = 0; cb(t); });
};

async function openPage(query, vw = 640, vh = 360) {
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => log.errors.push(String(e).slice(0, 400)));
  await page.addInitScript(SNOOP);
  await page.addInitScript(GLCOUNT);
  await page.goto(BASE + query);
  return page;
}
const frames = (page) => page.evaluate(() => globalThis.__cvc?.frames ?? 0);
async function waitFrames(page, n, timeoutMs = 120000) {
  const f0 = await frames(page);
  await page.waitForFunction((t) => (globalThis.__cvc?.frames ?? 0) >= t, f0 + n, { timeout: timeoutMs, polling: 200 });
}
async function shot(page, name, big = true) {
  const vp = page.viewportSize();
  if (big) { await page.setViewportSize({ width: 1280, height: 720 }); await waitFrames(page, 2); }
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path });
  log.shots.push(path);
  if (big) { await page.setViewportSize(vp); await waitFrames(page, 1); }
  note('screenshot', path);
}
const F = { Dead: 1 << 4, Grounded: 1, Crouching: 1 << 5, Aiming: 1 << 3, Invulnerable: 1 << 7 };
const IDX = { id: 0, kind: 1, team: 2, species: 3, cls: 4, x: 6, y: 7, z: 8, yaw: 9, pitch: 10, hp: 14, maxHp: 15, anim: 16, flags: 17, weapon: 18, ammo: 19 };
async function state(page) {
  return page.evaluate((IDX) => {
    const q = window.__qa, c = globalThis.__cvc;
    const snap = q?.snap;
    const me = snap ? snap.ents.find((r) => r[0] === snap.you) : null;
    const ents = snap ? snap.ents.map((r) => ({ id: r[IDX.id], kind: r[IDX.kind], team: r[IDX.team], x: r[IDX.x], y: r[IDX.y], z: r[IDX.z], yaw: r[IDX.yaw], hp: r[IDX.hp], flags: r[IDX.flags], weapon: r[IDX.weapon], ammo: r[IDX.ammo] })) : [];
    const hud = document.getElementById('cvc-hud');
    const txt = (s) => hud?.querySelector(s)?.textContent ?? null;
    const cls = (s) => hud?.querySelector(s)?.className ?? null;
    return {
      frames: c?.frames, fps: c?.fps, local: c?.local, localEntity: c?.localEntity, errors: c?.errors?.length ?? 0,
      tick: snap?.tick, you: snap?.you, match: snap?.match,
      me: me ? { team: me[IDX.team], x: me[IDX.x], y: me[IDX.y], z: me[IDX.z], yaw: me[IDX.yaw], pitch: me[IDX.pitch], hp: me[IDX.hp], flags: me[IDX.flags], ammo: me[IDX.ammo], weapon: me[IDX.weapon] } : null,
      ents,
      hud: { hp: txt('.hp-num'), ammo: txt('.am-num'), ab: cls('.ab'), abCd: txt('.ab-cd'), ds: cls('.ds'), dsNum: txt('.ds-num'), dsKiller: txt('.ds-killer'), sb: cls('.sb'), timer: txt('.mb-timer'), obj: txt('.mb-obj'), kf: hud?.querySelector('.kf')?.innerText ?? '', lk: cls('.lk') },
      locked: document.pointerLockElement?.tagName ?? null,
      mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      evCount: q?.ev?.length ?? 0,
    };
  }, IDX);
}
const mouseLook = (page, dx, dy) => page.evaluate(([dx, dy]) => window.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy })), [dx, dy]);
const SENS = 0.0022;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** Turn toward the nearest living enemy using the last snapshot's yaw; returns { target, err } (radians). */
async function aimAtEnemy(page, s, gain = 0.7) {
  if (!s.me) return null;
  const foes = s.ents.filter((e) => (e.kind === 0 || e.kind === 1) && e.team !== s.me.team && !(e.flags & F.Dead));
  if (!foes.length) return null;
  foes.sort((a, b) => Math.hypot(a.x - s.me.x, a.z - s.me.z) - Math.hypot(b.x - s.me.x, b.z - s.me.z));
  const t = foes[0];
  const dx = t.x - s.me.x, dz = t.z - s.me.z, d = Math.hypot(dx, dz);
  const want = Math.atan2(-dx, -dz);
  const err = wrap(want - s.me.yaw);
  const wantPitch = Math.atan2(t.y + 0.7 - (s.me.y + 1.25), d);
  const perr = wantPitch - s.me.pitch;
  // yaw -= movementX * sens  →  movementX = -err / sens
  await mouseLook(page, Math.round((-err * gain) / SENS), Math.round((-perr * gain) / SENS));
  return { target: t.id, dist: +d.toFixed(1), err: +(err * 180 / Math.PI).toFixed(1) };
}

async function memSample(page) {
  const s = await state(page);
  log.memory.push({ t: Math.round((Date.now() - T0) / 1000), mb: s.mem, frames: s.frames });
  return s;
}


/** From the snooped event stream: my death → my next spawn delays (s), from authority ticks. */
const respawnDelays = (page, you) => page.evaluate((you) => {
  const E = window.__qa.ev, out = [];
  E.forEach((e, i) => { if (e.e === 'death' && e.id === you) { const s = E.slice(i + 1).find((x) => x.e === 'spawn' && x.id === you); if (s) out.push(+((s.tick - e.tick) / 60).toFixed(2)); } });
  return out;
}, you);

// ------------------------------------------------------------------------------------------ scenarios
async function skirmish() {
  const page = await openPage(`?webgl&quality=low${EXTRA}`);
  await page.waitForFunction(() => (globalThis.__cvc?.frames ?? 0) > 2, null, { timeout: 180000 });
  await waitFrames(page, 2);
  const menuVisible = await page.evaluate(() => !!document.querySelector('[data-play]') && document.querySelector('[data-play]').offsetParent !== null);
  note('main menu visible', menuVisible);
  await shot(page, 'q1-menu');
  // settings from the main menu
  await page.click('[data-settings]').catch((e) => note('settings click failed', String(e)));
  await waitFrames(page, 2);
  await shot(page, 'q1-settings');
  await page.keyboard.press('Escape');
  await waitFrames(page, 2);
  await page.click('[data-play]');
  await waitFrames(page, 3);
  let s = await state(page);
  note('after PLAY OFFLINE', { locked: s.locked, you: s.you, me: s.me, match: s.match?.objective });
  await page.waitForFunction(() => globalThis.__cvc?.ready === true, null, { timeout: 120000 });
  s = await memSample(page);
  await shot(page, 'q1-play-start');

  // --- movement: run (W), jump, double jump, slide, ground pound
  const p0 = s.local;
  await page.keyboard.down('KeyW'); await waitFrames(page, 3); await page.keyboard.up('KeyW'); await waitFrames(page, 1);
  s = await state(page);
  note('W for 3 frames: moved m', +Math.hypot(s.local.x - p0.x, s.local.z - p0.z).toFixed(2));
  // jump + double jump
  const y0 = s.me?.y ?? s.local.y;
  await page.keyboard.down('Space'); await waitFrames(page, 1); await page.keyboard.up('Space');
  await page.keyboard.down('Space'); await waitFrames(page, 1); await page.keyboard.up('Space');
  await waitFrames(page, 2);
  const jumps = await page.evaluate((you) => window.__qa.ev.filter((e) => e.e === 'jump' && e.id === you).map((e) => (e.double ? 'J2' : 'J1')), s.you);
  note('jump events from authority for me (predicted locals are dropped client-side, authority still sends)', jumps);
  // slide: sprint forward then C
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await waitFrames(page, 3);
  await page.keyboard.press('KeyC'); await waitFrames(page, 1);
  s = await state(page);
  note('HUD ability ring right after a SLIDE (bark blast never used)', { ab: s.hud.ab, abCd: s.hud.abCd });
  await shot(page, 'q1-slide-hud');
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  await waitFrames(page, 2);
  // ground pound: jump, then C in the air
  await page.keyboard.down('Space'); await waitFrames(page, 1); await page.keyboard.up('Space');
  await page.keyboard.press('KeyC'); await waitFrames(page, 2);
  const abil = await page.evaluate((you) => window.__qa.ev.filter((e) => e.e === 'ability' && e.id === you).map((e) => e.ability), s.you);
  note('my ability events (authority)', abil);
  // aim (RMB)
  await page.mouse.down({ button: 'right' }); await waitFrames(page, 3);
  s = await state(page);
  note('aiming flag', !!(s.me && (s.me.flags & F.Aiming)));
  await shot(page, 'q1-aim');
  await page.mouse.up({ button: 'right' });

  // --- combat loop: hunt the nearest enemy until dead, then observe the respawn
  const deadline = Date.now() + MINUTES * 60000;
  let firing = false, lastMem = 0, deathAt = null, deathShot = false, respawned = null, dsNums = [], deaths = 0, maxFramesSince = 0;
  const hunt = { frames: 0, fired: 0, ammoMin: 999, aimErrs: [] };
  let scoreShot = false, pauseShot = false;
  while (Date.now() < deadline) {
    s = await state(page);
    if (Date.now() - lastMem > 10000) { await memSample(page); lastMem = Date.now(); }
    if (!s.me) { await waitFrames(page, 1); continue; }
    const dead = !!(s.me.flags & F.Dead);
    if (dead) {
      if (firing) { await page.mouse.up(); firing = false; }
      await page.keyboard.up('KeyW');
      if (!deathAt) { deathAt = { t: Date.now(), tick: s.tick }; deaths++; note('I died', { tick: s.tick, hud: s.hud }); }
      dsNums.push(s.hud.dsNum);
      if (!deathShot) { await shot(page, 'q1-dead'); deathShot = true; }
      await waitFrames(page, 1);
      continue;
    }
    if (deathAt) {
      const secs = (s.tick - deathAt.tick) / 60;
      respawned = { authorityTicksDeadToAlive: s.tick - deathAt.tick, seconds: +secs.toFixed(2), deathScreenCountdownShown: [...new Set(dsNums)], invulnerable: !!(s.me.flags & F.Invulnerable) };
      note('respawned', respawned);
      await shot(page, 'q1-respawn');
      deathAt = null; dsNums = [];
    }
    const a = await aimAtEnemy(page, s);
    hunt.frames++;
    if (a) {
      hunt.aimErrs.push(Math.abs(a.err));
      if (Math.abs(a.err) < 4 && a.dist < 60) { if (!firing) { await page.mouse.down(); firing = true; hunt.fired++; } }
      else if (firing) { await page.mouse.up(); firing = false; }
      // close in if far
      if (a.dist > 25) await page.keyboard.down('KeyW'); else await page.keyboard.up('KeyW');
    }
    hunt.ammoMin = Math.min(hunt.ammoMin, s.me.ammo);
    if (!scoreShot && hunt.frames === 12) { await page.keyboard.down('Tab'); await waitFrames(page, 2); await shot(page, 'q1-scoreboard'); await page.keyboard.up('Tab'); scoreShot = true; }
    if (!pauseShot && hunt.frames === 30) { if (firing) { await page.mouse.up(); firing = false; } await shot(page, 'q1-combat'); pauseShot = true; }
    await waitFrames(page, 1);
    if (deaths >= 2 && respawned) break;
  }
  if (firing) await page.mouse.up();
  await page.keyboard.up('KeyW');
  s = await memSample(page);
  const ev = await page.evaluate((you) => {
    const E = window.__qa.ev;
    return {
      myShots: E.filter((e) => e.e === 'fire' && e.id === you).length,
      myHits: E.filter((e) => e.e === 'hit' && e.src === you).length,
      hitsOnMe: E.filter((e) => e.e === 'hit' && e.dst === you).length,
      myKills: E.filter((e) => e.e === 'death' && e.by === you && e.id !== you).length,
      myDeaths: E.filter((e) => e.e === 'death' && e.id === you).length,
      kinds: Object.fromEntries(Object.entries(E.reduce((m, e) => ((m[e.e] = (m[e.e] ?? 0) + 1), m), {}))),
    };
  }, s.you);
  note('combat summary', { ...ev, huntFrames: hunt.frames, triggerPulls: hunt.fired, ammoMin: hunt.ammoMin, medianAimErrDeg: hunt.aimErrs.sort((a, b) => a - b)[Math.floor(hunt.aimErrs.length / 2)] });
  note('match at end', s.match);
  note('my respawn delays (s, authority ticks death→spawn)', await respawnDelays(page, s.you));
  // Esc → click-to-play overlay → pause settings (synthetic Escape cannot release pointer lock; do what the UA does)
  await page.evaluate(() => document.exitPointerLock()); await waitFrames(page, 2);
  s = await state(page);
  note('after Esc: pointer lock / overlay class', { locked: s.locked, lk: s.hud.lk });
  await shot(page, 'q1-pause');
  log.final = { fps: s.fps, frames: s.frames, errors: await page.evaluate(() => globalThis.__cvc.errors) };
  await page.close();
}

async function tdm() {
  const page = await openPage(`?webgl&autoplay&quality=low&mode=team-deathmatch${EXTRA}`);
  await page.waitForFunction(() => globalThis.__cvc?.ready === true, null, { timeout: 180000 });
  await page.mouse.click(320, 180); await waitFrames(page, 2);
  let s = await memSample(page);
  note('TDM start', { you: s.you, team: s.me?.team, match: s.match, players: s.ents.filter((e) => e.kind <= 1).length });
  await shot(page, 'q1-tdm-start');
  const deadline = Date.now() + MINUTES * 60000;
  let firing = false, n = 0, lastMem = 0, shotMid = false; const dsSeen = new Set();
  while (Date.now() < deadline) {
    s = await state(page);
    if (Date.now() - lastMem > 10000) { await memSample(page); lastMem = Date.now(); }
    if (s.me && (s.me.flags & F.Dead)) dsSeen.add(s.hud.dsNum + (s.hud.ds?.includes('hidden') ? '(hidden)' : ''));
    if (s.me && !(s.me.flags & F.Dead)) {
      const a = await aimAtEnemy(page, s);
      if (a && Math.abs(a.err) < 4 && a.dist < 60) { if (!firing) { await page.mouse.down(); firing = true; } }
      else if (firing) { await page.mouse.up(); firing = false; }
      if (a && a.dist > 25) await page.keyboard.down('KeyW'); else await page.keyboard.up('KeyW');
    } else if (firing) { await page.mouse.up(); firing = false; }
    if (!shotMid && ++n === 25) { await page.keyboard.down('Tab'); await waitFrames(page, 2); await shot(page, 'q1-tdm-scoreboard'); await page.keyboard.up('Tab'); shotMid = true; }
    await waitFrames(page, 1);
  }
  if (firing) await page.mouse.up();
  s = await memSample(page);
  const ev = await page.evaluate((you) => { const E = window.__qa.ev; return { deaths: E.filter((e) => e.e === 'death').length, myKills: E.filter((e) => e.e === 'death' && e.by === you && e.id !== you).length, myDeaths: E.filter((e) => e.e === 'death' && e.id === you).length, myHits: E.filter((e) => e.e === 'hit' && e.src === you).length }; }, s.you);
  note('TDM end', { match: s.match, ...ev });
  note('my respawn delays (s, authority ticks death→spawn)', await respawnDelays(page, s.you));
  note('death-screen countdown values seen while dead', [...dsSeen]);
  await shot(page, 'q1-tdm-end');
  log.final = { fps: s.fps, frames: s.frames, errors: await page.evaluate(() => globalThis.__cvc.errors) };
  await page.close();
}

async function online() {
  const server = opt('server', 'ws://localhost:8797');
  const q = `?webgl&quality=low&server=${encodeURIComponent(server)}${EXTRA}`;
  const a = await openPage(`${q}&name=Alpha&cls=assault&team=0`, 480, 270);
  const b = await openPage(`${q}&name=Bravo&cls=infiltrator&team=1`, 480, 270);
  for (const p of [a, b]) await p.waitForFunction(() => globalThis.__cvc?.ready === true && globalThis.__cvc?.net?.connected, null, { timeout: 180000 });
  const net = (p) => p.evaluate(() => { const c = globalThis.__cvc; return { local: c.local, localEntity: c.localEntity, fps: c.fps, net: { connected: c.net.connected, rttMs: c.net.rttMs, kbIn: c.net.kbIn, kbOut: c.net.kbOut, interpDelayMs: c.net.interpDelayMs, predicting: c.net.predicting, predErrCm: c.net.predErrCm, corrections: c.net.corrections, snaps: c.net.snaps, entities: c.net.entities } }; });
  let A = await net(a), B = await net(b);
  note('online joined', { a: { id: A.localEntity, rtt: A.net.rttMs, predicting: A.net.predicting }, b: { id: B.localEntity, rtt: B.net.rttMs, predicting: B.net.predicting } });
  const seenBy = (viewer, id) => viewer.net.entities.find((e) => e[0] === id);
  const aStartSeenByB = seenBy(B, A.localEntity);
  // A runs forward; B watches.
  await a.mouse.click(240, 135);
  await a.keyboard.down('KeyW');
  for (let i = 0; i < 12; i++) await waitFrames(a, 1);
  await a.keyboard.down('Space'); await waitFrames(a, 1); await a.keyboard.up('Space');
  for (let i = 0; i < 6; i++) await waitFrames(a, 1);
  await a.keyboard.up('KeyW');
  await waitFrames(b, 3);
  A = await net(a); B = await net(b);
  const aEndSeenByB = seenBy(B, A.localEntity);
  note('A as seen by B moved (m)', aStartSeenByB && aEndSeenByB ? +Math.hypot(aEndSeenByB[2] - aStartSeenByB[2], aEndSeenByB[4] - aStartSeenByB[4]).toFixed(2) : null);
  note('A own view vs B view of A (m)', aEndSeenByB ? +Math.hypot(A.local.x - aEndSeenByB[2], A.local.z - aEndSeenByB[4]).toFixed(2) : null);
  note('A net', A.net && { rtt: A.net.rttMs, kbIn: A.net.kbIn, kbOut: A.net.kbOut, interp: A.net.interpDelayMs, predErrCm: A.net.predErrCm, corrections: A.net.corrections, snaps: A.net.snaps, fps: A.fps });
  note('B net', B.net && { rtt: B.net.rttMs, kbIn: B.net.kbIn, kbOut: B.net.kbOut, interp: B.net.interpDelayMs, predErrCm: B.net.predErrCm, corrections: B.net.corrections, snaps: B.net.snaps, fps: B.fps });
  await shot(a, 'q1-online-a');
  await shot(b, 'q1-online-b');
  log.final = { a: await a.evaluate(() => globalThis.__cvc.errors), b: await b.evaluate(() => globalThis.__cvc.errors) };
  await a.close(); await b.close();
}


async function camera() {
  // Free mode (no match rules), no bots: walk into walls and look around; screenshots judge clipping.
  const page = await openPage(`?webgl&autoplay&quality=low&mode=free&bots=0,0${EXTRA}`);
  await page.waitForFunction(() => globalThis.__cvc?.ready === true, null, { timeout: 180000 });
  await page.mouse.click(320, 180); await waitFrames(page, 2);
  let s = await state(page);
  note('camera start', { me: s.me });
  await shot(page, 'q1-cam-0-spawn');
  // back straight into whatever is behind the spawn (house wall / deck) until blocked
  let last = s.local, still = 0;
  await page.keyboard.down('KeyS');
  for (let i = 0; i < 40 && still < 3; i++) { await waitFrames(page, 1); s = await state(page); const d = Math.hypot(s.local.x - last.x, s.local.z - last.z); still = d < 0.05 ? still + 1 : 0; last = s.local; }
  await page.keyboard.up('KeyS');
  note('backed into obstacle at', s.me);
  await shot(page, 'q1-cam-1-back-to-wall');
  // pitch fully up and fully down against the wall
  await mouseLook(page, 0, -900); await waitFrames(page, 2); await shot(page, 'q1-cam-2-wall-look-up');
  await mouseLook(page, 0, 1400); await waitFrames(page, 2); await shot(page, 'q1-cam-3-wall-look-down');
  await mouseLook(page, 0, -500);
  // turn 90° so the wall is on the right shoulder side and strafe right into it
  await mouseLook(page, Math.round((Math.PI / 2) / SENS), 0); await waitFrames(page, 1);
  await page.keyboard.down('KeyD');
  for (let i = 0; i < 12; i++) await waitFrames(page, 1);
  await page.keyboard.up('KeyD');
  await shot(page, 'q1-cam-4-wall-right-shoulder');
  await page.mouse.down({ button: 'right' }); await waitFrames(page, 3);
  await shot(page, 'q1-cam-5-wall-right-shoulder-aim');
  await page.mouse.up({ button: 'right' });
  const gl = await page.evaluate(() => window.__qaGl.frames.slice(-10));
  note('draw calls / triangles per frame (low tier, last 10 frames)', gl);
  log.final = { errors: await page.evaluate(() => globalThis.__cvc.errors) };
  await page.close();
}

async function perf() {
  // Default (saved) quality vs low: draw calls and triangles per frame at 1280x720 in a TDM firefight.
  for (const q of ['high', 'low']) {
    const page = await openPage(`?webgl&autoplay&quality=${q}&mode=team-deathmatch${EXTRA}`, 1280, 720);
    await page.waitForFunction(() => globalThis.__cvc?.ready === true, null, { timeout: 240000 });
    for (let i = 0; i < 8; i++) await waitFrames(page, 1, 240000);
    const g = await page.evaluate(() => window.__qaGl.frames.slice(-6));
    const s = await state(page);
    const max = (k) => Math.max(...g.map((f) => f[k]));
    note(`perf ${q}`, { frames: g, maxCalls: max('calls'), maxTris: max('tris'), fps: s.fps, entities: s.ents.length, mem: s.mem });
    await page.screenshot({ path: `${OUT}/q1-perf-${q}.png` }); log.shots.push(`${OUT}/q1-perf-${q}.png`);
    await page.close();
  }
}

try {
  if (scenario === 'skirmish') await skirmish();
  else if (scenario === 'tdm') await tdm();
  else if (scenario === 'online') await online();
  else if (scenario === 'camera') await camera();
  else if (scenario === 'perf') await perf();
  else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  log.fatal = String(e?.stack ?? e);
  console.log('FATAL', log.fatal);
} finally {
  log.durationSec = Math.round((Date.now() - T0) / 1000);
  writeFileSync(`${OUT}/${scenario}${EXTRA ? '-emu' : ''}.json`, JSON.stringify(log, null, 2));
  console.log(`errors ${log.errors.length} · console errors ${log.consoleErrors.length} · memory ${log.memory.map((m) => m.mb).join(',')} MB · ${OUT}/${scenario}.json`);
  await browser.close();
}
