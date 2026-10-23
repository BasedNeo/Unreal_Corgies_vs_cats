# Tools radar: what would raise the AAA passes, and is it safe (2026-10-23)

**Status: RESEARCH ONLY (TOOLS-RADAR lane, 2026-10-23).** Nothing was installed into the repo, nothing was adopted,
no package.json changed, no git write. Every card below is a proposal for the lead. The plan it serves is
`docs/design/NORTH_STAR.md` and `docs/design/AAA_PLAN.md` (passes SKY, WET, AIR, BACKDROP; CHAR parked). Character
tools were surveyed on 2026-10-18 (`docs/qa/char/ROUTES.md`); nothing materially new for CHAR was found, so it is not
repeated here.

**Labels.**

- **Verified**: read today in a primary source (release notes, docs, licence file, source code, registry metadata),
  or in the installed `node_modules`.
- **Claim**: a vendor or author statement, or a secondary source. Not reproduced.
- **Measured here**: measured on this machine. Earlier numbers quoted from AAA_PLAN.md say so.
- **Here**: whether it can run on this machine (4 cores, no GPU). "Expected, unmeasured" if not tried.

**This machine (verified 2026-10-23).** 4 vCPU, 15 GiB RAM, no GPU, 3.8 GB free on `/`. Mesa 25.2.8 is installed
with lavapipe (`lvp_icd.json`) and llvmpipe; Mesa's `features.txt` for 25.2 lists lavapipe as Vulkan 1.4 complete.
Godot 4.7.2 and Blender 5.2.2 binaries are in scratch. three 0.186.1 is installed and is also npm `latest`.
Playwright is 1.56.1 (npm latest is 1.64.1). Outbound HTTPS goes through a proxy; the GitHub REST API is blocked for
this session, so GitHub facts come from release pages, raw files and the registries.

## 0. Headlines

1. **No three.js upgrade is needed for any pass.** r187 is not released (npm `latest` = 0.186.1, 2026-09-24). r186
   already ships every node the passes need: `SSRNode` (with a stochastic mode), `TRAANode`, `GTAONode`,
   `VolumeNodeMaterial` (spot and point lights with shadows), `reflector()` with roughness mips, the compute rain
   example with splash ripples, `LensflareNode`, `ClusteredLighting` (point lights), SPZ v1-v4 and the ratified
   `KHR_gaussian_splatting`. Verified in `node_modules/three` and the `r186` tag.
2. **Godot 4.8 is not stable.** 4.8-beta1 shipped 2026-10-15; 4.7.2 (2026-08-18) is the current stable. 4.8 brings
   decals to the Compatibility renderer, screen-space contact shadows, multi-bounce AO, Trail3D and mip texture
   streaming. HDDAGI is not in it. Assess on the beta in scratch; adopt only at 4.8-stable.
3. **The biggest gains per millisecond are techniques, not tools:** a lamp-streak (glitter path) term and planar
   reflections for WET; spot-light volumetrics for AIR; rain splashes spawned from an overhead height map, not from
   per-drop collision. All run on what we already have.
4. **One new verification tool is worth adding: NVIDIA FLIP** (BSD-3-Clause), offline, pinned by hash. It turns
   "looks better" and "matches Godot" into a number per fixed view.
5. **Side finding (security, out of scope here):** three installed dev tools have advisories published
   2026-09-18 to 2026-10-21: vite 8.3.1 (6, fixed in 8.3.3), @vitest/mocker 5.0.2 (2, fixed in 5.0.3), source-map-js
   1.2.1 (1 high, fixed in 1.2.2). All are dev-server and test tooling, not shipped code. Raised as a separate task.

## 1. The radar (ranked)

Ring meanings. **ADOPT**: use in the pass now; no new dependency and no owner decision. **TRIAL**: run the small
proof card, then the lead decides. **ASSESS**: research or scratch spike only. **HOLD**: do not start; the reason is
given.

