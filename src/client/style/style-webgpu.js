// style-webgpu.js — comic / cel-shaded look for WebGPURenderer (three/webgpu + TSL), r183+.
// Same public API as style-webgl.js: toon(), glow(), addCreaseInk(), stylize(), createStyleLights(),
// createComicPipeline(). Never import both files (or 'three' and 'three/webgpu') in one app.
//
// Differences from WebGL that matter:
// - Ink hull comes from TSL toonOutlinePass: it outlines ONLY toon materials, with ONE global
//   thickness/color (no per-material params). Glass/glow must therefore be non-toon materials
//   to stay outline-free — glow() below returns MeshBasicNodeMaterial for that reason.
// - Post-processing uses THREE.RenderPipeline (renamed from PostProcessing in r183).
import * as THREE from 'three/webgpu';
import {
  toonOutlinePass, renderOutput, uniform, vec3, vec4, float, mix, smoothstep, luminance,
  screenUV, time, Fn, fract, sin, dot, vec2, min, normalize, cameraProjectionMatrix, modelViewMatrix,
  positionLocal, normalLocal,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { PALETTE, STYLE } from './style-tokens.js';
import { createToonGradient, smoothNormalsByPosition, matKey } from './style-utils.js';

let gradient = null;
const materialCache = new Map();

export function toon(p = {}) {
  const { color = PALETTE.hull, emissive = 0x000000, emissiveIntensity = 1, map = null,
    steps = STYLE.toonSteps, side = THREE.FrontSide, vertexColors = false } = p;
  const key = matKey({ color, emissive, emissiveIntensity, map: map?.uuid ?? null, steps, side, vertexColors });
  if (materialCache.has(key)) return materialCache.get(key);
  if (!gradient || gradient.image.width !== steps) gradient = createToonGradient(THREE, steps);
  const m = new THREE.MeshToonNodeMaterial({ color, emissive, emissiveIntensity, map, gradientMap: gradient, side, vertexColors });
  m.userData.style = 'toon';
  materialCache.set(key, m);
  return m;
}

/** Glowing parts: unlit, bright (>1 so bloom's threshold catches it), never outlined. */
export function glow(color = PALETTE.glowCyan, intensity = 3) {
  const key = matKey({ glow: color, intensity });
  if (materialCache.has(key)) return materialCache.get(key);
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = uniform(new THREE.Color(color)).mul(intensity); // vec3(Color) renders black in r186
  m.userData.style = 'glow';
  materialCache.set(key, m);
  return m;
}

export function addCreaseInk(mesh, { thresholdDeg = STYLE.crease.angleDeg, widthPx = STYLE.crease.widthPx, color = PALETTE.ink } = {}) {
  if (mesh.isSkinnedMesh || !mesh.geometry) return null;
  const edges = new THREE.EdgesGeometry(mesh.geometry, thresholdDeg);
  const geo = new LineSegmentsGeometry().fromEdgesGeometry(edges);
  edges.dispose();
  const mat = new THREE.Line2NodeMaterial({ color, linewidth: widthPx, worldUnits: false });
  const lines = new LineSegments2(geo, mat);
  lines.name = `${mesh.name || 'mesh'}_crease`;
  lines.userData.styleInk = true;
  mesh.add(lines);
  return lines;
}

export function stylize(root, { creases = true, creaseDeg, remap } = {}) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.styleInk) return;
    const convert = (m) => {
      if (!m || m.userData?.style) return m;
      if (remap) { const r = remap(m, o); if (r) return r; }
      const isGlow = m.emissive && m.emissive.getHex() !== 0 && (!m.color || m.color.getHex() === 0);
      if (isGlow) return glow(m.emissive.getHex(), m.emissiveIntensity ?? 3);
      const isGlass = m.transmission > 0 || (m.opacity < 1 && m.transparent);
      if (isGlass) return m; // keep non-toon => no ink hull
      return toon({
        color: m.color?.getHex() ?? PALETTE.hull,
        emissive: m.emissive?.getHex() ?? 0,
        emissiveIntensity: m.emissiveIntensity ?? 1,
        map: m.map ?? null,
        vertexColors: !!m.vertexColors,
      });
    };
    o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
    if (!o.geometry.userData.outlineReady) smoothNormalsByPosition(THREE, o.geometry);
    if (creases && !o.isInstancedMesh) addCreaseInk(o, creaseDeg ? { thresholdDeg: creaseDeg } : {});
  });
  return root;
}

