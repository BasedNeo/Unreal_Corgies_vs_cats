// OWNER: X3 (weapons + combat feedback). Hit confirmation at the crosshair: four inked diagonal ticks that pop on
// every hit you deal — white for a hit, gold and bigger for a crit (headshot), red and spinning in with a ring burst
// for a kill. Rapid hits stack (the ticks grow and brighten through a burst) so a landed spray feels different from
// a single tap. The sound (audio hitThud) and the FOV punch (camera.punch) fire from the same GameEvent.
//
// Pure model (HitMarkerModel, tested in Node) + a DOM view that writes only changed style values (no layout reads,
// no per-frame allocation). Wiring (lead): see docs/handoff/X3.md §HUD.
import type { GameEvent } from '../../shared/protocol';

export const HitKind = { None: 0, Hit: 1, Crit: 2, Kill: 3 } as const;
export type HitKindId = (typeof HitKind)[keyof typeof HitKind];

/** Timing and shape per kind: life (s), pop scale, colour, tick length/width/gap (in 720p px, scaled by the view). */
export const HIT_STYLE = {
  [HitKind.Hit]: { life: 0.24, pop: 1.35, color: '#ffffff', len: 8, width: 3, gap: 7 },
  [HitKind.Crit]: { life: 0.32, pop: 1.55, color: '#f2c14e', len: 10, width: 3.6, gap: 8 },
  [HitKind.Kill]: { life: 0.6, pop: 1.8, color: '#e8344a', len: 13, width: 4.4, gap: 8 },
} as const;

/** What the view draws this frame. */
export interface HitMarkerFrame {
  visible: boolean;
  kind: HitKindId;
  opacity: number;
  scale: number;
  /** Degrees (kills spin in). */
  rot: number;
  /** Stack boost 0..1 (rapid hits): lengthens and brightens the ticks. */
  boost: number;
  /** Kill ring: 0..1 progress, or −1 when hidden. */
  ring: number;
}

export class HitMarkerModel {
  kind: HitKindId = HitKind.None;
  t0 = -10;
  /** Hits in the current burst (decays when the marker has faded). */
  stack = 0;
  private lastHitAt = -10;
  private killAt = -10;

  /** Feed every GameEvent with the local entity id and the current time (s). */
  onEvent(ev: GameEvent, localId: number, now: number): void {
    if (localId < 0) return;
    if (ev.e === 'hit' && ev.src === localId && ev.dst !== localId) {
      // a crit or a kill still showing is never downgraded by a plain hit landing on the same frame
      const k: HitKindId = ev.crit ? HitKind.Crit : HitKind.Hit;
      this.stack = now - this.lastHitAt < 0.35 ? Math.min(8, this.stack + 1) : 1;
      this.lastHitAt = now;
      if (this.kind === HitKind.Kill && now - this.t0 < HIT_STYLE[HitKind.Kill].life * 0.5) return;
      if (this.kind === HitKind.Crit && k === HitKind.Hit && now - this.t0 < 0.08) return;
      this.kind = k; this.t0 = now;
    } else if (ev.e === 'death' && ev.by === localId && ev.id !== localId) {
      this.kind = HitKind.Kill; this.t0 = now; this.killAt = now;
    }
  }

  sample(now: number, out: HitMarkerFrame): HitMarkerFrame {
    out.kind = this.kind;
    out.ring = -1;
    if (this.kind === HitKind.None) { out.visible = false; out.opacity = 0; return out; }
    const st = HIT_STYLE[this.kind];
    const t = now - this.t0;
    if (t >= st.life || t < 0) { out.visible = false; out.opacity = 0; if (t >= st.life) this.stack = 0; return out; }
    out.visible = true;
    const pop = Math.min(1, t / 0.07);
    // back-out settle from `pop` to 1
    const e = 1 - (1 - pop) * (1 - pop);
    out.scale = st.pop + (1 - st.pop) * e;
    const hold = st.life * 0.45;
    out.opacity = t < hold ? 1 : Math.max(0, 1 - (t - hold) / (st.life - hold));
    // kills spin in over 160 ms (longer than the pop, so the X visibly turns into place)
    const spin = 1 - Math.min(1, t / 0.16);
    out.rot = this.kind === HitKind.Kill ? spin * spin * 30 : 0;
    out.boost = Math.min(1, Math.max(0, (this.stack - 1) / 5));
    const rt = now - this.killAt;
    if (this.kind === HitKind.Kill && rt >= 0 && rt < 0.35) out.ring = rt / 0.35;
    return out;
  }
}

export interface HitFeedback {
  readonly el: HTMLElement;
  readonly model: HitMarkerModel;
  onGameEvent(ev: GameEvent, localId: number): void;
  /** Call once per frame (after the HUD update). */
  update(): void;
  dispose(): void;
}

