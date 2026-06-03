# Elite Redux — Free Public Hosting on Cloudflare (#218)

A complete, backend-less deployment of the Elite Redux client on Cloudflare's free
tier. The game runs in **Guest mode** (`VITE_BYPASS_LOGIN=1`): no PokeRogue account
server is needed, and saves live in the browser's `localStorage`.

**100% free, no credit card.** Pieces:

| Piece | Hosts | Free tier |
|-------|-------|-----------|
| **GitHub** | the code repo + a public `er-assets` repo (~530 MB) | free, no card |
| **Cloudflare Pages** | the built client (`dist/`) + small root files | unlimited static requests, no card |
| **jsDelivr** | the large asset folders, as a CDN over the `er-assets` repo | free, no card, no account |
| **Cloudflare Workers + KV** | the cross-player ghost-team API (#217, optional) | 100k req/day, no card |

> ⚠️ **Avoid Cloudflare R2.** R2's free tier still requires a credit card on file to
> activate. We use **jsDelivr over a public GitHub repo** for assets instead — same
> "free CDN" result, but genuinely no card. (The Pages Function proxies to it.)

> ℹ️ You run these steps with your own Cloudflare account — I can't deploy for you.
> Everything below is scaffolded in the repo (`.env.standalone`, `functions/`,
> `deploy/cloudflare/`, `workers/er-ghost-api/`).

## Why the split?

`vite build` sets `publicDir: false`, so the `assets/` directory is **not** copied
into `dist/`. The asset set (~93 MB images + ~430 MB audio) also blows past Pages'
20,000-file / per-deploy limits. The **big** folders live in a public GitHub
`er-assets` repo and are served through jsDelivr, then proxied at the same origin
by the root Pages Function (`functions/[[path]].ts`). The game's relative asset URLs are
unchanged — no client code edits, no risk to sprites.

## 1. Build the standalone client

```bash
pnpm install
pnpm build:standalone          # vite build --mode standalone  → dist/
```

This reads `.env.standalone` (Guest mode + optional ER endpoints). Edit that file
first if you want the ghost API / bug reporter wired (see below).

## 2. Stage Pages headers + function invocation routes into dist

```bash
# Headers and function invocation routes. _routes.json includes /*; the
# function calls next() for every non-asset request so the SPA still serves normally.
cp deploy/cloudflare/_headers dist/_headers
cp deploy/cloudflare/_routes.json dist/_routes.json
```

The Pages Function itself must stay in the repository root `functions/` directory;
Cloudflare Pages does not detect Functions copied into `dist/`.

## 3. Publish the big asset folders to a public GitHub repo (served by jsDelivr)

jsDelivr is a free global CDN that serves any file from a **public** GitHub repo —
no account, no card. Push the assets once (a local git step; resolves the symlinks):

```bash
mkdir er-assets && cd er-assets && git init
cp -r ../assets/audio ../assets/images ../assets/fonts ../assets/battle-anims ../assets/battle-anims-er .
cp -r ../public/images/* ./images/
git add . && git commit -m "Elite Redux assets"
# create a PUBLIC repo <you>/er-assets on GitHub, then:
git remote add origin https://github.com/<you>/er-assets.git
git push -u origin main
```

jsDelivr then serves them at `https://cdn.jsdelivr.net/gh/<you>/er-assets@main/...`
(no setup — it just works for public repos). Optionally tag a release (`@v1`) so the
URL is immutable.

## 4. Deploy to Pages + point the Function at jsDelivr

```bash
npx wrangler pages project create er-game
npx wrangler pages deploy dist --project-name er-game
```

Then set the asset CDN base so the Pages Function knows where to proxy:
**Dashboard → Pages → er-game → Settings → Environment variables →** add
`ASSETS_CDN_BASE = https://cdn.jsdelivr.net/gh/<you>/er-assets@main` (Production).
Redeploy.

Your game is now live at `https://er-game.pages.dev` (or your custom domain).

## 5. (Optional) Cross-player ghost teams (#217)

Deploy the ghost-team Worker and point the client at it:

```bash
cd workers/er-ghost-api && wrangler deploy     # see that folder's README
```

Then set in `.env.standalone` and rebuild:

```
VITE_GHOST_ENDPOINT=https://er-ghost-api.<subdomain>.workers.dev/ghost
```

Without it, ghost trainers fall back to the player's own local winning teams.

## 6. (Optional) Bug-report inbox (#220)

Create a free [Web3Forms](https://web3forms.com) access key (no backend; emails you
the report), then in `.env.standalone`:

```
VITE_BUGREPORT_ENDPOINT=https://api.web3forms.com/submit
VITE_BUGREPORT_KEY=<your-web3forms-access-key>
```

Without it, the in-game reporter still copies the report to the clipboard and
downloads it as a `.json` file for the player to send you manually.

## Notes & limits

- **Story Mode (LLM Director)** stays hidden as "Coming Soon" unless you also set
  `VITE_NANOGPT_API_KEY` + `VITE_NANOGPT_BASE_URL` at build time (#219).
- **Saves are local only** (no cloud sync in Guest mode) — clearing browser data
  wipes them. This is expected for a backend-less deploy.
- R2 free tier: 10 GB storage easily fits the ~530 MB assets; 1M reads/day is plenty
  for a community-sized audience (assets are `immutable`-cached, so repeat plays are
  served from the browser/edge cache, not R2).
- Update `index.html`'s OG/Twitter meta (currently `pokerogue.net`) to your URL for
  nice social previews.
- See `docs/plans/er-open-source-readiness.md` for the secrets audit before going public.
```