| # | Ring | Item | Pass, lane | What it gives the north star | Gate |
|---|---|---|---|---|---|
| 1 | ADOPT | Spot-light volumetric shafts: Godot volumetric fog per flood + `FogVolume`; twin `VolumeNodeMaterial` + `TRAANode` | AIR; g-atmos, tw-look | Sodium floods with haze shafts and a lit rain curtain, the reference's main mood | PASS (built in) |
| 2 | ADOPT | Lamp-streak (glitter-path) term in both wet shaders | WET; g-atmos, tw-look | The long amber puddle streaks under every lamp | PASS (technique) |
| 3 | ADOPT | Rain splashes from an overhead height map (Godot `GPUParticlesCollisionHeightField3D` + sub-emitter; twin compute rain) | AIR; g-atmos, tw-look | Ground splashes and ripples that sell "rain-soaked" | PASS (built in) |
| 4 | ADOPT | NVIDIA FLIP 1.7 as a perceptual diff | every pass; QA-30M | One number and an error map per fixed view: before/after and PARITY | PASS, conditions |
| 5 | ADOPT | Cycles-baked wear masks (AO, Bevel, Pointiness) in `kitlib.py` | BACKDROP, kits; BL-DCC | Edge wear, rust runs and grime where geometry says they go | PASS (no new tool) |
| 6 | TRIAL | Twin planar `reflector()` vs `SSRNode` for puddles | WET; tw-look | Reflects lamps above the frame edge, which SSR cannot | PASS (r186) |
| 7 | TRIAL | Twin `GTAONode` on the high tier | WET, AIR; tw-look | Contact darkening under containers and walls | PASS (r186) |
| 8 | TRIAL | Godot TAA on Forward+ high (MSAA 2x today) | WET, AIR; g-atmos | Calms wet-asphalt specular shimmer and SSR or fog noise | PASS (built in) |
| 9 | TRIAL | KTX2 / Basis for the twin (KTX-Software 4.4.2 `ktx` via glTF-Transform) | BACKDROP, SKY; asset pipeline | Less GPU memory and no PNG/EXR decode stall; HDR sky as BC6H | PASS, conditions |
| 10 | TRIAL | CC0 PBR detail maps (ambientCG, Poly Haven) under a provenance receipt | WET, kits; BL-DCC | Real asphalt and concrete micro-detail under our bake | PASS, conditions |
| 11 | ASSESS | Godot 4.8 (beta1 now, stable later) | all; lead | Compatibility decals (wet patches on the low path), contact shadows, multi-bounce AO, Trail3D tracers | Conditional (pre-release) |
| 12 | ASSESS | three r187 (unreleased) | AIR, SKY; tw-look | Clustered spot lights (every flood a real light), compressed cube textures in WebGPU | Conditional (unreleased) |
| 13 | ASSESS | Godot Compositor custom pass | AIR; g-atmos | Lens glare streaks or rain on the lens beyond what glow gives | PASS (built in) |
| 14 | ASSESS | RenderDoc 1.46 on lavapipe | QA | Pass-by-pass and draw inspection with no GPU | PASS, conditions |
| 15 | ASSESS | Material Maker 1.7 (CLI export) | kits; BL-DCC | Procedural texture graphs, headless export | Conditional |
| 16 | ASSESS | Godot `AreaLight3D` (4.7) | BACKDROP; g-atmos | Soft lit panels and windows in the skyline | PASS (built in), cost |
| 17 | ASSESS | Blender 5.2.3 LTS patch | all Blender work; BL-DCC | Bug fixes on the LTS line we use | PASS |
| 18 | HOLD | SDFGI, HDDAGI; three SSGI, VXGI | — | Bounce light; little at a lamp-lit night, costly, unmeasurable here | — |
| 19 | HOLD | basis_universal 2.50 XUASTC | — | Smaller textures; three r186 cannot decode it | — |
| 20 | HOLD | Tracy in Godot | — | Real CPU/GPU zones; needs an engine source build and a network listener | — |
| 21 | HOLD | MaterialX | — | A second material language; Godot cannot import it | — |
| 22 | HOLD | Spark 2.4, pyiqa, LPIPS, ktx2-encoder | — | See §7 | Fails or not needed |

## 2. Security gate (every candidate)

Rule applied: reject an unclear licence, unmaintained native code, or a runtime network call. "Shipped" means what a
player downloads or runs.

