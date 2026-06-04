# Elite Redux — Ghost-Team API (Cloudflare Worker)

A tiny, free backend for the cross-player **ghost-team gauntlet** (#217). Players'
finished teams are uploaded here; other players fight a sample of them as "ghost"
Veteran trainers in the endgame (Ace 1 / Elite 3 / Hell 8).

Runs entirely on Cloudflare's free tier: **Workers** (100k req/day) + **Workers KV**.

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/ghost` | Store a `GhostTeamSnapshot` (body = JSON). |
| `GET`  | `/ghost?difficulty=hell&count=8` | Return `{ teams: [...] }` — a random sample for that difficulty (falls back to any difficulty if empty). |
| `OPTIONS` | `/ghost` | CORS preflight. |

CORS is open by default (`ALLOWED_ORIGIN = "*"`); set it to your site origin to lock down.

## Deploy (one-time)

```bash
cd workers/er-ghost-api
npm i -g wrangler            # or: npx wrangler ...
wrangler login

# 1. Create the KV namespace (prod + preview) and copy the ids into wrangler.toml:
wrangler kv namespace create GHOSTS
wrangler kv namespace create GHOSTS --preview

# 2. Deploy
wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://er-ghost-api.<your-subdomain>.workers.dev`.

## Wire the game to it

Set the game's build-time env var to the Worker's `/ghost` endpoint:

```
VITE_GHOST_ENDPOINT=https://er-ghost-api.<your-subdomain>.workers.dev/ghost
```

(see `.env.standalone` in the repo root). Rebuild + redeploy the client. With this
unset, the game still works — it falls back to the player's **own** locally-stored
winning teams.

## Storage model

Keys are `ghost:<difficulty>:<zero-padded-timestamp>:<rand>`, so `list()` is roughly
oldest→newest. Each difficulty is capped at **500** teams (oldest pruned on insert).
Each value is a JSON `GhostTeamSnapshot` (a few KB), well under KV's 25 MB value limit.

## Local dev

```bash
wrangler dev      # serves on http://localhost:8787/ghost
```
