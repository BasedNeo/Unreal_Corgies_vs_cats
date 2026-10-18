// 30 m lineup lab (W17-AAA-QA, QA-30M): the web twin's half of the 30 m team-read check (docs/qa/w17/AAA-30M.md).
// The Lot with the shared kit GLBs (?kit=glb, as the slab twin plays it), the twin's OWN render context, lights, floods
// and world view (createRenderContext, createWorldView) and its OWN pets (EntityViews in the slab match's mode, the
// same path main.ts draws every player and bot through: since TW-PETS the slab pets, src/client/views/slab-pet.ts, the
// port of Godot's PLACEHOLDER pets; in a tree before TW-PETS EntityViews ignores the mode and draws createCharacter's
// W7 K2 kits with the bots' seeded look), placed and framed from Godot's lineup:
// tools/aaa-30m.mjs passes the camera (origin, basis, fov) and the pets (team, species, feet, yaw) Godot recorded, so
// both engines show the same pets on the same ground from the same camera.
//   /labs/lineup.html?kit=glb[&webgl][&q=low|medium|high]     (no &webgl: WebGPU, falling back to WebGL2 if absent)
// window.__lineup, driven by tools/aaa-30m.mjs:
//   ready · error · backend ('webgpu' | 'webgl') · frames · pets ('slab' | 'k2': which builder drew the bots, after place)
//   place(view)   the Godot view JSON ({ camera, pets }): camera and pets set, the night as the slab twin opens it
//                 (overcast before the first rain) with no rain (streaks are noise in a pixel metric)
//   step(n)       advance and draw n frames (pets idle, world animating) so pipelines compile and the view settles
//   capture()     two frames of the SAME state, each read back from an 8-bit render target (a page screenshot misses
//                 a WebGPU canvas): { w, h, normal, mask } as PNG data URLs. normal = the twin's own post pipeline;
//                 mask = a known-colour matte drawn with no post (unlit, unfogged, black sky): the Corgi bot's armour
//                 255,0,0 · coat 0,255,0 · the rest of it 0,0,255; the Cat bot's 255,255,0 · 0,255,255 · 255,0,255;
//                 everything else 0,0,0 (opaque occluders kept, transparent and point/line/sprite objects hidden).
//                 Slab pets (userData.petSurfaces, one group per surface): armour = plate + band, coat = coat, the rest
//                 = accent, dark and the whole rifle, exactly Godot's matte. K2 kits: armour = the SURF.armor vertices,
//                 coat = SURF.fur, the rest = suit, skin, eyes, gear, weapon, glows, neckwear.
import * as THREE from 'three/webgpu';
import { attribute, float, length, step, uniform, vec3, vec4 } from 'three/tsl';
import { createRenderContext } from '../src/client/engine/renderer';
import { createWorldData } from '../src/shared/world/world-data';
import { createWorldView } from '../src/client/world/world-view';
import { weatherAt } from '../src/shared/world/weather';
import { surfaceAt } from '../src/shared/world/queries';
import { EntityViews } from '../src/client/views/entity-views';
import { isVeteranSeed } from '../src/client/procgen/characters';
import { SURF } from '../src/client/procgen/characters/mesh-builder';
import { splitLotKitPrims } from '../src/client/assets/kit-glb';
import { QUALITY, toQualityTier } from '../src/client/engine/quality';
import type { EntityState } from '../src/shared/protocol';
import { Anim, CLASS_IDS, EFlag, EntityKind, type SpeciesId, type TeamId } from '../src/shared/types';

const P = new URLSearchParams(location.search);

interface GodotPet { team: number; species: number; bot: boolean; feet: [number, number, number]; yaw: number }
interface GodotView {
  camera: { origin: number[]; x: number[]; y: number[]; z: number[]; fov: number; near: number; far: number };
  pets: GodotPet[];
}
interface LineupLab {
  ready: boolean; error: string; backend: string; frames: number; seeds: number[]; pets: '' | 'slab' | 'k2';
  place(v: GodotView): void;
  step(n: number): Promise<void>;
  capture(): Promise<{ w: number; h: number; normal: string; mask: string }>;
}
const lab = { ready: false, error: '', backend: '', frames: 0, seeds: [], pets: '' } as unknown as LineupLab;
(globalThis as unknown as { __lineup: LineupLab }).__lineup = lab;

