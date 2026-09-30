#!/usr/bin/env node
// Q5 verification probe (read-only): summarise tools/qa4-ba.mjs `matches --json` files under the shipping rule.
//   node tools/qa5-ba-sum.mjs artifacts/q5/ba/wy-base.json [more.json …] [--pool]
// qa4-ba plays to the horn (--limit 99) and reports the horn winner; the shipping rule is first to `captureLimit` (3).
// This recomputes, from each match's carry records: captures per team, the corgi share, horn wins, who reaches 3 first
// (C : K, nobody, and a draw when both reach it on the same tick, as the sim rules), who captures first, and captures before / after 2:00 on the sim clock.
// --pool adds a line summing every file given.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const LIMIT = 3, HZ = 60, SPLIT = 120;
const pooled = { n: 0, caps: [0, 0], horn: [0, 0, 0], ft: [0, 0, 0, 0], sameTick: 0, first: [0, 0], early: [0, 0], late: [0, 0] };
function sum(runs) {
  const r = { n: runs.length, caps: [0, 0], horn: [0, 0, 0], ft: [0, 0, 0, 0], sameTick: 0, first: [0, 0], early: [0, 0], late: [0, 0] };
  for (const m of runs) {
    // captures in tick order; captures on the same tick land together (the stalemate relief lets both carriers score on one
    // tick), then the limit is checked as src/sim/match/index.ts does: c > k corgis, k > c cats, level a draw
    const caps = m.carries.filter((c) => c.end?.reason === 'captured').map((c) => [c.end.tick, c.team]).sort((a, b) => a[0] - b[0]);
    const cnt = [0, 0]; let w = null;
    for (let i = 0; i < caps.length; ) {
      const tick = caps[i][0];
      for (; i < caps.length && caps[i][0] === tick; i++) {
        const team = caps[i][1];
        r.caps[team]++; (tick / HZ <= SPLIT ? r.early : r.late)[team]++;
        if (w === null) cnt[team]++;
      }
      if (w === null && (cnt[0] >= LIMIT || cnt[1] >= LIMIT)) w = cnt[0] > cnt[1] ? 0 : cnt[1] > cnt[0] ? 1 : 3;
    }
    for (let i = 1; i < caps.length; i++) if (caps[i][0] === caps[i - 1][0]) r.sameTick++;
    if (caps.length) r.first[caps[0][1]]++;
    r.ft[w === null ? 2 : w === 3 ? 3 : w]++;
    r.horn[m.winner === 0 ? 0 : m.winner === 1 ? 1 : 2]++;
  }
  return r;
}
const line = (name, r) => {
  const share = (100 * r.caps[0]) / Math.max(1, r.caps[0] + r.caps[1]);
  return `${name}  matches ${r.n} · captures C:K ${r.caps[0]}:${r.caps[1]} (corgi ${share.toFixed(1)} %) · horn C:K:draw ${r.horn.join(':')} · first to ${LIMIT} C:K:none:draw ${r.ft.join(':')} · same-tick double captures ${r.sameTick} · first capture C:K ${r.first.join(':')} · captures ≤ ${SPLIT / 60}:00 ${r.early.join(':')} · after ${r.late.join(':')}`;
};
for (const f of files) {
  const runs = JSON.parse(readFileSync(f, 'utf8')).runs;
  const r = sum(runs);
  console.log(line(f.split('/').pop(), r));
  pooled.n += r.n; pooled.sameTick += r.sameTick;
  for (const k of ['caps', 'horn', 'ft', 'first', 'early', 'late']) for (let i = 0; i < r[k].length; i++) pooled[k][i] += r[k][i];
}
if (args.includes('--pool')) console.log(line('POOLED', pooled));
