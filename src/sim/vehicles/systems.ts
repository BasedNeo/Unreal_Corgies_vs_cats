// Vehicle systems: terminals (vend karts and planes), mount/dismount, the authoritative kart step, rams, and
// kart damage/destruction. Everything competitive about vehicles is decided here, server-side. The RC plane
// (R1) lives in ./plane-systems.ts and plugs into the same three slots.
//
//   150 vehicle-interact  terminal placement (tick 0) and cooldowns · Interact: dismount > mount > vend ·
//                         rider validation (dead / removed / teleported riders are unseated) ·
//                         riders' combat buttons are masked (hands on the wheel; Fire/Ability = horn,
//                         a plane pilot's Fire = the plane's gun) · crash stuns
//   190 kart-step         stepKart() per kart (rider input → handling) · shove/ram characters ·
//                         kart-vs-kart and crash/landing damage · seat the rider · snapshot fields
//   191 plane-step        stepPlane() per plane · the plane gun · crashes → `explode` + ejection
//   560 vehicle-damage    hitscan shots and explosions against kart bodies and planes (tapped from sim.emit
//                         during weapons 400 / projectiles 500), destruction → `explode` + ejection
//
// Damage to characters goes through the combat lane's applyDamage()/knockback()/explode(); kart
// damage mirrors its rules (friendly fire off, nothing while combat is not live).
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { pressed } from '../entity';
import { Anim, CLASS_IDS, EFlag, EntityKind, Team, type EntityId, type TeamId } from '../../shared/types';
import { Btn } from '../../shared/input';
import type { GameEvent } from '../../shared/protocol';
import { quatYXZ, surfaceAt } from '../../shared/world/queries';
import { COMBAT_RULES, WEAPONS, weaponByIndex, type ProjectileDef } from '../../shared/content/weapons';
import { TERMINALS, VEHICLES, terminalIndex, type KartExplosionDef, type KartId, type TerminalId } from '../../shared/content/vehicles';
import { applyDamage, knockback, explode, combatLive, capsuleOf } from '../combat';
import { falloff } from '../combat/weapon-system';
import { reportNoiseAt } from '../combat/state';
import { groups, Layer } from '../rapier';
import {
  SHOVE_FILTER, TERMINAL_GROUPS, VEHICLE_GROUPS,
  kartDef, kartHullPoints, kartTeam, vehicleRuntime, vehicleTeam, KART_MOVE_FILTER, type PendingBlast,
} from './state';
import { kartInputFrom, newKartState, newKartStepResult, stepKart, NO_KART_INPUT, type KartContext, type KartInput } from './kart';
import { findTerminalSite, hangarSite, type TerminalSite } from './sites';
import { blankEntity, tagCollider, capsuleClear, staticBlocked, unseat, seatCharacterAt, applyStuns, ticks, blastDef, blastDamageOf } from './common';
import {
  planeStepSystem, spawnPlane, mountPlane, dismountPlane, validPlaneRider, nearestPlane, resolvePlaneShots, resolvePlaneBlasts,
  isPlaneShot, planeGunDamage,
} from './plane-systems';

export { capsuleClear } from './common';

/** Buttons a seated driver cannot use for combat (hands on the wheel). Interact/Jump/Sprint stay live. */
const RIDER_MASK = Btn.Fire | Btn.Aim | Btn.Ability | Btn.Reload | Btn.Melee | Btn.NextWeapon | Btn.Crouch;
const HORN_BUTTONS = Btn.Fire | Btn.Ability;
/** A rider further than this from the seat was moved by someone else (respawn, restart): unseat. */
export const TELEPORT_TOLERANCE = 1.5;
/** Clearance test for a kart body being vended: world, karts and characters standing there. */
const KART_CLEAR_FILTER = groups(Layer.Vehicle, Layer.World | Layer.Vehicle | Layer.Character);

/**
 * Test/lab/chapter knobs, read on the first tick: `sim.state.vehicleConfig = { autoTerminals, hangar }`.
 * Default: terminals are placed when the Room's match mode lists them (TerminalDef.modes), so bare
 * unit-test sims of other systems never get surprise kiosks in their arenas. `hangar` forces the Rooftop
 * Hangar on or off independently of the kart terminals (an adventure chapter can turn it off).
 */
export interface VehicleConfig { autoTerminals?: boolean; hangar?: boolean }

/** Should this sim place its terminals from the world data? */
export function autoTerminalsFor(sim: Sim): boolean {
  const cfg = sim.state.vehicleConfig as VehicleConfig | undefined;
  if (cfg?.autoTerminals !== undefined) return cfg.autoTerminals;
  const mode = (sim.state.room as { mode?: string } | undefined)?.mode;
  return mode !== undefined && TERMINALS.kart_terminal.modes.includes(mode);
}

/** Should this sim place the Rooftop Hangar (when its world has The Rooftops)? */
export function autoHangarFor(sim: Sim): boolean {
  const cfg = sim.state.vehicleConfig as VehicleConfig | undefined;
  if (cfg?.hangar !== undefined) return cfg.hangar;
  const mode = (sim.state.room as { mode?: string } | undefined)?.mode;
  return mode !== undefined && TERMINALS.plane_hangar.modes.includes(mode);
}

