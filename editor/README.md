# Elite Redux — Team Data Editor

A static web tool that lets the team edit **egg moves** (learnsets/rarity to
follow) and commit the change straight to the repo branch. On the next game
deploy, the change is live.

How it fits together:

```
 editor SPA (Cloudflare Pages, static)
   ├── reads game data from public GitHub raw (no auth)
   └── POSTs saves → er-editor-api Worker → commits er-egg-moves.json to the branch
```

The game already reads `src/data/elite-redux/er-egg-moves.json` (loaded by
`er-egg-moves.ts`), so a committed edit takes effect on the next build/deploy.

## Move picker

Each species shows its sprite + **4 text inputs**, each a type-to-filter
dropdown (native `<datalist>` of all move names). Type part of a move and pick
it. Leave a slot blank to give the species fewer than 4 egg moves.

---

## One-time setup

### 1. Regenerate the static data (when species or moves change)

```bash
node scripts/gen-er-egg-moves-json.mjs   # only if migrating from the TS table again
node scripts/gen-editor-data.mjs         # writes editor/data/species.json + moves.json
```

### 2. Deploy the Worker (the commit backend)

```bash
cd workers/er-editor-api
# A fine-grained GitHub PAT with Contents: Read & Write on Heraklines/elite-redux:
npx wrangler secret put GITHUB_TOKEN
# A shared password the team types in the editor to save:
npx wrangler secret put EDITOR_PASSWORD
npx wrangler deploy
```

Confirm `GITHUB_BRANCH` in `wrangler.toml` is the branch you want edits committed
to. Note the deployed URL (e.g. `https://er-editor-api.heraklines.workers.dev`).

### 3. Point the SPA at the Worker

In `editor/app.js`, set `WORKER_URL` and `BRANCH` to match.

### 4. Deploy the editor SPA to Cloudflare Pages

```bash
npx wrangler pages deploy editor --project-name er-editor --branch main
```

Share the Pages URL + the editor password with the team.

---

## Daily use (for the team)

1. Open the editor URL, type your name + the editor password.
2. Search for a species, set its egg moves (type to filter).
3. Click **Save** — it commits to the branch. Heraklines deploys to apply.

## Notes / future

- The repo is public, so the SPA reads the live JSON directly; only writes go
  through the Worker (password-gated).
- Next: learnsets tab, rarity, and "add a species not yet in the table".
