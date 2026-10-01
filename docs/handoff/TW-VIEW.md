# TW-VIEW handoff — the slab match in the browser (Wave 13)

**Status: done for integration; nothing committed or staged.** The web client plays the Godot game's match against
TW-SIM's `slab` authority (contract: the slab section of `src/shared/content/modes.ts`). Godot is the main build: the
read-out, HUD text and colours copy `engines/godot/game/slab.gd`, `hud.gd` and `tuning.gd`.

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