/** Matte colours [armour, coat, other] per team (0 Corgi Company, 1 Cat Cadre): the same codes Godot's matte uses. */
const MATTE: [number, number, number][][] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[1, 1, 0], [0, 1, 1], [1, 0, 1]],
];
const ASSAULT = CLASS_IDS.indexOf('assault');
/** The first seeds from 1 that are not veterans (a slab bot is a plain Assault): fixed, so every pass sees one pet. */
const plainSeed = (from: number) => { let s = from; while (isVeteranSeed(s)) s++; return s; };

async function main(): Promise<void> {
  const ctx = await createRenderContext(document.getElementById('app')!, { forceWebGL: P.has('webgl'), quality: toQualityTier(P.get('q')) });
  const { scene, renderer } = ctx;
  lab.backend = ctx.backend;
  const q = toQualityTier(P.get('q'));
  const data = createWorldData(1, 'the_lot');
  const view = createWorldView(scene, data, { quality: q === 'medium' ? 'med' : q, grade: ctx.pipeline.grade.uniforms as unknown as { saturation: { value: number } } });
  view.setWeather({ ...weatherAt(data, 0), rain: 0, flash: 0, strike: null });
  const cam = ctx.camera;
  // the slab match's mode (TW-PETS: EntityViews draws the slab pets in it). A variable, not a literal: a tree from before
  // TW-PETS has no `mode` option and simply ignores it (an object literal would be an excess-property type error there)
  const viewOpts = { surfaceAt: (x: number, z: number, y: number) => surfaceAt(data, x, z, y).y, mode: () => 'slab' };
  const views = new EntityViews(scene, viewOpts);
  views.setBlobShadows(!QUALITY[q].shadows); // as main.ts: the low tier has no shadow pass
  const states = new Map<number, EntityState>();
  let gen = 0, local = 0;
  const seeds = [plainSeed(1), plainSeed(plainSeed(1) + 1), plainSeed(101)];
  lab.seeds = seeds;

  lab.place = (v) => {
    const c = v.camera;
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...c.x), new THREE.Vector3(...c.y), new THREE.Vector3(...c.z));
    m.setPosition(new THREE.Vector3(...c.origin));
    cam.matrixAutoUpdate = true;
    cam.position.setFromMatrixPosition(m);
    cam.quaternion.setFromRotationMatrix(m);
    cam.fov = c.fov; cam.near = c.near; cam.far = c.far;
    cam.aspect = renderer.domElement.width / renderer.domElement.height;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    // fresh ids each placement: a re-placed avatar would keep its old body yaw (EntityViews turns an idle pet slowly)
    states.clear();
    gen++;
    let bot = 0;
    local = gen * 100;
    for (const p of v.pets) {
      const pid = p.bot ? gen * 100 + 10 + bot++ : local;
      states.set(pid, {
        id: pid, kind: p.bot ? EntityKind.Bot : EntityKind.Player, team: p.team as TeamId, species: p.species as SpeciesId,
        cls: ASSAULT, seed: p.bot ? seeds[p.team === 0 ? 0 : 1] : seeds[2], x: p.feet[0], y: p.feet[1], z: p.feet[2],
        yaw: p.yaw, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 100, maxHp: 100, anim: Anim.Idle, flags: EFlag.Grounded, weapon: 0, ammo: 30,
      });
    }
  };

  let tick = 0;
  const frame = (dt: number) => {
    views.sync(states, local, dt);
    view.update(dt, cam, tick++);
    ctx.render();
    lab.frames++;
  };
  lab.step = async (n) => {
    for (let i = 0; i < n; i++) {
      frame(1 / 60);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    const bot = [...states.values()].find((x) => x.kind === EntityKind.Bot);
    const root = bot ? views.get(bot.id)?.avatar.root : undefined;
    lab.pets = root ? (root.userData.placeholder ? 'slab' : 'k2') : '';
  };

  // the matte: one material per (bot, part); body parts from the `surface` attribute the character kit writes
  const near = (s: readonly number[]) => step(length(attribute('surface', 'vec4').sub(vec4(s[0], s[1], s[2], s[3]))), float(0.02));
  const flat = (rgb: number[]) => { const mm = new THREE.MeshBasicNodeMaterial(); mm.colorNode = vec3(rgb[0], rgb[1], rgb[2]); mm.fog = false; return mm; };
  const bodyMatte = (team: number) => {
    const [a, f, o] = MATTE[team];
    const isA = near(SURF.armor), isF = near(SURF.fur);
    const mm = new THREE.MeshBasicNodeMaterial();
    const ua = uniform(new THREE.Vector3(...a)), uf = uniform(new THREE.Vector3(...f)), uo = uniform(new THREE.Vector3(...o));
    mm.colorNode = ua.mul(isA).add(uf.mul(isF)).add(uo.mul(float(1).sub(isA).sub(isF).max(0)));
    mm.fog = false;
    return mm;
  };
  const mattes = [0, 1].map((t) => ({ body: bodyMatte(t), armour: flat(MATTE[t][0]), coat: flat(MATTE[t][1]), other: flat(MATTE[t][2]) }));
  const blacks = new Map<THREE.Material, THREE.Material>();
  const blackOf = (mat: THREE.Material) => {
    let b = blacks.get(mat);
    if (!b) {
      const n = new THREE.MeshBasicNodeMaterial({ side: mat.side });
      n.colorNode = vec3(0, 0, 0);
      n.positionNode = (mat as THREE.NodeMaterial).positionNode ?? null;   // displaced or swaying geometry stays put
      n.fog = false;
      blacks.set(mat, n);
      b = n;
    }
    return b;
  };
  const toMatte = (): (() => void) => {
    const undo: Array<() => void> = [];
    const bg = scene.background, fog = scene.fog;
    undo.push(() => { scene.background = bg; scene.fog = fog; });
    scene.background = new THREE.Color(0); scene.fog = null;
    const owner = new Map<THREE.Object3D, EntityState>();
    for (const s of states.values()) {
      const v = views.get(s.id);
      if (v) v.avatar.root.traverse((o) => owner.set(o, s));
    }
    scene.traverse((o) => {
      if (o === scene) return;
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      const s = owner.get(o);
      const drawable = mesh.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite;
      if (!drawable) return;
      const hide = () => { if (o.visible) { undo.push(() => { o.visible = true; }); o.visible = false; } };
      if (!mesh.isMesh || !mat) { hide(); return; }
      if (s && s.kind === EntityKind.Bot) {
        const k = s.team === 1 ? 1 : 0;
        // a slab pet (TW-PETS): one group per surface [Godot's matte: plate and band = armour, coat = coat, accent, dark
        // and the whole rifle (its band strip too) = the rest of the pet]
        const groups = mesh.userData.petSurfaces as readonly string[] | undefined;
        if (groups && Array.isArray(mat)) {
          undo.push(() => { mesh.material = mat; });
          mesh.material = groups.map((n) => (mesh.userData.rifle ? mattes[k].other
            : n === 'plate' || n === 'band' ? mattes[k].armour : n === 'coat' ? mattes[k].coat : mattes[k].other));
          return;
        }
        const isBody = !Array.isArray(mat) && !!mesh.geometry.getAttribute('surface');
        undo.push(() => { mesh.material = mat; });
        mesh.material = isBody ? mattes[k].body : mattes[k].other;
        return;
      }
      const list = Array.isArray(mat) ? mat : [mat];
      if (list.some((m) => m.transparent)) { hide(); return; }
      undo.push(() => { mesh.material = mat; });
      mesh.material = Array.isArray(mat) ? mat.map(blackOf) : blackOf(mat);
    });
    return () => { while (undo.length) undo.pop()!(); };
  };

  const W = () => renderer.domElement.width, H = () => renderer.domElement.height;
  const readback = async (rt: THREE.RenderTarget): Promise<string> => {
    const w = W(), h = H();
    const px = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)) as Uint8Array;
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
    const g2 = c2.getContext('2d')!;
    const img = g2.createImageData(w, h);
    const row = w * 4;
    // WebGPU targets read back top-down; WebGL2 (readPixels) bottom-up
    if (ctx.backend === 'webgl') for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    else img.data.set(px.subarray(0, w * h * 4));
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    g2.putImageData(img, 0, 0);
    return c2.toDataURL('image/png');
  };
  lab.capture = async () => {
    const rt = new THREE.RenderTarget(W(), H(), { type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace, depthBuffer: true });
    renderer.setRenderTarget(rt); ctx.render(); renderer.setRenderTarget(null);
    const normal = await readback(rt);
    const undo = toMatte();
    const tm = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    try {
      renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(null);
    } finally {
      renderer.toneMapping = tm;
      undo();
    }
    const mask = await readback(rt);
    rt.dispose();
    return { w: W(), h: H(), normal, mask };
  };

  // ready once every Lot kit GLB has loaded and a few frames have drawn
  const split = splitLotKitPrims(data);
  const want = split.pieces.filter((p) => p.placements.length).length;
  for (let i = 0; i < 3000; i++) {
    frame(1 / 60);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    if ((view.stats() as Record<string, number>).kitLoaded === want && i > 3) break;
  }
  lab.ready = true;
}

main().catch((e) => { lab.error = String((e as Error)?.stack ?? e); console.error(e); });
