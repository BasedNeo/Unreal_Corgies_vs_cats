// W15 TW-VIEW, headless: the slab HUD against docs/qa/w15/HUD_CONTRACT.md rev. 3 (Godot's strings win). §1 the slab
// marker's words and shape per state and its placement (safe area first, then off the other pets), §2 the four
// death-panel lines (a killer, no killer) with the team glyph and the respawn zone, §3 the hit cues (geometry, not only
// colour), the received-hit wedge, the HP chip and the red flash, §4 the YOU line and the slab line after a win, and
// slabHudFrame, the per-frame model the DOM only writes (the wedge's point, the death panel, the camera's distance, the
// killer, the chip, the dead gate).
import { describe, it, expect } from 'vitest';
import { PerspectiveCamera } from 'three/webgpu';
import type { EntityState, GameEvent, MatchState, RosterEntry } from '../../src/shared/protocol';
import { EFlag, EntityKind } from '../../src/shared/types';
import { SLAB, SLAB_TEXT } from '../../src/shared/content/modes';
import { PALETTE } from '../../src/client/style/style-tokens.js';
import { lighten, type SlabPet, type SlabReading } from '../../src/client/modes/slab-view';
import {
  SLAB_BASE_NAMES, SLAB_DEATH_BACKING, SLAB_HIT, SLAB_HIT_LIFE, SLAB_MARKER_CLEAR, SLAB_MARKER_DIM, SLAB_MARKER_GEOM, SLAB_MARKER_LIFT, SLAB_MARKER_MAX_DODGE,
  SLAB_SAFE, SLAB_WEDGE, SLAB_WEDGE_COLOR, SLAB_WEDGE_PATH, slabHudReset, slabWedgeBox,
  SlabHitCues, SlabHpChip, slabDeathPanel, slabHitSvg, slabHudEvent, slabHudFrame, slabHudState, slabLineFor, slabMarker, slabMarkerPlace,
  slabMarkerShown, slabMarkerSvg, slabPetBoxes, slabPetHeight, slabRespawnZone, slabTeamGlyph, slabTeamGlyphSvg, slabWedgeAngle, slabYouText,
  type ScreenBox, type SlabHudFrame,
} from '../../src/client/ui/slab-hud';

const ms = (p: Partial<MatchState>): MatchState => ({ mode: 'slab', phase: 'live', timeLeft: 180, score: [0, 0], objective: SLAB_TEXT.hold, wave: 0, winner: -1, ...p });
const deg = (r: number) => Math.round((r * 180) / Math.PI);

describe('§1 the slab marker', () => {
  it('two lines, "SLAB  <N> m" (whole metres) and the state word, over a shape that carries the state', () => {
    expect(slabMarker(null, 142.4)).toEqual({ lines: ['SLAB  142 m', 'NEUTRAL'], shape: 'hollow', color: 0xe6ebf2 }); // hud.gd NEUTRAL_COLOR
    expect(slabMarker({ holder: -1, contested: false }, 9.5)).toMatchObject({ lines: ['SLAB  10 m', 'NEUTRAL'], shape: 'hollow' });
    expect(slabMarker({ holder: 0, contested: false }, 30)).toEqual({ lines: ['SLAB  30 m', 'CORGI COMPANY'], shape: 'filled', color: lighten(PALETTE.teamCorgis, 0.35) });
    expect(slabMarker({ holder: 1, contested: false }, 30)).toEqual({ lines: ['SLAB  30 m', 'CAT CADRE'], shape: 'filled', color: lighten(PALETTE.teamCats, 0.35) });
    expect(slabMarker({ holder: -1, contested: true }, 0.2)).toEqual({ lines: ['SLAB  0 m', 'CONTESTED'], shape: 'split', color: 0xffa633 });
    expect(SLAB_MARKER_LIFT).toBe(4.5); // Godot: slab.center + 4.5 m, clear of the pets on it
  });

  it('the three shapes differ in geometry (hud.gd marker_shapes, r 10): an outline, a solid diamond, two halves and a bar', () => {
    const hollow = slabMarkerSvg('hollow'), filled = slabMarkerSvg('filled'), split = slabMarkerSvg('split');
    expect(SLAB_MARKER_GEOM).toEqual({ r: 10, px: [14, 15], gap: 3, splitGap: 3, splitBar: 2, splitReach: 5 });
    expect(hollow).toMatch(/d="M0 -10L10 0L0 10L-10 0Z" fill="none" stroke="currentColor" stroke-width="2.5"/);
    expect(hollow).not.toMatch(/fill="currentColor"/);
    expect(filled).toMatch(/d="M0 -10L10 0L0 10L-10 0Z" fill="currentColor"/);
    // split: the top half to 3 px over the centre, the bottom half from 3 px under it, both filled, and a 2 px bar
    // in the gap reaching 5 px past the side tips (x ±15)
    expect(split).toMatch(/d="M0 -10L7 -3L-7 -3ZM-7 3L7 3L0 10ZM-15 -1L15 -1L15 1L-15 1Z" fill="currentColor"/);
    expect(new Set([hollow, filled, split]).size).toBe(3);
  });

  it("a pet's height: its species' capsule plus head and ears", () => {
    expect(slabPetHeight(0)).toBeCloseTo(1.5, 5); // corgi capsule 1.2 m + head and ears
    expect(slabPetHeight(1)).toBeCloseTo(1.56, 5);
  });
});

