# Shiny Lab exotic FX: Phase C shortlist + rejection record

Date: 2026-07-20. Branch: feat/shiny-lab-exotic-fx.
Evidence: dev-logs/shiny-lab-lab/sp{144,94,143,658,282,202,25}/gallery/*.png (real
production-pipeline renders, no approximate renderer) + sp144/lab_*.gif (all-68-frame
animated Articuno).

## Survivors (5, each a DIFFERENT illusion/material system)

| # | Lab id | Working title | Illusion / material system | Mechanism (fields) | 1x readability | Multi-species behavior | Perf (Articuno, avg ms/frame steady-state) | Rarity proposal |
|---|--------|---------------|----------------------------|--------------------|----------------|------------------------|--------------------------------------------|-----------------|
| 1 | lab:filigree | Gilded Skeleton | engraved gold inlay following the mon's TRUE midline; the ornament knows the anatomy | interior Voronoi border field + sdf | strong: crisp wire at any size | Articuno: wing spars + tail fan; Gengar: radial body star; Wobbuffet: single body axis (simpler but clean) | 0.63 | epic |
| 2 | lab:relief | Carved Relief | flat pixel art re-lit as cast metal / carved gem | matcapZ (sphere from sdf) + normals, fixed key light | strong: form pops at 1x | uniform; bulky Snorlax reads best, thin mons get edge relief only | 0.59 | rare |
| 3 | lab:core | Inner Ember | translucent skin over a breathing furnace; first subdermal material | sdf depth + vnoise + pixId breathe | strong: rim = skin, core glows | Gengar (dark body) spectacular; white mons need protect-white respect | 4.96 first-frame incl. prep; ~0.7 steady | epic |
| 4 | lab:droste | Nested Portrait | a dim ghost-plaque in the chest holds a recursive miniature of the mon itself | stable anchors + sa resample (2 levels) | good at 2x+; at 1x reads as a medallion (acceptable) | Snorlax/Articuno superb; tiny mons get a small plaque (bounded, never a hole) | 0.39 | legendary |
| 5 | lab:bendlens | Event Horizon | a small orbiting mass visibly bends the mon's own image + space around it | around-ctx spr sampling pulled toward stable-anchored orbit point | strong at 2x+; dark disc reads at 1x | universal (pad-space effect); needs pad headroom | 1.26 | legendary |

Around candidate policy: the brief allows AROUND to be absent. Only ONE
around survives (bendlens); it pairs naturally with droste (portal fantasy)
or stands alone as the exotic apex.

## Rejected prototypes (with reasons)

| Lab id | Concept | Why cut |
|--------|---------|---------|
| lab:echo | temporal echo of real adjacent frames | Even with change-detection gating, Articuno's idle loop is too subtle: the ghost is near-invisible in stills and reads as faint blur in motion. Not a "never seen before" look. |
| lab:shutter | frozen frame-0 specimen under glass | Same root cause as echo (idle frames too similar). On high-motion species it could work, but an effect that only fires on some species is a bad registry citizen. |
| lab:lens | through-body refraction | Reads as a mild smear at sprite scale; the dispersion fringe is 1px and aliases. The illusion ("body as lens") doesn't survive 72x81 resolution. |
| lab:clockwork | escapement gear windows under plumage | Cell-window concept worked but the ticking reads as random brightness noise at sprite scale; gear teeth (9px cells) alias into mush. Would need per-species tuning, violating "not hardcoded" rule of elegance. |
| lab:opalfire | real thin-film interference | Physics is real but the visual result is close to the banned "oilspill/iridescent" family: hue patches sliding over the body. Novel math, familiar look. Cut by the brief's equivalence rule. |
| lab:maelstrom | interior polar churn | On Articuno the twist is nearly invisible (idle loop + sdf-weighted rim-lock keeps motion tiny); on Snorlax it reads as gentle blur. "Glasspaperweight swirl" doesn't justify a slot. |
| lab:amber | fossil amber + trapped pose | Recolors the whole body to orange (palette-reskin adjacency) and the 3x-scaled trapped frame is unrecognizable at sprite size (dark smudge). The narrative doesn't survive the resolution. |

## Mechanisms never prototyped (Phase A inventory, cut pre-implementation)

8 (meridian pulse), 11 (nacre), 13 (impossible shadow), 14 (stitch pins),
15 (breathing chambers), 16 (frame-window collage), 17 (interior depth fog),
20 (anisotropic brushed gem), 21 (reflection below feet), 22 (Einstein ring).
Reasons recorded in the Phase A catalog doc section 4; 13/21/22 lost to the
"one image-outside-body survivor" rule, 10/11 to the interference-equivalence
rule, 3/20 to the one-lighting-survivor rule (relief won on silhouette
fidelity), 1/15 merged into core, 17 was vignette-adjacent.

## Composition proposals (coordinated sets serving ONE idea)

1. "Gilded Reliquary" (legendary): droste surface + bendlens around + gold-leaning existing palette (aurum). The mon as a shrine containing itself, orbited by bent space.
2. "Fossil Furnace" (epic): core surface + existing inferno-leaning palette at low amount. Subdermal ember.
3. "Saint's Relic" (epic): filigree surface + aurum/holy palettes. Anatomy-aware goldwork.
4. "Minted Icon" (rare): relief surface + copper/chrome palettes. Cast-metal statue.
