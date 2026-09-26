import { describe, expect, it } from 'vitest';
import { counterFirst, objectiveForTeam, scoreboardMeta } from '../../src/client/ui/objective';

describe('objectiveForTeam', () => {
  it('leaves corgis and team deathmatch untouched', () => {
    expect(objectiveForTeam('Defend the yard! Cats attack in 4', 'yard-skirmish', 0)).toBe('Defend the yard! Cats attack in 4');
    expect(objectiveForTeam('Team Deathmatch — first to 30', 'team-deathmatch', 1)).toBe('Team Deathmatch — first to 30');
  });

  it('rewrites the skirmish lines for a cat', () => {
    const cat = (t: string) => objectiveForTeam(t, 'yard-skirmish', 1);
    expect(cat('Defend the yard! Cats attack in 4')).toBe('Raid the yard! Attack in 4');
    expect(cat('Wave 2/5 — 7 cats left')).toBe('Wave 2/5 — take down the corgi squad (7 cats in the raid)');
    expect(cat('FINAL WAVE (5/5) — 1 cat left')).toBe('FINAL WAVE (5/5) — take down the corgi squad (1 cat in the raid)');
    expect(cat('Wave 3 cleared! Wave 4 in 6')).toBe('Wave 3 beaten back. Regroup: wave 4 in 6');
    expect(cat('Wave 4 cleared! Wave 5 (FINAL) in 2')).toBe('Wave 4 beaten back. Regroup: wave 5 (FINAL) in 2');
    expect(cat('Squad down! 1 retry left · 6 cats left')).toBe('Corgi squad wiped! They can regroup 1 more time');
    expect(cat('Yard secured! The cats retreat.')).toBe('The corgis held the yard. Retreat!');
    expect(cat('The cats took the yard! (wave 3/5)')).toBe('The cats took the yard! (wave 3/5)');
  });
});

describe('objectiveForTeam with the S1 mission fold', () => {
  it('the banner drops the mission step (the mission card shows it) and maps the base line for cats', () => {
    const folded = 'Wave 2/5 — 6 cats left · ▶ Hold the trampoline 12/20s (2/3)';
    expect(objectiveForTeam(folded, 'yard-skirmish', 0)).toBe('Wave 2/5 — 6 cats left');
    expect(objectiveForTeam(folded, 'yard-skirmish', 1)).toBe('Wave 2/5 — take down the corgi squad (6 cats in the raid)');
  });
});

describe('counterFirst / scoreboardMeta (Q2 P2-7)', () => {
  it('moves a trailing step counter to the front, and leaves other lines alone', () => {
    expect(counterFirst('Sneak through the tall grass to the shed (2/4)')).toBe('(2/4) Sneak through the tall grass to the shed');
    expect(counterFirst('Team Deathmatch — first to 30')).toBe('Team Deathmatch — first to 30');
    expect(counterFirst('The cats took the yard! (wave 3/5)')).toBe('The cats took the yard! (wave 3/5)');
  });

  it('scoreboard header: clock with the HUD rounding, no 0:00 when untimed, STEP in an adventure, FINAL at the end', () => {
    expect(scoreboardMeta({ mode: 'yard-skirmish', phase: 'live', timeLeft: 191.2, wave: 2 })).toBe('YARD SKIRMISH · 3:12 · WAVE 2');
    expect(scoreboardMeta({ mode: 'adventure', phase: 'live', timeLeft: 0, wave: 3 })).toBe('ADVENTURE · STEP 3');
    expect(scoreboardMeta({ mode: 'boss-rush', phase: 'live', timeLeft: 0, wave: 0 })).toBe('BOSS RUSH');
    expect(scoreboardMeta({ mode: 'team-deathmatch', phase: 'warmup', timeLeft: 4.5, wave: 0 })).toBe('TEAM DEATHMATCH · 0:05');
    expect(scoreboardMeta({ mode: 'team-deathmatch', phase: 'ended', timeLeft: 0, wave: 0 })).toBe('TEAM DEATHMATCH · FINAL');
  });
});
