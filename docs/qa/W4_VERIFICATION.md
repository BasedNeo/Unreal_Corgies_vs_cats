# W4 Verification — Q2 independent verifier

**Verdict: Wave 4 is done, with one P1 to fix before the human playtest.** Every headline claim I could re-measure
reproduced, at the pinned SHA, on fresh seeds and on the real West Yard with the shipped system list, with two
exceptions:
- A2's "the featured kit gets the step done" fails in chapter 3 once a human is in the squad (P1-1);
- the room browser shows the chapter only as a clipped, id-derived label (P2-3).
- **Gate:** `verify-commit` PASS (544 unit tests) and the 5-mode soak PASS.
- **Authority:** all six chapters finish bot-only inside par on seeds the lanes never used. Fail-forward, the stealth
  alarm and the 120 s grace behave as specified.
- **Destructibles:** the Garage breach opens for movement, nav and prediction, and only after a Dig Charge.
- **RC plane:** crashes explode on the near side, eject and stun the pilot, and give control back.
- **Madame Pointillé:** paints, glints, leaps and shows DOT ON YOU in-game.
- **Audio:** S2's recipes render cleanly in a real Web Audio context.
- **Online co-op:** works over the Brotli-serving production server.
- **Clean:** 0 page errors and 0 game console errors in 30+ headless sessions.

**P1-1, the one real defect:**
- **What happens:** in chapter 3 with a human in the squad, the Breacher pups blow the Garage wall about 5.5 s after
  go-live (4/4 seeds), while the human is still on step 1 (HUD STEP 1, runner index 0). The human's "plant a Dig Charge (Q)" step then completes
  0.02 s after they arrive.
- **Cost:** it steals the chapter's set piece and its featured-kit moment from the player, against the design rule
  "bots help, never steal the win".
- **Why nobody saw it:** the bot-only chapter tests cannot see it, because the rule only exists when a human is in the
  squad.

**No P0.** What is left is P2:
- presentation and label polish (overlaps, a clipped room label, a stale scoreboard timer, a dead-end finale card);
- two design questions that need a human:
  - the featured kit is not needed by a bot squad in chapters 2, 4, 5 and 6;
  - a checkpoint restart at the Porch Siege's last wave re-wipes far more often than arriving there (5/8 vs 0/8 seeds).
- a triangle count in a live high-tier TDM that is now at the edge of §8.7 (1.48 M vs 1.5 M, all passes).

Scorecard **76 / 100 (R 82 · I 70 · F 74), gate PASS.** The DoD items that need a real GPU or a human (60 fps, the
queue test, fun) remain open, as the lanes said.

