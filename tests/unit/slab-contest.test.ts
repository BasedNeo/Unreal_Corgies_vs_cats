// W17 TW-SIM: the contest stays 1 m inside the edge on the web twin, as Godot's tests/test_bot_contest.gd (G-BOT W15
// CONTEST GUARD) checks for bot.gd. The ported rules (src/sim/ai/brain.ts: holdInside, and the slab places in think's
// engage): on the slab a bot's wish may not carry it past the square SLAB_MARGIN (1 m) inside every edge within
// EDGE_LOOK (1.2 m); within CONTEST_ZONE (6 m) of the square a fighting bot steps in (strafe 0.4, no back-off).
// 1. Godot's scenario: the four bots of a bots-only 2v2 stand on the slab, two per side, and fight there for 20 s of game
//    time, everyone kept unhurt (Godot sets `shield = 1.0` every frame; here the same spawn-shield field, invulnUntil),
//    the match kept running. Over every tick a bot is on the slab (onSlab: the square and its feet window), the share it
//    spends in the edge band (inside the score volume but less than 1 m from an edge) must stay at or under 5 %, and
//    the bots must stay on the slab at least 95 % of their time: 76 of the 80 pet-s.
// 2. The step-in (the web's own case: in scenario 1 the cut keeps every bot on the slab, so no bot is ever off it and
//    within the zone, and that scenario cannot see the step-in; docs/qa/w17/WEB-CONTEST.md): the Cats start 4 m off
//    their edge, inside the zone, the Corgis on the slab. Every tick a Cat fights from there (off the slab, within
//    CONTEST_ZONE, an enemy in sight), its wish is within asin(0.4) of its way to its slab spot (the 0.4 strafe; a 0.8
//    strafe reaches 53 deg, a back-off more), it is on the slab within 1.5 s, and the 20 s budgets of scenario 1 hold.
// 3. Two checks on every tick of every case, from the bot's own input (the wish it sent):
//    - Godot's on-slab mix: fighting well inside the inner square (no cut can apply) with no teammate in separation
//      range, the wish is normalize(0.7 * to its spot + 0.8 * strafe), within 1 deg.
//    - The final cut: a bot inside the inner square never sends a wish that carries it past that square within
//      EDGE_LOOK. That includes what teammate separation adds after holdSlab. Case 3 crowds the two Corgis on their
//      inner line, 0.35 m apart, so that push happens.
// Deterministic: the sim's seeded RNG, fixed seeds.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { EntityKind, Team, type TeamId } from '../../src/shared/types';
import { SLAB, onSlab } from '../../src/shared/content/modes';
import { yawToward } from '../../src/shared/world/queries';
import { CONTEST_ZONE, EDGE_LOOK, SLAB_MARGIN, resetBrain } from '../../src/sim/ai/brain';
import { TICK_HZ } from '../../src/shared/constants';

const HOLD_S = 20;
const MAX_BAND = 0.05;
const MIN_ON = 0.95; // of the pets' time: 76 of 80 pet-s
const EDGE = 1.0;    // the band's width (Godot test_bot_contest.gd EDGE = bot.gd SLAB_MARGIN)
const ZONE = 6.0;    // where case 2 checks the step-in: Godot bot.gd CONTEST_ZONE, a literal (the first test pins the port's)
type Spot = [number, number];
/** Godot PLACES: where the bots stand when the fight starts, from the slab's centre (x, z): Corgis on one side, Cats on the other. */
const PLACES: Spot[][] = [[[-2, -2.5], [2, -2.5]], [[-2, 2.5], [2, 2.5]]];
/** Case 2: the Cats 4 m off their edge (the slab's half-size is 4 m), inside CONTEST_ZONE. */
const OFF = 4;
const OUTSIDE: Spot[][] = [PLACES[0], [[-2, SLAB.size.z / 2 + OFF], [2, SLAB.size.z / 2 + OFF]]];
const SEEDS = [1, 2, 3];
/** The step-in's heading: the way to the spot plus a 0.4 strafe (unit, across the line to the target) is at most
 *  asin(0.4) = 23.6 deg off that way; + 1 deg of slack. A 0.8 strafe reaches asin(0.8) = 53.1 deg, a back-off more. */
const STEP_IN_DEG = (Math.asin(0.4) * 180) / Math.PI + 1;
const DT = 1 / TICK_HZ;

