# G4a handoff: Base Assault, the rules and the presentation (Wave 9, mode-1)

**Status: done for integration. Nothing is committed or staged.**

- The rules are authoritative and live in the sim.
- The view and HUD are in new files. They switch on with the `main.ts` snippet in §7.
- `?mode=base-assault` already runs offline with the current `main.ts`, because the worker passes the mode through. Until the snippet lands, the balls are invisible there.
- Proof: `npm run gate:fast` **PASS** (typecheck, boundaries, 883 unit tests passed, 1 skipped, 103 files).
- The 4 G4a test files hold 30 tests. The gate ran before the last one (the stall test) was added; all 30 pass together.

## 1. The mode
Each team keeps a squeaky tennis ball on a stand beside its flag. You score like this:
1. Touch the enemy ball to steal it.
2. Run it home.
3. Enter your own flag's capture ring.

Scoring rules:
- **First to 3 captures** wins, or the team with more captures at the horn (480 s). An equal score is a draw.
- **You can capture only while your own ball is home.**

### The carrier
- Moves at **0.75 ×** every speed: walk, run, sprint, and the slide's entry boost and threshold.
- **Cannot Ear Glide.** A glide it was in when it took the ball ends.
- **Cannot mount a kart or a plane.** Kiosks still vend for it.
- Wears `EFlag.Carrier`.
- Drops the ball where it is knocked out. The ball snaps to the highest surface at or below the death spot (a roof above never counts). Over water it floats on the surface.

### A dropped ball
- Goes home after **20 s**, or at once when a defender touches it.
- An attacker who touches it picks it up.

### Stalemate relief
If both balls are away from home for **60 s**, both capture rings open: a carrier may capture with its own ball still away. The relief closes as soon as either ball is home again.

Why this relief, and not faster returns or revealing the carriers:
- It targets the dead state itself: two carriers sitting at home, each waiting for their own ball.
- It turns that state into a race home with a clear, readable signal: the HUD shows "STALEMATE IN n", then "STALEMATE · RINGS OPEN" in gold, and the rings turn gold.
- It keeps the "defend your ball" tension for the first minute.
- It gives no free points: you still have to carry the ball into your own ring alive.
- A leading team can't abuse it. While your own ball is home you could capture anyway; the relief only matters when both teams hold a ball.

### Bases
The mode looks for bases in this order:
1. `WorldData.bases` (C9) when present. `flag` is taken as the ground point at the pole's foot. `ballStand` is settled on whatever surface lies under it (a crate top works).
2. Otherwise the West Yard's E4 flags (`battleOf`: the big flag banners). The stand goes beside the flag on open, level lawn, 3.6 to 6.2 m from the pole, facing the enemy. It keeps clear of spawns, both teams' kiosk and kart sites (whether or not the mode runs them), terminals and jump pads, with 1.9 m clear of props.
3. Otherwise a fallback from the team spawn centroid: the ring on open ground nearest the centroid, and the stand beside it toward the enemy. The Lot uses this today.

Measured placements:
- **West Yard:** the corgi stand is 6.2 m from its flag, the cat stand 3.6 m from theirs.
- **The runs are fair:** corgi stand to cat flag is 147.0 m, cat stand to corgi flag is 149.0 m.
- **The Lot:** 259.1 m against 260.5 m.

Placement is deterministic per world. The search runs once per match setup and takes 28 to 45 ms. A restart reuses the entities.

