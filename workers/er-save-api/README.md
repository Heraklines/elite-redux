# Elite Redux — Cloud-Save + Account API (Cloudflare Worker + D1)

A free/low-cost backend that gives players **real accounts** (username + password)
and **cloud saves**, so progress survives a cache wipe, a new device, or a cleared
browser (#229). There is no login system today — saves live only in the browser's
`localStorage` — so this is the durable backstop.

It implements the subset of the PokéRogue `rogueserver` HTTP contract that the ER
client already speaks (`src/api/*`). Because the client already does all the login
+ save-sync work when login isn't bypassed, turning this on is mostly:

1. deploy this Worker,
2. point the client build's `VITE_SERVER_URL` at it,
3. build with `VITE_BYPASS_LOGIN=0`.

## Capacity (how many players this hosts)

The account is on the **Workers Paid plan**. D1 storage is **10 GB per database**
(er-saves currently sits at ~4% of that; the old free-tier **500 MB/db** cap no
longer applies — saves are stored uncompressed), and the paid write/read budgets
(**50M D1 writes/mo**, **~25B rows read/mo**, **10M Worker req/mo**) are far above
what the client's debounced sync (~40 writes/day per active player) needs:

| Tier | Daily-active players | Notes |
|------|----------------------|-------|
| **Workers Paid ($5/mo)** — current | **~40,000+** | Write count is the ceiling; debounced sync keeps 1k players ≈ 40k writes/day. Storage (~1 GB per 1k players) is a rounding error against the 10 GB/db ceiling. |
| Free tier (historical) | ~1,000–1,500 | 100k Worker req/day, 100k D1 writes/day, 5M rows read/day, 500 MB/db storage. |

KV is **not** used — its ~1,000 writes/day cap can't host saves. D1 is the right store.

## Routes (rogueserver-compatible)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/account/register` | – | Create account (`username`, `password` form fields). |
| `POST` | `/account/login` | – | Returns `{ token }`. |
| `GET`  | `/account/logout` | – | No-op 200 (tokens are stateless; client clears its cookie). |
| `GET`  | `/account/info` | ✓ | `{ username, lastSessionSlot, discordId:"", googleId:"", hasAdminRole }`. |
| `POST` | `/account/changepw` | ✓ | Change password (`password` form field). |
| `GET`  | `/savedata/system/get` | ✓ | Raw system save, or `404` for a new account. |
| `GET`  | `/savedata/system/verify` | ✓ | `{ valid:true }` (no server-side anti-cheat). |
| `POST` | `/savedata/system/update` | ✓ | Upsert system save (raw body). |
| `GET`  | `/savedata/session/get?slot=N` | ✓ | Raw session save, or `404`. |
| `POST` | `/savedata/session/update?slot=N` | ✓ | Upsert a session slot (raw body). |
| `POST` | `/savedata/session/coop-cas-update?slot=N&...` | ✓ | Create or advance one co-op checkpoint with exact compare-and-swap evidence. |
| `POST` | `/savedata/session/coop-cas-delete?slot=N&...` | ✓ | Delete one exact co-op checkpoint and retain its account-wide run tombstone. |
| `POST` | `/savedata/session/coop-duplicate-exact-delete?slot=N&...` | ✓ | Remove one duplicate only while its exact same-run survivor is still live. |
| `GET`  | `/savedata/session/coop-run-status?coopRunId=ID[&slot=N]` | ✓ | Account-scoped `{ state: "active" | "tombstoned" | "missing", ... }` proof used before fresh/resume launch. |
| `GET`  | `/savedata/session/delete?slot=N` | ✓ | Delete a session slot. |
| `POST` | `/savedata/session/clear?slot=N` | ✓ | Persist the cleared run, `{ success:true }`. |
| `GET`  | `/savedata/session/newclear?slot=N` | ✓ | `true`. |
| `POST` | `/savedata/updateall` | ✓ | Upsert system + one session in one batched write. |
| `GET`  | `/game/titlestats` | – | `{ playerCount, battleCount:0 }`. |
| `GET`  | `/daily/seed` | – | Per-UTC-day seed string. |
| `GET`  | `/devtest/progress` | – | Shared dev TEST-SUITE progress: `{ passed:[label…], recent:[event…] }`. |
| `POST` | `/devtest/event` | – | Append a test event (`kind` = PASS/FAIL/LOG/UNPASS, `scenario`, `comment`, `by` form fields). |

### Shared dev test-suite progress (staging only)

The in-game dev TEST SUITE (built only into the staging bundle, `VITE_DEV_TOOLS=1`)
mirrors every Pass / Fail / Send-Logs to `/devtest/*` so the QA team shares one
progress ledger — the scenario picker hides anything **anyone** has passed. The
backing D1 table `devtest_events` is **auto-created on first hit**, so an
already-deployed worker just needs a `wrangler deploy` to expose the routes — no
migration, no new env var (the client uses the existing `VITE_SERVER_URL`). These
routes are public (no account): the suite is staging-only and the data is
non-sensitive QA bookkeeping.

### Security model

- Passwords are stored **only** as a PBKDF2-HMAC-SHA256 hash (100k iterations,
  per-user 16-byte salt) — never in plaintext.
- Login returns a stateless token: `base64url(payload).base64url(HMAC-SHA256)`,
  signed with `SESSION_SECRET`. Verification is a pure HMAC check (no DB read),
  which keeps request cost low.
- Save blobs are opaque (the client encrypts them); the server never inspects them.

## Deploy (one-time)

```bash
cd workers/er-save-api
npm i -g wrangler            # or use: npx wrangler ...
wrangler login

# 1. Create the D1 database, then paste the printed database_id into wrangler.toml.
wrangler d1 create er-saves

# 2. Apply the schema (run BOTH so local `wrangler dev` and prod match).
wrangler d1 execute er-saves --file ./schema.sql            # local
wrangler d1 execute er-saves --remote --file ./schema.sql   # production

# 3. Set the token-signing secret (use a long random string, e.g. `openssl rand -hex 32`).
wrangler secret put SESSION_SECRET

# 4. Deploy
wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://er-save-api.<your-subdomain>.workers.dev`.

### Staging co-op route parity

The `Deploy Staging` workflow deploys `er-save-api-staging` first and the Pages browser bundle second from
the same checkout. This ordering prevents staging from publishing a newer client against an older save
contract. For a Worker-only recovery deployment, use:

```bash
cd workers/er-save-api
npx wrangler deploy --config wrangler.staging.toml
```

For `/savedata/session/coop-run-status`, a valid session token and a previously unseen valid `coopRunId`
must return HTTP 200 with exactly `{ "state": "missing", "runId": "..." }`. An authenticated 404 means
the staging Worker is older than the client contract; it must block the browser checkpoint instead of being
treated as an empty save slot.

> **Keep `SESSION_SECRET` stable.** Rotating it invalidates every issued token, so
> all players are silently logged out (their saves are untouched — they just log
> back in). Never commit the real value.

## Wire the game to it

Set these build-time env vars (e.g. in `.env.standalone` / the Pages build env), then
rebuild + redeploy the **client**:

```
VITE_SERVER_URL=https://er-save-api.<your-subdomain>.workers.dev
VITE_BYPASS_LOGIN=0
```

- Leave `VITE_DISCORD_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID` **unset** — the client
  hides the Discord/Google login buttons when they're absent, so players see a
  clean username/password login only.
- With `VITE_BYPASS_LOGIN=1` (today's default) the game stays 100% local — this
  Worker is ignored. So you can deploy the Worker first and flip the client later.

### Migration safety

Flipping `VITE_BYPASS_LOGIN=0` does **not** delete anyone's existing local save —
it changes which `localStorage` key the game reads (`..._<username>` vs `..._Guest`).
Existing players should use **Manage Data → Import** (or the in-game import flow,
#227) once after creating an account to push their local progress to the cloud.
Consider a one-time "import your old save" prompt before switching the default.

## Local dev

```bash
wrangler dev      # serves on http://localhost:8787
# point a local client build at VITE_SERVER_URL=http://localhost:8787 + VITE_BYPASS_LOGIN=0
```
