# Shiny Lab

A standalone, self-contained web tool for prototyping **special-form shiny effects**
on any Elite Redux Pokemon sprite. Live (for the team): **https://shiny-lab.pages.dev**

It is the visual playground for the special-form shiny design
(`docs/plans/2026-06-27-special-form-shinies-design.md`): three combinable layers -
a crossplay-safe **Palette**, an on-sprite **Surface FX**, and an **Around FX** aura -
on a searchable picker over every species (sprites streamed from the er-assets CDN,
pinned sha, exactly like the game).

## Files
- **`fx.mjs`** - the whole effect engine: `PALETTE` (pure color funcs, crossplay-safe
  via the 32-slot variant swap), `AURA` (on-sprite surface shaders), `AROUND` (auras in
  the space around the mon), plus k-means cluster palettes, blend modes (`SURFACE_BLEND`),
  the seed/texture-scale params (`setFxParams`), and the "tint FX to palette" helper
  (`tintTo` / `NO_TINT`). Edit this to add or tune an effect.
- **`site/app.js`** - the live renderer: loads a sprite from the CDN, runs the `fx.mjs`
  math per pixel, drives the gallery + hero + controls (seed, texture, tint, blend).
- **`site/style.css`** - styling.
- **`build-site.mjs`** - bundles `fx.mjs` + `site/*` + the species list into one
  self-contained `articuno-shiny-lab.html` (+ `dist/index.html` for deploy).
- **`gen-previews.mjs`** - renders labeled contact-sheet PNGs of every effect on the
  Articuno sprite (eyeball without a browser, via `@napi-rs/canvas`). Companion
  `gen-cluster.mjs` / `gen-combo.mjs` / `gen-hd.mjs` render focused comparison sheets.
- **`EFFECTS.md`** - the effect catalog.

## Build / preview / deploy (run from the repo root)
```bash
# bundle the self-contained site -> shiny-lab/articuno-shiny-lab.html + shiny-lab/dist/index.html
node shiny-lab/build-site.mjs

# render contact sheets to eyeball effects (shiny-lab/contact-*.png)
node shiny-lab/gen-previews.mjs

# deploy to Cloudflare Pages (set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID first)
npx wrangler pages deploy shiny-lab/dist --project-name shiny-lab --branch main --commit-dirty=true
```

Build outputs (`dist/`, `contact-*.png`, `articuno-shiny-lab.html`) are gitignored -
regenerate them with the commands above. Sprites load from the er-assets CDN at runtime,
so the built HTML needs internet but no local assets.
