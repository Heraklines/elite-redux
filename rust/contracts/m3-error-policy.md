# PokéRogue Redux Rust kernel M3 error policy

Status: normative for M3 once the G6 contract-freeze commit is accepted.

This policy applies to `GameConfig::Battle`. The M2 protocol-fixture harness
may preserve its frozen compatibility behavior, but it must not weaken this
policy or become reachable from the production battle runtime.

## Classification

| Failure | Classification | Required result |
| --- | --- | --- |
| Wrong-seat raw input | `InputRejected::WrongSeat` | Reject the input; mutate no deterministic state except append-only diagnostic trace evidence. |
| Stale menu instance | `InputRejected::StaleMenuInstance` | Reject the input; keep the current menu and all mechanical state unchanged. |
| Disabled or hidden option | `InputRejected::DisabledOption` | Reject the decision; retain the current menu and selection. |
| Button unsupported by the active menu | `InputRejected::UnsupportedButton` | Reject the input without a semantic decision. |
| Illegal semantic command | `CommandRejected::Illegal` | Do not consume PP or RNG; retain or reopen the exact owning menu. |
| Duplicate command identity with the same fingerprint | idempotent duplicate | Admit at most once and return the already-known result/stage. |
| Same command identity with a different fingerprint | `ProtocolViolation::ProposalConflict` | Fail closed; do not replace the admitted command. |
| Unsupported reachable content during battle load | `BattleInitializationError::UnsupportedContent` | Refuse to construct the battle. Never substitute `NONE` or silently omit an effect. |
| Unsupported effect reached during resolution | `BattleInvariantError::UnsupportedEffectReached` | Abort the staged transition. This indicates invalid capability classification. |
| Invalid canonical state before resolution | `BattleInvariantError::InvalidBeforeState` | Resolve nothing and consume no RNG. |
| Invalid candidate state after resolution | `BattleInvariantError::InvalidAfterState` | Discard the complete clone-and-swap transaction. |
| Battle resolver failure | `AtomicTransitionError::BattleResolve` | Discard the complete transaction; expose no staged effect. |
| Material encode/decode failure | `AtomicTransitionError::MaterialCodec` | Discard the complete transaction before publication. |
| Authority-side common material-applier failure | `AtomicTransitionError::MaterialApply` | Discard the complete unpublished transaction; expose no staged effect/revision. |
| Digest of authenticated material's own `before_state` differs from its stated `before_digest` | `BattleMaterialApplyError::InvalidMaterialBeforeDigest` | Enter shared terminal `M3_INVALID_AUTHORITY_MATERIAL`; replay or recovery cannot repair the same bytes. |
| Endpoint-local state/digest mismatch after a material has passed its self-digest check and compatible TURN-frontier reconciliation (or exact REPLACEMENT comparison) | `ReplicaApplyError::BeforeDigestMismatch` | Start correlated recovery; do not apply any material field. |
| Endpoint-current menu allocator disagrees with otherwise internally valid material-before allocator evidence | `BattleMaterialApplyError::LocalBeforeStateMismatch` mapped to `ReplicaApplyError::BeforeDigestMismatch` | Start correlated recovery; do not install the material allocator/control. |
| Material content hash mismatch | `ProtocolViolation::ContentHashMismatch` | Enter shared terminal `M3_CONTENT_HASH_MISMATCH`. |
| Malformed identity, wrong oracle identity, or unsupported-version material | `ProtocolViolation::MalformedBattleMaterial` | Enter shared terminal `M3_MALFORMED_BATTLE_MATERIAL`. |
| Material after-state, after-digest, evidence, control projection, or internally malformed/regressing menu-allocator projection | `ReplicaApplyError::InvalidAfterState` | Enter shared terminal `M3_INVALID_AUTHORITY_MATERIAL`; replaying the same authenticated bytes cannot repair them. |
| Duplicate exact material after successful application | idempotent duplicate | Emit no mutation and retain the existing stage. |
| Authority-log prepare or publish failure | `AtomicTransitionError::AuthorityLog` | Discard the complete staged transaction and leak no revision or timer. |
| Scheduler allocation failure | `AtomicTransitionError::Scheduler` | Discard the complete staged transaction and leak no timer ID. |
| Logical control installation failure | `AtomicTransitionError::ControlInstall` | Discard the complete staged transaction and leak no menu/control receipt. |
| State validation failure during replica apply | `ReplicaApplyError::Invariant` | Enter shared terminal `M3_INVALID_AUTHORITY_MATERIAL`. |
| Blocking presentation settled | successful environment outcome | Clear only the matching presentation barrier and make an already-installed logical control actionable when no other barrier remains. |
| Policy-authorized presentation skip | successful environment outcome | Clear only the matching barrier. Record that the skip was intentional. |
| Presentation failed | `PresentationFailure` | Keep canonical state committed, keep human input blocked, and enter shared terminal `M3_PRESENTATION_FAILED` symmetrically. Never pretend the event rendered. |
| Differential oracle mismatch | test failure | Report the first divergent RNG draw, action, mutation, presentation event, or state field. Never fall back to alternate gameplay. |
| Internal event budget exceeded | `KernelInvariantError::InternalEventBudgetExceeded` | Abort the external step atomically and return a replayable trace of the queued causal chain. |
| Snapshot schema/content mismatch | `SnapshotError` | Refuse restoration; never partially restore a subsystem. |

