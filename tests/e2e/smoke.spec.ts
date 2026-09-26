import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Headless Chromium renders with SwiftShader on the CPU, so the full game runs at a few fps here.
// These tests prove boot, spawn, render and input → authority → prediction round trips; they use the
// low quality tier and a small viewport, and wait on game state rather than wall-clock time.
test.use({ viewport: { width: 800, height: 450 } });

const Q = '?webgl&autoplay&quality=low';

test('game boots, spawns the local player and renders without errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(`/${Q}&bots=0,2`);
  await page.waitForFunction(() => (globalThis as any).__cvc?.ready === true, null, { timeout: 90_000 });
  await page.waitForFunction(() => (globalThis as any).__cvc.frames > 12, null, { timeout: 90_000 });
  const dbg = await page.evaluate(() => (globalThis as any).__cvc);
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/smoke.png' });
  expect(dbg.errors).toEqual([]);
  expect(dbg.local).not.toBeNull();
  expect(dbg.entities).toBeGreaterThanOrEqual(1);
  expect(consoleErrors.filter((e) => !/GPU stall|WebGL|swiftshader|Automatic fallback/i.test(e))).toEqual([]);
});

test('local player moves forward when W is held', async ({ page }) => {
  await page.goto(`/${Q}&bots=0,0`);
  await page.waitForFunction(() => (globalThis as any).__cvc?.ready === true, null, { timeout: 90_000 });
  const before = await page.evaluate(() => (globalThis as any).__cvc.local);
  await page.keyboard.down('KeyW');
  // Hold until the authority-confirmed/predicted position has moved, or give up after 60 s.
  await page.waitForFunction((b) => {
    const l = (globalThis as any).__cvc.local;
    return l && Math.hypot(l.x - b.x, l.z - b.z) > 3;
  }, before, { timeout: 60_000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => (globalThis as any).__cvc.local);
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(3);
});
