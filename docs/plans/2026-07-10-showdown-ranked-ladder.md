# Showdown Ranked Ladder (Pokemon-Champions-style) — implementation note

Status: CORE landed (ladder model + server endpoints + client wiring + reward hooks).
Un-defers the "rankings" item explicitly parked in `2026-07-06-showdown-mode-implementation.md`.

## What shipped (core, this change)

### 1. Ladder model — the heart (pure, engine-free, exhaustively tested)
`workers/er-save-api/src/showdown-rank.ts` (no Cloudflare deps; imported by
`test/tests/elite-redux/showdown/showdown-rank.test.ts`, 31 cases, all green).

- Tiers `pokeball -> greatball -> ultraball -> masterball -> champion` (0..4). Ranks 4->3->2->1
  within a tier; champion is a single rank. `SEGMENTS_PER_RANK = 4` (gauge 0..3).
- Win `+1` segment; a 4th+ consecutive win (streak already >= 3) grants `+2`. Loss `-1`,
  streak resets. Segment overflow ranks up (rank 1 overflow crosses to the next tier's floor);
  underflow ranks down.
- **Tier floor**: a loss at rank 4 segment 0 of the current tier is absorbed — tier is monotonic
  within a season (never demote below a tier once reached).
- **Seasons**: `seasonId = "YYYY-MM"` from server time. The first ranked action of a new season
  hard-resets to the pokeball floor; `careerBestTier` persists, seasonal `highestTierReached` resets.
  The prior season's final tier is surfaced once for the season-end hook (server-computed, lazy —
  fires on the first login or match of the new season via `reconcileSeason`).
- **First-week gate**: during days 1-7 (UTC) of a season, progression clamps at masterball rank 4
  (champion + masterball rank 3+ are gated). Overflow is discarded, not banked (matches Champions).
- **Anti-win-trading** (our deviation for invite-based matches): per season, wins vs a GIVEN opponent
  give full segments for the first 3, half (round down, min 0 — alternating 1/0 for an odd base gain)
  for wins 4-6, and zero from win 7+. Losses are always full and never touch the opponent counter.
- **Dual attestation** (`applyRankReport`, mirrors `showdown-escrow.ts`): a ranked result applies only
  when both clients report the same winner; a conflict voids with no rank change. A single lying
  client can never self-promote.

### 2. Server (workers/er-save-api)
New D1 tables (self-create on first `/showdown/rank*` hit via `ensureShowdownRankTables`, listed in
`schema.sql` so a fresh DB matches):
- `showdown_ranks(uid PK, season_id, tier, rank, segments, streak, highest_tier, career_best, updated_at)`
- `showdown_rank_opponents(uid, opponent_uid, season_id, wins, PK(uid,opponent_uid))` — anti-win-trading.
- `showdown_rank_matches(id PK, host_uid, guest_uid, state, host_report_json, guest_report_json, winner, ...)`
  — the dual-attestation reconciliation ledger.
- `showdown_rank_events(id PK, uid, match_id, events_json, created_at, consumed_at)` — the non-settling
  reporter's reward events, drained on its next GET.

Endpoints (both authed):
- `GET /showdown/rank` -> `{ ok, state, seasonEndedFinalTier, pendingEvents }`. Lazily reconciles a season
  boundary (writes back + surfaces the prior final tier), then drains queued reward events for the caller.
- `POST /showdown/rank/result` body `{ matchId, hostUid, guestUid, winner: "host"|"guest" }` ->
  `{ ok, resolution: "pending"|"settled"|"void", state?, events? }`. Reported by BOTH clients (dual
  attestation). On settle, applies progression to BOTH rank rows (winner gains, loser loses, each the
  other's opponent) and returns the caller's events inline; the other participant's events are queued.

Not deployed — code + local unit tests only (maintainer runs `wrangler deploy`, same as the escrow/devtest
precedent). Ranked counts only when both clients flagged ranked at wager commit.

### 3. Client
- `showdown-rank-types.ts` — shared state type + engine-free display helpers (tier ball frame on the "pb"
  atlas, tier/rank labels).
- `showdown-rank-client.ts` — best-effort fetch wrappers (`fetchMyShowdownRank`, `reportShowdownRankResult`);
  fans a settled report's server-computed events out to the hook registry. `isRankServerConfigured()` gates
  the wager toggle.
- `showdown-rank-card.ts` — reusable RANK CARD (tier ball emblem + rank label + segment gauge + streak),
  placed on the Team Preset Menu (`showdown-team-menu-ui-handler.ts`) and the wager screen
  (`showdown-wager-ui-handler.ts`).
- Wager screen — ranked opt-in toggle (R), synced via the new `showdownRankedOptIn` wire message; ranked is
  in effect only when BOTH opt in, riding the existing both-locked commit barrier. The host mints the shared
  ranked-match id (guest adopts). Server-unreachable/unconfigured -> the toggle is disabled with a hint,
  never blocking casual play.
- `ShowdownResultPhase` — reports the decisive outcome to `/showdown/rank/result` when ranked and not voided;
  voided matches never count. Fire-and-forget + fully guarded (never strands the return to title).

### 4. Reward hooks (registry only — NO achievement-file edits)
`showdown-rank-events.ts` exposes a subscribe/emit bus the achievements layer wires into LATER, without this
change touching `achv.ts` / `er-achievement-*` / `achv-category.ts` / locales `achv.json` /
`er-shiny-lab-effects.ts` (owned by a parallel agent):
- `onRankedTierFirstReached(tier)` — career-first promotion.
- `onRankedSeasonEnd(finalTier)` — season rollover (server-computed, lazy).
- `onRankedMatchWin()` — per confirmed ranked win.

## Intended reward mapping (the mechanical follow-up)
When the achievements agent subscribes to the registry, map:

| Hook                                   | Reward |
| -------------------------------------- | ------ |
| `onRankedTierFirstReached(greatball)`  | Plus voucher + trainer title |
| `onRankedTierFirstReached(ultraball)`  | Premium voucher + ranked-exclusive shiny-lab effect |
| `onRankedTierFirstReached(masterball)` | Epic egg + trainer title |
| `onRankedTierFirstReached(champion)`   | Tier-2 shiny + exclusive Champion aura |
| `onRankedSeasonEnd(finalTier)`         | Candy / eggs scaled by `finalTier` |
| `onRankedMatchWin()`                   | Incremental ranked-win-count achievements |

Because the server already computes career-first promotions and the season-end final tier, the follow-up is
purely: subscribe in the achievements layer -> grant the mapped reward -> (optionally) enqueue a notification.

## Residuals / follow-ups
- **Worker deploy pending** (maintainer): `cd workers/er-save-api && npx wrangler deploy` — no new secret,
  binding, or migration (tables self-create).
- **Achievements wiring pending** (parallel agent): subscribe to `showdown-rank-events` per the table above.
- **Titles surface**: Champions grants trainer titles at promotions. ER has no trainer-title display surface
  yet (no title/badge field on the trainer/profile card was found), so the title persistence field is a
  follow-up — the reward hook fires today; where to *show* a title needs a profile-card surface first.
- **Render-harness recipe**: the rank card fetches its state over the network, so a headless render shows the
  neutral "Unranked" card. A `showdown-rank-card` render recipe (stub state) would let the golden-image gate
  cover its layout; not added here.
```
