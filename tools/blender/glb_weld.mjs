// glb_weld.mjs (W17 AAA pass 4, lane BL-DCC): the lossless size pass for the backdrop GLB, run by backdrop_glb.py.
//   node tools/blender/glb_weld.mjs <in.glb> <out.glb>
// 1. drops TEXCOORD_0 from primitives whose material has no texture (BD_DarkSteel, BD_SodiumLamp: the UVs were never
//    read), 2. welds bit-identical vertices into an indexed mesh (glTF-Transform weld(): only vertices whose every
//    attribute matches are merged, so shading cannot change), 3. dedup + prune. Draws, materials, triangles and node
//    names are unchanged; the output is deterministic (no timestamps, fixed order). Prints a JSON report.
import { statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld } from '@gltf-transform/functions';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error('usage: node tools/blender/glb_weld.mjs <in.glb> <out.glb>');
  process.exit(2);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const count = () => doc.getRoot().listAccessors().filter((a) => doc.getRoot().listMeshes().some((m) => m.listPrimitives().some((p) => p.getAttribute('POSITION') === a)))
  .reduce((n, a) => n + a.getCount(), 0);
const before = { bytes: statSync(src).size, vertices: count() };
let uvDropped = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    const textured = mat && (mat.getBaseColorTexture() || mat.getNormalTexture() || mat.getMetallicRoughnessTexture()
      || mat.getOcclusionTexture() || mat.getEmissiveTexture());
    if (!textured && prim.getAttribute('TEXCOORD_0')) {
      prim.setAttribute('TEXCOORD_0', null);
      uvDropped++;
    }
  }
}
await doc.transform(weld(), dedup(), prune());
await io.write(dst, doc);
console.log('WELD ' + JSON.stringify({ before, after: { bytes: statSync(dst).size, vertices: count() }, uv_dropped_primitives: uvDropped }));