const CSS = `
.cvc-hf{position:fixed;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:6;--hf-u:calc(100vh/720)}
.cvc-hf .hf-x{position:absolute;left:0;top:0;width:0;height:0;opacity:0;will-change:transform,opacity}
.cvc-hf .hf-x i{position:absolute;left:0;top:0;display:block;border-radius:calc(var(--hf-u)*1.5);
  background:var(--hf-c,#fff);box-shadow:0 0 0 calc(var(--hf-u)*1.6) #1a120c;
  width:calc(var(--hf-u)*var(--hf-w,3));height:calc(var(--hf-u)*var(--hf-l,8));
  margin-left:calc(var(--hf-u)*var(--hf-w,3)*-0.5);margin-top:calc(var(--hf-u)*var(--hf-l,8)*-0.5)}
.cvc-hf .hf-ring{position:absolute;left:0;top:0;width:calc(var(--hf-u)*44);height:calc(var(--hf-u)*44);
  margin:calc(var(--hf-u)*-22) 0 0 calc(var(--hf-u)*-22);border-radius:50%;opacity:0;
  border:calc(var(--hf-u)*3) solid #e8344a;box-shadow:0 0 0 calc(var(--hf-u)*1.5) #1a120c, inset 0 0 0 calc(var(--hf-u)*1.5) #1a120c}
`;

/**
 * DOM hitmarker over the crosshair. `clock` (s) defaults to performance.now()/1000 (labs pass a frozen clock).
 * Appends one fixed-position element to `root`; nothing else on the page is touched.
 */
export function createHitFeedback(root: HTMLElement, opts: { clock?: () => number } = {}): HitFeedback {
  const clock = opts.clock ?? (() => performance.now() / 1000);
  const doc = root.ownerDocument;
  let style = doc.getElementById('cvc-hf-style') as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = 'cvc-hf-style';
    style.textContent = CSS;
    doc.head.appendChild(style);
  }
  const el = doc.createElement('div');
  el.className = 'cvc-hf';
  const x = doc.createElement('div');
  x.className = 'hf-x';
  const ticks: HTMLElement[] = [];
  for (let i = 0; i < 4; i++) { const t = doc.createElement('i'); ticks.push(t); x.appendChild(t); }
  const ring = doc.createElement('div');
  ring.className = 'hf-ring';
  el.append(x, ring);
  root.appendChild(el);

  const model = new HitMarkerModel();
  const frame: HitMarkerFrame = { visible: false, kind: HitKind.None, opacity: 0, scale: 1, rot: 0, boost: 0, ring: -1 };
  // last written values (write only on change)
  let lastOp = '', lastTf = '', lastKind = -1, lastRing = '', lastRingOp = '', lastBoost = -1;
  const set = (e: HTMLElement, k: string, v: string) => { e.style.setProperty(k, v); };

  const layoutTicks = (kind: HitKindId, boost: number) => {
    const st = HIT_STYLE[kind as 1 | 2 | 3];
    if (!st) return;
    const len = st.len * (1 + boost * 0.4), gap = st.gap + boost * 2;
    set(x, '--hf-c', st.color);
    set(x, '--hf-w', String(st.width));
    set(x, '--hf-l', len.toFixed(2));
    for (let i = 0; i < 4; i++) {
      const a = 45 + i * 90;
      ticks[i].style.transform = `rotate(${a}deg) translateY(calc(var(--hf-u) * ${(-(gap + len / 2)).toFixed(2)}))`;
    }
  };

  return {
    el,
    model,
    onGameEvent(ev, localId) { model.onEvent(ev, localId, clock()); },
    update() {
      model.sample(clock(), frame);
      const op = frame.visible ? frame.opacity.toFixed(2) : '0';
      if (op !== lastOp) { x.style.opacity = op; lastOp = op; }
      if (!frame.visible) { if (lastRingOp !== '0') { ring.style.opacity = '0'; lastRingOp = '0'; } return; }
      const b = Math.round(frame.boost * 10) / 10;
      if (frame.kind !== lastKind || b !== lastBoost) { layoutTicks(frame.kind, b); lastKind = frame.kind; lastBoost = b; }
      const tf = `scale(${frame.scale.toFixed(3)}) rotate(${frame.rot.toFixed(1)}deg)`;
      if (tf !== lastTf) { x.style.transform = tf; lastTf = tf; }
      const ro = frame.ring >= 0 ? (1 - frame.ring).toFixed(2) : '0';
      if (ro !== lastRingOp) { ring.style.opacity = ro; lastRingOp = ro; }
      if (frame.ring >= 0) {
        const rs = `scale(${(0.35 + frame.ring * 0.9).toFixed(3)})`;
        if (rs !== lastRing) { ring.style.transform = rs; lastRing = rs; }
      }
    },
    dispose() { el.remove(); },
  };
}
