// W12 G-WORLD: the Godot game builds The Lot from engines/godot/data/the_lot.json + the_lot_heights.bin. This guard
// fails when either committed file differs from a fresh export of buildTheLot() (tools/godot/export-lot.mjs), so the
// Godot world cannot drift from the web game and the sim. Fix: npx tsx tools/godot/export-lot.mjs
// It also pins what the Godot side relies on: the kit placements equal the web's ?kit=glb split, the slab stands on
// flat, clear, dry ground midway between the bases, and every spawn team has 16 points.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BIN_NAME, exportLot, JSON_NAME, LOT_SEED, OUT_DIR } from '../../tools/godot/export-lot.mjs';
import { buildTheLot } from '../../src/shared/world/the-lot';
import { splitLotKitPrims } from '../../src/client/assets/kit-glb';

describe('W12 Godot Lot data', () => {
  const fresh = exportLot();
  const lot = JSON.parse(fresh.json);

  it('the committed JSON and heights equal a fresh export (seed 1)', () => {
    expect(LOT_SEED).toBe(1);
    expect(readFileSync(`${OUT_DIR}/${JSON_NAME}`, 'utf8') === fresh.json, 'the_lot.json drifted: npx tsx tools/godot/export-lot.mjs').toBe(true);
    expect(Buffer.compare(readFileSync(`${OUT_DIR}/${BIN_NAME}`), fresh.bin), 'the_lot_heights.bin drifted').toBe(0);
  });

  it('carries the sim heightfield byte for byte and the web kit placements', () => {
    const d = buildTheLot(LOT_SEED);
    const g = d.terrain!;
    expect([lot.terrain.x0, lot.terrain.z0, lot.terrain.cell, lot.terrain.n]).toEqual([g.x0, g.z0, g.cell, g.n]);
    expect(new Float32Array(fresh.bin.buffer, fresh.bin.byteOffset, fresh.bin.byteLength / 4)).toEqual(g.heights);
    const split = splitLotKitPrims(d);
    expect(lot.kit.map((k: { name: string }) => k.name)).toEqual(split.pieces.map((p) => p.piece.name));
    expect(lot.kit.map((k: { placements: unknown[] }) => k.placements.length)).toEqual([2, 16, 8, 6, 4, 16]);
    for (const [i, p] of split.pieces.entries()) {
      expect(p.missing).toBe(0);
      p.placements.forEach((q, j) => {
        const r = lot.kit[i].placements[j];
        expect(Math.hypot(r[0] - q.x, r[1] - q.y, r[2] - q.z)).toBeLessThan(1e-4);
        expect(Math.abs(r[3] - q.yaw)).toBeLessThan(1e-5);
      });
    }
    // every prim is drawn once: the rest, or a piece's fallback
    const drawn = lot.prims.length + lot.kit.reduce((n: number, k: { fallbackPrims: unknown[] }) => n + k.fallbackPrims.length, 0);
    expect(drawn).toBe(d.prims!.length);
    expect(lot.colliders.boxes.length).toBe(d.props.length);
    expect(lot.colliders.cylinders.length).toBe(d.cylinders!.length);
    expect([lot.spawns[0].length, lot.spawns[1].length]).toEqual([16, 16]);
  });

  it('the slab is flat, dry and clear, and equally far from both teams', () => {
    const d = buildTheLot(LOT_SEED);
    const [cx, cy, cz] = lot.slab.center;
    const [sx, sz] = lot.slab.size;
    expect(cy).toBeCloseTo(d.height(cx, cz), 4);
    expect(lot.slab.groundMax - lot.slab.groundMin).toBeLessThan(0.3);
    const inside = (x: number, z: number, pad: number) => Math.abs(x - cx) < sx / 2 + pad && Math.abs(z - cz) < sz / 2 + pad;
    // no collider footprint (its bounding circle) and no prim reaches the slab; no water covers it
    for (const b of d.props) expect(inside(b.x, b.z, Math.hypot(b.hx, b.hz)) && Math.hypot(b.hx, b.hz) < 100, `${b.type}`).toBe(false);
    for (const c of d.cylinders!) expect(inside(c.x, c.z, c.r), c.type).toBe(false);
    for (const q of d.prims!) expect(inside(q.x, q.z, 0.5), q.col).toBe(false);
    for (const w of d.water!) expect(Math.abs(w.x - cx) < sx / 2 + (w.hx ?? 0) && Math.abs(w.z - cz) < sz / 2 + (w.hz ?? 0), w.id).toBe(false);
    const mean = (t: 0 | 1) => { const s = d.spawns.filter((p) => p.team === t); return s.reduce((a, p) => a + Math.hypot(p.x - cx, p.z - cz), 0) / s.length; };
    expect(Math.abs(mean(0) - mean(1))).toBeLessThan(0.01);
  });
});
