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

> **STEP-0 VALIDATION VERDICT (W2b, 2026-07-10) — decision #3 CONFIRMED, no amendment needed.**
> The doc's highest-risk reading — hot rejoin keeps the SAME epoch so op ids/waiters survive, cold
> resume takes a NEW epoch and restarts — was validated against the actual rejoin code:
> - **Hot rejoin swaps only the WIRE, keeping the whole runtime in place.**
>   `WebRtcTransport.replaceChannel` (`coop-webrtc-transport.ts:130-143`) increments only a
>   transport-internal `wireGeneration` (used to inert stale channel events, `:99-122`) and swaps
>   `this.wire`; everything above — controller, relays, streamers, `interactionRelay`, `rendezvous`,
>   `mePump`, and the run itself — holds the SAME `WebRtcTransport` + the SAME `CoopRuntime`. No teardown
>   (`makeCoopRejoinDriver`, `coop-webrtc-connect.ts:300-324`).
> - **The session generation (#808) does NOT bump on rejoin.** `sessionGeneration` is incremented ONLY
>   in `clearCoopRuntime()` (`coop-runtime.ts:2058`, a full teardown); its own comment states it is
>   "bumped when a session is TORN DOWN … Deliberately NOT bumped by setCoopRuntime" (`:1180-1186`). So
>   `coopSessionGeneration()` is STABLE across a hot rejoin — every async continuation / waiter / op id
>   pinned to it survives. This is a SEPARATE counter from `wireGeneration`; conflating them was the one
>   plausible way the reading could have been wrong, and it is not.
> - **The interaction counter survives** (it lives on the controller, not reconstructed on rejoin), so an
>   `operationId = ${epoch}:${owner}:${pinnedCounter}` stays valid after a hot rejoin — exactly as §1.4/§4.4
>   require.
> - **Cold resume genuinely re-inits identities.** The counter is re-initialized from base 0 on a fresh
>   runtime assembly and is NOT persisted (`coop-session-controller.ts:493-508`) — matching the NEW-epoch
>   mapping. (W2b's §4 persistence, below, adds an OPTIONAL carry of the counter so parity stays stable
>   across a cold resume, without changing the epoch-bump rule: a cold resume still restarts the in-flight
>   interaction from the top.)
> Conclusion: the load-bearing distinction rests on real, verified mechanism. W2b builds
> reconnect-from-revision on top of it unchanged.

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

### 4.6 W2b implementation notes (what shipped, and the deltas vs. this section)

Wave-2b built the durability SUBSTRATE (`src/data/elite-redux/coop/coop-durability.ts`) as a generic,
engine-free layer that Wave-2a's operation envelope plugs into later. The design above is implemented
faithfully; the deltas below are the concrete choices + one refinement, recorded here (not in a shared
file) per the coordination rule.

- **Generic `(class, seq)` journal, not envelope-typed.** `CoopJournal` / `CoopReceiveLedger` /
  `CoopDurabilityManager` are keyed on an opaque `(class, seq)` pair, NOT on `CoopAuthoritativeEnvelopeV1`.
  W2a's envelope becomes exactly one class — `cls: "envelope"`, `seq: revision` — by supplying the manager's
  `extractKey`/`apply` hooks; the durability module never imports the envelope type. Until W2a wires those
  hooks the manager is an inert scaffold (it runs only the ACK/reconnect arms, applies no inbound op).
- **Wire arms are named generically.** The doc's `envelopeAck` / `reconnectSync` (§4.2/§4.4) ship as the
  class-generic `coopAck { cls, seq }` and `coopResync { cls, from }` (`coop-transport.ts`). They ARE the
  doc's messages, generalized over class — the envelope's ack/reconnect are `cls:"envelope"` instances.
  Additive + forward-safe (ignored via the unknown-`t` default arm).
- **Message-class split (§4.1) is a pure function.** `classifyCoopMessage` splits the wire into
  `durable` (the authoritative backbone) / `cosmetic` (`battleEvent`/`uiInput`/`meCursor`/`meMessage` —
  the exact set `coop-fault-transport.ts` faults by default) / `internal` (`ping`/`pong`/`stallBeat`,
  never queued or journaled).
- **Outbound queue collapse (§4.3) is implemented as: shed cosmetic, bound durable by count AND bytes,
  and on overflow DROP the backlog + raise `needsResync`** — safe because the journal (not the queue) is
  the durable record, so a reconnect-from-revision replays what the collapsed queue dropped. Wired into
  `WebRtcTransport.send` behind the flag; the legacy drop-on-not-open remains when the flag is OFF, and
  `wire.send` is now error-caught (previously an uncaught throw out of every caller).
- **Flag (§5):** `isCoopDurabilityEnabled()` (`coop-durability.ts`), default ON, override via
  `?coopdurability=` / `localStorage.coopDurability` / `ER_COOP_DURABILITY` env (so both flag states are
  CI-exercisable). The manager + queue are created only when the flag is ON at assembly.
- **REFINEMENT to §1.4 (persistence).** §1.4 says the counter re-inits from 0 on a cold resume (hence the
  epoch bump). W2b ADDITIONALLY persists the interaction counter + the journal high-water into
  `SessionSaveData.coopControlPlane` and restores them on a cold resume, so the counter/revision stream
  continues MONOTONICALLY rather than resetting to 0. This does NOT change the epoch-bump rule (a cold
  resume still takes a new epoch and restarts the in-flight interaction from the top); it only keeps
  alternating-owner PARITY stable across a resume — a resume from an odd counter no longer silently flips
  ownership. The `restoreInteractionCounter` seam (removed as #833 production-dead precisely because the
  counter was unsaved) is restored now that the save carries a value.
- **Reconnect wiring.** `runtime.durability?.reconnect()` runs in the #805 rejoin path AFTER the existing
  buffer purge (so no stale pre-drop frame races the tail) and BEFORE/alongside the existing full-snapshot
  pull, which remains the deep-gap fallback (§4.4). Health line + control-plane block gain
  `journal=<depth>/<unacked> queue=<n>[!]`.
- **Proof.** Engine-free unit tests (`coop-durability.test.ts`) exhaustively cover classification, the
  queue (FIFO/shed/collapse on count+byte overflow), the journal (commit/ACK/drop-before-ack resend),
  receiver dedupe+gap, reconnect tail replay + idempotent overlap + deep-gap full-snapshot, and the
  persistence round-trip. A duo/fault proof (`coop-durability-convergence.test.ts`) CUTS the channel
  between the send and receive of an authoritative op — mid-stream (gap-triggered tail) and tail
  (rejoin-triggered resend) — and over the seeded fault transport, asserting convergence WITH the bespoke
  self-heals (`requestStateSync`/`stateSync`/`requestRunConfig`/`requestRoster`/`requestEnemyParty`/
  `rendezvous`) provably NEVER on the wire — the journal is the mechanism (review finding 3 closed
  generically). The bespoke self-heals remain as backstops but are no longer the repair path.

### 4.7 W2e implementation notes — the operation↔durability seam (final carrier architecture)

> **CORRECTION (W2e-R):** the "CLOSED" claim below is OVERSTATED — an accepted review found the seam
> could ACK an op as applied while mutating NOTHING. See §8.6 for the P0 remediation + the honest residual
> (production live materialization is keystone-blocked; the seam is added + the false-ACK fixed, not fully
> closed). Read the notes below as the CARRIER architecture, not a correctness closure.

Wave-2e plugged the operation ENVELOPE (W2a) into the durability JOURNAL (W2b) — the deliberate,
documented parallel-lane seam ("the durability manager is a wired but passive scaffold UNTIL the
envelope commit path calls `runtime.durability.commit(...)`"). The final carrier architecture:

- **The `envelope` arm is the journaled op carrier; `coopAck`/`coopResync` are its ack/reconnect.**
  A committed op now rides the additive `envelope` wire arm (§1.1) through the durability journal:
  the bridge `coop-operation-journal.ts` (`journalCoopCommittedEnvelope`) calls
  `CoopDurabilityManager.commit(cls, revision, { t:"envelope", envelope })` the moment a surface
  adapter's `CoopOperationHost` commits (owner seam, OR the host's watcher seam for a guest-owned op —
  the host is the sole committer, invariant 3). The manager journals + broadcasts it, ACKs it
  cumulatively (`coopAck`), and resends / reconnect-tails it (`coopResync`). So a committed op is a
  journaled, ACK'd, resendable wire frame end-to-end.
- **WIRE CONSOLIDATION (the parallel-lane merge cleanup).** The doc's envelope-specialized
  `envelopeAck` / `reconnectSync` (§4.2/§4.4) are **RETIRED** — they never shipped a sender or a
  receiver. The generic, class-parameterized W2b `coopAck { cls, seq }` / `coopResync { cls, from }`
  ARE the envelope's ack + reconnect (the envelope is class `op:<surface>`, seq = revision). One
  ack/reconnect family serves every journaled class. The `#820` sender-only guard's
  `DECLARED_AHEAD_OF_RECEIVER` allowlist is emptied: `envelope` now has a receiver
  (`extractKey`/`apply` in the bridge), and the retired arms no longer exist in the union.
- **JOURNALED CLASS = one per surface, keyed by the SURFACE-LOCAL revision.** The class is DERIVED
  from the envelope's `logicalPhase` (no new wire field): `BIOME_SELECT → op:biome`,
  `REWARD_SELECT`/`SHOP → op:reward` (the reward shop + biome market share ONE host + ONE revision,
  §8.2.1, so both map to the same dense class), `MYSTERY_ENCOUNTER → op:me`. The surface-local dense
  revision (§8.2) is the journal seq until the global dense revision lands (all-surfaces-migrated).
- **DUAL-RUN carrier, unchanged (§5.1).** The migrated surfaces STILL ride the legacy relay carrier;
  W2e is ADDITIVE. The legacy relay-adopt path drives the phase's actual adoption (biome switch, shop
  buy, ME control-flow); the journal is the DURABILITY ledger that converges the op history over a cut.
  Crucially the journal replay routes into a **DEDICATED** guest applier (`journalGuest`) per surface,
  SEPARATE from the relay-adopt `watchGuest`: routing it into the SAME applier let the journal steal
  the operationId the live adopt dedupes on, making the live path see its own op as a duplicate and
  fall back (caught by the duo suites). Two idempotent appliers, one op — no conflict; the DATA plane
  still travels on the checkpoint/`waveEndState` (§1.2).