### Edge cases (all authoritative and tested)
| Case | Result |
|---|---|
| Two grabs on the same tick | One carrier: the nearest wins; an exact tie goes to the lower entity id. On a dropped ball, a defender wins a tie (a return). |
| The carrier disconnects, or a team/class switch at a deploy point (the Room removes the body) | Dropped where the carrier last stood. |
| Kiosk kit swap | Same entity: it keeps the ball, still slowed, and a Skyraider still can't glide. |
| The carrier falls below killY, is moved out of bounds, or is respawned alive | The ball goes straight home. See the teleport rule below. |
| The carrier's inputs stall, then catch up (Room, up to 4 inputs a tick, under 1.5 m) | The carrier keeps the ball. |
| The carrier stands in water | It carries on at wading speed. Knocked out there, the ball floats at `surfaceY + 0.08`, and a wading defender can return it. |
| A seated character | Never touches a ball. A seated carrier (defensive: carriers can't mount) drops it. |
| A match restart mid-carry, or the horn | Both balls go home silently, every `EFlag.Carrier` clears, and the same six entities are reset. |
| A drop spot off the map | The ball goes home instead. |

**Teleport rule:** a carrier that moves more than **4 m in one tick** has been teleported by the authority (the kill plane, the out-of-bounds guard, `respawnNow`). The ball goes home, because the old spot may be in the void.

**Invariant:** `checkBallInvariants(sim)` checks that:
- there is exactly one ball entity per team, in exactly one state;
- every carrier is a living, unseated enemy of the ball that wears the flag;
- nobody else wears the flag, and nobody carries two balls;
- a dropped ball has a return pending;
- a home ball sits on its stand.

The tests run it after **every tick**, including a 45 s seeded chaos brawl that uses every transition. That run is replayed to prove determinism.

## 2. Snapshot convention (no protocol change)
The layout is documented in `src/shared/content/modes.ts`. There are three `EntityKind.Prop` entities per team, with `cls -1` (so S1's beacon lookups ignore them), told apart by seed.

| Entity | Seed | Fields |
|---|---|---|
| **ball** | `BA_BALL_SEED` | `xyz` = the ball centre.<br>`weapon` = `BallState` (0 home, 1 carried, 2 dropped).<br>`ammo` = the carrier's id.<br>`hp` = seconds until a dropped ball returns; `maxHp` = 20.<br>`v*` = the carrier's velocity.<br>`Busy` = away from home. |
| **stand** | `BA_STAND_SEED` | Foot position and yaw. |
| **goal** (the capture ring at the flag) | `BA_GOAL_SEED` | `Busy` = this team can't capture now.<br>`weapon` = 1 while the relief is open.<br>`hp` = seconds until the relief opens while both balls are away. |

Events are existing types:
- `pickup` with `id` = the new carrier and `item: 'squeaky_ball'`. It is sent first, so a client knows whose steal it was.
- `score` with `pts: 0` and a reason:
  - `ball taken`: team = the thieves;
  - `ball dropped` and `ball returned`: team = the ball's own team;
  - `captured`: pts 1, team = the scorer.

Existing consumers behave:
- the HUD shows a "+1 · captured" toast and a "Picked up squeaky ball" toast;
- the audio plays its mine/theirs sting for each score event;
- the tally and interact views ignore the new item and reasons.

Roster credit goes through `creditRoster`: capture 10, return 3, steal 2.

## 3. Files
| Path | What |
|---|---|
| `src/sim/match/base-assault.ts` | **New.** Contains:<br>• base resolution;<br>• the three entities per team;<br>• `stepBaseAssault` (carriers, returns, touches, relief, captures);<br>• `resetBaseAssault`;<br>• `dropSpot`;<br>• `baseAssaultBalls` (a read-only view for bots, which G4b will use);<br>• `checkBallInvariants`. |
| `src/sim/match/index.ts` | Registers `'base-assault'` in `MODES`. Adds `updateBaseAssault`: warmup, then live, then ended, then restart, following core-rush's flow. The generic `restart()` calls `resetBaseAssault` (the restart hook). Exports the helpers. |
| `src/sim/systems/movement.ts` | **The approved minimal change,** keyed on `EFlag.Carrier`:<br>• `k = 0.75` on the target speed and on the slide threshold and boost;<br>• no glide start, and a running glide ends.<br>For everyone else `k = 1`, so the output is bit-identical. |
| `src/sim/vehicles/systems.ts` | One guard in the Interact loop: a carrier gets no kart or plane (kiosks still vend). |
| `src/shared/content/modes.ts` | Adds `BASE_ASSAULT` (config), `BA_BALL` (geometry shared by the authority and the view), `BallState`, the seeds, the event reasons and the snapshot doc. |
| `src/client/modes/base-assault-view.ts` | **New.** 3D view:<br>• **Stand:** a pallet, a khaki ammo can with team tape, a tin cup, and an aerial with a team pennant.<br>• **Ring:** a tube hugging the ground with inward chevrons. It shows in team colour when open, dull while blocked, and gold during the relief.<br>• **Ball:** worn felt (lumps, rubbed scuffs, grime and grass stains in vertex colours), a cream seam and two hand-wrapped strips of team tape.<br>• **Beacon pillar and diamond** while away. The beacon keeps about 3 px of width at range when given the camera.<br>• **Halo and hop** when dropped.<br>• **Carrying:** the ball rides high on the carrier's back, using the carrier's interpolated or predicted state.<br>• **Squeak pop** on each change of hands.<br>Materials come only from `toon()` / `glow()`. It uses 30 to 33 draws and about 6.1 k triangles for both bases. |
| `src/client/ui/base-assault-hud.ts` | **New.** DOM:<br>• the strip under the match bar: the two ball chips (HOME, TAKEN · name, DROPPED · n), capture pips "FIRST TO 3", and the stalemate clock or relief;<br>• comic banners: BALL TAKEN!, CAPTURED!, BALL RETURNED, and a smaller BALL DROPPED!, each with a line for your side;<br>• through-walls markers over away balls, with the countdown;<br>• the carrier cue: RUN IT HOME!, or HOLD THE BALL while your own ball is away.<br>Audio goes only through the audio module's public API: `audio.engine.play` with `abilitySfx('squeak_barrier')` and `SCORE_STINGERS.chapter`. The model (`readBaseAssault`, `bannerFor`, `chipText`) is pure. `cueUp` lets tips wait. |
| `src/client/net/prediction.ts` | **Outside my listed paths:** the one line the parity requirement needs. `syncBuffs` now takes `EFlag.Carrier` from snapshots alongside `BUFF_FLAGS`, and returns true when it toggles (the pending inputs replay). Without it the predictor runs the carrier at full speed. A mutation check proves it: the 3 parity tests fail without this change and pass with it. Please keep it. |
| `tests/unit/base-assault.test.ts` | 18 rules tests. |
| `tests/unit/base-assault-movement.test.ts` | Slow, slide and glide tests, plus 3 LocalPredictor parity tests. |
| `tests/unit/base-assault-room.test.ts` | The end-to-end Room test. |
| `tests/unit/base-assault-view.test.ts` | Headless style audit and budgets, plus the HUD model. |
| `labs/base-assault.html`, `labs/base-assault.ts` | **New lab:** the real West Yard (or `&map=the_lot`), a real Sim, real avatars, the match HUD and the G4a view and HUD. It fast-forwards to a scripted moment, then freezes the sim. Shots: `home`, `ball`, `carry`, `dropped`, `capture`, `far`. |

## 4. Proof
Test runs:
- **Targeted:** `npx vitest run tests/unit/base-assault*` plus net-prediction, sim-movement, match, match-core-rush, vehicles, vehicle-plane and contracts-w9: **100/100** (before the stall test was added; that test passes on its own).
- **`npm run gate:fast`:** GATE PASS (typecheck, boundaries, unit 883 passed / 1 skipped).

What the tests show:
- **Parity.** A carrier runs, sprints, jumps and slides for 3 s: the authority and `LocalPredictor` agree with **max error 0** (bit for bit). With snapshot lag 6, the pickup and the loss of the ball cause at most 2 corrections, and the error at acks during the carry is under 1 mm. A Skyraider carrier pressing Q in the air: neither side glides, and the error is 0.
- **The slow, measured.** 3 s on the same lane: the carrier's peak speed is 0.75 × the free pet's (3 decimals). Distance ratio 0.74 to 0.765 for both the run and the sprint.
- **End to end offline.** An in-process `Room` with a human (real `input` messages, sprint, path-following) against 7 bots (4v4 with the human). Steal, carry, capture, **3 times: the corgis win 3–0 at 128.6 s** of sim time, with 33 knockouts in the brawl around the runner.
  - The carried sprint was measured at **0.753 ×** the free sprint, per tick, grounded.
  - After the result hold, the restart is clean: warmup, 0–0, balls home, the same six entities.
  - The human's HP is topped up: the test proves the objective pipeline; the knockout drop has its own tests.
- **Cost.** The ball rules take **about 8 µs a tick** with 16 characters. The base search runs once per match: 45 ms on the West Yard, 28 ms on The Lot, and it also builds the shared nav grid, which the AI would build at tick 1 anyway.

### Soak
`npx tsx tools/soak.mjs --modes base-assault --seconds 60 --repeat 1` showed:
- errors 0 and stuck max 0.5 s;
- the net-bot's snapshot bandwidth at 8.3 KB/s;
- tick p50 0.56 ms.

It FAILs two gates, both expected for G4a:
- **"no match completed":** the bots don't play the objective yet, which is G4b;
- **tick p95 5.2 ms:** the machine load was 13 on 4 cores, and it was a single run.

Base-assault joins the soak defaults with G4b.

## 5. Screenshots (all looked at; `artifacts/g4a/`)
| File | What it shows |
|---|---|
| `lab-home.png` | The corgi ball on its khaki stand in front of the flag, the blue capture ring and its chevrons, and two pups. Strip: both balls HOME. |
| `lab-ball.png` | Close-up of the cat ball: lumpy, worn felt, the cream seam, crimson hand-wrapped tape, the tin cup, the can's tape and the crimson ring. |
| `lab-carry.png` | Rex sprinting home with the cat ball on his back and the crimson beacon above it. Strip: "CAT BALL · TAKEN · Rex". Cue: "RUN IT HOME!". |
| `lab-dropped.png` | Seen by a cat: the ball on the lawn with its halo and beacon, the marker "19", the gold chip "DROPPED · 19", and the banner "BALL DROPPED! · Touch our ball to send it home!". |
| `lab-capture.png` | The CAPTURED! burst ("+1 for us. Go again!"), score 1–0, the first pip lit, Rex inside the ring, and the corgi ball home on its stand. |
| `lab-far.png` | From the corgi flag: a cat runs off with the corgi ball about 40 m away. The blue beacon rises from the thief, the marker is over him, the strip reads "TAKEN · Tom", our ring has gone dull, and the stand is empty. |
| `game-autoplay.png` | The real game, `?webgl&autoplay&mode=base-assault&bots=4,4`, run with the §7 `main.ts` snippet applied in memory by a scratch Vite plugin (the repo's `main.ts` was untouched). It shows the strip, the objective line and the ring around the flag. |

The machine rendered 0.07 to 1.3 fps under SwiftShader, which is why the hero shots come from the lab. Its fast-forward-then-freeze makes them repeatable.

## 6. Design notes (game-design-psychology)
- **Carrier tension:**
  - the slow is on every speed, so there is no slide-spam escape;
  - no glides and no rides, so the carrier has to be escorted;
  - the beacon and the through-walls marker make it the most visible pet on the map.
- **Comebacks:**
  - a defender's touch returns the ball at once, so a well-placed defender always has a play;
  - your ring goes dull while your ball is away, so the losing team's thief can't cash in until they deal with yours;
  - the relief ends stalemates without handing out points.
- **Fairness:**
  - the stands are mirrored beside each flag and the runs are within 1.4 %;
  - the same rules apply to both species;
  - same-tick contests are deterministic and never duplicate a ball.
- **Readability:** team signal colours only (blue and gold, crimson and black) on the tape, rings, pennants, beacons, chips and banners. Everything else stays gritty, per HARDENED.

## 7. Wiring the lead pastes

### `src/client/main.ts`
This exact patch was applied and run for `game-autoplay.png`, and it typechecks. The scratch patch file is `main-patch.mjs` in my scratch folder.

```ts
// imports (after createCoreRushView)
import { createBaseAssaultView } from './modes/base-assault-view'; // W9 G4a: balls, stands, capture rings
import { createBaseAssaultHud } from './ui/base-assault-hud'; // W9 G4a: ball strip, banners, markers, carrier cue

// botsFor
const botsFor = (m: string) => (params.get('bots') ?? (m === 'team-deathmatch' || m === 'core-rush' || m === 'base-assault' ? '4,4' : m === 'adventure' ? '4,0' : '3,0')).split(',').map(Number) as [number, number];

// after `const rush = createCoreRushView(ctx.scene, ui);`
const assault = createBaseAssaultView(ctx.scene, { heightAt: (x, z) => worldData.height(x, z), heightOf: (id) => views.get(id)?.avatar.height, camera: ctx.camera });

// after `const planeHud = createPlaneHud(ui);`
const assaultHud = createBaseAssaultHud(ui, { audio }); // G4a (idle in other modes)

// bus.on('game', ...), after `interact.onGameEvent(ev);`
assault.onGameEvent(ev); // G4a
assaultHud.onGameEvent(ev, net?.localEntity ?? -1); // G4a

// frame loop, after `rush.sync(...)`
assault.sync(states, localId, pdt); // G4a

// frame loop: the carrier cue holds the bottom centre (first-match tips wait)
const cueUp = hiddenCue.style.display === 'block' || spottedCue.style.display === 'block' || painted || planeHud.shown || assaultHud.cueUp;

// frame loop, after `hitFx.update();`
assaultHud.update({ states, localId, roster: net?.roster ?? [], match: net?.match ?? null, camera: ctx.camera, ballAt: (t) => assault.ballPosition(t) }, dt); // G4a
```

### Menu (`src/client/ui/menu.ts`)
```ts
export type MatchMode = 'yard-skirmish' | 'team-deathmatch' | 'core-rush' | 'base-assault' | 'adventure';
// MATCH_MODES
{ id: 'base-assault', label: 'BASE ASSAULT', hint: '4 vs 4: steal their squeaky ball, run it home, first to 3' },
```
The MATCH grid has 2 columns, so a fifth entry sits alone on its row. That is the lead's layout call.

### Rooms and maps (C9)
- `src/host/guard.ts`:
  ```ts
  export const ROOM_MODES = ['yard-skirmish', 'team-deathmatch', 'core-rush', 'base-assault', 'boss-rush', 'adventure'] as const;
  ```
  `maps.test.ts` already requires every room mode on the West Yard.
- `src/shared/world/maps.ts`:
  ```ts
  const PVP = ['yard-skirmish', 'team-deathmatch', 'core-rush', 'base-assault'] as const;
  // the_lot:
  modes: ['yard-skirmish', 'team-deathmatch', 'core-rush', 'base-assault']
  ```
  The fallback bases already work on The Lot; L3's `WorldData.bases` takes over when it lands.
- `server/config.ts` `botsForMode`:
  ```ts
  if (mode === 'team-deathmatch' || mode === 'core-rush' || mode === 'base-assault') return [4, 4];
  ```

### Recommended (not needed for G4a to work)
- `src/shared/content/terminals.ts`: add `'base-assault'` to the `modes` of `kart_terminal`, `plane_hangar` and `ordnance_terminal`. This brings kiosks, Upgrade Cores, Golden Kibble, karts and the plane into the mode. G4b's "kart rides" and "carriers can't mount" only mean something with vehicles present. Today base-assault runs with no terminals, pickups or vehicles.
- `src/client/ui/strings.ts` `MODE_NAMES` and `src/client/ui/rooms.ts` `MODE_LABELS`: `'base-assault': 'Base Assault'`. Without them the reward card's first-win line reads "First base-assault win".
- `src/shared/content/cosmetics.ts` `FIRST_WIN_MODES`: add `'base-assault'` if a first win should unlock a look. That is a content call.
- `tools/soak.mjs` default `--modes`: add `base-assault` once G4b's bots capture.

## 8. For G4b
- **Ball state:** `baseAssaultBalls(sim)` gives each ball's state, carrier, position, return countdown, stand and flag. `baseAssaultState(sim).relief` gives the relief. Bots take and return balls by touch, so no button is needed.
- **Carriers** can't mount. A bot planning a kart ride while carrying will be refused at the Interact press.
- **The Lot** uses the spawn-centroid fallback until L3 provides `WorldData.bases`. The rings then sit among the spawns, and the stands 3.6 m from them. The runs are about 260 m, which is long for a 5-minute bot match. Real bases from L3 should shorten them.
