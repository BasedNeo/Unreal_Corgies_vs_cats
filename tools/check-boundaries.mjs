// Architecture boundary check (fails the gate on violations):
//  - src/sim, src/shared, src/host must run headless: no three, no DOM globals, no Math.random.
//  - src/shared must not import from src/sim, src/host or src/client.
//  - Engine code must reach theme content only through src/shared/content.
//  - The authority never loads a GLB (W11): collision and gameplay data stay in src/shared world data.
//  - Repository layout (W11): engine projects live under engines/<engine>/, never at the root; no two paths may
//    differ only by case (macOS / Windows checkouts). See ARCHITECTURE.md → Repository layout.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const errors = [];
const GLB = /\.(glb|gltf)\b/;
const rules = [
  { dir: 'src/sim', deny: [GLB, /from ['"]three/, /\bdocument\./, /\bwindow\./, /Math\.random\(/, /from ['"].*\/client\//] },
  { dir: 'src/host', deny: [GLB, /from ['"]three/, /\bdocument\./, /\bwindow\./, /Math\.random\(/, /from ['"].*\/client\//] },
  { dir: 'src/shared', deny: [GLB, /from ['"]three/, /\bdocument\./, /\bwindow\./, /Math\.random\(/, /from ['"]\.\.\/(sim|host|client)\//, /from ['"]\.\.\/\.\.\/(sim|host|client)\//] },
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
const ENGINE_ROOT = /^(config|content|source|plugins|binaries|deriveddatacache|intermediate|saved|.*\.uproject|project\.godot|\.godot)$/i;
for (const f of readdirSync('.')) if (ENGINE_ROOT.test(f)) errors.push(`./${f}: engine project files belong under engines/<engine>/`);
const byLower = new Map();
const note = (p) => { const k = p.toLowerCase(); const s = byLower.get(k) ?? new Set(); s.add(p); byLower.set(k, s); };
const walkLayout = (d) => { for (const f of readdirSync(d)) { if (f.startsWith('.') || f === 'node_modules') continue; const p = join(d, f); note(p); if (statSync(p).isDirectory()) walkLayout(p); } };
for (const d of ['src', 'server', 'tests', 'tools', 'docs', 'labs', 'public', 'assets', 'engines']) if (existsSync(d)) { note(d); walkLayout(d); }
for (const s of byLower.values()) if (s.size > 1) errors.push(`paths differ only by case: ${[...s].join(' | ')}`);
if (errors.length) { console.error(`BOUNDARIES: ${errors.length} violation(s)\n` + errors.join('\n')); process.exit(1); }
console.log('BOUNDARIES: PASS');
