// make-web-variant.mjs (W11 P-GLB1): master GLB (PNG) -> web variant (EXT_meshopt_compression + KHR_mesh_quantization,
// EXT_texture_webp), then validates both and writes the numbers into assets/manifest.json.
//   node tools/assets/make-web-variant.mjs assets/masters/Kit_Lot_Container20_01.glb [--out public/assets/kits]
// The master is never modified. Colour/ORM WebP at quality 84, the normal map at 92 (lossy normals band first).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { validateGlb } from './validate-glb.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const src = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out');
if (!src) { console.error('usage: node tools/assets/make-web-variant.mjs <master.glb> [--out public/assets/kits]'); process.exit(2); }
const oi = argv.indexOf('--out');
const outDir = resolve(oi >= 0 ? argv[oi + 1] : join(ROOT, 'public/assets/kits'));
const out = join(outDir, basename(src));

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
await doc.transform(
  dedup(),
  prune({ keepLeaves: true, keepAttributes: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92, slots: /^normalTexture$/ }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 84, slots: /^(?!normalTexture$).*/ }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
mkdirSync(outDir, { recursive: true });
await io.write(out, doc);

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const manifestPath = join(ROOT, 'assets/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const master = await validateGlb(src, { manifest });
const webv = await validateGlb(out, { manifest });
for (const [label, r] of [['master', master], ['web', webv]]) {
  console.log(`${label}: ${r.ok ? 'PASS' : 'FAIL'} ${r.report.bytes} bytes ${r.report.lods.map((l) => `${l.name.split('_').pop()} ${l.tris}`).join(' · ')}`);
  for (const e of r.errors) console.log(`  FAIL: ${e}`);
}

// ---- manifest numbers (the rest of the entry is hand-written: provenance, licence, versions)
const name = master.report.root;
const entry = manifest.assets.find((a) => a.name === name);
if (entry) {
  const pkg = (p) => JSON.parse(readFileSync(join(ROOT, 'node_modules', p, 'package.json'), 'utf8')).version;
  entry.files = {
    master: { path: relative(ROOT, resolve(src)), bytes: statSync(src).size, sha256: sha(src), validator: master.ok ? 'PASS' : 'FAIL' },
    web: { path: relative(ROOT, out), bytes: statSync(out).size, sha256: sha(out), validator: webv.ok ? 'PASS' : 'FAIL', extensions: webv.report.extensions },
    textures: Object.fromEntries(['baseColor', 'orm', 'normal'].map((k) => {
      const p = join(dirname(src), `${name}_${k}.png`);
      try { return [k, { path: relative(ROOT, p), bytes: statSync(p).size, sha256: sha(p) }]; } catch { return [k, null]; }
    })),
  };
  entry.tris = Object.fromEntries(master.report.lods.map((l) => [l.name.split('_').pop(), l.tris]));
  entry.bounds_m = { min: master.report.lods[0]?.min, max: master.report.lods[0]?.max };
  entry.colliders = master.report.colliders;
  entry.tools = { ...(entry.tools ?? {}), 'gltf-transform': pkg('@gltf-transform/core'), meshoptimizer: pkg('meshoptimizer'), sharp: pkg('sharp') };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest: ${name} updated`);
} else console.log(`manifest: no entry for ${name} (add one by hand first)`);
process.exit(master.ok && webv.ok ? 0 : 1);
