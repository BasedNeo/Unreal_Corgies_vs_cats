// OWNER: U1 (ux). In-match text chat over the HUD (right column, under the kill feed: the "feed" side of the screen).
//
//   Enter or T  opens the input (not while a menu is up or another text field has focus; gamepads have no chat)
//   Enter       sends (empty = just close) · Esc cancels · the draft survives losing pointer lock
//
// Keys typed into the chat never reach the game: the input stops keydown propagation (window-level listeners —
// InputState, the kit picker, the scoreboard — never see them). Keyup is allowed through on purpose, so a movement
// key held when chat opened is still released. Pointer lock is kept while typing (no click-to-play overlay pops up);
// if the browser drops it (Esc while locked), the chat closes and keeps the draft for next time.
//
// All user text is rendered with textContent — never innerHTML (tests/unit/ui-chat.test.ts checks with a fake DOM).
import type { RosterEntry } from '../../shared/protocol';
import { CHAT_MAX_LEN, ChatFeed, teamOfName, type ChatLine } from './chat-model';
import { CHAT_STRINGS } from './strings';

/** The DOM surface the chat needs (the real `document`, or a fake in tests). */
export interface ChatDoc {
  createElement(tag: string): HTMLElement;
  readonly pointerLockElement: Element | null;
  readonly activeElement: Element | null;
  addEventListener(type: string, fn: (e: Event) => void): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
}

export interface ChatDeps {
  /** Hand cleaned text to the authority (`{t:'chat', text}`); return false when not connected. */
  send?(text: string): boolean;
  /** Seconds clock. Default performance.now()/1000. */
  clock?(): number;
  doc?: ChatDoc;
  /** Keyboard source for the open keys. Default window. */
  keys?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** Open state changed (the HUD hides the click-to-play overlay while chat is open). */
  onOpenChange?(open: boolean): void;
  sound?(kind: 'click' | 'open' | 'back'): void;
}

export interface ChatFrame {
  roster: readonly RosterEntry[];
  /** Local entity id (finds your roster name/team), -1 = none. */
  localEntity: number;
  /** Whether Enter/T may open chat right now (in a session, no menu). */
  canOpen: boolean;
}

export interface Chat {
  readonly el: HTMLElement;
  readonly feed: ChatFeed;
  readonly isOpen: boolean;
  open(): void;
  /** Close; keepDraft=true remembers the typed text for the next open. */
  close(keepDraft?: boolean): void;
  /** A chat line from the authority (bus 'chat'). */
  receive(from: string, text: string): void;
  /** A server notice / presence line (bus 'notice'). */
  system(text: string): void;
  update(f: ChatFrame): void;
  dispose(): void;
}

const OPEN_CODES = new Set(['Enter', 'NumpadEnter', 'KeyT']);
const RENDER_EVERY = 0.1; // s — fades are smooth enough at 10 Hz and cost nothing in between

function isTextField(t: EventTarget | null): boolean {
  const e = t as HTMLElement | null;
  if (!e || typeof e.tagName !== 'string') return false;
  const tag = e.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !/^(button|checkbox|radio|range|submit|reset)$/i.test((e as HTMLInputElement).type ?? '');
  return !!e.isContentEditable;
}

