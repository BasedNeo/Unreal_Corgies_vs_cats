# Playtest script — the human queue test (20–30 minutes)

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
| C | crouch: while sprinting it slides; in the air it ground-pounds |
| Enter / T | chat |
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
7. **Online (optional).** Run `npm run start`; a friend opens `http://<your-ip>:8787`, then ROOMS ▸ lists your
   room. Try chat (Enter).

## Answer (1–5, plus one sentence each)
| Question | Score | Why |
|---|---|---|
| **Queue test:** would you immediately play another match? (yes/no) | | |
| Moment-to-moment feel (moving, jumping, shooting) | | |
| Abilities (which kit is best / weakest) | | |
| Core Rush (clear? tense?) | | |
| Readability (who is who, what hit me, where to go) | | |
| Difficulty (1 = too easy, 3 = right, 5 = too hard) | | |
| Look (toon style, characters, yard) | | |
| Performance (fps, hitches) | | |
| Most fun moment | — | |
| Most annoying moment | — | |
| One thing to change first | — | |
