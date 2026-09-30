// OWNER: adventure lane (A1). Mode `adventure`: chapter data (src/shared/content/chapters.ts) run as ordered steps
// with spawns, the stealth alarm, checkpoints and fail forward, folded into MatchState and S1's beacon. Bots follow
// the steps through src/sim/ai/tactics.ts. Handoff and the A2 guide: docs/handoff/A1.md. A2 (chapters 3–6,
// docs/handoff/A2.md): props.ts (pup kits, parked vehicles, barricades), the height rules and the fail-forward grace.
export {
  adventureSystems, adventureSetupSystem, adventureSystem, loadChapter, restartAtCheckpoint, adventureText,
  chapterFitsSim, chapterForSim, chapterAfterOnMap, // W10 A7: a sim plays only its own map's chapters
} from './runner';
export { registerAdventureSpawner, knownAdventureArchetype, sentryRoute, type AdventureSpawner } from './spawns';
export {
  adventureState, adventureRuntime, adventureConfig, adventureChapter, adventureStep, adventureItems, adventureTargets,
  isAdventureMode, isSquad, squadOf, squadHasHuman, setDestructibleProbe, readDestructible, defaultDestructibleProbe,
  registerCheckpointHook, type CheckpointHook,
  type AdventureState, type AdventureConfig, type AdventureTag, type DestructibleInfo, type DestructibleProbe,
} from './state';