- **SESSION-SAVE DIGEST parity.** `coopControlPlane.journalHighWater` is now the UNION of the
  committer's journal high-water AND the receiver's applied-through marks
  (`CoopDurabilityManager.controlPlaneHighWater`), so the host (committer, value in its journal) and
  the guest (receiver, same converged value in its ledger) serialize the IDENTICAL value — a plain
  `highWaterMarks()` is populated only on the committer, so the `saveDataDigest` diverged the moment
  the host committed its first op (the 35-wave soak caught exactly this). Cold-resume restore seeds
  both marks so a resumed guest neither re-applies nor diverges. No change to the digest formula or
  the hashed key set.
- **FLAG discipline (§5).** The plug respects EVERY flag: the manager exists only under
  `isCoopDurabilityEnabled`; the bridge's active-manager reference is installed in `setCoopRuntime`
  (so the duo harness's per-`withClient` swap journals into the ACTIVE client's manager, not a stale
  global) and cleared in `clearCoopRuntime`; and each adapter's commit / apply seam is itself gated by
  its per-surface flag. Flag OFF anywhere = today's pure legacy dual-run (no journaling).
- **NO `COOP_PROTOCOL_VERSION` bump.** All wire changes are additive: `envelope` was already declared
  (W2a) and is merely now SENT; `coopAck`/`coopResync` were already the generic durability arms
  (W2b); the retired `envelopeAck`/`reconnectSync` never flowed. No EXISTING arm's shape or semantics
  changed, so no peer misparses (an unknown-receiver peer ignores `envelope` via the default arm and
  still converges via the legacy relay dual-run). This matches the additive-only precedent of W2c/W2d.
- **Proof.** `coop-operation-durability-convergence.test.ts` (engine-free, the W2b convergence pattern +
  fault transport) drives the REAL biome adapter commit/apply path through two managers over a
  ChannelGate / seeded fault transport, CUTS the channel between the owner's committed op and the
  watcher's adoption, rejoins, and proves the op arrives via the JOURNAL resend / reconnect-tail replay
  — one test per direction (host-owned → guest; guest-minted → host), with the bespoke self-heals
  provably absent from the wire and a flag-OFF-anywhere case. The three surface `coop-duo-*-operation`
  suites stay green under BOTH flag states; the 35-wave soak (`SOAK_SEED=20260709`) + `coop-soak-me` +
  `coop-soak-resume` are green ON and OFF.

---

## 5. Rollout strategy (phased on a LIVE system)

The system is live; PROD is FROZEN and ships only on explicit maintainer clearance
(`handoff.md:54-56`); staging is the test surface. The migration must never require a big-bang cutover.

### 5.1 Per-surface migration with the old path as fallback

