# Ghost-battle notifications — design (2026-06-21)

A notification framework whose first message type tells you when **your ghost
team fought / beat another player**, with a **team comparison** (your ghost's
team vs theirs). Toggleable in Settings. Built to be **quota-cheap** and to ship
with **zero disruption** to current prod saves or ghost gameplay.

## Why it's cheap + safe

The data is already in D1 (`er-save-api` `runs` table): every run records who
ended it (`ghost_source_name`/`ghost_source_run_id`) and both parties' teams
(`player_team`, `opponent_team`). So "did my ghost beat anyone" is a READ of
data already written by the victims' run POSTs — **no new write requests**, just
one read per login (gated by the setting).

The worker change is **purely additive** (verified against the existing code,
which already uses `CREATE TABLE IF NOT EXISTS` + lazy `ALTER TABLE ADD COLUMN`):
- new `ghost_battles` table (separate from `saves`/`runs` — saves untouched, no
  format change, no migration);
- the existing `POST /savedata/run` run-insert is byte-identical; a NEW optional
  block writes `ghost_battles` rows only when the new `ghostsFought` field is
  present, so **old prod clients are unaffected**;
- a new READ endpoint; existing endpoints unchanged;
- ghost *fighting* (`er-ghost-api` KV) is not touched.

**Rollout:** deploy the worker FIRST (atomic / zero-downtime, tolerates old+new
clients) → client to STAGING only → prod with explicit permission.

## Data contract

Client adds to the run snapshot it already POSTs:
```
ghostsFought?: {
  owner: string;        // ghost owner's username (ghost_source_name space)
  ownerRunId: string;   // the ghost's source run id (joins to their team)
  beaten: number;       // how many of MY mons this ghost downed
  endedRun: boolean;    // did this ghost end my run
}[]
```

Worker, on `POST /savedata/run` (after the unchanged run insert): for each
`ghostsFought` entry, `INSERT INTO ghost_battles (ghost_owner, owner_run_id,
victim, victim_run_id, beaten_count, ended_run, created_at)`.

Read: `GET /savedata/run/ghost-notifications?since=<ts>` (authed as A) →
`SELECT ... FROM ghost_battles WHERE ghost_owner = A AND created_at > ts
ORDER BY created_at DESC LIMIT N`, each joined to the victim's `runs.player_team`
(their team) + the ghost's `runs.player_team` (your ghost's team) for the
comparison. Client tracks `since` (last-seen ts) in localStorage → no write.

## Client pieces

1. Record `ghostsFought` during a run (each ghost wave: owner, ownerRunId,
   beaten count, whether it ended the run) and include it in the run POST.
2. On the title screen, if the setting is on, fetch notifications since last-seen.
3. A **bell icon + unread badge**; click → inbox list; click an entry → a
   **team-comparison panel** (your ghost's 6 vs the opponent's 6).
4. Setting "Ghost battle notifications: On/Off" (default On). Off ⇒ no fetch.

## Phasing

- **Phase 1:** worker (table + write + read endpoint) + client recording + inbox
  + comparison + setting. Covers BOTH "beat" and "fought" (the `ghost_battles`
  table records every ghost fought, not just the run-ender).
- Notification framework is generic so future message types plug in.

## Standing rule

Add a dev scenario / note for the in-game surfaces once built; worker gets a
smoke test before/after deploy.
