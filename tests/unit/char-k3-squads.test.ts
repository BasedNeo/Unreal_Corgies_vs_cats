// W9 K3: the hardened squads (alley-cat raiders, tabby heavies), their kits on the shared rig, the veteran rank insignia,
// the rear team strobe and the under-suit value lift.
//   sim:    archetype data that asks for different answers (flank vs hold), the squad kit named from class + max hp (no
//           protocol field), the frontal guard (one guarded line in applyDamage), the skirmish wave slots;
//   client: squad kits inside the budgets with a class kit's draws, the kit picked by EntityViews from a snapshot, team
//           read and K1 class distances not lower than before K3 on any kit, the lifted suit never a team hue.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { createWorldData } from '../../src/shared/world/world-data';
import { ARCHETYPES, SQUAD_KITS, guardFactor, squadKitFor, type ArchetypeId } from '../../src/sim/ai/archetypes';
import { applyArchetype } from '../../src/sim/ai';
import { applyDamage } from '../../src/sim/combat/damage';
import { ensureCombat } from '../../src/sim/combat/state';
import { SKIRMISH, type MatchConfigOverrides } from '../../src/sim/match/config';
import { CLASSES } from '../../src/shared/content/classes';
import { PICKUPS } from '../../src/shared/content/pickups';
import { WEAPON_IDS } from '../../src/shared/content/weapons';
import { packEntity, unpackEntity, type EntityState, type MatchState } from '../../src/shared/protocol';
import { Anim, CLASS_IDS, EntityKind, Species, Team, type AnimId, type ClassId, type SpeciesId, type TeamId } from '../../src/shared/types';
import { createCharacter, characterCacheSize, HERO_TRI_BUDGET, NPC_TRI_BUDGET, type CharacterAvatar } from '../../src/client/procgen/characters';
import { silhouetteMasks, silhouetteDistance } from '../../src/client/procgen/characters/silhouette';
import { teamRead, readsAsTeam, hslOf } from '../../src/client/procgen/cosmetics/readability';
import { SUIT_CORGI, SUIT_CAT, UNDERSUIT, OCHRE, BRASS, mixHex } from '../../src/client/procgen/characters/colors';
import { PALETTE } from '../../src/client/style/style-tokens.js';
import { factionGear, teamColors } from '../../src/client/procgen/characters/gear';
import { cosmeticsFor } from '../../src/shared/content/cosmetics';
import { EntityViews } from '../../src/client/views/entity-views';
import type { AvatarFrame } from '../../src/client/views/avatar';

const DEG = Math.PI / 180;
const MARGIN = 20;
const frame = (o: Partial<AvatarFrame> = {}): AvatarFrame => ({ speed: 0, vy: 0, grounded: true, anim: Anim.Idle as AnimId, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false, ...o });
const settle = (av: CharacterAvatar, n = 30) => { for (let i = 0; i < n; i++) av.update(frame(), 1 / 60); };
const SQUAD_CLS: Record<'alley' | 'heavy', ClassId> = { alley: 'infiltrator', heavy: 'assault' };
const luma = (h: number) => 0.2126 * ((h >> 16) & 255) + 0.7152 * ((h >> 8) & 255) + 0.0722 * (h & 255);

function measure(av: CharacterAvatar) {
  let tris = 0, draws = 0;
  const styles = new Set<string>();
  av.root.traverse((o) => {
    const m = o as THREE.Mesh & { isLineSegments2?: boolean };
    if (m.isLineSegments2) { draws++; return; }
    if (!m.isMesh) return;
    draws++;
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
    for (const mat of [m.material].flat()) styles.add(String(mat.userData?.style));
  });
  return { tris, draws, styles };
}

// ------------------------------------------------------------------------------------------------------------ sim