Every surface in §2.5 migrates INDIVIDUALLY, and the legacy relay for that surface stays as a
fallback until the envelope path is soaked for it. Concretely per surface:
1. Wire the surface through `runCoopInteraction` (`coop-interaction.ts:91`) — which is already
   built, tested headlessly, and "wired to nothing yet" (`:28`). The `CoopInteractionContext`
   (`:56-75`) adapters (`sendOutcome`/`awaitOutcome`/`applyOutcome`/`replicateState`) become thin
   shims over the envelope commit + broadcast.
2. Keep the surface's legacy relay send/await active in DUAL-RUN (§1.8): the envelope carries the
   authoritative outcome AND the legacy relay still fires, so a client on the pre-migration build (or
   the fallback path) still converges. The legacy path is the fallback if the envelope apply throws.
3. The interaction counter keeps advancing in lockstep with `revision` (§1.8) so still-legacy
   surfaces downstream see the counter they expect. Removing the counter is FORBIDDEN until every
   surface is migrated (the final step).

### 5.2 Version gating (the #806/#807 build-version handshake)

The protocol-version handshake already exists: `COOP_PROTOCOL_VERSION = "er-coop-11"`
(`coop-transport.ts:46`), exchanged in `hello` (`:839`), mismatch detected + bannered
(`coop-session-controller.ts:843-852`, `coop-runtime.ts:717-719,881-882`). Use it:
- Each migration phase that changes the WIRE (adds `envelope`, `envelopeAck`, `reconnectSync`) BUMPS
  `COOP_PROTOCOL_VERSION`. Because paired clients share the version (the additive-optional discipline,
  `coop-transport.ts:855-857`), a field is "present on both or neither" — so a mixed-build pair either
  both speak envelope or both fall back to the legacy relay, never half-and-half.
- New wire fields stay ADDITIVE + OPTIONAL (the established pattern, e.g. `coop-transport.ts:552-559,
  928-934`) so an in-flight save or an un-updated client degrades gracefully rather than desyncing.
- A hard-incompatible step (retiring the counter) is gated behind a MAJOR version bump that refuses to
  pair mixed builds (the banner path), scheduled only after every surface migrated.

### 5.3 Soak / duo proof obligations per phase

Every phase carries a MANDATORY proof, matching the existing regime (`handoff.md:117-127`):
- **A `coop-duo-*` repro** in the two-engine harness (`test/tools/coop-duo-harness.ts`) that
  exercises the migrated surface end-to-end (host commit → guest adopt → idempotent re-apply →
  reconnect-with-pending-op). "Every co-op fix gets a `coop-duo-*` repro here first" is the standing
  rule (`handoff.md:118-120`).
- **The P5 checksum assertion** (`handoff.md:126-127`) must stay green — the migrated surface must not
  introduce a hashed-state divergence. Adopt-then-hash convergence (the existing discipline,
  `coop-transport.ts:612-617`) applies: the guest adopts the envelope BEFORE it hashes.
- **The renderer-allowlist harness** (§4.5) asserts the guest ran nothing outside §3.1 ∪ §3.2 for the
  migrated surface.
- **Nightly 3-leg soak** (`.github/workflows/nightly-coop-soak.yml`, god / level-55 / me-asymmetric,
  `handoff.md:125-127`) must pass a full night on the migrated tree before the next phase starts.
- Gate on a QUIET box (never under load — disjoint flakies are contention, `handoff.md:50-53`).

### 5.4 Rollback story (explicit)

- **Per-surface rollback = flip the dual-run flag.** Because each migrated surface keeps its legacy
  relay live (§5.1), rollback is a one-line gate flip back to the legacy path for that surface — no
  revert of the envelope infrastructure, no wire-version churn. The envelope keeps broadcasting
  (harmless, additive); only the surface's DRIVE reverts to the counter+relay path.
- **Infrastructure rollback.** The `envelope`/`envelopeAck`/`reconnectSync` messages are additive; a
  full revert to the pre-migration commit leaves older clients unaffected (they ignore unknown `t`).
  Because the interaction counter is never removed until the final step, a rollback at any earlier
  phase leaves the live control plane (counter + relays) fully intact.
- **The point of no return** is the counter-retirement step (final). It is the ONLY step that is not
  a flag-flip rollback; it ships alone, behind a major version bump, after a full soak of the
  envelope path carrying the whole run with the counter already provably redundant (revision totally
  orders the run in soak logs). Until that step, every phase is reversible without a revert.

---

## 6. Non-goals + risks

### 6.1 Non-goals (deliberately NOT changed)

- **The authoritative DATA plane.** `CoopAuthoritativeBattleStateV1` / `CoopFullBattleSnapshot` and
  the adopt-by-`Pokemon.id` apply (`coop-battle-engine.ts:2898`) are UNCHANGED. The envelope embeds
  the existing state object (§1.2); this migration touches the CONTROL plane only.
- **The per-turn checksum + resync self-heal.** `turnResolution.checksum` (`coop-transport.ts:1047`)
  → `requestStateSync` → `stateSync` stays as the divergence backstop. The envelope adds ordering and
  idempotency; it does not replace checksum-detect-and-heal.
- **Host-authoritative resolution.** The host remains the sole engine; this is not a move to lockstep
  or client-side prediction. Guests stay pure renderers (`handoff.md:12-14`).
- **The 5s keepalive + rejoin PC-reaping** (#857, `coop-webrtc-transport.ts:162-182`,
  `coop-runtime.ts`) — orthogonal connection-liveness, untouched.
- **Showdown / versus** (`coop-ui-registry.ts:200-205`, the `showdown*` messages
  `coop-transport.ts:1207-1237`) — owned by the parallel showdown agent; out of scope (`handoff.md:80`).
- **Egg / evolution determinism** (`coop-ui-registry.ts:160-162`) — left per-client deterministic
  unless the §3.3 RENDER-DUAL review finds a divergence; not proactively rewritten.
- **The open residuals #865 (biome map derivation), #856 (catch-full release)** are addressed AS the
  biome/catch surfaces migrate (§2.5 items 1 and 6), not as separate pre-work. #865's durable close
  (make `erMapState` host-authoritative + adopted, `handoff.md:156-162`) is subsumed by the
  BIOME_SELECT operation carrying the committed map state.

### 6.2 Risks (where the migration could regress LIVE play)