| Item | Licence (commercial use) | Maintenance (last release; advisories) | Supply chain | Network or keys at runtime | Adds to the shipped game | Result |
|---|---|---|---|---|---|---|
| Godot 4.7.2 built-ins (volumetric fog, FogVolume, heightfield collision, TAA, Compositor, AreaLight3D) | MIT, yes | 4.7.2 on 2026-08-18; OpenSSF Scorecard 5.4, Maintained 10 (2026-10-19) | Official builds with `SHA512-SUMS.txt` (verified for 4.8-beta1); not signed | None | Nothing new | PASS |
| Godot 4.8-beta1 | MIT, yes | Pre-release (2026-10-15) | Same as above; Linux zip SHA-512 `aee4cbf3…0a67` | None | An engine bump; beta must not ship | Conditional |
| three r186 nodes (`VolumeNodeMaterial`, `TRAANode`, `GTAONode`, `reflector`, compute rain) | MIT, yes | 0.186.1 on 2026-09-24; OSV: 0 for 0.186.1 (one 2020 advisory, fixed in 0.125.0) | npm, no provenance attestation; Scorecard 7.2 | None | Code already in the bundle's dependency; tree-shaken imports only | PASS |
| three r187 | MIT, yes | Not released; milestone has 383 merged PRs | npm, no provenance | None | Upgrade risk (§5.12) | Conditional |
| NVIDIA FLIP 1.7 (`flip-evaluator`) | BSD-3-Clause; bundles tinyexr (BSD-3) and stb_image (MIT) | 1.7 on 2025-11-07; Scorecard Maintained 3/10 (low activity); OSV 0 | PyPI wheel, no PyPI provenance (404); pin sha256 `6fdf6736…1b62` (cp311 manylinux x86_64) or build the single C++ header from a pinned commit | None | Nothing (offline QA tool) | PASS, conditions |
| Blender 5.2.x Cycles bakes | GPL-2.0-or-later (tool); outputs are ours | 5.2 LTS to July 2028; 5.2.3 on 2026-10-22 | `download.blender.org` `.sha256` files (verified); not signed | None | Baked PNGs only | PASS |
| KTX-Software 4.4.2 (`ktx` CLI) | Apache-2.0, yes | 4.4.2 "Latest" (2025-10-04); 5.0.0-rc2 pre-release; Scorecard 4.1; OSV not indexed | GitHub release binaries with per-asset sha256 shown, tags GPG-signed, assets not signed; or build from source | None | KTX2 files, plus three's `KTX2Loader` (in the three package, not yet imported by `src/`) and its transcoder (`basis_transcoder.wasm` 527 KB + 58 KB JS, uncompressed) | PASS, conditions |
| glTF-Transform 4.5.1 CLI | MIT, yes | 2026-09-28; OSV 0 | npm, no provenance; CLI pulls 21 deps (sharp, draco3dgltf, gltf-validator…) | None | Nothing (offline) | PASS, conditions |
| basis_universal 2.50 | Apache-2.0 (+ zstd, tinyexr, etc. per its DEP5) | v2.50 latest; Scorecard 3.8 | Source build; precompiled WASI executables in `bin/` (claim) | None | Not usable by three r186 for XUASTC | HOLD |
| meshoptimizer 1.3.0 (already a devDependency) | MIT, yes | 2026-09-25; OSV 0 | npm, no provenance; zero deps | None | Already used | PASS |
| ambientCG assets | CC0 1.0 (verified licence page) | Live site; one operator (their API page says so) | No hashes published; we hash on download | None (download once, commit the derived file) | Derived textures only | PASS, conditions |
| Poly Haven assets | CC0 (verified licence page) | Live; API free incl. commercial (2026-07-18 note) | API gives md5 per file (verified); we re-hash with sha256 | None at runtime; their live API asks for credit only if we call it live (we will not) | Derived textures only | PASS, conditions |
| RenderDoc 1.46 | MIT, yes | 1.46 current (renderdoc.org) | Prebuilt tarball from renderdoc.org, no signature seen | None | Nothing | PASS, conditions |
| Material Maker 1.7 | MIT (LICENSE.md), yes | 1.7 (built on Godot 4.7); Scorecard 3.7; mostly one maintainer | Unsigned binaries (itch.io, GitHub) | None seen (claim) | Exported PNGs only | Conditional |
| Tracy 0.13 | BSD-3-Clause (claim) | Active (claim) | Requires building Godot from source with `profiler=tracy` (verified doc) | The profiled build opens a listener for the Tracy server (doc) | Never shipped | HOLD here |
| Spark 2.4.0 | MIT | 2026-10-20 | npm, no provenance | None | 17 MB unpacked | HOLD (WebGL2 only per README) |
| pyiqa 0.1.16 | PolyForm-Noncommercial-1.0.0 | — | — | — | — | REJECT (licence) |
| ktx2-encoder 0.6.0 | MIT | 2026-07-19; one maintainer | npm provenance yes; bundles a basis encoder WASM | None (no CDN fallback per README) | Nothing (offline) | HOLD (fallback only) |

## 3. ADOPT

### 3.1 Spot-light volumetric shafts (AIR; g-atmos and tw-look)

- **Gives.** The reference's sodium floods with haze shafts and a lit rain curtain; deep blacks between them.
- **Verified.** Godot volumetric fog is Forward+ only; `FogVolume` adds local density (box, ellipsoid, cone,
  cylinder, world) and needs volumetric fog on; Compatibility keeps the halo cards (docs 4.7). `look.gd` already turns
  volumetric fog on for Forward+ medium/high (density 0.009, anisotropy 0.45). three r186's
  `webgpu_volume_lighting_traa` example drives `VolumeNodeMaterial` (12 ray-march steps) with a shadowed `SpotLight`
  and resolves noise with `traa()`. `GodraysNode` is not the tool: it takes point or directional lights only and needs
  a full shadow setup.
