import { chromium } from '@playwright/test';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [w, h] of [[480, 270], [800, 450]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto('http://localhost:4174/?webgl&autoplay&quality=low');
  await page.waitForFunction(() => globalThis.__cvc?.ready, null, { timeout: 120000 });
  const f0 = await page.evaluate(() => [globalThis.__cvc.frames, performance.now()]);
  await page.waitForTimeout(15000);
  const f1 = await page.evaluate(() => [globalThis.__cvc.frames, performance.now()]);
  console.log(w, h, 'fps', ((f1[0] - f0[0]) / ((f1[1] - f0[1]) / 1000)).toFixed(2));
  await page.close();
}
await browser.close();
