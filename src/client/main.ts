// Client entry: renderer + style pipeline, connection to the authority (worker or WebSocket),
// fixed-rate input, interpolated entity views, third-person camera, HUD.
//
// URL params: ?server=ws://host:8787  play online (default: local worker authority)
//             ?name=Rex&cls=assault&team=0|1  ·  ?lag=80&jitter=10&loss=1  network emulation
//             ?webgl  force the WebGL2 backend  ·  ?bots=0,4  offline bot fill  ·  ?mode=yard-skirmish
import { debug } from './debug/debug-hook';
import * as THREE from 'three/webgpu';
import { createRenderContext } from './engine/renderer';
import { createAdaptiveQuality } from './engine/adaptive-quality';
import { createWorldData } from '../shared/world/world-data';
import { createWorldView } from './world/world-view';
import { createWorkerTransport, createWebSocketTransport, type NetEmulation } from './net/transport';
import { NetClient } from './net/net-client';
import { InputState } from './input/input';
import { EntityViews } from './views/entity-views';
import { createThirdPersonCamera } from './camera/third-person';
import { createHud } from './ui/hud';
import { createFx } from './fx';
import { createAudio } from './audio';
import { Nameplates } from './views/nameplates';
import type { Settings } from './ui/settings';
import { bus } from './core/events';
import { TICK_DT } from '../shared/constants';
import { CLASS_IDS, EFlag, type ClassId, type TeamId } from '../shared/types';

