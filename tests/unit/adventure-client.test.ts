// A1 client: the adventure beacon → the view model, S1's chain slot following the chapter (so the existing beacon,
// E prompt and mission card show chapter steps), device progress in `cvc.adventure` (every access guarded), medals,
// the caption timeline, the menu's default chapter, and a headless sync of the 3D views (sentry cones only while
// sneaking, catnip bags; style materials only).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import type { EntityState } from '../../src/shared/protocol';
import { Anim, EFlag, EntityKind, Team, type AnimId } from '../../src/shared/types';
import { objectiveChainByIndex, OBJECTIVE_CHAINS } from '../../src/shared/content/objectives';
import {
  ADVENTURE_CHAIN_INDEX, ADVENTURE_ITEM_SEED, ADVENTURE_PHASES, CHAPTERS, KIOSK_PROMPT, chapterById, chapterChain, medalFor, nextChapter,
} from '../../src/shared/content/chapters';
import { findInteractTarget, beaconStep } from '../../src/client/interact/targets';
import {
  readAdventure, syncAdventureChain, captionLinesShown, fmtClock, createAdventureViews,
  loadProgress, saveProgress, recordCompletion, withCompletion, isUnlocked, PROGRESS_KEY,
} from '../../src/client/adventure';
import { defaultChapter } from '../../src/client/ui/menu';

function st(p: Partial<EntityState>): EntityState {
  return { id: 1, kind: EntityKind.Player, team: Team.Corgis, species: 0, cls: 0, seed: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 100, maxHp: 100, anim: Anim.Idle, flags: EFlag.Grounded, weapon: 0, ammo: 0, ...p };
}
const map = (...s: EntityState[]) => new Map(s.map((x) => [x.id, x]));
const beacon = (p: Partial<EntityState>) => st({ id: 50, kind: EntityKind.Prop, cls: ADVENTURE_CHAIN_INDEX, seed: 1, hp: 0, maxHp: 0, flags: 0, anim: 1, weapon: 0, ...p });

class MemStore {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

describe('adventure beacon → view model', () => {
  it('reads chapter, phase, step, stealth/alarm and the result from the beacon', () => {
    const yard = chapterById('yard_day')!, grass = chapterById('tall_grass')!;
    expect(readAdventure(map(st({})))).toBeNull();
    const v = readAdventure(map(beacon({ seed: 1, anim: ADVENTURE_PHASES.indexOf('live') as AnimId, weapon: 2, ammo: 50 })))!;
    expect([v.chapter.id, v.phase, v.step, v.stepDef?.id, v.progress]).toEqual(['yard_day', 'live', 2, yard.steps[2].id, 0.5]);
    expect(v.sneaking).toBe(false);
    const sneak = readAdventure(map(beacon({ seed: 2, weapon: 0 })))!;
    expect([sneak.chapter.id, sneak.sneaking, sneak.alarm]).toEqual(['tall_grass', true, false]);
    const loud = readAdventure(map(beacon({ seed: 2, weapon: 0, flags: EFlag.Busy })))!;
    expect([loud.sneaking, loud.alarm]).toEqual([false, true]);
    const done = readAdventure(map(beacon({ seed: 2, anim: ADVENTURE_PHASES.indexOf('complete') as AnimId, weapon: grass.steps.length, hp: 180.4, maxHp: grass.par })))!;
    expect([done.phase, done.step, done.time, done.par, done.medal]).toEqual(['complete', 3, 180.4, grass.par, 'silver']);
    expect(readAdventure(map(beacon({ seed: 42 })))).toBeNull(); // unknown chapter
  });

  it('points S1\'s chain slot at the chapter: beacon view / E prompt / mission card follow its steps', () => {
    const yard = chapterById('yard_day')!;
    syncAdventureChain(null);
    expect(objectiveChainByIndex(ADVENTURE_CHAIN_INDEX)).toBeNull();
    expect(objectiveChainByIndex(0)).toBe(OBJECTIVE_CHAINS.yard_squeaker); // the Squeaker chain is untouched
    syncAdventureChain(readAdventure(map(beacon({ seed: 1, weapon: 3 }))));
    const chain = objectiveChainByIndex(ADVENTURE_CHAIN_INDEX)!;
    expect(chain).toBe(chapterChain(yard));
    expect(chain.title).toBe('CH 1 · YARD DAY');
    expect(chain.steps.map((s) => s.trigger.type)).toEqual(['reach', 'reach', 'reach', 'interact', 'hold']); // kiosk → reach, defeat → ring
    // an interact step in reach: E grabs the Squeaker (the S1 prompt reads the chain)
    const me = st({ id: 1, x: -16, z: 12 });
    const b = beacon({ seed: 1, weapon: 3, x: -16, z: 14 });
    expect(beaconStep(b)?.index).toBe(3);
    expect(findInteractTarget(map(me, b), me)).toMatchObject({ kind: 'objective', verb: 'grab the Squeaker' });
    // the kiosk step: no objective prompt, so E reaches the kiosk (its picker)
    const kioskStep = yard.steps.findIndex((s) => s.trigger.type === 'interact' && s.trigger.params.prompt === KIOSK_PROMPT);
    const at = yard.steps[kioskStep].trigger.params as { x: number; z: number };
    const me2 = st({ id: 1, x: at.x + 1, z: at.z });
    const kiosk = st({ id: 9, kind: EntityKind.Terminal, cls: 1, x: at.x, z: at.z });
    expect(findInteractTarget(map(me2, beacon({ seed: 1, weapon: kioskStep, x: at.x, z: at.z }), kiosk), me2)).toMatchObject({ kind: 'ordnance', verb: 'change kit' });
    syncAdventureChain(null);
    expect(objectiveChainByIndex(ADVENTURE_CHAIN_INDEX)).toBeNull();
  });
});

describe('adventure progress (localStorage cvc.adventure)', () => {
  it('fresh start, completion unlocks the next chapter, best paw kept, junk and throwing storage are harmless', () => {
    const mem = new MemStore();
    expect(loadProgress(mem)).toEqual({ unlocked: 1, medals: {} });
    expect(isUnlocked(loadProgress(mem), 2)).toBe(false);
    const a = recordCompletion('yard_day', 1, 'silver', mem);
    expect(a).toEqual({ progress: { unlocked: 2, medals: { yard_day: 'silver' } }, newBest: true });
    expect(JSON.parse(mem.getItem(PROGRESS_KEY)!)).toEqual({ unlocked: 2, medals: { yard_day: 'silver' } });
    expect(recordCompletion('yard_day', 1, 'bronze', mem).newBest).toBe(false); // worse: kept silver
    expect(loadProgress(mem).medals.yard_day).toBe('silver');
    expect(recordCompletion('yard_day', 1, 'gold', mem).progress.medals.yard_day).toBe('gold');
    expect(withCompletion({ unlocked: 6, medals: {} }, 'last_ball', 6, 'gold').unlocked).toBe(6); // capped at six
    for (const junk of ['{', '"x"', '{"unlocked":"9","medals":[1]}', '{"unlocked":99,"medals":{"yard_day":"platinum","nope":"gold"}}']) {
      mem.setItem(PROGRESS_KEY, junk);
      const p = loadProgress(mem);
      expect(p.medals).toEqual({});
      expect(p.unlocked).toBeGreaterThanOrEqual(1);
      expect(p.unlocked).toBeLessThanOrEqual(6);
    }
    const boom = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadProgress(boom)).toEqual({ unlocked: 1, medals: {} });
    expect(saveProgress({ unlocked: 2, medals: {} }, boom)).toBe(false);
    expect(recordCompletion('yard_day', 1, 'gold', boom).progress.unlocked).toBe(2);
    expect(loadProgress(null)).toEqual({ unlocked: 1, medals: {} });
  });

  it('medals by par; the menu starts on the furthest unlocked playable chapter', () => {
    expect([medalFor(100, 120), medalFor(120, 120), medalFor(170, 120), medalFor(181, 120)]).toEqual(['gold', 'gold', 'silver', 'bronze']);
    expect(defaultChapter({ unlocked: 1, medals: {} }).id).toBe('yard_day');
    expect(defaultChapter({ unlocked: 2, medals: {} }).id).toBe('tall_grass');
    expect(defaultChapter({ unlocked: 6, medals: {} }).id).toBe(CHAPTERS[CHAPTERS.length - 1].id); // 3–6 not playable yet
    expect(nextChapter('yard_day')?.id).toBe('tall_grass');
  });
});

