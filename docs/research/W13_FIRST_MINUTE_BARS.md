# W13 First-Minute Bars

Researched 2026-10-01. **[A]** = labelled assumption (no source found). n/d = date not shown in results.

## 1. READ

|Bar|Source|How we test it|
|---|---|---|
|Team never carried by colour alone; add shape, trim lightness or rim|Game Accessibility Guidelines, 8-10% of males red/green deficient (gameaccessibilityguidelines.com/ensure-no-essential-information-is-conveyed-by-a-fixed-colour-alone/, n/d); Xbox XAG 103 (learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/103, n/d)|My arithmetic: STYLE_GUIDE blue #2f6fd6 vs crimson #c9344a is 1.07:1 luminance (1.18:1 deutan); gold vs black trim carries the lightness. Greyscale and deutan/protan filter on `tools/probe.mjs` shots plus `tools/char-squint.mjs`; pass = side obvious|
|Read order team, class, weapon; silhouette first|Valve TF2 (steamcdn-a.akamaihd.net/apps/valve/2007/NPAR07_IllustrativeRenderingInTeamFortress2.pdf, 2007)|`tools/char-silhouette.mjs` at 35 m, plus a corgi-vs-cat pair above the intra-species minimum|
|Enemy rim distinct from ally rim; palette option for colour-blind players|VALORANT red enemy fresnel, blue ally (riotgames.com/en/news/valorant-shaders-and-gameplay-clarity, n/d); Splatoon colour lock (gameaccessibilityguidelines.com/splatoon-colour-lock/, n/d)|Probe shot at longest sightline: rim survives bloom and fog|
|**[A]** Side identifiable at 35 m, about 20 px body height|None|720p probe at 35 m|

## 2. AUDIO

|Bar|Source|How we test it|
|---|---|---|
|Five distinct cues: shot, hit-confirm, kill, objective (start, contested, captured, lost), match end|Overwatch GDC "play by sound" (gdcvault.com/play/1023317/Overwatch-The-Elusive-Goal-Play, 2016); Halo announcer "Hill contested" (halo.bungie.org/misc/dialogue.html, n/d)|`tools/qa-audio.mjs`; unit test event-to-preset map (`presets-objective.ts` has captureFanfare/captureLament)|
|Hit-confirm in its own band, audible over rifle fire|Overwatch hit pip, high-frequency shelf (kotaku.com/the-sound-of-a-hit-in-overwatch-is-made-by-beer-1778482754, 2016)|qa-audio level check; hit peak not below shot peak **[A]**|
|Audio-only information also shown visually|GAG (gameaccessibilityguidelines.com/ensure-that-all-important-supplementary-information-eg-the-direction-you-are-being-shot-from-conveyed-by-audio-is-replicated-in-text-visuals/, n/d)|`tools/qa-hud.mjs`: each objective state has a HUD element|
|Local shot/hit sound within 40 ms added delay; hit-confirm well under 270 ms|CHI PLAY study: 40 ms no effect, 270 ms worse (dl.acm.org/doi/pdf/10.1145/3543758.3543760, 2022)|Probe: input to audio start; online confirm at most 150 ms **[A]**|
|Hit feedback clear before clever|Riot: most hit-registration complaints were clarity, not correctness (playvalorant.com/en-us/news/dev/the-state-of-hit-registration/, n/d)|Online run: each authority hit yields exactly one confirm|

## 3. FAIRNESS / FEEL

|Bar|Source|How we test it|
|---|---|---|
|First matches against bots|Fortnite (techradar.com/news/fortnite-v1040-update-brings-new-bots-to-make-you-a-better-player, 2019); Overwatch 2 (blizzardwatch.com/2025/01/29/overwatch2-ai-bots-quickplay/, 2025-01-29). No win rate published|**[A]** novice proxy wins at least 50% of 1v1 and 2v2 on the easiest tier; AFK squad survives 60 s. Extend `tools/qa-difficulty.mjs`|
|Easy-tier reaction at least 250 ms|Human about 250 ms, FPS players 150-180 ms (reactionf1.com/average-reaction-time, secondary, n/d); DeepMind agents unaffected up to 375 ms delay (arxiv.org/pdf/1807.01281, 2018)|`archetypes.ts` base 0.35-0.55 s is consistent; unit-test a 0.25 s floor on non-boss tiers|
|Controls hint in-world, not a pop-up; early first engagement|Hodent GDC: pop-ups missed under divided attention (media.gdcvault.com/gdc2016/Presentations/Hodent_Celia_TheGamersBrain.pdf, 2016)|**[A]** hint within 3 s of spawn, first enemy in view within 20 s, first shot within 30 s; scripted probe timestamps|
|Auto-step at most about 25-32% of body height|Source 18/72 u (developer.valvesoftware.com/wiki/Dimensions/de, n/d); Quake 18/56 (book.leveldesignbook.com/process/blockout/metrics/quake, n/d); Unreal 45 cm on 176 cm (dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/UCharacterMovementComponent, n/d); Unity 0.1-0.4 m for 2 m (docs.unity3d.com/Manual/class-CharacterController.html, n/d)|`sim.ts:70` autostep 0.45 m on a 1.2 m corgi is 37.5%: lead decision. `tools/qa-feel.mjs` ledge sweep 0.10-0.60 m|

## Limitations

- WebFetch was egress-blocked (learn.microsoft.com, gameaccessibilityguidelines.com, gamedeveloper.com, wikipedia). Facts come from WebSearch result text only; no page, slide or talk was opened.
- No source gave a win-rate target, read distance or time-to-first-engagement.
- Reaction figures are secondary; DeepMind studied agents against humans.
- Comparables are first-person; ours is third-person at 1.2 m.
- Colour contrast is my sRGB arithmetic, not a validated simulator.
