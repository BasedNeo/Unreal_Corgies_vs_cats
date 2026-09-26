#!/usr/bin/env node
// Squint test for character screenshots (K1): crop a region, resample it, write a PNG. No image deps —
// the resampling runs in headless Chromium's canvas (the same browser the probe uses).
//   node tools/char-squint.mjs in.png out.png [--crop x,y,w,h] [--width 200] [--scale 4] [--pixel]
//   --width  resample the (cropped) image to this width, smoothed (the squint: detail averages away)
//   --scale  then magnify by this factor with nearest-neighbour (so a 200 px squint is viewable)
//   --pixel  resample with nearest-neighbour instead (magnify a true-size render without inventing detail)
import { chromium } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const [input, output] = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] ?? '').startsWith('--'));
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
if (!input || !output) { console.error('usage: char-squint.mjs in.png out.png [--crop x,y,w,h] [--width N] [--scale K] [--pixel]'); process.exit(2); }
const crop = opt('crop', null)?.split(',').map(Number) ?? null;
const width = Number(opt('width', 0));
const scale = Number(opt('scale', 1));
const pixel = argv.includes('--pixel');

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined });
const page = await browser.newPage();
const dataUrl = `data:image/png;base64,${readFileSync(input).toString('base64')}`;
const out = await page.evaluate(async ({ dataUrl, crop, width, scale, pixel }) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const [cx, cy, cw, ch] = crop ?? [0, 0, img.width, img.height];
  // Pass 1: crop + resample (smoothed halving steps avoid aliasing on big reductions).
  let src = document.createElement('canvas');
  src.width = cw; src.height = ch;
  src.getContext('2d').drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
  const tw = width > 0 ? width : cw, th = Math.max(1, Math.round((ch * tw) / cw));
  while (!pixel && src.width / 2 >= tw) {
    const half = document.createElement('canvas');
    half.width = Math.round(src.width / 2); half.height = Math.round(src.height / 2);
    const g = half.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, half.width, half.height);
    src = half;
  }
  const a = document.createElement('canvas');
  a.width = tw; a.height = th;
  const ga = a.getContext('2d');
  ga.imageSmoothingEnabled = !pixel; ga.imageSmoothingQuality = 'high';
  ga.drawImage(src, 0, 0, tw, th);
  // Pass 2: nearest-neighbour magnification for viewing.
  const b = document.createElement('canvas');
  b.width = Math.round(tw * scale); b.height = Math.round(th * scale);
  const gb = b.getContext('2d');
  gb.imageSmoothingEnabled = false;
  gb.drawImage(a, 0, 0, b.width, b.height);
  return b.toDataURL('image/png');
}, { dataUrl, crop, width, scale, pixel });
writeFileSync(output, Buffer.from(out.split(',')[1], 'base64'));
await browser.close();
console.log(`wrote ${output}`);
