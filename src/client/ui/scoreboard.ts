// OWNER: L5 (juice). Scoreboard model (pure, tested) + DOM render.
import type { RosterEntry } from '../../shared/protocol';
import type { ClassId } from '../../shared/types';

export interface ScoreRow {
  entity: number;
  name: string;
  cls: ClassId;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
  bot: boolean;
  local: boolean;
}

export interface ScoreboardModel { teams: [ScoreRow[], ScoreRow[]]; totals: [number, number] }

/** Splits the roster into team columns sorted by score ↓, kills ↓, deaths ↑, name. */
export function buildScoreboard(roster: readonly RosterEntry[], localEntity: number): ScoreboardModel {
  const teams: [ScoreRow[], ScoreRow[]] = [[], []];
  for (const r of roster) {
    if (r.team !== 0 && r.team !== 1) continue;
    teams[r.team].push({ entity: r.entity, name: r.name, cls: r.cls, kills: r.kills, deaths: r.deaths, score: r.score, ping: r.ping, bot: r.bot, local: r.entity === localEntity });
  }
  const cmp = (a: ScoreRow, b: ScoreRow) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name);
  teams[0].sort(cmp); teams[1].sort(cmp);
  const total = (rows: ScoreRow[]) => rows.reduce((s, r) => s + r.kills, 0);
  return { teams, totals: [total(teams[0]), total(teams[1])] };
}

/** K/D ratio text: "1.50", "∞"-free (0 deaths shows kills). */
export function kdText(k: number, d: number): string {
  return d === 0 ? k.toFixed(0) : (k / d).toFixed(2);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderScoreboardHtml(m: ScoreboardModel, teamScores: [number, number] | null, classIcon: (cls: ClassId) => string, classLabel: (cls: ClassId) => string): string {
  const col = (t: 0 | 1) => {
    const name = t === 0 ? 'CORGIS' : 'CATS';
    const rows = m.teams[t].map((r) => `
      <tr class="${r.local ? 'me' : ''}">
        <td class="sb-cls" title="${esc(classLabel(r.cls))}">${classIcon(r.cls)}</td>
        <td class="sb-name">${esc(r.name)}${r.bot ? '<span class="sb-bot">BOT</span>' : ''}${r.local ? '<span class="sb-you">YOU</span>' : ''}</td>
        <td class="num">${r.kills}</td><td class="num">${r.deaths}</td><td class="num">${kdText(r.kills, r.deaths)}</td>
        <td class="num strong">${r.score}</td><td class="num dim">${r.bot ? '—' : Math.round(r.ping)}</td>
      </tr>`).join('') || `<tr><td colspan="7" class="sb-empty">No one here yet</td></tr>`;
    return `
      <section class="sb-team t${t}">
        <header><span class="sb-tname">${name}</span><span class="sb-tscore">${teamScores ? teamScores[t] : m.totals[t]}</span></header>
        <table><thead><tr><th></th><th class="l">NAME</th><th>K</th><th>D</th><th>K/D</th><th>SCORE</th><th>PING</th></tr></thead><tbody>${rows}</tbody></table>
      </section>`;
  };
  return col(0) + col(1);
}