// ---------------------------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------------------------

/** Place a vehicle terminal (solid kiosk) at a site. Terminals are world fixtures: never removed. */
export function spawnTerminal(sim: Sim, site: TerminalSite, id: TerminalId = 'kart_terminal'): SimEntity {
  const td = TERMINALS[id];
  const e = blankEntity(sim, EntityKind.Terminal, td.neutral ? Team.Neutral : site.team, td.name);
  // Sim.toState() writes CLASS_IDS.indexOf(cls) into EntityState.cls: this makes it the TERMINAL_IDS index.
  // The kart terminal keeps V1's wire value (-1); the hangar needs its index so clients can tell them apart.
  if (id !== 'kart_terminal') e.cls = CLASS_IDS[terminalIndex(id)] ?? null;
  e.pos.x = site.x; e.pos.y = site.y; e.pos.z = site.z; e.yaw = site.yaw;
  e.health = { hp: td.cooldown, max: td.cooldown, lastDamageTick: -9999, lastAttacker: -1 };
  e.terminal = { id, kart: -1, cooldown: 0, cooldownTotal: td.cooldown, padX: site.padX, padY: site.padY, padZ: site.padZ, padYaw: site.padYaw };
  const q = quatYXZ(0, site.yaw, 0);
  e.collider = sim.world.createCollider(
    sim.R.ColliderDesc.cuboid(td.hx, td.hy, td.hz).setTranslation(site.x, site.y + td.hy, site.z).setRotation(q).setCollisionGroups(TERMINAL_GROUPS),
  );
  tagCollider(sim, e);
  sim.entities.set(e.id, e);
  return e;
}

/** Spawn a kart with its ground point at (x, y, z). Used by terminals, tests and labs. */
export function spawnKart(sim: Sim, vehicle: KartId, team: TeamId, x: number, y: number, z: number, yaw: number, terminal: EntityId = -1): SimEntity {
  const d = VEHICLES[vehicle];
  const e = blankEntity(sim, EntityKind.Vehicle, team, d.name);
  e.pos.x = x; e.pos.y = y; e.pos.z = z; e.yaw = yaw;
  e.health = { hp: d.maxHp, max: d.maxHp, lastDamageTick: -9999, lastAttacker: -1 };
  e.kart = newKartState(vehicle, terminal);
  e.ammo = 100;
  e.collider = sim.world.createCollider(
    sim.R.ColliderDesc.convexHull(kartHullPoints(d))!
      .setTranslation(x, y + d.halfHeight + 0.02, z).setCollisionGroups(VEHICLE_GROUPS),
  );
  tagCollider(sim, e);
  sim.entities.set(e.id, e);
  return e;
}

/** Place both teams' terminals from the world data (the interact system does this once, on tick 0). */
export function placeTerminals(sim: Sim): SimEntity[] {
  const out: SimEntity[] = [];
  for (const team of [Team.Corgis, Team.Cats] as TeamId[]) {
    const site = findTerminalSite(sim.worldData, team);
    if (site) out.push(spawnTerminal(sim, site));
  }
  return out;
}

/** Place the Rooftop Hangar at its fixed site when this world has The Rooftops (null otherwise). */
export function placeHangar(sim: Sim): SimEntity | null {
  const site = hangarSite(sim.worldData);
  return site ? spawnTerminal(sim, site, 'plane_hangar') : null;
}

// ---------------------------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------------------------

/** World position of a kart's seat (rider feet) for the kart's current pose. */
export function seatPosition(kart: SimEntity, out = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const s = kartDef(kart).seat;
  const cp = Math.cos(kart.pitch), sp = Math.sin(kart.pitch);
  const ly = s.y * cp - s.z * sp, lz = s.y * sp + s.z * cp, lx = s.x;
  const cy = Math.cos(kart.yaw), sy = Math.sin(kart.yaw);
  out.x = kart.pos.x + lx * cy + lz * sy;
  out.y = kart.pos.y + ly;
  out.z = kart.pos.z - lx * sy + lz * cy;
  return out;
}

const seatTmp = { x: 0, y: 0, z: 0 };
function seatRider(sim: Sim, kart: SimEntity, rider: SimEntity): void {
  const p = seatPosition(kart, seatTmp);
  seatCharacterAt(sim, rider, p.x, p.y, p.z, kart.vel, kart.kart!.grounded);
}

export function mountKart(sim: Sim, kart: SimEntity, rider: SimEntity): boolean {
  const k = kart.kart;
  if (!k || k.rider >= 0 || !rider.char || rider.dead || rider.seat || !kart.health || kart.health.hp <= 0) return false;
  k.rider = rider.id;
  k.idle = 0;
  rider.seat = { vehicle: kart.id, raw: rider.input.buttons, prevRaw: rider.input.buttons };
  kart.flags |= EFlag.Busy;
  seatRider(sim, kart, rider);
  sim.emit({ e: 'ability', id: kart.id, ability: 'mount', x: rider.pos.x, y: rider.pos.y, z: rider.pos.z });
  return true;
}

