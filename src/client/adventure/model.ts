// Pure client-side adventure logic (no three, no DOM): what the adventure beacon says (snapshot convention in
// src/shared/content/chapters.ts), and the caption timeline. Presentation only — the authority decides everything.
import type { EntityState } from '../../shared/protocol';
import { EFlag, EntityKind } from '../../shared/types';
import { setActiveAdventureChain } from '../../shared/content/objectives';
import {
  ADVENTURE_CHAIN_INDEX, ADVENTURE_PHASES, chapterByIndex, chapterChain, medalFor, type AdventurePhase, type ChapterDef, type ChapterStep, type Medal,
} from '../../shared/content/chapters';

export interface AdventureView {
  beacon: number;
  chapter: ChapterDef;
  phase: AdventurePhase;
  /** -1 briefing · 0..n-1 · n = complete. */
  step: number;
  stepDef: ChapterStep | null;
  /** 0..1 */
  progress: number;
  /** The current step is a stealth step and its alarm is not up (sentry cones show). */
  sneaking: boolean;
  /** The current stealth step's alarm is up. */
  alarm: boolean;
  /** Result (phase complete): chapter time and par (s), medal. */
  time: number;
  par: number;
  medal: Medal | null;
  x: number; y: number; z: number;
}

/** The running adventure as the snapshot shows it (null = no adventure beacon in view). */
export function readAdventure(states: ReadonlyMap<number, EntityState>): AdventureView | null {
  for (const s of states.values()) {
    if (s.kind !== EntityKind.Prop || s.cls !== ADVENTURE_CHAIN_INDEX) continue;
    const chapter = chapterByIndex(s.seed);
    if (!chapter) continue;
    const phase: AdventurePhase = (ADVENTURE_PHASES as readonly AdventurePhase[])[s.anim] ?? 'live';
    const n = chapter.steps.length;
    const step = phase === 'complete' ? n : s.weapon;
    const stepDef = step >= 0 && step < n ? chapter.steps[step] : null;
    const busy = (s.flags & EFlag.Busy) !== 0;
    const alarm = !!stepDef?.stealth && busy;
    const complete = phase === 'complete';
    return {
      beacon: s.id, chapter, phase, step, stepDef, progress: Math.max(0, Math.min(1, s.ammo / 100)),
      sneaking: phase === 'live' && !!stepDef?.stealth && !busy, alarm,
      time: complete ? s.hp : 0, par: complete ? s.maxHp : chapter.par, medal: complete ? medalFor(s.hp, s.maxHp || chapter.par) : null,
      x: s.x, y: s.y, z: s.z,
    };
  }
  return null;
}

let shown: ChapterDef | null = null;
/**
 * Point S1's objective chain slot at the running chapter so the existing beacon view, E prompt and mission card follow
 * its steps (call before those sync each frame). Null clears it.
 */
export function syncAdventureChain(view: AdventureView | null): void {
  const def = view?.chapter ?? null;
  if (def === shown) return;
  shown = def;
  setActiveAdventureChain(def ? chapterChain(def) : null);
}

/** Seconds each caption line gets before the next one pops in. */
export const CAPTION_LINE_SECONDS = 2.2;

/** How many caption lines are visible `elapsed` seconds after the panel opened (the first shows at once). */
export function captionLinesShown(lineCount: number, elapsed: number, perLine = CAPTION_LINE_SECONDS): number {
  return Math.max(0, Math.min(lineCount, 1 + Math.floor(Math.max(0, elapsed) / perLine)));
}

/** Seconds the outro captions play before the chapter-complete card slides in. */
export function outroSeconds(lineCount: number, perLine = CAPTION_LINE_SECONDS): number {
  return lineCount * perLine + 0.8;
}

/** "1:48.2" */
export function fmtClock(s: number, tenths = true): string {
  const t = tenths ? Math.floor(Math.max(0, s) * 10 + 1e-6) / 10 : Math.max(0, s);
  const m = Math.floor(t / 60), r = t - m * 60;
  return tenths ? `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}` : `${m}:${String(Math.floor(r)).padStart(2, '0')}`;
}
