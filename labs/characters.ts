// Character lab: lineups / turntables / action poses / face close-ups of the procedural cast,
// rendered through the real comic pipeline (toon bands, ink outline pass, bloom, grade).
//
// URL params
//   view=grid|front|side|back|action|face|portrait|turntable|ots|lineup|roster|vets|closeup   camera + layout preset (default grid)
//   K2 (HARDENED): roster = every class, corgis (team Corgis) in front, cats (team Cats) behind, the two veterans on
//     the right, at ~5 m (`facing=back` turns them round); vets = the corgi sergeant + the cat commander, front and
//     back; closeup = one character's head + chest at 3/4 (species, cls, vet=1, yaw=deg). vet=1 makes every
//     character a veteran; swap=1 puts each species in the other team's signal colours (the tests' mixed case).
//   anim=idle|walk|run|sprint|jump|fall|glide|aim|aimfwd|fire|hit|kill|death|emote|slide|swim|cycle   (default: per view)
//   lineup: every class x both species at `dist` m (default 35) from a gameplay camera (`fov`, default 62 =
//     hip-fire), groups facing the camera / away (`facing=front,back,side`). sil=1 renders flat ink silhouettes.
//   camera overrides (any view): cam=x,y,z  at=x,y,z  fov=deg
//   inkfar=8   EXPERIMENT (lab only): cap the ink hull's screen-constant width beyond 8 m, so distant ink
//              thins like world-space lines (the proposal for the style lane, see docs/handoff/K1.md)
//   species=corgi|cat  cls=assault  coat=red|tabby|…  team=0|1  expr=smug|…  npc (NPC tier)
//   t=1.5   pre-simulate 1.5 s at 60 Hz, then freeze (deterministic screenshots); live=1 keeps running
//   webgl   force the WebGL2 backend (headless probe)        labels=0   hide name tags     bare=1   hide the weapons
//   inkmin=0   P3 A/B: draw every ink hull (default: the renderer's ink LOD skips hulls under 0.3 px, engine/renderer.ts)
//   W9 K3: view=squads = the alley-cat raider and the tabby heavy (team Cats) from the front and from behind, with a
//     grunt (assault) and a kitten (infiltrator) for scale; view=pve = the whole PvE cat family in a row (grunt, kitten,
//     sniper, brute, raider, heavy); squad=alley|heavy puts every character of any view in that squad kit.
//     anim applies as usual (aimfwd / fire show the heavy's bin lid in the aim pose).
//   mask=1   readability bench: black background, no ground, every character flat white (a glow material, no ink):
//            the pixel mask for tools that measure the characters' rendered luma / team hue (same frozen frame).
//   __lab.boxes: per character { x0, y0, x1, y1 } in CSS px, species, team, cls, squad (measurement tools).
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { createRenderContext } from '../src/client/engine/renderer';
import { toon } from '../src/client/style/style-webgpu.js';
import { PALETTE } from '../src/client/style/style-tokens.js';
import { createCharacter, variantFor, type CharacterAvatar } from '../src/client/procgen/characters';
import { glow } from '../src/client/style/style-webgpu.js';
import type { SquadKit } from '../src/sim/ai/archetypes';
import { Anim, CLASS_IDS, EFlag, Species, Team, type AnimId, type ClassId, type SpeciesId, type TeamId } from '../src/shared/types';
import type { AvatarFrame } from '../src/client/views/avatar';
import type { Expression } from '../src/client/anim/face';

const P = new URLSearchParams(location.search);
const view = P.get('view') ?? 'grid';
const info = document.getElementById('info')!;
const labelsEl = document.getElementById('labels')!;

type AnimName = 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'fall' | 'glide' | 'aim' | 'aimfwd' | 'fire' | 'hit' | 'kill' | 'death' | 'emote' | 'slide' | 'swim' | 'cycle';
const CYCLE: AnimName[] = ['idle', 'walk', 'run', 'sprint', 'jump', 'aim', 'fire', 'hit', 'death', 'emote'];

