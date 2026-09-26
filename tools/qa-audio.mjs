#!/usr/bin/env node
// Q2 verification (read-only): S2's procedural audio in a REAL Web Audio implementation (Chromium's OfflineAudioContext),
// complementing the unit tests' strict fake context. Needs a Vite dev server (TS modules served as ES modules):
//   npx vite --port 5191 --strictPort   then   node tools/qa-audio.mjs [--base http://127.0.0.1:5191]
// 1) every recipe in presets.ts renders: finite samples, audible, its returned duration covers the sound, peak level;
// 2) the kart and plane engine voices: they sound while set() runs, follow speed/throttle, and after release() the
//    output decays to silence (sources stopped) — rendered offline over a scripted 6 s segment.
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://127.0.0.1:5191';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.route('**/qa-audio', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>qa</body></html>' }));
await page.goto(`${BASE}/qa-audio`);
const res = await page.evaluate(async () => {
  const P = await import('/src/client/audio/presets.ts');
  const E = await import('/src/client/audio/presets-engines.ts');
  const SR = 44100;
  const stats = (buf, from = 0, to = buf.length) => {
    let peak = 0, sum = 0, bad = 0, n = 0, lastLoud = -1;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = from; i < to; i++) { const v = d[i]; if (!Number.isFinite(v)) { bad++; continue; } const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; n++; if (a > 1e-3 && i > lastLoud) lastLoud = i; }
    }
    return { peak: +peak.toFixed(3), rmsDb: n ? +(10 * Math.log10(sum / n + 1e-12)).toFixed(1) : -120, bad, lastLoud: lastLoud / SR };
  };
  const out = { recipes: [], engines: [] };
  let seed = 1; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const [name, fn] of Object.entries(P)) {
    if (typeof fn !== 'function' || fn.length < 1 || name === 'drive') continue;
    const ctx = new OfflineAudioContext(2, SR * 4, SR);
    const g = ctx.createGain(); g.gain.value = 1; g.connect(ctx.destination);
    let dur = NaN, err = null;
    try { dur = fn({ ctx, out: g, t: 0.05, rand }, 1); } catch (e) { err = String(e).slice(0, 120); }
    const buf = await ctx.startRendering();
    const s = stats(buf);
    out.recipes.push({ name, dur: +Number(dur).toFixed(2), ...s, err, covers: s.lastLoud <= 0.05 + dur + 0.35 });
  }
  for (const kind of ['kart', 'plane']) {
    const ctx = new OfflineAudioContext(2, SR * 7, SR);
    const lvl = ctx.createGain(); lvl.gain.value = 1; lvl.connect(ctx.destination);
    const v = kind === 'kart' ? E.kartEngine(ctx, 0.05, 0.3) : E.planeEngine(ctx, 0.05, 0.3);
    v.out.connect(lvl);
    // a scripted segment: idle 1 s → full speed (and boost) 2 s → release at 4 s, level fade like the manager (τ 0.12 s)
    for (let t = 0.05; t < 4; t += 1 / 30) {
      const speed = t < 1 ? 0 : Math.min(kind === 'kart' ? 15 : 25, (t - 1) * 12);
      v.set({ now: t, speed, throttle: t < 1 ? 0.2 : 1, boost: t > 2.5 && t < 3.3, crouch: false, grounded: kind === 'kart', doppler: 1 });
    }
    const rel = { now: 4, speed: 0, throttle: 0, boost: false, crouch: false, grounded: true, doppler: 1 };
    v.release(rel);
    lvl.gain.setTargetAtTime(0, 4, 0.12);
    for (const s of v.sources) s.stop(4.7);
    const buf = await ctx.startRendering();
    const seg = (a, b) => stats(buf, Math.floor(a * SR), Math.floor(b * SR));
    out.engines.push({ kind, nodes: v.nodes.length, sources: v.sources.length, idle: seg(0.3, 1), full: seg(2, 2.5), boost: seg(2.6, 3.2), releaseTail: seg(4.8, 7) });
  }
  return out;
});
let fails = 0;
for (const r of res.recipes) {
  const ok = !r.err && r.bad === 0 && r.peak > 0.005 && r.covers;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  recipe ${r.name.padEnd(14)} dur ${String(r.dur).padStart(5)} s · peak ${r.peak} · rms ${r.rmsDb} dB · last audible ${r.lastLoud.toFixed(2)} s${r.err ? ` · ERROR ${r.err}` : ''}${r.bad ? ` · ${r.bad} non-finite` : ''}`);
}
for (const e of res.engines) {
  const ok = e.idle.peak > 0.002 && e.full.rmsDb > e.idle.rmsDb - 3 && e.releaseTail.peak < 1e-3 && e.idle.bad + e.full.bad === 0;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  engine ${e.kind}: ${e.nodes} nodes, ${e.sources} sources · idle rms ${e.idle.rmsDb} dB peak ${e.idle.peak} · full rms ${e.full.rmsDb} dB peak ${e.full.peak} · boost rms ${e.boost.rmsDb} dB peak ${e.boost.peak} · after release peak ${e.releaseTail.peak}`);
}
console.log(`page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
console.log(`\nAUDIO: ${res.recipes.length + res.engines.length - fails}/${res.recipes.length + res.engines.length} pass`);
await browser.close();