- **Measured (AAA_PLAN.md).** Godot volumetric fog costs about +15 % of the frame in software. Twin: not measured.
- **Technique sources.** Froxel volumetrics (Wronski 2014; Hillaire 2015), §8.
- **Gate.** PASS: built into Godot 4.7.2 and three 0.186.1; nothing new ships.
- **Card AIR-VOL-1 (scratch, reversible).**
  1. Godot: give the 2 shadowed floods `light_volumetric_fog_energy` > 0 and one `FogVolume` cone per lit flood
     (density ramp to 0 at the cone's end); temporal reprojection on. Forward+ medium/high only.
  2. Twin: one `VolumeNodeMaterial` box over the Lot, lit by the budgeted real SpotLights, composited before bloom,
     with `traa()` on the WebGPU high tier only.
  3. Shots at spawn, slab 10 m, slab 30 m and the hero view, before and after, both engines.
  - **Bar.** A shaft is visible under each shadowed flood at the hero view; `tools/aaa-30m.mjs` still PASS in all 4
    configs; draws unchanged on the Lot; software frame-time ratio ≤ 1.25 against the pass baseline; FLIP mean on
    pet pixels ≤ 0.05 at 30 m (the pets do not drown). Real-GPU cost logged for a human against the 1.5 ms post
    budget (MASTER_PLAN.md §8.7). Revert: a feature flag off.

### 3.2 Lamp-streak (glitter-path) term (WET; both look lanes)

- **Gives.** The long amber streaks under every flood. AAA_PLAN already found SSR and probes alone do not make them.
- **Technique (verified, primary).** Lagarde, "Water drop 4a": on a uniformly rough wet surface every light (and every
  bright object) leaves a "glitter path" in the vertical plane through eye and light; its length grows as the
  source's elevation drops. Epic's Samaritan demo (GDC 2011) reflected the scene as textured quads with "anisotropic
  HDR highlights" (claim: Epic's UDK page, not reachable through the proxy today, via a search summary). Lagarde
  "Water drop 3b": wet darkening and porosity, already cited in ROUTES.md §J.
- **Gate.** PASS: shader math only; the flood list is already a uniform array in both builds.
- **Card WET-STREAK-1.**
  1. In each wet shader, for the N nearest floods: project the flood to the ground's mirror point; add an elongated
     lobe along the screen-vertical through it, aspect from the view elevation, masked by the wet mask's R (puddle)
     and G (damp, weaker), tinted `SODIUM`.
  2. A unit test in each engine pins the lobe length against elevation (the same table in GDScript and TS, the
     `kit-cover.test.ts` pattern).
  - **Bar.** At the hero view each visible flood leaves one streak, longer at grazing angles; FLIP between Godot
    Forward+ and twin WebGPU high on ground pixels ≤ 0.15 (PARITY); aaa-30m PASS; no new draw. Revert: one uniform.

### 3.3 Rain splashes from an overhead height map (AIR; both look lanes)

- **Gives.** Splashes and ripples on the asphalt; the rain stops being "streaks in front of the camera".
- **Technique (verified).** Lagarde, "Water drop 2a" (Remember Me): do not track which drop hits what; spawn
  splashes at random points of the surfaces seen from above, using a depth map rendered from the rain's direction,
  which also keeps sheltered ground dry. three r186's `webgpu_compute_particles_rain` does exactly this: an
  orthographic camera above the scene renders world positions into a 1024² half-float target, the compute pass
  compares each drop to it and spawns a ripple (50k particles). Godot: `GPUParticlesCollisionHeightField3D` builds a
  height field around the camera and a sub-emitter fires "At Collision" (docs 4.7). SDF collision is not available
  on Compatibility (docs); heightfield on Compatibility is not stated: test it.
- **Gate.** PASS: built in; nothing ships.
- **Card AIR-RAIN-1.**
  1. Godot: a heightfield collision node (follow camera, update when moved) under the existing `Rain`; a splash
     sub-emitter at collision; `amount` within today's 1200/2000.
  2. Twin: port the r186 example's overhead-position target and ripple buffer into `weather-view.ts` behind the
     high tier; the existing streak quads stay the low path.
  - **Bar.** Splashes only on up-facing, unsheltered ground (none under the container overhangs); particle draws
    +1 per build at most; software frame ratio ≤ 1.10; real-GPU particles within 1 ms (human). Revert: tier flag.

### 3.4 NVIDIA FLIP 1.7 (QA-30M; every pass)

- **Gives.** A perceptual error number and heat map per fixed view. It makes "before vs after" and "Godot vs twin"
  measurable, and it has an HDR mode for the EXR sky.
- **Verified.** BSD-3-Clause (LICENSE). v1.7 on PyPI 2025-11-07, `pip install flip-evaluator`, CLI
  `flip -r ref.png -t test.png`. Papers: LDR-FLIP (HPG 2020), HDR-FLIP (2021). No PyPI provenance attestation.
- **Gate.** PASS with conditions: offline only; install into a scratch venv with `--require-hashes` (wheel sha256
  `6fdf6736f4665dd913edf19b7eb94c78a640a95b885a3e95b473f40f7bdd1b62`, cp311 manylinux x86_64); never a
  package.json dependency; outputs are numbers in reports.
- **Card QA-FLIP-1.**
  1. Scratch venv; hash-pinned install; run on the W17 baseline shots against themselves (expect 0) and against one
     known change (the SKY pass before/after).
  2. A proposed `tools/qa-flip.mjs` wrapper (later card) writes mean, p95 and the error map per view.
  - **Bar.** Identical images give 0.000; the SKY before/after gives a non-zero mean confined to sky pixels (error map
    inspected); runtime ≤ 5 s per 1280x720 pair here. Revert: delete the venv.

### 3.5 Cycles-baked wear masks in `kitlib.py` (kits, BACKDROP; BL-DCC)

- **Gives.** Wear on edges, rust and grime in cavities, streaks below ledges: where the geometry says, not where
  noise says. Raises every kit piece and the backdrop at no runtime cost.
- **Verified.** Blender 5.2 manual: AO node (with Only Local), Bevel node and Geometry › Pointiness are Cycles
  only and bakeable; Blender 5.2 also gives the shader Raycast node access to attributes at the hit (release notes).
  The kits already bake AO with Cycles (`tools/assets/README.md`).
- **Gate.** PASS: same tool, same licence, deterministic seeds.
- **Card KIT-WEAR-1.** Bake an edge mask (Bevel normal vs true normal) and a cavity mask (AO, Only Local) for
  `Kit_Lot_Container20_01`; blend into the existing numpy paint as wear (to metal) and grime (darker, rougher).
  - **Bar.** Two builds are byte-identical; triangles unchanged; texture sizes unchanged; `validate-glb.mjs` PASS;
    Godot `run.sh` import PASS; shots at 3 m and 10 m show wear on edges, none on flat panels. Revert: the script.

## 4. TRIAL

### 4.6 Twin planar `reflector()` vs `SSRNode` (WET; tw-look)

- **Why.** The Lot ground is one near-flat plane. SSR only reflects what is on screen, so floods above the frame
  top leave no streak. A planar reflection does, at the cost of one extra scene render.
- **Verified.** r186 `reflector({ resolutionScale: 0.5, bounces: false, generateMipmaps: true })` with roughness
  picking the mip (`webgpu_reflection_roughness`). `SSRNode` has `stochastic` (GGX rays, needs a denoiser such as
  TRAA) and blur modes, `resolutionScale`, `quality`, `thickness`.
- **Card WET-REFL-1.** Hero view and slab 10 m, WebGPU high: (a) SSRNode blur mode, (b) reflector at 0.5 scale with
  the streak term, (c) both. Record software frame ratio and FLIP against a Cycles reference render of the same view.
  - **Bar.** Pick the variant with the lowest FLIP whose software frame ratio is ≤ 1.3; lamps above the frame must
    leave streaks. Godot keeps SSR + probe + streak (no planar node); PARITY logs the difference.

### 4.7 Twin `GTAONode` (tw-look)

- r186 improved its distance model (migration guide 185→186). **Card:** high tier only, half resolution; **bar:**
  visible contact darkening under containers at 10 m, aaa-30m PASS, software ratio ≤ 1.15.

### 4.8 Godot TAA on Forward+ high (g-atmos)

- **Verified.** TAA and FSR 2.2 are Forward+ only; SMAA 1x on Forward+ and Mobile (docs 4.7). The project uses MSAA
  2x (`project.godot`). TAA blurs a little when still and can ghost behind moving objects (docs).
- **Card AA-1.** Forward+ high: MSAA 2x vs TAA vs TAA + MSAA 2x; a 2 s moving-camera capture over wet asphalt with
  rain on. **Bar:** less specular shimmer (frame-to-frame FLIP on ground pixels down), no ghost trail behind pets
  or rain streaks judged on frame pairs, aaa-30m PASS. Final call needs a real GPU.

### 4.9 KTX2 / Basis for the twin (asset pipeline)

- **Verified.** three r186 `KTX2Loader` reads ETC1S, UASTC and UASTC HDR (and not XUASTC). Godot 4.7.2 imports
  `KHR_texture_basisu` (`modules/gltf/extensions/gltf_document_extension_texture_ktx.cpp`), unlike
  `EXT_meshopt_compression`. glTF-Transform's `etc1s`/`uastc` commands shell out to KTX-Software's `ktx` ≥ 4.4.0
  (source, `toktx.ts`). The backdrop GLB carries 18 PNG textures at 256² (inspected here).
- **Claim.** UASTC HDR 4x4 transcodes to BC6H on desktop: the sky at 8 bpp in GPU memory instead of a half-float
  EXR (basis_universal README).
- **Card KTX-1 (scratch only).** Fetch the KTX-Software 4.4.2 Linux x86_64 tarball, check its sha256 against the
  release page, run `gltf-transform uastc` (from a scratch `npx` cache, not the repo) on one kit web variant and the
  backdrop GLB; encode the sky EXR as UASTC HDR.
  - **Bar.** Twin loads them on WebGPU and the WebGL2 fallback; FLIP vs the PNG/WebP build ≤ 0.02 per view;
    GPU texture memory down (renderer info); gzipped download, transcoder included, not above today's (budget
    5 MB, MASTER_PLAN.md §8.7); Godot imports the KTX2 GLB with no
    error (if yes, one GLB could serve both engines; record it). Revert: delete scratch.

