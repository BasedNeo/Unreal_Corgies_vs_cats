// Character movement on Rapier's kinematic character controller.
// Exposed as a pure per-entity function so client-side prediction can replay inputs with the
// exact same code the authority runs.
import type { CharacterCollision, KinematicCharacterController, World } from '@dimforge/rapier3d-compat';
import type { SimEntity } from '../entity';
import { pressed, held } from '../entity';
import type { SimSystem } from '../sim';
import { Btn } from '../../shared/input';
import { GRAVITY } from '../../shared/constants';
import { Anim, EFlag } from '../../shared/types';
import { CHARACTER_MOVE_FILTER } from '../rapier';
import type { GameEvent } from '../../shared/protocol';

const SLIDE_TIME = 0.65;
/** Slide entry speed as a multiple of sprint speed: a slide must out-distance sprinting (QA W1). */
const SLIDE_BOOST = 1.25;
const SLIDE_FRICTION = 0.55;
const SLIDE_COOLDOWN = 0.35;
const POUND_SPEED = -26;

/** Reused result object for KCC collision queries (no per-tick allocation). */
let collisionScratch: CharacterCollision | undefined;

export interface MoveContext {
  world: World;
  kcc: KinematicCharacterController;
  emit?: (ev: GameEvent) => void;
}