| Risk | Mechanism | Mitigation |
|------|-----------|------------|
| **Dual-run desync** | The counter and `revision` drift apart mid-migration; a surface commits via envelope but the counter advance is missed, so a still-legacy surface downstream sees the wrong owner | §1.8 makes them advance in ONE code path (apply = revision++ = counter-advance); a duo test asserts they stay locked per surface |
| **Fail-closed over-blocks** | A phase mis-classified mutating/unknown (§3) neutralizes on the guest and the run HANGS instead of desyncing — arguably worse for a live player | Ship §3's allowlist in WARN-only first (like today's tripwire, `ui.ts:800`) — log what WOULD be blocked across a full soak, reconcile with the parallel agent's list, only THEN flip to enforce |
| **Journal ring too small** | A reconnect gap deeper than the ring forces a full snapshot every rejoin — heavy, and if the snapshot also drops, a loop | Size the ring ≥ deepest soak-observed gap; the full-snapshot fallback (§4.4) is the existing tested path, so worst case is today's behavior |
| **Epoch bump loses an in-flight op** | A cold resume (new epoch) mid-interaction restarts it; if the host had already applied a partial, the guest could double-drive | Cold resume restarts from the TOP (unchanged today, `coop-session-controller.ts:497-500`); only HOT rejoin (same epoch) resumes mid-op (§4.4). The distinction is the load-bearing invariant — a duo test must cover resume-mid-ME |
| **Outbound queue reorders vs. presentation** | Enqueuing envelopes while shedding `battleEvent`s could land a checkpoint before its animation | Presentation is already declared reconcile-safe (`coop-transport.ts:1037-1039`); the checkpoint is authoritative regardless of anim order — this is by design, not a regression |
| **Backpressure collapse hides a real stall** | Replacing a full queue with a resync-request could mask a genuinely dead partner | Keep the #806 stall watchdog + `peerBeat` health line (`handoff.md:99-101`) — collapse handles transient darkness, the watchdog still catches a truly dead client |
| **Version-mismatch during a phased rollout** | A player on a stale cached bundle pairs mid-migration | The existing handshake refuses/banners the pair (`coop-session-controller.ts:847-852`); additive-optional fields keep an un-bumped pair on the legacy path |
| **Counter retirement (final step)** | The one non-reversible step; a latent counter dependency surfaces after removal | Precede it with a soak where `revision` provably orders the whole run WITH the counter still present but unread by any migrated surface; remove only when it is demonstrably dead (the same "production-dead" bar that removed `restoreInteractionCounter`, `coop-session-controller.ts:498-500`) |

### 6.3 The single biggest live-regression hazard

Flipping §3's default from ALLOW (denylist) to DENY (allowlist) is the highest-stakes change: a
false-negative today produces a silent DESYNC (bad but self-healing via checksum); a false-negative
under fail-closed produces a HANG (a neutralized phase the guest needed). The migration therefore
runs the allowlist in WARN-only across a full soak (§6.2 row 2) and only enforces after the parallel
agent's independently-derived list and this one agree row-for-row (§3.5). Do not flip the default on a
single agent's classification.

---

## 7. Implementation-readiness checklist (for the Wave-2 agent)

A Wave-2 agent building from this doc alone can:
- Build the envelope (`§1.1`) as an additive `CoopMessage` arm embedding the existing
  `CoopAuthoritativeBattleStateV1` — no data-plane changes.
- Build the journal (`§4.1`) as a revision-keyed bounded ring of committed envelopes, with ACK/resend
  (`§4.2`) and the reconnect-from-revision protocol (`§4.4`) replacing the per-surface re-request loops.
- Migrate one surface (`§2.5` order, `§5.1` procedure) by wiring it through the already-built
  `runCoopInteraction` (`coop-interaction.ts:91`), keeping the legacy relay as dual-run fallback, and
  proving it with a `coop-duo-*` repro + the P5 checksum + the allowlist harness (`§5.3`).
- Keep the interaction counter live and lock-stepped to `revision` (`§1.8`) until the final step.
- Never flip the renderer allowlist default without cross-checking `§3` against the parallel agent.

---

## 8. TEMPLATE — how to migrate a surface (distilled from Wave-2a: biome travel)

Wave-2a migrated the FIRST surface (biome travel: `biomePick` #15 + `crossroads` #14) onto the
operation model. This is the recipe every later surface copies. It is grounded in the actual files
that landed:
- `src/data/elite-redux/coop/coop-operation-envelope.ts` — the envelope types + id mint/parse + closed-union guards (§1.1).
- `src/data/elite-redux/coop/coop-operation-runtime.ts` — `CoopOperationHost` (commit log) + `CoopOperationGuest` (idempotent applier), engine-free (§1.3-§1.7).
- `src/data/elite-redux/coop/coop-biome-operation.ts` — the per-surface ADAPTER (flag + owner-commit seam + watcher-adopt gate).
- `test/tests/elite-redux/coop/coop-operation-runtime.test.ts` — the lifecycle SPEC (exhaustive, engine-free).
- `test/tests/elite-redux/coop/coop-duo-biome-operation.test.ts` — the two-engine end-to-end + adversarial repro.

### 8.1 The steps

1. **Declare the operation kind + payload** in `coop-operation-envelope.ts`: add the `CoopOperationKind`
   member(s) (they are already declared for every §2 surface) and a typed per-kind payload interface. Add
   the kind to `KNOWN_OPERATION_KINDS` (it is the fail-closed allowlist, §1.7).
2. **Write a per-surface adapter** `coop-<surface>-operation.ts`, modeled on `coop-biome-operation.ts`:
   - a FLAG (`is<Surface>OperationEnabled()` / `set…Enabled()` / `reset…Flag()`), default ON, gated by the
     `COOP_PROTOCOL_VERSION` bump (§5.2). An env override (`process.env.<SURFACE>_OP === "off"`) lets CI +
     rollback force legacy;
   - per-session state (`CoopOperationHost` on the authority, `CoopOperationGuest` for watching, a
     `lastAppliedPinned` watcher order), created lazily and RESET on session boundaries (step 5);
   - an OWNER-parity validator (`intent.owner === coopInteractionOwnerSeat(pinned)`) — the typed successor
     of `isLocalOwnerAtCounter`;
   - an OWNER-commit seam (`commit…OwnerIntent`) — mints the typed intent, and on the authority COMMITS it
     through `CoopOperationHost.submit` (revision++);
   - a WATCHER-adopt gate (`adopt…WatcherChoice`) — wraps the awaited relay result, (on the authority)
     commits the guest's intent, then gates adoption idempotently by `operationId` + the monotonic pinned
     order (invariants 5, 6). Returns `{ adopt } | { adopt:false, reason }`. When the flag is OFF it is a
     pass-through (pure legacy).
3. **Wire the phases at exactly two seams**, ADDITIVELY (never delete the legacy relay send/await):
   - OWNER terminal (the single relay-send funnel, e.g. `coopRelayOwnerBiome` / `coopOwnerCommit`): keep
     the legacy `sendInteractionChoice`, then ALSO call `commit…OwnerIntent` (dual-run, §1.8);
   - WATCHER adopt (right after `awaitCoopChoiceWithOrphanBackstop`): route the awaited `res` through
     `adopt…WatcherChoice`; on `adopt:false` fall to the SAME deterministic backstop the timeout path uses.
4. **Bump `COOP_PROTOCOL_VERSION`** (paired clients share it, so a session is both-envelope or both-legacy,
   never half — §5.2) and add the `envelope`/`envelopeAck`/`reconnectSync` arms if not already present
   (additive, forward-safe).
5. **Reset the operation state on session boundaries**: call `reset…OperationState()` from BOTH
   `assembleCoopRuntime` (session start — a fresh control plane, §1.4) and `clearCoopRuntime` (teardown),
   so a new run's counter (re-init from base 0, reusing seq addresses) can never collide with a prior run's
   applied `operationId`s. Do NOT reset on hot rejoin (it pulls a snapshot without re-assembling).
6. **Prove it** (§5.3): the surface's existing `coop-duo-*` suites green under BOTH flag states (env
   `<SURFACE>_OP=off` forces legacy); a NEW `coop-duo-<surface>-operation` test driving the migrated path
   end-to-end PLUS one adversarial case (a stale buffered pick from a previous op is rejected — the #861
   shape); the 35-wave soak green under both flag states. `tsc` zero new vs parent.