interface Spec { species: SpeciesId; coat?: string; cls: ClassId; team: TeamId; anim: AnimName; expr?: Expression; x: number; z: number; yaw: number; vet?: boolean; squad?: SquadKit; tag?: string }

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
const num = (k: string, d: number) => (P.has(k) ? Number(P.get(k)) : d);
const vec = (k: string): number[] | null => (P.has(k) ? P.get(k)!.split(',').map(Number) : null);
/** Lineup camera (third-person height, looking along -Z at the row). */
const LINEUP_CAM = [0, 1.7, 17.5] as const;

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
    case 'lineup': {
      // Arc of characters `dist` m from the camera: one group per (facing, species), all six classes each.
      const dist = num('dist', 35);
      const facings = (P.get('facing') ?? 'front,back').split(',');
      const groups: [SpeciesId, string][] = [];
      for (const f of facings) for (const sp of [Species.Corgi, Species.Cat]) groups.push([sp, f]);
      const step = 1.9 / dist, gap = 1.6 / dist;
      const span = groups.length * CLASS_IDS.length * step + (groups.length - 1) * gap - step;
      let a = -span / 2;
      groups.forEach(([sp, f]) => {
        CLASS_IDS.forEach((c, i) => {
          const x = LINEUP_CAM[0] + dist * Math.sin(a), z = LINEUP_CAM[2] - dist * Math.cos(a);
          const toCam = Math.atan2(-(LINEUP_CAM[0] - x), -(LINEUP_CAM[2] - z));
          const yaw = f === 'back' ? toCam + Math.PI : f === 'side' ? toCam + Math.PI / 2 : toCam;
          add({ species: sp, coat: sp === Species.Cat ? catCoats[i] : corgiCoats[i % 3], cls: c, x, z, yaw, tag: f });
          a += step;
        });
        a += gap;
      });
      break;
    }
    case 'roster': {
      // Every class: corgis (team Corgis) in front, cats (team Cats) behind, the veterans on the right.
      const back = P.get('facing') === 'back' ? Math.PI : 0;
      CLASS_IDS.forEach((c, i) => add({ species: Species.Corgi, coat: corgiCoats[i % 3], cls: c, x: -3.3 + i * 1.08, z: -0.7, yaw: back }));
      CLASS_IDS.forEach((c, i) => add({ species: Species.Cat, coat: catCoats[i], cls: c, x: -2.76 + i * 1.08, z: 2.2, yaw: back }));
      add({ species: Species.Corgi, coat: 'red', cls: 'assault', x: 3.35, z: -0.7, yaw: back, vet: true });
      add({ species: Species.Cat, coat: 'tabby', cls: 'overwatch', x: 3.9, z: 2.2, yaw: back, vet: true });
      break;
    }
    case 'vets': {
      // The corgi sergeant and the cat commander, from the front and from behind.
      const vc = (clsParam as ClassId) ?? 'assault';
      add({ species: Species.Corgi, coat: 'red', cls: vc, x: -1.7, z: 0, vet: true, yaw: 0.25 });
      add({ species: Species.Cat, coat: 'tabby', cls: vc, x: -0.55, z: 0, vet: true, yaw: -0.25 });
      add({ species: Species.Corgi, coat: 'red', cls: vc, x: 0.6, z: 0, vet: true, yaw: Math.PI - 0.3 });
      add({ species: Species.Cat, coat: 'tabby', cls: vc, x: 1.75, z: 0, vet: true, yaw: Math.PI + 0.3 });
      break;
    }
    case 'closeup': {
      add({ species: only === 'cat' ? Species.Cat : Species.Corgi, coat: P.get('coat') ?? undefined, cls: (clsParam as ClassId) ?? 'assault', yaw: (num('yaw', 20) * Math.PI) / 180 });
      break;
    }
    case 'squads': {
      // K3: raider + heavy from the front (left) and from behind (right); a grunt and a kitten beside them for scale.
      add({ species: Species.Cat, coat: 'tabby', cls: 'assault', x: -2.5, z: 0.4, yaw: 0.2 });
      add({ species: Species.Cat, coat: 'ginger', cls: 'infiltrator', squad: 'alley', x: -1.45, z: 0, yaw: 0.25 });
      add({ species: Species.Cat, coat: 'tabby', cls: 'assault', squad: 'heavy', x: -0.3, z: 0, yaw: -0.2 });
      add({ species: Species.Cat, coat: 'ginger', cls: 'infiltrator', squad: 'alley', x: 0.85, z: 0, yaw: Math.PI - 0.3 });
      add({ species: Species.Cat, coat: 'tabby', cls: 'assault', squad: 'heavy', x: 2.0, z: 0, yaw: Math.PI + 0.3 });
      add({ species: Species.Cat, coat: 'tuxedo', cls: 'infiltrator', x: 3.0, z: 0.4, yaw: -0.2 });
      break;
    }
    case 'pve': {
      // K3: the PvE cat family as the waves field it (archetype class kits + the two squad kits).
      const fam: [ClassId, SquadKit | undefined][] = [['assault', undefined], ['infiltrator', undefined], ['overwatch', undefined], ['warden', undefined], ['infiltrator', 'alley'], ['assault', 'heavy']];
      fam.forEach(([c, sq], i) => add({ species: Species.Cat, coat: catCoats[i], cls: c, squad: sq, x: -3.3 + i * 1.32, z: 0, yaw: 0 }));
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
  if (view !== 'face' && view !== 'closeup' && only === 'corgi') list = list.filter((s) => s.species === Species.Corgi);
  if (view !== 'face' && view !== 'closeup' && only === 'cat') list = list.filter((s) => s.species === Species.Cat);
  if (clsParam && view !== 'turntable' && view !== 'roster' && view !== 'squads' && view !== 'pve') list = list.map((s) => ({ ...s, cls: clsParam as ClassId }));
  if (P.get('vet') === '1') list = list.map((s) => ({ ...s, vet: true }));
  const sq = P.get('squad');
  if (sq === 'alley' || sq === 'heavy') list = list.map((s) => ({ ...s, squad: sq as SquadKit }));
  if (P.get('swap') === '1') list = list.map((s) => ({ ...s, team: (s.team === Team.Cats ? Team.Corgis : Team.Cats) as TeamId }));
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
  private nextKill = 0.2;
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
      case 'kill': if (this.t >= this.nextKill) { this.av.trigger('kill'); this.nextKill = this.t + 3; } break;
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

/** Lab-only experiment: ink width constant in screen space up to `d` m, then constant in world space. */
function capInkDistance(d: number): void {
  type OutlinePass = { thicknessNode: unknown; _createMaterial(): THREE.NodeMaterial };
  const proto = (THREE as unknown as { ToonOutlinePassNode: { prototype: OutlinePass } }).ToonOutlinePassNode.prototype;
  const orig = proto._createMaterial;
  proto._createMaterial = function (this: OutlinePass) {
    const m = orig.call(this);
    const mvp = TSL.cameraProjectionMatrix.mul(TSL.modelViewMatrix);
    const pos = mvp.mul(TSL.vec4(TSL.positionLocal, 1));
    const pos2 = mvp.mul(TSL.vec4(TSL.positionLocal.add(TSL.normalLocal.negate()), 1));
    const thickness = this.thicknessNode as ReturnType<typeof TSL.float>;
    m.vertexNode = pos.add(TSL.normalize(pos.sub(pos2)).mul(thickness).mul(TSL.min(pos.w, TSL.float(d))));
    return m;
  };
}

async function main(): Promise<void> {
  if (P.has('inkfar')) capInkDistance(Number(P.get('inkfar')));
  const app = document.getElementById('app')!;
  const ctx = await createRenderContext(app, { forceWebGL: P.has('webgl'), inkMinPx: P.has('inkmin') ? Number(P.get('inkmin')) : undefined });
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

  let silMat: THREE.Material | null = null;
  if (view === 'lineup') scene.fog = new THREE.FogExp2(0xbfe3f4, 0.003); // same haze as the game sky
  const mask = P.get('mask') === '1';
  let maskMat: THREE.Material | null = null;
  if (mask) {
    // K3 readability bench: characters flat white on black, nothing else (a style glow material: unlit, not inked).
    scene.background = new THREE.Color(0x000000);
    scene.fog = null;
    ground.visible = false; pad.visible = false;
    maskMat = glow(0xffffff, 1);
  }
  const specs = layout();
  const drivers: Driver[] = [];
  const tags: { el: HTMLDivElement; av: CharacterAvatar }[] = [];
  const npc = P.has('npc');
  specs.forEach((s, i) => {
    const seed = seedFor(s.species, s.coat, i);
    const av = createCharacter({ species: s.species, cls: s.cls, team: s.team, seed, isLocal: !npc, veteran: !!s.vet, squad: s.squad ?? null });
    av.root.position.set(s.x, 0, s.z);
    av.root.rotation.y = s.yaw;
    if (s.expr) av.setExpression(s.expr);
    if (P.get('bare') === '1') av.root.traverse((o) => { if (o.name.startsWith('weapon')) o.visible = false; }); // inspect the armour
    if (maskMat) av.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !o.userData.styleInk) m.material = maskMat!; if (o.userData.styleInk) o.visible = false; });
    if (P.get('sil') === '1') {
      // Flat ink silhouettes (style-system material): judge class shapes without color or face detail.
      silMat ??= toon({ color: PALETTE.ink });
      av.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !o.userData.styleInk) m.material = silMat!; });
    }
    scene.add(av.root);
    drivers.push(new Driver(av, s.anim, i * 0.9));
    if (P.get('labels') !== '0' && (view === 'grid' || view === 'face' || view === 'action' || view === 'roster' || view === 'vets' || view === 'squads' || view === 'pve')) {
      const el = document.createElement('div');
      el.className = 'lbl';
      el.textContent = `${s.vet ? (s.species === Species.Cat ? 'commander ' : 'sergeant ') : ''}${s.squad === 'alley' ? 'raider ' : s.squad === 'heavy' ? 'heavy ' : ''}${av.stats.variant} ${s.cls}${s.expr ? ' · ' + s.expr : s.anim !== 'idle' ? ' · ' + s.anim : ''}`;
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
    // K2: the roster at ~5 m from a standing eye height (read as veterans at 5 m), the veterans, a head + chest close-up.
    case 'roster': if (only) setCam(0.25, 1.5, only === 'cat' ? -3.4 : -5.6, 0.25, 0.62, only === 'cat' ? 2.2 : -0.7, 52); else setCam(0.25, 4.2, -6.4, 0.25, 0.3, 0.9, 50); break;
    case 'vets': setCam(0, 1.2, -4.3, 0, 0.62, 0, 34); break;
    case 'squads': setCam(0.25, 1.25, -5.6, 0.25, 0.62, 0, 38); break;
    case 'pve': setCam(0, 1.3, -6.6, 0, 0.62, 0, 42); break;
    case 'closeup': setCam(-0.35, 1.02, -1.75, 0, 0.84, 0, 32); break;
    // Over-the-shoulder aim camera (third-person.ts: pivot +1.25 m, shoulder 0.75 m, 2.3 m back, fov 48).
    case 'ots': setCam(0.75, 1.3, 2.3, 0.75, 1.1, -20, 48); break;
    case 'lineup': setCam(LINEUP_CAM[0], LINEUP_CAM[1], LINEUP_CAM[2], 0, 0.6, LINEUP_CAM[2] - num('dist', 35), 62); break;
    case 'portrait': if (forcedAnim === 'death') setCam(-0.6, 1.7, -0.9, 0, 0.1, 0.55, 40); else setCam(-0.4, Number(P.get('camy') ?? 0.99), -1.6, 0, 0.95, 0, 30); break;
    default: setCam(-2.5, 3.1, -8.4, 0, 0.55, 0.3, 44);
  }
  {
    const c = vec('cam'), at = vec('at');
    if (c || at || P.has('fov')) setCam(...((c ?? camera.position.toArray()) as [number, number, number]), ...((at ?? target.toArray()) as [number, number, number]), num('fov', camera.fov));
  }

  const freeze = P.has('t') && !P.has('live');
  if (freeze) {
    const n = Math.round(Number(P.get('t')) * 60);
    for (let k = 0; k < n; k++) for (const d of drivers) d.step(1 / 60);
  }

  let last = performance.now(), frames = 0, fpsT = last, fps = 0, rendered = 0;
  const v = new THREE.Vector3();
  const totalTris = drivers.reduce((a, d) => a + d.av.stats.triangles, 0);
  // K3: screen boxes per character (CSS px) for the readability tools; the frame is frozen, so they are computed once.
  camera.updateMatrixWorld();
  const boxes = drivers.map((d, i) => {
    const s = specs[i], r = d.av.root, h = d.av.height;
    r.updateMatrixWorld(true);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py, pz] of [[-0.55, -0.05, -0.55], [0.55, -0.05, 0.55], [-0.55, h + 0.25, 0.55], [0.55, h + 0.25, -0.55], [-0.55, h + 0.25, -0.55], [0.55, h + 0.25, 0.55], [-0.55, -0.05, 0.55], [0.55, -0.05, -0.55]]) {
      v.set(px, py, pz).applyMatrix4(r.matrixWorld).project(camera);
      const sx = ((v.x + 1) / 2) * innerWidth, sy = ((1 - v.y) / 2) * innerHeight;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x0, y0, x1, y1, species: s.species, team: s.team, cls: s.cls, squad: s.squad ?? null, vet: !!s.vet, tag: s.tag ?? '' };
  });
  const maxDraws = Math.max(...drivers.map((d) => d.av.stats.drawCalls));
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!freeze) for (const d of drivers) d.step(dt);
    if (view === 'turntable' && !freeze) drivers[0].av.root.rotation.y += dt * 0.6;
    ctx.render();
    rendered++;
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
    (globalThis as unknown as { __lab: unknown }).__lab = { ready: true, frames: rendered, characters: drivers.length, fps, scene, THREE, TSL, boxes };
  });
}

main().catch((e) => { info.textContent = `lab failed: ${e?.stack ?? e}`; console.error(e); });
