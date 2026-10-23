// Cover lab (W15 item 11, TW-LOOK): the web half of Godot's cover metric (engines/godot/tests/test_look_cover.gd,
// docs/qa/w15/COVER.md). The Lot with the six shared kit GLBs (?kit=glb: the pbr look the slab twin plays), rain off and
// the clock still, seen from Godot's play camera (EYE_H over the ground, fov 72) at 10 / 30 / 60 m from each sample.
//   /labs/cover.html?webgl&kit=glb[&q=high|med|low]
// The tier (?q=, default high) is the game's whole profile, as main.ts builds it: the render context's engine knobs
// (shadows, bloom) and style detail, and the world view's (the lamps' flood budget, the kit's floods and scale row).
// One measurement convention: the pixel ratio is pinned at 1 at every tier. view() computes the part's rect in the
// canvas's drawing-buffer pixels and the metric reads it from a 1280x720 screenshot (CSS pixels); those agree only at
// ratio 1 (at low's 0.85 the rect lands on the wrong pixels: the 30 and 60 m views read 0 px). Ratio 1 is also the grid
// Godot's metric reads (1280x720 native), so both twins measure the same pixels.
// window.__cover, driven by labs/cover-metric.mjs:
//   ready · samples · error
//   view(i, d)  places the camera as Godot's _place_camera does (between the piece and the approach, turning up to
//               ±80° for a clear line of sight through the shared colliders) and returns { rect, eye, aim, turn }, or
//               null when no view is clear
//   mode(m)     'normal' (the frame) · 'vis' (the sample's part red, the other part green, everything else black: its
//               visible pixels) · 'alone' (the same, with nothing else drawn: its whole outline)
//   cover(on)   the cover read on or off (setCoverRead: the A/B) · values({ fill, sheen, sat, pool }) sets STYLE_COVER's
//               per-build gains, and `scale: { <piece>: fill }` the per-piece fill scales (kitCoverScale at the lab's
//               tier: KIT_COVER_SCALE, and KIT_COVER_SCALE_LOW over it at q=low); anything left out goes back to the built value
//   frames (rendered) · drawCalls (last normal frame)
import * as THREE from 'three/webgpu';
import { float, positionWorld, step, uniform, vec3, vec4 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createRenderContext } from '../src/client/engine/renderer';
import { toQualityTier } from '../src/client/engine/quality';
import { createWorldData } from '../src/shared/world/world-data';
import { createWorldView } from '../src/client/world/world-view';
import { weatherAt } from '../src/shared/world/weather';
import { occupiedAt } from '../src/shared/world/queries';
import { KIT_FLOODMAST, kitCoverScale, kitPlacementMatrix, splitLotKitPrims } from '../src/client/assets/kit-glb';
import { STYLE_COVER, setCoverRead } from '../src/client/style/style-webgpu.js';
import { STYLE } from '../src/client/style/style-tokens.js';

const P = new URLSearchParams(location.search);
const EYE_H = 1.5, FOV = 72;
/** [place, piece, instance, part, approach x, z] [godot test_look_cover.gd SAMPLES] */
const SAMPLES: Array<[string, string, number, 'cover' | 'pole', number, number]> = [
  ['corgi base', 'Kit_Lot_Footing_01', 1, 'cover', -65, -114],
  ['corgi base', 'Kit_Lot_BagWall_01', 3, 'cover', -40, -112],
  ['corgi base', 'Kit_Lot_FloodMast_01', 0, 'cover', -60, -104],
  ['corgi base', 'Kit_Lot_FloodMast_01', 0, 'pole', -60, -104],
  ['cat base', 'Kit_Lot_FloodMast_01', 3, 'cover', 65, 112],
  ['cat base', 'Kit_Lot_FloodMast_01', 3, 'pole', 65, 112],
  ['west lane', 'Kit_Lot_Container20_01', 1, 'cover', -80, -70],
  ['west lane', 'Kit_Lot_BagWall_01', 15, 'cover', -75, -75],
  ['east lane', 'Kit_Lot_Pipe_01', 0, 'cover', 40, 4],
  ['slab approach', 'Kit_Lot_BagWall_01', 13, 'cover', 0, 0],
];

interface CoverLab {
  ready: boolean; error: string; frames: number; drawCalls: number;
  samples: typeof SAMPLES;
  view(i: number, d: number): { rect: [number, number, number, number]; eye: number[]; aim: number[]; turn: number } | null;
  mode(m: 'normal' | 'vis' | 'alone'): void;
  cover(on: boolean): void;
  values(v: { fill?: number; sheen?: number; sat?: number; pool?: number; scale?: Record<string, number> }): void;
}
const lab = { ready: false, error: '', frames: 0, drawCalls: 0, samples: SAMPLES } as unknown as CoverLab;
(globalThis as unknown as { __cover: CoverLab }).__cover = lab;

