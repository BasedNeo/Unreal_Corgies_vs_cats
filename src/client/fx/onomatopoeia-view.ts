// OWNER: L5 (juice). Comic onomatopoeia billboards: every word pre-lettered once into a canvas atlas (ink
// stroke, drop shadow, gradient fill, starburst for the big ones), drawn as camera-facing instanced quads —
// one draw call for all words on screen. Pop-in overshoot, wobble, rise, shrink-out; a minimum on-screen
// size so far-away words stay legible; pooled (oldest word is recycled when the pool is full).
import * as THREE from 'three/webgpu';
import {
  vec2, vec4, uv, positionGeometry, cameraViewMatrix, cameraProjectionMatrix, instancedDynamicBufferAttribute,
  texture, cos, sin,
} from 'three/tsl';
import { WORDS, type Word } from './onomatopoeia';
import { FONT_COMIC, ensureFonts } from '../ui/fonts';

interface WordStyle { top: string; bottom: string; burst?: string }

const STYLE: Record<Word, WordStyle> = {
  'POW!': { top: '#fff27a', bottom: '#ff9b2e', burst: '#ff4b3a' },
  'BONK!': { top: '#fff6a8', bottom: '#f2c14e', burst: '#6fd0ff' },
  'BARK!': { top: '#ffe07a', bottom: '#e38a3a' },
  'WOOF!': { top: '#ffe07a', bottom: '#e38a3a' },
  'HISS!': { top: '#ffb0c0', bottom: '#d8374a' },
  'MROW!': { top: '#ffc2cf', bottom: '#c9344a' },
  'SQUEAK!': { top: '#f4ff9a', bottom: '#b9d82a' },
  'BOING!': { top: '#c9fdff', bottom: '#3fb6e0' },
  'KA-BOOM!': { top: '#fff27a', bottom: '#ff6a1f', burst: '#ffd04a' },
  'SPLAT!': { top: '#ffd9df', bottom: '#f07a8a' },
  'POOF!': { top: '#ffffff', bottom: '#c8c0b2' },
  'ZAP!': { top: '#ffc0c0', bottom: '#ff3b3b' },
  'THWUMP!': { top: '#ffd9a0', bottom: '#c0662e' },
  'WHOOSH!': { top: '#eefcff', bottom: '#8fcaff' },
  'SNAP!': { top: '#fff6c0', bottom: '#f2c14e' },
  'YOINK!': { top: '#fff4a8', bottom: '#f2b22e' },
  'FSSHH!': { top: '#d6f6ff', bottom: '#4fb3d9' },
  'KO!': { top: '#fff27a', bottom: '#ff9b2e', burst: '#d8374a' },
  // X1: breaking props
  'CRASH!': { top: '#fff2c0', bottom: '#e0823a', burst: '#ffd04a' },
  'CLANG!': { top: '#eef6ff', bottom: '#6fa8d8', burst: '#ffd04a' },
  'CRUNCH!': { top: '#ffe9b8', bottom: '#b9803e' },
};

const COLS = 4, ROWS = 8, CW = 256, CH = 128;

/** 3 = headline moments, 2 = hit/death beats, 1 = flavor (dropped when ≥ 3 words are on screen). */
const PRIORITY: Partial<Record<Word, number>> = { 'KO!': 3, 'KA-BOOM!': 3, 'CRASH!': 3, 'CLANG!': 2, 'CRUNCH!': 2, 'POW!': 2, 'BONK!': 2, 'POOF!': 2, 'SPLAT!': 2, 'BARK!': 2, 'HISS!': 2, 'YOINK!': 2 };

