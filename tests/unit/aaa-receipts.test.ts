// W17 AAA (lane BL-DCC): every Blender output the AAA pass lands is what its receipt says it is: the file exists, its
// bytes and sha256 match, the licence line is there, and its shape is the one the engines rely on. The sky SOURCE is
// read back in Node (EXR header + ZIP blocks) so the horizon colour both engines use for fog, and the warm patches on
// the flood towers' bearings (sky v2), are re-derived from the file, not trusted from the receipt.
// AAA_RECEIPTS_ROOT=<dir> runs the same checks on a copy (used to prove the test fails on a broken receipt).
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { backdropLimits, validateBackdrop } from '../../tools/assets/validate-glb.mjs';
import { checkSpz, SPLAT } from '../../tools/splat/spz_check.mjs';

const ROOT = process.env.AAA_RECEIPTS_ROOT ?? fileURLToPath(new URL('../../', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));          // the scripts (a break copy holds only assets)
const scriptSha = (path: string): string => createHash('sha256').update(readFileSync(join(REPO, path))).digest('hex');
const RECEIPTS = ['assets/sky/lot_night_sky.receipt.json', 'assets/lot/lot_wet_mask.receipt.json',
  'assets/backdrop/lot_backdrop.receipt.json', 'assets/backdrop/lot_backdrop_untrained.receipt.json'];

describe('W17 AAA receipts: no machine paths', () => {
  it('no receipt carries an absolute path (scratch is written <scratch>/...)', () => {
    for (const r of RECEIPTS) {
      const text = readFileSync(join(ROOT, r), 'utf8');
      expect(text.match(/"(\/(tmp|home|root|Users|var)\/[^"]*)"|\s(\/(tmp|home|root|Users|var)\/\S*)/g), `${r}: absolute paths`).toBeNull();
    }
  });
});
const LICENCE = 'Original work of the Corgis vs Cats project, rendered by its own scripts with Blender 5.2.2 '
  + '(GPL tool; outputs are ours); no third-party content';

interface FileFacts { path: string; bytes: number; sha256: string; width?: number; height?: number }
interface Receipt {
  kind: string; licence: string; rebuild: string; outputs: Record<string, FileFacts>; params: Record<string, unknown>;
  render?: { spp: number; seed: number };
  sky?: {
    horizon_linear: number[]; horizon_rows: number[]; zenith_linear: number[]; zenith_rows: number[]; horizon_lum: number;
    measures: {
      method: string; hero: { billow_p90_p10: number; rb: number; gb: number };
      hero_camera: { billow_p90_p10: number; gap_floor_pct: number; flat_pct: number; rb: number; gb: number;
        camera: { bearing_deg: number; pitch_deg: number; fov_v_deg: number; size: number[]; sky_rows: number; tile_px: number } };
      flood_patches: { id: string; bearing_deg: number; rb: number }[]; control_between_floods: { bearing_deg: number; rb: number }[];
    };
  };
}

const readReceipt = (path: string): Receipt => JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Receipt;

function checkFacts(rec: Receipt, key: string): Buffer {
  const f = rec.outputs[key];
  expect(f, `receipt has no outputs.${key}`).toBeDefined();
  const abs = join(ROOT, f.path);
  expect(existsSync(abs), `${f.path} exists`).toBe(true);
  const buf = readFileSync(abs);
  expect(buf.length, `${f.path} bytes`).toBe(f.bytes);
  expect(createHash('sha256').update(buf).digest('hex'), `${f.path} sha256`).toBe(f.sha256);
  return buf;
}

// ------------------------------------------------------------------------------------------------ OpenEXR (read only)
interface Exr { width: number; height: number; yMin: number; channels: { name: string; type: number }[]; compression: number; flags: number; body: number; buf: Buffer }

