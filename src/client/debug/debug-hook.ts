// Exposes readiness and performance to automated tests (Playwright) and humans (console).
export interface DebugState {
  ready: boolean;
  frames: number;
  fps: number;
  frameMs: number;
  backend: string;
  transport: string;
  localEntity: number;
  local: { x: number; y: number; z: number; hp: number; flags?: number } | null;
  entities: number;
  /** N2: the look the local avatar wears, `coat|neck` ('' = classic / none yet). */
  localLook: string;
  errors: string[];
  bookmarks: Record<string, { x: number; y: number; z: number; yaw: number; pitch: number }>;
}

export const debug: DebugState = {
  ready: false, frames: 0, fps: 0, frameMs: 0, backend: '', transport: '', localEntity: -1, local: null,
  entities: 0, localLook: '', errors: [], bookmarks: {},
};

(globalThis as unknown as { __cvc: DebugState }).__cvc = debug;
window.addEventListener('error', (e) => debug.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => debug.errors.push(String((e as PromiseRejectionEvent).reason)));