| | |
|---|---|
| Verified SHA | **`a5177fd`** ("A2 integrated: adventure chapters 3-6"), the HEAD when I started. The lead committed on top while I worked (`122144b`, `096be58`, `fc3da3a`, `8a2993e`); nothing after `a5177fd` is verified here. |
| Method | A clean `git archive a5177fd` snapshot in the scratchpad with `node_modules` linked. Every run, build and server used the snapshot. No product file in it was changed; the only additions were the new read-only `tools/qa-*.mjs` listed below. Headless Chromium 1194 with SwiftShader: **1–4 fps** at quality low, 0.3–1 fps at high. Re-runs overwrote some shots:<br>• `ch-garage_job-*.png` and `mode-team-deathmatch*.png` are the high-tier re-run;<br>• `ch-tall_grass-*` and `ch-porch_siege-*` are the P2-9 re-run;<br>• the first run's blank frame is kept as `blank-frame-laser_dawn-run1.png`. |
| Box | 4 shared cores, 15 GB. Load was 2–6 at the start, 9–20 while browsers ran; each table gives its load where timing matters. |
| Consequence | Browser sessions judge integration, HUD, menus, errors and looks, **not feel**. Feel-adjacent claims (kit value, difficulty) were measured with bot squads and scripted stand-ins through the real Room, never with a human. |
| Servers | `vite preview` of the snapshot build on **:5190** (offline worker authority), Vite dev on **:5191** (module-level UI and audio probes), `PORT=8791 STATIC_DIR=dist node dist-server/prod.js` (online). Port 4173 was not used, and no Playwright e2e was run (the lead's `verify --e2e` owns it). |
| My outputs | New tools under `tools/` (none committed; the lead decides):<br>• `qa-adventure.mjs`, `qa-destruct.mjs`, `qa-plane.mjs`, `qa-w4lead.mjs`, `qa-w4budget.mjs` (in-process);<br>• `qa-w4play.mjs`, `qa-w4online.mjs`, `qa-rooms-view.mjs` (browser);<br>• `qa-audio.mjs`, `qa-card.mjs`, `qa-killfeed.mjs` (real modules via Vite dev);<br>• `qa-w4abuse.mjs` (network).<br>Screenshots and JSON are in `artifacts/q2/`; raw command output is in `artifacts/q2/logs/`. The existing `qa-abuse.mjs` and `qa-budget.mjs` were reused unchanged. |

---

## 1. Gate

| Check | Command | Result | Verdict |
|---|---|---|---|
| Commit in isolation | `node tools/verify-commit.mjs a5177fd` (load 3–8) | `Test Files 66 passed (66)`, `Tests 544 passed \| 1 skipped (545)`, 153 s. `VERIFY PASS a5177fd \| typecheck:ok boundaries:ok unit:ok build:ok`, 2 m 47 s wall | **PASS** |
| Soak, all five modes | `npx tsx tools/soak.mjs --modes yard-skirmish,team-deathmatch,core-rush,boss-rush,adventure --repeat 2` (load 6.0) | `SOAK PASS \| score 90 \| modes 5 · errors 0 · stuck max 1.5s · tick p95 1.23 ms · completed 3/5`. Per mode, best of 2, deterministic: skirmish p95 0.62, TDM 0.73, core-rush 0.98, boss-rush 1.23, adventure 0.69 ms; max 5.6–78 ms (the startup tick, as INT4 said) | **PASS** |
| Soak coverage (note) | same run | The adventure soak spends all 60 s on **STEP 1** (`matches 0: none (wave 1, 0:1)`): its net-bot "human" is a combat brain and never walks to a reach point, and with a human in the squad only the human can finish one. The soak's `snap … KB/s` (90–100) is `JSON.stringify` of the undelta'd message, not the wire. The real wire figure is in §7. | P2-8 (tooling) |
| Initial download | `vite build` + `npx tsx server/precompress.ts dist` | Offline: index 0.52 + worker 1.78 + prediction 1.73 = **4.02 MB gz** (budget 5), **2.99 MB br**. Q1 measured 3.79 MB gz at W1. | PASS |

## 2. Adventure (A1 / A2), re-measured — `tools/qa-adventure.mjs`, real Room + default systems, real West Yard

| Check | Command | Result | Verdict |
|---|---|---|---|
| Bot-only squads finish inside par, on new seeds | `qa-adventure.mjs bots --seeds 7,8` | All 12 runs complete, all gold:<br>• ch1 48.4 / 42.7 s (par 120);<br>• ch2 71.2 / 77.7 (160);<br>• ch3 45.1 / 46.1 (120);<br>• ch4 91.1 / 93.8 (180);<br>• ch5 75.1 / 73.7 (160);<br>• ch6 216.1 / 186.9 (360).<br>Ch6 seed 7 is 30 s slower than A2's worst (186 s): the Vac-Tank took 182 s. Seeds 1–5 and 9–11 of ch5: 73.9–76.7 s. | **PASS** |
| Fail forward (forced wipe on the first checkpoint step > 0) | `qa-adventure.mjs wipe --seeds 7` | All 6 chapters: phase `failed`, a **3.02 s** beat, a restart at the **checkpoint step (not 0)**, all 4 alive, then the chapter completes (ch1–4 and ch6 gold; ch5 silver, see P2-2). | **PASS** |
| Stealth alarm (ch2) | `qa-adventure.mjs stealth` | Open lawn 9.2 m from the meadow sentry: alarm after **2.8 s**, 2 alarm hunters, the cat yells.<br>Still and hidden (concealment 1) 11 m from the compost-bin sentry: **no alarm in 25 s**. The same holds 13.3 m from any sentry in the meadow. | **PASS** |
| Bots never steal a human's step (ch3) | `qa-adventure.mjs steal --seeds 1,2,3,7` (a human slot that idles, then is placed at the wall after 60 s) | In **4/4 seeds** the Breacher pups plant 5–6 Dig Charges while escorting step 1 ("Sneak round the back to the boarded-up wall"). The wall breaks **5.3–5.8 s after go-live, during step 1**. When the human arrives, step 2 "Blow the wall: plant a Dig Charge on it (Q)" completes **0.02 s** later. The same thing shows in the browser: `high-garage_job-later.png` has the breach blast at the wall while the HUD still reads STEP 1. | **FAIL** (P1-1) |
| 120 s grace | `qa-adventure.mjs grace` (a human stand-in, no pups, held in the zone the wrong way) | Ch6 glide zone standing on the lawn, ch4 perch standing in the garage under it (y 0.2), ch3 gate on foot: all **still on the step at 119 s and complete at 120.02 s**, with the GRACE_BARK. | **PASS** |
| Does the featured kit matter? | `qa-adventure.mjs offkit --seeds 7` (every pup an Assault) | **ch3 never completes** (stuck at the breach for 263 s): the kit is a hard gate. The rest finish with all Assaults, in s (featured kit vs all-Assault):<br>• ch2: 71.2 vs 74.3;<br>• ch4: 91.1 vs 92.8 (duel 49.8 vs 51.4);<br>• ch5: 75.1 vs 75.0;<br>• ch6: 216.1 vs 163.2, faster without the Skyraiders.<br>Humans are still gated by ch6 step 1 (a glide, or the 120 s grace) and by ch4's roof height (any kit can climb). | see P2-1 |
| Chapter card, medals, progress | `qa-card.mjs` (the real `createAdventureHud`, synthetic beacon) | Gold ch3 0:58.2 / par 2:00 with NEW BEST, and `cvc.adventure` = `{unlocked:4, medals:{garage_job:'gold'}}`. A slower silver replay keeps the gold and shows no NEW BEST. The ch6 bronze card works, but its NEXT CHAPTER button is **disabled with no end-of-adventure path** (P2-6). SQUAD DOWN beat renders. `card-*.png` | PASS |
| Menu picker and locks | `qa-w4play.mjs menu` | Fresh device: ch1 open, ch2–6 LOCKED ("Finish chapter N first"), and clicking locked ch3 does nothing. With progress seeded: medals GOLD/SILVER/BRONZE PAW and ch6 pickable; the featured-kit line follows the pick. `menu-adventure-*.png` | PASS (layout: P2-7) |
| Every chapter in-game | `qa-w4play.mjs chapters` (`?mode=adventure&chapter=<id>&autoplay`) | All 6 boot (0 page errors). Each shows the intro panel (CHAPTER n, title, featured kit, caption, E skip), then `STEP 1` plus the right objective and mission card. The player faces the first objective, the pups are at its ring, ch4 has dawn light, and ch6 starts on the garage roof. `ch-*-intro/live/later.png` | PASS |

## 3. Destructibles (X1) — `tools/qa-destruct.mjs`, shipped systems, real West Yard

| Check | Result | Verdict |
|---|---|---|
| Rifle vs the breach wall | 45 rifle shots, wall hp **150 → 150** | PASS |
| Before the breach | A corgi sprinting at the wall from the alley stops at x 94.38 (the face is x 94.0) | PASS |
| Dig Charge breach | A real Q press 1.2 m from the boards: broken **2.42 s** later (claim 2.5 s), credited to the Breacher | PASS |
| After the breach | The same corgi runs to x 81.3, inside the garage | PASS |
| Nav | A* alley→inside **15.8 m → 8.0 m** (claim > 12 before, ≤ 8.5 after) | PASS |
| Prediction mirror | A predicted sim mirrors 7 standing props (the broken wall dropped), and a predicted ray alley→inside is clear | PASS |
| Frisbees | A crate stack breaks (60 → 0). The wall is untouched. 3 direct hits: enemy kart 260 → 185, **enemy plane 140 → 38**, friendly kart 260 → 260 | PASS |
| Kart rams | Boosted from 18 m (18 m/s): crate_stack_1 and _3 break (1 break event each). Gentle (0.3 throttle, 4.5 m/s): holds. Boosted into the wall from the alley (11.4 m/s): **holds** (explosions only). No clear run-up exists inside the garage for a tuna stack; not measured. | PASS |

## 4. RC plane (R1) — `tools/qa-plane.mjs`, shipped systems, real West Yard, and `qa-w4play.mjs plane`

| Check | Result | Verdict |
|---|---|---|
| Cruise into the garage west wall (y 4) | Explodes at x 67.55, the near side of x 68. The pilot is thrown out clear (x 67.1, y 5.35), unseated, stunned; 95/120 hp | PASS |
| Boosted dive onto the garage roof (7.2 m slab) | Explodes at y 7.65 **on top**; the pilot lands on the roof (y 8.7). No tunnelling. | PASS |
| Boost into the shed side | Explodes at z 79.55, the near side of z 80 | PASS |
| Stun ignores input | Same crash twice, pushing W+D+jump+sprint vs no input for 20 stunned ticks: positions **0.000 m apart** (all 3 crashes). Control returns: 2–4 m walked afterwards. | PASS |
| Plane HUD only while flying (browser, ch6) | Walked off the roof start to the Rooftop Hangar kiosk (92, −68.3), E vended a plane on the pad and E boarded it:<br>• on foot: no strip;<br>• seated: the FETCH FLYER strip;<br>• after it flew off and crashed: the strip is gone.<br>Take-off happened in-game. Landing was not re-measured (unit test only). `plane-*.png` | PASS (layout: P2-4) |
| Plane ram on pets | Not independently re-measured; `vehicle-plane.test.ts` "rams pets …" passes in the gate | unit only |

## 5. Madame Pointillé (E1) and the lead's boss wiring — `qa-w4play.mjs boss` (`?boss=madame_pointille&autoplay`)

| Check | Result | Verdict |
|---|---|---|
| `?boss=madame_pointille` in-game | Boss-rush wave 1 "BOSS (1/1)". The bar reads **MADAME POINTILLÉ · PHASE 1**. `boss-bar.png` | PASS |
| Dot telegraph and DOT ON YOU | In 78 s of play: 14 `dot_paint`, 13 `dot_glint`, 3 `shot_spoiled` (the lens hit during the glint), 2 `sniper_leap` (relocation), 1 `dot_lost`. The cue showed; the screenshot has the beam from her perch, the dot on the corgi's back and the painted ring at its feet. `boss-dot-on-you.png` | PASS |
| Phase 2 label | Not reached in the session (hp 100 → ~60 %). In code, `boss-bar.ts:39` renders `PHASE 2 · BERET OFF!` from `phase2Label` | code only |

## 6. Audio (S2) and the lead's fixes

| Check | Command | Result | Verdict |
|---|---|---|---|
| Recipes in a **real** Web Audio context | `qa-audio.mjs` (Chromium `OfflineAudioContext`, the real `presets.ts`) | **40/40** recipes render finite, audible, and inside their returned duration. S2's recipes peak ≤ 0.87 (L5's `boom` 1.20, `snap` 1.12 and `thwack` 1.06 are over 1.0, as S2 noted). | PASS |
| Engine loops start and stop | same, `kartEngine` / `planeEngine`, a scripted 6 s segment | Kart: 16 nodes, 3 sources; idle −32.3 dB → full −26.4 dB. Plane: 21 nodes, 6 sources; idle −29.2 → full −24.4 → boost −20.3 dB. **After release: peak 0** (silent). | PASS |
| Friendly shots pass your own Squeak Barrier | `qa-w4lead.mjs` (a real Q press by a Warden; a cat 12 m ahead) | Corgi player → cat **8 hits** through its own wall; cat → wall 7, cat → Warden and shooter **0**. A corgi **bot** behind the wall also sees and shoots through it (8 hits); the wall soaks 16. | PASS |
| Spawn facing (inputs wait for the first snapshot) | all browser sessions | Every chapter start faces its objective (the kiosk, the alley, the crate stair, the west pile, the parapet); PvP spawns face the yard; the online clients face the kiosk | PASS |
| Brotli in the prod server | `curl -H 'Accept-Encoding: br' …/assets/*.js` + the browser | All 3 JS chunks `Content-Encoding: br` (418 k / 1.26 M / 1.31 M). `gzip` only → gzip; `br;q=0` → gzip; none → identity. The decoded body is byte-identical to `dist`. Both browsers received br. | PASS |
| Room browser shows the chapter | `qa-rooms-view.mjs` | Rows read "Adventure · Lase…" and "Adventure · Buy …", clipped. The label is built from the id, not the title, and the id is not validated. `rooms-browser.png` | **PARTIAL** (P2-3) |
| Kill feed kart and plane glyphs | `qa-killfeed.mjs` (the real `createHud`) | Seated killers get the plane and kart glyphs; on foot, the weapon glyph. `killfeed.png` | PASS |
| No duplicate WAVE chip | skirmish and boss-rush screenshots | The timer reads WAVE 1; no chip below it | PASS |