function exrHeader(buf: Buffer): Exr {
  expect(buf.readUInt32LE(0), 'EXR magic').toBe(20000630);
  const flags = buf.readUInt32LE(4) >>> 8;
  let p = 8;
  const cstr = () => { const e = buf.indexOf(0, p); const s = buf.toString('latin1', p, e); p = e + 1; return s; };
  const out: Partial<Exr> = { flags, buf };
  for (;;) {
    const name = cstr();
    if (name === '') break;
    cstr();                                                   // attribute type
    const size = buf.readInt32LE(p); p += 4;
    const v = p;
    if (name === 'channels') {
      const ch: { name: string; type: number }[] = [];
      let q = v;
      while (buf[q] !== 0) {
        const e = buf.indexOf(0, q);
        ch.push({ name: buf.toString('latin1', q, e), type: buf.readInt32LE(e + 1) });
        q = e + 1 + 16;
      }
      out.channels = ch;
    } else if (name === 'compression') {
      out.compression = buf[v];
    } else if (name === 'dataWindow') {
      out.yMin = buf.readInt32LE(v + 4);
      out.width = buf.readInt32LE(v + 8) - buf.readInt32LE(v) + 1;
      out.height = buf.readInt32LE(v + 12) - buf.readInt32LE(v + 4) + 1;
    }
    p = v + size;
  }
  out.body = p;
  return out as Exr;
}

function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** One scanline of a ZIP (16-line blocks) half-float RGB scanline EXR as [R, G, B] arrays (row 0 = top). */
function exrReader(x: Exr): (row: number) => Float64Array[] {
  const { buf, width: w, channels } = x;
  const blocks = new Map<number, { y0: number; d: Buffer }>();
  return (row: number) => {
    const block = Math.floor(row / 16);
    let b = blocks.get(block);
    if (!b) {
      const at = Number(buf.readBigUInt64LE(x.body + 8 * block));
      const size = buf.readInt32LE(at + 4);
      const t = Buffer.from(inflateSync(buf.subarray(at + 8, at + 8 + size)));   // undo the delta predictor ...
      for (let i = 1; i < t.length; i++) t[i] = (t[i - 1] + t[i] - 128) & 255;
      const half = Math.ceil(t.length / 2), d = Buffer.alloc(t.length);          // ... then the byte interleave
      for (let i = 0; i < t.length; i++) d[i] = i % 2 === 0 ? t[i >> 1] : t[half + (i >> 1)];
      b = { y0: buf.readInt32LE(at), d };
      blocks.set(block, b);
    }
    const line = (x.yMin + row - b.y0) * channels.length * w * 2;
    const out = [new Float64Array(w), new Float64Array(w), new Float64Array(w)];
    channels.forEach((c, k) => {
      const ch = out['RGB'.indexOf(c.name)];
      for (let i = 0; i < w; i++) ch[i] = halfToFloat(b!.d.readUInt16LE(line + (k * w + i) * 2));
    });
    return out;
  };
}

/** Mean RGB over every column of `rows`. */
function exrRowMean(x: Exr, rows: number[]): number[] {
  const read = exrReader(x), sum = [0, 0, 0];
  for (const row of rows) read(row).forEach((ch, k) => { for (const v of ch) sum[k] += v; });
  return sum.map((v) => v / (rows.length * x.width));
}

/** Mean RGB of the texels within +-half deg of a bearing (0 = game -Z, 90 = +X: u x 360) and el0..el1 deg up: the
 * same window as sky_source.py window(). */
function exrWindowMean(x: Exr, bearing: number, half: number, el0: number, el1: number): number[] {
  const read = exrReader(x), sum = [0, 0, 0];
  let n = 0;
  for (let row = 0; row < x.height; row++) {
    const el = 90 - ((row + 0.5) / x.height) * 180;
    if (el < el0 || el > el1) continue;
    const rgb = read(row);
    for (let i = 0; i < x.width; i++) {
      const b = ((i + 0.5) / x.width) * 360;
      if (Math.abs(((b - bearing + 540) % 360) - 180) > half) continue;
      for (let k = 0; k < 3; k++) sum[k] += rgb[k][i];
      n++;
    }
  }
  return sum.map((v) => v / n);
}

function pngSize(buf: Buffer): { width: number; height: number; depth: number; colour: number } {
  expect(buf.subarray(0, 8).toString('hex'), 'PNG signature').toBe('89504e470d0a1a0a');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), depth: buf[24], colour: buf[25] };
}

