// W13 TW-VIEW: Enter rematches a slab match like R (the slab authority restarts on a human's reload bit while ended).
// While main.ts sets InputState.enterReloads (winner screen up, no menu, no chat) Enter latches Btn.Reload and stops
// there, so the chat's window listener (bound later) never opens on it; otherwise Enter is left alone.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { InputState } from '../../src/client/input/input';
import { Btn } from '../../src/shared/input';
import { slabOverridesFromSearch } from '../../src/client/net/transport';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import type { GameEvent } from '../../src/shared/protocol';

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

/** worker-host.ts is the offline Web Worker's module: it binds self.onmessage on import, so it gets a stub self for
 *  the import only (a global `self` left behind sends Rapier's wasm down a path that traps in world.step). */
async function workerHost() {
  const had = 'self' in g, was = g.self;
  g.self = { postMessage: () => {}, onmessage: null };
  try { return await import('../../src/host/worker-host'); } finally { if (had) g.self = was; else delete g.self; }
}

describe('W15 &slabHurt: scheduled hits and a knockout on the human, offline only', () => {
  it('the page reads &slabHurt into the offline overrides (no value needed)', () => {
    expect(slabOverridesFromSearch('?mode=slab&webgl&slabHurt')).toEqual({ hurt: true });
    expect(slabOverridesFromSearch('?mode=slab&slabHurt&slabWin=999')).toEqual({ winScore: 999, hurt: true });
    expect(slabOverridesFromSearch('?mode=slab&slabhurt')).toBeUndefined(); // the exact name only
  });

  it('the gate: only the offline worker, only a slab match, only when asked (true, not a look-alike), never a production build', async () => {
    const { slabHurtOn } = await workerHost();
    expect(slabHurtOn({ mode: 'slab', slab: { hurt: true } }, false)).toBe(true);
    expect(slabHurtOn({ mode: 'slab', slab: { hurt: true } })).toBe(true); // the test build is not a production build
    expect(slabHurtOn({ mode: 'slab', slab: { hurt: true } }, true)).toBe(false); // vite build: never
    expect(slabHurtOn({ mode: 'team-deathmatch', slab: { hurt: true } }, false)).toBe(false);
    expect(slabHurtOn({ mode: 'slab', slab: { winScore: 3 } }, false)).toBe(false);
    expect(slabHurtOn({ mode: 'slab', slab: { hurt: 'yes' } as never }, false)).toBe(false);
    expect(slabHurtOn({ mode: 'slab' }, false)).toBe(false);
    expect(slabHurtOn(null, false)).toBe(false);
    // online it does not exist: only the worker module and the page's parser name it; the Node server, the room, the
    // guard and the online transport never do (main.ts hands the overrides to createWorkerTransport only)
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|mjs|js)$/.test(f) ? [p] : [];
    });
    const naming = [...files('server'), ...files('src/host'), ...files('src/sim'), ...files('src/shared')]
      .filter((p) => /slabHurt|SLAB_HURT|slab\??\.hurt/.test(readFileSync(p, 'utf8')));
    expect(naming.map((p) => p.replace(/\\/g, '/'))).toEqual(['src/host/worker-host.ts']);
    const main = readFileSync('src/client/main.ts', 'utf8');
    expect(main).toMatch(/createWorkerTransport\(\{[^;]*slab: mode === 'slab' \? slabOverridesFromSearch\(location\.search\)/);
    expect(main).not.toMatch(/createWebSocketTransport\([^)]*slab/);
  });

  it('in an offline slab room the nearest enemy hits the human for 25 at 8 s and 12 s and takes it down at 16 s; again from 24 s', async () => {
    const { SLAB_HURT, slabHurtStep } = await workerHost();
    const sim = await Sim.create({ seed: 7, map: 'the_lot' });
    const room = new Room(sim, { mode: 'slab', botsPerTeam: [1, 1], defaultTeam: 0 });
    room.join({ id: 'local', send: () => {} }, { t: 'hello', v: PROTOCOL_VERSION, name: 'You', team: 0, cls: 'assault' });
    const human = [...room.players.values()].find((p) => !p.bot)!;
    const evs: Array<GameEvent & { t: number }> = [];
    const emit = sim.emit.bind(sim);
    sim.emit = (ev: GameEvent) => { evs.push({ ...ev, t: sim.time }); emit(ev); };
    const run = { k: 0 }, landed: Array<{ src: number; dst: number; dmg: number; t: number }> = [];
    while (sim.time < SLAB_HURT.start + SLAB_HURT.period + 9) {
      room.tick();
      for (const l of slabHurtStep(room, run)) landed.push({ ...l, t: sim.time });
    }
    room.dispose();
    const foe = landed[0].src;
    expect(sim.entities.get(foe)!.team).toBe(1); // an enemy, really in the match
    const cycle = (c: number) => landed.filter((l) => l.t >= SLAB_HURT.start + c * SLAB_HURT.period - 0.01 && l.t < SLAB_HURT.start + (c + 1) * SLAB_HURT.period - 0.01);
    for (const c of [0, 1]) {
      const at = SLAB_HURT.start + c * SLAB_HURT.period;
      const l = cycle(c);
      expect(l.map((x) => x.dst)).toEqual([human.entity, human.entity, human.entity]);
      expect(l[0].t).toBeCloseTo(at, 1);
      expect(l[1].t).toBeCloseTo(at + 4, 1);
      expect(l[2].t).toBeCloseTo(at + 8, 1);
      expect(l.slice(0, 2).map((x) => x.dmg)).toEqual([25, 25]);
      // the same 'hit' and 'death' events a shot makes, from the enemy that hit
      const inCycle = (e: { t: number }) => e.t > at - 0.05 && e.t < at + 9;
      const ko = evs.find((e) => e.e === 'death' && e.id === human.entity && inCycle(e));
      expect(ko).toMatchObject({ e: 'death', id: human.entity, by: l[2].src });
      expect(evs.filter((e) => e.e === 'hit' && e.dst === human.entity && e.src === l[0].src && inCycle(e)).length).toBeGreaterThanOrEqual(3);
    }
    expect(run.k).toBe(6);
  });
});

