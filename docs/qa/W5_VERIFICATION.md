# W5 Verification — Q3 independent verifier

**Verdict: Wave 5 is done, with one P1 to fix before the human playtest.** Bots now drive and fly in every PvP
mode, and climb to the roof perches in TDM and skirmish. The headline claims reproduce on seeds the lanes never used,
through the shipping brain and the real Room. D1's determinism fix holds for rooms run one after another and for rooms ticked interleaved, as the server runs
them. The lead's Q2 fixes hold, with one exception: Q2's P1-1 is only half fixed.

- **Gate:** all pass on a clean `git archive 3b3bfb3`:
  - typecheck, boundaries and 583 unit tests (1 skipped);
  - the build and the `verify --e2e` specs (4/4);
  - the five-mode soak (0 errors, stuck ≤ 1.5 s, p95 ≤ 1.48 ms).
- **N1 (climb):** an Overwatch bot told to hold a roof perch gets there from its base in **20.2–24.9 s** (6 new seeds,
  every perch, both teams; the limit is 60 s). It falls back to the ground after missed hops or when shot on a link,
  and is never stuck more than 2 s. In live TDM the marksman holds a perch for up to 94 s of a match.
- **B2a (karts):**
  - bots ride a kart in **every match** (16/16 short matches, 8/8 shipping matches, core-rush and skirmish too);
  - no kart is stuck for more than 0.5 s;
  - a kart beats walking over 60 m on **5/5** new seeds;
  - ch3's getaway is driven by a pup on **6/6** new seeds, with no waiver.
  - **Ram kills stay rare** (0 in 16 short matches, 3 in 8 shipping matches): B2 declared this, and it is below the
    card's "score ram kills".
- **B2b (plane):**
  - bots fly in **every shipping match** (2–4 sorties each);
  - **40/40** scripted take-offs and 51 real sorties have 0 take-off crashes and nothing near the house;
  - ch6 completes bot-only on **6/6** new seeds (195.8–223.2 s, par 360). Glide, plane and flyover are each met for
    real (airborne, seated), with `vehicle`/`airborne` strict.
- **D1:** **11/11** pairs SAME:
  - 6 new sequential pairs (histories with a broken wall, flown planes, other seeds);
  - D1's minimal pair (hash `3bb7cade`, as D1 reported);
  - 4 interleaved pairs, a case D1's tool does not cover.
- **Memory:**
  - authority heap over 30 simulated minutes (7 and 33 match restarts): a plateau at 0.01–0.03 MB/min;
  - client: Mesh, WebGLBuffer and heap counts flat after minute 4 in a 10-minute headless TDM.
- **Online:** co-op with two clients against the Brotli production server passes 8/8 checks.

**P1-1, the one real defect.** P1-1 moved one step later.
- **Before:** the Breacher pups blew the ch3 wall during step 1.
- **Now:** they plant **0.02–0.5 s after step 2 ("Blow the wall … (Q)") goes live**. The wall falls to a pup 2.5–3.0 s
  in.
- **Even a player who plants:** one who presses Q 1.0 s after arriving loses the moment on **3 of 4 seeds**.
- **Why nobody saw it:** the lead's regression test only asks that the wall stand through step 1.

**No P0.** What is left is P2:
- an online adventure room keeps listing the chapter it was created with. Joiners then take the wrong featured kit.
- a match restart pulls a bot pilot out of the air, and the empty plane flies on and crashes into the new match. Bots
  also board the plane during the post-match hold.
- rams rarely kill;
- hurt bots board a kart to ram and hop straight out;
- the budgets hold but the margins are thin again:
  - live high-tier TDM peaks at **1.43 M triangles** and 305 draws;
  - the 28-character tick p95 with vehicles is **2.58 ms** (3 ms).

Scorecard **78 / 100 (R 84 · I 73 · F 75), gate PASS.** What needs a real GPU or a human (60 fps, feel, the queue
test, whether rare ram kills and weak strafing are fun) remains open.

| | |
|---|---|
| Verified SHA | **`3b3bfb3`** ("Client: drop the ability views' ink-line registry (JS leak)"), branch `claude/practical-johnson-uh8g33`. This covers everything since Q2's `a5177fd`: `ad28d0f` (P1-1), `d99ff78` (N1), the P2 fixes, `89e579a` (holdResult), `e452b19` (B2/INT5), `4f26fe8` and `3b3bfb3` (client leaks), `4920694` (D1). The lead committed `c9b8a19` (Wave 6 plan, docs only) while I worked; it is not verified here. |
| Method | A clean `git archive 3b3bfb3` snapshot in the scratchpad (`…/scratchpad/q3`) with `node_modules` linked. Every run, build and server used the snapshot, and no product file was changed. My additions are read-only `tools/qa3-*.mjs` probes (listed below) and copies of Q2's tools with new ports and output dirs. Headless Chromium 1194 with SwiftShader (WebGL2) ran at **0–1 fps**: I judged looks from screenshots I opened, and cost by draws and triangles. |
| Box | 4 shared cores. Load was **4–24** throughout: other agents ran vitest and Chromium alongside me. Every timing below gives its load and is best-of-N where it matters. |
| Servers | `vite preview` of the snapshot build on **:5390** (offline worker authority); Vite dev on **:5391** (module-level card and object-count probes); `PORT=8793 STATIC_DIR=dist node dist-server/prod.js` (online). Port 4173 was checked free before the e2e run. |
| My outputs | New probes, none committed (the lead decides):<br>• `qa3-wave5.mjs` (perch, fallback, tdm, kartwalk, ch3, ch6, takeoff, humanvehicle);<br>• `qa3-interleave.mjs`, `qa3-lead.mjs` (holdresult, steal2, listing), `qa3-heap.mjs`, `qa3-budget.mjs`, `qa3-trace.mjs` (in-process);<br>• `qa3-render.mjs`, `qa3-leak.mjs`, `qa3-card.mjs`, `qa3-play.mjs`, `qa3-online.mjs`, `qa3-rooms-view.mjs` (browser).<br>Screenshots and JSON are in the snapshot's `artifacts/q3/`, and raw output in `artifacts/q3/logs/`. |

