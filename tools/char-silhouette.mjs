#!/usr/bin/env node
// Class silhouette distinctness (K1): for each species, builds every class at the NPC tier (what other
// players see at range), settles the idle pose, rasterizes front + side silhouettes at ~1 px per 6 cm
// (35 m, 62° fov, 720p) and prints the pairwise Jaccard distance (0 = same shape, 1 = disjoint).
//   node tools/char-silhouette.mjs [--root <dir with src/>] [--ascii <class>] [--seed N]
// --root lets you score another checkout (e.g. `git archive HEAD src | tar -x -C /tmp/old`, with a
// node_modules symlink) for before/after numbers.
import { tsImport } from 'tsx/esm/api';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const root = resolve(opt('root', new URL('..', import.meta.url).pathname));
const url = pathToFileURL(root + '/tools/x.mjs').href;
const chars = await tsImport('../src/client/procgen/characters/index.ts', url);
const { CLASS_IDS } = await tsImport('../src/shared/types.ts', url);
const sil = await tsImport(pathToFileURL(resolve(new URL('..', import.meta.url).pathname, 'src/client/procgen/characters/silhouette.ts')).href, import.meta.url);
const seed = Number(opt('seed', 3));
const ascii = opt('ascii', null);
const frame = { speed: 0, vy: 0, grounded: true, anim: 0, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false };

let worst = 1;
for (const [name, species] of [['corgi', 0], ['cat', 1]]) {
  const masks = {};
  for (const cls of CLASS_IDS) {
    const av = chars.createCharacter({ species, cls, team: species, seed, isLocal: false });
    for (let i = 0; i < 30; i++) av.update(frame, 1 / 60);
    masks[cls] = sil.silhouetteMasks(av.root);
    if (ascii === cls) console.log(`${name} ${cls} front | side\n` + sil.maskToText(masks[cls].front).split('\n').map((r, i) => r + '   ' + sil.maskToText(masks[cls].side).split('\n')[i]).join('\n'));
    av.dispose();
  }
  console.log(`\n${name} (NPC tier, seed ${seed}) — pairwise silhouette distance`);
  console.log(''.padEnd(12) + CLASS_IDS.map((c) => c.slice(0, 7).padStart(8)).join(''));
  let min = 1, pair = '';
  for (const a of CLASS_IDS) {
    let row = a.padEnd(12);
    for (const b of CLASS_IDS) {
      const d = sil.silhouetteDistance(masks[a], masks[b]);
      row += (a === b ? '-' : d.toFixed(2)).padStart(8);
      if (a < b && d < min) { min = d; pair = `${a}/${b}`; }
    }
    console.log(row);
  }
  console.log(`closest pair: ${pair} ${min.toFixed(3)}`);
  worst = Math.min(worst, min);
}
console.log(`\nworst closest pair over both species: ${worst.toFixed(3)}`);
