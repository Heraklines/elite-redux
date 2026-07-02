# CHIMERA-FORGE v2 — Render-K-and-Select Socket Fusion with a Pixel-Native Finish

## Thesis

Autogen failed because **cut-Y, scale, and anchor were three independent per-species constants that never referenced each other**, so float, mis-scale, and gap were the default. Every lens in this study fixed that by deriving all three from one per-pair primitive — but each then bet the whole system on a *single* detection being right, and the panel's universal killer was the same: **a confident-wrong detection routes garbage upward, invisible to a geometry gate.**

The spine here keeps the **socket** as the registration primitive — a matched `(pos, normal, width)` connector both sprites must independently agree on, so gap/scale are impossible *by construction* rather than patched (SOCKET-LOCK). But it makes the one structural move the critique identified as highest-leverage: **detection does not propose one answer — it proposes a small bag of cheap hypotheses, all are rendered, and a relative scorer picks the argmax.** Ranking "which of these 6 rasters is most plausible" is dramatically more robust than calibrating "is this one score above τ," it launders single-point confident-wrong detections into one ballot among several, and — by adding a **no-neck head-disk contact-arc hypothesis** (critique) — it finally gives the *neckless cuddly-biped majority* (Pikachu, Jigglypuff, Snorlax, Clefairy) a real attachment instead of silently dropping them to recolor.

Three more merges close the panel's wounds:
- The **cranium is placed by a closed-form similarity transform** (Procrustes), which *cannot fold*, because a head is a branchy medial graph and medial re-skin tears across the face. Medial coordinates (Tendon) are kept only for the low-curvature parts they are right for — the **neck stub and grafted limbs/tails**.
- The join is a **region-asymmetric interpolated weld band** (Chimera Weld) so the only invented geometry is a proportional sliver, confining the blast radius of any error.
- Everything finishes in **index/palette space with one outline re-synthesized from the final alpha** (INKFORGE), so any geometry strategy — even a wrong one — reads as one coherently inked Gen-5 creature, never two clip-art borders meeting at a scar.

The floor is always the recolor you already ship, upgraded to OKLab luminance-role transfer. **Detection proposes a slate; the render-and-rank disposes; the ladder guarantees it never breaks.**

---

## Staged Pipeline (with the math)

All geometry runs at native **96×96 in integer/index space**, once per unique fusion, **off the main thread** (see Runtime). Notation: mask `M[x,y] = α > 24`; head donor = **A**, body donor = **B**; signed distance transform `D`, with `ρ(s)=D[s]` = local half-thickness at skeleton pixel `s`.

### Stage 0 — Extraction (cached per species/view/variant)

- **Mask & despeckle.** `M = α>24`; two-pass union-find connected components; drop components `<6 px` (kills green-screen speckle). Keep survivors ranked by area (multi-blob detection for swarm plans).
- **Signed distance transform** `D` — exact Felzenszwalb–Huttenlocher 1-D composition, **float** (keep precision near thin features). Backbone for sockets, skeleton radius, thickness tests.
- **Palette → index map** (INKFORGE). RGBA → OKLab, median-cut to ≤24 colors (**keep the ramp, not 4**). Store `uint8` index buffer `I`.
- **Ink mask.** `ink[p] = (L[p] < 0.30·Lmax) AND (∃ brighter opaque 4-neighbor)`. Flag palette entries whose pixels are >70% ink as **outline-role**. Free internal pre-segmentation.
- **Ramps.** Cluster non-ink entries by OKLab hue (merge families <20°), sort each family by `L` into roles `{shadow, mid, highlight}`. Flag **signature accents** = high-chroma, small-area, isolated families (flame tip, electric cheeks).
- **Animation sockets (Weakness-2 fix, critique).** Read **two** frames via `getImageData`: frame-0 (neutral) and frame-mid (peak of idle bob). Run Stages 1–3 on both; store the socket keypoint on each. The runtime overlay **lerps** between the two — closing the rigid-head-desync at ~2× analysis cost on a tiny head bbox, not N×.

