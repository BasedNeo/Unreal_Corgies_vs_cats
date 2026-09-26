// Juice lab: the L5 HUD, audio and FX on a tiny stage, driven by synthetic GameEvents on a loop.
//   /labs/juice.html?webgl&hud=combat      HUD state: menu | settings | combat | dead | scoreboard | pause
//   &fx=heavy                               denser event loop (FX stress)
//   &shot=6                                 after 6 rendered frames fire a scripted "money shot", then freeze FX + HUD
//                                           clock (frame-based so screenshots are deterministic on a loaded machine)
//   &fixed                                  fixed 1/60 s steps (smooth under slow software rendering)
//   &beam                                   fire lasers/tracers every frame (tracer debug)
// Click anywhere to unlock audio (procedural SFX + adaptive music; combat intensity follows the loop).
import * as THREE from 'three/webgpu';
import { createRenderContext } from '../src/client/engine/renderer';
import { toon } from '../src/client/style/style-webgpu.js';
import { PALETTE } from '../src/client/style/style-tokens.js';
import type { EntityState, GameEvent, MatchState, RosterEntry } from '../src/shared/protocol';
import { Anim, CLASS_IDS, EFlag, EntityKind, Species, Team, type ClassId } from '../src/shared/types';
import { createFx, type MuzzleSource } from '../src/client/fx';
import { createAudio } from '../src/client/audio';
import { createHud } from '../src/client/ui/hud';
import type { Avatar } from '../src/client/views/avatar';

const params = new URLSearchParams(location.search);
const hudState = params.get('hud') ?? 'combat';
const heavy = params.get('fx') === 'heavy';
const shotAt = params.has('shot') ? Number(params.get('shot') || 6) : -1;
const fixed = params.has('fixed') || shotAt >= 0;

