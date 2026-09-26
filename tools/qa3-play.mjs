#!/usr/bin/env node
// Q3 copy of tools/qa-w4play.mjs (Q2), output to artifacts/q3, plus scenarios tipcue, tdmlive, kart. Q2 verification: Wave 4 in headless Chromium (read-only probe; SwiftShader ~1–3 fps, so this judges integration,
// HUD, menus, errors and looks, not feel). Serve a production build first (vite preview, offline worker authority).
//   node tools/qa-w4play.mjs <scenario> [--base http://127.0.0.1:5190/] [--q '&quality=low']
// scenarios: menu (MATCH selector, chapter picker + locks) · modes (every MATCH mode from the menu) ·
//            chapters (?mode=adventure&chapter=<id>&autoplay for all six: intro, live, HUD) · boss (?boss=madame_pointille) ·
//            plane (ch6: back off the roof start to the hangar, E vend, E board: plane HUD only while flying) ·
//            abuse (malformed ?mode= / ?chapter= / ?boss=)
// Output: artifacts/q2/<scenario>-*.png and artifacts/q2/<scenario>.json (console errors/warnings, HUD text, draw calls).
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const scenario = argv[0] ?? 'modes';
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:5390/');
const Q = opt('q', '&quality=low');
const ONLY = opt('only', null);
const OUT = opt('out', 'artifacts/q3');
mkdirSync(OUT, { recursive: true });
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(exe) ? exe : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
});
const T0 = Date.now();
const log = { scenario, base: BASE, q: Q, runs: [] };
const say = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);

// Harness-only instrumentation: WebGL2 draw calls/triangles per frame, long tasks (the blocking world build), and
// the offline worker's messages (snapshots + events), without touching game code.
const INIT = () => {
  const P = WebGL2RenderingContext.prototype;
  const st = { calls: 0, tris: 0 };
  window.__qaGl = { frames: [] };
  const add = (mode, count, inst = 1) => { st.calls++; if (mode === 4) st.tris += (count / 3) * inst; else if (mode === 5 || mode === 6) st.tris += Math.max(0, count - 2) * inst; };
  const wrap = (name, f) => { const o = P[name]; P[name] = function (...a) { f(a); return o.apply(this, a); }; };
  wrap('drawArrays', (a) => add(a[0], a[2]));
  wrap('drawElements', (a) => add(a[0], a[1]));
  wrap('drawArraysInstanced', (a) => add(a[0], a[2], a[3]));
  wrap('drawElementsInstanced', (a) => add(a[0], a[1], a[4]));
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (st.calls) { window.__qaGl.frames.push({ calls: st.calls, tris: Math.round(st.tris) }); if (window.__qaGl.frames.length > 300) window.__qaGl.frames.shift(); } st.calls = 0; st.tris = 0; cb(t); });
  window.__qaLong = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__qaLong.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch { /* */ }
  const W = window.Worker;
  window.__qa = { snap: null, ev: [], welcome: null, roster: null };
  window.Worker = class extends W {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (e) => {
        const m = e.data;
        if (!m || typeof m !== 'object') return;
        if (m.t === 'snap') { window.__qa.snap = m; if (m.ev?.length) { window.__qa.ev.push(...m.ev.map((x) => ({ ...x, tick: m.tick }))); if (window.__qa.ev.length > 3000) window.__qa.ev.splice(0, 1500); } }
        else if (m.t === 'welcome') window.__qa.welcome = m;
        else if (m.t === 'roster') window.__qa.roster = m.players;
      });
    }
  };
};