// ------------------------------------------------------------------------------------------------ the receipts
describe('W17 AAA receipts: pass 1 SKY SOURCE (assets/sky/lot_night_sky)', () => {
  const rec = readReceipt('assets/sky/lot_night_sky.receipt.json');

  it('carries the licence line, the rebuild command and the product render settings', () => {
    expect(rec.licence).toBe(LICENCE);
    expect(rec.kind).toBe('SOURCE: sky');
    expect(rec.rebuild).toMatch(/^"\$BLENDER" --background --factory-startup --python tools\/blender\/sky_source\.py/);
    expect(rec.render?.spp).toBe(64);
    expect(rec.render?.seed).toBe(1717);
  });

  it('the EXR matches its receipt and is 2048x1024 half-float RGB, ZIP, single-part scanline', () => {
    const x = exrHeader(checkFacts(rec, 'exr'));
    expect([x.width, x.height]).toEqual([2048, 1024]);
    expect([rec.outputs.exr.width, rec.outputs.exr.height]).toEqual([2048, 1024]);
    expect(x.flags & (0x2 | 0x8 | 0x10), 'not tiled, deep or multi-part').toBe(0);
    expect(x.compression, 'ZIP (16-line blocks)').toBe(3);
    expect(x.channels.map((c) => c.name)).toEqual(['B', 'G', 'R']);
    expect(x.channels.every((c) => c.type === 1), 'every channel HALF').toBe(true);
  });

  it('the horizon and zenith colours in the receipt are the file\'s own (re-derived from the EXR rows)', () => {
    const x = exrHeader(readFileSync(join(ROOT, rec.outputs.exr.path)));
    const sky = rec.sky!;
    expect(sky.horizon_rows).toEqual([511, 512]);
    expect(sky.zenith_rows).toEqual([0, 1]);
    const hz = exrRowMean(x, sky.horizon_rows), zn = exrRowMean(x, sky.zenith_rows);
    hz.forEach((v, k) => expect(v, `horizon ${'RGB'[k]}`).toBeCloseTo(sky.horizon_linear[k], 5));
    zn.forEach((v, k) => expect(v, `zenith ${'RGB'[k]}`).toBeCloseTo(sky.zenith_linear[k], 5));
    for (const c of [...hz, ...zn]) expect(c > 0 && c < 1, 'a night sky: linear 0..1').toBe(true);
  });

  it('stays inside the night: the horizon (the fog colour) has r <= b and linear luminance <= 0.10 (from the file)', () => {
    const x = exrHeader(readFileSync(join(ROOT, rec.outputs.exr.path)));
    const [r, g, b] = exrRowMean(x, rec.sky!.horizon_rows);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(r, 'horizon r <= b').toBeLessThanOrEqual(b);
    expect(lum, 'horizon luminance').toBeLessThanOrEqual(0.10);
    expect(rec.sky!.horizon_lum).toBeCloseTo(lum, 5);
  });

  it('v2: warm sodium patches on each flood tower\'s bearing, 5-25 deg up, r/b >= 0.7 and warmer than between them '
    + '(re-derived from the file; bearings from the_lot.json)', () => {
    const x = exrHeader(readFileSync(join(ROOT, rec.outputs.exr.path)));
    const m = rec.sky!.measures;
    const lot = JSON.parse(readFileSync(join(ROOT, 'engines/godot/data/the_lot.json'), 'utf8')) as {
      floodlights: { id: string; pos: number[] }[];
    };
    const rb = (c: number[]) => c[0] / c[2];
    const control = m.control_between_floods.map((c) => rb(exrWindowMean(x, c.bearing_deg, 10, 5, 25)));
    expect(lot.floodlights.map((f) => f.id)).toEqual(m.flood_patches.map((p) => p.id));
    lot.floodlights.forEach((f, k) => {
      const bearing = ((Math.atan2(f.pos[0], -f.pos[2]) * 180) / Math.PI + 360) % 360;
      expect(m.flood_patches[k].bearing_deg, `${f.id} bearing`).toBeCloseTo(bearing, 0);
      const v = rb(exrWindowMean(x, bearing, 10, 5, 25));
      expect(v, `${f.id} patch r/b (file) vs receipt`).toBeCloseTo(m.flood_patches[k].rb, 2);
      expect(v, `${f.id} patch r/b`).toBeGreaterThanOrEqual(0.7);
      for (const c of control) expect(v, `${f.id} patch warmer than between the floods`).toBeGreaterThan(c);
    });
  });

  it('v3: one continuous deck at the real hero camera: gap floor <= 25 %, flat <= 10 %, p90/p10 2.5-4.5', () => {
    const h = rec.sky!.measures.hero_camera;
    expect([h.camera.bearing_deg, h.camera.pitch_deg, h.camera.fov_v_deg]).toEqual([188, 25, 72]);
    expect([h.camera.size, h.camera.sky_rows, h.camera.tile_px]).toEqual([[1280, 720], 330, 16]);
    expect(rec.sky!.measures.method).toMatch(/gap_floor_pct/);
    expect(h.gap_floor_pct, 'tiles at the gap floor (%)').toBeLessThanOrEqual(25);
    expect(h.flat_pct, 'flat tiles (%)').toBeLessThanOrEqual(10);
    expect(h.billow_p90_p10).toBeGreaterThanOrEqual(2.5);
    expect(h.billow_p90_p10).toBeLessThanOrEqual(4.5);
    expect((rec.params as { border: number }).border, 'the product is never a tuning border render').toBe(0);
  });

  it('the zenith is no brighter than the horizon (from the file)', () => {
    const x = exrHeader(readFileSync(join(ROOT, rec.outputs.exr.path)));
    const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(lum(exrRowMean(x, rec.sky!.zenith_rows))).toBeLessThanOrEqual(lum(exrRowMean(x, rec.sky!.horizon_rows)));
  });

  it('the PNG preview matches its receipt and is 2048x1024 8-bit RGB', () => {
    expect(pngSize(checkFacts(rec, 'png'))).toEqual({ width: 2048, height: 1024, depth: 8, colour: 2 });
  });
});