const params = new URLSearchParams(location.search);

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const ui = document.getElementById('ui')!;
  const ctx = await createRenderContext(app, { forceWebGL: params.has('webgl') });
  debug.backend = ctx.backend;

  const seed = Number(params.get('seed') ?? 1);
  const worldData = createWorldData(seed);
  const worldView = createWorldView(ctx.scene, worldData);

  const em: NetEmulation = { lagMs: Number(params.get('lag') ?? 0), jitterMs: Number(params.get('jitter') ?? 0), lossPct: Number(params.get('loss') ?? 0) };
  const serverUrl = params.get('server');
  const mode = params.get('mode') ?? 'yard-skirmish';
  // Skirmish: a corgi squad of bots with you; cat waves come from the match rules. TDM: bot-filled teams.
  const bots = (params.get('bots') ?? (mode === 'team-deathmatch' ? '4,5' : '3,0')).split(',').map(Number) as [number, number];
  const transport = serverUrl
    ? await createWebSocketTransport(serverUrl, em)
    : createWorkerTransport({ seed, mode, bots }, em);
  debug.transport = transport.kind;

  const net = new NetClient(transport);
  const cls = (CLASS_IDS as readonly string[]).includes(params.get('cls') ?? '') ? (params.get('cls') as ClassId) : 'assault';
  const teamParam = params.get('team');
  net.join(params.get('name') ?? 'Rex', cls, teamParam === null ? -1 : (Number(teamParam) as TeamId));

  const input = new InputState();
  input.bind(ctx.renderer.domElement);
  const views = new EntityViews(ctx.scene);
  const cam = createThirdPersonCamera(ctx.camera);
  cam.setColliders(worldView.cameraColliders);
  const quality = createAdaptiveQuality(ctx.renderer);
  const nameplates = new Nameplates(ui);
  const audio = createAudio();
  const fx = createFx(ctx.scene, ctx.camera, views, { heightAt: (x, z) => worldData.height(x, z) });
  const applySettings = (st: Settings) => {
    input.sensitivity = 0.0022 * st.sensitivity;
    input.invertY = st.invertY;
    audio.setVolumes({ master: st.masterVolume, music: st.musicVolume, sfx: st.sfxVolume });
    fx.setQuality(st.quality);
    audio.setQuality(st.quality);
  };
  const hud = createHud(ui, {
    play(o) {
      void audio.unlock();
      ctx.renderer.domElement.requestPointerLock?.();
      if (o.mode === 'online' && o.server) {
        location.search = `?server=${encodeURIComponent(o.server)}&name=${encodeURIComponent(o.name)}&cls=${o.cls}&team=${o.team}`;
        return;
      }
      net.transport.send({ t: 'class', cls: o.cls });
      if (o.team !== -1) net.transport.send({ t: 'team', team: o.team });
    },
    chooseClass: (c) => net.transport.send({ t: 'class', cls: c }),
    chooseTeam: (team) => { if (team !== -1) net.transport.send({ t: 'team', team }); },
    setSetting: () => applySettings(hud.settings),
  });
  hud.setUiSound((k) => audio.ui(k));
  applySettings(hud.settings);
  if (!params.has('autoplay') && !params.has('server')) hud.showMenu(true);

  bus.on('connected', ({ entity }) => {
    const s = net.latestState(entity);
    if (s) input.yaw = s.yaw;
  });
  bus.on('roster', (r) => nameplates.setRoster(r));
  bus.on('notice', (t) => hud.notice(t));
  bus.on('game', (ev) => {
    if (ev.e === 'jump') views.trigger(ev.id, 'jump');
    if (ev.e === 'land') views.trigger(ev.id, 'land', ev.impact);
    if (ev.e === 'hit') views.trigger(ev.dst, 'hit', ev.dmg);
    if (ev.e === 'fire') views.trigger(ev.id, 'fire');
    if (ev.e === 'death') views.trigger(ev.id, 'death');
    if (ev.e === 'spawn') views.trigger(ev.id, 'spawn');
    const r = fx.onGameEvent(ev);
    if (r.shake > 0) cam.shake(r.shake);
    audio.onGameEvent(ev);
    hud.onGameEvent(ev);
  });

  let acc = 0, seq = 0, last = performance.now(), fpsFrames = 0, fpsStart = last;
  const focus = new THREE.Vector3();
  ctx.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const frameMs = now - last;
    const dt = Math.min(0.1, frameMs / 1000);
    last = now;
    acc += dt;
    while (acc >= TICK_DT) {
      acc -= TICK_DT;
      if (net.connected) { const cmd = input.sample(++seq, TICK_DT); cmd.rt = Math.max(0, Math.round(net.renderTime(now) * net.tickHz)); net.pushInput(cmd); }
    }
    net.flush();

    const states = net.interpolated(now);
    const pdt = dt * fx.hitStop(); // hit-stop slows presentation only, never the sim
    views.sync(states, net.localEntity, pdt);
    const local = states.get(net.localEntity) ?? null;
    if (local) {
      focus.set(local.x, local.y, local.z);
      cam.update(focus, input.yaw, input.pitch, (local.flags & EFlag.Aiming) !== 0, dt, Math.hypot(local.vx, local.vz));
    }
    worldView.update(dt, ctx.camera);
    fx.update(dt, states, net.localEntity);
    audio.update(ctx.camera, states, net.localEntity, dt);
    nameplates.update(states, net.localEntity, local?.team ?? 0, ctx.camera, (id) => views.get(id)?.avatar.height ?? 1.4);
    ctx.render();
    quality.update(frameMs);

    fpsFrames++;
    if (now - fpsStart > 500) { debug.fps = (fpsFrames * 1000) / (now - fpsStart); fpsFrames = 0; fpsStart = now; }
    debug.frames++;
    debug.frameMs = frameMs;
    debug.localEntity = net.localEntity;
    debug.entities = states.size;
    debug.local = local ? { x: local.x, y: local.y, z: local.z, hp: local.hp } : null;
    debug.ready = !!local && debug.frames > 5;
    hud.update({ local, match: net.match, roster: net.roster, fps: debug.fps, rttMs: net.stats.rttMs, locked: input.locked || params.has('autoplay'), backend: ctx.backend, transport: transport.kind, states });
  });
}

main().catch((err) => {
  console.error(err);
  debug.errors.push(String(err?.stack ?? err));
  const ui = document.getElementById('ui');
  if (ui) ui.innerHTML = `<pre style="color:#f88;padding:20px;white-space:pre-wrap">Failed to start: ${String(err?.message ?? err)}</pre>`;
});
