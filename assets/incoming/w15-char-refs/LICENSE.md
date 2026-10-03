# W15 character reference sheets: source, terms and status

**Status: REFERENCE ONLY, NOT SHIPPED.** These images are design references for a future character-mesh step. Nothing
in the game loads them, they are not in `assets/manifest.json`, and the in-game pets stay the PLACEHOLDER models of
`engines/godot/game/pet_model.gd`. Before anything derived from them ships (a texture, a decal, a mesh), re-check the
terms below and record it in the manifest (MASTER_PLAN §0: every external asset records source, licence and version).

- **Corgi (PATH B):** the corgi images are design and material references only, NOT image-to-3D inputs. The corgi's
  proportions come from `condition/*_fit.png` and `condition/rig.json`.
- **Cat (PATH A):** the cat's four main views were measured against the placeholder (docs/qa/w15/ART.md).

## Source
| What | Value |
|---|---|
| Generator | xAI Grok Imagine image API: `POST https://api.x.ai/v1/images/edits` (image to image) and `/v1/images/generations` (text to image) |
| Account | The owner's xAI API account. The environment's proxy authenticated the requests; no key is stored in this repo or in any file here |
| Dates | 2026-10-01 (calls c001–c025) and 2026-10-03 (the W15 patch, c026–c045), UTC; each call's time is in `ledger.jsonl` |
| Models | `grok-imagine-image-2.0` (all 16 kept images; quality `medium`); `grok-imagine-image` (two test calls, nothing kept) |
| Inputs | Prompts in `PROMPTS.md`. Image inputs: the project's own Godot renders of its placeholder pets (`condition/`, by `engines/godot/tools/ref_rig.gd`); the API's own earlier outputs; and proportion guides (crude warps of those outputs, made by `tools/art/w15-guide.py`, never delivered) |
| Provenance | `ledger.jsonl` (call, prompt id, `prompt_sha256` from c026, inputs with sha256, raw and delivered sha256); `raw/` (the 16 kept raw downloads, byte for byte); `provenance/*.c2pa.json` (each raw file's embedded C2PA manifest store) |
| Cost | $6.412 of the owner's $12.00 cap (`LEDGER.md`) |

**C2PA.** Every raw download carries a C2PA manifest signed by "xAI Grok Imagine":
- action `c2pa.created`;
- source type `trainedAlgorithmicMedia`;
- author "SpaceXAI".

The claim signature and the data hash validate. The signing credential is a self-signed ephemeral certificate, so a
reader reports `signingCredential.untrusted`. The manifests record no ingredients, and the edits are labelled
`c2pa.created` too, so the ledger is the only record of which images went into each edit. The delivered JPEGs are
re-encodes and carry no C2PA data; the files in `raw/` keep it.

## Terms
The output is used under xAI's terms of service. API use is governed by xAI's **Enterprise Terms of Service**. The
docs FAQ ("Where are your Terms of Service and Privacy Policy?", https://docs.x.ai/developers/faq/general) points to
https://x.ai/legal for the Enterprise Terms of Service and the Data Processing Addendum.

The clause on output ownership, at https://x.ai/legal/terms-of-service-enterprise:

> "Customer owns all right, title, and interest in the Output in perpetuity and, to the fullest extent possible under
> applicable law, SpaceXAI hereby assigns to Customer all of its right, title, and interest in such Output (but
> excluding, for clarity, the SpaceXAI Technology)."

**UNVERIFIED: the owner must check it.**
- On 2026-10-01 the page answered this environment with HTTP 403 (a bot challenge), and its web-archive copy could not
  be fetched either.
- The quoted sentence is the text a web search index returned for that page that day, for an exact-phrase search. A
  second search returned the same clause with "(but excluding the SpaceXAI Technology)", without "for clarity".
- The section number could not be read.
- The same search summary said the terms also forbid using Output to train AI models (unless an Order Form allows it)
  and misrepresenting Output as human-generated. That is a paraphrase, not a quote.

The owner should open the page, confirm the clause's wording and section number, and replace this paragraph. What this
use relies on: the owner's account owns the output; the images are labelled AI-generated here and in their own C2PA
data; they train nothing.

## Original IP
- Corgi Company and Cat Cadre are this project's own characters. "Pembroke-type corgi" and "grey tabby" describe animal
  types, not anyone's character.
- No prompt names an existing game, franchise, studio, film or character (see `PROMPTS.md`). Every prompt asks for no
  text, letters, numbers, logos, emblems, insignia, flags or watermarks.
- The team colours are the game's own locked signals (blue `#2f6fd6`, dark crimson from `#c9344a`). No real military's
  insignia appear.
- Rejected for legible pseudo-text: c024_1 and c025_1 (lettering on container doors).

### Illegible micro-marks in the kept images: do NOT copy them into textures
The model draws small marks that look like engraving or stencilling but read as nothing. None is legible except the
single "L" on cat_detail_armour's grip. Do not reproduce them, or anything read into them, in a texture, decal or trim
sheet: paint those surfaces clean.

Coordinates are in pixels of the raw file in `raw/`, as boxes x0–x1, y0–y1. To find them in the delivered JPEG,
multiply by 0.96 for the 1600-px-wide raws, or by 0.857 for the in-situ frames.

| Delivered image | Raw file | Where | What |
|---|---|---|---|
| corgi/corgi_detail_rifle_mount.jpg | c020_0 | 680–700, 470–495; 780–800, 510–530; 900–920, 530–550 | engraved slot and dot glyphs on the receiver |
| corgi/corgi_side_right.jpg | c026_1 | 950–970, 655–675; 995–1010, 655–670; 1045–1060, 665–680 | small ring and hook glyphs on the receiver |
| corgi/corgi_master_threequarter.jpg | c027_0 | 740–755, 650–665; 795–810, 665–680 | ring and hook glyphs on the receiver |
| cat/cat_master_threequarter.jpg | c039_0 | 770–800, 685–700 | stroke and dot marks in the receiver's side panel |
| cat/cat_detail_armour.jpg | c043_1 | 448–465, 589–615 | an engraved 'L' on the grip base plate (reads as a letter) |
| cat/cat_detail_armour.jpg | c043_1 | 475–482, 273–289 | a 'D'/'0'-like outline on the rear sight block |
| cat/cat_detail_rifle_mount.jpg | c044_1 | 650–665, 500–520 | a short vertical mark at the receiver seam |
| cat/cat_detail_rifle_mount.jpg | c044_1 | 893–920, 407–424 | a triangle glyph on the sight's rear face |
| cat/cat_insitu_wet_night.jpg | c045_0 | 1475–1530, 380–435; 1660–1710, 360–460; 435–455, 150–260 | blurred letter-like strokes on out-of-focus container doors and along the left container's edge |

Checked at 2–4× zoom over every receiver, plate face and background surface in the 16 kept images; the independent
check added the three c043_1 / c044_1 rows. The shield plates show rivets, scratches and chipped paint.
corgi/corgi_insitu_wet_night.jpg (c024_0) showed none at 2×.
