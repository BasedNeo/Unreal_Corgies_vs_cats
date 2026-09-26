// OWNER: U1 (ux). Main menu › Online rooms: the right-hand card lists a server's live rooms (refreshing every 5 s
// while open) with Join buttons, and creates a new room by name. Every state is drawn: loading (skeleton rows),
// ready, empty, error (with Retry), busy (429/503), offline, and a bad server address. A failed refresh keeps the
// last good list on screen, dimmed, instead of blanking it. Joining uses the normal PLAY flow with `room` set.
// All server-provided text goes through textContent; row buttons keep keyboard/gamepad focus across refreshes.
import { ROOM_STRINGS } from './strings';
import { RoomPoller, chapterLabel, cleanRoomName, isFull, modeLabel, PHASE_LABELS, type RoomInfo, type RoomsState } from './rooms';

export interface RoomBrowserDeps {
  /** The server whose rooms to list (the DEPLOY card's field, or the page's own server). */
  server(): string;
  /** Join (or create) this room with the DEPLOY card's name/team/class (`info`: the listing, when picked from the list). */
  join(room: string, info?: RoomInfo): void;
  /** Back to the class picker. */
  back(): void;
  /** "Joining as …" line for the footer. */
  joinAs(): string;
  poller?: RoomPoller;
  sound?(kind: 'click' | 'hover' | 'back' | 'open'): void;
}

export interface RoomBrowser {
  readonly el: HTMLElement;
  /** Start polling (view shown). */
  open(): void;
  /** Stop polling (view hidden / menu closed). */
  close(): void;
  /** The server field changed: poll the new one. */
  serverChanged(): void;
  readonly poller: RoomPoller;
}

const ADJ = ['porch', 'puddle', 'zoomie', 'squeaky', 'muddy', 'sunny', 'sneaky', 'fluffy', 'soggy', 'noisy'];
const NOUN = ['party', 'brawl', 'rumble', 'scuffle', 'patrol', 'picnic', 'standoff', 'rally'];
const suggestName = () => `${ADJ[Math.floor(Math.random() * ADJ.length)]}-${NOUN[Math.floor(Math.random() * NOUN.length)]}-${10 + Math.floor(Math.random() * 90)}`;

