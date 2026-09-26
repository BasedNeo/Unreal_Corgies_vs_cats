// Verify a commit in isolation — the exact tree git holds, not the working directory other agents are editing.
// Exports the commit with `git archive` into a scratch dir, links node_modules, then runs typecheck, boundaries,
// unit tests and a production build there. Use after every integration commit (QA W1: a "gate green" commit
// didn't boot because unverified in-flight files were swept into it).
//   node tools/verify-commit.mjs [rev=HEAD] [--e2e]
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const rev = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'HEAD';
const e2e = process.argv.includes('--e2e');
const sha = execSync(`git rev-parse --short ${rev}`).toString().trim();
const dir = mkdtempSync(path.join(tmpdir(), `cvc-verify-${sha}-`));
execSync(`git archive ${rev} | tar -x -C ${dir}`);
symlinkSync(path.resolve('node_modules'), path.join(dir, 'node_modules'), 'dir');
const steps = [['typecheck', 'npx', ['tsc', '--noEmit']], ['boundaries', 'node', ['tools/check-boundaries.mjs']], ['unit', 'npx', ['vitest', 'run']], ['build', 'npx', ['vite', 'build', '--logLevel', 'error']]];
// net.spec (two browsers through a Node server) stays out: it needs a quiet box; run it on its own before a release
if (e2e) steps.push(['e2e', 'npx', ['playwright', 'test', 'tests/e2e/smoke.spec.ts', 'tests/e2e/modes.spec.ts', 'tests/e2e/locker.spec.ts']]);
let ok = true; const out = [];
for (const [name, cmd, args] of steps) {
  const r = spawnSync(cmd, args, { cwd: dir, stdio: 'inherit', env: { ...process.env, CI: '' } });
  out.push(`${name}:${r.status === 0 ? 'ok' : 'FAIL'}`);
  if (r.status !== 0) { ok = false; break; }
}
rmSync(dir, { recursive: true, force: true });
console.log(`\n${ok ? 'VERIFY PASS' : 'VERIFY FAIL'} ${sha} | ${out.join(' ')}`);
process.exit(ok ? 0 : 1);
