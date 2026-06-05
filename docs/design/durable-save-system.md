# Durable Save System — Architecture

Status: **proposal** (no code yet). Goal: players never lose progress to a
browser cache/site-data wipe, on a **free hosting tier**, without forcing a
heavyweight login.

---

## 1. The problem

Today the game stores everything in the browser's **localStorage** (session +
system save data). That's wiped by:

- "Clear site data" / "Clear cookies and site data",
- some privacy modes / aggressive cache cleaners,
- switching browser or device (no carry-over at all).

There is no server copy, so a wipe = total loss. We already tell players *not*
to clear site data, but that's a band-aid, not a fix.

---

## 2. Constraints

1. **Free tier only.** We're on Cloudflare's free plan. No credit card, must
   stay within free quotas (see §3).
2. **Low friction.** Most players should get durable saves *without* creating an
   account up front.
3. **Recoverable.** A player must be able to get their save back **after** a
   cache wipe or on a **new device** — that's the whole point.
4. **Single-player game.** No real-time multiplayer; anti-cheat is not a goal.
   We only need to stop *abuse* (spam, giant payloads), not cheating.
5. **Security.** The previously-used Cloudflare API token is **compromised and
   must be rotated** before any of this ships. Never commit tokens; use Wrangler
   secrets / Worker bindings.

---

## 3. Cloudflare free-tier quota reality (the important part)

| Product | Free limit (relevant) | Fit for saves? |
|---|---|---|
| **Workers** | **100,000 requests/day**, 10 ms CPU/req | ✅ API layer |
| **Pages** | unlimited static asset requests; Pages Functions share the Workers 100k/day | ✅ host the game |
| **Workers KV** | 100k reads/day but only **1,000 writes/day** | ❌ writes far too few for saving |
| **D1 (SQLite)** | 5 GB, 5M row-reads/day, **100k row-writes/day** | ✅ accounts/metadata |
| **R2 (object store)** | 10 GB, **1M Class-A (write) ops/month (~33k/day)**, 10M Class-B (read) ops/month, **zero egress** | ✅ the save blobs |

**Key takeaways:**

- **KV is a trap** here — 1,000 writes/day total would be exhausted by a handful
  of players. Don't store saves in KV.
- **R2 is the right home for save blobs** (a save is a JSON blob; R2 is built for
  blobs, has no egress fees, and ~33k writes/day). 
- **D1** holds the small relational stuff (account → save-slot index, recovery
  info, timestamps).
- **Workers** (100k req/day) is the gate. Every save/load is 1 request, so the
  real ceiling is request count, not storage.

### Capacity estimate (free tier)

Assume we **debounce** server writes (don't push on every action — push on
meaningful checkpoints: end of wave / shop / manual save, coalesced to at most
~1 push per ~30–60 s).

- R2 writes: 1M/month ÷ 30 ≈ **33k saves/day**. At ~30 server-saves per active
  player per day → **~1,000 daily-active players** before the R2 write cap.
- Workers: 100k req/day. At ~40 req/player/day (loads + saves + heartbeats) →
  **~2,500 DAU** before the request cap.
- So the **binding limit is ~1,000 concurrent-ish DAU** on pure free tier.

