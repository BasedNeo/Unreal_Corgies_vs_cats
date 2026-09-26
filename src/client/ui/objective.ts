// The authority sends one objective line, written for the corgis (skirmish is corgis vs PvE waves). A human on
// the cat side (a room slot) reads it from their side instead (QA W1: cats were told to "Defend the yard!").
// Pure: tested in tests/unit/ui-objective.test.ts.

const PVE_MODE = /skirmish|boss/i;

/** Separator the authority uses to append the mission step (sim/interact foldObjectiveText). */
const MISSION_SEP = ' · ▶ ';

/**
 * The objective banner line for `team`. The authority appends the S1 mission step to MatchState.objective; the
 * banner drops it (the mission card shows the chain with room to spare, and the banner truncated it).
 */
export function objectiveForTeam(text: string, mode: string, team: number): string {
  const base = text.split(MISSION_SEP)[0];
  return team === 1 && PVE_MODE.test(mode) ? catLine(base) : base;
}

function catLine(text: string): string {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^Defend the yard! Cats attack in (\d+)/))) return `Raid the yard! Attack in ${m[1]}`;
  if ((m = text.match(/^Squad down! (\d+) (?:retry|retries) left/))) return `Corgi squad wiped! They can regroup ${m[1]} more ${m[1] === '1' ? 'time' : 'times'}`;
  if ((m = text.match(/^Wave (\d+) cleared! Wave (\d+)( \(FINAL\))? in (\d+)/))) return `Wave ${m[1]} beaten back. Regroup: wave ${m[2]}${m[3] ?? ''} in ${m[4]}`;
  if (/^Yard secured!/.test(text)) return 'The corgis held the yard. Retreat!';
  if ((m = text.match(/^(.+) — (\d+) cats? left$/))) return `${m[1]} — take down the corgi squad (${m[2]} ${m[2] === '1' ? 'cat' : 'cats'} in the raid)`;
  return text;
}

/** A trailing "(n/N)" step counter moves to the front, so a long objective's ellipsis never eats it (Q2 P2-7). */
export function counterFirst(text: string): string {
  const m = /^(.*\S)\s*\((\d+\/\d+)\)\s*$/.exec(text);
  return m ? `(${m[2]}) ${m[1]}` : text;
}

/** Scoreboard header: "MODE · 3:12 · WAVE 2", untimed phases without a 0:00, and STEP n in an adventure (Q2 P2-7). */
export function scoreboardMeta(M: { mode: string; phase: string; timeLeft: number; wave: number }): string {
  const mode = M.mode.replace(/-/g, ' ').toUpperCase();
  const unit = M.mode === 'adventure' ? 'STEP' : 'WAVE';
  const wave = M.wave > 0 ? `${unit} ${M.wave}` : '';
  if (M.phase === 'ended') return `${mode} · FINAL`;
  const untimed = M.phase === 'live' && M.timeLeft <= 0;
  const t = Math.max(0, Math.ceil(M.timeLeft)); // same rounding as the HUD timer
  const clock = untimed ? '' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  return [mode, clock, wave].filter(Boolean).join(' · ');
}