### Stage 1 — Structure

- **Width/center profiles** `w[y]=Σ_x M[x,y]`, `cx[y]=mean{x:M[x,y]}` — used only as a *coarse prior*, never as the socket operator (Weakness-1 fix).
- **PCA** of mask points → principal axis `θ`, elongation `λ1/λ2`.
- **Symmetry axis** = `argmin` over candidate columns (±15° angular refine) of `XOR(M, reflect(M))` area. A **prior**, voted against eyes later — never a hard constraint (¾-view sprites tilt it).
- **Skeleton** (Tendon). Zhang–Suen thinning; stamp each pixel with `ρ=D`. Trace to a graph: deg-1 = endpoint, ≥3 = branch; each edge carries a **radius profile** `ρ(t)` along arclength `t`. **Prune** edges with `len < max(4px, 1.5·ρ_base)` (Hamilton–Jacobi flux significance). Record prune-ratio as a confidence signal.

### Stage 2 — Body-plan classification (gates the hypothesis bag)

Discrete enum from `{θ, λ1/λ2, component count, downward-endpoint count below centroid, neck-pinch presence}`:
`upright-biped / upright-quadruped / serpent / blob / swarm / winged`.

**Quadruped is first-class** (INKFORGE/CHIMERAGRAM critique): its head is at the **front terminus**, not the top, so its socket search runs along the **front-terminal skeleton edge**, not a vertical band — fixing the panel-flagged failure where quadrupeds masquerade as bipeds and the cut lands on the spine. A `compat(planA_as_head, planB_as_body)` matrix selects which hypotheses are even worth rendering and which rung is reachable.

### Stage 3 — Registration as a HYPOTHESIS BAG (the structural move, critique)

Instead of trusting one socket, emit **K ≈ 4–8 candidate registrations** on B (the host) and the matching plug on A. Each hypothesis is a `(socket_B, plug_A, scale)` triple:

- **H1 — Skeleton-ρ pinch** (Tendon/SOCKET-LOCK, the appendage-immune fix for Weakness 1). On the skeleton edge connecting head-disk → torso, `s* = argmin_s ρ(s)` subject to **prominence**: flanking samples within arclength ±3 satisfy `ρ ≥ 1.3·ρ(s*)`. Socket `= { pos=skeleton(s*), normal=edge tangent (outward), width W=2·ρ(s*) }`. *This is local thickness along the centerline — a limb at neck height can no longer inflate it, because we never sum a global row.* `neckConf = (min flank ρ − ρ(s*)) / (ρ_headDisk)`, clamped.
- **H2 — Eye-frame Procrustes socket** (Procrustes). From detected eyes (Stage 4) build the similarity frame; place the socket at `eyeMid + s_eye·downVector`, width from inter-ocular scale. Independent channel — fails differently than H1.
- **H3 — No-neck head-disk contact arc** (critique — *the coverage fix*). Head-disk = `argmax D` in the plan-appropriate head region → center `(hx,hy)`, radius `R`. The contact point is where the disk boundary tangents the torso mass along the spine: `pos = (hx,hy) + R·spineDir`, `normal = spineDir`, `width = chord of the disk at that latitude`. **Always defined**, so neckless Jigglypuff/Snorlax finally get a graftable socket and rung 2 fires on the cuddly-biped bulk — *without trusting any pinch at all.*
- **H4 — Front-terminus socket** (quadruped/serpent-head). Same as H1 but seeded at the front-terminal edge.
- Each surviving hypothesis is instantiated at **a couple of snapped scales** (see Stage 6), expanding the bag.

All K are carried to a cheap render in Stage 8/validator. **No single detector is load-bearing.**

### Stage 4 — Eye-frame cross-check (Procrustes sanity, not the spine)