const exitTmp = { x: 0, y: 0, z: 0 };
const EXIT_ANGLES = [Math.PI / 2, -Math.PI / 2, Math.PI, (3 * Math.PI) / 4, (-3 * Math.PI) / 4, Math.PI / 4, -Math.PI / 4, 0];
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/**
 * A safe spot beside the kart for a rider to step out: on solid ground (never under the terrain or
 * inside props, terminals or karts), within the yard, with no wall between seat and spot. Tries the
 * driver's left first, then right, back, diagonals and front, at three distances; falls back to the
 * kart's roof. Null when nothing is clear (the rider stays seated).
 */
export function findExitSpot(sim: Sim, kart: SimEntity, rider: SimEntity): { x: number; y: number; z: number } | null {
  const d = kartDef(kart);
  const m = rider.char!.move;
  const data = sim.worldData;
  const b = data.bounds;
  const base = d.radius + m.capsuleRadius + 0.25;
  const eyeY = kart.pos.y + 0.9;
  for (const ring of [0, 0.8, 1.6]) {
    for (const a of EXIT_ANGLES) {
      const h = kart.yaw + a;
      const x = kart.pos.x - Math.sin(h) * (base + ring), z = kart.pos.z - Math.cos(h) * (base + ring);
      if (b && (x < b.minX + 1 || x > b.maxX - 1 || z < b.minZ + 1 || z > b.maxZ - 1)) continue;
      const gy = surfaceAt(data, x, z, kart.pos.y + 1.5).y;
      if (gy < kart.pos.y - 2.5) continue; // no stepping out over a big drop
      if (gy < data.height(x, z) - 0.01) continue;
      for (const lift of [0.04, 0.25]) {
        const y = gy + lift;
        if (!capsuleClear(sim, rider, x, y, z)) continue;
        if (staticBlocked(sim, kart.pos.x, eyeY, kart.pos.z, x, y + 0.9, z)) break;
        exitTmp.x = x; exitTmp.y = y; exitTmp.z = z;
        return exitTmp;
      }
    }
  }
  const roofY = kart.pos.y + 2 * d.halfHeight + 0.05;
  if (capsuleClear(sim, rider, kart.pos.x, roofY, kart.pos.z)) { exitTmp.x = kart.pos.x; exitTmp.y = roofY; exitTmp.z = kart.pos.z; return exitTmp; }
  return null;
}

/** Voluntary exit (Interact while seated). Returns false (still seated) if no safe spot exists. */
export function dismountKart(sim: Sim, kart: SimEntity, rider: SimEntity): boolean {
  const spot = findExitSpot(sim, kart, rider);
  if (!spot) return false;
  unseat(kart, rider);
  sim.placeCharacter(rider, spot.x, spot.y, spot.z);
  // Bailing out keeps some of the kart's momentum (the rider's own controller bleeds it off).
  rider.vel.x = kart.vel.x * 0.5; rider.vel.z = kart.vel.z * 0.5;
  sim.emit({ e: 'ability', id: kart.id, ability: 'dismount', x: spot.x, y: spot.y, z: spot.z });
  return true;
}

/** Forced exit (kart destroyed / rider died): best safe spot, else the kart's own footprint. */
function ejectRider(sim: Sim, kart: SimEntity, rider: SimEntity, launch: boolean): void {
  const spot = findExitSpot(sim, kart, rider);
  const x = spot?.x ?? kart.pos.x, y = spot?.y ?? kart.pos.y + 0.05, z = spot?.z ?? kart.pos.z;
  unseat(kart, rider);
  sim.placeCharacter(rider, x, y, z);
  let ox = x - kart.pos.x, oz = z - kart.pos.z;
  const ol = Math.hypot(ox, oz);
  if (ol > 1e-3) { ox /= ol; oz /= ol; } else { ox = -Math.sin(kart.yaw); oz = -Math.cos(kart.yaw); }
  const vx = kart.vel.x * 0.6 + ox * (launch ? 4 : 2), vz = kart.vel.z * 0.6 + oz * (launch ? 4 : 2), vy = launch ? 7 : 3;
  if (rider.dead) { rider.vel.x = vx; rider.vel.y = vy; rider.vel.z = vz; if (rider.char) rider.char.grounded = false; if (rider.combat) rider.combat.corpseSettled = false; }
  else knockback(rider, vx, vy, vz);
}

/** Rider still valid for this kart? Unseats (and ejects corpses) otherwise. Returns the live rider. */
function validRider(sim: Sim, kart: SimEntity): SimEntity | undefined {
  const k = kart.kart!;
  if (k.rider < 0) return undefined;
  const r = sim.entities.get(k.rider);
  if (!r || r.removed || !r.char || r.seat?.vehicle !== kart.id) { unseat(kart, undefined); if (r && r.seat?.vehicle === kart.id) unseat(undefined, r); return undefined; }
  if (r.dead) { ejectRider(sim, kart, r, false); return undefined; }
  const p = seatPosition(kart, seatTmp);
  if (Math.hypot(r.pos.x - p.x, r.pos.y - p.y, r.pos.z - p.z) > TELEPORT_TOLERANCE) { unseat(kart, r); return undefined; }
  return r;
}