async function open(query, { vw = 1280, vh = 720, init } = {}) {
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  const run = { query, errors: [], console: [], shots: [], notes: {} };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') run.console.push(`${m.type()}: ${m.text().slice(0, 240)}`); });
  page.on('pageerror', (e) => run.errors.push(String(e.stack ?? e).slice(0, 500)));
  await page.addInitScript(INIT);
  if (init) await page.addInitScript(init);
  await page.goto(BASE + query);
  log.runs.push(run);
  return { page, run };
}
const frames = (page) => page.evaluate(() => globalThis.__cvc?.frames ?? 0);
async function waitFrames(page, n, timeoutMs = 180000) {
  const f0 = await frames(page);
  await page.waitForFunction((t) => (globalThis.__cvc?.frames ?? 0) >= t, f0 + n, { timeout: timeoutMs, polling: 250 });
}
const ready = (page, t = 180000) => page.waitForFunction(() => globalThis.__cvc?.ready === true, null, { timeout: t, polling: 500 });
const { PNG } = (await import('playwright-core/lib/utilsBundle'));
async function shot(page, run, name) {
  const path = `${OUT}/${name}.png`;
  const pre = await page.evaluate(() => ({ f: globalThis.__cvc?.frames, w: document.querySelector('canvas')?.width }));
  const buf = await page.screenshot({ path });
  const post = await page.evaluate(() => ({ f: globalThis.__cvc?.frames, w: document.querySelector('canvas')?.width }));
  const png = PNG.sync.read(buf);
  let sum = 0, n = 0;
  for (let y = 250; y < 470; y += 4) for (let x = 400; x < 880; x += 4) { const k = (y * png.width + x) * 4; sum += png.data[k] + png.data[k + 1] + png.data[k + 2]; n++; }
  const lum = +(sum / n / 3).toFixed(1);
  run.shots.push({ path, pre, post, lum, blank: lum < 30 });
  say('shot', path, JSON.stringify({ pre, post, lum }));
}
async function hud(page) {
  return page.evaluate(() => {
    const t = (s) => document.querySelector(s)?.textContent?.trim() ?? null;
    const vis = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const byText = (re) => [...document.querySelectorAll('#ui div')].filter((d) => d.children.length === 0 && re.test(d.textContent ?? '') && vis(d)).map((d) => d.textContent);
    const gl = window.__qaGl?.frames.slice(-8) ?? [];
    const snap = window.__qa?.snap;
    return {
      timer: t('.mb-timer'), obj: t('.mb-obj'), wave: [...document.querySelectorAll('.mb-wave, .wave')].filter(vis).map((e) => e.textContent),
      cues: byText(/^(HIDDEN|SPOTTED|DOT ON YOU)$/),
      visibleText: document.getElementById('ui')?.innerText.replace(/\s+/g, ' ').slice(0, 900),
      draws: gl.length ? { calls: Math.max(...gl.map((f) => f.calls)), tris: Math.max(...gl.map((f) => f.tris)) } : null,
      longTasks: (window.__qaLong ?? []).slice().sort((a, b) => b - a).slice(0, 3),
      fps: +(globalThis.__cvc?.fps ?? 0).toFixed(2), errors: globalThis.__cvc?.errors ?? [],
      match: snap?.match ?? null, mode: window.__qa?.welcome?.mode,
      mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    };
  });
}
const done = () => { writeFileSync(`${OUT}/${scenario}.json`, JSON.stringify(log, null, 1)); };
const want = (id) => !ONLY || ONLY.split(',').includes(id);