describe('§1 the marker on screen (rev. 3: clamp into the safe area, then off the other pets, nothing clamps after)', () => {
  const lines = ['SLAB  142 m', 'CORGI COMPANY'] as const;
  const at = (x: number, y: number, behind = false, pets: ScreenBox[] = []) => slabMarkerPlace({ x, y, behind, w: 1280, h: 720, u: 1, lines, pets });
  const hits = (a: ScreenBox, b: ScreenBox) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const inSafe = (b: ScreenBox) => {
    expect(b.x0).toBeGreaterThanOrEqual(SLAB_SAFE.side - 1e-9);
    expect(b.x1).toBeLessThanOrEqual(1280 - SLAB_SAFE.side + 1e-9);
    expect(b.y0).toBeGreaterThanOrEqual(SLAB_SAFE.top - 1e-9); // below the scores, the timer and the slab line
    expect(b.y1).toBeLessThanOrEqual(720 - SLAB_SAFE.bottom + 1e-9); // clear of the YOU / HP and ammo fields
  };
  // the top fields at 720p (the DOM's CSS): the clock (top 14, 30 px type) and the slab line (top 76, 18 px type)
  const TIMER: ScreenBox = { x0: 585, y0: 14, x1: 695, y1: 48 }, SLAB_LINE: ScreenBox = { x0: 440, y0: 76, x1: 840, y1: 98 };

  it('the safe area: 16 from the sides, 110 from the top, 112 from the bottom; 2 of clearance; at most 120 up', () => {
    expect(SLAB_SAFE).toEqual({ side: 16, top: 110, bottom: 112 });
    expect(SLAB_MARKER_CLEAR).toBe(2);
    expect(SLAB_MARKER_MAX_DODGE).toBe(120);
  });

  it('on screen it sits where the slab is; off screen it clamps into the safe area keeping both lines and the shape', () => {
    expect(at(640, 300)).toMatchObject({ x: 640, y: 300, lift: 0, dodge: 'none' });
    for (const p of [at(5000, 300), at(-900, 300), at(640, -400), at(640, 5000)]) inSafe(p.box);
    expect(at(5000, 300).x).toBeGreaterThan(1100); // it hugs the edge it went off
    // behind the camera: mirrored to the bottom edge of the safe area (hud.gd)
    const back = at(1000, 300, true);
    expect(back.x).toBe(280);
    expect(back.box.y1).toBeCloseTo(720 - SLAB_SAFE.bottom, 6);
  });

  it('(640, 160) with a pet at y 150-250: the clamped anchor cannot lift clear, so it goes under the pet; no overlap', () => {
    const pet: ScreenBox = { x0: 600, y0: 150, x1: 680, y1: 250 };
    const p = at(640, 160, false, [pet]);
    expect(hits(p.box, pet)).toBe(false);
    expect(p.dodge).toBe('below');
    expect(p.box.y0).toBeCloseTo(pet.y1 + SLAB_MARKER_CLEAR, 6); // just under it, 2 of clearance
    inSafe(p.box);
  });

  it("Godot's top case: anchor (640, -300), a pet at (600, 100, 80 x 60): box top >= 110, clear of the pet, the timer and the slab line", () => {
    const pet: ScreenBox = { x0: 600, y0: 100, x1: 680, y1: 160 };
    const p = at(640, -300, false, [pet]);
    expect(p.box.y0).toBeGreaterThanOrEqual(110 - 1e-9);
    expect(hits(p.box, pet)).toBe(false);
    expect(hits(p.box, TIMER)).toBe(false);
    expect(hits(p.box, SLAB_LINE)).toBe(false);
    inSafe(p.box);
    // the old order (dodge, then clamp) put it back on the pet: the clamp must come first
  });

  it('it moves up off a pet under it, 2 clear, by at most 120 and never above the safe top; else it stays put', () => {
    const pet: ScreenBox = { x0: 630, y0: 290, x1: 650, y1: 330 };
    const p = at(640, 320, false, [pet]);
    expect(p.dodge).toBe('lift');
    expect(p.box.y1).toBeCloseTo(pet.y0 - SLAB_MARKER_CLEAR, 6);
    // a pet too tall to clear either way: lifted the full 120 and left there (nothing clamps after)
    const tall = at(640, 320, false, [{ x0: 600, y0: 0, x1: 680, y1: 700 }]);
    expect(tall).toMatchObject({ lift: 120, dodge: 'blocked' });
    inSafe(tall.box);
    // near the top the lift stops at the safe top
    const top = at(640, 200, false, [{ x0: 600, y0: 120, x1: 680, y1: 700 }]);
    expect(top.box.y0).toBeCloseTo(SLAB_SAFE.top, 6);
    expect(top.dodge).toBe('blocked');
    // two pets, one above the other: it climbs over both when it can
    const two = at(640, 400, false, [{ x0: 630, y0: 380, x1: 650, y1: 430 }, { x0: 600, y0: 330, x1: 620, y1: 380 }]);
    expect(two.dodge).toBe('lift');
    expect(two.box.y1).toBeLessThanOrEqual(330 - SLAB_MARKER_CLEAR + 1e-9);
  });

  it('hides while you stand on the slab, while you are down (rev. 2: one distance on screen), and once it is over', () => {
    expect(slabMarkerShown(null, false)).toBe(true);
    expect(slabMarkerShown({ x: -74, y: -2.4, z: -123, flags: 0 }, false)).toBe(true);
    expect(slabMarkerShown({ x: 1, y: 0, z: -2, flags: 0 }, false)).toBe(false); // on the 8 x 8 m slab
    expect(slabMarkerShown({ x: -74, y: -2.4, z: -123, flags: EFlag.Dead }, false)).toBe(false); // down, off the slab
    expect(slabMarkerShown({ x: 1, y: 0, z: -2, flags: EFlag.Dead }, false)).toBe(false); // down on it
    expect(slabMarkerShown({ x: -74, y: -2.4, z: -123, flags: 0 }, true)).toBe(false);
  });
});

