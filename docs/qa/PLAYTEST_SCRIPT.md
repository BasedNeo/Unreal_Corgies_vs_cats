# Playtest script — the human queue test (30–40 minutes)

Bots and headless probes can't answer the one question that matters (MASTER_PLAN §1):
**"Would I immediately queue another match?"** This script turns one session into answers the team can act on.
Write the verdicts into `PROGRESS.md` → "Human verdicts". Any finding there pre-empts lane work.

## Setup (once)
```bash
git clone … && cd Unreal_Corgies_vs_cats && git checkout claude/practical-johnson-uh8g33
npm install
npm run dev            # http://localhost:5173 → main menu → PLAY (offline: you + 2 corgi bots vs cat waves)
```
- Use a real GPU browser (Chrome/Edge; WebGPU where available). Note your fps from the top-left corner.
- Online with a friend on your LAN: run `npm run start`, then both open `http://<your-ip>:8787/?room=test`.

## Controls
| Key | Action |
|---|---|
| WASD | move |
| Space ×2 | double jump |
| Shift | sprint ("zoomies") |
| Mouse | aim + fire |
| RMB | aim down |
| Q | ability |
| R | reload |
| E | interact (kiosk, kart, mission) |
| G (pad: D-pad down) | hold to aim a throwable (arc preview), release to throw |
| C | crouch: while sprinting it slides; in the air it ground-pounds |
| Enter / T | chat |
| B | taunt |
| Tab | scoreboard |

## Run it (about 5 minutes each, and note anything that surprises you)
1. **First 60 s, cold (Assault).** Don't read anything first. The first-match tips appear bottom centre. Do you know
   what to do? When did you first feel good (a kill, a jump, a hit sound)? When did you first die, and was it fair?
2. **Skirmish to the end** (MATCH: SKIRMISH). Waves 1–5, with the Vac-Tank boss in wave 5.
   - Is wave 1 gentle?
   - Does the boss read as a set piece?
   - Did your pups help or get in the way?
3. **Every class (E at your Ordnance Kiosk, then 1–6).** Use each Q ability at least twice:
   - bark blast;
   - Shadow Cloak (hide in the Garden's tall grass too: HIDDEN tag);
   - Spotter Drone: enemies get marked; you see SPOTTED when theirs sees you;
   - Dig Charge;
   - Squeak Barrier;
   - Ear Glide: jump, jump, then Q in the air.

   Which kit felt best, and which felt pointless?
4. **The yard.**
   - Grab an Upgrade Core and a Golden Kibble.
   - Follow the Squeaker mission card.
   - Drive the mower kart (E at the Kart-O-Matic).
   - Climb to the garage Rooftops (crates on the west side, scaffold at the back) and snipe from a perch.
   - Fight inside the Garage.
5. **Team deathmatch** (MATCH: DEATHMATCH, 4v4). Does it feel even? Can you tell the cat classes apart at range?
6. **Core Rush** (MATCH: CORE RUSH, 4v4). Take and hold the A/B/C pads. Is it clear what to do, and does holding
   feel tense?
7. **Adventure** (MATCH: ADVENTURE → chapter 1, then 2).
   - Chapter 1 "Yard Day": do you reach the first objective inside a minute?
   - Chapter 2 "The Tall Grass": can you sneak past the sentries' cones? If you get spotted, is the alarm fair?
   - Is the chapter card (time vs par, paw medal) worth replaying for?
   - Chapter 7 "Night Shift at The Lot" (unlocks after chapter 6; to jump straight there, open
     `http://localhost:5173/?mode=adventure&chapter=night_shift&autoplay`): slip through the Pipeworks past the sentries at night. Is the route
     readable in the dark? Did a sentry spot you from farther away than its cone suggested?
8. **New toys.**
   - Climb to the garage roof and E at the Rooftop Hangar: fly the RC plane (mouse steers, W/S throttle, Shift
     boost, E bails out). Does it feel good? Crash it into a wall once.
   - As a Breacher, plant a Dig Charge against the boarded wall on the Garage's alley side, then shoot the tuna-can
     stacks inside.
   - Duel the sniper elite with `?boss=madame_pointille`. Watch for the red dot, and hit the lens when it glints.
9. **Base Assault** (MATCH: BASE ASSAULT, 4v4), on the West Yard and then MAP ▸ THE LOT.
   - Steal the cats' squeaky ball from its stand by their flag, run it to your own ring. Do you know what to do without
     reading? Does carrying it (slowed, no gliding, no karts) feel tense or just slow?
   - Let a cat steal yours: can you tell where it is (the beacon, the HUD strip) and chase it down?
   - Is either side of the map easier to win from? (Bots were tuned to 50 / 50 on the West Yard.)
10. **Throwables** (G). Throw a Squeaker Grenade (corgi) or a Hairball Bomb (cat) at a group. Does the arc preview land
   where it shows? Can you see and dodge one thrown at you (the blinking and the red ring)? Restock at your kiosk.
11. **The Lot** (MAP ▸ THE LOT, any mode): the pit, the scaffold, the Canyon, the Pipeworks, the rain that comes in after
   a minute or two. Is it readable at night? Do the side lanes get used? Inside a pipe or container, can you still
   tell a corgi from a cat (a known risk: they read near-black in SwiftShader)?
12. **The hardened look.** Characters in plate armour, the dusk light, floodlights, rain. Three things to judge on a real
   monitor: is daytime too bright, are The Lot's tunnels and containers too bright inside, and does the storm view from
   above read? In Yard Skirmish from wave 2, meet the alley-cat raiders (fast flankers) and the tabby heavies (a bin-lid
   shield: go round it).
13. **After every match: the awards card.** 3–5 comic awards (BEST IN SHOW, GUARD DOG, LOB STAR…) hold the
   scoreboard open. Did you read them? Did one make you want to play for it next match? Does the kill feed show the
   grenade / hairball glyph when a throwable gets the knockout?
14. **Listen (Base Assault, then The Lot in the rain).** With sound on: can you tell a steal by us from a steal by them
   by ear alone (the ball's squeak and the bugle call)? Do you notice the heartbeat while a ball is on the move? Do
   you hear a grenade's fuse tick over a firefight? Is The Lot's rain / crane / floodlight hum too loud or too busy?
15. **Online (optional).** Run `npm run start`; a friend opens `http://<your-ip>:8787`, then ROOMS ▸ lists your
   room. Try chat (Enter).

## Answer (1–5, plus one sentence each)
| Question | Score | Why |
|---|---|---|
| **Queue test:** would you immediately play another match? (yes/no) | | |
| Moment-to-moment feel (moving, jumping, shooting) | | |
| Abilities (which kit is best / weakest) | | |
| Core Rush (clear? tense?) | | |
| Base Assault (clear? tense? fair on both maps?) | | |
| Throwables (arc honest? dodgeable? fun?) | | |
| The Lot (readable? lanes used?) | | |
| Adventure (chapters 1–2 and 7: clear? replayable? readable at night?) | | |
| Awards card (read it? want to earn one?) | | |
| Sound (steal / capture calls, heartbeat, fuse tick, Lot ambience) | | |
| RC plane / breach / sniper duel | | |
| Readability (who is who, what hit me, where to go) | | |
| Difficulty (1 = too easy, 3 = right, 5 = too hard) | | |
| Look (hardened style, characters, yard, The Lot; daytime and interiors not too bright?) | | |
| Performance (fps, hitches) | | |
| Most fun moment | — | |
| Most annoying moment | — | |
| One thing to change first | — | |
