// The authority sends one objective line, written for the corgis (skirmish is corgis vs PvE waves). A human on
// the cat side (a room slot) reads it from their side instead (QA W1: cats were told to "Defend the yard!").
// Pure: tested in tests/unit/ui-objective.test.ts.

const PVE_MODE = /skirmish|boss/i;

export function objectiveForTeam(text: string, mode: string, team: number): string {
  if (team !== 1 || !PVE_MODE.test(mode)) return text;
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^Defend the yard! Cats attack in (\d+)/))) return `Raid the yard! Attack in ${m[1]}`;
  if ((m = text.match(/^Squad down! (\d+) (?:retry|retries) left/))) return `Corgi squad wiped! They can regroup ${m[1]} more ${m[1] === '1' ? 'time' : 'times'}`;
  if ((m = text.match(/^Wave (\d+) cleared! Wave (\d+)( \(FINAL\))? in (\d+)/))) return `Wave ${m[1]} beaten back. Regroup: wave ${m[2]}${m[3] ?? ''} in ${m[4]}`;
  if (/^Yard secured!/.test(text)) return 'The corgis held the yard. Retreat!';
  if ((m = text.match(/^(.+) — (\d+) cats? left$/))) return `${m[1]} — take down the corgi squad (${m[2]} ${m[2] === '1' ? 'cat' : 'cats'} in the raid)`;
  return text;
}
