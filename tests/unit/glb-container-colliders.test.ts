// W11 P-GLB1: the shared GLB's COL_ boxes are the sim's container colliders. The authority never reads a GLB: the
// Lot's containers collide through src/shared world data (props.ts container()); this proves the GLB that ?kit=glb
// draws stands exactly where that collision is (every box within 1 cm, both placements, master and web variant).
import { describe, expect, it } from 'vitest';
import { createWorldData } from '../../src/shared/world/world-data';
import type { PropBox } from '../../src/shared/world/world-types';
import { KIT_CONTAINER, kitFlag, kitLodFor, lotContainerPlacements, splitContainerPrims } from '../../src/client/assets/kit-glb';
import { colliderBoxes, createIO } from '../../tools/assets/validate-glb.mjs';

const MASTER = `assets/masters/${KIT_CONTAINER}.glb`;
const WEB = `public/assets/kits/${KIT_CONTAINER}.glb`;
const TOL = 0.01;

interface Box { center: number[]; half: number[] }

async function glbBoxes(path: string): Promise<Box[]> {
  const io = await createIO();
  return colliderBoxes(await io.read(path));
}

/** Kit-local box -> world at a placement (yaw 0 or pi about +Y; Frame.w's convention). */
function place(b: Box, p: { x: number; y: number; z: number; yaw: number }): Box {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const [lx, ly, lz] = b.center;
  return { center: [p.x + lx * c + lz * s, p.y + ly, p.z - lx * s + lz * c], half: b.half };
}

const near = (a: number[], b: number[]) => a.every((v, k) => Math.abs(v - b[k]) <= TOL);

describe('P-GLB1 Kit_Lot_Container20_01 COL_ = sim colliders', () => {
  for (const seed of [1, 7]) {
    const data = createWorldData(seed, 'the_lot');
    const placements = lotContainerPlacements(data);

    it(`seed ${seed}: two placements from the world data (c_west yaw 0, c_east yaw pi)`, () => {
      expect(placements.map((p) => p.id)).toEqual(['c_west', 'c_east']);
      expect(placements[0].yaw).toBe(0);
      expect(placements[1].yaw).toBeCloseTo(Math.PI, 9);
    });

    for (const [label, path] of [['master', MASTER], ['web', WEB]] as const) {
      it(`seed ${seed}: ${label} GLB boxes match every container collider within 1 cm`, async () => {
        const boxes = await glbBoxes(path);
        expect(boxes.length).toBe(13);
        for (const p of placements) {
          const sim = data.props.filter((b: PropBox) => b.type.startsWith('container_') && Math.abs(b.x - p.x) < 7 && Math.abs(b.z - p.z) < 14);
          expect(sim.length, `${p.id} sim colliders`).toBe(13);
          for (const b of sim) expect(b.rotY ?? 0).toBe(0);
          const unused = new Set(sim);
          for (const g of boxes.map((b) => place(b, p))) {
            const hit = [...unused].find((b) => near(g.center, [b.x, b.y, b.z]) && near(g.half, [b.hx, b.hy, b.hz]));
            expect(hit, `${p.id}: GLB box at ${g.center.map((v) => v.toFixed(3))} half ${g.half.map((v) => v.toFixed(3))}`).toBeTruthy();
            unused.delete(hit!);
          }
          expect(unused.size).toBe(0);
        }
      });
    }
  }
});

describe('P-GLB1 ?kit=glb client helpers', () => {
  it('the flag is off by default; kit=glb picks pbr, kitlook=stylize the toon side', () => {
    expect(kitFlag('')).toBeNull();
    expect(kitFlag('?webgl&kit=procedural')).toBeNull();
    expect(kitFlag('?kit=glb')).toBe('pbr');
    expect(kitFlag('?kit=glb&kitlook=stylize')).toBe('stylize');
  });

  it('splitContainerPrims removes exactly the procedural containers (every rebuilt prim found, nothing else)', () => {
    const data = createWorldData(1, 'the_lot');
    const split = splitContainerPrims(data);
    expect(split.missing).toBe(0);
    expect(split.containers.length).toBeGreaterThan(100);
    expect(split.rest.length + split.containers.length).toBe(data.prims!.length);
    // the pallet cover inside the containers stays procedural
    expect(split.rest.some((q) => Math.abs(q.x + 97.3) < 1.5 && Math.abs(q.z + 36.5) < 1.5)).toBe(true);
  });

  it('the West Yard has no containers: nothing to split', () => {
    const split = splitContainerPrims(createWorldData(1, 'west_yard'));
    expect(split.placements.length).toBe(0);
    expect(split.containers.length).toBe(0);
  });

  it('LOD by camera distance', () => {
    expect([10, 69.9, 70, 159.9, 160, 400].map(kitLodFor)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});