### 4.10 CC0 PBR detail maps (BL-DCC)

- **Verified.** ambientCG: all assets CC0 1.0; each asset states a creation method (Procedural, usually Substance
  Designer; Photogrammetry; Approximated; Plain Photo). Poly Haven: all assets CC0, made by staff or donated
  directly; the API returns per-file md5 and a `files_hash`; `asphalt_02` is 8K, by Rob Tuytel.
- **Provenance checks we need (per asset, in a receipt next to the derived file).** Source URL and asset ID; author;
  licence text snapshot and its URL with the access date; creation method; the original download's size, the source
  md5 where given, and our sha256; the exact derivation (crop, scale, channel packing); a visual check that the
  texture shows no logo, brand, readable text, licence plate, face or person (the CHAR rule against real brands
  applies to every asset); no "AI-generated" source unless its generator's terms are read. CC0 needs no credit; we
  credit anyway in the receipt.
- **Card PBR-1.** One asphalt detail normal + roughness (Poly Haven `asphalt_02` 2K, or an ambientCG Procedural
  asphalt) tiled under the WET mask at 1 m scale. **Bar:** receipt complete; texture budget unchanged (it replaces
  the procedural grain); FLIP at 3 m shows added detail, at 30 m ≤ 0.02 change; aaa-30m PASS.

## 5. ASSESS

### 5.11 Godot 4.8 (lead)

- **Verified (4.8 dev 1-7 and beta1 posts).** Decals in Compatibility (GH-118070; 64 per frame soft cap, 8 per
  surface); animated decals (GH-115653); screen-space contact shadows for directional lights (GH-118045; Bend Studio
  method); multi-bounce AO approximation (GH-115426); directional lightmap specular (GH-109737); mip-level texture
  streaming (GH-113429); alpha-test coverage kept in mips (GH-104289, helps fences and rain cards); Trail3D
  (GH-117107, tracers); non-volumetric fog in sky reflections (GH-107958); Jolt 5.6. Breaking list includes a
  Compatibility sky-shader `SCREEN_UV` fix (GH-121676) and mbedTLS 4.1. 1523 fixes since 4.7. No HDDAGI.
