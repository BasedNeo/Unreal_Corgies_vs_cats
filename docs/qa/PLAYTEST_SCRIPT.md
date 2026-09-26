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
| Tab | scoreboard |

## Run it (about 5 minutes each, and note anything that surprises you)
1. **First 60 s, cold (Assault).** Don't read anything first. Do you know what to do? When did you first feel good
   (a kill, a jump, a hit sound)? When did you first die, and did it feel fair?
2. **Skirmish to the end.** Waves 1–5, with the Vac-Tank boss in wave 5.
   - Is wave 1 gentle?
   - Does the boss read as a set piece?
   - Did you win?
3. **The yard.**
   - Find the Ordnance Kiosk near your base (E, then 1–6) and try every class.
   - Pick up an Upgrade Core (glowing pedestal).
   - Grab a Golden Kibble.
   - Follow the Squeaker mission card (left side).
4. **Movement.**
   - Slide: sprint, then C.
   - Ground pound: C in the air.
   - Skyraider **Ear Glide**: jump, jump, then Q in the air.
   - The mower kart: E at the Kart-O-Matic.
   - Hide in the Garden's tall grass (the HIDDEN tag).
5. **Team deathmatch** (`?mode=team-deathmatch`, 4v4). Does it feel even? Can you tell the cat classes apart at range?

## Answer (1–5, plus one sentence each)
| Question | Score | Why |
|---|---|---|
| **Queue test:** would you immediately play another match? (yes/no) | | |
| Moment-to-moment feel (moving, jumping, shooting) | | |
| Readability (who is who, what hit me, where to go) | | |
| Difficulty (1 = too easy, 3 = right, 5 = too hard) | | |
| Look (toon style, characters, yard) | | |
| Performance (fps, hitches) | | |
| Most fun moment | — | |
| Most annoying moment | — | |
| One thing to change first | — | |