## 7. Budgets (§8.7)

| Budget | Command | Measured | Verdict |
|---|---|---|---|
| Sim tick, 12 players + 16 bots ≤ 3 ms | `qa-budget.mjs` (TDM, 3 runs, load 2.4) | best-of-3 min(wall,cpu) **p50 1.01 · p95 1.71 · max 3.47 ms**; single run p95 2.9 | PASS |
| … plus 2 planes flying + 8 destructibles | `qa-w4budget.mjs --seconds 90 --repeat 3` (load 5) | 73 entities, 31 pilot-s airborne, 983 shots, 76 deaths, 1 break. **p50 1.17 · p95 2.04 · p99 2.42 · max 5.13 ms** best-of-3. Single runs p95 2.2 / 2.5 / **6.7** (run 0 overlapped a 20-process burst on the box). | PASS (margin 1 ms) |
| Adventure runner | `qa-adventure.mjs bots` | Chapter tick p95 0.48–1.56 ms (4–15 characters). The first tick of a fresh process is 160–295 ms (JIT + nav build); a second room in the same process: first ticks 3–35 ms, but `Sim.create` is 300–700 ms at load 20 | PASS (note) |
| Snapshot bandwidth ≤ 40 KB/s at 12 players | `qa-budget` / `qa-w4budget` (delta wire, incl. roster and events) | **30.5 KB/s** firefight; **32.5 KB/s** with planes | PASS |
| Draw calls ≤ 400 | WebGL2 draw counter in `qa-w4play.mjs` (max of the last 8 frames, all passes), 1280×720 | Low: skirmish 182, TDM 206, core-rush 231, adventure 60–123. **High: TDM 247, ch3 (the Garage) 173–176** | PASS |
| Visible triangles ≤ 1.5 M | same | Low: 0.44–0.91 M. **High: TDM 1.48 M**, ch3 0.85–0.88 M (all passes, shadow included). Q1's same method at W1: 1.01 M. The lead's `fc3da3a` 1.29 M is the empty free-mode spawn view. | at the edge (P2-5) |
| Client world build | long tasks at boot (`PerformanceObserver`) | Largest boot task 1.05–2.4 s (world build + first shader compile, load 6–12); matches the known ~1.3 s | known |
| Client CPU / GPU ms, 60 fps, memory growth | — | Not measurable here (SwiftShader); no 10-minute browser soak was run | unverified |

