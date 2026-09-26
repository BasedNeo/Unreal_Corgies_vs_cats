// Top-down map of the West Yard (terrain shading + surfaces + collider footprints + spawns, pads,
// water, bookmarks) rendered to PNG headlessly, plus layout stats. The world lane's "terrain lab".
//   npx tsx tools/world-map.mjs [seed] [out.png] [--px 4]
import { writeFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';
import { buildWestYard } from '../src/shared/world/west-yard.ts';
import { surfaceAt, nearestPropDist, waterAt } from '../src/shared/world/queries.ts';
import { gridSlopeDeg } from '../src/shared/world/terrain.ts';

const args = process.argv.slice(2);
const seed = Number(args[0] ?? 1);
const out = args[1] ?? 'artifacts/l2-map.png';
const PX = Number(args.includes('--px') ? args[args.indexOf('--px') + 1] : 4);
const EXT = 125;

const t0 = performance.now();
const data = buildWestYard(seed);
const buildMs = performance.now() - t0;

const W = Math.round(EXT * 2 * PX), H = W;
const img = Buffer.alloc(W * H * 3);
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const C = {
  grass: hex(0x6fa83a), wild: hex(0xa9b04e), dirt: hex(0x9b6b43), sand: hex(0xe6cf8f), mulch: hex(0x5b3a26),
  water: hex(0x4fb3d9), prop: hex(0xd8c3a0), boundary: hex(0xff00ff),
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const put = (px, py, c) => {
  if (px < 0 || py < 0 || px >= W || py >= H) return;
  const o = (py * W + px) * 3;
  img[o] = Math.max(0, Math.min(255, c[0])); img[o + 1] = Math.max(0, Math.min(255, c[1])); img[o + 2] = Math.max(0, Math.min(255, c[2]));
};
const toPx = (x, z) => [Math.round((x + EXT) * PX), Math.round((z + EXT) * PX)];

let walk = 0, cells = 0;
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
  const x = px / PX - EXT, z = py / PX - EXT;
  const h = data.height(x, z);
  const e = 0.5;
  const nx = data.height(x - e, z) - data.height(x + e, z), nz = data.height(x, z - e) - data.height(x, z + e);
  const shade = Math.max(0.35, Math.min(1.25, 0.9 + (nx * 0.6 + nz * 0.8) * 1.6));
  const s = data.surface ? data.surface(x, z) : { dirt: 0, sand: 0, mulch: 0, wild: 0 };
  let c = C.grass;
  c = mix(c, C.wild, s.wild * 0.8);
  c = mix(c, C.dirt, s.dirt);
  c = mix(c, C.sand, s.sand);
  c = mix(c, C.mulch, s.mulch);
  const w = waterAt(data, x, z);
  if (w && h < w.surfaceY) c = mix(c, C.water, 0.85);
  c = c.map((v) => v * shade);
  const top = surfaceAt(data, x, z);
  if (top.kind !== 'terrain' && top.y > h + 0.05) {
    const k = Math.min(1, (top.y - h) / 12);
    c = mix(mix(C.prop, [70, 60, 50], 0.35), [255, 250, 240], k);
    if (top.prop && top.prop.type === 'fence') c = [110, 70, 40];
  }
  if (Math.abs(x) < 100 && Math.abs(z) < 100) {
    cells++;
    if (top.kind === 'terrain' && gridSlopeDeg(data.terrain, x, z) < 30) walk++;
  }
  // 10 m grid
  if (Math.abs(x % 10) < 0.5 / PX * 2 || Math.abs(z % 10) < 0.5 / PX * 2) c = c.map((v) => v * 0.9);
  put(px, py, c);
}
const circle = (x, z, r, col, fill = false) => {
  const [cx, cy] = toPx(x, z), R = r * PX;
  for (let a = 0; a < 720; a++) { const t = (a / 720) * Math.PI * 2; put(Math.round(cx + Math.cos(t) * R), Math.round(cy + Math.sin(t) * R), col); }
  if (fill) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) put(Math.round(cx + dx), Math.round(cy + dy), col);
};
const line = (x0, z0, x1, z1, col) => {
  const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * PX * 1.5);
  for (let i = 0; i <= n; i++) { const t = i / n; const [px, py] = toPx(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t); put(px, py, col); }
};
for (const p of data.jumpPads ?? []) circle(p.x, p.z, p.r, [255, 220, 40]);
for (const w of data.water ?? []) if (w.shape === 'circle') circle(w.x, w.z, w.r, [30, 120, 255]);
const report = [];
for (const s of data.spawns) {
  const col = s.team === 0 ? [40, 90, 230] : [220, 40, 60];
  circle(s.x, s.z, 1.2, col, true);
  line(s.x, s.z, s.x - Math.sin(s.yaw) * 5, s.z - Math.cos(s.yaw) * 5, col);
  const top = surfaceAt(data, s.x, s.z);
  report.push({ team: s.team, x: s.x, z: s.z, y: +s.y.toFixed(2), clear: +nearestPropDist(data, s.x, s.z).toFixed(2), onTerrain: top.kind === 'terrain', slope: +gridSlopeDeg(data.terrain, s.x, s.z).toFixed(1) });
}
for (const b of data.bookmarks ?? []) {
  circle(b.pos[0], b.pos[2], 1.5, [255, 255, 255], true);
  line(b.pos[0], b.pos[2], b.pos[0] + (b.look[0] - b.pos[0]) * 0.25, b.pos[2] + (b.look[2] - b.pos[2]) * 0.25, [255, 255, 255]);
}

// PNG
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
mkdirSync(out.split('/').slice(0, -1).join('/') || '.', { recursive: true });
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));

let minH = Infinity, maxH = -Infinity;
for (const v of data.terrain.heights) { minH = Math.min(minH, v); maxH = Math.max(maxH, v); }
const shapes = {};
for (const p of data.prims ?? []) shapes[p.s] = (shapes[p.s] ?? 0) + 1;
console.log(JSON.stringify({
  seed, buildMs: +buildMs.toFixed(1), terrainN: data.terrain.n, heightRange: [+minH.toFixed(2), +maxH.toFixed(2)],
  walkablePctOfPlayArea: +(100 * walk / cells).toFixed(1), props: data.props.length, cylinders: data.cylinders.length,
  prims: data.prims.length, shapes, jumpPads: data.jumpPads.length, water: data.water.length, spawns: data.spawns.length,
}, null, 0));
for (const r of report) console.log('spawn', JSON.stringify(r));
console.log('map', out);
