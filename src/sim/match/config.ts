// Match mode rules as data. Tests and soaks may override any field through
// sim.state.matchConfig = { skirmish?: Partial<SkirmishConfig>, tdm?: Partial<TdmConfig> } before the first tick.
import type { ArchetypeId } from '../ai/archetypes';

export interface WaveDef {
  /** Enemy counts for a squad of two corgis (scaled by squad size). */
  counts: Partial<Record<ArchetypeId, number>>;
  /** HUD label override (e.g. the big final wave). */
  label?: string;
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
    { counts: { grunt: 4 } },
    { counts: { grunt: 4, kitten: 3 } },
    { counts: { grunt: 4, sniper: 1, kitten: 4 } },
    { counts: { grunt: 5, sniper: 2, brute: 1, kitten: 4 } },
    { counts: { grunt: 6, sniper: 2, brute: 2, kitten: 6 }, label: 'FINAL WAVE' },
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