Three-detector vote in the head box only (Procrustes featureDetection): (1) interior dark local-minimum pupils with an **adaptive/percentile** threshold (so Gengar doesn't flood; reject outline pixels via `<50%` dark/transparent neighbors); (2) `+score` if a bright `L>0.8` specular sits within radius 2; (3) symmetry pairing — reflect candidate `i` across the axis, score `|i'−j| + |size_i−size_j| + penalty(|interocular − 0.3..0.5·headWidth|)`.

With points as complex `z=x+iy`, inter-ocular scale `s_eye = |Pr−Pl|`. Used to **seed H2** and to orient the head up-vector — *not* as the sole registration, because the panel showed symmetric body spots produce confident-wrong frames. Crucially, eye sanity enters the validator only as a **low-weight relative tiebreak** among the K candidates of the *same pair* (Weakness-3 fix): a shared eye-detector bias is shared across all candidates and **cancels in the ranking**.

### Stage 5 — Cut along the thin neck (anti-amputation)

**BODY** = flood-fill seeded *below* B's chosen socket, so limbs/tails dipping under the neck stay one component (never sliced through a flat row). **HEAD** = region of A above its plug socket, cut **perpendicular to the skeleton at the local-thickness minimum**, carrying A's ears/horns/antennae for free.

### Stage 6 — Scale-lock + translate-lock (anti-float, anti-misscale)

```
s = clamp(W_bodySocket / W_headPlug, 0.6, 1.4)        // socket-width ratio is primary (SOCKET-LOCK)
s = snapToNiceRatio(s)                                 // 1, 3/4, 4/3, 1/2, 3/2 when within 4%
```
Snapping to a "nice" ratio lets the resample reuse a clean integer kernel and preserves line weight; only when no nice ratio is within tolerance does it fall to RotSprite resampling (Stage 7). Translation maps `plug.pos → socket.pos` with a **forced 1–2 px overlap** below the socket → zero gap by construction. Optional chibi bias `×1.05–1.15` on head height. Cross-check `s` against `s_eye`: if `|log(s_socket/s_eye)| > 0.4`, that hypothesis is *penalized*, not killed — the bag still has others.

### Stage 7 — Graft: similarity cranium + medial neck/limbs (cranium-tear fix, Honorable-Mention)

The host **body is never resampled** (keeps native fidelity + animation).

- **Cranium = closed-form similarity transform** (Procrustes). The head-cap is placed by `w = α·z + β` (or `α·conj(z)+β` for opposite facing), `α` carrying scale+rotation from the chosen frame, `β` seating the plug socket on the host socket. **A similarity transform cannot fold**, so the most-scrutinized region — the face — never tears. *This is the explicit repair of "a head is not a tube": medial `(t,n)` projection is discontinuous at every eye/ear/horn branch, so it is not used on the cranium.*
- **Neck stub + grafted limbs/tails = medial re-skin** (Tendon), where the part genuinely *is* a low-curvature tube: output pixel → nearest `(t = arclength, n = signed offset/ρ(t))` on the retargeted centerline (rotated so A's neck tangent continues B's spine tangent) → inverse-sample A at `(t, n·ρ_A(t))`. Bends and tapers the neck to the socket without a global affine.
- **RotSprite** for any residual non-cardinal rotation (rotation by shifting along scaled-up edges, then majority-downscale) kills the diagonal stair-jaggies the panel flagged on every nearest-neighbor warp.
- **Re-derive interior linework after the warp**: recompute the ink mask on the grafted cap from the warped fields so eyes/mouth/keylines are regenerated crisp, not carried through smeared (fixes "interior smear by construction").

### Stage 8 — Render-K and rank (the validator as a *selector*, critique)

For each surviving hypothesis, composite the candidate 96 px raster (~1 ms each, off-thread; you already pay one render). Score **relatively** and take the argmax:

```
score =  w1·silhouettePlausibility   // final area within [0.6,1.5]× max(A,B) body area
       + w2·headDiskPresence         // a DT-disk still caps the head region  (RELATIVE rank only)
       + w3·eyeSanity                // ~1 eye-pair in head region            (LOW weight, tiebreak)
       + w4·outlineContinuity        // one closed silhouette, no interior alpha holes
       − w5·seamDisagreement         // residual tonal/edge step across the weld  (detector-independent)
       − w6·foldoverArea             // medial neck/limb foldover only           (detector-independent)
       − w7·axisImbalance            // mass asymmetry about the DETECTED axis, not image center
```

Why this defeats the panel's killers:
- **Relative ranking, not absolute τ** → no finely-tuned per-rung thresholds; only a sane *ordering*, which the heuristic terms are genuinely good at.
- **Correlated error is laundered** → `eyeSanity` and `headDiskPresence` are weighted low and used only to rank candidates of the *same pair*, where their bias is shared and cancels; the **detector-independent** terms (`seamDisagreement`, `foldoverArea`, `silhouettePlausibility`) carry the weight.
- **`axisImbalance` measures about the *detected* symmetry axis** (which is legitimately tilted for Charizard/Lucario), so ¾-view and side-facing mons are no longer demoted for being correctly asymmetric (Weakness-3 fix).
- A confident-wrong socket is now **one ballot**; the right hypothesis is usually also in the bag, and the argmax surfaces it. Only if the *winner* is still below a **loose floor** does the system drop a rung.

### Stage 9 — Region-asymmetric weld (the only invented geometry, Chimera Weld)

Blend field `αw(p) = smoothstep` of signed distance to the weld line: `0` above the socket, `1` below the shoulders, intermediate across a **proportional** band `= round(0.08·spriteHeight)` px (*not* a fixed 6–10 px — fixed constants erode tiny mons; critique). In the band the output **boundary** = `αw`-weighted interpolation of warped-A's contour and B's shoulder contour — a brand-new silhouette segment that physically welds the halves. Interior selected per-pixel by **4×4 Bayer dither on `αw`** in index space (no averaged/out-of-gamut colors). Any correspondence error is confined to this sliver.

### Stage 10 — Accent reconciliation (anti lost/doubled limbs)

Feature inventory `{has_arms, has_ears, has_tail, wings…}` from non-core components + skeleton endpoints. A's top protrusions (horns/ears) ride along with the head cut; optionally graft **one** signature B-body or A-head accent via its own socket transform; **suppress duplicate appendage classes** (if B already has arms, drop A's stray arm) → never four ears.

### Stage 11 — Palette unify (OKLab luminance-role transfer, all lenses)

Per region, bucket the ramp into `{highlight, main, shadow, outline}` by `L`. Harmonize the **body toward the head, role→role**: keep each body pixel's own `L` (preserves shading and light direction), replace `(a,b)` chroma+hue with the head's same-role value, blend `β≈0.55` (full=recolor regression, 0=clash). Collapse all outline darks to **one shared tinted black** = adjacent shadow darkened one step (Gen-5 keylines are tinted, never pure black). **Exclude signature-accent indices.** This is `updateFusionPalette` upgraded, feeding the existing hard-light-on-grayscale shader a role-correct LUT.

### Stage 12 — Re-synthesis (the crispness pass, INKFORGE)

Union alpha → despeckle → **morphological close** (dilate→erode r=1–2) seals seam pinholes → **erase all inherited ink inside the silhouette, regenerate one outline**:
- silhouette outline = `M AND NOT erode(M,1)` — a **true 1 px** inner-edge line (*not* the 2 px `dilate−erode` gradient the panel caught; critique).
- paint each outline pixel the adjacent region's shadow stepped one darker;
- draw the internal weld keyline along the cut so the join reads as deliberate linework;
- **re-stamp the regenerated interior ink** (eyes, mouth) from Stage 7, so the result is not a flat eyeless cutout (fixes the INKFORGE killer flaw the panel found);
- thin-feature guard: where `D==0.5` (1 px antennae) keep one fill pixel.

### Stage 13 — Bake & emit

All ops integer/nearest at 96×96; **single ×3 nearest upscale last** → 288×288. Emit `{index map, palette, socket keypoint pair, weld mask, chosenRung, score}`.

---

## Data Model

**Per sprite (cached per species/view/variant):**
```
mask, distanceTransform(float), indexMap(uint8), palette(OKLab[]),
inkIndices, rampRoles{family→{shadow,mid,highlight}}, signatureAccentIndices,
skeletonGraph{nodes, edges, radiusProfile ρ(t)}, symmetryAxis, planClass,
headDisk{c,R}, contactArc{pos,normal,width},          // H3 — always present
socket{pos,normal,width,conf}@frame0, socket@frameMid, // animation lerp pair
eyes{Pl,Pr,conf}, featureInventory{arms,ears,tail,wings…}
```

**Per fusion (the cached artifact, ~9 KB):** `indexMap + unifiedPalette + socketKeypointPair + weldMask + chosenRung + score`. Shiny/back reuse the **same geometry** with a swapped palette LUT → near-free.

**Variety (CHIMERAGRAM).** A `variantIndex` selects among compatible grammar productions (HEAD_SWAP / CHIMERA head+forelimbs / ACCENT_GRAFT), chosen by `hash(speciesA, speciesB, view, variantIndex)`, yielding several deterministic chimeras per pair — variety no slice-based generator offers.

**TINY optional override table (flagships only, ~50–150 species, ~8 numbers each):**
```json
{ "plan":"biped", "socket":{ "x":48,"y":40,"w":14 }, "eyes":[[40,28],[56,28]],
  "headAnchor":[48,30], "accentIndices":[7,12] }
```
Per-view (front/back differ). Converts the hardest detections into lookups at ~10% of Japeal's per-species cost. **The long tail is covered by the hypothesis bag + render-and-rank, not by this table** — and you author it only *after* the validator tells you which species the bag actually fails on.

---

## Confidence & Fallback Ladder (down to recolor, never breaks)

Detection produces the **bag**; the render-and-rank (Stage 8) picks the winner; the **ladder** decides whether the winner is good enough or whether to drop a rung. Each rung bakes once and caches.

**Cheap pre-gate signals** (prune the bag before rendering): `neckConf`/contact-arc presence, plan compatibility, socket-width within clamp (not saturated), socket↔eye scale agreement, despeckle damage.

**The ladder (deepest passing rung wins):**
1. **TRUE MORPH** — same plan, both strong. Interpolate spine joints + per-bone radius profiles → a genuinely new silhouette (Tendon rung 1). Because we already render K, its **spine-interpolation variants are thrown into the same bag for cross-plan pairs too** (critique), letting the selector occasionally pick a melted result where it actually scores well — the only cheap path toward the novelty the safe middle refuses.
2. **SOCKET-LOCK GRAFT (money path)** — both analyzable, a hypothesis (pinch *or* contact-arc) wins above floor: full Stage 5–12 + region-asymmetric weld + accent reconciliation. *Now fires on the neckless majority via H3.*
3. **ACCENT GRAFT** — incompatible plans (serpent/blob/swarm body) but a face is readable: keep host silhouette, graft only A's facial accents/ears/horns near the front terminus, harmonize at `β≈0.4`. No neck cut.
4. **ANCHOR-ONLY HEAD-CAP** — every socket hypothesis weak: paste cap at the detected head anchor, scale by head-disk ratio, Bayer-dither seam, partial harmonize.
5. **RECOLOR FLOOR** — low confidence / swarm / wildly incompatible / any thrown exception / winner below floor: the **existing `updateFusionPalette`**, upgraded to OKLab luminance-role buckets. Guaranteed never-garbage; uses the GPU shader you already ship.

The gate is conservative (when in doubt, drop). Because the floor is the current system, the whole build is **purely additive and shippable rung-by-rung**.

---

## Caching & Runtime Budget

**Threading (fixes the universal main-thread-stall flaw):**
- All analysis + render-K + bake run in a **Web Worker on an `OffscreenCanvas`**. The two `getImageData` readbacks (frame-0 + frame-mid) and the result `texImage2D` upload are the only main-thread touches, each <1 ms.
- **Pre-warm on party/roster load:** enqueue the ≤12 visible fusions before they enter the field, time-sliced via `requestIdleCallback` so cold-start bursts never land in one frame.
- **Batch cold-start:** the worker processes the queue serially; the field shows the **recolor floor (rung 5) immediately** (the current free path) and swaps in baked geometry when the worker reports done — never a freeze, only an upgrade-in-place.

**Animation (fixes the static-bake regression) — two-layer composite:**
- The **host body stays the original animated atlas**, recolored every frame by the existing hard-light GPU shader fed the role-correct LUT — fully animated, zero new per-frame CPU, no new body texture.
- The **baked head-cap is a small overlay** pinned to the **lerped socket keypoint** (frame-0 ↔ frame-mid, Stage 0), so the head tracks the idle bob instead of floating off it (Weakness-2 fix). Optional upgrade: bake N head-cap frames for heavy deformers — still cheap, the head bbox is small.

**Budget (one-time, worker, ~9k px):** DT/CC/profiles/PCA/quantize each <1 ms; Zhang–Suen + symmetry search a few ms; **render-K = K×~1 ms** (K≈6, trivially inside budget; critique); similarity cranium + medial neck + RotSprite a few ms; OKLab role LUT + dither + close + outline a few ms. **~25–55 ms per unique fusion, off-thread, cached forever.** Artifact ~9 KB; shiny/back/variant reuse geometry via palette swap.

---

## Autogen-Failure-Mode Defeat Table

| Failure | Beaten by |
|---|---|
| **Floating/sunken head** | `plug.pos → socket.pos` with forced 1–2 px overlap; the head's Y *is* the body's socket — no independent cut-Y to drift. Gap geometrically impossible. (SOCKET-LOCK) |
| **Neckless majority dropped to recolor** | **H3 head-disk contact-arc hypothesis** is always defined, so Jigglypuff/Snorlax/Pikachu get a real socket and rung 2 fires. (critique) |
| **Socket corrupted by limbs / spec self-contradiction** | Socket = **`argmin ρ(s)` along the skeleton edge** (local thickness), not a global row-sum — appendage-immune and well-defined. (Weakness-1 fix) |
| **Mis-scaled head** | `s = W_bodySocket/W_headPlug` clamped + snapped to a nice ratio, cross-checked against inter-ocular scale. |
| **Cranium tear/foldover across the face** | Head placed by **closed-form similarity transform** (cannot fold); medial re-skin reserved for the neck stub and tube-like limbs only. (Procrustes + Honorable-Mention fix) |
| **Confident-wrong detection (the panel's killer)** | **Render-K-and-rank**: the bad answer is one ballot; the right hypothesis is usually in the bag and the relative argmax surfaces it. (critique) |
| **Validator demotes correct asymmetric/non-round mons** | Relative ranking among same-pair candidates cancels shared bias; `axisImbalance` measured about the *detected* tilted axis; eye/head-disk terms low-weight. (Weakness-3 fix) |
| **Head overlay desyncs from animation** | Socket detected on frame-0 **and** frame-mid; overlay lerps along the bob. (Weakness-2 fix) |
| **Visible paste seam** | No inherited outline survives — all ink erased, one **true 1 px** tinted keyline regenerated from final alpha; weld band is an interpolated silhouette + morphological close. (INKFORGE + Chimera Weld) |
| **Eyeless/flat cutout (INKFORGE flaw)** | Interior ink re-stamped from the warped cap in Stage 12, not just the outer silhouette. |
| **Clashing palettes** | OKLab luminance-**role** transfer (shadow↔shadow), keep body `L`, swap hue/chroma at `β≈0.55`, one tinted outline, accents excluded. |
| **Proportion / body-plan mismatch** | First-class **quadruped** class + `compat()` routes incompatible plans to accent-graft or recolor; selector demotes implausible silhouettes. |
| **Lost / doubled limbs** | Cut follows the thin alpha neck via flood-fill; feature-inventory dedup suppresses duplicate appendage classes. |
| **Broken outlines** | Outline = `M AND NOT erode(M,1)` of the **final** merged alpha → every exposed edge closed, true 1 px. |
| **Green-screen specks / halos** | Alpha threshold + CC despeckle (<6 px) + 1 px erode before re-outline. |
| **Tiny-mon erosion from fixed constants** | Weld band, close radius, despeckle scaled **proportionally** to sprite height. (critique) |
| **Mush across wild body plans** | Selector + ladder degrade to recolor *before* mush is emitted; morph error confined to the weld band. |
| **Janky non-3×3 pixels** | Body never resampled; cranium similarity + RotSprite + nice-ratio scale; all geometry integer at 96, single ×3 upscale last. |

---

## Phased Build Path

**MVP (ship in days, never regresses):**
- Rung 5 upgraded: port `updateFusionPalette` to OKLab luminance-role buckets — a visible quality bump on every existing fusion, zero geometry.
- Stage 0–1 extraction (incl. the **two-frame** read) + Stage 3 socket detection with **H1 + H3 only** + Stage 12 outline re-synthesis + worker/pre-warm scaffolding.

**Cool (the money path):**
- Rung 2 SOCKET-LOCK GRAFT: scale/translate-lock, thin-neck cut, region-asymmetric weld, accent dedup, two-layer animated composite with **socket lerp**.
- The **render-K-and-rank selector** the moment any geometry rung exists (it is the thing that makes the bag safe — ship it early, even with K=2).
- Rungs 3–4 (accent graft, anchor-only) fall out cheaply. Add **H2 eye-frame** and **H4 front-terminus** hypotheses to the bag.

**Flagship:**
- Similarity-cranium + medial neck/limb re-skin + RotSprite for natural head fitting (biggest quality jump).
- Rung 1 TRUE MORPH (per-bone radius + spine interpolation), with its **variants tossed into the bag for cross-plan pairs** so the selector can occasionally pick a melted hybrid — the one cheap, ML-free path to genuine novelty.
- `variantIndex` grammar variety (CHIMERAGRAM).
- The ~50–150 flagship override table, scoped *after* the selector reports which species the bag actually fails on.

---

## Limitations

- **Mostly a sophisticated, well-registered transplant.** Genuine novel-silhouette output exists only at rung 1 and at the cross-plan morph-variant ballots; for most pairs it remains "B's body, A's head, harmonized." The render-K morph-variants nudge this toward melted hybrids *only where they score well* — honest, not magic.
- **The selector is heuristic, not a human eye.** Relative ranking reliably catches *structural* garbage (imploded silhouette, foldover, broken outline) and reliably surfaces the right hypothesis when it is in the bag; it does **not** catch "structurally fine but ugly." If the correct registration is in *no* hypothesis, ranking cannot invent it — coverage is bounded by the bag's diversity (H1–H4 + scales).
- **¾-view sprites** (Charizard, Lucario) still tilt the symmetry axis; socket center and accent placement can be a pixel or two off. The override table is the practical patch; the selector catches gross failures, not subtle viewpoint mismatch.
- **2-D medial axis has no depth.** A perspective-drawn head similarity-placed on a front-view body keeps its viewpoint and can look subtly off; viewpoint cannot be corrected.
- **Animation lerp assumes a roughly rigid head.** Two keyframes close the common bob; species whose head deforms heavily mid-cycle need the N-frame head-cap bake (cheap, but more memory).
- **Back sprites** have no face → geometry-only socket graft, no eye cross-check, H2 unavailable.
- **Occluded geometry** (a neck drawn merged behind an arm) has no clean socket or contact arc → drops to anchor-only or recolor.
- **Swarm/multi-blob bodies** (Magneton, Exeggcute) and radically alien plans always land on recolor — by design.

The net: it keeps the socket's by-construction defeat of float/scale/gap, **extends coverage to the neckless majority** and **launders confident-wrong detection** via render-K-and-rank, **stops tearing faces** by placing the cranium with a fold-proof similarity transform, **keeps animation** through a lerped two-layer composite, finishes everything as one coherently inked creature, and degrades along a *measured* ladder to the recolor you already ship — never garbage.