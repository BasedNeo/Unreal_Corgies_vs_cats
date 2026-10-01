// W13 TW-VIEW: Enter rematches a slab match like R (the slab authority restarts on a human's reload bit while ended).
// While main.ts sets InputState.enterReloads (winner screen up, no menu, no chat) Enter latches Btn.Reload and stops
// there, so the chat's window listener (bound later) never opens on it; otherwise Enter is left alone.
import { describe, it, expect, afterEach } from 'vitest';
import { InputState } from '../../src/client/input/input';
import { Btn } from '../../src/shared/input';
import { slabOverridesFromSearch } from '../../src/client/net/transport';

type Fn = (e: unknown) => void;
const g = globalThis as unknown as Record<string, unknown>;
const saved = { window: g.window, document: g.document };
afterEach(() => { g.window = saved.window; g.document = saved.document; });

/** Bind an InputState to stub window/document/canvas; returns the keydown dispatcher (input first, then "the chat"). */
function rig(): { input: InputState; key(code: string): { chat: boolean; prevented: boolean } } {
  const handlers: Record<string, Fn[]> = {};
  g.window = { addEventListener: (t: string, f: Fn) => (handlers[t] ??= []).push(f) };
  g.document = { addEventListener: () => {}, pointerLockElement: null };
  const input = new InputState();
  input.bind({ addEventListener: () => {} } as unknown as HTMLElement);
  let chat = false;
  handlers.keydown.push((e) => { if ((e as { code: string }).code === 'Enter') chat = true; }); // the chat's listener
  return {
    input,
    key(code) {
      chat = false;
      let stopped = false, prevented = false;
      const ev = { code, target: null, repeat: false, preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } };
      for (const f of handlers.keydown) { if (stopped) break; f(ev); }
      for (const f of handlers.keyup ?? []) f(ev);
      return { chat, prevented };
    },
  };
}

describe('slab rematch input', () => {
  it('Enter is a reload press only while enterReloads is set; R always is', () => {
    const { input, key } = rig();
    expect(key('Enter')).toEqual({ chat: true, prevented: false }); // a running match: Enter opens chat as before
    expect(input.sample(1, 1 / 60).buttons & Btn.Reload).toBe(0);
    input.enterReloads = true;
    expect(key('Enter')).toEqual({ chat: false, prevented: true });
    expect(input.sample(2, 1 / 60).buttons & Btn.Reload).toBe(Btn.Reload); // latched: a tap shorter than a tick counts
    expect(input.sample(3, 1 / 60).buttons & Btn.Reload).toBe(0); // once
    expect(key('NumpadEnter').chat).toBe(false);
    expect(input.sample(4, 1 / 60).buttons & Btn.Reload).toBe(Btn.Reload);
    key('KeyR');
    expect(input.sample(5, 1 / 60).buttons & Btn.Reload).toBe(Btn.Reload);
    input.enterReloads = false;
    expect(key('Enter').chat).toBe(true);
    expect(input.sample(6, 1 / 60).buttons & Btn.Reload).toBe(0);
  });

  it('a suspended input (chat open) ignores Enter even while enterReloads is set', () => {
    const { input, key } = rig();
    input.enterReloads = true;
    input.suspended = true;
    key('Enter');
    expect(input.sample(1, 1 / 60).buttons & Btn.Reload).toBe(0);
  });
});

describe('slab test overrides (offline only: WorkerBootConfig.slab)', () => {
  it('reads &slabWin, &slabTime and &slabOvertime, clamped; ignores the rest', () => {
    expect(slabOverridesFromSearch('?mode=slab')).toBeUndefined();
    expect(slabOverridesFromSearch('?mode=slab&slabWin=3&slabTime=20')).toEqual({ winScore: 3, timeLimit: 20 });
    expect(slabOverridesFromSearch('?slabTime=8&slabOvertime=4')).toEqual({ timeLimit: 8, overtimeMax: 4 });
    expect(slabOverridesFromSearch('?slabWin=2.6&slabTime=0&slabOvertime=-3')).toEqual({ winScore: 3, timeLimit: 1, overtimeMax: 0 });
    expect(slabOverridesFromSearch('?slabWin=&slabTime=abc&slabOvertime=1e9')).toEqual({ overtimeMax: 600 });
  });
});
