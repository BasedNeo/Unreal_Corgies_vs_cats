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

// W9: BASE ASSAULT from the menu runs the mode on the authority (the six ball / stand / capture-ring props, EntityKind.Prop 5,
// ride the snapshot) and X4's throwables are live in it: the local pet spawns carrying one (EFlag.Ordnance, bit 19).
test('MATCH: BASE ASSAULT from the menu places both balls and the pet carries a throwable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?webgl&quality=low');
  const pick = page.locator('[data-match="base-assault"]');
  await pick.waitFor({ timeout: 90_000 });
  await pick.click();
  await expect(pick).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-play]').click();
  await page.waitForFunction(() => (globalThis as any).__cvc?.ready === true, null, { timeout: 90_000 });
  await page.waitForFunction(
    () => (((globalThis as any).__cvc.net?.entities ?? []) as number[][]).filter((e) => e[1] === 5).length >= 6,
    null, { timeout: 90_000 },
  );
  await page.waitForFunction(() => (((globalThis as any).__cvc.local?.flags ?? 0) & (1 << 19)) !== 0, null, { timeout: 90_000 });
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

// W13 TW-VIEW: SLAB from the menu reloads into the Godot game's match on The Lot (?mode=slab): the page builds The Lot
// with its six shared kit GLBs, the slab is the one EntityKind.Zone (8) in the snapshot, and the slab HUD shows both
// scores racing to 60, the clock, the slab line, hit points and ammo, in hud.gd's plain style, in place of the general
// HUD's comic match bar and health / ability / ammo panels. W15: plus the slab marker and the YOU line.
test('MATCH: SLAB from the menu starts the slab match on The Lot with its HUD and kit', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // the reload into the match carries no ?quality=: the saved setting keeps SwiftShader on the low tier
  await page.addInitScript(() => { if (!localStorage.getItem('cvc.settings')) localStorage.setItem('cvc.settings', JSON.stringify({ v: 1, quality: 'low' })); });
  await page.goto('/?webgl&quality=low');
  const pick = page.locator('[data-match="slab"]');
  await pick.waitFor({ timeout: 90_000 });
  await pick.click();
  await expect(pick).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-play]').click(); // another map: the page reloads straight into the match
  await page.waitForURL(/[?&]mode=slab/, { timeout: 60_000 });
  // (interval polling: a SwiftShader frame of The Lot can take seconds, rAF polling would wait on each one)
  await page.waitForFunction(() => (globalThis as any).__cvc?.ready === true, null, { timeout: 200_000, polling: 1000 });
  await page.waitForFunction(
    () => (((globalThis as any).__cvc.net?.entities ?? []) as number[][]).filter((e) => e[1] === 8).length === 1,
    null, { timeout: 60_000, polling: 1000 },
  );
  const slab = page.locator('#cvc-slab');
  await expect(slab).toBeVisible({ timeout: 30_000 });
  await expect(slab.locator('[data-slab-s0]')).toHaveText(/^\d+$/);
  await expect(slab.locator('[data-slab-s1]')).toHaveText(/^\d+$/);
  await expect(slab.locator('[data-slab-clock]')).toHaveText(/^[0-3]:[0-5]\d$/);
  await expect(slab).toContainText('CORGI COMPANY');
  await expect(slab).toContainText('CAT CADRE');
  await expect(slab.locator('[data-slab-state]')).toHaveText(/^SLAB\s+(NEUTRAL|CONTESTED|(CORGI COMPANY|CAT CADRE) HOLDING\s+\+1\/s)$/);
  await expect(slab.locator('[data-slab-hp]')).toHaveText(/^\d+$/);
  await expect(slab.locator('[data-slab-ammo]')).toHaveText(/^(\d+ \/ 30|RELOADING)$/);
  for (const sel of ['.mb', '.hp', '.am']) await expect(page.locator(`#cvc-hud ${sel}`)).toBeHidden(); // no comic panels, no Q ring
  await expect(page.locator('#cvc-hud .dbg')).toHaveText(''); // no fps / rtt line (Godot has none) without ?debug
  await expect(slab.locator('[data-slab-win]')).toBeHidden();
  // W15 (docs/qa/w15/HUD_CONTRACT.md §1, §4): the slab marker's two lines over a shape that carries the state, and the
  // YOU line over the HP bar
  const marker = slab.locator('[data-slab-marker]'); // a 0 x 0 anchor: its lines and shape carry the size
  await expect(marker.locator('[data-slab-marker-l1]')).toBeVisible();
  await expect(marker.locator('svg')).toBeVisible();
  await expect(marker.locator('[data-slab-marker-l1]')).toHaveText(/^SLAB\s+\d+ m$/);
  await expect(marker.locator('[data-slab-marker-l2]')).toHaveText(/^(NEUTRAL|CORGI COMPANY|CAT CADRE|CONTESTED)$/);
  await expect(marker).toHaveAttribute('data-shape', /^(hollow|filled|split)$/);
  await expect(slab.locator('[data-slab-you]')).toHaveText(/^YOU: (CORGI COMPANY|CAT CADRE)$/);
  // you plus one Cat bot, and the six Lot kit pieces drawn from their shared GLBs
  expect(await page.evaluate(() => ((globalThis as any).__cvc.net.entities as number[][]).filter((e) => e[1] <= 1).length)).toBe(2);
  await page.waitForFunction(() => (globalThis as any).__cvc.twin?.kits === 6, null, { timeout: 90_000, polling: 1000 });
  expect(await page.evaluate(() => (globalThis as any).__cvc.twin.map)).toBe('the_lot');
  expect(errors).toEqual([]);
});

// W13 TW-VIEW: the end of a slab match and the rematch. &slabTime / &slabOvertime shorten the offline match (they reach
// the worker's sim.state.matchConfig.slab through WorkerBootConfig; online rooms never see them): 8 s of regulation and
// 4 s of overtime end it (a draw, unless the Cat bot already holds the slab) and the result holds. R rematches to 0-0,
// and at the next end Enter does too (the authority takes a Reload edge 1 s or more after the end).
test('SLAB: the match ends on the winner screen; R, then Enter, rematch to 0-0', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?mode=slab&webgl&quality=low&autoplay&slabTime=8&slabOvertime=4');
  await page.waitForFunction(() => (globalThis as any).__cvc?.ready === true, null, { timeout: 200_000, polling: 1000 });
  const win = page.locator('#cvc-slab [data-slab-win]');
  const twin = () => page.evaluate(() => (globalThis as any).__cvc.twin as { match: { phase: string; score: number[] } | null; restarts: number; restartScore: number[] | null });
  for (const key of ['KeyR', 'Enter']) {
    await expect(win).toBeVisible({ timeout: 90_000 });
    await expect(win).toContainText(/CORGI COMPANY WINS|CAT CADRE WINS|DRAW/);
    await expect(win).toContainText('R / Enter: rematch');
    await expect(page.locator('#cvc-hud .bn')).toBeHidden(); // no comic "WIN!" burst over it
    await expect(page.locator('#cvc-slab [data-slab-state]')).toBeHidden(); // over: the slab claims no holder
    const before = (await twin()).restarts;
    await page.waitForTimeout(1500); // SLAB.rematchDelay (1 s) after the end
    await page.keyboard.press(key);
    await page.waitForFunction((n) => (globalThis as any).__cvc.twin.restarts > n, before, { timeout: 60_000, polling: 100 });
    expect((await twin()).restartScore).toEqual([0, 0]);
    await expect(win).toBeHidden({ timeout: 30_000 });
  }
  expect(errors).toEqual([]);
});
