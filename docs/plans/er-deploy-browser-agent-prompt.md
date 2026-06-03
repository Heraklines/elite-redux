# Deploy Elite Redux for free — prompts

Two copy-paste prompts: one for **you** (accounts), one for your **browser agent**
(the deploy). Everything here is **free and needs no credit card**.

There are exactly two things that need a terminal (`git` + one build); everything
else is browser-dashboard clicking. If your agent has a terminal it can do it all;
if it's browser-only, you run the two `git push`es and it does the rest.

---

## PROMPT 1 — for YOU: create the accounts (5 min, no card)

> Create these two free accounts (do NOT enter any payment/credit-card info — none
> is required, and if any page asks for a card, that's the wrong/paid option; skip it):
>
> 1. **GitHub** — https://github.com/signup — pick a username, verify email. Free
>    forever for public repos. No card.
> 2. **Cloudflare** — https://dash.cloudflare.com/sign-up — email + password, verify
>    email. We only use **Pages** and **Workers** (both free, no card). **Do NOT
>    enable R2** (it asks for a card).
>
> Have ready: your GitHub username, and the local folder of this project.

---

## PROMPT 2 — for your BROWSER AGENT: deploy it

> You are deploying a Vite + Phaser web game (a PokeRogue fork called "Elite Redux")
> for free with no credit card. Accounts already exist: GitHub (username: `<GH_USER>`)
> and Cloudflare (email: `<CF_EMAIL>`). Project folder: `<PROJECT_PATH>`.
> NEVER enter credit-card info anywhere. Do NOT use Cloudflare R2. If any step
> demands a card, stop and report instead.
>
> ### A. Push two GitHub repos (terminal)
> 1. Code repo. In `<PROJECT_PATH>`:
>    ```
>    git init && git add -A && git commit -m "Elite Redux"
>    ```
>    Create a repo `https://github.com/<GH_USER>/elite-redux` (public is fine), then:
>    ```
>    git branch -M main
>    git remote add origin https://github.com/<GH_USER>/elite-redux.git
>    git push -u origin main
>    ```
> 2. Assets repo (the big files, served free by jsDelivr CDN). From `<PROJECT_PATH>`:
>    ```
>    mkdir ../er-assets && cd ../er-assets && git init
>    cp -rL ../<PROJECT_FOLDER>/assets/audio ../<PROJECT_FOLDER>/assets/images \
>           ../<PROJECT_FOLDER>/assets/fonts ../<PROJECT_FOLDER>/assets/battle-anims \
>           ../<PROJECT_FOLDER>/assets/battle-anims-er ./
>    cp -rL ../<PROJECT_FOLDER>/public/images/* ./images/
>    cp -L ../<PROJECT_FOLDER>/assets/*.json ../<PROJECT_FOLDER>/assets/*.webmanifest \
>          ../<PROJECT_FOLDER>/assets/service-worker.js ../<PROJECT_FOLDER>/assets/logo*.png ./ 2>/dev/null || true
>    git add -A && git commit -m "ER assets"
>    ```
>    Create a **public** repo `https://github.com/<GH_USER>/er-assets`, then:
>    ```
>    git branch -M main
>    git remote add origin https://github.com/<GH_USER>/er-assets.git
>    git push -u origin main
>    ```
>    (`-L` resolves the symlinked asset dirs into real files. The push is ~530 MB;
>    let it finish. jsDelivr will then serve them at
>    `https://cdn.jsdelivr.net/gh/<GH_USER>/er-assets@main/...` with no further setup.)
>
> ### B. Create the Cloudflare Pages project (browser dashboard)
> 1. Go to https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages**
>    → **Connect to Git** → authorize GitHub → pick the `elite-redux` repo.
> 2. Build settings:
>    - Framework preset: **None**
>    - Build command: `pnpm install && pnpm build:standalone && cp deploy/cloudflare/_headers dist/_headers && cp deploy/cloudflare/_routes.json dist/_routes.json`
>    - Build output directory: `dist`
> 3. **Environment variables** (Settings → add for Production):
>    - `NODE_VERSION` = `24.9.0`
>    - `ASSETS_CDN_BASE` = `https://cdn.jsdelivr.net/gh/<GH_USER>/er-assets@main`
> 4. **Save and Deploy**. Wait for the build to finish (a few minutes).
> 5. Open the live URL (e.g. `https://elite-redux.pages.dev`). Confirm the title
>    screen loads and you can start a run (sprites + audio load via jsDelivr).
>    Story Mode should appear as "Story Mode (Coming Soon)" and be unselectable.
>
> ### C. (Optional) Cross-player ghost teams — Cloudflare Worker + KV (free, no card)
> 1. Terminal, from `<PROJECT_PATH>/workers/er-ghost-api`:
>    ```
>    npm i -g wrangler && wrangler login
>    wrangler kv namespace create GHOSTS
>    wrangler kv namespace create GHOSTS --preview
>    ```
>    Paste the two returned ids into `wrangler.toml` (`id` and `preview_id`), then:
>    ```
>    wrangler deploy
>    ```
>    Copy the printed Worker URL (e.g. `https://er-ghost-api.<sub>.workers.dev`).
>    If Cloudflare asks for a card to deploy a Worker, skip this whole section —
>    ghost teams will just use each player's own local history.
> 2. Back in Pages → Settings → Environment variables, add:
>    `VITE_GHOST_ENDPOINT` = `https://er-ghost-api.<sub>.workers.dev/ghost`
>    Then **Retry deployment** so the client rebuilds with it.
>
> ### D. (Optional) Bug-report inbox — free, no card, no player account
> 1. Go to https://web3forms.com → enter your email → get a free **Access Key**
>    (no account/card; it emails reports to you).
> 2. In Pages → Settings → Environment variables, add:
>    - `VITE_BUGREPORT_ENDPOINT` = `https://api.web3forms.com/submit`
>    - `VITE_BUGREPORT_KEY` = `<your-web3forms-access-key>`
>    Then **Retry deployment**.
>
> ### Done
> Report the final Pages URL. The game is fully playable, free-hosted, no card.

---

## Notes
- The build runs **in Cloudflare's CI** from the code repo — you do not build locally.
- Saves are browser-local (Guest mode); no account server. This is expected.
- If a jsDelivr URL 404s right after pushing, wait ~1 min (first-fetch cache warm)
  or hard-refresh; jsDelivr fetches on demand from the public repo.
</content>
