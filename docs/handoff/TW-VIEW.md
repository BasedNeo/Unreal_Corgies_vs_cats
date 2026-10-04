# TW-VIEW handoff — the slab match in the browser (Wave 13; W15 HUD contract)

**Status: done for integration; nothing committed or staged.** The web client plays the Godot game's match against
TW-SIM's `slab` authority (contract: the slab section of `src/shared/content/modes.ts`). Godot is the main build: the
read-out, HUD text and colours copy `engines/godot/game/slab.gd`, `hud.gd` and `tuning.gd`.

## W15: the HUD contract (docs/qa/w15/HUD_CONTRACT.md, revision 3)
**Status: done for integration; nothing committed or staged.** Base `9139c7a` (HEAD `eb0ae36` adds an alloc test and
art, none of these files). This is the Sprint B patch round after the independent check failed: placement in rev. 3's
order, a pure per-frame model (`slabHudFrame`) with tests that kill the check's mutants, the dead gate, the centred
death panel, the in-tree `&slabHurt`, the 132 m data, and new shots. The words below are copied from the contract.

### What changed
- **§1 The slab marker.**
  - It hangs at the slab centre + 4.5 m. Above the shape are two lines: `SLAB  <N> m` (the **camera's** ground
    distance, whole metres) and the state word.
  - | State | Word | Shape | Colour |
    |---|---|---|---|
    | Nobody on the slab | `NEUTRAL` | a hollow diamond | white |
    | One team alone | `CORGI COMPANY` / `CAT CADRE` | a filled diamond | the team colour, lightened 0.35 |
    | Both teams | `CONTESTED` | an outline cut by a bar wider than the diamond | amber |
  - **Placement, rev. 3 order** (`slabMarkerPlace`, Godot `hud.gd place_marker`), in 720p px scaled by the screen:
    1. Clamp the anchor into the safe area: 16 from the sides, 110 from the top (`SLAB_SAFE`), 112 from the bottom.
       Behind the camera it goes to the bottom edge, mirrored.
    2. If the box overlaps another living pet's screen box, move up until it clears with 2 of clearance
       (`SLAB_MARKER_CLEAR`), by at most 120 and never above the safe top.
    3. If that cannot clear it, put it just under the lowest pet it still covers (2 of clearance), clamped to the
       safe bottom.
    4. If neither clears, it stays where step 2 left it. Nothing clamps after the dodge.
  - `slabPetBoxes` projects the 8 corners of each living pet's box and **skips the player's own pet**.
  - It hides while you stand on the slab, while you are down, and once the match is over (`slabMarkerShown`).
- **§2 The death panel.**
  - Four lines, centred on the screen (`top: 50%; transform: translate(-50%, -50%)`) on a dim rounded backing
    (black, alpha 0.55; `SLAB_DEATH_BACKING`):
    - `TAKEN DOWN BY <name>  ·  <TEAM>`, with a square (Corgi Company) or triangle (Cat Cadre) glyph before the
      team name, in its colour. With no killer: `TAKEN DOWN BY THE LOT`. The name is the room's (roster), else
      `Cat <id>` / `Pup <id>` (`slabKillerOf`).
    - `YOU: <TEAM>`.
    - `BACK AT <BASE>  ·  <N> m TO THE SLAB`.
    - `BACK IN <s.s>`.
  - `slabRespawnZone` runs the sim's own rule (`slabRespawnPoints`, now typed `SlabLayout`, so the web builds a real
    `{ worldData: { spawns: SpawnPoint[], height } }` and the old `as unknown as Sim` cast is gone) on The Lot's
    spawns and takes the centre of the points:
    - THE FOUNDATION 142 m: the Corgis' three points from slot 0 toward the slab;
    - THE SCAFFOLDS **132 m**: the Cats' three data slots (Godot `CAT_SLOTS`) at (56, 117), (62, 117) and (68, 117),
      as in Godot.