describe('K3 squads: archetypes', () => {
  const A = ARCHETYPES;
  it('two new PvE archetypes (new ids) whose numbers ask for different answers: flank vs hold', () => {
    const r = A.alley_raider, h = A.tabby_heavy, g = A.grunt;
    // raiders: light, fast, fragile, close and circling, no cloak, no guard
    expect(r).toMatchObject({ kit: 'alley', cls: 'infiltrator', weapon: 'snap_pistol', abilityUse: 0 });
    expect(r.hp!).toBeLessThan(CLASSES.infiltrator.maxHp);
    expect(r.hp!).toBeLessThan(CLASSES[g.cls].maxHp);
    expect(r.speedMult).toBeGreaterThan(1);
    expect(r.strafe).toBeGreaterThanOrEqual(0.9);
    expect(r.jumpRate).toBeGreaterThan(g.jumpRate);
    expect(r.preferRange![1]).toBeLessThanOrEqual(12);
    expect(r.guard).toBeUndefined();
    // heavies: slow, tanky, planted, slow to turn, a frontal guard
    expect(h).toMatchObject({ kit: 'heavy', cls: 'assault', weapon: 'squeaker_rifle', retreatHp: 0, jumpRate: 0 });
    expect(h.hp!).toBeGreaterThan(CLASSES.assault.maxHp);
    expect(h.hp!).toBeLessThan(A.brute.hp!);                // tanky, but under the brute (EHP from the front: hp / (1 - reduce))
    expect(h.speedMult).toBeLessThan(0.85);
    expect(h.strafe).toBeLessThanOrEqual(0.2);
    expect(h.turnRate).toBeLessThan(g.turnRate);            // a flank gets round the guard
    expect(h.guard!.reduce).toBeGreaterThan(0);
    expect(h.guard!.reduce).toBeLessThanOrEqual(0.5);
    expect(h.guard!.arc).toBeLessThan(Math.PI / 2);
    // the team-fill profiles that already used the names 'raider' and 'guard' are untouched
    expect(A.raider).toMatchObject({ id: 'raider', cls: 'skyraider' });
    expect(A.guard).toMatchObject({ id: 'guard', cls: 'warden' });
    expect(A.raider.kit ?? null).toBeNull();
    expect(Object.values(A).filter((a) => a.kit).map((a) => a.kit).sort()).toEqual([...SQUAD_KITS].sort());
  });

  it('squadKitFor names each squad from class + max hp, and no class, Upgrade Core or other archetype collides', () => {
    for (const a of Object.values(ARCHETYPES)) {
      if (a.kit) expect(squadKitFor(a.cls, a.hp!)).toBe(a.kit);
      else expect(squadKitFor(a.cls, a.hp ?? CLASSES[a.cls].maxHp), a.id).toBeNull();
    }
    const mults = Object.values(PICKUPS).map((p) => (p.buff as { maxHp?: number }).maxHp).filter((m): m is number => !!m && m !== 1);
    expect(mults.length).toBeGreaterThan(0);
    for (const c of CLASS_IDS) {
      const base = CLASSES[c].maxHp;
      // buffs.ts: max + max(1, round(max × (m − 1)))
      for (const hp of [base, ...mults.map((m) => base + Math.max(1, Math.round(base * (m - 1))))]) expect(squadKitFor(c, hp), `${c} ${hp}`).toBeNull();
    }
    expect(squadKitFor(null, 60)).toBeNull();
    expect(squadKitFor(undefined, 180)).toBeNull();
  });

  it('guardFactor: hits from inside the arc are reduced; flanks, backs, unguarded archetypes and junk take full damage', () => {
    const g = ARCHETYPES.tabby_heavy.guard!;
    const at = (deg: number, d = 6) => guardFactor('tabby_heavy', 0, 0, 0, -Math.sin(deg * DEG) * d, -Math.cos(deg * DEG) * d); // yaw 0 faces -Z
    expect(at(0)).toBeCloseTo(1 - g.reduce);
    expect(at(g.arc / DEG - 3)).toBeCloseTo(1 - g.reduce);
    expect(at(-(g.arc / DEG - 3))).toBeCloseTo(1 - g.reduce);
    expect(at(g.arc / DEG + 3)).toBe(1);
    expect(at(90)).toBe(1);
    expect(at(180)).toBe(1);
    // facing +X (yaw -90°): an attacker at +X is frontal, one at -Z is a flank
    expect(guardFactor('tabby_heavy', -Math.PI / 2, 0, 0, 5, 0)).toBeCloseTo(1 - g.reduce);
    expect(guardFactor('tabby_heavy', -Math.PI / 2, 0, 0, 0, -5)).toBe(1);
    expect(guardFactor('tabby_heavy', 0, 0, 0, 0, 0)).toBe(1);                // on top of it
    for (const id of ['grunt', 'alley_raider', 'brute', 'rifleman', 'nope', '__proto__', undefined]) expect(guardFactor(id, 0, 0, 0, 0, -5), String(id)).toBe(1);
  });
});

