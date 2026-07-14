# Player Telemetry - Schema v1 + Pipeline Design (#player-telemetry)

Status: staging-gated, prod-off. Client recorder + Cloudflare Worker ingest + R2 store.
Purpose: capture how REAL players play, in every mode, as a machine-learning dataset for
training a combat AI. See the sibling roadmap `docs/plans/combat-ai-roadmap.md` for how this
dataset feeds the model program.

## 1. Why - the ML framing (state, action) pairs

The dataset exists to train a policy that, given a battle position, predicts the action a good
human takes. So the schema is built as **(state, action) pairs from day one**: every battle
decision is captured with BOTH the full both-sides field state AND the action the player
committed, so a single event is a supervised training example that needs **no join to any
external data** to reconstruct.

- `TelemetryBattleDecisionEvent` = one training example: `state` (both sides' field) + `action`
  (move / switch / ball / run) for one field slot.
- `TelemetryTurnOutcomeEvent` = the resolved field after the turn, so state -> action -> next-state
  transitions are learnable (for value/return estimation and offline RL).
- Surface + input events give the non-battle decision distribution (reward picks, ME options,
  shop, party management) and the low-level interaction stream.

Schema version is `TELEMETRY_SCHEMA_VERSION = 1` (`src/data/elite-redux/telemetry/telemetry-schema.ts`),
stamped into every session envelope and every stored R2 object's metadata. Bump on an incompatible
wire-shape change; grow additively otherwise.

## 2. What is captured

Envelope (once per session, a session == one run):

| field | meaning |
|-------|---------|
| `schemaVersion` | 1 |
| `sessionId` | random per-run id (also the R2 key `{sessionId}` segment) |
| `playerIdHash` | **pseudonymous** salted hash of the account id (never the raw username) |
| `build` / `erVersion` | client + ER mod version |
| `mode` | `solo` \| `coop` \| `showdown` |
| `gameModeId` | `GameModes` value |
| `seed` | run RNG seed |
| `difficulty` | ER difficulty (`youngster`..`hell`/`mystery`) |
| `startedAt`, `ua?` | session start ms, coarse user-agent |

Events (each carries `t` epoch-ms + `wave`):

- **`battle_decision`** - `actor` (`self`/`partner`), `slotFieldIndex`, `state`, `action`.
  - `state` = `{ wave, biome, turn, weather, terrain, player[], enemy[] }`.
  - Each `MonState` = `species, form, level, hp, maxHp, status, statStages[7], ability,
    innates[] (the ER four-ability innate set), heldItems[], moves[], active, fainted, actor?`.
  - Each `MoveState` = `move, type, power, ppUsed, maxPp` (featurized, not just an id - so an
    attribute-based model can consume it directly; see the roadmap).
  - `action` = `{move, moveIndex, moveId, target?}` \| `{switch, partyIndex}` \| `{ball, ballIndex}` \| `{run}`.
- **`turn_outcome`** - `{turn, state, faints[]}` at turn end (the resolved position + which field
  slots fainted, e.g. `p0`, `e1`).
- **`surface_open`** - `{uiMode, uiModeName, options[], actor}`: an interactive menu opened + the
  option labels offered.
- **`surface_choice`** - `{uiMode, uiModeName, chosenIndex, chosenLabel, actor}`: the option picked.
- **`input`** - `{code, uiMode}`: a raw button/key press as a compact code (cheap, low-level signal).

Co-op: the client records BOTH its own decisions/surfaces (`actor:"self"`) AND what it observes of
the partner (`actor:"partner"`), tagged by comparing the interaction/mon owner to `controller.role`.

## 3. How it is captured (chokepoints, observer-only)

Capture is passive - it never mutates engine state, RNG, or command resolution, and every tap is a
hard no-op unless a telemetry build is recording (a single `session != null` gate). Seams:

- `src/ui/ui.ts` `setModeInternal` - emits `er-telemetry-surface` (surface open + options) at the one
  mode-transition chokepoint (UI is already a Phaser `EventEmitter`).
- `src/ui/ui.ts` `processInput` - emits `er-telemetry-input` (raw input).
- `src/ui/handlers/abstract-option-select-ui-handler.ts` - emits `er-telemetry-choice` on the commit.
- `src/phases/command-phase.ts` - `recordTelemetryDecision(...)` next to the existing replay taps:
  self decision (all modes) + the observed co-op partner decision.
- `src/phases/turn-end-phase.ts` - `recordTelemetryTurnOutcome()` after `incrementTurn()`.

Modules (`src/data/elite-redux/telemetry/`): `telemetry-schema.ts` (pure types), `telemetry-state.ts`
(pure snapshot), `telemetry-store.ts` (durable store), `telemetry-queue.ts` (batching/flush/recovery),
`telemetry-transport.ts` (compress + POST/beacon), `telemetry-recorder.ts` (gate + session), and
`telemetry-hooks.ts` (the only engine-coupled module; init + taps + subscriptions).

## 4. Durability + transport model

**At-least-once delivery, best-effort final beacon, guaranteed next-session recovery, bounded local
retention.**

- **Durable local queue (source of truth):** events append in real time to **IndexedDB** (chosen over
  localStorage on purpose - the save system already strains localStorage quota; telemetry must not
  compete there). Appends are debounced into small store writes.
- **Rare uploads:** a batch is flushed only at meaningful boundaries - every **~10 waves**, **~15 min**,
  a **~256 KB** pending-size threshold, or **session end** (pagehide / visibilitychange). Target
  **<= ~4-6 requests per player-hour**, well under the free-tier 100k req/day Worker cap.
- **Session-end beacon:** `navigator.sendBeacon` ships the in-memory tail synchronously on pagehide
  (a beacon cannot set headers, so the session token rides the `?t=` query param).
- **Next-session recovery:** on boot, any events a prior session left unflushed (crashed tab, failed
  beacon) are uploaded as recovery batches under their **original** `sessionId` + `mode` + envelope
  (persisted in the store), so the R2 layout stays correct. A monotonic `seq` keeps late old-session
  batches from colliding.
- **Bounded retention:** the local store is capped (~20 MB) with **oldest-first eviction**, so a player
  who never reconnects can't grow it unbounded.
- **Compression:** gzip via `CompressionStream` (matches the `.jsonl.gz` key), with lz-string
  `compressToBase64` as a fallback (marked `enc=lz` in metadata).
- **Fail-silent:** every path swallows errors and drops on failure - telemetry can NEVER affect
  gameplay. Duplicates are possible (at-least-once) and de-duplicated offline by
  `(sessionId, seq, event-index)`.

## 5. Worker ingest + R2 layout

`POST /telemetry/ingest` on `workers/er-save-api` (`src/telemetry.ts`):

- **Auth:** the SAME stateless session-token check as the savedata endpoints (header, or `?t=` for
  the beacon path). 401 when unauthenticated.
- **Size cap:** ~1 MB per batch -> 413.
- **Rate limit:** simple per-user in-memory budget (40 / 60s) -> 429.
- **Fail-soft:** 503 when the R2 binding is not yet bound (R2 not enabled on the account) - the client
  drops, gameplay is unaffected.
- **Write:** the compressed body is stored VERBATIM (never inspected) under

```
{yyyy-mm-dd}/{mode}/{sessionId}/{seq}.jsonl.gz
```

  with custom metadata `{ userIdHash, build, schemaVersion, enc, uploadedAt }`. Every key segment is
  sanitized (no traversal).

Partitioning by day + mode makes the offline ML pipeline's reads cheap (scan a day, or a mode).

## 6. Privacy

- The payload carries a **pseudonymous** `playerIdHash` = a salted hash of the account id
  (`VITE_TELEMETRY_SALT`); a guest / bypass-login client hashes its per-session random id instead.
- The **raw username / email is NEVER** written into a payload or an R2 object / its metadata. The
  authenticated username is used only for the worker's in-memory rate-limit key and is not persisted.
- Only gameplay state + decisions + coarse client info (build, user-agent) are captured. No chat, no
  free text, no account credentials.
- Staging-only for now; a prod enablement is an explicit, separate decision (see below) and should be
  accompanied by a player-facing privacy note.

## 7. Retention suggestion

- **R2 objects:** keep raw batches ~90 days hot for iteration, then either delete or roll up into a
  compacted training-set export (parquet/webdataset). Add an R2 lifecycle rule once volume is known.
- **Local (client) queue:** ~20 MB cap, oldest-first (already enforced); a healthy client drains it
  within a session so retention is effectively minutes.
- **Dedup:** the offline pipeline dedups by `(sessionId, seq, event-index)` before training.

## 8. Prod-enablement checklist (a flag flip)

Everything is built so production is a deliberate, small change - NOT a rewrite:

1. Create the prod bucket: `npx wrangler r2 bucket create er-telemetry`.
2. Uncomment the `[[r2_buckets]]` block (binding `TELEMETRY`, bucket `er-telemetry`) in
   `workers/er-save-api/wrangler.toml`.
3. Deploy the prod worker (maintainer only, explicit permission): `npx wrangler deploy`.
4. Set `VITE_TELEMETRY=prod` (+ `VITE_TELEMETRY_SALT`, optional `VITE_SERVER_URL_TELEMETRY`) in the
   prod build env and rebuild the client.
5. Add a player-facing privacy note + (if required) an opt-out toggle before flipping on.
6. Watch the Worker request/day + R2 storage dashboards for the first days at prod volume; tune the
   flush thresholds in `DEFAULT_TELEMETRY_QUEUE_CONFIG` if needed to stay under quota.

Until then: staging only (`VITE_TELEMETRY=staging`), prod R2 binding commented out, prod client flag
unset -> production is byte-identical and free.

## 9. Schema evolution - additive-only policy + variable-length audit

**Variable-length audit (done).** Every collection in `MonState` / the events is a variable-length array
with **no fixed-size assumption** anywhere in the schema, the snapshot code (`telemetry-state.ts`), or the
tests - the game breaks every obvious cap:

- `moves` can exceed 4 (a 5th-move-slot item) -> never a 4-tuple; snapshot maps the whole moveset.
- `innates` can exceed the ER four-ability set (Black Shinies carry 5; future Prismatic Shinies add
  special ones) -> an open array, not a fixed slot count.
- `heldItems` is already multi / open-ended.
- `statStages` is whatever the engine reports (7 today), captured with a spread, never index-hardcoded.

No consumer (worker, tests, docs) assumes a fixed length; the worker stores the compressed body verbatim
and never parses the schema at all.

**Additive-only evolution policy.** So historical data stays readable forever:

1. **New fields are OPTIONAL.** Add fields as optional; a reader must default a missing field.
2. **Existing fields are NEVER repurposed.** A field's meaning/type is frozen once shipped. Need a
   different meaning -> add a new field, don't overload an old one.
3. **Breaking reshapes bump `TELEMETRY_SCHEMA_VERSION`.** Removing/renaming/retyping a field, or changing a
   collection's element shape incompatibly, is a version bump; the version is stamped on every envelope +
   R2 object so the ML pipeline routes each object to the right decoder.
4. **Consumers MUST tolerate unknown fields.** A reader ignores fields it doesn't recognize (forward
   compatibility) rather than failing - so an older pipeline can still read a newer capture's known fields.
5. **IDs + build, not baked values.** Events carry numeric ids + the build id; balance-sensitive attributes
   are joined from the per-build data dictionary (section below / the roadmap), so a rebalance never
   rewrites the schema or corrupts old data.

## 10. Per-build data dictionary (ML join table)

Telemetry events store numeric ids (moves/abilities) + held-item id strings + the build id - NOT the
balance values. `scripts/export-data-dictionary.mjs` exports the id -> attributes tables the ML side joins
against, keyed by build id, from the ER 2.65 authoritative dex (`er-moves.ts` / `er-abilities.ts` /
`er-move-tables.ts`; pure static data, no engine boot). Output: moves (type/power/accuracy/pp/priority/
category/target/effect/flags + the authoritative description text) and abilities (name + description);
held-item attributes are an engine-boot extension point. Training against a historical dataset joins
against the dictionary **of that build**, so a balance change never corrupts older data. Upload one
dictionary to R2 per deployed build (upload wired later). See `docs/plans/combat-ai-roadmap.md`.