- **§3 Hits.**
  - The confirms are drawn on a dark underlay, so they read in grey:
    | Kind | Shape | Colour | Shown |
    |---|---|---|---|
    | Body | an X of four lines, 5–10 px | white | 0.18 s |
    | Head | the X plus an 11 px diamond | yellow | 0.18 s |
    | Kill | a heavier X, 6–14 px, plus a ring 18 px across | red | 0.35 s |
  - A received hit draws a wedge on a 110 px ring. It points at where the attacker stood **at its hit** (stored with
    the hit), from you, relative to the camera's facing; it turns with the camera and never follows the attacker. It
    fades over 0.6 s.
  - The HP bar shows the HP just lost as a white chip with a dark seam. It drains over 0.4 s and follows the hit
    points every frame.
  - The red flash is hud.gd's `_dmg_t * 0.5`, never above 0.175.
  - **While you are down there is no confirm and no wedge**, and your own knockout clears the stored wedges, so none
    come back with you (`slabHudFrame`, `SlabHitCues`).
- **§4 Fields.** Unchanged from rev. 2: `YOU: <TEAM>` over the HP; the slab line hides once the match is won; fps only
  with `?debug`; the rematch line `R / Enter: rematch`.
- **The frame model.** `slabHudFrame(frame & {w, h}, state, now)` returns `{ marker: {lines, shape, color, dist, x, y,
  box, dodge} | null, death: {lines, glyph} | null, confirm | null, wedges: [{src, angle, alpha}], chipTop, flash }`.
  `slabHudEvent(state, ev, now)` feeds it the bus's game events. `createSlabHud.update()` only writes that result
  (and the existing pure field helpers) to the DOM.
- **`&slabHurt` (offline only, for reproducible shots).** `src/host/worker-host.ts`: `SLAB_HURT` makes the nearest
  living enemy really hit the human (`applyDamage`, the shot path) for 25 at 8 s and 12 s of sim time and take it
  down at 16 s, then again every 16 s; a step it cannot take (down, protected, no enemy) is skipped. It runs after
  each tick of the offline worker's room. The gate `slabHurtOn(cfg)`: the offline worker only (no online room or Node
  server reads it), mode `slab`, `slab.hurt === true`, and never in a production build (`import.meta.env.PROD`).
  `src/client/net/transport.ts` (mine since W13) reads `&slabHurt` into `SlabOverrides.hurt`: one line; main.ts
  already hands the overrides to the worker transport only. `hurt` never reaches `matchConfig.slab`.

