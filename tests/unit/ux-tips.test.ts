// U1: first-match tips — timing, once-only, persistence across sessions, first-match cut-off, reset, and
// storage that throws.
import { describe, expect, it } from 'vitest';
import { TIP_RULES, TIPS_KEY, TipScheduler, tipParts, type TipFrame, type TipId } from '../../src/client/ui/tips';
import type { KV } from '../../src/client/ui/settings';

class MemKV implements KV {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

const PLAY: TipFrame = { active: true, phase: 'live', nearKiosk: false, moving: false, firing: false, aiming: false };

/** Run `secs` at 60 Hz; returns every tip id that was on screen, in order (deduplicated runs). */
function run(t: TipScheduler, secs: number, f: Partial<TipFrame> = {}): Array<TipId | null> {
  const seen: Array<TipId | null> = [];
  for (let i = 0; i < Math.round(secs * 60); i++) {
    const id = t.update(1 / 60, { ...PLAY, ...f });
    if (seen.at(-1) !== id) seen.push(id);
  }
  return seen;
}

describe('first-match tips', () => {
  it('shows basics 1.5 s into play, only while actually playing, for its duration', () => {
    const t = new TipScheduler(new MemKV());
    expect(run(t, 10, { active: false })).toEqual([null]); // menu / dead / chatting: clock paused
    expect(run(t, TIP_RULES.basicsDelay - 0.1)).toEqual([null]);
    expect(run(t, 0.2)).toEqual([null, 'basics']);
    expect(run(t, TIP_RULES.duration.basics - 0.5)).toEqual(['basics']);
    expect(run(t, 1)).toEqual(['basics', null]);
    expect(t.isSeen('basics')).toBe(true);
  });

  it('ends a tip early once you have done the thing (never before 3 s)', () => {
    const t = new TipScheduler(new MemKV());
    run(t, TIP_RULES.basicsDelay + 0.1, { moving: true, firing: true, aiming: true });
    expect(run(t, TIP_RULES.minBeforeDone - 0.2)).toEqual(['basics']);
    expect(run(t, 0.4)).toEqual(['basics', null]);
  });

  it('shows each tip once, ever: seen tips persist in storage across sessions', () => {
    const kv = new MemKV();
    const a = new TipScheduler(kv);
    run(a, 15);
    expect(a.isSeen('basics')).toBe(true);
    expect(JSON.parse(kv.map.get(TIPS_KEY)!)).toMatchObject({ v: 1, seen: ['basics'], done: false });
    const b = new TipScheduler(kv); // next session
    expect(run(b, 20)).toEqual([null]);
  });

  it('a tip interrupted before 2 s is not "seen" and comes back', () => {
    const kv = new MemKV();
    const t = new TipScheduler(kv);
    run(t, TIP_RULES.basicsDelay + 1); // on screen ~1 s
    expect(run(t, 5, { active: false })).toEqual([null]); // died: hidden, paused
    expect(t.isSeen('basics')).toBe(false);
    expect(run(t, 1.5)).toEqual(['basics']); // resumes
    expect(t.isSeen('basics')).toBe(true);
  });

  it('kiosk tip appears at your Ordnance Kiosk and ends when you walk away', () => {
    const t = new TipScheduler(new MemKV());
    run(t, 15); // basics done + gap
    expect(run(t, 1, { nearKiosk: true })).toEqual(['kiosk']);
    expect(run(t, 1.4)).toEqual(['kiosk']); // still up just after leaving
    expect(run(t, 0.3)).toEqual(['kiosk', null]);
    expect(t.isSeen('kiosk')).toBe(true); // it was on screen > 2 s
    expect(run(t, 10, { nearKiosk: true })).toEqual([null]); // never again
  });

  it('movement tip after 60 s of play; skipped silently when you already slide and ground-pound', () => {
    const t = new TipScheduler(new MemKV());
    const ids = run(t, TIP_RULES.movesAfter + 1);
    expect(ids).toEqual([null, 'basics', null, 'moves']);
    const pro = new TipScheduler(new MemKV());
    pro.onAction('slide');
    pro.onAction('ground_pound');
    expect(run(pro, TIP_RULES.movesAfter + 10)).toEqual([null, 'basics', null]);
    expect(pro.isSeen('moves')).toBe(true);
  });

  it('only runs in the first match: when that match ends, unseen tips never show again', () => {
    const kv = new MemKV();
    const t = new TipScheduler(kv);
    run(t, 30);
    t.update(1 / 60, { ...PLAY, phase: 'ended' });
    expect(t.finished).toBe(true);
    expect(run(t, 120, { phase: 'live', nearKiosk: true })).toEqual([null]);
    expect(new TipScheduler(kv).finished).toBe(true);
    // Joining a match that ends before you really played does not count as your first match.
    const u = new TipScheduler(new MemKV());
    run(u, 3, { phase: 'live' });
    u.update(1 / 60, { ...PLAY, phase: 'ended' });
    expect(u.finished).toBe(false);
  });

  it('Settings › Show again resets everything', () => {
    const kv = new MemKV();
    const t = new TipScheduler(kv);
    run(t, 70);
    t.update(1 / 60, { ...PLAY, phase: 'ended' });
    t.reset();
    expect(t.finished).toBe(false);
    expect(JSON.parse(kv.map.get(TIPS_KEY)!)).toEqual({ v: 1, seen: [], done: false });
    expect(run(t, 2, { phase: 'live' })).toEqual([null, 'basics']);
  });

  it('survives storage that throws or holds garbage', () => {
    const bad: KV = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const t = new TipScheduler(bad);
    expect(run(t, 3)).toEqual([null, 'basics']);
    const junk = new MemKV();
    junk.setItem(TIPS_KEY, '{not json');
    expect(run(new TipScheduler(junk), 3)).toEqual([null, 'basics']);
    junk.setItem(TIPS_KEY, JSON.stringify({ seen: ['basics', 'bogus'], done: 'yes' }));
    const j = new TipScheduler(junk);
    expect(j.isSeen('basics')).toBe(true);
    expect(j.finished).toBe(false);
    expect(new TipScheduler(null).update(5, PLAY)).toBe(null);
  });

  it('parses [KEY] keycaps', () => {
    expect(tipParts('Press [E] at the kiosk')).toEqual([{ text: 'Press ' }, { key: 'E' }, { text: ' at the kiosk' }]);
    expect(tipParts('[WASD] move')).toEqual([{ key: 'WASD' }, { text: ' move' }]);
  });
});
