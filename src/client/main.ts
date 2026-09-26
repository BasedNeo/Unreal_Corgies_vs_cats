// Client entry: renderer + style pipeline, connection to the authority (worker or WebSocket),
// fixed-rate input, interpolated entity views, third-person camera, HUD.
//
// URL params: ?server=ws://host:8787  play online (default: local worker authority)
//             ?name=Rex&cls=assault&team=0|1  ·  ?lag=80&jitter=10&loss=1  network emulation
//             ?webgl  force the WebGL2 backend  ·  ?bots=0,4  offline bot fill  ·  ?mode=yard-skirmish
import { debug } from './debug/debug-hook';
import * as THREE from 'three/webgpu';
import { createRenderContext } from './engine/renderer';
import { QUALITY, toQualityTier } from './engine/quality';
import { createWorldData } from '../shared/world/world-data';
import { createWorldView } from './world/world-view';
import { districtAt, surfaceAt } from '../shared/world/queries';
import { createWorkerTransport, createWebSocketTransport, type NetEmulation, type Transport } from './net/transport';
import { NetClient } from './net/net-client';
import { serverUrlForPage } from './net/server-url';
import { InputState } from './input/input';
import { EntityViews } from './views/entity-views';
import { createThirdPersonCamera } from './camera/third-person';
import { createHud } from './ui/hud';
import { createFx } from './fx';
import { createAudio } from './audio';
import { createWeatherAudio } from './audio/weather';
import { Nameplates } from './views/nameplates';
import { BossBar } from './views/boss-bar';
import { createBossTelegraphFx } from './procgen/boss';
import { createVehicleViews, vehicleCameraFor, mountedVehicle, followYaw } from './vehicles';
import { createPlaneHud } from './ui/plane-hud';
import { createAdventureHud, createAdventureViews } from './adventure'; // A1
import { chapterById } from '../shared/content/chapters';
import { createInteractViews, createInteractPrompts } from './interact';
import { createCoreRushView } from './modes/core-rush-view';
import { createAbilityViews } from './abilities';
import { loadSettings, type Settings } from './ui/settings';
import { bus } from './core/events';
import { TICK_DT } from '../shared/constants';
import { damp, lerpAngle } from '../shared/math';
import { CLASS_IDS, EFlag, EntityKind, type ClassId, type TeamId } from '../shared/types';
import { sniperPainting } from '../shared/content/bosses';
import type { EntityState } from '../shared/protocol';

const params = new URLSearchParams(location.search);

