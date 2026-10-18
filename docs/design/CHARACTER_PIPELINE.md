# Character pipeline: the CHAR standard for Corgis vs Cats

**Status: PROPOSAL, 2026-10-18 (task #75). Nothing in it is adopted, started or accepted.** The studio standard
(game-character-production v2 and game-character-benchmark) was uploaded for task #75. Its adoption here waits for
lead and owner sign-off. CHAR itself is **PARKED** until a GPU or a hosted key exists (docs/design/AAA_PLAN.md:63-64,
owner decision 3; NORTH_STAR.md:47-51). Nothing below runs before OD-0. The pets stay the W14 PLACEHOLDER models until
a receipt says otherwise (§8.3).

**Precedence.** Owner and lead rulings come first. Then MASTER_PLAN.md, ARCHITECTURE.md and PROGRESS.md (AGENTS.md)
and the NORTH_STAR and AAA_PLAN decisions. Then this overlay, then the standard. Godot wins any clash with the twin
(NORTH_STAR.md:5). Existing controllers, file formats and owners stay authoritative (MASTER_PLAN.md:281-284). Nothing
here lowers a bar of the standard.

**Words.** *Director* = the owner. *Receiver* = the twin: it adopts an accepted release and proves its own
integration. *Cohort* = the ledger rows that share one profile hash. §1-§9 follow the steps of the standard's project
outline.

| File (all proposed) | What it is |
|---|---|
| `assets/characters/{corgi_rifleman,cat_rifleman}/contract.json` | The requirements (contract 0.1.0, `requirements_draft`). Every number is a record with its basis. The values live there, not here. |
| `assets/characters/receipt.template.json` | The gates, each with its command, whether it runs here, and its pass rule |
| `tools/assets/check-char-contract.mjs`, `tests/unit/char-contract.test.ts` | The checker (§8.2) and its Vitest test (`gate:fast`) |
| `docs/qa/char/ROUTES.md`, `docs/qa/char/benchmark.csv` | The dated tool record, the pilot plan and the route ledger |

Code is cited at f7f45b5. look.gd is also cited by symbol, because the AAA lane is editing it.

## 0. Owner decisions (open)

Until a decision is made, its fields stay `proposed` or `null`. The checker then refuses an agreed contract and any
production acceptance (§8.2, rules 4 and 6).

| ID | Decision | Proposal | Blocks |
|---|---|---|---|
| OD-0 | **Unpark CHAR for a CPU-authored route.** This amends AAA_PLAN decision 3 and NORTH_STAR §5. | Owner call. If yes, this pipeline absorbs task #43 (the character GLB path). Task #42 (Grok multi-view) stays pending, and Grok spend stays CLOSED. | every card and route below |
| OD-1 | **Body family.** The hero refs, MASTER_PLAN.md:133 and K2 show an upright biped. NORTH_STAR.md:49, the W15 sheets and the PLACEHOLDER show a quadruped. | Quadruped (it passed the 30 m read). An upright ruling means a new contract version and profile. | `body_family`, rig, clips, contacts, routes |
| OD-2 | **Armour colour.** The hero refs' ochre armour with team trim reproduces the twin's failed 30 m team read. | The team colour is the plate field; ochre is trim. The `A2` floor stays at the PLACEHOLDER's own floor or above. | A2, C2 |
| OD-3 | **Budgets.** LOD0 20k (NORTH_STAR.md:50) or 6k / 3.5k (MASTER_PLAN.md:146). Also: target hardware (the "reference desktop" has no spec), the p95, CPU-animation and overdraw budgets, slip and mount-gap tolerances, and web-variant size against the 5 MB download (MASTER_PLAN.md:304). | Every budget is `proposed`; each one says where its number came from, or "designer proposal, no measurement". | acceptance |
| OD-4 | **Clips.** Sprint, turns, jump, Fire as a clip or a procedural recoil, and whether Death may play while death hides the model (pet.gd:209). | `required_clips`, plus `proposed_extra_clips`. | clips, M7, M8 |
| OD-5 | **Forward axis.** Kits face +Z (ASSET_PIPELINE.md:31). Characters face −Z (MASTER_PLAN.md:146; pet_model.gd:17; pet.gd:4). | Deliver +Z with a 180° turn on a *child* of `Model`, never on `Model` itself: pet.gd:185 and :147 overwrite its yaw and height every frame. Sockets are given in both spaces. | delivery, adapters |
| OD-6 | **Hitbox vs form.** The corgi head lies outside its hitbox, and no part of either pet sits in its headshot band (inferred from code numbers). | Record it in `controller_fit`; any change is a gameplay card. | controller_fit |
| OD-7 | **Rights.** Readings needed: the W15 xAI clause (UNVERIFIED); uploads of project images; DINOv3/SAM trade controls; RMBG-2.0 and nvdiffrec/nvdiffrast; Meshy §2.9 and Scenario §4.6 training; which Tripo channel (CN platform: Alipay, jurisdiction, terms) and its terms; Tencent's hosted terms; Truebones redistribution. | Nothing is uploaded and no licence is assumed cleared. | rights_provenance, R2-R6 |
| OD-8 | **Spend and caps.** No vendor key exists, and none may be invented. Grok stays CLOSED. GPU rental and Truebones ($99) are spend. Candidate, time and cash caps are set per route. | No spend. Proposed caps are in ROUTES.md §H. | R2-R6 |
| OD-9 | **Review.** Are an independent reviewer and a director decision required? | Both (`visual_acceptance.review_policy`). | acceptance |
| OD-10 | **Corgi multi-view references.** The corgi has no admissible set (PATH B, docs/qa/w15/ART.md:9). | None now; new images are spend. | corgi on generated routes |
| OD-11 | **Which reference governs what.** | Hero refs govern materials, light, grooming and wear. The W15 sheets and pet_model.gd govern form, proportions and paint layout. | identity, criteria |
| OD-12 | **Where manual art lives** under "scripts are the source, no .blend" (tools/assets/README.md). | As hashed data files the build reads and never regenerates over (§5). | editable production |

For the lead (not owner calls): ASSET_PIPELINE.md:21 and docs/qa/w15/ART.md still say Scenario is network-denied. On
2026-10-18 it answered with a vendor 401, so the block is now the key. tools/aaa-30m.mjs is uncommitted and must land
before `team_read_30m` can be a gate.

## 1. Project profile

The contract holds it: `camera.engine_profile` (Godot 4.7.2, Forward+ and Compatibility, 1280x720), `camera` (play
fov 72 at arm 3.2 m, aim fov 50 at 2.1 m, near plane 0.05 m), `camera.lighting_and_exposure_profile` (look.gd at
f7f45b5 by sha256 and symbol) and `controller_contract`. That last one covers capsule, hitbox, headshot band, aim
heights, mount, Muzzle, facing, death, respawn, step-up, the camera rig and the twin's Avatar members.

There is one role profile, `hero_body:quadruped_rifleman`: the Corgi Company rifleman first, then the Cat Cadre
rifleman. Bots use the same assets. The character is render only: the sim and pet.gd own motion, collision, hits,
aim and timing (pet.gd:2-4). Clips play in place.

## 2. Existing-source audit (2026-10-18)

ROUTES.md §A records it. The Godot PLACEHOLDER is the last shipped asset: W14 READ3 PASS, pre-standard, not
`production_accepted`. It is the baseline (R0a) and the fallback. Its limiting defect is motion, not surface: no
skeleton, skin, UVs or clips, so it slides and vanishes on death, and its rifle floats. K2 (R0b) is a biped with
trim-only team paint. The shared-GLB pipeline is proven for static kits only. Engine limits verified in source: three
0.186.1 skins with 4 influences and strips '.' from bone names; Godot 4.7.2 imports 8 influences. So one shared GLB
targets 4.

## 3. The contract

The contracts fill the standard's template and add `contract_version`, `changelog`, `body_family`,
`controller_contract`, `acceptance.receiver_gate_ids`, `visual_acceptance.receiver_criteria`, `clip_table`,
`lod_selection` and `delivery.manifest_rule`. Requirements live in the contract. Measured results live only in
receipts.

- **Records.** Every number that is a requirement is `{ value, status: proposed | agreed, basis }`. That covers every
  budget, `body_family`, every criterion and contact threshold (`{ metric, op, value, … }`) and the review policy. A
  basis cites a measurement or a source, or says "designer proposal, no measurement". Comparisons never sit in
  criterion prose.
- **Production vs receiver.** `blocking_criteria` use the Godot configs only (`compat`, `fplus`). The twin's numbers
  are `receiver_criteria` P1 and P2 under `engine_parity_twin`.
- **Views.** V30 (aaa-30m), V60, V10, V3 (own pet at both arms), VH (hero bust), plus motion M1-M8 and the DT10
  captures (`visual_acceptance.motion_sequences`). Every piece of evidence names hashes, engine, renderer, camera and
  conditions.
- **LOD** is chosen by projected height h, never raw distance (`budgets.lod_switch_projected_height_px`,
  `lod_selection`). The rule is mirrored GDScript/TS code with a parity test, in the pattern of kit-cover.test.ts.
- **Rig.** `cvc_quadruped` v1: one family and two immutable species releases. Names use `[A-Za-z0-9_]`, one skin,
  at most 4 influences, and rigid single-bone plates. `identity.proportion_landmarks.part_map` lets the read tests
  find parts on a skinned mesh.

## 4. Route and rights

The route order is the standard's cheapest first: improve an existing source, then a cleared base, then authored
work, then an evaluated generated candidate. ROUTES.md has every tool, dated, with its primary sources.

1. No invented keys. Spend, uploads of any project image, GPU rental and asset purchases need the owner's written
   approval and a hard cap (OD-7, OD-8). A research route authorises neither. Grok stays CLOSED.
2. A licence chain is read component by component: code, weights, preprocessors, exporters and output terms. "MIT"
   on a repository clears nothing it loads. TRELLIS.2 loads DINOv3 and RMBG-2.0 (even for pre-matted inputs, unless
   patched), exports through nvdiffrast and lists nvdiffrec, all of them with non-commercial or trade-controls terms.
3. Nothing shipped, linked or served may carry non-commercial terms or a territory exclusion that covers players.
   The AGPL rule is proposed, generalising AAA_PLAN decision 1 (AAA_PLAN.md:59-61): an AGPL tool may run offline only,
   fetched by script and never committed, with the owner's sign-off.
4. The owner reads, before use: trade-controls clauses naming guns (DINOv3, SAM); vendor training clauses (Meshy
   §2.9, and Scenario §4.6 for any self-serve content); output ownership (Tripo free tier); the xAI clause.
5. Never copied: either W15 rifle design, illegible marks, real brands or insignia.
6. Every version, setting, seed and input/output hash is recorded in the manifest provenance and the ledger.

## 5. Editable production

- **Scripts are the source** (tools/assets/README.md). There are bpy build scripts and no .blend. Where byte identity
  fails, the receipt says so and compares results.
- **Manual art is never overwritten** (OD-12). Sculpt, weights, corrective shapes and keyed motion are hashed data
  files the build reads. Generated outputs stay unedited under `assets/incoming/<asset>/`.
- **Rigify**, if used, is the authoring control rig only. It is regenerated by a pinned script from a hashed metarig
  data file. Keyed control-rig actions are hashed key tables. Both regenerations are listed in the receipt's
  `tool_versions`. Its DEF bones are copied to a clean game armature with no B-bones, which is baked and exported.
- **Order of work.** The blockout comes first: primary forms at V30 and V3 in simple shading, recorded as
  `design_form.blockout_checkpoint`. Then skeleton, weights and the deformation and contact tests. Then materials,
  fur and clip polish.
- **Armour.** Rigid plates, each weighted 100% to one bone, overlapping by at least their travel. Every team-read
  feature of 0.15 m or more sits on a plate.
- **Materials.** The kit contract: baseColor with the paint mask in alpha, ORM, normal, core glTF only. AO is baked at
  cavity scale. Wetness is a runtime layer.
- **Fur by projected size.** Clumps and a baked normal everywhere. Cards and fins only at LOD 0-1 (they are budgeted
  as `transparent_overdraw`). No strand systems.

## 6. Delivery and adapters

- **Files.** `assets/masters/Char_{Corgi,Cat}_Rifleman.glb` (PNG textures; Godot imports it). The web variant
  comes from `make-web-variant.mjs`: meshopt plus WebP at 1K or below. KTX2 is not built; it would be a lead card
  (CHAR-KTX2) covering the encoder, KTX2Loader, download size and deps. The `assets/manifest.json` entry records the
  receipt path and its sha256, and the receipt names the export hash.
- **Export recipe** (to re-verify on the pinned Blender: bpy 5.0.1 or 5.2.2, card CHAR-PIN). ACTIONS mode, Always
  Sample, Deform Bones Only, 4 influences, Use Rest Position, no leaf bones. No constraints, drivers or B-bones.
  `socket_rifle` is deform-flagged with zero weight. The master stays uncompressed; Godot rejects meshopt.
- **Adapters.** Godot: AnimationTree, a BoneAttachment3D (copy mode) on `socket_rifle`, Look/Aim modifiers and
  SpringBoneSimulator3D. The twin: GLTFLoader, `SkeletonUtils.clone` and AnimationMixer behind the unchanged Avatar.
  The data files they share: the clip table (`assets/characters/cvc_quadruped.clips.json`, card CHAR-CLIPS) and the
  LOD rule (`lod_selection`).
- **Touches other lanes (cards go through the lead).** These belong to other lanes:
  - validate-glb.mjs and tools/godot/validate_glb.gd (CHAR-VAL);
  - test_read_pets.gd (CHAR-READ; its meta assert at :52-53);
  - pet.gd and pet_model.gd (G-GAME: the adapter; rifle.position at pet.gd:91 becomes bone-relative);
  - test_hud_hits.gd:146 ("PLACEHOLDER PETS");
  - tools/aaa-30m.mjs (QA-30M, uncommitted: the matte adapter);
  - avatar.ts and package.json (lead-owned);
  - slab-hud.ts and slab-pet.ts (TW-PETS).

  A separate defect for the lead: test_read_pets.gd:19 assumes exposure 1.25, but look.gd sets 1.5.

## 7. Proof: the gate map

The commands and pass rules are in `receipt.template.json`. "Runs here" says only what was measured on this machine.
Tools that are still cards are marked *not built, unmeasured*. Other lanes render here: Blender, Godot and aaa-30m
jobs run only in a quiet window, and only after OD-0. Software rasterisers never prove frame times.

| Gate | Standard gate | Runs here (2026-10-18) |
|---|---|---|
| `design_form` | Design/form | CHAR-READ: not built, unmeasured. Stills: quiet window |
| `structural` | Structural/export | validate-glb runs (static kits). Character rules (CHAR-VAL): not built, so it cannot pass yet |
| `fresh_import` | Structural (fresh import) | run.sh measured for static kits only. A skinned or animated import is unmeasured. Never inherited |
| `deformation_contact` | Deformation/contact | CHAR-POSE: not built, unmeasured (textures stripped or skinning done without a DOM). Pose sheet: quiet window |
| `motion_visual` | Motion/visual | Godot captures on llvmpipe in a quiet window (fixed rate): M1-M8, DT10. Feel needs a human on a real GPU |
| `runtime_performance` | Runtime/performance | **unsupported**: no GPU. A human runs it on the target hardware, against a live R0a baseline in the same session. Never inherited |
| `rights_provenance` | (project; standard §9) | paperwork; sign-offs are owner actions |
| `controller_fit` | (project; SKILL step 4) | test_char_fit.gd: not built, unmeasured. Includes DT10 and the Avatar map |
| `team_read_30m` | (project; the 30 m bar) | `aaa-30m --configs compat,fplus` (a lane tool, uncommitted). Matte adapter not built |
| `lod_identity` | (project; standard §8 LOD) | aaa-30m per forced LOD, Godot configs; the LOD parity test is not built |
| `species_read` | role-specific | renders in a quiet window. The numeric part needs CHAR-READ |
| `quadruped_gait_contact` | role-specific contact | CHAR-POSE: not built, unmeasured |
| `engine_parity_twin` | Adoption (receiver) | Node and SwiftShader; a GLTFLoader load of a skinned master is unmeasured |
| `face_speech` | role-specific | `not_applicable`, justified: closed mouths, no face rig |
| director decision | standard §7 | an owner action |

A missing output, a parser error or an aborted run is `fail` or `not_run`, never a pass. Evidence goes under
`docs/qa/char/<asset>/<export sha256 first 8>/`.

## 8. Acceptance and iteration

### 8.1 Statuses and order

The statuses are `pass`, `fail`, `not_run`, `unsupported`, and `not_applicable` with a justification. A required gate
must `pass`; `not_applicable` is only for a gate that is not required. `runtime_performance` is `unsupported` here,
so **no character can be accepted from this machine alone**. Godot decides production. The twin adopts afterwards,
through its own gate: it never holds acceptance back, and it never stands in for a Godot gate. Results stay
separate: a structural pass proves no deformation, and a capture proves no feel.

### 8.2 The checker

`node tools/assets/check-char-contract.mjs <file.json>... [--contract <c.json>] [--against <old.json>]`, or
`--profile-hash <c.json>`. Exit 0 means clean, 1 means errors, 2 means usage. It checks structure and acceptance logic
and opens no art. Its seven rules are in its header. Each sub-check is pinned by a failing copy in the test. A mutation
run on 2026-10-18 broke the checker and the shipped files one point at a time (151 mutants); the test failed for every
one. In short:

- **Acceptance** needs `--contract`. With it, the checker requires:
  - every required gate `pass`;
  - the five core gates;
  - the hashes, tool versions and engine and family profile;
  - a director decision equal to the contract's;
  - named reviewers;
  - an agreed contract with no open item: no proposed record anywhere, and no null where a decision is due.
    `{ "not_applicable": "<reason>" }` decides a field.
- **The twin adopts** only this exact accepted export, through a passed gate of its own.
- **With `--against`**, any change to a requirement field needs a higher `contract_version` and a changelog entry that
  names the changed path. A limit is never silently rewritten.
- **The profile hash** follows every requirement value, the engine version and the lighting hash. It ignores prose.

### 8.3 The PLACEHOLDER rule

Godot's tags are model meta `placeholder`, the HUD "PLACEHOLDER PETS" and the --debug label
(`controller_contract.placeholder_rule`). They go only with a receipt for that exact export that has
`production_accepted: true` and passes with `--contract`. The twin's `SLAB_PLACEHOLDER_TAG` goes only with an adopted
receiver proof. The W14 files stay as the fallback until the replacement has shipped in a release.

### 8.4 Iteration and selective rebuild

Fix the highest player-impact defect first: the 30 m team and species read, then sliding, the floating rifle and the
vanishing death, then deformation at V3, then materials and fur. Change the smallest responsible source. After two
comparisons with no progress, change strategy or ask a specialist. The last shipped asset stays meanwhile.

| Change | Rerun | Normally keep (only if the receipt names the prior result and the unchanged hashes) |
|---|---|---|
| Geometry or UVs | bakes, structural, fresh_import, design_form, deformation_contact, quadruped_gait_contact, controller_fit (hitbox report, rifle clearance), team_read_30m, species_read, lod_identity, motion_visual, runtime_performance, twin | rights; clip data |
| Skeleton, bind or proportions | weights, structural, fresh_import, both contact gates, controller_fit, design_form, species_read, lod_identity (LOD rigs), team_read_30m, motion_visual, runtime_performance (bones), twin; the other species' release only if the family changed | texture content |
| Clip keys or timing | structural (clip table), fresh_import, quadruped_gait_contact, deformation_contact, species_read (cues in motion), controller_fit (aim-pitch clearance), lod_identity, motion_visual, runtime_performance (CPU animation), twin. Also team_read_30m and design_form, unless the receipt lists the hash of the pose aaa-30m renders, unchanged | geometry, UVs, bakes |
| Palette, paint mask or textures | team_read_30m, species_read, lod_identity, motion_visual, runtime_performance (texture memory, overdraw), twin | geometry and rig gates |
| Runtime adapter or shader (one engine) | that engine's motion_visual, team read and parity rows; runtime_performance | the shared master and its structural gates |
| Lighting (look.gd) | a new lighting profile, so a new contract version: team_read_30m, species_read, lod_identity, motion_visual (A4), controller_fit (emissives below glow) | the asset's structural gates |
| New family or skeleton release | every consumer of the changed contract | frozen old releases until a receiver adopts |

Any change to triangles, bones, materials, textures or clips reruns `runtime_performance`. `fresh_import` always
runs on the new export. A changed contract, toolchain or test condition ends inheritance.

## 9. Publish and continue

A release holds:
- the scripts and manual-art data, the contract, the rights record, the clip table, socket map and `rig`;
- the master and web variant with LODs, the manifest entry, the receipt, the known defects and the adapter needs.

Base and skeleton releases are immutable. Publishing a release and a project adopting it are separate actions.

**First increment, after OD-0:** the corgi rifleman first. It has the hardest cue (E/H) and no multi-view set, so it
is the honest test of the authored route. Then the cat rifleman (the same family, its own release and its own
locomotion clips). Only then the cast.

**Proposed cards for the lead; nothing starts while CHAR is parked.**
- CHAR-PIN: one Blender for the family.
- CHAR-SMOKE: one headless test-skeleton export, then validate-glb, run.sh and a GLTFLoader load, all measured.
- CHAR-VAL, CHAR-POSE, CHAR-READ and test_char_fit.gd.
- CHAR-CLIPS and the LOD parity test.
- The aaa-30m matte adapter.
- CHAR-KTX2 (optional).

Later iterations inside an agreed contract do not ask again for permissions already granted.

## 10. Project additions (none lowers a bar)

- **Explicit `design_form`.** The standard lists the gate, but its template omits it.
- **New gates:** `team_read_30m` (with a per-number regression rule against the PLACEHOLDER), `species_read`,
  `quadruped_gait_contact`, `controller_fit` (camera rig, Avatar map, hitbox report), `rights_provenance` and
  `lod_identity`.
- **`engine_parity_twin` as a receiver gate,** so browser parity never certifies Godot.
- **Requirement records with a version and changelog,** so "never rewrite a limit to match a failing measurement" is
  checked.
- **Measured results checked against budgets** beside the pass of the gate that measures them.
- **An explicit `director_decision.required`,** bound to the contract.
- **4 influences, a bone-name charset, one skin, rigid plates, a self-lit team band below the glow threshold, a
  shared clip table and h-based LOD.** All of these follow from the engine limits in §2 and the 30 m read.

## 11. Sources

Repository files are cited inline at f7f45b5. Engine, format and tool sources (all accessed 2026-10-18) are in
docs/qa/char/ROUTES.md §J and §A-§F.