**Scale path when we outgrow it:** Workers Paid is **$5/month** and lifts Workers
to 10M req/month included + R2 writes to far higher tiers. One cheap step, no
re-architecture. (Document this; don't pre-optimize.)

---

## 4. Recommended architecture

```
 Browser (game)
   localStorage  ── source of truth for the active session (fast, offline-safe)
       │
       │  debounced sync (on checkpoints)
       ▼
 Cloudflare Worker  (REST API, the only public surface)
   ├── Auth: anonymous token  ➜  optional "claim" (username+pass OR Discord OAuth)
   ├── D1:  users, save_slots (id, owner, updated_at, size, checksum)
   └── R2:  save blobs  key = users/{userId}/{slot}.sav.gz
```

### 4.1 Identity model — anonymous-first, claimable

This is the crux of "no login but never lose your save."

1. **First load:** the Worker mints an **anonymous account**: a random `userId`
   + a long random `secret` (bearer token). Stored in localStorage. Saves start
   syncing immediately — **zero friction**.
2. **The catch:** if localStorage is wiped, that `secret` is gone too → the save
   would be orphaned. So we must let the player **anchor** their account to
   something they can reproduce:
   - **Option A — Recovery code:** show a one-time recovery phrase ("write this
     down to restore your save"). Simplest, no passwords, but users lose codes.
   - **Option B — Username + password:** classic. Password hashed (e.g. PBKDF2
     in the Worker), stored in D1. Recover from any device.
   - **Option C — Discord OAuth (recommended).** We already ship Discord links.
     "Link Discord to keep your save forever" is one click, nothing to remember,
     and ties the save to a stable identity. Free to implement on Workers.
3. **Recommended:** ship **anonymous + a prominent "Secure your save" prompt**
   offering **Discord link** (primary) and **username/password** (fallback).
   Nag gently after the first real progress (e.g. first run win).

### 4.2 Storage layout

- **R2** — one object per save slot: `users/{userId}/system.sav.gz` and
  `users/{userId}/session-{n}.sav.gz`. **gzip the JSON** before upload (saves
  are very compressible → smaller R2 + faster). Store a `checksum` + `updated_at`
  in metadata.
- **D1** — tiny tables:
  - `users(id, created_at, auth_type, auth_ref, pass_hash?)`
  - `save_slots(user_id, slot, updated_at, size, checksum, device_tag)`
  D1 is only touched on login + on the slot-index update, well under quotas.

### 4.3 Sync strategy

- **Local is authoritative for the live session.** The game keeps working fully
  offline; the network is a backup channel, never a blocker.
- **On load / login:** fetch the server's slot index. If server `updated_at` >
  local, offer to pull (or auto-pull if local is empty — the cache-wipe case).
- **On checkpoint:** debounce, then `PUT` the gzipped blob to the Worker, which
  writes R2 + updates D1. Coalesce rapid checkpoints into one push.
- **Conflict:** last-write-wins by `updated_at`, with a **device tag** so we can
  detect "two devices diverged" and show a one-time "keep this device / keep
  cloud" choice instead of silently clobbering. (Rare; only when the same account
  is actively played on two devices.)

### 4.4 Abuse / safety (not anti-cheat)

- **Size cap** on save blobs (e.g. reject > 512 KB compressed) — stops payload
  abuse and protects R2.
- **Per-token rate limit** (e.g. ≤ 1 write / 10 s, ≤ N/day) in the Worker — stops
  spam from burning the request/write budget.
- **Bearer secret** required on every write; scope each token to its own
  `userId` (a token can only read/write its own R2 prefix).
- **No public R2 bucket** — all access goes through the Worker binding.
- **Rotate the leaked Cloudflare token now**; move all secrets to
  `wrangler secret put` / dashboard env, never the repo.

---

## 5. Rollout phases

1. **P0 — Backup-only (lowest risk).** Keep localStorage as-is. Add anonymous
   account + a manual **"Back up to cloud"** and **"Restore from cloud"** in
   Manage Data (next to the existing Export/Import). Proves the Worker + R2 + D1
   path with zero gameplay coupling.
2. **P1 — Auto-sync.** Debounced auto-push on checkpoints; auto-pull when local
   is empty (the cache-wipe recovery path). Add the "Secure your save" prompt
   (Discord link + username/password).
3. **P2 — Cross-device.** Conflict UI (device tags), explicit account switch,
   "log in on another device."
4. **P3 — Polish.** Save-history/versioning in R2 (keep last K blobs for
   "undo a bad save"), if quota allows.

Ship P0 first — it already solves "I cleared my cache and lost everything" via a
manual restore, with essentially no risk to the running game.

---

## 6. Why this shape

- **R2 for blobs, D1 for the index, KV avoided** — matches each free quota to its
  job (KV's 1k-writes/day would otherwise be the silent killer).
- **Anonymous-first** keeps the funnel friction-free; the **claim/Discord link**
  is what actually makes saves survive a wipe.
- **Local-authoritative + debounced backup** keeps the game fast and offline-safe
  and keeps us well inside the 100k-req/day Worker ceiling.
- **One $5/mo step** is the entire scale story if we ever exceed ~1k DAU — no
  redesign.

---

## 7. Open decisions for you

1. **Primary "claim" method:** Discord OAuth (recommended, one-click, nothing to
   remember) vs username/password vs recovery-code. (Can ship more than one.)
2. **Auto-sync vs backup-only for the first release** (I recommend backup-only
   P0 first).
3. **Worker domain:** same domain as the game (Pages Functions) or a separate
   `api.*` Worker.
