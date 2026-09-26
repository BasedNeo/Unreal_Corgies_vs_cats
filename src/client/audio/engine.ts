// OWNER: L5 (juice). Web Audio engine: buses (master → limiter → out; music, sfx, ui), unlock on the first user
// gesture, listener = camera, spatial one-shots through PannerNodes, voice limiting with click-free stealing,
// distance culling. The AudioContext is only created inside a user gesture, so browsers never log autoplay
// warnings and nothing plays before the player interacts (MASTER_PLAN §7.12: muted until first gesture).
import { VoiceLimiter, type VoiceInfo } from './voice-limiter';
import type { Recipe } from './presets';
import type { Voice } from './synth';

export type Bus = 'sfx' | 'ui' | 'music';

export interface PlayOptions {
  /** World position for spatial sounds; omit for 2D (UI, local confirmations). */
  x?: number; y?: number; z?: number;
  bus?: Bus;
  /** Linear gain multiplier. */
  gain?: number;
  /** Higher survives voice stealing (0 footsteps … 3 critical). */
  priority?: number;
  category?: string;
  /** Recipe strength/variant parameter. */
  k?: number;
  /** Cull beyond this distance from the listener (m). */
  maxDist?: number;
  /** Panner reference distance (m): full volume inside. */
  refDist?: number;
}

export interface Volumes { master: number; music: number; sfx: number }

interface Live { info: VoiceInfo; out: GainNode; nodes: AudioNode[] }

