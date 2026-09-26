// Capture the West Yard lab bookmarks at several times of day (retries flaky headless runs) and
// print png_stats-style sanity numbers. Needs the Vite dev server on :5173.
//   node tools/world-shots.mjs [times=0.68,0.735] [bookmarks=overview,deck,cats,center,flank] [outDir=artifacts/l2]
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

const times = (process.argv[2] ?? '0.68,0.735').split(',');
const bms = (process.argv[3] ?? 'overview,deck,cats,center,flank').split(',');
const outDir = process.argv[4] ?? 'artifacts/l2';
const extra = process.env.SHOT_QUERY ?? '';
mkdirSync(outDir, { recursive: true });

function stats(file) {
  const buf = readFileSync(file);
  let off = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), d = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } else if (type === 'IDAT') idat.push(d);
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const r = raw[y * (stride + 1) + 1 + x], a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = r;
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  let sum = 0, sq = 0;
  for (let i = 0; i < w * h; i++) { const l = 0.2126 * px[i * bpp] + 0.7152 * px[i * bpp + 1] + 0.0722 * px[i * bpp + 2]; sum += l; sq += l * l; }
  const mean = sum / (w * h);
  return { luma: +mean.toFixed(1), contrast: +Math.sqrt(sq / (w * h) - mean * mean).toFixed(1) };
}

for (const t of times) for (const bm of bms) {
  const out = `${outDir}/${bm}-t${t}.png`;
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    const r = spawnSync('node', ['tools/probe.mjs', `?webgl&bm=${bm}&t=${t}&hud=0${extra}`, '9', out], {
      env: { ...process.env, PROBE_URL: process.env.PROBE_URL ?? 'http://localhost:5173/labs/world.html' }, encoding: 'utf8', timeout: 170000,
    });
    const m = /"drawCalls":(\d+),"triangles":(\d+)/.exec(r.stdout ?? '');
    if (existsSync(out)) {
      const s = stats(out);
      ok = s.contrast > 6;
      console.log(JSON.stringify({ shot: out, attempt, drawCalls: m ? +m[1] : null, triangles: m ? +m[2] : null, ...s, ok }));
    } else console.log(JSON.stringify({ shot: out, attempt, error: (r.stderr || r.error?.message || '').slice(0, 200) }));
  }
}
