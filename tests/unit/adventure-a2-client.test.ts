// A2 client: chapters 3–6 reach the client through the same channels as 1–2 (the beacon's chapter index, S1's chain
// slot for the mission card and the E prompt, the picker's unlocks), and the last tennis ball draws as its own toon
// model (fuzzy yellow-green ball + white seam, style materials only) instead of the generic bundle.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import type { EntityState } from '../../src/shared/protocol';
import { Anim, EFlag, EntityKind, Team } from '../../src/shared/types';
import {
  ADVENTURE_CHAIN_INDEX, ADVENTURE_ITEM_IDS, ADVENTURE_ITEM_SEED, CHAPTERS, chapterById, chapterChain, nextChapter,
} from '../../src/shared/content/chapters';
import { readAdventure, createAdventureViews, withCompletion, isUnlocked } from '../../src/client/adventure';
import { PALETTE } from '../../src/client/style/style-tokens.js';

function st(p: Partial<EntityState>): EntityState {
  return { id: 1, kind: EntityKind.Player, team: Team.Corgis, species: 0, cls: 0, seed: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 100, maxHp: 100, anim: Anim.Idle, flags: EFlag.Grounded, weapon: 0, ammo: 0, ...p };
}
const map = (...s: EntityState[]) => new Map(s.map((x) => [x.id, x]));
const beacon = (p: Partial<EntityState>) => st({ id: 50, kind: EntityKind.Prop, cls: ADVENTURE_CHAIN_INDEX, seed: 1, hp: 0, maxHp: 0, flags: 0, anim: 1, weapon: 0, ...p });

describe('chapters 3–6 on the client', () => {
  it('the beacon names each chapter; the mission card chain keeps the E prompts; completing one unlocks the next', () => {
    for (const id of ['garage_job', 'laser_dawn', 'porch_siege', 'last_ball']) {
      const def = chapterById(id)!;
      const v = readAdventure(map(beacon({ seed: def.index, weapon: 0 })))!;
      expect(v.chapter.id).toBe(id);
      const chain = chapterChain(def);
      expect(chain.steps.map((s) => s.id)).toEqual(def.steps.map((s) => s.id));
      for (const [i, s] of def.steps.entries()) {
        if (s.trigger.type === 'interact') expect(chain.steps[i].trigger).toMatchObject({ type: 'interact', params: { prompt: s.trigger.params.prompt } });
      }
    }
    expect(CHAPTERS.map((c) => nextChapter(c.id)?.id ?? null)).toEqual(['tall_grass', 'garage_job', 'laser_dawn', 'porch_siege', 'last_ball', null]);
    let p = { unlocked: 1, medals: {} as Record<string, 'gold' | 'silver' | 'bronze'> };
    for (const c of CHAPTERS.slice(0, 4)) p = withCompletion(p, c.id, c.index, 'gold');
    expect([isUnlocked(p, 5), isUnlocked(p, 6)]).toEqual([true, false]);
    p = withCompletion(p, 'porch_siege', 5, 'silver');
    expect(isUnlocked(p, 6)).toBe(true);
  });
});

describe('the last tennis ball (headless view)', () => {
  it('draws a yellow-green ball with a white seam over its ring (style materials only), on the roof it sits on; dispose', () => {
    const scene = new THREE.Scene();
    const v = createAdventureViews(scene);
    const ball = st({ id: 9, kind: EntityKind.Prop, cls: -1, seed: ADVENTURE_ITEM_SEED, weapon: ADVENTURE_ITEM_IDS.indexOf('tennis_ball'), x: 47, y: 8.2, z: 79.4, flags: 0 });
    v.sync(map(ball), null, 0.016);
    expect(v.stats().items).toBe(1);
    const root = v.group.getObjectByName('adventure_item')!;
    expect(root.position.y).toBeCloseTo(8.2 - 0.45, 5); // the item's ground ring sits on the roof
    const colors: number[] = [];
    let mats = 0;
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as (THREE.Material & { color?: THREE.Color }) | undefined;
      if (!m || (o as unknown as { isLineSegments2?: boolean }).isLineSegments2) return;
      expect(['toon', 'glow']).toContain(m.userData.style);
      if (m.userData.style === 'toon' && m.color) colors.push(m.color.getHex());
      mats++;
    });
    expect(mats).toBe(3); // ball, seam, ring
    expect(colors).toContain(new THREE.Color(PALETTE.tennisBall).getHex());
    expect(colors).toContain(new THREE.Color(PALETTE.catWhite).getHex());
    v.sync(map(), null, 0.016);
    expect(v.stats().items).toBe(0);
    v.dispose();
    expect(scene.children.length).toBe(0);
  });
});