export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  buses: Record<Bus, GainNode> | null = null;
  readonly limiter: VoiceLimiter;
  panningModel: PanningModelType = 'HRTF';
  private volumes: Volumes = { master: 0.8, music: 0.55, sfx: 0.9 };
  private live = new Map<number, Live>();
  private lx = 0; private ly = 0; private lz = 0;
  private seed = 0x2545f491;
  private onReady: Array<(ctx: AudioContext) => void> = [];
  private unlockBound = () => { void this.unlock(); };

  constructor(maxVoices = 28) {
    this.limiter = new VoiceLimiter(maxVoices);
  }

  get unlocked(): boolean { return !!this.ctx && this.ctx.state === 'running'; }

  /** Listens for the first pointer/key/touch gesture anywhere and unlocks then. */
  attachUnlock(target: Window = window): void {
    for (const e of ['pointerdown', 'keydown', 'touchstart'] as const) target.addEventListener(e, this.unlockBound, { passive: true });
  }

  /** Creates/resumes the context. Must be called from a user gesture (the lab/menu buttons do this). */
  async unlock(): Promise<boolean> {
    if (typeof AudioContext === 'undefined') return false;
    if (!this.ctx) this.build();
    if (this.ctx!.state !== 'running') { try { await this.ctx!.resume(); } catch { return false; } }
    if (this.ctx!.state === 'running') {
      for (const e of ['pointerdown', 'keydown', 'touchstart'] as const) window.removeEventListener(e, this.unlockBound);
      return true;
    }
    return false;
  }

  /** Runs `fn` as soon as the context exists (immediately if it already does). */
  whenReady(fn: (ctx: AudioContext) => void): void {
    if (this.ctx) fn(this.ctx); else this.onReady.push(fn);
  }

  private build(): void {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    // Master chain: gentle glue compression then a brick-wall-ish limiter so stacked explosions never clip.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18; glue.knee.value = 12; glue.ratio.value = 3; glue.attack.value = 0.006; glue.release.value = 0.2;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    this.master = ctx.createGain();
    this.master.connect(glue); glue.connect(lim); lim.connect(ctx.destination);
    const mk = () => { const g = ctx.createGain(); g.connect(this.master!); return g; };
    this.buses = { sfx: mk(), ui: mk(), music: mk() };
    this.applyVolumes(true);
    const l = ctx.listener;
    if (l.positionX) { l.positionX.value = this.lx; l.positionY.value = this.ly; l.positionZ.value = this.lz; }
    for (const fn of this.onReady.splice(0)) fn(ctx);
  }

  setVolumes(v: Partial<Volumes>): void {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes(false);
  }

  getVolumes(): Volumes { return { ...this.volumes }; }

  private applyVolumes(immediate: boolean): void {
    if (!this.ctx || !this.master || !this.buses) return;
    const t = this.ctx.currentTime;
    // Perceptual curve: slider² so 50% sounds like half.
    const set = (g: GainNode, v: number) => { const x = Math.max(0, Math.min(1, v)); const val = x * x; if (immediate) g.gain.value = val; else g.gain.setTargetAtTime(val, t, 0.03); };
    set(this.master, this.volumes.master);
    set(this.buses.music, this.volumes.music);
    set(this.buses.sfx, this.volumes.sfx);
    set(this.buses.ui, Math.min(1, this.volumes.sfx * 1.1));
  }

  /** Camera = listener. Pass world position + forward and up unit vectors. */
  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    this.lx = px; this.ly = py; this.lz = pz;
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(px, t, 0.02); l.positionY.setTargetAtTime(py, t, 0.02); l.positionZ.setTargetAtTime(pz, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02); l.forwardY.setTargetAtTime(fy, t, 0.02); l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(ux, t, 0.02); l.upY.setTargetAtTime(uy, t, 0.02); l.upZ.setTargetAtTime(uz, t, 0.02);
    } else {
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  distanceTo(x: number, y: number, z: number): number { return Math.hypot(x - this.lx, y - this.ly, z - this.lz); }

  private rand = () => { let s = this.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.seed = s >>> 0; return this.seed / 4294967296; };

  /** Plays a recipe. Returns false when culled, rejected by the limiter, or audio is still locked. */
  play(recipe: Recipe, o: PlayOptions = {}): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.buses || ctx.state !== 'running') return false;
    const spatial = o.x !== undefined;
    if (spatial && this.distanceTo(o.x!, o.y ?? 0, o.z!) > (o.maxDist ?? 55)) return false;
    const now = ctx.currentTime;
    // Estimate duration first by acquiring with a generous guess, then correct once the recipe reports it.
    const acq = this.limiter.acquire(now, 1.5, o.priority ?? 1, o.category ?? 'fx');
    if (!acq) return false;
    if (acq.stolen) this.fadeOut(acq.stolen.id);

    const out = ctx.createGain();
    out.gain.value = o.gain ?? 1;
    const nodes: AudioNode[] = [out];
    let tail: AudioNode = out;
    if (spatial) {
      const p = ctx.createPanner();
      p.panningModel = this.panningModel;
      p.distanceModel = 'inverse';
      p.refDistance = o.refDist ?? 3;
      p.maxDistance = 80;
      p.rolloffFactor = 1.15;
      if (p.positionX) { p.positionX.value = o.x!; p.positionY.value = o.y ?? 0; p.positionZ.value = o.z!; } else p.setPosition(o.x!, o.y ?? 0, o.z!);
      out.connect(p);
      nodes.push(p);
      tail = p;
    }
    tail.connect(this.buses[o.bus ?? 'sfx']);
    const voice: Voice = { ctx, out, t: now + 0.005, rand: this.rand };
    let dur = 0.5;
    try { dur = recipe(voice, o.k ?? 0); } catch (e) { console.warn('[audio] recipe failed', e); }
    const info = this.limiter.list().find((v) => v.id === acq.id);
    if (info) info.end = now + dur + 0.1;
    const live: Live = { info: info ?? { id: acq.id, category: '', priority: 0, start: now, end: now + dur }, out, nodes };
    this.live.set(acq.id, live);
    setTimeout(() => this.cleanup(acq.id), (dur + 0.3) * 1000);
    return true;
  }

  /** Click-free stop: 25 ms fade on the voice gain, then disconnect. */
  private fadeOut(id: number): void {
    const l = this.live.get(id);
    if (!l || !this.ctx) return;
    const t = this.ctx.currentTime;
    l.out.gain.cancelScheduledValues(t);
    l.out.gain.setValueAtTime(l.out.gain.value, t);
    l.out.gain.linearRampToValueAtTime(0, t + 0.025);
    setTimeout(() => this.cleanup(id), 60);
  }

  private cleanup(id: number): void {
    const l = this.live.get(id);
    if (!l) return;
    this.live.delete(id);
    this.limiter.release(id);
    for (const n of l.nodes) { try { n.disconnect(); } catch { /* already */ } }
  }

  dispose(): void {
    for (const id of [...this.live.keys()]) this.cleanup(id);
    void this.ctx?.close();
    this.ctx = null;
  }
}