describe('§2 the death panel', () => {
  it('the respawn zones: each base by its map name, and the ground distance from its respawn points to the slab', () => {
    const corgis = slabRespawnZone(0), cats = slabRespawnZone(1);
    expect(SLAB_BASE_NAMES).toEqual(['THE FOUNDATION', 'THE SCAFFOLDS']);
    expect(corgis.name).toBe('THE FOUNDATION');
    expect(cats.name).toBe('THE SCAFFOLDS');
    // Corgis: slot 0 (-74, -123) and two points 1.3 m and 2.6 m on toward the slab, so the centre is 1.3 m along
    expect(corgis.dist).toBeCloseTo(Math.hypot(-74, -123) - 1.3, 3);
    expect(Math.round(corgis.dist)).toBe(142);
    // Cats: their three data slots (Godot CAT_SLOTS respawn), (56, 117), (62, 117) and (68, 117): Godot's 132 m
    expect(cats.x).toBeCloseTo(62, 6);
    expect(cats.z).toBeCloseTo(117, 6);
    expect(Math.round(cats.dist)).toBe(132);
  });

  it('four lines with a killer, the killer team glyph (square / triangle), the countdown in tenths', () => {
    const p = slabDeathPanel({ name: 'Cat 2', team: 1 }, 0, slabRespawnZone(0), 2.44);
    expect(p.lines).toEqual([
      'TAKEN DOWN BY Cat 2  ·  CAT CADRE',
      'YOU: CORGI COMPANY',
      'BACK AT THE FOUNDATION  ·  142 m TO THE SLAB',
      'BACK IN 2.4',
    ]);
    expect(p.glyph).toEqual({ shape: 'triangle', team: 1 });
    const q = slabDeathPanel({ name: 'Rex', team: 0 }, 1, slabRespawnZone(1), SLAB.respawn);
    expect(q.lines).toEqual(['TAKEN DOWN BY Rex  ·  CORGI COMPANY', 'YOU: CAT CADRE', 'BACK AT THE SCAFFOLDS  ·  132 m TO THE SLAB', 'BACK IN 3.0']);
    expect(q.glyph).toEqual({ shape: 'square', team: 0 });
  });

  it('no killer (a fall, the map): TAKEN DOWN BY THE LOT, no glyph; the countdown never goes below 0', () => {
    const p = slabDeathPanel(null, 1, slabRespawnZone(1), -0.3);
    expect(p.lines[0]).toBe('TAKEN DOWN BY THE LOT');
    expect(p.lines[3]).toBe('BACK IN 0.0');
    expect(p.glyph).toBeNull();
  });

  it('a dim rounded backing sits behind the four lines (rev. 2): black at alpha 0.55', () => {
    expect(SLAB_DEATH_BACKING).toBe('rgba(0,0,0,0.55)');
  });

  it('the glyphs differ in shape, not only colour', () => {
    expect(slabTeamGlyph(0)).toBe('square');
    expect(slabTeamGlyph(1)).toBe('triangle');
    expect(slabTeamGlyphSvg(0)).toMatch(/^<rect/);
    expect(slabTeamGlyphSvg(1)).toMatch(/^<path d="M0 -7L7.5 6L-7.5 6Z"/);
  });
});

