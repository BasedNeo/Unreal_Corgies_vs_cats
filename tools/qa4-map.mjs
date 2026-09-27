#!/usr/bin/env node
// Q4 verification probe (read-only): a top-down map of a battleground with where Base Assault carriers were stopped.
// Reads a `qa4-ba.mjs matches --json` file and draws: prop and cylinder footprints (grey), water (blue), spawns
// (corgi = blue squares, cat = red squares), stands (S) and flags (F) per team, each carry's steal point (small dot) and
// where it ended: dropped (x in the carrier's team colour) or captured (large ring). Mirrored runs are drawn with the
// teams' own (swapped) spawns and bases.
//   npx tsx tools/qa4-map.mjs artifacts/q4/ba/wy-base.json artifacts/q4/ba/map-wy-base.png [--map west_yard] [--px 3]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import zlib from 'node:zlib';
import { createWorldData } from '../src/shared/world/world-data';
import { waterAt } from '../src/shared/world/queries';
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { baseAssaultState } from '../src/sim/match';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const file = args[0], out = args[1] ?? 'artifacts/q4/ba/map.png';
const map = opt('map', 'west_yard') === 'west_yard' ? undefined : opt('map', '');
const PX = Number(opt('px', 3));
const J = JSON.parse(readFileSync(file, 'utf8'));
const mirrored = J.runs[0]?.variant === 'mirror' || J.runs[0]?.variant === 'both';
const data = createWorldData(J.runs[0]?.seed ?? 1, map);
const EXT = data.halfExtent + 5;
const W = Math.round(EXT * 2 * PX), H = W;
const img = Buffer.alloc(W * H * 3, 0);
const toPx = (x, z) => [Math.round((x + EXT) * PX), Math.round((z + EXT) * PX)];
const put = (px, py, c) => { if (px < 0 || py < 0 || px >= W || py >= H) return; const o = (py * W + px) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; };
// ground
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
  const x = px / PX - EXT, z = py / PX - EXT;
  put(px, py, waterAt(data, x, z) ? [60, 110, 150] : [52, 62, 44]);
}
const box = (b, c) => {
  const cs = Math.cos(b.rotY ?? 0), sn = Math.sin(b.rotY ?? 0);
  const r = Math.hypot(b.hx, b.hz);
  const [x0, z0] = toPx(b.x - r, b.z - r), [x1, z1] = toPx(b.x + r, b.z + r);
  for (let py = z0; py <= z1; py++) for (let px = x0; px <= x1; px++) {
    const x = px / PX - EXT - b.x, z = py / PX - EXT - b.z;
    const lx = x * cs - z * sn, lz = x * sn + z * cs;
    if (Math.abs(lx) <= b.hx && Math.abs(lz) <= b.hz) put(px, py, c);
  }
};
for (const b of data.props) box(b, b.y + b.hy > 1.2 ? [150, 150, 150] : [105, 105, 95]);
for (const c of data.cylinders ?? []) { const [cx, cz] = toPx(c.x, c.z); const rr = Math.max(1, c.r * PX); for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) if (dx * dx + dy * dy <= rr * rr) put(cx + dx, cz + dy, [150, 150, 150]); }
const TEAM = [[70, 140, 255], [255, 70, 70]];
const dot = (x, z, c, r = 1) => { const [cx, cz] = toPx(x, z); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) put(cx + dx, cz + dy, c); };
const cross = (x, z, c, r = 3) => { const [cx, cz] = toPx(x, z); for (let k = -r; k <= r; k++) { put(cx + k, cz + k, c); put(cx + k, cz - k, c); put(cx + k + 1, cz + k, c); put(cx + k + 1, cz - k, c); } };
const ring = (x, z, c, r = 6) => { const [cx, cz] = toPx(x, z); for (let a = 0; a < 64; a++) { const t = (a / 64) * Math.PI * 2; put(cx + Math.round(Math.cos(t) * r), cz + Math.round(Math.sin(t) * r), c); put(cx + Math.round(Math.cos(t) * (r - 1)), cz + Math.round(Math.sin(t) * (r - 1)), c); } };
const square = (x, z, c, r = 3) => { const [cx, cz] = toPx(x, z); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.abs(dx) === r || Math.abs(dy) === r) put(cx + dx, cz + dy, c); };
// spawns and bases (a mirrored run swaps the team of each)
for (const s of data.spawns) if (s.team === 0 || s.team === 1) square(s.x, s.z, TEAM[mirrored ? 1 - s.team : s.team]);
const sim = await Sim.create({ seed: J.runs[0]?.seed ?? 1, ...(map ? { map } : {}) });
const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [0, 0] });
room.tick();
const spots = baseAssaultState(sim).spots;
room.dispose();
for (const t of [0, 1]) {
  const sp = spots[t], team = mirrored ? 1 - t : t;
  ring(sp.flag.x, sp.flag.z, TEAM[team], Math.round(3.2 * PX));
  dot(sp.stand.x, sp.stand.z, [255, 255, 255], 3); dot(sp.stand.x, sp.stand.z, TEAM[team], 2);
}
// carries
let n = 0;
for (const r of J.runs) for (const c of r.carries) {
  const col = TEAM[c.team];
  dot(c.x0, c.z0, col.map((v) => v * 0.6), 1);
  if (c.end.reason === 'dropped') cross(c.end.x, c.end.z, col, 2);
  if (c.end.reason === 'captured') ring(c.end.x, c.end.z, [255, 220, 60], 4);
  n++;
}
mkdirSync(dirname(out), { recursive: true });
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
const crcT = new Uint32Array(256).map((_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
console.log(`[qa4-map] ${out} · ${W}×${H} px · ${n} carries · ${mirrored ? 'mirrored sides' : 'shipping sides'} · x right, z down`);
