// core-rush presentation (lead). Core Pads in the world: a ground ring and a floating core in the owner's color
// plus a sky beam once owned; the core spins faster and pulses while contested. DOM: a marker over each pad
// (letter + capture arc, visible through walls) and a strip "A · B · C" under the match bar.
// Reads only EntityKind.Zone states (layout: src/shared/content/modes.ts). Idle and invisible in other modes.
import * as THREE from 'three/webgpu';
import type { EntityState } from '../../shared/protocol';
import { EFlag, EntityKind } from '../../shared/types';
import { CORE_PAD_LABELS, CORE_RUSH } from '../../shared/content/modes';
import { glow, toon } from '../style/style-webgpu.js';
import { PALETTE } from '../style/style-tokens.js';

/** Owner → color: corgis, cats, neutral. */
const COLORS: readonly number[] = [PALETTE.teamCorgis, PALETTE.teamCats, PALETTE.hullLight];
const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const ARC = 2 * Math.PI * 15; // marker ring circumference (r = 15 in a 36×36 viewBox)

interface PadView {
  root: THREE.Group;
  ring: THREE.Mesh;
  core: THREE.Mesh;
  beam: THREE.Mesh;
  owner: number;
  marker: HTMLDivElement;
  markerArc: SVGCircleElement;
  chip: HTMLDivElement;
  chipArc: SVGCircleElement;
  spin: number;
}

export interface CoreRushView {
  /** `localTeam` tints nothing today (absolute team colors, like the HUD) but decides the "yours" outline. */
  sync(states: ReadonlyMap<number, EntityState>, localTeam: number, camera: THREE.Camera, dt: number): void;
  dispose(): void;
  readonly active: boolean;
}

const STYLE = `
#cvc-rush{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:"Lilita One",system-ui,sans-serif}
#cvc-rush .mk{position:absolute;left:0;top:0;width:36px;height:36px;will-change:transform}
#cvc-rush svg{display:block;width:100%;height:100%;overflow:visible}
#cvc-rush .lt{font-size:17px;font-weight:900;fill:#fff;stroke:#1a120c;stroke-width:3px;paint-order:stroke;text-anchor:middle;dominant-baseline:central}
#cvc-rush .strip{position:absolute;left:50%;top:92px;transform:translateX(-50%);display:flex;gap:10px}
#cvc-rush .chip{width:40px;height:40px}
#cvc-rush .hot{animation:cvcRushPulse .5s ease-in-out infinite alternate}
@keyframes cvcRushPulse{from{transform-origin:center;scale:1}to{scale:1.18}}
`;

