# W14 respawn: equal time back to the slab (lane G-MOVE)

**Change:** `engines/godot/game/match.gd`. A downed pet now comes back at one of its team's respawn points
(`respawn_slots`, set by `_pick_respawn_slots`). All of them lie in one 0.3 s band of straight-line sprint time to
the slab: the band ends at the Corgis' start slot 0 (14.95 s).
- **Corgis:** slot 0 (spawn 0, on the slab path's line), plus two points 1.3 m and 2.6 m further along that line
  towards the slab (14.81 s and 14.68 s).
- **Cats:** their spawns inside the band, (68, 111) at 14.79 s and (56, 117) at 14.74 s.
- **Choosing one:** a point a living teammate stands on is skipped. Of the rest, the pet takes the one farthest from
  the nearest living enemy (anti-camping, as before). There is no random jitter any more.
- **Unchanged:** the match start (G-BOT's `start_slots`), `--demo`'s first-match respawn by the slab, and `--lineup`.

**Why the Corgi points are on one line.** A straight run from 7 of the 16 Corgi spawns stalls at the pit wall or in
trench T1. The probe pressed only move_forward + sprint at 52 deg on the W13 data: Corgi spawns 4, 7, 8, 10, 12, 13
and 14 stall (data order). From every Cat spawn, the run reaches the slab.

## Numbers
`tests/test_game_respawn.gd` runs a 2v2 (the human and a Corgi bot against two Cat bots, bots frozen) for 9 rounds.
In each round the pets that stay up stand somewhere else (the slab, either half, either base, the slab path), and one
pet of each team is downed in the same tick. The last round downs all four. That gives n = 10 respawns per team.
The sprint time is the straight-line distance to the slab centre divided by the species' sprint (Corgi 9.6 m/s,
Cat 8.8 m/s).

| | W13 (HEAD 3b9b956) Corgi | W13 Cat | W14 Corgi | W14 Cat |
|---|---|---|---|---|
| mean respawn distance to the slab | 143.7 m | 143.7 m | 143.4 m | 130.1 m |
| mean straight sprint time | 14.96 s | 16.32 s | 14.94 s | 14.78 s |
| range of sprint times | 14.83-15.04 s | 16.25-16.40 s | 14.82-14.95 s | 14.74-14.79 s |
| largest Corgi-Cat gap, any two respawns | 1.57 s | | **0.21 s** | |
| measured run back, sprint (only W + Shift) | 16.75-16.95 s | 17.52-17.62 s | 16.78-16.92 s | 15.40-16.02 s |
| measured run back, run (only W) | 25.0-25.3 s | 23.3-23.4 s | 25.07-25.27 s | 20.47-21.30 s |

- **W13:** both teams respawned about 143.7 m out. That is the spawn farthest from the nearest enemy, which with
  the enemies around the slab is each team's far corner, plus a ±0.8 m random jitter. At equal distance the
  faster-sprinting Corgi was back 1.4 s sooner.
- **W14:** the straight-line sprint times match within 0.21 s. Two pets of a team that respawn together get
  different points.

**Note for the lead (measured, not changed).** The straight-line metric (G-BOT's, used here as asked) does not count
the Corgis' route. The slab path dips through trenches T1 and T3, and the run includes the slide along the pallet
stack. On the measured runs from the W14 respawn points, the Cat sprints back 0.8-1.4 s sooner, and runs back about
4 s sooner. The match start has the same lean: from Corgi slot 0 the run takes 16.92 s, against 16.07 s from the Cats'
slot 0 at (62, 117). To even the real trip as well, the band would be set from measured run times rather than
distances; that is a G-BOT/lead decision.

## Proof
- Private copy = `git archive 3b9b956` + `match.gd`, `test_game_respawn.gd` and `test_game_stepup.gd` (`_routes`
  now takes start points).
- `--only respawn`: PASS. Against HEAD's `match.gd` it fails with "a Corgi and a Cat respawn differ by 1.57 s"
  and "round 8: both Cats respawned on one point".
- Full suite: 16/16 PASS (1 min 33 s).

## Measured path times (for the SAMPLE step)
**How measured.** Godot headless, 52 deg, the W13 Lot data, 1/60 s ticks (run at 4x). A Player pet faces the slab and
presses only move_forward (+ sprint): no jump, no steering. The time is to its first step onto the 8 x 8 m slab, at
species speeds Corgi 9.6 / 6.4 m/s and Cat 8.8 / 6.6 m/s (sprint / run). The numbers come from
`test_game_stepup.gd`, `test_game_respawn.gd`, and a private all-spawn probe that does the same straight sprint
through `move_pet`.

| From | Corgi sprint / run | Cat sprint / run |
|---|---|---|
| Start, slot 0 (Corgi spawn 0, Cat (62, 117)) | 16.92 s / 25.27 s | 16.07 s / not measured |
| Start, slot 1 (Corgi (-68, -123), Cat (74, 105)) | stalls in trench T1 (W only) | 15.90 s / not measured |
| Respawn points | 16.78-16.92 s / 25.07-25.27 s | 15.40-16.02 s / 20.47-21.30 s |

**Path lean.** The Cats are 0.8-1.5 s ahead sprinting and about 4 s ahead running, against 0.1-0.2 s in
straight-line time.

**Nav path lengths** (web TS nav, `findPath` from the spawn to the slab centre): 148.5 m from Corgi spawn 0 and
128.1 m from Cat spawn (56, 105). At sprint that is 15.47 s against 14.56 s, a 0.91 s Cat lead, in line with the
measured runs.
