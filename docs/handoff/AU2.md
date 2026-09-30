# AU2 handoff — the sound of the new war (Wave 10, audio-2)

**Status: done for integration; nothing committed or staged.** Base Assault has its own sound: the squeaky ball
squeaks where it changes hands, a field-bugle call says what happened (different for us and for them), a capture
fanfare plays, and a heartbeat and pulse run under the music while a ball is on the move. Throwables now warn the
player they threaten: the fuse tick was 23 dB under a storm firefight in its own band, and now stands 4 to 13 dB over
it. The Lot has ambience placed from its world data and driven by the weather: rain on steel and tarps, drips, the
crane in the wind, floodlight hum, the ditch running, and far site noise. The West Yard's ambience output is
bit-identical to HEAD's.

Everything is procedural (no files) and goes through the existing `AudioEngine`, its voice limiter and its buses.
One-shots are limited, loops hold limiter voices, and every continuous layer ducks under combat.

**Wiring:** 5 lines in `main.ts` (§5). Without the snippet the Base Assault cues and the fuse fix still work (they
live inside `createAudio` / `createOrdnanceAudio`). The HUD's old placeholder sounds would double them, though, and
The Lot would have no site ambience.

## 1. The cues and why

### Base Assault (`presets-objective.ts`)
"Mine" is `score.team === the local team`. By G4a's convention that is always good news for us: our steal, our
capture, our ball back, and our ball dropped by their carrier. Each event has two layers.

