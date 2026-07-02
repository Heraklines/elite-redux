# Fusion Lab — Implementation Plan (standalone sprite-fusion testbed, mirrors the Shiny Lab)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A standalone web tool — a sibling of the existing Shiny Lab — where you pick **any two** Pokémon from the **full roster**, run a fusion through *pluggable* algorithm strategies, and see the result with stage-by-stage debug layers and A/B comparison. Hosted on its own **Cloudflare Pages** project (`fusion-lab.pages.dev`) so the team can use it. We iterate the CHIMERA-FORGE algorithm here until it looks great, then port to the game.

**Architecture:** Clone the Shiny Lab's exact pattern: a vanilla-ESM static site bundled by `build-site.mjs` into one self-contained `dist/index.html`. Sprites stream at runtime from the er-assets CDN (jsDelivr, pinned sha) — no bundling, full roster, all combinations. A `fusion.mjs` engine holds unit-tested image primitives + a `FusionStrategy` registry; each strategy returns the final `ImageData` **plus named debug layers**. `site/app.js` is the UI (two pickers, strategy select, live params, hero canvases, debug-layer grid, A/B, batch contact-sheet).

**Tech Stack:** Vanilla ESM JS + `build-site.mjs` (no Vite/TS/framework — mirrors Shiny Lab), `node --test` for primitive unit tests (zero deps), Canvas2D/`ImageData`, Cloudflare Pages + jsDelivr CDN.

---

## Template to mirror (read these first)
- **`shiny-lab/build-site.mjs`** — the bundler. Our `fusion-lab/build-site.mjs` is a near-copy: same sha-pin (`git -C ../er-assets rev-parse HEAD`), same species enumeration (`../er-assets/images/pokemon/{dex}.png`, names from `src/enums/species-id.ts`), same `window.LAB = {cdn, species, def}` injection; inlines `fusion.mjs` + `site/app.js` + `site/style.css` instead of `fx.mjs`.
- **`shiny-lab/site/app.js`** — copy its `loadSpecies(id)` CDN sprite-loader verbatim (fetch `${CDN}/${id}.json` atlas → parse `textures[0].frames` → `loadImg(${CDN}/${id}.png)` with `crossOrigin="anonymous"` → slice frame to an RGBA buffer). Same datalist picker + prev/next/random.
- **`shiny-lab/README.md`** — the deploy command shape (`wrangler pages deploy <dist> --project-name <name> --branch main --commit-dirty=true`, needs `CLOUDFLARE_API_TOKEN`+`CLOUDFLARE_ACCOUNT_ID`).

## Locked decisions (veto any before we start)
1. **Lives at `C:\Users\Hafida\pokerogue\.worktrees\elite-redux\fusion-lab\`** — sibling to `shiny-lab/`, in-repo but its **own static site + own Pages project**, not part of the game bundle. "Separate, like the Shiny Lab."
2. **Vanilla ESM + `build-site.mjs`** (mirror Shiny Lab) — not Vite/TS. Keeps the team's deploy muscle-memory and reuses the proven pattern.
3. **Full roster from the CDN.** Enumerate every present `{dex}.png` (national dex 1–1025) at build → baked into the picker; sprites fetched from `https://cdn.jsdelivr.net/gh/Heraklines/er-assets@<sha>/images/pokemon/{dex}.png|.json` at runtime (verified: 200 + `access-control-allow-origin:*`, so `getImageData` is CORS-clean). ER-custom species (`elite-redux/<slug>`) deferred.
4. **Cloudflare Pages project `fusion-lab`** → `fusion-lab.pages.dev`. First deploy via local `wrangler`; optional CI workflow reusing the game's CF secrets.
5. **Reference design:** `docs/plans/2026-06-30-sprite-fusion-algorithm-design.md`. MVP strategies: (a) OKLab recolor *floor*, (b) socket-graft money path with H1 (skeleton pinch) + H3 (head-disk contact arc) + outline re-synthesis + recolor fallback.

---

## Phase 0 — Scaffold from the Shiny Lab template