export function createRoomBrowser(deps: RoomBrowserDeps): RoomBrowser {
  const poller = deps.poller ?? new RoomPoller();
  const el = document.createElement('div');
  el.className = 'rb';
  el.innerHTML = `
    <h2 class="mm-h">${ROOM_STRINGS.title} <small class="rb-srv"></small><span class="rb-live" aria-hidden="true"></span></h2>
    <div class="rb-box">
      <div class="rb-head" aria-hidden="true"><span>${ROOM_STRINGS.headRoom}</span><span>${ROOM_STRINGS.headMode}</span><span>${ROOM_STRINGS.headPlayers}</span><span>${ROOM_STRINGS.headPhase}</span><span></span></div>
      <div class="rb-rows" role="list" aria-label="Rooms"></div>
      <div class="rb-msg hidden" role="status" aria-live="polite"><span class="rb-msg-t"></span><button class="btn small" data-nav data-rb-retry>${ROOM_STRINGS.retry}</button></div>
    </div>
    <div class="rb-create">
      <span class="mm-label">${ROOM_STRINGS.createLabel}</span>
      <input type="text" data-nav data-rb-name maxlength="24" spellcheck="false" autocomplete="off" aria-label="New room name">
      <span class="rb-unl"><button class="tog" data-nav data-rb-unlisted role="switch" aria-checked="false" aria-label="${ROOM_STRINGS.unlisted}"></button><span>${ROOM_STRINGS.unlisted}</span></span>
      <button class="btn small primary" data-nav data-rb-create>${ROOM_STRINGS.create}</button>
    </div>
    <div class="rb-note">${ROOM_STRINGS.unlistedHint}</div>
    <div class="rb-foot"><span class="rb-as"></span><button class="btn small" data-nav data-rb-back>${ROOM_STRINGS.back}</button></div>`;

  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const srv = q('.rb-srv'), live = q('.rb-live'), rowsEl = q('.rb-rows'), msg = q('.rb-msg'), msgT = q('.rb-msg-t'), retry = q<HTMLButtonElement>('[data-rb-retry]');
  const nameIn = q<HTMLInputElement>('[data-rb-name]'), unl = q<HTMLButtonElement>('[data-rb-unlisted]'), create = q<HTMLButtonElement>('[data-rb-create]');
  const asEl = q('.rb-as'), box = q('.rb-box'), note = q('.rb-note');
  let unlisted = false;
  let open = false;
  let known: RoomInfo[] = [];
  nameIn.placeholder = suggestName();

  const mk = (tag: string, cls: string, text?: string) => {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const row = (r: RoomInfo): HTMLElement => {
    const d = mk('div', 'rb-row');
    d.setAttribute('role', 'listitem');
    d.dataset.room = r.name;
    d.appendChild(mk('span', 'rb-name', r.name));
    d.appendChild(mk('span', 'rb-mode', r.chapter ? `${modeLabel(r.mode)} · ${chapterLabel(r.chapter)}` : modeLabel(r.mode)));
    const pl = mk('span', 'rb-pl');
    pl.appendChild(mk('b', '', String(r.humans)));
    pl.appendChild(document.createTextNode(`/${r.maxPlayers}`));
    if (r.bots > 0) pl.appendChild(mk('i', '', `+${r.bots} ${r.bots === 1 ? 'bot' : 'bots'}`));
    d.appendChild(pl);
    d.appendChild(mk('span', `rb-ph ${r.phase}`, PHASE_LABELS[r.phase]));
    const full = isFull(r);
    const b = mk('button', 'btn small', full ? ROOM_STRINGS.full : ROOM_STRINGS.join) as HTMLButtonElement;
    b.dataset.nav = '';
    b.disabled = full;
    b.setAttribute('aria-label', `${full ? 'Full' : 'Join'} room ${r.name}`);
    b.addEventListener('click', () => { deps.sound?.('open'); deps.join(r.name, r); });
    b.addEventListener('mouseenter', () => deps.sound?.('hover'));
    d.appendChild(b);
    return d;
  };

  const skeleton = () => {
    rowsEl.textContent = '';
    for (let i = 0; i < 3; i++) {
      const d = mk('div', 'rb-row sk');
      for (let k = 0; k < 4; k++) d.appendChild(mk('i', ''));
      rowsEl.appendChild(d);
    }
  };

  const drawRows = (rooms: RoomInfo[]) => {
    // Keep keyboard / gamepad focus on the same room across refreshes.
    const focusedRoom = (document.activeElement as HTMLElement | null)?.closest?.('.rb-row')?.getAttribute('data-room') ?? null;
    rowsEl.textContent = '';
    for (const r of rooms) rowsEl.appendChild(row(r));
    if (focusedRoom) rowsEl.querySelector<HTMLButtonElement>(`.rb-row[data-room="${CSS.escape(focusedRoom)}"] button`)?.focus();
  };

  const say = (text: string | null, canRetry = false, tone: 'info' | 'warn' = 'info') => {
    msg.classList.toggle('hidden', !text);
    msg.classList.toggle('warn', tone === 'warn');
    msgT.textContent = text ?? '';
    retry.classList.toggle('hidden', !canRetry);
  };

  const render = (s: RoomsState) => {
    el.dataset.state = s.kind;
    box.classList.toggle('norows', !(s.kind === 'loading' || s.kind === 'ready' || ((s.kind === 'error' || s.kind === 'busy' || s.kind === 'offline') && s.rooms.length > 0)));
    rowsEl.classList.toggle('stale', s.kind === 'error' || s.kind === 'busy' || s.kind === 'offline');
    rowsEl.setAttribute('aria-busy', String(s.kind === 'loading'));
    live.className = `rb-live ${s.kind}`;
    switch (s.kind) {
      case 'idle': return;
      case 'bad-url': known = []; rowsEl.textContent = ''; say(ROOM_STRINGS.badUrl, false, 'warn'); return;
      case 'loading': skeleton(); say(ROOM_STRINGS.loading); return;
      case 'ready': known = s.rooms; drawRows(s.rooms); say(null); return;
      case 'empty': known = []; rowsEl.textContent = ''; say(ROOM_STRINGS.empty); return;
      case 'error': case 'busy': case 'offline':
        known = s.rooms;
        if (s.rooms.length) drawRows(s.rooms); else rowsEl.textContent = '';
        say(s.kind === 'error' ? ROOM_STRINGS.error : s.kind === 'busy' ? ROOM_STRINGS.busy : ROOM_STRINGS.offline, s.kind !== 'busy', 'warn');
    }
  };
  poller.onChange = (s) => { if (open) render(s); };

  const paintServer = () => {
    const s = deps.server();
    srv.textContent = s.replace(/^wss?:\/\//i, '');
    srv.title = s;
    asEl.textContent = deps.joinAs();
  };

  const createRoom = () => {
    const typed = nameIn.value.trim();
    const name = cleanRoomName(typed || nameIn.placeholder, unlisted);
    if (!name) { nameIn.focus(); nameIn.select(); return; }
    nameIn.value = name.replace(/^_/, '');
    deps.sound?.('open');
    deps.join(name);
  };
  retry.addEventListener('click', () => { deps.sound?.('click'); poller.refresh(); });
  unl.addEventListener('click', () => { unlisted = !unlisted; unl.setAttribute('aria-checked', String(unlisted)); note.classList.toggle('on', unlisted); deps.sound?.('click'); });
  create.addEventListener('click', createRoom);
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); createRoom(); } });
  nameIn.addEventListener('input', () => {
    const exists = known.some((r) => r.name === cleanRoomName(nameIn.value, unlisted));
    create.textContent = exists ? `${ROOM_STRINGS.join} ▸` : ROOM_STRINGS.create;
  });
  q('[data-rb-back]').addEventListener('click', () => { deps.sound?.('back'); deps.back(); });
  for (const b of el.querySelectorAll<HTMLElement>('[data-nav]')) b.addEventListener('mouseenter', () => deps.sound?.('hover'));

  return {
    el,
    poller,
    open() {
      open = true;
      paintServer();
      render(poller.state);
      poller.start(deps.server());
    },
    close() {
      open = false;
      poller.stop();
    },
    serverChanged() {
      if (!open) return;
      paintServer();
      poller.start(deps.server());
    },
  };
}