describe('§3 hits', () => {
  it('confirm shapes differ in geometry (hud.gd hit_cue): X 5-10; X + a 4.5 px diamond; X 6-15, 3 wide + an 18 px ring', () => {
    expect(SLAB_HIT.body).toMatchObject({ r0: 5, r1: 10, width: 2.5, diamond: 0, ring: 0 });
    expect(SLAB_HIT.head).toMatchObject({ r0: 5, r1: 10, width: 2.5, diamond: 4.5, ring: 0 });
    expect(SLAB_HIT.kill).toMatchObject({ r0: 6, r1: 15, width: 3, diamond: 0, ring: 9 });
    expect(SLAB_HIT.head.diamond).toBeGreaterThan(0);
    expect(SLAB_HIT.head.ring).toBe(0);
    expect(SLAB_HIT.kill.r1).toBeGreaterThan(SLAB_HIT.body.r1);
    expect(SLAB_HIT.kill.ring * 2).toBe(18);
    expect(SLAB_HIT.head.diamond * 2).toBeGreaterThanOrEqual(2 * 4); // well wider than the crosshair's 4 px centre dot
    expect(SLAB_HIT.head.diamond / Math.SQRT2).toBeLessThan(SLAB_HIT.head.r0); // its edges stay inside the X's inner gap
    expect(SLAB_HIT.kill.width).toBeGreaterThan(SLAB_HIT.body.width);
    const body = slabHitSvg('body'), head = slabHitSvg('head'), kill = slabHitSvg('kill');
    const over = (svg: string) => svg.slice(svg.indexOf('class="over"'));
    for (const s of [body, head, kill]) expect(over(s).match(/<line /g)).toHaveLength(4); // an X of four lines, each
    expect(body).not.toMatch(/class="dia"|<circle/);
    expect(head).toMatch(/class="dia"/);
    expect(head).not.toMatch(/<circle/);
    expect(over(kill)).toMatch(/<circle class="ring" r="9"/);
    expect(kill).not.toMatch(/class="dia"/);
    expect(new Set([body, head, kill]).size).toBe(3);
    // colour is extra: white, yellow, red
    expect([SLAB_HIT.body.color, SLAB_HIT.head.color, SLAB_HIT.kill.color]).toEqual([0xffffff, 0xffd933, 0xff4033]);
  });

  it('your hits confirm (body / head), your knockouts confirm a kill that a hit landing with it does not downgrade', () => {
    const c = new SlabHitCues();
    const hit = (src: number, dst: number, crit = false): GameEvent => ({ e: 'hit', src, dst, dmg: 15, x: 0, y: 0, z: 0, crit });
    c.onEvent(hit(3, 9), 3, 10);
    expect(c.confirmAt(10)).toEqual({ kind: 'body', alpha: 1 });
    expect(c.confirmAt(10.17)!.kind).toBe('body');
    expect(c.confirmAt(10.19)).toBeNull(); // body and head: 0.18 s
    c.onEvent(hit(3, 9, true), 3, 11);
    expect(c.confirmAt(11.05)!.kind).toBe('head');
    expect(c.confirmAt(11.19)).toBeNull();
    c.onEvent({ e: 'death', id: 9, by: 3 }, 3, 12);
    c.onEvent(hit(3, 9), 3, 12.02);
    expect(c.confirmAt(12.05)!.kind).toBe('kill');
    expect(c.confirmAt(12.34)!.kind).toBe('kill'); // a kill: 0.35 s (rev. 2)
    expect(c.confirmAt(12.36)).toBeNull();
    expect(SLAB_HIT_LIFE).toEqual({ body: 0.18, head: 0.18, kill: 0.35 });
    // other pets' hits and your own death are no confirm
    const d = new SlabHitCues();
    d.onEvent(hit(5, 9), 3, 1);
    d.onEvent({ e: 'death', id: 3, by: 5 }, 3, 1);
    expect(d.confirmAt(1)).toBeNull();
  });

  it('a hit on you: a wedge per attacker at where it stood as it hit, fading over 0.6 s; a red flash at alpha <= 0.25', () => {
    const c = new SlabHitCues();
    const shot = (src: number, t: number, from?: { x: number; z: number }) => c.onEvent({ e: 'hit', src, dst: 3, dmg: 15, x: 0, y: 0, z: 0, crit: false }, 3, t, from);
    shot(8, 20, { x: 30, z: 4 });
    expect(c.wedgesAt(20)).toEqual([{ src: 8, x: 30, z: 4, alpha: 1 }]);
    expect(c.wedgesAt(20.3)[0].alpha).toBeCloseTo(0.5, 6);
    expect(c.wedgesAt(20.3)[0]).toMatchObject({ x: 30, z: 4 }); // it holds the point of the hit: it never follows
    expect(c.wedgesAt(20 + SLAB_WEDGE.life)).toEqual([]);
    shot(8, 21, { x: -12, z: 9 }); // a new hit from the same attacker: its new point, full strength again
    expect(c.wedgesAt(21.1)).toEqual([expect.objectContaining({ src: 8, x: -12, z: 9 })]);
    shot(5, 21.2); // an attacker never seen: no wedge (nothing to point at), the flash still comes
    expect(c.wedgesAt(21.2).map((w) => w.src)).toEqual([8]);
    expect(c.flashAt(21.2)).toBeGreaterThan(0);
    expect(SLAB_WEDGE.ring).toBe(110);
    // hud.gd's arrowhead (tip 14 out, base 10 in, 16 wide) in CUE_COLORS.received
    expect(SLAB_WEDGE_PATH).toBe('M0 -14L8 10L-8 10Z');
    expect(SLAB_WEDGE_COLOR).toBe(0xff735c);
    // the flash: hud.gd's _dmg_t * 0.5, peaking at 0.175 and gone 0.35 s after the last hit
    const f = new SlabHitCues();
    f.onEvent({ e: 'hit', src: 8, dst: 3, dmg: 15, x: 0, y: 0, z: 0, crit: false }, 3, 20, { x: 1, z: 1 });
    let peak = 0;
    for (let t = 19.9; t < 21; t += 0.01) peak = Math.max(peak, f.flashAt(t));
    expect(peak).toBeCloseTo(0.175, 6);
    expect(peak).toBeLessThanOrEqual(0.25);
    expect(f.flashAt(20.36)).toBe(0);
  });

  it('the wedge points at the attacker relative to the camera facing: ahead 0, right +90, behind 180, left -90', () => {
    const fwd = { x: 0, z: -1 }; // looking down -z (yaw 0)
    const me = { x: 10, z: 10 };
    expect(deg(slabWedgeAngle(fwd, me, { x: 10, z: -5 }))).toBe(0);
    expect(deg(slabWedgeAngle(fwd, me, { x: 30, z: 10 }))).toBe(90);
    expect(Math.abs(deg(slabWedgeAngle(fwd, me, { x: 10, z: 40 })))).toBe(180);
    expect(deg(slabWedgeAngle(fwd, me, { x: -5, z: 10 }))).toBe(-90);
    // the camera turned to face +x: an attacker at +x is now ahead
    expect(deg(slabWedgeAngle({ x: 1, z: 0 }, me, { x: 30, z: 10 }))).toBe(0);
  });

  it('the HP chip: the HP just lost shows white over the fill and drains to it over 0.4 s; a heal or a respawn clears it', () => {
    const chip = new SlabHpChip();
    expect(chip.update(120, 0)).toBe(120);
    expect(chip.update(100, 1)).toBe(120); // just hit: the chip spans 100..120
    expect(chip.update(100, 1.2)).toBeCloseTo(110, 6);
    expect(chip.update(100, 1.4)).toBe(100); // drained
    // two hits in a row: the chip keeps the top it had drained to (95 after 0.1 s of 100..80) and drains from there
    expect(chip.update(80, 2)).toBe(100);
    expect(chip.update(70, 2.1)).toBeCloseTo(95, 6);
    expect(chip.update(70, 2.5)).toBe(70);
    expect(chip.update(120, 3)).toBe(120); // respawned at full health
    // rev. 2: the chip follows the hit points, so a takedown with no hit event (a fall) drains too, and never sticks
    expect(chip.update(0, 4)).toBe(120);
    expect(chip.update(0, 4.2)).toBeCloseTo(60, 6);
    expect(chip.update(0, 4.41)).toBe(0);
  });
});

