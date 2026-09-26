// Player intent sent from client to authority every simulation tick.
// Bots produce the same structure, so every actor goes through one authority path.

export const Btn = {
  Jump: 1 << 0,
  Sprint: 1 << 1,
  Fire: 1 << 2,
  Aim: 1 << 3,
  Interact: 1 << 4,
  Crouch: 1 << 5,
  Ability: 1 << 6,
  Reload: 1 << 7,
  Melee: 1 << 8,
  NextWeapon: 1 << 9,
  /** Taunt (cosmetic): a voiced line + emote animation (src/sim/systems/emote.ts). */
  Emote: 1 << 10,
} as const;
/** Every defined button bit (sanitizeInput masks to these). */
export const BTN_MASK = 0x7ff;

export interface InputCmd {
  /** Monotonic per-client sequence number; the authority acks the last one it applied. */
  seq: number;
  /** Move intent in the camera frame: mx = right (+) / left (-), mz = forward (+) / back (-). Range -1..1. */
  mx: number;
  mz: number;
  /** Absolute view yaw (radians, 0 = facing -Z) and pitch (radians, + = up). */
  yaw: number;
  pitch: number;
  buttons: number;
  /**
   * Server tick the client was rendering remote entities at when this input was produced
   * (interpolation time). Used by the authority for lag-compensated hit detection. 0 = unknown.
   */
  rt: number;
}

export function emptyInput(seq = 0): InputCmd {
  return { seq, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 };
}

export function has(cmd: InputCmd, b: number): boolean {
  return (cmd.buttons & b) !== 0;
}

/** Validate and clamp an untrusted input (server-side). Returns null if unusable. */
export function sanitizeInput(raw: unknown): InputCmd | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const seq = num(r.seq), mx = num(r.mx), mz = num(r.mz), yaw = num(r.yaw), pitch = num(r.pitch), buttons = num(r.buttons);
  if ([seq, mx, mz, yaw, pitch, buttons].some(Number.isNaN)) return null;
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  let x = clamp(mx, -1, 1), z = clamp(mz, -1, 1);
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  return {
    seq: Math.floor(seq),
    mx: x,
    mz: z,
    yaw: ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
    pitch: clamp(pitch, -1.45, 1.45),
    buttons: Math.floor(buttons) & BTN_MASK,
    rt: typeof r.rt === 'number' && Number.isFinite(r.rt) ? Math.max(0, Math.floor(r.rt)) : 0,
  };
}
