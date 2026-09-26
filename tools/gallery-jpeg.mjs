#!/usr/bin/env node
// Shrink probe screenshots (PNG, 1280×720, ~1 MB) into small JPEGs a gallery doc can commit (~40–80 KB each).
// No image library is installed, so the headless Chromium that Playwright already ships does the resampling.
//   node tools/gallery-jpeg.mjs <outDir> <width=640> <quality=72> a.png b.png …   → <outDir>/a.jpg, <outDir>/b.jpg
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const [outDir, w = '640', q = '72', ...files] = process.argv.slice(2);
if (!outDir || !files.length) {
  console.error('usage: node tools/gallery-jpeg.mjs <outDir> <width> <quality> file.png…');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const width = Number(w), quality = Number(q);
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const f of files) {
  const src = `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  await page.setContent(`<body style="margin:0;background:#000"><img id="i" src="${src}"></body>`);
  const { nw, nh } = await page.$eval('#i', (img) => new Promise((res) => {
    const done = () => res({ nw: img.naturalWidth, nh: img.naturalHeight });
    if (img.complete) done(); else img.onload = done;
  }));
  const height = Math.round((width * nh) / nw);
  await page.setViewportSize({ width, height });
  await page.$eval('#i', (img, s) => { img.style.width = `${s.width}px`; img.style.height = `${s.height}px`; img.style.display = 'block'; }, { width, height });
  const out = join(outDir, basename(f).replace(/\.png$/i, '.jpg'));
  await page.screenshot({ path: out, type: 'jpeg', quality });
  console.log(`${out} ${width}×${height} ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
await browser.close();