// ---------------------------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------------------------

function kartShapeClear(sim: Sim, vehicle: KartId, x: number, y: number, z: number): boolean {
  const d = VEHICLES[vehicle];
  const shape = new sim.R.ConvexPolyhedron(kartHullPoints(d), null);
  return sim.world.intersectionWithShape({ x, y: y + d.halfHeight + 0.06, z }, IDENTITY, shape, undefined, KART_CLEAR_FILTER) === null;
}

/**
 * Vend a vehicle from a terminal for a character. Server-side checks: team (neutral terminals serve everyone),
 * availability, a clear pad. Karts pop out beside the kiosk; planes on the hangar's runway pad.
 */
export function useTerminal(sim: Sim, term: SimEntity, user: SimEntity): SimEntity | null {
  const t = term.terminal;
  if (!t || user.dead || !user.char || user.seat) return null;
  const td = TERMINALS[t.id];
  if (!td.neutral && user.team !== term.team) return null;
  if (t.kart >= 0 || t.cooldown > 0) return null;
  const vehicle = td.vehicle;
  if (vehicle === 'rc_plane') {
    const plane = spawnPlane(sim, vehicle, user.team, t.padX, t.padY, t.padZ, t.padYaw, term.id);
    if (!plane) return null;
    t.kart = plane.id;
    sim.emit({ e: 'spawn', id: plane.id });
    return plane;
  }
  // The pad, else the first clear spot on a ring around it (someone may be standing on the pad).
  const tries: [number, number][] = [[t.padX, t.padZ]];
  for (let i = 0; i < 8; i++) {
    const a = t.padYaw + (i / 8) * Math.PI * 2;
    tries.push([t.padX - Math.sin(a) * 1.8, t.padZ - Math.cos(a) * 1.8]);
  }
  for (const [x, z] of tries) {
    const y = surfaceAt(sim.worldData, x, z, t.padY + 1).y;
    if (Math.abs(y - t.padY) > 0.6 || !kartShapeClear(sim, vehicle, x, y, z)) continue;
    const kart = spawnKart(sim, vehicle, term.team, x, y, z, t.padYaw, term.id);
    t.kart = kart.id;
    sim.emit({ e: 'spawn', id: kart.id });
    return kart;
  }
  return null;
}

function updateTerminal(sim: Sim, e: SimEntity, dt: number): void {
  const t = e.terminal!;
  if (t.kart >= 0 && !sim.entities.has(t.kart)) { t.kart = -1; t.cooldown = TERMINALS[t.id].rearm; t.cooldownTotal = t.cooldown; }
  if (t.cooldown > 0) t.cooldown = Math.max(0, t.cooldown - dt);
  e.flags = t.kart >= 0 || t.cooldown > 0 ? EFlag.Busy : 0;
  e.weapon = t.kart;
  e.ammo = Math.ceil(t.cooldown - 1e-6);
  if (e.health) { e.health.max = t.cooldownTotal; e.health.hp = t.cooldownTotal - t.cooldown; }
}

// ---------------------------------------------------------------------------------------------
// Damage & destruction
// ---------------------------------------------------------------------------------------------

export interface KartDamageSource { id: EntityId; team: TeamId | -1; weapon: number }

/** Damage a kart (armor). Emits `hit` (dst = kart). Destroys it at 0 hp. Returns the damage dealt. */
export function damageKart(sim: Sim, kart: SimEntity, amount: number, src: KartDamageSource, x: number, y: number, z: number): number {
  const h = kart.health;
  if (!h || !kart.kart || kart.removed || h.hp <= 0 || amount <= 0 || !combatLive(sim)) return 0;
  const dmg = Math.min(h.hp, Math.max(1, Math.round(amount)));
  h.hp -= dmg;
  h.lastDamageTick = sim.tick;
  if (src.id !== kart.id && src.id !== kart.kart.rider) h.lastAttacker = src.id;
  sim.emit({ e: 'hit', src: src.id, dst: kart.id, dmg, x, y, z, crit: false });
  if (h.hp <= 0) destroyKart(sim, kart);
  return dmg;
}

/**
 * Destroy a kart: eject the rider (launched clear), free its terminal (cooldown starts), remove the
 * body, then blow up through the combat lane's explode() — credited to whoever wrecked it (the last
 * attacker within 10 s), else to the driver, else to the kart itself.
 */
