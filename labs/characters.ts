// Character lab: lineups / turntables / action poses / face close-ups of the procedural cast,
// rendered through the real comic pipeline (toon bands, ink outline pass, bloom, grade).
//
// URL params
//   view=grid|front|side|back|action|face|portrait|turntable|ots   camera + layout preset (default grid)
//   anim=idle|walk|run|sprint|jump|fall|aim|aimfwd|fire|hit|death|emote|slide|swim|cycle   (default: per view)
//   species=corgi|cat  cls=assault  coat=red|tabby|…  team=0|1  expr=smug|…  npc (NPC tier)
//   t=1.5   pre-simulate 1.5 s at 60 Hz, then freeze (deterministic screenshots); live=1 keeps running
//   webgl   force the WebGL2 backend (headless probe)        labels=0   hide name tags
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { createRenderContext } from '../src/client/engine/renderer';
import { toon } from '../src/client/style/style-webgpu.js';
import { PALETTE } from '../src/client/style/style-tokens.js';
import { createCharacter, variantFor, type CharacterAvatar } from '../src/client/procgen/characters';
import { Anim, CLASS_IDS, EFlag, Species, Team, type AnimId, type ClassId, type SpeciesId, type TeamId } from '../src/shared/types';
import type { AvatarFrame } from '../src/client/views/avatar';
import type { Expression } from '../src/client/anim/face';

const P = new URLSearchParams(location.search);
const view = P.get('view') ?? 'grid';
const info = document.getElementById('info')!;
const labelsEl = document.getElementById('labels')!;

type AnimName = 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'fall' | 'glide' | 'aim' | 'aimfwd' | 'fire' | 'hit' | 'death' | 'emote' | 'slide' | 'swim' | 'cycle';
const CYCLE: AnimName[] = ['idle', 'walk', 'run', 'sprint', 'jump', 'aim', 'fire', 'hit', 'death', 'emote'];

interface Spec { species: SpeciesId; coat?: string; cls: ClassId; team: TeamId; anim: AnimName; expr?: Expression; x: number; z: number; yaw: number }

/** Smallest seed ≥ 1 whose variant is `coat`. */
function seedFor(species: SpeciesId, coat: string | undefined, salt = 0): number {
  if (!coat) return 1 + salt;
  for (let s = 1 + salt * 97; s < 100000; s++) if (variantFor(species, s).name === coat) return s;
  return 1;
}

const corgiCoats = ['red', 'sable', 'tri'];
const catCoats = ['tabby', 'siamese', 'chonk', 'sphynx', 'tuxedo', 'ginger'];
const forcedAnim = P.get('anim') as AnimName | null;
const forcedExpr = P.get('expr') as Expression | null;
const only = P.get('species');
const clsParam = P.get('cls');

function layout(): Spec[] {
  const out: Spec[] = [];
  const add = (s: Partial<Spec> & { species: SpeciesId; cls: ClassId }) => out.push({ team: s.species === Species.Cat ? Team.Cats : Team.Corgis, anim: 'idle', x: 0, z: 0, yaw: 0, ...s });
  switch (view) {
    case 'front':
    case 'back': {
      // 3 corgis + 3 cats, 3 classes each, large.
      const cls: ClassId[] = ['assault', 'overwatch', 'breacher'];
      cls.forEach((c, i) => add({ species: Species.Corgi, coat: corgiCoats[i], cls: c, x: -3.3 + i * 1.1, z: 0 }));
      cls.forEach((c, i) => add({ species: Species.Cat, coat: catCoats[i * 2], cls: c, x: 0.55 + i * 1.1, z: 0 }));
      break;
    }
    case 'side': {
      const cls: ClassId[] = ['assault', 'infiltrator', 'warden'];
      cls.forEach((c, i) => add({ species: Species.Corgi, coat: corgiCoats[i], cls: c, x: 0, z: -3.3 + i * 1.3, yaw: 0 }));
      cls.forEach((c, i) => add({ species: Species.Cat, coat: catCoats[i + 3], cls: c, x: 0, z: 0.6 + i * 1.3, yaw: 0 }));
      break;
    }
    case 'action': {
      const acts: [SpeciesId, string, ClassId, AnimName][] = [
        [Species.Corgi, 'red', 'assault', 'sprint'], [Species.Cat, 'tabby', 'assault', 'fire'], [Species.Corgi, 'tri', 'breacher', 'jump'],
        [Species.Cat, 'ginger', 'skyraider', 'sprint'], [Species.Corgi, 'sable', 'infiltrator', 'death'], [Species.Cat, 'tuxedo', 'warden', 'emote'],
      ];
      acts.forEach(([sp, coat, c, a], i) => add({ species: sp, coat, cls: c, anim: a, x: -3.3 + i * 1.3, z: 0, yaw: a === 'sprint' ? Math.PI / 2 - 0.3 : -0.35 }));
      break;
    }
    case 'face': {
      const ex: Expression[] = ['neutral', 'smug', 'furious', 'terrified', 'derp', 'happy'];
      const one = only === 'corgi' ? Species.Corgi : only === 'cat' ? Species.Cat : null;
      ex.forEach((e, i) => {
        const sp = one ?? (i % 2 ? Species.Cat : Species.Corgi);
        const coat = sp === Species.Cat ? catCoats[one === null ? (i >> 1) * 2 : i % 6] : corgiCoats[one === null ? i >> 1 : i % 3];
        add({ species: sp, coat, cls: one === null ? CLASS_IDS[i] : 'infiltrator', expr: e, x: 1.95 - i * 0.78, z: 0 });
      });
      break;
    }
    case 'ots':
    case 'portrait':
    case 'turntable': {
      add({ species: only === 'cat' ? Species.Cat : Species.Corgi, coat: P.get('coat') ?? undefined, cls: (clsParam as ClassId) ?? 'assault' });
      break;
    }
    default: { // grid: every class, corgi row in front, cat row behind
      CLASS_IDS.forEach((c, i) => add({ species: Species.Corgi, coat: corgiCoats[i % 3], cls: c, x: -3.6 + i * 1.44, z: -1.1 }));
      CLASS_IDS.forEach((c, i) => add({ species: Species.Cat, coat: catCoats[i], cls: c, x: -3.6 + i * 1.44, z: 1.1 }));
    }
  }
  let list = out;
  if (view !== 'face' && only === 'corgi') list = list.filter((s) => s.species === Species.Corgi);
  if (view !== 'face' && only === 'cat') list = list.filter((s) => s.species === Species.Cat);
  if (clsParam && view !== 'turntable') list = list.map((s) => ({ ...s, cls: clsParam as ClassId }));
  if (P.has('team')) list = list.map((s) => ({ ...s, team: Number(P.get('team')) as TeamId }));
  if (forcedAnim) list = list.map((s) => ({ ...s, anim: forcedAnim }));
  if (forcedExpr) list = list.map((s) => ({ ...s, expr: forcedExpr }));
  return list;
}