/** Case 3: both Corgis on their inner line, 0.35 m apart along z, so teammate separation pushes the outer one out. */
const CROWD: Spot[][] = [[[0, -2.95], [0, -2.6]], PLACES[1]];

interface Out {
  on: number; band: number; share: number; per: string[]; first: number[]; checked: number; worst: number;
  /** On-slab fight ticks checked against Godot's mix (0.7 to the spot, 0.8 strafe), and the worst miss (deg). */
  mixChecked: number; mixWorst: number;
  /** Ticks a bot inside the inner square was checked for the final cut; the worst overshoot past it (m); and the
   *  ticks a teammate within separation range (1.1 m) stood outward of it within 0.5 m of the line. */
  holdChecked: number; holdWorst: number; crowded: number;
}

/** Put a pet on the ground at (dx, dz) from the slab's centre facing the centre (Godot `p.respawn(pos, _yaw_to(pos, c))`). */
function stand(sim: Sim, e: SimEntity, [dx, dz]: Spot): void {
  const x = SLAB.center.x + dx, z = SLAB.center.z + dz;
  sim.placeCharacter(e, x, sim.worldData.height(x, z) + 0.05, z);
  e.yaw = yawToward(x, z, SLAB.center.x, SLAB.center.z); e.pitch = 0;
  e.input = { ...e.input, yaw: e.yaw, pitch: 0 };
  resetBrain(e); // a fresh brain where it stands (Godot respawn() resets the bot)
}

/** Horizontal distance to the slab's square (0 on it). */
function offSquare(x: number, z: number): number {
  return Math.hypot(Math.max(0, Math.abs(x - SLAB.center.x) - SLAB.size.x / 2), Math.max(0, Math.abs(z - SLAB.center.z) - SLAB.size.z / 2));
}