### Task 0.1: Directory tree + bundler
**Files:** Create `fusion-lab/{build-site.mjs, fusion.mjs, README.md, .gitignore}`, `fusion-lab/site/{app.js, style.css}`.
**Steps:**
1. `.gitignore`: `dist/` and `contact-*.png` (match shiny-lab).
2. Copy `shiny-lab/build-site.mjs` → `fusion-lab/build-site.mjs`; change `DIR="fusion-lab"`, `<title>Fusion Lab</title>`, the header/legend markup (two pickers — see 0.2), inline `fusion.mjs` (strip `export`) **and** `app.js`, keep the species-enum + sha-pin blocks **verbatim**, write `fusion-lab/dist/index.html`.
3. Stub `fusion.mjs` (`export const STRATEGIES = []`), `site/app.js` (`console.log(window.LAB.species.length, 'species')`), minimal `style.css`.
4. `node fusion-lab/build-site.mjs` → prints `species <N> | sha …`; open `dist/index.html`, console shows the species count.
5. Commit: `feat(fusion-lab): scaffold from shiny-lab template`.

### Task 0.2: HTML shell — two pickers + canvases
In `build-site.mjs`'s HTML template: header with **A (head donor)** and **B (body donor)** datalist pickers (clone shiny-lab's `#mon`/`#monlist` twice → `#monA`/`#monB`), each with prev/next/random; a strategy `<select id="strategy">`; a "Fuse"/"Random pair" button; a `#stage` with three `<canvas>` (A, B, result, `image-rendering:pixelated`); a `#params` panel; a `#debug` grid; a `#compare` area. Rebuild, verify layout. Commit.

---

## Phase 1 — Sprite loader (mirror Shiny Lab, in `site/app.js`)

### Task 1.1: `loadSpecies(dex) → SpriteData`
Copy shiny-lab's loader. `SpriteData = {dex, name, width, height, rgba: Uint8ClampedArray}` from **frame 0** of the atlas (reconstruct the trimmed frame onto a `sourceSize` canvas — honor `spriteSourceSize`). Cache by dex. Wire the A/B pickers to load + draw onto the A/B canvases (×4 nearest zoom). 
**Verify (manual):** dev-open, pick Pikachu (25) and Gyarados (130) → both sprites render. Commit: `feat(fusion-lab): CDN sprite loader + A/B preview`.

---

## Phase 2 — `fusion.mjs` primitives (TDD via `node --test`)

> Pure functions on typed arrays — tested on hand-built tiny fixtures (e.g. a 5×5 mask), no DOM/CDN. Test file: `fusion-lab/fusion.test.mjs`. Run: `node --test fusion-lab/`. Math reference: design doc "Staged Pipeline". Commit after each.

- **2.1 `maskOf(rgba,w,h,aThresh=24)` + `components(mask,w,h,minPx=6)`** — alpha mask + CC despeckle. Test: 5×5 with a 1px speck → speck dropped.
- **2.2 `srgbToOklab`/`oklabToSrgb`** — round-trip within ε; white L≈1, black L≈0.
- **2.3 `quantizeOklab(rgba,w,h,max=24)` → {palette,indexMap,inkIndices,rampRoles}** — median-cut in OKLab; ink = dark + brighter-neighbor. Test: 2-color image → 2 entries, correct indices.
- **2.4 `edt(mask,w,h) → Float32Array`** — exact Felzenszwalb. Test: filled square → max at center; single pixel → correct edge distance.
- **2.5 `skeletonize(mask,w,h,dt) → {graph,prunedRatio}`** — Zhang–Suen + per-edge radius ρ(t). Test: straight bar → one edge, two endpoints.
- **2.6 `detectSockets(spriteData,analysis) → Socket[]`** — H1 pinch (`argmin ρ` w/ prominence) + H3 head-disk contact arc (always defined). Test: dumbbell mask → H1 socket at the neck, `width≈2ρ`.

---

## Phase 3 — Strategies (`fusion.mjs`)

