// Boss health bar: shown while a boss entity exists; phase 2 marked; comic-panel styling.
import type { EntityState } from '../../shared/protocol';
import { EntityKind } from '../../shared/types';
import { bossByIndex, unpackBossFlags, type BossFlagState } from '../../shared/content/bosses';

export class BossBar {
  private el: HTMLDivElement;
  private fill: HTMLDivElement;
  private ghost: HTMLDivElement;
  private label: HTMLDivElement;
  private ghostFrac = 1;
  private flags: BossFlagState = unpackBossFlags(0);

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;left:50%;top:92px;transform:translateX(-50%);width:min(560px,70vw);display:none;pointer-events:none;text-align:center';
    this.label = document.createElement('div');
    this.label.style.cssText = 'font:900 15px/1.2 "Lilita One",system-ui,sans-serif;letter-spacing:.06em;color:#fff3dc;text-shadow:0 2px 0 #1a120c,2px 0 0 #1a120c,-2px 0 0 #1a120c,0 -2px 0 #1a120c;margin-bottom:4px';
    const track = document.createElement('div');
    track.style.cssText = 'position:relative;height:16px;border:3px solid #1a120c;border-radius:9px;background:#2b2a33;overflow:hidden;box-shadow:3px 3px 0 #1a120c';
    this.ghost = document.createElement('div');
    this.ghost.style.cssText = 'position:absolute;inset:0 auto 0 0;width:100%;background:#ffd04a';
    this.fill = document.createElement('div');
    this.fill.style.cssText = 'position:absolute;inset:0 auto 0 0;width:100%;background:linear-gradient(#ff5a6e,#c9344a)';
    track.append(this.ghost, this.fill);
    this.el.append(this.label, track);
    parent.appendChild(this.el);
  }

  update(states: Map<number, EntityState>, dt: number): void {
    let boss: EntityState | null = null;
    for (const s of states.values()) if (s.kind === EntityKind.Boss) { boss = s; break; }
    if (!boss || boss.hp <= 0) { this.el.style.display = 'none'; this.ghostFrac = 1; return; }
    const def = bossByIndex(boss.cls);
    unpackBossFlags(boss.flags, this.flags);
    const frac = Math.max(0, Math.min(1, boss.hp / Math.max(1, boss.maxHp)));
    this.ghostFrac = Math.max(frac, this.ghostFrac - dt * 0.35);
    this.el.style.display = 'block';
    this.label.textContent = `${def.name.toUpperCase()}${this.flags.phase2 ? ' · LID OFF!' : ''}`;
    this.fill.style.width = `${(frac * 100).toFixed(1)}%`;
    this.ghost.style.width = `${(this.ghostFrac * 100).toFixed(1)}%`;
  }
}
