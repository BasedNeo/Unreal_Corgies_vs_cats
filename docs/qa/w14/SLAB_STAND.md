# Standing on the slab with plain human input: still unshown

**Status: NOT SHOWN.** No plain human run exists. The only proof so far is AIDED (W13 V-PLAY, `docs/qa/w13/W13_VERIFICATION.md`):
Godot was slowed with `--fixed-fps 60` and the keys came from a script reading screenshots (xdotool). The Corgi score went
0 → 1 at 2:59 while the HUD read "SLAB CORGI COMPANY HOLDING +1/s" (`docs/qa/w13/play-slab-hud-f015-f016.jpg`). That run
does not count as a human hold.

## Why the container cannot show it
- There is no human at the keyboard; any input here is a script (xdotool), which this check excludes.
- Rendering is software only (llvmpipe/lavapipe): 1–7 FPS. Below 7.5 FPS, game time runs slower than real time, and the bot
  downs a player within 1–2 s of reaching the slab.

## The human step (one person, a machine with a real GPU, about 2 minutes)
1. From the repo root: `npm run godot -- -- --demo` (with Godot elsewhere: `GODOT=/path/to/Godot npm run godot -- -- --demo`).
   `--demo` starts you about 2 m off the slab's edge.
2. Click into the window to capture the mouse. Walk (W) into the **middle** of the slab; the slab's corners are contested
   easily, the middle is not.
3. Stay alone on it for at least **1 s**.
4. Pass when the HUD line reads `SLAB  CORGI COMPANY  HOLDING  +1/s` and the Corgi score goes up by 1. Take a screenshot.
5. Label the result **PLAIN** (keyboard and mouse only, no flags beyond `--demo`) and record the GPU, the FPS shown by the
   OS or driver, and the screenshot path in this file.

If the bot downs you first, press R after the match or wait for the respawn and try again; the count of tries is useful.
