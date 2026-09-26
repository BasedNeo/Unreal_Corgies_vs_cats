// Boss lab: the REAL authoritative boss (src/sim/boss, Rapier, deterministic) running in the page,
// rendered through the boss avatar + telegraph FX (src/client/procgen/boss) and the L5 FX director,
// with L1 corgis/cats as targets for scale. Nothing here is faked: telegraphs come from sim state/events.
//
// URL params
//   view=hero|laser|mortar|spin|phase2|death|far|turntable|lineup  scenario + camera (default hero)
//   t=<s>      pre-simulate that many seconds at 60 Hz, then freeze (deterministic screenshots)
//   live=1     keep simulating after t;  weak=1  draw the weak-point zones;  webgl  force WebGL2
//   cam=near   closer camera for the current view
import * as THREE from 'three/webgpu';
import { createRenderContext } from '../src/client/engine/renderer';
import { toon, glow } from '../src/client/style/style-webgpu.js';
import { PALETTE } from '../src/client/style/style-tokens.js';
import { Sim } from '../src/sim/sim';
import type { SimEntity } from '../src/sim/entity';
import { createFlatWorldData } from '../src/shared/world/world-data';
import { Team, Species, EntityKind, EFlag, CLASS_IDS, type ClassId, type SpeciesId, type TeamId } from '../src/shared/types';
import type { EntityState, GameEvent } from '../src/shared/protocol';
import { angleDelta, lerpAngle } from '../src/shared/math';
import { WEAPON_IDS } from '../src/shared/content/weapons';
import { BOSSES, BOSS_ATTACK_NAMES, unpackBossFlags, weakZone } from '../src/shared/content/bosses';
import { spawnBoss, forceBossAttack, skipBossIntro } from '../src/sim/boss';
import { applyDamage, kill } from '../src/sim/combat';
import { createBossAvatar, createBossTelegraphFx, type BossAvatar } from '../src/client/procgen/boss';
import { createCharacter } from '../src/client/procgen/characters';
import { createFx } from '../src/client/fx';
import type { Avatar } from '../src/client/views/avatar';

const Q = new URLSearchParams(location.search);
const view = Q.get('view') ?? 'hero';
const DEF = BOSSES[0];
const info = document.getElementById('info')!;
const hpEl = document.getElementById('hp')!;
const barkEl = document.getElementById('bark')!;

const DEFAULT_T: Record<string, number> = { far: 1.2, hero: 1.6, laser: 1.05, mortar: 1.85, spin: 0.85, phase2: 2.35, death: 1.12, turntable: 1, lineup: 1 };