export function createStyleLights() {
  const L = STYLE.lights, g = new THREE.Group();
  const key = new THREE.DirectionalLight(L.key.color, L.key.intensity); key.position.fromArray(L.key.dir).multiplyScalar(10);
  const rim = new THREE.DirectionalLight(L.rim.color, L.rim.intensity); rim.position.fromArray(L.rim.dir).multiplyScalar(10);
  g.add(key, rim, new THREE.HemisphereLight(L.ambientSky, L.ambientGround, L.ambientIntensity));
  g.name = 'style_lights';
  return g;
}

/** Split-tone + saturation + vignette + grain, applied AFTER tone mapping (display space). */
export function createGrade(tokens = STYLE.grade) {
  const u = {
    shadowTint: uniform(new THREE.Vector3(...tokens.shadowTint)),
    highlightTint: uniform(new THREE.Vector3(...tokens.highlightTint)),
    saturation: uniform(tokens.saturation),
    vignette: uniform(tokens.vignette),
    grain: uniform(tokens.grain),
  };
  const node = Fn(([c]) => {
    const l = luminance(c.rgb);
    const toned = mix(c.rgb.mul(u.shadowTint), c.rgb.mul(u.highlightTint), smoothstep(0.2, 0.8, l));
    const sat = mix(vec3(l), toned, u.saturation);
    const d = screenUV.sub(0.5);
    const vig = float(1).sub(dot(d, d).mul(u.vignette));
    const n = fract(sin(dot(screenUV, vec2(12.9898, 78.233)).add(time)).mul(43758.5453)).sub(0.5);
    return vec4(sat.mul(vig).add(n.mul(u.grain)), c.a);
  });
  return { node, uniforms: u };
}

/** Builds the output node graph (testable without a GPU). */
export function buildComicOutput(scene, camera, opts = {}) {
  const ink = uniform(new THREE.Color(PALETTE.ink));
  const thickness = uniform(opts.outlineThickness ?? STYLE.outline.thickness);
  const scenePass = toonOutlinePass(scene, camera, ink, thickness, STYLE.outline.alpha);
  const inkFar = uniform(opts.inkFar ?? STYLE.outline.farCap);
  capInkDistance(scenePass, inkFar);
  const b = { ...STYLE.bloom, ...opts.bloom };
  const bloomPass = bloom(scenePass, b.strength, b.radius, b.threshold);
  const grade = createGrade(opts.grade);
  const outputNode = grade.node(renderOutput(scenePass.add(bloomPass)));
  return { outputNode, scenePass, bloomPass, grade, uniforms: { ink, thickness, inkFar } };
}

/**
 * The outline hull is extruded by thickness × clip w (constant screen width at every distance). Cap w at `inkFar`
 * metres for this pass: near ink is unchanged, far ink thins with distance, and distant colours read again.
 * Same graph as three's ToonOutlinePassNode._createMaterial (r186) with min(pos.w, inkFar).
 */
function capInkDistance(pass, inkFar) {
  const create = pass._createMaterial.bind(pass);
  pass._createMaterial = () => {
    const material = create();
    const mvp = cameraProjectionMatrix.mul(modelViewMatrix);
    const pos = mvp.mul(vec4(positionLocal, 1.0));
    const pos2 = mvp.mul(vec4(positionLocal.add(normalLocal.negate()), 1.0));
    material.vertexNode = pos.add(normalize(pos.sub(pos2)).mul(pass.thicknessNode).mul(min(pos.w, inkFar)));
    return material;
  };
}

/**
 * Full pipeline. `await renderer.init()` first. Call pipeline.render() each frame.
 * Tone mapping + sRGB happen inside renderOutput(), so outputColorTransform is disabled.
 */
export function createComicPipeline(renderer, scene, camera, opts = {}) {
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, opts.maxPixelRatio ?? STYLE.maxPixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene.background ??= new THREE.Color(PALETTE.void);
  const built = buildComicOutput(scene, camera, opts);
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = built.outputNode;
  return { pipeline, ...built, render: () => pipeline.render(), setSize: (w, h) => renderer.setSize(w, h) };
}
