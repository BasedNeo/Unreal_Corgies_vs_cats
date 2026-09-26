# Adventure — "The Last Tennis Ball" (Wave 4 design brief)

MASTER_PLAN §1: *"one outrageous district at a time, alone, in co-op, or head-to-head online."* The owner chose
**adventure first, multiplayer-ready**. Waves 1–3 built the sandbox: districts, six kits, bosses, terminals,
cores, and match modes. Wave 4 turns it into a **chapter-by-chapter adventure** that plays alone (with corgi bot
squadmates) or in online co-op (humans replace bots), on the same authoritative sim.

Story is a placeholder until the owner supplies one (§13 "story slot"). All names, lines and gags here are
original; Conker/Rare material is off-limits (§0 red lines).

## Premise
The cats stole the last tennis ball in the neighbourhood and are holding it on the shed roof. A four-corgi
squad (you plus three pups, or your friends) takes West Yard back, one district at a time. Each chapter features
one class kit (§5). The finale is the Vac-Tank.

## Chapters (one district and one kit each; 6–10 min; par time for a medal)
| # | Title | District | Featured kit | Beats (trigger types) | Set piece |
|---|---|---|---|---|---|
| 1 | **Yard Day** | West Yard hub | Assault | reach the kiosk (reach) → learn a kit swap (interact) → clear the first patrol (defeat 6) → grab the Squeaker (interact) → hold the trampoline (hold) | first wave crash |
| 2 | **The Tall Grass** | The Garden | Infiltrator | sneak to the catnip patch (reach, **stealth**: being spotted starts an alarm wave) → collect 3 catnip bags (collect) → get out unseen or survive the alarm (survive 45 s) | sentry cones |
| 3 | **The Garage Job** | The Garage | Breacher | reach the breach wall (reach) → blow it (destroy) → wreck 4 tuna-can stacks (destroy 4) → escape in the mower kart to the gate (reach, in a vehicle) | wall breach |
| 4 | **Laser Pointer at Dawn** | The Rooftops | Overwatch | climb to a perch (reach) → duel the Siamese sniper elite (defeat boss) → cover the squad's crossing (survive 40 s) | laser duel (t = dawn) |
| 5 | **The Porch Siege** | West Yard deck | Warden | fortify the porch (interact ×2: barricades) → hold the porch through 3 waves (hold + survive) | wave defense |
| 6 | **The Last Tennis Ball** | The Sky → shed | Skyraider | glide off the garage roof to the shed (reach, airborne) → take the RC plane (interact) → fly to the shed roof (reach) → beat the Vac-Tank (defeat boss) → grab the ball (interact) | boss finale |

## Contract (lead-owned; lanes build against it)
- **Mode** `adventure`. The chapter comes from `sim.state.room.chapter` (a chapter id) and is set by the Room from
  `?chapter=` / the hello payload's `mode` + `chapter`.
- **Data** `src/shared/content/chapters.ts`:
  ```ts
  interface ChapterDef {
    id: string; index: number; title: string; district: string; cls: ClassId;
    intro: string[]; outro: string[];          // 2–3 comic caption lines each
    squad: number;                             // corgi bots filling the squad (humans replace them)
    start: { x: number; z: number; yaw: number };
    par: number;                               // seconds for the gold paw medal
    steps: ChapterStep[];
    t?: number;                                // time of day 0..1 (optional, e.g. dawn)
  }
  interface ChapterStep {
    id: string; text: string;
    trigger:
      | { type: 'reach'; params: { x: number; z: number; radius: number; vehicle?: boolean; airborne?: boolean } }
      | { type: 'interact'; params: { x: number; z: number; radius: number; prompt: string } }
      | { type: 'hold'; params: { x: number; z: number; radius: number; seconds: number } }
      | { type: 'collect'; params: { item: string; count: number; spots: Array<{ x: number; z: number }> } }
      | { type: 'defeat'; params: { count?: number; boss?: string; tag?: string } }
      | { type: 'destroy'; params: { tag: string; count: number } }
      | { type: 'survive'; params: { seconds: number } };
    spawns?: Array<{ archetype: string; count: number; at: { x: number; z: number }; tag?: string }>;
    stealth?: boolean;                         // being spotted by a cat starts `alarm` spawns
    alarm?: Array<{ archetype: string; count: number; at: { x: number; z: number } }>;
    checkpoint?: boolean;                      // a squad wipe after this step restarts here
    barks?: string[];                          // one-liners shown/spoken when the step starts
  }
  ```
  A2 added optional, backward-compatible fields (documented in the `chapters.ts` header):
  - `start.y` (an elevated start: humans up there, pups on the ground below) and `pups` (pup kits, featured first);
  - `reach.params.minY` / `maxY` (feet on the roof, not in the room below) and `interact.params.minY` / `item`;
  - `ChapterStep.vehicles` (karts parked for a step, re-parked after a wreck), `raise` (barricades raised when the step
    completes) and `rally` (where the squad regroups);
  - `ADVENTURE_ITEM_IDS` = catnip, tennis_ball (append only).

  After 120 s on one step, the human-only rules (vehicle, airborne, roof height) relax, so no player is stuck without
  the kit.
- **As built** (Wave 4): all six chapters. Row 6's "take the RC plane" is a `reach { vehicle: true }` at the hangar pad:
  E at the hangar vends the plane and E at the plane boards it.
- **State** `sim.state.adventure`: `{ chapter, step, phase: 'briefing'|'live'|'complete'|'failed', progress,
  counters, startTick, checkpoint }`. It is folded into `MatchState` (`objective` text; `wave` = step index + 1;
  `timeLeft` = survive countdown).
- **Events**: `score` with reason `step` / `chapter`, and the existing `bark` events. The client shows the intro
  and outro captions and the chapter-complete card (time vs par, medal).
- **Progress (client, cosmetic)**: `localStorage` `cvc.adventure` = `{ unlocked: n, medals: {id: 'gold'|'silver'|'bronze'} }`.
  It never gates anything the authority decides.
- **Menu**: the MATCH selector gains **ADVENTURE**, a chapter picker with lock states. Online co-op uses the same
  room flow (`?mode=adventure&chapter=…`). The server keeps only known chapter ids (unknown or missing → chapter 1),
  so a room lists the chapter it really runs.
- **After a chapter** (`afterChapter` / `roomChapterAfter` in chapters.ts): offline, the card offers NEXT CHAPTER and
  REPLAY; after the finale it reads THE END with MAIN MENU and REPLAY. An online room moves on by itself after the
  card's countdown, and after the finale it goes back to chapter 1.

## Design rules (game-design-psychology)
- **First success inside 60 s** in chapter 1 (reach the kiosk). Every step ≤ 2 min for a new player.
- **Fail forward**: a squad wipe restarts the current checkpoint after a 3 s beat; no chapter restart from zero.
- **Readability**: one objective marker at a time (the S1 beacon), plus a step counter. Stealth shows the sentry
  cones.
- **Variety**: each chapter introduces one mechanic and reuses at most two earlier ones.
- **Bots help, never steal the win**: squad bots follow objectives, but a human (if any) triggers every
  interact step.