// ------------------------------------------------------------------------------------------------ scenarios
if (scenario === 'menu') {
  const { page, run } = await open(`?webgl${Q}`);
  await page.locator('[data-match="adventure"]').waitFor({ timeout: 120000 });
  await waitFrames(page, 3);
  await shot(page, run, 'menu-default');
  await page.locator('[data-match="adventure"]').click();
  await waitFrames(page, 2);
  await shot(page, run, 'menu-adventure-fresh');
  run.notes.fresh = await page.evaluate(() => [...document.querySelectorAll('[data-ch]')].map((b) => ({ ch: b.dataset.ch, disabled: b.disabled, checked: b.getAttribute('aria-checked'), tag: b.querySelector('.mm-chap-tag')?.textContent, title: b.title })));
  // a locked chapter cannot be picked
  await page.locator('[data-ch="garage_job"]').click({ force: true }).catch((e) => { run.notes.lockedClick = String(e).slice(0, 120); });
  run.notes.afterLockedClick = await page.evaluate(() => document.querySelector('[data-ch="garage_job"]')?.getAttribute('aria-checked'));
  run.notes.hint = await page.evaluate(() => document.querySelector('[data-match-hint]')?.textContent);
  for (const m of ['yard-skirmish', 'team-deathmatch', 'core-rush']) {
    await page.locator(`[data-match="${m}"]`).click();
    await waitFrames(page, 1);
    run.notes[`hint:${m}`] = await page.evaluate(() => document.querySelector('[data-match-hint]')?.textContent);
  }
  await page.close();
  // a returning player: chapters 1–5 done with mixed medals, 6 unlocked
  const r2 = await open(`?webgl${Q}`, { init: () => localStorage.setItem('cvc.adventure', JSON.stringify({ unlocked: 6, medals: { yard_day: 'gold', tall_grass: 'silver', garage_job: 'bronze', laser_dawn: 'gold', porch_siege: 'gold' } })) });
  await r2.page.locator('[data-match="adventure"]').waitFor({ timeout: 120000 });
  await r2.page.locator('[data-match="adventure"]').click();
  await r2.page.locator('[data-ch="last_ball"]').click();
  await waitFrames(r2.page, 2);
  await shot(r2.page, r2.run, 'menu-adventure-progress');
  r2.run.notes.progress = await r2.page.evaluate(() => [...document.querySelectorAll('[data-ch]')].map((b) => ({ ch: b.dataset.ch, disabled: b.disabled, checked: b.getAttribute('aria-checked'), tag: b.querySelector('.mm-chap-tag')?.textContent })));
  r2.run.notes.sel = await r2.page.evaluate(() => document.querySelector('.mm-chap-sel')?.textContent);
  // the room browser (offline preview: no server → its empty/error state)
  await r2.page.locator('[data-rooms]').click().catch(() => {});
  await waitFrames(r2.page, 2);
  await shot(r2.page, r2.run, 'menu-rooms-offline');
  await r2.page.close();
  // small viewport: does the menu still fit?
  const r3 = await open(`?webgl${Q}`, { vw: 800, vh: 450, init: () => localStorage.setItem('cvc.adventure', JSON.stringify({ unlocked: 3, medals: { yard_day: 'gold', tall_grass: 'bronze' } })) });
  await r3.page.locator('[data-match="adventure"]').waitFor({ timeout: 120000 });
  await r3.page.locator('[data-match="adventure"]').click();
  await waitFrames(r3.page, 2);
  await shot(r3.page, r3.run, 'menu-adventure-800x450');
  await r3.page.close();
}

if (scenario === 'modes') {
  for (const m of ['yard-skirmish', 'team-deathmatch', 'core-rush', 'adventure']) {
    if (!want(m)) continue;
    const { page, run } = await open(`?webgl${Q}`);
    try {
      await page.locator(`[data-match="${m}"]`).waitFor({ timeout: 120000 });
      await page.locator(`[data-match="${m}"]`).click();
      await page.locator('[data-play]').click();
      await ready(page);
      await waitFrames(page, 25);
      run.notes.early = await hud(page);
      await shot(page, run, `mode-${m}`);
      await page.keyboard.down('Tab'); await waitFrames(page, 3);
      await shot(page, run, `mode-${m}-tab`);
      await page.keyboard.up('Tab');
      await waitFrames(page, 20);
      run.notes.late = await hud(page);
    } catch (e) { run.errors.push(`harness: ${String(e).slice(0, 200)}`); await shot(page, run, `mode-${m}-fail`).catch(() => {}); }
    say(m, JSON.stringify({ timer: run.notes.late?.timer, obj: run.notes.late?.obj, draws: run.notes.late?.draws, errors: run.errors.length, console: run.console.length }));
    await page.close();
  }
}