- **3.1 Registry:** `STRATEGIES` array of `{id,label,params,fuse(a,b,p)→{image,layers,meta}}`. Commit.
- **3.2 `recolor` (baseline floor):** OKLab luminance-**role** transfer (keep base L, swap hue/chroma from donor's role-matched palette, `beta` param). Layers: base/donor palettes, role map. Test: self-fusion ≈ self; dims == base. This is also the universal fallback. Commit.
- **3.3 `socketGraft` (MVP money path):** analyze A+B (mask→cc→quantize→edt→skeleton→sockets); **render-2** (best H1 + best H3): place A's head plug at B's socket (`scale=W_socketB/W_plugA` clamped, translate, rotate to normal); cheap plausibility score → argmax; graft head over body, erase inherited outline, re-synthesize one 1px outline from merged alpha, re-stamp interior ink. Emit a debug layer per stage. **Fallback:** best score < `scoreFloor` → return `recolor` result, `meta.rung='recolor'`. Params: `scaleClampLo/Hi, overlapPx, scoreFloor` (all live sliders). Test: any pair → >0 opaque px, `meta.rung∈{graft,recolor}`, never throws. Commit.

---

## Phase 4 — UI (`site/app.js`)

- **4.1 Strategy select + live params:** populate `#strategy` from `STRATEGIES`; auto-build a slider per `strategy.params`; re-fuse on any change (debounced). Show `meta` (rung, score). Commit.
- **4.2 Debug-layer grid:** render every `result.layers[]` as a labeled, ×4 canvas in `#debug` — the core iteration surface. Commit.
- **4.3 A/B compare:** pick two strategies (or one at two param sets) → results side by side at matched zoom. Commit.
- **4.4 Batch contact-sheet:** "test all combinations" — render the chosen strategy across an N×N grid of pairs (a dex range or a curated stress-list) into a scrollable sheet, to spot systematic failures fast. A "download PNG" button (`contact-*.png`). Commit.
- **4.5 Random-pair + prev/next** wired to the A/B pickers (mirror shiny-lab). Commit.

---

## Phase 5 — Cloudflare Pages hosting (`fusion-lab.pages.dev`)

### Task 5.1: First deploy (local wrangler)
**Steps:**
1. `node fusion-lab/build-site.mjs` → `fusion-lab/dist/index.html`.
2. With `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` set (same creds as the game's CF secrets; Pages:Edit):
   `npx wrangler pages deploy fusion-lab/dist --project-name fusion-lab --branch main --commit-dirty=true`
   (creates the `fusion-lab` Pages project on first run → `https://fusion-lab.pages.dev`).
3. Open the URL; pick two species; confirm sprites stream from the CDN and a fusion renders. Share with the team.
4. Update `fusion-lab/README.md` with the build+deploy commands (clone shiny-lab/README). Commit (source only; `dist/` is gitignored).

### Task 5.2 (optional): CI deploy workflow
Add `.github/workflows/deploy-fusion-lab.yml` (manual dispatch) modeled on `deploy-staging.yml`: resolve er-assets HEAD sha → `node fusion-lab/build-site.mjs` → `cloudflare/wrangler-action@v3` `pages deploy fusion-lab/dist --project-name fusion-lab --branch main --commit-dirty=true` using `secrets.CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`. Lets the team redeploy without local creds. Commit.

---

## Definition of done (MVP)
- `fusion-lab.pages.dev` is live for the team.
- Pick **any two** of the full national-dex roster (searchable picker); sprites stream from the CDN.
- See the **recolor baseline** and the **socket-graft** result side by side, every pipeline stage visualized, params live.
- Socket-graft never throws and never renders garbage (recolor fallback below score floor).
- Batch contact-sheet renders a pair grid for fast across-the-board judging.
- `node --test fusion-lab/` green for all primitives.
- New approach = drop a strategy into `fusion.mjs` + register; zero UI changes.

## Out of scope (deferred until the core graft looks good)
Web Worker; animation (frame-mid socket lerp / two-layer composite); true-morph rung; H2/H4 hypotheses; per-species override table; ER-custom (`elite-redux/<slug>`) species; any in-game integration.