---

## 1. Gate

| Check | Command | Result | Verdict |
|---|---|---|---|
| Typecheck, boundaries | `npx tsc --noEmit`, `node tools/check-boundaries.mjs` (snapshot) | clean · `BOUNDARIES: PASS` | **PASS** |
| Unit | `npx vitest run` (load 4.7 → 20.7) | `Test Files 72 passed (72)` · `Tests 583 passed \| 1 skipped (584)` · 452 s. Includes N1's 12, B2's 18 and D1's 2. | **PASS** |
| Build + precompress | `vite build`, `server/precompress.ts dist`, `vite build --ssr server/prod.ts` | builds clean; `[precompress] 4 files, 11.11 MB → br 3.02 MB · gz 4.06 MB` | **PASS** |
| E2E (what `verify --e2e` runs) | port 4173 checked free; `npx playwright test tests/e2e/smoke.spec.ts tests/e2e/modes.spec.ts` in a second clean archive of `3b3bfb3` (load 11–12) | **4 passed (40.9 s)**: boots and renders without errors · W moves the player · CORE RUSH from the menu (three pads) · ADVENTURE → The Tall Grass from the menu | **PASS** |
| Soak, all five modes | `npx tsx tools/soak.mjs --modes yard-skirmish,team-deathmatch,core-rush,boss-rush,adventure --repeat 3` (load 7.7 → 12.4) | `SOAK PASS \| score 92 \| modes 5 · errors 0 · stuck max 1.5s · tick p95 1.48 ms · completed 4/5`, deterministic across repeats. Per mode, best of 3: skirmish p95 1.30, TDM 1.40, core-rush 1.48, boss-rush 1.44, adventure 0.88 ms. Adventure completes ch1 at 42 s **after three PvP rooms in the same process** (D1). Boss-rush is open-ended. Single-run p95 went up to 6.3 ms under load. | **PASS** |

## 2. Wave 5 against WAVE5_PLAN acceptance

All rows use the shipping default systems with the B2 brain hook as committed. "New seeds" means seeds none of N1, B2
or D1 report.

### 2.1 N1 — bots climb (`tools/qa3-wave5.mjs perch|fallback`)

| Acceptance | Result | Verdict |
|---|---|---|
| An Overwatch bot told to hold a roof perch reaches it from its base in < 60 s on 4 seeds | Seeds 11–16, every perch × both teams:<br>• corgi → parapet 21.4 s;<br>• cat → nest 24.3;<br>• corgi → gutter 22.2;<br>• cat → parapet 24.9;<br>• corgi → nest 20.2;<br>• cat → gutter 24.8.<br>Each run used the west climb or the east climb (+ stone to the nest), with stuck max 0 s. | **PASS** (6/6) |
| Missed the hop twice → falls back to the ground (no bot stuck > 5 s) | Jump stripped, 3 new starts and perches (seeds 21–23): links tried `west, west, east, east` (or east first from the east side). 4 misses, 2 fallbacks, perch paused at 19.2–20.4 s, bot on the ground, stuck max 1.5–2 s. | **PASS** |
| Contested link → falls back | Shot on leg 1 (seeds 21, 23) or leg 3 (seed 22), a different leg from N1's test: contested 1, back on the ground in 0.5–0.7 s, the other route, perch reached at 17.9–19.0 s, stuck 0 | **PASS** |
| In a real match | TDM, room fill, shipping config, seeds 41–44: an Overwatch bot within 2.5 m of a perch on the roof for 0–94.5 s per match (median ~30 s). Both teams perch. | works |
| Probe artifact (not a product issue) | My first no-jump start, (100, −30), is on the east fence line (`HALF = 100`). The bot is wedged there even with Jump allowed, so I replaced the start with (90, −20). | note |
| Sim tick p95 at 28 characters ≤ 3 ms | §5 (with vehicles) | see §5 |
| ai/world/destruct tests green | in the 583 | **PASS** |

### 2.2 B2a — bots drive karts (`qa3-wave5.mjs tdm|kartwalk|ch3`)

| Acceptance | Result | Verdict |
|---|---|---|
| 4v4 TDM: bots drive karts at least once per match | **B2's lineup, soak config** (45 s matches, 4 × 180 s, seeds 31–34): kart rides per match are 1–3 in **16/16** (12 full, plus the partial 4th), both teams in 11/12 full matches.<br>**Shipping** (room fill 4 v 4, 30 kills / 8 min, 4 × 360 s, seeds 41–44): **4–13 rides per match**, both teams in 8/8.<br>Core-rush 51–52: 5–10 per match. Skirmish 61–62: 8–11. | **PASS** |
| … and score ram kills | **Ram hits** per 45 s match 0–3 (≥ 1 in 5/12 full matches, 7/16 counting the four partial ones); per shipping match 0–2 (≥ 1 in 4/8).<br>**Ram kills: 0 in 16 soak-config matches, 3 in 8 shipping matches** (seeds 41: 1, 42: 2, 43: 0, 44: 0), 1 in 2 skirmish runs. B2 measured 3 · 0 · 0 · 0. | **PARTIAL** (known; P2-3) |
| No kart stuck > 5 s | kart stuck max **0.5 s** in every run (TDM, core-rush, skirmish) | **PASS** |
| A bot kart beats walking 60 m in 4/5 seeds | Seeds 6–10, shipping brain (walk / kart, s): 5.97/5.35 · 6.18/5.53 · 6.23/5.57 · 6.73/5.15 · 5.98/5.88. The kart wins **5/5**, by 0.1–1.6 s. The bot boarded every time. | **PASS** |
| Ch3 getaway driven by a bot-only squad, no waiver | Seeds 4–9: **6/6** gold, 40.1–67.1 s (par 120). At the escape step's score event the only squad member in the zone is a pup **in the kart** (breacher, overwatch or assault), 12.7–23.6 s after the step began. | **PASS** |
| With a human, no pup takes a vehicle step | Ch3 and ch6 with an idle human (`humanvehicle`, seeds 1–2): pups seated in a vehicle **0 ticks** over 200 s | **PASS** |

