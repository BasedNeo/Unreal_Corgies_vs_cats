# Character routes: dated tool evaluation record and the recommended pilot

**Record date: 2026-10-18.** Research lanes AUDIT, GENERATORS, RIG/ANIM and LOOK (task #75), then a critic and a
merge pass. Nothing was installed, run, uploaded or paid for. **CHAR is PARKED** (docs/design/AAA_PLAN.md:63-64, owner
decision 3): this record and its pilot are proposals for OD-0 (docs/design/CHARACTER_PIPELINE.md §0), not a start
order. No key exists for any vendor, and none may be invented. Versions and prices move monthly
(Meshy 7.1 shipped 2026-09-18; meshy-5 retired 2026-10-10): re-check every fact below before a pilot uses it.

The contract this record serves: `assets/characters/{corgi_rifleman,cat_rifleman}/contract.json`, role profile
`hero_body:quadruped_rifleman`, profile hash `d367f1be…` (contract 0.1.0; body family proposed quadruped, OD-1). The ledger is
`docs/qa/char/benchmark.csv`. Owner decisions OD-0 to OD-12 are defined in docs/design/CHARACTER_PIPELINE.md §0.

**Labels.**

- **Verified**: read in a primary source (the vendor's own docs, licence, model card or source code) on 2026-10-18.
- **Claim**: a vendor, author or paper statement under its own conditions (hardware, benchmark, plan), or a secondary
  source. Not reproduced.
- **Measured here**: measured on this machine on 2026-10-18.
- **Here**: what was measured on this machine. No tool is called feasible here unless it was measured here; a tool
  that only might run is "expected, unmeasured".

**This machine (measured here).** 4 shared vCPU (Xeon, AVX-512), 15 GiB RAM, no GPU (no nvidia-smi, no /dev/dri),
no torch, **1.6 GB free disk** (df /, 2026-10-18 15:11; 2.8 GB earlier that day), load average 5-10 from other render
lanes. Blender 5.2.2 and Godot 4.7.2 binaries are present. Blender 5.2.2 ran here for other lanes' renders
(docs/handoff/BL-DCC.md:10-11); the 6 Lot kit GLBs were built with bpy 5.0.1 from PyPI (tools/assets/README.md:8). Neither
was run by the CHAR lanes. Proposed machine rule: no job may leave less than 1 GB free, and no model weights are
downloaded here. Outbound HTTPS goes through a proxy. Unauthenticated requests on 2026-10-18 got vendor auth
errors from `api.tripo3d.ai` (401), `api.meshy.ai` (401), `api.cloud.scenario.com` (401), `api.hyper3d.com` (404 from
the vendor) and `hunyuan.intl.tencentcloudapi.com` (200): the network is open to them, a key is what is missing.
`csm.ai` was refused by the proxy (CONNECT 502).

## A. Existing-source routes (the baseline)

### R0a: Godot PLACEHOLDER pets

- **Sources.** engines/godot/game/pet_model.gd (sha256 6a8a297e…), look/pet_materials.gd (e8be30e4…), game/pet.gd
  (2605d674…); engines/godot/tests/test_read_pets.gd.
- **Verified.** Primitives merged per (species, team), 5 surfaces + a 2-surface rifle, 7 draws per pet; triplanar
  materials, no UVs; no skeleton, skin or clips (grep of engines/godot/game is empty).
- **Claim.** W14 READ3 PASS at 30 m; W17 AAA-30M baseline: Compatibility PASS, Forward+ one number at 14.7 against 15
  (docs/qa/w17/AAA-30M.md, uncommitted).
- **Here.** Yes (it is the game today).
- **Verdict.** The last shipped asset (W14 READ3 PASS, pre-standard; not production_accepted), kept as the fallback
  and as the existing-source baseline of every comparison. Rejected against the new contract: its rig,
  clip and gait gates cannot pass.

### R0b: twin K2 procedural kits

- **Sources.** src/client/procgen/characters (CHARACTER_VERSION 3); src/client/anim/character-animator.ts.
- **Verified.** Upright biped, one 46-bone skeleton, automatic weights at ≤ 4 influences, code-authored animation.
- **Measured here.** char-audit 24/24 PASS; GLTFExporter in Node exported a K2 corgi with a baked 1 s walk (400,360
  bytes, 2 skins × 46 joints, 92 channels, 0 warnings) in memory. Not written to disk, not imported into Godot.
- **Claim.** Twin 30 m team read FAILS (head-on ΔE 19.5; AAA-30M.md).
- **Here.** Yes (CPU).
- **Verdict.** Wrong body family for the proposed contract (OD-1) and its team signal is trim. If the owner rules
  upright, it becomes the selective-improvement baseline under a new profile, after: dotted bone names renamed, one
  skin, a +Z adapter, UVs and remodelled forms.

### R0c: TW-PETS port

- **Sources.** src/client/views/slab-pet.ts (uncommitted), docs/handoff/TW-PETS.md (untracked).
- **Claim.** Twin 30 m PASS, ΔE 57-63 (that lane's claim).
- **Verdict.** A receiver of R0a, not a production route. Listed in the ledger so its cost is not lost.

## B. Authored route

### R1: scripted Blender (bpy) rebuild (the authored reference candidate)

- **Sources.** tools/assets/kitlib.py and build scripts; Blender 5.2.2 (local binary), which bundles Rigify 0.6.10
  and the glTF exporter io_scene_gltf2 5.2.40 (files listed and read here, not run). Manuals:
  https://docs.blender.org/manual/en/5.2/addons/rigify/basics.html,
  https://docs.blender.org/manual/en/5.2/addons/scene_gltf2.html (accessed 2026-10-18).
- **Verified (source read).** Rigify ships Basic Quadruped (34 metarig bones), Cat (174), Wolf (190), Horse, Bird,
  Shark; no dog metarig. Limb rigs default to 2 segments and 10 B-bone segments (limb_rigs.py:951-960); glTF has no
  B-bones. The exporter's "deform bones only" re-parents kept bones to the nearest kept ancestor (exp/tree.py:675-713),
  so a raw Rigify export is likely several disconnected chains (inferred). Defaults: ACTIONS mode, Always Sample on,
  Bone Influences 4.
- **Here.** The static kit path is measured here (6 Lot GLBs, bpy 5.0.1, kitlib exporting with skins, animations and
  morphs off). **A skinned, animated character export is NOT measured here**: no armature, 4-influence skin, Rigify
  DEF copy, action export or Godot import of a skinned GLB has run on this machine. First step (card CHAR-SMOKE, after
  OD-0, in a quiet window): a 3-bone armature, one skinned box and one action, exported with the CHARACTER_PIPELINE.md
  §6 recipe on the pinned Blender (CHAR-PIN), then validate-glb, then tools/godot/run.sh, then a GLTFLoader load in
  Node; the result is recorded before R1 is called runnable.
- **Rights.** Blender (GPL) is a tool; its outputs are ours. Nothing third-party is shipped.
- **Unlocks.** OD-0 (unpark), OD-1 (body family), OD-2 (armour colour), OD-12 (where manual art lives).
- **Verdict.** The authored reference candidate of the pilot (the baseline is R0a). The only route with no key, no
  GPU and no spend; its character export is unmeasured until CHAR-SMOKE.

## C. Hosted generators and services

### Tripo (VAST): generation, rigging, animation

Three channels, each with its own docs, prices and terms. Nothing verified on one channel is assumed for another.

- **CN developer platform** ("Tripo 开发者平台", https://developers.tripo3d.com/en/models, /en/models/p1, /en/pricing,
  /en/docs/animations-rig.md, /en/docs/animations-retarget.md; API at openapi.tripo3d.com/v3; accessed 2026-10-18).
  **Verified there:** models H3.1 and P1 (snapshot P1-20260311: text, image or multiview; face_limit 48-20,000; PBR).
  Rig models v1.0-20240301 (biped only, the default), v2.5-20260210 (non-humanoid incl. quadruped), v3.0-20260909
  (humanoid); `spec` (mixamo, etc.) applies only to `rig_type: biped`. Retarget presets for rig v2.5: biped 11,
  **quadruped one: `preset:quadruped:walk`**, other types 4 (a research note's "16 presets" is the sum over rig types).
  Pricing: "1 credit = ¥0.07 CNY · Pay with Alipay"; H-series image or multiview 20-30 credits, P1 multiview 40-60,
  Auto Rig 25, animation 10 per clip (vendor prices under their own plan conditions).
- **International API** (api.tripo3d.ai; docs at platform.tripo3d.ai saved only as JS shells). Answered 401 without a
  key. **Not verified:** its rig model list, the quadruped preset, prices, any plan floor or minimum top-up.
- **AWS Marketplace** (https://aws.amazon.com/marketplace/pp/prodview-hwlbvx7vubh7c): lists an overage of $0.01 per
  credit. A third channel; not cross-applied to the CN credit counts.
- **Terms.** Tripo Terms §5.2 (free-tier outputs belong to Tripo, CC BY 4.0 for public models; paid users own outputs;
  no training on them) was seen only as a search snippet of www.tripo3d.ai (the page returned Cloudflare 403 here). It
  is not known to govern the developer platform.
- **Here.** Not feasible without a key.
- **Unlocks.** OD-0. The owner picks one channel (OD-7: for the CN platform also Alipay payment, data jurisdiction and
  which terms govern), the rig model list, the quadruped preset, the price per call and any plan floor are re-verified
  on it, then a key and a hard cap set from a live quote on that channel (OD-8), the live terms read, and written
  approval to upload the W15 cat views (OD-7). No dollar estimate is given here: cross-channel arithmetic is not a
  quote.
- **Verdict.** Candidate R2 of the pilot (cat first: only the cat has admissible multi-view inputs). A quadruped gets
  the walk preset only, so Idle, Plant, Fire, Hit and Death are authored anyway.

### Hunyuan 3D 3.0 / 3.1 (Tencent Cloud, hosted)

- **Sources.** https://www.tencentcloud.com/document/product/1284/75540 (doc updated 2026-05-27);
  https://www.tencent.com/en-us/articles/2202235.html (accessed 2026-10-18).
- **Read by the drafter, not reproducible on 2026-10-18** (the critic's fetch of the doc page got a 988-byte bot
  challenge, even with a browser UA): API SubmitHunyuanTo3DProJob; model 3.0 or 3.1; one image, text, or multi-view
  (3.1: up to 8 views); EnablePBR; FaceCount 3,000-1,500,000; no rig. Billing: postpaid $0.02 per credit; a one-time
  200 free Pro credits; the billing example prices LowPoly + PBR at 40 credits. Re-read all of it before any cap.
- **Not read.** The hosted service's region and output terms (OD-7). The open-weight Hunyuan 2.x licence (below) is
  not assumed to govern the hosted service.
- **Here.** Endpoint reachable (200). No account key.
- **Unlocks.** OD-0; a Tencent Cloud intl key, or a Scenario key under the Scenario §4.6 condition below (OD-8); an
  owner reading of the hosted terms; upload approval (OD-7).
- **Verdict.** Candidate R3: a mesh-quality comparator, rigged with the R1 skeleton or the R2 rig step.

### Meshy

- **Sources.** https://docs.meshy.ai/en/api/pricing, /en/api/changelog, /en/api/rigging-and-animation,
  https://www.meshy.ai/terms-of-use (last updated 2026-09-19), https://www.meshy.ai/pricing (accessed 2026-10-18).
- **Verified.** meshy-7.1 (2026-09-18); multi-image to 3D with 1-4 images; image 20-35 credits; rig 5, animation 3.
  API rigging "currently only works well with standard humanoid (bipedal) assets". Terms: free outputs are CC BY 4.0
  and Meshy's; paid customers own outputs; Meshy may train on non-Enterprise inputs and outputs unless agreed (§2.9);
  non-Enterprise API outputs are deleted after 3 days.
- **Claim.** The pricing FAQ says no training without consent (it conflicts with the Terms).
- **Here.** API reachable (401). No key.
- **Unlocks.** Pro plan or higher and a cap (OD-8); the owner accepts the training clause or buys Enterprise (OD-7).
- **Verdict.** Candidate R4, a third mesh source only; it needs another rig step.

### Rodin Gen-2.5 (Hyper3D / Deemos)

- **Sources.** https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5,
  https://docs.hyper3d.ai/en/legal/data-retention-policy (effective 2026-08-03), https://hyper3d.ai/pricing
  (accessed 2026-10-18).
- **Verified.** 1-5 images or text; tiers Gen-2.5-Extreme-Low to -High; no rig. API retention 7 days, not used for
  training. API only on the Business plan ($120 per month; $96 billed yearly).
- **Here.** Endpoint reachable. No key.
- **Verdict.** Candidate R6, an optional premium comparator, only if the owner approves the subscription.

### Scenario (aggregator)

- **Sources.** https://help.scenario.com/en/articles/introduction-to-3d-generation/,
  https://help.scenario.com/en/articles/api-usage-and-credits-creative-units/, https://www.scenario.com/pricing,
  https://www.scenario.com/terms-and-conditions (v2.1.1, 2026-07-16) (accessed 2026-10-18).
- **Verified.** One key covers Tripo (generation, rigging 1.0 biped and 2.5 non-biped), Hunyuan 3D 3.1 PRO (up to 4
  views), TRELLIS.2, TRELLIS, Rodin, Meshy, Sparc3D 2.0, Direct3D-S2, PartCrafter, SAM3D. API on paid plans only
  (Starter $15 / 1,500 credits; Pro $45; Max $75). Exact per-call cost via `?dryRun=true`. Terms: you own generated
  assets (§4.3); self-serve content may be used to improve their models (§4.6); third-party providers' terms apply
  per model (§9).
- **Here.** API reachable (401). The repo still says it is network-denied (ASSET_PIPELINE.md:21, docs/qa/w15/ART.md):
  stale since 2026-10-18.
- **Training clause.** Terms v2.1.1 §4.6: "To operate, secure, and improve the Services and our AI models, we may use
  your content". Only Enterprise MSA/DPA customers get a no-training guarantee. Uploading the W15 cat views through a
  self-serve plan would allow training on them.
- **Verdict.** One key and one ledger for R2 and R3, upstream licence chains still applying, **only if** the owner
  accepts §4.6 for the uploaded images or buys Enterprise (OD-7). That is an unlock condition for running R2 or R3
  through Scenario.

### Kaedim, Luma Genie, CSM, Seed3D

- **Sources.** https://www.kaedim3d.com/, https://lumalabs.ai/genie, proxy status log,
  https://www.atlascloud.ai/models/bytedance/seed3d-v2.0/image-to-3d (accessed 2026-10-18).
- **Status.** Kaedim: managed service, pricing through sales (claim). Luma Genie: the URL redirects to a homepage with
  no 3D product (appears discontinued). CSM: blocked by the proxy, unverified. Seed3D 2.0: third-party hosts only, no
  primary source.
- **Verdict.** Not in the pilot.

## D. Open generators

### TRELLIS.2 (Microsoft)

- **Sources.** https://github.com/microsoft/TRELLIS.2 (README, LICENSE, trellis2/pipelines/trellis2_image_to_3d.py,
  o-voxel/o_voxel/postprocess.py); https://huggingface.co/microsoft/TRELLIS.2-4B (card, pipeline.json);
  https://ai.meta.com/resources/models-and-libraries/dinov3-license/;
  https://huggingface.co/api/models/briaai/RMBG-2.0; https://github.com/NVlabs/nvdiffrast/blob/main/LICENSE.txt
  (accessed 2026-10-18).
- **Verified.** TRELLIS.2-4B (HF 2025-12-27), single image to a PBR mesh, GLB export; no rig. Linux, NVIDIA GPU
  with at least 24 GB, CUDA 12.4. Code and weights MIT, **but** the chain carries other terms:
  - **DINOv3** is the image-condition model and cannot be removed. It is under the DINOv3 License (gated), whose
    §1.b.v bars end uses prohibited by trade controls, naming "guns or illegal weapons".
  - **RMBG-2.0** (HF licence "other" / `bria-rmbg-2.0`, gated; the gate text says "open source for non commercial use
    only"; commercial use needs a Bria licence). `from_pretrained` always builds `rembg_model` from pipeline.json
    (trellis2_image_to_3d.py:105), and pipeline.json names `briaai/RMBG-2.0`. So the weights are fetched and loaded even
    for pre-matted RGBA inputs. They are avoided only if pipeline.json or the code is patched not to construct it, and
    that patch is recorded as a route modification.
  - **nvdiffrast**, imported by the GLB export, is under an NVIDIA licence: "only may be used or intended for use
    non-commercially".
  - **nvdiffrec** is a listed dependency (README §License; setup.sh `--nvdiffrec`), under an NVIDIA licence whose
    §3.3 limits use to non-commercial research or evaluation. Whether it sits on the inference or export path is
    unverified until the code is read.
- **Claim.** H100 times 3-60 s.
- **Correction.** NORTH_STAR.md:47 and AAA_PLAN.md:63 call it "TRELLIS.2, MIT". That is incomplete.
- **Here.** No: no GPU, and about 16 GB of weights against 1.6 GB free disk.
- **Unlocks.** OD-0; a 24 GB+ NVIDIA GPU (owner desktop or rented, OD-8); an owner or legal reading of DINOv3,
  RMBG-2.0, nvdiffrast and nvdiffrec (OD-7); pre-matted RGBA inputs **plus** a recorded patch that stops RMBG-2.0 being
  loaded; the nvdiffrast export and bake replaced by Blender, or NVIDIA terms.
- **Verdict.** Candidate R5, deferred.

### Pixal3D (Tencent ARC)

- **Sources.** https://huggingface.co/TencentARC/Pixal3D (README, LICENSE, NOTICE, pipeline.json, pipeline_mv.json)
  (accessed 2026-10-18).
- **Verified.** MIT label; HF last modified 2026-08-31; about 46 GB; built on the TRELLIS.2 backbone; a multi-view
  pipeline; loads DINOv3 and RMBG-2.0; the card's front matter sets `extra_gated_eu_disallowed: true`; its NOTICE omits
  DINOv3 and RMBG-2.0.
- **Here.** No (CUDA; about 46 GB against 1.6 GB free disk).
- **Verdict.** Folded into R5 as its multi-view option; inherits every TRELLIS.2 rights item plus the EU flag.

### TRELLIS (v1)

- **Sources.** https://github.com/microsoft/TRELLIS (README, pipelines, postprocessing_utils.py) (accessed 2026-10-18).
- **Verified.** MIT; NVIDIA GPU ≥ 16 GB; tuning-free multi-image mode that the README says "may not give the best
  results"; GLB export imports nvdiffrast.
- **Verdict.** Older fallback; same export licence item. Not in the pilot.

### Hunyuan3D 2.x open weights (Tencent)

- **Sources.** https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1 (README, LICENSE), /Hunyuan3D-2, /Hunyuan3D-Omni,
  /Hunyuan3D-Part (accessed 2026-10-18).
- **Verified.** 2.1: shape 3.3B + paint 2B, 29 GB VRAM for both; 2mv takes front, left, back, right. Licence: "DOES
  NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA"; outputs may not be used or displayed outside the
  Territory; licensees over 1M MAU must request a licence.
- **Verdict.** Rejected for a global game: players in the EU, UK and South Korea would see the outputs.

### Stable Fast 3D and SPAR3D (Stability AI)

- **Sources.** https://github.com/Stability-AI/stable-fast-3d (README, LICENSE.md, run.py),
  https://github.com/Stability-AI/stable-point-aware-3d, https://huggingface.co/api/models/stabilityai/stable-fast-3d
  (accessed 2026-10-18).
- **Verified.** Community License (free under $1M revenue, registration); gated weights (4.02 GB); single image. The
  README says CPU runs; run.py's help says baking fails without CUDA or MPS (the two primary sources disagree).
- **Here.** No: no HF token; weights plus torch exceed the free disk; the CPU path is unmeasured.
- **Verdict.** Rejected: a fast-preview quality tier below the target (inferred).

### TripoSR, TripoSG, TripoSF (VAST)

- **Sources.** https://github.com/VAST-AI-Research/TripoSR (README, run.py), /TripoSG, /TripoSF;
  https://huggingface.co/api/models/stabilityai/TripoSR/tree/main (accessed 2026-10-18).
- **Verified.** MIT. TripoSR falls back to CPU in code (1.68 GB checkpoint, March 2024). TripoSG needs 8 GB CUDA.
- **Here.** Not measured; disk marginal.
- **Verdict.** Rejected: at most a plumbing smoke test, far below the target.

### Step1X-3D, Direct3D-S2, PartCrafter, PartPacker, SAM 3D Objects

- **Sources.** READMEs and LICENSEs at github.com/stepfun-ai/Step1X-3D, DreamTechAI/Direct3D-S2, wgsxm/PartCrafter,
  NVlabs/PartPacker, facebookresearch/sam-3d-objects (accessed 2026-10-18).
- **Verified.** Step1X-3D Apache-2.0, 27-29 GB GPU, its SDXL texture base licence not read. Direct3D-S2 MIT, geometry
  only. PartCrafter MIT, untextured parts. PartPacker: NVIDIA non-commercial. SAM 3D Objects: SAM licence with the same
  trade-controls clause naming guns; object reconstruction.
- **Here.** No (CUDA).
- **Verdict.** None in the pilot. PartPacker and SAM 3D rejected (licence, task). PartCrafter's part split may help
  armour separation later.

### Quadruped-aware generators

- **Sources.** https://github.com/3DAnimals/3DAnimals; https://arxiv.org/abs/2605.13129 (Rigel3D) (accessed
  2026-10-18).
- **Status.** No released tool found that outputs an armoured, rigged, textured quadruped GLB. 3DAnimals (MIT)
  reconstructs plain animals. SAM 3D Animal, AnimalLift, ORMA and Rigel3D are papers with code unconfirmed.
- **Verdict.** Quadruped needs are met by rigging after generation, not by a generator.

## E. Rigging and animation

### UniRig

- **Sources.** https://github.com/VAST-AI-Research/UniRig, https://huggingface.co/VAST-AI/UniRig,
  https://arxiv.org/abs/2504.12451 (accessed 2026-10-18).
- **Verified.** MIT code and weights; "humans, animals, objects"; CUDA GPU ≥ 8 GB; trained on Articulation-XL2.0
  (Objaverse-derived, per-object licences); its own skeleton topology and names.
- **Claim.** The paper's accuracy gains, under the authors' benchmark.
- **Here.** No (CUDA). **Verdict.** Later, for weights on our own skeleton, with a remap.

### SkinTokens / TokenRig

- **Sources.** https://github.com/VAST-AI-Research/SkinTokens, https://huggingface.co/VAST-AI/SkinTokens,
  https://arxiv.org/abs/2602.04805 (accessed 2026-10-18).
- **Verified.** MIT; NVIDIA GPU ≥ 14 GB; `--use_skeleton` skins against an existing skeleton. A hosted HF Space exists.
- **Here.** No (CUDA). The Space would mean uploading project art (OD-7).
- **Verdict.** The best candidate for weighting the `cvc_quadruped` skeleton once a GPU exists.

### Puppeteer (Seed3D)

- **Sources.** https://github.com/Seed3D/Puppeteer (README, LICENSE) (accessed 2026-10-18).
- **Verified.** Apache-2.0; rig plus video-guided animation; GPU.
- **Verdict.** Watchlist.

### UniMate

- **Sources.** https://github.com/Friedrich-M/UniMate, https://huggingface.co/Linzhan/UniMate (accessed 2026-10-18).
- **Verified.** Text-to-motion for any rigged GLB or FBX, quadrupeds included. Code MIT; **checkpoints CC BY-NC 4.0**;
  training data includes Mixamo, Objaverse-XL and Truebones ZOO (no redistribution).
- **Verdict.** Not admissible for shipped clips (non-commercial weights). Not used even as reference without an owner
  ruling.

### Anything World (Animate Anything)

- **Sources.** https://everythinguniver.se/anything-world-apis, https://pypi.org/pypi/anything-world/json,
  https://anything-world.gitbook.io/anything-world/api/preparing-your-3d-model (accessed 2026-10-18).
- **Verified.** The domain redirects to Everything Universe; one mesh per job, under 100k vertices (decimated above
  20k), rigged and animated output.
- **Claim.** Quadruped support; credit pricing (secondary sources). No output-licence terms found.
- **Verdict.** A possible second quadruped rig step; the single-mesh rule may break armour and paint-mask slots.

### Mixamo, AccuRIG, Cartwheel, Cascadeur

- **Sources.** https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html (403 here; search index only),
  https://actorcore.reallusion.com/static-page/auto-rig/pre_page/accurig/accurig.html,
  https://www.getcartwheel.com/plugins,
  https://cascadeur.com/blog/view/cascadeur-2025-3-new-inbetweening-quadrupeds (accessed 2026-10-18).
- **Status.** Mixamo and AccuRIG: humanoid only. Cartwheel: Blender plugin "Notify me", quadruped scope not stated.
  Cascadeur 2025.3: quadruped auto-posing in Alpha, a GUI app.
- **Verdict.** None applies to a quadruped on this machine. Mixamo, AccuRIG and Tripo's biped presets (incl. `shoot`)
  open only if OD-1 rules upright.

### Rigel3D, TOPOS, OmniFaceRig

- **Sources.** https://arxiv.org/abs/2605.13129, https://arxiv.org/abs/2605.14594, https://arxiv.org/abs/2606.08043
  (accessed 2026-10-18).
- **Status.** Papers; no code or weights found. TOPOS and OmniFaceRig are heads and faces: out of scope (closed
  mouths, no face rig).

### Animation libraries

- **Sources.** https://github.com/sebastianstarke/AI4Animation, https://github.com/facebookresearch/ai4animationpy,
  https://truebones.gumroad.com/l/skZMC, https://opengameart.org/content/animated-animales-low-poly (accessed
  2026-10-18).
- **Verified.** AI4Animation dog mocap: CC BY-NC 4.0, research or education only. Truebones ZOO: $99, royalty-free,
  no redistribution of the FBX or BVH files (dog and cat content not verified). Quaternius animals: CC0, low-poly.
- **Verdict.** Nothing free is commercial-clean for a rifle-firing pet. Truebones needs spend (OD-8) and a ruling on
  whether baked motion inside committed GLBs counts as redistribution (OD-7). Clips are authored in-house.

## F. Fur tools

| Tool | Source (accessed 2026-10-18) | Verified | Verdict |
|---|---|---|---|
| Squiggles Fur | https://github.com/QueenOfSquiggles/squiggles-fur; https://queenofsquiggles.codeberg.page/tech/shell-fur-breakdown/ | MIT; archived 2024-02-23; shells do not follow a skeleton | rejected for animated pets |
| ShellFur | https://github.com/Arnklit/ShellFurGodot | MIT; Godot 3 only | rejected |
| TressFX GDExtension | https://store.godotengine.org/asset/carbonstore/tressfx-real-time-hair-fur/ | MIT; v0.3.0 (2026-09-17), marked unstable; compute shaders | rejected for the product: no Compatibility or twin path (inferred). Optional Forward+ hero experiment only |
| Shells and fins (method) | https://hhoppe.com/proj/fur/ (Lengyel et al., I3D 2001) | fins at silhouettes carry most of the read | adopted as cards and fins at LOD 0-1 (CHARACTER_PIPELINE.md §5) |

## G. Summary

| Route or tool | Runs here | Blocked by | Status |
|---|---|---|---|
| R0a Godot PLACEHOLDER | yes | n/a | kept as fallback and baseline |
| R0b twin K2 | yes | OD-1 | baseline only under an upright ruling |
| R1 scripted bpy | static kit export measured (bpy 5.0.1); skinned/animated export **unmeasured** (CHAR-SMOKE first) | OD-0, OD-1, OD-2, OD-12 | **authored reference candidate** |
| R2 Tripo (gen + quadruped rig + walk) | no (key) | OD-0, OD-7 (channel, terms), OD-8 | pilot candidate |
| R3 Hunyuan 3D 3.1 hosted MV | no (key) | OD-0, OD-7 (hosted terms; Scenario §4.6 if via Scenario), OD-8 | pilot candidate (comparator) |
| R4 Meshy 7.1 multi-image | no (key) | OD-0, OD-7 (§2.9 training), OD-8 | optional |
| R5 TRELLIS.2 / Pixal3D | no (GPU, disk) | OD-0, GPU, OD-7 (DINOv3, RMBG-2.0, nvdiffrast, nvdiffrec), OD-8 | deferred |
| R6 Rodin Gen-2.5 | no (key) | OD-0, OD-8 (Business plan) | optional premium |
| SkinTokens / UniRig | no (GPU) | GPU, OD-7 for the Space | later, weights only |
| Hunyuan3D 2.x open, PartPacker, SAM 3D, SF3D, SPAR3D, TripoSR, UniMate weights, AI4Animation, Luma Genie, CSM | n/a | licence, task or quality | rejected for this role now |

## H. Recommended pilot (a proposal for OD-0)

Per game-character-benchmark: the smallest comparison that changes a decision, the existing-source baseline (R0a)
always included, matched conditions, complete costs, stop rules.

**Decision it serves.** Which route gives an accepted, editable, animated Corgi Company rifleman and Cat Cadre
rifleman at the lowest total accepted-output cost.

**Preconditions.** OD-0 first: CHAR is parked, and nothing below starts until the owner unparks it for this route.
Then OD-1, OD-2 and OD-12, or the pilot runs on the proposed values and records that. A draft contract can be piloted;
it cannot produce an accepted receipt (checker rule 4). Tasks: #43 (character GLB path) is absorbed by this pipeline
if OD-0 is granted; #42 (Grok multi-view Phase 1) stays pending, with Grok spend CLOSED.

**Matched conditions.**

- One profile: `hero_body:quadruped_rifleman`, hash `d367f1be…` (contract 0.1.0). A contract change that alters the
  hash starts a new cohort; old ledger rows keep the hash they were measured under.
- Godot 4.7.2, Forward+ and Compatibility, 1280x720; the Lot night at the look.gd hash of the contract; views V30,
  V60, V10, V3, VH and motion M1-M8; the same clip table, gates and receipt template.
- Inputs. Cat: the same four PATH A views (sha256 1cf19ec9…, 39e0376f…, d7493e8d…, 28173cf3…) for every multi-view
  route. TRELLIS.2 is single-view: its row says so, and it is not called an identical-input comparison. Corgi: no
  admissible multi-view set; R1 builds it from rig.json and the PLACEHOLDER; a generated route uses the side view only
  (ART.md:9) or waits for new references (OD-10). The difference is recorded.
- Every generated mesh is rigged on the same `cvc_quadruped` skeleton release (R1's), or by the route's own rig step
  with that recorded, so rig and clips are compared on equal terms.
- Reviews of matched evidence without route labels where practical; builder-only reviews are labelled.

**Stages (each a card for the lead; nothing starts while CHAR is parked).**

1. **Gate tooling (setup, CPU, quiet windows).** CHAR-PIN, CHAR-SMOKE, CHAR-VAL, CHAR-POSE, CHAR-READ,
   test_char_fit.gd, the aaa-30m matte adapter, CHAR-CLIPS. Several touch other lanes' files
   (CHARACTER_PIPELINE.md §6). Booked as the `shared_gate_tooling` setup row.
2. **R1: corgi, then cat.** Required whatever happens later. Quiet render windows only.
3. **Generated candidates, only after the owner unlocks them** (channel, key, hard cap, terms read, upload approval):
   R2 Tripo on the cat (P1 multiview at a face limit near the LOD0 budget, rig v2.5 quadruped, the walk preset; the
   other clips from R1's scripts), then R3 Hunyuan 3.1 multi-view on the cat as a mesh comparator, rigged on R1's
   skeleton. The corgi runs on a generated route only if the cat survives the stop rules.
4. R4, R5, R6 only on a later owner decision.

**Budget (proposed, OD-8; the owner sets the real numbers).**

| Item | Proposal | Basis |
|---|---|---|
| Candidates | at most 3 generations per route per species; at most 2 rig attempts per species | the benchmark's "small initial budget" |
| Active effort and wall clock | R1: at most 16 active hours and 5 working days of wall clock per species; R2 and R3: at most 4 active hours and 2 days per route per species, rig attempts included. Reaching a cap stops the route (stop rule 7) | designer proposal, no measurement |
| Cash | a hard cap set by the owner before any call, from a live quote or `?dryRun` on the chosen channel on the day of the pilot. No figure is proposed here: the vendor prices in §C are claims under their own conditions and channels, and some are not reproducible today | §C |
| Machine | renders and Blender only in quiet windows; at least 1 GB disk left free | CHARACTER_PIPELINE.md §7 |

**Costs and cohorts.** Every attempt is a ledger row (accepted, rejected or incomplete) with versions, input and
output hashes and rejection reasons. Unknown effort and cost stay empty, never zero. `allocated_usage_usd` is
marginal subscription usage: left empty (unpriced) and never double-counted. Setup is booked as its own rows
(`shared_reference_prep`, `shared_route_research`, `shared_gate_tooling`). `summarize_benchmark.py` totals per route
and never adds them, so **before routes are compared, every shared setup row is added to each route's total**: the
W15 sheets ($6.412) to every generated route and to R1 (the corgi sheets are its references too), research and gate
tooling to every route. Amortising over accepted outputs is used only with a stated accepted-output count.

**Stop rules.** A route stops, and the ledger records why, when:

1. its rights, hardware or upload authorisation cannot be met;
2. its output cannot meet a mandatory contract item after cleanup: 4 influences on the family skeleton, separable
   rigid plates with the paint mask, the species landmarks at LOD 0-2, or the triangle budget without losing the
   species cues;
3. the rig still deforms the vest, plates or legs badly in Godot after 2 attempts per species;
4. `team_read_30m` regresses against the PLACEHOLDER baseline and a palette or mask fix does not recover it;
5. two comparisons in a row show no meaningful progress on the dominant defect (then change strategy, or ask a
   specialist);
6. spend reaches the cap;
7. active effort or wall clock reaches its cap.

The acceptance bar is never lowered to keep a cheap route in.

**Evidence and decision.** `python3 scripts/summarize_benchmark.py docs/qa/char/benchmark.csv` (the benchmark skill's
helper) reports cost and completeness per cohort; it does not judge art or acceptance. Routes that fail a mandatory
item are excluded first. The rest are compared on total accepted-output cost (setup added as above), active effort,
reproducibility, editable-source quality and the cat variant's extra effort, with sample size and open costs stated.
One accepted sample suggests a next step; it does not name a winner.

**Recommendation today.** Continue evaluation; adopt nothing. The owner decides OD-0. If CHAR is unparked for this
route: the lead schedules the gate tooling cards, then CHAR-SMOKE measures a skinned export here, then R1 (corgi,
then cat) once OD-1, OD-2 and OD-12 are decided. R2 and R3 stay candidates until the owner provides a channel, a key,
a cap and upload approval. R5 waits for a GPU and a licence reading. Re-check every vendor fact here on the day the
pilot starts.

**If OD-1 rules upright biped.** The profile changes (new contract version and hash). R0b (K2) becomes the
selective-improvement baseline; the humanoid tools open (Mixamo, AccuRIG, Tripo biped presets including `shoot`,
Meshy API rigging, Godot's SkeletonProfileHumanoid, Rigify Human). The W15 quadruped sheets stop being form
references, and the 30 m silhouette work must be redone against the upright form.

## J. Engine and format sources (accessed 2026-10-18)

- Godot 4.7.2 glTF importer:
  https://raw.githubusercontent.com/godotengine/godot/4.7.2-stable/modules/gltf/gltf_document.cpp (weights
  L1634-1728; name sanitising L493-497; loop names L3830-3836).
- Godot docs:
  - Mesh: https://docs.godotengine.org/en/stable/classes/class_mesh.html
  - image import (VRAM compression): https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/importing_images.html
  - mesh LOD: https://docs.godotengine.org/en/stable/tutorials/3d/mesh_lod.html
  - visibility ranges: https://docs.godotengine.org/en/stable/tutorials/3d/visibility_ranges.html
  - BoneAttachment3D: https://docs.godotengine.org/en/4.7/classes/class_boneattachment3d.html
- glTF 2.0: https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc
- Blender 5.2 manuals: https://docs.blender.org/manual/en/5.2/addons/scene_gltf2.html and
  https://docs.blender.org/manual/en/5.2/addons/rigify/basics.html
- three 0.186.1: the installed `node_modules/three` (GLTFLoader.js:2277-2288, nodes/accessors/Skinning.js,
  objects/LOD.js)
- NIST sodium D lines: https://physics.nist.gov/PhysRefData/Handbook/Tables/sodiumtable2.htm
- Wet surfaces (S. Lagarde): https://seblagarde.wordpress.com/2013/04/14/water-drop-3b-physically-based-wet-surfaces/
- Shells and fins (Lengyel et al.): https://hhoppe.com/proj/fur/