- **Card G48-1 (scratch only, never open the repo project with 4.8).** Download
  `Godot_v4.8-beta1_linux.x86_64.zip`, check SHA-512 against `SHA512-SUMS.txt`; copy `engines/godot`, `assets/`
  and `public/assets/` (about 55 MB) to scratch; run `tests/run.gd` headless and the 4 fixed shots in both
  renderers; re-check the sky `encode_srgb` workaround on Compatibility.
  - **Bar.** All tests pass or every failure is listed with its cause; shots FLIP ≤ 0.02 against 4.7.2 except
    where a 4.8 feature is switched on; a list of what 4.8 would let each pass do. Decision waits for 4.8-stable.

### 5.12 three r187 (tw-look; when released)

- **Verified (milestone r187 and the migration guide 186→187).** Clustered lighting gains spot lights and a WebGL2
  fallback (#34978); `CompressedCubeTexture` in WebGPURenderer (#35083); LightMapper diffuse baker with VXGI (#34991);
  TRAA depth-texture leak fixed (#34873). Risks: PMREM rewritten to cube render targets and `CubeUVReflectionMapping`
  removed ("materials may look slightly different", i.e. every wet reflection); TSL type promotion in operators
  (breaking); viewport and scissor no longer scaled by pixel ratio on render targets. No GaussianSplat or SPZ change
  is in the milestone, so AAA_PLAN's pin and its internals test stay valid.
- **Card R187-1.** When r187 is on npm: a branch-free scratch install, the twin's unit tests and the fixed views on
  WebGPU high. **Bar:** FLIP ≤ 0.02 on every view or the difference is explained; then the lead rules. Not before
  the AIR pass lands.

### 5.13 Godot Compositor (g-atmos)

- **Verified.** `CompositorEffect` runs compute at set stages on Forward+ and Mobile, not Compatibility (docs 4.7).
- **Card.** Only if the glow and halo cards fail the hero-view check: a 2-tap anamorphic streak keyed to the HDR
  sodium threshold. **Bar:** ≤ 0.3 ms real GPU (human), Compatibility unchanged.

### 5.14 RenderDoc 1.46 (QA)

- MIT; prebuilt Linux tarball. **Card:** capture one Godot Forward+ frame on lavapipe under xvfb; list passes and
  draws. **Bar:** a capture opens and its draw count matches `--look-stats`. Expected, unmeasured here.

### 5.15 Material Maker 1.7 (BL-DCC)

- MIT; 1.5 "reintroduced CLI to export materials"; 1.7 is built on Godot 4.7. It renders graphs on the GPU, so here
  it would run on lavapipe or llvmpipe (expected, unmeasured). One main maintainer. Our numpy + Cycles pipeline
  already covers its job. **Card:** export one bundled material headless in scratch. **Bar:** bit-identical
  across two runs; else HOLD.

### 5.16 Godot `AreaLight3D` (g-atmos)

- New in 4.7. Docs: costs more than omni or spot; in Forward+ a cost on all rendered objects once one is in view;
  no shadows in Compatibility. The backdrop's emissive cards plus bloom already give lit panels. **Card** only if
  the BACKDROP hero view lacks soft light spill on the near containers.

### 5.17 Blender 5.2.3 LTS (BL-DCC)

- 5.2.3 published 2026-10-22 (linux sha256 `78486c01…0eec`); 5.2 is LTS to July 2028; 5.3 is in beta until
  2026-11-04 (its glTF splat import is look-dev only). **Card:** re-run the sky and wet-mask builds on 5.2.3 in
  scratch. **Bar:** identical hashes, or the diff explained in the receipt. Stay on 5.2 LTS.

## 6. HOLD (and why)

- **SDFGI, HDDAGI; three SSGI, VXGI.** A night lit by local lamps gains little bounce; all are costly and cannot be
  judged here. HDDAGI is not in 4.8. Revisit only after real-GPU timing exists.
- **basis_universal 2.50 XUASTC.** Strong compression (claim: 0.3-5.7 bpp), but three r186's `KTX2Loader` does not
  list it. Revisit when three ships a transcoder that does.
- **Tracy.** Needs a Godot source build (`profiler=tracy`) and opens a listener for its server. Fine on the reference
  desktop for a human; not here, and never in a shipped build.
- **MaterialX.** Blender writes it only through the USD exporter; Godot has no importer. A second material language
  for no runtime gain.
- **Godot FSR 2.2 as an upscaler.** Forward+ only; slower than TAA at native (docs); judge only on a real GPU.

## 7. Rejected or fallback only

- **Spark 2.4.0** (MIT): README still targets WebGL2; AAA_PLAN's ruling stands.
- **pyiqa**: PolyForm Noncommercial. Rejected.
- **LPIPS**: needs torch and model weights. FLIP covers our need without weights.
- **ktx2-encoder 0.6.0**: MIT and npm-provenanced, but one maintainer. Fallback only if KTX-Software fails.
- **Splat tools:** nothing new needed. r186 reads SPZ v4 (Niantic's current default, ZSTD) and
  `KHR_gaussian_splatting` (Khronos: "Complete, Ratified"). Godot has neither; the GLB stays its backdrop.

## 8. Rain, wet and night references (all accessed 2026-10-23)

| Topic | Source | Use |
|---|---|---|
| Rain splashes without per-drop collision; dry under shelter | S. Lagarde et al., "Water drop 2a / 2b: Dynamic rain and its effects" (Remember Me, 2012-13): https://seblagarde.wordpress.com/2012/12/27/water-drop-2a-dynamic-rain-and-its-effects/ and https://seblagarde.wordpress.com/2013/01/03/water-drop-2b-dynamic-rain-and-its-effects/ | §3.3 |
| Wet darkening, porosity, puddles | S. Lagarde, "Water drop 3a / 3b: Physically based wet surfaces" (2013): https://seblagarde.wordpress.com/2013/04/14/water-drop-3b-physically-based-wet-surfaces/ | WET shader |
| Stretched reflections (glitter path) | S. Lagarde, "Water drop 4a: Reflecting wet world" (2013): https://seblagarde.wordpress.com/2013/09/08/water-drop-4a-reflecting-wet-world/ | §3.2 |
| City rain: ripples, drops, warped reflections | N. Tatarchuk, "Artist-Directable Real-Time Rain Rendering in City Environments", SIGGRAPH 2006 course: https://advances.realtimerendering.com/s2006/Chapter3-Artist-Directable_Real-Time_Rain_Rendering_in_City_Environments.pdf | rain look |
| Rain streak appearance | K. Garg, S. K. Nayar, "Photorealistic Rendering of Rain Streaks", SIGGRAPH 2006: https://cave.cs.columbia.edu/projects/categories/project?cid=Physics-Based%20Vision&pid=Photorealistic%20Rendering%20of%20Rain%20Streaks | streak textures |
| GPU rain particles | S. Tariq, "Rain" (NVIDIA SDK 10 whitepaper, 2007): https://developer.download.nvidia.com/SDK/10/direct3d/Source/rain/doc/RainSDKWhitePaper.pdf | particle budget |
| Froxel volumetric fog | B. Wronski, "Volumetric Fog" (Assassin's Creed IV), SIGGRAPH 2014 Advances: https://bartwronski.com/wp-content/uploads/2014/08/bwronski_volumetric_fog_siggraph2014.pdf | §3.1 |
| Unified volumetrics, light shafts | S. Hillaire, "Physically Based and Unified Volumetric Rendering in Frostbite", SIGGRAPH 2015 Advances: https://advances.realtimerendering.com/s2015/Frostbite%20PB%20and%20unified%20volumetrics.pptx | §3.1 |
| Multi-bounce AO (what Godot 4.8 cites) | SIGGRAPH 2016 Physically Based Shading course: https://blog.selfshadow.com/publications/s2016-shading-course/ | §5.11 |
| Image-based reflections with anisotropic highlights | Epic, UDK "Image Based Reflections" (Samaritan, GDC 2011): https://docs.unrealengine.com/udk/Three/ImageBasedReflections.html (proxy returned 403 today; content from a search summary, so **claim**) | §3.2 |

## 9. Verification and quality tooling here

| Need | Answer | Label |
|---|---|---|
| Vulkan without a GPU | Mesa 25.2.8 lavapipe, Vulkan 1.4 complete per Mesa `features.txt` (25.2); Godot Forward+ already ran on it (AAA_PLAN timings) | Verified; measured earlier |
| OpenGL without a GPU | llvmpipe (Mesa 25.2.8); Godot Compatibility shots use it (README) | Verified |
| WebGPU without a GPU | Chromium 141 (Playwright 1.56.1) on SwiftShader; needs the test-only swizzle shim and a render-target readback (AAA_PLAN) | Measured earlier |
| Perceptual diff | FLIP (§3.4); `aaa-30m.mjs` already measures ΔE76 and ΔL\* | Verified |
| Frame time | Ratios only here: Godot `--look-stats`, Chrome tracing (`tools/qa3-trace.mjs`). Absolute times only on a real GPU, logged by a human | Verified (tools exist) |
| Pass inspection | RenderDoc on lavapipe (§5.14) | Expected, unmeasured |

## 10. Top 5 recommendations and their cards

1. **AIR-VOL-1: spot-light volumetric shafts in both engines** (Godot volumetric fog per flood + `FogVolume` cones;
   twin `VolumeNodeMaterial` + `TRAANode`, WebGPU high). Built in, nothing new ships. Bar: a shaft under each
   shadowed flood at the hero view, aaa-30m PASS in 4 configs, software ratio ≤ 1.25, pet FLIP ≤ 0.05 at 30 m.
2. **WET-STREAK-1 + WET-REFL-1: the glitter-path streak term in both wet shaders, then planar `reflector()` vs
   `SSRNode` on the twin.** Technique from Lagarde 4a. Bar: one streak per visible flood, longer at grazing angles;
   Godot-vs-twin ground FLIP ≤ 0.15; lamps above the frame still streak on the twin's chosen variant.
3. **AIR-RAIN-1: splashes from an overhead height map** (Godot heightfield collision + sub-emitter; twin port of
   r186's compute rain). Bar: splashes only on unsheltered up-facing ground, ≤ +1 particle draw, software ratio
   ≤ 1.10.
4. **QA-FLIP-1: FLIP 1.7 as the perceptual gate,** hash-pinned in a scratch venv, never in package.json. Bar:
   identical images score 0.000; the SKY before/after error is confined to sky pixels; ≤ 5 s per pair here.
5. **G48-1: Godot 4.8-beta1 spike in scratch** (Compatibility decals for wet patches on the low path, contact
   shadows, multi-bounce AO, Trail3D), checksum-verified, never opened on the repo project. Bar: suite results and
   4.7.2-vs-4.8 FLIP per view listed; adoption waits for 4.8-stable.

## 11. Sources (all accessed 2026-10-23)

- Godot download archive (versions and dates): https://godotengine.org/download/archive/
- Godot 4.8 posts: https://godotengine.org/article/dev-snapshot-godot-4-8-beta-1/ (and `-dev-1` … `-dev-7`)
- Godot 4.5, 4.6, 4.7 release pages: https://godotengine.org/releases/4.7/ (and `/4.6/`, `/4.5/`)
- Godot 4.7 docs: https://docs.godotengine.org/en/4.7/tutorials/3d/volumetric_fog.html,
  …/tutorials/rendering/compositor.html, …/tutorials/3d/particles/collision.html,
  …/tutorials/3d/3d_antialiasing.html, …/tutorials/3d/environment_and_post_processing.html,
  …/classes/class_decal.html, …/classes/class_arealight3d.html, …/classes/class_fogvolume.html,
  …/engine_details/development/profiling/tracy.html
- Godot 4.7.2 glTF source: https://raw.githubusercontent.com/godotengine/godot/4.7.2-stable/modules/gltf/gltf_document.cpp
  and …/modules/gltf/extensions/gltf_document_extension_texture_ktx.cpp
- Godot 4.8-beta1 checksums: https://github.com/godotengine/godot-builds/releases/download/4.8-beta1/SHA512-SUMS.txt
- three.js: npm registry https://registry.npmjs.org/three; releases https://github.com/mrdoob/three.js/releases;
  r187 milestone search https://github.com/mrdoob/three.js/pulls?q=is%3Apr+milestone%3Ar187+is%3Amerged; migration
  guide https://github.com/mrdoob/three.js/wiki/Migration-Guide; examples at
  https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/ (`files.json`, `webgpu_compute_particles_rain.html`,
  `webgpu_volume_lighting_traa.html`, `webgpu_reflection_roughness.html`); installed `node_modules/three` 0.186.1
- KHR_gaussian_splatting: https://raw.githubusercontent.com/KhronosGroup/glTF/main/extensions/2.0/Khronos/KHR_gaussian_splatting/README.md
- SPZ: https://raw.githubusercontent.com/nianticlabs/spz/main/README.md and LICENSE (MIT)
- basis_universal: https://raw.githubusercontent.com/BinomialLLC/basis_universal/master/README.md, LICENSE;
  releases https://github.com/BinomialLLC/basis_universal/releases
- KTX-Software releases: https://github.com/KhronosGroup/KTX-Software/releases; `ktx create`:
  https://github.khronos.org/KTX-Software/ktxtools/ktx_create.html
- glTF-Transform KTX requirement: https://raw.githubusercontent.com/donmccurdy/glTF-Transform/main/packages/cli/src/transforms/toktx.ts
- meshoptimizer releases: https://github.com/zeux/meshoptimizer/releases
- Material Maker: https://github.com/RodZill4/material-maker/releases; LICENSE.md and README.md (raw)
- ambientCG: https://docs.ambientcg.com/license/ , https://docs.ambientcg.com/creation-methods/ , https://docs.ambientcg.com/api/
- Poly Haven: https://polyhaven.com/license , https://polyhaven.com/our-api , https://api.polyhaven.com/files/asphalt_02
- Blender: https://developer.blender.org/docs/release_notes/5.2/ (and 5.0, 5.1, 5.3 with `cycles/`,
  `geometry_nodes/`, `pipeline_io/`); https://download.blender.org/release/Blender5.2/ (sha256 files);
  manual https://docs.blender.org/manual/en/5.2/render/shader_nodes/input/ao.html, …/bevel.html, …/geometry.html,
  …/files/import_export/usd.html
- FLIP: https://raw.githubusercontent.com/NVlabs/flip/main/LICENSE, README.md; https://pypi.org/pypi/flip-evaluator/json;
  https://research.nvidia.com/publication/2020-07_FLIP ; https://research.nvidia.com/publication/2021-05_HDR-FLIP
- Mesa: https://docs.mesa3d.org/relnotes/25.2.0.html ; https://gitlab.freedesktop.org/mesa/mesa/-/raw/25.2/docs/features.txt
- RenderDoc: https://renderdoc.org/ ; https://raw.githubusercontent.com/baldurk/renderdoc/v1.x/LICENSE.md
- OpenSSF Scorecard API: https://api.securityscorecards.dev/projects/github.com/<owner>/<repo> (scores dated 2026-10-19)
- OSV: https://api.osv.dev/v1/query and /v1/querybatch (all 152 package-lock entries scanned)
- npm registry metadata (licence, provenance, dates) for every npm package named above; PyPI JSON for FLIP, pyiqa,
  LPIPS