export function destroyKart(sim: Sim, kart: SimEntity): void {
  const k = kart.kart;
  if (!k || kart.removed) return;
  const d = kartDef(kart);
  const x = kart.pos.x, y = kart.pos.y + d.halfHeight, z = kart.pos.z;
  const rider = k.rider >= 0 ? sim.entities.get(k.rider) : undefined;
  const h = kart.health!;
  const attacker = h.lastAttacker >= 0 && sim.tick - h.lastDamageTick <= ticks(10) ? sim.entities.get(h.lastAttacker) : undefined;
  let owner: EntityId = kart.id, ownerTeam: TeamId = kartTeam(sim, kart);
  if (attacker && attacker.id !== kart.id) { owner = attacker.id; ownerTeam = attacker.team; }
  else if (rider) { owner = rider.id; ownerTeam = rider.team; }
  if (rider) ejectRider(sim, kart, rider, true);
  const term = k.terminal >= 0 ? sim.entities.get(k.terminal) : undefined;
  if (term?.terminal && term.terminal.kart === kart.id) {
    const td = TERMINALS[term.terminal.id];
    term.terminal.kart = -1; term.terminal.cooldown = td.cooldown; term.terminal.cooldownTotal = td.cooldown;
  }
  h.hp = 0;
  if (kart.collider) vehicleRuntime(sim).byHandle.delete(kart.collider.handle);
  sim.removeEntity(kart.id);
  const rt = vehicleRuntime(sim);
  rt.ownBlast = d.explosion;
  explode(sim, x, y, z, blastDef(d.explosion), owner, ownerTeam, -1);
  rt.ownBlast = null;
}

/** Despawn an abandoned kart quietly (no blast); its terminal re-arms after a short delay. */
function despawnKart(sim: Sim, kart: SimEntity): void {
  const k = kart.kart!;
  const term = k.terminal >= 0 ? sim.entities.get(k.terminal) : undefined;
  if (term?.terminal && term.terminal.kart === kart.id) {
    const td = TERMINALS[term.terminal.id];
    term.terminal.kart = -1; term.terminal.cooldown = td.rearm; term.terminal.cooldownTotal = td.rearm;
  }
  if (kart.collider) vehicleRuntime(sim).byHandle.delete(kart.collider.handle);
  sim.removeEntity(kart.id);
}

/** Distance from a point to a kart body (upright prism ≈ cylinder), 0 inside. */
function kartBodyDistance(kart: SimEntity, x: number, y: number, z: number): number {
  const d = kartDef(kart);
  const dh = Math.max(0, Math.hypot(x - kart.pos.x, z - kart.pos.z) - d.radius);
  const cy = kart.collider ? kart.collider.translation().y : kart.pos.y + d.halfHeight;
  const y0 = cy - d.halfHeight, y1 = cy + d.halfHeight;
  const dv = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  return Math.hypot(dh, dv);
}

function resolveShots(sim: Sim): void {
  const rt = vehicleRuntime(sim);
  for (const ev of rt.shots) {
    if (ev.hit !== -1) continue;
    // Plane guns resolve characters and planes themselves (plane-systems.ts); karts they hit are armor here.
    const planeGun = isPlaneShot(ev);
    const def = planeGun ? null : weaponByIndex(ev.wpn);
    if (!planeGun && (!def || def.kind !== 'hitscan')) continue;
    const shooter = sim.entities.get(ev.id);
    for (const kart of sim.entities.values()) {
      if (!kart.kart || kart.removed) continue;
      if (kartBodyDistance(kart, ev.hx, ev.hy, ev.hz) > 0.14) continue;
      const team = kartTeam(sim, kart);
      const shooterTeam = shooter ? (shooter.plane ? vehicleTeam(sim, shooter) : shooter.team) : -1;
      if (!COMBAT_RULES.friendlyFire && shooterTeam === team) break;
      if (shooter && shooter.seat?.vehicle === kart.id) break;
      const dist = Math.hypot(ev.hx - ev.x, ev.hy - ev.y, ev.hz - ev.z);
      let dmg: number;
      if (def) {
        // The event carries only the first pellet; spread weapons put most pellets into a kart-sized target.
        const pellets = def.pellets > 1 ? def.pellets * 0.6 : 1;
        dmg = def.damage * pellets * falloff(def, dist);
      } else dmg = planeGunDamage(VEHICLES.rc_plane, dist);
      const credit = shooter?.plane && shooter.plane.rider >= 0 ? shooter.plane.rider : ev.id;
      damageKart(sim, kart, dmg * kartDef(kart).bulletDamageMult, { id: credit, team: shooterTeam as TeamId | -1, weapon: ev.wpn }, ev.hx, ev.hy, ev.hz);
      break;
    }
  }
  rt.shots.length = 0;
}

function resolveKartBlasts(sim: Sim, list: readonly PendingBlast[]): void {
  for (const { ev, def } of list) {
    const b = blastDamageOf(sim, ev, def);
    const owner = sim.entities.get(ev.by);
    const ownerTeam: TeamId | -1 = owner ? owner.team : -1;
    for (const kart of sim.entities.values()) {
      if (!kart.kart || kart.removed || kart.id === ev.by) continue;
      const dist = kartBodyDistance(kart, ev.x, ev.y, ev.z);
      if (dist > ev.r) continue;
      const team = kartTeam(sim, kart);
      const self = owner !== undefined && (owner.id === kart.kart.rider);
      if (!self && !COMBAT_RULES.friendlyFire && ownerTeam === team) continue;
      const cy = kart.pos.y + kartDef(kart).halfHeight;
      const cd = Math.hypot(kart.pos.x - ev.x, cy - ev.y, kart.pos.z - ev.z);
      if (cd > 1e-3 && staticBlocked(sim, ev.x, ev.y, ev.z, ev.x + (kart.pos.x - ev.x) * (1 - kartDef(kart).radius / cd), ev.y + (cy - ev.y) * (1 - kartDef(kart).radius / cd), ev.z + (kart.pos.z - ev.z) * (1 - kartDef(kart).radius / cd))) continue;
      const frac = dist <= b.inner ? 1 : 1 + (b.edge - 1) * ((dist - b.inner) / Math.max(1e-3, ev.r - b.inner));
      const dmg = b.damage * frac * kartDef(kart).blastDamageMult * (self ? b.self : 1);
      damageKart(sim, kart, dmg, { id: ev.by, team: ownerTeam, weapon: -1 }, kart.pos.x, cy, kart.pos.z);
    }
  }
}

