// QA-FLIP (docs/qa/w17/QA-FLIP.md): node groundcore.mjs <skyMaskDir> <outDir> [radius 12]
// The ground CORE of each view: ground pixels with no sky pixel within <radius> px (Chebyshev), i.e. out of reach of
// FLIP's ~10 px filter halo, so a sky change cannot leak into the ground numbers across the skyline.
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const [skyDir, outDir, rArg] = process.argv.slice(2);
const R = Number(rArg ?? 12);
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(skyDir).filter((n) => n.endsWith('.png'))) {
  const { data, info } = await sharp(join(skyDir, f)).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, sky = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) sky[k] = data[k * info.channels] > 127 ? 1 : 0;
  const t = new Uint8Array(w * h), d = new Uint8Array(w * h); // separable max filter: the sky dilated by R
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let i = Math.max(0, x - R); i <= Math.min(w - 1, x + R) && !m; i++) m = sky[y * w + i]; t[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let j = Math.max(0, y - R); j <= Math.min(h - 1, y + R) && !m; j++) m = t[j * w + x]; d[y * w + x] = m; }
  const out = Buffer.alloc(w * h);
  let n = 0;
  for (let k = 0; k < w * h; k++) if (!d[k]) { out[k] = 255; n++; }
  await sharp(out, { raw: { width: w, height: h, channels: 1 } }).png().toFile(join(outDir, f));
  console.log(f, 'ground core px', n);
}
