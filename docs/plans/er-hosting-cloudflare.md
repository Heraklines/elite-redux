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

## 4. Deploy with Cloudflare Pages' Git build

Do **not** deploy the local `dist/` with Wrangler. The local directory can easily
contain stale asset folders from earlier builds, and Cloudflare Pages rejects
deployments over 20,000 files. Use the Git-connected Pages build so CI creates a
fresh standalone `dist/` with the asset folders excluded.

In the Cloudflare dashboard:

1. Workers & Pages -> Create -> Pages -> Connect to Git.
2. Pick the `elite-redux` GitHub repo.
3. Build settings:
   - Framework preset: None
   - Build command: `pnpm install && pnpm build:standalone && cp deploy/cloudflare/_headers dist/_headers && cp deploy/cloudflare/_routes.json dist/_routes.json`
   - Build output directory: `dist`
4. Environment variables for Production:
   - `NODE_VERSION=24.9.0`
   - `ASSETS_CDN_BASE=https://cdn.jsdelivr.net/gh/<you>/er-assets@main`
5. Save and deploy.

The build log should include `Cloudflare Pages payload check passed` and a file
count well under 20,000. The Pages Function stays in the repository root
`functions/` directory; `_routes.json` is copied into `dist/` so every route can
reach the proxy function, which calls `next()` for non-asset requests.

Your game is then live at the Pages URL Cloudflare assigns, or at your custom
domain after you attach one.

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
- Keep R2 disabled for this setup. The large assets are served from jsDelivr over
  the public `er-assets` GitHub repo, so no card-backed Cloudflare storage is
  needed.
- Update `index.html`'s OG/Twitter meta (currently `pokerogue.net`) to your URL for
  nice social previews.
- See `docs/plans/er-open-source-readiness.md` for the secrets audit before going public.
```