/** Advance one character by dt using its current input. Mutates e.pos/e.vel/e.char/e.anim/e.flags. */
export function stepCharacter(ctx: MoveContext, e: SimEntity, dt: number): void {
  const c = e.char;
  if (!c || !e.collider) return;
  const m = c.move;
  const cmd = e.input;
  e.yaw = cmd.yaw;
  e.pitch = cmd.pitch;

  // --- horizontal intent in world space (yaw 0 faces -Z) ---
  const sy = Math.sin(cmd.yaw), cy = Math.cos(cmd.yaw);
  const fx = -sy, fz = -cy;      // forward
  const rx = cy, rz = -sy;       // right
  let wx = fx * cmd.mz + rx * cmd.mx;
  let wz = fz * cmd.mz + rz * cmd.mx;
  const wlen = Math.hypot(wx, wz);
  if (wlen > 1) { wx /= wlen; wz /= wlen; }
  const aiming = held(e, Btn.Aim);
  const wantsSprint = held(e, Btn.Sprint) && !aiming && cmd.mz > 0.1;
  c.sprinting = wantsSprint && wlen > 0.1 && c.slideTime <= 0;
  c.slideCooldown = Math.max(0, c.slideCooldown - dt);

  // --- slide: crouch while running fast on the ground; keeps momentum, steers a little ---
  const hsNow = Math.hypot(e.vel.x, e.vel.z);
  if (pressed(e, Btn.Crouch) && c.grounded && c.slideTime <= 0 && c.slideCooldown <= 0 && hsNow > m.runSpeed * 0.9) {
    c.slideTime = SLIDE_TIME;
    const boost = Math.max(hsNow, m.sprintSpeed * SLIDE_BOOST) / Math.max(0.001, hsNow);
    e.vel.x *= boost; e.vel.z *= boost;
    ctx.emit?.({ e: 'ability', id: e.id, ability: 'slide', x: e.pos.x, y: e.pos.y, z: e.pos.z });
  }
  if (c.slideTime > 0) {
    c.slideTime -= dt;
    // Low friction, mild steering toward the stick direction.
    const decay = Math.exp(-SLIDE_FRICTION * dt);
    e.vel.x *= decay; e.vel.z *= decay;
    if (wlen > 0.05) {
      const sp = Math.hypot(e.vel.x, e.vel.z);
      const steer = Math.min(1, 3 * dt);
      const nx = e.vel.x + (wx * sp - e.vel.x) * steer, nz = e.vel.z + (wz * sp - e.vel.z) * steer;
      const nl = Math.hypot(nx, nz) || 1;
      e.vel.x = (nx / nl) * sp; e.vel.z = (nz / nl) * sp;
    }
    if (c.slideTime <= 0 || !c.grounded || Math.hypot(e.vel.x, e.vel.z) < m.walkSpeed) { c.slideTime = 0; c.slideCooldown = SLIDE_COOLDOWN; }
  } else if (!c.pounding) {
    const speed = aiming ? m.walkSpeed : c.sprinting ? m.sprintSpeed : m.runSpeed;
    const tx = wx * speed, tz = wz * speed;
    const accel = c.grounded ? (wlen > 0.05 ? m.groundAccel : m.groundDecel) : m.airAccel;
    const dvx = tx - e.vel.x, dvz = tz - e.vel.z;
    const dvLen = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dvLen <= maxDv) { e.vel.x = tx; e.vel.z = tz; }
    else { e.vel.x += (dvx / dvLen) * maxDv; e.vel.z += (dvz / dvLen) * maxDv; }
  }

  // --- ground pound: crouch in the air slams down ---
  if (pressed(e, Btn.Crouch) && !c.grounded && !c.pounding && c.airTime > 0.15) {
    c.pounding = true;
    e.vel.x *= 0.2; e.vel.z *= 0.2;
    e.vel.y = POUND_SPEED;
  }

  // --- jumping: buffer, coyote time, double jump, variable height ---
  if (pressed(e, Btn.Jump)) c.jumpBuffer = m.jumpBuffer;
  else c.jumpBuffer = Math.max(0, c.jumpBuffer - dt);
  const jumpHeldNow = held(e, Btn.Jump);
  if (c.jumpBuffer > 0 && !c.pounding) {
    if (c.grounded || c.airTime < m.coyoteTime) {
      if (c.slideTime > 0) { c.slideTime = 0; c.slideCooldown = SLIDE_COOLDOWN; } // slide-jump keeps momentum
      e.vel.y = m.jumpVelocity; c.jumpsUsed = 1; c.jumpBuffer = 0; c.grounded = false; c.airTime = m.coyoteTime;
      ctx.emit?.({ e: 'jump', id: e.id, double: false });
    } else if (c.jumpsUsed < 2 && m.doubleJumpVelocity > 0) {
      e.vel.y = m.doubleJumpVelocity; c.jumpsUsed = 2; c.jumpBuffer = 0;
      ctx.emit?.({ e: 'jump', id: e.id, double: true });
    }
  }
  if (c.jumpHeld && !jumpHeldNow && e.vel.y > 0) e.vel.y *= 0.5; // release early = shorter hop
  c.jumpHeld = jumpHeldNow;

  // --- gravity ---
  const g = GRAVITY * (e.vel.y < 0 ? m.fallGravityScale : 1);
  e.vel.y = c.pounding ? POUND_SPEED : Math.max(-40, e.vel.y + g * dt);

  // --- resting fast path: grounded, still, no intent, collider untouched since the last full sweep ---
  const t0 = e.collider.translation();
  if (c.grounded && !c.pounding && c.slideTime <= 0 && c.jumpBuffer <= 0 && wlen < 1e-3 && e.vel.y <= 0 &&
      Math.abs(e.vel.x) < 1e-3 && Math.abs(e.vel.z) < 1e-3 && t0.x === c.restX && t0.y === c.restY && t0.z === c.restZ) {
    e.vel.x = 0; e.vel.y = 0; e.vel.z = 0; c.airTime = 0; c.jumpsUsed = 0;
    e.anim = Anim.Idle as typeof e.anim;
    let f = e.flags & ~(EFlag.Grounded | EFlag.Sprinting | EFlag.Aiming | EFlag.Crouching);
    f |= EFlag.Grounded;
    if (aiming) f |= EFlag.Aiming;
    e.flags = f;
    return;
  }

  // --- collide & slide ---
  const desired = { x: e.vel.x * dt, y: e.vel.y * dt, z: e.vel.z * dt };
  ctx.kcc.computeColliderMovement(e.collider, desired, undefined, CHARACTER_MOVE_FILTER);
  const mv = ctx.kcc.computedMovement();
  const wasGrounded = c.grounded;
  c.grounded = ctx.kcc.computedGrounded();
  const t = e.collider.translation();
  const nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
  e.collider.setTranslation({ x: nx, y: ny, z: nz });
  e.pos.x = nx; e.pos.y = ny - (m.capsuleHalfHeight + m.capsuleRadius); e.pos.z = nz;
  // Collide & slide for velocity too: remove only the component pushing INTO what we actually hit (wall or
  // ceiling normals). The old "movement shorter than half the request → zero the axis" rule turned one-tick
  // controller hiccups into dead stops mid-sprint (QA W1).
  // Only a step that came up short horizontally can have hit a wall; the floor contact alone needs no response.
  const hBlocked = Math.abs(mv.x - desired.x) + Math.abs(mv.z - desired.z) > 1e-5;
  if (!hBlocked && e.vel.y > 0 && mv.y < desired.y * 0.5) e.vel.y = 0; // head bump without a wall
  const n = hBlocked ? ctx.kcc.numComputedCollisions() : 0;
  const feetBefore = t.y - (m.capsuleHalfHeight + m.capsuleRadius);
  for (let i = 0; i < n; i++) {
    const col = ctx.kcc.computedCollision(i, collisionScratch);
    if (!col) continue;
    collisionScratch = col;
    // Contacts at the very bottom of the capsule are floor contacts, even when the controller reports a skewed
    // normal (seam/edge artifacts on flat ground); treating them as walls kicked the character sideways.
    if (col.witness2.y - feetBefore < 0.06) continue;
    const nx = col.normal1.x, ny = col.normal1.y, nz = col.normal1.z; // outward from the obstacle
    if (ny < -0.6) { if (e.vel.y > 0) e.vel.y = 0; continue; } // ceiling / head bump
    if (ny > 0.6) continue; // floor-ish: grounding handles it
    const hl = Math.hypot(nx, nz);
    if (hl < 1e-4) continue;
    const hx = nx / hl, hz = nz / hl;
    const into = e.vel.x * hx + e.vel.z * hz;
    if (into < 0) { e.vel.x -= hx * into; e.vel.z -= hz * into; }
  }
  if (c.grounded) {
    if (!wasGrounded && e.vel.y < -2) {
      c.landImpact = -e.vel.y;
      ctx.emit?.({ e: 'land', id: e.id, impact: c.landImpact });
      if (c.pounding) ctx.emit?.({ e: 'ability', id: e.id, ability: 'ground_pound', x: e.pos.x, y: e.pos.y, z: e.pos.z });
    }
    c.pounding = false;
    if (e.vel.y < 0) e.vel.y = 0;
    c.airTime = 0; c.jumpsUsed = 0;
  } else {
    c.airTime += dt;
  }

  // Remember where a full sweep left a resting character (see the fast path above).
  const hsRest = Math.hypot(e.vel.x, e.vel.z);
  if (c.grounded && hsRest < 1e-3 && e.vel.y <= 0 && !c.pounding && c.slideTime <= 0) {
    const r = e.collider.translation();
    c.restX = r.x; c.restY = r.y; c.restZ = r.z;
  } else { c.restX = NaN; c.restY = NaN; c.restZ = NaN; }

  // --- presentation state ---
  const hs = Math.hypot(e.vel.x, e.vel.z);
  let anim: number = Anim.Idle;
  if (!c.grounded) anim = e.vel.y > 0 ? Anim.Jump : Anim.Fall;
  else if (c.slideTime > 0) anim = Anim.Slide;
  else if (hs < 0.3) anim = Anim.Idle;
  else if (c.sprinting) anim = Anim.Sprint;
  else if (hs < m.walkSpeed + 0.4) anim = Anim.Walk;
  else anim = Anim.Run;
  e.anim = anim as typeof e.anim;
  let f = e.flags & ~(EFlag.Grounded | EFlag.Sprinting | EFlag.Aiming | EFlag.Crouching);
  if (c.slideTime > 0 || c.pounding) f |= EFlag.Crouching;
  if (c.grounded) f |= EFlag.Grounded;
  if (c.sprinting) f |= EFlag.Sprinting;
  if (aiming) f |= EFlag.Aiming;
  e.flags = f;
}

export const movementSystem: SimSystem = {
  name: 'movement',
  order: 200,
  update(sim, dt) {
    const ctx: MoveContext = { world: sim.world, kcc: sim.kcc, emit: (ev) => sim.emit(ev) };
    for (const e of sim.entities.values()) {
      if (e.dead || !e.char || e.flags & EFlag.Mounted) continue; // mounted riders are moved by their vehicle
      stepCharacter(ctx, e, dt);
    }
  },
};