/** Explosions this tick against karts and planes. Vehicle explosions can chain: keep draining (bounded). */
function resolveBlasts(sim: Sim): void {
  const rt = vehicleRuntime(sim);
  for (let guard = 0; rt.blasts.length && guard < 16; guard++) {
    const list = rt.blasts.splice(0, rt.blasts.length);
    resolvePlaneBlasts(sim, list);
    resolveKartBlasts(sim, list);
  }
  rt.blasts.length = 0;
}

/** Record weapon shots and explosions for the damage system (kart bodies are not combat targets). */
function installEventTap(sim: Sim): void {
  const st = sim.state as { vehicleTap?: boolean };
  if (st.vehicleTap) return;
  st.vehicleTap = true;
  const rt = vehicleRuntime(sim);
  const emit = sim.emit.bind(sim);
  sim.emit = (ev: GameEvent) => {
    emit(ev);
    if (ev.e === 'fire') { if (ev.hit === -1) rt.shots.push(ev); }
    else if (ev.e === 'explode') rt.blasts.push({ ev, def: rt.ownBlast });
  };
}

// ---------------------------------------------------------------------------------------------
// Rams: karts shove characters out of their way and hit them hard above ramMinSpeed
// ---------------------------------------------------------------------------------------------

function shoveCharacter(sim: Sim, c: SimEntity, dx: number, dz: number): number {
  if (!c.collider || !c.char) return 0;
  sim.kcc.computeColliderMovement(c.collider, { x: dx, y: 0, z: dz }, undefined, SHOVE_FILTER);
  const mv = sim.kcc.computedMovement();
  const t = c.collider.translation();
  const m = c.char.move;
  c.collider.setTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
  c.pos.x = t.x + mv.x; c.pos.y = t.y + mv.y - (m.capsuleHalfHeight + m.capsuleRadius); c.pos.z = t.z + mv.z;
  return Math.hypot(mv.x, mv.z);
}