### 2.3 B2b — bots fly the RC plane (`qa3-wave5.mjs tdm|takeoff|ch6`)

| Acceptance | Result | Verdict |
|---|---|---|
| In TDM a bot flies the plane at least once per match on 3/4 seeds | **Shipping:** every match, 2–4 sorties (8/8 matches, 4/4 seeds); core-rush 1–2 per match; skirmish 4–6 per 300 s. **Soak config (45 s):** every full match on 2/4 seeds (31: 1·1·0, 34: 1·0·1). The hangar serves one plane at a time, and a lost plane puts it on cooldown. | **PASS** (in shipping matches) |
| No take-off crash into the house (5 runs) | **40/40** runs (5 seeds × 8 targets round the yard, incl. across the house at (−44, −86), (−78, −88), (−8, −90); pilot spot varied per seed; Skyraider and Overwatch): vended 40, boarded 40 (1.0–2.3 s), **0 destroyed, 0 hull loss**, top 15.8–18.8 m.<br>**Real sorties** (51 bot boardings: 41 in shipping TDM/core-rush/skirmish, 10 in soak-config TDM): 0 lost on take-off. Every plane lost was shot down, emptied by a pilot bail/death (sniped pilot: 90 → 5 hp), or abandoned. The one exception is P2-2. | **PASS** |
| Ch6 completes bot-only without the vehicle/airborne waivers | Seeds 2–7: **6/6** gold, **195.8–223.2 s** (par 360). At each step's score event:<br>• glide 33.1–33.7 s, Skyraider pup **airborne** y 5.2;<br>• plane 42.8–43.5 s, a pup **in-plane** y 7.6;<br>• flyover 52.0–52.7 s, **in-plane** y 13.4.<br>The runner holds `strictMoves` for bot squads (`runner.ts:385`). | **PASS** |
| Strafing and gun | Shipping TDM: 5–31 rounds and 0–7 hits on pets per match. Weak, as B2 said. | note |

### 2.4 INT5

| Acceptance | Result | Verdict |
|---|---|---|
| verify --e2e green on every integration commit | Only `3b3bfb3` re-verified: unit, build, e2e 4/4 (§1). `e452b19`, `4f26fe8`, `4920694` not re-run. | PASS for `3b3bfb3` |
| Soak PASS in all five modes | §1: SOAK PASS, 5 modes, best of 3 | **PASS** |

## 3. D1 — rooms in one process don't affect each other

