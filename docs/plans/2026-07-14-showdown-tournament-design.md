# Showdown Tournament Mode — Design (validated 2026-07-14)

Async bracketed tournaments on top of the shipped showdown stack (presets, lobby
pairing, authoritative results, server-attested settlements, rank ladder).
Decisions locked with the maintainer; do not relitigate.

## Locked decisions

| Decision | Choice |
|---|---|
| Format v1 | SINGLE ELIMINATION, byes for non-power-of-2 fields. |
| Round window | Self-scheduled ASYNC rounds (Smogon model, not PS live tours). Default 24h per round, CONFIGURABLE per tournament at creation (8h blitz .. 48h relaxed). Never require a fixed simultaneous time. |
| Stakes | NO ante in tournament matches — prize-only. The organizer funds rewards; nobody's collection is at risk for entering. |
| Organizer v1 | Admin-gated creation (maintainer account allowlist). Community-created later. |
| Theme | Pokemon World Tournament: reuse the PWT mystery-event background/music/chrome for the tournament screens. |

## Player flow

1. Title -> Showdown -> TOURNAMENTS entry (beside the Team Menu path; the Team
   Menu remains the plain-match entry).
2. Tournament list: open-for-registration + in-progress + recently finished.
   Register with one click (a saved team preset is REQUIRED to register — reuse
   the team-menu picker; the registered team is NOT locked until match start,
   players may re-pick from their presets per match).
3. Registration closes (organizer closes it or cap reached) -> bracket
   generates server-side (seeded by ladder rank when available, random
   otherwise; byes to top seeds).
4. Bracket screen (PWT-themed): the tree with mini icons/names/rank chips,
   YOUR next match card (opponent, deadline countdown, opponent last-seen),
   round status. Auto-refresh via polling the worker.
5. Playing a match: during your round window, enter the tournament lobby (the
   existing lobby flow constrained to your bracket opponent — you can ONLY pair
   with them). When both are present, normal showdown pairing runs (team from
   your presets, wager screen shows teams but NO ante) -> battle -> the
   authoritative result reports to the tournament worker -> bracket advances
   server-side.
6. Deadline resolution (automated): pairing deadline passes with no result ->
   activity win to the player who was PRESENT in the tournament lobby during
   the window (presence pings recorded server-side); neither present -> higher
   seed advances. Organizer manual override endpoint for disputes.
7. Champion: rewards granted through the EXISTING settlement mutation pipeline
   (same trusted client-apply used for stakes) — the organizer defines the
   reward list at creation (per-place mutation records: eggs, items, currency;
   shiny/species grants use the same grant vocabulary as stake transfers).

## Server (state + authority)

- Storage: NEW D1 tables in the er-telemetry worker (NOT er-saves — it is near
  its 500MB cap). Tables: tournaments (id, name, config, state, organizer),
  entrants (tournament, account, seed, preset name), matches (tournament,
  round, slot, players, deadline, result, resolution kind), presence pings.
- Routes (er-telemetry worker): create/close-registration/cancel (admin
  allowlist by account id), register/withdraw, GET tournament + bracket,
  presence ping, result report (called from the settlement/result path with the
  same attestation the escrow flow uses — a tournament result must come from a
  finished authoritative match between the two paired accounts), organizer
  override.
- The bracket advance is SERVER-side only; clients render what the worker says.
- Worker deploys: staging worker only, same rules as escrow.

## Client

- New UiModes/handlers: TOURNAMENT_LIST, TOURNAMENT_BRACKET (PWT-themed; find
  the PWT mystery-event's background/music keys and reuse). Render-harness
  recipes + goldens for: list (open/in-progress), bracket (8 and 16 fields,
  byes, mid-rounds), next-match card states (waiting/opponent-online/deadline
  soon), champion screen.
- Lobby constraint: entering via "Play tournament match" announces into the
  normal lobby flow tagged with the tournament match id; pairing accepts ONLY
  the bracket opponent (both sides verify; mismatch -> reject with message).
- Match flow: normal versus pipeline with ante suppressed (wager screen becomes
  team-preview + confirm; escrow endpoints not called for tournament matches).
- All flow edges follow the hardened offline-graph rules (noTransition modes,
  clear() hides containers, visibility-asserted realpath tests).

## Testing

- Bracket engine (pure): generation with byes, advance, deadline resolution,
  seeding — exhaustive unit tests incl. red-proofs.
- Duo harness: a full tournament match end-to-end (paired via constraint, no
  ante, result reports, bracket advances) with both engines.
- Worker: route tests per the escrow test pattern (attestation required on
  results, allowlist on admin routes).
- Renders: every screen state golden-gated.

## Phasing

- P1: worker tables/routes + bracket engine + tournament list/bracket UI +
  register + constrained pairing + result->advance. (A playable tournament,
  manually resolved deadlines via organizer route.)
- P2: automated deadline resolution + presence pings + activity wins + reward
  granting via settlement pipeline + champion screen.
- P3: polish (notifications, spectate/replays from telemetry, community
  creation, Swiss format).
