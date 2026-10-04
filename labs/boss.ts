// Boss lab: the REAL authoritative boss (src/sim/boss, Rapier, deterministic) running in the page,
// rendered through the boss avatar + telegraph FX (src/client/procgen/boss) and the L5 FX director,
// with L1 corgis/cats as targets for scale. Nothing here is faked: telegraphs come from sim state/events.
//
// ?boss=madame_pointille → the E1 sniper elite on the REAL West Yard (world view + West Yard sim), see sniperLab():
//   view=perch|duel|dot|glint|phase2|leap  perch=0|1|2 (umbrella, house eave, grill)  cam=wide  t=<max s>  dawn=1
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
import { VAC_TANK, BOSS_ATTACK_NAMES, unpackBossFlags, weakZone } from '../src/shared/content/bosses';
import { spawnBoss, forceBossAttack, skipBossIntro } from '../src/sim/boss';
import { applyDamage, kill } from '../src/sim/combat';
import { createBossAvatar, createBossTelegraphFx, type BossAvatar, type TankAvatar } from '../src/client/procgen/boss';
import { createCharacter } from '../src/client/procgen/characters';
import { createFx } from '../src/client/fx';
import type { Avatar } from '../src/client/views/avatar';
import { createWorldData } from '../src/shared/world/world-data';
import { surfaceAt } from '../src/shared/world/queries';
import { createWorldView } from '../src/client/world/world-view';
import { MADAME_POINTILLE, SniperAct, SNIPER_ABILITY, BossStage, bossIndex, sniperGlinting, sniperLens, type SniperDef } from '../src/shared/content/bosses';

const Q = new URLSearchParams(location.search);
const view = Q.get('view') ?? 'hero';
const DEF = VAC_TANK;
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
  const bossView = () => [...views.values()].find((v) => v.boss)?.avatar as TankAvatar | undefined;
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
      `frame: ${inf.drawCalls ?? inf.calls ?? '?'} draw calls (incl. shadow passes)`;
    (globalThis as unknown as { __boss: unknown }).__boss = { ready: true, frozen, view, t: simT, state: f, stats: bv?.stats ?? null, fx: tfx.stats };
  });
}

// ====================================================================== E1: the sniper elite on the West Yard

