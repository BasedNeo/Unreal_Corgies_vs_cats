// Match mode rules as data. Tests and soaks may override any field through
// sim.state.matchConfig = { skirmish?: Partial<SkirmishConfig>, tdm?: Partial<TdmConfig> } before the first tick.
import type { ArchetypeId } from '../ai/archetypes';

export interface WaveDef {
  /** Enemy counts for a squad of two corgis (scaled by squad size). */
  counts: Partial<Record<ArchetypeId, number>>;
  /** HUD label override (e.g. the big final wave). */
  label?: string;
  /** B1 hook: a boss (BOSSES id) joins this wave; it holds the wave open and its defeat clears it. */
  boss?: string;
  /** Alive cap for this wave (overrides SkirmishConfig.maxAlive) — keeps the opening waves learnable. */
  maxAlive?: number;
}

export interface SkirmishConfig {
  warmup: number;
  /** Break between waves (s). */
  intermission: number;
  /** Seconds the result stays up before the match restarts. */
  endedHold: number;
  waves: WaveDef[];
  /** Most wave enemies alive at once (the rest trickle in as others fall). */
  maxAlive: number;
  /** Seconds between spawn batches and enemies per batch. */
  spawnInterval: number;
  spawnBatch: number;
  /** Team wipes forgiven before the match is lost (generous co-op: a solo player can fall twice). */
  wipeLives: number;
  /** Points for the corgis per wave cleared. */
  waveBonus: number;
  /** Squad-size scaling: counts × clamp(base + perCorgi × corgis, min, max). */
  scaleBase: number;
  scalePerCorgi: number;
  scaleMin: number;
  scaleMax: number;
}

export interface TdmConfig {
  warmup: number;
  /** Match length (s). */
  timeLimit: number;
  /** First team to this many kills wins. */
  killLimit: number;
  endedHold: number;
}

export const SKIRMISH: SkirmishConfig = {
  warmup: 5,
  intermission: 7,
  endedHold: 12,
  waves: [
    // opening waves trickle in (few alive at once) so a new player learns to fight one or two cats at a time
    { counts: { grunt: 3 }, maxAlive: 2 },
    // W9 K3 squads, one new answer per wave: the alley-cat raiders (flankers) debut in wave 2 in place of a grunt and a
    // kitten, the tabby heavy (shield-bearer) in wave 3 in place of a grunt and a kitten; wave 4 fields both; the
    // finale keeps a light escort. Every wave is the same size or smaller (qa-difficulty band: docs/handoff/K3.md).
    // Pre-K3: [grunt 3] · [grunt 4, kitten 2] · [grunt 4, sniper 1, kitten 4] · [grunt 5, sniper 2, brute 1, kitten 4] ·
    // [grunt 3, kitten 3 + boss].
    { counts: { grunt: 3, alley_raider: 2, kitten: 1 }, maxAlive: 4 },
    { counts: { grunt: 3, tabby_heavy: 1, sniper: 1, kitten: 3 } },
    { counts: { grunt: 3, alley_raider: 2, tabby_heavy: 1, sniper: 2, brute: 1, kitten: 2 } },
    // finale: the Vac-Tank (B1) with a light escort (the old final wave was 6 grunts, 2 snipers, 2 brutes, 6 kittens)
    { counts: { grunt: 2, alley_raider: 2, kitten: 2 }, label: 'FINAL WAVE', boss: 'vac_tank' },
  ],
  maxAlive: 10,
  spawnInterval: 1.6,
  spawnBatch: 3,
  wipeLives: 2,
  waveBonus: 5,
  scaleBase: 0.6,
  scalePerCorgi: 0.2,
  scaleMin: 0.8,
  scaleMax: 1.8,
};

export const TDM: TdmConfig = {
  warmup: 5,
  timeLimit: 480,
  killLimit: 30,
  endedHold: 10,
};

export interface MatchConfigOverrides {
  skirmish?: Partial<SkirmishConfig>;
  tdm?: Partial<TdmConfig>;
}
