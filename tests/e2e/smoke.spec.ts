import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Boots the game against the local worker authority, waits for a rendered, spawned player,
// then checks for errors and saves a screenshot for human/agent review.
test('game boots, spawns the local player and renders without errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto('/?webgl&autoplay&bots=0,2');
  await page.waitForFunction(() => (globalThis as any).__cvc?.ready === true, null, { timeout: 60_000 });
  await page.waitForFunction(() => (globalThis as any).__cvc.frames > 60, null, { timeout: 60_000 });
  const dbg = await page.evaluate(() => (globalThis as any).__cvc);
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/smoke.png' });
  expect(dbg.errors).toEqual([]);
  expect(dbg.local).not.toBeNull();
  expect(dbg.entities).toBeGreaterThanOrEqual(1);
  expect(consoleErrors.filter((e) => !/GPU stall|WebGL|swiftshader|Automatic fallback/i.test(e))).toEqual([]);
});

test('local player moves forward when W is held', async ({ page }) => {
  await page.goto('/?webgl&autoplay&bots=0,0');
  await page.waitForFunction(() => (globalThis as any).__cvc?.ready === true, null, { timeout: 60_000 });
  const before = await page.evaluate(() => (globalThis as any).__cvc.local);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => (globalThis as any).__cvc.local);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  expect(moved).toBeGreaterThan(3);
});
