# W15 HUD contract: Godot and the web twin

Revision 2 (lead): adds G-HUD's five decisions (the marker hides while down, the chip follows HP, the wedge holds
the attacker's position at the hit, a 0.35 s kill confirm, the death panel's backing).
Revision 3 (lead, after the Sprint B check): the marker's placement order and its safe top (§1); display names are per
build (§2); OVERTIME is a tie, not a contest (§4).

The lead owns this file. Both builds show the same words for the same state. Godot wins any clash: the web copies
Godot's strings. Change a string here first, then in both builds. `PARITY.md` (Sprint C) cites one test or shot per
row.

## 1. Objective: the slab marker (seen from each base)
- **Anchor.** The marker hangs over the slab's centre, high enough that it clears the pets standing on it (Godot:
  `slab.center` + 4.5 m). The words go above the shape, never below it.
- **Placement, in this order** (pixels in 720p units: scale by min(width/1280, height/720)):
  1. Clamp the marker's box (words and shape) into the safe area: 16 from the left and right edges, 110 from the top (below the scores,
     timer and slab line), 112 from the bottom.
  2. **No pet covered.** If the marker's box overlaps any other living pet's screen box (not the player's own pet),
     move it up until it clears with 2 of clearance, by at most 120, and never above the safe top.
  3. If that cannot clear the pet, put the box just below the lowest overlapping pet's box (2 of clearance), clamped to
     the safe bottom.
  4. If neither clears, keep the position step 2 reached (lifted at most 120, never above the safe top).
  Nothing clamps after the dodge. The marker never covers the scores, the timer or the slab line.
- **Words.** Line 1: `SLAB  <N> m`, the camera's ground distance to the slab centre, whole metres. Line 2: the state
  word.
- **State, shape and colour.** The word and the shape carry the state on their own; colour is extra.

  | State | Word | Shape | Colour |
  |---|---|---|---|
  | Nobody on it | `NEUTRAL` | hollow diamond | white |
  | One team alone on it | `CORGI COMPANY` / `CAT CADRE` | filled diamond | that team's colour, lightened |
  | Both teams on it | `CONTESTED` | diamond split by a bar | amber |
- **Off screen.** The marker clamps to the screen edge and keeps both lines.
- **On the slab, or down.** When the player stands on the slab, the marker hides; the top slab line says the state.
  It also hides while the player is down: the death panel gives the distance from the respawn, so the screen never
  shows two distances at once.
- **Do not change.** The 1.5 m lineup aim lift (match.gd `LINEUP_AIM_LIFT`) is untouched.

## 2. Death panel (while the player is down)
These four lines sit in the centre of the screen:
```
TAKEN DOWN BY <killer display name>  ·  <KILLER TEAM>
YOU: <YOUR TEAM>
BACK AT <BASE>  ·  <N> m TO THE SLAB
BACK IN <s.s>
```
- **No killer** (a fall, the map): line 1 is `TAKEN DOWN BY THE LOT`.
- **Display names are per build.** Godot names bots `Cat Bot 1` and the player `You`; the web uses its room's names.
  The format around the name is the same.
- **Team glyph.** A glyph in the killer team's colour sits before its team name: Corgi Company is a square, Cat Cadre
  a triangle. The glyph's shape carries the team, so it does not rely on colour alone.
- **Base.** `<BASE>` is `THE FOUNDATION` for the Corgis (the pit) or `THE SCAFFOLDS` for the Cats (the heap). These
  are the map's names in `src/shared/world/lot/layout.ts`.
- **--demo (Godot).** In --demo's first match a pet comes back at its demo spot beside the slab, not at its base. There
  `<BASE>` is `THE SLAB'S EDGE` and `<N>` is measured from that spot: `match.gd respawn_zone(team, pet)`.
- **Distance.** `<N>` is the whole-metre ground distance from the centre of the team's respawn points to the slab's
  centre:
  - Godot: `match.gd respawn_zone(team)`, which returns `{name, pos, dist, sprint_s}`.
  - Web: the same from its respawn points.
- **Countdown.** It is the respawn countdown in tenths: Godot `respawn_left(pet)`, web `SLAB.respawn` minus the time
  down.
- **Backing.** A dim rounded panel (black, alpha 0.55) sits behind the four lines, so lit scenery cannot cross them.
- **The point:** no 140 m surprise. The player reads where they will return before they get there.

## 3. Hits: each kind visible without colour alone
- **Own shot.** The crosshair gap opens with the spread, and there is a muzzle flash. Both exist; keep them.
- **Timing.** Body and head confirms show for 0.18 s, a kill for 0.35 s.
- **Confirm (body).** An X of four short lines, white.
- **Confirm (head).** The X plus a small filled diamond in its centre, yellow.
- **Kill.** A larger X plus a ring (an outline circle about 18 px across), red.
- **Received hit.**
  - A wedge (a filled triangle) on a ring about 110 px around the crosshair points toward where the attacker stood at
    its last hit, relative to the camera's facing; it turns with the camera. It fades over 0.6 s. It never follows
    the attacker after the hit, so it cannot reveal a hidden attacker.
  - The HP bar shows the lost HP as a white chip segment that drains over 0.4 s. The chip follows the hit points, not
    only the damage event, so a takedown with no hit before it (a fall) leaves no stuck chip.
  - A full-screen red flash may stay, at alpha 0.25 or less, but it is never the only cue.
- **Sound.** All six cues must play (`--sfx-log` on Godot, the web cue log). The own and enemy slab ticks must differ
  in length or pitch; the numbers go in `docs/qa/w15/LISTEN.md`. There is no music, and nobody claims the cues sound
  good.

## 4. HUD fields (same words, both builds)
| Field | Text |
|---|---|
| Scores | `CORGI COMPANY  <n>` left, `<n>  CAT CADRE` right, a bar under each racing to 60 |
| Timer | `m:ss`, red in the last 30 s; `OVERTIME` (amber) after 3:00 while the score is tied (at most 60 s, then a draw) |
| Slab line | `SLAB  NEUTRAL` · `SLAB  CONTESTED` · `SLAB  <TEAM> HOLDING  +1/s`, hidden once the match is won |
| Team | `YOU: <TEAM>` over the HP bar, new in both builds |
| HP | the number and the bar, with the chip from §3 |
| Ammo | `<n> / 30` or `RELOADING` |
| Win title | `<TEAM> WINS` or `DRAW` |
| Win sub | `<a>  –  <b>`, then `You: <k> takedowns · <d> knockouts`, then the rematch line |
| Rematch line | Godot: `R / Enter / Start: rematch   ·   F2 / Back: switch 1v1 / 2v2`. Web: the same where those controls exist there, else drop only the missing parts |
| fps | Godot: none. Web: only with `?debug` |