describe('K3 squads: the frontal guard in combat', () => {
  it('one guarded line in applyDamage: a PvE heavy takes 1 - reduce from the front, full from the back; a grunt and a non-PvE bot always full', async () => {
    const sim = await Sim.create({ seed: 5, world: createWorldData(5) });
    const s = sim.pickSpawn(Team.Cats);
    const bot = (arch: ArchetypeId, x: number, pve = true): SimEntity => {
      const e = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, cls: ARCHETYPES[arch].cls, name: arch, x: s.x + x, y: s.y, z: s.z, yaw: 0 });
      ensureCombat(e);
      e.combat!.pve = pve;
      applyArchetype(e, arch);
      e.yaw = 0; // faces -Z
      return e;
    };
    const heavy = bot('tabby_heavy', 0), grunt = bot('grunt', 3), fill = bot('tabby_heavy', -3, false);
    const hit = (dst: SimEntity, fromZ: number) => {
      const shooter = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'shooter', x: dst.pos.x, y: dst.pos.y, z: dst.pos.z + fromZ, yaw: 0 });
      const dealt = applyDamage(sim, dst, 20, { id: shooter.id, team: Team.Corgis, weapon: 0 }, dst.pos.x, dst.pos.y + 0.5, dst.pos.z, false);
      sim.removeEntity(shooter.id);
      return dealt;
    };
    const r = ARCHETYPES.tabby_heavy.guard!.reduce;
    expect(heavy.health!.max).toBe(ARCHETYPES.tabby_heavy.hp);
    expect(hit(heavy, -6)).toBe(Math.round(20 * (1 - r)));   // in front (-Z)
    expect(hit(heavy, 6)).toBe(20);                          // behind
    heavy.yaw = Math.PI;                                     // turned round: the same shooter behind is now in front
    expect(hit(heavy, 6)).toBe(Math.round(20 * (1 - r)));
    expect(hit(grunt, -6)).toBe(20);
    expect(hit(fill, -6)).toBe(20);                          // the guard is PvE only
  });
});

