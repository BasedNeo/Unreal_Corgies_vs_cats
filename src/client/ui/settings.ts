// OWNER: L5 (juice). Player settings persisted in localStorage as versioned JSON with migration
// (MASTER_PLAN §7.19). Pure functions over a Storage-like object so tests run in Node.
import { CLASS_IDS, type ClassId } from '../../shared/types';

export const SETTINGS_VERSION = 1;
export const SETTINGS_KEY = 'cvc.settings';

export type QualitySetting = 'low' | 'medium' | 'high';

export interface Settings {
  v: typeof SETTINGS_VERSION;
  /** Look sensitivity multiplier (1 = the input default 0.0022 rad/px). Range 0.2..3. */
  sensitivity: number;
  invertY: boolean;
  /** Camera shake strength 0..1 (0 = none: reduce motion). */
  shake: number;
  /** On-foot field of view (degrees, 55..80); aiming and vehicles zoom relative to it. */
  fov: number;
  /** 0..1 linear slider positions (the audio engine applies a perceptual curve). */
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  quality: QualitySetting;
  /** Last-used menu choices. */
  name: string;
  team: -1 | 0 | 1;
  cls: ClassId;
  server: string;
}

export type SettingKey = Exclude<keyof Settings, 'v'>;

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  v: SETTINGS_VERSION,
  sensitivity: 1,
  invertY: false,
  shake: 1,
  fov: 62,
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.9,
  quality: 'high',
  name: 'Rex',
  team: -1,
  cls: 'assault',
  server: 'ws://localhost:8787',
});

/** Minimal Storage surface (window.localStorage or a test double). */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

const clamp = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
const QUALITIES: readonly QualitySetting[] = ['low', 'medium', 'high'];

/** Cleans a player name: printable, trimmed, ≤ 16 chars, never empty. */
export function cleanName(x: unknown, d = DEFAULT_SETTINGS.name): string {
  if (typeof x !== 'string') return d;
  const s = x.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return s || d;
}

/** Coerces any object into valid current-version Settings (unknown keys dropped, bad values defaulted). */
export function sanitizeSettings(o: Record<string, unknown>): Settings {
  const d = DEFAULT_SETTINGS;
  const q = o.quality === 'med' ? 'medium' : o.quality;
  return {
    v: SETTINGS_VERSION,
    sensitivity: clamp(o.sensitivity, 0.2, 3, d.sensitivity),
    invertY: typeof o.invertY === 'boolean' ? o.invertY : d.invertY,
    shake: clamp(o.shake, 0, 1, d.shake),
    fov: clamp(o.fov, 55, 80, d.fov),
    masterVolume: clamp(o.masterVolume, 0, 1, d.masterVolume),
    musicVolume: clamp(o.musicVolume, 0, 1, d.musicVolume),
    sfxVolume: clamp(o.sfxVolume, 0, 1, d.sfxVolume),
    quality: QUALITIES.includes(q as QualitySetting) ? (q as QualitySetting) : d.quality,
    name: cleanName(o.name),
    team: o.team === 0 || o.team === 1 ? o.team : -1,
    cls: (CLASS_IDS as readonly string[]).includes(o.cls as string) ? (o.cls as ClassId) : d.cls,
    server: typeof o.server === 'string' && /^wss?:\/\/\S+$/.test(o.server) ? o.server.slice(0, 200) : d.server,
  };
}

/**
 * Migrates whatever was stored to the current version.
 *  - v0 (unversioned, walking-skeleton era): { sens: px→rad factor, volume: 0..100, invert: bool, gfx: 'lo'|'med'|'hi' }
 *  - v1: current shape (sanitized)
 *  - newer than we know: keep the fields we understand (forward-compatible downgrade)
 */
export function migrateSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SETTINGS };
  const o = raw as Record<string, unknown>;
  const v = typeof o.v === 'number' ? o.v : 0;
  if (v === 0) {
    const gfx = o.gfx === 'lo' ? 'low' : o.gfx === 'hi' ? 'high' : o.gfx === 'med' ? 'medium' : o.quality;
    const vol = typeof o.volume === 'number' ? o.volume / 100 : o.masterVolume;
    const sens = typeof o.sens === 'number' ? o.sens / 0.0022 : o.sensitivity;
    return sanitizeSettings({ ...o, sensitivity: sens, masterVolume: vol, invertY: o.invert ?? o.invertY, quality: gfx });
  }
  return sanitizeSettings(o);
}

export function loadSettings(storage: KV | null = safeStorage()): Settings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  let raw: string | null = null;
  try { raw = storage.getItem(SETTINGS_KEY); } catch { return { ...DEFAULT_SETTINGS }; }
  if (!raw) return { ...DEFAULT_SETTINGS };
  try { return migrateSettings(JSON.parse(raw)); } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(s: Settings, storage: KV | null = safeStorage()): boolean {
  if (!storage) return false;
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(s as unknown as Record<string, unknown>))); return true; } catch { return false; }
}

/** localStorage can throw (privacy mode, sandboxed iframes) — never let settings break boot. */
export function safeStorage(): KV | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