async function main(): Promise<void> {
  // the tier (?q=), as main.ts passes it: the render context takes its engine profile (shadows, bloom, style detail),
  // and createWorldView hands it to the lamps (the floods' real-light budget) and to the kit (the cover read's floods
  // and its per-piece scale row)
  const tier = (P.get('q') as 'low' | 'med' | 'high' | null) ?? 'high';
  const ctx = await createRenderContext(document.getElementById('app')!, { forceWebGL: P.has('webgl'), quality: toQualityTier(tier) });
  ctx.adaptive.setBounds(1, 1);   // the metric's convention: pixel ratio 1 at every tier (see the header)
  const { scene, camera, renderer } = ctx;
  const data = createWorldData(1, 'the_lot');
  const view = createWorldView(scene, data, { quality: tier, grade: ctx.pipeline.grade.uniforms as unknown as { saturation: { value: number } } });
  // the night as the slab twin opens it (overcast before the first rain), with no rain: streaks are noise in a pixel metric
  view.setWeather({ ...weatherAt(data, 0), rain: 0, flash: 0, strike: null });
  const cam = camera as THREE.PerspectiveCamera;
  cam.fov = FOV; cam.near = 0.1; cam.far = 400; cam.updateProjectionMatrix();

  // each piece's LOD0 box in its own frame (the GLB's scene: the batch places LOD k as placement x node matrix)
  const split = splitLotKitPrims(data);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const local = new Map<string, THREE.Box3>();
  for (const p of split.pieces) {
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/kits/${p.piece.name}.glb`);
    gltf.scene.updateMatrixWorld(true);
    local.set(p.piece.name, new THREE.Box3().setFromObject(gltf.scene.getObjectByName(`${p.piece.name}_LOD0`)!));
  }
  const placementsOf = (name: string) => split.pieces.find((q) => q.piece.name === name)!.placements;
  /** The cover zone's top in the mesh's own height: the FloodMast's ballast (its flood_base collider), else none. */
  const splitOf = (name: string, idx: number) => {
    if (name !== KIT_FLOODMAST) return 1e6;
    const pl = placementsOf(name)[idx];
    const b = data.props.find((q) => q.type === 'flood_base' && Math.hypot(q.x - pl.x, q.z - pl.z) < 1)!;
    return b.y + b.hy - pl.y;
  };

  // the mask material: the sample's instance only (its box in the placement's frame), part A (under the split) red,
  // part B green, everything else black; unlit and unfogged
  const uInv = uniform(new THREE.Matrix4()), uMin = uniform(new THREE.Vector3()), uMax = uniform(new THREE.Vector3()), uSplit = uniform(1e6);
  const uA = uniform(1), uB = uniform(1);
  const l = uInv.mul(vec4(positionWorld, 1)).xyz;
  const lo = step(uMin.sub(0.05), l), hi = step(l, uMax.add(0.05));
  const inside = lo.x.mul(lo.y).mul(lo.z).mul(hi.x).mul(hi.y).mul(hi.z);
  const partA = inside.mul(step(l.y, uSplit)), partB = inside.sub(partA);
  const maskMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  maskMat.colorNode = vec3(partA.mul(uA).mul(0.6), partB.mul(uB).mul(0.6), float(0));
  maskMat.fog = false;
  const blacks = new Map<THREE.Material, THREE.Material>();
  const blackOf = (m: THREE.Material) => {
    let b = blacks.get(m);
    if (!b) {
      const n = new THREE.MeshBasicNodeMaterial({ side: m.side });
      n.colorNode = vec3(0, 0, 0);
      n.positionNode = (m as THREE.NodeMaterial).positionNode ?? null;   // keep displaced or swaying geometry where it is
      n.fog = false;
      blacks.set(m, n);
      b = n;
    }
    return b;
  };

  let target: THREE.Mesh | null = null;
  let current: 'normal' | 'vis' | 'alone' = 'normal';
  const saved: Array<() => void> = [];
  const restore = () => { while (saved.length) saved.pop()!(); };
  lab.mode = (m) => {
    restore();
    current = m;
    if (m === 'normal' || !target) return;
    const bg = scene.background, fog = scene.fog;
    saved.push(() => { scene.background = bg; scene.fog = fog; });
    scene.background = new THREE.Color(0); scene.fog = null;
    scene.traverse((o) => {
      if (o === scene) return;
      const mesh = o as THREE.Mesh;
      if (o === target) { const mat = mesh.material; saved.push(() => { mesh.material = mat; }); mesh.material = maskMat; return; }
      const mat = mesh.material as THREE.Material | undefined;
      const hide = !mesh.isMesh || !mat || Array.isArray(mat) || mat.transparent || m === 'alone';
      if (hide) { if (o.visible && (mesh.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite)) { saved.push(() => { o.visible = true; }); o.visible = false; } return; }
      saved.push(() => { mesh.material = mat; });
      mesh.material = blackOf(mat);
    });
  };
  lab.cover = (on) => setCoverRead(on);
  lab.values = (v) => {
    STYLE_COVER.fill.value = v.fill ?? STYLE.cover.fill;
    STYLE_COVER.sheen.value = v.sheen ?? STYLE.cover.sheen;
    STYLE_COVER.sat.value = v.sat ?? STYLE.cover.sat;
    STYLE_COVER.pool.value = v.pool ?? STYLE.cover.pool;
    scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      const k = mat?.userData?.coverScale as { fill: { value: number } } | undefined;
      const piece = o.name.replace(/_batch$/, '');
      const built = kitCoverScale(piece, tier);
      if (k && built) k.fill.value = v.scale?.[piece] ?? built.fill;
    });
  };

  const ground = (x: number, z: number) => data.height(x, z);
  const blocked = (x: number, y: number, z: number) => y < ground(x, z) || occupiedAt(data, x, y, z);
  lab.view = (i, d) => {
    lab.mode('normal');
    const [, name, idx, part, tx, tz] = SAMPLES[i];
    const pl = placementsOf(name)[idx];
    const box0 = local.get(name)!.clone(), sp = splitOf(name, idx);
    const la = box0.clone();
    if (part === 'pole') la.min.y = sp; else if (sp < la.max.y) la.max.y = sp;
    const M = kitPlacementMatrix(pl);
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => new THREE.Vector3(k & 1 ? la.max.x : la.min.x, k & 2 ? la.max.y : la.min.y, k & 4 ? la.max.z : la.min.z).applyMatrix4(M));
    const box = new THREE.Box3().setFromPoints(corners);
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const bx = tx - c.x, bz = tz - c.z, bl = Math.hypot(bx, bz) || 1;
    for (const turn of [0, 20, -20, 40, -40, 60, -60, 80, -80]) {
      const a = (turn * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      const dx = (bx / bl) * ca - (bz / bl) * sa, dz = (bx / bl) * sa + (bz / bl) * ca;   // Vector2.rotated()
      const px = c.x + dx * d, pz = c.z + dz * d;
      const eye = new THREE.Vector3(px, ground(px, pz) + EYE_H, pz);
      if (box.clone().expandByScalar(0.5).containsPoint(eye)) continue;
      const aim = new THREE.Vector3(c.x, Math.min(Math.max(eye.y, box.min.y + 0.3), box.max.y - 0.2), c.z);
      if (size.y < 3) aim.y = c.y;
      if (part === 'pole') aim.y = Math.max(box.min.y + 1, eye.y);
      if (occupiedAt(data, eye.x, eye.y, eye.z)) continue;
      // the line of sight through the shared colliders and the terrain (Godot: a ray on the world layer)
      const dir = aim.clone().sub(eye), len = dir.length();
      dir.divideScalar(len);
      let hit: THREE.Vector3 | null = null;
      for (let t = 0.05; t < len; t += 0.05) {
        const q = eye.clone().addScaledVector(dir, t);
        if (blocked(q.x, q.y, q.z)) { hit = q; break; }
      }
      if (hit && !box.clone().expandByScalar(0.4).containsPoint(hit)) continue;
      cam.position.copy(eye);
      cam.lookAt(aim);
      cam.updateMatrixWorld();
      // the mask: this instance, split at the cover zone; part A = the sample's part
      uInv.value.copy(M).invert();
      uMin.value.copy(box0.min); uMax.value.copy(box0.max); uSplit.value = sp;
      uA.value = 1; uB.value = 1;
      target = scene.getObjectByName(`${name}_batch`) as THREE.Mesh;
      // the rect: the box on screen, 10 px of margin (Godot _rect)
      const W = renderer.domElement.width, H = renderer.domElement.height;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, behind = false;
      for (let k = 0; k < 8; k++) {
        const p = new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z);
        if (p.clone().applyMatrix4(cam.matrixWorldInverse).z > 0) behind = true;
        p.project(cam);
        const sx = (p.x * 0.5 + 0.5) * W, sy = (1 - (p.y * 0.5 + 0.5)) * H;
        x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
      }
      const rect: [number, number, number, number] = behind ? [0, 0, W, H]
        : [Math.max(0, Math.floor(x0) - 10), Math.max(0, Math.floor(y0) - 10), Math.min(W, Math.ceil(x1) + 11), Math.min(H, Math.ceil(y1) + 11)];
      return { rect, eye: eye.toArray(), aim: aim.toArray(), turn };
    }
    return null;
  };

  renderer.info.autoReset = false;
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    view.update(dt, cam, 0);
    renderer.info.reset();
    ctx.render();
    if (current === 'normal') {
      const info = renderer.info.render as unknown as { drawCalls?: number; calls?: number };
      lab.drawCalls = info.drawCalls ?? info.calls ?? 0;
    }
    lab.frames++;
    if (!lab.ready && (view.stats() as Record<string, number>).kitLoaded === split.pieces.filter((p) => p.placements.length).length) lab.ready = lab.frames > 3;
  });
}

main().catch((e) => { lab.error = String((e as Error)?.stack ?? e); console.error(e); });