### 8.2 Design deltas Wave-2a hit (amendments to the doc's model, honored by every later surface)

- **Carrier (dual-run rides the relay, not a new wire message).** §1.1 adds an `envelope` message; §5.1.2
  keeps the legacy relay firing. Wave-2a rides the envelope's CONTROL fields over the EXISTING relay
  carrier and sends NO new wire message — the biome decision's DATA still travels on the existing
  per-turn checkpoint / `waveEndState` (§1.2 keeps the data apply as-is). The `envelope`/`envelopeAck`/
  `reconnectSync` arms are therefore DECLARED but not yet sent/received (both ends land in the journal
  wave, Wave-2b). Consequence: the `#820` sender-only-channel guard allowlists them until Wave-2b.
- **Surface-local revision, not the global dense revision.** §1.5's `revision` is dense across ALL
  surfaces + turns. With only ONE surface migrated, the biome ops are sparse in the global order (the
  counter advances for still-legacy reward/ME interactions in between), which would false-trip the guest
  applier's gap check. Wave-2a feeds the guest a SURFACE-LOCAL dense revision (+1 per biome/crossroads op)
  and enforces cross-op stale ordering on the pinned interaction counter (which advances in lockstep,
  §1.8). The global dense revision replaces the surface-local one when every surface is migrated.
- **`authoritativeState` placeholder for control-only classification.** The guest applier reads only the
  CONTROL fields; the watcher-gate builds an envelope with a minimal placeholder `authoritativeState` it
  never adopts (the real adopt-by-id apply is untouched, adjudication (a)). Later waves that broadcast a
  real `envelope` embed the live state object by reference (§1.2).
- **Single-process harness state-sharing pitfall (important for every duo test).** In the two-engine
  harness both clients share module-level state (production has separate processes). The owner-commit and
  watcher-adopt of the SAME interaction must not contaminate each other: advance the monotonic
  `lastAppliedPinned` order ONLY on a watcher adoption, never on the owner's own commit, and reject a pick
  strictly BELOW it (`<`, not `<=`) so a re-delivery is caught by the `operationId` dedupe instead. Reset
  the surface state at session assembly so reused seq addresses across runs/scenarios don't false-dedupe.

### 8.2.1 Design deltas Wave-2d hit (reward shop + biome market, SURFACE 3 — multi-action stream)

Wave-2d migrated the highest-traffic surface (`reward`* #1 + `biomeShop` #5, `coop-reward-operation.ts`).
It is the first surface where ONE pinned interaction relays a STREAM of actions (buy, buy, lock, reroll,
… leave) rather than a single pick, and that forced two amendments every later multi-action surface (ME,
colosseum) copies:

- **MULTI-ACTION OPERATION-ID (the single-pin id is not enough).** Wave-2a keyed the `operationId` on the
  pinned counter alone (`${epoch}:${owner}:${pin}`) because biome travel is one-pick-per-pin. A shop relays
  N actions on the SAME pin, so a pin-only id would make the guest applier dedupe every action after the
  first. Wave-2d suffixes the pin with a **per-interaction monotonic ACTION ORDINAL** (`pin * ACTION_STRIDE
  + ordinal`), tracked SEPARATELY for the owner (advanced on commit) and the watcher (advanced on adopt) so
  the two roles never contaminate in the single-process duo harness (§8.2 pitfall). The ordinal resets when
  the pin changes; a reroll/continuation KEEPS the pin, so the ordinal (and the operation identity) carries
  across it. This generalizes cleanly: a single-pick surface is just the ordinal-always-0 case.
- **TWO WATERMARKS, not one, for a stream.** Wave-2a's single `lastAppliedPinned` (`pick < it` → reject)
  can't distinguish "a legit 2nd buy on the current interaction" (same pin, must ADOPT) from "a stale
  leftover / a late-after-leave" (reject). Wave-2d splits it: `lastAdoptedStart` (the highest interaction
  the watcher adopted ANY action at — `pin < it` rejects a strictly-earlier interaction's leftover, the
  #861 cross-interaction shape) AND `lastLeftStart` (the highest interaction the watcher adopted a TERMINAL
  skip/leave for — `pin <= it` rejects a late choice for an interaction already LEFT). Within a live
  interaction (`pin > both`) every action passes, so a legitimate multi-buy stream is adopted verbatim. The
  strict-`<` vs `<=` distinction is load-bearing: adopts use `<` (same-pin actions pass), the leave uses
  `<=` (same-pin late choices reject).