if (scenario === 'chapters') {
  const CH = [['yard_day', 'assault'], ['tall_grass', 'infiltrator'], ['garage_job', 'breacher'], ['laser_dawn', 'overwatch'], ['porch_siege', 'warden'], ['last_ball', 'skyraider']];
  for (const [id, cls] of CH) {
    if (!want(id)) continue;
    const { page, run } = await open(`?webgl${Q}&mode=adventure&chapter=${id}&autoplay&cls=${cls}&team=0&name=Q2`);
    try {
      await ready(page);
      await waitFrames(page, 4);
      run.notes.briefing = await hud(page);
      await shot(page, run, `ch-${id}-intro`);
      // skip the briefing (E), then let the chapter run a little
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => /STEP 1/.test(document.body.innerText), null, { timeout: 120000, polling: 500 });
      await waitFrames(page, 12);
      run.notes.live = await hud(page);
      await shot(page, run, `ch-${id}-live`);
      await waitFrames(page, 40);
      run.notes.later = await hud(page);
      await shot(page, run, `ch-${id}-later`);
    } catch (e) { run.errors.push(`harness: ${String(e).slice(0, 200)}`); await shot(page, run, `ch-${id}-fail`).catch(() => {}); run.notes.fail = await hud(page).catch(() => null); }
    say(id, JSON.stringify({ timer: run.notes.live?.timer, obj: run.notes.live?.obj, draws: run.notes.live?.draws, long: run.notes.live?.longTasks, errors: run.errors, console: run.console.length }));
    await page.close();
  }
}

if (scenario === 'boss') {
  const { page, run } = await open(`?webgl${Q}&boss=madame_pointille&autoplay&cls=overwatch&team=0&name=Q2`);
  try {
    await ready(page);
    await waitFrames(page, 8);
    run.notes.start = await hud(page);
    await shot(page, run, 'boss-start');
    // wait for the boss to be in and her bar up; then for her dot to land on us (the DOT ON YOU cue)
    await page.waitForFunction(() => /MADAME|POINTILL/i.test(document.body.innerText), null, { timeout: 240000, polling: 500 });
    await waitFrames(page, 6);
    run.notes.bar = await hud(page);
    await shot(page, run, 'boss-bar');
    const seen = await page.waitForFunction(() => [...document.querySelectorAll('#ui div')].some((d) => d.textContent === 'DOT ON YOU' && d.style.display === 'block'), null, { timeout: 300000, polling: 100 }).then(() => true).catch(() => false);
    run.notes.dotCueSeen = seen;
    if (seen) await shot(page, run, 'boss-dot-on-you');
    run.notes.dot = await hud(page);
    run.notes.bossEvents = await page.evaluate(() => { const c = {}; for (const e of window.__qa.ev) if (e.e === 'ability') c[e.ability] = (c[e.ability] ?? 0) + 1; return c; });
    await waitFrames(page, 30);
    await shot(page, run, 'boss-later');
    run.notes.later = await hud(page);
  } catch (e) { run.errors.push(`harness: ${String(e).slice(0, 200)}`); await shot(page, run, 'boss-fail').catch(() => {}); }
  say('boss', JSON.stringify({ bar: run.notes.bar?.visibleText?.match(/MADAME[^·]*·[^A-Z]*[A-Z0-9 ·!]+/)?.[0], dot: run.notes.dotCueSeen, ev: run.notes.bossEvents, errors: run.errors }));
  await page.close();
}

if (scenario === 'abuse') {
  const cases = [
    '&mode=<script>alert(1)</script>&autoplay', '&mode=adventure&chapter=../../etc&autoplay', '&mode=adventure&chapter=nonexistent_chapter&autoplay',
    '&mode=adventure&chapter=' + 'x'.repeat(200) + '&autoplay', '&boss=../../x&autoplay', '&boss=nope&autoplay', '&mode=free&autoplay', '&mode=boss-rush&chapter=yard_day&autoplay',
  ];
  for (const [i, c] of cases.entries()) {
    const { page, run } = await open(`?webgl${Q}${c}`);
    try {
      await ready(page, 150000);
      await waitFrames(page, 10);
      run.notes.hud = await hud(page);
      await shot(page, run, `abuse-${i}`);
    } catch (e) { run.errors.push(`harness: ${String(e).slice(0, 200)}`); await shot(page, run, `abuse-${i}-fail`).catch(() => {}); run.notes.hud = await hud(page).catch(() => null); }
    say(c.slice(0, 60), JSON.stringify({ mode: run.notes.hud?.mode, timer: run.notes.hud?.timer, obj: run.notes.hud?.obj, errors: run.errors, console: run.console.slice(0, 3) }));
    await page.close();
  }
}

