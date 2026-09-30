// OWNER: L5 (juice). Voice budget for one-shot sounds — pure scheduling logic, no Web Audio (unit-tested).
//
// Rules, in order:
//  1. A category at its cap steals its own oldest voice (if the newcomer's priority ≥ that voice's), else rejects.
//  2. At the global cap, steal the voice with the LOWEST priority, oldest first, whose priority ≤ the newcomer's.
//  3. Nothing stealable → reject (the new sound is dropped; important sounds never lose to trivial ones).
// Voices end on their own at `end`; prune(now) frees them. The engine fades a stolen one-shot out over a few ms
// (no clicks). Continuous voices (S2 engine loops) acquire with `canSteal = false`, so a loop never pushes a
// one-shot out, and renew their slot with `extend()` each update; `extend()` returning false means the loop was
// stolen (or pruned) and must fade.

export interface VoiceInfo {
  id: number;
  category: string;
  priority: number;
  start: number;
  end: number;
}

export interface AcquireResult {
  id: number;
  /** The voice that was stolen to make room, if any. */
  stolen: VoiceInfo | null;
}

export const DEFAULT_CATEGORY_CAPS: Readonly<Record<string, number>> = {
  foot: 6, fire: 8, hit: 6, voice: 4, impact: 6, ui: 4, fx: 8,
  // S2 vehicle engine loops: at most 4 audible + 2 fading out (vehicle-loops.ts keeps to this itself)
  engine: 6,
  // W10 AU2: fuse ticks in their own category (gunfire and fx can never crowd them out); the site ambience's one-shots
  // (drips, creaks, distant clanks) and its positional loops (rain on metal / tarps, floodlight hum), all priority 0
  fuse: 4, amb: 3, ambloop: 6,
};

export class VoiceLimiter {
  readonly maxVoices: number;
  private caps: Record<string, number>;
  private voices: VoiceInfo[] = [];
  private nextId = 1;
  /** Counters for diagnostics/tests. */
  readonly stats = { acquired: 0, stolen: 0, rejected: 0 };

  constructor(maxVoices = 28, caps: Readonly<Record<string, number>> = DEFAULT_CATEGORY_CAPS) {
    this.maxVoices = Math.max(1, maxVoices);
    this.caps = { ...caps };
  }

  get active(): number { return this.voices.length; }
  countIn(category: string): number { let n = 0; for (const v of this.voices) if (v.category === category) n++; return n; }
  list(): readonly VoiceInfo[] { return this.voices; }

  /** Frees voices whose sound has finished. */
  prune(now: number): void {
    let w = 0;
    for (let r = 0; r < this.voices.length; r++) { const v = this.voices[r]; if (v.end > now) this.voices[w++] = v; }
    this.voices.length = w;
  }

  release(id: number): void {
    const i = this.voices.findIndex((v) => v.id === id);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /** Renews a held voice until `end`. False when the voice is gone (stolen, released or pruned). No allocation. */
  extend(id: number, end: number): boolean {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) if (vs[i].id === id) { if (end > vs[i].end) vs[i].end = end; return true; }
    return false;
  }

  /** `canSteal = false`: take a free voice or nothing (continuous loops must never cut a one-shot off). */
  acquire(now: number, duration: number, priority: number, category: string, canSteal = true): AcquireResult | null {
    this.prune(now);
    let stolen: VoiceInfo | null = null;
    const cap = this.caps[category];
    if (!canSteal && ((cap !== undefined && this.countIn(category) >= cap) || this.voices.length >= this.maxVoices)) {
      this.stats.rejected++;
      return null;
    }
    if (cap !== undefined && this.countIn(category) >= cap) {
      stolen = this.pickVictim(priority, category);
      if (!stolen) { this.stats.rejected++; return null; }
      this.remove(stolen);
    }
    if (!stolen && this.voices.length >= this.maxVoices) {
      stolen = this.pickVictim(priority, null);
      if (!stolen) { this.stats.rejected++; return null; }
      this.remove(stolen);
    }
    if (stolen) this.stats.stolen++;
    const v: VoiceInfo = { id: this.nextId++, category, priority, start: now, end: now + Math.max(0.01, duration) };
    this.voices.push(v);
    this.stats.acquired++;
    return { id: v.id, stolen };
  }

  /** Lowest priority first, then oldest; never a voice more important than the newcomer. */
  private pickVictim(priority: number, category: string | null): VoiceInfo | null {
    let best: VoiceInfo | null = null;
    for (const v of this.voices) {
      if (category !== null && v.category !== category) continue;
      if (v.priority > priority) continue;
      if (!best || v.priority < best.priority || (v.priority === best.priority && v.start < best.start)) best = v;
    }
    return best;
  }

  private remove(v: VoiceInfo): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }
}
