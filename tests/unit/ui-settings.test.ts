// L5: settings persistence (versioned JSON) + migration + sanitizing.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, SETTINGS_VERSION, cleanName, loadSettings, migrateSettings, saveSettings, type KV } from '../../src/client/ui/settings';

class MemKV implements KV {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

describe('settings', () => {
  it('returns defaults when nothing is stored or storage is unavailable', () => {
    expect(loadSettings(new MemKV())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips through storage as versioned JSON', () => {
    const kv = new MemKV();
    const s = { ...DEFAULT_SETTINGS, sensitivity: 1.6, invertY: true, musicVolume: 0.2, quality: 'low' as const, name: 'Biscuit', team: 1 as const, cls: 'breacher' as const };
    expect(saveSettings(s, kv)).toBe(true);
    const raw = JSON.parse(kv.map.get(SETTINGS_KEY)!);
    expect(raw.v).toBe(SETTINGS_VERSION);
    expect(loadSettings(kv)).toEqual(s);
  });

  it('migrates unversioned v0 settings (sens in rad/px, volume 0–100, gfx lo/med/hi)', () => {
    const m = migrateSettings({ sens: 0.0044, volume: 50, invert: true, gfx: 'lo', name: 'Old Pup' });
    expect(m.v).toBe(SETTINGS_VERSION);
    expect(m.sensitivity).toBeCloseTo(2);
    expect(m.masterVolume).toBeCloseTo(0.5);
    expect(m.invertY).toBe(true);
    expect(m.quality).toBe('low');
    expect(m.name).toBe('Old Pup');
  });

  it('keeps known fields from a newer version and drops unknown ones', () => {
    const m = migrateSettings({ v: 99, sensitivity: 0.5, futureThing: 42, quality: 'medium' });
    expect(m.sensitivity).toBe(0.5);
    expect(m.quality).toBe('medium');
    expect((m as unknown as Record<string, unknown>).futureThing).toBeUndefined();
  });

  it('clamps and repairs garbage values', () => {
    const m = migrateSettings({ v: 1, sensitivity: 99, masterVolume: -3, sfxVolume: 'loud', quality: 'ultra', team: 7, cls: 'wizard', server: 'http://nope', name: '   ' });
    expect(m.sensitivity).toBe(3);
    expect(m.masterVolume).toBe(0);
    expect(m.sfxVolume).toBe(DEFAULT_SETTINGS.sfxVolume);
    expect(m.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(m.team).toBe(-1);
    expect(m.cls).toBe('assault');
    expect(m.server).toBe(DEFAULT_SETTINGS.server);
    expect(m.name).toBe(DEFAULT_SETTINGS.name);
  });

  it('survives corrupt JSON and throwing storage', () => {
    const kv = new MemKV();
    kv.map.set(SETTINGS_KEY, '{not json');
    expect(loadSettings(kv)).toEqual(DEFAULT_SETTINGS);
    const throwing: KV = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS, throwing)).toBe(false);
  });

  it('cleans player names (no markup/control chars, ≤ 16 chars)', () => {
    expect(cleanName('<b>Rex</b>\u0007')).toBe('bRex/b');
    expect(cleanName('A very long corgi name indeed')).toHaveLength(16);
  });
});
