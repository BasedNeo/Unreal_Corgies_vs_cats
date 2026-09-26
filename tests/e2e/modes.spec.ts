import { test, expect } from '@playwright/test';

// The main menu's MATCH selector really starts the chosen mode (menu → PlayOptions.match → worker Room → match
// system → snapshot). Core Rush is the proof: its three Core Pads are EntityKind.Zone (8) in the snapshot.
test.use({ viewport: { width: 1024, height: 600 } });

test('MATCH: CORE RUSH from the menu starts a core-rush match with three Core Pads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?webgl&quality=low');
  const pick = page.locator('[data-match="core-rush"]');
  await pick.waitFor({ timeout: 90_000 });
  await pick.click();
  await expect(pick).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-play]').click();
  await page.waitForFunction(() => (globalThis as any).__cvc?.ready === true, null, { timeout: 90_000 });
  await page.waitForFunction(
    () => (((globalThis as any).__cvc.net?.entities ?? []) as number[][]).filter((e) => e[1] === 8).length === 3,
    null, { timeout: 90_000 },
  );
  expect(errors).toEqual([]);
});

// A1: ADVENTURE → a picked chapter from the menu runs that chapter (menu → PlayOptions.match/chapter → worker Room →
// adventure runner → MatchState): the top bar counts STEPs and shows its first objective, the intro panel names it.
// Chapter 2, not the default first one, so the pick itself is proven to reach the authority.
test('MATCH: ADVENTURE → The Tall Grass from the menu starts chapter 2', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // a returning player: chapter 1 done, so the picker unlocks chapter 2 (device progress, cvc.adventure)
  await page.addInitScript(() => localStorage.setItem('cvc.adventure', JSON.stringify({ unlocked: 2, medals: { yard_day: 'gold' } })));
  await page.goto('/?webgl&quality=low');
  const pick = page.locator('[data-match="adventure"]');
  await pick.waitFor({ timeout: 90_000 });
  await pick.click();
  const ch = page.locator('[data-ch="tall_grass"]');
  await ch.click();
  await expect(ch).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-play]').click();
  await page.waitForFunction(() => (globalThis as any).__cvc?.ready === true, null, { timeout: 90_000 });
  await page.waitForFunction(() => /STEP 1/.test(document.body.innerText) && /Sneak/i.test(document.body.innerText), null, { timeout: 90_000 });
  expect(await page.evaluate(() => /TALL GRASS/i.test(document.body.innerText))).toBe(true);
  expect(errors).toEqual([]);
});