async function sniperLab(): Promise<void> {
  const DEFS: SniperDef = MADAME_POINTILLE;
  const app = document.getElementById('app')!;
  const ctx = await createRenderContext(app, { forceWebGL: Q.has('webgl'), quality: 'high' });
  const { scene, camera, renderer } = ctx;
  const worldData = createWorldData(1);
  const worldView = createWorldView(scene, worldData, { quality: 'high', grade: ctx.pipeline.grade.uniforms });
  worldView.setTimeOfDay(Q.has('dawn') ? 0.27 : 0.42);
  const sim = await Sim.create({ seed: 5, world: worldData });
  sim.step();
  const perchIdx = view === 'lineup' ? 0 : Number(Q.get('perch') ?? 0);
  // lineup: a ground-level "perch" on the patio so she stands next to a corgi and a regular Siamese for scale
  const lineupPerches = [{ id: 'lineup', name: 'Patio', x: 30, y: surfaceAt(worldData, 30, -83).y, z: -83, yaw: Math.atan2(-(24 - 30), -(-76 - -83)) }];
  const boss = spawnBoss(sim, undefined, { boss: DEFS.id, players: 1, drop: false, perch: perchIdx, perches: view === 'lineup' ? lineupPerches : undefined });
  skipBossIntro(sim, boss);
  const s = boss.sniper!;
  s.relocateAt = 1e9;
  const b = boss.boss!;
  const hold = () => { b.readyAt = 1e9; s.lastLock = -1; };
  const p = s.perches[perchIdx];
  const roof = worldData.perches!;
  const dummies: SimEntity[] = [];
  const addCorgi = (x: number, y: number, z: number, cls: ClassId = 'overwatch') => {
    const e = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls, name: `c${dummies.length}`, x, y: y + 0.02, z, yaw: Math.atan2(-(p.x - x), -(p.z - z)) });
    e.input.yaw = e.yaw;
    dummies.push(e);
    return e;
  };
  // which roof perch sees this sniper perch best (the duel partner)
  const partner = roof.find((r) => r.id === 'roof_parapet')!;
  let freezeWhen: () => boolean = () => false;
  const script: { at: number; run: () => void }[] = [];
  switch (view) {
    case 'perch': hold(); boss.sniper!.aimYaw = p.yaw; break;
    case 'lineup': {
      hold(); boss.sniper!.aimYaw = p.yaw;
      const c = addCorgi(28.4, surfaceAt(worldData, 28.4, -82.2).y, -82.2, 'assault');
      const cat = sim.spawnCharacter({ team: Team.Cats, species: Species.Cat, cls: 'overwatch', name: 'siamese', x: 31.6, y: surfaceAt(worldData, 31.6, -83.8).y + 0.02, z: -83.8, yaw: p.yaw, seed: 17 });
      cat.input.yaw = p.yaw; dummies.push(cat);
      c.input.yaw = p.yaw;
      break;
    }
    case 'duel': case 'dot': case 'glint':
      addCorgi(partner.x, partner.y, partner.z);
      freezeWhen = view === 'glint' ? () => sniperGlinting(DEFS, { attack: b.attack as 0, stage: b.stage as 0, phase2: b.phase2, progress: b.stageT / b.stageLen }) && b.stageT / b.stageLen > 0.75
        : () => b.attack === SniperAct.Track && b.stage === BossStage.Telegraph && b.stageT / b.stageLen > (view === 'dot' ? 0.5 : 0.35);
      break;
    case 'phase2': {
      addCorgi(partner.x, partner.y, partner.z);
      script.push({ at: 0.1, run: () => { const h = boss.health!; applyDamage(sim, boss, h.hp - h.max * 0.48, { id: dummies[0].id, team: Team.Corgis, weapon: 0 }, 0, 3, 0, false); } });
      let t0 = -1;
      freezeWhen = () => { if (b.attack === SniperAct.PhaseShift && t0 < 0) t0 = sim.time; return t0 >= 0 && sim.time - t0 > Number(Q.get('pt') ?? 0.55); };
      break;
    }
    case 'leap':
      hold();
      script.push({ at: 0.2, run: () => { s.relocateAt = 0; b.readyAt = 0; } });
      freezeWhen = () => b.attack === SniperAct.Leap && b.stage === BossStage.Active && s.hop === 0 && s.hopT > s.route[0].t * Number(Q.get('pt') ?? 0.45);
      break;
  }
  // presentation (the same avatar + FX paths the game uses)
  const views = new Map<number, View>();
  const fx = createFx(scene, camera, { get: (id: number) => views.get(id) }, { heightAt: (x, z) => worldData.height(x, z), seed: 7 });
  fx.setWeaponIds(WEAPON_IDS);
  const tfx = createBossTelegraphFx(scene, { heightAt: (x, z) => worldData.height(x, z) });
  let states = new Map<number, EntityState>();
  let barkT = 0;
  const sync = (dt: number) => {
    states = new Map(sim.snapshotEntities().map((st) => [st.id, st]));
    for (const [id, v] of views) if (!states.has(id)) { scene.remove(v.avatar.root); v.avatar.dispose(); views.delete(id); }
    for (const [id, st] of states) {
      const isBoss = st.kind === EntityKind.Boss;
      if (!isBoss && st.kind !== EntityKind.Player && st.kind !== EntityKind.Bot) continue;
      const cls: ClassId = CLASS_IDS[st.cls] ?? 'assault';
      let v = views.get(id);
      if (!v) {
        const avatar = isBoss ? createBossAvatar({ boss: st.cls, seed: st.seed }) : createCharacter({ species: st.species as SpeciesId, cls, team: st.team as TeamId, seed: st.seed, isLocal: false });
        scene.add(avatar.root);
        v = { avatar, bodyYaw: st.yaw, key: `${st.kind}:${st.cls}`, boss: isBoss };
        views.set(id, v);
      }
      const speed = Math.hypot(st.vx, st.vz);
      const aiming = (st.flags & (EFlag.Aiming | EFlag.Firing)) !== 0;
      let targetYaw = v.bodyYaw;
      if (aiming) targetYaw = st.yaw; else if (speed >= 0.5) targetYaw = Math.atan2(-st.vx, -st.vz);
      v.bodyYaw = lerpAngle(v.bodyYaw, targetYaw, 1 - Math.exp(-(isBoss ? 5 : 14) * dt));
      v.avatar.root.position.set(st.x, st.y, st.z);
      v.avatar.root.rotation.y = v.bodyYaw;
      v.avatar.update({
        speed, vy: st.vy, grounded: (st.flags & EFlag.Grounded) !== 0, anim: st.anim, flags: st.flags,
        aimPitch: st.pitch, aimYawOffset: angleDelta(v.bodyYaw, st.yaw), hpFrac: st.maxHp ? st.hp / st.maxHp : 1,
        dead: (st.flags & EFlag.Dead) !== 0, firing: (st.flags & EFlag.Firing) !== 0, aiming, sprinting: (st.flags & EFlag.Sprinting) !== 0,
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
      case 'bark': if (ev.id === boss.id) { barkEl.textContent = `${DEFS.speaker}: “${ev.line}”`; barkEl.style.display = 'block'; barkT = 3.2; } break;
    }
    fx.onGameEvent(ev, { states, localId: -1 });
    tfx.onGameEvent(ev);
  };
  let simT = 0;
  const tick = () => {
    for (const sc of script) if (sc.at >= 0 && simT >= sc.at) { sc.run(); sc.at = -1; }
    for (const d of dummies) if (!d.dead) { d.input.buttons = 0; d.input.mx = 0; d.input.mz = 0; }
    sim.step();
    simT += 1 / 60;
    for (const ev of sim.drainEvents()) onEvent(ev);
    sync(1 / 60);
    fx.update(1 / 60, states, -1);
    tfx.update(1 / 60, states);
    barkT = Math.max(0, barkT - 1 / 60);
    if (barkT <= 0) barkEl.style.display = 'none';
  };
  const maxT = Number(Q.get('t') ?? (view === 'perch' ? 1 : 12));
  for (let k = 0; k < Math.round(maxT * 60); k++) { tick(); if (freezeWhen()) break; }
  // ---- cameras (relative to the perch: f = her facing, toward the garage roof; r = her right)
  const fx0 = -Math.sin(p.yaw), fz0 = -Math.cos(p.yaw), rx0 = Math.cos(p.yaw), rz0 = -Math.sin(p.yaw);
  const wide = Q.get('cam') === 'wide';
  const setCam = (px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov: number) => {
    camera.position.set(px, py, pz); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(tx, ty, tz);
  };
  const bp = boss.pos;
  const L = sniperLens(DEFS, bp.x, bp.y, bp.z, s.aimYaw, s.aimPitch, { x: 0, y: 0, z: 0 });
  switch (view) {
    case 'lineup': setCam(bp.x - Math.sin(p.yaw) * 5.2 + Math.cos(p.yaw) * 0.6, bp.y + 1.45, bp.z - Math.cos(p.yaw) * 5.2 - Math.sin(p.yaw) * 0.6, bp.x, bp.y + 0.85, bp.z, 45); break;
    case 'perch': case 'phase2':
      if (Q.get('cam') === 'side') setCam(bp.x - rx0 * 4.4 + fx0 * 1.2, bp.y + 1.5, bp.z - rz0 * 4.4 + fz0 * 1.2, bp.x, bp.y + 0.9, bp.z, 42);
      else if (wide) setCam(bp.x + fx0 * 16 + rx0 * 7, bp.y + 4, bp.z + fz0 * 16 + rz0 * 7, bp.x, bp.y + 0.2, bp.z, 50);
      else setCam(bp.x + fx0 * 4.6 + rx0 * 2.2, bp.y + 1.5, bp.z + fz0 * 4.6 + rz0 * 2.2, bp.x, bp.y + 1.0, bp.z, 42);
      break;
    case 'duel': { // over the corgi's shoulder on the garage roof: her perch 45–90 m away
      const d = dummies[0].pos, dx = bp.x - d.x, dz = bp.z - d.z, l = Math.hypot(dx, dz);
      const tx = d.x + dx * 0.35, tz = d.z + dz * 0.35, ty = (d.y + bp.y) * 0.5;
      setCam(d.x - (dx / l) * 3.4 - (dz / l) * 1.2, d.y + 1.9, d.z - (dz / l) * 3.4 + (dx / l) * 1.2, tx, ty, tz, Number(Q.get('fov') ?? 42));
      break;
    }
    case 'dot': { // the painted corgi, seen from between it and her, a little to the side
      const d = dummies[0].pos, dx = bp.x - d.x, dz = bp.z - d.z, l = Math.hypot(dx, dz);
      setCam(d.x + (dx / l) * 3.4 + (dz / l) * 1.8, d.y + 1.6, d.z + (dz / l) * 3.4 - (dx / l) * 1.8, d.x, d.y + 0.6, d.z, 50);
      break;
    }
    case 'glint': setCam(L.x + Math.cos(s.aimYaw) * 1.4 - Math.sin(s.aimYaw) * Math.cos(s.aimPitch) * 5, L.y + 0.8, L.z - Math.sin(s.aimYaw) * 1.4 - Math.cos(s.aimYaw) * Math.cos(s.aimPitch) * 5, bp.x, bp.y + 1.0, bp.z, 40); break;
    case 'leap': { // side-on to the whole route, from the lawn
      const from = s.perches[s.prevPerch], dest = s.perches[s.perch];
      const mx = (from.x + dest.x) / 2, my = (from.y + dest.y) / 2, mz = (from.z + dest.z) / 2;
      const rx = dest.x - from.x, rz = dest.z - from.z, rl = Math.hypot(rx, rz) || 1;
      let nx = -rz / rl, nz = rx / rl;
      if (nz < 0) { nx = -nx; nz = -nz; } // look from the yard side (+z)
      setCam(mx + nx * 34, my + 4, mz + nz * 34, mx, my + 1, mz, 58);
      break;
    }
  }
  sync(0);
  let last = performance.now(), frames = 0, fpsT = last, fps = 0;
  const bossName = document.getElementById('bossname');
  if (bossName) bossName.textContent = DEFS.name.toUpperCase();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    worldView.update(dt, camera, sim.tick);
    ctx.render();
    frames++;
    if (now - fpsT > 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
    const st = states.get(boss.id);
    const f = st ? unpackBossFlags(st.flags) : null;
    hpEl.style.width = `${st && st.maxHp ? (100 * st.hp) / st.maxHp : 0}%`;
    const bv = views.get(boss.id)?.avatar as BossAvatar | undefined;
    info.textContent = `boss lab · ${DEFS.name} · view=${view} · perch ${p.id} · ${ctx.backend} · ${fps.toFixed(0)} fps · frozen at t=${simT.toFixed(2)}s\n` +
      (bv ? `model ${bv.stats.triangles} tris · ${bv.stats.drawCalls} draws\n` : '') +
      (f ? `state ${['none', 'track', 'lob', 'leap', 'stagger', 'phase_shift', 'intro', 'dying'][f.attack]} / stage ${f.stage} · progress ${f.progress.toFixed(2)} · phase ${f.phase2 ? 2 : 1} · dot ${(st!.ammo / 100).toFixed(1)} m · hp ${Math.round(st!.hp)}/${st!.maxHp}\n` : '') +
      `telegraph fx: ${tfx.stats.beams} beams · ${tfx.stats.sparks} dots · ${tfx.stats.glints} glints · ${tfx.stats.leapMarks} leap marks · ${tfx.stats.drawCalls} draws`;
    (globalThis as unknown as { __boss: unknown }).__boss = { ready: true, frozen: true, view, t: simT, state: f, stats: bv?.stats ?? null, fx: tfx.stats };
  });
  void SNIPER_ABILITY;
}

const sniperWanted = (() => { const q = Q.get('boss'); return q === 'sniper' || (q !== null && bossIndex(q) >= 0 && q !== 'vac_tank'); })();
(sniperWanted ? sniperLab() : main()).catch((e) => { info.textContent = `lab failed: ${e?.stack ?? e}`; console.error(e); });