describe('K3 squads: skirmish waves', () => {
  // Pre-K3 waves (config.ts before W9 K3): the difficulty band was measured against these (docs/handoff/K3.md).
  const BEFORE: Partial<Record<ArchetypeId, number>>[] = [
    { grunt: 3 }, { grunt: 4, kitten: 2 }, { grunt: 4, sniper: 1, kitten: 4 }, { grunt: 5, sniper: 2, brute: 1, kitten: 4 }, { grunt: 3, kitten: 3 },
  ];
  const size = (c: Partial<Record<ArchetypeId, number>>) => Object.values(c).reduce((a, b) => a + (b ?? 0), 0);

  it('wave 1 is unchanged (learn the basics), raiders join from wave 2, a heavy from wave 3; no wave is bigger than before', () => {
    const W = SKIRMISH.waves;
    expect(W.length).toBe(BEFORE.length);
    expect(W[0]).toEqual({ counts: { grunt: 3 }, maxAlive: 2 });
    expect(W[1].maxAlive).toBe(4);
    expect(W[1].counts.alley_raider ?? 0).toBeGreaterThan(0);
    expect(W[1].counts.tabby_heavy ?? 0).toBe(0);
    expect(W[2].counts.tabby_heavy ?? 0).toBeGreaterThan(0);
    expect(W[3].counts.alley_raider ?? 0).toBeGreaterThan(0);
    expect(W[3].counts.tabby_heavy ?? 0).toBeGreaterThan(0);
    expect(W[4]).toMatchObject({ label: 'FINAL WAVE', boss: 'vac_tank' });
    W.forEach((w, i) => {
      expect(size(w.counts), `wave ${i + 1}`).toBeLessThanOrEqual(size(BEFORE[i]));
      for (const id of Object.keys(w.counts)) expect(ARCHETYPES[id as ArchetypeId], id).toBeDefined();
    });
  });

  it('a wave spawns the squads with their archetype stats, and their snapshot names the kit (class + max hp, no new field)', async () => {
    const sim = await Sim.create({ seed: 11, world: createWorldData(11) });
    sim.state.room = { mode: 'yard-skirmish' };
    sim.state.matchConfig = { skirmish: { warmup: 0.2, spawnInterval: 0.1, spawnBatch: 4, waves: [{ counts: { alley_raider: 1, tabby_heavy: 1 } }] } } satisfies MatchConfigOverrides;
    const s = sim.pickSpawn(Team.Corgis);
    sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'hero', x: s.x, y: s.y, z: s.z, yaw: s.yaw });
    const pve = () => [...sim.entities.values()].filter((e) => e.char && e.combat?.pve && !e.dead);
    for (let i = 0; i < 60 * 3 && pve().length < 2; i++) { sim.step(); sim.drainEvents(); }
    expect((sim.state.match as MatchState).phase).toBe('live');
    const cats = pve();
    expect(cats.map((e) => e.ai!.arch).sort()).toEqual(['alley_raider', 'tabby_heavy']);
    for (const e of cats) {
      const a = ARCHETYPES[e.ai!.arch];
      expect(e.team).toBe(Team.Cats);
      expect(e.health!.max).toBe(a.hp);
      expect(WEAPON_IDS[e.weapon]).toBe(a.weapon);
      const ref = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, cls: a.cls, name: 'ref', x: e.pos.x + 30, y: e.pos.y, z: e.pos.z });
      expect(e.char!.move.runSpeed / ref.char!.move.runSpeed).toBeCloseTo(a.speedMult, 5);
      sim.removeEntity(ref.id);
      // what a client gets: the packed snapshot state → squadKitFor(class, max hp)
      const st = unpackEntity(packEntity(sim.toState(e)));
      expect(squadKitFor(CLASS_IDS[st.cls], st.maxHp)).toBe(a.kit);
    }
  });
});

// --------------------------------------------------------------------------------------------------------- client