if (scenario === 'plane') {
  // Chapter 6 starts the human on the garage roof, facing the parapet (+z); the Rooftop Hangar pad is ~15 m behind.
  const { page, run } = await open(`?webgl${Q}&mode=adventure&chapter=last_ball&autoplay&cls=skyraider&team=0&name=Q3`, { init: () => { try { localStorage.removeItem('cvc.tips'); } catch {} } });
  const tipNow = () => page.evaluate(() => { const t = document.querySelector('.tip'); return t && !t.classList.contains('hidden') ? t.textContent.slice(0, 70) : null; });
  const me = () => page.evaluate(() => { const c = globalThis.__cvc; const n = c.net?.entities ?? []; return { local: c.local, planes: n.filter((e) => e[1] === 4) }; });
  const planeHudShown = () => page.evaluate(() => { const ph = document.querySelector('.cvc-ph'); return ph && !ph.classList.contains('hidden') ? (ph.querySelector('.alt')?.textContent ?? '') + ' | ' + [...ph.querySelectorAll('.chips em')].filter((x) => !x.classList.contains('hidden')).map((x) => x.textContent).join(',') : false; });
  try {
    await ready(page);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => /STEP 1/.test(document.body.innerText), null, { timeout: 120000, polling: 500 });
    run.notes.hudOnFoot = await planeHudShown();
    run.notes.tipOnFoot = await tipNow();
    await shot(page, run, 'plane-onfoot');
    // back up toward the hangar kiosk (92, -68.3; use range 2.5 m): S along -z, then A (east, facing +z) along +x
    // Q3: strafe east first (x > 89.5), clear of the roof hatch (x 84.8–87.6, z −61.4…−58.6), then back up (S)
    run.notes.start = await me();
    await page.keyboard.down('KeyA');
    await page.waitForFunction(() => (globalThis.__cvc.local?.x ?? 0) > 89.5, null, { timeout: 120000, polling: 100 }).catch(() => {});
    await page.keyboard.up('KeyA');
    await page.keyboard.down('KeyS');
    await page.waitForFunction(() => (globalThis.__cvc.local?.z ?? 0) < -65.6, null, { timeout: 180000, polling: 100 }).catch(() => {});
    await page.keyboard.up('KeyS');
    await page.keyboard.down('KeyA');
    await page.waitForFunction(() => (globalThis.__cvc.local?.x ?? 0) > 90.3, null, { timeout: 120000, polling: 100 }).catch(() => {});
    await page.keyboard.up('KeyA');
    run.notes.atHangar = await me();
    await shot(page, run, 'plane-at-hangar');
    await page.keyboard.press('KeyE'); await waitFrames(page, 8); // vend
    run.notes.vended = await me();
    await shot(page, run, 'plane-vended');
    for (let i = 0; i < 4 && !(await page.evaluate(() => (globalThis.__cvc.net?.entities ?? []).some((e) => e[1] === 4 && Math.hypot(e[2] - globalThis.__cvc.local.x, e[4] - globalThis.__cvc.local.z) < 0.8))); i++) { await page.keyboard.press('KeyE'); await waitFrames(page, 6); } // board
    run.notes.after = await me();
    run.notes.hudSeated = await planeHudShown();
    run.notes.tipSeated = await tipNow();
    await shot(page, run, 'plane-seated');
    await page.keyboard.down('KeyW'); await waitFrames(page, 30); await page.keyboard.up('KeyW');
    run.notes.hudFlying = await planeHudShown();
    run.notes.tipFlying = await tipNow();
    run.notes.flySamples = [];
    for (let i = 0; i < 40; i++) { run.notes.flySamples.push({ strip: await planeHudShown(), tip: await tipNow(), y: (await page.evaluate(() => globalThis.__cvc.local?.y ?? null)) }); await page.waitForTimeout(500); }
    run.notes.flying = await me();
    await shot(page, run, 'plane-flying');
    run.notes.hud = await hud(page);
  } catch (e) { run.errors.push(`harness: ${String(e).slice(0, 200)}`); await shot(page, run, 'plane-fail').catch(() => {}); }
  say('plane', JSON.stringify(run.notes).slice(0, 800));
  await page.close();
}

