# Co-op authority stabilization - three-track plan (2026-07-17)

Adopted from the external architecture audit of `ci/coop/fold-20260717` + this session's
empirical evidence (gates 1-10, duo logs, campaign evidence). Maintainer-reviewed. This file is
the durable source of truth for the plan; task-list entries reference it.

## Standing verdicts (do not relitigate)

- The audit's two P0s are empirically CONFIRMED by duo-log evidence this session:
  (1) authoritative state / non-authoritative continuation (host retained turn rev=3 forever while
  journal showed 1/1 converged - continuationReady depends on locally reconstructed Phaser chains);
  (2) dual retention ledgers (CoopBattleStreamer turn/replacement retention vs CoopDurabilityManager
  op:global journal, bridged by causal exceptions).
- Ambient runtime ownership is the recurring root class (timer-ownership pins, preemption-save,
  runWhenCoopRuntimeActive wraps were all instances). `runWhenCoopRuntimeActive` is a MIGRATION SEAM,
  not the ownership model - new correctness-critical async code must capture an explicit
  runtime/binding; new uses of the shim need a tracking note "MIGRATION: replace with injected
  CoopRuntimeContext under Track A1".
- RELEASE RULE 1: never combine green evidence from different SHAs. One frozen SHA per verdict;
  requalify fully on the integration SHA.
- RELEASE RULE 2 (verified 2026-07-17): the sparse-payload faint bug is FOLD-INTRODUCED
  (feat's producer is `data = isBaton ? [1] : [0]` with no index-2..5 address stamp; feat's
  validPayload passes on it). Staging does NOT have that bug. Therefore the fold is NOT an urgent
  rescue - it is a feature/architecture train that must be qualified as a whole (Track R).
  The only staging-relevant hotfix candidates from this session are in game-data.ts (code live on
  staging): CoopResumeReplicaUnavailableError.contentGarbage reclaim safety + the 2s->15s
  persistence lock acquire headroom. Evaluate backporting those two to feat independently.
- 60s replacement-pick fallback (getCoopFaintSwitchWaitMs) is FINAL by maintainer decision;
  rendezvous barriers budget the partner at the same class. Do not raise unilaterally.

## Track R - stabilization release

R0. (optional, independent) Minimal feat hotfix: backport contentGarbage reclaim safety + 15s
    lease headroom to feat; solo-lane + dirty-lane campaign proof; staging deploy.
R1. Freeze the fold candidate: finish current diagnostic runs (gate 10 @8211f7937, campaign
    @312906dc3), apply resulting fixes, freeze ONE fold SHA. Stop accumulating unrelated change.
R2. Qualify the frozen fold SHA (all on that exact SHA): full sharded gate; campaign (all lanes
    incl. dirty + 30-wave depth); faint/replacement journey; mystery journey; animations-on;
    reconnect/recovery; GameOver terminal; deterministic authoritative-message fault cases;
    teardown/resource-zero assertions. Isolated regression contract for the dense-payload fix
    exists (coop-faint-switch-operation.test.ts dense-stamp pin + coop-operation-all-class-fault
    deferral pin) - keep them in the qualification set.
R3. Integration candidate: fresh branch FROM feat/elite-redux-port (fold is 26 behind), single
    merge of the frozen fold, no opportunistic refactoring, record behavior-affecting conflict
    resolutions individually. One immutable integration SHA.
R4. Requalify the integration SHA with the full R2 evidence set. Fold results are informative,
    non-authoritative.
R5. Promote to staging as a STABILIZATION release (release notes list live failures fixed;
    explicitly NOT architectural closure). User two-browser pair session = live acceptance.

## Track S - post-integration liveness stabilization (ordered)

S0. Unified park-frontier trace: one structured record whenever progression parks
    (session/epoch/membership, material+operation revisions, retained turn/replacement/operation,
    material stage, expected control, active phase + queued phases, active surface + owner seat,
    active requests, active timers + owners, recovery/terminal fence flags).
S1. Request leases: one exact request address owns one retry loop; cancel the loop when the final
    consumer disappears; explicit transfer to recovery; distinct cancellation reasons
    (superseded/aborted/terminal/teardown). Fixes the observed requestTurnCommit orphan class.
S2. Address-keyed waiters: replace singleton live/checkpoint waiter fields; a second replay pump
    joins or is rejected - never overwrites another pump's wake path.
S3. Active-time deadlines: one runtime clock distinguishing connected/disconnected/suspended/
    renderer/human-input time; no independent Date.now() retrofits.
S4. Material/control/presentation split (COORDINATED PROTOCOL CHANGE, not a rename):
    materialApplied / controlInstalled / presentationReady / continuationReady with explicit
    per-transaction retirement stages. Presentation must not kill a mechanically converged run.
S5. Recovery front fence: acquire BEFORE the snapshot request; freeze command admission, phase
    advancement, retained materialization, authority-wait creation until commit or terminal.
S6. Centralized frame-schema validation at the transport boundary; mechanically relevant
    malformed frames become classified protocol failures.

## Track A - architecture-proof migration

A1. Injected CoopRuntimeContext (runtimeId/sessionId/epoch/seats/membership/scene/transport/log/
    scheduler); eliminate ambient getCoopRuntime()/globalScene discovery from correctness paths.