describe('§4 fields', () => {
  it('YOU: <TEAM> over the HP bar', () => {
    expect(slabYouText(0)).toBe('YOU: CORGI COMPANY');
    expect(slabYouText(1)).toBe('YOU: CAT CADRE');
  });

  it('the slab line is hidden once the match is won (and on a draw), shown while it runs', () => {
    const held = { holder: 1 as const, contested: false };
    expect(slabLineFor(ms({}), held)).toBe('SLAB  CAT CADRE HOLDING  +1/s');
    expect(slabLineFor(ms({ phase: 'ended', winner: 1, score: [12, 60], objective: SLAB_TEXT.win[1] }), held)).toBeNull();
    expect(slabLineFor(ms({ phase: 'ended', winner: -1, objective: SLAB_TEXT.draw }), { holder: -1, contested: true })).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ the frame model

const W = 1280, H = 720;
const camAt = (x: number, y: number, z: number, lx: number, ly: number, lz: number) => {
  const c = new PerspectiveCamera(60, W / H, 0.1, 2000);
  c.position.set(x, y, z);
  c.lookAt(lx, ly, lz);
  c.updateMatrixWorld(true);
  return c;
};
const pet = (id: number, team: 0 | 1, x: number, y: number, z: number): SlabPet => ({ id, team, species: team, x, y, z });
const reading = (pets: SlabPet[], p: Partial<SlabReading> = {}): SlabReading => ({ id: 50, x: SLAB.center.x, y: SLAB.center.y, z: SLAB.center.z, holder: -1, contested: false, pets, ...p });
const me = (p: Partial<EntityState> = {}): EntityState => ({ id: 1, kind: EntityKind.Player, team: 0, species: 0, x: 0, y: 0, z: 25, hp: 120, maxHp: 120, flags: 0, ammo: 30, ...p }) as EntityState;
const frame = (p: Partial<SlabHudFrame> & { local: EntityState | null }): SlabHudFrame & { w: number; h: number } => ({
  match: ms({}), slab: reading([]), localId: 1, roster: [], camera: camAt(0, 3, 30, 0, 0, 0), w: W, h: H, ...p,
});
const hitOn = (src: number, dst: number): GameEvent => ({ e: 'hit', src, dst, dmg: 25, x: 0, y: 0, z: 0, crit: false });
const roster = (entity: number, name: string, team: 0 | 1): RosterEntry => ({ pid: `p${entity}`, name, team, cls: 'assault', entity, bot: true, kills: 0, deaths: 0, score: 0, ping: 0 });

describe('§1 the other pets: slabPetBoxes skips your own', () => {
  it('your own pet never pushes the marker; another pet does; a pet behind the camera covers nothing', () => {
    const cam = camAt(0, 3, 12, 0, 1, 0);
    const pets = [pet(1, 0, 0, 0, 0), pet(2, 1, 2, 0, 0), pet(3, 1, 0, 0, 40)];
    const all = slabPetBoxes(pets, -1, cam, W, H);
    expect(all).toHaveLength(2); // pet 3 is behind the camera
    expect(slabPetBoxes(pets, 1, cam, W, H)).toEqual([all[1]]);
    expect(slabPetBoxes(pets, 2, cam, W, H)).toEqual([all[0]]);
  });

  it("your own pet right under the anchor: the marker stays on the anchor; the same pet as someone else's moves it", () => {
    // the camera looks straight at the anchor (slab centre + 4.5 m) past a pet floating in the way
    const cam = camAt(0, SLAB.center.y + SLAB_MARKER_LIFT, 30, 0, SLAB.center.y + SLAB_MARKER_LIFT, 0);
    const slab = reading([pet(1, 0, 0, SLAB.center.y + 3.6, 22)]);
    const local = me({ x: 0, y: SLAB.center.y + 3.6, z: 22 });
    const mine = slabHudFrame(frame({ camera: cam, slab, local, localId: 1 }), slabHudState(), 0).marker!;
    expect(mine.dodge).toBe('none');
    expect(mine.x).toBeCloseTo(W / 2, 3);
    expect(mine.y).toBeCloseTo(H / 2, 3);
    const theirs = slabHudFrame(frame({ camera: cam, slab, local: me({ id: 9, x: 0, z: 26 }), localId: 9 }), slabHudState(), 0).marker!;
    expect(theirs.dodge).not.toBe('none');
  });
});

describe('slabHudFrame: what the DOM writes, decided headless', () => {
  it("M18: the marker's distance is the CAMERA's ground distance to the slab centre, not the player's", () => {
    const o = slabHudFrame(frame({ camera: camAt(0, 6, 40, 0, 0, 0), local: me({ x: 10, z: 30 }) }), slabHudState(), 0);
    expect(o.marker!.dist).toBeCloseTo(Math.hypot(0 - SLAB.center.x, 40 - SLAB.center.z), 6);
    expect(o.marker!.lines).toEqual(['SLAB  40 m', 'NEUTRAL']); // the player stands 32 m off
    expect(o.marker!.box.y0).toBeGreaterThanOrEqual(SLAB_SAFE.top - 1e-9);
  });

  it('M16: a wedge points where the attacker stood AT ITS HIT, from you, against the camera; it never follows the attacker', () => {
    const s = slabHudState();
    const cam = camAt(0, 3, 30, 0, 0, 0); // facing -z
    const local = me({ x: 0, z: 25 });
    slabHudFrame(frame({ camera: cam, local, slab: reading([pet(1, 0, 0, 0, 25), pet(7, 1, 0, 0, -20)]) }), s, 0); // 7 ahead
    slabHudEvent(s, hitOn(7, 1), 0.01);
    // the attacker then runs to your right: the wedge still points ahead, where the shot came from
    const o = slabHudFrame(frame({ camera: cam, local, slab: reading([pet(1, 0, 0, 0, 25), pet(7, 1, 30, 0, 25)]) }), s, 0.1);
    expect(o.wedges).toHaveLength(1);
    expect(deg(o.wedges[0].angle)).toBe(0);
    expect(o.wedges[0].alpha).toBeCloseTo(1 - 0.09 / SLAB_WEDGE.life, 6);
    // the camera turning turns it: facing +x, that point is now on your left
    const o2 = slabHudFrame(frame({ camera: camAt(-5, 3, 25, 10, 0, 25), local, slab: reading([pet(7, 1, 30, 0, 25)]) }), s, 0.12);
    expect(deg(o2.wedges[0].angle)).toBe(-90);
  });

  it('M17 + M19: down while the match runs: the death panel, with who took you down, your team, your base and the countdown', () => {
    const s = slabHudState();
    const slab = reading([pet(7, 1, 0, 0, -20)]);
    const roster_ = [roster(7, 'Whiskers', 1)];
    slabHudFrame(frame({ local: me(), slab, roster: roster_ }), s, 10);
    slabHudEvent(s, { e: 'death', id: 1, by: 7 }, 10.5);
    const down = me({ hp: 0, flags: EFlag.Dead });
    const o = slabHudFrame(frame({ local: down, slab, roster: roster_ }), s, 10.5);
    expect(o.death).not.toBeNull();
    expect(o.death!.lines).toEqual([
      'TAKEN DOWN BY Whiskers  ·  CAT CADRE',
      'YOU: CORGI COMPANY',
      'BACK AT THE FOUNDATION  ·  142 m TO THE SLAB',
      'BACK IN 3.0',
    ]);
    expect(o.death!.glyph).toEqual({ shape: 'triangle', team: 1 });
    expect(o.marker).toBeNull(); // one distance on screen
    expect(slabHudFrame(frame({ local: down, slab, roster: roster_ }), s, 11.5).death!.lines[3]).toBe('BACK IN 2.0');
    // a killer the roster does not name yet: the pet's team and a plain name
    const t = slabHudState();
    slabHudFrame(frame({ local: me({ team: 1, species: 1 }), slab: reading([pet(4, 0, 0, 0, -20)]) }), t, 0);
    slabHudEvent(t, { e: 'death', id: 1, by: 4 }, 0.1);
    const o2 = slabHudFrame(frame({ local: me({ team: 1, species: 1, hp: 0, flags: EFlag.Dead }), slab: reading([pet(4, 0, 0, 0, -20)]) }), t, 0.2);
    expect(o2.death!.lines.slice(0, 3)).toEqual(['TAKEN DOWN BY Pup 4  ·  CORGI COMPANY', 'YOU: CAT CADRE', 'BACK AT THE SCAFFOLDS  ·  132 m TO THE SLAB']);
    expect(o2.death!.glyph).toEqual({ shape: 'square', team: 0 });
    // a fall (no killer): THE LOT
    const f = slabHudState();
    slabHudEvent(f, { e: 'death', id: 1, by: -1 }, 0);
    expect(slabHudFrame(frame({ local: me({ hp: 0, flags: EFlag.Dead }) }), f, 0).death!.lines[0]).toBe('TAKEN DOWN BY THE LOT');
    // not down, or the match over: no panel
    expect(slabHudFrame(frame({ local: me() }), slabHudState(), 0).death).toBeNull();
    expect(slabHudFrame(frame({ local: down, match: ms({ phase: 'ended', winner: 1, objective: SLAB_TEXT.win[1] }) }), slabHudState(), 0).death).toBeNull();
  });

  it('M20: the HP chip follows your HP: a hit leaves the lost HP showing, draining over 0.4 s', () => {
    const s = slabHudState();
    expect(slabHudFrame(frame({ local: me({ hp: 120 }) }), s, 0).chipTop).toBe(120);
    expect(slabHudFrame(frame({ local: me({ hp: 95 }) }), s, 0.1).chipTop).toBe(120);
    expect(slabHudFrame(frame({ local: me({ hp: 95 }) }), s, 0.3)).toMatchObject({ chipTop: 107.5 });
    expect(slabHudFrame(frame({ local: me({ hp: 95 }) }), s, 0.5).chipTop).toBe(95);
    expect(slabHudFrame(frame({ local: null }), s, 0.6).chipTop).toBeNull();
  });

  it('down: no confirm and no wedges; your knockout clears the wedges, so none come back with you', () => {
    const s = slabHudState();
    const slab = reading([pet(1, 0, 0, 0, 25), pet(7, 1, 0, 0, -20)]);
    slabHudFrame(frame({ local: me(), slab }), s, 1);
    slabHudEvent(s, hitOn(1, 7), 1); // your shot lands
    slabHudEvent(s, hitOn(7, 1), 1); // and theirs
    const up = slabHudFrame(frame({ local: me({ hp: 95 }), slab }), s, 1.02);
    expect(up.confirm).toMatchObject({ kind: 'body' });
    expect(up.wedges).toHaveLength(1);
    // the snapshot shows you down before the knockout event: both gone already
    const dead = slabHudFrame(frame({ local: me({ hp: 0, flags: EFlag.Dead }), slab }), s, 1.05);
    expect(dead.confirm).toBeNull();
    expect(dead.wedges).toEqual([]);
    slabHudEvent(s, { e: 'death', id: 1, by: 7 }, 1.06);
    expect(s.hits.wedges.size).toBe(0);
    // back up within the cues' lifetimes: nothing from before the knockout
    const back = slabHudFrame(frame({ local: me(), slab }), s, 1.1);
    expect(back.confirm).toBeNull();
    expect(back.wedges).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ Sprint C (contract rev. 4)

describe('§1 rev. 4: placement below stacked pets, at any scale, behind the camera', () => {
  const lines = ['SLAB  142 m', 'CORGI COMPANY'] as const;
  const hits = (a: ScreenBox, b: ScreenBox) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const at = (x: number, y: number, pets: ScreenBox[], w = 1280, h = 720, u = 1, behind = false) => slabMarkerPlace({ x, y, behind, w, h, u, lines, pets });

  it('step 3 goes on down past a second pet stacked under the first, while the box stays in the safe area', () => {
    const a: ScreenBox = { x0: 600, y0: 150, x1: 680, y1: 250 }, b: ScreenBox = { x0: 600, y0: 260, x1: 680, y1: 330 };
    const p = at(640, 160, [a, b]);
    expect(p.dodge).toBe('below');
    expect(p.box.y0).toBeCloseTo(b.y1 + SLAB_MARKER_CLEAR, 6); // under the second pet, 2 clear
    expect(hits(p.box, a) || hits(p.box, b)).toBe(false);
    // a stack down to the bottom edge: nothing clears, so it stays where step 2 left it (inside the safe area)
    const wall = [a, b, { x0: 600, y0: 335, x1: 680, y1: 470 }, { x0: 600, y0: 475, x1: 680, y1: 700 }];
    const q = at(640, 160, wall);
    expect(q.dodge).toBe('blocked');
    expect(q.box.y0).toBeCloseTo(SLAB_SAFE.top, 6);
  });

  it('u = 1.5 (1920 x 1080): the cap, the clearance and the safe area all scale with the screen', () => {
    const W = 1920, H = 1080, U = 1.5;
    // the 120 cap is 180 px
    expect(at(960, 600, [{ x0: 900, y0: 0, x1: 1020, y1: 1050 }], W, H, U)).toMatchObject({ lift: 180, dodge: 'blocked' });
    // the 2 px clearance is 3 px
    const pet: ScreenBox = { x0: 940, y0: 500, x1: 980, y1: 560 };
    const p = at(960, 540, [pet], W, H, U);
    expect(p.dodge).toBe('lift');
    expect(p.box.y1).toBeCloseTo(pet.y0 - 3, 6);
    // the safe area: 165 from the top, 24 from the sides, 168 from the bottom
    expect(at(960, -500, [], W, H, U).box.y0).toBeCloseTo(165, 6);
    expect(at(5000, 540, [], W, H, U).box.x1).toBeCloseTo(W - 24, 6);
    expect(at(-5000, 540, [], W, H, U).box.x0).toBeCloseTo(24, 6);
    expect(at(960, 5000, [], W, H, U).box.y1).toBeCloseTo(H - 168, 6);
  });

  it('behind the camera it sits on the bottom edge toward the slab and still keeps off a pet there', () => {
    const cam = camAt(0, 3, 30, 0, 3, 40); // facing +z: the slab (at the origin) is behind
    const local = me({ x: 4, z: 26 });
    const ahead = pet(2, 1, 0, 0, 36);
    const alone = slabHudFrame(frame({ camera: cam, local, slab: reading([]) }), slabHudState(), 0).marker!;
    expect(alone.dodge).toBe('none');
    expect(alone.box.y1).toBeCloseTo(H - SLAB_SAFE.bottom, 6); // on the bottom edge of the safe area
    const box = slabPetBoxes([ahead], 1, cam, W, H)[0];
    expect(hits(alone.box, box)).toBe(true); // the pet stands where the marker would go
    const m = slabHudFrame(frame({ camera: cam, local, slab: reading([ahead]) }), slabHudState(), 0).marker!;
    expect(m.dodge).not.toBe('none');
    expect(hits(m.box, box)).toBe(false);
  });
});

describe('§3 rev. 4: the marker dims while a wedge overlaps it', () => {
  const hits = (a: ScreenBox, b: ScreenBox) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  it('a wedge box is its arrowhead on the 110 px ring, turned with it', () => {
    expect(slabWedgeBox(640, 360, 0, 1)).toEqual({ x0: 632, y0: 360 - 124, x1: 648, y1: 360 - 100 });
    const r = slabWedgeBox(640, 360, Math.PI / 2, 1);
    expect(r.x0).toBeCloseTo(740, 6); expect(r.x1).toBeCloseTo(764, 6); expect(r.y0).toBeCloseTo(352, 6); expect(r.y1).toBeCloseTo(368, 6);
    expect(slabWedgeBox(960, 540, 0, 1.5)).toEqual({ x0: 948, y0: 540 - 186, x1: 972, y1: 540 - 150 });
  });

  it('a hit from the slab straight ahead puts the wedge on the marker: the marker draws at 0.35; from the side it does not', () => {
    // the anchor sits about 110 px over the crosshair, as from the Corgi spawn with the slab ahead
    const top = SLAB.center.y + SLAB_MARKER_LIFT;
    const cam = camAt(0, top, 40, 0, top - 40 * Math.tan((10 * Math.PI) / 180), 0);
    const local = me({ x: 0, z: 36 });
    const run = (fromX: number, fromZ: number) => {
      const s = slabHudState();
      const slab = reading([pet(7, 1, fromX, 0, fromZ)]);
      slabHudFrame(frame({ camera: cam, local, slab }), s, 0);
      slabHudEvent(s, hitOn(7, 1), 0.01);
      return slabHudFrame(frame({ camera: cam, local, slab }), s, 0.05);
    };
    const ahead = run(0, 0);
    expect(ahead.wedges).toHaveLength(1);
    expect(hits(slabWedgeBox(W / 2, H / 2, ahead.wedges[0].angle, 1), ahead.marker!.box)).toBe(true);
    expect(ahead.marker!.alpha).toBe(SLAB_MARKER_DIM);
    expect(SLAB_MARKER_DIM).toBe(0.35);
    const side = run(40, 36);
    expect(side.wedges).toHaveLength(1);
    expect(side.marker!.alpha).toBe(1);
    // the wedge fades out: the marker comes back
    const s = slabHudState();
    const slab = reading([pet(7, 1, 0, 0, 0)]);
    slabHudFrame(frame({ camera: cam, local, slab }), s, 0);
    slabHudEvent(s, hitOn(7, 1), 0.01);
    expect(slabHudFrame(frame({ camera: cam, local, slab }), s, 0.01 + SLAB_WEDGE.life + 0.01).marker!.alpha).toBe(1);
  });
});

describe('§2: the death panel survives a late first dead frame', () => {
  it('the knockout event 2 s before the first frame showing you down still names the killer and counts from the event', () => {
    const s = slabHudState();
    const slab = reading([pet(7, 1, 0, 0, -20)]);
    const roster_ = [roster(7, 'Whiskers', 1)];
    slabHudFrame(frame({ local: me(), slab, roster: roster_ }), s, 5); // up
    slabHudEvent(s, { e: 'death', id: 1, by: 7 }, 10); // the knockout
    const o = slabHudFrame(frame({ local: me({ hp: 0, flags: EFlag.Dead }), slab, roster: roster_ }), s, 12); // 2 s later
    expect(o.death!.lines[0]).toBe('TAKEN DOWN BY Whiskers  ·  CAT CADRE');
    expect(o.death!.lines[3]).toBe('BACK IN 1.0');
    // an older knockout's record (before you were last up) is not this one's: THE LOT, counted from the frame
    const t = slabHudState();
    slabHudEvent(t, { e: 'death', id: 1, by: 7 }, 1);
    slabHudFrame(frame({ local: me(), slab, roster: roster_ }), t, 5); // up again since
    const p = slabHudFrame(frame({ local: me({ hp: 0, flags: EFlag.Dead }), slab, roster: roster_ }), t, 9);
    expect(p.death!.lines[0]).toBe('TAKEN DOWN BY THE LOT');
    expect(p.death!.lines[3]).toBe('BACK IN 3.0');
  });
});

describe('§5 the rematch clears every HUD cue', () => {
  const ended = ms({ phase: 'ended', winner: 1, score: [12, 60], objective: SLAB_TEXT.win[1] });
  const fresh = ms({ score: [0, 0] });
  const slab = reading([pet(1, 0, 0, 0, 25), pet(7, 1, 0, 0, -20)]);
  const none = (o: ReturnType<typeof slabHudFrame>, hp: number) => {
    expect(o.confirm).toBeNull();
    expect(o.wedges).toEqual([]);
    expect(o.flash).toBe(0);
    expect(o.chipTop).toBe(hp);
    expect(o.death).toBeNull();
  };

  it('mid-cue: a kill confirm, a wedge, the flash and the chip all showing when the match ends and restarts', () => {
    const s = slabHudState();
    slabHudFrame(frame({ local: me(), slab }), s, 1);
    slabHudEvent(s, { e: 'death', id: 7, by: 1 }, 1); // your knockout of the Cat: a kill confirm, 0.35 s
    slabHudEvent(s, hitOn(7, 1), 1); // and its last hit on you: a wedge, the flash
    const live = slabHudFrame(frame({ local: me({ hp: 95 }), slab }), s, 1.02);
    expect(live.confirm).toMatchObject({ kind: 'kill' });
    expect(live.wedges).toHaveLength(1);
    expect(live.flash).toBeGreaterThan(0);
    expect(live.chipTop).toBe(120);
    slabHudFrame(frame({ match: ended, local: me({ hp: 95 }), slab }), s, 1.04); // the winner screen
    const after = slabHudFrame(frame({ match: fresh, local: me({ hp: 95 }), slab }), s, 1.06); // rematched within 0.04 s
    none(after, 95);
    expect(s.hits.wedges.size).toBe(0);
  });

  it('mid-death: the panel and its countdown, then the reset event with a stale dead frame, then up: no leftovers', () => {
    const s = slabHudState();
    const roster_ = [roster(7, 'Whiskers', 1)];
    slabHudFrame(frame({ local: me(), slab, roster: roster_ }), s, 1);
    slabHudEvent(s, hitOn(7, 1), 1.0);
    slabHudEvent(s, { e: 'death', id: 1, by: 7 }, 1.0);
    const down = slabHudFrame(frame({ local: me({ hp: 0, flags: EFlag.Dead }), slab, roster: roster_ }), s, 1.1);
    expect(down.death!.lines[0]).toBe('TAKEN DOWN BY Whiskers  ·  CAT CADRE');
    expect(down.chipTop).toBe(120); // the chip of the lost 120
    slabHudEvent(s, { e: 'score', team: 0, pts: 0, reason: 'reset' }, 1.15); // the rematch (match.ts restart)
    slabHudEvent(s, { e: 'score', team: 1, pts: 0, reason: 'reset' }, 1.15);
    // the next frame still interpolates the old dead state: no panel, no countdown
    none(slabHudFrame(frame({ match: fresh, local: me({ hp: 0, flags: EFlag.Dead }), slab, roster: roster_ }), s, 1.16), 0);
    none(slabHudFrame(frame({ match: fresh, local: me(), slab, roster: roster_ }), s, 1.2), 120);
    expect(s.deaths.size).toBe(0);
    // and the HUD works on: the next knockout shows its panel
    slabHudEvent(s, { e: 'death', id: 1, by: 7 }, 5);
    expect(slabHudFrame(frame({ match: fresh, local: me({ hp: 0, flags: EFlag.Dead }), slab, roster: roster_ }), s, 5.1).death!.lines[3]).toBe('BACK IN 2.9');
  });
});
