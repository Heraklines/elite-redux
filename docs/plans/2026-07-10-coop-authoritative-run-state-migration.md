# Co-op authoritative RUN STATE MACHINE migration — contract design doc

Date: 2026-07-10. Status: CONTRACT for Wave-2 implementation agents. This is the single
document the migration is built against. Every claim is grounded in `file:line` evidence and
is meant to survive challenge.

Companion reading (the accepted review's evidence set, read these first):
- `src/data/elite-redux/coop/coop-renderer-gate.ts` — the renderer DENYLIST + its own
  "later M-steps … tighten this toward a pure allowlist" note (lines 24-28, 40-47).
- `src/data/elite-redux/coop/coop-transport.ts:581` — `CoopAuthoritativeBattleStateV1`: an
  authoritative DATA plane with **no** `logicalPhase` / `pendingOperation` / `epoch` field.
- `src/data/elite-redux/coop/coop-battle-engine.ts:2898` — `applyCoopAuthoritativeBattleState`
  adopts party/field/modifiers by `Pokemon.id` but the guest still drives its own wave/turn/phase
  queue (see §3, `coop-replay-phases.ts:1119`).
- `src/phases/coop-replay-phases.ts:1119-1192` — `maybeRunCoopWaveAdvance`: the guest LOCALLY
  constructs the `VictoryPhase` / `BattleEndPhase` / `SelectBiomePhase` / `NewBattlePhase` /
  `GameOverPhase` post-battle tail from a one-bit `outcome`, not from a host-driven phase transition.
- `src/data/elite-redux/coop/coop-interaction.ts:28` — the unified `runCoopInteraction` primitive,
  "ADDITIVE — it is wired to nothing yet."
- `src/data/elite-redux/coop/coop-ui-registry.ts:107` + `src/ui/ui.ts:783` — local-only
  CONFIRM / OPTION_SELECT and the warn-only (never-block) tripwire.
- `src/data/elite-redux/coop/coop-webrtc-transport.ts:184` — `send()` DROPS the frame when the
  channel is not open, with no queue and no ACK.
- `src/data/elite-redux/coop/coop-runtime.ts:957` — hot rejoin pulls a state snapshot but does
  NOT restore a pending operation.
- `src/data/elite-redux/coop/coop-session-controller.ts:493` — the interaction counter is NOT
  persisted; a resume re-initializes it from base 0.
- `docs/plans/2026-07-09-coop-maintainer-handoff.md` — the operating model + the #838-#876 fix ledger.
- `src/data/elite-redux/coop/coop-seq-registry.ts` — the TOTAL relay band + kind table.

---

## 0. The problem, stated precisely

The co-op netcode already has an **authoritative DATA plane**: the host streams
`CoopAuthoritativeBattleStateV1` (`coop-transport.ts:581`) and `CoopFullBattleSnapshot`
(`coop-transport.ts:457`), the guest adopts them by `Pokemon.id`
(`applyCoopAuthoritativeBattleState`, `coop-battle-engine.ts:2898`), and a per-turn 64-bit
checksum (`turnResolution.checksum`, `coop-transport.ts:1047-1049`) detects any drift and heals
via `requestStateSync` → `stateSync` (`coop-transport.ts:975,981`).

What it does **not** have is an authoritative **CONTROL plane**. Four control mechanisms advance
INDEPENDENTLY of that data plane, each on its own ad-hoc channel:

1. **Phase transitions** — the guest constructs its own post-battle phase tail from a one-bit
   `waveResolved.outcome` (`coop-replay-phases.ts:1119-1192`). The host never says "the logical
   phase is now REWARD_SELECT"; the guest infers it.
2. **Prompts / interactions** — 25 relay `kind`s across 19 seq bands
   (`coop-seq-registry.ts:160-294, 324-393`), each with its own owner rule, addressing formula,
   and failure modes. `runCoopInteraction` (`coop-interaction.ts:91`) is the intended unifier but
   is "wired to nothing yet" (`coop-interaction.ts:28`).
3. **Continuations / rendezvous** — named two-sided barriers (`cmd:<wave>:<turn>`,
   `shop:<wave>:<counter>`, `biomepick:<wave>`) on the `rendezvous` message
   (`coop-transport.ts:868-877`, `coop-rendezvous.ts:161`), a SEPARATE control plane from the
   interaction counter (its own comment says so: `coop-transport.ts:870-871`).
4. **Counters / reconnect** — the interaction counter (`coop-session-controller.ts:493-508`),
   which is not persisted and not carried on the wire as a first-class field, and reconnect
   (`coop-runtime.ts:957-989`), which restores a data snapshot but no pending operation.

Every live P0 in the fix ledger (`2026-07-09-coop-maintainer-handoff.md:176-201`) is a
symptom of these being separate: the guest DERIVED a value or ran a control transition the host
also computed independently, and they diverged (#861 seq-blind await, #862 wave-type,
#863/#864 un-relayed biome travel, #859/#860 phantom ME turn). The maintainer's own mental model
(`handoff.md:12-25`) already names the cure — "host states it authoritatively, guest adopts it,
never re-derives." This migration extends that cure from the DATA plane to the CONTROL plane by
introducing ONE authoritative envelope that carries logical phase + pending operation + epoch +
revision alongside the state the guest already adopts.

**Target invariants (verbatim from the accepted review) — the acceptance criteria for the whole
migration:**
1. Guest never mutates shared run state.
2. Guest sends typed INTENT only.
3. Host validates and commits each operation EXACTLY ONCE.
4. Committed operation + resulting revision are broadcast.
5. Guest application is idempotent by `epoch + revision + operationId`.
6. Late messages from completed operations are rejected.
7. Reconnect returns checkpoint + current pending operation + journal tail.
8. Unknown guest phases/prompts FAIL CLOSED instead of running locally.

---

## 1. The envelope + operation lifecycle

### 1.1 The envelope schema

The envelope is the single authoritative control+data unit the host broadcasts. It is a strict
SUPERSET of today's `turnResolution` / `waveEndState` payload (`coop-transport.ts:1056-1074,1192`):
the existing `authoritativeState` becomes one field of it, so an older client that only reads
`authoritativeState` keeps working during migration (additive, forward-safe — the same discipline
every field on `CoopAuthoritativeBattleStateV1` already follows, e.g. `coop-transport.ts:552-559`).

```ts
/** The monotonic session identity. Bumps ONLY on a hard control-plane reset (§1.4). */
export type CoopSessionEpoch = number;

/** Per-committed-operation monotonic revision within an epoch (§1.5). Never resets except on epoch bump. */
export type CoopRevision = number;

/** Globally unique id for one operation, minted by the PROPOSER (host or guest) (§1.3). */
export type CoopOperationId = string; // `${epoch}:${owner}:${localSeq}` — unique without host round-trip

/**
 * The logical run phase — the authoritative control-plane position. The host STATES this; the
 * guest ADOPTS it and never infers it from a one-bit outcome. Superset-mapped from the existing
 * PhaseString tail the guest currently constructs (coop-replay-phases.ts:1119-1192).
 */
export type CoopLogicalPhase =
  | "COMMAND"        // awaiting battle commands (maps to CommandPhase / TurnStartPhase)
  | "TURN_RESOLVE"   // host resolving a turn; guest renders (maps to CoopReplayTurnPhase)
  | "WAVE_VICTORY"   // wave won/captured; VictoryPhase tail (coop-replay-phases.ts:1163)
  | "WAVE_FLEE"      // fled; BattleEnd -> NewBattle tail (coop-replay-phases.ts:1170-1174)
  | "GAME_OVER"      // run lost; GameOverPhase (coop-replay-phases.ts:1181)
  | "REWARD_SELECT"  // between-wave reward shop (UiMode.MODIFIER_SELECT, coop-ui-registry.ts:61)
  | "BIOME_SELECT"   // ER map / crossroads route choice (coop-ui-registry.ts:185-194)
  | "MYSTERY_ENCOUNTER" // ME option/battle handoff (coop-ui-registry.ts:79)
  | "SHOP"           // biome market / black market / exotic / bazaar (coop-ui-registry.ts:83)
  | "INTERACTION"    // any other runCoopInteraction-driven shared screen (§1.3, §2)
  | "IDLE";          // no pending control transition

/** The lifecycle status of the ONE in-flight operation (§1.3). */
export type CoopOperationStatus = "proposed" | "committed" | "applied" | "rejected" | "superseded";

/** A single unit of shared-run mutation moving through the lifecycle. */
export interface CoopPendingOperation {
  /** Globally-unique id (proposer-minted). Idempotency key component (§1.6). */
  readonly id: CoopOperationId;
  /**
   * WHAT this operation is — the migrated successor of today's relay `kind`
   * (coop-seq-registry.ts:324-393). One closed union; unknown kinds fail closed (§1.7, §4.5).
   */
  readonly kind: CoopOperationKind;
  /** The player seat that DRIVES/PROPOSES it (0..N-1). Successor of the interaction-counter owner rule. */
  readonly owner: CoopPlayerId;
  /** Current lifecycle state. */
  readonly status: CoopOperationStatus;
  /**
   * The typed INTENT (guest->host, invariant 2) or committed outcome (host->guest, invariant 4).
   * Serializable; the successor of the relay `choice`/`outcome` payload (coop-transport.ts:1097-1105).
   */
  readonly payload: unknown; // narrowed per-kind by a discriminated map (§2 lists every kind)
}

/** The single authoritative control+data unit the host broadcasts every commit. */
export interface CoopAuthoritativeEnvelopeV1 {
  readonly version: 1;
  readonly sessionEpoch: CoopSessionEpoch;
  readonly revision: CoopRevision;
  readonly wave: number;              // successor of CoopAuthoritativeBattleStateV1.wave (coop-transport.ts:585)
  readonly turn: number;              // successor of CoopAuthoritativeBattleStateV1.turn (coop-transport.ts:585)
  readonly logicalPhase: CoopLogicalPhase;
  /** The one in-flight operation, or null when the control plane is quiescent. */
  readonly pendingOperation: CoopPendingOperation | null;
  /** The existing authoritative DATA plane, embedded unchanged (coop-transport.ts:581). */
  readonly authoritativeState: CoopAuthoritativeBattleStateV1;
}
```

Wire delivery: add ONE message `| { t: "envelope"; envelope: CoopAuthoritativeEnvelopeV1 }` to the
`CoopMessage` union (`coop-transport.ts:839-1237`). It is purely additive — a client that never
learns `"envelope"` ignores it via the existing unknown-`t` default arm (the same forward-safety
`waveEndState` and the showdown messages already rely on, `coop-transport.ts:1190,1195-1196`).

### 1.2 Why the envelope carries `authoritativeState` rather than replacing it

`CoopAuthoritativeBattleStateV1` (`coop-transport.ts:581-625`) is already the guest's adopt-by-id
apply target (`applyCoopAuthoritativeBattleState`, `coop-battle-engine.ts:2898-2908`, which
version-gates `state.version !== 1`). The envelope does NOT re-serialize state — it references the
existing object. This keeps the heavy, well-tested data apply exactly as-is and confines the new
work to the control fields. The migration's risk surface is therefore the four control fields
(`sessionEpoch`, `revision`, `logicalPhase`, `pendingOperation`), not the mon serialization.

### 1.3 Operation states

```
                 proposer mints id, sends INTENT
   (guest)  ─────────────────────────────────────►  proposed
                                                        │
                          host validates ┌──────────────┴───────────────┐
                                         │ valid                        │ invalid / stale
                                         ▼                              ▼
                                     committed  ──host applies──►  applied
                                         │                          (broadcast in envelope,
                                         │                           revision incremented)
                                         │
        a newer op for the same slot lands first │
                                         ▼
                                    superseded                    rejected
```

- **proposed** — the OWNER (host or guest) has collected the human choice and emitted a typed
  intent (`runCoopInteraction.driveLocally` → `sendOutcome`, `coop-interaction.ts:102-106`). On a
  guest-owned op this is the ONLY thing the guest does to shared state (invariant 2). The op exists
  locally as `proposed`; it is not yet authoritative.
- **committed** — the host (sole authority) has validated the intent (owner is correct for this
  `logicalPhase`; epoch matches; the op is not a duplicate by `id`) and accepted it. Commit is the
  single point where invariant 3 ("exactly once") is enforced: a second intent with the same `id`
  is a no-op re-ACK, never a second commit.
- **applied** — the host has mutated authoritative state (`applyOutcome` is the "ONE mutation site",
  `coop-interaction.ts:65-66,122`), incremented `revision`, and broadcast the resulting envelope
  (invariant 4). The guest adopts the new state and marks the op applied. Guest application is a
  pure function of `(epoch, revision, id)` (invariant 5, §1.6).
- **rejected** — the host validated and REFUSED (wrong owner, illegal choice, epoch mismatch, or a
  fail-closed unknown kind, §1.7). The host broadcasts the rejection so the proposer can surface a
  safe default. Rejection does NOT increment `revision` (no state changed).
- **superseded** — the op was still `proposed`/`committed` when a NEWER op for the same logical
  slot committed (e.g. an owner-timeout default applied while the owner's late pick was in flight —
  today's `defaultOutcome` path, `coop-interaction.ts:117-119`). A superseded op's late intent is
  dropped by the late-rejection rule (§1.6). This is the typed replacement for today's implicit
  "the peer advanced past this interaction" logic (`coop-session-controller.ts:516-518`,
  `peerAdvancedPastInteraction`).

Terminal states: `applied`, `rejected`, `superseded`. Once terminal, any further message bearing
that `id` is a late message and is rejected (invariant 6, §1.6).

### 1.4 Epoch semantics — WHEN it bumps

`sessionEpoch` identifies one continuous authoritative control-plane run. It bumps on a HARD reset
where prior in-flight operations must be abandoned wholesale, and ONLY then:

| Trigger | Bumps epoch? | Why | Evidence today |
|---------|:---:|-----|----------------|
| Session start / launch | YES (epoch := 1) | fresh control plane | `launchSnapshot`, `coop-transport.ts:1008` |
| Save/resume (fresh boot of a saved run) | YES | counter re-inits from base 0; parity restart | `coop-session-controller.ts:493-501` |
| New game after decline / no-resume | YES | `resumeStartNew`, `coop-transport.ts:898` | control plane restarts |
| Hot rejoin (channel re-established in place) | **NO** | the run continues; only buffered frames were lost | `coop-runtime.ts:941` "channel re-established in place" |
| Per-turn / per-wave advance | NO — that's `revision` | run continues | §1.5 |
| Protocol-version mismatch (stale build) | N/A (session refuses to proceed) | `versionMismatch` banner | `coop-session-controller.ts:846-852` |

The rejoin case is the load-bearing distinction. Today rejoin purges buffers and pulls a fresh
snapshot (`coop-runtime.ts:958-989`) but does not restore the pending operation
(`coop-runtime.ts:957` restores DATA only). Because rejoin keeps the SAME epoch, the reconnect
protocol (§4.4) can return the pending operation whose `id` still belongs to that epoch — the guest
resumes it rather than restarting. A resume (fresh boot) bumps the epoch precisely because the
interaction counter it derives ownership from is re-initialized from base 0
(`coop-session-controller.ts:494-501`), so pre-resume operation ids MUST be rejected as
cross-epoch (this is the typed successor of #861's "seq numbers reset per session/epoch; a leftover
message can impersonate a new one," `handoff.md:32-33,192-193`).

Epoch is minted host-authoritatively and echoed in the `hello` handshake (extend
`coop-transport.ts:839`'s `hello` with an optional `epoch?: number`, additive) so both clients agree
on the current epoch before any operation is proposed.

### 1.5 Revision semantics — per committed op

`revision` is a monotonic counter WITHIN an epoch, incremented by exactly 1 each time the host
COMMITS-and-APPLIES an operation (transition `committed → applied`). It is NOT incremented on
`rejected` or `superseded` (no state changed). It is the ordering key the guest uses to apply
envelopes in sequence and to detect a gap (a missing revision → request the journal tail, §4.4).

This is the first-class successor of today's two ad-hoc sequencers:
- the per-turn monotonic `tick` (`coop-transport.ts:459,585` — "Source-style snapshot sequencing"),
  which orders DATA snapshots but says nothing about control operations, and
- the interaction counter (`coop-session-controller.ts:502-508`), which orders interactions but is
  not carried as a wire field and is not persisted.

`revision` unifies them: every committed control operation AND every resolved turn advances it, so a
single monotonic number totally orders the shared run's authoritative history. A guest that has
applied through `revision = R` and receives `revision = R+2` knows it missed `R+1` and requests the
tail (§4.4) rather than applying out of order.

### 1.6 Idempotency + late-rejection rules

Guest application is a pure, idempotent function keyed on the triple `(sessionEpoch, revision,
operationId)` (invariant 5):

1. **Epoch guard.** An envelope or intent whose `sessionEpoch` ≠ the guest's current epoch is
   DROPPED. (Typed successor of #808's `coopSessionGeneration()` gen-guard,
   `coop-runtime.ts:970-972`, and #861's cross-session buffer purge, `coop-runtime.ts:959-967`.)
2. **Revision monotonicity.** An envelope whose `revision` ≤ the last-applied revision is a
   duplicate/late broadcast and is DROPPED (idempotent re-delivery is a no-op — safe to resend, §4.2).
   A `revision` gap (> last+1) triggers a tail request (§4.4) instead of an apply.
3. **Operation-id dedupe.** The host commits at most once per `id` (invariant 3); the guest applies
   at most once per `id`. A repeated `applied` envelope for an already-applied `id` is a no-op.
4. **Late-rejection (invariant 6).** An intent or ACK bearing an `id` whose operation is already
   TERMINAL (`applied` / `rejected` / `superseded`) is REJECTED at the host and ignored at the
   guest. This is the typed, id-scoped replacement for today's kind-validation re-buffering
   (`coop-seq-registry.ts:396-435`, the #861 fix) — instead of matching by `seq` and re-buffering an
   out-of-family `kind`, the host matches by `id` and rejects anything for a completed op.

The migration must preserve the property #861 bought: a stale, minutes-old message at a REUSED
address can never satisfy a live await. Under the envelope this is structural — an `id` embeds its
`epoch`, and terminal ops reject late traffic — rather than defended per-call-site across 27 await
sites (`handoff.md:192-193`).

### 1.7 Fail-closed for unknown phases/prompts (invariant 8)

`CoopLogicalPhase` and `CoopOperationKind` are CLOSED unions. When the guest receives an envelope
whose `logicalPhase` or `pendingOperation.kind` it does not recognize (a newer host, a corrupt
frame), it MUST fail closed: render nothing locally, hold at the last known-good state, and request
a resync/tail (§4.4) — it MUST NOT fall back to running a local phase or prompt. This is the direct
inversion of today's behavior, where the renderer gate is a DENYLIST (`coop-renderer-gate.ts:40-47`)
so an unlisted phase runs by default, and the UI tripwire only WARNS (`ui.ts:800-802`,
`coop-ui-registry.ts:240-251`) rather than blocking. §3 and §4.5 specify the concrete fail-closed
allowlist and behavior.

### 1.8 Coexistence with the existing interaction counter (dual-run / compat)

The interaction counter cannot break mid-migration on a LIVE system. The counter
(`CoopInteractionTurn`, read via `interactionCounter()`, `coop-session-controller.ts:502-508`)
resolves interaction OWNERSHIP by parity (`isLocalOwnerAtCounter`, `:480-491`,
`ownerOf(pinnedCounter)`) and addresses every relay band (`coop-seq-registry.ts:160-294`). It is
LIVE-CRITICAL: pull it and every relay desyncs.

**Dual-run strategy.** During migration the counter and the envelope run SIMULTANEOUSLY and stay
reconciled by construction:

1. The envelope's `pendingOperation.owner` is DERIVED from the same counter parity the legacy path
   uses (`ownerOf`, `coop-session-controller.ts:481`). While both planes are live, the counter
   remains the source of truth for owner selection; the envelope merely CARRIES the resolved owner
   as an explicit field (removing the "guest re-derives owner" hazard the pinned-counter logic
   already guards against, `:472-478`).
2. A migrated surface COMMITS through the envelope but ALSO advances the interaction counter (so any
   still-legacy surface downstream sees the counter it expects). Concretely: `applyOutcome` +
   `revision++` also calls the existing counter advance. The counter and `revision` move together;
   neither is authoritative alone during migration.
3. `operationId` embeds the counter value it was pinned at (`${epoch}:${owner}:${pinnedCounter}`),
   so the dedupe/late-rejection machinery (§1.6) is a strict superset of today's
   `peerAdvancedPastInteraction` (`:516-518`) — an id whose pinned counter the peer has advanced past
   is exactly a `superseded` op.
4. The counter is retired ONLY after every surface in §2 is migrated and `revision` provably orders
   the entire run (the final phase of §5). Until then, removing it is FORBIDDEN.

This guarantees the counter never breaks mid-migration: it keeps doing its exact current job, and
the envelope is layered on top deriving from it, until it is provably redundant.

---

## 2. Complete inventory of bespoke relay / decision surfaces

Grep-derived from `coop-seq-registry.ts` (the TOTAL band+kind table, `:160-294` and `:324-393`),
the message union (`coop-transport.ts:839-1237`), and the rendezvous points (`coop-rendezvous.ts`,
`coop-transport.ts:868-877`). Each surface is a control plane the migration collapses onto the ONE
operation model. For each: the current owner rule, the current failure modes (with fix-ledger #s),
and its target mapping onto `CoopOperationKind` + `CoopLogicalPhase`.

### 2.1 The relay `kind`s (interactionChoice / interactionOutcome)

All ride `coop-transport.ts:1097` (`interactionChoice`) or `:1105` (`interactionOutcome`), routed by
numeric `seq` band (`coop-seq-registry.ts:139-153`), kind-validated per #861
(`coop-seq-registry.ts:396-435`). `owner` = which seat drives, resolved from interaction-counter
parity unless noted. Migration target kind names are proposed `CoopOperationKind` members.

| # | kind(s) | band / addressing | owner rule | current failure modes (ledger) | -> operation kind / logicalPhase |
|---|---------|-------------------|-----------|--------------------------------|-------------------------------|
| 1 | `reward` `shop` `skip` `reroll` `check` `transfer` `lock` | `reward` base 0 `+ interactionCounter` (`:45,162-167`) | counter parity | #861 seq-blind await matched a stale cross-session reward pick; precursor reward matched by seq not kind (`handoff.md:19,192`) | `REWARD_*` under `REWARD_SELECT` |
| 2 | `switch` | `faintSwitch` base 90_000 `+ fieldIndex` (`:47,169-174`) | the FAINTED mon's owner (`coopOwner`) | #786 faint-replacement; #851 post-half-wipe index skew -> owner-keyed match added (`coop-transport.ts:849-857`) | `FAINT_SWITCH` under `COMMAND`/`TURN_RESOLVE` |
| 3 | `revival` | `revival` base 95_000 `+ fieldIndex` (`:48,176-181`) | Revival Blessing target mon owner | #809 revival prompt (`coop-transport.ts:878-879`) | `REVIVAL` under `TURN_RESOLVE` |
| 4 | `abilityPicker` | `abilityPicker` base 6_000_000 `+ counter` (`:51,182-188`) | counter parity | ability-capsule owner/watcher relay | `ABILITY_PICK` under `INTERACTION` |
| 5 | `biomeShop` | `biomeShop` base 7_000_000 `+ pinnedStart` (`:53,189-195`) | counter parity | #858 biome-shop vs map ordering race, one-sided fallback -> reciprocal `biomepick` barrier (`handoff.md:186-187`) | `SHOP_BUY` under `SHOP` |
| 6 | `bargain` | `bargain` base 7_500_000 `+ coopBargainStart` (`:54,196-202`) | counter parity | #795 Giratina bargain; watcher adopts outcome blob | `BARGAIN` under `INTERACTION` |
| 7 | `coloBoard` `coloPick` | `colosseum` base 7_600_000 `+ pinnedCounter` (`:56,203-209`) | counter parity | #829/#818 colosseum board; guest round-loop | `COLO_PICK` under `INTERACTION` |
| 8 | `mePresent` `meResync` `me` `meSub` `meBtn` | `mePump` base 8_000_000 `+ counter` (`:59,210-216`) | counter parity | #859/#860 phantom ME turn (leftover battle chain parks guest); #862 wave-TYPE divergence; #855 ME catch-full sub-prompt (`handoff.md:188-194`) | `ME_PRESENT`/`ME_PICK`/`ME_SUB`/`ME_BUTTON` under `MYSTERY_ENCOUNTER` |
| 9 | `quizAns` | `meQuiz` base 8_500_000 `+ (counter%2048)*16+(idx%16)` (`:60,217-223`) | counter parity | #818 quiz mirror; both run ErQuizPhase | `QUIZ_ANSWER` under `MYSTERY_ENCOUNTER` |
| 10 | (ME terminal LEAVE/handoff) | `meTerm` base 9_000_000 `+ counter` (`:62,224-230`) | counter parity | #840 near-collision: `learnMove` was 9_000_001 INSIDE this band (`:29-36`); #859/#860 phantom turn | terminal transition of `MYSTERY_ENCOUNTER` |
| 11 | `learnMoveForward` `learnMove` | `learnMoveFwd` 9_100_000 `+ partySlot`; `learnMove` singleton 9_500_000 (`:68,118,231-237,258-265`) | mon owner | #633 BUG3+5 per-slot forward; #840 relocation | `LEARN_MOVE` under `TURN_RESOLVE` |
| 12 | `learnMoveBatchForward` `learnMoveBatch` | `learnMoveBatchFwd` 9_150_000 `+ partySlot` (`:75,238-244`) | mon owner | #848 shared level-up panel; panel error falls back to per-move relay (`coop-ui-registry.ts:97-103`) | `LEARN_MOVE_BATCH` under `TURN_RESOLVE` |
| 13 | `dexSync` | `dexSync` singleton 9_200_000 (`:110,245-251`) | host broadcast | #794 dex/starter sync | host-broadcast side-effect of any commit (not owner-driven) |
| 14 | `crossroads` | `crossroads` base 9_600_000 `+ pinnedStart` (`:81,266-272`) | counter parity (alternated) | #848 co-op biome choice; watcher mirrors owner cursor | `CROSSROADS_PICK` under `BIOME_SELECT` |
| 15 | `biomePick` | `biomePick` base 9_700_000 `+ pinnedStart` (`:89,273-279`) | counter parity (alternated) | #863/#864 owner biome-travel only relayed on multi-node picker onSelect; every other terminal traveled silently (`handoff.md:198-200`) | `BIOME_PICK` under `BIOME_SELECT` |
| 16 | `stormglass` | `stormglass` singleton 9_800_000 (`:98,280-286`) | HOST drives (one-time) | #130 one-time weather pick; unmirrored per-client prompt would diverge checksum | `STORMGLASS` under `INTERACTION` |
| 17 | `catchFull` | `catchFull` singleton 9_900_000 (`:108,287-293`) | the CATCHER (ball-thrower) | #856 wild-catch full-party release is host-only; guest-thrown catch OPEN (`handoff.md:164-166`) | `CATCH_FULL` under `TURN_RESOLVE` |

Registered choice-kind validation sets: `coop-seq-registry.ts:408-435` (17 named sets). These are the
exact `expected-kind` allowlists each await declares today; each becomes one `CoopOperationKind` guard
after migration (invariant 6 by `id` instead of by kind-set).

### 2.2 Sentinel / pin fields (interaction-counter anchors)

Not seq bands but the PIN values a surface captures once so its owner/relay stay stable for the whole
interaction (`coop-session-controller.ts:472-478` explains why pinning exists — an inbound reconcile
can bump the live counter mid-interaction):
- `coopInteractionStart` / the pinned counter (`isLocalOwnerAtCounter(pinnedCounter)`,
  `coop-session-controller.ts:480-491`; read in the tripwire `ui.ts:796-797`).
- `coopBiomeStart` / `pinnedStart` — the crossroads + biomePick anchor (`coop-seq-registry.ts:270,277`).
- `coopBargainStart` (`:200`), `coopMe*` ME counter pins (`ui.ts:796`, `coopMeInteractionStartValue`).

**Migration mapping:** every pin becomes the `operationId` suffix. `operationId =
${epoch}:${owner}:${pinnedStart}` makes the pin a structural component of idempotency (§1.6) rather
than a per-surface convention — the "capture once, resolve owner from the pinned value" discipline
(`coop-session-controller.ts:473-478`) becomes the id-minting rule.

### 2.3 Rendezvous points (the SECOND control plane)

`rendezvous` message (`coop-transport.ts:868-877`), `CoopRendezvous` (`coop-rendezvous.ts`). Named
two-sided barriers, EXPLICITLY separate from the interaction counter (`coop-transport.ts:870-871`:
"the counter says WHO picks; this says WHEN both may proceed"). Points today:
- `cmd:<wave>:<turn>` — next-command-open barrier (`coop-transport.ts:874`).
- `shop:<wave>:<counter>` — shop-pick-commit barrier (`coop-transport.ts:874`).
- `biomepick:<wave>` — #858 reciprocal biome-shop-vs-map barrier (`handoff.md:186-187`).

Failure modes: #858 (one-sided fallback race), the "berry-bush freeze" ordering trace
(`coop-rendezvous.ts:181-182` — a `shop:3:2` arrival buffered before the `cmd:3:2` await opened);
divergent-branch parks (`coop-rendezvous.ts:374` — the partner reached a point we never will).

**Migration mapping:** rendezvous barriers are subsumed by `logicalPhase` + `revision`. A barrier
exists today only because the two control planes advance independently and must be re-synchronized;
once `logicalPhase` is host-stated and `revision` totally orders commits, "both may proceed" is
"both have applied through `revision = R`." The reciprocal barrier becomes an ACK of the committing
envelope (§4.2). Rendezvous is retired PER POINT as the surface that raised it migrates (e.g.
`shop:` retires when REWARD_SELECT migrates), NOT wholesale — see the order in §2.5.

### 2.4 The lobby handshake (pre-run control plane)

Separate from in-run operations but part of the control surface:
- `hello` (`coop-transport.ts:839`) — version + role + tiebreak. Protocol-version mismatch -> refuse
  (`coop-session-controller.ts:843-852`). This is where `epoch` is negotiated (§1.4).
- `runConfig` / `requestRunConfig` (`coop-transport.ts:935-955`) — host states difficulty +
  challenges + seed + `netcodeMode` (`"lockstep"|"authoritative"`); guest adopts. Self-healing
  (re-request until it lands).
- `rosterSync` / `requestRoster` (`coop-transport.ts:915-966`) — each player's starter picks + ready.
  #868 self-healing lobby handshake: one-shot `rosterSync` lost on a flap left `partnerReady` false
  forever -> symmetric re-request added (`coop-transport.ts:956-965`).
- `launchSnapshot` (`coop-transport.ts:1008`) / `resumeOffer`/`resumeReply`/`resumeStartNew`
  (`:889-898`) — the launch/resume boundary that mints the epoch.

**Migration mapping:** the lobby handshake is the epoch-0 -> epoch-1 transition. `runConfig` and
`rosterSync` become the first committed operations of a new epoch (`logicalPhase: "IDLE"` -> first
`COMMAND`), so #868's self-heal is subsumed by the reconnect tail (§4.4): a lost `rosterSync` is a
missing revision the joining client requests. Migrate the lobby LAST (§2.5) — least frequent P0
source and highest blast radius (a lobby regression blocks every run from starting).

### 2.5 Recommended migration ORDER (risk-ordered)

Ordered by live-P0 frequency (migrate the biggest bleeders first, each behind its old path as
fallback per §5) then by blast radius (defer the surfaces whose regression blocks a whole run):

1. **Biome travel (`biomePick` + `crossroads`, #14/#15).** The #863/#864 cluster — un-relayed owner
   travel — was the most recent and most reproducible live P0 (`handoff.md:198-200`), and #865
   remains OPEN in this exact path (`handoff.md:156-162`). Highest live-bug density; the operation
   model (host commits the chosen biome, guest adopts, never derives) is the textbook cure for the
   whole "watcher adopts / silent travel" class. `BIOME_SELECT` phase + `BIOME_PICK`/`CROSSROADS_PICK`.
2. **Mystery encounter (`mePump`/`meTerm`/`meQuiz`, #8/#9/#10).** #859/#860/#862 phantom-turn +
   wave-type divergence (`handoff.md:188-194`) — the second-densest cluster, with the nastiest
   parked-await failure mode. `MYSTERY_ENCOUNTER` phase; the phantom-turn softlock
   (`coop-replay-phases.ts:1042-1058`) is exactly what a host-stated `logicalPhase` eliminates (the
   guest stops inferring "there is a battle turn" from a leftover chain).
3. **Reward shop (`reward`* channel, #1).** #861 seq/kind blindness lived here
   (`handoff.md:192-193`); highest-traffic interaction so idempotency+late-rejection (§1.6) pays off
   most. `REWARD_SELECT` phase.
4. **Post-battle wave-advance tail (guest-constructed tail, `coop-replay-phases.ts:1119-1192`).**
   Not a relay `kind` but THE canonical control-plane leak: the guest builds VictoryPhase/BattleEnd/
   NewBattle/GameOver itself. Migrating this makes `logicalPhase` host-authoritative for the
   between-wave transition — the keystone that lets §3's allowlist stop denying and start allowing.
5. **Biome/black-market/exotic shops + bargain + colosseum + ability picker (#4/#5/#6/#7).** Lower
   frequency, well-contained; batch onto `SHOP`/`INTERACTION` once the primitive is proven on 1-3.
6. **Faint-switch / revival / learn-move / catch-full / stormglass (#2/#3/#11/#12/#16/#17).**
   Per-mon, in-battle, already the most heavily-guarded (#851 owner-key, #786, #856-open). Migrate
   after the between-wave surfaces so a regression is contained to one turn, not a whole wave loop.
7. **Lobby handshake + resume (§2.4).** LAST. Highest blast radius (blocks run start), lowest live-P0
   rate. Migrate only once the in-run model is soaked, so the epoch-mint path is exercised by every
   prior phase before it becomes load-bearing.

Rationale in one line: **start where the P0s are (biome, ME, reward), install the keystone
(host-stated phase for the wave tail) fourth so the renderer allowlist can flip, then sweep the
low-frequency in-battle and lobby surfaces last where a regression is most contained or most rare.**

---

## 3. Renderer allowlist inventory

Today the renderer gate is a DENYLIST of 6 phases (`coop-renderer-gate.ts:40-47`) with an explicit
note that "later M-steps … tighten this toward a pure allowlist" (`:24-28`). This section enumerates
EVERY phase registered in `PHASES` (`phase-manager.ts:173-307`) and classifies it, producing the
authoritative allowlist a parallel agent is implementing. Their list is derived independently; THIS
list is the cross-check — a disagreement on any row is a finding to reconcile before either ships.

**Classification (guest = authoritative renderer):**
- **presentation** — pure render/animation/narration, mutates no hashed shared state. Guest RUNS it
  locally (ALLOW). These are the CoopReplay* family + cosmetic/info phases.
- **input-intent** — collects a human choice and emits a typed intent (owner drives; watcher shows a
  read-only spectator view). Guest RUNS it, but its output is an INTENT (invariant 2), never a direct
  mutation. Post-migration these route through `runCoopInteraction` (`coop-interaction.ts:91`).
- **mutating** — resolves/applies shared run state (RNG, damage, exp, capture, reward grant). Guest
  must NOT run it (DENY); it renders the visible effect via a CoopReplay* phase and adopts the host's
  checkpoint. This is the set the denylist covers today plus the reward/exp/capture resolution the
  guest currently reaches only because the gate is conservative.
- **host-only** — engine/AI/RNG generation or per-account resolution with no guest-render need; the
  guest adopts the RESULT (enemy party, biome roll, egg, unlock) and never runs the phase.

The ALLOWLIST the guest may run = {presentation} ∪ {input-intent}. Everything classified mutating or
host-only FAILS CLOSED on the guest (invariant 8): if such a phase reaches the factory on a live
authoritative guest, it is neutralized and logged (the existing `recordCoopRendererNeutralized`
mechanism, `coop-renderer-gate.ts:67-71`), NOT run.

### 3.1 presentation — ALLOW (guest runs locally)

| Phase | Note |
|-------|------|
| `MessagePhase` | narration box; guest shows host-localized log lines (`coop-transport.ts:633-634`) |
| `CommonAnimPhase` | shared VFX; no state |
| `DamageAnimPhase` | hit flash; the numeric damage is in the checkpoint |
| `MoveAnimPhase` / `LoadMoveAnimPhase` / `MoveHeaderPhase` / `MoveChargePhase` | move animation/asset load; resolution is host-only (`MovePhase` denied) |
| `PokemonAnimPhase` | sprite anim |
| `ShinySparklePhase` | cosmetic |
| `ShowAbilityPhase` / `HideAbilityPhase` | ability flyout; the ability itself is host-resolved |
| `ShowPartyExpBarPhase` / `HidePartyExpBarPhase` | exp bar chrome |
| `ShowTrainerPhase` | trainer sprite intro |
| `ScanIvsPhase` | per-client IV scanner readout |
| `EndCardPhase` | run end card |
| `CoopCaptureReplayPhase` | guest ball-throw replay (`coop-replay-phases.ts:1144`) |
| `CoopFaintReplayPhase` | faint replay (renders the denied `FaintPhase`) |
| `CoopHpDrainReplayPhase` | hp tween replay |
| `CoopMoveAnimReplayPhase` | move anim replay (renders the denied `MovePhase`) |
| `CoopStatStageReplayPhase` | stat tween replay (renders the denied `StatStageChangePhase`) |
| `CoopStatusReplayPhase` | status change replay |
| `CoopReplayTurnPhase` | the guest's turn-render driver (`coop-replay-phases.ts`) |
| `CoopReplayMePhase` | ME render on the guest |
| `CoopReplayLearnMovePhase` | learn-move render on the guest |
| `CoopApplyResyncPhase` | applies a host resync snapshot at a safe boundary (`coop-replay-phases.ts:984`) |
| `CoopFinalizeTurnPhase` | guest turn-finalize |
| `CoopInertPhase` | deliberate no-op placeholder (renderer parking) |
| `CoopPartnerSyncPhase` | partner-state sync render |

### 3.2 input-intent — ALLOW (owner drives; emits typed intent, never a mutation)

| Phase | Maps to operation (§2) |
|-------|------------------------|
| `CommandPhase` | battle command intent (`coop-transport.ts:859-866`); watcher-safe |
| `SelectTargetPhase` | target-select intent (`UiMode.TARGET_SELECT`, `coop-ui-registry.ts:57`) |
| `SelectModifierPhase` | REWARD_SELECT — reward/shop/reroll intent (#1) |
| `SelectBiomePhase` | BIOME_PICK intent (#15) |
| `ErCrossroadsPhase` | CROSSROADS_PICK intent (#14) |
| `MysteryEncounterPhase` / `MysteryEncounterOptionSelectedPhase` | ME_PICK intent (#8) |
| `ErQuizPhase` | QUIZ_ANSWER intent (#9) |
| `BiomeShopPhase` / `BlackMarketShopPhase` / `ExoticShopPhase` / `ImportBazaarShopPhase` | SHOP_BUY intent (#5) |
| `ColosseumChoicePhase` | COLO_PICK intent (#7) |
| `TheBargainPhase` | BARGAIN intent (#6) |
| `ErAbilityCapsulePhase` / `ErGreaterAbilityCapsulePhase` | ABILITY_PICK intent (#4) |
| `ErStormglassPickerPhase` | STORMGLASS intent (#16; host-driven today) |
| `LearnMovePhase` / `LearnMoveBatchPhase` | LEARN_MOVE / LEARN_MOVE_BATCH intent (#11/#12) |
| `SwitchPhase` | FAINT_SWITCH / voluntary-switch intent (#2) |
| `RevivalBlessingPhase` | REVIVAL intent (#3) |
| `CoopGuestCatchFullPhase` | CATCH_FULL intent (#17) — guest-catcher drives |
| `CoopGuestFaintSwitchPhase` | guest faint-switch driver (#2) |
| `CoopGuestRevivalPhase` | guest revival driver (#3) |
| `ErDexNavPhase` | per-client dex-nav selection (intent if it affects shared spawn; verify) |

**REVIEW rows (classification uncertain — must be resolved with the parallel agent):**
- `ErDexNavPhase` — if the dex-nav pick influences the shared encounter it is input-intent; if it is
  a per-client cosmetic scan it is presentation. Determine from whether its result is hashed.
- `SelectGenderPhase` — one-time per-account; likely host-only/local, but if it affects a shared
  starter it is input-intent. Verify against the launch handshake.

### 3.3 mutating — DENY (host resolves; guest renders via CoopReplay* + adopts checkpoint)

Superset of today's denylist (`coop-renderer-gate.ts:40-47`, first 6 rows) plus the
reward/exp/progression resolution the guest reaches today only because the gate is conservative.

| Phase | In today's denylist? | Guest renders via |
|-------|:---:|-------------------|
| `MovePhase` | YES | `CoopMoveAnimReplayPhase` |
| `MoveEffectPhase` | YES | checkpoint (damage/secondary) |
| `FaintPhase` | YES | `CoopFaintReplayPhase` |
| `StatStageChangePhase` | YES | `CoopStatStageReplayPhase` |
| `AttemptCapturePhase` | YES | `CoopCaptureReplayPhase` + `captureParty` (`coop-transport.ts:1165-1169`) |
| `EnemyCommandPhase` | YES | n/a (host-only AI roll) |
| `MoveEndPhase` / `MoveReflectPhase` | NO — ADD | checkpoint |
| `BerryPhase` | NO — ADD | checkpoint (berry heal/proc) |
| `WeatherEffectPhase` | NO — ADD | checkpoint weather (`coop-transport.ts:653-654`) |
| `PositionalTagPhase` | NO — ADD | checkpoint arena tags |
| `ObtainStatusEffectPhase` / `ResetStatusPhase` / `PostTurnStatusEffectPhase` / `CheckStatusEffectPhase` | NO — ADD | `CoopStatusReplayPhase` / checkpoint |
| `ExpPhase` / `PartyExpPhase` / `LevelUpPhase` / `LevelCapPhase` | NO — ADD | `waveEndState` progression apply (`coop-transport.ts:1192`) |
| `EvolutionPhase` / `EndEvolutionPhase` / `FormChangePhase` / `QuietFormChangePhase` / `PokemonTransformPhase` | NO — ADD (RENDER-DUAL) | played per-client but the SPECIES/FORM result must come from the host state; today `EVOLUTION_SCENE` is local-only + deterministic (`coop-ui-registry.ts:160-162`). Verify determinism holds or route via checkpoint |
| `PokemonHealPhase` / `PartyHealPhase` | NO — ADD | checkpoint hp |
| `TeraPhase` | NO — ADD | checkpoint tera (`coop-transport.ts` tera field) |
| `VictoryPhase` / `BattleEndPhase` / `TrainerVictoryPhase` | NO — ADD (KEYSTONE) | today the guest CONSTRUCTS these (`coop-replay-phases.ts:1163-1181`); post-migration the host STATES the logicalPhase and the guest renders the transition, not builds it |
| `NewBattlePhase` / `NextEncounterPhase` / `NewBiomeEncounterPhase` / `SwitchBiomePhase` | NO — ADD | host-stated wave/biome transition (guest constructs today, `coop-replay-phases.ts:1170-1174`) |
| `ModifierRewardPhase` / `MoneyRewardPhase` / `RibbonModifierRewardPhase` / `GameOverModifierRewardPhase` | NO — ADD | checkpoint money/modifiers (`coop-transport.ts:598,601-603`) |
| `AddEnemyBuffModifierPhase` | NO — ADD | host-only enemy buff roll |
| `SummonPhase` / `SummonMissingPhase` / `ShiftSummonPhase` / `SwitchSummonPhase` / `ReturnPhase` / `PostSummonPhase` / `ToggleDoublePositionPhase` | NO — ADD (RENDER-DUAL) | the SEATING is authoritative (field reconcile, `coop-battle-engine.ts:2815`); guest re-summons via the render differ (`coop-replay-phases.ts:2852`), does not roll |
| `GameOverPhase` | NO — but has an isCoop render branch (`coop-replay-phases.ts:1178-1181`) | render-only on guest; host states GAME_OVER |
| `PostGameOverPhase` / `PostMysteryEncounterPhase` / `MysteryEncounterRewardsPhase` / `MysteryEncounterBattlePhase` / `MysteryEncounterBattleStartCleanupPhase` | NO — ADD | host-resolved; guest adopts via ME channel (#8) |
| `RevivalBlessingPhase` resolution half | (input-intent for the PICK; the APPLY is host-only) | split: intent vs commit |

### 3.4 host-only — guest never runs (adopts the result)

Engine generation, RNG, AI, per-account, or lifecycle phases with no guest-render requirement.

| Phase | Why host-only |
|-------|---------------|
| `EncounterPhase` / `InitEncounterPhase` | rolls the enemy party; guest adopts `enemyPartySync`/`launchSnapshot` (`coop-transport.ts:987,1008`) |
| `EnemyCommandPhase` | enemy AI roll (also in denylist) |
| `TurnInitPhase` / `TurnStartPhase` / `TurnEndPhase` | host turn engine; guest loops via `CoopReplayTurnPhase`/`finishTurn` (`coop-replay-phases.ts:1027`) |
| `CheckSwitchPhase` / `CheckInterludePhase` | host flow-control checks |
| `EggHatchPhase` / `EggLapsePhase` / `EggSummaryPhase` | eggs are deterministic per-client (`coop-egg-determinism`, `coop-ui-registry.ts:161`) — host-only resolution, per-client scene |
| `UnlockPhase` / `LoginPhase` | per-account |
| `SelectStarterPhase` / `SelectChallengePhase` / `SelectGenderPhase` | pre-run; guest boots from `launchSnapshot` (`coop-ui-registry.ts:173-176`) |
| `TitlePhase` / `UnavailablePhase` / `ReloadSessionPhase` | lifecycle / chrome |
| `LLMDirectorStartPhase` / `LLMDirectorBeatPhase` / `LLMDirectorBiblePhase` | director generation; host-authoritative (verify co-op wiring) |
| `CoopPushReplacementCheckpointPhase` | HOST-side checkpoint push (guest never runs; it RECEIVES) |
| `ShowdownEnemyFaintSwitchPhase` / `ShowdownResultPhase` | versus-only, not co-op (`coop-ui-registry.ts:200-205`) |
| `DynamicPhaseMarker` | queue-internal marker, not a real phase |

### 3.5 Cross-check summary

- Today's denylist (6) is a strict SUBSET of §3.3 (mutating). The migration EXPANDS the denied set to
  the full §3.3 list and, crucially, INVERTS the default: unlisted → DENY (fail closed), not ALLOW.
- The allowlist the guest may run is exactly §3.1 ∪ §3.2. Any phase not in those two tables must be
  neutralized on a live authoritative guest.
- The 4 REVIEW rows (`ErDexNavPhase`, `SelectGenderPhase`, the evolution/form RENDER-DUAL set, the
  summon RENDER-DUAL set) are the only genuinely ambiguous classifications and MUST be reconciled
  with the parallel agent's independently-derived list before the allowlist flips the default.

---

## 4. Transport durability design

Today the WebRTC transport `send()` DROPS a frame when the channel is not open — silently, with no
queue and no ACK (`coop-webrtc-transport.ts:184-199`: `if (this._state !== "connected" || readyState
!== "open") { ...warn...; return; }`). The only durability is self-healing re-request loops bolted on
per surface (`requestRunConfig` `coop-transport.ts:948-955`, `requestRoster` #868 `:956-965`,
`requestEnemyParty` `:988-997`, `requestStateSync` on checksum mismatch `:975-981`) plus a full
snapshot pull on rejoin (`coop-runtime.ts:958-989`). Each is a bespoke patch for one lost message.
The envelope model needs ONE durability layer under all of them.

### 4.1 What is journaled

The application-level journal records **committed operations only** — i.e. every envelope that
advanced `revision` (transition `committed → applied`, §1.3). Concretely, the host appends
`{ revision, epoch, operationId, logicalPhase, envelope }` to an in-memory ring the moment it
commits. NOT journaled:
- `proposed` intents (they are not yet authoritative; a lost intent is re-proposed by the owner, §4.2);
- `rejected` / `superseded` ops (no state changed, nothing to replay);
- presentation-only traffic (`battleEvent` `coop-transport.ts:1041`, cosmetic `uiInput` `:1143`) —
  these are explicitly declared unable to desync (`:1037-1039`: "a dropped/reordered/late
  `battleEvent` only stutters the animation; it can never desync the guest"), so they are never
  journaled or resent; the checkpoint reconciles them.

The journal is the authoritative, totally-ordered history of committed operations within an epoch.
Its entries are keyed by `revision` (dense, monotonic, gap-detectable, §1.5). It is bounded (a ring
of the last N revisions — size TBD by the implementer, but ≥ the deepest reconnect gap observed in
soak; a guest further behind than the ring falls back to a full `stateSync` snapshot, §4.4). The ring
cap mirrors the existing bounded diagnostic ring pattern (`coop-renderer-gate.ts:49-51`).

### 4.2 ACK / resend

- **Guest → host ACK.** The guest, after applying an envelope, sends `{ t: "envelopeAck"; epoch;
  revision }` (new additive message). The host tracks the guest's last-acked revision.
- **Host resend.** If the host commits `revision = R` and does not see an ACK for it within a bound,
  it resends the journal entry for `R`. Resend is SAFE because guest application is idempotent by
  `(epoch, revision, id)` (§1.6): a re-delivered envelope the guest already applied is a no-op. This
  replaces the per-surface "re-broadcast on every request" idempotent-resend pattern
  (`coop-transport.ts:952-953,963-964`) with one mechanism.
- **Intent resend (guest-owned ops).** A `proposed` intent is not journaled, so the OWNER is
  responsible for resending it until it sees its operation reach `committed`/`applied` (or a
  `rejected`) in an envelope. This is the typed successor of the existing owner-relay resend loops.
- **Reciprocal barriers collapse to ACKs.** The rendezvous "both may proceed" barrier (§2.3) becomes
  "host has committed `revision = R` AND guest has acked `R`." The named barriers
  (`cmd:`/`shop:`/`biomepick:`) are retired as their surface migrates.

### 4.3 Outbound queue + backpressure bounds

Replace the drop-on-not-open (`coop-webrtc-transport.ts:185-193`) with a bounded outbound queue:
- When `readyState !== "open"`, ENQUEUE the frame instead of dropping it; flush FIFO on the channel's
  `open` event. This directly fixes the "frames sent while the channel was dark are LOST"
  hazard the rejoin path calls out (`coop-runtime.ts:942-943`).
- **Bounds (backpressure).** The queue is bounded by BOTH count and bytes. On overflow the policy is
  NOT to drop arbitrary frames (that reintroduces silent loss) but to COLLAPSE: because the journal is
  revision-keyed and idempotent, a full outbound queue can be replaced by a single "resync-from-
  revision-R" request (§4.4) — the newest authoritative state supersedes every queued older envelope.
  Presentation frames (`battleEvent`, cosmetic `uiInput`) are the FIRST to shed under backpressure
  (they are declared desync-safe, §4.1), before any journaled envelope.
- **Keepalive stays.** The 5s keepalive (`coop-webrtc-transport.ts:162-182`, #857) is orthogonal and
  unchanged — it keeps the channel from idle-teardown; the queue handles frames while it is briefly
  down. Do NOT enqueue keepalive pings (they are time-sensitive, `sendKeepalive` `:173-182`).

### 4.4 Reconnect-from-revision protocol (invariant 7)

Today rejoin restores DATA only (`coop-runtime.ts:957` "The GUEST missed events while dark: pull the
host's full authoritative snapshot") and explicitly does NOT restore the pending operation. The new
protocol returns checkpoint + current pending operation + journal tail:

1. On rejoin (SAME epoch, §1.4), the guest sends `{ t: "reconnectSync"; epoch; lastAppliedRevision }`
   (successor of `requestStateSync` `coop-transport.ts:981`, carrying a revision instead of a turn).
2. The host responds based on the gap:
   - **Gap within the journal ring** (`lastAppliedRevision` ≥ `headRevision − ringSize`): send the
     journal TAIL — every committed envelope from `lastAppliedRevision + 1` to head, in order, PLUS
     the current `pendingOperation` (even if still `proposed`/`committed`, so the guest re-enters the
     in-flight interaction rather than restarting it — this is the piece rejoin drops today).
   - **Gap deeper than the ring**: fall back to a full `stateSync` snapshot
     (`CoopFullBattleSnapshot`, `coop-transport.ts:457,975`) at the head revision, then the pending
     operation. This is the existing heavy-snapshot path, now revision-stamped.
3. The guest applies the tail idempotently (§1.6), lands at head revision, adopts the pending
   operation, and resumes. Because the epoch is unchanged, its pre-drop `operationId`s are still
   valid, so an in-flight op it had already proposed is de-duped, not double-applied.
4. Buffer hygiene from #861 is preserved: the guest still purges pre-drop relay/rendezvous buffers
   (`coop-runtime.ts:959-967`) before applying the tail, so no stale pre-drop frame races the
   authoritative tail. Under the envelope this is belt-and-suspenders (the epoch+revision guard
   already rejects them) but is kept until the legacy relays are fully retired.

The load-bearing addition over today: **the pending operation travels with the reconnect**, so a
partner who dropped mid-shop / mid-ME / mid-biome-pick resumes that exact interaction. This closes the
"resume landing INSIDE an in-progress interaction is not restorable" gap the counter comment records
(`coop-session-controller.ts:497-500`) — for a HOT REJOIN (same epoch). A cold RESUME (new epoch)
still restarts the interaction from the top, which is acceptable and unchanged (§1.4).

### 4.5 "Fail closed" concretely (invariant 8)

For an unknown `logicalPhase` or unknown `pendingOperation.kind` on the guest (§1.7):
1. Do NOT run any local phase or open any local prompt. (Contrast today: an unlisted phase RUNS
   because the gate is a denylist, `coop-renderer-gate.ts:59-60`; an unclassified UI mode only WARNS,
   `ui.ts:792-793`.)
2. Hold at the last known-good applied state (last envelope whose phase/kind the guest recognized).
3. Emit a diagnostic (reuse `recordCoopRendererNeutralized` / `coopWarn`, `coop-renderer-gate.ts:67`,
   `ui.ts:800-801`) so the harness proves the guest ran nothing unknown.
4. Request a reconnect-sync (§4.4) — treat the unknown envelope as a gap to be re-fetched, on the
   assumption the guest is on a stale build (the protocol-version handshake, §5, should already have
   flagged this: `versionMismatch` `coop-session-controller.ts:847-852`).
5. If the unknown persists after resync (genuinely newer host on an incompatible protocol), surface
   the existing hard-refresh banner (`coop-runtime.ts:717-719,881-882`) rather than degrade into
   local play — a guest that cannot understand the host's control plane must STOP, not improvise.

The renderer gate's own harness proof mechanism (the neutralized-log,
`coop-renderer-gate.ts:73-81`) becomes the fail-closed proof: the allowlist harness asserts the guest
neutralized every mutating/host-only/unknown phase and ran only §3.1 ∪ §3.2.

---
