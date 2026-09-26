// OWNER: adventure lane (A1). Client presentation of the adventure mode: the DOM overlay (captions, barks, the
// squad-down beat, the chapter-complete card), the 3D views (sentry cones, collect items) and device progress.
// Wiring (main.ts): see docs/handoff/A1.md §3.
export { createAdventureHud, pawSvg, type AdventureHud, type AdventureHudOptions } from './hud';
export { createAdventureViews, CONE_RANGE, CONE_CLOSE, type AdventureViews } from './views';
export { readAdventure, syncAdventureChain, captionLinesShown, fmtClock, type AdventureView } from './model';
export { loadProgress, saveProgress, recordCompletion, withCompletion, isUnlocked, PROGRESS_KEY, type AdventureProgress } from './progress';
