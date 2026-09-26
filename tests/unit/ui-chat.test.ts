// U1: chat feed model (cleaning, pending/echo, rate, fade, history) and the chat view on a fake DOM
// (keys never reach the game, user text never goes through innerHTML).
import { describe, expect, it } from 'vitest';
import {
  CHAT_FADE_AFTER, CHAT_FEED_LINES, CHAT_HISTORY, CHAT_MAX_LEN, CHAT_MIN_GAP, CHAT_PENDING_TIMEOUT,
  ChatFeed, cleanChatText, isPresenceNotice, teamOfName,
} from '../../src/client/ui/chat-model';
import { createChat, type ChatDoc } from '../../src/client/ui/chat';
import type { RosterEntry } from '../../src/shared/protocol';

const ME = { name: 'Rex', team: 0 as const };

describe('chat feed model', () => {
  it('cleans text like the authority: control and bidi characters stripped, whitespace collapsed, 120 chars max', () => {
    expect(cleanChatText('  hi\u0000 there\u202e   pup  ')).toBe('hi there pup');
    expect(cleanChatText('a\u2066b\n\tc')).toBe('abc'); // isolates and newlines/tabs are stripped outright, exactly as the server does
    expect(cleanChatText('x'.repeat(300))).toHaveLength(CHAT_MAX_LEN);
    expect(cleanChatText(42)).toBe('');
    // Markup is just text to the model; the view renders it with textContent.
    expect(cleanChatText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });

  it('shows your line as pending until the server echoes it, then sent — never twice', () => {
    const f = new ChatFeed();
    const r = f.send('  woof  ', 10, ME);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe('woof');
    expect(r.line.state).toBe('pending');
    f.receive('Rex', 'woof', 10.2, 0, 'Rex');
    expect(f.lines).toHaveLength(1);
    expect(f.lines[0]).toMatchObject({ state: 'sent', self: true, team: 0, at: 10.2 });
    // Someone else saying the same thing is a separate line.
    f.receive('Tom', 'woof', 10.3, 1, 'Rex');
    expect(f.lines.map((l) => [l.from, l.state])).toEqual([['Rex', 'sent'], ['Tom', 'received']]);
  });

  it('respects the rate limit: a send inside CHAT_MIN_GAP is refused (the draft stays), not sent into the void', () => {
    const f = new ChatFeed();
    expect(f.send('one', 5, ME).ok).toBe(true);
    const r = f.send('two', 5 + CHAT_MIN_GAP / 2, ME);
    expect(r).toMatchObject({ ok: false, reason: 'rate' });
    if (!r.ok && r.reason === 'rate') expect(r.waitSec).toBeCloseTo(CHAT_MIN_GAP / 2);
    expect(f.send('two', 5 + CHAT_MIN_GAP, ME).ok).toBe(true);
    expect(f.send('   ', 20, ME)).toEqual({ ok: false, reason: 'empty' });
    expect(CHAT_MIN_GAP).toBeGreaterThan(0.5); // the authority drops < 0.5 s apart
  });

  it('marks a line failed when no echo comes back (dropped / disconnected); a late echo still confirms it', () => {
    const f = new ChatFeed();
    f.send('hello?', 0, ME);
    expect(f.tick(CHAT_PENDING_TIMEOUT - 0.1)).toBe(false);
    expect(f.tick(CHAT_PENDING_TIMEOUT + 0.1)).toBe(true);
    expect(f.lines[0].state).toBe('failed');
    f.receive('Rex', 'hello?', 5, 0, 'Rex');
    expect(f.lines[0].state).toBe('sent');
    const g = new ChatFeed();
    const r = g.send('offline', 0, ME);
    if (r.ok) g.markFailed(r.line);
    expect(g.lines[0].state).toBe('failed');
  });

  it('fades lines after ~8 s when closed; open chat shows the full, capped history', () => {
    const f = new ChatFeed();
    f.receive('Tom', 'first', 0, 1, 'Rex');
    const vis = (t: number, open = false) => f.visible(t, open).map((v) => [v.line.text, +v.opacity.toFixed(2)]);
    expect(vis(1)).toEqual([['first', 1]]);
    expect(vis(CHAT_FADE_AFTER - 0.5)).toEqual([['first', 0.5]]);
    expect(vis(CHAT_FADE_AFTER)).toEqual([]);
    expect(vis(100, true)).toEqual([['first', 1]]);
    for (let i = 0; i < 80; i++) f.receive('Tom', `m${i}`, 200 + i * 0.01, 1, 'Rex');
    expect(f.lines).toHaveLength(CHAT_HISTORY);
    expect(f.visible(201, true)).toHaveLength(CHAT_HISTORY);
    expect(f.visible(201, false)).toHaveLength(CHAT_FEED_LINES);
    expect(f.visible(201, false).at(-1)!.line.text).toBe('m79'); // newest at the bottom
    // A pending line never fades out before it resolves.
    const g = new ChatFeed();
    g.send('wait', 0, ME);
    expect(g.visible(CHAT_FADE_AFTER + 1, false)).toHaveLength(1);
  });

  it('colors names by roster team and recognises presence notices', () => {
    const roster = [{ name: 'Tom', team: 1 }, { name: 'Rex', team: 0 }];
    expect(teamOfName(roster, 'Tom')).toBe(1);
    expect(teamOfName(roster, 'Ghost')).toBe(-1);
    expect(isPresenceNotice('Biscuit joined the yard')).toBe(true);
    expect(isPresenceNotice('Biscuit left the yard')).toBe(true);
    expect(isPresenceNotice('server restarting')).toBe(false);
  });
});

// ---------------------------------------------------------------- a tiny fake DOM (Node has none)
class FakeEvent {
  defaultPrevented = false;
  propagationStopped = false;
  constructor(readonly type: string, init: Record<string, unknown> = {}) { Object.assign(this, init); }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
}

class FakeEl {
  static doc: FakeDoc;
  parent: FakeEl | null = null;
  children: FakeEl[] = [];
  className = '';
  value = '';
  type = '';
  maxLength = -1;
  spellcheck = true;
  autocomplete = '';
  scrollTop = 0;
  scrollHeight = 100;
  style: Record<string, string> = {};
  attrs = new Map<string, string>();
  private text = '';
  private listeners = new Map<string, Array<(e: FakeEvent) => void>>();
  constructor(readonly tagName: string) {}
  get classList() {
    const set = () => new Set(this.className.split(/\s+/).filter(Boolean));
    const write = (s: Set<string>) => { this.className = [...s].join(' '); };
    return {
      add: (c: string) => { const s = set(); s.add(c); write(s); },
      remove: (c: string) => { const s = set(); s.delete(c); write(s); },
      contains: (c: string) => set().has(c),
      toggle: (c: string, on?: boolean) => { const s = set(); const v = on ?? !s.has(c); if (v) s.add(c); else s.delete(c); write(s); return v; },
    };
  }
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v: string) { for (const c of this.children) c.parent = null; this.children = []; this.text = v; }
  set innerHTML(_v: string) { throw new Error('innerHTML must never be used for chat'); }
  appendChild(c: FakeEl) { c.remove(); c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  addEventListener(t: string, fn: (e: FakeEvent) => void) { (this.listeners.get(t) ?? this.listeners.set(t, []).get(t)!).push(fn); }
  dispatch(e: FakeEvent) { for (const fn of this.listeners.get(e.type) ?? []) fn(e); return e; }
  focus() { FakeEl.doc.activeElement = this as unknown as Element; }
  blur() { if (FakeEl.doc.activeElement === (this as unknown as Element)) FakeEl.doc.activeElement = null; this.dispatch(new FakeEvent('blur')); }
  all(): FakeEl[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  find(cls: string): FakeEl[] { return this.all().filter((e) => e.className.split(' ').includes(cls)); }
}

class FakeTarget {
  private listeners = new Map<string, Array<(e: FakeEvent) => void>>();
  addEventListener(t: string, fn: (e: FakeEvent) => void) { (this.listeners.get(t) ?? this.listeners.set(t, []).get(t)!).push(fn); }
  removeEventListener(t: string, fn: (e: FakeEvent) => void) { this.listeners.set(t, (this.listeners.get(t) ?? []).filter((f) => f !== fn)); }
  dispatch(e: FakeEvent) { for (const fn of this.listeners.get(e.type) ?? []) fn(e); return e; }
}

class FakeDoc extends FakeTarget {
  pointerLockElement: Element | null = null;
  activeElement: Element | null = null;
  createElement(tag: string) { return new FakeEl(tag.toUpperCase()) as unknown as HTMLElement; }
}

function setup(send: (t: string) => boolean = () => true) {
  const doc = new FakeDoc();
  FakeEl.doc = doc;
  const win = new FakeTarget();
  const root = new FakeEl('DIV');
  let now = 100;
  const sent: string[] = [];
  const opened: boolean[] = [];
  const chat = createChat(root as unknown as HTMLElement, {
    doc: doc as unknown as ChatDoc, keys: win as unknown as Window, clock: () => now,
    send: (t) => { sent.push(t); return send(t); }, onOpenChange: (o) => opened.push(o),
  });
  const roster: RosterEntry[] = [
    { pid: 'a', name: 'Rex', team: 0, cls: 'assault', entity: 7, bot: false, kills: 0, deaths: 0, score: 0, ping: 0 },
    { pid: 'b', name: 'Tom', team: 1, cls: 'assault', entity: 9, bot: false, kills: 0, deaths: 0, score: 0, ping: 0 },
  ];
  chat.update({ roster, localEntity: 7, canOpen: true });
  const input = root.all().find((e) => e.tagName === 'INPUT')!;
  const key = (target: FakeTarget | FakeEl, code: string, extra: Record<string, unknown> = {}) =>
    target.dispatch(new FakeEvent('keydown', { code, key: code === 'Enter' ? 'Enter' : code === 'Escape' ? 'Escape' : code.replace(/^Key/, '').toLowerCase(), repeat: false, target: doc.activeElement ?? root, ...extra }));
  return { doc, win, root, chat, input, sent, opened, key, roster, tick: (dt: number) => { now += dt; chat.update({ roster, localEntity: 7, canOpen: true }); } };
}

describe('chat view', () => {
  it('Enter or T opens it (the T never lands in the field); game keys stop at the input; Esc cancels', () => {
    const t = setup();
    const open = t.key(t.win, 'KeyT');
    expect(open.defaultPrevented).toBe(true);
    expect(t.chat.isOpen).toBe(true);
    expect(t.opened).toEqual([true]);
    expect(t.doc.activeElement).toBe(t.input);
    const w = t.key(t.input, 'KeyW');
    expect(w.propagationStopped).toBe(true); // InputState / kit picker / scoreboard never see it
    t.input.value = 'draft';
    const esc = t.key(t.input, 'Escape');
    expect(esc.propagationStopped).toBe(true);
    expect(t.chat.isOpen).toBe(false);
    expect(t.opened).toEqual([true, false]);
    t.key(t.win, 'Enter');
    expect(t.input.value).toBe(''); // Esc discards
  });

  it('does not open while another text field has focus, a menu is up, or with modifiers/key repeat', () => {
    const t = setup();
    const other = new FakeEl('INPUT');
    other.type = 'text';
    t.key(t.win, 'Enter', { target: other });
    expect(t.chat.isOpen).toBe(false);
    t.key(t.win, 'Enter', { ctrlKey: true });
    t.key(t.win, 'KeyT', { repeat: true });
    expect(t.chat.isOpen).toBe(false);
    t.chat.update({ roster: t.roster, localEntity: 7, canOpen: false });
    t.key(t.win, 'Enter');
    expect(t.chat.isOpen).toBe(false);
  });

  it('sends cleaned text, shows it pending, confirms on echo; renders markup as plain text (never innerHTML)', () => {
    const t = setup();
    t.key(t.win, 'Enter');
    t.input.value = '  <img src=x onerror=alert(1)>  ';
    t.key(t.input, 'Enter');
    expect(t.sent).toEqual(['<img src=x onerror=alert(1)>']);
    expect(t.chat.isOpen).toBe(false);
    let rows = t.root.find('ch-l');
    expect(rows).toHaveLength(1);
    expect(rows[0].classList.contains('pending')).toBe(true);
    expect(rows[0].textContent).toContain('<img src=x onerror=alert(1)>');
    t.chat.receive('Rex', '<img src=x onerror=alert(1)>');
    rows = t.root.find('ch-l');
    expect(rows).toHaveLength(1);
    expect(rows[0].classList.contains('pending')).toBe(false);
    expect(rows[0].find('ch-n')[0].className).toContain('t0');
    t.chat.receive('Tom', 'meow');
    expect(t.root.find('ch-n').map((n) => [n.textContent, n.className])).toEqual([['Rex', 'ch-n t0'], ['Tom', 'ch-n t1']]);
    // A line that beats the roster naming its sender gets its team color once the roster arrives.
    t.chat.receive('Biscuit', 'omw');
    expect(t.root.find('ch-n').at(-1)!.className).toBe('ch-n');
    t.roster.push({ pid: 'c', name: 'Biscuit', team: 0, cls: 'assault', entity: 11, bot: false, kills: 0, deaths: 0, score: 0, ping: 0 });
    t.chat.update({ roster: [...t.roster], localEntity: 7, canOpen: true });
    expect(t.root.find('ch-n').at(-1)!.className).toBe('ch-n t0');
    t.chat.system('Tom left the yard');
    expect(t.root.find('sys')[0].textContent).toBe('Tom left the yard');
  });

  it('keeps the draft and warns when sending too fast; a refused transport marks the line not delivered', () => {
    const t = setup(() => false);
    t.key(t.win, 'Enter');
    t.input.value = 'one';
    t.key(t.input, 'Enter');
    expect(t.root.find('ch-l')[0].classList.contains('failed')).toBe(true);
    t.key(t.win, 'Enter');
    t.input.value = 'two';
    t.key(t.input, 'Enter'); // same clock: inside CHAT_MIN_GAP
    expect(t.sent).toEqual(['one']);
    expect(t.chat.isOpen).toBe(true);
    expect(t.input.value).toBe('two');
    expect(t.root.find('ch-hint')[0].classList.contains('warn')).toBe(true);
    t.tick(CHAT_MIN_GAP);
    t.key(t.input, 'Enter');
    expect(t.sent).toEqual(['one', 'two']);
  });

  it('closes when pointer lock drops (Esc while locked) but keeps the draft for next time', () => {
    const t = setup();
    t.doc.pointerLockElement = {} as Element;
    t.key(t.win, 'Enter');
    t.input.value = 'half a thou';
    t.doc.pointerLockElement = null;
    t.doc.dispatch(new FakeEvent('pointerlockchange'));
    expect(t.chat.isOpen).toBe(false);
    t.key(t.win, 'Enter');
    expect(t.input.value).toBe('half a thou');
  });

  it('fades the closed feed and drops old rows from the DOM', () => {
    const t = setup();
    t.chat.receive('Tom', 'hi');
    t.tick(CHAT_FADE_AFTER - 0.5);
    expect(Number(t.root.find('ch-l')[0].style.opacity)).toBeCloseTo(0.5, 1);
    t.tick(1);
    expect(t.root.find('ch-l')).toHaveLength(0);
    t.key(t.win, 'Enter'); // open: full history is back
    expect(t.root.find('ch-l')).toHaveLength(1);
  });
});
