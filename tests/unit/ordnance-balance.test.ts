// W9 X4 balance: the throwables add a soft counter without touching the guns. (1) The gun TTK table and the whole
// weapons/combat-rules content are byte-identical to before X4 (a snapshot + a content hash): no weapon number moved.
// (2) The damage band: no class is one-shot by a centre blast (the 90 hp classes keep 20), the falloff punishes a
// cluster (≈48 at 2 m), both factions share one blast. (3) The grenade is weaker than the Breacher's mortar shell.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { WEAPONS, WEAPON_IDS, COMBAT_RULES } from '../../src/shared/content/weapons';
import { CLASSES } from '../../src/shared/content/classes';
import { CLASS_IDS } from '../../src/shared/types';
import { ORDNANCE, ORDNANCE_BLAST, ORDNANCE_IDS, ORDNANCE_RULES } from '../../src/shared/content/ordnance';

/** Body shots to kill each class at close range and the time it takes (a direct hit + full blast for explosives). */
function ttkTable(): string[] {
  const rows: string[] = [];
  for (const id of WEAPON_IDS) {
    const w = WEAPONS[id];
    const per = w.damage * w.pellets + (w.projectile?.explodeDamage ?? 0);
    const cells = CLASS_IDS.map((c) => {
      const hp = CLASSES[c].maxHp;
      const shots = Math.ceil(hp / per);
      const ttk = (shots - 1) / w.fireRate + (w.chargeTime > 0 ? shots * w.chargeTime : 0);
      return `${c} ${shots}/${ttk.toFixed(3)}s`;
    });
    rows.push(`${id}: ${cells.join(', ')}`);
  }
  return rows;
}

/** Blast damage at distance d (m) from the capsule surface: explode()'s falloff. */
const blastAt = (d: number) => {
  const b = ORDNANCE_BLAST;
  const frac = d <= b.explodeInner ? 1 : 1 + (b.explodeEdgeFrac - 1) * ((Math.min(d, b.explodeRadius) - b.explodeInner) / (b.explodeRadius - b.explodeInner));
  return d > b.explodeRadius ? 0 : b.explodeDamage * frac;
};

describe('X4 balance', () => {
  it('the gun TTK table is unchanged (snapshot taken before X4 landed)', () => {
    expect(ttkTable()).toEqual([
      'squeaker_rifle: assault 8/0.700s, infiltrator 6/0.500s, overwatch 6/0.500s, breacher 11/1.000s, warden 10/0.900s, skyraider 7/0.600s',
      'snap_pistol: assault 5/0.800s, infiltrator 4/0.600s, overwatch 4/0.600s, breacher 7/1.200s, warden 6/1.000s, skyraider 4/0.600s',
      'laser_longshot: assault 2/2.109s, infiltrator 2/2.109s, overwatch 2/2.109s, breacher 2/2.109s, warden 2/2.109s, skyraider 2/2.109s',
      'tennis_mortar: assault 2/0.714s, infiltrator 1/0.000s, overwatch 1/0.000s, breacher 2/0.714s, warden 2/0.714s, skyraider 1/0.000s',
      'sprinkler_cannon: assault 2/0.625s, infiltrator 1/0.000s, overwatch 1/0.000s, breacher 2/0.625s, warden 2/0.625s, skyraider 2/0.625s',
      'frisbee_launcher: assault 3/0.800s, infiltrator 3/0.800s, overwatch 3/0.800s, breacher 4/1.200s, warden 4/1.200s, skyraider 3/0.800s',
      'claw_swipe: assault 14/3.714s, infiltrator 10/2.571s, overwatch 10/2.571s, breacher 18/4.857s, warden 16/4.286s, skyraider 12/3.143s',
    ]);
  });

  it('every weapon number, the combat rules and the class table are byte-identical (content hash from before X4)', () => {
    const h = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
    expect(h({ WEAPON_IDS, WEAPONS, COMBAT_RULES })).toBe('b5a5d2e75221ff7197817314c9c632a1a4c171a5a6ef0b837f5a6a2b1ffc44c1');
    expect(h(CLASSES)).toBe('9e6a53bfd2298a12de038991c82d580ee1f342840f6280a92eb2444aad6c29d0');
    expect(WEAPON_IDS.length).toBe(7); // the throwables are not weapons: no WEAPON_IDS entry, no loadout slot
  });

  it('the damage band: no one-shot at the centre for any class, a cluster at 2 m takes ~48, the edge 14', () => {
    const minHp = Math.min(...CLASS_IDS.map((c) => CLASSES[c].maxHp));
    expect(minHp).toBe(90);
    expect(blastAt(0)).toBe(70);
    expect(minHp - blastAt(0)).toBeGreaterThanOrEqual(20); // the frailest class survives with 20 (one more rifle burst)
    expect(blastAt(2)).toBeGreaterThan(45);
    expect(blastAt(2)).toBeLessThan(50);
    expect(blastAt(ORDNANCE_BLAST.explodeRadius)).toBeCloseTo(14, 6);
    // weaker than the Breacher's mortar shell (direct 25 + blast 85, 4 per magazine): the throwable never replaces it
    const mortar = WEAPONS.tennis_mortar.projectile!;
    expect(ORDNANCE_BLAST.explodeDamage).toBeLessThan(mortar.explodeDamage);
    expect(ORDNANCE_BLAST.knockback).toBeLessThan(mortar.knockback);
    // one per life, one per restockCooldown at the kiosk: far below a gun's sustained damage
    const rifleDps = WEAPONS.squeaker_rifle.damage * WEAPONS.squeaker_rifle.fireRate;
    expect(ORDNANCE_BLAST.explodeDamage / ORDNANCE_RULES.restockCooldown).toBeLessThan(rifleDps * 0.05);
    const table = [0, 1, 2, 3, 4].map((d) => `${d} m ${blastAt(d).toFixed(1)}`).join(' · ');
    console.log(`[X4 balance] blast by distance to the capsule: ${table}`);
  });

  it('both factions: one power budget (the blast), different bounce feel', () => {
    const blast = (id: (typeof ORDNANCE_IDS)[number]) => {
      const p = ORDNANCE[id].projectile;
      return [p.explodeRadius, p.explodeDamage, p.explodeInner, p.explodeEdgeFrac, p.selfDamageMult, p.knockback, p.lifetime, p.speed, p.gravity, p.fuse];
    };
    expect(blast('squeaker_grenade')).toEqual(blast('hairball_bomb'));
    expect(ORDNANCE.squeaker_grenade.grip).toBeGreaterThan(ORDNANCE.hairball_bomb.grip);
    expect(ORDNANCE.hairball_bomb.rollDecel).toBeGreaterThan(ORDNANCE.squeaker_grenade.rollDecel);
  });
});
