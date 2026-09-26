// One command that decides "done": typecheck, boundaries, unit tests, build, browser smoke.
//   npm run gate          full gate (includes Playwright e2e)
//   npm run gate:fast     skip build + e2e
import { spawnSync } from 'node:child_process';
import { mkdirSync, appendFileSync } from 'node:fs';

const fast = process.argv.includes('--fast');
const steps = [
  ['typecheck', 'npx', ['tsc', '--noEmit']],
  ['boundaries', 'node', ['tools/check-boundaries.mjs']],
  ['unit', 'npx', ['vitest', 'run']],
  ...(fast ? [] : [['build', 'npx', ['vite', 'build']], ['e2e', 'npx', ['playwright', 'test']]]),
];
const results = [];
let ok = true;
for (const [name, cmd, args] of steps) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  const pass = r.status === 0;
  results.push({ name, pass, ms: Date.now() - t0 });
  if (!pass) { ok = false; break; }
}
const line = `${ok ? 'GATE PASS' : 'GATE FAIL'} | ${results.map((r) => `${r.name}:${r.pass ? 'ok' : 'FAIL'}(${(r.ms / 1000).toFixed(1)}s)`).join(' ')}`;
console.log('\n' + line);
mkdirSync('artifacts', { recursive: true });
appendFileSync('artifacts/gate-history.jsonl', JSON.stringify({ at: new Date().toISOString(), ok, fast, results }) + '\n');
process.exit(ok ? 0 : 1);
