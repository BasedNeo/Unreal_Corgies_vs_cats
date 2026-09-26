// Screen-space nameplates for other characters: class icon + team-colored name, and a compact health pip
// that appears once damaged. DOM elements projected from 3D each frame (≤ 24 entities — cheap).
import * as THREE from 'three/webgpu';
import type { EntityState, RosterEntry } from '../../shared/protocol';
import { CLASS_IDS, EFlag, EntityKind, Team } from '../../shared/types';
import { classIcon } from '../ui/icons';

interface Plate { el: HTMLDivElement; icon: HTMLSpanElement; name: HTMLSpanElement; bar: HTMLDivElement; fill: HTMLDivElement; cls: number; ally: boolean | null }

export class Nameplates {
  private root: HTMLDivElement;
  private plates = new Map<number, Plate>();
  private names = new Map<number, { name: string; bot: boolean }>();
  private v = new THREE.Vector3();
  private at = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'nameplates';
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    const css = document.createElement('style');
    css.textContent = '#nameplates svg{display:block;width:100%;height:100%}';
    this.root.appendChild(css);
    parent.prepend(this.root);
  }

  setRoster(roster: RosterEntry[]): void {
    this.names.clear();
    for (const r of roster) this.names.set(r.entity, { name: r.name, bot: r.bot });
  }

  update(states: Map<number, EntityState>, localId: number, localTeam: number, camera: THREE.Camera, heights: (id: number) => number): void {
    const w = innerWidth, h = innerHeight;
    for (const [id, p] of this.plates) if (!states.has(id)) { p.el.remove(); this.plates.delete(id); }
    for (const [id, s] of states) {
      if (id === localId || (s.kind !== EntityKind.Player && s.kind !== EntityKind.Bot)) continue;
      let p = this.plates.get(id);
      if (!p) { p = this.make(); this.plates.set(id, p); }
      const dead = (s.flags & EFlag.Dead) !== 0;
      const stealthed = (s.flags & EFlag.Stealthed) !== 0 && s.team !== localTeam;
      this.v.set(s.x, s.y + heights(id) + 0.35, s.z).project(camera);
      const dist = camera.position.distanceTo(this.at.set(s.x, s.y, s.z));
      const visible = !dead && !stealthed && this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1 && dist < 60;
      p.el.style.display = visible ? 'block' : 'none';
      if (!visible) continue;
      const x = (this.v.x * 0.5 + 0.5) * w, y = (-this.v.y * 0.5 + 0.5) * h;
      const scale = Math.max(0.6, Math.min(1, 14 / Math.max(1, dist)));
      p.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(2)})`;
      const info = this.names.get(id);
      const ally = s.team === localTeam;
      p.name.textContent = info?.name ?? (s.team === Team.Cats ? 'Cat' : 'Pup');
      if (p.cls !== s.cls || p.ally !== ally) {
        // the class reads at a glance (QA W1: which cat is the sniper?) — icons only rebuilt on change
        p.cls = s.cls; p.ally = ally;
        p.icon.innerHTML = classIcon(CLASS_IDS[s.cls] ?? 'assault');
        p.icon.style.color = ally ? '#5da2ff' : '#ff4d5e';
        p.name.style.color = ally ? '#8fc1ff' : '#ff8c95';
      }
      const frac = s.maxHp ? s.hp / s.maxHp : 1;
      p.bar.style.display = frac < 0.999 ? 'block' : 'none';
      p.fill.style.width = `${Math.max(0, frac * 100).toFixed(0)}%`;
      p.fill.style.background = ally ? '#5da2ff' : '#ff4d5e';
      p.el.style.opacity = String(Math.max(0.35, Math.min(1, 1.4 - dist / 60)));
    }
  }

  private make(): Plate {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;text-align:center;will-change:transform;white-space:nowrap';
    const icon = document.createElement('span');
    icon.style.cssText = 'display:inline-block;width:15px;height:15px;margin-right:3px;vertical-align:-3px;filter:drop-shadow(0 0 1.5px #1a120c)';
    const name = document.createElement('span');
    name.style.cssText = 'font:800 13px/1 system-ui,sans-serif;text-shadow:0 0 3px #1a120c,0 1px 0 #1a120c,1px 0 0 #1a120c,-1px 0 0 #1a120c';
    const bar = document.createElement('div');
    bar.style.cssText = 'width:44px;height:5px;margin:3px auto 0;border:1.5px solid #1a120c;border-radius:3px;background:#0007;overflow:hidden';
    const fill = document.createElement('div');
    fill.style.cssText = 'height:100%;width:100%';
    bar.appendChild(fill);
    el.append(icon, name, bar);
    this.root.appendChild(el);
    return { el, icon, name, bar, fill, cls: -1, ally: null };
  }
}
