# Shiny Lab Exotic FX - Handoff (2026-07-20)

**Branch:** `feat/shiny-lab-exotic-fx` (worktree `.worktrees/shiny-lab-exotic-fx`)
**HEAD SHA:** `73851c6c3af017da310b3d6386f6843395e051e5` (= `feat/elite-redux-port` base; all work is UNCOMMITTED in the working tree - commit only on explicit request)

## What shipped (Phase D)

Five survivor effects, each a different illusion/material system, graduated from 12 lab prototypes to the production registry. Renderer extended with cached, deterministic, non-destructive topology + stable animation anchors.

| ID | Category | Save index | Illusion | Mechanism |
|---|---|---|---|---|
| `gildedbones` | surface | 125 | specimen with a living gold skeleton | silhouette-only Voronoi midline field -> gold ramp over lacquer; anatomy, NOT noise (seed-independent) |
| `carvedrelief` | surface | 126 | sprite re-lit as chiseled stone | SDF-gradient normals + matcap sphere z -> key/rim lighting on original hue |
| `innerember` | surface | 127 | subdermal magma | inside-distance SDF -> inferno ramp, breathing per-pixel jitter (seed moves placement) |
| `nestedportrait` | surface | 128 | ghost plaque with a recursive self-portrait | frame-anchored chest window; sprite re-sampled into it, recursing once |
| `warpwell` | around | 106 | orbiting void lensing the sprite | stable-anchored horizon disc + pull-warped sprite copy (NOT the static locked `eventhorizon`) |

Append-only contract verified: PALETTE 138 (unchanged, ends `pentagalaxy`@137), SURFACE 125->129 (ends `phosphor`@124, new at 125-128), AROUND 106->107 (ends `paperlanterns`@105, `warpwell`@106). No existing index moved.

## Files changed

- `src/data/elite-redux/er-shiny-lab-renderer.ts` (+434): `fxGroup` option; `FxTopology` (sdf/voro/normals/tangents/matcapZ/pixId, lazy WeakMap-cached); `registerFxGroup`/`clearFxGroups`/`anchorsForGroup` (union-silhouette stable centroid+feet); `ctx.px/py/topo/anchors/frameSample/frameCount/frameIndex`; around-ctx gains stable anchors + topo + frame samplers.
- `src/data/elite-redux/er-shiny-lab-fx.ts` (+149): 4 `AURA.*` + 1 `AROUND.*` (untyped-arrow style, uses module-private `G` ramp table).
- `src/data/elite-redux/er-shiny-lab-effects.ts` (+24): append-only SURFACE/AROUND ids, LABELS (no em dashes), ACCENTS, and a new `export { PALETTE_IDS, SURFACE_IDS, AROUND_IDS }` (save looks encode by POSITION - never reorder).
- `tsconfig.json` (+6): `exclude` gains the two `src/dev-tools/shiny-lab-*` scratch files.
- NEW `test/tests/elite-redux/er-shiny-lab-exotic-fx.test.ts` (22 tests), `test/tests/elite-redux/er-shiny-lab-lab-anchors.test.ts` (3 tests), `scripts/shiny-lab-lab.mjs` + `lab-register.mjs` + `lab-loader.mjs` (real-renderer preview harness), `src/dev-tools/shiny-lab-{lab,prototypes}.ts` (dev-only scratch, tsc-excluded).

## Checks (all green)

- **tsc `--noEmit`: 244 errors, 0 in changed files.** Baseline is 277; the 33-error drop is the tsconfig exclusion of the two dev-only scratch files whose copied-compositor errors were counted in that 277. No production file regressed.
- **biome** `check --write` on all changed/new files: clean (one info-tier `noExcessiveCognitiveComplexity` in the exotic test, same tier the repo carries everywhere).
- **`git diff --check`:** clean.
- **Focused tests:** `er-shiny-lab-exotic-fx.test.ts` 22/22; `er-shiny-lab-lab-anchors.test.ts` 3/3 (stable anchor holds across a 4px hop; frame-local anchor documents the old wobble; fallback to frame anchors with no group).
- **Registry-complete:** 377/377 (every id resolves, differs from baseline disc).
- **Perf gate:** PASS. Medians vs category ceilings - gildedbones 0.80ms, carvedrelief 1.77ms, innerember 1.18ms, nestedportrait 1.12ms (surface ceiling 12.42ms); warpwell 2.39ms (around ceiling 28.65ms). All far under.

## Review artifacts (26 in `C:\Users\Hafida\Desktop\er-ui-review\`)

`shiny-lab-exotic-144-<effect>.gif` (5 animated Articuno, 73 frames each, real renderer), `shiny-lab-exotic-{144,25,94,6}-<effect>.png` (20 stills across Articuno/Pikachu/Gengar/Charizard proving no species hardcoding), `shiny-lab-exotic-144-original.png`.

## Rejection record (Phase A/B/C)

Phase A cataloged 20+ mechanisms (`2026-07-20-shiny-lab-exotic-fx-catalog.md`); Phase B built 12 through the real renderer; Phase C discarded 7 for colliding with banned equivalents (rainbow/aurora/galaxy/plasma/electric/circuit/stained-glass/kintsugi/constellation/glitch/hologram/halo/orbit/flame/fog/snow/ring/generic-particles) or failing 1x readability. Shortlist in `2026-07-20-shiny-lab-exotic-fx-shortlist.md`. `eventhorizon` was renamed `warpwell` after discovering the id is already taken by a locked achievement AROUND (index 52).

## Notes / scope kept

- No co-op files touched; no co-op workflows/tests run; no full matrix; no unrelated reds fixed; no commits.
- Effects derive from silhouette topology, so they work at 1x and on small/dark mons (verified Pikachu + Gengar); alpha/silhouette preserved (source-transparent stays 0, on-body stays 255); output stays inside padded bounds; deterministic (byte-identical re-renders).
