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
