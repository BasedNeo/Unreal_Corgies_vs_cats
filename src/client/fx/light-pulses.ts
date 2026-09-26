// OWNER: X3. Short light pulses for muzzle flashes and explosions: a FIXED pool of point lights (count per quality
// tier: high 2 · medium 1 · low 0). Lights never leave the scene between pulses — an idle light just sits at
// intensity 0 — because changing the number of lights recompiles every lit material in three.js; the pool size
// changes only when the tier changes (one rebuild, like the shadow toggle). A pulse steals the dimmest light, and the
// local player's shots are weighted so your own rifle always lights your corner of the yard.
// The envelope is pure (PulseEnvelope, tested in Node); PulseLights owns the three.js lights.
import * as THREE from 'three/webgpu';

/** One pulse slot's state (pure). */
export class PulseEnvelope {
  peak = 0;
  t = 0;
  dur = 0;
  weight = 0;
  x = 0; y = 0; z = 0;
  color = 0xffffff;
  range = 5;
  /** Current intensity: a 12 ms attack, then an exponential-ish fall to zero at `dur`. */
  get value(): number {
    if (this.peak <= 0 || this.t >= this.dur) return 0;
    const a = 0.012;
    if (this.t < a) return this.peak * (0.35 + 0.65 * (this.t / a));
    const u = (this.t - a) / Math.max(1e-3, this.dur - a);
    const k = 1 - u;
    return this.peak * k * k;
  }
  step(dt: number): void { if (this.peak > 0) { this.t += dt; if (this.t >= this.dur) this.peak = 0; } }
}

/** Picks the slot to use for a new pulse: an idle one, else the one whose weighted remaining light is lowest. */
export function pickSlot(slots: readonly PulseEnvelope[], count: number): number {
  let best = -1, bestV = Infinity;
  for (let i = 0; i < count; i++) {
    const v = slots[i].value * (1 + slots[i].weight);
    if (v <= 0) return i;
    if (v < bestV) { bestV = v; best = i; }
  }
  return best;
}

export class PulseLights {
  readonly group = new THREE.Group();
  readonly slots: PulseEnvelope[] = [];
  private lights: THREE.PointLight[] = [];
  private count = 0;

  constructor(readonly max = 3, count = 2) {
    this.group.name = 'fx_light_pulses';
    for (let i = 0; i < max; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 5, 2);
      l.castShadow = false;
      l.name = `fx_pulse_${i}`;
      this.lights.push(l);
      this.slots.push(new PulseEnvelope());
    }
    this.setCount(count);
  }

  /** Lights in the scene (quality tier). Changing it rebuilds lit materials once; idle lights stay at intensity 0. */
  setCount(n: number): void {
    const c = Math.max(0, Math.min(this.max, n | 0));
    if (c === this.count && this.group.children.length === c) return;
    this.count = c;
    this.group.clear();
    for (let i = 0; i < c; i++) this.group.add(this.lights[i]);
    for (let i = c; i < this.max; i++) { this.slots[i].peak = 0; this.lights[i].intensity = 0; }
  }

  get size(): number { return this.count; }

  /** Starts a pulse (no-op on the low tier). `weight` > 0 protects it from being stolen (local player's shots). */
  pulse(x: number, y: number, z: number, color: number, peak: number, range: number, dur: number, weight = 0): void {
    if (this.count === 0 || peak <= 0) return;
    const i = pickSlot(this.slots, this.count);
    if (i < 0) return;
    const s = this.slots[i];
    // Never steal a stronger, protected pulse for a weaker one.
    if (s.value * (1 + s.weight) > peak * (1 + weight)) return;
    s.peak = peak; s.t = 0; s.dur = dur; s.weight = weight; s.x = x; s.y = y; s.z = z; s.color = color; s.range = range;
    const l = this.lights[i];
    l.position.set(x, y, z);
    l.color.setHex(color);
    l.distance = range;
  }

  update(dt: number): number {
    let active = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.slots[i];
      s.step(dt);
      const v = s.value;
      this.lights[i].intensity = v;
      if (v > 0) active++;
    }
    return active;
  }

  dispose(): void { this.group.clear(); for (const l of this.lights) l.dispose(); }
}