if (scenario === 'black') {
  // Frame-by-frame after the briefing skip: is the canvas blank (page background #0d1a14) and does that line up with a
  // canvas buffer resize (adaptive pixel ratio)? Center-region brightness from the PNG (pngjs from playwright-core).
  const { PNG } = (await import('playwright-core/lib/utilsBundle')).default ?? (await import('playwright-core/lib/utilsBundle'));
  const id = opt('chapter', 'porch_siege');
  const { page, run } = await open(`?webgl${Q}&mode=adventure&chapter=${id}&autoplay&cls=warden&team=0&name=Q2`);
  await page.addInitScript(() => {});
  await ready(page);
  await page.evaluate(() => { const c = document.querySelector('canvas'); window.__qaSizes = []; new MutationObserver(() => window.__qaSizes.push({ f: globalThis.__cvc.frames, w: c.width, h: c.height, t: Math.round(performance.now()) })).observe(c, { attributes: true, attributeFilter: ['width', 'height'] }); });
  await page.keyboard.press('KeyE');
  const rows = [];
  for (let i = 0; i < Number(opt('n', 60)); i++) {
    const buf = await page.screenshot();
    const png = PNG.sync.read(buf);
    let sum = 0, n = 0;
    for (let y = 250; y < 470; y += 4) for (let x = 400; x < 880; x += 4) { const k = (y * png.width + x) * 4; sum += png.data[k] + png.data[k + 1] + png.data[k + 2]; n++; }
    const st = await page.evaluate(() => ({ f: globalThis.__cvc.frames, w: document.querySelector('canvas').width, sizes: window.__qaSizes.length }));
    const lum = +(sum / n / 3).toFixed(1);
    rows.push({ i, ...st, lum, blank: lum < 30 });
    if (lum < 30) await page.screenshot({ path: `${OUT}/black-${id}-${i}.png` });
    await page.waitForTimeout(150);
  }
  run.notes.rows = rows;
  run.notes.sizes = await page.evaluate(() => window.__qaSizes);
  const blanks = rows.filter((r) => r.blank);
  say('black', JSON.stringify({ shots: rows.length, blank: blanks.length, blankFrames: [...new Set(blanks.map((b) => b.f))], canvasResizes: run.notes.sizes }));
  await page.close();
}

