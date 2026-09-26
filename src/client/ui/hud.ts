// OWNER: UI lane. HUD, menus, scoreboard, kill feed, hit markers.
// Walking-skeleton version: minimal DOM readouts + click-to-play overlay.
import type { EntityState, MatchState, RosterEntry } from '../../shared/protocol';

export interface HudModel {
  local: EntityState | null;
  match: MatchState | null;
  roster: RosterEntry[];
  fps: number;
  rttMs: number;
  locked: boolean;
  backend: string;
  transport: string;
}

export interface Hud {
  update(m: HudModel): void;
  hitMarker(kill: boolean): void;
  damageFlash(amount: number): void;
}

export function createHud(root: HTMLElement): Hud {
  root.innerHTML = `
    <div id="hud-top" style="position:absolute;top:12px;left:50%;transform:translateX(-50%);font:700 18px/1.2 system-ui;text-shadow:0 2px 0 #000a;text-align:center"></div>
    <div id="hud-hp" style="position:absolute;left:18px;bottom:18px;width:220px;height:18px;border:3px solid #1a120c;border-radius:9px;background:#0006;overflow:hidden"><div style="height:100%;width:100%;background:#f2c14e"></div></div>
    <div id="hud-dbg" style="position:absolute;right:12px;top:10px;font:12px monospace;opacity:.8;text-align:right"></div>
    <div id="hud-cross" style="position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px #1a120c"></div>
    <div id="hud-lock" class="interactive" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0008;font:800 28px system-ui;cursor:pointer">Click to play — WASD move · Space jump ×2 · Shift zoomies · Mouse aim/fire</div>`;
  const top = root.querySelector('#hud-top') as HTMLElement;
  const hp = root.querySelector('#hud-hp > div') as HTMLElement;
  const dbg = root.querySelector('#hud-dbg') as HTMLElement;
  const lock = root.querySelector('#hud-lock') as HTMLElement;
  lock.addEventListener('click', () => document.querySelector('canvas')?.requestPointerLock());
  return {
    update(m) {
      if (m.match) top.textContent = `Corgis ${m.match.score[0]} — ${m.match.score[1]} Cats · ${m.match.objective}`;
      if (m.local) hp.style.width = `${Math.max(0, (m.local.hp / Math.max(1, m.local.maxHp)) * 100)}%`;
      dbg.textContent = `${m.fps.toFixed(0)} fps · ${m.backend} · ${m.transport} · rtt ${m.rttMs.toFixed(0)}ms`;
      lock.style.display = m.locked ? 'none' : 'flex';
    },
    hitMarker() {},
    damageFlash() {},
  };
}