describe('K3 squads: kits', () => {
  const necks = cosmeticsFor(Species.Cat, 'neck').map((c) => c.id).filter((id) => id !== 'neck_none');

  it('every squad × species × team × tier fits its budget with a 20-triangle margin (team collar and every neckwear), draws like a class kit, style materials only', () => {
    const errors: string[] = [];
    for (const squad of ['alley', 'heavy'] as const) for (const species of [Species.Cat, Species.Corgi] as SpeciesId[]) for (const team of [Team.Cats, Team.Corgis] as TeamId[]) for (const isLocal of [true, false]) {
      for (const neck of [undefined, ...necks]) {
        const av = createCharacter({ species, cls: SQUAD_CLS[squad], team, seed: 3, isLocal, squad, look: neck ? { neck } : null });
        const cls = createCharacter({ species, cls: SQUAD_CLS[squad], team, seed: 3, isLocal, look: neck ? { neck } : null });
        try {
          const m = measure(av), budget = (isLocal ? HERO_TRI_BUDGET : NPC_TRI_BUDGET) - MARGIN;
          const tag = `${squad} ${species} t${team} ${isLocal ? 'hero' : 'npc'} ${neck ?? 'collar'}`;
          if (m.tris !== av.stats.triangles) errors.push(`${tag}: stats ${av.stats.triangles} != ${m.tris}`);
          if (m.tris > budget) errors.push(`${tag}: ${m.tris} > ${budget}`);
          if (m.draws !== measure(cls).draws || av.stats.drawCalls !== cls.stats.drawCalls) errors.push(`${tag}: ${m.draws} draws, class kit ${measure(cls).draws}`);
          for (const s of m.styles) if (!['toon', 'glow'].includes(s)) errors.push(`${tag}: material ${s}`);
          if (av.stats.squad !== squad || cls.stats.squad !== null) errors.push(`${tag}: stats.squad`);
          if (av.skinned.geometry === cls.skinned.geometry) errors.push(`${tag}: shares the class body`);
        } finally { av.dispose(); cls.dispose(); }
      }
    }
    expect(errors).toEqual([]);
    expect(characterCacheSize()).toBe(0);
  });

  it('a squad kit ignores the veteran flag (its own look) and caches per squad', () => {
    const a = createCharacter({ species: Species.Cat, cls: 'assault', team: Team.Cats, seed: 3, isLocal: false, squad: 'heavy', veteran: true });
    const b = createCharacter({ species: Species.Cat, cls: 'assault', team: Team.Cats, seed: 3, isLocal: false, squad: 'heavy' });
    expect(a.stats.veteran).toBe(false);
    expect(a.skinned.geometry).toBe(b.skinned.geometry);
    a.dispose(); b.dispose();
    expect(characterCacheSize()).toBe(0);
  });

  it('squads carry the team: ≥ 6 % of the visible cells in the team hue, both teams', () => {
    for (const squad of ['alley', 'heavy'] as const) for (const team of [Team.Cats, Team.Corgis] as TeamId[]) {
      const av = createCharacter({ species: Species.Cat, cls: SQUAD_CLS[squad], team, seed: 3, isLocal: false, squad });
      settle(av);
      const r = teamRead(av.root, team);
      av.dispose();
      expect(r.team, `${squad} team ${team}`).toBeGreaterThanOrEqual(0.06);
      // as fielded (team Cats): no corgi blue anywhere (in the swap case the oxblood paint is crimson-family by design, K2)
      if (team === Team.Cats) expect(r.enemy, `${squad} team ${team}`).toBeLessThan(0.005);
    }
  });

  it('squads read apart at range (K1 metric, NPC tier): raider vs heavy, and each vs every class kit', () => {
    for (const seed of [1, 3]) for (const species of [Species.Cat, Species.Corgi] as SpeciesId[]) {
      const mask = (cls: ClassId, squad: 'alley' | 'heavy' | null) => {
        const av = createCharacter({ species, cls, team: Team.Cats, seed, isLocal: false, squad });
        settle(av);
        const m = silhouetteMasks(av.root);
        av.dispose();
        return m;
      };
      const al = mask('infiltrator', 'alley'), hv = mask('assault', 'heavy');
      expect(silhouetteDistance(al, hv), `seed ${seed} ${species}`).toBeGreaterThanOrEqual(0.14);
      for (const c of CLASS_IDS) {
        const cm = mask(c, null);
        expect(silhouetteDistance(al, cm), `raider vs ${c}`).toBeGreaterThanOrEqual(0.09);
        expect(silhouetteDistance(hv, cm), `heavy vs ${c}`).toBeGreaterThanOrEqual(0.06);
      }
    }
  });

  it('the bin lid rides the left forearm, the bottle-cap pauldron the left upper arm (rigid, like K2 plates)', () => {
    const rigidAt = (av: CharacterAvatar, bone: string, pick: (x: number, y: number, z: number) => boolean) => {
      const g = av.skinned.geometry, p = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
      const b = av.skinned.skeleton.bones.findIndex((x) => x.name === bone);
      let n = 0;
      for (let i = 0; i < p.count; i++) if (sw.getX(i) > 0.999 && si.getX(i) === b && pick(p.getX(i), p.getY(i), p.getZ(i))) n++;
      return n;
    };
    const heavy = createCharacter({ species: Species.Cat, cls: 'assault', team: Team.Cats, seed: 3, isLocal: false, squad: 'heavy' });
    const plain = createCharacter({ species: Species.Cat, cls: 'assault', team: Team.Cats, seed: 3, isLocal: false });
    const lidVerts = rigidAt(heavy, 'foreArm.L', () => true) - rigidAt(plain, 'foreArm.L', () => true);
    expect(lidVerts).toBeGreaterThan(40); // the dome, its rolled rim
    const raider = createCharacter({ species: Species.Cat, cls: 'infiltrator', team: Team.Cats, seed: 3, isLocal: false, squad: 'alley' });
    expect(rigidAt(raider, 'upperArm.L', () => true)).toBeGreaterThan(rigidAt(raider, 'upperArm.R', () => true) + 15); // one big cap, left only
    heavy.dispose(); plain.dispose(); raider.dispose();
  });

  it('EntityViews draws the squad kit a snapshot names (class + max hp) and the class kit for everything else', () => {
    const scene = new THREE.Scene();
    const views = new EntityViews(scene);
    const st = (id: number, kind: number, cls: ClassId, maxHp: number, team: TeamId = Team.Cats): EntityState => ({
      id, kind, team, species: Species.Cat, cls: CLASS_IDS.indexOf(cls), seed: 40 + id, x: id * 2, y: 0, z: 0, yaw: 0, pitch: 0,
      vx: 0, vy: 0, vz: 0, hp: maxHp, maxHp, anim: Anim.Idle, flags: 1, weapon: 0, ammo: 0,
    } as EntityState);
    const states = new Map<number, EntityState>([
      [1, st(1, EntityKind.Bot, 'infiltrator', ARCHETYPES.alley_raider.hp!)],
      [2, st(2, EntityKind.Bot, 'assault', ARCHETYPES.tabby_heavy.hp!)],
      [3, st(3, EntityKind.Bot, 'infiltrator', ARCHETYPES.kitten.hp!)],
      [4, st(4, EntityKind.Bot, 'assault', CLASSES.assault.maxHp)],
      [5, st(5, EntityKind.Player, 'assault', ARCHETYPES.tabby_heavy.hp!)], // a player never wears a squad kit
    ]);
    views.sync(states, 5, 1 / 60);
    const squadOf = (id: number) => (views.get(id)!.avatar as CharacterAvatar).stats.squad;
    expect([1, 2, 3, 4, 5].map(squadOf)).toEqual(['alley', 'heavy', null, null, null]);
    views.sync(new Map(), 5, 1 / 60); // everything gone: the views are released
    expect(characterCacheSize()).toBe(0);
  });
});