| Event | The ball (positional, sfx bus, where it happens) | The call (2D, ui bus, in the music's key of F) |
|---|---|---|
| steal (`pickup` squeaky_ball, then `ball taken`) | `ballGrab`: two squeezes as a paw clamps it. Mine: eager, rising. Theirs: the second squeeze is strangled and falls. 2D when it's your own steal. | Mine: a rising "go" bugle over a snare flam. Theirs: a two-tone alarm over tom thumps. |
| `ball dropped` | `ballBounce`: it hits the ground and bounces three times. Mine: each bounce higher. Theirs: sagging. | Mine: "hup-HUP". Theirs: "uh-oh", falling. |
| `ball returned` | `ballHome`: a squeeze and the stand's tin cup. Mine: a bright tink. Theirs: a dull clunk. | Mine: "secured", a warm resolving chord. Theirs: a muted "womp". |
| `captured` | `ballSqueal` at the scorers' ring. Mine: a long rising SQUEEEAK. Theirs: a falling squeal with air leaking out. | Mine: `captureFanfare` (snare roll, bugle, the full F chord, timpani, crash, and the ball squeaking along in tune on top; ~2.3 s). Theirs: `captureLament` (a snare hit, a low B♭-minor brass chord sagging a semitone, the ball deflating). |

Why: HARDENED keeps the humour in the soldiering. The frame is military (bugle calls, snare, timpani) and the pet
joke is one layer on top (the squeaky ball squeaking along). Mine and theirs differ in the ball's contour and in the
call, so you can tell good news from bad without looking.

These replace G4a's placeholders: index.ts's generic pickup chime and team sting for these events, and the HUD's C2
barrier squeak and chapter fanfare (via the main.ts snippet). Other modes' pickups and scores sound exactly as
before (tested).

### The carrier tension layer (`music-tension.ts`, a new `pulse` layer in `music.ts`)
`objectiveTension(states, localId)` is pure and reads the Base Assault props already in the snapshot:
- a teammate carries their ball: 0.5 → 0.85 as the carrier nears our ring;
- you carry it: 0.72 → 1.0, and you are "hunted";
- they carry ours: 0.52 → 0.92 as they near their ring, and you are "hunted";
- a ball on the ground: 0.25 to 0.3.

The director smooths it (rise 0.25 s, fall 1.2 s). Music plays it on its own 16th-note clock, always in time and in
key:
- **heartbeat:** a low lub-dub on beats 1 and 3 from level 0.2, on every beat (108 bpm) from 0.55;
- **pulse:** from 0.7, 8th notes on the chord root with a filter that opens as the carrier nears the ring;
  - hunted: root and minor second alternate (something closing in);
  - otherwise root and fifth (a drive home).

The layer ducks under the groove exactly like the bed (−35 % at full combat). It is a music layer, so like the bed,
groove and stabs it sits outside the voice limiter (L5's design), and the music volume slider controls it.

### Throwables in the mix (`presets-ordnance.ts`, `engine.ts`, `weather.ts`, `voice-limiter.ts`)
Measured in a storm firefight: the peep sat 23 dB under the rain and guns in its best band. **The storm rain bed was
the main masker** at 2 to 5 kHz (−34 dB per third-octave band), ahead of the guns (−37 to −41) and the music (≤ −59).

A tick now knows whom it threatens: an enemy throwable, or your own (self damage). Friendly fire is off, so a
teammate's is not a threat. Threat is measured from the local character (`engine.focus`, set by `GameAudio.update`),
not from the camera: 1 within 4.5 m, 0 beyond 10 m. When threatened:
- **gain:** × (1 + 9·threat) for the squeaker, × (1 + 4.5·threat) for the hairball. The crackle sits high, where
  little masks it;
- **voice:** the squeaker plays `fuseAlarm`, which is X4's peep plus a shrill partial at 4.6 to 5.6 kHz, the band
  where rain and guns leave the most room;
- **limiter:** priority 3 and its own limiter category `fuse` (cap 4), so gunfire can never steal or refuse a tick;
- **danger duck:** `engine.raiseDanger(threat × (0.7 + 0.3 × urgency), hold 0.5 s)`. The continuous ambience beds
  scale by `engine.bedDuck()`, down to −11 dB at full danger, and come back 0.35 s after the blast. This covers
  `weather.ts` (rain, roar, wind, sprinkler) and the site ambience. `bedDuck()` is exactly 1 without danger, so
  `weather.ts` output is otherwise unchanged. One-shots (guns, hits, calls) never duck.

Bystanders, teammates' throwables and anything more than 10 m away sound exactly as X4 shipped them (tested). The
pin, bounce and blast voices were checked against the guns and left as they are:
- the X4 bounce squeak is −23.9 dB at 4 m, 4 dB under a local rifle;
- the concussion plus its faction layer sit between a mortar and the boom, as X4 designed.

### The Lot's ambience (`site-ambience.ts`, `presets-site.ts`)
The emitters come from the **world data** (no map-name check), in a table a new map opts into by using these types:

| Source in the data | Sound |
|---|---|
| `container_roof` props | rain on steel: sparse "dust" clicks ringing three panel modes, a hollow box drum, and a downpour patter layer. **Inside a container** the roof becomes a drum overhead (about +6.5 dB). |
| `skip` tops (the tarp caps) | rain on a tarp (a fabric "thup") and a wind flutter in storm gusts |
| `WorldData.floodlights` | the ballast's 100 Hz hum and a thin buzz; rain sizzles on the hot lens |
| lamps `laserRed` above 40 m (aviation lights mark tall steel: the crane) | stick-slip creaks and a low groan, more and louder with wind; a cable slap when strong |
| container eaves and `pipe` props | drips when wet (they keep dripping after the rain, following `wet`); inside a pipe they echo |
| water zones with a `tint` (the muddy ditch) | running water while wet, drops plopping in while it rains |
| any floodlight or crane present | a far generator/traffic bed (2D), and far site noise at 100 to 140 m: a dropped pipe, a reversing beeper, a chain, an air-line hiss |

It follows the same `WorldView.weather` sample the world renders:
- **dry:** the hum, the crane, far site noise, the bed;
- **rain:** steel pings, tarp patter, drips, the ditch running;
- **storm:** a roar on steel, flapping tarps, the crane groaning; the far site goes quiet.

The listener's position picks the nearest emitters. The loops are positional through equal-power panners.

**Budget:** every audible loop holds an `ambloop` voice (priority 0, `canSteal = false`). It never pushes a sound
out, and any gameplay sound can take it (it fades and retries). One-shots are category `amb` (cap 3), priority 0.
A loop's nodes exist only while it sounds: it is built on first need and torn down after 3 s of silence. In dry
weather only the hum and the bed run.

**Mix:** a sub-bus at −6 dB under full combat intensity (S2's engine loops use −4.4), with the danger duck on top.

`setQuality('low')` keeps one container and one floodlight loop.

**West Yard:** it has none of these features. Its water is untinted, it has no floodlight data, no container and no
crane, so nothing is built there. Its lone `tarp` prop is left out on purpose because the card froze its soundscape;
adding `'tarp'` to `SITE_PROPS.tarp` is one line for a later card.

## 2. Levels
Measured on the offline renderer the way X3 measured: the recipe × its play gain, loudest 100 ms RMS, no buses, no
master chain, 48 kHz. Chromium's `OfflineAudioContext` gives the same numbers within **0.5 dB on every row** (§6).
Tested in `audio-w10-levels.test.ts`.

| Sound | dB | Held to |
|---|---|---|
| ref: rifle, local (0.6) / boom (1) | −19.5 / −8.1 | X3 published −19.3 / −7.4 |
| ref: L5 score sting, ours / theirs (0.7) | −20.8 / −23.1 | |
| ref: chapter fanfare (0.85) | −17.6 | |
| AU2 calls k 0–5 (0.72 × `CALL_TRIM`) | −21.4 … −21.6 | within 3 dB of the score sting |
| AU2 capture fanfare (0.6) / lament (0.5) | −16.6 / −19.4 | fanfare within 2 dB of the chapter fanfare; lament under it |
| AU2 ball voices @ 6 m (1.1) | −24.4 … −29.3 | under a rifle; within 8 dB of X4's bounce squeak (−23.9 @ 4 m) |
| X4 fuse peep / wick crackle @ 4 m (0.7, as shipped) | −44.4 / −34.1 | |
| AU2 threatened: fuse alarm / crackle @ 4 m | −20.2 / −19.3 | ≥ 15 / 10 dB over X4's; never louder than a local rifle shot |
| drip @ 4 m (0.5) / in a pipe | −37.8 / −37.0 | ≥ 10 dB under a rifle |
| crane creak @ 115 m, storm / dry (0.35) | −38.7 / −45.0 | |
| far site noise k 0–3 @ 120 m (1) | −41.1 … −43.0 | |

**Ambience against the weather bed** (band levels, Lot, settled):
- **by a container in rain:** the steel's 0.7 to 3 kHz band is 8 dB under the rain bed (−40 vs −32), 6 dB louder
  inside (−33), and above the bed inside in a storm (−27 vs −30);
- **at a floodlight tower's foot, dry:** the hum is −43 dB in 60 to 140 Hz, against −73 for the dry weather bed;
- **the site bed:** −55 dBFS, about the level of the clear-weather wind.

## 3. Proof: the acceptance tests (all on a clean snapshot of HEAD b128cb5 + only these files)
The tests render the real audio stack offline in Node. `tests/unit/audio-w10-render.ts` is a small Web Audio renderer
following the spec formulas, cross-checked against Chromium (§6). `audio-w10-driver.ts` mounts `createAudio` + music,
the X4 director, the G1 weather and the site ambience on it. It drives a scene at 60 Hz the way main.ts does, with fake
timers on the audio clock, then renders.

| File | Tests | What it proves |
|---|---|---|
| `audio-w10-mix.test.ts` | 11 | **The busy moment on The Lot** (4 s): a storm, a 5-gun firefight with hits both ways and a mortar, a teammate carrying the enemy ball home and capturing (heartbeat, then fanfare), an enemy throwable 2.1 m from the local pet. Both factions (a corgi vs a hairball, a cat vs a squeaker). **No clipping:** every sample finite, output peak < 0.99 (model), mix into the limiter < 1.6. **The floor, stated:** every tick of the last 1.2 s is **≥ +3 dB over everything else in its best third-octave band, median ≥ +6 dB**. Measured by rendering the scene twice, with the tick voices muted in one (same limiter, duck and seed), so A − M is exactly the ticks. **As X4 shipped it** (the same throwable as a teammate's), the median was < −8 dB (measured −23). **Voice budget:** never over the cap, 0 fuse ticks stolen or refused, loops never steal. **Danger duck:** the rain bed dips > 8 dB while it ticks and is back within 1.5 dB after. **The capture fanfare** stands > 4 dB over the firefight in its best band. Plus the threat rules: enemy, own, teammate, far, no local character; the duck's hold and release. |
| `audio-w10-lot.test.ts` | 18 | **Emitters** found on The Lot, none on the West Yard. **siteMix** (pure) sampled over dry / rain / storm / clearing × 6 spots, including inside a container. **Rendered:** by a container the steel band rises > 25 dB dry → rain, > 3 dB rain → storm, > 4 dB inside, > 12 dB over the same rain in the open mud; at a tower the hum stands > 12 dB over the mud; the tarp and ditch bands rise > 15 dB with rain; creaks and far noise are positional `amb` priority-0 one-shots; loops hold `ambloop` voices and lose them to a gameplay burst; a loop is built by the rain and torn down after a dry spell; the low tier keeps one roof. **The West Yard:** the site ambience builds nothing; the whole ambience output (weather beds, a sprinkler burst, steady rain, a storm with three thunders, under the full AU2 stack) reproduces a fingerprint rendered from HEAD's pre-AU2 audio code to 1e-9 (a 0.1 % nudge to the rain bed fails it: checked); with and without the site ambience is sample-identical. |
| `audio-w10-ba.test.ts` | 14 | **Every event plays its cue**, for local team 0 and 1, ours then theirs: the exact recipe / variant / bus sequence, positional where it happens, never the old chime / sting / chapter fanfare; your own steal plays 2D; **other modes unchanged** (pickup chime, kill and core stings). **Distinct:** all 8 cues rendered, every pair's spectrum + envelope cosine < 0.97 (closest real pair 0.90; making "dropped" identical for mine/theirs fails 4 tests: checked). **Tension:** the pure model's cases; heart gating; pulse notes (root + fifth vs root + minor second); ducking; rendered, a teammate's run puts > 10 dB of heartbeat under the music at 35–70 Hz. |
| `audio-w10-recipes.test.ts` | 26 | Every new recipe at every variant, the site loops and the tension layer schedule cleanly on S2's strict fake. Every one-shot renders finite, audible, under full scale, and silent 0.15 s after its reported duration. The dust shaper clicks at the asked rate (±35 %). The new limiter categories exist. |
| `audio-w10-levels.test.ts` | 6 | The §2 table and its balance rules; the renderer reproduces X3's published and Chromium's own reference levels. `AU2_TABLE=1` prints it. |

**The full unit suite on the clean snapshot (HEAD b128cb5 + only these files): 123 files, 1045 passed, 4 skipped, exit 0.** Typecheck and boundaries pass.

## 4. Files (exact)
| Path | What |
|---|---|
| `src/client/audio/presets-objective.ts` | **New.** Base Assault voices (`ballGrab`, `ballBounce`, `ballHome`, `ballSqueal`, `baCall` k 0–5, `captureFanfare`, `captureLament`), `baCue`, `BA_GAIN`, `CALL_TRIM`, the pure `objectiveTension`, and `createObjectiveAudio` (the director inside `createAudio`). |
| `src/client/audio/music-tension.ts` | **New.** The heartbeat and pulse (`scheduleTension`, `heartAt`, `pulseGain`, `PULSE`). |
| `src/client/audio/presets-site.ts` | **New.** Site loops (`steelRain`, `tarpRain`, `floodHum`, `ditchWater`, `siteBed`), one-shots (`drip`, `craneCreak`, `siteDistant`), the dust shaper (`dustCurve`, `dustDrive`). |
| `src/client/audio/site-ambience.ts` | **New.** `siteEmitters` and `siteMix` (pure), `createSiteAmbience(audio, worldData)` (`update`, `setQuality`, `dispose`). |
| `src/client/audio/index.ts` | **Edited.** Creates the objective director. `update` sets `engine.focus` and feeds the tension to the music. The `pickup` / `score` cases hand Base Assault events to it first. `GameAudio.objective` added. |
| `src/client/audio/engine.ts` | **Edited (additive).** `focus`, `focusDistance()`, `raiseDanger()`, `danger`, `bedDuck()`, `DANGER`. |
| `src/client/audio/music.ts` | **Edited (small).** A `pulse` layer gain, `setTension()`, one scheduling line; the pulse ducks with the groove in `setIntensity`. |
| `src/client/audio/presets-ordnance.ts` | **Edited.** `fuseAlarm`, `FUSE_THREAT`, `fuseThreat`, the threat-aware tick; `createOrdnanceAudio` takes an `OrdnanceEngine`, and its focus / danger parts are optional, so X4's stub test still passes. |
| `src/client/audio/weather.ts` | **Edited (one multiplier).** The beds × `engine.bedDuck()` (a faster time constant only while ducked). |
| `src/client/audio/voice-limiter.ts` | **Edited.** Caps `fuse: 4, amb: 3, ambloop: 6`. |
| `tests/unit/audio-w10-render.ts` | **New.** The offline Web Audio renderer and its measurements. |
| `tests/unit/audio-w10-scenes.ts` | **New.** Scene builders (pure; also imported by the Chromium cross-check). |
| `tests/unit/audio-w10-driver.ts` | **New.** The Node driver (vitest fake timers). |
| `tests/unit/audio-w10-{mix,lot,ba,recipes,levels}.test.ts` | **New.** 75 tests (§3). |
| `docs/handoff/AU2.md`, `LEARNINGS.jsonl` (2 lines appended) | This file; the lessons. |

## 5. `src/client/main.ts` snippet (lead)
Tested on a scratch copy of HEAD's `main.ts`: typecheck, boundaries, `vite build`, and a runtime smoke in Chromium
with audio unlocked. The smoke covered The Lot Base Assault and West Yard TDM for 40 s each: 0 page errors, and site
loops were built on The Lot and none on the West Yard.
```ts
// imports, after `import { createWeatherAudio } from './audio/weather';`
import { createSiteAmbience } from './audio/site-ambience'; // W10 AU2

// after `const weatherAudio = createWeatherAudio(audio.engine, worldData);`
// W10 AU2: the site's ambience from the world data (The Lot: rain on steel and tarps, drips, the crane, floodlight hum,
// the ditch, far site noise; the West Yard has none of these features: nothing is built there)
const siteAudio = createSiteAmbience(audio, worldData);

// in applySettings, after `audio.setQuality(st.quality);`
siteAudio.setQuality(st.quality); // W10 AU2: 'low' keeps one container and one floodlight loop

// replace `const assaultHud = createBaseAssaultHud(ui, { audio }); // G4a (idle in other modes)` with
const assaultHud = createBaseAssaultHud(ui, {}); // G4a (idle in other modes); W10 AU2: its sounds now play in the audio module

// in the frame loop, after `weatherAudio.update(worldView.weather, worldView.tick, ctx.camera, dt);`
siteAudio.update(worldView.weather, ctx.camera, dt); // W10 AU2
```
If the world data is rebuilt for another map, dispose the old site ambience and create a new one with it (like the
weather audio).

## 6. The renderer, cross-checked in Chromium
The same scene modules ran in Chromium 1194's real `OfflineAudioContext` (Playwright; frames driven by
`suspend()` / `resume()`, fake timers in the page) and were compared with the Node renderer.

| Measure | Chromium | Node |
|---|---|---|
| Fuse SMR, corgi vs hairball (min / median) | +4.0 / +13.2 | +5.0 / +13.3 |
| Fuse SMR, cat vs squeaker | +7.1 / +9.1 | +6.3 / +8.8 |
| Fuse SMR, as X4 shipped | −30.1 / −22.8 | −30.0 / −23.7 |
| Voice steals in the busy moment | 71 / 72 | 71 / 72 (identical) |
| **Output peak through the real master chain** | **0.90–0.91** | 0.87 (model) |
| Capture fanfare, best band | +9.5 dB | +6.9 dB |
| Level table (§2) | | within 0.5 dB on every row |
| Masker, 0.8–8 kHz | | within ±1 dB |

Getting there found and fixed four renderer faults:
- graph changes must be time-stamped: the engine's cleanup disconnects happen during scheduling;
- oscillator automation is read once per 128-frame block, as Chromium does;
- built-in waves must use the spec's phase: a saw and a square at one pitch **add**; with the wrong phase the bugle
  rendered 7.6 dB quiet;
- square and saw use Chromium's peak normalisation (× 0.848).

Known residuals: the steel-rain loop renders ~2 dB louder in Node than in Chromium, and the 250–630 Hz band of the
firefight 1–3 dB quieter. No assertion sits within those margins. The master compressor is a model: the no-clipping
claim rests on Chromium's 0.90–0.91.

## 7. Watch / open
- **Ambience cost** (Chromium offline, 48 kHz, audio-thread ms per second of audio; measured while the machine's load
  was ~20, so the absolute numbers are inflated):
  - engine only 2.6;
  - storm weather 19;
  - storm weather + site at the worst spot (two roofs and the ditch) 75–88;
  - dry weather + site 23–31.

  Each built loop voice costs 7–9 on its own. Worth a real-machine check (Q5); `low` drops the second roof and the
  second floodlight.
- Inside a container the global rain bed (`weather.ts`) is not muffled. The roof drum dominates there, but a
  "sheltered" hook in `weather.ts` would be the next step (the West Yard's golden test guards that file).
- The tension layer rides the music bus: music volume 0 silences the heartbeat. That is by L5's design for music;
  flag it if playtests want it on sfx.
- The ball's positional squeaks use the snapshot's (interpolated) positions, about 0.1 s behind the event: inaudible
  at these distances.
- Humans certify fun: the bugle calls, the heartbeat and the site's texture were judged by numbers here, not by ear.
