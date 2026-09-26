// Keyboard + mouse (pointer lock) + gamepad -> InputCmd. Owns view yaw/pitch.
import { Btn, type InputCmd } from '../../shared/input';
import { clamp } from '../../shared/math';

const KEYMAP: Record<string, number> = {
  Space: Btn.Jump, ShiftLeft: Btn.Sprint, ShiftRight: Btn.Sprint, KeyE: Btn.Interact, KeyC: Btn.Crouch,
  ControlLeft: Btn.Crouch, KeyQ: Btn.Ability, KeyR: Btn.Reload, KeyV: Btn.Melee, KeyF: Btn.Melee, Tab: 0,
};

export class InputState {
  yaw = 0;
  pitch = -0.12;
  sensitivity = 0.0022;
  invertY = false;
  locked = false;
  private keys = new Set<string>();
  private mouse = 0; // bit0 LMB, bit1 RMB
  private wheelNext = false;
  private el: HTMLElement | null = null;
  /** Latched presses so a tap shorter than one tick still registers. */
  private latched = 0;

  bind(el: HTMLElement): void {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      this.keys.add(e.code);
      const b = KEYMAP[e.code];
      if (b) this.latched |= b;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse = 0; });
    el.addEventListener('mousedown', (e) => {
      if (!this.locked) { el.requestPointerLock?.(); return; }
      if (e.button === 0) { this.mouse |= 1; this.latched |= Btn.Fire; }
      if (e.button === 2) this.mouse |= 2;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse &= ~1;
      if (e.button === 2) this.mouse &= ~2;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', () => { this.wheelNext = true; }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.2, 1.1);
    });
  }

  isDown(code: string): boolean { return this.keys.has(code); }

  /** Build the command for one simulation tick. */
  sample(seq: number, dt: number): InputCmd {
    let mx = 0, mz = 0, buttons = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    for (const [code, b] of Object.entries(KEYMAP)) if (b && this.keys.has(code)) buttons |= b;
    if (this.mouse & 1) buttons |= Btn.Fire;
    if (this.mouse & 2) buttons |= Btn.Aim;
    if (this.wheelNext) { buttons |= Btn.NextWeapon; this.wheelNext = false; }
    buttons |= this.latched;
    this.latched = 0;

    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      mx += dz(pad.axes[0] ?? 0);
      mz -= dz(pad.axes[1] ?? 0);
      this.yaw -= dz(pad.axes[2] ?? 0) * 3.2 * dt;
      this.pitch = clamp(this.pitch - dz(pad.axes[3] ?? 0) * 2.2 * dt * (this.invertY ? -1 : 1), -1.2, 1.1);
      const bt = (i: number) => !!pad.buttons[i]?.pressed;
      if (bt(0)) buttons |= Btn.Jump;
      if (bt(10) || bt(4)) buttons |= Btn.Sprint;
      if (bt(7)) buttons |= Btn.Fire;
      if (bt(6)) buttons |= Btn.Aim;
      if (bt(2)) buttons |= Btn.Reload;
      if (bt(1)) buttons |= Btn.Crouch;
      if (bt(3)) buttons |= Btn.Interact;
      if (bt(5)) buttons |= Btn.Ability;
      if (bt(11)) buttons |= Btn.Melee;
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    return { seq, mx, mz, yaw: this.yaw, pitch: this.pitch, buttons, rt: 0 };
  }
}