/** Draws every word into its atlas cell. Exported for the lab page. */
export function drawWordAtlas(canvas: HTMLCanvasElement, fontReady: boolean): void {
  canvas.width = COLS * CW; canvas.height = ROWS * CH;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  WORDS.forEach((w, i) => {
    const cx = (i % COLS) * CW + CW / 2, cy = Math.floor(i / COLS) * CH + CH / 2;
    const st = STYLE[w];
    g.save();
    g.translate(cx, cy);
    if (st.burst) drawBurst(g, st.burst, i);
    // Fit the lettering to the cell.
    let px = 78;
    const fam = fontReady ? `${px}px ${FONT_COMIC}` : `900 ${px}px ${FONT_COMIC}`;
    g.font = fam;
    const maxW = CW - 34;
    const mw = g.measureText(w).width;
    if (mw > maxW) px = Math.floor(px * (maxW / mw));
    g.font = fontReady ? `${px}px ${FONT_COMIC}` : `900 ${px}px ${FONT_COMIC}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.miterLimit = 2;
    const y = 4;
    // Ink drop shadow, fat ink stroke, gradient fill, then a thin highlight for the comic "print" feel.
    g.fillStyle = '#1a120c';
    g.strokeStyle = '#1a120c';
    g.lineWidth = Math.max(10, px * 0.2);
    g.strokeText(w, 5, y + 6);
    g.fillText(w, 5, y + 6);
    g.strokeText(w, 0, y);
    const grad = g.createLinearGradient(0, y - px * 0.45, 0, y + px * 0.45);
    grad.addColorStop(0, st.top);
    grad.addColorStop(0.55, st.top);
    grad.addColorStop(0.56, st.bottom);
    grad.addColorStop(1, st.bottom);
    g.fillStyle = grad;
    g.fillText(w, 0, y);
    g.globalAlpha = 0.55;
    g.lineWidth = Math.max(2, px * 0.035);
    g.strokeStyle = '#ffffff';
    g.strokeText(w, -1.5, y - 2);
    g.restore();
  });
}

function drawBurst(g: CanvasRenderingContext2D, color: string, seed: number): void {
  const n = 14;
  g.beginPath();
  for (let k = 0; k <= n * 2; k++) {
    const a = (k / (n * 2)) * Math.PI * 2;
    const jag = ((seed * 7 + k * 13) % 5) / 5;
    const r = k % 2 === 0 ? 1 : 0.64 + jag * 0.1;
    const x = Math.cos(a) * r * (CW * 0.49), y = Math.sin(a) * r * (CH * 0.49);
    if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = color;
  g.strokeStyle = '#1a120c';
  g.lineWidth = 7;
  g.lineJoin = 'miter';
  g.fill();
  g.stroke();
}

export interface OnomatopoeiaView {
  mesh: THREE.Mesh;
  /** Pops a word at a world position. Returns the slot used. */
  spawn(word: Word, x: number, y: number, z: number, scale?: number): number;
  update(dt: number, camera: THREE.Camera): void;
  readonly count: number;
  dispose(): void;
}

export function createOnomatopoeiaView(capacity = 14): OnomatopoeiaView {
  const canvas = document.createElement('canvas');
  drawWordAtlas(canvas, false);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  void ensureFonts().then((ok) => { if (ok) { drawWordAtlas(canvas, true); tex.needsUpdate = true; } });

  const posArr = new Float32Array(capacity * 4), cellArr = new Float32Array(capacity * 4), miscArr = new Float32Array(capacity * 4);
  const mk = (a: Float32Array) => { const at = new THREE.InstancedBufferAttribute(a, 4); at.setUsage(THREE.DynamicDrawUsage); return at; };
  const posAttr = mk(posArr), cellAttr = mk(cellArr), miscAttr = mk(miscArr);
  const aPos = instancedDynamicBufferAttribute<'vec4'>(posAttr, 'vec4');
  const aCell = instancedDynamicBufferAttribute<'vec4'>(cellAttr, 'vec4');
  const aMisc = instancedDynamicBufferAttribute<'vec4'>(miscAttr, 'vec4');

  const plane = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.getAttribute('position'));
  geo.setAttribute('uv', plane.getAttribute('uv'));
  geo.instanceCount = 0;

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.name = 'fx_onomatopoeia';
  mat.userData.style = 'fx';
  mat.transparent = true;
  mat.depthWrite = false;
  mat.fog = false;
  {
    const q = positionGeometry.xy;
    const w = aPos.w; // world width
    const rot = aMisc.x;
    const c = cos(rot), s = sin(rot);
    const local = vec2(q.x.mul(w), q.y.mul(w.mul(0.5)));
    const r = vec2(local.x.mul(c).sub(local.y.mul(s)), local.x.mul(s).add(local.y.mul(c)));
    const vc = cameraViewMatrix.mul(vec4(aPos.xyz, 1));
    // Pull toward the camera so the word never sinks into the character it belongs to.
    mat.vertexNode = cameraProjectionMatrix.mul(vec4(vc.x.add(r.x), vc.y.add(r.y), vc.z.add(aMisc.y), 1));
  }
  const sample = texture(tex, aCell.xy.add(uv().mul(aCell.zw)));
  mat.maskNode = sample.a.greaterThan(0.04);
  // ≤ 0.9 so the white highlight does not trip the bloom threshold.
  mat.colorNode = vec4(sample.rgb.mul(0.9), sample.a);
  mat.opacityNode = sample.a;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx_onomatopoeia';
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.visible = true; // pipeline compiles at load; 0 instances = no draw
  mesh.userData.noCameraCollide = true;

  // Per-word CPU state (SoA, preallocated).
  const wx = new Float32Array(capacity), wy = new Float32Array(capacity), wz = new Float32Array(capacity);
  const age = new Float32Array(capacity), life = new Float32Array(capacity), scl = new Float32Array(capacity);
  const tilt = new Float32Array(capacity), cell = new Int16Array(capacity);
  const sx = new Float32Array(capacity), sy = new Float32Array(capacity), sz = new Float32Array(capacity);
  let count = 0, steal = 0, seed = 1;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const range = { start: 0, count: 0 };
  const attrs = [posAttr, cellAttr, miscAttr];

  const view: OnomatopoeiaView = {
    mesh,
    get count() { return count; },
    spawn(word, x, y, z, scale = 1) {
      // Declutter: low-priority flavor words yield when the screen is busy; others stack upward instead of
      // overlapping a word that is already near the same spot.
      const prio = PRIORITY[word] ?? 1;
      if (prio === 1 && count >= 3) return -1;
      // Important words evict flavor words they would land on (expire them next update).
      if (prio >= 2) {
        for (let k = 0; k < count; k++) {
          if ((PRIORITY[WORDS[cell[k]]] ?? 1) === 1 && Math.abs(wx[k] - x) < 2 && Math.abs(wz[k] - z) < 2 && Math.abs(wy[k] - y) < 1.2) age[k] = life[k];
        }
      }
      for (let pass = 0; pass < 4; pass++) {
        let bumped = false;
        for (let k = 0; k < count; k++) {
          if (age[k] >= life[k]) continue;
          const ky = wy[k] + age[k] * 0.7;
          if (Math.abs(wx[k] - x) < 1.6 * scl[k] && Math.abs(wz[k] - z) < 1.6 && Math.abs(ky - y) < 0.65) { y = ky + 0.75; bumped = true; }
        }
        if (!bumped) break;
      }
      let i: number;
      if (count < capacity) i = count++;
      else { i = steal; steal = (steal + 1) % capacity; }
      seed = (seed * 16807) % 2147483647;
      const r = seed / 2147483647;
      wx[i] = x; wy[i] = y; wz[i] = z;
      age[i] = 0; life[i] = 0.95 + scale * 0.1; scl[i] = scale;
      tilt[i] = (r - 0.5) * 0.45;
      cell[i] = WORDS.indexOf(word);
      return i;
    },
    update(dt, camera) {
      let i = 0;
      while (i < count) {
        age[i] += dt;
        if (age[i] >= life[i]) {
          const l = --count;
          if (i !== l) { wx[i] = wx[l]; wy[i] = wy[l]; wz[i] = wz[l]; age[i] = age[l]; life[i] = life[l]; scl[i] = scl[l]; tilt[i] = tilt[l]; cell[i] = cell[l]; }
          continue;
        }
        i++;
      }
      if (steal >= count) steal = 0;
      // Screen-space declutter: a flavor word overlapping a more important word on screen yields (expires),
      // even when the two are at different depths.
      const pc = camera as THREE.PerspectiveCamera;
      const tanY = Math.tan(((pc.fov ?? 60) * Math.PI) / 360), aspect = pc.aspect ?? 16 / 9;
      for (let a = 0; a < count; a++) {
        tmp.set(wx[a], wy[a] + age[a] * 0.7, wz[a]).project(camera);
        sx[a] = tmp.x; sy[a] = tmp.y; sz[a] = tmp.z;
      }
      const camP = camera.getWorldPosition(tmp2);
      for (let a = 0; a < count; a++) {
        const pa = PRIORITY[WORDS[cell[a]]] ?? 1;
        if (pa !== 1 || sz[a] > 1) continue;
        const da = Math.max(0.5, Math.hypot(wx[a] - camP.x, wy[a] - camP.y, wz[a] - camP.z));
        const hwA = (0.7 * scl[a]) / (da * tanY * aspect);
        for (let b = 0; b < count; b++) {
          if (b === a || (PRIORITY[WORDS[cell[b]]] ?? 1) < 2) continue;
          const db = Math.max(0.5, Math.hypot(wx[b] - camP.x, wy[b] - camP.y, wz[b] - camP.z));
          const hwB = (0.7 * scl[b]) / (db * tanY * aspect);
          if (Math.abs(sx[a] - sx[b]) < (hwA + hwB) * 0.9 && Math.abs(sy[a] - sy[b]) < (hwA + hwB) * aspect * 0.45) { age[a] = life[a]; break; }
        }
      }
      const cam = camera.getWorldPosition(tmp);
      for (let k = 0; k < count; k++) {
        const t = age[k], L = life[k];
        // Pop: back-out overshoot to 1.25 in 90 ms, settle to 1 by 220 ms, shrink out over the last 180 ms.
        let s: number;
        if (t < 0.09) { const u = t / 0.09; s = 1.25 * (1 - (1 - u) * (1 - u) * (1 - u)); }
        else if (t < 0.22) s = 1.25 - 0.25 * ((t - 0.09) / 0.13);
        else if (t > L - 0.18) { const u = (L - t) / 0.18; s = u * u; }
        else s = 1;
        const dx = wx[k] - cam.x, dy = wy[k] - cam.y, dz = wz[k] - cam.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        // World width 1.4 m, never smaller than ~8% of the view far away, never more than ~30% of it up close.
        const width = Math.min(4.5, dist * 0.32, Math.max(1.4, dist * 0.1)) * scl[k] * s;
        const o = k * 4;
        posArr[o] = wx[k]; posArr[o + 1] = wy[k] + t * 0.7; posArr[o + 2] = wz[k]; posArr[o + 3] = width;
        const c = cell[k], col = c % COLS, row = Math.floor(c / COLS);
        cellArr[o] = col / COLS; cellArr[o + 1] = 1 - (row + 1) / ROWS; cellArr[o + 2] = 1 / COLS; cellArr[o + 3] = 1 / ROWS;
        miscArr[o] = tilt[k] + Math.sin(t * 18) * 0.05 * (1 - Math.min(1, t * 3)); miscArr[o + 1] = Math.min(1.2, dist * 0.25); miscArr[o + 2] = 0; miscArr[o + 3] = 0;
      }
      geo.instanceCount = count;
      if (count > 0) {
        range.count = count * 4;
        for (let a = 0; a < attrs.length; a++) { const at = attrs[a]; at.updateRanges.length = 0; at.updateRanges.push(range); at.needsUpdate = true; }
      }
    },
    dispose() { geo.dispose(); plane.dispose(); mat.dispose(); tex.dispose(); },
  };
  return view;
}