/** A bots-only 2v2 on The Lot, the four bots placed at `places` (per team, in slot order), unhurt, for HOLD_S s. */
async function contest(seed: number, places: Spot[][]): Promise<Out> {
  const sim = await Sim.create({ seed, map: 'the_lot' });
  sim.state.matchConfig = { slab: { winScore: 1e9, timeLimit: 1e9 } }; // the match never ends (Godot resets score and clock)
  const room = new Room(sim, { mode: 'slab', botsPerTeam: [2, 2] });
  room.tick(); // the match starts: everyone on a start slot with a fresh brain
  const team = (t: TeamId) => [...sim.entities.values()].filter((e) => e.char && e.team === t).sort((a, b) => (a.data.slabSlot as number) - (b.data.slabSlot as number));
  const all = [...team(Team.Corgis), ...team(Team.Cats)];
  expect(all.map((e) => [e.kind, e.team])).toEqual([[EntityKind.Bot, Team.Corgis], [EntityKind.Bot, Team.Corgis], [EntityKind.Bot, Team.Cats], [EntityKind.Bot, Team.Cats]]);
  all.forEach((e, i) => stand(sim, e, places[e.team][i % 2]));
  const h = { x: SLAB.size.x / 2, z: SLAB.size.z / 2 }, c = SLAB.center;
  const per = all.map(() => [0, 0]), first = all.map(() => -1), was = all.map(() => ({ x: 0, y: 0, z: 0 }));
  let on = 0, band = 0, checked = 0, worst = 0, mixChecked = 0, mixWorst = 0, holdChecked = 0, holdWorst = 0, crowded = 0;
  const hi = { x: h.x - SLAB_MARGIN, z: h.z - SLAB_MARGIN }; // the inner square's half-size
  const dt = DT;
  for (let t = 0; t < HOLD_S * TICK_HZ; t++) {
    all.forEach((e, i) => { e.combat!.invulnUntil = sim.tick + 2; was[i] = { ...e.pos }; }); // unhurt: the fight goes on
    room.tick();
    all.forEach((e, i) => {
      // the step-in: the brain thought from where the bot stood before this tick's move (AI order 100, movement 200)
      const p = was[i], ai = e.ai!;
      const tgt = ai.target >= 0 ? sim.entities.get(ai.target) : undefined;
      if (!e.dead && ai.mode === 'engage' && ai.visible && tgt && !tgt.dead && !onSlab(p.x, p.y, p.z) && offSquare(p.x, p.z) <= ZONE) {
        const sy = Math.sin(e.input.yaw), cy = Math.cos(e.input.yaw);
        const wx = -e.input.mz * sy + e.input.mx * cy, wz = -e.input.mz * cy - e.input.mx * sy; // the wish in the world
        // where it heads: the nav path's current corner (steerOn), else the spot itself
        const k = ai.path.length ? ai.pathIdx * 2 : -1;
        const gx = (k >= 0 ? ai.path[k] : ai.tac.gx) - p.x, gz = (k >= 0 ? ai.path[k + 1] : ai.tac.gz) - p.z;
        const wl = Math.hypot(wx, wz), gl = Math.hypot(gx, gz);
        if (wl > 0.5 && gl > 0.6) {
          checked++;
          worst = Math.max(worst, (Math.acos(Math.max(-1, Math.min(1, (wx * gx + wz * gz) / (wl * gl)))) * 180) / Math.PI);
        }
      }
      // the final cut: a bot on the slab and inside its inner square ends its think with a wish that does not carry it past
      // that square within EDGE_LOOK, whatever moved the wish after holdSlab (teammate separation, a detour)
      const rx = p.x - c.x, rz = p.z - c.z;
      if (!e.dead && onSlab(p.x, p.y, p.z) && Math.abs(rx) <= hi.x && Math.abs(rz) <= hi.z) {
        const sy = Math.sin(e.input.yaw), cy = Math.cos(e.input.yaw);
        const wx = -e.input.mz * sy + e.input.mx * cy, wz = -e.input.mz * cy - e.input.mx * sy;
        holdChecked++;
        holdWorst = Math.max(holdWorst, Math.abs(rx + wx * EDGE_LOOK) - hi.x, Math.abs(rz + wz * EDGE_LOOK) - hi.z);
        all.forEach((m, j) => {
          if (j === i || m.team !== e.team || m.dead) return;
          const q = was[j], d = Math.hypot(p.x - q.x, p.z - q.z);
          if (d < 1.1 && d > 1e-3 && Math.min(hi.x - Math.abs(rx), hi.z - Math.abs(rz)) < 0.5 && Math.hypot(rx, rz) > Math.hypot(q.x - c.x, q.z - c.z)) crowded++;
        });
      }
      // Godot's on-slab mix: well inside the inner square (no cut can apply), no teammate in separation range, fighting a
      // target in sight: the wish is normalize(0.7 * to its spot + 0.8 * strafe across the line to the target)
      const tm = all.find((m) => m !== e && m.team === e.team && !m.dead);
      const sep = tm ? Math.hypot(p.x - was[all.indexOf(tm)].x, p.z - was[all.indexOf(tm)].z) < 1.2 : false;
      if (!e.dead && tgt && !tgt.dead && ai.mode === 'engage' && ai.visible && onSlab(p.x, p.y, p.z) && !sep
        && Math.abs(rx) < hi.x - EDGE_LOOK - 0.01 && Math.abs(rz) < hi.z - EDGE_LOOK - 0.01 && sim.tick >= ai.detourUntil) {
        const q = was[all.indexOf(tgt)];
        const sy = Math.sin(e.input.yaw), cy = Math.cos(e.input.yaw);
        const wx = -e.input.mz * sy + e.input.mx * cy, wz = -e.input.mz * cy - e.input.mx * sy;
        const ux0 = q.x - p.x, uz0 = q.z - p.z, ul = Math.hypot(ux0, uz0) || 1e-3, ux = ux0 / ul, uz = uz0 / ul;
        const gx0 = ai.tac.gx - p.x, gz0 = ai.tac.gz - p.z, gl = Math.hypot(gx0, gz0);
        const gx = gl > 0.3 ? gx0 / gl : 0, gz = gl > 0.3 ? gz0 / gl : 0;
        const mx = gx * 0.7 - uz * ai.strafeDir * 0.8, mz = gz * 0.7 + ux * ai.strafeDir * 0.8, ml = Math.hypot(mx, mz);
        const wl = Math.hypot(wx, wz);
        if (wl > 0.5 && ml > 1e-3) {
          mixChecked++;
          mixWorst = Math.max(mixWorst, (Math.acos(Math.max(-1, Math.min(1, (wx * mx + wz * mz) / (wl * ml)))) * 180) / Math.PI);
        }
      }
      if (e.dead || !onSlab(e.pos.x, e.pos.y, e.pos.z)) return;
      if (first[i] < 0) first[i] = (t + 1) * dt;
      on += dt; per[i][0] += dt;
      if (Math.abs(e.pos.x - c.x) > h.x - EDGE || Math.abs(e.pos.z - c.z) > h.z - EDGE) { band += dt; per[i][1] += dt; }
    });
  }
  room.dispose();
  return {
    on, band, share: band / Math.max(on, 1e-6), first, checked, worst, mixChecked, mixWorst, holdChecked, holdWorst, crowded,
    per: all.map((e, i) => `${e.name} ${per[i][1].toFixed(2)}/${per[i][0].toFixed(1)} s`),
  };
}