A2. Canonical nextControl in every authoritative commit (kind + owner seat + address); the guest
    PROJECTS it into Phaser, never derives it from local phase state.
A3. One authoritative log: TURN_COMMIT / REPLACEMENT_COMMIT / INTERACTION_COMMIT / WAVE_ADVANCE /
    TERMINAL_COMMIT in one revision order, one retirement rule
    ("N+1 admitted => N subsumed or N reached its required stage").
A4. Full P33 frame context mandatory on ordinary gameplay frames (sessionId/runId/epoch/seatMapId/
    membershipRevision/senderSeatId/authoritySeatId/connectionGeneration); split transport role
    from authority role in the type system.
A5. Remove compatibility correctness paths (raw hints cosmetic only).
A6. Model-based dual-endpoint protocol simulator: one virtual clock, async loopback delivery,
    faults on EVERY mechanically relevant message, deadlock detection, invariant:
    both peers reach same material revision + compatible control state, OR the same retained
    terminal transaction; never one peer parked without an owned recoverable transaction.

## Release invariants (definition of "matrix parity" for R2/R4)

At clean completion, both clients prove: same session/epoch/membership frontier; same material
revision + checksum; same canonical control destination; no unresolved retained turn/replacement
commits; no unresolved journal entries; no orphan requests/retry timers; no pending continuation
expectations; no held recovery fence; no unexpected shared terminal.
At a deliberate terminal: both clients in the SAME retained terminal transaction; all gameplay
waiters released under the terminal fence; no local fallback mutation.
A journey that reaches its goal but leaves an orphan timer is NOT clean convergence.

## Open diagnostics carried into R1

- S4 showdown-versus-faint parked at StatStageChangePhase: determine whether the unsettled-mutator
  tripwire is CORRECTLY holding (phase tree failed to drain / stale detached phase / early commit
  sentinel / waiting on another retained boundary / presentation-only). Do NOT "fix" by weakening
  the blacklist while a real mutation is pending; the long-term fix is the mutation-token barrier.
- coop-duo-faint-switch.test.ts:255 idle-picker fallback variant.
- coop-final-boss-stage-one.test.ts:64 stage-one geometry assertion (red since gate 4; distinct class).
- C1 coop-soak-journey wave-14 ER_HOT_SPRING guest-owned ME drive stall (replay: SOAK_SEED=828633).
- B7 reciprocity proof converted to two-context settlement (gate 10 verifies).
- Campaign: authority-close probe origin-cursor fix (run 29613070126 verifies); mystery-lane
  ME phase-pairing normalization (verified fix in flight).

## ITERATION-5 PRECONDITIONS (reviewer mandate 2026-07-18 - MANDATORY before any live turn-cutover retry)

The cutover is blocked on PROTOCOL SEMANTICS and harness fidelity - not harness alone. All ten
required before Iteration 5:
 1. Separate admission/material/control frontiers in the replica ledger (receivedThrough vs
    materialAppliedThrough vs controlInstalledThrough; redelivery classified duplicate-applied vs
    duplicate-pending-material vs duplicate-pending-control; a pending duplicate RE-DRIVES the
    missing stage - never discarded as applied).
 2. Retry/recover material admitted but not applied (the cursor-collapse P0).
 3. Durable post-admission receipts (redeliver-until-final-stage with duplicate re-ACK, or
    journaled receipt retry, or a periodic cumulative replica-frontier frame).
 4. Sender authorization: authorityEntry requires senderSeatId === authoritySeatId; receipts
    require the expected replica seat + membership revision + accepted connection generation.
 5. materialApplied ONLY after full state install + checksum convergence under the destination
    runtime (buffered-into-inbox is NOT applied; add a materialDeferred stage if needed).
 6. controlInstalled ONLY from the address-exact installed-control ledger updated by the real
    command-surface chokepoint (CommandPhase validates owner/address/actor/revision, registers
    controlId; projector returns deferred until then).
 7. Model the full COMMAND FRONTIER (all owners' decisions in doubles), not the first live actor.
 8. Wire the v2 recovery fence into live runtime progression (registerFencePredicates is a no-op).
 9. Browser flag: process.env does not exist in a Vite browser bundle - use
    import.meta.env.VITE_COOP_AUTHORITY_V2_TURN or an explicit define (else the browser campaign
    exercises shadow/legacy only while the node gate exercises cutover).
10. Then: cutover gate + real-browser journey on ONE SHA.

Shadow-mode qualification additionally asserts: zero shadow FAULTs; zero retained v2 entries at
clean boundaries; zero v2 timers after teardown; no outbound-queue collapse; no material
transport latency/backpressure regression. Shadow parity proves digest equality on observed
surfaces, NOT the live cutover - never claim more.

TRACK R FINAL SEQUENCE (reviewer-confirmed): keep v2turn OFF; merge current feat head into the
integration branch (DONE 8904dad3e: feat 16 commits, zero conflicts); land campaign-lane fixes;
requalify gate+campaign on the ONE resulting SHA vs the accepted ledger; deploy as CO-OP
STABILIZATION BUILD (not Authority V2 completion); real two-browser session = live acceptance.
