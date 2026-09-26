// OWNER: adventure lane (A1). Mode `adventure`: chapter data (src/shared/content/chapters.ts) run as ordered steps
// with spawns, the stealth alarm, checkpoints and fail forward, folded into MatchState and S1's beacon. Bots follow
// the steps through src/sim/ai/tactics.ts. Handoff and the A2 guide: docs/handoff/A1.md.
export { adventureSystems, adventureSetupSystem, adventureSystem, loadChapter, restartAtCheckpoint, adventureText } from './runner';
export { registerAdventureSpawner, knownAdventureArchetype, sentryRoute, type AdventureSpawner } from './spawns';
export {
  adventureState, adventureRuntime, adventureConfig, adventureChapter, adventureStep, adventureItems, adventureTargets,
  isAdventureMode, isSquad, squadOf, squadHasHuman, setDestructibleProbe, readDestructible, defaultDestructibleProbe,
  registerCheckpointHook, type CheckpointHook,
  type AdventureState, type AdventureConfig, type AdventureTag, type DestructibleInfo, type DestructibleProbe,
} from './state';
