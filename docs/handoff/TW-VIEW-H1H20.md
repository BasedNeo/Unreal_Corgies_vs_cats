# TW-VIEW H1 + H20 receipt (W17): crosshair gap and confirm X size follow Godot, slab mode only

**Status: done for integration after round 3; nothing committed or staged.** Base HEAD `bd8adca`: it touches only
`tests/e2e/net-slab.spec.ts` on top of `d7953cb` (the patch round's base), so none of this card's files. The first
round was on `36df32f`; the three commits between it and `d7953cb` touch none of them either. Card: docs/qa/w17/PARITY.md
rows H1 and H20 (DEFECT G10, G21), under the lead's W17 ruling: in slab mode the web follows Godot; every other web mode
keeps its crosshair and markers exactly as they were. `engines/godot/game/hud.gd`, `rifle.gd` and `src/sim` are
unchanged (read only). The patch round answers the judge's FAIL ("Patch round" below). Round 3 answers the round-2
verifier's two H20 blockers under the lead's H20 ruling of 2026-10-12 ("Round 3" below).

## What changed
- **H1, crosshair gap (`src/client/ui/crosshair.ts`, new; `src/client/ui/hud.ts`).** In slab mode the gap is hud.gd:815's
  `5 + spread × 420` px at 720p, drawn at `gap × uPx` screen px, where `uPx = min(w / 1280, h / 720)` (at least 0.6),
  hud.ts's HUD unit; Godot's canvas is 720 units tall. `spread` is the authority's live rifle cone, the formula of
  `src/sim/combat/weapon-system.ts` `currentSpread`, read from the snapshot. The snapshot carries the aim flag, the
  grounded flag, the ground speed, the species and the class, so the run speed comes from `moveStatsFor`. The bloom
  is kept from your own `fire` events with the weapon's own numbers: +0.16° per shot, capped at 1.6°, recovering at
  8°/s. Slab mode has no firing +4, no kick and no easing, and no half-pixel snapping (the value is kept to 0.01 px).
  Moving and the air open the gap through the spread, as in Godot. The arms stay 9 px long with their dark underlay.
  The general HUD's own rule moved into `crosshairFrame` unchanged (the `slab: false` branch), and hud.ts gates it on
  `m.match?.mode === 'slab'`.
- **H20, confirm X size and paint (`src/client/ui/slab-hud.ts`).** `slabHitArms` builds hud.gd `hit_cue`'s arms:
  the unnormalised `(±1, ±1)` diagonals, from `d × r0` to `d × r1`, in hud.gd's order. Since round 3, `slabHitSvg`
  paints the X's lines and ring by hud.gd `draw_prims`' rule (hud.gd:736-756):
  - the four lines dark, `Color(0, 0, 0, 0.8 × a)`, `w + 2` wide;
  - then the four lines in the cue's colour, `w` wide;
  - then, for a kill, the ring dark (`w + 2`) and then in colour (`w`), after both line groups, so its dark rim lies
    over the red arms;
  - every line with **butt caps**, as hud.gd's `draw_line` draws (no caps).

  The arms now reach 7.07-14.1 px for body and head and 8.5-21.2 px for a kill, in the DOM and in the paint. Before,
  unit cos/sin made them 1/√2 of that, and the first round's round caps carried the paint `w / 2` past both ends. The
  confirm's SVG box is now ±25 px (`SLAB_HIT_BOX`), so it holds the kill X.

  **Not the same as draw_prims, and outside H20** (logged in Notes for future PARITY rows, not changed):
  - the fade's composition;
  - the head diamond (its dark rim, the fill's place in the order, its stroke);
  - the crosshair arm style and the `.hc` drop-shadow.

  Rounds 1 and 2 also drew the kill ring in the line groups (the dark ring under the red lines) with a 0.6 underlay;
  round 3 fixed both.

## Round 3 (the round-2 verifier's H20 blockers; lead ruling 2026-10-12)
The lead's ruling: H20 parity is the drawing rule, pinned by tests in BOTH builds. That means:
- the X's line geometry (the unnormalised diagonals, `d × r0` to `d × r1`);
- the caps (none, butt, as `draw_line`);
- the colour, the widths (`w` and an underlay of `w + 2`) and the underlay's alpha;
- the paint ORDER.

The residual antialiasing (about one diagonal pixel at each end) is reported, not gated. The painted ends must lie
within 1 px.
- **Web paint order and alpha (blocking 2, minor 1).** `slabHitSvg` now emits `<g under>lines</g><g over>lines</g>`,
  then for a kill `<g under>ring</g><g over>ring</g>`, then the head's diamond. That is draw_prims' order: dark lines
  (:748-749), colour lines (:750-751), then each ring dark and then colour (:754-756). The underlay is
  `rgba(0,0,0,0.8)` (`SLAB_HIT_DARK_ALPHA`): hud.gd:737's `0.8 × col.a`, with the cue's alpha a applied as the `.hc`
  element's opacity. Rounds 1 and 2 used `.6`, with the ring in both line groups.
  - The H20 paint test in `tests/unit/slab-hud.test.ts` reads the SVG's paint in document order. It requires exactly:
    4 dark lines (alpha 0.8, `w + 2`, butt) on hud.gd's diagonals; 4 colour lines (`w`, butt); for a kill, the dark
    ring then the colour ring; for the head, the diamond last.
  - It fails on round 2's `slab-hud.ts` as shipped (old order and .6). It also fails on each of the 8 web mutants below.
- **Godot pins the paint (blocking 1).** `engines/godot/tests/test_hud_crosshair.gd`'s recorder now also compiles
  hud.gd's own `draw_prims` from its source. `_draw_item`'s one `draw_prims(ci, ...)` call is pointed at that copy
  (the test fails if `_draw_item` stops calling it once). The recorder keeps every call in order: `draw_line`,
  `draw_circle`, `draw_polyline`, `draw_colored_polygon`, `draw_arc`.

  For body, head and kill, pure (`build_overlay` at full show, a = 1, and half faded, a = 0.5) and live (the player's
  own hits), the test requires exactly this call list, each call's colour (alpha), width and geometry:
  - head only, first: the diamond's dark rim, a closed polyline 4 px wide;
  - 4 `draw_line` dark, `Color(0, 0, 0, 0.8 × a)`, `w + 2`, from `c + d × r0` to `c + d × r1`;
  - 4 `draw_line` in `CUE[kind]` at alpha a, `w`;
  - head only: the diamond filled in colour;
  - kill only, after both line loops: `draw_arc` dark, `w + 2`, r 9, 0 to TAU, then in colour, `w`.

  It also pins `pr.width` (2.5, 2.5, 3.0) and the cue colours, written out (white; (1, 0.85, 0.2); (1, 0.25, 0.2), the
  web's 0xffffff, 0xffd933 and 0xff4033). The verifier's G2, G3, G4 and an order swap now fail, among 13 Godot mutants
  below.
- **The kill notch, live at 720p.** Flat crops, read on the diagonal pixel k7 at (7 + .5)·√2 = 10.6 px out, the mean
  of the four arms:

  | | luminance | coverage |
  |---|---|---|
  | Godot (my render of hud.gd draw_prims, gl_compatibility under xvfb; identical to the verifier's) | 51 | .32 |
  | web, round 2 | 104 | 1.00 |
  | web, round 3 | **54** | **.34** (the verifier's static re-render predicted 54 and .34) |

  Off-axis pixels more than 0.25 from Godot (max RGB channel; pixels within 4 px of the axes left out, since the web
  crop carries the crosshair): kill 44 → **24**, body and head 32 → 32 (the antialiased ends and the drop-shadow). The
  kill's lit pixels (meas.py) are 168 → 148, against Godot's 156.
- **The painted ends, under the ruling.** Measured as in the patch round, they are unchanged; every end is within 1 px:

  | X | web | Godot | difference |
  |---|---|---|---|
  | body, head | 7.78-13.44 | 7.11-14.16 | 0.67 and 0.72 px |
  | kill outer end | 20.51 | 21.22 | 0.71 px |
  | kill inner end | 7.78 | 7.78 | 0 (the ring masks it in both) |

  The residual is Godot's antialiasing feather (about 0.42 px past each line end), reported, not gated.
- **Sheet.** `docs/qa/w17/h1h20-web-confirm-x.jpg` is retaken. Top row: Godot (lens B's in-game flat crops). Bottom
  row: the web live in round 3. Body, head and kill at 4x, plus the kill's lower-right arm at 8x with the k7 notch
  pixel outlined and its luminance printed (51 against 54). The web's kill arms now stop at the ring's dark rim, as
  Godot's do.
- Files this round: slab-hud.ts, tests/unit/slab-hud.test.ts, engines/godot/tests/test_hud_crosshair.gd, this receipt
  and `h1h20-web-confirm-x.jpg`.

## Patch round (the judge's FAIL)
- **H20 paint (blocking).** `slabHitSvg` draws both groups with `stroke-linecap="butt"` and the underlay `w + 2`
  wide (`SLAB_HIT_UNDER`), as hud.gd draw_prims (hud.gd:748-751, the ring at :755). The painted arms now stop at the
  line ends. Measured live at 720p with lens B's scanner (meas.py x, pixels at least 50 % lit): see the X rows below.
  `SLAB_HIT_BOX`'s comment no longer speaks of a round cap.
- **H1 rules check (blocking, doc).** The cadence row, the tick-order text and the firing Godot cell are corrected,
  and the order-only patch is replaced by the two options, owned by the lead (see the rules check).
- **Bloom stacking.** Each own `fire` is stamped with its snapshot's sim time: main.ts passes `serverSec()` (the
  latest snapshot's tick / tick rate, already used for the awards) to `hud.onGameEvent(ev, simT)`, and
  `crosshairShot(st, kick, def, now, simT)` recovers the bloom over the sim time between shots. Shots heard in one
  frame no longer stack; the bloom then recovers on the HUD clock from when the shot was heard, as before. Without a
  sim time (labs), the HUD clock stamps it.
- **The DOM write.** `crosshairArms(px, uPx)` (crosshair.ts) builds the four arm transforms; hud.ts writes them as
  they are, so uPx is applied once (in `crosshairPx`) and the write is unit-tested at any screen size.
- **The `.hc` scale.** `SLAB_HIT_SVG_TAG` and `SLAB_HUD_CSS` are exported, and one test reads the viewBox and the CSS
  box together.
- **Godot's draw path.** test_hud_crosshair.gd runs hud.gd's own `_draw_item` against a recorder and pins the arms'
  line ends to the gap.
- **The end gate.** `slabHudFrame` draws no confirm once the slab match is over (nor without a player), like the
  wedges and as hud.gd build_overlay.
- Files this round: crosshair.ts, hud.ts, slab-hud.ts, **src/client/main.ts** (one line: the sim time into
  `hud.onGameEvent`), the two web tests, test_hud_crosshair.gd, this receipt and `h1h20-web-confirm-x.jpg`.

## Numbers (720p px; Godot from tuning.gd and hud.gd, web measured)
| | Godot | web before | web now |
|---|---|---|---|
| gap at rest (hip) | 13.796 | 7 | **13.8** (DOM `[data-xr]` `translateX(13.8px)`); **20.69** at 1920×1080 (live DOM `translateX(20.69px)`, 13.796 × 1.5; the `.hc` box 75 px there) |
| gap aiming | 7.566 | 3.5 | 7.566 (unit test, real sim) |
| gap running (corgi at 6.4 m/s) | 18.195 | 7 + 0.9 × speed | **18.19** (DOM, W held) |
| gap in the air, standing | 24.352 | 16 | 24.352 (unit test, real sim) |
| firing in place | 13.796; 13.992 on each shot's tick; 14.187 on the second tick of a fresh burst | 18.5 the frame after a shot | 14.97 on the shot's tick, 13.99 on the next, then 13.8 (the web sim's; see the rules check) |
| X body / head reach | 7.07-14.14; painted 7.11-14.16 (meas.py) | 5-10 | **7.07-14.14** (DOM line ends); the paint ends there (butt caps). Live 720p paint: meas.py ≥ 50 % pixels 7.78-13.44 (Godot 7.11-14.16; the first round's round caps 6.36-14.85); ink-profile ends 6.92-14.30 (Godot 6.17-15.04) |
| X kill reach | 8.49-21.21; painted outer edge 21.22 (meas.py; the ring masks the inner end) | 6-15 | **8.49-21.21** (DOM line ends); live 720p paint: meas.py outer edge 20.51 (Godot 21.22, within one pixel; round caps 21.92), the inner end masked by the ring in both (7.78); ink-profile outer end 21.12 (Godot 22.04). Round 3: the ring's dark rim now notches each red arm as in Godot (the pixel 10.6 px out: luminance 54, Godot 51; round 2 104) |

**The painted ends, measured (patch round).** Live headless page (SwiftShader, `?mode=slab&webgl&quality=low&autoplay&
slabWin=999&slabTime=900`), flat crops (canvas hidden, #3a3a3a), read with lens B's scanner (verify-h1h20-visual/tools/
meas.py x: pixels at least 50 % lit) and with an ink profile along each arm (the summed coverage across the arm, its 50 %
edge interpolated; `scratchpad/h1h20b/tools/xprofile.py`), against lens B's Godot crops:

| | Godot | web, round caps (first round) | web now (butt caps, w + 2) |
|---|---|---|---|
| body / head, meas.py ≥ 50 % | 7.11-14.16 (68 px) | 6.36-14.85 (76 px) | 7.78-13.44 (52 px) |
| body / head, ink profile | 6.17-15.04 | 6.08-15.13 | 6.92-14.30 |
| kill, meas.py outer edge | 21.22 | 21.92 | 20.51 |
| kill, ink profile outer end | 22.04 | 22.25 | 21.12 |
| mean pixel distance to Godot over the X (body / head / kill) | 0 | 0.038 / 0.034 / 0.036 | 0.038 / 0.032 / 0.028 |

The web's paint now stops at hud.gd's line ends (7.07-14.14, 8.49-21.21): its part-covered end pixels are 46 % lit,
the exact coverage of a butt end through them (48.7 %). Godot's paint does not stop there: hud.gd draws the X with
`draw_line(..., true)`, and Godot's antialiasing feathers each line about 1 px outward, ends included (its diagonal
pixel just past each end is 38 % lit where the geometry gives 0, and the off-diagonal end pixels 92 % where it gives
49 %). So by meas.py's 50 % rule Godot reads one diagonal pixel row longer at each end than the butt-capped web
(7.11-14.16 against 7.78-13.44); by the ink profile Godot's arm reaches ~0.8 px past its line ends, about as far as a
round cap would. An offline Chrome render without GPU rasterisation (the judge's method) happens to read 7.11-14.16,
because its end pixels land just above or below 50 %; the live page's read 46 % at both ends. A half-alpha 1 px feather
round each butt line (an emulation of Godot's) was tried offline: it reads 7.11-14.16 but doubles the pixel distance to
Godot (0.067), so it is not shipped. The kill's outer edge is within one pixel of Godot's. The geometry, caps,
widths follow hud.gd since round 2; the underlay alpha (0.8, was .6) and the paint order follow it since round 3. **The lead ruled on 2026-10-12** that the
residual, Godot's antialiasing, is reported, not gated, and that the painted ends must lie within 1 px. They do:
- body and head: 0.67 px inner and 0.72 px outer (web 7.78-13.44 against Godot 7.11-14.16);
- the kill's outer end: 0.71 px (20.51 against 21.22);
- the kill's inner end: 0 (7.78 in both, masked by the ring).

**Bloom, live.** 60 frames of fire in place at 720p: the gap never went past 14.39 px (lens B saw 16.98 once with the
HUD-clock stamp); 56 of 60 frames at 13.8.

**The end gate, live** (1920×1080, `&slabTime=45&slabOvertime=3`): on the winner screen a body hit and then a
knockout by you were appended to real worker snapshots; over six frames each, `[data-slab-hit]` stayed at opacity 0
with no kind.

Shots (1280×720, `?mode=slab&webgl&quality=low&autoplay`, SwiftShader):
- `docs/qa/w17/h1h20-web-rest.jpg`: tools/probe.mjs, 45 s, at rest.
- `docs/qa/w17/h1h20-web-moving.jpg`: W held through the shot.
- `docs/qa/w17/h1h20-web-crosshair.jpg`: 3x crops, at rest on the left and running on the right.
- `docs/qa/w17/h1h20-web-confirm-x.jpg` (retaken in round 3, with draw_prims' order and the 0.8 underlay): flat crops
  at 720p, side by side. The top row is Godot's body, head and kill X (lens B's render, xvfb, gl_compatibility); the
  web's is below. Each is shown at 4x, plus the kill's lower-right arm at 8x with the notch pixel (k7, 10.6 px out)
  outlined. The round-3 web crops come from `?mode=slab&webgl&quality=low&autoplay&bots=0,0` (no bot scores the slab,
  so the match stays live).

tools/probe.mjs lets go of `PROBE_KEYS` before it takes its screenshot, so its KeyW shot shows the pet already
stopped (13.8 px). The moving and confirm shots therefore come from a private staged script. It holds W through the
shot, adds `&slabWin=999` so the Cat bot cannot end the match first, and appends a body hit and then a knockout by
you to a real worker snapshot. The page clock freezes as each one arrives, so the 0.18 s and 0.35 s confirms hold.

## Tests
- `tests/unit/slab-crosshair.test.ts` (new, 14 tests):
  - the rule and the rifle's numbers;
  - the gap from a snapshot: hip, aim, run (corgi and cat), sprint clamp, air, air while running, and bloom; firing
    and sprinting add nothing;
  - the bloom's closed form (`bloomAfter`);
  - **shots heard in one frame** (patch round): three shots 0.1 s apart on the sim, heard in one HUD frame, leave one
    shot's bloom (14.97 px drawn, not the 17.3 px three stacked shots give with the HUD-clock stamp); one tick apart
    they keep what the authority's would; a sim clock that goes back carries nothing over;
  - **the DOM write at any screen** (patch round): `crosshairArms(crosshairPx(gap, uPx), uPx)` at 1280×720,
    1920×1080, 2560×1440 and 960×540: `[data-xr]` reads 13.8, 20.69, 27.59 and 10.35 px at rest, each arm 9 HUD units
    long;
  - a **real slab sim on The Lot**: at rest, aiming, every tick of a run from rest, every tick in the air, and 60
    ticks of fire in place. Each frame's drawn gap, taken from the packed and unpacked snapshot, equals
    `5 + 420 × currentSpread(sim entity)` (bloom included) and Godot's written-out number (the firing peak is the web
    sim's 14.97; live Godot differs there, see the rules check);
  - **a slow frame on the real sim** (patch round): three times, 20 ticks of fire heard in one HUD frame, each shot
    stamped with the tick of the snapshot that would carry it: the HUD's bloom equals the authority's after its last
    shot and the frame draws 14.97 px;
  - **every other mode unchanged**: 400 scripted frames (rest, run, sprint, air, firing with shots, aiming) through
    `crosshairFrame(slab: false)` and through a copy of HEAD's hud.ts rule give the same pixels, to the bit;
  - pixel snapping (half pixels for other modes, 0.01 px for slab);
  - the wiring (source pins): hud.ts gates the rule on `mode === 'slab'`, writes `crosshairArms(px, uPx)` untouched
    to the four arms, and stamps an own shot `crosshairShot(..., now, simT)`; main.ts passes
    `hud.onGameEvent(ev, serverSec())`.
- `tests/unit/slab-hud.test.ts` (40 tests):
  - H20 geometry: `slabHitArms` for body, head and kill equals hud.gd's diagonals and reaches; the SVG draws exactly
    those eight lines (underlay and colour); the box holds the kill X;
  - **H20 paint** (round 3; it replaces the patch round's group test): the SVG's paint, read in document order, is
    exactly hud.gd draw_prims':
    - the 4 dark lines (`rgba(0,0,0,0.8)`, `w + 2`: 4.5 or 5) on hud.gd's diagonals;
    - then the 4 colour lines (`w`: 2.5 or 3);
    - then, for a kill, the dark ring and then the colour ring;
    - the head's diamond last.

    Every group is butt-capped, and no line sets its own cap, so the paint runs from r0·√2 to r1·√2 exactly;
  - **H20 scale** (patch round): the `.hc` element's viewBox (±25) and its CSS box (`#cvc-slab .hc`: 50 HUD units
    square, margin −25, at 50 %/50 %) taken from the real `SLAB_HIT_SVG_TAG` and `SLAB_HUD_CSS` strings: one viewBox
    unit is one HUD unit;
  - **the end gate** (patch round): with a body confirm and a wedge showing, the match ends: neither draws; the
    winning knockout's kill confirm does not draw either, though the cue timers run on; no confirm without a player.
- `engines/godot/tests/test_hud_crosshair.gd` (new, headless) pins what hud.gd draws, without touching hud.gd:
  - pure `build_overlay`: the crosshair gap is `5 + spread × 420` for six spreads, centred, and the rifle's spreads
    give 13.796, 7.566, 18.195, 24.352 and 14.969;
  - **the line ends drawn from the gap** (patch round): hud.gd's own `_draw_item`, read from its source and compiled
    into a recorder (a hud.gd subclass whose `draw_line` / `draw_circle` keep their arguments), draws each arm from
    `c + d × gap` to `c + d × (gap + 9)`, dark 4 px under light 2 px, plus the 1.6 px dot, for the six spreads and live
    at rest, running and in the air. A `gap × 0.5` in hud.gd's draw path fails it;
  - the confirm X's four lines lie on hud.gd's diagonals, reaching 7.07-14.14 and 8.49-21.21;
  - **the X's paint** (round 3): hud.gd's own `draw_prims`, compiled into the same recorder with `_draw_item`'s call
    pointed at it, paints each confirm with exactly this call list. Each call's colour (alpha), width and geometry
    are pinned, as is `pr.width` (2.5, 2.5, 3.0) and the cue colours. It is checked pure, at a = 1 and a = 0.5, and
    live:
    - head: the diamond's 4 px dark rim first;
    - 4 dark lines, `Color(0, 0, 0, 0.8 × a)`, `w + 2`;
    - 4 colour lines, `w`;
    - head: the diamond fill;
    - kill: the dark ring (`w + 2`) and then the colour ring (`w`), after both line loops.

    Before round 3, Godot pinned only the X's geometry: the verifier's mutants G2 (underlay `w + 3`), G3 (colour
    lines under the dark) and G4 (kill width 2) passed every `test_hud*`.
  - a live 1v0: the overlay's gap follows `current_spread() + rifle.bloom` at rest, with one shot's bloom, aiming,
    every frame of a run (18.195 at the run speed) and every frame in the air (24.352 standing), and returns to
    13.796 on landing; body, head and kill hits on the live player draw Godot's X, painted as above.
  - `PASS test_hud_crosshair.gd`; every `test_hud*` file passes.
- Round 3, private tree (HEAD `bd8adca` plus this card's files): `tsc --noEmit` and `check:boundaries` pass. vitest
  runs slab-hud, slab-crosshair and slab-view, plus slab-view-input, abilities, combat and destruct: 117/117. Godot
  4.7.2 headless after a fresh import: `test_hud_crosshair` passes. The lead's trial results are in the round's report.

## Mutants (each applied in the private tree, the test run, the file restored and proven equal with cmp)
First round: 15 of 15 killed (web W1-W10: the old unit cos/sin X, firing +4 back in slab, the slab gap from the old
heuristic, the slab gate dropped in `crosshairFrame`, the gate dropped in hud.ts, the kick kept in slab, no air term,
bloom not tracked, the move term against the sprint speed, the slab gap snapped to half pixels; Godot G1-G5 on hud.gd
in the copy: the gap base 7, the slope 400, the X on unit diagonals, the overlay spread without the bloom, kill r1 14).

Patch round: 12 of 12 killed.
- **Web:**
  - M1: round caps back on both groups; M1b: on the colour group only (H20 paint test: `expected 'round' to be 'butt'`);
  - M2: the underlay `w + 2.4` (`SLAB_HIT_UNDER`); M2b: a literal `+ 2.4` in the markup (H20 paint test);
  - M3: the end gate dropped, `confirm = dead ? null : ...` (the end-gate test);
  - M4: the HUD-clock stamp back, the bloom recovering over `now - shownAt` (the one-frame test and the real-sim slow
    frame: `0.00838 to be close to 0.00279`, three shots stacked); M4b: hud.ts drops `simT`; M4c: main.ts calls
    `hud.onGameEvent(ev)` (the wiring pins);
  - M5: uPx applied twice in `crosshairArms` (`translateX(31.035px)` for `20.69px`); M5b: `crosshairArms(px * uPx,
    uPx)` in hud.ts (the wiring pin);
  - M7: the `.hc` CSS box back to 40 units with the ±25 viewBox (`expected [40] to deeply equal [50]`).
- **Godot**, on hud.gd in the copy only: G6: `c + d * gap * 0.5` in `_draw_item`'s light line; G6b: `var gap: float =
  it.gap * 0.5` (both: `arm drawn from (2.5, 0) ... want (5, 0)`).

Round 3: 21 of 21 killed. Each file was restored and proven equal with cmp; hud.gd is back to HEAD's sha1.
- **Web** (slab-hud.ts; the H20 paint test kills each):
  - W1: round 2's order, the ring in both line groups;
  - W2: `SLAB_HIT_DARK_ALPHA = 0.6`; W2b: a literal `rgba(0,0,0,.6)`;
  - W3: the verifier's V5, the ring missing from the underlay;
  - W4: the colour ring before the dark;
  - W5: the rings before the lines;
  - W6: the colour lines before the dark;
  - W7: the head diamond before the lines.

  Round 2's `slab-hud.ts` as shipped also fails the test.
- **Godot** (hud.gd in the private copy only; `test_hud_crosshair` fails on each, pure and live):
  - G2: the underlay `w + 3` (the verifier's);
  - G3: the colour lines before the dark (the verifier's);
  - G4: the kill's `out.width = 2.0` (the verifier's);
  - G5: the rings drawn before the lines (an order swap);
  - G6: the dark alpha `0.6 × a`; G6b: `0.8` not faded by a;
  - G7: the ring colour then dark;
  - G8: the head fill before the lines;
  - G9: the head rim 3 px;
  - G10: the ring's underlay `w + 3`;
  - G11: the head rim after the lines;
  - G12: the kill colour (1, 0.3, 0.2);
  - G13: the ring radius 10.

## Rules check (H1): the web sim's slab rifle spread against Godot's tuning.gd
| rule | web sim | Godot | |
|---|---|---|---|
| hip cone 1.2° | `src/shared/content/weapons.ts:111` `spreadHip: 1.2 * DEG` | `engines/godot/game/tuning.gd:29` `spread_hip` | = |
| aim cone 0.35° | `weapons.ts:111` `spreadAim` | `tuning.gd:29` `spread_aim` | = |
| move factor 1.5 at the run speed, linear | `weapons.ts:111` `moveSpreadMult`; `src/sim/combat/weapon-system.ts:67-70` `min(1, hs / runSpeed)` | `tuning.gd:29` `move_mult`; `player.gd:118-119` `clampf(hs / m.run, 0, 1)` | = |
| run speed 6.4 (corgi) / 6.6 (cat) | `src/shared/content/classes.ts:34`, `:41` (assault adds no override, `:50`) | `tuning.gd:19`, `:21` `run` | = |
| air factor 2.2 off the ground | `weapons.ts:111` `airSpreadMult`; `weapon-system.ts:70` `c.grounded` | `tuning.gd:29` `air_mult`; `player.gd:120-121` `is_on_floor()` | = |
| aim is the held aim button | `weapon-system.ts:69` `held(e, Btn.Aim)` | `player.gd:95`, `:117` | = |
| bloom +0.16° a shot, cap 1.6° | `weapons.ts:112`; `weapon-system.ts:113` | `tuning.gd:30`; `rifle.gd:107` | = |
| bloom recovers 8°/s | `weapons.ts:112`; `weapon-system.ts:164` | `tuning.gd:30`; `rifle.gd:80` | = |
| a shot's cone is spread + bloom | `weapon-system.ts:70` (`+ w.bloom`), `:112` | `rifle.gd:106` (`spread + bloom`) | = |
| cone sampling | `weapon-system.ts:47-62`: `r = spread·√u`, uniform φ, offset `tan r` (exactly angle r) | `rifle.gd:160-168`: `a = spread·√u`, uniform φ, rotate by `a` | = (same distribution) |
| tick | constants.ts:4 60 Hz | project.godot:20 60 Hz | = |
| cadence | weapon-system.ts:163 decrements only a positive cooldown and :168, :203 reset a negative one to 0, so the web never banks a shot | rifle.gd:79 floors the cooldown at -1/fire_rate, so an idle rifle banks a whole interval and every fresh trigger pull fires on two back-to-back ticks (rifle.gd:76, :104) | differs |
| order in a tick | `weapon-system.ts:164` recovers, then `:196` fires | `player.gd:106-107` fires, then the rifle (a child node, `pet.gd:88-92`) recovers, `rifle.gd:80` | differs (see below) |

**The spread values and formulas match, but two sim rules differ.**
- **(a) Order within a tick.** The web recovers and then fires; Godot fires and then recovers. The web HUD draws
  14.969 px on each shot's tick and 13.992 on the next; Godot draws 13.992 on the shot's tick.
- **(b) Cadence.** Godot fires twice on the first two ticks of every trigger pull after at least 0.1 s idle. Its
  second shot leaves with 0.027° of bloom and its HUD draws 14.187 px once per burst. It fires 5 shots to the web's 4
  in the first 20 ticks; an 8-shot kill is 0.617 s against 0.700 s.

**Owner of both rules: the lead** (a new DEFECT row next to G10; src/sim and rifle.gd are not this lane's, and nothing
in this card changes them). The two options, from the judge's rules follow-up:

- **Option A, if Godot is right ("Godot wins").** Lens C's patch A (`verify-h1h20-rules/patchA-weapon-system.diff` in
  the lead's scratchpad), measured to give tick for tick the same shot ticks and gap histogram as Godot (62 ticks of
  fire: 50 × 13.7965, 11 × 13.9919, 1 × 14.1874 px in both). In `updateWeapon`: delete `:163-164`; after the fire
  block, in place of `:203`, add `w.cooldown = Math.max(w.cooldown - dt, -1 / def.fireRate); w.bloom = Math.max(0,
  w.bloom - def.bloomRecover * dt);`; do the same in the `e.dead` branch, in place of `:168`; change `:195`
  `w.cooldown <= EPS` to `w.cooldown <= 0` (rifle.gd:76's test). **Gate it to the slab rifle (or slab mode)**: as
  written it also lets semi-auto weapons bank an interval in other modes. With it, `crosshairShot` (crosshair.ts) must
  record the shot's bloom one tick of recovery lower, `min(max, b + per) − recover / 60`, and
  `tests/unit/slab-crosshair.test.ts`'s fire-in-place check must expect 13.992 (lens C showed that check fails under
  patch A until then, so it guards the link between the HUD and the sim).

  ```diff
  --- a/src/sim/combat/weapon-system.ts   (updateWeapon; patch A, to be gated to the slab rifle)
  -  if (w.cooldown > 0) w.cooldown -= dt; // may dip below 0 by < dt: that carry keeps exact fire rates
  -  w.bloom = Math.max(0, w.bloom - def.bloomRecover * dt);
     w.buffer = Math.max(0, w.buffer - dt);
     if (e.dead) {
       w.charge = 0; w.charging = false;
  -    if (w.cooldown < 0) w.cooldown = 0;
  +    w.cooldown = Math.max(w.cooldown - dt, -1 / def.fireRate);
  +    w.bloom = Math.max(0, w.bloom - def.bloomRecover * dt);
  @@
  -    } else if (w.cooldown <= EPS && (def.auto ? fireHeld : w.buffer > 0)) {
  +    } else if (w.cooldown <= 0 && (def.auto ? fireHeld : w.buffer > 0)) {
  @@
  -  if (!fired && w.cooldown < 0) w.cooldown = 0;
  +  w.cooldown = Math.max(w.cooldown - dt, -1 / def.fireRate); // rifle.gd:79
  +  w.bloom = Math.max(0, w.bloom - def.bloomRecover * dt); // rifle.gd:80
  ```
- **Option B, if the double tap is a Godot bug.** rifle.gd:103's comment says the floor only keeps the 10 rps cadence
  when a tick overshoots, not a whole banked interval, and the web's 0.7 s time to kill is the written design
  (weapons.ts:107). Then floor rifle.gd:79 at `-delta` (keep only the part of a tick it overshot), a Godot game lane's
  change, and the web sim takes only the order half: the bloom recovers after the shot.

After the lead rules, the tw-sim lane changes src/sim (or a Godot game lane changes rifle.gd), and tw-view realigns
crosshair.ts and the fire-in-place test.

## Notes
- On The Lot, the ground at z ≈ 0 east and west of the slab (for example x = ±20 and x = 30) slows a pet to
  1.9 m/s (wading), whichever way it walks. The unit test runs at (0, 20), where a corgi reaches 6.4 m/s.
- Fixed in the patch round: a confirm landing while the match was over drew on the web's winner screen. `slabHudFrame`
  now gates the confirm like the wedges (the player up and the match not over), as hud.gd `build_overlay` does.
- Fixed in round 3: the X's dark underlay was `rgba(0,0,0,.6)` on the web; it is now `0.8` × the cue's alpha, as
  hud.gd draw_prims' `Color(0, 0, 0, 0.8 * col.a)`.
- **Pre-existing paint differences outside H20's rule** (the round-2 verifier's list). These are notes for future
  PARITY rows; they are not fixed here, and the lead names the rows:
  - **(a) The fade's composition.** The web fades the whole confirm SVG with the element's opacity
    (`slab-hud.ts` writes `.hc` opacity = the confirm's alpha), after its drop-shadow. Godot multiplies each
    primitive's alpha: dark `0.8 × a`, colour a (hud.gd:737). At full show they agree. Mid-fade the web composites the
    finished X once, while Godot lets each half-transparent primitive show the one below it.
  - **(b) The head diamond.**
    - Godot first draws the diamond's 4 px dark rim, a closed polyline under everything (hud.gd:741-744), and fills
      the diamond after the colour lines (:752-753).
    - The web draws the diamond last, with a 1.2 px `rgba(0,0,0,.75)` stroke, and has no 4 px rim.
    - The H20 paint test pins the web's diamond in last place as it is now; the Godot test pins hud.gd's.
  - **(c) The crosshair arm style and the `.hc` drop-shadow.**
    - The web's slab crosshair arms are 3 px with an ink shadow; Godot's are 2 px over a 4 px `Color(0, 0, 0, 0.6)`
      line, plus a 1.6 px dot.
    - The `.hc` element's `drop-shadow(0 0 1.5u rgba(0,0,0,.9))` has no Godot counterpart: it darkens the pixel just
      past each web X end (luminance about 43 against the 58 ground).
    - The painted gap still agrees (inner edge 13.97 against 14.0, the round-2 verifier).