/** Feeds an avatar the frames a real entity in that state would produce. */
class Driver {
  t = 0;
  private nextFire = 0;
  private nextHit = 0.3;
  private nextEmote = 0.1;
  private deathSent = false;
  constructor(readonly av: CharacterAvatar, readonly anim: AnimName, readonly phase: number) {}
  current(): AnimName {
    if (this.anim !== 'cycle') return this.anim;
    return CYCLE[Math.floor((this.t + this.phase) / 2.6) % CYCLE.length];
  }
  step(dt: number): void {
    this.t += dt;
    const a = this.current();
    const f: AvatarFrame = { speed: 0, vy: 0, grounded: true, anim: Anim.Idle as AnimId, flags: 1, aimPitch: 0.05, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false };
    switch (a) {
      case 'walk': f.speed = 3.6; f.anim = Anim.Walk; break;
      case 'run': f.speed = 6.4; f.anim = Anim.Run; break;
      case 'sprint': f.speed = 9.6; f.anim = Anim.Sprint; f.sprinting = true; break;
      case 'jump': { const k = (this.t % 1.2) / 1.2; f.grounded = false; f.vy = 7 - 16 * k; f.anim = f.vy > 0 ? Anim.Jump : Anim.Fall; break; }
      case 'fall': f.grounded = false; f.vy = -9; f.anim = Anim.Fall; break;
      case 'glide': f.grounded = false; f.vy = -2.5; f.speed = 8; f.anim = Anim.Fall; f.flags = EFlag.Gliding; break;
      case 'aim': f.aiming = true; f.aimPitch = 0.3 * Math.sin(this.t * 0.8); f.aimYawOffset = 0.25 * Math.sin(this.t * 0.5); break;
      case 'aimfwd': f.aiming = true; f.aimPitch = Number(P.get('pitch') ?? 0); break;
      case 'fire':
        f.aiming = true; f.firing = true; f.aimPitch = 0.12;
        if (this.t >= this.nextFire) { this.av.trigger('fire', 1); this.nextFire = this.t + 0.14; }
        break;
      case 'hit': if (this.t >= this.nextHit) { this.av.trigger('hit', 1); this.nextHit = this.t + 1.1; } f.hpFrac = 0.6; break;
      case 'death': f.dead = true; f.anim = Anim.Dead; f.hpFrac = 0; if (!this.deathSent) { this.av.trigger('death'); this.deathSent = true; } break;
      case 'emote': if (this.t >= this.nextEmote) { this.av.trigger('emote'); this.nextEmote = this.t + 2.6; } break;
      case 'slide': f.speed = 7; f.anim = Anim.Slide; break;
      case 'swim': f.speed = 2; f.anim = Anim.Swim; break;
    }
    if (a !== 'death') this.deathSent = false;
    this.av.update(f, dt);
  }
}

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const ctx = await createRenderContext(app, { forceWebGL: P.has('webgl') });
  const { scene, camera, renderer } = ctx;
  scene.background = new THREE.Color(PALETTE.void);

  // Ground + key-light shadows so grounding is visible.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48).rotateX(-Math.PI / 2), toon({ color: PALETTE.grass }));
  ground.receiveShadow = true;
  scene.add(ground);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(6.5, 48).rotateX(-Math.PI / 2), toon({ color: PALETTE.grassDry }));
  pad.position.y = 0.002; pad.receiveShadow = true;
  scene.add(pad);
  scene.traverse((o) => {
    const l = o as THREE.DirectionalLight;
    if (l.isDirectionalLight && l.intensity > 2) {
      l.castShadow = true;
      l.shadow.mapSize.set(2048, 2048);
      const c = l.shadow.camera as THREE.OrthographicCamera;
      c.left = -7; c.right = 7; c.top = 7; c.bottom = -7; c.near = 0.5; c.far = 40;
      l.shadow.bias = -0.0005;
    }
  });

  const specs = layout();
  const drivers: Driver[] = [];
  const tags: { el: HTMLDivElement; av: CharacterAvatar }[] = [];
  const npc = P.has('npc');
  specs.forEach((s, i) => {
    const seed = seedFor(s.species, s.coat, i);
    const av = createCharacter({ species: s.species, cls: s.cls, team: s.team, seed, isLocal: !npc });
    av.root.position.set(s.x, 0, s.z);
    av.root.rotation.y = s.yaw;
    if (s.expr) av.setExpression(s.expr);
    scene.add(av.root);
    drivers.push(new Driver(av, s.anim, i * 0.9));
    if (P.get('labels') !== '0' && (view === 'grid' || view === 'face' || view === 'action')) {
      const el = document.createElement('div');
      el.className = 'lbl';
      el.textContent = `${av.stats.variant} ${s.cls}${s.expr ? ' · ' + s.expr : s.anim !== 'idle' ? ' · ' + s.anim : ''}`;
      labelsEl.appendChild(el);
      tags.push({ el, av });
    }
  });

  // Camera presets.
  const target = new THREE.Vector3();
  const setCam = (px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov: number) => {
    camera.position.set(px, py, pz); target.set(tx, ty, tz); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(target);
  };
  switch (view) {
    case 'front': setCam(-1.3, 1.3, -6.4, -0.28, 0.62, 0, 36); break;
    case 'back': setCam(0.8, 1.45, 6.4, -0.28, 0.62, 0, 36); break;
    case 'side': setCam(7.4, 0.95, -0.35, 0, 0.55, -0.35, 40); break;
    case 'action': setCam(-1.2, 1.5, -7.6, -0.05, 0.5, 0, 40); break;
    case 'face': setCam(0, 1.12, -4.2, 0, 1.0, 0, 26); break;
    case 'turntable': setCam(-1.1, 1.05, -2.9, 0, 0.66, 0, 34); break;
    // Over-the-shoulder aim camera (third-person.ts: pivot +1.25 m, shoulder 0.75 m, 2.3 m back, fov 48).
    case 'ots': setCam(0.75, 1.3, 2.3, 0.75, 1.1, -20, 48); break;
    case 'portrait': if (forcedAnim === 'death') setCam(-0.6, 1.7, -0.9, 0, 0.1, 0.55, 40); else setCam(-0.4, Number(P.get('camy') ?? 0.99), -1.6, 0, 0.95, 0, 30); break;
    default: setCam(-2.5, 3.1, -8.4, 0, 0.55, 0.3, 44);
  }

  const freeze = P.has('t') && !P.has('live');
  if (freeze) {
    const n = Math.round(Number(P.get('t')) * 60);
    for (let k = 0; k < n; k++) for (const d of drivers) d.step(1 / 60);
  }

  let last = performance.now(), frames = 0, fpsT = last, fps = 0;
  const v = new THREE.Vector3();
  const totalTris = drivers.reduce((a, d) => a + d.av.stats.triangles, 0);
  const maxDraws = Math.max(...drivers.map((d) => d.av.stats.drawCalls));
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!freeze) for (const d of drivers) d.step(dt);
    if (view === 'turntable' && !freeze) drivers[0].av.root.rotation.y += dt * 0.6;
    ctx.render();
    for (const tg of tags) {
      v.set(0, tg.av.height + 0.42, 0).applyMatrix4(tg.av.root.matrixWorld).project(camera);
      tg.el.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
      tg.el.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
    }
    frames++;
    if (now - fpsT > 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
    const inf = renderer.info.render as unknown as { drawCalls?: number; calls?: number; triangles?: number };
    info.textContent = `character lab · view=${view} · ${ctx.backend} · ${fps.toFixed(0)} fps\n` +
      `${drivers.length} characters · ${npc ? 'NPC' : 'hero'} tier · ${totalTris} tris (≤ ${Math.max(...drivers.map((d) => d.av.stats.triangles))} each) · ≤ ${maxDraws} draws each\n` +
      `frame: ${inf.drawCalls ?? inf.calls ?? '?'} draw calls (incl. ink + shadow passes)` + (freeze ? ` · frozen at t=${P.get('t')}s` : '');
    (globalThis as unknown as { __lab: unknown }).__lab = { ready: true, characters: drivers.length, fps, scene, THREE, TSL };
  });
}

main().catch((e) => { info.textContent = `lab failed: ${e?.stack ?? e}`; console.error(e); });