interface View { avatar: Avatar; bodyYaw: number; key: string; boss: boolean }

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const ctx = await createRenderContext(app, { forceWebGL: Q.has('webgl') });
  const { scene, camera, renderer } = ctx;
  scene.background = new THREE.Color(PALETTE.void);

  // ---- stage: lawn, worn dirt patch, a few pet-scale props for scale
  const ground = new THREE.Mesh(new THREE.CircleGeometry(70, 56).rotateX(-Math.PI / 2), toon({ color: PALETTE.grass }));
  ground.receiveShadow = true;
  scene.add(ground);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(15, 48).rotateX(-Math.PI / 2), toon({ color: PALETTE.grassDry }));
  pad.position.y = 0.01; pad.receiveShadow = true;
  scene.add(pad);
  const fence = toon({ color: PALETTE.fenceWood });
  for (let i = -16; i <= 16; i++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.6, 8 + (i % 2) * 0.5, 0.35), fence);
    post.position.set(i * 1.75, 4, 26);
    post.castShadow = true;
    scene.add(post);
  }
  const box = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 2.6), toon({ color: PALETTE.hull }));
  box.position.set(9, 1.1, 6); box.rotation.y = 0.4; box.castShadow = true;
  scene.add(box);
  scene.traverse((o) => {
    const l = o as THREE.DirectionalLight;
    if (l.isDirectionalLight && l.intensity > 2) {
      l.castShadow = true;
      l.shadow.mapSize.set(2048, 2048);
      const c = l.shadow.camera as THREE.OrthographicCamera;
      c.left = -20; c.right = 20; c.top = 20; c.bottom = -20; c.near = 0.5; c.far = 60;
      l.position.multiplyScalar(2.5);
      l.shadow.bias = -0.0006;
    }
  });

  // ---- the authoritative sim: flat yard, the Vac-Tank, corgi targets that stand their ground
  const sim = await Sim.create({ seed: 5, world: { ...createFlatWorldData(5), props: [] } });
  sim.step();
  const dummies: SimEntity[] = [];
  const addChar = (x: number, z: number, cls: ClassId, species: SpeciesId = Species.Corgi, team: TeamId = Team.Corgis) => {
    const e = sim.spawnCharacter({ team, species, cls, name: `d${dummies.length}`, x, y: 0.02, z, yaw: 0 });
    e.input.yaw = Math.atan2(x, z); // face the tank at the origin
    dummies.push(e);
    return e;
  };
  const boss = spawnBoss(sim, { x: 0, z: 0, yaw: 0 }, { drop: false, players: 4 });
  skipBossIntro(sim, boss);
  // lab "hold": no attacks and park the tank where it stands (the attack views release it with a force)
  const hold = () => { const b = boss.boss!; b.readyAt = 1e9; b.goalX = boss.pos.x; b.goalZ = boss.pos.z; b.hasGoal = true; b.goalUntil = 1e9; };
  hold();
  const script: { at: number; run: () => void }[] = [];
  switch (view) {
    case 'laser':
      addChar(-4.5, -13.5, 'assault'); addChar(7, -16, 'overwatch');
      boss.boss!.target = dummies[0].id; boss.boss!.retargetAt = 1e9;
      script.push({ at: 0.05, run: () => forceBossAttack(boss, 'laser') });
      break;
    case 'mortar':
      addChar(-5, -14, 'assault'); addChar(4, -16.5, 'breacher'); addChar(10, -11, 'infiltrator');
      script.push({ at: 0.05, run: () => forceBossAttack(boss, 'mortar') });
      break;
    case 'spin':
      addChar(-2.8, -3.8, 'assault'); addChar(3.6, -3.4, 'warden'); addChar(0.5, -9, 'overwatch');
      script.push({ at: 0.05, run: () => forceBossAttack(boss, 'spin') });
      break;
    case 'phase2':
      addChar(-4, -11, 'assault'); addChar(4.5, -12, 'skyraider');
      script.push({ at: 0.1, run: () => { const h = boss.health!; applyDamage(sim, boss, h.hp - h.max * 0.46, { id: dummies[0].id, team: Team.Corgis, weapon: 0 }, 0, 3, 0, false); } });
      script.push({ at: 3.0, run: hold });
      break;
    case 'death':
      addChar(-4, -11, 'assault'); addChar(4.5, -12, 'skyraider');
      script.push({ at: 0.1, run: () => kill(sim, boss, { id: dummies[0].id, team: Team.Corgis, weapon: 0 }) });
      break;
    case 'far':
      addChar(0.9, -22.5, 'assault'); addChar(-6, -17, 'breacher'); addChar(5.5, -14, 'overwatch');
      boss.boss!.target = dummies[0].id;
      break;
    case 'lineup':
      addChar(-3.4, -4.2, 'assault'); addChar(-1.8, -4.4, 'breacher'); addChar(2.2, -4.3, 'overwatch', Species.Cat, Team.Cats);
      break;
    default:
      addChar(-4.6, -4.2, 'assault'); addChar(4.9, -3.6, 'breacher'); addChar(1.4, -7.2, 'skyraider');
  }

  // ---- presentation: avatars (boss → createBossAvatar, characters → L1), telegraph FX, L5 FX
  const views = new Map<number, View>();
  const viewsSource = { get: (id: number) => views.get(id) };
  const fx = createFx(scene, camera, viewsSource, { heightAt: () => 0, seed: 7 });
  fx.setWeaponIds(WEAPON_IDS);
  const tfx = createBossTelegraphFx(scene, { heightAt: () => 0 });
  let states = new Map<number, EntityState>();
  let barkT = 0;

  const syncViews = (dt: number) => {
    states = new Map(sim.snapshotEntities().map((s) => [s.id, s]));
    for (const [id, v] of views) if (!states.has(id)) { scene.remove(v.avatar.root); v.avatar.dispose(); views.delete(id); }
    for (const [id, s] of states) {
      const isBoss = s.kind === EntityKind.Boss;
      if (!isBoss && s.kind !== EntityKind.Player && s.kind !== EntityKind.Bot) continue;
      const cls: ClassId = CLASS_IDS[s.cls] ?? 'assault';
      const key = isBoss ? `boss:${s.cls}` : `${s.species}:${cls}:${s.team}:${s.seed}`;
      let v = views.get(id);
      if (!v) {
        const avatar = isBoss ? createBossAvatar({ boss: s.cls, seed: s.seed }) : createCharacter({ species: s.species as SpeciesId, cls, team: s.team as TeamId, seed: s.seed, isLocal: false });
        scene.add(avatar.root);
        v = { avatar, bodyYaw: isBoss ? 0 : s.yaw, key, boss: isBoss };
        views.set(id, v);
      }
      const speed = Math.hypot(s.vx, s.vz);
      const aiming = !isBoss && (s.flags & (EFlag.Aiming | EFlag.Firing)) !== 0;
      let targetYaw = v.bodyYaw;
      if (aiming) targetYaw = s.yaw;
      else if (speed >= 0.5) targetYaw = Math.atan2(-s.vx, -s.vz);
      else if (!isBoss) targetYaw = s.yaw;
      v.bodyYaw = lerpAngle(v.bodyYaw, targetYaw, 1 - Math.exp(-(isBoss ? 5 : 14) * dt));
      v.avatar.root.position.set(s.x, s.y, s.z);
      v.avatar.root.rotation.y = v.bodyYaw;
      v.avatar.update({
        speed, vy: s.vy, grounded: (s.flags & EFlag.Grounded) !== 0, anim: s.anim, flags: s.flags,
        aimPitch: s.pitch, aimYawOffset: angleDelta(v.bodyYaw, s.yaw), hpFrac: s.maxHp ? s.hp / s.maxHp : 1,
        dead: (s.flags & EFlag.Dead) !== 0, firing: (s.flags & EFlag.Firing) !== 0, aiming, sprinting: (s.flags & EFlag.Sprinting) !== 0,
      }, dt);
    }
  };

  const onEvent = (ev: GameEvent) => {
    switch (ev.e) {
      case 'fire': views.get(ev.id)?.avatar.trigger('fire'); break;
      case 'hit': views.get(ev.dst)?.avatar.trigger('hit', ev.dmg / 20); break;
      case 'death': views.get(ev.id)?.avatar.trigger('death'); break;
      case 'land': views.get(ev.id)?.avatar.trigger('land', ev.impact); break;
      case 'ability': views.get(ev.id)?.avatar.trigger(ev.ability); break;
      case 'bark': if (ev.id === boss.id) { barkEl.textContent = `${DEF.pilot}: “${ev.line}”`; barkEl.style.display = 'block'; barkT = 3.2; } break;
    }
    fx.onGameEvent(ev, { states, localId: -1 });
    tfx.onGameEvent(ev);
  };

  let simT = 0;
  const tick = () => {
    for (const s of script) if (s.at >= 0 && simT >= s.at) { s.run(); s.at = -1; }
    for (const d of dummies) if (!d.dead) { d.input.buttons = 0; d.input.mx = 0; d.input.mz = 0; }
    sim.step();
    simT += 1 / 60;
    for (const ev of sim.drainEvents()) onEvent(ev);
    syncViews(1 / 60);
    fx.update(1 / 60, states, -1);
    tfx.update(1 / 60, states);
    barkT = Math.max(0, barkT - 1 / 60);
    if (barkT <= 0) barkEl.style.display = 'none';
  };

  // weak-point debug overlay (lab only)
  const weakGroup = new THREE.Group();
  if (Q.has('weak')) {
    for (const p2 of [false, true]) {
      const w = weakZone(DEF, p2);
      const g = new THREE.CapsuleGeometry(w.r, Math.max(0.01, w.y1 - w.y0 - 2 * w.r), 4, 12);
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(g), glow(p2 ? PALETTE.glowOrange : PALETTE.glowCyan, 1.6));
      lines.position.y = (w.y0 + w.y1) / 2;
      weakGroup.add(lines);
    }
    const hit = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(DEF.radius, 16, 8)), glow(PALETTE.tennisBall, 1.2));
    hit.position.y = DEF.radius;
    weakGroup.add(hit);
    scene.add(weakGroup);
  }

  // ---- camera presets
  const target = new THREE.Vector3();
  const near = Q.get('cam') === 'near';
  const setCam = (px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov: number) => {
    camera.position.set(px, py, pz); target.set(tx, ty, tz); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(target);
  };
  switch (view) {
    case 'laser': setCam(-15.5, 7.2, -6.5, -1.8, 0.9, -8.5, 50); break;
    case 'mortar': setCam(-13, 9.5, -24, 1.5, 1.5, -8.5, 52); break;
    case 'spin': setCam(-8.5, 6.8, -12.5, 0, 1.4, -1, 50); break;
    case 'phase2': near ? setCam(-3.6, 5.2, -6.4, 0, 3.4, 0, 42) : setCam(-7.5, 5.4, -11.5, 0.3, 2.3, 0.8, 50); break;
    case 'death': setCam(-10, 5, -15, 0, 5.5, 1, 58); break;
    case 'lineup': setCam(-4.5, 3.2, -13, 0, 1.8, -1.5, 42); break;
    case 'far': setCam(1.6, 1.95, -25.3, 0.2, 2.1, 0, 62); break;   // over a corgi's shoulder, ~25 m out
    case 'turntable': setCam(-9, 4.2, -9.5, 0, 2.2, 0, 44); break;
    default: near ? setCam(-4.2, 4.6, -6.8, 0, 3.3, 0, 40) : setCam(-10.5, 5.4, -12.5, 0.4, 2.1, -0.6, 44);
  }

  const T = Number(Q.get('t') ?? DEFAULT_T[view] ?? 1);
  const live = Q.has('live');
  const n = Math.round(T * 60);
  for (let k = 0; k < n; k++) tick();
  let frozen = !live;
  let acc = 0, last = performance.now(), frames = 0, fpsT = last, fps = 0;
  const bossView = () => [...views.values()].find((v) => v.boss)?.avatar as BossAvatar | undefined;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!frozen) { acc += dt; while (acc >= 1 / 60) { tick(); acc -= 1 / 60; } }
    const bv = bossView();
    if (view === 'turntable' && bv) bv.root.rotation.y += dt * 0.5;
    weakGroup.position.set(boss.pos.x, boss.pos.y, boss.pos.z);
    ctx.render();
    frames++;
    if (now - fpsT > 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
    const s = states.get(boss.id);
    const f = s ? unpackBossFlags(s.flags) : null;
    hpEl.style.width = `${s && s.maxHp ? (100 * s.hp) / s.maxHp : 0}%`;
    const inf = renderer.info.render as unknown as { drawCalls?: number; calls?: number; triangles?: number };
    info.textContent = `boss lab · view=${view} · ${ctx.backend} · ${fps.toFixed(0)} fps${frozen ? ` · frozen at t=${T}s` : ''}\n` +
      (bv ? `Vac-Tank ${bv.stats.triangles} tris (mech ${bv.stats.mechTriangles} + pilot ${bv.stats.pilotTriangles}) · ${bv.stats.drawCalls} draws · ${bv.stats.bones} mech bones\n` : '') +
      (f ? `state ${BOSS_ATTACK_NAMES[f.attack]} / stage ${f.stage} · phase ${f.phase2 ? 2 : 1} · hp ${Math.round(s!.hp)}/${s!.maxHp} · telegraph fx ${tfx.stats.rings} rings ${tfx.stats.beams} beams ${tfx.stats.hairballs} hairballs\n` : 'boss gone\n') +
      `frame: ${inf.drawCalls ?? inf.calls ?? '?'} draw calls (incl. ink + shadow passes)`;
    (globalThis as unknown as { __boss: unknown }).__boss = { ready: true, frozen, view, t: simT, state: f, stats: bv?.stats ?? null, fx: tfx.stats };
  });
}

main().catch((e) => { info.textContent = `lab failed: ${e?.stack ?? e}`; console.error(e); });