if (scenario === 'geometry') {
  // DOM geometry (no pixels): the menu's left card vs the controls footer, and the in-game cue chips vs the tip bar.
  const rect = (sel) => (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
  for (const [w, h] of [[1280, 720], [1024, 600], [800, 450]]) {
    const { page, run } = await open(`?webgl${Q}`, { vw: w, vh: h });
    await page.locator('[data-match="adventure"]').waitFor({ timeout: 120000 });
    const measure = () => page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
      const card = r(document.querySelector('.mm-left')), foot = r(document.querySelector('.mm-foot')), right = r(document.querySelector('.mm-right'));
      return { card, right, foot, overlapPx: Math.max(card.bottom, right.bottom) - foot.top };
    });
    run.notes.skirmish = await measure();
    await page.locator('[data-match="adventure"]').click();
    await waitFrames(page, 1);
    run.notes.adventure = await measure();
    say(`menu ${w}x${h}`, JSON.stringify(run.notes));
    await page.close();
  }
  const { page, run } = await open(`?webgl${Q}&mode=yard-skirmish&autoplay`, { init: () => localStorage.removeItem('cvc.tips') });
  await ready(page);
  await page.waitForFunction(() => { const t = document.querySelector('.tip'); return t && !t.classList.contains('hidden') && t.getBoundingClientRect().height > 0; }, null, { timeout: 120000, polling: 200 }).catch(() => {});
  run.notes.cues = await page.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
    const tip = document.querySelector('.tip');
    const tipVisible = !!tip && !tip.classList.contains('hidden');
    const out = { tipVisible, tip: tip ? r(tip) : null, cues: {} };
    for (const d of document.querySelectorAll('#ui div')) {
      if (!['HIDDEN', 'SPOTTED', 'DOT ON YOU'].includes(d.textContent)) continue;
      const was = d.style.display; d.style.display = 'block'; out.cues[d.textContent] = r(d); d.style.display = was;
    }
    const ov = (a, b) => a && b && a.top < b.bottom && b.top < a.bottom && a.left < b.right && b.left < a.right;
    out.overlapWithTip = Object.fromEntries(Object.entries(out.cues).map(([k, v]) => [k, !!ov(v, out.tip)]));
    return out;
  });
  say('cues', JSON.stringify(run.notes.cues));
  await page.close();
}

if (scenario === 'tipcue') {
  // Q3: first-match tips must wait while HIDDEN / SPOTTED / DOT ON YOU or the plane strip is up (lead, Q2 P2-4).
  // Boss-rush with Madame Pointillé, tips reset (a first match): sample ~10 Hz, count samples where a cue is up AND a tip shows.
  const probe = () => page.evaluate(() => {
    const tip = document.querySelector('.tip');
    const tipShown = !!tip && !tip.classList.contains('hidden');
    const cues = [...document.querySelectorAll('#ui div')].filter((d) => ['HIDDEN', 'SPOTTED', 'DOT ON YOU'].includes(d.textContent) && d.style.display === 'block').map((d) => d.textContent);
    const plane = [...document.querySelectorAll('#ui *')].some((e) => /STALL|THROTTLE|HULL/i.test(e.textContent ?? '') && e.children.length === 0 && e.offsetParent !== null);
    return { f: globalThis.__cvc.frames, tipShown, tip: tipShown ? tip.textContent.slice(0, 70) : '', cues, plane };
  });
  let page;
  {
    const o = await open(`?webgl${Q}&boss=madame_pointille&autoplay&cls=overwatch&team=0&name=Q3`, { init: () => { try { localStorage.removeItem('cvc.tips'); } catch {} } });
    page = o.page; const run = o.run;
    await ready(page);
    const rows = [];
    const t0 = Date.now();
    while (Date.now() - t0 < Number(opt('secs', 200)) * 1000) {
      const r = await probe();
      rows.push(r);
      if (r.cues.length && r.tipShown && !run.notes.overlapShot) { run.notes.overlapShot = true; await shot(page, run, 'tipcue-boss-overlap'); }
      if (r.cues.length && !run.notes.cueShot) { run.notes.cueShot = true; await shot(page, run, 'tipcue-boss-cue'); }
      if (!r.cues.length && r.tipShown && !run.notes.tipShot) { run.notes.tipShot = true; await shot(page, run, 'tipcue-boss-tip'); }
      await page.waitForTimeout(100);
    }
    run.notes.summary = { samples: rows.length, tipSamples: rows.filter((r) => r.tipShown).length, cueSamples: rows.filter((r) => r.cues.length).length, both: rows.filter((r) => r.cues.length && r.tipShown).length, tips: [...new Set(rows.filter((r) => r.tipShown).map((r) => r.tip))] };
    say('tipcue boss', JSON.stringify(run.notes.summary), 'errors', run.errors.length);
    await page.close();
  }
}

done();
await browser.close();
say('done', `${OUT}/${scenario}.json`);
