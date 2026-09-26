// OWNER: L5 (juice). Voice budget for one-shot sounds — pure scheduling logic, no Web Audio (unit-tested).
//
// Rules, in order:
//  1. A category at its cap steals its own oldest voice (if the newcomer's priority ≥ that voice's), else rejects.
//  2. At the global cap, steal the voice with the LOWEST priority, oldest first, whose priority ≤ the newcomer's.
//  3. Nothing stealable → reject (the new sound is dropped; important sounds never lose to trivial ones).
// Voices end on their own at `end`; prune(now) frees them. Stolen voices get `onSteal` so the engine can fade
// them out over a few ms (no clicks).

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

  acquire(now: number, duration: number, priority: number, category: string): AcquireResult | null {
    this.prune(now);
    let stolen: VoiceInfo | null = null;
    const cap = this.caps[category];
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
