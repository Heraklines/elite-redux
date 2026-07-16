# Elite Redux — Team Balancing Editor

A static web tool that lets the balancing team edit game data and commit the
change straight to the repo branch — with an optional one-click rebuild +
deploy. Four tabs:

| Tab | Edits | Override file (game reads it at init) |
|---|---|---|
| 🥚 Egg Moves | 4 egg moves per species | `src/data/elite-redux/er-egg-moves.json` |
| 📊 Species | egg rarity tier + starter cost | `src/data/elite-redux/er-species-tuning.json` |
| 🎒 Items | reward-pool tier, weight, ER item stack caps | `src/data/elite-redux/er-item-tuning.json` |
| 🤺 Trainers | Elite/Hell frequency knobs + factory set membership AND the sets themselves (click a species card to view/edit its 4-move sets) | `src/data/elite-redux/er-trainer-tuning.json` |
| 🎛 Game | 62 validated balance knobs (shiny/candy/eggs/money/curves...) | `src/data/elite-redux/er-balance-tuning.json` |
| ➕ Add a Mon | whole new species: stats, types, abilities, moves, cost - plus a sprite studio that generates tier-2/3 shinies by hue rotation from an uploaded front/back | `src/data/elite-redux/er-custom-mons.json` + sprites committed to `Heraklines/er-assets` |

The **Assets** tab imports YouTube videos or playlists into the battle-music
catalog and uploads reusable trainer sprites. Music metadata is stored in
`editor/data/bgm.json`; trainer-sprite metadata is stored in
`src/data/elite-redux/er-custom-trainer-sprites.json`; binary media is committed
to `Heraklines/er-assets`.

How it fits together:

```
 editor SPA (Cloudflare Pages project "er-editor", static)
   ├── reads game data from public GitHub raw + jsDelivr (no auth)
   ├── "Save"            → er-editor-api Worker → MERGE-commits the er-*.json file(s)
   └── "Commit & Deploy" → Worker commits, then fires the deploy-staging GitHub
                            Action (rebuilds the bundle, ships to elite-redux-staging)
```

The tuning files are ADDITIVE overrides: an absent key means the game keeps its
current/vanilla value. The Worker only ever writes the whitelisted er-*.json
files, merges deltas server-side (two concurrent editors can't clobber each
other), and `null` deletes an override.

## Coverage

- **Species roster**: EVERY starter-selectable species (vanilla starters + the
  ER customs the init chain leaves in the grid), each with sprite, dex number,
  usage-tier badge, current egg tier and starter cost. Sort by Name / Dex No. /
  Usage Tier; type-to-filter search.
- **Usage tiers** are fetched at runtime from the same nightly
  `er-assets/usage-tiers.json` the game uses; when unavailable everything shows
  as "unranked" (purely cosmetic).
- **Items**: the player reward pool. Items with a party-dependent (dynamic)
  weight are flagged; entering a number replaces the dynamic weight with a
  constant, clearing the box restores it.
- Saves are **deltas** — only changed keys are sent.

---

## Regenerating the static data

```bash
# moves.json (regex-parsed from source, no build needed):
node scripts/gen-editor-data.mjs

# species.json + items.json + trainers.json (dumped from the LIVE runtime
# tables after the full init chain — this is what fixed the missing-starter
# gap; the old egg-move-key roster dropped e.g. Pikachu):
ER_SCENARIO=1 npx vitest run test/tests/elite-redux/tools/dump-editor-data.test.ts
```

Re-run when species/moves/items/factory sets change materially. The SPA
overlays the live er-*.json overrides at load, so a stale snapshot only
affects NEW species/items, not current values.

## One-time setup

### 1. Create a GitHub token (the only secret you must make)

A **fine-grained PAT** covering BOTH `Heraklines/elite-redux` AND
`Heraklines/er-assets` with:

- **Contents: Read & write** (to commit the JSON, and the Add-a-Mon sprites
  into er-assets)
- **Actions: Read & write** on elite-redux (so the deploy button can fire the
  workflow)

If the PAT only covers elite-redux, everything works EXCEPT Add-a-Mon's sprite
upload (it fails with "assets repo read failed: 404" until the token is
extended).

### 2. Add the deploy workflow's repo config

In the GitHub repo → **Settings → Secrets and variables → Actions**:

- Secret `CLOUDFLARE_API_TOKEN` — Cloudflare token with Pages:Edit
- Secret `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account id
- Variable `STAGING_SERVER_URL` — the staging save API base

- Secret `ER_ASSETS_TOKEN` - fine-grained PAT with Contents read/write on
  `Heraklines/er-assets` for the media-import runner
- Optional secret `YOUTUBE_API_KEY` - improves Creative Commons versus standard
  YouTube license detection. Imports remain marked `unknown` when neither the
  API nor page metadata exposes a license.

The workflow lives at `.github/workflows/deploy-staging.yml` and deploys to the
`elite-redux-staging` Pages project.

### 3. Deploy the Worker (commit + deploy backend)

```bash
cd workers/er-editor-api
npx wrangler secret put GITHUB_TOKEN      # the PAT from step 1
npx wrangler secret put EDITOR_PASSWORD   # shared password the team types to save
npx wrangler deploy
```

Confirm `GITHUB_BRANCH` / `GITHUB_WORKFLOW_FILE` in `wrangler.toml`. Note the
deployed URL (e.g. `https://er-editor-api.heraklines.workers.dev`).

### 4. Point the SPA at the Worker

In `editor/app.js`, set `WORKER_URL` and `BRANCH` to match.

### 5. Deploy the editor SPA to Cloudflare Pages

```bash
npx wrangler pages deploy editor --project-name er-editor --branch main
```

(This is the editor's OWN Pages project — it never touches the game's
staging/production deploys.) Share the Pages URL + the editor password with
the team.

---

## Daily use (for the team)

1. Open the editor URL, type your name + the editor password.
2. Pick a tab, search for what you want to change, edit it (invalid values
   are flagged red).
3. Either:
   - **Save** — commits to the branch (applies on the next deploy), or
   - **Commit & Deploy** — commits *and* rebuilds the staging site (live in a
     few minutes). With no pending edits, this just redeploys current.

On the **Assets** tab, playlist videos become separate tracks. Long videos split
on YouTube chapters or timestamp lists in the description; a mix without either
remains one track and is marked for manual splitting. Each imported track records
its source, attribution text, and detected license. Trainer images are converted
to transparent, tightly cropped PNG atlases before upload, then become selectable
without changing the trainer's gameplay class.

## Notes / future

- The repo is public, so the SPA reads the live JSON directly; only writes go
  through the Worker (password-gated, whitelist of er-*.json paths).
- Next: learnsets tab, per-set factory editing, "add a species not yet in
  the table".