export function createChat(parent: HTMLElement, deps: ChatDeps = {}): Chat {
  const doc: ChatDoc = deps.doc ?? document;
  const keys = deps.keys ?? window;
  const clock = deps.clock ?? (() => performance.now() / 1000);
  const feed = new ChatFeed();

  const mk = (tag: string, cls: string, text?: string): HTMLElement => {
    const e = doc.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const el = mk('div', 'ch');
  const log = mk('div', 'ch-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-label', CHAT_STRINGS.logLabel);
  const box = mk('div', 'ch-in hidden');
  const tag = mk('span', 'ch-to', CHAT_STRINGS.channel);
  const input = doc.createElement('input') as HTMLInputElement;
  input.className = 'ch-field';
  input.type = 'text';
  input.maxLength = CHAT_MAX_LEN;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', CHAT_STRINGS.inputLabel);
  input.setAttribute('enterkeyhint', 'send');
  const count = mk('span', 'ch-cnt');
  box.appendChild(tag);
  box.appendChild(input);
  box.appendChild(count);
  const hint = mk('div', 'ch-hint hidden', CHAT_STRINGS.hint);
  el.appendChild(log);
  el.appendChild(box);
  el.appendChild(hint);
  parent.appendChild(el);

  let open = false;
  let draft = '';
  let canOpen = false;
  let myName: string | null = null;
  let myTeam: -1 | 0 | 1 = -1;
  let roster: readonly RosterEntry[] = [];
  let rendered = -1, renderedOpen = false, lastRender = -1;
  let hintUntil = 0;
  let lockedWhileOpen = false;
  let refocusTimer: ReturnType<typeof setTimeout> | null = null;
  const rows = new Map<number, { el: HTMLElement; state: string; team: number; opacity: string }>();

  const setOpen = (v: boolean) => {
    if (open === v) return;
    open = v;
    box.classList.toggle('hidden', !v);
    hint.classList.toggle('hidden', !v);
    el.classList.toggle('open', v);
    deps.onOpenChange?.(v);
    render(clock(), true);
  };

  const paintCount = () => {
    const n = input.value.length;
    count.textContent = n > CHAT_MAX_LEN - 30 ? `${CHAT_MAX_LEN - n}` : '';
  };

  const flashHint = (text: string, now: number) => {
    hint.textContent = text;
    hint.classList.add('warn');
    hintUntil = now + 1.6;
    box.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)', offset: 0.3 }, { transform: 'translateX(4px)', offset: 0.65 }, { transform: 'translateX(0)' }], { duration: 240 });
  };

  const chat: Chat = {
    el,
    feed,
    get isOpen() { return open; },
    open() {
      if (open) return;
      input.value = draft;
      draft = '';
      paintCount();
      lockedWhileOpen = !!doc.pointerLockElement;
      hint.textContent = CHAT_STRINGS.hint;
      hint.classList.remove('warn');
      setOpen(true);
      input.focus();
      deps.sound?.('open');
    },
    close(keepDraft = false) {
      if (!open) return;
      draft = keepDraft ? input.value : '';
      input.value = '';
      setOpen(false);
      if (refocusTimer) { clearTimeout(refocusTimer); refocusTimer = null; }
      input.blur();
    },
    receive(from, text) {
      const team = teamOfName(roster, from);
      feed.receive(from, text, clock(), team, myName);
      render(clock(), true);
    },
    system(text) {
      feed.system(text, clock());
      render(clock(), true);
    },
    update(f) {
      if (f.roster !== roster) { roster = f.roster; feed.resolveTeams((n) => teamOfName(roster, n)); }
      canOpen = f.canOpen;
      const me = f.localEntity >= 0 ? f.roster.find((r) => r.entity === f.localEntity) : undefined;
      if (me) { myName = me.name; myTeam = me.team === 1 ? 1 : 0; }
      if (open && !canOpen) chat.close(true); // a menu opened or the session ended under the chat
      const now = clock();
      if (hintUntil && now > hintUntil) { hintUntil = 0; hint.textContent = CHAT_STRINGS.hint; hint.classList.remove('warn'); }
      if (feed.tick(now) || feed.version !== rendered) render(now, true);
      else if (now - lastRender >= RENDER_EVERY) render(now, false);
    },
    dispose() {
      keys.removeEventListener('keydown', onWindowKey);
      doc.removeEventListener('pointerlockchange', onLockChange);
      if (refocusTimer) clearTimeout(refocusTimer);
      el.remove();
    },
  };

  function submit(): void {
    const now = clock();
    const r = feed.send(input.value, now, { name: myName ?? CHAT_STRINGS.you, team: myTeam });
    if (!r.ok) {
      if (r.reason === 'empty') { chat.close(); return; }
      flashHint(CHAT_STRINGS.tooFast, now);
      return;
    }
    const delivered = deps.send?.(r.text) ?? false;
    if (!delivered) feed.markFailed(r.line);
    deps.sound?.('click');
    chat.close();
    render(now, true);
  }

  function lineClass(l: ChatLine): string {
    return `ch-l${l.kind === 'system' ? ' sys' : ''}${l.self ? ' self' : ''}${l.state === 'pending' ? ' pending' : ''}${l.state === 'failed' ? ' failed' : ''}`;
  }

  function buildRow(l: ChatLine): HTMLElement {
    const row = mk('div', lineClass(l));
    if (l.kind === 'chat') {
      const n = mk('span', `ch-n${l.team >= 0 ? ` t${l.team}` : ''}`, l.from);
      row.appendChild(n);
    }
    row.appendChild(mk('span', 'ch-t', l.text));
    const st = mk('span', 'ch-s', l.state === 'pending' ? CHAT_STRINGS.sending : l.state === 'failed' ? CHAT_STRINGS.failed : '');
    row.appendChild(st);
    return row;
  }

  function render(now: number, force: boolean): void {
    lastRender = now;
    const vis = feed.visible(now, open);
    let structural = force || feed.version !== rendered || open !== renderedOpen || vis.length !== rows.size;
    if (!structural) for (const { line } of vis) if (!rows.has(line.id)) { structural = true; break; } // a line aged out
    if (structural) {
      const keep = new Set<number>();
      for (const { line } of vis) keep.add(line.id);
      for (const [id, r] of rows) if (!keep.has(id)) { r.el.remove(); rows.delete(id); }
      for (const { line } of vis) {
        let r = rows.get(line.id);
        if (!r || r.state !== line.state || r.team !== line.team) {
          if (r) r.el.remove(); // state/team changed: rebuild the row (tiny) instead of patching it
          r = { el: buildRow(line), state: line.state, team: line.team, opacity: '' };
          rows.set(line.id, r);
        }
        log.appendChild(r.el); // (re)append in order: moves existing nodes, keeps oldest at the top
      }
      rendered = feed.version;
      renderedOpen = open;
      if (open) log.scrollTop = log.scrollHeight;
    }
    for (const { line, opacity } of vis) {
      const r = rows.get(line.id)!;
      const o = opacity >= 0.995 ? '' : opacity.toFixed(2);
      if (r.opacity !== o) { r.opacity = o; r.el.style.opacity = o; }
    }
    el.classList.toggle('empty', vis.length === 0);
  }

  input.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    e.stopPropagation(); // typing never reaches InputState / the kit picker / the scoreboard
    if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
    if (e.key === 'Escape') { e.preventDefault(); deps.sound?.('back'); chat.close(false); return; }
    if (e.key === 'Tab') e.preventDefault();
  });
  input.addEventListener('input', paintCount);
  input.addEventListener('blur', () => {
    // A click on the (locked) canvas moves focus away: keep typing unless the chat was closed on purpose.
    if (!open) return;
    if (refocusTimer) clearTimeout(refocusTimer);
    refocusTimer = setTimeout(() => { refocusTimer = null; if (open) input.focus(); }, 0);
  });

  const onWindowKey = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (open || !canOpen || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    if (!OPEN_CODES.has(e.code)) return;
    if (isTextField(e.target) || isTextField(doc.activeElement)) return;
    e.preventDefault(); // keeps the opening "t" out of the field
    chat.open();
  };
  keys.addEventListener('keydown', onWindowKey);

  const onLockChange = () => {
    if (!open) return;
    if (doc.pointerLockElement) { lockedWhileOpen = true; return; }
    // Chrome swallows the Esc keydown while locked and just drops the lock: treat that as "cancel", keep the draft.
    if (lockedWhileOpen) chat.close(true);
  };
  doc.addEventListener('pointerlockchange', onLockChange);

  render(clock(), true);
  return chat;
}