const loadingStep = (text: string) => { const el = document.getElementById('loading-step'); if (el) el.textContent = text; };
const hideLoading = () => document.getElementById('loading')?.remove();

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  loadingStep('Warming up the renderer…');
  const ui = document.getElementById('ui')!;
  const boot = loadSettings();
  const q = (params.get('quality') as Settings['quality'] | null) ?? boot.quality;
  // P2: the tier's engine knobs (pixel-ratio bounds, shadow pass, bloom) apply from the first frame and live on change
  const ctx = await createRenderContext(app, { forceWebGL: params.has('webgl'), quality: toQualityTier(q) });
  debug.backend = ctx.backend;

  loadingStep('Mowing West Yard…');
  await new Promise((r) => setTimeout(r, 0)); // let the step text paint before the blocking world build
  const seed = Number(params.get('seed') ?? 1);
  const worldData = createWorldData(seed);
  const worldView = createWorldView(ctx.scene, worldData, { quality: q === 'medium' ? 'med' : q, grade: ctx.pipeline.grade.uniforms });
  if (params.has('t')) worldView.setTimeOfDay(Number(params.get('t')));

  const em: NetEmulation = { lagMs: Number(params.get('lag') ?? 0), jitterMs: Number(params.get('jitter') ?? 0), lossPct: Number(params.get('loss') ?? 0) };
  const serverUrl = serverUrlForPage(); // ?server / ?online / ?room / page served by server/prod.ts
  let mode = params.has('boss') ? 'boss-rush' : params.get('mode') ?? 'yard-skirmish';
  // Skirmish: a corgi squad of bots with you; cat waves come from the match rules. TDM / core-rush: bot-filled teams.
  const botsFor = (m: string) => (params.get('bots') ?? (m === 'team-deathmatch' || m === 'core-rush' ? '4,4' : m === 'adventure' ? '4,0' : '3,0')).split(',').map(Number) as [number, number];
  // Adventure chapter (?chapter=, or the menu's chapter picker); the authority validates it.
  let chapter = /^[a-z0-9_]{1,32}$/.test(params.get('chapter') ?? '') ? params.get('chapter')! : undefined;
  // ?boss=<id> (boss-rush showcase; '1' = the Vac-Tank): E1's Madame Pointillé is ?boss=madame_pointille.
  const bossId = /^[a-z0-9_]{1,32}$/.test(params.get('boss') ?? '') ? params.get('boss')! : undefined;
  // The session (authority + connection) starts only when the player presses PLAY — or immediately for
  // ?autoplay / online links — so an offline match never runs behind the menu (QA W1 FTUE finding).
  let net: NetClient | null = null;
  let transport: Transport | null = null;
  let starting = false;
  const startSession = async (name: string, cls: ClassId, team: TeamId | -1, match?: string): Promise<void> => {
    if (net || starting) return;
    starting = true;
    if (match && !params.has('boss')) mode = match; // the menu's MATCH selector (offline only)
    const bots = botsFor(mode);
    loadingStep(serverUrl ? 'Calling the server…' : 'Waking up the squad…');
    transport = serverUrl ? await createWebSocketTransport(serverUrl, em) : createWorkerTransport({ seed, mode, bots, chapter: mode === 'adventure' ? chapter : undefined, boss: mode === 'boss-rush' ? bossId : undefined }, em);
    debug.transport = transport.kind;
    net = new NetClient(transport);
    net.join(name, cls, team);
  };
  const urlCls = (CLASS_IDS as readonly string[]).includes(params.get('cls') ?? '') ? (params.get('cls') as ClassId) : 'assault';
  const teamParam = params.get('team');
  const urlTeam: TeamId | -1 = teamParam === null ? -1 : (Number(teamParam) as TeamId);
  const autoStart = params.has('autoplay') || !!serverUrl;

  const input = new InputState();
  input.bind(ctx.renderer.domElement);
  const views = new EntityViews(ctx.scene, { surfaceAt: (x, z, y) => surfaceAt(worldData, x, z, y).y });
  views.setBlobShadows(!QUALITY[toQualityTier(q)].shadows); // low tier: no shadow pass → blob shadows
  const vehicles = createVehicleViews(ctx.scene, { world: worldData, camera: ctx.camera });
  const bossFx = createBossTelegraphFx(ctx.scene, { heightAt: (x, z) => worldData.height(x, z) });
  const bossBar = new BossBar(ui);
  // S1: Ordnance kiosks, Upgrade Cores, Golden Kibble, the mission beacon (3D) + E prompt, kit picker, buffs, mission card
  const interact = createInteractViews(ctx.scene, { world: worldData, camera: ctx.camera });
  const rush = createCoreRushView(ctx.scene, ui); // core-rush pads + A·B·C strip (idle in other modes)
  const abilityViews = createAbilityViews(ctx.scene, { camera: ctx.camera }); // C2: drones, charges, barriers, spotted markers
  const advViews = createAdventureViews(ctx.scene); // A1: sentry cones (stealth steps), catnip bags
  // Concealment cue: the sim sets EFlag.Stealthed while the local corgi is hidden in tall grass.
  const hiddenCue = document.createElement('div');
  hiddenCue.textContent = 'HIDDEN';
  hiddenCue.style.cssText = 'position:absolute;left:50%;bottom:92px;transform:translateX(-50%);padding:4px 12px;border:3px solid #1a120c;border-radius:10px;background:#3f6e2acc;color:#e9f7d2;font:900 14px/1 "Lilita One",system-ui,sans-serif;letter-spacing:.12em;box-shadow:2px 2px 0 #1a120c;display:none;pointer-events:none';
  ui.appendChild(hiddenCue);
  // Spotted cue: an enemy Spotter Drone has you marked (EFlag.Spotted) — they can see you through walls.
  const spottedCue = hiddenCue.cloneNode() as HTMLDivElement;
  spottedCue.textContent = 'SPOTTED';
  spottedCue.style.background = '#b8342acc';
  spottedCue.style.color = '#ffe9e2';
  spottedCue.style.bottom = '124px';
  ui.appendChild(spottedCue);
  // E1: the sniper's dot is on you (the beam can be off-screen while aiming down sights: the fair-play backstop).
  const dotCue = spottedCue.cloneNode() as HTMLDivElement;
  dotCue.textContent = 'DOT ON YOU';
  dotCue.style.bottom = '156px';
  ui.appendChild(dotCue);
  const cam = createThirdPersonCamera(ctx.camera);
  cam.setColliders(worldView.cameraColliders);
  const quality = ctx.adaptive;
  let settingTier = toQualityTier(boot.quality); // ?quality= wins at boot; a Settings change applies live
  const nameplates = new Nameplates(ui);
  const audio = createAudio();
  const weatherAudio = createWeatherAudio(audio.engine, worldData);
  const fx = createFx(ctx.scene, ctx.camera, views, { heightAt: (x, z) => worldData.height(x, z) });
  const applySettings = (st: Settings) => {
    input.sensitivity = 0.0022 * st.sensitivity;
    input.invertY = st.invertY;
    cam.setShakeScale(st.shake);
    cam.setBaseFov(st.fov);
    audio.setVolumes({ master: st.masterVolume, music: st.musicVolume, sfx: st.sfxVolume });
    fx.setQuality(st.quality);
    if (toQualityTier(st.quality) !== settingTier) {
      settingTier = toQualityTier(st.quality);
      ctx.setQuality(settingTier);
      worldView.setQuality(settingTier);
      views.setBlobShadows(!QUALITY[settingTier].shadows);
    }
    audio.setQuality(st.quality);
  };
  const hud = createHud(ui, {
    play(o) {
      void audio.unlock();
      ctx.renderer.domElement.requestPointerLock?.();
      if (o.mode === 'online' && o.server) {
        const room = o.room ? `&room=${encodeURIComponent(o.room)}` : '';
        const adv = o.match === 'adventure' && o.chapter ? `&mode=adventure&chapter=${encodeURIComponent(o.chapter)}` : ''; // A1: co-op chapter room
        location.search = `?server=${encodeURIComponent(o.server)}&name=${encodeURIComponent(o.name)}&cls=${o.cls}&team=${o.team}${room}${adv}`;
        return;
      }
      if (!net) { if (o.chapter) chapter = o.chapter; void startSession(o.name, o.cls, o.team, o.match); return; } // A1: the picked chapter
      if (!serverUrl && o.match && (o.match !== mode || (o.match === 'adventure' && o.chapter !== chapter))) {
        // a different offline match type (or chapter) needs a fresh authority: restart the page straight into it
        location.search = `?mode=${o.match}${o.chapter ? `&chapter=${encodeURIComponent(o.chapter)}` : ''}&autoplay&name=${encodeURIComponent(o.name)}&cls=${o.cls}&team=${o.team}`;
        return;
      }
      net.transport.send({ t: 'class', cls: o.cls });
      if (o.team !== -1) net.transport.send({ t: 'team', team: o.team });
    },
    chooseClass: (c) => net?.transport.send({ t: 'class', cls: c }),
    chooseTeam: (team) => { if (team !== -1) net?.transport.send({ t: 'team', team }); },
    setSetting: () => applySettings(hud.settings),
    // U1 chat: the authority echoes every line (rate-limited); the game sees no keys while chat is open
    sendChat: (text) => { if (!net?.connected) return false; net.transport.send({ t: 'chat', text }); return true; },
    chatOpenChanged: (open) => { input.suspended = open; },
  }, { match: mode });
  hud.setUiSound((k) => audio.ui(k));
  const prompts = createInteractPrompts(ui, { send: (msg) => net?.transport.send(msg), sound: (k) => audio.ui(k) });
  const planeHud = createPlaneHud(ui);
  // A1: intro/outro captions, step barks, the squad-down beat, the chapter-complete card (+ device progress)
  const adventureUrl = (id: string) => {
    const p = new URLSearchParams(location.search);
    p.set('mode', 'adventure'); p.set('chapter', id); p.set('autoplay', ''); p.set('team', '0');
    p.set('cls', chapterById(id)?.cls ?? 'assault'); p.set('name', hud.settings.name ?? 'Rex');
    return `?${p}`;
  };
  const adventure = createAdventureHud(ui, {
    roomAdvances: !!serverUrl, // online rooms move on by themselves after the result
    sound: (k) => audio.ui(k),
    onNext: (id) => { location.search = adventureUrl(id); },
    onReplay: (id) => { location.search = adventureUrl(id); },
    // a new chapter: face its first objective (the start yaw) and use its time of day
    onChapter: (def) => { input.yaw = def.start.yaw; if (def.t !== undefined && !params.has('t')) worldView.setTimeOfDay(def.t); },
  });
  applySettings(hud.settings);
  if (autoStart) await startSession(params.get('name') ?? hud.settings.name ?? 'Rex', urlCls, urlTeam);
  else hud.showMenu(true);

  bus.on('localSpawn', (id) => {
    const s = net?.latestState(id);
    if (s) input.yaw = s.yaw;
  });
  bus.on('disconnected', (reason) => {
    hud.notice(`Disconnected: ${reason}`);
    if (!net?.canReconnect) return;
    const btn = document.createElement('button');
    btn.textContent = 'Reconnect';
    btn.className = 'interactive';
    btn.style.cssText = 'position:absolute;left:50%;top:60%;transform:translateX(-50%);font:800 22px system-ui;padding:10px 22px;border:3px solid #1a120c;border-radius:12px;background:#f2c14e;cursor:pointer;pointer-events:auto';
    btn.onclick = () => { btn.remove(); void net?.reconnect(); };
    ui.appendChild(btn);
  });
  bus.on('roster', (r) => nameplates.setRoster(r));
  bus.on('notice', (t) => hud.serverNotice(t));
  bus.on('chat', (m) => hud.chat(m.from, m.text, m.team));
  // Kill cam state: who knocked the local player out (from the death event) and the swinging view.
  const killCam = { by: -1, yaw: 0, pitch: -0.12, fresh: true };
  bus.on('game', (ev) => {
    if (ev.e === 'jump') views.trigger(ev.id, 'jump');
    if (ev.e === 'land') views.trigger(ev.id, 'land', ev.impact);
    if (ev.e === 'hit') views.trigger(ev.dst, 'hit', ev.dmg);
    if (ev.e === 'fire') views.trigger(ev.id, 'fire');
    if (ev.e === 'death') {
      views.trigger(ev.id, 'death');
      if (ev.id === net?.localEntity) killCam.by = ev.by !== ev.id ? ev.by : -1;
      if (ev.by !== ev.id && ev.by >= 0) views.trigger(ev.by, 'kill'); // K1: the killer's smug grin
    }
    if (ev.e === 'spawn') views.trigger(ev.id, 'spawn');
    if (ev.e === 'ability') views.trigger(ev.id, ev.ability);
    if (ev.e === 'bark') views.trigger(ev.id, 'emote'); // taunts and mission lines: the avatar acts it out
    bossFx.onGameEvent(ev);
    interact.onGameEvent(ev);
    abilityViews.onGameEvent(ev);
    worldView.destruct.onGameEvent(ev); // X1: breaks (rubble + debris at once)
    adventure.onGameEvent(ev); // A1
    prompts.onGameEvent(ev, net?.localEntity ?? -1);
    const r = fx.onGameEvent(ev);
    if (r.shake > 0) cam.shake(r.shake);
    audio.onGameEvent(ev);
    hud.onGameEvent(ev);
  });

  let acc = 0, seq = 0, last = performance.now(), fpsFrames = 0, fpsStart = last, menuT = 0;
  // District name toast ("The Garage", "The Rooftops", "The Garden"): once you've been in a new one for 0.6 s, and not
  // again for the same district within 30 s, so walking along a border doesn't spam it.
  let districtCur = '', districtSince = 0, districtShown = '';
  const districtToastAt = new Map<string, number>();
  const EMPTY = new Map<number, EntityState>();
  const focus = new THREE.Vector3();
  ctx.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const frameMs = now - last;
    const dt = Math.min(0.25, frameMs / 1000); // keep input real-time even on slow frames (server absorbs bursts)
    last = now;
    acc += dt;
    while (acc >= TICK_DT) {
      acc -= TICK_DT;
      if (net?.connected && !net.awaitingSpawn) { const cmd = input.sample(++seq, TICK_DT); cmd.rt = Math.max(0, Math.round(net.renderTime(now) * net.tickHz)); net.pushInput(cmd); }
    }
    net?.flush();

    const states = net ? net.interpolated(now) : EMPTY;
    const localId = net?.localEntity ?? -1;
    const pdt = dt * fx.hitStop(); // hit-stop slows presentation only, never the sim
    views.sync(states, localId, pdt);
    vehicles.sync(states, pdt);
    adventure.update(states, net?.match ?? null, localId, dt); // A1: before interact.sync (points S1's chain slot at the chapter)
    advViews.sync(states, adventure.view, pdt);
    interact.sync(states, pdt);
    prompts.update(states, localId, dt);
    rush.sync(states, states.get(localId)?.team ?? 0, ctx.camera, dt);
    abilityViews.sync(states, (states.get(localId)?.team ?? -1) as TeamId | -1, pdt);
    worldView.destruct.sync(states); // X1: broken/standing from snapshots (late joins, resets)
    worldView.destruct.update(pdt); // X1: debris
    bossFx.update(dt, states);
    bossBar.update(states, dt);
    const local = states.get(localId) ?? null;
    const kart = local ? mountedVehicle(local, states) : null;
    planeHud.update(kart, kart ? worldData.height(kart.x, kart.z) : 0); // shows itself only for a plane
    if (kart) {
      const c = vehicleCameraFor(kart);
      if (!input.lookedRecently()) {
        input.yaw = followYaw(input.yaw, c.yaw, c.followRate, dt); // swing behind the vehicle
        if (c.pitchFollow > 0) input.pitch = damp(input.pitch, c.pitch, c.pitchFollow, dt); // R1: planes settle behind the nose
      }
      focus.set(kart.x, kart.y, kart.z);
      cam.update(focus, input.yaw, input.pitch, false, dt, Math.hypot(kart.vx, kart.vz), c);
    } else if (local && (local.flags & EFlag.Dead) && killCam.by >= 0 && states.get(killCam.by)) {
      // Kill cam: while you wait to respawn, the camera swings around to face whoever knocked you out.
      const k = states.get(killCam.by)!;
      const want = Math.atan2(-(k.x - local.x), -(k.z - local.z));
      killCam.yaw = killCam.fresh ? input.yaw : lerpAngle(killCam.yaw, want, 1 - Math.exp(-3 * dt));
      killCam.fresh = false;
      const pitchWant = Math.max(-0.5, Math.min(0.25, -Math.atan2(k.y - local.y, Math.hypot(k.x - local.x, k.z - local.z)) - 0.12));
      killCam.pitch += (pitchWant - killCam.pitch) * (1 - Math.exp(-3 * dt));
      focus.set(local.x, local.y, local.z);
      cam.update(focus, killCam.yaw, killCam.pitch, false, dt, 0);
    } else if (local) {
      killCam.fresh = true;
      focus.set(local.x, local.y, local.z);
      cam.update(focus, input.yaw, input.pitch, (local.flags & EFlag.Aiming) !== 0, dt, Math.hypot(local.vx, local.vz));
    } else if (!net) {
      // Menu backdrop: a slow orbit over the yard.
      menuT += dt * 0.05;
      ctx.camera.position.set(Math.sin(menuT) * 55, 18 + Math.sin(menuT * 0.7) * 4, Math.cos(menuT) * 55);
      ctx.camera.lookAt(0, 2, 0);
    }
    hiddenCue.style.display = local && (local.flags & EFlag.Stealthed) && !(local.flags & EFlag.Dead) ? 'block' : 'none';
    spottedCue.style.display = local && (local.flags & EFlag.Spotted) && !(local.flags & EFlag.Dead) ? 'block' : 'none';
    let painted = false;
    if (local && !(local.flags & EFlag.Dead)) {
      for (const s of states.values()) if (s.kind === EntityKind.Boss && sniperPainting(s, local.x, local.y, local.z)) { painted = true; break; }
    }
    dotCue.style.display = painted ? 'block' : 'none';
    if (local && !(local.flags & EFlag.Dead)) {
      const d = districtAt(worldData, local.x, local.z, local.y)?.name ?? '';
      if (d !== districtCur) { districtCur = d; districtSince = now; }
      else if (d && d !== districtShown && now - districtSince > 600 && now - (districtToastAt.get(d) ?? -1e9) > 30_000) {
        districtShown = d; districtToastAt.set(d, now);
        hud.notice(`— ${d.toUpperCase()} —`);
      }
      if (!d) districtShown = '';
    }
    const lv = views.get(localId); // hide our own avatar when a wall squeezes the camera into it
    if (lv) lv.avatar.root.visible = !!kart || cam.boom > 0.75;
    // Weather/time of day are pure functions of (seed, tick): drive them from the same server timebase as entities.
    const wTick = net?.connected ? net.renderTime(now) * net.tickHz : undefined;
    worldView.update(dt, ctx.camera, wTick);
    weatherAudio.update(worldView.weather, worldView.tick, ctx.camera, dt);
    fx.update(dt, states, localId);
    audio.update(ctx.camera, states, localId, dt);
    nameplates.update(states, localId, local?.team ?? 0, ctx.camera, (id) => views.get(id)?.avatar.height ?? 1.4);
    ctx.render();
    quality.update(frameMs);

    fpsFrames++;
    if (now - fpsStart > 500) { debug.fps = (fpsFrames * 1000) / (now - fpsStart); fpsFrames = 0; fpsStart = now; }
    debug.frames++;
    debug.frameMs = frameMs;
    debug.localEntity = localId;
    debug.entities = states.size;
    debug.local = local ? { x: local.x, y: local.y, z: local.z, hp: local.hp } : null;
    debug.ready = !!local && debug.frames > 5;
    if ((local || !net) && debug.frames > 2) hideLoading();
    hud.update({ local, match: net?.match ?? null, roster: net?.roster ?? [], fps: debug.fps, rttMs: net?.stats.rttMs ?? 0, locked: input.locked || params.has('autoplay') || !net, backend: ctx.backend, transport: transport?.kind ?? 'none', states });
  });
}

main().catch((err) => {
  console.error(err);
  debug.errors.push(String(err?.stack ?? err));
  hideLoading();
  const ui = document.getElementById('ui');
  if (ui) ui.innerHTML = `<pre style="color:#f88;padding:20px;white-space:pre-wrap">Failed to start: ${String(err?.message ?? err)}</pre>`;
});