- **NESTED SUB-PICKS = MULTI-STEP OP PAYLOAD, not sub-operations.** The party-target / TM-move-slot /
  ability-slot / fusion-pair sub-pick a reward can require is NOT a separate operation. The reward shop
  already collapses the party-target menu into the ONE terminal relay (`coopFlushPending([slot, option])`
  → one `coopRelaySend`), so the sub-pick rides in that single action's payload `data` (a "multi-step op
  payload"). One human reward decision = one operation, regardless of how many sub-menus it walked through.
  Separate sub-SURFACES that fire their OWN relay channel (the ability-capsule phase #4, learn-move-forward
  #11) stay their own operations, migrated in their own wave — the boundary is "does it fire its own relay
  send," not "is there a nested menu."
- **CONTINUATION COPIES inherit the OPERATION, not a raw pin (#866, confirmed).** A move-learn continuation
  copy (`BiomeShopPhase.copy()` / the base `SelectModifierPhase.copy()`) re-opens the shop on the
  ALREADY-pinned interaction. Because the `operationId` derives from the inherited pin (+ the continuing
  ordinal), the copy's actions keep the SAME operation identity and the SAME watermark tier — it is NOT the
  unpinned orphan #866 described (whose terminal fired an asymmetric #837 unpinned advance and opened a
  stray screen). The adapter needs NOTHING copy-specific: inheriting the pin is sufficient, which is the
  general rule — a continuation is "same interaction, later action," structurally indistinguishable from a
  second buy.
- **SHARED STATE ACROSS SIBLING SURFACES is correct here.** The reward shop and the biome market pin on
  DIFFERENT fields (`coopInteractionStart` vs `coopBiomeStart`) but the SAME monotonic interaction-counter
  space, so `coop-reward-operation.ts` serves BOTH with ONE shared watermark/host/guest state — a
  reward-then-market run gets cross-surface stale rejection for free. Sibling surfaces that share a counter
  space should share adapter state; surfaces on disjoint counters should not.

### 8.3 Flag semantics (per surface)

`is<Surface>OperationEnabled()`: default ON. Activation is HARD-gated by the `COOP_PROTOCOL_VERSION`
handshake — a mixed-build pair refuses to pair / banners (`coop-session-controller.ts:843-852`), so a live
session has both peers on the envelope build. The legacy path stays selectable: `set…Enabled(false)` is the
one-line per-surface rollback (§5.4) — it reverts only the surface's DRIVE to the counter+relay path; the
envelope infrastructure keeps running harmlessly. CI/soak force legacy via the `<SURFACE>_OP=off` env
override. The counter and the legacy relay are NEVER removed until every surface is migrated (§1.8, §5.4).

### 8.4 Design deltas Wave-2c (mystery encounters) hit — what ME taught that biome didn't

Wave-2c migrated the SECOND surface (mystery encounters: `mePresent`/`me`/`meSub`/`meBtn`/`quizAns` +
the ME terminals, #8/#9/#10, the #859/#860/#862 cluster) onto the operation model, cloning
`coop-me-operation.ts` structurally from `coop-biome-operation.ts`. Biome was a SINGLE, atomic,
symmetric decision per interaction; the ME surface is none of those, so it amended the template in five
ways every later MULTI-STEP / host-authoritative surface (reward shop, colosseum, bargain) will reuse:

- **A surface interaction can be MULTI-STEP (biome was one op per pinned counter).** One pinned ME
  interaction counter spans an ordered sequence of decisions: `ME_PRESENT` → `ME_PICK` → N `ME_SUB` /
  `QUIZ_ANSWER` → `ME_TERMINAL`. Biome's operationId suffix was just the wire seq (one op per pinned
  slot); here that would COLLIDE (a present and a pick share the 8M seq; repeated sub-picks / quiz
  answers FIFO on one seq). The adapter mints the suffix from a per-kind + per-step address
  (`meOpAddr(kind, seq, step)`) so every step of the SAME ME is a DISTINCT id for idempotent dedupe
  (invariant 5). **Consequence for the cross-op stale-ordering guard (§8.2 delta 4):** it must advance
  `lastAppliedPinned` ONLY at the TERMINAL, never on a mid-ME step — every step of one ME shares the
  pinned counter, so advancing mid-ME would make the ME's own later steps false-trip the `pinned <
  lastAppliedPinned` stale check. (Biome never hit this: its single op WAS its terminal.)
- **Ownership is per-KIND, not one seat per interaction.** Biome's owner was always the counter-parity
  seat. In an ME the presentation ack + the terminal are HOST-authoritative regardless of who owns the
  encounter (the host is the sole ME engine, #693), while the pick/sub/button/quiz are owner-alternated.
  So the adapter resolves the expected owner seat per kind (`ownerSeatFor`), and the parity validator is
  passed that seat rather than deriving it from the pinned counter alone.
- **The host-STATED terminal TYPE is the structural cure for the phantom class (#859/#860).** Biome had
  one terminal shape; an ME terminal branches (`CoopMeTerminalKind`: `leave` vs `battle`). Committing the
  TYPE on the `ME_TERMINAL` op means the watcher routes its terminal off the OPERATION (leave the
  encounter vs boot the spawned battle) BEFORE it builds any phase — it can never infer "there is a battle
  turn" from a leftover battle chain, which is exactly the #859/#860 phantom-turn softlock. A stale
  battle-handoff from an earlier ME is then rejected by the same stale/dedupe gate, so it can't build the
  phantom either. This is the first surface where the committed op's PAYLOAD (not just its existence)
  drives a watcher control-flow branch.
- **A single owner-alternated decision commits on TWO clients, at TWO sites.** A guest-owned `ME_PICK` is
  MINTED on the guest (`handleGuestOptionSelect`, owner-side, a no-op-commit mint on the guest) but
  COMMITTED on the host (`coopHostAwaitGuestIndex`, where the sole engine receives the relayed index) —
  the host is the sole committer (invariant 3). Biome's owner committed on its own client because biome
  had no host-relays-to-engine step. The host-owned pick has its OWN owner seam (`handleOptionSelect`,
  gated to the host-owned branch, disjoint from the guest-owned commit).
- **A battle-handoff ME has TWO terminals on the same wire seq.** The battle handoff at spawn
  (`ME_TERMINAL` `battle`, step 0) and the TRUE post-battle leave (`ME_TERMINAL` `leave`, step 1) both
  ride `9M + counter`; without distinct step ordinals the second would re-ACK the first's id and never
  commit. (Biome's terminal fired exactly once.)

Harness note (§8.2 delta 4, extended for a bidirectional handshake): the duo ME rig's
`relayGuestMeOptionIndexOnly` sends the raw `me` wire DIRECTLY (bypassing `handleGuestOptionSelect`, for
cross-ctx control), so the guest-side MINT isn't exercised by the harness — assert the HOST-side commit
(the load-bearing invariant-3 proof) instead. And a guest-owned ME arms the host's
`coopHostAwaitGuestIndex` await at ME entry: an assertion that THROWS mid-handshake aborts the drive
before the await is resolved, leaking a pending promise that later fires `handleOptionSelect` under a
LATER test's scene (an `encounteredEvents` under-read). Drive every guest-owned handshake to full settle
BEFORE asserting.

### 8.5 Design delta Wave-2e (the durability journal is now LIVE under every migrated surface)

Wave-2e is not a new surface — it CLOSED the operation↔durability seam (§4.7). The template gains one
step every surface already satisfies for free, and one it must NOT skip:

- **A committed op now journals automatically.** A surface's `CoopOperationHost` commit already runs
  through the adapter's owner + host-watcher seams; those seams now call
  `journalCoopCommittedEnvelope(res.envelope)` after a `committed` result, so the op rides the journaled
  `envelope` arm with zero per-surface wiring beyond the one call. The class is derived from the
  envelope's `logicalPhase` (`coopOperationClassForPhase`); a NEW surface only needs its phase added to
  that map (and a `registerCoopOperationApplier` at import) — see §4.7.
- **Route the journal replay into a DEDICATED applier, never the relay-adopt `guest()`.** The dual-run
  legacy relay still drives the phase; the journal is the durability ledger. Sharing one applier lets
  the journal steal the operationId the live adopt dedupes on (the live path then falls back). Each
  adapter keeps a separate `journalGuest` for the replay path (§4.7).
- **`journalHighWater` in the save must be the committer∪receiver union** (`controlPlaneHighWater`), or
  the `saveDataDigest` diverges the moment the host commits (only the committer holds a journal
  high-water; the receiver holds the same value in its ledger). This is a surface-agnostic fix in the
  save path, not per-surface, but a new surface's class must be a dense committed-op stream for it to hold.

### 8.6 W2e-R — P0 remediation of the operation↔durability seam (CORRECTS the §4.7/§8.5 "CLOSED" claim)

An accepted external review found §4.7/§8.5 OVERSTATED: the seam was NOT closed. The Wave-2e receiver
could ACK an operation as APPLIED while performing ZERO game-state mutation — `CoopDurabilityManager`
called a **void** apply hook then **unconditionally** `markApplied` + `coopAck`, and each surface's
journal applier routed a replayed committed envelope into a **dedicated sidecar `journalGuest` that only
recorded history**. So a lost legacy relay → journaled envelope → NO biome/party/money/phase mutation →
an ACK claiming applied. The W2e convergence test missed it because it asserted JOURNAL HISTORY, not live
state. W2e-R remediates the mechanism and re-scopes the claim honestly:

- **The ACK is gated, and it means "durably received/recorded", never "live-mutated"** (P0-1). The apply
  hook now returns a tri-state `CoopApplyOutcome` (`coop-durability.ts`): `applied`/`duplicate` (or a
  legacy `void`) → ACK + ledger-advance (a `duplicate` ACKs too, so a cross-carrier / resend re-delivery
  of an already-consumed op cannot spin the committer's resend loop); `rejected` (or a THROWN apply, now
  caught) → NO ACK, NO advance, retriable. Gating the ACK on *live materialization* was explicitly
  REJECTED: it re-opens the permanent `controlPlaneHighWater`/`saveDataDigest` divergence + resend churn
  §4.7 closed (the host committer advances its journal high-water on commit; if the receiver never
  ACK'd/markApplied, host=N vs guest=N-1 forever, and the 35-wave soak digest gate fails).
- **The journal carrier now ROUTES a newly-consumed op INTO the ONE live-mutation seam**
  (`routeCoopOperationToLiveSink` / `registerCoopOperationLiveSink`), not a history-only sidecar (P0-1
  structural). A test registers a recording sink to PROVE the routing (the convergence proof now asserts
  LIVE STATE — the op reached the seam — as PRIMARY, journal history secondary).
- **The producer revision survives a cold resume** (P0-3). Each surface `CoopOperationHost` + guests now
  initialize from the persisted per-class high-water via `setCoop<Surface>OperationRevisionFloor`, called
  from `applyCoopControlPlaneSaveData` (keyed by op class). The producer continues at N+1 (not restart at
  1), so the restored receiver ledger at N ACCEPTS it. Chosen over an epoch-bump-and-reset because W2b's
  persistence already continues the counter/high-water monotonically (§1.4/§4.6); the epoch is unchanged,
  so the restored receiver marks stay valid.

**RESIDUALS (the seam is NOT yet fully closed — do not claim otherwise):**
- **Production live materialization is KEYSTONE-BLOCKED.** No biome/reward/ME sink is registered in
  production yet, because materializing a committed op on the guest (pushing `SwitchBiomePhase` etc. from
  the durability handler) is the PARKED keystone wave-advance work (§2.5 item 4, §3). Until it lands, a
  journal-delivered op in production is durably recorded + ACK'd but its LIVE state is reconciled by the
  DATA plane (the rejoin snapshot), not by the journal. W2e-R closes the FALSE-ACK and adds the seam; it
  does not itself switch the live biome from a lost relay.
- **P0-2 (unify the two ledgers) is deliberately NOT done for biome.** With no live sink, unifying
  `journalGuest` into `watchGuest` would make the relay-adopt path see the journal's `operationId` as
  already-applied and fall to its deterministic fallback → the WRONG biome (a live desync — the exact
  §8.5 hazard). The split stays until the keystone lets the journal drive the switch; then the ledger
  unifies and the dual-run relay retires.

### 8.7 Wave-2f — THE KEYSTONE (post-battle wave-advance): the FIRST live-materializing surface

Wave-2f migrated the post-battle wave-advance TAIL (`coop-replay-phases.ts` `maybeRunCoopWaveAdvance`)
onto the operation model (`coop-wave-operation.ts`) — §2.5 item 4. It is the surface §8.6's KEYSTONE-BLOCKED
residual named: the FIRST with a REGISTERED PRODUCTION LIVE-MUTATION SINK, proving a journal-delivered op
can drive real guest mutation (the reviewer's central demand). What it establishes for every later surface:

- **A HOST-DRIVEN surface (not owner-alternated).** The host is the sole engine that resolves a wave, so the
  owner is ALWAYS the host seat (0), the host commits at its own wave-end (`broadcastCoopWaveResolved`, where
  `waveResolved`/`waveEndState` already fire), and the guest is ALWAYS the watcher. The op is PINNED on the
  WAVE INDEX (one advance per wave), so cross-wave stale ordering is structural — the typed successor of the
  legacy `lastResolvedWave` double-advance guard. Its class is `op:wave`, DERIVED from the envelope's
  `logicalPhase` ∈ {`WAVE_VICTORY`, `WAVE_FLEE`, `GAME_OVER`} (the next phase the transition enters, so the
  envelope makes `logicalPhase` host-authoritative — the keystone).
- **ONE LEDGER (P0-2 done here first).** UNLIKE the parked-era biome/ME/reward adapters (which keep a separate
  `journalGuest` because they have no live sink and unifying would make the relay-adopt path see the journal's
  `operationId` as already-applied and fall to the wrong fallback), the wave surface routes BOTH the
  relay-adopt seam AND the journal-replay seam into ONE `CoopOperationGuest`, deduped by `operationId`. This
  is safe because the MATERIALIZATION (building the tail) is deduped SEPARATELY by `lastResolvedWave`
  (`coop-runtime`), NOT by the op ledger: `maybeRunCoopWaveAdvance` builds the tail whenever the
  wave-guarded `consumeCoopPendingWaveAdvance` returns non-null, EVEN when the journal already pre-applied the
  op (adopt then returns `stale:true`). So the tail is built exactly once regardless of which carrier consumes
  the op first — the biome hazard (relay-adopt seeing the journal's op and falling to the wrong fallback) does
  not exist because the build gate is the wave, not the ledger. The journal applier RE-KEYS the envelope to the
  guest-local dense revision so the one shared applier stays on a single monotonic stream (the host revision is
  used only by the durability manager's own `(cls, seq)` receive-ledger).
- **The LIVE SINK feeds the existing safe-boundary queue.** `registerCoopOperationLiveSink("op:wave", …)` in
  `coop-runtime` (`materializeCoopWaveAdvanceFromOp`) does NOT push phases from the durability handler
  (mid-message, unsafe). It feeds the SAME `pendingWaveAdvance` queue the legacy `waveResolved` feeds, so the
  tail rebuilds at the next SAFE turn boundary via `maybeRunCoopWaveAdvance` — ONE materialization site fed by
  EITHER carrier. Guest-only + authoritative-only + wave-deduped; a normal (relay-present) run never
  double-builds. This is the pattern a later surface's live sink copies: route into the surface's existing
  safe-boundary applier, never mutate from the durability handler directly.
- **STRICT-TAILS observe mode (§3 unlock).** With `logicalPhase` now host-authoritative for the between-wave
  transition, `coop-renderer-gate.ts` gains a SEPARATE `strictTails` sub-flag (default OFF, never enforcing —
  §6.3 evidence-only). When ON, a §3.3 boundary-tail phase the guest builds that the CURRENT adopted
  `WAVE_ADVANCE` op did not sanction (`coopWaveAdvanceSanctionedTails`, pushed into the gate on adopt) logs
  `[coop:gate] TAIL WOULD-BLOCK` and still RUNS — the warn-first evidence rollout mirroring the allowlist's
  own `WOULD-BLOCK`. The op-sanctioned-construction enforce is a follow-up after clean soak evidence; DO NOT
  flip it here.
- **FAIL-LOUD, not derive.** Under flag-ON, an op that fails to adopt for a NON-stale reason (fail-closed
  unknown kind / applier gap) logs LOUD and does NOT silently fall to the raw `pending.outcome` derivation
  (the #859 phantom-dissolve + resync backstops recover). Only the flag-OFF path derives. A stale/duplicate is
  a legitimate skip (the wave already advanced) — and, under one-ledger, is exactly the "journal pre-applied"
  case where the tail must STILL build.

**RESIDUALS (Wave-2f):**
- **ME-boundary stays on the Wave-2c ME_TERMINAL op.** An ME-spawned battle victory
  (`queueCoopMeBattleVictoryTail`) does NOT flow through `broadcastCoopWaveResolved` (VictoryPhase's
  isMysteryEncounter branch returns before it), so no `WAVE_ADVANCE` is committed for ME battles. The payload
  carries `meBoundary` for schema completeness + strict-tails accounting, but standard waves state
  `meBoundary: "none"`. Routing the ME victory tail through `WAVE_ADVANCE` would conflict with the
  `ME_TERMINAL` `battle` op — deliberately NOT done.
- **The other surfaces' live sinks + ledger unification remain KEYSTONE-unblocked-but-not-yet-wired.** Wave-2f
  proves the pattern for `op:wave`; wiring a real biome/reward/ME materializer + unifying their split ledgers
  (§8.6 P0-2 residual) is now UNBLOCKED (the sink seam + the one-ledger recipe exist) but is per-surface
  follow-up work, not done here.
- **Capture presentation is not journal-recovered.** A journal-delivered wave-advance (relay lost) rebuilds the
  phase tail but carries no `captureParty`/`capturePresentation` blob (those ride `waveResolved`); the caught
  mon + party are reconciled by the DATA plane (`waveEndState`/checkpoint), the cosmetic ball-throw is skipped
  on the recovery path. Acceptable — the control tail is what the journal recovers; the DATA plane owns the party.

**Note on §3.3:** the KEYSTONE boundary-tail rows (`VictoryPhase`/`TrainerVictoryPhase`/`BattleEndPhase`/
`NewBattlePhase`/`NextEncounterPhase`/`NewBiomeEncounterPhase`/`SwitchBiomePhase`/`GameOverPhase` + the ME/egg
boundary companions) are now gated by the strict-tails observe mode above when it is ON — a tail is
op-sanctioned by the adopted `WAVE_ADVANCE` op or it logs `TAIL WOULD-BLOCK`. They remain in the allowlist
(the guest still constructs them); strict-tails is the evidence path toward op-sanctioned enforcement.

### 8.8 Lobby/resume boundary hardening (tester-ready checkpoint)

The first half of §2.5 item 7 is live in `6e89d400a` and `5952d491d` (failure-first commits
`955bcbe87` and `440703f22`):

- `resumeOffer`, `resumeReply`, and `resumeStartNew` are keyed by a host-authored `decisionId`. The host
  retains the latest decision and re-announces it after hot rejoin; the guest de-duplicates a repeated offer;
  and a delayed reply is accepted only by the exact active offer. This closes both the lost start-new barrier
  softlock and the stale-reply/new-offer alias.
- The host retains the latest wave-keyed `launchSnapshot`. A guest parks its waiter and sends
  `requestLaunchSnapshot`; the host replays the exact cached snapshot. A reconnect reissues every outstanding
  request, and already-consumed snapshots are ignored exactly once so a resend cannot poison a later await.
- An authoritative guest no longer falls back to generating its own launch when the snapshot is unavailable or
  invalid. It fails closed at an explicit recovery screen. Local generation made the UI appear to recover while
  creating a structurally different run, guaranteeing a later desync.
- The incompatible wire is gated by `er-coop-15`. Controller/transport suites are 32/32 green, battle-stream is
  32/32 green, and the real two-engine resume + launch snapshot + launch-sync suites are 4/4 green.

Remaining in item 7: mint and negotiate the control-plane epoch at the launch/cold-resume boundary, then prove
same-epoch hot rejoin and cross-epoch stale-op rejection end-to-end.