describe('K3 under-suit lift, team read, K1 classes, rank insignia', () => {
  it('the field suit is lifted (≥ 1.6× the old value, sRGB luma ≥ 60) but stays under the plates and is never a team hue', () => {
    const OLD_CAT = 0x2d2a2c; // mixHex(CHARCOAL, INK, 0.45), the pre-K3 cat suit
    expect(luma(SUIT_CORGI)).toBeGreaterThanOrEqual(1.6 * luma(UNDERSUIT));
    expect(luma(SUIT_CAT)).toBeGreaterThanOrEqual(1.6 * luma(OLD_CAT));
    for (const s of [SUIT_CORGI, SUIT_CAT]) {
      expect(luma(s)).toBeGreaterThanOrEqual(60);
      expect(luma(s)).toBeLessThan(luma(OCHRE));
      expect(luma(s)).toBeLessThan(luma(BRASS));
      expect(hslOf(s).s).toBeLessThan(0.3); // a drab, not a colour
      for (const t of [Team.Corgis, Team.Cats] as TeamId[]) expect(readsAsTeam(s, t), `#${s.toString(16)} team ${t}`).toBe(false);
    }
    expect(factionGear('corgi').suit).toBe(SUIT_CORGI);
    expect(factionGear('cat').suit).toBe(SUIT_CAT);
  });

  // Per kit, NPC tier, seed 3, idle (readability.teamRead), measured on the tree before K3 (HEAD 38db372), floored.
  const TEAM_BEFORE: Record<string, number> = {"corgi assault t0":8.07,"corgi assault t0 vet":8.84,"corgi infiltrator t0":11.4,"corgi infiltrator t0 vet":12.17,"corgi overwatch t0":7.87,"corgi overwatch t0 vet":7.93,"corgi breacher t0":10.49,"corgi breacher t0 vet":8.26,"corgi warden t0":24.18,"corgi warden t0 vet":24.3,"corgi skyraider t0":9.36,"corgi skyraider t0 vet":9.58,"corgi assault t1":6.18,"corgi assault t1 vet":6.71,"corgi infiltrator t1":8.24,"corgi infiltrator t1 vet":8.58,"corgi overwatch t1":8.33,"corgi overwatch t1 vet":8.24,"corgi breacher t1":10.13,"corgi breacher t1 vet":10.13,"corgi warden t1":23.17,"corgi warden t1 vet":23.22,"corgi skyraider t1":9.67,"corgi skyraider t1 vet":9.81,"cat assault t0":7.93,"cat assault t0 vet":8.15,"cat infiltrator t0":11.59,"cat infiltrator t0 vet":11.43,"cat overwatch t0":8.16,"cat overwatch t0 vet":8.15,"cat breacher t0":9.91,"cat breacher t0 vet":7.52,"cat warden t0":31.97,"cat warden t0 vet":31.93,"cat skyraider t0":9.08,"cat skyraider t0 vet":9.24,"cat assault t1":16.23,"cat assault t1 vet":16.57,"cat infiltrator t1":18.44,"cat infiltrator t1 vet":18.23,"cat overwatch t1":15.38,"cat overwatch t1 vet":15.78,"cat breacher t1":14.73,"cat breacher t1 vet":13.92,"cat warden t1":43.06,"cat warden t1 vet":43.25,"cat skyraider t1":19.05,"cat skyraider t1 vet":19.72};

  it('team read is not lower than before K3 on any of the 48 kits (24 class × species × team, plain and veteran), and ≥ K2\'s 5 % floor', () => {
    const low: string[] = [];
    for (const species of [Species.Corgi, Species.Cat] as SpeciesId[]) for (const team of [Team.Corgis, Team.Cats] as TeamId[]) for (const cls of CLASS_IDS) for (const veteran of [false, true]) {
      const av = createCharacter({ species, cls, team, seed: 3, isLocal: false, veteran });
      settle(av);
      const pct = teamRead(av.root, team).team * 100;
      av.dispose();
      const k = `${species === Species.Cat ? 'cat' : 'corgi'} ${cls} t${team}${veteran ? ' vet' : ''}`;
      if (pct < TEAM_BEFORE[k] || pct < 5) low.push(`${k}: ${pct.toFixed(2)} % < ${TEAM_BEFORE[k]} %`);
    }
    expect(low).toEqual([]);
  }, 120_000);

  // Closest class pair per seed and species, NPC tier, measured on the tree before K3 (post-K2): [corgi, cat].
  const K1_BEFORE: Record<number, [number, number]> = { 1: [0.1471, 0.1476], 3: [0.1496, 0.1445], 13: [0.1673, 0.1497] };
  it('K1: the closest class pair of every seed and species is no closer than before K3 (strobes, caps and chevrons included)', () => {
    for (const seed of [1, 3, 13]) for (const [si, species] of ([Species.Corgi, Species.Cat] as SpeciesId[]).entries()) {
      const masks = CLASS_IDS.map((cls) => { const av = createCharacter({ species, cls, team: species === Species.Cat ? Team.Cats : Team.Corgis, seed, isLocal: false }); settle(av); const m = silhouetteMasks(av.root); av.dispose(); return m; });
      let min = 1;
      for (let a = 0; a < masks.length; a++) for (let b = a + 1; b < masks.length; b++) min = Math.min(min, silhouetteDistance(masks[a], masks[b]));
      expect(min, `seed ${seed} species ${species}`).toBeGreaterThanOrEqual(K1_BEFORE[seed][si] - 1e-4);
    }
  });

  it('rank insignia: gold chevrons rigid on both upper arms of a corgi veteran, a brass medal on a cat veteran\'s chest; none without the rank', () => {
    const count = (av: CharacterAvatar, color: number, bone: RegExp) => {
      const g = av.skinned.geometry, c = g.getAttribute('color'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
      const names = av.skinned.skeleton.bones.map((b) => b.name), want = new THREE.Color(color);
      let n = 0;
      for (let i = 0; i < c.count; i++) if (Math.abs(c.getX(i) - want.r) + Math.abs(c.getY(i) - want.g) + Math.abs(c.getZ(i) - want.b) < 1e-4 && bone.test(names[si.getX(i)]) && sw.getX(i) > 0.5) n++;
      return n;
    };
    const gold = teamColors(Team.Corgis).trim;
    for (const isLocal of [true, false]) {
      const vet = createCharacter({ species: Species.Corgi, cls: 'overwatch', team: Team.Corgis, seed: 3, isLocal, veteran: true });
      const plain = createCharacter({ species: Species.Corgi, cls: 'overwatch', team: Team.Corgis, seed: 3, isLocal });
      for (const side of ['L', 'R']) expect(count(vet, gold, new RegExp(`^upperArm\\.${side}$`)), side).toBeGreaterThan(count(plain, gold, new RegExp(`^upperArm\\.${side}$`)));
      vet.dispose(); plain.dispose();
    }
    const cat = createCharacter({ species: Species.Cat, cls: 'assault', team: Team.Cats, seed: 3, isLocal: true, veteran: true });
    const catPlain = createCharacter({ species: Species.Cat, cls: 'assault', team: Team.Cats, seed: 3, isLocal: true });
    const medal = mixHex(BRASS, PALETTE.accentHot, 0.35); // the medal's polished brass (gear.ts rankInsignia)
    expect(count(cat, medal, /^(spine|chest)$/)).toBeGreaterThan(8);
    expect(count(catPlain, medal, /^(spine|chest)$/)).toBe(0);
    cat.dispose(); catPlain.dispose();
    expect(characterCacheSize()).toBe(0);
  });

  it('a rear team strobe in the lamp mesh (no new draw) on assault, breacher, warden and skyraider: seen from behind', () => {
    for (const cls of ['assault', 'breacher', 'warden', 'skyraider'] as ClassId[]) for (const team of [Team.Corgis, Team.Cats] as TeamId[]) {
      const av = createCharacter({ species: Species.Corgi, cls, team, seed: 3, isLocal: false });
      let lamp: THREE.SkinnedMesh | null = null;
      av.root.traverse((o) => { if (o.name === 'kit_glow') lamp = o as THREE.SkinnedMesh; });
      const p = (lamp as unknown as THREE.SkinnedMesh).geometry.getAttribute('position');
      let back = -Infinity;
      for (let i = 0; i < p.count; i++) back = Math.max(back, p.getZ(i)); // +Z = behind the character
      expect(back, `${cls} team ${team}`).toBeGreaterThan(0.05);
      av.dispose();
    }
  });
});