## Exact replica recoverability classes

Correlated recovery is used only after the authenticated material's own
before-state/digest pair has validated and that material may be valid for a
different committed local frontier: `BeforeDigestMismatch`, a missing
revision/gap, or the existing Authority V2 stale-generation/frontier classes.
The rejected entry is not applied. Recovery requests the exact correlated
checkpoint/tail using the unchanged previous committed frontier.

An authenticated entry whose content identity, schema/codec, self
before-state/digest pair, after-state,
after-digest, mutation evidence, next-decision/control projection, or invariant
is invalid is not recoverable by replaying the same bytes. It enters the exact
shared terminal reason listed above. If a correlated recovery response itself
reproduces one of those invalid-authority classes, it terminalizes identically.
Workers may not broaden recovery to malformed material or choose a local
fallback.

## Atomic rejection rule

Unless this table explicitly requires a recovery or shared-terminal transition,
or says canonical material was already committed (presentation failure is the
main case), an error leaves all of the following exactly as they were before
the external input:

- mechanical game and battle state;
- RNG state and draw sequence;
- Authority V2 revision/frontier/admission state;
- scheduler allocator, timers, and pause reasons;
- input-router held/suppressed/locked state;
- UI stack, selected option, and menu instance;
- pending presentations;
- emitted external effects.

For a required recovery/shared-terminal outcome, the failed material clone is
first discarded. A fresh clone may then change only the prescribed protocol
recovery/fence/timers or terminal/input-blocking state and their explicit
effects; mechanical state, RNG, command/faint state, and rejected revision stay
unchanged. `m3-atomic-transition.md` freezes that two-stage fail-closed path.

Diagnostic rejection/trace records may be returned as observations, but they
must not become inputs to later mechanics or alter a determinism digest that is
defined to exclude diagnostics.

## Battle resolver error nesting

`BattleResolveError` is the closed public resolver boundary. Invalid canonical
input state, including `CommandLegalityError::State`, maps to
`BattleInvariantError::InvalidBeforeState`. A reachable
`CommandLegalityError::UnsupportedCapability` maps to
`BattleInvariantError::UnsupportedEffectReached`; it is an invariant breach,
not an ordinary rejected command. Candidate-state validation,
mutation-evidence disagreement, and presentation sequence overflow map through
`BattleInvariantError::InvalidAfterState` with their exact
`BattleAfterStateFailure` source.

Every other command-legality failure remains nested as
`BattleResolveError::Legality`. A command-side content error is unwrapped to
`BattleResolveError::Content`; direct content, RNG, mechanical-digest, and
canonical failures retain their corresponding typed variants. No blanket
legality conversion may erase these classifications. `NoLegalReplacement`
remains a successful typed next decision and must never be converted into an
error.

## No local fallback

Workers may add private context to these errors. They may not add a new
gameplay fallback, silently coerce data, consume a compensating RNG draw, or
choose a different recovery/terminal outcome. A missing class is a contract
change request owned by the integration steward.
