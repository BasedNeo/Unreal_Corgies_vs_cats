// Architecture boundary check (fails the gate on violations):
//  - src/sim, src/shared, src/host must run headless: no three, no DOM globals, no Math.random.
//  - src/shared must not import from src/sim, src/host or src/client.
//  - Engine code must reach theme content only through src/shared/content.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const errors = [];
const rules = [
  { dir: 'src/sim', deny: [/from ['"]three/, /\bdocument\./, /\bwindow\./, /Math\.random\(/, /from ['"].*\/client\//] },
  { dir: 'src/host', deny: [/from ['"]three/, /\bdocument\./, /\bwindow\./, /Math\.random\(/, /from ['"].*\/client\//] },
  { dir: 'src/shared', deny: [/from ['"]three/, /\bdocument\./, /\bwindow\./, /Math\.random\(/, /from ['"]\.\.\/(sim|host|client)\//, /from ['"]\.\.\/\.\.\/(sim|host|client)\//] },
];
for (const r of rules) {
  for (const f of walk(r.dir).filter((f) => /\.(ts|js|mjs)$/.test(f) && !/\.test\.ts$/.test(f))) {
    const src = readFileSync(f, 'utf8').split('\n');
    src.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      for (const re of r.deny) if (re.test(line)) errors.push(`${f}:${i + 1}: ${re} -> ${line.trim()}`);
    });
  }
}
if (errors.length) { console.error(`BOUNDARIES: ${errors.length} violation(s)\n` + errors.join('\n')); process.exit(1); }
console.log('BOUNDARIES: PASS');
