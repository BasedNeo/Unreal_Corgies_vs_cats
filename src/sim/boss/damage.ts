// Boss hit resolution (order 560: after player weapons 400, abilities 450, boss attacks 455 and
// projectiles 500 have applied this tick's damage through the combat lane's applyDamage()).
//
// The combat lane tests every character as one capsule and multiplies "head zone" hits (top 20 % of
// the capsule) by the weapon's own headMult. For the Vac-Tank that capsule is a 5 m sphere, so its top
// is not the pilot. This pass re-grades each `hit` on a boss:
//   - hitscan: the exact shot ray (eye from the `fire` event → recorded impact point) is tested
//     against the pilot's weak-point capsule for the current phase (lag-compensated boss position);
//   - projectile direct hits: impact on the upper cap of the sphere near the pilot;
//   - blasts / bark blast (the combat lane reports them at the target's centre): hull.
// Weak point = base damage × weak.mult (2), hull = × hullMult (1); the difference to what was applied
// is settled on the boss's hp and the event is rewritten (dmg, crit = weak point) before clients see it.
// It also watches this tick's events for kills by a boss (taunts, stats) and for who hurts it (aggro).
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import type { GameEvent } from '../../shared/protocol';
import { EntityKind } from '../../shared/types';
import { WEAPONS, weaponByIndex, COMBAT_RULES } from '../../shared/content/weapons';
import { weakZone, type BossDef } from '../../shared/content/bosses';
import { kill, rayCapsule } from '../combat';
import { rewindTick, currentStateTick } from '../combat/lagcomp';
import { bossBark, bossDef, type BossState } from './state';

type FireEv = Extract<GameEvent, { e: 'fire' }>;
type HitEv = Extract<GameEvent, { e: 'hit' }>;

const pos = { x: 0, y: 0, z: 0 };

/** Boss feet position as the shooter's hitscan saw it (lag-compensated rewind for players). */
function bossPosFor(sim: Sim, boss: SimEntity, shooter: SimEntity | undefined): typeof pos {
  pos.x = boss.pos.x; pos.y = boss.pos.y; pos.z = boss.pos.z;
  if (!shooter) return pos;
  const tick = rewindTick(sim, shooter.input.rt);
  const h = boss.lag;
  if (tick < currentStateTick(sim) && h) {
    const i = tick % COMBAT_RULES.historyTicks;
    if (h.ticks[i] === tick) { pos.x = h.xyz[i * 3]; pos.y = h.xyz[i * 3 + 1]; pos.z = h.xyz[i * 3 + 2]; }
  }
  return pos;
}

/** Does the ray (unit direction) pass through the pilot's weak-point capsule? */
export function rayHitsWeakPoint(def: BossDef, phase2: boolean, bx: number, by: number, bz: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): boolean {
  const w = weakZone(def, phase2);
  const len = Math.max(0, w.y1 - w.y0 - 2 * w.r);
  return rayCapsule(ox, oy, oz, dx, dy, dz, bx, by + w.y0 + w.r, bz, len, w.r, 1e4) >= 0;
}

function regrade(sim: Sim, ev: HitEv, boss: SimEntity, fire: FireEv | null): void {
  const b = boss.boss as BossState;
  const def = bossDef(b);
  const shooter = sim.entities.get(ev.src);
  const wdef = fire ? weaponByIndex(fire.wpn) : null;
  let headMult = 1;
  let weak = false;
  if (fire && wdef && wdef.kind === 'hitscan') {
    if (ev.crit) headMult = wdef.headMult;
    let dx = ev.x - fire.x, dy = ev.y - fire.y, dz = ev.z - fire.z;
    const l = Math.hypot(dx, dy, dz);
    if (l > 1e-6) {
      dx /= l; dy /= l; dz /= l;
      const p = bossPosFor(sim, boss, shooter);
      weak = rayHitsWeakPoint(def, b.phase2, p.x, p.y, p.z, fire.x, fire.y, fire.z, dx, dy, dz);
    }
  } else {
    // projectile direct hits only (blasts and bark blast report the target's centre; anything else —
    // abilities, scripted damage — is left exactly as the combat lane applied it)
    const blast = ev.x === boss.pos.x && ev.z === boss.pos.z;
    const pdef = shooter?.wpn ? WEAPONS[shooter.wpn.id] : null;
    if (blast || !pdef || pdef.kind !== 'projectile') { noteHit(sim, boss, b, ev, shooter, false); return; }
    if (ev.crit) headMult = pdef.headMult;
    const w = weakZone(def, b.phase2);
    weak = ev.y - boss.pos.y >= w.y0 - 0.3;
  }
  const base = ev.dmg / headMult;
  const want = Math.max(1, Math.round(base * (weak ? def.weak.mult : def.hullMult)));
  const h = boss.health!;
  let dealt = ev.dmg;
  if (!boss.dead && want !== ev.dmg) {
    const delta = Math.min(want - ev.dmg, h.hp); // negative = refund of an over-counted head zone hit
    h.hp = Math.min(h.max, h.hp - delta);
    dealt = ev.dmg + delta;
  }
  ev.dmg = dealt;
  ev.crit = weak;
  noteHit(sim, boss, b, ev, shooter, weak);
  if (!boss.dead && h.hp <= 0) {
    h.hp = 0;
    kill(sim, boss, { id: ev.src, team: shooter?.team ?? (boss.team === 0 ? 1 : 0), weapon: fire ? fire.wpn : -1 });
  }
}

/** Stats, aggro and the "ouch" taunt for a (regraded) hit on a boss. */
function noteHit(sim: Sim, boss: SimEntity, b: BossState, ev: HitEv, shooter: SimEntity | undefined, weak: boolean): void {
  b.stats.dmgTaken += ev.dmg;
  if (weak) b.stats.weakHits++; else b.stats.hullHits++;
  if (shooter && shooter.team !== boss.team) { b.aggroId = shooter.id; b.aggroAt = sim.time; }
  if (weak && sim.time >= b.hurtBarkAt && !boss.dead) { b.hurtBarkAt = sim.time + 14; bossBark(sim, boss, b, 'hurt'); }
}

const bossIds = new Set<number>();

export const bossDamageSystem: SimSystem = {
  name: 'boss-damage',
  order: 560,
  update(sim) {
    bossIds.clear();
    for (const e of sim.entities.values()) if (e.kind === EntityKind.Boss && e.boss) bossIds.add(e.id);
    if (bossIds.size === 0) return; // no boss: leave the event stream untouched
    const evs = sim.drainEvents();
    let fire: FireEv | null = null;
    for (const ev of evs) {
      sim.emit(ev);
      if (ev.e === 'fire') { fire = ev; continue; }
      if (ev.e === 'hit' && bossIds.has(ev.dst)) {
        const boss = sim.entities.get(ev.dst)!;
        regrade(sim, ev, boss, fire && fire.id === ev.src ? fire : null);
      } else if (ev.e === 'death' && bossIds.has(ev.by) && ev.by !== ev.id) {
        const boss = sim.entities.get(ev.by)!;
        const b = boss.boss!;
        b.stats.kills++;
        if (!boss.dead) bossBark(sim, boss, b, 'kill');
      }
    }
  },
};
