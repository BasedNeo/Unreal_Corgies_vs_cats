// OWNER: L5 (juice). Inline SVG glyphs in the comic ink style (chunky warm-black strokes, flat fills).
// Original simple shapes; `currentColor` lets CSS tint them per team.
import type { ClassId } from '../../shared/types';

const INK = '#1a120c';
const svg = (body: string, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

export const CLASS_ICONS: Record<ClassId, string> = {
  // Frontline starburst.
  assault: svg(`<path fill="currentColor" d="M16 2.5l3 7 7.2-2.6-3.4 6.8L29.5 17l-7.1 2.4 2.2 7.4-6.9-3.3L16 30l-2.4-6.5-6.9 3.3 2.2-7.4L2.5 17l6.7-3.3-3.4-6.8L13 9.5z"/><circle cx="16" cy="16" r="3.2" fill="#fff4dc"/>`),
  // Domino mask.
  infiltrator: svg(`<path fill="currentColor" d="M3 13c3-4 8-4 13-1.5C21 9 26 9 29 13c-.5 5-3.5 8-7.5 8-2.7 0-4.2-2-5.5-2s-2.8 2-5.5 2C6.5 21 3.5 18 3 13z"/><ellipse cx="10.5" cy="15" rx="2.6" ry="2" fill="#fff4dc"/><ellipse cx="21.5" cy="15" rx="2.6" ry="2" fill="#fff4dc"/>`),
  // Scope reticle with laser dot.
  overwatch: svg(`<circle cx="16" cy="16" r="11" fill="currentColor"/><circle cx="16" cy="16" r="6" fill="#fff4dc"/><path d="M16 2v7M16 23v7M2 16h7M23 16h7"/><circle cx="16" cy="16" r="2" fill="#ff3b3b"/>`),
  // Tennis-ball bomb with fuse.
  breacher: svg(`<circle cx="15" cy="18" r="10.5" fill="currentColor"/><path d="M7.5 12.5c4 2 4 9 0 11M22.5 12.5c-4 2-4 9 0 11" stroke="#fff4dc" stroke-width="2"/><path d="M21 8.5l3-3.5"/><path d="M25 3.5l1.5-1.5M27 6l2-.5M24 1.8l.2-1" stroke="#ffd04a"/>`),
  // Shield with a paw.
  warden: svg(`<path fill="currentColor" d="M16 2.5l11 4v8.5c0 7-4.8 11.8-11 14.5C9.8 26.8 5 22 5 15V6.5z"/><circle cx="16" cy="18" r="3.4" fill="#fff4dc" stroke-width="1.8"/><circle cx="11.8" cy="12.8" r="1.6" fill="#fff4dc" stroke-width="1.6"/><circle cx="16" cy="11" r="1.6" fill="#fff4dc" stroke-width="1.6"/><circle cx="20.2" cy="12.8" r="1.6" fill="#fff4dc" stroke-width="1.6"/>`),
  // Ear-wings.
  skyraider: svg(`<path fill="currentColor" d="M16 22c-3-7-7.5-12-13.5-14 1.5 7 5.5 13 13.5 14zM16 22c3-7 7.5-12 13.5-14-1.5 7-5.5 13-13.5 14z"/><path d="M8 13l3 4M24 13l-3 4"/><circle cx="16" cy="24" r="3" fill="#fff4dc"/>`),
};

export const WEAPON_GLYPHS: Record<string, string> = {
  rifle: svg(`<path fill="#f2c14e" d="M3 13h18l4-2h4v6h-5l-3 1H14l-2 5H8l1.5-5H3z"/><circle cx="26" cy="10" r="3" fill="#d7f542"/>`, 'glyph'),
  pistol: svg(`<path fill="#f2c14e" d="M5 11h19v5h-9l-2 7H8.5l1.5-7H5z"/><path d="M24 12.5h3"/>`, 'glyph'),
  laser: svg(`<path fill="#b8b2a6" d="M3 15.5l12-3 1.4 5-12 3z"/><path d="M17 14.5L30 11" stroke="#ff3b3b" stroke-width="2.8"/><circle cx="16.2" cy="15" r="1.4" fill="#ff3b3b"/>`, 'glyph'),
  mortar: svg(`<circle cx="16" cy="16" r="11" fill="#d7f542"/><path d="M7.5 10c5 3 5 9 0 12M24.5 10c-5 3-5 9 0 12" stroke="#fff4dc" stroke-width="2"/>`, 'glyph'),
  sprinkler: svg(`<path fill="#4fb3d9" d="M16 3c5 7 9 11 9 16a9 9 0 0 1-18 0c0-5 4-9 9-16z"/><path d="M12 19a4 4 0 0 0 4 4" stroke="#fff4dc" stroke-width="2"/>`, 'glyph'),
  frisbee: svg(`<ellipse cx="16" cy="17" rx="13" ry="6" fill="#6ff7ff"/><ellipse cx="16" cy="16" rx="7" ry="2.6" fill="#fff4dc" stroke-width="1.8"/>`, 'glyph'),
  paw: svg(`<ellipse cx="16" cy="20" rx="6.5" ry="5.5" fill="#f6e7cf"/><circle cx="8.5" cy="12.5" r="2.8" fill="#f6e7cf"/><circle cx="13.5" cy="8.5" r="2.8" fill="#f6e7cf"/><circle cx="18.5" cy="8.5" r="2.8" fill="#f6e7cf"/><circle cx="23.5" cy="12.5" r="2.8" fill="#f6e7cf"/>`, 'glyph'),
  boom: svg(`<path fill="#ff9b3d" d="M16 2l2.6 7.4 7-3.4-3 7.3L30 16l-7.4 2.6 3.4 7-7.3-3L16 30l-2.6-7.4-7 3.4 3-7.3L2 16l7.4-2.6-3.4-7 7.3 3z"/><circle cx="16" cy="16" r="4" fill="#ffd04a"/>`, 'glyph'),
  fall: svg(`<path fill="#f6e7cf" d="M16 29l-8-9h5V4h6v16h5z"/>`, 'glyph'),
  star: svg(`<path fill="#ffd04a" d="M16 3l3.6 8 8.4.8-6.4 5.6 1.9 8.3L16 21.4l-7.5 4.3 1.9-8.3L4 11.8l8.4-.8z"/>`, 'glyph'),
};

export function classIcon(cls: ClassId): string { return CLASS_ICONS[cls] ?? CLASS_ICONS.assault; }
export function weaponGlyph(id: string): string { return WEAPON_GLYPHS[id] ?? WEAPON_GLYPHS.paw; }
