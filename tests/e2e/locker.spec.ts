import { test, expect, type Page } from '@playwright/test';

// U2: the LOCKER from the main menu. A returning player (level 2: the Tricolor corgi coat unlocked) opens LOCKER, equips
// the unlocked coat (saved to localStorage `cvc.profile`, shown as worn after a reload), a locked coat is refused with
// its hint, and Esc goes back to the main card. Once the lead wires the look into hello (INT6), the next step of this
// spec is "start a match, the local avatar wears it" (docs/handoff/P2.md §5).
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('cvc.profile') ?? 'null'));

test('LOCKER: equip an unlocked look, it is saved; a locked one is refused with its hint', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return; // survive the reload below
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cvc.profile', JSON.stringify({ v: 1, xp: 150, unlocked: ['corgi_tricolor', 'cat_tuxedo'], seen: [], equipped: { corgi: {}, cat: {} } }));
  });
  await page.goto('/?webgl&quality=low');
  const btn = page.locator('[data-locker]');
  await btn.waitFor({ timeout: 90_000 });
  await expect(btn.locator('.lvc')).toHaveText('LV 2');
  await expect(btn.locator('.nwc')).toHaveText('2'); // two new looks since the last visit
  await btn.click();
  await expect(page.locator('.mm-locker')).toBeVisible();
  await expect(page.locator('.lo-lv b')).toHaveText('2');

  // the unlocked coat: NEW, then worn and saved
  const tri = page.locator('[data-look="corgi_tricolor"]');
  await expect(tri.locator('.lo-nb')).toHaveText('NEW');
  await tri.click();
  await expect(tri).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-look="corgi_red"]')).toHaveAttribute('aria-checked', 'false');
  expect((await stored(page)).equipped.corgi.coat).toBe('corgi_tricolor');

  // a locked coat: still reachable by keyboard (aria-disabled, not disabled); Enter is refused with the hint, nothing saved
  const sable = page.locator('[data-look="corgi_sable"]');
  await expect(sable).toHaveAttribute('aria-disabled', 'true');
  await sable.focus();
  await page.keyboard.press('Enter');
  await expect(sable).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.lo-status')).toContainText('Reach level 6');
  expect((await stored(page)).equipped.corgi.coat).toBe('corgi_tricolor');

  // neckwear works the same way (both species); the cat side keeps its own look
  await page.locator('[data-slot="neck"]').click();
  await page.locator('[data-look="neck_none"]').click();
  await page.locator('[data-sp="cat"]').click();
  await page.locator('[data-slot="coat"]').click();
  await page.locator('[data-look="cat_tuxedo"]').click();
  const p = await stored(page);
  expect(p.equipped).toEqual({ corgi: { coat: 'corgi_tricolor', neck: 'neck_none' }, cat: { coat: 'cat_tuxedo' } });

  // keyboard: Esc goes back to the main card with PLAY focused
  await page.keyboard.press('Escape');
  await expect(page.locator('.mm-locker')).toBeHidden();
  await expect(page.locator('[data-play]')).toBeFocused();
  await expect(btn.locator('.nwc')).toBeHidden(); // seen

  // after a reload the locker still shows what is worn
  await page.reload();
  await page.locator('[data-locker]').click();
  await expect(page.locator('[data-look="corgi_tricolor"]')).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

// U2 × N2 (INT6): the look equipped in the LOCKER rides hello → roster → the local avatar in the next match.
test('an equipped look is worn by the local avatar in the next match', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem('cvc.profile', JSON.stringify({ v: 1, xp: 150, unlocked: ['corgi_tricolor', 'cat_tuxedo'], seen: [], equipped: { corgi: { coat: 'corgi_tricolor', neck: 'neck_none' }, cat: {} } }));
  });
  await page.goto('/?webgl&quality=low&autoplay&team=0&bots=0,0');
  await page.waitForFunction(() => (globalThis as any).__cvc?.ready === true, null, { timeout: 90_000 });
  await page.waitForFunction(() => (globalThis as any).__cvc.localLook !== '', null, { timeout: 30_000 });
  expect(await page.evaluate(() => (globalThis as any).__cvc.localLook)).toBe('corgi_tricolor|neck_none');
  expect(errors).toEqual([]);
});