## 8. Online (production server) — `qa-w4online.mjs` against `PORT=8791 STATIC_DIR=dist node dist-server/prod.js`

| Check | Result | Verdict |
|---|---|---|
| Two clients, `?room=q2&mode=adventure&chapter=yard_day` | Both on `ws`, both show **CH 1 · YARD DAY** and `STEP 1`, each sees the other's player entity (13 and 44) | PASS |
| `/rooms` | `{"name":"q2","mode":"adventure","players":4,"humans":2,"bots":2,…,"phase":"live","chapter":"yard_day"}` | PASS |
| Replication | B saw A move **13.98 m** after A held W | PASS |
| Content-Encoding | Both pages downloaded `index` and `prediction` with `br` (no worker chunk online) | PASS |
| First attempt (note) | On the first attempt B's page took 73 s to load next to A at 1280×720 (SwiftShader). Its main thread was blocked past the server's 30 s idle timeout: `c17 closed: idle timeout (4000)`. At 480×270 while loading, both joined in 45 s. This is a harness artifact, not a product finding (pings run on `setInterval`, and only a blocked thread starves them). | note |

## 9. Abuse

| Check | Command | Result | Verdict |
|---|---|---|---|
| Q1's network abuse (Part A) + speed exploit (C) | `qa-abuse.mjs --url ws://127.0.0.1:8791/ws --http http://127.0.0.1:8791 --parts A,C` | 10/11:<br>• malformed → 1008 after 22 frames;<br>• 40 KB → 1009;<br>• binary/pre-hello → 1008;<br>• 20 000-ping flood → 1008 in 251 ms;<br>• hostile hello sanitized;<br>• forged or huge inputs clamped;<br>• Infinity seq survives;<br>• **input-rate exploit +0 %** (Q1: +14 %).<br>The one FAIL is the tool's 12 s wait vs the server's 10 s + 5 s sweep; re-checked below. | PASS |
| No hello | `qa-w4abuse.mjs` | Closed **4001** after 11.4 s | PASS |
| Hostile room setups | `qa-w4abuse.mjs` | `mode=<script>` → yard-skirmish. `chapter=../../etc` and a 200-char chapter → dropped. `boss=../x` → dropped. Chapter/boss outside their modes → ignored. The first joiner decides the room: a second joiner's `mode=team-deathmatch` joins the adventure. Hello extras (`mode`, `chapter`, `admin`) are ignored, `team:1` is forced to corgis. **A well-formed unknown `chapter=nonexistent` is listed in `/rooms` as-is while the room runs Yard Day** (P2-3). | PASS / P2 |
| Rate limits | `qa-w4abuse.mjs` | 60 parallel `/rooms` → 19 × 200, 41 × 429 | PASS |
| Malformed URL params, offline client | `qa-w4play.mjs abuse` (8 URLs) | 0 page errors, and the text renders as text:<br>• `mode=<script>` → free roam "LIVE · Explore West Yard";<br>• bad chapters → Yard Day;<br>• bad or unknown boss → the Vac-Tank;<br>• `mode=boss-rush&chapter=…` → boss-rush.<br>The offline client does not validate `?mode=` (the server does), which is harmless. | PASS |

