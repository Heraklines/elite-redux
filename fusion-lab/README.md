# Fusion Lab

A standalone, self-contained web tool for prototyping the **Elite Redux sprite-fusion
algorithm**. Pick **any two** Pokemon from the full roster - a **head donor (A)** and a
**body donor (B)** - run a fusion through pluggable algorithm strategies, and eyeball the
result with stage-by-stage debug layers and A/B comparison. Sibling of the **Shiny Lab**
(`shiny-lab/`). Intended to deploy to its own Cloudflare Pages project: **https://fusion-lab.pages.dev**.

We iterate the fusion algorithm here until it looks great, then port it to the game.

## Files
- **`fusion.mjs`** - the fusion engine: dependency-free image primitives plus the
  `STRATEGIES` registry. Each strategy is `{ id, label, params, fuse(a, b, p) }` and returns
  the final `ImageData` plus named debug layers. Edit this to add or tune a strategy.
- **`site/app.js`** - the live UI: loads the two sprites from the CDN, runs the selected
  strategy, and drives the two pickers, strategy select, params, hero canvases, debug-layer
  grid, and A/B compare.
- **`site/style.css`** - styling.
- **`build-site.mjs`** - bundles `fusion.mjs` + `site/*` + the species list into one
  self-contained `dist/index.html` for deploy. Same sha-pin + species enumeration as the
  Shiny Lab (sprites stream from the er-assets CDN, pinned sha, exactly like the game).

## Build / preview / deploy (run from the repo root)
```bash
# bundle the self-contained site -> fusion-lab/dist/index.html
node fusion-lab/build-site.mjs

# deploy to Cloudflare Pages (set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID first)
npx wrangler pages deploy fusion-lab/dist --project-name fusion-lab --branch main --commit-dirty=true
```

Build outputs (`dist/`, `contact-*.png`) are gitignored - regenerate them with the commands
above. Sprites load from the er-assets CDN at runtime, so the built HTML needs internet but
no local assets.