interface Actor { id: number; name: string; species: number; team: number; cls: ClassId; x: number; z: number; yaw: number; avatar: Avatar | null; root: THREE.Object3D }

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const ui = document.getElementById('ui')!;
  const ctx = await createRenderContext(app, { forceWebGL: params.has('webgl') });
  const { scene, camera } = ctx;

  // ---- tiny backyard stage ----
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), toon({ color: PALETTE.grass }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const fence = toon({ color: PALETTE.fenceWood });
  for (let i = -12; i <= 12; i++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 4 + (i % 2) * 0.4, 0.25), fence);
    post.position.set(i * 1.0, 2, -22);
    scene.add(post);
  }
  const crate = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), toon({ color: PALETTE.hull }));
  crate.position.set(-5, 0.8, -9);
  scene.add(crate);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 14), toon({ color: PALETTE.tennisBall }));
  ball.position.set(7, 0.9, -13);
  scene.add(ball);

  // ---- actors (L1 procedural avatars when available, simple stand-ins otherwise) ----
  type MakeAvatar = (o: { species: 0 | 1; cls: ClassId; team: 0 | 1; seed: number; isLocal: boolean }) => Avatar;
  let createAvatar: MakeAvatar | null = null;
  try { createAvatar = (await import('../src/client/procgen/characters')).createAvatar as MakeAvatar; } catch (e) { console.warn('avatar module unavailable, using stand-ins', e); }
  const actors: Actor[] = [
    { id: 1, name: 'Rex', species: Species.Corgi, team: Team.Corgis, cls: 'assault', x: 0, z: 0, yaw: 0, avatar: null, root: null! },
    { id: 2, name: 'Sir Pounce', species: Species.Cat, team: Team.Cats, cls: 'assault', x: 1.5, z: -9, yaw: Math.PI, avatar: null, root: null! },
    { id: 3, name: 'Mittens', species: Species.Cat, team: Team.Cats, cls: 'overwatch', x: -4, z: -13, yaw: Math.PI * 0.8, avatar: null, root: null! },
    { id: 4, name: 'Biscuit', species: Species.Corgi, team: Team.Corgis, cls: 'skyraider', x: -3.2, z: -3, yaw: -0.3, avatar: null, root: null! },
    { id: 5, name: 'Lady Whisk', species: Species.Cat, team: Team.Cats, cls: 'warden', x: 5, z: -15, yaw: Math.PI * 1.1, avatar: null, root: null! },
  ];
  for (const a of actors) {
    if (createAvatar) {
      try { a.avatar = createAvatar({ species: a.species as 0 | 1, cls: a.cls, team: a.team as 0 | 1, seed: a.id * 7, isLocal: a.id === 1 }); } catch (e) { console.warn(e); }
    }
    a.root = a.avatar?.root ?? standIn(a.species, a.team);
    a.root.position.set(a.x, 0, a.z);
    a.root.rotation.y = a.yaw;
    scene.add(a.root);
  }
  const muzzleOf = new Map<number, THREE.Object3D>();
  for (const a of actors) if (!a.avatar) { const m = new THREE.Object3D(); m.position.set(0.3, 0.8, -0.7); a.root.add(m); muzzleOf.set(a.id, m); }
  const views: MuzzleSource = {
    get(id) {
      const a = actors.find((x) => x.id === id);
      if (!a) return undefined;
      if (a.avatar) return { avatar: a.avatar };
      const m = muzzleOf.get(id)!;
      return { avatar: { muzzleWorld: (v: THREE.Vector3) => m.getWorldPosition(v) } };
    },
  };

  // Camera: over the local corgi's shoulder, looking down the yard.
  camera.position.set(1.3, 2.2, 4.2);
  camera.fov = 55; camera.updateProjectionMatrix();
  camera.lookAt(0.2, 1.0, -8);
  camera.updateMatrixWorld();

  // ---- juice systems under test ----
  let frozen = false, frozenAt = 0;
  const labClock = () => (frozen ? frozenAt : performance.now() / 1000);
  const fx = createFx(scene, camera, views, { seed: 7, heightAt: () => 0 });
  const audio = createAudio();
  const hud = createHud(ui, {
    play: (o) => console.log('[lab] play', JSON.stringify(o)),
    chooseClass: (c) => console.log('[lab] class', c),
    chooseTeam: (t) => console.log('[lab] team', t),
    setSetting: (k, v) => {
      console.log('[lab] setting', k, v);
      if (k === 'masterVolume') audio.setVolumes({ master: v as number });
      if (k === 'musicVolume') audio.setVolumes({ music: v as number });
      if (k === 'sfxVolume') audio.setVolumes({ sfx: v as number });
      if (k === 'quality') { fx.setQuality(v as 'low'); audio.setQuality(v as 'low'); }
    },
  }, { clock: labClock });
  hud.setUiSound((k) => audio.ui(k));
  audio.setVolumes({ master: hud.settings.masterVolume, music: hud.settings.musicVolume, sfx: hud.settings.sfxVolume });
  if (hudState === 'menu') hud.showMenu(true);
  if (hudState === 'settings') hud.showMenu(true, 'settings');
  if (hudState === 'scoreboard') hud.setScoreboard(true);

  let localHp = 120, localAmmo = 30, firing = false, reloading = false;
  const states = new Map<number, EntityState>();
  const syncStates = () => {
    for (const a of actors) {
      const prev = states.get(a.id);
      const dead = a.id === 1 && hudState === 'dead';
      states.set(a.id, {
        id: a.id, kind: a.id === 1 ? EntityKind.Player : EntityKind.Bot, team: a.team as 0 | 1, species: a.species as 0 | 1, cls: CLASS_IDS.indexOf(a.cls), seed: a.id,
        x: a.root.position.x, y: 0, z: a.root.position.z, yaw: a.id === 1 ? -0.05 : a.yaw, pitch: 0, vx: prev?.vx ?? 0, vy: 0, vz: prev?.vz ?? 0,
        hp: a.id === 1 ? (dead ? 0 : localHp) : 80, maxHp: 120, anim: dead ? Anim.Dead : Anim.Idle,
        flags: EFlag.Grounded | (a.id === 4 ? EFlag.Sprinting : 0) | (dead ? EFlag.Dead : 0) | (a.id === 1 && firing ? EFlag.Firing : 0) | (a.id === 1 && reloading ? EFlag.Reloading : 0),
        weapon: 0, ammo: a.id === 1 ? localAmmo : 18,
      });
    }
  };
  syncStates();

  // Roster + match (what the net client would provide).
  const roster: RosterEntry[] = [
    ...actors.map((a, i) => ({ pid: `p${a.id}`, name: a.name, team: a.team as 0 | 1, cls: a.cls, entity: a.id, bot: a.id !== 1, kills: [7, 3, 5, 2, 4][i], deaths: [2, 5, 3, 4, 4][i], score: [920, 410, 660, 300, 540][i], ping: a.id === 1 ? 23 : 0 })),
    { pid: 'p6', name: 'Waffles', team: 0, cls: 'breacher', entity: 6, bot: false, kills: 4, deaths: 1, score: 610, ping: 48 },
    { pid: 'p7', name: 'Sgt. Stumpy', team: 0, cls: 'warden', entity: 7, bot: true, kills: 1, deaths: 3, score: 180, ping: 0 },
    { pid: 'p8', name: 'Tabby Two-Toes', team: 1, cls: 'infiltrator', entity: 8, bot: false, kills: 6, deaths: 2, score: 780, ping: 61 },
    { pid: 'p9', name: 'Hairball', team: 1, cls: 'breacher', entity: 9, bot: true, kills: 0, deaths: 6, score: 90, ping: 0 },
  ];
  const match: MatchState = { mode: 'yard-skirmish', phase: 'live', timeLeft: 272, score: [14, 11], objective: 'Hold the doghouse until the sprinklers stop', wave: 3, winner: -1 };

  // ---- synthetic event loop ----
  const pos = (id: number) => states.get(id)!;
  const fireAt = (src: number, dst: number, crit = false, dmg = 12, wpn = 0): GameEvent[] => {
    const s = pos(src), d = pos(dst);
    const hx = d.x + (crit ? 0 : 0.1), hy = crit ? 1.25 : 0.8, hz = d.z;
    const dx = hx - s.x, dy = hy - 1, dz = hz - s.z, l = Math.hypot(dx, dy, dz);
    return [
      { e: 'fire', id: src, wpn, x: s.x, y: 1, z: s.z, dx: dx / l, dy: dy / l, dz: dz / l, hx, hy, hz, hit: dst },
      { e: 'hit', src, dst, dmg, x: hx, y: hy, z: hz, crit },
    ];
  };
  const miss = (src: number, x: number, z: number, wpn = 0): GameEvent => {
    const s = pos(src); const dx = x - s.x, dz = z - s.z, l = Math.hypot(dx, dz);
    return { e: 'fire', id: src, wpn, x: s.x, y: 1, z: s.z, dx: dx / l, dy: 0, dz: dz / l, hx: x, hy: 0, hz: z, hit: -1 };
  };
  const loop: Array<[number, () => GameEvent[]]> = [
    [0.0, () => fireAt(1, 2)], [0.12, () => fireAt(1, 2)], [0.24, () => [miss(1, 3, -12)]], [0.36, () => fireAt(1, 2, true, 30)],
    [0.7, () => fireAt(3, 1, false, 14, 2)], [0.9, () => [{ e: 'bark', id: 4, line: 'Cover me, pup!' }]],
    [1.2, () => [{ e: 'explode', x: -2.5, y: 0, z: -12, r: 3.5, by: 4 }]],
    [1.6, () => [...fireAt(1, 2, true, 40), { e: 'death', id: 2, by: 1 }]],
    [1.9, () => [{ e: 'jump', id: 4, double: false }]], [2.15, () => [{ e: 'jump', id: 4, double: true }]],
    [2.3, () => [{ e: 'reload', id: 1 }]],
    [2.5, () => [{ e: 'land', id: 4, impact: 16 }]], [2.6, () => [{ e: 'score', team: 0, pts: 1, reason: 'kill' }]],
    [2.7, () => [{ e: 'spawn', id: 2 }, { e: 'bark', id: 5, line: 'Hssss, puppy!' }]],
    [2.8, () => fireAt(5, 4, false, 10, 1)],
  ];
  const heavyExtra: Array<[number, () => GameEvent[]]> = [
    [0.05, () => fireAt(4, 3)], [0.3, () => fireAt(5, 1, false, 8, 2)], [0.55, () => [{ e: 'explode', x: 4, y: 0, z: -10, r: 3, by: 1 }]],
    [0.8, () => fireAt(4, 5, true, 30)], [1.05, () => [miss(3, -1, -2, 4)]], [1.4, () => fireAt(2, 4, false, 10, 3)],
    [2.0, () => [{ e: 'land', id: 1, impact: 14 }]], [2.3, () => fireAt(1, 3, true, 25)],
  ];
  const events = heavy ? [...loop, ...heavyExtra].sort((a, b) => a[0] - b[0]) : loop;
  const PERIOD = 3;
  const emit = (evs: GameEvent[]) => {
    for (const ev of evs) {
      if (ev.e === 'hit' && ev.dst === 1 && hudState !== 'dead') localHp = Math.max(28, localHp - ev.dmg);
      if (ev.e === 'fire' && ev.id === 1) { localAmmo = localAmmo > 0 ? localAmmo - 1 : 30; firing = true; }
      if (ev.e === 'reload' && ev.id === 1) reloading = true;
      if (ev.e === 'spawn' && ev.id === 2) { reloading = false; localAmmo = 30; }
      fx.onGameEvent(ev, { localId: 1, states });
      audio.onGameEvent(ev);
      hud.onGameEvent(ev);
    }
  };
  // Pre-roll a kill feed so HUD states have history.
  if (hudState !== 'menu') {
    emit([{ e: 'fire', id: 8, wpn: 1, x: 0, y: 1, z: -20, dx: 0, dy: 0, dz: 1, hx: 0, hy: 1, hz: -3, hit: 6 }, { e: 'death', id: 6, by: 8 }]);
    emit([{ e: 'explode', x: -6, y: 0, z: -10, r: 3, by: 6 }, { e: 'death', id: 9, by: 6 }]);
    emit([{ e: 'death', id: 7, by: 7 }]);
    if (hudState === 'dead') emit([...fireAt(3, 1, true, 60, 2), { e: 'death', id: 1, by: 3 }]);
  }

  let t = 0, cursor = 0, last = performance.now(), frames = 0, lastError = '';
  (globalThis as unknown as { __juice: unknown }).__juice = { fx, hud, audio, renderer: ctx.renderer, scene, camera, get t() { return t; }, get frames() { return frames; }, get error() { return lastError; }, get frozen() { return frozen; } };
  ctx.renderer.setAnimationLoop(() => { try { frame(); } catch (e) { lastError = String((e as Error)?.stack ?? e); console.error(e); } });
  const frame = () => {
    frames++;
    const now = performance.now();
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (fixed) dt = 1 / 60;
    if (frozen) dt = 0;
    if (!frozen) {
      firing = false;
      const prevT = t;
      t += dt;
      match.timeLeft = Math.max(0, 272 - t);
      const lt = t % PERIOD, plt = prevT % PERIOD;
      if (lt < plt) cursor = 0;
      while (cursor < events.length && events[cursor][0] <= lt) { emit(events[cursor][1]()); cursor++; }
      if (shotAt >= 0 && frames >= shotAt) {
        // Money shot: mortar blast + KO, local rifle crit + kill, laser into an ally, double jump, a hit on us.
        emit([{ e: 'explode', x: 5.5, y: 0, z: -9, r: 3.5, by: 1 }, { e: 'death', id: 3, by: 4 }]);
        for (let k = 0; k < 6; k++) fx.update(0.02, states, 1);
        emit([...fireAt(1, 2, true, 40), { e: 'death', id: 2, by: 1 }, ...fireAt(5, 4, false, 12, 2), miss(4, -6, -11, 0),
          miss(1, -2, -7, 0), { e: 'jump', id: 4, double: true }, { e: 'land', id: 1, impact: 15 }, ...fireAt(5, 1, false, 18, 2)]);
        for (let k = 0; k < 2; k++) fx.update(0.02, states, 1);
        frozen = true;
        frozenAt = performance.now() / 1000 + 0.07;
      }
    }
    // Sprinting ally loops around so zoomies dust shows.
    const ally = actors[3];
    ally.root.position.set(-3.2 + Math.sin(t * 1.4) * 2.5, 0, -4 + Math.cos(t * 1.4) * 2.5);
    ally.root.rotation.y = -t * 1.4 + Math.PI;
    syncStates();
    const st = states.get(4)!; st.vx = Math.cos(t * 1.4) * 3.5; st.vz = -Math.sin(t * 1.4) * 3.5;
    for (const a of actors) a.avatar?.update({ speed: a.id === 4 ? 8 : 0, vy: 0, grounded: true, anim: Anim.Idle, flags: EFlag.Grounded, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: a.id === 1 && hudState === 'dead', firing: a.id === 1, aiming: a.id === 1, sprinting: a.id === 4 }, dt);
    if (params.has('beam')) emit([...fireAt(5, 1, false, 1, 2), miss(4, -6, -11, 0)]);
    fx.update(dt, states, 1);
    audio.update(camera, states, 1, dt);
    hud.update({
      local: states.get(1)!, match, roster, fps: 60, rttMs: 23, locked: hudState !== 'pause', backend: ctx.backend, transport: 'lab', states,
      respawnIn: hudState === 'dead' ? 3.4 : undefined, magSize: 30, showDebug: false,
    });
    ctx.render();
  };

  const lab = document.getElementById('lab')!;
  const base = location.pathname;
  lab.innerHTML = ['menu', 'settings', 'combat', 'dead', 'scoreboard', 'pause'].map((h) => `<a href="${base}?hud=${h}">${h}</a>`).join('') + `<a href="${base}?hud=combat&fx=heavy">fx heavy</a> · click to unlock audio`;
  setInterval(() => { lab.title = JSON.stringify(fx.stats); }, 500);
}

function standIn(species: number, team: number): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.45, 6, 12), toon({ color: team === 1 ? PALETTE.teamCats : PALETTE.teamCorgis }));
  body.position.y = 0.6;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), toon({ color: species === 1 ? PALETTE.catGrey : PALETTE.corgiOrange }));
  head.position.y = 1.12;
  g.add(body, head);
  return g;
}

main().catch((e) => { console.error(e); document.getElementById('ui')!.innerHTML = `<pre style="color:#f88;padding:20px">${String(e?.stack ?? e)}</pre>`; });