---

## 10. Findings

### P0 — none

### P1 — fun / fairness breaker

**P1-1. Chapter 3: the Breacher pups blow the Garage wall before the human gets there, so the chapter's set piece is
done for them.**
- **Repro:**
  - `npx tsx tools/qa-adventure.mjs steal --seeds 1,2,3,7`: a Room with `mode: 'adventure', chapter: 'garage_job'`, 4
    squad slots, one human that idles for 60 s, then is placed at the wall.
  - In the browser: `?mode=adventure&chapter=garage_job&autoplay&cls=breacher`, then press E and don't move. Within about
    6 s the wall blows while the HUD reads STEP 1.
- **Evidence:**
  - Wall broken 5.3–5.8 s after go-live in 4/4 seeds, during step 1, by 5–6 pup charges.
  - After the human reaches the wall, "Blow the wall: plant a Dig Charge on it (Q), then back off" completes in **0.02 s**.
  - `artifacts/q2/high-garage_job-later.png` shows a break burst and comic word at the boards, with the pups there,
    while the HUD reads STEP 1. The worker sim runs in real time, so ~20 s had passed. The in-process run is the proof;
    the shot is corroboration.
  - Bot-only runs (A2's and mine) can't show this: with no human, the pups are supposed to do every step.
- **Cause, all three together:**
  1. With a human in the squad, pups escort a `reach` step through `zoneGoal()`. That function sets `t.hold = true`
     (`src/sim/ai/tactics.ts:499`).
  2. C2's "mine the hold zone" rule then has Breachers plant a charge whenever they stand in the zone with none of their
     own down (`tactics.ts:253`).
  3. Step 1's zone is `reach (97, −66) r 4.5` (`src/shared/content/chapters.ts:297`), right against the boards. X1's
     breaching fuse arms **any** corgi charge within 2.6 m of a standing breach wall (`src/sim/destruct/damage.ts:184–200`,
     `breachCharges`).
- **Why P1:**
  - It breaks the design rule "Bots help, never steal the win" (ADVENTURE.md) and the chapter's signature beat ("set
    piece: wall breach").
  - A2's "the featured kit is what gets a step done" holds only for bot-only play. With a human, the Breacher kit is
    never needed in ch3.
- **Smallest fix:** `zoneGoal()` should set `hold` only for real `hold` steps (`reach` and `interact` escorts get
  `t.hold = false`). Optionally, make the breaching fuse (or the wall's damage) count only while a `destroy` step
  targets that tag.
- **Regression test:** the `steal` scenario above; the wall must stand until step 2 is live.

### P2 — polish, labels, design questions for a human (highest player impact first)

**P2-1. The featured kit is optional for a bot squad in four of six chapters (a design question for a human).**
- **Repro:** `npx tsx tools/qa-adventure.mjs offkit --seeds 7` sets `adventureConfig.chapter.pups` to four Assaults. Compare with `bots --seeds 7`.
- **Evidence:** §2 row "Does the featured kit matter?" (featured vs all-Assault, s):

  | Chapter | Featured kit | All Assault |
  |---|---|---|
  | ch2 (Infiltrator) | 71.2 | 74.3 |
  | ch4 (Overwatch), the whole laser duel | 91.1 | 92.8 |
  | ch5 (Warden) | 75.1 | 75.0 |
  | ch6 | 216.1 | 163.2, faster without the Skyraiders |

  Only ch3's breach wall is a hard gate for bots, and with a human the pups do that too (P1-1). For humans the kit
  gates only ch6 step 1, and only for 120 s. A2's "Overwatch pups deal 64–68 % of her damage" is true when they are
  present, not required.
- **Why it matters:** ADVENTURE.md promises "one district and one kit each". A human may still feel the difference (range in the duel, cloak in the grass); bots can't tell us.
- **Suspected file:** content, not code. `src/shared/content/chapters.ts` (ch4 duel, ch5 hold/survive, ch2 steps).
- **Smallest test:** the human queue test with a wrong-kit run of ch4 and ch5.

**P2-2. A checkpoint restart at the Porch Siege's last wave re-wipes far more often than arriving there.**
- **Repro:**
  - natural runs: `npx tsx tools/qa-adventure.mjs bots --chapters porch_siege --seeds 1,2,3,4,5,9,10,11`;
  - forced restarts: `… wipe --chapters porch_siege --at 3 --seeds 1,2,3,4,5,9,10,11`.
- **Evidence:** `artifacts/q2/logs/porch.log`, `wipe-other.log`, `adv-more.log`, summarized here:

  | Runs (bot-only) | Re-wipes |
  |---|---|
  | Natural: 8 seeds (plus A2's 6) | none |
  | Last wave, one forced wipe then restart | **5 of 8 seeds re-wipe** (1, 1, 2, 1, **4** later wipes; the chapter takes up to 124 s vs 75 s) |
  | Forced at the hold step (`--at 2`) | 0/4 |
  | ch4 crossing | 0/4 |
  | ch1 patrol | 2/4 (natural ch1: 0) |

  One run (seed 7, forced at the hold step) went on to wipe 5 times in a row at the last wave. The restart puts the same 8 wave-3 cats at identical spots, and the squad at full hp, spawn-protected. The one difference I saw is the squad's placement: natural arrival leaves the pups spread over the porch steps. A restart puts all four in a tight rally formation, two of them at the same point, (−51, −77) and (−51, −77).
- **Why it matters:** fail forward is the chapter's safety net. For a human, a retry that is harder than the first try reads as a loop.
- **Suspected:** `src/sim/adventure/runner.ts:616–650` `restartAtCheckpoint`, `:126–139` `placeMember` → `formationSpot` (the survive step rallies at the hold point; the formation collapses). The cause is not isolated.

**P2-3. The room browser's chapter label is clipped, built from the id, and the id is not validated.**
- **Repro:** `npx tsx tools/qa-rooms-view.mjs` → `artifacts/q2/rooms-browser.png`, or join `?room=x&mode=adventure&chapter=nonexistent`.
- **Evidence:**
  - At 1280×720 the MODE column reads "Adventure · Lase…" (the chapter is unreadable).
  - `chapterLabel(id)` title-cases the id, so 5 of 6 differ from the real titles: "Laser Dawn" vs "Laser Pointer at Dawn", "Last Ball" vs "The Last Tennis Ball", "Tall Grass", "Garage Job", "Porch Siege".
  - `sanitizeRoomSetup` accepts any `[a-z0-9_]{1,32}`, so `/rooms` lists `chapter:"nonexistent"` (and "Buy Gold At Example") while the sim silently runs Yard Day (`runner.ts:786` falls back to `CHAPTERS[0]`).
  - At `a5177fd` the browser also says "Joining as ASSAULT · AUTO TEAM" for an Overwatch chapter. `096be58` says it fixed the join kit; not verified.
- **Files:** `src/client/ui/rooms.ts:94` (`chapterLabel`), `src/client/ui/room-browser.ts:78`, `src/host/guard.ts` `sanitizeRoomSetup` (validate against `CHAPTERS`, or store the resolved id in `RoomSetup`), `server/rooms.ts:180`.

**P2-4. HUD overlaps at 1280×720.**
- **Evidence:**
  - The first-match TIP bar (y 561–598) covers the **SPOTTED** chip (568–596) entirely and grazes **DOT ON YOU** (536–564). `qa-w4play.mjs geometry`. The dot hit the player 5–20 s into the boss fight, while tips still run. `DOT ON YOU` is the fair-play backstop.
  - The plane's cockpit strip sits over the TIP text (`plane-seated.png`).
  - The S1 mission card (left) covers the **SCOREBOARD** title ("…ARD"; `mode-yard-skirmish-tab.png`). In adventure the intro panel covers the Tab scoreboard (`mode-adventure-tab.png`).
- **Files:** `src/client/main.ts:109,116,121` (cue `bottom` 92/124/156 px), `src/client/ui/tips.ts`, `src/client/ui/plane-hud.ts`, and z-order in `hud-style.ts`.
- **Fix:** hide tips while a cue or the plane strip shows, or stack the cues above the tip band.

**P2-5. A live high-tier TDM is at the §8.7 triangle budget.**
- **Evidence:** 1280×720, quality high, TDM at the corgi spawn, 8 bots: **247 draws, 1.48 M triangles per frame** (all passes, shadow included). Q1's same counter at W1 read 1.01 M. The lead's 1.29 M (`fc3da3a`) is the empty free-mode view.
- **Reading:** if §8.7 means visible triangles, the shadow pass inflates this number. But the headroom a live match has left is ~1 %.
- **Next:** `tools/perf-render.mjs --query '&mode=team-deathmatch'` split by pass. `artifacts/q2/high-tdm.png`, `artifacts/q2/logs/modes-high.json`.

**P2-6. The finale's card is a dead end.**
- **Evidence:** after ch6 the card reads "CHAPTER COMPLETE!" with **NEXT CHAPTER ▸ disabled** and "[ENTER] next" under it; there is no THE END, credits or back-to-menu path (`card-bronze-final.png`). `src/client/adventure/hud.ts:188-189` (`next` is null and `soon` is false for index 6).
- **Related:** online, the room replays ch6 by itself after 30 s (`runner.ts` `nextChapter(def.id) ?? def`).

**P2-7. Menu and label nits.**
- **Scoreboard meta:** it reads "YARD SKIRMISH · **0:00** · WAVE 1" in untimed phases, and "ADVENTURE · 0:00 · **WAVE** 1" in a chapter; the top bar says STEP. `hud.ts:628`.
- **Plane strip:** it says "**7 M UP**" and "ON THE GROUND" at once on the roof pad. The height comes from `worldData.height()` (terrain, ignoring the roof). `main.ts:272`.
- **Menu at 1280×720 with ADVENTURE picked:** the two cards end at y 678 and the controls footer starts at 674, a **4 px overlap**. The two-line hint pushes the card down (`geometry` run). 1024×600 and 800×450 are fine.
- **Room browser in adventure:** the back button says "‹ CLASSES".
- **Objective line:** a long step text is ellipsized, which drops the "(n/N)" counter (the mission card has it).
- **Unknown `?mode=` offline:** it silently becomes free roam (harmless).

**P2-8. Tooling that under-reports (for the lead, not players).**
- **Adventure soak:** the soak's adventure mode never gets past STEP 1: its net-bot human doesn't play objectives, and human-only reach steps wait for it. Suggest `--no-netbot` for adventure, or let the net-bot follow `tactics`.
- **Soak bandwidth:** `snap … KB/s` is raw JSON (90–100 KB/s), not the delta wire (30 KB/s). `tools/soak.mjs:121`.

**P2-9. An intermittent blank canvas at an adaptive-resolution step (headless; unconfirmed on a real GPU).**
- **Evidence:** 3 of the 6 first-run "live" chapter screenshots were solid page background, #0d1a14 (kept: `blank-frame-laser_dawn-run1.png`). All were captured around frame 30, where the adaptive pixel ratio takes its first step. Targeted re-runs saw 0 of 47 blank.
- **Suspected cause:** `main.ts:326–327` calls `quality.update(frameMs)` (→ `setPixelRatio`, which resizes and clears the canvas) *after* `ctx.render()` in the same rAF, so a cleared buffer can reach the compositor before the next render. On a real GPU this would be a 1-frame black flicker on each step.
- **Fix:** run `quality.update` before `ctx.render()`.

## 11. Scorecard (game-sprint-gates: 0.40 R + 0.35 I + 0.25 F)
| Axis | Score | Justification |
|---|---|---|
| **Realism** | **82** | **For:**<br>• gate and soak green;<br>• 0 page errors and 0 game console errors in 30+ sessions;<br>• deterministic, bot-completable chapters on new seeds;<br>• destructibles, nav and prediction agree;<br>• no plane tunnelling;<br>• audio clean in real Web Audio;<br>• Brotli correct;<br>• tick and bandwidth within budget with planes flying.<br>**Against:**<br>• triangles at the edge (P2-5);<br>• HUD overlaps and stale labels (P2-4, P2-7);<br>• the clipped room label (P2-3);<br>• a possible resize flicker (P2-9);<br>• no real-GPU fps. |
| **Intensity** | **70** | **For:**<br>• six distinct chapters with briefing, captions and barks;<br>• a live duel (14 paints and 2 leaps in 78 s);<br>• a satisfying card;<br>• par 2.0–2.3× the bot time.<br>**Against:**<br>• ch3's wall breach, its set piece, happens without the player (P1-1);<br>• the featured kit is not needed by bots in ch2, 4, 5 and 6 (P2-1);<br>• the finale ends on a disabled button (P2-6);<br>• the soak never exercises a chapter past step 1 (P2-8). |
| **Fairness** | **74** | **For:**<br>• stealth is truthful (hidden at 11 m never spotted; in the open, spotted in 2.8 s);<br>• the grace fires at exactly 120 s;<br>• a paint before every shot (≥ 1.1 s, unit-tested), with the lens counterplay seen in-game (3 spoiled shots);<br>• friendly shots pass your own walls and enemies' don't;<br>• the input-rate exploit is gone;<br>• room setups are sanitized.<br>**Against:**<br>• pups take a human's step (P1-1);<br>• a checkpoint retry at ch5's last wave is harder than the first try (P2-2);<br>• the tip bar can hide SPOTTED / DOT ON YOU (P2-4). |
| **Total** | **76** | **PASS** (minScore 70). No hard-limit failure: no crash, exploit, desync or stuck state was found. |

## 12. What I could not verify, and why
- **Feel, fun, difficulty for humans, 60 fps, client CPU/GPU ms:** headless SwiftShader at 1–4 fps. The adventure's human-facing difficulty (ch5 especially), the duel's 2–4 min target and the queue test need a human on real hardware.
- **A human finishing a chapter in the browser:** it isn't feasible at ~1 fps. The chapter-complete path is covered on the authority by `qa-adventure.mjs`, and on the client by rendering the real card module from synthetic beacons.
- **Only in the unit tests (which pass in the gate):**
  - the plane ram on pets;
  - the plane landing;
  - a tuna stack rammed by a kart (no clear run-up inside the garage);
  - phase 2 of the sniper, and the in-game `PHASE 2 · BERET OFF!` label;
  - S2's loop manager (nearest-4, hysteresis, steal rules).
- **Memory growth over a 10-minute session:** not run (budget of time; Q1's evidence at W1 was weak too).
- **Commits after `a5177fd`** (`096be58` join kit, `fc3da3a` budgets, `8a2993e` settings): not verified.

### Reproduce
In-process:
- `npx tsx tools/qa-adventure.mjs bots|offkit|wipe|grace|stealth|steal [--seeds 7,8] [--chapters …] [--at n]`
- `npx tsx tools/qa-destruct.mjs`
- `npx tsx tools/qa-plane.mjs`
- `npx tsx tools/qa-w4lead.mjs`
- `npx tsx tools/qa-w4budget.mjs --seconds 90 --repeat 3`
- `npx tsx tools/qa-budget.mjs`

Browser, against `npx vite preview --port 5190` of a build:
- `node tools/qa-w4play.mjs menu|modes|chapters|boss|abuse|plane|geometry|black [--q '&quality=high'] [--only …]`

Against `npx vite --port 5191`:
- `node tools/qa-audio.mjs`
- `node tools/qa-card.mjs`
- `node tools/qa-killfeed.mjs`

Against the prod server:
1. `npm run build && npx tsx server/precompress.ts dist && npm run build:server`
2. `PORT=8791 STATIC_DIR=dist node dist-server/prod.js`, then:
   - `node tools/qa-w4online.mjs`
   - `npx tsx tools/qa-rooms-view.mjs`
   - `npx tsx tools/qa-w4abuse.mjs`
   - `npx tsx tools/qa-abuse.mjs --url ws://127.0.0.1:8791/ws --http http://127.0.0.1:8791 --parts A,C`
