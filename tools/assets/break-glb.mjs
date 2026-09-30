// break-glb.mjs (W11 P-GLB1): writes a deliberately broken copy of a GLB, to prove validate-glb.mjs fails on it.
//   node tools/assets/break-glb.mjs <in.glb> <out.glb> [defect ...]
// Defects (default: all): scale (a centimetre export: root scaled x100), pivot (LOD0 moved 2 m off the base centre),
// lodname (LOD1 renamed "LOD_1"), col (the first COL_ box gets a material and a rotation), tris (LOD2's triangles
// doubled past its 200 budget), zup (LOD0 turned to Z-up).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export const DEFECTS = ['scale', 'pivot', 'lodname', 'col', 'tris', 'zup'];

/** Applies `defects` to a glTF-Transform Document in place. */
export function breakDocument(doc, defects = DEFECTS) {
  const root = doc.getRoot();
  const top = root.listScenes()[0].listChildren()[0];
  const name = top.getName();
  const kid = (n) => top.listChildren().find((k) => k.getName() === n);
  for (const d of defects) {
    if (d === 'scale') top.setScale([100, 100, 100]);
    if (d === 'pivot') kid(`${name}_LOD0`)?.setTranslation([2, 0, 0]);
    if (d === 'lodname') kid(`${name}_LOD1`)?.setName(`${name}_LOD_1`);
    if (d === 'col') {
      const c = top.listChildren().find((k) => k.getName().startsWith('COL_'));
      c.getMesh().listPrimitives()[0].setMaterial(root.listMaterials()[0]);
      c.setRotation([0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)]);
    }
    if (d === 'tris') {
      const lod2 = kid(`${name}_LOD2`);
      const prim = lod2.getMesh().listPrimitives()[0];
      for (let i = 0; i < 2; i++) lod2.getMesh().addPrimitive(prim.clone());
    }
    if (d === 'zup') kid(`${name}_LOD0`)?.setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  }
  return doc;
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [src, out, ...defects] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: node tools/assets/break-glb.mjs <in.glb> <out.glb> [defect ...]'); process.exit(2); }
  await MeshoptDecoder.ready; await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = breakDocument(await io.read(src), defects.length ? defects : DEFECTS);
  await io.write(out, doc);
  console.log(`broken copy (${(defects.length ? defects : DEFECTS).join(', ')}): ${out}`);
}