### Files (W15)
| Path | Change |
|---|---|
| `src/client/ui/slab-hud.ts` | §1–§4 models, the rev. 3 placement (`SLAB_SAFE`, `SLAB_MARKER_CLEAR`, `slabMarkerPlace`, `slabPetBoxes`), `slabHudState` / `slabHudEvent` / `slabKillerOf` / `slabHudFrame`, the dead gate, the centred `.dp`, and the DOM that only writes the frame. `slabMarkerDodge` is gone. |
| `src/client/modes/slab-view.ts` | `SlabReading.pets`: the frame's living players and bots. |
| `src/client/net/transport.ts` | `&slabHurt` → `SlabOverrides.hurt` (one line plus the doc comment). |
| `src/host/worker-host.ts` | `SlabOverrides.hurt`, `SLAB_HURT`, `slabHurtOn`, `slabHurtStep`, and the hook after each room tick when the gate passes. `slabOverrides()` still passes only the three numbers to the match. |
| `tests/unit/slab-hud.test.ts` | **New**, 28 tests (placement rev. 3, the own-pet skip, the frame model's M16–M20 and dead-gate tests, 132 m). |
| `tests/unit/slab-view.test.ts` | The reading's pets. |
| `tests/unit/slab-view-input.test.ts` | Plus 3: the `&slabHurt` parse, the gate (and that the server, the room, the sim and the online transport never name it), and a real offline slab room taking two cycles of the schedule. |
| `tests/e2e/modes.spec.ts` | The slab menu case also checks the marker's two lines, its shape attribute, and the YOU line. |
| `docs/qa/w15/hud-web-death.jpg` (+ new `-gray`), `hud-web-hit-received.jpg` (+ `-gray`), `fx-takedown-web.jpg` | Retaken from the tree this round (below). The marker, hits and win shots are Sprint B's: placement then used a 104 px top and no pet stood near the marker in them. |

`main.ts`, `hud.ts`, `hit-feedback.ts`, `input.ts` and `src/sim` are untouched by me in W15.

### Proof
Private copy `scratchpad/tw-r3`: HEAD `ace71ca` (= `9139c7a` + an alloc test; `eb0ae36` adds only art) plus these
files and tw-sim's (`src/sim/match/slab.ts`, `index.ts`, `slab-mode.test.ts`) and tw-look's (`src/client/fx/*`).
- `npx tsc --noEmit`: exit 0. `node tools/check-boundaries.mjs`: `BOUNDARIES: PASS`. (Also both on the shared tree.)
- `npx vitest run` slab-hud, slab-view, slab-view-input, slab-mode: **66/66** (28 + 10 + 6 + 22).
- `npx playwright test tests/e2e/modes.spec.ts -g SLAB` (private config, port 4391), once: **2 passed (50.6 s)**. It
  ran before the `SLAB_HURT` gaps went from 1.2 / 1.4 s to 4 / 4 s; the e2e builds for production, where the gate keeps
  `&slabHurt` off, so that change cannot reach it.
- Mutants, each applied to the proof copy alone, then restored (`cmp` with the tree after each set):
  | Mutant | Result | Failing test |
  |---|---|---|
  | M16 the wedge follows the attacker live | killed | M16: a wedge points where the attacker stood AT ITS HIT |
  | M17 the death panel never shows | killed | M17 + M19: down while the match runs |
  | M18 the marker distance comes from the player | killed | M18: the marker's distance is the CAMERA's |
  | M19 the killer is always THE LOT | killed | M17 + M19: down while the match runs |
  | M20 no HP chip | killed | M20: the HP chip follows your HP |
  | clamp after the dodge (the old order) | killed | Godot's top case: anchor (640, -300), a pet at (600, 100, 80 x 60) |
  | own pet not skipped | killed (2) | your own pet never pushes the marker; your own pet right under the anchor |
  | no dead gate | killed | down: no confirm and no wedges |
  | your knockout keeps the wedges | killed | down: no confirm and no wedges |
  | gate: production build not excluded | killed | the gate |
  | gate: any mode | killed | the gate |
  | gate: any truthy flag | killed | the gate |
  | gate: never on | killed | the gate |
- `src/client/fx/presets.ts` checked before shooting: `furHit` has a tuft loop, one team chunk and one Glow; no Star
  loop, no stuffing loop.
- **Shots**, from a copy of the tree served by a private vite on port 5187 (stopped by PID), at
  `/?mode=slab&webgl&slabHurt&autoplay` (`autoplay` only skips the menu), 1280 x 720, quality high. I looked at each.
  Headless SwiftShader draws about one frame every 1–3 s, so the private harness (a Playwright init script on the
  page's main thread only; nothing in the tree) steps the page clock: `performance.now` and `requestAnimationFrame`
  advance a set time per drawn frame, as a fast machine's would. The worker runs the sim in real time. Between shots
  the page draws at 320 x 180 so earlier FX age out in page time, and it is set back to 1280 x 720 as the target
  event lands. Once the event's snapshot is delivered, later snapshots wait until the shot is taken (pongs pass), then
  arrive in order. The ages below are page time since the event's arrival, read back from the HUD's DOM.
  | File | What it shows |
  |---|---|
  | `hud-web-hit-received.jpg` (+ `-gray`) | A real `&slabHurt` hit from Cat 2 (sim tick 2402, a cycle's first hit, HP 120 → 95). **FX age 0.116 s:** two or three fur tufts by the pet's head; furHit's 0.08 s glow has gone, and furHit has no dust. **Chip age 0.100 s:** the white chip spans 95–113.75 of 120, with its seam. The wedge at alpha 0.81 points straight up the ring (rotate 0.1°) toward where the bot stood on the slab, so it lands on the marker (Open 2). The flash is 0.117. `SLAB  146 m` / `CAT CADRE`. |
  | `hud-web-death.jpg` (+ `-gray`) | The knockout at tick 1922, **FX age 0.600 s**: `TAKEN DOWN BY Cat 2  ·  ▲ CAT CADRE`, `YOU: CORGI COMPANY`, `BACK AT THE FOUNDATION  ·  142 m TO THE SLAB`, **`BACK IN 2.4`**, centred on the backing. There is no marker. **Chip:** 0–55 of 120 (46.1 %); it started when the HP drop reached the frame, about 0.5 s after the event (Open 3). Most of the takedown dust has gone; one flat grey puff near the end of its 0.7 s life remains behind the neck, with a few tufts and the team chunk. The glyph and the four lines read in grey. |
  | `fx-takedown-web.jpg` | 800 x 600 crop of a live killing hit (tick 3842), **FX age 0.200 s**: `takedownDust`'s flat dark-grey puffs around the pet. **Measured dust:** rgb(62, 55, 62) to rgb(71, 67, 78) (`#3e373e`–`#47434e`), on ground of about rgb(18, 10, 22). There are fur tufts and the blue team chunk, and no white poof, star or inked cloud. **Chip age: none yet.** The HUD in this frame still shows 70 HP and no panel, because the dead state reaches the frame by the interpolation delay (Open 3). |

### Open (W15)
1. **The knockout FX is tw-look's final set.** The comic deathPoof (inked cloud with stars) is retired: a knockout
   now plays `takedownDust` (dark grey night-smoke puffs, grit and a few fur tufts), and tw-look removed furHit's pop
   (no Star loop, no stuffing loop; tufts, one team chunk and a single soft glow). I checked
   `src/client/fx/presets.ts` before shooting. The death panel's backing stays for lit scenery.
2. **The wedge can overlap the marker.** With the attacker straight ahead at long range (the Cat bot on the slab
   seen from the Corgi spawn), the wedge 110 px up the ring lands on the marker's words. Both follow the contract's
   geometry; the wedge draws on top. Sprint C parity.
3. **The HP chip follows the event by the interpolation delay.** Events reach the HUD on arrival; the local hit
   points come from the interpolated state, so the bar (and the chip) start up to `interpDelay` (0.1–0.25 s) after
   the wedge and the FX: up to `interpDelay` (0.1–0.25 s) at frame rate; longer when frames stall (headless SwiftShader, a background tab), as in this shot (~0.5 s). Godot has no such delay. Not changed here (net-client, not mine).
4. **Not wired:** the web cue log for §3's six sounds belongs to a-hook (`src/client/audio`).

## What the page does
- `?mode=slab` (or MATCH › SLAB in the main menu, which reloads into it) plays The Lot. TW-SIM's `maps.ts` MODE_HOME
  sends slab there. Default is 1 v 1: you and one Cat bot (`SLAB.teamSize`). `&2v2` (Godot's `--2v2`) gives 2 v 2
  (`SLAB.teamSizes`), and `&bots=` still overrides both.
- The Lot's kit comes from the six shared GLBs. Slab mode adds `kit=glb` to the URL (history.replaceState) before
  the world view is built, unless `?kit=` is already set. `__cvc.twin.kits` reports **6**.
- `npm run twin` runs `vite --open '/?mode=slab'`.
- On every spawn and every rematch the view turns to face the slab, as Godot's `_yaw_to(spawn, slab.center)` does.
- **Slab read-out** (`src/client/modes/slab-view.ts`): a thin glowing frame (`glow()`) and a faint fill (`toon()`,
  transparent) laid over the ground under the slab. Two draws in total. It is dim white when neutral (fill 6 %),
  the team colour lightened 0.2 when held (fill 14 %), and flashes amber to white when contested (in six cached
  steps). Godot's omni light over the slab is left out: every forward-lit material in view would pay for it.
- **Slab HUD** (`src/client/ui/slab-hud.ts`) reads like `hud.gd`: plain light sans-serif text in white and team
  colours over a soft shadow, thin bars, no comic panels, no display fonts, no text outlines, no PLACEHOLDER tag.
  - Top: `CORGI COMPANY  12` and `7  CAT CADRE`, each over a bar racing to 60. The clock reads m:ss, turns red in
    the last 30 s, and reads OVERTIME in overtime. It still reads OVERTIME after an overtime end, tracked from every
    snapshot through bus `match`.
  - Slab line, word for word as hud.gd: `SLAB  NEUTRAL`, `SLAB  <TEAM> HOLDING  +1/s` or `SLAB  CONTESTED`, in
    hud.gd's colours.
  - Slab marker: a diamond and the word SLAB, clamped to the screen edges.
  - You: hit points (number and bar, red at 40 or less) bottom left; `30 / 30` or `RELOADING` bottom right;
    `TAKEN DOWN  ·  back in 2.4` while down; hud.gd's controls hint for the first 14 s.
  - Verifier fixes (post a64ce51):
    - Once the match is over the slab line is hidden (`slabLineFor`). It no longer shows a frozen
      `HOLDING +1/s`; hud.gd stops scoring at match_over and covers the line with its winner veil.
    - The general HUD's `fps · backend · transport · rtt` line (hud.ts `.dbg`, driven by `HudModel.showDebug` from
      main.ts) is off in a slab match unless `?debug` is set (`slabShowDebug`).
  - Winner screen: `<TEAM> WINS` or `DRAW`, `12  –  7`, `You: n takedowns · n knockouts`, and `R / Enter: rematch`.
  - While a slab match runs, a class on the HUD parent hides the general HUD's comic match bar, its health panel
    (with the Q ability ring), its ammo panel and its knocked-out screen. It also hides the Q line of the pause
    overlay's key list (`hud.ts` now tags each key `data-k`). Once the match is over, the "CATS WIN!" burst and the
    automatic end-of-match scoreboard are hidden too. main.ts holds the first-match tips (they stay unseen) and the
    district toasts.
  - The general HUD's kill feed and click-to-play overlay take hud.gd's plain look in slab mode:
    - `hud.ts` writes `Killer  >  Victim` lines (`slabFeedText`, "The Lot" when there is no killer) and titles the
      overlay `Click to play`;
    - slab-hud.ts's CSS drops the comic boxes, fonts and outlines;
    - the overlay hides behind the winner screen (R and Enter work without the pointer).

    The crosshair, hit markers, damage arcs, chat and Tab scoreboard stay the general HUD's.
- **Rematch:** R and pad X already send the reload bit. While the winner screen is up (and no menu or chat is
  open), Enter does too. `InputState.enterReloads` latches the reload bit and stops the event, so the chat never
  opens on that Enter; outside the winner screen, Enter opens chat as before.
- Core-rush's view and the slab view each read Zone entities only in their own mode. The slab is a seed-0 Zone,
  like pad A.
- **Offline test overrides:** `&slabWin=3`, `&slabTime=20` and `&slabOvertime=5` shorten an offline slab match.
  transport.ts `slabOverridesFromSearch` parses and clamps them, then passes them on as `WorkerBootConfig.slab`.
  worker-host.ts re-checks them and sets `sim.state.matchConfig.slab`. Online rooms never see them.
- `__cvc.twin` carries `map`, `kits`, `slab`, `match` (the latest slab MatchState), `restarts` and `restartScore`
  (the score each rematch started at).
- `&cam=slab` swaps the follow camera for Godot's spectator orbit (24 m out, 13 m up) while the match runs as
  usual. It exists for proof shots: the slab is 120–140 m from both team spawns.
- `MODE_NAMES.slab = 'Slab'` (first-win lines, awards card).

## Files
| Path | What |
|---|---|
| `src/client/modes/slab-view.ts` | **New.** `readSlab`, `slabLook`, draped frame/fill geometry, `createSlabView`. |
| `src/client/ui/slab-hud.ts` | **New.** Pure model (`slabClock`, `slabStateText`, `slabWinner`, `slabHudColor`, …) + thin DOM. |
| `src/client/main.ts` | Slab wiring: bots 1,1 / &2v2, kit flag, views, HUD, Enter flag, face-the-slab, `&cam=slab`, `__cvc.twin`. |
| `src/client/net/transport.ts` | `slabOverridesFromSearch` (`&slabWin`, `&slabTime`, `&slabOvertime`). |
| `src/host/worker-host.ts` | `WorkerBootConfig.slab` / `SlabOverrides` → `sim.state.matchConfig.slab` (re-checked). |
| `src/client/ui/hud.ts` | Slab-mode branches only: key hints carry `data-k` (the slab HUD hides Q); plain `Killer  >  Victim` feed lines; overlay title `Click to play`. |
| `src/client/input/input.ts` | `enterReloads`: Enter latches `Btn.Reload` (and stops there) while set. |
| `src/client/ui/menu.ts` | MATCH › SLAB ("1 vs 1 on The Lot: hold the slab alone, first to 60"). |
| `src/client/ui/strings.ts` | `MODE_NAMES.slab` (one line, at the lead's request). |
| `package.json` | `"twin": "vite --open '/?mode=slab'"`. |
| `tests/unit/slab-view.test.ts` | **New**, 8 tests: read-out states, colours, drape, draws/materials, HUD model (clock, slab line, HP / ammo / down / hint, winner). |
| `tests/unit/slab-view-input.test.ts` | **New**, 3 tests: Enter → reload only while set (chat left alone otherwise); the URL overrides. |
| `tests/e2e/modes.spec.ts` | Two cases. `MATCH: SLAB from the menu …` checks The Lot, 1 Zone, 2 pets, the HUD (scores, clock, slab line, HP, ammo; no comic panels) and kit 6. `SLAB: the match ends …` checks the winner screen, then R and Enter each rematch to 0-0. |

## Proof
The follow-up ran in a fresh private copy (`scratchpad/tw-view2`): HEAD 71d05d5 plus every modified and new file under
src/, tests/ and server/ in the tree, so TW-SIM's and TW-LOOK's current files were included.
- `npx tsc --noEmit`: exit 0. `node tools/check-boundaries.mjs`: `BOUNDARIES: PASS`.
- `npx vitest run` of slab-view, slab-view-input, slab-mode and maps: **37/37 pass**. maps.test.ts includes
  TW-SIM's update.
- `npx playwright test tests/e2e/modes.spec.ts -g SLAB` (private config, port 4391): **2 passed (1.8 min)**.
  - Menu case: 48.0 s.
  - End-and-rematch case: 42.8 s, with `&slabTime=8&slabOvertime=4`.
- `docs/qa/w13/web-twin-slab.jpg` comes from `&cam=slab` at medium quality with TW-LOOK's night look: the Cat bot
  on the slab, the red frame and fill, `SLAB  CAT CADRE HOLDING  +1/s`, 0–48. No console errors.
  `__cvc.twin.kits` = 6.
- After the feed / overlay restyle:
  - e2e `-g SLAB` passes again: 2 passed (2.4 min).
  - The slab-view, slab-view-input, ui-killfeed and ui-killfeed-w10 unit tests pass: 24/24.
  - `docs/qa/w13/web-twin-slab-feed.jpg`: plain `Killer  >  Victim` lines top right, and the plain "Click to play"
    overlay with no Q line. The feed lines came from synthetic death events, fired through a hud handle exposed only
    in the private copy; bots seldom trade knockouts early in a headless run.
- Earlier, a spawn-view probe showed the plain HUD: names and scores, the clock, the slab line, `120` with its bar,
  `30 / 30`, and the hint. There was no Q ring.

## Open (outside these files)
1. Headless runs move the pet at about a tenth of real time: main.ts caps a frame's input time at 0.25 s, and
   SwiftShader frames take 2–3 s. That is why the proof camera is used instead of walking to the slab.
2. ARCHITECTURE.md lines, for the lead:
   - `modes/slab-view.ts  W13 slab read-out (frame + fill, slab.gd)`
   - `ui/slab-hud.ts  W13 slab HUD as hud.gd (scores to 60, clock/OVERTIME, slab line, HP/ammo, winner + R/Enter rematch)`