`tools/qa-determinism.mjs` (D1's tool) runs the target alone in one fresh process and after the "pre" rooms in
another. `tools/qa3-interleave.mjs` (mine) runs two rooms **ticked alternately** in one process, the second created
mid-way, and compares each to its own run alone. That is how `server/rooms.ts` runs rooms, and D1's matrix does not
cover it.

| Pair (history → target) | What the history exercises | Result |
|---|---|---|
| `adventure:garage_job:90` → `adventure:laser_dawn:90` | wall breached, tuna broken, getaway kart driven | SAME (hash `a383a2d1`, steps identical) |
| `adventure:last_ball:120` → `tdm:45` | plane vended and flown from the hangar, glide | SAME (`42a01ef8`, 7 deaths) |
| `core-rush:45, yard-skirmish:45` (pre seed 9) → `adventure:porch_siege:90` | two PvP histories, other seed | SAME (`da5e7276`) |
| `tdm:45` (pre seed 5) → `core-rush:45` | different seed | SAME (`329824c6`) |
| `adventure:garage_job:90` (seed 3) → same chapter seed 1 | same chapter, other seed | SAME (`5123126b`) |
| `tdm:45, adventure:last_ball:60` → `boss-rush:60` (seed 4) | two histories | SAME (`e7e6ef2a`) |
| default (`tdm:2t` → `last_ball:60`) | D1's minimal pair | SAME, hash **`3bb7cade`** = D1's "fixed" hash |
| interleaved: `tdm:45` ‖ `last_ball:60` (seed 2), together from tick 0 | concurrent rooms | SAME / SAME |
| interleaved: `garage_job:90` ‖ `tdm:45` (seed 2) created at tick 1800 | late room creation after a breach | SAME / SAME |
| interleaved: `core-rush:45` ‖ `laser_dawn:90` (seed 5) created at tick 300 | | SAME / SAME |
| interleaved: `boss-rush:60` ‖ `yard-skirmish:45` (seeds 3) created at tick 60 | | SAME / SAME |

**11/11 SAME. PASS.** Load 4–20 (determinism doesn't depend on it).

## 4. Q2's findings and the lead's later changes, re-checked with Q2's own repros

| Finding (PROGRESS says fixed) | Repro | Result | Verdict |
|---|---|---|---|
| **P1-1** pups blow the ch3 wall before the human's step | `qa-adventure.mjs steal --seeds 1,2,3,7` (Q2's) | Wall **not** broken during step 1 (0 pup charges in 60 s, 4/4). But after the human reaches the wall, step 2 completes **2.52–3.78 s** later with no human charge. Details: `qa3-lead.mjs steal2`, P1-1 below. | **HALF FIXED** (P1-1) |
| **P2-2** checkpoint restart at the Porch Siege's last wave re-wipes | `qa-adventure.mjs wipe --chapters porch_siege --at 3 --seeds 1,2,3,4,5,9,10,11` | **0/8 re-wipe** (Q2: 5/8). All complete gold, 78.1–80.6 s, beat 3.02 s, restart at step 3 with 4 alive. Natural runs, same seeds: 2/8 had one natural wipe (then gold, 86.6 / 88.0 s); PROGRESS already notes this. | **PASS** |
| **P2-3** room chapter labels, unknown ids | `qa3-rooms-view.mjs` + `/rooms` on the prod server | Rows read **"Adventure / Laser Pointer at Dawn"**, **"Adventure / The Last Tennis Ball"** (full titles, own line). `chapter=buy_gold_at_example` → listed **Yard Day** (what runs). `qa-w4abuse.mjs`: `../../etc` and a 200-char id → `yard_day`. Q2's tool marks these 2 FAIL because it expected no chapter; `yard_day` is what the room runs, so that is its stale expectation. `boss=not_a_boss` → plain boss-rush. `rooms-browser.png`<br>**But:** after an online room moves on, the listing still shows its first chapter (P2-1). | **PASS** (new P2-1) |
| **P2-4** HUD overlaps | `qa3-play.mjs modes`, `geometry`, `tipcue` | The Tab scoreboard sits over the mission card (`mode-yard-skirmish-tab.png`, `mode-team-deathmatch-tab.png`) and over the adventure panel (`mode-adventure-tab.png`). The tip bar still occupies SPOTTED's and DOT ON YOU's rectangles (`geometry`), but it is hidden while a cue is up (next row: 0 overlaps). | **PASS** |
| **P2-5** triangles in a live high-tier TDM | `qa3-render.mjs --tier high` (90 frames, all passes) | p50 **1.40 M**, p95 1.42 M, max **1.43 M** (shadow 0.27–0.31 M of it); draws p50 279, max 305. The lead measured 1.38 M / 254 before B2 put karts and planes in play. A vehicle was within 60 m in 52/90 frames. | **PASS**, at the edge (P2-5) |
| **P2-6** finale card dead end; online replays ch6 | `qa3-card.mjs` (real module), `qa3-lead.mjs holdresult` | Offline ch6: **THE END!**, "Every chapter done…", REPLAY + **MAIN MENU ▸**, `[ENTER] main menu · [BACKSPACE] replay`. Enter → `onMenu`, Backspace → `onReplay(last_ball)`. Ch5: NEXT CHAPTER enabled, Enter → `onNext(last_ball)`. Online ch6: "Back to chapter 1 in 17s". **In-process, online:** `last_ball:complete` → 30.0 s → `yard_day:briefing`. `card-finale-offline.png` | **PASS** |
| **P2-7** labels | screenshots + `geometry` | Objective "(1/5) Report to the Ordnance Kiosk" (counter first); scoreboard header "YARD SKIRMISH · WAVE 1" and "ADVENTURE · STEP 1" (no 0:00). Menu cards end at y 664, footer at 694 (**−30 px**, was +4) at 1280×720; 1024×600 and 800×450 also clear. The adventure room browser says **‹ CHAPTERS** and "Joining as SKYRAIDER · CORGIS" with ch6 picked (`menu-rooms-offline.png`). **Plane on the roof pad:** the strip reads **"0 M UP"** with ON THE GROUND (was "7 M UP"). `plane-seated.png` | **PASS** |
| **P2-8** soak adventure stuck on step 1; bandwidth raw JSON | `soak.mjs … --heap` | adventure completes **5 chapters in 600 s** bot-only ("112:4 Corgis @42s, 93:5 @165s …"); the snap line reads "10.34 KB/s wire (99.59 raw JSON)" | **PASS** |
| **P2-9** blank frame at a resize | `qa3-play.mjs black` (porch_siege, 60 shots after the briefing skip) + 18 chapter shots + 8 mode shots | **0 blank of 60**. They span **4 adaptive canvas resizes** (1088 → 960 → 832 → 704 → 640 px wide, at frames 31/62/93/124). None of the 26 other shots is blank (lum 90–209). `quality.update()` now runs before `ctx.render()` (`main.ts:332–333`). | **PASS** |
| Lead: offline result waits (`holdResult`) | `qa3-lead.mjs holdresult --seed 3` | Offline (holdResult, as `worker-host.ts` sets it): `yard_day:complete` and `last_ball:complete` **unchanged for 60 s**. Online: `yard_day` → `tall_grass:briefing` at +30.0 s; `last_ball` → `yard_day:briefing` at +30.0 s. | **PASS** |
| Lead: tips pause under cues | `qa3-play.mjs tipcue`: boss-rush with Madame Pointillé, tips reset (a first match), the DOM sampled at ~8 Hz for 200 s | 1 681 samples: a tip showed in 439 (basics, then the slide/pound tip), DOT ON YOU in 43, **both at once in 0**. `tipcue-boss-tip.png`, `tipcue-boss-cue.png` | **PASS** |
| Lead: client memory, 0 retained meshes | `qa3-leak.mjs` (see §5) | Live `Mesh` and `WebGLBuffer` counts flat from minute 4 to 11 (300–310 meshes, 924–947 buffers) over 10 min of TDM, where the old leak added ~188 buffers per 5 min | **PASS** (at ~1 fps; §11) |

## 5. Budgets (§8.7)

| Budget | Command | Measured | Verdict |
|---|---|---|---|
| Sim tick, 28 characters, vehicles in play ≤ 3 ms | `qa3-budget.mjs --seconds 90 --repeat 5`: Q2's W4 budget room (12 human slots via `Room.handle` + 16 room bots, 2 humans flying autopilot planes, 8 destructibles) with bot vehicle counters. Load 6.3 → 8.1. | 76 entities. Run 0: 4 bot kart rides, 7 165 seated character-ticks, up to 2 karts and 3 planes alive. **Best-of-5 min(wall,cpu): p50 1.78 · p95 2.58 · p99 3.15 · max 4.38 ms**. Single runs p95 3.22–3.30 (11.1 for the first, JIT + load). At load 24 the best of 3 was p95 3.24. Q2 at W4: 2.04. | **PASS** (0.4 ms margin; P2-5) |
| … 28 room bots only (B2's case) | `qa-budget.mjs --humans 0 --bots 28 --seconds 60 --repeat 5` (load 8.4) | best-of-5 p50 1.32 · **p95 1.86** · max 3.22 ms (B2: 2.33) | PASS |
| Snapshot bandwidth ≤ 40 KB/s at 12 players (wire size) | `qa3-budget.mjs` (per-client `SnapEncoder` delta wire, incl. roster and events) | **34.22 KB/s** per client with 28 characters, planes and bot karts (Q2 W4: 32.5). Soak net-bot at 8 characters: 8.6–11.9 KB/s wire vs 93–107 KB/s raw JSON | **PASS** |
| Visible triangles ≤ 1.5 M, draws ≤ 400 (live high TDM) | `qa3-render.mjs --tier high --frames 90` (1280×720, all passes, load ~9) | tris p50 1.401 M · p95 1.420 M · **max 1.428 M**; scene pass only: p50 1.13 M, max 1.17 M; draws p50 279 · p95 292 · **max 305**. `render-tdm-high-*.png` | **PASS** (5 % headroom) |
| Low tier, every mode (1280×720) | `qa3-play.mjs modes` | skirmish 182 draws / 0.81 M · TDM 228 / 0.87 M · core-rush 234 / 0.86 M · adventure 106 / 0.59 M; chapters 60–135 draws, 0.38–0.76 M | PASS |
| Initial download ≤ 5 MB gz | `precompress` sizes | Offline: html 0.9 KB + index 518 KB + prediction 1 746 KB + worker 1 795 KB = **4.06 MB gz** (3.02 MB br) + 28 KB fonts. Online (no worker): **2.29 MB gz** | **PASS** |
| Memory, authority, 10+ min | `soak.mjs --seconds 600 --repeat 1 --heap` (load 19) and `qa3-heap.mjs --minutes 30` | Soak, 10 min: TDM +0.21, adventure +0.13, core-rush +0.08 MB/min after minute 1.<br>**30 min** (TDM, 7 restarts): 26.0 → 32.8 MB, slope after minute 10 **0.019**, last half **0.011** MB/min.<br>Soak config (33 restarts): 0.031 / 0.024.<br>The 10-minute slope is mostly warm-up: a plateau from minute ~8. | **PASS** |
| Memory, client, 10 min | `qa3-leak.mjs --minutes 10 --every 60` (Vite dev build, TDM, low tier; forced GC, then CDP `queryObjects` on the app's own three module) | 11 samples over 667 s, 582 frames (0.9 fps):<br>• `Mesh` 272 → 296 → 304 → 310, then **300–310 from minute 4 to 11**;<br>• `WebGLBuffer` 858 → 939, then **924–947**;<br>• `BufferGeometry` 1 669 flat from minute 3; Material 144 and Texture 42 flat;<br>• JS heap 149 → **144 MB (−0.18 MB/min)**.<br>DOM +130 nodes once near minute 5, then flat; entities 49–51. The early rise is views warming up; there is no linear growth. | **PASS** |

## 6. Online (production server) — `qa3-online.mjs` against `PORT=8793 … dist-server/prod.js`

| Check | Result | Verdict |
|---|---|---|
| Two clients, `?room=q3&mode=adventure&chapter=yard_day` | Both on `ws`, both show **CH 1 · YARD DAY** and STEP 1, each sees the other (13, 44) | PASS |
| `/rooms` | `{"name":"q3","mode":"adventure","players":4,"humans":2,"bots":2,…,"phase":"live","chapter":"yard_day"}` | PASS |
| Replication | B saw A move **6.88 m** after A held W | PASS |
| Brotli | index + prediction with `br`, no worker chunk online | PASS |
| Errors | 0 page errors (A logged 2 SwiftShader GL driver warnings) | PASS |
| Load | A ready in 7 s, B in 45 s (load 5–9); no idle-timeout this time | note |

## 7. Hostile setups and messages (prod server)

| Check | Command | Result | Verdict |
|---|---|---|---|
| Q1 network abuse (A) + input-rate exploit (C) | `qa-abuse.mjs --url ws://127.0.0.1:8793/ws --parts A,C` | 10/11:<br>• malformed → 1008 after 22 frames;<br>• 40 KB → 1009;<br>• binary → 1008;<br>• ping flood → 1008 in 173 ms;<br>• hostile name sanitized ("img srcx onerror");<br>• mx/mz 50 clamped (3.61 m/s);<br>• Infinity seq survives;<br>• **input-rate exploit +0 %**.<br>The FAIL is the tool's 12 s wait again; `qa-w4abuse` sees 4001 at 10.9 s. | PASS |
| Room setups | `qa-w4abuse.mjs` | `mode=<script>` → yard-skirmish; path-like/200-char/unknown chapter → yard_day (what runs); `boss=../x` dropped; chapter/boss ignored outside their modes; the first joiner decides, hello extras ignored, humans forced to corgis; `/rooms` 19 × 200, 41 × 429; no hello → 4001 at 10.9 s; server healthy at the end | PASS |
| Per-IP room cap | `qa3-rooms-view.mjs` (5 holders from one IP) | 4th and 5th closed `1013 too many rooms from your address` (cap 3) | PASS |
| Malformed URLs, offline client | `qa3-play.mjs abuse` (8 URLs) | **0 page errors** (only SwiftShader driver warnings):<br>• `mode=<script>` → free roam, the text renders as text;<br>• `../../etc`, unknown and 200-char chapters → Yard Day STEP 1;<br>• bad or unknown boss → the Vac-Tank. | PASS |

## 8. Fresh eyes

| Area | Evidence | Result |
|---|---|---|
| Every mode from the menu | `qa3-play.mjs modes`, `mode-*.png` | Skirmish (WAVE 1, Squeaker mission), TDM (7:02, first to 30), core-rush (A/B/C pads), adventure (STEP 1, Yard Day). **0 page errors**, only SwiftShader driver warnings. Looked at all 8 shots. |
| Every chapter start | `qa3-play.mjs chapters`, `ch-*-{intro,live,later}.png` | All 6 boot with the intro panel, then STEP 1 and the right objective with its (n/N). 0 page errors; 18 shots, none blank (lum 90–152). Ch3 shows the pups at the standing wall; ch6 starts on the roof with the glide objective. |
| Vehicles in play: silly behaviour | `qa3-wave5.mjs tdm` (TDM, core-rush, skirmish; 14 runs) | Empty karts parked within 3 m of a kiosk: **0 s** in every run. Ride thrash ≤ 2 boardings per bot per minute. Median ride 67–103 m. **Under-5 m rides:** 0–2 of 12–15 per TDM run, **6 of 15** in core-rush seed 52. They are hurt bots boarding to ram, then hopping straight out with `out = 'hurt'` (P2-4). |
| Plane losses | same | 0 take-off crashes, 0 near the house. **Restarts:** the soak config's restart at t = 106 s left the planes of 3 of 4 seeds pilotless, abandoned grounded until they despawned at 151.1 s. One bot boarded **during the ended hold** (seed 33, 156.9 s); the restart at 159 s respawned it, and the empty plane crashed at (56.8, 5.7, −37.4) at 162.2 s, 0.2 s into the new match (P2-2). |
| Bots on the roof | TDM perch time | Marksmen hold perches for tens of seconds per match; no bot stuck > 3 s in any soak. |
| HUD with vehicles | `qa3-play.mjs plane` (ch6, tips reset: walk to the Rooftop Hangar, E vend, E board, hold W). The first attempt walked straight back through the roof hatch at ~1 fps and dropped into the garage (a harness path, not a product bug); the retry strafes east of the hatch first. | Seated on the pad: the FETCH FLYER strip ("0 m/s · 0 M UP", BOOST READY, GUN, ON THE GROUND), an "E hop out" prompt, **no tip**. The strip sits between the ability ring and the weapon panel without touching either. Holding W with no mouse flies straight off the roof into a tree: R1's crash, pilot ejected at 100/100 (keyboard-only flight, not a finding). `plane-seated.png`, `plane-flying.png` |
| Menus, room browser | `menu-*.png`, `rooms-browser.png` | Locks, medals, featured-kit line, "‹ CHAPTERS", full chapter titles; nothing clipped at 800×450. |

---

## 9. Findings

### P0 — none

### P1 — fun / fairness breaker

**P1-1. Q2's P1-1 is half fixed. In chapter 3 the Breacher pups still blow the Garage wall, now in the first
0.5 s of the human's own "Blow the wall … (Q)" step.**
- **Repro:**
  - `npx tsx tools/qa3-lead.mjs steal2 --seeds 1,2,3,7`: ch3 with a human Breacher who idles 30 s, is placed 1.5 m
    from the boards (step 2 goes live), then either idles or presses Q 1.0 s into step 2.
  - Q2's `qa-adventure.mjs steal` shows the same.
- **Evidence** (`artifacts/q3/logs/steal2.log`):

  | Seed | Pup charges after step 2 goes live | Wall broken | Broken by (human idles / human plants at 1.0 s) |
  |---|---|---|---|
  | 1 | 0.22 s Pup 2, 0.47 s Pup 1 | 2.72 s | Pup 2 breacher / **Pup 2 breacher** |
  | 2 | 0.50 s Pup 2, 0.85 s Pup 1 | 3.00 s | Pup 2 breacher / **Pup 2 breacher** |
  | 3 | 0.02 s Pup 2, 0.20 s Pup 1 | 2.52 s | Pup 2 breacher / **Pup 2 breacher** |
  | 7 | 1.30 s Pup 1 | 3.80 s / 3.52 s | Pup 1 breacher / HUMAN |

  A player who reads the new objective and presses Q a second later loses the set piece on 3 of 4 seeds.
- **Why P1:** it is the same harm Q2 filed: the chapter's signature beat and featured-kit moment is done for the player
  ("Bots help, never steal the win", ADVENTURE.md). `ad28d0f` stopped the step 1 mining, but the destroy step lets
  pups plant at once.
- **Why nobody saw it:** `tests/unit/adventure-steal.test.ts` only asserts that the wall stands through step 1 and
  that "it falls to the step meant for it". It never checks who breaks it.
- **Suspected file:** `src/sim/ai/tactics.ts` `adventureGoal`, `case 'destroy'` (Breachers "plant where the breach
  fuse fires"). It applies with a human in the squad.
- **Smallest fix:** with a human in the squad, pups don't plant on (or shoot) a `destroy` step's featured-kit target
  until the human has had a window. For example, wait the step's grace, or `STRICT_GRACE_SECONDS`, or until the human
  planted and failed. Only escort meanwhile.
- **Smallest test:** the steal2 scenario: the human plants 1 s into step 2 → `dsx.brokeBy` is the human on 4/4
  seeds. An idle human → the wall stands for ≥ N s.

### P2 — polish, labels, design (highest player impact first)

**P2-1. An online adventure room keeps listing the chapter it was created with; joiners take that chapter's kit.**
- **Repro:** `npx tsx tools/qa3-lead.mjs listing`: a Room created as the server creates it (`chapter: yard_day`,
  no holdResult), bot-only.
- **Evidence:** `listing.log`:
  - `91 s runs tall_grass (briefing) · listed as yard_day`;
  - `208 s runs garage_job (briefing) · listed as yard_day`.

  `server/rooms.ts:180` lists `mr.room.opts.chapter`, set once at creation. PROGRESS says "a room always lists the
  chapter it really runs": true only until it moves on. `096be58` makes a joiner take the listed chapter's featured
  kit. So a room that started at Yard Day and has reached ch6 brings the joiner in as an Assault, who then waits out
  the 120 s grace on the glide step. `adventureJoinKit(r)` (`src/client/ui/rooms.ts`) takes the kit from the listed
  `r.chapter`; I read this in code and did not observe it.
- **File:** `server/rooms.ts` `list()`. Read `adventureState(sim).chapter` (or have the runner publish the running
  chapter).
- **Smallest test:** a rooms test that completes ch1 bot-only and advances (30 s), then asserts `list()[0].chapter ===
  'tall_grass'`.

**P2-2. A match restart leaves vehicles in the world. It pulls a flying bot pilot out, and the empty plane crashes
into the new match. Bots also board during the post-match hold.**
- **Repro:**
  - `npx tsx tools/qa3-wave5.mjs tdm --seeds 31,32,33,34 --seconds 180 --lineup b2 --config soak` (look at
    `mountPhase`, and at `planesLost` entries with `hp 0` and a short `sinceMountS`);
  - then `npx tsx tools/qa3-trace.mjs 33 156.5 162.5`.
- **Evidence:**
  - mounts by phase: plane `ended` 1 in 3 of 4 soak-config seeds, and 1 in 2 of 4 shipping seeds;
  - seed 33: Cat 6 (Overwatch) boards at 156.9 s, **during the ended hold**, and takes off at 158.5 s. The restart at
    159 s respawns it (it leaves the seat with no `bail` event). The plane flies on pilotless from 10 m and explodes at
    (56.8, 6.1, −37.4) at **162.17 s, ~0.2 s after the new match went live**, so combat is live and its blast can
    hurt. The blast is credited to the respawned pilot (`by: 14`);
  - at the restart at 106 s, 3 of 4 seeds' planes were left pilotless and abandoned (despawned together at 151.1 s).
  - `match/index.ts restart()` respawns characters but leaves karts and planes.
- **Files:** `src/sim/match/index.ts` `restart()` (despawn vehicles, or at least empty planes);
  `src/sim/ai/tactics.ts` `planeGoal` / `considerBoarding` (no new sortie or ride unless `match.phase === 'live'`).
- **Smallest test:** TDM, a bot seated in a flying plane at the restart tick → no `explode` in the first 5 s of the
  next match, and no bot `mount` while phase is `ended`.

**P2-3. Ram kills are rare (B2a's "score ram kills" is not met on new seeds).**
- **Evidence:**
  - 0 ram kills in 16 soak-config TDM matches;
  - 3 in 8 shipping matches (2 of 4 seeds);
  - ram hits in 5/12 full short matches and 4/8 shipping matches.
- B2 declared this: targets back off from karts, so rams close at ~12 m/s for 51–63 damage.
- **Why it matters:** a kart that rarely kills is a slow taxi. Whether that is fun is for a human.
- **Suggested:** B2's own proposal, a brain reaction to karts (sidestep, kart-aware threat range). Or tune ram damage
  against the pets' 90–160 hp.

**P2-4. Hurt bots board a kart to ram and hop straight out (0 s rides).**
- **Repro:** `qa3-wave5.mjs tdm --mode core-rush --seeds 52 --seconds 300 --lineup room --config ship`.
- **Evidence** (`cr-52-short.log`): 6 of 15 rides are under 5 m. 4 of them last 0–0.3 s with `out = 'hurt'`, and all
  but one are around (9–10, 0–2), the contested middle. It is a visible hop-in/hop-out in a firefight; TDM has 0–2
  such rides per run.
- **Cause:** `tactics.ts` `boardToRam` has no health check, while `driveTick` bails at `RIDER_BAIL` (55 %) when shot in
  the last second.
- **Fix:** skip `boardToRam` below `RIDER_BAIL`.
- **Smallest test:** a bot at 50 % hp being shot, an enemy in ram reach, an empty kart by it → no `mount`.

**P2-5. Budget margins are thin again: a live high-tier TDM peaks at 1.43 M triangles (1.5 M) and 305 draws, and the 28-character tick p95 at 2.58 ms (3 ms).**
- **Evidence:** §5 row. Scene only: 1.17 M max. The lead's 1.38 M / 254 draws predates B2: karts and planes are now in
  most frames (52/90 with one within 60 m).
- **Tick:** best of 5 p95 2.58 ms (Q2 at W4: 2.04). Single runs are 3.2–3.3 ms at load 8. B2's +0.76 ms (AI driving/ram/dive checks + vehicle stepping) used most of the headroom.
- **Next:** `perf-render.mjs --query '&mode=team-deathmatch'` at the kart pads, and an LOD for vehicle outlines. `ai p95` per system in the soak shows where the tick goes. Re-measure both on the reference Mac before Wave 6 adds more.

**P2-6. Nits.**
- `/rooms` never lists a boss-rush room's boss (Madame Pointillé and the Vac-Tank look the same in the browser).
- Adventure scoreboard: the CATS column says "No one here yet" in a chapter (skirmish counts wave cats). Seen at step 1.
- Q2's `qa-w4abuse.mjs` still expects "no chapter" for path-like ids: 2 stale FAILs. Update the expectation to
  `yard_day`.

## 10. Scorecard (game-sprint-gates: 0.40 R + 0.35 I + 0.25 F)

| Axis | Score | Justification |
|---|---|---|
| **Realism** | **84** | **For:**<br>• unit 583 passed (1 skipped), build, e2e 4/4, 5-mode soak PASS (0 errors, stuck ≤ 1.5 s, deterministic);<br>• 0 page errors in ~40 browser sessions (menus, modes, chapters, abuse, boss, plane, online, e2e);<br>• 11/11 determinism pairs, interleaved too;<br>• authority and client memory plateau;<br>• budgets inside: tick p95 2.58 ms at 28 characters with vehicles, 34.2 KB/s, 1.43 M triangles max, 4.06 MB;<br>• 0 take-off crashes in 91 take-offs, kart stuck ≤ 0.5 s, 0 blank frames.<br>**Against:**<br>• thin margins: tick 0.4 ms, triangles 5 % (P2-5);<br>• a restart leaves a pilotless plane that crashes into the next match (P2-2);<br>• a stale room chapter (P2-1);<br>• hop-in/hop-out karts (P2-4);<br>• no real-GPU fps. |
| **Intensity** | **73** | **For:**<br>• vehicles in every match (4–13 kart rides and 2–4 sorties per shipping match);<br>• marksmen on the roof for up to 94 s a match;<br>• ch3's getaway and ch6's glide, plane and flyover done for real;<br>• drama 1.4–4.5 per player-minute in the soak.<br>**Against:**<br>• ram kills rare (0 in 16 short matches), so karts are mostly taxis (P2-3);<br>• the plane gun lands 0–7 hits a match;<br>• ch3's breach, the chapter's set piece, is still done by the pups (P1-1). |
| **Fairness** | **75** | **For:**<br>• pups no longer mine step 1;<br>• a checkpoint retry at the last wave is no harder than arriving (0/8 re-wipes);<br>• tips never cover a cue (0 of 1 681 samples);<br>• input-rate exploit +0 %;<br>• hostile setups sanitized, per-IP cap holds;<br>• rooms are independent (a fair server).<br>**Against:**<br>• pups still take the human's breach (3/4 seeds even when the human plants 1 s in; P1-1);<br>• joiners get the wrong featured kit from a stale listing (P2-1);<br>• an empty plane's blast can land in a fresh match (P2-2). |
| **Total** | **78** | 0.40 × 84 + 0.35 × 73 + 0.25 × 75 = 77.9. **PASS** (minScore 70). No hard-limit failure: no crash, desync, exploit or stuck > 5 s. Q2 scored Wave 4 at 76. |

## 11. What I could not verify, and why
- **Feel, fun, 60 fps, client CPU/GPU ms:** headless SwiftShader at 0–1 fps. Whether rare ram kills, weak strafing
  and roof snipers are fun needs a human.
- **Browser sessions only reach step 1** of a chapter. The finale card was rendered from the real module
  (`qa3-card.mjs`), and completion was checked in-process.
- **Commits other than `3b3bfb3`** were not verified in isolation (e2e on every integration commit is INT5's claim).
- **Client memory at a real frame rate:** my 10-minute run rendered 582 frames. View churn per frame is higher on a
  real GPU. The authority side is frame-rate independent.

### Reproduce
In-process (snapshot root):
- `npx tsx tools/qa3-wave5.mjs perch|fallback|tdm|kartwalk|ch3|ch6|takeoff|humanvehicle [--seeds …] [--mode …] [--lineup b2|room] [--config soak|ship]`
- `npx tsx tools/qa3-lead.mjs holdresult|steal2|listing`
- `npx tsx tools/qa-determinism.mjs --target … --pre …` · `npx tsx tools/qa3-interleave.mjs --a … --b … --late N`
- `NODE_OPTIONS=--expose-gc npx tsx tools/qa3-heap.mjs --minutes 30 [--soak-config]`
- `npx tsx tools/qa3-budget.mjs --seconds 90 --repeat 5` · `npx tsx tools/qa-budget.mjs --humans 0 --bots 28 --seconds 60 --repeat 5`
- `npx tsx tools/qa3-trace.mjs <seed> <fromS> <toS>` (plane trace; `ROOMFILL=1` for the shipping room)
- Q2's `npx tsx tools/qa-adventure.mjs steal|wipe|bots …`

Browser, against `npx vite preview --port 5390` of a build:
- `node tools/qa3-play.mjs geometry|menu|modes|chapters|plane|tipcue|black|abuse`
- `node tools/qa3-render.mjs --tier high --frames 90`

Against `npx vite --port 5391`:
- `node tools/qa3-card.mjs`
- `node tools/qa3-leak.mjs --minutes 10`

Against the prod server (`PORT=8793 STATIC_DIR=dist node dist-server/prod.js`):
- `node tools/qa3-online.mjs`
- `npx tsx tools/qa3-rooms-view.mjs`
- `npx tsx tools/qa-w4abuse.mjs --url ws://127.0.0.1:8793/ws --http http://127.0.0.1:8793`
- `npx tsx tools/qa-abuse.mjs --url ws://127.0.0.1:8793/ws --http http://127.0.0.1:8793 --parts A,C`