describe('captions', () => {
  it('lines pop in one by one; clock formatting', () => {
    expect([0, 1, 2.3, 4.5, 99].map((t) => captionLinesShown(3, t))).toEqual([1, 1, 2, 3, 3]);
    expect(captionLinesShown(0, 5)).toBe(0);
    expect([fmtClock(108.24), fmtClock(59.96), fmtClock(5), fmtClock(120, false)]).toEqual(['1:48.2', '0:59.9', '0:05.0', '2:00']);
  });
});

describe('adventure views (headless)', () => {
  it('sentry cones only while sneaking (red when alerted), catnip bags from item props, style materials only, dispose', () => {
    const scene = new THREE.Scene();
    const v = createAdventureViews(scene);
    const cat = st({ id: 7, kind: EntityKind.Bot, team: Team.Cats, x: 5, z: 5, yaw: 1 });
    const bag = st({ id: 8, kind: EntityKind.Prop, cls: -1, seed: ADVENTURE_ITEM_SEED, weapon: 0, x: 1, y: 0.45, z: 2 });
    const sneaking = readAdventure(map(beacon({ seed: 2, weapon: 0 })));
    v.sync(map(cat, bag), sneaking, 0.016);
    expect(v.stats()).toEqual({ cones: 1, items: 1 });
    let mats = 0;
    v.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!m || (o as unknown as { isLineSegments2?: boolean }).isLineSegments2) return;
      expect(['toon', 'glow']).toContain(m.userData.style);
      mats++;
    });
    expect(mats).toBeGreaterThan(5);
    const cone = v.group.getObjectByName('sentry_cone') as THREE.Mesh;
    expect(cone.rotation.y).toBe(1);
    const calm = cone.material;
    v.sync(map({ ...cat, flags: EFlag.Alerted }, bag), sneaking, 0.016);
    expect(cone.material).not.toBe(calm);
    v.sync(map(cat, bag), readAdventure(map(beacon({ seed: 2, weapon: 0, flags: EFlag.Busy }))), 0.016); // alarm up
    expect(v.stats().cones).toBe(0);
    v.sync(map(cat), readAdventure(map(beacon({ seed: 1, weapon: 0 }))), 0.016); // bag taken, not a stealth step
    expect(v.stats()).toEqual({ cones: 0, items: 0 });
    v.dispose();
    expect(scene.children.length).toBe(0);
  });
});
