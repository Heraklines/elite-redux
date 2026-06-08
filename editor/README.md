# Elite Redux — Team Data Editor

A static web tool that lets the team edit **egg moves** (learnsets/rarity to
follow) for the **full roster** (vanilla + ER customs) and commit the change
straight to the repo branch — with an optional one-click rebuild + deploy.

How it fits together:

```
 editor SPA (Cloudflare Pages, static)
   ├── reads game data from public GitHub raw (no auth)
   ├── "Save"            → er-editor-api Worker → MERGE-commits er-egg-moves.json
   └── "Commit & Deploy" → Worker commits, then fires the deploy-staging GitHub
                            Action (rebuilds the bundle, ships to elite-redux-staging)
```

The game reads `src/data/elite-redux/er-egg-moves.json` (loaded by
`er-egg-moves.ts`, which resolves both vanilla and ER-custom move names), so a
committed edit takes effect on the next build. The deploy button does that build
for you.

## Coverage

- **767 species**: 569 vanilla base species + 198 ER customs (739 have sprites).
- **1145 move options**: every vanilla move **and** every ER custom move.
- Each species shows its sprite + **4 text inputs**, each a type-to-filter
  dropdown (native `<datalist>`). Type part of a move name and pick it. Invalid
  names are flagged red.
- Saves are **deltas** — only changed species are sent, and the Worker merges
  them into the live file, so two editors won't clobber each other.

---

## One-time setup

### 1. (only if data changes) Regenerate the static data

```bash
node scripts/gen-egg-moves-json.mjs   # rebuild er-egg-moves.json from vanilla + ER
node scripts/gen-editor-data.mjs      # writes editor/data/species.json + moves.json
```

### 2. Create a GitHub token (the only secret you must make)

A **fine-grained PAT** on `Heraklines/elite-redux` with:

- **Contents: Read & write** (to commit the JSON)
- **Actions: Read & write** (so the deploy button can fire the workflow)

### 3. Add the deploy workflow's repo config

In the GitHub repo → **Settings → Secrets and variables → Actions**:

- Secret `CLOUDFLARE_API_TOKEN` — Cloudflare token with Pages:Edit
- Secret `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account id
- Variable `STAGING_SERVER_URL` — the staging save API base
  (e.g. `https://er-save-api-staging.<sub>.workers.dev`)

The workflow lives at `.github/workflows/deploy-staging.yml` and deploys to the
`elite-redux-staging` Pages project.

### 4. Deploy the Worker (commit + deploy backend)

```bash
cd workers/er-editor-api
npx wrangler secret put GITHUB_TOKEN      # the PAT from step 2
npx wrangler secret put EDITOR_PASSWORD   # shared password the team types to save
npx wrangler deploy
```

Confirm `GITHUB_BRANCH` / `GITHUB_WORKFLOW_FILE` in `wrangler.toml`. Note the
deployed URL (e.g. `https://er-editor-api.heraklines.workers.dev`).

### 5. Point the SPA at the Worker

In `editor/app.js`, set `WORKER_URL` and `BRANCH` to match.

### 6. Deploy the editor SPA to Cloudflare Pages

```bash
npx wrangler pages deploy editor --project-name er-editor --branch main
```

Share the Pages URL + the editor password with the team.

---

## Daily use (for the team)

1. Open the editor URL, type your name + the editor password.
2. Search for a species (vanilla or ER), set its egg moves (type to filter).
3. Either:
   - **Save** — commits to the branch (applies on the next deploy), or
   - **Commit & Deploy** — commits *and* rebuilds the staging site (live in a
     few minutes). With no pending edits, this just redeploys current.

## Notes / future

- The repo is public, so the SPA reads the live JSON directly; only writes go
  through the Worker (password-gated).
- Next: learnsets tab, rarity, and "add a species not yet in the table".