// ------------------------------------------------------------------------------------------------ pass 2 WET
/** An 8-bit RGB, non-interlaced PNG decoded to rows of bytes (IDAT inflate + the five row filters). */
function pngRgb(buf: Buffer): { width: number; height: number; px: Uint8Array } {
  const { width, height, depth, colour } = pngSize(buf);
  expect([depth, colour, buf[28]], 'PNG 8-bit RGB, not interlaced').toEqual([8, 2, 0]);
  const idat: Buffer[] = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
    if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * 3, px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? px[o + i - 3] : 0, b = y ? px[o - stride + i] : 0, c = i >= 3 && y ? px[o - stride + i - 3] : 0;
      let v = row[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + i] = v & 255;
    }
  }
  return { width, height, px };
}

describe('W17 AAA receipts: pass 2 WET mask (assets/lot/lot_wet_mask)', () => {
  const rec = readReceipt('assets/lot/lot_wet_mask.receipt.json') as Receipt & {
    transform: { origin_game_xz: number[]; span_m: number[]; m_per_texel: number; u_axis: string; v_axis: string };
    coverage: Record<'R' | 'G' | 'B', { gt_0_5_pct: number; gt_0_1_pct: number; mean: number }>;
  };
  const lot = JSON.parse(readFileSync(join(ROOT, 'engines/godot/data/the_lot.json'), 'utf8')) as {
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    fences: { x0: number; z0: number; x1: number; z1: number; face: number }[];
  };

  it('carries the licence line, the rebuild command and 16 spp', () => {
    expect(rec.licence).toBe(LICENCE);
    expect(rec.kind).toBe('SOURCE: wet mask');
    expect(rec.rebuild).toMatch(/^"\$BLENDER" --background --factory-startup --python tools\/blender\/wet_mask\.py/);
    expect(rec.render?.spp).toBe(16);
  });

  it('the PNG matches its receipt and is 2048x2048 8-bit RGB', () => {
    expect(pngSize(checkFacts(rec, 'png'))).toEqual({ width: 2048, height: 2048, depth: 8, colour: 2 });
  });

  it('the world -> UV transform is the shared world bounds, not typed (the_lot.json)', () => {
    const b = lot.bounds, t = rec.transform;
    expect(t.origin_game_xz).toEqual([b.minX, b.minZ]);
    expect(t.span_m).toEqual([b.maxX - b.minX, b.maxZ - b.minZ]);
    expect(t.m_per_texel).toBeCloseTo((b.maxX - b.minX) / 2048, 9);
    expect(t.u_axis).toMatch(/\+X/);
    expect(t.v_axis).toMatch(/\+Z/);
  });

  it('every channel has non-trivial coverage (re-derived from the file) and the West Yard is dry', () => {
    const { width, px } = pngRgb(readFileSync(join(ROOT, rec.outputs.png.path)));
    const n = px.length / 3;
    (['R', 'G', 'B'] as const).forEach((ch, k) => {
      let hi = 0, lo = 0;
      for (let i = k; i < px.length; i += 3) { if (px[i] > 127.5) hi++; if (px[i] > 25.5) lo++; }
      const pct = (100 * hi) / n;
      expect(pct, `${ch} % > 0.5 (file) vs receipt`).toBeCloseTo(rec.coverage[ch].gt_0_5_pct, 1);
      expect((100 * lo) / n, `${ch} % > 0.1, non-trivial`).toBeGreaterThan(1);
      expect(pct, `${ch} % > 0.5, not everything`).toBeLessThan(90);
    });
    // the West Yard: the outer side of the west fence run (x = x0, face -1), every channel 0
    const t = rec.transform, fence = lot.fences.find((f) => f.x0 === f.x1 && f.face === -1)!;
    // the last column whose whole cell lies west of the fence line: its east edge, origin + (u + 1) * m_per_texel, <= x0
    const lastCol = Math.floor((fence.x0 - t.origin_game_xz[0]) / t.m_per_texel) - 1;
    expect(t.origin_game_xz[0] + (lastCol + 1) * t.m_per_texel, 'the last yard column ends at or west of the fence').toBeLessThanOrEqual(fence.x0);
    expect(t.origin_game_xz[0] + (lastCol + 2) * t.m_per_texel, 'the next column crosses the fence').toBeGreaterThan(fence.x0);
    expect(lastCol, 'the West Yard strip is on the mask').toBeGreaterThan(5);
    let wet = 0;
    for (let y = 0; y < width; y++) for (let u = 0; u <= lastCol; u++) for (let k = 0; k < 3; k++) wet += px[(y * width + u) * 3 + k];
    expect(wet, 'West Yard texels are all 0 (it stays dirt)').toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ pass 4 BACKDROP
describe('W17 AAA receipts: pass 4 BACKDROP GLB (assets/backdrop/lot_backdrop)', () => {
  const rec = readReceipt('assets/backdrop/lot_backdrop.receipt.json') as Receipt & {
    gltf: { primitives_draws: number; materials: string[] };
    fresh_import: { triangles: number; col_nodes: string[]; min_cheb_m: number };
    rules: { kit_and_lamps_min_cheb_m: number; steel_dist_m: number[]; apron_min_cheb_m: number };
  };

  it('carries the licence line and the rebuild command', () => {
    expect(rec.licence).toBe(LICENCE);
    expect(rec.kind).toBe('BACKDROP: glb');
    expect(rec.rebuild).toMatch(/^"\$BLENDER" --background --factory-startup --python tools\/blender\/backdrop_glb\.py/);
  });

  it('records the weld script that wrote the GLB, and it is the one in the repo', () => {
    const weld = (rec as unknown as { weld: { script: string; script_sha256: string } }).weld;
    expect(weld.script).toBe('tools/blender/glb_weld.mjs');
    expect(weld.script_sha256).toBe(scriptSha(weld.script));
  });

  it('the GLB matches its receipt: <= 8 draws, no COL_ node, every vertex outside 165 m, +Y up, the triangle count', async () => {
    checkFacts(rec, 'glb');
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(join(ROOT, rec.outputs.glb.path));
    const root = doc.getRoot();
    let draws = 0, tris = 0, cheb = Infinity, yMin = Infinity, yMax = -Infinity, apronYMax = 0, apron = 0;
    for (const node of root.listNodes()) {
      expect(node.getName().startsWith('COL_'), `node ${node.getName()}: no collision in a backdrop`).toBe(false);
      const mesh = node.getMesh();
      if (!mesh) continue;
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        draws++;
        const pos = prim.getAttribute('POSITION')!, idx = prim.getIndices();
        tris += (idx ? idx.getCount() : pos.getCount()) / 3;
        const v = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
          const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
          const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
          cheb = Math.min(cheb, Math.max(Math.abs(x), Math.abs(z)));
          yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
          if (Math.max(Math.abs(x), Math.abs(z)) > 1000) { apron++; apronYMax = Math.max(apronYMax, Math.abs(y)); }
        }
      }
    }
    expect(draws, 'draws (primitives)').toBeLessThanOrEqual(8);
    expect(root.listMaterials().length).toBeLessThanOrEqual(8);
    expect(draws).toBe(rec.gltf.primitives_draws);
    expect(cheb, 'nearest vertex, max(|x|, |z|) (m)').toBeGreaterThanOrEqual(165 - 1e-3);
    expect(tris).toBe(rec.fresh_import.triangles);
    expect(tris).toBe((rec.outputs.glb as FileFacts & { triangles: number }).triangles);
    expect(apron, 'the apron reaches past 1 km').toBeGreaterThan(0);
    expect(apronYMax, '+Y up: the apron lies on y = 0').toBeLessThan(0.01);
    expect(yMin, 'nothing far below the ground (lattice ends dip a few cm)').toBeGreaterThan(-0.5);
    expect(yMax, '+Y up: crane tops in metres').toBeGreaterThan(100);
    expect(rec.fresh_import.col_nodes).toEqual([]);
  });

  it('validate-glb --backdrop: the GLB passes with its receipt\'s limits, a broken copy fails on each rule', async () => {
    const glb = join(ROOT, rec.outputs.glb.path), lim = backdropLimits(join(ROOT, 'assets/backdrop/lot_backdrop.receipt.json'));
    expect(lim).toEqual({ minDist: 165, maxDraws: 8 });
    const ok = await validateBackdrop(glb, lim);
    expect(ok.errors).toEqual([]);
    expect([ok.report.draws, ok.report.triangles]).toEqual([rec.gltf.primitives_draws, rec.fresh_import.triangles]);
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glb);
    const top = doc.getRoot().listScenes()[0].listChildren()[0];
    top.setName('Lot_Backdrop');                                                       // breaks Backdrop_<Set>_<NN>
    const pipe = doc.getRoot().listNodes().find((n) => n.getName() === 'BD_Pipe_01')!;
    pipe.setName('COL_Pipe');                                                          // a collision node
    const lamp = doc.getRoot().listNodes().find((n) => n.getName() === 'BD_SodiumLamp')!;
    lamp.setTranslation([0, 0, 0]).setScale([0.1, 1, 0.1]);                            // drawn inside the radius
    const extra = doc.createNode('BD_Extra').setMesh(doc.createMesh('BD_Extra').addPrimitive(lamp.getMesh()!.listPrimitives()[0].clone()));
    top.addChild(extra);                                                               // a ninth draw
    const bad = await validateBackdrop(glb, { ...lim, doc, bytes: 1 });
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e) => e.includes('breaks Backdrop_<Set>_<NN>'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('"COL_Pipe": a backdrop has no collision'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('inside the 165 m radius'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('9 draws (primitives) > 8'))).toBe(true);
  });

  it('the build kept its distance rules (kit pieces and lamps >= 216 m, cranes and gantries 400-900 m)', () => {
    expect(rec.rules.kit_and_lamps_min_cheb_m).toBeGreaterThanOrEqual(216);
    expect(rec.rules.steel_dist_m[0]).toBeGreaterThanOrEqual(400);
    expect(rec.rules.steel_dist_m[1]).toBeLessThanOrEqual(900);
    expect(rec.rules.apron_min_cheb_m).toBeGreaterThanOrEqual(165);
  });
});

// ------------------------------------------------------------------------------------------------ pass 4 SPLAT (baked)
describe('W17 AAA receipts: pass 4 SPLAT, baked UNTRAINED (assets/backdrop/lot_backdrop_untrained)', () => {
  const RP = 'assets/backdrop/lot_backdrop_untrained.receipt.json';
  const rec = readReceipt(RP) as Receipt & {
    label: string; fine_tune: string; limits: { splats_max: number; bytes_max: number; min_cheb_m: number };
    stats: { kept: number; min_cheb_m: number }; samples: unknown[];
    training_set: { views: number; views_used_for_colour: number; size: number[]; spp: number };
  };
  const spz = rec.outputs.spz as FileFacts & { splats: number; version: number; sh_degree: number; label: string };

  it('is labelled UNTRAINED, carries the licence line and the rebuild command, and was never fine-tuned', () => {
    expect(rec.licence).toBe(LICENCE);
    expect(rec.label).toBe('UNTRAINED');
    expect(spz.label).toBe('UNTRAINED');
    expect(rec.kind).toBe('SPLAT: baked, UNTRAINED');
    expect(rec.rebuild).toMatch(/^"\$BLENDER" --background --factory-startup --python tools\/splat\/bake_splat\.py/);
    expect(rec.fine_tune).toMatch(/^NOT RUN/);
    const ts = rec.training_set as typeof rec.training_set & { splat_set_script: string; splat_set_script_sha256: string; rendered_by_script_sha256: string; path_scratch: string };
    expect(ts.splat_set_script).toBe('tools/blender/splat_set.py');
    expect(ts.splat_set_script_sha256, 'splat_set.py is the one in the repo').toBe(scriptSha(ts.splat_set_script));
    expect(ts.rendered_by_script_sha256, 'the training set was rendered by that splat_set.py').toBe(ts.splat_set_script_sha256);
    expect(ts.path_scratch).toMatch(/^<scratch>\//);
    expect(rec.training_set.views).toBe(150);
    expect(rec.training_set.size).toEqual([768, 432]);
    expect(rec.training_set.spp).toBe(32);
  });

  it('the .spz matches its receipt: <= 300k splats, <= 15 MB, SPZ v3, SH degree 0, limits no looser than the card', () => {
    const buf = checkFacts(rec, 'spz');
    expect(buf.length).toBeLessThanOrEqual(15 * 1000 * 1000);
    expect(spz.splats).toBeGreaterThan(0);
    expect(spz.splats).toBeLessThanOrEqual(300000);
    expect([spz.version, spz.sh_degree]).toEqual([3, 0]);
    expect(rec.limits.splats_max).toBeLessThanOrEqual(SPLAT.splatsMax);
    expect(rec.limits.bytes_max).toBeLessThanOrEqual(SPLAT.bytesMax);
    expect(rec.limits.min_cheb_m).toBeGreaterThanOrEqual(165);
    expect(rec.stats.kept).toBe(spz.splats);
    const raw = gunzipSync(buf);                                                   // the header, read directly
    expect([raw.readUInt32LE(0), raw.readUInt32LE(4), raw.readUInt32LE(8), raw[12]]).toEqual([0x5053474e, 3, spz.splats, 0]);
  });

  it('three\'s SPZLoader parses it: count, nothing inside 165 m, finite, and every sample splat decodes as the bake says', () => {
    const r = checkSpz(join(ROOT, spz.path), { receipt: join(ROOT, RP) });
    expect(r.errors).toEqual([]);
    expect(r.splats).toBe(spz.splats);
    expect(r.minChebM, 'nearest splat centre, max(|x|, |z|) (m)').toBeGreaterThanOrEqual(165);
    expect(r.samplesChecked).toBe(rec.samples.length);
    expect(r.samplesChecked).toBeGreaterThanOrEqual(8);
  });

  it('spz_check bites: a copy with one splat moved into the Lot fails on the crop and on the hash', () => {
    const raw = Buffer.from(gunzipSync(readFileSync(join(ROOT, spz.path))));
    raw.fill(0, 16, 16 + 9);                                                       // splat 0's centre -> (0, 0, 0)
    const dir = mkdtempSync(join(tmpdir(), 'spz-break-'));
    try {
      const bad = join(dir, 'broken.spz');
      writeFileSync(bad, gzipSync(raw));
      const r = checkSpz(bad, { receipt: join(ROOT, RP) });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.includes('inside the crop'))).toBe(true);
      expect(r.errors.some((e) => e.startsWith('sha256'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