function kartContacts(sim: Sim, kart: SimEntity, rider: SimEntity | undefined): void {
  const k = kart.kart!, d = kartDef(kart);
  const team = kartTeam(sim, kart);
  const top = kart.pos.y + 2 * d.halfHeight;
  const rt = vehicleRuntime(sim);
  for (const c of sim.entities.values()) {
    if (!c.char || c.dead || c.seat || c === rider || !c.collider) continue;
    const cap = capsuleOf(c);
    if (c.pos.y > top - 0.15 || c.pos.y + cap.height < kart.pos.y - 0.1) continue; // riding on the roof / far below
    let nx = c.pos.x - kart.pos.x, nz = c.pos.z - kart.pos.z;
    const rr = d.radius + cap.r + 0.02;
    const d2 = nx * nx + nz * nz;
    if (d2 >= rr * rr) continue;
    const dist = Math.sqrt(d2);
    if (dist > 1e-4) { nx /= dist; nz /= dist; } else { nx = -Math.sin(kart.yaw); nz = -Math.cos(kart.yaw); }
    const kn = kart.vel.x * nx + kart.vel.z * nz;
    const cn = c.vel.x * nx + c.vel.z * nz;
    const closing = kn - cn;
    const heavy = c.kind === EntityKind.Boss; // bosses are rammed (damage) but never shoved or launched
    if (closing > d.ramMinSpeed && (k.ramUntil[c.id] ?? -1) < sim.tick) {
      k.ramUntil[c.id] = sim.tick + ticks(d.ramCooldown);
      const enemy = COMBAT_RULES.friendlyFire || c.team !== team;
      if (enemy) {
        const dmg = d.ramDamageBase + (closing - d.ramMinSpeed) * d.ramDamagePerMs;
        applyDamage(sim, c, dmg, { id: rider?.id ?? kart.id, team, weapon: -1 }, c.pos.x, c.pos.y + cap.height * 0.5, c.pos.z, false);
      }
      const s = (closing * d.ramKnockback + 2) * (enemy ? 1 : 0.5);
      const kx = nx * s + kart.vel.x * 0.25, kz = nz * s + kart.vel.z * 0.25, ky = (d.ramLift + closing * 0.2) * (enemy ? 1 : 0.5);
      if (!heavy) {
        if (cn < 0) { c.vel.x -= cn * nx; c.vel.z -= cn * nz; }
        if (c.dead) { c.vel.x += kx; c.vel.z += kz; c.vel.y = Math.max(c.vel.y, ky); c.char.grounded = false; }
        else knockback(c, kx, ky, kz);
      }
      kart.vel.x *= 1 - d.ramKartSlow; kart.vel.z *= 1 - d.ramKartSlow;
    } else if (closing > 0 && !heavy) {
      c.vel.x += closing * nx; c.vel.z += closing * nz; // carried along at the kart's pace
    }
    const pen = rr - dist;
    if (pen > 1e-3) {
      const moved = heavy ? 0 : shoveCharacter(sim, c, nx * pen, nz * pen);
      if (moved < pen * 0.7 - 0.005 && kart.collider) {
        // Pinned against something solid: the kart gives way instead of swallowing the character.
        const back = pen - moved;
        rt.kcc.computeColliderMovement(kart.collider, { x: -nx * back, y: 0, z: -nz * back }, undefined, KART_MOVE_FILTER);
        const mv = rt.kcc.computedMovement();
        const t = kart.collider.translation();
        kart.collider.setTranslation({ x: t.x + mv.x, y: t.y, z: t.z + mv.z });
        kart.pos.x = t.x + mv.x; kart.pos.z = t.z + mv.z;
        const vk = kart.vel.x * nx + kart.vel.z * nz;
        if (vk > 0) { kart.vel.x -= vk * nx; kart.vel.z -= vk * nz; }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------------------------

function nearestKart(sim: Sim, c: SimEntity): SimEntity | null {
  let best: SimEntity | null = null, bd = Infinity;
  for (const e of sim.entities.values()) {
    if (!e.kart || e.removed || e.kart.rider >= 0 || !e.health || e.health.hp <= 0) continue;
    const d = VEHICLES[e.kart.id];
    if (Math.hypot(e.vel.x, e.vel.z) > d.mountMaxSpeed || Math.abs(c.pos.y - e.pos.y) > 1.6) continue;
    const dist = Math.hypot(c.pos.x - e.pos.x, c.pos.z - e.pos.z);
    if (dist <= d.mountRange && dist < bd) { bd = dist; best = e; }
  }
  return best;
}

function nearestTerminal(sim: Sim, c: SimEntity): SimEntity | null {
  let best: SimEntity | null = null, bd = Infinity;
  for (const e of sim.entities.values()) {
    if (!e.terminal) continue;
    const td = TERMINALS[e.terminal.id];
    if (Math.abs(c.pos.y - e.pos.y) > 2) continue;
    const dist = Math.hypot(c.pos.x - e.pos.x, c.pos.z - e.pos.z);
    if (dist <= td.useRange && dist < bd) { bd = dist; best = e; }
  }
  return best;
}

export const vehicleInteractSystem: SimSystem = {
  name: 'vehicle-interact',
  order: 150,
  init(sim) {
    vehicleRuntime(sim);
    installEventTap(sim);
  },
  update(sim, dt) {
    const rt = vehicleRuntime(sim);
    if (!rt.sitesPlaced) {
      rt.sitesPlaced = true;
      if (autoTerminalsFor(sim)) placeTerminals(sim);
      if (autoHangarFor(sim)) placeHangar(sim);
    }
    // Riders thrown out of a crashing plane are stunned for a moment: no movement, no buttons (not even E).
    applyStuns(sim);
    // Riders that died, left or were teleported since the last tick.
    for (const e of sim.entities.values()) {
      if (e.kart) validRider(sim, e);
      else if (e.plane) validPlaneRider(sim, e);
    }
    for (const e of sim.entities.values()) {
      if (!e.seat) continue;
      const v = sim.entities.get(e.seat.vehicle);
      if (!v?.kart && !v?.plane) unseat(undefined, e); // vehicle vanished under them
    }
    // Interact: dismount > mount (the nearest empty kart or plane) > vend.
    for (const c of sim.entities.values()) {
      if (!c.char || c.dead || !pressed(c, Btn.Interact)) continue;
      if (c.seat) {
        const v = sim.entities.get(c.seat.vehicle);
        if (v?.kart) dismountKart(sim, v, c);
        else if (v?.plane) dismountPlane(sim, v, c);
        continue;
      }
      const kart = nearestKart(sim, c);
      const plane = nearestPlane(sim, c);
      const kd = kart ? Math.hypot(c.pos.x - kart.pos.x, c.pos.z - kart.pos.z) : Infinity;
      const pd = plane ? Math.hypot(c.pos.x - plane.pos.x, c.pos.z - plane.pos.z) : Infinity;
      if (kart && kd <= pd) { mountKart(sim, kart, c); continue; }
      if (plane) { mountPlane(sim, plane, c); continue; }
      const term = nearestTerminal(sim, c);
      if (term) useTerminal(sim, term, c);
    }
    for (const e of sim.entities.values()) if (e.terminal) updateTerminal(sim, e, dt);
    // Hands on the wheel: riders' combat buttons never reach the weapon/ability systems.
    for (const e of sim.entities.values()) {
      if (!e.seat) continue;
      e.seat.raw = e.input.buttons;
      if (e.input.buttons & RIDER_MASK) e.input = { ...e.input, buttons: e.input.buttons & ~RIDER_MASK };
    }
  },
};

const stepRes = newKartStepResult();
const kin: KartInput = { throttle: 0, steer: 0, handbrake: false, boost: false };

export const kartStepSystem: SimSystem = {
  name: 'kart-step',
  order: 190,
  update(sim, dt) {
    const rt = vehicleRuntime(sim);
    const ctx: KartContext = { world: sim.world, kcc: rt.kcc, data: sim.worldData, emit: (ev) => sim.emit(ev) };
    for (const kart of sim.entities.values()) {
      const k = kart.kart;
      if (!k || kart.removed) continue;
      const d = kartDef(kart);
      const rider = validRider(sim, kart);
      const input = rider ? kartInputFrom(rider.input, kin) : NO_KART_INPUT;
      k.hornCd = Math.max(0, k.hornCd - dt);
      if (rider?.seat) {
        const raw = rider.seat.raw;
        if ((raw & HORN_BUTTONS & ~rider.seat.prevRaw) && k.hornCd <= 0) {
          k.hornCd = d.hornCooldown;
          sim.emit({ e: 'ability', id: kart.id, ability: 'horn', x: kart.pos.x, y: kart.pos.y + 0.8, z: kart.pos.z });
          reportNoiseAt(sim, kart.pos.x, kart.pos.y, kart.pos.z, d.hornNoise, rider.team, rider.id);
        }
        rider.seat.prevRaw = raw;
      }

      const res = stepKart(ctx, kart, input, dt, stepRes);
      if (res.boostStarted || res.turboStarted) sim.emit({ e: 'ability', id: kart.id, ability: 'boost', x: kart.pos.x, y: kart.pos.y + 0.4, z: kart.pos.z });

      // Out of the yard / below the kill plane: the kart is wrecked, the driver bails out.
      const b = sim.worldData.bounds;
      if (kart.pos.y < sim.worldData.killY + 2 || (b && (kart.pos.x < b.minX || kart.pos.x > b.maxX || kart.pos.z < b.minZ || kart.pos.z > b.maxZ))) {
        if (rider) {
          unseat(kart, rider);
          const s = sim.pickSpawn(rider.team);
          sim.placeCharacter(rider, s.x, s.y, s.z);
        }
        kart.health!.hp = 0;
        destroyKart(sim, kart);
        continue;
      }

      // Kart vs kart: both take ram damage and the other one is shoved.
      if (res.wallHandle >= 0 && res.wallImpact > d.ramMinSpeed) {
        const otherId = rt.byHandle.get(res.wallHandle);
        const other = otherId !== undefined ? sim.entities.get(otherId) : undefined;
        if (other?.kart && other !== kart) {
          const imp = res.wallImpact;
          other.vel.x -= res.wallNx * imp * 0.55; other.vel.z -= res.wallNz * imp * 0.55;
          const src = { id: rider?.id ?? kart.id, team: kartTeam(sim, kart) as TeamId | -1, weapon: -1 };
          damageKart(sim, other, (imp - d.ramMinSpeed) * d.ramDamagePerMs * 0.6 + 8, src, other.pos.x, other.pos.y + 0.4, other.pos.z);
        }
      }
      if (kart.removed) continue;
      if (res.wallImpact > d.crashDamageSpeed) {
        damageKart(sim, kart, (res.wallImpact - d.crashDamageSpeed) * d.crashDamagePerMs, { id: kart.id, team: kart.team, weapon: -1 }, kart.pos.x, kart.pos.y + 0.4, kart.pos.z);
      }
      if (!kart.removed && res.landImpact > d.fallDamageSpeed) {
        damageKart(sim, kart, (res.landImpact - d.fallDamageSpeed) * d.fallDamagePerMs, { id: kart.id, team: kart.team, weapon: -1 }, kart.pos.x, kart.pos.y, kart.pos.z);
      }
      if (kart.removed) continue;

      kartContacts(sim, kart, rider);
      if (rider && !rider.dead && rider.seat) seatRider(sim, kart, rider);

      kart.flags = (k.rider >= 0 ? EFlag.Busy : 0) | (k.grounded ? EFlag.Grounded : 0)
        | (k.boosting || k.turbo > 0 ? EFlag.Sprinting : 0) | (k.drifting ? EFlag.Crouching : 0);
      kart.weapon = k.rider;
      kart.ammo = Math.round(k.boost * 100);
      kart.anim = k.rider >= 0 ? Anim.Drive : Anim.Idle;
      if (k.rider < 0) {
        k.idle += dt;
        if (k.idle > d.abandonTime) despawnKart(sim, kart);
      }
    }
  },
};

export const vehicleDamageSystem: SimSystem = {
  name: 'vehicle-damage',
  order: 560,
  update(sim) {
    resolvePlaneShots(sim, vehicleRuntime(sim).shots);
    resolveShots(sim);
    resolveBlasts(sim);
    // Riders killed this tick flop out of the seat before corpse physics (600) runs.
    for (const e of sim.entities.values()) {
      if (e.kart) validRider(sim, e);
      else if (e.plane) validPlaneRider(sim, e);
    }
  },
};

export function vehicleSystems(): SimSystem[] {
  return [vehicleInteractSystem, kartStepSystem, planeStepSystem, vehicleDamageSystem];
}