function report(tag: string, a: Out): void {
  console.log(`[W17 contest] ${tag}: ${HOLD_S} s of game, ${a.on.toFixed(1)} pet-s on the slab, ${a.band.toFixed(2)} pet-s in the 1 m edge band: ${(100 * a.share).toFixed(1)} % (max ${100 * MAX_BAND} %) · ${a.per.join(', ')} · first on ${a.first.map((s) => s.toFixed(2)).join(' / ')} s · step-in ticks ${a.checked}, worst ${a.worst.toFixed(1)} deg · on-slab mix ticks ${a.mixChecked}, worst ${a.mixWorst.toFixed(2)} deg · final cut ticks ${a.holdChecked}, worst overshoot ${a.holdWorst.toFixed(4)} m, crowded ${a.crowded}`);
}

function budgets(a: Out): void {
  expect(a.on).toBeGreaterThanOrEqual(MIN_ON * 4 * HOLD_S - 1e-9);
  expect(a.share).toBeLessThanOrEqual(MAX_BAND);
  // the final cut held on every checked tick (to the float)
  expect(a.holdChecked).toBeGreaterThanOrEqual(1000);
  expect(a.holdWorst).toBeLessThanOrEqual(1e-9);
}

describe('W17 slab contest (Godot test_bot_contest.gd on the web twin)', () => {
  it("SLAB_MARGIN, EDGE_LOOK and CONTEST_ZONE are Godot bot.gd's", () => {
    const gd = readFileSync('engines/godot/game/bot.gd', 'utf8');
    const num = (k: string) => Number(new RegExp(`const ${k} := ([\\d.]+)`).exec(gd)![1]);
    expect([SLAB_MARGIN, EDGE_LOOK, CONTEST_ZONE]).toEqual([num('SLAB_MARGIN'), num('EDGE_LOOK'), num('CONTEST_ZONE')]);
    expect([EDGE, ZONE]).toEqual([SLAB_MARGIN, CONTEST_ZONE]);
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: four unhurt bots fighting on the slab for 20 s keep to it and spend at most 5 % of it in the 1 m edge band`, async () => {
      const a = await contest(seed, PLACES);
      report(`seed ${seed}`, a);
      budgets(a);
      expect(a.first.every((s) => s > 0 && s <= DT)).toBe(true); // all four stood on it from the first tick
      // Godot's on-slab mix (0.7 / 0.8), checked on every clean fight tick (the in-zone 1 / 0.4 misses it by up to 27 deg)
      expect(a.mixChecked).toBeGreaterThanOrEqual(500);
      expect(a.mixWorst).toBeLessThanOrEqual(1);
    }, 120_000);
  }

  for (const seed of SEEDS) {
    it(`seed ${seed}: two Corgis crowding their inner line: teammate separation does not push the outer one past it`, async () => {
      const a = await contest(seed, CROWD);
      report(`crowd, seed ${seed}`, a);
      expect(a.crowded).toBeGreaterThanOrEqual(10); // the case did put a teammate behind a bot at the line
      budgets(a);
    }, 120_000);
  }

  for (const seed of SEEDS) {
    it(`seed ${seed}: Cats 4 m off the slab with Corgis on it step in (strafe 0.4, no back-off) and then keep to it`, async () => {
      const a = await contest(seed, OUTSIDE);
      report(`step-in, seed ${seed}`, a);
      expect(a.checked).toBeGreaterThanOrEqual(20);  // the Cats did fight from inside the zone, off the slab
      expect(a.worst).toBeLessThanOrEqual(STEP_IN_DEG);
      expect(a.first.every((s) => s > 0 && s <= 1.5)).toBe(true);
      budgets(a);
    }, 120_000);
  }
});
