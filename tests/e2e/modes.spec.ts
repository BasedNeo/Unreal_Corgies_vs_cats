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