function markerSvg(label: string): { el: HTMLDivElement; arc: SVGCircleElement } {
  const el = document.createElement('div');
  el.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true">
    <circle class="bg" cx="18" cy="18" r="15" stroke="#1a120c" stroke-width="3"/>
    <circle class="arc" cx="18" cy="18" r="15" fill="none" stroke-width="4" stroke-linecap="round"
      transform="rotate(-90 18 18)" stroke-dasharray="0 ${ARC.toFixed(1)}"/>
    <text class="lt" x="18" y="18.5">${label}</text></svg>`;
  return { el, arc: el.querySelector('.arc') as SVGCircleElement };
}

export function createCoreRushView(scene: THREE.Scene, ui: HTMLElement): CoreRushView {
  const group = new THREE.Group();
  group.name = 'core-rush';
  scene.add(group);
  const root = document.createElement('div');
  root.id = 'cvc-rush';
  const style = document.createElement('style');
  style.textContent = STYLE;
  root.appendChild(style);
  const strip = document.createElement('div');
  strip.className = 'strip';
  root.appendChild(strip);
  ui.prepend(root);
  root.style.display = 'none';

  const ringGeo = new THREE.TorusGeometry(CORE_RUSH.padRadius, 0.09, 6, 56);
  ringGeo.rotateX(-Math.PI / 2);
  const baseGeo = new THREE.CylinderGeometry(0.38, 0.55, 0.8, 10);
  const coreGeo = new THREE.IcosahedronGeometry(0.42, 1);
  const beamGeo = new THREE.CylinderGeometry(0.07, 0.07, 14, 6, 1, true);
  const baseMat = toon({ color: PALETTE.hull });
  const pads = new Map<number, PadView>();
  const v = new THREE.Vector3();
  let active = false;

  const make = (s: EntityState): PadView => {
    const g = new THREE.Group();
    g.position.set(s.x, s.y, s.z);
    const ring = new THREE.Mesh(ringGeo, toon({ color: COLORS[2] }));
    ring.position.y = 0.06;
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.4;
    const core = new THREE.Mesh(coreGeo, glow(COLORS[2], 2));
    core.position.y = 1.55;
    const beam = new THREE.Mesh(beamGeo, glow(COLORS[2], 1.4));
    beam.position.y = 8.5;
    beam.visible = false;
    for (const m of [ring, base, core, beam]) m.castShadow = false;
    g.add(ring, base, core, beam);
    group.add(g);
    const label = CORE_PAD_LABELS[s.seed] ?? '?';
    const mk = markerSvg(label);
    mk.el.className = 'mk';
    root.appendChild(mk.el);
    const ch = markerSvg(label);
    ch.el.className = 'chip';
    strip.appendChild(ch.el);
    // keep the strip in A, B, C order whatever order the pads arrive in
    [...strip.children].sort((a, b) => (a.textContent ?? '').localeCompare(b.textContent ?? '')).forEach((c) => strip.appendChild(c));
    return { root: g, ring, core, beam, owner: -1, marker: mk.el, markerArc: mk.arc, chip: ch.el, chipArc: ch.arc, spin: 0 };
  };

  const paint = (p: PadView, owner: number) => {
    p.owner = owner;
    const c = COLORS[owner] ?? COLORS[2];
    p.ring.material = toon({ color: c, emissive: c, emissiveIntensity: owner === 2 ? 0 : 0.35 });
    p.core.material = glow(c, owner === 2 ? 1.6 : 2.6);
    p.beam.material = glow(c, 1.4);
    p.beam.visible = owner !== 2;
    for (const el of [p.marker, p.chip]) (el.querySelector('.bg') as SVGCircleElement).setAttribute('fill', css(c));
  };

  const arc = (el: SVGCircleElement, frac: number, team: number) => {
    el.setAttribute('stroke-dasharray', `${(ARC * frac).toFixed(1)} ${ARC.toFixed(1)}`);
    el.setAttribute('stroke', team >= 0 ? css(team === 0 ? PALETTE.teamCorgisTrim : 0xffc2cb) : 'none');
  };

  return {
    get active() { return active; },
    sync(states, localTeam, camera, dt) {
      void localTeam;
      const seen = new Set<number>();
      for (const s of states.values()) {
        if (s.kind !== EntityKind.Zone) continue;
        seen.add(s.id);
        let p = pads.get(s.id);
        if (!p) { p = make(s); pads.set(s.id, p); }
        if (p.owner !== s.team) paint(p, s.team);
        const holder = s.ammo - 1; // progress team (−1 none)
        const frac = s.maxHp ? s.hp / s.maxHp : 0;
        const contested = (s.flags & EFlag.Busy) !== 0;
        // the arc shows a capture in progress (not the owner's full ring)
        const showArc = holder >= 0 && (holder !== s.team || frac < 1) ? frac : 0;
        arc(p.markerArc, showArc, holder);
        arc(p.chipArc, showArc, holder);
        p.marker.classList.toggle('hot', contested);
        p.chip.classList.toggle('hot', contested);
        p.spin += dt * (contested ? 7 : holder >= 0 && frac < 1 ? 3.5 : 1.2);
        p.core.rotation.set(p.spin * 0.6, p.spin, 0);
        p.core.position.y = 1.55 + Math.sin(p.spin * 1.3) * 0.12;
        const k = contested ? 1 + 0.15 * Math.sin(p.spin * 6) : 1;
        p.core.scale.setScalar(k);
        // marker over the pad, projected (visible through walls; hidden behind the camera)
        v.set(s.x, s.y + 3.2, s.z).project(camera);
        const vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        p.marker.style.display = vis ? 'block' : 'none';
        if (vis) p.marker.style.transform = `translate(${((v.x * 0.5 + 0.5) * innerWidth - 18).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * innerHeight - 18).toFixed(1)}px)`;
      }
      for (const [id, p] of pads) if (!seen.has(id)) {
        group.remove(p.root); p.marker.remove(); p.chip.remove(); pads.delete(id);
      }
      active = pads.size > 0;
      root.style.display = active ? 'block' : 'none';
    },
    dispose() {
      scene.remove(group);
      root.remove();
      ringGeo.dispose(); baseGeo.dispose(); coreGeo.dispose(); beamGeo.dispose();
      pads.clear();
    },
  };
}
